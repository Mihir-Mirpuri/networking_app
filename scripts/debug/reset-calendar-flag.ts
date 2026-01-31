import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reset() {
  const result = await prisma.user.update({
    where: { email: 'mihirmirpuri@gmail.com' },
    data: { calendarConnected: false }
  });
  console.log('Updated user:', result.email);
  console.log('calendarConnected is now:', result.calendarConnected);
  await prisma.$disconnect();
}

reset().catch(console.error);
