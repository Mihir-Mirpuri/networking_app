import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppWrapper } from '@/components/layout/AppWrapper';
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

export default async function AppPage() {
  const session = await getServerSession(authOptions);

  // Require authentication
  if (!session?.user?.id) {
    redirect('/');
  }

  // Check account and onboarding
  const account = await prisma.account.findFirst({
    where: {
      userId: session.user.id,
      provider: 'google',
    },
  });

  if (!account) {
    await prisma.session.deleteMany({
      where: { userId: session.user.id },
    });
    redirect('/');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { onboardingCompleted: true },
  });

  if (!user?.onboardingCompleted) {
    redirect('/onboarding');
  }

  const remainingDaily = await getRemainingDailyLimit(session.user.id);

  return <AppWrapper initialRemainingDaily={remainingDaily} />;
}
