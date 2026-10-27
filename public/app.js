// Fridge Board phone/computer page.
//
// What this file does:
//   1. Connects to Firebase (or to the local emulators when run on localhost).
//   2. Handles Google sign-in and checks the household allowlist.
//   3. Listens live to the `items` collection and draws the Fridge and Meals
//      lists, plus the Archive and (for the owner) Household tabs.
//   4. Writes changes: add, edit, cross off / undo, delete, restore.
//   5. Archives items crossed off more than 24 hours ago whenever the page is
//      open, so no scheduled server job is needed (requirement FR-24).
//
// The list rules themselves (sorting, 24-hour hide, age and use-by flags) live
// in items.js so the fridge display can share them later.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, addDoc, updateDoc, deleteDoc, setDoc, writeBatch, onSnapshot,
  query, where, orderBy, limit, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { FIREBASE_CONFIG, APPCHECK_SITE_KEY, EMULATOR_CONFIG } from './firebase-config.js';
import {
  LISTS, listInfo, visibleList, needsArchive, isDone, showAge, ageDays, isExpiring,
  useByLabel, shortDate, toMillis, isoDay,
} from './items.js';

// ---------------------------------------------------------------------------
// Firebase setup
// ---------------------------------------------------------------------------

// On localhost we talk to the emulators started by `npm run dev`, never to the
// live project. Elsewhere we use the real config from firebase-config.js.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const config = LOCAL ? EMULATOR_CONFIG : FIREBASE_CONFIG;

if (!config) {
  document.getElementById('view-loading').innerHTML =
    '<p class="error">Firebase isn\'t configured yet. Paste your web config into firebase-config.js (see README).</p>';
  throw new Error('FIREBASE_CONFIG is not set');
}

const app = initializeApp(config);

// App Check (NF-11) makes it harder for anything but this page to use the
// project. It is loaded only when a site key has been set.
if (!LOCAL && APPCHECK_SITE_KEY) {
  const { initializeAppCheck, ReCaptchaV3Provider } =
    await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js');
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
}

const auth = getAuth(app);
// The persistent cache keeps the last lists on the device and queues writes
// made while offline (NF-2, NF-3).
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
if (LOCAL) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const itemsCol = collection(db, 'items');

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

const state = {
  user: null,          // Firebase user
  email: '',           // lowercase email, used as the allowlist key
  role: null,          // 'owner' | 'member'
  items: [],           // every non-archived item, kept live by onSnapshot
  tab: 'fridge',       // 'fridge' | 'meals' | 'archive' | 'household'
  archive: [],         // recently archived items (Archive tab only)
  household: [],       // allowlist entries (Household tab, owner only)
  armed: null,         // id of a button waiting for a second tap to confirm
};
let stopItems = null, stopArchive = null, stopHousehold = null;

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

// h('div', {class: 'x', onclick: fn}, child, 'text') builds an element.
// Children that are strings become text nodes, so user input is never parsed
// as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function show(viewId) {
  for (const id of ['view-loading', 'view-signin', 'view-denied', 'view-main']) $(id).hidden = id !== viewId;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Writes are applied locally at once and synced in the background, so most
// failures here are permission problems (e.g. removed from the allowlist).
const fail = (e) => { console.error(e); toast('That didn\'t save. Try reloading the page.'); };

// Destructive buttons need two taps: the first arms it (and changes its label
// to say what the second tap will do), the second acts. After 3 seconds
// without a second tap the button goes back to normal.
function confirmTap(key, button, label, action) {
  if (state.armed === key) { state.armed = null; action(); return; }
  state.armed = key;
  const original = button.textContent;
  button.textContent = label;
  button.classList.add('armed');
  setTimeout(() => {
    if (state.armed !== key) return;
    state.armed = null;
    button.textContent = original;
    button.classList.remove('armed');
  }, 3000);
}

// ---------------------------------------------------------------------------
// Sign-in and the allowlist check (ED-3)
// ---------------------------------------------------------------------------

$('signin').addEventListener('click', async () => {
  $('signin-error').hidden = true;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Some phone browsers block pop-ups; fall back to a full-page redirect.
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      $('signin-error').textContent = 'Sign-in didn\'t work. Please try again.';
      $('signin-error').hidden = false;
    }
  }
});

