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

export interface GetSendLogsResult {
  success: true;
  logs: SendLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface GetSendLogsError {
  success: false;
  error: string;
}

const PAGE_SIZE = 20;

export async function getSendLogs(
  searchQuery?: string,
  cursor?: string
): Promise<GetSendLogsResult | GetSendLogsError> {
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
                { subject: { contains: searchQuery, mode: 'insensitive' } },
                {
                  userCandidate: {
                    person: {
                      OR: [
                        { fullName: { contains: searchQuery, mode: 'insensitive' } },
                        { company: { contains: searchQuery, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        userCandidate: {
          include: {
            person: true,
          },
        },
      },
      orderBy: { sentAt: 'desc' },
      take: PAGE_SIZE + 1, // Fetch one extra to check if there are more
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1, // Skip the cursor itself
          }
        : {}),
    });

    // Check if there are more results
    const hasMore = logs.length > PAGE_SIZE;
    const logsToReturn = hasMore ? logs.slice(0, PAGE_SIZE) : logs;
    const nextCursor = hasMore ? logsToReturn[logsToReturn.length - 1].id : null;

    // Transform to match expected interface
    const transformedLogs: SendLogEntry[] = logsToReturn.map((log) => ({
      id: log.id,
      toEmail: log.toEmail,
      toName: log.userCandidate.person.fullName,
      company: log.userCandidate.person.company,
      subject: log.subject,
      body: log.body,
      status: log.status,
      sentAt: log.sentAt,
    }));

    return { success: true, logs: transformedLogs, nextCursor, hasMore };
  } catch (error) {
    console.error('Error fetching send logs:', error);
    return { success: false, error: 'Failed to fetch send logs' };
  }
}

// Server-side function to get initial logs (for page.tsx)
export async function getInitialSendLogs(userId: string): Promise<GetSendLogsResult | GetSendLogsError> {
  try {
    const logs = await prisma.sendLog.findMany({
      where: {
        userId: userId,
      },
      include: {
        userCandidate: {
          include: {
            person: true,
          },
        },
      },
      orderBy: { sentAt: 'desc' },
      take: PAGE_SIZE + 1,
    });

    const hasMore = logs.length > PAGE_SIZE;
    const logsToReturn = hasMore ? logs.slice(0, PAGE_SIZE) : logs;
    const nextCursor = hasMore ? logsToReturn[logsToReturn.length - 1].id : null;

    const transformedLogs: SendLogEntry[] = logsToReturn.map((log) => ({
      id: log.id,
      toEmail: log.toEmail,
      toName: log.userCandidate.person.fullName,
      company: log.userCandidate.person.company,
      subject: log.subject,
      body: log.body,
      status: log.status,
      sentAt: log.sentAt,
    }));

    return { success: true, logs: transformedLogs, nextCursor, hasMore };
  } catch (error) {
    console.error('Error fetching initial send logs:', error);
    return { success: false, error: 'Failed to fetch send logs' };
  }
}
