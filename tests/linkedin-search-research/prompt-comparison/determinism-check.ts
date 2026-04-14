import 'dotenv/config';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT_V2 } from '../../../src/lib/prompts/search-extraction-prompt-v2';
import { completeJsonAnthropic } from '../../../src/lib/services/anthropic';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const CASES = [
  'senior engineers at Google',
  'staff engineers at Netflix',
  'directors at Apple',
  'VP of engineering at Uber',
  'principal engineers at Amazon',
];

async function main() {
  console.log('\n=== DETERMINISM CHECK (5 cases x 3 runs) ===\n');

  for (const input of CASES) {
    const results: any[] = [];
    let run = 0;
    while (run < 3) {
      await sleep(3000);
      try {
        const resp = await completeJsonAnthropic<any>({
          systemPrompt: SEARCH_EXTRACTION_SYSTEM_PROMPT_V2,
          userPrompt: `New user message: ${input}`,
          model: 'claude-haiku-4-5-20251001',
          temperature: 0.1,
          maxTokens: 800,
        });
        const o = resp.content;
        const lf = o.linkedin_filters || {};
        results.push({
          status: o.status,
          titles: lf.current_job_titles || null,
          fids: lf.function_ids || null,
          seniority: lf.seniority_level_ids || null,
          exclude_seniority: lf.exclude_seniority_level_ids || null,
          role_specificity: o.role_specificity,
        });
        run++;
      } catch (e: any) {
        if (e.message?.includes('429')) {
          console.log(`  [rate limited on "${input}" run ${run+1}, waiting 20s]`);
          await sleep(20000);
          continue;
        }
        results.push({ error: e.message });
        run++;
      }
    }

    const jsons = results.map(r => JSON.stringify(r));
    const allSame = jsons.every(j => j === jsons[0]);
    const has120 = results.some(r => r.seniority?.includes('120'));
    const has110 = results.some(r => r.seniority?.includes('110'));

    console.log(`  "${input}"`);
    console.log(`    Consistent: ${allSame ? 'YES' : 'NO'}`);
    console.log(`    Has 120 in seniority: ${has120 ? 'CRITICAL FAIL' : 'no (correct)'}`);
    console.log(`    Has 110 in seniority: ${has110 ? 'WARNING' : 'no (correct)'}`);
    if (!allSame) {
      for (let i = 0; i < results.length; i++) {
        console.log(`    Run ${i+1}: ${JSON.stringify(results[i])}`);
      }
    } else {
      console.log(`    Result: ${jsons[0]}`);
    }
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
