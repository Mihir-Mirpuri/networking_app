/**
 * Test the company URL resolution flow via Perplexity.
 */

import { resolveCompanyUrl } from '@/lib/services/company-resolver';

const TEST_CASES = [
  // Ambiguous names (generic English words)
  { company: 'Composite', context: 'agentic browser' },
  { company: 'Ditto', context: 'dating app' },
  { company: 'Hinge', context: 'dating app' },
  { company: 'Ramp', context: 'corporate card fintech' },
  { company: 'Bolt', context: 'ride-hailing' },
  { company: 'Plaid', context: 'financial data API' },
  { company: 'Toast', context: 'restaurant POS' },
  { company: 'Brex', context: 'corporate card' },
  { company: 'Gusto', context: 'payroll software' },
  { company: 'Notion', context: 'productivity software' },

  // Well-known companies (should resolve via cache or Perplexity)
  { company: 'Google', context: undefined },
  { company: 'McKinsey', context: undefined },
  { company: 'Datadog', context: undefined },
];

async function main() {
  console.log('=== Company URL Resolver Test ===\n');

  for (const tc of TEST_CASES) {
    const label = `${tc.company}${tc.context ? ` (${tc.context})` : ''}`;
    const start = Date.now();

    try {
      const result = await resolveCompanyUrl(tc.company, tc.context);

      const ms = Date.now() - start;
      const status = result.url ? '✅' : '❌';
      console.log(`${status} ${label}`);
      console.log(`   URL: ${result.url || '(none)'}`);
      console.log(`   Time: ${ms}ms | Perplexity calls: ${result.cost.perplexityCalls}\n`);
    } catch (err) {
      const ms = Date.now() - start;
      console.log(`💥 ${label} — ERROR after ${ms}ms: ${err instanceof Error ? err.message : err}\n`);
    }
  }
}

main().catch(console.error);
