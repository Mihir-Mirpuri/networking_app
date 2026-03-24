import 'dotenv/config';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

async function fetchPage(query: string, page: number) {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 10, page, gl: 'us', hl: 'en' }),
  });
  const data = await response.json();
  return data.organic || [];
}

async function main() {
  // Queries that are more likely to produce mismatches
  const queries = [
    'site:linkedin.com/in "BCG" consultant',
    'site:linkedin.com/in "Bain" associate',
    'site:linkedin.com/in "Meta" engineer',
  ];

  for (const query of queries) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Query: ${query}`);
    console.log(`${'='.repeat(80)}\n`);
    
    let count = 0;
    for (let page = 1; page <= 2; page++) {
      const results = await fetchPage(query, page);
      for (const r of results) {
        if (!r.link.includes('linkedin.com/in/')) continue;
        count++;
        
        // Parse title for role+company
        const titleMatch = r.title.match(/^(.+?)\s*[-–]\s*(.+?)\s*(?:[|]|$)/);
        const titleRoleCompany = titleMatch ? titleMatch[2].trim().replace(/\s*\|\s*LinkedIn$/, '') : '(unparseable)';
        
        // Parse snippet for Experience
        const expMatch = (r.snippet || '').match(/Experience:\s*([^·]+)/);
        const snippetCompany = expMatch ? expMatch[1].trim() : '(none)';
        
        const eduMatch = (r.snippet || '').match(/Education:\s*([^·]+)/);
        const snippetSchool = eduMatch ? eduMatch[1].trim() : '(none)';

        console.log(`#${count} | Title role+co: ${titleRoleCompany}`);
        console.log(`     | Snippet company: ${snippetCompany} | Snippet school: ${snippetSchool}`);
        console.log(`     | URL: ${r.link}`);
        console.log();
      }
    }
    console.log(`Total: ${count} profiles`);
  }
}

main().catch(console.error);
