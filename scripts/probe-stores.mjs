// One-off: find Rookie Legends' site and any Black Friday sale text.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const txt = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;/g, ' ').replace(/\s+/g, ' ');
const out = {};
for (const d of ['rookielegends.com', 'www.rookielegends.com', 'rookielegendstcg.com', 'rookielegends.store', 'rookielegendscards.com', 'shoprookielegends.com', 'rookie-legends.com', 'rookielegends.shop']) {
  try { const r = await fetch('https://' + d + '/', { headers: H, signal: AbortSignal.timeout(15000) }); const h = await r.text(); const t = txt(h);
    let meta = null; try { const m = await fetch('https://' + d + '/meta.json', { headers: H, signal: AbortSignal.timeout(10000) }); if (m.ok) meta = await m.json(); } catch (e) {}
    out[d] = { s: r.status, url: r.url, title: (h.match(/<title>([^<]*)/i) || [])[1], meta: meta && { name: meta.name, city: meta.city, country: meta.country, pub: meta.published_products_count }, sale: [...new Set((t.match(/.{0,120}(black friday|cyber|bfcm|% off|use code|promo code|sitewide|storewide|store credit|cash ?back).{0,180}/gi) || []))].slice(0, 10), head: t.slice(0, 600) };
  } catch (e) { out[d] = String(e).slice(0, 100); }
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
