'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { OutreachStatus, InteractionType, Prisma } from '@prisma/client';

export interface OutreachTrackerEntry {
  id: string;
  contactEmail: string;
  contactName: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  linkedinUrl: string | null;
  dateEmailed: Date | null;
  responseReceivedAt: Date | null;
  followedUpAt: Date | null;
  spokeToThem: boolean;
  interactionType: InteractionType;
  interactionDate: Date | null;
  status: OutreachStatus;
  notes: string | null;
  reminderDate: Date | null;
  reminderNote: string | null;
  reminderSent: boolean;
  createdAt: Date;
  updatedAt: Date;
  userCandidateId: string | null;
  gmailThreadId: string | null;
  messageCount: number;
}

export interface OutreachStats {
  total: number;
  sent: number;
  waiting: number;
  ongoingConversations: number;
}

export type SortField =
  | 'contactName'
  | 'company'
  | 'role'
  | 'location'
  | 'dateEmailed'
  | 'status'
  | 'createdAt';

export type SortDirection = 'asc' | 'desc';

export interface GetOutreachTrackersParams {
  search?: string;
  status?: OutreachStatus[];
  sortField?: SortField;
  sortDirection?: SortDirection;
  cursor?: string;
  limit?: number;
}

export async function getOutreachTrackers(
  params: GetOutreachTrackersParams = {}
): Promise<{
  success: true;
  trackers: OutreachTrackerEntry[];
  nextCursor: string | null;
  hasMore: boolean;
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const {
    search,
    status,
    sortField = 'createdAt',
    sortDirection = 'desc',
    cursor,
    limit = 50,
  } = params;

  try {
    const where: Prisma.OutreachTrackerWhereInput = {
      userId: session.user.id,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { contactEmail: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { role: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add status filter
    if (status && status.length > 0) {
      where.status = { in: status };
    }

    // Build orderBy
    const orderBy: Prisma.OutreachTrackerOrderByWithRelationInput = {
      [sortField]: sortDirection,
    };

    // Add cursor if provided
    const cursorObj = cursor ? { id: cursor } : undefined;

    const trackers = await prisma.outreachTracker.findMany({
      where,
      orderBy,
      take: limit + 1,
      cursor: cursorObj,
      skip: cursor ? 1 : 0,
    });

    const hasMore = trackers.length > limit;
    const results = hasMore ? trackers.slice(0, limit) : trackers;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    // Get message counts for all threads
    const threadIds = results
      .map((t) => t.gmailThreadId)
      .filter((id): id is string => id !== null);

    // TEMPORARILY DISABLED: querying SendLog instead of messages table (gmail.readonly removed)
    const messageCounts = threadIds.length > 0
      ? await prisma.sendLog.groupBy({
          by: ['gmailThreadId'],
          where: {
            gmailThreadId: { in: threadIds },
            userId: session.user.id,
            status: 'SUCCESS',
          },
          _count: { id: true },
        })
      : [];

    const messageCountMap = new Map(
      messageCounts.map((mc) => [mc.gmailThreadId!, mc._count.id])
    );

    return {
      success: true,
      trackers: results.map((t) => ({
        id: t.id,
        contactEmail: t.contactEmail,
        contactName: t.contactName,
        company: t.company,
        role: t.role,
        location: t.location,
        linkedinUrl: t.linkedinUrl,
        dateEmailed: t.dateEmailed,
        responseReceivedAt: t.responseReceivedAt,
        followedUpAt: t.followedUpAt,
        spokeToThem: t.spokeToThem,
        interactionType: t.interactionType,
        interactionDate: t.interactionDate,
        status: t.status,
        notes: t.notes,
        reminderDate: t.reminderDate,
        reminderNote: t.reminderNote,
        reminderSent: t.reminderSent,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        userCandidateId: t.userCandidateId,
        gmailThreadId: t.gmailThreadId,
        messageCount: t.gmailThreadId ? messageCountMap.get(t.gmailThreadId) || 0 : 0,
      })),
      nextCursor,
      hasMore,
    };
  } catch (error) {
    console.error('[Outreach] Error fetching trackers:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch outreach trackers',
    };
  }
}

export async function getInitialOutreachTrackers(userId: string): Promise<{
  success: true;
  trackers: OutreachTrackerEntry[];
  nextCursor: string | null;
  hasMore: boolean;
} | { success: false; error: string }> {
  try {
    const trackers = await prisma.outreachTracker.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 51,
    });

    const hasMore = trackers.length > 50;
    const results = hasMore ? trackers.slice(0, 50) : trackers;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    // Get message counts for all threads
    const threadIds = results
      .map((t) => t.gmailThreadId)
      .filter((id): id is string => id !== null);

    // TEMPORARILY DISABLED: querying SendLog instead of messages table (gmail.readonly removed)
    const messageCounts = threadIds.length > 0
      ? await prisma.sendLog.groupBy({
          by: ['gmailThreadId'],
          where: {
            gmailThreadId: { in: threadIds },
            userId,
            status: 'SUCCESS',
          },
          _count: { id: true },
        })
      : [];

    const messageCountMap = new Map(
      messageCounts.map((mc) => [mc.gmailThreadId!, mc._count.id])
    );

    return {
      success: true,
      trackers: results.map((t) => ({
        id: t.id,
        contactEmail: t.contactEmail,
        contactName: t.contactName,
        company: t.company,
        role: t.role,
        location: t.location,
        linkedinUrl: t.linkedinUrl,
        dateEmailed: t.dateEmailed,
        responseReceivedAt: t.responseReceivedAt,
        followedUpAt: t.followedUpAt,
        spokeToThem: t.spokeToThem,
        interactionType: t.interactionType,
        interactionDate: t.interactionDate,
        status: t.status,
        notes: t.notes,
        reminderDate: t.reminderDate,
        reminderNote: t.reminderNote,
        reminderSent: t.reminderSent,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        userCandidateId: t.userCandidateId,
        gmailThreadId: t.gmailThreadId,
        messageCount: t.gmailThreadId ? messageCountMap.get(t.gmailThreadId) || 0 : 0,
      })),
      nextCursor,
      hasMore,
    };
  } catch (error) {
    console.error('[Outreach] Error fetching initial trackers:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch outreach trackers',
    };
  }
}

export interface UpdateOutreachTrackerInput {
  id: string;
  contactName?: string | null;
  company?: string | null;
  role?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  spokeToThem?: boolean;
  interactionType?: InteractionType;
  interactionDate?: Date | null;
  status?: OutreachStatus;
  notes?: string | null;
  reminderDate?: Date | null;
  reminderNote?: string | null;
}

export async function updateOutreachTracker(
  input: UpdateOutreachTrackerInput
): Promise<{ success: true; tracker: OutreachTrackerEntry } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const { id, ...updateData } = input;

  try {
    // Verify ownership
    const existing = await prisma.outreachTracker.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return { success: false, error: 'Outreach tracker not found' };
    }

    // If setting a new reminder, reset reminderSent
    const data: Prisma.OutreachTrackerUpdateInput = { ...updateData };
    if (updateData.reminderDate !== undefined) {
      data.reminderSent = false;
    }

    const updated = await prisma.outreachTracker.update({
      where: { id },
      data,
    });

    // TEMPORARILY DISABLED: querying SendLog instead of messages table (gmail.readonly removed)
    const messageCount = updated.gmailThreadId
      ? await prisma.sendLog.count({
          where: {
            gmailThreadId: updated.gmailThreadId,
            userId: session.user.id,
            status: 'SUCCESS',
          },
        })
      : 0;

    return {
      success: true,
      tracker: {
        id: updated.id,
        contactEmail: updated.contactEmail,
        contactName: updated.contactName,
        company: updated.company,
        role: updated.role,
        location: updated.location,
        linkedinUrl: updated.linkedinUrl,
        dateEmailed: updated.dateEmailed,
        responseReceivedAt: updated.responseReceivedAt,
        followedUpAt: updated.followedUpAt,
        spokeToThem: updated.spokeToThem,
        interactionType: updated.interactionType,
        interactionDate: updated.interactionDate,
        status: updated.status,
        notes: updated.notes,
        reminderDate: updated.reminderDate,
        reminderNote: updated.reminderNote,
        reminderSent: updated.reminderSent,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        userCandidateId: updated.userCandidateId,
        gmailThreadId: updated.gmailThreadId,
        messageCount,
      },
    };
  } catch (error) {
    console.error('[Outreach] Error updating tracker:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update outreach tracker',
    };
  }
}

