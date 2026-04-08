'use server';

import { completeJson } from '@/lib/services/groq';
import { completeJsonAnthropic } from '@/lib/services/anthropic';
import { GroqAction } from '@prisma/client';

export interface PlaygroundFilters {
  company?: string;
  role?: string;
  university?: string;
  location?: string;
}

export interface PlaygroundMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Pipeline stage types ───────────────────────────────────────────────────

export interface LLMStage {
  raw: Record<string, unknown>;
  status: string;
  confidence?: string;
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  linkedinFilters: Record<string, unknown>;
  companyNameAmbiguous?: boolean;
  selectables?: Array<{ label: string; filter_key: string; filter_value: string }>;
  suggestedSearches?: Array<{ label: string; company: string; role: string | null }>;
  personName?: string;
  personCompany?: string;
  message: string;
}

export interface PostProcessingStep {
  label: string;
  description: string;
  applied: boolean;
  detail?: string;
}

export interface PostProcessingStage {
  steps: PostProcessingStep[];
  finalLinkedinFilters: Record<string, unknown>;
}

export interface ApifyStage {
  actorInput: Record<string, unknown>;
  estimatedCost: string;
}

export interface ModelResult {
  model: string;
  modelLabel: string;
  llm: LLMStage;
  postProcessing: PostProcessingStage;
  apify: ApifyStage;
  durationMs: number;
  tokenUsage: { prompt: number; completion: number; total: number };
  error?: string;
}

export interface PlaygroundResult {
  results: ModelResult[];
}

// Same system prompt from ai-search.ts
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
    "industry_ids": string[]|null,
    "company_headcount": string[]|null,
    "years_of_experience_ids": string[]|null,
    "years_at_current_company_ids": string[]|null,
    "recently_changed_jobs": boolean|null,
    "exclude_locations": string[]|null,
    "exclude_current_companies": string[]|null,
    "exclude_industry_ids": string[]|null,
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

LINKEDIN FILTER RULES:
When status is "ready", you MUST also populate "linkedin_filters" with structured filters for LinkedIn's search API.

- "search_query": General keyword search. Use ONLY for role/skill terms (e.g., "Software Engineer", "Product Manager"). NEVER include the company name here — company filtering is handled separately via current_companies in post-processing.
- "locations": LinkedIn location names. Use full names: "New York" (not NYC), "San Francisco" (not SF), "Los Angeles" (not LA), "San Francisco Bay Area" for broader SF area.
- "current_companies": Leave empty — we resolve company URLs and populate this in post-processing after your response.
- "schools": Full official university names: "UT Austin" → "University of Texas at Austin", "MIT" → "Massachusetts Institute of Technology", "Stanford" → "Stanford University", etc.
- "current_job_titles": Exact current title match. More precise than search_query for roles. E.g., ["Software Engineer"], ["Product Manager"].
- "seniority_level_ids": "100"=In Training, "110"=Entry Level, "120"=Senior, "130"=Strategic, "200"=Entry Level Manager, "210"=Experienced Manager, "220"=Director, "300"=VP, "310"=CXO, "320"=Owner/Partner. "junior"→["110"], "senior"→["120"], "lead/staff"→["120","130"], "manager"→["200","210"], "director"→["220"], "VP"→["300"], "C-level"→["310"], "founder"→["310","320"].
- "function_ids": "1"=Accounting, "2"=Administrative, "3"=Arts/Design, "4"=Business Development, "5"=Community, "6"=Consulting, "7"=Education, "8"=Engineering, "9"=Entrepreneurship, "10"=Finance, "11"=Healthcare, "12"=HR, "13"=IT, "14"=Legal, "15"=Marketing, "16"=Media, "17"=Military, "18"=Operations, "19"=Product Management, "20"=Program/Project Management, "21"=Purchasing, "22"=QA, "23"=Real Estate, "24"=Research, "25"=Sales, "26"=Customer Success.
- "industry_ids": "4"=Software Dev, "6"=IT Consulting, "43"=Financial Services, "44"=Banking, "41"=VC/PE, "46"=Investment Banking, "47"=Investment Management, "96"=Technology/Internet, "133"=Healthcare, "135"=Pharma, "137"=Biotech, "14"=Education, "143"=Legal Services, "147"=Advertising. "tech"→["4","6","96"], "finance"→["43","44","46","47","48"], "fintech"→["43","4"], "healthcare"→["133","135","137"].
- "company_headcount": "A"=Self-employed, "B"=1-10, "C"=11-50, "D"=51-200, "E"=201-500, "F"=501-1000, "G"=1001-5000, "H"=5001-10000, "I"=10001+. "startup"→["B","C","D"], "mid-size"→["D","E","F"], "large/enterprise"→["G","H","I"].
- "years_of_experience_ids": "1"=<1yr, "2"=1-2yr, "3"=3-5yr, "4"=6-10yr, "5"=10+yr.
- "recently_changed_jobs": true for "new role", "just started", "recently joined".
- Only include filters clearly indicated by the query. Do not infer unstated filters.
- Prefer search_query over current_job_titles unless user wants exact title match.
- For non-ready statuses (needs_selection, off_topic, person_lookup), set linkedin_filters to {}.

