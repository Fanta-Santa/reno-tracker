// Dashboard: what you've spent so far (with the budget status), a room-by-room card that opens up into the floating
// house (tap a room to see its spending), payments coming up, to-dos, and charts for tools vs the rest, by category
// and over time.

import { html, useEffect, useMemo, useRef, useState } from '../lib.js';
import { state, useStore, inboxExpenses, saveItem } from '../store.js';
import { formatMoney, formatDate, todayISO } from '../format.js';
import { roomType } from '../defaults.js';
import { backupReminder, computeStats, spendOverTime, upcomingPayments } from '../stats.js';
import { Page, Group, EmptyState, withBusy } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { navigate } from '../ui/router.js';
import { BudgetBars, Bars, SplitBar, SpendOverTime, SERIES, TOOLS } from '../ui/charts.js';
import { House, StatusBadge, STATUS_TEXT } from './house.js';
import { openRoomEditor } from './editors.js';
import { showExpensesWith } from './expenses.js';
import { openAddMenu } from './capture.js';
import { runBackup } from './settings.js';
import { dueText } from './quotes.js';

function Meter({ value, max, status }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return html`<span class="meter ${status || ''}"><span style=${`width:${width}%`} /></span>`;
}

/** The budget at a glance: over budget, at risk, on track, or no budgets yet (null). */
function budgetStatus(stats) {
  const over = stats.overBudget.length;
  const near = stats.nearBudget.length;
  const status = over || stats.status === 'over' ? 'over' : near || stats.status === 'near' ? 'near' : stats.budget ? 'ok' : null;
  if (!status) return null;
  const rooms = (n) => `${n} ${n === 1 ? 'room' : 'rooms'}`;
  const text = {
    over: over ? `${rooms(over)} over budget` : 'Over budget',
    near: near ? `${rooms(near)} nearly at budget` : 'Nearly at budget',
    ok: 'On track',
  }[status];
  return { status, text: status === 'over' && near ? `${text}, ${near} nearly` : text };
}

/** The first thing on the dashboard: what's been spent, against the budget, with the status and the key figures. */
function SpentCard({ stats, onStatus }) {
  const status = budgetStatus(stats);
  const totalOver = stats.budget > 0 && stats.spent + stats.committed > stats.budget;
  const used = stats.budget ? Math.round((stats.spent / stats.budget) * 100) : null;
  return html`<section class="glass-card kpis spent-card" aria-label="Spent so far">
    <div class="kpi-hero">
      <span class="kpi-label">Spent so far</span>
      <span class="kpi-big">${formatMoney(stats.spent, { whole: true })}</span>
      <span class="kpi-sub">${stats.budget
        ? `of ${formatMoney(stats.budget, { whole: true })} budget · ${used}% used`
        : 'Add budgets to your rooms to see how you’re tracking'}</span>
      ${stats.budget > 0 && html`<${Meter} value=${stats.spent} max=${stats.budget} status=${stats.status} />`}
      ${status && html`<button class="status-chip s-${status.status}" onClick=${onStatus}
        aria-label=${`Budget: ${status.text}. Look inside the house.`}>
        <${StatusBadge} status=${status.status} inline />${status.text}
        <${Icon} name="chevronRight" size=${14} stroke=${2.4} />
      </button>`}
    </div>
    <div class="kpi-tiles">
      <div class="kpi-tile"><span class="kpi-label">Budget</span><strong>${stats.budget ? formatMoney(stats.budget, { whole: true }) : '—'}</strong></div>
      <button class="kpi-tile tappable" onClick=${() => navigate('/quotes')}><span class="kpi-label">Committed</span><strong>${formatMoney(stats.committed, { whole: true })}</strong><small>accepted quotes ›</small></button>
      <div class="kpi-tile"><span class="kpi-label">${totalOver ? 'Over by' : 'Remaining'}</span>
        <strong class=${totalOver ? 'neg' : ''}>${stats.budget ? formatMoney(Math.abs(stats.remaining), { whole: true }) : '—'}</strong>
        ${totalOver && stats.committed > 0 && html`<small>counting accepted quotes</small>`}</div>
    </div>
    <p class="kpi-foot">Includes ${formatMoney(stats.gst, { whole: true })} GST</p>
  </section>`;
}

