// Chase Card Binder - live eBay listings priced under the raw Near Mint market (needs EBAY_CLIENT_ID / EBAY_CLIENT_SECRET).
// For every chase card worth $20+: Buy It Now listings of graded copies (grade read from the title) and ungraded copies,
// cheapest first, up to the raw Near Mint price. Writes data/live.json for the app.
// Usage: node scripts/ebay.mjs [maxCards]
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = process.env.EBAY_CLIENT_ID, SECRET = process.env.EBAY_CLIENT_SECRET;
if (!ID || !SECRET) { console.log('No eBay keys yet (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET); skipping.'); process.exit(0); }
const MAX = Number(process.argv[2] || 1e9), MIN_PRICE = 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(new Date().toISOString().slice(11, 19) + '  ' + m);
const r2 = v => Math.round(v * 100) / 100;

async function token() {
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(ID + ':' + SECRET).toString('base64') },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope')
  });
  if (!r.ok) throw new Error('eBay sign-in failed: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).access_token;
}

const cards = JSON.parse(readFileSync(join(Root, 'data/cards.json'), 'utf8'));
const S = cards.sets, latest = JSON.parse(readFileSync(join(Root, 'data/latest.json'), 'utf8'));
const raw = c => { const L = c[6] && latest[String(c[6])]; return L && L[3] ? L[3] : null; };
// what each grade has actually sold for (from the daily market data), to catch fakes and mislabeled slabs
const sumPath = join(Root, 'data/ppt/summary.json');
const GDS = existsSync(sumPath) ? JSON.parse(readFileSync(sumPath, 'utf8')).c : {};
const pool = cards.cards.filter(c => (raw(c) || 0) >= MIN_PRICE).sort((a, b) => raw(b) - raw(a)).slice(0, MAX);

// grade from the title: "PSA 9", "CGC 9.5", "BGS 8.5", "Beckett 9", "TAG 10", "SGC 9", "ACE 10"
const GR = /\b(PSA|CGC|BGS|BECKETT|TAG|SGC|ACE)\s*(?:GEM\s*MINT|GEM\s*MT|MINT|NM-?MT|PRISTINE)?\s*(10|[1-9](?:\.5)?)\b/i;
// accessories, fakes, other languages and damaged copies that mention the card
const JUNK = /\b(proxy|proxies|custom|digital|orica|fan ?(art|made)|replica|reprint card|lot of|bundle|you pick|choose|pick your|metal|jumbo|oversized?|sleeve|case|cases|display|stand|empty|code card|art card|sticker|coin|binder|keychain|key chain|skin|skins|credit card|extended art(work)?|gold foil|foil card|novelty|acrylic|magnet|pin|insert|label only|slab only|playmat|poster|print|decal|tin|figure|plush|not real|fake|inspired|homemade|handmade|engraved|3d|lenticular|holo card protector|graded 10 novelty)\b/i;
const LANG = /\b(japanese|japan|jp|jpn|chinese|chn|s-chinese|t-chinese|korean|kor|kr|thai|indonesian|italian|italiano|ita|french|fran[cç]ais|fr|carte|german|deutsch|de|spanish|espa[nñ]ol|portuguese|portugu[eê]s|brazilian|brasil|dutch|polish|russian)\b/i;
const DAMAGED = /\b(dmg|dm|damaged|damage|hp|heavily played|heavy play|mp|moderately played|poor|crease[ds]?|creasing|bent|water|torn|tear|scratched|ink|marked|altered|trimmed)\b/i;
function numTokens(c) {
  const n = String(c[3]), tot = S[c[2]] && S[c[2]][3];
  const t = [n.toUpperCase()];
  if (/^\d+$/.test(n)) { t.push(n.padStart(3, '0')); if (tot) t.push(n + '/' + tot, n.padStart(3, '0') + '/' + String(tot).padStart(3, '0')); }
  return t;
}
function matches(c, title) {
  const T = title.toUpperCase().replace(/\s+/g, ' ');
  if (JUNK.test(title) || LANG.test(title) || /\b(IT|ITA|FR|DE|ES|PT|JP|JPN|KR|CN|SC|TC)\b/.test(title)) return false;   // language codes in capitals
  if ((title.match(/\b[A-Z]{0,3}\d{1,3}\s*\/\s*[A-Z]{0,3}\d{2,3}\b/gi) || []).length > 1) return false;   // several card numbers: a lot
  const words = c[1].toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 3 && !['THE', 'AND'].includes(w));
  if (words.length && !words.every(w => T.includes(w))) return false;
  const nums = numTokens(c);
  return nums.some(x => new RegExp('(^|[^0-9A-Z])' + x.replace(/[/]/g, '\\/') + '($|[^0-9])').test(T));
}

