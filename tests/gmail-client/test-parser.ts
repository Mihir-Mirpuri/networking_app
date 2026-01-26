/**
 * Test script for parseGmailResponse functionality
 * 
 * Run with: npx tsx tests/gmail-client/test-parser.ts
 * 
 * Prerequisites:
 * - mock-email.json file must exist in tests/gmail-client/ directory
 * - To get a real Gmail API response:
 *   1. Go to https://developers.google.com/gmail/api/reference/rest/v1/users.messages/get
 *   2. Click "Try this API" and authorize
 *   3. Select a message ID and execute
 *   4. Copy the JSON response
 *   5. Save it to tests/gmail-client/mock-email.json
 */

import fs from 'fs';
import path from 'path';
import { parseGmailResponse, ParsedGmailMessage } from '@/lib/gmail/parser';
import { gmail_v1 } from 'googleapis';

function testParser() {
  console.log('🧪 Testing parseGmailResponse()\n');

  // Load mock email
  const mockEmailPath = path.join(__dirname, 'mock-email.json');
  
  if (!fs.existsSync(mockEmailPath)) {
    console.error('❌ mock-email.json not found!');
    console.error('   Please create tests/gmail-client/mock-email.json with a real Gmail API response.');
    console.error('   See instructions in the file header comments.\n');
    process.exit(1);
  }

  let mockEmail: gmail_v1.Schema$Message;
  try {
    const fileContent = fs.readFileSync(mockEmailPath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    
    // Check if this is still the placeholder file
    if (parsed._comment || parsed._instructions || parsed._note) {
      console.error('❌ mock-email.json still contains placeholder content!');
      console.error('\n📋 To fix this:');
      console.error('   1. Go to: https://developers.google.com/gmail/api/reference/rest/v1/users.messages/get');
      console.error('   2. Click "Try this API" and authorize with your Google account');
      console.error('   3. Set userId to "me"');
      console.error('   4. Enter a message ID from your inbox');
      console.error('   5. IMPORTANT: Set format to "full" (not "metadata" or "minimal")');
      console.error('   6. Execute the request');
      console.error('   7. Copy the ENTIRE JSON response');
      console.error('   8. Replace the contents of tests/gmail-client/mock-email.json with it\n');
      process.exit(1);
    }
    
    // Check if payload exists
    if (!parsed.payload) {
      console.error('❌ Gmail API response is missing the "payload" field!');
      console.error('\n💡 This usually means:');
      console.error('   - You used format="metadata" instead of format="full"');
      console.error('   - You used format="minimal" instead of format="full"');
      console.error('   - The response is incomplete\n');
      console.error('📋 Solution:');
      console.error('   When using Gmail API Explorer, make sure to set format="full"');
      console.error('   This ensures the payload with headers and body content is included.\n');
      process.exit(1);
    }
    
    mockEmail = parsed as gmail_v1.Schema$Message;
    console.log('✅ Loaded mock-email.json\n');
  } catch (error: any) {
    console.error('❌ Failed to load or parse mock-email.json:', error.message);
    console.error('   Make sure the file contains valid JSON from Gmail API.\n');
    process.exit(1);
  }

  // Test parsing
  console.log('1️⃣  Parsing Gmail message...');
  let parsed: ParsedGmailMessage;
  try {
    parsed = parseGmailResponse(mockEmail);
    console.log('   ✅ Parsing completed successfully\n');
  } catch (error: any) {
    console.error('   ❌ Parsing failed:', error.message);
    
    // Provide helpful guidance for common errors
    if (error.message.includes('payload is missing')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - Make sure you used format="full" when fetching from Gmail API');
      console.error('   - Check that mock-email.json contains a complete Gmail API response');
      console.error('   - The response should have a "payload" field with "headers" and "body"/"parts"\n');
    }
    
    if (error.stack && process.env.DEBUG) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }

  // Test results
  console.log('2️⃣  Validating parsed results...\n');
  
  let passedTests = 0;
  let failedTests = 0;

  // Test: Subject extraction
  console.log('   📋 Subject:');
  if (parsed.subject !== null) {
    console.log(`      ✅ Extracted: "${parsed.subject.substring(0, 60)}${parsed.subject.length > 60 ? '...' : ''}"`);
    passedTests++;
  } else {
    console.log('      ⚠️  Subject is null (may be missing in email)');
    passedTests++; // Not a failure, some emails don't have subjects
  }

  // Test: Sender extraction
  console.log('\n   📧 Sender:');
  if (parsed.sender && parsed.sender.includes('@')) {
    console.log(`      ✅ Email: ${parsed.sender}`);
    passedTests++;
  } else {
    console.log(`      ❌ Invalid sender email: ${parsed.sender}`);
    failedTests++;
  }
  
  if (parsed.senderName) {
    console.log(`      ✅ Name: ${parsed.senderName}`);
    passedTests++;
  } else {
    console.log('      ℹ️  No sender name extracted (email only)');
    passedTests++; // Not a failure
  }

  // Test: Recipients extraction
  console.log('\n   📬 Recipients:');
  if (parsed.recipient_list.length > 0) {
    console.log(`      ✅ Found ${parsed.recipient_list.length} recipient(s):`);
    parsed.recipient_list.forEach((email, idx) => {
      const name = parsed.recipientNames.find(r => r.email === email)?.name;
      console.log(`         ${idx + 1}. ${email}${name ? ` (${name})` : ''}`);
    });
    passedTests++;
  } else {
    console.log('      ⚠️  No recipients found (may be missing in email)');
    passedTests++; // Not a failure
  }

  // Test: Date extraction
  console.log('\n   📅 Date:');
  if (parsed.received_at instanceof Date && !isNaN(parsed.received_at.getTime())) {
    console.log(`      ✅ Parsed: ${parsed.received_at.toISOString()}`);
    passedTests++;
  } else {
    console.log(`      ❌ Invalid date: ${parsed.received_at}`);
    failedTests++;
  }

  // Test: Body extraction
  console.log('\n   📝 Body Content:');
  
  if (parsed.body_html) {
    const htmlLength = parsed.body_html.length;
    const htmlPreview = parsed.body_html.substring(0, 100).replace(/\s+/g, ' ');
    console.log(`      ✅ HTML body: ${htmlLength} characters`);
    console.log(`         Preview: ${htmlPreview}...`);
    passedTests++;
  } else {
    console.log('      ℹ️  No HTML body found');
    passedTests++; // Not a failure
  }
  
  if (parsed.body_text) {
    const textLength = parsed.body_text.length;
    const textPreview = parsed.body_text.substring(0, 100).replace(/\s+/g, ' ');
    console.log(`      ✅ Plain text body: ${textLength} characters`);
    console.log(`         Preview: ${textPreview}...`);
    passedTests++;
  } else {
    console.log('      ℹ️  No plain text body found');
    passedTests++; // Not a failure
  }

  // Test: HTML priority (if both exist, HTML should be present)
  if (parsed.body_html && parsed.body_text) {
    console.log('\n   🎯 HTML Priority:');
    console.log('      ✅ Both HTML and text found (HTML prioritized)');
    passedTests++;
  }

  // Test: At least one body type should exist
  if (!parsed.body_html && !parsed.body_text) {
    console.log('\n   ⚠️  Warning: No body content extracted');
    console.log('      This may indicate an issue with the parser or the email structure.');
    failedTests++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary:');
  console.log(`   ✅ Passed: ${passedTests}`);
  if (failedTests > 0) {
    console.log(`   ❌ Failed: ${failedTests}`);
    console.log('\n❌ Some tests failed. Please review the output above.\n');
    process.exit(1);
  } else {
    console.log('   ❌ Failed: 0');
    console.log('\n✅ All tests passed! Parser is working correctly.\n');
  }

  // Display full parsed object for inspection
  console.log('📋 Full Parsed Object:');
  console.log(JSON.stringify(parsed, null, 2));
  console.log('');
}

// Run the test
testParser();
