# Referral & Credits System Mapped Out

## Context

- **CreditsDisplay.tsx** is the persistent header component showing remaining emails.
- **LimitReachedModal.tsx** is the paywall modal shown when a user exhausts their daily limit.
- **Server Actions** for invitations live in `src/app/actions/invitations.ts`.
- **Key files:** `credits.ts` (credit logic), `invitations.ts` (server actions), `LimitReachedModal.tsx` (paywall UI), `CreditsDisplay.tsx` (header display), `auth.ts` (referral linkage on signup), `gmail.ts` (send-time credit check/consume), `subscription.ts` (Stripe checkout), `constants.ts` (limits).

---

## Part 1: Credit System Architecture

### Data Model (User fields)

| Field | Type | Purpose |
|-------|------|---------|
| `dailySendCount` | Int (default 0) | Emails sent today |
| `lastSendDate` | DateTime? | Last date an email was sent (for day boundary detection) |
| `emailCredits` | Int (default 0) | Bonus credits earned from referrals |
| `referralCode` | String? (unique) | User's permanent 8-char referral code |
| `referredById` | String? | FK to User who referred this person (tracking only) |
| `subscriptionStatus` | String? | Stripe status ("active", "canceled", etc.) |
| `stripeCurrentPeriodEnd` | DateTime? | When current subscription period expires |

### Data Model (Invitation)

| Field | Type | Purpose |
|-------|------|---------|
| `referrerId` | String | FK to User who sent the invite |
| `inviteeEmail` | String | Email address invited |
| `status` | InvitationStatus | PENDING or SIGNED_UP |
| `creditsAwarded` | Int (default 0) | Credits awarded for this invite |
| `sentAt` | DateTime | When invite was sent (used for 1/day enforcement) |
| `signedUpAt` | DateTime? | When invitee signed up (if ever) |

**Constraints:** `@@unique([referrerId, inviteeEmail])` — one invite per referrer-invitee pair. `@@index([inviteeEmail])` and `@@index([status])` for lookup performance.

---

## Part 2: Credit Check (Before Every Send)

Every email send goes through a credit gate. The check happens in `gmail.ts` via the credit service.

```
Send Email Flow (SearchPageClient.tsx or PersonLookup.tsx)
 |
 \-- sendEmailsAction() or sendSingleEmailAction()       <-- Server Action (send.ts)
     |
     |-- checkDailyLimit(userId)                          <-- gmail.ts wrapper
     |   |
     |   \-- checkEmailCredits(userId)                    <-- credits.ts
     |       |
     |       |-- STEP 1: Check subscription ----------------
     |       |-- IF subscriptionStatus === 'active'
     |       |   AND stripeCurrentPeriodEnd > now():
     |       |   \-- Return { canSend: true, dailyLimit: -1 (unlimited) }
     |       |
     |       |-- STEP 2: Check daily limit -----------------
     |       |-- isNewDay = lastSendDate.toDateString() !== today?
     |       |-- dailyUsed = isNewDay ? 0 : dailySendCount
     |       |-- dailyRemaining = max(0, 10 - dailyUsed)
     |       |
     |       |-- STEP 3: Add bonus credits -----------------
     |       |-- totalRemaining = dailyRemaining + emailCredits
     |       |
     |       \-- Return { canSend: totalRemaining > 0, dailyUsed, dailyLimit: 10,
     |                    bonusCredits, totalRemaining, isSubscribed: false }
     |
     |-- IF !canSend:
     |   \-- Return { error: 'LIMIT_REACHED' }
     |       |
     |       \-- Client receives 'LIMIT_REACHED'
     |           \-- setShowLimitModal(true)               <-- Opens LimitReachedModal
     |
     |-- IF canSend: proceed with send, then...
     |
     \-- incrementDailyCount(userId)                      <-- gmail.ts wrapper
         |
         \-- consumeEmailCredit(userId)                   <-- credits.ts
             |
             |-- isNewDay? -> reset dailySendCount to 0
             |-- dailyRemaining = 10 - dailyUsed
             |
             |-- IF dailyRemaining > 0:
             |   \-- Increment dailySendCount, update lastSendDate
             |
             \-- ELSE IF emailCredits > 0:
                 \-- Decrement emailCredits by 1, update lastSendDate
```

