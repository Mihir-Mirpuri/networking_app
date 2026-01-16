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
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  company: string;
  role: string | null;
  university: string;
  subject: string;
  body: string;
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
  const { accessToken, refreshToken } = await getUserTokens(session.user.id);

  // Limit to batch size and remaining daily limit
  const toSend = people.slice(0, Math.min(BATCH_LIMIT, remaining));

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

    const sendResult = await sendEmail(
      accessToken,
      refreshToken,
      session.user.email,
      person.email,
      person.subject,
      person.body
    );

    // Create candidate record for history
    let candidateId: string | null = null;
    try {
      const candidate = await prisma.candidate.upsert({
        where: {
          userId_fullName_company: {
            userId: session.user.id,
            fullName: person.fullName,
            company: person.company,
          },
        },
        update: {
          email: person.email,
          sendStatus: sendResult.success ? 'SENT' : 'FAILED',
        },
        create: {
          userId: session.user.id,
          fullName: person.fullName,
          firstName: person.firstName,
          lastName: person.lastName,
          company: person.company,
          role: person.role,
          university: person.university,
          email: person.email,
          emailStatus: 'VERIFIED',
          sendStatus: sendResult.success ? 'SENT' : 'FAILED',
        },
      });
      candidateId = candidate.id;
    } catch (error) {
      console.error('Error creating candidate record:', error);
    }

    // Log the send attempt
    await prisma.sendLog.create({
      data: {
        userId: session.user.id,
        candidateId,
        toEmail: person.email,
        toName: person.fullName,
        company: person.company,
        subject: person.subject,
        body: person.body,
        status: sendResult.success ? 'SUCCESS' : 'FAILED',
        errorMessage: sendResult.error,
        gmailMessageId: sendResult.messageId,
      },
    });

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
