/**
 * Verifies that bare queries without a primary signal stay off_topic
 * (or needs_selection), never ready. Protects the Apify cost budget
 * from runaway broad scrapes.
 *
 * Usage: npx tsx tests/company-less-offtopic-qa.ts
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';

type Case = {
  query: string;
  allowedStatuses: string[];
};

const CASES: Case[] = [
  { query: 'find people', allowedStatuses: ['off_topic'] },
  { query: 'hello', allowedStatuses: ['off_topic'] },
  { query: 'what\'s for lunch', allowedStatuses: ['off_topic'] },
  { query: 'help', allowedStatuses: ['off_topic'] },
  { query: 'people I might like', allowedStatuses: ['off_topic'] },
  { query: 'people in Austin', allowedStatuses: ['off_topic'] },
  { query: 'senior people', allowedStatuses: ['off_topic'] },
  { query: 'startups', allowedStatuses: ['needs_selection', 'off_topic'] },
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
  console.log(`Company-less off-topic guard QA — ${CASES.length} queries\n`);
  for (const c of CASES) {
    try {
      await new Promise(r => setTimeout(r, 5000));
      const parsed = await runOne(client, c.query);
      const status = String(parsed.status);
      if (c.allowedStatuses.includes(status)) {
        console.log(`[PASS ] "${c.query}" -> ${status}`);
      } else {
        failures++;
        console.log(`[FAIL ] "${c.query}" -> ${status} (allowed: ${c.allowedStatuses.join(', ')})`);
        console.log(`        linkedin_filters=${JSON.stringify(parsed.linkedin_filters)}`);
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
