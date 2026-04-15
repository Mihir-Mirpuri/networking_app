import prisma from '@/lib/prisma';
import { ResumeSummary } from './resume-summary';
import { complete } from '@/lib/services/anthropic';

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

  let systemPrompt = `STRUCTURE:
- Greeting: "Hello {first_name}," (safe, respectful, non-threatening)
- Body: Introduce yourself briefly (name, school, year, major) and state why you're reaching out. Lead with the main point — don't bury it. If you share a mutual connection or commonality, open with that. Make a specific, low-commitment ask — request a concrete time ("10-15 minutes for a quick phone call") rather than something vague ("I'd love to pick your brain").
- Sign-off: "Warm regards,\\n{sender_name}"

SUBJECT LINE:
- Be specific and personal — generic subjects like "Quick Question" or "Hello" get ignored.
- If you have a hook (shared school, mutual contact, specific role), put it in the subject.
- Keep it under 8 words. Curiosity works: hint at the reason without giving everything away.

TONE & VOICE:
- Sound like a real college student sending a genuine email — not a template, not a LinkedIn bot.
- Casual but respectful. Write like you'd speak to someone you admire but don't know yet.
- Use personal pronouns naturally: "I", "you", "your".
- Use active voice ("I'm studying finance at NYU" not "Finance is being studied by me").
- Contractions are fine and preferred — "I'm", "I'd", "you're" sound more natural than "I am", "I would".

WHAT TO AVOID:
- Filler phrases that waste the reader's time: "I hope this email finds you well", "I came across your profile", "I'm reaching out because", "I would be thrilled", "I was excited to see"
- Flattery that sounds hollow: "Your career is truly inspiring", "I'm so impressed by your journey"
- Hedging language: "I was just wondering if maybe", "I don't want to take too much of your time"
- Padded words: "actually", "basically", "really", "very", "truly", "definitely"
- Sounding desperate or overly eager — confidence is respectful

PSYCHOLOGY (use sparingly, not formulaically):
- Mutual connection is the strongest opener — a shared school, club, contact, or interest makes the email feel relevant rather than random.
- Specificity signals effort. Mentioning their actual role or company shows you didn't mass-send this.
- A short email respects the reader's time and is more likely to get a response than a long one.
- People respond to clear asks. "Could we talk for 15 minutes this week?" beats "I'd love to connect sometime."

RULES:
1. Keep it short — a few focused paragraphs, not a wall of text.
2. Every sentence must earn its place. If removing it doesn't change the email, cut it.
3. Each email must be unique — vary phrasing based on the recipient's role and company.`;

  if (sentEmailExamples && sentEmailExamples.length > 0) {
    systemPrompt += `\n4. If example emails from the sender are provided, match their writing style closely.`;
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
    city?: string | null;
    state?: string | null;
    educationSchool?: string | null;
    educationDegree?: string | null;
    educationField?: string | null;
  };
  userId: string;
  selectedInsights?: Array<{ label: string; detail: string; type: string }>;
  allInsights?: Array<{ label: string; detail: string; type: string; source: string }>;
  resumeSummary?: ResumeSummary | null;
}

export interface ConversationalRefineResult {
  subject: string;
  body: string;
  assistantMessage: string;
}

/**
 * Refine an email through conversational interaction.
 * Maintains conversation context for natural back-and-forth editing.
 * Uses Claude Haiku for speed and cost efficiency.
 */
