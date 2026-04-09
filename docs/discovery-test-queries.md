# Discovery Pipeline Test Queries

## Purpose

These queries exercise every branch, decision point, and distinct LLM behavior in the discovery pipeline (`extractSearchFiltersAction` → `searchPeopleV2Action`). Run them with the discovery logger enabled and inspect the JSONL output to verify each expected behavior.

## How to run

```bash
DISCOVERY_LOGGER_ENABLED=1 npm run dev
# Optional: also print a colorized mirror to the terminal
DISCOVERY_LOGGER_ENABLED=1 DISCOVERY_LOGGER_CONSOLE=1 npm run dev
```

1. Open the UI.
2. Run each query from the sections below, one at a time (new conversation per query unless a section explicitly says "multi-turn").
3. For each query, locate the latest JSONL file under `logs/discovery/` and verify the expected outcome.

## Query count: 55

### Why 55?

The pipeline has roughly 50 distinct, testable behaviors (4 statuses × sub-branches, 17 LinkedIn filter fields, 8 seniority levels, 6 function mappings, 6 location patterns, 8 anti-category patterns, 3 search paths, 4 conversation-context behaviors, 3 company URL resolution paths, etc.). 55 queries cover each behavior at least once with ~5 queries of robustness buffer for edge cases. Fewer would miss branches; significantly more would duplicate coverage without adding signal.

Natural language is infinite, but the pipeline's decision surface is not. Our goal is **behavioral coverage**, not input fuzzing.

---

## Section 1 — Smoke: status branches (5 queries)

One query per top-level LLM status to confirm branch routing.

| # | Query | Expected status | Key log entries |
|---|---|---|---|
| 1 | `people at Stripe` | `ready` | `log.info 'Returning ready'`, `log.info 'Company URL resolved'` (DB cache hit likely) |
| 2 | `consultants at MBB` | `needs_selection` | `log.decision 'needs_selection branch'`, confidence `high`, NO Perplexity escalation |
| 3 | `engineers at YC companies` | `needs_selection` | `log.decision 'Escalating to Perplexity'`, Perplexity `llm` entry, ~5 Perplexity selectables |
| 4 | `find Jane Doe at Google` | `person_lookup` | `log.decision 'person_lookup branch'`, `personName="Jane Doe"`, `personCompany="Google"` |
| 5 | `what's the weather today?` | `off_topic` | `log.decision 'off_topic branch'` |

---

## Section 2 — Role normalization (4 queries)

Verify informal role terms are normalized to LinkedIn-standard titles before being placed in `searchQuery`.

| # | Query | Expected normalized role |
|---|---|---|
| 6 | `PMs at Meta` | `Product Manager` |
| 7 | `SWEs at Amazon` | `Software Engineer` |
| 8 | `quants at Jane Street` | `Quantitative Researcher` |
| 9 | `Software Engineer at Netflix` | `Software Engineer` (kept as-is) |

---

## Section 3 — Location mapping (6 queries)

Verify location extraction covers US abbreviations, state names, international cities, and regional descriptors.

| # | Query | Expected `parsedFilters.location` / `linkedInFilters.locations` |
|---|---|---|
| 10 | `PMs at Google in SF` | `San Francisco, California` / `["San Francisco"]` |
| 11 | `engineers at Meta in NYC` | `New York, New York` / `["New York"]` |
| 12 | `designers at Airbnb in Bay Area` | region / `["San Francisco Bay Area"]` |
| 13 | `PMs at Spotify in Stockholm` | `Stockholm, Sweden` / `["Stockholm"]` |
| 14 | `engineers at DeepMind in London` | `London, United Kingdom` / `["London"]` |
| 15 | `engineers at Apple in California` | state only — `California` |

---

## Section 4 — Seniority levels (7 queries)

Cover every entry in the `seniority_level_ids` mapping table. Each should produce the documented ID set in `linkedInFilters.seniorityLevelIds`.

| # | Query | Expected `seniorityLevelIds` |
|---|---|---|
| 16 | `junior PMs at Google` | `["110"]` |
| 17 | `senior SWEs at Citadel` | `["120"]` |
| 18 | `staff engineers at Stripe` | `["120","130"]` |
| 19 | `engineering managers at Meta` | `["200","210"]` |
| 20 | `engineering directors at Amazon` | `["220"]` |
| 21 | `VPs of engineering at Salesforce` | `["300"]` |
| 22 | `CTO at OpenAI` | `["310"]` |

