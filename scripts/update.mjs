// PostWatch data updater: writes data/latest.json. No secrets required.
// Federal: SAM.gov public Contract Opportunities CSV extract (keyless, published for data.gov).
// Optional: if SAM_API_KEY is set, also query the official Opportunities API v2 (not required).
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { countyFor, SOCAL_COUNTIES } from './geo.mjs';

const UA = 'PostWatch/0.1 (public-data aggregator)';
const CSV_URL = 'https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public';
const NAICS = '561612';
const KW = /\b(security guards?|armed guards?|unarmed guards?|guard services?|patrol services?|security officers? services?|security officer|protective services officers?)\b/i;
const EXCLUDE = /\b(freeway service patrol|tow service|coast guard|national guard|guardrail|guard rail|cyber|software|camera|cctv|alarm system|access control system)\b/i;
const SYSTEMS = /\b(alarms?|cctv|camera|video surveillance|access control system|intrusion detection|fire alarm|security systems?)\b/i;
const category = t => SYSTEMS.test(t) && !/\bguards?\b|patrol|officers?\b/i.test(t) ? 'systems' : 'guard';
const LA_CITIES = /\b(los angeles|long beach|pasadena|santa monica|burbank|glendale|torrance|inglewood|compton|carson|downey|el monte|pomona|west covina|norwalk|lancaster|palmdale|santa clarita|whittier|alhambra|hawthorne|gardena|culver city|beverly hills|el segundo|lakewood|bellflower|redondo beach|manhattan beach|san pedro|wilmington|van nuys|north hollywood|sylmar|san fernando|monterey park|arcadia|montebello|cerritos|lynwood|south gate|huntington park|paramount|azusa|covina|diamond bar|la mirada|claremont|calabasas|malibu|marina del rey|playa vista|vernon|bell gardens|rosemead|baldwin park|la puente|lomita|signal hill|port hueneme|los alamitos|seal beach|fort macarthur)\b/i;
const isLA = b => b.county === 'Los Angeles';
const isGuardText = t => (KW.test(t) || /\b(guards?|patrol)\b|security (officer|services|personnel)/i.test(t)) && !EXCLUDE.test(t);
const ARMED = /\b(armed (security|guards?|officers?|protective|personnel|services)|armed\b(?!\s*forces)|firearms?|weapons? qualif|guard card with exposed firearm|bsis firearm)/i;
const UNARMED = /\bun-?armed\b|\bnon-?armed\b/i;
const EXPERIENCE = /\b(\d+|one|two|three|four|five|six|seven|eight|ten)\s*(\(\d+\)\s*)?(\+\s*)?years?\b[^.]{0,80}\b(experience|in business|performing|providing|past performance)|\bminimum (of )?(\d+|one|two|three|four|five)\b[^.]{0,40}\byears?|minimum qualifications?[^.]{0,120}\byears?\b/i;
function classify(b) {
  const t = b.title || '', d = b._desc || '';
  const armedT = ARMED.test(t.replace(/unarmed/ig, '')), unarmedT = UNARMED.test(t);
  const armedD = ARMED.test(d.replace(/un-?armed/ig, '')), unarmedD = UNARMED.test(d);
  let arms = 'Unspecified';
  if (unarmedT && !armedT) arms = 'Unarmed'; else if (armedT && !unarmedT) arms = 'Armed';
  else if (armedT && unarmedT) arms = 'Armed';
  else if (unarmedD && !armedD) arms = 'Unarmed'; else if (armedD && !unarmedD) arms = 'Armed'; else if (armedD) arms = 'Armed';
  const patrol = /\bpatrol/i.test(t + ' ' + d.slice(0, 2000));
  const aviation = /\b(airport|aviation|airfield|faa|tsa)\b/i.test(t + ' ' + (b.agency || '') + ' ' + (b.subAgency || ''));
  const hasDesc = d.length > 200, exp = EXPERIENCE.test(d);
  let fit;
  if (aviation || arms === 'Armed' || exp || b.category === 'systems') fit = 'No';
  else if ((arms === 'Unarmed' || patrol) && hasDesc) fit = 'Yes';
  else fit = 'Check'; // unspecified arms, or no description text to check experience minimums
  return { arms, fit, fitWhy: [aviation && 'aviation', arms === 'Armed' && 'armed', exp && 'experience minimum', !hasDesc && 'no description text', arms === 'Unspecified' && !patrol && 'armed/unarmed not stated'].filter(Boolean).join(', ') };
}
const sources = {};
const now = new Date();
const today = now.toISOString().slice(0, 10);
const laToday = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

