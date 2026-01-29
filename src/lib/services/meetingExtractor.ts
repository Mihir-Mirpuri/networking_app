/**
 * Meeting Extractor Service
 *
 * Analyzes email threads to detect CONFIRMED meetings and creates suggestions.
 *
 * Key behavior:
 * - Analyzes full thread context (not just single messages)
 * - Only creates suggestions for CONFIRMED meetings (both parties agreed)
 * - Proposals without acceptance are ignored
 *
 * Designed to be called after email sync with graceful error handling
 * to never block the sync process.
 */

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  parseCalendarFromThread,
  parseCalendarFromEmail,
  toStorableFormat,
  ParsedMeetingResult,
  ThreadMessage,
  ThreadParserInput,
} from '@/lib/services/calendarParser';
import { detectMeetingInEmail } from '@/lib/utils/meetingDetector';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for thread-based meeting extraction
 */
export interface ThreadExtractionInput {
  messageId: string;    // The triggering message (latest reply)
  threadId: string;
  userId: string;
  userEmail: string;
}

/**
 * Legacy: Single email extraction input (kept for backwards compatibility)
 */
export interface EmailForExtraction {
  messageId: string;
  userId: string;
  subject: string | null;
  bodyText: string | null;
  sender: string;
  receivedAt: Date;
}

