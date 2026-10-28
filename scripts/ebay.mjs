// Chase Card Binder - live eBay listings priced under the raw Near Mint market (needs EBAY_CLIENT_ID / EBAY_CLIENT_SECRET).
// For every chase card in the price range set in the app (default $10-$80 raw): Buy It Now listings of graded copies (grade read from the title) and ungraded copies,
// cheapest first, up to the raw Near Mint price. Writes data/live.json for the app.
// Usage: node scripts/ebay.mjs [maxCards]
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = process.env.EBAY_CLIENT_ID, SECRET = process.env.EBAY_CLIENT_SECRET;
if (!ID || !SECRET) { console.log('No eBay keys yet (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET); skipping.'); process.exit(0); }
const MAX = Number(process.argv[2] || 1e9);
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

// grade from the title: "PSA 9", "CGC 9.5", "BGS 8.5", "Beckett 9", "TAG 10", "SGC 9", "ACE 10"
const GR = /\b(PSA|CGC|BGS|BECKETT|TAG|SGC|ACE)\s*(?:GEM\s*MINT|GEM\s*MT|MINT|NM-?MT|PRISTINE)?\s*(10|[1-9](?:\.5)?)\b/i;
// accessories, fakes, other languages and damaged copies that mention the card
const JUNK = /\b(proxy|proxies|custom|digital|orica|fan ?(art|made)|replica|reprint card|lot of|bundle|you pick|choose|pick your|metal|jumbo|oversized?|sleeve|case|cases|display|stand|empty|code card|art card|sticker|coin|binder|keychain|key chain|skin|skins|credit card|extended\s+art(work)?|gold foil|foil card|novelty|acrylic|magnet|pin|insert|label only|slab only|playmat|poster|print|decal|tin|figure|plush|not real|fake|inspired|homemade|handmade|engraved|3d|lenticular|holo card protector|graded 10 novelty)\b/i;
const LANG = /\b(japanese|japan|jp|jpn|chinese|chn|s-chinese|t-chinese|korean|kor|kr|thai|indonesian|italian|italiano|ita|french|fran[cç]ais|fr|carte|german|deutsch|de|spanish|espa[nñ]ol|portuguese|portugu[eê]s|brazilian|brasil|dutch|polish|russian)\b/i;
// Japanese/Chinese copies often skip the language in the title but give themselves away with Japanese set codes,
// set names, rarity codes or characters. AR/SAR/CHR/CSR are Japanese rarity codes unless the title says English.
const ASIAN = /(\b(sv|s|sm|m)\d{1,2}[a-z]\b|pok[eé]mon card 151|\bart rare\b|shiny treasure|vstar universe|terastal festival|battle partners|heat wave arena|hot air arena|night wanderer|stellar miracle|paradise dragona|super electric breaker|cyber judge|wild force|crimson haze|clay burst|snow hazard|raging surf|ruler of the black flame|ancient roar|future flash|triplet beat|scarlet ex|violet ex|mega brave|mega symphonia|inferno x|mega dream|[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af])/i;
const ASIAN_CODES = /\b(AR|SAR|CHR|CSR)\b/;
const DAMAGED = /\b(dmg|dm|damaged|damage|hp|heavily played|heavy play|mp|moderately played|poor|crease[ds]?|creasing|bent|water|torn|tear|scratched|ink|marked|altered|trimmed)\b/i;
function numTokens(c) {
  const n = String(c[3]), tot = S[c[2]] && S[c[2]][3];
  const t = [n.toUpperCase()];
  if (/^\d+$/.test(n)) { t.push(n.padStart(3, '0')); if (tot) t.push(n + '/' + tot, n.padStart(3, '0') + '/' + String(tot).padStart(3, '0')); }
  return t;
}
function matches(c, title) {
  const T = title.toUpperCase().replace(/\s+/g, ' ');
  if (ASIAN.test(title) || (ASIAN_CODES.test(title) && !/\b(english|eng|en)\b/i.test(title))) return false;
  if (JUNK.test(title) || LANG.test(title) || /\b(IT|ITA|FR|DE|ES|PT|JP|JPN|KR|CN|SC|TC)\b/.test(title)) return false;   // language codes in capitals
  if ((title.match(/\b[A-Z]{0,3}\d{1,3}\s*\/\s*[A-Z]{0,3}\d{2,3}\b/gi) || []).length > 1) return false;   // several card numbers: a lot
  const words = c[1].toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 3 && !['THE', 'AND'].includes(w));
  if (words.length && !words.every(w => T.includes(w))) return false;
  const nums = numTokens(c);
  return nums.some(x => new RegExp('(^|[^0-9A-Z])' + x.replace(/[/]/g, '\\/') + '($|[^0-9])').test(T));
}

