import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateGS() {
  // Goldman Sachs - Managing Directors & Vice Presidents
  const seniorGS = [
    { name: 'Albert Chen', role: 'Managing Director', city: 'Dallas' },
    { name: 'Vinay Pandey', role: 'Managing Director', city: 'Dallas' },
    { name: 'Shang Gao', role: 'Managing Director', city: 'Dallas' },
    { name: 'Christina de Soto', role: 'Vice President', city: 'Dallas' },
    { name: 'Emilio Acosta Casabianca', role: 'Vice President', city: 'Dallas' },
    { name: 'Zach Levenson', role: 'Vice President', city: 'Dallas' },
    { name: 'Jeffrey Kupp', role: 'Vice President', city: 'Dallas' },
    { name: 'Suzy Telle', role: 'Vice President', city: 'Dallas' },
    { name: 'Juan Aragon', role: 'Vice President', city: 'Dallas' },
    { name: 'Stephen Huang', role: 'Vice President', city: 'Dallas' },
    { name: 'Miguel Perez Jr', role: 'Vice President', city: 'Dallas' },
    { name: 'Brooks Steele', role: 'Vice President', city: 'Dallas' },
    { name: 'Andrew Smith', role: 'Vice President', city: 'Dallas' },
    { name: 'Nicholas Self', role: 'Vice President', city: 'Dallas' },
    { name: 'Richard Moss', role: 'Vice President', city: 'Dallas' },
    { name: 'Rahul Anne', role: 'Vice President', city: 'Dallas' },
    { name: 'Anisha Sutaria', role: 'Vice President', city: 'Dallas' },
    { name: 'Courtney Rudnick', role: 'Vice President', city: 'Dallas' },
    { name: 'Karan Chaudhary', role: 'Vice President', city: 'Dallas' },
    { name: 'Julia Kuo Chen', role: 'Vice President', city: 'Dallas' },
    { name: 'George Clark', role: 'Vice President', city: 'Dallas' },
    { name: 'Rick Li', role: 'Vice President', city: 'Dallas' },
    { name: 'Carlos Espinoza Blunda', role: 'Vice President', city: 'Dallas' },
    { name: 'Ryan Ayers', role: 'Vice President', city: 'Dallas' },
    { name: 'Guillermo Avila', role: 'Vice President', city: 'Dallas' },
    { name: 'Jon McClanahan', role: 'Vice President', city: 'Dallas' },
  ];

  // Goldman Sachs - Associates & Analysts
  const juniorGS = [
    { name: 'Ashley Liu', role: 'Investment Banking Associate', city: 'Houston' },
    { name: 'Patricio Carrillo', role: 'Associate', city: 'Dallas' },
    { name: 'Kevin Leba', role: 'Associate', city: 'Dallas' },
    { name: 'Baron Holmes', role: 'Associate', city: 'Dallas' },
    { name: 'Michael Leibow', role: 'Associate', city: 'Dallas' },
    { name: 'Shardul Kulkarni', role: 'Associate', city: 'Dallas' },
    { name: 'Andres Cubaque', role: 'Associate', city: 'Dallas' },
    { name: 'Cansu Arslan', role: 'Associate', city: 'Dallas' },
    { name: 'William Mao', role: 'Associate', city: 'Dallas' },
    { name: 'Prakruti Govindacharyula', role: 'Associate', city: 'Dallas' },
    { name: 'Will Butcher', role: 'Associate', city: 'Dallas' },
    { name: 'Alastair Ojeda', role: 'Associate', city: 'Dallas' },
    { name: 'Jonathan Ong', role: 'Associate', city: 'Dallas' },
    { name: 'Geetika Agrawal', role: 'Analyst', city: 'Dallas' },
    { name: 'Fielden Baker', role: 'Analyst', city: 'Dallas' },
    { name: 'Ayden Mohamed', role: 'Analyst', city: 'Dallas' },
    { name: 'Lucas Anderson', role: 'Analyst', city: 'Dallas' },
    { name: 'Sudhish Srikanth', role: 'Analyst', city: 'Dallas' },
    { name: 'Mehul Mittal', role: 'Analyst', city: 'Dallas' },
    { name: 'Sharon Zhou', role: 'Analyst', city: 'Dallas' },
    { name: 'Karime Ramirez', role: 'Analyst', city: 'Dallas' },
    { name: 'Isabel Hebner', role: 'Analyst', city: 'Dallas' },
    { name: 'Shahmir Rizvi', role: 'Analyst', city: 'Dallas' },
    { name: 'Merritt Cozby', role: 'Analyst', city: 'Dallas' },
    { name: 'Jack Golten', role: 'Analyst', city: 'Dallas' },
    { name: 'Samuel Kalisch', role: 'Analyst', city: 'Dallas' },
  ];

  const allUpdates = [...seniorGS, ...juniorGS];

  console.log('=== UPDATING GOLDMAN SACHS ROLES ===\n');

  let updated = 0;
  let notFound = 0;

  for (const update of allUpdates) {
    const person = await prisma.person.findFirst({
      where: {
        fullName: { contains: update.name },
        company: { contains: 'Goldman' },
      },
      select: { id: true, fullName: true, company: true, role: true }
    });

    if (!person) {
      console.log(`NOT FOUND: ${update.name}`);
      notFound++;
      continue;
    }

    await prisma.person.update({
      where: { id: person.id },
      data: {
        role: update.role,
        city: update.city,
        state: 'Texas',
        country: 'United States',
      },
    });

    console.log(`✓ ${update.name}: ${update.role} (${update.city})`);
    updated++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Updated: ${updated}`);
  console.log(`Not found: ${notFound}`);

  await prisma.$disconnect();
}

updateGS().catch(console.error);
