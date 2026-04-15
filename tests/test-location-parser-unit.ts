const KNOWN_COUNTRIES = new Set(['united states','united kingdom','canada','australia','india','germany','france','brazil','mexico','japan','china','singapore','ireland','israel','netherlands','spain','italy','sweden','switzerland','south korea','united arab emirates','malaysia','south africa','new zealand','philippines','indonesia','thailand','vietnam','poland','belgium','austria','denmark','norway','finland','portugal','czech republic','romania','hungary','colombia','argentina','chile','peru','nigeria','kenya','egypt','pakistan','bangladesh','sri lanka','taiwan','hong kong','états-unis','usa']);
const US_STATES = new Set(['alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming','district of columbia','al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc']);

function isUSStateOrRegion(s: string): boolean {
  const lower = s.toLowerCase();
  if (US_STATES.has(lower)) return true;
  return US_STATES.has(lower.replace(/\s*(metropolitan\s+)?area$/i, '').trim());
}

function parse(text: string | null): { city: string | null; state: string | null; country: string | null } {
  if (!text) return { city: null, state: null, country: null };
  const parts = text.split(',').map(p => p.trim());
  if (parts.length >= 3) return { city: parts[0], state: parts[1], country: parts[2] };
  if (parts.length === 2) {
    if (isUSStateOrRegion(parts[1])) return { city: parts[0], state: parts[1], country: 'United States' };
    if (KNOWN_COUNTRIES.has(parts[1].toLowerCase())) return { city: parts[0], state: null, country: parts[1] };
    return { city: parts[0], state: parts[1], country: null };
  }
  if (KNOWN_COUNTRIES.has(parts[0].toLowerCase())) return { city: null, state: null, country: parts[0] };
  return { city: parts[0], state: null, country: null };
}

const testCases: Array<[string, string | null, string | null, string | null]> = [
  // [input, expectedCity, expectedState, expectedCountry]
  // 2-part US (previously broken)
  ['Austin, TX', 'Austin', 'TX', 'United States'],
  ['Dallas, Texas', 'Dallas', 'Texas', 'United States'],
  ['New York, NY', 'New York', 'NY', 'United States'],
  ['San Francisco, California', 'San Francisco', 'California', 'United States'],
  ['Austin, Texas Metropolitan Area', 'Austin', 'Texas Metropolitan Area', 'United States'],
  ['Portland, Oregon Metropolitan Area', 'Portland', 'Oregon Metropolitan Area', 'United States'],
  // 2-part international
  ['London, United Kingdom', 'London', null, 'United Kingdom'],
  ['Toronto, Canada', 'Toronto', null, 'Canada'],
  ['Mumbai, India', 'Mumbai', null, 'India'],
  ['Berlin, Germany', 'Berlin', null, 'Germany'],
  // 3-part (always worked)
  ['Chicago, Illinois, United States', 'Chicago', 'Illinois', 'United States'],
  ['Hyderabad, Telangana, India', 'Hyderabad', 'Telangana', 'India'],
  // 1-part
  ['United States', null, null, 'United States'],
  ['USA', null, null, 'USA'],
];

let passed = 0;
let failed = 0;

for (const [input, expCity, expState, expCountry] of testCases) {
  const r = parse(input);
  const ok = r.city === expCity && r.state === expState && r.country === expCountry;
  if (ok) {
    console.log(`✅ "${input}"`);
    passed++;
  } else {
    console.log(`❌ "${input}"`);
    console.log(`   Expected: city=${expCity}, state=${expState}, country=${expCountry}`);
    console.log(`   Got:      city=${r.city}, state=${r.state}, country=${r.country}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
