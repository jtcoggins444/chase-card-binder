// One-off: deals at each shop - loyalty/rewards apps, membership pages, first-order or newsletter discounts, free-shipping thresholds.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const SITES = (process.env.SITES || '').split(',').filter(Boolean);
const H = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' };
const APPS = { 'smile.io': /smile\.io|smile-ui|sweettooth/i, 'LoyaltyLion': /loyaltylion/i, 'Rivo': /rivo\.io|rivo-loyalty/i, 'Yotpo Loyalty': /yotpo[^"']*loyalty|swell/i, 'Growave': /growave/i, 'BON Loyalty': /bon-loyalty|bonloyalty/i, 'Joy Loyalty': /joy-loyalty|avada/i, 'Stamped Rewards': /stamped[^"']*reward/i, 'Gameball': /gameball/i, 'BinderPOS store credit': /binderpos/i };
const out = {};
for (const s of SITES) {
  const o = out[s] = { apps: [], phrases: [], pages: [] };
  try {
    const t = await (await fetch(`https://${s}/`, { headers: H, signal: AbortSignal.timeout(30000) })).text();
    for (const [k, re] of Object.entries(APPS)) if (re.test(t)) o.apps.push(k);
    const txt = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const m of txt.matchAll(/[^.!?|]{0,80}(\d+% off|free shipping (on|over)[^.!?|]{0,30}|use code [A-Z0-9]+|code:? ?[A-Z0-9]{4,}|rewards? (program|points)|points? (per|for every)|loyalty|membership|subscribe[^.!?|]{0,40}off|first order)[^.!?|]{0,80}/gi)) o.phrases.push(m[0].trim());
    o.phrases = [...new Set(o.phrases)].slice(0, 12);
    o.pages = [...new Set((t.match(/href="\/pages\/[^"]*(reward|loyal|member|vip|club|points|discount|deal)[^"]*"/gi) || []))].slice(0, 8);
  } catch (e) { o.err = String(e); }
  for (const pg of o.pages.slice(0, 3)) {
    const path = pg.replace(/^href="|"$/g, '');
    try { const t = await (await fetch(`https://${s}${path}`, { headers: H, signal: AbortSignal.timeout(30000) })).text(); o[path] = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/.{0,2000}(reward|point|member|vip|tier|discount).{0,1500}/i)?.[0] || ''; } catch (e) {}
  }
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
