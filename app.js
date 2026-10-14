'use strict';
/* Budget & Bill Splitter — data lives in this browser (localStorage).
   Back it up or move it with Export / Import JSON in the Budget tab. */

const LS_KEY = 'billsplit.v1';
const CATEGORIES = [
  { name: 'Housing', emoji: '🏠' },
  { name: 'Utilities & Bills', emoji: '📱' },
  { name: 'Groceries', emoji: '🛒' },
  { name: 'Dining Out', emoji: '🍽️' },
  { name: 'Personal Care', emoji: '💅' },
  { name: 'Transport', emoji: '🚗' },
  { name: 'Entertainment', emoji: '🎬' },
  { name: 'Health', emoji: '💊' },
  { name: 'Shopping', emoji: '👕' },
  { name: 'Other', emoji: '📦' }
];
const catEmoji = n => (CATEGORIES.find(c => c.name === n) || { emoji: '📦' }).emoji;
const CAT_COLORS = {
  'Housing': '#4e79a7', 'Utilities & Bills': '#f28e2b', 'Groceries': '#59a14f',
  'Dining Out': '#e15759', 'Personal Care': '#b07aa1', 'Transport': '#17a398',
  'Entertainment': '#d9a404', 'Health': '#ef6f9c', 'Shopping': '#9c755f', 'Other': '#8d8d93'
};
const catColor = n => CAT_COLORS[n] || '#5b8def';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = n => '$' + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSigned = n => (n < 0 ? '−' : '') + fmt(n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const monthKey = d => d.slice(0, 7);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthLabel = key => MONTHS[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4);
const shiftMonth = (key, delta) => {
  const d = new Date(+key.slice(0, 4), +key.slice(5, 7) - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
const nowMonthKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const displayDate = iso => {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} · ${hh}:${mm}`;
};

/* ---------- cloud sync (Firebase Firestore, shared by all phones) ---------- */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCzleGE2qWif60DXoxaYGA3kqOuv1Xp94Y",
  authDomain: "billsplit-a7148.firebaseapp.com",
  projectId: "billsplit-a7148",
  storageBucket: "billsplit-a7148.firebasestorage.app",
  messagingSenderId: "356199360313",
  appId: "1:356199360313:web:880d18351664af49a3eae8"
};
const HOUSEHOLD_ID = 'hh_9e489c5a2d3acedf88fbc07b';
let houseRef = null, lastPushed = '', pushTimer = null, syncStarted = false, pendingPush = false;
function schedulePush() {
  if (!houseRef) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 700);
}
function pushNow() {
  if (!houseRef) return;
  if (!syncStarted) { pendingPush = true; return; }
  const payload = JSON.stringify(state);
  lastPushed = payload;
  houseRef.set({ state: payload, updatedAt: new Date().toISOString() }).catch(e => console.warn('Cloud push failed', e));
}
function adoptRemote(remote) {
  try {
    const parsed = JSON.parse(remote);
    if (!parsed || !Array.isArray(parsed.expenses) || !Array.isArray(parsed.people)) return;
    state = parsed;
    try { localStorage.setItem(LS_KEY, remote); } catch (e) {}
    const months = [...new Set(state.expenses.map(e => monthKey(e.date)))].sort();
    if (!months.includes(viewMonth)) viewMonth = months.length ? months[months.length - 1] : nowMonthKey();
    render();
  } catch (e) { console.warn('Could not apply cloud data', e); }
}
function initSync() {
  const el = document.getElementById('syncStatus');
  if (!window.firebase || !FIREBASE_CONFIG) { if (el) el.textContent = '☁️ Cloud sync unavailable — data is stored on this device only.'; return; }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    houseRef = firebase.firestore().collection('households').doc(HOUSEHOLD_ID);
    houseRef.onSnapshot(snap => {
      const wasFirst = !syncStarted;
      syncStarted = true;
      if (el) el.textContent = '☁️ Cloud sync ON — every phone with this app sees the same data, live.';
      if (!snap.exists) { pushNow(); return; }
      const remote = snap.data().state;
      if (!remote || remote === lastPushed) { if (pendingPush) { pendingPush = false; pushNow(); } return; }
      if (wasFirst) {
        try {
          const rp = JSON.parse(remote);
          if ((state.expenses || []).length > (rp.expenses || []).length) { pushNow(); return; }
        } catch (e) {}
      }
      adoptRemote(remote);
      if (pendingPush) { pendingPush = false; pushNow(); }
    }, err => {
      console.warn('Cloud sync error', err);
      if (el) el.textContent = '☁️ Cloud sync could not connect — data still saves on this device.';
    });
  } catch (e) {
    console.warn('Cloud sync init failed', e);
    if (el) el.textContent = '☁️ Cloud sync unavailable — data is stored on this device only.';
  }
}

function seedState() {
  const personal = (title, amount, category, date) => ({
    id: uid() + Math.random().toString(36).slice(2, 6), title, amount, category, date,
    paidBy: 'you', splits: [{ personId: 'you', share: amount }]
  });
  return {
    settings: { monthlyBudget: 3000, categoryBudgets: {} },
    people: [{ id: 'you', name: 'You' }],
    expenses: [
      personal('Rent', 1548.43, 'Housing', '2026-09-01T09:00'),
      personal('Utilities & bills', 62.77, 'Utilities & Bills', '2026-09-02T09:00'),
      personal('Other expenses', 96.69, 'Other', '2026-09-03T09:00'),
      personal('Iqbal Food 3rd Sep', 27.75, 'Groceries', '2026-09-04T01:44'),
      personal('Food Basics 4th Sep', 20.69, 'Groceries', '2026-09-05T22:56'),
      personal('Shoppers 4th Sep', 47.93, 'Personal Care', '2026-09-05T22:58'),
      personal('Lindt 5th Sep', 19.00, 'Dining Out', '2026-09-09T02:16'),
      personal('Walmart order personal items 11th Sep', 67.21, 'Groceries', '2026-09-11T13:25')
    ],
    recurring: [],
    settlements: []
  };
}

let state;
try {
  const raw = localStorage.getItem(LS_KEY);
  state = raw ? JSON.parse(raw) : seedState();
  if (!raw) save();
} catch (e) { state = seedState(); }
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} schedulePush(); }

let viewMonth = (() => {
  const months = [...new Set(state.expenses.map(e => monthKey(e.date)))].sort();
  return months.length ? months[months.length - 1] : nowMonthKey();
})();
let activeTab = 'summary';

/* ---------- balances ---------- */
function personName(id) { const p = state.people.find(p => p.id === id); return p ? p.name : 'Someone'; }
function netBalances() {
  const net = {}; state.people.forEach(p => net[p.id] = 0);
  state.expenses.forEach(e => {
    if (!(e.paidBy in net)) return;
    net[e.paidBy] += e.amount;
    (e.splits || []).forEach(s => { if (s.personId in net) net[s.personId] -= s.share; });
  });
  state.settlements.forEach(s => {
    if (s.from in net) net[s.from] += s.amount;
    if (s.to in net) net[s.to] -= s.amount;
  });
  Object.keys(net).forEach(k => net[k] = round2(net[k]));
  return net;
}
function debtPairs() {
  const net = netBalances();
  const debtors = Object.keys(net).filter(id => net[id] < -0.004).map(id => ({ id, amt: -net[id] }));
  const creditors = Object.keys(net).filter(id => net[id] > 0.004).map(id => ({ id, amt: net[id] }));
  const pairs = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = round2(Math.min(debtors[i].amt, creditors[j].amt));
    if (pay > 0) pairs.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amt = round2(debtors[i].amt - pay);
    creditors[j].amt = round2(creditors[j].amt - pay);
    if (debtors[i].amt <= 0.004) i++;
    if (creditors[j].amt <= 0.004) j++;
  }
  return pairs;
}

/* ---------- rendering ---------- */
const $ = id => document.getElementById(id);
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}
function monthExpenses(key) { return state.expenses.filter(e => monthKey(e.date) === key); }
function expenseRow(e, showDate) {
  const shared = (e.splits || []).length > 1;
  const meta = (showDate ? displayDate(e.date) : displayDate(e.date)) +
    (shared ? '' : '') ;
  const payer = shared ? `<span class="badge">${esc(personName(e.paidBy))} paid · split ${(e.splits || []).length} ways</span>` : '';
  return `<div class="exp-row" data-edit="${e.id}">
    <div class="exp-emoji" style="background:${catColor(e.category)}26">${catEmoji(e.category)}</div>
    <div class="exp-main"><div class="exp-title">${esc(e.title)}${payer}</div>${e.note ? `<div class="exp-note">${esc(e.note)}</div>` : ''}<div class="exp-meta">${meta} · ${esc(e.category)}</div></div>
    <div class="exp-amt">${fmt(e.amount)}</div><button type="button" class="exp-dupe" data-duplicate="${e.id}" title="Duplicate this expense" aria-label="Duplicate this expense">⧉</button></div>`;
}

function render() {
  const ms = $('monthSelect'), ys = $('yearSelect');
  if (ms) ms.value = viewMonth.slice(5, 7);
  if (ys) {
    const y = viewMonth.slice(0, 4);
    if (![...ys.options].some(o => o.value === y)) ys.add(new Option(y, y));
    ys.value = y;
  }
  renderSummary(); renderExpenses(); renderSplit(); renderBudget();
}

function renderSummary() {
  const list = monthExpenses(viewMonth);
  const spent = round2(list.reduce((a, e) => a + e.amount, 0));
  const budget = state.settings.monthlyBudget || 0;
  const remaining = round2(budget - spent);
  const pct = budget > 0 ? Math.min(100, spent / budget * 100) : 0;
  $('statSpent').textContent = fmt(spent);
  $('statBudget').textContent = fmt(budget);
  $('statRemaining').textContent = (remaining < 0 ? '−' : '') + fmt(remaining);
  $('statRemaining').style.color = remaining < 0 ? 'var(--danger)' : '';
  $('ringPct').textContent = (budget > 0 ? (spent / budget * 100) : 0).toFixed(1) + '%';
  $('ringPct').style.color = remaining < 0 ? 'var(--danger)' : '';

  const prev = monthExpenses(shiftMonth(viewMonth, -1));
  const prevSpent = round2(prev.reduce((a, e) => a + e.amount, 0));
  $('monthDelta').innerHTML = prevSpent > 0
    ? `Last month: <b>${fmt(prevSpent)}</b> · ${spent <= prevSpent ? '▼' : '▲'} <b>${fmt(Math.abs(round2(spent - prevSpent)))}</b> ${spent <= prevSpent ? 'less' : 'more'} this month`
    : 'No expenses last month to compare.';

  const byCat = {};
  list.forEach(e => byCat[e.category] = round2((byCat[e.category] || 0) + e.amount));
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  const max = cats.length ? byCat[cats[0]] : 0;
  $('categoryBreakdown').innerHTML = cats.length ? cats.map(c => {
    const limit = state.settings.categoryBudgets[c];
    const over = limit && byCat[c] > limit;
    const sub = limit ? `<div class="cat-sub">${over ? '⚠ Over' : 'Budget'} ${fmt(limit)}${over ? ` by ${fmt(byCat[c] - limit)}` : ''}</div>` : '';
    return `<div class="cat-row" data-gocat="${esc(c)}">
      <div class="cat-name">${catEmoji(c)} ${esc(c)}</div><div class="cat-amt">${fmt(byCat[c])}</div>
      <div class="cat-bar"><div class="cat-fill ${over ? 'over' : ''}" style="width:${max ? byCat[c] / max * 100 : 0}%;background:${catColor(c)}"></div></div>${sub}</div>`;
  }).join('') : '<div class="empty">No expenses this month yet.<br>Tap ＋ to add your first one.</div>';

  // Donut ring: one coloured segment per category, sized by its share
  const RC = 326.7;
  const denom = (budget > 0 && spent <= budget) ? budget : (spent || 1);
  let acc = 0;
  $('ringSegs').innerHTML = cats.map(c => {
    const len = byCat[c] / denom * RC;
    const gap = cats.length > 1 ? 2.5 : 0;
    const seg = `<circle class="ring-seg" cx="60" cy="60" r="52" stroke="${catColor(c)}" stroke-dasharray="${Math.max(0.5, len - gap)} ${RC}" stroke-dashoffset="${-acc}"></circle>`;
    acc += len;
    return seg;
  }).join('');

  const pairs = debtPairs();
  $('balanceSnapshot').innerHTML = pairs.length
    ? pairs.slice(0, 4).map(p => `<div class="balance-row"><span><b>${esc(personName(p.from))}</b> owes <b>${esc(personName(p.to))}</b></span><b>${fmt(p.amount)}</b></div>`).join('')
    : '<div class="empty">All settled up 🎉</div>';

  const recent = [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('recentList').innerHTML = recent.length ? recent.map(e => expenseRow(e, true)).join('') : '<div class="empty">Nothing here yet.</div>';
}

function renderExpenses() {
  const q = ($('searchInput').value || '').toLowerCase();
  const cf = $('categoryFilter').value || 'all';
  let list = monthExpenses(viewMonth);
  if (cf !== 'all') list = list.filter(e => e.category === cf);
  if (q) list = list.filter(e => e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.note || '').toLowerCase().includes(q));
  list = [...list].sort((a, b) => b.date.localeCompare(a.date));
  const total = round2(list.reduce((a, e) => a + e.amount, 0));
  $('expensesTotal').textContent = list.length ? `${list.length} expense${list.length === 1 ? '' : 's'} · ${fmt(total)}` : '';
  $('expenseList').innerHTML = list.length ? list.map(e => expenseRow(e, true)).join('') : '<div class="empty">No expenses match.</div>';
}

function renderSplit() {
  $('peopleList').innerHTML = state.people.map(p =>
    `<span class="person-chip">${esc(p.name)}${p.id !== 'you' ? `<button data-del-person="${p.id}" aria-label="Remove ${esc(p.name)}">×</button>` : ''}</span>`).join('');
  const pairs = debtPairs();
  $('balanceList').innerHTML = pairs.length
    ? pairs.map((p, i) => `<div class="balance-row"><span><b>${esc(personName(p.from))}</b> owes <b>${esc(personName(p.to))}</b></span><span><b>${fmt(p.amount)}</b> <button class="settle-btn" data-settle="${i}">Settle up</button></span></div>`).join('')
    : '<div class="empty">All settled up 🎉<br><span class="settled-note">Add a split expense with ＋ to track who owes whom.</span></div>';
  const st = [...state.settlements].sort((a, b) => b.date.localeCompare(a.date));
  $('settlementList').innerHTML = st.length
    ? st.slice(0, 12).map(s => `<div class="balance-row"><span><b>${esc(personName(s.from))}</b> paid <b>${esc(personName(s.to))}</b></span><span><b>${fmt(s.amount)}</b> <span class="settled-note">${displayDate(s.date)}</span></span></div>`).join('')
    : '<div class="empty">No settlements yet.</div>';
}

function renderBudget() {
  $('monthlyBudgetInput').value = state.settings.monthlyBudget || '';
  const list = monthExpenses(viewMonth);
  const spentBy = {};
  list.forEach(e => spentBy[e.category] = round2((spentBy[e.category] || 0) + e.amount));
  $('categoryBudgets').innerHTML = CATEGORIES.map(c => {
    const limit = state.settings.categoryBudgets[c.name];
    const spent = spentBy[c.name] || 0;
    const info = limit
      ? (spent > limit ? `<span class="over-text">Over by ${fmt(spent - limit)}</span> · spent ${fmt(spent)}` : `Spent ${fmt(spent)} of ${fmt(limit)}`)
      : `Spent ${fmt(spent)} this month`;
    return `<div class="cat-budget-row"><div class="cat-budget-info"><b>${c.emoji} ${esc(c.name)}</b><div class="sub">${info}</div></div>
      <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="No limit" data-cat-budget="${esc(c.name)}" value="${limit || ''}"></div>`;
  }).join('');
  $('recurringList').innerHTML = state.recurring.length ? state.recurring.map(r => {
    const added = r.added && r.added[viewMonth];
    return `<div class="rec-row"><div class="exp-emoji" style="background:${catColor(r.category)}26">${catEmoji(r.category)}</div>
      <div class="rec-main"><div class="rec-title">${esc(r.title)}</div><div class="rec-meta">${fmt(r.amount)} · day ${r.day} · ${esc(r.category)}</div></div>
      ${added ? '<span class="settled-note">Added ✓</span>' : `<button class="rec-add" data-rec-add="${r.id}">Add for ${monthLabel(viewMonth).split(' ')[0]}</button>`}
      <button class="rec-del" data-rec-del="${r.id}" aria-label="Delete recurring bill">×</button></div>`;
  }).join('') : '<div class="empty">No recurring bills yet.</div>';
}

/* ---------- recurring ---------- */
function addRecurringForMonth(bill, key) {
  bill.added = bill.added || {};
  if (bill.added[key]) return false;
  const [y, m] = key.split('-').map(Number);
  const day = Math.min(bill.day, new Date(y, m, 0).getDate());
  const date = `${key}-${String(day).padStart(2, '0')}T09:00`;
  const e = { id: uid(), title: bill.title, amount: bill.amount, category: bill.category, date, paidBy: 'you', splits: [{ personId: 'you', share: bill.amount }], recurringId: bill.id };
  state.expenses.push(e);
  bill.added[key] = e.id;
  return true;
}
(function autoRecurring() {
  let changed = false;
  state.recurring.forEach(r => { if (addRecurringForMonth(r, nowMonthKey())) changed = true; });
  if (changed) save();
})();

/* ---------- sheet (add / edit) ---------- */
let editingId = null, sheetMode = 'personal', customShares = false, duplicating = false;
function fillCategorySelects() {
  const opts = CATEGORIES.map(c => `<option value="${esc(c.name)}">${c.emoji} ${esc(c.name)}</option>`).join('');
  $('fCategory').innerHTML = opts;
  $('recCategory').innerHTML = opts;
  $('categoryFilter').innerHTML = '<option value="all">All categories</option>' + opts;
}
function localNowValue() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function openSheet(expense, asDuplicate) {
  duplicating = !!asDuplicate;
  editingId = expense && !asDuplicate ? expense.id : null;
  $('sheetTitle').textContent = asDuplicate ? 'Duplicate expense' : (expense ? 'Edit expense' : 'Add expense');
  $('deleteBtn').classList.toggle('hidden', !editingId);
  $('fAmount').value = expense ? expense.amount : '';
  $('fTitle').value = expense ? expense.title : '';
  $('fNote').value = expense ? (expense.note || '') : '';
  $('fCategory').value = expense ? expense.category : 'Groceries';
  $('fDate').value = expense ? expense.date.slice(0, 16) : localNowValue();
  $('fPaidBy').innerHTML = state.people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('fPaidBy').value = expense ? expense.paidBy : 'you';
  const isSplit = expense ? (expense.splits || []).length > 1 : false;
  setMode(isSplit ? 'split' : 'personal');
  customShares = false;
  $('toggleShares').textContent = 'Custom amounts';
  renderSplitPeople(expense);
  $('sheetBackdrop').classList.add('open');
  $('sheet').classList.add('open');
  setTimeout(() => $('fAmount').focus(), 320);
}
function closeSheet() { $('sheetBackdrop').classList.remove('open'); $('sheet').classList.remove('open'); }
function setMode(mode) {
  sheetMode = mode;
  $('modePersonal').classList.toggle('active', mode === 'personal');
  $('modeSplit').classList.toggle('active', mode === 'split');
  $('splitFields').classList.toggle('hidden', mode === 'personal');
}
function renderSplitPeople(expense) {
  const checked = expense ? (expense.splits || []).map(s => s.personId) : state.people.map(p => p.id);
  const shares = {};
  if (expense) (expense.splits || []).forEach(s => shares[s.personId] = s.share);
  $('splitPeople').innerHTML = state.people.map(p => `
    <div class="split-person">
      <input type="checkbox" data-split-person="${p.id}" ${checked.includes(p.id) ? 'checked' : ''}>
      <span class="pname">${esc(p.name)}</span>
      <input type="number" class="share-input ${customShares ? '' : 'hidden'}" data-share-for="${p.id}" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${shares[p.id] != null ? shares[p.id] : ''}">
    </div>`).join('');
}

$('expenseForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const amount = round2(parseFloat($('fAmount').value));
  const title = $('fTitle').value.trim();
  if (!amount || amount <= 0 || !title) { toast('Enter an amount and a title'); return; }
  let paidBy = 'you', splits;
  if (sheetMode === 'personal') {
    splits = [{ personId: 'you', share: amount }];
  } else {
    paidBy = $('fPaidBy').value;
    const boxes = [...document.querySelectorAll('[data-split-person]')].filter(b => b.checked);
    if (!boxes.length) { toast('Pick at least one person to split with'); return; }
    if (customShares) {
      splits = boxes.map(b => ({ personId: b.dataset.splitPerson, share: round2(parseFloat((document.querySelector(`[data-share-for="${b.dataset.splitPerson}"]`) || {}).value) || 0) }));
      const sum = round2(splits.reduce((a, s) => a + s.share, 0));
      if (Math.abs(sum - amount) > 0.02) { toast(`Shares add up to ${fmt(sum)}, not ${fmt(amount)}`); return; }
      if (splits.length) splits[splits.length - 1].share = round2(splits[splits.length - 1].share + (amount - sum));
    } else {
      const base = Math.floor(amount * 100 / boxes.length) / 100;
      splits = boxes.map((b, i) => ({ personId: b.dataset.splitPerson, share: i === 0 ? round2(amount - base * (boxes.length - 1)) : base }));
    }
  }
  const data = { title, amount, category: $('fCategory').value, date: $('fDate').value, paidBy, splits, note: $('fNote').value.trim() };
  if (editingId) {
    const e = state.expenses.find(x => x.id === editingId);
    Object.assign(e, data);
    toast('Expense updated ✓');
  } else {
    state.expenses.push({ id: uid(), ...data });
    toast(duplicating ? 'Expense duplicated ✓' : 'Expense added ✓');
  }
  save(); closeSheet(); render();
});
$('deleteBtn').addEventListener('click', () => {
  if (!editingId) return;
  state.expenses = state.expenses.filter(e => e.id !== editingId);
  state.recurring.forEach(r => { if (r.added) Object.keys(r.added).forEach(k => { if (r.added[k] === editingId) delete r.added[k]; }); });
  save(); closeSheet(); render(); toast('Expense deleted');
});
$('modePersonal').addEventListener('click', () => setMode('personal'));
$('modeSplit').addEventListener('click', () => { setMode('split'); renderSplitPeople(editingId ? state.expenses.find(e => e.id === editingId) : null); });
$('toggleShares').addEventListener('click', () => {
  customShares = !customShares;
  $('toggleShares').textContent = customShares ? 'Equal split' : 'Custom amounts';
  document.querySelectorAll('.share-input').forEach(i => i.classList.toggle('hidden', !customShares));
});
$('cancelBtn').addEventListener('click', closeSheet);
$('sheetBackdrop').addEventListener('click', closeSheet);
$('addBtnFab').addEventListener('click', () => openSheet(null));
$('addBtnSide').addEventListener('click', () => openSheet(null));

/* ---------- navigation & lists ---------- */
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => {
  activeTab = b.dataset.tab;
  document.querySelectorAll('.nav-btn').forEach(x => x.classList.toggle('active', x.dataset.tab === activeTab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + activeTab));
}));
$('prevMonth').addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, -1); render(); });
$('nextMonth').addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, 1); render(); });
document.addEventListener('click', ev => {
  const dupeBtn = ev.target.closest('[data-duplicate]');
  if (dupeBtn) { const src = state.expenses.find(e => e.id === dupeBtn.dataset.duplicate); if (src) openSheet(src, true); return; }
  const editRow = ev.target.closest('[data-edit]');
  if (editRow) { openSheet(state.expenses.find(e => e.id === editRow.dataset.edit)); return; }
  const gocat = ev.target.closest('[data-gocat]');
  if (gocat) {
    $('categoryFilter').value = gocat.dataset.gocat;
    document.querySelector('[data-tab="expenses"]').click();
    renderExpenses(); return;
  }
  const settle = ev.target.closest('[data-settle]');
  if (settle) {
    const p = debtPairs()[+settle.dataset.settle];
    if (p) {
      state.settlements.push({ id: uid(), from: p.from, to: p.to, amount: p.amount, date: localNowValue() });
      save(); render(); toast(`Settled ${fmt(p.amount)} ✓`);
    }
    return;
  }
  const delP = ev.target.closest('[data-del-person]');
  if (delP) {
    const id = delP.dataset.delPerson;
    const used = state.expenses.some(e => e.paidBy === id || (e.splits || []).some(s => s.personId === id)) || state.settlements.some(s => s.from === id || s.to === id);
    if (used) { toast('That person has expenses — can’t remove'); return; }
    state.people = state.people.filter(p => p.id !== id);
    save(); render(); toast('Person removed'); return;
  }
  const recAdd = ev.target.closest('[data-rec-add]');
  if (recAdd) {
    const bill = state.recurring.find(r => r.id === recAdd.dataset.recAdd);
    if (bill && addRecurringForMonth(bill, viewMonth)) { save(); render(); toast('Recurring bill added ✓'); }
    return;
  }
  const recDel = ev.target.closest('[data-rec-del]');
  if (recDel) {
    state.recurring = state.recurring.filter(r => r.id !== recDel.dataset.recDel);
    save(); render(); toast('Recurring bill removed'); return;
  }
});
$('searchInput').addEventListener('input', renderExpenses);
$('categoryFilter').addEventListener('change', renderExpenses);

/* ---------- split tab forms ---------- */
$('addPersonForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const name = $('newPersonName').value.trim();
  if (!name) return;
  state.people.push({ id: uid(), name });
  $('newPersonName').value = '';
  save(); render(); toast(`${name} added ✓`);
});

/* ---------- budget tab ---------- */
$('monthlyBudgetForm').addEventListener('submit', ev => {
  ev.preventDefault();
  state.settings.monthlyBudget = round2(parseFloat($('monthlyBudgetInput').value) || 0);
  save(); render(); toast('Budget saved ✓');
});
document.addEventListener('change', ev => {
  const cb = ev.target.closest('[data-cat-budget]');
  if (cb) {
    const v = parseFloat(cb.value);
    if (v > 0) state.settings.categoryBudgets[cb.dataset.catBudget] = round2(v);
    else delete state.settings.categoryBudgets[cb.dataset.catBudget];
    save(); render(); toast('Category budget saved ✓');
  }
});
$('addRecurringForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const bill = {
    id: uid(), title: $('recTitle').value.trim(),
    amount: round2(parseFloat($('recAmount').value)),
    day: Math.min(31, Math.max(1, parseInt($('recDay').value) || 1)),
    category: $('recCategory').value, added: {}
  };
  if (!bill.title || !bill.amount) { toast('Enter a name and amount'); return; }
  state.recurring.push(bill);
  addRecurringForMonth(bill, nowMonthKey());
  save(); render(); toast('Recurring bill added ✓');
  ev.target.reset();
});

/* ---------- export / import ---------- */
$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'billsplit-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded ✓');
});
$('importFile').addEventListener('change', ev => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.expenses) || !Array.isArray(data.people) || !data.settings) throw new Error('bad file');
      state = data;
      save();
      viewMonth = nowMonthKey();
      render();
      toast('Backup imported ✓');
    } catch (e) { toast('That file could not be imported'); }
  };
  reader.readAsText(file);
  ev.target.value = '';
});

/* ---------- receipt scanning (on-device OCR, photo is never stored) ---------- */
function loadTesseract() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function receiptAmounts(line) {
  const m = line.replace(/,/g, '').match(/\$?\s*(\d+\.\d{2})\b/g);
  return m ? m.map(x => parseFloat(x.replace(/[$\s]/g, ''))).filter(n => isFinite(n)) : [];
}
function parseReceipt(text) {
  const out = {};
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  // Amount: prefer a TOTAL line (not subtotal), then amount/balance due, then the largest figure
  let amount = null;
  for (const l of lines.filter(l => /total/i.test(l) && !/sub\s*-?\s*total/i.test(l))) {
    const v = receiptAmounts(l); if (v.length) amount = Math.max(...v);
  }
  if (!amount) for (const l of lines.filter(l => /(amount due|balance due|total due|to pay)/i.test(l))) {
    const v = receiptAmounts(l); if (v.length) amount = Math.max(...v);
  }
  if (!amount) { let max = 0; lines.forEach(l => receiptAmounts(l).forEach(v => { if (v > max) max = v; })); amount = max || null; }
  if (amount) out.amount = round2(amount);
  // Date
  const p2 = n => String(n).padStart(2, '0');
  let ymd = null;
  let m = text.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) ymd = `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  if (!ymd) { m = text.match(/\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\b/); if (m) ymd = `${m[3]}-${p2(m[1])}-${p2(m[2])}`; }
  if (!ymd) { m = text.match(/\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{2})\b/); if (m) ymd = `20${m[3]}-${p2(m[1])}-${p2(m[2])}`; }
  if (!ymd) {
    const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    m = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i);
    if (m) ymd = `${m[3]}-${p2(MON[m[1].toLowerCase()])}-${p2(m[2])}`;
    if (!ymd) { m = text.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})/i); if (m) ymd = `${m[3]}-${p2(MON[m[2].toLowerCase()])}-${p2(m[1])}`; }
  }
  if (ymd) {
    let hh = '12', mm = '00';
    const tm = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\b/);
    if (tm) {
      let h = parseInt(tm[1]);
      if (tm[3]) { const pm = /pm/i.test(tm[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      if (h <= 23) { hh = p2(h); mm = tm[2]; }
    }
    out.date = `${ymd}T${hh}:${mm}`;
  }
  // Title: first plausible merchant line near the top — this is the expense NAME
  const skip = /(receipt|invoice|tel|phone|www|http|gst|hst|pst|vat|tax|order|trans|cashier|terminal|thank)/i;
  let merchantLine = '';
  for (const l of lines.slice(0, 6)) {
    const letters = (l.match(/[A-Za-z]/g) || []).length;
    if (letters >= 3 && !skip.test(l) && !/^\d+$/.test(l.replace(/[\s#*.-]/g, ''))) {
      merchantLine = l;
      out.title = l.replace(/^[#*\s]+|[#*\s]+$/g, '').replace(/\s+#\d+.*$/, '').replace(/\s+/g, ' ').slice(0, 60);
      break;
    }
  }
  // Description: the items bought (lines with a price, excluding totals/tax/payment lines)
  const notItem = /(sub\s*-?\s*total|\btotal\b|hst|gst|pst|vat|\btax\b|change|cash|visa|mastercard|amex|debit|credit|balance|amount due|to pay|tip|tender|auth)/i;
  const items = [];
  for (const l of lines) {
    if (l === merchantLine) continue;
    if (notItem.test(l)) continue;
    if (!/\d+\.\d{2}/.test(l)) continue;
    if ((l.match(/[A-Za-z]/g) || []).length < 2) continue;
    items.push(l.replace(/\s+/g, ' ').trim());
    if (items.length >= 8) break;
  }
  if (items.length) out.note = items.join('\n').slice(0, 290);
  // Category guess from keywords anywhere on the receipt
  const low = text.toLowerCase();
  const CAT_KEYS = [
    ['Personal Care', ['shoppers drug', 'pharmaprix', 'rexall', 'sephora', 'salon', 'barber']],
    ['Groceries', ['walmart', 'costco', 'food basics', 'iqbal', 'loblaws', 'no frills', 'freshco', 'metro ', 'sobeys', 'superstore', 'grocery', 'groceries', 'supermarket', 'whole foods', 'farm boy', 'zehrs', 'fortinos', 'foodland', 't&t supermarket']],
    ['Dining Out', ['tim hortons', 'starbucks', 'mcdonald', 'lindt', 'restaurant', 'cafe', 'café', 'pizza', 'burger', 'subway', 'kfc', "wendy", 'dairy queen', 'bakery', 'coffee']],
    ['Transport', ['petro-canada', 'shell', 'esso', 'parking', 'uber', 'lyft', '407 etr', 'gas station']],
    ['Entertainment', ['cineplex', 'netflix', 'spotify', 'cinema', 'theatre']],
    ['Health', ['pharmacy', 'clinic', 'dental', 'medical', 'optical']],
    ['Housing', ['home depot', 'ikea', 'rona', "lowe's", 'bed bath']],
    ['Utilities & Bills', ['bell canada', 'rogers', 'telus', 'fido', 'koodo', 'hydro', 'enbridge']],
    ['Shopping', ['amazon', 'best buy', 'winners', 'marshalls', 'dollarama', 'canadian tire', 'nike', 'zara']]
  ];
  for (const [cat, keys] of CAT_KEYS) if (keys.some(k => low.includes(k))) { out.category = cat; break; }
  return out;
}
$('scanBtn').addEventListener('click', () => $('receiptFile').click());
$('receiptFile').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const status = $('scanStatus'), bar = $('scanBar'), label = $('scanLabel');
  status.classList.remove('hidden');
  bar.style.width = '4%';
  label.textContent = 'Loading scanner…';
  try {
    await loadTesseract();
    label.textContent = 'Reading receipt…';
    const { data } = await Tesseract.recognize(file, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const p = Math.max(5, Math.round(m.progress * 100));
          bar.style.width = p + '%';
          label.textContent = 'Reading receipt… ' + p + '%';
        }
      }
    });
    const parsed = parseReceipt(data.text || '');
    if (parsed.amount) $('fAmount').value = parsed.amount.toFixed(2);
    if (parsed.title) $('fTitle').value = parsed.title;
    if (parsed.note) $('fNote').value = parsed.note;
    if (parsed.date) $('fDate').value = parsed.date;
    if (parsed.category) $('fCategory').value = parsed.category;
    toast(parsed.amount || parsed.title ? 'Receipt scanned — check the details ✓' : 'Could not read it — enter manually');
  } catch (e) {
    toast('Scanning failed — check connection and retry');
  }
  status.classList.add('hidden');
});

/* ---------- init ---------- */
(function initMonthYear() {
  const ms = $('monthSelect'), ys = $('yearSelect');
  ms.innerHTML = MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}">${m.slice(0, 3)}</option>`).join('');
  const years = new Set();
  for (let y = 2024; y <= 2030; y++) years.add(String(y));
  state.expenses.forEach(e => years.add(e.date.slice(0, 4)));
  years.add(viewMonth.slice(0, 4));
  ys.innerHTML = [...years].sort().map(y => `<option value="${y}">${y}</option>`).join('');
  const jump = () => { viewMonth = ys.value + '-' + ms.value; render(); };
  ms.addEventListener('change', jump);
  ys.addEventListener('change', jump);
})();
fillCategorySelects();
render();
initSync();
