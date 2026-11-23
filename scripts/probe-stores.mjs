// One-off: Double Holo events page (cashback events) as the checker sees it.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('probe', { recursive: true });
const H = { 'User-Agent': 'Mozilla/5.0 (personal collection tool)' };
for (const [f, u] of [['events.html', 'https://doubleholo.com/events'], ['terms.html', 'https://doubleholo.com/terms']]) {
  try { const r = await fetch(u, { headers: H }); writeFileSync('probe/' + f, `<!-- ${r.status} -->\n` + await r.text()); } catch (e) { writeFileSync('probe/' + f, 'ERR ' + e); }
}
