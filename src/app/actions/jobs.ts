'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import type { TemplatePrompt } from '@/lib/types/email';
import { EMAIL_TEMPLATES } from '@/lib/constants';

export type DraftStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SENT';

export interface DraftStatusResult {
  userCandidateId: string;
  status: DraftStatus;
  subject?: string;
  body?: string;
}

/**
 * Check the status of email drafts for given userCandidateIds
 * Returns the current status and content of each draft
 */
export async function checkDraftsStatus(
  userCandidateIds: string[]
): Promise<{ success: true; results: DraftStatusResult[] } | { success: false; error: string }> {
  console.log(`[Jobs] checkDraftsStatus called for ${userCandidateIds.length} userCandidateIds`);
  
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    console.error('[Jobs] Not authenticated');
    return { success: false, error: 'Not authenticated' };
  }

  if (userCandidateIds.length === 0) {
    console.log('[Jobs] No userCandidateIds provided');
    return { success: true, results: [] };
  }

  try {
    console.log(`[Jobs] Querying database for drafts:`, userCandidateIds);
    const drafts = await prisma.emailDraft.findMany({
      where: {
        userCandidateId: { in: userCandidateIds },
        userCandidate: {
          userId: session.user.id, // Ensure user owns these candidates
        },
      },
      select: {
        userCandidateId: true,
        status: true,
        subject: true,
        body: true,
      },
    });

    console.log(`[Jobs] Found ${drafts.length} drafts in database`);

    // Create a map for quick lookup
    const draftMap = new Map(
      drafts.map((d) => {
        const result = {
          userCandidateId: d.userCandidateId,
          status: d.status as DraftStatus,
          subject: d.subject,
          body: d.body,
        };
        console.log(`[Jobs] Draft found:`, {
          userCandidateId: d.userCandidateId,
          status: d.status,
          hasSubject: !!d.subject,
          hasBody: !!d.body,
        });
        return [d.userCandidateId, result];
      })
    );

    // Return results for all requested IDs (some may not exist yet)
    const results: DraftStatusResult[] = userCandidateIds.map((id) => {
      const draft = draftMap.get(id);
      if (draft) {
        return draft;
      }
      // If draft doesn't exist, assume it's still pending
      console.log(`[Jobs] No draft found for userCandidateId: ${id}, returning PENDING`);
      return {
        userCandidateId: id,
        status: 'PENDING' as DraftStatus,
      };
    });

    console.log(`[Jobs] Returning ${results.length} status results`);
    return { success: true, results };
  } catch (error) {
    console.error('[Jobs] Error checking draft status:', error);
    return { success: false, error: 'Failed to check draft status' };
  }
}

/**
 * Get completed drafts (APPROVED status) for given userCandidateIds
 * This is a convenience function that filters for only approved drafts
 */
export async function getCompletedDrafts(
  userCandidateIds: string[]
): Promise<{ success: true; results: DraftStatusResult[] } | { success: false; error: string }> {
  const statusResult = await checkDraftsStatus(userCandidateIds);

  if (!statusResult.success) {
    return statusResult;
  }

  // Filter for only approved drafts
  const completed = statusResult.results.filter((r) => r.status === 'APPROVED');

  return { success: true, results: completed };
}

/**
 * Get the user's default email template
 */
export async function getDefaultTemplateAction(): Promise<
  { success: true; template: TemplatePrompt } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const dbTemplate = await prisma.emailTemplate.findFirst({
      where: {
        userId: session.user.id,
        isDefault: true,
      },
    });

    if (dbTemplate) {
      try {
        const parsed = JSON.parse(dbTemplate.prompt);
        return {
          success: true,
          template: {
            subject: parsed.subject || '',
            body: parsed.body || dbTemplate.prompt,
          },
        };
      } catch {
        // If not JSON, treat entire prompt as body
        return {
          success: true,
          template: {
            subject: `Reaching out`,
            body: dbTemplate.prompt,
          },
        };
      }
    }

    // Fallback to first constant template
    const constTemplate = EMAIL_TEMPLATES[0];
    return {
      success: true,
      template: {
        subject: constTemplate.subject,
        body: constTemplate.body,
      },
    };
  } catch (error) {
    console.error('[Jobs] Error fetching default template:', error);
    return { success: false, error: 'Failed to fetch template' };
  }
}

/**
 * Update the user's default email template
 */
export async function updateDefaultTemplateAction(
  template: TemplatePrompt
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Store template as JSON
    const prompt = JSON.stringify({
      subject: template.subject,
      body: template.body,
    });

    // Find existing default template
    const existingTemplate = await prisma.emailTemplate.findFirst({
      where: {
        userId: session.user.id,
        isDefault: true,
      },
    });

    if (existingTemplate) {
      // Update existing default template
      await prisma.emailTemplate.update({
        where: { id: existingTemplate.id },
        data: {
          prompt,
          updatedAt: new Date(),
        },
      });
    } else {
      // If no default exists, set all user templates to non-default first
      await prisma.emailTemplate.updateMany({
        where: { userId: session.user.id },
        data: { isDefault: false },
      });

      // Create new default template
      await prisma.emailTemplate.create({
        data: {
          userId: session.user.id,
          name: 'Default Template',
          prompt,
          isDefault: true,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error('[Jobs] Error updating default template:', error);
    return { success: false, error: 'Failed to update template' };
  }
}

/**
 * TEMPORARY: Stub export to fix Vercel build cache issue
 * This function was never actually implemented but is referenced in cached build artifacts.
 * TODO: Remove after build cache clears and deployment succeeds.
 */
export async function generateEmailForCandidateAction() {
  throw new Error('This function has been removed. Please use the updated API.');
}