STATUS RULES:
- "person_lookup": The user is searching for a SPECIFIC PERSON by name (e.g., "Find John Smith", "Look up Jane Doe at Google", "Do you have Sarah Connor's info?"). Return the person's name in "person_name" and optional company in "person_company". This takes priority over "ready" when a person's full name (first + last) is clearly provided.
- "ready": Company is clearly specified but NO specific person name. Role is optional — if the user doesn't mention a role, set role to null and return "ready". Trigger the search.
- "needs_selection": The user mentioned a category, industry, or ambiguous term that maps to multiple companies. Return up to 5 selectables for the user to choose from.
- "off_topic": The message is unrelated to finding professional contacts.

PERSON LOOKUP RULES:
- A person lookup requires at minimum a first AND last name (e.g., "John Smith"). A single name like "John" is NOT enough — ask for a last name.
- If the user also mentions a company (e.g., "John Smith at Google"), include it in "person_company" to narrow results.
- Do NOT use "person_lookup" for generic role-based searches like "engineers at Google" — those are "ready" searches.

FILTER RULES:
1. If a filter was previously set and the user doesn't mention it, KEEP the previous value.
2. "try X instead" or "change to X" → replace the relevant filter.
3. "remove the role filter" or "any role" → set that filter to null.
4. ROLE NORMALIZATION: Always normalize informal, slang, or abbreviated role terms to the most common LinkedIn job title(s).
   - Abbreviations: "PMs" → "Product Manager", "SWEs" → "Software Engineer", "BAs" → "Business Analyst", "IB" → "Investment Banking"
   - Slang/informal: "Banker" → "Investment Banking Analyst", "Consultant" → "Consultant", "Trader" → "Trader", "Coder" → "Software Engineer", "Dev" → "Software Engineer", "Designer" → "Product Designer", "Data guy" → "Data Scientist"
   - Finance titles: "Banker" → "Investment Banking Analyst", "Quant" → "Quantitative Researcher", "PE" → "Private Equity"
5. "at [X]" = company. "from [X]" = university. University abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
6. When the user says "No", "Nah", "that's it" in response to a question, KEEP all previous filters unchanged.
7. Always extract a company when one is clearly stated.
8. For US locations, ALWAYS normalize to "City, State" format. For international locations, use "City, Country".

COMPANY NAME AMBIGUITY:
- Set "company_name_ambiguous" to true when the company name could easily be confused with a person's name or a common English word.
- Set to false for distinctive, well-known company names.
- Default to true when unsure.

SELECTABLE RULES:
- When the user says a category like "top consulting firms", "big tech", "investment banks", "FAANG", return status "needs_selection" with up to 5 company selectables.
- When the user names multiple companies ("at Google and Meta"), return status "needs_selection" with each as a selectable.
- Each selectable has: label (display text), filter_key ("company" or "role"), filter_value (the exact value to use as the filter).
- IMPORTANT: Selectables must ALWAYS be specific, real company names — NEVER sub-categories.

