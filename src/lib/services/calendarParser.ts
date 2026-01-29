/**
 * Calendar Parser Service
 *
 * Uses Groq LLM to extract meeting/scheduling information from emails.
 * Designed to be called after the pre-filter (meetingDetector) confirms
 * potential meeting content.
 */

import { completeJson, GroqJsonParseError, GroqError } from '@/lib/services/groq';
import { MeetingDetectionResult } from '@/lib/utils/meetingDetector';

// ============================================================================
// Types
// ============================================================================

export interface Attendee {
  name?: string;
  email?: string;
}

export type MeetingPlatform =
  | 'zoom'
  | 'google-meet'
  | 'teams'
  | 'skype'
  | 'webex'
  | 'phone'
  | 'in-person'
  | 'other';

/**
 * Result from LLM extraction - matches what the model returns
 */
export interface LLMExtractionResult {
  hasMeeting: boolean;
  title: string | null;
  description: string | null;

  // Time information - may be natural language or ISO format
  startTime: string | null;
  endTime: string | null;
  duration: number | null; // in minutes
  isAllDay: boolean;

  // Location
  location: string | null;
  meetingLink: string | null;
  meetingPlatform: MeetingPlatform | null;

  // People
  organizer: string | null;
  attendees: Attendee[];

  // Metadata
  confidence: number; // 0-1
  extractedFields: string[];
  ambiguities: string[]; // Any unclear aspects
}

/**
 * Final parsed result with resolved dates
 */
export interface ParsedMeetingResult {
  hasMeeting: boolean;

  // Meeting details
  title: string | null;
  description: string | null;

  // Time - resolved to Date objects when possible
  startTime: Date | null;
  endTime: Date | null;
  rawStartTime: string | null; // Original extracted text
  rawEndTime: string | null;
  duration: number | null; // minutes
  isAllDay: boolean;
  needsTimeConfirmation: boolean; // True if time is ambiguous

  // Location
  location: string | null;
  meetingLink: string | null;
  meetingPlatform: MeetingPlatform | null;

  // People
  organizer: string | null;
  attendees: Attendee[];

  // Source context
  suggestedBy: string | null; // Email sender
  sourceSubject: string | null;

  // Confidence and extraction quality
  confidence: number;
  extractedFields: string[];
  ambiguities: string[];

  // Processing metadata
  llmModel: string;
  processingTimeMs: number;
}

export interface CalendarParserInput {
  messageId: string;
  subject: string | null;
  bodyText: string | null;
  sender: string;
  receivedAt: Date;
  userTimezone?: string; // e.g., 'America/Los_Angeles'
  preFilterResult?: MeetingDetectionResult; // Optional pre-filter context
}

export interface CalendarParserOutput {
  success: boolean;
  result: ParsedMeetingResult | null;
  error?: string;
  skipped?: boolean; // True if pre-filter said no meeting
}

// ============================================================================
// Prompt Construction
// ============================================================================

const SYSTEM_PROMPT = `You are an expert email analyst specializing in extracting meeting and scheduling information from professional emails.

Your task is to carefully analyze emails and extract any meeting-related details with high accuracy.

Guidelines:
1. Only extract meetings that are being PROPOSED or SCHEDULED, not ones that already happened
2. If no meeting is being proposed, set hasMeeting to false
3. Be precise with times - extract exactly what's stated, don't infer
4. For relative dates (e.g., "next Tuesday"), preserve the natural language - don't try to convert
5. Extract confidence as a decimal 0-1 based on how clearly the meeting details are stated
6. List any ambiguities (e.g., "time zone not specified", "year not mentioned")
7. ALWAYS generate a title - if not explicitly stated, infer a brief descriptive title from context (e.g., "Coffee catch-up", "Quick sync", "Phone call", "Product demo")

Confidence scoring guidelines:
- 0.9-1.0: Clear meeting with explicit date, time, and purpose
- 0.7-0.9: Meeting mentioned with most details but some inference needed
- 0.5-0.7: Meeting implied but details are vague or partial
- 0.3-0.5: Possible meeting but very ambiguous
- 0.0-0.3: Unlikely to be a meeting request

Always return valid JSON matching the specified schema.`;

