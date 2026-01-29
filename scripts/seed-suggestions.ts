import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get the specific user
  const user = await prisma.user.findFirst({
    where: {
      email: { contains: 'saketmugunda123' },
    },
    include: {
      messages: {
        take: 3,
        where: {
          meetingSuggestion: { is: null },
        },
        orderBy: { received_at: 'desc' },
      },
    },
  });

  if (!user || user.messages.length === 0) {
    console.log('No user with available messages found');
    return;
  }

  console.log(`Found user: ${user.email}`);
  console.log(`Available messages: ${user.messages.length}`);

  const suggestions = user.messages.map((msg, i) => {
    // Create proper ISO datetime for startTime
    const startDate = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
    const hours = [10, 14, 16][i] || 10;
    startDate.setHours(hours, 0, 0, 0);

    return {
      userId: user.id,
      messageId: msg.messageId,
      status: 'PENDING' as const,
      confidence: 0.75 + i * 0.1,
      extractedData: {
        title: `Coffee chat with ${msg.sender?.split('@')[0] || 'Contact'}`,
        startTime: startDate.toISOString(),
        duration: 30,
        location: ['Zoom', 'Coffee Shop', 'Office'][i] || 'TBD',
        attendees: msg.sender ? [msg.sender] : [],
        description: `Extracted from email: ${msg.subject || 'No subject'}`,
        rawText: msg.subject || 'Meeting discussion',
      },
    };
  });

  const created = await prisma.extractedMeetingSuggestion.createMany({
    data: suggestions,
    skipDuplicates: true,
  });

  console.log(`Created ${created.count} meeting suggestions`);

  // Verify
  const count = await prisma.extractedMeetingSuggestion.count({
    where: { userId: user.id, status: 'PENDING' },
  });
  console.log(`Total pending suggestions for user: ${count}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
