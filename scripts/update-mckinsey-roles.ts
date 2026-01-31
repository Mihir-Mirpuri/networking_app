import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateMcKinsey() {
  // McKinsey - Partners & Senior Leadership
  const senior = [
    { name: 'Travis Fagan', role: 'Senior Partner', city: 'Austin' },
    { name: 'Celia Huber', role: 'Senior Partner', city: 'Dallas' },
    { name: 'Kim Marks', role: 'Senior Partner', city: 'Dallas' },
    { name: 'Chase Covington', role: 'Partner', city: 'Dallas' },
    { name: 'Brett Hogan', role: 'Partner', city: 'Dallas' },
    { name: 'Warren Barrett', role: 'Partner', city: 'Dallas' },
    { name: 'Mike Peng', role: 'Partner', city: 'Austin' },
    { name: 'Scott Schwaitzberg', role: 'Partner', city: 'Austin' },
    { name: 'Kerry Grimes', role: 'Senior Advisor', city: 'Austin' },
  ];

  // McKinsey - Associates & Analysts
  const junior = [
    { name: 'Alex Bryan', role: 'Associate', city: 'Austin' },
    { name: 'Alexandre Ghadially', role: 'Senior Business Analyst', city: 'Dallas' },
    { name: 'Aimeng Ji', role: 'Associate', city: 'Houston' },
    { name: 'Aarushi Khandelwal', role: 'Business Analyst', city: 'Dallas' },
    { name: 'Alisha Subramaniam', role: 'Associate', city: 'Dallas' },
    { name: 'Allie Goodfriend', role: 'Associate', city: 'Dallas' },
    { name: 'Aiden Brasov', role: 'Associate', city: 'Dallas' },
    { name: 'Amy Enrione', role: 'Engagement Manager', city: 'Dallas' },
    { name: 'Aurusa Moosani', role: 'Associate', city: 'Dallas' },
    { name: 'Anthony Luu', role: 'Associate', city: 'Dallas' },
    { name: 'Andrew Mealey', role: 'Associate', city: 'Dallas' },
    { name: 'Bridget Haby', role: 'Solution Manager', city: 'Austin' },
    { name: 'Brian Burdine', role: 'Associate', city: 'Dallas' },
    { name: 'Carter Tatum', role: 'Associate', city: 'Houston' },
    { name: 'Camila Saez Cabezas', role: 'Associate', city: 'Houston' },
    { name: 'Chan Phan', role: 'Associate', city: 'Houston' },
    { name: 'Danielle Goldman', role: 'Associate', city: 'Houston' },
    { name: 'Deidra Ward', role: 'Associate', city: 'Dallas' },
    { name: 'Emily Roll', role: 'Associate', city: 'Dallas' },
    { name: 'Erika Wey', role: 'Associate', city: 'Houston' },
    { name: 'Evan Bimaputra', role: 'Associate', city: 'Dallas' },
    { name: 'Evan Butler', role: 'Associate', city: 'Dallas' },
    { name: 'Ford Halbardier', role: 'Associate', city: 'Dallas' },
    { name: 'Hammad Rahman', role: 'Associate', city: 'Houston' },
    { name: 'Ivy Lee', role: 'Associate', city: 'Houston' },
    { name: 'Jiaqi Zhang', role: 'Associate', city: 'Dallas' },
    { name: 'Jonathan Navia', role: 'Business Analyst', city: 'Houston' },
    { name: 'Josie McGarraugh', role: 'Business Analyst', city: 'Houston' },
    { name: 'Joseph Kim', role: 'Associate', city: 'Houston' },
    { name: 'Jeffrey Herpers', role: 'Associate', city: 'Houston' },
    { name: 'Kevin Lorica', role: 'Business Analyst', city: 'Houston' },
    { name: 'Keyana Hemyari', role: 'Associate', city: 'Dallas' },
    { name: 'Kendall Lindemann', role: 'Associate', city: 'Houston' },
    { name: 'Leke Akinola', role: 'Associate', city: 'Houston' },
    { name: 'Luca Gisellu', role: 'Associate', city: 'Dallas' },
    { name: 'Lloyd Duberry Jr', role: 'Associate', city: 'Dallas' },
    { name: 'Mary Harvey', role: 'Associate', city: 'Houston' },
    { name: 'Melany Jean', role: 'Associate', city: 'Houston' },
    { name: 'Michael Zhang', role: 'Associate', city: 'Houston' },
    { name: 'Nassim Hamed', role: 'Associate', city: 'Dallas' },
    { name: 'Nivva Emmi', role: 'Associate', city: 'Dallas' },
    { name: 'Nicholas Perez', role: 'Associate', city: 'Houston' },
    { name: 'Olivia Du', role: 'Associate', city: 'Houston' },
    { name: 'Peter Liu', role: 'Associate', city: 'Dallas' },
    { name: 'Rachel Pennington', role: 'Associate', city: 'Dallas' },
    { name: 'Ravneet Kaur', role: 'Associate', city: 'Dallas' },
    { name: 'Robert Deacon', role: 'Associate', city: 'Dallas' },
    { name: 'Sai Yeluru', role: 'Associate', city: 'Houston' },
    { name: 'Sunny Nair', role: 'Associate', city: 'Dallas' },
    { name: 'Shyamli Channabasappa', role: 'Associate', city: 'Houston' },
    { name: 'Swetha Davuluru', role: 'Associate', city: 'Houston' },
    { name: 'Vaibhav Sule', role: 'Associate', city: 'Houston' },
    { name: 'Varit Goel', role: 'Associate', city: 'Houston' },
    { name: 'Vrat Joshi', role: 'Associate', city: 'Dallas' },
  ];

  const allUpdates = [...senior, ...junior];

  console.log('=== UPDATING MCKINSEY ROLES ===\n');

  let updated = 0;
  let notFound = 0;

  for (const update of allUpdates) {
    const person = await prisma.person.findFirst({
      where: {
        fullName: { contains: update.name },
        company: { contains: 'McKinsey' },
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

updateMcKinsey().catch(console.error);
