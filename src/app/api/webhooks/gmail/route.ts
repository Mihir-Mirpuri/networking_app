import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { syncUserMailbox } from '@/lib/services/email-sync';


/**
 * Parses Pub/Sub message and extracts Gmail notification data
 */
function parsePubSubMessage(body: any): { emailAddress: string; historyId: string } | null {
  try {
    // Pub/Sub message structure
    if (!body.message || !body.message.data) {
      console.error('[Gmail Webhook] Missing message.data in Pub/Sub payload');
      return null;
    }

    // Decode base64-encoded data
    const base64Data = body.message.data;
    let decodedData: string;

    try {
      // Handle URL-safe base64 (Pub/Sub uses standard base64, but be safe)
      const base64 = base64Data.replace(/-/g, '+').replace(/_/g, '/');
      const buffer = Buffer.from(base64, 'base64');
      decodedData = buffer.toString('utf-8');
    } catch (error) {
      console.error('[Gmail Webhook] Failed to decode base64 data:', error);
      return null;
    }

    // Parse JSON
    let notificationData: { emailAddress?: string; historyId?: string };
    try {
      notificationData = JSON.parse(decodedData);
    } catch (error) {
      console.error('[Gmail Webhook] Failed to parse JSON from decoded data:', error);
      return null;
    }

    // Extract emailAddress and historyId
    const emailAddress = notificationData.emailAddress;
    const historyId = notificationData.historyId;

    if (!emailAddress) {
      console.error('[Gmail Webhook] Missing emailAddress in notification data');
      return null;
    }

    if (!historyId) {
      console.error('[Gmail Webhook] Missing historyId in notification data');
      return null;
    }

    return { emailAddress, historyId };
  } catch (error) {
    console.error('[Gmail Webhook] Error parsing Pub/Sub message:', error);
    return null;
  }
}

/**
 * Looks up userId from emailAddress
 * Tries User table first, then falls back to gmail_sync_state
 */
async function lookupUserId(emailAddress: string): Promise<string | null> {
  try {
    // First, try User table
    const user = await prisma.user.findUnique({
      where: { email: emailAddress },
      select: { id: true },
    });

    if (user) {
      console.log(`[Gmail Webhook] Found userId from User table: ${user.id}`);
      return user.id;
    }

    // Fallback to gmail_sync_state table
    const syncState = await prisma.gmail_sync_state.findFirst({
      where: { email_address: emailAddress },
      select: { userId: true },
    });

    if (syncState) {
      console.log(`[Gmail Webhook] Found userId from gmail_sync_state: ${syncState.userId}`);
      return syncState.userId;
    }

    console.warn(`[Gmail Webhook] No user found for emailAddress: ${emailAddress}`);
    return null;
  } catch (error) {
    console.error('[Gmail Webhook] Error looking up userId:', error);
    return null;
  }
}

/**
 * Process Gmail sync for a user
 * Calls the email-sync service to fetch and process new messages
 */
async function processSync(userId: string): Promise<void> {
  console.log(`[Gmail Webhook] processSync called for userId: ${userId}`);

  const result = await syncUserMailbox({ userId });

  console.log(`[Gmail Webhook] Sync completed for userId: ${userId}`, {
    success: result.success,
    syncType: result.syncType,
    messagesProcessed: result.messagesProcessed,
    conversationsUpdated: result.conversationsUpdated,
    error: result.error,
  });
}

/**
 * POST handler for Gmail Pub/Sub webhook
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Gmail Webhook] Received webhook request');

    // 1. Parse request body
    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      console.error('[Gmail Webhook] Failed to parse request body as JSON:', error);
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // 3. Parse Pub/Sub message
    const notification = parsePubSubMessage(body);
    if (!notification) {
      console.error('[Gmail Webhook] Failed to parse Pub/Sub message');
      return NextResponse.json(
        { error: 'Invalid Pub/Sub message format' },
        { status: 400 }
      );
    }

    const { emailAddress, historyId } = notification;
    console.log(`[Gmail Webhook] Extracted notification - emailAddress: ${emailAddress}, historyId: ${historyId}`);

    // 4. Lookup userId
    const userId = await lookupUserId(emailAddress);
    if (!userId) {
      // Log warning but return 200 to acknowledge receipt (prevents Pub/Sub retries)
      console.warn(`[Gmail Webhook] User not found for emailAddress: ${emailAddress}. Acknowledging receipt.`);
      return NextResponse.json(
        { 
          acknowledged: true, 
          message: 'User not found, but notification acknowledged',
          emailAddress 
        },
        { status: 200 }
      );
    }

    console.log(`[Gmail Webhook] User lookup successful - userId: ${userId}`);

    // 5. Trigger sync processing
    try {
      await processSync(userId);
      console.log(`[Gmail Webhook] Sync processing triggered for userId: ${userId}`);
    } catch (error) {
      // Log error but still acknowledge receipt
      console.error(`[Gmail Webhook] Error in processSync for userId ${userId}:`, error);
      // Continue to return 200 to acknowledge receipt
    }

    // 6. Return success response
    return NextResponse.json(
      {
        acknowledged: true,
        userId,
        emailAddress,
        historyId,
        message: 'Notification received and processing triggered',
      },
      { status: 200 }
    );
  } catch (error) {
    // Unexpected errors - log but still acknowledge to prevent retries
    console.error('[Gmail Webhook] Unexpected error:', error);
    return NextResponse.json(
      {
        acknowledged: true,
        error: 'Internal server error, but notification acknowledged',
      },
      { status: 200 }
    );
  }
}
