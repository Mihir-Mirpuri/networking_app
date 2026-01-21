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
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  sentAt: Date;
  scheduledFor?: Date | null;
  isScheduled?: boolean;
  scheduledEmailId?: string; // For editing/canceling scheduled emails
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
    // Fetch send logs
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
    });

    // Fetch scheduled emails (PENDING only)
    const scheduledEmails = await prisma.scheduledEmail.findMany({
      where: {
        userId: session.user.id,
        status: 'PENDING',
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
      orderBy: { scheduledFor: 'asc' },
    });

    // Transform send logs
    const transformedLogs: SendLogEntry[] = logs.map((log) => ({
      id: log.id,
      toEmail: log.toEmail,
      toName: log.userCandidate.person.fullName,
      company: log.userCandidate.person.company,
      subject: log.subject,
      body: log.body,
      status: log.status,
      sentAt: log.sentAt,
      isScheduled: false,
    }));

    // Transform scheduled emails
    const transformedScheduled: SendLogEntry[] = scheduledEmails.map((email) => ({
      id: email.id,
      toEmail: email.toEmail,
      toName: email.userCandidate.person.fullName,
      company: email.userCandidate.person.company,
      subject: email.subject,
      body: email.body,
      status: 'PENDING' as const,
      sentAt: email.scheduledFor, // Use scheduledFor as sentAt for sorting
      scheduledFor: email.scheduledFor,
      isScheduled: true,
      scheduledEmailId: email.id,
    }));

    // Combine and sort by date (most recent first, then future scheduled)
    const allLogs = [...transformedLogs, ...transformedScheduled].sort((a, b) => {
      return b.sentAt.getTime() - a.sentAt.getTime();
    });

    // Apply pagination
    const startIndex = cursor ? allLogs.findIndex(log => log.id === cursor) + 1 : 0;
    const paginatedLogs = allLogs.slice(startIndex, startIndex + PAGE_SIZE + 1);
    
    const hasMore = paginatedLogs.length > PAGE_SIZE;
    const logsToReturn = hasMore ? paginatedLogs.slice(0, PAGE_SIZE) : paginatedLogs;
    const nextCursor = hasMore ? logsToReturn[logsToReturn.length - 1].id : null;

    return { success: true, logs: logsToReturn, nextCursor, hasMore };
  } catch (error) {
    console.error('Error fetching send logs:', error);
    return { success: false, error: 'Failed to fetch send logs' };
  }
}

// Server-side function to get initial logs (for page.tsx)
export async function getInitialSendLogs(userId: string): Promise<GetSendLogsResult | GetSendLogsError> {
  try {
    // Fetch send logs
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
    });

    // Fetch scheduled emails (PENDING only)
    const scheduledEmails = await prisma.scheduledEmail.findMany({
      where: {
        userId: userId,
        status: 'PENDING',
      },
      include: {
        userCandidate: {
          include: {
            person: true,
          },
        },
      },
      orderBy: { scheduledFor: 'asc' },
    });

    // Transform send logs
    const transformedLogs: SendLogEntry[] = logs.map((log) => ({
      id: log.id,
      toEmail: log.toEmail,
      toName: log.userCandidate.person.fullName,
      company: log.userCandidate.person.company,
      subject: log.subject,
      body: log.body,
      status: log.status,
      sentAt: log.sentAt,
      isScheduled: false,
    }));

    // Transform scheduled emails
    const transformedScheduled: SendLogEntry[] = scheduledEmails.map((email) => ({
      id: email.id,
      toEmail: email.toEmail,
      toName: email.userCandidate.person.fullName,
      company: email.userCandidate.person.company,
      subject: email.subject,
      body: email.body,
      status: 'PENDING' as const,
      sentAt: email.scheduledFor, // Use scheduledFor as sentAt for sorting
      scheduledFor: email.scheduledFor,
      isScheduled: true,
      scheduledEmailId: email.id,
    }));

    // Combine and sort by date
    const allLogs = [...transformedLogs, ...transformedScheduled].sort((a, b) => {
      return b.sentAt.getTime() - a.sentAt.getTime();
    });

    const hasMore = allLogs.length > PAGE_SIZE;
    const logsToReturn = hasMore ? allLogs.slice(0, PAGE_SIZE) : allLogs;
    const nextCursor = hasMore ? logsToReturn[logsToReturn.length - 1].id : null;

    return { success: true, logs: logsToReturn, nextCursor, hasMore };
  } catch (error) {
    console.error('Error fetching initial send logs:', error);
    return { success: false, error: 'Failed to fetch send logs' };
  }
}
