import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * Admin endpoint to view Apollo API usage statistics
 * GET - Returns usage stats for today, this week, this month, and all-time
 */

interface UsageStats {
  apolloCallsMade: number;
  apolloCacheHits: number;
  cseCallsMade: number;
  searchCount: number;
  cacheHitRate: string;
}

interface SearchRecord {
  id: string;
  company: string | null;
  university: string | null;
  apolloCallsMade: number;
  apolloCacheHits: number;
  cseCallsMade: number;
  completedAt: Date | null;
  createdAt: Date;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const now = new Date();

    // Calculate date boundaries
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Fetch all completed searches with stats
    const searches = await prisma.search.findMany({
      where: {
        completedAt: { not: null },
      },
      select: {
        id: true,
        company: true,
        university: true,
        apolloCallsMade: true,
        apolloCacheHits: true,
        cseCallsMade: true,
        completedAt: true,
        createdAt: true,
      },
      orderBy: { completedAt: 'desc' },
    });

    // Calculate stats for different time periods
    const calculateStats = (filteredSearches: SearchRecord[]): UsageStats => {
      const totals = filteredSearches.reduce(
        (acc, s) => ({
          apolloCallsMade: acc.apolloCallsMade + s.apolloCallsMade,
          apolloCacheHits: acc.apolloCacheHits + s.apolloCacheHits,
          cseCallsMade: acc.cseCallsMade + s.cseCallsMade,
        }),
        { apolloCallsMade: 0, apolloCacheHits: 0, cseCallsMade: 0 }
      );

      const totalLookups = totals.apolloCallsMade + totals.apolloCacheHits;
      const cacheHitRate = totalLookups > 0
        ? ((totals.apolloCacheHits / totalLookups) * 100).toFixed(1) + '%'
        : 'N/A';

      return {
        ...totals,
        searchCount: filteredSearches.length,
        cacheHitRate,
      };
    };

    const todaySearches = searches.filter(s => s.completedAt && s.completedAt >= startOfToday);
    const weekSearches = searches.filter(s => s.completedAt && s.completedAt >= startOfWeek);
    const monthSearches = searches.filter(s => s.completedAt && s.completedAt >= startOfMonth);

    // Get recent searches for detail view
    const recentSearches = searches.slice(0, 20).map(s => ({
      id: s.id,
      company: s.company,
      university: s.university,
      apolloCallsMade: s.apolloCallsMade,
      apolloCacheHits: s.apolloCacheHits,
      cseCallsMade: s.cseCallsMade,
      completedAt: s.completedAt?.toISOString(),
    }));

    // Get total Person count (for context)
    const totalPersons = await prisma.person.count();
    const personsWithEmail = await prisma.person.count({
      where: { email: { not: null } },
    });

    return NextResponse.json({
      status: 'ok',
      generatedAt: now.toISOString(),
      usage: {
        today: calculateStats(todaySearches),
        thisWeek: calculateStats(weekSearches),
        thisMonth: calculateStats(monthSearches),
        allTime: calculateStats(searches),
      },
      recentSearches,
      database: {
        totalPersons,
        personsWithEmail,
        emailCoverage: totalPersons > 0
          ? ((personsWithEmail / totalPersons) * 100).toFixed(1) + '%'
          : 'N/A',
      },
    });
  } catch (error) {
    console.error('[Admin Usage] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
