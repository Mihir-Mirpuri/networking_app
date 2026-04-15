/**
 * Discovery-flow test query catalog.
 *
 * Each entry is a single-turn natural-language input plus an "expected" object
 * that describes what the downstream flow SHOULD do with that input. The
 * harness at `tests/discovery-flow/run.ts` feeds each query through the
 * extraction + search pipeline, parses the JSONL log it produces, and
 * compares observed behavior against the expected object.
 *
 * Categories are labeled so failures can be traced to a specific input type.
 *
 * Multi-turn tests set `conversationHistory` and `currentFilters` on the
 * test case; the harness passes these through to the LLM call.
 */

import type { LinkedInFilters, DBFilters } from '@/lib/types/linkedin-filters';

// ─── Expected-behavior schema ────────────────────────────────────────────────

export type ExpectedStatus = 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup' | 'unsupported';

/** A partial matcher: only listed fields are checked. Arrays use subset semantics. */
export interface ExpectedExtraction {
  status: ExpectedStatus;

  // For status=ready
  filters?: Partial<DBFilters>;
  /** Subset matcher over the sanitized LinkedInFilters. Arrays must CONTAIN all listed values. */
  linkedInFilters?: Partial<LinkedInFilters>;
  /** Set of keys that must NOT be present on linkedInFilters (e.g. leaked industryIds). */
  forbiddenLinkedInFilterKeys?: string[];

  // For status=needs_selection
  minSelectables?: number;
  maxSelectables?: number;
  /** If set, these labels (case-insensitive) must ALL appear in the selectables. */
  mustContainSelectables?: string[];
  /** If true, the harness expects a Perplexity escalation decision log entry. */
  shouldEscalateToPerplexity?: boolean;

  // For status=person_lookup
  personName?: string;
  personCompany?: string;

  // Role specificity bucket
  roleSpecificity?: 'narrow' | 'standard' | 'broad';

  // For status=unsupported
  /** Subset match — each string must appear in at least one actual criterion (case-insensitive). */
  unsupportedCriteria?: string[];
  /** Validate the reformulated suggested_alternative.filters. */
  suggestedAlternativeFilters?: Partial<DBFilters>;
  /** Validate the reformulated suggested_alternative.linkedin_filters. */
  suggestedAlternativeLinkedInFilters?: Partial<LinkedInFilters>;
  /** Substring match on suggested_alternative.label. */
  suggestedAlternativeLabel?: string;

  // For status=ready — suggested searches
  /** Minimum number of suggested_searches entries returned. */
  suggestedSearchesMin?: number;

  // Message quality (any status)
  /** Substrings the message field must contain (case-insensitive). */
  messageContains?: string[];

  // Company ambiguity flag
  companyNameAmbiguous?: boolean;

  // For status=off_topic — no additional fields.
}

export interface ExpectedSearch {
  /** advanced path = LinkedIn-first (skips DB). Triggered by seniority/function/headcount/YoE/past*/
  advancedPath?: boolean;
  /** Simple path with DB-first fallback to LinkedIn Short when db < 6. */
  simplePath?: boolean;
  /** Expect at least N results returned (across DB + LinkedIn merged). */
  minResults?: number;
  /** Whether searchPeopleV2Action should be invoked at all (false for needs_selection/off_topic/person_lookup). */
  shouldRun?: boolean;
}

export interface DiscoveryTestCase {
  id: string;
  category: string;
  query: string;
  description: string;
  /** For multi-turn tests: prior conversation messages. */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** For multi-turn tests: filters carried over from a previous search. */
  currentFilters?: Partial<DBFilters>;
  expected: {
    extraction: ExpectedExtraction;
    search?: ExpectedSearch;
  };
}

// ─── Query catalog ───────────────────────────────────────────────────────────

