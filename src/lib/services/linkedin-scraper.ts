/**
 * LinkedIn Profile Scraper Service
 *
 * Uses Apify actor (LpVuK3Zozwuipa5bp) to scrape LinkedIn profiles.
 * Only extracts necessary fields for the Person model.
 *
 * Field Mapping (from scraper JSON → our model):
 * ─────────────────────────────────────────────────
 * firstName + lastName             → fullName
 * firstName                        → firstName
 * lastName                         → lastName
 * email                            → email (only in email mode)
 * currentPosition[0].companyName   → company
 * experience[0].position           → role
 * location.parsed                  → city, state, country (primary)
 * experience[0].location           → city, state, country (fallback)
 * education[].schoolName           → schools (normalized, deduplicated)
 * linkedinUrl                      → linkedinUrl
 */

import { ApifyClient } from 'apify-client';

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const ACTOR_ID = 'LpVuK3Zozwuipa5bp';

// Concurrency settings - optimized for speed (based on benchmarks)
// Sequential batches of 10 is fastest: 0.83s/profile vs 1.59s with concurrent
const BATCH_SIZE = 10; // 10 URLs per batch (optimal for actor's internal concurrency)
const MAX_CONCURRENT = 1; // Sequential batches (faster than concurrent due to actor overhead)

/**
 * School name normalization map
 * Maps sub-schools/business schools to their parent university
 */
const SCHOOL_ALIASES: Record<string, string> = {
  // University of Chicago
  'booth school of business': 'University of Chicago',
  'the university of chicago booth school of business': 'University of Chicago',
  'chicago booth': 'University of Chicago',

  // University of Texas at Austin
  'mccombs school of business': 'University of Texas at Austin',
  'texas mccombs': 'University of Texas at Austin',
  'ut austin mccombs': 'University of Texas at Austin',
  'the university of texas at austin': 'University of Texas at Austin',
  'cockrell school of engineering': 'University of Texas at Austin',
  'ut austin': 'University of Texas at Austin',

  // University of Pennsylvania
  'wharton school': 'University of Pennsylvania',
  'the wharton school': 'University of Pennsylvania',
  'wharton': 'University of Pennsylvania',

  // MIT
  'sloan school of management': 'MIT',
  'mit sloan': 'MIT',
  'massachusetts institute of technology': 'MIT',

  // UC Berkeley
  'haas school of business': 'UC Berkeley',
  'berkeley haas': 'UC Berkeley',
  'university of california, berkeley': 'UC Berkeley',
  'university of california berkeley': 'UC Berkeley',

  // University of Michigan
  'ross school of business': 'University of Michigan',
  'michigan ross': 'University of Michigan',
  'university of michigan - ann arbor': 'University of Michigan',

  // Northwestern
  'kellogg school of management': 'Northwestern University',
  'northwestern kellogg': 'Northwestern University',

  // Stanford
  'stanford graduate school of business': 'Stanford University',
  'stanford gsb': 'Stanford University',

  // Harvard
  'harvard business school': 'Harvard University',
  'harvard kennedy school': 'Harvard University',
  'harvard law school': 'Harvard University',

  // Columbia
  'columbia business school': 'Columbia University',
  'columbia law school': 'Columbia University',

  // NYU
  'stern school of business': 'NYU',
  'nyu stern': 'NYU',
  'new york university': 'NYU',

  // Duke
  'fuqua school of business': 'Duke University',
  'duke fuqua': 'Duke University',

  // Yale
  'yale school of management': 'Yale University',
  'yale som': 'Yale University',

  // Dartmouth
  'tuck school of business': 'Dartmouth College',
  'dartmouth tuck': 'Dartmouth College',

  // Cornell
  'johnson graduate school of management': 'Cornell University',
  'cornell johnson': 'Cornell University',

  // UCLA
  'anderson school of management': 'UCLA',
  'ucla anderson': 'UCLA',
  'university of california, los angeles': 'UCLA',

  // USC
  'marshall school of business': 'USC',
  'usc marshall': 'USC',
  'university of southern california': 'USC',

  // Carnegie Mellon
  'tepper school of business': 'Carnegie Mellon University',
  'cmu tepper': 'Carnegie Mellon University',

  // Georgetown
  'mcdonough school of business': 'Georgetown University',

  // Virginia
  'darden school of business': 'University of Virginia',
  'uva darden': 'University of Virginia',

  // Indiana
  'kelley school of business': 'Indiana University',

  // UNC
  'kenan-flagler business school': 'UNC Chapel Hill',

  // Georgia Tech
  'scheller college of business': 'Georgia Tech',
  'georgia institute of technology': 'Georgia Tech',
};

