/**
 * Tests for role alias matching: DB filter expansion + ranking scorer
 *
 * Run with: npx tsx src/lib/services/role-matching.test.ts
 */

import { scoreRoleMatch } from './ranking';
import { getRoleSearchTerms, areRolesAliased } from '@/lib/db/person-service';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

let passed = 0;
let failed = 0;

function assert(
  condition: boolean,
  testName: string,
  detail?: string
) {
  if (condition) {
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${testName}${detail ? DIM + ' — ' + detail + RESET : ''}`);
  } else {
    failed++;
    console.log(`  ${RED}✗${RESET} ${testName}${detail ? DIM + ' — ' + detail + RESET : ''}`);
  }
}

// ─── Helper: test that scoreRoleMatch returns within expected range ───
function expectScore(
  search: string,
  personRole: string | null,
  minScore: number,
  maxScore: number,
  label?: string
) {
  const score = scoreRoleMatch(search, personRole);
  const tag = label || `"${search}" vs "${personRole}"`;
  const inRange = score >= minScore - 0.001 && score <= maxScore + 0.001;
  assert(inRange, tag, `score=${score.toFixed(2)}, expected ${minScore}–${maxScore}`);
  return score;
}

// ─── Helper: test that alias expansion returns expected terms ───
function expectAliasIncludes(role: string, expectedTerm: string) {
  const terms = getRoleSearchTerms(role);
  assert(
    terms.includes(expectedTerm.toLowerCase()),
    `getRoleSearchTerms("${role}") includes "${expectedTerm}"`,
    `got [${terms.join(', ')}]`
  );
}

// ─── Helper: test alias bidirectional check ───
function expectAliased(role1: string, role2: string, shouldMatch: boolean) {
  const result = areRolesAliased(role1.toLowerCase(), role2.toLowerCase());
  assert(
    result === shouldMatch,
    `areRolesAliased("${role1}", "${role2}") = ${shouldMatch}`,
    `got ${result}`
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: DB Filter Alias Expansion (getRoleSearchTerms)
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}═══ DB Filter: Alias Expansion ═══${RESET}\n`);

// Finance abbreviations
expectAliasIncludes('Vice President', 'vp');
expectAliasIncludes('VP', 'vice president');
expectAliasIncludes('Managing Director', 'md');
expectAliasIncludes('MD', 'managing director');
expectAliasIncludes('Investment Banking', 'ib');
expectAliasIncludes('IB', 'investment banking');
expectAliasIncludes('Private Equity', 'pe');
expectAliasIncludes('PE', 'private equity');
expectAliasIncludes('Sales & Trading', 's&t');
expectAliasIncludes('S&T', 'sales and trading');
expectAliasIncludes('Wealth Management', 'wm');
expectAliasIncludes('Asset Management', 'am');

// Consulting abbreviations
expectAliasIncludes('Business Analyst', 'ba');
expectAliasIncludes('BA', 'business analyst');
expectAliasIncludes('Engagement Manager', 'em');
expectAliasIncludes('Case Team Leader', 'ctl');
expectAliasIncludes('Project Leader', 'pl');
expectAliasIncludes('Associate Principal', 'ap');

// Tech abbreviations
expectAliasIncludes('Product Manager', 'pm');
expectAliasIncludes('PM', 'product manager');
expectAliasIncludes('Associate Product Manager', 'apm');
expectAliasIncludes('Product Manager Technical', 'tpm');
expectAliasIncludes('TPM', 'technical product manager');
expectAliasIncludes('Program Manager', 'pgm');
expectAliasIncludes('Rotational Product Manager', 'rpm');

// Senior/Sr variations
expectAliasIncludes('Senior Consultant', 'sr consultant');
expectAliasIncludes('Senior Consultant', 'sr. consultant');
expectAliasIncludes('Senior Manager', 'sr manager');
expectAliasIncludes('Senior Associate', 'sr associate');
expectAliasIncludes('Senior Analyst', 'sr analyst');
expectAliasIncludes('Senior Business Analyst', 'sba');
expectAliasIncludes('Senior Vice President', 'svp');
expectAliasIncludes('SVP', 'senior vp');

// Junior/Jr variations
expectAliasIncludes('Junior Consultant', 'jr consultant');
expectAliasIncludes('Junior Consultant', 'jr. consultant');

// Manager/Mgr variations
expectAliasIncludes('Product Manager', 'product mgr');
expectAliasIncludes('Program Manager', 'program mgr');
expectAliasIncludes('Project Manager', 'project mgr');

// No alias — should return just the original
const genericTerms = getRoleSearchTerms('Data Scientist');
assert(
  genericTerms.length === 1 && genericTerms[0] === 'data scientist',
  'Unknown role returns only itself',
  `got [${genericTerms.join(', ')}]`
);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Bidirectional Alias Checks
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}═══ Bidirectional Alias Checks ═══${RESET}\n`);

expectAliased('Vice President', 'VP', true);
expectAliased('VP', 'Vice President', true);
expectAliased('Product Manager', 'PM', true);
expectAliased('PM', 'Product Manager', true);
expectAliased('Managing Director', 'MD', true);
expectAliased('MD', 'Managing Director', true);
expectAliased('Business Analyst', 'BA', true);
expectAliased('BA', 'Business Analyst', true);
expectAliased('Senior Consultant', 'Sr Consultant', true);
expectAliased('Sr Consultant', 'Senior Consultant', true);

// Should NOT be aliased (different levels/roles)
expectAliased('Vice President', 'Senior Vice President', false);
expectAliased('Analyst', 'Associate', false);
expectAliased('Manager', 'Director', false);
expectAliased('Product Manager', 'Program Manager', false);
expectAliased('Consultant', 'Senior Consultant', false);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Score Matching — 100 Role Pairs
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}═══ Score Matching: Exact & Alias Matches (expect 1.0) ═══${RESET}\n`);

