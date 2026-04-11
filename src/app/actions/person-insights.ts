'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrExtractInsights } from '@/lib/services/person-insights';
import prisma from '@/lib/prisma';
import { scrapeLinkedInProfiles } from '@/lib/services/linkedin-scraper';
import { upgradeToFullProfile } from '@/lib/db/person-service';

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
    console.error('[PersonInsights] Action error:', error);
    return {
      success: false,
      insights: [],
      fromCache: false,
      error: error instanceof Error ? error.message : 'Failed to load insights',
    };
  }
}

// ─── Full Scrape + Insights (Phase 3 Step 2) ────────────────────────────────

export interface FullScrapeAndInsightsResult {
  success: boolean;
  scrapeCompleted: boolean;
  insights: PersonInsightResponse[];
  fromCache: boolean;
  error?: string;
}

export async function fullScrapeAndInsightsAction(
  personId: string
): Promise<FullScrapeAndInsightsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, scrapeCompleted: false, insights: [], fromCache: false, error: 'Not authenticated' };
  }

  let scrapeCompleted = false;

  try {
    // 1. Fetch person to check scrapeDepth
    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: { id: true, scrapeDepth: true, linkedinUrl: true, fullName: true },
    });

    if (!person) {
      return { success: false, scrapeCompleted: false, insights: [], fromCache: false, error: 'Person not found' };
    }

    // 2. If short profile with a LinkedIn URL, do full Apify scrape
    if (person.scrapeDepth === 'short' && person.linkedinUrl) {
      try {
        // Double-check guard: re-fetch scrapeDepth to prevent concurrent duplicate scrapes
        const recheck = await prisma.person.findUnique({
          where: { id: personId },
          select: { scrapeDepth: true },
        });

        if (recheck?.scrapeDepth === 'short') {
          console.log(`[FullScrape] Scraping "${person.fullName}" (${person.linkedinUrl})`);
          const scraped = await scrapeLinkedInProfiles([person.linkedinUrl]);

          if (scraped.length > 0 && scraped[0]) {
            await upgradeToFullProfile(personId, scraped[0]);
            scrapeCompleted = true;
            console.log(`[FullScrape] Upgraded "${person.fullName}" to full profile`);

            // Delete existing insights so they get re-extracted with full data
            await prisma.personInsight.deleteMany({ where: { personId } });
          } else {
            console.warn(`[FullScrape] Scrape returned empty for "${person.fullName}"`);
          }
        } else {
          console.log(`[FullScrape] "${person.fullName}" already upgraded by concurrent request — skipping scrape`);
        }
      } catch (scrapeErr) {
        console.error(`[FullScrape] Scrape failed for "${person.fullName}":`, scrapeErr);
        // Continue to insights with whatever data exists
      }
    }

    // 3. Extract or return cached insights (now with full data if scrape succeeded)
    const result = await getOrExtractInsights(personId, session.user.id);
    return {
      success: true,
      scrapeCompleted,
      insights: result.insights,
      fromCache: result.fromCache,
    };
  } catch (error) {
    console.error('[FullScrape] Error:', error);
    return {
      success: false,
      scrapeCompleted,
      insights: [],
      fromCache: false,
      error: error instanceof Error ? error.message : 'Failed to load insights',
    };
  }
}
