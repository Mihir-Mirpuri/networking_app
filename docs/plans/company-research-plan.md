# Company Research Feature — Implementation Plan

## Context

When a user composes a coffee chat email, they currently have no automated way to learn about the recipient's company or team. The existing "Personalize with AI" button is disabled ("Coming Soon") and requires a Chrome extension to scrape LinkedIn — high friction, not shipped. This feature replaces it with an AI-powered company research panel that automatically finds specific, referenceable talking points about the recipient's company, with a role-based bias (e.g., "engineering at Stripe" vs just "Stripe").

**Data reality:** We know company + job title (role) from the Person model, but NOT the specific team/department. For large companies, results will be company-level with a department bias inferred from the role. For small/mid companies, company-level research IS team-level and will be very specific.

## Architecture

```
User opens compose flow (ExpandedReview or ComposeEmailModal)
  → company + role available
  → CompanyResearchPanel auto-triggers researchCompanyAction
  → Server action checks CompanyResearch cache (7-day TTL)
  → Cache miss:
      → Perplexity Sonar API (single call: web search + summarization + citations)
      → Returns 3-5 structured talking points with source URLs
  → Results cached in DB, returned to client
  → User sees talking points, can click "Use" to insert into email body
```

No separate Groq call needed — Perplexity's Sonar handles search + summarization + structuring in one API call with native citation support.

---

## Step 1: Prisma Schema
**File:** `prisma/schema.prisma`

```prisma
model CompanyResearch {
  id            String   @id @default(cuid())
  company       String                        // normalized lowercase
  role          String   @default("")         // department bias (empty = general)
  talkingPoints Json                          // TalkingPoint[]
  rawResponse   String?  @db.Text             // Perplexity raw for debugging
  createdAt     DateTime @default(now())
  updatedAt     DateTime @default(now()) @updatedAt

  @@unique([company, role])
  @@index([company])
}
```

Cache is **global** (not per-user) — company info is the same for everyone, maximizing cache hits when multiple users research the same company.

Run: `prisma db push && npx prisma generate`

---

## Step 2: Company Research Service
**New file:** `src/lib/services/company-research.ts`

### Types

```ts
export interface TalkingPoint {
  point: string;       // "Launched Stripe Billing v2 with usage-based pricing in Jan 2026"
  source: string;      // "TechCrunch"
  sourceUrl: string;   // "https://techcrunch.com/..."
}

export interface CompanyResearchResult {
  company: string;
  talkingPoints: TalkingPoint[];
  fromCache: boolean;
}
```

### Core function: `researchCompany(company, role?, personName?)`

**Perplexity API call** — single `fetch` to `https://api.perplexity.ai/chat/completions`:
- Auth: `Authorization: Bearer ${PERPLEXITY_API_KEY}`
- Model: `sonar` (fast, cheap, includes web search)
- `search_recency_filter: "year"` — bias toward recent results
- `response_format`: JSON schema for structured output

**Prompt with role-based bias:**
```
You are researching a company to help a college student write a personalized
coffee chat email. Find specific, recent, and referenceable information.

Company: ${company}
${role ? `The recipient's role is "${role}" — focus on what the ${inferDepartment(role)}
side of the company has been doing, but include major company-wide news too.` : ''}

Return 3-5 talking points as JSON. Each should be specific enough to reference
in a short email (not generic like "Fortune 500 company"). Prioritize:
1. Recent product launches, features, or announcements
2. Partnerships, acquisitions, or expansions
3. Team achievements, awards, or milestones
4. Notable company culture or values initiatives

For each point include:
- "point": one specific sentence (e.g., "Launched an AI-powered fraud detection tool in Q1 2026")
- "source": publication name (e.g., "TechCrunch")
- "sourceUrl": the URL where this was reported
```

**`inferDepartment(role)` helper** — maps common job titles to departments:
```ts
function inferDepartment(role: string): string {
  const r = role.toLowerCase();
  if (/engineer|developer|swe|sde|devops|infrastructure/i.test(r)) return 'engineering';
  if (/product manager|pm|product lead/i.test(r)) return 'product';
  if (/design|ux|ui/i.test(r)) return 'design';
  if (/market|growth|brand|content/i.test(r)) return 'marketing';
  if (/sales|account|business dev|bd/i.test(r)) return 'sales';
  if (/finance|accounting|controller|treasury/i.test(r)) return 'finance';
  if (/data|analytics|machine learning|ml|ai/i.test(r)) return 'data and AI';
  if (/recruit|talent|people|hr/i.test(r)) return 'people and talent';
  if (/consult|advisory|strateg/i.test(r)) return 'consulting';
  return 'general';
}
```

**Parsing the response:**
- Perplexity returns `choices[0].message.content` (the JSON talking points)
- Perplexity returns `citations` array (URLs) — use to validate/enrich sourceUrls
- Perplexity returns `search_results` array with `{title, url, snippet}` — fallback source data

**Fallback** if Perplexity fails (no API key, error, quota):
- Call Groq `completeJson` (already have wrapper at `@/lib/services/groq`) with same prompt
- Mark results with `source: "General knowledge"` and empty `sourceUrl`
- This uses Groq's training data — no real-time search, but still useful

---

## Step 3: Server Action
**New file:** `src/app/actions/research.ts`

