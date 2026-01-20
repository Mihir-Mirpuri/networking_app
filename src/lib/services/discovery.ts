const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

// Comprehensive job title dictionary to filter out false positives
// Case-insensitive matching is used when checking against this set
const JOB_TITLES = new Set([
  // Consulting
  'associate consultant', 'consultant', 'senior consultant', 'principal consultant',
  'managing consultant', 'lead consultant', 'staff consultant', 'junior consultant',
  'associate', 'senior associate', 'principal associate', 'managing associate',
  'analyst', 'senior analyst', 'principal analyst', 'lead analyst', 'staff analyst',
  'business analyst', 'management consultant', 'strategy consultant',
  'technology consultant', 'financial consultant', 'operations consultant',
  
  // Finance & Banking
  'vice president', 'vp', 'senior vice president', 'svp', 'executive vice president', 'evp',
  'director', 'senior director', 'managing director', 'md', 'executive director',
  'associate', 'senior associate', 'principal', 'senior principal',
  'analyst', 'senior analyst', 'investment analyst', 'research analyst',
  'investment banker', 'investment banking analyst', 'ib analyst',
  'portfolio manager', 'fund manager', 'hedge fund manager',
  'trader', 'senior trader', 'quantitative analyst', 'quant',
  'risk analyst', 'credit analyst', 'equity analyst', 'fixed income analyst',
  'financial analyst', 'corporate finance analyst', 'm&a analyst',
  'chief financial officer', 'cfo', 'chief investment officer', 'cio',
  'treasurer', 'controller', 'accountant', 'senior accountant',
  
  // Technology
  'software engineer', 'senior software engineer', 'staff software engineer',
  'principal software engineer', 'lead software engineer', 'engineering manager',
  'senior engineering manager', 'director of engineering', 'vp of engineering',
  'product manager', 'senior product manager', 'principal product manager',
  'group product manager', 'director of product', 'vp of product',
  'technical lead', 'tech lead', 'engineering lead', 'architect',
  'senior architect', 'principal architect', 'solutions architect',
  'data scientist', 'senior data scientist', 'data engineer', 'ml engineer',
  'devops engineer', 'site reliability engineer', 'sre',
  'qa engineer', 'test engineer', 'quality assurance engineer',
  'security engineer', 'cybersecurity engineer', 'information security',
  'chief technology officer', 'cto', 'chief information officer', 'cio',
  'it director', 'it manager', 'systems administrator', 'network engineer',
  
  // General Business
  'manager', 'senior manager', 'general manager', 'regional manager',
  'area manager', 'district manager', 'store manager', 'branch manager',
  'operations manager', 'project manager', 'program manager',
  'senior project manager', 'portfolio manager', 'product manager',
  'marketing manager', 'sales manager', 'account manager', 'client manager',
  'business development manager', 'bd manager', 'partnership manager',
  'director', 'senior director', 'executive director', 'managing director',
  'vice president', 'vp', 'senior vice president', 'svp',
  'president', 'coo', 'chief operating officer', 'ceo', 'chief executive officer',
  'chief marketing officer', 'cmo', 'chief sales officer', 'cso',
  'chief revenue officer', 'cro', 'chief people officer', 'cpo',
  'chief strategy officer', 'cso', 'chief data officer', 'cdo',
  
  // Sales & Business Development
  'sales representative', 'sales rep', 'account executive', 'ae',
  'senior account executive', 'sales director', 'sales manager',
  'business development representative', 'bdr', 'sales development representative', 'sdr',
  'account manager', 'key account manager', 'territory manager',
  'inside sales', 'outside sales', 'field sales',
  'sales engineer', 'pre-sales engineer', 'solutions engineer',
  
  // Marketing
  'marketing manager', 'marketing director', 'vp of marketing',
  'brand manager', 'product marketing manager', 'growth marketing manager',
  'digital marketing manager', 'content marketing manager', 'social media manager',
  'marketing analyst', 'marketing coordinator', 'marketing specialist',
  'community manager', 'brand ambassador', 'influencer relations',
  
  // Human Resources
  'hr manager', 'human resources manager', 'hr director', 'hr business partner',
  'talent acquisition', 'recruiter', 'senior recruiter', 'technical recruiter',
  'people operations', 'people manager', 'head of people',
  'chief people officer', 'cpo', 'chief human resources officer', 'chro',
  
  // Legal & Compliance
  'attorney', 'lawyer', 'counsel', 'senior counsel', 'general counsel',
  'legal counsel', 'corporate counsel', 'compliance officer',
  'chief legal officer', 'clo', 'paralegal', 'legal assistant',
  
  // Operations & Supply Chain
  'operations manager', 'operations director', 'vp of operations',
  'supply chain manager', 'logistics manager', 'procurement manager',
  'operations analyst', 'process improvement', 'lean manager',
  'chief operating officer', 'coo', 'chief supply chain officer',
  
  // Finance & Accounting (additional)
  'accountant', 'senior accountant', 'staff accountant', 'cost accountant',
  'tax accountant', 'auditor', 'internal auditor', 'external auditor',
  'financial controller', 'assistant controller', 'accounting manager',
  'billing manager', 'accounts payable', 'accounts receivable',
  
  // Academia & Research
  'professor', 'assistant professor', 'associate professor', 'full professor',
  'research scientist', 'postdoctoral researcher', 'postdoc',
  'research associate', 'research assistant', 'graduate student',
  'phd student', 'doctoral student', 'lab manager', 'research director',
  
  // Healthcare
  'physician', 'doctor', 'nurse', 'registered nurse', 'rn',
  'physician assistant', 'pa', 'nurse practitioner', 'np',
  'medical director', 'chief medical officer', 'cmo',
  'clinical researcher', 'clinical trial manager',
  
  // Real Estate
  'real estate agent', 'realtor', 'broker', 'real estate broker',
  'property manager', 'leasing agent', 'commercial real estate',
  
  // Media & Communications
  'editor', 'senior editor', 'managing editor', 'editor in chief',
  'journalist', 'reporter', 'correspondent', 'news anchor',
  'content creator', 'content strategist', 'copywriter', 'technical writer',
  'communications manager', 'public relations manager', 'pr manager',
  'social media coordinator', 'community manager',
  
  // Education
  'teacher', 'instructor', 'professor', 'lecturer', 'adjunct professor',
  'principal', 'vice principal', 'superintendent', 'dean',
  'curriculum director', 'education coordinator',
  
  // Non-profit & Government
  'executive director', 'program director', 'development director',
  'grant writer', 'volunteer coordinator', 'outreach coordinator',
  'policy analyst', 'policy advisor', 'legislative assistant',
  
  // Common abbreviations and variations
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cpo', 'cso', 'cio', 'clo', 'chro',
  'vp', 'svp', 'evp', 'md', 'sdr', 'bdr', 'ae', 'pa', 'np', 'rn',
  
  // Generic titles that are often confused with names
  'assistant', 'associate', 'coordinator', 'specialist', 'administrator',
  'representative', 'executive', 'officer', 'director', 'manager',
  'supervisor', 'lead', 'senior', 'principal', 'staff', 'junior',
]);

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface CSEResponse {
  items?: CSEResult[];
}

