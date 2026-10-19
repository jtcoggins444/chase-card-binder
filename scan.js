// Chase Card Binder - card scanner.
// Point the camera at a card and it is recognised by its artwork (see scanfeat.js / scanworker.js), entirely on the
// device. Works for every English card: chase cards can be marked Owned or put on a list; other cards show their price.
// "One card" mode stops on each card; "Stack" mode keeps going and collects every card you show it in a tray.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const dlg = $('scanDlg'), video = $('scVideo'), frame = $('scFrame'), statusEl = $('scStatus'), results = $('scResults');
  const camBox = $('scCam'), shotBtn = $('scShot'), fileIn = $('scFile'), manual = $('scManual'), manIn = $('scManIn');
  const trayEl = $('scTray'), modeEl = $('scMode');
  const ABS = window.__SCAN_ABS || 110, REL = window.__SCAN_REL || 0.2, GAP = 2.5;   // how sure the live scanner must be
  let stream = null, busy = false;
  let mode = 'one'; try { mode = localStorage.getItem('binder-scanMode') || 'one'; } catch (e) {}

  // ---------- engine (background worker) and the card catalog ----------
  let worker = null, engineP = null, seq = 0, engineN = 0;
  const pending = new Map();
  function engine() {
    if (engineP) return engineP;
    engineP = new Promise((res, rej) => {
      worker = new Worker('scanworker.js');
      worker.onmessage = ev => {
        const m = ev.data;
        if (m.t === 'progress') { if (!engineN) say(`Loading cards for the scanner… ${m.loaded.toLocaleString()}`); }
        else if (m.t === 'ready') { engineN = m.n; res(m.n); }
        else if (m.t === 'result' || m.t === 'error') { const p = pending.get(m.id); pending.delete(m.id); if (p) m.t === 'result' ? p.res(m) : p.rej(new Error(m.text)); }
        else if (m.t === 'note') console.warn(m.text);
      };
      worker.onerror = e => { rej(e); };
      worker.postMessage({ t: 'load', all: true });
    });
    engineP.catch(() => { engineP = null; if (worker) worker.terminate(); worker = null; });
    return engineP;
  }
  let catP = null, CAT = null;
  function catalog() {
    if (catP) return catP;
    catP = (async () => {
      const [a, p] = await Promise.all([fetch('data/allcards.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null), fetch('data/allprices.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)]);
      const byPid = new Map();
      if (a) for (const r of a.cards) byPid.set(r[0], r);
      CAT = { sets: (a && a.sets) || {}, byPid, prices: (p && p.p) || {}, list: (a && a.cards) || [] };
      return CAT;
    })();
    catP.catch(() => { catP = null; });
    return catP;
  }
  // a match id is a checklist card id, or 'p' + TCGplayer product id for any other card
  function resolve(id) {
    if (id[0] !== 'p' || byId[id]) { const c = byId[id]; return c ? { kind: 'chase', id, c, name: c[1], num: c[3] } : null; }
    const pid = Number(id.slice(1)), r = CAT && CAT.byPid.get(pid);
    return r ? { kind: 'other', id, r, pid, name: r[1], num: r[2] } : { kind: 'other', id, pid, name: 'Card #' + pid, num: '' };
  }
  const sameCard = (a, b) => a && b && a.name === b.name;

  // ---------- grabbing a picture for the engine ----------
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
    const d = g.getImageData(0, 0, w, h);
    return { a: angle || 0, buf: d.data.buffer, w, h, k };
  }
  async function match(src, guesses, opts) {
    await engine(); await catalog().catch(() => null);
    const g0 = guesses[0], cx = g0[0] + g0[2] / 2, cy = g0[1] + g0[3] / 2, MAXW = 760;
    const imgs = [pixels(src, MAXW, 0), pixels(src, MAXW, -5, cx, cy), pixels(src, MAXW, 5, cx, cy)];
    const k = imgs[0].k, id = ++seq;
    const msg = new Promise((res, rej) => pending.set(id, { res, rej }));
    worker.postMessage({ t: 'match', id, imgs: imgs.map(i => ({ a: i.a, buf: i.buf, w: i.w, h: i.h })), guesses: guesses.map(g => g.map(v => v * k)), opts: opts || {} }, imgs.map(i => i.buf));
    const m = await msg;
    return m.top.map(t => Object.assign(resolve(t.id) || { kind: 'gone', id: t.id, name: '' }, { d: t.d, box: t.box.map(v => v / k), a: t.a })).filter(x => x.kind !== 'gone');
  }
  // ---------- reading the printed number (only when look-alike printings are tied) ----------
  // e.g. the same artwork in Base Set (4/102), Base Set 2 (4/130) and Celebrations (4/102): the number decides.
  let ocrP = null;
  function ocrEngine() {
    if (ocrP) return ocrP;
    ocrP = (async () => {
      if (!window.Tesseract) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload = res; s.onerror = () => rej(new Error('ocr')); document.head.appendChild(s); });
      const w = await Tesseract.createWorker('eng', 1, { workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js', corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1', langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int' });
      await w.setParameters({ tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-', tessedit_pageseg_mode: '11' });
      return w;
    })();
    ocrP.catch(() => { ocrP = null; });
    return ocrP;
  }
  const numKey = s => { const m = String(s).toUpperCase().replace(/\s+/g, '').match(/^([A-Z-]*)0*(\d+)([A-Z]?)(?:\/([A-Z-]*)0*(\d+))?/); return m ? (m[1] + m[2] + m[3]) + (m[5] ? '/' + m[4] + m[5] : '') : ''; };
  function numOf(x) { if (x.kind === 'chase') { const s = S[x.c[2]]; return x.c[3] + (s && s[3] ? '/' + s[3] : ''); } return x.num || ''; }
  // crop the bottom strip of the card (where the number is printed) at full resolution, upscaled for reading
  function numberStrip(src, box, angle, invert) {
    const [x, y, w, h] = box, cx = x + w / 2, cy = y + h / 2;
    const c = document.createElement('canvas'), W = 1400, H = Math.round(W * 0.11 * h / w);
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    const k = W / w;
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.translate(-x * k, -(y + h * 0.885) * k);
    if (angle) { g.translate(cx * k, cy * k); g.rotate(angle * Math.PI / 180); g.translate(-cx * k, -cy * k); }
    g.scale(k, k); g.drawImage(src, 0, 0);
    // grey and stretch contrast
    const d = g.getImageData(0, 0, W, H), p = d.data; let lo = 255, hi = 0;
    for (let i = 0; i < p.length; i += 4) { const v = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]; p[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    const sc = 255 / Math.max(40, hi - lo);
    for (let i = 0; i < p.length; i += 4) { let v = (p[i] - lo) * sc; if (invert) v = 255 - v; p[i] = p[i + 1] = p[i + 2] = v; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.putImageData(d, 0, 0);
    return c;
  }
  async function readNumber(src, top) {
    const a = top[0]; if (!a || !a.box) return top;
    const near = top.filter(x => x.d - a.d <= Math.max(12, a.d * 0.25));
    const keys = new Set(near.map(x => numKey(numOf(x))));
    if (near.length < 2 || keys.size < 2) return top;
    try {
      const w = await ocrEngine();
      // numbers are printed dark-on-light on some cards and light-on-dark on others: read both ways
      let raw = '';
      for (const inv of [false, true]) { const { data } = await w.recognize(numberStrip(src, a.box, a.a, inv)); raw += ' ' + (data.text || ''); }
      const text = String(raw).toUpperCase().replace(/O/g, '0').replace(/\s+/g, '');
      // a printing counts as read only if its whole number (like 4/102) appears in what was read
      const variants = n => { const [x, t] = String(n).toUpperCase().split('/'); if (!t) return []; const strip = v => v.replace(/^([A-Z-]*)0+(\d)/, '$1$2'); const pad = v => v.replace(/^([A-Z-]*)(\d+)$/, (m, p1, d) => p1 + d.padStart(3, '0')); return [...new Set([x + '/' + t, strip(x) + '/' + strip(t), pad(x) + '/' + pad(t), strip(x) + '/' + t])]; };
      const hit = near.filter(x => variants(numOf(x)).some(v => text.includes(v)));
      if (hit.length && hit.length < near.length) {
        const rest = top.filter(x => !hit.includes(x));
        hit.forEach(x => { x.byNumber = true; });
        return hit.concat(rest);
      }
    } catch (e) { console.warn('Number reading unavailable', e); }
    return top;
  }

  // Camera: the card should be in the outline, but may be smaller than it or a little off-centre.
  function camGuesses(fb) { const [x, y, w, h] = fb; return [1, 0.91, 0.82, 0.74, 0.66].map(f => [x + w * (1 - f) / 2, y + h * (1 - f) / 2, w * f, h * f]); }
  // A photo: the card is usually centred and fills much of the frame. Try a spread of sizes.
  function photoGuesses(im) {
    const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height, ar = 63 / 88;
    return [0.95, 0.85, 0.75, 0.65, 0.55].map(f => { let w = W * f, h = w / ar; if (h > H * 0.98) { h = H * 0.98; w = h * ar; } return [(W - w) / 2, (H - h) / 2, w, h]; });
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
      startLive();
    } catch (e) {
      camBox.dataset.state = 'nocam';
      say(e && e.name === 'NotAllowedError' ? 'Camera access is off for this app. Allow the camera in your browser settings, or use Choose a photo.' : 'No camera available here. Use Choose a photo instead.');
    }
  }
  function stopCamera() { stopLive(); if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } video.srcObject = null; }
  function frameBox() {
    // where the on-screen card outline sits in the video's own pixels (the video is shown with object-fit: cover)
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
    const vb = video.getBoundingClientRect(), fb = frame.getBoundingClientRect();
    const s = Math.max(vb.width / vw, vb.height / vh), ox = (vb.width - vw * s) / 2, oy = (vb.height - vh * s) / 2;
    return [(fb.left - vb.left - ox) / s, (fb.top - vb.top - oy) / s, fb.width / s, fb.height / s];
  }

  // ---------- live scanning ----------
  let live = false, timer = null, inflight = false, lastKey = null, streak = 0, lockKey = null, away = 0;
  const keyOf = x => x ? x.name : '';   // printings of the same card count as the same card here
  function startLive() { live = true; lastKey = null; streak = 0; camBox.dataset.live = '1'; clearTimeout(timer); timer = setTimeout(tick, 300); }
  function stopLive() { live = false; clearTimeout(timer); camBox.dataset.live = ''; }
  function tick() {
    if (!live || !dlg.open) return;
    if (inflight || document.hidden || !video.videoWidth) { timer = setTimeout(tick, 250); return; }
    const b = frameBox(); if (!b) { timer = setTimeout(tick, 250); return; }
    inflight = true;
    match(video, camGuesses(b), { top: 6 }).then(onLive, e => { console.warn(e); say('The scanner couldn’t load its card data' + (navigator.onLine ? '' : ' (you’re offline)') + '. Type the card number below instead.', 'warn'); stopLive(); })
      .finally(() => { inflight = false; if (live) timer = setTimeout(tick, 150); });
  }
  // sure enough when the best match is close and clearly better than the next different card
  function nextOther(top) { return top.slice(1).find(y => !sameCard(top[0], y)); }
  function confident(top) { const a = top[0], b = nextOther(top); return !!a && a.d < ABS && (!b || (b.d - a.d) / b.d > REL); }
  function veryConfident(top) { const a = top[0], b = nextOther(top); return !!a && a.d < ABS * 0.5 && (!b || (b.d - a.d) / b.d > 0.5); }
  function onLive(top) {
    if (!live) return;
    const ok = confident(top), a = top[0], k = ok ? keyOf(a) : null;
    if (ok && k === lastKey) streak++; else { lastKey = k; streak = ok ? 1 : 0; }
    // in Stack mode, wait for the card to change (or be taken away) before the same card can be added again
    if (lockKey) { if (k !== lockKey) { if (++away >= 2) { lockKey = null; away = 0; } } else away = 0; }
    if (ok && (streak >= 2 || veryConfident(top)) && k !== lockKey) { found(top); return; }
    if (!lockKey) say(a && a.d < ABS * 1.25 ? 'Hold steady…' : 'Looking for a card… fill the outline with it.');
    camBox.dataset.near = a && a.d < ABS * 1.25 ? '1' : '';
  }
  async function found(top) {
    // claim the card straight away so the next frames don't add it twice while the number is being read
    if (mode === 'stack') { lockKey = keyOf(top[0]); away = 0; } else stopLive();
    if (stream) { const snap = document.createElement('canvas'); snap.width = video.videoWidth; snap.height = video.videoHeight; snap.getContext('2d').drawImage(video, 0, 0); top = await readNumber(snap, top); }
    try { if (navigator.vibrate) navigator.vibrate(mode === 'stack' && (priceOf(top[0]) || 0) >= pull ? [40, 60, 40] : 35); } catch (e) {}
    camBox.dataset.near = ''; camBox.classList.remove('flash'); void camBox.offsetWidth; camBox.classList.add('flash');
    if (mode === 'stack') {
      addToTray(top);
      const pv = priceOf(top[0]);
      say(`${(pv || 0) >= pull ? 'Pull this one: ' : 'Bulk: '}${top[0].name}${pv != null ? ' · ' + usd.format(pv) : ''}. Show the next card.`, 'ok');
    } else {
      show(top);
      shotBtn.textContent = 'Scan next card'; shotBtn.dataset.next = '1';
    }
  }

  // ---------- results ----------
  function say(t, kind) { statusEl.textContent = t; statusEl.dataset.kind = kind || ''; }
  function statusOf(c) { const s = state[c[0]]; return s === 'owned' ? 'In My Binder' : typeof listsOf === 'function' && listsOf(c[0]).length ? 'On a list' : ''; }
  function otherImg(pid) { return `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_200w.jpg`; }
  function otherPrice(pid) { const v = CAT && CAT.prices[pid]; return v == null ? null : v; }
  function rowHTML(x, best) {
    if (x.kind === 'chase') {
      const c = x.c, s = S[c[2]], st = statusOf(c);
      const opts = CONDS.map(([k, l]) => `<option value="${k}"${(cond[c[0]] || 'NM') === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
      return `<li class="scRow${best ? ' best' : ''}" data-id="${c[0]}">
      <button type="button" class="scImg" data-act="open" aria-label="Price chart for ${esc(c[1])}"><img src="${img(c, false)}" alt="" onerror="this.remove()"></button>
      <div class="scInfo"><b>${esc(c[1])} <span class="scChase">Chase</span></b><small>${esc(s[0])} · #${esc(c[3])}${s[3] ? '/' + s[3] : ''} · ${esc(LABEL[c[4]] || c[4])}</small>
        <span class="scPrice">${money(c[5])}${st ? ` <em>${st}</em>` : ''}</span>
        <div class="scAct"><button type="button" data-act="owned">Owned</button><button type="button" data-act="list">+ List</button>
          <select aria-label="Condition">${opts}</select></div>
        <span class="scDone" role="status"></span></div></li>`;
    }
    const r = x.r, set = r && CAT.sets[r[3]], p = otherPrice(x.pid);
    return `<li class="scRow other${best ? ' best' : ''}" data-pid="${x.pid}">
      <a class="scImg" href="https://www.tcgplayer.com/product/${x.pid}?Language=English" target="_blank" rel="noopener" aria-label="${esc(x.name)} on TCGplayer"><img src="${otherImg(x.pid)}" alt="" onerror="this.remove()"></a>
      <div class="scInfo"><b>${esc(x.name)}</b><small>${set ? esc(set[0]) + ' · ' : ''}${x.num ? '#' + esc(x.num) : ''}${r && r[4] ? ' · ' + esc(r[4]) : ''}</small>
        <span class="scPrice">${p == null ? '—' : usd.format(p)} <em class="muted">Not a chase card</em></span>
        <div class="scAct"><a class="scLink" href="https://www.tcgplayer.com/product/${x.pid}?Language=English" target="_blank" rel="noopener">TCGplayer ↗</a></div></div></li>`;
  }
  function show(top, how) {
    if (!top.length) { results.innerHTML = ''; say('No match found. Fill the outline with the card, or type the card number below.', 'warn'); return; }
    const byNum = how === 'number';
    const [a, b] = top, sure = byNum ? top.length === 1 : confident(top);
    say(byNum ? (top.length === 1 ? 'Found it:' : `${top.length} cards have that number. Tap the right one:`) : a.byNumber ? 'Found it (checked the card number):' : sure ? 'Found it:' : 'Closest matches. The first is most likely:', 'ok');
    const first = top.slice(0, 1), rest = top.slice(1, byNum ? 40 : 6);
    results.innerHTML = `<ol class="scList">${first.map(x => rowHTML(x, true)).join('')}</ol>` +
      (rest.length ? `<details class="scMore"${!sure || sameCard(a, b) ? ' open' : ''}><summary>${byNum ? 'Other cards with that number' : sameCard(a, b) ? 'Other printings of this card' : 'Not it? Other close matches'}</summary><ol class="scList">${rest.map(x => rowHTML(x, false)).join('')}</ol></details>` : '');
  }
  function onAct(e) {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const row = b.closest('.scRow'), id = row.dataset.id, c = byId[id];
    if (!c) return;
    if (b.dataset.act === 'open') { openDetail(c); return; }
    if (b.dataset.act === 'list') { window.openListPicker(id); return; }
    if (b.dataset.act === 'drop') { tray = tray.filter(t => t.key !== row.dataset.key); drawTray(); return; }
    const sel = row.querySelector('select'); if (sel && sel.value) cond[id] = sel.value;
    window.setStatus(id, 'owned');
    const done = row.querySelector('.scDone'); if (done) done.textContent = '✓ Added to My Binder';
    row.classList.add('done');
    const em = row.querySelector('.scPrice em'); if (em) em.textContent = 'In My Binder';
  }
  results.addEventListener('click', onAct);
  results.addEventListener('change', e => {
    const sel = e.target.closest('select'); if (!sel) return;
    const id = sel.closest('.scRow').dataset.id;
    if (state[id]) { cond[id] = sel.value; cache(); refresh(); }
  });

  // ---------- stack tray ----------
  let tray = [], pull = 1; try { pull = Number(localStorage.getItem('binder-scanPull') || 1); } catch (e) {}
  function addToTray(top) {
    const x = top[0];
    tray.unshift({ key: keyOf(x) + '#' + Date.now(), x, alts: top.slice(1, 4).filter(y => sameCard(x, y)) });
    drawTray();
  }
  function priceOf(x) { return x.kind === 'chase' ? x.c[5] : otherPrice(x.pid); }
  function drawTray() {
    if (!trayEl) return;
    trayEl.hidden = mode !== 'stack';
    if (mode !== 'stack') return;
    const tot = tray.reduce((s, t) => s + (priceOf(t.x) || 0), 0), chase = tray.filter(t => t.x.kind === 'chase');
    const keep = tray.filter(t => (priceOf(t.x) || 0) >= pull), kv = keep.reduce((s, t) => s + priceOf(t.x), 0);
    trayEl.innerHTML = `<div class="scTrayHd"><b>${tray.length} card${tray.length === 1 ? '' : 's'} scanned</b><span>${usd.format(tot)}</span></div>` +
      `<div class="scPull"><label>Pull out cards worth <select id="scPullSel">${[0.25, 0.5, 1, 2, 5, 10].map(v => `<option value="${v}"${v === pull ? ' selected' : ''}>${usd.format(v)}</option>`).join('')}</select> or more</label>${tray.length ? `<span><b>${keep.length}</b> to pull · ${usd.format(kv)}${tray.length - keep.length ? ` · ${tray.length - keep.length} bulk` : ''}</span>` : ''}</div>` +
      (tray.length ? `<div class="scTrayBtns">${chase.length ? `<button type="button" data-tray="own">Mark ${chase.length} chase card${chase.length === 1 ? '' : 's'} Owned</button>` : ''}<button type="button" data-tray="clear">Clear</button></div>` : '<p class="scHint">Show cards one after another. Each one is added here with its price.</p>') +
      `<ol class="scList">${tray.map(t => trayRow(t)).join('')}</ol>`;
  }
  function trayRow(t) {
    const x = t.x, p = priceOf(x);
    const pic = x.kind === 'chase' ? img(x.c, false) : otherImg(x.pid);
    const sub = x.kind === 'chase' ? S[x.c[2]][0] + ' · #' + x.c[3] : ((x.r && CAT.sets[x.r[3]]) ? CAT.sets[x.r[3]][0] + ' · ' : '') + (x.num ? '#' + x.num : '');
    const st = x.kind === 'chase' ? statusOf(x.c) : '';
    const isPull = (p || 0) >= pull;
    return `<li class="scRow mini${x.kind === 'chase' ? '' : ' other'}${isPull ? ' pull' : ' bulk'}" data-id="${x.kind === 'chase' ? x.c[0] : ''}" data-key="${esc(t.key)}"><span class="scImg"><img src="${pic}" alt="" onerror="this.remove()"></span>
      <div class="scInfo"><b>${esc(x.name)}${x.kind === 'chase' ? ' <span class="scChase">Chase</span>' : ''}</b><small>${esc(sub)}${t.alts.length ? ` · <span class="muted">${t.alts.length + 1} printings look alike</span>` : ''}</small>
      <span class="scPrice">${p == null ? '—' : usd.format(p)}${isPull ? ' <strong class="scPullTag">Pull</strong>' : ' <em class="muted">bulk</em>'}${st ? ` <em>${st}</em>` : ''}</span>
      <div class="scAct">${x.kind === 'chase' ? '<button type="button" data-act="owned">Owned</button><button type="button" data-act="list">+ List</button>' : ''}<button type="button" data-act="drop" aria-label="Remove from stack">Remove</button></div></div></li>`;
  }
  if (trayEl) {
    trayEl.addEventListener('change', e => { if (e.target.id === 'scPullSel') { pull = Number(e.target.value); try { localStorage.setItem('binder-scanPull', pull); } catch (er) {} drawTray(); } });
    trayEl.addEventListener('click', e => {
      const t = e.target.closest('button[data-tray]');
      if (t && t.dataset.tray === 'clear') { tray = []; drawTray(); return; }
      if (t && t.dataset.tray === 'own') { for (const x of tray) if (x.x.kind === 'chase' && state[x.x.c[0]] !== 'owned') window.setStatus(x.x.c[0], 'owned'); drawTray(); return; }
      onAct(e); if (e.target.closest('button[data-act="owned"]')) drawTray();
    });
  }
  function setMode(m) {
    mode = m; try { localStorage.setItem('binder-scanMode', m); } catch (e) {}
    if (modeEl) modeEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
    results.innerHTML = ''; lockKey = null; drawTray();
    shotBtn.textContent = 'Scan now'; delete shotBtn.dataset.next;
    if (stream && !live) startLive();
    say(m === 'stack' ? 'Stack mode: show cards one after another. Each one is added below.' : 'Point the camera at a card. It scans on its own.');
  }
  if (modeEl) modeEl.addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });

  // ---------- manual scan, photos, typed numbers ----------
  async function run(src, guesses) {
    if (busy) return; busy = true; shotBtn.disabled = true;
    results.innerHTML = '';
    say(engineN ? 'Matching…' : 'Getting the scanner ready…');
    try { const top = await readNumber(src, await match(src, guesses, { top: 10 })); if (mode === 'stack' && top[0]) { addToTray(top); say(`Added ${top[0].name}.`, 'ok'); } else show(top); }
    catch (e) { console.warn(e); say('The scanner couldn’t load its card data' + (navigator.onLine ? '' : ' (you’re offline)') + '. You can still type the card number below.', 'warn'); }
    busy = false; shotBtn.disabled = false;
  }
  shotBtn.addEventListener('click', () => {
    if (shotBtn.dataset.next) { delete shotBtn.dataset.next; shotBtn.textContent = 'Scan now'; results.innerHTML = ''; lastKey = null; streak = 0; startLive(); say('Point the camera at the next card.'); return; }
    const b = frameBox();
    if (!b) { say('The camera isn’t ready yet. Give it a second, or use Choose a photo.', 'warn'); return; }
    if (mode === 'one') stopLive();
    // freeze the frame first so the card can move while matching
    const snap = document.createElement('canvas'); snap.width = video.videoWidth; snap.height = video.videoHeight;
    snap.getContext('2d').drawImage(video, 0, 0);
    run(snap, camGuesses(b)).then(() => { if (mode === 'one') { shotBtn.textContent = 'Scan next card'; shotBtn.dataset.next = '1'; } });
  });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
    const url = URL.createObjectURL(f);
    const im = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
    URL.revokeObjectURL(url);
    if (!im) { say('That photo couldn’t be opened.', 'warn'); return; }
    stopLive();
    run(im, photoGuesses(im)).then(() => { if (stream && mode === 'one') { shotBtn.textContent = 'Scan next card'; shotBtn.dataset.next = '1'; } else if (stream) startLive(); });
  });
  // typed card number, e.g. 114/084 or TG08/TG30
  const normNum = s => { s = String(s).toUpperCase().replace(/\s+/g, ''); const m = s.match(/^([A-Z]*)0*(\d+)([A-Z]*)$/); return m ? m[1] + m[2] + m[3] : s; };
  manual.addEventListener('submit', async e => {
    e.preventDefault();
    const v = manIn.value.toUpperCase().replace(/\s+/g, '');
    const m = v.match(/^([A-Z]*\d+[A-Z]*)(?:\/([A-Z]*)(\d+))?$/);
    if (!m) { say('Type the number as it’s printed, like 114/084 or TG08/TG30.', 'warn'); results.innerHTML = ''; return; }
    const num = normNum(m[1]), tot = m[3] ? parseInt(m[3], 10) : null;
    let list = C.filter(c => normNum(c[3]) === num);
    if (tot != null) { const exact = list.filter(c => S[c[2]][3] === tot || (m[2] && c[3].startsWith(m[2]))); if (exact.length) list = exact; }
    list.sort((a, b) => S[b[2]][2].localeCompare(S[a[2]][2]));
    const out = list.map(c => ({ kind: 'chase', id: c[0], c, name: c[1], num: c[3], d: 0 }));
    try {
      await catalog();
      const pids = new Set(list.map(c => Number(c[6])));
      let others = CAT.list.filter(r => normNum(String(r[2]).split('/')[0]) === num && !pids.has(r[0]));
      if (tot != null) { const ex = others.filter(r => { const t = String(r[2]).split('/')[1]; return t && parseInt(t.replace(/\D/g, ''), 10) === tot; }); if (ex.length) others = ex; }
      others.sort((a, b) => String((CAT.sets[b[3]] || [])[2]).localeCompare(String((CAT.sets[a[3]] || [])[2])));
      for (const r of others.slice(0, 40)) out.push({ kind: 'other', id: 'p' + r[0], r, pid: r[0], name: r[1], num: r[2], d: 0 });
    } catch (err) { /* catalog unavailable: checklist only */ }
    if (!out.length) { results.innerHTML = ''; say(`No card numbered ${v} found.`, 'warn'); return; }
    stopLive();
    show(out, 'number');
    if (stream) { shotBtn.textContent = 'Scan next card'; shotBtn.dataset.next = '1'; }
  });
  $('scClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { stopCamera(); });
  window.binderScanOpen = () => {
    results.innerHTML = '';
    setMode(mode);
    dlg.showModal(); startCamera();
    engine().then(n => { if (!busy && live && !lockKey) say(mode === 'stack' ? 'Stack mode: show cards one after another.' : 'Point the camera at a card. It scans on its own.'); }).catch(() => {});
    catalog().catch(() => {});
  };
  window.binderScanTest = { engine, match, readNumber, numberStrip, ocrEngine, camGuesses, photoGuesses, frameBox, confident, setMode, catalog, resolve, addToTray, get tray() { return tray; } };
})();
