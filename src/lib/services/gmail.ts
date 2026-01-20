import { google } from 'googleapis';
import prisma from '@/lib/prisma';
import { createClient } from '@supabase/supabase-js';

const TEST_MODE = process.env.TEST_MODE === 'true';

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function createMimeMessage(
  to: string,
  from: string,
  subject: string,
  body: string,
  attachment?: { filename: string; content: Buffer; mimeType: string }
): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (!attachment) {
    // Simple text message
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

  // Multipart message with attachment
  const attachmentBase64 = attachment.content.toString('base64');
  const attachmentLines = attachmentBase64.match(/.{1,76}/g) || [];
  const attachmentBody = attachmentLines.join('\r\n');

  const message = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
    '',
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    attachmentBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function downloadResumeFromStorage(resumeId: string): Promise<{ filename: string; content: Buffer; mimeType: string } | null> {
  try {
    const resume = await prisma.userResume.findUnique({
      where: { id: resumeId },
      select: { filename: true, fileUrl: true, mimeType: true },
    });

    if (!resume || !resume.fileUrl) {
      console.error(`[Gmail] Resume ${resumeId} not found or has no fileUrl`);
      return null;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[Gmail] Supabase credentials not configured');
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Extract file path from URL
    const urlParts = resume.fileUrl.split('/');
    const fileName = urlParts.slice(-2).join('/');

    // Generate signed URL for private bucket
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('resumes')
      .createSignedUrl(fileName, 3600); // Valid for 1 hour

    if (signedUrlError || !signedUrlData) {
      console.error('[Gmail] Failed to generate signed URL:', signedUrlError);
      return null;
    }

    // Download file
    const response = await fetch(signedUrlData.signedUrl);
    if (!response.ok) {
      console.error(`[Gmail] Failed to download resume: ${response.statusText}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    return {
      filename: resume.filename,
      content,
      mimeType: resume.mimeType,
    };
  } catch (error) {
    console.error('[Gmail] Error downloading resume:', error);
    return null;
  }
}

export async function sendEmail(
  accessToken: string,
  refreshToken: string | undefined,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string,
  resumeId?: string | null
): Promise<SendResult> {
  console.log('[Gmail] sendEmail called:', { toEmail, fromEmail, hasAccessToken: !!accessToken, hasRefreshToken: !!refreshToken, resumeId, TEST_MODE });
  
  // Download attachment if resumeId is provided
  let attachment: { filename: string; content: Buffer; mimeType: string } | undefined;
  if (resumeId) {
    const resumeData = await downloadResumeFromStorage(resumeId);
    if (resumeData) {
      attachment = resumeData;
      console.log(`[Gmail] Resume attachment loaded: ${resumeData.filename} (${resumeData.content.length} bytes, ${resumeData.mimeType})`);
    } else {
      console.warn(`[Gmail] Failed to load resume ${resumeId}, sending email without attachment`);
    }
  }
  
  if (TEST_MODE) {
    console.log('=== TEST MODE: Email would be sent ===');
    console.log(`To: ${toEmail}`);
    console.log(`From: ${fromEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);
    if (attachment) {
      console.log(`Attachment: ${attachment.filename} (${attachment.content.length} bytes, ${attachment.mimeType})`);
    }
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
    const raw = createMimeMessage(toEmail, fromEmail, subject, body, attachment);

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
