import Groq from 'groq-sdk';
import prisma from '@/lib/prisma';
import { ResumeSummary } from './resume-summary';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export interface LinkedInData {
  about: string | null;
  education: Array<{
    school: string | null;
    degree: string | null;
    field: string | null;
    dates: string | null;
    activities: string | null;
    description: string | null;
  }>;
  scrapedAt: string;
}

export interface PersonalizationInput {
  linkedinData: LinkedInData;
  originalSubject: string;
  originalBody: string;
  personName: string;
  personCompany: string;
  personRole?: string;
  senderName: string;
  userId: string;
}

export interface PersonalizationResult {
  subject: string;
  body: string;
  similarityFound: boolean;
  changes?: string[];      // What was changed (if similarity found)
  foundInfo?: string[];    // Info about recipient (if no similarity found)
}

/**
 * Get the user's active resume summary
 */
async function getUserResumeSummary(userId: string): Promise<ResumeSummary | null> {
  const activeResume = await prisma.userResume.findFirst({
    where: {
      userId,
      isActive: true,
      summary: { not: null },
    },
    select: { summary: true },
  });

  if (!activeResume?.summary) {
    return null;
  }

  try {
    return JSON.parse(activeResume.summary) as ResumeSummary;
  } catch {
    return null;
  }
}

export async function personalizeEmail(
  input: PersonalizationInput
): Promise<PersonalizationResult> {
  const {
    linkedinData,
    originalSubject,
    originalBody,
    personName,
    personCompany,
    personRole,
    senderName,
    userId,
  } = input;

  // Get user's resume summary for finding similarities
  const userSummary = await getUserResumeSummary(userId);

  // Build context from LinkedIn data
  const linkedinContext = buildLinkedInContext(linkedinData);
  const userContext = userSummary ? buildUserContext(userSummary) : null;

  const prompt = `You are a college student personalizing a cold outreach email. Add ONE brief mention of a shared connection if one exists.

RECIPIENT:
${personName} at ${personCompany}${personRole ? ` (${personRole})` : ''}
${linkedinContext}

${userContext ? `SENDER (${senderName}):
${userContext}` : ''}

ORIGINAL EMAIL:
Subject: ${originalSubject}
Body:
${originalBody}

RULES:
1. Look for ONE similarity in this priority order: shared organization > shared activity > shared interest
2. If found, add ONE natural sentence mentioning it (e.g., "I'm also involved in [org]" or "I noticed we both [activity]")
3. DO NOT rewrite the email - only insert the similarity mention where it fits naturally
4. Keep the original subject line unless the similarity makes a better hook
5. NO phrases like "I came across your profile" or "I was excited to see"
6. Sound like a real college student - casual but respectful, not overly polished or enthusiastic
7. If no similarity exists, return the original email unchanged

TONE: Write like a busy college student sending a quick email - genuine, direct, slightly informal. Avoid corporate speak, excessive flattery, or anything that sounds AI-generated.

Return in this EXACT format:

SIMILARITY_FOUND: [yes/no]
CHANGES: [if yes, list what you added/changed, e.g., "Added mention of shared involvement in Finance Club"]
FOUND_INFO: [list 2-4 notable things about the recipient from their profile, e.g., "Member of Delta Sigma Pi | Did case competitions | Interested in fintech"]
SUBJECT: [subject line]
BODY:
[email body]`;

  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.7,
    max_tokens: 400, // Reduced for speed
  });

  const response = completion.choices[0]?.message?.content || '';

  // Parse the response
  const similarityMatch = response.match(/SIMILARITY_FOUND:\s*(yes|no)/i);
  const changesMatch = response.match(/CHANGES:\s*([^\n]+)/);
  const foundInfoMatch = response.match(/FOUND_INFO:\s*([^\n]+)/);
  const subjectMatch = response.match(/SUBJECT:\s*([^\n]+)/);
  const bodyMatch = response.match(/BODY:\s*([\s\S]+)$/);

  const similarityFound = similarityMatch?.[1]?.toLowerCase() === 'yes';
  const personalizedSubject = subjectMatch?.[1]?.trim() || originalSubject;
  const personalizedBody = bodyMatch?.[1]?.trim() || originalBody;

  // Parse changes (split by comma or pipe)
  const changes = changesMatch?.[1]?.trim()
    ? changesMatch[1].split(/[,|]/).map(s => s.trim()).filter(Boolean)
    : undefined;

  // Parse found info (split by pipe)
  const foundInfo = foundInfoMatch?.[1]?.trim()
    ? foundInfoMatch[1].split('|').map(s => s.trim()).filter(Boolean)
    : undefined;

  return {
    subject: personalizedSubject,
    body: personalizedBody,
    similarityFound,
    changes: similarityFound ? changes : undefined,
    foundInfo: !similarityFound ? foundInfo : undefined,
  };
}

