import { google } from 'googleapis';
import prisma from '@/lib/prisma';

const TEST_MODE = process.env.TEST_MODE === 'true';

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function createMimeMessage(to: string, from: string, subject: string, body: string): string {
  const message = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendEmail(
  accessToken: string,
  refreshToken: string | undefined,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string
): Promise<SendResult> {
  if (TEST_MODE) {
    console.log('=== TEST MODE: Email would be sent ===');
    console.log(`To: ${toEmail}`);
    console.log(`From: ${fromEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);
    console.log('=====================================');
    return { success: true, messageId: 'test-mode-' + Date.now() };
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const raw = createMimeMessage(toEmail, fromEmail, subject, body);

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return {
      success: true,
      messageId: response.data.id || undefined,
    };
  } catch (error) {
    console.error('Gmail send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getUserTokens(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'google' },
  });

  if (!account?.access_token) {
    throw new Error('No Google account linked');
  }

  return {
    accessToken: account.access_token,
    refreshToken: account.refresh_token || undefined,
  };
}

export async function checkDailyLimit(userId: string): Promise<{ canSend: boolean; remaining: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailySendCount: true, lastSendDate: true },
  });

  const today = new Date().toDateString();
  const lastSendDate = user?.lastSendDate?.toDateString();

  // Reset count if new day
  if (lastSendDate !== today) {
    return { canSend: true, remaining: 30 };
  }

  const remaining = 30 - (user?.dailySendCount || 0);
  return { canSend: remaining > 0, remaining };
}

export async function incrementDailyCount(userId: string) {
  const today = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailySendCount: true, lastSendDate: true },
  });

  const isNewDay = user?.lastSendDate?.toDateString() !== today.toDateString();

  await prisma.user.update({
    where: { id: userId },
    data: {
      dailySendCount: isNewDay ? 1 : (user?.dailySendCount || 0) + 1,
      lastSendDate: today,
    },
  });
}
