import { PrismaClient } from '@prisma/client';
import { EMAIL_TEMPLATES } from '../src/lib/constants';

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

  // Create email templates for the demo user
  console.log('Creating email templates...');
  for (let i = 0; i < EMAIL_TEMPLATES.length; i++) {
    const template = EMAIL_TEMPLATES[i];

    // Store template as JSON in prompt field
    const prompt = JSON.stringify({
      subject: template.subject,
      body: template.body,
    });

    // Check if template with this name already exists for the user
    const existingTemplate = await prisma.emailTemplate.findFirst({
      where: {
        userId: user.id,
        name: template.name,
      },
    });

    if (existingTemplate) {
      // Update existing template
      await prisma.emailTemplate.update({
        where: { id: existingTemplate.id },
        data: { prompt },
      });
    } else {
      // Create new template
      await prisma.emailTemplate.create({
        data: {
          userId: user.id,
          name: template.name,
          prompt: prompt,
          isDefault: i === 0, // First template is default
        },
      });
    }

    console.log(`Created template: ${template.name}`);
  }

  // Get the default template for creating drafts
  const defaultTemplate = await prisma.emailTemplate.findFirst({
    where: {
      userId: user.id,
      isDefault: true,
    },
  });

  const university = 'Harvard University';
  const company = 'Goldman Sachs';

  // Demo people data with various email statuses
  const peopleData = [
    {
      fullName: 'John Smith',
      firstName: 'John',
      lastName: 'Smith',
      company: company,
      role: 'Vice President',
      linkedinUrl: 'https://www.linkedin.com/in/john-smith',
      email: 'john.smith@gs.com',
      emailStatus: 'VERIFIED' as const,
      emailConfidence: 0.95,
      university: university,
    },
    {
      fullName: 'Sarah Johnson',
      firstName: 'Sarah',
      lastName: 'Johnson',
      company: company,
      role: 'Associate',
      linkedinUrl: 'https://www.linkedin.com/in/sarah-johnson',
      email: 'sarah.johnson@gs.com',
      emailStatus: 'VERIFIED' as const,
      emailConfidence: 0.92,
      university: university,
    },
    {
      fullName: 'Michael Chen',
      firstName: 'Michael',
      lastName: 'Chen',
      company: company,
      role: 'Analyst',
      linkedinUrl: 'https://www.linkedin.com/in/michael-chen',
      email: 'michael.chen@gs.com',
      emailStatus: 'UNVERIFIED' as const,
      emailConfidence: 0.6,
      university: university,
    },
    {
      fullName: 'Emily Davis',
      firstName: 'Emily',
      lastName: 'Davis',
      company: company,
      role: 'Director',
      linkedinUrl: 'https://www.linkedin.com/in/emily-davis',
      email: null,
      emailStatus: 'MISSING' as const,
      emailConfidence: null,
      university: university,
    },
    {
      fullName: 'Robert Wilson',
      firstName: 'Robert',
      lastName: 'Wilson',
      company: company,
      role: 'Managing Director',
      linkedinUrl: 'https://www.linkedin.com/in/robert-wilson',
      email: 'rwilson@gmail.com',
      emailStatus: 'MANUAL' as const,
      emailConfidence: null,
      manualEmailConfirmed: true,
      university: university,
    },
    {
      fullName: 'Jennifer Lee',
      firstName: 'Jennifer',
      lastName: 'Lee',
      company: company,
      role: 'Senior Associate',
      linkedinUrl: 'https://www.linkedin.com/in/jennifer-lee',
      email: 'jennifer.lee@gs.com',
      emailStatus: 'VERIFIED' as const,
      emailConfidence: 0.88,
      university: university,
    },
    {
      fullName: 'David Brown',
      firstName: 'David',
      lastName: 'Brown',
      company: company,
      role: 'Analyst',
      linkedinUrl: 'https://www.linkedin.com/in/david-brown',
      email: 'david.brown@gs.com',
      emailStatus: 'VERIFIED' as const,
      emailConfidence: 0.91,
      university: university,
    },
    {
      fullName: 'Amanda Taylor',
      firstName: 'Amanda',
      lastName: 'Taylor',
      company: company,
      role: 'Associate',
      linkedinUrl: 'https://www.linkedin.com/in/amanda-taylor',
      email: null,
      emailStatus: 'MISSING' as const,
      emailConfidence: null,
      university: university,
    },
  ];

  // Generate draft subject and body using the default template
  const generateDraft = (person: typeof peopleData[0]) => {
    const firstName = person.firstName || 'there';
    const templateData = defaultTemplate
      ? JSON.parse(defaultTemplate.prompt)
      : { subject: 'Reaching out from {university}', body: 'Hi {first_name}, ...' };

    const subject = templateData.subject
      .replace(/{first_name}/g, firstName)
      .replace(/{company}/g, person.company)
      .replace(/{university}/g, university)
      .replace(/{role}/g, person.role || '');

    const body = templateData.body
      .replace(/{first_name}/g, firstName)
      .replace(/{company}/g, person.company)
      .replace(/{university}/g, university)
      .replace(/{role}/g, person.role || '');

    return { subject, body };
  };

  // Create Person, UserCandidate, SourceLink, and EmailDraft for each person
  for (const personData of peopleData) {
    // 1. Create or update Person (shared)
    const person = await prisma.person.upsert({
      where: {
        fullName_company: {
          fullName: personData.fullName,
          company: personData.company,
        },
      },
      create: {
        fullName: personData.fullName,
        firstName: personData.firstName,
        lastName: personData.lastName,
        company: personData.company,
        role: personData.role,
        linkedinUrl: personData.linkedinUrl,
      },
      update: {
        role: personData.role,
        linkedinUrl: personData.linkedinUrl,
      },
    });

    // 2. Create SourceLink records
    await prisma.sourceLink.upsert({
      where: {
        personId_url: {
          personId: person.id,
          url: personData.linkedinUrl,
        },
      },
      create: {
        personId: person.id,
        kind: 'DISCOVERY',
        url: personData.linkedinUrl,
        title: `${personData.fullName} - ${personData.role} at ${personData.company}`,
        snippet: `${personData.fullName} is a ${personData.role} at ${personData.company}. ${university} alumnus.`,
        domain: 'linkedin.com',
      },
      update: {},
    });

    await prisma.sourceLink.upsert({
      where: {
        personId_url: {
          personId: person.id,
          url: `https://www.google.com/search?q=${encodeURIComponent(personData.fullName + ' ' + personData.company)}`,
        },
      },
      create: {
        personId: person.id,
        kind: 'RESEARCH',
        url: `https://www.google.com/search?q=${encodeURIComponent(personData.fullName + ' ' + personData.company)}`,
        title: `${personData.fullName} ${personData.company} - Google Search`,
        snippet: `Search results for ${personData.fullName} at ${personData.company}`,
        domain: 'google.com',
      },
      update: {},
    });

    // 3. Create or update UserCandidate (user-specific)
    const userCandidate = await prisma.userCandidate.upsert({
      where: {
        userId_personId: {
          userId: user.id,
          personId: person.id,
        },
      },
      create: {
        userId: user.id,
        personId: person.id,
        email: personData.email,
        emailStatus: personData.emailStatus,
        emailConfidence: personData.emailConfidence,
        manualEmailConfirmed: personData.manualEmailConfirmed || false,
        university: personData.university,
      },
      update: {
        email: personData.email,
        emailStatus: personData.emailStatus,
        emailConfidence: personData.emailConfidence,
        manualEmailConfirmed: personData.manualEmailConfirmed || false,
      },
    });

    // 4. Create EmailDraft
    const draft = generateDraft(personData);
    await prisma.emailDraft.upsert({
      where: {
        userCandidateId: userCandidate.id,
      },
      create: {
        userCandidateId: userCandidate.id,
        templateId: defaultTemplate?.id || null,
        subject: draft.subject,
        body: draft.body,
        status: 'PENDING',
      },
      update: {
        subject: draft.subject,
        body: draft.body,
        templateId: defaultTemplate?.id || null,
      },
    });

    console.log(`Created person: ${personData.fullName}`);
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
