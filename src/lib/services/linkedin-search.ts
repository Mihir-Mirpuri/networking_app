/**
 * LinkedIn Short Profile Search Service
 *
 * Uses Apify actor `harvestapi/linkedin-profile-search` in Short mode
 * to discover LinkedIn profiles via LinkedIn's native search filters.
 *
 * Short mode: $0.10 per search page (25 profiles per page, ~6s latency)
 *
 * Returns basic profile data: name, current company/role, location, picture.
 * Does NOT return: education, experience history, skills, about section.
 */

import { ApifyClient } from 'apify-client';
import { log, APIFY_SHORT_COST_PER_PAGE } from '@/lib/services/discovery-logger';
import { logApiCost, APIFY_SHORT_COST_PER_PAGE as APIFY_SHORT_COST } from '@/lib/services/cost-logger';

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const ACTOR_ID = 'harvestapi/linkedin-profile-search';
const COST_PER_PAGE_CENTS = 10; // $0.10 per search page

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Input parameters for LinkedIn profile search.
 * Maps directly to the Apify actor's input schema.
 */
export interface LinkedInSearchParams {
  // Search
  searchQuery?: string;
  maxItems?: number;

  // Primary filters
  locations?: string[];
  currentCompanies?: string[];       // LinkedIn company URLs
  pastCompanies?: string[];          // LinkedIn company URLs
  schools?: string[];                // School names (e.g., "Stanford University")
  currentJobTitles?: string[];
  pastJobTitles?: string[];
  firstNames?: string[];
  lastNames?: string[];
  yearsOfExperienceIds?: string[];
  yearsAtCurrentCompanyIds?: string[];
  seniorityLevelIds?: string[];
  functionIds?: string[];
  profileLanguages?: string[];
  companyHeadcount?: string[];
  companyHeadquarterLocations?: string[];
  recentlyChangedJobs?: boolean;

  // Exclude filters
  excludeLocations?: string[];
  excludeCurrentCompanies?: string[];
  excludePastCompanies?: string[];
  excludeSchools?: string[];
  excludeCurrentJobTitles?: string[];
  excludePastJobTitles?: string[];
  excludeSeniorityLevelIds?: string[];
  excludeFunctionIds?: string[];
  excludeCompanyHeadquarterLocations?: string[];

  // Pagination
  startPage?: number;                // default 1, min 1, max 100
  takePages?: number;                // default 1, max 100. Each page = 25 profiles
}

/**
 * Raw profile from the Apify Short mode response.
 */
interface ApifyShortProfile {
  id: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  summary?: string | null;
  openProfile: boolean;
  premium: boolean;
  pictureUrl?: string | null;
  currentPositions?: Array<{
    companyName: string;
    companyId?: string;
    companyLinkedinUrl?: string;
    title: string;
    current: boolean;
    description?: string | null;
    tenureAtPosition?: { numYears?: number; numMonths?: number };
    tenureAtCompany?: { numYears?: number; numMonths?: number };
    startedOn?: { month?: number; year?: number };
  }>;
  location?: {
    linkedinText: string;
  };
  _meta?: {
    pagination: {
      totalElements: number;
      totalPages: number;
      pageNumber: number;
      previousElements: number;
      pageSize: number;
    };
  };
}

/**
 * Parsed short profile matching our domain model.
 */
export interface ShortProfileResult {
  linkedinId: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  fullName: string;
  summary: string | null;
  company: string | null;
  companyLinkedinUrl: string | null;
  role: string | null;
  tenureMonths: number | null;
  startedOn: { month: number; year: number } | null;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pictureUrl: string | null;
  openProfile: boolean;
  premium: boolean;
}

export interface PaginationMeta {
  totalElements: number;
  totalPages: number;
  pageNumber: number;
  pageSize: number;
}

export interface LinkedInSearchResult {
  profiles: ShortProfileResult[];
  pagination: PaginationMeta;
  cost: {
    shortModePages: number;
    costCents: number;
  };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse location text into city, state, country.
 * Input: "San Francisco, California, United States"
 */
const KNOWN_COUNTRIES = new Set([
  'united states', 'united kingdom', 'canada', 'australia', 'india',
  'germany', 'france', 'brazil', 'mexico', 'japan', 'china', 'singapore',
  'ireland', 'israel', 'netherlands', 'spain', 'italy', 'sweden',
  'switzerland', 'south korea', 'united arab emirates', 'malaysia',
  'south africa', 'new zealand', 'philippines', 'indonesia', 'thailand',
  'vietnam', 'poland', 'belgium', 'austria', 'denmark', 'norway',
  'finland', 'portugal', 'czech republic', 'romania', 'hungary',
  'colombia', 'argentina', 'chile', 'peru', 'nigeria', 'kenya',
  'egypt', 'pakistan', 'bangladesh', 'sri lanka', 'taiwan',
  'hong kong', 'états-unis', 'usa',
]);

const US_STATES = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
  'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina',
  'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas',
  'utah', 'vermont', 'virginia', 'washington', 'west virginia',
  'wisconsin', 'wyoming', 'district of columbia',
  // Abbreviations
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi',
  'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi',
  'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc',
  'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut',
  'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc',
]);

