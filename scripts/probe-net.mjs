// One-off: Double Holo - does ?query= search work, and which request lists a card's asks by condition.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 430, height: 1400 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' })).newPage();
const reqs = [];
p.on('response', async r => { const u = r.url(); if (/api\.doubleholo|algolia\.net|supabase\.co\/rest|\/api\//.test(u) && !/insights|sentry|card-images/.test(u)) { let body = ''; try { body = (await r.text()).slice(0, 2500); } catch (e) {} reqs.push({ u: u.slice(0, 400), m: r.request().method(), s: r.status(), post: (r.request().postData() || '').slice(0, 800), body }); } });
await p.goto('https://doubleholo.com/marketplace?preset=cards&has_listings=true&query=Ceruledge%20ex%20147', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await p.waitForTimeout(3000);
const t1 = (await p.locator('body').innerText()).slice(0, 1200), u1 = p.url();
const hrefs = await p.$$eval('a', as => as.map(a => a.href).filter(h => /doubleholo\.com\//.test(h) && !/marketplace\?|events|pricing|terms|login|signup/.test(h)).slice(0, 25));
const mark = reqs.length;
const target = hrefs.find(h => /ceruledge/i.test(h)) || null;
if (target) { await p.goto(target, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {}); await p.waitForTimeout(4000); }
const t2 = (await p.locator('body').innerText()).slice(0, 2500), u2 = p.url();
writeFileSync('probe/net.json', JSON.stringify({ u1, t1, hrefs, target, u2, t2, search: reqs.slice(0, mark).map(r => ({ u: r.u, post: r.post.slice(0, 500) })), card: reqs.slice(mark) }, null, 1));
await b.close();
