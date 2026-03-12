/**
 * Test: AI Filter Extraction — 20 diverse queries
 * Tests the Groq LLM filter extraction with the same system prompt used in production.
 *
 * Usage: npx tsx tests/test-ai-filter-extraction.ts
 */

import 'dotenv/config';
import Groq from 'groq-sdk';

const SYSTEM_PROMPT = `You are a search filter extraction assistant. Your job is to extract structured search filters from natural language queries about finding professional contacts.

You must extract up to 5 filters:
- company: A single company/organization name (e.g., "Google", "McKinsey", "Goldman Sachs")
- companies: An array of company names when the user asks about a category/industry (e.g., "top consulting firms" → ["McKinsey", "BCG", "Bain", "Deloitte", "Accenture"], "big tech" → ["Google", "Apple", "Amazon", "Meta", "Microsoft"]). Max 5 companies.
- role: The job role/title (e.g., "Product Manager", "Software Engineer", "Analyst")
- university: The university/school name (e.g., "UT Austin", "Stanford", "MIT")
- location: The city, state, or region (e.g., "Austin", "New York", "San Francisco")

RULES:
1. Extract filters from the user's message. If a filter was previously set and the user doesn't mention it, KEEP the previous value. This applies to ALL filters including location — e.g., "what about in Chicago?" with a previous location of "New York" should update location to "Chicago", not set it to null.
2. If the user says something like "try X instead" or "change to X", replace the relevant filter.
3. If the user says "remove the role filter" or "any role", set that filter to null.
4. If no company or companies is extracted and none was previously set, your message MUST ask the user to specify a company.
5. Be smart about interpreting queries: "PMs" = "Product Manager", "SWEs" = "Software Engineer", "bankers" = role in banking context.
6. "at [X]" almost always means company (e.g., "engineers at Meta" → company: "Meta"). "from [X]" almost always means university (e.g., "from Stanford" → university: "Stanford University").
7. For university abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
8. Your message should be a brief, friendly confirmation of what you're searching for, or a clarifying question.
9. Use "companies" (array) when the user mentions an industry or category like "consulting firms", "big tech", "investment banks", "FAANG", etc. ALSO use "companies" when the user names multiple specific companies (e.g., "at Google and Meta" → companies: ["Google", "Meta"]). Use "company" (single) ONLY when exactly one specific company is named. When "companies" is set, "company" should be null.
10. Max 5 companies in the array.
11. IMPORTANT: Always extract a company when one is clearly mentioned. "at Meta", "at Google", "at McKinsey" = company. Never drop a clearly stated company.
12. IMPORTANT: Your JSON filters must be consistent with your message. If your message mentions a location, the location filter must be set. If your message mentions a role, the role filter must be set. Never contradict your own message in the JSON output.

Respond with JSON: { "filters": { "company": string|null, "companies": string[]|null, "role": string|null, "university": string|null, "location": string|null }, "message": string }`;

interface Filters {
  company: string | null;
  companies: string[] | null;
  role: string | null;
  university: string | null;
  location: string | null;
}

interface LLMResponse {
  filters: Filters;
  message: string;
}

interface TestCase {
  query: string;
  conversationHistory?: string; // Simulated prior context
  currentFilters?: Partial<Filters>;
  expect: {
    companySet?: boolean;       // Should company be non-null?
    companiesSet?: boolean;     // Should companies be non-null array?
    roleSet?: boolean;
    universitySet?: boolean;
    locationSet?: boolean;
    shouldAskCompany?: boolean; // Should the assistant ask for a company?
    companyContains?: string;   // company should contain this substring (case-insensitive)
    roleContains?: string;
    universityContains?: string;
    locationContains?: string;
    companiesMinLength?: number;
  };
  description: string;
}