export async function deleteOutreachTracker(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership
    const existing = await prisma.outreachTracker.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return { success: false, error: 'Outreach tracker not found' };
    }

    await prisma.outreachTracker.delete({
      where: { id },
    });

    return { success: true };
  } catch (error) {
    console.error('[Outreach] Error deleting tracker:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete outreach tracker',
    };
  }
}

export async function getOutreachStats(): Promise<{
  success: true;
  stats: OutreachStats;
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const [total, sent, waiting, ongoingConversations] = await Promise.all([
      // Total trackers for this user
      prisma.outreachTracker.count({
        where: { userId: session.user.id },
      }),
      // Count all trackers where an email was sent
      prisma.outreachTracker.count({
        where: { userId: session.user.id, dateEmailed: { not: null } },
      }),
      // No response yet - sent but no responseReceivedAt
      prisma.outreachTracker.count({
        where: {
          userId: session.user.id,
          dateEmailed: { not: null },
          responseReceivedAt: null,
        },
      }),
      // Ongoing conversations - has a response
      prisma.outreachTracker.count({
        where: {
          userId: session.user.id,
          responseReceivedAt: { not: null },
        },
      }),
    ]);

    return {
      success: true,
      stats: {
        total,
        sent,
        waiting,
        ongoingConversations,
      },
    };
  } catch (error) {
    console.error('[Outreach] Error fetching stats:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch outreach stats',
    };
  }
}