export interface SearchParams {
  university: string;
  company: string;
  role: string;
  location: string;
  limit: number;
  excludePersonKeys?: Set<string>; // Set of "fullName_company" keys (lowercase) to exclude
}

export interface SearchResult {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  sourceUrl: string;
  sourceTitle: string;
  sourceSnippet: string;
  sourceDomain: string;
  confidence?: number;
  isLowConfidence?: boolean;
  extractionMethod?: 'linkedin' | 'pipe' | 'snippet' | 'role-first' | 'fallback';
}

async function searchCSE(query: string, start?: number): Promise<CSEResult[]> {
  if (!CSE_API_KEY) {
    console.log('CSE API key not configured, skipping search');
    return [];
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  if (start) {
    url.searchParams.set('start', start.toString());
  }

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.error('CSE API error:', response.status, await response.text());
      return [];
    }
    const data: CSEResponse = await response.json();
    return data.items || [];
  } catch (error) {
    console.error('CSE fetch error:', error);
    return [];
  }
}

// Helper to parse name components (handles titles, middle names, hyphenated names)
function parseNameComponents(nameStr: string): { firstName: string; lastName: string; fullName: string } {
  // Remove common titles
  const cleaned = nameStr.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Professor)\s+/i, '').trim();
  const parts = cleaned.split(/\s+/);
  
  if (parts.length === 0) {
    return { firstName: '', lastName: '', fullName: '' };
  }
  
  // First name is first part
  const firstName = parts[0];
  
  // Last name is everything else (handles middle names, hyphenated last names)
  const lastName = parts.slice(1).join(' ');
  
  return {
    firstName,
    lastName,
    fullName: cleaned,
  };
}