const TEST_CASES: TestCase[] = [
  // ── Basic single-company queries ──
  {
    query: 'Product managers at Google in Austin',
    expect: { companySet: true, roleSet: true, locationSet: true, companyContains: 'google', roleContains: 'product manager', locationContains: 'austin' },
    description: 'Standard query with company + role + location',
  },
  {
    query: 'Software engineers at Meta from Stanford',
    expect: { companySet: true, roleSet: true, universitySet: true, companyContains: 'meta', roleContains: 'software engineer', universityContains: 'stanford' },
    description: 'Company + role + university',
  },
  {
    query: 'Analysts at Goldman Sachs in New York',
    expect: { companySet: true, roleSet: true, locationSet: true, companyContains: 'goldman', roleContains: 'analyst', locationContains: 'new york' },
    description: 'Finance company + role + location',
  },
  {
    query: 'SWEs at Apple',
    expect: { companySet: true, roleSet: true, companyContains: 'apple', roleContains: 'software engineer' },
    description: 'Abbreviation "SWEs" should expand to Software Engineer',
  },
  {
    query: 'PMs at Stripe from MIT',
    expect: { companySet: true, roleSet: true, universitySet: true, companyContains: 'stripe', roleContains: 'product manager', universityContains: 'mit' },
    description: 'Abbreviation "PMs" + university abbreviation "MIT"',
  },

  // ── Multi-company / category queries ──
  {
    query: 'Consultants at top consulting firms from UT Austin',
    expect: { companiesSet: true, companiesMinLength: 3, roleSet: true, universitySet: true },
    description: 'Category query "top consulting firms" should return companies array',
  },
  {
    query: 'Engineers at FAANG companies',
    expect: { companiesSet: true, companiesMinLength: 4, roleSet: true },
    description: 'FAANG should expand to multiple companies',
  },
  {
    query: 'Bankers at top investment banks',
    expect: { companiesSet: true, companiesMinLength: 3 },
    description: 'Category "investment banks" should return companies array',
  },
  {
    query: 'Data scientists at big tech',
    expect: { companiesSet: true, companiesMinLength: 3, roleSet: true, roleContains: 'data scientist' },
    description: '"Big tech" category + role extraction',
  },

  // ── No company (should ask) ──
  {
    query: 'I want to find software engineers',
    expect: { shouldAskCompany: true, roleSet: true },
    description: 'No company mentioned — should ask user to specify one',
  },
  {
    query: 'People from UT Austin in San Francisco',
    expect: { shouldAskCompany: true, universitySet: true, locationSet: true },
    description: 'University + location but no company — should ask',
  },

  // ── Conversational follow-ups (with prior filters) ──
  {
    query: 'Actually try McKinsey instead',
    currentFilters: { company: 'BCG', role: 'Consultant' },
    conversationHistory: 'user: Consultants at BCG\nassistant: Searching for Consultants at BCG',
    expect: { companySet: true, roleSet: true, companyContains: 'mckinsey', roleContains: 'consultant' },
    description: 'Swap company while preserving role from prior context',
  },
  {
    query: 'Remove the role filter',
    currentFilters: { company: 'Google', role: 'Product Manager', location: 'Austin' },
    conversationHistory: 'user: PMs at Google in Austin\nassistant: Searching for Product Managers at Google in Austin',
    expect: { companySet: true, companyContains: 'google', locationSet: true, roleSet: false },
    description: 'Explicitly remove role filter, keep company + location',
  },
  {
    query: 'What about in Chicago?',
    currentFilters: { company: 'Deloitte', role: 'Analyst', location: 'New York' },
    conversationHistory: 'user: Analysts at Deloitte in New York\nassistant: Searching for Analysts at Deloitte in New York',
    expect: { companySet: true, roleSet: true, locationSet: true, companyContains: 'deloitte', locationContains: 'chicago' },
    description: 'Change location while preserving company + role',
  },

  // ── Edge cases ──
  {
    query: 'Anyone at JPMorgan',
    expect: { companySet: true, companyContains: 'jpmorgan', roleSet: false },
    description: 'No role specified — should not invent one',
  },
  {
    query: 'VPs at Amazon in Seattle',
    expect: { companySet: true, roleSet: true, locationSet: true, companyContains: 'amazon', locationContains: 'seattle' },
    description: '"VPs" should map to Vice President or similar',
  },
  {
    query: 'People at Tesla who went to UT',
    expect: { companySet: true, universitySet: true, companyContains: 'tesla', universityContains: 'ut austin' },
    description: '"UT" abbreviation should resolve to UT Austin',
  },
  {
    query: 'marketing people at Nike from UCLA in Portland',
    expect: { companySet: true, roleSet: true, universitySet: true, locationSet: true, companyContains: 'nike', universityContains: 'ucla', locationContains: 'portland' },
    description: 'All four filters in one query',
  },
  {
    query: 'Show me engineers at Google and Meta',
    expect: { companiesSet: true, companiesMinLength: 2, roleSet: true },
    description: 'Two explicit companies should use companies array',
  },
  {
    query: 'interns at spotify',
    expect: { companySet: true, roleSet: true, companyContains: 'spotify' },
    description: 'Lowercase input should still extract correctly',
  },
];

function buildUserPrompt(query: string, conversationHistory?: string, currentFilters?: Partial<Filters>): string {
  const parts: string[] = [];

  if (conversationHistory) {
    parts.push('Conversation history:');
    parts.push(conversationHistory);
    parts.push('');
  }

  if (currentFilters && Object.values(currentFilters).some(v => v)) {
    parts.push(`Current active filters: ${JSON.stringify(currentFilters)}`);
    parts.push('');
  }

  parts.push(`New user message: ${query}`);
  return parts.join('\n');
}

