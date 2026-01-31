import prisma from '../src/lib/prisma';

async function checkSearch() {
  const searchId = 'cml2uwc36005ejjdwxaq94a8l';

  const search = await prisma.search.findUnique({
    where: { id: searchId },
    include: {
      searchPeople: {
        include: {
          person: {
            select: {
              id: true,
              fullName: true,
              company: true,
              email: true,
              emailStatus: true,
              apolloStatus: true,
              role: true,
              city: true,
              educationSchool: true,
            }
          }
        }
      }
    }
  });

  if (!search) {
    console.log('Search not found');
    return;
  }

  const people = search.searchPeople.map(sp => sp.person);
  const withEmail = people.filter(p => p.email && (p.emailStatus === 'VERIFIED' || p.emailStatus === 'UNVERIFIED'));
  const verified = people.filter(p => p.emailStatus === 'VERIFIED');
  const fullyEnriched = people.filter(p => p.email && p.role && (p.city || p.educationSchool));

  console.log('Search:', search.company, '|', search.university, '|', search.location);
  console.log('Total people:', people.length);
  console.log('With email (verified/unverified):', withEmail.length);
  console.log('Verified emails:', verified.length);
  console.log('Fully enriched (email + role + location/education):', fullyEnriched.length);

  await prisma.$disconnect();
}

checkSearch();
