/**
 * Company Alias Resolution Service
 *
 * Resolves company names to their canonical form + known aliases.
 * Two-tier lookup: DB CompanyAlias table → LLM (Groq).
 * LLM results are persisted so each company is only resolved once.
 *
 * Used by the CSE pre-filter in processRefreshBatch to avoid discarding
 * valid profiles due to company name mismatches.
 */

import prisma from '@/lib/prisma';
import { completeJson } from '@/lib/services/groq';
import { normalizeCompanyForMatch } from '@/lib/db/person-service';

export interface ResolvedCompanyAliases {
  canonicalName: string;
  aliases: string[]; // all lowercase/normalized
}

/**
 * Normalize a company name for alias lookup.
 * Lowercase, trim, strip dots, collapse whitespace.
 */
function normalizeForLookup(company: string): string {
  return company
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a company name to its canonical name + all known aliases.
 *
 * 1. Check CompanyAlias DB table
 * 2. Fall back to LLM (Groq) and persist result
 * 3. On LLM failure, return input as-is (graceful degradation)
 */
export async function resolveCompanyAliases(input: string): Promise<ResolvedCompanyAliases> {
  const normalized = normalizeForLookup(input);
  if (!normalized) {
    return { canonicalName: input, aliases: [normalizeCompanyForMatch(input)] };
  }

  // ── Tier 1: DB lookup ──
  try {
    const dbResult = await prisma.companyAlias.findFirst({
      where: { aliases: { has: normalized } },
    });

    if (dbResult) {
      console.log(`[CompanyAlias] Resolved "${input}" → "${dbResult.canonicalName}" (source: DB)`);
      return {
        canonicalName: dbResult.canonicalName,
        aliases: dbResult.aliases,
      };
    }
  } catch (error) {
    console.warn(`[CompanyAlias] DB lookup failed for "${input}":`, error);
    // Continue to LLM fallback
  }

  // ── Tier 2: LLM resolution + persist ──
  try {
    interface AliasResponse {
      canonicalName: string;
      aliases: string[];
    }

    const response = await completeJson<AliasResponse>({
      systemPrompt:
        'You are a company name expert. Given a company name (which may be an abbreviation, informal name, or full name), return a JSON object with:\n' +
        '- "canonicalName": the full, official company name\n' +
        '- "aliases": array of 2-5 widely-recognized alternative names, abbreviations, or variations used on LinkedIn profiles. Include the canonical name and the input. All values should be lowercase. Only include well-known, unambiguous variations.\n' +
        'Example: Input "GS" → {"canonicalName": "Goldman Sachs", "aliases": ["goldman sachs", "gs"]}\n' +
        'Example: Input "P&G" → {"canonicalName": "Procter & Gamble", "aliases": ["procter & gamble", "procter and gamble", "p&g", "pg"]}\n' +
        'If unsure, return {"canonicalName": "<input>", "aliases": ["<input>"]}',
      userPrompt: input.trim(),
      options: {
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        maxTokens: 200,
      },
      metadata: { action: 'COMPANY_ALIAS' },
    });

    const canonicalName = response.content.canonicalName || input;
    // Ensure aliases are lowercase and include both the canonical name and input
    const rawAliases = (response.content.aliases || []).map((a: string) =>
      a.toLowerCase().trim()
    );

    // Deduplicate and ensure input + canonical are included
    const aliasSet = new Set(rawAliases);
    aliasSet.add(normalized);
    aliasSet.add(canonicalName.toLowerCase().trim());
    const aliases = Array.from(aliasSet).filter(Boolean);

    // Persist to DB
    await prisma.companyAlias.create({
      data: {
        canonicalName,
        aliases,
        source: 'LLM',
      },
    });

    console.log(`[CompanyAlias] Resolved "${input}" → "${canonicalName}" (source: LLM, saved)`);
    return { canonicalName, aliases };
  } catch (error) {
    console.warn(`[CompanyAlias] LLM resolution failed for "${input}":`, error);
    // Graceful degradation
    const fallbackAlias = normalizeCompanyForMatch(input);
    console.log(`[CompanyAlias] Falling back to input: "${input}" → ["${fallbackAlias}"]`);
    return { canonicalName: input, aliases: [fallbackAlias] };
  }
}
