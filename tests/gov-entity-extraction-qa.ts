/**
 * Government Entity Extraction QA
 *
 * Phase 1: Tests that government departments/agencies are recognized as specific
 *          named entities (status: "ready") rather than categories or unsupported.
 * Phase 2: Tests that the company URL resolver returns correct LinkedIn company URLs.
 *
 * Usage:
 *   npx tsx tests/gov-entity-extraction-qa.ts
 *   npx tsx tests/gov-entity-extraction-qa.ts --extract-only   # Skip URL resolution
 */

import 'dotenv/config';

import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';
import { completeJsonAnthropic } from '../src/lib/services/anthropic';
import { resolveCompanyUrl } from '../src/lib/services/company-resolver';

const extractOnly = process.argv.includes('--extract-only');

interface LLMResponse {
  status: string;
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  message: string;
  unsupported_criteria?: string[] | null;
  selectables?: Array<{ label: string; filter_key: string; filter_value: string }>;
}

interface TestCase {
  id: string;
  query: string;
  expectStatus: 'ready';
  expectCompanyContains: string;
  /** Expected LinkedIn company URL slug (substring match on resolved URL) */
  expectUrlSlug: string;
}

const CASES: TestCase[] = [
  {
    id: 'doge',
    query: 'people who work in department of government efficiency',
    expectStatus: 'ready',
    expectCompanyContains: 'Government Efficiency',
    expectUrlSlug: 'united-states-doge-service',
  },
  {
    id: 'doge-short',
    query: 'engineers at DOGE',
    expectStatus: 'ready',
    expectCompanyContains: 'Government Efficiency',
    expectUrlSlug: 'united-states-doge-service',
  },
  {
    id: 'fbi',
    query: 'analysts at the FBI',
    expectStatus: 'ready',
    expectCompanyContains: 'FBI',
    expectUrlSlug: 'fbi',
  },
  {
    id: 'nasa',
    query: 'engineers at NASA',
    expectStatus: 'ready',
    expectCompanyContains: 'NASA',
    expectUrlSlug: 'nasa',
  },
  {
    id: 'sec',
    query: 'lawyers at the SEC',
    expectStatus: 'ready',
    expectCompanyContains: 'SEC',
    expectUrlSlug: 'sec',
  },
  {
    id: 'epa',
    query: 'people at the EPA',
    expectStatus: 'ready',
    expectCompanyContains: 'EPA',
    expectUrlSlug: 'epa',
  },
  {
    id: 'dod',
    query: 'engineers at Department of Defense',
    expectStatus: 'ready',
    expectCompanyContains: 'Defense',
    expectUrlSlug: 'department-of-defense',
  },
  {
    id: 'state-dept',
    query: 'people at the State Department',
    expectStatus: 'ready',
    expectCompanyContains: 'State',
    expectUrlSlug: 'us-department-of-state',
  },
  {
    id: 'cia',
    query: 'analysts at the CIA',
    expectStatus: 'ready',
    expectCompanyContains: 'CIA',
    expectUrlSlug: 'cia',
  },
  {
    id: 'usaid',
    query: 'people who work at USAID',
    expectStatus: 'ready',
    expectCompanyContains: 'USAID',
    expectUrlSlug: 'usaid',
  },
];

// ─── Phase 1: Extraction ─────────────────────────────────────────────────────

interface ExtractionResult {
  pass: boolean;
  detail: string;
  extractedCompany: string | null;
}

async function runExtraction(tc: TestCase): Promise<ExtractionResult> {
  try {
    const res = await completeJsonAnthropic<LLMResponse>({
      systemPrompt: SEARCH_EXTRACTION_SYSTEM_PROMPT,
      userPrompt: `New user message: ${tc.query}`,
      options: { temperature: 0.1, maxTokens: 500 },
      metadata: { action: 'GOV_ENTITY_QA' },
    });

    const { status, filters, message } = res.content;
    const company = filters?.company ?? '';

    const statusOk = status === tc.expectStatus;
    const companyOk = company.toLowerCase().includes(tc.expectCompanyContains.toLowerCase());

    if (statusOk && companyOk) {
      return { pass: true, detail: `status=${status}, company="${company}"`, extractedCompany: company };
    }

    const issues: string[] = [];
    if (!statusOk) issues.push(`status="${status}" (expected "${tc.expectStatus}")`);
    if (!companyOk) issues.push(`company="${company}" (expected to contain "${tc.expectCompanyContains}")`);
    if (res.content.unsupported_criteria?.length) issues.push(`unsupported: ${res.content.unsupported_criteria.join(', ')}`);
    if (res.content.selectables?.length) issues.push(`selectables: ${res.content.selectables.map(s => s.label).join(', ')}`);

    return { pass: false, detail: `${issues.join('; ')} | msg: "${message}"`, extractedCompany: company || null };
  } catch (err) {
    return { pass: false, detail: `ERROR: ${err instanceof Error ? err.message : String(err)}`, extractedCompany: null };
  }
}

