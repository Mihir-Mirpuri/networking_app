'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { completeJsonAnthropic } from '@/lib/services/anthropic';
import { GroqAction } from '@prisma/client';
import { fetchCompaniesForCategory, PerplexityCompany } from '@/lib/services/perplexity';
import prisma from '@/lib/prisma';
import { LinkedInFilters } from '@/lib/types/linkedin-filters';
import { resolveCompanyUrl } from '@/lib/services/company-resolver';
import { isUserBlocked } from '@/lib/services/credits';
import { sanitizeLinkedInFilters } from '@/lib/services/linkedin-filter-validator';
import { log, createLoggerForQuery, withLogger } from '@/lib/services/discovery-logger';

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
  linkedin_filters: {
    search_query?: string;
    locations?: string[];
    current_companies?: string[];
    past_companies?: string[];
    schools?: string[];
    current_job_titles?: string[];
    past_job_titles?: string[];
    seniority_level_ids?: string[];
    function_ids?: string[];
    company_headcount?: string[];
    years_of_experience_ids?: string[];
    years_at_current_company_ids?: string[];
    recently_changed_jobs?: boolean;
    exclude_locations?: string[];
    exclude_current_companies?: string[];
    exclude_seniority_level_ids?: string[];
    exclude_function_ids?: string[];
  };
  company_name_ambiguous?: boolean;
  person_name?: string;
  person_company?: string;
  selectables?: Array<{ label: string; filter_key: 'company' | 'role'; filter_value: string }>;
  suggested_searches?: Array<{ label: string; company: string; role: string | null }>;
  message: string;
}

export type ExtractFiltersResult =
  | { success: true; status: 'ready'; filters: ParsedFilters; linkedInFilters: LinkedInFilters; assistantMessage: string; suggestedSearches: SuggestedSearch[]; companyNameAmbiguous?: boolean }
  | { success: true; status: 'needs_selection'; filters: ParsedFilters; assistantMessage: string; selectables: Selectable[]; allSelectables?: Selectable[] }
  | { success: true; status: 'person_lookup'; assistantMessage: string; personName: string; personCompany?: string }
  | { success: true; status: 'off_topic'; filters: ParsedFilters; assistantMessage: string }
  | { success: true; status: 'blocked'; assistantMessage: string }
  | { success: false; error: string };

