/**
 * Perplexity Sonar API client for real-time company lookups.
 * Used when Groq's training data is insufficient (startups, niche industries).
 */

interface PerplexityResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  citations?: string[];
}

export interface PerplexityCompany {
  name: string;
  description: string;
}

/**
 * Fetch a list of real, current companies matching a category using Perplexity Sonar.
 * Returns up to `count` companies with names and short descriptions.
 * Throws on failure so the caller can fall back to Groq's suggestions.
 */
export async function fetchCompaniesForCategory(
  category: string,
  role: string | null,
  count: number = 12
): Promise<PerplexityCompany[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY not configured');
  }

  const roleContext = role ? ` that hire ${role}s` : '';
  const prompt = `List ${count} specific, real company names that match this category: "${category}"${roleContext}.

Return ONLY a JSON object with this format:
{
  "companies": [
    { "name": "Company Name", "description": "One sentence about what they do" }
  ]
}

Rules:
- Return ONLY specific company names (e.g., "Anthropic", "Scale AI", "Stripe") — NEVER accelerator programs, VC firms, sub-categories, or groupings (e.g., NOT "Y Combinator startups", "500 Startups portfolio")
- Only include real, currently operating companies that CLOSELY match the category
- If the category mentions "startups", only include actual startups (private, venture-backed, founded in the last ~10 years) — NOT large public corporations
- If the category mentions "YC" or "Y Combinator", only include Y Combinator alumni companies
- Prioritize well-known and notable companies in this specific space
- Include a mix of established and newer companies within the category
- Do NOT include companies that have shut down or been fully acquired
- Return ONLY valid JSON, no other text`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a research assistant. Return results as valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 1000,
        search_recency_filter: 'year',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Perplexity] API error:', response.status, errorText);
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data: PerplexityResponse = await response.json();
    const rawContent = data.choices[0]?.message?.content || '';

    // Parse JSON (may be wrapped in markdown code blocks)
    const jsonStr = rawContent.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    let parsed: { companies?: PerplexityCompany[] };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('[Perplexity] Failed to parse response as JSON:', rawContent);
      throw new Error('Failed to parse Perplexity response');
    }

    const companies = (parsed.companies || [])
      .filter(c => c.name && c.name.trim())
      .map(c => ({ name: c.name.trim(), description: c.description || '' }));

    console.log(`[Perplexity] Fetched ${companies.length} companies for category: "${category}"`);
    return companies;
  } finally {
    clearTimeout(timeout);
  }
}
