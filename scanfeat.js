// Chase Card Binder - card "fingerprints" for the scanner.
// The same code runs in the browser (on a photo) and on GitHub (on each checklist card's picture),
// so a photo and the matching card produce nearly the same numbers.
(function (g) {
  'use strict';
  const GW = 12, GH = 9;            // colour grid over the artwork
  const AX0 = 0.08, AX1 = 0.92, AY0 = 0.10, AY1 = 0.56;   // artwork window as a share of the card

  // Area-average a region of an RGBA image down to gw x gh RGB cells.
  function grid(px, W, H, x0, y0, x1, y1, gw, gh) {
    const out = new Float32Array(gw * gh * 3);
    for (let gy = 0; gy < gh; gy++) {
      const ya = y0 + (y1 - y0) * gy / gh, yb = y0 + (y1 - y0) * (gy + 1) / gh;
      for (let gx = 0; gx < gw; gx++) {
        const xa = x0 + (x1 - x0) * gx / gw, xb = x0 + (x1 - x0) * (gx + 1) / gw;
        let r = 0, gg = 0, b = 0, n = 0;
        const ys = Math.max(0, Math.floor(ya)), ye = Math.min(H, Math.max(ys + 1, Math.ceil(yb)));
        const xs = Math.max(0, Math.floor(xa)), xe = Math.min(W, Math.max(xs + 1, Math.ceil(xb)));
        const sy = Math.max(1, Math.floor((ye - ys) / 6)), sx = Math.max(1, Math.floor((xe - xs) / 6));
        for (let y = ys; y < ye; y += sy) for (let x = xs; x < xe; x += sx) { const i = (y * W + x) * 4; r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++; }
        const o = (gy * gw + gx) * 3; n = n || 1;
        out[o] = r / n; out[o + 1] = gg / n; out[o + 2] = b / n;
      }
    }
    return out;
  }
  // Fingerprint of a card occupying box [x, y, w, h] in an RGBA image: grey-world balanced colour grid, 0..255 bytes.
  function feature(px, W, H, box) {
    const [bx, by, bw, bh] = box || [0, 0, W, H];
    const cells = grid(px, W, H, bx + bw * AX0, by + bh * AY0, bx + bw * AX1, by + bh * AY1, GW, GH);
    const m = [0, 0, 0];
    for (let i = 0; i < cells.length; i += 3) { m[0] += cells[i]; m[1] += cells[i + 1]; m[2] += cells[i + 2]; }
    const n = cells.length / 3; m[0] /= n; m[1] /= n; m[2] /= n;
    const lum = (m[0] + m[1] + m[2]) / 3 || 1;
    const f = new Uint8Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      // brightness-normalised colour, softly balanced per channel (half grey-world) to forgive lighting
      const c = i % 3, k = 0.5 * (lum / (m[c] || 1)) + 0.5;
      f[i] = Math.max(0, Math.min(255, Math.round(cells[i] * k / lum * 96)));
    }
    // texture: brightness differences between neighbouring cells (robust to colour casts)
    return f;
  }
  // Turn a stored fingerprint into a comparison vector that survives real-world photos:
  // brightness pattern stretched to a common range, plus colour *relative to the card's own average colour*,
  // scaled by how colourful the card looks. A washed-out, tinted photo (toploader, warm lamp) and the bright
  // official scan end up close together. Layout: [L x N, A x N, B x N].
  const N = GW * GH;
  function norm(f) {
    const v = new Float32Array(N * 3);
    for (let c = 0; c < N; c++) {
      const r = f[c * 3], g = f[c * 3 + 1], b = f[c * 3 + 2];
      v[c] = (r + g + b) / 3; v[N + c] = r - g; v[2 * N + c] = (r + g) / 2 - b;
    }
    const s = Array.from(v.subarray(0, N)).sort((x, y) => x - y), lo = s[Math.floor(N * 0.1)], hi = s[Math.floor(N * 0.9)], k = 100 / Math.max(8, hi - lo);
    for (let c = 0; c < N; c++) v[c] = (v[c] - lo) * k;
    let ma = 0, mb = 0; for (let c = 0; c < N; c++) { ma += v[N + c]; mb += v[2 * N + c]; } ma /= N; mb /= N;
    let sd = 0; for (let c = 0; c < N; c++) sd += (v[N + c] - ma) ** 2 + (v[2 * N + c] - mb) ** 2;
    const ks = 15 / (Math.sqrt(sd / N) || 1);
    for (let c = 0; c < N; c++) { v[N + c] = (v[N + c] - ma) * ks; v[2 * N + c] = (v[2 * N + c] - mb) * ks; }
    return v;
  }
  const CAP = 80;
  function cellDiff(p, q, c) { return Math.abs(p[c] - q[c]) + Math.abs(p[N + c] - q[N + c]) + Math.abs(p[2 * N + c] - q[2 * N + c]); }
  function structure(p, q) {
    let t = 0;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW - 1; x++) { const i = y * GW + x; const d = Math.abs((p[i + 1] - p[i]) - (q[i + 1] - q[i])); t += d < CAP ? d : CAP; }
    for (let y = 0; y < GH - 1; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; const d = Math.abs((p[i + GW] - p[i]) - (q[i + GW] - q[i])); t += d < CAP ? d : CAP; }
    return t / N;
  }
  // Difference between two comparison vectors; each cell's share is capped so a few washed-out cells can't dominate.
  function dist(p, q) {
    let s = 0;
    for (let c = 0; c < N; c++) { const d = cellDiff(p, q, c); s += d < CAP ? d : CAP; }
    return s / N + structure(p, q);
  }
  // Like dist, but ignores the worst-matching 30% of the artwork (glare, a thumb, a sleeve reflection).
  function distRobust(p, q, keep) {
    const d = new Float32Array(N);
    for (let c = 0; c < N; c++) d[c] = cellDiff(p, q, c);
    d.sort();
    const k = Math.round(N * (keep || 0.7)); let s = 0;
    for (let c = 0; c < k; c++) s += d[c];
    return s / k + structure(p, q);
  }
  // Fine brightness detail of the artwork: LW x LH cells, each as standard deviations from the mean (so lighting
  // and haze don't matter), stored one byte per cell. Compared by correlation: 1 = identical pattern.
  const LW = 24, LH = 18, LN = LW * LH;
  function lumFeature(px, W, H, box) {
    const [bx, by, bw, bh] = box || [0, 0, W, H];
    const cells = grid(px, W, H, bx + bw * AX0, by + bh * AY0, bx + bw * AX1, by + bh * AY1, LW, LH);
    const v = new Float32Array(LN);
    for (let c = 0; c < LN; c++) v[c] = 0.3 * cells[c * 3] + 0.59 * cells[c * 3 + 1] + 0.11 * cells[c * 3 + 2];
    return zn(v);
  }
  function zn(v) {
    let m = 0; for (const x of v) m += x; m /= v.length;
    let sd = 0; for (const x of v) sd += (x - m) * (x - m); sd = Math.sqrt(sd / v.length) || 1;
    const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = (v[i] - m) / sd; return o;
  }
  function packLum(v) {   // one byte per cell: -3..+3 standard deviations
    const out = new Uint8Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((v[i] + 3) * 42.5)));
    return out;
  }
  function unpackLum(u) {
    const v = new Float32Array(LN);
    for (let i = 0; i < LN; i++) v[i] = u[i] / 42.5 - 3;
    return zn(v);
  }
  function corr(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length; }
  const toB64 = u8 => { let s = ''; for (const v of u8) s += String.fromCharCode(v); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(u8).toString('base64')); };
  const fromB64 = s => { const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  g.ScanFeat = { feature, norm, dist, distRobust, lumFeature, packLum, unpackLum, corr, toB64, fromB64, GW, GH, VERSION: 3 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
