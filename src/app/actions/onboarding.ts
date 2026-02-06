'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export interface OnboardingData {
  name: string;
  classification: string;
  major: string;
  university: string;
  career: string;
}

export async function completeOnboardingAction(
  data: OnboardingData
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Validate all fields are non-empty
  if (!data.name?.trim()) {
    return { success: false, error: 'Full name is required' };
  }
  if (!data.classification?.trim()) {
    return { success: false, error: 'Classification is required' };
  }
  if (!data.major?.trim()) {
    return { success: false, error: 'Major is required' };
  }
  if (!data.university?.trim()) {
    return { success: false, error: 'University is required' };
  }
  if (!data.career?.trim()) {
    return { success: false, error: 'Career interest is required' };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: data.name.trim(),
        classification: data.classification.trim(),
        major: data.major.trim(),
        university: data.university.trim(),
        career: data.career.trim(),
        onboardingCompleted: true,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error completing onboarding:', error);
    return { success: false, error: 'Failed to save profile' };
  }
}
