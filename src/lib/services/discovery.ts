const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface CSEResponse {
  items?: CSEResult[];
}

export interface SearchParams {
  university: string;
  company: string;
  role: string;
  limit: number;
  excludePersonKeys?: Set<string>; // Set of "fullName_company" keys (lowercase) to exclude
}

export interface SearchResult {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  sourceUrl: string;
  sourceTitle: string;
  sourceSnippet: string;
  sourceDomain: string;
}

async function searchCSE(query: string): Promise<CSEResult[]> {
  if (!CSE_API_KEY) {
    console.log('CSE API key not configured, skipping search');
    return [];
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.error('CSE API error:', response.status, await response.text());
      return [];
    }
    const data: CSEResponse = await response.json();
    return data.items || [];
  } catch (error) {
    console.error('CSE fetch error:', error);
    return [];
  }
}

// Parse candidate name from search result
function parseCandidate(result: CSEResult, company: string): {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
} | null {
  const title = result.title;
  const snippet = result.snippet;

  // Try to extract name from LinkedIn-style titles: "John Doe - Analyst at Company"
  const linkedinMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[-–|]/);
  if (linkedinMatch) {
    const fullName = linkedinMatch[1].trim();
    const names = fullName.split(' ');
    const firstName = names[0];
    const lastName = names.slice(1).join(' ');

    // Try to extract role
    const roleMatch = title.match(/[-–|]\s*([^|–-]+?)(?:\s+at\s+|\s+@\s+|$)/i);
    const role = roleMatch ? roleMatch[1].trim() : null;

    return { fullName, firstName, lastName, role };
  }

  // Try pattern: "Name | Role at Company"
  const pipeMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*\|/);
  if (pipeMatch) {
    const fullName = pipeMatch[1].trim();
    const names = fullName.split(' ');
    return {
      fullName,
      firstName: names[0],
      lastName: names.slice(1).join(' '),
      role: null,
    };
  }

  // Try pattern from snippet for names mentioned with company
  const companyRegex = new RegExp(`([A-Z][a-z]+ [A-Z][a-z]+).*?${company}`, 'i');
  const snippetMatch = snippet.match(companyRegex);
  if (snippetMatch) {
    const fullName = snippetMatch[1].trim();
    const names = fullName.split(' ');
    return {
      fullName,
      firstName: names[0],
      lastName: names.slice(1).join(' '),
      role: null,
    };
  }

  return null;
}

function normalizeKey(name: string, company: string, url: string): string {
  return `${name.toLowerCase().replace(/\s+/g, '_')}_${company.toLowerCase().replace(/\s+/g, '_')}_${url}`;
}

export async function searchPeople(params: SearchParams): Promise<SearchResult[]> {
  const { university, company, role, limit, excludePersonKeys = new Set() } = params;

  // Generate multiple queries to find candidates
  const queries = [
    `${university} ${company} ${role}`,
    `"${university}" "${company}" alumni`,
    `${company} "${university}" ${role}`,
    `site:linkedin.com "${university}" "${company}"`,
    `"${university}" alumni ${company}`,
    `${university} ${company} finance`,
  ];

  const seenKeys = new Set<string>();
  const candidates: SearchResult[] = [];

  for (const query of queries) {
    if (candidates.length >= limit) break;

    const results = await searchCSE(query);

    for (const result of results) {
      if (candidates.length >= limit) break;

      const parsed = parseCandidate(result, company);
      if (!parsed) continue;

      // Check if person is already discovered by this user
      const personKey = `${parsed.fullName}_${company}`.toLowerCase();
      if (excludePersonKeys.has(personKey)) {
        console.log(`[Discovery] Skipping already discovered: ${parsed.fullName} at ${company}`);
        continue;
      }

      // Check for duplicate URLs (same person from different search queries)
      const key = normalizeKey(parsed.fullName, company, result.link);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      candidates.push({
        ...parsed,
        company,
        sourceUrl: result.link,
        sourceTitle: result.title,
        sourceSnippet: result.snippet,
        sourceDomain: result.displayLink,
      });
    }

    // Rate limiting between queries
    await new Promise((r) => setTimeout(r, 200));
  }

  return candidates;
}