---

## Section 5 — Function IDs (5 queries)

Cover common `function_ids` mappings. Each should populate `linkedInFilters.functionIds` with the correct ID.

| # | Query | Expected `functionIds` |
|---|---|---|
| 23 | `engineers at Microsoft` | `["8"]` (Engineering) |
| 24 | `designers at Figma` | `["3"]` (Arts and Design) |
| 25 | `salespeople at Salesforce` | `["25"]` (Sales) |
| 26 | `marketers at Nike` | `["15"]` (Marketing) |
| 27 | `recruiters at Google` | `["12"]` (Human Resources) |

---

## Section 6 — Other LinkedIn filter fields (5 queries)

Fields not covered above. Each tests one distinct filter field.

| # | Query | Expected field |
|---|---|---|
| 28 | `engineers at Google with 3-5 years experience` | `yearsOfExperienceIds: ["3"]` |
| 29 | `PMs at Meta who recently joined` | `recentlyChangedJobs: true` |
| 30 | `engineers at Stripe who used to work at Google` | `pastCompanies: ["Google"]` |
| 31 | `SWEs at Microsoft from Stanford` | `schools: ["Stanford University"]` |
| 32 | `people with title "Chief of Staff" at Anthropic` | `currentJobTitles: ["Chief of Staff"]` (quoted → exact match, NOT searchQuery) |

---

## Section 7 — Exclusion filters (3 queries)

Exercise all 4 supported exclusion fields (2 combined in one query).

| # | Query | Expected exclude field |
|---|---|---|
| 33 | `senior engineers at Google but not in California` | `excludeLocations: ["California"]`, `seniorityLevelIds: ["120"]` |
| 34 | `PMs at Meta, not in sales functions` | `excludeFunctionIds: ["25"]` |
| 35 | `engineers at Stripe, not managers` | `excludeSeniorityLevelIds: ["200","210"]` |

> `excludeCurrentCompanies` is covered implicitly when the user negates a specific company in multi-company queries.

---

## Section 8 — Anti-category rule (8 queries)

Every category listed in the ANTI-CATEGORY RULE section of the system prompt must trigger `needs_selection`. Some are "confident" (model knows the canonical list, no Perplexity) and others escalate to Perplexity.

| # | Query | Expected status / confidence / Perplexity |
|---|---|---|
| 36 | `engineers at FAANG` | `needs_selection` / `high` / no |
| 37 | `associates at Big 4` | `needs_selection` / `high` / no |
| 38 | `analysts at bulge bracket` | `needs_selection` / `high` / no |
| 39 | `lawyers at magic circle firms` | `needs_selection` / `high` / no |
| 40 | `PMs at fintech startups` | `needs_selection` / `low` / **yes** |
| 41 | `engineers at AI startups in SF` | `needs_selection` / `low` / **yes** |
| 42 | `engineers at Series A companies` | `needs_selection` / `low` / **yes** (keyword-triggered) |
| 43 | `designers at unicorns` | `needs_selection` / `low` / **yes** (keyword-triggered) |

Verify query #40–43 contain a Perplexity `llm` entry in the JSONL and that company LinkedIn URLs are pre-cached (`[AI Search] Pre-caching N company LinkedIn URLs`).

---

## Section 9 — Company ambiguity (2 queries)

Verify the `company_name_ambiguous` flag toggles correctly.

| # | Query | Expected `company_name_ambiguous` |
|---|---|---|
| 44 | `engineers at Chase` | `true` |
| 45 | `PMs at Ramp` | `true` |

> Distinctive names (Stripe, Google, Anthropic) are covered implicitly by queries in earlier sections — they should produce `false` or omit the flag.

---

## Section 10 — Conversation context (4 queries, MULTI-TURN)

**Run these as a single continuous conversation in the UI**, in order. Each turn tests a distinct context-carry behavior.

| Turn | Query | Expected behavior |
|---|---|---|
| 46 | `PMs at Google` | Establishes baseline filters: company=Google, role=Product Manager |
| 47 | `and in NYC` | **Add** location filter while keeping company + role |
| 48 | `engineers instead` | **Replace** role (company + location preserved) |
| 49 | `try Meta instead` | **Replace** company (role + location preserved) |

Verify each turn's `log.info 'Received query'` shows `currentFilters` carrying forward correctly.

---

## Section 11 — Person lookup variants (2 queries)

Query #4 (in smoke) already covers full name + company. These cover the remaining cases.

