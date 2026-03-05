import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import prisma from '@/lib/prisma';
import { ReferralLinkType } from '@prisma/client';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const links = await prisma.referralLink.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, name: true, email: true } },
      signups: {
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          subscriptionStatus: true,
        },
      },
    },
  });

  const data = links.map((link) => ({
    id: link.id,
    code: link.code,
    type: link.type,
    label: link.label,
    isActive: link.isActive,
    ambassador: link.user,
    clickCount: link.clickCount,
    signupCount: link.signupCount,
    paidCount: link.paidCount,
    clickToSignupRate: link.clickCount > 0 ? link.signupCount / link.clickCount : 0,
    signupToPaidRate: link.signupCount > 0 ? link.paidCount / link.signupCount : 0,
    createdAt: link.createdAt,
    signups: link.signups.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      signedUpAt: u.createdAt,
      isPaying: u.subscriptionStatus === 'active',
    })),
  }));

  const totals = {
    totalClicks: links.reduce((s, l) => s + l.clickCount, 0),
    totalSignups: links.reduce((s, l) => s + l.signupCount, 0),
    totalPaid: links.reduce((s, l) => s + l.paidCount, 0),
    byType: {
      AMBASSADOR: {
        clicks: links.filter((l) => l.type === 'AMBASSADOR').reduce((s, l) => s + l.clickCount, 0),
        signups: links.filter((l) => l.type === 'AMBASSADOR').reduce((s, l) => s + l.signupCount, 0),
        paid: links.filter((l) => l.type === 'AMBASSADOR').reduce((s, l) => s + l.paidCount, 0),
      },
      QR_CODE: {
        clicks: links.filter((l) => l.type === 'QR_CODE').reduce((s, l) => s + l.clickCount, 0),
        signups: links.filter((l) => l.type === 'QR_CODE').reduce((s, l) => s + l.signupCount, 0),
        paid: links.filter((l) => l.type === 'QR_CODE').reduce((s, l) => s + l.paidCount, 0),
      },
    },
  };

  return NextResponse.json({ links: data, totals });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { code, type, label, userId } = await req.json();

  if (!code || !type || !label) {
    return NextResponse.json({ error: 'Missing required fields: code, type, label' }, { status: 400 });
  }

  if (!['AMBASSADOR', 'QR_CODE'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const existing = await prisma.referralLink.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ error: 'Code already exists' }, { status: 409 });
  }

  if (type === 'AMBASSADOR' && userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
  }

  const link = await prisma.referralLink.create({
    data: {
      code,
      type: type as ReferralLinkType,
      label,
      userId: type === 'AMBASSADOR' ? userId || null : null,
    },
  });

  return NextResponse.json({ link }, { status: 201 });
}
