import { MeetingSuggestionStatus } from "@prisma/client";

/**
 * Shape of the extractedData JSON field in ExtractedMeetingSuggestion
 */
export interface ExtractedMeetingData {
  title: string;
  startTime: string; // ISO 8601 datetime
  endTime?: string; // ISO 8601 datetime
  duration?: number; // minutes (used if endTime not specified)
  location?: string;
  attendees?: string[]; // email addresses
  isAllDay?: boolean;
  description?: string;
  rawText: string; // Original text snippet that was parsed
}

/**
 * Result from the calendar parser service
 */
export interface ParsedMeetingResult {
  hasMeeting: boolean;
  confidence: number; // 0.0 to 1.0
  data?: ExtractedMeetingData;
  error?: string;
}

/**
 * Pre-filter result from meeting detector
 */
export interface MeetingDetectorResult {
  hasPotentialMeeting: boolean;
  matchedPatterns: string[];
}

/**
 * Full meeting suggestion with Prisma types
 */
export interface MeetingSuggestionWithMessage {
  id: string;
  userId: string;
  messageId: string;
  status: MeetingSuggestionStatus;
  extractedData: ExtractedMeetingData;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  message: {
    subject: string | null;
    sender: string;
    received_at: Date;
  };
}
