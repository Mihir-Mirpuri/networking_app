import { gmail_v1 } from 'googleapis';

/**
 * Parsed Gmail message ready for database insertion
 */
export interface ParsedGmailMessage {
  subject: string | null;
  sender: string; // Email address only
  senderName: string | null; // Extracted name if available
  recipient_list: string[]; // Array of email addresses
  recipientNames: Array<{ email: string; name: string | null }>; // Names for recipients
  body_html: string | null;
  body_text: string | null;
  received_at: Date;
}

/**
 * Decodes base64url-encoded string to UTF-8 string
 * Gmail API uses base64url (URL-safe base64), not standard base64
 */
function decodeBase64Url(base64Url: string): string {
  try {
    // Convert base64url to standard base64
    // Replace URL-safe characters: - -> +, _ -> /
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if needed
    while (base64.length % 4) {
      base64 += '=';
    }
    
    // Decode base64 to buffer, then to UTF-8 string
    const buffer = Buffer.from(base64, 'base64');
    return buffer.toString('utf-8');
  } catch (error) {
    console.warn('[Gmail Parser] Failed to decode base64url:', error);
    return '';
  }
}

/**
 * Parses a single email address from header value
 * Handles formats like:
 * - "John Doe <john@example.com>"
 * - "john@example.com"
 * - "John Doe" (name only, no email)
 */