SUGGESTED SEARCH RULES:
- Only include when status is "ready".
- Suggest up to 4 alternative searches based on the user's original intent.

MESSAGE RULES:
- For "ready": brief confirmation of what you're searching.
- For "needs_selection": ask the user to pick one. Be brief.
- For "off_topic": friendly redirect suggesting they search for people.

EXAMPLES:

User: "PMs at Google in Austin"
→ {"status":"ready","filters":{"company":"Google","role":"Product Manager","university":null,"location":"Austin, Texas"},"linkedin_filters":{"search_query":"Product Manager","locations":["Austin"]},"selectables":[],"suggested_searches":[{"label":"PMs at Meta","company":"Meta","role":"Product Manager"}],"message":"Searching for Product Managers at Google in Austin!"}

User: "consultants at top consulting firms from UT Austin"
→ {"status":"needs_selection","filters":{"company":null,"role":"Consultant","university":"UT Austin","location":null},"linkedin_filters":{},"selectables":[{"label":"McKinsey","filter_key":"company","filter_value":"McKinsey"},{"label":"BCG","filter_key":"company","filter_value":"BCG"},{"label":"Bain","filter_key":"company","filter_value":"Bain"}],"suggested_searches":[],"message":"Which consulting firm are you interested in?"}

User: "senior PMs at fintech startups in NYC"
→ {"status":"ready","filters":{"company":null,"role":"Product Manager","university":null,"location":"New York, New York"},"linkedin_filters":{"search_query":"Product Manager","locations":["New York"],"seniority_level_ids":["120"],"industry_ids":["43","4"],"company_headcount":["B","C","D"]},"selectables":[],"suggested_searches":[],"message":"Searching for senior Product Managers at fintech startups in NYC!"}`;

function buildUserPrompt(
  message: string,
  conversationHistory: PlaygroundMessage[],
  currentFilters: PlaygroundFilters
): string {
  const parts: string[] = [];

  const recentHistory = conversationHistory.slice(-10);
  if (recentHistory.length > 0) {
    parts.push('Conversation history:');
    for (const msg of recentHistory) {
      parts.push(`${msg.role}: ${msg.content}`);
    }
    parts.push('');
  }

  const activeFilters = Object.entries(currentFilters).filter(([, v]) => v);
  if (activeFilters.length > 0) {
    parts.push(`Current active filters: ${JSON.stringify(currentFilters)}`);
    parts.push('');
  }

  parts.push(`New user message: ${message}`);
  return parts.join('\n');
}

function convertToCamelCase(raw: Record<string, unknown>): Record<string, unknown> {
  const mapping: Record<string, string> = {
    search_query: 'searchQuery',
    locations: 'locations',
    current_companies: 'currentCompanies',
    past_companies: 'pastCompanies',
    schools: 'schools',
    current_job_titles: 'currentJobTitles',
    past_job_titles: 'pastJobTitles',
    seniority_level_ids: 'seniorityLevelIds',
    function_ids: 'functionIds',
    industry_ids: 'industryIds',
    company_headcount: 'companyHeadcount',
    years_of_experience_ids: 'yearsOfExperienceIds',
    years_at_current_company_ids: 'yearsAtCurrentCompanyIds',
    recently_changed_jobs: 'recentlyChangedJobs',
    exclude_locations: 'excludeLocations',
    exclude_current_companies: 'excludeCurrentCompanies',
    exclude_industry_ids: 'excludeIndustryIds',
    exclude_seniority_level_ids: 'excludeSeniorityLevelIds',
    exclude_function_ids: 'excludeFunctionIds',
  };

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val === null || val === undefined) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    const camelKey = mapping[key] || key;
    result[camelKey] = val;
  }
  return result;
}

function buildPostProcessing(
  status: string,
  company: string | null,
  raw: Record<string, unknown>,
  rawLinkedinFilters: Record<string, unknown>
): PostProcessingStage {
  const steps: PostProcessingStep[] = [];
  const finalLinkedinFilters = convertToCamelCase(rawLinkedinFilters);

  if (status === 'ready' && company) {
    const simulatedUrl = `https://www.linkedin.com/company/${company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    steps.push({
      label: 'Company URL resolution (simulated)',
      description: `Perplexity: find LinkedIn URL for "${company}"`,
      applied: true,
      detail: `Would resolve to ~${simulatedUrl} → currentCompanies (playground — not called)`,
    });
    finalLinkedinFilters.currentCompanies = [simulatedUrl + ' (simulated)'];

    // Simulate stripping company name from searchQuery
    const searchQuery = finalLinkedinFilters.searchQuery as string | undefined;
    if (searchQuery) {
      const stripped = searchQuery.replace(new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').replace(/\s{2,}/g, ' ').trim();
      steps.push({
        label: 'Strip company from searchQuery',
        description: `Remove "${company}" from searchQuery to avoid double-filtering`,
        applied: stripped !== searchQuery,
        detail: stripped !== searchQuery
          ? `"${searchQuery}" → "${stripped || '(empty — removed)'}" `
          : `searchQuery "${searchQuery}" does not contain "${company}" — no change.`,
      });
      if (stripped !== searchQuery) {
        if (stripped) {
          finalLinkedinFilters.searchQuery = stripped;
        } else {
          delete finalLinkedinFilters.searchQuery;
        }
      }
    }
  } else if (status === 'ready' && !company) {
    steps.push({
      label: 'No company specified',
      description: 'Relies on industry/headcount/other filters',
      applied: true,
    });
  } else {
    steps.push({
      label: 'Non-ready status',
      description: `Status "${status}" — no post-processing`,
      applied: false,
    });
  }

  if (company && raw.company_name_ambiguous !== undefined) {
    steps.push({
      label: 'Company name ambiguity',
      description: `ambiguous = ${raw.company_name_ambiguous}`,
      applied: true,
      detail: raw.company_name_ambiguous
        ? `"${company}" could be confused with a person's name.`
        : `"${company}" is distinctive.`,
    });
  }

  return { steps, finalLinkedinFilters };
}

