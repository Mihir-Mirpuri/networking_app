'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { completeJson, GroqJsonParseError } from '@/lib/services/groq';
import { GroqAction } from '@prisma/client';

export interface ParsedFilters {
  company?: string;
  companies?: string[]; // Multiple companies for category queries (e.g., "top consulting firms")
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
    companies: string[] | null;
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

You must extract up to 5 filters:
- company: A single company/organization name (e.g., "Google", "McKinsey", "Goldman Sachs")
- companies: An array of company names when the user asks about a category/industry (e.g., "top consulting firms" → ["McKinsey", "BCG", "Bain", "Deloitte", "Accenture"], "big tech" → ["Google", "Apple", "Amazon", "Meta", "Microsoft"]). Max 5 companies.
- role: The job role/title (e.g., "Product Manager", "Software Engineer", "Analyst")
- university: The university/school name (e.g., "UT Austin", "Stanford", "MIT")
- location: The city, state, or region (e.g., "Austin", "New York", "San Francisco")

RULES:
1. Extract filters from the user's message. If a filter was previously set and the user doesn't mention it, KEEP the previous value. This applies to ALL filters including location — e.g., "what about in Chicago?" with a previous location of "New York" should update location to "Chicago", not set it to null.
2. If the user says something like "try X instead" or "change to X", replace the relevant filter.
3. If the user says "remove the role filter" or "any role", set that filter to null.
4. If no company or companies is extracted and none was previously set, your message MUST ask the user to specify a company.
5. Be smart about interpreting queries: "PMs" = "Product Manager", "SWEs" = "Software Engineer", "bankers" = role in banking context.
6. "at [X]" almost always means company (e.g., "engineers at Meta" → company: "Meta"). "from [X]" almost always means university (e.g., "from Stanford" → university: "Stanford University").
7. For university abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
8. Your message should be a brief, friendly confirmation of what you're searching for. Do NOT ask clarifying questions about optional filters (like location) if the user has already provided enough to search (at minimum a company). Just confirm and let the search run.
9. Use "companies" (array) when the user mentions an industry or category like "consulting firms", "big tech", "investment banks", "FAANG", etc. ALSO use "companies" when the user names multiple specific companies (e.g., "at Google and Meta" → companies: ["Google", "Meta"]). Use "company" (single) ONLY when exactly one specific company is named. When "companies" is set, "company" should be null.
10. Max 5 companies in the array.
11. IMPORTANT: Always extract a company when one is clearly mentioned. "at Meta", "at Google", "at McKinsey" = company. Never drop a clearly stated company.
12. IMPORTANT: Your JSON filters must be consistent with your message. If your message mentions a location, the location filter must be set. If your message mentions a role, the role filter must be set. Never contradict your own message in the JSON output.
13. IMPORTANT: When the user says "No", "Nah", "that's it", "just that", or similar short confirmations/rejections in response to a clarifying question, KEEP all previously extracted filters unchanged. These responses mean "proceed without adding more filters", NOT "clear the filters".
14. IMPORTANT: Only ask a clarifying question if the user has NOT provided a company at all. If company/companies is set, always confirm and proceed — never ask for additional optional filters.

Respond with JSON: { "filters": { "company": string|null, "companies": string[]|null, "role": string|null, "university": string|null, "location": string|null }, "message": string }`;

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
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        maxTokens: 512,
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
    if (filters.companies && Array.isArray(filters.companies) && filters.companies.length > 0) {
      const trimmed = filters.companies.slice(0, 5);
      if (trimmed.length === 1) {
        // Single-item array → normalize to company (single)
        parsedFilters.company = trimmed[0];
      } else {
        parsedFilters.companies = trimmed;
        delete parsedFilters.company;
      }
    }
    if (filters.role) parsedFilters.role = filters.role;
    if (filters.university) parsedFilters.university = filters.university;
    if (filters.location) parsedFilters.location = filters.location;

    console.log(`[AI Search] Extracted filters: ${JSON.stringify(parsedFilters)}`);

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