/**
 * Normalize school name to parent university
 */
function normalizeSchool(schoolName: string): string {
  if (!schoolName) return schoolName;

  let name = schoolName.trim();
  const lower = name.toLowerCase();

  // Check direct alias match
  if (SCHOOL_ALIASES[lower]) {
    return SCHOOL_ALIASES[lower];
  }

  // Handle "X School, University of Y" format → extract "University of Y"
  if (lower.includes(',')) {
    const parts = name.split(',').map(p => p.trim());
    // Check if any part after comma is a university
    for (let i = 1; i < parts.length; i++) {
      const partLower = parts[i].toLowerCase();
      // Check if this part matches an alias
      if (SCHOOL_ALIASES[partLower]) {
        return SCHOOL_ALIASES[partLower];
      }
      // Check if it contains "university" or is a known school
      if (partLower.includes('university') || partLower.includes('college') || partLower.includes('institute')) {
        // Recursively normalize this part
        return normalizeSchool(parts[i]);
      }
    }
  }

  // Check partial matches for common patterns
  for (const [alias, normalized] of Object.entries(SCHOOL_ALIASES)) {
    if (lower.includes(alias)) {
      return normalized;
    }
  }

  // Handle "The University of X" → "University of X"
  if (lower.startsWith('the ')) {
    name = name.substring(4);
  }

  // Return cleaned name
  return name.trim();
}

/**
 * Raw profile data from Apify (new actor format)
 */
interface ApifyProfileResponse {
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline: string | null;
  email?: string | null;

  // Location (pre-parsed)
  location?: {
    linkedinText: string;
    parsed?: {
      city: string | null;
      state: string | null;
      country: string | null;
    };
  };

  // Current position summary
  currentPosition?: Array<{
    companyName: string;
    companyId: string;
  }>;

  // Full experience array
  experience?: Array<{
    position: string | null;
    companyName: string | null;
    location: string | null;
  }>;

  // Education array
  education?: Array<{
    schoolName: string;
    degree: string | null;
    fieldOfStudy: string | null;
  }>;

  // Error response
  error?: string;
}

/**
 * Parsed profile data matching our Person model
 */
export interface ScrapedProfile {
  linkedinUrl: string;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  role: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  schools: string[];  // All schools, normalized and deduplicated
  educationSchool: string | null;  // Primary school (first in list)
}

/**
 * Parse location string into city, state, country
 *
 * Input: "Seattle, Washington, United States"
 * Output: { city: "Seattle", state: "Washington", country: "United States" }
 */
function parseLocationString(locationStr: string | null): {
  city: string | null;
  state: string | null;
  country: string | null;
} {
  if (!locationStr || locationStr === 'null') {
    return { city: null, state: null, country: null };
  }

  const parts = locationStr.split(',').map((p) => p.trim());

  if (parts.length >= 3) {
    return { city: parts[0], state: parts[1], country: parts[2] };
  } else if (parts.length === 2) {
    return { city: parts[0], state: null, country: parts[1] };
  } else if (parts.length === 1) {
    return { city: null, state: null, country: parts[0] };
  }

  return { city: null, state: null, country: null };
}

/**
 * Extract location with priority: job location → profile location
 */
function extractLocation(raw: ApifyProfileResponse): {
  city: string | null;
  state: string | null;
  country: string | null;
} {
  // Primary: job location (where they work — most relevant for professional networking)
  const jobLoc = raw.experience?.[0]?.location;
  if (jobLoc && jobLoc !== 'null') {
    return parseLocationString(jobLoc);
  }

  // Fallback: profile location (where they live)
  const profileLoc = raw.location?.parsed;
  if (profileLoc?.city || profileLoc?.state || profileLoc?.country) {
    return {
      city: profileLoc.city || null,
      state: profileLoc.state || null,
      country: profileLoc.country || null,
    };
  }

  return { city: null, state: null, country: null };
}

/**
 * Extract all schools, normalized and deduplicated
 */
function extractSchools(education: ApifyProfileResponse['education']): string[] {
  if (!education || education.length === 0) {
    return [];
  }

  const normalized = education
    .map(e => e.schoolName)
    .filter(Boolean)
    .map(normalizeSchool);

  // Deduplicate while preserving order
  return Array.from(new Set(normalized));
}

/**
 * Check if a name looks abbreviated (single letter + optional dot)
 * Examples: "G.", "G", "S." → true; "Gelfer", "Smith" → false
 */
export function isAbbreviatedName(name: string): boolean {
  return /^\w\.?$/.test(name.trim());
}

