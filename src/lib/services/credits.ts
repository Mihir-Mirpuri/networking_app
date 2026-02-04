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
 * Check if user can send an email and get full credit status
 */
export async function checkEmailCredits(userId: string): Promise<CreditStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      dailySendCount: true,
      lastSendDate: true,
      emailCredits: true,
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
      dailyUsed: user?.dailySendCount || 0,
      dailyLimit: -1, // -1 indicates unlimited
      bonusCredits: user?.emailCredits || 0,
      totalRemaining: -1, // -1 indicates unlimited
      isSubscribed: true,
    };
  }

  const today = new Date().toDateString();
  const lastSendDate = user?.lastSendDate?.toDateString();
  const isNewDay = lastSendDate !== today;

  const dailyUsed = isNewDay ? 0 : (user?.dailySendCount || 0);
  const dailyLimit = EMAIL_LIMITS.DEFAULT_DAILY_LIMIT;
  const bonusCredits = user?.emailCredits || 0;

  // Daily remaining + bonus credits
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
  const totalRemaining = dailyRemaining + bonusCredits;

  return {
    canSend: totalRemaining > 0,
    dailyUsed,
    dailyLimit,
    bonusCredits,
    totalRemaining,
    isSubscribed: false,
  };
}

/**
 * Consume one email send (use daily first, then bonus credits)
 */
export async function consumeEmailCredit(userId: string): Promise<void> {
  const today = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailySendCount: true, lastSendDate: true, emailCredits: true },
  });

  const isNewDay = user?.lastSendDate?.toDateString() !== today.toDateString();
  const dailyUsed = isNewDay ? 0 : (user?.dailySendCount || 0);
  const dailyRemaining = EMAIL_LIMITS.DEFAULT_DAILY_LIMIT - dailyUsed;

  if (dailyRemaining > 0) {
    // Consume from daily limit
    await prisma.user.update({
      where: { id: userId },
      data: {
        dailySendCount: isNewDay ? 1 : dailyUsed + 1,
        lastSendDate: today,
      },
    });
  } else if ((user?.emailCredits || 0) > 0) {
    // Consume from bonus credits
    await prisma.user.update({
      where: { id: userId },
      data: {
        emailCredits: Math.max(0, (user?.emailCredits || 0) - 1),
        // Also update lastSendDate to track activity
        lastSendDate: today,
      },
    });
  }
  // If neither available, do nothing (caller should have checked canSend first)
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
