import 'dotenv/config';
import { searchSerper } from '../src/lib/services/serper';

async function test(company: string) {
  const start = Date.now();
  const results = await searchSerper(`site:linkedin.com/company "${company}"`);
  const elapsed = Date.now() - start;
  const top = results.slice(0, 3).map(r => `  ${r.title} → ${r.link}`).join('\n');
  console.log(`${company}: ${elapsed}ms`);
  console.log(top);
  console.log('');
}

async function main() {
  await test('Datadog');
  await test('Workday');
}

main().catch(console.error);