/**
 * Extract first/last name from a LinkedIn URL slug
 * "/in/sarah-gelfer" → { firstName: "Sarah", lastName: "Gelfer" }
 * "/in/john-van-der-berg" → { firstName: "John", lastName: "Van Der Berg" }
 * Returns null for non-name slugs (contain "ACoAA", purely numeric, etc.)
 */
export function extractNameFromSlug(linkedinUrl: string): { firstName: string; lastName: string } | null {
  if (!linkedinUrl) return null;

  // Extract slug from URL: "https://www.linkedin.com/in/sarah-gelfer" → "sarah-gelfer"
  const slugMatch = linkedinUrl.match(/\/in\/([^/?#]+)/);
  if (!slugMatch) return null;

  const slug = slugMatch[1];

  // Skip non-name slugs
  if (
    slug.includes('ACoAA') ||       // LinkedIn encoded IDs
    /^\d+$/.test(slug) ||            // Purely numeric
    slug.length < 3                  // Too short to be a real name
  ) {
    return null;
  }

  // Split on dashes, filter empty segments (from double dashes like "het--desai")
  let parts = slug.split('-').filter(Boolean);

  // Strip trailing LinkedIn disambiguation hashes (e.g., "b0b7044", "596ba8113")
  // Hashes are: all-digit segments, or 7+ char alphanumeric segments with 2+ consecutive digits
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last) || (last.length >= 7 && /\d{2,}/.test(last))) {
      parts.pop();
    } else {
      break;
    }
  }

  // Need at least first-last
  if (parts.length < 2) return null;

  // Strip trailing digits from each part (e.g., "patel1" → "patel", "wright2" → "wright")
  parts = parts.map(p => p.replace(/\d+$/, '')).filter(Boolean);

  if (parts.length < 2) return null;

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  const firstName = capitalize(parts[0]);

  // Filter single-char segments from lastName parts (middle initials like "m", "u", "j")
  const lastNameParts = parts.slice(1).filter(p => p.length > 1);
  if (lastNameParts.length === 0) return null;

  const lastName = lastNameParts.map(capitalize).join(' ');

  return { firstName, lastName };
}

/**
 * Parse raw Apify response into our ScrapedProfile format
 */
function parseProfile(raw: ApifyProfileResponse): ScrapedProfile {
  const location = extractLocation(raw);
  const schools = extractSchools(raw.education);

  let firstName = raw.firstName || '';
  let lastName = raw.lastName || '';

  // Slug fallback for abbreviated names (e.g., "Sarah G." → "Sarah Gelfer")
  if (isAbbreviatedName(lastName) || isAbbreviatedName(firstName)) {
    const slugName = extractNameFromSlug(raw.linkedinUrl);
    if (slugName) {
      // Detect reversed slugs (e.g., "baker-natalie" for Natalie Baker):
      // if slug lastName matches Apify firstName, swap slug parts
      if (
        slugName.lastName.toLowerCase() === firstName.toLowerCase() &&
        slugName.firstName.toLowerCase() !== firstName.toLowerCase()
      ) {
        const tmp = slugName.firstName;
        slugName.firstName = slugName.lastName;
        slugName.lastName = tmp;
      }

      // Verify slug firstName matches Apify firstName (catches custom slugs
      // like "voronova-software-quality" where slug has no relation to the name)
      const slugFirstMatchesApify =
        slugName.firstName.toLowerCase() === firstName.toLowerCase() ||
        slugName.firstName[0]?.toLowerCase() === firstName[0]?.toLowerCase();

      if (slugFirstMatchesApify) {
        if (isAbbreviatedName(lastName) && slugName.lastName.length > lastName.replace('.', '').length) {
          console.log(`[Scraper] URL slug fallback: "${lastName}" → "${slugName.lastName}" for ${raw.linkedinUrl}`);
          lastName = slugName.lastName;
        }
        if (isAbbreviatedName(firstName) && slugName.firstName.length > firstName.replace('.', '').length) {
          console.log(`[Scraper] URL slug fallback: "${firstName}" → "${slugName.firstName}" for ${raw.linkedinUrl}`);
          firstName = slugName.firstName;
        }
      }
    }
  }

  const fullName = `${firstName} ${lastName}`.trim();

  return {
    linkedinUrl: raw.linkedinUrl,
    fullName,
    firstName,
    lastName,
    email: raw.email || null,
    company: raw.currentPosition?.[0]?.companyName || raw.experience?.[0]?.companyName || null,
    role: raw.experience?.[0]?.position || null,
    city: location.city,
    state: location.state,
    country: location.country,
    schools,
    educationSchool: schools[0] || null,  // Primary school
  };
}

/**
 * Callback invoked after each batch completes
 * Allows processing results while next batch is scraping
 */
export type BatchCallback = (profiles: ScrapedProfile[], batchIndex: number, totalBatches: number) => Promise<void>;

