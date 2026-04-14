# Discovery Pipeline — Unsupported Query Steering

> Paste this into Claude Code to spin up a coordinated agent team that implements the "unsupported query" steering feature end-to-end. Agents communicate with each other via SendMessage to hand off work and unblock dependencies.

---

## Problem

When a user asks for something our LinkedIn scraper can't do (e.g. "find me PhDs at Series B fintech startups making over $200k"), we currently either silently drop the unsupported parts or return bad results. Instead, we should **tell the user what we can't search for and offer a reformulated query we CAN execute with high confidence**.

## What the Scraper CAN Do (Empirically Proven)

Based on 100 test queries (`tests/linkedin-search-research/findings.md`):

**HIGH CONFIDENCE filters:**
- `currentCompanies` (LinkedIn URL) — exact match
- `locations` (full city/state/country name) — metro-area match
- `currentJobTitles` — fuzzy match (returns seniority variants, which is usually fine)
- `functionIds` — accurate for broad categories (engineering, sales, design, etc.)
- `seniorityLevelIds` 200/210/220/300/310/320 — Manager through CXO, accurate
- `schools` (full official name only) — accurate
- `pastCompanies` — accurate, accepts URL or name
- `recentlyChangedJobs` — ~90 days, accurate
- All exclude filters — reliable
- Pagination — stable through page 20+

**MEDIUM CONFIDENCE filters:**
- `searchQuery` — broad keyword match against hidden profile fields. Page 1 is best.
- `companyHeadcount` — approximate, not perfectly exclusive for large companies
- `yearsOfExperienceIds` — LinkedIn's estimate, reasonable but not exact
- `seniorityLevelIds` 110/120 (Entry/Senior) — LinkedIn's automated guess, unreliable as inclusion

## What the Scraper CANNOT Do

These have NO structured filter and cannot be reliably approximated:
- **Industry/sector** (e.g. "fintech", "healthcare" — only via noisy `searchQuery`)
- **Funding stage** (e.g. "Series B", "pre-seed" — no filter at all)
- **Revenue / valuation** (no filter)
- **Degree type** (BS vs MS vs PhD — no filter)
- **Salary / compensation** (no filter)
- **Specific technical skills** with precision (only broad `searchQuery`)
- **Certifications** (no filter)
- **Currently hiring / open to work** (no filter)
- **Remote vs in-office** (no filter)
- **Visa sponsorship** (no filter)
- **Number of connections / followers** (no filter)

---

## Feature Spec

### New Status: `"unsupported"`

When the user's query contains criteria we **cannot** search for, return:

```json
{
  "status": "unsupported",
  "confidence": "high",
  "filters": { ... },
  "linkedin_filters": {},
  "unsupported_criteria": ["PhD degree", "Series B funding stage"],
  "suggested_alternative": {
    "label": "Data scientists at mid-size companies in San Francisco",
    "filters": { "company": null, "role": "Data Scientist", "university": null, "location": "San Francisco" },
    "linkedin_filters": {
      "current_job_titles": ["Data Scientist"],
      "locations": ["San Francisco"],
      "company_headcount": ["E", "F", "G"]
    }
  },
  "message": "I can't filter by degree type (PhD) or funding stage (Series B). Here's the closest search I can run:"
}
```

### Unsupported Criteria Detection Rules

```
UNSUPPORTED_CRITERIA = {
  DEGREE_TYPE: ["PhD", "Masters", "MBA", "BS", "MS", "doctorate", "graduate degree", "undergrad"],
  FUNDING_STAGE: ["Series A", "Series B", "Series C", "Series D", "pre-seed", "seed stage", "IPO", "pre-IPO"],
  COMPENSATION: ["salary", "compensation", "paying", "$XXk", "making over", "earning"],
  VISA: ["visa", "H1B", "sponsorship", "work authorization"],
  REMOTE_WORK: ["remote", "hybrid", "in-office", "work from home", "WFH"],
  HIRING_STATUS: ["hiring", "open roles", "recruiting", "job openings", "open to work"],
  CERTIFICATIONS: ["certified", "CPA", "CFA", "PMP", "AWS certified", "board certified"],
  CONNECTIONS: ["well-connected", "influencer", "thought leader", "many connections"]
}
```

**Key rule:** Industry/sector terms (fintech, biotech, etc.) are NOT `unsupported`. They go to `searchQuery` with a keyword caveat and return `"ready"` with `confidence: "high"`. Reserve `"unsupported"` for things we truly cannot approximate.

### Reformulation Rules

