// One-off: save Common Lands' card-view and cart scripts in full, to see the whole signed-in "add" flow.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
const home = await (await fetch('https://common-lands.com/apps/search?f_game=Pokemon&tab=raw&frame=4&page=1', { headers: H })).text();
const srcs = [...new Set((home.match(/\/\/common-lands\.com\/cdn\/shop\/t\/\d+\/assets\/[a-z0-9_.-]+\.js/gi) || []))];
writeFileSync('probe/srcs.txt', srcs.join('\n'));
for (const u of srcs) { const t = await (await fetch('https:' + u, { headers: H })).text(); if (/apps\/search|kiosk|cart\/add/.test(t)) writeFileSync('probe/' + u.split('/').pop(), t); }
writeFileSync('probe/page.html', home);