const doSignOut = () => signOut(auth);
$('denied-signout').addEventListener('click', doSignOut);
$('who').addEventListener('click', () => {
  // A deliberately simple account menu: one tap shows who you are, a second
  // tap within 3 seconds signs out.
  confirmTap('signout', $('who'), 'Tap again to sign out', doSignOut);
});

onAuthStateChanged(auth, async (user) => {
  stopListening();
  $('panel').dataset.tab = '';
  state.user = user;
  state.role = null;
  if (!user) { $('who').hidden = true; show('view-signin'); return; }

  state.email = (user.email || '').toLowerCase();
  $('who').textContent = user.displayName ? user.displayName.split(' ')[0] : state.email;
  $('who').hidden = false;

  // The allowlist entry is the only allowlist document a member may read, so
  // a missing entry or a permission error both mean "not on the list".
  try {
    const entry = await getDoc(doc(db, 'allowlist', state.email));
    if (!entry.exists()) throw new Error('not allowlisted');
    state.role = entry.data().role;
  } catch {
    $('denied-email').textContent = state.email;
    show('view-denied');
    return;
  }

  show('view-main');
  startListening();
});

// ---------------------------------------------------------------------------
// Live data
// ---------------------------------------------------------------------------

function startListening() {
  // Every item that hasn't been archived. Done items within their 24-hour
  // grace period are included so they can be shown struck through.
  stopItems = onSnapshot(query(itemsCol, where('archived_at', '==', null)), { includeMetadataChanges: true }, (snap) => {
    state.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $('offline').hidden = !snap.metadata.fromCache || navigator.onLine;
    archiveExpired();
    render();
  }, fail);
}

function stopListening() {
  for (const stop of [stopItems, stopArchive, stopHousehold]) stop?.();
  stopItems = stopArchive = stopHousehold = null;
}

// FR-24: mark items crossed off more than 24 hours ago as archived. Any open
// page does this, so if two pages do it at once they just write the same thing.
async function archiveExpired() {
  const due = state.items.filter((i) => needsArchive(i));
  if (!due.length) return;
  const batch = writeBatch(db);
  const now = Timestamp.now();
  for (const i of due) batch.update(doc(db, 'items', i.id), { archived_at: now });
  await batch.commit().catch(fail);
}

// Re-check every 5 minutes so ages, use-by flags and the 24-hour hide stay
// current on a page that's left open.
setInterval(() => { if (state.role) { archiveExpired(); render(); } }, 5 * 60 * 1000);
addEventListener('online', () => { $('offline').hidden = true; });
addEventListener('offline', () => { if (state.role) $('offline').hidden = false; });

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function addItem(listId, name) {
  addDoc(itemsCol, {
    list: listId, name, qty: null, use_by: null, note: null,
    added_at: Timestamp.now(), added_by: state.email,
    done_at: null, done_by: null, archived_at: null,
  }).catch(fail);
}

// FR-20/FR-21: tap to cross off, tap again within the grace period to undo.
function toggleDone(item) {
  const nowDone = !isDone(item);
  updateDoc(doc(db, 'items', item.id), {
    done_at: nowDone ? Timestamp.now() : null,
    done_by: nowDone ? state.email : null,
  }).catch(fail);
}

