/**
 * Test: LLM company name ambiguity classification
 *
 * Validates that the Groq LLM correctly classifies company names as ambiguous
 * or unambiguous using the same system prompt as ai-search.ts.
 *
 * Run: npx tsx tests/test-company-ambiguity.ts
 */

import 'dotenv/config';
import { completeJson } from '../src/lib/services/groq';

// Subset of the SYSTEM_PROMPT from ai-search.ts that covers the ambiguity rules
const SYSTEM_PROMPT = `You are a search filter extraction assistant for a professional networking tool. Your job is to help users find people by extracting structured search filters from natural language.

A search requires exactly ONE company. Role is optional but recommended.

You must return JSON with this schema:
{
  "status": "ready" | "needs_selection" | "off_topic" | "person_lookup",
  "confidence": "high" | "low",
  "filters": { "company": string|null, "role": string|null, "university": string|null, "location": string|null },
  "company_name_ambiguous": boolean,
  "person_name": string|null,
  "person_company": string|null,
  "selectables": [{ "label": string, "filter_key": "company"|"role", "filter_value": string }],
  "suggested_searches": [{ "label": string, "company": string, "role": string|null }],
  "message": string
}

STATUS RULES:
- "ready": Company is clearly specified. Role is optional — if the user doesn't mention a role, set role to null and return "ready". Trigger the search.

COMPANY NAME AMBIGUITY:
- Set "company_name_ambiguous" to true when the company name could easily be confused with a person's name or a common English word (e.g., Chase, Block, Bolt, Squire, Square, Plaid, Hinge, Gusto, Toast, Brex, Ramp).
- Set to false for distinctive, well-known company names that are unlikely to be confused (e.g., McKinsey, Google, Goldman Sachs, Stripe, Anthropic, JPMorgan, Deloitte, Microsoft, Meta, Apple, Figma, Notion).
- Default to true when unsure.

FILTER RULES:
1. "at [X]" = company.
2. Always extract a company when one is clearly stated.
3. ROLE NORMALIZATION: "engineers" → "Software Engineer"

MESSAGE RULES:
- For "ready": brief confirmation of what you're searching.`;

interface LLMResponse {
  status: string;
  filters: { company: string | null; role: string | null; university: string | null; location: string | null };
  company_name_ambiguous?: boolean;
  selectables: unknown[];
  suggested_searches: unknown[];
  message: string;
}

const TEST_CASES = [
  // Ambiguous — names that are also person names or common words
  { company: 'Chase', expected: true },
  { company: 'Block', expected: true },
  { company: 'Bolt', expected: true },
  { company: 'Squire', expected: true },
  { company: 'Square', expected: true },
  { company: 'Plaid', expected: true },
  { company: 'Hinge', expected: true },
  { company: 'Gusto', expected: true },
  { company: 'Brex', expected: true },
  { company: 'Toast', expected: true },

  // Unambiguous — distinctive company names
  { company: 'McKinsey', expected: false },
  { company: 'Google', expected: false },
  { company: 'Goldman Sachs', expected: false },
  { company: 'Stripe', expected: false },
  { company: 'Anthropic', expected: false },
  { company: 'JPMorgan', expected: false },
  { company: 'Deloitte', expected: false },
  { company: 'Microsoft', expected: false },

  // Edge cases — test LLM judgment
  { company: 'Ramp', expected: true },
  { company: 'Notion', expected: false },
  { company: 'Figma', expected: false },
  { company: 'Meta', expected: false },
  { company: 'Apple', expected: false },
];

async function testCompany(company: string, expected: boolean): Promise<{ pass: boolean; actual: boolean | undefined }> {
  const response = await completeJson<LLMResponse>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `engineers at ${company}`,
    options: {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      maxTokens: 512,
    },
    metadata: {
      userId: 'test-user',
      action: 'SEARCH_FILTER_EXTRACTION',
    },
  });

  const actual = response.content.company_name_ambiguous;
  const pass = actual === expected;
  return { pass, actual };
}

async function main() {
  console.log('Testing LLM company name ambiguity classification...\n');

  let passed = 0;
  let failed = 0;

  for (const { company, expected } of TEST_CASES) {
    try {
      const { pass, actual } = await testCompany(company, expected);
      const status = pass ? 'PASS' : 'FAIL';
      const icon = pass ? '\u2705' : '\u274C';
      console.log(`${icon} ${status}: "${company}" — expected=${expected}, got=${actual}`);
      if (pass) passed++;
      else failed++;
    } catch (err) {
      console.log(`\u274C ERROR: "${company}" — ${err}`);
      failed++;
    }
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed out of ${TEST_CASES.length} ---`);

  if (failed > 0) {
    console.log('\nSome classifications were incorrect. Consider refining the prompt wording.');
    process.exit(1);
  } else {
    console.log('\nAll classifications correct!');
  }
}

main().catch(console.error);