const SYSTEM_PROMPT = `You are a search filter extraction assistant for a professional networking tool. Your job is to help users find people by extracting structured search filters from natural language.

A search requires exactly ONE company. Role is optional but recommended. You also extract optional filters: university, location.

You must return JSON with this schema:
{
  "status": "ready" | "needs_selection" | "off_topic" | "person_lookup",
  "confidence": "high" | "low",
  "filters": { "company": string|null, "role": string|null, "university": string|null, "location": string|null },
  "linkedin_filters": {
    "search_query": string|null,
    "locations": string[]|null,
    "current_companies": string[]|null,
    "past_companies": string[]|null,
    "schools": string[]|null,
    "current_job_titles": string[]|null,
    "past_job_titles": string[]|null,
    "seniority_level_ids": string[]|null,
    "function_ids": string[]|null,
    "company_headcount": string[]|null,
    "years_of_experience_ids": string[]|null,
    "years_at_current_company_ids": string[]|null,
    "recently_changed_jobs": boolean|null,
    "exclude_locations": string[]|null,
    "exclude_current_companies": string[]|null,
    "exclude_seniority_level_ids": string[]|null,
    "exclude_function_ids": string[]|null
  },
  "company_name_ambiguous": boolean,
  "person_name": string|null,
  "person_company": string|null,
  "selectables": [{ "label": string, "filter_key": "company"|"role", "filter_value": string }],
  "suggested_searches": [{ "label": string, "company": string, "role": string|null }],
  "message": string
}

STATUS RULES:
- "person_lookup": User names a SPECIFIC PERSON by first + last name (e.g., "Find John Smith", "Look up Jane Doe at Google"). Return "person_name" and optional "person_company". Takes priority over "ready" when a full name is clearly provided.
- "ready": Company is a SPECIFIC named entity. Role is optional — if not mentioned, set role to null and still return "ready".
- "needs_selection": User named a category (see ANTI-CATEGORY RULE) or multiple companies or an ambiguous role. Return up to 5 selectables.
- "off_topic": Message is unrelated to finding professional contacts.

ANTI-CATEGORY RULE (critical):
The "company" field accepts ONLY specific, real, named companies (Anthropic, Stripe, Goldman Sachs, Meta).
The following are NEVER valid as "company" values — they MUST trigger "needs_selection":
- Category labels: "YC companies", "Y Combinator startups", "FAANG", "MAANG", "big tech", "big 4", "Big Four", "MBB", "bulge bracket", "top consulting firms", "top banks", "magic circle", "hedge funds"
- Stage descriptors: "startups", "seed-stage", "Series A", "Series B", "fintech startups", "AI startups", "climate tech", "unicorns", "seed startups"
- Industry categories: "tech companies", "consulting firms", "investment banks", "law firms", "agencies"
- Vague groupings: "top X", "best X", "leading X", "biggest X", "emerging X"
If the user names any of these, return "needs_selection" with 5 specific real companies you're confident match the category. If you cannot list specific real companies (e.g., niche/emerging), set confidence: "low" and return your best guesses.

PERSON LOOKUP RULES:
- Requires first AND last name. Single name like "John" is NOT enough — return "off_topic" asking for a last name.
- Do NOT use "person_lookup" for role-based searches like "engineers at Google" — those are "ready".

FILTER RULES:
1. If a filter was previously set and the user doesn't mention it, KEEP the previous value. Example: filters={"company":"Google"} and user says "and in NYC" → add location "New York, New York", keep company "Google". But "try banks instead" → replace company entirely.
2. "at [X]" = company. "from [X]" = university.
3. ROLE NORMALIZATION: normalize informal/abbreviated terms to standard LinkedIn titles. Examples: "PMs" → "Product Manager", "SWEs" → "Software Engineer", "devs" → "Software Engineer", "quants" → "Quantitative Researcher". If already standard (e.g., "Software Engineer", "Consultant"), keep as-is.
4. LOCATIONS: US → "City, State" (e.g., "SF" → "San Francisco, California", "NYC" → "New York, New York", "Austin" → "Austin, Texas"). International → "City, Country" (e.g., "London" → "London, United Kingdom", "Stockholm" → "Stockholm, Sweden").
5. Only include filters clearly indicated. Do not infer unstated filters.

LINKEDIN FILTER RULES (populated when status is "ready"):
- "search_query": Role/skill terms only (e.g., "Software Engineer"). NEVER include company name — company is handled separately.
- "locations": Full names: "New York", "San Francisco", "San Francisco Bay Area", "Stockholm". Do NOT use airport codes or abbreviations.
- "current_companies": Leave empty — post-processing populates this.
- "schools": Full official names: "MIT" → "Massachusetts Institute of Technology", "UT Austin" → "University of Texas at Austin".
- "current_job_titles": ONLY for quoted titles or explicit "exactly X" / "literally X" phrasing. Otherwise use "search_query".
- "function_ids": Use ONLY for broad discipline words ("engineers", "designers", "recruiters", "salespeople"). Never combine with search_query for the same role. Do NOT use for specific titles like "Senior Product Manager".
- "recently_changed_jobs": true for "new role", "just started", "recently joined".
- Exclude filters (exclude_locations, exclude_current_companies, exclude_seniority_level_ids, exclude_function_ids): use these for negations like "not in California" or "not at Google".
- For non-ready statuses, set linkedin_filters to {}.

LINKEDIN ID TABLES (use these exact IDs — anything else will be dropped):

seniority_level_ids:
  "100" = In Training
  "110" = Entry Level
  "120" = Senior
  "130" = Strategic
  "200" = Entry Level Manager
  "210" = Experienced Manager
  "220" = Director
  "300" = Vice President
  "310" = CXO
  "320" = Owner / Partner
Mapping: junior→["110"], senior→["120"], lead/staff→["120","130"], manager→["200","210"], director→["220"], VP→["300"], C-level/CXO→["310"], founder→["310","320"].

function_ids:
  "1"=Accounting, "2"=Administrative, "3"=Arts and Design, "4"=Business Development, "5"=Community and Social Services, "6"=Consulting, "7"=Education, "8"=Engineering, "9"=Entrepreneurship, "10"=Finance, "11"=Healthcare Services, "12"=Human Resources, "13"=Information Technology, "14"=Legal, "15"=Marketing, "16"=Media and Communication, "17"=Military and Protective Services, "18"=Operations, "19"=Product Management, "20"=Program and Project Management, "21"=Purchasing, "22"=Quality Assurance, "23"=Real Estate, "24"=Research, "25"=Sales, "26"=Customer Success and Support

company_headcount:
  "A" = Self-employed
  "B" = 1-10
  "C" = 11-50
  "D" = 51-200
  "E" = 201-500
  "F" = 501-1000
  "G" = 1001-5000
  "H" = 5001-10000
  "I" = 10001+
Mapping: startup→["B","C","D"], mid-size→["D","E","F"], large/enterprise→["G","H","I"].

years_of_experience_ids:
  "1" = < 1 year
  "2" = 1-2 years
  "3" = 3-5 years
  "4" = 6-10 years
  "5" = 10+ years

COMPANY NAME AMBIGUITY:
- "company_name_ambiguous": true for company names easily confused with common words or people's names (Chase, Block, Bolt, Square, Plaid, Hinge, Gusto, Toast, Brex, Ramp).
- false for distinctive names (McKinsey, Google, Goldman Sachs, Stripe, Anthropic, Meta, Apple, Figma).
- Default true when unsure.

SELECTABLE RULES:
- Multiple companies ("at Google and Meta") → needs_selection with one selectable per company.
- Ambiguous role for a company ("people at McKinsey") → return "ready" with role=null. Do NOT prompt for role selection unless the user explicitly asks "what roles exist at X?".
- Each selectable: { label, filter_key: "company"|"role", filter_value }.
- Selectables MUST be specific real company names — NEVER sub-categories ("YC startups", "Other seed companies").
- confidence: "high" for stable well-known categories (FAANG, MBB, bulge bracket, Big 4). "low" for niche/emerging/startup categories.

SUGGESTED SEARCH RULES:
- Only when status is "ready". Up to 4 alternatives based on user intent.

MESSAGE RULES:
- "ready": brief confirmation. No follow-up questions.
- "needs_selection": brief "pick one" prompt.
- "off_topic": friendly redirect.

EXAMPLES:

User: "PMs at Google in Austin"
→ {"status":"ready","filters":{"company":"Google","role":"Product Manager","university":null,"location":"Austin, Texas"},"linkedin_filters":{"search_query":"Product Manager","locations":["Austin"]},"selectables":[],"suggested_searches":[{"label":"PMs at Meta","company":"Meta","role":"Product Manager"},{"label":"PMs at Apple","company":"Apple","role":"Product Manager"}],"message":"Searching for Product Managers at Google in Austin!"}

User: "consultants at top consulting firms from UT Austin"
→ {"status":"needs_selection","confidence":"high","filters":{"company":null,"role":"Consultant","university":"UT Austin","location":null},"linkedin_filters":{},"selectables":[{"label":"McKinsey","filter_key":"company","filter_value":"McKinsey"},{"label":"BCG","filter_key":"company","filter_value":"BCG"},{"label":"Bain","filter_key":"company","filter_value":"Bain"},{"label":"Deloitte","filter_key":"company","filter_value":"Deloitte"},{"label":"Accenture","filter_key":"company","filter_value":"Accenture"}],"suggested_searches":[],"message":"Which consulting firm?"}

User: "find me YC companies hiring ML engineers"
→ {"status":"needs_selection","confidence":"low","filters":{"company":null,"role":"Machine Learning Engineer","university":null,"location":null},"linkedin_filters":{},"selectables":[{"label":"Anthropic","filter_key":"company","filter_value":"Anthropic"},{"label":"Scale AI","filter_key":"company","filter_value":"Scale AI"},{"label":"Cursor","filter_key":"company","filter_value":"Cursor"},{"label":"Cognition","filter_key":"company","filter_value":"Cognition"},{"label":"Perplexity","filter_key":"company","filter_value":"Perplexity"}],"suggested_searches":[],"message":"Which YC company?"}

User: "people at McKinsey"
→ {"status":"ready","filters":{"company":"McKinsey","role":null,"university":null,"location":null},"linkedin_filters":{},"selectables":[],"suggested_searches":[{"label":"Consultants at McKinsey","company":"McKinsey","role":"Consultant"},{"label":"Associates at McKinsey","company":"McKinsey","role":"Associate"}],"message":"Searching for people at McKinsey!"}

User: "engineers at Google and Meta"
→ {"status":"needs_selection","filters":{"company":null,"role":"Software Engineer","university":null,"location":null},"linkedin_filters":{},"selectables":[{"label":"Google","filter_key":"company","filter_value":"Google"},{"label":"Meta","filter_key":"company","filter_value":"Meta"}],"suggested_searches":[],"message":"Which company?"}

User: "senior engineers at Google but not in California"
→ {"status":"ready","filters":{"company":"Google","role":null,"university":null,"location":null},"linkedin_filters":{"function_ids":["8"],"seniority_level_ids":["120"],"exclude_locations":["California"]},"selectables":[],"suggested_searches":[],"message":"Searching for senior engineers at Google, excluding California!"}

User: "PMs at Spotify in Stockholm"
→ {"status":"ready","filters":{"company":"Spotify","role":"Product Manager","university":null,"location":"Stockholm, Sweden"},"linkedin_filters":{"search_query":"Product Manager","locations":["Stockholm"]},"selectables":[],"suggested_searches":[{"label":"Engineers at Spotify in Stockholm","company":"Spotify","role":"Software Engineer"}],"message":"Searching for PMs at Spotify in Stockholm!"}

User: "find me a cofounder for my AI startup"
→ {"status":"off_topic","filters":{"company":null,"role":null,"university":null,"location":null},"linkedin_filters":{},"selectables":[],"suggested_searches":[],"message":"I help you find and reach out to specific people by company or role. Try 'Find ML engineers at Anthropic' or name a cofounder you'd like to connect with."}

User: "Find John Smith at Google"
→ {"status":"person_lookup","filters":{"company":null,"role":null,"university":null,"location":null},"linkedin_filters":{},"person_name":"John Smith","person_company":"Google","selectables":[],"suggested_searches":[],"message":"Looking up John Smith at Google!"}

User: "how is the weather?"
→ {"status":"off_topic","filters":{"company":null,"role":null,"university":null,"location":null},"linkedin_filters":{},"selectables":[],"suggested_searches":[],"message":"I help you find professional contacts! Try 'Find software engineers at Google' or 'PMs at McKinsey'."}

User: "senior engineers at Citadel"
→ {"status":"ready","filters":{"company":"Citadel","role":null,"university":null,"location":null},"linkedin_filters":{"function_ids":["8"],"seniority_level_ids":["120"]},"selectables":[],"suggested_searches":[{"label":"Senior Engineers at Jane Street","company":"Jane Street","role":null},{"label":"Senior Engineers at Two Sigma","company":"Two Sigma","role":null}],"message":"Searching for senior engineers at Citadel!"}

User: "marketers at Stripe"
→ {"status":"ready","filters":{"company":"Stripe","role":null,"university":null,"location":null},"linkedin_filters":{"function_ids":["15"]},"selectables":[],"suggested_searches":[{"label":"Marketers at Square","company":"Square","role":null},{"label":"Marketers at Brex","company":"Brex","role":null}],"message":"Searching for marketers at Stripe!"}`;

