/**
 * Verifies that hard-unsupported criteria (remote, PhD, salary, CFA, etc.)
 * still take precedence — even when a function/industry word is present.
 *
 * Usage: npx tsx tests/company-less-unsupported-qa.ts
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';

type Case = {
  query: string;
  mustHaveUnsupported: RegExp;
};

const CASES: Case[] = [
  { query: 'remote healthcare workers', mustHaveUnsupported: /remote/i },
  { query: 'healthcare workers with PhD', mustHaveUnsupported: /phd/i },
  { query: '$200k healthcare PMs', mustHaveUnsupported: /salary|\$/i },
  { query: 'CFA holders in finance', mustHaveUnsupported: /cfa/i },
];

async function runOne(client: Anthropic, query: string) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    temperature: 0,
    system: SEARCH_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `New user message: ${query}` }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  let failures = 0;
  console.log(`Unsupported precedence QA — ${CASES.length} queries\n`);
  for (const c of CASES) {
    try {
      await new Promise(r => setTimeout(r, 5000));
      const parsed = await runOne(client, c.query);
      const status = String(parsed.status);
      if (status !== 'unsupported') {
        failures++;
        console.log(`[FAIL ] "${c.query}" -> ${status}; expected unsupported`);
        console.log(`        linkedin_filters=${JSON.stringify(parsed.linkedin_filters)}`);
        continue;
      }
      const criteria = (parsed.unsupported_criteria ?? []) as string[];
      const matched = criteria.some(x => c.mustHaveUnsupported.test(x));
      if (!matched) {
        failures++;
        console.log(`[FAIL ] "${c.query}" unsupported_criteria=${JSON.stringify(criteria)}, expected regex ${c.mustHaveUnsupported}`);
      } else {
        console.log(`[PASS ] "${c.query}" -> unsupported (criteria=${JSON.stringify(criteria)})`);
      }
    } catch (err) {
      failures++;
      console.log(`[FAIL ] "${c.query}" — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
