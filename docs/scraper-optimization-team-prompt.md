# Agent Team Prompt: LinkedIn Scraper Evaluation & Prompt Optimization

Create an agent team to evaluate our LinkedIn scraper, empirically
map its capabilities, and optimize the Haiku system prompt.
Use the researcher, prompt-engineer, and qa-engineer agents.

THE PROBLEM:
We use Apify actor `harvestapi/linkedin-profile-search` to discover
LinkedIn profiles. Haiku translates natural language searches into
scraper parameters via a system prompt in search-extraction-prompt.ts.
We don't know:
1. Whether this is the best Apify actor for our needs
2. What the scraper can and can't reliably do
3. Whether the Haiku prompt is optimally translating user intent
   into scraper parameters

THE GOALS (ranked by priority):
1. LATENCY — Search results must appear fast. Scraper latency
   directly impacts UX. Anything that reduces time-to-results wins.
2. DISCOVERABILITY — The scraper must find the right people. Filter
   accuracy, result relevance, and coverage matter. If a better
   actor finds more accurate results, switch to it.
3. COST — Least important, but don't waste money. $0.10/page is
   fine if results are good. Don't optimize cost at the expense
   of latency or quality.

PHASE 1 — RESEARCHER EVALUATES SCRAPER OPTIONS

Researcher:
- Read these files to understand the current setup:
  - src/lib/services/linkedin-search.ts (current Apify integration)
  - src/lib/services/linkedin-filter-validator.ts
  - src/lib/prompts/search-extraction-prompt.ts (current Haiku prompt)
  - src/app/actions/search.ts or src/app/actions/ai-search.ts
  - tests/linkedin-short-quality.ts (existing test harness)
  - tests/discovery-flow/ (existing discovery flow tests)

- Search the Apify store for LinkedIn profile search actors.
  For each serious contender, evaluate:
  - Available filters (compare against our LinkedInSearchParams)
  - Latency per page (we need sub-6s, ideally sub-3s)
  - Cost per page/profile
  - Result quality: does it return the fields we need?
    (linkedinUrl, firstName, lastName, current position, location)
  - Rate limits and reliability
  - How actively maintained is it? Last update? User reviews?

- Run 5 identical searches on harvestapi/linkedin-profile-search
  AND each contender. Same filters, same parameters. Compare:
  - Latency (wall clock time per page)
  - Result count (totalElements)
  - Result overlap (how many of the same profiles appear?)
  - Data completeness (any fields missing?)

- Share findings with Prompt Engineer and QA Engineer:
  - If a better actor exists: recommend switching, explain why,
    list any parameter differences that affect the prompt
  - If current actor is best: confirm it, move to Phase 2

PHASE 2 — RESEARCHER MAPS SCRAPER CAPABILITIES

Budget: $10 (~100 search queries). Spend wisely.

Researcher:
- Systematically test every parameter and filter combination
  to build a ground-truth understanding of what works reliably.

Priority order (spend queries accordingly):

TIER 1 — Critical unknowns (40 queries):
- searchQuery behavior: what does it match against? Does it
  support boolean operators (AND/OR/quotes)? How does it
  interact with currentJobTitles?
- currentJobTitles precision: is "Software Engineer" exact or
  fuzzy? Does it return "Senior Software Engineer"? "Software
  Engineering Manager"? Multiple titles = OR logic?
- Filter stacking: do filters AND together? At what point do
  combined filters produce weird behavior?
- Location precision: does "San Francisco" match the metro area?
  Does "California" work? Do abbreviations work?

TIER 2 — Important (30 queries):
- seniorityLevelIds accuracy: LinkedIn's guess vs reality.
  Run same search with/without — does it genuinely filter or
  just re-rank?
- functionIds accuracy: same question
- currentCompanies: URL format sensitivity (trailing slashes,
  case, wrong URL)
- Exclude filters: do they actually work? Run with/without
  and diff the results

TIER 3 — Nice to know (15 queries):
- Pagination: is totalElements accurate? Do later pages degrade?
- recentlyChangedJobs: how recent? How accurate?
- schools: exact vs fuzzy name matching
- companyHeadcount: does it work reliably?

Reserve 15 queries for Phase 4 validation.

