# Agent Team Prompt: Retrieval System Redesign

Create an agent team for redesigning our people-search retrieval system.
Use the researcher, engineer, and qa-engineer agents.

THE PROBLEM:
We have a people discovery feature that searches a Postgres DB
for people matching filters (role, company, location, school).
Currently we embed role titles with OpenAI and use pgvector cosine
distance with three fixed thresholds (0.28/0.38/0.48). It works
but I don't know if this is the right approach. I want to find
the best retrieval method for our actual data and implement it.

PHASE 1 — RESEARCHER GOES FIRST, OTHERS WAIT

Researcher:
- Read the Person model/schema — find it in the codebase, check
  prisma files, migrations, wherever it lives
- Read src/lib/db/person-service.ts end to end — understand every
  query function, especially findPeopleByFilters and
  findPeopleByFiltersVector
- Read src/app/actions/search.ts, src/lib/prompts/search-extraction-prompt.ts,
  src/lib/services/company-alias.ts, src/lib/services/company-resolver.ts,
  src/lib/services/embeddings.ts
- Find all embedding code (search for "ai" and "embedding" in src/lib)
- Run these against the real DB (.env loaded):
    - Total person count
    - Non-null count for every text field on Person
    - Top 30 role titles with counts
    - Top 30 companies with counts
    - Percentage of rows with role_embedding populated
    - Run a sample vector query and report the cosine distance distribution (min, p25, p50, p75, max) from the returned results
- Share ALL raw findings with Engineer and QA Engineer
- Then propose 3 retrieval architectures. Consider anything:
    - Current approach with tuned thresholds
    - Composite embeddings (embed full profile context, not just role)
    - Hybrid vector + BM25/full-text search
    - Pure SQL with smarter text matching
    - Two-stage: broad retrieval then rerank
    - Anything else that fits this specific data
- Pick one. Write a full technical design: exact query structure,
  what gets indexed, function signature, how scoring works
- Share the design with Engineer

PHASE 2 — ENGINEER IMPLEMENTS

Engineer:
- Wait for the Researcher's design before writing code
- Read the files Researcher referenced to understand codebase style
- Implement as a NEW function (e.g. findPeopleByFiltersV2) —
  do NOT touch existing production functions
- If the design requires new embeddings, indexes, or columns,
  write the migration but keep it separate and reversible
- If anything in the design is unclear, ask Researcher directly
- When done, tell QA Engineer the function name and file location

PHASE 3 — QA TESTS (PRODUCTION-GRADE)

QA Engineer:
- Wait for Engineer to say the function is ready
- Follow the full test methodology defined in your agent instructions
- Use the Researcher's data profile (top companies, common roles,
  data distributions) to build test cases from real data
- Run a MINIMUM of 220 test cases across all categories:
    - 40+ role filter variations (common, niche, broad, abbreviations,
      seniority prefixes, synonyms, adjacent-but-different roles)
    - 30+ company filter variations (from top 30, special chars,
      abbreviations, case variations)
    - 20+ location filter variations (city, state, country, metro areas)
    - 15+ university filter variations (abbreviations like MIT/CMU,
      full names, aliases from UNIVERSITY_ALIASES)
    - 30+ role+company combinations
    - 20+ role+location combinations
    - 15+ triple/quad filter combinations
    - 10+ full filter stack tests
    - 20+ edge cases (empty strings, zero results, special chars,
      excludePersonIds with large lists)
    - 10+ pagination & ordering consistency tests
    - 10+ determinism tests (same input, multiple runs)
- For EVERY test case run BOTH old findPeopleByFilters and new
  function with identical inputs
- Log everything to logs/retrieval-comparison/ as JSONL with full
  detail: inputs, both result sets, timing, verdict, notes
- If something crashes, message Engineer with exact input, error,
  and stack trace. Do NOT skip — mark as failure and continue.
- After all fixes, write logs/retrieval-comparison/VERDICT.md with:
    - Total cases, pass rate, win rate, tie rate, crash count
    - Precision analysis by category
    - Performance comparison (avg and p95 latency)
    - Every regression where old function was better (with root cause)
    - Top 10 biggest wins
    - Production readiness verdict: PRODUCTION READY, NEEDS TUNING,
      or WRONG APPROACH — with evidence for each
- Share the full verdict with Researcher and Engineer

PHASE 4 — ITERATE IF NEEDED

If QA's verdict is "needs tuning" or "wrong approach":
- Researcher reviews QA's results and proposes specific adjustments
- Engineer implements the changes
- QA retests the failing cases plus a fresh batch
- Repeat until QA says production-ready or you've done 3 iterations

RULES:
- Engineer and QA talk directly on bugs. Don't route through Researcher.
- All sharing between teammates must include actual data, file paths,
  and function names — not vague summaries.
- Nobody writes code until Researcher has shared the data profile.
- All new code goes alongside existing code, never replacing it.

Start the team. Researcher begins immediately.
