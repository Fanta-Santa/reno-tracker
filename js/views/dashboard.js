// Dashboard. Stage 1 shows the key numbers and to-dos; the house view and charts arrive in Stage 2.

import { html } from '../lib.js';
import { state, useStore, filedExpenses, inboxExpenses } from '../store.js';
import { formatMoney, daysBetween, todayISO } from '../format.js';
import { roomType } from '../defaults.js';
import { Page, Group, EmptyState } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { navigate } from '../ui/router.js';
import { showExpensesWith } from './expenses.js';
import { openAddMenu } from './capture.js';
import { runBackup } from './settings.js';

export function DashboardView() {
  useStore();
  const expenses = filedExpenses();
  const inbox = inboxExpenses();
  const spent = expenses.reduce((s, e) => s + (e.totalCents ?? 0), 0);
  const gst = expenses.reduce((s, e) => s + (e.gstCents ?? 0), 0);
  let tools = 0;
  const byRoom = new Map();
  for (const e of expenses) {
    for (const l of e.lines) {
      if (l.isTool) tools += l.amountCents;
      byRoom.set(l.roomId, (byRoom.get(l.roomId) || 0) + l.amountCents);
    }
  }
  const missing = expenses.filter((e) => !e.fileIds.length).length;
  const budget = state.rooms.filter((r) => !r.archived).reduce((s, r) => s + (r.budgetCents ?? 0), 0);
  const lastBackup = state.prefs.lastBackupAt;
  const backupDue = expenses.length > 0 && (!lastBackup || daysBetween(todayISO(new Date(lastBackup)), todayISO()) >= 14);

  const rooms = state.rooms
    .filter((r) => !r.archived || byRoom.get(r.id))
    .map((r) => ({ r, spent: byRoom.get(r.id) || 0 }));

  return html`<${Page} title=${state.project.name}>
    <div class="hero-card">
      <span class="hero-label">Spent so far</span>
      <span class="hero-amount">${formatMoney(spent)}</span>
      <span class="hero-sub">${budget ? `of ${formatMoney(budget, { whole: true })} budget · ` : ''}includes ${formatMoney(gst)} GST</span>
      ${budget > 0 && html`<div class="meter"><span style=${`width:${Math.min(100, (spent / budget) * 100)}%`}
        class=${spent > budget ? 'over' : spent > budget * 0.9 ? 'near' : ''} /></div>`}
    </div>

    <div class="tile-row">
      <button class="tile" onClick=${() => showExpensesWith({ toolsOnly: true })}>
        <span class="tile-icon tools"><${Icon} name="wrench" size=${18} /></span>
        <span class="tile-label">Tools</span>
        <strong>${formatMoney(tools, { whole: true })}</strong>
      </button>
      <div class="tile">
        <span class="tile-icon materials"><${Icon} name="house" size=${18} /></span>
        <span class="tile-label">Everything else</span>
        <strong>${formatMoney(spent - tools, { whole: true })}</strong>
      </div>
    </div>

    ${(inbox.length > 0 || missing > 0 || backupDue) && html`<${Group} title="To do">
      ${inbox.length > 0 && html`<button class="row tappable todo" onClick=${() => navigate('/inbox')}>
        <span class="row-icon" style="background:#007AFF"><${Icon} name="inbox" size=${18} /></span>
        <span class="row-label">${inbox.length} ${inbox.length === 1 ? 'receipt' : 'receipts'} to sort</span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
      ${missing > 0 && html`<button class="row tappable todo" onClick=${() => showExpensesWith({ receipt: 'missing' })}>
        <span class="row-icon" style="background:#FF9500"><${Icon} name="receipt" size=${18} /></span>
        <span class="row-label">${missing} ${missing === 1 ? 'expense is' : 'expenses are'} missing a receipt</span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
      ${backupDue && html`<button class="row tappable todo" onClick=${runBackup}>
        <span class="row-icon" style="background:#34C759"><${Icon} name="backup" size=${18} /></span>
        <span class="row-label">Back up your receipts<small>${lastBackup ? `Last backup ${daysBetween(todayISO(new Date(lastBackup)), todayISO())} days ago` : 'Not backed up yet'}</small></span>
        <${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />
      </button>`}
    <//>`}

    ${expenses.length === 0 ? html`<${EmptyState} emoji="🏡" title="Let’s log your first receipt"
        text="After your next hardware run, tap ＋ and snap the receipt.">
        <button class="wide-btn primary" onClick=${openAddMenu}>Add an expense</button>
      <//>`
      : html`<${Group} title="By room / stage">
        ${rooms.map(({ r, spent: s }) => {
          const pct = r.budgetCents ? (s / r.budgetCents) * 100 : null;
          return html`<button class="row tappable room-row" key=${r.id} onClick=${() => showExpensesWith({ rooms: [r.id] })}>
            <span class="row-icon plain">${roomType(r.type).emoji}</span>
            <span class="row-label">${r.name}
              ${pct != null && html`<span class="meter small"><span style=${`width:${Math.min(100, pct)}%`}
                class=${pct > 100 ? 'over' : pct > 90 ? 'near' : ''} /></span>`}
              <small>${r.budgetCents ? `${formatMoney(s, { whole: true })} of ${formatMoney(r.budgetCents, { whole: true })}${pct > 100 ? ' · over budget' : ''}` : 'No budget'}</small>
            </span>
            <span class="row-detail strong">${formatMoney(s, { whole: true })}</span>
          </button>`;
        })}
      <//>
      <p class="coming-soon">🏗️ The interactive house, charts and budget warnings arrive in the next update.</p>`}
  <//>`;
}

export function QuotesView() {
  return html`<${Page} title="Quotes">
    <${EmptyState} emoji="📝" title="Quotes are coming soon"
      text="In the next few updates you’ll be able to log quotes, flick them between Quoted, Accepted and Paid, and compare quoted vs actual." />
  <//>`;
}