For EVERY query:
1. State hypothesis BEFORE running
2. Run the query, record latency
3. Analyze ALL returned results (all 25 per page, not just top 5)
   - For each: does this person match the search intent?
   - If no: which filter did it violate?
4. Log to tests/linkedin-search-research/search_log.jsonl:
   ```json
   {
     "query_number": 1,
     "tier": "tier1",
     "question": "Does searchQuery support AND operator?",
     "hypothesis": "searchQuery 'python AND kubernetes' returns profiles mentioning both",
     "params": { "searchQuery": "python AND kubernetes", "locations": ["San Francisco"] },
     "latency_ms": 5200,
     "total_elements": 3400,
     "results_returned": 25,
     "valid": 21,
     "invalid": 4,
     "precision": 0.84,
     "observations": ["AND appears to work — most results had both terms"],
     "confidence": "HIGH"
   }
   ```
5. Print remaining budget after each query

After every 15 queries: stop, re-read your full log, update
tests/linkedin-search-research/findings.md with confirmed
behaviors and remaining unknowns.

After ~85 queries: stop testing, synthesize ALL findings into
a structured report. Classify every parameter into:
- HIGH CONFIDENCE (90%+ precision): reliable, use freely
- MEDIUM CONFIDENCE (70-89%): works but noisy, set expectations
- LOW CONFIDENCE (<70%): unreliable, avoid or warn user

Share the full report with Prompt Engineer and QA Engineer.

PHASE 3 — PROMPT ENGINEER REWRITES THE SYSTEM PROMPT

Prompt Engineer:
- Wait for Researcher's empirical findings before writing anything
- Read the current prompt: src/lib/prompts/search-extraction-prompt.ts
- Read Researcher's findings and confidence classifications

Then rewrite the system prompt so Haiku:

1. Translates natural language into optimal parameter combos
   based on what ACTUALLY WORKS (not what the docs say)
2. Knows which filters are HIGH/MEDIUM/LOW confidence and
   constructs queries that maximize precision
3. Steers users toward searches that produce accurate results:
   - HIGH confidence: "Searching for [X]!" (confident tone)
   - MEDIUM confidence: "Searching for [X] — results may include
     some related but not exact matches" (tempered tone)
   - LOW confidence: reframes the request into a HIGH confidence
     alternative, or honestly says what it can't filter for
4. Never overpromises. If the scraper can't reliably filter by
   something (e.g., years of experience is unreliable), the
   prompt must tell Haiku to NOT use that filter and to tell
   the user why.

Prompt constraints (non-negotiable):
- Under 3,000 words. Haiku's attention degrades beyond this.
- Decision trees and if/then rules, NOT paragraphs of principles.
- Every "when to do X" must be a hard rule with clear conditions.
- Include exact response templates Haiku should copy.
- Include 8-10 examples covering the most common query patterns.
- All confidence classifications must trace back to Researcher's
  empirical data.

Write the new prompt to a separate file first:
src/lib/prompts/search-extraction-prompt-v2.ts

Do NOT modify the existing prompt file. The QA engineer will
compare old vs new.

Also create a separate evidence file:
tests/linkedin-search-research/PROMPT_EVIDENCE.md
that maps every rule in the new prompt to the query numbers
from Researcher's log that prove it. This is for human review,
NOT included in the prompt itself.

PHASE 4 — QA VALIDATES

QA Engineer:
- Wait for Prompt Engineer to deliver the new prompt
- Follow your full test methodology from your agent instructions

