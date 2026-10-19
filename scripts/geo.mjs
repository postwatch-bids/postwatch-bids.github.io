// Southern California geography helpers (approximate; ZIP-prefix + city name based).
export const SOCAL_COUNTIES = ['Los Angeles', 'Orange', 'San Diego', 'Riverside', 'San Bernardino', 'Ventura', 'Santa Barbara', 'Imperial'];
const CITIES = {
  'Los Angeles': 'los angeles,long beach,pasadena,santa monica,burbank,glendale,torrance,inglewood,compton,carson,downey,el monte,pomona,west covina,norwalk,lancaster,palmdale,santa clarita,valencia,whittier,alhambra,hawthorne,gardena,culver city,beverly hills,el segundo,lakewood,bellflower,redondo beach,manhattan beach,hermosa beach,san pedro,wilmington,van nuys,north hollywood,sylmar,san fernando,monterey park,arcadia,montebello,cerritos,lynwood,south gate,huntington park,paramount,azusa,covina,diamond bar,la mirada,claremont,calabasas,malibu,marina del rey,playa vista,vernon,bell,bell gardens,rosemead,baldwin park,la puente,lomita,signal hill,walnut,san marino,san gabriel,temple city,monrovia,duarte,glendora,la verne,san dimas,agoura hills,westlake village,rancho palos verdes,palos verdes estates,lawndale,maywood,cudahy,commerce,pico rivera,santa fe springs,artesia,hawaiian gardens,industry,irwindale,sierra madre,south pasadena,la canada flintridge,west hollywood,hollywood,encino,woodland hills,northridge,chatsworth,san pedro,fort macarthur,los angeles afb',
  'Orange': 'anaheim,irvine,santa ana,huntington beach,garden grove,orange,fullerton,costa mesa,mission viejo,westminster,newport beach,buena park,lake forest,tustin,yorba linda,san clemente,laguna niguel,la habra,fountain valley,placentia,rancho santa margarita,aliso viejo,cypress,brea,stanton,san juan capistrano,dana point,laguna hills,seal beach,laguna beach,los alamitos,la palma,laguna woods,villa park,tustin',
  'San Diego': 'san diego,chula vista,oceanside,escondido,carlsbad,el cajon,vista,san marcos,encinitas,national city,la mesa,santee,poway,imperial beach,lemon grove,coronado,solana beach,del mar,camp pendleton,miramar,la jolla,point loma,otay mesa,ramona,fallbrook,alpine',
  'Riverside': 'riverside,moreno valley,corona,murrieta,temecula,menifee,jurupa valley,indio,hemet,perris,lake elsinore,eastvale,palm desert,cathedral city,palm springs,beaumont,san jacinto,coachella,banning,la quinta,desert hot springs,norco,wildomar,canyon lake,calimesa,rancho mirage,indian wells,blythe,march arb',
  'San Bernardino': 'san bernardino,fontana,rancho cucamonga,ontario,victorville,rialto,hesperia,chino,chino hills,upland,apple valley,redlands,highland,colton,yucaipa,montclair,adelanto,barstow,loma linda,grand terrace,big bear lake,twentynine palms,yucca valley,needles,fort irwin,joshua tree,china lake',
  'Ventura': 'ventura,oxnard,thousand oaks,simi valley,camarillo,moorpark,santa paula,port hueneme,fillmore,ojai,point mugu,newbury park',
  'Santa Barbara': 'santa barbara,santa maria,lompoc,goleta,carpinteria,buellton,solvang,guadalupe,vandenberg,vandenberg sfb,vandenberg afb',
  'Imperial': 'el centro,calexico,brawley,imperial,holtville,calipatria,westmorland,niland',
};
const CITY2COUNTY = new Map();
for (const [c, list] of Object.entries(CITIES)) for (const n of list.split(',')) if (!CITY2COUNTY.has(n)) CITY2COUNTY.set(n, c);
const CITY_RE = new RegExp('\\b(' + [...CITY2COUNTY.keys()].sort((a, b) => b.length - a.length).map(s => s.replace(/ /g, '\\s+')).join('|') + ')\\b', 'i');
const ZIP3 = z => { const p = +String(z || '').slice(0, 3); if (!p) return null;
  if (p >= 900 && p <= 918) return 'Los Angeles'; if (p >= 919 && p <= 921) return 'San Diego';
  if (p === 922) return /^9222|^9223|^9224|^9225|^9227/.test(z) ? 'Imperial' : 'Riverside';
  if (p === 923 || p === 924) return 'San Bernardino'; if (p === 925) return 'Riverside';
  if (p >= 926 && p <= 928) return 'Orange'; if (p === 930) return 'Ventura'; if (p === 931) return 'Santa Barbara';
  if (p === 934) return /^9343|^9344|^9345|^9346/.test(z) ? 'Santa Barbara' : null; return null; };
const COUNTY_RE = /\b(los angeles|orange|san diego|riverside|san bernardino|ventura|santa barbara|imperial) county\b|\bcounty of (los angeles|orange|san diego|riverside|san bernardino|ventura|santa barbara|imperial)\b/i;
const title = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
export function countyFor({ state, city, zip, text }) {
  if (state && state !== 'CA') return null;
  const c = String(city || '').toLowerCase().trim();
  if (CITY2COUNTY.has(c)) return CITY2COUNTY.get(c);
  const z = ZIP3(String(zip || '').trim()); if (z) return z;
  if (state === 'CA' || !state) {
    const m = String(text || '').match(COUNTY_RE); if (m) return title(m[1] || m[2]);
    const m2 = String(text || '').match(CITY_RE); if (m2) return CITY2COUNTY.get(m2[1].toLowerCase().replace(/\s+/g, ' '));
  }
  return null;
}