**Consumption order:** Daily free limit is always consumed first. Bonus credits are only touched after the daily 10 are exhausted. This means a user who earned 10 bonus credits effectively has 20 emails available that day.

**Day boundary detection:** Compares `lastSendDate.toDateString()` with `today.toDateString()`. When a new day is detected, `dailySendCount` resets to 0 implicitly (the check treats stale counts as 0).

---

## Part 3: Referral Flow (Invite a Friend)

### Trigger: LimitReachedModal

When `checkDailyLimit()` returns `canSend: false`, the client opens `LimitReachedModal`. The modal presents two options:

1. **Upgrade to Pro** — Stripe checkout ($10/month, unlimited emails)
2. **Invite a Friend** — earn 10 bonus emails instantly

### Pre-check: Has the user already invited someone today?

```
LimitReachedModal opens
 |
 \-- useEffect() on mount:
     \-- hasInvitedTodayAction()                          <-- Server Action
         |
         \-- prisma.invitation.findFirst({
                referrerId: userId,
                sentAt: { gte: todayStart }               // midnight today
             })
         |
         |-- IF found -> setHasInvitedToday(true)
         |   \-- Hide invite form, show: "Already invited someone today.
         |       Upgrade to Pro or invite another friend tomorrow."
         |
         \-- IF not found -> setHasInvitedToday(false)
             \-- Show invite form
```

### Sending an Invite

```
User submits email in LimitReachedModal
 |
 \-- sendInviteAction(inviteeEmail)                       <-- Server Action
     |
     |-- AUTH + VALIDATE ------------------------------------
     |-- getServerSession()                                // who is this user?
     |-- Validate email format (regex)
     |-- Normalize: toLowerCase().trim()
     |-- Cannot invite yourself
     |
     |-- 1/DAY LIMIT CHECK ---------------------------------
     |-- prisma.invitation.findFirst({
     |     referrerId: userId,
     |     sentAt: { gte: todayStart }                     // any invite sent today?
     |   })
     |-- IF found -> return error: "You can only invite one person per day"
     |
     |-- DUPLICATE CHECK ------------------------------------
     |-- prisma.invitation.findUnique({
     |     referrerId_inviteeEmail: { referrerId, inviteeEmail }
     |   })
     |-- IF found -> return error: "You have already invited this person"
     |
     |-- EXISTING USER CHECK --------------------------------
     |-- prisma.user.findUnique({ email: inviteeEmail })
     |-- IF found -> return error: "This person is already a Signl user"
     |
     |-- GENERATE REFERRAL CODE -----------------------------
     |-- generateReferralCode(userId)                      <-- credits.ts
     |   |-- Check if user already has a referralCode -> return it
     |   |-- Otherwise: generate 8-char alphanumeric code
     |   |   (chars: A-Z excluding O/I, 2-9 excluding 0/1)
     |   |-- Retry up to 10 times if code already taken
     |   \-- Save to user.referralCode
     |
     |-- CREATE INVITATION ----------------------------------
     |-- prisma.invitation.create({
     |     referrerId, inviteeEmail, status: 'PENDING',
     |     creditsAwarded: 10
     |   })
     |
     |-- AWARD CREDITS --------------------------------------
     |-- awardCredits(userId, 10)                          <-- credits.ts
     |   |-- currentCredits = user.emailCredits
     |   |-- newCredits = min(currentCredits + 10, MAX_CREDITS=10)
     |   |-- actualAwarded = newCredits - currentCredits
     |   |-- IF actualAwarded > 0: update user.emailCredits
     |   \-- Return actualAwarded (may be < 10 if near cap)
     |
     |-- SEND EMAIL -----------------------------------------
     |-- Resend API: send invite email to inviteeEmail
     |   |-- Subject: "{referrerName} invited you to Signl"
     |   |-- Body: HTML with Signl description + "Sign Up Free" CTA
     |   |-- CTA link: {baseUrl}/auth/signin?ref={referralCode}
     |   \-- Failure is non-fatal (credits already awarded)
     |
     \-- Return { success: true, creditsAwarded: actualAwarded }
```

