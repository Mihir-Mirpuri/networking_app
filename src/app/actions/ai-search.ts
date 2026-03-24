'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { completeJson, GroqJsonParseError } from '@/lib/services/groq';
import { GroqAction } from '@prisma/client';
import { fetchCompaniesForCategory } from '@/lib/services/perplexity';

export interface ParsedFilters {
  company?: string;
  role?: string;
  university?: string;
  location?: string;
}

export interface Selectable {
  label: string;
  filterKey: 'company' | 'role';
  filterValue: string;
}

export interface SuggestedSearch {
  label: string;
  filters: ParsedFilters;
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
  status: 'ready' | 'needs_selection' | 'off_topic';
  confidence?: 'high' | 'low';
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  selectables?: Array<{ label: string; filter_key: 'company' | 'role'; filter_value: string }>;
  suggested_searches?: Array<{ label: string; company: string; role: string | null }>;
  message: string;
}

export type ExtractFiltersResult =
  | { success: true; status: 'ready'; filters: ParsedFilters; assistantMessage: string; suggestedSearches: SuggestedSearch[] }
  | { success: true; status: 'needs_selection'; filters: ParsedFilters; assistantMessage: string; selectables: Selectable[]; allSelectables?: Selectable[] }
  | { success: true; status: 'off_topic'; filters: ParsedFilters; assistantMessage: string }
  | { success: false; error: string };

const SYSTEM_PROMPT = `You are a search filter extraction assistant for a professional networking tool. Your job is to help users find people by extracting structured search filters from natural language.

A search requires exactly ONE company and ONE role. You also extract optional filters: university, location.

You must return JSON with this schema:
{
  "status": "ready" | "needs_selection" | "off_topic",
  "confidence": "high" | "low",
  "filters": { "company": string|null, "role": string|null, "university": string|null, "location": string|null },
  "selectables": [{ "label": string, "filter_key": "company"|"role", "filter_value": string }],
  "suggested_searches": [{ "label": string, "company": string, "role": string|null }],
  "message": string
}

STATUS RULES:
- "ready": Both company AND role are clearly specified. Trigger the search.
- "needs_selection": The user mentioned a category, industry, or ambiguous term that maps to multiple companies OR multiple roles. Return up to 5 selectables for the user to choose from.
- "off_topic": The message is unrelated to finding professional contacts.

FILTER RULES:
1. If a filter was previously set and the user doesn't mention it, KEEP the previous value.
2. "try X instead" or "change to X" → replace the relevant filter.
3. "remove the role filter" or "any role" → set that filter to null.
4. Be smart about abbreviations: "PMs" = "Product Manager", "SWEs" = "Software Engineer", "bankers" could mean role in banking.
5. "at [X]" = company. "from [X]" = university. University abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
6. When the user says "No", "Nah", "that's it" in response to a question, KEEP all previous filters unchanged.
7. Always extract a company when one is clearly stated. "at Meta" = company: "Meta". Never drop it.

SELECTABLE RULES:
- When the user says a category like "top consulting firms", "big tech", "investment banks", "FAANG", return status "needs_selection" with up to 5 company selectables.
- When the user names multiple companies ("at Google and Meta"), return status "needs_selection" with each as a selectable.
- When a role is ambiguous for a given company (e.g., "people at McKinsey" — could be Consultant, Analyst, Partner), return "needs_selection" with role selectables.
- IMPORTANT: If the user explicitly names a role (even a broad one like "analyst", "engineer", "consultant", "associate"), treat it as specified and return "ready". Only return role selectables when NO role is mentioned at all (e.g., "people at Google", "someone at McKinsey").
- Each selectable has: label (display text), filter_key ("company" or "role"), filter_value (the exact value to use as the filter).
- IMPORTANT: Selectables must ALWAYS be specific, real company names (e.g., "Anthropic", "Scale AI", "Stripe") — NEVER sub-categories or groupings like "Y Combinator startups", "500 Startups portfolio", "AngelList startups", or "Other seed-stage startups". If you don't know specific companies in a niche category, return your best guesses with confidence: "low".
- When returning company selectables, also return "confidence": "high" or "low". Return "low" when the category involves startups, accelerator/YC companies, niche or emerging industries, or any companies you are unsure are current or complete. Return "high" for well-known stable categories like FAANG, MBB consulting, bulge bracket banks, Big 4 accounting, etc.

SUGGESTED SEARCH RULES:
- Only include when status is "ready".
- Suggest up to 4 alternative searches based on the user's original intent.
- If the user picked one company from a category, suggest the other companies with the same role.
- If appropriate, suggest a different role at the same company.

MESSAGE RULES:
- For "ready": brief confirmation of what you're searching. Don't ask follow-up questions.
- For "needs_selection": ask the user to pick one. Be brief.
- For "off_topic": friendly redirect suggesting they search for people.

EXAMPLES:

User: "PMs at Google in Austin"
→ {"status":"ready","filters":{"company":"Google","role":"Product Manager","university":null,"location":"Austin"},"selectables":[],"suggested_searches":[{"label":"PMs at Meta","company":"Meta","role":"Product Manager"},{"label":"PMs at Apple","company":"Apple","role":"Product Manager"},{"label":"Software Engineers at Google","company":"Google","role":"Software Engineer"}],"message":"Searching for Product Managers at Google in Austin!"}

User: "consultants at top consulting firms from UT Austin"
→ {"status":"needs_selection","filters":{"company":null,"role":"Consultant","university":"UT Austin","location":null},"selectables":[{"label":"McKinsey","filter_key":"company","filter_value":"McKinsey"},{"label":"BCG","filter_key":"company","filter_value":"BCG"},{"label":"Bain","filter_key":"company","filter_value":"Bain"},{"label":"Deloitte","filter_key":"company","filter_value":"Deloitte"},{"label":"Accenture","filter_key":"company","filter_value":"Accenture"}],"suggested_searches":[],"message":"Which consulting firm are you interested in?"}

User: "people at McKinsey"
→ {"status":"needs_selection","filters":{"company":"McKinsey","role":null,"university":null,"location":null},"selectables":[{"label":"Consultant","filter_key":"role","filter_value":"Consultant"},{"label":"Business Analyst","filter_key":"role","filter_value":"Business Analyst"},{"label":"Associate","filter_key":"role","filter_value":"Associate"},{"label":"Partner","filter_key":"role","filter_value":"Partner"},{"label":"Engagement Manager","filter_key":"role","filter_value":"Engagement Manager"}],"suggested_searches":[],"message":"What role at McKinsey are you looking for?"}

User: "engineers at Google and Meta"
→ {"status":"needs_selection","filters":{"company":null,"role":"Software Engineer","university":null,"location":null},"selectables":[{"label":"Google","filter_key":"company","filter_value":"Google"},{"label":"Meta","filter_key":"company","filter_value":"Meta"}],"suggested_searches":[],"message":"Which company would you like to search first?"}

User: "how is the weather?"
→ {"status":"off_topic","filters":{"company":null,"role":null,"university":null,"location":null},"selectables":[],"suggested_searches":[],"message":"I'm designed to help you find and reach out to professional contacts! Try something like 'Find software engineers at Google' or 'PMs at McKinsey'."}`;

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

