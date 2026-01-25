import { gmail_v1 } from 'googleapis';
import prisma from '@/lib/prisma';
import { getGmailClient, NoGoogleAccountError, NoRefreshTokenError } from '@/lib/gmail/client';
import { parseGmailResponse, ParsedGmailMessage } from '@/lib/gmail/parser';

/**
 * Payload for syncUserMailbox function
 */
export interface SyncUserMailboxPayload {
  userId: string;
}

/**
 * Result of sync operation
 */
export interface SyncResult {
  success: boolean;
  messagesProcessed: number;
  conversationsUpdated: number;
  error?: string;
  syncType: 'incremental' | 'full' | 'none';
}

/**
 * Message direction enum
 */
type MessageDirection = 'SENT' | 'RECEIVED';

/**
 * Extracted message data ready for database
 */
interface ProcessedMessage {
  messageId: string;
  threadId: string;
  direction: MessageDirection;
  sender: string;
  recipient_list: string[];
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  received_at: Date;
  sendLogId: string | null;
}

/**
 * Main entry point - orchestrates sync for a user's mailbox
 * Structured for easy queue migration later (just wrap in Inngest function)
 */
export async function syncUserMailbox(payload: SyncUserMailboxPayload): Promise<SyncResult> {
  const { userId } = payload;
  console.log(`[Email Sync] Starting sync for userId: ${userId}`);

  try {
    // 1. Get Gmail client
    const gmail = await getGmailClient(userId);

    // 2. Get user's email address for direction detection
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      console.error(`[Email Sync] User ${userId} has no email address`);
      return {
        success: false,
        messagesProcessed: 0,
        conversationsUpdated: 0,
        error: 'User has no email address',
        syncType: 'none',
      };
    }

    // 3. Get current sync state
    const syncState = await prisma.gmail_sync_state.findUnique({
      where: { userId },
    });

    const storedHistoryId = syncState?.historyId;
    console.log(`[Email Sync] Stored historyId: ${storedHistoryId || 'none'}`);

    // 4. Try incremental sync first, fall back to full sync if needed
    let result: SyncResult;

    if (storedHistoryId) {
      result = await processHistoryChanges(gmail, userId, user.email, storedHistoryId);

      // If history is stale (404/410), fall back to full sync
      if (!result.success && result.error?.includes('historyId')) {
        console.log(`[Email Sync] History stale, falling back to full sync`);
        result = await performFullSync(gmail, userId, user.email);
      }
    } else {
      // No stored historyId, do full sync
      console.log(`[Email Sync] No stored historyId, performing full sync`);
      result = await performFullSync(gmail, userId, user.email);
    }

    console.log(`[Email Sync] Sync completed for userId: ${userId}`, result);
    return result;

  } catch (error) {
    // Handle known auth errors
    if (error instanceof NoGoogleAccountError || error instanceof NoRefreshTokenError) {
      console.error(`[Email Sync] Auth error for userId ${userId}:`, error.message);
      return {
        success: false,
        messagesProcessed: 0,
        conversationsUpdated: 0,
        error: `Auth error: ${error.message}`,
        syncType: 'none',
      };
    }

    // Handle unexpected errors
    console.error(`[Email Sync] Unexpected error for userId ${userId}:`, error);
    return {
      success: false,
      messagesProcessed: 0,
      conversationsUpdated: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
      syncType: 'none',
    };
  }
}

/**
 * Incremental sync via history.list API
 * Returns messages added since the stored historyId
 */
