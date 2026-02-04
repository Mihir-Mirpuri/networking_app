import 'dotenv/config';
import emailable from 'emailable';

const client = emailable(process.env.EMAILABLE_API_KEY!);

const testEmails = [
  'saketmugunda123@gmail.com',  // Valid email provided by user
  'invalid-email-test-12345@fakefakedomain.com',  // Likely invalid
];

async function verifyEmail(email: string) {
  const start = Date.now();
  try {
    const response = await client.verify(email);
    const latency = Date.now() - start;
    console.log(`\n📧 ${email}`);
    console.log(`   ⏱️  Latency: ${latency}ms`);
    console.log(`   State: ${response.state}`);
    console.log(`   Reason: ${response.reason}`);
    console.log(`   Deliverable: ${response.deliverable}`);
    return { email, response, latency };
  } catch (error) {
    const latency = Date.now() - start;
    console.log(`\n📧 ${email}`);
    console.log(`   ⏱️  Latency: ${latency}ms`);
    console.log(`   ❌ Error:`, error);
    return { email, error, latency };
  }
}

async function main() {
  console.log('Testing Emailable API...\n');

  for (const email of testEmails) {
    await verifyEmail(email);
  }
}

main();
