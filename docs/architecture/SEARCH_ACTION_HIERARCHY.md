# Discovery Flow — Complete Function Map

Every function that runs when the user clicks Search, grouped by call chain.


## Entry Point: User Clicks Search

```
SearchPageClient.handleSearch()
│
├── searchPeopleAction({ ...params, offset: 0 })          ← see MAIN FLOW below
│
├── if backgroundScrapeNeeded (Path B):
│   ├── scrapeNextPageAction()                             ← see SCRAPE FLOW below
│   └── searchPeopleAction({ ...params, offset: 0 })      ← re-fetch after scrape
│
└── fetch('/api/prescrape')                                ← fire-and-forget
    └── POST /api/prescrape/route.ts
        └── prescrapeAction()                              ← see PRESCRAPE FLOW below
```


## Entry Point: User Clicks Load More

```
SearchPageClient.handleLoadMore()
│
├── searchPeopleAction({ ...params, offset: nextOffset, excludePersonIds })
│
└── if backgroundScrapeNeeded (Path B):
    ├── scrapeNextPageAction()
    └── searchPeopleAction()                               ← re-fetch same offset
```


## MAIN FLOW: searchPeopleAction()

```
searchPeopleAction(input)
│
│ ── AUTH ──────────────────────────────────────────────────
├── getServerSession(authOptions)
├── prisma.user.findUnique()
├── getExcludedPersonKeys(userId)
│
│ ── NORMALIZE ────────────────────────────────────────────
├── normalizeSearchParams({ name, company, role, university, location })
│
│ ── QUERY DB ─────────────────────────────────────────────
├── findPeopleByFilters(filters)
│   ├── buildPersonWhereClause(filters)
│   │   ├── getCompanySearchTerms(company)
│   │   └── getRoleSearchTerms(role)
│   ├── prisma.person.findMany({ where, orderBy, skip, take: limit * 2 })
│   └── applyPostQueryFilters(people, company, excludePersonKeys)
│       ├── companiesMatch(personCompany, searchCompany)
│       └── excludePersonKeys filter
│
│ ── THREE-PATH DECISION (if results < 5) ─────────────────
├── findOrCreateScrapeProgress(normalizedParams)
├── getNextCsePageStart(lastCsePageScraped, cseExhausted)
│
├── PATH A (0 results, nextPage exists):
│   ├── processRefreshBatch(input, excludedKeys, nextPage)  ← see SCRAPER INTERNALS below
│   ├── updateScrapeProgress(progressId, pageScraped, urlCount, apiStats)
│   └── findPeopleByFilters({ ...filters, offset: 0 })     ← re-query after scrape
│
├── PATH B (1–4 results, nextPage exists):
│   └── sets backgroundScrapeNeeded = true                  ← returned to client
│
├── PATH C (5+ results):
│   └── (no scraping, return as-is)
│
│ ── RANK & BUILD RESULTS ─────────────────────────────────
├── rankCandidates(searchCriteria, people, mapFn, limit)
├── for each ranked person:
│   ├── prisma.userCandidate.upsert()
│   ├── generateEmailDraft(templateId, person, user)
│   │   └── getTemplate(templateId)
│   └── prisma.emailDraft.upsert()
│
│ ── FINALIZE ─────────────────────────────────────────────
├── hasMore = people.length >= limit
└── prisma.searchLog.create()

returns { results, searchMeta: { hasMore, nextOffset, backgroundScrapeNeeded, ... }, remainingDaily }
```


## SCRAPE FLOW: scrapeNextPageAction()

Called by client when backgroundScrapeNeeded = true.

```
scrapeNextPageAction(input)
├── getServerSession(authOptions)
├── getExcludedPersonKeys(userId)
├── normalizeSearchParams(input)
├── findOrCreateScrapeProgress(normalizedParams)
├── getNextCsePageStart(lastCsePageScraped, cseExhausted)
├── processRefreshBatch(input, excludedKeys, nextPage)      ← see SCRAPER INTERNALS below
└── updateScrapeProgress(progressId, pageScraped, urlCount, apiStats)

returns { newPeopleCount, hasMoreCsePages }
```


## PRESCRAPE FLOW: prescrapeAction()

Fire-and-forget via API route. Scrapes up to 3 more CSE pages.

```
prescrapeAction(input)
├── getServerSession(authOptions)
├── getExcludedPersonKeys(userId)
├── normalizeSearchParams(input)
└── loop (up to 3 iterations):
    ├── findOrCreateScrapeProgress(normalizedParams)
    ├── getNextCsePageStart(lastCsePageScraped, cseExhausted)
    ├── processRefreshBatch(input, excludedKeys, nextPage)
    └── updateScrapeProgress(progressId, pageScraped, urlCount, apiStats)

returns { pagesScraped }
```


