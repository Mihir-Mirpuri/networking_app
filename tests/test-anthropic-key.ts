import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

async function main() {
  console.log('Key starts with:', process.env.ANTHROPIC_API_KEY?.substring(0, 15));
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await client.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 50,
    messages: [{ role: 'user', content: 'Say hello in 5 words' }],
  });
  console.log('Response:', r.content[0]);
}

main().catch(console.error);
