# Apify LinkedIn People Search Scraper -- Alternatives Report

Last updated: 2026-04-13

## Current Actor: `harvestapi/linkedin-profile-search`

| Attribute | Value |
|-----------|-------|
| Pricing | $0.10/page (25 profiles/page), $4/1K profiles in Short mode |
| Latency | ~6s per page |
| Cookies required | No |
| Filters | Full structured filter set: searchQuery, locations, currentCompanies (URL), pastCompanies, schools, currentJobTitles, pastJobTitles, firstNames, lastNames, seniorityLevelIds, functionIds, companyHeadcount, yearsOfExperienceIds, yearsAtCurrentCompanyIds, recentlyChangedJobs, profileLanguages, companyHeadquarterLocations, plus all exclude variants |
| Returned fields (Short) | linkedinUrl, firstName, lastName, summary, openProfile, premium, pictureUrl, currentPositions (companyName, companyLinkedinUrl, title, tenureAtPosition, tenureAtCompany, startedOn), location.linkedinText, _meta.pagination |
| Pagination | startPage (1-100), takePages (1-100), maxItems |
| Max results | 2,500 per query (100 pages x 25) |
| Open source | Yes (GitHub: HarvestAPI/apify-linkedin-profile-search) |
| Rating | High usage, frequently referenced in "best of" lists |

This is the baseline everything else is compared against.

---

## Contender 1: `bebity/linkedin-premium-actor`

**Full name:** "Linkedin Companies & Profiles Bulk Scraper"

| Attribute | Value |
|-----------|-------|
| Pricing | $29.00/month subscription + usage costs (per-profile pricing unclear from public docs) |
| Cookies required | No |
| Rating | 4.1/5 (43 reviews), 177 total users, 15K bookmarks |
| Issue response time | 37 days (slow) |

**What it does:** Bulk scraper for both company pages and individual profiles. You give it keywords, names, or company names and it searches + scrapes profiles.

**Filter support compared to ours:**
- Supports keyword/name search and company-based search
- Does NOT appear to expose the same granular structured filters (seniorityLevelIds, functionIds, companyHeadcount, yearsOfExperienceIds, etc.) as individual input parameters
- Unclear whether it maps to LinkedIn's Sales Navigator-style filters or just does keyword-based discovery

**Returned fields:** Claims "comprehensive profiles" including full work experience. This is richer than our Short mode, but at what cost and latency?

**Notable issues from the Apify issues page:**
- Reports of requests failing entirely
- Refund requests about showcase pages not working
- 37-day average issue response time suggests maintenance may not be active

**Verdict: NOT RECOMMENDED.**
- Monthly subscription adds fixed cost we don't need
- Filter set appears less granular than HarvestAPI
- Slow issue response and reliability complaints are red flags
- The "bulk" approach (keywords in, profiles out) gives us less control than structured filters
- We would lose the precise filter combinations (seniority + function + company + location) that our system prompt depends on

---

## Contender 2: `curious_coder/linkedin-people-search-scraper`

**Full name:** "Linkedin people search scraper"

| Attribute | Value |
|-----------|-------|
| Pricing | Not publicly listed; likely pay-per-use |
| Cookies required | Optional (basic mode: no cookies; advanced features: requires LinkedIn session cookie) |
| Max results | 1,000 per search (vs our 2,500) |

**How it works:** You perform a search on LinkedIn, copy the full URL from the address bar, and pass it to the actor. The actor scrapes the results from that URL.