const clean = s => (s ?? '').toString().replace(/\s+/g, ' ').trim();
function isoDate(s) { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d.toISOString(); }

async function fetchSamCsv() {
  const res = await fetch(CSV_URL, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error('SAM CSV HTTP ' + res.status);
  const parser = Readable.fromWeb(res.body).pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true, bom: true }));
  const out = []; let rows = 0;
  for await (const r of parser) {
    rows++;
    if (r.Active !== 'Yes') continue;
    const naics = clean(r.NaicsCode);
    const title = clean(r.Title);
    const desc = (r.Description || '').slice(0, 3000);
    const psc = clean(r.ClassificationCode);
    const hit = naics === NAICS || psc === 'S206' || (KW.test(title) && !EXCLUDE.test(title)) || (KW.test(desc.slice(0, 600)) && /^5616/.test(naics));
    if (!hit) continue;
    const type = clean(r.Type);
    if (/award notice|justification/i.test(type)) continue; // not biddable
    const deadline = isoDate(r.ResponseDeadLine);
    if (deadline && deadline < now.toISOString()) continue;
    if (!deadline && (now - new Date(r.PostedDate)) > 180 * 864e5) continue; // stale undated notices
    out.push({
      id: clean(r.NoticeId), src: 'federal', source: 'SAM.gov', title,
      solicitation: clean(r['Sol#']), agency: clean(r['Department/Ind.Agency']), subAgency: clean(r['Sub-Tier']), office: clean(r.Office),
      zip: clean(r.PopZip), state: clean(r.PopState), city: clean(r.PopCity) || (title.match(/,\s*([A-Z][a-z]+(?: [A-Z][a-z]+)*) Area\b/)?.[1] ?? '') + (clean(r.PopCity) || !/ Area\b/.test(title) ? '' : ' area'), // performance location only; never fall back to office city
      type, posted: isoDate(r.PostedDate), deadline, setAside: clean(r.SetASide) || 'None', naics,
      _desc: (r.Description || '').slice(0, 20000), category: category(title), url: clean(r.Link) || `https://sam.gov/opp/${clean(r.NoticeId)}/view`,
    });
  }
  sources.sam = { ok: true, method: 'public CSV extract (keyless)', rowsScanned: rows, matched: out.length };
  return out;
}

async function fetchTexasEsbd() {
  const url = 'https://www.txsmartbuy.gov/app/extensions/CPA/CPAMain/1.0.0/services/ESBD.Service.ss?c=852252&n=2';
  const out = [];
  for (const keyword of ['security guard', 'security services', 'patrol services']) {
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ lines: 50, page, keyword, status: '1', dateRange: 'all' }) });
      if (!res.ok) throw new Error('ESBD HTTP ' + res.status);
      const j = await res.json(); const lines = j.lines || [];
      for (const l of lines) {
        const t = clean(l.title);
        if (!(KW.test(t) || /guard|patrol|security/i.test(t)) || EXCLUDE.test(t)) continue;
        const deadline = isoDate(`${l.responseDue} ${l.responseTime || ''}`.trim()) || isoDate(l.responseDue);
        if (deadline && deadline < now.toISOString()) continue;
        out.push({ id: 'tx-' + l.internalid, src: 'state', source: 'Texas ESBD', title: t, solicitation: clean(l.solicitationId),
          agency: clean(l.agencyName).replace(/ - [A-Z0-9]+$/, ''), state: 'TX', city: '', type: 'Solicitation', posted: isoDate(l.postingDate), deadline,
          setAside: 'See notice', naics: '', category: category(t), url: `https://www.txsmartbuy.gov/esbd/${encodeURIComponent(l.solicitationId)}` });
      }
      if (lines.length < 50) break;
    }
  }
  const uniq = [...new Map(out.map(o => [o.id, o])).values()];
  sources.texas = { ok: true, method: 'public ESBD search JSON', matched: uniq.length };
  return uniq;
}

