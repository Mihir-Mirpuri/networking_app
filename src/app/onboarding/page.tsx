import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { OnboardingClient } from '@/components/onboarding/OnboardingClient';

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/auth/signin');
  }

  // Check if user has already completed onboarding
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { onboardingCompleted: true, name: true },
  });

  if (user?.onboardingCompleted) {
    redirect('/');
  }

  return <OnboardingClient userName={user?.name ?? null} />;
}
