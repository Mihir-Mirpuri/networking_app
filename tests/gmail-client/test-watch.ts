/**
 * Test script for startMailboxWatch functionality
 * 
 * Run with: npx tsx tests/gmail-client/test-watch.ts
 * 
 * Prerequisites:
 * - User must be signed in with Google OAuth
 * - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env
 * - GOOGLE_PUBSUB_TOPIC must be set in .env (format: projects/PROJECT_ID/topics/TOPIC_NAME)
 * - DATABASE_URL must be set in .env
 * - Pub/Sub topic must exist and Gmail service account must have Publisher role
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

// Load .env file BEFORE any Prisma-related imports
// This ensures DATABASE_URL is available when PrismaClient is instantiated
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Verify DATABASE_URL is loaded
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in .env file');
  console.error('   Make sure you have a .env file with DATABASE_URL set');
  process.exit(1);
}

// Create a fresh PrismaClient instance for this test
// This avoids issues with the singleton pattern in @/lib/prisma
// which might cache a PrismaClient with a different DATABASE_URL
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

import { startMailboxWatch } from '@/lib/gmail/client';

async function testStartMailboxWatch() {
  console.log('🧪 Testing startMailboxWatch()\n');

  // Check environment variable
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topicName) {
    console.error('❌ GOOGLE_PUBSUB_TOPIC environment variable not set');
    console.error('   Please set it in your .env file:');
    console.error('   GOOGLE_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/YOUR_TOPIC_NAME');
    process.exit(1);
  }

  console.log(`📬 Topic: ${topicName}\n`);

  // Get a user with Google account - use saketmugunda123@gmail.com
  const user = await prisma.user.findUnique({
    where: { email: 'saketmugunda123@gmail.com' },
  });

  if (!user) {
    console.log('❌ User saketmugunda123@gmail.com not found.');
    console.log('   Please sign in with Google first using that email.');
    process.exit(1);
  }

  const account = await prisma.account.findFirst({
    where: { 
      provider: 'google',
      userId: user.id,
    },
    include: { user: true },
  });

  if (!account) {
    console.log('❌ No Google account found for saketmugunda123@gmail.com.');
    console.log('   Please sign in with Google first.');
    process.exit(1);
  }

  const userId = account.userId;
  const userEmail = account.user?.email;
  
  console.log(`📧 Testing with user: ${userEmail} (${userId})\n`);

  try {
    // Check existing sync state
    console.log('1️⃣  Checking existing sync state...');
    const existingState = await prisma.gmail_sync_state.findUnique({
      where: { userId },
    });

    if (existingState) {
      console.log('   ℹ️  Existing sync state found:');
      console.log(`      Watch expiration: ${existingState.watch_expiration?.toISOString() || 'None'}`);
      console.log(`      History ID: ${existingState.historyId || 'None'}`);
      const isExpired = existingState.watch_expiration 
        ? existingState.watch_expiration < new Date()
        : true;
      console.log(`      Status: ${isExpired ? '⚠️  Expired' : '✅ Active'}\n`);
    } else {
      console.log('   ℹ️  No existing sync state found\n');
    }

    // Test: Start watch
    console.log('2️⃣  Starting mailbox watch...');
    const result = await startMailboxWatch(userId, topicName);
    
    console.log('   ✅ Watch started successfully!');
    console.log(`   📋 History ID: ${result.historyId || 'None'}`);
    console.log(`   ⏰ Expiration: ${result.expiration}`);
    
    const expirationDate = new Date(parseInt(result.expiration, 10));
    console.log(`   📅 Expiration date: ${expirationDate.toISOString()}`);
    console.log(`   ⏳ Expires in: ${Math.round((expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days\n`);

    // Verify database update
    console.log('3️⃣  Verifying database update...');
    const updatedState = await prisma.gmail_sync_state.findUnique({
      where: { userId },
    });

    if (updatedState) {
      console.log('   ✅ Database record updated:');
      console.log(`      Email: ${updatedState.email_address}`);
      console.log(`      Watch expiration: ${updatedState.watch_expiration?.toISOString()}`);
      console.log(`      History ID: ${updatedState.historyId || 'None'}`);
      console.log(`      Created: ${updatedState.createdAt.toISOString()}`);
      console.log(`      Updated: ${updatedState.updatedAt.toISOString()}\n`);
    } else {
      console.log('   ⚠️  Database record not found (this shouldn\'t happen)\n');
    }

    console.log('✅ All tests passed! Mailbox watch is active.\n');
    console.log('💡 Gmail will now send push notifications to your Pub/Sub topic');
    console.log('   when new messages arrive in the mailbox.\n');
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error('   Error name:', error.name);
    
    if (error.originalError) {
      console.error('   Original error:', error.originalError);
    }
    
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }

    // Common error messages
    if (error.message.includes('Invalid topic')) {
      console.error('\n💡 Tip: Verify the topic name and ensure Gmail service account');
      console.error('   (gmail-api-push@system.gserviceaccount.com) has Publisher role.');
    } else if (error.message.includes('permission')) {
      console.error('\n💡 Tip: Ensure the user has granted gmail.readonly scope.');
      console.error('   User may need to re-authorize.');
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testStartMailboxWatch().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
