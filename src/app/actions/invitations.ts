'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { Resend } from 'resend';
import { EMAIL_LIMITS } from '@/lib/constants';
import { awardCredits, generateReferralCode, checkEmailCredits } from '@/lib/services/credits';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface SendInviteResult {
  success: boolean;
  error?: string;
  creditsAwarded?: number;
}

export async function sendInviteAction(inviteeEmail: string): Promise<SendInviteResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) {
    return { success: false, error: 'Not authenticated' };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(inviteeEmail)) {
    return { success: false, error: 'Invalid email address' };
  }

  // Normalize email
  const normalizedEmail = inviteeEmail.toLowerCase().trim();

  // Cannot invite yourself
  if (normalizedEmail === session.user.email.toLowerCase()) {
    return { success: false, error: 'You cannot invite yourself' };
  }

  // Check if user already sent an invite today (1 per day limit)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayInvite = await prisma.invitation.findFirst({
    where: {
      referrerId: session.user.id,
      sentAt: { gte: todayStart },
    },
  });

  if (todayInvite) {
    return { success: false, error: 'You can only invite one person per day. Try again tomorrow!' };
  }

  // Check if already invited by this user
  const existingInvite = await prisma.invitation.findUnique({
    where: {
      referrerId_inviteeEmail: {
        referrerId: session.user.id,
        inviteeEmail: normalizedEmail,
      },
    },
  });

  if (existingInvite) {
    return { success: false, error: 'You have already invited this person' };
  }

  // Check if email is already a user
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    return { success: false, error: 'This person is already a Signl user' };
  }

  // Get or generate referrer's referral code
  const referralCode = await generateReferralCode(session.user.id);

  // Create invitation record
  await prisma.invitation.create({
    data: {
      referrerId: session.user.id,
      inviteeEmail: normalizedEmail,
      status: 'PENDING',
      creditsAwarded: EMAIL_LIMITS.CREDITS_ON_INVITE_SENT,
    },
  });

  // Award credits for sending invite
  const creditsAwarded = await awardCredits(
    session.user.id,
    EMAIL_LIMITS.CREDITS_ON_INVITE_SENT
  );

  // Send invitation email via Resend
  if (resend) {
    const baseUrl = process.env.NEXTAUTH_URL || 'https://signl.to';
    const signUpUrl = `${baseUrl}/?ref=${referralCode}`;
    const referrerName = session.user.name || 'A friend';

    try {
      await resend.emails.send({
        from: 'Signl <invites@resend.dev>',
        to: normalizedEmail,
        subject: `${referrerName} invited you to Signl`,
        html: generateInviteEmailHtml(referrerName, signUpUrl, referralCode),
      });
    } catch (error) {
      console.error('[Invite] Failed to send email:', error);
      // Still return success since credits were awarded and invitation recorded
    }
  } else {
    console.log('[Invite] Resend not configured, skipping email send');
    console.log(`[Invite] Would send invite to ${normalizedEmail} with code ${referralCode}`);
  }

  return {
    success: true,
    creditsAwarded,
  };
}

export async function getCreditStatusAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false as const, error: 'Not authenticated' };
  }

  const status = await checkEmailCredits(session.user.id);

  // Also get referral code if exists
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { referralCode: true },
  });

  return {
    success: true as const,
    ...status,
    referralCode: user?.referralCode,
  };
}

export async function hasInvitedTodayAction(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return false;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayInvite = await prisma.invitation.findFirst({
    where: {
      referrerId: session.user.id,
      sentAt: { gte: todayStart },
    },
  });

  return !!todayInvite;
}

export async function getInvitationsAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false as const, error: 'Not authenticated' };
  }

  const invitations = await prisma.invitation.findMany({
    where: { referrerId: session.user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      inviteeEmail: true,
      status: true,
      creditsAwarded: true,
      sentAt: true,
      signedUpAt: true,
    },
  });

  return { success: true as const, invitations };
}

function generateInviteEmailHtml(
  referrerName: string,
  signUpUrl: string,
  referralCode: string
): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; padding: 30px 0;">
        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
          <span style="color: white; font-weight: bold; font-size: 24px;">S</span>
        </div>
      </div>

      <h1 style="color: #1a1a1a; text-align: center; margin-bottom: 10px; font-size: 24px;">
        You're Invited to Signl
      </h1>

      <p style="color: #6b7280; text-align: center; font-size: 16px; margin-bottom: 30px;">
        ${referrerName.replace(/</g, '&lt;').replace(/>/g, '&gt;')} thinks you'd love Signl
      </p>

      <div style="background: #f8fafc; padding: 24px; border-radius: 12px; margin: 20px 0;">
        <p style="color: #374151; margin: 0 0 15px 0; line-height: 1.6;">
          Signl helps you find and reach out to professionals for networking,
          mentorship, and career opportunities. Craft personalized emails and
          track your outreach all in one place.
        </p>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${signUpUrl}"
           style="display: inline-block; background: #4f46e5; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
          Sign Up Free
        </a>
      </div>

      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 40px;">
        Referral code: ${referralCode}
      </p>
    </div>
  `;
}
