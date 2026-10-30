// Chase Card Binder - adds every English Ultra-Premium Collection (UPC) to the sealed tab, next to the ETBs.
// Some UPCs sit in their set's TCGplayer group, others in promo groups; those are placed in the set released
// just before them so they land in the right era. Prices are then tracked nightly like everything else.
// Usage: node scripts/upcs.mjs [--dry]   (--dry only writes the list to probe/upcs.json)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const Root = join(dirname(fileURLToPath(import.meta.url)), '..'), Data = join(Root, 'data');
const Base = process.env.BINDER_BASE || 'https://tcgcsv.com', DRY = process.argv.includes('--dry');
const Headers = { 'User-Agent': 'ChaseCardBinder/1.0 (personal collection price tracker)' };
const read = p => JSON.parse(readFileSync(join(Data, p), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) { for (let t = 0; ; t++) { try { const r = await fetch(url, { headers: Headers, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (t >= 2) throw e; await sleep(4000); } } }
export const isUpc = name => /ultra[\s-]*premium\s+collection/i.test(name) && !/\bcase\b|display|\bset of\b|code card|sleeves?\b|deck box|binder|bundle of|playmat|\bpins?\b only|coin only/i.test(name);
const num = x => (x == null || !isFinite(x)) ? 'null' : String(Math.round(x * 100) / 100);

const cards = read('cards.json'), pids = read('pids.json'), groupsFile = read('groups.json');
const known = new Set(groupsFile.groups.map(Number));
const setOfPid = new Map(cards.cards.map(c => [c[6], c[2]]));
const have = new Set((cards.etbs || []).map(e => e[6]));
const setsByDate = Object.entries(cards.sets).map(([id, s]) => [id, s[2].replace(/\//g, '-')]).sort((a, b) => a[1].localeCompare(b[1]));
const setBefore = day => { let best = null; for (const [id, d] of setsByDate) if (d <= day && !/(tg|gg)$/.test(id)) best = id; return best || setsByDate[0][0]; };
cards.etbs = cards.etbs || [];
const latest = read('latest.json');
const days = (await import('node:fs')).readdirSync(join(Data, 'days')).filter(f => f.endsWith('.json')).sort();
const lastDayPath = join(Data, 'days', days[days.length - 1]);
const lastDay = JSON.parse(readFileSync(lastDayPath, 'utf8'));
const groups = (await get(`${Base}/tcgplayer/3/groups`)).results || [];
const found = [];
for (const g of groups) {
  let prods;
  try { prods = (await get(`${Base}/tcgplayer/3/${g.groupId}/products`)).results || []; } catch (e) { console.log(`${g.name}: ${e.message}`); continue; }
  await sleep(120);
  const upcs = prods.filter(p => isUpc(p.name));
  if (!upcs.length) continue;
  const votes = {};
  for (const p of prods) { const s = setOfPid.get(p.productId); if (s) votes[s] = (votes[s] || 0) + 1; }
  const voted = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
  let prices = {};
  try { for (const r of (await get(`${Base}/tcgplayer/3/${g.groupId}/prices`)).results || []) if (!prices[r.productId] || r.marketPrice != null) prices[r.productId] = r; } catch (e) {}
  await sleep(120);
  for (const p of upcs) {
    const rel = String((p.presaleInfo && p.presaleInfo.releasedOn) || g.publishedOn || '').slice(0, 10);
    const sid = voted || setBefore(rel);
    const r = prices[p.productId];
    found.push({ pid: p.productId, name: p.name, group: g.name, groupId: g.groupId, released: rel, set: sid, setName: cards.sets[sid][0], how: voted ? 'group' : 'date', price: r ? r.marketPrice : null, have: have.has(p.productId) });
    if (DRY || have.has(p.productId)) continue;
    cards.etbs.push(['upc-' + p.productId, String(p.name).trim(), sid, '', 'UPC', null, p.productId, 't']);
    have.add(p.productId);
    if (!pids.includes(p.productId)) pids.push(p.productId);
    if (!known.has(g.groupId)) { groupsFile.groups.push(g.groupId); known.add(g.groupId); }
    if (r) { latest[p.productId] = [r.lowPrice, r.midPrice, r.highPrice, r.marketPrice, r.directLowPrice]; lastDay.v[pids.indexOf(p.productId)] = r.marketPrice ?? null; }
  }
}
mkdirSync(join(Root, 'probe'), { recursive: true });
writeFileSync(join(Root, 'probe/upcs.json'), JSON.stringify(found, null, 1));
console.log(`${found.length} Ultra-Premium Collections found.`);
if (DRY) process.exit(0);
writeFileSync(join(Data, 'cards.json'), JSON.stringify(cards));
writeFileSync(join(Data, 'pids.json'), JSON.stringify(pids));
writeFileSync(join(Data, 'groups.json'), JSON.stringify(groupsFile));
writeFileSync(join(Data, 'latest.json'), '{' + Object.entries(latest).map(([k, v]) => `"${k}":[${[].concat(v).map(num).join(',')}]`).join(',') + '}');
for (let i = 0; i < pids.length; i++) if (lastDay.v[i] === undefined) lastDay.v[i] = null;
writeFileSync(lastDayPath, '{"d":"' + lastDay.d + '","u":"' + lastDay.u + '","v":[' + lastDay.v.map(num).join(',') + ']}');