// ─── Phase 2: URL Resolution ─────────────────────────────────────────────────

interface UrlResult {
  pass: boolean;
  detail: string;
}

async function runUrlResolution(tc: TestCase, companyName: string): Promise<UrlResult> {
  try {
    const resolved = await resolveCompanyUrl(companyName);
    const url = resolved.url;

    if (!url) {
      return { pass: false, detail: `No URL resolved for "${companyName}"` };
    }

    const slugOk = url.toLowerCase().includes(tc.expectUrlSlug.toLowerCase());
    if (slugOk) {
      return { pass: true, detail: url };
    }

    return { pass: false, detail: `URL "${url}" does not contain expected slug "${tc.expectUrlSlug}"` };
  } catch (err) {
    return { pass: false, detail: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Government Entity QA — ${CASES.length} test cases ===\n`);

  // Phase 1
  console.log(`--- Phase 1: Filter Extraction ---\n`);
  let extractPassed = 0;
  let extractFailed = 0;
  const extractedCompanies = new Map<string, string>();

  for (const tc of CASES) {
    const result = await runExtraction(tc);
    const icon = result.pass ? 'PASS' : 'FAIL';
    console.log(`${icon} [${tc.id}] "${tc.query}"`);
    console.log(`     ${result.detail}\n`);
    if (result.pass) {
      extractPassed++;
      if (result.extractedCompany) extractedCompanies.set(tc.id, result.extractedCompany);
    } else {
      extractFailed++;
    }
  }

  console.log(`Phase 1 Results: ${extractPassed}/${CASES.length} passed, ${extractFailed} failed\n`);

  if (extractOnly) {
    process.exit(extractFailed > 0 ? 1 : 0);
    return;
  }

  // Phase 2: Deduplicate — only resolve each unique company name once
  console.log(`--- Phase 2: LinkedIn URL Resolution ---\n`);
  let urlPassed = 0;
  let urlFailed = 0;

  // Deduplicate: multiple test cases may extract the same company name
  const seenCompanies = new Map<string, { url: string | null; pass: boolean }>();

  for (const tc of CASES) {
    const companyName = extractedCompanies.get(tc.id);
    if (!companyName) {
      console.log(`SKIP [${tc.id}] — extraction failed, no company to resolve\n`);
      urlFailed++;
      continue;
    }

    // Check if we already resolved this exact company name
    const cached = seenCompanies.get(companyName);
    if (cached !== undefined) {
      // Re-check slug against this test case's expected slug
      const url = cached.url;
      if (url && url.toLowerCase().includes(tc.expectUrlSlug.toLowerCase())) {
        console.log(`PASS [${tc.id}] "${companyName}" -> ${url} (cached)\n`);
        urlPassed++;
      } else {
        console.log(`FAIL [${tc.id}] "${companyName}" -> ${url ?? 'null'} (expected slug: "${tc.expectUrlSlug}") (cached)\n`);
        urlFailed++;
      }
      continue;
    }

    const result = await runUrlResolution(tc, companyName);
    const icon = result.pass ? 'PASS' : 'FAIL';
    console.log(`${icon} [${tc.id}] "${companyName}" -> ${result.detail}\n`);
    if (result.pass) {
      urlPassed++;
      seenCompanies.set(companyName, { url: result.detail, pass: true });
    } else {
      urlFailed++;
      seenCompanies.set(companyName, { url: null, pass: false });
    }
  }

  console.log(`Phase 2 Results: ${urlPassed}/${CASES.length} passed, ${urlFailed} failed\n`);

  const totalFailed = extractFailed + urlFailed;
  console.log(`=== Overall: ${extractPassed + urlPassed}/${CASES.length * 2} checks passed, ${totalFailed} failed ===\n`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
