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
  group: string | null;
  connectionType: string | null;
  dateEmailed: Date | null;
  lastEmailDate: Date | null;
  responseReceivedAt: Date | null;
  followedUpAt: Date | null;
  followUpCount: number;
  spokeToThem: boolean;
  interactionType: InteractionType;
  interactionDate: Date | null;
  status: OutreachStatus;
  notes: string | null;
  starred: boolean;
  emailSubject: string | null;
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
  | 'group'
  | 'connectionType'
  | 'dateEmailed'
  | 'lastEmailDate'
  | 'followUpCount'
  | 'status'
  | 'createdAt';

export type SortDirection = 'asc' | 'desc';

export interface GetOutreachTrackersParams {
  search?: string;
  status?: OutreachStatus[];
  starred?: boolean;
  sortField?: SortField;
  sortDirection?: SortDirection;
  cursor?: string;
  limit?: number;
  // Multi-select filters
  firms?: string[];
  roles?: string[];
  groups?: string[];
  connections?: string[];
}

export interface FilterOption {
  value: string;
  count: number;
}

export interface OutreachFilterOptions {
  firms: FilterOption[];
  roles: FilterOption[];
  groups: FilterOption[];
  connections: FilterOption[];
}

export async function getOutreachFilterOptions(): Promise<{
  success: true;
  options: OutreachFilterOptions;
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const userId = session.user.id;

    // Fetch all distinct values in parallel using groupBy
    const [firmsResult, rolesResult, groupsResult, connectionsResult] = await Promise.all([
      prisma.outreachTracker.groupBy({
        by: ['company'],
        where: { userId, company: { not: null } },
        _count: { company: true },
        orderBy: { _count: { company: 'desc' } },
      }),
      prisma.outreachTracker.groupBy({
        by: ['role'],
        where: { userId, role: { not: null } },
        _count: { role: true },
        orderBy: { _count: { role: 'desc' } },
      }),
      prisma.outreachTracker.groupBy({
        by: ['group'],
        where: { userId, group: { not: null } },
        _count: { group: true },
        orderBy: { _count: { group: 'desc' } },
      }),
      prisma.outreachTracker.groupBy({
        by: ['connectionType'],
        where: { userId, connectionType: { not: null } },
        _count: { connectionType: true },
        orderBy: { _count: { connectionType: 'desc' } },
      }),
    ]);

    return {
      success: true,
      options: {
        firms: firmsResult
          .filter((r) => r.company)
          .map((r) => ({ value: r.company!, count: r._count.company })),
        roles: rolesResult
          .filter((r) => r.role)
          .map((r) => ({ value: r.role!, count: r._count.role })),
        groups: groupsResult
          .filter((r) => r.group)
          .map((r) => ({ value: r.group!, count: r._count.group })),
        connections: connectionsResult
          .filter((r) => r.connectionType)
          .map((r) => ({ value: r.connectionType!, count: r._count.connectionType })),
      },
    };
  } catch (error) {
    console.error('[Outreach] Error fetching filter options:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch filter options',
    };
  }
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
    starred,
    sortField = 'createdAt',
    sortDirection = 'desc',
    cursor,
    limit = 50,
    firms,
    roles,
    groups,
    connections,
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
        { emailSubject: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add status filter
    if (status && status.length > 0) {
      where.status = { in: status };
    }

    // Add starred filter
    if (starred !== undefined) {
      where.starred = starred;
    }

    // Add multi-select filters
    if (firms && firms.length > 0) {
      where.company = { in: firms };
    }
    if (roles && roles.length > 0) {
      where.role = { in: roles };
    }
    if (groups && groups.length > 0) {
      where.group = { in: groups };
    }
    if (connections && connections.length > 0) {
      where.connectionType = { in: connections };
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
        group: t.group,
        connectionType: t.connectionType,
        dateEmailed: t.dateEmailed,
        lastEmailDate: t.lastEmailDate,
        responseReceivedAt: t.responseReceivedAt,
        followedUpAt: t.followedUpAt,
        followUpCount: t.followUpCount,
        spokeToThem: t.spokeToThem,
        interactionType: t.interactionType,
        interactionDate: t.interactionDate,
        status: t.status,
        notes: t.notes,
        starred: t.starred,
        emailSubject: t.emailSubject,
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
        group: t.group,
        connectionType: t.connectionType,
        dateEmailed: t.dateEmailed,
        lastEmailDate: t.lastEmailDate,
        responseReceivedAt: t.responseReceivedAt,
        followedUpAt: t.followedUpAt,
        followUpCount: t.followUpCount,
        spokeToThem: t.spokeToThem,
        interactionType: t.interactionType,
        interactionDate: t.interactionDate,
        status: t.status,
        notes: t.notes,
        starred: t.starred,
        emailSubject: t.emailSubject,
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
  starred?: boolean;
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
        group: updated.group,
        connectionType: updated.connectionType,
        dateEmailed: updated.dateEmailed,
        lastEmailDate: updated.lastEmailDate,
        responseReceivedAt: updated.responseReceivedAt,
        followedUpAt: updated.followedUpAt,
        followUpCount: updated.followUpCount,
        spokeToThem: updated.spokeToThem,
        interactionType: updated.interactionType,
        interactionDate: updated.interactionDate,
        status: updated.status,
        notes: updated.notes,
        starred: updated.starred,
        emailSubject: updated.emailSubject,
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

export async function toggleStarOutreachTracker(
  id: string
): Promise<{ success: true; starred: boolean } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const existing = await prisma.outreachTracker.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return { success: false, error: 'Outreach tracker not found' };
    }

    const updated = await prisma.outreachTracker.update({
      where: { id },
      data: { starred: !existing.starred },
    });

    return { success: true, starred: updated.starred };
  } catch (error) {
    console.error('[Outreach] Error toggling star:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to toggle star',
    };
  }
}

