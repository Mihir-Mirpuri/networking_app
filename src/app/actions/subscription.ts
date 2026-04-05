'use server';

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStripe } from '@/lib/stripe';
import prisma from '@/lib/prisma';
import { SUBSCRIPTION_PRICING } from '@/lib/constants';

/**
 * Create a checkout session for monthly subscription ($20/month)
 */
export async function createCheckoutSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true, email: true },
  });

  const stripe = getStripe();

  // Create or retrieve Stripe customer
  let customerId = user?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user?.email ?? undefined,
      metadata: { userId: session.user.id },
    });
    customerId = customer.id;

    await prisma.user.update({
      where: { id: session.user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: process.env.PRICE_ID!, quantity: 1 }],
    mode: 'subscription',
    payment_method_types: ['card'],
    success_url: `${process.env.NEXTAUTH_URL}/?subscription=success`,
    cancel_url: `${process.env.NEXTAUTH_URL}/`,
    allow_promotion_codes: true,
  });

  redirect(checkoutSession.url!);
}

/**
 * Create a checkout session for upfront payment ($10/month for 4-12 months)
 */
export async function createUpfrontCheckoutSession(months: number) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Validate months
  if (months < SUBSCRIPTION_PRICING.MIN_UPFRONT_MONTHS || months > SUBSCRIPTION_PRICING.MAX_UPFRONT_MONTHS) {
    throw new Error(`Months must be between ${SUBSCRIPTION_PRICING.MIN_UPFRONT_MONTHS} and ${SUBSCRIPTION_PRICING.MAX_UPFRONT_MONTHS}`);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true, email: true },
  });

  const stripe = getStripe();

  // Create or retrieve Stripe customer
  let customerId = user?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user?.email ?? undefined,
      metadata: { userId: session.user.id },
    });
    customerId = customer.id;

    await prisma.user.update({
      where: { id: session.user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  // Calculate total price in cents
  const totalPriceCents = months * SUBSCRIPTION_PRICING.UPFRONT_PRICE_PER_MONTH * 100;

  // Create checkout session with dynamic price
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Pro Plan - ${months} Month Access`,
            description: `Unlimited access for ${months} months at $${SUBSCRIPTION_PRICING.UPFRONT_PRICE_PER_MONTH}/month`,
          },
          unit_amount: totalPriceCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment', // One-time payment
    payment_method_types: ['card'],
    success_url: `${process.env.NEXTAUTH_URL}/?subscription=success`,
    cancel_url: `${process.env.NEXTAUTH_URL}/`,
    allow_promotion_codes: true,
    metadata: {
      type: 'upfront',
      months: months.toString(),
      userId: session.user.id,
    },
  });

  redirect(checkoutSession.url!);
}

export async function createCustomerPortalSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true },
  });

  if (!user?.stripeCustomerId) {
    throw new Error('No subscription found');
  }

  const stripe = getStripe();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${process.env.NEXTAUTH_URL}/`,
  });

  redirect(portalSession.url);
}

export async function getSubscriptionStatus() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { isSubscribed: false };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      subscriptionStatus: true,
      stripeCurrentPeriodEnd: true,
      accessExpiresAt: true,
    },
  });

  const now = new Date();

  // Check recurring subscription
  const hasRecurring = user?.subscriptionStatus === 'active' &&
    user?.stripeCurrentPeriodEnd &&
    user.stripeCurrentPeriodEnd > now;

  // Check one-time upfront payment
  const hasUpfront = user?.accessExpiresAt && user.accessExpiresAt > now;

  const isSubscribed = hasRecurring || hasUpfront;

  return {
    isSubscribed,
    subscriptionStatus: user?.subscriptionStatus,
    currentPeriodEnd: user?.stripeCurrentPeriodEnd,
    accessExpiresAt: user?.accessExpiresAt,
    subscriptionType: hasRecurring ? 'recurring' : hasUpfront ? 'upfront' : null,
  };
}
