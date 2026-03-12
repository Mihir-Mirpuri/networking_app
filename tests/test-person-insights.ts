/**
 * Test: Person insights with updated prompt (personal info focus)
 * Tests Tyler Fu and Mansi Desai
 *
 * Usage: npx tsx tests/test-person-insights.ts
 */

import 'dotenv/config';
import { searchSerper } from '../src/lib/services/serper';
import Anthropic from '@anthropic-ai/sdk';

interface PersonData {
  fullName: string;
  company: string;
  role: string;
  linkedinUrl: string;
  city: string | null;
  state: string | null;
  country: string | null;
  educationSchool: string | null;
  schools: string[];
  experienceHistory: Array<{ position: string | null; companyName: string | null; location: string | null; description: string | null; startDate: { text: string } | null; endDate: { text: string } | null }>;
  educationHistory: Array<{ schoolName: string; degree: string | null; fieldOfStudy: string | null; activities: string | null; description: string | null; startDate: { text: string } | null; endDate: { text: string } | null; grade: string | null }>;
}

const PEOPLE: PersonData[] = [
  {
    fullName: 'Tyler Fu',
    company: 'JPMorganChase',
    role: 'Reference Data Operations Analyst',
    linkedinUrl: 'https://www.linkedin.com/in/tyler-fu',
    city: 'Newark', state: null, country: 'DE',
    educationSchool: 'University of Toronto',
    schools: ['University of Toronto'],
    experienceHistory: [
      { position: 'Reference Data Operations Analyst', companyName: 'JPMorganChase', location: 'Newark, DE', description: null, startDate: { text: 'Mar 2026' }, endDate: { text: 'Present' } },
      { position: 'Financial Data Analyst', companyName: 'Bloomberg', location: 'Princeton, NJ', description: 'Help enhance existing machine learning software. Extract, interpret, and analyze data. Evaluate financial trades including options, swaps, and forwards.', startDate: { text: 'Nov 2024' }, endDate: { text: 'Oct 2025' } },
      { position: 'Intern', companyName: 'UNFCU', location: null, description: 'Summer intern for the Global Impact & Inclusion department. ESG reporting, carbon accounting. Python for web-scraping 100,000s of mortgaged properties for CO2 emissions. Salesforce for UNFCU Foundation Gaza Relief Campaign.', startDate: { text: 'Jun 2024' }, endDate: { text: 'Aug 2024' } },
      { position: 'COP28 Virtual Intern', companyName: 'U.S. Department of State', location: 'Dubai, UAE', description: null, startDate: { text: 'Sep 2023' }, endDate: { text: 'May 2024' } },
      { position: 'Intern', companyName: 'New Jersey Board of Public Utilities', location: 'Trenton, NJ', description: 'Energy Savings Improvement Program (ESIP). ENERGY STAR Portfolio Manager audits. Grant applications for energy upgrade projects.', startDate: { text: 'Jun 2023' }, endDate: { text: 'Aug 2023' } },
      { position: 'U.N. NGO Task Force Research Intern', companyName: 'IFMA FOUNDATION', location: 'NYC', description: 'Content creation for U.N. events including HLPF on Sustainable Development and SDG Summit.', startDate: { text: 'May 2023' }, endDate: { text: 'Aug 2023' } },
      { position: 'Compliance Analyst', companyName: 'University of Toronto - Munk School of Global Affairs', location: 'Toronto', description: 'BRICS Research Group. Researching COVID-19 vaccine compliance for BRICS nations.', startDate: { text: 'Aug 2022' }, endDate: { text: 'Jul 2023' } },
      { position: 'Vice President Finance', companyName: 'International Relations Society', location: 'Toronto', description: 'Elected VP Finance for UofT International Relations Society.', startDate: { text: 'Apr 2022' }, endDate: { text: 'Apr 2023' } },
      { position: 'Campus Tour Guide', companyName: 'University of Toronto', location: 'Toronto', description: 'Guided tours at Nona MacDonald Visitors Centre.', startDate: { text: 'Apr 2022' }, endDate: { text: 'Apr 2023' } },
      { position: 'Compliance Analyst', companyName: 'G20 Research Group', location: 'Toronto', description: 'G20 compliance research on India and Australia vaccine commitments.', startDate: { text: 'Mar 2022' }, endDate: { text: 'Oct 2022' } },
    ],
    educationHistory: [
      { schoolName: 'University of Toronto', degree: 'Bachelor of Arts - BA', fieldOfStudy: 'Double Major: International Relations / Economics', activities: null, description: null, startDate: { text: 'Sep 2020' }, endDate: { text: 'Jun 2024' }, grade: null },
    ],
  },
  {
    fullName: 'Mansi Desai',
    company: 'JPMorgan Chase',
    role: 'Technology Audit Analyst',
    linkedinUrl: 'https://www.linkedin.com/in/mansi-desai-7141a487',
    city: 'Greater New York City Area', state: null, country: null,
    educationSchool: 'Rutgers Business School',
    schools: ['Rutgers Business School'],
    experienceHistory: [
      { position: 'Technology Audit Analyst', companyName: 'JPMorgan Chase & Co.', location: 'Greater New York City Area', description: null, startDate: { text: 'Aug 2017' }, endDate: { text: 'Present' } },
      { position: 'Summer Analyst', companyName: 'BlackRock', location: 'Greater New York City Area', description: null, startDate: { text: 'May 2016' }, endDate: { text: 'Jul 2016' } },
      { position: 'Business Systems Analyst Intern (Year Round)', companyName: 'Prudential Financial', location: 'Newark, NJ', description: 'Investment Operations & Systems department.', startDate: { text: 'Jun 2015' }, endDate: { text: 'May 2016' } },
      { position: 'Sierra Mist Alchemist', companyName: 'PepsiCo', location: null, description: '1 in 25 students chosen for an exclusive PepsiCo externship program. Assisted Sierra Mist in product development and market launch.', startDate: { text: 'Feb 2015' }, endDate: { text: 'Apr 2015' } },
      { position: 'Scarlet Ambassador', companyName: 'Rutgers University-Newark', location: null, description: 'Main campus tour guide for prospective freshmen and transfer students.', startDate: { text: 'Apr 2014' }, endDate: { text: 'Aug 2014' } },
      { position: 'Cashier', companyName: 'Cinnabon', location: null, description: null, startDate: { text: 'Apr 2012' }, endDate: { text: 'Jul 2013' } },
    ],
    educationHistory: [
      { schoolName: 'Rutgers, The State University of New Jersey - Rutgers Business School', degree: "Bachelor's degree", fieldOfStudy: 'Finance', activities: null, description: 'Relevant coursework: Finance, Corporate Finance, Financial Econometrics, MIS, Cyber Security.\n\n2015 Independent studies: New Venture Finance: Startup Funding for Entrepreneurs, University of Maryland.\n\nPeace Island Institute scholarship recipient', startDate: { text: '2013' }, endDate: { text: '2017' }, grade: null },
    ],
  },
];

