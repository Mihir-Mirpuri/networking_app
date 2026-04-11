# Apify LinkedIn Profile Search Mass Scraper

**Actor:** `harvestapi/linkedin-profile-search`

## Overview

Powerful tool to search all LinkedIn Profiles and filter by companies, job titles, locations, and more. Can find and scrape nearly everyone on LinkedIn with results up to 2500 per query (or 100,000+ with automatic query segmentation).

### Related Actors
- **LinkedIn Profile Search by services** — cheaper, no rate limits, larger scale, but fewer filters
- **Profile Search by name** — searches by full name
- **LinkedIn Profile Scraper** — scrapes profiles by URL

## Profile Scraper Modes

| Mode | Description | Cost |
|------|-------------|------|
| **Short** | Scrapes only search pages, basic profile data (up to 25 results per page) | $0.10/search page |
| **Full** | Short + opens each profile link for full details | $0.10/page + $0.004/profile |
| **Full + email search** | Full + attempts to find email addresses (SMTP validated) | $0.10/page + $0.01/profile |

**Note:** Email search is independent — emails are not extracted from LinkedIn directly. Not guaranteed to find an email for every profile. Adaptive cost: if profile isn't complete enough for email search, no charge.

## Input Parameters

### Profile Scraper Mode
- **profileScraperMode** — `string`, optional, default: `"Full"`
  - Options: `"Short"`, `"Full"`, `"Full + email search"`

### Search
- **searchQuery** — `string`, optional, max 300 chars. General fuzzy search supporting operators (e.g., "Founder", "Marketing Manager", "John Doe")
- **maxItems** — `integer`, optional. Maximum profiles to scrape. Actor stops when limit is reached.

### Primary Filters
- **locations** — `array`, optional, max 70 items. Current locations (e.g., "New York", "San Francisco")
  - Note: LinkedIn may misinterpret short queries (e.g., "UK" → "Ukraine", use "United Kingdom")
- **currentCompanies** — `array`, optional, max 50 items. LinkedIn Company URLs for current employment
- **pastCompanies** — `array`, optional, max 50 items. LinkedIn Company URLs for past employment
- **schools** — `array`, optional, max 50 items. School names (e.g., "Stanford University")
- **currentJobTitles** — `array`, optional, max 50 items. Current job titles (exact search)
- **pastJobTitles** — `array`, optional, max 50 items. Past job titles (exact search)
- **firstNames** — `array`, optional, max 50 items. Filter by first names (recommend `linkedin-profile-search-by-name` actor for name searches)
- **lastNames** — `array`, optional, max 50 items. Filter by last names
- **yearsOfExperienceIds** — `string[]`, optional. Total years of experience IDs
- **yearsAtCurrentCompanyIds** — `string[]`, optional. Years at current company IDs
- **seniorityLevelIds** — `string[]`, optional. Seniority level IDs (e.g., `"120"` for Senior)
- **functionIds** — `string[]`, optional. Function IDs (e.g., `"8"` for Engineering)
- **industryIds** — `array`, optional, max 50 items. LinkedIn industry IDs (numbers only)
- **profileLanguages** — `string[]`, optional. Filter by profile languages
- **companyHeadcount** — `string[]`, optional. Filter by current company headcount
- **companyHeadquarterLocations** — `array`, optional, max 70 items. Filter by company HQ location
- **recentlyChangedJobs** — `boolean`, optional. Only profiles who recently changed jobs

### Exclude Filters
- **excludeLocations** — `array`, optional, max 70 items
- **excludeCurrentCompanies** — `array`, optional, max 50 items. LinkedIn Company URLs
- **excludePastCompanies** — `array`, optional, max 50 items. LinkedIn Company URLs
- **excludeSchools** — `array`, optional, max 50 items. School names
- **excludeCurrentJobTitles** — `array`, optional, max 50 items
- **excludePastJobTitles** — `array`, optional, max 50 items
- **excludeIndustryIds** — `array`, optional, max 50 items
- **excludeSeniorityLevelIds** — `string[]`, optional
- **excludeFunctionIds** — `string[]`, optional
- **excludeCompanyHeadquarterLocations** — `array`, optional, max 70 items

