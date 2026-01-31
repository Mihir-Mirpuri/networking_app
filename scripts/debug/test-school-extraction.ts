/**
 * Test script to extract school data from CSE snippets/titles
 */

// Common university patterns to look for
const UNIVERSITY_PATTERNS = [
  // Explicit "Education:" prefix from LinkedIn
  /Education:\s*([^·|]+(?:University|College|School|Institute)[^·|]*)/i,
  // "@ University" pattern in titles
  /@\s*([^|]+(?:University|College|School)[^|]*)/i,
  // University name followed by "Graphic" (LinkedIn format)
  /([A-Z][a-zA-Z\s&]+(?:University|College|School|Institute))\s*(?:Graphic|\.)/i,
  // "graduate from X" pattern
  /graduate\s+(?:from|of)\s+([^·|]+(?:University|College|School)[^·|]*)/i,
  // Direct university mention with common suffixes
  /((?:The\s+)?[A-Z][a-zA-Z\s]+(?:University|College|School of Business|School of Engineering|Institute of Technology))/,
];

// Known university names for exact matching
const KNOWN_UNIVERSITIES = [
  'Rice University',
  'Texas A&M University',
  'Texas Christian University',
  'The University of Texas at Austin',
  'University of Texas at Austin',
  'Duke University',
  'Stanford University',
  'Harvard University',
  'Yale University',
  'Princeton University',
  'MIT',
  'Massachusetts Institute of Technology',
  'The Wharton School',
  'Columbia University',
  'University of Pennsylvania',
  'Northwestern University',
  'University of Chicago',
  'Cornell University',
  'Brown University',
  'Dartmouth College',
];

function extractSchool(title: string, snippet: string | null): string | null {
  const text = `${title} ${snippet || ''}`;

  // First, try exact matches for known universities
  for (const uni of KNOWN_UNIVERSITIES) {
    if (text.includes(uni)) {
      return uni;
    }
  }

  // Try regex patterns
  for (const pattern of UNIVERSITY_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// Test with sample data
const testCases = [
  {
    name: 'Olivia Keller',
    title: 'Olivia Keller - Associate Consultant at Bain & Company | LinkedIn',
    snippet: 'Associate Consultant at Bain & Company. Bain & Company Texas Christian University - M.J. Neeley School of Business. Houston, Texas, United States. 900 ...',
    expected: 'Texas Christian University',
  },
  {
    name: 'Austin Tran',
    title: 'Austin Tran - Associate Consultant @ Bain & Company | LinkedIn',
    snippet: 'Associate Consultant @ Bain & Company. Bain & Company Rice University ... 3 months. Houston, Texas, United States. Pricing Strategy & Gen AI Growth. Rice ...',
    expected: 'Rice University',
  },
  {
    name: 'Carolina Mountain',
    title: 'Carolina Mountain - Consultant at Bain & Company Dallas | LinkedIn',
    snippet: 'Consultant at Bain & Company Dallas · Experience: Bain & Company · Education: The University of Texas at Austin - Red McCombs School of Business · Location: ...',
    expected: 'The University of Texas at Austin',
  },
  {
    name: 'Bianca Zamora',
    title: 'Bianca Zamora - Associate Consultant at Bain & Co. | LinkedIn',
    snippet: 'Associate Consultant at Bain & Co. · Experience: Bain & Company · Education: Texas A&M University · Location: Greater Houston · 500+ connections on LinkedIn ...',
    expected: 'Texas A&M University',
  },
  {
    name: 'Sai Abhijit Pabbisetty',
    title: 'Sai Abhijit Pabbisetty - Associate Consultant @ Bain & Co. | LinkedIn',
    snippet: 'Associate Consultant @ Bain & Co. · I am a graduate from The University of Texas at Austin with majors in Canfield Business Honors and Management ...',
    expected: 'The University of Texas at Austin',
  },
];

console.log('=== School Extraction Test ===\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const extracted = extractSchool(tc.title, tc.snippet);
  const match = extracted === tc.expected ||
    (extracted && tc.expected && extracted.includes(tc.expected)) ||
    (extracted && tc.expected && tc.expected.includes(extracted));

  if (match) {
    console.log(`✅ ${tc.name}: ${extracted}`);
    passed++;
  } else {
    console.log(`❌ ${tc.name}:`);
    console.log(`   Expected: ${tc.expected}`);
    console.log(`   Got: ${extracted}`);
    failed++;
  }
}

console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
