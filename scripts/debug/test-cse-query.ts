/**
 * Test script to debug CSE query results
 *
 * Usage: npx ts-node scripts/debug/test-cse-query.ts
 */

import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface CSEResponse {
  items?: CSEResult[];
  searchInformation?: {
    totalResults: string;
  };
}

async function searchCSE(query: string, start?: number): Promise<{ results: CSEResult[]; totalResults: string }> {
  if (!CSE_API_KEY) {
    console.log('CSE API key not configured');
    return { results: [], totalResults: '0' };
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('cr', 'countryUS');
  url.searchParams.set('hl', 'en');
  if (start) {
    url.searchParams.set('start', start.toString());
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    console.error('CSE API error:', response.status, await response.text());
    return { results: [], totalResults: '0' };
  }
  const data: CSEResponse = await response.json();
  return {
    results: data.items || [],
    totalResults: data.searchInformation?.totalResults || '0'
  };
}

function extractNameFromTitle(title: string): { fullName: string; firstName: string | null; lastName: string | null } | null {
  const match = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s*[-–|]/);
  if (match) {
    const parts = match[1].split(/\s+/);
    if (parts.length >= 2) {
      return {
        fullName: match[1],
        firstName: parts[0],
        lastName: parts.slice(1).join(' '),
      };
    }
  }

  const fallback = title.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (fallback) {
    const parts = fallback[1].split(/\s+/);
    if (parts.length >= 2) {
      return {
        fullName: fallback[1],
        firstName: parts[0],
        lastName: parts.slice(1).join(' '),
      };
    }
  }

  return null;
}

function isLinkedInProfileUrl(url: string): boolean {
  return url.includes('linkedin.com/in/');
}

async function main() {
  // Search parameters from user
  const company = 'McKinsey & Company';
  const role = 'Consulting Associate';
  const university = 'Harvard University';
  const location = 'New York';

  // Build query exactly like discovery.ts does
  const queryParts: string[] = [];
  queryParts.push(`"${company}"`);
  queryParts.push(`"${university}"`);
  queryParts.push(role); // Unquoted for flexibility
  queryParts.push(location); // Unquoted for flexibility

  const query = `site:linkedin.com/in ${queryParts.join(' ')}`;

  console.log('='.repeat(80));
  console.log('CSE QUERY DEBUG TEST');
  console.log('='.repeat(80));
  console.log(`\nSearch Parameters:`);
  console.log(`  Company: ${company}`);
  console.log(`  Role: ${role}`);
  console.log(`  University: ${university}`);
  console.log(`  Location: ${location}`);
  console.log(`\nConstructed Query: ${query}`);
  console.log('='.repeat(80));

  // Fetch all 10 pages (starts at 1, 11, 21, 31, 41, 51, 61, 71, 81, 91)
  const pages = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91];

  const allResults: Array<{
    page: number;
    name: string;
    title: string;
    link: string;
    snippet: string;
    inDatabase: boolean;
    dbRecord?: {
      id: string;
      company: string;
      role: string | null;
      email: string | null;
      educationSchool: string | null;
    };
  }> = [];

  let totalCSEResults = '0';

  for (const pageStart of pages) {
    const pageNum = Math.floor(pageStart / 10) + 1;
    console.log(`\n--- Page ${pageNum} (start=${pageStart}) ---`);

    const { results, totalResults } = await searchCSE(query, pageStart);
    if (pageStart === 1) {
      totalCSEResults = totalResults;
    }

    if (results.length === 0) {
      console.log('  No results on this page');
      continue;
    }

    for (const result of results) {
      if (!isLinkedInProfileUrl(result.link)) {
        continue;
      }

      const parsed = extractNameFromTitle(result.title);
      if (!parsed || !parsed.firstName || !parsed.lastName) {
        console.log(`  [SKIP] Could not parse name: "${result.title}"`);
        continue;
      }

      // Check database for this person
      const dbPerson = await prisma.person.findFirst({
        where: {
          fullName: parsed.fullName,
        },
        select: {
          id: true,
          fullName: true,
          company: true,
          role: true,
          email: true,
          educationSchool: true,
        },
      });

      allResults.push({
        page: pageNum,
        name: parsed.fullName,
        title: result.title,
        link: result.link,
        snippet: result.snippet.substring(0, 100) + '...',
        inDatabase: !!dbPerson,
        dbRecord: dbPerson ? {
          id: dbPerson.id,
          company: dbPerson.company,
          role: dbPerson.role,
          email: dbPerson.email,
          educationSchool: dbPerson.educationSchool,
        } : undefined,
      });

      const dbStatus = dbPerson
        ? `✅ IN DB (company: ${dbPerson.company}, school: ${dbPerson.educationSchool || 'none'})`
        : '❌ NOT IN DB';

      console.log(`  ${parsed.fullName} - ${dbStatus}`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nCSE Total Results Estimate: ${totalCSEResults}`);
  console.log(`LinkedIn profiles found: ${allResults.length}`);
  console.log(`In database: ${allResults.filter(r => r.inDatabase).length}`);
  console.log(`Not in database: ${allResults.filter(r => !r.inDatabase).length}`);

  // List all people found
  console.log('\n--- All People Found ---');
  for (const result of allResults) {
    console.log(`\nPage ${result.page}: ${result.name}`);
    console.log(`  LinkedIn: ${result.link}`);
    console.log(`  Title: ${result.title}`);
    if (result.inDatabase && result.dbRecord) {
      console.log(`  DB: company="${result.dbRecord.company}", role="${result.dbRecord.role}", email="${result.dbRecord.email}", school="${result.dbRecord.educationSchool}"`);
    } else {
      console.log(`  DB: NOT FOUND`);
    }
  }

  // Check how many of these would match the university filter
  const withHarvard = allResults.filter(r =>
    r.inDatabase && r.dbRecord?.educationSchool?.toLowerCase().includes('harvard')
  );
  console.log(`\n--- People with Harvard in educationSchool: ${withHarvard.length} ---`);
  for (const p of withHarvard) {
    console.log(`  ${p.name} - ${p.dbRecord?.educationSchool}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
