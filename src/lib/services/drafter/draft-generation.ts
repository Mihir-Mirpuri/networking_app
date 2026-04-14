/**
 * Draft generation logic for AI Email Drafter
 */

import { completeJson } from '@/lib/services/anthropic';
import { GroqAction } from '@prisma/client';
import {
  DraftGenerationInput,
  DraftGenerationResult,
  RefinementInput,
  RefinementResult,
} from './types';
import {
  DRAFT_GENERATION_SYSTEM_PROMPT,
  REFINEMENT_SYSTEM_PROMPT,
  buildDraftGenerationUserPrompt,
  buildRefinementUserPrompt,
} from './prompts';

interface DraftLLMResponse {
  subject: string;
  body: string;
}

interface RefinementLLMResponse {
  subject: string;
  body: string;
  explanation: string;
}

/**
 * Generate an email draft from template and context
 */
export async function generateDraft(
  input: DraftGenerationInput,
  userId?: string
): Promise<DraftGenerationResult> {
  const { template, recipientContext, userAnswers, userInstructions } = input;

  const userPrompt = buildDraftGenerationUserPrompt(
    template,
    recipientContext,
    userAnswers,
    userInstructions
  );

  const response = await completeJson<DraftLLMResponse>({
    systemPrompt: DRAFT_GENERATION_SYSTEM_PROMPT,
    userPrompt,
    options: {
      temperature: 0.7,
      maxTokens: 1024,
    },
    metadata: {
      userId,
      action: GroqAction.DRAFTER_GENERATION,
    },
  });

  return {
    subject: response.content.subject,
    body: response.content.body,
  };
}

/**
 * Refine an existing draft based on user feedback
 */
export async function refineDraft(
  input: RefinementInput,
  userId?: string
): Promise<RefinementResult> {
  const { currentDraft, userMessage, conversationHistory } = input;

  const userPrompt = buildRefinementUserPrompt(
    currentDraft.subject,
    currentDraft.body,
    userMessage,
    conversationHistory
  );

  const response = await completeJson<RefinementLLMResponse>({
    systemPrompt: REFINEMENT_SYSTEM_PROMPT,
    userPrompt,
    options: {
      temperature: 0.5,
      maxTokens: 1024,
    },
    metadata: {
      userId,
      action: GroqAction.DRAFTER_REFINEMENT,
    },
  });

  return {
    subject: response.content.subject,
    body: response.content.body,
    assistantMessage: response.content.explanation,
  };
}