function buildDbContext(p: PersonData): string {
  const lines: string[] = [];
  lines.push(`Name: ${p.fullName}`);
  lines.push(`Company: ${p.company}`);
  if (p.role) lines.push(`Current role: ${p.role}`);
  if (p.linkedinUrl) lines.push(`LinkedIn: ${p.linkedinUrl}`);
  const location = [p.city, p.state, p.country].filter(Boolean).join(', ');
  if (location) lines.push(`Location: ${location}`);

  if (p.experienceHistory.length > 0) {
    lines.push('');
    lines.push('Work experience:');
    for (const exp of p.experienceHistory) {
      const dates = [exp.startDate?.text, exp.endDate?.text].filter(Boolean).join(' – ');
      lines.push(`- ${exp.position} at ${exp.companyName}${dates ? ` (${dates})` : ''}`);
      if (exp.description) lines.push(`  ${exp.description}`);
    }
  }

  if (p.educationHistory.length > 0) {
    lines.push('');
    lines.push('Education:');
    for (const edu of p.educationHistory) {
      let entry = edu.schoolName;
      if (edu.degree) entry += `, ${edu.degree}`;
      if (edu.fieldOfStudy) entry += ` in ${edu.fieldOfStudy}`;
      const dates = [edu.startDate?.text, edu.endDate?.text].filter(Boolean).join(' – ');
      if (dates) entry += ` (${dates})`;
      if (edu.grade) entry += ` | GPA: ${edu.grade}`;
      lines.push(`- ${entry}`);
      if (edu.activities) lines.push(`  Activities: ${edu.activities}`);
      if (edu.description) lines.push(`  ${edu.description}`);
    }
  }

  if (p.schools.length > 1) {
    lines.push(`All schools: ${p.schools.join(', ')}`);
  }

  return lines.join('\n');
}

