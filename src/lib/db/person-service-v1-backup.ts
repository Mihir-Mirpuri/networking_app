/**
 * BACKUP of V1 retrieval functions from person-service.ts
 * Archived on 2026-04-13 before replacing with V2 (hybrid vector + pg_trgm).
 *
 * To revert: copy findPeopleByFilters and findPeopleByFiltersVector back
 * into person-service.ts, replacing the V2 delegation.
 *
 * Dependencies (already in person-service.ts):
 * - PersonFilters interface (line ~726)
 * - buildPersonWhereClause (line ~748)
 * - getSchoolMatchIds (line ~861)
 * - applyPostQueryFilters (line ~876)
 * - getRoleSearchTerms
 * - getSearchRoleEmbedding
 * - isVectorRoleMatchingEnabled
 */

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getSearchRoleEmbedding } from '@/lib/services/embeddings';

// ─── V1 PersonFilters interface ───
export interface PersonFilters {
  company: string;           // Required - ILIKE match (primary company or first for multi)
  companies?: string[];      // All searched companies (for multi-company post-filter)
  companyAliases?: string[]; // Pre-resolved aliases (exact match, skips post-query filter)
  location?: string;         // Optional - city ILIKE match
  role?: string;             // Optional - role ILIKE match
  university?: string;       // Optional - educationSchool ILIKE match
  roleSpecificity?: 'narrow' | 'standard' | 'broad'; // Controls vector similarity threshold
  requireEmail?: boolean;    // Default true - only return people with emails
  excludePersonIds?: string[]; // Person IDs to exclude (already displayed + sent/hidden)
  limit: number;
}

// ─── V1 findPeopleByFilters (dispatcher) ───
/*
export async function findPeopleByFilters(filters: PersonFilters): Promise<PersonResult[]> {
  const { company, role, limit } = filters;

  // Dispatch to vector path if role provided and vector matching is enabled
  if (role && role.trim() && isVectorRoleMatchingEnabled()) {
    const searchEmbedding = await getSearchRoleEmbedding(role);
    if (searchEmbedding) {
      console.log(`[PersonService] Using VECTOR path for role="${role}" | company="${company}" | aliases=${filters.companyAliases?.length ?? 0} | limit=${limit}`);
      return findPeopleByFiltersVector(filters, searchEmbedding);
    }
    console.warn(`[PersonService] Embedding FAILED for role="${role}" — falling back to ILIKE path`);
  } else if (role && role.trim()) {
    console.log(`[PersonService] Vector matching disabled (OPENAI_API_KEY=${!!process.env.OPENAI_API_KEY}, USE_VECTOR_ROLE_MATCHING=${process.env.USE_VECTOR_ROLE_MATCHING}) — using ILIKE path`);
  } else {
    console.log(`[PersonService] No role filter — using ILIKE path`);
  }

  // Fallback: existing Prisma path
  const roleTerms = role ? getRoleSearchTerms(role) : [];
  console.log(`[PersonService] ILIKE path: role="${role}" → terms=${JSON.stringify(roleTerms)} | company="${company}" | aliases=${filters.companyAliases?.length ?? 0} | limit=${limit}`);

  const schoolMatchIds = filters.university?.trim() ? await getSchoolMatchIds(filters.university) : undefined;
  const where = buildPersonWhereClause(filters, schoolMatchIds);

  const people = await prisma.person.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      company: true,
      role: true,
      linkedinUrl: true,
      email: true,
      emailStatus: true,
      emailConfidence: true,
      emailDeliverable: true,
      emailVerifiedAt: true,
      emailVerificationReason: true,
      city: true,
      state: true,
      country: true,
      educationSchool: true,
      educationDegree: true,
      educationField: true,
      educationYear: true,
      scrapeDepth: true,
      sourceLinks: {
        where: { kind: 'DISCOVERY' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          url: true,
          title: true,
          snippet: true,
          domain: true,
        },
      },
    },
    orderBy: [
      { emailStatus: 'asc' },
      { emailConfidence: 'desc' },
      { createdAt: 'asc' },
    ],
    take: limit * 2,
  });

  console.log(`[ILIKEQuery] Raw rows returned: ${people.length}${people.length > 0 ? ` | top roles: ${people.slice(0, 3).map(p => p.role).join(', ')}` : ''}`);

  if (filters.companyAliases && filters.companyAliases.length > 0) {
    return people.slice(0, limit);
  }
  const filtered = applyPostQueryFilters(people, filters.companies || company);
  return filtered.slice(0, limit);
}
*/