// --- Exact matches (same string) ---
expectScore('Analyst', 'Analyst', 1.0, 1.0, '1. Exact: Analyst');
expectScore('Associate', 'Associate', 1.0, 1.0, '2. Exact: Associate');
expectScore('Consultant', 'Consultant', 1.0, 1.0, '3. Exact: Consultant');
expectScore('Partner', 'Partner', 1.0, 1.0, '4. Exact: Partner');
expectScore('Director', 'Director', 1.0, 1.0, '5. Exact: Director');

// --- Abbreviation aliases (should be 1.0) ---
expectScore('Vice President', 'VP', 1.0, 1.0, '6. Alias: Vice President ↔ VP');
expectScore('VP', 'Vice President', 1.0, 1.0, '7. Alias: VP ↔ Vice President');
expectScore('Managing Director', 'MD', 1.0, 1.0, '8. Alias: Managing Director ↔ MD');
expectScore('MD', 'Managing Director', 1.0, 1.0, '9. Alias: MD ↔ Managing Director');
expectScore('Product Manager', 'PM', 1.0, 1.0, '10. Alias: Product Manager ↔ PM');
expectScore('PM', 'Product Manager', 1.0, 1.0, '11. Alias: PM ↔ Product Manager');
expectScore('Business Analyst', 'BA', 1.0, 1.0, '12. Alias: Business Analyst ↔ BA');
expectScore('BA', 'Business Analyst', 1.0, 1.0, '13. Alias: BA ↔ Business Analyst');
expectScore('Investment Banking', 'IB', 1.0, 1.0, '14. Alias: Investment Banking ↔ IB');
expectScore('IB', 'Investment Banking', 1.0, 1.0, '15. Alias: IB ↔ Investment Banking');
expectScore('Private Equity', 'PE', 1.0, 1.0, '16. Alias: Private Equity ↔ PE');
expectScore('PE', 'Private Equity', 1.0, 1.0, '17. Alias: PE ↔ Private Equity');
expectScore('Sales & Trading', 'S&T', 1.0, 1.0, '18. Alias: Sales & Trading ↔ S&T');
expectScore('S&T', 'Sales & Trading', 1.0, 1.0, '19. Alias: S&T ↔ Sales & Trading');
expectScore('Wealth Management', 'WM', 1.0, 1.0, '20. Alias: Wealth Management ↔ WM');
expectScore('WM', 'Wealth Management', 1.0, 1.0, '21. Alias: WM ↔ Wealth Management');
expectScore('Asset Management', 'AM', 1.0, 1.0, '22. Alias: Asset Management ↔ AM');
expectScore('Associate Product Manager', 'APM', 1.0, 1.0, '23. Alias: Associate Product Manager ↔ APM');
expectScore('Product Manager Technical', 'TPM', 1.0, 1.0, '24. Alias: Product Manager Technical ↔ TPM');
expectScore('TPM', 'Technical Product Manager', 1.0, 1.0, '25. Alias: TPM ↔ Technical Product Manager');
expectScore('Program Manager', 'PGM', 1.0, 1.0, '26. Alias: Program Manager ↔ PGM');
expectScore('Rotational Product Manager', 'RPM', 1.0, 1.0, '27. Alias: Rotational Product Manager ↔ RPM');
expectScore('Engagement Manager', 'EM', 1.0, 1.0, '28. Alias: Engagement Manager ↔ EM');
expectScore('Case Team Leader', 'CTL', 1.0, 1.0, '29. Alias: Case Team Leader ↔ CTL');
expectScore('Project Leader', 'PL', 1.0, 1.0, '30. Alias: Project Leader ↔ PL');
expectScore('Associate Principal', 'AP', 1.0, 1.0, '31. Alias: Associate Principal ↔ AP');
expectScore('Senior Vice President', 'SVP', 1.0, 1.0, '32. Alias: Senior Vice President ↔ SVP');
expectScore('Executive Vice President', 'EVP', 1.0, 1.0, '33. Alias: Executive Vice President ↔ EVP');
expectScore('Assistant Vice President', 'AVP', 1.0, 1.0, '34. Alias: Assistant Vice President ↔ AVP');
expectScore('Senior Business Analyst', 'SBA', 1.0, 1.0, '35. Alias: Senior Business Analyst ↔ SBA');

