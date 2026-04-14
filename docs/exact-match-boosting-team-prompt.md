# Agent Team Prompt: Exact Match vs Semantic Neighbor Disambiguation

Create an agent team to fix our search result confidence problem.
Use the researcher, engineer, and qa-engineer agents.

THE PROBLEM:
Our people search uses pgvector cosine distance to match role titles.
A search for "Software Engineer at Stripe" returns "Backend Engineer"
at distance ~0.15, which looks like a great semantic match — but it's
NOT what the user asked for. The real software engineers haven't been
scraped into the DB yet.

The system confidently displays adjacent roles as if they're exact
matches. Users see "Backend Engineer" and think we found their
software engineers. There is no signal that says "this is the best
we have, not what you actually wanted."

The DB is populated incrementally by past scrapes. So at query time,
the vector path returns whatever is closest — which might be a
genuinely good match OR the least-bad option from an incomplete dataset.
The system cannot currently tell the difference.

THE GOAL:
When a user searches for a role, they should see:
1. Exact and near-exact title matches FIRST, clearly prioritized
2. Semantic neighbors (related but different roles) presented
   with lower confidence or in a separate tier
3. Clear signaling when we don't have exact matches yet —
   the user should know that a scrape is still running and
   better results may be incoming

This is about TRUST. Users must never feel misled by results.

PHASE 1 — RESEARCHER INVESTIGATES

Researcher:
- Read src/lib/db/person-service.ts end to end, focusing on
  findPeopleByFilters and findPeopleByFiltersVector
- Read src/lib/services/embeddings.ts — understand the embedding
  model (text-embedding-3-small, 1536 dims) and caching layers
- Read src/app/actions/search.ts — understand the three-path UX
  (0 results → scrape, 1-4 → show + background scrape, 5+ → instant)
- Read src/lib/prompts/search-extraction-prompt.ts — understand
  how roleSpecificity (narrow/standard/broad) is determined
- Read the prescrape API route and understand the timing: when does
  the background scrape run, how long does it take, when do new
  results become available?

Then run these queries against the real DB:
- For 10 common role titles (Software Engineer, Product Manager,
  Data Scientist, Designer, Analyst, SWE, PM, etc.), run the
  current vector search and categorize every result as:
  - EXACT: title matches the search term (case-insensitive)
  - NEAR-EXACT: title is a seniority/level variant (Senior Software
    Engineer, Staff Software Engineer, Software Engineer II)
  - SEMANTIC NEIGHBOR: different title but semantically related
    (Backend Engineer, Full Stack Developer for "Software Engineer")
  - FALSE POSITIVE: unrelated role that snuck through the threshold
- For each, record the cosine distance. Find the distance boundaries:
  - What distance range do EXACT matches fall in?
  - What distance range do NEAR-EXACT matches fall in?
  - Where does the boundary between NEAR-EXACT and SEMANTIC NEIGHBOR lie?
  - Is there a clean threshold, or is it fuzzy per role?
- Test whether simple SQL ILIKE on the role column could reliably
  identify exact/near-exact matches as a complement to vector search
- Investigate: does the roleSpecificity bucket (narrow/standard/broad)
  from the search extraction prompt correlate with the exact vs
  neighbor problem? Are "narrow" roles more susceptible?

Then propose a design. Consider these approaches (and any others):
1. **Exact-match boosting** — run ILIKE first to find exact/near-exact
   title matches, then fill remaining slots with vector results.
   Score: exact=1.0, near-exact=0.9, vector=1-distance
2. **Two-tier display** — return results tagged with a match tier
   (exact/similar) so the frontend can render them differently
3. **Tighter thresholds + scrape signaling** — reduce the vector
   threshold so only very close matches appear, and add a
   "searching for more results..." indicator when the scrape is
   still running
4. **Hybrid scoring** — combine ILIKE substring match (binary) with
   vector distance into a composite score that heavily weights
   exact text matches

The design MUST:
- Not break or slow down the existing search flow
- Work with the incremental scrape model (results improve over time)
- Return enough metadata for the frontend to signal confidence
- Be implementable as a new function alongside the existing one
- Minimize latency — the current vector path must not get slower

Share the full design with Engineer, including:
- Exact function signature and return type (must include match tier
  or confidence score per result)
- SQL query structure
- How scoring/ranking works
- What the frontend needs from the response to render tiers

PHASE 2 — ENGINEER IMPLEMENTS

Engineer:
- Wait for the Researcher's design before writing code
- Read the files Researcher referenced to understand codebase style
- Implement as a NEW function (e.g. findPeopleByFiltersV3) in
  person-service.ts — do NOT modify existing functions
- The return type must include a match quality signal per result.
  Options (Researcher will specify):
  - `matchTier: 'exact' | 'near_exact' | 'similar'`
  - `matchScore: number` (0-1, where 1 = perfect match)
  - Or both
