// One-off: 30th Celebration Pikachus and the promo sets' cards (names, numbers, rarity, prices) from tcgcsv.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const get = async u => { try { const r = await fetch(u, { headers: { 'User-Agent': 'binder-bot' } }); return await r.json(); } catch (e) { return { results: [], err: String(e) }; } };
const groups = (await get('https://tcgcsv.com/tcgplayer/3/groups')).results || [];
const promo = groups.filter(g => /promo/i.test(g.name) && !/japan/i.test(g.name));
const out = { promoGroups: promo.map(g => [g.groupId, g.name, g.publishedOn]), groups: {} };
out.errs = []; try { for (const g of [...promo.map(g => g.groupId), 24722, 24837]) {
  const P = (await get(`https://tcgcsv.com/tcgplayer/3/${g}/products`)).results || [];
  const pr = new Map(); for (const x of ((await get(`https://tcgcsv.com/tcgplayer/3/${g}/prices`)).results || [])) { const o = pr.get(x.productId); if (!o || x.subTypeName === 'Holofoil') pr.set(x.productId, x.marketPrice); }
  out.groups[g] = P.filter(p => (p.extendedData || []).some(e => e.name === 'Number')).map(p => { const e = Object.fromEntries((p.extendedData || []).map(x => [x.name, x.value])); return [p.productId, p.name, e.Number, e.Rarity, e.CardType, e.HP ? 1 : 0, pr.get(p.productId) ?? null, p.imageUrl ? 1 : 0, (e.Stage || '')]; });
  await new Promise(r => setTimeout(r, 300));
} } catch (e) { out.errs.push(String(e.stack || e)); }
writeFileSync('probe/stores.json', JSON.stringify(out));
