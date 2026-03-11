'use server';

import { refineEmailConversational } from '@/lib/services/personalization';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RefineEmailConversationalInput {
  subject: string;
  body: string;
  userMessage: string;
  conversationHistory: ConversationMessage[];
  personId: string;
  selectedInsights?: Array<{ label: string; detail: string; type: string }>;
}

export interface RefineEmailConversationalResult {
  success: boolean;
  subject: string;
  body: string;
  assistantMessage: string;
  error?: string;
}

export async function refineEmailConversationalAction(
  input: RefineEmailConversationalInput
): Promise<RefineEmailConversationalResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      success: false,
      subject: input.subject,
      body: input.body,
      assistantMessage: '',
      error: 'Please sign in to refine emails',
    };
  }

  try {
    // Get person info for context
    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: {
        firstName: true,
        company: true,
        role: true,
      },
    });

    if (!person) {
      return {
        success: false,
        subject: input.subject,
        body: input.body,
        assistantMessage: '',
        error: 'Person not found',
      };
    }

    const result = await refineEmailConversational({
      subject: input.subject,
      body: input.body,
      userMessage: input.userMessage,
      conversationHistory: input.conversationHistory,
      person: {
        firstName: person.firstName,
        company: person.company,
        role: person.role,
      },
      userId: session.user.id,
      selectedInsights: input.selectedInsights,
    });

    return {
      success: true,
      subject: result.subject,
      body: result.body,
      assistantMessage: result.assistantMessage,
    };
  } catch (error) {
    console.error('[email-chat] Error refining email:', error);
    return {
      success: false,
      subject: input.subject,
      body: input.body,
      assistantMessage: '',
      error: error instanceof Error ? error.message : 'Failed to refine email',
    };
  }
}
