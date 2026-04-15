# Subscription-Based Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a dynamic green/blue theme system where free users see green accents and paid users see blue accents throughout the entire app, with smooth 300ms transitions on status change.

**Architecture:** CSS custom properties (`--accent`, `--accent-hover`, etc.) defined on `body[data-theme]` in `globals.css`. A `ThemeApplicator` component inside `Providers.tsx` reads `useSubscription()` and sets the `data-theme` attribute. Tailwind config maps `accent` colors to these CSS vars. All hardcoded accent hex values are replaced with CSS var references or Tailwind `accent-*` classes.

**Tech Stack:** Next.js 14, Tailwind CSS, CSS Custom Properties, React Context (existing `SubscriptionContext`)

---

### Task 1: CSS Variables & Tailwind Config

**Files:**
- Modify: `src/app/globals.css:14-45`
- Modify: `tailwind.config.ts:11-38`

- [ ] **Step 1: Add CSS variable definitions to globals.css**

Add theme variable definitions and transition rule inside the `@layer base` block, after the existing body rule:

```css
/* Add after the existing body rule (line 23) */

/* Subscription-based theme colors */
body, body[data-theme="free"] {
  --accent: #22C55E;
  --accent-hover: #16A34A;
  --accent-tint: rgba(34,197,94, 0.06);
  --accent-border: rgba(34,197,94, 0.15);
  --accent-text: #22C55E;
  --accent-badge-bg: rgba(34,197,94, 0.12);
}

body[data-theme="pro"] {
  --accent: #2563EB;
  --accent-hover: #1D4ED8;
  --accent-tint: rgba(37,99,235, 0.06);
  --accent-border: rgba(37,99,235, 0.15);
  --accent-text: #60A5FA;
  --accent-badge-bg: rgba(37,99,235, 0.12);
}

/* Smooth theme transitions */
*, *::before, *::after {
  transition-property: color, background-color, border-color, box-shadow;
  transition-duration: 300ms;
  transition-timing-function: ease;
}

/* Opt out elements that already have their own transitions or animations */
.animate-bounce, .animate-pulse, .animate-spin, .animate-shimmer,
.animate-fade-in, .animate-fade-in-up, .animate-slide-in-right,
.animate-scale-in, .animate-slide-up, .animate-bookmark-pop,
[class*="animate-signal-arc"], [class*="animate-bounce-dot"] {
  transition-property: none;
}
```

- [ ] **Step 2: Update Tailwind config accent colors to use CSS vars**

Replace the existing `accent` color object in `tailwind.config.ts` (lines 27-38):

```typescript
// Replace the existing accent object with:
accent: {
  DEFAULT: 'var(--accent)',
  hover: 'var(--accent-hover)',
  tint: 'var(--accent-tint)',
  border: 'var(--accent-border)',
  text: 'var(--accent-text)',
  badge: 'var(--accent-badge-bg)',
},
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (existing errors are OK)

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css tailwind.config.ts
git commit -m "feat: add CSS custom properties for subscription-based theming"
```

---

### Task 2: ThemeApplicator Component

**Files:**
- Modify: `src/components/Providers.tsx:1-33`

- [ ] **Step 1: Add ThemeApplicator component to Providers.tsx**

Add a `ThemeApplicator` component that reads subscription status and sets `data-theme` on `<body>`. Place it inside `SubscriptionProvider` so it has access to the hook:

```tsx
// Add import at top
import { useSubscription } from '@/contexts/SubscriptionContext';

// Add this component before the Providers function
function ThemeApplicator() {
  const { isSubscribed } = useSubscription();

  useEffect(() => {
    const theme = isSubscribed ? 'pro' : 'free';
    document.body.setAttribute('data-theme', theme);
  }, [isSubscribed]);

  return null;
}
```

Add the `useEffect` import — it's not currently imported in this file:

```tsx
import { ReactNode, useEffect } from 'react';
```

