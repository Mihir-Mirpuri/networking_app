import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * Cron job to clean up old processed notifications.
 * Pub/Sub won't retry notifications older than ~24 hours,
 * so we can safely delete records older than that.
 */
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
      console.error('[Cleanup Cron] CRON_SECRET not configured');
      return NextResponse.json(
        { error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.error('[Cleanup Cron] Unauthorized request');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Delete notifications older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    console.log('[Cleanup Cron] Deleting notifications older than:', twentyFourHoursAgo.toISOString());

    const result = await prisma.processed_notifications.deleteMany({
      where: {
        createdAt: {
          lt: twentyFourHoursAgo,
        },
      },
    });

    console.log(`[Cleanup Cron] Deleted ${result.count} old notifications`);

    return NextResponse.json(
      {
        deleted: result.count,
        cutoffTime: twentyFourHoursAgo.toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error('[Cleanup Cron] Fatal error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
