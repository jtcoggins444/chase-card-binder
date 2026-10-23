// Chase Card Binder - daily pull from PokemonPriceTracker (needs the PPT_API_KEY secret).
// For every checklist card: 6 months of daily TCGplayer prices + sales volume by condition, eBay/Fanatics graded sales
// by grade, Cardmarket (EUR) prices, and TCGplayer listing/seller counts. ETBs: price history.
// Writes data/ppt/summary.json (small, loaded with the app) and data/ppt/s/<set>.json (loaded when a card is opened).
// Usage: node scripts/ppt.mjs [maxCards]
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const Dir = join(Root, 'data/ppt'), SDir = join(Dir, 's');
mkdirSync(SDir, { recursive: true });
const KEY = process.env.PPT_API_KEY;
if (!KEY) { console.log('No PPT_API_KEY secret; skipping.'); process.exit(0); }
const MAX = Number(process.argv[2] || 1e9);
const BASE = 'https://www.pokemonpricetracker.com/api/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(new Date().toISOString().slice(11, 19) + '  ' + m);
function write(p, text) { writeFileSync(p + '.tmp', text); renameSync(p + '.tmp', p); }
const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;

let minuteLeft = 60, minuteReset = 0, dailyLeft = 20000, used = 0;
async function get(path) {
  for (let t = 0; t < 4; t++) {
    if (minuteLeft <= 2 && Date.now() / 1000 < minuteReset) await sleep((minuteReset - Date.now() / 1000 + 1) * 1000);
    let r;
    try { r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + KEY }, signal: AbortSignal.timeout(60000) }); }
    catch (e) { await sleep(5000); continue; }
    minuteLeft = Number(r.headers.get('x-ratelimit-minute-remaining') ?? minuteLeft);
    minuteReset = Number(r.headers.get('x-ratelimit-minute-reset') ?? minuteReset);
    dailyLeft = Number(r.headers.get('x-ratelimit-daily-remaining') ?? dailyLeft);
    used += Number(r.headers.get('x-api-calls-consumed') || 0);
    if (r.status === 429) { await sleep(20000); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await sleep(1050);   // stay under 60 calls a minute
    return r.json();
  }
  throw new Error('gave up');
}

const cards = JSON.parse(readFileSync(join(Root, 'data/cards.json'), 'utf8'));
const S = cards.sets;
const day0 = '2026-01-01';   // day numbers count from here (fixed, so files from different days line up)
const dnum = iso => Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(day0)) / 864e5);

const sumPath = join(Dir, 'summary.json');
const prevSum = existsSync(sumPath) ? JSON.parse(readFileSync(sumPath, 'utf8')) : { c: {} };
const summary = { d: new Date().toISOString().slice(0, 10), b: day0, c: {} };
const bySet = new Map();
function setFile(sid) {
  if (!bySet.has(sid)) {
    const p = join(SDir, sid + '.json');
    const prev = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { c: {} };
    bySet.set(sid, { b: day0, c: {}, prev });
  }
  return bySet.get(sid);
}
// pick the printing that matches the checklist's price (Holofoil, else Unlimited Holofoil, else the main one)
function printingOf(d) {
  const v = Object.keys((d.priceHistory && d.priceHistory.variants) || d.variants || {});
  for (const p of ['Holofoil', 'Unlimited Holofoil', 'Normal']) if (v.includes(p)) return p;
  return (d.prices && d.prices.primaryPrinting) || v[0] || null;
}
const COND = { 'Near Mint': 'NM', 'Lightly Played': 'LP' };
function histOf(d, printing) {
  const src = (d.priceHistory && d.priceHistory.variants && d.priceHistory.variants[printing]) || (d.priceHistory && d.priceHistory.conditions) || {};
  const out = {};
  for (const [name, k] of Object.entries(COND)) {
    const h = src[name] && src[name].history; if (!h || !h.length) continue;
    out[k] = h.filter(x => x.market != null).map(x => [dnum(x.date), r2(x.market), x.volume || 0]);
  }
  return out;
}
const GRADES = ['psa10', 'psa9', 'psa8', 'cgc10', 'cgc9_5', 'cgc9', 'bgs10', 'bgs9_5', 'bgs9', 'tag10', 'sgc10'];
function gradedOf(e, printing) {
  if (!e) return null;
  const src = (e.salesByPrinting && printing && e.salesByPrinting[printing] && e.salesByPrinting[printing].salesByGrade) || e.salesByGrade || {};
  const g = {};
  for (const [k, v] of Object.entries(src)) {
    if (!v || !v.count) continue;
    // [smart price, confidence, median, sales count, 7-day price, 7-day daily volume, trend, last sale, eBay, Fanatics]
    g[k] = [r2(v.smartMarketPrice && v.smartMarketPrice.price), v.smartMarketPrice ? v.smartMarketPrice.confidence : null, r2(v.medianPrice), v.count,
      r2(v.marketPrice7Day), r2(v.dailyVolume7Day), v.marketTrend || null, v.lastSaleDate ? String(v.lastSaleDate).slice(0, 10) : null,
      (v.salesBySource && v.salesBySource.ebay) || 0, (v.salesBySource && v.salesBySource.fanatics) || 0];
  }
  // daily graded sale history for the main grades (last 6 months)
  const gh = {};
  const ph = (e.salesByPrinting && printing && e.salesByPrinting[printing] && e.salesByPrinting[printing].priceHistory) || e.priceHistory || {};
  for (const k of ['psa10', 'psa9', 'cgc10', 'bgs9_5']) {
    const h = ph[k]; if (!h) continue;
    const pts = Object.entries(h).map(([dt, v]) => [dnum(dt), r2(v.average), v.count || 0]).filter(p => p[0] >= 0 && p[1] != null).sort((a, b) => a[0] - b[0]);
    if (pts.length) gh[k] = pts;
  }
  return { g, gh, v: e.salesVelocity ? [r2(e.salesVelocity.dailyAverage), e.salesVelocity.monthlyTotal || 0] : null, n: e.totalSales || 0 };
}
function cardmarketOf(cm) {
  if (!cm) return null;
  return [r2(cm.marketEur), r2(cm.lowEur), r2(cm.trendEur), r2(cm.avg7Eur), r2(cm.avg30Eur)];
}

