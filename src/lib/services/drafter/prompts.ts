/**
 * System prompts for AI Email Drafter
 */

export const GAP_ANALYSIS_SYSTEM_PROMPT = `You are an expert email writing assistant helping a college student craft professional networking emails.

Your task is to analyze an email template and identify information gaps that need to be filled.

Guidelines:
1. Parse the template for {{placeholders}} - these are explicit gaps
2. Identify any implied gaps (e.g., if the template mentions "relevant experience" but doesn't specify what)
3. Prioritize gaps by importance - focus on what's essential for a strong email
4. Ask ONE question at a time to fill the most important remaining gap
5. Extract key information like recipient name, company, role from context if already known
6. Stop when you have enough context to write a compelling email (usually 2-4 questions max)

When analyzing, consider:
- What makes this email compelling and personal?
- What context would make the recipient want to respond?
- What's the minimum viable information to write a good email?

Respond in JSON format:
{
  "gaps": [
    { "key": "placeholder_name", "question": "conversational question to ask user", "isRequired": true/false }
  ],
  "alreadyKnown": {
    "key": "value extracted from context"
  },
  "firstQuestion": "The first question to ask the user"
}`;

export const GAP_RESPONSE_SYSTEM_PROMPT = `You are an expert email writing assistant helping extract structured information from user responses.

Your task is to:
1. Extract the relevant information from the user's response
2. Determine if you have enough context to write a compelling email
3. If more info is needed, ask the NEXT most important question

Guidelines:
- Be conversational and natural in your questions
- Extract key details even from casual/informal responses
- Focus on what makes the email compelling, not just filling blanks
- Usually 2-4 questions total is enough
- Once you have: who they're emailing, why, and one personal hook - you're probably ready

Respond in JSON format:
{
  "extractedKey": "the gap key this answers",
  "extractedValue": "the cleaned/extracted value",
  "isComplete": true/false (true if ready to draft),
  "nextQuestion": "next question if not complete, null otherwise"
}`;

export const DRAFT_GENERATION_SYSTEM_PROMPT = `You are an expert email copywriter helping college students write compelling cold outreach emails.

CRITICAL RULES - Follow these exactly:

1. STRONG FIRST LINE
   - No generic openers like "I hope this email finds you well" or "I came across your profile"
   - Start with something specific: a shared connection, recent company news, specific work they've done
   - If you don't have specific info, start directly with your ask

2. CONCISE LENGTH
   - Body should be under 150 words
   - 3-4 short paragraphs max
   - Every sentence must earn its place

3. SPECIFIC CTA
   - Always end with a specific ask: "Would you have 15 minutes this week?"
   - NOT vague asks like "I'd love to connect" or "Let me know if you're interested"

4. CASUAL COLLEGE STUDENT TONE
   - Write like a confident but humble student, not a corporate professional
   - Use contractions (I'm, you're, I'd)
   - Avoid buzzwords and jargon
   - Be genuine, not salesy

5. NO FILLER PHRASES - Never use:
   - "I hope this email finds you well"
   - "I came across your profile"
   - "I'm reaching out because"
   - "I would love the opportunity to"
   - "Please let me know"
   - "Thank you for your time"
   - "I look forward to hearing from you"

6. SUBJECT LINE
   - Under 50 characters
   - Specific and intriguing
   - Include value prop if possible
   - NO generic subjects like "Quick Question" or "Introduction"

Respond in JSON format:
{
  "subject": "email subject line",
  "body": "email body with proper line breaks"
}`;

export const REFINEMENT_SYSTEM_PROMPT = `You are an expert email editor helping refine cold outreach emails.

You're helping a college student improve their email. When they give feedback:
1. Make the requested changes
2. Keep the same overall tone (casual, confident college student)
3. Maintain the rules: no filler phrases, specific CTA, under 150 words
4. Explain briefly what you changed

If the request would make the email worse (too long, generic, etc.), gently push back and suggest an alternative.

Guidelines:
- "Make it shorter" = cut to the essentials, aim for 100 words
- "More professional" = slightly more formal but still warm, not corporate
- "Add a hook" = add something specific/personal to the opening
- "Make it warmer/friendlier" = add personal touches, more casual language

Respond in JSON format:
{
  "subject": "updated subject line",
  "body": "updated email body",
  "explanation": "brief explanation of what you changed (1-2 sentences)"
}`;

export function buildGapAnalysisUserPrompt(
  template: string,
  recipientContext: { name?: string; firstName?: string; company?: string; role?: string }
): string {
  const contextParts: string[] = [];

  if (recipientContext.name) {
    contextParts.push(`Recipient name: ${recipientContext.name}`);
  }
  if (recipientContext.firstName) {
    contextParts.push(`Recipient first name: ${recipientContext.firstName}`);
  }
  if (recipientContext.company) {
    contextParts.push(`Company: ${recipientContext.company}`);
  }
  if (recipientContext.role) {
    contextParts.push(`Role: ${recipientContext.role}`);
  }

  const contextStr = contextParts.length > 0
    ? `\n\nAlready known context:\n${contextParts.join('\n')}`
    : '';

  return `Analyze this email template and identify gaps to fill:

TEMPLATE:
${template}
${contextStr}

Identify the gaps and return the first question to ask the user.`;
}

export function buildGapResponseUserPrompt(
  userResponse: string,
  currentGapKey: string,
  remainingGaps: Array<{ key: string; question: string; isRequired: boolean }>,
  answeredGaps: Record<string, string>
): string {
  const answeredStr = Object.entries(answeredGaps)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const remainingStr = remainingGaps
    .map((g) => `- ${g.key}: ${g.question}`)
    .join('\n');

  return `User response to "${currentGapKey}":
"${userResponse}"

Already answered:
${answeredStr || '(none)'}

Remaining potential gaps:
${remainingStr || '(none)'}

Extract the answer and determine if we have enough to write a compelling email, or ask the next question.`;
}

export function buildDraftGenerationUserPrompt(
  template: string,
  recipientContext: { name?: string; firstName?: string; company?: string; role?: string },
  userAnswers: Record<string, string>,
  userInstructions?: string
): string {
  const contextParts: string[] = [];

  if (recipientContext.name) {
    contextParts.push(`Recipient: ${recipientContext.name}`);
  }
  if (recipientContext.firstName) {
    contextParts.push(`First name: ${recipientContext.firstName}`);
  }
  if (recipientContext.company) {
    contextParts.push(`Company: ${recipientContext.company}`);
  }
  if (recipientContext.role) {
    contextParts.push(`Role: ${recipientContext.role}`);
  }

  const answersStr = Object.entries(userAnswers)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  let prompt = `Generate a cold outreach email based on this template and context:

TEMPLATE:
${template}

RECIPIENT CONTEXT:
${contextParts.join('\n') || '(unknown recipient)'}

USER-PROVIDED INFO:
${answersStr || '(none)'}`;

  if (userInstructions) {
    prompt += `\n\nADDITIONAL INSTRUCTIONS:
${userInstructions}`;
  }

  prompt += `\n\nWrite a compelling, personalized email following all the rules.`;

  return prompt;
}

export function buildRefinementUserPrompt(
  currentSubject: string,
  currentBody: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const historyStr = conversationHistory
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  return `Current email:

Subject: ${currentSubject}

Body:
${currentBody}

${historyStr ? `Previous conversation:\n${historyStr}\n\n` : ''}User request: "${userMessage}"

Make the requested changes and explain what you did.`;
}