/**
 * Room by room: what each room has spent against its own budget, the ones over (or nearly over) first. The little
 * house is a hint: tap the card to open the house up, or a room to open it on that room.
 */
function RoomsCard({ rows, rooms, statsByRoom, onOpen, cardRef }) {
  const order = { over: 0, near: 1 };
  const sorted = [...rows].sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
  return html`<section class="glass-card chart-card rooms-card" ref=${cardRef} aria-label="Rooms">
    <button class="rooms-head" onClick=${() => onOpen()} aria-label="Rooms. Open your house to look inside.">
      <span class="rooms-title">
        <span class="chart-title">Rooms</span>
        <span class="chart-sub">Each bar is that room’s own budget. Tap to look inside your house.</span>
      </span>
      <span class="rooms-house" aria-hidden="true">
        <${House} rooms=${rooms} stats=${statsByRoom} open=${false} onOpen=${() => {}} onClose=${() => {}} onSelect=${() => {}} />
      </span>
    </button>
    <${BudgetBars} rows=${sorted} onSelect=${(id) => onOpen(id)} />
    <div class="chart-legend">
      <span><span class="lg-swatch" style=${`background:${SERIES}`} />Spent</span>
      <span><span class="lg-swatch budget" />Budget</span>
      ${rows.some((r) => r.status === 'over') && html`<span><span class="lg-swatch over" />Over budget</span>`}
      ${rows.some((r) => r.committed) && html`<span><span class="lg-swatch committed" />Accepted quotes</span>`}
    </div>
  </section>`;
}

/** Quotes and bills with a due date, soonest first, and what's due in the next 30 days (for cash flow). */
function ComingUp({ upcoming }) {
  const soon = upcoming.filter((u) => u.days <= 30).reduce((sum, u) => sum + u.amount, 0);
  return html`<section class="glass-card due-card" aria-label="Payments coming up">
    <h2 class="chart-title">Payments coming up</h2>
    ${upcoming.slice(0, 4).map((u) => {
      const due = dueText(u.days, u.dueDate);
      return html`<button class="due-row" key=${u.quote.id} onClick=${() => navigate(`/quotes/${u.quote.id}`)}>
        <span class="due-main">
          <strong>${u.quote.supplier || u.quote.description || 'Quote'}</strong>
          <span class="due-when s-${due.status}"><${StatusBadge} status=${due.status} />${due.text}</span>
        </span>
        <span class="due-amount">${formatMoney(u.amount)}</span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`;
    })}
    ${upcoming.length > 4 && html`<button class="link-btn small" onClick=${() => navigate('/quotes')}>${upcoming.length - 4} more in Quotes</button>`}
    <div class="due-foot"><span>Due in the next 30 days</span><strong>${formatMoney(soon)}</strong></div>
  </section>`;
}

/**
 * Under the house: the tapped room's spending. With no room picked, a one-line hint, plus a button only screen
 * readers see, since the roof goes back on by dragging it down.
 */
