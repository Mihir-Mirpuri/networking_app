import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

async function main() {
  // Get the 2 people
  const people = await prisma.person.findMany({
    where: {
      fullName: { in: ['Lori Cunningham', 'Mary Harvey'] },
      company: 'Accenture'
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      linkedinUrl: true,
      company: true
    }
  });

  console.log('Found', people.length, 'people to re-enrich');
  console.log('');

  for (const person of people) {
    console.log('='.repeat(60));
    console.log('ENRICHING:', person.fullName);
    console.log('Current company:', person.company);
    console.log('='.repeat(60));

    // Call Apollo API directly to see raw response
    const requestBody = {
      first_name: person.firstName,
      last_name: person.lastName,
      organization_name: 'Accenture',
      linkedin_url: person.linkedinUrl
    };

    console.log('\nRequest:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': APOLLO_API_KEY as string
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    console.log('\n>>> RAW APOLLO RESPONSE <<<');
    console.log(JSON.stringify(data, null, 2));

    if (data.person) {
      const p = data.person;
      console.log('\n>>> PARSED DATA <<<');
      console.log('Email:', p.email || 'none');
      console.log('Email Status:', p.email_status || 'none');
      console.log('City:', p.city || 'none');
      console.log('State:', p.state || 'none');
      console.log('Country:', p.country || 'none');
      console.log('Employment:', JSON.stringify(p.employment_history, null, 2));
      console.log('Education:', JSON.stringify(p.education, null, 2));

      // Get current employment
      const currentJob = p.employment_history?.find((j: any) => j.current) || p.employment_history?.[0];
      const apolloCompany = currentJob?.organization_name || null;
      const apolloRole = currentJob?.title || null;

      console.log('\n>>> RESOLVED VALUES <<<');
      console.log('Apollo Company:', apolloCompany);
      console.log('Apollo Role:', apolloRole);

      // Update the person
      await prisma.person.update({
        where: { id: person.id },
        data: {
          company: apolloCompany || person.company,
          role: apolloRole || undefined,
          email: p.email || undefined,
          city: p.city || undefined,
          state: p.state || undefined,
          country: p.country || undefined,
          apolloStatus: 'SUCCESS',
          apolloEnrichedAt: new Date()
        }
      });

      console.log('\n✅ Updated company from', person.company, 'to', apolloCompany);
    }

    console.log('\n');
    await new Promise(r => setTimeout(r, 500));
  }

  // Verify final state
  console.log('='.repeat(60));
  console.log('FINAL DATABASE STATE');
  console.log('='.repeat(60));

  const updated = await prisma.person.findMany({
    where: { fullName: { in: ['Lori Cunningham', 'Mary Harvey'] } },
    select: { fullName: true, company: true, role: true, email: true, city: true }
  });

  for (const p of updated) {
    console.log(p.fullName + ':');
    console.log('  Company:', p.company);
    console.log('  Role:', p.role);
    console.log('  Email:', p.email);
    console.log('  City:', p.city);
  }

  await prisma.$disconnect();
}
main();