- [ ] **Step 2: Wire ThemeApplicator into the provider tree**

Add `<ThemeApplicator />` inside `<SubscriptionProvider>`, alongside `<BackgroundTasks />`:

```tsx
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SubscriptionProvider>
        <ThemeApplicator />
        <DrafterProvider>
          <BackgroundTasks />
          <ReferralCapture />
          {children}
          <DrafterPanel />
        </DrafterProvider>
      </SubscriptionProvider>
    </SessionProvider>
  );
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/components/Providers.tsx
git commit -m "feat: add ThemeApplicator to set data-theme based on subscription"
```

---

### Task 3: Update EmailChatPanel Message Bubbles

**Files:**
- Modify: `src/components/sidebar/EmailChatPanel.tsx`

All 4 message bubble instances use this pattern:
```
isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'
```
Replace with:
```
isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'
```

- [ ] **Step 1: Update InitialGreeting loading bubble (line 131)**

Replace:
```tsx
<div className={`w-fit rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}`}>
```
With:
```tsx
<div className={`w-fit rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}`}>
```

- [ ] **Step 2: Update InitialGreeting main bubble (line 145)**

Replace:
```tsx
<div className={`flex-1 rounded-2xl px-3 py-2 text-sm text-white rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}`}>
```
With:
```tsx
<div className={`flex-1 rounded-2xl px-3 py-2 text-sm text-white rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}`}>
```

- [ ] **Step 3: Update insight checkmark icons (lines 201, 250)**

The LinkedIn section checkmark uses `text-[#2563EB]` and Google uses `text-[#22C55E]`. Unify both to use the theme accent:

Line 201 — replace:
```tsx
<svg className="w-2.5 h-2.5 text-[#2563EB]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
```
With:
```tsx
<svg className="w-2.5 h-2.5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
```

Line 250 — replace:
```tsx
<svg className="w-2.5 h-2.5 text-[#22C55E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
```
With:
```tsx
<svg className="w-2.5 h-2.5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
```

- [ ] **Step 4: Update AI message bubble (line 391)**

Replace:
```tsx
<div className={`rounded-2xl px-3 py-2 text-white rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}`}>
```
With:
```tsx
<div className={`rounded-2xl px-3 py-2 text-white rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}`}>
```

- [ ] **Step 5: Update processing indicator bubble (line 406)**

Replace:
```tsx
<div className={`rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}`}>
```
With:
```tsx
<div className={`rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}`}>
```

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/EmailChatPanel.tsx
git commit -m "feat: use CSS theme vars for EmailChatPanel message bubbles"
```

---

### Task 4: Update ExpandedReview Message Bubbles

**Files:**
- Modify: `src/components/search/ExpandedReview.tsx`

This file has the same subscription-based color pattern in 4 places, plus an `accentColor` variable and success checkmark colors.

- [ ] **Step 1: Update message bubbles and accent variable**

Line 157 — replace:
```tsx
${isSubscribed === false ? 'bg-[#22C55E]' : 'bg-[#3b66f5]'}
```
With:
```tsx
bg-[var(--accent)]
```

Line 342 — replace:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}
```
With:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}
```

Line 370 — replace:
```tsx
${isSubscribed === false ? 'bg-[#22C55E]' : 'bg-[#3b66f5]'}
```
With:
```tsx
bg-[var(--accent)]
```

Line 385 — replace:
```tsx
${isSubscribed === false ? 'bg-[#22C55E]' : 'bg-[#3b66f5]'}
```
With:
```tsx
bg-[var(--accent)]
```

Line 981 — replace:
```tsx
const accentColor = isSubscribed === false ? 'bg-[#22C55E]' : 'bg-[#2563EB]';
```
With:
```tsx
const accentColor = 'bg-[var(--accent)]';
```

- [ ] **Step 2: Update success checkmark colors**

Line 57 — replace:
```tsx
<circle className="draw-check-circle" cx="26" cy="26" r="25" fill="none" stroke="#10b981" strokeWidth="2" />
```
With:
```tsx
<circle className="draw-check-circle" cx="26" cy="26" r="25" fill="none" stroke="var(--accent)" strokeWidth="2" />
```

Line 58 — replace:
```tsx
<path className="draw-check-mark" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
```
With:
```tsx
<path className="draw-check-mark" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
```

Line 60 — replace:
```tsx
<p className="mt-3 text-sm font-medium text-emerald-400">Email sent!</p>
```
With:
```tsx
<p className="mt-3 text-sm font-medium text-[var(--accent-text)]">Email sent!</p>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/search/ExpandedReview.tsx
git commit -m "feat: use CSS theme vars for ExpandedReview message bubbles"
```

---

### Task 5: Update ExpandedHistoryReview Message Bubbles

**Files:**
- Modify: `src/components/outreach/ExpandedHistoryReview.tsx`

Same pattern as ExpandedReview — 4 message bubbles, accentColor variable, success checkmark.

- [ ] **Step 1: Update message bubbles and accent variable**

Line 118 — replace:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}
```
With:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}
```

Line 302 — replace:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}
```
With:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}
```

Line 330 — replace:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}
```
With:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}
```

Line 345 — replace:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}
```
With:
```tsx
${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}
```

