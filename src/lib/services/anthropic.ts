/**
 * Anthropic (Claude) API client for text and JSON completions.
 * Logs usage to the shared GroqUsageLog table (distinguished by the `model` field).
 */

import Anthropic from '@anthropic-ai/sdk';
import { logApiCost, anthropicHaikuCost, CostLogMetadata } from '@/lib/services/cost-logger';
import { log } from '@/lib/services/discovery-logger';

// Re-export metadata type so consumers don't need to import from cost-logger
export type { CostLogMetadata } from '@/lib/services/cost-logger';

// Singleton client
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export interface AnthropicRequest {
  systemPrompt?: string;
  userPrompt: string;
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  };
  metadata?: CostLogMetadata;
}

export interface AnthropicResponse<T = string> {
  content: T;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

// Legacy interface kept for backwards compatibility with existing callers
interface AnthropicJsonRequest {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: CostLogMetadata;
}

interface AnthropicJsonResponse<T> {
  content: T;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

/**
 * Send a completion request to Claude and parse the response as JSON.
 */
export async function completeJsonAnthropic<T>(
  request: AnthropicJsonRequest
): Promise<AnthropicJsonResponse<T>> {
  const {
    systemPrompt,
    userPrompt,
    model = 'claude-haiku-4-5-20251001',
    temperature = 0.3,
    maxTokens = 1500,
    metadata,
  } = request;

  const anthropic = getClient();
  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      // Wrap the system prompt in a cache_control block so Anthropic caches
      // it server-side. Cached reads cost ~10% of normal input tokens, so
      // any user who issues ≥2 queries within a 5-min window pays ~$0.0004
      // per subsequent query instead of ~$0.004.
      ...(systemPrompt
        ? {
            system: [
              {
                type: 'text' as const,
                text: systemPrompt,
                cache_control: { type: 'ephemeral' as const },
              },
            ],
          }
        : {}),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const durationMs = Date.now() - startTime;
    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    const usage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    // Anthropic prompt caching telemetry. Field names may lag SDK types —
    // cast to any to read them safely. Undefined → 0.
    const cacheCreationTokens =
      (response.usage as unknown as { cache_creation_input_tokens?: number })
        .cache_creation_input_tokens ?? 0;
    const cacheReadTokens =
      (response.usage as unknown as { cache_read_input_tokens?: number })
        .cache_read_input_tokens ?? 0;

    if (metadata) {
      logApiCost({
        service: 'anthropic',
        action: metadata.action,
        costUsd: response.model.includes('haiku')
          ? anthropicHaikuCost(usage.promptTokens, usage.completionTokens, cacheReadTokens, cacheCreationTokens)
          : 0,
        durationMs,
        userId: metadata.userId,
        metadata: {
          model: response.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cacheCreationTokens,
          cacheReadTokens,
        },
      });
    }

    const cleanedText = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleanedText) as T;

    // Emit structured log entry (no-op when logger not in context).
    log.llm('anthropic', {
      provider: 'anthropic',
      model: response.model,
      systemPrompt,
      userPrompt,
      rawResponse: text,
      parsedResponse: parsed,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cacheCreationTokens,
      cacheReadTokens,
      durationMs,
      costUsd: response.model.includes('haiku')
        ? anthropicHaikuCost(
            usage.promptTokens,
            usage.completionTokens,
            cacheReadTokens,
            cacheCreationTokens
          )
        : undefined,
    });

    return { content: parsed, usage, model: response.model };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    if (metadata) {
      logApiCost({
        service: 'anthropic',
        action: metadata.action,
        costUsd: 0,
        durationMs,
        userId: metadata.userId,
        metadata: { model, error: true },
      });
    }
    log.llm('anthropic', {
      provider: 'anthropic',
      model,
      systemPrompt,
      userPrompt,
      rawResponse: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// New unified API — drop-in replacement for Groq's complete / completeJson
// ============================================================================

/**
 * Internal helper shared by complete() and completeJson().
 * Returns the raw text response from Claude.
 */
async function callAnthropic(
  request: AnthropicRequest
): Promise<{ text: string; usage: AnthropicResponse['usage']; model: string }> {
  const {
    systemPrompt,
    userPrompt,
    options: {
      model = DEFAULT_MODEL,
      temperature = 0.3,
      maxTokens = 1500,
    } = {},
    metadata,
  } = request;

  const anthropic = getClient();
  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(systemPrompt
        ? {
            system: [
              {
                type: 'text' as const,
                text: systemPrompt,
                cache_control: { type: 'ephemeral' as const },
              },
            ],
          }
        : {}),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const durationMs = Date.now() - startTime;
    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    const usage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    const cacheCreationTokens =
      (response.usage as unknown as { cache_creation_input_tokens?: number })
        .cache_creation_input_tokens ?? 0;
    const cacheReadTokens =
      (response.usage as unknown as { cache_read_input_tokens?: number })
        .cache_read_input_tokens ?? 0;

    if (metadata) {
      logApiCost({
        service: 'anthropic',
        action: metadata.action,
        costUsd: response.model.includes('haiku')
          ? anthropicHaikuCost(usage.promptTokens, usage.completionTokens, cacheReadTokens, cacheCreationTokens)
          : 0,
        durationMs,
        userId: metadata.userId,
        metadata: {
          model: response.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cacheCreationTokens,
          cacheReadTokens,
        },
      });
    }

    log.llm('anthropic', {
      provider: 'anthropic',
      model: response.model,
      systemPrompt,
      userPrompt,
      rawResponse: text,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cacheCreationTokens,
      cacheReadTokens,
      durationMs,
      costUsd: response.model.includes('haiku')
        ? anthropicHaikuCost(
            usage.promptTokens,
            usage.completionTokens,
            cacheReadTokens,
            cacheCreationTokens
          )
        : undefined,
    });

    return { text, usage, model: response.model };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    if (metadata) {
      logApiCost({
        service: 'anthropic',
        action: metadata.action,
        costUsd: 0,
        durationMs,
        userId: metadata.userId,
        metadata: { model, error: true },
      });
    }
    log.llm('anthropic', {
      provider: 'anthropic',
      model,
      systemPrompt,
      userPrompt,
      rawResponse: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Text completion via Claude. Drop-in replacement for Groq's complete().
 */
export async function complete(
  request: AnthropicRequest
): Promise<AnthropicResponse<string>> {
  const { text, usage, model } = await callAnthropic(request);
  return { content: text, usage, model };
}

/**
 * JSON completion via Claude. Drop-in replacement for Groq's completeJson().
 * Strips markdown fences and parses the response as JSON.
 */
export async function completeJson<T>(
  request: AnthropicRequest
): Promise<AnthropicResponse<T>> {
  const { text, usage, model } = await callAnthropic(request);

  const cleanedText = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleanedText) as T;
    return { content: parsed, usage, model };
  } catch {
    throw new Error(`Failed to parse Anthropic JSON response: ${cleanedText.slice(0, 200)}`);
  }
}
