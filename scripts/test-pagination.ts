/**
 * Test script for the on-demand pagination functionality
 * Tests the simplified refresh flow (no background batch 2)
 */
import { PrismaClient } from '@prisma/client';
import { discoverLinkedInProfiles } from '../src/lib/services/discovery';

const prisma = new PrismaClient();

async function testCSEPagination() {
  console.log('=== Testing CSE Pagination ===\n');

  const company = 'McKinsey';

  // Test page 1 (start=1)
  console.log('Page 1 (start=1):');
  const page1Results = await discoverLinkedInProfiles({
    company,
    limit: 10,
    pageStart: 1,
  });
  console.log(`  Found ${page1Results.length} results`);
  console.log(`  hasMore would be: ${page1Results.length === 10}`);
  if (page1Results.length > 0) {
    console.log(`  First URL: ${page1Results[0].linkedinUrl}`);
    console.log(`  Last URL: ${page1Results[page1Results.length - 1].linkedinUrl}`);
  }
  console.log('');

  // Test page 2 (start=11)
  console.log('Page 2 (start=11):');
  const page2Results = await discoverLinkedInProfiles({
    company,
    limit: 10,
    pageStart: 11,
  });
  console.log(`  Found ${page2Results.length} results`);
  console.log(`  hasMore would be: ${page2Results.length === 10}`);
  if (page2Results.length > 0) {
    console.log(`  First URL: ${page2Results[0].linkedinUrl}`);
    console.log(`  Last URL: ${page2Results[page2Results.length - 1].linkedinUrl}`);
  }
  console.log('');

  // Test page 3 (start=21)
  console.log('Page 3 (start=21):');
  const page3Results = await discoverLinkedInProfiles({
    company,
    limit: 10,
    pageStart: 21,
  });
  console.log(`  Found ${page3Results.length} results`);
  console.log(`  hasMore would be: ${page3Results.length === 10}`);
  if (page3Results.length > 0) {
    console.log(`  First URL: ${page3Results[0].linkedinUrl}`);
    console.log(`  Last URL: ${page3Results[page3Results.length - 1].linkedinUrl}`);
  }
  console.log('');

  // Verify no duplicates between pages
  const allUrls = [...page1Results, ...page2Results, ...page3Results].map(r => r.linkedinUrl);
  const uniqueUrls = new Set(allUrls);
  console.log('Duplicate check:');
  console.log(`  Total URLs: ${allUrls.length}`);
  console.log(`  Unique URLs: ${uniqueUrls.size}`);
  console.log(`  Duplicates: ${allUrls.length - uniqueUrls.size}`);

  if (allUrls.length !== uniqueUrls.size) {
    console.log('  WARNING: Found duplicate URLs across pages!');
    const seen = new Map<string, number>();
    allUrls.forEach((url, i) => {
      if (seen.has(url)) {
        console.log(`    Duplicate: ${url} (first at ${seen.get(url)}, again at ${i})`);
      } else {
        seen.set(url, i);
      }
    });
  } else {
    console.log('  OK: No duplicates found');
  }
}

async function testRefreshBatchLogic() {
  console.log('\n=== Testing Refresh Batch Logic ===\n');

  // Simulate what processRefreshBatch does
  const company = 'Deloitte';

  // Page 1
  console.log('Simulating processRefreshBatch for page 1:');
  const cse1 = await discoverLinkedInProfiles({ company, limit: 10, pageStart: 1 });
  console.log(`  CSE returned ${cse1.length} URLs`);
  console.log(`  urlsFromCse: ${cse1.length}`);
  console.log(`  hasMore (cse.length === 10): ${cse1.length === 10}`);

  // Check how many are already in DB
  const urls1 = cse1.map(r => r.linkedinUrl);
  const existing1 = await prisma.person.findMany({
    where: { linkedinUrl: { in: urls1 } },
    select: { linkedinUrl: true }
  });
  console.log(`  Already in DB: ${existing1.length}`);
  console.log(`  Would scrape: ${urls1.length - existing1.length}`);
  console.log('');

  // Page 2
  console.log('Simulating processRefreshBatch for page 2:');
  const cse2 = await discoverLinkedInProfiles({ company, limit: 10, pageStart: 11 });
  console.log(`  CSE returned ${cse2.length} URLs`);
  console.log(`  urlsFromCse: ${cse2.length}`);
  console.log(`  hasMore (cse.length === 10): ${cse2.length === 10}`);

  const urls2 = cse2.map(r => r.linkedinUrl);
  const existing2 = await prisma.person.findMany({
    where: { linkedinUrl: { in: urls2 } },
    select: { linkedinUrl: true }
  });
  console.log(`  Already in DB: ${existing2.length}`);
  console.log(`  Would scrape: ${urls2.length - existing2.length}`);
}

async function testEdgeCases() {
  console.log('\n=== Testing Edge Cases ===\n');

  // Test with a company that might have few results
  const smallCompany = 'Anthropic';

  console.log(`Testing with "${smallCompany}" (might have fewer results):`);

  let page = 1;
  let hasMore = true;
  let totalFound = 0;

  while (hasMore && page <= 5) {
    const pageStart = (page - 1) * 10 + 1;
    const results = await discoverLinkedInProfiles({
      company: smallCompany,
      limit: 10,
      pageStart,
    });

    console.log(`  Page ${page} (start=${pageStart}): ${results.length} results`);
    totalFound += results.length;
    hasMore = results.length === 10;
    page++;
  }

  console.log(`  Total found across ${page - 1} pages: ${totalFound}`);
  console.log(`  Stopped because: ${hasMore ? 'reached page limit' : 'no more results'}`);
}

async function main() {
  try {
    await testCSEPagination();
    await testRefreshBatchLogic();
    await testEdgeCases();

    console.log('\n=== All Tests Complete ===');
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
