import 'dotenv/config';

async function testPrompt(label: string, prompt: string) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) { console.error('No PERPLEXITY_API_KEY'); process.exit(1); }

  const start = Date.now();
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'Return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 300,
      search_recency_filter: 'year',
    }),
  });

  const elapsed = Date.now() - start;
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '(empty)';

  console.log(`\n[${label}] ${elapsed}ms`);
  console.log(`Response: ${content}`);
  console.log(`Citations: ${JSON.stringify(data.citations || [])}`);
}

async function main() {
  // Test 1: Ditto dating app
  await testPrompt(
    'Ditto (dating app)',
    `Find the LinkedIn company page URL for "Ditto", the AI dating app for college students. Search for their linkedin.com/company/... page. Return JSON: { "linkedin_url": "...", "company_name": "...", "description": "one line about what they do" }`
  );

  // Test 2: Composite (agentic browser)
  await testPrompt(
    'Composite (agentic browser)',
    `Find the LinkedIn company page URL for "Composite", the agentic browser startup that raised from NFDG. Search for their linkedin.com/company/... page. Return JSON: { "linkedin_url": "...", "company_name": "...", "description": "one line about what they do" }`
  );

  // Test 3: Ramp (finance)
  await testPrompt(
    'Ramp (corporate cards)',
    `Find the LinkedIn company page URL for "Ramp", the corporate card and spend management startup. Search for their linkedin.com/company/... page. Return JSON: { "linkedin_url": "...", "company_name": "...", "description": "one line about what they do" }`
  );

  // Test 4: Hinge (dating)
  await testPrompt(
    'Hinge (dating app)',
    `Find the LinkedIn company page URL for "Hinge", the dating app. Search for their linkedin.com/company/... page. Return JSON: { "linkedin_url": "...", "company_name": "...", "description": "one line about what they do" }`
  );
}

main().catch(console.error);
