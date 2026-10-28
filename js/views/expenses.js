// Expenses list (search, filters, sort), the inbox of unsorted receipts, and an expense's detail screen.

import { html, useMemo, useState } from '../lib.js';
import {
  state, useStore, roomById, categoryById, filedExpenses, inboxExpenses, saveExpense, deleteExpense,
} from '../store.js';
import { formatDate, formatMoney, monthLabel, shortDate, todayISO, addDays, centsToInput } from '../format.js';
import { roomType } from '../defaults.js';
import { prepareFile } from '../images.js';
import {
  Page, Group, Row, EmptyState, Chips, Segmented, Switch, Thumb, SwipeRow,
  openSheet, SheetHeader, toastUndo, withBusy, pickFiles, openActions,
} from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { navigate, goBack } from '../ui/router.js';
import { openViewer } from '../ui/viewer.js';
import { openExpenseForm } from './expense-form.js';
import { captureToInbox } from './capture.js';
import { reviewInbox } from './review.js';
import { readerEnabled, useReadingId, foundSomething } from '../reader/queue.js';

// ---------- Filters ----------

const EMPTY_FILTERS = { rooms: [], categories: [], stores: [], from: '', to: '', toolsOnly: false, receipt: 'any' };
let filters = { ...EMPTY_FILTERS }; // kept while the app is open
let sort = 'newest';
let query = '';

/** Lets other screens (e.g. the dashboard) open the list with a filter applied. */
export function showExpensesWith(patch) {
  filters = { ...EMPTY_FILTERS, ...patch };
  query = '';
  navigate('/expenses');
}

const activeFilterCount = (f) => f.rooms.length + f.categories.length + f.stores.length
  + (f.from || f.to ? 1 : 0) + (f.toolsOnly ? 1 : 0) + (f.receipt !== 'any' ? 1 : 0);

function searchText(e) {
  const rooms = e.lines.map((l) => roomById(l.roomId)?.name);
  const cats = e.lines.map((l) => categoryById(l.categoryId)?.name);
  const items = e.lines.map((l) => l.description);
  return [e.store, e.description, e.notes, ...items, ...rooms, ...cats, formatMoney(e.totalCents), centsToInput(e.totalCents),
    formatDate(e.date), e.receiptText].join(' ').toLowerCase();
}

/** Returns matching expenses, each with `shownCents`: the part of it that matches room/category/tool filters. */
function applyFilters(list, f, q) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lineFilter = f.rooms.length || f.categories.length || f.toolsOnly;
  const out = [];
  for (const e of list) {
    if (f.from && e.date < f.from) continue;
    if (f.to && e.date > f.to) continue;
    if (f.stores.length && !f.stores.some((s) => s.toLowerCase() === e.store.trim().toLowerCase())) continue;
    if (f.receipt === 'has' && !e.fileIds.length) continue;
    if (f.receipt === 'missing' && e.fileIds.length) continue;
    let shownCents = e.totalCents ?? 0;
    if (lineFilter) {
      const lines = e.lines.filter((l) => (!f.rooms.length || f.rooms.includes(l.roomId))
        && (!f.categories.length || f.categories.includes(l.categoryId))
        && (!f.toolsOnly || l.isTool));
      if (!lines.length) continue;
      shownCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
    }
    if (words.length) {
      const text = searchText(e);
      if (!words.every((w) => text.includes(w))) continue;
    }
    out.push({ e, shownCents });
  }
  const cmp = {
    newest: (a, b) => b.e.date.localeCompare(a.e.date) || b.e.createdAt - a.e.createdAt,
    oldest: (a, b) => a.e.date.localeCompare(b.e.date) || a.e.createdAt - b.e.createdAt,
    highest: (a, b) => b.shownCents - a.shownCents,
    lowest: (a, b) => a.shownCents - b.shownCents,
    store: (a, b) => (a.e.store || '￿').localeCompare(b.e.store || '￿') || b.e.date.localeCompare(a.e.date),
  }[sort];
  return out.sort(cmp);
}

const SORTS = [
  { value: 'newest', label: 'Newest first', icon: 'arrowDown' },
  { value: 'oldest', label: 'Oldest first', icon: 'arrowUp' },
  { value: 'highest', label: 'Highest amount', icon: 'arrowDown' },
  { value: 'lowest', label: 'Lowest amount', icon: 'arrowUp' },
  { value: 'store', label: 'Store A–Z', icon: 'store' },
];

