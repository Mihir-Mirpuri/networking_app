/**
 * Test: Perplexity escalation for AI search selectables
 *
 * Tests the interaction between Groq (filter extraction + confidence) and
 * Perplexity Sonar (internet-powered company lookup) for niche categories.
 *
 * Run: npx tsx tests/test-perplexity-escalation.ts
 */

import { fetchCompaniesForCategory } from '../src/lib/services/perplexity';

// Load env
import * as dotenv from 'dotenv';
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// Minimal Groq call to simulate what ai-search.ts does
async function callGroqForFilters(message: string) {
  const systemPrompt = `You are a search filter extraction assistant. Extract structured search filters from the user's message.

Return JSON with this schema:
{
  "status": "ready" | "needs_selection" | "off_topic",
  "confidence": "high" | "low",
  "filters": { "company": string|null, "role": string|null, "university": string|null, "location": string|null },
  "selectables": [{ "label": string, "filter_key": "company"|"role", "filter_value": string }],
  "message": string
}

When returning company selectables, return "confidence": "low" when the category involves startups, accelerator/YC companies, niche or emerging industries, or companies you're unsure are current/complete. Return "confidence": "high" for well-known stable categories (FAANG, MBB consulting, bulge bracket banks, Big 4 accounting).`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

// Escalation keywords (same as in ai-search.ts)
const ESCALATION_KEYWORDS = [
  'startup', 'startups', 'yc', 'y combinator', 'accelerator',
  'seed', 'series a', 'series b', 'emerging', 'niche', 'new companies',
  'recently founded', 'unicorn', 'unicorns',
];

function shouldEscalate(message: string, confidence: string | undefined, selectables: Array<{ filter_key: string }>) {
  if (selectables.length > 0 && !selectables.some(s => s.filter_key === 'company')) return false;
  if (confidence === 'low') return true;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isCompanyNameACategory(companyName: string | undefined): boolean {
  if (!companyName) return false;
  const lower = companyName.toLowerCase();
  const categoryWords = ['companies', 'startups', 'firms', 'banks', 'agencies', 'studios', 'labs', 'top ', 'big ', 'best '];
  return categoryWords.some(w => lower.includes(w));
}

// ─── Test Cases ───────────────────────────────────────────────────────────────

async function testCase(
  name: string,
  message: string,
  expectEscalation: boolean
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log(`Query: "${message}"`);
  console.log(`Expect escalation: ${expectEscalation}`);
  console.log('='.repeat(60));

  // Step 1: Groq extracts filters
  console.log('\n[1] Calling Groq...');
  const groqStart = Date.now();
  const groqResult = await callGroqForFilters(message);
  const groqMs = Date.now() - groqStart;

  console.log(`    Status: ${groqResult.status}`);
  console.log(`    Confidence: ${groqResult.confidence || 'not set'}`);
  console.log(`    Filters: ${JSON.stringify(groqResult.filters)}`);
  console.log(`    Selectables: ${(groqResult.selectables || []).map((s: { label: string }) => s.label).join(', ') || '(none)'}`);
  console.log(`    Message: "${groqResult.message}"`);
  console.log(`    Time: ${groqMs}ms`);

  // Step 2: Check if escalation is triggered
  const selectables = groqResult.selectables || [];
  let escalate = shouldEscalate(message, groqResult.confidence, selectables);

  // Also check: Groq returned "ready" but company is actually a category
  if (!escalate && groqResult.status === 'ready' && isCompanyNameACategory(groqResult.filters?.company)) {
    const keywordMatch = ESCALATION_KEYWORDS.some(kw => message.toLowerCase().includes(kw));
    if (keywordMatch || groqResult.confidence === 'low') {
      escalate = true;
      console.log(`\n[2] Groq said "ready" but company "${groqResult.filters.company}" is a category — overriding to escalate`);
    }
  }
  console.log(`[2] Escalation decision: ${escalate ? 'YES' : 'NO'}`);

  if (escalate !== expectEscalation) {
    console.log(`    ⚠️  UNEXPECTED: Expected ${expectEscalation ? 'escalation' : 'no escalation'} but got ${escalate ? 'escalation' : 'no escalation'}`);
  } else {
    console.log(`    ✓ Correct`);
  }

  // Step 3: If escalating, call Perplexity
  if (escalate) {
    console.log('\n[3] Calling Perplexity Sonar...');
    const pplxStart = Date.now();
    try {
      const companies = await fetchCompaniesForCategory(message, groqResult.filters?.role, 12);
      const pplxMs = Date.now() - pplxStart;

      console.log(`    Returned ${companies.length} companies (${pplxMs}ms):`);
      companies.forEach((c, i) => {
        console.log(`    ${i + 1}. ${c.name} — ${c.description}`);
      });

      // Pagination simulation
      const page1 = companies.slice(0, 5);
      const page2 = companies.slice(5, 10);
      const page3 = companies.slice(10);
      console.log(`\n[4] Pagination:`);
      console.log(`    Page 1 (shown first): ${page1.map(c => c.name).join(', ')}`);
      if (page2.length > 0) console.log(`    Page 2 ("Show more"): ${page2.map(c => c.name).join(', ')}`);
      if (page3.length > 0) console.log(`    Page 3 ("Show more"): ${page3.map(c => c.name).join(', ')}`);

      if (companies.length === 0) {
        console.log('    ⚠️  Perplexity returned 0 companies — would fall back to Groq suggestions');
      } else {
        console.log(`    ✓ Total: ${companies.length} companies across ${Math.ceil(companies.length / 5)} pages`);
      }
    } catch (err) {
      const pplxMs = Date.now() - pplxStart;
      console.log(`    ✗ Perplexity failed (${pplxMs}ms): ${err}`);
      console.log(`    Would fall back to Groq suggestions: ${selectables.map((s: { label: string }) => s.label).join(', ')}`);
    }
  } else {
    console.log(`\n[3] Using Groq suggestions directly: ${selectables.map((s: { label: string }) => s.label).join(', ')}`);
  }

  return { groqMs, escalate };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Perplexity Escalation Test');
  console.log('='.repeat(60));
  console.log(`GROQ_API_KEY: ${GROQ_API_KEY ? '✓ set' : '✗ missing'}`);
  console.log(`PERPLEXITY_API_KEY: ${PERPLEXITY_API_KEY ? '✓ set' : '✗ missing'}`);

  if (!GROQ_API_KEY || !PERPLEXITY_API_KEY) {
    console.error('\nBoth GROQ_API_KEY and PERPLEXITY_API_KEY must be set in .env');
    process.exit(1);
  }

  const results: Array<{ name: string; groqMs: number; escalate: boolean }> = [];

  // Test 1: Well-known category — should NOT escalate
  const t1 = await testCase(
    'Well-known: Top consulting firms',
    'consultants at top consulting firms',
    false
  );
  results.push({ name: 'Top consulting firms', ...t1 });

  // Test 2: Startup category — SHOULD escalate
  const t2 = await testCase(
    'Startups: AI startups',
    'engineers at top AI startups',
    true
  );
  results.push({ name: 'AI startups', ...t2 });

  // Test 3: YC companies — SHOULD escalate (keyword match)
  const t3 = await testCase(
    'YC: Y Combinator companies',
    'product managers at YC companies',
    true
  );
  results.push({ name: 'YC companies', ...t3 });

  // Test 4: Big tech — should NOT escalate
  const t4 = await testCase(
    'Well-known: Big tech / FAANG',
    'software engineers at big tech companies',
    false
  );
  results.push({ name: 'Big tech / FAANG', ...t4 });

  // Test 5: Niche industry — SHOULD escalate
  const t5 = await testCase(
    'Niche: Climate tech startups',
    'engineers at climate tech startups',
    true
  );
  results.push({ name: 'Climate tech startups', ...t5 });

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  results.forEach(r => {
    console.log(`  ${r.escalate ? '🌐 Perplexity' : '⚡ Groq only'} | ${r.groqMs}ms | ${r.name}`);
  });
}

main().catch(console.error);
