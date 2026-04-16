/**
 * Prompt regression QA.
 *
 * Step A (initial run, before prompt changes): snapshot current output to
 * tests/prompt-regression-baseline.json.
 * Step B (after prompt changes): compare against the baseline; any diff fails.
 *
 * Usage:
 *   npx tsx tests/prompt-regression-qa.ts --snapshot   # create baseline
 *   npx tsx tests/prompt-regression-qa.ts              # compare
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';

const QUERIES: string[] = [
  'software engineers at Google',
  'PMs at Stripe',
  'senior engineers at Uber',
  'staff engineers at Stripe',
  'directors at Google',
  'designers at Figma',
  'lawyers at Cravath',
  'analysts at the FBI',
  'people at McKinsey',
  'MIT grads at Stripe',
  'Brandon Rudy, director of broadcasting at Texas A&M',
  'consultants at MBB',
  'PhD data scientists at Google',
  'remote engineers at Stripe',
  'ML engineers making $200k+ in San Francisco',
  'CFA holders at Goldman Sachs',
  'CPA accountants at Deloitte',
  'engineers at Series B startups in Austin',
  'people who know Python at Stripe',
  'I am looking for internships as a finance analyst in chicago',
  'trying to break into product management at Stripe',
  'how is the weather?',
  'John',
  'growth PMs at Airbnb',
  'quants at Jane Street',
  'TPMs at Meta',
  'ex-Google engineers at Anthropic',
  'recently joined PMs at OpenAI',
  'founders of AI startups',
  'CXOs at Salesforce',
];

const BASELINE_PATH = path.join(__dirname, 'prompt-regression-baseline.json');

type Snapshot = {
  query: string;
  status: string;
  linkedin_filters: Record<string, unknown>;
  filters: Record<string, unknown>;
};

async function runOne(client: Anthropic, query: string): Promise<Snapshot | { query: string; error: string }> {
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0, // deterministic: critical for diff stability
      system: SEARCH_EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `New user message: ${query}` }],
    });
    const rawText = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    // Strip markdown fences if the model wraps output in ```json ... ```
    const text = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      query,
      status: String(parsed.status ?? ''),
      linkedin_filters: (parsed.linkedin_filters ?? {}) as Record<string, unknown>,
      filters: (parsed.filters ?? {}) as Record<string, unknown>,
    };
  } catch (err) {
    return { query, error: err instanceof Error ? err.message : String(err) };
  }
}

const RATE_LIMIT_DELAY_MS = 5000; // 5s between calls to stay under 50k tokens/min

async function snapshot(client: Anthropic) {
  console.log(`Snapshotting ${QUERIES.length} queries…`);
  const results: Snapshot[] = [];
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    if (i > 0) await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    const r = await runOne(client, q);
    if ('error' in r) throw new Error(`Snapshot failed on "${q}": ${r.error}`);
    results.push(r);
    console.log(`  [${r.status.padEnd(16)}] ${q}`);
  }
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2));
  console.log(`\nBaseline written to ${BASELINE_PATH}`);
}

function canonicalize(obj: unknown): string {
  // Deterministic JSON: sort keys, drop null/undefined/empty-array values
  if (obj === null || obj === undefined) return 'null';
  if (Array.isArray(obj)) {
    if (obj.length === 0) return 'null';
    return `[${obj.map(canonicalize).join(',')}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as object)
      .filter(k => {
        const v = (obj as Record<string, unknown>)[k];
        return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
      })
      .sort();
    return `{${keys.map(k => JSON.stringify(k) + ':' + canonicalize((obj as Record<string, unknown>)[k])).join(',')}}`;
  }
  return JSON.stringify(obj);
}

async function compare(client: Anthropic) {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`No baseline at ${BASELINE_PATH}. Run with --snapshot first.`);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as Snapshot[];
  const baselineByQuery = new Map(baseline.map(b => [b.query, b]));

  let failures = 0;
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    if (i > 0) await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    const expected = baselineByQuery.get(q);
    if (!expected) {
      console.log(`[SKIP ] (not in baseline) ${q}`);
      continue;
    }
    const actual = await runOne(client, q);

    if ('error' in actual) {
      failures++;
      console.log(`[FAIL ] ${q} — threw ${actual.error}`);
      continue;
    }
    const expStatus = expected.status;
    const actStatus = actual.status;
    const expFilt = canonicalize(expected.linkedin_filters);
    const actFilt = canonicalize(actual.linkedin_filters);
    const expTop  = canonicalize(expected.filters);
    const actTop  = canonicalize(actual.filters);
    const ok = expStatus === actStatus && expFilt === actFilt && expTop === actTop;
    if (ok) {
      console.log(`[PASS ] ${q}`);
    } else {
      failures++;
      console.log(`[FAIL ] ${q}`);
      if (expStatus !== actStatus) console.log(`        status: ${expStatus} -> ${actStatus}`);
      if (expFilt !== actFilt)     console.log(`        linkedin_filters: ${expFilt}\n                    -> ${actFilt}`);
      if (expTop !== actTop)       console.log(`        filters: ${expTop}\n              -> ${actTop}`);
    }
  }
  console.log(`\n${QUERIES.length - failures}/${QUERIES.length} passed`);
  if (failures > 0) process.exit(1);
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  if (process.argv.includes('--snapshot')) {
    await snapshot(client);
  } else {
    await compare(client);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