| # | Query | Expected |
|---|---|---|
| 50 | `look up Sundar Pichai` | `person_lookup`, personName set, personCompany undefined |
| 51 | `find John` | `off_topic` (single name triggers fallback) |

---

## Section 12 — Search path coverage (1 query)

Advanced path and simple-DB-sufficient path are covered implicitly by earlier queries (any query with seniority/function hits the advanced path; well-known companies like Google hit DB-sufficient). The **simple + DB insufficient → LinkedIn Short** path is hardest to trigger naturally, so add one dedicated query.

| # | Query | Expected |
|---|---|---|
| 52 | `engineers at Supahands` | `log.decision 'Simple path taken'`, `log.decision 'DB insufficient — calling LinkedIn Short'`, `log.api 'apify-linkedin-short'` entry |

> If Supahands is already populated in your DB, substitute another obscure real company (any bootstrapped startup <50 people outside your seed data).

---

## Section 13 — Prompt cache validation (2 queries, SEQUENTIAL)

Run these **back-to-back within 5 minutes** to verify Anthropic prompt caching is working.

| # | Query | Expected cache stats in Anthropic `llm` entry |
|---|---|---|
| 53 | `senior PMs at Stripe in NYC` (first run) | `cacheCreationTokens > 0`, `cacheReadTokens == 0` |
| 54 | `senior PMs at Stripe in NYC` (second run, immediately after) | `cacheCreationTokens == 0`, `cacheReadTokens > 0`, `costUsd` dramatically lower |

Also verify the `run_end` summary's `cacheStats` reflects the difference. If cache read shows 0 on the second run, either the cache window expired (>5 min) or cache_control isn't taking effect.

---

## Section 14 — Edge cases (4 queries)

Stress-test robustness.

| # | Query | Expected |
|---|---|---|
| 55 | `I'm looking for really experienced product managers who have been working at Stripe for more than 5 years ideally in New York City and who went to like MIT or Stanford` | `ready` — long rambling query correctly extracts company=Stripe, role=Product Manager, location=New York, schools=[Stanford, MIT], yearsOfExperience=5+ |
| 56 | `enginers at Gogole` | Either `ready` with corrected values (model handles typos), or `off_topic`. Document whichever happens. |
| 57 | `PMs chez Google à Paris` | `ready` — multilingual query should still extract company=Google, role=Product Manager, location=Paris, France |
| 58 | `find me a cofounder who juggles` | `off_topic` — friendly redirect |

---

## Verification checklist

After running all 55 queries, verify:

- [ ] Every query produced a JSONL file under `logs/discovery/`
- [ ] Every `run_end` entry has `status: "success"` or an explainable `status: "error"`
- [ ] Every Anthropic `llm` entry contains `systemPrompt`, `userPrompt`, `rawResponse`, `parsedResponse`, and token counts
- [ ] Every Perplexity `llm` entry has `costUsd ≈ 0.005`
- [ ] Every Apify `api` entry has `costUsd ≈ 0.10 × takePages`
- [ ] Query #54 shows `cacheReadTokens > 0` (proving prompt caching works)
- [ ] At least one query in Section 8 (#40–43) contains a Perplexity `llm` entry
- [ ] Query #52 contains a LinkedIn Short `api` entry
- [ ] Every branch (`ready`, `needs_selection`, `person_lookup`, `off_topic`) appears at least once in `decision` entries across the full run
- [ ] `totalCostUsd` in `run_end` matches the sum of `costBreakdown` values

## Known low-coverage areas

These behaviors are intentionally NOT covered by dedicated queries because they are difficult or impossible to trigger through natural-language input alone:

1. **`companyHeadcount` filter** — only set when status=ready AND the user specifies both a company and a size. In practice, if the user names a company, the size is implied; if they say "large tech companies," the anti-category rule triggers `needs_selection`. May surface in post-selection multi-turn flows.
2. **`yearsAtCurrentCompanyIds`** — requires phrasing like "people who just joined X 6 months ago" which is rare.
3. **`excludeCurrentCompanies`** — only triggered by unusual phrasing like "consultants but not at McKinsey."
4. **`linkedin-filter-validator` drops** — only fires when the LLM hallucinates an invalid ID. Cannot be deterministically reproduced. If it occurs during normal testing, verify a `log.warn` entry appears.
5. **`status: "blocked"`** — requires the user to have hit their free limit, which is a state-dependent test.
