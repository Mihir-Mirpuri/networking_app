'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export interface SendLogEntry {
  id: string;
  toEmail: string;
  toName: string | null;
  company: string | null;
  subject: string;
  body: string;
  status: 'SUCCESS' | 'FAILED';
  sentAt: Date;
}

export async function getSendLogs(
  searchQuery?: string,
  limit: number = 50
): Promise<{ success: true; logs: SendLogEntry[] } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const logs = await prisma.sendLog.findMany({
      where: {
        userId: session.user.id,
        ...(searchQuery
          ? {
              OR: [
                { toEmail: { contains: searchQuery, mode: 'insensitive' } },
                { toName: { contains: searchQuery, mode: 'insensitive' } },
                { company: { contains: searchQuery, mode: 'insensitive' } },
                { subject: { contains: searchQuery, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { sentAt: 'desc' },
      take: limit,
      select: {
        id: true,
        toEmail: true,
        toName: true,
        company: true,
        subject: true,
        body: true,
        status: true,
        sentAt: true,
      },
    });

    return { success: true, logs };
  } catch (error) {
    console.error('Error fetching send logs:', error);
    return { success: false, error: 'Failed to fetch send logs' };
  }
}
