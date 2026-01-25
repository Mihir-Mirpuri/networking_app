import prisma from '@/lib/prisma';
import { findEmail, EmailResult, EducationInfo } from './enrichment';
import { EmailStatus } from '@prisma/client';

// Type matching Prisma EmailStatus enum
export type EmailStatusType = 'VERIFIED' | 'UNVERIFIED' | 'MISSING' | 'MANUAL';

export interface PersonEmailData {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  linkedinUrl?: string | null;
}

export interface CachedEmailResult extends EmailResult {
  fromCache: boolean;
  apolloCalled: boolean;
  existingPerson?: {
    id: string;
    email: string | null;
    emailStatus: string;
    emailConfidence: number | null;
  };
}

export type { EducationInfo };

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
  const { fullName, firstName, lastName, company, linkedinUrl } = personData;

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
        city: true,
        state: true,
        country: true,
        educationSchool: true,
        educationDegree: true,
        educationField: true,
        educationYear: true,
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

    // Build education info from cached data
    const education: EducationInfo | null = existingPerson.educationSchool ? {
      schoolName: existingPerson.educationSchool,
      degree: existingPerson.educationDegree,
      fieldOfStudy: existingPerson.educationField,
      graduationYear: existingPerson.educationYear,
    } : null;

    console.log(
      `[EmailCache] ✅ CACHE HIT for "${fullName}" at ${company} - Email: ${existingPerson.email} (${status}, confidence: ${existingPerson.emailConfidence || 0}) - NO Apollo call`
    );
    return {
      email: existingPerson.email,
      status,
      confidence: existingPerson.emailConfidence || 0,
      city: existingPerson.city,
      state: existingPerson.state,
      country: existingPerson.country,
      education,
      fromCache: true,
      apolloCalled: false,
      existingPerson: {
        id: existingPerson.id,
        email: existingPerson.email,
        emailStatus: existingPerson.emailStatus || 'MISSING',
        emailConfidence: existingPerson.emailConfidence,
      },
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
      city: null,
      state: null,
      country: null,
      education: null,
      fromCache: false,
      apolloCalled: false,
      existingPerson: existingPerson ? {
        id: existingPerson.id,
        email: existingPerson.email,
        emailStatus: existingPerson.emailStatus || 'MISSING',
        emailConfidence: existingPerson.emailConfidence,
      } : undefined,
    };
  }

  console.log(`[EmailCache] 📞 Calling Apollo API for "${fullName}" at ${company}...`);
  const emailResult = await findEmail({ firstName, lastName, company, linkedinUrl });

  // Step 5: Update Person if it already exists (email + location + education)
  // Note: If Person doesn't exist yet, saveSearchResult will create it with all data
  if (existingPerson) {
    const updateData: Record<string, unknown> = {
      emailLastUpdated: new Date(),
    };

    // Update email if found
    if (emailResult.email) {
      updateData.email = emailResult.email;
      updateData.emailStatus = emailResult.status as EmailStatus;
      updateData.emailConfidence = emailResult.confidence;
    }

    // Update location if found
    if (emailResult.city) updateData.city = emailResult.city;
    if (emailResult.state) updateData.state = emailResult.state;
    if (emailResult.country) updateData.country = emailResult.country;

    // Update education if found
    if (emailResult.education) {
      if (emailResult.education.schoolName) updateData.educationSchool = emailResult.education.schoolName;
      if (emailResult.education.degree) updateData.educationDegree = emailResult.education.degree;
      if (emailResult.education.fieldOfStudy) updateData.educationField = emailResult.education.fieldOfStudy;
      if (emailResult.education.graduationYear) updateData.educationYear = emailResult.education.graduationYear;
    }

    await prisma.person.update({
      where: { id: existingPerson.id },
      data: updateData,
    });

    console.log(
      `[EmailCache] 💾 Updated Person in cache for "${fullName}" at ${company} - Email: ${emailResult.email || 'none'} (${emailResult.status}, confidence: ${emailResult.confidence}), Location: ${emailResult.city || 'unknown'}, School: ${emailResult.education?.schoolName || 'unknown'}`
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
    existingPerson: existingPerson ? {
      id: existingPerson.id,
      email: existingPerson.email,
      emailStatus: existingPerson.emailStatus || 'MISSING',
      emailConfidence: existingPerson.emailConfidence,
    } : undefined,
  };
}
