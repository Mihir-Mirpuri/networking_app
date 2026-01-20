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

// Validate that a parsed candidate name is actually a valid person name
function isValidPersonName(
  parsed: { fullName: string; firstName: string | null; lastName: string | null },
  company: string
): boolean {
  const { fullName, firstName, lastName } = parsed;

  // 1. Must have both first and last name
  if (!firstName || !lastName || firstName.trim() === '' || lastName.trim() === '') {
    return false;
  }

  // 2. Reject names that are too short (likely incomplete)
  if (firstName.length < 2 || lastName.length < 2) {
    return false;
  }

  // 3. Reject if name matches or contains company name (case-insensitive)
  // This catches "Goldman Sachs" being parsed as a person name
  // Normalize whitespace for better matching
  const companyLower = company.toLowerCase().replace(/\s+/g, ' ').trim();
  const fullNameLower = fullName.toLowerCase().replace(/\s+/g, ' ').trim();
  
  // Check for exact match or substring match
  if (fullNameLower === companyLower || 
      fullNameLower.includes(companyLower) || 
      companyLower.includes(fullNameLower)) {
    return false;
  }

  // 4. Reject if name contains email address pattern (like "10ksb_voices@gs.com")
  const emailPattern = /@|\.(com|org|net|edu|gov|io|co)/i;
  if (emailPattern.test(fullName)) {
    return false;
  }

  // 5. Reject common non-person patterns (but NOT "no email" - that's just status info)
  const invalidPatterns = [
    /^n\/a$/i,
    /^unknown$/i,
    /^tbd$/i,
    /^company$/i,
    /^department$/i,
    /^team$/i,
    /^group$/i,
    /^review$/i,
    /^verified$/i,
  ];
  if (invalidPatterns.some(pattern => pattern.test(fullName))) {
    return false;
  }

  // 6. Reject if name starts with common words (like "from", "the", etc.)
  // This catches "From Goldman" where "From" is a common word
  const commonWords = ['from', 'the', 'and', 'or', 'at', 'in', 'on', 'to', 'for'];
  const nameWords = fullName.toLowerCase().split(/\s+/);
  // Check if first word is a common word
  if (nameWords.length > 0 && commonWords.includes(nameWords[0])) {
    return false;
  }
  // Also check if it's a single common word
  if (nameWords.length === 1 && commonWords.includes(nameWords[0])) {
    return false;
  }

  // 7. Reject if name contains only numbers or special characters
  if (!/[a-zA-Z]/.test(fullName)) {
    return false;
  }

  // 8. Reject if name looks like it's just a fragment (starts with lowercase)
  // This catches things like "rom Goldman" where "rom" is a fragment
  const firstWord = fullName.split(/\s+/)[0];
  if (firstWord && firstWord[0] && firstWord[0] === firstWord[0].toLowerCase()) {
    // Exception: Allow if it's a valid name that happens to start lowercase in context
    // But reject if it's clearly a fragment (very short)
    if (firstWord.length < 3) {
      return false;
    }
  }

  return true;
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

  // Split queries into batches of 3 for controlled concurrency
  const BATCH_SIZE = 3;
  const batches: string[][] = [];
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    batches.push(queries.slice(i, i + BATCH_SIZE));
  }

  // Process batches sequentially, queries within batch in parallel
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    if (candidates.length >= limit) break;

    const batch = batches[batchIndex];

    // Execute all queries in batch concurrently
    const batchResults = await Promise.all(
      batch.map(query => searchCSE(query))
    );

    // Process results from all queries in the batch
    for (const results of batchResults) {
      if (candidates.length >= limit) break;

      for (const result of results) {
        if (candidates.length >= limit) break;

        const parsed = parseCandidate(result, company);
        if (!parsed) continue;

        // Validate that the parsed name is actually a valid person name
        if (!isValidPersonName(parsed, company)) {
          console.log(`[Discovery] Skipping invalid person name: ${parsed.fullName}`);
          continue;
        }

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
    }

    // Rate limiting between batches (not after last batch or if limit reached)
    if (candidates.length < limit && batchIndex < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return candidates;
}
