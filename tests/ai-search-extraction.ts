/**
 * Test script for AI Search filter extraction via Groq.
 * Sends various natural language queries through the LLM and validates
 * that filters are correctly extracted.
 *
 * Usage: npx tsx tests/ai-search-extraction.ts
 */

import 'dotenv/config';
import { completeJson, GroqJsonParseError } from '../src/lib/services/groq';

// ── Types (mirrored from ai-search.ts) ──────────────────────────────────────

interface ParsedFilters {
  company?: string;
  role?: string;
  university?: string;
  location?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ExtractFiltersInput {
  message: string;
  conversationHistory: ChatMessage[];
  currentFilters: ParsedFilters;
}

interface LLMResponse {
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  message: string;
}

// ── System prompt (same as ai-search.ts) ────────────────────────────────────

const SYSTEM_PROMPT = `You are a search filter extraction assistant. Your job is to extract structured search filters from natural language queries about finding professional contacts.

You must extract up to 4 filters:
- company: The company/organization name (e.g., "Google", "McKinsey", "Goldman Sachs")
- role: The job role/title (e.g., "Product Manager", "Software Engineer", "Analyst")
- university: The university/school name (e.g., "UT Austin", "Stanford", "MIT")
- location: The city, state, or region (e.g., "Austin", "New York", "San Francisco")

RULES:
1. Extract filters from the user's message. If a filter was previously set and the user doesn't mention it, KEEP the previous value.
2. If the user says something like "try X instead" or "change to X", replace the relevant filter.
3. If the user says "remove the role filter" or "any role", set that filter to null.
4. If no company is extracted and none was previously set, your message MUST ask the user to specify a company.
5. Be smart about interpreting queries: "PMs" = "Product Manager", "SWEs" = "Software Engineer", "bankers" = role in banking context.
6. For university abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
7. Your message should be a brief, friendly confirmation of what you're searching for, or a clarifying question.

Respond with JSON: { "filters": { "company": string|null, "role": string|null, "university": string|null, "location": string|null }, "message": string }`;

function buildUserPrompt(input: ExtractFiltersInput): string {
  const parts: string[] = [];
  const recentHistory = input.conversationHistory.slice(-10);
  if (recentHistory.length > 0) {
    parts.push('Conversation history:');
    for (const msg of recentHistory) {
      parts.push(`${msg.role}: ${msg.content}`);
    }
    parts.push('');
  }
  const activeFilters = Object.entries(input.currentFilters).filter(([, v]) => v);
  if (activeFilters.length > 0) {
    parts.push(`Current active filters: ${JSON.stringify(input.currentFilters)}`);
    parts.push('');
  }
  parts.push(`New user message: ${input.message}`);
  return parts.join('\n');
}

// ── Test helpers ─────────────────────────────────────────────────────────────

async function extractFilters(input: ExtractFiltersInput): Promise<{
  filters: ParsedFilters;
  message: string;
}> {
  const response = await completeJson<LLMResponse>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(input),
    options: {
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      maxTokens: 256,
    },
  });

  const { filters, message } = response.content;
  const parsed: ParsedFilters = {};
  if (filters.company) parsed.company = filters.company;
  if (filters.role) parsed.role = filters.role;
  if (filters.university) parsed.university = filters.university;
  if (filters.location) parsed.location = filters.location;

  return { filters: parsed, message };
}

/** Case-insensitive substring check for filter values */
function filterMatches(actual: string | undefined, expected: string | undefined): boolean {
  if (!expected && !actual) return true;
  if (!expected) return true; // We don't care about this filter
  if (!actual) return false;
  return actual.toLowerCase().includes(expected.toLowerCase());
}

interface TestCase {
  name: string;
  input: ExtractFiltersInput;
  expect: {
    company?: string;   // substring match (case-insensitive)
    role?: string;
    university?: string;
    location?: string;
    companyRequired?: boolean;  // true = company must be present
    companyAbsent?: boolean;    // true = company must NOT be present
    askForCompany?: boolean;    // true = assistant message should ask for company
  };
}

