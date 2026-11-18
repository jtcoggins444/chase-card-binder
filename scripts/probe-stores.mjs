// One-off: can a script read TCGplayer's per-seller listings for a card (seller, rating, price, shipping)?
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)', 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://www.tcgplayer.com', Referer: 'https://www.tcgplayer.com/' };
const out = {};
for (const pid of [226581, 523891]) {
  const body = { filters: { term: { sellerStatus: 'Live', channelId: 0, language: ['English'] }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } }, from: 0, size: 50, sort: { field: 'price+shipping', order: 'asc' }, context: { shippingCountry: 'US', cart: {} }, aggregations: ['listingType'] };
  try { const r = await fetch(`https://mp-search-api.tcgplayer.com/v1/product/${pid}/listings`, { method: 'POST', headers: H, body: JSON.stringify(body) }); const t = await r.text(); out[pid] = { status: r.status, len: t.length, head: t.slice(0, 2500) }; }
  catch (e) { out[pid] = { err: String(e) }; }
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
