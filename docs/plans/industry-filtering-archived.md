# Industry Filtering — Archived

**Status:** Removed on 2026-04-07. Not in active use.

## Why it was removed

1. The Haiku prompt populated `industryIds` from a hardcoded bundle map
   (e.g., "fintech" → ["43", "4"]) that used broken OR semantics. LinkedIn's
   multi-ID industry filter is a union, not an intersection, and every
   company has exactly one primary industry — so asking for "Financial
   Services + Software Development" returned Chase + Microsoft, not
   fintech companies. True fintech companies get classified under just
   [43] anyway.

2. Every search narrows to exactly one company by design (see
   ai-search.ts SYSTEM_PROMPT, "A search requires exactly ONE company").
   Once a company is set, layering industry filtering on top is either
   a no-op or an over-constraint that can return zero results when
   LinkedIn's classification disagrees with the bundle's assumption.

## How it used to work

- **Input source:** Haiku (`extractFiltersAction` in src/app/actions/ai-search.ts)
- **Prompt rule:** A bundle map hardcoded in the SYSTEM_PROMPT —
  "tech" → ["4","6","96"], "finance" → ["43","44","46","47","48"],
  "fintech" → ["43","4"], "healthcare" → ["133","135","137"].
- **Path to LinkedIn:** Haiku → `linkedin_filters.industry_ids` →
  `convertLinkedInFilters` (snake → camel) → `LinkedInFilters.industryIds` →
  spread into `searchLinkedInShort({...linkedInFilters})` → Apify actor
  `harvestapi/linkedin-profile-search` → LinkedIn native filter
- **Exclude variant:** Same path for `excludeIndustryIds`, never
  meaningfully used in the prompt.
- **One gate:** `hasAdvancedFilters` boolean in src/app/actions/search.ts
  included `industryIds?.length` as one of 8 conditions that selected
  the advanced (direct-API) search path over the DB-first legacy path.
- **Dev display:** src/app/dev/filter-playground/page.tsx had an
  `INDUSTRY_MAP` (ID → label) for visualizing which industries a search
  had selected. Dev-only, no user-facing impact.

## Reference data

The full 434-entry LinkedIn industry taxonomy (with hierarchy and
descriptions) lives at
https://github.com/HarvestAPI/linkedin-industry-codes-v2 — the file
`linkedin_industry_code_v2_all_eng.json` previously sat at the repo
root but was never imported by code and has been deleted alongside this
removal.

## If you want to bring it back

An earlier plan proposed using Claude Haiku to pick the best single
industry ID from the 434-entry taxonomy, optionally assisted by an
embedding matcher (embed all 434 `label + hierarchy + description`
strings once, cosine-rank against the user query, let Haiku pick from
the top-K shortlist). This was discussed and abandoned because
industry filtering doesn't add narrowing value once a specific
company is selected. If you ever relax the one-company constraint and
introduce industry-mode searches (e.g., "PMs in biotech in Boston"
without naming a specific company), the embedding-matcher approach is
the right starting point.

## Layers that were removed

- `src/app/actions/ai-search.ts` — LLMResponse type fields, prompt rule,
  example, converter lines
- `src/app/dev/filter-playground/action.ts` — duplicated prompt rule,
  example, converter
- `src/lib/types/linkedin-filters.ts` — `industryIds`, `excludeIndustryIds`
- `src/lib/services/linkedin-search.ts` — actor param type, directMappings
- `src/app/actions/search.ts` — `hasAdvancedFilters` condition
- `src/app/dev/filter-playground/page.tsx` — INDUSTRY_MAP and display branch
- `linkedin_industry_code_v2_all_eng.json` — deleted