function buildApifyParams(status: string, finalLinkedinFilters: Record<string, unknown>): ApifyStage {
  const actorInput: Record<string, unknown> = {
    profileScraperMode: 'Short',
    startPage: 1,
    takePages: 1,
  };

  if (status === 'ready') {
    const keys = [
      'searchQuery', 'locations', 'currentCompanies', 'pastCompanies', 'schools',
      'currentJobTitles', 'pastJobTitles', 'seniorityLevelIds', 'functionIds',
      'industryIds', 'companyHeadcount', 'yearsOfExperienceIds', 'yearsAtCurrentCompanyIds',
      'recentlyChangedJobs', 'excludeLocations', 'excludeCurrentCompanies',
      'excludeIndustryIds', 'excludeSeniorityLevelIds', 'excludeFunctionIds',
    ];
    for (const key of keys) {
      const value = finalLinkedinFilters[key];
      if (value !== undefined && value !== null) {
        if (Array.isArray(value) && value.length === 0) continue;
        actorInput[key] = value;
      }
    }
  }

  return { actorInput, estimatedCost: '$0.10 per page (25 profiles)' };
}

function parseLLMResponse(raw: Record<string, unknown>): {
  status: string;
  company: string | null;
  filters: LLMStage['filters'];
  rawLinkedinFilters: Record<string, unknown>;
  llmStage: LLMStage;
} {
  const filters = (raw.filters || {}) as Record<string, string | null>;
  const rawLinkedinFilters = (raw.linkedin_filters || {}) as Record<string, unknown>;
  const status = (raw.status as string) || 'unknown';
  const company = filters.company || null;

  const llmStage: LLMStage = {
    raw,
    status,
    confidence: raw.confidence as string | undefined,
    filters: {
      company,
      role: filters.role || null,
      university: filters.university || null,
      location: filters.location || null,
    },
    linkedinFilters: rawLinkedinFilters,
    companyNameAmbiguous: raw.company_name_ambiguous as boolean | undefined,
    selectables: raw.selectables as LLMStage['selectables'],
    suggestedSearches: raw.suggested_searches as LLMStage['suggestedSearches'],
    personName: raw.person_name as string | undefined,
    personCompany: raw.person_company as string | undefined,
    message: (raw.message as string) || '',
  };

  return { status, company, filters: llmStage.filters, rawLinkedinFilters, llmStage };
}

