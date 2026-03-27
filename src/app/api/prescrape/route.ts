import { NextRequest, NextResponse } from 'next/server';
import { prescrapeAction } from '@/app/actions/search';

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();

    if (!input.company || typeof input.company !== 'string') {
      return NextResponse.json({ error: 'Company is required' }, { status: 400 });
    }

    const result = await prescrapeAction({
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
      name: input.name,
      skipLocationInSearch: input.skipLocationInSearch,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API /prescrape] Error:', error);
    return NextResponse.json({ success: false, error: 'Prescraping failed' }, { status: 500 });
  }
}
