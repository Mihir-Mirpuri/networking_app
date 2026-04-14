# Evidence Appendix — Query-to-Rule Mapping

Maps every rule in LINKEDIN_SEARCH_SYSTEM_PROMPT.md to the query numbers that proved it.
For human review only — NOT included in the Haiku prompt.

## Decision Tree Rules

| Rule | Evidence Queries |
|------|-----------------|
| Company → use currentCompanies URL, not searchQuery | Q19 (56K w/ both vs Q8 19K URL only), Q20 (777 w/ name in searchQuery) |
| Specific title → currentJobTitles (fuzzy) | Q8, Q9, Q10, Q51 |
| Broad function → functionIds | Q17, Q24, Q25 |
| Location = metro area | Q1-Q5, Q11, Q52 |
| Full state/country names work | Q12 (California=246K), Q13 (US=327K) |
| Never use abbreviations | Q14 (CA=80K, cross-matched Canada) |
| VP/CXO seniority = HIGH | Q22 (100%), Q23 |
| Senior seniority = LOW | Q21 |
| companyHeadcount values | Q26, Q27 (OR logic confirmed) |
| Schools MUST be full name | Q39 (Stanford=3,815), Q40 (MIT=0), Q41 (full MIT=1,323) |
| recentlyChangedJobs works | Q42, Q43 (100%) |
| yearsOfExperience works | Q44, Q45 |
| searchQuery = broad keyword match | Q1, Q5, Q47, Q48, Q53 |
| Exclude filters all work | Q32, Q33, Q34, Q54 |

## Parameter Reliability Evidence

| Parameter | Rating | Queries | Notes |
|-----------|--------|---------|-------|
| currentCompanies | HIGH | Q8, Q28, Q31, Q43, Q49 | Q28: trailing slash OK. Q49: small companies may have few results. |
| locations (city) | HIGH | Q1-Q5, Q11, Q52 | Metro area match confirmed across SF and NYC |
| locations (state) | HIGH | Q12, Q13 | "California"=246K, "United States"=327K |
| locations (abbreviation) | UNRELIABLE | Q14 | "CA"=80K with Vancouver Canada cross-match |
| currentJobTitles | MEDIUM | Q8, Q9, Q10, Q51 | Q8: "SWE" → Staff/Senior/Lead variants. Q10: multiple=OR (96%). |
| functionIds | HIGH | Q17, Q24, Q25 | Q24: Sales=96%. Q25: Product Mgmt accurate. Q17: Engineering diverse. |
| seniorityLevelIds (VP+) | HIGH | Q22 | 100% precision. All results were actual VPs. |
| seniorityLevelIds (CXO) | HIGH | Q23 | CEO, Managing Partner results. |
| seniorityLevelIds (Senior) | LOW | Q21 | LinkedIn automated classification, unreliable. |
| companyHeadcount | MEDIUM | Q26, Q27, Q55 | Q27 confirms OR logic (14K vs 5.8K single). Hard to verify company size. |
| companyHeadquarterLocations | HIGH | Q29, Q30 | Q29: 383K, filters by HQ not person. Q30: AND with locations works. |
| schools (full name) | HIGH | Q39, Q41 | Q39: Stanford=3,815. Q41: MIT full=1,323. |
| schools (abbreviation) | FAILS | Q40 | "MIT" → 0 results. |
| pastCompanies | HIGH | Q38 | 12,697 results. Returns ex-employees. |
| recentlyChangedJobs | HIGH | Q42, Q43 | Q43: 881 at Stripe, 100%. |
| yearsOfExperienceIds | MEDIUM | Q44, Q45 | Q44: 73K for 10+yr. Q45: 678 for <1yr. Scales logically. |
| yearsAtCurrentCompanyIds | HIGH | Q50 | 804, 100%. |
| searchQuery | LOW-MEDIUM | Q1-Q7, Q47, Q48, Q53 | Broad match. Q48 fintech=100%. Q1 kubernetes=lots of noise. |
| excludeCurrentJobTitles | HIGH | Q32 | Removed SWEs successfully. |
| excludeLocations | HIGH | Q33 | 100% — no SF results returned. |
| excludeSeniorityLevelIds | HIGH | Q34 | Removed entry-level. |
| excludeFunctionIds | HIGH | Q54 | 84% — removed engineering from Stripe. |