### Pagination
- **startPage** — `integer`, optional, min 1, max 100, default: 1
- **takePages** — `integer`, optional, min 0, max 100. Each page contains 25 profiles

### Automatic Query Segmentation
- **autoQuerySegmentation** — `boolean`, optional. Split broad queries into smaller segments
- **autoQuerySegmentationLevels** — `string[]`, optional. Segmentation levels to use
- **autoQuerySegmentationTargetCountries** — `string[]`, optional. Target countries for segmentation

### Deduplication (MongoDB)
- **profileDeduplicationMode** — `string`, optional. Options: `"off"`, `"insert_ids"`, `"insert_profiles"`, `"read_only"`
- **mongoDbConnectionString** — `string`, optional. MongoDB connection string for deduplication

### Post-Filtering
- **postFilteringMongoDbQuery** — `object`, optional. MongoDB query to filter results after scraping
- **postFilteringMongoDbAggregation** — `object[]`, optional. MongoDB aggregation pipeline for post-filtering

## Pagination / Resuming

Check actor logs for last scraped page: `Scraped search page 10. Found 25 profiles on the page.`

Or check `_meta.pagination.pageNumber` in the last dataset result.

Resume example:
```json
{
  "searchQuery": "Machine Learning Engineer",
  "profileScraperMode": "Full",
  "startPage": 11
}
```

Can also use Apify's **resurrect** feature to auto-resume from last scraped page.

## Automatic Query Segmentation (up to 100,000+ profiles)

When results exceed 2500, this feature splits queries into sub-queries to bypass LinkedIn's limit.

### Segmentation Levels (applied sequentially)
1. **Countries** — Splits across 43 highest LinkedIn-user countries + excluding query for rest
2. **State/Region** — Further segments within a country
3. **Experience Level** — Segments by experience level
4. **Industries** — Segments by industry (disabled by default)

### Filter Interactions
- Using **Industry IDs Filter** → Industries segmentation skipped
- Using **Locations Filter** → Country and State/Region segmentation skipped
  - Use **Target Countries for Automatic Query Segmentation** input instead to segment by location

### Cost Notes
- Additional cost from multiple sub-queries
- Charges per search page even for zero-result segments
- Optimize by selecting only necessary segmentation levels

### Pagination with Segmentation
- `takePages` applies per segment (set to 100 for full scrape)
- `maxItems` applies across all segments (set high, e.g., 100,000)

## Deduplication (MongoDB)

Avoids duplicate profiles across multiple runs using MongoDB.

- Requires MongoDB connection string (e.g., `mongodb+srv://<username>:<password>@cluster0.mongodb.net`)
- Connection string is encrypted
- Note: When using with `maxItems`, actor continues scraping pages until maxItems count is fulfilled with unique profiles — use `takePages` to limit

## Post-Filtering with MongoDB Queries

Filter scraped results using MongoDB Query Language after collection.

- **Does not reduce scraping costs** — filtering happens after fetch
- **Requires** `takePages` to be set (prevents runaway scraping)
- Must be valid JSON following MongoDB Query Language

### Example: Filter by Skills
```json
{
  "profileScraperMode": "Full",
  "takePages": 1,
  "searchQuery": "Next.js developer",
  "postFilteringMongoDbQuery": {
    "skills": {
      "$all": [
        { "$elemMatch": { "name": { "$regex": "^javascript$", "$options": "i" } } },
        { "$elemMatch": { "name": { "$regex": "^next\\.js$", "$options": "i" } } }
      ]
    }
  }
}
```

### Example: Filter by Current Employment
```json
{
  "profileScraperMode": "Full",
  "takePages": 1,
  "searchQuery": "Next.js developer",
  "postFilteringMongoDbQuery": {
    "experience": {
      "$elemMatch": { "endDate.text": "Present" }
    }
  }
}
```

## Output Data Fields

