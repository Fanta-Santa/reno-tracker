// Dashboard: the house (tap a room to see its spending), budget warnings, the headline numbers,
// to-dos, and charts by room, by category, tools vs the rest, and over time.

import { html, useEffect, useMemo, useRef, useState } from '../lib.js';
import { state, useStore, inboxExpenses, saveItem } from '../store.js';
import { formatMoney, formatDate, daysBetween, todayISO } from '../format.js';
import { roomType } from '../defaults.js';
import { computeStats, spendOverTime } from '../stats.js';
import { Page, Group, EmptyState, withBusy } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { navigate } from '../ui/router.js';
import { BudgetBars, Bars, SplitBar, SpendOverTime, SERIES, TOOLS } from '../ui/charts.js';
import { House, StatusBadge, STATUS_TEXT } from './house.js';
import { openRoomEditor } from './editors.js';
import { showExpensesWith } from './expenses.js';
import { openAddMenu } from './capture.js';
import { runBackup } from './settings.js';

let remembered = null; // the selected room, kept while the app is open

function Meter({ value, max, status }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return html`<span class="meter ${status || ''}"><span style=${`width:${width}%`} /></span>`;
}

/** The glass card under the house: the tapped room's spending, or a hint and the status key. */
function RoomCard({ row, onClose }) {
  const ref = useRef();
  const id = row?.room.id;
  useEffect(() => { if (id) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [id]);
  if (!row) {
    return html`<div class="glass-card room-card hint">
      <p>Tap a room to see what you’ve spent there.</p>
      <div class="status-key" aria-label="What the badges mean">
        ${['ok', 'near', 'over'].map((s) => html`<span><${StatusBadge} status=${s} />${STATUS_TEXT[s]}</span>`)}
      </div>
    </div>`;
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

export function DashboardView() {
  useStore();
  const [selected, setSelected] = useState(remembered);
  const select = (id) => {
    remembered = id;
    setSelected(id);
  };
  const stats = useMemo(() => computeStats(state), [state.rooms, state.categories, state.expenses, state.quotes]);
  const series = useMemo(() => spendOverTime(state.expenses, todayISO()), [state.expenses]);
  const statsByRoom = useMemo(() => new Map(stats.rooms.map((r) => [r.room.id, r])), [stats]);
  const activeRooms = state.rooms.filter((r) => !r.archived);
  const stages = activeRooms.filter((r) => r.type === 'whole');
  const selectedRow = selected ? statsByRoom.get(selected) : null;

  const inbox = inboxExpenses().length;
  const filed = state.expenses.filter((e) => e.status !== 'inbox');
  const missing = filed.filter((e) => !e.fileIds.length).length;
  const lastBackup = state.prefs.lastBackupAt;
  const backupDays = lastBackup ? daysBetween(todayISO(new Date(lastBackup)), todayISO()) : null;
  const backupDue = filed.length > 0 && (backupDays == null || backupDays >= 14);

  const showRoom = (id) => {
    select(id);
    scrollTo({ top: 0, behavior: 'smooth' });
  };

  const roomRows = stats.rooms.map((r) => ({
    id: r.room.id, label: r.room.name, emoji: roomType(r.room.type).emoji,
    spent: r.spent, committed: r.committed, budget: r.budget, status: r.status,
  }));
  const categoryRows = stats.categories.filter((c) => c.cents > 0).map((c) => ({ id: c.category?.id, label: c.category?.name || 'Other', value: c.cents }));
  const totalOver = stats.budget > 0 && stats.spent + stats.committed > stats.budget;

  return html`<${Page} title=${state.project.name} class="dashboard">
    <section class="house-scene" aria-label="House">
      ${stages.length > 0 && html`<div class="stage-chips" aria-label="Whole-house stages">
        ${stages.map((r) => html`<button class="stage-chip ${selected === r.id ? 'on' : ''}" onClick=${() => select(selected === r.id ? null : r.id)}
          aria-pressed=${selected === r.id} aria-label=${`${r.name}: ${STATUS_TEXT[statsByRoom.get(r.id)?.status || 'none']}`}>
          <span aria-hidden="true">${roomType(r.type).emoji}</span>${r.name}<${StatusBadge} status=${statsByRoom.get(r.id)?.status || 'none'} />
        </button>`)}
      </div>`}
      <${House} rooms=${activeRooms} stats=${statsByRoom} selectedId=${selected} onSelect=${select} />
      <${RoomCard} row=${selectedRow} onClose=${() => select(null)} />
    </section>

    ${(stats.overBudget.length > 0 || stats.nearBudget.length > 0 || totalOver) && html`<div class="alerts" role="status">
      ${totalOver && html`<div class="alert over"><${StatusBadge} status="over" /><span>The whole reno is <strong>${formatMoney(stats.spent + stats.committed - stats.budget, { whole: true })} over budget</strong>${stats.committed ? ', counting accepted quotes' : ''}.</span></div>`}
      ${stats.overBudget.map((r) => html`<button class="alert over" key=${r.room.id} onClick=${() => showRoom(r.room.id)}>
        <${StatusBadge} status="over" /><span><strong>${r.room.name}</strong> is ${formatMoney(r.spent - r.budget, { whole: true })} over budget</span>
        <${Icon} name="chevronRight" size=${16} stroke=${2.2} />
      </button>`)}
      ${stats.nearBudget.map((r) => html`<button class="alert near" key=${r.room.id} onClick=${() => showRoom(r.room.id)}>
        <${StatusBadge} status="near" /><span><strong>${r.room.name}</strong> ${r.spent + r.committed > r.budget
          ? `will go over budget with accepted quotes`
          : `has used ${Math.round((r.spent / r.budget) * 100)}% of its budget`}</span>
        <${Icon} name="chevronRight" size=${16} stroke=${2.2} />
      </button>`)}
    </div>`}

    <div class="kpis glass-card">
      <div class="kpi-hero">
        <span class="kpi-label">Spent so far</span>
        <span class="kpi-big">${formatMoney(stats.spent, { whole: true })}</span>
        <span class="kpi-sub">${stats.budget ? `of ${formatMoney(stats.budget, { whole: true })} budget · ` : ''}includes ${formatMoney(stats.gst, { whole: true })} GST</span>
        ${stats.budget > 0 && html`<${Meter} value=${stats.spent} max=${stats.budget} status=${stats.status} />`}
      </div>
      <div class="kpi-tiles">
        <div class="kpi-tile"><span class="kpi-label">Budget</span><strong>${stats.budget ? formatMoney(stats.budget, { whole: true }) : '—'}</strong></div>
        <button class="kpi-tile tappable" onClick=${() => navigate('/quotes')}><span class="kpi-label">Committed</span><strong>${formatMoney(stats.committed, { whole: true })}</strong><small>accepted quotes ›</small></button>
        <div class="kpi-tile"><span class="kpi-label">${totalOver ? 'Over by' : 'Remaining'}</span>
          <strong class=${totalOver ? 'neg' : ''}>${stats.budget ? formatMoney(Math.abs(stats.remaining), { whole: true }) : '—'}</strong>
          ${!stats.budget && html`<small>set room budgets</small>`}</div>
      </div>
    </div>

    ${(inbox > 0 || missing > 0 || backupDue) && html`<${Group} title="To do">
      ${inbox > 0 && html`<button class="row tappable todo" onClick=${() => navigate('/inbox')}>
        <span class="row-icon" style="background:#007AFF"><${Icon} name="inbox" size=${18} /></span>
        <span class="row-label">${inbox} ${inbox === 1 ? 'receipt' : 'receipts'} to sort</span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
      ${missing > 0 && html`<button class="row tappable todo" onClick=${() => showExpensesWith({ receipt: 'missing' })}>
        <span class="row-icon" style="background:#FF9500"><${Icon} name="receipt" size=${18} /></span>
        <span class="row-label">${missing} ${missing === 1 ? 'expense is' : 'expenses are'} missing a receipt</span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
      ${backupDue && html`<button class="row tappable todo" onClick=${runBackup}>
        <span class="row-icon" style="background:#34C759"><${Icon} name="backup" size=${18} /></span>
        <span class="row-label">Back up your receipts<small>${backupDays != null ? `Last backup ${backupDays} days ago` : 'Not backed up yet'}</small></span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
    <//>`}

    ${filed.length === 0 ? html`<${EmptyState} emoji="🧾" title="Let’s log your first receipt"
        text="After your next hardware run, tap ＋ and snap the receipt. Your house fills in as you go.">
        <button class="wide-btn primary" onClick=${openAddMenu}>Add an expense</button>
      <//>`
      : html`
      <section class="chart-card glass-card">
        <h2 class="chart-title">Budget by room or stage</h2>
        <p class="chart-sub">Spent so far against each budget. Tap one to see its expenses.</p>
        <${BudgetBars} rows=${roomRows} onSelect=${(id) => showExpensesWith({ rooms: [id] })} />
        <div class="chart-legend">
          <span><span class="lg-swatch" style=${`background:${SERIES}`} />Spent</span>
          <span><span class="lg-tick" />Budget</span>
          ${roomRows.some((r) => r.status === 'over') && html`<span><span class="lg-swatch over" />Over budget</span>`}
          ${roomRows.some((r) => r.committed) && html`<span><span class="lg-swatch committed" />Accepted quotes</span>`}
        </div>
      </section>

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
