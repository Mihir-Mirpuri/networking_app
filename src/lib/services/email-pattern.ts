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
import { findEmail } from './enrichment';

// Minimum emails needed to establish a pattern
const MIN_SAMPLE_SIZE = 3;

// Maximum people to call Apollo for when bootstrapping a pattern
const MAX_APOLLO_BOOTSTRAP = 5;

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

/**
 * Bootstrap a company's email pattern using Apollo API
 *
 * For companies without a known pattern, calls Apollo for up to 5 people
 * to get verified emails, then learns the pattern from those emails.
 *
 * @param company - Company name
 * @param people - Array of people to potentially call Apollo for
 * @returns Learned pattern or null if not enough emails found
 */
export interface BootstrapResult {
  success: boolean;
  pattern: PatternType | null;
  domain: string | null;
  confidence: number;
  apolloCallsMade: number;
  emailsFound: number;
}

export async function bootstrapCompanyPattern(
  company: string,
  people: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    linkedinUrl: string | null;
  }>
): Promise<BootstrapResult> {
  // Filter to people with names
  const validPeople = people.filter(
    (p): p is typeof p & { firstName: string; lastName: string } =>
      !!p.firstName && !!p.lastName
  );

  if (validPeople.length === 0) {
    console.log(`[EmailPattern] No valid people to bootstrap for ${company}`);
    return {
      success: false,
      pattern: null,
      domain: null,
      confidence: 0,
      apolloCallsMade: 0,
      emailsFound: 0,
    };
  }

  // Check if company uses Apollo fallback (inconsistent patterns)
  const normalized = normalizeCompanyName(company);
  const existingPattern = await prisma.companyEmailPattern.findFirst({
    where: { company: normalized },
    select: { useApolloFallback: true },
  });

  const useApolloFallback = existingPattern?.useApolloFallback ?? false;

  // For Apollo fallback companies, call Apollo for ALL people (no pattern learning)
  // For normal companies, limit to MAX_APOLLO_BOOTSTRAP for pattern learning
  const toEnrich = useApolloFallback ? validPeople : validPeople.slice(0, MAX_APOLLO_BOOTSTRAP);

  console.log(
    useApolloFallback
      ? `[EmailPattern] Apollo fallback for "${company}" - calling Apollo for ${toEnrich.length} people`
      : `[EmailPattern] Bootstrapping pattern for "${company}" with ${toEnrich.length} Apollo calls`
  );

  const apolloEmails: Array<{ email: string; firstName: string; lastName: string }> = [];
  let apolloCallsMade = 0;

  for (const person of toEnrich) {
    apolloCallsMade++;

    const result = await findEmail({
      firstName: person.firstName,
      lastName: person.lastName,
      company,
      linkedinUrl: person.linkedinUrl,
    });

    // Determine Apollo status to save
    const apolloStatusToSave = result.apolloStatus === 'SUCCESS' || result.apolloStatus === 'NOT_FOUND'
      ? result.apolloStatus
      : 'API_ERROR';

    if (result.email) {
      // Save email to Person record
      await prisma.person.update({
        where: { id: person.id },
        data: {
          email: result.email,
          emailStatus: result.status,
          emailConfidence: result.confidence,
          apolloEnrichedAt: new Date(),
          apolloStatus: apolloStatusToSave,
          // Also update location if Apollo provided it
          ...(result.city && { city: result.city }),
          ...(result.state && { state: result.state }),
          ...(result.country && { country: result.country }),
        },
      });

      apolloEmails.push({
        email: result.email,
        firstName: person.firstName,
        lastName: person.lastName,
      });

      console.log(
        `[EmailPattern] Apollo ${apolloCallsMade}/${toEnrich.length}: ${person.firstName} ${person.lastName} → ${result.email}`
      );
    } else {
      // Mark as Apollo-processed even if no email found
      await prisma.person.update({
        where: { id: person.id },
        data: {
          apolloEnrichedAt: new Date(),
          apolloStatus: apolloStatusToSave,
          // Still update location if Apollo provided it
          ...(result.city && { city: result.city }),
          ...(result.state && { state: result.state }),
          ...(result.country && { country: result.country }),
        },
      });

      console.log(
        `[EmailPattern] Apollo ${apolloCallsMade}/${toEnrich.length}: ${person.firstName} ${person.lastName} → no email (${result.apolloStatus})`
      );
    }

    // Early exit: if we have enough emails to learn a pattern, try now
    // Skip for Apollo fallback companies - they have inconsistent patterns
    if (!useApolloFallback && apolloEmails.length >= MIN_SAMPLE_SIZE) {
      const earlyPattern = learnPatternFromEmails(apolloEmails);
      if (earlyPattern) {
        const savedCalls = toEnrich.length - apolloCallsMade;
        console.log(
          `[EmailPattern] Early exit: learned pattern after ${apolloCallsMade} calls (saved ${savedCalls} API calls)`
        );
        await saveCompanyPattern(
          company,
          earlyPattern.domain,
          earlyPattern.pattern,
          earlyPattern.confidence,
          apolloEmails.length
        );

        // Generate emails for remaining people using the learned pattern
        const remainingPeople = toEnrich.slice(apolloCallsMade);
        for (const person of remainingPeople) {
          const generatedEmail = generateEmailFromPattern(
            person.firstName,
            person.lastName,
            earlyPattern.pattern,
            earlyPattern.domain
          );
          await prisma.person.update({
            where: { id: person.id },
            data: {
              email: generatedEmail,
              emailStatus: 'UNVERIFIED',
              emailConfidence: earlyPattern.confidence * 100,
            },
          });
          console.log(
            `[EmailPattern] Generated email for ${person.firstName} ${person.lastName} → ${generatedEmail}`
          );
        }

        return {
          success: true,
          pattern: earlyPattern.pattern,
          domain: earlyPattern.domain,
          confidence: earlyPattern.confidence,
          apolloCallsMade,
          emailsFound: apolloEmails.length + remainingPeople.length,
        };
      }
    }

    // Rate limit: 300ms between calls
    if (apolloCallsMade < toEnrich.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(
    `[EmailPattern] Apollo complete: ${apolloEmails.length}/${apolloCallsMade} emails found`
  );

  // For Apollo fallback companies, skip pattern learning - just return the emails found
  if (useApolloFallback) {
    console.log(`[EmailPattern] Apollo fallback complete for "${company}" - ${apolloEmails.length} emails`);
    return {
      success: apolloEmails.length > 0,
      pattern: null,
      domain: null,
      confidence: 0,
      apolloCallsMade,
      emailsFound: apolloEmails.length,
    };
  }

  // Try to learn pattern from the emails we got
  if (apolloEmails.length >= MIN_SAMPLE_SIZE) {
    const learned = learnPatternFromEmails(apolloEmails);

    if (learned) {
      await saveCompanyPattern(
        company,
        learned.domain,
        learned.pattern,
        learned.confidence,
        apolloEmails.length
      );

      return {
        success: true,
        pattern: learned.pattern,
        domain: learned.domain,
        confidence: learned.confidence,
        apolloCallsMade,
        emailsFound: apolloEmails.length,
      };
    }
  }

  // Not enough emails to learn a pattern, but still try learning from DB
  // (in case there were existing emails we didn't know about)
  const dbPattern = await learnPatternFromDatabase(company);
  if (dbPattern) {
    return {
      success: true,
      pattern: dbPattern.pattern,
      domain: dbPattern.domain,
      confidence: dbPattern.confidence,
      apolloCallsMade,
      emailsFound: apolloEmails.length,
    };
  }

  console.log(
    `[EmailPattern] Could not learn pattern for "${company}" - only ${apolloEmails.length} emails found`
  );
  return {
    success: false,
    pattern: null,
    domain: null,
    confidence: 0,
    apolloCallsMade,
    emailsFound: apolloEmails.length,
  };
}
