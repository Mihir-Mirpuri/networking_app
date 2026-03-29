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
  skipLocationInSearch?: boolean;
  companyNameAmbiguous?: boolean;
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
  status: 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup';
  confidence?: 'high' | 'low';
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  company_name_ambiguous?: boolean;
  person_name?: string;
  person_company?: string;
  selectables?: Array<{ label: string; filter_key: 'company' | 'role'; filter_value: string }>;
  suggested_searches?: Array<{ label: string; company: string; role: string | null }>;
  message: string;
}

export type ExtractFiltersResult =
  | { success: true; status: 'ready'; filters: ParsedFilters; assistantMessage: string; suggestedSearches: SuggestedSearch[]; companyNameAmbiguous?: boolean }
  | { success: true; status: 'needs_selection'; filters: ParsedFilters; assistantMessage: string; selectables: Selectable[]; allSelectables?: Selectable[] }
  | { success: true; status: 'person_lookup'; assistantMessage: string; personName: string; personCompany?: string }
  | { success: true; status: 'off_topic'; filters: ParsedFilters; assistantMessage: string }
  | { success: false; error: string };

const SYSTEM_PROMPT = `You are a search filter extraction assistant for a professional networking tool. Your job is to help users find people by extracting structured search filters from natural language.

A search requires exactly ONE company. Role is optional but recommended. You also extract optional filters: university, location.

You must return JSON with this schema:
{
  "status": "ready" | "needs_selection" | "off_topic" | "person_lookup",
  "confidence": "high" | "low",
  "filters": { "company": string|null, "role": string|null, "university": string|null, "location": string|null },
  "company_name_ambiguous": boolean,
  "person_name": string|null,
  "person_company": string|null,
  "selectables": [{ "label": string, "filter_key": "company"|"role", "filter_value": string }],
  "suggested_searches": [{ "label": string, "company": string, "role": string|null }],
  "message": string
}

STATUS RULES:
- "person_lookup": The user is searching for a SPECIFIC PERSON by name (e.g., "Find John Smith", "Look up Jane Doe at Google", "Do you have Sarah Connor's info?"). Return the person's name in "person_name" and optional company in "person_company". This takes priority over "ready" when a person's full name (first + last) is clearly provided.
- "ready": Company is clearly specified but NO specific person name. Role is optional — if the user doesn't mention a role, set role to null and return "ready". Trigger the search.
- "needs_selection": The user mentioned a category, industry, or ambiguous term that maps to multiple companies. Return up to 5 selectables for the user to choose from.
- "off_topic": The message is unrelated to finding professional contacts.

PERSON LOOKUP RULES:
- A person lookup requires at minimum a first AND last name (e.g., "John Smith"). A single name like "John" is NOT enough — ask for a last name.
- If the user also mentions a company (e.g., "John Smith at Google"), include it in "person_company" to narrow results.
- Do NOT use "person_lookup" for generic role-based searches like "engineers at Google" — those are "ready" searches.
- Examples of person lookups: "Find John Smith", "Look up Sarah at Meta" (ask for last name), "John Smith Goldman Sachs", "Do you know Jane Doe?"

FILTER RULES:
1. If a filter was previously set and the user doesn't mention it, KEEP the previous value.
2. "try X instead" or "change to X" → replace the relevant filter.
3. "remove the role filter" or "any role" → set that filter to null.
4. ROLE NORMALIZATION: Always normalize informal, slang, or abbreviated role terms to the most common LinkedIn job title(s). The role you return must be a real title that people actually use on LinkedIn profiles.
   - Abbreviations: "PMs" → "Product Manager", "SWEs" → "Software Engineer", "BAs" → "Business Analyst", "IB" → "Investment Banking"
   - Slang/informal: "Banker" → "Investment Banking Analyst", "Consultant" → "Consultant" (already standard), "Trader" → "Trader" (already standard), "Coder" → "Software Engineer", "Dev" → "Software Engineer", "Designer" → "Product Designer", "Data guy" → "Data Scientist"
   - Finance titles: "Banker" → "Investment Banking Analyst", "Quant" → "Quantitative Researcher", "PE" → "Private Equity"
   - If the term is already a standard LinkedIn title (e.g., "Software Engineer", "Product Manager", "Consultant"), keep it as-is.
5. "at [X]" = company. "from [X]" = university. University abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
6. When the user says "No", "Nah", "that's it" in response to a question, KEEP all previous filters unchanged.
7. Always extract a company when one is clearly stated. "at Meta" = company: "Meta". Never drop it.
8. For US locations, ALWAYS normalize to "City, State" format (e.g., "Austin" → "Austin, Texas", "SF" → "San Francisco, California", "NYC" → "New York, New York", "LA" → "Los Angeles, California", "Chi" → "Chicago, Illinois"). For international locations, use "City, Country" (e.g., "London" → "London, United Kingdom"). This prevents city names from matching people's names in search results.

COMPANY NAME AMBIGUITY:
- Set "company_name_ambiguous" to true when the company name could easily be confused with a person's name or a common English word (e.g., Chase, Block, Bolt, Squire, Square, Plaid, Hinge, Gusto, Toast, Brex, Ramp).
- Set to false for distinctive, well-known company names that are unlikely to be confused (e.g., McKinsey, Google, Goldman Sachs, Stripe, Anthropic, JPMorgan, Deloitte, Microsoft, Meta, Apple, Figma, Notion).
- Default to true when unsure.

SELECTABLE RULES:
- When the user says a category like "top consulting firms", "big tech", "investment banks", "FAANG", return status "needs_selection" with up to 5 company selectables.
- When the user names multiple companies ("at Google and Meta"), return status "needs_selection" with each as a selectable.
- When a role is ambiguous for a given company (e.g., "people at McKinsey" — could be Consultant, Analyst, Partner), return "needs_selection" with role selectables.
- If the user names a role, use it. If no role is mentioned, set role to null and return "ready" — do NOT prompt for role selection unless the user's message is specifically asking what roles exist (e.g., "what roles at McKinsey?").
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
→ {"status":"ready","filters":{"company":"Google","role":"Product Manager","university":null,"location":"Austin, Texas"},"selectables":[],"suggested_searches":[{"label":"PMs at Meta","company":"Meta","role":"Product Manager"},{"label":"PMs at Apple","company":"Apple","role":"Product Manager"},{"label":"Software Engineers at Google","company":"Google","role":"Software Engineer"}],"message":"Searching for Product Managers at Google in Austin!"}

User: "consultants at top consulting firms from UT Austin"
→ {"status":"needs_selection","filters":{"company":null,"role":"Consultant","university":"UT Austin","location":null},"selectables":[{"label":"McKinsey","filter_key":"company","filter_value":"McKinsey"},{"label":"BCG","filter_key":"company","filter_value":"BCG"},{"label":"Bain","filter_key":"company","filter_value":"Bain"},{"label":"Deloitte","filter_key":"company","filter_value":"Deloitte"},{"label":"Accenture","filter_key":"company","filter_value":"Accenture"}],"suggested_searches":[],"message":"Which consulting firm are you interested in?"}

User: "people at McKinsey"
→ {"status":"ready","filters":{"company":"McKinsey","role":null,"university":null,"location":null},"selectables":[],"suggested_searches":[{"label":"Consultants at McKinsey","company":"McKinsey","role":"Consultant"},{"label":"Business Analysts at McKinsey","company":"McKinsey","role":"Business Analyst"},{"label":"Associates at McKinsey","company":"McKinsey","role":"Associate"}],"message":"Searching for people at McKinsey!"}

User: "engineers at Google and Meta"
→ {"status":"needs_selection","filters":{"company":null,"role":"Software Engineer","university":null,"location":null},"selectables":[{"label":"Google","filter_key":"company","filter_value":"Google"},{"label":"Meta","filter_key":"company","filter_value":"Meta"}],"suggested_searches":[],"message":"Which company would you like to search first?"}

User: "Find John Smith at Google"
→ {"status":"person_lookup","filters":{"company":null,"role":null,"university":null,"location":null},"person_name":"John Smith","person_company":"Google","selectables":[],"suggested_searches":[],"message":"Looking up John Smith at Google!"}

User: "Do you have Jane Doe's info?"
→ {"status":"person_lookup","filters":{"company":null,"role":null,"university":null,"location":null},"person_name":"Jane Doe","person_company":null,"selectables":[],"suggested_searches":[],"message":"Looking up Jane Doe!"}

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

    const { status, confidence, filters, company_name_ambiguous, selectables, suggested_searches, message } = response.content;

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

    if (status === 'person_lookup') {
      const personName = response.content.person_name?.trim();
      if (!personName) {
        return {
          success: true,
          status: 'off_topic',
          filters: parsedFilters,
          assistantMessage: message || "I need a first and last name to look someone up. Could you provide their full name?",
        };
      }
      console.log(`[AI Search] Person lookup: name="${personName}", company="${response.content.person_company || '(none)'}"`);
      return {
        success: true,
        status: 'person_lookup',
        assistantMessage: message,
        personName,
        personCompany: response.content.person_company?.trim() || undefined,
      };
    }

    if (status === 'needs_selection') {
      let parsedSelectables: Selectable[] = (selectables || []).map(s => ({
        label: s.label,
        filterKey: s.filter_key,
        filterValue: s.filter_value,
        companyNameAmbiguous: company_name_ambiguous,
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
              skipLocationInSearch: true,
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
            skipLocationInSearch: true,
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
      companyNameAmbiguous: company_name_ambiguous,
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