// owned cards, alert settings and fakes Taylor reported, shared by the app (Firestore "alerts" documents)
const conf = readFileSync(join(Root, 'firebase-config.js'), 'utf8');
const fbKey = (conf.match(/apiKey:\s*["']([^"']+)/) || [])[1], fbPid = (conf.match(/projectId:\s*["']([^"']+)/) || [])[1];
let owned = new Set(), cfg = {}, alertDocs = null;
const bad = new Set();   // "s:seller" or "i:itemId" marked as fake in the app
try {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${fbPid}/databases/(default)/documents/alerts?key=${fbKey}`);
  if (r.ok) {
    const j = await r.json(); alertDocs = j.documents || [];
    for (const d of alertDocs) {
      const f = d.fields || {};
      for (const id of String((f.owned && f.owned.stringValue) || '').split(',')) if (id) owned.add(id);
      for (const [k, v] of Object.entries((f.cfg && f.cfg.mapValue && f.cfg.mapValue.fields) || {})) {
        if (k === 'bad') { for (const x of String(v.stringValue || '').split(',')) if (x) bad.add(x.toLowerCase()); }
        else cfg[k] = Number(v.integerValue ?? v.doubleValue ?? v.stringValue);
      }
    }
  } else log(`Alerts: can't read the shared settings (HTTP ${r.status}).`);
} catch (e) { log('Alerts: ' + e.message); }
log(`${bad.size} reported fakes/blocked sellers.`);
// which cards to watch: raw Near Mint between liveMin and liveMax (set in the app; default $10 to $80)
const LO = Math.max(1, cfg.liveMin ?? 10), HI = Math.max(LO, cfg.liveMax ?? 80);
const pool = cards.cards.filter(c => (raw(c) || 0) >= LO && raw(c) <= HI).sort((a, b) => raw(b) - raw(a)).slice(0, Math.min(MAX, 1000));   // 1,000 cards a check keeps four checks a day inside eBay's daily limit
log(`Watching ${pool.length} cards worth $${LO} to $${HI} raw.`);

// fake check on the cheap listings: one closer look per listing, remembered between runs
const chkPath = join(Root, 'data/live-checked.json');
const checked = existsSync(chkPath) ? JSON.parse(readFileSync(chkPath, 'utf8')) : {};
const FAKE_DESC = /\b(proxy|proxies|replica|reproduction|repro|custom made|fan ?made|unofficial|not official|not original|non[- ]?original|fake|counterfeit|high quality (print|copy)|orica|novelty|metal card|gold card)\b/i;
let deepCalls = 0; const DEEP_MAX = 150;
async function deepCheck(id, R, total) {
  if (checked[id]) return checked[id][0];
  if (deepCalls >= DEEP_MAX) return null;
  deepCalls++; calls++;
  try {
    const r = await fetch('https://api.ebay.com/buy/browse/v1/item/' + encodeURIComponent('v1|' + id + '|0'), { headers: { Authorization: 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
    if (!r.ok) return null;
    const it = await r.json();
    const qty = Number(it.estimatedAvailabilities && it.estimatedAvailabilities[0] && it.estimatedAvailabilities[0].estimatedAvailableQuantity) || 1;
    const desc = String(it.description || it.shortDescription || '').replace(/<[^>]+>/g, ' ');
    const cond = JSON.stringify(it.conditionDescriptors || []).toLowerCase();
    let v = 'ok';
    if (FAKE_DESC.test(desc) || FAKE_DESC.test(it.subtitle || '')) v = 'fake';            // the description admits it
    else if (qty > 1 && R >= 40) v = 'multi';                                               // several "identical" copies of a chase card: almost always fakes or stock photos
    else if (/near mint or better/.test(cond)) v = 'nm';
    else if (/lightly played|excellent/.test(cond)) v = 'lp';
    else if (/moderately|heavily|damaged/.test(cond)) v = 'played';
    checked[id] = [v, new Date().toISOString().slice(0, 10)];
    return v;
  } catch (e) { return null; }
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
      if (total < 0.55 * R) continue;              // too cheap to be the real card in decent shape
    }
    const id = String(it.legacyItemId || (String(it.itemId).split('|')[1]) || it.itemId);
    // seller checks: brand-new or poorly rated sellers are where nearly all the cheap fakes come from
    const sel = it.seller || {}, user = String(sel.username || ''), score = Number(sel.feedbackScore) || 0, fbp = Number(sel.feedbackPercentage) || 0;
    if (bad.has('s:' + user.toLowerCase()) || bad.has('i:' + id)) continue;   // Taylor reported this seller or listing as fake
    if (score < 10 || fbp < 97) continue;
    if (total < 0.7 * R && score < 100) continue;   // a big discount from a small seller: too risky
    // [total incl. shipping, grader or null, grade or null, eBay item number, title, seller feedback %, Best Offer, seller, seller reviews, check]
    rows.push([total, grader, grade, id, it.title.slice(0, 90), fbp, (it.buyingOptions || []).includes('BEST_OFFER') ? 1 : 0, user, score, null]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  // closer look at the ones the app would show as deals (raw 15%+ under, graded 20%+ under)
  for (let i = 0; i < rows.length; i++) {
    const rw = rows[i]; if (rw[0] > (rw[1] ? 0.8 : 0.85) * R) continue;
    const v = await deepCheck(rw[3], R, rw[0]);
    if (v === 'fake' || v === 'multi' || (v === 'played' && !rw[1])) { rows.splice(i--, 1); continue; }
    rw[9] = v;
  }
  // keep the cheapest few graded (per grade band) and ungraded copies
  const keep = [], seen = {};
  for (const r of rows) { const k = r[1] ? r[1] + Math.floor(r[2]) : 'raw'; if ((seen[k] = (seen[k] || 0) + 1) <= 2 && keep.length < 8) keep.push(r); }
  if (keep.length) { out.c[c[0]] = keep; found++; }
  await sleep(120);
}
if (calls < 20 && existsSync(prevPath)) { log('Too few searches went through; keeping the previous file.'); process.exit(1); }
writeFileSync(prevPath + '.tmp', JSON.stringify(out)); renameSync(prevPath + '.tmp', prevPath);
for (const [id, [, day]] of Object.entries(checked)) if (Date.now() - Date.parse(day) > 30 * 864e5) delete checked[id];
writeFileSync(chkPath, JSON.stringify(checked));
log(`Closer fake checks: ${deepCalls} new, ${Object.values(checked).filter(x => x[0] === 'fake' || x[0] === 'multi').length} listings rejected so far.`);

// ---- deal alerts to Taylor's phone (ntfy) ----
await (async () => {
  const TOPIC = process.env.NTFY_TOPIC;
  if (!TOPIC) return log('No NTFY_TOPIC; alerts skipped.');
  if (!alertDocs) return log('Alerts: shared settings unavailable; skipping alerts.');
  if (!alertDocs.length) return log('Alerts: no shared settings yet (open the app once while signed in). Skipping alerts.');
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
    for (const [total, grader, grade, id, title, , , , , chk] of rows) {
      if (seen[id]) continue;
      const r = total / R;
      if (r > 1 - pct) continue;
      if (grader ? !gradeOk(grade, r, R) : r > 0.8) continue;
      deals.push({ c, R, total, grader, grade, id, title, r, chk });
    }
  }
  // two groups so cheaper cards aren't crowded out by big-dollar savings: cards under cheapMax (default $50) and the rest,
  // each ranked by how far under raw they are. Ungraded: only Near Mint or Lightly Played, per the seller's eBay condition.
  const cheapMax = cfg.cheapMax ?? 50, cheapN = Math.min(6, cfg.cheapN ?? 3);
  const done = [];   // deals looked at this run (the rest wait for a later run instead of being skipped)
  async function pick(list) {
    const keep = []; let looks = 0;
    for (const d of list.sort((a, b) => a.r - b.r || (b.R - b.total) - (a.R - a.total))) {
      if (!d.grader && (d.chk === 'nm' || d.chk === 'lp')) d.cond = d.chk === 'nm' ? 'Near Mint' : 'Lightly Played';
      else if (!d.grader) {
        if (looks >= 12 || keep.length >= 10) continue;
        looks++; done.push(d);
        try {
          const r = await fetch('https://api.ebay.com/buy/browse/v1/item/' + encodeURIComponent('v1|' + d.id + '|0'), { headers: { Authorization: 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
          if (!r.ok) continue;
          const it = await r.json();
          const cond = JSON.stringify(it.conditionDescriptors || []).toLowerCase();
          if (/near mint or better/.test(cond)) d.cond = 'Near Mint'; else if (/lightly played|excellent/.test(cond)) d.cond = 'Lightly Played'; else continue;
        } catch (e) { continue; }
      }
      if (keep.length >= 10) continue;
      done.push(d); keep.push(d);
    }
    return keep;
  }
  const cheap = await pick(deals.filter(d => d.R < cheapMax)), big = await pick(deals.filter(d => d.R >= cheapMax));
  const keep = [...cheap, ...big];
  if (first) for (const d of deals) seen[d.id] = new Date(now).toISOString().slice(0, 10);
  else for (const d of done) seen[d.id] = new Date(now).toISOString().slice(0, 10);
  for (const [id, day] of Object.entries(seen)) if (now - Date.parse(day) > 21 * 864e5) delete seen[id];
  writeFileSync(seenPath, JSON.stringify(seen));
  const send = (title, body, click, prio) => fetch('https://ntfy.sh/' + TOPIC, { method: 'POST', headers: { Title: title, Click: click, Priority: prio || 'default', Tags: 'moneybag' }, body }).catch(() => {});
  const usd = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (first) { await send('Deal alerts are on', `Watching eBay for your unowned chase cards (${owned.size} owned skipped). ${keep.length} current deals noted; you'll get a ping for new ones.`, 'https://jtcoggins444.github.io/chase-card-binder/#movers'); return log(`Alerts: first run, ${keep.length} current deals recorded without pinging.`); }
  // up to 6 pings: cheapN saved for cards under cheapMax, the rest to the biggest discounts on pricier cards (unused slots go to the other group)
  const nc = Math.min(cheap.length, Math.max(cheapN, 6 - big.length)), top = [...cheap.slice(0, nc), ...big.slice(0, 6 - nc)];
  for (const d of top) {
    const set = S[d.c[2]][0], what = d.grader ? `${d.grader} ${d.grade}` : d.cond;
    await send(`${d.c[1]} · ${what} · ${Math.round((1 - d.r) * 100)}% under`, `${set} #${d.c[3]}: ${usd(d.total)} with shipping vs ${usd(d.R)} raw Near Mint. ${d.title}`, 'https://www.ebay.com/itm/' + d.id, d.r <= 0.7 ? 'high' : 'default');
  }
  if (keep.length > top.length) await send(`${keep.length - top.length} more eBay deals${cheap.length > nc ? ` (${cheap.length - nc} under $${cheapMax})` : ''}`, 'Open the app to see them on each card (Slab deals sort).', 'https://jtcoggins444.github.io/chase-card-binder/');
  log(`Alerts: ${keep.length} new deals (${cheap.length} under $${cheapMax}), ${top.length} sent (${nc} cheap).`);
})();
log(`Searched ${pool.length} cards with ${calls} calls; ${found} cards have listings under raw Near Mint.`);
