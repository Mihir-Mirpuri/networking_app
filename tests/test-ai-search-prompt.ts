/**
 * Test the AI search filter extraction with the new prompt.
 * Tests various query types to verify the LLM returns correct status + selectables.
 *
 * Usage: npx tsx tests/test-ai-search-prompt.ts
 */

import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Import the system prompt by reading the file
const SYSTEM_PROMPT = `You are a search filter extraction assistant for a professional networking tool. Your job is to help users find people by extracting structured search filters from natural language.

A search requires exactly ONE company and ONE role. You also extract optional filters: university, location.

You must return JSON with this schema:
{
  "status": "ready" | "needs_selection" | "off_topic",
  "filters": { "company": string|null, "role": string|null, "university": string|null, "location": string|null },
  "selectables": [{ "label": string, "filter_key": "company"|"role", "filter_value": string }],
  "suggested_searches": [{ "label": string, "company": string, "role": string|null }],
  "message": string
}

STATUS RULES:
- "ready": Both company AND role are clearly specified. Trigger the search.
- "needs_selection": The user mentioned a category, industry, or ambiguous term that maps to multiple companies OR multiple roles. Return up to 5 selectables for the user to choose from.
- "off_topic": The message is unrelated to finding professional contacts.

FILTER RULES:
1. If a filter was previously set and the user doesn't mention it, KEEP the previous value.
2. "try X instead" or "change to X" → replace the relevant filter.
3. "remove the role filter" or "any role" → set that filter to null.
4. Be smart about abbreviations: "PMs" = "Product Manager", "SWEs" = "Software Engineer", "bankers" could mean role in banking.
5. "at [X]" = company. "from [X]" = university. University abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
6. When the user says "No", "Nah", "that's it" in response to a question, KEEP all previous filters unchanged.
7. Always extract a company when one is clearly stated. "at Meta" = company: "Meta". Never drop it.

SELECTABLE RULES:
- When the user says a category like "top consulting firms", "big tech", "investment banks", "FAANG", return status "needs_selection" with up to 5 company selectables.
- When the user names multiple companies ("at Google and Meta"), return status "needs_selection" with each as a selectable.
- When a role is ambiguous for a given company (e.g., "people at McKinsey" — could be Consultant, Analyst, Partner), return "needs_selection" with role selectables.
- IMPORTANT: If the user explicitly names a role (even a broad one like "analyst", "engineer", "consultant", "associate"), treat it as specified and return "ready". Only return role selectables when NO role is mentioned at all (e.g., "people at Google", "someone at McKinsey").
- Each selectable has: label (display text), filter_key ("company" or "role"), filter_value (the exact value to use as the filter).

SUGGESTED SEARCH RULES:
- Only include when status is "ready".
- Suggest up to 4 alternative searches based on the user's original intent.
- If the user picked one company from a category, suggest the other companies with the same role.
- If appropriate, suggest a different role at the same company.

MESSAGE RULES:
- For "ready": brief confirmation of what you're searching. Don't ask follow-up questions.
- For "needs_selection": ask the user to pick one. Be brief.
- For "off_topic": friendly redirect suggesting they search for people.

EXAMPLES:

User: "PMs at Google in Austin"
→ {"status":"ready","filters":{"company":"Google","role":"Product Manager","university":null,"location":"Austin"},"selectables":[],"suggested_searches":[{"label":"PMs at Meta","company":"Meta","role":"Product Manager"},{"label":"PMs at Apple","company":"Apple","role":"Product Manager"},{"label":"Software Engineers at Google","company":"Google","role":"Software Engineer"}],"message":"Searching for Product Managers at Google in Austin!"}

User: "consultants at top consulting firms from UT Austin"
→ {"status":"needs_selection","filters":{"company":null,"role":"Consultant","university":"UT Austin","location":null},"selectables":[{"label":"McKinsey","filter_key":"company","filter_value":"McKinsey"},{"label":"BCG","filter_key":"company","filter_value":"BCG"},{"label":"Bain","filter_key":"company","filter_value":"Bain"},{"label":"Deloitte","filter_key":"company","filter_value":"Deloitte"},{"label":"Accenture","filter_key":"company","filter_value":"Accenture"}],"suggested_searches":[],"message":"Which consulting firm are you interested in?"}

User: "people at McKinsey"
→ {"status":"needs_selection","filters":{"company":"McKinsey","role":null,"university":null,"location":null},"selectables":[{"label":"Consultant","filter_key":"role","filter_value":"Consultant"},{"label":"Business Analyst","filter_key":"role","filter_value":"Business Analyst"},{"label":"Associate","filter_key":"role","filter_value":"Associate"},{"label":"Partner","filter_key":"role","filter_value":"Partner"},{"label":"Engagement Manager","filter_key":"role","filter_value":"Engagement Manager"}],"suggested_searches":[],"message":"What role at McKinsey are you looking for?"}

User: "engineers at Google and Meta"
→ {"status":"needs_selection","filters":{"company":null,"role":"Software Engineer","university":null,"location":null},"selectables":[{"label":"Google","filter_key":"company","filter_value":"Google"},{"label":"Meta","filter_key":"company","filter_value":"Meta"}],"suggested_searches":[],"message":"Which company would you like to search first?"}

User: "how is the weather?"
→ {"status":"off_topic","filters":{"company":null,"role":null,"university":null,"location":null},"selectables":[],"suggested_searches":[],"message":"I'm designed to help you find and reach out to professional contacts! Try something like 'Find software engineers at Google' or 'PMs at McKinsey'."}`;

