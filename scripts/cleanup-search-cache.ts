/**
 * One-time cleanup script: Removes SearchPerson entries where the Person
 * doesn't pass the verification filters (email, employment, company, location).
 *
 * This fixes the cache bug where unfiltered Person IDs were stored.
 * After this cleanup, repeat searches will return correct results.
 *
 * Run: npx tsx scripts/cleanup-search-cache.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Check if Apollo's company matches the search company
 */
function isCompanyMatch(
  searchCompany: string | undefined | null,
  apolloCompany: string | null | undefined
): boolean {
  if (!searchCompany || !searchCompany.trim()) {
    return true; // No company filter specified
  }

  if (!apolloCompany || !apolloCompany.trim()) {
    return false; // Apollo didn't return a company
  }

  const searchLower = searchCompany.toLowerCase().trim();
  const apolloLower = apolloCompany.toLowerCase().trim();

  return apolloLower.includes(searchLower) || searchLower.includes(apolloLower);
}

/**
 * Check if Apollo's location matches the search location
 */
function isLocationVerified(
  searchLocation: string | undefined | null,
  apolloCity: string | null | undefined,
  apolloState: string | null | undefined,
  apolloCountry: string | null | undefined
): boolean {
  if (!searchLocation || !searchLocation.trim()) {
    return true; // No location filter, so it passes
  }

  const searchLower = searchLocation.toLowerCase().trim();
  const cityLower = apolloCity?.toLowerCase()?.trim() || '';
  const stateLower = apolloState?.toLowerCase()?.trim() || '';
  const countryLower = apolloCountry?.toLowerCase()?.trim() || '';

  if (!cityLower && !stateLower && !countryLower) {
    return false;
  }

  const cityMatch = cityLower && (cityLower.includes(searchLower) || searchLower.includes(cityLower));
  const stateMatch = stateLower && (stateLower.includes(searchLower) || searchLower.includes(stateLower));
  const countryMatch = countryLower && (countryLower.includes(searchLower) || searchLower.includes(countryLower));

  return !!(cityMatch || stateMatch || countryMatch);
}

async function main() {
  console.log('='.repeat(70));
  console.log('SEARCH CACHE CLEANUP');
  console.log('='.repeat(70));
  console.log('');

  // Get all searches with their linked people
  const searches = await prisma.search.findMany({
    include: {
      searchPeople: {
        include: {
          person: true,
        },
      },
    },
  });

  console.log(`Found ${searches.length} cached searches to analyze`);
  console.log('');

  let totalRemoved = 0;
  let totalKept = 0;
  let searchesModified = 0;

  for (const search of searches) {
    const toRemove: string[] = [];
    const toKeep: string[] = [];

    for (const sp of search.searchPeople) {
      const person = sp.person;
      let shouldKeep = true;
      const reasons: string[] = [];

      // Check 1: Email status must not be MISSING
      if (!person.emailStatus || person.emailStatus === 'MISSING') {
        shouldKeep = false;
        reasons.push('MISSING email');
      }

      // Check 2: Must have Apollo employment data
      // We can't check this directly, but if company is null we assume no Apollo data
      if (!person.company) {
        shouldKeep = false;
        reasons.push('no company');
      }

      // Check 3: Company must match search company
      if (!isCompanyMatch(search.company, person.company)) {
        shouldKeep = false;
        reasons.push(`company mismatch (search: "${search.company}", person: "${person.company}")`);
      }

      // Check 4: Location must match (if search had location filter)
      if (!isLocationVerified(search.location, person.city, person.state, person.country)) {
        shouldKeep = false;
        reasons.push(`location mismatch (search: "${search.location}", person: ${person.city || '?'}, ${person.state || '?'})`);
      }

      if (shouldKeep) {
        toKeep.push(sp.id);
      } else {
        toRemove.push(sp.id);
        console.log(`  ❌ Removing ${person.fullName}: ${reasons.join(', ')}`);
      }
    }

    if (toRemove.length > 0) {
      searchesModified++;
      console.log(`\nSearch: company="${search.company}", location="${search.location}"`);
      console.log(`  Keeping: ${toKeep.length}, Removing: ${toRemove.length}`);

      // Delete the invalid SearchPerson entries
      await prisma.searchPerson.deleteMany({
        where: {
          id: { in: toRemove },
        },
      });

      totalRemoved += toRemove.length;
    }

    totalKept += toKeep.length;
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('CLEANUP SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total searches analyzed: ${searches.length}`);
  console.log(`Searches modified: ${searchesModified}`);
  console.log(`SearchPerson entries removed: ${totalRemoved}`);
  console.log(`SearchPerson entries kept: ${totalKept}`);
  console.log('');

  if (totalRemoved > 0) {
    console.log('✅ Cleanup complete! Repeat searches should now return correct results.');
  } else {
    console.log('✅ No invalid cache entries found. Cache is clean.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
