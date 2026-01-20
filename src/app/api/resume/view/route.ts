import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const resumeId = searchParams.get('id');

    if (!resumeId) {
      return NextResponse.json({ error: 'Resume ID required' }, { status: 400 });
    }

    // Verify ownership
    const resume = await prisma.userResume.findUnique({
      where: { id: resumeId },
      select: { userId: true, fileUrl: true },
    });

    if (!resume || resume.userId !== session.user.id) {
      return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
    }

    // Check if Supabase Storage is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Storage not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Extract file path from stored URL
    // The fileUrl format is: https://project.supabase.co/storage/v1/object/public/resumes/userId/filename
    // We need to extract: userId/filename
    const urlParts = resume.fileUrl.split('/');
    const fileName = urlParts.slice(-2).join('/'); // Get userId/filename part

    // Generate signed URL (valid for 1 hour)
    const { data, error } = await supabase.storage
      .from('resumes')
      .createSignedUrl(fileName, 3600);

    if (error) {
      console.error('Error generating signed URL:', error);
      return NextResponse.json(
        { error: 'Failed to generate view URL' },
        { status: 500 }
      );
    }

    // Redirect to signed URL
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    console.error('Error in view route:', error);
    return NextResponse.json(
      { error: 'Failed to view resume' },
      { status: 500 }
    );
  }
}
