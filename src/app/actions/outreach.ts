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
}

export interface OutreachStats {
  sent: number;
  waiting: number;
  ongoingConversations: number;
  connected: number;
  upcomingReminders: number;
}

export type SortField =
  | 'contactName'
  | 'company'
  | 'role'
  | 'location'
  | 'dateEmailed'
  | 'responseReceivedAt'
  | 'followedUpAt'
  | 'status'
  | 'reminderDate'
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
    const [sent, waiting, ongoingConversations, connected, upcomingReminders] = await Promise.all([
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
      prisma.outreachTracker.count({
        where: { userId: session.user.id, status: 'CONNECTED' },
      }),
      prisma.outreachTracker.count({
        where: {
          userId: session.user.id,
          reminderDate: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
          reminderSent: false,
        },
      }),
    ]);

    return {
      success: true,
      stats: {
        sent,
        waiting,
        ongoingConversations,
        connected,
        upcomingReminders,
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
      // Update existing tracker - this is a follow-up
      tracker = await prisma.outreachTracker.update({
        where: { id: existing.id },
        data: {
          followedUpAt: new Date(),
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
