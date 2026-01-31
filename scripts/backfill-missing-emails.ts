/**
 * Backfill missing emails via Apollo for Person records that have email IS NULL.
 *
 * Run from project root (loads .env via dotenv/config):
 *   npm run backfill:emails
 *   tsx scripts/backfill-missing-emails.ts
 * With limit or dry-run:
 *   LIMIT=20 npm run backfill:emails
 *   DRY_RUN=1 npm run backfill:emails
 *
 * Env:
 *   LIMIT     - Max number of people to process (default: all). Use for testing.
 *   DRY_RUN   - If "1", only log what would be done; no Apollo calls, no DB writes.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { getOrFindEmail } from '../src/lib/services/email-cache';

const APOLLO_CONCURRENCY = 3;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
const DRY_RUN = process.env.DRY_RUN === '1';

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  console.log('[Backfill] Missing-email backfill');
  if (DRY_RUN) console.log('[Backfill] DRY_RUN=1 — no Apollo calls, no DB writes');
  if (LIMIT) console.log(`[Backfill] LIMIT=${LIMIT}`);

  const people = await prisma.person.findMany({
    where: {
      email: null,
      firstName: { not: null },
      lastName: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      company: true,
      linkedinUrl: true,
    },
    take: LIMIT,
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[Backfill] Found ${people.length} people with missing email (firstName+lastName present)\n`);

  if (people.length === 0) {
    console.log('[Backfill] Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    people.slice(0, 10).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.fullName} @ ${p.company}`);
    });
    if (people.length > 10) console.log(`  ... and ${people.length - 10} more`);
    await prisma.$disconnect();
    return;
  }

  let found = 0;
  let stillMissing = 0;
  let processed = 0;

  await processWithConcurrency(people, APOLLO_CONCURRENCY, async (person) => {
    const emailResult = await getOrFindEmail({
      fullName: person.fullName,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      linkedinUrl: person.linkedinUrl,
    });

    processed++;
    if (emailResult.email) {
      found++;
      console.log(`[Backfill] ${processed}/${people.length} ✅ ${person.fullName} @ ${person.company} → ${emailResult.email} (${emailResult.status})`);
    } else {
      stillMissing++;
      console.log(`[Backfill] ${processed}/${people.length} ⚠️ ${person.fullName} @ ${person.company} — no email from Apollo`);
    }

    return emailResult;
  });

  console.log(`\n[Backfill] Done. Emails found: ${found}, still missing: ${stillMissing}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[Backfill] Error:', err);
  process.exit(1);
});
