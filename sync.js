// Chase Card Binder - sync between devices (Firebase Auth + Firestore) and installable-app setup.
// The binder keeps working on its own if any of this fails; sync just lights up when it can.
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const KEYS = ['state', 'paid', 'cond', 'lists', 'lm', 'bd', 'cfg'];
const $ = id => document.getElementById(id);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

const store = window.binderStore;
const btn = $('syncBtn'), txt = $('syncTxt'), dlg = $('syncDlg');

function ui(s, label) {
  if (!btn) return;
  btn.hidden = false; btn.dataset.s = s; txt.textContent = label;
}

// ---- helpers: three-way merge of {state, paid, cond, lists, lm} maps ----
const empty = () => ({ state: {}, paid: {}, cond: {}, lists: {}, lm: {}, bd: {}, cfg: {} });
function norm(d) {
  const o = empty();
  if (!d) return o;
  for (const k of KEYS) if (d[k] && typeof d[k] === 'object') for (const [id, v] of Object.entries(d[k])) {
    if (k === 'state' && (v === 'owned' || v === 'wanted')) o.state[id] = v;
    else if (k === 'lists' && typeof v === 'string' && v) o.lists[id] = v;
    else if (k === 'lm' && v === 1) o.lm[id] = 1;
    else if (k === 'bd' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) o.bd[id] = v;
    else if (k === 'cfg' && ((typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.length < 600))) o.cfg[id] = v;
    else if (k === 'paid' && typeof v === 'number' && isFinite(v) && v >= 0) o.paid[id] = v;
    else if (k === 'cond' && typeof v === 'string' && v) o.cond[id] = v;
  }
  return o;
}
// changes needed to turn a into b: {state:{id: value|null}, ...}; null = delete
function diff(a, b) {
  const c = empty(); let n = 0;
  for (const k of KEYS) {
    for (const id in b[k]) if (a[k][id] !== b[k][id]) { c[k][id] = b[k][id]; n++; }
    for (const id in a[k]) if (!(id in b[k])) { c[k][id] = null; n++; }
  }
  return n ? c : null;
}
function apply(base, ch) {
  const o = { state: { ...base.state }, paid: { ...base.paid }, cond: { ...base.cond }, lists: { ...base.lists }, lm: { ...base.lm }, bd: { ...base.bd }, cfg: { ...base.cfg } };
  if (ch) for (const k of KEYS) for (const [id, v] of Object.entries(ch[k])) { if (v === null) delete o[k][id]; else o[k][id] = v; }
  return o;
}
const same = (a, b) => !diff(a, b);
// A big drop in marks that the person didn't ask for (anything but Restore / Undo) is never passed on:
// the deletions are dropped, so the other copy wins and the marks come back.
function guardMass(ch, base) {
  if (!ch) return ch;
  if (base && base.state && typeof Object.values(base.state)[0] === 'string') base = { state: base };   // older callers passed just the marks
  const bulk = window.binderBulk && Date.now() - window.binderBulk < 120000;
  for (const k of ['state', 'lm']) {
    const dels = Object.keys(ch[k]).filter(id => ch[k][id] === null);
    if (dels.length >= 5 && dels.length > Object.keys((base && base[k]) || {}).length * 0.2 && !bulk) {
      for (const id of dels) delete ch[k][id];
      console.warn('Sync: ignored removal of ' + dels.length + ' ' + (k === 'lm' ? 'list entries' : 'marks') + ' that wasn\u2019t asked for');
    }
  }
  let n = 0; for (const k of KEYS) n += Object.keys(ch[k]).length;
  return n ? ch : null;
}

const baseKey = uid => 'binder-sync-base-' + uid;
function loadBase(uid) { try { const s = localStorage.getItem(baseKey(uid)); return s ? norm(JSON.parse(s)) : null; } catch (e) { return null; } }
function saveBase(uid, b) { try { localStorage.setItem(baseKey(uid), JSON.stringify(b)); } catch (e) {} }

