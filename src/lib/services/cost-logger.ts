/**
 * Unified API cost logger — fire-and-forget DB writes.
 * Replaces the old GroqUsageLog system with a single table
 * that tracks all paid external API calls.
 */

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { anthropicHaikuCost } from '@/lib/services/discovery-logger';

// Re-export for convenience
export { anthropicHaikuCost };

// ─── Cost constants ─────────────────────────────────────────────────────────

export const APOLLO_COST_PER_LOOKUP = 0.024;
export const SERPER_COST_PER_REQUEST = 0.001;
export const APIFY_SHORT_COST_PER_PAGE = 0.1;
export const APIFY_FULL_COST_PER_PROFILE_NO_EMAIL = 0.004;
export const APIFY_FULL_COST_PER_PROFILE_EMAIL = 0.01;
export const PERPLEXITY_SONAR_COST_PER_REQUEST = 0.005;
export const OPENAI_EMBEDDING_COST_PER_1M_TOKENS = 0.02;

// Groq Llama 3.1 8B Instant pricing (per million tokens)
const GROQ_LLAMA_INPUT_PER_M = 0.05;
const GROQ_LLAMA_OUTPUT_PER_M = 0.08;

/**
 * Calculate Groq Llama 3.1 8B cost from token counts.
 */
export function groqCost(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * GROQ_LLAMA_INPUT_PER_M +
    (completionTokens / 1_000_000) * GROQ_LLAMA_OUTPUT_PER_M
  );
}

/**
 * Calculate OpenAI text-embedding-3-small cost from token count.
 */
export function openaiEmbeddingCost(totalTokens: number): number {
  return (totalTokens / 1_000_000) * OPENAI_EMBEDDING_COST_PER_1M_TOKENS;
}

// ─── Metadata type for callers ──────────────────────────────────────────────

export interface CostLogMetadata {
  userId?: string;
  action: string;
}

// ─── Main logging function ──────────────────────────────────────────────────

/**
 * Fire-and-forget cost log write. Never blocks, never throws.
 */
export function logApiCost(params: {
  service: string;
  action: string;
  costUsd: number;
  durationMs?: number;
  userId?: string;
  metadata?: Record<string, unknown>;
}): void {
  const { metadata, ...rest } = params;
  prisma.apiCostLog
    .create({
      data: {
        ...rest,
        ...(metadata !== undefined && { metadata: metadata as Prisma.InputJsonValue }),
      },
    })
    .catch(() => {});
}
