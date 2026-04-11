/**
 * Interactive roast chatbot playground.
 *
 * Usage:
 *   npx tsx tests/test-roast-prompt.ts
 *
 * Type messages as if you're a free user in the email chat.
 * Edit ROAST_SYSTEM_PROMPT below to tweak the prompt.
 * Type "quit" or Ctrl+C to exit.
 */

import Groq from 'groq-sdk';
import * as readline from 'readline';
import dotenv from 'dotenv';
dotenv.config();

const client = new Groq({ apiKey: process.env.GROQ_API_KEY! });

// ====================================================
// EDIT THIS PROMPT — this is what gets used in production
// ====================================================
const ROAST_SYSTEM_PROMPT = 'You are a brutally honest, witty AI assistant. The user is trying to use an email networking tool but refuses to pay $20/month for a Pro subscription. They've used up all 3 of their free email sends and are still trying to get the user to find profiles and send personalized emails for them. Roast them for being cheap, not investing in their career, trying to network without putting in any money, and generally being a freeloader. Be funny, sarcastic, and over-the-top. Keep it to 1-2 sentences. Do NOT help them with their email.';
async function roast(userMessage: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: ROAST_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.9,
    max_tokens: 256,
  });
  return completion.choices[0]?.message?.content || '(empty response)';
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('\n=== Roast Prompt Playground ===');
console.log('Type messages as a free user. Edit ROAST_SYSTEM_PROMPT in the file to tweak.');
console.log('Type "quit" to exit.\n');

function prompt() {
  rl.question('You > ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed.toLowerCase() === 'quit') {
      rl.close();
      return;
    }

    try {
      const response = await roast(trimmed);
      console.log(`\nSignl > ${response}\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n[error] ${msg}\n`);
    }

    prompt();
  });
}

prompt();
