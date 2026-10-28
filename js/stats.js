// Works out the dashboard numbers: spent vs budget per room, by category, tools, and spend over time.
// Pure functions (no DOM, no database), so they can be unit tested in Node.

import { addDays, daysBetween } from './format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 'none' (no budget), 'ok', 'near' (90%+ of budget, or accepted quotes would take it over) or 'over'.
 */
export function budgetStatus(spentCents, budgetCents, committedCents = 0) {
  if (!budgetCents) return 'none';
  if (spentCents > budgetCents) return 'over';
  if (spentCents + committedCents > budgetCents || spentCents >= budgetCents * 0.9) return 'near';
  return 'ok';
}

/** What's still owed on an accepted quote: its amount less what has been paid against it. */
export function quoteOutstanding(quote, expenses) {
  if (quote.status !== 'accepted') return 0;
  const paid = expenses.filter((e) => e.quoteId === quote.id && e.status !== 'inbox')
    .reduce((s, e) => s + (e.totalCents ?? 0), 0);
  return Math.max(0, (quote.amountCents ?? 0) - paid);
}

/**
 * All the dashboard numbers.
 * data: { rooms, categories, expenses, quotes }. Inbox receipts (not yet sorted) aren't counted.
 */
export function computeStats({ rooms, categories, expenses, quotes = [] }) {
  const filed = expenses.filter((e) => e.status !== 'inbox');
  const room = new Map(rooms.map((r) => [r.id, { spent: 0, committed: 0, count: 0, byCategory: new Map(), expenseIds: new Set() }]));
  const byCategory = new Map();
  let spent = 0;
  let gst = 0;
  let tools = 0;

  for (const e of filed) {
    spent += e.totalCents ?? 0;
    gst += e.gstCents ?? 0;
    for (const l of e.lines) {
      if (l.isTool) tools += l.amountCents;
      byCategory.set(l.categoryId, (byCategory.get(l.categoryId) || 0) + l.amountCents);
      if (!room.has(l.roomId)) room.set(l.roomId, { spent: 0, committed: 0, count: 0, byCategory: new Map(), expenseIds: new Set() });
      const r = room.get(l.roomId);
      r.spent += l.amountCents;
      r.byCategory.set(l.categoryId, (r.byCategory.get(l.categoryId) || 0) + l.amountCents);
      if (!r.expenseIds.has(e.id)) {
        r.expenseIds.add(e.id);
        r.count += 1;
      }
    }
  }

  let committed = 0;
  for (const q of quotes) {
    const owed = quoteOutstanding(q, filed);
    committed += owed;
    if (owed && room.has(q.roomId)) room.get(q.roomId).committed += owed;
  }

  const roomRows = rooms
    .filter((r) => !r.archived || room.get(r.id)?.spent)
    .map((r) => {
      const s = room.get(r.id);
      const budget = r.budgetCents || 0;
      return {
        room: r,
        spent: s.spent,
        committed: s.committed,
        budget,
        remaining: budget ? budget - s.spent - s.committed : null,
        pct: budget ? s.spent / budget : null,
        status: budgetStatus(s.spent, budget, s.committed),
        count: s.count,
        expenseIds: [...s.expenseIds],
        byCategory: [...s.byCategory.entries()]
          .map(([id, cents]) => ({ category: categories.find((c) => c.id === id), cents }))
          .sort((a, b) => b.cents - a.cents),
      };
    });

  const budget = rooms.filter((r) => !r.archived).reduce((s, r) => s + (r.budgetCents || 0), 0);
  const categoryRows = [...byCategory.entries()]
    .map(([id, cents]) => ({ category: categories.find((c) => c.id === id), cents }))
    .filter((c) => c.cents !== 0)
    .sort((a, b) => b.cents - a.cents);

  return {
    spent,
    gst,
    budget,
    committed,
    remaining: budget ? budget - spent - committed : null,
    status: budgetStatus(spent, budget, committed),
    tools,
    other: spent - tools,
    rooms: roomRows,
    categories: categoryRows,
    overBudget: roomRows.filter((r) => r.status === 'over'),
    nearBudget: roomRows.filter((r) => r.status === 'near'),
    count: filed.length,
  };
}

// ---------- Spend over time ----------

function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((day + 6) % 7)); // back to Monday
}

const shortLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/**
 * Spending per day, week or month (whichever suits the time span), with a running total.
 * Returns { unit, points: [{ start, label, amount, cumulative }] }.
 */
export function spendOverTime(expenses, today) {
  const filed = expenses.filter((e) => e.status !== 'inbox' && e.date && e.totalCents);
  if (!filed.length) return { unit: 'day', points: [] };
  const first = filed.reduce((min, e) => (e.date < min ? e.date : min), filed[0].date);
  const last = filed.reduce((max, e) => (e.date > max ? e.date : max), today || filed[0].date);
  const span = daysBetween(first, last);
  const unit = span <= 31 ? 'day' : span <= 26 * 7 ? 'week' : 'month';

  const keyOf = (iso) => (unit === 'day' ? iso : unit === 'week' ? weekStart(iso) : `${iso.slice(0, 7)}-01`);
  const next = (iso) => {
    if (unit === 'day') return addDays(iso, 1);
    if (unit === 'week') return addDays(iso, 7);
    const [y, m] = iso.split('-').map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  };
  const label = (iso) => (unit === 'month' ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`
    : unit === 'week' ? `w/c ${shortLabel(iso)}` : shortLabel(iso));

  const sums = new Map();
  for (const e of filed) sums.set(keyOf(e.date), (sums.get(keyOf(e.date)) || 0) + e.totalCents);

  const points = [];
  let cumulative = 0;
  for (let k = keyOf(first); k <= keyOf(last); k = next(k)) {
    const amount = sums.get(k) || 0;
    cumulative += amount;
    points.push({ start: k, label: label(k), amount, cumulative });
  }
  return { unit, points };
}
