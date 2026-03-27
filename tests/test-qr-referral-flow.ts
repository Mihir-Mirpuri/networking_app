/**
 * Test QR referral flow: middleware cookie setting + click tracking
 *
 * Run: npx tsx tests/test-qr-referral-flow.ts
 * Requires: dev server running on localhost:3000
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e: any) {
    console.error(`❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log(`Testing against ${BASE}\n`);

  await test('GET /?ref=TESTCODE sets signl_ref cookie', async () => {
    const res = await fetch(`${BASE}/?ref=TESTCODE`, { redirect: 'manual' });
    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
    const joined = cookies.join('; ');
    if (!joined.includes('signl_ref=TESTCODE')) {
      throw new Error(`Expected signl_ref=TESTCODE in Set-Cookie, got: ${joined}`);
    }
  });

  await test('GET / without ?ref= does NOT set signl_ref cookie', async () => {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
    const joined = cookies.join('; ');
    if (joined.includes('signl_ref=')) {
      throw new Error(`Unexpected signl_ref cookie: ${joined}`);
    }
  });

  await test('POST /api/referral/click returns ok', async () => {
    const res = await fetch(`${BASE}/api/referral/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'TESTCODE' }),
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`Response: ${JSON.stringify(data)}`);
  });

  await test('POST /api/referral/click rejects missing code', async () => {
    const res = await fetch(`${BASE}/api/referral/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  console.log('\nDone.');
})();
