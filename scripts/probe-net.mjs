// One-off: Double Holo card page - which requests list a card's asks, and what "add to cart" sends (guest session, nothing bought).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 430, height: 1400 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }); const p = await ctx.newPage();
const reqs = [];
p.on('response', async r => { const u = r.url(); if (/api\.doubleholo|supabase\.co\/(rest|functions)|doubleholo\.com\/api\//.test(u) && !/sentry|card-images|card-data-v2/.test(u)) { let body = ''; try { body = (await r.text()).slice(0, 3000); } catch (e) {} reqs.push({ u: u.slice(0, 400), m: r.request().method(), s: r.status(), h: Object.fromEntries(Object.entries(r.request().headers()).filter(([k]) => /auth|token|session|content-type|x-/i.test(k))), post: (r.request().postData() || '').slice(0, 1000), body }); } });
await p.goto('https://doubleholo.com/card/23469/ceruledge-ex-prismatic-evolutions-147', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await p.waitForTimeout(4000);
const text = (await p.locator('body').innerText()).slice(0, 3000);
const buttons = await p.$$eval('button,a', bs => bs.map(b => b.textContent.trim().slice(0, 40)).filter(t => /cart|buy|add/i.test(t)).slice(0, 20));
const mark = reqs.length; let clicked = '';
for (const sel of ['button:has-text("Add to cart")', 'button:has-text("Add to Cart")', 'button:has-text("Buy")', 'text=Add to cart']) { try { const el = p.locator(sel).first(); if (await el.count()) { await el.click({ timeout: 5000 }); clicked = sel; break; } } catch (e) {} }
await p.waitForTimeout(4000);
const ls = await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, String(localStorage.getItem(k)).slice(0, 200)])));
writeFileSync('probe/net.json', JSON.stringify({ text, buttons, clicked, ls, page: reqs.slice(0, mark), afterClick: reqs.slice(mark) }, null, 1));
await b.close();