// --- Senior/Sr prefix variations (should be 1.0) ---
expectScore('Senior Consultant', 'Sr Consultant', 1.0, 1.0, '36. Prefix: Senior ↔ Sr Consultant');
expectScore('Senior Consultant', 'Sr. Consultant', 1.0, 1.0, '37. Prefix: Senior ↔ Sr. Consultant');
expectScore('Sr Consultant', 'Sr. Consultant', 1.0, 1.0, '38. Prefix: Sr ↔ Sr. Consultant');
expectScore('Senior Manager', 'Sr Manager', 1.0, 1.0, '39. Prefix: Senior ↔ Sr Manager');
expectScore('Senior Manager', 'Sr. Manager', 1.0, 1.0, '40. Prefix: Senior ↔ Sr. Manager');
expectScore('Senior Associate', 'Sr Associate', 1.0, 1.0, '41. Prefix: Senior ↔ Sr Associate');
expectScore('Senior Analyst', 'Sr Analyst', 1.0, 1.0, '42. Prefix: Senior ↔ Sr Analyst');
expectScore('Senior Analyst', 'Sr. Analyst', 1.0, 1.0, '43. Prefix: Senior ↔ Sr. Analyst');
expectScore('Senior Director', 'Sr Director', 1.0, 1.0, '44. Prefix: Senior ↔ Sr Director');
expectScore('Junior Consultant', 'Jr Consultant', 1.0, 1.0, '45. Prefix: Junior ↔ Jr Consultant');
expectScore('Junior Consultant', 'Jr. Consultant', 1.0, 1.0, '46. Prefix: Junior ↔ Jr. Consultant');
expectScore('Senior Product Manager', 'Sr Product Manager', 1.0, 1.0, '47. Prefix: Senior ↔ Sr Product Manager');
expectScore('Senior PM', 'Sr PM', 1.0, 1.0, '48. Prefix: Senior PM ↔ Sr PM');

