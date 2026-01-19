'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { emailGenerationQueue } from '@/lib/queue';
import type { PersonData, TemplatePrompt } from '@/lib/services/groq-email';
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
 * Generate email for a specific candidate on-demand
 */
export async function generateEmailForCandidateAction(
  userCandidateId: string,
  templatePrompt?: TemplatePrompt
): Promise<
  | { success: true; jobId: string }
  | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Fetch user candidate and person data
    const userCandidate = await prisma.userCandidate.findUnique({
      where: { id: userCandidateId },
      include: {
        person: true,
        user: true,
      },
    });

    if (!userCandidate) {
      return { success: false, error: 'Candidate not found' };
    }

    // Ensure user owns this candidate
    if (userCandidate.userId !== session.user.id) {
      return { success: false, error: 'Unauthorized' };
    }

    // Get template (provided or default)
    let template: TemplatePrompt;
    if (templatePrompt) {
      template = templatePrompt;
    } else {
      const templateResult = await getDefaultTemplateAction();
      if (!templateResult.success) {
        return { success: false, error: templateResult.error };
      }
      template = templateResult.template;
    }

    // Prepare person data
    const personData: PersonData = {
      fullName: userCandidate.person.fullName,
      firstName: userCandidate.person.firstName,
      lastName: userCandidate.person.lastName,
      company: userCandidate.person.company,
      role: userCandidate.person.role,
      university: userCandidate.university || '',
    };

    // Queue the job
    const job = await emailGenerationQueue.add(
      'generate-email',
      {
        userCandidateId,
        templatePrompt: template,
        personData,
      },
      {
        jobId: `email-${userCandidateId}`, // Unique job ID per userCandidate
      }
    );

    console.log(`[Jobs] Queued email generation job ${job.id} for userCandidateId: ${userCandidateId}`);

    return { success: true, jobId: job.id };
  } catch (error) {
    console.error('[Jobs] Error queueing email generation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to queue generation',
    };
  }
}
