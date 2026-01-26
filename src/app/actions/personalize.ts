'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { personalizeEmail, personalizeWithFoundInfo, generateFollowUpEmail, LinkedInData } from '@/lib/services/personalization';

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

export interface GenerateFollowUpResult {
  success: boolean;
  subject?: string;
  body?: string;
  toEmail?: string;
  toName?: string;
  company?: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
  userCandidateId?: string;
  error?: string;
}

export async function generateFollowUpAction(
  sendLogId: string
): Promise<GenerateFollowUpResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    // Fetch the send log with person info
    const sendLog = await prisma.sendLog.findFirst({
      where: {
        id: sendLogId,
        userId: session.user.id,
      },
      include: {
        userCandidate: {
          include: {
            person: true,
          },
        },
      },
    });

    if (!sendLog) {
      return { success: false, error: 'Email not found' };
    }

    if (!sendLog.gmailThreadId) {
      return { success: false, error: 'No thread ID found for this email' };
    }

    const person = sendLog.userCandidate.person;
    const senderName = session.user.name || 'there';

    // Generate follow-up email
    const result = await generateFollowUpEmail({
      originalSubject: sendLog.subject,
      originalBody: sendLog.body,
      personName: person.fullName,
      personCompany: person.company,
      personRole: person.role || undefined,
      senderName,
    });

    return {
      success: true,
      subject: result.subject,
      body: result.body,
      toEmail: sendLog.toEmail,
      toName: person.fullName,
      company: person.company,
      gmailThreadId: sendLog.gmailThreadId,
      gmailMessageId: sendLog.gmailMessageId || undefined,
      userCandidateId: sendLog.userCandidateId,
    };
  } catch (error) {
    console.error('GenerateFollowUp error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate follow-up',
    };
  }
}
