import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

const people = [
  { firstName: 'Lori', lastName: 'Cunningham', linkedinUrl: 'https://www.linkedin.com/in/loricunningham2' },
  { firstName: 'Mary', lastName: 'Harvey', linkedinUrl: 'https://www.linkedin.com/in/maryeharvey' },
];

async function main() {
  console.log('Running 2 Apollo API calls...\n');

  for (const person of people) {
    console.log('='.repeat(60));
    console.log(`ENRICHING: ${person.firstName} ${person.lastName}`);
    console.log('='.repeat(60));

    const response = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': APOLLO_API_KEY as string
      },
      body: JSON.stringify({
        first_name: person.firstName,
        last_name: person.lastName,
        linkedin_url: person.linkedinUrl
      })
    });

    const data = await response.json();

    if (data.person) {
      const p = data.person;

      // Get current employment
      const currentJob = p.employment_history?.find((j: any) => j.current) || p.employment_history?.[0];

      console.log('\n>>> APOLLO DATA <<<');
      console.log('Email:', p.email || 'none');
      console.log('City:', p.city || 'none');
      console.log('State:', p.state || 'none');
      console.log('Country:', p.country || 'none');
      console.log('Current Company:', currentJob?.organization_name || 'none');
      console.log('Current Role:', currentJob?.title || 'none');
      console.log('Education:', JSON.stringify(p.education, null, 2));

      // Parse education
      let educationSchool = null;
      let educationDegree = null;
      let educationField = null;
      let educationYear = null;

      if (p.education && p.education.length > 0) {
        const edu = p.education[0];
        educationSchool = edu.school_name || null;
        educationDegree = edu.degree || edu.grade_level || null;
        educationField = edu.field_of_study || null;
        educationYear = edu.end_date || null;
      }

      // Create new person record
      const newPerson = await prisma.person.create({
        data: {
          fullName: `${person.firstName} ${person.lastName}`,
          firstName: person.firstName,
          lastName: person.lastName,
          linkedinUrl: person.linkedinUrl,
          company: currentJob?.organization_name || 'Unknown',
          role: currentJob?.title || null,
          email: p.email || null,
          emailStatus: p.email ? (p.email_status === 'verified' ? 'VERIFIED' : 'UNVERIFIED') : 'MISSING',
          emailConfidence: p.confidence || 0,
          city: p.city || null,
          state: p.state || null,
          country: p.country || null,
          educationSchool,
          educationDegree,
          educationField,
          educationYear,
          apolloStatus: 'SUCCESS',
          apolloEnrichedAt: new Date()
        }
      });

      console.log('\n✅ Created new Person record:');
      console.log('  ID:', newPerson.id);
      console.log('  Company:', newPerson.company);
      console.log('  Role:', newPerson.role);
      console.log('  Education:', newPerson.educationSchool);
    } else {
      console.log('No data returned from Apollo');
    }

    console.log('\n');
    await new Promise(r => setTimeout(r, 300));
  }

  // Final state
  console.log('='.repeat(60));
  console.log('FINAL DATABASE STATE');
  console.log('='.repeat(60));

  const created = await prisma.person.findMany({
    where: { fullName: { in: ['Lori Cunningham', 'Mary Harvey'] } },
    select: { fullName: true, company: true, role: true, email: true, city: true, educationSchool: true }
  });

  for (const p of created) {
    console.log(`\n${p.fullName}:`);
    console.log('  Company:', p.company);
    console.log('  Role:', p.role);
    console.log('  Email:', p.email);
    console.log('  City:', p.city);
    console.log('  Education:', p.educationSchool);
  }

  await prisma.$disconnect();
}
main();
