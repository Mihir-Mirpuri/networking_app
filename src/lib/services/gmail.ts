import { google } from 'googleapis';
import prisma from '@/lib/prisma';
import { createClient } from '@supabase/supabase-js';

const TEST_MODE = process.env.TEST_MODE === 'true';

interface SendResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
}

interface MimeMessageOptions {
  to: string;
  from: string;
  subject: string;
  body: string;
  attachment?: { filename: string; content: Buffer; mimeType: string };
  inReplyTo?: string; // Message-ID for threading
  references?: string; // Message-ID for threading
}

function createMimeMessage(
  to: string,
  from: string,
  subject: string,
  body: string,
  attachment?: { filename: string; content: Buffer; mimeType: string },
  inReplyTo?: string,
  references?: string
): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Build headers array
  const headers = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
  ];

  // Add threading headers if replying
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    headers.push(`References: ${references}`);
  }

  if (!attachment) {
    // Simple text message
    const message = [
      ...headers,
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
    ...headers,
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

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Gmail] Token refresh failed:', error);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[Gmail] Token refresh error:', error);
    return null;
  }
}

async function getValidAccessToken(
  account: { access_token: string; refresh_token: string | null; expires_at: number | null },
  userId: string,
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = account.expires_at || 0;
  
  // Check if token expires in next 5 minutes (proactive refresh)
  if (expiresAt && expiresAt > now + 300) {
    // Token is still valid for more than 5 minutes
    return account.access_token;
  }

  // Token expired or expiring soon, refresh it
  if (!account.refresh_token) {
    console.error('[Gmail] No refresh token available');
    return null;
  }

  console.log('[Gmail] Refreshing access token...');
  const newTokens = await refreshAccessToken(account.refresh_token, clientId, clientSecret);
  
  if (!newTokens) {
    return null;
  }

  // Update database with new token
  const newExpiresAt = now + newTokens.expires_in;
  await prisma.account.updateMany({
    where: {
      userId: userId,
      provider: 'google',
    },
    data: {
      access_token: newTokens.access_token,
      expires_at: newExpiresAt,
    },
  });

  return newTokens.access_token;
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
  resumeId?: string | null,
  userId?: string
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
    return { success: true, messageId: 'test-mode-' + Date.now(), threadId: 'test-thread-' + Date.now() };
  }

  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('[Gmail] Missing Google OAuth credentials');
      return {
        success: false,
        error: 'Google OAuth credentials not configured',
      };
    }

    // Get valid access token (proactive refresh if needed)
    let validToken = accessToken;
    if (userId) {
      const account = await prisma.account.findFirst({
        where: { userId, provider: 'google' },
        select: { access_token: true, refresh_token: true, expires_at: true },
      });

      if (account && account.access_token) {
        const refreshedToken = await getValidAccessToken(
          { ...account, access_token: account.access_token },
          userId,
          process.env.GOOGLE_CLIENT_ID!,
          process.env.GOOGLE_CLIENT_SECRET!
        );
        if (refreshedToken) {
          validToken = refreshedToken;
        } else {
          return {
            success: false,
            error: 'Failed to refresh access token',
          };
        }
      }
    }

    console.log('[Gmail] Creating OAuth2 client...');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: validToken,
      refresh_token: refreshToken,
    });

    console.log('[Gmail] Creating Gmail client...');
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    console.log('[Gmail] Creating MIME message...');
    const raw = createMimeMessage(toEmail, fromEmail, subject, body, attachment);

    console.log('[Gmail] Sending email via Gmail API...');
    
    // Try sending with retry logic for token refresh
    let lastError: Error | null = null;
    let retryCount = 0;
    const maxRetries = 1; // Only retry once for token refresh
    
    while (retryCount <= maxRetries) {
      try {
        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw },
        });

        console.log('[Gmail] Email sent successfully:', { messageId: response.data.id, threadId: response.data.threadId });
        return {
          success: true,
          messageId: response.data.id || undefined,
          threadId: response.data.threadId || undefined,
        };
      } catch (error: any) {
        lastError = error;
        
        // Token expired - try refreshing once
        if (error?.code === 401 && userId && refreshToken && retryCount === 0) {
          console.log('[Gmail] Token expired (401), refreshing...');
          const refreshedToken = await refreshAccessToken(
            refreshToken,
            process.env.GOOGLE_CLIENT_ID!,
            process.env.GOOGLE_CLIENT_SECRET!
          );
          
          if (refreshedToken) {
            // Update database
            const now = Math.floor(Date.now() / 1000);
            await prisma.account.updateMany({
              where: {
                userId: userId,
                provider: 'google',
              },
              data: {
                access_token: refreshedToken.access_token,
                expires_at: now + refreshedToken.expires_in,
              },
            });
            
            // Update OAuth client with new token
            oauth2Client.setCredentials({
              access_token: refreshedToken.access_token,
              refresh_token: refreshToken,
            });
            
            retryCount++;
            continue;
          }
        }
        
        // If not a token error or refresh failed, break
        break;
      }
    }

    // If we get here, sending failed
    console.error('[Gmail] Gmail send error:', lastError);
    console.error('[Gmail] Error details:', {
      message: lastError instanceof Error ? lastError.message : String(lastError),
      code: (lastError as any)?.code,
      status: (lastError as any)?.response?.status,
      statusText: (lastError as any)?.response?.statusText,
    });
    return {
      success: false,
      error: lastError instanceof Error ? lastError.message : 'Unknown error',
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

/**
 * Send a reply email in an existing thread
 */
export async function sendReplyEmail(
  accessToken: string,
  refreshToken: string | undefined,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string,
  threadId: string,
  originalMessageId?: string,
  resumeId?: string | null,
  userId?: string
): Promise<SendResult> {
  console.log('[Gmail] sendReplyEmail called:', { toEmail, fromEmail, threadId, originalMessageId, hasAccessToken: !!accessToken, hasRefreshToken: !!refreshToken, resumeId, TEST_MODE });

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
    console.log('=== TEST MODE: Reply Email would be sent ===');
    console.log(`To: ${toEmail}`);
    console.log(`From: ${fromEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`ThreadId: ${threadId}`);
    console.log(`In-Reply-To: ${originalMessageId}`);
    console.log(`Body: ${body}`);
    if (attachment) {
      console.log(`Attachment: ${attachment.filename} (${attachment.content.length} bytes, ${attachment.mimeType})`);
    }
    console.log('=====================================');
    return { success: true, messageId: 'test-mode-' + Date.now(), threadId: threadId };
  }

  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('[Gmail] Missing Google OAuth credentials');
      return {
        success: false,
        error: 'Google OAuth credentials not configured',
      };
    }

    // Get valid access token (proactive refresh if needed)
    let validToken = accessToken;
    if (userId) {
      const account = await prisma.account.findFirst({
        where: { userId, provider: 'google' },
        select: { access_token: true, refresh_token: true, expires_at: true },
      });

      if (account && account.access_token) {
        const refreshedToken = await getValidAccessToken(
          { ...account, access_token: account.access_token },
          userId,
          process.env.GOOGLE_CLIENT_ID!,
          process.env.GOOGLE_CLIENT_SECRET!
        );
        if (refreshedToken) {
          validToken = refreshedToken;
        } else {
          return {
            success: false,
            error: 'Failed to refresh access token',
          };
        }
      }
    }

    console.log('[Gmail] Creating OAuth2 client for reply...');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: validToken,
      refresh_token: refreshToken,
    });

    console.log('[Gmail] Creating Gmail client for reply...');
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Format the In-Reply-To and References headers
    const inReplyTo = originalMessageId ? `<${originalMessageId}>` : undefined;
    const references = originalMessageId ? `<${originalMessageId}>` : undefined;

    console.log('[Gmail] Creating MIME message for reply...');
    const raw = createMimeMessage(toEmail, fromEmail, subject, body, attachment, inReplyTo, references);

    console.log('[Gmail] Sending reply email via Gmail API...');

    // Try sending with retry logic for token refresh
    let lastError: Error | null = null;
    let retryCount = 0;
    const maxRetries = 1;

    while (retryCount <= maxRetries) {
      try {
        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw,
            threadId, // Include threadId to reply in the same thread
          },
        });

        console.log('[Gmail] Reply email sent successfully:', { messageId: response.data.id, threadId: response.data.threadId });
        return {
          success: true,
          messageId: response.data.id || undefined,
          threadId: response.data.threadId || undefined,
        };
      } catch (error: any) {
        lastError = error;

        // Token expired - try refreshing once
        if (error?.code === 401 && userId && refreshToken && retryCount === 0) {
          console.log('[Gmail] Token expired (401), refreshing...');
          const refreshedToken = await refreshAccessToken(
            refreshToken,
            process.env.GOOGLE_CLIENT_ID!,
            process.env.GOOGLE_CLIENT_SECRET!
          );

          if (refreshedToken) {
            const now = Math.floor(Date.now() / 1000);
            await prisma.account.updateMany({
              where: {
                userId: userId,
                provider: 'google',
              },
              data: {
                access_token: refreshedToken.access_token,
                expires_at: now + refreshedToken.expires_in,
              },
            });

            oauth2Client.setCredentials({
              access_token: refreshedToken.access_token,
              refresh_token: refreshToken,
            });

            retryCount++;
            continue;
          }
        }

        break;
      }
    }

    console.error('[Gmail] Gmail reply send error:', lastError);
    return {
      success: false,
      error: lastError instanceof Error ? lastError.message : 'Unknown error',
    };
  } catch (error) {
    console.error('[Gmail] Gmail reply send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
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
