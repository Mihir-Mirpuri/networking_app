'use server';

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStripe } from '@/lib/stripe';
import prisma from '@/lib/prisma';

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
    },
  });

  const isSubscribed =
    user?.subscriptionStatus === 'active' &&
    user?.stripeCurrentPeriodEnd &&
    user.stripeCurrentPeriodEnd > new Date();

  return {
    isSubscribed,
    subscriptionStatus: user?.subscriptionStatus,
    currentPeriodEnd: user?.stripeCurrentPeriodEnd,
  };
}
