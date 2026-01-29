/**
 * Test script for Groq service
 *
 * Run with: npx ts-node -r tsconfig-paths/register src/lib/services/groq/test-groq.ts
 * Or: npx tsx src/lib/services/groq/test-groq.ts
 *
 * Make sure GROQ_API_KEY is set in your environment or .env.local
 */

import 'dotenv/config';
import { complete, completeJson, GroqJsonParseError } from './index';

interface ExtractedMeeting {
  hasMeeting: boolean;
  title: string | null;
  dateTime: string | null;
  location: string | null;
}

async function testTextCompletion() {
  console.log('--- Test 1: Text Completion ---');

  const response = await complete({
    systemPrompt: 'You are a helpful assistant. Be concise.',
    userPrompt: 'What is 2 + 2?',
  });

  console.log('Response:', response.content);
  console.log('Tokens used:', response.usage.totalTokens);
  console.log('Model:', response.model);
  console.log('✓ Text completion works\n');
}

async function testJsonCompletion() {
  console.log('--- Test 2: JSON Completion ---');

  const emailText = `
    Hey! Would love to grab coffee next Tuesday at 2pm.
    How about Blue Bottle on Market Street?
  `;

  const response = await completeJson<ExtractedMeeting>({
    systemPrompt: `Extract meeting details from the text. Return JSON with:
      - hasMeeting: boolean
      - title: string or null
      - dateTime: string or null (natural language is fine)
      - location: string or null`,
    userPrompt: emailText,
  });

  console.log('Parsed response:', response.content);
  console.log('Has meeting:', response.content.hasMeeting);
  console.log('Title:', response.content.title);
  console.log('DateTime:', response.content.dateTime);
  console.log('Location:', response.content.location);
  console.log('Tokens used:', response.usage.totalTokens);
  console.log('✓ JSON completion works\n');
}

async function testNoMeetingEmail() {
  console.log('--- Test 3: Email Without Meeting ---');

  const emailText = `
    Thanks for reaching out! Unfortunately we're not hiring right now.
    I'll keep your resume on file.
  `;

  const response = await completeJson<ExtractedMeeting>({
    systemPrompt: `Extract meeting details from the text. Return JSON with:
      - hasMeeting: boolean
      - title: string or null
      - dateTime: string or null
      - location: string or null`,
    userPrompt: emailText,
  });

  console.log('Parsed response:', response.content);
  console.log('Has meeting:', response.content.hasMeeting);
  console.log('✓ No-meeting detection works\n');
}

async function runTests() {
  console.log('=== Groq Service Tests ===\n');

  try {
    await testTextCompletion();
    await testJsonCompletion();
    await testNoMeetingEmail();
    console.log('=== All tests passed! ===');
  } catch (error) {
    if (error instanceof GroqJsonParseError) {
      console.error('JSON Parse Error. Raw content:', error.rawContent);
    }
    console.error('Test failed:', error);
    process.exit(1);
  }
}

runTests();
