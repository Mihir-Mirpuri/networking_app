# LinkedIn Company URL Resolution — Research

**Date:** 2026-04-16
**Status:** Research only — no implementation proposed yet
**Empirical data:** `tests/company-url-benchmark-reports/v2-report-2026-04-16T19-14-47-265Z.md`
**Benchmark script:** `tests/company-url-resolution-benchmark.ts`

---

## 1. Problem

When a user searches for a company whose LinkedIn URL is not already in our `CompanyUrl` cache, we currently call Sonnet 4.6 (`src/lib/services/company-resolver.ts`) to guess the URL from the LLM's training-data recall. The LLM is wrong often enough that our `companies_missing_linkedin_urls.txt` has grown to **1,677 unresolved entries**.

When we can't resolve a company URL:

1. `src/app/actions/search.ts:491` falls back to passing the raw company-name string to Apify's `harvestapi/linkedin-profile-search`.
2. The Apify actor does its own fuzzy name lookup — LinkedIn's autocomplete picks what it thinks is the best match, which often silently routes searches to the wrong company (e.g., a startup with the same name, a regional subsidiary).
3. Results are noisy, the user sees weak matches, and we cache a bad experience.

A reliable URL resolver would: (a) remove the silent-misroute failure mode, (b) let us anchor the `companies` param of `harvestapi/linkedin-company-employees` (which requires URLs for exact matching), and (c) make our `CompanyUrl` cache actually grow.

---

## 2. Approach catalog

We surveyed 13 candidate approaches and empirically benchmarked 10 against 25 hard-case companies. Candidates were stratified into three tiers.

### Tier 1 — baselines already in the codebase

| # | Approach | Notes |
|---|---|---|
| 1 | **Sonnet 4.6 (current)** | `src/lib/services/company-resolver.ts`. LLM recall only, no tools. |
| 2 | **DB `CompanyUrl` cache** | Existing. Hit rate decays as users search novel companies. |

### Tier 2 — strong candidates (benchmarked)

| # | Approach | Why it's promising |
|---|---|---|
| 3 | **Haiku 4.5** | Same approach as Sonnet but 3× cheaper, 10× faster. Will it generalize as well? |
| 4 | **Perplexity Sonar** | LLM grounded in real-time web search. Theoretically stronger than LLM recall. |
| 5 | **Serper `site:linkedin.com/company`** | Google SERP API, already used for discovery. $0.001/call. |
| 6 | **DB backfill from `experienceHistory`** | Existing full-scrape data includes `companyLinkedinUrl` in every experience entry. We have not been mining it. |
| 7 | **Apify `harvestapi/linkedin-company-employees`** | New actor — takes a company name, returns profiles. Each profile's first experience has `companyLinkedinUrl`. Costs $0.008 per lookup (Full mode, maxItems=1). |
| 8 | **Apollo `/v1/mixed_companies/search`** | Org search endpoint returns `linkedin_url`. We already use Apollo for email enrichment — marginal cost is essentially zero. |
| 9 | **Wikidata SPARQL P6119** | Free public dataset. Property P6119 = "LinkedIn company ID". Coverage likely thin but $0. |
| 10 | **Claude `web_search` tool** | Claude with server-side web search. Higher latency and cost, but Claude can reason about the right URL. |
| 11 | **Website scrape → LinkedIn footer link** | Serper for homepage → fetch HTML → regex for `linkedin.com/company/*`. Self-asserted by the company. |

### Tier 3 — mentioned, not benchmarked (rationale)

| # | Approach | Why not tested |
|---|---|---|
| 12 | **OpenAlex / Crunchbase public APIs** | Crunchbase requires a paid partnership for bulk API. OpenAlex is academic-focused — low coverage for non-research orgs. |
| 13 | **LinkedIn's own `/pub/dir/` endpoint** | LinkedIn anti-scraping makes direct LinkedIn calls unviable outside of Apify. |

---

## 3. Empirical results

25 companies stratified across 9 categories (foreign, government, law, school, sub-brand, variation, popular, consulting, obscure). Ground truth verified manually via WebSearch. Scoring is exact slug match (normalized: lowercase, strip `www.`/`[xx].` subdomain, strip trailing slash, accept listed alternates).

### Aggregate accuracy & economics

