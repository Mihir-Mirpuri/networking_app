/**
 * Test script to show ALL CSE results (valid and invalid)
 */

import { config } from 'dotenv';
config();

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
}

interface CSEResponse {
  items?: CSEResult[];
  searchInformation?: { totalResults: string };
}

async function searchCSE(query: string, start?: number): Promise<CSEResult[]> {
  if (!CSE_API_KEY) return [];

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('cr', 'countryUS');
  url.searchParams.set('hl', 'en');
  if (start) url.searchParams.set('start', start.toString());

  const response = await fetch(url.toString());
  if (!response.ok) return [];
  const data: CSEResponse = await response.json();
  return data.items || [];
}

function extractNameFromTitle(title: string): { fullName: string; firstName: string | null; lastName: string | null } | null {
  const match = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s*[-–|]/);
  if (match) {
    const parts = match[1].split(/\s+/);
    if (parts.length >= 2) {
      return { fullName: match[1], firstName: parts[0], lastName: parts.slice(1).join(' ') };
    }
  }
  const fallback = title.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (fallback) {
    const parts = fallback[1].split(/\s+/);
    if (parts.length >= 2) {
      return { fullName: fallback[1], firstName: parts[0], lastName: parts.slice(1).join(' ') };
    }
  }
  return null;
}

function isLinkedInProfileUrl(url: string): boolean {
  return url.includes('linkedin.com/in/');
}

async function main() {
  const query = 'site:linkedin.com/in "McKinsey & Company" "Harvard University" Consulting Associate New York';

  console.log('Query:', query);
  console.log('='.repeat(100));

  const pages = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91];

  let totalResults = 0;
  let validProfiles = 0;
  let invalidProfiles = 0;
  let nonLinkedIn = 0;

  for (const pageStart of pages) {
    const pageNum = Math.floor(pageStart / 10) + 1;
    console.log(`\n=== PAGE ${pageNum} (start=${pageStart}) ===\n`);

    const results = await searchCSE(query, pageStart);

    if (results.length === 0) {
      console.log('  (no results)');
      continue;
    }

    let idx = 0;
    for (const result of results) {
      idx++;
      totalResults++;

      const isLinkedIn = isLinkedInProfileUrl(result.link);
      const parsed = extractNameFromTitle(result.title);
      const isValid = isLinkedIn && parsed && parsed.firstName && parsed.lastName;

      let status: string;
      if (!isLinkedIn) {
        status = '❌ NOT LINKEDIN';
        nonLinkedIn++;
      } else if (!parsed) {
        status = '⚠️  PARSE FAILED';
        invalidProfiles++;
      } else if (!parsed.firstName || !parsed.lastName) {
        status = '⚠️  INCOMPLETE NAME';
        invalidProfiles++;
      } else {
        status = '✅ VALID';
        validProfiles++;
      }

      console.log(`${pageNum}.${idx} [${status}]`);
      console.log(`     Title: ${result.title}`);
      console.log(`     URL: ${result.link}`);
      if (parsed) {
        console.log(`     Parsed: "${parsed.fullName}" (${parsed.firstName} | ${parsed.lastName})`);
      }
      console.log('');
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log('='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`Total CSE results: ${totalResults}`);
  console.log(`Valid profiles: ${validProfiles}`);
  console.log(`Invalid (parse failed): ${invalidProfiles}`);
  console.log(`Non-LinkedIn URLs: ${nonLinkedIn}`);
}

main().catch(console.error);
