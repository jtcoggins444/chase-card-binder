// One-off: Double Holo cashback feed and the marketplace search index (fields, set names).
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const out = {};
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)', Origin: 'https://doubleholo.com', Referer: 'https://doubleholo.com/' };
for (const u of ['https://api.doubleholo.com/api/v1/cashback/live']) { try { const r = await fetch(u, { headers: H }); out[u] = [r.status, (await r.text()).slice(0, 6000)]; } catch (e) { out[u] = String(e); } }
const A = 'https://w5sf479zkl-dsn.algolia.net/1/indexes/*/queries', K = { 'x-algolia-api-key': '50fdd89ab8d777151bc000bba6097357', 'x-algolia-application-id': 'W5SF479ZKL', 'Content-Type': 'application/json', ...H };
const q = async reqs => { const r = await fetch(A, { method: 'POST', headers: K, body: JSON.stringify({ requests: reqs }) }); return [r.status, await r.text()]; };
let [s, t] = await q([{ indexName: 'production_cards', query: '', hitsPerPage: 2, attributesToRetrieve: ['*'], facetFilters: [['set_name:Pokemon Prismatic Evolutions']] }]);
out.hit = [s, t.slice(0, 5000)];
[s, t] = await q([{ indexName: 'production_cards', query: '', hitsPerPage: 0, facets: ['set_name', 'era', 'language'], maxValuesPerFacet: 1000, filters: 'NOT is_sealed:true' }]);
out.facets = [s, t.slice(0, 60000)];
[s, t] = await q([{ indexName: 'production_cards', query: '', hitsPerPage: 1000, attributesToRetrieve: ['name', 'number', 'printed_number', 'lowest_ask', 'current_market_price', 'active_asks_count', 'slug', 'language', 'rarity'], facetFilters: [['set_name:Pokemon Prismatic Evolutions']], filters: 'NOT is_sealed:true' }]);
out.page = [s, t.length, t.slice(0, 1500)];
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
