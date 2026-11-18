// One-off: a shop's kiosk-listed singles (handles "kiosk-..."): how many, by type, and sample Pokémon ones.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const S = (process.env.SITES || 'common-lands.com').split(',')[0];
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const out = { total: 0, kiosk: 0, types: {}, poke: [], pokeCount: 0, avail: 0 };
for (let page = 1; page <= 100; page++) {
  const r = await fetch(`https://${S}/products.json?limit=250&page=${page}`, { headers: H }); if (!r.ok) { out.stop = page + ':' + r.status; break; }
  const ps = (await r.json()).products || []; if (!ps.length) break; out.total += ps.length;
  for (const p of ps) {
    const single = /^kiosk/.test(p.handle) || /#\w+.*\[(near mint|lightly|moderately|heavily|damaged)/i.test(p.title);
    if (!single) continue; out.kiosk++; out.types[p.product_type] = (out.types[p.product_type] || 0) + 1;
    if (/pok/i.test(p.product_type + ' ' + (p.tags || []).join(' ') + ' ' + p.body_html)) { out.pokeCount++; if ((p.variants || []).some(v => v.available)) out.avail++;
      if (out.poke.length < 25) out.poke.push([p.title, p.handle, p.product_type, (p.tags || []).slice(0, 8), (p.variants || []).map(v => [v.id, v.title, v.price, v.available, v.sku]), String(p.body_html || '').replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').slice(0, 260)]); }
  }
  await new Promise(r => setTimeout(r, 300));
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
