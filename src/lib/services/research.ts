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
    return [];
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '5');

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      return [];
    }
    const data: CSEResponse = await response.json();
    return data.items || [];
  } catch {
    return [];
  }
}

export async function runResearch(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { campaign: true },
  });

  if (!candidate) {
    throw new Error('Candidate not found');
  }

  const { fullName, company } = candidate;

  // Generate research queries
  const queries = [
    `"${fullName}" ${company}`,
    `"${fullName}" ${company} hometown`,
  ];

  const seenUrls = new Set<string>();
  const links: Array<{
    url: string;
    title: string;
    snippet: string;
    domain: string;
  }> = [];

  for (const query of queries) {
    const results = await searchCSE(query);

    for (const result of results) {
      if (seenUrls.has(result.link)) continue;
      seenUrls.add(result.link);

      links.push({
        url: result.link,
        title: result.title,
        snippet: result.snippet,
        domain: result.displayLink,
      });

      if (links.length >= 5) break;
    }

    if (links.length >= 5) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Store research links
  for (const link of links) {
    await prisma.sourceLink.create({
      data: {
        candidateId,
        kind: 'RESEARCH',
        url: link.url,
        title: link.title,
        snippet: link.snippet,
        domain: link.domain,
      },
    });
  }

  return links.length;
}
