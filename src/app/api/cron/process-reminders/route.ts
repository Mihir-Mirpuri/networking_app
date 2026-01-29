import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getDueReminders, markReminderSent } from '@/app/actions/reminders';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Reminders Cron] Starting reminder processing...');

  try {
    // Get all due reminders
    const result = await getDueReminders();

    if (!result.success) {
      console.error('[Reminders Cron] Failed to fetch due reminders:', result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const reminders = result.reminders;
    console.log(`[Reminders Cron] Found ${reminders.length} due reminders`);

    if (reminders.length === 0) {
      return NextResponse.json({ success: true, processed: 0 });
    }

    let processed = 0;
    let failed = 0;

    for (const reminder of reminders) {
      try {
        // Skip if no valid email address
        if (!reminder.userEmail) {
          console.warn(`[Reminders Cron] Skipping reminder ${reminder.id}: no user email`);
          continue;
        }

        // Send email notification
        if (resend) {
          const contactDisplay = reminder.contactName || reminder.contactEmail;
          const companyInfo = reminder.company ? ` at ${reminder.company}` : '';

          const { error } = await resend.emails.send({
            from: 'Lattice Reminders <reminders@resend.dev>',
            to: reminder.userEmail,
            subject: `Reminder: Follow up with ${contactDisplay}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
                  Outreach Reminder
                </h2>

                <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 0 0 10px 0; color: #1a1a1a; font-size: 16px;">
                    <strong>Time to follow up with ${contactDisplay}${companyInfo}</strong>
                  </p>
                  <p style="margin: 0; color: #6b7280;">
                    Email: ${reminder.contactEmail}
                  </p>
                  ${reminder.reminderNote ? `
                    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
                      <p style="margin: 0; color: #374151;">
                        <strong>Note:</strong> ${reminder.reminderNote}
                      </p>
                    </div>
                  ` : ''}
                </div>

                <p style="color: #6b7280; font-size: 14px;">
                  <a href="${process.env.NEXTAUTH_URL || 'https://lattice.app'}/history"
                     style="color: #3b82f6; text-decoration: none;">
                    View your outreach tracker
                  </a>
                </p>

                <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; text-align: center;">
                  Sent from Lattice Outreach Tracker
                </p>
              </div>
            `,
          });

          if (error) {
            console.error(`[Reminders Cron] Failed to send reminder email for ${reminder.id}:`, error);
            failed++;
            continue;
          }
        } else {
          // Log for development if Resend is not configured
          console.log(`[Reminders Cron] Would send reminder email to ${reminder.userEmail} for ${reminder.contactEmail}`);
        }

        // Mark reminder as sent
        const markResult = await markReminderSent(reminder.id);
        if (markResult.success) {
          processed++;
          console.log(`[Reminders Cron] Processed reminder ${reminder.id}`);
        } else {
          console.error(`[Reminders Cron] Failed to mark reminder ${reminder.id} as sent:`, markResult.error);
          failed++;
        }
      } catch (error) {
        console.error(`[Reminders Cron] Error processing reminder ${reminder.id}:`, error);
        failed++;
      }
    }

    console.log(`[Reminders Cron] Completed. Processed: ${processed}, Failed: ${failed}`);

    return NextResponse.json({
      success: true,
      processed,
      failed,
      total: reminders.length,
    });
  } catch (error) {
    console.error('[Reminders Cron] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
