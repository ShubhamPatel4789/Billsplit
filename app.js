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
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

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
    <div class="exp-emoji">${catEmoji(e.category)}</div>
    <div class="exp-main"><div class="exp-title">${esc(e.title)}${payer}</div><div class="exp-meta">${meta} · ${esc(e.category)}</div></div>
    <div class="exp-amt">${fmt(e.amount)}</div></div>`;
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
  const ring = $('ringFg'), C = 326.7;
  ring.style.strokeDashoffset = C * (1 - pct / 100);
  ring.classList.toggle('over', remaining < 0);

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
      <div class="cat-bar"><div class="cat-fill ${over ? 'over' : ''}" style="width:${max ? byCat[c] / max * 100 : 0}%"></div></div>${sub}</div>`;
  }).join('') : '<div class="empty">No expenses this month yet.<br>Tap ＋ to add your first one.</div>';

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
  if (q) list = list.filter(e => e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q));
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
    return `<div class="rec-row"><div class="exp-emoji">${catEmoji(r.category)}</div>
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
let editingId = null, sheetMode = 'personal', customShares = false;
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
function openSheet(expense) {
  editingId = expense ? expense.id : null;
  $('sheetTitle').textContent = expense ? 'Edit expense' : 'Add expense';
  $('deleteBtn').classList.toggle('hidden', !expense);
  $('fAmount').value = expense ? expense.amount : '';
  $('fTitle').value = expense ? expense.title : '';
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
  const data = { title, amount, category: $('fCategory').value, date: $('fDate').value, paidBy, splits };
  if (editingId) {
    const e = state.expenses.find(x => x.id === editingId);
    Object.assign(e, data);
    toast('Expense updated ✓');
  } else {
    state.expenses.push({ id: uid(), ...data });
    toast('Expense added ✓');
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
