import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

async function testConnection() {
  console.log('🔍 Testing database connection...\n');

  // Display connection info (without password)
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is not set in .env file');
    console.error('   Make sure you have a .env file with DATABASE_URL set');
    process.exit(1);
  }

  // Check connection string format
  console.log('📋 Connection String Analysis:');
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':***@');
  console.log(`   ${maskedUrl}\n`);

  // Validate format
  const hasSSL = dbUrl.includes('sslmode=require');
  const hasPassword = dbUrl.includes('@') && !dbUrl.includes('@[YOUR-PASSWORD]');
  const hasHost = dbUrl.includes('@db.') || dbUrl.includes('@aws-');
  
  console.log('📝 Format Checks:');
  console.log(`   SSL Mode: ${hasSSL ? '✅' : '❌ MISSING - Add ?sslmode=require'}`);
  console.log(`   Password: ${hasPassword ? '✅' : '❌ Check if password is set'}`);
  console.log(`   Host: ${hasHost ? '✅' : '❌ Invalid host format'}\n`);

  if (!hasSSL) {
    console.error('⚠️  WARNING: Connection string is missing ?sslmode=require');
    console.error('   Supabase requires SSL. Update your .env file:\n');
    console.error('   DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres?sslmode=require"\n');
  }

  try {
    console.log('1️⃣ Testing basic connection...');
    await prisma.$connect();
    console.log('✅ Successfully connected to database!\n');

    console.log('2️⃣ Testing query (counting users)...');
    const userCount = await prisma.user.count();
    console.log(`✅ Query successful! Found ${userCount} user(s) in database.\n`);

    console.log('3️⃣ Testing Account table access...');
    const accountCount = await prisma.account.count();
    console.log(`✅ Account table accessible! Found ${accountCount} account(s).\n`);

    console.log('4️⃣ Testing Session table access...');
    const sessionCount = await prisma.session.count();
    console.log(`✅ Session table accessible! Found ${sessionCount} session(s).\n`);

    console.log('5️⃣ Testing Person table access...');
    const personCount = await prisma.person.count();
    console.log(`✅ Person table accessible! Found ${personCount} person(s).\n`);

    console.log('🎉 All database tests passed!\n');
    console.log('Your database connection is working correctly.');

  } catch (error: any) {
    console.error('\n❌ Database connection failed!\n');
    console.error('Error details:');
    console.error('─'.repeat(50));
    
    if (error.code) {
      console.error(`Error Code: ${error.code}`);
    }
    
    if (error.message) {
      console.error(`Message: ${error.message}`);
    }

    // Common error diagnostics
    if (error.message?.includes("Can't reach database server")) {
      console.error('\n💡 Possible issues:');
      console.error('   1. Supabase database might be paused (free tier)');
      console.error('      → Go to Supabase Dashboard → Your Project → Resume database');
      console.error('      → Wait 1-2 minutes for it to start\n');
      
      console.error('   2. Try using Connection Pooling port (6543) instead of direct (5432)');
      console.error('      → In Supabase Dashboard: Settings → Database → Connection Pooling');
      console.error('      → Use the "Session" or "Transaction" mode connection string');
      console.error('      → Format: postgresql://postgres.xxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres\n');
      
      console.error('   3. Network/firewall blocking connection');
      console.error('      → Check if your network allows outbound connections to Supabase\n');
      
      console.error('   4. Wrong host/port in connection string');
      console.error('      → Verify the connection string in Supabase Dashboard\n');
      
      console.error('🔧 Quick Fix: Try Connection Pooling');
      console.error('   Replace your DATABASE_URL with the Connection Pooling string from:');
      console.error('   Supabase Dashboard → Settings → Database → Connection Pooling → Session mode');
    }

    if (error.message?.includes("authentication failed")) {
      console.error('\n💡 Possible issues:');
      console.error('   • Wrong password in DATABASE_URL');
      console.error('   • Password contains special characters (try URL encoding)');
      console.error('   • Database user doesn\'t exist');
    }

    if (error.message?.includes("does not exist")) {
      console.error('\n💡 Possible issues:');
      console.error('   • Database name is wrong');
      console.error('   • Schema not initialized (run: npm run db:push)');
    }

    if (error.message?.includes("SSL")) {
      console.error('\n💡 Possible issues:');
      console.error('   • Missing ?sslmode=require in connection string');
      console.error('   • SSL certificate issue');
    }

    console.error('\n📝 Connection string format should be:');
    console.error('   DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres?sslmode=require"');
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log('\n🔌 Disconnected from database.');
  }
}

// Run the test
testConnection()
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