```ts
'use server';

export async function researchCompanyAction(input: {
  company: string;
  role?: string;
  personName?: string;
}): Promise<{ success: true; research: CompanyResearchResult }
           | { success: false; error: string }>
```

**Logic:**
1. Auth check (`getServerSession`)
2. Validate `company` is non-empty
3. Normalize: `company.trim().toLowerCase()`, `role` → `inferDepartment(role)` or `""`
4. Cache lookup: `prisma.companyResearch.findUnique({ where: { company_role } })`
5. If cached and < 7 days old → return `{ ...cached, fromCache: true }`
6. Otherwise → `researchCompany(company, role, personName)`
7. Upsert cache → return results
8. On any error → return `{ success: false, error }` (never throw)

---

## Step 4: UI Component
**New file:** `src/components/compose/CompanyResearchPanel.tsx`

```ts
interface CompanyResearchPanelProps {
  company: string;
  role?: string | null;
  personName?: string;
  onUseTalkingPoint: (point: string) => void;
}
```

**Behavior:**
- `useEffect` triggers `researchCompanyAction` when `company` changes (with 500ms debounce)
- Tracks `status: 'idle' | 'loading' | 'success' | 'error'` and `talkingPoints[]`

**UI states:**

**Loading:**
```
┌─────────────────────────────────────────┐
│ ✨ Researching Stripe...                │
│ [subtle animated dots]                  │
└─────────────────────────────────────────┘
```

**Success (3-5 talking points):**
```
┌─────────────────────────────────────────┐
│ 🔍 About Stripe                        │
│                                         │
│ • Launched Stripe Billing v2 with       │
│   usage-based pricing — TechCrunch      │
│                                    [Use] │
│                                         │
│ • Expanded to 5 new markets in          │
│   Southeast Asia — Bloomberg            │
│                                    [Use] │
│                                         │
│ • Open-sourced their API testing        │
│   framework Sorbet — GitHub Blog        │
│                                    [Use] │
│                                         │
│              [Research again]           │
└─────────────────────────────────────────┘
```

**Error / empty:**
```
┌─────────────────────────────────────────┐
│ Could not find info about Stripe.       │
│ [Try again]                             │
└─────────────────────────────────────────┘
```

- Uses existing `LoadingSpinner` from `src/components/search/LoadingSpinner.tsx`
- Source name is a clickable link to `sourceUrl`
- "Use" button calls `onUseTalkingPoint(point)` — parent handles insertion

---

## Step 5: Integration — ExpandedReview
**Modify:** `src/components/search/ExpandedReview.tsx`

**Replace** the disabled "Personalize with AI" button block (lines ~443-497) with:
```tsx
{currentPerson.company && (
  <CompanyResearchPanel
    company={currentPerson.company}
    role={currentPerson.role}
    personName={currentPerson.fullName}
    onUseTalkingPoint={(point) => {
      // Insert after greeting line
      const lines = body.split('\n');
      const insertIdx = lines.findIndex(l => l.trim() === '') + 1 || 1;
      lines.splice(insertIdx, 0, `\nI saw that ${point} — really cool.\n`);
      setBody(lines.join('\n'));
    }}
  />
)}
```

- Research auto-resets when `currentPerson` changes (navigating between results) — key off `internalIndex`
- Remove Chrome extension state/logic (`extensionInstalled`, `showExtensionModal`, `checkExtension`, `handleScrapeAndPersonalize`, the extension modal JSX)
- Keep `personalizeResult`/`handleUseFoundInfo` logic for now (can be removed in a follow-up)

---

## Step 6: Integration — ComposeEmailModal
**Modify:** `src/components/compose/ComposeEmailModal.tsx`

**Replace** the disabled "Personalize with AI" button block (lines ~619-665) with same `<CompanyResearchPanel>` pattern.

- Trigger: `recipientCompany` state already exists (line 37) — panel renders when it's non-empty
- Same `onUseTalkingPoint` insertion logic as ExpandedReview
- Remove Chrome extension state/logic (`showExtensionModal`, `showPersonalizeModal`, `checkExtension`, `handleScrapeAndPersonalize`, both modal JSX blocks)

---

## Step 7: Environment Config
Add to `.env`:
```
PERPLEXITY_API_KEY=pplx-...
```

---

## Files Summary

| Action | File |
|--------|------|
| Create | `src/lib/services/company-research.ts` |
| Create | `src/app/actions/research.ts` |
| Create | `src/components/compose/CompanyResearchPanel.tsx` |
| Modify | `prisma/schema.prisma` — add `CompanyResearch` model |
| Modify | `src/components/search/ExpandedReview.tsx` — replace personalize button with research panel |
| Modify | `src/components/compose/ComposeEmailModal.tsx` — replace personalize button with research panel |

## Verification

1. `prisma db push` — confirm CompanyResearch table created
2. `npx tsc --noEmit` — no type errors
3. Open search results → expand a person → research panel auto-loads with talking points
4. Click "Use" → talking point sentence inserted into email body
5. Navigate between people → research resets for each new company
6. Open standalone Compose modal → enter company name → research triggers after typing
7. Test with no `PERPLEXITY_API_KEY` → graceful Groq fallback
8. Research same company twice → second time loads from cache (instant)
