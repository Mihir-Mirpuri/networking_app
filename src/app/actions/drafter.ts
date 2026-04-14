'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RecipientContext, IdentifiedGap } from '@/lib/services/drafter';
import { analyzeTemplateGaps, processGapResponse } from '@/lib/services/drafter/gap-analysis';
import { generateDraft, refineDraft } from '@/lib/services/drafter/draft-generation';

// ============================================================================
// Analyze Template Gaps Action
// ============================================================================

interface AnalyzeTemplateGapsInput {
  template: string;
  recipientContext: RecipientContext;
}

type AnalyzeTemplateGapsResult =
  | {
      success: true;
      gaps: IdentifiedGap[];
      nextQuestion: string | null;
      isComplete: boolean;
    }
  | {
      success: false;
      error: string;
    };

export async function analyzeTemplateGapsAction(
  input: AnalyzeTemplateGapsInput
): Promise<AnalyzeTemplateGapsResult> {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    const result = await analyzeTemplateGaps(
      input.template,
      input.recipientContext,
      userId
    );

    return {
      success: true,
      gaps: result.gaps,
      nextQuestion: result.nextQuestion,
      isComplete: result.isComplete,
    };
  } catch (error) {
    console.error('[analyzeTemplateGapsAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to analyze template',
    };
  }
}

// ============================================================================
// Process Gap Response Action
// ============================================================================

interface ProcessGapResponseInput {
  userResponse: string;
  currentGapKey: string;
  remainingGaps: IdentifiedGap[];
  answeredGaps: Record<string, string>;
}

type ProcessGapResponseResult =
  | {
      success: true;
      extractedAnswer: string;
      nextQuestion: string | null;
      isComplete: boolean;
      updatedAnswers: Record<string, string>;
    }
  | {
      success: false;
      error: string;
    };

export async function processGapResponseAction(
  input: ProcessGapResponseInput
): Promise<ProcessGapResponseResult> {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    const result = await processGapResponse(
      input.userResponse,
      input.currentGapKey,
      input.remainingGaps,
      input.answeredGaps,
      userId
    );

    return {
      success: true,
      extractedAnswer: result.extractedAnswer,
      nextQuestion: result.nextQuestion,
      isComplete: result.isComplete,
      updatedAnswers: result.updatedAnswers,
    };
  } catch (error) {
    console.error('[processGapResponseAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process response',
    };
  }
}

// ============================================================================
// Generate Draft Action
// ============================================================================

interface GenerateDraftInput {
  template: string;
  recipientContext: RecipientContext;
  userAnswers: Record<string, string>;
  userInstructions?: string;
}

type GenerateDraftResult =
  | {
      success: true;
      subject: string;
      body: string;
    }
  | {
      success: false;
      error: string;
    };

export async function generateDraftAction(
  input: GenerateDraftInput
): Promise<GenerateDraftResult> {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    const result = await generateDraft(
      {
        template: input.template,
        recipientContext: input.recipientContext,
        userAnswers: input.userAnswers,
        userInstructions: input.userInstructions,
      },
      userId
    );

    return {
      success: true,
      subject: result.subject,
      body: result.body,
    };
  } catch (error) {
    console.error('[generateDraftAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate draft',
    };
  }
}

// ============================================================================
// Refine Draft Action
// ============================================================================

interface RefineDraftInput {
  currentDraft: { subject: string; body: string };
  userMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  recipientContext: RecipientContext;
}

type RefineDraftResult =
  | {
      success: true;
      subject: string;
      body: string;
      assistantMessage: string;
    }
  | {
      success: false;
      error: string;
    };

export async function refineDraftAction(
  input: RefineDraftInput
): Promise<RefineDraftResult> {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    const result = await refineDraft(
      {
        currentDraft: input.currentDraft,
        userMessage: input.userMessage,
        conversationHistory: input.conversationHistory,
        recipientContext: input.recipientContext,
      },
      userId
    );

    return {
      success: true,
      subject: result.subject,
      body: result.body,
      assistantMessage: result.assistantMessage,
    };
  } catch (error) {
    console.error('[refineDraftAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to refine draft',
    };
  }
}
