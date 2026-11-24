// One-off: Paldean Fates products (shiny rares #092-211) with market prices, from tcgcsv.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const get = async u => { try { return await (await fetch(u, { headers: { 'User-Agent': 'binder-bot' } })).json(); } catch (e) { return { results: [], err: String(e) }; } };
const groups = (await get('https://tcgcsv.com/tcgplayer/3/groups')).results || [];
const g = groups.filter(x => /paldean fates/i.test(x.name));
const out = { groups: g.map(x => [x.groupId, x.name]), cards: [] };
for (const x of g) {
  const P = (await get(`https://tcgcsv.com/tcgplayer/3/${x.groupId}/products`)).results || [];
  const pr = new Map(); for (const y of ((await get(`https://tcgcsv.com/tcgplayer/3/${x.groupId}/prices`)).results || [])) { const o = pr.get(y.productId); if (!o || y.subTypeName === 'Holofoil') pr.set(y.productId, y.marketPrice); }
  for (const p of P) { const e = Object.fromEntries((p.extendedData || []).map(z => [z.name, z.value])); if (e.Number) out.cards.push([x.groupId, p.productId, p.name, e.Number, e.Rarity, e.HP ? 1 : 0, pr.get(p.productId) ?? null]); }
}
writeFileSync('probe/stores.json', JSON.stringify(out));
