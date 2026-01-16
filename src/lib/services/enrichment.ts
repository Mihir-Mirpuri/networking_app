const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

interface ApolloPersonMatch {
  email: string;
  email_status: string;
  confidence: number;
}

interface ApolloResponse {
  person?: ApolloPersonMatch;
  error?: string;
}

export interface EmailResult {
  email: string | null;
  status: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
  confidence: number;
}

export async function findEmail(
  firstName: string,
  lastName: string,
  company: string
): Promise<EmailResult> {
  if (!APOLLO_API_KEY) {
    console.log('No Apollo API key - skipping email lookup');
    return { email: null, status: 'MISSING', confidence: 0 };
  }

  console.log(`Looking up email for: ${firstName} ${lastName} at ${company}`);

  try {
    const response = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': APOLLO_API_KEY,
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        organization_name: company,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Apollo API error:', response.status, errorText);
      return { email: null, status: 'MISSING', confidence: 0 };
    }

    const data: ApolloResponse = await response.json();

    if (data.person?.email) {
      const isVerified = data.person.email_status === 'verified';
      console.log(`Found email: ${data.person.email} (${isVerified ? 'verified' : 'unverified'})`);
      return {
        email: data.person.email,
        status: isVerified ? 'VERIFIED' : 'UNVERIFIED',
        confidence: data.person.confidence || 0,
      };
    }

    console.log(`No email found for ${firstName} ${lastName}`);
    return { email: null, status: 'MISSING', confidence: 0 };
  } catch (error) {
    console.error('Apollo enrichment error:', error);
    return { email: null, status: 'MISSING', confidence: 0 };
  }
}

export interface PersonToEnrich {
  firstName: string | null;
  lastName: string | null;
  company: string;
}

export async function enrichPeople(
  people: PersonToEnrich[]
): Promise<Map<string, EmailResult>> {
  const results = new Map<string, EmailResult>();

  for (const person of people) {
    if (!person.firstName || !person.lastName) {
      const key = `${person.firstName || ''}_${person.lastName || ''}_${person.company}`;
      results.set(key, { email: null, status: 'MISSING', confidence: 0 });
      continue;
    }

    const key = `${person.firstName}_${person.lastName}_${person.company}`;
    const result = await findEmail(person.firstName, person.lastName, person.company);
    results.set(key, result);

    // Rate limiting between API calls
    await new Promise((r) => setTimeout(r, 300));
  }

  return results;
}
