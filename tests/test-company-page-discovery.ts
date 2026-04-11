/**
 * Test: LinkedIn company page → employee discovery
 *
 * Step 1: Search for the company's LinkedIn page
 * Step 2: Use the company LinkedIn slug to find employees
 */

import { searchSerper } from '@/lib/services/serper';

async function main() {
  const company = 'Anara';
  const role = 'Software Engineer';

  // ── Step 1: Find the company's LinkedIn page ──
  console.log(`\n=== Step 1: Find LinkedIn company page for "${company}" ===\n`);

  const companyQuery = `site:linkedin.com/company "${company}"`;
  console.log(`Query: ${companyQuery}`);

  const companyResults = await searchSerper(companyQuery);
  console.log(`\nResults (${companyResults.length}):`);

  for (const r of companyResults) {
    console.log(`  ${r.position}. ${r.title}`);
    console.log(`     URL: ${r.link}`);
    console.log(`     Snippet: ${r.snippet.substring(0, 120)}...`);
    console.log();
  }

  // Extract the company LinkedIn slug from the first matching result
  const companyPageUrl = companyResults.find(r =>
    r.link.includes('linkedin.com/company/')
  );

  if (!companyPageUrl) {
    console.log('❌ Could not find LinkedIn company page');
    return;
  }

  // Extract slug: linkedin.com/company/anara-health → anara-health
  const slugMatch = companyPageUrl.link.match(/linkedin\.com\/company\/([^/?]+)/);
  const companySlug = slugMatch?.[1];
  console.log(`✅ Found company slug: "${companySlug}" from ${companyPageUrl.link}\n`);

  // ── Step 2: Find employees using the company slug ──
  console.log(`=== Step 2: Find employees at "${company}" (slug: ${companySlug}) ===\n`);

  // Strategy A: Use company slug in the query
  const employeeQueryA = `site:linkedin.com/in "${company}" ${role}`;
  console.log(`Strategy A query: ${employeeQueryA}`);
  const resultsA = await searchSerper(employeeQueryA);
  console.log(`Strategy A results (${resultsA.length}):`);
  for (const r of resultsA.slice(0, 5)) {
    console.log(`  ${r.position}. ${r.title}`);
    console.log(`     URL: ${r.link}`);
    console.log(`     Snippet: ${r.snippet.substring(0, 150)}`);
    console.log();
  }

  // Strategy B: Use "at Company" but without quotes around "at"
  const employeeQueryB = `site:linkedin.com/in "at ${company}" "${role}"`;
  console.log(`\nStrategy B query: ${employeeQueryB}`);
  const resultsB = await searchSerper(employeeQueryB);
  console.log(`Strategy B results (${resultsB.length}):`);
  for (const r of resultsB.slice(0, 5)) {
    console.log(`  ${r.position}. ${r.title}`);
    console.log(`     URL: ${r.link}`);
    console.log(`     Snippet: ${r.snippet.substring(0, 150)}`);
    console.log();
  }

  // Strategy C: Use company slug directly
  const employeeQueryC = `site:linkedin.com/in "${companySlug}" ${role}`;
  console.log(`\nStrategy C query (slug): ${employeeQueryC}`);
  const resultsC = await searchSerper(employeeQueryC);
  console.log(`Strategy C results (${resultsC.length}):`);
  for (const r of resultsC.slice(0, 5)) {
    console.log(`  ${r.position}. ${r.title}`);
    console.log(`     URL: ${r.link}`);
    console.log(`     Snippet: ${r.snippet.substring(0, 150)}`);
    console.log();
  }

  // Strategy D: Just the company name quoted, no role
  const employeeQueryD = `site:linkedin.com/in "${company}"`;
  console.log(`\nStrategy D query (name only, no role): ${employeeQueryD}`);
  const resultsD = await searchSerper(employeeQueryD);
  console.log(`Strategy D results (${resultsD.length}):`);
  for (const r of resultsD.slice(0, 10)) {
    console.log(`  ${r.position}. ${r.title}`);
    console.log(`     URL: ${r.link}`);
    console.log(`     Snippet: ${r.snippet.substring(0, 150)}`);
    console.log();
  }

  // Strategy E: Company full name from LinkedIn title + role
  if (companyPageUrl.title) {
    const fullCompanyName = companyPageUrl.title
      .replace(/\s*\|.*$/, '')  // Strip "| LinkedIn" suffix
      .replace(/\s*-\s*LinkedIn.*$/, '')
      .trim();

    if (fullCompanyName && fullCompanyName.toLowerCase() !== company.toLowerCase()) {
      const employeeQueryE = `site:linkedin.com/in "${fullCompanyName}" ${role}`;
      console.log(`\nStrategy E query (full name from page): ${employeeQueryE}`);
      const resultsE = await searchSerper(employeeQueryE);
      console.log(`Strategy E results (${resultsE.length}):`);
      for (const r of resultsE.slice(0, 5)) {
        console.log(`  ${r.position}. ${r.title}`);
        console.log(`     URL: ${r.link}`);
        console.log(`     Snippet: ${r.snippet.substring(0, 150)}`);
        console.log();
      }
    }
  }
}

main().catch(console.error);
