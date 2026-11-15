// Chase Card Binder - in-stock singles at card shops that sell online on Shopify (e.g. OneStopTCG), for the app's
// Store finder: which shops have the most of the cards you want, so a bulk order needs as few shops as possible.
// Stores: DEFAULT below plus any Taylor adds in the app (cfg.stores, shared through the Firestore "alerts" document).
// Writes data/stores.json: {t, s: [[domain, name, city, singles]], c: {cardId: [[store, condition, price, handle], ...]}}
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const Root = join(dirname(fileURLToPath(import.meta.url)), '..'), Data = join(Root, 'data');
const DEFAULT = ['onestoptcg.com'];
const H = { 'User-Agent': 'Mozilla/5.0 (ChaseCardBinder personal collection tool; reads the public catalog once a day)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(new Date().toISOString().slice(11, 19) + '  ' + m);
async function get(url) { for (let t = 0; ; t++) { try { const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (t >= 2) throw e; await sleep(5000); } } }

const cards = JSON.parse(readFileSync(join(Data, 'cards.json'), 'utf8'));
const byPid = new Map(cards.cards.filter(c => c[6]).map(c => [Number(c[6]), c[0]]));
const cat = JSON.parse(readFileSync(join(Data, 'allcards.json'), 'utf8'));
const strip = s => String(s).replace(/^[A-Z]+\d*\w*:\s*/, '').replace(/^(SM|XY)\s*-\s*/, '').toLowerCase().replace(/pok[eé]mon/g, 'pokemon').replace(/[^a-z0-9]+/g, ' ').trim();
const normNum = n => String(n).toUpperCase().replace(/\s+/g, '').split('/')[0].replace(/^([A-Z]*)0+(\d)/, '$1$2');
const bySetNum = new Map();   // "set name|number" -> productId (TCGplayer), only for cards in the binder
for (const c of cat.cards) { if (!byPid.has(c[0])) continue; const st = cat.sets[c[3]]; if (st) bySetNum.set(strip(st[0]) + '|' + normNum(c[2]), c[0]); }

// stores Taylor added in the app
let extra = [];
try {
  const conf = readFileSync(join(Root, 'firebase-config.js'), 'utf8');
  const key = (conf.match(/apiKey:\s*["']([^"']+)/) || [])[1], pid = (conf.match(/projectId:\s*["']([^"']+)/) || [])[1];
  const j = await (await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/alerts?key=${key}`)).json();
  for (const d of j.documents || []) { const v = d.fields && d.fields.cfg && d.fields.cfg.mapValue && d.fields.cfg.mapValue.fields && d.fields.cfg.mapValue.fields.stores; if (v && v.stringValue) extra.push(...v.stringValue.split(',')); }
} catch (e) { log('Could not read stores added in the app: ' + e.message); }
if (process.env.STORES) { DEFAULT.length = 0; extra = process.env.STORES.split(','); }
const domains = [...new Set(DEFAULT.concat(extra).map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(s => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)))];

const COND = [['near mint', 'NM'], ['lightly played', 'LP'], ['moderately played', 'MP'], ['heavily played', 'HP'], ['damaged', 'DMG']];
const out = { t: new Date().toISOString(), s: [], c: {} };
for (const dom of domains) {
  const si = out.s.length, info = [dom, dom, '', 0, '', '', ''];   // domain, name, city, singles, error, country, selling online since
  out.s.push(info);
  try { const m = await get(`https://${dom}/meta.json`); if (m) { info[1] = m.name || dom; info[2] = [m.city, m.province].filter(Boolean).join(', '); info[5] = m.country || ''; } } catch (e) {}
  let singles = 0, matched = 0, pages = 0;
  try {
    for (let page = 1; page <= 400; page++) {
      const j = await get(`https://${dom}/products.json?limit=250&page=${page}`);
      const ps = (j && j.products) || []; if (!ps.length) break; pages = page;
      for (const p of ps) {
        const pub = String(p.created_at || p.published_at || '').slice(0, 10); if (pub && (!info[6] || pub < info[6])) info[6] = pub;
        const tags = (p.tags || []).join(' '), all = p.title + ' ' + p.product_type + ' ' + tags;
        if (!/pok[eé]mon/i.test(all) || /japan|chinese|korean|graded|\bslab\b|\bpsa\b|\bcgc\b|\bbgs\b|sealed|booster|elite trainer|\bbox\b|\btin\b|bundle|sleeve|binder|playmat|deck/i.test(all)) continue;
        // which card: TCGplayer product id in the SKU ("name-208378-nm-holo"), else "(190/202) - Set Name" in the title
        let pidHit = null;
        for (const v of p.variants || []) { const m = String(v.sku || '').match(/-(\d{4,7})-(nm|lp|mp|hp|dmg)\b/); if (m && byPid.has(+m[1])) { pidHit = +m[1]; break; } }
        if (!pidHit) {
          const m = p.title.match(/\(([A-Za-z]*\d+[A-Za-z]?(?:\s*\/\s*[A-Za-z]*\d+)?)\)\s*-\s*(.+)$/);
          if (m) pidHit = bySetNum.get(strip(m[2]) + '|' + normNum(m[1])) || null;
        }
        singles++;
        if (!pidHit) continue;
        const id = byPid.get(pidHit); matched++;
        for (const v of p.variants || []) {
          if (!v.available || /reverse/i.test(v.title)) continue;
          const t = String(v.title).toLowerCase(), cond = (COND.find(([k]) => t.includes(k)) || [null, t === 'default title' ? 'NM' : null])[1];
          if (!cond) continue;
          const price = Math.round(Number(v.price) * 100) / 100; if (!(price > 0)) continue;
          const L = out.c[id] = out.c[id] || [];
          const ex = L.find(x => x[0] === si && x[1] === cond);
          if (ex) { if (price < ex[2]) { ex[2] = price; ex[3] = p.handle; } } else L.push([si, cond, price, p.handle]);
        }
      }
      await sleep(400);
    }
  } catch (e) { info[4] = String(e.message || e).slice(0, 120); log(`${dom}: ${e.message}`); }
  info[3] = singles;
  log(`${info[1]} (${dom}): ${pages} pages, ${singles} Pokémon singles, ${matched} match cards in the binder.`);
}
const OUT = process.env.OUT || join(Data, 'stores.json');
writeFileSync(OUT + '.tmp', JSON.stringify(out)); renameSync(OUT + '.tmp', OUT);
log(`${Object.keys(out.c).length} binder cards in stock at ${domains.length} store(s).`);