async function runTest(groq: Groq, tc: TestCase, index: number): Promise<{ passed: boolean; failures: string[] }> {
  const failures: string[] = [];

  const userPrompt = buildUserPrompt(tc.query, tc.conversationHistory, tc.currentFilters);

  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 512,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content || '{}';
  let response: LLMResponse;
  try {
    response = JSON.parse(content);
  } catch {
    failures.push(`Failed to parse JSON: ${content}`);
    return { passed: false, failures };
  }

  const f = response.filters;

  // Validate expectations
  if (tc.expect.companySet === true && !f.company) {
    failures.push(`Expected company to be set, got null`);
  }
  if (tc.expect.companySet === false && f.company) {
    failures.push(`Expected company to be null, got "${f.company}"`);
  }
  if (tc.expect.companiesSet === true && (!f.companies || f.companies.length === 0)) {
    failures.push(`Expected companies array to be set, got ${JSON.stringify(f.companies)}`);
  }
  if (tc.expect.companiesMinLength && (!f.companies || f.companies.length < tc.expect.companiesMinLength)) {
    failures.push(`Expected companies.length >= ${tc.expect.companiesMinLength}, got ${f.companies?.length ?? 0}`);
  }
  if (tc.expect.roleSet === true && !f.role) {
    failures.push(`Expected role to be set, got null`);
  }
  if (tc.expect.roleSet === false && f.role) {
    failures.push(`Expected role to be null, got "${f.role}"`);
  }
  if (tc.expect.universitySet === true && !f.university) {
    failures.push(`Expected university to be set, got null`);
  }
  if (tc.expect.universitySet === false && f.university) {
    failures.push(`Expected university to be null, got "${f.university}"`);
  }
  if (tc.expect.locationSet === true && !f.location) {
    failures.push(`Expected location to be set, got null`);
  }
  if (tc.expect.locationSet === false && f.location) {
    failures.push(`Expected location to be null, got "${f.location}"`);
  }
  if (tc.expect.companyContains && f.company && !f.company.toLowerCase().includes(tc.expect.companyContains)) {
    failures.push(`Expected company to contain "${tc.expect.companyContains}", got "${f.company}"`);
  }
  if (tc.expect.roleContains && f.role && !f.role.toLowerCase().includes(tc.expect.roleContains)) {
    failures.push(`Expected role to contain "${tc.expect.roleContains}", got "${f.role}"`);
  }
  if (tc.expect.universityContains && f.university && !f.university.toLowerCase().includes(tc.expect.universityContains)) {
    failures.push(`Expected university to contain "${tc.expect.universityContains}", got "${f.university}"`);
  }
  if (tc.expect.locationContains && f.location && !f.location.toLowerCase().includes(tc.expect.locationContains)) {
    failures.push(`Expected location to contain "${tc.expect.locationContains}", got "${f.location}"`);
  }
  if (tc.expect.shouldAskCompany === true) {
    const hasCompany = f.company || (f.companies && f.companies.length > 0);
    if (hasCompany) {
      failures.push(`Expected no company (should ask user), but got company="${f.company}" companies=${JSON.stringify(f.companies)}`);
    }
  }

  const status = failures.length === 0 ? 'PASS' : 'FAIL';
  const icon = status === 'PASS' ? '[PASS]' : '[FAIL]';

  console.log(`\n${icon} Test ${index + 1}: ${tc.description}`);
  console.log(`  Query: "${tc.query}"`);
  console.log(`  Extracted: company=${f.company || '(null)'}, companies=${f.companies ? JSON.stringify(f.companies) : '(null)'}, role=${f.role || '(null)'}, university=${f.university || '(null)'}, location=${f.location || '(null)'}`);
  console.log(`  Assistant: "${response.message}"`);
  if (failures.length > 0) {
    for (const fail of failures) {
      console.log(`  >> ${fail}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

async function main() {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  if (!process.env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY not set');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('AI FILTER EXTRACTION TEST — 20 queries');
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TEST_CASES.length; i++) {
    try {
      const result = await runTest(groq, TEST_CASES[i], i);
      if (result.passed) passed++;
      else failed++;
    } catch (error) {
      console.log(`\n[ERROR] Test ${i + 1}: ${TEST_CASES[i].description}`);
      console.log(`  ${error}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`RESULTS: ${passed}/${TEST_CASES.length} passed, ${failed} failed`);
  console.log('='.repeat(70));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
