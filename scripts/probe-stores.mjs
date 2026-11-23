// One-off: Double Holo - full fields of a card in the search index, and where a card's asks (by condition) come from.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)', Origin: 'https://doubleholo.com', Referer: 'https://doubleholo.com/', Accept: 'application/json' };
const out = {};
const A = 'https://w5sf479zkl-dsn.algolia.net/1/indexes/*/queries', K = { 'x-algolia-api-key': '50fdd89ab8d777151bc000bba6097357', 'x-algolia-application-id': 'W5SF479ZKL', 'Content-Type': 'application/json', ...H };
const q = async reqs => { const r = await fetch(A, { method: 'POST', headers: K, body: JSON.stringify({ requests: reqs }) }); return [r.status, (await r.text()).slice(0, 6000)]; };
out.full = await q([{ indexName: 'production_cards', query: '', hitsPerPage: 1, attributesToRetrieve: ['*'], facetFilters: [['set_name:Pokemon Prismatic Evolutions']], filters: 'objectID:23469' }]);
for (const ix of ['production_listings', 'production_asks', 'production_card_listings', 'production_cards_listings']) out[ix] = await q([{ indexName: ix, query: '', hitsPerPage: 2 }]);
for (const u of ['https://api.doubleholo.com/api/v1/cards/23469', 'https://api.doubleholo.com/api/v1/cards/23469/asks', 'https://api.doubleholo.com/api/v1/cards/23469/listings', 'https://api.doubleholo.com/api/v1/asks?card_id=23469', 'https://api.doubleholo.com/api/v1/listings?card_id=23469', 'https://api.doubleholo.com/api/v1/marketplace/cards/23469', 'https://doubleholo.com/pokemon/sets', 'https://doubleholo.com/sitemap.xml']) {
  try { const r = await fetch(u, { headers: H }); out[u] = [r.status, (await r.text()).slice(0, 3000)]; } catch (e) { out[u] = String(e); }
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