| User says | Unsupported part | Suggested alternative |
|-----------|-----------------|----------------------|
| "PhD data scientists at Google" | "PhD" (degree type) | "Data scientists at Google" (drop degree filter) |
| "engineers at Series B startups" | "Series B" (funding) | "engineers at mid-size companies" (headcount ["D","E"]) |
| "remote engineers at Stripe" | "remote" (work mode) | "engineers at Stripe" (drop remote) |
| "ML engineers making $200k+" | "$200k+" (salary) | "ML engineers" (drop salary) |
| "CFA holders at Goldman" | "CFA" (certification) | "finance people at Goldman Sachs" (function_ids: ["10"]) |
| "H1B engineers at Google" | "visa" | "engineers at Google" (drop visa) |

---

## Agent Team

Create a team with 4 teammates. They communicate via SendMessage to hand off work as dependencies are met.

```
Create an agent team to implement the "unsupported query steering" feature.
Spawn 4 teammates:
- prompt-engineer
- server-action-engineer
- ui-engineer
- qa-engineer

They should coordinate using SendMessage as described below.
```

### Dependency Graph

```
prompt-engineer ──────────┐
                          ├──→ qa-engineer (needs prompt + types to write tests)
server-action-engineer ───┤
                          ├──→ ui-engineer (needs types from server-action-engineer)
                          │
ui-engineer ──────────────┴──→ qa-engineer (re-runs tests after all code lands)
```

---

### Teammate: `prompt-engineer`

**Owns:** `src/lib/prompts/search-extraction-prompt.ts`, `src/lib/prompts/search-extraction-prompt-v2.ts`

**Task:**
1. Read `src/lib/prompts/search-extraction-prompt.ts` thoroughly
2. Read `tests/linkedin-search-research/findings.md` for empirical evidence
3. Add `"unsupported"` to the status enum in the JSON SCHEMA
4. Add `"unsupported_criteria": string[]` and `"suggested_alternative"` object to the schema
5. Insert unsupported criteria detection between steps 2 and 5 in the STATUS DECISION TREE:
   ```
   NEW STEP — Does the query contain criteria we CANNOT filter for?
   Check against UNSUPPORTED_CRITERIA list.
   IF partially/fully unsupported → status: "unsupported", list what we dropped, suggest alternative.
   IF industry term only (fintech, biotech) → status: "ready", put term in searchQuery with caveat. NOT unsupported.
   IF fully supported → continue existing flow.
   ```
6. Add the UNSUPPORTED_CRITERIA keyword list and REFORMULATION rules
7. Add MESSAGE TEMPLATES:
   - `"I can't filter by [criteria]. Here's the closest search I can run:"`
8. Add 5+ EXAMPLES:
   - `"PhD engineers at Google"` → unsupported, suggest "engineers at Google"
   - `"remote data scientists in NYC"` → unsupported, suggest "data scientists in NYC"
   - `"fintech PMs at Stripe"` → ready (NOT unsupported), searchQuery: "fintech" + caveat
   - `"engineers making $200k+ at Meta"` → unsupported, suggest "engineers at Meta"
   - `"MBA consultants at McKinsey"` → unsupported, suggest "consultants at McKinsey"
9. Apply identical changes to `search-extraction-prompt-v2.ts`
10. Keep total prompt under 4,000 words. Do NOT break existing examples.

**When done, send these messages:**
- `message("server-action-engineer", "Prompt updated. New status 'unsupported' added with fields: unsupported_criteria (string[]) and suggested_alternative ({ label, filters, linkedin_filters }). Schema is in search-extraction-prompt.ts — read lines 17-50 for the updated JSON shape.")`
- `message("qa-engineer", "Prompt changes complete in search-extraction-prompt.ts. New status 'unsupported' is live. You can now write and run extraction tests against it. Key: industry terms like 'fintech' should return 'ready' not 'unsupported'. True unsupported = degree type, salary, visa, remote, certs, funding stage, hiring status, connections.")`

---

### Teammate: `server-action-engineer`

**Owns:** `src/app/actions/ai-search.ts`

**Task:**
1. Read `src/app/actions/ai-search.ts` thoroughly
2. Read `src/lib/types/linkedin-filters.ts` if it exists (for type reference)
3. **Wait for message from `prompt-engineer`** with the new schema shape before starting edits
4. After receiving the schema, update `LLMResponse` interface:
   - Add `"unsupported"` to the `status` union
   - Add `unsupported_criteria?: string[]`
   - Add `suggested_alternative?: { label: string; filters: { company: string|null; role: string|null; university: string|null; location: string|null }; linkedin_filters: Record<string, unknown> }`
5. Add new variant to `ExtractFiltersResult`:
   ```typescript
   | {
       success: true;
       status: 'unsupported';
       assistantMessage: string;
       unsupportedCriteria: string[];
       suggestedAlternative: {
         label: string;
         filters: ParsedFilters;
         linkedInFilters: LinkedInFilters;
       };
     }
   ```
