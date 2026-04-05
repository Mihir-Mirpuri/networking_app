import prisma from '@/lib/prisma';
import { EMAIL_LIMITS } from '@/lib/constants';

export interface CreditStatus {
  canSend: boolean;
  dailyUsed: number;
  dailyLimit: number;
  bonusCredits: number;
  totalRemaining: number;
  isSubscribed: boolean;
}

/**
 * Check if user has an active subscription
 */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionStatus: true, stripeCurrentPeriodEnd: true },
  });

  if (!user) return false;

  const isActive = user.subscriptionStatus === 'active';
  const notExpired = user.stripeCurrentPeriodEnd
    ? user.stripeCurrentPeriodEnd > new Date()
    : false;

  return isActive && notExpired;
}

/**
 * Check if user can send an email and get full credit status.
 * Free users get a hard lifetime limit of 3 sends total.
 * Subscribers get unlimited.
 */
export async function checkEmailCredits(userId: string): Promise<CreditStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totalSendCount: true,
      subscriptionStatus: true,
      stripeCurrentPeriodEnd: true,
    },
  });

  // Check if user has active subscription
  const isSubscribed =
    user?.subscriptionStatus === 'active' &&
    user?.stripeCurrentPeriodEnd &&
    user.stripeCurrentPeriodEnd > new Date();

  // Subscribers get unlimited emails
  if (isSubscribed) {
    return {
      canSend: true,
      dailyUsed: 0,
      dailyLimit: -1,
      bonusCredits: 0,
      totalRemaining: -1,
      isSubscribed: true,
    };
  }

  const totalSent = user?.totalSendCount || 0;
  const totalRemaining = Math.max(0, EMAIL_LIMITS.FREE_LIFETIME_LIMIT - totalSent);

  return {
    canSend: totalRemaining > 0,
    dailyUsed: totalSent,
    dailyLimit: EMAIL_LIMITS.FREE_LIFETIME_LIMIT,
    bonusCredits: 0,
    totalRemaining,
    isSubscribed: false,
  };
}

/**
 * Consume one email send — increments totalSendCount
 */
export async function consumeEmailCredit(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      totalSendCount: { increment: 1 },
      lastSendDate: new Date(),
    },
  });
}

/**
 * Award credits to a user (with cap at MAX_CREDITS)
 * Returns the actual amount awarded (may be less if capped)
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