/**
 * Convert snake_case linkedin_filters from LLM to camelCase LinkedInFilters.
 */
function convertLinkedInFilters(raw: LLMResponse['linkedin_filters'] | undefined): LinkedInFilters {
  if (!raw) return {};
  const result: LinkedInFilters = {};
  if (raw.search_query) result.searchQuery = raw.search_query;
  if (raw.locations?.length) result.locations = raw.locations;
  if (raw.current_companies?.length) result.currentCompanies = raw.current_companies;
  if (raw.past_companies?.length) result.pastCompanies = raw.past_companies;
  if (raw.schools?.length) result.schools = raw.schools;
  if (raw.current_job_titles?.length) result.currentJobTitles = raw.current_job_titles;
  if (raw.past_job_titles?.length) result.pastJobTitles = raw.past_job_titles;
  if (raw.seniority_level_ids?.length) result.seniorityLevelIds = raw.seniority_level_ids;
  if (raw.function_ids?.length) result.functionIds = raw.function_ids;
  if (raw.company_headcount?.length) result.companyHeadcount = raw.company_headcount;
  if (raw.years_of_experience_ids?.length) result.yearsOfExperienceIds = raw.years_of_experience_ids;
  if (raw.years_at_current_company_ids?.length) result.yearsAtCurrentCompanyIds = raw.years_at_current_company_ids;
  if (raw.recently_changed_jobs) result.recentlyChangedJobs = raw.recently_changed_jobs;
  if (raw.exclude_locations?.length) result.excludeLocations = raw.exclude_locations;
  if (raw.exclude_current_companies?.length) result.excludeCurrentCompanies = raw.exclude_current_companies;
  if (raw.exclude_seniority_level_ids?.length) result.excludeSeniorityLevelIds = raw.exclude_seniority_level_ids;
  if (raw.exclude_function_ids?.length) result.excludeFunctionIds = raw.exclude_function_ids;
  // Strip any LLM-hallucinated LinkedIn IDs before they reach Apify
  return sanitizeLinkedInFilters(result);
}