function buildLinkedInContext(data: LinkedInData): string {
  const parts: string[] = [];

  if (data.about) {
    parts.push(`About: ${data.about.slice(0, 500)}`);
  }

  if (data.education && data.education.length > 0) {
    const eduParts: string[] = [];
    for (const edu of data.education.slice(0, 2)) { // Limit to 2 for speed
      const lines: string[] = [];
      if (edu.school) lines.push(edu.school);
      if (edu.activities) lines.push(`Activities: ${edu.activities}`);
      if (lines.length > 0) eduParts.push(lines.join(' - '));
    }
    if (eduParts.length > 0) {
      parts.push(`Education: ${eduParts.join('; ')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : 'No profile data available';
}

function buildUserContext(summary: ResumeSummary): string {
  const parts: string[] = [];

  if (summary.organizations?.length > 0) {
    parts.push(`Organizations: ${summary.organizations.slice(0, 5).join(', ')}`);
  }
  if (summary.activities?.length > 0) {
    parts.push(`Activities: ${summary.activities.slice(0, 5).join(', ')}`);
  }
  if (summary.interests?.length > 0) {
    parts.push(`Interests: ${summary.interests.slice(0, 5).join(', ')}`);
  }
  if (summary.rawSummary) {
    parts.push(`Background: ${summary.rawSummary}`);
  }

  return parts.join('\n');
}

export interface UseFoundInfoInput {
  foundInfo: string[];
  originalSubject: string;
  originalBody: string;
  personName: string;
  personCompany: string;
  personRole?: string;
  senderName: string;
}

export interface UseFoundInfoResult {
  subject: string;
  body: string;
  changes?: string[];
}

/**
 * Personalize email using the found info about the recipient (when no similarity was found initially)
 */
export async function personalizeWithFoundInfo(
  input: UseFoundInfoInput
): Promise<UseFoundInfoResult> {
  const {
    foundInfo,
    originalSubject,
    originalBody,
    personName,
    personCompany,
    personRole,
    senderName,
  } = input;

  const prompt = `You are a college student personalizing a cold outreach email. Use the info provided about the recipient to add a personal touch.

RECIPIENT:
${personName} at ${personCompany}${personRole ? ` (${personRole})` : ''}
Notable info: ${foundInfo.join(', ')}

ORIGINAL EMAIL:
Subject: ${originalSubject}
Body:
${originalBody}

RULES:
1. Pick the most interesting/relevant piece of info about them
2. Add ONE natural sentence that shows you noticed this about them (e.g., "I saw you were involved in [X] - that's really cool" or "Your work with [Y] caught my attention")
3. DO NOT rewrite the whole email - only add that one touch
4. Keep the original subject line unless the info makes a better hook
5. Sound like a real college student - casual but respectful
6. NO corporate speak or excessive enthusiasm

TONE: Genuine, direct, slightly informal. Like a college student who did a quick bit of research.

Return in this EXACT format:

CHANGES: [what you added, e.g., "Added mention of their case competition experience"]
SUBJECT: [subject line]
BODY:
[email body]`;

  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.7,
    max_tokens: 400,
  });

  const response = completion.choices[0]?.message?.content || '';

  // Parse the response
  const changesMatch = response.match(/CHANGES:\s*([^\n]+)/);
  const subjectMatch = response.match(/SUBJECT:\s*([^\n]+)/);
  const bodyMatch = response.match(/BODY:\s*([\s\S]+)$/);

  const personalizedSubject = subjectMatch?.[1]?.trim() || originalSubject;
  const personalizedBody = bodyMatch?.[1]?.trim() || originalBody;
  const changes = changesMatch?.[1]?.trim()
    ? changesMatch[1].split(/[,|]/).map(s => s.trim()).filter(Boolean)
    : undefined;

  return {
    subject: personalizedSubject,
    body: personalizedBody,
    changes,
  };
}