interface TestCase {
  name: string;
  message: string;
  currentFilters?: Record<string, string>;
  conversationHistory?: Array<{ role: string; content: string }>;
  expect: {
    status: 'ready' | 'needs_selection' | 'off_topic';
    hasCompany?: boolean;
    hasRole?: boolean;
    selectableKey?: 'company' | 'role';
    hasSuggestions?: boolean;
  };
}

const TEST_CASES: TestCase[] = [
  // === READY cases (both company + role clear) ===
  {
    name: 'Clear company + role',
    message: 'PMs at Google',
    expect: { status: 'ready', hasCompany: true, hasRole: true, hasSuggestions: true },
  },
  {
    name: 'SWEs at Meta from Stanford in NYC',
    message: 'SWEs at Meta from Stanford in NYC',
    expect: { status: 'ready', hasCompany: true, hasRole: true },
  },
  {
    name: 'Analysts at Goldman Sachs',
    message: 'analysts at Goldman Sachs',
    expect: { status: 'ready', hasCompany: true, hasRole: true },
  },

  // === NEEDS_SELECTION: company ambiguous ===
  {
    name: 'Category: top consulting firms',
    message: 'consultants at top consulting firms',
    expect: { status: 'needs_selection', selectableKey: 'company' },
  },
  {
    name: 'Category: big tech',
    message: 'engineers at big tech companies',
    expect: { status: 'needs_selection', selectableKey: 'company' },
  },
  {
    name: 'Category: FAANG',
    message: 'PMs at FAANG',
    expect: { status: 'needs_selection', selectableKey: 'company' },
  },
  {
    name: 'Multiple companies named',
    message: 'engineers at Google and Meta',
    expect: { status: 'needs_selection', selectableKey: 'company' },
  },
  {
    name: 'Category: investment banks',
    message: 'analysts at top investment banks',
    expect: { status: 'needs_selection', selectableKey: 'company' },
  },

  // === NEEDS_SELECTION: role ambiguous ===
  {
    name: 'Company clear, no role',
    message: 'people at McKinsey',
    expect: { status: 'needs_selection', selectableKey: 'role' },
  },
  {
    name: 'Company clear, vague role',
    message: 'someone at Google',
    expect: { status: 'needs_selection', selectableKey: 'role' },
  },

  // === OFF_TOPIC ===
  {
    name: 'Weather question',
    message: 'how is the weather?',
    expect: { status: 'off_topic' },
  },
  {
    name: 'Math question',
    message: 'what is 2+2?',
    expect: { status: 'off_topic' },
  },

  // === CONTEXT CARRY-FORWARD ===
  {
    name: 'Change location with existing filters',
    message: 'what about in Chicago?',
    currentFilters: { company: 'Google', role: 'Product Manager', location: 'Austin' },
    expect: { status: 'ready', hasCompany: true, hasRole: true },
  },
  {
    name: 'Short confirmation keeps filters',
    message: 'Nah, that\'s it',
    currentFilters: { company: 'Google', role: 'Software Engineer' },
    conversationHistory: [
      { role: 'user', content: 'SWEs at Google' },
      { role: 'assistant', content: 'Searching for Software Engineers at Google! Would you like to add a location?' },
    ],
    expect: { status: 'ready', hasCompany: true, hasRole: true },
  },
];