Line 900 — replace:
```tsx
const accentColor = isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]';
```
With:
```tsx
const accentColor = isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]';
```

- [ ] **Step 2: Update success checkmark colors**

Line 920 — replace:
```tsx
<circle className="draw-check-circle" cx="26" cy="26" r="25" fill="none" stroke="#10b981" strokeWidth="2" />
```
With:
```tsx
<circle className="draw-check-circle" cx="26" cy="26" r="25" fill="none" stroke="var(--accent)" strokeWidth="2" />
```

Line 921 — replace:
```tsx
<path className="draw-check-mark" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
```
With:
```tsx
<path className="draw-check-mark" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
```

Line 923 — replace:
```tsx
<p className="mt-3 text-sm font-medium text-emerald-400">Follow-up sent!</p>
```
With:
```tsx
<p className="mt-3 text-sm font-medium text-[var(--accent-text)]">Follow-up sent!</p>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/outreach/ExpandedHistoryReview.tsx
git commit -m "feat: use CSS theme vars for ExpandedHistoryReview message bubbles"
```

---

### Task 6: Update SearchSidebar Message Bubbles

**Files:**
- Modify: `src/components/layout/SearchSidebar.tsx`

Two message bubbles with subscription-based coloring.

- [ ] **Step 1: Update both message bubble instances**

Line 196 — replace:
```tsx
${isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}
```
With:
```tsx
bg-[var(--accent)]
```

Line 249 — replace:
```tsx
${isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}
```
With:
```tsx
bg-[var(--accent)]
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/SearchSidebar.tsx
git commit -m "feat: use CSS theme vars for SearchSidebar message bubbles"
```

---

### Task 7: Update CreditsDisplay Pro Badge

**Files:**
- Modify: `src/components/credits/CreditsDisplay.tsx:78`

- [ ] **Step 1: Update Pro badge gradient**

Line 78 — replace:
```tsx
<div className="flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full">
```
With:
```tsx
<div className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--accent)] rounded-full">
```

- [ ] **Step 2: Commit**

```bash
git add src/components/credits/CreditsDisplay.tsx
git commit -m "feat: use CSS theme var for CreditsDisplay Pro badge"
```

---

### Task 8: Update Toast Success Color

**Files:**
- Modify: `src/components/ui/Toast.tsx:22`

- [ ] **Step 1: Update success toast background**

Line 22 — replace:
```tsx
? 'bg-emerald-600 text-white'
```
With:
```tsx
? 'bg-[var(--accent)] text-white'
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Toast.tsx
git commit -m "feat: use CSS theme var for Toast success color"
```

