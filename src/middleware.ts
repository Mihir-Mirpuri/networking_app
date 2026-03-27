import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get('ref');
  if (!ref) return NextResponse.next();

  const response = NextResponse.next();

  response.cookies.set('signl_ref', ref, {
    path: '/',
    maxAge: 3600,
    httpOnly: false,
    sameSite: 'lax',
  });

  // Fire-and-forget click tracking
  const clickUrl = new URL('/api/referral/click', request.url);
  fetch(clickUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: ref }),
  }).catch(() => {});

  return response;
}

export const config = {
  matcher: '/',
};
