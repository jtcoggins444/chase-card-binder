// One-off: where a shop keeps its Pokémon singles (collections, search results, sample products).
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const S = (process.env.SITES || 'common-lands.com').split(',')[0];
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const get = async u => { try { const r = await fetch(u, { headers: H }); return { status: r.status, url: r.url, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; } };
const out = { cols: [], search: {}, samples: [], home: '' };
for (let p = 1; p <= 4; p++) { const r = await get(`https://${S}/collections.json?limit=250&page=${p}`); let j; try { j = JSON.parse(r.text); } catch (e) { break; } if (!j.collections || !j.collections.length) break; out.cols.push(...j.collections.map(c => [c.handle, c.title, c.products_count])); }
for (const q of ['charizard ex', 'umbreon', 'pikachu illustration rare']) { const r = await get(`https://${S}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10`); try { out.search[q] = JSON.parse(r.text).resources.results.products.map(p => [p.title, p.type, p.price, p.url, (p.tags || []).slice(0, 6)]); } catch (e) { out.search[q] = r.status + ' ' + r.text.slice(0, 200); } }
const home = await get(`https://${S}/`); out.home = (home.text.match(/href="[^"]*(singles|single|tcg|cards)[^"]*"/gi) || []).slice(0, 40);
for (const h of out.cols.filter(c => /single|pokemon/i.test(c[0] + c[1])).slice(0, 6).map(c => c[0])) { const r = await get(`https://${S}/collections/${h}/products.json?limit=5`); try { for (const p of JSON.parse(r.text).products) out.samples.push([h, p.title, p.product_type, (p.tags || []).slice(0, 6), (p.variants || []).slice(0, 3).map(v => [v.title, v.price, v.available, v.sku]), String(p.body_html || '').replace(/<[^>]+>/g, ' ').slice(0, 160)]); } catch (e) {} }
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
