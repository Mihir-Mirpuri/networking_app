/**
 * API route tests for Gmail client functionality
 * 
 * These are example API routes you can add to test the Gmail client.
 * 
 * To use:
 * 1. Copy the route files to src/app/api/test-gmail/
 * 2. Visit the endpoints in your browser or use curl
 * 
 * GET /api/test-gmail/client - Test getGmailClient()
 * POST /api/test-gmail/watch - Test startMailboxWatch()
 */

// Example: src/app/api/test-gmail/client/route.ts
export const clientRouteExample = `
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGmailClient } from '@/lib/gmail/client';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const gmail = await getGmailClient(session.user.id);
    
    // Test: Get profile
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    // Test: List labels
    const labels = await gmail.users.labels.list({ userId: 'me' });
    
    return NextResponse.json({ 
      success: true,
      email: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal,
      labelCount: labels.data.labels?.length || 0,
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false,
      error: error.message,
      name: error.name 
    }, { status: 500 });
  }
}
`;

// Example: src/app/api/test-gmail/watch/route.ts
export const watchRouteExample = `
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { startMailboxWatch } from '@/lib/gmail/client';
import { NextResponse } from 'next/server';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topicName) {
    return NextResponse.json({ 
      error: 'GOOGLE_PUBSUB_TOPIC not configured' 
    }, { status: 500 });
  }

  try {
    const result = await startMailboxWatch(session.user.id, topicName);
    
    return NextResponse.json({ 
      success: true,
      historyId: result.historyId,
      expiration: result.expiration,
      expirationDate: new Date(parseInt(result.expiration, 10)).toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false,
      error: error.message,
      name: error.name 
    }, { status: 500 });
  }
}
`;

console.log('📝 API Route Examples');
console.log('====================\n');
console.log('These are example API routes you can create.\n');
console.log('See the exported strings above for the route code.\n');
