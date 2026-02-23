/* Company Research Service — disabled (too general for personalization)
 * Kept commented out for potential future restoration.
 *
 * Uses Perplexity Sonar API for real-time web search + summarization
 * to find specific, referenceable talking points about a company.
 * Falls back to Groq training knowledge if Perplexity is unavailable.

import { completeJson } from '@/lib/services/groq';

// --- Types ---

export interface TalkingPoint {
  point: string;
  source: string;
  sourceUrl: string;
}

export interface CompanyResearchResult {
  company: string;
  talkingPoints: TalkingPoint[];
  fromCache: boolean;
}

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
  search_results?: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

// --- Helpers ---

export function inferDepartment(role: string): string {
  const r = role.toLowerCase();
  if (/engineer|developer|swe|sde|devops|infrastructure|backend|frontend|fullstack|full-stack/.test(r)) return 'engineering';
  if (/product manager|pm|product lead|product director/.test(r)) return 'product';
  if (/design|ux|ui|creative/.test(r)) return 'design';
  if (/market|growth|brand|content|seo|communications/.test(r)) return 'marketing';
  if (/sales|account exec|business dev|bd|partnerships/.test(r)) return 'sales';
  if (/finance|accounting|controller|treasury|cfo|financial/.test(r)) return 'finance';
  if (/data|analytics|machine learning|ml\b|ai\b|scientist/.test(r)) return 'data and AI';
  if (/recruit|talent|people|hr|human resource/.test(r)) return 'people and talent';
  if (/consult|advisory|strateg/.test(r)) return 'consulting';
  if (/legal|counsel|compliance/.test(r)) return 'legal';
  if (/operations|ops|supply chain|logistics/.test(r)) return 'operations';
  return 'general';
}

function buildPrompt(company: string, role?: string, personName?: string): string {
  const department = role ? inferDepartment(role) : null;
  const departmentBias = department && department !== 'general'
    ? `\nThe recipient's role is "${role}" — focus on what the ${department} side of the company has been doing, but include major company-wide news too.`
    : '';

  return `You are researching a company to help a college student write a personalized coffee chat email. Find specific, recent, and referenceable information.

Company: ${company}${departmentBias}${personName ? `\nRecipient name: ${personName}` : ''}

Return 3-5 talking points as JSON: { "talkingPoints": [...] }
Each should be specific enough to reference in a short email (not generic like "Fortune 500 company"). Prioritize:
1. Recent product launches, features, or announcements
2. Partnerships, acquisitions, or expansions
3. Team achievements, awards, or milestones
4. Notable company culture or values initiatives

For each talking point include:
- "point": one specific sentence (e.g., "Launched an AI-powered fraud detection tool in Q1 2026")
- "source": publication name (e.g., "TechCrunch")
- "sourceUrl": the URL where this was reported`;
}

// --- Perplexity API ---

async function callPerplexity(prompt: string): Promise<{ talkingPoints: TalkingPoint[]; rawResponse: string }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY not configured');
  }

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
      max_tokens: 600,
      search_recency_filter: 'year',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[CompanyResearch] Perplexity API error:', response.status, errorText);
    throw new Error(`Perplexity API error: ${response.status}`);
  }

  const data: PerplexityResponse = await response.json();
  const rawContent = data.choices[0]?.message?.content || '';
  const citations = data.citations || [];

  // Parse JSON from response (may be wrapped in markdown code blocks)
  let parsed: { talkingPoints?: TalkingPoint[] };
  try {
    const jsonStr = rawContent.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error('[CompanyResearch] Failed to parse Perplexity response as JSON:', rawContent);
    throw new Error('Failed to parse research results');
  }

  // Enrich sourceUrls from citations if they're missing or generic
  const talkingPoints = (parsed.talkingPoints || []).map((tp) => ({
    point: tp.point || '',
    source: tp.source || '',
    sourceUrl: tp.sourceUrl || citations[0] || '',
  })).filter(tp => tp.point.trim() !== '');

  return { talkingPoints, rawResponse: rawContent };
}

// --- Groq Fallback ---

async function callGroqFallback(prompt: string): Promise<{ talkingPoints: TalkingPoint[]; rawResponse: string }> {
  const response = await completeJson<{ talkingPoints: TalkingPoint[] }>({
    systemPrompt: 'You are a research assistant. Return results as valid JSON only. Since you may not have the very latest information, focus on well-known facts and recent-ish developments you are confident about.',
    userPrompt: prompt,
    options: {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
      maxTokens: 600,
    },
  });

  const talkingPoints = (response.content.talkingPoints || []).map((tp) => ({
    point: tp.point || '',
    source: tp.source || 'General knowledge',
    sourceUrl: tp.sourceUrl || '',
  })).filter(tp => tp.point.trim() !== '');

  return { talkingPoints, rawResponse: JSON.stringify(response.content) };
}

// --- Main Entry Point ---

export async function researchCompany(
  company: string,
  role?: string,
  personName?: string,
): Promise<{ talkingPoints: TalkingPoint[]; rawResponse: string }> {
  const prompt = buildPrompt(company, role, personName);

  // Try Perplexity first, fall back to Groq
  try {
    return await callPerplexity(prompt);
  } catch (error) {
    console.warn('[CompanyResearch] Perplexity failed, falling back to Groq:', error);
    try {
      return await callGroqFallback(prompt);
    } catch (groqError) {
      console.error('[CompanyResearch] Groq fallback also failed:', groqError);
      return { talkingPoints: [], rawResponse: '' };
    }
  }
}

*/
