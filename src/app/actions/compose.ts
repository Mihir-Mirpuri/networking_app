'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import {
  sendEmail,
  getUserTokens,
  checkDailyLimit,
  incrementDailyCount,
  EmailAttachment,
} from '@/lib/services/gmail';

// Max file size: 10MB (Gmail limit is 25MB but we'll be conservative)
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

export interface FileAttachmentInput {
  filename: string;
  content: string; // base64 encoded
  mimeType: string;
  size: number;
}

export interface SendComposedEmailInput {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  body: string;
  attachResume?: boolean;
  resumeId?: string;
  attachments?: FileAttachmentInput[];
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

  // Validate file attachments
  const additionalAttachments: EmailAttachment[] = [];
  if (input.attachments && input.attachments.length > 0) {
    if (input.attachments.length > MAX_ATTACHMENTS) {
      return { success: false, error: `Maximum ${MAX_ATTACHMENTS} attachments allowed` };
    }

    for (const file of input.attachments) {
      if (file.size > MAX_FILE_SIZE) {
        return { success: false, error: `File "${file.filename}" exceeds 10MB limit` };
      }

      try {
        const content = Buffer.from(file.content, 'base64');
        additionalAttachments.push({
          filename: file.filename,
          content,
          mimeType: file.mimeType,
        });
      } catch {
        return { success: false, error: `Invalid file data for "${file.filename}"` };
      }
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
    session.user.id,
    additionalAttachments.length > 0 ? additionalAttachments : undefined
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