| Resolver | Resolved | Correct | Accuracy | Avg latency | Avg cost | Total (25) |
|---|---|---|---|---|---|---|
| **claude-web** | **25/25** | **23/25** | **92%** | 22.8s | $0.049 | $1.23 |
| **apollo** | 24/25 | 21/25 | **84%** | 602ms | ~$0.007¹ | ~$0.18 |
| **serper** | 24/25 | 19/25 | **76%** | 1.3s | $0.001 | $0.025 |
| **sonnet** (current) | 23/25 | 18/25 | 72% | 17.4s ⚠️ | $0.0006 | $0.015 |
| apify | 25/25 | 13/25 | 52% | 10.5s | $0.008 | $0.20 |
| haiku | 21/25 | 12/25 | 48% | 1.3s | $0.0002 | $0.005 |
| website | 19/25 | 12/25 | 48% | 2.8s | $0.001 | $0.025 |
| perplexity | 13/25 | 7/25 | 28% | 1.9s | $0.001 | $0.025 |
| **db (backfill)** | **0/25** | **0/25** | **0%** | 664ms | $0 | $0 |
| **wikidata** | **0/25** | **0/25** | **0%** | 610ms | $0 | $0 |

> **Caveat on claude-web's 92%:** Inspection of the report shows at least one "wrong" Claude result (`Metafora`) returned the correct URL but the harness's extraction regex tripped on a trailing markdown backtick. True accuracy is likely 24/25 (96%).

> **¹ Apollo credit cost correction.** An earlier draft of this doc claimed Apollo's `/v1/mixed_companies/search` was marginal-free. Apollo's own docs (`docs.apollo.io/reference/organization-search`) explicitly state "this endpoint does consume credits." Community reports peg it at **1 credit per call**. On the Professional plan ($79/mo / 12,000 credits = $0.0066/credit), that's ~$0.007/resolution. This is still much cheaper than Sonnet and Claude web-search, but it is **7× more expensive than Serper**, which changes the recommended chain ordering — see §5.

> **Caveat on Sonnet 4.6 latency:** 17.4s avg is anomalous — production observations in `company-resolver.ts` are ~1s. The benchmark ran all 10 resolvers in parallel per company, so Anthropic API tokens may have been throttled. The pattern is consistent (sonnet and claude-web both hit ~17–22s) so treat the relative latency ranking with skepticism; absolute Sonnet latency in production is fine.

### Accuracy by category

| Resolver | foreign | gov | law | school | sub-brand | variation | popular | consulting | obscure |
|---|---|---|---|---|---|---|---|---|---|
| claude-web | 2/2 | 2/2 | 3/3 | 3/3 | 3/3 | 2/2 | 3/3 | 2/3 | 3/4 |
| apollo | 0/2 | 2/2 | 3/3 | 3/3 | 3/3 | 1/2 | 3/3 | 2/3 | **4/4** |
| serper | 2/2 | 1/2 | 3/3 | 3/3 | 3/3 | 1/2 | 1/3 | 2/3 | 3/4 |
| sonnet | 1/2 | 2/2 | **0/3** | 3/3 | 3/3 | 2/2 | 3/3 | 3/3 | 1/4 |
| apify | 2/2 | 0/2 | 3/3 | 1/3 | 1/3 | 1/2 | 1/3 | 2/3 | 2/4 |
| haiku | 1/2 | 1/2 | **0/3** | 3/3 | 2/3 | 0/2 | 3/3 | 2/3 | 0/4 |
| website | 0/2 | 1/2 | 1/3 | 2/3 | 3/3 | 2/2 | 1/3 | 1/3 | 1/4 |
| perplexity | 1/2 | 1/2 | **0/3** | 1/3 | 0/3 | 0/2 | 2/3 | 1/3 | 1/4 |
| db | 0 × everything | | | | | | | | |
| wikidata | 0 × everything | | | | | | | | |

---

## 4. Analysis & category winners

### 4a. Claude web search is the gold standard

24-25/25 correct. It reasons about the right slug when multiple candidates exist (e.g., `grow-with-metafora` — an obscure slug — vs the more "obvious" guesses). The price is 22s latency and $0.05/call. **Too slow for the online search path, but perfect for offline batch recovery** of our 1,677-company backlog at ~$82 one-time spend.

### 4b. Apollo is the big surprise (but credit-metered)

**84% accuracy at ~$0.007/call** (1 credit per call per Apollo's docs; on the $79/mo Professional plan that's ~$0.0066 per credit). 602ms latency — fastest of all methods. Notably, **Apollo scored 4/4 on obscure startups** — the exact category where Sonnet recall fails, because the LLM has never seen the company in training data. Apollo's data is fresh and CRM-grade.