function RoomCard({ row, onClose, onRoof }) {
  const ref = useRef();
  const id = row?.room.id;
  useEffect(() => { if (id) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [id]);
  if (!row) {
    return html`<p class="house-caption">Tap a room to see its spending. Drag the roof down to close up.
      <button class="sr-only" onClick=${onRoof}>Put the roof back on</button></p>`;
  }
  const { room, spent, budget, committed, status, count, byCategory } = row;
  const recent = state.expenses
    .filter((e) => e.status !== 'inbox' && e.lines.some((l) => l.roomId === room.id))
    .slice(0, 3)
    .map((e) => ({ e, cents: e.lines.filter((l) => l.roomId === room.id).reduce((s, l) => s + l.amountCents, 0) }));
  const setBudget = () => openRoomEditor({ room, onSave: (next) => withBusy('Saving…', () => saveItem('rooms', next)) });
  return html`<div class="glass-card room-card" key=${room.id} ref=${ref}>
    <div class="rc-head">
      <span class="rc-emoji" aria-hidden="true">${roomType(room.type).emoji}</span>
      <div class="rc-title">
        <h3>${room.name}</h3>
        <span class="rc-status"><${StatusBadge} status=${status} />${STATUS_TEXT[status]}${budget ? ` · ${Math.round((spent / budget) * 100)}% of budget` : ''}</span>
      </div>
      <button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" size=${18} /></button>
    </div>
    <div class="rc-numbers">
      <span><small>Spent</small><strong>${formatMoney(spent, { whole: true })}</strong></span>
      <span><small>Budget</small><strong>${budget ? formatMoney(budget, { whole: true }) : '—'}</strong></span>
      <span><small>${budget && spent + committed > budget ? 'Over by' : 'Left'}</small>
        <strong class=${budget && spent + committed > budget ? 'neg' : ''}>${budget ? formatMoney(Math.abs(budget - spent - committed), { whole: true }) : '—'}</strong></span>
    </div>
    ${budget > 0 && html`<${Meter} value=${spent} max=${budget} status=${status} />`}
    ${committed > 0 && html`<p class="rc-note">Includes ${formatMoney(committed, { whole: true })} in accepted quotes not yet paid.</p>`}
    ${byCategory.length > 0 && html`<div class="rc-cats">
      ${byCategory.slice(0, 4).map((c) => html`<span class="chip static">${c.category?.name || 'Other'} · ${formatMoney(c.cents, { whole: true })}</span>`)}
    </div>`}
    ${recent.length > 0 && html`<div class="rc-recent">
      ${recent.map(({ e, cents }) => html`<button class="rc-item" key=${e.id} onClick=${() => navigate(`/expenses/${e.id}`)}>
        <span>${e.store || e.description || 'Expense'}<small>${formatDate(e.date)}</small></span>
        <strong>${formatMoney(cents)}</strong>
      </button>`)}
    </div>`}
    <div class="rc-actions">
      ${count > 0 && html`<button class="pill-btn" onClick=${() => showExpensesWith({ rooms: [room.id] })}>See ${count === 1 ? 'the expense' : `all ${count} expenses`}</button>`}
      <button class="pill-btn" onClick=${setBudget}>${budget ? 'Change budget' : 'Set a budget'}</button>
    </div>
  </div>`;
}

// ---------- The floating house, opened up from the Rooms card ----------

let showHouseView = () => {};
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** A clip that shows only the card's rectangle (rounded like the card), for growing out of it and back. */
function clipTo(el) {
  const r = el?.getBoundingClientRect();
  if (!r || r.bottom < 0 || r.top > innerHeight) return 'inset(40% 8% 40% 8% round 26px)'; // card off screen: from the middle
  const top = Math.max(0, r.top);
  const bottom = Math.max(0, innerHeight - Math.min(innerHeight, r.bottom));
  return `inset(${top}px ${Math.max(0, innerWidth - r.right)}px ${bottom}px ${Math.max(0, r.left)}px round 26px)`;
}

/** Opens the house, growing out of `card` (the Rooms card); with a room, opens on that room. */
function openHouseView(card, roomId = null) {
  showHouseView({ card, roomId, key: Date.now() });
}

/** Lives outside the screen (like sheets do), so it covers the whole app, tab bar included. */
export function HouseViewHost() {
  const [view, setView] = useState(null);
  showHouseView = setView;
  useEffect(() => {
    if (!view) return undefined;
    const leave = () => setView(null); // e.g. "See all expenses" goes to another screen
    addEventListener('hashchange', leave);
    return () => removeEventListener('hashchange', leave);
  }, [view]);
  return view && html`<${HouseView} key=${view.key} ...${view} onDone=${() => setView(null)} />`;
}

/**
 * Full screen: the house grows out of the Rooms card with its roof on, then the roof lifts. Tap a room to see its
 * spending. Putting the roof back on (drag it down) or ✕ shrinks it back into the card.
 */
function HouseView({ card, roomId, onDone }) {
  useStore();
  const ref = useRef();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [closing, setClosing] = useState(false);
  const stats = useMemo(() => computeStats(state), [state.rooms, state.categories, state.expenses, state.quotes]);
  const statsByRoom = useMemo(() => new Map(stats.rooms.map((r) => [r.room.id, r])), [stats]);
  const rooms = state.rooms.filter((r) => !r.archived);
  const stages = rooms.filter((r) => r.type === 'whole');

  useEffect(() => {
    document.documentElement.classList.add('house-open');
    const quick = reducedMotion();
    ref.current.animate([{ clipPath: clipTo(card) }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }],
      { duration: quick ? 1 : 460, easing: EASE });
    // Once it's open, lift the roof (and pick the room it was opened on)
    const lift = setTimeout(() => {
      setOpen(true);
      if (roomId) setSelected(roomId);
    }, quick ? 0 : 420);
    const onKey = (e) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    return () => {
      clearTimeout(lift);
      removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('house-open');
    };
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    const anim = ref.current.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: clipTo(card) }],
      { duration: reducedMotion() ? 1 : 380, easing: EASE, fill: 'forwards' });
    anim.finished.then(onDone, onDone);
  };
  /** The roof went back on: let it settle, then shrink back into the card. */
  const roofOn = () => {
    setOpen(false);
    setSelected(null);
    setTimeout(close, reducedMotion() ? 0 : 520);
  };

  return html`<div class="house-view ${closing ? 'closing' : ''}" ref=${ref} role="dialog" aria-modal="true" aria-label="Your house">
    <div class="hv-scroll">
      <header class="hv-bar">
        <h2>${state.project.name}</h2>
        <button class="nav-icon-btn" onClick=${close} aria-label="Close the house"><${Icon} name="x" size=${20} stroke=${2.2} /></button>
      </header>
      <section class="house-scene" aria-label="House">
        ${stages.length > 0 && html`<div class="stage-chips" aria-label="Whole-house stages">
          ${stages.map((r) => html`<button class="stage-chip ${selected === r.id ? 'on' : ''}" onClick=${() => setSelected(selected === r.id ? null : r.id)}
            aria-pressed=${selected === r.id} aria-label=${`${r.name}: ${STATUS_TEXT[statsByRoom.get(r.id)?.status || 'none']}`}>
            <span aria-hidden="true">${roomType(r.type).emoji}</span>${r.name}<${StatusBadge} status=${statsByRoom.get(r.id)?.status || 'none'} />
          </button>`)}
        </div>`}
        <${House} rooms=${rooms} stats=${statsByRoom} open=${open} onOpen=${(id) => { setOpen(true); if (id) setSelected(id); }}
          onClose=${roofOn} selectedId=${selected} onSelect=${setSelected} />
        ${open && html`<${RoomCard} row=${selected ? statsByRoom.get(selected) : null} onClose=${() => setSelected(null)} onRoof=${roofOn} />`}
      </section>
    </div>
  </div>`;
}

