/**
 * Test: LinkedIn search for "Software Engineer Composite" to see if we can
 * extract the correct company LinkedIn URL from the results.
 *
 * Cost: $0.10 (1 Apify search page)
 */
import 'dotenv/config';
import { searchLinkedInShort } from '../src/lib/services/linkedin-search';

async function main() {
  console.log('Searching LinkedIn for: "Software Engineer Composite"');
  console.log('─'.repeat(60));

  const start = Date.now();
  const result = await searchLinkedInShort({
    searchQuery: 'Software Engineer Composite',
    takePages: 1,
  });
  const elapsed = Date.now() - start;

  console.log(`\nLatency: ${elapsed}ms`);
  console.log(`Profiles returned: ${result.profiles.length}`);
  console.log(`Total matches: ${result.pagination.totalElements}`);
  console.log(`Cost: $${(result.cost.costCents / 100).toFixed(2)}`);
  console.log('─'.repeat(60));

  // Show each profile with company URL
  for (const p of result.profiles) {
    console.log(`\n${p.fullName}`);
    console.log(`  Role: ${p.role || '(none)'}`);
    console.log(`  Company: ${p.company || '(none)'}`);
    console.log(`  Company LinkedIn URL: ${p.companyLinkedinUrl || '(none)'}`);
    console.log(`  Location: ${p.location || '(none)'}`);
    console.log(`  Profile: ${p.linkedinUrl}`);
  }

  // Aggregate company URLs
  console.log('\n' + '─'.repeat(60));
  console.log('Company URL frequency:');
  const urlCounts = new Map<string, number>();
  for (const p of result.profiles) {
    const url = p.companyLinkedinUrl || '(none)';
    urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
  }
  const sorted = [...urlCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [url, count] of sorted) {
    console.log(`  ${count}x  ${url}`);
  }
}

main().catch(console.error);