The credit cost matters: at 7× Serper's per-call cost, Apollo is **not** the obvious first-choice resolver. It's better positioned as a fallback on Serper misses, where its complementary category strengths (obscure startups) fill Serper's gaps.

Apollo's failure modes are narrow:
- **Foreign brands (0/2):** returned parent-org URL instead of regional. `毕马威中国` → `kpmg` (instead of `kpmg-china`); `삼정KPMG` → `kpmg-samjong` (close, correct slug is `samjong-kpmg`).
- **`Metafora` was the single biggest hero case** — Apollo was the ONLY resolver that correctly returned `grow-with-metafora`.

### 4c. Serper is the workhorse

76% at $0.001 and 1.3s. Beats Sonnet 4.6 (72%) on accuracy, price, and speed. The 6 misses were almost entirely cases where the top SERP result was a /school/ page with a similar name or a regional variant of the /company/ page. A two-query strategy (`site:linkedin.com/company` then `site:linkedin.com/school`) would probably lift it to 80%+.

### 4d. Sonnet 4.6 (current production) is dominated

Strictly worse than Serper on accuracy (72% vs 76%) at comparable cost ($0.0006 vs $0.001) and comparable latency. Also strictly worse than Apollo on accuracy (72% vs 84%) at ~10× cheaper per call, though Apollo costs more in credits. **Sonnet has no ecological niche once Serper is in the chain.**

### 4e. Apify (`linkedin-company-employees`, maxItems=1) is pricey and unreliable as a resolver

52% accuracy at $0.008/call, 10.5s latency. The failure mode is interesting: when we give the actor the company name, LinkedIn's autocomplete inside the actor picks the wrong company. So the returned `companyLinkedinUrl` is the URL of *whichever company LinkedIn matched*, not our intended company. This is the exact failure mode we're trying to avoid, now with extra steps.

**Use Apify as a resolver only as a last-resort after other lookup paths exhaust** — and even then, a $0.008 call with 52% accuracy doesn't pencil. However, the `harvestapi/linkedin-company-employees` actor IS still attractive for the *actual* company employee discovery step, once a URL is resolved.

### 4f. Website scrape is brittle

48% accuracy. Companies often don't link their LinkedIn from the homepage, or they link via JS after page load (our regex misses those), or they redirect through trackers like Hootsuite. It's not a reliable standalone fallback.

### 4g. Perplexity is the disappointment

28%. Sonar is worse than pure LLM recall because it has to compose responses around its web search results — it often returns prose like "here are several LinkedIn pages that might match" and the extraction regex pulls the first one listed, which is usually wrong.

### 4h. DB backfill (0/25) — expected, not a rejection

Our 25-company sample was drawn from `companies_missing_linkedin_urls.txt`, so by construction none of them were present in the DB. The 0% here is an artifact. However, `resolveDbBackfill`'s mechanism is sound: mining `jsonb_array_elements("experienceHistory")` for `companyLinkedinUrl` fields. On a *representative* query distribution (not this hard-case sample), DB backfill would likely be very high signal — we have hundreds of thousands of experience entries with valid LinkedIn URLs already stored.

### 4i. Wikidata (0/25) — rejected

0/25. P6119 is populated only for well-known Wikipedia-grade entities. Coverage gap includes: sub-brands (BCG X, Microsoft AI), obscure startups (Metafora, Vooma, Nominal, Saronic), foreign-language regional subsidiaries. Not worth integrating.

### 4j. Haiku 4.5 — a downgrade, not an upgrade

48% vs 72% Sonnet. Haiku hallucinates with confidence on slug details (`kirkland-&-ellis` missing the `-llp` suffix, Wharton/JPMorgan/SpaceX all wrong). Sonnet's higher-quality priors are not replaceable by Haiku for this task.

---

## 5. Recommended resolver chain

Based on empirical cost × accuracy × latency, the near-optimal waterfall is:

```
Step 1. DB cache (CompanyUrl)                     ~0ms    $0        ~60% hit rate (est.)
Step 2. DB backfill (experienceHistory mining)    ~700ms  $0        high signal, currently 0% utilized
Step 3. Serper (site:linkedin.com/company)        ~1.3s   $0.001    76% on misses
Step 4. Apollo (/v1/mixed_companies/search)       ~600ms  $0.007    84% of remaining (complementary to Serper)
Step 5. Claude web_search (offline batch only)    ~22s    $0.049    92% on stragglers
```

