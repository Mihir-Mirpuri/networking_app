/**
 * Integration test: end-to-end company-less industry query through
 * searchPeopleV2Action. Proves the advanced-path routing works and
 * Apify returns real profiles.
 *
 * Cost: ~$0.10 per run (one Apify Short page).
 * Usage: npx tsx tests/company-less-search-integration.ts
 *
 * Requires a valid test user in the DB. If no userId is passed, runs
 * the anonymous code path (still exercises the filter routing).
 *
 * NOTE: searchPeopleV2Action is a Next.js server action. When called outside
 * the Next.js runtime, `getServerSession` internally calls `headers()` which
 * requires requestAsyncStorage. We fix this by:
 *   1. Exposing AsyncLocalStorage on globalThis (Next.js checks this).
 *   2. Running the test inside requestAsyncStorage.run() with a minimal mock
 *      store so headers() returns empty headers rather than throwing.
 * getServerSession returns null → anonymous code path. No production code
 * is modified.
 *
 * If tsx resolves next/dist paths to .ts source files (moduleResolution:bundler),
 * the file must be run with the setup preloader:
 *   NODE_OPTIONS='--import ./tests/setup-next-runtime.mjs' npx tsx tests/company-less-search-integration.ts
 */

import 'dotenv/config';

// Expose AsyncLocalStorage on globalThis so Next.js can use it.
// Must happen before any next/* import is evaluated.
import { AsyncLocalStorage } from 'async_hooks';
if (!(globalThis as any).AsyncLocalStorage) {
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
}

import { requestAsyncStorage } from 'next/dist/client/components/request-async-storage.external';
import { searchPeopleV2Action, type SearchInputV2 } from '../src/app/actions/search';

// Minimal mock request store — just enough for headers() to not throw.
const emptyHeaders = new Headers();
const mockStore = {
  headers: emptyHeaders,
  cookies: { getAll: () => [] } as unknown as any,
  mutableCookies: { getAll: () => [] } as unknown as any,
  draftMode: { isEnabled: false } as unknown as any,
  reactLoadableManifest: {},
  assetPrefix: '',
  afterContext: null as unknown as any,
};

async function runTests() {
  let failures = 0;

  const input: SearchInputV2 = {
    query: 'find people in healthcare',
    dbFilters: {},
    linkedInFilters: {
      functionIds: ['11'],  // Hospitals & Health Care function
    },
    limit: 10,
  } as SearchInputV2;

  console.log('Running searchPeopleV2Action with company-less functionIds=["11"]');
  const res = await searchPeopleV2Action(input);

  if (!res.success) {
    console.log(`[FAIL ] success=false: ${res.error}`);
    process.exit(1);
  }

  console.log(`  status: success`);
  console.log(`  results.length = ${res.results.length}`);
  console.log(`  searchMeta.isAdvancedQuery = ${res.searchMeta?.isAdvancedQuery}`);
  console.log(`  searchMeta.shortModePages = ${res.searchMeta?.shortModePages}`);
  console.log(`  searchMeta.apiResultCount = ${res.searchMeta?.apiResultCount}`);
  console.log(`  searchMeta.totalMatchesOnLinkedIn = ${res.searchMeta?.totalMatchesOnLinkedIn}`);

  if (res.results.length === 0) {
    failures++;
    console.log(`  [FAIL ] no results returned`);
  }
  if (res.searchMeta?.isAdvancedQuery !== true) {
    failures++;
    console.log(`  [FAIL ] isAdvancedQuery expected true, got ${res.searchMeta?.isAdvancedQuery}`);
  }
  if ((res.searchMeta?.shortModePages ?? 0) !== 1) {
    failures++;
    console.log(`  [FAIL ] shortModePages expected 1, got ${res.searchMeta?.shortModePages}`);
  }

  console.log('\nSample results:');
  for (const r of res.results.slice(0, 3)) {
    console.log(`  - ${r.fullName ?? '?'} — ${r.role ?? '?'} @ ${r.company ?? '?'}`);
  }

  console.log('\nRunning searchPeopleV2Action with industryIds=["43"] (fintech)');
  const input2: SearchInputV2 = {
    query: 'fintech PMs',
    dbFilters: {},
    linkedInFilters: {
      currentJobTitles: ['Product Manager'],
      industryIds: ['43'],
    },
    limit: 10,
  } as SearchInputV2;

  const res2 = await searchPeopleV2Action(input2);
  if (!res2.success) {
    failures++;
    console.log(`  [FAIL ] fintech run: ${res2.error}`);
  } else {
    console.log(`  results.length = ${res2.results.length}`);
    console.log(`  isAdvancedQuery = ${res2.searchMeta?.isAdvancedQuery}`);
    if (res2.searchMeta?.isAdvancedQuery !== true) {
      failures++;
      console.log(`  [FAIL ] industryIds did not route through advanced path`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} failures`);
    process.exit(1);
  }
  console.log('\nAll integration checks passed.');
}

// Run inside the requestAsyncStorage context so headers() resolves correctly.
requestAsyncStorage.run(mockStore as any, () => {
  runTests().catch(err => {
    console.error(err);
    process.exit(1);
  });
});
