# Referral & Attribution Tracking — Testing Plan

Each step is independent — you can test click tracking without signing up, test the admin page with manually inserted DB data, etc.

## 1. Click Tracking

- Create a test link directly in DB:
  ```sql
  INSERT INTO "ReferralLink" (id, code, type, label)
  VALUES (gen_random_uuid(), 'test-jake', 'AMBASSADOR', 'Jake Smith');
  ```
- Visit `localhost:3000/?ref=test-jake` (incognito)
- Verify: `clickCount` incremented to 1, `signl_ref=test-jake` cookie visible in DevTools

## 2. Signup Attribution

- With the cookie still set, sign in with a Google account that's never been used on the app
- Verify: new user has `referralLinkId` set, link's `signupCount` is 1
- Sign in again with same account — should be a no-op (idempotent)

## 3. 1-Hour Guard

- Sign in with an existing user, then visit `/?ref=test-jake`
- Verify: `referralLinkId` stays null (existing users aren't attributed)

## 4. Paid Conversion

- Use Stripe test card `4242 4242 4242 4242` to subscribe with the referred user
- Verify: link's `paidCount` increments to 1

## 5. Admin Dashboard

- Visit `/admin/referrals` while signed in as an admin email
- Verify: summary cards show correct totals, table shows the test link with stats
- Use the "Create Link" form to make a new QR_CODE link, confirm it appears in the table

## 6. Admin Auth Guard

- Visit `/admin/referrals` with a non-admin account — should redirect to `/`
- Hit `GET /api/admin/referrals` without admin session — should return 403
