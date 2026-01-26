/**
 * Test script for Gmail Pub/Sub webhook
 * 
 * Run with: npx tsx tests/gmail-client/test-webhook.ts [email-address]
 * 
 * Prerequisites:
 * - Next.js dev server must be running (npm run dev)
 * - PUBSUB_WEBHOOK_SECRET must be set in .env
 * - DATABASE_URL must be set in .env
 * - User with the specified email must exist in database (or pass email as argument)
 * 
 * Example:
 *   npx tsx tests/gmail-client/test-webhook.ts user@example.com
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Verify required environment variables
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in .env file');
  process.exit(1);
}

if (!process.env.PUBSUB_WEBHOOK_SECRET) {
  console.error('❌ PUBSUB_WEBHOOK_SECRET is not set in .env file');
  process.exit(1);
}

// Create PrismaClient instance
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

async function testWebhook() {
  console.log('🧪 Testing Gmail Pub/Sub Webhook\n');

  // Get email address from command line argument or find one from database
  let testEmail: string | null = null;
  
  if (process.argv[2]) {
    testEmail = process.argv[2];
    console.log(`📧 Using email from argument: ${testEmail}\n`);
  } else {
    // Try to find a user from database
    console.log('📋 Looking for a user in database...');
    const user = await prisma.user.findFirst({
      select: { email: true },
    });

    if (user?.email) {
      testEmail = user.email;
      console.log(`✅ Found user: ${testEmail}\n`);
    } else {
      console.error('❌ No user found in database and no email provided');
      console.error('   Usage: npx tsx tests/gmail-client/test-webhook.ts <email-address>');
      process.exit(1);
    }
  }

  // Verify user exists
  const user = await prisma.user.findUnique({
    where: { email: testEmail },
    select: { id: true, email: true },
  });

  if (!user) {
    console.log(`⚠️  User not found in database: ${testEmail}`);
    console.log('   Webhook will still be tested, but will return "user not found" response\n');
  } else {
    console.log(`✅ User found: ${user.email} (${user.id})\n`);
  }

  // Get webhook URL (default to localhost)
  const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/gmail';
  const webhookSecret = process.env.PUBSUB_WEBHOOK_SECRET;

  console.log(`🌐 Webhook URL: ${webhookUrl}`);
  console.log(`🔑 Using secret from PUBSUB_WEBHOOK_SECRET\n`);

  // Create Gmail notification payload
  const notificationData = {
    emailAddress: testEmail,
    historyId: `test-${Date.now()}`, // Use timestamp for unique historyId
  };

  // Encode notification data to base64
  const notificationJson = JSON.stringify(notificationData);
  const base64Data = Buffer.from(notificationJson).toString('base64');

  // Create Pub/Sub message format
  const pubSubMessage = {
    message: {
      data: base64Data,
      messageId: `test-${Date.now()}`,
      publishTime: new Date().toISOString(),
    },
    subscription: 'projects/test/subscriptions/test-webhook',
  };

  console.log('📤 Sending webhook request...');
  console.log(`   Email: ${testEmail}`);
  console.log(`   History ID: ${notificationData.historyId}\n`);

  try {
    // Send POST request to webhook
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${webhookSecret}`,
      },
      body: JSON.stringify(pubSubMessage),
    });

    const responseData = await response.json();

    console.log(`📥 Response Status: ${response.status}`);
    console.log(`📥 Response Body:`);
    console.log(JSON.stringify(responseData, null, 2));
    console.log('');

    // Validate response
    if (response.status === 200) {
      if (responseData.acknowledged) {
        console.log('✅ Webhook test successful!');
        if (responseData.userId) {
          console.log(`   ✅ User found and sync triggered for userId: ${responseData.userId}`);
        } else {
          console.log(`   ⚠️  User not found, but notification was acknowledged`);
        }
      } else {
        console.log('⚠️  Response acknowledged but unexpected format');
      }
    } else if (response.status === 401) {
      console.error('❌ Authentication failed');
      console.error('   Check that PUBSUB_WEBHOOK_SECRET matches the Authorization header');
    } else if (response.status === 400) {
      console.error('❌ Bad request');
      console.error('   Check the request format');
    } else {
      console.error(`❌ Unexpected status code: ${response.status}`);
    }

    console.log('');
  } catch (error: any) {
    console.error('❌ Error sending webhook request:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Make sure your Next.js dev server is running:');
      console.error('   npm run dev');
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testWebhook().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
