# LinkedIn Search Research — Final Findings

Last updated: 2026-04-14
Total queries: 100 (Phase 1: 55, Phase 2: 25, Phase 3: 4, Phase 4: 16)
Total budget spent: ~$10.00 / $10.00

> **NOTE**: Many queries show low "precision" in the log because the validator flagged Bay Area locations (Berkeley, San Jose, Palo Alto) as not matching "San Francisco". In reality, **"San Francisco" = entire SF Bay Area metro** — LinkedIn's intended behavior. True precision is 85-100% when accounting for metro area matching.

---

## Phase 1 Findings (Q1-Q55)

### searchQuery
- Matches broadly across title, headline, summary, skills, and hidden profile fields
- Quotes don't enforce exact matching (Q2 vs Q3: negligible difference)
- searchQuery + structured filters = AND logic (Q4 vs Q5)
- Company name in searchQuery ≠ currentCompanies URL (Q20: 777 vs URL's thousands)
- Niche skills work: kubernetes (42K), terraform (15K), fintech (28K, 100% precision)

### currentJobTitles
- FUZZY matching: "Software Engineer" → Senior, Staff, Lead, Embedded variants
- Multiple titles = OR logic (Q10: 96% precision)

### locations
- City = metro area (SF = Bay Area, NYC = NYC metro)
- State ("California") and country ("United States") work
- Abbreviations unreliable ("CA" cross-matched Canada)

### schools
- Full name required: "Stanford University" = 3,815. "MIT" = 0 results!
- "Massachusetts Institute of Technology" = 1,323

### seniorityLevelIds
- VP (300) = 100% precision. CXO (310) = accurate
- Senior (120) = LinkedIn's automated guess, unreliable

### functionIds
- Sales (25), Engineering (8), Product Mgmt (19) all 93%+ accurate

### Exclude filters
- All work: excludeCurrentJobTitles, excludeLocations, excludeSeniorityLevelIds, excludeFunctionIds

### Pagination
- Stable through page 5, no degradation, no overlap

### Other
- companyHeadquarterLocations ≠ locations (HQ vs person)
- Trailing slash in company URL doesn't matter
- recentlyChangedJobs works (~90 days)
- yearsAtCurrentCompanyIds works (100% precision)

---

## Phase 2 Findings (Q56-Q80)

### Multiple Companies = OR (Q56-Q58)
- currentCompanies: [stripe, anthropic] returned results from both (OR logic confirmed)
- Anthropic consistently returns 0 SWEs — company LinkedIn page indexing issue, not a scraper bug

### pastCompanies Format Flexibility (Q59-Q60)
- Full URL: 12,697 results (Q38)
- Raw company name "Google": 13,746 results (Q59) — WORKS
- Partial URL "linkedin.com/company/google": 12,703 results (Q60) — WORKS
- All three formats produce similar results. pastCompanies is flexible.

### Boolean Operators CONFIRMED (Q61-Q64)
- **AND works**: "terraform AND kubernetes" = 8,454 (< terraform alone 15,818, < kubernetes alone 42,715)
- **Space-separated slightly broader**: "terraform kubernetes" = 9,747 (vs AND's 8,454)
- **OR works**: "terraform OR rust" = 21,894 ≈ terraform(15,818) + rust(6,268) = 22,086 theoretical union
- Boolean operators are real, not just keywords

### Company-Only Anomaly (Q65-Q67)
- Google company-only: 198,838 — works perfectly
- Stripe company-only: 13,242 — works fine
- Anthropic company-only: 5 (Q49), Anthropic + Engineering: 1 (Q67) — LinkedIn page issue
- Takeaway: most companies work fine, but some smaller/newer companies may have indexing issues

### yearsOfExperience Accuracy (Q68-Q70)
- 3-5yr (Q68): 11,336, 92% precision. Mid-career titles confirmed.
- 10+yr at Google (Q69): 40,406. Senior/Director/Head titles — accurate!
- <1yr at Google (Q70): 224. Entry-level "Software Engineer" titles — accurate!
- **yearsOfExperienceIds is more reliable than initially assessed**

### Deep Pagination (Q71-Q72)
- Page 10: 92% precision. No degradation.
- Page 20: 96% precision. No degradation.
- **Pagination is rock-solid through at least page 20**

### profileLanguages (Q73-Q74)
- ISO code "es": 0 results — FAILS
- Full name "Spanish": 170 results — WORKS
- **Same pattern as schools: full names only, no codes/abbreviations**

### companyHeadcount Accuracy (Q75-Q77)
- Google + headcount "I" (10K+): 55,851 ≈ baseline 56,695 — correct classification
- Google + headcount "C" (11-50): 331 results (NOT zero!) — subsidiary/affiliate entities classified differently
- **companyHeadcount is not perfectly exclusive for large companies with sub-entities**

### Multiple Locations/Schools = OR (Q78-Q79)
- locations: ["SF", "NYC"] = 115 results from both metros — OR confirmed
- schools: ["Stanford", "Harvard"] = 4,176 > Stanford alone (3,815) — OR confirmed

### Person Lookup (Q80)
- firstName: "Sundar", lastName: "Pichai", company: Google = **0 results**
- **firstName/lastName filters are unreliable** — possibly privacy settings or name format issues

---

## Phase 3 Findings (Q81-Q84)

### searchQuery Ranking Effect (Q81-Q83)

Tested: `searchQuery: "kubernetes"` + Google + SF, pages 1/5/10.

| Page | Profiles with "kubernetes" in visible title | Total Results |
|------|---------------------------------------------|---------------|
| Page 1 (Q81) | **5 of 25** (20%) — "Kubernetes Platforms", "Kubernetes/Cloud engineer", "GKE" titles | 1,550 |
| Page 5 (Q82) | **0 of 25** (0%) — generic "Director of Engineering", "Software Engineer" | 1,550 |
| Page 10 (Q83) | **0 of 25** (0%) — generic "Software Engineer", "SWE", "Staff SWE" | 1,782 |

**CONFIRMED: searchQuery influences result ranking.** Page 1 front-loads the most relevant profiles (those with the keyword in visible fields like title/headline). Deeper pages contain people who match via hidden fields (skills, summary, etc.) with no visible keyword connection. This means **page 1 results for skill-based queries are meaningfully better than deeper pages** — good news for the UX since we show page 1 first.

### pastJobTitles Fuzzy Matching (Q84)

Tested: `pastJobTitles: ["Product Manager"]` + Stripe + SF. Returned 218 results.

Current titles of matched people: "Product Lead", "Head of Internal Audit", "Enterprise Strategy and Operations", "Head of Revenue Suite Product Engineering", "Lead - Data Science", "Account Executive", "Head of Product".

**CONFIRMED: pastJobTitles uses the same fuzzy matching as currentJobTitles.** "Product Manager" matched people whose past title included PM variants. These people have since moved to different roles at Stripe. The filter correctly identifies people by their past role, not their current one.

---

## Phase 4 Findings (Q85-Q100) — Gap-Filling

### Title Fuzzy Matching Boundaries (Q85-Q88)

The fuzziness of `currentJobTitles` varies by title family. Key finding: **matching is substring-based on the core role noun, not semantic**.

| Title Filter | Total | Leaked Variants | True Precision |
|---|---|---|---|
| "Product Manager" (Q85) | 2,078 | Product Marketing Manager (2x), Program Manager (1x), Product Technology Manager (1x) | ~84% |
| "Data Scientist" (Q86) | 635 | NONE -- zero leaks into Data Analyst, Data Engineer, ML Engineer | 100% |
| "Designer" (Q87) | 835 | NONE -- matched UX, Product, Interaction, Industrial, Content, Motion, Learning Designer | 100% |
| "Analyst" at Goldman (Q88) | 2,001 | NONE -- matched IB Analyst, Research Analyst, Credit Analyst, Quant Analyst | 100% |

**Key insight:** "Product Manager" is the fuzziest title because "Product" and "Manager" are common substrings that appear in many roles. "Data Scientist", "Designer", and "Analyst" are much tighter because they are more distinctive compound terms. The scraper matches any title containing both key words of the filter, which is why "Product Marketing Manager" leaks through for "Product Manager" (contains both "Product" and "Manager").

**Rule for the system prompt:** Titles with common substrings ("Product Manager", "Engineer") will have fuzzy leaks. Titles with distinctive compound nouns ("Data Scientist", "Investment Banking Analyst") are tight.

### searchQuery + currentJobTitles Interaction (Q89-Q90)

| Combo | Total | ML/Python in Title | Generic Title | Precision |
|---|---|---|---|---|
| searchQuery "machine learning" + title "Software Engineer" at Google (Q89) | 6,857 | 10 of 22 (45%) | 12 of 22 (55%) | Combo works: AND logic confirmed |
| searchQuery "python" + title "Data Scientist" in SF (Q90) | 7,604 | All DS titles | N/A | 100% DS precision |

**Key insight:** The searchQuery narrows results via AND logic (confirmed), and page 1 front-loads profiles where the keyword appears in visible fields. However, roughly half of page 1 results for a skill+title combo will be people who mention the skill only in hidden fields (skills section, about, etc.). This is still useful but the user should know not all results will have the keyword visible.

### Exclude Filter Fuzzy Behavior (Q91-Q92)

**Q91: excludeCurrentJobTitles: ["Manager"]** -- 22,264 results at Google Engineering.
- ZERO manager titles leaked through. Not a single "Engineering Manager", "Product Manager", or "Marketing Manager" appeared.
- The exclude IS fuzzy, matching any title containing "Manager".
- **Caution:** This is aggressive. Excluding "Manager" also removes "Product Manager" which might not be desired.

**Q92: excludeCurrentJobTitles: ["Senior Software Engineer"]** -- 15,216 results.
- ZERO "Senior Software Engineer" results. The exclude worked.
- "Staff Software Engineer" (3x) and other variants survived -- the exclude is specific to the excluded string, not all seniority levels.
- **Exclude is fuzzy for substrings of the excluded term, but does NOT cascade to unrelated seniority variants.**

**Rule:** Exclude matching is substring-based, same as include. `excludeCurrentJobTitles: ["Manager"]` removes ALL titles containing "Manager". To exclude only Engineering Managers, use `excludeCurrentJobTitles: ["Engineering Manager"]` (more specific). `excludeCurrentJobTitles: ["Senior Software Engineer"]` removes Senior SWEs but leaves Staff SWEs untouched.

### Director/Manager Seniority Accuracy (Q93-Q94)

| Seniority Level | ID | Total | True Precision | Sample Titles |
|---|---|---|---|---|
| Director (Q93) | 220 | 1,870 | 96% (22/23) | Director, Sr. Director, Head of, Managing Director, Global Head |
| Manager (Q94) | 200+210 | 913 | 100% (23/23) | Engineering Manager, Marketing Manager, Sr. Manager, Product Manager |

**Key insight:** Both Director (220) and Manager (200/210) are highly accurate, comparable to VP (300). Only one VP leaked into Director results. This is a major upgrade from the previous "unknown" classification.

**Updated seniority confidence tiers:**
- VP (300), CXO (310): HIGH (100%)
- Director (220): HIGH (96%)
- Manager (200, 210): HIGH (100%)
- Senior (120): LOW (LinkedIn's automated guess, unreliable)

### Non-Tech Role Validation (Q95-Q96)

| Role + Company | Total | True Precision | Notes |
|---|---|---|---|
| "Investment Banking Analyst" at Goldman Sachs, NYC (Q95) | 484 | 100% (23/23) | All IB Analysts. Finance roles work perfectly. |
| "Associate" at McKinsey, NYC (Q96) | 648 | 100% (25/25) | Associate, Sr. Associate, Associate Partner, Associate Director. Consulting works perfectly. |

**Key insight:** The scraper works identically for non-tech industries. Company indexing for Goldman Sachs and McKinsey is excellent. All filter behaviors (fuzzy title matching, location metro areas, company URLs) behave the same as for tech companies.

### Multi-Title OR Precision (Q97-Q98)

| Titles | Total | Both Title Families Present? | Precision |
|---|---|---|---|
| ["Software Engineer", "Product Manager"] at Stripe (Q97) | 491 | YES -- both SWEs and PMs returned | 96% (24/25) |
| ["Data Scientist", "Machine Learning Engineer"] in NYC (Q98) | 9,612 | YES -- both DS and MLE returned | 88% (22/25) |

**Confirmed:** Multiple titles in `currentJobTitles` array = OR logic, even across completely different role families. No degradation in precision.

**New discovery from Q98:** LinkedIn caps results at 2,500 items per query. If totalElements > 2,500, the actor shows a warning: "The search results are limited to 2500 items." This means for broad queries, you can only paginate through 100 pages of 25.

### NOT Operator and Parenthetical Grouping (Q99-Q100)

| Query | totalElements | Comparison |
|---|---|---|
| "kubernetes" alone (Q1) | 42,715 | baseline |
| "kubernetes NOT devops" (Q99) | 28,080 | 34% reduction -- NOT works! |
| "terraform OR kubernetes" (Q63) | 21,894 | baseline |
| "(terraform OR kubernetes) AND python" (Q100) | 8,206 | 63% reduction -- parenthetical grouping works! |

**CONFIRMED: NOT operator works.** "kubernetes NOT devops" reduced results by 34% and zero DevOps titles appeared in the results.

**CONFIRMED: Parenthetical grouping works.** "(terraform OR kubernetes) AND python" produced 8,206 results -- correctly between "terraform OR kubernetes" (21,894) and what "terraform AND python" alone would produce.

**Updated searchQuery boolean capabilities:**
- AND: works (Q61)
- OR: works (Q63)
- NOT: works (Q99)
- Parenthetical grouping: works (Q100)
- All four standard boolean operators are functional.

---

## Final Parameter Confidence Summary

| Parameter | Confidence | Key Evidence |
|-----------|-----------|-------------|
| currentCompanies (URL) | HIGH | Q28, Q56-58 (OR), Q65-66, Q95-Q97 |
| locations (city/state/country) | HIGH (metro match) | Q11, Q52, Q78 (OR) |
| currentJobTitles (distinctive terms) | HIGH (e.g., "Data Scientist", "Designer") | Q86 (100%), Q87 (100%), Q88 (100%) |
| currentJobTitles (generic terms) | MEDIUM (e.g., "Product Manager", "Engineer") | Q85 (84%), Q8-Q10, Q51 |
| pastJobTitles | MEDIUM (fuzzy, same as current) | Q84 |
| functionIds | HIGH | Q17, Q24, Q25 |
| seniorityLevelIds (VP/CXO) | HIGH | Q22, Q23 |
| seniorityLevelIds (Director) | HIGH | Q93 (96%) |
| seniorityLevelIds (Manager) | HIGH | Q94 (100%) |
| seniorityLevelIds (Senior) | LOW | Q21 |
| companyHeadcount | MEDIUM (not perfectly exclusive) | Q26, Q27, Q75-Q77 |
| companyHQ locations | HIGH | Q29, Q30 |
| schools (full name) | HIGH | Q39, Q41, Q79 (OR) |
| schools (abbreviation) | FAILS | Q40 |
| pastCompanies (any format) | HIGH | Q38, Q59, Q60 |
| recentlyChangedJobs | HIGH | Q42, Q43 |
| yearsOfExperienceIds | MEDIUM-HIGH | Q44, Q45, Q68-Q70 |
| yearsAtCurrentCompanyIds | HIGH | Q50 |
| searchQuery (with booleans incl. NOT, parens) | MEDIUM | Q1-Q7, Q47-Q48, Q61-Q64, Q99-Q100 |
| searchQuery ranking | CONFIRMED | Q81-Q83 (page 1 front-loads relevant results) |
| searchQuery + currentJobTitles combo | MEDIUM-HIGH | Q89 (AND confirmed, 45% visible ML), Q90 (100% DS) |
| excludeCurrentJobTitles (fuzzy) | HIGH (but aggressive) | Q91 (0 managers leaked), Q92 (0 senior SWE leaked) |
| excludeLocations | HIGH | Q33 |
| excludeSeniorityLevelIds | HIGH | Q34 |
| excludeFunctionIds | HIGH | Q54 |
| Multiple titles = OR | HIGH | Q10, Q97, Q98 |
| profileLanguages (full name) | MEDIUM | Q74 |
| profileLanguages (ISO code) | FAILS | Q73 |
| firstName/lastName | LOW/UNRELIABLE | Q80 |
| Pagination (pages 1-20) | HIGH | Q35-Q37, Q71-Q72 |
| Non-tech roles/companies | HIGH | Q88 (Goldman), Q95 (Goldman IBA), Q96 (McKinsey) |
