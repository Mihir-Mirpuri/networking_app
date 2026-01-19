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
  console.log('[Gmail] sendEmail called:', { toEmail, fromEmail, hasAccessToken: !!accessToken, hasRefreshToken: !!refreshToken, TEST_MODE });
  
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
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('[Gmail] Missing Google OAuth credentials');
      return {
        success: false,
        error: 'Google OAuth credentials not configured',
      };
    }

    console.log('[Gmail] Creating OAuth2 client...');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    console.log('[Gmail] Creating Gmail client...');
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    console.log('[Gmail] Creating MIME message...');
    const raw = createMimeMessage(toEmail, fromEmail, subject, body);

    console.log('[Gmail] Sending email via Gmail API...');
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    console.log('[Gmail] Email sent successfully:', { messageId: response.data.id });
    return {
      success: true,
      messageId: response.data.id || undefined,
    };
  } catch (error) {
    console.error('[Gmail] Gmail send error:', error);
    console.error('[Gmail] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      code: (error as any)?.code,
      status: (error as any)?.response?.status,
      statusText: (error as any)?.response?.statusText,
    });
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
