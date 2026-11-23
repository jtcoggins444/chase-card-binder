// One-off: Double Holo card record (all keys, asks by condition?) and the card page URL format.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)', Origin: 'https://doubleholo.com', Referer: 'https://doubleholo.com/', Accept: 'application/json' };
const out = {};
const j = await (await fetch('https://api.doubleholo.com/api/v1/cards/23469', { headers: H })).json();
const walk = (o, p = '') => { if (Array.isArray(o)) return { [p]: `array(${o.length})`, ...(o[0] && typeof o[0] === 'object' ? walk(o[0], p + '[0]') : {}) }; if (o && typeof o === 'object') return Object.assign({}, ...Object.entries(o).map(([k, v]) => v && typeof v === 'object' ? walk(v, p + '.' + k) : { [p + '.' + k]: String(v).slice(0, 80) })); return {}; };
out.keys = walk(j);
const sm = await (await fetch('https://doubleholo.com/sitemap-cards-priority.xml', { headers: H })).text();
out.locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].slice(0, 8).map(m => m[1]);
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
