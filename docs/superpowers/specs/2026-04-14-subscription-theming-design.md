# Subscription-Based Theming Design

## Overview

Implement a dynamic green/blue theme system that reflects the user's subscription status throughout the entire app. Free users see a green accent theme, paid users see blue. The dark surface palette stays the same for both tiers.

## Decisions

- **Scope:** Accent colors + subtle surface tints (Option B). Dark backgrounds unchanged.
- **Implementation:** CSS custom properties toggled via `data-theme` attribute on `<body>` (Approach A).
- **Transition:** Immediate and smooth (300ms CSS transition) when subscription status changes.
- **Payment walls:** Always use blue/pro theme (aspirational branding) regardless of user tier.
- **Purple brand palette:** Stays — green/blue handles all interactive/accent elements only.

## Color System

### CSS Variables

| Variable | Free (Green) | Pro (Blue) |
|----------|-------------|------------|
| `--accent` | `#22C55E` | `#2563EB` |
| `--accent-hover` | `#16A34A` | `#1D4ED8` |
| `--accent-tint` | `rgba(34,197,94, 0.06)` | `rgba(37,99,235, 0.06)` |
| `--accent-border` | `rgba(34,197,94, 0.15)` | `rgba(37,99,235, 0.15)` |
| `--accent-text` | `#22C55E` | `#60A5FA` |
| `--accent-badge-bg` | `rgba(34,197,94, 0.12)` | `rgba(37,99,235, 0.12)` |

### Unchanged

- Dark surfaces: `#111111`, `#1a1a1a`, `#252525`, `#303030`
- Text colors: `#b0b0b0` to `#ffffff`
- Purple brand palette (primary-50 through primary-950)
- Error/warning colors (red, amber, orange)

## Architecture

### ThemeProvider

A new component inside `Providers.tsx` that:
1. Reads `useSubscription()` to get `isSubscribed` (boolean | null)
2. Sets `data-theme="free"` or `data-theme="pro"` on `<body>`
3. Defaults to `"free"` when `isSubscribed` is `null` (loading/unauthenticated)

### CSS Variables in globals.css

```css
body[data-theme="free"] {
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

* {
  transition: color 300ms ease, background-color 300ms ease, border-color 300ms ease, box-shadow 300ms ease;
}
```

### Tailwind Config

Extend the theme with an `accent` color that maps to CSS variables:

```js
accent: {
  DEFAULT: 'var(--accent)',
  hover: 'var(--accent-hover)',
  tint: 'var(--accent-tint)',
  border: 'var(--accent-border)',
  text: 'var(--accent-text)',
  badge: 'var(--accent-badge-bg)',
}
```

This enables Tailwind classes like `bg-accent`, `text-accent-text`, `border-accent-border`.

### Payment Wall Override

`LimitReachedModal` and `PlansModal` wrap their content in a `<div data-theme="pro">` to force blue styling regardless of user tier.

## Components Affected

### Core infrastructure (new/modified)
- `src/app/globals.css` — CSS variable definitions, transition rule, update `.btn-primary`/`.badge-success`
- `tailwind.config.ts` — add `accent` color mapping
- `src/components/Providers.tsx` — add ThemeProvider wrapper

### Components to update (hardcoded hex → CSS vars)
- `src/components/sidebar/EmailChatPanel.tsx` — message bubbles, checkmark icons
- `src/components/credits/CreditsDisplay.tsx` — Pro badge gradient
- `src/components/credits/LimitReachedModal.tsx` — force `data-theme="pro"`, replace hex values
- `src/components/credits/PlansModal.tsx` — force `data-theme="pro"`, replace hex values
- `src/components/ui/Toast.tsx` — success state color

### No changes needed
- Dark surface colors, purple brand palette, error/warning colors
- Layout, routing, auth, data model
