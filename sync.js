// Chase Card Binder - sync between devices (Firebase Auth + Firestore) and installable-app setup.
// The binder keeps working on its own if any of this fails; sync just lights up when it can.
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const KEYS = ['state', 'paid', 'cond'];
const $ = id => document.getElementById(id);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

const store = window.binderStore;
const btn = $('syncBtn'), txt = $('syncTxt'), dlg = $('syncDlg');

function ui(s, label) {
  if (!btn) return;
  btn.hidden = false; btn.dataset.s = s; txt.textContent = label;
}

// ---- helpers: three-way merge of {state, paid, cond} maps ----
const empty = () => ({ state: {}, paid: {}, cond: {} });
function norm(d) {
  const o = empty();
  if (!d) return o;
  for (const k of KEYS) if (d[k] && typeof d[k] === 'object') for (const [id, v] of Object.entries(d[k])) {
    if (k === 'state' && (v === 'owned' || v === 'wanted')) o.state[id] = v;
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
  const o = { state: { ...base.state }, paid: { ...base.paid }, cond: { ...base.cond } };
  if (ch) for (const k of KEYS) for (const [id, v] of Object.entries(ch[k])) { if (v === null) delete o[k][id]; else o[k][id] = v; }
  return o;
}
const same = (a, b) => !diff(a, b);

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
    const ch = diff(base, local);
    if (!ch) { status(); return; }
    if (!navigator.onLine) { status(); return; }
    pushing = true; status();
    const data = { t: S.serverTimestamp() };
    for (const k of KEYS) { data[k] = {}; for (const [id, v] of Object.entries(ch[k])) data[k][id] = v === null ? S.deleteField() : v; }
    const forUid = uid;
    try {
      await S.setDoc(S.doc(db, 'users', forUid), data, { merge: true });
      if (forUid === uid) { base = apply(base, ch); saveBase(uid, base); lastSync = new Date(); }
    } catch (e) {
      console.warn('Sync failed; will retry', e);
      setTimeout(schedule, 15000);
    }
    pushing = false;
    if (again) { again = false; schedule(); }
    status();
  }
  function schedule() { if (!uid) return; clearTimeout(timer); timer = setTimeout(push, 800); status(); }
  window.binderChanged = schedule;
  window.addEventListener('online', () => { status(); schedule(); });
  window.addEventListener('offline', status);

  function listen() {
    unsub = S.onSnapshot(S.doc(db, 'users', uid), snap => {
      if (snap.metadata.hasPendingWrites) return;
      const remote = norm(snap.exists() ? snap.data() : null);
      const local = norm(store.get());
      // Changes made on this device since it last synced (everything, the first time this device signs in)
      const mine = diff(base || empty(), local);
      const merged = apply(remote, mine);
      if (!same(merged, local)) store.set(merged.state, merged.paid, merged.cond);
      base = remote; saveBase(uid, base); lastSync = new Date();
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
