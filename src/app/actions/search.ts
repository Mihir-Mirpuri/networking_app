'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchPeople, SearchResult } from '@/lib/services/discovery';
import { findEmail } from '@/lib/services/enrichment';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import { saveSearchResult } from '@/lib/db/person-service';

export interface SearchInput {
  company: string;
  role: string;
  university: string;
  limit: number;
  templateId: string;
}

export interface SearchResultWithDraft {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  university: string;
  email: string | null;
  emailStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
  emailConfidence: number;
  draftSubject: string;
  draftBody: string;
  sourceUrl: string;
  userCandidateId?: string;
  emailDraftId?: string;
}

function generateDraft(
  template: typeof EMAIL_TEMPLATES[number],
  person: SearchResult,
  university: string,
  role: string
): { subject: string; body: string } {
  const firstName = person.firstName || 'there';

  const subject = template.subject
    .replace(/{first_name}/g, firstName)
    .replace(/{company}/g, person.company)
    .replace(/{university}/g, university)
    .replace(/{role}/g, role);

  const body = template.body
    .replace(/{first_name}/g, firstName)
    .replace(/{company}/g, person.company)
    .replace(/{university}/g, university)
    .replace(/{role}/g, role);

  return { subject, body };
}

export async function searchPeopleAction(
  input: SearchInput
): Promise<{ success: true; results: SearchResultWithDraft[] } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Try to get template from database first, fallback to constants
  let template: { subject: string; body: string; id: string } | null = null;
  let templateId: string | null = null;

  try {
    const dbTemplate = await prisma.emailTemplate.findFirst({
      where: {
        userId: session.user.id,
        OR: [
          { id: input.templateId },
          { isDefault: true },
        ],
      },
    });

    if (dbTemplate) {
      // Parse prompt as JSON or use as-is
      try {
        const parsed = JSON.parse(dbTemplate.prompt);
        template = {
          id: dbTemplate.id,
          subject: parsed.subject || '',
          body: parsed.body || dbTemplate.prompt,
        };
        templateId = dbTemplate.id;
      } catch {
        // If not JSON, treat entire prompt as body
        template = {
          id: dbTemplate.id,
          subject: `Reaching out from ${input.university}`,
          body: dbTemplate.prompt,
        };
        templateId = dbTemplate.id;
      }
    }
  } catch (error) {
    console.error('Error fetching template from database:', error);
  }

  // Fallback to constants if no database template found
  if (!template) {
    const constTemplate = EMAIL_TEMPLATES.find((t) => t.id === input.templateId);
    if (!constTemplate) {
      return { success: false, error: 'Invalid template' };
    }
    template = {
      id: constTemplate.id,
      subject: constTemplate.subject,
      body: constTemplate.body,
    };
    templateId = null; // Will be created in seed script later
  }

  try {
    // Search for people
    const people = await searchPeople({
      university: input.university,
      company: input.company,
      role: input.role,
      limit: input.limit,
    });

    // Enrich with emails, generate drafts, and save to database
    const results: SearchResultWithDraft[] = [];

    for (const person of people) {
      // Find email for this person
      let emailResult = { email: null as string | null, status: 'MISSING' as const, confidence: 0 };

      if (person.firstName && person.lastName) {
        emailResult = await findEmail(person.firstName, person.lastName, person.company);
      }

      // Generate placeholder draft (simple template replacement)
      const placeholderDraft = generateDraft(template, person, input.university, input.role);

      // Save to database with placeholder
      try {
        const saved = await saveSearchResult(
          session.user.id,
          person,
          emailResult,
          input.university,
          {
            subject: placeholderDraft.subject,
            body: placeholderDraft.body,
            templateId: templateId,
          }
        );

        results.push({
          id: saved.userCandidateId,
          fullName: person.fullName,
          firstName: person.firstName,
          lastName: person.lastName,
          company: person.company,
          role: person.role,
          university: input.university,
          email: emailResult.email,
          emailStatus: emailResult.status,
          emailConfidence: emailResult.confidence,
          draftSubject: placeholderDraft.subject,
          draftBody: placeholderDraft.body,
          sourceUrl: person.sourceUrl,
          userCandidateId: saved.userCandidateId,
          emailDraftId: saved.emailDraftId,
        });
      } catch (error) {
        console.error('Error saving search result to database:', error);
        // Still return result even if save fails
        results.push({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          fullName: person.fullName,
          firstName: person.firstName,
          lastName: person.lastName,
          company: person.company,
          role: person.role,
          university: input.university,
          email: emailResult.email,
          emailStatus: emailResult.status,
          emailConfidence: emailResult.confidence,
          draftSubject: placeholderDraft.subject,
          draftBody: placeholderDraft.body,
          sourceUrl: person.sourceUrl,
        });
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, error: 'Search failed. Please try again.' };
  }
}
