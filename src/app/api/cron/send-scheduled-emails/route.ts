import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendEmail, getUserTokens } from '@/lib/services/gmail';

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}

export async function POST(request: NextRequest) {
  return handleCronRequest(request);
}

async function handleCronRequest(request: NextRequest) {
  try {
    // Authenticate using CRON_SECRET
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[Cron] CRON_SECRET not configured');
      return NextResponse.json(
        { error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.error('[Cron] Unauthorized request');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Query for pending emails that are due or overdue
    const now = new Date();

    console.log('[Cron] Querying for scheduled emails...', {
      now: now.toISOString(),
    });

    // Query scheduled emails - process ALL overdue emails (no lower bound)
    const scheduledEmails = await prisma.scheduledEmail.findMany({
      where: {
        status: 'PENDING',
        scheduledFor: {
          lte: now,
        },
      },
    });

    if (!scheduledEmails || scheduledEmails.length === 0) {
      console.log('[Cron] No scheduled emails to process');
      return NextResponse.json(
        { processed: 0, message: 'No scheduled emails found' },
        { status: 200 }
      );
    }

    console.log(`[Cron] Found ${scheduledEmails.length} scheduled emails to process`);

    const results = [];

    for (const email of scheduledEmails) {
      try {
        console.log(`[Cron] Processing scheduled email ${email.id} for ${email.toEmail}`);

        // Get user's email
        const user = await prisma.user.findUnique({
          where: { id: email.userId },
          select: { email: true },
        });

        if (!user || !user.email) {
          console.error(`[Cron] User not found: ${email.userId}`);
          await prisma.scheduledEmail.update({
            where: { id: email.id },
            data: {
              status: 'FAILED',
              errorMessage: 'User not found',
            },
          });
          results.push({ id: email.id, success: false, error: 'User not found' });
          continue;
        }

        // Get user's OAuth tokens
        let accessToken: string;
        let refreshToken: string | undefined;
        try {
          const tokens = await getUserTokens(email.userId);
          accessToken = tokens.accessToken;
          refreshToken = tokens.refreshToken;
        } catch (error) {
          console.error(`[Cron] No OAuth token for user ${email.userId}`, error);
          await prisma.scheduledEmail.update({
            where: { id: email.id },
            data: {
              status: 'FAILED',
              errorMessage: 'No OAuth token found',
            },
          });
          results.push({ id: email.id, success: false, error: 'No OAuth token' });
          continue;
        }

        // Send email (resumeId will be handled by sendEmail function)
        const sendResult = await sendEmail(
          accessToken,
          refreshToken,
          user.email,
          email.toEmail,
          email.subject,
          email.body,
          email.resumeId || null,
          email.userId // Pass userId for token refresh
        );

        if (sendResult.success) {
          // Update ScheduledEmail status
          await prisma.scheduledEmail.update({
            where: { id: email.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
            },
          });

          // Create SendLog entry
          await prisma.sendLog.create({
            data: {
              userId: email.userId,
              userCandidateId: email.userCandidateId,
              toEmail: email.toEmail,
              subject: email.subject,
              body: email.body,
              resumeAttached: !!email.resumeId,
              resumeId: email.resumeId || null,
              status: 'SUCCESS',
              gmailMessageId: sendResult.messageId || null,
              gmailThreadId: sendResult.threadId || null,
            },
          });

          // Update EmailDraft status if exists
          await prisma.emailDraft.updateMany({
            where: {
              userCandidateId: email.userCandidateId,
            },
            data: {
              status: 'SENT',
            },
          });

          console.log(`[Cron] Successfully processed email ${email.id}`);
          results.push({ id: email.id, success: true });
        } else {
          // Mark as failed
          await prisma.scheduledEmail.update({
            where: { id: email.id },
            data: {
              status: 'FAILED',
              errorMessage: sendResult.error || 'Unknown error',
            },
          });

          // Create SendLog entry for failed attempt
          await prisma.sendLog.create({
            data: {
              userId: email.userId,
              userCandidateId: email.userCandidateId,
              toEmail: email.toEmail,
              subject: email.subject,
              body: email.body,
              resumeAttached: !!email.resumeId,
              resumeId: email.resumeId || null,
              status: 'FAILED',
              errorMessage: sendResult.error || 'Unknown error',
            },
          });

          console.error(`[Cron] Failed to process email ${email.id}:`, sendResult.error);
          results.push({ id: email.id, success: false, error: sendResult.error });
        }
      } catch (error) {
        console.error(`[Cron] Error processing email ${email.id}:`, error);
        // Mark as failed
        await prisma.scheduledEmail.update({
          where: { id: email.id },
          data: {
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        results.push({
          id: email.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json(
      {
        processed: scheduledEmails.length,
        results,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Cron] Fatal error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
