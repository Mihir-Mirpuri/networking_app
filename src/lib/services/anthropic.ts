/**
 * Anthropic (Claude) API client for JSON completions.
 * Logs usage to the shared GroqUsageLog table (distinguished by the `model` field).
 */

import Anthropic from '@anthropic-ai/sdk';
import { logGroqUsage, GroqUsageMetadata } from '@/lib/services/groq/logging';

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
    model = 'claude-sonnet-4-5-20250929',
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
      ...(systemPrompt ? { system: systemPrompt } : {}),
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

    if (metadata) {
      logGroqUsage(metadata, usage, response.model, durationMs);
    }

    const cleanedText = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleanedText) as T;
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
    throw error;
  }
}
