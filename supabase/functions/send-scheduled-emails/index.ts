import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { google } from 'https://esm.sh/googleapis@126.0.0'

const TEST_MODE = Deno.env.get('TEST_MODE') === 'true';

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
  attachment?: { filename: string; content: Uint8Array; mimeType: string }
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

    const encoder = new TextEncoder();
    const bytes = encoder.encode(message);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Multipart message with attachment
  const attachmentBase64 = btoa(String.fromCharCode(...attachment.content));
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

  const encoder = new TextEncoder();
  const bytes = encoder.encode(message);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function downloadResumeFromStorage(
  supabase: any,
  resumeId: string
): Promise<{ filename: string; content: Uint8Array; mimeType: string } | null> {
  try {
    // Query database for resume info
    const { data: resume, error: resumeError } = await supabase
      .from('UserResume')
      .select('filename, fileUrl, mimeType')
      .eq('id', resumeId)
      .single();

    if (resumeError || !resume || !resume.fileUrl) {
      console.error(`[Edge] Resume ${resumeId} not found or has no fileUrl:`, resumeError);
      return null;
    }

    // Extract file path from URL
    const urlParts = resume.fileUrl.split('/');
    const fileName = urlParts.slice(-2).join('/');

    // Generate signed URL for private bucket
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('resumes')
      .createSignedUrl(fileName, 3600); // Valid for 1 hour

    if (signedUrlError || !signedUrlData) {
      console.error('[Edge] Failed to generate signed URL:', signedUrlError);
      return null;
    }

    // Download file
    const response = await fetch(signedUrlData.signedUrl);
    if (!response.ok) {
      console.error(`[Edge] Failed to download resume: ${response.statusText}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const content = new Uint8Array(arrayBuffer);

    return {
      filename: resume.filename,
      content,
      mimeType: resume.mimeType,
    };
  } catch (error) {
    console.error('[Edge] Error downloading resume:', error);
    return null;
  }
}

async function sendEmailViaGmail(
  accessToken: string,
  refreshToken: string | undefined,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string,
  attachment?: { filename: string; content: Uint8Array; mimeType: string }
): Promise<SendResult> {
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
    const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
    const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error('[Edge] Missing Google OAuth credentials');
      return {
        success: false,
        error: 'Google OAuth credentials not configured',
      };
    }

    console.log('[Edge] Creating OAuth2 client...');
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // Refresh token if needed
    try {
      const tokenInfo = await oauth2Client.getAccessToken();
      if (tokenInfo.token) {
        // Token was refreshed, update in database
        console.log('[Edge] Token refreshed successfully');
      }
    } catch (refreshError) {
      console.error('[Edge] Error refreshing token:', refreshError);
      return {
        success: false,
        error: 'Failed to refresh OAuth token',
      };
    }

    console.log('[Edge] Creating Gmail client...');
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    console.log('[Edge] Creating MIME message...');
    const raw = createMimeMessage(toEmail, fromEmail, subject, body, attachment);

    console.log('[Edge] Sending email via Gmail API...');
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    console.log('[Edge] Email sent successfully:', { messageId: response.data.id });
    return {
      success: true,
      messageId: response.data.id || undefined,
    };
  } catch (error) {
    console.error('[Edge] Gmail send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing Supabase credentials' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query for pending emails scheduled for now (within last minute to handle clock drift)
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    console.log('[Edge] Querying for scheduled emails...', {
      now: now.toISOString(),
      oneMinuteAgo: oneMinuteAgo.toISOString(),
    });

    // Query scheduled emails
    const { data: scheduledEmails, error: queryError } = await supabase
      .from('ScheduledEmail')
      .select('*')
      .eq('status', 'PENDING')
      .lte('scheduledFor', now.toISOString())
      .gte('scheduledFor', oneMinuteAgo.toISOString());

    if (queryError) {
      console.error('[Edge] Error querying scheduled emails:', queryError);
      return new Response(
        JSON.stringify({ error: queryError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!scheduledEmails || scheduledEmails.length === 0) {
      console.log('[Edge] No scheduled emails to process');
      return new Response(
        JSON.stringify({ processed: 0, message: 'No scheduled emails found' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Edge] Found ${scheduledEmails.length} scheduled emails to process`);

    const results = [];

    for (const email of scheduledEmails) {
      try {
        console.log(`[Edge] Processing scheduled email ${email.id} for ${email.toEmail}`);

        // Get user's email
        const { data: user, error: userError } = await supabase
          .from('User')
          .select('email')
          .eq('id', email.userId)
          .single();

        if (userError || !user) {
          console.error(`[Edge] User not found: ${email.userId}`, userError);
          await supabase
            .from('ScheduledEmail')
            .update({
              status: 'FAILED',
              errorMessage: 'User not found',
            })
            .eq('id', email.id);
          results.push({ id: email.id, success: false, error: 'User not found' });
          continue;
        }

        // Get user's Google account
        const { data: accounts, error: accountError } = await supabase
          .from('Account')
          .select('access_token, refresh_token, expires_at')
          .eq('userId', email.userId)
          .eq('provider', 'google')
          .limit(1);

        if (accountError || !accounts || accounts.length === 0 || !accounts[0].access_token) {
          console.error(`[Edge] No OAuth token for user ${email.userId}`, accountError);
          // Mark as failed
          await supabase
            .from('ScheduledEmail')
            .update({
              status: 'FAILED',
              errorMessage: 'No OAuth token found',
            })
            .eq('id', email.id);
          results.push({ id: email.id, success: false, error: 'No OAuth token' });
          continue;
        }

        const account = accounts[0];

        // Download resume if needed
        let attachment: { filename: string; content: Uint8Array; mimeType: string } | undefined;
        if (email.resumeId) {
          const resumeData = await downloadResumeFromStorage(supabase, email.resumeId);
          if (resumeData) {
            attachment = resumeData;
            console.log(`[Edge] Resume attachment loaded: ${resumeData.filename}`);
          } else {
            console.warn(`[Edge] Failed to load resume ${email.resumeId}, sending without attachment`);
          }
        }

        // Send email
        const sendResult = await sendEmailViaGmail(
          account.access_token,
          account.refresh_token || undefined,
          user.email || '',
          email.toEmail,
          email.subject,
          email.body,
          attachment
        );

        if (sendResult.success) {
          // Update ScheduledEmail status
          await supabase
            .from('ScheduledEmail')
            .update({
              status: 'SENT',
              sentAt: new Date().toISOString(),
            })
            .eq('id', email.id);

          // Create SendLog entry
          await supabase
            .from('SendLog')
            .insert({
              userId: email.userId,
              userCandidateId: email.userCandidateId,
              toEmail: email.toEmail,
              subject: email.subject,
              body: email.body,
              resumeAttached: !!email.resumeId,
              resumeId: email.resumeId || null,
              status: 'SUCCESS',
              gmailMessageId: sendResult.messageId || null,
            });

          // Increment daily count
          const { data: user } = await supabase
            .from('User')
            .select('dailySendCount, lastSendDate')
            .eq('id', email.userId)
            .single();

          if (user) {
            const today = new Date();
            const isNewDay = user.lastSendDate
              ? new Date(user.lastSendDate).toDateString() !== today.toDateString()
              : true;

            await supabase
              .from('User')
              .update({
                dailySendCount: isNewDay ? 1 : (user.dailySendCount || 0) + 1,
                lastSendDate: today.toISOString(),
              })
              .eq('id', email.userId);
          }

          // Update EmailDraft status if exists
          await supabase
            .from('EmailDraft')
            .update({ status: 'SENT' })
            .eq('userCandidateId', email.userCandidateId);

          console.log(`[Edge] Successfully processed email ${email.id}`);
          results.push({ id: email.id, success: true });
        } else {
          // Mark as failed
          await supabase
            .from('ScheduledEmail')
            .update({
              status: 'FAILED',
              errorMessage: sendResult.error || 'Unknown error',
            })
            .eq('id', email.id);

          // Create SendLog entry for failed attempt
          await supabase
            .from('SendLog')
            .insert({
              userId: email.userId,
              userCandidateId: email.userCandidateId,
              toEmail: email.toEmail,
              subject: email.subject,
              body: email.body,
              resumeAttached: !!email.resumeId,
              resumeId: email.resumeId || null,
              status: 'FAILED',
              errorMessage: sendResult.error || 'Unknown error',
            });

          console.error(`[Edge] Failed to process email ${email.id}:`, sendResult.error);
          results.push({ id: email.id, success: false, error: sendResult.error });
        }
      } catch (error) {
        console.error(`[Edge] Error processing email ${email.id}:`, error);
        // Mark as failed
        await supabase
          .from('ScheduledEmail')
          .update({
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', email.id);

        results.push({
          id: email.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return new Response(
      JSON.stringify({
        processed: scheduledEmails.length,
        results,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Edge] Fatal error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
