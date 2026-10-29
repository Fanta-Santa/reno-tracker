// Offline checks for the money, date and backup-zip logic.  Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMoney, formatMoney, centsToInput, gstFromTotal, expenseGst, splitEvenly, splitByWeights,
  formatDate, todayISO, monthLabel, shortDate, daysBetween, addDays,
} from '../js/format.js';
import { createZip, readZip, crc32 } from '../js/zip.js';
import { buildSheets, numberItems, toCSV, toXLSX, xlsxEntries, financialYear, cleanName } from '../js/export.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('parseMoney reads what people type', () => {
  assert.equal(parseMoney('12'), 1200);
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('12.50'), 1250);
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney(' .5 '), 50);
  assert.equal(parseMoney('-20'), -2000);
  assert.equal(parseMoney('0.07'), 7);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('1.234'), null);
  assert.equal(parseMoney('1.2.3'), null);
});

test('money formats as AUD and round-trips through the input box', () => {
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(123456, { whole: true }), '$1,235');
  assert.equal(formatMoney(null), '');
  for (const c of [0, 7, 1250, 99999, -2000]) assert.equal(parseMoney(centsToInput(c)), c);
  assert.equal(centsToInput(1250), '12.50');
  assert.equal(centsToInput(-5), '-0.05');
});

test('GST is one eleventh of a GST-inclusive total', () => {
  assert.equal(gstFromTotal(11000), 1000);
  assert.equal(gstFromTotal(8450), 768); // $84.50 -> $7.68
  assert.equal(expenseGst({ totalCents: 11000, gstMode: 'auto' }), 1000);
  assert.equal(expenseGst({ totalCents: 11000, gstMode: 'none' }), 0);
  assert.equal(expenseGst({ totalCents: 11000, gstMode: 'custom', gstCents: 412 }), 412);
});

test('splitEvenly always adds back up to the total', () => {
  assert.deepEqual(splitEvenly(1000, 3), [334, 333, 333]);
  assert.deepEqual(splitEvenly(-1000, 3), [-334, -333, -333]);
  for (const [total, n] of [[1, 4], [9999, 7], [100, 1]]) {
    assert.equal(splitEvenly(total, n).reduce((a, b) => a + b, 0), total);
  }
});

