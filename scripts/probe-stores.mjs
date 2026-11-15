// One-off: sample how card shops on Shopify list Pokémon singles (titles, types, tags, variants), plus catalog size.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const SITES = (process.env.SITES || 'common-lands.com,onestoptcg.com').split(',');
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const out = {};
for (const s of SITES) {
  const o = out[s] = { pages: 0, products: 0, types: {}, vendors: {}, poke: [], t0: Date.now() };
  for (let page = 1; page <= 400; page++) {
    let j;
    try { const r = await fetch(`https://${s}/products.json?limit=250&page=${page}`, { headers: H, signal: AbortSignal.timeout(30000) }); if (!r.ok) { o.err = r.status + ' at page ' + page; break; } j = await r.json(); } catch (e) { o.err = String(e); break; }
    const ps = j.products || []; if (!ps.length) break;
    o.pages = page; o.products += ps.length;
    for (const p of ps) {
      o.types[p.product_type] = (o.types[p.product_type] || 0) + 1; o.vendors[p.vendor] = (o.vendors[p.vendor] || 0) + 1;
      if (/pok/i.test(p.product_type + ' ' + p.vendor + ' ' + (p.tags || []).join(' ')) && o.poke.length < 40 && Math.random() < 0.05)
        o.poke.push({ title: p.title, type: p.product_type, vendor: p.vendor, tags: p.tags, body: String(p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 250), variants: (p.variants || []).map(v => [v.title, v.price, v.available, v.sku]).slice(0, 6), handle: p.handle });
    }
    await new Promise(r => setTimeout(r, 400));
  }
  o.secs = Math.round((Date.now() - o.t0) / 1000);
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
for (const [s, o] of Object.entries(out)) console.log(s, o.pages, o.products, o.err || '', o.secs + 's');
