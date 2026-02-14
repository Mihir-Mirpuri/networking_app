# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Start dev server (Next.js)
npm run build            # prisma generate && next build
npm run lint             # ESLint (next/core-web-vitals)
npx tsc --noEmit         # Fast type-check (preferred during dev)
npm run db:push          # Push schema to DB (preferred over db:migrate for Supabase)
npm run db:generate      # Regenerate Prisma client after schema changes
npm run db:seed          # Seed database with initial data
```

Tests use `npx tsx` with manual assertions — no test framework:
```bash
npm run test:db                  # Test DB connection
npm run test:groq                # Test Groq LLM integration
npm run test:meeting-suggestions # Test meeting extraction
```

## Architecture

**Stack:** Next.js 14.1.0 (App Router), TypeScript (strict), Prisma ORM, PostgreSQL (Supabase), Tailwind CSS

**Path alias:** `@/*` → `./src/*`

### Source layout (`src/`)

- `app/actions/` — Server actions (`'use server'`). All mutations go here: search, send email, compose, scrape, onboarding, profile, subscription, etc.
- `app/api/` — API routes: NextAuth handler, resume CRUD, prescrape trigger, Stripe/Gmail webhooks, cron jobs
- `components/` — React components grouped by feature: `search/`, `compose/`, `home/`, `sidebar/`, `onboarding/`, `outreach/`, `calendar/`, `profile/`, `history/`, `credits/`, `ui/`
- `lib/db/` — Database service layer: `person-service.ts` (Person/UserCandidate queries), `search-cache.ts` (scrape progress tracking)
- `lib/services/` — External integrations: `discovery.ts` (Google CSE), `enrichment.ts` (Apollo), `gmail.ts`, `personalization.ts` (Groq LLM), `calendar.ts`, `credits.ts`, `ranking.ts`, `email-pattern.ts`, `email-verification.ts` (Emailable)
- `lib/auth.ts` — NextAuth config (Google OAuth, Prisma adapter, database sessions)
- `lib/prisma.ts` — Prisma client singleton

### Key data model

- **Person** — Shared profile data (name, company, role, LinkedIn URL, email + status). Unique on `[fullName, company]`.
- **UserCandidate** — Per-user relationship to Person (email context, outreach status).
- **Search** — Scrape progress tracker (lastCsePageScraped, cseExhausted). Not a results cache.
- **EmailTemplate / EmailDraft / SendLog** — Template → AI draft → sent email audit trail.
- **User** — Auth + profile + credits + Stripe subscription fields.

### Discovery search flow

Three-path UX based on result count:
1. **0 results** → synchronous CSE scrape, then show
2. **1–4 results** → show immediately + background scrape via `POST /api/prescrape`
3. **5+ results** → instant display

`searchPeopleAction` queries Person table directly with offset pagination (stable sort: emailStatus asc, emailConfidence desc, createdAt asc). `scrapeNextPageAction` scrapes one Google CSE page at a time. CSE exhaustion threshold: < 5 valid profiles returned.

### Authentication

Google OAuth via NextAuth 4. Scopes: openid, email, profile, gmail.send, calendar. `gmail.readonly` is temporarily disabled (avoiding Google CASA verification). All sync code is preserved but gated with early returns.

## Database rules

- **Prod and dev share the same database** — migrations must be additive-only (never drop columns/tables)
- Use `prisma db push` (not `prisma migrate dev` — shadow DB issues with Supabase)
- When adding `@updatedAt` to tables with existing rows, add `@default(now())` first
- Connection uses pgbouncer pooling (`?pgbouncer=true&connection_limit=1`)

## Known issues

- Pre-existing build error in `src/components/onboarding/OnboardingClient.tsx` (unescaped apostrophe in JSX)