// ── Test cases ───────────────────────────────────────────────────────────────

const testCases: TestCase[] = [
  // ===== BASIC EXTRACTION =====
  {
    name: 'Simple: all 4 filters',
    input: {
      message: 'Product managers at Google in Austin',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'Google',
      role: 'Product Manager',
      location: 'Austin',
      companyRequired: true,
    },
  },
  {
    name: 'Simple: company + role only',
    input: {
      message: 'Software engineers at Meta',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'Meta',
      role: 'Software Engineer',
      companyRequired: true,
    },
  },
  {
    name: 'Simple: company + university',
    input: {
      message: 'People at McKinsey from Stanford',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'McKinsey',
      university: 'Stanford',
      companyRequired: true,
    },
  },
  {
    name: 'Simple: company only',
    input: {
      message: 'Goldman Sachs',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'Goldman',
      companyRequired: true,
    },
  },

  // ===== ABBREVIATIONS & SLANG =====
  {
    name: 'Abbreviation: PMs → Product Manager',
    input: {
      message: 'PMs at Google',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'Google',
      role: 'Product Manager',
    },
  },
  {
    name: 'Abbreviation: SWEs → Software Engineer',
    input: {
      message: 'SWEs at Apple in San Francisco',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'Apple',
      role: 'Software Engineer',
      location: 'San Francisco',
    },
  },
  {
    name: 'Abbreviation: UT → UT Austin',
    input: {
      message: 'Analysts at JPMorgan from UT',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'JPMorgan',
      role: 'Analyst',
      university: 'UT',
    },
  },

  // ===== MISSING COMPANY =====
  {
    name: 'Missing company: should ask for it',
    input: {
      message: 'Software engineers in Austin',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      role: 'Software Engineer',
      location: 'Austin',
      companyAbsent: true,
      askForCompany: true,
    },
  },
  {
    name: 'Missing company: role + university only',
    input: {
      message: 'PMs from Stanford',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      role: 'Product Manager',
      university: 'Stanford',
      companyAbsent: true,
      askForCompany: true,
    },
  },

  // ===== FOLLOW-UP: MODIFY FILTERS =====
  {
    name: 'Follow-up: change company',
    input: {
      message: 'Try McKinsey instead',
      conversationHistory: [
        { role: 'user', content: 'Product managers at Google in Austin' },
        { role: 'assistant', content: 'Searching for Product Managers at Google in Austin.' },
      ],
      currentFilters: { company: 'Google', role: 'Product Manager', location: 'Austin' },
    },
    expect: {
      company: 'McKinsey',
      role: 'Product Manager',
      location: 'Austin',
    },
  },
  {
    name: 'Follow-up: make it more senior',
    input: {
      message: 'Make it more senior',
      conversationHistory: [
        { role: 'user', content: 'Product managers at Google' },
        { role: 'assistant', content: 'Searching for Product Managers at Google.' },
      ],
      currentFilters: { company: 'Google', role: 'Product Manager' },
    },
    expect: {
      company: 'Google',
      role: 'Senior',  // Should contain "Senior" somewhere
    },
  },
  {
    name: 'Follow-up: add location filter',
    input: {
      message: 'In New York',
      conversationHistory: [
        { role: 'user', content: 'Software engineers at Meta' },
        { role: 'assistant', content: 'Searching for Software Engineers at Meta.' },
      ],
      currentFilters: { company: 'Meta', role: 'Software Engineer' },
    },
    expect: {
      company: 'Meta',
      role: 'Software Engineer',
      location: 'New York',
    },
  },
  {
    name: 'Follow-up: remove role filter',
    input: {
      message: 'Any role is fine',
      conversationHistory: [
        { role: 'user', content: 'Analysts at Goldman Sachs' },
        { role: 'assistant', content: 'Searching for Analysts at Goldman Sachs.' },
      ],
      currentFilters: { company: 'Goldman Sachs', role: 'Analyst' },
    },
    expect: {
      company: 'Goldman',
      companyRequired: true,
      // role should be absent/null after "any role"
    },
  },
  {
    name: 'Follow-up: add university to existing search',
    input: {
      message: 'From MIT',
      conversationHistory: [
        { role: 'user', content: 'Engineers at Google' },
        { role: 'assistant', content: 'Searching for Engineers at Google.' },
      ],
      currentFilters: { company: 'Google', role: 'Engineer' },
    },
    expect: {
      company: 'Google',
      university: 'MIT',
    },
  },

  // ===== COMPLEX / EDGE CASES =====
  {
    name: 'Complex: multi-word company name',
    input: {
      message: 'Consultants at Boston Consulting Group',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'Boston Consulting',
      role: 'Consultant',
      companyRequired: true,
    },
  },
  {
    name: 'Complex: informal phrasing',
    input: {
      message: 'I want to find people who work at Stripe as designers in LA',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'Stripe',
      role: 'Designer',
      location: 'LA',
      companyRequired: true,
    },
  },
  {
    name: 'Complex: company with & character',
    input: {
      message: 'Analysts at Bain & Company',
      conversationHistory: [],
      currentFilters: {},
    },
    expect: {
      company: 'Bain',
      role: 'Analyst',
      companyRequired: true,
    },
  },
  {
    name: 'Complete new search replacing all filters',
    input: {
      message: 'Actually, find me data scientists at Netflix in Seattle from Carnegie Mellon',
      conversationHistory: [
        { role: 'user', content: 'PMs at Google in Austin' },
        { role: 'assistant', content: 'Searching for Product Managers at Google in Austin.' },
      ],
      currentFilters: { company: 'Google', role: 'Product Manager', location: 'Austin' },
    },
    expect: {
      company: 'Netflix',
      role: 'Data Scientist',
      location: 'Seattle',
      university: 'Carnegie Mellon',
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== AI Search Filter Extraction Tests ===\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of testCases) {
    process.stdout.write(`  ${tc.name} ... `);

    try {
      const { filters, message } = await extractFilters(tc.input);
      const errors: string[] = [];

      // Check expected filter values (substring match)
      for (const key of ['company', 'role', 'university', 'location'] as const) {
        if (tc.expect[key] && !filterMatches(filters[key], tc.expect[key])) {
          errors.push(`${key}: expected "${tc.expect[key]}", got "${filters[key] || '(empty)'}"`);
        }
      }

      // Check company required
      if (tc.expect.companyRequired && !filters.company) {
        errors.push('company was required but not extracted');
      }

      // Check company absent
      if (tc.expect.companyAbsent && filters.company) {
        errors.push(`company should be absent, got "${filters.company}"`);
      }

      // Check ask for company
      if (tc.expect.askForCompany) {
        const msgLower = message.toLowerCase();
        const asksForCompany = msgLower.includes('company') || msgLower.includes('which') || msgLower.includes('where') || msgLower.includes('specify') || msgLower.includes('organization');
        if (!asksForCompany) {
          errors.push(`expected assistant to ask for company, got: "${message}"`);
        }
      }

      if (errors.length > 0) {
        console.log(`FAIL`);
        const detail = `  ${tc.name}:\n    Filters: ${JSON.stringify(filters)}\n    Message: "${message}"\n    Errors:\n${errors.map(e => `      - ${e}`).join('\n')}`;
        failures.push(detail);
        console.log(`    Filters: ${JSON.stringify(filters)}`);
        console.log(`    Message: "${message}"`);
        errors.forEach(e => console.log(`    ✗ ${e}`));
        failed++;
      } else {
        console.log(`PASS`);
        console.log(`    Filters: ${JSON.stringify(filters)}`);
        passed++;
      }
    } catch (error) {
      console.log(`ERROR`);
      const errorMsg = error instanceof GroqJsonParseError
        ? `JSON parse error: ${error.rawContent}`
        : `${error}`;
      console.log(`    ${errorMsg}`);
      failures.push(`  ${tc.name}: ${errorMsg}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${testCases.length} ===`);

  if (failures.length > 0) {
    console.log('\n--- Failures ---');
    failures.forEach(f => console.log(f));
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