export const QUERIES: DiscoveryTestCase[] = [
  // ═══ 1. Basic combinatorial (company / role / location / university) ════
  {
    id: 'basic-company-only',
    category: 'basic-combinatorial',
    query: 'people at Stripe',
    description: 'Company only — no role specified.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'basic-company-role',
    category: 'basic-combinatorial',
    query: 'software engineers at Stripe',
    description: 'Company + explicit role.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe', role: 'Software Engineer' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'basic-company-role-location',
    category: 'basic-combinatorial',
    query: 'product managers at Google in Austin',
    description: 'Company + role + US location (must normalize Austin→Austin, Texas).',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google', role: 'Product Manager', location: 'Austin, Texas' },
        linkedInFilters: { currentJobTitles: ['Product Manager'], locations: ['Austin'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'basic-all-four',
    category: 'basic-combinatorial',
    query: 'software engineers at IBM from UT Austin in NYC',
    description: 'All 4 filters: company + role + university + location.',
    expected: {
      extraction: {
        status: 'ready',
        filters: {
          company: 'IBM',
          role: 'Software Engineer',
          university: 'University of Texas at Austin',
          location: 'New York, New York',
        },
        linkedInFilters: {
          currentJobTitles: ['Software Engineer'],
          schools: ['University of Texas at Austin'],
          locations: ['New York'],
        },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'basic-international-location',
    category: 'basic-combinatorial',
    query: 'PMs at Spotify in Stockholm',
    description: 'International location → City, Country normalization.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Spotify', role: 'Product Manager', location: 'Stockholm, Sweden' },
        linkedInFilters: { currentJobTitles: ['Product Manager'], locations: ['Stockholm'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'basic-university-only',
    category: 'basic-combinatorial',
    query: 'Stanford alumni working at OpenAI',
    description: 'Company + university, no role.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'OpenAI', university: 'Stanford University' },
        linkedInFilters: { schools: ['Stanford University'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 2. Role normalization (informal → canonical) ════════════════════════
  {
    id: 'role-pms',
    category: 'role-normalization',
    query: 'PMs at Amazon',
    description: '"PMs" must normalize to "Product Manager".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Amazon', role: 'Product Manager' },
        linkedInFilters: { currentJobTitles: ['Product Manager'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'role-swes',
    category: 'role-normalization',
    query: 'SWEs at Apple',
    description: '"SWEs" → "Software Engineer".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Apple', role: 'Software Engineer' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'role-devs',
    category: 'role-normalization',
    query: 'devs at Microsoft',
    description: '"devs" → Software Engineer or Developer (LLM judgment).',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Microsoft', role: 'Software Engineer' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'role-quants',
    category: 'role-normalization',
    query: 'quants at Jane Street',
    description: '"quants" → "Quantitative Researcher".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Jane Street', role: 'Quantitative Researcher' },
        linkedInFilters: { currentJobTitles: ['Quantitative Researcher'] },
        roleSpecificity: 'narrow',
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'role-ml-engineers',
    category: 'role-normalization',
    query: 'ML engineers at Anthropic',
    description: '"ML engineers" → "Machine Learning Engineer".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Anthropic', role: 'Machine Learning Engineer' },
        linkedInFilters: { currentJobTitles: ['Machine Learning Engineer'] },
        roleSpecificity: 'narrow',
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'role-bankers',
    category: 'role-normalization',
    query: 'bankers at JP Morgan',
    description: '"bankers" in banking context → banking role.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'JP Morgan', role: 'Investment Banking Analyst' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 3. Location normalization (abbreviations → canonical) ═══════════════
  {
    id: 'location-sf',
    category: 'location-normalization',
    query: 'engineers at OpenAI in SF',
    description: '"SF" → "San Francisco, California".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'OpenAI', location: 'San Francisco, California' },
        linkedInFilters: { locations: ['San Francisco'] },
      },
      search: { advancedPath: true, shouldRun: true }, // "engineers" (generic) → function_ids
    },
  },
  {
    id: 'location-nyc',
    category: 'location-normalization',
    query: 'analysts at Goldman Sachs in NYC',
    description: '"NYC" → "New York, New York".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Goldman Sachs', location: 'New York, New York' },
        linkedInFilters: { locations: ['New York'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'location-la',
    category: 'location-normalization',
    query: 'designers at Snap in LA',
    description: '"LA" → "Los Angeles, California".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Snap', location: 'Los Angeles, California' },
      },
      search: { advancedPath: true, shouldRun: true }, // "designers" generic
    },
  },
  {
    id: 'location-london',
    category: 'location-normalization',
    query: 'engineers at DeepMind in London',
    description: 'International: "London" → "London, United Kingdom".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'DeepMind', location: 'London, United Kingdom' },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'location-bay-area',
    category: 'location-normalization',
    query: 'PMs at Airbnb in the Bay Area',
    description: '"Bay Area" → SF Bay Area canonical form.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Airbnb', role: 'Product Manager' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 4. University normalization ═════════════════════════════════════════
  {
    id: 'university-ut-austin',
    category: 'university-normalization',
    query: 'Dell engineers from UT Austin',
    description: '"UT Austin" → "University of Texas at Austin".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Dell', university: 'University of Texas at Austin' },
        linkedInFilters: { schools: ['University of Texas at Austin'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'university-mit',
    category: 'university-normalization',
    query: 'MIT alumni at Microsoft',
    description: '"MIT" → MIT or Massachusetts Institute of Technology.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Microsoft', university: 'Massachusetts Institute of Technology' },
        linkedInFilters: { schools: ['Massachusetts Institute of Technology'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'university-cmu',
    category: 'university-normalization',
    query: 'CMU grads at Tesla',
    description: '"CMU" → "Carnegie Mellon University".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Tesla', university: 'Carnegie Mellon University' },
        linkedInFilters: { schools: ['Carnegie Mellon University'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'university-upenn',
    category: 'university-normalization',
    query: 'UPenn alumni at Bridgewater',
    description: '"UPenn" → "University of Pennsylvania".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Bridgewater', university: 'University of Pennsylvania' },
        linkedInFilters: { schools: ['University of Pennsylvania'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'university-berkeley',
    category: 'university-normalization',
    query: 'Berkeley grads at Meta',
    description: '"Berkeley" → "University of California, Berkeley".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Meta', university: 'University of California, Berkeley' },
        linkedInFilters: { schools: ['University of California, Berkeley'] },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 5. Company typo / casing / abbreviation auto-correct ════════════════
  {
    id: 'typo-jane-stree',
    category: 'company-typo',
    query: 'quants at Jane Stree',
    description: '"Jane Stree" → auto-correct to "Jane Street" (SELECTABLE RULES).',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Jane Street', role: 'Quantitative Researcher' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'typo-stripe-lowercase',
    category: 'company-typo',
    query: 'engineers at stripe',
    description: '"stripe" → case-fix to "Stripe".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe' },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'typo-gs-abbrev',
    category: 'company-typo',
    query: 'analysts at GS',
    description: '"GS" → abbreviation for "Goldman Sachs".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Goldman Sachs' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'typo-figma-lowercase',
    category: 'company-typo',
    query: 'PMs at figma',
    description: '"figma" lowercase → "Figma".',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Figma', role: 'Product Manager' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 6. Ambiguous company names ══════════════════════════════════════════
  {
    id: 'ambiguous-chase',
    category: 'company-ambiguity',
    query: 'analysts at Chase',
    description: '"Chase" should be flagged as ambiguous (common word + person name).',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Chase' },
        companyNameAmbiguous: true,
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'ambiguous-block',
    category: 'company-ambiguity',
    query: 'engineers at Block',
    description: '"Block" (Square parent) — ambiguous flag should be true.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Block' },
        companyNameAmbiguous: true,
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'ambiguous-square',
    category: 'company-ambiguity',
    query: 'PMs at Square',
    description: '"Square" — ambiguous flag should be true.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Square', role: 'Product Manager' },
        companyNameAmbiguous: true,
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 7. LinkedIn advanced: seniority ══════════════════════════════════════
  {
    id: 'seniority-senior-engineers',
    category: 'linkedin-seniority',
    query: 'senior engineers at Citadel',
    description: '"senior" + "engineers" (generic) → excludeSeniorityLevelIds=["110"] + functionIds=["8"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Citadel' },
        linkedInFilters: { excludeSeniorityLevelIds: ['110'], functionIds: ['8'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'seniority-junior-engineers',
    category: 'linkedin-seniority',
    query: 'junior engineers at Microsoft',
    description: '"junior" → seniorityLevelIds=["110"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Microsoft' },
        linkedInFilters: { seniorityLevelIds: ['110'], functionIds: ['8'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'seniority-staff',
    category: 'linkedin-seniority',
    query: 'staff engineers at Netflix',
    description: '"staff" → seniority level mapping (LLM judgment on exact IDs).',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Netflix' },
        linkedInFilters: { excludeSeniorityLevelIds: ['110'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'seniority-directors',
    category: 'linkedin-seniority',
    query: 'directors of engineering at Uber',
    description: '"director" → seniorityLevelIds=["220"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Uber' },
        linkedInFilters: { seniorityLevelIds: ['220'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'seniority-vps',
    category: 'linkedin-seniority',
    query: 'VPs of engineering at Airbnb who recently joined',
    description: '"VP" → seniority 300 + recentlyChangedJobs=true.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Airbnb' },
        linkedInFilters: {
          seniorityLevelIds: ['300'],
          recentlyChangedJobs: true,
        },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'seniority-cxo',
    category: 'anti-category',
    query: 'CTOs at Series A startups in SF',
    description: '"CTO" is a specific CXO title.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 2,
        shouldEscalateToPerplexity: true,
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'seniority-founders',
    category: 'linkedin-seniority',
    query: 'founders at Anthropic',
    description: '"founder" at a specific company.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Anthropic' },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },

  // ═══ 8. LinkedIn advanced: function_ids (generic disciplines) ═════════════
  {
    id: 'function-generic-designers',
    category: 'linkedin-function',
    query: 'designers at Figma',
    description: '"designers" generic → functionIds=["3"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Figma' },
        linkedInFilters: { functionIds: ['3'] },
        roleSpecificity: 'broad',
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'function-generic-recruiters',
    category: 'linkedin-function',
    query: 'recruiters at Google',
    description: '"recruiters" → broad discipline or specific title (LLM judgment).',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google' },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'function-generic-salespeople',
    category: 'linkedin-function',
    query: 'salespeople at Salesforce',
    description: '"salespeople" → functionIds=["25"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Salesforce' },
        linkedInFilters: { functionIds: ['25'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'function-marketers',
    category: 'linkedin-function',
    query: 'marketers at Stripe',
    description: '"marketers" → functionIds=["15"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe' },
        linkedInFilters: { functionIds: ['15'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'function-engineers-generic',
    category: 'linkedin-function',
    query: 'engineers at Meta in NYC',
    description: '"engineers" generic → functionIds=["8"] + location.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Meta', location: 'New York, New York' },
        linkedInFilters: { functionIds: ['8'], locations: ['New York'] },
        roleSpecificity: 'broad',
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },

  // ═══ 9. LinkedIn advanced: company headcount ═════════════════════════════
  {
    id: 'headcount-startup',
    category: 'linkedin-headcount',
    query: 'PMs at early stage startups',
    description: '"early stage startups" → needs_selection with low confidence.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 2,
        shouldEscalateToPerplexity: true,
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'headcount-enterprise',
    category: 'linkedin-headcount',
    query: 'engineers at large enterprise companies',
    description: '"large enterprise" category → needs_selection.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 2,
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 10. LinkedIn advanced: years of experience ═════════════════════════
  {
    id: 'yoe-new-grads',
    category: 'linkedin-yoe',
    query: 'new grad engineers at Google',
    description: '"new grad" → yearsOfExperienceIds=["1"] (< 1 year).',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google' },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'yoe-3-5-years',
    category: 'linkedin-yoe',
    query: 'designers at Figma in SF with 3-5 years experience',
    description: '3-5 YoE → yearsOfExperienceIds=["3"]. "designers" is broad → function_ids.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Figma', location: 'San Francisco, California' },
        linkedInFilters: {
          yearsOfExperienceIds: ['3'],
          functionIds: ['3'],
          locations: ['San Francisco'],
        },
        roleSpecificity: 'broad',
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'yoe-10-plus',
    category: 'linkedin-yoe',
    query: 'engineers at Apple with 10+ years experience',
    description: '10+ YoE → yearsOfExperienceIds=["5"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Apple' },
        linkedInFilters: { yearsOfExperienceIds: ['5'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },

  // ═══ 11. LinkedIn advanced: past companies / negation ═══════════════════
  {
    id: 'past-company-ex-google',
    category: 'linkedin-past-company',
    query: 'ex-Google engineers now at Anthropic',
    description: '"ex-Google" → pastCompanies=["Google"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Anthropic' },
        linkedInFilters: { pastCompanies: ['Google'], functionIds: ['8'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'past-company-ex-meta',
    category: 'linkedin-past-company',
    query: 'former Meta designers at Apple',
    description: '"former Meta" → pastCompanies=["Meta"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Apple' },
        linkedInFilters: { pastCompanies: ['Meta'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'negation-not-california',
    category: 'linkedin-negation',
    query: 'senior engineers at Google but not in California',
    description: 'excludeLocations=["California"] + excludeSeniorityLevelIds=["110"].',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google' },
        linkedInFilters: {
          excludeSeniorityLevelIds: ['110'],
          excludeLocations: ['California'],
        },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'recently-joined',
    category: 'linkedin-negation',
    query: 'engineers at Anthropic who recently joined',
    description: '"recently joined" → recentlyChangedJobs=true.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Anthropic' },
        linkedInFilters: { recentlyChangedJobs: true, functionIds: ['8'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },

  // ═══ 12. Multi-company → needs_selection ═════════════════════════════════
  {
    id: 'multi-google-meta',
    category: 'multi-company',
    query: 'engineers at Google and Meta',
    description: 'Two explicit companies → needs_selection with both.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 2,
        maxSelectables: 2,
        mustContainSelectables: ['Google', 'Meta'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'multi-three-companies',
    category: 'multi-company',
    query: 'PMs at Stripe, Figma, and Notion',
    description: 'Three companies → 3 selectables.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 3,
        mustContainSelectables: ['Stripe', 'Figma', 'Notion'],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 13. Anti-category rule (category labels → needs_selection) ══════════
  {
    id: 'category-faang',
    category: 'anti-category',
    query: 'engineers at FAANG',
    description: 'FAANG → needs_selection with 5 specific companies, confidence=high.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 4,
        shouldEscalateToPerplexity: false, // high confidence, no escalation
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'category-mbb',
    category: 'anti-category',
    query: 'consultants at MBB',
    description: 'MBB → McKinsey/BCG/Bain.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 3,
        mustContainSelectables: ['McKinsey', 'BCG', 'Bain'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'category-bulge-bracket',
    category: 'anti-category',
    query: 'analysts at bulge bracket banks',
    description: 'Bulge bracket → Goldman/Morgan Stanley/JPMorgan/etc.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 4,
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'category-yc',
    category: 'anti-category',
    query: 'find me YC companies hiring ML engineers',
    description: 'YC companies → needs_selection, low confidence → Perplexity escalation.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 4,
        shouldEscalateToPerplexity: true,
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'category-fintech-startups',
    category: 'unsupported-industry',
    query: 'PMs at fintech startups',
    description: '"fintech" is unsupported industry term → unsupported with suggested alternative.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['fintech'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'category-top-consulting',
    category: 'anti-category',
    query: 'partners at top consulting firms',
    description: '"top consulting firms" vague grouping → needs_selection high confidence.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 4,
        mustContainSelectables: ['McKinsey', 'BCG', 'Bain'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'category-unicorns',
    category: 'anti-category',
    query: 'engineers at unicorn startups',
    description: '"unicorn" stage descriptor → needs_selection + escalation.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 4,
        shouldEscalateToPerplexity: true,
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'category-seed-stage-ai',
    category: 'anti-category',
    query: 'founders of seed-stage AI startups in SF',
    description: 'Seed-stage AI startups → low confidence → Perplexity escalation.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 4,
        shouldEscalateToPerplexity: true,
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 14. Person lookup ══════════════════════════════════════════════════
  {
    id: 'person-full-name-company',
    category: 'person-lookup',
    query: 'Find John Smith at Google',
    description: 'Full name + company → person_lookup.',
    expected: {
      extraction: {
        status: 'person_lookup',
        personName: 'John Smith',
        personCompany: 'Google',
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'person-look-up',
    category: 'person-lookup',
    query: 'Look up Jane Doe',
    description: 'Full name, no company → person_lookup.',
    expected: {
      extraction: {
        status: 'person_lookup',
        personName: 'Jane Doe',
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'person-only-first-name',
    category: 'person-lookup',
    query: 'John',
    description: 'First name only → off_topic (asks for last name).',
    expected: {
      extraction: {
        status: 'off_topic',
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'person-three-names',
    category: 'person-lookup',
    query: 'Sundar Pichai at Google',
    description: 'Real famous person at known company → person_lookup.',
    expected: {
      extraction: {
        status: 'person_lookup',
        personName: 'Sundar Pichai',
        personCompany: 'Google',
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 15. Off-topic ══════════════════════════════════════════════════════
  {
    id: 'offtopic-weather',
    category: 'off-topic',
    query: 'how is the weather?',
    description: 'Completely unrelated → off_topic.',
    expected: {
      extraction: { status: 'off_topic' },
      search: { shouldRun: false },
    },
  },
  {
    id: 'offtopic-cofounder',
    category: 'off-topic',
    query: 'find me a cofounder for my AI startup',
    description: 'Cofounder request → off_topic redirect.',
    expected: {
      extraction: { status: 'off_topic' },
      search: { shouldRun: false },
    },
  },
  {
    id: 'offtopic-code-help',
    category: 'off-topic',
    query: 'can you help me write a Python function?',
    description: 'Code help → off_topic.',
    expected: {
      extraction: { status: 'off_topic' },
      search: { shouldRun: false },
    },
  },
  {
    id: 'offtopic-greeting',
    category: 'off-topic',
    query: 'hello!',
    description: 'Plain greeting → off_topic friendly redirect.',
    expected: {
      extraction: { status: 'off_topic' },
      search: { shouldRun: false },
    },
  },

  // ═══ 16. Malformed / edge cases ══════════════════════════════════════════
  {
    id: 'edge-single-word',
    category: 'malformed-edge',
    query: 'engineer',
    description: 'Single word, no company → off_topic or needs_selection.',
    expected: {
      extraction: { status: 'off_topic' },
      search: { shouldRun: false },
    },
  },
  {
    id: 'edge-gibberish',
    category: 'malformed-edge',
    query: 'asdfghjkl qwerty',
    description: 'Random gibberish → off_topic.',
    expected: {
      extraction: { status: 'off_topic' },
      search: { shouldRun: false },
    },
  },
  {
    id: 'edge-punctuation',
    category: 'malformed-edge',
    query: '???',
    description: 'Only punctuation → off_topic.',
    expected: {
      extraction: { status: 'off_topic' },
      search: { shouldRun: false },
    },
  },
  {
    id: 'edge-very-long',
    category: 'malformed-edge',
    query:
      'I want to find software engineers at Stripe in San Francisco with at least 5 years of experience who also went to Stanford and are currently senior level and recently joined the company in the last 6 months',
    description: 'Very long multi-filter query — should still parse into structured filters.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe' },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'edge-missing-company',
    category: 'malformed-edge',
    query: 'software engineers in NYC',
    description: 'Role + location, no company — LLM may return needs_selection, off_topic, or ready.',
    expected: {
      extraction: { status: 'ready' },
      search: { shouldRun: true },
    },
  },

  // ═══ 17. Phrasing variations ═════════════════════════════════════════════
  {
    id: 'phrasing-find-me',
    category: 'phrasing-variation',
    query: 'find me software engineers at Google',
    description: '"find me" prefix should be stripped.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google', role: 'Software Engineer' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'phrasing-show-me',
    category: 'phrasing-variation',
    query: 'show me PMs at Anthropic',
    description: '"show me" prefix.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Anthropic', role: 'Product Manager' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'phrasing-looking-for',
    category: 'phrasing-variation',
    query: "I'm looking for marketers at Stripe",
    description: '"I\'m looking for" phrasing.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe' },
        linkedInFilters: { functionIds: ['15'] },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'phrasing-who-works',
    category: 'phrasing-variation',
    query: 'who works at Notion as a designer?',
    description: '"who works at X as a Y" phrasing.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Notion', role: 'Designer' },
        linkedInFilters: { functionIds: ['3'] },
        roleSpecificity: 'broad',
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'phrasing-any',
    category: 'phrasing-variation',
    query: 'any engineers at Vercel?',
    description: 'Casual "any X at Y?" phrasing.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Vercel' },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'phrasing-need-to-meet',
    category: 'phrasing-variation',
    query: 'I need to connect with someone at Databricks',
    description: 'Connection-framed request, no role → ready with company only.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Databricks' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 18. Multi-intent / compound filters ═════════════════════════════════
  {
    id: 'multi-intent-senior-mit-nyc',
    category: 'multi-intent',
    query: 'senior MIT alumni at Goldman Sachs in NYC',
    description: 'Seniority + school + company + location.',
    expected: {
      extraction: {
        status: 'ready',
        filters: {
          company: 'Goldman Sachs',
          university: 'Massachusetts Institute of Technology',
          location: 'New York, New York',
        },
        linkedInFilters: {
          seniorityLevelIds: ['120'],
          schools: ['Massachusetts Institute of Technology'],
          locations: ['New York'],
        },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'multi-intent-ex-apple-stanford',
    category: 'multi-intent',
    query: 'ex-Apple Stanford PMs now at Meta',
    description: 'Past company + school + role + current company.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Meta', role: 'Product Manager', university: 'Stanford University' },
        linkedInFilters: {
          currentJobTitles: ['Product Manager'],
          schools: ['Stanford University'],
          pastCompanies: ['Apple'],
        },
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },

  // ═══ 19. ID allowlist integrity (regression guard) ═══════════════════════
  {
    id: 'integrity-no-industry-ids',
    category: 'id-allowlist',
    query: 'fintech engineers at Ramp',
    description: '"fintech" is unsupported industry → unsupported. Alternative keeps Ramp.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['fintech'],
        suggestedAlternativeFilters: { company: 'Ramp' },
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 20. Unsupported — degree type ═════════════════════════════════════════
  {
    id: 'unsupported-phd',
    category: 'unsupported-degree',
    query: 'PhD data scientists at Google',
    description: '"PhD" is unsupported degree type → unsupported. Alternative keeps Data Scientist at Google.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['PhD'],
        suggestedAlternativeFilters: { company: 'Google', role: 'Data Scientist' },
        suggestedAlternativeLinkedInFilters: { currentJobTitles: ['Data Scientist'] },
        messageContains: ["can't filter", 'degree'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-mba',
    category: 'unsupported-degree',
    query: 'MBA grads at McKinsey',
    description: '"MBA" unsupported → alternative keeps McKinsey.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['MBA'],
        suggestedAlternativeFilters: { company: 'McKinsey' },
        messageContains: ["can't filter", 'degree'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-masters',
    category: 'unsupported-degree',
    query: 'Masters students at Meta',
    description: '"Masters" unsupported degree → alternative keeps Meta.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['Masters'],
        suggestedAlternativeFilters: { company: 'Meta' },
        messageContains: ["can't filter", 'degree'],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 21. Unsupported — skills/technologies ═════════════════════════════════
  {
    id: 'unsupported-python',
    category: 'unsupported-skills',
    query: 'Python engineers at Stripe',
    description: '"Python" is unsupported skill → alternative keeps engineers at Stripe.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['Python'],
        suggestedAlternativeFilters: { company: 'Stripe' },
        messageContains: ["can't filter", 'skill'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-react',
    category: 'unsupported-skills',
    query: 'React developers at Meta',
    description: '"React" unsupported skill → alternative keeps Meta.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['React'],
        suggestedAlternativeFilters: { company: 'Meta' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-kubernetes',
    category: 'unsupported-skills',
    query: 'people who know Kubernetes at Google',
    description: '"Kubernetes" unsupported skill → alternative keeps Google.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['Kubernetes'],
        suggestedAlternativeFilters: { company: 'Google' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 22. Unsupported — compensation ════════════════════════════════════════
  {
    id: 'unsupported-salary',
    category: 'unsupported-compensation',
    query: 'engineers making $200k+ at Google',
    description: '"$200k+" unsupported salary → alternative keeps engineers at Google.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['$200k'],
        suggestedAlternativeFilters: { company: 'Google' },
        messageContains: ["can't filter", 'salary'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-high-paying',
    category: 'unsupported-compensation',
    query: 'high paying PM jobs in SF',
    description: '"high paying" unsupported compensation → alternative keeps PM + SF.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['paying'],
        suggestedAlternativeFilters: { role: 'Product Manager', location: 'San Francisco, California' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 23. Unsupported — work mode ═══════════════════════════════════════════
  {
    id: 'unsupported-remote',
    category: 'unsupported-work-mode',
    query: 'remote engineers at Stripe',
    description: '"remote" unsupported work mode → alternative keeps engineers at Stripe.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['remote'],
        suggestedAlternativeFilters: { company: 'Stripe' },
        messageContains: ["can't filter", 'remote'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-hybrid',
    category: 'unsupported-work-mode',
    query: 'hybrid PMs at Google in NYC',
    description: '"hybrid" unsupported → alternative keeps PM + Google + NYC.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['hybrid'],
        suggestedAlternativeFilters: { company: 'Google', role: 'Product Manager', location: 'New York, New York' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 24. Unsupported — other (visa, hiring, certifications) ════════════════
  {
    id: 'unsupported-h1b',
    category: 'unsupported-other',
    query: 'H1B engineers at Meta',
    description: '"H1B" unsupported visa → alternative keeps engineers at Meta.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['H1B'],
        suggestedAlternativeFilters: { company: 'Meta' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-hiring',
    category: 'unsupported-other',
    query: 'engineers at Google who are hiring',
    description: '"hiring" unsupported → alternative keeps engineers at Google.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['hiring'],
        suggestedAlternativeFilters: { company: 'Google' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-cfa',
    category: 'unsupported-other',
    query: 'CFA holders at Goldman Sachs',
    description: '"CFA" unsupported cert → alternative approximates with functionIds=["10"] (Finance).',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['CFA'],
        suggestedAlternativeFilters: { company: 'Goldman Sachs' },
        suggestedAlternativeLinkedInFilters: { functionIds: ['10'] },
        messageContains: ["can't filter", 'certification'],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 25. Unsupported — reformulation quality ══════════════════════════════
  {
    id: 'unsupported-series-b',
    category: 'unsupported-reformulation',
    query: 'Series B engineers in Austin',
    description: '"Series B" unsupported funding → alternative approximates with companyHeadcount + keeps Austin.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['Series B'],
        suggestedAlternativeLinkedInFilters: { companyHeadcount: ['D', 'E'] },
        suggestedAlternativeLabel: 'Austin',
        messageContains: ["can't filter", 'funding'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-cpa',
    category: 'unsupported-reformulation',
    query: 'CPA accountants at Deloitte',
    description: '"CPA" unsupported cert → alternative approximates with functionIds=["1"] (Accounting).',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['CPA'],
        suggestedAlternativeFilters: { company: 'Deloitte' },
        suggestedAlternativeLinkedInFilters: { functionIds: ['1'] },
        suggestedAlternativeLabel: 'Deloitte',
        messageContains: ["can't filter", 'certification'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-pmp',
    category: 'unsupported-reformulation',
    query: 'PMP project managers at IBM',
    description: '"PMP" unsupported cert → alternative approximates with functionIds=["20"] (Program Mgmt).',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['PMP'],
        suggestedAlternativeFilters: { company: 'IBM' },
        suggestedAlternativeLinkedInFilters: { functionIds: ['20'] },
        suggestedAlternativeLabel: 'IBM',
        messageContains: ["can't filter", 'certification'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-fintech-pms',
    category: 'unsupported-reformulation',
    query: 'fintech PMs in NYC',
    description: '"fintech" unsupported industry → alternative keeps PM + NYC.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['fintech'],
        suggestedAlternativeFilters: { role: 'Product Manager', location: 'New York, New York' },
        messageContains: ["can't filter", 'industry'],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 26. Multi-turn — filter swap ══════════════════════════════════════════
  {
    id: 'multiturn-swap-role',
    category: 'multi-turn-swap',
    query: 'try engineers instead',
    description: 'Follow-up swapping role from PM → engineer. Company (Google) should persist.',
    conversationHistory: [
      { role: 'user', content: 'PMs at Google' },
      { role: 'assistant', content: 'Searching for Product Managers at Google' },
    ],
    currentFilters: { company: 'Google', role: 'Product Manager' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google' },
      },
      search: { shouldRun: true },
    },
  },
  {
    id: 'multiturn-swap-company',
    category: 'multi-turn-swap',
    query: 'try Meta instead',
    description: 'Follow-up swapping company from Stripe → Meta.',
    conversationHistory: [
      { role: 'user', content: 'engineers at Stripe' },
      { role: 'assistant', content: 'Searching for engineers at Stripe' },
    ],
    currentFilters: { company: 'Stripe' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Meta' },
      },
      search: { shouldRun: true },
    },
  },
  {
    id: 'multiturn-swap-location',
    category: 'multi-turn-swap',
    query: 'try NYC instead',
    description: 'Follow-up swapping location from SF → NYC. Company and role persist.',
    conversationHistory: [
      { role: 'user', content: 'PMs at Google in SF' },
      { role: 'assistant', content: 'Searching for Product Managers at Google in San Francisco' },
    ],
    currentFilters: { company: 'Google', role: 'Product Manager', location: 'San Francisco, California' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google', role: 'Product Manager' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 27. Multi-turn — filter persistence ═══════════════════════════════════
  {
    id: 'multiturn-persist-location',
    category: 'multi-turn-persist',
    query: 'try Apple',
    description: 'Follow-up swapping company. Location (SF) should persist from previous filters.',
    conversationHistory: [
      { role: 'user', content: 'engineers at Google in SF' },
      { role: 'assistant', content: 'Searching for engineers at Google in San Francisco' },
    ],
    currentFilters: { company: 'Google', location: 'San Francisco, California' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Apple' },
      },
      search: { shouldRun: true },
    },
  },
  {
    id: 'multiturn-persist-company',
    category: 'multi-turn-persist',
    query: 'try MIT instead',
    description: 'Follow-up swapping university. Company (Stripe) should persist.',
    conversationHistory: [
      { role: 'user', content: 'Stanford alumni at Stripe' },
      { role: 'assistant', content: 'Searching for Stanford alumni at Stripe' },
    ],
    currentFilters: { company: 'Stripe', university: 'Stanford University' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe', university: 'Massachusetts Institute of Technology' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 28. Suggested searches validation ═════════════════════════════════════
  {
    id: 'suggested-pms-google',
    category: 'suggested-searches',
    query: 'PMs at Google',
    description: 'Ready result should include 2+ suggested alternative searches.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google', role: 'Product Manager' },
        suggestedSearchesMin: 2,
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'suggested-designers-figma',
    category: 'suggested-searches',
    query: 'designers at Figma',
    description: 'Broad role ready result should include 2+ suggestions.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Figma' },
        linkedInFilters: { functionIds: ['3'] },
        suggestedSearchesMin: 2,
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'suggested-analysts-gs',
    category: 'suggested-searches',
    query: 'analysts at Goldman Sachs',
    description: 'Finance role should include 2+ suggestions.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Goldman Sachs' },
        suggestedSearchesMin: 2,
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'suggested-people-stripe',
    category: 'suggested-searches',
    query: 'people at Stripe',
    description: 'No-role query should still produce at least 1 suggestion.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe' },
        suggestedSearchesMin: 1,
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 29. Message quality ═══════════════════════════════════════════════════
  {
    id: 'message-offtopic-weather',
    category: 'message-quality',
    query: 'how is the weather?',
    description: 'Off-topic message should redirect user with helpful suggestion.',
    expected: {
      extraction: {
        status: 'off_topic',
        messageContains: ['professional contacts'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'message-offtopic-hello',
    category: 'message-quality',
    query: 'hello!',
    description: 'Greeting should redirect with helpful suggestion.',
    expected: {
      extraction: {
        status: 'off_topic',
        messageContains: ['help', 'find'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'message-unsupported-phd',
    category: 'message-quality',
    query: 'PhD engineers at Google',
    description: 'Unsupported message should name the specific criteria.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['PhD'],
        messageContains: ["can't filter", 'degree'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'message-needs-selection-mbb',
    category: 'message-quality',
    query: 'consultants at MBB',
    description: 'Needs-selection message should prompt user to pick.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 3,
        mustContainSelectables: ['McKinsey', 'BCG', 'Bain'],
        messageContains: ['Which'],
      },
      search: { shouldRun: false },
    },
  },
];
