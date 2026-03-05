'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export interface UserProfile {
  name: string | null;
  classification: string | null;
  major: string | null;
  university: string | null;
  career: string | null;
  emailInstructions: string | null;
  autoPersonalize: boolean;
}

export interface TemplateData {
  id: string;
  name: string;
  subject: string;
  body: string;
  isDefault: boolean;
  attachResume: boolean;
  resumeId: string | null;
  createdAt: Date;
}

// ============================================================================
// Profile Actions
// ============================================================================

export async function getProfileAction(): Promise<
  { success: true; profile: UserProfile } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        classification: true,
        major: true,
        university: true,
        career: true,
        emailInstructions: true,
        autoPersonalize: true,
      },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    return { success: true, profile: { ...user, autoPersonalize: user.autoPersonalize ?? false } };
  } catch (error) {
    console.error('Error fetching profile:', error);
    return { success: false, error: 'Failed to fetch profile' };
  }
}

export async function updateProfileAction(
  profile: UserProfile
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: profile.name,
        classification: profile.classification,
        major: profile.major,
        university: profile.university,
        career: profile.career,
        emailInstructions: profile.emailInstructions,
        autoPersonalize: profile.autoPersonalize,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating profile:', error);
    return { success: false, error: 'Failed to update profile' };
  }
}

// ============================================================================
// User Preferences Actions
// ============================================================================

/**
 * Get user's autoPersonalize setting
 */
export async function getAutoPersonalizeAction(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return false;

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { autoPersonalize: true },
    });
    return user?.autoPersonalize ?? false;
  } catch {
    return false;
  }
}

// ============================================================================
// Timezone Actions
// ============================================================================

/**
 * Update user's timezone (only if not already set, to avoid overwriting)
 * Called silently from client on app load
 */
export async function updateTimezoneAction(
  timezone: string,
  force: boolean = false
): Promise<{ success: true; updated: boolean } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Validate timezone string (basic check)
  if (!timezone || typeof timezone !== 'string' || timezone.length > 50) {
    return { success: false, error: 'Invalid timezone' };
  }

  try {
    // Check if user already has a timezone set
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { timezone: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Skip if timezone is the same (no change needed)
    if (user.timezone === timezone) {
      return { success: true, updated: false };
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { timezone },
    });

    return { success: true, updated: true };
  } catch (error) {
    console.error('Error updating timezone:', error);
    return { success: false, error: 'Failed to update timezone' };
  }
}

/**
 * Get user's stored timezone
 */
export async function getTimezoneAction(): Promise<
  { success: true; timezone: string | null } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { timezone: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    return { success: true, timezone: user.timezone };
  } catch (error) {
    console.error('Error fetching timezone:', error);
    return { success: false, error: 'Failed to fetch timezone' };
  }
}

// ============================================================================
// Template CRUD Actions
// ============================================================================

export async function getTemplatesAction(): Promise<
  { success: true; templates: TemplateData[] } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const templates = await prisma.emailTemplate.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    const templateData: TemplateData[] = templates.map((t) => {
      let subject = '';
      let body = t.prompt;

      try {
        const parsed = JSON.parse(t.prompt);
        subject = parsed.subject || '';
        body = parsed.body || t.prompt;
      } catch {
        // If not JSON, treat prompt as body
      }

      return {
        id: t.id,
        name: t.name,
        subject,
        body,
        isDefault: t.isDefault,
        attachResume: t.attachResume,
        resumeId: t.resumeId,
        createdAt: t.createdAt,
      };
    });

    return { success: true, templates: templateData };
  } catch (error) {
    console.error('Error fetching templates:', error);
    return { success: false, error: 'Failed to fetch templates' };
  }
}

export async function createTemplateAction(
  data: { name: string; subject: string; body: string; attachResume?: boolean; resumeId?: string | null }
): Promise<{ success: true; template: TemplateData } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Validate resumeId belongs to user if provided
    if (data.attachResume && data.resumeId) {
      const resume = await prisma.userResume.findUnique({
        where: { id: data.resumeId },
        select: { userId: true },
      });

      if (!resume || resume.userId !== session.user.id) {
        return { success: false, error: 'Invalid resume selected' };
      }
    }

    const prompt = JSON.stringify({ subject: data.subject, body: data.body });

    const template = await prisma.emailTemplate.create({
      data: {
        userId: session.user.id,
        name: data.name,
        prompt,
        isDefault: false,
        attachResume: data.attachResume || false,
        resumeId: data.attachResume ? (data.resumeId || null) : null,
      },
    });

    return {
      success: true,
      template: {
        id: template.id,
        name: template.name,
        subject: data.subject,
        body: data.body,
        isDefault: template.isDefault,
        attachResume: template.attachResume,
        resumeId: template.resumeId,
        createdAt: template.createdAt,
      },
    };
  } catch (error) {
    console.error('Error creating template:', error);
    return { success: false, error: 'Failed to create template' };
  }
}

export async function updateTemplateAction(
  id: string,
  data: { name: string; subject: string; body: string; attachResume?: boolean; resumeId?: string | null }
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership
    const existing = await prisma.emailTemplate.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing || existing.userId !== session.user.id) {
      return { success: false, error: 'Template not found' };
    }

    // Validate resumeId belongs to user if provided
    if (data.attachResume && data.resumeId) {
      const resume = await prisma.userResume.findUnique({
        where: { id: data.resumeId },
        select: { userId: true },
      });

      if (!resume || resume.userId !== session.user.id) {
        return { success: false, error: 'Invalid resume selected' };
      }
    }

    const prompt = JSON.stringify({ subject: data.subject, body: data.body });

    await prisma.emailTemplate.update({
      where: { id },
      data: {
        name: data.name,
        prompt,
        attachResume: data.attachResume !== undefined ? data.attachResume : false,
        resumeId: data.attachResume ? (data.resumeId || null) : null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating template:', error);
    return { success: false, error: 'Failed to update template' };
  }
}

export async function deleteTemplateAction(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership and check if it's the default
    const existing = await prisma.emailTemplate.findUnique({
      where: { id },
      select: { userId: true, isDefault: true },
    });

    if (!existing || existing.userId !== session.user.id) {
      return { success: false, error: 'Template not found' };
    }

    await prisma.emailTemplate.delete({
      where: { id },
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting template:', error);
    return { success: false, error: 'Failed to delete template' };
  }
}

export async function setDefaultTemplateAction(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership
    const existing = await prisma.emailTemplate.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing || existing.userId !== session.user.id) {
      return { success: false, error: 'Template not found' };
    }

    // Remove default from all user's templates
    await prisma.emailTemplate.updateMany({
      where: { userId: session.user.id },
      data: { isDefault: false },
    });

    // Set new default
    await prisma.emailTemplate.update({
      where: { id },
      data: { isDefault: true },
    });

    return { success: true };
  } catch (error) {
    console.error('Error setting default template:', error);
    return { success: false, error: 'Failed to set default template' };
  }
}
