// One-off: Common Lands' singles search (app proxy): page structure and paging.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const out = {};
for (const q of ['f_game=Pokemon&tab=raw&frame=4', 'f_game=Pokemon&tab=raw&frame=4&page=2', 'f_game=Pokemon&tab=raw&frame=4&page=40', 'f_game=Pokemon&tab=raw&frame=4&q=charizard']) {
  try { const r = await fetch('https://common-lands.com/apps/search?' + q, { headers: H }); const t = await r.text(); out[q] = { status: r.status, len: t.length, head: t.slice(0, 9000), tail: t.slice(-3000) }; } catch (e) { out[q] = String(e); }
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
