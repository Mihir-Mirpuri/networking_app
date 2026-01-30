const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'mihirmirpuri@gmail.com' },
    select: { id: true, email: true, dailySendCount: true, lastSendDate: true }
  });

  if (!user) {
    console.log('User not found');
    return;
  }

  console.log('=== USER INFO ===');
  console.log('Email:', user.email);
  console.log('Daily Send Count:', user.dailySendCount);
  console.log('Last Send Date:', user.lastSendDate);

  console.log('\n=== SEND LOGS ===');
  const sendLogs = await prisma.sendLog.findMany({
    where: { userId: user.id },
    select: { id: true, toEmail: true, sentAt: true, status: true, outreachTrackerId: true },
    orderBy: { sentAt: 'desc' }
  });
  console.log('Total SendLogs:', sendLogs.length);
  sendLogs.forEach(sl => {
    console.log(`  - ${sl.toEmail} | sent: ${sl.sentAt} | status: ${sl.status} | trackerId: ${sl.outreachTrackerId || 'NULL'}`);
  });

  console.log('\n=== OUTREACH TRACKERS ===');
  const trackers = await prisma.outreachTracker.findMany({
    where: { userId: user.id },
    select: { id: true, contactEmail: true, dateEmailed: true, status: true, createdAt: true }
  });
  console.log('Total Trackers:', trackers.length);
  console.log('Trackers with dateEmailed set:', trackers.filter(t => t.dateEmailed !== null).length);
  trackers.forEach(t => {
    console.log(`  - ${t.contactEmail} | dateEmailed: ${t.dateEmailed || 'NULL'} | status: ${t.status}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