let tok = await token(), calls = 0, found = 0;
const out = { t: new Date().toISOString(), c: {} };
const prevPath = join(Root, 'data/live.json');
for (const c of pool) {
  const R = raw(c), s = S[c[2]];
  const q = `${c[1]} ${c[3]}${s[3] && /^\d+$/.test(c[3]) ? '/' + s[3] : ''}`.replace(/[()]/g, ' ');
  const filter = `buyingOptions:{FIXED_PRICE},conditionIds:{2750|4000},price:[1..${Math.ceil(R)}],priceCurrency:USD,deliveryCountry:US,itemLocationCountry:US`;   // sellers located in the US only
  const url = 'https://api.ebay.com/buy/browse/v1/item_summary/search?' + new URLSearchParams({ q, category_ids: '183454', filter, sort: 'price', limit: '50' });
  let j = null;
  for (let t = 0; t < 3 && !j; t++) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
    calls++;
    if (r.status === 401) { tok = await token(); continue; }
    if (r.status === 429) { log('eBay daily search limit reached; stopping.'); break; }
    if (!r.ok) { await sleep(2000); continue; }
    j = await r.json();
  }
  if (!j) { if (calls > 4000) break; continue; }
  const rows = [];
  for (const it of j.itemSummaries || []) {
    if (!it.title || !matches(c, it.title)) continue;
    const price = Number(it.price && it.price.value), ship = Number((it.shippingOptions && it.shippingOptions[0] && it.shippingOptions[0].shippingCost && it.shippingOptions[0].shippingCost.value) || 0);
    if (!isFinite(price)) continue;
    const total = r2(price + (isFinite(ship) ? ship : 0));
    if (total > R) continue;
    const graded = String(it.conditionId) === '2750', m = it.title.match(GR);
    let grader = null, grade = null;
    if (graded) {
      if (!m) continue; grader = m[1].toUpperCase() === 'BECKETT' ? 'BGS' : m[1].toUpperCase(); grade = Number(m[2]); if (grade < 7) continue;
      const g = GDS[c[0]] && GDS[c[0]].gd && GDS[c[0]].gd[grader.toLowerCase() + String(grade).replace('.', '_')];
      if (g && g[1] >= 5 ? total < 0.6 * g[0] : total < 0.45 * R) continue;   // far below what this grade sells for: likely fake or mislabeled
    } else {
      if (m || DAMAGED.test(it.title)) continue;   // says graded in the title, or damaged/played
      if (total < 0.4 * R) continue;               // too cheap to be the real card in decent shape
    }
    const id = it.legacyItemId || (String(it.itemId).split('|')[1]) || it.itemId;
    // [total incl. shipping, grader or null, grade or null, eBay item number, title, seller feedback %, Best Offer]
    rows.push([total, grader, grade, String(id), it.title.slice(0, 90), it.seller ? Number(it.seller.feedbackPercentage) || null : null, (it.buyingOptions || []).includes('BEST_OFFER') ? 1 : 0]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  // keep the cheapest few graded (per grade band) and ungraded copies
  const keep = [], seen = {};
  for (const r of rows) { const k = r[1] ? r[1] + Math.floor(r[2]) : 'raw'; if ((seen[k] = (seen[k] || 0) + 1) <= 2 && keep.length < 8) keep.push(r); }
  if (keep.length) { out.c[c[0]] = keep; found++; }
  await sleep(120);
}
if (calls < 20 && existsSync(prevPath)) { log('Too few searches went through; keeping the previous file.'); process.exit(1); }
writeFileSync(prevPath + '.tmp', JSON.stringify(out)); renameSync(prevPath + '.tmp', prevPath);

// ---- deal alerts to Taylor's phone (ntfy) ----
await (async () => {
  const TOPIC = process.env.NTFY_TOPIC;
  if (!TOPIC) return log('No NTFY_TOPIC; alerts skipped.');
  // owned cards + alert settings, shared by the app (Firestore "alerts" documents)
  const conf = readFileSync(join(Root, 'firebase-config.js'), 'utf8');
  const key = (conf.match(/apiKey:\s*["']([^"']+)/) || [])[1], pid = (conf.match(/projectId:\s*["']([^"']+)/) || [])[1];
  let owned = new Set(), cfg = {};
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/alerts?key=${key}`);
    if (!r.ok) return log(`Alerts: can't read your owned cards yet (HTTP ${r.status}); update the Firebase rules. Skipping alerts.`);
    const j = await r.json();
    for (const d of j.documents || []) {
      const f = d.fields || {};
      for (const id of String((f.owned && f.owned.stringValue) || '').split(',')) if (id) owned.add(id);
      for (const [k, v] of Object.entries((f.cfg && f.cfg.mapValue && f.cfg.mapValue.fields) || {})) cfg[k] = Number(v.integerValue ?? v.doubleValue ?? v.stringValue);
    }
    if (!(j.documents || []).length) return log('Alerts: no shared settings yet (open the app once while signed in). Skipping alerts.');
  } catch (e) { return log('Alerts: ' + e.message); }
  if (cfg.alertOn === 0) return log('Alerts are turned off in the app.');
  const pct = (cfg.alertPct ?? 15) / 100, lowMin = cfg.lowMin ?? 150, lowPct = (cfg.lowPct ?? 35) / 100;
  const gradeOk = (g, r, R) => g >= 9 ? r <= 1 : g >= 8 ? r <= 0.85 : g >= 7 ? R >= lowMin && r <= 1 - lowPct : false;
  const seenPath = join(Root, 'data/alerts-seen.json'), first = !existsSync(seenPath);
  const seen = first ? {} : JSON.parse(readFileSync(seenPath, 'utf8'));
  const now = Date.now(), byId = Object.fromEntries(cards.cards.map(c => [c[0], c]));
  const deals = [];
  for (const [cid, rows] of Object.entries(out.c)) {
    if (owned.has(cid)) continue;
    const c = byId[cid], R = raw(c);
    for (const [total, grader, grade, id, title] of rows) {
      if (seen[id]) continue;
      const r = total / R;
      if (r > 1 - pct) continue;
      if (grader ? !gradeOk(grade, r, R) : r > 0.8) continue;
      deals.push({ c, R, total, grader, grade, id, title, r });
    }
  }
  // ungraded: only Near Mint or Lightly Played, per the seller's eBay condition
  const keep = [];
  for (const d of deals.sort((a, b) => (b.R - b.total) - (a.R - a.total))) {
    if (!d.grader) {
      if (keep.length >= 12) continue;
      try {
        const r = await fetch('https://api.ebay.com/buy/browse/v1/item/' + encodeURIComponent('v1|' + d.id + '|0'), { headers: { Authorization: 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
        if (!r.ok) continue;
        const it = await r.json();
        const cond = JSON.stringify(it.conditionDescriptors || []).toLowerCase();
        if (/near mint or better/.test(cond)) d.cond = 'Near Mint'; else if (/lightly played|excellent/.test(cond)) d.cond = 'Lightly Played'; else continue;
      } catch (e) { continue; }
    }
    keep.push(d);
  }
  for (const d of deals) seen[d.id] = new Date(now).toISOString().slice(0, 10);
  for (const [id, day] of Object.entries(seen)) if (now - Date.parse(day) > 21 * 864e5) delete seen[id];
  writeFileSync(seenPath, JSON.stringify(seen));
  const send = (title, body, click, prio) => fetch('https://ntfy.sh/' + TOPIC, { method: 'POST', headers: { Title: title, Click: click, Priority: prio || 'default', Tags: 'moneybag' }, body }).catch(() => {});
  const usd = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (first) { await send('Deal alerts are on', `Watching eBay for your unowned chase cards (${owned.size} owned skipped). ${keep.length} current deals noted; you'll get a ping for new ones.`, 'https://jtcoggins444.github.io/chase-card-binder/#movers'); return log(`Alerts: first run, ${keep.length} current deals recorded without pinging.`); }
  const top = keep.slice(0, 6);
  for (const d of top) {
    const set = S[d.c[2]][0], what = d.grader ? `${d.grader} ${d.grade}` : d.cond;
    await send(`${d.c[1]} · ${what} · ${Math.round((1 - d.r) * 100)}% under`, `${set} #${d.c[3]}: ${usd(d.total)} with shipping vs ${usd(d.R)} raw Near Mint. ${d.title}`, 'https://www.ebay.com/itm/' + d.id, d.r <= 0.7 ? 'high' : 'default');
  }
  if (keep.length > top.length) await send(`${keep.length - top.length} more eBay deals`, 'Open the app to see them on each card (Slab deals sort).', 'https://jtcoggins444.github.io/chase-card-binder/');
  log(`Alerts: ${keep.length} new deals, ${top.length} sent.`);
})();
log(`Searched ${pool.length} cards with ${calls} calls; ${found} cards have listings under raw Near Mint.`);