// ─── Call Groq ──────────────────────────────────────────────────────────────

async function callGroq(userPrompt: string): Promise<ModelResult> {
  const start = Date.now();
  try {
    const response = await completeJson<Record<string, unknown>>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      options: {
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        maxTokens: 512,
      },
      metadata: {
        userId: 'playground',
        action: 'SEARCH_FILTER_EXTRACTION' as GroqAction,
      },
    });

    const durationMs = Date.now() - start;
    const { status, company, rawLinkedinFilters, llmStage } = parseLLMResponse(response.content);
    const postProcessing = buildPostProcessing(status, company, response.content, rawLinkedinFilters);
    const apify = buildApifyParams(status, postProcessing.finalLinkedinFilters);

    return {
      model: 'llama-3.3-70b-versatile',
      modelLabel: 'Groq (Llama 3.3 70B)',
      llm: llmStage,
      postProcessing,
      apify,
      durationMs,
      tokenUsage: {
        prompt: response.usage.promptTokens,
        completion: response.usage.completionTokens,
        total: response.usage.totalTokens,
      },
    };
  } catch (err) {
    return {
      model: 'llama-3.3-70b-versatile',
      modelLabel: 'Groq (Llama 3.3 70B)',
      llm: { raw: {}, status: 'error', filters: { company: null, role: null, university: null, location: null }, linkedinFilters: {}, message: '' },
      postProcessing: { steps: [], finalLinkedinFilters: {} },
      apify: { actorInput: {}, estimatedCost: '' },
      durationMs: Date.now() - start,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Call Haiku ─────────────────────────────────────────────────────────────

async function callHaiku(userPrompt: string): Promise<ModelResult> {
  const start = Date.now();
  try {
    const response = await completeJsonAnthropic<Record<string, unknown>>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.1,
      maxTokens: 512,
    });

    const durationMs = Date.now() - start;
    const { status, company, rawLinkedinFilters, llmStage } = parseLLMResponse(response.content);
    const postProcessing = buildPostProcessing(status, company, response.content, rawLinkedinFilters);
    const apify = buildApifyParams(status, postProcessing.finalLinkedinFilters);

    return {
      model: 'claude-haiku-4-5-20251001',
      modelLabel: 'Haiku 4.5',
      llm: llmStage,
      postProcessing,
      apify,
      durationMs,
      tokenUsage: {
        prompt: response.usage.promptTokens,
        completion: response.usage.completionTokens,
        total: response.usage.totalTokens,
      },
    };
  } catch (err) {
    return {
      model: 'claude-haiku-4-5-20251001',
      modelLabel: 'Haiku 4.5',
      llm: { raw: {}, status: 'error', filters: { company: null, role: null, university: null, location: null }, linkedinFilters: {}, message: '' },
      postProcessing: { steps: [], finalLinkedinFilters: {} },
      apify: { actorInput: {}, estimatedCost: '' },
      durationMs: Date.now() - start,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Main export ────────────────────────────────────────────────────────────

export type ModelChoice = 'both' | 'groq' | 'haiku';

export async function testFilterExtraction(
  message: string,
  conversationHistory: PlaygroundMessage[],
  currentFilters: PlaygroundFilters,
  modelChoice: ModelChoice = 'haiku'
): Promise<PlaygroundResult> {
  const userPrompt = buildUserPrompt(message, conversationHistory, currentFilters);

  if (modelChoice === 'groq') {
    return { results: [await callGroq(userPrompt)] };
  }
  if (modelChoice === 'haiku') {
    return { results: [await callHaiku(userPrompt)] };
  }

  // Run both in parallel
  const [groqResult, haikuResult] = await Promise.all([
    callGroq(userPrompt),
    callHaiku(userPrompt),
  ]);

  return { results: [groqResult, haikuResult] };
}