function buildUserPrompt(input: CalendarParserInput): string {
  const { subject, bodyText, sender, receivedAt, userTimezone } = input;

  const contextInfo = [
    `Current reference date: ${receivedAt.toISOString()}`,
    userTimezone ? `User timezone: ${userTimezone}` : 'User timezone: Not specified',
    `Email sender: ${sender}`,
  ].join('\n');

  return `Extract meeting information from this email.

CONTEXT:
${contextInfo}

EMAIL SUBJECT:
${subject || '(No subject)'}

EMAIL BODY:
${bodyText || '(No body)'}

Return JSON with this exact structure:
{
  "hasMeeting": boolean,
  "title": string or null (meeting title/purpose),
  "description": string or null (additional notes or agenda),
  "startTime": string or null (date/time as stated, can be natural language like "next Tuesday at 3pm" or ISO format),
  "endTime": string or null (end time if mentioned),
  "duration": number or null (duration in minutes if mentioned),
  "isAllDay": boolean (true if it's an all-day event),
  "location": string or null (physical location),
  "meetingLink": string or null (URL for video call),
  "meetingPlatform": "zoom" | "google-meet" | "teams" | "skype" | "webex" | "phone" | "in-person" | "other" | null,
  "organizer": string or null (person organizing the meeting),
  "attendees": [{"name": string, "email": string}] (other participants mentioned),
  "confidence": number (0-1),
  "extractedFields": [list of field names that were successfully extracted],
  "ambiguities": [list of unclear aspects, e.g., "timezone not specified"]
}`;
}

// ============================================================================
// Date Resolution
// ============================================================================

interface DateResolutionResult {
  date: Date | null;
  needsConfirmation: boolean;
  error?: string;
}

/**
 * Attempts to resolve a natural language date/time to a Date object
 * relative to the email's received date
 */
function resolveDateTime(
  rawDateTime: string | null,
  referenceDate: Date,
  userTimezone?: string
): DateResolutionResult {
  if (!rawDateTime) {
    return { date: null, needsConfirmation: false };
  }

  const raw = rawDateTime.toLowerCase().trim();

  // Try parsing as ISO format first
  const isoDate = new Date(rawDateTime);
  if (!isNaN(isoDate.getTime())) {
    return { date: isoDate, needsConfirmation: false };
  }

  // Parse relative dates
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  // Helper to set time on a date
  const setTime = (date: Date, timeStr: string): Date | null => {
    const result = new Date(date);

    // Match patterns like "3pm", "3:00pm", "15:00", "3:30 PM"
    const timeMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const meridiem = timeMatch[3]?.toLowerCase().replace(/\./g, '');

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;

      result.setHours(hours, minutes, 0, 0);
      return result;
    }

    // Named times
    if (timeStr.includes('noon') || timeStr.includes('midday')) {
      result.setHours(12, 0, 0, 0);
      return result;
    }
    if (timeStr.includes('midnight')) {
      result.setHours(0, 0, 0, 0);
      return result;
    }
    if (timeStr.includes('morning')) {
      result.setHours(9, 0, 0, 0);
      return result;
    }
    if (timeStr.includes('afternoon')) {
      result.setHours(14, 0, 0, 0);
      return result;
    }
    if (timeStr.includes('evening')) {
      result.setHours(18, 0, 0, 0);
      return result;
    }

    return null;
  };

  // Handle "today" and "tomorrow"
  if (raw.includes('today')) {
    const result = new Date(today);
    const timeResult = setTime(result, raw);
    return {
      date: timeResult || result,
      needsConfirmation: !timeResult
    };
  }

  if (raw.includes('tomorrow')) {
    const result = new Date(today);
    result.setDate(result.getDate() + 1);
    const timeResult = setTime(result, raw);
    return {
      date: timeResult || result,
      needsConfirmation: !timeResult
    };
  }

  // Handle day of week
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayShort: { [key: string]: number } = {
    'sun': 0, 'mon': 1, 'tue': 2, 'tues': 2, 'wed': 3,
    'thu': 4, 'thur': 4, 'thurs': 4, 'fri': 5, 'sat': 6
  };

  for (let i = 0; i < daysOfWeek.length; i++) {
    if (raw.includes(daysOfWeek[i])) {
      const targetDay = i;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;

      // If "next" is mentioned or the day has passed this week, add a week
      if (raw.includes('next') || daysToAdd <= 0) {
        daysToAdd += 7;
      }

      const result = new Date(today);
      result.setDate(result.getDate() + daysToAdd);
      const timeResult = setTime(result, raw);
      return {
        date: timeResult || result,
        needsConfirmation: !timeResult
      };
    }
  }

  // Check short day names
  for (const [short, dayNum] of Object.entries(dayShort)) {
    const regex = new RegExp(`\\b${short}\\b`, 'i');
    if (regex.test(raw)) {
      const targetDay = dayNum;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;

      if (raw.includes('next') || daysToAdd <= 0) {
        daysToAdd += 7;
      }

      const result = new Date(today);
      result.setDate(result.getDate() + daysToAdd);
      const timeResult = setTime(result, raw);
      return {
        date: timeResult || result,
        needsConfirmation: !timeResult
      };
    }
  }

  // Handle "next week"
  if (raw.includes('next week')) {
    const result = new Date(today);
    result.setDate(result.getDate() + 7);
    return { date: result, needsConfirmation: true };
  }

  // Handle specific date formats (e.g., "Jan 15", "1/15", "January 15th")
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const monthShort = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'
  ];

  // Try "Month Day" format
  for (let i = 0; i < monthNames.length; i++) {
    const monthRegex = new RegExp(`(${monthNames[i]}|${monthShort[i]})\\s+(\\d{1,2})(?:st|nd|rd|th)?`, 'i');
    const match = raw.match(monthRegex);
    if (match) {
      const day = parseInt(match[2], 10);
      const result = new Date(today);
      result.setMonth(i, day);

      // If the date is in the past, assume next year
      if (result < today) {
        result.setFullYear(result.getFullYear() + 1);
      }

      const timeResult = setTime(result, raw);
      return {
        date: timeResult || result,
        needsConfirmation: !timeResult
      };
    }
  }

  // Try numeric date format (M/D or M/D/YYYY)
  const numericDateMatch = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (numericDateMatch) {
    const month = parseInt(numericDateMatch[1], 10) - 1;
    const day = parseInt(numericDateMatch[2], 10);
    const year = numericDateMatch[3]
      ? (numericDateMatch[3].length === 2 ? 2000 + parseInt(numericDateMatch[3], 10) : parseInt(numericDateMatch[3], 10))
      : today.getFullYear();

    const result = new Date(year, month, day);

    // If no year specified and date is in the past, assume next year
    if (!numericDateMatch[3] && result < today) {
      result.setFullYear(result.getFullYear() + 1);
    }

    const timeResult = setTime(result, raw);
    return {
      date: timeResult || result,
      needsConfirmation: !timeResult
    };
  }

  // If we couldn't parse, return null but don't fail
  return {
    date: null,
    needsConfirmation: true,
    error: `Could not parse date/time: "${rawDateTime}"`
  };
}

