/**
 * Groq usage logging — fire-and-forget DB writes.
 * Errors are caught and logged, never thrown.
 */

import prisma from '@/lib/prisma';
import { GroqAction } from '@prisma/client';

export interface GroqUsageMetadata {
  userId?: string;
  action: GroqAction;
}

export async function logGroqUsage(
  metadata: GroqUsageMetadata,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  model: string,
  durationMs?: number,
  error?: boolean
): Promise<void> {
  try {
    await prisma.groqUsageLog.create({
      data: {
        userId: metadata.userId || null,
        action: metadata.action,
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        durationMs: durationMs ?? null,
        error: error ?? false,
      },
    });
  } catch (err) {
    console.error('[GroqUsageLog] Failed to log usage:', err);
  }
}
