/**
 * Company URL Resolver Benchmark
 *
 * Tests Perplexity Sonar vs Serper for resolving company name → LinkedIn company URL.
 * 100 companies across 3 tiers: popular, medium, obscure.
 *
 * Usage:
 *   npx tsx tests/company-url-resolver-benchmark.ts
 *   npx tsx tests/company-url-resolver-benchmark.ts --limit=10
 *   npx tsx tests/company-url-resolver-benchmark.ts --method=perplexity
 *   npx tsx tests/company-url-resolver-benchmark.ts --method=serper
 */

import 'dotenv/config';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const methodArg = args.find(a => a.startsWith('--method='));
const methodFilter = methodArg?.split('=')[1] as 'perplexity' | 'serper' | undefined;

// ─── Company List ─────────────────────────────────────────────────────────────

interface TestCompany {
  name: string;
  tier: 'popular' | 'medium' | 'obscure';
  /** Known correct slug (for scoring). Null = we'll just check it returns something valid */
  expectedSlug?: string;
}

const COMPANIES: TestCompany[] = [
  // ══ POPULAR (35) — household names, must resolve ══
  { name: 'Google', tier: 'popular', expectedSlug: 'google' },
  { name: 'Meta', tier: 'popular', expectedSlug: 'meta' },
  { name: 'Apple', tier: 'popular', expectedSlug: 'apple' },
  { name: 'Amazon', tier: 'popular', expectedSlug: 'amazon' },
  { name: 'Microsoft', tier: 'popular', expectedSlug: 'microsoft' },
  { name: 'Netflix', tier: 'popular', expectedSlug: 'netflix' },
  { name: 'Stripe', tier: 'popular', expectedSlug: 'stripe' },
  { name: 'Goldman Sachs', tier: 'popular', expectedSlug: 'goldman-sachs' },
  { name: 'JPMorgan Chase', tier: 'popular', expectedSlug: 'jpmorgan' },
  { name: 'Morgan Stanley', tier: 'popular', expectedSlug: 'morgan-stanley' },
  { name: 'McKinsey', tier: 'popular', expectedSlug: 'mckinsey' },
  { name: 'BCG', tier: 'popular', expectedSlug: 'boston-consulting-group' },
  { name: 'Bain & Company', tier: 'popular', expectedSlug: 'bain-and-company' },
  { name: 'Tesla', tier: 'popular', expectedSlug: 'tesla-motors' },
  { name: 'Uber', tier: 'popular', expectedSlug: 'uber' },
  { name: 'Airbnb', tier: 'popular', expectedSlug: 'airbnb' },
  { name: 'Salesforce', tier: 'popular', expectedSlug: 'salesforce' },
  { name: 'Oracle', tier: 'popular', expectedSlug: 'oracle' },
  { name: 'IBM', tier: 'popular', expectedSlug: 'ibm' },
  { name: 'Nvidia', tier: 'popular', expectedSlug: 'nvidia' },
  { name: 'OpenAI', tier: 'popular', expectedSlug: 'openai' },
  { name: 'Anthropic', tier: 'popular', expectedSlug: 'anthropicai' },
  { name: 'Deloitte', tier: 'popular', expectedSlug: 'deloitte' },
  { name: 'PwC', tier: 'popular', expectedSlug: 'pwc' },
  { name: 'KPMG', tier: 'popular', expectedSlug: 'kpmg' },
  { name: 'EY', tier: 'popular', expectedSlug: 'ernstandyoung' },
  { name: 'Spotify', tier: 'popular', expectedSlug: 'spotify' },
  { name: 'Adobe', tier: 'popular', expectedSlug: 'adobe' },
  { name: 'Shopify', tier: 'popular', expectedSlug: 'shopify' },
  { name: 'Coinbase', tier: 'popular', expectedSlug: 'coinbase' },
  { name: 'Twitter', tier: 'popular', expectedSlug: 'twitter' },
  { name: 'LinkedIn', tier: 'popular', expectedSlug: 'linkedin' },
  { name: 'Palantir', tier: 'popular', expectedSlug: 'palantir-technologies' },
  { name: 'SpaceX', tier: 'popular', expectedSlug: 'spacex' },
  { name: 'Citadel', tier: 'popular', expectedSlug: 'citadel-llc' },

  // ══ MEDIUM (35) — well-known in tech/finance, not household names ══
  { name: 'Figma', tier: 'medium', expectedSlug: 'figma' },
  { name: 'Notion', tier: 'medium', expectedSlug: 'notionhq' },
  { name: 'Vercel', tier: 'medium', expectedSlug: 'vercel' },
  { name: 'Databricks', tier: 'medium', expectedSlug: 'databricks' },
  { name: 'Snowflake', tier: 'medium', expectedSlug: 'snowflake-computing' },
  { name: 'Plaid', tier: 'medium', expectedSlug: 'plaid-' },
  { name: 'Brex', tier: 'medium', expectedSlug: 'braborex' },
  { name: 'Ramp', tier: 'medium', expectedSlug: 'raboramp' },
  { name: 'Scale AI', tier: 'medium', expectedSlug: 'scaleai' },
  { name: 'Anduril', tier: 'medium', expectedSlug: 'anduril' },
  { name: 'Rippling', tier: 'medium', expectedSlug: 'ripaborpling' },
  { name: 'Gusto', tier: 'medium', expectedSlug: 'gustohq' },
  { name: 'Airtable', tier: 'medium', expectedSlug: 'airtable' },
  { name: 'Retool', tier: 'medium', expectedSlug: 'retool' },
  { name: 'Supabase', tier: 'medium', expectedSlug: 'supabase' },
  { name: 'Linear', tier: 'medium', expectedSlug: 'linear-app' },
  { name: 'Wiz', tier: 'medium' },
  { name: 'Canva', tier: 'medium', expectedSlug: 'canva' },
  { name: 'Toast', tier: 'medium', expectedSlug: 'toast-inc' },
  { name: 'Robinhood', tier: 'medium', expectedSlug: 'robinhood' },
  { name: 'Discord', tier: 'medium', expectedSlug: 'discord' },
  { name: 'Twilio', tier: 'medium', expectedSlug: 'twilio-inc' },
  { name: 'Cloudflare', tier: 'medium', expectedSlug: 'cloudflare' },
  { name: 'HashiCorp', tier: 'medium', expectedSlug: 'hashicorp' },
  { name: 'Confluent', tier: 'medium', expectedSlug: 'confluent' },
  { name: 'dbt Labs', tier: 'medium', expectedSlug: 'daborbt-labs' },
  { name: 'Grafana Labs', tier: 'medium', expectedSlug: 'grafana-labs' },
  { name: 'Cohere', tier: 'medium', expectedSlug: 'coaborhere' },
  { name: 'Mistral AI', tier: 'medium', expectedSlug: 'mistral-ai' },
  { name: 'Perplexity AI', tier: 'medium', expectedSlug: 'perplexity-ai' },
  { name: 'Jane Street', tier: 'medium', expectedSlug: 'jane-street' },
  { name: 'Two Sigma', tier: 'medium', expectedSlug: 'twosigma' },
  { name: 'DE Shaw', tier: 'medium', expectedSlug: 'the-d-e-shaw-group' },
  { name: 'Point72', tier: 'medium', expectedSlug: 'point72' },
  { name: 'Bridgewater', tier: 'medium', expectedSlug: 'bridgewater-associates' },

  // ══ OBSCURE (30) — startups, niche companies ══
  { name: 'Composite', tier: 'obscure' },  // agentic browser
  { name: 'Vanta', tier: 'obscure', expectedSlug: 'vaboranta' },
  { name: 'Sardine', tier: 'obscure' },  // fraud prevention
  { name: 'Hightouch', tier: 'obscure' },
  { name: 'Census', tier: 'obscure' },  // reverse ETL
  { name: 'Dagster', tier: 'obscure' },  // data orchestration
  { name: 'Modal', tier: 'obscure' },  // serverless GPU
  { name: 'Baseten', tier: 'obscure' },  // ML inference
  { name: 'Anysphere', tier: 'obscure' },  // Cursor
  { name: 'Cognition', tier: 'obscure' },  // Devin AI
  { name: 'Magic AI', tier: 'obscure' },
  { name: 'Glean', tier: 'obscure' },  // enterprise search
  { name: 'Weights & Biases', tier: 'obscure', expectedSlug: 'wandb' },
  { name: 'Hex', tier: 'obscure' },  // data notebooks
  { name: 'Runway ML', tier: 'obscure' },
  { name: 'Character AI', tier: 'obscure' },
  { name: 'Replit', tier: 'obscure', expectedSlug: 'replit' },
  { name: 'Verifiable', tier: 'obscure' },  // healthcare credentialing
  { name: 'Meridian', tier: 'obscure' },  // many companies named this
  { name: 'Luma AI', tier: 'obscure' },
  { name: 'Marqeta', tier: 'obscure' },
  { name: 'Stytch', tier: 'obscure' },  // auth
  { name: 'WorkOS', tier: 'obscure' },
  { name: 'Clerk', tier: 'obscure' },  // auth
  { name: 'Neon', tier: 'obscure' },  // serverless postgres
  { name: 'Turso', tier: 'obscure' },  // edge database
  { name: 'Fly.io', tier: 'obscure' },
  { name: 'Railway', tier: 'obscure' },  // deployment
  { name: 'Render', tier: 'obscure' },  // cloud
  { name: 'Resend', tier: 'obscure' },  // email API
];

