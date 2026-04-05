import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OutreachTrackerClient } from '@/components/outreach/OutreachTrackerClient';
import { getInitialOutreachTrackers, getOutreachStats, getInitialScheduledEmails, getHistorySidebarStats } from '@/app/actions/outreach';
import { HistoryEmptyState } from '@/components/history/HistoryEmptyState';

export default async function HistoryPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }

  // Fetch initial outreach data on the server
  const [trackersResult, statsResult, scheduledResult, sidebarStatsResult] = await Promise.all([
    getInitialOutreachTrackers(session.user.id),
    getOutreachStats(),
    getInitialScheduledEmails(session.user.id),
    getHistorySidebarStats(),
  ]);

  const defaultStats = {
    total: 0,
    sent: 0,
    waiting: 0,
    ongoingConversations: 0,
  };

  const defaultSidebarStats = {
    totalEmailsSent: 0,
    totalTrackers: 0,
    emailsSentThisWeek: 0,
    emailsSentThisMonth: 0,
    avgEmailsPerWeek: 0,
    currentSendingStreak: 0,
    mostRecentSendDate: null,
    responsesReceived: 0,
    scheduledEmailsPending: 0,
    savedForLaterCount: 0,
    starredCount: 0,
  };

  return (
    <div className="h-screen flex bg-[#212121] overflow-hidden">
      <main className="flex-1 flex overflow-hidden">
        <OutreachTrackerClient
          initialTrackers={trackersResult.success ? trackersResult.trackers : []}
          initialCursor={trackersResult.success ? trackersResult.nextCursor : null}
          initialHasMore={trackersResult.success ? trackersResult.hasMore : false}
          initialStats={statsResult.success ? statsResult.stats : defaultStats}
          initialScheduledEmails={scheduledResult.success ? scheduledResult.emails : []}
          initialSidebarStats={sidebarStatsResult.success ? sidebarStatsResult.stats : defaultSidebarStats}
        />
      </main>
    </div>
  );
}
