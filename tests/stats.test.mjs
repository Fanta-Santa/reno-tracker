// Checks the dashboard numbers. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetStatus, computeStats, quoteOutstanding, spendOverTime } from '../js/stats.js';
import { smoothPath } from '../js/ui/charts.js';

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