export interface ExtractionResult {
  extracted: boolean;
  suggestionId?: string;
  confidence?: number;
  skippedReason?: string;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Minimum confidence threshold to store a suggestion
 * Lower values mean more suggestions (possibly more noise)
 */
const MIN_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Maximum body text length per message to send to LLM
 * Truncate longer emails to save tokens and processing time
 */
const MAX_BODY_LENGTH = 2000;

/**
 * Maximum number of messages to include in thread context
 * Older messages are excluded to control token usage
 */
const MAX_THREAD_MESSAGES = 10;

// ============================================================================
// Thread Context Fetching
// ============================================================================

/**
 * Fetch all messages in a thread for context
 */
async function fetchThreadContext(
  threadId: string,
  userId: string
): Promise<ThreadMessage[]> {
  const messages = await prisma.messages.findMany({
    where: { threadId, userId },
    orderBy: { received_at: 'asc' },
    select: {
      direction: true,
      sender: true,
      subject: true,
      body_text: true,
      received_at: true,
    },
    take: MAX_THREAD_MESSAGES,
  });

  return messages.map((m) => ({
    direction: m.direction as 'SENT' | 'RECEIVED',
    sender: m.sender,
    subject: m.subject,
    bodyText: m.body_text && m.body_text.length > MAX_BODY_LENGTH
      ? m.body_text.substring(0, MAX_BODY_LENGTH) + '\n[truncated]'
      : m.body_text,
    receivedAt: m.received_at,
  }));
}

/**
 * Check if a suggestion already exists for any message in the thread
 */
async function hasThreadSuggestion(
  threadId: string,
  userId: string
): Promise<{ exists: boolean; suggestionId?: string }> {
  // Get all message IDs in the thread
  const messages = await prisma.messages.findMany({
    where: { threadId, userId },
    select: { messageId: true },
  });

  const messageIds = messages.map((m) => m.messageId);

  // Check if any have a suggestion
  const suggestion = await prisma.extractedMeetingSuggestion.findFirst({
    where: {
      messageId: { in: messageIds },
      userId,
    },
    select: { id: true },
  });

  return {
    exists: !!suggestion,
    suggestionId: suggestion?.id,
  };
}

// ============================================================================
// Thread-Based Extraction (Primary)
// ============================================================================

/**
 * Analyze an email thread for a CONFIRMED meeting and store suggestion if found.
 *
 * This function:
 * 1. Fetches full thread context
 * 2. Calls LLM to analyze conversation
 * 3. Only creates suggestion if meeting is CONFIRMED (both parties agreed)
 *
 * This function is designed to be fail-safe - it will never throw.
 *
 * @param input - Thread extraction input
 * @param options - Optional configuration
 * @returns Extraction result with status and any error
 */
export async function extractMeetingFromThread(
  input: ThreadExtractionInput,
  options: {
    userTimezone?: string;
    skipIfExists?: boolean;
  } = {}
): Promise<ExtractionResult> {
  const { messageId, threadId, userId, userEmail } = input;
  const { userTimezone, skipIfExists = true } = options;

  try {
    // 1. Check if suggestion already exists for this thread (idempotency)
    if (skipIfExists) {
      const existing = await hasThreadSuggestion(threadId, userId);

      if (existing.exists) {
        console.log(`[MeetingExtractor] Suggestion already exists for thread ${threadId}, skipping`);
        return {
          extracted: false,
          skippedReason: 'already_exists',
          suggestionId: existing.suggestionId,
        };
      }
    }

    // 2. Fetch full thread context
    const thread = await fetchThreadContext(threadId, userId);

    if (thread.length < 2) {
      console.log(`[MeetingExtractor] Thread ${threadId} has < 2 messages, skipping`);
      return {
        extracted: false,
        skippedReason: 'insufficient_messages',
      };
    }

    console.log(`[MeetingExtractor] Analyzing thread ${threadId} (${thread.length} messages)`);

    // 3. Call thread-based parser (LLM)
    const parseResult = await parseCalendarFromThread({
      messageId,
      threadId,
      thread,
      userEmail,
      userTimezone,
    });

    if (!parseResult.success) {
      console.error(`[MeetingExtractor] Parser failed for thread ${threadId}:`, parseResult.error);
      return {
        extracted: false,
        error: parseResult.error,
      };
    }

    // 4. Check if meeting was CONFIRMED
    if (!parseResult.isConfirmed || !parseResult.result) {
      console.log(`[MeetingExtractor] No confirmed meeting in thread ${threadId}:`, parseResult.reasoning);
      return {
        extracted: false,
        skippedReason: 'no_confirmed_meeting',
      };
    }

    const parsedMeeting = parseResult.result;

    // 5. Check confidence threshold
    if (parsedMeeting.confidence < MIN_CONFIDENCE_THRESHOLD) {
      console.log(`[MeetingExtractor] Confidence too low for thread ${threadId}:`, {
        confidence: parsedMeeting.confidence,
        threshold: MIN_CONFIDENCE_THRESHOLD,
      });
      return {
        extracted: false,
        skippedReason: 'low_confidence',
        confidence: parsedMeeting.confidence,
      };
    }

    // 6. Store suggestion in database (linked to triggering message)
    const suggestion = await storeMeetingSuggestion(userId, messageId, parsedMeeting);

    console.log(`[MeetingExtractor] Created suggestion for thread ${threadId}:`, {
      suggestionId: suggestion.id,
      title: parsedMeeting.title,
      confidence: parsedMeeting.confidence,
      startTime: parsedMeeting.startTime?.toISOString(),
    });

    return {
      extracted: true,
      suggestionId: suggestion.id,
      confidence: parsedMeeting.confidence,
    };

  } catch (error) {
    console.error(`[MeetingExtractor] Unexpected error for thread ${threadId}:`, error);
    return {
      extracted: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Legacy Single-Message Extraction (Deprecated)
// ============================================================================

/**
 * Analyze an email for meeting content and store suggestion if found.
 *
 * This function is designed to be fail-safe - it will never throw.
 * All errors are logged and returned in the result.
 *
 * @param email - Email data to analyze
 * @param options - Optional configuration
 * @returns Extraction result with status and any error
 */
export async function extractMeetingFromEmail(
  email: EmailForExtraction,
  options: {
    userTimezone?: string;
    skipIfExists?: boolean; // Skip if suggestion already exists for this message
  } = {}
): Promise<ExtractionResult> {
  const { messageId, userId, subject, bodyText, sender, receivedAt } = email;
  const { userTimezone, skipIfExists = true } = options;

  try {
    // 1. Check if suggestion already exists (idempotency)
    if (skipIfExists) {
      const existing = await prisma.extractedMeetingSuggestion.findUnique({
        where: { messageId },
        select: { id: true },
      });

      if (existing) {
        console.log(`[MeetingExtractor] Suggestion already exists for ${messageId}, skipping`);
        return {
          extracted: false,
          skippedReason: 'already_exists',
          suggestionId: existing.id,
        };
      }
    }

    // 2. Run pre-filter to check if email might contain meeting content
    const preFilterResult = detectMeetingInEmail(subject || '', bodyText || '');

    if (!preFilterResult.hasPotentialMeeting) {
      console.log(`[MeetingExtractor] Pre-filter: no meeting signals in ${messageId}`);
      return {
        extracted: false,
        skippedReason: 'no_meeting_signals',
      };
    }

    console.log(`[MeetingExtractor] Pre-filter passed for ${messageId}:`, {
      confidence: preFilterResult.confidence,
      patterns: preFilterResult.matchedPatterns.slice(0, 3),
    });

    // 3. Truncate body if too long
    const truncatedBody = bodyText && bodyText.length > MAX_BODY_LENGTH
      ? bodyText.substring(0, MAX_BODY_LENGTH) + '\n[truncated]'
      : bodyText;

    // 4. Call calendar parser (LLM extraction)
    const parseResult = await parseCalendarFromEmail({
      messageId,
      subject,
      bodyText: truncatedBody,
      sender,
      receivedAt,
      userTimezone,
      preFilterResult,
    });

    if (!parseResult.success) {
      console.error(`[MeetingExtractor] Parser failed for ${messageId}:`, parseResult.error);
      return {
        extracted: false,
        error: parseResult.error,
      };
    }

    // 5. Check if meeting was detected
    if (!parseResult.result || !parseResult.result.hasMeeting) {
      console.log(`[MeetingExtractor] No meeting detected by LLM for ${messageId}`);
      return {
        extracted: false,
        skippedReason: 'no_meeting_detected',
      };
    }

    const parsedMeeting = parseResult.result;

    // 6. Check confidence threshold
    if (parsedMeeting.confidence < MIN_CONFIDENCE_THRESHOLD) {
      console.log(`[MeetingExtractor] Confidence too low for ${messageId}:`, {
        confidence: parsedMeeting.confidence,
        threshold: MIN_CONFIDENCE_THRESHOLD,
      });
      return {
        extracted: false,
        skippedReason: 'low_confidence',
        confidence: parsedMeeting.confidence,
      };
    }

    // 7. Store suggestion in database
    const suggestion = await storeMeetingSuggestion(userId, messageId, parsedMeeting);

    console.log(`[MeetingExtractor] Created suggestion for ${messageId}:`, {
      suggestionId: suggestion.id,
      title: parsedMeeting.title,
      confidence: parsedMeeting.confidence,
      startTime: parsedMeeting.startTime?.toISOString(),
    });

    return {
      extracted: true,
      suggestionId: suggestion.id,
      confidence: parsedMeeting.confidence,
    };

  } catch (error) {
    // Never throw - just log and return error
    console.error(`[MeetingExtractor] Unexpected error for ${messageId}:`, error);
    return {
      extracted: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Store a meeting suggestion in the database
 */
async function storeMeetingSuggestion(
  userId: string,
  messageId: string,
  parsedMeeting: ParsedMeetingResult
): Promise<{ id: string }> {
  const extractedData = toStorableFormat(parsedMeeting) as Prisma.InputJsonValue;

  const suggestion = await prisma.extractedMeetingSuggestion.create({
    data: {
      userId,
      messageId,
      status: 'PENDING',
      extractedData,
      confidence: parsedMeeting.confidence,
    },
    select: {
      id: true,
    },
  });

  return suggestion;
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Process multiple emails for meeting extraction.
 * Useful for backfilling or reprocessing.
 *
 * @param emails - Array of emails to process
 * @param options - Processing options
 * @returns Summary of extraction results
 */
export async function extractMeetingsFromEmails(
  emails: EmailForExtraction[],
  options: {
    userTimezone?: string;
    concurrency?: number;
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<{
  total: number;
  extracted: number;
  skipped: number;
  failed: number;
  results: ExtractionResult[];
}> {
  const { userTimezone, concurrency = 3, onProgress } = options;
  const results: ExtractionResult[] = [];

  let extracted = 0;
  let skipped = 0;
  let failed = 0;

  // Process in batches for controlled concurrency
  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(email =>
        extractMeetingFromEmail(email, { userTimezone, skipIfExists: true })
      )
    );

    for (const result of batchResults) {
      results.push(result);

      if (result.extracted) {
        extracted++;
      } else if (result.error) {
        failed++;
      } else {
        skipped++;
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + concurrency, emails.length), emails.length);
    }
  }

  return {
    total: emails.length,
    extracted,
    skipped,
    failed,
    results,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a message already has a meeting suggestion
 */
export async function hasMeetingSuggestion(messageId: string): Promise<boolean> {
  const suggestion = await prisma.extractedMeetingSuggestion.findUnique({
    where: { messageId },
    select: { id: true },
  });
  return !!suggestion;
}

/**
 * Get pending suggestions count for a user
 */
export async function getPendingSuggestionsCount(userId: string): Promise<number> {
  return prisma.extractedMeetingSuggestion.count({
    where: {
      userId,
      status: 'PENDING',
    },
  });
}
