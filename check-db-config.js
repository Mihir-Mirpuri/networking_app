#!/usr/bin/env node
/**
 * Check DATABASE_URL configuration across all .env files
 */

const fs = require('fs');
const path = require('path');

const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];

console.log('🔍 Checking DATABASE_URL configuration...\n');

let found = false;

envFiles.forEach(file => {
  const filePath = path.resolve(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      if (line.trim().startsWith('DATABASE_URL=') || line.trim().startsWith('DATABASE_URL =')) {
        found = true;
        const match = line.match(/DATABASE_URL\s*=\s*["']?([^"']+)["']?/);
        if (match) {
          const dbUrl = match[1];
          const masked = dbUrl.replace(/:[^:@]+@/, ':***@');
          
          console.log(`📄 Found in ${file}:`);
          console.log(`   ${masked}\n`);
          
          const hasSSL = dbUrl.includes('sslmode=');
          const isPooler = dbUrl.includes('pooler.supabase.com');
          const portMatch = dbUrl.match(/:(\d+)\//);
          const port = portMatch ? portMatch[1] : 'unknown';
          
          console.log(`   ✅ Pooler: ${isPooler ? 'Yes' : 'No'}`);
          console.log(`   ${hasSSL ? '✅' : '❌'} SSL Mode: ${hasSSL ? 'Set' : 'MISSING - Add ?sslmode=require'}`);
          console.log(`   ✅ Port: ${port}\n`);
          
          if (!hasSSL) {
            console.log(`   ⚠️  ISSUE: Missing ?sslmode=require`);
            console.log(`   Fix: Add ?sslmode=require to the end of DATABASE_URL in ${file}\n`);
          }
        }
      }
    });
  }
});

if (!found) {
  console.log('❌ DATABASE_URL not found in any .env file');
  console.log('   Make sure you have DATABASE_URL set in .env or .env.local\n');
}

console.log('💡 Next Steps:');
console.log('   1. If DATABASE_URL is missing ?sslmode=require, add it');
console.log('   2. Restart your Next.js dev server (npm run dev)');
console.log('   3. This clears the cached PrismaClient with the old connection string\n');
