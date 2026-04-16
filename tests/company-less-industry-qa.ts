/**
 * Verifies that the extractor prompt + Haiku produce ready status with
 * the right linkedin_filters for company-less industry / function queries.
 *
 * Usage: npx tsx tests/company-less-industry-qa.ts
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';

type Case = {
  query: string;
  status: 'ready';
  mustHave: (linkedin: Record<string, unknown>, top: Record<string, unknown>) => string | null;
};

const CASES: Case[] = [
  {
    query: 'find people in healthcare',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      if (!f.includes('11')) return `function_ids missing "11"; got ${JSON.stringify(f)}`;
      if (l.current_job_titles) return `current_job_titles should be absent for discipline-only query`;
      return null;
    },
  },
  {
    query: 'healthcare workers',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      return f.includes('11') ? null : `function_ids missing "11"; got ${JSON.stringify(f)}`;
    },
  },
  {
    query: 'doctors',
    status: 'ready',
    mustHave: l => {
      const t = (l.current_job_titles ?? []) as string[];
      if (!t.some(x => /doctor/i.test(x))) return `current_job_titles missing Doctor; got ${JSON.stringify(t)}`;
      if (l.function_ids) return `RULE 1 violation: function_ids present alongside named title`;
      return null;
    },
  },
  {
    query: 'nurses in New York',
    status: 'ready',
    mustHave: l => {
      const t = (l.current_job_titles ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!t.some(x => /nurse/i.test(x))) return `current_job_titles missing Nurse`;
      if (!loc.some(x => /new york/i.test(x))) return `locations missing New York`;
      return null;
    },
  },
  {
    query: 'healthcare PMs',
    status: 'ready',
    mustHave: l => {
      const t = (l.current_job_titles ?? []) as string[];
      const ind = (l.industry_ids ?? []) as string[];
      if (!t.some(x => /product manager/i.test(x))) return `current_job_titles missing Product Manager`;
      if (!ind.includes('14')) return `industry_ids missing "14" (healthcare); got ${JSON.stringify(ind)}`;
      if (l.function_ids) return `Should NOT emit function_ids for "PMs" in a healthcare industry query`;
      return null;
    },
  },
  {
    query: 'find me people in healthcare in New York',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('11')) return `function_ids missing "11"`;
      if (!loc.some(x => /new york/i.test(x))) return `locations missing New York`;
      return null;
    },
  },
  {
    query: 'engineers in Austin',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('8')) return `function_ids missing "8"`;
      if (!loc.some(x => /austin/i.test(x))) return `locations missing Austin`;
      return null;
    },
  },
  {
    query: 'designers in SF',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('3')) return `function_ids missing "3"`;
      if (!loc.some(x => /san francisco/i.test(x))) return `locations missing San Francisco`;
      return null;
    },
  },
  {
    query: 'salespeople in NYC',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      return f.includes('25') ? null : `function_ids missing "25"; got ${JSON.stringify(f)}`;
    },
  },
  {
    query: 'fintech PMs',
    status: 'ready',
    mustHave: l => {
      const t = (l.current_job_titles ?? []) as string[];
      const ind = (l.industry_ids ?? []) as string[];
      if (!t.some(x => /product manager/i.test(x))) return `current_job_titles missing Product Manager`;
      if (!ind.includes('43')) return `industry_ids missing "43"`;
      return null;
    },
  },
  {
    query: 'biotech engineers in Boston',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const ind = (l.industry_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('8')) return `function_ids missing "8"`;
      if (!ind.includes('12')) return `industry_ids missing "12"`;
      if (!loc.some(x => /boston/i.test(x))) return `locations missing Boston`;
      return null;
    },
  },
  {
    query: 'lawyers in Chicago',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('14')) return `function_ids missing "14"`;
      if (!loc.some(x => /chicago/i.test(x))) return `locations missing Chicago`;
      return null;
    },
  },
  {
    query: 'MIT grads',
    status: 'ready',
    mustHave: l => {
      const s = (l.schools ?? []) as string[];
      return s.some(x => /massachusetts institute of technology/i.test(x))
        ? null
        : `schools missing MIT expansion; got ${JSON.stringify(s)}`;
    },
  },
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
  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  let failures = 0;
  console.log(`Company-less industry/function QA — ${CASES.length} queries\n`);
  for (const c of CASES) {
    try {
      // Rate-limit delay to avoid 50k tokens/min cap
      await new Promise(r => setTimeout(r, 5000));
      const parsed = await runOne(client, c.query);
      const status = String(parsed.status);
      if (status !== c.status) {
        failures++;
        console.log(`[FAIL ] "${c.query}" — status=${status}, expected ${c.status}`);
        console.log(`        linkedin_filters=${JSON.stringify(parsed.linkedin_filters)}`);
        continue;
      }
      const linkedin = (parsed.linkedin_filters ?? {}) as Record<string, unknown>;
      const top = (parsed.filters ?? {}) as Record<string, unknown>;
      const problem = c.mustHave(linkedin, top);
      if (problem) {
        failures++;
        console.log(`[FAIL ] "${c.query}" — ${problem}`);
        console.log(`        linkedin_filters=${JSON.stringify(linkedin)}`);
      } else {
        console.log(`[PASS ] "${c.query}"`);
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