function openFilterSheet(onApply) {
  openSheet(({ close }) => html`<${FilterSheet} close=${close} onApply=${onApply} />`, { full: true });
}

function FilterSheet({ close, onApply }) {
  const [f, setF] = useState(filters);
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));
  const today = todayISO();
  const usedStores = useMemo(() => {
    const names = new Map();
    for (const e of filedExpenses()) if (e.store.trim()) names.set(e.store.trim().toLowerCase(), e.store.trim());
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, []);
  const count = applyFilters(filedExpenses(), f, query).length;
  const presets = [
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'This month', from: `${today.slice(0, 7)}-01`, to: today },
    { label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  const apply = () => { filters = f; onApply(); close(); };

  return html`<${SheetHeader} title="Filters" onCancel=${close} onDone=${apply} doneLabel="Apply" />
  <div class="sheet-body form">
    <div class="form-group">
      <span class="field-label">Room / stage</span>
      <${Chips} wrap multi value=${f.rooms} onChange=${(rooms) => set({ rooms })}
        items=${state.rooms.map((r) => ({ value: r.id, label: r.name, emoji: roomType(r.type).emoji }))} />
    </div>
    <div class="form-group">
      <span class="field-label">Category</span>
      <${Chips} wrap multi value=${f.categories} onChange=${(categories) => set({ categories })}
        items=${state.categories.map((c) => ({ value: c.id, label: c.name }))} />
    </div>
    ${usedStores.length > 0 && html`<div class="form-group">
      <span class="field-label">Store</span>
      <${Chips} wrap multi value=${f.stores} onChange=${(stores) => set({ stores })}
        items=${usedStores.map((s) => ({ value: s, label: s }))} />
    </div>`}
    <div class="form-group">
      <span class="field-label">Date</span>
      <${Chips} wrap value=${presets.find((p) => p.from === f.from && p.to === f.to)?.label} allowNone
        items=${presets.map((p) => ({ value: p.label, label: p.label }))}
        onChange=${(label) => { const p = presets.find((x) => x.label === label); set(p ? { from: p.from, to: p.to } : { from: '', to: '' }); }} />
      <div class="date-range">
        <label class="field"><span class="field-label">From</span>
          <input type="date" value=${f.from} onInput=${(e) => set({ from: e.currentTarget.value })} /></label>
        <label class="field"><span class="field-label">To</span>
          <input type="date" value=${f.to} onInput=${(e) => set({ to: e.currentTarget.value })} /></label>
      </div>
    </div>
    <div class="form-group">
      <div class="field-row">
        <span class="tool-label"><${Icon} name="wrench" size=${18} /> Tools only</span>
        <${Switch} label="Tools only" checked=${f.toolsOnly} onChange=${(toolsOnly) => set({ toolsOnly })} />
      </div>
      <span class="field-label">Receipt</span>
      <${Segmented} value=${f.receipt} onChange=${(receipt) => set({ receipt })}
        options=${[{ value: 'any', label: 'Any' }, { value: 'has', label: 'Has receipt' }, { value: 'missing', label: 'Missing' }]} />
    </div>
    <div class="form-footer">
      <button class="wide-btn primary" onClick=${apply}>Show ${count} ${count === 1 ? 'expense' : 'expenses'}</button>
      ${activeFilterCount(f) > 0 && html`<button class="wide-btn secondary" onClick=${() => setF({ ...EMPTY_FILTERS })}>Clear all filters</button>`}
    </div>
  </div>`;
}

// ---------- Expense rows ----------

function roomSummary(e) {
  const ids = [...new Set(e.lines.map((l) => l.roomId))];
  if (ids.length > 1) return `${ids.length} rooms`;
  const room = roomById(ids[0]);
  return room ? `${roomType(room.type).emoji} ${room.name}` : '';
}

function ExpenseRow({ e, shownCents }) {
  const partial = shownCents !== e.totalCents;
  const remove = async () => {
    const undo = await withBusy('Deleting…', () => deleteExpense(e.id));
    if (undo) toastUndo('Expense deleted', undo);
  };
  return html`<${SwipeRow} onTap=${() => navigate(`/expenses/${e.id}`)}
    actions=${[{ label: 'Delete', icon: 'trash', tone: 'danger', onAction: remove }]}>
    <div class="expense-row">
      <${Thumb} fileId=${e.fileIds[0]} size=${46} />
      <div class="expense-main">
        <div class="expense-title">${e.store || e.description || 'Expense'}</div>
        <div class="expense-sub">
          ${e.store && e.description && html`<span class="expense-desc">${e.description}</span>`}
          <span>${roomSummary(e)}</span>
        </div>
        <div class="expense-tags">
          ${e.lines.some((l) => l.isTool) && html`<span class="tag tool"><${Icon} name="wrench" size=${12} stroke=${2.2} />Tool</span>`}
          ${!e.fileIds.length && html`<span class="tag warn">No receipt</span>`}
        </div>
      </div>
      <div class="expense-amount">
        <strong>${formatMoney(shownCents)}</strong>
        ${partial ? html`<small>of ${formatMoney(e.totalCents)}</small>` : html`<small>${shortDate(e.date)}</small>`}
      </div>
    </div>
  <//>`;
}

// ---------- Expenses screen ----------

export function ExpensesView() {
  useStore();
  const [, rerender] = useState(0);
  const refresh = () => rerender((n) => n + 1);
  const [q, setQ] = useState(query);
  const all = filedExpenses();
  const inbox = inboxExpenses();
  const results = applyFilters(all, filters, q);
  const total = results.reduce((sum, r) => sum + r.shownCents, 0);
  const nFilters = activeFilterCount(filters);
  const grouped = sort === 'newest' || sort === 'oldest';

  const onSearch = (value) => { query = value; setQ(value); };
  const chooseSort = () => openActions({
    title: 'Sort by',
    actions: SORTS.map((s) => ({ label: `${s.label}${s.value === sort ? '  ✓' : ''}`, icon: s.icon, onSelect: () => { sort = s.value; refresh(); } })),
  });
  const removeFilter = (patch) => { filters = { ...filters, ...patch }; refresh(); };

  // Active filter chips, each removable.
  const chips = [
    ...filters.rooms.map((id) => ({ label: roomById(id)?.name || 'Room', clear: () => removeFilter({ rooms: filters.rooms.filter((x) => x !== id) }) })),
    ...filters.categories.map((id) => ({ label: categoryById(id)?.name || 'Category', clear: () => removeFilter({ categories: filters.categories.filter((x) => x !== id) }) })),
    ...filters.stores.map((s) => ({ label: s, clear: () => removeFilter({ stores: filters.stores.filter((x) => x !== s) }) })),
    ...(filters.from || filters.to ? [{ label: `${filters.from ? formatDate(filters.from) : '…'} – ${filters.to ? formatDate(filters.to) : '…'}`, clear: () => removeFilter({ from: '', to: '' }) }] : []),
    ...(filters.toolsOnly ? [{ label: 'Tools only', clear: () => removeFilter({ toolsOnly: false }) }] : []),
    ...(filters.receipt !== 'any' ? [{ label: filters.receipt === 'has' ? 'Has receipt' : 'Missing receipt', clear: () => removeFilter({ receipt: 'any' }) }] : []),
  ];

  const monthTotals = new Map();
  for (const r of results) {
    const month = r.e.date.slice(0, 7);
    monthTotals.set(month, (monthTotals.get(month) || 0) + r.shownCents);
  }
  let lastMonth = null;
  const rows = [];
  for (const r of results) {
    const month = r.e.date.slice(0, 7);
    if (grouped && month !== lastMonth) {
      rows.push(html`<div class="list-heading" key=${`m-${month}`}><span>${monthLabel(r.e.date)}</span><span>${formatMoney(monthTotals.get(month))}</span></div>`);
      lastMonth = month;
    }
    rows.push(html`<${ExpenseRow} key=${r.e.id} e=${r.e} shownCents=${r.shownCents} />`);
  }

  const subtitle = all.length
    ? `${formatMoney(total)} · ${results.length} ${results.length === 1 ? 'expense' : 'expenses'}${nFilters || q ? ' shown' : ''}`
    : null;

  return html`<${Page} title="Expenses" subtitle=${subtitle}
    actions=${html`<button class="nav-icon-btn" onClick=${chooseSort} aria-label="Sort"><${Icon} name="sort" /></button>`}>
    ${inbox.length > 0 && html`<button class="inbox-banner" onClick=${() => navigate('/inbox')}>
      <span class="inbox-banner-icon"><${Icon} name="inbox" /></span>
      <span class="inbox-banner-text"><strong>${inbox.length} ${inbox.length === 1 ? 'receipt' : 'receipts'} to sort</strong>
        <small>Snapped but not filed yet</small></span>
      <${Icon} name="chevronRight" size=${18} />
    </button>`}

    ${all.length > 0 && html`<div class="search-row">
      <label class="search">
        <${Icon} name="search" size=${18} />
        <input type="search" placeholder="Search store, item, room, amount" value=${q} enterkeyhint="search"
          onInput=${(e) => onSearch(e.currentTarget.value)} />
        ${q && html`<button class="search-clear" onClick=${() => onSearch('')} aria-label="Clear search"><${Icon} name="x" size=${14} stroke=${2.6} /></button>`}
      </label>
      <button class="filter-btn ${nFilters ? 'on' : ''}" onClick=${() => openFilterSheet(refresh)} aria-label="Filters">
        <${Icon} name="filter" />${nFilters > 0 && html`<span class="badge">${nFilters}</span>`}
      </button>
    </div>`}

    ${chips.length > 0 && html`<div class="active-filters">
      ${chips.map((c) => html`<button class="chip on removable" onClick=${c.clear}>${c.label}<${Icon} name="x" size=${12} stroke=${2.6} /></button>`)}
    </div>`}

    ${!all.length ? html`<${EmptyState} emoji="🧾" title="No expenses yet"
        text="Tap ＋ after your next hardware run to snap the receipt. It takes about ten seconds." />`
      : !results.length ? html`<${EmptyState} emoji="🔍" title="Nothing matches" text="Try a different search or clear the filters." />`
        : html`<div class="list-card">${rows}</div>`}
  <//>`;
}

// ---------- Inbox ----------

function InboxTile({ e, readingId }) {
  const scan = e.scan;
  const found = scan?.status === 'done' && foundSomething(scan.result);
  let title;
  let sub;
  let badge = null;
  if (e.totalCents != null) {
    title = formatMoney(e.totalCents);
    sub = e.store || formatDate(e.date);
  } else if (found) {
    const r = scan.result;
    title = r.total.cents != null ? formatMoney(r.total.cents) : 'Ready to check';
    sub = r.store.value || formatDate(e.date);
    badge = html`<span class="tile-badge ready"><${Icon} name="check" size=${12} stroke=${2.8} /> Read</span>`;
  } else if (readingId === e.id) {
    title = 'Reading…';
    sub = formatDate(e.date);
    badge = html`<span class="tile-badge"><span class="spinner tiny" /></span>`;
  } else if (readerEnabled() && (!scan || scan.status === 'failed')) {
    title = scan ? 'Tap to fill in' : 'Waiting to read';
    sub = formatDate(e.date);
  } else {
    title = 'Tap to sort';
    sub = formatDate(e.date);
  }
  const open = () => (readerEnabled() ? reviewInbox(e.id) : openExpenseForm({ expense: e }));
  return html`<button class="inbox-tile" onClick=${open}>
    <span class="inbox-tile-photo"><${Thumb} fileId=${e.fileIds[0]} size=${200} />${badge}</span>
    <span class="inbox-tile-meta"><strong>${title}</strong><small>${sub}</small></span>
  </button>`;
}

export function InboxView() {
  useStore();
  const readingId = useReadingId();
  const inbox = inboxExpenses();
  const ready = inbox.filter((e) => e.scan?.status === 'done' && foundSomething(e.scan.result)).length;
  return html`<${Page} title="Inbox" subtitle=${readerEnabled() ? 'Snapped receipts are read on this phone, ready for you to check' : 'Receipts you snapped to sort later'}
    back=${{ label: 'Expenses', to: '/expenses' }}>
    ${ready > 0 && html`<button class="wide-btn primary" onClick=${() => reviewInbox()}>
      <${Icon} name="check" size=${20} stroke=${2.4} /> ${ready === 1 ? 'Check receipt' : `Check ${ready === inbox.length ? 'all' : ready} receipts`}</button>`}
    <div class="button-row">
      <button class="pill-btn big" onClick=${() => captureToInbox('camera')}><${Icon} name="camera" size=${18} /> Snap</button>
      <button class="pill-btn big" onClick=${() => captureToInbox('photos')}><${Icon} name="photo" size=${18} /> From Photos</button>
    </div>
    ${!inbox.length ? html`<${EmptyState} emoji="🎉" title="All sorted" text="Nothing waiting. Quick-snapped receipts land here." />`
      : html`<div class="inbox-grid">${inbox.map((e) => html`<${InboxTile} key=${e.id} e=${e} readingId=${readingId} />`)}</div>`}
  <//>`;
}

// ---------- Expense detail ----------

export function ExpenseDetailView({ id }) {
  useStore();
  const e = state.expenses.find((x) => x.id === id);
  if (!e) {
    return html`<${Page} title="Expense" back=${{ label: 'Expenses', to: '/expenses' }}>
      <${EmptyState} emoji="🫥" title="This expense was deleted" />
    <//>`;
  }

  const addReceipt = async (kind) => {
    const picked = await pickFiles(kind, { multiple: kind !== 'camera' });
    if (!picked.length) return;
    const undo = await withBusy('Adding receipt…', async () => {
      const prepared = await Promise.all(picked.map(prepareFile));
      return saveExpense({ ...e, fileIds: [...e.fileIds, ...prepared.map((p) => p.id)] }, { newFiles: prepared });
    });
    if (undo) toastUndo('Receipt added', undo);
  };

  return html`<${Page} title=${e.store || 'Expense'} back=${{ label: 'Expenses', to: '/expenses' }}
    actions=${html`<button class="nav-text-btn" onClick=${() => openExpenseForm({ expense: e })}>Edit</button>`}>
    ${e.fileIds.length > 0 ? html`<div class="receipt-gallery">
      ${e.fileIds.map((fid, i) => html`<button class="receipt-big" key=${fid} onClick=${() => openViewer(e.fileIds, i)} aria-label="View receipt">
        <${Thumb} fileId=${fid} size=${150} radius=${16} />
      </button>`)}
      <button class="receipt-big add" onClick=${() => addReceipt('file')} aria-label="Add another receipt"><${Icon} name="plus" /></button>
    </div>` : html`<div class="missing-receipt">
      <${Icon} name="receipt" size=${28} />
      <div><strong>No receipt attached</strong><small>Handy for returns and warranty claims.</small></div>
      <div class="button-row">
        <button class="pill-btn" onClick=${() => addReceipt('camera')}><${Icon} name="camera" size=${16} /> Snap</button>
        <button class="pill-btn" onClick=${() => addReceipt('file')}><${Icon} name="upload" size=${16} /> File</button>
      </div>
    </div>`}

    <div class="detail-hero">
      <div class="detail-amount">${formatMoney(e.totalCents)}</div>
      <div class="detail-meta">${formatDate(e.date)} · ${e.gstMode === 'none' ? 'No GST' : `GST ${formatMoney(e.gstCents)}`}</div>
    </div>

    <${Group}>
      <${Row} icon="store" iconBg="#FF9500" label="Store" detail=${e.store || '—'} />
      ${e.description && html`<${Row} icon="tag" iconBg="#5856D6" label="Item" detail=${e.description} />`}
    <//>

    <${Group} title=${e.lines.some((l) => l.description) ? 'Items' : e.lines.length > 1 ? 'Split' : 'Room & category'}>
      ${e.lines.map((l) => {
        const room = roomById(l.roomId);
        const category = categoryById(l.categoryId)?.name || '';
        return html`<div class="row line-row" key=${l.id}>
          <span class="row-icon plain">${room ? roomType(room.type).emoji : '❔'}</span>
          ${l.description
            ? html`<span class="row-label">${l.description}<small>${room?.name || 'Unknown room'} · ${category}${l.isTool ? ' · Tool' : ''}</small>
                ${l.unmatched?.length > 0 && html`<span class="receipt-lines" aria-label="Lines on the receipt">${l.unmatched.map((t) => html`<span>${t}</span>`)}</span>`}</span>`
            : html`<span class="row-label">${room?.name || 'Unknown room'}<small>${category}${l.isTool ? ' · Tool' : ''}</small></span>`}
          ${e.lines.length > 1 && html`<span class="row-detail">${formatMoney(l.amountCents)}</span>`}
        </div>`;
      })}
    <//>

    ${e.notes && html`<${Group} title="Notes"><p class="notes">${e.notes}</p><//>`}

    <div class="form-footer">
      <button class="wide-btn danger" onClick=${async () => {
        const undo = await withBusy('Deleting…', () => deleteExpense(e.id));
        if (!undo) return;
        goBack('/expenses');
        toastUndo('Expense deleted', undo);
      }}><${Icon} name="trash" size=${20} /> Delete expense</button>
    </div>
  <//>`;
}
