import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * This script tests connection using Supabase Connection Pooling
 * Connection Pooling uses port 6543 and is more reliable than direct connection (5432)
 * 
 * To get your pooling connection string:
 * 1. Go to Supabase Dashboard → Your Project
 * 2. Settings → Database → Connection Pooling
 * 3. Copy the "Session" mode connection string
 * 4. It should look like:
 *    postgresql://postgres.xxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
 */

async function testPoolingConnection() {
  console.log('🔍 Testing Supabase Connection Pooling...\n');
  console.log('📝 Note: This uses port 6543 (pooling) instead of 5432 (direct)\n');

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is not set in .env file');
    process.exit(1);
  }

  // Check if already using pooling
  const isPooling = dbUrl.includes('pooler.supabase.com') || dbUrl.includes(':6543');
  
  if (isPooling) {
    console.log('✅ Already using connection pooling!\n');
  } else {
    console.log('⚠️  You are using direct connection (port 5432)');
    console.log('   Connection pooling (port 6543) is recommended for better reliability\n');
    console.log('   To switch to pooling:');
    console.log('   1. Go to Supabase Dashboard → Settings → Database → Connection Pooling');
    console.log('   2. Copy the "Session" mode connection string');
    console.log('   3. Update DATABASE_URL in .env\n');
  }

  const prisma = new PrismaClient({
    log: ['error', 'warn'],
  });

  try {
    console.log('1️⃣ Testing connection...');
    await prisma.$connect();
    console.log('✅ Successfully connected!\n');

    console.log('2️⃣ Testing query...');
    const userCount = await prisma.user.count();
    console.log(`✅ Query successful! Found ${userCount} user(s).\n`);

    console.log('🎉 Connection pooling test passed!');
    
  } catch (error: any) {
    console.error('\n❌ Connection failed!\n');
    
    if (error.message?.includes("Can't reach database server")) {
      console.error('💡 The database might be paused or unreachable.');
      console.error('   Steps to fix:');
      console.error('   1. Go to Supabase Dashboard');
      console.error('   2. Check if your project is paused (free tier pauses after inactivity)');
      console.error('   3. Click "Resume" if paused');
      console.error('   4. Wait 1-2 minutes for database to start');
      console.error('   5. Try again\n');
      
      console.error('   If still failing, try:');
      console.error('   - Get the Connection Pooling string from Supabase Dashboard');
      console.error('   - It should use port 6543, not 5432');
      console.error('   - Format: postgresql://postgres.xxx:[PASSWORD]@aws-0-xxx.pooler.supabase.com:6543/postgres?sslmode=require');
    } else {
      console.error('Error:', error.message);
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testPoolingConnection();
