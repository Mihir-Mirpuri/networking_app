/**
 * Analyze email patterns for tech companies using Apollo
 */
import { PrismaClient } from '@prisma/client';
import { findEmail } from '../src/lib/services/enrichment';

const prisma = new PrismaClient();

const COMPANIES_TO_ANALYZE = ['Meta', 'NVIDIA', 'Stripe', 'Google'];
const CALLS_PER_COMPANY = 5;

interface EmailResult {
  name: string;
  email: string | null;
  pattern: string | null;
  domain: string | null;
}

function detectPattern(email: string, firstName: string, lastName: string): string | null {
  const [localPart, domain] = email.toLowerCase().split('@');
  if (!localPart || !domain) return null;

  const first = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const last = lastName.toLowerCase().replace(/[^a-z]/g, '');
  const f = first.charAt(0);
  const l = last.charAt(0);

  if (localPart === `${first}.${last}`) return 'first.last';
  if (localPart === `${first}${last}`) return 'firstlast';
  if (localPart === `${f}${last}`) return 'flast';
  if (localPart === `${f}.${last}`) return 'f.last';
  if (localPart === `${first}_${last}`) return 'first_last';
  if (localPart === first) return 'first';
  if (localPart === `${last}.${first}`) return 'last.first';
  if (localPart === `${last}${first}`) return 'lastfirst';
  if (localPart === `${first}${l}`) return 'firstl';
  if (localPart === `${f}${last}${first.slice(1)}`) return 'custom';

  return `unknown (${localPart})`;
}

async function analyzeCompany(company: string): Promise<EmailResult[]> {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Analyzing: ${company}`);
  console.log('='.repeat(50));

  // Find people at this company without Apollo enrichment or with no email
  const people = await prisma.person.findMany({
    where: {
      company: { contains: company, mode: 'insensitive' },
      firstName: { not: null },
      lastName: { not: null },
      apolloEnrichedAt: null, // Not yet enriched by Apollo
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      linkedinUrl: true,
      email: true,
    },
    take: CALLS_PER_COMPANY,
  });

  // If not enough unenriched people, get some enriched ones without emails
  let toEnrich = people;
  if (people.length < CALLS_PER_COMPANY) {
    const moreP = await prisma.person.findMany({
      where: {
        company: { contains: company, mode: 'insensitive' },
        firstName: { not: null },
        lastName: { not: null },
        email: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        linkedinUrl: true,
        email: true,
      },
      take: CALLS_PER_COMPANY - people.length,
    });
    toEnrich = [...people, ...moreP];
  }

  // If still not enough, just get any people at the company
  if (toEnrich.length < CALLS_PER_COMPANY) {
    const anyPeople = await prisma.person.findMany({
      where: {
        company: { contains: company, mode: 'insensitive' },
        firstName: { not: null },
        lastName: { not: null },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        linkedinUrl: true,
        email: true,
      },
      take: CALLS_PER_COMPANY,
    });
    toEnrich = anyPeople.slice(0, CALLS_PER_COMPANY);
  }

  console.log(`Found ${toEnrich.length} people to check`);

  const results: EmailResult[] = [];

  for (let i = 0; i < Math.min(toEnrich.length, CALLS_PER_COMPANY); i++) {
    const person = toEnrich[i];
    console.log(`\n[${i + 1}/${CALLS_PER_COMPANY}] Looking up: ${person.firstName} ${person.lastName}`);

    const result = await findEmail({
      firstName: person.firstName!,
      lastName: person.lastName!,
      company: company,
      linkedinUrl: person.linkedinUrl,
    });

    if (result.email) {
      const pattern = detectPattern(result.email, person.firstName!, person.lastName!);
      const domain = result.email.split('@')[1];

      console.log(`  → ${result.email} (pattern: ${pattern})`);

      results.push({
        name: `${person.firstName} ${person.lastName}`,
        email: result.email,
        pattern,
        domain,
      });

      // Update the person record
      await prisma.person.update({
        where: { id: person.id },
        data: {
          email: result.email,
          emailStatus: result.status,
          emailConfidence: result.confidence,
          apolloEnrichedAt: new Date(),
          apolloStatus: 'SUCCESS',
        },
      });
    } else {
      console.log(`  → No email found`);
      results.push({
        name: `${person.firstName} ${person.lastName}`,
        email: null,
        pattern: null,
        domain: null,
      });

      await prisma.person.update({
        where: { id: person.id },
        data: {
          apolloEnrichedAt: new Date(),
          apolloStatus: 'NOT_FOUND',
        },
      });
    }

    // Rate limit
    if (i < toEnrich.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return results;
}

async function main() {
  console.log('='.repeat(60));
  console.log('TECH COMPANY EMAIL PATTERN ANALYSIS');
  console.log(`Companies: ${COMPANIES_TO_ANALYZE.join(', ')}`);
  console.log(`Apollo calls per company: ${CALLS_PER_COMPANY}`);
  console.log(`Total Apollo calls: ${COMPANIES_TO_ANALYZE.length * CALLS_PER_COMPANY}`);
  console.log('='.repeat(60));

  const allResults: Record<string, EmailResult[]> = {};

  for (const company of COMPANIES_TO_ANALYZE) {
    allResults[company] = await analyzeCompany(company);
  }

  // Summary
  console.log('\n\n');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  for (const company of COMPANIES_TO_ANALYZE) {
    const results = allResults[company];
    const withEmail = results.filter(r => r.email);
    const patterns = withEmail.map(r => r.pattern);
    const domains = [...new Set(withEmail.map(r => r.domain))];
    const patternCounts: Record<string, number> = {};

    for (const p of patterns) {
      if (p) patternCounts[p] = (patternCounts[p] || 0) + 1;
    }

    console.log(`\n${company}:`);
    console.log(`  Emails found: ${withEmail.length}/${results.length}`);
    console.log(`  Domains: ${domains.join(', ') || 'none'}`);
    console.log(`  Patterns:`);
    for (const [pattern, count] of Object.entries(patternCounts)) {
      console.log(`    - ${pattern}: ${count}`);
    }

    const uniquePatterns = Object.keys(patternCounts).length;
    if (uniquePatterns === 0) {
      console.log(`  ⚠️  VERDICT: No emails found - needs more data`);
    } else if (uniquePatterns === 1 && domains.length === 1) {
      console.log(`  ✓  VERDICT: Consistent pattern - ${Object.keys(patternCounts)[0]}@${domains[0]}`);
    } else {
      console.log(`  ⚠️  VERDICT: Inconsistent - ${uniquePatterns} patterns, ${domains.length} domains - USE APOLLO FALLBACK`);
    }

    console.log(`  Details:`);
    for (const r of results) {
      console.log(`    - ${r.name}: ${r.email || 'no email'} (${r.pattern || 'n/a'})`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