// Parse candidate name from search result with enhanced pattern matching
function parseCandidate(result: CSEResult, company: string): {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  extractionMethod: 'linkedin' | 'pipe' | 'snippet' | 'role-first' | 'fallback';
} | null {
  const title = result.title;
  const snippet = result.snippet;

  // Pattern 1: LinkedIn-style "Name - Role at Company" (highest priority)
  // Handles: "John Doe - Analyst at Company", "Dr. Jane Smith - VP at Company"
  const linkedinMatch = title.match(/^((?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Professor)\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[-–|]/);
  if (linkedinMatch) {
    const nameStr = (linkedinMatch[1] || '') + linkedinMatch[2];
    const nameParts = parseNameComponents(nameStr);
    
    if (nameParts.firstName && nameParts.lastName) {
      // Try to extract role
      const roleMatch = title.match(/[-–|]\s*([^|–-]+?)(?:\s+at\s+|\s+@\s+|$)/i);
      const role = roleMatch ? roleMatch[1].trim() : null;

      return {
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        role,
        extractionMethod: 'linkedin',
      };
    }
  }

  // Pattern 2: Pipe format "Name | Role at Company"
  const pipeMatch = title.match(/^((?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Professor)\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*\|/);
  if (pipeMatch) {
    const nameStr = (pipeMatch[1] || '') + pipeMatch[2];
    const nameParts = parseNameComponents(nameStr);
    
    if (nameParts.firstName && nameParts.lastName) {
      return {
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        role: null,
        extractionMethod: 'pipe',
      };
    }
  }

  // Pattern 3: Role-first format "Role - Name at Company" (NEW - handles the Eleanor McLeod case)
  // Handles: "Associate Consultant - Eleanor McLeod at Bain"
  const roleFirstMatch = title.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*[-–|]\s*((?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Professor)\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?:\s+at\s+|\s+@\s+|$)/i);
  if (roleFirstMatch) {
    const potentialRole = roleFirstMatch[1].trim();
    const nameStr = (roleFirstMatch[2] || '') + roleFirstMatch[3];
    const nameParts = parseNameComponents(nameStr);
    
    if (nameParts.firstName && nameParts.lastName) {
      // Check if the "role" part is actually a job title (will be validated later)
      return {
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        role: potentialRole,
        extractionMethod: 'role-first',
      };
    }
  }

  // Pattern 4: Snippet-based extraction (name mentioned with company)
  const companyRegex = new RegExp(`((?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Professor)\\s+)?([A-Z][a-z]+\\s+[A-Z][a-z]+).*?${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const snippetMatch = snippet.match(companyRegex);
  if (snippetMatch) {
    const nameStr = (snippetMatch[1] || '') + snippetMatch[2];
    const nameParts = parseNameComponents(nameStr);
    
    if (nameParts.firstName && nameParts.lastName) {
      return {
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        role: null,
        extractionMethod: 'snippet',
      };
    }
  }

  // Pattern 5: Fallback - try to find any capitalized name pattern in title
  const fallbackMatch = title.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (fallbackMatch) {
    const nameParts = parseNameComponents(fallbackMatch[1]);
    
    if (nameParts.firstName && nameParts.lastName) {
      return {
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        role: null,
        extractionMethod: 'fallback',
      };
    }
  }

  return null;
}

// Calculate confidence score for a parsed candidate
function calculateConfidence(
  parsed: { fullName: string; firstName: string | null; lastName: string | null; extractionMethod: string },
  result: CSEResult,
  company: string
): number {
  const { fullName, extractionMethod } = parsed;
  const title = result.title;
  const snippet = result.snippet;
  
  // Pattern type score (which extraction method was used)
  const patternScores: Record<string, number> = {
    'linkedin': 0.9,
    'pipe': 0.8,
    'role-first': 0.7,
    'snippet': 0.6,
    'fallback': 0.5,
  };
  const patternScore = patternScores[extractionMethod] || 0.5;
  
  // Position score (where name appears in title)
  const titleLower = title.toLowerCase();
  const fullNameLower = fullName.toLowerCase();
  let positionScore = 0.5;
  
  if (titleLower.startsWith(fullNameLower)) {
    positionScore = 0.9; // Name at start of title
  } else if (titleLower.includes(fullNameLower)) {
    const nameIndex = titleLower.indexOf(fullNameLower);
    const titleLength = title.length;
    const relativePosition = nameIndex / titleLength;
    
    if (relativePosition < 0.3) {
      positionScore = 0.8; // Early in title
    } else if (relativePosition < 0.7) {
      positionScore = 0.7; // Middle of title
    } else {
      positionScore = 0.5; // Late in title
    }
  }
  
  // Capitalization score (proper name format)
  const nameWords = fullName.split(/\s+/);
  let capitalizationScore = 0.5;
  
  if (nameWords.length >= 2) {
    const allProperCase = nameWords.every(word => 
      word.length > 0 && word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()
    );
    
    if (allProperCase) {
      capitalizationScore = 0.9; // Perfect proper case
    } else if (nameWords[0][0] === nameWords[0][0].toUpperCase()) {
      capitalizationScore = 0.7; // First word capitalized
    } else {
      capitalizationScore = 0.4; // Poor capitalization
    }
  }
  
  // Context score (presence of company name, role keywords)
  let contextScore = 0.5;
  
  const companyLower = company.toLowerCase();
  const titleAndSnippet = (title + ' ' + snippet).toLowerCase();
  
  if (titleAndSnippet.includes(companyLower)) {
    contextScore = 0.8; // Company name present
  }
  
  // Check for role keywords
  const roleKeywords = ['at', 'works at', 'employed at', 'role', 'position', 'title'];
  if (roleKeywords.some(keyword => titleAndSnippet.includes(keyword))) {
    contextScore = Math.max(contextScore, 0.7); // Role keywords present
  }
  
  // Weighted combination
  const confidence = (
    patternScore * 0.4 +
    positionScore * 0.3 +
    capitalizationScore * 0.2 +
    contextScore * 0.1
  );
  
  return Math.round(confidence * 100) / 100; // Round to 2 decimal places
}

// Validate that a parsed candidate name is actually a valid person name
function isValidPersonName(
  parsed: { fullName: string; firstName: string | null; lastName: string | null },
  company: string
): boolean {
  const { fullName, firstName, lastName } = parsed;

  // 0. Check if it's a job title (FIRST CHECK - most important)
  // Normalize whitespace for consistent matching
  const fullNameLower = fullName.toLowerCase().replace(/\s+/g, ' ').trim();
  if (JOB_TITLES.has(fullNameLower)) {
    return false;
  }
  
  // Also check if firstName or lastName individually are job titles
  if (firstName && JOB_TITLES.has(firstName.toLowerCase().trim())) {
    return false;
  }
  if (lastName && JOB_TITLES.has(lastName.toLowerCase().trim())) {
    return false;
  }
  
  // Check if fullName contains a job title (e.g., "Senior Associate Consultant")
  const nameWords = fullNameLower.split(/\s+/);
  for (const word of nameWords) {
    if (JOB_TITLES.has(word)) {
      return false;
    }
  }
  
  // Check for multi-word job titles (e.g., "associate consultant")
  for (let i = 0; i < nameWords.length - 1; i++) {
    const twoWord = `${nameWords[i]} ${nameWords[i + 1]}`;
    if (JOB_TITLES.has(twoWord)) {
      return false;
    }
  }
  
  // Check for three-word job titles
  for (let i = 0; i < nameWords.length - 2; i++) {
    const threeWord = `${nameWords[i]} ${nameWords[i + 1]} ${nameWords[i + 2]}`;
    if (JOB_TITLES.has(threeWord)) {
      return false;
    }
  }

  // 1. Must have both first and last name
  if (!firstName || !lastName || firstName.trim() === '' || lastName.trim() === '') {
    return false;
  }

  // 2. Reject names that are too short (likely incomplete)
  if (firstName.length < 2 || lastName.length < 2) {
    return false;
  }

  // 3. Reject if name matches or contains company name (case-insensitive)
  // This catches "Goldman Sachs" being parsed as a person name
  // Normalize whitespace for better matching
  const companyLower = company.toLowerCase().replace(/\s+/g, ' ').trim();
  
  // Check for exact match or substring match
  if (fullNameLower === companyLower || 
      fullNameLower.includes(companyLower) || 
      companyLower.includes(fullNameLower)) {
    return false;
  }

  // 4. Reject if name contains email address pattern (like "10ksb_voices@gs.com")
  const emailPattern = /@|\.(com|org|net|edu|gov|io|co)/i;
  if (emailPattern.test(fullName)) {
    return false;
  }

  // 5. Reject common non-person patterns (but NOT "no email" - that's just status info)
  const invalidPatterns = [
    /^n\/a$/i,
    /^unknown$/i,
    /^tbd$/i,
    /^company$/i,
    /^department$/i,
    /^team$/i,
    /^group$/i,
    /^review$/i,
    /^verified$/i,
  ];
  if (invalidPatterns.some(pattern => pattern.test(fullName))) {
    return false;
  }

  // 6. Reject if name starts with common words (like "from", "the", etc.)
  // This catches "From Goldman" where "From" is a common word
  const commonWords = ['from', 'the', 'and', 'or', 'at', 'in', 'on', 'to', 'for'];
  // Check if first word is a common word
  if (nameWords.length > 0 && commonWords.includes(nameWords[0])) {
    return false;
  }
  // Also check if it's a single common word
  if (nameWords.length === 1 && commonWords.includes(nameWords[0])) {
    return false;
  }

  // 7. Reject if name contains only numbers or special characters
  if (!/[a-zA-Z]/.test(fullName)) {
    return false;
  }

  // 8. Reject if name looks like it's just a fragment (starts with lowercase)
  // This catches things like "rom Goldman" where "rom" is a fragment
  const firstWord = fullName.split(/\s+/)[0];
  if (firstWord && firstWord[0] && firstWord[0] === firstWord[0].toLowerCase()) {
    // Exception: Allow if it's a valid name that happens to start lowercase in context
    // But reject if it's clearly a fragment (very short)
    if (firstWord.length < 3) {
      return false;
    }
  }

  return true;
}

function normalizeKey(name: string, company: string, url: string): string {
  return `${name.toLowerCase().replace(/\s+/g, '_')}_${company.toLowerCase().replace(/\s+/g, '_')}_${url}`;
}

export async function searchPeople(params: SearchParams): Promise<SearchResult[]> {
  const { university, company, role, location, limit, excludePersonKeys = new Set() } = params;

  // Build location string for queries (only if location is specified)
  const locationStr = location ? ` "${location}"` : '';

  // Use single optimized query with pagination (include location if specified)
  const query = `${university} ${company} ${role}${locationStr}`;
  const pages = [1, 11, 21, 31, 41, 51]; // 6 pages = 60 results max

  const seenKeys = new Set<string>();
  const candidates: SearchResult[] = [];

  // Split pages into batches of 3 for controlled concurrency
  const BATCH_SIZE = 3;
  const batches: number[][] = [];
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    batches.push(pages.slice(i, i + BATCH_SIZE));
  }

  // Process batches sequentially, pages within batch in parallel
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    if (candidates.length >= limit) break;

    const batch = batches[batchIndex];

    // Execute all pages in batch concurrently
    const batchResults = await Promise.all(
      batch.map(pageOffset => searchCSE(query, pageOffset))
    );

    // Process results from all pages in the batch
    for (const results of batchResults) {
      if (candidates.length >= limit) break;

      for (const result of results) {
        if (candidates.length >= limit) break;

        const parsed = parseCandidate(result, company);
        if (!parsed) continue;

        // Validate that the parsed name is actually a valid person name
        if (!isValidPersonName(parsed, company)) {
          console.log(`[Discovery] Skipping invalid person name: ${parsed.fullName}`);
          continue;
        }

        // Calculate confidence score
        const confidence = calculateConfidence(parsed, result, company);
        const isLowConfidence = confidence < 0.6;

        // Log low-confidence matches for monitoring
        if (isLowConfidence) {
          console.log(`[Discovery] Low confidence match (${confidence}): ${parsed.fullName} at ${company} (method: ${parsed.extractionMethod})`);
        }

        // Check if person is already discovered by this user
        const personKey = `${parsed.fullName}_${company}`.toLowerCase();
        if (excludePersonKeys.has(personKey)) {
          console.log(`[Discovery] Skipping already discovered: ${parsed.fullName} at ${company}`);
          continue;
        }

        // Check for duplicate URLs (same person from different pages)
        const key = normalizeKey(parsed.fullName, company, result.link);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        candidates.push({
          fullName: parsed.fullName,
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          company,
          role: parsed.role,
          sourceUrl: result.link,
          sourceTitle: result.title,
          sourceSnippet: result.snippet,
          sourceDomain: result.displayLink,
          confidence,
          isLowConfidence,
          extractionMethod: parsed.extractionMethod,
        });
      }
    }

    // Rate limiting between batches (not after last batch or if limit reached)
    if (candidates.length < limit && batchIndex < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return candidates;
}
