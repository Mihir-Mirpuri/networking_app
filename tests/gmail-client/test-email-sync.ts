/**
 * Test script for Gmail Email Sync Service
 *
 * Run with: npx tsx tests/gmail-client/test-email-sync.ts [email-address]
 *
 * Prerequisites:
 * - DATABASE_URL must be set in .env
 * - User must have Gmail OAuth connected (refresh_token exists)
 * - gmail_sync_state record should exist for the user (run test-watch.ts first)
 *
 * Example:
 *   npx tsx tests/gmail-client/test-email-sync.ts user@example.com
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

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('❌ Google OAuth credentials not set in .env file');
  process.exit(1);
}

// Create PrismaClient instance
const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

// Import the sync service (dynamic import for ESM compatibility)
async function importSyncService() {
  // We need to use the compiled version or tsx will handle it
  const { syncUserMailbox } = await import('../../src/lib/services/email-sync');
  return { syncUserMailbox };
}

async function testEmailSync() {
  console.log('🧪 Testing Gmail Email Sync Service\n');
  console.log('=' .repeat(60) + '\n');

  // Get email address from command line argument or find one from database
  let testEmail: string | null = null;

  if (process.argv[2]) {
    testEmail = process.argv[2];
    console.log(`📧 Using email from argument: ${testEmail}\n`);
  } else {
    // Try to find a user with Gmail connected
    console.log('📋 Looking for a user with Gmail OAuth connected...');
    const account = await prisma.account.findFirst({
      where: {
        provider: 'google',
        refresh_token: { not: null },
      },
      select: {
        userId: true,
        user: { select: { email: true } },
      },
    });

    if (account?.user?.email) {
      testEmail = account.user.email;
      console.log(`✅ Found user with Gmail: ${testEmail}\n`);
    } else {
      console.error('❌ No user found with Gmail OAuth connected');
      console.error('   Sign in with Google OAuth first, then try again');
      console.error('   Usage: npx tsx tests/gmail-client/test-email-sync.ts <email-address>');
      process.exit(1);
    }
  }

  // Get user and verify they have Gmail connected
  const user = await prisma.user.findUnique({
    where: { email: testEmail },
    select: {
      id: true,
      email: true,
      accounts: {
        where: { provider: 'google' },
        select: {
          refresh_token: true,
          access_token: true,
        },
      },
    },
  });

  if (!user) {
    console.error(`❌ User not found: ${testEmail}`);
    process.exit(1);
  }

  if (!user.accounts[0]?.refresh_token) {
    console.error(`❌ User ${testEmail} has no Gmail refresh token`);
    console.error('   User needs to re-authenticate with Google OAuth');
    process.exit(1);
  }

  console.log(`✅ User found: ${user.email} (${user.id})`);
  console.log(`✅ Gmail OAuth: Connected (has refresh_token)\n`);

  // Check gmail_sync_state
  const syncState = await prisma.gmail_sync_state.findUnique({
    where: { userId: user.id },
  });

  if (syncState) {
    console.log('📊 Current Sync State:');
    console.log(`   History ID: ${syncState.historyId || 'none'}`);
    console.log(`   Watch Expiration: ${syncState.watch_expiration?.toISOString() || 'none'}`);
    console.log(`   Last Updated: ${syncState.updatedAt.toISOString()}\n`);
  } else {
    console.log('⚠️  No gmail_sync_state found for user');
    console.log('   Run test-watch.ts first to initialize the watch\n');
  }

  // Get current message/conversation counts
  const [messageCountBefore, conversationCountBefore] = await Promise.all([
    prisma.messages.count({ where: { userId: user.id } }),
    prisma.conversations.count({ where: { userId: user.id } }),
  ]);

  console.log('📊 Database State BEFORE sync:');
  console.log(`   Messages: ${messageCountBefore}`);
  console.log(`   Conversations: ${conversationCountBefore}\n`);

  // Run the sync
  console.log('🔄 Running syncUserMailbox()...\n');
  console.log('-'.repeat(60));

  try {
    const { syncUserMailbox } = await importSyncService();
    const startTime = Date.now();

    const result = await syncUserMailbox({ userId: user.id });

    const duration = Date.now() - startTime;

    console.log('-'.repeat(60) + '\n');
    console.log('📊 Sync Result:');
    console.log(`   Success: ${result.success ? '✅' : '❌'} ${result.success}`);
    console.log(`   Sync Type: ${result.syncType}`);
    console.log(`   Messages Processed: ${result.messagesProcessed}`);
    console.log(`   Conversations Updated: ${result.conversationsUpdated}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    console.log(`   Duration: ${duration}ms\n`);

    // Get counts after sync
    const [messageCountAfter, conversationCountAfter] = await Promise.all([
      prisma.messages.count({ where: { userId: user.id } }),
      prisma.conversations.count({ where: { userId: user.id } }),
    ]);

    console.log('📊 Database State AFTER sync:');
    console.log(`   Messages: ${messageCountAfter} (${messageCountAfter - messageCountBefore >= 0 ? '+' : ''}${messageCountAfter - messageCountBefore})`);
    console.log(`   Conversations: ${conversationCountAfter} (${conversationCountAfter - conversationCountBefore >= 0 ? '+' : ''}${conversationCountAfter - conversationCountBefore})\n`);

    // Show sample messages if any were created
    if (messageCountAfter > 0) {
      console.log('📧 Sample Messages (most recent 5):');
      const recentMessages = await prisma.messages.findMany({
        where: { userId: user.id },
        orderBy: { received_at: 'desc' },
        take: 5,
        select: {
          messageId: true,
          direction: true,
          sender: true,
          subject: true,
          received_at: true,
          sendLogId: true,
        },
      });

      for (const msg of recentMessages) {
        const direction = msg.direction === 'SENT' ? '📤' : '📥';
        const linked = msg.sendLogId ? ' [linked to SendLog]' : '';
        console.log(`   ${direction} ${msg.subject?.substring(0, 50) || '(no subject)'}${linked}`);
        console.log(`      From: ${msg.sender}`);
        console.log(`      Date: ${msg.received_at.toISOString()}`);
        console.log('');
      }
    }

    // Check updated sync state
    const updatedSyncState = await prisma.gmail_sync_state.findUnique({
      where: { userId: user.id },
    });

    if (updatedSyncState) {
      console.log('📊 Updated Sync State:');
      console.log(`   History ID: ${updatedSyncState.historyId || 'none'}`);
      console.log(`   Last Updated: ${updatedSyncState.updatedAt.toISOString()}\n`);
    }

    // Final verdict
    console.log('=' .repeat(60));
    if (result.success) {
      console.log('✅ Test PASSED - Sync completed successfully');
    } else {
      console.log('⚠️  Test completed with errors - check logs above');
    }

  } catch (error: any) {
    console.log('-'.repeat(60) + '\n');
    console.error('❌ Sync failed with error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testEmailSync().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
