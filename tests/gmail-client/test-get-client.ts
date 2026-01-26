/**
 * Test script for getGmailClient functionality
 * 
 * Run with: npx tsx tests/gmail-client/test-get-client.ts
 * 
 * Prerequisites:
 * - User must be signed in with Google OAuth
 * - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env
 * - DATABASE_URL must be set in .env
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

// Validate connection string format
const dbUrl = process.env.DATABASE_URL;
const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':***@');
const isPooler = dbUrl.includes('pooler.supabase.com');
const isDirect = dbUrl.includes('db.') && !dbUrl.includes('pooler');

// Extract port for display
const portMatch = dbUrl.match(/:(\d+)\//);
const port = portMatch ? portMatch[1] : 'unknown';

console.log('📋 Connection Info:');
console.log(`   ${maskedUrl}`);
console.log(`   Type: ${isPooler ? 'Session Pooler ✅' : isDirect ? 'Direct Connection ✅' : 'Unknown'}, Port: ${port}\n`);

// Create a fresh PrismaClient instance for this test
// This avoids issues with the singleton pattern in @/lib/prisma
// which might cache a PrismaClient with a different DATABASE_URL
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

import { getGmailClient } from '@/lib/gmail/client';

async function testGetGmailClient() {
  console.log('🧪 Testing getGmailClient()\n');

  // First, test database connection
  try {
    console.log('0️⃣  Testing database connection...');
    await prisma.$connect();
    console.log('   ✅ Database connection successful\n');
  } catch (error: any) {
    console.error('   ❌ Database connection failed!\n');
    console.error('   Error:', error.message);
    
    if (error.message?.includes("Can't reach database server")) {
      console.error('\n💡 Possible solutions:');
      console.error('   1. Supabase database might be paused (free tier)');
      console.error('      → Go to Supabase Dashboard → Your Project → Resume database');
      console.error('      → Wait 1-2 minutes for it to start\n');
      
      console.error('   2. Add ?sslmode=require to your connection string');
      console.error('      → Supabase requires SSL connections');
      console.error('      → Format: postgresql://...@host:port/db?sslmode=require\n');
      
      console.error('   3. Verify your DATABASE_URL format:');
      console.error('      Session Pooler: postgresql://postgres.xxx:[PASSWORD]@aws-0-xxx.pooler.supabase.com:5432/postgres?sslmode=require');
      console.error('      Direct: postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres?sslmode=require\n');
    }
    
    process.exit(1);
  }

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
    console.log('   Please sign in with Google first using that email.');
    process.exit(1);
  }

  const userId = account.userId;
  const userEmail = account.user?.email;
  
  console.log(`📧 Testing with user: ${userEmail} (${userId})\n`);

  try {
    // Test 1: Get client
    console.log('1️⃣  Getting Gmail client...');
    const gmail = await getGmailClient(userId);
    console.log('   ✅ Client created successfully\n');

    // Test 2: Get user profile
    console.log('2️⃣  Getting Gmail profile...');
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log(`   ✅ Profile retrieved: ${profile.data.emailAddress}`);
    console.log(`   📊 Messages total: ${profile.data.messagesTotal || 0}`);
    console.log(`   📊 Threads total: ${profile.data.threadsTotal || 0}\n`);

    // Test 3: List labels
    console.log('3️⃣  Listing Gmail labels...');
    const labels = await gmail.users.labels.list({ userId: 'me' });
    const labelCount = labels.data.labels?.length || 0;
    console.log(`   ✅ Found ${labelCount} labels`);
    if (labelCount > 0) {
      const labelNames = labels.data.labels?.slice(0, 5).map(l => l.name).join(', ');
      console.log(`   📋 Sample labels: ${labelNames}${labelCount > 5 ? '...' : ''}\n`);
    } else {
      console.log('\n');
    }

    // Test 4: List recent messages (first page)
    console.log('4️⃣  Listing recent messages...');
    const messages = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 5,
    });
    const messageCount = messages.data.messages?.length || 0;
    console.log(`   ✅ Found ${messageCount} messages (showing first 5)\n`);

    console.log('✅ All tests passed! Gmail client is working correctly.\n');
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error('   Error name:', error.name);
    
    // Specific error handling for permission issues
    if (error.message?.includes('Insufficient Permission') || error.message?.includes('insufficient')) {
      console.error('\n💡 Permission Error Analysis:');
      console.error('   The OAuth tokens in your database don\'t have the required scopes.');
      console.error('   This happens when tokens were created BEFORE adding gmail.readonly scope.\n');
      console.error('   🔧 Solution:');
      console.error('   1. Make sure src/lib/auth.ts includes gmail.readonly in the scope');
      console.error('   2. User must RE-AUTHENTICATE to get new tokens with updated scopes:');
      console.error('      - Sign out from your app');
      console.error('      - Sign in again with Google');
      console.error('      - Google will request gmail.readonly permission');
      console.error('      - New tokens will be stored in the database\n');
      console.error('   📝 Note: Token refresh won\'t add new scopes - full re-auth is required.\n');
    }
    
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testGetGmailClient().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
