// Chase Card Binder - TCGplayer Mass Entry lines for the app's "TCGplayer cart" button.
// Mass Entry only matches a line written exactly as TCGplayer names the product: "Full product name [SET CODE] number"
// (newer sets keep " - 199/167" inside the name). Writes data/massentry.json: {cardId: line}.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const Root = join(dirname(fileURLToPath(import.meta.url)), '..'), Data = join(Root, 'data');
const Base = process.env.BINDER_BASE || 'https://tcgcsv.com';
const Headers = { 'User-Agent': 'ChaseCardBinder/1.0 (personal collection price tracker)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) { for (let t = 0; ; t++) { try { const r = await fetch(url, { headers: Headers, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (t >= 2) throw e; await sleep(4000); } } }
const cards = JSON.parse(readFileSync(join(Data, 'cards.json'), 'utf8'));
const all = cards.cards.concat(cards.etbs || []);
const want = new Map(all.filter(c => c[6]).map(c => [Number(c[6]), c[0]]));
const groups = JSON.parse(readFileSync(join(Data, 'groups.json'), 'utf8')).groups;
const abbr = new Map(((await get(`${Base}/tcgplayer/3/groups`)).results || []).map(g => [g.groupId, String(g.abbreviation || '').trim()]));
const out = {};
for (const g of groups) {
  let prods;
  try { prods = (await get(`${Base}/tcgplayer/3/${g}/products`)).results || []; } catch (e) { console.log(`group ${g}: ${e.message}`); continue; }
  const code = abbr.get(Number(g));
  for (const p of prods) {
    const id = want.get(Number(p.productId)); if (!id || !code) continue;
    const ed = Object.fromEntries((p.extendedData || []).map(e => [e.name, e.value]));
    const num = String(ed.Number || '').trim();
    out[id] = `${String(p.name).trim()} [${code}]${num ? ' ' + num : ''}`;
  }
  await sleep(120);
}
writeFileSync(join(Data, 'massentry.json.tmp'), JSON.stringify(out)); renameSync(join(Data, 'massentry.json.tmp'), join(Data, 'massentry.json'));
console.log(`Mass Entry lines for ${Object.keys(out).length} of ${all.length} cards and sealed products.`);
