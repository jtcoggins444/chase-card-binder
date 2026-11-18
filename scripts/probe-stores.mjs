// One-off: read Common Lands' card-view script to see how a signed-in "add" works.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const out = {};
for (const u of ['https://common-lands.com/cdn/shop/t/12/assets/card-view.js', 'https://common-lands.com/cdn/shop/t/12/assets/cluster-rails.js']) {
  const t = await (await fetch(u, { headers: H })).text();
  out[u] = { len: t.length, hits: [...new Set((t.match(/.{0,220}(fetch\(|\/apps\/|cart\/add|\/cart|reserve|hold|variant|method:|POST).{0,260}/g) || []))].slice(0, 40) };
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
