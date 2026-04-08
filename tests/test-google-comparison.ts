import dotenv from 'dotenv';
dotenv.config();

// Dynamic import so env vars are set before module-level consts
async function main() {
  const { searchLinkedInShort } = await import('../src/lib/services/linkedin-search');

  console.log('=== Test 1: "Software Engineer Google" in searchQuery ===');
  const r1 = await searchLinkedInShort({
    searchQuery: 'Software Engineer Google',
    takePages: 1,
  });
  console.log('Total results (name):', r1.pagination.totalElements);
  console.log();

  console.log('=== Test 2: "Software Engineer" + Google LinkedIn URL in currentCompanies ===');
  const r2 = await searchLinkedInShort({
    searchQuery: 'Software Engineer',
    currentCompanies: ['https://www.linkedin.com/company/google'],
    takePages: 1,
  });
  console.log('Total results (URL):', r2.pagination.totalElements);
  console.log();

  console.log('--- Comparison ---');
  console.log('Name-based:', r1.pagination.totalElements.toLocaleString());
  console.log('URL-based: ', r2.pagination.totalElements.toLocaleString());
}

main().catch(console.error);