// --- Connector variations (should be 1.0) ---
expectScore('Sales & Trading', 'Sales and Trading', 1.0, 1.0, '49. Connector: & ↔ and (Sales & Trading)');
expectScore('Managing Director & Partner', 'Managing Director and Partner', 1.0, 1.0, '50. Connector: & ↔ and (MD & Partner)');

console.log(`\n${BOLD}═══ Score Matching: Close Matches (expect 0.5–0.9) ═══${RESET}\n`);

// --- Seniority-adjacent roles (should be 0.5-0.9 via token overlap) ---
expectScore('Consultant', 'Senior Consultant', 0.4, 0.9, '51. Senior prefix: Consultant vs Senior Consultant');
expectScore('Analyst', 'Senior Analyst', 0.4, 0.9, '52. Senior prefix: Analyst vs Senior Analyst');
expectScore('Associate', 'Senior Associate', 0.4, 0.9, '53. Senior prefix: Associate vs Senior Associate');
expectScore('Manager', 'Senior Manager', 0.4, 0.9, '54. Senior prefix: Manager vs Senior Manager');
expectScore('Vice President', 'Senior Vice President', 0.5, 0.9, '55. Level adj: VP vs SVP');
expectScore('Product Manager', 'Senior Product Manager', 0.5, 0.9, '56. Level adj: PM vs Senior PM');
expectScore('Associate', 'Associate Consultant', 0.4, 0.9, '57. Role adj: Associate vs Associate Consultant');
expectScore('Consultant', 'Associate Consultant', 0.4, 0.9, '58. Role adj: Consultant vs Associate Consultant');
expectScore('Director', 'Senior Director', 0.4, 0.9, '59. Senior prefix: Director vs Senior Director');
expectScore('Director', 'Managing Director', 0.4, 0.9, '60. Level adj: Director vs Managing Director');

// --- Abbreviation + extra context (token overlap after expansion) ---
expectScore('Vice President', 'VP of Operations', 0.5, 0.9, '61. Expanded: Vice President vs VP of Operations');
expectScore('VP', 'Vice President of Sales', 0.5, 0.9, '62. Expanded: VP vs Vice President of Sales');
expectScore('Product Manager', 'PM - Growth', 0.8, 1.0, '63. Expanded: Product Manager vs PM - Growth (core=PM)');
expectScore('Managing Director', 'MD - Capital Markets', 0.8, 1.0, '64. Expanded: Managing Director vs MD - Capital Markets (core=MD)');
expectScore('Investment Banking', 'IB Analyst', 0.5, 0.9, '65. Expanded: Investment Banking vs IB Analyst');
expectScore('Business Analyst', 'BA - Strategy', 0.8, 1.0, '66. Expanded: Business Analyst vs BA - Strategy (core=BA)');

// --- Similar but different titles (moderate overlap) ---
expectScore('Business Analyst', 'Data Analyst', 0.3, 0.9, '67. Overlap: Business Analyst vs Data Analyst');
expectScore('Product Manager', 'Product Designer', 0.3, 0.9, '68. Overlap: Product Manager vs Product Designer');
expectScore('Engagement Manager', 'Account Manager', 0.3, 0.9, '69. Overlap: Engagement Manager vs Account Manager');
expectScore('Project Leader', 'Project Manager', 0.3, 0.9, '70. Overlap: Project Leader vs Project Manager');
expectScore('Wealth Management', 'Asset Management', 0.3, 0.9, '71. Overlap: Wealth Management vs Asset Management');
expectScore('Investment Banking', 'Investment Management', 0.3, 0.9, '72. Overlap: Investment Banking vs Investment Management');

console.log(`\n${BOLD}═══ Score Matching: No/Low Match (expect 0.0–0.3) ═══${RESET}\n`);

