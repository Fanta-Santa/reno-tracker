// Offline checks for the money, date and backup-zip logic.  Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMoney, formatMoney, centsToInput, gstFromTotal, expenseGst, splitEvenly,
  formatDate, todayISO, monthLabel, shortDate, daysBetween, addDays,
} from '../js/format.js';
import { createZip, readZip, crc32 } from '../js/zip.js';

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

test('the offline cache lists every app file, and versions match', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]));
  const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
  const needed = [...walk('js'), ...walk('css'), ...walk('icons'), ...walk('vendor')]
    .filter((f) => /\.(js|mjs|css|png|svg)$/.test(f));
  for (const f of needed) assert.ok(listed.has(f), `sw.js FILES is missing ${f}`);
  for (const f of listed) {
    if (f !== './') assert.ok(statSync(join(ROOT, f)), `sw.js lists ${f} but it doesn't exist`);
  }
  const swVersion = sw.match(/const VERSION = '([^']+)'/)[1];
  const appVersion = readFileSync(join(ROOT, 'js/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  assert.equal(swVersion, appVersion, 'Bump VERSION in sw.js and APP_VERSION in js/version.js together');
});
