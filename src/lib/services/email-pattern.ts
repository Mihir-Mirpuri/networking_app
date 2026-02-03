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
  const first = normalizeName(firstName);
  const last = normalizeName(lastName);
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

  const first = normalizeName(firstName);
  const last = normalizeName(lastName);
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
 */
export async function getCompanyPattern(
  company: string
): Promise<{ pattern: PatternType; domain: string; confidence: number } | null> {
  const normalized = normalizeCompanyName(company);

  const existing = await prisma.companyEmailPattern.findFirst({
    where: { company: normalized },
    orderBy: { confidence: 'desc' },
  });

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
  company: string,
  domain: string,
  pattern: PatternType,
  confidence: number,
  sampleSize: number
): Promise<void> {
  const normalized = normalizeCompanyName(company);

  await prisma.companyEmailPattern.upsert({
    where: {
      company_domain: {
        company: normalized,
        domain: domain,
      },
    },
    create: {
      company: normalized,
      domain,
      pattern,
      confidence,
      sampleSize,
    },
    update: {
      pattern,
      confidence,
      sampleSize,
      updatedAt: new Date(),
    },
  });

  console.log(`[EmailPattern] Saved pattern for ${company}: ${pattern}@${domain} (${Math.round(confidence * 100)}% confidence, ${sampleSize} samples)`);
}

/**
 * Learn pattern from existing Person records in the database
 * Call this for companies that have enough people with emails
 */
export async function learnPatternFromDatabase(company: string): Promise<{
  pattern: PatternType;
  domain: string;
  confidence: number;
} | null> {
  const normalized = normalizeCompanyName(company);

  // Get people at this company with verified/unverified emails
  const people = await prisma.person.findMany({
    where: {
      company: { contains: normalized.split(' ')[0], mode: 'insensitive' },
      email: { not: null },
      firstName: { not: null },
      lastName: { not: null },
    },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      company: true,
    },
    take: 50,
  });

  // Filter to exact company match (post-query)
  const companyPeople = people.filter(
    p => normalizeCompanyName(p.company) === normalized
  );

  if (companyPeople.length < MIN_SAMPLE_SIZE) {
    return null;
  }

  const emails = companyPeople
    .filter(p => p.email && p.firstName && p.lastName)
    .map(p => ({
      email: p.email!,
      firstName: p.firstName!,
      lastName: p.lastName!,
    }));

  const learned = learnPatternFromEmails(emails);

  if (learned) {
    await saveCompanyPattern(
      company,
      learned.domain,
      learned.pattern,
      learned.confidence,
      emails.length
    );
  }

  return learned;
}

/**
 * Get or learn pattern for a company
 * Main entry point for the pattern service
 */
export async function getOrLearnPattern(
  company: string
): Promise<{ pattern: PatternType; domain: string; confidence: number } | null> {
  // Check for existing pattern
  const existing = await getCompanyPattern(company);
  if (existing) {
    return existing;
  }

  // Try to learn from database
  const learned = await learnPatternFromDatabase(company);
  return learned;
}

/**
 * Generate email for a person if we have a pattern for their company
 * Returns null if no pattern available
 */
export async function generateEmailForPerson(
  firstName: string,
  lastName: string,
  company: string
): Promise<{ email: string; confidence: number } | null> {
  const pattern = await getOrLearnPattern(company);

  if (!pattern || pattern.confidence < 0.8) {
    return null;
  }

  const email = generateEmailFromPattern(
    firstName,
    lastName,
    pattern.pattern,
    pattern.domain
  );

  return {
    email,
    confidence: pattern.confidence * 100, // Convert to percentage
  };
}