// ============================================================================
// Main Parser Function
// ============================================================================

/**
 * Parse meeting information from an email using LLM
 */
export async function parseCalendarFromEmail(
  input: CalendarParserInput
): Promise<CalendarParserOutput> {
  const startTime = Date.now();
  const { messageId, subject, bodyText, sender, receivedAt, userTimezone, preFilterResult } = input;

  console.log(`[CalendarParser] Processing message ${messageId}`);

  // If pre-filter provided and says no meeting, skip
  if (preFilterResult && !preFilterResult.hasPotentialMeeting) {
    console.log(`[CalendarParser] Skipping ${messageId} - pre-filter says no meeting`);
    return {
      success: true,
      result: null,
      skipped: true,
    };
  }

  // Validate we have content to parse
  if (!subject && !bodyText) {
    console.log(`[CalendarParser] Skipping ${messageId} - no content`);
    return {
      success: true,
      result: null,
      skipped: true,
    };
  }

  try {
    // Call Groq for extraction
    const userPrompt = buildUserPrompt(input);

    const response = await completeJson<LLMExtractionResult>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      options: {
        model: 'llama-3.1-8b-instant', // Fast model for extraction
        temperature: 0.2, // Low temperature for consistent extraction
        maxTokens: 1024,
      },
    });

    const llmResult = response.content;
    const processingTimeMs = Date.now() - startTime;

    console.log(`[CalendarParser] LLM extraction complete for ${messageId}:`, {
      hasMeeting: llmResult.hasMeeting,
      confidence: llmResult.confidence,
      extractedFields: llmResult.extractedFields,
      model: response.model,
      tokens: response.usage.totalTokens,
      timeMs: processingTimeMs,
    });

    // If no meeting detected, return early
    if (!llmResult.hasMeeting) {
      return {
        success: true,
        result: {
          hasMeeting: false,
          title: null,
          description: null,
          startTime: null,
          endTime: null,
          rawStartTime: null,
          rawEndTime: null,
          duration: null,
          isAllDay: false,
          needsTimeConfirmation: false,
          location: null,
          meetingLink: null,
          meetingPlatform: null,
          organizer: null,
          attendees: [],
          suggestedBy: sender,
          sourceSubject: subject,
          confidence: llmResult.confidence,
          extractedFields: llmResult.extractedFields,
          ambiguities: llmResult.ambiguities,
          llmModel: response.model,
          processingTimeMs,
        },
      };
    }

    // Resolve dates
    const startResolution = resolveDateTime(llmResult.startTime, receivedAt, userTimezone);
    const endResolution = resolveDateTime(llmResult.endTime, receivedAt, userTimezone);

    // If we have start but no end, calculate end from duration
    let resolvedEndTime = endResolution.date;
    if (startResolution.date && !resolvedEndTime && llmResult.duration) {
      resolvedEndTime = new Date(startResolution.date.getTime() + llmResult.duration * 60 * 1000);
    }
    // Default to 1 hour if we have start but no end or duration
    if (startResolution.date && !resolvedEndTime && !llmResult.isAllDay) {
      resolvedEndTime = new Date(startResolution.date.getTime() + 60 * 60 * 1000);
    }

    // Calculate needs confirmation
    const needsTimeConfirmation =
      startResolution.needsConfirmation ||
      !startResolution.date ||
      llmResult.ambiguities.some(a =>
        a.toLowerCase().includes('time') ||
        a.toLowerCase().includes('date') ||
        a.toLowerCase().includes('timezone')
      );

    // Adjust confidence based on date resolution
    let adjustedConfidence = llmResult.confidence;
    if (!startResolution.date) {
      adjustedConfidence = Math.min(adjustedConfidence, 0.6);
    }
    if (needsTimeConfirmation) {
      adjustedConfidence = Math.min(adjustedConfidence, 0.8);
    }

    // Boost confidence if pre-filter had high confidence
    if (preFilterResult?.confidence === 'high' && adjustedConfidence < 0.9) {
      adjustedConfidence = Math.min(adjustedConfidence + 0.1, 1.0);
    }

    const result: ParsedMeetingResult = {
      hasMeeting: true,
      title: llmResult.title,
      description: llmResult.description,
      startTime: startResolution.date,
      endTime: resolvedEndTime,
      rawStartTime: llmResult.startTime,
      rawEndTime: llmResult.endTime,
      duration: llmResult.duration,
      isAllDay: llmResult.isAllDay,
      needsTimeConfirmation,
      location: llmResult.location,
      meetingLink: llmResult.meetingLink,
      meetingPlatform: llmResult.meetingPlatform,
      organizer: llmResult.organizer,
      attendees: llmResult.attendees,
      suggestedBy: sender,
      sourceSubject: subject,
      confidence: adjustedConfidence,
      extractedFields: llmResult.extractedFields,
      ambiguities: llmResult.ambiguities,
      llmModel: response.model,
      processingTimeMs,
    };

    return {
      success: true,
      result,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;

    if (error instanceof GroqJsonParseError) {
      console.error(`[CalendarParser] JSON parse error for ${messageId}:`, error.message);
      return {
        success: false,
        result: null,
        error: `Failed to parse LLM response: ${error.message}`,
      };
    }

    if (error instanceof GroqError) {
      console.error(`[CalendarParser] Groq error for ${messageId}:`, error.message);
      return {
        success: false,
        result: null,
        error: `LLM service error: ${error.message}`,
      };
    }

    console.error(`[CalendarParser] Unexpected error for ${messageId}:`, error);
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Convert ParsedMeetingResult to the JSON format stored in the database
 * This is what gets saved in ExtractedMeetingSuggestion.extractedData
 */
export function toStorableFormat(result: ParsedMeetingResult): Record<string, unknown> {
  return {
    hasMeeting: result.hasMeeting,
    title: result.title,
    description: result.description,
    startTime: result.startTime?.toISOString() ?? null,
    endTime: result.endTime?.toISOString() ?? null,
    rawStartTime: result.rawStartTime,
    rawEndTime: result.rawEndTime,
    duration: result.duration,
    isAllDay: result.isAllDay,
    needsTimeConfirmation: result.needsTimeConfirmation,
    location: result.location,
    meetingLink: result.meetingLink,
    meetingPlatform: result.meetingPlatform,
    organizer: result.organizer,
    attendees: result.attendees,
    suggestedBy: result.suggestedBy,
    sourceSubject: result.sourceSubject,
    confidence: result.confidence,
    extractedFields: result.extractedFields,
    ambiguities: result.ambiguities,
    llmModel: result.llmModel,
    processingTimeMs: result.processingTimeMs,
  };
}

/**
 * Convert stored JSON back to ParsedMeetingResult
 */
export function fromStorableFormat(data: Record<string, unknown>): ParsedMeetingResult {
  return {
    hasMeeting: data.hasMeeting as boolean,
    title: data.title as string | null,
    description: data.description as string | null,
    startTime: data.startTime ? new Date(data.startTime as string) : null,
    endTime: data.endTime ? new Date(data.endTime as string) : null,
    rawStartTime: data.rawStartTime as string | null,
    rawEndTime: data.rawEndTime as string | null,
    duration: data.duration as number | null,
    isAllDay: data.isAllDay as boolean,
    needsTimeConfirmation: data.needsTimeConfirmation as boolean,
    location: data.location as string | null,
    meetingLink: data.meetingLink as string | null,
    meetingPlatform: data.meetingPlatform as MeetingPlatform | null,
    organizer: data.organizer as string | null,
    attendees: data.attendees as Attendee[],
    suggestedBy: data.suggestedBy as string | null,
    sourceSubject: data.sourceSubject as string | null,
    confidence: data.confidence as number,
    extractedFields: data.extractedFields as string[],
    ambiguities: data.ambiguities as string[],
    llmModel: data.llmModel as string,
    processingTimeMs: data.processingTimeMs as number,
  };
}