async function processHistoryChanges(
  gmail: gmail_v1.Gmail,
  userId: string,
  userEmail: string,
  startHistoryId: string
): Promise<SyncResult> {
  console.log(`[Email Sync] Processing history changes from historyId: ${startHistoryId}`);

  try {
    let messagesProcessed = 0;
    let conversationsUpdated = new Set<string>();
    let latestHistoryId = startHistoryId;
    let pageToken: string | undefined;

    do {
      // Fetch history changes
      const historyResponse = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        pageToken,
      });

      latestHistoryId = historyResponse.data.historyId || latestHistoryId;
      const historyRecords = historyResponse.data.history || [];

      // Process each history record
      for (const record of historyRecords) {
        const messagesAdded = record.messagesAdded || [];

        for (const messageAdded of messagesAdded) {
          const messageId = messageAdded.message?.id;
          if (!messageId) continue;

          try {
            const processed = await fetchAndProcessMessage(gmail, userId, userEmail, messageId);
            if (processed) {
              messagesProcessed++;
              conversationsUpdated.add(processed.threadId);
            }
          } catch (error) {
            console.error(`[Email Sync] Error processing message ${messageId}:`, error);
            // Continue with other messages
          }
        }
      }

      pageToken = historyResponse.data.nextPageToken || undefined;
    } while (pageToken);

    // Update sync state with latest historyId
    await updateSyncState(userId, latestHistoryId);

    return {
      success: true,
      messagesProcessed,
      conversationsUpdated: conversationsUpdated.size,
      syncType: 'incremental',
    };

  } catch (error) {
    // Check for historyId expired errors (404 or 410)
    if (isHistoryIdExpiredError(error)) {
      console.warn(`[Email Sync] HistoryId expired for userId ${userId}`);
      return {
        success: false,
        messagesProcessed: 0,
        conversationsUpdated: 0,
        error: 'historyId expired',
        syncType: 'incremental',
      };
    }

    // Check for rate limit (429)
    if (isRateLimitError(error)) {
      console.warn(`[Email Sync] Rate limited for userId ${userId}, will retry on next notification`);
      return {
        success: false,
        messagesProcessed: 0,
        conversationsUpdated: 0,
        error: 'Rate limited (429)',
        syncType: 'incremental',
      };
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Full sync fallback - fetches messages from last 7 days
 * Used when historyId is stale or not available
 */
async function performFullSync(
  gmail: gmail_v1.Gmail,
  userId: string,
  userEmail: string
): Promise<SyncResult> {
  console.log(`[Email Sync] Performing full sync for userId: ${userId}`);

  try {
    let messagesProcessed = 0;
    let conversationsUpdated = new Set<string>();

    // Calculate 7 days ago in Gmail query format
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const afterDate = sevenDaysAgo.toISOString().split('T')[0].replace(/-/g, '/');

    // List messages from last 7 days
    let pageToken: string | undefined;

    do {
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: `after:${afterDate}`,
        maxResults: 100,
        pageToken,
      });

      const messageRefs = listResponse.data.messages || [];

      for (const messageRef of messageRefs) {
        const messageId = messageRef.id;
        if (!messageId) continue;

        try {
          const processed = await fetchAndProcessMessage(gmail, userId, userEmail, messageId);
          if (processed) {
            messagesProcessed++;
            conversationsUpdated.add(processed.threadId);
          }
        } catch (error) {
          console.error(`[Email Sync] Error processing message ${messageId}:`, error);
          // Continue with other messages
        }
      }

      pageToken = listResponse.data.nextPageToken || undefined;
    } while (pageToken);

    // Get current profile to update historyId
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const newHistoryId = profile.data.historyId;

    if (newHistoryId) {
      await updateSyncState(userId, newHistoryId);
    }

    return {
      success: true,
      messagesProcessed,
      conversationsUpdated: conversationsUpdated.size,
      syncType: 'full',
    };

  } catch (error) {
    // Check for rate limit (429)
    if (isRateLimitError(error)) {
      console.warn(`[Email Sync] Rate limited during full sync for userId ${userId}`);
      return {
        success: false,
        messagesProcessed: 0,
        conversationsUpdated: 0,
        error: 'Rate limited (429)',
        syncType: 'full',
      };
    }

    throw error;
  }
}

/**
 * Fetch single message, check idempotency, parse, and store
 * Returns processed message data if successful, null if already exists
 */
