/**
 * Groq API client with retry logic and JSON mode support
 */

import Groq from 'groq-sdk';
import {
  GroqModel,
  GroqRequestOptions,
  GroqCompletionRequest,
  GroqCompletionResponse,
} from './types';
import {
  GroqError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqJsonParseError,
  GroqApiError,
} from './errors';

// Default configuration
const DEFAULT_MODEL: GroqModel = 'llama-3.1-8b-instant';
const DEFAULT_TEMPERATURE = 0.3; // Lower for more consistent extraction
const DEFAULT_MAX_TOKENS = 1024;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Singleton client instance
let groqClient: Groq | null = null;

/**
 * Get or create the Groq client instance
 */
function getClient(): Groq {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new GroqError('GROQ_API_KEY environment variable is not set');
    }
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt: number): number {
  return RETRY_DELAY_MS * Math.pow(2, attempt);
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof GroqError) {
    return error.details.retryable;
  }
  // Retry on network errors
  if (error instanceof Error && error.message.includes('fetch')) {
    return true;
  }
  return false;
}

/**
 * Parse and wrap Groq API errors
 */
function handleApiError(error: unknown): never {
  if (error instanceof GroqError) {
    throw error;
  }

  // Handle Groq SDK errors
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    const message = (error as { message?: string }).message || 'API error';

    if (status === 429) {
      throw new GroqRateLimitError();
    }
    throw new GroqApiError(status, message);
  }

  // Handle timeout errors
  if (error instanceof Error && error.name === 'AbortError') {
    throw new GroqTimeoutError();
  }

  // Generic error
  throw new GroqError(
    error instanceof Error ? error.message : 'Unknown error occurred'
  );
}

/**
 * Execute a completion request with retry logic
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === maxRetries) {
        handleApiError(error);
      }

      const delay = getRetryDelay(attempt);
      console.warn(
        `Groq request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  handleApiError(lastError);
}

/**
 * Send a completion request to Groq
 */
export async function complete(
  request: GroqCompletionRequest
): Promise<GroqCompletionResponse<string>> {
  const { systemPrompt, userPrompt, options = {} } = request;
  const {
    model = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
    jsonMode = false,
  } = options;

  const client = getClient();

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userPrompt });

  const completion = await executeWithRetry(() =>
    client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
    })
  );

  const content = completion.choices[0]?.message?.content || '';
  const usage = completion.usage;

  return {
    content,
    usage: {
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
    model: completion.model,
  };
}

/**
 * Send a completion request and parse the response as JSON
 */
export async function completeJson<T>(
  request: GroqCompletionRequest
): Promise<GroqCompletionResponse<T>> {
  // Force JSON mode
  const jsonRequest: GroqCompletionRequest = {
    ...request,
    options: {
      ...request.options,
      jsonMode: true,
    },
  };

  const response = await complete(jsonRequest);

  try {
    const parsed = JSON.parse(response.content) as T;
    return {
      ...response,
      content: parsed,
    };
  } catch {
    throw new GroqJsonParseError(response.content);
  }
}
