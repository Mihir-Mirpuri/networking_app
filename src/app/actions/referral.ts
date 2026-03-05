'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function processReferralAction(code: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { referralLinkId: true, createdAt: true },
  });

  // Already attributed
  if (user?.referralLinkId) return;

  // Only attribute users created within the last hour
  if (!user || Date.now() - user.createdAt.getTime() > 10 * 60 * 1000) return;

  const link = await prisma.referralLink.findUnique({
    where: { code },
    select: { id: true, isActive: true },
  });

  if (!link || !link.isActive) return;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: { referralLinkId: link.id },
    }),
    prisma.referralLink.update({
      where: { id: link.id },
      data: { signupCount: { increment: 1 } },
    }),
  ]);
}

export async function getIsAmbassadorAction(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return false;

  const link = await prisma.referralLink.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  });

  return !!link;
}
