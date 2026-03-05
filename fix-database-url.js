#!/usr/bin/env node
/**
 * Helper script to fix DATABASE_URL in .env file
 * 
 * This script:
 * 1. Reads your current DATABASE_URL
 * 2. Fixes the port (5432 → 6543 for pooler)
 * 3. Adds ?sslmode=require if missing
 * 4. Updates your .env file
 */

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env');

if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found');
  process.exit(1);
}

// Read .env file
const envContent = fs.readFileSync(envPath, 'utf8');
const lines = envContent.split('\n');

let updated = false;
const newLines = lines.map((line, index) => {
  // Match DATABASE_URL line
  if (line.trim().startsWith('DATABASE_URL=') || line.trim().startsWith('DATABASE_URL =')) {
    const match = line.match(/DATABASE_URL\s*=\s*["']?([^"']+)["']?/);
    if (match) {
      let dbUrl = match[1];
      let originalUrl = dbUrl;
      
      // Fix port if using pooler with 5432
      if (dbUrl.includes('pooler.supabase.com') && dbUrl.includes(':5432')) {
        dbUrl = dbUrl.replace(':5432', ':6543');
        console.log('✅ Fixed port: 5432 → 6543');
        updated = true;
      }
      
      // Add SSL mode if missing
      if (!dbUrl.includes('sslmode=')) {
        const separator = dbUrl.includes('?') ? '&' : '?';
        dbUrl = dbUrl + separator + 'sslmode=require';
        console.log('✅ Added ?sslmode=require');
        updated = true;
      }
      
      if (updated) {
        // Reconstruct the line with proper quoting
        const prefix = line.substring(0, line.indexOf('DATABASE_URL') + 'DATABASE_URL'.length);
        const hasEquals = line.includes('=');
        const quote = line.includes('"') ? '"' : (line.includes("'") ? "'" : '"');
        return `${prefix}${hasEquals ? '=' : ' ='}${quote}${dbUrl}${quote}`;
      }
    }
  }
  return line;
});

if (updated) {
  // Write back to .env
  fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');
  console.log('\n✅ Updated .env file successfully!');
  console.log('\n📋 New DATABASE_URL:');
  const newUrl = newLines.find(l => l.includes('DATABASE_URL')).match(/["']([^"']+)["']/)?.[1];
  const masked = newUrl?.replace(/:[^:@]+@/, ':***@') || 'N/A';
  console.log(`   ${masked}\n`);
  console.log('💡 You can now run your test again:');
  console.log('   npx tsx tests/gmail-client/test-get-client.ts\n');
} else {
  console.log('ℹ️  No changes needed. Your DATABASE_URL looks correct.');
  console.log('\n📋 Current DATABASE_URL:');
  const currentUrl = lines.find(l => l.includes('DATABASE_URL'))?.match(/["']([^"']+)["']/)?.[1];
  if (currentUrl) {
    const masked = currentUrl.replace(/:[^:@]+@/, ':***@');
    console.log(`   ${masked}`);
    
    // Check for issues
    const issues = [];
    if (currentUrl.includes('pooler.supabase.com') && currentUrl.includes(':5432')) {
      issues.push('⚠️  Using pooler with port 5432 (should be 6543)');
    }
    if (!currentUrl.includes('sslmode=')) {
      issues.push('⚠️  Missing ?sslmode=require');
    }
    
    if (issues.length > 0) {
      console.log('\n⚠️  Issues found:');
      issues.forEach(issue => console.log(`   ${issue}`));
      console.log('\n💡 Run this script to auto-fix, or manually update your .env file');
    } else {
      console.log('\n✅ Connection string format looks good!');
    }
  }
}
