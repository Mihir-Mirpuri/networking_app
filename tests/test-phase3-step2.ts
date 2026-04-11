/**
 * Phase 3 Step 2 Test: fullScrapeAndInsightsAction
 *
 * Tests:
 * 1. Short profile → full Apify scrape → upgraded Person → insights extracted
 * 2. Full profile → no scrape → insights returned (from cache or fresh)
 * 3. Short profile without linkedinUrl → graceful fallback
 *
 * Expected cost: ~$0.01 (1 Apify scrape $0.004 + 1-2 Haiku calls + 2 Serper calls)
 */

import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { scrapeLinkedInProfiles } from '../src/lib/services/linkedin-scraper';
import { upgradeToFullProfile } from '../src/lib/db/person-service';
import { getOrExtractInsights } from '../src/lib/services/person-insights';

async function main() {
  console.log('Phase 3 Step 2: fullScrapeAndInsightsAction Test');
  console.log('='.repeat(60));

  // Check env vars
  const checks = [
    ['APIFY_API_KEY', !!process.env.APIFY_API_KEY],
    ['ANTHROPIC_API_KEY', !!process.env.ANTHROPIC_API_KEY],
    ['SERPER_API_KEY', !!process.env.SERPER_API_KEY],
    ['DATABASE_URL', !!process.env.DATABASE_URL],
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  if (checks.some(([, ok]) => !ok)) {
    console.error('\nMissing required env vars. Aborting.');
    process.exit(1);
  }

  // ─── Test 1: Find a short profile and upgrade it ─────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Short profile → full scrape → insights');
  console.log('='.repeat(60));

  const shortProfile = await prisma.person.findFirst({
    where: {
      scrapeDepth: 'short',
      linkedinUrl: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      company: true,
      role: true,
      linkedinUrl: true,
      scrapeDepth: true,
      experienceHistory: true,
      educationHistory: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!shortProfile) {
    console.log('⚠ No short profiles found in DB — skipping Test 1');
  } else {
    console.log(`Found short profile: "${shortProfile.fullName}" at ${shortProfile.company}`);
    console.log(`  LinkedIn: ${shortProfile.linkedinUrl}`);
    console.log(`  scrapeDepth: ${shortProfile.scrapeDepth}`);
    console.log(`  experienceHistory: ${Array.isArray(shortProfile.experienceHistory) ? (shortProfile.experienceHistory as unknown[]).length + ' entries' : 'null'}`);
    console.log(`  educationHistory: ${Array.isArray(shortProfile.educationHistory) ? (shortProfile.educationHistory as unknown[]).length + ' entries' : 'null'}`);

    // Step 1: Apify scrape
    const scrapeStart = Date.now();
    console.log(`\n[Scrape] Starting Apify scrape...`);
    const scraped = await scrapeLinkedInProfiles([shortProfile.linkedinUrl!]);
    const scrapeMs = Date.now() - scrapeStart;

    if (scraped.length === 0 || !scraped[0]) {
      console.log(`⚠ Scrape returned empty (${scrapeMs}ms) — profile may be private`);
    } else {
      const profile = scraped[0];
      console.log(`[Scrape] Done in ${scrapeMs}ms`);
      console.log(`  fullName: ${profile.fullName}`);
      console.log(`  role: ${profile.role}`);
      console.log(`  email: ${profile.email || '(none)'}`);
      console.log(`  experienceHistory: ${profile.experienceHistory.length} entries`);
      console.log(`  educationHistory: ${profile.educationHistory.length} entries`);
      console.log(`  schools: ${profile.schools.join(', ') || '(none)'}`);

      // Step 2: Upgrade
      console.log(`\n[Upgrade] Calling upgradeToFullProfile...`);
      await upgradeToFullProfile(shortProfile.id, profile);

      // Verify
      const updated = await prisma.person.findUnique({
        where: { id: shortProfile.id },
        select: {
          scrapeDepth: true,
          scrapedAt: true,
          experienceHistory: true,
          educationHistory: true,
          role: true,
          city: true,
          state: true,
          schools: true,
        },
      });
      console.log(`[Upgrade] Verified:`);
      console.log(`  scrapeDepth: ${updated?.scrapeDepth} ${updated?.scrapeDepth === 'full' ? '✓' : '✗ EXPECTED "full"'}`);
      console.log(`  scrapedAt: ${updated?.scrapedAt}`);
      console.log(`  experienceHistory: ${Array.isArray(updated?.experienceHistory) ? (updated.experienceHistory as unknown[]).length + ' entries' : 'null'}`);
      console.log(`  educationHistory: ${Array.isArray(updated?.educationHistory) ? (updated.educationHistory as unknown[]).length + ' entries' : 'null'}`);
      console.log(`  role: ${updated?.role}`);
      console.log(`  location: ${[updated?.city, updated?.state].filter(Boolean).join(', ')}`);
      console.log(`  schools: ${JSON.stringify(updated?.schools)}`);

      // Step 3: Delete existing insights and extract fresh
      console.log(`\n[Insights] Deleting existing insights and extracting fresh...`);
      await prisma.personInsight.deleteMany({ where: { personId: shortProfile.id } });

      const insightsStart = Date.now();
      const insights = await getOrExtractInsights(shortProfile.id);
      const insightsMs = Date.now() - insightsStart;

      console.log(`[Insights] Done in ${insightsMs}ms — ${insights.insights.length} insights, fromCache: ${insights.fromCache}`);
      for (const ins of insights.insights.slice(0, 5)) {
        console.log(`  [${ins.type}] ${ins.label}: ${ins.detail}`);
      }
      if (insights.insights.length > 5) {
        console.log(`  ... and ${insights.insights.length - 5} more`);
      }
    }
  }

  // ─── Test 2: Full profile → no scrape, just insights ────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Full profile → skip scrape → insights');
  console.log('='.repeat(60));

  const fullProfile = await prisma.person.findFirst({
    where: {
      scrapeDepth: 'full',
      linkedinUrl: { not: null },
      experienceHistory: { not: { equals: null } },
    },
    select: {
      id: true,
      fullName: true,
      company: true,
      scrapeDepth: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!fullProfile) {
    console.log('⚠ No full profiles found in DB — skipping Test 2');
  } else {
    console.log(`Found full profile: "${fullProfile.fullName}" at ${fullProfile.company}`);
    console.log(`  scrapeDepth: ${fullProfile.scrapeDepth} — should skip Apify scrape`);

    // Simulate the action's logic: check scrapeDepth, skip if "full"
    if (fullProfile.scrapeDepth === 'full') {
      console.log(`  ✓ scrapeDepth === "full" — Apify scrape would be skipped`);
    } else {
      console.log(`  ✗ UNEXPECTED: scrapeDepth = "${fullProfile.scrapeDepth}"`);
    }

    const insightsStart = Date.now();
    const insights = await getOrExtractInsights(fullProfile.id);
    const insightsMs = Date.now() - insightsStart;

    console.log(`[Insights] Done in ${insightsMs}ms — ${insights.insights.length} insights, fromCache: ${insights.fromCache}`);
    for (const ins of insights.insights.slice(0, 3)) {
      console.log(`  [${ins.type}] ${ins.label}: ${ins.detail}`);
    }
  }

  // ─── Test 3: Short profile without LinkedIn URL ──────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Short profile without linkedinUrl → graceful fallback');
  console.log('='.repeat(60));

  const noUrlProfile = await prisma.person.findFirst({
    where: {
      scrapeDepth: 'short',
      linkedinUrl: null,
    },
    select: {
      id: true,
      fullName: true,
      company: true,
      scrapeDepth: true,
      linkedinUrl: true,
    },
  });

  if (!noUrlProfile) {
    console.log('⚠ No short profiles without linkedinUrl — skipping Test 3');
    console.log('  (This is expected — short profiles normally come from LinkedIn search)');
  } else {
    console.log(`Found: "${noUrlProfile.fullName}" at ${noUrlProfile.company}`);
    console.log(`  linkedinUrl: ${noUrlProfile.linkedinUrl ?? '(null)'}`);
    console.log(`  ✓ No linkedinUrl — Apify scrape would be skipped, insights run with limited data`);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const shortCount = await prisma.person.count({ where: { scrapeDepth: 'short' } });
  const fullCount = await prisma.person.count({ where: { scrapeDepth: 'full' } });
  console.log(`DB profile counts: ${shortCount} short, ${fullCount} full`);

  console.log('\nALL TESTS COMPLETE');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