**What you're testing:** Given the same natural language input,
does the new prompt produce better scraper queries than the old
prompt? "Better" means:
- More precise parameter selection
- Higher result relevance when the query actually runs
- Honest confidence signaling (doesn't overpromise)
- Faster results (doesn't use slow/unreliable filters)

**Test design — minimum 200 cases:**

Prompt output comparison (100 cases):
- Feed identical natural language inputs to both old and new prompts
- Compare the JSON outputs: which parameters were selected?
- For each, score: did the prompt choose the right filters
  based on Researcher's empirical findings?
- Categories:
  - 20 simple role+company queries
  - 15 role+company+location queries
  - 10 broad/generic role queries ("engineers at X")
  - 10 niche/specific role queries ("quantitative researchers at X")
  - 10 skill/keyword queries ("people who know Rust at X")
  - 10 seniority queries ("senior engineers", "VP of sales")
  - 10 negative/exclude queries ("not in California")
  - 5 past company queries ("ex-Google engineers at X")
  - 5 school queries ("MIT grads at X")
  - 5 edge cases (typos, abbreviations, ambiguous queries)

End-to-end result validation (60 cases):
- Take the top 60 most important prompt comparisons
- Actually RUN both query outputs through the scraper
- Compare result sets:
  - Latency: which query was faster?
  - Precision: which returned more relevant profiles?
  - Recall: which found more total relevant profiles?
  - False positives: which had more irrelevant results?
- THIS IS THE GROUND TRUTH. Prompt output comparison is
  necessary but not sufficient — you must verify that "better
  parameters" actually produce better results.

Confidence signaling accuracy (30 cases):
- For each query, check: does the prompt's confidence level
  (in the message field) match the actual result quality?
- A HIGH confidence message with poor results = critical failure
- A MEDIUM confidence message with great results = acceptable
  but suboptimal

Latency regression (10 cases):
- Run the 10 most common query types through both old and new
- Measure total wall-clock time: prompt execution + scraper execution
- New prompt must not increase total latency
- Flag any query where new prompt selects filters that are
  empirically slower (per Researcher's latency data)

**Comparison log format:**
Log to tests/linkedin-search-research/prompt-comparison/ as JSONL:
```json
{
  "case_id": 1,
  "category": "role_company",
  "input": "software engineers at Stripe",
  "old_prompt_output": { "filters": {...}, "linkedin_filters": {...}, "message": "..." },
  "new_prompt_output": { "filters": {...}, "linkedin_filters": {...}, "message": "..." },
  "parameter_diff": "new uses currentJobTitles instead of searchQuery",
  "scraper_results_old": { "total": 450, "precision": 0.72, "latency_ms": 5800 },
  "scraper_results_new": { "total": 380, "precision": 0.91, "latency_ms": 5200 },
  "verdict": "new_better",
  "notes": "New prompt's tighter filter produced fewer but much more relevant results"
}
```

**Verdict criteria:**
- PRODUCTION READY:
  - Prompt output quality: new prompt selects empirically better
    parameters in 85%+ of cases
  - End-to-end precision: new queries produce higher precision
    results in 80%+ of tested cases
  - Latency: no regression — new queries are same speed or faster
  - Confidence signaling: honest in 90%+ of cases (no HIGH
    confidence with poor results)
  - No crashes or malformed JSON from the new prompt
- NEEDS TUNING: promising but specific categories are weak
- WRONG APPROACH: systematic issues with the new prompt's strategy

Share full verdict with Researcher and Prompt Engineer.

PHASE 5 — ITERATE IF NEEDED

If QA's verdict is "needs tuning":
- Researcher reviews which parameter choices led to bad results
  and whether the empirical findings need updating
- Prompt Engineer adjusts specific rules based on QA's category
  breakdown — focus on the worst-performing categories first
- QA retests failing cases + fresh batch
- Repeat until production ready or 3 iterations done

If QA's verdict is "production ready":
- Prompt Engineer copies the v2 prompt content into the main
  search-extraction-prompt.ts file, replacing the old prompt
- QA runs a final smoke test of 20 queries to confirm nothing
  broke in the copy

RULES:
- Researcher and QA talk directly. Prompt Engineer and QA talk
  directly on prompt output issues.
- All sharing must include actual data, file paths, query numbers,
  and specific examples — not summaries.
- Nobody writes the new prompt until Researcher has shared the
  empirical findings with confidence classifications.
- The $10 query budget is tracked by Researcher. QA's end-to-end
  tests have a separate budget — coordinate with Researcher if
  running low.
- Latency data must be captured for EVERY scraper call. If a filter
  consistently adds latency, it must be documented even if results
  are good.

FILES:
```
tests/linkedin-search-research/search_log.jsonl     — Researcher's query log
tests/linkedin-search-research/findings.md          — Living findings doc
tests/linkedin-search-research/PROMPT_EVIDENCE.md   — Rule-to-evidence mapping
tests/linkedin-search-research/prompt-comparison/   — QA's comparison logs
src/lib/prompts/search-extraction-prompt-v2.ts      — New prompt (until promoted)
src/lib/prompts/search-extraction-prompt.ts         — Production prompt (final)
```

Start the team. Researcher begins immediately.