## searchQuery Behavior Evidence

| Query | searchQuery | totalElements | Observation |
|-------|------------|---------------|-------------|
| Q1 | "kubernetes" + SF | 42,715 | Broad match, many results have no visible kubernetes connection |
| Q2 | `"machine learning"` (quoted) + SF | 183,930 | Quotes don't enforce exact match |
| Q3 | `machine learning` (unquoted) + SF | 193,635 | Nearly same as quoted — quotes are ignored |
| Q4 | "python" + title:SWE + SF | 168,646 | searchQuery ANDs with title filter |
| Q5 | "python" + SF | 341,545 | Broader without title constraint |
| Q6 | "python AND kubernetes" + SF | 33,037 | Less than either alone — AND may work |
| Q7 | "python OR golang" + SF | 378,424 | More than python alone — OR may work |
| Q19 | "Google" + company:Google + title:SWE | 56,470 | Redundant company name changed results |
| Q20 | "Stripe" + title:SWE + SF (no URL) | 777 | Company name in searchQuery ≠ currentCompanies |
| Q47 | "terraform" + SF | 15,818 | Niche skill works |
| Q48 | "fintech" + NYC | 28,887 | Industry term, 100% precision |
| Q53 | "blockchain" + SF | 12,336 | Broad match confirmed |
| Q61 | "terraform AND kubernetes" + SF | 8,454 | AND confirmed: less than either alone (terraform=15K, k8s=42K) |
| Q62 | "terraform kubernetes" (space) + SF | 9,747 | Space-separated slightly broader than AND (9.7K vs 8.4K) |
| Q63 | "terraform OR rust" + SF | 21,894 | OR confirmed: ≈ terraform(15K) + rust(6K) = 21K theoretical union |
| Q64 | "rust" + SF | 6,268 | Baseline for OR comparison |

## Filter Interaction Evidence

| Query | Filters Combined | totalElements | Observation |
|-------|-----------------|---------------|-------------|
| Q15 | title:SWE + functionIds:8 + SF | 146,348 | AND together, slight narrowing |
| Q16 | title:SWE + SF (no function) | 168,640 | Baseline — function filter removed ~22K |
| Q17 | functionIds:8 + Google + SF | 24,190 | Function alone = diverse titles |
| Q18 | title:SWE + func:8 + seniority:120 + Google + SF | 14,676 | 4+ filters work, just narrow |
| Q30 | locations:NYC + companyHQ:SF + title:SWE | 11,193 | Both location types AND together |

## Pagination Evidence

| Query | Page | totalElements | Profiles | Precision | Overlap with Page 1? |
|-------|------|---------------|----------|-----------|---------------------|
| Q35 | 1 | 28,219 | 25 | 100% | N/A |
| Q36 | 2 | 28,221 | 25 | 100% | No overlap |
| Q37 | 5 | 28,223 | 25 | 96% | No overlap, no degradation |
| Q71 | 10 | 28,221 | 25 | 92% | No degradation at page 10 |
| Q72 | 20 | 28,217 | 25 | 96% | No degradation at page 20 |

## Phase 2: Multiple Values OR Logic

| Parameter | Query | Values | totalElements | Confirmed OR? |
|-----------|-------|--------|---------------|---------------|
| currentCompanies | Q56 | [Stripe, Anthropic] | 2,645 | YES — equals Stripe(2,645) + Anthropic(0) |
| currentCompanies | Q57 | [Stripe] | 2,645 | Baseline |
| currentCompanies | Q58 | [Anthropic] | 0 | Anthropic SWEs = 0 (indexing issue) |
| locations | Q78 | [SF, NYC] | 115 | YES — results from both metros |
| schools | Q79 | [Stanford, Harvard] | 4,176 | YES — > Stanford alone (3,815) |
| companyHeadcount | Q27 | [D, E] | 14,683 | YES — > E alone (5,832) |

## Phase 2: pastCompanies Format Flexibility

