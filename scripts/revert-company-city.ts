import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function revertAll() {
  // Bain people who "left" - need to change company back to Bain & Company
  const bainLeft = [
    { name: 'Allen Schaar', currentCompany: 'Pacific Avenue Capital' },
    { name: 'Amogh Agnihotri', currentCompany: 'Stanford GSB' },
    { name: 'Andrew Ames', currentCompany: 'MuleSoft' },
    { name: 'Andy Nguyen', currentCompany: 'NexCore' },
    { name: 'Burak Powers', currentCompany: 'Alvarez' },
    { name: 'Caroline Lawton', currentCompany: 'Innovations for Poverty' },
    { name: 'Conrad Shang', currentCompany: 'Ensemble' },
    { name: 'David Wang', currentCompany: 'Cooley' },
    { name: 'Derek Tarlecki', currentCompany: 'Simms' },
    { name: 'Erin Gillman', currentCompany: 'Independent' },
    { name: 'Ewa Kacewicz', currentCompany: 'Itron' },
    { name: 'Jan Wohlleben', currentCompany: 'Boston Consulting' },
    { name: 'Jay Fudemberg', currentCompany: 'findingQED' },
    { name: 'Lexi Thorson', currentCompany: 'Wharton' },
    { name: 'Margaret Berno', currentCompany: 'Action Behavior' },
    { name: 'Michael Heyne', currentCompany: 'Boutique Hospitality' },
    { name: 'Nina Klein', currentCompany: 'Showroom' },
    { name: 'Patrick Bellmann', currentCompany: 'SVP Strategic' },
    { name: 'Rene Benedetto', currentCompany: 'Halyard' },
    { name: 'Todd Rhoad', currentCompany: 'BTG' },
  ];

  // All names that had city modified
  const allNamesWithCityChanges = [
    // Bain
    'Ankita Rao', 'Abigail Moorhead', 'Bonny Mahajan', 'Chloe Naguib', 'Cyndi Huang',
    'Eduardo Rodriguez Macrillante', 'Fernando Quintanal', 'Ginny Vick', 'Grant Olszewski',
    'Grant Shaffer', 'Jaclyn Lomax', 'Karthi Kannan', 'Leyton McElduff',
    'Mrunalini Mansanpally', 'Sandra Cui', 'Sofia Miranda', 'Sydney Fischer', 'Tobi Beck',
    'Vincent Lin', 'Viveka Mallampaty',
    'Amogh Agnihotri', 'Andrew Ames', 'Conrad Shang', 'David Wang', 'Derek Tarlecki',
    'Jan Wohlleben', 'Lexi Thorson', 'Patrick Bellmann',

    // BCG
    'Aarushi Panjwani', 'Ananya Choudhary', 'Apoorva Mittal', 'Eden Williams',
    'Joseph Scammerhorn', 'Kyle Winter', 'Melissa Fu', 'Natalie Butler', 'Neal Makkar',
    'Neil Walia', 'Sophia Zhao', 'Tanya Dhingra', 'Varun Hari', 'Will Jackson',

    // Goldman Sachs - all had city set to Dallas or Houston
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

    // McKinsey - all had city set
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

  console.log('=== REVERTING COMPANY CHANGES ===\n');

  let companyReverted = 0;
  for (const item of bainLeft) {
    const person = await prisma.person.findFirst({
      where: {
        fullName: { contains: item.name },
        company: { contains: item.currentCompany },
      },
      select: { id: true, fullName: true, company: true }
    });

    if (!person) {
      console.log(`NOT FOUND: ${item.name} @ ${item.currentCompany}`);
      continue;
    }

    await prisma.person.update({
      where: { id: person.id },
      data: { company: 'Bain & Company' },
    });

    console.log(`✓ ${person.fullName}: ${person.company} → Bain & Company`);
    companyReverted++;
  }

  console.log('\n=== REVERTING CITY CHANGES (setting to null) ===\n');

  let cityReverted = 0;
  for (const name of allNamesWithCityChanges) {
    const person = await prisma.person.findFirst({
      where: { fullName: { contains: name } },
      select: { id: true, fullName: true, city: true }
    });

    if (!person) {
      continue; // Skip silently - some may not exist
    }

    await prisma.person.update({
      where: { id: person.id },
      data: { city: null, state: null },
    });

    cityReverted++;
  }

  console.log(`Reverted city/state to null for ${cityReverted} people`);

  console.log('\n=== SUMMARY ===');
  console.log(`Companies reverted to Bain: ${companyReverted}`);
  console.log(`Cities reverted to null: ${cityReverted}`);

  await prisma.$disconnect();
}

revertAll().catch(console.error);
