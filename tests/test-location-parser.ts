import { searchLinkedInShort } from '@/lib/services/linkedin-search';

async function main() {
  console.log('Running Apify Short Mode search...');
  const result = await searchLinkedInShort({
    searchQuery: 'software engineer',
    currentJobTitles: ['Software Engineer'],
    maxItems: 10,
  });

  console.log('\nGot', result.profiles.length, 'profiles\n');
  console.log('Location parsing results:');
  console.log('─'.repeat(90));
  for (const p of result.profiles) {
    console.log(
      p.fullName.padEnd(25),
      '| raw:', (p.location || '(none)').padEnd(40),
      '| city:', (p.city || '-').padEnd(15),
      '| state:', (p.state || '-').padEnd(20),
      '| country:', (p.country || '-')
    );
  }

  const US_STATES = new Set([
    'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
    'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
    'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
    'minnesota','mississippi','missouri','montana','nebraska','nevada',
    'new hampshire','new jersey','new mexico','new york','north carolina',
    'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
    'south carolina','south dakota','tennessee','texas','utah','vermont',
    'virginia','washington','west virginia','wisconsin','wyoming',
    'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in',
    'ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv',
    'nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn',
    'tx','ut','vt','va','wa','wv','wi','wy','dc',
  ]);

  const badCountry = result.profiles.filter(p => {
    if (!p.country) return false;
    const lower = p.country.toLowerCase();
    const stripped = lower.replace(/\s*(metropolitan\s+)?area$/i, '').trim();
    return US_STATES.has(lower) || US_STATES.has(stripped);
  });

  console.log('\n' + '─'.repeat(90));
  if (badCountry.length === 0) {
    console.log('✅ All country values are valid (no US states leaking through)');
  } else {
    console.log('❌ Bad country values found:');
    for (const p of badCountry) {
      console.log('  ', p.fullName, '→ country:', p.country);
    }
  }

  // Check that 2-part US locations got country = "United States"
  const twoPartUS = result.profiles.filter(p => {
    if (!p.location) return false;
    const parts = p.location.split(',').map((s: string) => s.trim());
    return parts.length === 2 && p.country === 'United States';
  });
  if (twoPartUS.length > 0) {
    console.log(`✅ ${twoPartUS.length} two-part US locations correctly inferred country = "United States"`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
