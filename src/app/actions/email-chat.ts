'use server';

import { refineEmailConversational } from '@/lib/services/personalization';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkEmailCredits } from '@/lib/services/credits';
import { complete } from '@/lib/services/groq';

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
    // Check if free user has exhausted lifetime sends — roast them
    const creditStatus = await checkEmailCredits(session.user.id);
    if (!creditStatus.canSend && !creditStatus.isSubscribed) {
      try {
        const roast = await complete({
          systemPrompt: `You are a brutally honest, witty AI assistant. The user is trying to use an email networking tool but refuses to pay $20/month for a Pro subscription. They've used up all 3 of their free email sends and are still trying to get the user to find profiles and send personalized emails for them. Roast them for being cheap, not investing in their career, trying to network without putting in any money, and generally being a freeloader. Be funny, sarcastic, and over-the-top. Keep it to 1-2 sentences. Do NOT help them with their email.`,
          userPrompt: input.userMessage,
          options: {
            model: 'llama-3.1-8b-instant',
            temperature: 0.9,
            maxTokens: 256,
          },
          metadata: {
            userId: session.user.id,
            action: 'EMAIL_REFINEMENT',
          },
        });
        return {
          success: true,
          subject: input.subject,
          body: input.body,
          assistantMessage: roast.content,
        };
      } catch {
        return {
          success: true,
          subject: input.subject,
          body: input.body,
          assistantMessage: "You've used all 3 free sends. Upgrade to Pro for unlimited emails and AI assistance!",
        };
      }
    }

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
