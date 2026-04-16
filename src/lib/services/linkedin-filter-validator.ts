/**
 * LinkedIn filter ID validator.
 *
 * The allowlists below come from the authoritative reference tables at
 * docs/APIFY_LINKEDIN_PROFILE_SEARCH.md (sections: Seniority Level, Function,
 * Company Headcount, Years of Experience). These IDs are accepted by the
 * Apify actor `harvestapi/linkedin-profile-search` in Short mode.
 *
 * Industry IDs are validated against VALID_INDUSTRY_IDS — a curated subset
 * of LinkedIn's industry codes. The prompt's RULE 13 is the contract for
 * which IDs may be emitted.
 *
 * To update: if LinkedIn/Apify adds new IDs, update
 * docs/APIFY_LINKEDIN_PROFILE_SEARCH.md first (source of truth), then mirror
 * the change in the Set constants below.
 *
 * The sanitizer is the single boundary where LLM-hallucinated filter IDs get
 * dropped before they reach Apify, so unknown IDs produce a warning log with
 * the full list of valid IDs — making drift obvious from log output.
 */

import type { LinkedInFilters } from '@/lib/types/linkedin-filters';
import { log } from '@/lib/services/discovery-logger';

// Seniority Level — docs/APIFY_LINKEDIN_PROFILE_SEARCH.md:259-271
export const VALID_SENIORITY_IDS = new Set<string>([
  '100', // In Training
  '110', // Entry Level
  '120', // Senior
  '130', // Strategic
  '200', // Entry Level Manager
  '210', // Experienced Manager
  '220', // Director
  '300', // Vice President
  '310', // CXO
  '320', // Owner / Partner
]);

// Function — docs/APIFY_LINKEDIN_PROFILE_SEARCH.md:273-301
export const VALID_FUNCTION_IDS = new Set<string>([
  '1',  // Accounting
  '2',  // Administrative
  '3',  // Arts and Design
  '4',  // Business Development
  '5',  // Community and Social Services
  '6',  // Consulting
  '7',  // Education
  '8',  // Engineering
  '9',  // Entrepreneurship
  '10', // Finance
  '11', // Healthcare Services
  '12', // Human Resources
  '13', // Information Technology
  '14', // Legal
  '15', // Marketing
  '16', // Media and Communication
  '17', // Military and Protective Services
  '18', // Operations
  '19', // Product Management
  '20', // Program and Project Management
  '21', // Purchasing
  '22', // Quality Assurance
  '23', // Real Estate
  '24', // Research
  '25', // Sales
  '26', // Customer Success and Support
]);

// Company Headcount — docs/APIFY_LINKEDIN_PROFILE_SEARCH.md:303-314
export const VALID_HEADCOUNT_CODES = new Set<string>([
  'A', // Self-employed
  'B', // 1-10
  'C', // 11-50
  'D', // 51-200
  'E', // 201-500
  'F', // 501-1000
  'G', // 1001-5000
  'H', // 5001-10000
  'I', // 10001+
]);

// Years of Experience — docs/APIFY_LINKEDIN_PROFILE_SEARCH.md:250-257
export const VALID_YOE_IDS = new Set<string>(['1', '2', '3', '4', '5']);

// Years at Current Company — same 1-5 scale as YoE
export const VALID_YEARS_AT_COMPANY_IDS = new Set<string>(['1', '2', '3', '4', '5']);

// Industry IDs — curated subset from
// https://github.com/HarvestAPI/linkedin-industry-codes-v2/blob/main/linkedin_industry_code_v2_all_eng_with_header.csv
// Only includes industries that RULE 13 in search-extraction-prompt.ts emits.
// Each ID is verified against the authoritative CSV. To add more, verify the
// ID in the CSV, then update BOTH this Set AND RULE 13 in the prompt.
export const VALID_INDUSTRY_IDS = new Set<string>([
  '4',    // Software Development
  '10',   // Law Practice
  '12',   // Biotechnology Research
  '14',   // Hospitals and Health Care
  '42',   // Insurance
  '43',   // Financial Services
  '44',   // Real Estate
  '75',   // Government Administration
]);

/**
 * Filter a string array through an allowlist Set, logging any rejected values.
 * Rejected IDs are dropped — the rest pass through.
 */
function filterValid(
  ids: string[],
  allowlist: Set<string>,
  field: string
): string[] {
  const valid: string[] = [];
  for (const id of ids) {
    if (allowlist.has(id)) {
      valid.push(id);
    } else {
      // Keep console.warn for backward-compat (production path without logger
      // still sees it), and also emit a structured log entry for the discovery
      // logger when active.
      log.warn('linkedin-filter-validator', `Dropped unknown ID`, {
        field,
        droppedId: id,
        validIds: Array.from(allowlist),
      });
      console.warn(
        `[linkedin-filter-validator] Dropped unknown ID for "${field}": "${id}". ` +
          `Valid IDs: [${Array.from(allowlist).join(', ')}]`
      );
    }
  }
  return valid;
}

