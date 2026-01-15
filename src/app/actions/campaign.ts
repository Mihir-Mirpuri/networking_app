'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { addDiscoveryJob } from '@/lib/queue';

interface CreateCampaignInput {
  name: string;
  school: string;
  company: string;
  roleKeywords: string[];
}

export async function createCampaign(input: CreateCampaignInput) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const campaign = await prisma.campaign.create({
    data: {
      userId: session.user.id,
      name: input.name,
      school: input.school,
      company: input.company,
      roleKeywords: input.roleKeywords,
      status: 'DISCOVERING',
    },
  });

  // Queue discovery job
  await addDiscoveryJob(campaign.id);

  revalidatePath('/');
  return campaign;
}

export async function deleteCampaign(campaignId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  // Verify ownership
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId: session.user.id },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  // Delete campaign (cascades to candidates, source links, email drafts, send logs)
  await prisma.campaign.delete({
    where: { id: campaignId },
  });

  revalidatePath('/');
}

export async function updateCampaignTemplate(
  campaignId: string,
  templateSubject: string,
  templateBody: string
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId: session.user.id },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { templateSubject, templateBody },
  });

  // Regenerate all email drafts with new template
  const candidates = await prisma.candidate.findMany({
    where: { campaignId },
    include: { emailDraft: true },
  });

  for (const candidate of candidates) {
    const subject = fillTemplate(templateSubject, candidate, campaign);
    const body = fillTemplate(templateBody, candidate, campaign);

    if (candidate.emailDraft) {
      await prisma.emailDraft.update({
        where: { id: candidate.emailDraft.id },
        data: { subject, body },
      });
    } else {
      await prisma.emailDraft.create({
        data: {
          candidateId: candidate.id,
          subject,
          body,
        },
      });
    }
  }

  revalidatePath(`/campaign/${campaignId}`);
}

function fillTemplate(
  template: string,
  candidate: { firstName: string | null; fullName: string; company: string },
  campaign: { school: string; company: string }
): string {
  return template
    .replace(/{first_name}/g, candidate.firstName || 'there')
    .replace(/{full_name}/g, candidate.fullName)
    .replace(/{company}/g, campaign.company)
    .replace(/{school}/g, campaign.school);
}

export async function startEnrichment(campaignId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId: session.user.id },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'ENRICHING' },
  });

  const { addEnrichmentJob } = await import('@/lib/queue');
  await addEnrichmentJob(campaignId);

  revalidatePath(`/campaign/${campaignId}`);
}