async function fetchAndProcessMessage(
  gmail: gmail_v1.Gmail,
  userId: string,
  userEmail: string,
  messageId: string
): Promise<ProcessedMessage | null> {
  // 1. Check idempotency - skip if message already exists
  const existingMessage = await prisma.messages.findUnique({
    where: { messageId },
    select: { messageId: true },
  });

  if (existingMessage) {
    console.log(`[Email Sync] Message ${messageId} already exists, skipping`);
    return null;
  }

  // 2. Fetch full message from Gmail
  const messageResponse = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const message = messageResponse.data;
  const threadId = message.threadId;

  if (!threadId) {
    console.warn(`[Email Sync] Message ${messageId} has no threadId, skipping`);
    return null;
  }

  // 3. Parse message
  const parsed = parseGmailResponse(message);

  // 4. Detect direction
  const direction = detectMessageDirection(parsed.sender, userEmail);

  // 5. Look up sendLogId for SENT messages
  let sendLogId: string | null = null;
  if (direction === 'SENT') {
    sendLogId = await findSendLogId(messageId);
  }

  // 6. Prepare processed message data
  const processedMessage: ProcessedMessage = {
    messageId,
    threadId,
    direction,
    sender: parsed.sender,
    recipient_list: parsed.recipient_list,
    subject: parsed.subject,
    body_html: parsed.body_html,
    body_text: parsed.body_text,
    received_at: parsed.received_at,
    sendLogId,
  };

  // 7. Upsert to database
  await upsertEmailData(userId, processedMessage);

  console.log(`[Email Sync] Processed message ${messageId} (${direction})`);
  return processedMessage;
}

/**
 * Detect message direction based on sender matching user email
 */
function detectMessageDirection(sender: string, userEmail: string): MessageDirection {
  return sender.toLowerCase() === userEmail.toLowerCase() ? 'SENT' : 'RECEIVED';
}

/**
 * Find SendLog by gmailMessageId to link outgoing messages
 */
async function findSendLogId(gmailMessageId: string): Promise<string | null> {
  const sendLog = await prisma.sendLog.findUnique({
    where: { gmailMessageId },
    select: { id: true },
  });

  return sendLog?.id || null;
}

/**
 * Upsert conversation and message in a transaction
 */
async function upsertEmailData(userId: string, message: ProcessedMessage): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. Upsert conversation
    await tx.conversations.upsert({
      where: {
        threadId: message.threadId,
      },
      create: {
        threadId: message.threadId,
        userId,
        subject: message.subject,
        lastMessageAt: message.received_at,
        messageCount: 1,
      },
      update: {
        subject: message.subject || undefined, // Only update if non-null
        lastMessageAt: message.received_at,
        messageCount: {
          increment: 1,
        },
        updatedAt: new Date(),
      },
    });

    // 2. Create message (using create since we already checked for existence)
    await tx.messages.create({
      data: {
        messageId: message.messageId,
        threadId: message.threadId,
        userId,
        direction: message.direction,
        sender: message.sender,
        recipient_list: message.recipient_list,
        subject: message.subject,
        body_html: message.body_html,
        body_text: message.body_text,
        received_at: message.received_at,
        sendLogId: message.sendLogId,
      },
    });
  });
}

/**
 * Update historyId in gmail_sync_state
 */
async function updateSyncState(userId: string, historyId: string): Promise<void> {
  await prisma.gmail_sync_state.update({
    where: { userId },
    data: {
      historyId,
      updatedAt: new Date(),
    },
  });

  console.log(`[Email Sync] Updated historyId to ${historyId} for userId: ${userId}`);
}

/**
 * Check if error is a historyId expired error (404 or 410)
 */
function isHistoryIdExpiredError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: number }).code;
    return code === 404 || code === 410;
  }
  return false;
}

/**
 * Check if error is a rate limit error (429)
 */
function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: number }).code;
    return code === 429;
  }
  return false;
}
