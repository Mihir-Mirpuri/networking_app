#!/usr/bin/env node
/**
 * Comprehensive database connection diagnostic
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

async function diagnose() {
  console.log('🔍 Database Connection Diagnostic\n');
  console.log('═'.repeat(60) + '\n');

  // 1. Check DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL not found in environment');
    console.error('   Make sure .env file exists and has DATABASE_URL set\n');
    process.exit(1);
  }

  const masked = dbUrl.replace(/:[^:@]+@/, ':***@');
  console.log('📋 Connection String:');
  console.log(`   ${masked}\n`);

  // Parse connection details
  const hasSSL = dbUrl.includes('sslmode=');
  const isPooler = dbUrl.includes('pooler.supabase.com');
  const portMatch = dbUrl.match(/:(\d+)\//);
  const port = portMatch ? portMatch[1] : 'unknown';
  const hostMatch = dbUrl.match(/@([^:]+):/);
  const host = hostMatch ? hostMatch[1] : 'unknown';

  console.log('📊 Connection Details:');
  console.log(`   Host: ${host}`);
  console.log(`   Port: ${port}`);
  console.log(`   Type: ${isPooler ? 'Session Pooler' : 'Direct Connection'}`);
  console.log(`   SSL: ${hasSSL ? '✅ Required' : '❌ Missing'}\n`);

  // 2. Try connection with current settings
  console.log('1️⃣ Testing connection with current settings...\n');
  const prisma1 = new PrismaClient();
  
  try {
    await prisma1.$connect();
    console.log('✅ SUCCESS! Connection works with current settings.\n');
    await prisma1.$disconnect();
    return;
  } catch (error) {
    console.log('❌ Connection failed with current settings\n');
    console.log(`   Error: ${error.message}\n`);
    await prisma1.$disconnect().catch(() => {});
  }

  // 3. If using pooler with 5432, try 6543
  if (isPooler && port === '5432') {
    console.log('2️⃣ Trying alternative: Port 6543 (recommended for pooler)...\n');
    const altUrl = dbUrl.replace(':5432/', ':6543/');
    const altPrisma = new PrismaClient({
      datasources: {
        db: {
          url: altUrl,
        },
      },
    });

    try {
      await altPrisma.$connect();
      console.log('✅ SUCCESS with port 6543!\n');
      console.log('💡 SOLUTION: Update your DATABASE_URL to use port 6543:');
      const altMasked = altUrl.replace(/:[^:@]+@/, ':***@');
      console.log(`   ${altMasked}\n`);
      await altPrisma.$disconnect();
      return;
    } catch (error) {
      console.log('❌ Also failed with port 6543\n');
      await altPrisma.$disconnect().catch(() => {});
    }
  }

  // 4. Common issues
  console.log('3️⃣ Diagnostic Results:\n');
  console.log('❌ Connection failed with all attempted configurations\n');
  console.log('💡 Most Likely Causes:\n');
  console.log('   1. Database is PAUSED (Supabase free tier)');
  console.log('      → Go to Supabase Dashboard → Your Project');
  console.log('      → Look for "Paused" status or "Resume" button');
  console.log('      → Click "Resume" and wait 1-2 minutes\n');
  
  console.log('   2. Network/Firewall blocking connection');
  console.log('      → Check if you can access Supabase dashboard');
  console.log('      → Try from a different network\n');
  
  console.log('   3. Wrong connection string');
  console.log('      → Get fresh connection string from Supabase Dashboard');
  console.log('      → Settings → Database → Connection Pooling');
  console.log('      → Use "Session" mode connection string\n');

  console.log('   4. Password changed or expired');
  console.log('      → Reset password in Supabase Dashboard');
  console.log('      → Settings → Database → Reset database password\n');

  console.log('🔧 Quick Fix Steps:');
  console.log('   1. Open Supabase Dashboard');
  console.log('   2. Check if database is paused → Resume if needed');
  console.log('   3. Get fresh connection string from:');
  console.log('      Settings → Database → Connection Pooling → Session mode');
  console.log('   4. Update DATABASE_URL in .env file');
  console.log('   5. Make sure it includes ?sslmode=require\n');
}

diagnose().catch(console.error);