// ---------- The dashboard ----------

export function DashboardView() {
  useStore();
  const roomsRef = useRef();
  const stats = useMemo(() => computeStats(state), [state.rooms, state.categories, state.expenses, state.quotes]);
  const series = useMemo(() => spendOverTime(state.expenses, todayISO()), [state.expenses]);
  const statsByRoom = useMemo(() => new Map(stats.rooms.map((r) => [r.room.id, r])), [stats]);
  const activeRooms = state.rooms.filter((r) => !r.archived);
  const openHouse = (roomId) => openHouseView(roomsRef.current, roomId);

  const inbox = inboxExpenses().length;
  const filed = state.expenses.filter((e) => e.status !== 'inbox');
  const missing = filed.filter((e) => !e.fileIds.length).length;
  const lastBackup = state.prefs.lastBackupAt;
  const backup = backupReminder(state, lastBackup);
  const backupDue = backup.due;

  const roomRows = stats.rooms.map((r) => ({
    id: r.room.id, label: r.room.name, emoji: roomType(r.room.type).emoji,
    spent: r.spent, committed: r.committed, budget: r.budget, status: r.status,
  }));
  const categoryRows = stats.categories.filter((c) => c.cents > 0).map((c) => ({ id: c.category?.id, label: c.category?.name || 'Other', value: c.cents }));
  const upcoming = useMemo(() => upcomingPayments(state.quotes, state.expenses, todayISO()), [state.quotes, state.expenses]);

  return html`<${Page} title=${state.project.name} class="dashboard">
    <${SpentCard} stats=${stats} onStatus=${() => openHouse()} />

    ${roomRows.length > 0 && html`<${RoomsCard} rows=${roomRows} rooms=${activeRooms} statsByRoom=${statsByRoom}
      onOpen=${openHouse} cardRef=${roomsRef} />`}

    ${upcoming.length > 0 && html`<${ComingUp} upcoming=${upcoming} />`}

    ${(inbox > 0 || missing > 0 || backupDue) && html`<${Group} title="To do">
      ${inbox > 0 && html`<button class="row tappable todo" onClick=${() => navigate('/inbox')}>
        <span class="row-icon" style="background:#2F5BEA"><${Icon} name="inbox" size=${18} /></span>
        <span class="row-label">${inbox} ${inbox === 1 ? 'receipt' : 'receipts'} to sort</span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
      ${missing > 0 && html`<button class="row tappable todo" onClick=${() => showExpensesWith({ receipt: 'missing' })}>
        <span class="row-icon" style="background:#FF8A3D"><${Icon} name="receipt" size=${18} /></span>
        <span class="row-label">${missing} ${missing === 1 ? 'expense is' : 'expenses are'} missing a receipt</span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
      ${backupDue && html`<button class="row tappable todo" onClick=${runBackup}>
        <span class="row-icon" style="background:#1FB85A"><${Icon} name="backup" size=${18} /></span>
        <span class="row-label">Back up your receipts<small>${lastBackup
          ? `${backup.changes} ${backup.changes === 1 ? 'change' : 'changes'} since your last backup on ${formatDate(todayISO(new Date(lastBackup)))}`
          : 'Not backed up yet'}</small></span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
    <//>`}

    ${filed.length === 0 ? html`<${EmptyState} emoji="🧾" title="Let’s log your first receipt"
        text="After your next hardware run, tap ＋ and snap the receipt. Your rooms fill in as you go.">
        <button class="wide-btn primary" onClick=${openAddMenu}>Add an expense</button>
      <//>`
      : html`
      <section class="chart-card glass-card">
        <h2 class="chart-title">Tools vs everything else</h2>
        <p class="chart-sub">Tools are reusable across the whole reno.</p>
        <${SplitBar} parts=${[
          { label: 'Everything else', value: stats.other, color: SERIES },
          { label: 'Tools', value: stats.tools, color: TOOLS },
        ]} />
      </section>

      <section class="chart-card glass-card">
        <h2 class="chart-title">Spending by category</h2>
        <p class="chart-sub">Tap a category to see its expenses.</p>
        <${Bars} rows=${categoryRows} onSelect=${(id) => id && showExpensesWith({ categories: [id] })} />
      </section>

      <section class="chart-card glass-card">
        <h2 class="chart-title">Spend over time</h2>
        <p class="chart-sub">Running total${series.unit === 'week' ? ', week by week' : series.unit === 'month' ? ', month by month' : ''}. Drag across the chart to read it.</p>
        <${SpendOverTime} series=${series} budget=${stats.budget} />
      </section>`}
  <//>`;
}
