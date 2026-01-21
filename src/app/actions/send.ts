'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import {
  sendEmail,
  getUserTokens,
  checkDailyLimit,
  incrementDailyCount,
} from '@/lib/services/gmail';

const BATCH_LIMIT = 10;

export interface PersonToSend {
  email: string;
  subject: string;
  body: string;
  userCandidateId?: string;
  resumeId?: string;
  scheduledFor?: Date;
}

export interface SendResult {
  email: string;
  success: boolean;
  error?: string;
}

export async function sendEmailsAction(
  people: PersonToSend[]
): Promise<{ success: true; results: SendResult[] } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !session.user.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Separate scheduled and immediate sends
  const scheduled = people.filter(p => p.scheduledFor);
  const immediate = people.filter(p => !p.scheduledFor);

  // Handle scheduled emails first
  const scheduleResults: SendResult[] = [];
  if (scheduled.length > 0) {
    for (const person of scheduled) {
      const result = await scheduleEmailAction(person);
      scheduleResults.push(result);
    }
    // If only scheduled emails, return early
    if (immediate.length === 0) {
      return { success: true, results: scheduleResults };
    }
  }

  // Check daily limit for immediate sends
  const { canSend, remaining } = await checkDailyLimit(session.user.id);
  if (!canSend) {
    return { success: false, error: 'Daily send limit reached (30 emails per day)' };
  }

  // Get user tokens
  console.log('[Send] Getting user tokens for userId:', session.user.id);
  let accessToken: string;
  let refreshToken: string | undefined;
  try {
    const tokens = await getUserTokens(session.user.id);
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;
    console.log('[Send] Tokens retrieved:', { hasAccessToken: !!accessToken, hasRefreshToken: !!refreshToken });
  } catch (error) {
    console.error('[Send] Error getting user tokens:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get authentication tokens' };
  }

  // Limit to batch size and remaining daily limit (only for immediate sends)
  const toSend = immediate.slice(0, Math.min(BATCH_LIMIT, remaining));
  console.log('[Send] Processing', toSend.length, 'emails (batch limit:', BATCH_LIMIT, ', remaining:', remaining, ')');

  const results: SendResult[] = [];

  for (const person of toSend) {
    if (!person.email) {
      results.push({
        email: person.email || 'unknown',
        success: false,
        error: 'No email address',
      });
      continue;
    }

    if (!person.userCandidateId) {
      results.push({
        email: person.email,
        success: false,
        error: 'UserCandidate ID required',
      });
      continue;
    }

    console.log('[Send] Sending email to:', person.email, 'subject:', person.subject?.substring(0, 50), 'resumeId:', person.resumeId);
    const sendResult = await sendEmail(
      accessToken,
      refreshToken,
      session.user.email,
      person.email,
      person.subject,
      person.body,
      person.resumeId
    );
    console.log('[Send] Send result:', { email: person.email, success: sendResult.success, error: sendResult.error });

    // Log the send attempt
    await prisma.sendLog.create({
      data: {
        userId: session.user.id,
        userCandidateId: person.userCandidateId,
        toEmail: person.email,
        subject: person.subject,
        body: person.body,
        resumeAttached: !!person.resumeId,
        resumeId: person.resumeId || null,
        status: sendResult.success ? 'SUCCESS' : 'FAILED',
        errorMessage: sendResult.error,
        gmailMessageId: sendResult.messageId,
      },
    });

    // Update EmailDraft status to SENT if it exists
    if (sendResult.success) {
      try {
        await prisma.emailDraft.updateMany({
          where: {
            userCandidateId: person.userCandidateId,
          },
          data: {
            status: 'SENT',
          },
        });
      } catch (error) {
        console.error('Error updating email draft status:', error);
      }
    }

    // Increment daily count on success
    if (sendResult.success) {
      await incrementDailyCount(session.user.id);
    }

    results.push({
      email: person.email,
      success: sendResult.success,
      error: sendResult.error,
    });
  }

  // Combine scheduled and immediate results
  return { success: true, results: [...scheduleResults, ...results] };
}

export async function sendSingleEmailAction(
  person: PersonToSend
): Promise<SendResult> {
  const result = await sendEmailsAction([person]);

  if (!result.success) {
    return { email: person.email, success: false, error: result.error };
  }

  return result.results[0] || { email: person.email, success: false, error: 'Unknown error' };
}

export async function getRemainingDailyLimit(): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return 0;
  }

  const { remaining } = await checkDailyLimit(session.user.id);
  return remaining;
}

export interface ScheduledEmail {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
  scheduledFor: Date;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  errorMessage?: string | null;
  sentAt?: Date | null;
  resumeId?: string | null;
  userCandidateId: string;
}

