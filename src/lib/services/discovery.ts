import prisma from '@/lib/prisma';

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

export async function runDiscovery(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const { school, company, roleKeywords } = campaign;

  // Generate multiple queries to reach ~30 candidates
  const queries = [
    `${school} ${company} ${roleKeywords[0] || 'analyst'}`,
    `"${school}" "${company}" alumni`,
    `${company} "${school}" analyst`,
    `site:linkedin.com "${school}" "${company}"`,
    `"${school}" alumni ${company} ${roleKeywords[1] || 'associate'}`,
    `${school} ${company} finance`,
  ];

  const seenKeys = new Set<string>();
  const candidates: Array<{
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    company: string;
    role: string | null;
    sourceUrl: string;
    sourceTitle: string;
    sourceSnippet: string;
    sourceDomain: string;
  }> = [];

  let progress = 0;
  const totalQueries = queries.length;

  for (const query of queries) {
    const results = await searchCSE(query);

    for (const result of results) {
      const parsed = parseCandidate(result, company);
      if (!parsed) continue;

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

      if (candidates.length >= 30) break;
    }

    progress++;
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { discoveryProgress: Math.round((progress / totalQueries) * 100) },
    });

    if (candidates.length >= 30) break;

    // Rate limiting between queries
    await new Promise((r) => setTimeout(r, 200));
  }

  // Store candidates and source links
  for (const candidate of candidates) {
    try {
      const created = await prisma.candidate.create({
        data: {
          campaignId,
          fullName: candidate.fullName,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          company: candidate.company,
          role: candidate.role,
          emailStatus: 'MISSING',
          sourceLinks: {
            create: {
              kind: 'DISCOVERY',
              url: candidate.sourceUrl,
              title: candidate.sourceTitle,
              snippet: candidate.sourceSnippet,
              domain: candidate.sourceDomain,
            },
          },
        },
      });

      // Create initial email draft
      const subject = campaign.templateSubject
        .replace(/{first_name}/g, candidate.firstName || 'there')
        .replace(/{company}/g, company)
        .replace(/{school}/g, school);

      const body = campaign.templateBody
        .replace(/{first_name}/g, candidate.firstName || 'there')
        .replace(/{company}/g, company)
        .replace(/{school}/g, school);

      await prisma.emailDraft.create({
        data: {
          candidateId: created.id,
          subject,
          body,
        },
      });
    } catch (error) {
      // Skip duplicates
      if ((error as { code?: string }).code !== 'P2002') {
        console.error('Error creating candidate:', error);
      }
    }
  }

  // Update campaign status
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: 'DISCOVERED',
      discoveryProgress: 100,
    },
  });

  return candidates.length;
}
