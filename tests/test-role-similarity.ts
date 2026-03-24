/**
 * Test: Cosine similarity between "Hardware Engineer" and various related roles
 * Usage: npx tsx tests/test-role-similarity.ts
 */

import 'dotenv/config';
import OpenAI from 'openai';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function main() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const searchQuery = 'Hardware Engineer';
  const roles = [
    // Should match (hardware-related)
    'Chip Design Engineer',
    'Semiconductor Process Engineer',
    'ASIC Design Engineer',
    'VLSI Engineer',
    'Hardware Verification Engineer',
    'Embedded Systems Engineer',
    'PCB Design Engineer',
    'IC Layout Engineer',
    'Firmware Engineer',
    // Should partially match
    'Electrical Engineer',
    'Systems Engineer',
    'Manufacturing Engineer',
    // Should NOT match well
    'Software Engineer',
    'Product Manager',
    'Data Scientist',
    'Marketing Manager',
    'Financial Analyst',
  ];

  const allInputs = [searchQuery, ...roles];
  const response = await client.embeddings.create({
    model: MODEL,
    input: allInputs,
    dimensions: DIMENSIONS,
  });

  const searchEmb = response.data[0].embedding;

  console.log(`\nSearch query: "${searchQuery}"\n`);
  console.log('Role'.padEnd(40) + 'Similarity');
  console.log('-'.repeat(55));

  const results = roles.map((role, i) => ({
    role,
    similarity: cosineSimilarity(searchEmb, response.data[i + 1].embedding),
  }));

  results.sort((a, b) => b.similarity - a.similarity);

  for (const r of results) {
    const bar = '█'.repeat(Math.round(r.similarity * 50));
    console.log(`${r.role.padEnd(40)} ${r.similarity.toFixed(4)}  ${bar}`);
  }
}

main().catch(console.error);
