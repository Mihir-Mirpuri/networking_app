/**
 * Email Pattern Service
 *
 * Learns email patterns from known emails and generates emails for new people.
 * Patterns are stored per company+domain for reuse.
 *
 * Supported patterns:
 * - first.last   → john.smith@company.com
 * - firstlast    → johnsmith@company.com
 * - flast        → jsmith@company.com
 * - f.last       → j.smith@company.com
 * - first_last   → john_smith@company.com
 * - first        → john@company.com
 * - last.first   → smith.john@company.com
 * - lastfirst    → smithjohn@company.com
 */

import prisma from '@/lib/prisma';

// Minimum emails needed to establish a pattern
const MIN_SAMPLE_SIZE = 3;

// Pattern types in order of commonness
const PATTERN_TYPES = [
  'first.last',
  'firstlast',
  'flast',
  'f.last',
  'first_last',
  'first',
  'last.first',
  'lastfirst',
] as const;

type PatternType = typeof PATTERN_TYPES[number];

/**
 * Normalize company name for consistent matching
 * "ZS Associates" → "zs associates"
 * "L.E.K. Consulting" → "lek consulting"
 */
export function normalizeCompanyName(company: string): string {
  return company
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Common credential/degree suffixes to strip from names
 */
const CREDENTIAL_SUFFIXES = [
  // Degrees
  'mba', 'mha', 'mph', 'mpa', 'mba', 'ms', 'ma', 'phd', 'md', 'jd', 'llm', 'edd', 'dba',
  'bba', 'bs', 'ba', 'bsc', 'msc',
  // Certifications
  'cpa', 'cfa', 'cfe', 'cfp', 'cma', 'pmp', 'pe', 'esq', 'rn', 'cisa', 'cissp',
  'sphr', 'phr', 'shrm', 'six sigma', 'leed', 'ccna', 'mcse',
  // Titles
  'jr', 'sr', 'ii', 'iii', 'iv',
];

/**
 * Clean first name for email generation
 * Removes middle initials (e.g., "Madeline E." → "Madeline")
 */
function cleanFirstName(firstName: string): string {
  if (!firstName) return '';

  // Remove middle initials: single letter optionally followed by period at end
  // "Madeline E." → "Madeline", "Madeline E" → "Madeline", "David U." → "David"
  let cleaned = firstName.trim();

  // Handle "FirstName M." or "FirstName M" pattern (middle initial at end)
  cleaned = cleaned.replace(/\s+[A-Z]\.?$/i, '');

  // Handle parenthetical nicknames like "Theo (Xiaochao)" → "Theo"
  cleaned = cleaned.replace(/\s*\([^)]+\)\s*/g, ' ').trim();

  // Take only the first word if multiple remain
  const parts = cleaned.split(/\s+/);
  return parts[0] || cleaned;
}

/**
 * Clean last name for email generation
 * Removes credential suffixes (e.g., "Baker MHA" → "Baker")
 */
function cleanLastName(lastName: string): string {
  if (!lastName) return '';

  let cleaned = lastName.trim();

  // Remove parenthetical content like "(Qiujun)"
  cleaned = cleaned.replace(/\s*\([^)]+\)\s*/g, ' ').trim();

  // Split into parts and filter out credentials
  const parts = cleaned.split(/\s+/);
  const filteredParts = parts.filter(part => {
    const lower = part.toLowerCase().replace(/[.,]/g, '');
    return !CREDENTIAL_SUFFIXES.includes(lower);
  });

  // Return filtered parts, or original if everything was filtered
  return filteredParts.length > 0 ? filteredParts.join(' ') : cleaned;
}

/**
 * Normalize name for email generation
 * Removes accents, special chars, handles hyphens
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z]/g, ''); // Keep only letters
}

/**
 * Generate email using a pattern
 */
export function generateEmailFromPattern(
  firstName: string,
  lastName: string,
  pattern: PatternType,
  domain: string
): string {
  // Clean names first (remove middle initials, credentials)
  const cleanedFirst = cleanFirstName(firstName);
  const cleanedLast = cleanLastName(lastName);

  // Then normalize for email format
  const first = normalizeName(cleanedFirst);
  const last = normalizeName(cleanedLast);
  const f = first.charAt(0);

  let localPart: string;
  switch (pattern) {
    case 'first.last':
      localPart = `${first}.${last}`;
      break;
    case 'firstlast':
      localPart = `${first}${last}`;
      break;
    case 'flast':
      localPart = `${f}${last}`;
      break;
    case 'f.last':
      localPart = `${f}.${last}`;
      break;
    case 'first_last':
      localPart = `${first}_${last}`;
      break;
    case 'first':
      localPart = first;
      break;
    case 'last.first':
      localPart = `${last}.${first}`;
      break;
    case 'lastfirst':
      localPart = `${last}${first}`;
      break;
    default:
      localPart = `${first}.${last}`;
  }

  return `${localPart}@${domain}`;
}