async function runTest(tc: TestCase): Promise<{ pass: boolean; detail: string }> {
  const userPrompt = buildUserPrompt(tc);

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const result = JSON.parse(raw);

    const checks: string[] = [];
    let pass = true;

    // Check status
    if (result.status !== tc.expect.status) {
      checks.push(`status: expected "${tc.expect.status}", got "${result.status}"`);
      pass = false;
    } else {
      checks.push(`status: ✓ ${result.status}`);
    }

    // Check company
    if (tc.expect.hasCompany !== undefined) {
      const hasCompany = !!result.filters?.company;
      if (hasCompany !== tc.expect.hasCompany) {
        checks.push(`company: expected ${tc.expect.hasCompany ? 'present' : 'absent'}, got "${result.filters?.company}"`);
        pass = false;
      } else {
        checks.push(`company: ✓ ${result.filters?.company || '(none)'}`);
      }
    }

    // Check role
    if (tc.expect.hasRole !== undefined) {
      const hasRole = !!result.filters?.role;
      if (hasRole !== tc.expect.hasRole) {
        checks.push(`role: expected ${tc.expect.hasRole ? 'present' : 'absent'}, got "${result.filters?.role}"`);
        pass = false;
      } else {
        checks.push(`role: ✓ ${result.filters?.role || '(none)'}`);
      }
    }

    // Check selectable key
    if (tc.expect.selectableKey) {
      const selectables = result.selectables || [];
      if (selectables.length === 0) {
        checks.push(`selectables: expected ${tc.expect.selectableKey} options, got none`);
        pass = false;
      } else {
        const key = selectables[0]?.filter_key;
        if (key !== tc.expect.selectableKey) {
          checks.push(`selectables: expected key "${tc.expect.selectableKey}", got "${key}"`);
          pass = false;
        } else {
          checks.push(`selectables: ✓ ${selectables.length} ${key} options [${selectables.map((s: any) => s.label).join(', ')}]`);
        }
      }
    }

    // Check suggestions
    if (tc.expect.hasSuggestions) {
      const suggestions = result.suggested_searches || [];
      if (suggestions.length === 0) {
        checks.push(`suggestions: expected some, got none`);
        // Don't fail on this — it's nice to have
      } else {
        checks.push(`suggestions: ✓ ${suggestions.length} [${suggestions.map((s: any) => s.label).join(', ')}]`);
      }
    }

    // Show message
    checks.push(`message: "${result.message}"`);

    return { pass, detail: checks.join('\n    ') };
  } catch (error: any) {
    return { pass: false, detail: `ERROR: ${error.message}` };
  }
}

function buildUserPrompt(tc: TestCase): string {
  const parts: string[] = [];

  if (tc.conversationHistory && tc.conversationHistory.length > 0) {
    parts.push('Conversation history:');
    for (const msg of tc.conversationHistory) {
      parts.push(`${msg.role}: ${msg.content}`);
    }
    parts.push('');
  }

  if (tc.currentFilters && Object.keys(tc.currentFilters).length > 0) {
    parts.push(`Current active filters: ${JSON.stringify(tc.currentFilters)}`);
    parts.push('');
  }

  parts.push(`New user message: ${tc.message}`);
  return parts.join('\n');
}

async function main() {
  console.log('=== AI Search Prompt Test Suite ===\n');
  console.log(`Running ${TEST_CASES.length} test cases...\n`);

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    const { pass, detail } = await runTest(tc);
    const icon = pass ? '✅' : '❌';
    console.log(`${icon} ${tc.name}`);
    console.log(`    ${detail}`);
    console.log('');

    if (pass) passed++;
    else failed++;

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== Results: ${passed}/${TEST_CASES.length} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
