import { PrismaClient } from '@prisma/client';
import { EMAIL_TEMPLATES } from '../src/lib/constants';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding email templates...');

  // Get all users
  const users = await prisma.user.findMany();

  if (users.length === 0) {
    console.log('No users found. Please create a user first.');
    return;
  }

  for (const user of users) {
    console.log(`Seeding templates for user: ${user.email || user.id}`);

    // Check if user already has templates
    const existingTemplates = await prisma.emailTemplate.findMany({
      where: { userId: user.id },
    });

    if (existingTemplates.length > 0) {
      console.log(`User ${user.email || user.id} already has templates, skipping...`);
      continue;
    }

    // Create templates from constants
    for (let i = 0; i < EMAIL_TEMPLATES.length; i++) {
      const template = EMAIL_TEMPLATES[i];
      
      // Store template as JSON in prompt field
      const prompt = JSON.stringify({
        subject: template.subject,
        body: template.body,
      });

      await prisma.emailTemplate.create({
        data: {
          userId: user.id,
          name: template.name,
          prompt: prompt,
          isDefault: i === 0, // First template is default
        },
      });

      console.log(`Created template: ${template.name}`);
    }
  }

  console.log('Email templates seeded successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding templates:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
