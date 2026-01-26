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

export interface SendComposedEmailInput {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  body: string;
  attachResume?: boolean;
  resumeId?: string;
}

export interface SendComposedEmailResult {
  success: true;
  messageId: string;
  threadId: string;
}

export interface SendComposedEmailError {
  success: false;
  error: string;
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export async function sendComposedEmailAction(
  input: SendComposedEmailInput
): Promise<SendComposedEmailResult | SendComposedEmailError> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email || !session.user.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Validate email format
  if (!input.recipientEmail || !isValidEmail(input.recipientEmail)) {
    return { success: false, error: 'Invalid email address' };
  }

  // Validate subject and body
  if (!input.subject?.trim()) {
    return { success: false, error: 'Subject is required' };
  }

  if (!input.body?.trim()) {
    return { success: false, error: 'Email body is required' };
  }

  // Check daily limit
  const { canSend, remaining } = await checkDailyLimit(session.user.id);
  if (!canSend) {
    return { success: false, error: 'Daily send limit reached (30 emails per day)' };
  }

  // Validate resumeId belongs to user if provided
  if (input.attachResume && input.resumeId) {
    const resume = await prisma.userResume.findUnique({
      where: { id: input.resumeId },
      select: { userId: true },
    });

    if (!resume || resume.userId !== session.user.id) {
      return { success: false, error: 'Invalid resume selected' };
    }
  }

  // Get user tokens
  let accessToken: string;
  let refreshToken: string | undefined;
  try {
    const tokens = await getUserTokens(session.user.id);
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get authentication tokens',
    };
  }

  console.log('[Compose] Sending composed email to:', input.recipientEmail);

  // Send the email
  const sendResult = await sendEmail(
    accessToken,
    refreshToken,
    session.user.email,
    input.recipientEmail,
    input.subject,
    input.body,
    input.attachResume ? input.resumeId : undefined,
    session.user.id
  );

  // Log the send attempt (with direct recipient fields since no UserCandidate)
  await prisma.sendLog.create({
    data: {
      userId: session.user.id,
      userCandidateId: null,
      toEmail: input.recipientEmail,
      subject: input.subject,
      body: input.body,
      resumeAttached: !!(input.attachResume && input.resumeId),
      resumeId: input.attachResume ? (input.resumeId || null) : null,
      status: sendResult.success ? 'SUCCESS' : 'FAILED',
      errorMessage: sendResult.error,
      gmailMessageId: sendResult.messageId,
      gmailThreadId: sendResult.threadId,
      directRecipientEmail: input.recipientEmail,
      directRecipientName: input.recipientName || null,
    },
  });

  // Increment daily count on success
  if (sendResult.success) {
    await incrementDailyCount(session.user.id);
  }

  if (!sendResult.success) {
    return { success: false, error: sendResult.error || 'Failed to send email' };
  }

  return {
    success: true,
    messageId: sendResult.messageId || '',
    threadId: sendResult.threadId || '',
  };
}
