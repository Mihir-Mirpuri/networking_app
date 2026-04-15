# Subscription Theming Pass 2 — Full Interactive Element Conversion

## Overview

Extend the existing CSS var theming system to cover ALL interactive/accent elements in the app. Pass 1 converted subscription-based message bubble colors. Pass 2 converts the remaining `#6364FF` purple-blue action color and gray CTA buttons to use `var(--accent)`.

## Scope

### Convert to `var(--accent)` / `var(--accent-hover)`

- All `#6364FF` / `#5354EE` / `#5253E5` / `#7879ff` references (primary action color)
- Gray CTA/submit buttons using `#505050` / `#606060` as action buttons
- Focus borders using `focus:border-[#6364FF]`
- Active tab indicators using `#6364FF`
- Tab active backgrounds using `#6364FF/20` or `#6364FF/15` → `var(--accent-badge-bg)`

### NOT converting (brand colors)

- Gmail blue (`#1a73e8`, `#0b57d0`) — Google brand
- LinkedIn blue (`#0A66C2`) — LinkedIn brand
- Cancel/dismiss/close buttons — stay gray
- Surface/card backgrounds — unchanged

## Architecture

No new infrastructure. Uses the existing CSS custom properties (`--accent`, `--accent-hover`, `--accent-text`, `--accent-badge-bg`) defined in `globals.css` and toggled by `ThemeApplicator` in `Providers.tsx`.

## Files to modify

### Primary CTA buttons (`#6364FF` → `var(--accent)`)
- `src/components/compose/ProfileCompletionModal.tsx`
- `src/components/landing/WelcomeModal.tsx`
- `src/components/auth/LoginPromptModal.tsx`
- `src/components/search/ExpandedReview.tsx`
- `src/components/outreach/ExpandedHistoryReview.tsx`
- `src/components/outreach/OutreachFilters.tsx`
- `src/components/outreach/HistorySidebar.tsx`
- `src/components/outreach/ScheduledEmailsSection.tsx`
- `src/components/profile/ProfileClient.tsx`

### Gray submit buttons (`#505050` → `var(--accent)`)
- `src/components/outreach/InteractionModal.tsx`
- `src/components/outreach/NotesModal.tsx`
- `src/components/outreach/ReminderModal.tsx`

### Tab active states
- `src/components/outreach/HistorySidebar.tsx`
- `src/components/profile/ProfileClient.tsx`
- `src/components/outreach/OutreachTable.tsx`

### Focus borders
- `src/components/compose/ProfileCompletionModal.tsx`
- `src/components/outreach/OutreachRow.tsx`
- `src/components/outreach/HistorySidebar.tsx`

### `.btn-primary` in globals.css
- `src/app/globals.css` — update to use `var(--accent)` / `var(--accent-hover)`
