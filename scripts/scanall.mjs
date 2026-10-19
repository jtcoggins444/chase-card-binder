// Chase Card Binder - scanner fingerprints for every card in data/allcards.json that isn't in the checklist
// (the checklist's own fingerprints stay in data/scanindex.json). Split into one file per release year, so a new
// set only changes the current year's file and phones keep the rest cached.
//  data/scan/<year>.json : {v, f: {productId: [colourB64, lumB64]}}
//  data/scan/manifest.json: {v, shards: {<year>: {n, h}}}
// Usage: node scripts/scanall.mjs [maxNewCards]   (needs: npm i --no-save pngjs jpeg-js)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
require(join(Root, 'scanfeat.js'));
const SF = globalThis.ScanFeat;
const Dir = join(Root, 'data/scan');
mkdirSync(Dir, { recursive: true });
const cat = JSON.parse(readFileSync(join(Root, 'data/allcards.json'), 'utf8'));
const checklistPids = new Set(JSON.parse(readFileSync(join(Root, 'data/cards.json'), 'utf8')).cards.map(c => Number(c[6])).filter(Boolean));
const MAX = Number(process.argv[2] || 9000);
const year = gid => (cat.sets[gid] && cat.sets[gid][2] || '0000').slice(0, 4);

const shards = {};
for (const f of readdirSync(Dir)) if (/^\d{4}\.json$/.test(f)) {
  const j = JSON.parse(readFileSync(join(Dir, f), 'utf8'));
  if (j.v === SF.VERSION) shards[f.slice(0, 4)] = j.f;
}
const known = new Map();   // pid -> year it is stored under
for (const [y, f] of Object.entries(shards)) for (const k of Object.keys(f)) known.set(Number(k), y);

const want = cat.cards.filter(c => !checklistPids.has(c[0]));
const todo = want.filter(c => !known.has(c[0])).slice(0, MAX);
console.log(`${want.length} catalog cards outside the checklist; ${todo.length} need a fingerprint this run.`);

function decode(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) { const p = PNG.sync.read(buf); return { px: p.data, w: p.width, h: p.height }; }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 }); return { px: j.data, w: j.width, h: j.height };
}
let done = 0, failed = 0;
const changed = new Set();
async function one(c) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(`https://tcgplayer-cdn.tcgplayer.com/product/${c[0]}_200w.jpg`, { headers: { 'User-Agent': 'ChaseCardBinder/1.0 (personal card scanner index)' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404 || r.status === 403) { failed++; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { px, w, h } = decode(Buffer.from(await r.arrayBuffer()));
      if (w < 100 || h < 140 || h / w < 1.2) { failed++; return; }   // not a card-shaped picture
      const y = year(c[3]);
      (shards[y] = shards[y] || {})[c[0]] = [SF.toB64(SF.feature(px, w, h)), SF.toB64(SF.packLum(SF.lumFeature(px, w, h)))];
      changed.add(y); done++;
      if (done % 1000 === 0) console.log(`  ${done} done`);
      return;
    } catch (e) { if (t === 2) failed++; else await new Promise(r => setTimeout(r, 1500)); }
  }
}
const q = [...todo];
await Promise.all(Array.from({ length: 10 }, async () => { while (q.length) await one(q.shift()); }));

// drop cards that left the catalog or joined the checklist
const keep = new Set(want.map(c => c[0]));
for (const [y, f] of Object.entries(shards)) for (const k of Object.keys(f)) if (!keep.has(Number(k))) { delete f[k]; changed.add(y); }

const manifest = { v: SF.VERSION, shards: {} };
for (const [y, f] of Object.entries(shards)) {
  const n = Object.keys(f).length, p = join(Dir, y + '.json');
  if (!n) { if (existsSync(p)) unlinkSync(p); continue; }
  const text = JSON.stringify({ v: SF.VERSION, f });
  if (changed.has(y) || !existsSync(p)) writeFileSync(p, text);
  manifest.shards[y] = { n, h: createHash('sha1').update(text).digest('hex').slice(0, 10) };
}
writeFileSync(join(Dir, 'manifest.json'), JSON.stringify(manifest));
console.log(`Fingerprinted ${done} cards (${failed} without a usable picture). ${Object.values(manifest.shards).reduce((a, s) => a + s.n, 0)} cards indexed in ${Object.keys(manifest.shards).length} files.`);
