# Research Gaps -- Prioritized Follow-Up Queries

Last updated: 2026-04-13
Budget remaining: ~$1.60 (16 queries at $0.10 each)

Based on analysis of 84 queries across 3 phases, the findings.md, and the EVIDENCE.md, these are the gaps most likely to improve the system prompt's reliability in production.

---

## Gap 1: currentJobTitles fuzzy matching boundary (HIGH PRIORITY)

**What we know:** "Software Engineer" returns Senior/Staff/Lead variants. Multiple titles = OR.

**What we do NOT know:**
- Does "Product Manager" return "Technical Program Manager"? "Project Manager"? This matters because user intent for "PM" is ambiguous and our prompt needs to know which variants leak in.
- Does "Data Scientist" return "Data Analyst"? "Data Engineer"? "Machine Learning Engineer"? These are distinct roles users care about differentiating.
- Does "Designer" return "Design Manager"? "Design Director"? Or only IC variants?

**Why it matters:** This is the most commonly used filter in production. The system prompt says "fuzzy" but never defines the boundary of fuzziness. Haiku cannot give accurate confidence tiers without knowing which title families bleed into each other.

**Recommended queries (4):**
1. `currentJobTitles: ["Product Manager"]` + Google + SF -- check if TPM, PgM, Project Manager appear
2. `currentJobTitles: ["Data Scientist"]` + SF -- check if Data Analyst, Data Engineer, ML Engineer appear
3. `currentJobTitles: ["Designer"]` + SF -- check if UX Designer, Graphic Designer, Design Manager appear
4. `currentJobTitles: ["Marketing Manager"]` + SF -- check if "Growth Marketing", "Content Marketing" appear

---

## Gap 2: searchQuery + currentJobTitles interaction precision (HIGH PRIORITY)

**What we know:** searchQuery ANDs with structured filters (Q4 vs Q5 showed narrowing). Boolean AND/OR works.

**What we do NOT know:**
- When you combine `searchQuery: "machine learning"` with `currentJobTitles: ["Software Engineer"]`, do you get ML engineers specifically, or just any SWE whose profile mentions ML somewhere?
- Is the precision of the combined result meaningfully better than searchQuery alone?
- Does searchQuery ranking (page 1 front-loading) still work when combined with title filters?

**Why it matters:** "ML engineers" and "Python developers" are among the most common user queries in production. The prompt currently tags these as MEDIUM confidence but we have no data on whether the combination of searchQuery + title actually achieves better precision than either alone.

**Recommended queries (2):**
1. `searchQuery: "machine learning", currentJobTitles: ["Machine Learning Engineer"]` + SF -- check page 1 precision
2. `searchQuery: "python", currentJobTitles: ["Software Engineer"]` + Google -- compare precision to Q4 (which tested this but we need to verify the actual titles returned)

---

## Gap 3: excludeCurrentJobTitles precision with fuzzy matching (MEDIUM-HIGH PRIORITY)

**What we know:** excludeCurrentJobTitles works (Q32 removed SWEs). But Q32 only tested one exclude case.

**What we do NOT know:**
- If `currentJobTitles` is fuzzy, is `excludeCurrentJobTitles` also fuzzy? Does `excludeCurrentJobTitles: ["Manager"]` also exclude "Senior Manager", "Engineering Manager", "General Manager"?
- Can we use exclude as a surgical tool? e.g., `functionIds: ["8"]` (Engineering) + `excludeCurrentJobTitles: ["Manager", "Director"]` to get IC engineers only?

**Why it matters:** The system prompt recommends using exclude filters "to clean up" results, but if the exclude matching is also fuzzy, it could remove more results than intended. This is an important production pattern -- users frequently ask for "IC engineers, not managers."

**Recommended queries (2):**
1. `functionIds: ["8"], excludeCurrentJobTitles: ["Manager"]` + Google + SF -- does it exclude "Engineering Manager" AND "Senior Manager"?
2. `currentJobTitles: ["Engineer"], excludeCurrentJobTitles: ["Software Engineer"]` + SF -- does the exclude remove all SWE variants while keeping other engineers?

---

## Gap 4: Director-level seniority accuracy (MEDIUM PRIORITY)

**What we know:** VP (300) = 100% precision. CXO (310) = accurate. Senior (120) = unreliable.

**What we do NOT know:**
- Director (220) accuracy is listed as "MEDIUM" in the system prompt but was never actually tested directly. The only data point is the general finding that VP+ is high and Senior is low.
- Manager (200) and Experienced Manager (210) were never tested at all.

**Why it matters:** "Director of Engineering" and "Engineering Manager" are very common user queries. The prompt needs to give accurate confidence for these seniority levels. If Director is as reliable as VP, we should tell Haiku to trust it. If it's as bad as Senior, we should warn users.

**Recommended queries (2):**
1. `seniorityLevelIds: ["220"]` (Director) + `functionIds: ["8"]` + SF -- check if results are actual Directors
2. `seniorityLevelIds: ["200"]` (Entry Manager) + `functionIds: ["8"]` + SF -- check if results are actual Engineering Managers

---

## Gap 5: Non-tech role searches (MEDIUM PRIORITY)

