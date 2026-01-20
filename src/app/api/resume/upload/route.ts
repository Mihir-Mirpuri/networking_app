import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createClient } from '@supabase/supabase-js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check if Supabase Storage is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase Storage not configured. Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json(
        { error: 'File storage not configured' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only PDF, DOC, and DOCX files are allowed.' },
        { status: 400 }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Ensure the bucket exists (create if it doesn't)
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some((bucket) => bucket.id === 'resumes');

    if (!bucketExists) {
      // Create the bucket if it doesn't exist
      const { data: bucketData, error: createError } = await supabase.storage.createBucket('resumes', {
        public: false,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: ALLOWED_MIME_TYPES,
      });

      if (createError) {
        console.error('Error creating bucket:', createError);
        // If bucket creation fails, try to continue anyway (bucket might exist but not be listed)
        // This handles race conditions where bucket was just created
      } else {
        console.log('Bucket created successfully:', bucketData);
      }
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${session.user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('resumes')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload file to storage' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('resumes')
      .getPublicUrl(fileName);

    const fileUrl = urlData.publicUrl;

    // Check if this is the user's first resume
    const existingResumes = await prisma.userResume.findMany({
      where: { userId: session.user.id },
    });

    const isActive = existingResumes.length === 0;

    // If setting as active, deactivate others
    if (isActive) {
      await prisma.userResume.updateMany({
        where: { userId: session.user.id },
        data: { isActive: false },
      });
    }

    // Get the highest version number for this user
    const maxVersion = existingResumes.length > 0
      ? Math.max(...existingResumes.map((r) => r.version))
      : 0;

    // Create database record
    const resume = await prisma.userResume.create({
      data: {
        userId: session.user.id,
        filename: file.name,
        fileUrl,
        fileSize: file.size,
        mimeType: file.type,
        version: maxVersion + 1,
        isActive,
      },
    });

    return NextResponse.json({
      success: true,
      resume: {
        id: resume.id,
        filename: resume.filename,
        fileUrl: resume.fileUrl,
        fileSize: resume.fileSize,
        mimeType: resume.mimeType,
        version: resume.version,
        isActive: resume.isActive,
        uploadedAt: resume.uploadedAt,
        createdAt: resume.createdAt,
      },
    });
  } catch (error) {
    console.error('Error uploading resume:', error);
    return NextResponse.json(
      { error: 'Failed to upload resume' },
      { status: 500 }
    );
  }
}
