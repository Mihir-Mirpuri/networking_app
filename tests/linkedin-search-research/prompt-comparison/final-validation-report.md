# Final Validation Report: v2 Search Extraction Prompt

**Date:** 2026-04-14T04:25:04.226Z
**Test cases:** 40
**Errors:** 0

## Overall Results

| Metric | Value |
|--------|-------|
| Total checks | 320 |
| Passed | 319 |
| Failed | 1 |
| Overall pass rate | 99.7% |

## Per-Check Pass Rates

| Check Type | Pass | Fail | Rate |
|------------|------|------|------|
| status_correct | 39 | 1 | 97.5% |
| title_routing | 40 | 0 | 100.0% |
| seniority_handling | 40 | 0 | 100.0% |
| role_specificity | 40 | 0 | 100.0% |
| school_expansion | 40 | 0 | 100.0% |
| location_expansion | 40 | 0 | 100.0% |
| no_company_in_searchquery | 40 | 0 | 100.0% |
| message_appropriate | 40 | 0 | 100.0% |

## Latency

| Metric | Value |
|--------|-------|
| Average | 1809ms |
| p50 | 1643ms |
| p95 | 2558ms |
| p99 | 8561ms |
| Max | 8561ms |

### Slow queries (>500ms)

- Case 1: "senior engineers at Google" -- 1643ms
- Case 2: "senior PMs at Meta" -- 8561ms
- Case 3: "junior developers at Stripe" -- 1504ms
- Case 4: "staff engineers at Netflix" -- 1686ms
- Case 5: "lead designers at Figma" -- 1422ms
- Case 6: "experienced data scientists at Amazon" -- 1445ms
- Case 7: "directors at Apple" -- 2180ms
- Case 8: "managers at Microsoft" -- 1579ms
- Case 9: "VP of engineering at Uber" -- 1549ms
- Case 10: "founders at Stripe" -- 2091ms
- Case 11: "software engineers at Stripe" -- 1652ms
- Case 12: "engineers at Figma" -- 1726ms
- Case 13: "product managers at Google" -- 1408ms
- Case 14: "designers at Airbnb" -- 1604ms
- Case 15: "recruiters at Meta" -- 1299ms
- Case 16: "lawyers at Cravath" -- 1723ms
- Case 17: "data scientists at Netflix" -- 1587ms
- Case 18: "HR at Amazon" -- 1426ms
- Case 19: "SREs at Datadog" -- 1309ms
- Case 20: "salespeople at Salesforce" -- 1357ms
- Case 21: "people who know Rust at Stripe" -- 1608ms
- Case 22: "ML specialists at Google" -- 1960ms
- Case 23: "Python and Kubernetes engineers at Amazon" -- 1721ms
- Case 24: "fintech people at Stripe" -- 1651ms
- Case 25: "blockchain experts at Coinbase" -- 1426ms
- Case 26: "MIT grads at Google" -- 1461ms
- Case 27: "ex-Google engineers at Anthropic" -- 1678ms
- Case 28: "people at Chase" -- 1817ms
- Case 29: "engineers at FAANG" -- 2085ms
- Case 30: "Find Sarah Johnson at Meta" -- 1030ms
- Case 31: "people who recently joined Stripe" -- 1384ms
- Case 32: "10+ year veterans at Apple" -- 1364ms
- Case 33: "non-management engineers at Google" -- 1815ms
- Case 34: "senior engineers at Uber not in California" -- 1790ms
- Case 35: "how's the weather?" -- 1269ms
- Case 36: "directors of engineering at Google" -- 2558ms
- Case 37: "engineering managers at Meta" -- 1933ms
- Case 38: "principal engineers at Amazon" -- 1622ms
- Case 39: "C-suite at Stripe" -- 1761ms
- Case 40: "investment banking analysts at Goldman Sachs" -- 1683ms

## Seniority Handling (CRITICAL)

All seniority cases where 120/110 should NOT be used as inclusion PASSED.

## Failed Cases Detail

### Case 28: "people at Chase"
- Category: edge_case
- Duration: 1817ms
- **FAIL [status_correct]**: expected="ready" got="needs_selection"
- Output status: needs_selection
- Output filters: {}
- **Analysis**: This is a BORDERLINE case, not a true failure. "Chase" is explicitly listed as an ambiguous company name in the prompt (company_name_ambiguous: true). The model returned needs_selection with selectables ["JPMorgan Chase", "Chase Bank"] which is a defensible disambiguation. The test expected "ready" but the model's behavior is arguably more correct for the user experience -- prompting for disambiguation avoids searching the wrong company. This should NOT block production readiness.

## Per-Category Results

- **seniority**: 10/10 cases fully passed (100%)
- **title_routing**: 10/10 cases fully passed (100%)
- **skill_keyword**: 5/5 cases fully passed (100%)
- **edge_case**: 9/10 cases fully passed (90%)
- **v2_specific**: 5/5 cases fully passed (100%)

## Determinism Check (5 critical cases x 3 runs)

All 5 critical seniority cases returned identical results across 3 consecutive runs:

| Case | Consistent | 120 in seniority | 110 in seniority | Routing |
|------|-----------|-----------------|-----------------|---------|
| "senior engineers at Google" | YES | no (correct) | no (correct) | titles: ["Software Engineer"], exclude_seniority: ["110"] |
| "staff engineers at Netflix" | YES | no (correct) | no (correct) | titles: ["Staff Software Engineer"], exclude_seniority: ["110"] |
| "directors at Apple" | YES | no (correct) | no (correct) | seniority: ["220"] |
| "VP of engineering at Uber" | YES | no (correct) | no (correct) | seniority: ["300"] |
| "principal engineers at Amazon" | YES | no (correct) | no (correct) | titles: ["Principal Engineer"] |

All results are deterministic. No low-reliability seniority IDs (120/110) used as inclusion in any run.

## Verdict

**PRODUCTION READY**

- Overall pass rate: 99.7% (>= 90%) -- 319/320 checks passed
- All 8 check types above 90%:
  - status_correct: 97.5%
  - title_routing: 100%
  - seniority_handling: 100%
  - role_specificity: 100%
  - school_expansion: 100%
  - location_expansion: 100%
  - no_company_in_searchquery: 100%
  - message_appropriate: 100%
- **ZERO critical seniority handling failures** (the most important metric)
- Determinism: 100% consistent across 15 repeated calls (5 cases x 3 runs)
- The single failure (case 28, "people at Chase") is a borderline ambiguity disambiguation -- the model's behavior is arguably more correct than the expected "ready" status
- p50 latency: 1643ms, p95 latency: 2558ms (LLM round-trip, not a concern for prompt correctness)