test('splitByWeights splits in proportion and always adds back up', () => {
  assert.deepEqual(splitByWeights(500000, [365000, 120000, 15000]), [365000, 120000, 15000]);
  assert.deepEqual(splitByWeights(30000, [365000, 120000, 15000]), [21900, 7200, 900]); // a $300 deposit
  assert.deepEqual(splitByWeights(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(splitByWeights(1000, [0, 0]), [500, 500]); // no weights: evenly
  for (const [total, w] of [[70001, [3, 7, 11]], [1, [5, 5]], [99999, [1, 2, 3, 4]]]) {
    assert.equal(splitByWeights(total, w).reduce((a, b) => a + b, 0), total);
  }
});

test('dates show as dd/mm/yyyy', () => {
  assert.equal(formatDate('2026-10-27'), '27/10/2026');
  assert.equal(monthLabel('2026-03-01'), 'March 2026');
  assert.equal(shortDate('2026-03-09'), '9 Mar');
  assert.equal(todayISO(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(daysBetween('2026-02-27', '2026-03-01'), 2);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('backup zips round-trip and open with the standard unzip tool', async () => {
  const photo = new Uint8Array(5000).map((_, i) => (i * 31) % 256);
  const blob = await createZip([
    { name: 'backup.json', data: '{"app":"reno-tracker","name":"Café reno"}' },
    { name: 'receipts/a.jpg', data: new Blob([photo]) },
    { name: 'thumbs/a.jpg', data: photo.slice(0, 100) },
  ]);
  const files = await readZip(blob);
  assert.deepEqual([...files.keys()], ['backup.json', 'receipts/a.jpg', 'thumbs/a.jpg']);
  assert.equal(await (await files.get('backup.json').blob()).text(), '{"app":"reno-tracker","name":"Café reno"}');
  assert.deepEqual(new Uint8Array(await (await files.get('receipts/a.jpg').blob()).arrayBuffer()), photo);

  // The zip must also be valid for other tools (e.g. opening it on a computer).
  const tmp = join(ROOT, 'tests', '.tmp-test.zip');
  const { writeFileSync, rmSync } = await import('node:fs');
  writeFileSync(tmp, new Uint8Array(await blob.arrayBuffer()));
  try {
    const out = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or "ok")', tmp]).toString().trim();
    assert.equal(out, 'ok');
  } finally {
    rmSync(tmp, { force: true });
  }
});

test('readZip also opens compressed zips (re-zipped on a computer)', async () => {
  const b64 = execFileSync('python3', ['-c', [
    'import io,zipfile,base64',
    'b=io.BytesIO()',
    'z=zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED)',
    'z.writestr("backup.json","{\\"app\\":\\"reno-tracker\\"}"*50)',
    'z.close()',
    'print(base64.b64encode(b.getvalue()).decode())',
  ].join('\n')]).toString().trim();
  const files = await readZip(new Blob([Buffer.from(b64, 'base64')]));
  const text = await (await files.get('backup.json').blob()).text();
  assert.equal(text, '{"app":"reno-tracker"}'.repeat(50));
});

test('readZip rejects files that are not zips', async () => {
  await assert.rejects(readZip(new Blob(['hello'])), /not a backup/);
});

// ---------- Export ----------

const xRooms = [{ id: 'k', name: 'Kitchen', budgetCents: 1500000 }, { id: 'b', name: 'Bathroom', budgetCents: 900000 }];
const xCats = [{ id: 't', name: 'Tools', isTool: true }, { id: 'm', name: 'Materials' }, { id: 'l', name: 'Trades / labour' }];
const xLine = (id, roomId, categoryId, amountCents, description) => ({ id, roomId, categoryId, amountCents, isTool: categoryId === 't', description });
const xExpenses = [
  { id: 'e1', date: '2026-10-01', createdAt: 1, store: 'Bunnings', description: 'Screws, "timber" & sander', totalCents: 60000, gstCents: 5455,
    fileIds: ['f1'], notes: '=SUM(A1)', lines: [xLine('a', 'k', 'm', 40000, 'Treated pine'), xLine('b', 'b', 't', 20000, 'Ryobi sander')] },
  { id: 'e2', date: '2026-09-20', createdAt: 2, store: 'Pete’s Plumbing', description: 'Deposit', totalCents: 30000, gstCents: 2727,
    fileIds: [], notes: '', quoteId: 'q1', lines: [xLine('c', 'b', 'l', 30000)] },
];
const xQuotes = [{ id: 'q1', date: '2026-09-01', supplier: 'Pete’s Plumbing', description: 'Rough-in', roomId: 'b', categoryId: 'l', amountCents: 100000, status: 'accepted', dueDate: '2026-11-07' }];
const xCtx = { project: { name: 'Smith St reno' }, rooms: xRooms, categories: xCats, quotes: xQuotes, allExpenses: xExpenses, period: 'Everything', today: '2026-10-28', everything: true };

test('financial years run 1 July to 30 June', () => {
  assert.deepEqual(financialYear('2026-10-28'), { from: '2026-07-01', to: '2027-06-30', label: '2026–27' });
  assert.deepEqual(financialYear('2026-06-30'), { from: '2025-07-01', to: '2026-06-30', label: '2025–26' });
  assert.equal(financialYear('2026-10-28', -1).label, '2025–26');
  assert.equal(cleanName('Pete’s Plumbing / Gas: "PTY"'), 'Pete’s Plumbing - Gas- -PTY-');
});

test('export: oldest first with references, GST shared across items, partial receipts noted', () => {
  const numbered = numberItems(xExpenses.map((e) => ({ expense: e, lines: e.lines })));
  assert.deepEqual(numbered.map((it) => [it.ref, it.expense.id]), [['R001', 'e2'], ['R002', 'e1']]);
  const sheets = buildSheets(numbered, xCtx);
  assert.deepEqual(sheets.map((s) => s.name), ['Summary', 'Expenses', 'Items', 'Quotes']);
  const items = sheets.find((s) => s.name === 'Items').rows;
  assert.deepEqual(items.slice(2).map((r) => [r[3], r[7].m, r[8].m]), [['Treated pine', 40000, 3637], ['Ryobi sander', 20000, 1818]]);
  const csv = toCSV(items);
  assert.ok(csv.startsWith('\ufeffRef,Date,Store,Item,'));
  assert.match(csv, /\r\nR002,01\/10\/2026,Bunnings,Treated pine,Kitchen,Materials,,400\.00,36\.37,600\.00,Yes,'=SUM\(A1\)\r\n/);
  // Just the bathroom part of a receipt (e.g. from a filtered list)
  const part = buildSheets(numberItems([{ expense: xExpenses[0], lines: [xExpenses[0].lines[1]] }]), { ...xCtx, everything: false, period: 'Bathroom' });
  const row = part.find((s) => s.name === 'Expenses').rows[1];
  assert.deepEqual([row[6].m, row[7].m, row[12]], [20000, 1818, 'Part of a $600.00 receipt. =SUM(A1)']);
  assert.ok(!part.some((s) => s.name === 'Quotes'));
  const csvQuoted = toCSV(sheets.find((s) => s.name === 'Expenses').rows);
  assert.match(csvQuoted, /,"Screws, ""timber"" & sander",/);
});

test('the Excel file is a valid workbook with real dates and amounts', async () => {
  const sheets = buildSheets(numberItems(xExpenses.map((e) => ({ expense: e, lines: e.lines }))), xCtx);
  const files = await readZip(await toXLSX(sheets));
  assert.deepEqual([...files.keys()].slice(0, 5), ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']);
  const items = await (await files.get('xl/worksheets/sheet3.xml').blob()).text();
  assert.match(items, /<c r="B2" s="3"><v>46285<\/v><\/c>/); // 20/09/2026 as an Excel date
  assert.match(items, /<c r="H2" s="2"><v>300\.00<\/v><\/c>/); // $300.00 as a number
  assert.match(items, /<autoFilter ref="A1:L4"\/>/);
  // Every part must be well-formed XML (checked with Python's own parser).
  const tmp = join(ROOT, 'tests', '.tmp-test.xlsx');
  const { writeFileSync, rmSync } = await import('node:fs');
  writeFileSync(tmp, new Uint8Array(await (await toXLSX(sheets)).arrayBuffer()));
  try {
    const out = execFileSync('python3', ['-c', 'import sys,zipfile,xml.dom.minidom as m; z=zipfile.ZipFile(sys.argv[1]); [m.parseString(z.read(n)) for n in z.namelist()]; print("ok")', tmp]).toString().trim();
    assert.equal(out, 'ok');
  } finally {
    rmSync(tmp, { force: true });
  }
  assert.equal(xlsxEntries([{ name: 'A & B', rows: [['x']], table: false }])[2].data.includes('name="A &amp; B"'), true);
});

test('the offline cache lists every app file, and versions match', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const list = (name) => new Set([...sw.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const files = list('FILES');
  const reader = list('READER_FILES');
  const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
  const appFiles = [...walk('js'), ...walk('css'), ...walk('icons'), ...walk('vendor')]
    .filter((f) => /\.(js|mjs|css|png|svg|woff2)$/.test(f) && !f.startsWith('vendor/tesseract/'));
  for (const f of appFiles) assert.ok(files.has(f), `sw.js FILES is missing ${f}`);
  // The big receipt-reader files are fetched on first use, not with every update.
  for (const f of walk('vendor/tesseract').filter((x) => /\.(js|gz)$/.test(x))) {
    assert.ok(reader.has(f), `sw.js READER_FILES is missing ${f}`);
    assert.ok(!files.has(f), `${f} shouldn't be in FILES (it's downloaded on first use)`);
  }
  for (const f of [...files, ...reader]) {
    if (f !== './') assert.ok(statSync(join(ROOT, f)), `sw.js lists ${f} but it doesn't exist`);
  }
  const swVersion = sw.match(/const VERSION = '([^']+)'/)[1];
  const appVersion = readFileSync(join(ROOT, 'js/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  assert.equal(swVersion, appVersion, 'Bump VERSION in sw.js and APP_VERSION in js/version.js together');
});

test('the icons are the sizes the manifest says, and solid (iPhone fills see-through corners with black)', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  // A PNG's width and height sit at bytes 16-23; byte 25 is its colour type (2 = RGB, no transparency).
  const png = (file) => {
    const b = readFileSync(join(ROOT, file));
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 4 || b[25] === 6 };
  };
  for (const icon of manifest.icons) {
    const [w, h] = icon.sizes.split('x').map(Number);
    const p = png(icon.src);
    assert.deepEqual([p.w, p.h], [w, h], `${icon.src} should be ${icon.sizes}`);
  }
  const touch = png('icons/apple-touch-icon.png');
  assert.deepEqual([touch.w, touch.h, touch.alpha], [180, 180, false]);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon.png"/);
  assert.match(html, /rel="icon" href="icons\/icon.svg"/);
});

test('every colour and size token the stylesheet uses is defined', () => {
  const css = readFileSync(join(ROOT, 'css/app.css'), 'utf8');
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  // A few are set from JavaScript, per element.
  for (const name of ['--count', '--index']) defined.add(name);
  for (const name of used) assert.ok(defined.has(name), `css/app.css uses var(${name}) but never defines it`);
});
