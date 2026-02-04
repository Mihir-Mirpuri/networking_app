import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { generateEmailFromPattern, getOrLearnPattern, normalizeCompanyName } from '../src/lib/services/email-pattern';
import { verifyEmail } from '../src/lib/services/email-verification';

const prisma = new PrismaClient();

async function testEmailableIntegration() {
  console.log('=== Testing Emailable Integration ===\n');

  // Find a company with a known pattern
  const pattern = await prisma.companyEmailPattern.findFirst({
    orderBy: { sampleSize: 'desc' },
  });

  if (!pattern) {
    console.log('No company patterns found in database. Run a search first.');
    return;
  }

  console.log(`Using company pattern: ${pattern.company}`);
  console.log(`Pattern: ${pattern.pattern}@${pattern.domain}`);
  console.log(`Confidence: ${Math.round(pattern.confidence * 100)}%\n`);

  // Generate a test email using the pattern
  const testFirstName = 'John';
  const testLastName = 'Smith';

  const generatedEmail = generateEmailFromPattern(
    testFirstName,
    testLastName,
    pattern.pattern as any,
    pattern.domain
  );

  console.log(`Generated test email: ${generatedEmail}`);
  console.log('\nVerifying with Emailable...\n');

  const startTime = Date.now();
  const verification = await verifyEmail(generatedEmail);
  const latency = Date.now() - startTime;

  console.log('=== Verification Result ===');
  console.log(`Email: ${verification.email}`);
  console.log(`Deliverable: ${verification.deliverable}`);
  console.log(`State: ${verification.state}`);
  console.log(`Reason: ${verification.reason}`);
  console.log(`Latency: ${latency}ms`);

  // Also test with the known valid email
  console.log('\n=== Testing Known Valid Email ===');
  const knownValid = await verifyEmail('saketmugunda123@gmail.com');
  console.log(`Email: ${knownValid.email}`);
  console.log(`Deliverable: ${knownValid.deliverable}`);
  console.log(`State: ${knownValid.state}`);
  console.log(`Reason: ${knownValid.reason}`);
  console.log(`Latency: ${knownValid.latencyMs}ms`);

  await prisma.$disconnect();
}

testEmailableIntegration().catch(console.error);
