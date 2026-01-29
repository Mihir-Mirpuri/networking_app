'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export interface ReminderEntry {
  id: string;
  contactEmail: string;
  contactName: string | null;
  company: string | null;
  reminderDate: Date;
  reminderNote: string | null;
  status: string;
}

export async function getUpcomingReminders(
  daysAhead: number = 7
): Promise<{ success: true; reminders: ReminderEntry[] } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const futureDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

    const reminders = await prisma.outreachTracker.findMany({
      where: {
        userId: session.user.id,
        reminderDate: {
          lte: futureDate,
          gte: new Date(),
        },
        reminderSent: false,
      },
      orderBy: {
        reminderDate: 'asc',
      },
      select: {
        id: true,
        contactEmail: true,
        contactName: true,
        company: true,
        reminderDate: true,
        reminderNote: true,
        status: true,
      },
    });

    return {
      success: true,
      reminders: reminders.map((r) => ({
        id: r.id,
        contactEmail: r.contactEmail,
        contactName: r.contactName,
        company: r.company,
        reminderDate: r.reminderDate!,
        reminderNote: r.reminderNote,
        status: r.status,
      })),
    };
  } catch (error) {
    console.error('[Reminders] Error fetching upcoming reminders:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch reminders',
    };
  }
}

export async function setReminder(
  trackerId: string,
  reminderDate: Date | null,
  reminderNote?: string | null
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership
    const tracker = await prisma.outreachTracker.findFirst({
      where: { id: trackerId, userId: session.user.id },
    });

    if (!tracker) {
      return { success: false, error: 'Outreach tracker not found' };
    }

    await prisma.outreachTracker.update({
      where: { id: trackerId },
      data: {
        reminderDate,
        reminderNote: reminderNote ?? null,
        reminderSent: false, // Reset when setting new reminder
      },
    });

    return { success: true };
  } catch (error) {
    console.error('[Reminders] Error setting reminder:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set reminder',
    };
  }
}

export async function dismissReminder(
  trackerId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership
    const tracker = await prisma.outreachTracker.findFirst({
      where: { id: trackerId, userId: session.user.id },
    });

    if (!tracker) {
      return { success: false, error: 'Outreach tracker not found' };
    }

    await prisma.outreachTracker.update({
      where: { id: trackerId },
      data: {
        reminderDate: null,
        reminderNote: null,
        reminderSent: false,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('[Reminders] Error dismissing reminder:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to dismiss reminder',
    };
  }
}

/**
 * Get due reminders for processing by cron job
 * This is called from the cron route, not directly by users
 */
export async function getDueReminders(): Promise<{
  success: true;
  reminders: Array<{
    id: string;
    userId: string;
    userEmail: string;
    contactEmail: string;
    contactName: string | null;
    company: string | null;
    reminderNote: string | null;
  }>;
} | { success: false; error: string }> {
  try {
    const dueReminders = await prisma.outreachTracker.findMany({
      where: {
        reminderDate: { lte: new Date() },
        reminderSent: false,
      },
      include: {
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    return {
      success: true,
      reminders: dueReminders.map((r) => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.user.email || '',
        contactEmail: r.contactEmail,
        contactName: r.contactName,
        company: r.company,
        reminderNote: r.reminderNote,
      })),
    };
  } catch (error) {
    console.error('[Reminders] Error fetching due reminders:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch due reminders',
    };
  }
}

/**
 * Mark reminder as sent (called by cron job after sending notification)
 */
export async function markReminderSent(
  trackerId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await prisma.outreachTracker.update({
      where: { id: trackerId },
      data: { reminderSent: true },
    });

    return { success: true };
  } catch (error) {
    console.error('[Reminders] Error marking reminder as sent:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to mark reminder as sent',
    };
  }
}