**What we know:** Almost all 84 queries tested tech roles (Software Engineer, PM, Data Scientist) at tech companies (Google, Stripe, Anthropic) in tech hubs (SF, NYC).

**What we do NOT know:**
- Do the same filter behaviors hold for non-tech roles? e.g., "accountants", "nurses", "lawyers"
- Do non-tech companies (e.g., Walmart, JPMorgan, Deloitte) index correctly?
- Do non-tech locations (e.g., "Chicago", "Dallas", "Atlanta") have the same metro-area behavior?

**Why it matters:** If the networking app serves users beyond tech, the system prompt's rules need to be validated outside the tech bubble. Even if we're tech-focused now, a single query confirming a non-tech company + role works (or doesn't) would add confidence.

**Recommended queries (2):**
1. `currentCompanies: ["https://www.linkedin.com/company/jpmorgan-chase"]` + `functionIds: ["10"]` (Finance) + `locations: ["New York"]` -- does a large non-tech company + non-tech function work?
2. `currentJobTitles: ["Nurse"]` + `locations: ["Chicago"]` -- does a completely non-tech role + non-tech city work?

---

## Gap 6: Multiple currentJobTitles interaction with seniority/function (MEDIUM PRIORITY)

**What we know:** Multiple `currentJobTitles` = OR (Q10, 96% precision). `currentJobTitles` + `functionIds` AND together (Q15-Q16).

**What we do NOT know:**
- What happens with `currentJobTitles: ["Product Manager", "Program Manager"]` + `seniorityLevelIds: ["300"]`? Does VP seniority correctly filter VP-level PMs, or does the title fuzziness + seniority combination produce garbage?
- This is a common production pattern: user says "VP of Product" and we need to combine title + seniority

**Recommended queries (1):**
1. `currentJobTitles: ["Product Manager"], seniorityLevelIds: ["300"]` + SF -- do we get VP-level PMs, or does the fuzzy title matching break seniority?

---

## Gap 7: searchQuery NOT operator (LOW-MEDIUM PRIORITY)

**What we know:** AND and OR boolean operators work in searchQuery (Q61-Q64). Space-separated is slightly broader than AND.

**What we do NOT know:**
- Does NOT work? e.g., `searchQuery: "kubernetes NOT devops"` -- would this narrow results by excluding DevOps profiles?
- Does parenthetical grouping work? e.g., `"(kubernetes OR docker) AND python"`

**Why it matters:** If NOT works, we could use searchQuery more surgically for skill-based queries, potentially upgrading searchQuery from LOW-MEDIUM to MEDIUM confidence for certain patterns. The system prompt currently doesn't mention NOT at all.

**Recommended queries (2):**
1. `searchQuery: "kubernetes NOT devops"` + SF -- compare totalElements to "kubernetes" alone (42,715)
2. `searchQuery: "(terraform OR kubernetes) AND python"` + SF -- test parenthetical grouping

---

## Gap 8: totalElements accuracy for filtered queries (LOW PRIORITY)

**What we know:** Pagination is stable through page 20. totalElements fluctuates slightly between runs (Q71 vs Q35: 28,221 vs 28,219).

**What we do NOT know:**
- Is totalElements accurate for highly filtered queries (4+ filters)? LinkedIn is known to inflate result counts.
- When the system prompt tells the user "I found [N] results," can Haiku trust that number?

**Recommended queries (1):**
1. Run a 4-filter query, note totalElements, then paginate to the last reported page -- does the data actually exist, or is totalElements inflated?

---

## Summary: Recommended 16 queries

| Priority | Gap | Queries | Expected impact on prompt |
|----------|-----|---------|--------------------------|
| HIGH | Title fuzzy boundary | 4 | Define which title families bleed; enable per-title confidence |
| HIGH | searchQuery + title precision | 2 | Upgrade or downgrade "skill + title" combo confidence |
| MED-HIGH | Exclude fuzzy matching | 2 | Validate exclude-as-precision-tool recommendation |
| MED | Director/Manager seniority | 2 | Fill gap in seniority confidence tiers |
| MED | Non-tech roles | 2 | Validate prompt rules beyond tech bubble |
| MED | Title + seniority combo | 1 | Validate common "VP of Product" pattern |
| LOW-MED | NOT operator | 2 | Potentially upgrade searchQuery confidence |
| LOW | totalElements accuracy | 1 | Validate "I found N results" user messaging |

Total: 16 queries = $1.60, within remaining budget of ~$1.60.

---

## What NOT to re-test

These are well-established with high confidence and do not need more queries:

- Basic location filtering (city/state/country) -- 10 queries already
- currentCompanies with URL -- 11 queries already
- Pagination stability -- 5 queries through page 20
- Boolean AND/OR in searchQuery -- 4 queries, confirmed
- Exclude filters work -- 5 queries across 4 exclude types
- pastCompanies format flexibility -- 3 queries, all formats work
- Schools full name requirement -- 4 queries, clear pass/fail pattern
- recentlyChangedJobs -- 2 queries, 100% precision
- Multiple values = OR logic -- confirmed for companies, locations, schools, headcount