async function start() {
  if (!store || !btn) return;
  let cfg;
  try { cfg = (await import('./firebase-config.js')).default; } catch (e) { return; }
  if (!cfg || !cfg.apiKey) return;
  ui('busy', 'Connecting…');
  let A, F, S;
  try {
    [A, F, S] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  } catch (e) { ui('off', 'Sync unavailable offline'); return; }
  const app = A.initializeApp(cfg);
  const auth = F.getAuth(app);
  const db = S.getFirestore(app);

  let uid = null, unsub = null, base = null, timer = null, pushing = false, again = false, lastSync = null;

  function status() {
    if (!uid) { ui('out', 'Sign in to sync'); store.msg('Your checklist saves in this browser. Sign in to sync it across your devices.'); return; }
    if (!navigator.onLine) { ui('off', 'Offline — will sync'); store.msg('You’re offline. Changes save here and sync when you’re back online.'); return; }
    if (pushing || timer) { ui('busy', 'Syncing…'); return; }
    ui('ok', 'Synced');
    store.msg('Synced across your devices.');
  }

  async function push() {
    timer = null;
    if (!uid || !base) return;
    if (pushing) { again = true; return; }
    const local = norm(store.get());
    const ch = guardMass(diff(base, local), base);
    if (!ch) { status(); return; }
    if (!navigator.onLine) { status(); return; }
    pushing = true; status();
    const data = { t: S.serverTimestamp() };
    // Only send the kinds of data that changed. (An empty {} sent with merge would REPLACE that whole list on the
    // server with nothing, which is what wiped marks and paid prices before.)
    for (const k of KEYS) {
      const ids = Object.keys(ch[k]); if (!ids.length) continue;
      data[k] = {}; for (const id of ids) data[k][id] = ch[k][id] === null ? S.deleteField() : ch[k][id];
    }
    const forUid = uid;
    try {
      await S.setDoc(S.doc(db, 'users', forUid), data, { merge: true });
      if (forUid === uid) { base = apply(base, ch); saveBase(uid, base); lastSync = new Date(); shareAlerts(); }
    } catch (e) {
      console.warn('Sync failed; will retry', e);
      setTimeout(schedule, 15000);
    }
    pushing = false;
    if (again) { again = false; schedule(); }
    status();
  }
  // For the deal alerts on GitHub: which cards you own (ids only) and your alert settings, in a separate document
  // the alert job can read. Your prices, conditions and lists stay private. Only sent when something changed.
  let lastShared = '';
  function shareAlerts() {
    if (!uid) return;
    const d = store.get(), owned = Object.keys(d.state).filter(id => d.state[id] === 'owned').sort();
    const c = d.cfg || {}, pick = {};
    for (const k of ['alertOn', 'alertPct', 'lowMin', 'lowPct', 'lpOn', 'lpMin', 'lpPct', 'bad', 'cheapN', 'cheapMax', 'liveMin', 'liveMax']) if (c[k] != null) pick[k] = c[k];
    const body = JSON.stringify({ o: owned, c: pick });
    if (body === lastShared) return;
    S.setDoc(S.doc(db, 'alerts', uid), { owned: owned.join(','), cfg: pick, t: S.serverTimestamp() }).then(() => { lastShared = body; }).catch(e => console.warn('Alert settings not shared yet (Firebase rules?)', e && e.code));
  }
  function schedule() { if (!uid) return; clearTimeout(timer); timer = setTimeout(push, 800); status(); }
  window.binderChanged = schedule;
  // send any waiting change right away when the app is closed or put in the background
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); push(); } });
  window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); push(); } });
  window.addEventListener('online', () => { status(); schedule(); });
  window.addEventListener('offline', status);

  function listen() {
    unsub = S.onSnapshot(S.doc(db, 'users', uid), { includeMetadataChanges: true }, snap => {
      // Only trust answers that come from the server. While the phone is still reconnecting (for example right
      // after the app comes back from the background), Firebase can report the saved copy as missing or stale.
      if (snap.metadata.hasPendingWrites || snap.metadata.fromCache) return;
      const remote = norm(snap.exists() ? snap.data() : null);
      const local = norm(store.get());
      const b = base || empty();
      // Changes made on this device since it last synced (everything, the first time this device signs in)
      let mine = guardMass(diff(b, local), b);
      // Safety net: never let the saved copy wipe out lots of marks at once. If it is missing, or would remove
      // many marks this device still has, keep this device's marks and send them back up instead.
      const removed = Object.keys(b.state).filter(id => !(id in remote.state) && id in local.state).length;
      const total = Object.keys(local.state).length;
      if (!snap.exists() || (removed >= 5 && removed > total * 0.2)) {
        if (removed || !snap.exists()) console.warn('Sync: kept ' + total + ' local marks instead of removing ' + removed);
        mine = diff(empty(), local);
      }
      const merged = apply(remote, mine);
      if (!same(merged, local)) { store.backup && store.backup('before sync'); store.set(merged.state, merged.paid, merged.cond, merged.lists, merged.lm, merged.bd, merged.cfg); }
      base = remote; saveBase(uid, base); lastSync = new Date(); shareAlerts();
      if (mine && !same(merged, remote)) schedule(); else status();
    }, err => { console.warn('Sync listener error', err); ui('off', 'Sync paused'); });
  }

  F.onAuthStateChanged(auth, user => {
    if (unsub) { unsub(); unsub = null; }
    clearTimeout(timer); timer = null;
    uid = user ? user.uid : null;
    base = uid ? loadBase(uid) : null;
    showDialogState(user);
    status();
    if (uid) listen();
  });

  // ---- sign-in dialog ----
  const err = $('sdErr');
  const MSG = {
    'auth/invalid-credential': 'That email and password don’t match. Check them, or use Create account if this is your first time.',
    'auth/wrong-password': 'That password isn’t right.',
    'auth/user-not-found': 'No account with that email yet. Use Create account.',
    'auth/email-already-in-use': 'That email already has an account. Use Sign in instead.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-email': 'Check the email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
    'auth/network-request-failed': 'No connection. Try again when you’re online.',
    'auth/operation-not-allowed': 'Email sign-in isn’t switched on in Firebase yet (Authentication → Sign-in method).'
  };
  const say = e => { err.textContent = MSG[e && e.code] || ('Something went wrong' + (e && e.code ? ' (' + e.code + ')' : '') + '. Try again.'); };
  function showDialogState(user) {
    $('sdOut').hidden = !!user; $('sdInOk').hidden = !user;
    if (user) $('sdWho').textContent = user.email || 'your account';
    err.textContent = '';
  }
  btn.addEventListener('click', () => {
    showDialogState(auth.currentUser);
    $('sdWhen').textContent = lastSync ? 'Last synced ' + lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.' : '';
    dlg.showModal();
    if (!auth.currentUser) $('sdEmail').focus();
  });
  $('sdClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  $('sdForm').addEventListener('submit', async e => {
    e.preventDefault();
    const which = e.submitter ? e.submitter.value : 'in';
    const email = $('sdEmail').value.trim(), pass = $('sdPass').value;
    if (!email) { err.textContent = 'Enter your email.'; return; }
    if (!pass) { err.textContent = 'Enter your password.'; return; }
    const bs = dlg.querySelectorAll('#sdOut button'); bs.forEach(b => b.disabled = true); err.textContent = '';
    try {
      if (which === 'new') await F.createUserWithEmailAndPassword(auth, email, pass);
      else await F.signInWithEmailAndPassword(auth, email, pass);
      $('sdPass').value = '';
      dlg.close();
    } catch (x) { say(x); }
    bs.forEach(b => b.disabled = false);
  });
  $('sdReset').addEventListener('click', async () => {
    const email = $('sdEmail').value.trim();
    if (!email) { err.textContent = 'Enter your email first, then tap Forgot password.'; return; }
    try { await F.sendPasswordResetEmail(auth, email); err.textContent = 'Check your email for a reset link.'; } catch (x) { say(x); }
  });
  $('sdOutBtn').addEventListener('click', async () => {
    await push();
    await F.signOut(auth);
    dlg.close();
  });
}

start().catch(e => { console.warn('Sync could not start', e); });