// ─── V1 findPeopleByFiltersVector ───
/*
async function findPeopleByFiltersVector(
  filters: PersonFilters,
  searchEmbedding: number[]
): Promise<PersonResult[]> {
  const { company, location, university, requireEmail = true, excludePersonIds, limit } = filters;
  const vectorString = `[${searchEmbedding.join(',')}]`;

  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

  if (filters.companyAliases && filters.companyAliases.length > 0) {
    const companyConditions = filters.companyAliases.map(alias =>
      alias.length <= 3
        ? Prisma.sql`p.company ILIKE ${alias}`
        : Prisma.sql`p.company ILIKE ${'%' + alias + '%'}`
    );
    conditions.push(Prisma.sql`(${Prisma.join(companyConditions, ' OR ')})`);
  } else if (company && company.trim()) {
    conditions.push(Prisma.sql`p.company ILIKE ${'%' + company.trim() + '%'}`);
  }

  if (location && location.trim()) {
    const locationParts = location.split(',').map(p => p.trim()).filter(Boolean);
    const locConditions = locationParts.map(part => {
      const term = '%' + part + '%';
      return Prisma.sql`(p.city ILIKE ${term} OR p.state ILIKE ${term})`;
    });
    conditions.push(Prisma.sql`(${Prisma.join(locConditions, ' OR ')})`);
  }

  if (university && university.trim()) {
    const keywords = getUniversityKeywords(university);
    const kwConditions = keywords.map(kw => {
      const term = '%' + kw + '%';
      return Prisma.sql`(p."educationSchool" ILIKE ${term} OR p.schools::text ILIKE ${term})`;
    });
    conditions.push(Prisma.sql`(${Prisma.join(kwConditions, ' AND ')})`);
  }

  if (requireEmail) {
    conditions.push(Prisma.sql`p.email IS NOT NULL`);
    conditions.push(Prisma.sql`(p."emailDeliverable" = true OR p."emailDeliverable" IS NULL)`);
  } else {
    conditions.push(Prisma.sql`NOT (p.email IS NULL AND p."apolloEnrichedAt" IS NOT NULL)`);
    conditions.push(Prisma.sql`(p."emailDeliverable" = true OR p."emailDeliverable" IS NULL)`);
  }

  if (excludePersonIds && excludePersonIds.length > 0) {
    conditions.push(Prisma.sql`p.id NOT IN (${Prisma.join(excludePersonIds)})`);
  }

  conditions.push(Prisma.sql`p.role IS NOT NULL`);
  conditions.push(Prisma.sql`p.role !~* '^(incoming|future)\s+'`);

  const SPECIFICITY_THRESHOLDS = { narrow: 0.28, standard: 0.38, broad: 0.48 } as const;
  const threshold = SPECIFICITY_THRESHOLDS[filters.roleSpecificity || 'standard'];
  conditions.push(Prisma.sql`
    p.role_embedding IS NOT NULL
    AND (p.role_embedding <=> ${vectorString}::vector) <= ${threshold}
  `);

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  const fetchLimit = limit * 2;

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    company: string;
    role: string | null;
    linkedinUrl: string | null;
    email: string | null;
    emailStatus: string | null;
    emailConfidence: number | null;
    emailDeliverable: boolean | null;
    emailVerifiedAt: Date | null;
    emailVerificationReason: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    educationSchool: string | null;
    educationDegree: string | null;
    educationField: string | null;
    educationYear: string | null;
    scrapeDepth: string;
    role_distance: number;
  }>>(Prisma.sql`
    SELECT
      p.id,
      p."fullName",
      p."firstName",
      p."lastName",
      p.company,
      p.role,
      p."linkedinUrl",
      p.email,
      p."emailStatus"::text,
      p."emailConfidence",
      p."emailDeliverable",
      p."emailVerifiedAt",
      p."emailVerificationReason",
      p.city,
      p.state,
      p.country,
      p."educationSchool",
      p."educationDegree",
      p."educationField",
      p."educationYear",
      p."scrapeDepth",
      (p.role_embedding <=> ${vectorString}::vector) as role_distance
    FROM "Person" p
    ${whereClause}
    ORDER BY
      role_distance ASC,
      CASE p."emailStatus"::text
        WHEN 'VERIFIED' THEN 0
        WHEN 'MANUAL'   THEN 1
        WHEN 'UNVERIFIED' THEN 2
        ELSE 3
      END ASC,
      p."emailConfidence" DESC NULLS LAST
    LIMIT ${fetchLimit}
  `);

  const filtered = (filters.companyAliases && filters.companyAliases.length > 0)
    ? rows
    : applyPostQueryFilters(rows, filters.companies || company);
  const limited = filtered.slice(0, limit);

  if (limited.length === 0) return [];

  const personIds = limited.map(p => p.id);
  const sourceLinks = await prisma.sourceLink.findMany({
    where: {
      personId: { in: personIds },
      kind: 'DISCOVERY',
    },
    orderBy: { createdAt: 'asc' },
    select: {
      personId: true,
      url: true,
      title: true,
      snippet: true,
      domain: true,
    },
  });

  const sourceLinkMap = new Map<string, (typeof sourceLinks)[0]>();
  for (const sl of sourceLinks) {
    if (!sourceLinkMap.has(sl.personId)) {
      sourceLinkMap.set(sl.personId, sl);
    }
  }

  return limited.map(row => {
    const sl = sourceLinkMap.get(row.id);
    return {
      ...row,
      roleDistance: row.role_distance,
      sourceLinks: sl
        ? [{ url: sl.url, title: sl.title, snippet: sl.snippet, domain: sl.domain }]
        : [],
    };
  });
}
*/
