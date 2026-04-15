import { createClient } from '@supabase/supabase-js';
import { completeJson } from '@/lib/services/anthropic';

export interface ResumeSummary {
  organizations: string[];
  activities: string[];
  interests: string[];
  skills: string[];
  rawSummary: string;
}

/**
 * Downloads a resume from Supabase storage and extracts text
 */
async function extractResumeText(fileUrl: string, mimeType: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase not configured');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Extract the path from the URL
  const urlParts = fileUrl.split('/resumes/');
  if (urlParts.length < 2) {
    throw new Error('Invalid file URL format');
  }
  const filePath = urlParts[1];

  // Download the file
  const { data, error } = await supabase.storage
    .from('resumes')
    .download(filePath);

  if (error || !data) {
    throw new Error(`Failed to download resume: ${error?.message}`);
  }

  // Convert to buffer
  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Parse based on mime type
  if (mimeType === 'application/pdf') {
    const pdf = require('pdf-parse');
    const pdfData = await pdf(buffer);
    return pdfData.text;
  } else if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    // For DOCX, we'll extract text more simply
    // In production, you might want to use mammoth.js
    // For now, return a placeholder and handle PDF primarily
    return buffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ' ');
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * Summarizes a resume to extract key points for personalization
 */
export async function summarizeResume(
  fileUrl: string,
  mimeType: string,
  userId?: string
): Promise<ResumeSummary> {
  // Extract text from the resume
  const resumeText = await extractResumeText(fileUrl, mimeType);

  // Truncate if too long (Groq has context limits)
  const truncatedText = resumeText.slice(0, 8000);

  const prompt = `Analyze this resume and extract key information that could be used to find common ground with other professionals. Focus on:

1. ORGANIZATIONS: Clubs, societies, fraternities/sororities, professional orgs, volunteer groups
2. ACTIVITIES: Sports, competitions, hackathons, conferences, leadership roles
3. INTERESTS: Hobbies, causes, industries, technologies they're passionate about
4. SKILLS: Technical and soft skills that show personality

RESUME TEXT:
${truncatedText}

Return a JSON object with these exact keys:
{
  "organizations": ["org1", "org2"],
  "activities": ["activity1", "activity2"],
  "interests": ["interest1", "interest2"],
  "skills": ["skill1", "skill2"],
  "rawSummary": "A 2-3 sentence summary of this person highlighting what makes them unique"
}

Be concise. Only include notable items, not generic ones. Return ONLY valid JSON, no other text.`;

  try {
    const response = await completeJson<ResumeSummary>({
      userPrompt: prompt,
      options: {
        temperature: 0.3,
        maxTokens: 512,
      },
      metadata: { userId, action: 'RESUME_PARSE' },
    });

    return response.content;
  } catch {
    // Return empty summary if parsing fails
    return {
      organizations: [],
      activities: [],
      interests: [],
      skills: [],
      rawSummary: '',
    };
  }
}
