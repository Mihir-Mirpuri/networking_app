import Groq from 'groq-sdk';

// Lazy initialization - only create client when needed
function getGroqClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }
  return new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });
}

export interface PersonData {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  university: string;
}

export interface TemplatePrompt {
  subject: string;
  body: string;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
}

/**
 * Custom error for rate limit issues (should trigger retry)
 */
export class GroqRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroqRateLimitError';
  }
}

/**
 * Generates a personalized email using Groq AI
 * @param templatePrompt - The email template with subject and body placeholders
 * @param personData - Information about the person to personalize the email for
 * @returns Generated email with subject and body
 */
export async function generateEmailWithGroq(
  templatePrompt: TemplatePrompt,
  personData: PersonData
): Promise<GeneratedEmail> {
  console.log('[Groq] Starting email generation...');
  console.log('[Groq] Person data:', { fullName: personData.fullName, company: personData.company });
  
  if (!process.env.GROQ_API_KEY) {
    const error = 'GROQ_API_KEY environment variable is not set';
    console.error('[Groq] ERROR:', error);
    throw new Error(error);
  }

  console.log('[Groq] API key found, proceeding with request...');

  // Build the prompt for Groq
  const firstName = personData.firstName || 'there';
  const role = personData.role || 'your role';
  
  const systemPrompt = `You are a professional networking email assistant. Generate a personalized email based on the provided template and person information. Return ONLY valid JSON with "subject" and "body" fields. Do not include any markdown formatting, code blocks, or additional text.`;

  const userPrompt = `Template Subject: ${templatePrompt.subject}
Template Body: ${templatePrompt.body}

Person Information:
- First Name: ${firstName}
- Full Name: ${personData.fullName}
- Company: ${personData.company}
- Role: ${role}
- University: ${personData.university}

Generate a personalized email by replacing placeholders like {first_name}, {company}, {university}, {role} with the actual values. Make the email natural, professional, and personalized while maintaining the template's intent.

Return JSON format:
{
  "subject": "personalized subject here",
  "body": "personalized email body here"
}`;

  try {
    console.log('[Groq] Creating Groq client...');
    const groq = getGroqClient();
    console.log('[Groq] Making API request to Groq...');
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    });

    console.log('[Groq] API request completed successfully');
    console.log('[Groq] Response received, processing...');

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      console.error('[Groq] ERROR: No content in API response');
      throw new Error('No content returned from Groq API');
    }

    console.log('[Groq] Content length:', content.length);
    console.log('[Groq] Content preview:', content.substring(0, 200));

    // Parse JSON response
    let parsed: { subject?: string; body?: string };
    try {
      parsed = JSON.parse(content);
      console.log('[Groq] Successfully parsed JSON response');
    } catch (parseError) {
      console.warn('[Groq] Initial JSON parse failed, attempting to extract from markdown...');
      // If JSON parsing fails, try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        console.log('[Groq] Found JSON in markdown, parsing...');
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        console.error('[Groq] ERROR: Failed to parse JSON response');
        console.error('[Groq] Content that failed to parse:', content);
        throw new Error('Failed to parse JSON response from Groq');
      }
    }

    if (!parsed.subject || !parsed.body) {
      console.error('[Groq] ERROR: Invalid response format - missing subject or body');
      console.error('[Groq] Parsed object:', parsed);
      throw new Error('Invalid response format: missing subject or body');
    }

    console.log('[Groq] Email generation successful!');
    return {
      subject: parsed.subject.trim(),
      body: parsed.body.trim(),
    };
  } catch (error: any) {
    console.error('[Groq] ERROR in generateEmailWithGroq:', {
      message: error?.message,
      status: error?.status,
      statusCode: error?.statusCode,
      code: error?.code,
      stack: error?.stack,
    });

    // Check for rate limit errors
    if (
      error?.status === 429 ||
      error?.statusCode === 429 ||
      error?.message?.includes('rate limit') ||
      error?.message?.includes('Rate limit')
    ) {
      console.warn('[Groq] Rate limit error detected');
      throw new GroqRateLimitError(
        error.message || 'Groq API rate limit exceeded'
      );
    }

    // Re-throw other errors
    console.error('[Groq] Re-throwing error:', error);
    throw error;
  }
}
