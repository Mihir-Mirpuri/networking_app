'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import {
  sendEmail,
  getUserTokens,
  checkDailyLimit,
  incrementDailyCount,
} from '@/lib/services/gmail';

const BATCH_LIMIT = 10;

interface SendResult {
  candidateId: string;
  success: boolean;
  error?: string;
}

export async function sendEmails(
  campaignId: string,
  candidateIds: string[]
): Promise<SendResult[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new Error('Unauthorized');
  }

  // Verify campaign ownership
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId: session.user.id },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  // Check daily limit
  const { canSend, remaining } = await checkDailyLimit(session.user.id);
  if (!canSend) {
    throw new Error('Daily send limit reached (30 emails per day)');
  }

  // Get user tokens
  const { accessToken, refreshToken } = await getUserTokens(session.user.id);

  // Limit to batch size
  const toSend = candidateIds.slice(0, Math.min(BATCH_LIMIT, remaining));

  // Get candidates with drafts
  const candidates = await prisma.candidate.findMany({
    where: {
      id: { in: toSend },
      campaignId,
    },
    include: { emailDraft: true },
  });

  const results: SendResult[] = [];

  for (const candidate of candidates) {
    // Verify sendability
    const canSendToCandidate =
      (candidate.emailStatus === 'VERIFIED' ||
        (candidate.emailStatus === 'MANUAL' && candidate.manualEmailConfirmed)) &&
      candidate.email &&
      candidate.emailDraft;

    if (!canSendToCandidate) {
      results.push({
        candidateId: candidate.id,
        success: false,
        error: 'Cannot send: email not verified or missing draft',
      });
      continue;
    }

    const { subject, body } = candidate.emailDraft!;

    const sendResult = await sendEmail(
      accessToken,
      refreshToken,
      session.user.email,
      candidate.email!,
      subject,
      body
    );

    // Log the send attempt
    await prisma.sendLog.create({
      data: {
        userId: session.user.id,
        candidateId: candidate.id,
        toEmail: candidate.email!,
        subject,
        body,
        status: sendResult.success ? 'SUCCESS' : 'FAILED',
        errorMessage: sendResult.error,
        gmailMessageId: sendResult.messageId,
      },
    });

    // Update candidate status
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        sendStatus: sendResult.success ? 'SENT' : 'FAILED',
      },
    });

    // Increment daily count on success
    if (sendResult.success) {
      await incrementDailyCount(session.user.id);
    }

    results.push({
      candidateId: candidate.id,
      success: sendResult.success,
      error: sendResult.error,
    });
  }

  revalidatePath(`/campaign/${campaignId}`);
  return results;
}
