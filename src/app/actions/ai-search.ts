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
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '@/lib/prompts/search-extraction-prompt';

export interface ParsedFilters {
  company?: string;
  role?: string;
  university?: string;
  location?: string;
  roleSpecificity?: 'narrow' | 'standard' | 'broad';
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
  role_specificity?: 'narrow' | 'standard' | 'broad';
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
      systemPrompt: SEARCH_EXTRACTION_SYSTEM_PROMPT,
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
    parsedFilters.roleSpecificity = response.content.role_specificity || 'standard';

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
