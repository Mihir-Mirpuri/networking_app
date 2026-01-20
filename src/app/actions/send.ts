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

  // Check daily limit
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

  // Limit to batch size and remaining daily limit
  const toSend = people.slice(0, Math.min(BATCH_LIMIT, remaining));
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

  return { success: true, results };
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
