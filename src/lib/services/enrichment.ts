const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

interface ApolloEducation {
  degree?: string;
  field_of_study?: string;
  school_name?: string;
  start_date?: string;
  end_date?: string;
  grade_level?: string;
}

interface ApolloPersonMatch {
  email: string;
  email_status: string;
  confidence: number;
  city?: string;
  state?: string;
  country?: string;
  employment_history?: Array<{
    organization_name?: string;
    title?: string;
    start_date?: string;
    end_date?: string;
    current?: boolean;
  }>;
  education?: ApolloEducation[];
}

interface ApolloResponse {
  person?: ApolloPersonMatch;
  error?: string;
}

export interface EducationInfo {
  degree: string | null;
  fieldOfStudy: string | null;
  schoolName: string | null;
  graduationYear: string | null;
}

export interface EmailResult {
  email: string | null;
  status: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
  confidence: number;
  city: string | null;
  state: string | null;
  country: string | null;
  education: EducationInfo | null;
}

export interface FindEmailParams {
  firstName: string;
  lastName: string;
  company: string;
  linkedinUrl?: string | null;
}

function parseEducation(education?: ApolloEducation[]): EducationInfo | null {
  if (!education || education.length === 0) {
    return null;
  }

  // Get the most recent education entry (usually the last one or one with end_date)
  const sortedEducation = [...education].sort((a, b) => {
    // Prefer entries with end dates, sorted descending
    const aYear = a.end_date ? parseInt(a.end_date) : 0;
    const bYear = b.end_date ? parseInt(b.end_date) : 0;
    return bYear - aYear;
  });

  const latestEdu = sortedEducation[0];

  return {
    degree: latestEdu.degree || latestEdu.grade_level || null,
    fieldOfStudy: latestEdu.field_of_study || null,
    schoolName: latestEdu.school_name || null,
    graduationYear: latestEdu.end_date || null,
  };
}

export async function findEmail(params: FindEmailParams): Promise<EmailResult> {
  const { firstName, lastName, company, linkedinUrl } = params;

  const emptyResult: EmailResult = {
    email: null,
    status: 'MISSING',
    confidence: 0,
    city: null,
    state: null,
    country: null,
    education: null,
  };

  if (!APOLLO_API_KEY) {
    console.log('No Apollo API key - skipping email lookup');
    return emptyResult;
  }

  console.log(`Looking up email for: ${firstName} ${lastName} at ${company}${linkedinUrl ? ` (LinkedIn: ${linkedinUrl})` : ''}`);

  try {
    // Build request body with optional LinkedIn URL
    const requestBody: Record<string, string> = {
      first_name: firstName,
      last_name: lastName,
      organization_name: company,
    };

    // Add LinkedIn URL if available - this provides much more accurate matching
    if (linkedinUrl) {
      requestBody.linkedin_url = linkedinUrl;
    }

    const response = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': APOLLO_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Apollo API error:', response.status, errorText);
      return emptyResult;
    }

    const data: ApolloResponse = await response.json();

    if (data.person) {
      const person = data.person;
      const isVerified = person.email_status === 'verified';
      const education = parseEducation(person.education);

      // Build location string for logging
      const locationParts = [person.city, person.state, person.country].filter(Boolean);
      const locationStr = locationParts.length > 0 ? locationParts.join(', ') : 'unknown';

      console.log(`Found: ${person.email || 'no email'} (${isVerified ? 'verified' : 'unverified'}), location: ${locationStr}, education: ${education?.schoolName || 'unknown'}`);

      return {
        email: person.email || null,
        status: person.email ? (isVerified ? 'VERIFIED' : 'UNVERIFIED') : 'MISSING',
        confidence: person.confidence || 0,
        city: person.city || null,
        state: person.state || null,
        country: person.country || null,
        education,
      };
    }

    console.log(`No person found for ${firstName} ${lastName}`);
    return emptyResult;
  } catch (error) {
    console.error('Apollo enrichment error:', error);
    return emptyResult;
  }
}

export interface PersonToEnrich {
  firstName: string | null;
  lastName: string | null;
  company: string;
  linkedinUrl?: string | null;
}

export async function enrichPeople(
  people: PersonToEnrich[]
): Promise<Map<string, EmailResult>> {
  const results = new Map<string, EmailResult>();

  for (const person of people) {
    if (!person.firstName || !person.lastName) {
      const key = `${person.firstName || ''}_${person.lastName || ''}_${person.company}`;
      results.set(key, {
        email: null,
        status: 'MISSING',
        confidence: 0,
        city: null,
        state: null,
        country: null,
        education: null,
      });
      continue;
    }

    const key = `${person.firstName}_${person.lastName}_${person.company}`;
    const result = await findEmail({
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      linkedinUrl: person.linkedinUrl,
    });
    results.set(key, result);

    // Rate limiting between API calls
    await new Promise((r) => setTimeout(r, 300));
  }

  return results;
}
