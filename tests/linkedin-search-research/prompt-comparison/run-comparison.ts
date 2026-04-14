/**
 * Prompt v1 vs v2 Comparison Test Harness
 *
 * Sends identical natural-language queries to both system prompts via Haiku,
 * compares outputs, and scores against empirical research findings.
 *
 * Usage:
 *   npx tsx tests/linkedin-search-research/prompt-comparison/run-comparison.ts
 *   npx tsx tests/linkedin-search-research/prompt-comparison/run-comparison.ts --limit=10
 */

import 'dotenv/config';

import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../../../src/lib/prompts/search-extraction-prompt';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT_V2 } from '../../../src/lib/prompts/search-extraction-prompt-v2';
import { completeJsonAnthropic } from '../../../src/lib/services/anthropic';
import { writeFile, appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestCase {
  id: number;
  category: string;
  input: string;
  /** Rules this case should check against empirical findings */
  checks: Check[];
}

type Check =
  | { type: 'status_is'; expected: string }
  | { type: 'uses_current_job_titles'; expected: string[] }
  | { type: 'uses_function_ids'; expected: string[] }
  | { type: 'no_company_in_search_query' }
  | { type: 'school_expanded'; abbrev: string; expected: string }
  | { type: 'location_expanded'; abbrev: string; expected: string }
  | { type: 'location_no_abbreviation' }
  | { type: 'seniority_as_exclusion'; ids: string[] }
  | { type: 'seniority_as_inclusion'; ids: string[] }
  | { type: 'no_seniority_inclusion_low_reliability'; ids: string[] }
  | { type: 'uses_search_query_for_skill'; keyword: string }
  | { type: 'has_exclude_filter'; filter: string; values?: string[] }
  | { type: 'uses_past_companies'; companies: string[] }
  | { type: 'uses_recently_changed_jobs' }
  | { type: 'uses_company_headcount'; values: string[] }
  | { type: 'uses_years_of_experience'; values: string[] }
  | { type: 'message_mentions_keyword_broad' }
  | { type: 'no_function_ids' }
  | { type: 'no_current_job_titles' }
  | { type: 'role_specificity_is'; expected: string }
  | { type: 'confidence_is'; expected: string }
  | { type: 'has_selectables' }
  | { type: 'person_lookup_fields'; name: string; company?: string };

interface LLMOutput {
  status: string;
  confidence?: string;
  role_specificity?: string;
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  linkedin_filters?: Record<string, unknown>;
  company_name_ambiguous?: boolean;
  person_name?: string | null;
  person_company?: string | null;
  selectables?: Array<{ label: string; filter_key: string; filter_value: string }>;
  suggested_searches?: Array<{ label: string; company: string; role?: string | null }>;
  message?: string;
}

interface ComparisonResult {
  case_id: number;
  category: string;
  input: string;
  v1_output: LLMOutput | null;
  v2_output: LLMOutput | null;
  v1_error: string | null;
  v2_error: string | null;
  v1_duration_ms: number;
  v2_duration_ms: number;
  parameter_diffs: string[];
  v1_score: number;
  v2_score: number;
  verdict: 'v1_better' | 'v2_better' | 'tie' | 'both_failed';
  notes: string;
  check_details: Array<{ check: string; v1_pass: boolean; v2_pass: boolean }>;
}

// ─── Test Cases ───────────────────────────────────────────────────────────────

const TEST_CASES: TestCase[] = [
  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 1: Simple role + company (20 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 1, category: 'role_company', input: 'software engineers at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Software Engineer'] },
      { type: 'no_company_in_search_query' },
      { type: 'no_function_ids' },
    ],
  },
  {
    id: 2, category: 'role_company', input: 'product managers at Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Product Manager'] },
      { type: 'no_company_in_search_query' },
    ],
  },
  {
    id: 3, category: 'role_company', input: 'data scientists at Meta',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Data Scientist'] },
    ],
  },
  {
    id: 4, category: 'role_company', input: 'marketing managers at HubSpot',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Marketing Manager'] },
    ],
  },
  {
    id: 5, category: 'role_company', input: 'SWEs at Amazon',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Software Engineer'] },
    ],
  },
  {
    id: 6, category: 'role_company', input: 'PMs at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Product Manager'] },
    ],
  },
  {
    id: 7, category: 'role_company', input: 'devs at Shopify',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Software Engineer'] },
    ],
  },
  {
    id: 8, category: 'role_company', input: 'account executives at Salesforce',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Account Executive'] },
    ],
  },
  {
    id: 9, category: 'role_company', input: 'recruiters at LinkedIn',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Recruiter'] },
    ],
  },
  {
    id: 10, category: 'role_company', input: 'analysts at JPMorgan',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Analyst'] },
    ],
  },
  {
    id: 11, category: 'role_company', input: 'consultants at Deloitte',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Consultant'] },
    ],
  },
  {
    id: 12, category: 'role_company', input: 'lawyers at Cravath',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 13, category: 'role_company', input: 'designers at Airbnb',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 14, category: 'role_company', input: 'business development at Palantir',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 15, category: 'role_company', input: 'operations managers at Uber',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Operations Manager'] },
    ],
  },
  {
    id: 16, category: 'role_company', input: 'research scientists at DeepMind',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Research Scientist'] },
    ],
  },
  {
    id: 17, category: 'role_company', input: 'HR managers at Netflix',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 18, category: 'role_company', input: 'DevOps engineers at Datadog',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 19, category: 'role_company', input: 'frontend engineers at Vercel',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 20, category: 'role_company', input: 'TPMs at Microsoft',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 2: Role + company + location (15 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 21, category: 'role_company_location', input: 'engineers at Meta in NYC',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'location_expanded', abbrev: 'NYC', expected: 'New York' },
      { type: 'location_no_abbreviation' },
    ],
  },
  {
    id: 22, category: 'role_company_location', input: 'designers at Apple in SF',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'location_expanded', abbrev: 'SF', expected: 'San Francisco' },
    ],
  },
  {
    id: 23, category: 'role_company_location', input: 'PMs at Google in Austin',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Product Manager'] },
    ],
  },
  {
    id: 24, category: 'role_company_location', input: 'software engineers at Stripe in LA',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'location_expanded', abbrev: 'LA', expected: 'Los Angeles' },
    ],
  },
  {
    id: 25, category: 'role_company_location', input: 'data engineers at Snowflake in Seattle',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Data Engineer'] },
    ],
  },
  {
    id: 26, category: 'role_company_location', input: 'product managers at Uber in Chicago',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Product Manager'] },
    ],
  },
  {
    id: 27, category: 'role_company_location', input: 'engineers at Amazon in DC',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'location_expanded', abbrev: 'DC', expected: 'Washington' },
    ],
  },
  {
    id: 28, category: 'role_company_location', input: 'salespeople at Oracle in Texas',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 29, category: 'role_company_location', input: 'SWEs at Netflix in California',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Software Engineer'] },
    ],
  },
  {
    id: 30, category: 'role_company_location', input: 'analysts at Goldman in London',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 31, category: 'role_company_location', input: 'ML engineers at OpenAI in San Francisco',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 32, category: 'role_company_location', input: 'consultants at BCG in Boston',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Consultant'] },
    ],
  },
  {
    id: 33, category: 'role_company_location', input: 'engineers at Coinbase in NYC',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'location_expanded', abbrev: 'NYC', expected: 'New York' },
    ],
  },
  {
    id: 34, category: 'role_company_location', input: 'product designers at Figma in San Francisco',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Product Designer'] },
    ],
  },
  {
    id: 35, category: 'role_company_location', input: 'backend engineers at Spotify in Stockholm',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 3: Broad/generic role (10 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 36, category: 'broad_role', input: 'engineers at Figma',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_function_ids', expected: ['8'] },
      { type: 'no_current_job_titles' },
      { type: 'role_specificity_is', expected: 'broad' },
    ],
  },
  {
    id: 37, category: 'broad_role', input: 'salespeople at Salesforce',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_function_ids', expected: ['25'] },
      { type: 'no_current_job_titles' },
      { type: 'role_specificity_is', expected: 'broad' },
    ],
  },
  {
    id: 38, category: 'broad_role', input: 'designers at Notion',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_function_ids', expected: ['3'] },
      { type: 'no_current_job_titles' },
      { type: 'role_specificity_is', expected: 'broad' },
    ],
  },
  {
    id: 39, category: 'broad_role', input: 'marketers at HubSpot',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_function_ids', expected: ['15'] },
      { type: 'no_current_job_titles' },
      { type: 'role_specificity_is', expected: 'broad' },
    ],
  },
  {
    id: 40, category: 'broad_role', input: 'analysts at McKinsey',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 41, category: 'broad_role', input: 'recruiters at Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 42, category: 'broad_role', input: 'finance people at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_function_ids', expected: ['10'] },
      { type: 'role_specificity_is', expected: 'broad' },
    ],
  },
  {
    id: 43, category: 'broad_role', input: 'operations at Uber',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_function_ids', expected: ['18'] },
      { type: 'role_specificity_is', expected: 'broad' },
    ],
  },
  {
    id: 44, category: 'broad_role', input: 'legal at Amazon',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_function_ids', expected: ['14'] },
      { type: 'role_specificity_is', expected: 'broad' },
    ],
  },
  {
    id: 45, category: 'broad_role', input: 'HR at Netflix',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_function_ids', expected: ['12'] },
      { type: 'role_specificity_is', expected: 'broad' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 4: Niche/specific role (10 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 46, category: 'niche_role', input: 'quantitative researchers at Citadel',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Quantitative Researcher'] },
      { type: 'role_specificity_is', expected: 'narrow' },
    ],
  },
  {
    id: 47, category: 'niche_role', input: 'SREs at Netflix',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Site Reliability Engineer'] },
      { type: 'role_specificity_is', expected: 'narrow' },
    ],
  },
  {
    id: 48, category: 'niche_role', input: 'iOS developers at Apple',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'role_specificity_is', expected: 'narrow' },
    ],
  },
  {
    id: 49, category: 'niche_role', input: 'UX researchers at Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['UX Researcher'] },
      { type: 'role_specificity_is', expected: 'narrow' },
    ],
  },
  {
    id: 50, category: 'niche_role', input: 'growth PMs at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 51, category: 'niche_role', input: 'ML infrastructure engineers at Meta',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 52, category: 'niche_role', input: 'security engineers at CrowdStrike',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'role_specificity_is', expected: 'narrow' },
    ],
  },
  {
    id: 53, category: 'niche_role', input: 'solutions architects at AWS',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_current_job_titles', expected: ['Solutions Architect'] },
    ],
  },
  {
    id: 54, category: 'niche_role', input: 'tax accountants at PwC',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 55, category: 'niche_role', input: 'platform engineers at Databricks',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 5: Skill/keyword queries (10 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 56, category: 'skill_keyword', input: 'people who know Rust at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_search_query_for_skill', keyword: 'rust' },
      { type: 'no_company_in_search_query' },
      { type: 'message_mentions_keyword_broad' },
    ],
  },
  {
    id: 57, category: 'skill_keyword', input: 'ML specialists at Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 58, category: 'skill_keyword', input: 'Python and Kubernetes experts at Amazon',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_search_query_for_skill', keyword: 'python' },
      { type: 'no_company_in_search_query' },
    ],
  },
  {
    id: 59, category: 'skill_keyword', input: 'people with React experience at Vercel',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_search_query_for_skill', keyword: 'react' },
      { type: 'no_company_in_search_query' },
    ],
  },
  {
    id: 60, category: 'skill_keyword', input: 'blockchain engineers at Coinbase',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 61, category: 'skill_keyword', input: 'fintech people at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 62, category: 'skill_keyword', input: 'people who work on payments infrastructure at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_search_query_for_skill', keyword: 'payments' },
      { type: 'no_company_in_search_query' },
    ],
  },
  {
    id: 63, category: 'skill_keyword', input: 'Terraform experts at Datadog',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_search_query_for_skill', keyword: 'terraform' },
    ],
  },
  {
    id: 64, category: 'skill_keyword', input: 'Go developers at Uber',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 65, category: 'skill_keyword', input: 'AI/ML people at Microsoft',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 6: Seniority queries (10 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 66, category: 'seniority', input: 'senior engineers at Uber',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'no_seniority_inclusion_low_reliability', ids: ['120'] },
      // v2 should use exclude_seniority_level_ids: ["110"] instead
    ],
  },
  {
    id: 67, category: 'seniority', input: 'VP of sales at Oracle',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'seniority_as_inclusion', ids: ['300'] },
    ],
  },
  {
    id: 68, category: 'seniority', input: 'C-suite at Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'seniority_as_inclusion', ids: ['310'] },
    ],
  },
  {
    id: 69, category: 'seniority', input: 'directors at Meta',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'seniority_as_inclusion', ids: ['220'] },
    ],
  },
  {
    id: 70, category: 'seniority', input: 'junior engineers at Amazon',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'no_seniority_inclusion_low_reliability', ids: ['110'] },
    ],
  },
  {
    id: 71, category: 'seniority', input: 'staff engineers at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 72, category: 'seniority', input: 'principal engineers at Netflix',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 73, category: 'seniority', input: 'entry level analysts at Goldman Sachs',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'no_seniority_inclusion_low_reliability', ids: ['110'] },
    ],
  },
  {
    id: 74, category: 'seniority', input: 'heads of engineering at Databricks',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 75, category: 'seniority', input: 'founders at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'seniority_as_inclusion', ids: ['310', '320'] },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 7: Negative/exclude queries (10 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 76, category: 'exclude', input: 'engineers at Google not in California',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_locations', values: ['California'] },
    ],
  },
  {
    id: 77, category: 'exclude', input: 'non-engineering people at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_function_ids', values: ['8'] },
    ],
  },
  {
    id: 78, category: 'exclude', input: 'PMs at Meta not in New York',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_locations' },
    ],
  },
  {
    id: 79, category: 'exclude', input: 'engineers at Amazon not in Seattle',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_locations' },
    ],
  },
  {
    id: 80, category: 'exclude', input: 'people at Google excluding engineers',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_function_ids', values: ['8'] },
    ],
  },
  {
    id: 81, category: 'exclude', input: 'non-sales people at Salesforce',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_function_ids', values: ['25'] },
    ],
  },
  {
    id: 82, category: 'exclude', input: 'engineers at Microsoft not in Redmond',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_locations' },
    ],
  },
  {
    id: 83, category: 'exclude', input: 'people at Netflix not in Los Angeles',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_locations' },
    ],
  },
  {
    id: 84, category: 'exclude', input: 'non-management engineers at Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 85, category: 'exclude', input: 'engineers at Apple not in China',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'has_exclude_filter', filter: 'exclude_locations' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 8: Past company queries (5 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 86, category: 'past_company', input: 'ex-Google engineers at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_past_companies', companies: ['Google'] },
    ],
  },
  {
    id: 87, category: 'past_company', input: 'former McKinsey consultants at Meta',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_past_companies', companies: ['McKinsey'] },
    ],
  },
  {
    id: 88, category: 'past_company', input: 'ex-Goldman Sachs people at Citadel',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_past_companies', companies: ['Goldman Sachs'] },
    ],
  },
  {
    id: 89, category: 'past_company', input: 'formerly at Amazon now at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_past_companies', companies: ['Amazon'] },
    ],
  },
  {
    id: 90, category: 'past_company', input: 'ex-Meta engineers at Anthropic',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_past_companies', companies: ['Meta'] },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 9: School queries (5 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 91, category: 'school', input: 'MIT grads at Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'school_expanded', abbrev: 'MIT', expected: 'Massachusetts Institute of Technology' },
    ],
  },
  {
    id: 92, category: 'school', input: 'Stanford alumni at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'school_expanded', abbrev: 'Stanford', expected: 'Stanford University' },
    ],
  },
  {
    id: 93, category: 'school', input: 'Harvard grads at McKinsey',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'school_expanded', abbrev: 'Harvard', expected: 'Harvard University' },
    ],
  },
  {
    id: 94, category: 'school', input: 'CMU alumni at Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'school_expanded', abbrev: 'CMU', expected: 'Carnegie Mellon University' },
    ],
  },
  {
    id: 95, category: 'school', input: 'Berkeley grads at Meta',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'school_expanded', abbrev: 'Berkeley', expected: 'University of California' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 10: Edge cases (5 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 96, category: 'edge_case', input: 'people at Block',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 97, category: 'edge_case', input: 'engineers at Chase',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 98, category: 'edge_case', input: 'sofrware enginers at Gogle',  // typos
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 99, category: 'edge_case', input: 'GS analysts',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 100, category: 'edge_case', input: 'people at MoLo Solutions',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 11: Company category queries (5 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 101, category: 'company_category', input: 'engineers at FAANG',
    checks: [
      { type: 'status_is', expected: 'needs_selection' },
      { type: 'has_selectables' },
    ],
  },
  {
    id: 102, category: 'company_category', input: 'consultants at MBB',
    checks: [
      { type: 'status_is', expected: 'needs_selection' },
      { type: 'has_selectables' },
    ],
  },
  {
    id: 103, category: 'company_category', input: 'people at YC startups',
    checks: [
      { type: 'status_is', expected: 'needs_selection' },
      { type: 'has_selectables' },
    ],
  },
  {
    id: 104, category: 'company_category', input: 'engineers at big tech',
    checks: [
      { type: 'status_is', expected: 'needs_selection' },
      { type: 'has_selectables' },
    ],
  },
  {
    id: 105, category: 'company_category', input: 'bankers at bulge bracket',
    checks: [
      { type: 'status_is', expected: 'needs_selection' },
      { type: 'has_selectables' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 12: Recently changed jobs / experience (5 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 106, category: 'recency_experience', input: 'new hires at Stripe',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_recently_changed_jobs' },
    ],
  },
  {
    id: 107, category: 'recency_experience', input: 'people who recently joined Google',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_recently_changed_jobs' },
    ],
  },
  {
    id: 108, category: 'recency_experience', input: '10+ year veterans at Microsoft',
    checks: [
      { type: 'status_is', expected: 'ready' },
      { type: 'uses_years_of_experience', values: ['5'] },
    ],
  },
  {
    id: 109, category: 'recency_experience', input: 'new grads at Meta',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },
  {
    id: 110, category: 'recency_experience', input: 'experienced engineers at Apple',
    checks: [
      { type: 'status_is', expected: 'ready' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 13: Person lookup (3 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 111, category: 'person_lookup', input: 'Find John Smith at Google',
    checks: [
      { type: 'status_is', expected: 'person_lookup' },
      { type: 'person_lookup_fields', name: 'John Smith', company: 'Google' },
    ],
  },
  {
    id: 112, category: 'person_lookup', input: 'Look up Jane Doe at Meta',
    checks: [
      { type: 'status_is', expected: 'person_lookup' },
      { type: 'person_lookup_fields', name: 'Jane Doe', company: 'Meta' },
    ],
  },
  {
    id: 113, category: 'person_lookup', input: 'Find Sarah Johnson',
    checks: [
      { type: 'status_is', expected: 'person_lookup' },
      { type: 'person_lookup_fields', name: 'Sarah Johnson' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 14: Off-topic (2 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 114, category: 'off_topic', input: 'how is the weather?',
    checks: [
      { type: 'status_is', expected: 'off_topic' },
    ],
  },
  {
    id: 115, category: 'off_topic', input: 'tell me a joke',
    checks: [
      { type: 'status_is', expected: 'off_topic' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATEGORY 15: Multiple companies (2 cases)
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 116, category: 'multiple_companies', input: 'engineers at Google and Meta',
    checks: [
      { type: 'status_is', expected: 'needs_selection' },
      { type: 'has_selectables' },
    ],
  },
  {
    id: 117, category: 'multiple_companies', input: 'PMs at Stripe, Notion, and Figma',
    checks: [
      { type: 'status_is', expected: 'needs_selection' },
      { type: 'has_selectables' },
    ],
  },
];

// ─── Scoring Logic ────────────────────────────────────────────────────────────

function getLinkedInFilters(output: LLMOutput): Record<string, unknown> {
  return output.linkedin_filters || {};
}

function evaluateCheck(check: Check, output: LLMOutput): boolean {
  const lf = getLinkedInFilters(output);

  switch (check.type) {
    case 'status_is':
      return output.status === check.expected;

    case 'uses_current_job_titles': {
      const titles = lf.current_job_titles as string[] | undefined;
      if (!titles || titles.length === 0) return false;
      return check.expected.some(exp =>
        titles.some(t => t.toLowerCase().includes(exp.toLowerCase()))
      );
    }

    case 'uses_function_ids': {
      const fids = lf.function_ids as string[] | undefined;
      if (!fids || fids.length === 0) return false;
      return check.expected.every(exp => fids.includes(exp));
    }

    case 'no_company_in_search_query': {
      const sq = lf.search_query as string | undefined;
      if (!sq) return true;
      const company = (output.filters?.company || '').toLowerCase();
      if (!company) return true;
      return !sq.toLowerCase().includes(company);
    }

    case 'school_expanded': {
      const schools = lf.schools as string[] | undefined;
      if (!schools || schools.length === 0) return false;
      return schools.some(s => s.toLowerCase().includes(check.expected.toLowerCase()));
    }

    case 'location_expanded': {
      const locs = lf.locations as string[] | undefined;
      if (!locs || locs.length === 0) return false;
      return locs.some(l => l.toLowerCase().includes(check.expected.toLowerCase()));
    }

    case 'location_no_abbreviation': {
      const locs = lf.locations as string[] | undefined;
      if (!locs || locs.length === 0) return true;
      // No 2-letter abbreviations
      return !locs.some(l => /^[A-Z]{2}$/.test(l));
    }

    case 'seniority_as_exclusion': {
      const excludeIds = lf.exclude_seniority_level_ids as string[] | undefined;
      return !!excludeIds && check.ids.some(id => excludeIds.includes(id));
    }

    case 'seniority_as_inclusion': {
      const ids = lf.seniority_level_ids as string[] | undefined;
      if (!ids) return false;
      return check.ids.some(id => ids.includes(id));
    }

    case 'no_seniority_inclusion_low_reliability': {
      // Should NOT have 110 or 120 in inclusion seniority_level_ids
      const ids = lf.seniority_level_ids as string[] | undefined;
      if (!ids || ids.length === 0) return true;
      return !check.ids.some(id => ids.includes(id));
    }

    case 'uses_search_query_for_skill': {
      const sq = lf.search_query as string | undefined;
      if (!sq) return false;
      return sq.toLowerCase().includes(check.keyword.toLowerCase());
    }

    case 'has_exclude_filter': {
      const val = lf[check.filter] as string[] | undefined;
      if (!val || val.length === 0) return false;
      if (check.values) {
        return check.values.some(v => val.some(fv => fv.toLowerCase().includes(v.toLowerCase())));
      }
      return true;
    }

    case 'uses_past_companies': {
      const pc = lf.past_companies as string[] | undefined;
      if (!pc || pc.length === 0) return false;
      return check.companies.some(c =>
        pc.some(p => p.toLowerCase().includes(c.toLowerCase()))
      );
    }

    case 'uses_recently_changed_jobs':
      return lf.recently_changed_jobs === true;

    case 'uses_company_headcount': {
      const hc = lf.company_headcount as string[] | undefined;
      if (!hc || hc.length === 0) return false;
      return check.values.some(v => hc.includes(v));
    }

    case 'uses_years_of_experience': {
      const yoe = lf.years_of_experience_ids as string[] | undefined;
      if (!yoe || yoe.length === 0) return false;
      return check.values.some(v => yoe.includes(v));
    }

    case 'message_mentions_keyword_broad': {
      const msg = (output.message || '').toLowerCase();
      return msg.includes('broad') || msg.includes('keyword') || msg.includes('mention');
    }

    case 'no_function_ids': {
      const fids = lf.function_ids as string[] | undefined;
      return !fids || fids.length === 0;
    }

    case 'no_current_job_titles': {
      const titles = lf.current_job_titles as string[] | undefined;
      return !titles || titles.length === 0;
    }

    case 'role_specificity_is':
      return output.role_specificity === check.expected;

    case 'confidence_is':
      return output.confidence === check.expected;

    case 'has_selectables':
      return !!output.selectables && output.selectables.length >= 2;

    case 'person_lookup_fields': {
      if (!output.person_name) return false;
      const nameMatch = output.person_name.toLowerCase().includes(check.name.toLowerCase());
      if (check.company) {
        return nameMatch && (output.person_company || '').toLowerCase().includes(check.company.toLowerCase());
      }
      return nameMatch;
    }

    default:
      return false;
  }
}

function scoreOutput(testCase: TestCase, output: LLMOutput): { score: number; checkResults: Array<{ check: string; pass: boolean }> } {
  let score = 0;
  const checkResults: Array<{ check: string; pass: boolean }> = [];

  for (const check of testCase.checks) {
    const pass = evaluateCheck(check, output);
    checkResults.push({ check: check.type, pass });
    if (pass) {
      // Weight critical checks more heavily
      switch (check.type) {
        case 'status_is': score += 3; break;
        case 'no_company_in_search_query': score += 2; break;
        case 'uses_current_job_titles': score += 2; break;
        case 'uses_function_ids': score += 2; break;
        case 'no_function_ids': score += 1; break;
        case 'no_current_job_titles': score += 1; break;
        case 'school_expanded': score += 2; break;
        case 'location_expanded': score += 2; break;
        case 'no_seniority_inclusion_low_reliability': score += 2; break;
        case 'seniority_as_inclusion': score += 2; break;
        case 'seniority_as_exclusion': score += 2; break;
        case 'message_mentions_keyword_broad': score += 1; break;
        default: score += 1; break;
      }
    }
  }

  return { score, checkResults };
}

function findParameterDiffs(v1: LLMOutput, v2: LLMOutput): string[] {
  const diffs: string[] = [];
  const lf1 = getLinkedInFilters(v1);
  const lf2 = getLinkedInFilters(v2);

  // Status
  if (v1.status !== v2.status) {
    diffs.push(`status: v1="${v1.status}" vs v2="${v2.status}"`);
  }

  // Role specificity
  if (v1.role_specificity !== v2.role_specificity) {
    diffs.push(`role_specificity: v1="${v1.role_specificity}" vs v2="${v2.role_specificity}"`);
  }

  // current_job_titles
  const t1 = JSON.stringify(lf1.current_job_titles || null);
  const t2 = JSON.stringify(lf2.current_job_titles || null);
  if (t1 !== t2) diffs.push(`current_job_titles: v1=${t1} vs v2=${t2}`);

  // function_ids
  const f1 = JSON.stringify(lf1.function_ids || null);
  const f2 = JSON.stringify(lf2.function_ids || null);
  if (f1 !== f2) diffs.push(`function_ids: v1=${f1} vs v2=${f2}`);

  // search_query
  const sq1 = lf1.search_query || null;
  const sq2 = lf2.search_query || null;
  if (sq1 !== sq2) diffs.push(`search_query: v1="${sq1}" vs v2="${sq2}"`);

  // seniority_level_ids
  const s1 = JSON.stringify(lf1.seniority_level_ids || null);
  const s2 = JSON.stringify(lf2.seniority_level_ids || null);
  if (s1 !== s2) diffs.push(`seniority_level_ids: v1=${s1} vs v2=${s2}`);

  // exclude_seniority_level_ids
  const es1 = JSON.stringify(lf1.exclude_seniority_level_ids || null);
  const es2 = JSON.stringify(lf2.exclude_seniority_level_ids || null);
  if (es1 !== es2) diffs.push(`exclude_seniority_level_ids: v1=${es1} vs v2=${es2}`);

  // locations
  const l1 = JSON.stringify(lf1.locations || null);
  const l2 = JSON.stringify(lf2.locations || null);
  if (l1 !== l2) diffs.push(`locations: v1=${l1} vs v2=${l2}`);

  // schools
  const sc1 = JSON.stringify(lf1.schools || null);
  const sc2 = JSON.stringify(lf2.schools || null);
  if (sc1 !== sc2) diffs.push(`schools: v1=${sc1} vs v2=${sc2}`);

  // past_companies
  const pc1 = JSON.stringify(lf1.past_companies || null);
  const pc2 = JSON.stringify(lf2.past_companies || null);
  if (pc1 !== pc2) diffs.push(`past_companies: v1=${pc1} vs v2=${pc2}`);

  // recently_changed_jobs
  if (lf1.recently_changed_jobs !== lf2.recently_changed_jobs) {
    diffs.push(`recently_changed_jobs: v1=${lf1.recently_changed_jobs} vs v2=${lf2.recently_changed_jobs}`);
  }

  // exclude filters
  for (const key of ['exclude_locations', 'exclude_current_companies', 'exclude_function_ids', 'exclude_seniority_level_ids']) {
    const e1 = JSON.stringify(lf1[key] || null);
    const e2 = JSON.stringify(lf2[key] || null);
    if (e1 !== e2) diffs.push(`${key}: v1=${e1} vs v2=${e2}`);
  }

  // company_headcount
  const ch1 = JSON.stringify(lf1.company_headcount || null);
  const ch2 = JSON.stringify(lf2.company_headcount || null);
  if (ch1 !== ch2) diffs.push(`company_headcount: v1=${ch1} vs v2=${ch2}`);

  // years_of_experience_ids
  const yoe1 = JSON.stringify(lf1.years_of_experience_ids || null);
  const yoe2 = JSON.stringify(lf2.years_of_experience_ids || null);
  if (yoe1 !== yoe2) diffs.push(`years_of_experience_ids: v1=${yoe1} vs v2=${yoe2}`);

  return diffs;
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────

async function callPrompt(systemPrompt: string, userInput: string): Promise<{ output: LLMOutput; durationMs: number }> {
  const start = Date.now();
  const response = await completeJsonAnthropic<LLMOutput>({
    systemPrompt,
    userPrompt: `New user message: ${userInput}`,
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.1,
    maxTokens: 800,
  });
  return { output: response.content, durationMs: Date.now() - start };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const outputDir = join(__dirname);
  const jsonlPath = join(outputDir, 'comparison-results.jsonl');
  const reportPath = join(outputDir, 'comparison-report.md');

  // Clear previous results
  await writeFile(jsonlPath, '', 'utf-8');

  const cases = TEST_CASES.slice(0, limit);
  console.log(`\nRunning ${cases.length} comparison cases...\n`);

  const results: ComparisonResult[] = [];
  let v1Wins = 0, v2Wins = 0, ties = 0, bothFailed = 0;

  for (const tc of cases) {
    process.stdout.write(`  Case ${tc.id} [${tc.category}]: "${tc.input.substring(0, 50)}"...`);

    let v1Output: LLMOutput | null = null;
    let v2Output: LLMOutput | null = null;
    let v1Error: string | null = null;
    let v2Error: string | null = null;
    let v1Duration = 0;
    let v2Duration = 0;

    // Run both prompts in parallel
    const [v1Result, v2Result] = await Promise.allSettled([
      callPrompt(SEARCH_EXTRACTION_SYSTEM_PROMPT, tc.input),
      callPrompt(SEARCH_EXTRACTION_SYSTEM_PROMPT_V2, tc.input),
    ]);

    if (v1Result.status === 'fulfilled') {
      v1Output = v1Result.value.output;
      v1Duration = v1Result.value.durationMs;
    } else {
      v1Error = v1Result.reason instanceof Error ? v1Result.reason.message : String(v1Result.reason);
      console.log(` v1 ERROR: ${v1Error}`);
    }

    if (v2Result.status === 'fulfilled') {
      v2Output = v2Result.value.output;
      v2Duration = v2Result.value.durationMs;
    } else {
      v2Error = v2Result.reason instanceof Error ? v2Result.reason.message : String(v2Result.reason);
      console.log(` v2 ERROR: ${v2Error}`);
    }

    // Score both
    let v1Score = 0;
    let v2Score = 0;
    let v1Checks: Array<{ check: string; pass: boolean }> = [];
    let v2Checks: Array<{ check: string; pass: boolean }> = [];

    if (v1Output) {
      const result = scoreOutput(tc, v1Output);
      v1Score = result.score;
      v1Checks = result.checkResults;
    }
    if (v2Output) {
      const result = scoreOutput(tc, v2Output);
      v2Score = result.score;
      v2Checks = result.checkResults;
    }

    const paramDiffs = (v1Output && v2Output) ? findParameterDiffs(v1Output, v2Output) : [];

    let verdict: ComparisonResult['verdict'];
    let notes = '';

    if (!v1Output && !v2Output) {
      verdict = 'both_failed';
      bothFailed++;
      notes = 'Both prompts errored';
    } else if (v2Score > v1Score) {
      verdict = 'v2_better';
      v2Wins++;
      const failedV1 = v1Checks.filter(c => !c.pass).map(c => c.check);
      const passedV2 = v2Checks.filter(c => c.pass).map(c => c.check);
      notes = failedV1.length > 0
        ? `v1 failed: ${failedV1.join(', ')}. v2 passed: ${passedV2.join(', ')}`
        : `v2 scored higher: ${v2Score} vs ${v1Score}`;
    } else if (v1Score > v2Score) {
      verdict = 'v1_better';
      v1Wins++;
      const failedV2 = v2Checks.filter(c => !c.pass).map(c => c.check);
      notes = `v2 failed: ${failedV2.join(', ')}`;
    } else {
      verdict = 'tie';
      ties++;
      notes = paramDiffs.length > 0
        ? `Same score but different params: ${paramDiffs.slice(0, 3).join('; ')}`
        : 'Identical outputs';
    }

    const mergedChecks = tc.checks.map((check, i) => ({
      check: check.type,
      v1_pass: v1Checks[i]?.pass ?? false,
      v2_pass: v2Checks[i]?.pass ?? false,
    }));

    const compResult: ComparisonResult = {
      case_id: tc.id,
      category: tc.category,
      input: tc.input,
      v1_output: v1Output,
      v2_output: v2Output,
      v1_error: v1Error,
      v2_error: v2Error,
      v1_duration_ms: v1Duration,
      v2_duration_ms: v2Duration,
      parameter_diffs: paramDiffs,
      v1_score: v1Score,
      v2_score: v2Score,
      verdict,
      notes,
      check_details: mergedChecks,
    };

    results.push(compResult);

    // Append to JSONL immediately
    await appendFile(jsonlPath, JSON.stringify(compResult) + '\n', 'utf-8');

    const verdictSymbol = verdict === 'v2_better' ? 'v2 WIN' : verdict === 'v1_better' ? 'v1 WIN' : verdict === 'tie' ? 'TIE' : 'FAIL';
    console.log(` ${verdictSymbol} (v1:${v1Score} v2:${v2Score}) [${v1Duration}ms/${v2Duration}ms]`);

    // Rate limit protection: small delay between pairs
    await new Promise(r => setTimeout(r, 200));
  }

  // ─── Generate Report ────────────────────────────────────────────────────────

  const totalCases = results.length;
  const v1AvgMs = results.reduce((s, r) => s + r.v1_duration_ms, 0) / totalCases;
  const v2AvgMs = results.reduce((s, r) => s + r.v2_duration_ms, 0) / totalCases;

  // Category breakdown
  const categories = [...new Set(results.map(r => r.category))];
  const categoryStats = categories.map(cat => {
    const catResults = results.filter(r => r.category === cat);
    return {
      category: cat,
      total: catResults.length,
      v1_wins: catResults.filter(r => r.verdict === 'v1_better').length,
      v2_wins: catResults.filter(r => r.verdict === 'v2_better').length,
      ties: catResults.filter(r => r.verdict === 'tie').length,
      both_failed: catResults.filter(r => r.verdict === 'both_failed').length,
    };
  });

  // Check-level breakdown
  const allCheckTypes = [...new Set(results.flatMap(r => r.check_details.map(c => c.check)))];
  const checkStats = allCheckTypes.map(checkType => {
    const relevant = results.flatMap(r => r.check_details.filter(c => c.check === checkType));
    return {
      check: checkType,
      total: relevant.length,
      v1_pass: relevant.filter(c => c.v1_pass).length,
      v2_pass: relevant.filter(c => c.v2_pass).length,
    };
  });

  // Latency percentiles
  const v1Latencies = results.map(r => r.v1_duration_ms).filter(x => x > 0).sort((a, b) => a - b);
  const v2Latencies = results.map(r => r.v2_duration_ms).filter(x => x > 0).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p / 100)] || 0;

  // Regressions (v1 better cases)
  const regressions = results.filter(r => r.verdict === 'v1_better');
  // Wins (v2 better cases)
  const wins = results.filter(r => r.verdict === 'v2_better');

  const report = `# Prompt v1 vs v2 Comparison Report

Generated: ${new Date().toISOString()}
Model: claude-haiku-4-5-20251001
Total test cases: ${totalCases}

## Summary Stats

| Metric | Count | Percentage |
|--------|------:|----------:|
| v2 wins | ${v2Wins} | ${((v2Wins / totalCases) * 100).toFixed(1)}% |
| v1 wins | ${v1Wins} | ${((v1Wins / totalCases) * 100).toFixed(1)}% |
| Ties | ${ties} | ${((ties / totalCases) * 100).toFixed(1)}% |
| Both failed | ${bothFailed} | ${((bothFailed / totalCases) * 100).toFixed(1)}% |

**v2 win rate (excluding ties): ${totalCases - ties > 0 ? ((v2Wins / (totalCases - ties)) * 100).toFixed(1) : 'N/A'}%**

## Category Breakdown

| Category | Total | v2 Wins | v1 Wins | Ties | Failures |
|----------|------:|--------:|--------:|-----:|---------:|
${categoryStats.map(c => `| ${c.category} | ${c.total} | ${c.v2_wins} | ${c.v1_wins} | ${c.ties} | ${c.both_failed} |`).join('\n')}

## Check-Level Pass Rates

| Check | Total | v1 Pass | v2 Pass | v1 Rate | v2 Rate |
|-------|------:|--------:|--------:|--------:|--------:|
${checkStats.map(c => `| ${c.check} | ${c.total} | ${c.v1_pass} | ${c.v2_pass} | ${((c.v1_pass / c.total) * 100).toFixed(0)}% | ${((c.v2_pass / c.total) * 100).toFixed(0)}% |`).join('\n')}

## Latency Analysis

| Metric | v1 (ms) | v2 (ms) |
|--------|--------:|--------:|
| Average | ${v1AvgMs.toFixed(0)} | ${v2AvgMs.toFixed(0)} |
| p50 | ${pct(v1Latencies, 50)} | ${pct(v2Latencies, 50)} |
| p95 | ${pct(v1Latencies, 95)} | ${pct(v2Latencies, 95)} |
| p99 | ${pct(v1Latencies, 99)} | ${pct(v2Latencies, 99)} |
| Max | ${Math.max(...v1Latencies)} | ${Math.max(...v2Latencies)} |

${v1Latencies.some(l => l > 1000) || v2Latencies.some(l => l > 1000) ? '**WARNING: Some queries exceeded 1 second latency.**\n' : ''}

## Regressions (v1 was better than v2)

${regressions.length === 0 ? 'No regressions detected.\n' : regressions.map(r => `### Case ${r.case_id}: "${r.input}"
- **Category**: ${r.category}
- **v1 score**: ${r.v1_score}, **v2 score**: ${r.v2_score}
- **Failed checks in v2**: ${r.check_details.filter(c => !c.v2_pass).map(c => c.check).join(', ')}
- **Parameter diffs**: ${r.parameter_diffs.join('; ') || 'none'}
- **v1 linkedin_filters**: \`${JSON.stringify(r.v1_output?.linkedin_filters || {})}\`
- **v2 linkedin_filters**: \`${JSON.stringify(r.v2_output?.linkedin_filters || {})}\`
- **Notes**: ${r.notes}
`).join('\n')}

## Biggest v2 Wins

${wins.slice(0, 15).map(r => `### Case ${r.case_id}: "${r.input}"
- **Category**: ${r.category}
- **v1 score**: ${r.v1_score}, **v2 score**: ${r.v2_score}
- **What v2 did better**: ${r.notes}
- **Parameter diffs**: ${r.parameter_diffs.join('; ') || 'none'}
`).join('\n')}

## All Parameter Diffs

${results.filter(r => r.parameter_diffs.length > 0).map(r => `- **Case ${r.case_id}** ("${r.input.substring(0, 40)}"): ${r.parameter_diffs.join('; ')}`).join('\n')}

## Production Readiness Verdict

${v2Wins / totalCases >= 0.85 ? `**PRODUCTION READY** -- v2 is better or equal in ${(((v2Wins + ties) / totalCases) * 100).toFixed(1)}% of cases with ${regressions.length} regressions.`
  : v2Wins / totalCases >= 0.5 ? `**NEEDS TUNING** -- v2 wins ${((v2Wins / totalCases) * 100).toFixed(1)}% of cases but has ${regressions.length} regressions that need investigation.`
  : `**WRONG APPROACH** -- v2 only wins ${((v2Wins / totalCases) * 100).toFixed(1)}% of cases. Fundamental issues need addressing.`}

### Regressions requiring attention:
${regressions.length === 0 ? 'None' : regressions.map(r => `- Case ${r.case_id} ("${r.input}"): ${r.notes}`).join('\n')}

### Key findings:
${checkStats.filter(c => c.v2_pass > c.v1_pass).map(c => `- v2 better at "${c.check}": ${((c.v2_pass / c.total) * 100).toFixed(0)}% vs v1 ${((c.v1_pass / c.total) * 100).toFixed(0)}%`).join('\n')}
${checkStats.filter(c => c.v1_pass > c.v2_pass).map(c => `- v1 better at "${c.check}": ${((c.v1_pass / c.total) * 100).toFixed(0)}% vs v2 ${((c.v2_pass / c.total) * 100).toFixed(0)}%`).join('\n')}
`;

  await writeFile(reportPath, report, 'utf-8');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTS: v2 wins ${v2Wins}/${totalCases} (${((v2Wins / totalCases) * 100).toFixed(1)}%), v1 wins ${v1Wins}/${totalCases} (${((v1Wins / totalCases) * 100).toFixed(1)}%), ties ${ties}/${totalCases}`);
  console.log(`Avg latency: v1=${v1AvgMs.toFixed(0)}ms, v2=${v2AvgMs.toFixed(0)}ms`);
  console.log(`Regressions: ${regressions.length}`);
  console.log(`\nReport: ${reportPath}`);
  console.log(`JSONL:  ${jsonlPath}`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
