import { PrismaClient } from '@prisma/client';
import { scrapeLinkedInProfiles } from '../src/lib/services/linkedin-scraper';

const prisma = new PrismaClient();

async function main() {
  // Get 5 diverse profiles from DB
  const people = await prisma.person.findMany({
    where: { linkedinUrl: { not: null } },
    select: { linkedinUrl: true, fullName: true, company: true },
    take: 100,
  });

  // Pick 5 diverse ones (different companies)
  const seen = new Set<string>();
  const selected: typeof people = [];
  for (const p of people) {
    if (!seen.has(p.company || '')) {
      selected.push(p);
      seen.add(p.company || '');
      if (selected.length >= 5) break;
    }
  }

  const urls = selected.map(p => p.linkedinUrl!);

  console.log('Testing new LinkedIn scraper service with 5 profiles:\n');
  console.log('URLs:');
  urls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
  console.log('');

  const startTime = Date.now();
  const results = await scrapeLinkedInProfiles(urls);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nCompleted in ${duration}s\n`);

  // Print results table
  console.log('='.repeat(120));
  console.log('| Name                    | Company              | Role                      | Location                | Schools                          |');
  console.log('|'.padEnd(120, '-') + '|');

  for (const r of results) {
    const name = (r.fullName || '').substring(0, 22).padEnd(23);
    const company = (r.company || 'N/A').substring(0, 19).padEnd(20);
    const role = (r.role || 'N/A').substring(0, 24).padEnd(25);
    const loc = [r.city, r.state].filter(Boolean).join(', ').substring(0, 22).padEnd(23);
    const schools = r.schools.slice(0, 2).join(', ').substring(0, 32).padEnd(32);

    console.log(`| ${name} | ${company} | ${role} | ${loc} | ${schools} |`);
  }

  console.log('='.repeat(120));

  // Detailed view
  console.log('\n\n=== DETAILED RESULTS ===\n');

  for (const r of results) {
    console.log(`${r.fullName}`);
    console.log(`  LinkedIn: ${r.linkedinUrl}`);
    console.log(`  Company:  ${r.company || 'N/A'}`);
    console.log(`  Role:     ${r.role || 'N/A'}`);
    console.log(`  Location: ${[r.city, r.state, r.country].filter(Boolean).join(', ') || 'N/A'}`);
    console.log(`  Schools:  ${r.schools.length > 0 ? r.schools.join(' | ') : 'N/A'}`);
    console.log('');
  }

  // Summary stats
  console.log('=== STATS ===');
  console.log(`Profiles scraped: ${results.length}`);
  console.log(`With location: ${results.filter(r => r.city || r.state).length}`);
  console.log(`With schools: ${results.filter(r => r.schools.length > 0).length}`);
  console.log(`Time: ${duration}s (${(parseFloat(duration) / results.length).toFixed(2)}s per profile)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
