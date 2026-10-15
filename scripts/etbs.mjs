// Chase Card Binder - collects the Elite Trainer Boxes for every set in the checklist (run once from GitHub;
// new sets get theirs from the nightly new-set check). Their prices are then tracked nightly like the cards.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const Root = join(dirname(fileURLToPath(import.meta.url)), '..'), Data = join(Root, 'data');
const Base = process.env.BINDER_BASE || 'https://tcgcsv.com';
const Headers = { 'User-Agent': 'ChaseCardBinder/1.0 (personal collection price tracker)' };
const read = p => JSON.parse(readFileSync(join(Data, p), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) { for (let t = 0; ; t++) { try { const r = await fetch(url, { headers: Headers, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (t >= 2) throw e; await sleep(4000); } } }
export const isEtb = name => /elite trainer box/i.test(name) && !/case|display|\bset of\b|code card|sleeves?\b|deck box|binder|bundle of/i.test(name);
const num = x => (x == null || !isFinite(x)) ? 'null' : String(Math.round(x * 100) / 100);

const cards = read('cards.json'), pids = read('pids.json'), groups = read('groups.json').groups;
const setOfPid = new Map(cards.cards.map(c => [c[6], c[2]]));
const have = new Set((cards.etbs || []).map(e => e[6]));
cards.etbs = cards.etbs || [];
const latest = read('latest.json');
const days = (await import('node:fs')).readdirSync(join(Data, 'days')).filter(f => f.endsWith('.json')).sort();
const lastDayPath = join(Data, 'days', days[days.length - 1]);
const lastDay = JSON.parse(readFileSync(lastDayPath, 'utf8'));
let added = 0;
for (const g of groups) {
  let prods;
  try { prods = (await get(`${Base}/tcgplayer/3/${g}/products`)).results || []; } catch (e) { console.log(`group ${g}: ${e.message}`); continue; }
  await sleep(150);
  // which checklist set is this group? the set most of its known cards belong to
  const votes = {};
  for (const p of prods) { const s = setOfPid.get(p.productId); if (s) votes[s] = (votes[s] || 0) + 1; }
  const sid = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!sid) continue;
  const etbs = prods.filter(p => isEtb(p.name) && !have.has(p.productId));
  if (!etbs.length) continue;
  let prices = {};
  try { for (const r of (await get(`${Base}/tcgplayer/3/${g}/prices`)).results || []) if (!prices[r.productId] || r.marketPrice != null) prices[r.productId] = r; } catch (e) {}
  await sleep(150);
  for (const p of etbs) {
    cards.etbs.push(['etb-' + p.productId, String(p.name).trim(), sid, '', 'ETB', null, p.productId, 't']);
    have.add(p.productId);
    if (!pids.includes(p.productId)) pids.push(p.productId);
    const r = prices[p.productId];
    if (r) { latest[p.productId] = [r.lowPrice, r.midPrice, r.highPrice, r.marketPrice, r.directLowPrice]; lastDay.v[pids.indexOf(p.productId)] = r.marketPrice ?? null; }
    added++;
    console.log(`${cards.sets[sid][0]}: ${p.name} (${r && r.marketPrice != null ? '$' + r.marketPrice : 'no price'})`);
  }
}
writeFileSync(join(Data, 'cards.json'), JSON.stringify(cards));
writeFileSync(join(Data, 'pids.json'), JSON.stringify(pids));
writeFileSync(join(Data, 'latest.json'), '{' + Object.entries(latest).map(([k, v]) => `"${k}":[${[].concat(v).map(num).join(',')}]`).join(',') + '}');
for (let i = 0; i < pids.length; i++) if (lastDay.v[i] === undefined) lastDay.v[i] = null;
writeFileSync(lastDayPath, '{"d":"' + lastDay.d + '","u":"' + lastDay.u + '","v":[' + lastDay.v.map(num).join(',') + ']}');
console.log(`Added ${added} Elite Trainer Boxes.`);