Full profile output includes:
- `id`, `publicIdentifier`, `linkedinUrl`
- `firstName`, `lastName`, `headline`
- `openToWork`, `hiring`, `premium`, `influencer`
- `location` (with parsed city/state/country)
- `about` (summary)
- `currentPosition[]` — company name, LinkedIn URL, date range
- `profileTopEducation[]` — school name, LinkedIn URL
- `experience[]` — position, company, duration, description, skills, dates, logo
- `education[]` — school, degree, field, skills, dates
- `certifications[]` — title, issuer, date, link
- `projects[]` — title, duration, description, contributors
- `volunteering[]` — role, organization, cause
- `skills[]` — name, positions, endorsements
- `publications[]` — title, date, link
- `courses[]`, `patents[]`, `honorsAndAwards[]`
- `languages[]` — name, proficiency
- `profilePicture`, `coverPicture`
- `connectionsCount`, `followerCount`, `verified`
- `moreProfiles[]` — related profiles

## Rate Limits

For large volumes (300,000+ profiles/hour):
- Distribute workload evenly across hours
- Rate limits reset hourly
- If rate limited, wait until next hour to continue

### Rate Limit Handling Example
```javascript
const client = new ApifyClient({ token: process.env.APIFY_API_KEY });
const result1 = await client.actor('harvestapi/linkedin-profile-search').call({
  currentJobTitles: ['CEO'],
  startPage: 1,
  takePages: 10,
});

const { items } = await client.dataset(result1.defaultDatasetId).listItems();

if (result1.statusMessage === 'rate limited') {
  // Wait until next hour
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      3600000 -
        (new Date().getMinutes() * 60000 +
          new Date().getSeconds() * 1000 +
          new Date().getMilliseconds()),
    ),
  );

  const lastScrapedPageNumber = items[items.length - 1]?._meta?.pagination?.pageNumber || 0;

  const result2 = await client.actor('harvestapi/linkedin-profile-search').call({
    currentJobTitles: ['CEO'],
    startPage: lastScrapedPageNumber + 1,
    takePages: 10 - lastScrapedPageNumber,
  });
}
```

## Reference Tables

### Industry IDs
Full list: https://github.com/HarvestAPI/linkedin-industry-codes-v2/blob/main/linkedin_industry_code_v2_all_eng_with_header.csv

Examples: 4 = Software Development, 43 = Financial Services

### Years at Current Company
| ID | Description |
|----|-------------|
| 1 | Less than 1 year |
| 2 | 1 to 2 years |
| 3 | 3 to 5 years |
| 4 | 6 to 10 years |
| 5 | More than 10 years |

### Years of Experience
| ID | Description |
|----|-------------|
| 1 | Less than 1 year |
| 2 | 1 to 2 years |
| 3 | 3 to 5 years |
| 4 | 6 to 10 years |
| 5 | More than 10 years |

### Seniority Level
| ID | Description |
|----|-------------|
| 100 | In Training |
| 110 | Entry Level |
| 120 | Senior |
| 130 | Strategic |
| 200 | Entry Level Manager |
| 210 | Experienced Manager |
| 220 | Director |
| 300 | Vice President |
| 310 | CXO |
| 320 | Owner / Partner |

### Function
| ID | Description |
|----|-------------|
| 1 | Accounting |
| 2 | Administrative |
| 3 | Arts and Design |
| 4 | Business Development |
| 5 | Community and Social Services |
| 6 | Consulting |
| 7 | Education |
| 8 | Engineering |
| 9 | Entrepreneurship |
| 10 | Finance |
| 11 | Healthcare Services |
| 12 | Human Resources |
| 13 | Information Technology |
| 14 | Legal |
| 15 | Marketing |
| 16 | Media and Communication |
| 17 | Military and Protective Services |
| 18 | Operations |
| 19 | Product Management |
| 20 | Program and Project Management |
| 21 | Purchasing |
| 22 | Quality Assurance |
| 23 | Real Estate |
| 24 | Research |
| 25 | Sales |
| 26 | Customer Success and Support |

### Company Headcount
| ID | Description |
|----|-------------|
| A | Self-employed |
| B | 1-10 |
| C | 11-50 |
| D | 51-200 |
| E | 201-500 |
| F | 501-1000 |
| G | 1001-5000 |
| H | 5001-10000 |
| I | 10001+ |

## Support
- Issues tab in Apify Console
- Discord server
- contact@harvest-api.com

---
*Disclaimer: Independent tool, not affiliated with LinkedIn Corporation.*
