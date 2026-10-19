// PostWatch data updater: writes data/latest.json. No secrets required.
// Federal: SAM.gov public Contract Opportunities CSV extract (keyless, published for data.gov).
// Optional: if SAM_API_KEY is set, also query the official Opportunities API v2 (not required).
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';

const UA = 'PostWatch/0.1 (public-data aggregator)';
const CSV_URL = 'https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public';
const NAICS = '561612';
const KW = /\b(security guards?|armed guards?|unarmed guards?|guard services?|patrol services?|security officers? services?|security officer|protective services officers?)\b/i;
const EXCLUDE = /\b(coast guard|national guard|guardrail|guard rail|cyber|software|camera|cctv|alarm system|access control system)\b/i;
const SYSTEMS = /\b(alarms?|cctv|camera|video surveillance|access control system|intrusion detection|fire alarm|security systems?)\b/i;
const category = t => SYSTEMS.test(t) && !/\bguards?\b|patrol|officers?\b/i.test(t) ? 'systems' : 'guard';
const LA_CITIES = /\b(los angeles|long beach|pasadena|santa monica|burbank|glendale|torrance|inglewood|compton|carson|downey|el monte|pomona|west covina|norwalk|lancaster|palmdale|santa clarita|whittier|alhambra|hawthorne|gardena|culver city|beverly hills|el segundo|lakewood|bellflower|redondo beach|manhattan beach|san pedro|wilmington|van nuys|north hollywood|sylmar|san fernando|monterey park|arcadia|montebello|cerritos|lynwood|south gate|huntington park|paramount|azusa|covina|diamond bar|la mirada|claremont|calabasas|malibu|marina del rey|playa vista|vernon|bell gardens|rosemead|baldwin park|la puente|lomita|signal hill|port hueneme|los alamitos|seal beach|fort macarthur)\b/i;
const isLA = b => b.state === 'CA' && (LA_CITIES.test(b.city || '') || LA_CITIES.test(b.title || '') || b.source === 'LA County');
const sources = {};
const now = new Date();
const today = now.toISOString().slice(0, 10);

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
      state: clean(r.PopState), city: clean(r.PopCity) || (title.match(/,\s*([A-Z][a-z]+(?: [A-Z][a-z]+)*) Area\b/)?.[1] ?? '') + (clean(r.PopCity) || !/ Area\b/.test(title) ? '' : ' area'), // performance location only; never fall back to office city
      type, posted: isoDate(r.PostedDate), deadline, setAside: clean(r.SetASide) || 'None', naics,
      category: category(title), url: clean(r.Link) || `https://sam.gov/opp/${clean(r.NoticeId)}/view`,
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

const [fed, tx, lac, awards] = await Promise.all([safe('sam', fetchSamCsv), safe('texas', fetchTexasEsbd), safe('lacounty', fetchLACounty), safe('usaspending', fetchAwards)]);
Object.assign(sources, {
  caleprocure: { ok: false, skipped: true, note: 'Cal eProcure returns 403 to non-browser clients (WAF). Not bypassed.' },
  planetbids: { ok: false, skipped: true, note: 'PlanetBids API rejects direct access (DIRECT_ACCESS) and portals redirect to a JS app; not bypassed. Covers Long Beach, Pasadena, Santa Monica, Burbank, Glendale, Torrance, San Diego etc.' },
  rampla_labavn: { ok: false, skipped: true, note: 'RAMP LA is a Salesforce JS app with no public JSON; labavn.org connection fails.' },
  lametro: { ok: false, skipped: true, note: 'business.metro.net connection fails from scripts.' },
  lausd_polb: { ok: false, skipped: true, note: 'LAUSD and Port of Long Beach return 403 to scripts.' },
  others: { ok: false, skipped: true, note: 'Port of LA / LAWA pages have no machine-readable bid list; BidNet Direct terms disallow automated access.' },
});
sources.florida = { ok: false, skipped: true, note: 'Florida VBS search is form/JS-driven; skipped for MVP.' };

const bids = [...fed, ...tx, ...lac].map(b => ({ ...b, la: isLA(b) })).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
const byState = {}; for (const b of bids) { const s = b.state || '??'; byState[s] = (byState[s] || 0) + 1; }
const latest = { generatedAt: now.toISOString(), sources, counts: { total: bids.length, federal: fed.length, state: tx.length + lac.length, ca: bids.filter(b => b.state === 'CA').length, la: bids.filter(b => b.la).length, awards: awards.length }, byState, bids, awards };
// Keep previous data if every bid source failed.
const file = path.resolve('data/latest.json');
if (!bids.length && fs.existsSync(file)) { console.error('No bids fetched; keeping previous data'); process.exit(1); }
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(file, JSON.stringify(latest));
console.log(JSON.stringify({ counts: latest.counts, sources }, null, 1));