6. Add handling in the main function body, between `off_topic` and `needs_selection`:
   ```typescript
   if (status === 'unsupported') {
     const altFilters: ParsedFilters = {};
     const rawAlt = response.content.suggested_alternative;
     if (rawAlt?.filters) {
       if (rawAlt.filters.company) altFilters.company = rawAlt.filters.company;
       if (rawAlt.filters.role) altFilters.role = rawAlt.filters.role;
       if (rawAlt.filters.university) altFilters.university = rawAlt.filters.university;
       if (rawAlt.filters.location) altFilters.location = rawAlt.filters.location;
     }
     const altLinkedIn = convertLinkedInFilters(rawAlt?.linkedin_filters || {});
     // Resolve company URL for the alternative if it has a company
     if (altFilters.company) {
       const resolved = await resolveCompanyUrl(altFilters.company);
       if (resolved.url) altLinkedIn.currentCompanies = [resolved.url];
     }
     return {
       success: true,
       status: 'unsupported',
       assistantMessage: message,
       unsupportedCriteria: response.content.unsupported_criteria || [],
       suggestedAlternative: {
         label: rawAlt?.label || 'Try this instead',
         filters: altFilters,
         linkedInFilters: altLinkedIn,
       },
     };
   }
   ```
7. Do NOT break any existing status handling.

**When done, send these messages:**
- `message("ui-engineer", "Server action updated. New ExtractFiltersResult variant for 'unsupported' status is ready in ai-search.ts. The shape is: { success: true, status: 'unsupported', assistantMessage: string, unsupportedCriteria: string[], suggestedAlternative: { label: string, filters: ParsedFilters, linkedInFilters: LinkedInFilters } }. Company URLs in the alternative are pre-resolved. You can now build the UI.")`
- `message("qa-engineer", "Server action types updated in ai-search.ts. The unsupported status flows through correctly. Ready for integration testing when UI is done.")`

---

### Teammate: `ui-engineer`

**Owns:** `src/components/layout/MainSearchView.tsx`, sidebar rendering components

**Task:**
1. Read how `off_topic` and `needs_selection` are handled in `MainSearchView.tsx` (search for these strings)
2. Read how chat messages with selectables are rendered in the search sidebar components
3. **Wait for message from `server-action-engineer`** with the type shape before starting edits
4. Add handling for `unsupported` status in `handleSendMessage()` (in MainSearchView.tsx), between `off_topic` and `needs_selection`:
   ```typescript
   if (extractResult.status === 'unsupported') {
     setMessages(prev =>
       prev.map(m =>
         m.id === assistantMsgId
           ? {
               ...m,
               content: extractResult.assistantMessage,
               filters,
               unsupportedAlternative: extractResult.suggestedAlternative,
               isLoading: false,
             }
           : m
       )
     );
     setIsExtracting(false);
     return;
   }
   ```
5. Add `unsupportedAlternative` to the message type (wherever chat messages are typed)
6. In the sidebar message rendering, add a block for unsupported alternatives:
   - Show the `assistantMessage` in the normal assistant bubble
   - Below it, render a single highlighted button/card with the `suggestedAlternative.label`
   - Style it with a blue/primary accent to distinguish from `needs_selection` buttons
   - On click: call the search with the pre-built `suggestedAlternative.filters` and `suggestedAlternative.linkedInFilters`
   - The click handler should work the same as when a user clicks a selectable and it triggers a search
7. Do NOT break existing rendering for `off_topic`, `needs_selection`, `ready`, `person_lookup`

**When done, send this message:**
- `message("qa-engineer", "UI changes complete in MainSearchView.tsx. The unsupported status now renders with a message + clickable alternative button. Ready for full end-to-end validation.")`

---

### Teammate: `qa-engineer`

**Owns:** `tests/unsupported-steering-qa.ts`

**Task:**