/**
 * Detect which pattern was used for a known email
 * Returns null if no pattern matches
 */
export function detectPattern(
  email: string,
  firstName: string,
  lastName: string
): { pattern: PatternType; domain: string } | null {
  const [localPart, domain] = email.toLowerCase().split('@');
  if (!localPart || !domain) return null;

  // Clean names first (remove middle initials, credentials)
  const cleanedFirst = cleanFirstName(firstName);
  const cleanedLast = cleanLastName(lastName);

  const first = normalizeName(cleanedFirst);
  const last = normalizeName(cleanedLast);
  const f = first.charAt(0);

  // Check each pattern
  if (localPart === `${first}.${last}`) return { pattern: 'first.last', domain };
  if (localPart === `${first}${last}`) return { pattern: 'firstlast', domain };
  if (localPart === `${f}${last}`) return { pattern: 'flast', domain };
  if (localPart === `${f}.${last}`) return { pattern: 'f.last', domain };
  if (localPart === `${first}_${last}`) return { pattern: 'first_last', domain };
  if (localPart === first) return { pattern: 'first', domain };
  if (localPart === `${last}.${first}`) return { pattern: 'last.first', domain };
  if (localPart === `${last}${first}`) return { pattern: 'lastfirst', domain };

  return null;
}

/**
 * Learn pattern from a set of known emails
 * Returns the most common pattern if consistent
 */
export function learnPatternFromEmails(
  emails: Array<{ email: string; firstName: string; lastName: string }>
): { pattern: PatternType; domain: string; confidence: number } | null {
  if (emails.length < MIN_SAMPLE_SIZE) {
    return null;
  }

  // Detect pattern for each email
  const detectedPatterns: Array<{ pattern: PatternType; domain: string }> = [];
  for (const { email, firstName, lastName } of emails) {
    const detected = detectPattern(email, firstName, lastName);
    if (detected) {
      detectedPatterns.push(detected);
    }
  }

  if (detectedPatterns.length < MIN_SAMPLE_SIZE) {
    return null;
  }

  // Count patterns by domain
  const domainPatternCounts = new Map<string, Map<PatternType, number>>();
  for (const { pattern, domain } of detectedPatterns) {
    if (!domainPatternCounts.has(domain)) {
      domainPatternCounts.set(domain, new Map());
    }
    const patternCounts = domainPatternCounts.get(domain)!;
    patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
  }

  // Find the most common domain and pattern
  let bestDomain = '';
  let bestPattern: PatternType = 'first.last';
  let bestCount = 0;

  for (const [domain, patternCounts] of Array.from(domainPatternCounts)) {
    for (const [pattern, count] of Array.from(patternCounts)) {
      if (count > bestCount) {
        bestCount = count;
        bestPattern = pattern;
        bestDomain = domain;
      }
    }
  }

  if (bestCount < MIN_SAMPLE_SIZE) {
    return null;
  }

  // Calculate confidence based on consistency
  const totalForDomain = detectedPatterns.filter(p => p.domain === bestDomain).length;
  const confidence = bestCount / totalForDomain;

  return {
    pattern: bestPattern,
    domain: bestDomain,
    confidence,
  };
}

/**
 * Get existing pattern for a company from database
 * Returns null if company uses Apollo fallback (inconsistent patterns)
 */
export async function getCompanyPattern(
  company: string
): Promise<{ pattern: PatternType; domain: string; confidence: number } | null> {
  const normalized = normalizeCompanyName(company);

  const existing = await prisma.companyEmailPattern.findFirst({
    where: { company: normalized },
    orderBy: { confidence: 'desc' },
  });

  // Skip pattern if company needs Apollo fallback
  if (existing?.useApolloFallback) {
    console.log(`[EmailPattern] ${company} uses Apollo fallback - skipping pattern`);
    return null;
  }

  if (existing && existing.confidence >= 0.8) {
    return {
      pattern: existing.pattern as PatternType,
      domain: existing.domain,
      confidence: existing.confidence,
    };
  }

  return null;
}

/**
 * Save a learned pattern to the database
 */
export async function saveCompanyPattern(
  _company: string,
  _domain: string,
  _pattern: PatternType,
  _confidence: number,
): Promise<void> {
  // Pattern generation disabled — existing patterns are read-only
}
