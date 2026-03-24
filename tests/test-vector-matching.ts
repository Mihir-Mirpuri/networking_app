/**
 * Test: Vector role matching end-to-end
 * Embeds a search query and checks cosine distance against actual DB roles
 *
 * Usage: npx tsx tests/test-vector-matching.ts
 */

import 'dotenv/config';
import { getSearchRoleEmbedding, generateRoleEmbedding } from '../src/lib/services/embeddings';
import { isVectorRoleMatchingEnabled } from '../src/lib/db/person-service';

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
  console.log('Vector matching enabled:', isVectorRoleMatchingEnabled());
  console.log('OPENAI_API_KEY set:', !!process.env.OPENAI_API_KEY);
  console.log();

  // Test 1: Can we generate embeddings?
  const searchRole = 'Chip Design';
  const searchEmb = await getSearchRoleEmbedding(searchRole);
  if (!searchEmb) {
    console.error('FAILED: Could not generate search embedding');
    return;
  }
  console.log(`Search embedding for "${searchRole}": ${searchEmb.length} dimensions ✓`);

  // Test 2: Compare against actual Samsung roles from DB
  const dbRoles = [
    'Graphics Performance',
    'Metrology Applications Engineer',
    'Staff Engineer',
    'Sr Director of Product Management',
    'Reliability Engineer',
    'Head of Equipment & Component Procurement',
    'Senior Manager, Installation Finance', // not Samsung - should rank low
    'Software Engineer', // unrelated
    'Product Manager', // unrelated
  ];

  console.log(`\nSearch: "${searchRole}" vs actual DB roles:\n`);
  console.log('Role'.padEnd(50) + 'Similarity');
  console.log('-'.repeat(65));

  const results: Array<{ role: string; sim: number }> = [];
  for (const role of dbRoles) {
    const emb = await generateRoleEmbedding(role);
    if (emb) {
      const sim = cosineSimilarity(searchEmb, emb);
      results.push({ role, sim });
    }
  }

  results.sort((a, b) => b.sim - a.sim);
  for (const r of results) {
    console.log(`${r.role.padEnd(50)} ${r.sim.toFixed(4)}`);
  }

  // Test 3: Check how many people have null embeddings
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const [total, withEmb, withoutEmb] = await Promise.all([
    prisma.person.count(),
    prisma.$queryRaw<[{count: bigint}]>`SELECT COUNT(*) as count FROM "Person" WHERE role_embedding IS NOT NULL`,
    prisma.$queryRaw<[{count: bigint}]>`SELECT COUNT(*) as count FROM "Person" WHERE role_embedding IS NULL AND role IS NOT NULL`,
  ]);

  console.log(`\nEmbedding coverage:`);
  console.log(`  Total people: ${total}`);
  console.log(`  With embeddings: ${withEmb[0].count}`);
  console.log(`  Missing embeddings (have role): ${withoutEmb[0].count}`);

  await prisma.$disconnect();
}

main().catch(console.error);
