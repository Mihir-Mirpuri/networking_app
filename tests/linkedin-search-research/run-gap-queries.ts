/**
 * LinkedIn Search Research — Phase 4: Gap-Filling Queries (Q85-Q100)
 *
 * Fills the most impactful gaps identified in research-gaps.md.
 * Budget: ~$1.60 (16 queries at $0.10 each)
 *
 * Usage:
 *   npx tsx tests/linkedin-search-research/run-gap-queries.ts
 *   npx tsx tests/linkedin-search-research/run-gap-queries.ts --only=85,86
 */

import 'dotenv/config';
process.env.DISCOVERY_LOGGER_ENABLED = '1';

import { searchLinkedInShort, type LinkedInSearchParams, type ShortProfileResult } from '../../src/lib/services/linkedin-search';
import { appendFileSync } from 'fs';
import { join } from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const onlyIds = onlyArg ? onlyArg.split('=')[1].split(',').map(Number) : null;

// ─── Paths & Budget ──────────────────────────────────────────────────────────

const LOG_FILE = join(__dirname, 'search_log.jsonl');
let budgetRemaining = 1.60; // Starting budget for phase 4
let queriesRun = 0;

// ─── Company URLs ────────────────────────────────────────────────────────────

const GOOGLE = 'https://www.linkedin.com/company/google';
const STRIPE = 'https://www.linkedin.com/company/stripe';
const GOLDMAN = 'https://www.linkedin.com/company/goldman-sachs';
const MCKINSEY = 'https://www.linkedin.com/company/mckinsey';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GapQuery {
  id: number;
  gap: string;
  question: string;
  hypothesis: string;
  params: LinkedInSearchParams;
  /** Custom validator: given a profile, return { valid: boolean, reason?: string } */
  validate: (p: ShortProfileResult) => { valid: boolean; reason?: string };
  tags: string[];
}

// ─── Bay Area metro check (known behavior) ───────────────────────────────────

const SF_METRO_KEYWORDS = [
  'san francisco', 'sf', 'bay area', 'oakland', 'berkeley', 'san jose',
  'palo alto', 'mountain view', 'sunnyvale', 'cupertino', 'menlo park',
  'redwood city', 'santa clara', 'fremont', 'hayward', 'san mateo',
  'south san francisco', 'daly city', 'dublin', 'pleasanton', 'saratoga',
  'los gatos', 'campbell', 'milpitas', 'capitola', 'santa cruz',
  'walnut creek', 'concord', 'livermore',
];

function isSFMetro(location: string | null): boolean {
  if (!location) return false;
  const lower = location.toLowerCase();
  return SF_METRO_KEYWORDS.some(kw => lower.includes(kw));
}

const NYC_METRO_KEYWORDS = [
  'new york', 'nyc', 'manhattan', 'brooklyn', 'queens', 'bronx',
  'staten island', 'jersey city', 'hoboken', 'newark',
];