function parseEmailAddress(headerValue: string): { email: string; name: string | null } {
  if (!headerValue || typeof headerValue !== 'string') {
    return { email: '', name: null };
  }
  
  const trimmed = headerValue.trim();
  
  // Pattern: "Name <email@domain.com>"
  const angleBracketMatch = trimmed.match(/^(.+?)\s*<(.+?)>$/);
  if (angleBracketMatch) {
    const name = angleBracketMatch[1].trim().replace(/^["']|["']$/g, ''); // Remove quotes
    const email = angleBracketMatch[2].trim();
    return { email, name: name || null };
  }
  
  // Pattern: Just email address
  const emailRegex = /^[^\s<>]+@[^\s<>]+\.[^\s<>]+$/;
  if (emailRegex.test(trimmed)) {
    return { email: trimmed, name: null };
  }
  
  // Pattern: Just name (no email) - return empty email
  return { email: '', name: trimmed || null };
}

/**
 * Parses a list of email addresses from header value
 * Handles comma-separated lists like:
 * - "John <john@example.com>, Jane <jane@example.com>"
 * - "john@example.com, jane@example.com"
 */
function parseEmailList(headerValue: string): Array<{ email: string; name: string | null }> {
  if (!headerValue || typeof headerValue !== 'string') {
    return [];
  }
  
  // Split by comma, but be careful with commas inside angle brackets
  const addresses: Array<{ email: string; name: string | null }> = [];
  let current = '';
  let inAngleBrackets = false;
  
  for (let i = 0; i < headerValue.length; i++) {
    const char = headerValue[i];
    
    if (char === '<') {
      inAngleBrackets = true;
      current += char;
    } else if (char === '>') {
      inAngleBrackets = false;
      current += char;
    } else if (char === ',' && !inAngleBrackets) {
      // Found a comma outside angle brackets - split here
      const parsed = parseEmailAddress(current.trim());
      if (parsed.email) {
        addresses.push(parsed);
      }
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add the last address
  if (current.trim()) {
    const parsed = parseEmailAddress(current.trim());
    if (parsed.email) {
      addresses.push(parsed);
    }
  }
  
  return addresses;
}

/**
 * Extracts header value by name (case-insensitive)
 */
function getHeaderValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
  if (!headers || !Array.isArray(headers)) {
    return null;
  }
  
  const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || null;
}

/**
 * Recursively extracts HTML and text bodies from message parts
 * Prioritizes HTML over plain text when both exist
 */
function extractBodyFromParts(parts: gmail_v1.Schema$MessagePart[] | undefined): { html: string | null; text: string | null } {
  if (!parts || !Array.isArray(parts)) {
    return { html: null, text: null };
  }
  
  let html: string | null = null;
  let text: string | null = null;
  
  for (const part of parts) {
    const mimeType = part.mimeType || '';
    
    // If this part has nested parts, recurse
    if (part.parts && part.parts.length > 0) {
      const nested = extractBodyFromParts(part.parts);
      if (nested.html && !html) html = nested.html;
      if (nested.text && !text) text = nested.text;
      continue;
    }
    
    // Check if this is a body part we want
    if (mimeType === 'text/html' && part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (decoded && !html) {
        html = decoded;
      }
    } else if (mimeType === 'text/plain' && part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (decoded && !text) {
        text = decoded;
      }
    }
  }
  
  return { html, text };
}

/**
 * Parses a Gmail API message response into a clean format ready for database insertion
 * 
 * @param message - Gmail API message object (gmail_v1.Schema$Message)
 * @returns Parsed message with extracted headers and decoded body content
 */
export function parseGmailResponse(message: gmail_v1.Schema$Message): ParsedGmailMessage {
  const payload = message.payload;
  
  if (!payload) {
    throw new Error(
      'Message payload is missing. ' +
      'Make sure you fetched the message with format="full" in the Gmail API. ' +
      'The payload field contains the headers and body content needed for parsing.'
    );
  }
  
  const headers = payload.headers || [];
  
  // Extract headers
  const subject = getHeaderValue(headers, 'Subject');
  const fromHeader = getHeaderValue(headers, 'From');
  const toHeader = getHeaderValue(headers, 'To');
  const dateHeader = getHeaderValue(headers, 'Date');
  
  // Parse email addresses
  const fromParsed = fromHeader ? parseEmailAddress(fromHeader) : { email: '', name: null };
  const toParsed = toHeader ? parseEmailList(toHeader) : [];
  
  // Parse date
  let receivedAt: Date;
  if (dateHeader) {
    try {
      receivedAt = new Date(dateHeader);
      // Validate date
      if (isNaN(receivedAt.getTime())) {
        console.warn('[Gmail Parser] Invalid date header, using current date:', dateHeader);
        receivedAt = new Date();
      }
    } catch (error) {
      console.warn('[Gmail Parser] Failed to parse date header, using current date:', dateHeader);
      receivedAt = new Date();
    }
  } else {
    // Fallback to internalDate if available (milliseconds since epoch)
    if (message.internalDate) {
      receivedAt = new Date(parseInt(message.internalDate, 10));
    } else {
      console.warn('[Gmail Parser] No date header or internalDate, using current date');
      receivedAt = new Date();
    }
  }
  
  // Extract body content
  let bodyHtml: string | null = null;
  let bodyText: string | null = null;
  
  // Check if this is a single-part message (body.data exists directly)
  if (payload.body?.data && !payload.parts) {
    const mimeType = payload.mimeType || '';
    const decoded = decodeBase64Url(payload.body.data);
    
    if (mimeType === 'text/html') {
      bodyHtml = decoded;
    } else if (mimeType === 'text/plain') {
      bodyText = decoded;
    }
  }
  
  // Check multipart message (parts array)
  if (payload.parts && payload.parts.length > 0) {
    const extracted = extractBodyFromParts(payload.parts);
    bodyHtml = extracted.html;
    bodyText = extracted.text;
  }
  
  // Build recipient list (email addresses only)
  const recipientList = toParsed
    .map(parsed => parsed.email)
    .filter(email => email.length > 0);
  
  // Build recipient names array
  const recipientNames = toParsed
    .filter(parsed => parsed.email.length > 0)
    .map(parsed => ({ email: parsed.email, name: parsed.name }));
  
  return {
    subject: subject || null,
    sender: fromParsed.email || '',
    senderName: fromParsed.name,
    recipient_list: recipientList,
    recipientNames,
    body_html: bodyHtml,
    body_text: bodyText,
    received_at: receivedAt,
  };
}
