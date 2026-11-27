// One-off: Black Friday / Cyber Monday announcements on the shops the Store finder checks (homepage and announcement bar text).
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const SHOPS = ['common-lands.com', 'magicandmonsters.com', 'eternalgameschesterfield.com', 'levelupgamesmd.com', 'sparkysgaming.com', 'tradingcardworld.store', 'onestoptcg.com', 'zulusgames.com', 'retrogamingofdenver.com', 'blackswampgames.com', 'poke-collect.com', 'trollandtoad.com', 'cardmarketplace.com', 'collectorscache.com'];
const out = {};
for (const d of SHOPS) {
  try {
    const r = await fetch('https://' + d + '/', { headers: { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' }, signal: AbortSignal.timeout(20000) });
    const t = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ').replace(/\s+/g, ' ');
    out[d] = [r.status, [...new Set((t.match(/.{0,120}(black friday|cyber monday|bfcm|% off|percent off|sale|promo code|use code|discount|store credit|cash ?back).{0,160}/gi) || []))].slice(0, 12)];
  } catch (e) { out[d] = String(e); }
}
writeFileSync('probe/stores.json', JSON.stringify(out, null, 1));
