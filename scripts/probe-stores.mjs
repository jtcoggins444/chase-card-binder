// One-off: which card-shop sites can be read (Shopify-style catalogs), and how they list Pokémon singles.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const SITES = (process.env.SITES || 'common-lands.com,packfresh.com,onestoptcg.com').split(',');
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const out = {};
for (const s of SITES) {
  const o = out[s] = {};
  for (const [k, path] of [['home', '/'], ['products', '/products.json?limit=3'], ['search', '/search/suggest.json?q=charizard&resources[type]=product&resources[limit]=5'], ['meta', '/meta.json'], ['collections', '/collections.json?limit=50']]) {
    try {
      const r = await fetch('https://' + s + path, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      o[k] = { status: r.status, url: r.url, shopify: !!(r.headers.get('x-shopid') || r.headers.get('x-shopify-stage') || /cdn\.shopify|Shopify\.shop/.test(t)), binderpos: /binderpos/i.test(t), crystal: /crystalcommerce/i.test(t), tcgpro: /tcgplayerpro|tcgplayer pro/i.test(t), bytes: t.length, sample: k === 'home' ? (t.match(/<title>[^<]*<\/title>/i) || [''])[0] : t.slice(0, 1500) };
    } catch (e) { o[k] = { error: String(e) }; }
  }
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out).slice(0, 2000));
