import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database with demo data...');

  // Create a demo user
  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      name: 'Demo User',
    },
  });

  console.log('Created demo user:', user.email);

  // Create a demo campaign
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      name: 'Goldman Sachs Outreach - Demo',
      school: 'Harvard University',
      company: 'Goldman Sachs',
      roleKeywords: ['analyst', 'associate', 'investment banking'],
      status: 'READY',
      discoveryProgress: 100,
      enrichmentProgress: 100,
      templateSubject: 'Reaching out from {school}',
      templateBody: `Hi {first_name},

I'm a student at {school} and I'm very interested in learning more about your experience at {company}. I've been researching careers in investment banking and would love to hear about your journey.

Would you be open to a brief 15-minute call sometime in the next few weeks?

Best regards`,
    },
  });

  console.log('Created demo campaign:', campaign.name);

  // Create demo candidates with various statuses
  const candidatesData = [
    {
      fullName: 'John Smith',
      firstName: 'John',
      lastName: 'Smith',
      company: 'Goldman Sachs',
      role: 'Vice President',
      email: 'john.smith@gs.com',
      emailStatus: 'VERIFIED' as const,
      emailConfidence: 0.95,
    },
    {
      fullName: 'Sarah Johnson',
      firstName: 'Sarah',
      lastName: 'Johnson',
      company: 'Goldman Sachs',
      role: 'Associate',
      email: 'sarah.johnson@gs.com',
      emailStatus: 'VERIFIED' as const,
      emailConfidence: 0.92,
    },
    {
      fullName: 'Michael Chen',
      firstName: 'Michael',
      lastName: 'Chen',
      company: 'Goldman Sachs',
      role: 'Analyst',
      email: 'michael.chen@gs.com',
      emailStatus: 'UNVERIFIED' as const,
      emailConfidence: 0.6,
    },
    {
      fullName: 'Emily Davis',
      firstName: 'Emily',
      lastName: 'Davis',
      company: 'Goldman Sachs',
      role: 'Director',
      email: null,
      emailStatus: 'MISSING' as const,
      emailConfidence: null,
    },
    {
      fullName: 'Robert Wilson',
      firstName: 'Robert',
      lastName: 'Wilson',
      company: 'Goldman Sachs',
      role: 'Managing Director',
      email: 'rwilson@gmail.com',
      emailStatus: 'MANUAL' as const,
      emailConfidence: null,
      manualEmailConfirmed: true,
    },
    {
      fullName: 'Jennifer Lee',
      firstName: 'Jennifer',
      lastName: 'Lee',
      company: 'Goldman Sachs',
      role: 'Senior Associate',
      email: 'jennifer.lee@gs.com',
      emailStatus: 'VERIFIED' as const,
      emailConfidence: 0.88,
    },
    {
      fullName: 'David Brown',
      firstName: 'David',
      lastName: 'Brown',
      company: 'Goldman Sachs',
      role: 'Analyst',
      email: 'david.brown@gs.com',
      emailStatus: 'VERIFIED' as const,
      emailConfidence: 0.91,
    },
    {
      fullName: 'Amanda Taylor',
      firstName: 'Amanda',
      lastName: 'Taylor',
      company: 'Goldman Sachs',
      role: 'Associate',
      email: null,
      emailStatus: 'MISSING' as const,
      emailConfidence: null,
    },
  ];

  for (const data of candidatesData) {
    const candidate = await prisma.candidate.create({
      data: {
        campaignId: campaign.id,
        ...data,
        sourceLinks: {
          create: [
            {
              kind: 'DISCOVERY',
              url: `https://www.linkedin.com/in/${data.firstName?.toLowerCase()}-${data.lastName?.toLowerCase()}`,
              title: `${data.fullName} - ${data.role} at ${data.company}`,
              snippet: `${data.fullName} is a ${data.role} at ${data.company}. Harvard University alumnus.`,
              domain: 'linkedin.com',
            },
            {
              kind: 'RESEARCH',
              url: `https://www.google.com/search?q=${encodeURIComponent(data.fullName + ' ' + data.company)}`,
              title: `${data.fullName} ${data.company} - Google Search`,
              snippet: `Search results for ${data.fullName} at ${data.company}`,
              domain: 'google.com',
            },
          ],
        },
        emailDraft: {
          create: {
            subject: campaign.templateSubject
              .replace(/{first_name}/g, data.firstName || 'there')
              .replace(/{company}/g, campaign.company)
              .replace(/{school}/g, campaign.school),
            body: campaign.templateBody
              .replace(/{first_name}/g, data.firstName || 'there')
              .replace(/{company}/g, campaign.company)
              .replace(/{school}/g, campaign.school),
          },
        },
      },
    });

    console.log('Created candidate:', candidate.fullName);
  }

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
