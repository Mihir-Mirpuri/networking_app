/**
 * Types for Groq LLM service
 */

export type GroqModel =
  | 'llama-3.1-8b-instant'    // Fast, cheap - good for extraction
  | 'llama-3.3-70b-versatile'; // More capable - complex reasoning

export interface GroqRequestOptions {
  model?: GroqModel;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface GroqCompletionRequest {
  systemPrompt?: string;
  userPrompt: string;
  options?: GroqRequestOptions;
}

export interface GroqCompletionResponse<T = string> {
  content: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
}

export interface GroqErrorDetails {
  status?: number;
  code?: string;
  message: string;
  retryable: boolean;
}
