# UI Consistency Implementation Plan

## Overview
This plan addresses two main issues:
1. **Color inconsistencies** - Many components still use `blue-*` and `gray-*` classes instead of the new `primary-*` and `surface-*` design tokens
2. **Static loading states** - Several loading states show static "Loading..." text without animations

---

## Part 1: Color Consistency Fixes

### 1.1 Global LoadingSpinner Component (HIGH PRIORITY)
**File:** `src/components/search/LoadingSpinner.tsx`
**Issue:** Uses `border-blue-600`
**Fix:** Change to `border-primary-600`

### 1.2 App-Level Loading State (HIGH PRIORITY)
**File:** `src/app/loading.tsx`
**Issue:** Static "Loading..." text with `bg-gray-50` and `text-gray-500`
**Fix:** Add animated spinner, use `bg-surface-50` and `text-surface-500`

### 1.3 Calendar Components (29 instances)

| File | Changes Needed |
|------|----------------|
| `CalendarClient.tsx` | 2 spinner borders: `border-blue-600` → `border-primary-600` |
| `CalendarHeader.tsx` | Button: `bg-blue-600 hover:bg-blue-700` → `btn-primary` class |
| `CalendarControls.tsx` | Active badges: `bg-blue-100 text-blue-700` → `bg-primary-100 text-primary-700` |
| `CalendarAccessPrompt.tsx` | Icon bg, text, button: `blue-*` → `primary-*` |
| `CreateEventModal.tsx` | Focus rings, checkboxes, buttons: `ring-blue-500`, `bg-blue-600` → `primary-*` |
| `MeetingSuggestionCard.tsx` | Links, focus rings, buttons: All `blue-*` → `primary-*` |
| `MonthView/MonthEventPill.tsx` | Event pill: `bg-blue-100 text-blue-800` → `primary-*` |
| `MonthView/MonthDayCell.tsx` | Today highlight: `bg-blue-50`, `bg-blue-600` → `primary-*` |
| `WeekView/DayColumn.tsx` | Today column: `bg-blue-50`, `bg-blue-600` → `primary-*` |
| `WeekView/WeekView.tsx` | Event pill: `bg-blue-100 text-blue-800` → `primary-*` |
| `WeekView/WeekEventCard.tsx` | Event card: `bg-blue-100 border-blue-600` → `primary-*` |

### 1.4 Compose Components (15 instances)

| File | Changes Needed |
|------|----------------|
| `ComposeButton.tsx` | Button: Use `btn-primary` class |
| `ComposeEmailModal.tsx` | Spinner, focus rings, buttons: All `blue-*` → `primary-*`, also use `input` class for form fields |

### 1.5 Search Components (12 instances)

| File | Changes Needed |
|------|----------------|
| `ResultsList.tsx` | Focus ring: `ring-blue-500` → `ring-primary-500` |
| `ExpandedReview.tsx` | Links, focus rings, buttons: All `blue-*` → `primary-*` |
| `BulkReview.tsx` | Email link, focus rings: All `blue-*` → `primary-*` |

### 1.6 History Component (18 instances)
**File:** `src/components/history/EmailHistoryClient.tsx`
- Tab borders: `border-blue-600 text-blue-600` → `border-primary-600 text-primary-600`
- Focus rings: `ring-blue-500` → `ring-primary-500`
- Buttons: `bg-blue-600 hover:bg-blue-700` → `btn-primary`
- Status badge: `bg-blue-100 text-blue-800` → `bg-primary-100 text-primary-800`

### 1.7 Outreach Components (22 instances)

| File | Changes Needed |
|------|----------------|
| `InteractionModal.tsx` | Checkbox, focus rings, button: All `blue-*` → `primary-*` |
| `NotesModal.tsx` | Focus ring, button: All `blue-*` → `primary-*` |
| `OutreachRow.tsx` | Link colors: `text-blue-600` → `text-primary-600` |
| `ThreadPanel.tsx` | Message bg, badges, focus rings, buttons: All `blue-*` → `primary-*` |
| `OutreachFilters.tsx` | Focus rings, active filters, buttons: All `blue-*` → `primary-*` |
| `ReminderModal.tsx` | Focus rings, button: All `blue-*` → `primary-*` |
| `StatusDropdown.tsx` | IN_CONTACT status: `text-blue-700 bg-blue-100` → `text-primary-700 bg-primary-100` |

