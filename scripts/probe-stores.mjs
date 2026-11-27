// One-off: Common Lands Black Friday pages (what's on sale, whether singles are included).
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const txt = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ').replace(/\s+/g, ' ');
const home = await (await fetch('https://common-lands.com/', { headers: H })).text();
const links = [...new Set([...home.matchAll(/href="([^"]*(black|friday|bfcm|bazaar|sale)[^"]*)"/gi)].map(m => m[1]))].slice(0, 15);
const out = { links, pages: {} };
for (const l of links.slice(0, 6)) { const u = l.startsWith('http') ? l : 'https://common-lands.com' + l; try { const t = txt(await (await fetch(u, { headers: H })).text()); out.pages[u] = t.slice(0, 3000); } catch (e) { out.pages[u] = String(e); } }
for (const h of ['black-friday-sale', 'black-friday', 'pokemon-black-friday-sale']) { try { const r = await fetch(`https://common-lands.com/collections/${h}/products.json?limit=250`, { headers: H }); if (r.ok) { const j = await r.json(); out[h] = j.products.map(p => [p.title, p.product_type, p.variants[0].price, p.variants[0].compare_at_price]).slice(0, 80); } else out[h] = r.status; } catch (e) { out[h] = String(e); } }
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