/** Returns true if the string looks like a US state or region (e.g. "Texas Metropolitan Area") */
function isUSStateOrRegion(s: string): boolean {
  const lower = s.toLowerCase();
  if (US_STATES.has(lower)) return true;
  // Handle "Texas Metropolitan Area", "Texas Area", "Virginia Area", etc.
  const stripped = lower.replace(/\s*(metropolitan\s+)?area$/i, '').trim();
  return US_STATES.has(stripped);
}

function parseLocationText(text: string | null | undefined): {
  city: string | null;
  state: string | null;
  country: string | null;
} {
  if (!text) return { city: null, state: null, country: null };

  const parts = text.split(',').map(p => p.trim());

  if (parts.length >= 3) {
    return { city: parts[0], state: parts[1], country: parts[2] };
  } else if (parts.length === 2) {
    const second = parts[1];
    // If the second part is a US state/region, it's "City, State" (not "City, Country")
    if (isUSStateOrRegion(second)) {
      return { city: parts[0], state: second, country: 'United States' };
    }
    // If it's a known country, it's "City, Country"
    if (KNOWN_COUNTRIES.has(second.toLowerCase())) {
      return { city: parts[0], state: null, country: second };
    }
    // Default: assume "City, State/Region" (most LinkedIn profiles are US-based)
    return { city: parts[0], state: second, country: null };
  } else if (parts.length === 1) {
    if (KNOWN_COUNTRIES.has(parts[0].toLowerCase())) {
      return { city: null, state: null, country: parts[0] };
    }
    return { city: parts[0], state: null, country: null };
  }

  return { city: null, state: null, country: null };
}

/**
 * Compute tenure in months from Apify tenure object.
 */
function computeTenureMonths(tenure?: { numYears?: number; numMonths?: number }): number | null {
  if (!tenure) return null;
  return (tenure.numYears || 0) * 12 + (tenure.numMonths || 0);
}

/**
 * Parse a raw Apify short profile into our domain model.
 */
function parseShortProfile(raw: ApifyShortProfile): ShortProfileResult {
  const currentPos = raw.currentPositions?.[0];
  const locationText = raw.location?.linkedinText || null;
  const { city, state, country } = parseLocationText(locationText);

  return {
    linkedinId: raw.id,
    linkedinUrl: raw.linkedinUrl,
    firstName: raw.firstName || '',
    lastName: raw.lastName || '',
    fullName: `${raw.firstName || ''} ${raw.lastName || ''}`.trim(),
    summary: raw.summary || null,
    company: currentPos?.companyName || null,
    companyLinkedinUrl: currentPos?.companyLinkedinUrl || null,
    role: currentPos?.title || null,
    tenureMonths: computeTenureMonths(currentPos?.tenureAtPosition),
    startedOn: currentPos?.startedOn
      ? { month: currentPos.startedOn.month || 1, year: currentPos.startedOn.year || 0 }
      : null,
    location: locationText,
    city,
    state,
    country,
    pictureUrl: raw.pictureUrl || null,
    openProfile: raw.openProfile || false,
    premium: raw.premium || false,
  };
}

// ─── Main Search Function ────────────────────────────────────────────────────

/**
 * Search LinkedIn profiles using Short mode.
 *
 * @param params - Search filters matching LinkedIn's native filter system
 * @returns Parsed profiles, pagination metadata, and cost metrics
 */