const list = cards.cards.filter(c => c[6]).slice(0, MAX);
let ok = 0, failed = 0;
log(`Fetching ${list.length} cards and ${(cards.etbs || []).length} ETBs.`);
for (const c of list) {
  if (dailyLeft < 600) { log('Daily credits nearly used up; stopping early.'); break; }
  const sf = setFile(c[2]);
  try {
    const j = await get(`/cards?tcgPlayerId=${c[6]}&includeHistory=true&days=180&includeEbay=true&includeCardmarket=true`);
    const d = Array.isArray(j.data) ? j.data[0] : j.data;
    if (!d) throw new Error('not found');
    const printing = printingOf(d);
    const h = histOf(d, printing), gr = gradedOf(d.ebay, printing), cm = cardmarketOf(d.cardmarketPrices);
    const pr = d.prices || {}, pv = (d.variants && printing && d.variants[printing]) || {};
    // [market, lowest listing] for this printing; listings/sellers are for the whole product
    const t = [r2(pv.marketPrice ?? pr.market), r2(pv.lowPrice ?? pr.low), pr.listings ?? null, pr.sellers ?? null];
    sf.c[c[0]] = { p: printing, h, g: gr && gr.g, gh: gr && gr.gh, cm, t };
    // summary: last 30 days of NM+LP sales volume, key graded prices, listings
    const vol = new Map();
    for (const k of ['NM', 'LP']) for (const [dn, , v] of (h[k] || [])) vol.set(dn, (vol.get(dn) || 0) + v);
    const lastDay = Math.max(-1, ...[...vol.keys()]);
    const v30 = []; for (let i = lastDay - 29; i <= lastDay; i++) v30.push(vol.get(i) || 0);
    const gg = (gr && gr.g) || {};
    const pick = k => gg[k] ? [gg[k][0] ?? gg[k][2], gg[k][3]] : null;
    summary.c[c[0]] = { v: lastDay >= 0 ? v30 : null, e: lastDay, p10: pick('psa10'), p9: pick('psa9'), c10: pick('cgc10'), t, cm: cm ? cm[2] ?? cm[0] : null, gs: gr ? gr.n : 0, ev: gr && gr.v ? gr.v[1] : 0 };
    ok++;
  } catch (e) {
    failed++;
    if (sf.prev.c[c[0]]) sf.c[c[0]] = sf.prev.c[c[0]];          // keep yesterday's data
    if (prevSum.c[c[0]]) summary.c[c[0]] = prevSum.c[c[0]];
    if (failed <= 15) log(`${c[0]} (${c[6]}): ${e.message}`);
  }
  if ((ok + failed) % 200 === 0) log(`  ${ok + failed} done, ${used} credits used, ${dailyLeft} left today`);
}
// ETBs: price history of the sealed box
for (const c of (cards.etbs || [])) {
  if (dailyLeft < 300) break;
  const sf = setFile(c[2]);
  try {
    const j = await get(`/sealed-products?tcgPlayerId=${c[6]}&limit=1&includeHistory=true&days=180`);
    const d = Array.isArray(j.data) ? j.data[0] : j.data;
    if (!d) throw new Error('not found');
    let pts = [];
    const ph = d.priceHistory;
    const arr = Array.isArray(ph) ? ph : ph && (ph.history || (ph.conditions && Object.values(ph.conditions)[0] && Object.values(ph.conditions)[0].history)) || [];
    pts = (arr || []).map(x => [dnum(x.date), r2(x.market ?? x.price ?? x.unopenedPrice), x.volume || 0]).filter(p => p[1] != null);
    sf.c[c[0]] = { h: pts.length ? { NM: pts } : {}, t: [r2(d.unopenedPrice), null, null, null] };
    summary.c[c[0]] = { v: null, t: [r2(d.unopenedPrice), null, null, null] };
  } catch (e) {
    if (sf.prev.c[c[0]]) sf.c[c[0]] = sf.prev.c[c[0]];
    if (prevSum.c[c[0]]) summary.c[c[0]] = prevSum.c[c[0]];
  }
}
if (ok < Math.min(200, list.length * 0.3)) { log(`Only ${ok} cards came back; keeping the previous files.`); process.exit(1); }
for (const [sid, sf] of bySet) {
  // cards we didn't reach this run keep their previous data
  for (const [id, v] of Object.entries(sf.prev.c || {})) if (!sf.c[id]) sf.c[id] = v;
  write(join(SDir, sid + '.json'), JSON.stringify({ b: day0, c: sf.c }));
}
for (const [id, v] of Object.entries(prevSum.c || {})) if (!summary.c[id]) summary.c[id] = v;
write(sumPath, JSON.stringify(summary));
log(`Done: ${ok} cards updated, ${failed} failed, ${used} credits used, ${dailyLeft} left today.`);
