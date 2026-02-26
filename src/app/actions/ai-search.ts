'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { completeJson, GroqJsonParseError } from '@/lib/services/groq';
import { GroqAction } from '@prisma/client';

export interface ParsedFilters {
  company?: string;
  role?: string;
  university?: string;
  location?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  filters?: ParsedFilters;
}

export interface ExtractFiltersInput {
  message: string;
  conversationHistory: ChatMessage[];
  currentFilters: ParsedFilters;
}

interface LLMResponse {
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  message: string;
}

export type ExtractFiltersResult =
  | { success: true; filters: ParsedFilters; assistantMessage: string }
  | { success: false; error: string };

const SYSTEM_PROMPT = `You are a search filter extraction assistant. Your job is to extract structured search filters from natural language queries about finding professional contacts.

You must extract up to 4 filters:
- company: The company/organization name (e.g., "Google", "McKinsey", "Goldman Sachs")
- role: The job role/title (e.g., "Product Manager", "Software Engineer", "Analyst")
- university: The university/school name (e.g., "UT Austin", "Stanford", "MIT")
- location: The city, state, or region (e.g., "Austin", "New York", "San Francisco")

RULES:
1. Extract filters from the user's message. If a filter was previously set and the user doesn't mention it, KEEP the previous value.
2. If the user says something like "try X instead" or "change to X", replace the relevant filter.
3. If the user says "remove the role filter" or "any role", set that filter to null.
4. If no company is extracted and none was previously set, your message MUST ask the user to specify a company.
5. Be smart about interpreting queries: "PMs" = "Product Manager", "SWEs" = "Software Engineer", "bankers" = role in banking context.
6. For university abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
7. Your message should be a brief, friendly confirmation of what you're searching for, or a clarifying question.

Respond with JSON: { "filters": { "company": string|null, "role": string|null, "university": string|null, "location": string|null }, "message": string }`;

function buildUserPrompt(input: ExtractFiltersInput): string {
  const parts: string[] = [];

  // Add conversation history (last 10 messages)
  const recentHistory = input.conversationHistory.slice(-10);
  if (recentHistory.length > 0) {
    parts.push('Conversation history:');
    for (const msg of recentHistory) {
      parts.push(`${msg.role}: ${msg.content}`);
    }
    parts.push('');
  }

  // Add current active filters
  const activeFilters = Object.entries(input.currentFilters).filter(([, v]) => v);
  if (activeFilters.length > 0) {
    parts.push(`Current active filters: ${JSON.stringify(input.currentFilters)}`);
    parts.push('');
  }

  parts.push(`New user message: ${input.message}`);

  return parts.join('\n');
}

export async function extractSearchFiltersAction(
  input: ExtractFiltersInput
): Promise<ExtractFiltersResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await completeJson<LLMResponse>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input),
      options: {
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        maxTokens: 256,
      },
      metadata: {
        userId: session.user.id,
        action: 'SEARCH_FILTER_EXTRACTION' as GroqAction,
      },
    });

    const { filters, message } = response.content;

    // Convert nulls to undefined for clean filter objects
    const parsedFilters: ParsedFilters = {};
    if (filters.company) parsedFilters.company = filters.company;
    if (filters.role) parsedFilters.role = filters.role;
    if (filters.university) parsedFilters.university = filters.university;
    if (filters.location) parsedFilters.location = filters.location;

    return {
      success: true,
      filters: parsedFilters,
      assistantMessage: message,
    };
  } catch (error) {
    if (error instanceof GroqJsonParseError) {
      return {
        success: false,
        error: "I couldn't understand that. Could you rephrase your search?",
      };
    }
    console.error('[AI Search] Filter extraction error:', error);
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    };
  }
}