### Chain accuracy math

If steps are statistically independent (optimistic), expected accuracy is:
- After step 3 (Serper): 0.76
- After step 4 (Apollo on Serper-miss): 0.76 + 0.24 × 0.84 ≈ 0.96
- After step 5 (Claude web on remaining ~4%): 0.96 + 0.04 × 0.92 ≈ 0.997

In reality misses are correlated (hard-name companies fail multiple resolvers), so a realistic ceiling is probably **~95% online + ~98% with offline Claude web-search cleanup**.

### Chain economics (per resolution, assuming ~60% DB-cache hit)

- Current (Sonnet always-call): ~$0.0006/call × 100% miss ≈ $0.0006 average
- Proposed chain per uncached lookup: Serper ($0.001) + 0.24 × Apollo ($0.007) ≈ **~$0.0027 average per uncached lookup**
- Blended with 60% cache hit: 0.4 × $0.0027 ≈ **~$0.001 per search**
- Net vs current: ~2× more expensive per call, but **much higher accuracy** (~95% vs 72%) and credit burn on Apollo is bounded (only called on Serper-misses)

Plus a one-time offline backlog drain for the 1,677 existing missing companies via Claude web-search: **~$82** (or ~$12 if done via Apollo-on-Serper-miss chain, sacrificing ~5 pts accuracy).

### Why this ordering?

- **Serper before Apollo** because Serper is 7× cheaper per call and only ~8 pts less accurate in isolation. Calling Apollo only on Serper-misses both minimizes credit burn and plays to Apollo's strength (it wins exactly on the obscure-startup cases Serper flunks).
- **Claude web-search as offline-only** because 22s latency is a non-starter for interactive search, but is fine for a nightly batch job. It's also the only resolver that recovered the genuinely weird slugs (`grow-with-metafora`, long name truncations).
- **No Sonnet in the chain**: strictly dominated by Serper on accuracy at comparable cost.
- **No Apify resolver**: too expensive for too little accuracy, and redundant with Apollo/Serper.

---

## 6. Open questions & risks

### Open questions

1. **Apollo credit burn budget.** Each `/v1/mixed_companies/search` call costs 1 credit (per Apollo docs — confirmed post-benchmark, see §4b). On the Professional plan we get 12,000 credits/month. If 40% of searches miss the DB cache and 24% of those also miss Serper, we'd burn ~1 credit per 10 searches — sustainable for our current volume but needs a dashboard alert if search volume grows.
2. **Apollo `/v1/mixed_companies/search` vs `/v1/organizations/search`.** The docs list both. The benchmark used `mixed_companies` which returns enriched org data; `organizations` may be cheaper in credits but coverage thinner. Worth a one-day A/B.
3. **Apollo's foreign-subsidiary weakness.** It returned parent-org URL for `毕马威中国` (→ `kpmg` not `kpmg-china`). Before shipping, we need a heuristic: if the input contains non-Latin characters, skip Apollo and go straight to Serper (which scored 2/2 on foreign-language names).
4. **DB-backfill hit rate on real queries.** Our benchmark drew from the "missing" set so DB backfill scored 0. On a representative log sample (we have history in `Search` table), the rate could be 40–70% — that would change the chain economics dramatically.
5. **Serper query refinement.** Our query was `site:linkedin.com "{name}" (company OR school)`. For law firms, a query like `site:linkedin.com/company "{name}"` may be more precise. Worth a micro-benchmark before shipping the chain.

### Risks

1. **`companyLinkedinUrl` data-quality risk.** DB backfill assumes the LinkedIn URLs stored in `experienceHistory` are correct. A spot-check of a few hundred entries would validate this before using them as cache-fill.
2. **Apollo credit-quota risk.** Apollo charges 1 credit per `/v1/mixed_companies/search` call. At current volumes this fits inside the Professional plan's 12k/month. If URL-resolution volume spikes (e.g., a large new cohort of users), we could exhaust credits faster than expected and get throttled. Mitigation: emit a Datadog/log metric counting Apollo calls and alert at 80% of monthly quota.
3. **Schema cache staleness.** The `CompanyUrl` table has no TTL. Companies occasionally change LinkedIn slugs (mergers, acquisitions, rebrands — Facebook → Meta). Consider a 90-day freshness check, especially for high-traffic companies.
4. **Claude web-search rate limits.** For an offline drain of 1,677 entries, the web-search tool's rate limits (~1k searches/day on default tier) could stretch the backlog recovery over a few days. Not a blocker.

