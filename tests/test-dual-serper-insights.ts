import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { searchSerper } from '../src/lib/services/serper';

const prisma = new PrismaClient();

async function main() {
  // Test the dual query approach directly first
  const name = 'Jiaqi Zhang';
  const company = 'Worley'; // Current company

  console.log('=== Testing dual Serper queries ===\n');

  const [nameResults, nameCompanyResults] = await Promise.all([
    searchSerper(`"${name}"`),
    searchSerper(`"${name}" "${company}"`),
  ]);

  console.log('Name-only results:', nameResults.length);
  console.log('Name+Company results:', nameCompanyResults.length);

  // Merge and dedupe
  const seen = new Set<string>();
  const merged: Array<{ title: string; link: string; snippet: string }> = [];
  for (const r of [...nameResults, ...nameCompanyResults]) {
    if (seen.has(r.link)) continue;
    seen.add(r.link);
    merged.push({ title: r.title, link: r.link, snippet: r.snippet });
  }

  console.log('Merged unique:', merged.length, '\n');

  for (const r of merged.slice(0, 15)) {
    console.log('  ' + r.title);
    console.log('  ' + r.link);
    console.log('  ' + (r.snippet || '').substring(0, 150));
    console.log();
  }

  // Now test the full pipeline on Abdi Mohamed (the original problem case)
  console.log('\n=== Full pipeline test: Abdi Mohamed ===\n');

  const person = await prisma.person.findFirst({
    where: { fullName: { contains: 'Abdi Mohamed', mode: 'insensitive' } },
    select: { id: true, fullName: true, company: true },
  });

  if (person === null) {
    console.log('Person not found');
    await prisma.$disconnect();
    return;
  }

  console.log('Found:', person.fullName, '|', person.company);

  // Delete cached insights
  await prisma.personInsight.deleteMany({ where: { personId: person.id } });
  await prisma.$disconnect();

  const { getOrExtractInsights } = await import('../src/lib/services/person-insights');

  console.log('Extracting insights...\n');
  const result = await getOrExtractInsights(person.id);

  console.log('Insights count:', result.insights.length);
  for (const i of result.insights) {
    console.log('[' + i.source + '] ' + i.label);
    console.log('  ' + i.detail);
    console.log();
  }
}

main().catch(console.error);
