// One-off: how shops title their Pokémon singles, where page-by-page reading stops, and whether in-stock collections exist.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const SITES = (process.env.SITES || '').split(',').filter(Boolean);
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const out = {};
for (const s of SITES) {
  const o = out[s] = { lastOk: 0, stop: null, samples: [], cols: {} };
  for (const page of [1, 50, 100, 101, 120]) {
    try { const r = await fetch(`https://${s}/products.json?limit=250&page=${page}`, { headers: H }); if (r.ok) { o.lastOk = page; const j = await r.json(); if (page === 1) for (const p of (j.products || []).filter(p => /pok/i.test(p.product_type + ' ' + (p.tags || []).join(' ') + ' ' + p.vendor)).slice(0, 8)) o.samples.push({ t: p.title, type: p.product_type, vendor: p.vendor, tags: (p.tags || []).slice(0, 8), v: (p.variants || []).slice(0, 3).map(v => [v.title, v.price, v.available, v.sku]), b: String(p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200) }); } else { o.stop = o.stop || (page + ':' + r.status + ' ' + (await r.text()).slice(0, 120)); } } catch (e) { o.stop = String(e); }
  }
  for (const c of ['pokemon-singles-instock', 'pokemon-singles-in-stock', 'pokemon-singles', 'pokemon']) {
    try { const r = await fetch(`https://${s}/collections/${c}/products.json?limit=250&page=1`, { headers: H }); const j = r.ok ? await r.json() : null; o.cols[c] = r.status + ' ' + (j ? (j.products || []).length : '') + (j && j.products && j.products[0] ? ' | ' + j.products[0].title : ''); if (j && j.products && j.products.length && o.samples.length < 8) for (const p of j.products.slice(0, 8)) o.samples.push({ t: p.title, type: p.product_type, tags: (p.tags || []).slice(0, 8), v: (p.variants || []).slice(0, 3).map(v => [v.title, v.price, v.available, v.sku]), b: String(p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200) }); } catch (e) { o.cols[c] = String(e); }
  }
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