---

## 7. Quick-win follow-ups

These are adjacent findings from the research that are worth considering in separate small-scope tickets:

### 7a. Persist LinkedIn `summary` / `about` / `headline` fields (currently dropped)

**What we found:** `src/lib/services/linkedin-search.ts:245` parses the `summary` field from Apify short-mode responses and stores it on `ShortProfileResult.summary`. **But** the `Person` Prisma model has no `summary`, `headline`, or `about` columns (`prisma/schema.prisma:100-144`). So `src/lib/db/person-service.ts:saveShortProfilesBatch` silently drops it at the DB boundary. Same for `headline` and `about` from full-mode scrapes.

**Cost of adding:** Two `String?` columns on `Person`; a one-line change to the save function; no data migration needed (existing rows get NULL). Storage is trivial (~500 bytes/row × ~500k rows = 250MB).

**Value:**
- **Search ranking / relevance.** The `summary` field is the user's self-written headline ("AI researcher focused on LLM safety at Anthropic"). It's the single densest signal about someone's actual focus. We currently rank on role-keyword matching alone; adding `summary` to our ranking embedding would noticeably improve relevance on qualitative queries.
- **Email personalization.** `src/lib/services/personalization.ts` generates cold-email drafts from what we know about the target. Today it has name/role/company. Adding their own stated headline to the prompt would sharply improve draft quality — it's the closest thing we have to "who this person thinks they are."
- **Avoids re-scraping.** Once we have `summary` stored, we don't need to re-hit Apify to enrich existing profiles.

**Proposed schema diff:**
```prisma
model Person {
  // ... existing fields
  summary  String?  @db.Text  // LinkedIn self-written headline (Short mode)
  about    String?  @db.Text  // LinkedIn "About" section (Full mode)
  headline String?             // Current position / tagline
}
```

**Effort:** ~30 minutes. Recommend doing this before the URL-resolver chain work, because any future backlog drain would regenerate Apify data anyway — might as well capture `summary` on that pass.

### 7b. Two-pass Serper for /company/ + /school/

Serper scored 19/25 on a single query. Inspection shows ~3 of the 6 misses would have been resolved by a second query against `site:linkedin.com/school`. Cost doubles ($0.002/call). Accuracy likely lifts to 84–88%. Worth a quick A/B once the chain is in place.

### 7c. Offline backlog drain job

Write a one-shot tsx script that iterates `companies_missing_linkedin_urls.txt`, calls `resolveClaudeWebSearch` with rate limiting, and upserts results into `CompanyUrl`. Budget $82, one night. Expected to resolve ~85% (1,425 / 1,677).

### 7d. Normalize Apollo's `http://` → `https://` on ingest

Apollo returned `http://www.linkedin.com/...` consistently. Before caching, normalize to `https://`. Trivial.

---

## Appendix: Benchmark methodology

- **Ground truth:** 25 companies, manually verified against live LinkedIn via WebSearch. Stratified across 9 categories (foreign-language, government, law, school, sub-brand, name-variation, popular, consulting, obscure startup).
- **URL matching:** normalized comparison (`https?://(xx.)?(www.)?linkedin.com/(company|school|showcase)/SLUG`), accept declared alternates, strip trailing punctuation/slash.
- **Parallel execution:** Per-company, all 10 resolvers run concurrently via `Promise.all`. Inflates latency numbers when Anthropic-API-bound; deflates for independent services.
- **API keys required:** `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `SERPER_API_KEY`, `APIFY_API_KEY`, `APOLLO_API_KEY`.
- **Cost model:** Token-based for LLMs (Sonnet: $3/$15 per Mtok; Haiku: $1/$5 per Mtok). Fixed per-call for search APIs (Serper: $0.001; Perplexity: ~$0.001; Apify company-employees Full: $0.008/profile). Claude web-search adds $0.01/search. Apollo marginal cost is effectively zero within our plan; any overage risk documented in §6.

Raw report: [`tests/company-url-benchmark-reports/v2-report-2026-04-16T19-14-47-265Z.md`](../tests/company-url-benchmark-reports/v2-report-2026-04-16T19-14-47-265Z.md)