/**
 * Drop any unknown LinkedIn filter IDs from a raw `LinkedInFilters` object
 * and return a sanitized copy. This is the single boundary where
 * LLM-hallucinated IDs are caught before they reach the Apify actor.
 *
 * - Unknown IDs are silently dropped (not thrown) and logged via `filterValid`
 * - If a field becomes empty after filtering, it is deleted from the output
 *   (so we never send `seniorityLevelIds: []` to Apify)
 * - `industryIds` is validated against VALID_INDUSTRY_IDS (curated subset)
 * - Non-ID fields (searchQuery, locations, schools, etc.) pass through untouched
 */
export function sanitizeLinkedInFilters(
  raw: LinkedInFilters | undefined | null
): LinkedInFilters {
  if (!raw) return {};
  const inputKeys = Object.entries(raw)
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k);
  const result: LinkedInFilters = { ...raw };

  // ─── Seniority ──────────────────────────────────────────────
  if (raw.seniorityLevelIds?.length) {
    const valid = filterValid(raw.seniorityLevelIds, VALID_SENIORITY_IDS, 'seniorityLevelIds');
    if (valid.length) {
      result.seniorityLevelIds = valid;
    } else {
      delete result.seniorityLevelIds;
    }
  }

  if (raw.excludeSeniorityLevelIds?.length) {
    const valid = filterValid(
      raw.excludeSeniorityLevelIds,
      VALID_SENIORITY_IDS,
      'excludeSeniorityLevelIds'
    );
    if (valid.length) {
      result.excludeSeniorityLevelIds = valid;
    } else {
      delete result.excludeSeniorityLevelIds;
    }
  }

  // ─── Functions ──────────────────────────────────────────────
  if (raw.functionIds?.length) {
    const valid = filterValid(raw.functionIds, VALID_FUNCTION_IDS, 'functionIds');
    if (valid.length) {
      result.functionIds = valid;
    } else {
      delete result.functionIds;
    }
  }

  if (raw.excludeFunctionIds?.length) {
    const valid = filterValid(raw.excludeFunctionIds, VALID_FUNCTION_IDS, 'excludeFunctionIds');
    if (valid.length) {
      result.excludeFunctionIds = valid;
    } else {
      delete result.excludeFunctionIds;
    }
  }

  // ─── Headcount ──────────────────────────────────────────────
  if (raw.companyHeadcount?.length) {
    const valid = filterValid(raw.companyHeadcount, VALID_HEADCOUNT_CODES, 'companyHeadcount');
    if (valid.length) {
      result.companyHeadcount = valid;
    } else {
      delete result.companyHeadcount;
    }
  }

  // ─── Years of Experience ───────────────────────────────────
  if (raw.yearsOfExperienceIds?.length) {
    const valid = filterValid(raw.yearsOfExperienceIds, VALID_YOE_IDS, 'yearsOfExperienceIds');
    if (valid.length) {
      result.yearsOfExperienceIds = valid;
    } else {
      delete result.yearsOfExperienceIds;
    }
  }

  // ─── Years at Current Company ──────────────────────────────
  if (raw.yearsAtCurrentCompanyIds?.length) {
    const valid = filterValid(
      raw.yearsAtCurrentCompanyIds,
      VALID_YEARS_AT_COMPANY_IDS,
      'yearsAtCurrentCompanyIds'
    );
    if (valid.length) {
      result.yearsAtCurrentCompanyIds = valid;
    } else {
      delete result.yearsAtCurrentCompanyIds;
    }
  }

  // ─── Industry ──────────────────────────────────────────────
  if (raw.industryIds?.length) {
    const valid = filterValid(raw.industryIds, VALID_INDUSTRY_IDS, 'industryIds');
    if (valid.length) {
      result.industryIds = valid;
    } else {
      delete result.industryIds;
    }
  } else if ('industryIds' in (result as Record<string, unknown>)) {
    // Empty array or undefined — drop the key so we never send [] to Apify
    delete (result as Record<string, unknown>).industryIds;
  }

  // ─── Log summary of sanitization ──────────────────────────
  const outputKeys = Object.entries(result)
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k);
  const droppedKeys = inputKeys.filter(k => !outputKeys.includes(k));
  if (droppedKeys.length > 0) {
    log.warn('filter-validator', `Sanitized: dropped keys [${droppedKeys.join(', ')}]`, {
      inputKeys,
      outputKeys,
      droppedKeys,
    });
  }

  return result;
}