export interface ScheduledEmailEntry {
  id: string;
  toEmail: string;
  contactName: string | null;
  company: string | null;
  role: string | null;
  subject: string;
  body: string;
  scheduledFor: Date;
  createdAt: Date;
}

export async function getScheduledEmails(): Promise<{
  success: true;
  emails: ScheduledEmailEntry[];
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const emails = await prisma.scheduledEmail.findMany({
      where: {
        userId: session.user.id,
        status: 'PENDING',
      },
      include: {
        userCandidate: {
          include: { person: true },
        },
      },
      orderBy: { scheduledFor: 'asc' },
    });

    return {
      success: true,
      emails: emails.map((e) => ({
        id: e.id,
        toEmail: e.toEmail,
        contactName: e.userCandidate.person.fullName,
        company: e.userCandidate.person.company,
        role: e.userCandidate.person.role,
        subject: e.subject,
        body: e.body,
        scheduledFor: e.scheduledFor,
        createdAt: e.createdAt,
      })),
    };
  } catch (error) {
    console.error('[Outreach] Error fetching scheduled emails:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch scheduled emails',
    };
  }
}

export async function getInitialScheduledEmails(userId: string): Promise<{
  success: true;
  emails: ScheduledEmailEntry[];
} | { success: false; error: string }> {
  try {
    const emails = await prisma.scheduledEmail.findMany({
      where: {
        userId,
        status: 'PENDING',
      },
      include: {
        userCandidate: {
          include: { person: true },
        },
      },
      orderBy: { scheduledFor: 'asc' },
    });

    return {
      success: true,
      emails: emails.map((e) => ({
        id: e.id,
        toEmail: e.toEmail,
        contactName: e.userCandidate.person.fullName,
        company: e.userCandidate.person.company,
        role: e.userCandidate.person.role,
        subject: e.subject,
        body: e.body,
        scheduledFor: e.scheduledFor,
        createdAt: e.createdAt,
      })),
    };
  } catch (error) {
    console.error('[Outreach] Error fetching initial scheduled emails:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch scheduled emails',
    };
  }
}

// ===== DRAFTS =====