/**
 * Strip company name from search query to avoid double-filtering.
 * Case-insensitive removal with extra whitespace cleanup.
 */
function stripCompanyName(query: string, company: string): string {
  const regex = new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return query.replace(regex, '').replace(/\s{2,}/g, ' ').trim();
}

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

/**
 * Fire-and-forget: pre-cache LinkedIn URLs from Perplexity category results
 * into CompanyUrl table so resolveCompanyUrl gets a free DB hit later.
 */
function preCacheCompanyUrls(companies: PerplexityCompany[]): void {
  const withUrls = companies.filter(c => c.linkedinUrl);
  if (withUrls.length === 0) return;

  console.log(`[AI Search] Pre-caching ${withUrls.length} company LinkedIn URLs`);

  // Fire-and-forget — don't await
  Promise.all(
    withUrls.map(c =>
      prisma.companyUrl.upsert({
        where: { name: c.name.toLowerCase().trim() },
        create: { name: c.name.toLowerCase().trim(), url: c.linkedinUrl! },
        update: { url: c.linkedinUrl! },
      }).catch(err => {
        console.warn(`[AI Search] Failed to cache URL for "${c.name}":`, err);
      })
    )
  ).catch(() => {});
}

export async function extractSearchFiltersAction(
  input: ExtractFiltersInput
): Promise<ExtractFiltersResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Check if user is blocked (hit free limit and not subscribed)
  const blocked = await isUserBlocked(session.user.id);
  if (blocked) {
    return {
      success: true,
      status: 'blocked',
      assistantMessage: "You've reached your free limit. Upgrade to Pro to continue searching for people.",
    };
  }

  const logger = createLoggerForQuery(`extract:${input.message}`);
  const run = async (): Promise<ExtractFiltersResult> => {
    log.info('ai-search', 'Received query', {
      message: input.message,
      currentFilters: input.currentFilters,
      historyLength: input.conversationHistory.length,
    });
  try {
    const response = await completeJsonAnthropic<LLMResponse>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input),
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.1,
      maxTokens: 512,
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
    log.info('ai-search', 'LLM response parsed', {
      status,
      confidence,
      parsedFilters,
      personName: response.content.person_name,
      selectablesCount: (selectables || []).length,
    });

    if (status === 'off_topic') {
      log.decision('ai-search', 'off_topic branch', { message });
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
      log.decision('ai-search', 'person_lookup branch', {
        personName,
        personCompany: response.content.person_company,
      });
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

      log.decision('ai-search', 'needs_selection branch', {
        selectablesCount: parsedSelectables.length,
        confidence,
        companyNameAmbiguous: company_name_ambiguous,
      });

      // Escalate to Perplexity for niche/startup categories
      if (shouldEscalateToPerplexity(input.message, confidence, selectables || [])) {
        // Build a clean category string from Groq's understanding rather than raw user message
        const cleanCategory = message // Groq's assistant message often captures the category well
          ? extractCategoryFromContext(input.message, message, parsedSelectables)
          : input.message;
        console.log(`[AI Search] Escalating to Perplexity (confidence: ${confidence}, category: "${cleanCategory}")`);
        log.decision('ai-search', 'Escalating to Perplexity', {
          confidence,
          userMessage: input.message,
          cleanCategory,
          role: filters.role,
        });
        try {
          const perplexityCompanies = await fetchCompaniesForCategory(
            cleanCategory,
            filters.role,
            12
          );

          if (perplexityCompanies.length > 0) {
            // Pre-cache LinkedIn URLs for instant resolution when user selects a company
            preCacheCompanyUrls(perplexityCompanies);

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
            log.info('ai-search', 'Perplexity escalation result', {
              perplexityCount: perplexityCompanies.length,
              combinedCount: combined.length,
              shown: parsedSelectables.length,
            });
          }
        } catch (err) {
          console.warn('[AI Search] Perplexity escalation failed, using Groq suggestions:', err);
          log.error('ai-search', 'Perplexity escalation failed', { error: String(err) });
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

    // status === 'ready' — the new prompt's ANTI-CATEGORY RULE handles category
    // names directly, so no post-hoc category-to-Perplexity override is needed.

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

    // Convert linkedin_filters from LLM snake_case to camelCase
    const linkedInFilters = convertLinkedInFilters(response.content.linkedin_filters);
    console.log(`[AI Search] LinkedIn filters: ${JSON.stringify(linkedInFilters)}`);
    log.info('ai-search', 'LinkedIn filters built', { linkedInFilters });

    // Always resolve company URL and use currentCompanies
    if (parsedFilters.company) {
      try {
        const resolved = await resolveCompanyUrl(parsedFilters.company, parsedFilters.role || undefined);
        if (resolved.url) {
          linkedInFilters.currentCompanies = [resolved.url];
          console.log(`[AI Search] Resolved company URL: ${parsedFilters.company} → ${resolved.url}`);
          log.info('ai-search', 'Company URL resolved', {
            company: parsedFilters.company,
            url: resolved.url,
            method: 'resolveCompanyUrl',
          });
        } else {
          linkedInFilters.currentCompanies = [parsedFilters.company];
          console.log(`[AI Search] No URL found, using company name: ${parsedFilters.company}`);
          log.warn('ai-search', 'Company URL not found, using name', {
            company: parsedFilters.company,
          });
        }
        // Strip company name from searchQuery to avoid double-filtering
        if (linkedInFilters.searchQuery) {
          linkedInFilters.searchQuery = stripCompanyName(linkedInFilters.searchQuery, parsedFilters.company);
          if (!linkedInFilters.searchQuery) {
            delete linkedInFilters.searchQuery;
          }
        }
      } catch (err) {
        console.warn(`[AI Search] Company URL resolution failed for "${parsedFilters.company}":`, err);
        log.error('ai-search', 'Company URL resolution threw', {
          company: parsedFilters.company,
          error: String(err),
        });
        // Fallback: use company name in currentCompanies
        linkedInFilters.currentCompanies = [parsedFilters.company];
      }
    }

    console.log(`[AI Search] Ready with ${parsedSuggestions.length} suggested searches`);
    log.info('ai-search', 'Returning ready', {
      filters: parsedFilters,
      linkedInFilters,
      suggestionsCount: parsedSuggestions.length,
    });

    return {
      success: true,
      status: 'ready',
      filters: parsedFilters,
      linkedInFilters,
      assistantMessage: message,
      suggestedSearches: parsedSuggestions,
      companyNameAmbiguous: company_name_ambiguous,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      log.error('ai-search', 'Filter extraction threw', {
        error: String(error),
        isSyntaxError: true,
      });
      return {
        success: false,
        error: "I couldn't understand that. Could you rephrase your search?",
      };
    }
    console.error('[AI Search] Filter extraction error:', error);
    log.error('ai-search', 'Filter extraction threw', {
      error: String(error),
      isSyntaxError: false,
    });
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    };
  }
  };

  if (logger) {
    try {
      const result = await withLogger(logger, run);
      await logger.finalize(result.success ? 'success' : 'error', result.success ? undefined : result.error);
      return result;
    } catch (err) {
      await logger.finalize('error', String(err));
      throw err;
    }
  }
  return run();
}
