// One-off: what a Common Lands singles card page contains (variant ids, add-to-cart form or endpoint).
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const out = {};
const list = await (await fetch('https://common-lands.com/apps/search?f_game=Pokemon&tab=raw&frame=4&page=1', { headers: H })).text();
const href = (list.match(/href="(\/apps\/search\/card\/[^"]+)"/) || [])[1].replace(/&amp;/g, '&');
out.href = href;
const li = list.split('<li class="grid__item">')[1]; out.li = li.slice(0, 3000);
const page = await (await fetch('https://common-lands.com' + href, { headers: H })).text();
out.len = page.length;
out.hits = [...new Set((page.match(/.{0,160}(variant|cart\/add|add-to-cart|data-id|product_id|sku|form action|quick-add|sign in|customer_authentication).{0,200}/gi) || []))].slice(0, 40);
out.forms = (page.match(/<form[^>]*>/gi) || []).slice(0, 10);
out.scripts = [...new Set((page.match(/<script[^>]*src="[^"]+"/gi) || []))].slice(0, 30);
const pj = await fetch('https://common-lands.com' + href.split('?')[0] + '.js', { headers: H }); out.js = pj.status + ' ' + (await pj.text()).slice(0, 500);
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