async function fetchLACounty() {
  // LA County public Open Bid List (no login). Server-rendered HTML; one page with PageSize=1000.
  const base = 'https://camisvr.co.la.ca.us/LACoBids/BidLookUp/OpenBidList';
  const res = await fetch(base + '?page=1&TextSearch=%7C%7C%7C&FieldSort=BidTitle&DirectionSort=Asc&PageSize=1000', { headers: { 'User-Agent': 'Mozilla/5.0 ' + UA } });
  if (!res.ok) throw new Error('LA County HTTP ' + res.status);
  const html = await res.text();
  const strip = x => clean(x.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'));
  const rows = html.split(/<tr[\s>]/).slice(1).filter(r => r.includes("selectBid('"));
  if (!rows.length) throw new Error('LA County: no rows parsed (layout changed?)');
  const out = [];
  for (const r of rows) {
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    const num = strip(tds[0] || '');
    const title = strip((tds[1] || '').match(/id="LabelTitle\d+"[^>]*>([\s\S]*?)<\/label>/)?.[1] || '');
    const comm = strip((tds[1] || '').match(/id="LabelComm\d+"[^>]*>([\s\S]*?)<\/label>/)?.[1] || '').replace(/^Commodity:\s*/, '');
    const text = title + ' ' + comm;
    if (!(KW.test(text) || /\b(guard|patrol)\b|security (officer|services)/i.test(text)) || EXCLUDE.test(text) || /consulting services - security/i.test(comm) && !KW.test(title)) continue;
    const deadline = isoDate(strip(tds[4] || '').replace(/(\d+\/\d+\/\d+ \d+:\d+ [AP]M)/, '$1 PST')) || null;
    if (deadline && deadline < now.toISOString()) continue;
    out.push({ id: 'lac-' + num, src: 'local', source: 'LA County', title, solicitation: num, agency: 'County of Los Angeles', subAgency: strip(tds[3] || ''),
      state: 'CA', city: 'Los Angeles County', type: strip(tds[2] || 'Solicitation'), posted: null, deadline, setAside: 'See notice', naics: '', category: category(text),
      url: base + '?TextSearch=' + encodeURIComponent(num) });
  }
  sources.lacounty = { ok: true, method: 'public Open Bid List HTML', rowsScanned: rows.length, matched: out.length };
  return out;
}

function normManual(m, id) {
  const title = clean(m.title), state = clean(m.state).toUpperCase().slice(0, 2);
  if (!title || !state || !/^https?:\/\//.test(m.url || '')) return null;
  const dl = /^\d{4}-\d{2}-\d{2}$/.test(clean(m.deadline)) ? m.deadline + 'T23:59:00-08:00' : m.deadline;
  const deadline = isoDate(dl);
  if (!deadline || deadline < now.toISOString()) return null; // auto-hide past deadline
  return { id, src: 'community', source: 'Community submitted', title, solicitation: clean(m.solicitation), agency: clean(m.agency), subAgency: '',
    state, city: clean(m.city), type: clean(m.type) || 'Solicitation', posted: isoDate(m.posted) || null, deadline, setAside: clean(m.setAside) || 'See notice',
    naics: '', category: category(title), url: m.url };
}

async function fetchManual() {
  const out = [];
  const j = JSON.parse(fs.readFileSync('data/manual-bids.json', 'utf8'));
  (j.bids || []).forEach((m, i) => { const b = normManual(m, 'man-' + i); if (b) out.push(b); });
  // Issues labeled 'approved' (from the "Submit a bid" issue form) are also merged. Needs GITHUB_TOKEN + GITHUB_REPOSITORY (set in Actions).
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN;
  let issues = 0;
  if (repo && token) {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?labels=approved&state=all&per_page=100`, { headers: { Authorization: 'Bearer ' + token, 'User-Agent': UA, Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('GitHub issues HTTP ' + res.status);
    for (const is of await res.json()) {
      if (is.pull_request) continue;
      const f = {}; for (const m of (is.body || '').matchAll(/### ([^\n]+)\n+([\s\S]*?)(?=\n### |$)/g)) f[m[1].trim().toLowerCase()] = m[2].trim().replace(/^_No response_$/, '');
      const b = normManual({ title: f['bid title'], agency: f['agency / city'], city: f['city of performance'], state: f['state (2 letters)'], deadline: f['response deadline (yyyy-mm-dd)'], url: f['link to the official notice'], posted: is.created_at }, 'gh-' + is.number);
      if (b) { out.push(b); issues++; }
    }
  }
  sources.community = { ok: true, method: 'data/manual-bids.json + approved GitHub issues', matched: out.length, fromIssues: issues };
  return out;
}

async function fetchRampLA() {
  // City of Los Angeles RAMP open bids, published as an official open dataset (data.lacity.org, Socrata).
  const res = await fetch('https://data.lacity.org/resource/hf3r-utnq.json?$limit=5000', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('RAMP LA HTTP ' + res.status);
  const rows = await res.json(); const out = [];
  for (const r of rows) {
    const t = clean(r.title);
    if (!isGuardText(t)) continue;
    const deadline = isoDate(r.closedate ? r.closedate.replace(/\.000$/, 'Z') : null);
    if (deadline && deadline < now.toISOString()) continue;
    out.push({ id: 'ramp-' + r.rampid, src: 'local', source: 'City of LA (RAMP)', title: t, solicitation: clean(r.rampid), agency: 'City of Los Angeles', subAgency: clean(r.department),
      state: 'CA', city: 'Los Angeles', county: 'Los Angeles', type: clean(r.type) || 'Solicitation', posted: isoDate(r.bidpost ? r.bidpost.replace(/\.000$/, 'Z') : null), deadline,
      setAside: 'See notice', naics: '', category: category(t), url: r.url?.url || 'https://www.rampla.org/s/opportunities' });
  }
  sources.rampla = { ok: true, method: 'data.lacity.org open dataset hf3r-utnq', rowsScanned: rows.length, matched: out.length };
  return out;
}

async function fetchOpenGov() {
  // OpenGov Procurement public portal data (same anonymous JSON the public portals load). SoCal CA governments only.
  const H = { 'User-Agent': UA, 'content-type': 'application/json' };
  const res = await fetch('https://api.procurement.opengov.com/api/v1/government', { headers: H });
  if (!res.ok) throw new Error('OpenGov list HTTP ' + res.status);
  const govs = (await res.json()).filter(g => g.state === 'CA' && g.government?.code && !/opengov/i.test(g.city || ''))
    .map(g => ({ code: g.government.code, name: clean(g.name), city: clean(g.city), county: countyFor({ state: 'CA', city: g.city, zip: g.zipCode, text: g.name }) }))
    .filter(g => g.county);
  const out = []; let scanned = 0, errors = 0;
  const one = async g => {
    try {
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(`https://api.procurement.opengov.com/api/v1/government/${g.code}/project/public`, { method: 'POST', headers: H, body: JSON.stringify({ limit: 100, offset: (page - 1) * 100, page }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const rows = (await r.json()).rows || []; scanned += rows.length;
        const open = rows.filter(p => p.status === 'open');
        for (const p of open) {
          const t = clean(p.title);
          if (!isGuardText(t)) continue;
          const deadline = isoDate(p.proposalDeadline); const _desc = clean(String(p.summary || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
          if (deadline && deadline < now.toISOString()) continue;
          out.push({ id: `og-${g.code}-${p.id}`, src: 'local', source: 'OpenGov: ' + g.name, title: t, solicitation: clean(p.financialId), agency: g.name, subAgency: clean(p.department?.name),
            state: 'CA', city: g.city, county: g.county, type: clean(p.template?.title) || 'Solicitation', posted: isoDate(p.releaseProjectDate), deadline,
            _desc, setAside: 'See notice', naics: '', category: category(t), url: `https://procurement.opengov.com/portal/${g.code}/projects/${p.id}` });
        }
        if (rows.length < 100 || open.length < rows.length) break; // open projects are listed first
      }
    } catch (e) { errors++; }
  };
  for (let i = 0; i < govs.length; i += 6) await Promise.all(govs.slice(i, i + 6).map(one));
  sources.opengov = { ok: true, method: 'OpenGov public portal JSON (SoCal CA governments)', portals: govs.length, portalErrors: errors, rowsScanned: scanned, matched: out.length };
  return out;
}

async function fetchAwards() {
  const end = today; const start = new Date(now - 180 * 864e5).toISOString().slice(0, 10);
  const body = { filters: { naics_codes: { require: [NAICS] }, award_type_codes: ['A', 'B', 'C', 'D'], time_period: [{ start_date: start, end_date: end }] },
    fields: ['Award ID', 'Recipient Name', 'Awarding Agency', 'Awarding Sub Agency', 'Award Amount', 'Start Date', 'End Date', 'Place of Performance State Code', 'Place of Performance City Code', 'generated_internal_id', 'Description'],
    sort: 'Start Date', order: 'desc', limit: 100, page: 1 };
  const out = [];
  for (let page = 1; page <= 3; page++) {
    body.page = page;
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', { method: 'POST', headers: { 'content-type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('USAspending HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const j = await res.json();
    for (const r of j.results || []) out.push({ awardId: r['Award ID'], recipient: r['Recipient Name'], agency: r['Awarding Agency'], subAgency: r['Awarding Sub Agency'],
      amount: r['Award Amount'], start: r['Start Date'], end: r['End Date'], state: r['Place of Performance State Code'], description: clean(r.Description).slice(0, 200),
      url: `https://www.usaspending.gov/award/${r.generated_internal_id}` });
    if (!j.page_metadata?.hasNext) break;
  }
  sources.usaspending = { ok: true, method: 'USAspending API v2 (keyless)', window: `${start}..${end}`, count: out.length };
  return out;
}

async function safe(name, fn) { try { return await fn(); } catch (e) { console.error(name, 'FAILED:', e.message); sources[name] = { ok: false, error: e.message }; return []; } }

const [fed, tx, lac, man, ramp, og, awards] = await Promise.all([safe('sam', fetchSamCsv), safe('texas', fetchTexasEsbd), safe('lacounty', fetchLACounty), safe('community', fetchManual), safe('rampla', fetchRampLA), safe('opengov', fetchOpenGov), safe('usaspending', fetchAwards)]);
Object.assign(sources, {
  caleprocure: { ok: false, skipped: true, note: 'Cal eProcure returns 403 to non-browser clients (WAF). Not bypassed.' },
  planetbids: { ok: false, skipped: true, note: 'PlanetBids API rejects direct access (DIRECT_ACCESS) and portals redirect to a JS app; not bypassed. Covers Long Beach, Pasadena, Santa Monica, Burbank, Glendale, Torrance, San Diego etc.' },
  labavn: { ok: false, skipped: true, note: 'labavn.org connection fails from scripts (RAMP LA now covered via data.lacity.org).' },
  bonfire: { ok: false, skipped: true, note: 'Bonfire portals (e.g. sbcounty.bonfirehub.com) robots.txt disallows all crawling.' },
  publicpurchase_periscope: { ok: false, skipped: true, note: 'PublicPurchase and Periscope/BidSync bid details require vendor login.' },
  sandiego_forecast: { ok: false, skipped: true, note: 'San Diego County Socrata dataset is a procurement forecast, not open bids.' },
  transit_ports_uc: { ok: false, skipped: true, note: 'MTS/SANDAG, NCTD, Metrolink, RTA, Omnitrans, Port of San Diego, SAN, JWA, UC campuses: not found on OpenGov (OCTA and ONT are, and are covered); mostly PlanetBids/Bonfire/BidNet/own JS portals with no public feed. Covered only if federal (SAM) or later community submissions.' },
  lametro: { ok: false, skipped: true, note: 'business.metro.net connection fails from scripts.' },
  lausd_polb: { ok: false, skipped: true, note: 'LAUSD and Port of Long Beach return 403 to scripts.' },
  others: { ok: false, skipped: true, note: 'Port of LA / LAWA pages have no machine-readable bid list; BidNet Direct terms disallow automated access.' },
});
sources.florida = { ok: false, skipped: true, note: 'Florida VBS search is form/JS-driven; skipped for MVP.' };

const bids = [...fed, ...tx, ...lac, ...man, ...ramp, ...og].map(b => { const county = b.county || countyFor({ state: b.state, city: b.city, zip: b.zip, text: b.title + ' ' + (b.office || '') }); delete b.zip; const c = classify(b); delete b._desc; return { ...b, ...c, county, socal: SOCAL_COUNTIES.includes(county), la: county === 'Los Angeles' }; }).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
const byState = {}; for (const b of bids) { const s = b.state || '??'; byState[s] = (byState[s] || 0) + 1; }
const latest = { generatedAt: now.toISOString(), sources, counts: { total: bids.length, federal: fed.length, state: tx.length + lac.length + ramp.length + og.length, community: man.length, ca: bids.filter(b => b.state === 'CA').length, socal: bids.filter(b => b.socal).length, smallFit: bids.filter(b => b.fit === 'Yes').length, la: bids.filter(b => b.la).length, awards: awards.length }, byState, bids, awards };
// Owner tracking file: SoCal small-firm-fit bids with first_seen (not part of the public site build).
{
  const f = 'data/socal-fit.json';
  const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { bids: [] };
  const seen = new Map((prev.bids || []).map(b => [b.id, b.first_seen]));
  const list = bids.filter(b => b.socal && b.fit !== 'No').map(b => ({ id: b.id, fit: b.fit, arms: b.arms, title: b.title, agency: b.agency, county: b.county, city: b.city,
    deadline: b.deadline, url: b.url, source: b.source, first_seen: seen.get(b.id) || laToday }));
  if (bids.length) fs.writeFileSync(f, JSON.stringify({ updated: now.toISOString(), note: "fit: Yes = unarmed/patrol, not aviation, no experience-minimum text found; Check = could not confirm", new_today: list.filter(b => b.first_seen === laToday).map(b => b.id), bids: list }, null, 1));
}
// Keep previous data if every bid source failed.
const file = path.resolve('data/latest.json');
if (!bids.length && fs.existsSync(file)) { console.error('No bids fetched; keeping previous data'); process.exit(1); }
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(file, JSON.stringify(latest));
console.log(JSON.stringify({ counts: latest.counts, sources }, null, 1));