function restoreItem(item) {
  // Restoring keeps the original "added" date; edit it afterwards if the item
  // was actually bought again.
  updateDoc(doc(db, 'items', item.id), { done_at: null, done_by: null, archived_at: null })
    .then(() => toast(`${item.name} is back on ${listInfo(item.list).short}`), fail);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// Each tab's panel has two parts:
//   - a "shell" (title, help text, add box), built once when the tab opens;
//   - a "slot" holding the rows, redrawn on every data change.
// Keeping the shell in place means text half-typed into an add box isn't
// wiped out when someone else's change arrives.
let slot = null;

function render() {
  if (!state.role) return;
  renderTabs();
  const panel = $('panel');
  if (panel.dataset.tab !== state.tab) {
    panel.dataset.tab = state.tab;
    slot = h('div', { class: 'slot' });
    const shell = state.tab === 'archive' ? archiveShell()
      : state.tab === 'household' ? householdShell()
        : listShell(state.tab);
    panel.replaceChildren(...shell, slot);
  }
  slot.replaceChildren(
    state.tab === 'archive' ? archiveRows()
      : state.tab === 'household' ? householdRows()
        : listRows(state.tab),
  );
}

function renderTabs() {
  const tabs = [
    ...LISTS.map((l) => ({ id: l.id, label: l.short, count: visibleList(state.items, l.id).filter((i) => !isDone(i)).length })),
    { id: 'archive', label: 'Archive' },
    ...(state.role === 'owner' ? [{ id: 'household', label: 'People' }] : []),
  ];
  $('tabs').replaceChildren(...tabs.map((t) => h('button', {
    role: 'tab', class: 'tab', 'aria-selected': String(state.tab === t.id),
    onclick: () => switchTab(t.id),
  }, t.label, t.count != null ? h('span', { class: 'count' }, String(t.count)) : null)));
}

function switchTab(id) {
  state.tab = id;
  // The Archive and Household tabs subscribe only while they're open.
  stopArchive?.(); stopArchive = null;
  stopHousehold?.(); stopHousehold = null;
  if (id === 'archive') {
    stopArchive = onSnapshot(
      query(itemsCol, where('archived_at', '!=', null), orderBy('archived_at', 'desc'), limit(100)),
      (snap) => { state.archive = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); }, fail);
  }
  if (id === 'household') {
    stopHousehold = onSnapshot(collection(db, 'allowlist'),
      (snap) => { state.household = snap.docs.map((d) => ({ email: d.id, ...d.data() })); render(); }, fail);
  }
  render();
}

// One list (Fridge or Meals): title and quick-add box (ED-1).
function listShell(listId) {
  const info = listInfo(listId);
  const input = h('input', {
    class: 'add-input', placeholder: info.placeholder, maxlength: '120',
    autocomplete: 'off', enterkeyhint: 'done', 'aria-label': info.placeholder,
  });
  const form = h('form', {
    class: 'add',
    onsubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      addItem(listId, name);
      input.value = '';
      input.focus(); // stay ready for the next item
    },
  }, input, h('button', { class: 'primary', type: 'submit', 'aria-label': 'Add' }, 'Add'));
  return [h('h1', { class: 'list-title' }, info.title), form];
}

// The items of one list, in display order (items.js decides the order).
function listRows(listId) {
  const items = visibleList(state.items, listId);
  return items.length
    ? h('ul', { class: 'items' }, items.map((i) => itemRow(i)))
    : h('p', { class: 'empty' }, listId === 'meals' ? 'No meal ideas yet.' : 'Nothing in the fridge yet.');
}

function itemRow(item) {
  const done = isDone(item);
  const meta = [];
  if (item.qty) meta.push(h('span', {}, item.qty));
  if (showAge(item)) meta.push(h('span', { class: 'age', title: `Added ${shortDate(toMillis(item.added_at))}` }, clockIcon(), `${ageDays(item)}d`));
  if (item.use_by && !done) meta.push(h('span', { class: isExpiring(item) ? 'flag' : '' }, useByLabel(item.use_by)));
  if (item.note) meta.push(h('span', { class: 'note' }, item.note));

  return h('li', { class: `item${done ? ' done' : ''}${isExpiring(item) ? ' expiring' : ''}` },
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: done, onchange: () => toggleDone(item), 'aria-label': `${done ? 'Undo' : 'Cross off'} ${item.name}` }),
      h('span', { class: 'box', 'aria-hidden': 'true' })),
    h('button', { class: 'body', onclick: () => openEdit(item) },
      h('span', { class: 'name' }, item.name),
      meta.length ? h('span', { class: 'meta' }, meta) : null));
}

function clockIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
  return svg;
}

// Archive tab (ED-7): the 100 most recently archived items, with Restore.
function archiveShell() {
  return [
    h('h1', { class: 'list-title' }, 'Archive'),
    h('p', { class: 'muted small' }, 'Items crossed off more than a day ago. Nothing is deleted.'),
  ];
}

function archiveRows() {
  const rows = state.archive.map((i) => h('li', { class: 'item archived' },
    h('div', { class: 'body static' },
      h('span', { class: 'name' }, i.name),
      h('span', { class: 'meta' },
        h('span', { class: 'chip' }, listInfo(i.list).short),
        h('span', {}, `Crossed off ${shortDate(toMillis(i.done_at) ?? toMillis(i.archived_at))}`))),
    h('button', { class: 'ghost small', onclick: () => restoreItem(i) }, 'Restore')));
  return rows.length ? h('ul', { class: 'items' }, rows) : h('p', { class: 'empty' }, 'Nothing archived yet.');
}