### Client-Side After Successful Invite

```
 -- Back in LimitReachedModal ----------------------------
 |-- setSuccessMessage("Invite sent! +10 credits added")
 |-- setHasInvitedToday(true)                             // hide form on next view
 |-- onCreditsAwarded(10)                                 // bubble up to parent
 |
 -- Back in SearchPageClient ----------------------------
 |-- setRemainingDaily(prev => prev + credits)
 |-- setToast("+10 email credits added!")
 |-- dispatchCreditsChanged()                             // fires custom event
 |
 -- CreditsDisplay hears CREDITS_CHANGED_EVENT -----------
 \-- Refetches getCreditStatusAction() -> updates header display
```

---

## Part 4: Referral Signup Tracking

When an invited person signs up via the referral link, their account is linked to the referrer. **No credits are awarded on signup** — credits are only awarded at invite-send time.

```
New user clicks signup link: /auth/signin?ref={referralCode}
 |
 \-- NextAuth signIn event (auth.ts)
     |
     |-- IF isNewUser AND user.email:
     |   \-- handleReferralSignup(userId, userEmail)
     |       |
     |       |-- prisma.invitation.findFirst({
     |       |     inviteeEmail: userEmail.toLowerCase(),
     |       |     status: 'PENDING'
     |       |   })
     |       |
     |       |-- IF no invitation found -> log and return (organic signup)
     |       |
     |       |-- Update invitation:
     |       |   status: 'SIGNED_UP', signedUpAt: now()
     |       |
     |       |-- Link new user to referrer:
     |       |   user.referredById = invitation.referrerId
     |       |
     |       \-- Log: "Linked user X to referrer Y"
     |
     \-- No credits awarded (tracking only)
```

**Why keep the linkage without credits?** The `referredById` field on User is a passive tracking column. It costs nothing to maintain and preserves attribution data if referral-based rewards are reintroduced later. The `Invitation.status` progressing from PENDING to SIGNED_UP provides conversion funnel data.

---

## Part 5: Subscription (Pro) Flow

The other path out of LimitReachedModal is Stripe checkout.

```
User clicks "Upgrade to Pro - $10/month"
 |
 \-- createCheckoutSession()                              <-- Server Action (subscription.ts)
     |
     |-- getServerSession()
     |-- IF no stripeCustomerId:
     |   \-- stripe.customers.create({ email, name, metadata: { userId } })
     |       \-- Save stripeCustomerId to user
     |
     |-- stripe.checkout.sessions.create({
     |     customer: stripeCustomerId,
     |     mode: 'subscription',
     |     line_items: [{ price: PRICE_ID, quantity: 1 }],
     |     allow_promotion_codes: true,
     |     success_url: /search?subscription=success,
     |     cancel_url: /search
     |   })
     |
     \-- redirect(session.url)                            // browser redirect to Stripe
```

```
After payment: Stripe webhook -> /api/webhooks/stripe
 |
 |-- checkout.session.completed:
 |   \-- Update user: stripeSubscriptionId, subscriptionStatus,
 |       stripeCurrentPeriodEnd
 |
 |-- invoice.payment_succeeded / invoice.paid:
 |   \-- Refresh subscription status from Stripe
 |
 |-- customer.subscription.updated:
 |   \-- Sync status + period end
 |
 \-- customer.subscription.deleted:
     \-- Mark subscriptionStatus = 'canceled'
```

