'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { personalizeEmail, personalizeWithFoundInfo, LinkedInData } from '@/lib/services/personalization';

export interface PersonalizeEmailInput {
  linkedinData: LinkedInData;
  originalSubject: string;
  originalBody: string;
  personName: string;
  personCompany: string;
  personRole?: string;
}

export interface PersonalizeEmailResult {
  success: boolean;
  subject?: string;
  body?: string;
  similarityFound?: boolean;
  changes?: string[];
  foundInfo?: string[];
  error?: string;
}

export async function personalizeEmailAction(
  input: PersonalizeEmailInput
): Promise<PersonalizeEmailResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const senderName = session.user.name || 'there';

    const result = await personalizeEmail({
      ...input,
      senderName,
      userId: session.user.id,
    });

    return {
      success: true,
      subject: result.subject,
      body: result.body,
      similarityFound: result.similarityFound,
      changes: result.changes,
      foundInfo: result.foundInfo,
    };
  } catch (error) {
    console.error('Personalization error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to personalize email',
    };
  }
}

export interface UseFoundInfoInput {
  foundInfo: string[];
  originalSubject: string;
  originalBody: string;
  personName: string;
  personCompany: string;
  personRole?: string;
}

export async function useFoundInfoAction(
  input: UseFoundInfoInput
): Promise<PersonalizeEmailResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    const senderName = session.user.name || 'there';

    const result = await personalizeWithFoundInfo({
      ...input,
      senderName,
    });

    return {
      success: true,
      subject: result.subject,
      body: result.body,
      similarityFound: true,
      changes: result.changes,
    };
  } catch (error) {
    console.error('UseFoundInfo error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to personalize email',
    };
  }
}
