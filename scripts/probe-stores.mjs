// One-off: save Common Lands' card-view and cart scripts in full, to see the whole signed-in "add" flow.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const home = await (await fetch('https://common-lands.com/apps/search?f_game=Pokemon&tab=raw&frame=4&page=1', { headers: H })).text();
const card = await (await fetch('https://common-lands.com' + home.match(/href="(\/apps\/search\/card\/[^"]+)"/)[1].replace(/&amp;/g,'&'), { headers: H })).text();
writeFileSync('probe/card.html', card);
const srcs = [...new Set([...(home + card).matchAll(/src="((?:https:)?\/\/[^"]+\.js[^"]*)"/g)].map(m => m[1]).concat(['//common-lands.com/cdn/shop/t/12/assets/card-view.js', '//common-lands.com/cdn/shop/t/12/assets/cluster-rails.js']))];
writeFileSync('probe/srcs.txt', srcs.join('\n'));
for (const u of srcs) { const t = await (await fetch('https:' + u, { headers: H })).text(); if (/apps\/search|kiosk|cart\/add/.test(t)) writeFileSync('probe/' + u.split('/').pop().split('?')[0], t); }
writeFileSync('probe/page.html', home);
