'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function updateCandidateEmail(
  candidateId: string,
  email: string,
  confirmed: boolean
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  // Verify ownership
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { campaign: true },
  });

  if (!candidate || candidate.campaign.userId !== session.user.id) {
    throw new Error('Candidate not found');
  }

  await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      email: email || null,
      emailStatus: email ? 'MANUAL' : 'MISSING',
      manualEmailConfirmed: confirmed,
    },
  });

  revalidatePath(`/campaign/${candidate.campaignId}`);
}

export async function updateEmailDraft(
  candidateId: string,
  subject: string,
  body: string
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  // Verify ownership
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { campaign: true, emailDraft: true },
  });

  if (!candidate || candidate.campaign.userId !== session.user.id) {
    throw new Error('Candidate not found');
  }

  if (candidate.emailDraft) {
    await prisma.emailDraft.update({
      where: { id: candidate.emailDraft.id },
      data: { subject, body },
    });
  } else {
    await prisma.emailDraft.create({
      data: {
        candidateId,
        subject,
        body,
      },
    });
  }

  revalidatePath(`/campaign/${candidate.campaignId}`);
}
