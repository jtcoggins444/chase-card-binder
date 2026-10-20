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
let CCAP = 25;

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
  for (let j = 0; j < CD; j++) { let d = q[j] - CF[o + j] / 4; if (d < 0) d = -d; s += d < CCAP ? d : CCAP; }
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

// ---- finding the card in the picture ----
// Looks for the card's outline: a 63 x 88 rectangle, any size, anywhere, tilted up to 15 degrees, whose four edges
// all show strong contrast. Works on a small grey copy of the picture. Returns the best few as [x, y, w, h] + angle.
function detectCard(img) {
  // gradients of a grey copy at a given width
  function level(width) {
    const f = Math.min(1, width / img.w), W = Math.round(img.w * f), H = Math.round(img.h * f);
    const g = new Float32Array(W * H), px = img.px, iw = img.w, step = 1 / f;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      // small box average so the smaller copy isn't noisy
      let t = 0, n = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const X = Math.min(img.w - 1, Math.round((x + dx * 0.5) * step)), Y = Math.min(img.h - 1, Math.round((y + dy * 0.5) * step)), i = (Y * iw + X) * 4;
        t += 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]; n++;
      }
      g[y * W + x] = t / n;
    }
    const b = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; b[i] = (4 * g[i] + g[i - 1] + g[i + 1] + g[i - W] + g[i + W]) / 8; }
    const gx = new Float32Array(W * H), gy = new Float32Array(W * H), mag = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      gx[i] = (b[i - W + 1] + 2 * b[i + 1] + b[i + W + 1]) - (b[i - W - 1] + 2 * b[i - 1] + b[i + W - 1]);
      gy[i] = (b[i + W - 1] + 2 * b[i + W] + b[i + W + 1]) - (b[i - W - 1] + 2 * b[i - W] + b[i - W + 1]);
      mag[i] = Math.abs(gx[i]) + Math.abs(gy[i]);
    }
    return { f, W, H, gx, gy, mag };
  }
  const SAMP = 9;
  const sides = [[-1, -1, 1, -1, 0, -1], [-1, 1, 1, 1, 0, 1], [-1, -1, -1, 1, -1, 0], [1, -1, 1, 1, 1, 0]];
  // A card's outer edge: strong contrast across the edge, and (usually) a calmer background just outside it.
  // Edges inside the card (the artwork window, text boxes) have busy card detail on both sides, so they score lower.
  function score(L, cx, cy, h, deg, quick) {
    ncalls++;
    const { W, H, gx, gy, mag } = L;
    const w = h * 63 / 88, c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180), hw = w / 2, hh = h / 2;
    const off = Math.max(2, h * 0.035);
    let mn = Infinity, tot = 0;
    for (const [a0, b0, a1, b1, nx, ny] of sides) {
      const u0 = a0 * hw, v0 = b0 * hh, u1 = a1 * hw, v1 = b1 * hh;
      const Nx = c * nx - s * ny, Ny = s * nx + c * ny; let sum = 0, out = 0;
      const ns = quick ? 5 : SAMP, o0 = quick ? 0 : -1, o1 = quick ? 0 : 1;
      for (let k = 0; k < ns; k++) {
        const t = 0.14 + 0.72 * k / (ns - 1), u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
        const X0 = cx + c * u - s * v, Y0 = cy + s * u + c * v;
        let best = 0;
        for (let o = o0; o <= o1; o++) {
          const X = Math.round(X0 + Nx * o), Y = Math.round(Y0 + Ny * o);
          if (X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1) return -1;
          const i = Y * W + X; let e = gx[i] * Nx + gy[i] * Ny; if (e < 0) e = -e; if (e > best) best = e;
        }
        sum += best;
        const XO = Math.round(X0 + Nx * off), YO = Math.round(Y0 + Ny * off);
        if (XO >= 0 && YO >= 0 && XO < W && YO < H) out += mag[YO * W + XO];
      }
      const m = (sum - 0.6 * out) / ns; tot += m; if (m < mn) mn = m;
    }
    return 0.5 * tot / 4 + 0.5 * mn;
  }
  // 1) broad search on a small copy
  const D0 = Date.now(); let ncalls = 0;
  const S1 = level(130);
  const D1 = Date.now();
  let found = [], floor = -Infinity;
  const keep = (sc, cx, cy, h, deg) => {   // keep only the best few hundred without sorting everything
    if (sc <= floor) return;
    found.push([sc, cx, cy, h, deg]);
    if (found.length >= 600) { found.sort((a, b2) => b2[0] - a[0]); found.length = 250; floor = found[249][0]; }
  };
  for (let h = S1.H * 0.3; h <= S1.H * 0.99; h *= 1.08) {
    const step = Math.max(1.5, h * 0.05);
    for (let deg = -15; deg <= 15; deg += 3) for (let cy = h / 2; cy <= S1.H - h / 2 + 1; cy += step) for (let cx = h * 0.36; cx <= S1.W - h * 0.36 + 1; cx += step) {
      const sc = score(S1, cx, cy, h, deg, true); if (sc > 0) keep(sc, cx, cy, h, deg);
    }
  }
  found.sort((a, b2) => b2[0] - a[0]);
  const D2 = Date.now();
  const seeds = [];
  for (const f0 of found) {
    if (seeds.length >= 8) break;
    if (seeds.some(p => Math.hypot(p[1] - f0[1], p[2] - f0[2]) < f0[3] * 0.2 && Math.abs(p[3] / f0[3] - 1) < 0.15 && Math.abs(p[4] - f0[4]) < 4)) continue;
    seeds.push(f0);
  }
  // 2) refine each on a larger copy
  const S2 = level(280), k = S2.f / S1.f, picks = [];
  for (const sd of seeds) {
    let best = [score(S2, sd[1] * k, sd[2] * k, sd[3] * k, sd[4]), sd[1] * k, sd[2] * k, sd[3] * k, sd[4]];
    for (let pass = 0; pass < 3; pass++) {
      const st = Math.max(0.5, best[3] * [0.03, 0.012, 0.005][pass]), as = [1.5, 0.75, 0.4][pass], cur = best.slice();
      for (const dx of [-2, -1, 0, 1, 2]) for (const dy of [-2, -1, 0, 1, 2]) for (const ds of [0.97, 0.985, 1, 1.015, 1.03]) for (const da of [-1, 0, 1]) {
        const sc = score(S2, cur[1] + dx * st, cur[2] + dy * st, cur[3] * ds, cur[4] + da * as);
        if (sc > best[0]) best = [sc, cur[1] + dx * st, cur[2] + dy * st, cur[3] * ds, cur[4] + da * as];
      }
    }
    picks.push(best);
  }
  picks.sort((a, b2) => b2[0] - a[0]);
  self.__dt = { lvl1: D1 - D0, broad: D2 - D1, refine: Date.now() - D2, ncalls };
  const f = S2.f;
  return picks.slice(0, 3).map(([sc, cx, cy, h, deg]) => { const w = h * 63 / 88; return { box: [(cx - w / 2) / f, (cy - h / 2) / f, w / f, h / f], deg, score: sc }; });
}