**Once subscribed:** `checkEmailCredits()` returns `dailyLimit: -1` and `canSend: true` unconditionally. Bonus credits still exist on the user but are never consumed (daily limit check short-circuits).

---

## Part 6: CreditsDisplay (Header Component)

```
CreditsDisplay (mounted in sidebar/header)
 |
 |-- On mount: getCreditStatusAction()                    <-- Server Action
 |   \-- checkEmailCredits(userId) + user.referralCode
 |
 |-- Listens to custom event: CREDITS_CHANGED_EVENT
 |   \-- Re-fetches on every event dispatch
 |
 |-- Rendering logic:
 |   |-- IF isSubscribed:
 |   |   \-- Blue gradient "Pro" badge + "Unlimited emails"
 |   |
 |   \-- ELSE (free tier):
 |       |-- "Emails left: X/10"
 |       |   |-- Color: red if 0, amber if <= 3, gray otherwise
 |       |
 |       \-- IF bonusCredits > 0:
 |           \-- Purple "+N" badge (bonus credit count)
```

**Event-driven updates:** After every email send, `dispatchCreditsChanged()` fires. After referral credit award, same event fires. CreditsDisplay re-fetches from the server each time, ensuring the count is always accurate.

---

## Key Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| DEFAULT_DAILY_LIMIT | 10 | constants.ts | Free emails per day |
| CREDITS_ON_INVITE_SENT | 10 | constants.ts | Bonus credits awarded per invite |
| MAX_INVITES_PER_DAY | 1 | constants.ts | Invite cap per day |
| MAX_CREDITS | 10 | constants.ts | Max bonus credits storable |
| Referral code length | 8 chars | credits.ts | Alphanumeric, excludes confusing chars (O/I/0/1) |
| Referral code retries | 10 | credits.ts | Max uniqueness collision retries |
| Pro price | $10/month | subscription.ts | Stripe subscription price |

---

## Effective Daily Limits

| Scenario | Max Emails/Day |
|----------|---------------|
| Free user, no referral | 10 |
| Free user, invited 1 friend | 20 (10 daily + 10 bonus) |
| Free user, already at 10 bonus credits, invites again | 20 (capped at MAX_CREDITS=10) |
| Pro subscriber | Unlimited |

---

## End-to-End Example

1. **User sends 10 emails** -> `dailySendCount` reaches 10, `checkEmailCredits()` returns `canSend: false`
2. **User clicks Send on 11th email** -> `sendEmailsAction` returns `LIMIT_REACHED` -> `LimitReachedModal` opens
3. **Modal loads** -> `hasInvitedTodayAction()` checks for today's invite -> none found -> show invite form
4. **User enters friend@example.com, clicks "Invite Friend (+10 emails)"**
5. **`sendInviteAction()`** -> validates email, checks 1/day limit (passes), checks duplicates (passes), checks existing user (passes)
6. **Creates Invitation** record (PENDING, creditsAwarded: 10)
7. **`awardCredits(userId, 10)`** -> `emailCredits` goes from 0 to 10
8. **Sends invite email** via Resend with referral link
9. **Returns success** -> modal shows "Invite sent! +10 credits added" -> `hasInvitedToday` set to true
10. **User closes modal** -> header updates from "0/10" to "0/10 +10" (bonus badge)
11. **User sends 11th email** -> `dailyRemaining = 0`, falls through to bonus credits -> `emailCredits` decremented to 9
12. **User sends 20th email** -> `dailyRemaining = 0`, `emailCredits = 0` -> `canSend: false` -> modal opens again
13. **Modal loads** -> `hasInvitedTodayAction()` finds today's invite -> hides form, shows "Already invited someone today. Upgrade to Pro or try again tomorrow."
14. **Next day** -> `dailySendCount` resets (new day detected), but `emailCredits` stays at 0 -> back to 10/day until they invite again
