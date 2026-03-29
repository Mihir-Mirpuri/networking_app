import prisma from '@/lib/prisma';
import { completeJsonAnthropic } from '@/lib/services/anthropic';
import { GroqAction } from '@prisma/client';
import { searchSerper } from '@/lib/services/serper';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersonInsightData {
  label: string;
  detail: string;
  type: 'career' | 'education' | 'project' | 'achievement' | 'interest';
  source: 'linkedin' | 'google' | 'website' | 'database';
  confidence: 'high' | 'medium';
  sourceUrl?: string;
}

interface InsightsLLMResponse {
  insights: PersonInsightData[];
}

export interface PersonInsightsResult {
  insights: Array<PersonInsightData & { id: string; sourceUrl?: string }>;
  fromCache: boolean;
}

const CACHE_TTL_DAYS = 30;

// ─── Main Function ────────────────────────────────────────────────────────────

export async function getOrExtractInsights(
  personId: string,
  userId?: string
): Promise<PersonInsightsResult> {
  // 1. Check cache
  const cached = await prisma.personInsight.findMany({
    where: { personId },
    orderBy: { extractedAt: 'desc' },
  });

  if (cached.length > 0) {
    const mostRecent = cached[0].extractedAt;
    const ageMs = Date.now() - mostRecent.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays < CACHE_TTL_DAYS) {
      return {
        insights: cached.map((c) => ({
          id: c.id,
          label: c.label,
          detail: c.detail,
          type: c.type as PersonInsightData['type'],
          source: c.source as PersonInsightData['source'],
          confidence: c.confidence as PersonInsightData['confidence'],
          sourceUrl: c.sourceUrl ?? undefined,
        })),
        fromCache: true,
      };
    }
  }

  // 2. Gather data from DB
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      fullName: true,
      firstName: true,
      lastName: true,
      company: true,
      role: true,
      linkedinUrl: true,
      city: true,
      state: true,
      country: true,
      educationSchool: true,
      educationDegree: true,
      educationField: true,
      educationYear: true,
      schools: true,
      experienceHistory: true,
      educationHistory: true,
      sourceLinks: {
        select: { title: true, snippet: true, domain: true, url: true },
        take: 10,
      },
    },
  });

  if (!person) {
    return { insights: [], fromCache: false };
  }

  // 3. Google search via Serper — two parallel queries for better coverage:
  //    - Name only: catches personal pages for unique names
  //    - Name + company: disambiguates common names
  let serperSnippets = '';
  let serperResults: Array<{ title: string; link: string; snippet: string }> = [];
  try {
    const [nameResults, nameCompanyResults] = await Promise.all([
      searchSerper(`"${person.fullName}"`),
      searchSerper(`"${person.fullName}" "${person.company}"`),
    ]);

    // Merge and dedupe by URL
    const seen = new Set<string>();
    const merged: typeof serperResults = [];
    for (const r of [...nameResults, ...nameCompanyResults]) {
      if (!seen.has(r.link)) {
        seen.add(r.link);
        merged.push({ title: r.title, link: r.link, snippet: r.snippet });
      }
    }
    serperResults = merged.slice(0, 15);
    serperSnippets = serperResults
      .map((r) => `- [${r.link}] ${r.title}: ${r.snippet}`)
      .join('\n');
  } catch (err) {
    console.error('[person-insights] Serper search failed:', err);
  }

  // 4. Build context from DB fields
  const dbContext = buildDbContext(person);
  const sourceLinksText = person.sourceLinks
    .filter((s) => s.snippet)
    .map((s) => `- [${s.url}] ${s.title}: ${s.snippet}`)
    .join('\n');

  // 5. LLM extraction
  try {
    const systemPrompt = `You are a research assistant helping craft personalized cold emails.

You have been given raw text from multiple sources about a specific person.
Their confirmed identity is: Name: ${person.fullName}, Company: ${person.company}, Title: ${person.role || 'Unknown'}.

IMPORTANT: The user can already see the following on the person's card: their name (${person.fullName}), company (${person.company}), role (${person.role || 'Unknown'}), and school (${person.educationSchool || 'Unknown'}). Do NOT return insights that merely restate this information — for example, "works at ${person.company}", "attended ${person.educationSchool}", or "is a ${person.role}". Only include facts that go beyond what is already visible on the card.

Your job:
1. Discard any content that is clearly not about this specific person.
2. From the remaining content, extract interesting facts that would be useful for personalizing a cold email, including:
   - PAST WORK EXPERIENCE: Previous companies, roles, career pivots, industry transitions, or interesting career paths (e.g., "Previously worked at Google before joining a startup", "Started career in investment banking before moving to tech")
   - Personal interests, hobbies, sports, music, clubs, fraternity/sorority membership, volunteer work
   - Projects, professional wins, published work, speaking engagements
   - Anything that signals what they care about beyond their current job title
3. For each fact, assign a confidence score (high/medium) that it refers to the correct person. Discard anything low confidence.
4. Do NOT include generic facts like "works at ${person.company}" or "has a LinkedIn profile".
5. Exclude any insight that is redundant with what the user already sees: their current name, company, role, or school. Only surface information that adds NEW value. However, PAST roles and companies ARE valuable — only the CURRENT role/company is redundant.
6. EXCLUDE vanity metrics and platform statistics that provide no personalization value:
   - LinkedIn connection counts ("500+ connections")
   - Follower/following counts on any platform
   - Number of posts, likes, comments, or endorsements
   - Profile view statistics
   - Account creation dates or "years on platform"
   - Generic profile badges
7. Litmus test: Ask yourself "Could I reference this in an email without sounding creepy or generic?" If no, discard it. "I saw you have 500 connections" = useless. "I noticed you worked at McKinsey before joining tech" = good conversation hook.
8. Return ALL specific, interesting facts you can find. Do not limit the number — extract every valuable piece of information.

Return ONLY a JSON object with this format:
{
  "insights": [
    {
      "label": "Short human-readable fact (max 12 words)",
      "detail": "One sentence elaboration",
      "type": "career | education | project | achievement | interest",
      "source": "linkedin | google | website | database",
      "confidence": "high | medium",
      "sourceUrl": "The URL where you found this fact, or null if from database"
    }
  ]
}`;

    const userPrompt = `Profile data:
${dbContext}

Discovery/LinkedIn snippets:
${sourceLinksText || '(none)'}

Google search results:
${serperSnippets || '(none)'}`;

    const response = await completeJsonAnthropic<InsightsLLMResponse>({
      systemPrompt,
      userPrompt,
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.3,
      maxTokens: 1500,
      metadata: {
        userId,
        action: GroqAction.PERSON_INSIGHT_EXTRACTION,
      },
    });

    const extractedInsights = response.content.insights || [];

    // 6. Persist to DB
    if (extractedInsights.length > 0) {
      await prisma.$transaction([
        prisma.personInsight.deleteMany({ where: { personId } }),
        prisma.personInsight.createMany({
          data: extractedInsights.map((i) => ({
            personId,
            label: i.label,
            detail: i.detail,
            type: i.type,
            source: i.source,
            confidence: i.confidence,
            sourceUrl: i.sourceUrl || null,
          })),
        }),
      ]);

      // Fetch back to get generated IDs
      const saved = await prisma.personInsight.findMany({
        where: { personId },
        orderBy: { extractedAt: 'desc' },
      });

      return {
        insights: saved.map((s) => ({
          id: s.id,
          label: s.label,
          detail: s.detail,
          type: s.type as PersonInsightData['type'],
          source: s.source as PersonInsightData['source'],
          confidence: s.confidence as PersonInsightData['confidence'],
          sourceUrl: s.sourceUrl ?? undefined,
        })),
        fromCache: false,
      };
    }

    return { insights: [], fromCache: false };
  } catch (err) {
    console.error('[person-insights] LLM extraction failed:', err);
    return { insights: [], fromCache: false };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ExperienceEntry {
  position: string | null;
  companyName: string | null;
  location: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface EducationEntry {
  schoolName: string;
  degree: string | null;
  fieldOfStudy: string | null;
  description: string | null;
  activities: string | null;
  startDate: string | null;
  endDate: string | null;
  grade: string | null;
}

function buildDbContext(person: {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  educationSchool: string | null;
  educationDegree: string | null;
  educationField: string | null;
  educationYear: string | null;
  schools: unknown;
  experienceHistory: unknown;
  educationHistory: unknown;
}): string {
  const lines: string[] = [];
  lines.push(`Name: ${person.fullName}`);
  lines.push(`Company: ${person.company}`);
  if (person.role) lines.push(`Current role: ${person.role}`);
  if (person.linkedinUrl) lines.push(`LinkedIn: ${person.linkedinUrl}`);

  const location = [person.city, person.state, person.country].filter(Boolean).join(', ');
  if (location) lines.push(`Location: ${location}`);

  // Full work history from LinkedIn
  if (Array.isArray(person.experienceHistory) && person.experienceHistory.length > 0) {
    const expEntries = person.experienceHistory as ExperienceEntry[];
    lines.push('');
    lines.push('Work experience:');
    for (const exp of expEntries) {
      const header = [exp.position, exp.companyName, exp.location].filter(Boolean);
      if (header.length > 0) {
        const dates = [exp.startDate, exp.endDate].filter(Boolean).join(' – ');
        lines.push(`- ${header.join(' at ')}${dates ? ` (${dates})` : ''}`);
        if (exp.description) lines.push(`  ${exp.description}`);
      }
    }
  }

  // Full education from LinkedIn
  if (Array.isArray(person.educationHistory) && person.educationHistory.length > 0) {
    const eduEntries = person.educationHistory as EducationEntry[];
    lines.push('');
    lines.push('Education:');
    for (const edu of eduEntries) {
      let entry = edu.schoolName;
      if (edu.degree) entry += `, ${edu.degree}`;
      if (edu.fieldOfStudy) entry += ` in ${edu.fieldOfStudy}`;
      const dates = [edu.startDate, edu.endDate].filter(Boolean).join(' – ');
      if (dates) entry += ` (${dates})`;
      if (edu.grade) entry += ` | GPA: ${edu.grade}`;
      lines.push(`- ${entry}`);
      if (edu.activities) lines.push(`  Activities: ${edu.activities}`);
      if (edu.description) lines.push(`  ${edu.description}`);
    }
  } else if (person.educationSchool) {
    let edu = `Education: ${person.educationSchool}`;
    if (person.educationDegree) edu += `, ${person.educationDegree}`;
    if (person.educationField) edu += ` in ${person.educationField}`;
    if (person.educationYear) edu += ` (${person.educationYear})`;
    lines.push(edu);
  }

  if (Array.isArray(person.schools) && person.schools.length > 1) {
    lines.push(`All schools: ${(person.schools as string[]).join(', ')}`);
  }

  return lines.join('\n');
}
