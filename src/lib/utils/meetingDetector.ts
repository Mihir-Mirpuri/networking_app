/**
 * Pre-filter utility to detect potential meeting/scheduling emails
 * Runs before LLM to skip obvious non-meeting emails and reduce costs
 */

export interface MeetingDetectionResult {
  hasPotentialMeeting: boolean;
  matchedPatterns: string[];
  confidence: 'high' | 'medium' | 'low';
}

// Days of the week (full and abbreviated)
const DAYS_OF_WEEK = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun'
];

// Months
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'
];

// Time-related patterns
const TIME_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Days of week with word boundaries
  { pattern: new RegExp(`\\b(${DAYS_OF_WEEK.join('|')})\\b`, 'i'), label: 'day_of_week' },

  // Months
  { pattern: new RegExp(`\\b(${MONTHS.join('|')})\\b`, 'i'), label: 'month' },

  // Relative time expressions
  { pattern: /\b(today|tomorrow|tonight|this evening|this afternoon|this morning)\b/i, label: 'relative_day' },
  { pattern: /\b(next week|this week|end of week|following week)\b/i, label: 'relative_week' },
  { pattern: /\b(next month|this month|end of month)\b/i, label: 'relative_month' },
  { pattern: /\b(next|coming|following)\s+(few\s+)?(days?|weeks?|months?)\b/i, label: 'relative_future' },

  // Specific time formats: 3pm, 3:00, 3:00pm, 15:00
  { pattern: /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\b/i, label: 'specific_time' },
  { pattern: /(?:\bat\b|@)\s*\d{1,2}(?::\d{2})?(?:\b|(?=\s|$|[?!.,]))/i, label: 'at_time' },
  { pattern: /\b\d{1,2}:\d{2}\b/, label: 'time_format' },
  { pattern: /\b(noon|midday|midnight)\b/i, label: 'named_time' },
  { pattern: /\bo'clock\b/i, label: 'oclock' },

  // Date formats: 1/15, 01/15/2024, Jan 15, 15th, the 3rd
  { pattern: /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/, label: 'date_format' },
  { pattern: /\b(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/i, label: 'ordinal_date' },

  // Duration
  { pattern: /\b(\d+)\s*(min(?:ute)?s?|hours?|hrs?)\b/i, label: 'duration' },
  { pattern: /\bhalf\s*(?:an?\s*)?hour\b/i, label: 'half_hour' },
];

// Meeting-related words
const MEETING_PATTERNS: Array<{ pattern: RegExp; label: string; strength: 'strong' | 'medium' | 'weak' }> = [
  // Strong signals - these alone suggest a meeting
  { pattern: /\b(meeting|meetings)\b/i, label: 'meeting', strength: 'strong' },
  { pattern: /\b(appointment|appointments)\b/i, label: 'appointment', strength: 'strong' },
  { pattern: /\b(interview|interviews)\b/i, label: 'interview', strength: 'strong' },
  { pattern: /\b(schedule|scheduling|scheduled|reschedule|rescheduling)\b/i, label: 'schedule', strength: 'strong' },
  { pattern: /\b(calendar invite|calendar event)\b/i, label: 'calendar', strength: 'strong' },
  { pattern: /\b(book(?:ed|ing)?)\s+(?:a\s+)?(?:time|slot|call|meeting)\b/i, label: 'book_meeting', strength: 'strong' },

  // Medium signals - meeting words that benefit from time context
  { pattern: /\b(call|calls|phone call|video call)\b/i, label: 'call', strength: 'medium' },
  { pattern: /\b(chat|quick chat)\b/i, label: 'chat', strength: 'medium' },
  { pattern: /\b(sync|sync up|syncing)\b/i, label: 'sync', strength: 'medium' },
  { pattern: /\b(catch up|catching up)\b/i, label: 'catch_up', strength: 'medium' },
  { pattern: /\b(get together|meet up|meetup)\b/i, label: 'get_together', strength: 'medium' },
  { pattern: /\b(1:1|one-on-one|one on one)\b/i, label: 'one_on_one', strength: 'medium' },
  { pattern: /\b(standup|stand-up|stand up|huddle)\b/i, label: 'standup', strength: 'medium' },
  { pattern: /\b(demo|demos|presentation|presentations)\b/i, label: 'demo', strength: 'medium' },
  { pattern: /\b(workshop|workshops|session|sessions)\b/i, label: 'workshop', strength: 'medium' },
  { pattern: /\b(consultation|consultations)\b/i, label: 'consultation', strength: 'medium' },
  { pattern: /\b(webinar|webinars)\b/i, label: 'webinar', strength: 'medium' },

  // Platform-specific (strong because they imply video meetings)
  { pattern: /\b(zoom|google meet|teams meeting|skype|facetime|webex)\b/i, label: 'video_platform', strength: 'strong' },
  { pattern: /\bmeet\.google\.com\b/i, label: 'google_meet_url', strength: 'strong' },
  { pattern: /\bzoom\.us\b/i, label: 'zoom_url', strength: 'strong' },

  // Weak signals - social/food (need time context)
  { pattern: /\b(coffee|coffees|grab coffee|get coffee)\b/i, label: 'coffee', strength: 'weak' },
  { pattern: /\b(lunch|lunches|grab lunch)\b/i, label: 'lunch', strength: 'weak' },
  { pattern: /\b(dinner|dinners)\b/i, label: 'dinner', strength: 'weak' },
  { pattern: /\b(breakfast|brunch)\b/i, label: 'breakfast', strength: 'weak' },
  { pattern: /\b(drinks|happy hour|grab drinks)\b/i, label: 'drinks', strength: 'weak' },
  { pattern: /\b(grab a bite|get food)\b/i, label: 'food', strength: 'weak' },
  { pattern: /\b(hang out|hangout)\b/i, label: 'hangout', strength: 'weak' },
];

// Scheduling phrases (strong signals on their own)
const SCHEDULING_PHRASES: Array<{ pattern: RegExp; label: string }> = [
  // Availability questions
  { pattern: /\bare you (free|available|around)\b/i, label: 'availability_question' },
  { pattern: /\bwhen (are you|is|works|would work)\b/i, label: 'when_question' },
  { pattern: /\bwhat time (works|is good|would work)\b/i, label: 'what_time' },
  { pattern: /\bdoes .{1,30} work (for you|for your schedule)?\b/i, label: 'does_work' },
  { pattern: /\bwould .{1,30} work (for you|for your schedule)?\b/i, label: 'would_work' },
  { pattern: /\bcan (you|we) (meet|do|make)\b/i, label: 'can_meet' },
  { pattern: /\bwhat('s| is) your (availability|schedule)\b/i, label: 'ask_availability' },

  // Proposals
  { pattern: /\bhow about\b/i, label: 'how_about' },
  { pattern: /\bhow does .{1,30} (sound|work)\b/i, label: 'how_does_sound' },
  { pattern: /\blet's (schedule|set up|arrange|plan|find time|meet|chat|talk|connect)\b/i, label: 'lets_schedule' },
  { pattern: /\bshould we (meet|schedule|set up|chat|talk|connect)\b/i, label: 'should_we_meet' },
  { pattern: /\bwant to (meet|grab|get together|catch up|chat|talk|connect)\b/i, label: 'want_to_meet' },
  { pattern: /\bwould (love|like) to (meet|chat|connect|catch up|talk)\b/i, label: 'would_like_to' },
  { pattern: /\b(love|like) to (meet|connect|chat|catch up)\b/i, label: 'like_to_meet' },

  // Action phrases
  { pattern: /\bset up (a|some) time\b/i, label: 'set_up_time' },
  { pattern: /\bfind (a |some )?time\b/i, label: 'find_time' },
  { pattern: /\bblock (off |out )?(some )?time\b/i, label: 'block_time' },
  { pattern: /\bpencil (you |this )?in\b/i, label: 'pencil_in' },
  { pattern: /\bput (it |this )?on (the |your )?calendar\b/i, label: 'put_on_calendar' },
  { pattern: /\bsend (you |over )?(a |an )?(calendar )?invite\b/i, label: 'send_invite' },

  // Responses
  { pattern: /\blet me know (when|what|if|your)\b/i, label: 'let_me_know' },
  { pattern: /\bget back to (me|you)\b/i, label: 'get_back_to' },
  { pattern: /\blooking forward to (meeting|seeing|chatting|talking|connecting)\b/i, label: 'looking_forward' },
  { pattern: /\bconfirm(ing|ed)?\s+(the\s+)?(meeting|time|call|appointment)\b/i, label: 'confirming' },

  // Availability statements
  { pattern: /\bi('m| am) (free|available|open)\b/i, label: 'im_available' },
  { pattern: /\bmy (calendar|schedule) (is|looks)\b/i, label: 'my_calendar' },
  { pattern: /\bi (can|could) (do|make|meet)\b/i, label: 'i_can_do' },
];

// Negative patterns - things that suggest NOT a meeting email
const NEGATIVE_PATTERNS: RegExp[] = [
  // Unsubscribe/marketing
  /\bunsubscribe\b/i,
  /\bmarketing\s*preferences\b/i,
  /\bpromoti(on|onal)\b/i,

  // Automated/transactional
  /\bdo[\s-]*not[\s-]*reply\b/i,
  /\bnoreply@/i,
  /\bautomated (message|email|notification)\b/i,

  // Past tense meeting references (already happened)
  /\b(met|had a meeting|was great meeting)\b/i,
  /\bthanks for (meeting|your time|chatting)\b/i,

  // Calendar notifications (already scheduled)
  /\binvitation:\s/i,
  /\baccepted:\s/i,
  /\bdeclined:\s/i,
  /\bupdated invitation\b/i,
  /\bcanceled event\b/i,
];

/**
 * Detects if an email potentially contains meeting/scheduling content
 * @param text - Combined email subject and body text
 * @returns Detection result with matched patterns and confidence
 */
export function detectPotentialMeeting(text: string): MeetingDetectionResult {
  const matchedPatterns: string[] = [];

  // Check for negative patterns first
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        hasPotentialMeeting: false,
        matchedPatterns: ['negative_signal'],
        confidence: 'low'
      };
    }
  }

  // Check scheduling phrases (strong signals)
  const schedulingMatches: string[] = [];
  for (const { pattern, label } of SCHEDULING_PHRASES) {
    if (pattern.test(text)) {
      schedulingMatches.push(`scheduling:${label}`);
    }
  }

  // Check time patterns
  const timeMatches: string[] = [];
  for (const { pattern, label } of TIME_PATTERNS) {
    if (pattern.test(text)) {
      timeMatches.push(`time:${label}`);
    }
  }

  // Check meeting patterns
  const meetingMatches: { label: string; strength: 'strong' | 'medium' | 'weak' }[] = [];
  for (const { pattern, label, strength } of MEETING_PATTERNS) {
    if (pattern.test(text)) {
      meetingMatches.push({ label: `meeting:${label}`, strength });
    }
  }

  // Determine if this is a potential meeting email
  const hasSchedulingPhrase = schedulingMatches.length > 0;
  const hasTimeIndicator = timeMatches.length > 0;
  const strongMeetingWords = meetingMatches.filter(m => m.strength === 'strong');
  const mediumMeetingWords = meetingMatches.filter(m => m.strength === 'medium');
  const weakMeetingWords = meetingMatches.filter(m => m.strength === 'weak');
  const hasMeetingWord = meetingMatches.length > 0;

  let hasPotentialMeeting = false;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  // Decision logic (ordered by confidence)
  if (strongMeetingWords.length > 0 && (hasTimeIndicator || hasSchedulingPhrase)) {
    // Strong meeting word + time/scheduling = high confidence
    hasPotentialMeeting = true;
    confidence = 'high';
  } else if (hasSchedulingPhrase && hasMeetingWord) {
    // Scheduling phrase + any meeting word = high confidence
    hasPotentialMeeting = true;
    confidence = 'high';
  } else if (strongMeetingWords.length >= 2) {
    // Multiple strong meeting signals = high confidence
    hasPotentialMeeting = true;
    confidence = 'high';
  } else if (strongMeetingWords.length > 0 && (mediumMeetingWords.length > 0 || weakMeetingWords.length > 0)) {
    // Strong + another meeting word = high confidence
    hasPotentialMeeting = true;
    confidence = 'high';
  } else if (strongMeetingWords.length > 0) {
    // Strong meeting word alone = medium confidence
    hasPotentialMeeting = true;
    confidence = 'medium';
  } else if (hasSchedulingPhrase) {
    // Scheduling phrase alone = medium confidence
    hasPotentialMeeting = true;
    confidence = 'medium';
  } else if (mediumMeetingWords.length > 0 && hasTimeIndicator) {
    // Medium meeting word + time = medium confidence
    hasPotentialMeeting = true;
    confidence = 'medium';
  } else if (weakMeetingWords.length > 0 && hasTimeIndicator) {
    // Weak meeting word + time = low confidence (but still flag it)
    hasPotentialMeeting = true;
    confidence = 'low';
  } else if (meetingMatches.length >= 2) {
    // Multiple meeting words without time = low confidence
    hasPotentialMeeting = true;
    confidence = 'low';
  }

  // Collect all matched patterns
  matchedPatterns.push(...schedulingMatches);
  matchedPatterns.push(...timeMatches);
  matchedPatterns.push(...meetingMatches.map(m => m.label));

  return {
    hasPotentialMeeting,
    matchedPatterns,
    confidence
  };
}

/**
 * Convenience function to check email with subject and body separately
 */
export function detectMeetingInEmail(subject: string, body: string): MeetingDetectionResult {
  const combinedText = `${subject}\n\n${body}`;
  return detectPotentialMeeting(combinedText);
}
