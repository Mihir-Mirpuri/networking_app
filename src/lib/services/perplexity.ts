/**
 * Perplexity Sonar API client for real-time company lookups.
 * Used when Groq's training data is insufficient (startups, niche industries).
 */

import { log, PERPLEXITY_SONAR_COST_PER_REQUEST } from '@/lib/services/discovery-logger';

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
  linkedinUrl?: string;
}

/**
 * Find the LinkedIn company page URL for a company using Perplexity Sonar.
 * Used for ambiguous company names where Serper's LinkedIn search returns wrong results.
 *
 * @param companyName - The company name to look up
 * @param context - Optional context to disambiguate (e.g., "agentic browser", "dating app")
 * @returns The LinkedIn company URL (e.g., "https://www.linkedin.com/company/composite-com") or null
 */
export async function findCompanyLinkedInUrl(
  companyName: string,
  context?: string
): Promise<string | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY not configured');
  }

  const contextClause = context ? ` (${context})` : '';
  const prompt = `What is the LinkedIn company page URL for ${companyName}${contextClause}? Return ONLY a JSON object: {"url": "https://www.linkedin.com/company/slug-here"} — the full LinkedIn company URL. If you cannot determine it, return {"url": null}.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const startTime = Date.now();

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
        temperature: 0.1,
        max_tokens: 100,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error('[Perplexity] findCompanyLinkedInUrl API error:', response.status);
      log.llm('perplexity', {
        provider: 'perplexity',
        model: 'sonar',
        userPrompt: prompt,
        rawResponse: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: Date.now() - startTime,
        error: `HTTP ${response.status}`,
      }, 'findCompanyLinkedInUrl');
      return null;
    }

    const data: PerplexityResponse = await response.json();
    const rawContent = data.choices[0]?.message?.content || '';

    // Try JSON parse first, then fall back to regex extraction
    let url: string | null = null;
    const jsonStr = rawContent.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    try {
      const parsed = JSON.parse(jsonStr) as { url: string | null };
      url = parsed.url?.trim() || null;
    } catch {
      // Perplexity sometimes adds commentary after JSON — try extracting the URL directly
      const urlMatch = rawContent.match(/https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
      url = urlMatch?.[0] || null;
    }

    // Validate it's actually a LinkedIn company URL
    if (url && !/linkedin\.com\/company\//.test(url)) {
      console.warn(`[Perplexity] findCompanyLinkedInUrl returned non-company URL: ${url}`);
      log.llm('perplexity', {
        provider: 'perplexity',
        model: 'sonar',
        userPrompt: prompt,
        rawResponse: rawContent,
        parsedResponse: { url: null, rejected: url },
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: Date.now() - startTime,
        costUsd: PERPLEXITY_SONAR_COST_PER_REQUEST,
      }, 'findCompanyLinkedInUrl');
      return null;
    }

    console.log(`[Perplexity] findCompanyLinkedInUrl("${companyName}", "${context || ''}") → ${url}`);
    log.llm('perplexity', {
      provider: 'perplexity',
      model: 'sonar',
      userPrompt: prompt,
      rawResponse: rawContent,
      parsedResponse: { url },
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs: Date.now() - startTime,
      costUsd: PERPLEXITY_SONAR_COST_PER_REQUEST,
    }, 'findCompanyLinkedInUrl');
    return url;
  } catch (err) {
    console.warn(`[Perplexity] findCompanyLinkedInUrl failed for "${companyName}":`, err);
    log.llm('perplexity', {
      provider: 'perplexity',
      model: 'sonar',
      userPrompt: prompt,
      rawResponse: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }, 'findCompanyLinkedInUrl');
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
    { "name": "Company Name", "description": "One sentence about what they do", "linkedin_url": "https://www.linkedin.com/company/company-slug" }
  ]
}

- "linkedin_url": The LinkedIn company page URL (e.g., "https://www.linkedin.com/company/stripe"). Use the exact LinkedIn slug. If you don't know it, omit the field or set to null.

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
  const startTime = Date.now();

  try {
    let rawContentForLog = '';
    let response: Response;
    try {
      response = await fetch('https://api.perplexity.ai/chat/completions', {
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
    } catch (fetchErr) {
      log.llm('perplexity', {
        provider: 'perplexity',
        model: 'sonar',
        userPrompt: prompt,
        rawResponse: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: Date.now() - startTime,
        error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
      }, 'fetchCompaniesForCategory');
      throw fetchErr;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Perplexity] API error:', response.status, errorText);
      log.llm('perplexity', {
        provider: 'perplexity',
        model: 'sonar',
        userPrompt: prompt,
        rawResponse: errorText,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: Date.now() - startTime,
        error: `HTTP ${response.status}`,
      }, 'fetchCompaniesForCategory');
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data: PerplexityResponse = await response.json();
    const rawContent = data.choices[0]?.message?.content || '';
    rawContentForLog = rawContent;

    // Parse JSON (may be wrapped in markdown code blocks)
    const jsonStr = rawContent.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    let parsed: { companies?: PerplexityCompany[] };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('[Perplexity] Failed to parse response as JSON:', rawContent);
      log.llm('perplexity', {
        provider: 'perplexity',
        model: 'sonar',
        userPrompt: prompt,
        rawResponse: rawContentForLog,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: Date.now() - startTime,
        costUsd: PERPLEXITY_SONAR_COST_PER_REQUEST,
        error: 'JSON parse failed',
      }, 'fetchCompaniesForCategory');
      throw new Error('Failed to parse Perplexity response');
    }

    const companies: PerplexityCompany[] = (parsed.companies || [])
      .filter((c: { name?: string }) => c?.name && c.name.trim())
      .map((c: { name: string; description?: string; linkedin_url?: string }) => {
        const company: PerplexityCompany = { name: c.name.trim(), description: c.description || '' };
        // Validate and attach LinkedIn URL if present
        if (c.linkedin_url && /linkedin\.com\/company\//.test(c.linkedin_url)) {
          company.linkedinUrl = c.linkedin_url.trim();
        }
        return company;
      });

    console.log(`[Perplexity] Fetched ${companies.length} companies for category: "${category}"`);
    log.llm('perplexity', {
      provider: 'perplexity',
      model: 'sonar',
      userPrompt: prompt,
      rawResponse: rawContentForLog,
      parsedResponse: { companies },
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs: Date.now() - startTime,
      costUsd: PERPLEXITY_SONAR_COST_PER_REQUEST,
    }, 'fetchCompaniesForCategory');
    return companies;
  } finally {
    clearTimeout(timeout);
  }
}