export interface DraftEntry {
  id: string;
  contactName: string;
  contactEmail: string | null;
  company: string;
  role: string | null;
  linkedinUrl: string | null;
  subject: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  userCandidateId: string;
  personId: string;
}

export async function getDrafts(search?: string): Promise<{
  success: true;
  drafts: DraftEntry[];
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const where: Prisma.EmailDraftWhereInput = {
      userCandidate: { userId: session.user.id },
      status: { not: 'SENT' },
    };

    if (search) {
      const q = search.toLowerCase();
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { body: { contains: q, mode: 'insensitive' } },
        { userCandidate: { person: { fullName: { contains: q, mode: 'insensitive' } } } },
        { userCandidate: { person: { company: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const drafts = await prisma.emailDraft.findMany({
      where,
      include: {
        userCandidate: {
          include: { person: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return {
      success: true,
      drafts: drafts.map((d) => ({
        id: d.id,
        contactName: d.userCandidate.person.fullName,
        contactEmail: d.userCandidate.person.email,
        company: d.userCandidate.person.company,
        role: d.userCandidate.person.role,
        linkedinUrl: d.userCandidate.person.linkedinUrl,
        subject: d.subject,
        body: d.body,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        userCandidateId: d.userCandidateId,
        personId: d.userCandidate.personId,
      })),
    };
  } catch (error) {
    console.error('[Outreach] Error fetching drafts:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch drafts',
    };
  }
}

export async function getInitialDrafts(userId: string): Promise<{
  success: true;
  drafts: DraftEntry[];
} | { success: false; error: string }> {
  try {
    const drafts = await prisma.emailDraft.findMany({
      where: {
        userCandidate: { userId },
        status: { not: 'SENT' },
      },
      include: {
        userCandidate: {
          include: { person: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return {
      success: true,
      drafts: drafts.map((d) => ({
        id: d.id,
        contactName: d.userCandidate.person.fullName,
        contactEmail: d.userCandidate.person.email,
        company: d.userCandidate.person.company,
        role: d.userCandidate.person.role,
        linkedinUrl: d.userCandidate.person.linkedinUrl,
        subject: d.subject,
        body: d.body,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        userCandidateId: d.userCandidateId,
        personId: d.userCandidate.personId,
      })),
    };
  } catch (error) {
    console.error('[Outreach] Error fetching initial drafts:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch drafts',
    };
  }
}

export async function deleteDraft(draftId: string): Promise<{
  success: true;
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership
    const draft = await prisma.emailDraft.findUnique({
      where: { id: draftId },
      include: { userCandidate: true },
    });

    if (!draft || draft.userCandidate.userId !== session.user.id) {
      return { success: false, error: 'Draft not found' };
    }

    await prisma.emailDraft.delete({ where: { id: draftId } });
    return { success: true };
  } catch (error) {
    console.error('[Outreach] Error deleting draft:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete draft',
    };
  }
}

export async function clearAllOutreachTrackers(): Promise<{
  success: true;
  deletedCount: number;
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await prisma.outreachTracker.deleteMany({
      where: { userId: session.user.id },
    });

    return { success: true, deletedCount: result.count };
  } catch (error) {
    console.error('[Outreach] Error clearing all trackers:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear outreach history',
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
  emailSubject?: string | null;
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
    emailSubject,
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
          // Set emailSubject if not already set (use first email's subject)
          emailSubject: existing.emailSubject || emailSubject,
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
          emailSubject,
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
        group: tracker.group,
        connectionType: tracker.connectionType,
        dateEmailed: tracker.dateEmailed,
        lastEmailDate: tracker.lastEmailDate,
        responseReceivedAt: tracker.responseReceivedAt,
        followedUpAt: tracker.followedUpAt,
        followUpCount: tracker.followUpCount,
        spokeToThem: tracker.spokeToThem,
        interactionType: tracker.interactionType,
        interactionDate: tracker.interactionDate,
        status: tracker.status,
        notes: tracker.notes,
        starred: tracker.starred,
        emailSubject: tracker.emailSubject,
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