---

### Task 9: Update ProfileClient Status Indicators

**Files:**
- Modify: `src/components/profile/ProfileClient.tsx`

Green dots and status indicators that should follow the theme.

- [ ] **Step 1: Update status dot and ping indicators**

Line 1100 — replace:
```tsx
<span className="h-1 w-1 rounded-full bg-[#22C55E]" />
```
With:
```tsx
<span className="h-1 w-1 rounded-full bg-[var(--accent)]" />
```

Line 1146 — replace:
```tsx
<span className="absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-60 animate-ping" />
```
With:
```tsx
<span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-60 animate-ping" />
```

Line 1147 — replace:
```tsx
<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
```
With:
```tsx
<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
```

Line 1336 — replace:
```tsx
? 'bg-[#22C55E]/15 text-[#22C55E]'
```
With:
```tsx
? 'bg-[var(--accent)]/15 text-[var(--accent-text)]'
```

Note: The `bg-green-900/30 text-green-400` on line 1453 is a success banner — leave it as semantic green since it's a transient notification, not an accent element.

- [ ] **Step 2: Commit**

```bash
git add src/components/profile/ProfileClient.tsx
git commit -m "feat: use CSS theme vars for ProfileClient status indicators"
```

---

### Task 10: Update Payment Walls (Aspirational Blue)

**Files:**
- Modify: `src/components/credits/LimitReachedModal.tsx`
- Modify: `src/components/credits/PlansModal.tsx`

These always use the blue/pro theme regardless of user tier (aspirational branding). Wrap their root element with `data-theme="pro"`.

- [ ] **Step 1: Add data-theme="pro" to LimitReachedModal root**

Line 65 — replace:
```tsx
<div className="bg-[#111111] rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-scale-in border border-[#2a2a2a]">
```
With:
```tsx
<div className="bg-[#111111] rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-scale-in border border-[#2a2a2a]" data-theme="pro">
```

- [ ] **Step 2: Replace hardcoded blue hex values in LimitReachedModal with CSS vars**

Replace all `#3b82f6` and `#2563eb` references with CSS var equivalents:

Line 96 — replace:
```tsx
<div className="bg-gradient-to-r from-[#1a1a1a] to-[#0f172a] rounded-lg p-4 border border-[#3b82f6]/30">
```
With:
```tsx
<div className="bg-gradient-to-r from-[#1a1a1a] to-[#0f172a] rounded-lg p-4 border border-[var(--accent-border)]">
```

Line 98 — replace:
```tsx
<div className="w-8 h-8 bg-[#3b82f6]/20 rounded-full flex items-center justify-center flex-shrink-0">
```
With:
```tsx
<div className="w-8 h-8 bg-[var(--accent-badge-bg)] rounded-full flex items-center justify-center flex-shrink-0">
```

Line 99 — replace:
```tsx
<svg className="w-4 h-4 text-[#3b82f6]" fill="currentColor" viewBox="0 0 20 20">
```
With:
```tsx
<svg className="w-4 h-4 text-[var(--accent-text)]" fill="currentColor" viewBox="0 0 20 20">
```

Lines 114-115 (upfront toggle active) — replace:
```tsx
? 'bg-[#3b82f6] text-white'
```
With:
```tsx
? 'bg-[var(--accent)] text-white'
```

Lines 124-125 (monthly toggle active) — replace:
```tsx
? 'bg-[#3b82f6] text-white'
```
With:
```tsx
? 'bg-[var(--accent)] text-white'
```

Line 147 (range slider) — replace:
```tsx
className="w-full h-2 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer accent-[#3b82f6]"
```
With:
```tsx
className="w-full h-2 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
```

Line 163 (savings text) — replace:
```tsx
<div className="text-xs text-green-400 mt-1">
```
With:
```tsx
<div className="text-xs text-[var(--accent-text)] mt-1">
```

