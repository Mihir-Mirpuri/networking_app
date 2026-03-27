/**
 * Role embedding service using OpenAI text-embedding-3-small
 *
 * Generates vector embeddings for role/title strings and stores them
 * in Postgres via pgvector. Used for semantic role matching in discovery search.
 *
 * Graceful fallback: if OPENAI_API_KEY is not set, all functions return null
 * and callers fall back to the existing alias-based matching system.
 */

import OpenAI from 'openai';
import prisma from '@/lib/prisma';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Generate embedding for a single role string.
 * Returns null if OPENAI_API_KEY is not set.
 */
export async function generateRoleEmbedding(role: string): Promise<number[] | null> {
  const client = getOpenAIClient();
  if (!client) {
    console.warn(`[Embeddings] No OpenAI client (OPENAI_API_KEY missing)`);
    return null;
  }

  try {
    const start = Date.now();
    const response = await client.embeddings.create({
      model: MODEL,
      input: role.trim(),
      dimensions: DIMENSIONS,
    });
    console.log(`[Embeddings] Generated embedding for "${role}" in ${Date.now() - start}ms`);
    return response.data[0].embedding;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Embeddings] OpenAI API error for role="${role}": ${msg}`);
    return null;
  }
}

/**
 * Generate embeddings for multiple roles in a single API call (batch).
 * Returns a Map of role -> embedding. Roles with empty strings are skipped.
 * Returns empty Map if OPENAI_API_KEY is not set.
 */
export async function generateRoleEmbeddings(roles: string[]): Promise<Map<string, number[]>> {
  const client = getOpenAIClient();
  const result = new Map<string, number[]>();
  if (!client) return result;

  const cleanRoles = roles.map(r => r.trim()).filter(r => r.length > 0);
  if (cleanRoles.length === 0) return result;

  // Deduplicate
  const uniqueRoles = Array.from(new Set(cleanRoles));

  const response = await client.embeddings.create({
    model: MODEL,
    input: uniqueRoles,
    dimensions: DIMENSIONS,
  });

  for (let i = 0; i < response.data.length; i++) {
    result.set(uniqueRoles[i], response.data[i].embedding);
  }

  return result;
}

/**
 * In-memory cache for search role embeddings.
 * Roles come from dropdown menus (~50 distinct values), so this stays small.
 */
const searchRoleCache = new Map<string, number[]>();

/**
 * Get embedding for a search role, with in-memory caching.
 * Returns null if OPENAI_API_KEY is not set.
 */
export async function getSearchRoleEmbedding(role: string): Promise<number[] | null> {
  const key = role.trim().toLowerCase();
  if (searchRoleCache.has(key)) {
    return searchRoleCache.get(key)!;
  }

  const embedding = await generateRoleEmbedding(role);
  if (embedding) {
    searchRoleCache.set(key, embedding);
  }
  return embedding;
}

/**
 * Batch-generate and store role embeddings for multiple Person records.
 * Takes a Map of personId -> role, calls generateRoleEmbeddings once (single OpenAI call),
 * then bulk-updates all Person records. Returns the number of records updated.
 */
export async function bulkUpdatePersonRoleEmbeddings(
  personRoles: Map<string, string>
): Promise<number> {
  if (personRoles.size === 0) return 0;

  const allRoles = Array.from(personRoles.values());
  const roles = Array.from(new Set(allRoles)).filter(r => r.trim().length > 0);
  if (roles.length === 0) return 0;

  const start = Date.now();
  const embeddings = await generateRoleEmbeddings(roles);
  if (embeddings.size === 0) return 0;

  let updated = 0;
  const entries = Array.from(personRoles.entries());
  for (const [personId, role] of entries) {
    const embedding = embeddings.get(role.trim());
    if (!embedding) continue;
    const vectorString = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "Person" SET role_embedding = ${vectorString}::vector WHERE id = ${personId}
    `;
    updated++;
  }

  console.log(`[Embeddings] Batch embedded ${updated}/${personRoles.size} roles (${roles.length} unique) in ${Date.now() - start}ms`);
  return updated;
}

/**
 * Generate and store role embedding for a Person record.
 * Uses $executeRaw since Prisma doesn't natively support pgvector types.
 * Returns true if embedding was stored, false if skipped/failed.
 */
export async function updatePersonRoleEmbedding(personId: string, role: string): Promise<boolean> {
  const embedding = await generateRoleEmbedding(role);
  if (!embedding) return false;

  const vectorString = `[${embedding.join(',')}]`;

  await prisma.$executeRaw`
    UPDATE "Person"
    SET role_embedding = ${vectorString}::vector
    WHERE id = ${personId}
  `;

  return true;
}
