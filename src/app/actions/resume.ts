'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export interface ResumeData {
  id: string;
  filename: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  version: number;
  isActive: boolean;
  uploadedAt: Date;
  createdAt: Date;
}

// ============================================================================
// Resume Actions
// ============================================================================

export async function getResumesAction(): Promise<
  { success: true; resumes: ResumeData[] } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const resumes = await prisma.userResume.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isActive: 'desc' }, { uploadedAt: 'desc' }],
    });

    return {
      success: true,
      resumes: resumes.map((r) => ({
        id: r.id,
        filename: r.filename,
        fileUrl: r.fileUrl,
        fileSize: r.fileSize,
        mimeType: r.mimeType,
        version: r.version,
        isActive: r.isActive,
        uploadedAt: r.uploadedAt,
        createdAt: r.createdAt,
      })),
    };
  } catch (error) {
    console.error('Error fetching resumes:', error);
    return { success: false, error: 'Failed to fetch resumes' };
  }
}

export async function setActiveResumeAction(
  resumeId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership
    const existing = await prisma.userResume.findUnique({
      where: { id: resumeId },
      select: { userId: true },
    });

    if (!existing || existing.userId !== session.user.id) {
      return { success: false, error: 'Resume not found' };
    }

    // Remove active from all user's resumes
    await prisma.userResume.updateMany({
      where: { userId: session.user.id },
      data: { isActive: false },
    });

    // Set new active resume
    await prisma.userResume.update({
      where: { id: resumeId },
      data: { isActive: true },
    });

    return { success: true };
  } catch (error) {
    console.error('Error setting active resume:', error);
    return { success: false, error: 'Failed to set active resume' };
  }
}

export async function deleteResumeAction(
  resumeId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify ownership and get file URL
    const resume = await prisma.userResume.findUnique({
      where: { id: resumeId },
      select: { userId: true, fileUrl: true },
    });

    if (!resume || resume.userId !== session.user.id) {
      return { success: false, error: 'Resume not found' };
    }

    // Delete from Supabase Storage if configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseServiceKey && resume.fileUrl) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        // Extract file path from URL
        const urlParts = resume.fileUrl.split('/');
        const fileName = urlParts.slice(-2).join('/'); // Get userId/filename part

        await supabase.storage.from('resumes').remove([fileName]);
      } catch (storageError) {
        console.error('Error deleting file from storage:', storageError);
        // Continue with database deletion even if storage deletion fails
      }
    }

    // Delete database record
    await prisma.userResume.delete({
      where: { id: resumeId },
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting resume:', error);
    return { success: false, error: 'Failed to delete resume' };
  }
}
