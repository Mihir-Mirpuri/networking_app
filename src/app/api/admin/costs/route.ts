import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

function serializeBigInt(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(serializeBigInt);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serializeBigInt(v)])
    );
  }
  return value;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 30);

  const startDate = searchParams.get('startDate')
    ? new Date(searchParams.get('startDate')!)
    : defaultStart;
  const endDate = searchParams.get('endDate')
    ? new Date(searchParams.get('endDate')!)
    : now;

  // Clamp endDate to end of day
  endDate.setHours(23, 59, 59, 999);

  const serviceFilter = searchParams.get('service');
  const userIdFilter = searchParams.get('userId');

  // Build optional filter fragments
  const serviceClause = serviceFilter
    ? Prisma.sql` AND "service" = ${serviceFilter}`
    : Prisma.empty;
  const userClause = userIdFilter
    ? Prisma.sql` AND "userId" = ${userIdFilter}`
    : Prisma.empty;
  const serviceClauseL = serviceFilter
    ? Prisma.sql` AND l."service" = ${serviceFilter}`
    : Prisma.empty;
  const userClauseL = userIdFilter
    ? Prisma.sql` AND l."userId" = ${userIdFilter}`
    : Prisma.empty;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  // Summary: today
  const todayRows = await prisma.$queryRaw<{ totalCost: number; callCount: bigint }[]>`
    SELECT
      COALESCE(SUM("costUsd"), 0) AS "totalCost",
      COUNT(*) AS "callCount"
    FROM "ApiCostLog"
    WHERE "createdAt" >= ${todayStart}${serviceClause}${userClause}
  `;

  // Summary: week
  const weekRows = await prisma.$queryRaw<{ totalCost: number; callCount: bigint }[]>`
    SELECT
      COALESCE(SUM("costUsd"), 0) AS "totalCost",
      COUNT(*) AS "callCount"
    FROM "ApiCostLog"
    WHERE "createdAt" >= ${weekStart}${serviceClause}${userClause}
  `;

  // Summary: filtered range
  const filteredRows = await prisma.$queryRaw<{ totalCost: number; callCount: bigint }[]>`
    SELECT
      COALESCE(SUM("costUsd"), 0) AS "totalCost",
      COUNT(*) AS "callCount"
    FROM "ApiCostLog"
    WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}${serviceClause}${userClause}
  `;

  // By service
  const byService = await prisma.$queryRaw<
    { service: string; totalCost: number; callCount: bigint }[]
  >`
    SELECT
      service,
      COALESCE(SUM("costUsd"), 0) AS "totalCost",
      COUNT(*) AS "callCount"
    FROM "ApiCostLog"
    WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}${serviceClause}${userClause}
    GROUP BY service
    ORDER BY "totalCost" DESC
  `;

  // By action
  const byAction = await prisma.$queryRaw<
    { action: string; totalCost: number; callCount: bigint; avgCost: number }[]
  >`
    SELECT
      action,
      COALESCE(SUM("costUsd"), 0) AS "totalCost",
      COUNT(*) AS "callCount",
      COALESCE(AVG("costUsd"), 0) AS "avgCost"
    FROM "ApiCostLog"
    WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}${serviceClause}${userClause}
    GROUP BY action
    ORDER BY "totalCost" DESC
  `;

  // By user (top 20)
  const byUser = await prisma.$queryRaw<
    {
      userId: string | null;
      userName: string | null;
      userEmail: string | null;
      totalCost: number;
      callCount: bigint;
    }[]
  >`
    SELECT
      l."userId",
      u.name AS "userName",
      u.email AS "userEmail",
      COALESCE(SUM(l."costUsd"), 0) AS "totalCost",
      COUNT(*) AS "callCount"
    FROM "ApiCostLog" l
    LEFT JOIN "User" u ON u.id = l."userId"
    WHERE l."createdAt" >= ${startDate} AND l."createdAt" <= ${endDate}${serviceClauseL}${userClauseL}
    GROUP BY l."userId", u.name, u.email
    ORDER BY "totalCost" DESC
    LIMIT 20
  `;

  // Daily spend by service (for stacked bar chart)
  const dailySpend = await prisma.$queryRaw<
    { date: Date; service: string; totalCost: number; callCount: bigint }[]
  >`
    SELECT
      DATE("createdAt") AS date,
      service,
      COALESCE(SUM("costUsd"), 0) AS "totalCost",
      COUNT(*) AS "callCount"
    FROM "ApiCostLog"
    WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}${serviceClause}${userClause}
    GROUP BY DATE("createdAt"), service
    ORDER BY date ASC, service ASC
  `;

  const result = {
    summary: {
      today: {
        totalCost: Number(todayRows[0]?.totalCost ?? 0),
        callCount: Number(todayRows[0]?.callCount ?? 0),
      },
      week: {
        totalCost: Number(weekRows[0]?.totalCost ?? 0),
        callCount: Number(weekRows[0]?.callCount ?? 0),
      },
      filtered: {
        totalCost: Number(filteredRows[0]?.totalCost ?? 0),
        callCount: Number(filteredRows[0]?.callCount ?? 0),
      },
    },
    byService: (byService as unknown[]).map((r) => serializeBigInt(r)),
    byAction: (byAction as unknown[]).map((r) => serializeBigInt(r)),
    byUser: (byUser as unknown[]).map((r) => serializeBigInt(r)),
    dailySpend: (dailySpend as unknown[]).map((r) => {
      const row = serializeBigInt(r) as Record<string, unknown>;
      return {
        ...row,
        date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date),
      };
    }),
    dateRange: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
  };

  return NextResponse.json(result);
}
