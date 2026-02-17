# Signl — App Context

## What It Does

Signl is a networking outreach tool for college students and recent grads targeting finance, consulting, and PM roles. It helps users discover professionals at target companies (especially alumni from their university), generate personalized emails, and send them via Gmail.

## Core Flow

1. **User searches** by company (required) + optional role, university, location
2. **App discovers people** via Google Custom Search → LinkedIn scraping → email enrichment
3. **Results shown** with pre-drafted emails using templates
4. **User reviews and sends** individually or in bulk via their Gmail account
5. **Outreach tracked** with status updates, reminders, and Gmail thread syncing

## Tech Stack

- **Framework:** Next.js 14 (App Router), TypeScript
- **Database:** PostgreSQL on Supabase, accessed via Prisma ORM
- **Auth:** NextAuth with Google OAuth
- **Payments:** Stripe (Pro tier)
- **Deployment:** Prod and dev share the same database

## Data Model (Key Tables)

| Table | Purpose |
|---|---|
| **Person** | Shared pool of discovered professionals (name, company, role, LinkedIn URL, email, education, location). One person can be linked to many users. |
| **UserCandidate** | User ↔ Person relationship. Stores per-user email overrides, doNotShow flag, and links to email drafts. |
| **Search** | Scrape progress tracker per query. Tracks `lastCsePageScraped` and `cseExhausted` to avoid redundant API calls. |
| **CompanyEmailPattern** | Learned email patterns per company (e.g., `first.last@gs.com`). Stores confidence, sample size, catch-all/unverifiable flags. |
| **OutreachTracker** | CRM-like lifecycle tracking (NOT_STARTED → SENT → RESPONDED → HAD_CALL, etc.). Reminders, notes, Gmail thread linking. |
| **EmailDraft** | Pre-generated email per UserCandidate. Status: APPROVED, EDITED, SENT. |
| **conversations / messages** | Synced Gmail threads and individual messages for outreach tracking. |

## Discovery & Enrichment Pipeline

### Phase 1: Discovery (Google CSE)
- Searches for LinkedIn profile URLs matching company/role/university
- Returns ~10 URLs per page, paginated via `start` param

### Phase 2: Scraping (Apify)
- Scrapes LinkedIn profiles for name, company, role, location, education
- Batches of 10, processed sequentially with streaming DB saves
- School name normalization (e.g., "Wharton" → "University of Pennsylvania")

### Phase 3: Email Enrichment
- **Pattern-based generation:** Learns patterns from 3+ known emails at a company, then generates for new people
- **Apollo.io fallback:** If no pattern exists, calls Apollo for 5 people to bootstrap the pattern + get verified emails
- **Email verification (Emailable):** Only for newly bootstrapped patterns. Established patterns are trusted. Skip for known catch-all/unverifiable domains.

## Search Action Flow (`searchPeopleAction`)

```
Query DB with filters (company, role, university, location)
  ├── excludes sent/hidden people + already-displayed IDs
  │
  ├── If < 5 results: check CSE scrape progress
  │   ├── PATH A (0 results, CSE has pages): sync scrape → re-query DB
  │   └── 1-4 results: return as-is, set cseHasMorePages=true
  │
  ├── 5+ results: return as-is
  │
  ├── Rank by role match (Jaccard similarity) + email quality
  ├── Generate email drafts from templates
  │
  ├── hasMore = people.length >= limit || cseHasMorePages
  └── Fire prescrape (background, up to 3 CSE pages)
```

### Prescrape
- Fire-and-forget after every search via `/api/prescrape`
- Loops up to 3 additional CSE pages sequentially
- Each page: discover → scrape → save to DB → generate emails
- Stops early if CSE returns < 5 valid URLs (exhausted)
- Populates DB so future Load More clicks are instant

### Pagination
- Load More sends `excludePersonIds` (all currently displayed IDs) to avoid duplicates
- `hasMore` combines DB heuristic (full page returned) with CSE state (more pages to scrape)

## External Services

| Service | Purpose | Key Detail |
|---|---|---|
| **Google CSE** | Discover LinkedIn URLs | 10 results/page |
| **Apify** | Scrape LinkedIn profiles | Actor `LpVuK3Zozwuipa5bp`, 10/batch |
| **Apollo.io** | Email enrichment + pattern bootstrap | 300ms rate limit between calls |
| **Emailable** | Email deliverability verification | Skipped for catch-all/unverifiable domains |
| **Gmail API** | Send emails, sync threads | 30/day limit, 10/batch, supports attachments |
| **Google Calendar** | Create events from meeting suggestions | AI extraction via GROQ |
| **Stripe** | Pro subscriptions | Webhook at `/api/webhooks/stripe` |
| **GROQ (Llama 3.1)** | AI email personalization | Uses resume summary + person context |

## Pages & Routing

| Route | Purpose |
|---|---|
| `/` | Main search interface (requires auth + onboarding) |
| `/onboarding` | User profile setup (school, major, career interests) |
| `/profile` | Settings, resume upload, custom email templates |
| `/history` | Email send log |
| `/calendar` | Calendar view with AI-extracted meeting suggestions |
| `/auth/signin` | Google OAuth login |

## Server Actions (`src/app/actions/`)

| Action | Purpose |
|---|---|
| `searchPeopleAction` | Main search: DB query → optional sync scrape → rank → return |
| `prescrapeAction` | Background: scrape up to 3 CSE pages to populate DB |
| `hidePersonAction` | Mark person as doNotShow for this user |
| `sendEmailsAction` | Batch send via Gmail (max 10, checks daily limit) |
| `sendSingleEmailAction` | Send one email |
| `sendFollowUpAction` | Reply to existing Gmail thread |
| `scheduleEmailAction` | Schedule email for future send |
| `generatePersonalizedEmailAction` | AI-generated email via GROQ |
| `getOutreachTrackersAction` | Fetch all contacts with status |
| `updateOutreachTrackerAction` | Update outreach status, notes, interaction |
| `setReminderAction` | Set follow-up reminder |

## Key Constants

- **Daily send limit:** 30
- **Batch send limit:** 10
- **Scrape threshold:** 5 (below this, check CSE state)
- **Max prescrape pages:** 3
- **CSE exhaustion threshold:** < 5 valid URLs per page
- **Apollo rate limit:** 300ms between calls
- **Pattern min sample size:** 3 emails to establish confidence
- **Scrape progress TTL:** 7 days before resetting

## Company & University Lists

- **Banking:** Goldman Sachs, Morgan Stanley, JPMorgan, etc. (24 firms)
- **Consulting:** MBB, Big 4, etc. (13 firms)
- **PM:** Google, NVIDIA, Microsoft, etc. (11 firms)
- **Universities:** 140+ schools (Ivy League, top publics, target schools)

## Important Codebase Notes

- Prod/dev share the same DB — migrations must be additive-only (no drops)
- Use `prisma db push` (not `migrate dev`) due to Supabase shadow DB issues
- `@updatedAt` on tables with existing rows requires `@default(now())` first
- SearchPerson junction table exists in schema but is unused by code (kept for compatibility)
- `TEST_MODE=true` logs emails instead of sending
- No test framework — tests use `npx tsx` with manual assertions
