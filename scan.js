// Chase Card Binder - card scanner.
// Matches a photo of a card against every card in the checklist by its artwork (see scanfeat.js),
// entirely on the device, then lets you mark the card Owned or add it to a list.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const dlg = $('scanDlg'), video = $('scVideo'), frame = $('scFrame'), statusEl = $('scStatus'), results = $('scResults');
  const camBox = $('scCam'), shotBtn = $('scShot'), fileIn = $('scFile'), manual = $('scManual'), manIn = $('scManIn');
  let stream = null, busy = false, index = null, indexP = null;
  const SF = () => window.ScanFeat;

  // ---------- fingerprint index ----------
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  }
  function getIndex() {
    if (indexP) return indexP;
    indexP = (async () => {
      if (!window.ScanFeat) await loadScript('scanfeat.js');
      const r = await fetch('data/scanindex.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('index ' + r.status);
      const j = await r.json();
      const list = [];
      for (const [id, b] of Object.entries(j.f || {})) if (byId[id]) list.push(Array.isArray(b) ? { c: byId[id], f: SF().norm(SF().fromB64(b[0])), l: SF().unpackLum(SF().fromB64(b[1])) } : { c: byId[id], f: SF().norm(SF().fromB64(b)), l: null });
      index = list; return list;
    })();
    indexP.catch(() => { indexP = null; });
    return indexP;
  }

  // ---------- matching ----------
  const LUMW = window.__LUMW || 2.5;   // weight of the fine brightness detail in the final ranking
  function pixels(src, maxW, angle, cx, cy) {
    const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    const k = Math.min(1, maxW / sw), w = Math.round(sw * k), h = Math.round(sh * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (angle) {   // straighten a tilted card: rotate the picture around the card's centre
      g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
      g.translate(cx * k, cy * k); g.rotate(angle * Math.PI / 180); g.translate(-cx * k, -cy * k);
    }
    g.drawImage(src, 0, 0, w, h);
    return { px: g.getImageData(0, 0, w, h).data, w, h, k };
  }
  // Card-shaped boxes to try around a guess [x, y, w, h], to forgive a card that isn't lined up exactly.
  function boxesAround(b, W, H, scales, shifts) {
    const out = [];
    for (const s of scales) for (const dx of shifts) for (const dy of shifts) {
      const w = b[2] * s, h = b[3] * s;
      const x = b[0] + (b[2] - w) / 2 + dx * b[2], y = b[1] + (b[3] - h) / 2 + dy * b[3];
      if (x < -w * 0.03 || y < -h * 0.03 || x + w > W + w * 0.03 || y + h > H + h * 0.03) continue;
      out.push([x, y, w, h]);
    }
    return out;
  }
  // tries: [{img, box}] - every way of cutting the card out of the picture that we want to compare
  function featsOf(tries) { return tries.map(t => SF().norm(SF().feature(t.img.px, t.img.w, t.img.h, t.box))); }
  function search(src, guesses) {
    // guesses are card boxes in the source picture's own pixels
    const sw = src.videoWidth || src.naturalWidth || src.width;
    const k = Math.min(1, 900 / sw);
    const g0 = guesses[0], cx = g0[0] + g0[2] / 2, cy = g0[1] + g0[3] / 2;
    const imgs = { 0: pixels(src, 900) };
    let tries = [];
    for (const g of guesses) for (const b of boxesAround(g.map(v => v * k), imgs[0].w, imgs[0].h, [0.94, 1, 1.06], [-0.05, 0, 0.05])) tries.push({ img: imgs[0], box: b, a: 0 });
    for (const a of [-5, 5]) {   // the card may be tilted a little in the photo
      imgs[a] = pixels(src, 900, a, cx, cy);
      for (const g of guesses) for (const b of boxesAround(g.map(v => v * k), imgs[a].w, imgs[a].h, [0.96, 1.04], [-0.03, 0.03])) tries.push({ img: imgs[a], box: b, a });
    }
    let feats = featsOf(tries);
    const scored = index.map(e => {
      let best = Infinity, bi = 0;
      for (let i = 0; i < feats.length; i++) { const d = SF().dist(feats[i], e.f); if (d < best) { best = d; bi = i; } }
      return { e, d: best, t: tries[bi] };
    });
    scored.sort((a, b) => a.d - b.d);
    // look more closely around the best few cut-outs, then rank the short list ignoring the worst 30% (glare)
    const fine = [];
    const seen = new Set();
    for (const s of scored.slice(0, 5)) {
      const key = s.t.a + ':' + s.t.box.map(v => Math.round(v)).join(',');
      if (seen.has(key)) continue; seen.add(key);
      for (const b of boxesAround(s.t.box, s.t.img.w, s.t.img.h, [0.97, 1, 1.03], [-0.015, 0, 0.015])) fine.push({ img: s.t.img, box: b, a: s.t.a });
    }
    // final ranking of the short list: colour (ignoring the worst 30% of cells, for glare) plus fine brightness detail
    const all = fine.concat(tries);
    const ff = featsOf(fine).concat(feats);
    const lf = all.map(t => SF().lumFeature(t.img.px, t.img.w, t.img.h, t.box));
    const fin = scored.slice(0, 60).map(s => {
      let best = Infinity;
      for (let i = 0; i < ff.length; i++) { const d = SF().distRobust(ff[i], s.e.f, 0.7) + (s.e.l ? LUMW * 100 * (1 - SF().corr(lf[i], s.e.l)) : 0); if (d < best) best = d; }
      return { c: s.e.c, d: best };
    });
    fin.sort((a, b) => a.d - b.d);
    return fin.slice(0, 8);
  }
  // Camera: the card should be in the outline, but may be smaller than it or a little off-centre.
  function identify(src, frameB) {
    const [x, y, w, h] = frameB, guesses = [];
    for (const f of [1, 0.91, 0.82, 0.74, 0.66]) guesses.push([x + w * (1 - f) / 2, y + h * (1 - f) / 2, w * f, h * f]);
    return { top: search(src, guesses) };
  }
  // A photo: the card is usually centred and fills much of the frame. Try a spread of sizes.
  function identifyPhoto(im) {
    const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height, ar = 63 / 88, guesses = [];
    for (const f of [0.95, 0.85, 0.75, 0.65, 0.55]) {
      let w = W * f, h = w / ar; if (h > H * 0.98) { h = H * 0.98; w = h * ar; }
      guesses.push([(W - w) / 2, (H - h) / 2, w, h]);
    }
    return { top: search(im, guesses) };
  }

  // ---------- camera ----------
  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camBox.dataset.state = 'nocam'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (!dlg.open) { stopCamera(); return; }
      video.srcObject = stream; await video.play().catch(() => {});
      camBox.dataset.state = 'live';
    } catch (e) {
      camBox.dataset.state = 'nocam';
      say(e && e.name === 'NotAllowedError' ? 'Camera access is off for this app. Allow the camera in your browser settings, or use Choose a photo.' : 'No camera available here. Use Choose a photo instead.');
    }
  }
  function stopCamera() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } video.srcObject = null; }
  function frameBox() {
    // where the on-screen card outline sits in the video's own pixels (the video is shown with object-fit: cover)
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
    const vb = video.getBoundingClientRect(), fb = frame.getBoundingClientRect();
    const s = Math.max(vb.width / vw, vb.height / vh), ox = (vb.width - vw * s) / 2, oy = (vb.height - vh * s) / 2;
    return [(fb.left - vb.left - ox) / s, (fb.top - vb.top - oy) / s, fb.width / s, fb.height / s];
  }

  // ---------- results ----------
  function say(t, kind) { statusEl.textContent = t; statusEl.dataset.kind = kind || ''; }
  function statusOf(c) { const s = state[c[0]]; return s === 'owned' ? 'In My Binder' : window.openListPicker && typeof listsOf === 'function' && listsOf(c[0]).length ? 'On a list' : ''; }
  function rowHTML(c, best) {
    const s = S[c[2]], st = statusOf(c);
    const opts = CONDS.map(([k, l]) => `<option value="${k}"${(cond[c[0]] || 'NM') === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
    return `<li class="scRow${best ? ' best' : ''}" data-id="${c[0]}">
      <button type="button" class="scImg" data-act="open" aria-label="Price chart for ${esc(c[1])}"><img src="${img(c, false)}" alt="" onerror="this.remove()"></button>
      <div class="scInfo"><b>${esc(c[1])}</b><small>${esc(s[0])} · #${esc(c[3])}${s[3] ? '/' + s[3] : ''} · ${esc(LABEL[c[4]] || c[4])}</small>
        <span class="scPrice">${money(c[5])}${st ? ` <em>${st}</em>` : ''}</span>
        <div class="scAct"><button type="button" data-act="owned">Owned</button><button type="button" data-act="list">+ List</button>
          <select aria-label="Condition">${opts}</select></div>
        <span class="scDone" role="status"></span></div></li>`;
  }
  function show(top, how) {
    if (!top.length) { results.innerHTML = ''; say('No match found. Try again with the whole card inside the outline, or type the card number below.', 'warn'); return; }
    const byNum = how === 'number';
    const [a, b] = top, sure = byNum ? top.length === 1 : (!b || b.d - a.d > 2.5);
    say(byNum ? (top.length === 1 ? 'Found it:' : `${top.length} cards have that number — tap the right one:`) : sure ? 'Best match:' : 'Closest matches — the first is most likely:', 'ok');
    const first = top.slice(0, 1), rest = top.slice(1, byNum ? 30 : 5);
    results.innerHTML = `<ol class="scList">${first.map(x => rowHTML(x.c, true)).join('')}</ol>` +
      (rest.length ? `<details class="scMore"${!sure ? ' open' : ''}><summary>${byNum ? 'Other cards with that number' : 'Not it? Other close matches'}</summary><ol class="scList">${rest.map(x => rowHTML(x.c, false)).join('')}</ol></details>` : '');
  }
  results.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const row = b.closest('.scRow'), id = row.dataset.id, c = byId[id];
    if (b.dataset.act === 'open') { openDetail(c); return; }
    if (b.dataset.act === 'list') { window.openListPicker(id); return; }
    const val = b.dataset.act;
    const cv = row.querySelector('select').value;
    if (cv) cond[id] = cv;
    window.setStatus(id, val);
    row.querySelector('.scDone').textContent = '✓ Added to My Binder';
    row.classList.add('done');
    const em = row.querySelector('.scPrice em'); if (em) em.remove();
  });
  results.addEventListener('change', e => {
    const sel = e.target.closest('select'); if (!sel) return;
    const id = sel.closest('.scRow').dataset.id;
    if (state[id]) { cond[id] = sel.value; cache(); refresh(); }
  });

  // ---------- run ----------
  async function run(fn) {
    if (busy) return; busy = true; shotBtn.disabled = true;
    results.innerHTML = '';
    say(index ? 'Matching…' : 'Getting the scanner ready…');
    try {
      await getIndex();
      say('Matching…');
      await new Promise(r => setTimeout(r, 30));
      show(fn().top);
    } catch (e) {
      console.warn(e);
      say('The scanner couldn’t load its card data' + (navigator.onLine ? '' : ' (you’re offline)') + '. You can still type the card number below.', 'warn');
    }
    busy = false; shotBtn.disabled = false;
  }
  shotBtn.addEventListener('click', () => {
    const b = frameBox();
    if (!b) { say('The camera isn’t ready yet. Give it a second, or use Choose a photo.', 'warn'); return; }
    // freeze the frame first so the card can move while matching
    const snap = document.createElement('canvas'); snap.width = video.videoWidth; snap.height = video.videoHeight;
    snap.getContext('2d').drawImage(video, 0, 0);
    run(() => identify(snap, b));
  });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
    const url = URL.createObjectURL(f);
    const im = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
    URL.revokeObjectURL(url);
    if (!im) { say('That photo couldn’t be opened.', 'warn'); return; }
    run(() => identifyPhoto(im));
  });
  // typed card number, e.g. 114/084 or TG08/TG30
  const normNum = s => { s = String(s).toUpperCase(); const m = s.match(/^([A-Z]*)0*(\d+)$/); return m ? m[1] + m[2] : s; };
  manual.addEventListener('submit', e => {
    e.preventDefault();
    const v = manIn.value.toUpperCase().replace(/\s+/g, '');
    const m = v.match(/^([A-Z]*\d+)(?:\/([A-Z]*)(\d+))?$/);
    if (!m) { say('Type the number as it’s printed, like 114/084 or TG08/TG30.', 'warn'); results.innerHTML = ''; return; }
    const num = normNum(m[1]), tot = m[3] ? parseInt(m[3], 10) : null;
    let list = C.filter(c => normNum(c[3]) === num);
    if (tot != null) { const exact = list.filter(c => S[c[2]][3] === tot || (m[2] && c[3].startsWith(m[2]))); if (exact.length) list = exact; }
    list.sort((a, b) => S[b[2]][2].localeCompare(S[a[2]][2]));
    if (!list.length) { results.innerHTML = ''; say(`No chase card numbered ${v} in your checklist.`, 'warn'); return; }
    show(list.map(c => ({ c, d: 0 })), 'number');
  });
  $('scClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { stopCamera(); });
  window.binderScanOpen = () => {
    results.innerHTML = ''; say('Lay the card flat, fill the outline, and tilt it a little if there\u2019s glare. Then tap Scan card.');
    dlg.showModal(); startCamera();
    getIndex().catch(() => {});   // fetch the card data in the background
  };
  window.binderScanTest = { getIndex, identify, identifyPhoto, frameBox };
})();
