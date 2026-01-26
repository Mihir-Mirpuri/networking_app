import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FEEDBACK_EMAIL = 'wearelattice@gmail.com';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const { feedback, page } = await request.json();

    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      return NextResponse.json({ error: 'Feedback is required' }, { status: 400 });
    }

    const userEmail = session?.user?.email || 'Anonymous user';
    const userName = session?.user?.name || 'Unknown';
    const timestamp = new Date().toISOString();

    // If Resend is not configured, log to console (for development)
    if (!resend) {
      console.log('=== FEEDBACK RECEIVED (Resend not configured) ===');
      console.log('From:', userEmail);
      console.log('Name:', userName);
      console.log('Page:', page || 'Unknown');
      console.log('Time:', timestamp);
      console.log('Feedback:', feedback);
      console.log('================================================');

      return NextResponse.json({
        success: true,
        message: 'Feedback logged (email service not configured)'
      });
    }

    // Send email via Resend
    const { error } = await resend.emails.send({
      from: 'Lattice Feedback <feedback@resend.dev>',
      to: FEEDBACK_EMAIL,
      subject: `User Feedback from ${userName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
            New Feedback Received
          </h2>

          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #374151; white-space: pre-wrap; line-height: 1.6;">
              ${feedback.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; width: 100px;">From:</td>
              <td style="padding: 8px 0; color: #1a1a1a;">${userName} (${userEmail})</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Page:</td>
              <td style="padding: 8px 0; color: #1a1a1a;">${page || 'Unknown'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Time:</td>
              <td style="padding: 8px 0; color: #1a1a1a;">${new Date(timestamp).toLocaleString()}</td>
            </tr>
          </table>

          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; text-align: center;">
            Sent from Lattice App Feedback System
          </p>
        </div>
      `,
      replyTo: userEmail !== 'Anonymous user' ? userEmail : undefined,
    });

    if (error) {
      console.error('Failed to send feedback email:', error);
      return NextResponse.json({ error: 'Failed to send feedback' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Feedback sent successfully' });
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
