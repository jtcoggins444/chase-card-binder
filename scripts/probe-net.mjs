// One-off: open a shop page in a real browser, tap "Raw Singles", and record the data requests the page makes.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const URL0 = process.env.URL0 || 'https://common-lands.com/';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 430, height: 1400 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' })).newPage();
const reqs = [];
p.on('response', async r => { const u = r.url(), ct = r.headers()['content-type'] || ''; if (/json|graphql/i.test(ct) || /api|search|graphql|singles|inventory/i.test(u)) { let body = ''; try { body = (await r.text()).slice(0, 1500); } catch (e) {} reqs.push({ u: u.slice(0, 400), m: r.request().method(), s: r.status(), ct, post: (r.request().postData() || '').slice(0, 600), body }); } });
await p.goto(URL0, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
const links = await p.$$eval('a', as => as.map(a => [a.textContent.trim().slice(0, 40), a.href]).filter(x => /single/i.test(x.join(' '))).slice(0, 20));
let clicked = '';
for (const sel of ['text=Raw Singles', 'a:has-text("Singles")', 'button:has-text("Singles")']) { try { const el = p.locator(sel).first(); if (await el.count()) { await el.click({ timeout: 5000 }); clicked = sel; break; } } catch (e) {} }
await p.waitForTimeout(6000);
const url1 = p.url(); const text = (await p.locator('body').innerText()).slice(0, 2000);
writeFileSync('probe/net.json', JSON.stringify({ links, clicked, url1, text, reqs: reqs.filter(r => !/shopify\.com\/(s\/|cdn)|analytics|monorail|trekkie|klaviyo|google|facebook|tiktok/i.test(r.u)).slice(0, 60) }, null, 1));
await b.close();
