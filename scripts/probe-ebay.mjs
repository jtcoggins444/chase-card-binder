// One-off: list eBay's filter names/values (aspects) for Pokémon singles, raw and graded, so app links can filter by condition.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const ID = process.env.EBAY_CLIENT_ID, SECRET = process.env.EBAY_CLIENT_SECRET;
const t = await (await fetch('https://api.ebay.com/identity/v1/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(ID + ':' + SECRET).toString('base64') }, body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope') })).json();
const out = {};
for (const [name, cond] of [['raw', '4000'], ['graded', '2750']]) {
  const u = 'https://api.ebay.com/buy/browse/v1/item_summary/search?' + new URLSearchParams({ q: 'charizard', category_ids: '183454', filter: `conditionIds:{${cond}}`, fieldgroups: 'ASPECT_REFINEMENTS,CONDITION_REFINEMENTS', limit: '1' });
  const j = await (await fetch(u, { headers: { Authorization: 'Bearer ' + t.access_token, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } })).json();
  const r = j.refinement || {};
  out[name] = { cond: r.conditionDistributions, aspects: (r.aspectDistributions || []).map(a => ({ name: a.localizedAspectName, values: (a.aspectValueDistributions || []).map(v => v.localizedAspectValue + ' (' + v.matchCount + ')').slice(0, 40) })) };
}
writeFileSync('probe/ebay-aspects.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out).slice(0, 3000));
