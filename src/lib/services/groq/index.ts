/**
 * Groq LLM Service
 *
 * Usage:
 *   import { complete, completeJson } from '@/lib/services/groq';
 *
 *   // Text completion
 *   const response = await complete({
 *     systemPrompt: 'You are a helpful assistant.',
 *     userPrompt: 'Hello!',
 *   });
 *
 *   // JSON completion with type safety
 *   interface MyResponse { name: string; age: number; }
 *   const jsonResponse = await completeJson<MyResponse>({
 *     systemPrompt: 'Extract name and age as JSON.',
 *     userPrompt: 'John is 25 years old.',
 *   });
 */

// Client functions
export { complete, completeJson } from './client';

// Types
export type {
  GroqModel,
  GroqRequestOptions,
  GroqCompletionRequest,
  GroqCompletionResponse,
  GroqErrorDetails,
} from './types';

// Errors
export {
  GroqError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqJsonParseError,
  GroqApiError,
} from './errors';
