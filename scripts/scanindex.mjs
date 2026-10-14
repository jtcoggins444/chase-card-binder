// Chase Card Binder - builds data/scanindex.json: one small "fingerprint" per checklist card for the card scanner.
// Only cards without a fingerprint are downloaded, so after the first run this takes seconds.
// Usage: node scripts/scanindex.mjs   (needs: npm i --no-save pngjs jpeg-js)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
require(join(Root, 'scanfeat.js'));
const SF = globalThis.ScanFeat;
const cards = JSON.parse(readFileSync(join(Root, 'data/cards.json'), 'utf8')).cards;
const out = join(Root, 'data/scanindex.json');
let idx = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
if (idx.v !== SF.VERSION) idx = { v: SF.VERSION, f: {} };

function url(c) {
  const i = c[0].lastIndexOf('-'), sid = c[0].slice(0, i), n = c[0].slice(i + 1);
  if (c[7] === 't') return `https://tcgplayer-cdn.tcgplayer.com/product/${c[6]}_200w.jpg`;
  if (c[7] === 's') return `https://images.scrydex.com/pokemon/${c[0]}/small`;
  return `https://images.pokemontcg.io/${sid}/${n}.png`;
}
function decode(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) { const p = PNG.sync.read(buf); return { px: p.data, w: p.width, h: p.height }; }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true }); return { px: j.data, w: j.width, h: j.height };
}
const todo = cards.filter(c => !idx.f[c[0]]);
console.log(`${todo.length} of ${cards.length} cards need a fingerprint`);
let done = 0, failed = [];
async function one(c) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url(c), { headers: { 'User-Agent': 'ChaseCardBinder/1.0 (personal card scanner index)' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { px, w, h } = decode(Buffer.from(await r.arrayBuffer()));
      idx.f[c[0]] = SF.toB64(SF.feature(px, w, h));
      done++; return;
    } catch (e) { if (t === 2) failed.push(c[0] + ' (' + e.message + ')'); else await new Promise(r => setTimeout(r, 1500)); }
  }
}
const q = [...todo];
await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) await one(q.shift()); }));
// drop fingerprints of cards no longer in the checklist
const ids = new Set(cards.map(c => c[0]));
for (const k of Object.keys(idx.f)) if (!ids.has(k)) delete idx.f[k];
writeFileSync(out, JSON.stringify(idx));
console.log(`Fingerprinted ${done} cards.` + (failed.length ? ` Failed: ${failed.length} (${failed.slice(0, 10).join(', ')})` : ''));
