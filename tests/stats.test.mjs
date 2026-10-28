// Checks the dashboard numbers. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetStatus, computeStats, quoteOutstanding, quoteParts, quoteProgress, quoteTotals, spendOverTime, upcomingPayments } from '../js/stats.js';
import { smoothPath, smoothSeries } from '../js/ui/charts.js';

const rooms = [
  { id: 'k', name: 'Kitchen', type: 'kitchen', budgetCents: 100000 },
  { id: 'b', name: 'Bathroom', type: 'bathroom', budgetCents: 50000 },
  { id: 'p', name: 'Painting', type: 'whole', budgetCents: null },
  { id: 'old', name: 'Old room', type: 'other', budgetCents: 10000, archived: true },
];
const categories = [{ id: 't', name: 'Tools', isTool: true }, { id: 'm', name: 'Materials' }];
const line = (roomId, categoryId, amountCents, isTool = false) => ({ roomId, categoryId, amountCents, isTool });
const expenses = [
  { id: 'e1', status: 'filed', date: '2026-10-01', totalCents: 60000, gstCents: 5455, lines: [line('k', 'm', 40000), line('b', 't', 20000, true)] },
  { id: 'e2', status: 'filed', date: '2026-10-20', totalCents: 35000, gstCents: 3182, lines: [line('b', 'm', 35000)] },
  { id: 'e3', status: 'filed', date: '2026-10-21', totalCents: 5000, gstCents: 455, lines: [line('p', 'm', 5000)] },
  { id: 'e4', status: 'inbox', date: '2026-10-22', totalCents: 99999, lines: [line('k', 'm', 99999)] }, // not sorted yet
];

test('budget status: none, ok, near (90% or quotes would tip it over), over', () => {
  assert.equal(budgetStatus(5000, 0), 'none');
  assert.equal(budgetStatus(5000, 10000), 'ok');
  assert.equal(budgetStatus(9000, 10000), 'near');
  assert.equal(budgetStatus(5000, 10000, 6000), 'near');
  assert.equal(budgetStatus(10001, 10000), 'over');
  assert.equal(budgetStatus(10000, 10000), 'near');
});

test('totals, rooms and categories (inbox receipts not counted)', () => {
  const s = computeStats({ rooms, categories, expenses });
  assert.equal(s.spent, 100000);
  assert.equal(s.gst, 9092);
  assert.equal(s.budget, 150000); // archived rooms' budgets don't count
  assert.equal(s.remaining, 50000);
  assert.equal(s.tools, 20000);
  assert.equal(s.other, 80000);
  const kitchen = s.rooms.find((r) => r.room.id === 'k');
  assert.deepEqual([kitchen.spent, kitchen.status, kitchen.count, kitchen.remaining], [40000, 'ok', 1, 60000]);
  const bathroom = s.rooms.find((r) => r.room.id === 'b');
  assert.deepEqual([bathroom.spent, bathroom.status, bathroom.count, bathroom.remaining], [55000, 'over', 2, -5000]);
  assert.deepEqual(bathroom.byCategory.map((c) => [c.category.name, c.cents]), [['Materials', 35000], ['Tools', 20000]]);
  assert.equal(s.rooms.find((r) => r.room.id === 'p').status, 'none');
  assert.ok(!s.rooms.some((r) => r.room.id === 'old')); // archived and unused
  assert.deepEqual(s.overBudget.map((r) => r.room.name), ['Bathroom']);
  assert.deepEqual(s.categories.map((c) => [c.category.name, c.cents]), [['Materials', 80000], ['Tools', 20000]]);
});

test('accepted quotes count as committed until paid', () => {
  const quotes = [
    { id: 'q1', status: 'accepted', amountCents: 30000, roomId: 'k' },
    { id: 'q2', status: 'quoted', amountCents: 99999, roomId: 'k' },
  ];
  const paid = [...expenses, { id: 'e5', status: 'filed', date: '2026-10-25', totalCents: 10000, quoteId: 'q1', lines: [line('k', 'm', 10000)] }];
  assert.equal(quoteOutstanding(quotes[0], paid), 20000);
  assert.equal(quoteOutstanding(quotes[1], paid), 0);
  const s = computeStats({ rooms, categories, expenses: paid, quotes });
  assert.equal(s.committed, 20000);
  const kitchen = s.rooms.find((r) => r.room.id === 'k');
  assert.deepEqual([kitchen.spent, kitchen.committed, kitchen.remaining], [50000, 20000, 30000]);
  assert.equal(s.remaining, 150000 - 110000 - 20000);
});

test('spend over time: days for a short reno, weeks or months for longer ones', () => {
  const short = spendOverTime(expenses, '2026-10-24');
  assert.equal(short.unit, 'day');
  assert.equal(short.points.length, 24);
  assert.equal(short.points[0].label, '1 Oct');
  assert.equal(short.points.at(-1).cumulative, 100000);

  const weekly = spendOverTime(expenses, '2026-12-15');
  assert.equal(weekly.unit, 'week');
  assert.equal(weekly.points[0].start, '2026-09-28'); // the Monday before 1 Oct
  assert.equal(weekly.points[0].label, 'w/c 28 Sep');
  assert.equal(weekly.points.reduce((s, p) => s + p.amount, 0), 100000);

  const monthly = spendOverTime(expenses, '2027-08-01');
  assert.equal(monthly.unit, 'month');
  assert.deepEqual(monthly.points.slice(0, 2).map((p) => [p.label, p.amount]), [['Oct 26', 100000], ['Nov 26', 0]]);
  assert.equal(monthly.points.at(-1).label, 'Aug 27');

  assert.deepEqual(spendOverTime([], '2026-10-24').points, []);
});

