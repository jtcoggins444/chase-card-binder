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
  function dist(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    // structure term: compare horizontal brightness gradients
    let t = 0, k = 0;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW - 1; x++) {
      const i = (y * GW + x) * 3, j = i + 3;
      const da = (a[j] + a[j + 1] + a[j + 2]) - (a[i] + a[i + 1] + a[i + 2]);
      const db = (b[j] + b[j + 1] + b[j + 2]) - (b[i] + b[i + 1] + b[i + 2]);
      t += Math.abs(da - db); k++;
    }
    return s / a.length + 0.5 * t / (k * 3);
  }
  const toB64 = u8 => { let s = ''; for (const v of u8) s += String.fromCharCode(v); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(u8).toString('base64')); };
  const fromB64 = s => { const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  g.ScanFeat = { feature, dist, toB64, fromB64, GW, GH, VERSION: 1 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
