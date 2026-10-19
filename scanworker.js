// Chase Card Binder - scanner engine (runs in a background worker so the camera stays smooth).
// Holds the artwork fingerprints of every card (checklist + every other English card) and matches camera frames
// against them in three passes: a coarse pass over everything, a full pass over the best few hundred, and a fine
// pass (glare-tolerant colour + fine brightness detail) over the best 60.
/* global ScanFeat */
'use strict';
importScripts('scanfeat.js');
const SF = ScanFeat;
const GW = SF.GW, GH = SF.GH, N = GW * GH, D = N * 3, LN = 24 * 18;
const CW = 6, CH = 3, CN = CW * CH, CD = CN * 3;   // coarse grid (pooled 2 x 3 cells)
const CAP = 80, LUMW = 2.5;

let ids = [], F = null, CF = null, L = null, n = 0, ready = null;

function pool(v, out, o) {   // 12x9 comparison vector -> 6x3 coarse vector
  for (let ch = 0; ch < 3; ch++) for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    let s = 0;
    for (let y = cy * 3; y < cy * 3 + 3; y++) for (let x = cx * 2; x < cx * 2 + 2; x++) s += v[ch * N + y * GW + x];
    out[o + ch * CN + cy * CW + cx] = s / 6;
  }
}

async function getJSON(url, key) {
  // keep big, rarely changing files in the Cache API so they're downloaded once
  if (key && self.caches) {
    try {
      const cache = await caches.open('binder-scan-v1');
      const hit = await cache.match(key);
      if (hit) return hit.json();
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(url + ' ' + r.status);
      const copy = r.clone(); await cache.put(key, copy);
      // remove older copies of the same file
      for (const req of await cache.keys()) { const u = new URL(req.url); const base = key.split('?')[0]; if (u.pathname.endsWith(base.replace(/^\.?\//, '')) && req.url !== new URL(key, self.location).href) cache.delete(req); }
      return r.json();
    } catch (e) { /* fall through to a plain download */ }
  }
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

async function load(base, withAll) {
  const parts = [];
  const main = await getJSON(base + 'data/scanindex.json');
  parts.push([main.f || {}, '']);
  postMessage({ t: 'progress', loaded: Object.keys(main.f || {}).length });
  if (withAll) {
    try {
      const man = await getJSON(base + 'data/scan/manifest.json');
      if (man.v === SF.VERSION) {
        const ys = Object.keys(man.shards).sort().reverse();
        let got = Object.keys(main.f || {}).length;
        // newest years first, a few at a time
        for (let i = 0; i < ys.length; i += 4) {
          const batch = await Promise.all(ys.slice(i, i + 4).map(y => getJSON(base + 'data/scan/' + y + '.json?h=' + man.shards[y].h, 'data/scan/' + y + '.json?h=' + man.shards[y].h).then(j => j.f || {}).catch(() => ({}))));
          for (const f of batch) { parts.push([f, 'p']); got += Object.keys(f).length; }
          postMessage({ t: 'progress', loaded: got });
        }
      }
    } catch (e) { postMessage({ t: 'note', text: 'Only checklist cards could be loaded: ' + e.message }); }
  }
  n = parts.reduce((a, [f]) => a + Object.keys(f).length, 0);
  F = new Int16Array(n * D); CF = new Int16Array(n * CD); L = new Int8Array(n * LN); ids = new Array(n);
  const tmp = new Float32Array(CD);
  let i = 0;
  for (const [f, pre] of parts) for (const [k, b] of Object.entries(f)) {
    const v = SF.norm(SF.fromB64(b[0]));
    for (let j = 0; j < D; j++) F[i * D + j] = Math.round(v[j] * 4);
    pool(v, tmp, 0); for (let j = 0; j < CD; j++) CF[i * CD + j] = Math.round(tmp[j] * 4);
    if (b[1]) { const l = SF.unpackLum(SF.fromB64(b[1])); for (let j = 0; j < LN; j++) { const x = Math.round(l[j] * 40); L[i * LN + j] = x > 127 ? 127 : x < -127 ? -127 : x; } }
    ids[i] = pre + k; i++;
  }
  return n;
}

// ---- distances against stored entry e (vectors stored x4) ----
function structure(p, e) {
  const o = e * D; let t = 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW - 1; x++) { const i = y * GW + x; let d = (p[i + 1] - p[i]) - (F[o + i + 1] - F[o + i]) / 4; if (d < 0) d = -d; t += d < CAP ? d : CAP; }
  for (let y = 0; y < GH - 1; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; let d = (p[i + GW] - p[i]) - (F[o + i + GW] - F[o + i]) / 4; if (d < 0) d = -d; t += d < CAP ? d : CAP; }
  return t / N;
}
function dist(p, e) {
  const o = e * D; let s = 0;
  for (let c = 0; c < N; c++) {
    let a = p[c] - F[o + c] / 4, b = p[N + c] - F[o + N + c] / 4, g = p[2 * N + c] - F[o + 2 * N + c] / 4;
    const d = (a < 0 ? -a : a) + (b < 0 ? -b : b) + (g < 0 ? -g : g);
    s += d < CAP ? d : CAP;
  }
  return s / N + structure(p, e);
}
const cells = new Float32Array(N);
function distRobust(p, e) {
  const o = e * D;
  for (let c = 0; c < N; c++) cells[c] = Math.abs(p[c] - F[o + c] / 4) + Math.abs(p[N + c] - F[o + N + c] / 4) + Math.abs(p[2 * N + c] - F[o + 2 * N + c] / 4);
  cells.sort();
  const k = Math.round(N * 0.7); let s = 0; for (let c = 0; c < k; c++) s += cells[c];
  return s / k + structure(p, e);
}
function coarse(q, e) {
  const o = e * CD; let s = 0;
  for (let j = 0; j < CD; j++) { let d = q[j] - CF[o + j] / 4; if (d < 0) d = -d; s += d < 60 ? d : 60; }
  return s;
}
function corrL(l, e) { const o = e * LN; let s = 0; for (let j = 0; j < LN; j++) s += l[j] * L[o + j]; return s / LN / 40; }
function hasL(e) { const o = e * LN; for (let j = 0; j < 8; j++) if (L[o + j]) return true; return false; }

// Card-shaped boxes to try around a guess [x, y, w, h].
function boxesAround(b, W, H, scales, shifts) {
  const out = [];
  for (const s of scales) for (const dx of shifts) for (const dy of shifts) {
    const w = b[2] * s, h = b[3] * s, x = b[0] + (b[2] - w) / 2 + dx * b[2], y = b[1] + (b[3] - h) / 2 + dy * b[3];
    if (x < -w * 0.03 || y < -h * 0.03 || x + w > W + w * 0.03 || y + h > H + h * 0.03) continue;
    out.push([x, y, w, h]);
  }
  return out;
}

function match(imgs, guesses, opts) {
  // imgs: {a: {px, w, h}} for each tilt a (0, -5, 5); guesses: card boxes in those images' pixels
  const tries = [], coarseTries = [];
  const g0 = guesses[0];
  for (const g of guesses) for (const b of boxesAround(g, imgs[0].w, imgs[0].h, [0.94, 1, 1.06], [-0.05, 0, 0.05])) tries.push({ img: imgs[0], box: b, a: 0 });
  for (const a of [-5, 5]) if (imgs[a]) for (const g of guesses) for (const b of boxesAround(g, imgs[a].w, imgs[a].h, [0.96, 1.04], [-0.03, 0.03])) tries.push({ img: imgs[a], box: b, a });
  const feats = tries.map(t => SF.norm(SF.feature(t.img.px, t.img.w, t.img.h, t.box)));
  // coarse pass: the plain guesses, plus small shifts of the main one
  const cq = [];
  const cBoxes = guesses.map(g => g).concat(boxesAround(g0, imgs[0].w, imgs[0].h, [1], [-0.05, 0, 0.05]));
  for (const b of cBoxes) { const v = SF.norm(SF.feature(imgs[0].px, imgs[0].w, imgs[0].h, b)); const q = new Float32Array(CD); pool(v, q, 0); cq.push(q); }
  const keepN = Math.min(n, opts.shortlist || 400);
  let cand;
  if (n > keepN) {
    const cs = new Float32Array(n);
    for (let e = 0; e < n; e++) { let best = Infinity; for (const q of cq) { const d = coarse(q, e); if (d < best) best = d; } cs[e] = best; }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => cs[a] - cs[b]);
    cand = order.slice(0, keepN);
  } else cand = Array.from({ length: n }, (_, i) => i);
  // full pass over the shortlist
  const scored = cand.map(e => { let best = Infinity, bi = 0; for (let i = 0; i < feats.length; i++) { const d = dist(feats[i], e); if (d < best) { best = d; bi = i; } } return { e, d: best, t: tries[bi] }; });
  scored.sort((a, b) => a.d - b.d);
  // fine pass around the best few cut-outs
  const fine = [], seen = new Set();
  for (const s of scored.slice(0, 5)) {
    const key = s.t.a + ':' + s.t.box.map(v => Math.round(v)).join(',');
    if (seen.has(key)) continue; seen.add(key);
    for (const b of boxesAround(s.t.box, s.t.img.w, s.t.img.h, [0.97, 1, 1.03], [-0.015, 0, 0.015])) fine.push({ img: s.t.img, box: b, a: s.t.a });
  }
  // only the cut-outs that were best for one of the short-listed cards, plus the fine ones (keeps this quick)
  const useIdx = [...new Set(scored.slice(0, 60).map(s => tries.indexOf(s.t)))];
  const all = fine.concat(useIdx.map(i => tries[i]));
  const ff = fine.map(t => SF.norm(SF.feature(t.img.px, t.img.w, t.img.h, t.box))).concat(useIdx.map(i => feats[i]));
  const lf = all.map(t => SF.lumFeature(t.img.px, t.img.w, t.img.h, t.box));
  const fin = scored.slice(0, 60).map(s => {
    let best = Infinity, bt = null; const withL = hasL(s.e);
    for (let i = 0; i < ff.length; i++) { const d = distRobust(ff[i], s.e) + (withL ? LUMW * 100 * (1 - corrL(lf[i], s.e)) : 0); if (d < best) { best = d; bt = all[i]; } }
    return { id: ids[s.e], d: Math.round(best * 100) / 100, box: bt.box, a: bt.a };
  });
  fin.sort((a, b) => a.d - b.d);
  return fin.slice(0, opts.top || 10);
}

onmessage = async ev => {
  const m = ev.data;
  try {
    if (m.t === 'load') {
      if (!ready) ready = load(m.base || '', m.all !== false);
      const count = await ready;
      postMessage({ t: 'ready', n: count });
    } else if (m.t === 'match') {
      await ready;
      const imgs = {};
      for (const im of m.imgs) imgs[im.a] = { px: new Uint8ClampedArray(im.buf), w: im.w, h: im.h };
      const t0 = Date.now();
      const top = match(imgs, m.guesses, m.opts || {});
      postMessage({ t: 'result', id: m.id, top, ms: Date.now() - t0 });
    }
  } catch (e) { postMessage({ t: 'error', id: m.id, text: String(e && e.message || e) }); }
};
