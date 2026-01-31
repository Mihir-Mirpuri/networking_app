import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function revertRoles() {
  // All the names we updated across all scripts
  const allNames = [
    // Bain - staying
    'Ankita Rao', 'Abigail Moorhead', 'Bonny Mahajan', 'Chloe Naguib', 'Cyndi Huang',
    'Eduardo Rodriguez Macrillante', 'Fernando Quintanal', 'Ginny Vick', 'Grant Olszewski',
    'Grant Shaffer', 'Jaclyn Lomax', 'Karthi Kannan', 'Kiri Katterhenry', 'Leyton McElduff',
    'Mrunalini Mansanpally', 'Sandra Cui', 'Sofia Miranda', 'Sydney Fischer', 'Tobi Beck',
    'Vincent Lin', 'Viveka Mallampaty',

    // Bain - left (these also had company changes - need to revert those too)
    'Allen Schaar', 'Amogh Agnihotri', 'Andrew Ames', 'Andy Nguyen', 'Burak Powers',
    'Caroline Lawton', 'Conrad Shang', 'David Wang', 'Derek Tarlecki', 'Erin Gillman',
    'Ewa Kacewicz', 'Jan Wohlleben', 'Jay Fudemberg', 'Lexi Thorson', 'Margaret Berno',
    'Michael Heyne', 'Nina Klein', 'Patrick Bellmann', 'Rene Benedetto', 'Todd Rhoad',

    // BCG - staying
    'Aarushi Panjwani', 'Ananya Choudhary', 'Apoorva Mittal', 'Eden Williams',
    'Joseph Scammerhorn', 'Kyle Winter', 'Melissa Fu', 'Natalie Butler', 'Neal Makkar',
    'Neil Walia', 'Sophia Zhao', 'Tanya Dhingra', 'Varun Hari', 'Will Jackson',

    // Goldman Sachs - all
    'Albert Chen', 'Vinay Pandey', 'Shang Gao', 'Emilio Acosta Casabianca', 'Zach Levenson',
    'Jeffrey Kupp', 'Suzy Telle', 'Juan Aragon', 'Stephen Huang', 'Miguel Perez Jr',
    'Brooks Steele', 'Andrew Smith', 'Nicholas Self', 'Richard Moss', 'Rahul Anne',
    'Anisha Sutaria', 'Courtney Rudnick', 'Karan Chaudhary', 'Julia Kuo Chen', 'George Clark',
    'Rick Li', 'Carlos Espinoza Blunda', 'Ryan Ayers', 'Guillermo Avila', 'Jon McClanahan',
    'Ashley Liu', 'Patricio Carrillo', 'Kevin Leba', 'Baron Holmes', 'Michael Leibow',
    'Shardul Kulkarni', 'Andres Cubaque', 'Cansu Arslan', 'William Mao', 'Prakruti Govindacharyula',
    'Will Butcher', 'Alastair Ojeda', 'Jonathan Ong', 'Geetika Agrawal', 'Fielden Baker',
    'Ayden Mohamed', 'Lucas Anderson', 'Sudhish Srikanth', 'Mehul Mittal', 'Sharon Zhou',
    'Karime Ramirez', 'Isabel Hebner', 'Shahmir Rizvi', 'Merritt Cozby', 'Jack Golten', 'Samuel Kalisch',

    // McKinsey - all
    'Travis Fagan', 'Celia Huber', 'Kim Marks', 'Chase Covington', 'Brett Hogan',
    'Warren Barrett', 'Mike Peng', 'Scott Schwaitzberg', 'Kerry Grimes', 'Alex Bryan',
    'Alexandre Ghadially', 'Aimeng Ji', 'Aarushi Khandelwal', 'Alisha Subramaniam',
    'Allie Goodfriend', 'Aiden Brasov', 'Amy Enrione', 'Aurusa Moosani', 'Anthony Luu',
    'Andrew Mealey', 'Bridget Haby', 'Brian Burdine', 'Carter Tatum', 'Camila Saez Cabezas',
    'Chan Phan', 'Danielle Goldman', 'Deidra Ward', 'Emily Roll', 'Erika Wey',
    'Evan Bimaputra', 'Evan Butler', 'Ford Halbardier', 'Hammad Rahman', 'Ivy Lee',
    'Jiaqi Zhang', 'Jonathan Navia', 'Josie McGarraugh', 'Joseph Kim', 'Jeffrey Herpers',
    'Kevin Lorica', 'Keyana Hemyari', 'Kendall Lindemann', 'Leke Akinola', 'Luca Gisellu',
    'Lloyd Duberry Jr', 'Mary Harvey', 'Melany Jean', 'Michael Zhang', 'Nassim Hamed',
    'Nivva Emmi', 'Nicholas Perez', 'Olivia Du', 'Peter Liu', 'Rachel Pennington',
    'Ravneet Kaur', 'Robert Deacon', 'Sai Yeluru', 'Sunny Nair', 'Shyamli Channabasappa',
    'Swetha Davuluru', 'Vaibhav Sule', 'Varit Goel', 'Vrat Joshi',
  ];

  console.log('=== REVERTING ROLES TO NULL ===\n');

  let reverted = 0;
  let notFound = 0;

  for (const name of allNames) {
    const person = await prisma.person.findFirst({
      where: { fullName: { contains: name } },
      select: { id: true, fullName: true, company: true, role: true }
    });

    if (!person) {
      console.log(`NOT FOUND: ${name}`);
      notFound++;
      continue;
    }

    await prisma.person.update({
      where: { id: person.id },
      data: { role: null },
    });

    console.log(`✓ ${person.fullName}: role → null`);
    reverted++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Reverted: ${reverted}`);
  console.log(`Not found: ${notFound}`);

  await prisma.$disconnect();
}

revertRoles().catch(console.error);
