import prisma from '@/lib/prisma';

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
console.log('Apollo API Key configured:', APOLLO_API_KEY ? 'Yes' : 'No');

interface ApolloPersonMatch {
  email: string;
  email_status: string;
  confidence: number;
}

interface ApolloResponse {
  person?: ApolloPersonMatch;
  error?: string;
}

async function enrichWithApollo(
  firstName: string,
  lastName: string,
  company: string
): Promise<{ email: string | null; status: 'VERIFIED' | 'UNVERIFIED'; confidence: number } | null> {
  if (!APOLLO_API_KEY) {
    console.log('No Apollo API key - skipping enrichment');
    return null;
  }

  console.log(`Enriching: ${firstName} ${lastName} at ${company}`);

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
      return null;
    }

    const data: ApolloResponse = await response.json();
    console.log(`Apollo response for ${firstName} ${lastName}:`, JSON.stringify(data, null, 2));

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
    return null;
  } catch (error) {
    console.error('Apollo enrichment error:', error);
    return null;
  }
}

export async function runEnrichment(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { candidates: true },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const candidates = campaign.candidates;
  let enrichedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    if (!candidate.firstName || !candidate.lastName) {
      continue;
    }

    if (!APOLLO_API_KEY) {
      // Mark as missing if no API key
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { emailStatus: 'MISSING' },
      });
      continue;
    }

    const result = await enrichWithApollo(
      candidate.firstName,
      candidate.lastName,
      candidate.company
    );

    if (result) {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          email: result.email,
          emailStatus: result.status,
          emailConfidence: result.confidence,
        },
      });
      enrichedCount++;
    } else {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { emailStatus: 'UNVERIFIED' },
      });
    }

    // Update progress
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        enrichmentProgress: Math.round(((i + 1) / candidates.length) * 100),
      },
    });

    // Rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  // Update campaign status
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: 'READY',
      enrichmentProgress: 100,
    },
  });

  return enrichedCount;
}