**Filter support compared to ours:**
- This is a URL-passthrough model, NOT a structured filter model
- You construct the LinkedIn search URL yourself (with LinkedIn's own URL parameters) and the actor just scrapes whatever that URL returns
- In theory, this means it supports whatever LinkedIn's search supports, but your code would need to construct LinkedIn search URLs manually rather than passing structured JSON parameters
- No equivalent to our `currentCompanies` (LinkedIn URL), `seniorityLevelIds`, `functionIds`, etc. as named input parameters

**Returned fields:** Profile data from search results (name, title, location, headline). Unclear if it returns companyLinkedinUrl, tenure data, or the same structured position objects we rely on.

**Notable concerns:**
- URL-passthrough model means we'd need to reverse-engineer LinkedIn's URL parameter format and maintain it when LinkedIn changes their URL scheme
- Cookie requirement for advanced features is a dealbreaker -- we specifically chose a no-cookie solution to avoid account risk
- 1,000 result cap is 60% lower than our current 2,500
- No open-source repo visible; harder to debug

**Verdict: NOT RECOMMENDED.**
- URL-passthrough model is fragile and requires maintaining LinkedIn URL format knowledge
- Lower result cap (1,000 vs 2,500)
- Cookie dependency for advanced features introduces account risk
- We would need to completely rewrite our parameter-to-query translation layer
- No clear advantage in cost, latency, or data quality

---

## Contender 3: `anchor/linkedin-people-finder`

**Full name:** "LinkedIn Profile URL People Finder"

| Attribute | Value |
|-----------|-------|
| Pricing | $0.10/page (25 items) with deduplication; Short mode $4/1K, Full mode $8/1K |
| Cookies required | No |

**How it works:** Finds LinkedIn profile URLs from lists of people names. Supports general search query (fuzzy), location segmentation, and some filters.

**Filter support compared to ours:**
- General searchQuery (fuzzy)
- Locations (with automatic country-level segmentation for large result sets)
- Current and past job titles (described as "exact search" -- different from HarvestAPI's fuzzy matching)
- Does NOT appear to support: seniorityLevelIds, functionIds, companyHeadcount, yearsOfExperienceIds, yearsAtCurrentCompanyIds, recentlyChangedJobs, exclude filters, companyHeadquarterLocations
- Unclear on currentCompanies (LinkedIn URL) support

**Returned fields:** LinkedIn URLs and basic profile data. Short mode returns basic info; Full mode includes work experience, education, skills.

**Notable features:**
- Automatic query segmentation by country -- useful for global searches where you'd otherwise hit the 2,500 result cap
- Built-in deduplication

**Notable concerns:**
- Primary use case is "name to LinkedIn URL" resolution, not structured people search
- Missing most of the advanced filters we depend on (seniority, function, headcount, experience)
- "Exact search" for job titles could be a disadvantage -- we rely on fuzzy matching to capture Senior/Staff/Lead variants
- No exclude filters

**Verdict: NOT RECOMMENDED as a primary replacement.**
- Missing too many filters we depend on (seniority, function, headcount, experience)
- Different primary use case (name resolution vs. structured search)
- The auto-segmentation feature is interesting but doesn't compensate for the filter gap
- Could potentially serve as a supplementary tool for name-to-URL lookups, but that's a different use case

---

## Contender 4: `powerai/linkedin-peoples-search-scraper`

**Full name:** "LinkedIn People Search Scraper"

| Attribute | Value |
|-----------|-------|
| Pricing | Not publicly listed; similar actors from PowerAI charge ~$4.99/1K results |
| Cookies required | No |

**Filter support compared to ours:**
- Name, job title, company, school, location, industry
- Multi-page handling
- Unclear whether it exposes seniorityLevelIds, functionIds, companyHeadcount, or other LinkedIn Sales Navigator-style filters as structured parameters
- Includes a scrapedAt timestamp (minor feature)

**Returned fields:** "Comprehensive profile information including contact details and work history" -- suggests richer data than our Short mode, but unverified.

**Notable concerns:**
- Relatively new/less established actor (less community validation)
- Filter documentation is sparse -- unclear if "industry" maps to functionIds or is something different
- No pricing transparency
- No open-source repo visible

**Verdict: INSUFFICIENT DATA to recommend.**
- Sparse documentation makes it hard to evaluate filter parity
- No pricing transparency
- Would need to run test queries to evaluate data quality and filter behavior
- Not enough community validation to trust for production use

---

## Contender 5: `logical_scrapers/linkedin-people-search-scraper`

**Full name:** "Linkedin People Search Scraper: generate leads from Linkedin"

| Attribute | Value |
|-----------|-------|
| Pricing | Not publicly listed |
| Cookies required | No |

**Filter support:** Claims "advanced filtering including industry, location, company, experience, and more." Specifics unclear from public documentation.

**Verdict: INSUFFICIENT DATA.** Same concerns as PowerAI -- sparse docs, no pricing, unclear filter parity.

---

## Contender 6: `supreme_coder/linkedin-profile-scraper`

**Full name:** "Linkedin Profile Scraper -- No cookie -- $3/1k"

| Attribute | Value |
|-----------|-------|
| Pricing | Advertised $3/1K profiles (but there are user complaints about pricing discrepancy between title and actual costs) |
| Cookies required | No |

**Important distinction:** This is a profile SCRAPER, not a people SEARCH actor. It takes LinkedIn profile URLs as input and returns profile data. It does not perform searches. This means it could replace our Apify enrichment step but NOT our discovery/search step.

**Verdict: WRONG CATEGORY.** Not a search tool. Could potentially be used downstream for enrichment, but not relevant to the search actor evaluation.

---

## Summary Comparison Matrix

| Actor | Cookies | Cost/1K (Short) | Structured Filters | Seniority/Function/Headcount | Exclude Filters | Max Results | Recommendation |
|-------|---------|-----------------|-------------------|------------------------------|-----------------|-------------|----------------|
| **harvestapi** (current) | No | $4.00 | Full set | Yes | Yes | 2,500 | **KEEP** |
| bebity | No | Unclear + $29/mo | Limited | Unclear | No | Unclear | No |
| curious_coder | Optional | Unclear | URL-passthrough | Via URL only | No | 1,000 | No |
| anchor | No | $4.00 | Partial | No | No | Unclear | No |
| powerai | No | ~$5.00 | Partial | Unclear | Unclear | Unclear | Insufficient data |
| logical_scrapers | No | Unclear | Partial | Unclear | Unclear | Unclear | Insufficient data |

---

## Recommendation

**Stay with `harvestapi/linkedin-profile-search`.** None of the alternatives offer a compelling reason to switch:

1. **Filter parity:** No alternative matches HarvestAPI's full structured filter set. We depend on seniorityLevelIds, functionIds, companyHeadcount, yearsOfExperienceIds, and exclude filters -- most alternatives either don't support these or require URL-passthrough hacks.

2. **No-cookie requirement:** HarvestAPI works entirely without LinkedIn cookies. Several alternatives require cookies for advanced features, which introduces account ban risk.

3. **Cost:** At $0.10/page ($4/1K in Short mode), HarvestAPI is competitive. No alternative is meaningfully cheaper for equivalent functionality.

4. **Reliability:** HarvestAPI has an open-source GitHub repo, is actively maintained, and is consistently ranked in "best Apify actors" lists for 2026.

5. **Our research investment:** We have 84 queries of empirical data on how HarvestAPI's filters actually behave. Switching would mean re-running that entire research program.

**Potential future actions:**
- If HarvestAPI's latency (6s/page) becomes a bottleneck, investigate whether `anchor/linkedin-people-finder`'s auto-segmentation approach could be used for parallel querying
- If we need richer profile data (education, skills), consider using HarvestAPI's Full mode ($8/1K) or a downstream profile scraper like `supreme_coder` ($3/1K) for enrichment
- Monitor the Apify store quarterly for new entrants -- the LinkedIn scraper ecosystem evolves fast