export async function searchLinkedInShort(
  params: LinkedInSearchParams
): Promise<LinkedInSearchResult> {
  if (!APIFY_API_KEY) {
    throw new Error('APIFY_API_KEY not configured');
  }

  const client = new ApifyClient({ token: APIFY_API_KEY });

  const takePages = params.takePages || 1;
  const startPage = params.startPage || 1;

  // Build actor input — only include defined params
  const actorInput: Record<string, unknown> = {
    profileScraperMode: 'Short',
  };

  // Map our params to actor input (only set non-undefined values)
  const directMappings: Array<[keyof LinkedInSearchParams, string]> = [
    ['searchQuery', 'searchQuery'],
    ['maxItems', 'maxItems'],
    ['locations', 'locations'],
    ['currentCompanies', 'currentCompanies'],
    ['pastCompanies', 'pastCompanies'],
    ['schools', 'schools'],
    ['currentJobTitles', 'currentJobTitles'],
    ['pastJobTitles', 'pastJobTitles'],
    ['firstNames', 'firstNames'],
    ['lastNames', 'lastNames'],
    ['yearsOfExperienceIds', 'yearsOfExperienceIds'],
    ['yearsAtCurrentCompanyIds', 'yearsAtCurrentCompanyIds'],
    ['seniorityLevelIds', 'seniorityLevelIds'],
    ['functionIds', 'functionIds'],
    ['profileLanguages', 'profileLanguages'],
    ['companyHeadcount', 'companyHeadcount'],
    ['companyHeadquarterLocations', 'companyHeadquarterLocations'],
    ['recentlyChangedJobs', 'recentlyChangedJobs'],
    ['excludeLocations', 'excludeLocations'],
    ['excludeCurrentCompanies', 'excludeCurrentCompanies'],
    ['excludePastCompanies', 'excludePastCompanies'],
    ['excludeSchools', 'excludeSchools'],
    ['excludeCurrentJobTitles', 'excludeCurrentJobTitles'],
    ['excludePastJobTitles', 'excludePastJobTitles'],
    ['excludeSeniorityLevelIds', 'excludeSeniorityLevelIds'],
    ['excludeFunctionIds', 'excludeFunctionIds'],
    ['excludeCompanyHeadquarterLocations', 'excludeCompanyHeadquarterLocations'],
  ];

  for (const [paramKey, actorKey] of directMappings) {
    const value = params[paramKey];
    if (value !== undefined && value !== null) {
      // Skip empty arrays
      if (Array.isArray(value) && value.length === 0) continue;
      actorInput[actorKey] = value;
    }
  }

  actorInput.startPage = startPage;
  actorInput.takePages = takePages;

  // Log active filters for debugging (exclude pagination/mode boilerplate)
  const activeFilters = Object.entries(actorInput)
    .filter(([k, v]) => !['profileScraperMode', 'startPage', 'takePages'].includes(k) && v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  console.log(`[LinkedInSearch] Short mode search — page ${startPage}, filters: ${activeFilters || 'none'}`);

  const searchStart = Date.now();

  try {
    console.log(`[LinkedInSearch] Calling Apify actor ${ACTOR_ID}...`);
    const run = await client.actor(ACTOR_ID).call(actorInput, {
      memory: 256,
      timeout: 120,
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const rawCount = items.length;

    const profiles = (items as unknown as ApifyShortProfile[])
      .filter(item => item.id && item.firstName) // Skip malformed entries
      .map(parseShortProfile);

    const skippedCount = rawCount - profiles.length;
    if (skippedCount > 0) {
      console.warn(`[LinkedInSearch] Skipped ${skippedCount} malformed profiles out of ${rawCount} raw items`);
      log.warn('linkedin-search', `Skipped ${skippedCount} malformed profiles`, {
        rawCount, validCount: profiles.length, skippedCount,
      });
    }

    // Extract pagination from first item's _meta
    const firstItem = items[0] as unknown as ApifyShortProfile | undefined;
    const pagination: PaginationMeta = firstItem?._meta?.pagination
      ? {
          totalElements: firstItem._meta.pagination.totalElements,
          totalPages: firstItem._meta.pagination.totalPages,
          pageNumber: firstItem._meta.pagination.pageNumber,
          pageSize: firstItem._meta.pagination.pageSize,
        }
      : { totalElements: 0, totalPages: 0, pageNumber: startPage, pageSize: 25 };

    const elapsed = Date.now() - searchStart;
    console.log(
      `[LinkedInSearch] Complete — ${profiles.length} profiles returned, ${pagination.totalElements.toLocaleString()} total matches, page ${pagination.pageNumber}/${pagination.totalPages}, ${elapsed}ms, cost $${(takePages * COST_PER_PAGE_CENTS / 100).toFixed(2)}`
    );

    // Log a sample of results for debugging
    if (profiles.length > 0) {
      const sample = profiles.slice(0, 3).map(p => `${p.fullName} (${p.role || 'no role'} at ${p.company || 'no company'})`).join('; ');
      console.log(`[LinkedInSearch] Sample results: ${sample}`);
    }

    log.api('linkedin-search', {
      service: 'apify-linkedin-short',
      request: actorInput,
      response: {
        profileCount: profiles.length,
        totalElements: pagination.totalElements,
        totalPages: pagination.totalPages,
        sample: profiles.slice(0, 3).map(p => ({
          name: p.fullName,
          role: p.role,
          company: p.company,
        })),
      },
      durationMs: elapsed,
      costUsd: takePages * APIFY_SHORT_COST_PER_PAGE,
    });

    logApiCost({
      service: 'apify-short',
      action: 'SEARCH',
      costUsd: takePages * APIFY_SHORT_COST,
      durationMs: elapsed,
      metadata: {
        profileCount: profiles.length,
        totalElements: pagination.totalElements,
        pages: takePages,
        startPage,
      },
    });

    return {
      profiles,
      pagination,
      cost: {
        shortModePages: takePages,
        costCents: takePages * COST_PER_PAGE_CENTS,
      },
    };
  } catch (error) {
    const elapsed = Date.now() - searchStart;
    console.error(`[LinkedInSearch] Search failed after ${elapsed}ms:`, error instanceof Error ? error.message : error);
    log.api('linkedin-search', {
      service: 'apify-linkedin-short',
      request: actorInput,
      durationMs: elapsed,
      error: error instanceof Error ? error.message : String(error),
    });
    logApiCost({
      service: 'apify-short',
      action: 'SEARCH',
      costUsd: takePages * APIFY_SHORT_COST,
      durationMs: elapsed,
      metadata: { error: true, pages: takePages, startPage },
    });
    throw error;
  }
}
