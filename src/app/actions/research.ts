'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { researchCompany, inferDepartment, TalkingPoint, CompanyResearchResult } from '@/lib/services/company-research';

const CACHE_TTL_DAYS = 7;

export interface ResearchCompanyInput {
  company: string;
  role?: string;
  personName?: string;
}

export type ResearchCompanyActionResult =
  | { success: true; research: CompanyResearchResult }
  | { success: false; error: string };

export async function researchCompanyAction(
  input: ResearchCompanyInput,
): Promise<ResearchCompanyActionResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    if (!input.company?.trim()) {
      return { success: false, error: 'Company is required' };
    }

    const normalizedCompany = input.company.trim().toLowerCase();
    const department = input.role ? inferDepartment(input.role) : '';

    // Check cache
    const cached = await prisma.companyResearch.findUnique({
      where: {
        company_role: {
          company: normalizedCompany,
          role: department,
        },
      },
    });

    if (cached) {
      const ageMs = Date.now() - cached.createdAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < CACHE_TTL_DAYS) {
        return {
          success: true,
          research: {
            company: input.company,
            talkingPoints: cached.talkingPoints as unknown as TalkingPoint[],
            fromCache: true,
          },
        };
      }
    }

    // Cache miss or stale — do fresh research
    const result = await researchCompany(
      input.company,
      input.role || undefined,
      input.personName || undefined,
    );

    // Upsert cache
    await prisma.companyResearch.upsert({
      where: {
        company_role: {
          company: normalizedCompany,
          role: department,
        },
      },
      create: {
        company: normalizedCompany,
        role: department,
        talkingPoints: JSON.parse(JSON.stringify(result.talkingPoints)),
        rawResponse: result.rawResponse,
      },
      update: {
        talkingPoints: JSON.parse(JSON.stringify(result.talkingPoints)),
        rawResponse: result.rawResponse,
        updatedAt: new Date(),
      },
    });

    return {
      success: true,
      research: {
        company: input.company,
        talkingPoints: result.talkingPoints,
        fromCache: false,
      },
    };
  } catch (error) {
    console.error('[ResearchAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Research failed',
    };
  }
}
