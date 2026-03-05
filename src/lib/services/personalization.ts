import prisma from '@/lib/prisma';
import { ResumeSummary } from './resume-summary';
import { complete } from '@/lib/services/groq';

// ===== LLM Email Generation =====

export interface SentEmailExample {
  subject: string;
  body: string;
}

export interface LLMEmailInput {
  person: {
    firstName: string | null;
    lastName: string | null;
    company: string;
    role: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    educationSchool: string | null;
    educationDegree: string | null;
    educationField: string | null;
  };
  user: {
    name: string | null;
    university: string | null;
    classification: string | null;
    major: string | null;
    career: string | null;
  };
  resumeSummary: ResumeSummary | null;
  referenceTemplate: { subject: string; body: string };
  sentEmailExamples?: SentEmailExample[];
  customInstructions?: string;
  userId?: string;
}

/**
 * Get the 3 most recent successful sent emails for a user.
 * Returns empty array if fewer than 3 (not representative enough for style matching).
 */
export async function getRecentSentEmails(userId: string): Promise<SentEmailExample[]> {
  const logs = await prisma.sendLog.findMany({
    where: { userId, status: 'SUCCESS' },
    orderBy: { sentAt: 'desc' },
    take: 3,
    select: { subject: true, body: true },
  });

  if (logs.length < 3) return [];

  return logs.map((log) => ({ subject: log.subject, body: log.body }));
}

/**
 * Generate a personalized email draft using Groq LLM.
 * The referenceTemplate should have placeholders already filled in so the LLM
 * sees a concrete example, not raw {first_name} tokens.
 * Throws on parse failure so the caller can fall back to the placeholder draft.
 */
export async function generateEmailWithLLM(
  input: LLMEmailInput
): Promise<{ subject: string; body: string }> {
  const { person, user, resumeSummary, referenceTemplate, sentEmailExamples, customInstructions, userId } = input;

  const personName = [person.firstName, person.lastName].filter(Boolean).join(' ') || 'the recipient';
  const location = [person.city, person.state, person.country].filter(Boolean).join(', ');
  const education = [
    person.educationSchool,
    person.educationDegree,
    person.educationField,
  ].filter(Boolean).join(', ');

  const userContext = resumeSummary ? buildUserContext(resumeSummary) : '';

  let systemPrompt = `You are a college student writing a cold outreach email to a professional. Write a short, direct email.

STRUCTURE (follow this exactly):
- Line 1: "Hello {first_name},"
- Blank line
- Paragraph 1 (2-3 sentences): Introduce yourself (name, year, school, major) and state your interest. Ask for a specific time (e.g., "10-15 minutes on the phone").
- Blank line
- Paragraph 2 (1 sentence): Mention you've attached your resume for context.
- Blank line
- Sign-off: "Warm regards,\\n{sender_name}"

RULES:
1. EXACTLY 2 short paragraphs in the body — no more
2. Be direct and straight to the point — every sentence must serve a purpose
3. NO filler phrases: "I hope this email finds you well", "I came across your profile", "I was excited to see", "I would be thrilled", "I am reaching out because"
4. Sound like a real college student — casual but respectful, not overly polished or enthusiastic
5. Each email should be unique — vary how you express interest based on the recipient's role/company
6. Use paragraph breaks (blank lines) between paragraphs — do NOT write a wall of text`;

  if (sentEmailExamples && sentEmailExamples.length > 0) {
    systemPrompt += `\n7. If example emails from the sender are provided, match their writing style closely`;
  }

  systemPrompt += `

Return in this EXACT format:

SUBJECT: [subject line]
BODY:
[email body]`;

  let userPrompt = `RECIPIENT:
${personName}${person.role ? `, ${person.role}` : ''} at ${person.company}`;

  if (location) {
    userPrompt += `\nLocation: ${location}`;
  }
  if (education) {
    userPrompt += `\nEducation: ${education}`;
  }

  userPrompt += `\n\nSENDER:
${user.name || 'A student'}`;
  if (user.university) userPrompt += `, ${user.university}`;
  if (user.classification) userPrompt += ` (${user.classification})`;
  if (user.major) userPrompt += `\nMajor: ${user.major}`;
  if (userContext) userPrompt += `\n${userContext}`;

  if (customInstructions) {
    userPrompt += `\n\nCUSTOM INSTRUCTIONS FROM SENDER (follow these closely):\n${customInstructions}`;
  }

  if (sentEmailExamples && sentEmailExamples.length > 0) {
    userPrompt += `\n\nYOUR PREVIOUSLY SENT EMAILS (match this writing style closely):`;
    sentEmailExamples.forEach((ex, i) => {
      userPrompt += `\n\nEmail ${i + 1}:\nSubject: ${ex.subject}\nBody:\n${ex.body}`;
    });
  }

  userPrompt += `\n\nREFERENCE EMAIL (use as a guide for tone and structure, but write a unique, personalized email for this specific recipient — do not copy it verbatim):
Subject: ${referenceTemplate.subject}
Body:
${referenceTemplate.body}`;

  const response = await complete({
    systemPrompt,
    userPrompt,
    options: {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      maxTokens: 300,
    },
    metadata: { userId, action: 'EMAIL_GENERATION' },
  });

  const text = response.content;
  const subjectMatch = text.match(/SUBJECT:\s*([^\n]+)/);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)$/);

  if (!subjectMatch || !bodyMatch) {
    throw new Error('Failed to parse LLM email response');
  }

  return {
    subject: subjectMatch[1].trim(),
    body: bodyMatch[1].trim(),
  };
}

