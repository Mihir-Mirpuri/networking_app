import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NewHeader } from '@/components/layout/NewHeader';
import { OutreachTrackerClient } from '@/components/outreach/OutreachTrackerClient';
import { getInitialOutreachTrackers, getOutreachStats, getInitialScheduledEmails } from '@/app/actions/outreach';
import { HistoryEmptyState } from '@/components/history/HistoryEmptyState';

export default async function HistoryPage() {
  const session = await getServerSession(authOptions);
  const isAuthenticated = !!session?.user;

  const defaultStats = {
    total: 0,
    sent: 0,
    waiting: 0,
    ongoingConversations: 0,
  };

  // Show empty state for guests
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#212121]">
        <NewHeader isAuthenticated={false} showLogo />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <HistoryEmptyState />
        </main>
      </div>
    );
  }

  // Fetch initial outreach data on the server for authenticated users
  const [trackersResult, statsResult, scheduledResult] = await Promise.all([
    getInitialOutreachTrackers(session.user.id),
    getOutreachStats(),
    getInitialScheduledEmails(session.user.id),
  ]);

  return (
    <div className="h-screen flex flex-col bg-[#212121] overflow-hidden">
      <NewHeader isAuthenticated={true} showLogo />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 overflow-hidden">
        <OutreachTrackerClient
          initialTrackers={trackersResult.success ? trackersResult.trackers : []}
          initialCursor={trackersResult.success ? trackersResult.nextCursor : null}
          initialHasMore={trackersResult.success ? trackersResult.hasMore : false}
          initialStats={statsResult.success ? statsResult.stats : defaultStats}
          initialScheduledEmails={scheduledResult.success ? scheduledResult.emails : []}
        />
      </main>
    </div>
  );
}
