import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startMailboxWatch } from '@/lib/gmail/client';

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
      console.error('[Watch Cron] CRON_SECRET not configured');
      return NextResponse.json(
        { error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.error('[Watch Cron] Unauthorized request');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get Pub/Sub topic
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
    if (!topicName) {
      console.error('[Watch Cron] GOOGLE_PUBSUB_TOPIC not configured');
      return NextResponse.json(
        { error: 'Pub/Sub topic not configured' },
        { status: 500 }
      );
    }

    // Query for users whose watch expires within 24 hours
    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    console.log('[Watch Cron] Querying for expiring watches...', {
      now: now.toISOString(),
      expirationThreshold: twentyFourHoursFromNow.toISOString(),
    });

    const expiringWatches = await prisma.gmail_sync_state.findMany({
      where: {
        watch_expiration: {
          lte: twentyFourHoursFromNow,
        },
      },
      select: {
        userId: true,
        email_address: true,
        watch_expiration: true,
      },
    });

    if (!expiringWatches || expiringWatches.length === 0) {
      console.log('[Watch Cron] No watches need renewal');
      return NextResponse.json(
        { renewed: 0, message: 'No watches need renewal' },
        { status: 200 }
      );
    }

    console.log(`[Watch Cron] Found ${expiringWatches.length} watches to renew`);

    const results: Array<{
      userId: string;
      email: string;
      success: boolean;
      error?: string;
      newExpiration?: string;
    }> = [];

    for (const watch of expiringWatches) {
      try {
        console.log(`[Watch Cron] Renewing watch for ${watch.email_address} (${watch.userId})`);

        // Call startMailboxWatch which handles:
        // - Getting Gmail client
        // - Calling gmail.users.watch()
        // - Updating gmail_sync_state with new expiration and historyId
        const watchResponse = await startMailboxWatch(watch.userId, topicName);

        const newExpiration = new Date(parseInt(watchResponse.expiration, 10));

        console.log(`[Watch Cron] Successfully renewed watch for ${watch.email_address}`, {
          newExpiration: newExpiration.toISOString(),
          historyId: watchResponse.historyId,
        });

        results.push({
          userId: watch.userId,
          email: watch.email_address,
          success: true,
          newExpiration: newExpiration.toISOString(),
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Watch Cron] Failed to renew watch for ${watch.email_address}:`, errorMessage);

        results.push({
          userId: watch.userId,
          email: watch.email_address,
          success: false,
          error: errorMessage,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`[Watch Cron] Completed: ${successCount} renewed, ${failCount} failed`);

    return NextResponse.json(
      {
        renewed: successCount,
        failed: failCount,
        total: expiringWatches.length,
        results,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error('[Watch Cron] Fatal error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