export async function scheduleEmailAction(
  person: PersonToSend
): Promise<SendResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !session.user.id) {
    return { email: person.email, success: false, error: 'Not authenticated' };
  }

  if (!person.scheduledFor) {
    return { email: person.email, success: false, error: 'scheduledFor is required' };
  }

  // Validate: must be at least 5 minutes in future
  const now = new Date();
  const minScheduledTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
  if (person.scheduledFor < minScheduledTime) {
    return { 
      email: person.email, 
      success: false, 
      error: 'Scheduled time must be at least 5 minutes in the future' 
    };
  }

  if (!person.userCandidateId) {
    return { email: person.email, success: false, error: 'UserCandidate ID required' };
  }

  // Check daily limit (count at schedule time)
  const { canSend, remaining } = await checkDailyLimit(session.user.id);
  if (!canSend) {
    return { 
      email: person.email, 
      success: false, 
      error: 'Daily send limit reached (30 emails per day)' 
    };
  }

  try {
    // Create scheduled email record
    const scheduledEmail = await prisma.scheduledEmail.create({
      data: {
        userId: session.user.id,
        userCandidateId: person.userCandidateId,
        toEmail: person.email,
        subject: person.subject,
        body: person.body,
        resumeId: person.resumeId || null,
        scheduledFor: person.scheduledFor,
        status: 'PENDING',
      },
    });

    // Increment daily count immediately (counts at schedule time)
    await incrementDailyCount(session.user.id);

    console.log('[Schedule] Scheduled email created:', scheduledEmail.id);
    return { email: person.email, success: true };
  } catch (error) {
    console.error('[Schedule] Error scheduling email:', error);
    return { 
      email: person.email, 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to schedule email' 
    };
  }
}

export async function getScheduledEmailsAction(): Promise<
  { success: true; emails: ScheduledEmail[] } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const scheduledEmails = await prisma.scheduledEmail.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        scheduledFor: 'asc',
      },
    });

    const emails: ScheduledEmail[] = scheduledEmails.map((email) => ({
      id: email.id,
      toEmail: email.toEmail,
      subject: email.subject,
      body: email.body,
      scheduledFor: email.scheduledFor,
      status: email.status as 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED',
      errorMessage: email.errorMessage,
      sentAt: email.sentAt,
      resumeId: email.resumeId || undefined,
      userCandidateId: email.userCandidateId,
    }));

    return { success: true, emails };
  } catch (error) {
    console.error('[Schedule] Error fetching scheduled emails:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch scheduled emails' 
    };
  }
}

export async function cancelScheduledEmailAction(
  scheduledEmailId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify the email belongs to the user and is still pending
    const scheduledEmail = await prisma.scheduledEmail.findFirst({
      where: {
        id: scheduledEmailId,
        userId: session.user.id,
        status: 'PENDING',
      },
    });

    if (!scheduledEmail) {
      return { success: false, error: 'Scheduled email not found or already processed' };
    }

    // Update status to CANCELLED (do NOT refund daily limit)
    await prisma.scheduledEmail.update({
      where: { id: scheduledEmailId },
      data: { status: 'CANCELLED' },
    });

    console.log('[Schedule] Cancelled scheduled email:', scheduledEmailId);
    return { success: true };
  } catch (error) {
    console.error('[Schedule] Error cancelling scheduled email:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to cancel scheduled email' 
    };
  }
}

export async function updateScheduledEmailAction(
  scheduledEmailId: string,
  newScheduledFor: Date
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Validate: must be at least 5 minutes in future
  const now = new Date();
  const minScheduledTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
  if (newScheduledFor < minScheduledTime) {
    return { 
      success: false, 
      error: 'Scheduled time must be at least 5 minutes in the future' 
    };
  }

  try {
    // Verify the email belongs to the user and is still pending
    const scheduledEmail = await prisma.scheduledEmail.findFirst({
      where: {
        id: scheduledEmailId,
        userId: session.user.id,
        status: 'PENDING',
      },
    });

    if (!scheduledEmail) {
      return { success: false, error: 'Scheduled email not found or already processed' };
    }

    // Update scheduled time (do NOT refund/recharge daily limit)
    await prisma.scheduledEmail.update({
      where: { id: scheduledEmailId },
      data: { scheduledFor: newScheduledFor },
    });

    console.log('[Schedule] Updated scheduled email:', scheduledEmailId, 'to', newScheduledFor);
    return { success: true };
  } catch (error) {
    console.error('[Schedule] Error updating scheduled email:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to update scheduled email' 
    };
  }
}