/**
 * Upsert OutreachTracker when an email is sent
 * Called from send.ts and compose.ts after successful email send
 */
export async function upsertOutreachTrackerOnSend(params: {
  userId: string;
  toEmail: string;
  contactName?: string | null;
  company?: string | null;
  role?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  userCandidateId?: string | null;
  gmailThreadId?: string | null;
  sendLogId: string;
}): Promise<{ success: true; trackerId: string } | { success: false; error: string }> {
  const {
    userId,
    toEmail,
    contactName,
    company,
    role,
    location,
    linkedinUrl,
    userCandidateId,
    gmailThreadId,
    sendLogId,
  } = params;

  try {
    // Check if tracker already exists for this user + email combination
    const existing = await prisma.outreachTracker.findUnique({
      where: {
        userId_contactEmail: {
          userId,
          contactEmail: toEmail,
        },
      },
    });

    let tracker;

    if (existing) {
      // Update existing tracker - this is a follow-up or first send
      tracker = await prisma.outreachTracker.update({
        where: { id: existing.id },
        data: {
          // Set dateEmailed if not already set (first email to this contact)
          dateEmailed: existing.dateEmailed || new Date(),
          followedUpAt: existing.dateEmailed ? new Date() : undefined,
          gmailThreadId: gmailThreadId || existing.gmailThreadId,
          // Update status if it was NOT_STARTED
          status: existing.status === 'NOT_STARTED' ? 'SENT' : existing.status,
        },
      });

      // Link the SendLog to this tracker
      await prisma.sendLog.update({
        where: { id: sendLogId },
        data: { outreachTrackerId: tracker.id },
      });
    } else {
      // Create new tracker
      tracker = await prisma.outreachTracker.create({
        data: {
          userId,
          contactEmail: toEmail,
          contactName,
          company,
          role,
          location,
          linkedinUrl,
          userCandidateId,
          gmailThreadId,
          dateEmailed: new Date(),
          status: 'SENT',
        },
      });

      // Link the SendLog to this tracker
      await prisma.sendLog.update({
        where: { id: sendLogId },
        data: { outreachTrackerId: tracker.id },
      });
    }

    return { success: true, trackerId: tracker.id };
  } catch (error) {
    console.error('[Outreach] Error upserting tracker on send:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update outreach tracker',
    };
  }
}

/**
 * Update OutreachTracker when a response is detected
 * Called from email-sync.ts
 */
