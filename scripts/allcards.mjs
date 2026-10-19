// Chase Card Binder - catalog of every English Pokémon card on TCGplayer (for the "scan any card" scanner).
//  data/allcards.json : {v, sets: {groupId: [name, abbreviation, released]}, cards: [[productId, name, number, groupId, rarity], ...]}
//  data/allprices.json: {d, p: {productId: marketPrice}}   (refreshed every run)
// Product lists are only downloaded for sets we haven't seen yet, plus the newest few sets (cards get added to those).
// Usage: node scripts/allcards.mjs [--prices-only]
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const Data = join(Root, 'data');
const Base = process.env.BINDER_BASE || 'https://tcgcsv.com';
const Headers = { 'User-Agent': 'ChaseCardBinder/1.0 (personal collection tracker, card scanner catalog)' };
const Preferred = ['Holofoil', 'Normal', 'Unlimited Holofoil', '1st Edition Holofoil', 'Reverse Holofoil'];
const log = m => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + m);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function write(p, text) { writeFileSync(p + '.tmp', text, 'utf8'); renameSync(p + '.tmp', p); }
async function getJSON(url, tries = 3) {
  for (let n = 1; ; n++) {
    try {
      const r = await fetch(url, { headers: Headers, signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (n >= tries) throw e; await sleep(5000 * n); }
  }
}
// sealed product, code cards and other things that aren't single cards
const NOT_CARD = /\b(booster|box|bundle|pack|tin|collection|deck|case|display|blister|sleeves?|binder|portfolio|code card|playmat|coin|pin|figure|kit|bag|lot of)\b/i;

const catPath = join(Data, 'allcards.json'), pricePath = join(Data, 'allprices.json');
const cat = existsSync(catPath) ? JSON.parse(readFileSync(catPath, 'utf8')) : { v: 1, sets: {}, cards: [] };
const pricesOnly = process.argv.includes('--prices-only');

const groups = (await getJSON(`${Base}/tcgplayer/3/groups`)).results || [];
groups.sort((a, b) => String(b.publishedOn).localeCompare(String(a.publishedOn)));
const newest = new Set(groups.slice(0, 4).map(g => g.groupId));
const have = new Set(Object.keys(cat.sets).map(Number));

if (!pricesOnly) {
  const byGroup = new Map();
  for (const c of cat.cards) { if (!byGroup.has(c[3])) byGroup.set(c[3], []); byGroup.get(c[3]).push(c); }
  let fetched = 0;
  for (const g of groups) {
    if (have.has(g.groupId) && !newest.has(g.groupId)) continue;
    let prods;
    try { prods = (await getJSON(`${Base}/tcgplayer/3/${g.groupId}/products`)).results || []; }
    catch (e) { log(`Could not read ${g.name}: ${e.message}`); continue; }
    const rows = [];
    for (const p of prods) {
      const ed = Object.fromEntries((p.extendedData || []).map(e => [e.name, e.value]));
      const num = String(ed.Number || '').trim();
      if (!num || NOT_CARD.test(p.name) || p.imageCount === 0) continue;
      const name = String(p.name).replace(/\s+-\s+[A-Za-z]*\d+\s*\/\s*\w+.*$/, '').trim();
      rows.push([p.productId, name, num, g.groupId, String(ed.Rarity || '')]);
    }
    byGroup.set(g.groupId, rows);
    cat.sets[g.groupId] = [String(g.name).replace(/^[A-Z]+\d*\w*:\s*/, ''), String(g.abbreviation || ''), String(g.publishedOn || '').slice(0, 10)];
    fetched++;
    await sleep(120);
  }
  cat.cards = [].concat(...[...byGroup.entries()].filter(([gid]) => cat.sets[gid]).map(([, r]) => r));
  write(catPath, JSON.stringify(cat));
  log(`Catalog: ${cat.cards.length} cards in ${Object.keys(cat.sets).length} sets (${fetched} sets read this run).`);
}

// prices for every card in the catalog
const want = new Set(cat.cards.map(c => c[0]));
const best = new Map();
for (const gid of Object.keys(cat.sets)) {
  try {
    const j = await getJSON(`${Base}/tcgplayer/3/${gid}/prices`, 2);
    for (const r of j.results || []) {
      const id = Number(r.productId); if (!want.has(id) || r.marketPrice == null) continue;
      const sub = String(r.subTypeName ?? ''), cur = best.get(id), rank = s => { const i = Preferred.indexOf(s); return i < 0 ? 99 : i; };
      if (!cur || rank(sub) < rank(cur.sub)) best.set(id, { sub, v: Math.round(r.marketPrice * 100) / 100 });
    }
  } catch (e) { log(`Prices for set ${gid} failed: ${e.message}`); }
  await sleep(120);
}
if (best.size > 1000) {
  const p = {}; for (const [k, b] of best) p[k] = b.v;
  write(pricePath, JSON.stringify({ d: new Date().toISOString().slice(0, 10), p }));
  log(`Prices saved for ${best.size} of ${want.size} cards.`);
} else log(`Only ${best.size} prices came back; kept the previous price file.`);