// ===== Chat-Based Email Refinement =====

export interface RefineEmailInput {
  subject: string;
  body: string;
  instruction: string;
  person: {
    firstName: string | null;
    company: string;
    role: string | null;
  };
  userId?: string;
}

/**
 * Refine an existing email draft based on a user instruction.
 * Each call is standalone — no chat history, just current email + instruction.
 */
export async function refineEmailWithLLM(
  input: RefineEmailInput
): Promise<{ subject: string; body: string }> {
  const { subject, body, instruction, person } = input;

  const personName = person.firstName || 'the recipient';

  const systemPrompt = `You are helping a college student refine a cold outreach email. Apply ONLY the requested change. Keep everything else the same — same greeting, same sign-off, same structure unless the instruction explicitly asks to change it.

Return in this EXACT format:

SUBJECT: [subject line]
BODY:
[email body]`;

  const userPrompt = `CURRENT EMAIL:
Subject: ${subject}
Body:
${body}

RECIPIENT: ${personName}${person.role ? `, ${person.role}` : ''} at ${person.company}

REQUESTED CHANGE: ${instruction}`;

  const response = await complete({
    systemPrompt,
    userPrompt,
    options: {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
      maxTokens: 300,
    },
    metadata: { userId: input.userId, action: 'EMAIL_REFINEMENT' },
  });

  const text = response.content;
  const subjectMatch = text.match(/SUBJECT:\s*([^\n]+)/);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)$/);

  if (!subjectMatch || !bodyMatch) {
    throw new Error('Failed to parse LLM refinement response');
  }

  return {
    subject: subjectMatch[1].trim(),
    body: bodyMatch[1].trim(),
  };
}