export async function refineEmailConversational(
  input: ConversationalRefineInput
): Promise<ConversationalRefineResult> {
  const { subject, body, userMessage, conversationHistory, person, userId, selectedInsights, allInsights, resumeSummary } = input;

  const personName = person.firstName || 'the recipient';
  const hasSelectedInsights = selectedInsights && selectedInsights.length > 0;

  // Truncate email
  const maxBodyLen = 2500;
  const truncatedBody = body.length > maxBodyLen ? body.slice(0, maxBodyLen) + '...' : body;

  // Build person profile block from all available data
  const profileParts: string[] = [];
  if (person.role) profileParts.push(`Role: ${person.role}`);
  if (person.company) profileParts.push(`Company: ${person.company}`);
  const location = [person.city, person.state].filter(Boolean).join(', ');
  if (location) profileParts.push(`Location: ${location}`);
  const education = [person.educationSchool, person.educationDegree, person.educationField].filter(Boolean).join(', ');
  if (education) profileParts.push(`Education: ${education}`);

  // Build insights block — always include all available insights for context
  let insightsBlock = '';
  if (allInsights && allInsights.length > 0) {
    insightsBlock += `\nWHAT WE KNOW ABOUT ${(person.firstName || 'THE RECIPIENT').toUpperCase()} (from LinkedIn and web research):
${allInsights.map(i => `- [${i.type}] ${i.label}: ${i.detail}`).join('\n')}\n`;
  }

  if (hasSelectedInsights) {
    insightsBlock += `\nINSIGHTS THE SENDER SELECTED TO INCORPORATE:
${selectedInsights.map(i => `- ${i.label}: ${i.detail}`).join('\n')}
When asked to incorporate these, weave them naturally into the email body.\n`;
  }

  const systemPrompt = `You are an AI assistant helping a college student refine their cold outreach email. You have a natural, conversational style.

CURRENT EMAIL:
Subject: ${subject}
Body:
${truncatedBody}

RECIPIENT: ${personName}${profileParts.length > 0 ? '\n' + profileParts.join('\n') : ''}
${insightsBlock}${resumeSummary ? `\nSENDER'S BACKGROUND (from their resume):
${resumeSummary.rawSummary ? resumeSummary.rawSummary : ''}${resumeSummary.organizations?.length ? '\nOrganizations: ' + resumeSummary.organizations.join(', ') : ''}${resumeSummary.activities?.length ? '\nActivities: ' + resumeSummary.activities.join(', ') : ''}${resumeSummary.interests?.length ? '\nInterests: ' + resumeSummary.interests.join(', ') : ''}${resumeSummary.skills?.length ? '\nSkills: ' + resumeSummary.skills.join(', ') : ''}
` : ''}
You operate in two modes depending on the user's message:

MODE: edit — when the user requests a specific change to the email
- Make the requested changes to the email
- Briefly confirm what you changed
- Only modify what the user asks for
- Keep the same greeting and sign-off unless explicitly asked to change
- Sound like a real college student - casual but respectful
- NO corporate speak or excessive enthusiasm

MODE: chat — when the user is chatting, asking a question, saying hello, or the message isn't a clear edit request
- Respond naturally and conversationally
- Do NOT change the email
- If the user asks something vague like "how can we improve this?", ask clarifying questions about what they want changed

RESPONSE STYLE:
- Be concise. No preamble, no filler. Get to the point immediately.
- Use bullets for lists. Keep them tight.
- Longer responses are fine when the content demands it, but every sentence must earn its place.

Pick the mode based on the user's message and return in the matching format:

If MODE is edit:
MODE: edit
SUBJECT: [updated subject line]
BODY:
[updated email body]
---
RESPONSE: [your brief response about what you changed]

If MODE is chat:
MODE: chat
RESPONSE: [your conversational reply]`;

  // Build user prompt with conversation history so the LLM has full context
  let userPrompt = '';

  if (conversationHistory.length > 0) {
    userPrompt += 'CONVERSATION SO FAR:\n';
    for (const msg of conversationHistory.slice(-6)) {
      const label = msg.role === 'user' ? 'User' : 'Assistant';
      userPrompt += `${label}: ${msg.content}\n`;
    }
    userPrompt += '\n';
  }

  userPrompt += `User: ${userMessage}`;

  const response = await complete({
    systemPrompt,
    userPrompt,
    options: {
      temperature: 0.5,
      maxTokens: hasSelectedInsights ? 600 : 400,
    },
    metadata: {
      userId,
      action: 'EMAIL_REFINEMENT',
    },
  });

  const text = response.content;

  // Detect mode — chat mode if LLM says "MODE: chat" or if there's no SUBJECT/BODY block
  const isEditMode = /MODE:\s*edit/i.test(text) || (/SUBJECT:/i.test(text) && /BODY:/i.test(text));

  if (!isEditMode) {
    // Chat mode — extract just the response, leave email unchanged
    const chatResponse = text
      .replace(/^MODE:\s*chat\s*/i, '')
      .replace(/^RESPONSE:\s*/i, '')
      .trim();

    return {
      subject,
      body,
      assistantMessage: chatResponse || text.trim(),
    };
  }

  // Edit mode — parse structured response
  const subjectMatch = text.match(/SUBJECT:\s*([^\n]+)/);
  const bodyMatch = text.match(/BODY:\s*([\s\S]*?)(?=\n---+|\nRESPONSE:|$)/);
  const responseMatch = text.match(/(?:---+\s*\n?)?RESPONSE:\s*([\s\S]+)$/);
  const fallbackResponseMatch = !responseMatch ? text.match(/\n---+\s*\n([\s\S]+)$/) : null;

  const newSubject = subjectMatch?.[1]?.trim() || subject;
  let newBody = bodyMatch?.[1]?.trim() || body;

  // Safety: strip any RESPONSE: text that leaked into the body
  const responseLeakIdx = newBody.indexOf('RESPONSE:');
  if (responseLeakIdx !== -1) {
    newBody = newBody.substring(0, responseLeakIdx).replace(/\n?---+\s*$/, '').trim();
  }

  newBody = newBody.replace(/\n---+\s*[\s\S]*$/, '').trim();
  newBody = newBody.replace(/\n+I (?:shortened|made|updated|changed|removed|added|edited|rewrote|revised)[\s\S]*$/i, '').trim();

  const assistantMessage = responseMatch?.[1]?.trim() || fallbackResponseMatch?.[1]?.trim() || "Done! I've updated your email.";

  return {
    subject: newSubject,
    body: newBody,
    assistantMessage,
  };
}