**Phase 1 — Write tests immediately (don't wait for others):**
1. Read `tests/linkedin-short-quality.ts` for the test harness pattern
2. Create `tests/unsupported-steering-qa.ts` with test cases organized in 4 groups:

**Group A: MUST return "unsupported":**
```
"PhD engineers at Google"                    → unsupported_criteria includes degree
"remote data scientists in NYC"              → unsupported_criteria includes remote
"engineers making $200k+ at Meta"            → unsupported_criteria includes salary
"CFA analysts at Goldman Sachs"              → unsupported_criteria includes certification
"H1B engineers at Google"                    → unsupported_criteria includes visa
"AWS certified DevOps at Amazon"             → unsupported_criteria includes certification
"Series B startup engineers in SF"           → unsupported_criteria includes funding
"engineers at companies that are hiring"     → unsupported_criteria includes hiring
"hybrid PMs at Stripe"                       → unsupported_criteria includes remote/hybrid
"well-connected VPs at Google"               → unsupported_criteria includes connections
```

**Group B: MUST return "ready" (industry terms → searchQuery, NOT unsupported):**
```
"fintech PMs at Stripe"                      → ready, searchQuery includes "fintech"
"biotech researchers in Boston"              → ready, searchQuery includes "biotech"
"healthtech engineers at Google"             → ready, searchQuery includes "healthtech"
"edtech designers at Coursera"               → ready, searchQuery includes "edtech"
```

**Group C: Regression tests (existing behavior unchanged):**
```
"software engineers at Google"               → ready
"PMs at Meta in NYC"                         → ready
"consultants at MBB"                         → needs_selection
"how's the weather?"                         → off_topic
"Find John Smith at Google"                  → person_lookup
"designers at Figma"                         → ready
"directors at Amazon"                        → ready
"MIT grads at Stripe"                        → ready, schools: ["Massachusetts Institute of Technology"]
"senior engineers at Uber"                   → ready, exclude_seniority_level_ids: ["110"]
```

**Group D: Edge cases:**
```
"MBA consultants at McKinsey"                → unsupported, suggested keeps "consultants at McKinsey"
"Stanford MBA PMs at Google"                 → unsupported, suggested keeps school: "Stanford University", drops MBA
"senior remote engineers at Uber"            → unsupported, suggested: "senior engineers at Uber"
"fintech Series B startup PMs in NYC"        → unsupported (Series B), suggested includes searchQuery: "fintech"
```

**Validation per test:**
- `status` matches expected
- For unsupported: `unsupported_criteria` lists correct items, `suggested_alternative` has valid filters
- For ready: no regression in filters/linkedin_filters
- Anti-patterns never occur: seniority "120"/"110" as inclusion, company in searchQuery, school abbreviations

3. Run tests: `npx tsx tests/unsupported-steering-qa.ts`
4. Print pass/fail table. Exit code 1 if any failure.

**Phase 2 — After receiving messages from all 3 teammates:**
Wait for messages from `prompt-engineer`, `server-action-engineer`, and `ui-engineer` confirming their work is done. Then:
1. Re-run the test suite: `npx tsx tests/unsupported-steering-qa.ts`
2. Also run the existing regression suite: `npx tsx tests/linkedin-short-quality.ts --extract-only`
3. If any tests fail, message the responsible teammate:
   - Prompt issues → `message("prompt-engineer", "Test [X] failed: expected [Y] got [Z]. The unsupported criteria detection missed [detail].")`
   - Type/action issues → `message("server-action-engineer", "Test [X] failed: [detail about the server action response].")`
   - UI won't be testable from this harness, but flag if the types don't match
4. Report final results. If all pass, `broadcast("All tests pass. Feature is ready.")`

---

## How to Run

Paste this into Claude Code:

```
Create an agent team to implement the "unsupported query steering" feature
described in docs/discovery-qa-team-prompt.md.

Spawn 4 teammates: prompt-engineer, server-action-engineer, ui-engineer, qa-engineer.

Each teammate should read docs/discovery-qa-team-prompt.md for their full instructions
under their named section.

They should communicate via SendMessage when they complete their work to unblock
downstream teammates. The dependency graph is:
- prompt-engineer → server-action-engineer (needs schema) → ui-engineer (needs types)
- prompt-engineer → qa-engineer (needs prompt to test against)
- All three → qa-engineer (final validation run)

Start prompt-engineer and qa-engineer immediately (they can work in parallel).
server-action-engineer waits for prompt-engineer.
ui-engineer waits for server-action-engineer.
qa-engineer writes tests immediately, then re-runs after all others finish.
```

## Success Criteria

- **prompt-engineer:** Prompt updated, all existing examples still produce same output, 5+ new unsupported examples
- **server-action-engineer:** `unsupported` status handled cleanly, types compile, company URL resolved in alternative
- **ui-engineer:** Unsupported message + clickable alternative renders, existing statuses unchanged
- **qa-engineer:** All 30+ test cases pass. Zero regressions. Zero false positives. Zero false negatives.

## Files Modified

```
src/lib/prompts/search-extraction-prompt.ts      # prompt-engineer
src/lib/prompts/search-extraction-prompt-v2.ts    # prompt-engineer
src/app/actions/ai-search.ts                      # server-action-engineer
src/components/layout/MainSearchView.tsx           # ui-engineer
tests/unsupported-steering-qa.ts                   # qa-engineer
```

## Evidence Base

All rules backed by empirical research (100 LinkedIn scraper queries):
- `tests/linkedin-search-research/findings.md` — what works, precision rates
- `tests/linkedin-search-research/LINKEDIN_SEARCH_SYSTEM_PROMPT.md` — full parameter reference
- `tests/linkedin-search-research/EVIDENCE.md` — rule → query number mapping
