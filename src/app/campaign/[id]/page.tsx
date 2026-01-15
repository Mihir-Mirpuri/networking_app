import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { Header } from '@/components/Header';
import { CampaignHeader } from '@/components/campaign/CampaignHeader';
import { TemplateEditor } from '@/components/campaign/TemplateEditor';
import { CandidateTable } from '@/components/campaign/CandidateTable';

interface PageProps {
  params: { id: string };
}

export default async function CampaignPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/auth/signin');
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, userId: session.user.id },
    include: {
      candidates: {
        include: {
          sourceLinks: true,
          emailDraft: true,
          sendLogs: {
            orderBy: { sentAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { fullName: 'asc' },
      },
    },
  });

  if (!campaign) {
    notFound();
  }

  // Get user's daily send count
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { dailySendCount: true, lastSendDate: true },
  });

  const today = new Date().toDateString();
  const lastSendDate = user?.lastSendDate?.toDateString();
  const dailySendCount = lastSendDate === today ? (user?.dailySendCount || 0) : 0;
  const remainingDaily = Math.max(0, 30 - dailySendCount);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CampaignHeader campaign={campaign} />
        <TemplateEditor campaign={campaign} />
        <CandidateTable
          campaign={campaign}
          candidates={campaign.candidates}
          remainingDaily={remainingDaily}
        />
      </main>
    </div>
  );
}