- If the design uses a two-pass approach (ILIKE then vector),
  ensure total latency stays under the current single-pass time.
  Use Promise.all for parallel queries where possible.
- If the design needs new indexes (e.g., trigram index on role
  column for faster ILIKE), write the migration separately
- When done, tell QA Engineer the function name, file location,
  and the new return type fields

PHASE 3 — QA TESTS (PRODUCTION-GRADE)

QA Engineer:
- Wait for Engineer to say the function is ready
- Follow your full test methodology from your agent instructions
- This feature's critical test axis is ROLE MATCHING ACCURACY.
  The entire point is distinguishing exact from similar. Design
  tests accordingly.

**Core validation (run for every test case):**
For each result returned by the new function, manually verify:
- Is the matchTier/matchScore correct?
- Would a user looking at this result feel it matches their search?
- Are exact matches ranked above semantic neighbors?

**Test categories — minimum 290 cases:**

Role tier accuracy (100 cases minimum):
- 15 common titles: verify exact matches get tier "exact"
- 15 seniority variants: "Senior X", "Staff X", "Lead X" should
  get tier "near_exact" when searching for "X"
- 15 abbreviation searches: "SWE" → should find "Software Engineer"
  as exact/near-exact, NOT as a semantic neighbor
- 15 semantic neighbor pairs: search "Software Engineer", verify
  "Backend Engineer" gets tier "similar" not "exact"
- 15 adjacent-but-different: search "Product Manager", verify
  "Project Manager" is NOT labeled as exact
- 15 broad terms: "Engineer" — verify tier assignment across the
  range of engineer subtypes returned
- 10 titles that don't exist in DB: verify the function returns
  only semantic neighbors (no false exact matches) and tiers
  them correctly

Cross-filter with tier verification (80 cases):
- Role + Company (30): verify tiers stay accurate when company
  filter narrows the pool
- Role + Location (25): same
- Role + Company + Location (15): same
- Full stack with university (10): same

Ranking correctness (30 cases):
- For each query, verify exact matches appear before near-exact,
  and near-exact before similar
- Verify that within each tier, results are ordered sensibly
  (by email status, then confidence, consistent with current sort)

Edge cases (30 cases):
- Zero exact matches, some semantic neighbors — verify tiers
- Zero results at all — verify empty response
- Only exact matches exist — verify no phantom similar results
- Role filter is very broad ("Manager") — verify tier assignment
  when dozens of variants exist
- Special characters in role (VP, C-suite, "Engineer, Software")

Latency (20 cases):
- Compare new function latency vs old findPeopleByFilters
- New function p95 must be ≤ 500ms
- Any query > 1 second is an automatic failure
- Test with largest companies and broadest role terms
- If the design uses two passes, verify parallel execution
  keeps total time under single-pass baseline

Scrape timing integration (10 cases):
- Simulate the incremental scenario: query when only neighbors
  exist, then add exact matches to DB, query again
- Verify that tiers shift correctly as better data arrives

Determinism (10 cases):
- Same query 3x — verify identical results and tiers

**Comparison methodology:**
Run both old findPeopleByFilters and new function for every case.
For the old function, manually assign what the tier SHOULD have been.
Then compare: does the new function's automatic tier match your
manual assessment?

**Verdict criteria:**
- PRODUCTION READY: tier accuracy ≥ 95% (exact matches correctly
  labeled, neighbors correctly labeled), no crashes, p95 ≤ 500ms,
  ranking is correct in 95%+ of cases
- NEEDS TUNING: tier accuracy 80-95%, or latency slightly over,
  or specific role categories are miscategorized
- WRONG APPROACH: tier accuracy < 80%, or systematic misranking,
  or latency regression

PHASE 4 — ITERATE IF NEEDED

If QA's verdict is "needs tuning" or "wrong approach":
- Researcher reviews QA's tier accuracy breakdown by category —
  which roles are being miscategorized and why?
- If the distance boundaries between tiers are wrong, Researcher
  proposes adjusted thresholds based on QA's data
- If the approach is fundamentally wrong, Researcher proposes
  an alternative from the options not chosen in Phase 1
- Engineer implements changes
- QA retests failing cases + fresh batch
- Repeat until production ready or 3 iterations done

RULES:
- Engineer and QA talk directly on bugs. Don't route through Researcher.
- All sharing between teammates must include actual data, file paths,
  function names, and example results — not vague summaries.
- Nobody writes code until Researcher has shared the distance
  distribution analysis and proposed design.
- All new code goes alongside existing code, never replacing it.
- The new function's return type MUST include per-result match
  quality metadata. This is non-negotiable — it's the whole point.

Start the team. Researcher begins immediately.
