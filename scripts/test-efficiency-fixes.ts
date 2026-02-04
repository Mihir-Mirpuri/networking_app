/**
 * Test script for efficiency fixes:
 * 1. Unverifiable domain caching (skip Emailable for SMTP-blocked domains)
 * 2. Company name normalization
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Normalize company name for consistent storage (copy of function for testing)
 */
function normalizeCompanyForStorage(company: string): string {
  if (!company) return company;

  let normalized = company.trim();

  // Remove leading "The " (case insensitive)
  normalized = normalized.replace(/^The\s+/i, '');

  // Remove parenthetical suffixes like "(BCG)", "(US)", "(NYSE: XYZ)"
  normalized = normalized.replace(/\s*\([^)]+\)\s*$/, '');

  // Remove ", Inc." or ", LLC" etc. but keep "& Company"
  normalized = normalized.replace(/,\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation)$/i, '');

  // Remove standalone legal suffixes (not preceded by &)
  normalized = normalized.replace(/\s+(Inc\.?|LLC|LLP|Ltd\.?|Corp\.?|Corporation|Co\.)$/i, '');

  // Clean up extra whitespace and trailing punctuation
  normalized = normalized.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/[,&]\s*$/, '').trim();

  return normalized;
}

const prisma = new PrismaClient();

async function testCompanyNormalization() {
  console.log('=== Test 1: Company Name Normalization ===\n');

  const testCases = [
    ['Boston Consulting Group (BCG)', 'Boston Consulting Group'],
    ['The Boston Consulting Group', 'Boston Consulting Group'],
    ['McKinsey & Company, Inc.', 'McKinsey & Company'],
    ['McKinsey & Company', 'McKinsey & Company'],
    ['Bain & Company', 'Bain & Company'],
    ['Goldman Sachs (NYSE: GS)', 'Goldman Sachs'],
    ['Meta (Facebook)', 'Meta'],
    ['The Walt Disney Company', 'Walt Disney Company'],
    ['JPMorgan Chase & Co.', 'JPMorgan Chase'],
    ['Deloitte LLP', 'Deloitte'],
    ['PricewaterhouseCoopers (PwC)', 'PricewaterhouseCoopers'],
    ['Google LLC', 'Google'],
    ['Apple Inc.', 'Apple'],
    ['Amazon.com, Inc.', 'Amazon.com'],
  ];

  let passed = 0;
  let failed = 0;

  for (const [input, expected] of testCases) {
    const result = normalizeCompanyForStorage(input);
    const status = result === expected ? '✓' : '✗';
    if (result === expected) {
      passed++;
      console.log(`${status} "${input}" → "${result}"`);
    } else {
      failed++;
      console.log(`${status} "${input}" → "${result}" (expected: "${expected}")`);
    }
  }

  console.log(`\nPassed: ${passed}/${testCases.length}`);
  if (failed > 0) {
    console.log(`Failed: ${failed}/${testCases.length}`);
  }
}

async function testUnverifiableDomainCache() {
  console.log('\n=== Test 2: Unverifiable Domain Cache ===\n');

  // Check if bcg.com is marked as unverifiable
  const bcgPattern = await prisma.companyEmailPattern.findFirst({
    where: { domain: 'bcg.com' },
    select: { company: true, domain: true, unverifiable: true, pattern: true },
  });

  if (bcgPattern) {
    console.log('BCG Pattern found:');
    console.log(`  Company: ${bcgPattern.company}`);
    console.log(`  Domain: ${bcgPattern.domain}`);
    console.log(`  Pattern: ${bcgPattern.pattern}`);
    console.log(`  Unverifiable: ${bcgPattern.unverifiable}`);

    if (!bcgPattern.unverifiable) {
      console.log('\n⚠️  bcg.com is not marked as unverifiable yet.');
      console.log('   Run a search to trigger Emailable and auto-mark it.');
    } else {
      console.log('\n✓ bcg.com is correctly marked as unverifiable');
    }
  } else {
    console.log('No BCG pattern found in database');
  }

  // Count unverifiable domains
  const unverifiableDomains = await prisma.companyEmailPattern.findMany({
    where: { unverifiable: true },
    select: { domain: true, company: true },
  });

  console.log(`\nTotal unverifiable domains: ${unverifiableDomains.length}`);
  if (unverifiableDomains.length > 0) {
    for (const d of unverifiableDomains) {
      console.log(`  - ${d.domain} (${d.company})`);
    }
  }
}

async function testCompanyVariations() {
  console.log('\n=== Test 3: Company Name Variations in DB ===\n');

  // Check for BCG variations
  const bcgVariations = await prisma.person.groupBy({
    by: ['company'],
    where: {
      OR: [
        { company: { contains: 'boston consulting', mode: 'insensitive' } },
        { company: { contains: 'bcg', mode: 'insensitive' } },
      ],
    },
    _count: true,
  });

  console.log('BCG company name variations:');
  for (const v of bcgVariations) {
    const normalized = normalizeCompanyForStorage(v.company);
    const wouldChange = normalized !== v.company;
    console.log(`  "${v.company}" (${v._count} people)${wouldChange ? ` → "${normalized}"` : ''}`);
  }

  if (bcgVariations.length > 1) {
    console.log('\n⚠️  Multiple variations exist. New saves will be normalized.');
    console.log('   Consider running a migration to normalize existing records.');
  }
}

async function main() {
  try {
    await testCompanyNormalization();
    await testUnverifiableDomainCache();
    await testCompanyVariations();
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
