/**
 * Debug script: Analyzes search cache to understand why repeat searches return no results
 *
 * Run: npx tsx scripts/debug-search-cache.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(70));
  console.log('SEARCH CACHE DIAGNOSTIC');
  console.log('='.repeat(70));
  console.log('');

  // 1. Check recent searches
  const recentSearches = await prisma.search.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      _count: {
        select: { searchPeople: true }
      }
    }
  });

  console.log('RECENT SEARCHES (last 10):');
  console.log('-'.repeat(70));
  for (const search of recentSearches) {
    console.log(`ID: ${search.id}`);
    console.log(`  Company: ${search.company || '(none)'}`);
    console.log(`  Role: ${search.role || '(none)'}`);
    console.log(`  University: ${search.university || '(none)'}`);
    console.log(`  Location: ${search.location || '(none)'}`);
    console.log(`  Created: ${search.createdAt.toISOString()}`);
    console.log(`  Linked People: ${search._count.searchPeople}`);
    console.log('');
  }

  // 2. Check if searches have linked people
  const searchesWithNoPeople = recentSearches.filter(s => s._count.searchPeople === 0);
  if (searchesWithNoPeople.length > 0) {
    console.log('⚠️  PROBLEM: Some searches have NO linked people:');
    for (const s of searchesWithNoPeople) {
      console.log(`   - ${s.id} (${s.company}, ${s.location})`);
    }
    console.log('');
  }

  // 3. For a search with people, check the person data
  const searchWithPeople = recentSearches.find(s => s._count.searchPeople > 0);
  if (searchWithPeople) {
    console.log(`SAMPLE SEARCH ANALYSIS: ${searchWithPeople.id}`);
    console.log('-'.repeat(70));

    const searchPeople = await prisma.searchPerson.findMany({
      where: { searchId: searchWithPeople.id },
      include: {
        person: {
          select: {
            id: true,
            fullName: true,
            company: true,
            email: true,
            emailStatus: true,
            city: true,
            state: true,
          }
        }
      },
      take: 20
    });

    console.log(`People linked to this search (${searchPeople.length}):`);

    let missingEmailCount = 0;
    let noLocationCount = 0;

    for (const sp of searchPeople) {
      const p = sp.person;
      const emailIcon = p.emailStatus === 'VERIFIED' ? '✅' : p.emailStatus === 'UNVERIFIED' ? '⚠️' : '❌';
      console.log(`  ${emailIcon} ${p.fullName} @ ${p.company}`);
      console.log(`     Email: ${p.email || 'NONE'} (${p.emailStatus || 'MISSING'})`);
      console.log(`     Location: ${p.city || '?'}, ${p.state || '?'}`);

      if (!p.email || p.emailStatus === 'MISSING') missingEmailCount++;
      if (!p.city && !p.state) noLocationCount++;
    }

    console.log('');
    console.log('SUMMARY:');
    console.log(`  Total linked: ${searchPeople.length}`);
    console.log(`  Missing email: ${missingEmailCount}`);
    console.log(`  No location data: ${noLocationCount}`);
    console.log('');
  }

  // 4. Check UserCandidates for exclusions
  const userCandidateStats = await prisma.userCandidate.groupBy({
    by: ['doNotShow'],
    _count: true,
  });

  console.log('USER CANDIDATE STATS (doNotShow):');
  console.log('-'.repeat(70));
  for (const stat of userCandidateStats) {
    console.log(`  doNotShow=${stat.doNotShow}: ${stat._count} candidates`);
  }
  console.log('');

  // 5. Check how many have been sent emails
  const sentCount = await prisma.sendLog.count({
    where: { status: 'SUCCESS' }
  });
  console.log(`Total successful sends: ${sentCount}`);
  console.log('');

  // 6. Simulate what happens in a cached search
  if (searchWithPeople) {
    console.log('SIMULATING CACHED SEARCH FLOW:');
    console.log('-'.repeat(70));

    const searchPeopleIds = await prisma.searchPerson.findMany({
      where: { searchId: searchWithPeople.id },
      select: { personId: true }
    });

    const personIds = searchPeopleIds.map(sp => sp.personId);
    console.log(`1. Found ${personIds.length} person IDs in cache`);

    const persons = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: {
        id: true,
        fullName: true,
        company: true,
        email: true,
        emailStatus: true,
      }
    });
    console.log(`2. Fetched ${persons.length} Person records`);

    // Check email status distribution
    const byStatus = {
      VERIFIED: persons.filter(p => p.emailStatus === 'VERIFIED').length,
      UNVERIFIED: persons.filter(p => p.emailStatus === 'UNVERIFIED').length,
      MISSING: persons.filter(p => !p.emailStatus || p.emailStatus === 'MISSING').length,
    };
    console.log(`3. Email status distribution:`);
    console.log(`   VERIFIED: ${byStatus.VERIFIED}`);
    console.log(`   UNVERIFIED: ${byStatus.UNVERIFIED}`);
    console.log(`   MISSING: ${byStatus.MISSING}`);

    // The filter removes MISSING
    const afterEmailFilter = byStatus.VERIFIED + byStatus.UNVERIFIED;
    console.log(`4. After email filter (remove MISSING): ${afterEmailFilter} remain`);

    if (afterEmailFilter === 0) {
      console.log('');
      console.log('🚨 ROOT CAUSE FOUND: All cached persons have MISSING email status!');
      console.log('   The cache stores person IDs, but those persons have no email data.');
      console.log('   This happens if Apollo enrichment failed or was skipped.');
    }
  }

  console.log('');
  console.log('='.repeat(70));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
