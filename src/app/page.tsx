import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Header } from '@/components/Header';
import { SearchPageClient } from '@/components/search/SearchPageClient';
import prisma from '@/lib/prisma';

const DAILY_LIMIT = 30;

async function getRemainingDailyLimit(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailySendCount: true, lastSendDate: true },
  });

  if (!user) return DAILY_LIMIT;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!user.lastSendDate || new Date(user.lastSendDate) < today) {
    return DAILY_LIMIT;
  }

  return Math.max(0, DAILY_LIMIT - user.dailySendCount);
}

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/auth/signin');
  }

  // For testing: Force re-authentication if Account record doesn't exist
  // This ensures users get new OAuth tokens with updated scopes
  const account = await prisma.account.findFirst({
    where: {
      userId: session.user.id,
      provider: 'google',
    },
  });

  if (!account) {
    // Clear session and force re-authentication
    await prisma.session.deleteMany({
      where: { userId: session.user.id },
    });
    redirect('/auth/signin');
  }

  const remainingDaily = await getRemainingDailyLimit(session.user.id);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Find Connections</h1>
        <SearchPageClient initialRemainingDaily={remainingDaily} />
      </main>
    </div>
  );
}