Line 171 (upfront CTA button) — replace:
```tsx
className="w-full py-2.5 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
```
With:
```tsx
className="w-full py-2.5 bg-[var(--accent)] text-white font-medium rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
```

Line 207 (monthly CTA button) — replace:
```tsx
className="w-full py-2.5 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
```
With:
```tsx
className="w-full py-2.5 bg-[var(--accent)] text-white font-medium rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
```

- [ ] **Step 3: Add data-theme="pro" to PlansModal root**

Line 69 — replace:
```tsx
<div className="bg-[#111111] rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-scale-in border border-[#2a2a2a]">
```
With:
```tsx
<div className="bg-[#111111] rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-scale-in border border-[#2a2a2a]" data-theme="pro">
```

- [ ] **Step 4: Replace hardcoded blue hex values in PlansModal with CSS vars**

Line 144 (Pro plan card border) — replace:
```tsx
border-[#3b82f6]/30 bg-gradient-to-br from-[#1a1a1a] to-[#0f172a]
```
With:
```tsx
border-[var(--accent-border)] bg-gradient-to-br from-[#1a1a1a] to-[#0f172a]
```

Line 145 (Best Value badge) — replace:
```tsx
bg-[#3b82f6]
```
With:
```tsx
bg-[var(--accent)]
```

Lines 163, 173 (payment type toggle active) — replace both:
```tsx
? 'bg-[#3b82f6] text-white'
```
With:
```tsx
? 'bg-[var(--accent)] text-white'
```

Line 195 (range slider) — replace:
```tsx
accent-[#3b82f6]
```
With:
```tsx
accent-[var(--accent)]
```

Line 211 (savings text) — replace:
```tsx
<div className="text-sm text-green-400 mt-1">
```
With:
```tsx
<div className="text-sm text-[var(--accent-text)] mt-1">
```

Lines 219, 283 (CTA buttons) — replace both:
```tsx
className="w-full py-2.5 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
```
With:
```tsx
className="w-full py-2.5 bg-[var(--accent)] text-white font-medium rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
```

Lines 333, 349, 365, 381, 416, 432 (checkmark icons) — replace all:
```tsx
className="w-4 h-4 text-[#3b82f6]"
```
With:
```tsx
className="w-4 h-4 text-[var(--accent-text)]"
```

Line 402 (Current Plan badge for subscribed) — replace:
```tsx
text-[#3b82f6] text-xs font-medium rounded border border-[#3b82f6]/30
```
With:
```tsx
text-[var(--accent-text)] text-xs font-medium rounded border border-[var(--accent-border)]
```

- [ ] **Step 5: Commit**

```bash
git add src/components/credits/LimitReachedModal.tsx src/components/credits/PlansModal.tsx
git commit -m "feat: payment walls use aspirational pro theme with CSS vars"
```

---

### Task 11: Update badge-success in globals.css

**Files:**
- Modify: `src/app/globals.css:113-115`

- [ ] **Step 1: Update badge-success to use theme vars**

Replace:
```css
.badge-success {
  @apply badge bg-emerald-900/30 text-emerald-400;
}
```
With:
```css
.badge-success {
  @apply badge;
  background-color: var(--accent-badge-bg);
  color: var(--accent-text);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: badge-success uses theme accent vars"
```

---

### Task 12: Build Verification & Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No new type errors

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds (existing error in OnboardingClient.tsx is known and pre-existing)

- [ ] **Step 3: Visual smoke test**

Run: `npm run dev`

Verify in browser:
1. Unauthenticated/free user → green accents on message bubbles, badges, buttons
2. Paid user → blue accents everywhere
3. Payment modals → always blue (aspirational)
4. Dark surfaces unchanged for both tiers
5. No visual glitches from the global transition rule

- [ ] **Step 4: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: resolve any theming issues found during smoke test"
```
