/**
 * Debug: Analyze why Goldman Sachs + Houston search returns no results
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Copy of isCompanyMatch from search.ts
function isCompanyMatch(searchCompany: string | undefined, apolloCompany: string | null | undefined): boolean {
  if (!searchCompany || !searchCompany.trim()) return true;
  if (!apolloCompany || !apolloCompany.trim()) return false;
  const searchLower = searchCompany.toLowerCase().trim();
  const apolloLower = apolloCompany.toLowerCase().trim();
  return apolloLower.includes(searchLower) || searchLower.includes(apolloLower);
}

// Copy of isLocationVerified from search.ts
function isLocationVerified(
  searchLocation: string | undefined,
  apolloCity: string | null | undefined,
  apolloState: string | null | undefined,
  apolloCountry: string | null | undefined
): boolean {
  if (!searchLocation || !searchLocation.trim()) return false;
  const searchLower = searchLocation.toLowerCase().trim();
  const cityLower = apolloCity?.toLowerCase()?.trim() || '';
  const stateLower = apolloState?.toLowerCase()?.trim() || '';
  const countryLower = apolloCountry?.toLowerCase()?.trim() || '';
  if (!cityLower && !stateLower && !countryLower) return false;
  const cityMatch = cityLower && (cityLower.includes(searchLower) || searchLower.includes(cityLower));
  const stateMatch = stateLower && (stateLower.includes(searchLower) || searchLower.includes(stateLower));
  const countryMatch = countryLower && (countryLower.includes(searchLower) || searchLower.includes(countryLower));
  return !!(cityMatch || stateMatch || countryMatch);
}

async function main() {
  // Find the Goldman Sachs + Houston search
  const search = await prisma.search.findFirst({
    where: {
      company: 'goldman sachs',
      location: 'houston',
      university: 'university of texas at austin',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!search) {
    console.log('No cached search found for Goldman Sachs + Houston');
    return;
  }

  console.log('Found cached search:', search.id);
  console.log('Created:', search.createdAt);
  console.log('');

  // Get linked people
  const searchPeople = await prisma.searchPerson.findMany({
    where: { searchId: search.id },
    include: {
      person: true,
    },
  });

  console.log(`Total linked people: ${searchPeople.length}`);
  console.log('');
  console.log('Analyzing each person against filters:');
  console.log('='.repeat(80));

  const searchCompany = 'Goldman Sachs';
  const searchLocation = 'Houston';

  let passCompany = 0;
  let passLocation = 0;
  let passBoth = 0;

  for (const sp of searchPeople) {
    const p = sp.person;
    const companyOk = isCompanyMatch(searchCompany, p.company);
    const locationOk = isLocationVerified(searchLocation, p.city, p.state, p.country);

    const companyIcon = companyOk ? '✅' : '❌';
    const locationIcon = locationOk ? '✅' : '❌';

    if (companyOk) passCompany++;
    if (locationOk) passLocation++;
    if (companyOk && locationOk) passBoth++;

    console.log(`${p.fullName}`);
    console.log(`  Company: "${p.company}" ${companyIcon} (search: "${searchCompany}")`);
    console.log(`  Location: ${p.city || '?'}, ${p.state || '?'} ${locationIcon} (search: "${searchLocation}")`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('FILTER RESULTS:');
  console.log(`  Pass company filter: ${passCompany}/${searchPeople.length}`);
  console.log(`  Pass location filter: ${passLocation}/${searchPeople.length}`);
  console.log(`  Pass BOTH filters: ${passBoth}/${searchPeople.length}`);
  console.log('');

  if (passBoth === 0) {
    console.log('🚨 ROOT CAUSE: All cached people fail company AND/OR location filter!');
    console.log('   The cache stores people from the CSE search, but after Apollo enrichment,');
    console.log('   their actual company/location doesn\'t match the search criteria.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
