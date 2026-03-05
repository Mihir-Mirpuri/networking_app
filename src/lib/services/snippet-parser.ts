/**
 * Serper Snippet Parser
 *
 * Extracts structured metadata from Serper search result titles and snippets.
 * Replaces CSE metatag parsing (profile:first_name, og:description) which
 * Serper doesn't provide.
 *
 * LinkedIn title format: "Name - Role - Company | LinkedIn"
 * LinkedIn snippet format: "Experience: Company · Education: School · Location: City"
 */

/**
 * Parse a LinkedIn title to extract the person's name.
 *
 * Common LinkedIn title patterns:
 * - "John Smith - Software Engineer - Google | LinkedIn"
 * - "Jane Doe | LinkedIn"
 * - "John Smith - Product Manager at Meta | LinkedIn"
 */
export function parseSerperTitle(title: string): {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
} | null {
  if (!title) return null;

  // Pattern 1: "Name - ..." or "Name | ..." (standard LinkedIn format)
  const match = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s*[-–|]/);
  if (match) {
    const parts = parseNameParts(match[1]);
    if (parts) return parts;
  }

  // Pattern 2: Try to find capitalized name at start
  const fallback = title.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (fallback) {
    const parts = parseNameParts(fallback[1]);
    if (parts) return parts;
  }

  return null;
}

function parseNameParts(nameStr: string): {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
} | null {
  // Remove common titles
  const cleaned = nameStr.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Professor)\s+/i, '').trim();
  const parts = cleaned.split(/\s+/);

  if (parts.length < 2) return null;

  return {
    fullName: cleaned,
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

/**
 * Parse Serper snippet to extract structured metadata.
 *
 * LinkedIn snippets typically contain:
 * "... · Experience: Google · Education: Stanford University · Location: San Francisco, California"
 * or variations thereof.
 */
export function parseSnippetMetadata(snippet: string): {
  company: string | null;
  school: string | null;
  location: string | null;
} {
  if (!snippet) return { company: null, school: null, location: null };

  let company: string | null = null;
  let school: string | null = null;
  let location: string | null = null;

  // Extract company from "Experience: X" pattern
  const expMatch = snippet.match(/Experience:\s*([^·]+)/);
  if (expMatch) {
    company = expMatch[1].trim() || null;
  }

  // Extract school from "Education: X" pattern
  const eduMatch = snippet.match(/Education:\s*([^·]+)/);
  if (eduMatch) {
    school = eduMatch[1].trim() || null;
  }

  // Extract location from "Location: X" pattern
  const locMatch = snippet.match(/Location:\s*([^·]+)/);
  if (locMatch) {
    location = locMatch[1].trim() || null;
  }

  return { company, school, location };
}