function isNYCMetro(location: string | null): boolean {
  if (!location) return false;
  const lower = location.toLowerCase();
  return NYC_METRO_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Title matching helpers ──────────────────────────────────────────────────

function titleContains(role: string | null, keyword: string): boolean {
  if (!role) return false;
  return role.toLowerCase().includes(keyword.toLowerCase());
}

function titleMatchesAny(role: string | null, keywords: string[]): boolean {
  return keywords.some(kw => titleContains(role, kw));
}

// ─── Query Definitions ──────────────────────────────────────────────────────

const QUERIES: GapQuery[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // GAP 1: Title Fuzzy Matching Boundaries (4 queries)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 85,
    gap: 'gap1-title-fuzzy',
    question: 'Does currentJobTitles: ["Product Manager"] return TPM, Project Manager, Product Marketing Manager?',
    hypothesis: '"Product Manager" will fuzzy-match to include "Senior PM", "Group PM", but NOT "Technical Program Manager" or "Project Manager" since those are different role families',
    params: {
      currentJobTitles: ['Product Manager'],
      currentCompanies: [GOOGLE],
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      // Check if they're at Google (or subsidiary)
      const atGoogle = company.includes('google') || company.includes('alphabet');
      if (!atGoogle) return { valid: false, reason: `Not at Google: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      // For this test, we want to know WHAT titles appear, so mark all as valid
      // but flag non-PM titles in the reason
      const isPM = role.includes('product manager') || role.includes('product lead') ||
                   role.includes('head of product') || role.includes('vp, product') ||
                   role.includes('director of product') || role.includes('group product');
      const isTPM = role.includes('technical program manager') || role.includes('program manager');
      const isProjectMgr = role.includes('project manager');
      const isPMM = role.includes('product marketing');
      if (isPM) return { valid: true };
      if (isTPM) return { valid: false, reason: `FUZZY LEAK: TPM title "${p.role}"` };
      if (isProjectMgr) return { valid: false, reason: `FUZZY LEAK: Project Manager "${p.role}"` };
      if (isPMM) return { valid: false, reason: `FUZZY LEAK: Product Marketing "${p.role}"` };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['currentJobTitles', 'fuzzy-matching', 'product-manager'],
  },

  {
    id: 86,
    gap: 'gap1-title-fuzzy',
    question: 'Does currentJobTitles: ["Data Scientist"] return Data Analyst, Data Engineer, ML Engineer?',
    hypothesis: '"Data Scientist" will return Data Scientist variants (Senior, Lead, Staff) but NOT Data Analyst or Data Engineer since those are different role families',
    params: {
      currentJobTitles: ['Data Scientist'],
      currentCompanies: [GOOGLE],
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoogle = company.includes('google') || company.includes('alphabet');
      if (!atGoogle) return { valid: false, reason: `Not at Google: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      const isDS = role.includes('data scientist') || role.includes('data science');
      const isDA = role.includes('data analyst') || role.includes('data analytics');
      const isDE = role.includes('data engineer');
      const isMLE = role.includes('machine learning') || role.includes('ml engineer');
      if (isDS) return { valid: true };
      if (isDA) return { valid: false, reason: `FUZZY LEAK: Data Analyst "${p.role}"` };
      if (isDE) return { valid: false, reason: `FUZZY LEAK: Data Engineer "${p.role}"` };
      if (isMLE) return { valid: false, reason: `FUZZY LEAK: ML Engineer "${p.role}"` };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['currentJobTitles', 'fuzzy-matching', 'data-scientist'],
  },

  {
    id: 87,
    gap: 'gap1-title-fuzzy',
    question: 'Does currentJobTitles: ["Designer"] return UX Designer, Visual Designer, Product Designer, Graphic Designer?',
    hypothesis: '"Designer" will fuzzy-match all designer variants (UX, Visual, Product, Graphic) because they all contain "Designer"',
    params: {
      currentJobTitles: ['Designer'],
      currentCompanies: [GOOGLE],
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoogle = company.includes('google') || company.includes('alphabet');
      if (!atGoogle) return { valid: false, reason: `Not at Google: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      const isDesigner = role.includes('designer');
      const isDesignMgr = role.includes('design manager') || role.includes('design director') || role.includes('head of design');
      if (isDesigner) return { valid: true };
      if (isDesignMgr) return { valid: false, reason: `FUZZY LEAK: Design Manager "${p.role}"` };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['currentJobTitles', 'fuzzy-matching', 'designer'],
  },

  {
    id: 88,
    gap: 'gap1-title-fuzzy',
    question: 'Does currentJobTitles: ["Analyst"] at Goldman Sachs return Research Analyst, Investment Banking Analyst, VP-level titles?',
    hypothesis: '"Analyst" will return all analyst variants but may also leak into non-analyst titles since "Analyst" is very generic at banks',
    params: {
      currentJobTitles: ['Analyst'],
      currentCompanies: [GOLDMAN],
      locations: ['New York'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoldman = company.includes('goldman');
      if (!atGoldman) return { valid: false, reason: `Not at Goldman: "${p.company}"` };
      if (!isNYCMetro(p.location)) return { valid: false, reason: `Not NYC metro: "${p.location}"` };
      const isAnalyst = role.includes('analyst');
      if (isAnalyst) return { valid: true };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['currentJobTitles', 'fuzzy-matching', 'analyst', 'finance'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GAP 2: searchQuery + currentJobTitles Interaction (2 queries)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 89,
    gap: 'gap2-searchQuery-title-interaction',
    question: 'searchQuery "machine learning" + currentJobTitles ["Software Engineer"] at Google — how many are ML-related?',
    hypothesis: 'The AND logic should produce SWEs whose profiles mention ML. Page 1 should front-load engineers with ML in their visible title/headline',
    params: {
      searchQuery: 'machine learning',
      currentJobTitles: ['Software Engineer'],
      currentCompanies: [GOOGLE],
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoogle = company.includes('google') || company.includes('alphabet');
      if (!atGoogle) return { valid: false, reason: `Not at Google: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      // Check if the title/role has visible ML connection
      const hasMLInTitle = role.includes('machine learning') || role.includes('ml') ||
                           role.includes('ai') || role.includes('deep learning') ||
                           role.includes('nlp') || role.includes('computer vision');
      const isSWE = role.includes('software engineer') || role.includes('swe') ||
                    role.includes('staff engineer') || role.includes('senior engineer');
      if (isSWE && hasMLInTitle) return { valid: true, reason: 'ML in visible title' };
      if (isSWE) return { valid: true, reason: 'SWE without visible ML connection (may be in hidden fields)' };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['searchQuery', 'currentJobTitles', 'interaction', 'machine-learning'],
  },

  {
    id: 90,
    gap: 'gap2-searchQuery-title-interaction',
    question: 'searchQuery "python" + currentJobTitles ["Data Scientist"] in SF — precision of combo',
    hypothesis: 'Combo should return Data Scientists whose profiles mention Python. High overlap expected since Python is ubiquitous in DS',
    params: {
      searchQuery: 'python',
      currentJobTitles: ['Data Scientist'],
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      const isDS = role.includes('data scientist') || role.includes('data science');
      if (isDS) return { valid: true };
      // Check for fuzzy leaks
      const isDA = role.includes('data analyst');
      const isDE = role.includes('data engineer');
      if (isDA) return { valid: false, reason: `FUZZY LEAK from title filter: Data Analyst "${p.role}"` };
      if (isDE) return { valid: false, reason: `FUZZY LEAK from title filter: Data Engineer "${p.role}"` };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['searchQuery', 'currentJobTitles', 'interaction', 'python'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GAP 3: Exclude Title Fuzzy Behavior (2 queries)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 91,
    gap: 'gap3-exclude-fuzzy',
    question: 'excludeCurrentJobTitles: ["Manager"] with functionIds: ["8"] at Google — does it exclude "Engineering Manager"?',
    hypothesis: 'If exclude is fuzzy like include, "Manager" should remove Engineering Manager, Senior Manager, etc. This would make exclude a powerful IC-only filter',
    params: {
      functionIds: ['8'], // Engineering
      currentCompanies: [GOOGLE],
      locations: ['San Francisco'],
      excludeCurrentJobTitles: ['Manager'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoogle = company.includes('google') || company.includes('alphabet');
      if (!atGoogle) return { valid: false, reason: `Not at Google: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      // Check if any manager title leaked through
      const isManager = role.includes('manager');
      if (isManager) return { valid: false, reason: `EXCLUDE FAILED: Manager still present: "${p.role}"` };
      return { valid: true };
    },
    tags: ['excludeCurrentJobTitles', 'fuzzy-matching', 'manager'],
  },

  {
    id: 92,
    gap: 'gap3-exclude-fuzzy',
    question: 'currentJobTitles: ["Software Engineer"] + excludeCurrentJobTitles: ["Senior Software Engineer"] — does exclude remove Senior variants?',
    hypothesis: 'Exclude should remove "Senior Software Engineer" specifically. Question: does it also remove "Staff" or other senior variants?',
    params: {
      currentJobTitles: ['Software Engineer'],
      currentCompanies: [GOOGLE],
      locations: ['San Francisco'],
      excludeCurrentJobTitles: ['Senior Software Engineer'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoogle = company.includes('google') || company.includes('alphabet');
      if (!atGoogle) return { valid: false, reason: `Not at Google: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      const isSeniorSWE = role.includes('senior software engineer') || role === 'senior swe';
      const isStaffSWE = role.includes('staff software engineer') || role.includes('staff swe');
      const isLeadSWE = role.includes('lead software engineer');
      if (isSeniorSWE) return { valid: false, reason: `EXCLUDE FAILED: Senior SWE still present: "${p.role}"` };
      if (isStaffSWE) return { valid: true, reason: `Staff SWE present — exclude did NOT remove this variant` };
      if (isLeadSWE) return { valid: true, reason: `Lead SWE present — exclude did NOT remove this variant` };
      return { valid: true };
    },
    tags: ['excludeCurrentJobTitles', 'fuzzy-matching', 'senior-variant'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GAP 4: Director/Manager Seniority Accuracy (2 queries)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 93,
    gap: 'gap4-seniority-accuracy',
    question: 'seniorityLevelIds: ["220"] (Director) at Google in SF — are results actual Directors?',
    hypothesis: 'Director seniority should be reasonably accurate (like VP was), returning people with Director/Head titles',
    params: {
      seniorityLevelIds: ['220'], // Director
      currentCompanies: [GOOGLE],
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoogle = company.includes('google') || company.includes('alphabet');
      if (!atGoogle) return { valid: false, reason: `Not at Google: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      // Director-level titles
      const isDirector = role.includes('director') || role.includes('head of') ||
                         role.includes('principal') || role.includes('distinguished');
      const isVP = role.includes('vice president') || role.includes('vp');
      const isManager = role.includes('manager') && !role.includes('director');
      const isIC = role.includes('software engineer') || role.includes('swe') ||
                   role.includes('data scientist') || role.includes('designer');
      if (isDirector) return { valid: true };
      if (isVP) return { valid: false, reason: `VP-level, not Director: "${p.role}"` };
      if (isManager) return { valid: false, reason: `Manager-level, not Director: "${p.role}"` };
      if (isIC) return { valid: false, reason: `IC-level, not Director: "${p.role}"` };
      return { valid: false, reason: `Unclear seniority: "${p.role}"` };
    },
    tags: ['seniorityLevelIds', 'director', 'accuracy'],
  },

  {
    id: 94,
    gap: 'gap4-seniority-accuracy',
    question: 'seniorityLevelIds: ["200","210"] (Manager levels) at Google in SF — are results actual Managers?',
    hypothesis: 'Manager seniority should return people with Manager/Lead titles. Entry Manager (200) may be less accurate than Experienced Manager (210)',
    params: {
      seniorityLevelIds: ['200', '210'], // Entry Manager + Experienced Manager
      currentCompanies: [GOOGLE],
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoogle = company.includes('google') || company.includes('alphabet');
      if (!atGoogle) return { valid: false, reason: `Not at Google: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      // Manager-level titles
      const isManager = role.includes('manager') || role.includes('lead') ||
                        role.includes('team lead') || role.includes('supervisor');
      const isDirector = role.includes('director');
      const isVP = role.includes('vice president') || role.includes('vp');
      const isIC = (role.includes('software engineer') || role.includes('swe') ||
                    role.includes('data scientist') || role.includes('designer')) &&
                   !role.includes('manager') && !role.includes('lead');
      if (isManager && !isDirector) return { valid: true };
      if (isDirector) return { valid: false, reason: `Director-level, not Manager: "${p.role}"` };
      if (isVP) return { valid: false, reason: `VP-level, not Manager: "${p.role}"` };
      if (isIC) return { valid: false, reason: `IC-level, not Manager: "${p.role}"` };
      return { valid: false, reason: `Unclear seniority: "${p.role}"` };
    },
    tags: ['seniorityLevelIds', 'manager', 'accuracy'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GAP 5: Non-Tech Role Validation (2 queries)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 95,
    gap: 'gap5-non-tech',
    question: 'currentJobTitles: ["Investment Banking Analyst"] at Goldman Sachs — does it work for finance roles?',
    hypothesis: 'Should work for finance roles at major banks. LinkedIn company indexing for Goldman should be solid.',
    params: {
      currentJobTitles: ['Investment Banking Analyst'],
      currentCompanies: [GOLDMAN],
      locations: ['New York'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atGoldman = company.includes('goldman');
      if (!atGoldman) return { valid: false, reason: `Not at Goldman Sachs: "${p.company}"` };
      if (!isNYCMetro(p.location)) return { valid: false, reason: `Not NYC metro: "${p.location}"` };
      const isIBA = role.includes('investment banking') || role.includes('ib analyst');
      const isAnalyst = role.includes('analyst');
      if (isIBA) return { valid: true };
      if (isAnalyst) return { valid: true, reason: `Analyst but not specifically IB: "${p.role}"` };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['currentJobTitles', 'non-tech', 'finance', 'goldman-sachs'],
  },

  {
    id: 96,
    gap: 'gap5-non-tech',
    question: 'currentJobTitles: ["Associate"] at McKinsey — does it work for consulting roles?',
    hypothesis: '"Associate" at McKinsey should return consulting associates. May also catch other associate-titled roles.',
    params: {
      currentJobTitles: ['Associate'],
      currentCompanies: [MCKINSEY],
      locations: ['New York'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atMcKinsey = company.includes('mckinsey');
      if (!atMcKinsey) return { valid: false, reason: `Not at McKinsey: "${p.company}"` };
      if (!isNYCMetro(p.location)) return { valid: false, reason: `Not NYC metro: "${p.location}"` };
      const isAssociate = role.includes('associate');
      const isPartner = role.includes('partner');
      const isManager = role.includes('manager') || role.includes('engagement');
      if (isAssociate) return { valid: true };
      if (isPartner) return { valid: false, reason: `Partner-level, not Associate: "${p.role}"` };
      if (isManager) return { valid: false, reason: `Manager-level, not Associate: "${p.role}"` };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['currentJobTitles', 'non-tech', 'consulting', 'mckinsey'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GAP 6: Multi-title OR Precision (2 queries)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 97,
    gap: 'gap6-multi-title-or',
    question: 'currentJobTitles: ["Software Engineer", "Product Manager"] at Stripe — confirm OR across different title families',
    hypothesis: 'Should return both SWEs and PMs at Stripe. OR logic confirmed in Q10 but only for related titles.',
    params: {
      currentJobTitles: ['Software Engineer', 'Product Manager'],
      currentCompanies: [STRIPE],
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      const company = p.company?.toLowerCase() || '';
      const atStripe = company.includes('stripe');
      if (!atStripe) return { valid: false, reason: `Not at Stripe: "${p.company}"` };
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      const isSWE = role.includes('software engineer') || role.includes('swe') ||
                    role.includes('staff engineer') || role.includes('senior engineer');
      const isPM = role.includes('product manager') || role.includes('product lead') ||
                   role.includes('head of product');
      if (isSWE || isPM) return { valid: true };
      return { valid: false, reason: `Neither SWE nor PM: "${p.role}"` };
    },
    tags: ['currentJobTitles', 'multi-title', 'OR-logic'],
  },

  {
    id: 98,
    gap: 'gap6-multi-title-or',
    question: 'currentJobTitles: ["Data Scientist", "Machine Learning Engineer"] in NYC — confirm OR with related ML titles',
    hypothesis: 'Should return both DS and MLE profiles. Related titles may cause more fuzzy overlap.',
    params: {
      currentJobTitles: ['Data Scientist', 'Machine Learning Engineer'],
      locations: ['New York'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      if (!isNYCMetro(p.location)) return { valid: false, reason: `Not NYC metro: "${p.location}"` };
      const isDS = role.includes('data scientist') || role.includes('data science');
      const isMLE = role.includes('machine learning') || role.includes('ml engineer') ||
                    role.includes('ml ') || role.includes('ai engineer');
      const isDA = role.includes('data analyst');
      const isDE = role.includes('data engineer');
      if (isDS || isMLE) return { valid: true };
      if (isDA) return { valid: false, reason: `FUZZY LEAK: Data Analyst "${p.role}"` };
      if (isDE) return { valid: false, reason: `FUZZY LEAK: Data Engineer "${p.role}"` };
      return { valid: false, reason: `Unexpected title: "${p.role}"` };
    },
    tags: ['currentJobTitles', 'multi-title', 'OR-logic', 'ml-roles'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BONUS: searchQuery NOT operator (2 queries)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 99,
    gap: 'gap7-NOT-operator',
    question: 'Does searchQuery "kubernetes NOT devops" reduce totalElements vs "kubernetes" alone (42,715)?',
    hypothesis: 'If NOT works, totalElements should drop significantly. If it does not, totalElements will be similar or the query will fail.',
    params: {
      searchQuery: 'kubernetes NOT devops',
      locations: ['San Francisco'],
    },
    validate: (p) => {
      const role = p.role?.toLowerCase() || '';
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      const isDevOps = role.includes('devops') || role.includes('dev ops');
      if (isDevOps) return { valid: false, reason: `DevOps in title despite NOT: "${p.role}"` };
      return { valid: true };
    },
    tags: ['searchQuery', 'NOT-operator', 'boolean'],
  },

  {
    id: 100,
    gap: 'gap7-NOT-operator',
    question: 'Does searchQuery "(terraform OR kubernetes) AND python" work with parenthetical grouping?',
    hypothesis: 'If parenthetical grouping works, totalElements should be less than "terraform OR kubernetes" alone but more than "terraform AND python"',
    params: {
      searchQuery: '(terraform OR kubernetes) AND python',
      locations: ['San Francisco'],
    },
    validate: (p) => {
      if (!isSFMetro(p.location)) return { valid: false, reason: `Not SF metro: "${p.location}"` };
      return { valid: true };
    },
    tags: ['searchQuery', 'parenthetical', 'boolean'],
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runQuery(query: GapQuery): Promise<void> {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`Q${query.id}: ${query.question}`);
  console.log(`Hypothesis: ${query.hypothesis}`);
  console.log(`Gap: ${query.gap}`);
  console.log(`${'═'.repeat(80)}\n`);

  const startTime = Date.now();

  try {
    const result = await searchLinkedInShort(query.params);
    const elapsed = Date.now() - startTime;
    queriesRun++;
    budgetRemaining -= 0.10;

    // Validate all profiles
    const validations = result.profiles.map((p, i) => {
      const v = query.validate(p);
      return { index: i, profile: p, ...v };
    });

    const validCount = validations.filter(v => v.valid).length;
    const invalidCount = validations.filter(v => !v.valid).length;
    const precision = result.profiles.length > 0
      ? validCount / result.profiles.length
      : 0;

    // Print all profiles with validation
    console.log(`\nTotal elements: ${result.pagination.totalElements.toLocaleString()}`);
    console.log(`Results returned: ${result.profiles.length}`);
    console.log(`Valid: ${validCount}, Invalid: ${invalidCount}, Precision: ${(precision * 100).toFixed(0)}%\n`);

    for (const v of validations) {
      const status = v.valid ? '  OK' : 'FAIL';
      const reason = v.reason ? ` — ${v.reason}` : '';
      console.log(`  [${status}] ${v.index + 1}. ${v.profile.fullName} | ${v.profile.role || 'no role'} | ${v.profile.company || 'no company'} | ${v.profile.location || 'no location'}${reason}`);
    }

    // Build log entry
    const logEntry = {
      query_number: query.id,
      phase: `phase4-${query.gap}`,
      question_being_tested: query.question,
      hypothesis: query.hypothesis,
      params: query.params,
      total_elements: result.pagination.totalElements,
      results_returned: result.profiles.length,
      valid: validCount,
      invalid: invalidCount,
      precision: Math.round(precision * 100) / 100,
      sample_profiles: result.profiles.map(p => ({
        name: p.fullName,
        title: p.role || 'no role',
        company: p.company || 'no company',
        location: p.location || 'no location',
      })),
      invalid_breakdown: validations
        .filter(v => !v.valid)
        .map(v => ({
          index: v.index,
          name: v.profile.fullName,
          title: v.profile.role || 'no role',
          company: v.profile.company || 'no company',
          reason: v.reason || 'unknown',
        })),
      observations: [] as string[],
      confirmed: '',
      new_questions: [] as string[],
      confidence_tier: precision >= 0.9 ? 'HIGH' : precision >= 0.7 ? 'MEDIUM' : 'LOW',
      tags: query.tags,
      cost_usd: 0.10,
      duration_ms: elapsed,
      budget_remaining: Math.round(budgetRemaining * 100) / 100,
    };

    // Append to log
    appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
    console.log(`\nLogged to search_log.jsonl. Budget remaining: $${budgetRemaining.toFixed(2)} (${queriesRun} queries run)`);

  } catch (error) {
    console.error(`\nQ${query.id} FAILED:`, error instanceof Error ? error.message : error);
    const elapsed = Date.now() - startTime;
    queriesRun++;
    budgetRemaining -= 0.10;

    const logEntry = {
      query_number: query.id,
      phase: `phase4-${query.gap}`,
      question_being_tested: query.question,
      hypothesis: query.hypothesis,
      params: query.params,
      total_elements: 0,
      results_returned: 0,
      valid: 0,
      invalid: 0,
      precision: 0,
      sample_profiles: [],
      invalid_breakdown: [],
      observations: [`ERROR: ${error instanceof Error ? error.message : String(error)}`],
      confirmed: '',
      new_questions: [],
      confidence_tier: 'ERROR',
      tags: query.tags,
      cost_usd: 0.10,
      duration_ms: elapsed,
      budget_remaining: Math.round(budgetRemaining * 100) / 100,
    };
    appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
  }
}

async function main() {
  const queriesToRun = onlyIds
    ? QUERIES.filter(q => onlyIds.includes(q.id))
    : QUERIES;

  console.log(`\n${'*'.repeat(80)}`);
  console.log(`LinkedIn Search Research — Phase 4: Gap-Filling Queries`);
  console.log(`Running ${queriesToRun.length} queries (Q${queriesToRun[0]?.id}-Q${queriesToRun[queriesToRun.length - 1]?.id})`);
  console.log(`Budget: $${budgetRemaining.toFixed(2)} remaining`);
  console.log(`${'*'.repeat(80)}\n`);

  for (const query of queriesToRun) {
    await runQuery(query);
    // Small delay between queries to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n${'*'.repeat(80)}`);
  console.log(`Phase 4 complete. ${queriesRun} queries run, $${budgetRemaining.toFixed(2)} remaining.`);
  console.log(`Results logged to: ${LOG_FILE}`);
  console.log(`${'*'.repeat(80)}\n`);
}

main().catch(console.error);