// ===== LinkedIn Personalization (existing) =====

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
export async function getUserResumeSummary(userId: string): Promise<ResumeSummary | null> {
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

  const completion = await complete({
    userPrompt: prompt,
    options: {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      maxTokens: 400,
    },
    metadata: { userId, action: 'PERSONALIZATION' },
  });

  const response = completion.content;

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
  userId?: string;
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
    userId,
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

  const completion = await complete({
    userPrompt: prompt,
    options: {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      maxTokens: 400,
    },
    metadata: { userId, action: 'PERSONALIZATION_FOUND_INFO' },
  });

  const response = completion.content;

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

export interface FollowUpInput {
  originalSubject: string;
  originalBody: string;
  personName: string;
  personCompany: string;
  personRole?: string;
  senderName: string;
  userId?: string;
}

export interface FollowUpResult {
  subject: string;
  body: string;
}

/**
 * Generate a follow-up email based on the original email sent
 */
export async function generateFollowUpEmail(
  input: FollowUpInput
): Promise<FollowUpResult> {
  const {
    originalSubject,
    originalBody,
    personName,
    personCompany,
    personRole,
    senderName,
    userId,
  } = input;

  const prompt = `You are a college student writing a follow-up email. You previously sent an email to someone and haven't heard back. Write a brief, polite follow-up.

RECIPIENT:
${personName} at ${personCompany}${personRole ? ` (${personRole})` : ''}

YOUR ORIGINAL EMAIL:
Subject: ${originalSubject}
Body:
${originalBody}

RULES:
1. Keep it SHORT - 2-4 sentences max
2. Reference that you reached out before without being pushy
3. Restate your interest briefly
4. Include a clear call to action (e.g., "Would you have 15 minutes for a quick chat?")
5. Sound like a real college student - casual but respectful
6. NO guilt-tripping, no "just checking in", no "bumping this up"
7. NO corporate speak or excessive enthusiasm
8. The subject should be "Re: [original subject]" to maintain the thread

TONE: Genuine, direct, slightly informal. Like a college student who's following up without being annoying.

Return in this EXACT format:

SUBJECT: [subject line - should be "Re: original subject"]
BODY:
[email body - just the follow-up text, no greeting repetition needed]`;

  const completion = await complete({
    userPrompt: prompt,
    options: {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      maxTokens: 300,
    },
    metadata: { userId, action: 'FOLLOW_UP' },
  });

  const response = completion.content;

  // Parse the response
  const subjectMatch = response.match(/SUBJECT:\s*([^\n]+)/);
  const bodyMatch = response.match(/BODY:\s*([\s\S]+)$/);

  const followUpSubject = subjectMatch?.[1]?.trim() || `Re: ${originalSubject}`;
  const followUpBody = bodyMatch?.[1]?.trim() || '';

  return {
    subject: followUpSubject,
    body: followUpBody,
  };
}

// ===== Conversational Email Refinement =====

export interface ConversationalRefineInput {
  subject: string;
  body: string;
  userMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  person: {
    firstName: string | null;
    company: string;
    role: string | null;
  };
  userId: string;
}

export interface ConversationalRefineResult {
  subject: string;
  body: string;
  assistantMessage: string;
}

/**
 * Refine an email through conversational interaction.
 * Maintains conversation context for natural back-and-forth editing.
 * Uses llama-3.1-8b-instant for speed and cost efficiency.
 */
export async function refineEmailConversational(
  input: ConversationalRefineInput
): Promise<ConversationalRefineResult> {
  const { subject, body, userMessage, conversationHistory, person, userId } = input;

  const personName = person.firstName || 'the recipient';

  // Truncate email if too long (cost optimization)
  const truncatedBody = body.length > 1000 ? body.slice(0, 1000) + '...' : body;

  const systemPrompt = `You are an AI assistant helping a college student refine their cold outreach email. You have a natural, conversational style.

CURRENT EMAIL:
Subject: ${subject}
Body:
${truncatedBody}

RECIPIENT: ${personName}${person.role ? `, ${person.role}` : ''} at ${person.company}

YOUR ROLE:
1. Make the requested changes to the email
2. Respond naturally to the user - acknowledge what you changed
3. Keep responses brief but friendly
4. If the request is unclear, ask for clarification
5. Don't over-explain changes - just make them and briefly confirm

IMPORTANT RULES:
- Only modify what the user asks for
- Keep the same greeting and sign-off unless explicitly asked to change
- Sound like a real college student - casual but respectful
- NO corporate speak or excessive enthusiasm

Return in this EXACT format:

SUBJECT: [updated subject line]
BODY:
[updated email body]
---
RESPONSE: [your brief, natural response to the user about what you changed]`;

  // Build conversation messages (last 6 turns for context)
  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Add recent conversation history
  for (const msg of conversationHistory.slice(-6)) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Add current user message
  messages.push({ role: 'user', content: userMessage });

  const response = await complete({
    systemPrompt,
    userPrompt: userMessage,
    options: {
      model: 'llama-3.1-8b-instant', // Fast and cheap
      temperature: 0.5,
      maxTokens: 400,
    },
    metadata: {
      userId,
      action: 'EMAIL_REFINEMENT',
    },
  });

  const text = response.content;

  // Parse the response - handle various separator formats from LLM
  const subjectMatch = text.match(/SUBJECT:\s*([^\n]+)/);
  const bodyMatch = text.match(/BODY:\s*([\s\S]*?)(?=\n---+\s*\n?RESPONSE:|\nRESPONSE:|\n---+\s*$|$)/);
  const responseMatch = text.match(/RESPONSE:\s*([\s\S]+)$/);

  const newSubject = subjectMatch?.[1]?.trim() || subject;
  let newBody = bodyMatch?.[1]?.trim() || body;

  // Safety: strip any RESPONSE: text that leaked into the body
  const responseLeakIdx = newBody.indexOf('RESPONSE:');
  if (responseLeakIdx !== -1) {
    newBody = newBody.substring(0, responseLeakIdx).replace(/\n?---+\s*$/, '').trim();
  }

  const assistantMessage = responseMatch?.[1]?.trim() || "I've updated your email.";

  return {
    subject: newSubject,
    body: newBody,
    assistantMessage,
  };
}
