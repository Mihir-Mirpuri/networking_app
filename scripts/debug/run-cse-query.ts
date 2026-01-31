/**
 * Run CSE query directly to see raw results
 */

import * as dotenv from 'dotenv';
dotenv.config();

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || "bf53ffdb484f145c5";

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

async function searchCSE(query: string, start: number): Promise<{ items: CSEResult[], totalResults: string }> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", CSE_API_KEY || "");
  url.searchParams.set("cx", CSE_CX);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "10");
  url.searchParams.set("gl", "us");
  url.searchParams.set("cr", "countryUS");
  url.searchParams.set("hl", "en");
  url.searchParams.set("start", start.toString());

  const response = await fetch(url.toString());
  if (response.status !== 200) {
    console.error("CSE API error:", response.status, await response.text());
    return { items: [], totalResults: "0" };
  }
  const data = await response.json();
  return { items: data.items || [], totalResults: data.searchInformation?.totalResults || "0" };
}

async function main() {
  // Query matching the user's search:
  // Company: Bain & Company
  // Role: Consulting Associate
  // University: University of Texas at Austin
  // Location: New York

  const query = `site:linkedin.com/in "Bain & Company" "University of Texas at Austin" Consulting Associate New York`;

  console.log("=== CSE Query ===");
  console.log(query);
  console.log("");

  const pages = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91];
  let totalFound = 0;

  for (const start of pages) {
    console.log(`\n=== Page ${Math.ceil(start/10)} (start=${start}) ===`);
    const { items, totalResults } = await searchCSE(query, start);

    if (start === 1) {
      console.log(`Total results estimated by Google: ${totalResults}`);
    }

    if (items.length === 0) {
      console.log("No more results");
      break;
    }

    for (const item of items) {
      totalFound++;
      console.log(`${totalFound}. ${item.title}`);
      console.log(`   URL: ${item.link}`);
      console.log(`   Snippet: ${item.snippet.substring(0, 100)}...`);
      console.log("");
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== TOTAL: ${totalFound} results from CSE ===`);
}

main().catch(console.error);
