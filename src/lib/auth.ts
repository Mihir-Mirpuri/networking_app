import { PrismaAdapter } from '@auth/prisma-adapter';
import { NextAuthOptions } from 'next-auth';
import { Adapter } from 'next-auth/adapters';
import GoogleProvider from 'next-auth/providers/google';
import prisma from './prisma';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  debug: process.env.NODE_ENV === 'development',
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.send',
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

      // Onboarding flow is currently disabled — auto-complete on first sign-in
      // so users go straight to the app. Profile fields are collected lazily
      // at first-send time via ProfileCompletionModal.
      if (isNewUser) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { onboardingCompleted: true },
          });
        } catch (error) {
          console.error(`[Auth] Failed to auto-complete onboarding for ${user.id}:`, error);
        }
      }

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

    },
  },
  pages: {
    signIn: '/',
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
    },
  });

  // Link the new user to their referrer (tracking only, no credit award)
  await prisma.user.update({
    where: { id: userId },
    data: { referredById: invitation.referrerId },
  });

  console.log(`[Auth] Linked user ${userId} to referrer ${invitation.referrerId}`);
}
