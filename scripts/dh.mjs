// Chase Card Binder - Double Holo cashback watch.
// Reads Double Holo's live and upcoming store-credit events, looks up Double Holo's lowest asking price for the binder cards
// Taylor still needs that the event covers, and flags the ones that come out at or under the TCGplayer market once the credit is counted.
// Writes data/dh.json for the app and pings Taylor's phone (ntfy) once per event.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(new Date().toISOString().slice(11, 19) + '  ' + m);
const r2 = v => Math.round(v * 100) / 100;
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)', Origin: 'https://doubleholo.com', Referer: 'https://doubleholo.com/' };

const cards = JSON.parse(readFileSync(join(Root, 'data/cards.json'), 'utf8'));
const S = cards.sets, latest = JSON.parse(readFileSync(join(Root, 'data/latest.json'), 'utf8'));
const mkt = c => { const L = c[6] && latest[String(c[6])]; return L && L[3] ? L[3] : null; };

// owned cards and settings shared by the app (same Firestore "alerts" documents the eBay check reads)
const conf = readFileSync(join(Root, 'firebase-config.js'), 'utf8');
const fbKey = (conf.match(/apiKey:\s*["']([^"']+)/) || [])[1], fbPid = (conf.match(/projectId:\s*["']([^"']+)/) || [])[1];
const owned = new Set(); const cfg = {};
try {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${fbPid}/databases/(default)/documents/alerts?key=${fbKey}`);
  if (r.ok) for (const d of (await r.json()).documents || []) {
    const f = d.fields || {};
    for (const id of String((f.owned && f.owned.stringValue) || '').split(',')) if (id) owned.add(id);
    for (const [k, v] of Object.entries((f.cfg && f.cfg.mapValue && f.cfg.mapValue.fields) || {})) if (k !== 'bad' && k !== 'stores') cfg[k] = Number(v.integerValue ?? v.doubleValue ?? v.stringValue);
  } else log(`Can't read the shared settings (HTTP ${r.status}).`);
} catch (e) { log('Settings: ' + e.message); }
const PREMIUM = cfg.dhPrem == null || isNaN(cfg.dhPrem) ? 0 : cfg.dhPrem;   // Taylor's Double Holo plan (set in the app); premium earns the full rate
const HI = cfg.liveMax ?? 80, NEWMO = cfg.newMo ?? 3;
const months = sid => { const d = S[sid] && S[sid][2]; return d ? (Date.now() - new Date(d.replace(/\//g, '-') + 'T12:00:00')) / (30.4 * 864e5) : 99; };
const want = cards.cards.filter(c => !owned.has(c[0]) && mkt(c) && mkt(c) <= HI && months(c[2]) >= NEWMO);
log(`${owned.size} owned; ${want.length} cards still wanted up to $${HI} (sets older than ${NEWMO} months).`);

// ---- events ----
const live = await (await fetch('https://api.doubleholo.com/api/v1/cashback/live', { headers: H })).json();
const promos = [live.live_promo, live.next_promo].filter(Boolean);
const rateOf = p => PREMIUM ? (p.premium_rate ?? p.rate ?? 0) : (p.free_rate ?? 0);

// ---- Double Holo's marketplace search (the same public search their site uses) ----
const ALG = 'https://w5sf479zkl-dsn.algolia.net/1/indexes/*/queries';
const AK = { 'x-algolia-api-key': '50fdd89ab8d777151bc000bba6097357', 'x-algolia-application-id': 'W5SF479ZKL', 'Content-Type': 'application/json', ...H };
async function search(reqs) {
  const r = await fetch(ALG, { method: 'POST', headers: AK, body: JSON.stringify({ requests: reqs }) });
  if (!r.ok) throw new Error('search HTTP ' + r.status);
  return (await r.json()).results || [];
}
const ATTR = ['name', 'number', 'set_name', 'lowest_ask', 'active_asks_count', 'language', 'available_conditions', 'has_raw_listings', 'era', 'rarity'];
const OKC = new Set(['NM', 'LP']);   // only count a card when every copy listed is Near Mint or Lightly Played, so its lowest ask is one Taylor would buy
const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/^pokemon\s+/, '').replace(/[^a-z0-9]/g, '');
const numN = s => String(s || '').toUpperCase().split('/')[0].replace(/^([A-Z]*)0*(\d)/, '$1$2');
// Double Holo keeps Trainer Gallery, Galarian Gallery, Shiny Vault and Radiant Collection cards inside the main set
const baseSet = n => String(n).replace(/\s+(Trainer Gallery|Galarian Gallery|Shiny Vault|Radiant Collection)$/i, '');
const ERA = { 'Scarlet & Violet': 'scarlet_violet', 'Sword & Shield': 'sword_shield', 'Sun & Moon': 'sun_moon', XY: 'xy', 'Black & White': 'bw', 'Mega Evolution': 'mega_evolution' };

// which wanted cards each event covers
function covered(p) {
  const k = p.target_kind, v = String(p.target_value || '');
  if (k === 'preset' && /^all$/i.test(v)) return want;
  if (k === 'set') return want.filter(c => norm(baseSet(S[c[2]][0])) === norm(v));
  if (k === 'era') return want.filter(c => ERA[S[c[2]][1]] === v || norm(S[c[2]][1]) === norm(v));
  if (k === 'pokemon' || k === 'card_name' || k === 'name') return want.filter(c => norm(c[1]).includes(norm(v)));
  return [];   // graded-only or sealed-only events don't cover raw singles
}

// Double Holo's own set names (english), matched to the binder's by name
const facet = new Map();
try { const [r] = await search([{ indexName: 'production_cards', query: '', hitsPerPage: 0, facets: ['set_name'], maxValuesPerFacet: 1000, facetFilters: [['language:english']], filters: 'NOT is_sealed:true' }]);
  for (const n of Object.keys((r.facets || {}).set_name || {})) if (!/japanese|chinese|korean|indonesian|topps/i.test(n)) { const k = norm(n); if (!facet.has(k) || /^Pokemon /.test(n)) facet.set(k, n); } }
catch (e) { log('Set list: ' + e.message); }
const ALIAS = { '151': 'Pokemon Scarlet & Violet 151' };
const dhSet = n => ALIAS[n] && [...facet.values()].includes(ALIAS[n]) ? ALIAS[n] : facet.get(norm(n)) || facet.get(norm('Scarlet & Violet ' + n)) || facet.get(norm('Sword & Shield ' + n)) || null;
const missingSets = new Set();
// lowest raw ask per wanted card, searched set by set (english only)
const setNames = new Map();
async function asks(list) {
  const out = new Map();
  const bySet = new Map(); for (const c of list) { const b = baseSet(S[c[2]][0]); if (!bySet.has(b)) bySet.set(b, []); bySet.get(b).push(c); }
  const names = [...bySet.keys()].filter(n => dhSet(n) || (missingSets.add(n), false));
  for (let i = 0; i < names.length; i += 8) {
    const chunk = names.slice(i, i + 8);
    let res;
    try { res = await search(chunk.map(n => ({ indexName: 'production_cards', query: '', hitsPerPage: 1000, attributesToRetrieve: ATTR, facetFilters: [['set_name:' + dhSet(n)], ['language:english']], filters: 'NOT is_sealed:true' }))); }
    catch (e) { log('Search: ' + e.message); await sleep(3000); continue; }
    res.forEach((r, j) => {
      const n = chunk[j], hits = r.hits || []; setNames.set(n, hits.length);
      const idx = new Map(); for (const h of hits) idx.set(numN(h.number), [...(idx.get(numN(h.number)) || []), h]);
      for (const c of bySet.get(n)) {
        const cand = (idx.get(numN(c[3])) || []).filter(h => h.lowest_ask > 0 && h.has_raw_listings !== false && (h.available_conditions || []).length && h.available_conditions.every(x => OKC.has(x)));
        const words = c[1].toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 3);
        const h = cand.filter(h => words.every(w => String(h.name).toLowerCase().includes(w)))[0] || (cand.length === 1 ? cand[0] : null);
                if (h) out.set(c[0], { ask: h.lowest_ask, n: h.active_asks_count || 1, slug: h.slug || '', id: h.objectID, cond: (h.available_conditions || []).join('/') });
      }
    });
    await sleep(700);
  }
  return out;
}

const byIdAll = new Map(cards.cards.map(c => [c[0], c]));
const out = { t: new Date().toISOString(), cap: live.monthly_cap ?? null, premium: PREMIUM, promos: [] };
for (const p of promos) {
  const live_ = Date.parse(p.starts_at) <= Date.now();
  const soon = Date.parse(p.starts_at) - Date.now() < 36 * 3600e3;
  const P = { id: p.id, name: p.name, label: p.target_label, kind: p.target_kind, value: p.target_value, rate: p.premium_rate ?? p.rate ?? 0, free: p.free_rate ?? 0, start: p.starts_at, end: p.ends_at, max: p.max_credit_per_buyer ?? null, live: live_, wanted: 0, deals: [] };
  const list = covered(p); P.wanted = list.length;
  if (list.length && (live_ || soon)) {
    const A = await asks(list), rate = rateOf(p);
    for (const c of list) {
      const a = A.get(c[0]); if (!a) continue;
      const m = mkt(c), eff = r2(a.ask * (1 - rate));
      if (eff <= m * 1.02) P.deals.push([c[0], a.ask, eff, r2(m), '', a.n, a.cond, a.id]);
    }
    P.deals.sort((x, y) => (y[3] - y[2]) - (x[3] - x[2]));   // biggest dollar savings first
    P.deals = P.deals.slice(0, 150);
    // the card page link (and a check that it's the same TCGplayer product) for each find
    for (const d of P.deals) {
      try { const j = await (await fetch('https://api.doubleholo.com/api/v1/cards/' + d[7], { headers: H })).json(); const k = j.card || {};
        const c = byIdAll.get(d[0]); if (k.tcgplayer_product_id && c[6] && Number(k.tcgplayer_product_id) !== Number(c[6])) { d[0] = null; continue; }
        if (k.slug) d[4] = `/card/${k.id}/${k.slug}`; } catch (e) {}
      await sleep(250);
    }
    P.deals = P.deals.filter(d => d[0]).map(d => d.slice(0, 7));
    P.listed = A.size;
    log(`${p.name}: ${list.length} wanted cards covered, ${A.size} listed on Double Holo, ${P.deals.length} at or under market after ${Math.round(rate * 100)}% back.`);
  } else log(`${p.name}: ${list.length} wanted cards covered${live_ || soon ? '' : ' (starts later; prices checked closer to the start)'}.`);
  out.promos.push(P);
}
if (missingSets.size) log(`Sets not found on Double Holo: ${[...missingSets].join(', ')}`);
out.info = { owned: owned.size, want: want.length, unmatchedSets: [...missingSets], };
writeFileSync(join(Root, 'data/dh.json'), JSON.stringify(out));

// ---- phone alerts: once when an event is announced, once when it goes live (with the best finds) ----
const TOPIC = process.env.NTFY_TOPIC;
const seenPath = join(Root, 'data/dh-seen.json');
const seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : {};
const when = s => new Date(s).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const byId = new Map(cards.cards.map(c => [c[0], c]));
for (const P of out.promos) {
  if (!P.wanted) continue;
  const key = P.id + (P.live ? ':live' : ':soon');
  if (seen[key]) continue;
  const pct = Math.round((PREMIUM ? P.rate : P.free) * 100);
  if (!pct) { seen[key] = Date.now(); continue; }
  let body = `${pct}% back in store credit on ${P.label}, ${P.live ? 'until ' + when(P.end) : when(P.start) + ' to ' + when(P.end)}. Covers ${P.wanted} cards you still need.`;
  if (P.deals.length) body += `\n${P.deals.length} at or under market after the credit:\n` + P.deals.slice(0, 5).map(d => { const c = byId.get(d[0]); return `${c[1]} (${S[c[2]][0]}) $${d[1]} → $${d[2]} vs $${d[3]}`; }).join('\n');
  if (P.max) body += `\nCredit capped at $${P.max} for this event.`;
  if (TOPIC) await fetch('https://ntfy.sh/' + TOPIC, { method: 'POST', headers: { Title: `Double Holo: ${P.name}${P.live ? ' is on' : ' coming up'}`, Click: 'https://jtcoggins444.github.io/chase-card-binder/#dh', Tags: 'moneybag' }, body }).catch(() => {});
  seen[key] = Date.now(); log('Alert: ' + body.split('\n')[0]);
}
for (const k of Object.keys(seen)) if (Date.now() - seen[k] > 60 * 864e5) delete seen[k];
writeFileSync(seenPath, JSON.stringify(seen));
