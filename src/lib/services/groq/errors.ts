/**
 * Custom error classes for Groq service
 */

import { GroqErrorDetails } from './types';

export class GroqError extends Error {
  public readonly details: GroqErrorDetails;

  constructor(message: string, details: Partial<GroqErrorDetails> = {}) {
    super(message);
    this.name = 'GroqError';
    this.details = {
      message,
      retryable: false,
      ...details,
    };
  }
}

export class GroqRateLimitError extends GroqError {
  constructor(message = 'Rate limit exceeded') {
    super(message, { code: 'rate_limit', retryable: true });
    this.name = 'GroqRateLimitError';
  }
}

export class GroqTimeoutError extends GroqError {
  constructor(message = 'Request timed out') {
    super(message, { code: 'timeout', retryable: true });
    this.name = 'GroqTimeoutError';
  }
}

export class GroqJsonParseError extends GroqError {
  public readonly rawContent: string;

  constructor(rawContent: string, message = 'Failed to parse JSON response') {
    super(message, { code: 'json_parse_error', retryable: false });
    this.name = 'GroqJsonParseError';
    this.rawContent = rawContent;
  }
}

export class GroqApiError extends GroqError {
  constructor(status: number, message: string) {
    const retryable = status >= 500 || status === 429;
    super(message, { status, retryable });
    this.name = 'GroqApiError';
  }
}
