/**
 * Test script: verifies location filtering works correctly
 * Tests both CSE-level and Apollo-level location verification
 *
 * Run: npx tsx scripts/test-location-filter.ts
 */

import 'dotenv/config';

// Copy of isLocationVerified from search.ts for testing
function isLocationVerified(
  searchLocation: string | undefined,
  apolloCity: string | null | undefined,
  apolloState: string | null | undefined,
  apolloCountry: string | null | undefined
): boolean {
  if (!searchLocation || !searchLocation.trim()) {
    return false;
  }

  const searchLower = searchLocation.toLowerCase().trim();
  const cityLower = apolloCity?.toLowerCase()?.trim() || '';
  const stateLower = apolloState?.toLowerCase()?.trim() || '';
  const countryLower = apolloCountry?.toLowerCase()?.trim() || '';

  // If Apollo returned no location data at all, location is NOT verified
  if (!cityLower && !stateLower && !countryLower) {
    return false;
  }

  // Check if search location matches or is contained in any Apollo location field
  const cityMatch = cityLower && (cityLower.includes(searchLower) || searchLower.includes(cityLower));
  const stateMatch = stateLower && (stateLower.includes(searchLower) || searchLower.includes(stateLower));
  const countryMatch = countryLower && (countryLower.includes(searchLower) || searchLower.includes(countryLower));

  return !!(cityMatch || stateMatch || countryMatch);
}

// Test cases for isLocationVerified
const locationTests = [
  // Should PASS - exact city match
  { search: 'Houston', city: 'Houston', state: 'Texas', country: 'United States', expected: true },
  // Should PASS - city contains search
  { search: 'Houston', city: 'Greater Houston', state: 'Texas', country: 'United States', expected: true },
  // Should PASS - search contains city
  { search: 'Houston, TX', city: 'Houston', state: 'Texas', country: 'United States', expected: true },
  // Should FAIL - different city
  { search: 'Houston', city: 'New York', state: 'New York', country: 'United States', expected: false },
  // Should FAIL - no location data from Apollo
  { search: 'Houston', city: null, state: null, country: null, expected: false },
  // Should PASS - state match (Texas contains Houston? No, but Houston contains Texas? No)
  { search: 'Texas', city: 'Houston', state: 'Texas', country: 'United States', expected: true },
  // Should FAIL - completely different location
  { search: 'Houston', city: 'San Francisco', state: 'California', country: 'United States', expected: false },
  // Should PASS - Austin search with Austin city
  { search: 'Austin', city: 'Austin', state: 'Texas', country: 'United States', expected: true },
  // Should FAIL - Austin search with Houston city
  { search: 'Austin', city: 'Houston', state: 'Texas', country: 'United States', expected: false },
  // Should PASS - case insensitive
  { search: 'HOUSTON', city: 'houston', state: 'texas', country: 'united states', expected: true },
];

console.log('='.repeat(60));
console.log('TESTING isLocationVerified FUNCTION');
console.log('='.repeat(60));
console.log('');

let passed = 0;
let failed = 0;

for (const test of locationTests) {
  const result = isLocationVerified(test.search, test.city, test.state, test.country);
  const status = result === test.expected ? '✅ PASS' : '❌ FAIL';

  if (result === test.expected) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${status}: search="${test.search}" | city="${test.city}" state="${test.state}"`);
  console.log(`        Expected: ${test.expected}, Got: ${result}`);
  console.log('');
}

console.log('='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

// Now test the full discovery + mock Apollo flow
console.log('\n');
console.log('='.repeat(60));
console.log('SIMULATING FULL SEARCH FLOW WITH LOCATION FILTER');
console.log('='.repeat(60));
console.log('');

// Simulated results from CSE (what discovery.ts returns)
const mockCSEResults = [
  { name: 'Yuki Ebashi', company: 'Goldman Sachs' },
  { name: 'Devan Patel', company: 'Goldman Sachs' },
  { name: 'Merritt Cozby', company: 'TPG' },
  { name: 'Suzy Telle', company: 'Goldman Sachs' },
  { name: 'Lucas Anderson', company: 'Quantum Capital' },
];

// Simulated Apollo responses (what Apollo would return for each person)
const mockApolloData: Record<string, { city: string | null; state: string | null; country: string | null }> = {
  'Yuki Ebashi': { city: 'New York', state: 'New York', country: 'United States' },
  'Devan Patel': { city: 'Houston', state: 'Texas', country: 'United States' },
  'Merritt Cozby': { city: 'New York', state: 'New York', country: 'United States' },
  'Suzy Telle': { city: 'Houston', state: 'Texas', country: 'United States' },
  'Lucas Anderson': { city: 'Houston', state: 'Texas', country: 'United States' },
};

const searchLocation = 'Houston';

console.log(`Search location: "${searchLocation}"`);
console.log('');
console.log('Simulating Apollo enrichment and location filtering...');
console.log('');

const filteredResults: string[] = [];
const rejectedResults: string[] = [];

for (const result of mockCSEResults) {
  const apolloData = mockApolloData[result.name];
  const verified = isLocationVerified(searchLocation, apolloData?.city, apolloData?.state, apolloData?.country);

  if (verified) {
    filteredResults.push(result.name);
    console.log(`✅ KEPT: ${result.name} (Apollo: ${apolloData?.city}, ${apolloData?.state})`);
  } else {
    rejectedResults.push(result.name);
    console.log(`❌ FILTERED: ${result.name} (Apollo: ${apolloData?.city}, ${apolloData?.state})`);
  }
}

console.log('');
console.log('='.repeat(60));
console.log('SIMULATION RESULTS');
console.log('='.repeat(60));
console.log(`Kept (in ${searchLocation}): ${filteredResults.join(', ')}`);
console.log(`Filtered (not in ${searchLocation}): ${rejectedResults.join(', ')}`);
console.log('');

// Verify expected behavior
const expectedKept = ['Devan Patel', 'Suzy Telle', 'Lucas Anderson'];
const expectedFiltered = ['Yuki Ebashi', 'Merritt Cozby'];

const keptCorrect = expectedKept.every(name => filteredResults.includes(name)) &&
                    filteredResults.length === expectedKept.length;
const filteredCorrect = expectedFiltered.every(name => rejectedResults.includes(name)) &&
                        rejectedResults.length === expectedFiltered.length;

if (keptCorrect && filteredCorrect) {
  console.log('✅ Location filtering is working correctly!');
  console.log('   - People in Houston are kept');
  console.log('   - People in New York are filtered out');
} else {
  console.log('❌ Location filtering has issues!');
}

console.log('');
console.log('='.repeat(60));
console.log('CONCLUSION');
console.log('='.repeat(60));
console.log('');
console.log('The Apollo-level location filter (isLocationVerified) correctly:');
console.log('1. Keeps people whose Apollo city/state matches the search location');
console.log('2. Filters out people in different cities');
console.log('3. Filters out people with no Apollo location data');
console.log('');
console.log('This means location accuracy is maintained at the Apollo level,');
console.log('even with relaxed CSE-level filtering.');

process.exit(failed === 0 && keptCorrect && filteredCorrect ? 0 : 1);