async function testPerson(p: PersonData, anthropic: Anthropic) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TESTING: ${p.fullName} — ${p.role} at ${p.company}`);
  console.log('='.repeat(60));

  const dbContext = buildDbContext(p);

  // Serper
  let serperSnippets = '';
  try {
    const results = await searchSerper(`"${p.fullName}"`);
    const top10 = results.slice(0, 10);
    serperSnippets = top10.map(r => `- [${r.link}] ${r.title}: ${r.snippet}`).join('\n');
    console.log(`Serper: ${top10.length} results`);
  } catch (err) {
    console.error('Serper failed:', err);
  }

  // LLM
  const systemPrompt = `You are a research assistant helping craft personalized cold emails.

You have been given raw text from multiple sources about a specific person.
Their confirmed identity is: Name: ${p.fullName}, Company: ${p.company}, Title: ${p.role || 'Unknown'}.

IMPORTANT: The user can already see the following on the person's card: their name (${p.fullName}), company (${p.company}), role (${p.role || 'Unknown'}), and school (${p.educationSchool || 'Unknown'}). Do NOT return insights that merely restate this information — for example, "works at ${p.company}", "attended ${p.educationSchool}", or "is a ${p.role}". Only include facts that go beyond what is already visible on the card.

Your job:
1. Discard any content that is clearly not about this specific person.
2. From the remaining content, extract interesting facts that would be useful for personalizing a cold email — including personal interests, hobbies, sports, music, clubs, fraternity/sorority membership, volunteer work, as well as career moves, projects, shared context, professional wins, published work, or anything that signals what they care about beyond their job title.
3. For each fact, assign a confidence score (high/medium) that it refers to the correct person. Discard anything low confidence.
4. Do NOT include generic facts like "works at ${p.company}" or "has a LinkedIn profile".
5. Exclude any insight that is redundant with what the user already sees: their current name, company, role, or school. Only surface information that adds NEW value.
6. Return ALL specific, interesting facts you can find. Do not limit the number — extract every valuable piece of information.

Return ONLY a JSON object with this format:
{
  "insights": [
    {
      "label": "Short human-readable fact (max 12 words)",
      "detail": "One sentence elaboration",
      "type": "career | education | project | achievement | interest",
      "source": "linkedin | google | website | database",
      "confidence": "high | medium",
      "sourceUrl": "The URL where you found this fact, or null if from database"
    }
  ]
}`;

  const userPrompt = `Profile data:
${dbContext}

Discovery/LinkedIn snippets:
(none)

Google search results:
${serperSnippets || '(none)'}`;

  const start = Date.now();
  const completion = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.3,
    max_tokens: 1500,
  });
  const elapsed = Date.now() - start;

  let content = completion.content[0].type === 'text' ? completion.content[0].text : '{}';
  content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(content);
  const insights = parsed.insights || [];

  console.log(`Groq: ${elapsed}ms, ${insights.length} insights\n`);

  for (const i of insights) {
    console.log(`  [${i.type}] ${i.label}`);
    console.log(`    ${i.detail}`);
    console.log(`    source: ${i.source} | confidence: ${i.confidence}`);
    if (i.sourceUrl) console.log(`    url: ${i.sourceUrl}`);
    console.log();
  }
}

async function main() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  for (const p of PEOPLE) {
    await testPerson(p, anthropic);
  }
}

main().catch(console.error);