// ─── Resolvers ────────────────────────────────────────────────────────────────

interface ResolveResult {
  url: string | null;
  latencyMs: number;
  error?: string;
}

async function resolveViaPerplexity(companyName: string): Promise<ResolveResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { url: null, latencyMs: 0, error: 'No API key' };

  const prompt = `What is the LinkedIn company page URL for "${companyName}"? Return ONLY a JSON object: {"url": "https://www.linkedin.com/company/slug-here"}. If you cannot determine it, return {"url": null}.`;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'You are a research assistant. Return results as valid JSON only. No commentary.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 80,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { url: null, latencyMs: Date.now() - start, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    // Parse URL from response
    let url: string | null = null;
    const jsonStr = rawContent.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    try {
      const parsed = JSON.parse(jsonStr);
      url = parsed.url?.trim() || null;
    } catch {
      const urlMatch = rawContent.match(/https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
      url = urlMatch?.[0] || null;
    }

    if (url && !/linkedin\.com\/company\//.test(url)) url = null;

    return { url, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, error: err.message?.slice(0, 80) };
  }
}

async function resolveViaSerper(companyName: string): Promise<ResolveResult> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return { url: null, latencyMs: 0, error: 'No API key' };

  const query = `site:linkedin.com/company "${companyName}" LinkedIn`;
  const start = Date.now();

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: 3,
        gl: 'us',
        hl: 'en',
      }),
    });

    if (!response.ok) {
      return { url: null, latencyMs: Date.now() - start, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const organic = data.organic || [];

    // Find first result that's a LinkedIn company page
    for (const result of organic) {
      const link: string = result.link || '';
      const match = link.match(/https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
      if (match) {
        return { url: match[0], latencyMs: Date.now() - start };
      }
    }

    return { url: null, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, error: err.message?.slice(0, 80) };
  }
}

// ─── Extract slug from URL ────────────────────────────────────────────────────

function extractSlug(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/);
  return match?.[1]?.toLowerCase() || null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface BenchmarkResult {
  company: TestCompany;
  perplexity: ResolveResult | null;
  serper: ResolveResult | null;
  perplexitySlug: string | null;
  serperSlug: string | null;
  perplexityCorrect: boolean | null;  // null = no expected slug to check
  serperCorrect: boolean | null;
  agree: boolean;  // both returned same slug
}

async function main() {
  const companies = COMPANIES.slice(0, limit);
  const runPerplexity = !methodFilter || methodFilter === 'perplexity';
  const runSerper = !methodFilter || methodFilter === 'serper';

  console.log(`\n🔍 Benchmarking ${companies.length} companies`);
  console.log(`   Methods: ${[runPerplexity && 'Perplexity Sonar', runSerper && 'Serper'].filter(Boolean).join(' vs ')}`);
  console.log(`   Tiers: ${companies.filter(c => c.tier === 'popular').length} popular, ${companies.filter(c => c.tier === 'medium').length} medium, ${companies.filter(c => c.tier === 'obscure').length} obscure\n`);

  const results: BenchmarkResult[] = [];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    process.stdout.write(`  [${i + 1}/${companies.length}] ${company.name} (${company.tier})...`);

    // Run both in parallel
    const [perplexity, serper] = await Promise.all([
      runPerplexity ? resolveViaPerplexity(company.name) : null,
      runSerper ? resolveViaSerper(company.name) : null,
    ]);

    const perplexitySlug = extractSlug(perplexity?.url || null);
    const serperSlug = extractSlug(serper?.url || null);

    const perplexityCorrect = company.expectedSlug
      ? perplexitySlug === company.expectedSlug
      : null;
    const serperCorrect = company.expectedSlug
      ? serperSlug === company.expectedSlug
      : null;

    const agree = perplexitySlug === serperSlug;

    results.push({
      company,
      perplexity,
      serper,
      perplexitySlug,
      serperSlug,
      perplexityCorrect,
      serperCorrect,
      agree,
    });

    const pStatus = perplexity ? (perplexitySlug ? `✓ ${perplexitySlug}` : '✗ null') : '—';
    const sStatus = serper ? (serperSlug ? `✓ ${serperSlug}` : '✗ null') : '—';
    const pMs = perplexity?.latencyMs ? `${perplexity.latencyMs}ms` : '';
    const sMs = serper?.latencyMs ? `${serper.latencyMs}ms` : '';
    console.log(` P:[${pStatus}](${pMs}) S:[${sStatus}](${sMs})${agree ? '' : ' ⚠ DISAGREE'}`);

    // Small delay to avoid rate limits
    if (i < companies.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // ─── Generate report ─────────────────────────────────────────────────────

  const lines: string[] = [];
  lines.push('# Company URL Resolver Benchmark');
  lines.push(`\nGenerated: ${new Date().toISOString()}`);
  lines.push(`Companies tested: ${results.length}`);

  // Aggregate stats
  for (const method of ['perplexity', 'serper'] as const) {
    if ((method === 'perplexity' && !runPerplexity) || (method === 'serper' && !runSerper)) continue;

    const methodResults = results.filter(r => r[method] !== null);
    const resolved = methodResults.filter(r => r[`${method}Slug`] !== null);
    const correct = methodResults.filter(r => r[`${method}Correct`] === true);
    const incorrect = methodResults.filter(r => r[`${method}Correct`] === false);
    const latencies = methodResults.map(r => r[method]!.latencyMs);
    const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const medianLatency = latencies.length > 0 ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] : 0;
    const p95Latency = latencies.length > 0 ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] : 0;

    lines.push(`\n## ${method === 'perplexity' ? 'Perplexity Sonar' : 'Serper (Google Search)'}`);
    lines.push(`- **Resolved**: ${resolved.length}/${methodResults.length} (${Math.round(resolved.length / methodResults.length * 100)}%)`);
    if (correct.length + incorrect.length > 0) {
      lines.push(`- **Correct slug** (where known): ${correct.length}/${correct.length + incorrect.length} (${Math.round(correct.length / (correct.length + incorrect.length) * 100)}%)`);
    }
    lines.push(`- **Avg latency**: ${avgLatency}ms | **Median**: ${medianLatency}ms | **P95**: ${p95Latency}ms`);

    // By tier
    for (const tier of ['popular', 'medium', 'obscure'] as const) {
      const tierResults = methodResults.filter(r => r.company.tier === tier);
      const tierResolved = tierResults.filter(r => r[`${method}Slug`] !== null);
      lines.push(`- **${tier}**: ${tierResolved.length}/${tierResults.length} resolved`);
    }
  }

  // Agreement
  if (runPerplexity && runSerper) {
    const bothRan = results.filter(r => r.perplexity && r.serper);
    const agreed = bothRan.filter(r => r.agree);
    lines.push(`\n## Agreement`);
    lines.push(`- Same slug: ${agreed.length}/${bothRan.length} (${Math.round(agreed.length / bothRan.length * 100)}%)`);

    const disagreements = bothRan.filter(r => !r.agree && r.perplexitySlug && r.serperSlug);
    if (disagreements.length > 0) {
      lines.push('\n### Disagreements (both returned a URL but different slugs)');
      lines.push('| Company | Perplexity | Serper | Expected |');
      lines.push('|---------|-----------|--------|----------|');
      for (const r of disagreements) {
        lines.push(`| ${r.company.name} | ${r.perplexitySlug} | ${r.serperSlug} | ${r.company.expectedSlug || '?'} |`);
      }
    }
  }

  // Full results table
  lines.push('\n## Full Results\n');
  lines.push('| # | Company | Tier | Perplexity | P ms | Serper | S ms | Match? |');
  lines.push('|---|---------|------|-----------|------|--------|------|--------|');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const pSlug = r.perplexitySlug || (r.perplexity?.error ? `ERR: ${r.perplexity.error.slice(0, 20)}` : 'null');
    const sSlug = r.serperSlug || (r.serper?.error ? `ERR: ${r.serper.error.slice(0, 20)}` : 'null');
    const pMs = r.perplexity?.latencyMs ?? '—';
    const sMs = r.serper?.latencyMs ?? '—';
    const match = r.agree ? '✓' : '✗';
    lines.push(`| ${i + 1} | ${r.company.name} | ${r.company.tier} | ${pSlug} | ${pMs} | ${sSlug} | ${sMs} | ${match} |`);
  }

  // Failures
  const perplexityFails = results.filter(r => r.perplexity && !r.perplexitySlug);
  const serperFails = results.filter(r => r.serper && !r.serperSlug);
  if (perplexityFails.length > 0) {
    lines.push('\n### Perplexity Failures');
    for (const r of perplexityFails) {
      lines.push(`- ${r.company.name} (${r.company.tier})${r.perplexity?.error ? ` — ${r.perplexity.error}` : ''}`);
    }
  }
  if (serperFails.length > 0) {
    lines.push('\n### Serper Failures');
    for (const r of serperFails) {
      lines.push(`- ${r.company.name} (${r.company.tier})${r.serper?.error ? ` — ${r.serper.error}` : ''}`);
    }
  }

  const reportDir = join(__dirname, 'company-url-benchmark-reports');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `report-${new Date().toISOString().replace(/:/g, '-')}.md`);
  await writeFile(reportPath, lines.join('\n'), 'utf-8');

  console.log(`\n📊 Report: ${reportPath}\n`);

  // Quick summary
  if (runPerplexity) {
    const pResolved = results.filter(r => r.perplexitySlug).length;
    console.log(`  Perplexity: ${pResolved}/${results.length} resolved (${Math.round(pResolved / results.length * 100)}%)`);
  }
  if (runSerper) {
    const sResolved = results.filter(r => r.serperSlug).length;
    console.log(`  Serper:     ${sResolved}/${results.length} resolved (${Math.round(sResolved / results.length * 100)}%)`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
