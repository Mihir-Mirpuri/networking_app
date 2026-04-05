import prisma from '@/lib/prisma';
import { EMAIL_LIMITS } from '@/lib/constants';

export interface CreditStatus {
  canSend: boolean;
  totalSent: number;
  lifetimeLimit: number;
  totalRemaining: number;
  isSubscribed: boolean;
  isBlocked: boolean; // true if user has hit lifetime limit and is not subscribed
}

/**
 * Check if user has an active subscription (either recurring or one-time upfront)
 */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionStatus: true,
      stripeCurrentPeriodEnd: true,
      accessExpiresAt: true,
    },
  });

  if (!user) return false;

  const now = new Date();

  // Check recurring subscription
  const hasRecurring = user.subscriptionStatus === 'active' &&
    user.stripeCurrentPeriodEnd &&
    user.stripeCurrentPeriodEnd > now;

  // Check one-time upfront payment
  const hasUpfront = !!(user.accessExpiresAt && user.accessExpiresAt > now);

  return hasRecurring || hasUpfront;
}

/**
 * Check if user is blocked from using the app (hit free limit and no subscription)
 */
export async function isUserBlocked(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totalEmailsSent: true,
      subscriptionStatus: true,
      stripeCurrentPeriodEnd: true,
      accessExpiresAt: true,
    },
  });

  if (!user) return true; // User not found = blocked

  const now = new Date();

  // Check if subscribed
  const hasRecurring = user.subscriptionStatus === 'active' &&
    user.stripeCurrentPeriodEnd &&
    user.stripeCurrentPeriodEnd > now;
  const hasUpfront = user.accessExpiresAt && user.accessExpiresAt > now;

  if (hasRecurring || hasUpfront) return false; // Subscribed = not blocked

  // Not subscribed - check if they've hit the lifetime limit
  return user.totalEmailsSent >= EMAIL_LIMITS.FREE_LIFETIME_LIMIT;
}

/**
 * Check if user can send an email and get full credit status
 */
export async function checkEmailCredits(userId: string): Promise<CreditStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totalEmailsSent: true,
      subscriptionStatus: true,
      stripeCurrentPeriodEnd: true,
      accessExpiresAt: true,
    },
  });

  const now = new Date();

  // Check if user has active subscription (recurring or one-time)
  const hasRecurring = user?.subscriptionStatus === 'active' &&
    user?.stripeCurrentPeriodEnd &&
    user.stripeCurrentPeriodEnd > now;
  const hasUpfront = user?.accessExpiresAt && user.accessExpiresAt > now;
  const isSubscribed = hasRecurring || hasUpfront;

  // Subscribers get unlimited emails
  if (isSubscribed) {
    return {
      canSend: true,
      totalSent: user?.totalEmailsSent || 0,
      lifetimeLimit: -1, // -1 indicates unlimited
      totalRemaining: -1, // -1 indicates unlimited
      isSubscribed: true,
      isBlocked: false,
    };
  }

  // Free user - check lifetime limit
  const totalSent = user?.totalEmailsSent || 0;
  const lifetimeLimit = EMAIL_LIMITS.FREE_LIFETIME_LIMIT;
  const totalRemaining = Math.max(0, lifetimeLimit - totalSent);
  const isBlocked = totalSent >= lifetimeLimit;

  return {
    canSend: totalRemaining > 0,
    totalSent,
    lifetimeLimit,
    totalRemaining,
    isSubscribed: false,
    isBlocked,
  };
}

/**
 * Consume one email send (increment totalEmailsSent)
 */
export async function consumeEmailCredit(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      totalEmailsSent: { increment: 1 },
      // Also update legacy fields for backwards compatibility
      dailySendCount: { increment: 1 },
      lastSendDate: new Date(),
    },
  });
}

/**
 * Award credits to a user (with cap at MAX_CREDITS)
 * Returns the actual amount awarded (may be less if capped)
 * Note: This is legacy functionality for referral credits
 */
export async function awardCredits(userId: string, amount: number): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailCredits: true },
  });

  const currentCredits = user?.emailCredits || 0;
  const newCredits = Math.min(
    currentCredits + amount,
    EMAIL_LIMITS.MAX_CREDITS
  );
  const actualAwarded = newCredits - currentCredits;

  if (actualAwarded > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { emailCredits: newCredits },
    });
  }

  return actualAwarded;
}

/**
 * Generate a unique referral code for a user
 * Returns existing code if user already has one
 */
export async function generateReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });

  // Return existing code if already generated
  if (user?.referralCode) {
    return user.referralCode;
  }

  // Generate unique code: 8 character alphanumeric
  // Excluding confusing characters (0, O, I, l, 1)
  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  let code = generateCode();
  let attempts = 0;

  // Ensure uniqueness (retry up to 10 times)
  while (attempts < 10) {
    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
    });
    if (!existing) break;
    code = generateCode();
    attempts++;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { referralCode: code },
  });

  return code;
}
