import 'dotenv/config';

async function main() {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.error('No PERPLEXITY_API_KEY');
    process.exit(1);
  }

  const prompt = `What is the LinkedIn company page URL for Composite, the agentic browser startup that raised $5.6M from NFDG (Nat Friedman/Daniel Gross)? Return ONLY a JSON object: { "linkedin_url": "https://linkedin.com/company/..." }`;

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
      max_tokens: 200,
      search_recency_filter: 'year',
    }),
  });

  const elapsed = Date.now() - start;
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '(empty)';

  console.log(`\nLatency: ${elapsed}ms`);
  console.log(`Response: ${content}`);
  console.log(`Citations: ${JSON.stringify(data.citations || [])}`);
}

main().catch(console.error);