// --- Completely different roles (should be 0) ---
expectScore('Vice President', 'Analyst', 0.0, 0.1, '73. Different: Vice President vs Analyst');
expectScore('Partner', 'Analyst', 0.0, 0.1, '74. Different: Partner vs Analyst');
expectScore('Product Manager', 'Consultant', 0.0, 0.1, '75. Different: Product Manager vs Consultant');
expectScore('Investment Banking', 'Consulting', 0.0, 0.1, '76. Different: Investment Banking vs Consulting');
expectScore('Private Equity', 'Sales & Trading', 0.0, 0.1, '77. Different: Private Equity vs Sales & Trading');
expectScore('Business Analyst', 'Partner', 0.0, 0.1, '78. Different: Business Analyst vs Partner');
expectScore('Director', 'Analyst', 0.0, 0.1, '79. Different: Director vs Analyst');
expectScore('Associate', 'Partner', 0.0, 0.1, '80. Different: Associate vs Partner');
expectScore('Engagement Manager', 'Analyst', 0.0, 0.1, '81. Different: Engagement Manager vs Analyst');
expectScore('Case Team Leader', 'Product Manager', 0.0, 0.2, '82. Different: Case Team Leader vs Product Manager');
expectScore('Rotational Product Manager', 'Vice President', 0.0, 0.1, '83. Different: RPM vs VP');
expectScore('Wealth Management', 'Consultant', 0.0, 0.1, '84. Different: Wealth Management vs Consultant');
expectScore('Program Manager', 'Analyst', 0.0, 0.1, '85. Different: Program Manager vs Analyst');
expectScore('Associate Principal', 'Business Analyst', 0.0, 0.2, '86. Different: Associate Principal vs BA');

// --- Edge cases: null/empty ---
expectScore('Vice President', null, 0.0, 0.0, '87. Edge: search vs null');
expectScore('Vice President', '', 0.0, 0.0, '88. Edge: search vs empty');
expectScore('', 'Vice President', 0.0, 0.0, '89. Edge: empty search');

console.log(`\n${BOLD}═══ Score Matching: Real LinkedIn Titles ═══${RESET}\n`);

// --- Real-world LinkedIn-style role strings ---
expectScore('Vice President', 'Vice President, Investment Banking Division', 0.8, 1.0, '90. Real: VP vs VP, IBD (core=VP)');
expectScore('Analyst', 'Investment Banking Analyst', 0.3, 0.9, '91. Real: Analyst vs IB Analyst');
expectScore('Associate', 'Investment Banking Associate', 0.3, 0.9, '92. Real: Associate vs IB Associate');
expectScore('Product Manager', 'Product Manager, Ads & Commerce', 0.8, 1.0, '93. Real: PM vs PM, Ads & Commerce (core=PM)');
expectScore('Consultant', 'Management Consultant', 0.4, 0.9, '94. Real: Consultant vs Management Consultant');
expectScore('Senior Consultant', 'Sr. Consultant - Strategy', 0.5, 1.0, '95. Real: Senior Consultant vs Sr. Consultant - Strategy');
expectScore('Business Analyst', 'Business Analyst Intern', 0.5, 0.9, '96. Real: BA vs BA Intern');
expectScore('Associate', 'Associate - Advisory', 0.3, 0.9, '97. Real: Associate vs Associate - Advisory');
expectScore('Manager', 'Manager - Human Capital', 0.3, 0.9, '98. Real: Manager vs Manager - Human Capital');
expectScore('Product Manager', 'Group Product Manager', 0.5, 0.9, '99. Real: PM vs Group PM');
expectScore('Vice President', 'VP & Head of Strategy', 0.3, 0.9, '100. Real: VP vs VP & Head of Strategy (& not a delimiter)');

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}═══════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}Results: ${passed + failed} tests${RESET}`);
console.log(`  ${GREEN}${passed} passed${RESET}`);
if (failed > 0) {
  console.log(`  ${RED}${failed} failed${RESET}`);
}
console.log(`  ${YELLOW}Pass rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%${RESET}`);
console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}\n`);

process.exit(failed > 0 ? 1 : 0);