### 1.8 Sidebar Component (4 instances)
**File:** `src/components/sidebar/PastEmailsSidebar.tsx`
- Buttons: `bg-blue-600 hover:bg-blue-700` → `btn-primary`
- Focus rings: `ring-blue-500` → `ring-primary-500`

### 1.9 Calendar Suggestions Page (3 instances)
**File:** `src/app/calendar/suggestions/SuggestionsClient.tsx`
- Spinner, links, button: All `blue-*` → `primary-*`

### 1.10 Static Pages (4 instances)
**Files:** `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`
- Links: `text-blue-600 hover:text-blue-800` → `text-primary-600 hover:text-primary-700`

---

## Part 2: Loading State Animations

### 2.1 App-Level Loading (CRITICAL)
**File:** `src/app/loading.tsx`
**Current:** Static "Loading..." text
**Fix:** Replace with branded loading screen with animated spinner and Signl logo

### 2.2 Past Emails Sidebar Loading
**File:** `src/components/sidebar/PastEmailsSidebar.tsx` (Line 109)
**Current:** `<p className="text-gray-500">Loading...</p>`
**Fix:** Add spinner icon before text

### 2.3 Email History Loading
**File:** `src/components/history/EmailHistoryClient.tsx` (Line 509)
**Current:** `<p className="text-gray-500">Loading...</p>`
**Fix:** Add spinner with text

### 2.4 Email History "Load More" Button
**File:** `src/components/history/EmailHistoryClient.tsx` (Line 673)
**Current:** Static "Loading..." text in button
**Fix:** Add spinner icon when loading

### 2.5 Thread Panel Messages Loading
**File:** `src/components/outreach/ThreadPanel.tsx` (Line 140)
**Current:** `<p className="text-gray-500">Loading messages...</p>`
**Fix:** Add spinner with text

---

## Part 3: Gray Color Migration (Lower Priority)

Many `gray-*` classes can remain as-is if they're for semantic purposes (disabled states, neutral UI). However, key areas should use `surface-*`:

### Files to Update (selective migration):
- Form inputs: Already handled via `.input` class in globals.css
- Modal backdrops and cards: Already updated
- Remaining gray colors in updated files should use `surface-*` for consistency

**Note:** Full gray→surface migration is lower priority since many grays are semantically correct (hover states, disabled states, etc.)

---

## Implementation Order

### Phase 1: Critical Loading States
1. `src/app/loading.tsx` - App loading screen
2. `src/components/search/LoadingSpinner.tsx` - Global spinner component

### Phase 2: Calendar (Most Visible Blue Usage)
3. `CalendarClient.tsx`
4. `CalendarHeader.tsx`
5. `CalendarControls.tsx`
6. `CalendarAccessPrompt.tsx`
7. `CreateEventModal.tsx`
8. `MeetingSuggestionCard.tsx`
9. `MonthView/*.tsx` (3 files)
10. `WeekView/*.tsx` (3 files)

### Phase 3: Core Components
11. `ComposeButton.tsx`
12. `ComposeEmailModal.tsx`
13. `PastEmailsSidebar.tsx`

### Phase 4: Search & History
14. `ResultsList.tsx`
15. `ExpandedReview.tsx`
16. `BulkReview.tsx`
17. `EmailHistoryClient.tsx`

### Phase 5: Outreach
18. `InteractionModal.tsx`
19. `NotesModal.tsx`
20. `OutreachRow.tsx`
21. `ThreadPanel.tsx`
22. `OutreachFilters.tsx`
23. `ReminderModal.tsx`
24. `StatusDropdown.tsx`

### Phase 6: Remaining
25. `SuggestionsClient.tsx`
26. `privacy/page.tsx`
27. `terms/page.tsx`

---

## Estimated Changes

- **Total files:** ~27 files
- **Blue→Primary conversions:** ~85 instances
- **Loading state fixes:** 5 locations
- **Risk level:** Low (purely CSS class changes)

---

## Notes

1. Use existing CSS classes where available:
   - `.btn-primary` for primary buttons
   - `.btn-secondary` for secondary buttons
   - `.input` for form inputs
   - `.card` for card containers
   - `.badge-*` for status badges

2. For focus rings, the global styles already handle `focus-visible` with primary colors, but explicit `focus:ring-*` classes should still use `primary-*`

3. Calendar event colors could optionally support multiple colors in the future, but for now unified primary color provides consistency