// Household tab (owner only, labelled "People"): manage the allowlist
// (ED-3, NF-10).
function householdShell() {
  const input = h('input', { type: 'email', placeholder: 'name@gmail.com', autocomplete: 'off', 'aria-label': 'Google account email', required: true });
  const form = h('form', {
    class: 'add',
    onsubmit: (e) => {
      e.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!email) return;
      setDoc(doc(db, 'allowlist', email), { role: 'member', added_at: Timestamp.now() })
        .then(() => { input.value = ''; toast(`${email} can now sign in`); }, fail);
    },
  }, input, h('button', { class: 'primary', type: 'submit' }, 'Add'));
  return [
    h('h1', { class: 'list-title' }, 'Household'),
    h('p', { class: 'muted small' }, 'Only these Google accounts can sign in. Add the fridge display\'s account here too.'),
    form,
  ];
}

// Owner first, then everyone else alphabetically. The owner has no Remove
// button on their own row (the rules forbid it anyway).
function householdRows() {
  const people = [...state.household].sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.email.localeCompare(b.email));
  const rows = people.map((p) => {
    const me = p.email === state.email;
    const remove = me ? null : h('button', {
      class: 'ghost small',
      onclick: (e) => confirmTap(`rm:${p.email}`, e.currentTarget, 'Confirm', () =>
        deleteDoc(doc(db, 'allowlist', p.email)).then(() => toast(`Removed ${p.email}`), fail)),
    }, 'Remove');
    return h('li', { class: 'item' },
      h('div', { class: 'body static' },
        h('span', { class: 'name' }, p.email),
        h('span', { class: 'meta' }, h('span', { class: 'chip' }, p.role === 'owner' ? 'Owner' : 'Member'), me ? h('span', {}, 'You') : null)),
      remove);
  });

  return h('ul', { class: 'items' }, rows);
}

// ---------------------------------------------------------------------------
// Edit dialog (FR-2, FR-3, FR-11, FR-12, backdating via "Added on")
// ---------------------------------------------------------------------------

let editing = null;
const editForm = $('edit-form');

function openEdit(item) {
  editing = item;
  const f = editForm.elements;
  const info = listInfo(item.list);
  $('edit-title').textContent = info.id === 'meals' ? 'Edit meal' : 'Edit item';
  f.name.value = item.name;
  f.qty.value = item.qty || '';
  f.use_by.value = item.use_by || '';
  f.note.value = item.note || '';
  f.added_on.value = isoDay(toMillis(item.added_at) ?? Date.now());
  f.added_on.max = isoDay(Date.now());
  // Quantity and use-by only apply to inventory lists.
  for (const el of editForm.querySelectorAll('[data-only="tracksAge"]')) el.hidden = !info.tracksAge;
  const by = item.added_by ? ` by ${item.added_by}` : '';
  $('edit-meta').textContent = `Added ${shortDate(toMillis(item.added_at))}${by}.`;
  $('edit-delete').textContent = 'Delete';
  $('edit-delete').classList.remove('armed');
  $('edit').showModal();
}

editForm.addEventListener('submit', () => {
  if (!editing) return;
  const f = editForm.elements;
  const name = f.name.value.trim();
  if (!name) return;
  // Keep the original time of day when only the date changes, so items added
  // the same day keep their relative order.
  const old = new Date(toMillis(editing.added_at) ?? Date.now());
  const [y, m, d] = f.added_on.value.split('-').map(Number);
  const added = new Date(y, m - 1, d, old.getHours(), old.getMinutes(), old.getSeconds());
  updateDoc(doc(db, 'items', editing.id), {
    name,
    qty: f.qty.value.trim() || null,
    use_by: f.use_by.value || null,
    note: f.note.value.trim() || null,
    added_at: Timestamp.fromDate(added),
  }).catch(fail);
  editing = null;
});

$('edit-cancel').addEventListener('click', () => { editing = null; $('edit').close(); });

$('edit-delete').addEventListener('click', (e) => {
  const item = editing;
  confirmTap(`del:${item.id}`, e.currentTarget, 'Tap again to delete', () => {
    deleteDoc(doc(db, 'items', item.id)).then(() => toast(`Deleted ${item.name}`), fail);
    editing = null;
    $('edit').close();
  });
});
