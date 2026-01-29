import { PrismaAdapter } from '@auth/prisma-adapter';
import { NextAuthOptions } from 'next-auth';
import { Adapter } from 'next-auth/adapters';
import GoogleProvider from 'next-auth/providers/google';
import prisma from './prisma';
import { startMailboxWatch } from './gmail/client';
import { verifyCalendarAccessOnSignIn } from './services/calendar';

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
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events',
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
    async signIn({ user }) {
      if (!user.id) return;

      // Start Gmail watch subscription for push notifications
      const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
      if (topicName) {
        try {
          await startMailboxWatch(user.id, topicName);
          console.log(`[Auth] Gmail watch started for user ${user.id}`);
        } catch (error) {
          // Log but don't block sign-in if watch fails
          console.error(`[Auth] Failed to start Gmail watch for user ${user.id}:`, error);
        }
      }

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