export async function updateOutreachTrackerOnResponse(params: {
  userId: string;
  gmailThreadId: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const { userId, gmailThreadId } = params;

  try {
    // Find tracker by gmailThreadId
    const tracker = await prisma.outreachTracker.findFirst({
      where: {
        userId,
        gmailThreadId,
      },
    });

    if (!tracker) {
      // No tracker for this thread, that's okay
      return { success: true };
    }

    // Update tracker with response info
    await prisma.outreachTracker.update({
      where: { id: tracker.id },
      data: {
        responseReceivedAt: new Date(),
        status: 'RESPONDED',
      },
    });

    return { success: true };
  } catch (error) {
    console.error('[Outreach] Error updating tracker on response:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update outreach tracker',
    };
  }
}

/**
 * Create a manual outreach tracker entry
 */
export async function createOutreachTracker(params: {
  contactEmail: string;
  contactName?: string | null;
  company?: string | null;
  role?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
}): Promise<{ success: true; tracker: OutreachTrackerEntry } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const { contactEmail, contactName, company, role, location, linkedinUrl, notes } = params;

  if (!contactEmail) {
    return { success: false, error: 'Contact email is required' };
  }

  try {
    // Check if tracker already exists
    const existing = await prisma.outreachTracker.findUnique({
      where: {
        userId_contactEmail: {
          userId: session.user.id,
          contactEmail,
        },
      },
    });

    if (existing) {
      return { success: false, error: 'A tracker for this contact already exists' };
    }

    const tracker = await prisma.outreachTracker.create({
      data: {
        userId: session.user.id,
        contactEmail,
        contactName,
        company,
        role,
        location,
        linkedinUrl,
        notes,
        status: 'NOT_STARTED',
      },
    });

    return {
      success: true,
      tracker: {
        id: tracker.id,
        contactEmail: tracker.contactEmail,
        contactName: tracker.contactName,
        company: tracker.company,
        role: tracker.role,
        location: tracker.location,
        linkedinUrl: tracker.linkedinUrl,
        dateEmailed: tracker.dateEmailed,
        responseReceivedAt: tracker.responseReceivedAt,
        followedUpAt: tracker.followedUpAt,
        spokeToThem: tracker.spokeToThem,
        interactionType: tracker.interactionType,
        interactionDate: tracker.interactionDate,
        status: tracker.status,
        notes: tracker.notes,
        reminderDate: tracker.reminderDate,
        reminderNote: tracker.reminderNote,
        reminderSent: tracker.reminderSent,
        createdAt: tracker.createdAt,
        updatedAt: tracker.updatedAt,
        userCandidateId: tracker.userCandidateId,
        gmailThreadId: tracker.gmailThreadId,
        messageCount: 0,
      },
    };
  } catch (error) {
    console.error('[Outreach] Error creating tracker:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create outreach tracker',
    };
  }
}

export interface ThreadMessage {
  messageId: string;
  threadId: string;
  direction: 'SENT' | 'RECEIVED';
  sender: string;
  recipients: string[];
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  receivedAt: Date;
}

export async function getThreadMessages(threadId: string): Promise<{
  success: true;
  messages: ThreadMessage[];
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // TEMPORARILY DISABLED: gmail.readonly scope removed for Google verification
    // Querying SendLog instead of messages table (which won't receive new data)
    const sendLogs = await prisma.sendLog.findMany({
      where: {
        gmailThreadId: threadId,
        userId: session.user.id,
        status: 'SUCCESS',
      },
      orderBy: { sentAt: 'asc' },
      include: { user: { select: { email: true } } },
    });

    return {
      success: true,
      messages: sendLogs.map((sl) => ({
        messageId: sl.gmailMessageId || sl.id,
        threadId: sl.gmailThreadId!,
        direction: 'SENT' as const,
        sender: sl.user.email || '',
        recipients: [sl.toEmail],
        subject: sl.subject,
        bodyHtml: null,
        bodyText: sl.body,
        receivedAt: sl.sentAt,
      })),
    };
  } catch (error) {
    console.error('[Outreach] Error fetching thread messages:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch thread messages',
    };
  }
}