function match(imgs, guesses, opts) {
  // imgs: {0: {px, w, h}}; guesses: card boxes in that picture's pixels (from the on-screen outline)
  const img = imgs[0], tries = [];
  // 1) wherever the card's outline was found
  const T0 = Date.now();
  const dets = opts.detect === false ? [] : detectCard(img);
  const T1 = Date.now();
  for (const d of dets.slice(0, 2)) {
    for (const bx of boxesAround(d.box, img.w, img.h, [0.96, 1, 1.04], [-0.02, 0, 0.02])) tries.push({ img, box: bx, a: d.deg });
    for (const da of [-2, 2]) tries.push({ img, box: d.box, a: d.deg + da });
  }
  // 2) the outline on screen, as before (in case the card's edges can't be seen)
  for (const g of guesses) for (const bx of boxesAround(g, img.w, img.h, [0.95, 1.05], [-0.04, 0, 0.04])) tries.push({ img, box: bx, a: 0 });
  for (const a of [-5, 5]) for (const g of guesses.slice(0, 3)) for (const bx of boxesAround(g, img.w, img.h, [0.96, 1.04], [-0.03, 0.03])) tries.push({ img, box: bx, a });
  const feats = tries.map(t => SF.norm(SF.feature(t.img.px, t.img.w, t.img.h, t.box, t.a)));
  // coarse pass: the detected outlines, the plain guesses, plus small shifts of the main one
  const cq = [];
  const cTries = dets.slice(0, 2).map(d => ({ box: d.box, a: d.deg })).concat(guesses.map(g => ({ box: g, a: 0 })), dets.length ? [] : boxesAround(guesses[0], img.w, img.h, [1], [-0.05, 0.05]).map(bx => ({ box: bx, a: 0 })));
  for (const t of cTries) { const v = SF.norm(SF.feature(img.px, img.w, img.h, t.box, t.a)); const q = new Float32Array(CD); pool(v, q, 0); cq.push(q); }
  self.__dets = dets;
  const T2 = Date.now();
  if (opts.ccap) CCAP = opts.ccap;
  const keepN = Math.min(n, opts.shortlist || 300);
  let cand;
  if (n > keepN) {
    const cs = new Float32Array(n);
    for (let e = 0; e < n; e++) { let best = Infinity; for (const q of cq) { const d = coarse(q, e); if (d < best) best = d; } cs[e] = best; }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => cs[a] - cs[b]);
    cand = order.slice(0, keepN);
    if (opts.debugId) self.__crank = order.findIndex(e => ids[e] === opts.debugId);
  } else cand = Array.from({ length: n }, (_, i) => i);
  const T3 = Date.now();
  // full pass over the shortlist
  const scored = cand.map(e => { let best = Infinity, bi = 0; for (let i = 0; i < feats.length; i++) { const d = dist(feats[i], e); if (d < best) { best = d; bi = i; } } return { e, d: best, t: tries[bi] }; });
  scored.sort((a, b) => a.d - b.d);
  const T4 = Date.now();
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
  const ff = fine.map(t => SF.norm(SF.feature(t.img.px, t.img.w, t.img.h, t.box, t.a))).concat(useIdx.map(i => feats[i]));
  const lf = all.map(t => SF.lumFeature(t.img.px, t.img.w, t.img.h, t.box, t.a));
  const fin = scored.slice(0, 60).map(s => {
    let best = Infinity, bt = null; const withL = hasL(s.e);
    for (let i = 0; i < ff.length; i++) { const d = distRobust(ff[i], s.e) + (withL ? LUMW * 100 * (1 - corrL(lf[i], s.e)) : 0); if (d < best) { best = d; bt = all[i]; } }
    return { id: ids[s.e], d: Math.round(best * 100) / 100, box: bt.box, a: bt.a };
  });
  fin.sort((a, b) => a.d - b.d);
  self.__times = { detect: T1 - T0, feats: T2 - T1, coarse: T3 - T2, full: T4 - T3, fine: Date.now() - T4, tries: tries.length };
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
      postMessage({ t: 'result', id: m.id, top, ms: Date.now() - t0, crank: self.__crank, times: Object.assign({}, self.__times, self.__dt), dets: (self.__dets || []).map(d => ({ box: d.box, deg: d.deg, score: Math.round(d.score) })) });
    }
  } catch (e) { postMessage({ t: 'error', id: m.id, text: String(e && e.message || e) }); }
};
