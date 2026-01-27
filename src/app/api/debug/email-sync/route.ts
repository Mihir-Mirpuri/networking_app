import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { syncUserMailbox } from '@/lib/services/email-sync';

/**
 * Debug endpoint to check email sync status and manually trigger sync
 * GET - Check gmail_sync_state and related data
 * POST - Manually trigger sync
 */

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = session.user.id;

    // Get gmail_sync_state
    const syncState = await prisma.gmail_sync_state.findUnique({
      where: { userId },
    });

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    // Get account (check for refresh token)
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'google' },
      select: {
        access_token: true,
        refresh_token: true,
        expires_at: true,
      },
    });

    // Get recent SendLogs with threadIds
    const recentSendLogs = await prisma.sendLog.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      take: 5,
      select: {
        id: true,
        toEmail: true,
        gmailMessageId: true,
        gmailThreadId: true,
        status: true,
        sentAt: true,
      },
    });

    // Get messages count
    const messagesCount = await prisma.messages.count({
      where: { userId },
    });

    // Get conversations count
    const conversationsCount = await prisma.conversations.count({
      where: { userId },
    });

    return NextResponse.json({
      status: 'ok',
      user: {
        id: user?.id,
        email: user?.email,
        name: user?.name,
      },
      account: {
        hasAccessToken: !!account?.access_token,
        hasRefreshToken: !!account?.refresh_token,
        expiresAt: account?.expires_at
          ? new Date(account.expires_at * 1000).toISOString()
          : null,
      },
      gmailSyncState: syncState
        ? {
            historyId: syncState.historyId,
            email_address: syncState.email_address,
            watch_expiration: syncState.watch_expiration?.toISOString(),
            watchActive: syncState.watch_expiration
              ? syncState.watch_expiration > new Date()
              : false,
          }
        : null,
      recentSendLogs,
      counts: {
        messages: messagesCount,
        conversations: conversationsCount,
      },
      diagnosis: getDiagnosis(syncState, account),
    });
  } catch (error) {
    console.error('[Debug] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = session.user.id;
    console.log(`[Debug] Manually triggering sync for userId: ${userId}`);

    const result = await syncUserMailbox({ userId });

    return NextResponse.json({
      status: 'sync_triggered',
      result,
    });
  } catch (error) {
    console.error('[Debug] Sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function getDiagnosis(
  syncState: { historyId: string | null; watch_expiration: Date | null } | null,
  account: { refresh_token: string | null } | null
): string[] {
  const issues: string[] = [];

  if (!account?.refresh_token) {
    issues.push('CRITICAL: No refresh token - user needs to sign out and back in with Google');
  }

  if (!syncState) {
    issues.push('CRITICAL: No gmail_sync_state - Gmail watch never started. Sign out and back in.');
  } else {
    if (!syncState.historyId) {
      issues.push('WARNING: No historyId stored - sync may not work correctly');
    }
    if (!syncState.watch_expiration) {
      issues.push('WARNING: No watch_expiration - watch may not be active');
    } else if (syncState.watch_expiration < new Date()) {
      issues.push('CRITICAL: Watch expired - notifications not being received. Sign out and back in.');
    }
  }

  if (issues.length === 0) {
    issues.push('OK: Configuration looks correct. Check Vercel logs for webhook activity.');
  }

  return issues;
}
