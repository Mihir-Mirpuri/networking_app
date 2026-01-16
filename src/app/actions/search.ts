'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchPeople, SearchResult } from '@/lib/services/discovery';
import { findEmail } from '@/lib/services/enrichment';
import { EMAIL_TEMPLATES } from '@/lib/constants';

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

  const template = EMAIL_TEMPLATES.find((t) => t.id === input.templateId);
  if (!template) {
    return { success: false, error: 'Invalid template' };
  }

  try {
    // Search for people
    const people = await searchPeople({
      university: input.university,
      company: input.company,
      role: input.role,
      limit: input.limit,
    });

    // Enrich with emails and generate drafts
    const results: SearchResultWithDraft[] = [];

    for (const person of people) {
      // Find email for this person
      let emailResult = { email: null as string | null, status: 'MISSING' as const, confidence: 0 };

      if (person.firstName && person.lastName) {
        emailResult = await findEmail(person.firstName, person.lastName, person.company);
      }

      // Generate email draft
      const draft = generateDraft(template, person, input.university, input.role);

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
        draftSubject: draft.subject,
        draftBody: draft.body,
        sourceUrl: person.sourceUrl,
      });
    }

    return { success: true, results };
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, error: 'Search failed. Please try again.' };
  }
}
