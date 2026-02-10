import { PrismaAdapter } from '@auth/prisma-adapter';
import { NextAuthOptions } from 'next-auth';
import { Adapter } from 'next-auth/adapters';
import GoogleProvider from 'next-auth/providers/google';
import prisma from './prisma';
import { verifyCalendarAccessOnSignIn } from './services/calendar';
import { awardCredits } from './services/credits';
import { EMAIL_LIMITS } from './constants';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  debug: true,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
  },
  events: {
    async signIn({ user, isNewUser }) {
      if (!user.id) return;

      // Handle referral signup for new users
      if (isNewUser && user.email) {
        try {
          await handleReferralSignup(user.id, user.email);
        } catch (error) {
          console.error(`[Auth] Failed to process referral for user ${user.id}:`, error);
        }
      }

      // TEMPORARILY DISABLED: gmail.readonly scope removed for Google verification
      // startMailboxWatch call removed — watches expire naturally after 7 days

      // Verify and mark calendar access
      // This runs after OAuth so tokens should be available
      try {
        await verifyCalendarAccessOnSignIn(user.id);
        console.log(`[Auth] Calendar access verified for user ${user.id}`);
      } catch (error) {
        // Log but don't block sign-in if calendar verification fails
        console.error(`[Auth] Failed to verify calendar access for user ${user.id}:`, error);
      }
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  session: {
    strategy: 'database',
  },
};

/**
 * Handle referral signup - awards credits to referrer when invited user signs up
 */
async function handleReferralSignup(userId: string, userEmail: string): Promise<void> {
  // Find pending invitation for this email
  const invitation = await prisma.invitation.findFirst({
    where: {
      inviteeEmail: userEmail.toLowerCase(),
      status: 'PENDING',
    },
  });

  if (!invitation) {
    console.log(`[Auth] No pending invitation found for ${userEmail}`);
    return;
  }

  console.log(`[Auth] Processing referral signup: ${userEmail} was invited by user ${invitation.referrerId}`);

  // Update invitation status
  await prisma.invitation.update({
    where: { id: invitation.id },
    data: {
      status: 'SIGNED_UP',
      signedUpAt: new Date(),
      creditsAwarded: invitation.creditsAwarded + EMAIL_LIMITS.CREDITS_ON_INVITEE_SIGNUP,
    },
  });

  // Link the new user to their referrer
  await prisma.user.update({
    where: { id: userId },
    data: { referredById: invitation.referrerId },
  });

  // Award bonus credits to referrer for successful conversion
  const awarded = await awardCredits(invitation.referrerId, EMAIL_LIMITS.CREDITS_ON_INVITEE_SIGNUP);
  console.log(`[Auth] Awarded ${awarded} credits to referrer ${invitation.referrerId} for referral signup`);
}
