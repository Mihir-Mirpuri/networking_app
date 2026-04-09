/**
 * Anthropic (Claude) API client for JSON completions.
 * Logs usage to the shared GroqUsageLog table (distinguished by the `model` field).
 */

import Anthropic from '@anthropic-ai/sdk';
import { logGroqUsage, GroqUsageMetadata } from '@/lib/services/groq/logging';
import { log, anthropicHaikuCost } from '@/lib/services/discovery-logger';

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

interface AnthropicJsonRequest {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: GroqUsageMetadata;
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
      logGroqUsage(metadata, usage, response.model, durationMs);
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
      logGroqUsage(
        metadata,
        { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model,
        durationMs,
        true
      );
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