| Query | pastCompanies value | totalElements | Works? |
|-------|-------------------|---------------|--------|
| Q38 | Full URL (https://www.linkedin.com/company/google) | 12,697 | YES |
| Q59 | Raw name ("Google") | 13,746 | YES |
| Q60 | Partial URL (linkedin.com/company/google) | 12,703 | YES |

## Phase 2: profileLanguages

| Query | Value | totalElements | Works? |
|-------|-------|---------------|--------|
| Q73 | "es" (ISO code) | 0 | NO — ISO codes fail |
| Q74 | "Spanish" (full name) | 170 | YES — full names work |

## Phase 2: companyHeadcount Accuracy

| Query | Company | Headcount | totalElements | Observation |
|-------|---------|-----------|---------------|-------------|
| Q75 | Google | "I" (10K+) | 55,851 | Correct — Google is 10K+ |
| Q76 | Google | (none) | 56,695 | Baseline without headcount |
| Q77 | Google | "C" (11-50) | 331 | NOT zero — sub-entities/affiliates classified differently |

## Phase 2: yearsOfExperience Accuracy

| Query | Years | Company | totalElements | Title patterns |
|-------|-------|---------|---------------|---------------|
| Q68 | 3-5yr | (NYC SWEs) | 11,336 | Mid-career titles, 92% precision |
| Q69 | 10+yr | Google Engineering | 40,406 | Senior/Director/Head titles — accurate |
| Q70 | <1yr | Google Engineering | 224 | Entry-level "Software Engineer" titles — accurate |

## Phase 2: Person Lookup

| Query | firstName | lastName | Company | totalElements | Works? |
|-------|-----------|----------|---------|---------------|--------|
| Q80 | Sundar | Pichai | Google | 0 | NO — unreliable for known profiles |

## Notable Anomalies

- **Q49**: Anthropic company-only query returned only 5 results, all seemingly fake/spam profiles. Suggests LinkedIn doesn't index all employees or the company page has issues.
- **Q45**: yearsOfExperience "1" (<1yr) returned "Senior System Software Engineer" — title doesn't indicate new grad, suggesting this filter tracks total career, not current role.
- **Q14**: "CA" location returned a Vancouver, Canada result — abbreviations are unreliable.
- **Q19**: Adding "Google" to searchQuery while also using currentCompanies:google TRIPLED results from 19K to 56K — searchQuery broadens the match in unexpected ways.
- **Q58/Q67**: Anthropic consistently returns 0 or 1 results across multiple queries. Company LinkedIn page has indexing issues — not a scraper bug. Google (Q65: 198K) and Stripe (Q66: 13K) both work fine.
- **Q77**: Google + headcount "C" (11-50) returned 331 results instead of expected 0. Large companies may have subsidiary entities classified in smaller headcount buckets.
- **Q80**: firstName="Sundar" + lastName="Pichai" + Google = 0 results. Person lookup filters are unreliable, possibly due to privacy settings or name format mismatches.
- **Q73**: profileLanguages "es" (ISO code) = 0 results. "Spanish" (full name) = 170. Same full-name-only pattern as schools filter.

## Phase 3: searchQuery Ranking Effect

| Query | Page | Profiles with "kubernetes" in visible title | Total Elements | Observation |
|-------|------|---------------------------------------------|----------------|-------------|
| Q81 | 1 | 5 of 25 (20%) | 1,550 | "Kubernetes Platforms", "Kubernetes/Cloud engineer", "GKE" titles front-loaded |
| Q82 | 5 | 0 of 25 (0%) | 1,550 | Generic titles only: "Director of Engineering", "Software Engineer" |
| Q83 | 10 | 0 of 25 (0%) | 1,782 | Generic titles only: "Software Engineer", "SWE", "Staff SWE" |

**CONFIRMED: searchQuery influences result ranking.** Page 1 front-loads profiles where the keyword appears in visible fields (title/headline). Deeper pages contain people who match via hidden fields only. This validates showing page 1 first in the UX.

## Phase 3: pastJobTitles Fuzzy Matching

| Query | pastJobTitles | Company | totalElements | Current titles of matched people |
|-------|--------------|---------|---------------|----------------------------------|
| Q84 | ["Product Manager"] | Stripe + SF | 218 | "Product Lead", "Head of Internal Audit", "Enterprise Strategy and Operations", "Head of Revenue Suite Product Engineering", "Lead - Data Science" |

**CONFIRMED: pastJobTitles uses the same fuzzy matching as currentJobTitles.** "Product Manager" matched people whose past title included PM variants, who have since moved to different roles at Stripe.
