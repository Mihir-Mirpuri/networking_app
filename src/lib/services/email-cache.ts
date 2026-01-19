import prisma from '@/lib/prisma';
import { findEmail, EmailResult } from './enrichment';
import { EmailStatus } from '@prisma/client';

// Type matching Prisma EmailStatus enum
export type EmailStatusType = 'VERIFIED' | 'UNVERIFIED' | 'MISSING' | 'MANUAL';

export interface PersonEmailData {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
}

export interface CachedEmailResult extends EmailResult {
  fromCache: boolean;
  apolloCalled: boolean;
}

/**
 * Smart email lookup with caching and company change detection
 * 
 * Priority:
 * 1. Check Person table for current company (shared cache)
 * 2. If email exists (VERIFIED or UNVERIFIED), use cache (NO APOLLO CALL)
 * 3. If company changed, call Apollo for new company
 * 4. If no Person exists, call Apollo
 * 5. Store result in Person table for future users
 */
export async function getOrFindEmail(
  personData: PersonEmailData
): Promise<CachedEmailResult> {
  const { fullName, firstName, lastName, company } = personData;

  // Step 1: Check if Person exists for THIS company
  let existingPerson;
  try {
    existingPerson = await prisma.person.findUnique({
      where: {
        fullName_company: {
          fullName,
          company,
        },
      },
      select: {
        id: true,
        email: true,
        emailStatus: true,
        emailConfidence: true,
        emailLastUpdated: true,
      },
    });
  } catch (error: any) {
    // If columns don't exist, this will fail - guide user to run migration
    if (error?.message?.includes('column') || error?.code === 'P2021') {
      console.error(
        `[EmailCache] ❌ ERROR: Person table is missing email columns. Please run the migration:\n` +
        `  1. Run: npm run db:push\n` +
        `  2. OR run the SQL in: migrations/add_person_email_fields.sql`
      );
      throw new Error(
        'Database migration required: Person table is missing email columns. Run `npm run db:push` or the migration SQL script.'
      );
    }
    throw error;
  }

  // Step 2: If exists AND has email (VERIFIED or UNVERIFIED) → Use cache (NO APOLLO CALL)
  if (
    existingPerson?.email &&
    (existingPerson.emailStatus === 'VERIFIED' || existingPerson.emailStatus === 'UNVERIFIED')
  ) {
    const status = existingPerson.emailStatus === 'VERIFIED' ? 'VERIFIED' : 
                   existingPerson.emailStatus === 'UNVERIFIED' ? 'UNVERIFIED' : 'MISSING';
    console.log(
      `[EmailCache] ✅ CACHE HIT for "${fullName}" at ${company} - Email: ${existingPerson.email} (${status}, confidence: ${existingPerson.emailConfidence || 0}) - NO Apollo call`
    );
    return {
      email: existingPerson.email,
      status,
      confidence: existingPerson.emailConfidence || 0,
      fromCache: true,
      apolloCalled: false,
    };
  }

  // Step 3: If Person exists but no email or MISSING → Check if company changed
  if (existingPerson) {
    // Check if same person exists at different company
    const differentCompanyPerson = await prisma.person.findFirst({
      where: {
        fullName,
        company: { not: company },
      },
      select: {
        company: true,
        email: true,
        emailStatus: true,
      },
    });

    if (differentCompanyPerson) {
      console.log(
        `[EmailCache] 🔄 CACHE MISS - Company change detected for "${fullName}": ${differentCompanyPerson.company} → ${company}. Calling Apollo API for new company email.`
      );
    } else {
      console.log(
        `[EmailCache] ❌ CACHE MISS - Person "${fullName}" exists at ${company} but has no email or MISSING status. Calling Apollo API.`
      );
    }
  } else {
    // Person doesn't exist at all
    console.log(`[EmailCache] ❌ CACHE MISS - New person "${fullName}" at ${company}. Calling Apollo API.`);
  }

  // Step 4: Call Apollo API
  if (!firstName || !lastName) {
    return {
      email: null,
      status: 'MISSING',
      confidence: 0,
      fromCache: false,
      apolloCalled: false,
    };
  }

  console.log(`[EmailCache] 📞 Calling Apollo API for "${fullName}" at ${company}...`);
  const emailResult = await findEmail(firstName, lastName, company);

  // Step 5: Update Person email if it already exists
  // Note: If Person doesn't exist yet, saveSearchResult will create it with email
  if (existingPerson && emailResult.email) {
    await prisma.person.update({
      where: { id: existingPerson.id },
      data: {
        email: emailResult.email,
        emailStatus: emailResult.status as EmailStatus,
        emailConfidence: emailResult.confidence,
        emailLastUpdated: new Date(),
      },
    });
    console.log(
      `[EmailCache] 💾 Updated Person email in cache for "${fullName}" at ${company} - Email: ${emailResult.email} (${emailResult.status}, confidence: ${emailResult.confidence})`
    );
  } else if (emailResult.email) {
    console.log(
      `[EmailCache] 📝 Apollo result for "${fullName}" at ${company} - Email: ${emailResult.email} (${emailResult.status}, confidence: ${emailResult.confidence}) - Will be saved by saveSearchResult`
    );
  } else {
    console.log(
      `[EmailCache] ⚠️  Apollo returned no email for "${fullName}" at ${company}`
    );
  }

  return {
    ...emailResult,
    fromCache: false,
    apolloCalled: true,
  };
}
