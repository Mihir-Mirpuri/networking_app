const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'mihirmirpuri@gmail.com' },
    select: { id: true }
  });

  if (!user) {
    console.log('User not found');
    return;
  }

  // This is the exact same query used in getOutreachStats
  const [sent, waiting, ongoingConversations, connected] = await Promise.all([
    // Count all trackers where an email was sent
    prisma.outreachTracker.count({
      where: { userId: user.id, dateEmailed: { not: null } },
    }),
    // No response yet - sent but no responseReceivedAt
    prisma.outreachTracker.count({
      where: {
        userId: user.id,
        dateEmailed: { not: null },
        responseReceivedAt: null,
      },
    }),
    // Ongoing conversations - has a response
    prisma.outreachTracker.count({
      where: {
        userId: user.id,
        responseReceivedAt: { not: null },
      },
    }),
    prisma.outreachTracker.count({
      where: { userId: user.id, status: 'CONNECTED' },
    }),
  ]);

  console.log('=== STATS (same as getOutreachStats) ===');
  console.log('Emails Sent:', sent);
  console.log('Waiting (no response):', waiting);
  console.log('Ongoing Conversations:', ongoingConversations);
  console.log('Connected:', connected);
}

main().catch(console.error).finally(() => prisma.$disconnect());
