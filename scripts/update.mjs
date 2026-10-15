// Chase Card Binder - nightly price update (runs on GitHub Actions; same logic as the Windows update.ps1)
//  1. Downloads today's TCGplayer prices from TCGCSV (one request per set).
//  2. Saves them as data/days/YYYY-MM-DD.json and refreshes data/latest.json.
//  3. Rebuilds index.html from data/template.html + cards.json + the day files.
// Usage: node scripts/update.mjs [--build-only]
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const Data = join(Root, 'data');
const DaysDir = join(Data, 'days');
const Page = join(Root, 'index.html');
const Base = process.env.BINDER_BASE || 'https://tcgcsv.com';
const Preferred = ['Holofoil', 'Unlimited Holofoil'];
const Headers = { 'User-Agent': 'ChaseCardBinder/1.0 (personal collection price tracker, one pull per day)' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const log = m => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + m);
const read = p => readFileSync(p, 'utf8').replace(/^﻿/, '');
function write(p, text) { writeFileSync(p + '.tmp', text, 'utf8'); renameSync(p + '.tmp', p); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getText(url, tries = 1, wait = 30) {
  for (let n = 1; ; n++) {
    try {
      const r = await fetch(url, { headers: Headers, signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (n >= tries) throw e;
      await sleep(wait * 1000);
    }
  }
}
function num(x) {
  if (x === null || x === undefined || typeof x === 'string' || !isFinite(x)) return 'null';
  return String(Math.round(x * 100) / 100);
}

// ---- New sets: add chase cards from sets released after the checklist was built ----
const RARITY = {
  'Illustration Rare': 'IR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'FA', 'Hyper Rare': 'HR',
  'Mega Hyper Rare': 'MHR', 'Black White Rare': 'BWR', 'Mega Attack Rare': 'MAR'
};
const SKIP_SET = /promo|collection|celebration|energies|trainer kit|battle academy|mcdonald|trick or trade|deck|bundle|placement|blister|first partner|miscellaneous|world championship|jumbo|code card/i;
const SERIES = { ME: 'Mega Evolution', SV: 'Scarlet & Violet', SWSH: 'Sword & Shield', SM: 'Sun & Moon', XY: 'XY', BW: 'Black & White' };

async function discoverSets(day) {
  const cfgPath = join(Data, 'newsets.json');
  const cfg = existsSync(cfgPath) ? JSON.parse(read(cfgPath)) : { after: 24688, ignore: [24722, 24837], sets: {}, log: [] };
  cfg.sets = cfg.sets || {}; cfg.log = cfg.log || []; cfg.ignore = cfg.ignore || [];
  const groupsFile = JSON.parse(read(join(Data, 'groups.json')));
  const known = new Set(groupsFile.groups.map(Number));
  const all = JSON.parse(await getText(`${Base}/tcgplayer/3/groups`, 3, 20)).results || [];
  const cands = all.filter(g => (g.groupId > cfg.after || cfg.sets[g.groupId]) && !cfg.ignore.includes(g.groupId) && !SKIP_SET.test(g.name));
  if (!cands.length) return;
  const cardsPath = join(Data, 'cards.json'), pidsPath = join(Data, 'pids.json');
  const cards = JSON.parse(read(cardsPath)), pids = JSON.parse(read(pidsPath));
  const havePid = new Set(cards.cards.map(c => c[6]).filter(Boolean)), haveId = new Set(cards.cards.map(c => c[0]));
  const latestSeries = Object.values(cards.sets).sort((a, b) => a[2].localeCompare(b[2])).pop()[1];
  let added = 0, etbAdded = 0;
  for (const g of cands) {
    let prods;
    try { prods = JSON.parse(await getText(`${Base}/tcgplayer/3/${g.groupId}/products`, 2, 5)).results || []; }
    catch (e) { log(`New-set check: could not read ${g.name}: ${e.message}`); continue; }
    await sleep(150);
    const sid = cfg.sets[g.groupId] || ('g' + g.groupId);
    const fresh = [];
    const denoms = {};
    for (const p of prods) {
      const ed = Object.fromEntries((p.extendedData || []).map(e => [e.name, e.value]));
      const num = String(ed.Number || '');
      const m = num.match(/^([A-Za-z]*)(\d+)\s*\/\s*0*(\d+)$/);
      if (m) denoms[m[3]] = (denoms[m[3]] || 0) + 1;
      const kind = RARITY[ed.Rarity];
      if (!kind) {
        // Flag rarities we don't know yet when they look like chase cards (a Pokémon numbered past the set)
        if (ed.HP && ed.Rarity && /rare/i.test(ed.Rarity) && !/^(Rare|Double Rare|Rare Holo|Holo Rare)$/i.test(ed.Rarity) && m && Number(m[2]) > Number(m[3])) {
          const note = `${day}: ${g.name} has "${ed.Rarity}" cards (e.g. ${p.name}) that the checklist doesn't recognize yet.`;
          if (!cfg.log.includes(note) && !cfg.log.some(l => l.includes(`"${ed.Rarity}"`) && l.includes(g.name))) { cfg.log.push(note); log(note); }
        }
        continue;
      }
      if (!ed.HP) continue;                       // trainer and energy cards are left out of the checklist
      if (havePid.has(p.productId)) continue;
      const n = m ? (m[1] ? m[1] + m[2] : String(Number(m[2]))) : (num.split('/')[0] || String(p.productId));
      let id = `${sid}-${n}`;
      if (haveId.has(id)) id = `${sid}-${n}-${p.productId}`;
      const name = String(p.name).replace(/\s+-\s+[A-Za-z]*\d+\s*\/\s*\d+.*$/, '').trim();
      fresh.push([id, name, sid, n, kind, null, p.productId, 't']);
      havePid.add(p.productId); haveId.add(id);
    }
    // the set's Elite Trainer Boxes, for the ETB tab
    cards.etbs = cards.etbs || [];
    const haveEtb = new Set(cards.etbs.map(e => e[6]));
    for (const p of prods) {
      if (!/elite trainer box/i.test(p.name) || /case|display|\bset of\b|code card|sleeves?\b|deck box|binder|bundle of/i.test(p.name) || haveEtb.has(p.productId)) continue;
      cards.etbs.push(['etb-' + p.productId, String(p.name).trim(), sid, '', 'ETB', null, p.productId, 't']);
      pids.push(p.productId); etbAdded++;
      if (!known.has(g.groupId)) { groupsFile.groups.push(g.groupId); known.add(g.groupId); }
      if (!cards.sets[sid]) cards.sets[sid] = [String(g.name).replace(/^[A-Z]+\d*\w*:\s*/, ''), SERIES[(String(g.name).match(/^([A-Z]+)\d*\w*:/) || [])[1]] || latestSeries, String(g.publishedOn || day).slice(0, 10).replace(/-/g, '/'), 0];
      cfg.sets[g.groupId] = sid;
      const note = `${day}: added ${p.name}.`; cfg.log.push(note); log(note);
    }
    if (!fresh.length) continue;
    if (cards.sets[sid] && !cards.sets[sid][3]) delete cards.sets[sid];   // placeholder made for its ETB
    if (!cards.sets[sid]) {
      const pre = (String(g.name).match(/^([A-Z]+)\d*\w*:/) || [])[1];
      const total = Number(Object.entries(denoms).sort((a, b) => b[1] - a[1])[0]?.[0] || 0);
      cards.sets[sid] = [String(g.name).replace(/^[A-Z]+\d*\w*:\s*/, ''), SERIES[pre] || latestSeries, String(g.publishedOn || day).slice(0, 10).replace(/-/g, '/'), total];
      if (g.abbreviation) cards.sets[sid].push(String(g.abbreviation).toUpperCase());
    }
    cards.cards.push(...fresh);
    for (const c of fresh) pids.push(c[6]);
    if (!known.has(g.groupId)) { groupsFile.groups.push(g.groupId); known.add(g.groupId); }
    cfg.sets[g.groupId] = sid;
    const byKind = {}; fresh.forEach(c => byKind[c[4]] = (byKind[c[4]] || 0) + 1);
    const note = `${day}: added ${fresh.length} cards from ${cards.sets[sid][0]} (${Object.entries(byKind).map(([k, v]) => v + ' ' + k).join(', ')}).`;
    cfg.log.push(note); log(note);
    added += fresh.length;
  }
  cfg.log = cfg.log.slice(-100);
  if (added || etbAdded) {
    write(cardsPath, JSON.stringify(cards));
    write(pidsPath, JSON.stringify(pids));
    write(join(Data, 'groups.json'), JSON.stringify(groupsFile));
  }
  write(cfgPath, JSON.stringify(cfg, null, 1));
}

function buildPage() {
  const files = readdirSync(DaysDir).filter(f => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('No price files in data/days.');
  const days = files.map(f => read(join(DaysDir, f)).trim());
  const m = days[days.length - 1].match(/"u":"([^"]*)"/);
  const updated = m ? m[1] : files[files.length - 1].slice(0, 10);
  const latestPath = join(Data, 'latest.json');
  const latest = existsSync(latestPath) ? read(latestPath).trim() : '{}';
  const hist = '{"pids":' + read(join(Data, 'pids.json')).trim() + ',"days":[' + days.join(',') + '],"latest":' + latest + ',"updated":"' + updated + '"}';
  const cards = read(join(Data, 'cards.json')).trim();
  const [y, mo, d] = updated.slice(0, 10).split('-').map(Number);
  const pdate = `${MONTHS[mo - 1]} ${d}, ${y}`;
  const out = read(join(Data, 'template.html'))
    .split('__DATA__').join(cards.split('</').join('<\\/'))
    .split('__HIST__').join(hist.split('</').join('<\\/'))
    .split('__PDATE__').join(pdate);
  write(Page, out);
  log(`Rebuilt the binder page: ${files.length} days of history, prices from ${pdate}.`);
}

async function main() {
  mkdirSync(DaysDir, { recursive: true });
  if (process.argv.includes('--build-only')) { buildPage(); return; }

  const updated = (await getText(`${Base}/last-updated.txt`, 6)).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(updated)) throw new Error('Unexpected reply from TCGCSV: ' + updated.slice(0, 200));
  const day = updated.slice(0, 10);
  const dayFile = join(DaysDir, day + '.json');
  if (existsSync(dayFile)) { log(`Prices for ${day} are already saved; nothing new from TCGplayer yet.`); return; }

  try { await discoverSets(day); } catch (e) { log('New-set check skipped: ' + e.message); }

  const pids = JSON.parse(read(join(Data, 'pids.json')));
  const index = new Map(pids.map((p, i) => [Number(p), i]));
  const groups = JSON.parse(read(join(Data, 'groups.json'))).groups;

  const best = new Map();
  const failed = [];
  for (const g of groups) {
    try {
      const j = JSON.parse(await getText(`${Base}/tcgplayer/3/${g}/prices`, 2, 5));
      for (const r of j.results || []) {
        const id = Number(r.productId);
        if (!index.has(id)) continue;
        const rec = [r.lowPrice, r.midPrice, r.highPrice, r.marketPrice, r.directLowPrice];
        const sub = String(r.subTypeName ?? '');
        const cur = best.get(id);
        if (!cur) best.set(id, { sub, rec });
        else if (!Preferred.includes(cur.sub) && (Preferred.includes(sub) || (cur.rec[3] == null && rec[3] != null))) best.set(id, { sub, rec });
      }
    } catch (e) {
      failed.push(g);
      log(`Set ${g} could not be downloaded: ${e.message}`);
      if (failed.length >= 8 && best.size === 0) throw new Error('TCGCSV is not returning prices right now; will try again at the next run.');
    }
    await sleep(150);
  }

  if (best.size < Math.min(1000, Math.floor(pids.length * 0.5))) {
    throw new Error(`Only ${best.size} of ${pids.length} cards had prices (failed sets: ${failed.join(', ')}). Nothing was saved.`);
  }

  const vals = pids.map(p => { const b = best.get(Number(p)); return b ? num(b.rec[3]) : 'null'; });
  write(dayFile, '{"d":"' + day + '","u":"' + updated + '","v":[' + vals.join(',') + ']}');

  const latestPath = join(Data, 'latest.json');
  const entries = new Map();
  if (existsSync(latestPath)) {
    for (const [k, v] of Object.entries(JSON.parse(read(latestPath)))) entries.set(k, `"${k}":[${[].concat(v).map(num).join(',')}]`);
  }
  for (const [k, b] of best) entries.set(String(k), `"${k}":[${b.rec.map(num).join(',')}]`);
  write(latestPath, '{' + [...entries.values()].join(',') + '}');

  log(`Saved prices for ${day} for ${best.size} of ${pids.length} cards.` + (failed.length ? ` Sets that failed: ${failed.join(', ')}.` : ''));
  buildPage();
}

main().catch(e => { log('ERROR: ' + e.message); process.exit(1); });