/**
 * Scrape LinkedIn profiles using Apify with streaming batch processing
 * Calls onBatchComplete after each batch, allowing parallel processing
 *
 * @param linkedinUrls - Array of LinkedIn profile URLs to scrape
 * @param options.includeEmail - Whether to use email search mode (costs more)
 * @param options.onBatchComplete - Callback invoked after each batch (can process while next batch runs)
 * @returns Array of all parsed profile data
 */
export async function scrapeLinkedInProfiles(
  linkedinUrls: string[],
  options: {
    includeEmail?: boolean;
    onBatchComplete?: BatchCallback;
  } = {}
): Promise<ScrapedProfile[]> {
  const { includeEmail = false, onBatchComplete } = options;

  if (!APIFY_API_KEY) {
    console.error('[LinkedIn Scraper] No API key configured');
    throw new Error('APIFY_API_KEY not configured');
  }

  if (linkedinUrls.length === 0) {
    console.log('[LinkedIn Scraper] No URLs provided, returning empty array');
    return [];
  }

  const client = new ApifyClient({
    token: APIFY_API_KEY,
  });

  // Split URLs into batches for parallel processing
  const batches: string[][] = [];
  for (let i = 0; i < linkedinUrls.length; i += BATCH_SIZE) {
    batches.push(linkedinUrls.slice(i, i + BATCH_SIZE));
  }

  const mode = includeEmail
    ? 'Profile details + email search ($10 per 1k)'
    : 'Profile details no email ($4 per 1k)';

  console.log(
    `[LinkedIn Scraper] Scraping ${linkedinUrls.length} profiles in ${batches.length} batches (${MAX_CONCURRENT} concurrent)`
  );
  console.log(`[LinkedIn Scraper] Mode: ${mode}`);

  const allProfiles: ScrapedProfile[] = [];
  const failedUrls: string[] = [];
  const callbackPromises: Promise<void>[] = [];

  try {
    // Process batches with controlled concurrency
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
      const concurrentBatches = batches.slice(i, i + MAX_CONCURRENT);
      const batchStart = i + 1;
      const batchEnd = Math.min(i + MAX_CONCURRENT, batches.length);

      console.log(`[LinkedIn Scraper] Running batches ${batchStart}-${batchEnd} of ${batches.length}...`);

      // Start all concurrent runs
      const runs = await Promise.all(
        concurrentBatches.map((batch) =>
          client.actor(ACTOR_ID).call(
            {
              profileScraperMode: mode,
              queries: batch,
            },
            {
              memory: 256,  // Max memory for this actor
              timeout: 60,  // 60 seconds max per batch of 10 profiles
            }
          )
        )
      );

      // Fetch results from each run's dataset
      const results = await Promise.all(runs.map((run) => client.dataset(run.defaultDatasetId).listItems()));

      // Parse batch profiles
      const batchProfiles: ScrapedProfile[] = [];
      for (const { items } of results) {
        for (const item of items) {
          const raw = item as unknown as ApifyProfileResponse;

          // Skip error responses (e.g., "No person found")
          if (raw.error) {
            console.warn(`[LinkedIn Scraper] Failed: ${raw.linkedinUrl} - ${raw.error}`);
            failedUrls.push(raw.linkedinUrl);
            continue;
          }

          const parsed = parseProfile(raw);
          batchProfiles.push(parsed);
          allProfiles.push(parsed);
        }
      }

      // Call batch callback (runs in parallel with next batch scrape)
      if (onBatchComplete && batchProfiles.length > 0) {
        const batchIndex = Math.floor(i / MAX_CONCURRENT);
        // Track promise but don't await - allows parallel processing
        const callbackPromise = onBatchComplete(batchProfiles, batchIndex, batches.length).catch((err) => {
          console.error(`[LinkedIn Scraper] Batch callback error:`, err);
        });
        callbackPromises.push(callbackPromise);
      }
    }

    // Wait for all callbacks to complete before returning
    if (callbackPromises.length > 0) {
      await Promise.all(callbackPromises);
    }

    console.log(
      `[LinkedIn Scraper] Completed: ${allProfiles.length} succeeded, ${failedUrls.length} failed`
    );

    return allProfiles;
  } catch (error) {
    console.error('[LinkedIn Scraper] Scrape error:', error);
    throw error;
  }
}

/**
 * Scrape a single LinkedIn profile
 */
export async function scrapeLinkedInProfile(
  linkedinUrl: string,
  includeEmail: boolean = false
): Promise<ScrapedProfile | null> {
  const results = await scrapeLinkedInProfiles([linkedinUrl], { includeEmail });
  return results[0] || null;
}
