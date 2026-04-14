# Prompt v2 Evidence Mapping

Maps every rule in `search-extraction-prompt-v2.ts` to the query numbers from the research that proved it.

## RULE 1 -- Role Routing (title vs function_ids)

| Rule | Evidence Queries |
|------|-----------------|
| current_job_titles for named titles ("Software Engineer", "Product Manager", "Data Scientist") | Q8-Q10 (fuzzy matching confirmed), Q85-Q88 (precision by title family) |
| function_ids for broad disciplines ("engineers", "designers", "salespeople", "lawyers", "recruiters", "HR") | Q17 (Sales 93%), Q24-Q25 (Engineering, Product Mgmt 93%+) |
| NEVER combine current_job_titles AND function_ids | Q17 vs Q8 (different result sets) |
| Title precision: "Data Scientist" = 100%, "Product Manager" = ~84% leak | Q85 (PM 84%), Q86 (DS 100%), Q87 (Designer 100%), Q88 (Analyst 100%) |
| "lawyers" -> function_ids ["14"] (broad discipline, not specific title) | Q95-Q96 (non-tech validation); "lawyers" is a discipline like "engineers" |
| "recruiters" -> function_ids ["12"] | Case 41 QA comparison: v2 correctly uses function_ids |

## RULE 2 -- Location

| Rule | Evidence Queries |
|------|-----------------|
| City = metro area | Q11 (SF = Bay Area), Q52 |
| State/country works | Q11, Q52 |
| Abbreviations unreliable ("CA" matches Canada) | Q52 |
| Multiple locations = OR | Q78 |

## RULE 3 -- Company

| Rule | Evidence Queries |
|------|-----------------|
| Company name in search_query returns ~95% fewer results | Q20 (777 vs thousands with URL) |
| past_companies accepts raw company names | Q59, Q60 |

## RULE 4 -- School

| Rule | Evidence Queries |
|------|-----------------|
| Full names required; abbreviations return ZERO | Q39 (Stanford University works), Q40 ("MIT" = 0), Q41 (full MIT name works) |
| Multiple schools = OR | Q79 |

## RULE 5 -- Seniority

| Rule | Evidence Queries |
|------|-----------------|
| VP (300) = HIGH accuracy (100%) | Q22, Q23 |
| CXO (310) = HIGH accuracy | Q22 |
| Director (220) = HIGH accuracy (96%) | **Q93** (22/23 correct, only 1 VP leak) |
| Manager (200, 210) = HIGH accuracy (100%) | **Q94** (23/23 correct) |
| Senior (120) = LOW accuracy (LinkedIn's guess) | Q21 |
| NEVER use "120" as inclusion; use exclude_seniority_level_ids: ["110"] instead | Q21 (120 unreliable), Q34 (exclude seniority works), Case 66 QA |
| Exclude seniority works reliably | Q34 |

## RULE 6 -- Function IDs

| Rule | Evidence Queries |
|------|-----------------|
| Sales (25) = 93%+ precision | Q17 |
| Engineering (8) = 93%+ precision | Q24 |
| Product Mgmt (19) = 93%+ precision | Q25 |

## RULE 7 -- Company Size

| Rule | Evidence Queries |
|------|-----------------|
| Company headcount classification works but not perfectly exclusive for large companies with sub-entities | Q26, Q27, Q75-Q77 |

## RULE 8 -- Experience

| Rule | Evidence Queries |
|------|-----------------|
| years_of_experience_ids accuracy | Q44, Q45, Q68-Q70 |

## RULE 9 -- Recently Changed Jobs

| Rule | Evidence Queries |
|------|-----------------|
| ~90 days window, works reliably | Q42, Q43 |

## RULE 10 -- searchQuery Booleans

| Rule | Evidence Queries |
|------|-----------------|
| AND works | **Q61** (terraform AND kubernetes = 8,454) |
| OR works | **Q63** (terraform OR rust = 21,894) |
| NOT works | **Q99** (kubernetes NOT devops = 28,080, 34% reduction) |
| Parenthetical grouping works | **Q100** ((terraform OR kubernetes) AND python = 8,206) |
| Matches broadly (title, headline, summary, hidden skills) | Q1-Q7, Q47-Q48 |
| Page 1 front-loads most relevant results | **Q81-Q83** (20% visible match page 1, 0% page 5/10) |
| searchQuery + structured filters = AND logic | Q4, Q5, Q89-Q90 |

## RULE 11 -- Exclude Filters

| Rule | Evidence Queries |
|------|-----------------|
| Exclude matching is SUBSTRING-BASED | **Q91** (excludeCurrentJobTitles ["Manager"] removed ALL *Manager titles) |
| Specific exclude strings work precisely | **Q92** (["Senior Software Engineer"] removed Senior SWE, left Staff SWE) |
| excludeLocations works | Q33 |
| excludeSeniorityLevelIds works | Q34 |
| excludeFunctionIds works | Q54 |

## Staff/Lead Engineers Pattern

| Rule | Evidence Queries |
|------|-----------------|
| Title fuzzy matching returns Senior/Staff/Lead variants for "Software Engineer" | Q8-Q10 |
| "Staff Software Engineer" as current_job_titles is a valid specific title | Q92 (exclude test showed Staff SWE survives Senior SWE exclude) |

## Pagination

| Rule | Evidence Queries |
|------|-----------------|
| Stable through page 20, no degradation | Q35-Q37, Q71-Q72 |
| Results capped at 2,500 items per query | Q98 |

## Non-Tech Validation

| Rule | Evidence Queries |
|------|-----------------|
| Finance/consulting roles work identically | Q88 (Goldman Analyst), Q95 (Goldman IBA), Q96 (McKinsey Associate) |
