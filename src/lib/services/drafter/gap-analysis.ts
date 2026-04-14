/**
 * Gap analysis logic for AI Email Drafter
 */

import { completeJson } from '@/lib/services/anthropic';
import { GroqAction } from '@prisma/client';
import {
  RecipientContext,
  IdentifiedGap,
  GapAnalysisResult,
  GapResponseResult,
} from './types';
import {
  GAP_ANALYSIS_SYSTEM_PROMPT,
  GAP_RESPONSE_SYSTEM_PROMPT,
  buildGapAnalysisUserPrompt,
  buildGapResponseUserPrompt,
} from './prompts';

interface GapAnalysisLLMResponse {
  gaps: Array<{ key: string; question: string; isRequired: boolean }>;
  alreadyKnown: Record<string, string>;
  firstQuestion: string;
}

interface GapResponseLLMResponse {
  extractedKey: string;
  extractedValue: string;
  isComplete: boolean;
  nextQuestion: string | null;
}

/**
 * Analyze a template and identify gaps that need to be filled
 */
export async function analyzeTemplateGaps(
  template: string,
  recipientContext: RecipientContext,
  userId?: string
): Promise<GapAnalysisResult> {
  const userPrompt = buildGapAnalysisUserPrompt(template, recipientContext);

  const response = await completeJson<GapAnalysisLLMResponse>({
    systemPrompt: GAP_ANALYSIS_SYSTEM_PROMPT,
    userPrompt,
    options: {
      temperature: 0.3,
      maxTokens: 1024,
    },
    metadata: {
      userId,
      action: GroqAction.DRAFTER_GAP_ANALYSIS,
    },
  });

  const { gaps, firstQuestion } = response.content;

  // Filter out gaps that are already known from recipient context
  const unknownGaps: IdentifiedGap[] = gaps.filter((gap) => {
    const key = gap.key.toLowerCase();
    if (key.includes('name') && (recipientContext.name || recipientContext.firstName)) {
      return false;
    }
    if (key.includes('company') && recipientContext.company) {
      return false;
    }
    if (key.includes('role') && recipientContext.role) {
      return false;
    }
    return true;
  });

  return {
    gaps: unknownGaps,
    nextQuestion: firstQuestion || (unknownGaps.length > 0 ? unknownGaps[0].question : null),
    isComplete: unknownGaps.length === 0,
  };
}

/**
 * Process a user's response to a gap question
 */
export async function processGapResponse(
  userResponse: string,
  currentGapKey: string,
  remainingGaps: IdentifiedGap[],
  answeredGaps: Record<string, string>,
  userId?: string
): Promise<GapResponseResult> {
  const userPrompt = buildGapResponseUserPrompt(
    userResponse,
    currentGapKey,
    remainingGaps,
    answeredGaps
  );

  const response = await completeJson<GapResponseLLMResponse>({
    systemPrompt: GAP_RESPONSE_SYSTEM_PROMPT,
    userPrompt,
    options: {
      temperature: 0.3,
      maxTokens: 512,
    },
    metadata: {
      userId,
      action: GroqAction.DRAFTER_GAP_ANALYSIS,
    },
  });

  const { extractedKey, extractedValue, isComplete, nextQuestion } = response.content;

  // Update answers with extracted value
  const updatedAnswers = {
    ...answeredGaps,
    [extractedKey || currentGapKey]: extractedValue,
  };

  return {
    extractedAnswer: extractedValue,
    nextQuestion,
    isComplete,
    updatedAnswers,
  };
}

/**
 * Extract placeholder keys from a template string
 * Useful for quick validation without LLM call
 */
export function extractPlaceholders(template: string): string[] {
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  const matches: string[] = [];
  let match;

  while ((match = placeholderRegex.exec(template)) !== null) {
    matches.push(match[1].trim());
  }

  return Array.from(new Set(matches)); // Remove duplicates
}
