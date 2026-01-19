import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { EmailHistoryClient } from '@/components/history/EmailHistoryClient';
import { getInitialSendLogs } from '@/app/actions/sendlog';

export default async function HistoryPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/auth/signin');
  }

  // Fetch initial data on the server
  const initialData = await getInitialSendLogs(session.user.id);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <EmailHistoryClient
          initialLogs={initialData.success ? initialData.logs : []}
          initialCursor={initialData.success ? initialData.nextCursor : null}
          initialHasMore={initialData.success ? initialData.hasMore : false}
        />
      </main>
    </div>
  );
}
