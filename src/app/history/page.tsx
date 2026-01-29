import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { OutreachTrackerClient } from '@/components/outreach/OutreachTrackerClient';
import { getInitialOutreachTrackers, getOutreachStats } from '@/app/actions/outreach';

export default async function HistoryPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/auth/signin');
  }

  // Fetch initial outreach data on the server
  const [trackersResult, statsResult] = await Promise.all([
    getInitialOutreachTrackers(session.user.id),
    getOutreachStats(),
  ]);

  const defaultStats = {
    sent: 0,
    waiting: 0,
    ongoingConversations: 0,
    connected: 0,
    upcomingReminders: 0,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <OutreachTrackerClient
          initialTrackers={trackersResult.success ? trackersResult.trackers : []}
          initialCursor={trackersResult.success ? trackersResult.nextCursor : null}
          initialHasMore={trackersResult.success ? trackersResult.hasMore : false}
          initialStats={statsResult.success ? statsResult.stats : defaultStats}
        />
      </main>
    </div>
  );
}
