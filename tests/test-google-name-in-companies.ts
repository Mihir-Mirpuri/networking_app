import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const { searchLinkedInShort } = await import('../src/lib/services/linkedin-search');

  const r = await searchLinkedInShort({
    searchQuery: 'Software Engineer',
    currentCompanies: ['Google'],
    takePages: 1,
  });
  console.log('Total results (name in currentCompanies):', r.pagination.totalElements);
  console.log('Sample:', r.profiles.slice(0, 3).map(p => `${p.fullName} — ${p.role} at ${p.company}`).join('; '));
}

main().catch(console.error);