// ─── Perplexity Escalation ──────────────────────────────────────────────────

const ESCALATION_KEYWORDS = [
  'startup', 'startups', 'yc', 'y combinator', 'accelerator',
  'seed', 'series a', 'series b', 'emerging', 'niche', 'new companies',
  'recently founded', 'unicorn', 'unicorns',
];

function shouldEscalateToPerplexity(
  message: string,
  confidence: string | undefined,
  selectables: Array<{ filter_key: string }>
): boolean {
  // Only escalate for company selectables (when they exist)
  if (selectables.length > 0 && !selectables.some(s => s.filter_key === 'company')) return false;
  // Escalate if Groq says low confidence
  if (confidence === 'low') return true;
  // Keyword fallback
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * When Groq returns status=ready but the company name is actually a category
 * (e.g., "YC companies", "climate tech startups"), we need to intercept and
 * convert to needs_selection with Perplexity-sourced companies.
 */
function isCompanyNameACategory(companyName: string | undefined): boolean {
  if (!companyName) return false;
  const lower = companyName.toLowerCase();
  // Check if it contains category-like words
  const categoryWords = [
    'companies', 'startups', 'firms', 'banks', 'agencies',
    'studios', 'labs', 'top ', 'big ', 'best ',
  ];
  return categoryWords.some(w => lower.includes(w));
}

/**
 * Extract a clean category string for Perplexity from the user message and Groq's response context.
 * e.g., "Show me some engineers at seed a startups" → "seed stage startups"
 */
function extractCategoryFromContext(
  userMessage: string,
  groqMessage: string,
  selectables: Selectable[]
): string {
  // If selectables look like sub-categories (contain words like "startups", "portfolio", "companies"),
  // they won't help us build a category — use the user message instead
  const lower = userMessage.toLowerCase();

  // Try to extract the company-category portion from user message
  // Common patterns: "at <category>", "in <category>", "from <category>"
  const atMatch = lower.match(/(?:at|in|from|for)\s+(.+?)(?:\s+(?:who|that|in|from|near|located).*)?$/);
  if (atMatch) {
    return atMatch[1].trim();
  }

  // If no pattern match, strip common prefixes like "show me", "find me", "search for"
  const stripped = lower
    .replace(/^(?:show me|find me|search for|look for|get me|i want|i need|looking for)\s+(?:some\s+)?/, '')
    .replace(/^(?:engineers?|developers?|pms?|designers?|analysts?|consultants?|people)\s+(?:at|in|from|for)\s+/, '')
    .trim();

  return stripped || userMessage;
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

    const { status, confidence, filters, selectables, suggested_searches, message } = response.content;

    // Build parsed filters (convert nulls to undefined)
    const parsedFilters: ParsedFilters = {};
    if (filters.company) parsedFilters.company = filters.company;
    if (filters.role) parsedFilters.role = filters.role;
    if (filters.university) parsedFilters.university = filters.university;
    if (filters.location) parsedFilters.location = filters.location;

    console.log(`[AI Search] Status: ${status}, Confidence: ${confidence || 'n/a'}, Filters: ${JSON.stringify(parsedFilters)}`);

    if (status === 'off_topic') {
      return {
        success: true,
        status: 'off_topic',
        filters: parsedFilters,
        assistantMessage: message,
      };
    }

    if (status === 'needs_selection') {
      let parsedSelectables: Selectable[] = (selectables || []).map(s => ({
        label: s.label,
        filterKey: s.filter_key,
        filterValue: s.filter_value,
      }));

      let allSelectables: Selectable[] | undefined;

      // Escalate to Perplexity for niche/startup categories
      if (shouldEscalateToPerplexity(input.message, confidence, selectables || [])) {
        // Build a clean category string from Groq's understanding rather than raw user message
        const cleanCategory = message // Groq's assistant message often captures the category well
          ? extractCategoryFromContext(input.message, message, parsedSelectables)
          : input.message;
        console.log(`[AI Search] Escalating to Perplexity (confidence: ${confidence}, category: "${cleanCategory}")`);
        try {
          const perplexityCompanies = await fetchCompaniesForCategory(
            cleanCategory,
            filters.role,
            12
          );

          if (perplexityCompanies.length > 0) {
            const perplexitySelectables: Selectable[] = perplexityCompanies.map(c => ({
              label: c.name,
              filterKey: 'company' as const,
              filterValue: c.name,
            }));

            // Deduplicate: remove Groq suggestions that Perplexity also returned
            const perplexityNames = new Set(perplexityCompanies.map(c => c.name.toLowerCase()));
            const uniqueGroq = parsedSelectables.filter(
              s => !perplexityNames.has(s.filterValue.toLowerCase())
            );

            // Combine: Perplexity results first, then unique Groq ones
            const combined = [...perplexitySelectables, ...uniqueGroq];
            allSelectables = combined;
            parsedSelectables = combined.slice(0, 5);

            console.log(`[AI Search] Perplexity returned ${perplexityCompanies.length} companies, showing first 5 of ${combined.length} total`);
          }
        } catch (err) {
          console.warn('[AI Search] Perplexity escalation failed, using Groq suggestions:', err);
          // Fall through — keep Groq's original selectables
        }
      }

      console.log(`[AI Search] Needs selection: ${parsedSelectables.length} options for ${parsedSelectables[0]?.filterKey || 'unknown'}`);

      return {
        success: true,
        status: 'needs_selection',
        filters: parsedFilters,
        assistantMessage: message,
        selectables: parsedSelectables,
        allSelectables,
      };
    }

    // status === 'ready' — but check if the company is actually a category that needs Perplexity
    if (isCompanyNameACategory(filters.company ?? undefined) && shouldEscalateToPerplexity(input.message, confidence, [])) {
      const cleanCategory2 = extractCategoryFromContext(input.message, message, []);
      console.log(`[AI Search] Groq returned "ready" but company "${filters.company}" looks like a category — escalating to Perplexity (category: "${cleanCategory2}")`);
      try {
        const perplexityCompanies = await fetchCompaniesForCategory(
          cleanCategory2,
          filters.role,
          12
        );

        if (perplexityCompanies.length > 0) {
          const allPerplexitySelectables: Selectable[] = perplexityCompanies.map(c => ({
            label: c.name,
            filterKey: 'company' as const,
            filterValue: c.name,
          }));

          return {
            success: true,
            status: 'needs_selection',
            filters: parsedFilters,
            assistantMessage: `I found some companies matching that. Which one are you interested in?`,
            selectables: allPerplexitySelectables.slice(0, 5),
            allSelectables: allPerplexitySelectables.length > 5 ? allPerplexitySelectables : undefined,
          };
        }
      } catch (err) {
        console.warn('[AI Search] Perplexity escalation failed for category company:', err);
        // Fall through to normal ready flow
      }
    }

    const parsedSuggestions: SuggestedSearch[] = (suggested_searches || []).map(s => ({
      label: s.label,
      filters: {
        company: s.company,
        role: s.role || undefined,
        // Carry forward university/location from current search
        university: parsedFilters.university,
        location: parsedFilters.location,
      },
    }));

    console.log(`[AI Search] Ready with ${parsedSuggestions.length} suggested searches`);

    return {
      success: true,
      status: 'ready',
      filters: parsedFilters,
      assistantMessage: message,
      suggestedSearches: parsedSuggestions,
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
