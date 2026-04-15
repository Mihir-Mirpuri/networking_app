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
import { logApiCost, openaiEmbeddingCost } from '@/lib/services/cost-logger';

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
    const totalTokens = response.usage?.total_tokens ?? 0;
    logApiCost({
      service: 'openai-embeddings',
      action: 'ROLE_EMBEDDING',
      costUsd: openaiEmbeddingCost(totalTokens),
      durationMs: Date.now() - start,
      metadata: { role: role.trim(), totalTokens },
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
 * In-memory cache for search role embeddings.
 * Roles come from dropdown menus (~50 distinct values), so this stays small.
 */
const searchRoleCache = new Map<string, number[]>();

/** Normalize a role string for cache lookup: lowercase + trim. */
export function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

/**
 * Look up a cached role embedding — checks in-memory first, then the RoleEmbedding table.
 * Returns null if not found in either layer.
 */
export async function lookupCachedEmbedding(role: string): Promise<number[] | null> {
  const key = normalizeRole(role);

  // 1. In-memory cache
  if (searchRoleCache.has(key)) {
    return searchRoleCache.get(key)!;
  }

  // 2. RoleEmbedding table
  try {
    const rows = await prisma.$queryRaw<Array<{ embedding: string }>>`
      SELECT embedding::text FROM "RoleEmbedding" WHERE role = ${key} LIMIT 1
    `;
    if (rows.length > 0) {
      const embedding = JSON.parse(rows[0].embedding) as number[];
      searchRoleCache.set(key, embedding); // warm in-memory cache
      console.log(`[Embeddings] DB cache hit for "${key}"`);
      return embedding;
    }
  } catch (error) {
    console.error(`[Embeddings] RoleEmbedding lookup error for "${key}":`, error instanceof Error ? error.message : error);
  }

  return null;
}

/**
 * Persist a role embedding to the RoleEmbedding table.
 * Uses INSERT ... ON CONFLICT DO NOTHING for race safety.
 * Fire-and-forget — errors are logged but swallowed.
 */
export async function cacheRoleEmbedding(role: string, embedding: number[]): Promise<void> {
  const key = normalizeRole(role);
  const vectorString = `[${embedding.join(',')}]`;

  try {
    await prisma.$executeRaw`
      INSERT INTO "RoleEmbedding" (id, role, embedding, "createdAt")
      VALUES (gen_random_uuid()::text, ${key}, ${vectorString}::vector, NOW())
      ON CONFLICT (role) DO NOTHING
    `;
    console.log(`[Embeddings] Cached embedding for "${key}" in RoleEmbedding table`);
  } catch (error) {
    console.error(`[Embeddings] Failed to cache embedding for "${key}":`, error instanceof Error ? error.message : error);
  }
}

/**
 * Get embedding for a search role, with 3-tier lookup:
 * 1. In-memory cache (instant)
 * 2. RoleEmbedding table (~5ms)
 * 3. OpenAI API (fallback, ~1.2s) → then fire-and-forget persist to RoleEmbedding
 *
 * Returns null if OPENAI_API_KEY is not set AND role is not cached.
 */
export async function getSearchRoleEmbedding(role: string): Promise<number[] | null> {
  const key = normalizeRole(role);

  // Tier 1 + 2: in-memory and DB cache
  const cached = await lookupCachedEmbedding(role);
  if (cached) return cached;

  // Tier 3: OpenAI API
  const embedding = await generateRoleEmbedding(role);
  if (embedding) {
    searchRoleCache.set(key, embedding);
    // Fire-and-forget persist to RoleEmbedding table
    cacheRoleEmbedding(role, embedding).catch(() => {});
  }
  return embedding;
}

/**
 * Stamp a Person's role_embedding from the RoleEmbedding cache.
 * Never calls OpenAI — if the role isn't cached yet, it's a no-op.
 * The IS NULL guard makes this idempotent (won't overwrite existing embeddings).
 */
export async function stampPersonRoleEmbedding(personId: string, role: string): Promise<void> {
  const embedding = await lookupCachedEmbedding(role);
  if (!embedding) return; // role not in cache — no-op

  const vectorString = `[${embedding.join(',')}]`;
  await prisma.$executeRaw`
    UPDATE "Person"
    SET role_embedding = ${vectorString}::vector
    WHERE id = ${personId} AND role_embedding IS NULL
  `;
}

