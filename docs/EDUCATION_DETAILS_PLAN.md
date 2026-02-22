# Plan: Store Rich Education Data from Apify

## Context

We confirmed Apify returns `description`, `insights`, `skills`, `startDate`/`endDate` on education entries — all silently dropped today. These are valuable for LLM email personalization (activities, thesis topics, awards). We also discovered that `educationDegree`, `educationField`, `educationYear` columns exist on Person but are never populated from scraping.

## Approach

Add a new `educationDetails Json?` column on Person to store the full structured education array. Keep `schools` (string[]) untouched for ILIKE filtering. Also populate the existing `educationDegree`/`educationField`/`educationYear` from the primary education entry.

## EducationDetail JSON shape

```typescript
export interface EducationDetail {
  schoolName: string;         // Raw school name
  normalizedSchool: string;   // After normalizeSchool()
  degree: string | null;
  fieldOfStudy: string | null;
  description: string | null; // Thesis topics, awards
  activities: string | null;  // Parsed from insights "Activities and societies: ..."
  grade: string | null;       // Parsed from insights "Grade: ..."
  startYear: number | null;
  endYear: number | null;
}
```

## Steps

### 1. Prisma schema — `prisma/schema.prisma`
Add after line 116 (`schools Json?`):
```prisma
educationDetails Json?
```
Then run `npx prisma db push` and `npx prisma generate`.

### 2. Expand `ApifyProfileResponse` — `src/lib/services/linkedin-scraper.ts` ~line 222-226
Add `description`, `insights`, `startDate`, `endDate`, `skills` to the education array type. Note: `insights` is a **string** (not array) — e.g. `"Grade: Distinction\nActivities and societies: Debate Club"`.

### 3. Add `EducationDetail` type + `extractEducationDetails()` — same file, after `extractSchools()` (~line 320)
- `parseInsights(insights: string | null)` — split on `\n`, regex match `Grade:` and `Activities and societies:` lines
- `extractEducationDetails(education)` — map each entry to `EducationDetail`, calling `normalizeSchool()` and `parseInsights()`

### 4. Expand `ScrapedProfile` interface — same file ~line 235-248
Add: `educationDegree`, `educationField`, `educationYear`, `educationDetails`

### 5. Update `parseProfile()` — same file ~line 392-449
- Call `extractEducationDetails(raw.education)`
- Set `educationDegree`/`educationField`/`educationYear` from `educationDetails[0]`
- Set `educationDetails` on the return object

### 6. Update `saveScrapedProfile()` — `src/lib/db/person-service.ts` ~line 1410-1547
Three upsert paths (update by URL, update by name, create) — add `educationDegree`, `educationField`, `educationYear`, `educationDetails` to the `data` objects.

### 7. Update fallback ScrapedProfile — `src/app/actions/search.ts` ~line 1429-1444
Add `educationDegree: null`, `educationField: null`, `educationYear: null`, `educationDetails: []` to the fallback object in `lookupPersonAction`.

## What stays unchanged
- `extractSchools()` — still produces `string[]` for the `schools` column
- `getSchoolMatchIds()` — still does `schools::text ILIKE`
- `findPeopleByFilters()` / search result display — no need to select `educationDetails` yet
- `PersonResult` type — unchanged until LLM personalization is wired up

## Verification
1. `npx prisma db push` succeeds
2. `npx tsc --noEmit` passes
3. Search for a new company, check DB:
   ```sql
   SELECT "fullName", "educationDegree", "educationField", "educationYear", "educationDetails"
   FROM "Person" WHERE "educationDetails" IS NOT NULL LIMIT 5;
   ```
4. Confirm `educationDetails` has description, activities, grade, dates
5. Confirm existing school filtering still works
