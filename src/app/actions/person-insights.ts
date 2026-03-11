'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrExtractInsights } from '@/lib/services/person-insights';

export interface PersonInsightResponse {
  id: string;
  label: string;
  detail: string;
  type: string;
  source: string;
  confidence: string;
  sourceUrl?: string;
}

export interface GetPersonInsightsResult {
  success: boolean;
  insights: PersonInsightResponse[];
  fromCache: boolean;
  error?: string;
}

export async function getPersonInsightsAction(
  personId: string
): Promise<GetPersonInsightsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, insights: [], fromCache: false, error: 'Not authenticated' };
  }

  try {
    const result = await getOrExtractInsights(personId, session.user.id);
    return {
      success: true,
      insights: result.insights,
      fromCache: result.fromCache,
    };
  } catch (error) {
    console.error('[person-insights] Error:', error);
    return {
      success: false,
      insights: [],
      fromCache: false,
      error: error instanceof Error ? error.message : 'Failed to load insights',
    };
  }
}
