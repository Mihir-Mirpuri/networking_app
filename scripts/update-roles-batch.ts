import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface PersonUpdate {
  name: string;
  company: string;
  role: string;
  newCompany?: string; // If they switched companies
  city?: string;
  state?: string;
}

async function updatePeople() {
  // Bain - Still at Bain
  const bainStaying: PersonUpdate[] = [
    { name: 'Ankita Rao', company: 'Bain & Company', role: 'Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Abigail Moorhead', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Dallas', state: 'Texas' },
    { name: 'Bonny Mahajan', company: 'Bain & Company', role: 'Consultant', city: 'Dallas', state: 'Texas' },
    { name: 'Chloe Naguib', company: 'Bain & Company', role: 'Senior Manager', city: 'Houston', state: 'Texas' },
    { name: 'Cyndi Huang', company: 'Bain & Company', role: 'Associate Consultant', city: 'Austin', state: 'Texas' },
    { name: 'Eduardo Rodriguez Macrillante', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Fernando Quintanal', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Ginny Vick', company: 'Bain & Company', role: 'Associate Consultant', city: 'Dallas', state: 'Texas' },
    { name: 'Grant Olszewski', company: 'Bain & Company', role: 'Associate Consultant', city: 'Austin', state: 'Texas' },
    { name: 'Grant Shaffer', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Jaclyn Lomax', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Karthi Kannan', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Kiri Katterhenry', company: 'Bain & Company', role: 'Associate Partner' },
    { name: 'Leyton McElduff', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Mrunalini Mansanpally', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Dallas', state: 'Texas' },
    { name: 'Sandra Cui', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Sofia Miranda', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Sydney Fischer', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Tobi Beck', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Dallas', state: 'Texas' },
    { name: 'Vincent Lin', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
    { name: 'Viveka Mallampaty', company: 'Bain & Company', role: 'Senior Associate Consultant', city: 'Houston', state: 'Texas' },
  ];

  // Bain - Left for other companies
  const bainLeft: PersonUpdate[] = [
    { name: 'Allen Schaar', company: 'Bain & Company', role: 'Managing Director', newCompany: 'Pacific Avenue Capital' },
    { name: 'Amogh Agnihotri', company: 'Bain & Company', role: 'Botha Chan Innovation Fellow', newCompany: 'Stanford GSB', city: 'Palo Alto', state: 'California' },
    { name: 'Andrew Ames', company: 'Bain & Company', role: 'Head of AMER, Partner Success', newCompany: 'MuleSoft', city: 'Dallas', state: 'Texas' },
    { name: 'Andy Nguyen', company: 'Bain & Company', role: 'Director of IS & Integrations', newCompany: 'NexCore / Shermco' },
    { name: 'Burak Powers', company: 'Bain & Company', role: 'Senior Director', newCompany: 'Alvarez & Marsal' },
    { name: 'Caroline Lawton', company: 'Bain & Company', role: 'Senior Associate', newCompany: 'Innovations for Poverty Action' },
    { name: 'Conrad Shang', company: 'Bain & Company', role: 'Managing Partner', newCompany: 'Ensemble VC', city: 'San Francisco', state: 'California' },
    { name: 'David Wang', company: 'Bain & Company', role: 'Chief Innovation Officer', newCompany: 'Cooley LLP', city: 'New York', state: 'New York' },
    { name: 'Derek Tarlecki', company: 'Bain & Company', role: 'President', newCompany: 'Simms Fishing Products', city: 'Dallas', state: 'Texas' },
    { name: 'Erin Gillman', company: 'Bain & Company', role: 'Former Partner', newCompany: 'Independent' },
    { name: 'Ewa Kacewicz', company: 'Bain & Company', role: 'Organization Development', newCompany: 'Itron Inc.' },
    { name: 'Jan Wohlleben', company: 'Bain & Company', role: 'Consultant', newCompany: 'Boston Consulting Group', city: 'Dallas', state: 'Texas' },
    { name: 'Jay Fudemberg', company: 'Bain & Company', role: 'Founder & CEO', newCompany: 'findingQED' },
    { name: 'Lexi Thorson', company: 'Bain & Company', role: 'MBA Candidate', newCompany: 'The Wharton School', city: 'Philadelphia', state: 'Pennsylvania' },
    { name: 'Margaret Berno', company: 'Bain & Company', role: 'Senior Manager, Strategy & Growth', newCompany: 'Action Behavior Centers' },
    { name: 'Michael Heyne', company: 'Bain & Company', role: 'Founder & CEO', newCompany: 'Boutique Hospitality LLC' },
    { name: 'Nina Klein', company: 'Bain & Company', role: 'VP of Product & Technology', newCompany: 'Showroom' },
    { name: 'Patrick Bellmann', company: 'Bain & Company', role: 'Director', newCompany: 'SVP Strategic Value Partners', city: 'Houston', state: 'Texas' },
    { name: 'Rene Benedetto', company: 'Bain & Company', role: 'Managing Director', newCompany: 'Halyard Capital / BMO' },
    { name: 'Todd Rhoad', company: 'Bain & Company', role: 'Managing Director', newCompany: 'BTG' },
  ];

  // BCG - Still at BCG
  const bcgStaying: PersonUpdate[] = [
    { name: 'Aarushi Panjwani', company: 'Boston Consulting Group', role: 'Associate', city: 'Houston', state: 'Texas' },
    { name: 'Ananya Choudhary', company: 'Boston Consulting Group', role: 'Associate', city: 'New York', state: 'New York' },
    { name: 'Apoorva Mittal', company: 'Boston Consulting Group', role: 'Associate', city: 'Houston', state: 'Texas' },
    { name: 'Eden Williams', company: 'Boston Consulting Group', role: 'Associate', city: 'Austin', state: 'Texas' },
    { name: 'Joseph Scammerhorn', company: 'Boston Consulting Group', role: 'Associate', city: 'Austin', state: 'Texas' },
    { name: 'Kyle Winter', company: 'Boston Consulting Group', role: 'Associate', city: 'Austin', state: 'Texas' },
    { name: 'Melissa Fu', company: 'Boston Consulting Group', role: 'Associate', city: 'Dallas', state: 'Texas' },
    { name: 'Natalie Butler', company: 'Boston Consulting Group', role: 'Associate', city: 'Austin', state: 'Texas' },
    { name: 'Neal Makkar', company: 'Boston Consulting Group', role: 'Senior Associate', city: 'Houston', state: 'Texas' },
    { name: 'Neil Walia', company: 'Boston Consulting Group', role: 'Consultant', city: 'Austin', state: 'Texas' },
    { name: 'Sophia Zhao', company: 'Boston Consulting Group', role: 'Associate', city: 'Dallas', state: 'Texas' },
    { name: 'Tanya Dhingra', company: 'Boston Consulting Group', role: 'Associate', city: 'Dallas', state: 'Texas' },
    { name: 'Varun Hari', company: 'Boston Consulting Group', role: 'Consultant', city: 'Dallas', state: 'Texas' },
    { name: 'Will Jackson', company: 'Boston Consulting Group', role: 'Associate', city: 'Austin', state: 'Texas' },
  ];

  const allUpdates = [
    ...bainStaying.map(u => ({ ...u, type: 'staying' })),
    ...bainLeft.map(u => ({ ...u, type: 'left' })),
    ...bcgStaying.map(u => ({ ...u, type: 'staying' })),
  ];

  console.log('=== UPDATING ROLES & COMPANIES ===\n');

  let updated = 0;
  let notFound = 0;
  let switched = 0;

  for (const update of allUpdates) {
    const person = await prisma.person.findFirst({
      where: {
        fullName: { contains: update.name },
        company: { contains: update.company.split(' ')[0] }, // Match first word
      },
      select: { id: true, fullName: true, company: true, role: true, city: true }
    });

    if (!person) {
      console.log(`NOT FOUND: ${update.name} @ ${update.company}`);
      notFound++;
      continue;
    }

    const updateData: Record<string, string> = { role: update.role };

    if (update.newCompany) {
      // Check if person already exists at new company
      const existingAtNewCo = await prisma.person.findFirst({
        where: {
          fullName: { contains: update.name },
          company: { contains: update.newCompany.split(' ')[0] },
        }
      });

      if (existingAtNewCo) {
        // Update the record at new company instead
        await prisma.person.update({
          where: { id: existingAtNewCo.id },
          data: {
            role: update.role,
            ...(update.city && { city: update.city }),
            ...(update.state && { state: update.state }),
          },
        });
        console.log(`✓ ${update.name}: ${update.role} (already at ${update.newCompany})`);
        updated++;
        switched++;
        continue;
      }

      updateData.company = update.newCompany;
      switched++;
    }
    if (update.city) updateData.city = update.city;
    if (update.state) updateData.state = update.state;

    await prisma.person.update({
      where: { id: person.id },
      data: updateData,
    });

    const action = update.newCompany ? `→ ${update.newCompany}` : '';
    console.log(`✓ ${update.name}: ${update.role} ${action}`);
    updated++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Updated: ${updated}`);
  console.log(`Switched companies: ${switched}`);
  console.log(`Not found: ${notFound}`);

  await prisma.$disconnect();
}

updatePeople().catch(console.error);