## SCRAPER INTERNALS: processRefreshBatch()

The core scraping pipeline. Called by Paths A, scrapeNextPageAction, and prescrapeAction.

```
processRefreshBatch(input, excludedKeys, pageStart, batchLabel)
│
│ ── CSE DISCOVERY ────────────────────────────────────────
├── discoverLinkedInProfiles({ company, university, role, location, name, pageStart })
│
│ ── DEDUP AGAINST DB ─────────────────────────────────────
├── findPeopleByLinkedInUrls(linkedinUrls)
├── findPeopleByLinkedInUrls(urlsToScrape)                  ← second check for race conditions
│
│ ── CSE COMPANY PRE-FILTER ───────────────────────────────
├── resolveCompanyAliases(input.company)                     ← hardcoded → DB → LLM (persisted)
├── filter urlsToScrape by resolved aliases + companiesMatch() fallback
│
│ ── SCRAPE LINKEDIN ──────────────────────────────────────
├── scrapeLinkedInProfiles(urlsToScrape, { onBatchComplete })
│   └── onBatchComplete callback:
│       └── saveScrapedProfile(profile, url, title, snippet, domain, company, university)
│
│ ── GENERATE EMAILS ──────────────────────────────────────
├── prisma.person.findMany({ id in savedPersonIds, email: null })
├── normalizeCompanyName(company)
├── for each company group:
│   ├── getOrLearnPattern(company)
│   ├── if no pattern:
│   │   └── bootstrapCompanyPattern(company, people)
│   ├── prisma.person.findMany({ remaining without emails })
│   ├── generateEmailFromPattern(firstName, lastName, pattern, domain)
│   └── if established pattern:
│   │   └── prisma.person.update({ email, emailStatus, emailConfidence })
│   └── if newly bootstrapped pattern:
│       ├── verifyEmailsBatch(emails)
│       └── prisma.person.update({ email, emailStatus, emailConfidence, emailDeliverable, ... })

returns { newPeopleCount, emailsGenerated, apolloCallsMade, savedPersonIds, urlsScraped, urlsFromCse }
```


## File Index

| Function                      | File                                       |
|-------------------------------|--------------------------------------------|
| SearchPageClient              | src/components/search/SearchPageClient.tsx  |
| SearchForm                    | src/components/search/SearchForm.tsx        |
| searchPeopleAction            | src/app/actions/search.ts                  |
| scrapeNextPageAction          | src/app/actions/search.ts                  |
| prescrapeAction               | src/app/actions/search.ts                  |
| processRefreshBatch           | src/app/actions/search.ts                  |
| generateEmailDraft            | src/app/actions/search.ts                  |
| getTemplate                   | src/app/actions/search.ts                  |
| POST /api/prescrape           | src/app/api/prescrape/route.ts             |
| getExcludedPersonKeys         | src/lib/db/person-service.ts               |
| findPeopleByFilters           | src/lib/db/person-service.ts               |
| buildPersonWhereClause        | src/lib/db/person-service.ts               |
| applyPostQueryFilters         | src/lib/db/person-service.ts               |
| getCompanySearchTerms         | src/lib/db/person-service.ts               |
| getRoleSearchTerms            | src/lib/db/person-service.ts               |
| companiesMatch                | src/lib/db/person-service.ts               |
| findPeopleByLinkedInUrls      | src/lib/db/person-service.ts               |
| saveScrapedProfile            | src/lib/db/person-service.ts               |
| normalizeSearchParams         | src/lib/db/search-cache.ts                 |
| findOrCreateScrapeProgress    | src/lib/db/search-cache.ts                 |
| updateScrapeProgress          | src/lib/db/search-cache.ts                 |
| getNextCsePageStart           | src/lib/db/search-cache.ts                 |
| isCsePageExhausted            | src/lib/db/search-cache.ts                 |
| discoverLinkedInProfiles      | src/lib/services/discovery.ts              |
| scrapeLinkedInProfiles        | src/lib/services/linkedin-scraper.ts       |
| rankCandidates                | src/lib/services/ranking.ts                |
| getOrLearnPattern             | src/lib/services/email-pattern.ts          |
| bootstrapCompanyPattern       | src/lib/services/email-pattern.ts          |
| generateEmailFromPattern      | src/lib/services/email-pattern.ts          |
| normalizeCompanyName          | src/lib/services/email-pattern.ts          |
| resolveCompanyAliases         | src/lib/services/company-alias.ts          |
| verifyEmailsBatch             | src/lib/services/email-verification.ts     |
