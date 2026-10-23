// One-off check of the PokemonPriceTracker key and the ntfy topic. Saves sample responses (no secrets) to probe/.
import { writeFileSync, mkdirSync } from 'node:fs';
const KEY = process.env.PPT_API_KEY, TOPIC = process.env.NTFY_TOPIC;
mkdirSync('probe', { recursive: true });
const out = { key: !!KEY, topic: !!TOPIC, calls: [] };
async function call(name, path) {
  try {
    const r = await fetch('https://www.pokemonpricetracker.com' + path, { headers: { Authorization: 'Bearer ' + KEY } });
    const hdr = {}; for (const [k, v] of r.headers) if (/^x-/i.test(k)) hdr[k] = v;
    const text = await r.text();
    out.calls.push({ name, path, status: r.status, headers: hdr, bytes: text.length });
    writeFileSync('probe/' + name + '.json', text.slice(0, 400000));
  } catch (e) { out.calls.push({ name, path, error: String(e) }); }
}
if (KEY) {
  await call('card_cm', '/api/v2/cards?tcgPlayerId=517045&includeCardmarket=true');
  await call('card_cm2', '/api/v2/cards?tcgPlayerId=517045&includeBoth=true&limit=1');
  await call('sealed_search', '/api/v2/sealed-products?search=Surging%20Sparks%20Elite%20Trainer%20Box&limit=3');
  await call('sealed_id', '/api/v2/sealed-products?tcgPlayerId=565630&limit=1');
}
if (TOPIC && process.env.SEND_TEST) {
  try {
    const r = await fetch('https://ntfy.sh/' + TOPIC, { method: 'POST', headers: { Title: 'Chase Card Binder', Priority: 'high', Tags: 'white_check_mark', Click: 'https://jtcoggins444.github.io/chase-card-binder/' }, body: 'Test alert: your phone is set up to get deal alerts. Tap to open the app.' });
    out.ntfy = r.status;
  } catch (e) { out.ntfy = String(e); }
}
writeFileSync('probe/summary.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
