/**
 * Serper API Service for Google Search
 *
 * Replaces Google CSE ($5/1K queries, 10K daily cap) with Serper ($1/1K, no daily cap).
 * Used for LinkedIn profile discovery via `site:linkedin.com/in` queries.
 */

const SERPER_API_KEY = process.env.SERPER_API_KEY;

export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
}

/**
 * Call Serper Google Search API.
 *
 * @param query - Search query string
 * @param page - Page number (1-based). Serper uses `page` param, not `start`.
 * @returns Array of search results
 */
export async function searchSerper(query: string, page: number = 1): Promise<SerperResult[]> {
  if (!SERPER_API_KEY) {
    console.log('[Serper] API key not configured, skipping search');
    return [];
  }

  const start = Date.now();
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: 10,
        page,
        gl: 'us',
        hl: 'en',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[Serper] API error ${response.status} (${Date.now() - start}ms): ${body.slice(0, 200)}`);
      return [];
    }

    const data: SerperResponse = await response.json();
    const results = (data.organic || []).map(r => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet,
      position: r.position,
    }));
    console.log(`[Serper] ${results.length} results in ${Date.now() - start}ms (page ${page}, query: "${query.slice(0, 80)}")`);
    return results;
  } catch (error) {
    console.error(`[Serper] Fetch failed after ${Date.now() - start}ms:`, error instanceof Error ? error.message : error);
    return [];
  }
}
