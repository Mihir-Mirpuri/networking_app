import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import prisma from '@/lib/prisma';
import Stripe from 'stripe';

// Helper to extract current_period_end from subscription
// In Stripe v20+, this is on items, but the API still returns it on the subscription object
function getSubscriptionPeriodEnd(subscription: Stripe.Subscription): Date {
  // Try to get from first item's current_period_end
  const item = subscription.items?.data?.[0];
  if (item?.current_period_end) {
    return new Date(item.current_period_end * 1000);
  }
  // Fallback: the API response still includes this at subscription level
  const periodEnd = (subscription as unknown as Record<string, number>).current_period_end;
  if (periodEnd) {
    return new Date(periodEnd * 1000);
  }
  // Final fallback: use current time + 30 days
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    console.error('Missing stripe-signature header');
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;

  const stripe = getStripe();

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Webhook signature verification failed:', errorMessage);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.mode === 'subscription' && session.subscription) {
          const subscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id;

          const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['items.data'],
          }) as Stripe.Subscription;

          await prisma.user.update({
            where: { stripeCustomerId: session.customer as string },
            data: {
              stripeSubscriptionId: subscription.id,
              stripeCurrentPeriodEnd: getSubscriptionPeriodEnd(subscription),
              subscriptionStatus: subscription.status,
            },
          });

          console.log(`Subscription activated for customer: ${session.customer}`);
        }
        break;
      }

      case 'invoice.payment_succeeded':
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as unknown as Record<string, string>).subscription;
        const customerId = typeof invoice.customer === 'string'
          ? invoice.customer
          : (invoice.customer as unknown as Record<string, string>)?.id;

        if (subscriptionId && customerId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['items.data'],
          }) as Stripe.Subscription;

          // Update user subscription status
          await prisma.user.update({
            where: { stripeCustomerId: customerId },
            data: {
              stripeSubscriptionId: subscription.id,
              stripeCurrentPeriodEnd: getSubscriptionPeriodEnd(subscription),
              subscriptionStatus: subscription.status,
            },
          });

          console.log(`Invoice paid for customer: ${customerId}, subscription: ${subscription.id}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;

        await prisma.user.update({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            subscriptionStatus: subscription.status,
            stripeCurrentPeriodEnd: getSubscriptionPeriodEnd(subscription),
          },
        });

        console.log(`Subscription updated: ${subscription.id}, status: ${subscription.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        await prisma.user.update({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            subscriptionStatus: 'canceled',
            stripeCurrentPeriodEnd: getSubscriptionPeriodEnd(subscription),
          },
        });

        console.log(`Subscription canceled: ${subscription.id}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}