test('the spend line is smooth but never overshoots a running total', () => {
  const pts = [[0, 100], [10, 100], [20, 40], [30, 38], [40, 0]]; // y grows downwards on screen
  const d = smoothPath(pts);
  assert.match(d, /^M0\.0,100\.0 C/);
  assert.equal((d.match(/C/g) || []).length, 4);
  // Every control point stays between its segment's end values (no bulges above or below the data).
  const nums = d.replace(/[MC]/g, ' ').trim().split(/[ ,]+/).map(Number);
  const ys = nums.filter((_, i) => i % 2 === 1);
  for (const yv of ys) assert.ok(yv >= 0 && yv <= 100, `control point ${yv} overshoots`);
  // Flat stretches stay flat.
  assert.match(d, /C3\.3,100\.0 6\.7,100\.0 10\.0,100\.0/);
});

test('quote progress: paid so far, still owed, and quoted vs actual', () => {
  const pay = (id, quoteId, cents, status = 'filed') => ({ id, quoteId, status, totalCents: cents, lines: [] });
  const ex = [pay('a', 'q1', 30000), pay('b', 'q1', 20000), pay('c', 'q2', 105000), pay('d', 'q2', 99999, 'inbox')];
  const accepted = { id: 'q1', status: 'accepted', amountCents: 80000 };
  const paid = { id: 'q2', status: 'paid', amountCents: 100000 };
  const quoted = { id: 'q3', status: 'quoted', amountCents: 40000 };
  assert.deepEqual(
    (({ paid: p, outstanding, left, diff }) => ({ p, outstanding, left, diff }))(quoteProgress(accepted, ex)),
    { p: 50000, outstanding: 30000, left: 30000, diff: null },
  );
  const done = quoteProgress(paid, ex);
  assert.equal(done.paid, 105000); // the unsorted inbox receipt doesn't count
  assert.equal(done.diff, 5000); // $50 over the quote
  assert.equal(done.outstanding, 0);
  assert.equal(quoteProgress(quoted, ex).outstanding, 0);
  const t = quoteTotals([accepted, paid, quoted, { id: 'q4', status: 'declined', amountCents: 999 }], ex);
  assert.deepEqual([t.quoted, t.quotedCount, t.committed, t.acceptedCount, t.paidCount, t.paidQuoted, t.paidDiff],
    [40000, 1, 30000, 1, 1, 100000, 5000]);
});

test('quote parts: a breakdown by category, or the whole amount in one', () => {
  assert.deepEqual(quoteParts({ categoryId: 'l', amountCents: 50000 }), [{ categoryId: 'l', amountCents: 50000 }]);
  const parts = [{ categoryId: 'l', amountCents: 36500 }, { categoryId: 'h', amountCents: 12000 }, { categoryId: 'f', amountCents: 1500 }];
  assert.deepEqual(quoteParts({ categoryId: 'l', amountCents: 50000, parts }), parts);
  assert.deepEqual(quoteParts({ categoryId: 'l', amountCents: 50000, parts: [parts[0]] }), [{ categoryId: 'l', amountCents: 50000 }]);
});

test('the spend line is blurred smooth, but starts and ends at the real totals and never dips', () => {
  const steps = [0, 0, 500, 500, 500, 4000, 4000, 4100, 4100, 9000, 9000, 9000];
  const smooth = smoothSeries(steps, steps.length / 7);
  assert.equal(smooth[0], 0);
  assert.ok(Math.abs(smooth.at(-1) - 9000) < 1e-9);
  for (let i = 1; i < smooth.length; i++) assert.ok(smooth[i] >= smooth[i - 1] - 1e-9, `dips at ${i}`);
  const bumpiness = (v) => v.slice(2).reduce((sum, x, i) => sum + Math.abs(x - 2 * v[i + 1] + v[i]), 0);
  assert.ok(bumpiness(smooth) < bumpiness(steps) / 2, 'much smoother than the steps');
  assert.deepEqual(smoothSeries([5, 10], 2), [5, 10]); // too short to blur
});

test('payments coming up: unpaid quotes and bills with a due date, soonest first, with what is still owed', () => {
  const q = (id, status, amountCents, dueDate) => ({ id, status, amountCents, dueDate });
  const quotes = [
    q('later', 'accepted', 100000, '2026-11-20'),
    q('overdue', 'quoted', 25000, '2026-10-25'),
    q('none', 'accepted', 50000, null), // no due date
    q('paid', 'paid', 70000, '2026-11-01'),
    q('declined', 'declined', 70000, '2026-11-01'),
    q('covered', 'accepted', 30000, '2026-11-02'), // already paid in full
  ];
  const ex = [{ id: 'p', quoteId: 'later', status: 'filed', totalCents: 40000 }, { id: 'c', quoteId: 'covered', status: 'filed', totalCents: 30000 }];
  const up = upcomingPayments(quotes, ex, '2026-10-28');
  assert.deepEqual(up.map((u) => [u.quote.id, u.amount, u.days]), [['overdue', 25000, -3], ['later', 60000, 23]]);
});
