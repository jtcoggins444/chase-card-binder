// Chase Card Binder - in-stock singles at card shops that sell online on Shopify (e.g. OneStopTCG), for the app's
// Store finder: which shops have the most of the cards you want, so a bulk order needs as few shops as possible.
// Stores: DEFAULT below plus any Taylor adds in the app (cfg.stores, shared through the Firestore "alerts" document).
// Writes data/stores.json: {t, s: [[domain, name, city, singles]], c: {cardId: [[store, condition, price, handle, variant id], ...]}}
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const Root = join(dirname(fileURLToPath(import.meta.url)), '..'), Data = join(Root, 'data');
// US shops with real storefronts and large in-stock Pokémon singles (checked Nov 2026: Google ratings, TCGplayer seller history)
const DEFAULT = ['common-lands.com', 'magicandmonsters.com', 'eternalgameschesterfield.com', 'levelupgamesmd.com', 'sparkysgaming.com', 'tradingcardworld.store', 'onestoptcg.com', 'zulusgames.com', 'retrogamingofdenver.com', 'blackswampgames.com', 'poke-collect.com'];
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
const byNumTot = new Map();   // "number/total" -> productIds, for shops that leave the set name out
for (const c of cat.cards) {
  if (!byPid.has(c[0])) continue; const st = cat.sets[c[3]]; if (st) bySetNum.set(strip(st[0]) + '|' + normNum(c[2]), c[0]);
  const m = String(c[2]).match(/^([A-Za-z]*\d+[a-z]?)\s*\/\s*([A-Za-z]*\d+)$/); if (m) { const k = normNum(m[1]) + '/' + normNum(m[2]); byNumTot.set(k, (byNumTot.get(k) || []).concat(c[0])); }
}
const nameOf = new Map(cards.cards.filter(c => c[6]).map(c => [Number(c[6]), c[1]]));
const words = s => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w.length >= 3 && !['the', 'and'].includes(w));
function nameOk(pid, title) { const t = ' ' + words(title).join(' ') + ' '; return words(nameOf.get(pid) || '').every(w => t.includes(' ' + w + ' ')); }
// which binder card a shop's product is: TCGplayer id in the SKU, else set name + number from the title/description, else number/total + name
const FINISH = /\s+(1st edition |unlimited )?(reverse holofoil|holofoil|normal|holo|non-holo|reverse holo)\s*$/i;
function identify(p) {
  for (const v of p.variants || []) { const m = String(v.sku || '').match(/-(\d{4,7})-(nm|lp|mp|hp|dmg)\b/); if (m && byPid.has(+m[1])) return +m[1]; }
  const title = String(p.title), body = String(p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const sets = [];
  const br = title.match(/\[([^\]]+)\]\s*$/); if (br) sets.push(br[1], br[1].split(':').pop());
  const dash = title.match(/\s-\s([^-]+)$/); if (dash) { const t = dash[1].replace(FINISH, '').trim(); sets.push(t, t.replace(/^[A-Z]{1,6}\d*[a-z]?\s+/, ''), t.split(':').pop()); }
  const bs = body.match(/Set:\s*(.+?)(?=\s+(Type|Number|Card Number|Rarity|Condition|Language):|$)/); if (bs) sets.push(bs[1], bs[1].split(':').pop());
  const nums = [];
  for (const m of title.matchAll(/([A-Za-z]{0,6}\d{1,3}[a-z]?)\s*\/\s*([A-Za-z]{0,6}\d{1,3})/g)) nums.push([m[1], m[2]]);
  for (const m of title.matchAll(/\(([A-Za-z]{0,6}\d{1,3}[a-z]?)\)/g)) nums.push([m[1], null]);
  const pre = title.match(/\s([A-Za-z]{0,6}\d{1,3}[a-z]?)\s+-\s/); if (pre) nums.push([pre[1], null]);
  const bn = body.match(/(?:Card )?Number:\s*([A-Za-z]{0,6}\d{1,3}[a-z]?)(?:\s*\/\s*([A-Za-z]{0,6}\d{1,3}))?/); if (bn) nums.push([bn[1], bn[2] || null]);
  for (const st of sets) for (const [n] of nums) { const pid = bySetNum.get(strip(st) + '|' + normNum(n)); if (pid && nameOk(pid, title)) return pid; }
  for (const [n, t] of nums) { if (!t) continue; const hits = (byNumTot.get(normNum(n) + '/' + normNum(t)) || []).filter(pid => nameOk(pid, title)); if (hits.length === 1) return hits[0]; }
  return null;
}
// shops whose raw singles live in a search app (e.g. Common Lands: /apps/search?tab=raw), one card per entry with its TCGplayer id
const unesc = s => String(s).replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"');
async function appSearch(dom, si, out, info) {
  let first; try { const r = await fetch(`https://${dom}/apps/search?f_game=Pokemon&tab=raw&frame=4&page=1`, { headers: H, signal: AbortSignal.timeout(30000) }); if (!r.ok) return false; first = await r.text(); } catch (e) { return false; }
  if (!/data-raw-card/.test(first)) return false;
  const pages = Math.min(80, Number((first.match(/"pages":\s*(\d+)/) || [])[1] || 1));
  let singles = 0, matched = 0;
  for (let page = 1; page <= pages; page++) {
    const html = page === 1 ? first : await (await fetch(`https://${dom}/apps/search?f_game=Pokemon&tab=raw&frame=4&page=${page}`, { headers: H, signal: AbortSignal.timeout(30000) })).text();
    for (const li of html.split('<li class="grid__item">').slice(1)) {
      const a = k => { const m = li.match(new RegExp('data-' + k + '="([^"]*)"')); return m ? unesc(m[1]) : ''; };
      const name = a('name'), set = a('set'), cond = a('cond').toUpperCase(), variant = a('variant'), tcg = Number(a('tcg'));
      const price = Number((li.match(/price-item--regular[^>]*>\s*\$([\d,.]+)/) || [])[1]?.replace(/,/g, '')), href = unesc((li.match(/href="(\/apps\/search\/card\/[^"]+)"/) || [])[1] || '');
      if (!name || /\(JP\)|japanese/i.test(name + ' ' + set)) continue;
      singles++;
      if (/reverse/i.test(variant) || !byPid.has(tcg) || !(price > 0)) continue;
      const id = byPid.get(tcg), c = { NM: 'NM', LP: 'LP', MP: 'MP', HP: 'HP', DMG: 'DMG' }[cond]; if (!c) continue; matched++;
      const L = out.c[id] = out.c[id] || []; const ex = L.find(x => x[0] === si && x[1] === c);
      if (ex) { if (price < ex[2]) { ex[2] = price; ex[3] = href; } } else L.push([si, c, price, href]);   // href is a path on their site; no cart link (sign-in needed)
    }
    await sleep(500);
  }
  info[3] = singles; info[7] = matched; info[8] = 'app';
  log(`${info[1]} (${dom}): ${pages} search pages, ${singles} Pokémon singles in stock, ${matched} match cards in the binder.`);
  return true;
}
// where a shop lists in-stock Pokémon singles: an in-stock collection if it has one (a whole catalog can only be read up to 25,000 products)
async function sources(dom) {
  const cols = [];
  for (let page = 1; page <= 6; page++) { const j = await get(`https://${dom}/collections.json?limit=250&page=${page}`); const cs = (j && j.collections) || []; if (!cs.length) break; cols.push(...cs); await sleep(300); }
  const pk = cols.filter(c => /pok/i.test(c.handle + ' ' + c.title) && /single/i.test(c.handle + ' ' + c.title) && !/japan|graded|slab|sealed/i.test(c.handle + ' ' + c.title) && c.products_count !== 0);
  const inStock = pk.filter(c => /in-?stock|instock/i.test(c.handle + ' ' + c.title));
  const pick = inStock.length ? inStock : pk.filter(c => /^pokemon-singles?$|^pokemon-single-cards?$|^pokemon-tcg-singles?$/i.test(c.handle));
  return pick.length ? pick.slice(0, 2).map(c => `/collections/${c.handle}/products.json`) : ['/products.json'];
}

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

const COND = [['near mint', 'NM'], ['nm-mint', 'NM'], ['lightly played', 'LP'], ['moderately played', 'MP'], ['heavily played', 'HP'], ['damaged', 'DMG']];
const out = { t: new Date().toISOString(), s: [], c: {} };
for (const dom of domains) {
  const si = out.s.length, info = [dom, dom, '', 0, '', '', '', 0];   // domain, name, city, singles, error, country, selling online since, matched
  out.s.push(info);
  try { const m = await get(`https://${dom}/meta.json`); if (m) { info[1] = m.name || dom; info[2] = [m.city, m.province].filter(Boolean).join(', '); info[5] = m.country || ''; } } catch (e) {}
  let singles = 0, matched = 0, pages = 0;
  const seenP = new Set();
  if (await appSearch(dom, si, out, info).catch(e => { log(`${dom} search app: ${e.message}`); return false; })) continue;
  try {
    for (const src of await sources(dom)) {
      for (let page = 1; page <= 100; page++) {
        const j = await get(`https://${dom}${src}?limit=250&page=${page}`);
        const ps = (j && j.products) || []; if (!ps.length) break; pages++;
        for (const p of ps) {
          if (seenP.has(p.id)) continue; seenP.add(p.id);
          const pub = String(p.created_at || p.published_at || '').slice(0, 10); if (pub && (!info[6] || pub < info[6])) info[6] = pub;
          const tags = (p.tags || []).join(' '), all = p.title + ' ' + p.product_type + ' ' + tags + ' ' + p.vendor;
          if (!/pok[eé]mon/i.test(all + ' ' + src) || /japan|\bjpn?\b|chinese|korean|graded|\bslab\b|\bpsa\b|\bcgc\b|\bbgs\b|sealed|booster|elite trainer|\bbox\b|\btin\b|bundle|sleeve|binder|playmat|deck\b|code card/i.test(all)) continue;
          if (!(p.variants || []).some(v => v.available)) continue;
          singles++;
          const pidHit = identify(p); if (!pidHit) continue;
          const id = byPid.get(pidHit); matched++;
          for (const v of p.variants || []) {
            if (!v.available || /reverse|japanese|-JP-/i.test(v.title + ' ' + (v.sku || ''))) continue;
            const t = String(v.title).toLowerCase(), cond = (COND.find(([k]) => t.includes(k)) || [null, /^(default title|nm)\b/.test(t) ? 'NM' : /^lp\b/.test(t) ? 'LP' : null])[1];
            if (!cond) continue;
            const price = Math.round(Number(v.price) * 100) / 100; if (!(price > 0)) continue;
            const L = out.c[id] = out.c[id] || [];
            const ex = L.find(x => x[0] === si && x[1] === cond);
            if (ex) { if (price < ex[2]) { ex[2] = price; ex[3] = p.handle; ex[4] = v.id; } } else L.push([si, cond, price, p.handle, v.id]);   // v.id: for a cart link
          }
        }
        await sleep(400);
      }
    }
  } catch (e) { info[4] = String(e.message || e).slice(0, 120); log(`${dom}: ${e.message}`); }
  info[3] = singles; info[7] = matched;
  log(`${info[1]} (${dom}): ${pages} pages, ${singles} Pokémon singles in stock, ${matched} match cards in the binder.`);
}
const OUT = process.env.OUT || join(Data, 'stores.json');
writeFileSync(OUT + '.tmp', JSON.stringify(out)); renameSync(OUT + '.tmp', OUT);
log(`${Object.keys(out.c).length} binder cards in stock at ${domains.length} store(s).`);
