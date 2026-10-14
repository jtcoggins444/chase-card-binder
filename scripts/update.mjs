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
