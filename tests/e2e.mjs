// Clicks through the app in a phone-sized browser, like a person would.
// Run: node tests/e2e.mjs            (add --shots <folder> to save screenshots)
// Needs Playwright with Chromium installed.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const PORT = 8765;
const server = await serve(PORT);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
  locale: 'en-AU',
  timezoneId: 'Australia/Brisbane',
});
let page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let step = 0;
async function shot(name) {
  if (!SHOTS) return;
  await page.waitForTimeout(450); // let animations settle
  await page.screenshot({ path: join(SHOTS, `${String(++step).padStart(2, '0')}-${name}.png`) });
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.log(`  ✗ ${name}`);
    if (errors.length) console.log(`Browser errors so far:\n${errors.join('\n')}`);
    await page.screenshot({ path: join(FIXTURES, '..', 'failure.png') }).catch(() => {});
    throw err;
  }
}
const tap = (locator) => locator.click();
const sheet = () => page.locator('.sheet-layer.open .sheet').last();
async function choose(kind, files) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), kind()]);
  await chooser.setFiles(files);
}
async function addMenu(label) {
  await tap(page.getByRole('button', { name: 'Add expense' }));
  return page.locator('.action-btn', { hasText: label });
}
const expectToast = (text) => page.locator('.toast-msg', { hasText: text }).waitFor();

/** Answers any "not sure" item cards (accepting the suggestion, or the first category) until the summary shows. */
async function finishCards() {
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(450);
    if (await sheet().getByText('All set?').isVisible()) return;
    const kicker = (await sheet().locator('.flash-card .fc-kicker').textContent()) || '';
    if (!kicker.startsWith('Not sure')) continue;
    const ok = sheet().getByRole('button', { name: 'Correct', exact: true });
    if (await ok.isDisabled()) await tap(sheet().locator('.flash-card .chip').first());
    else await tap(ok);
  }
  throw new Error('Never reached the summary card');
}

try {
  await page.goto(`http://localhost:${PORT}/`);

  await check('first-run setup creates a project', async () => {
    await page.getByText('Start a new project').waitFor();
    await shot('welcome');
    await tap(page.getByText('Start a new project'));
    await page.getByPlaceholder('e.g. Smith St reno').fill('Test Reno');
    await tap(page.getByRole('button', { name: 'Next' }));
    await page.getByText('Rooms & stages').waitFor();
    // Give the kitchen a budget.
    await tap(page.locator('.setup-room-main', { hasText: 'Kitchen' }));
    await sheet().getByPlaceholder('No budget').fill('500');
    await tap(sheet().getByRole('button', { name: 'Save', exact: true }));
    await page.getByText('Budget $500').waitFor();
    // Turn off Deck.
    await tap(page.getByRole('switch', { name: 'Include Deck' }));
    await shot('rooms');
    await tap(page.getByRole('button', { name: /Create project with 4 rooms/ }));
    await page.locator('h1', { hasText: 'Test Reno' }).waitFor();
    await shot('dashboard-empty');
  });

  await check('manual expense with GST and smart defaults', async () => {
    await tap(await addMenu('Enter manually'));
    await page.getByText('New expense').waitFor();
    await sheet().locator('#amount').fill('84.5');
    await tap(sheet().locator('.chip', { hasText: 'Bunnings' }));
    await sheet().getByPlaceholder('e.g. Screws, timber, sander').fill('Screws and timber');
    await tap(sheet().locator('.chip', { hasText: 'Kitchen' }));
    await tap(sheet().locator('.chip', { hasText: 'Hardware & fixings' }));
    await sheet().locator('.gst-value', { hasText: 'GST $7.68' }).waitFor();
    await shot('form-manual');
    await tap(sheet().getByRole('button', { name: 'Save', exact: true }));
    await expectToast('Expense saved');
  });

  await check('split receipt across rooms, tool flag from store category', async () => {
    await tap(await addMenu('Enter manually'));
    // Smart default: last store is pre-filled.
    assert.equal(await sheet().getByPlaceholder('e.g. Bunnings').inputValue(), 'Bunnings');
    await sheet().locator('#amount').fill('200');
    await tap(sheet().locator('.chip', { hasText: 'Total Tools' }));
    // Total Tools' usual category is Tools, so the tool switch turns on.
    assert.equal(await sheet().getByRole('switch', { name: 'Tool' }).isChecked(), true);
    await tap(sheet().getByText('Split across rooms or categories'));
    const amounts = sheet().locator('.split-amount input');
    await amounts.nth(0).fill('120');
    await amounts.nth(1).fill('50');
    await sheet().getByText('$30.00 left to allocate').waitFor();
    await shot('form-split-unbalanced');
    await tap(sheet().getByText('Fix on last line'));
    await sheet().getByText('Adds up to the total').waitFor();
    await sheet().locator('.split-selects select').nth(2).selectOption({ label: '🎨 Painting' });
    await shot('form-split');
    await tap(sheet().getByRole('button', { name: 'Save', exact: true }));
    await expectToast('Expense saved');
  });

  await check('duplicate warning, then discarded draft can be undone', async () => {
    await tap(await addMenu('Enter manually'));
    await tap(sheet().getByRole('button', { name: 'Save', exact: true }));
    await expectToast('Enter the total amount.');
    await sheet().locator('#amount').fill('84.50');
    await tap(sheet().locator('.chip', { hasText: 'Bunnings' }));
    await tap(sheet().getByRole('button', { name: 'Save', exact: true }));
    await page.getByText('Looks like one you’ve already logged').waitFor();
    await shot('duplicate-warning');
    await tap(page.locator('.action-cancel'));
    await page.waitForTimeout(400);
    await tap(sheet().getByRole('button', { name: 'Cancel' }));
    await expectToast('Draft discarded');
    await tap(page.locator('.toast-action'));
    await page.getByText('New expense').waitFor();
    assert.equal(await sheet().locator('#amount').inputValue(), '84.50');
    await tap(sheet().getByRole('button', { name: 'Cancel' }));
    await page.waitForTimeout(400);
  });

  await check('with reading switched off, photos go to the form and the inbox', async () => {
    await tap(page.locator('.tab', { hasText: 'Settings' }));
    await tap(page.getByRole('switch', { name: 'Read receipts automatically' }));
    await choose(async () => tap(await addMenu('Upload PDF or screenshot')), join(FIXTURES, 'receipt.jpg'));
    await sheet().locator('.receipt-tile img').waitFor();
    await shot('form-with-photo');
    await tap(sheet().getByText('Sort later (save to inbox)'));
    await expectToast('Saved to inbox to sort later');
    await tap(page.locator('.tab', { hasText: 'Expenses' }));
    await page.locator('.tab-badge', { hasText: '1' }).waitFor();
    await page.getByText('1 receipt to sort').waitFor();
    await shot('expenses-with-inbox');
    await tap(page.getByText('1 receipt to sort'));
    await page.locator('.inbox-tile', { hasText: 'Tap to sort' }).waitFor();
    await tap(page.locator('.inbox-tile'));
    await page.getByText('Sort receipt').waitFor();
    await sheet().locator('#amount').fill('84.50');
    await sheet().getByPlaceholder('e.g. Bunnings').fill('Mitre 10');
    await tap(sheet().locator('.chip', { hasText: 'Bathroom' }));
    await tap(sheet().locator('.chip', { hasText: 'Fixtures & fittings' }));
    await tap(sheet().getByRole('button', { name: 'Save', exact: true }));
    await expectToast('Receipt sorted');
    await page.getByText('All sorted').waitFor();
    await tap(page.locator('.tab', { hasText: 'Settings' }));
    await tap(page.getByRole('switch', { name: 'Read receipts automatically' }));
    assert.equal(await page.getByRole('switch', { name: 'Read receipts automatically' }).isChecked(), true);
  });

  await check('scanned PDF is read, then confirmed with cards', async () => {
    await choose(async () => tap(await addMenu('Upload PDF or screenshot')), join(FIXTURES, 'order.pdf'));
    await sheet().locator('.flash-card').waitFor({ timeout: 90000 });
    assert.equal(await sheet().locator('.fc-field.total input').inputValue(), '87.00');
    await sheet().getByPlaceholder('Store or supplier').fill('Mitre 10 Online');
    await tap(sheet().getByRole('button', { name: 'All correct' }));
    await tap(sheet().locator('.room-tile', { hasText: 'Bathroom' }));
    await finishCards();
    await sheet().getByText('Items add up to the total').waitFor();
    await tap(sheet().getByRole('button', { name: 'Save expense' }));
    await expectToast('Expense saved');
  });

  await check('list shows everything with month total', async () => {
    await tap(page.locator('.tab', { hasText: 'Expenses' }));
    await page.locator('.expense-row').nth(3).waitFor();
    assert.equal(await page.locator('.expense-row').count(), 4);
    await page.locator('.list-heading', { hasText: '$456.00' }).waitFor();
    await shot('expenses-list');
  });

  await check('search and filters', async () => {
    await page.getByPlaceholder('Search store, item, room, amount').fill('mitre');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.expense-row').count(), 2);
    await page.getByPlaceholder('Search store, item, room, amount').fill('');
    await tap(page.getByRole('button', { name: 'Filters' }));
    await tap(sheet().getByRole('switch', { name: 'Tools only' }));
    await shot('filters');
    await tap(sheet().getByRole('button', { name: /Show 1 expense/ }));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.expense-row').count(), 1);
    await page.locator('.expense-amount strong', { hasText: '$200.00' }).waitFor();
    await tap(page.locator('.chip.removable', { hasText: 'Tools only' }));
    assert.equal(await page.locator('.expense-row').count(), 4);
    // Filtering by room shows just that room's share of a split receipt.
    await tap(page.getByRole('button', { name: 'Filters' }));
    await tap(sheet().locator('.chip', { hasText: 'Kitchen' }));
    await tap(sheet().getByRole('button', { name: /Show 2 expenses/ }));
    await page.locator('.expense-amount', { hasText: '$120.00of $200.00' }).waitFor();
    await page.getByText('$204.50 · 2 expenses shown').waitFor();
    await shot('filtered-room');
    await tap(page.locator('.chip.removable', { hasText: 'Kitchen' }));
    await tap(page.getByRole('button', { name: 'Filters' }));
    await tap(sheet().getByRole('tab', { name: 'Missing' }));
    await tap(sheet().getByRole('button', { name: /Show 2 expenses/ }));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.expense-row').count(), 2);
    await tap(page.locator('.chip.removable', { hasText: 'Missing receipt' }));
  });

  await check('detail, receipt viewer, delete and undo', async () => {
    await tap(page.locator('.expense-row', { hasText: 'Mitre 10 Online' }));
    await page.locator('.detail-amount', { hasText: '$87.00' }).waitFor();
    await shot('detail');
    await tap(page.getByRole('button', { name: 'View receipt' }).first());
    await page.locator('.viewer-page').nth(1).waitFor({ timeout: 15000 }); // both PDF pages
    assert.equal(await page.locator('.viewer-page').count(), 2);
    await shot('viewer-pdf');
    await tap(page.getByRole('button', { name: 'Close' }));
    await page.waitForTimeout(300);
    await tap(page.getByRole('button', { name: 'Delete expense' }));
    await expectToast('Expense deleted');
    await page.locator('h1', { hasText: 'Expenses' }).waitFor();
    assert.equal(await page.locator('.expense-row').count(), 3);
    await tap(page.locator('.toast-action'));
    await page.locator('.expense-row').nth(3).waitFor();
  });

  await check('edit an expense, then undo the change', async () => {
    await tap(page.locator('.expense-row', { hasText: 'Screws and timber' }));
    await tap(page.getByRole('button', { name: 'Edit' }));
    await sheet().locator('#amount').fill('90');
    await tap(sheet().getByRole('button', { name: 'Save', exact: true }));
    await page.locator('.detail-amount', { hasText: '$90.00' }).waitFor();
    await tap(page.locator('.toast-action'));
    await page.locator('.detail-amount', { hasText: '$84.50' }).waitFor();
    await tap(page.locator('.nav-back'));
  });

  await check('swipe left on a row reveals Delete', async () => {
    const row = page.locator('.swipe-content').first();
    const box = await row.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 20, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width - 20 - i * 15, y);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await shot('swipe');
    await page.locator('.swipe-action', { hasText: 'Delete' }).first().waitFor();
    const transform = await row.evaluate((el) => el.style.transform);
    assert.match(transform, /translateX\(-80px\)/);
    await tap(row); // tap closes it again
    await page.waitForTimeout(400);
  });

  await check('dashboard totals', async () => {
    await tap(page.locator('.tab', { hasText: 'Home' }));
    await page.locator('.hero-amount', { hasText: '$456.00' }).waitFor();
    await page.locator('.tile', { hasText: 'Tools' }).locator('strong', { hasText: '$200' }).waitFor();
    await page.getByText('2 expenses are missing a receipt').waitFor();
    await shot('dashboard');
  });

  await check('settings lists and rename a store', async () => {
    await tap(page.locator('.tab', { hasText: 'Settings' }));
    await shot('settings');
    await tap(page.getByText('Stores'));
    await page.getByText('Mitre 10 Online').waitFor(); // learned automatically
    await tap(page.getByText('Mitre 10', { exact: true }));
    await sheet().getByPlaceholder('e.g. Reece Plumbing').fill('Mitre 10 Mega');
    await tap(sheet().getByRole('button', { name: 'Save', exact: true }));
    await page.getByText('Mitre 10 Mega').waitFor();
    await tap(page.locator('.nav-back'));
    await tap(page.getByText('Rooms & stages'));
    await tap(page.locator('.row', { hasText: 'Bathroom' }));
    await tap(sheet().getByRole('button', { name: 'Delete' }));
    await expectToast(/archived/);
    await page.getByRole('heading', { name: 'Archived' }).waitFor();
    await shot('rooms-archived');
    await tap(page.locator('.nav-back'));
  });

  let backupPath;
  await check('backup to a zip file', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), tap(page.getByText('Back up now'))]);
    backupPath = join(FIXTURES, '..', '.tmp-backup.zip');
    await download.saveAs(backupPath);
    assert.match(download.suggestedFilename(), /^reno-backup-test-reno-\d{4}-\d{2}-\d{2}\.zip$/);
    await page.getByText(/Last: \d\d\/\d\d\/\d{4}/).waitFor();
  });

  await check('restore into a fresh phone', async () => {
    const fresh = await context.browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p2 = await fresh.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(`http://localhost:${PORT}/`);
    const [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.getByText('Restore from a backup').click()]);
    await chooser.setFiles(backupPath);
    await p2.getByText('Restore “Test Reno”?').waitFor();
    await p2.locator('.action-btn', { hasText: 'Restore' }).click();
    await p2.locator('.hero-amount', { hasText: '$456.00' }).waitFor();
    await p2.locator('.tab', { hasText: 'Expenses' }).click();
    await p2.locator('.expense-row').nth(3).waitFor();
    assert.equal(await p2.locator('.expense-row').count(), 4);
    await p2.locator('.expense-row', { hasText: 'Mitre 10 Online' }).click();
    await p2.locator('.receipt-big img').waitFor();
    await fresh.close();
  });

  // ---------- Receipt reading, on a second "phone" ----------

  await check('second phone: quick setup', async () => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      locale: 'en-AU', timezoneId: 'Australia/Brisbane',
    });
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/`);
    await tap(page.getByText('Start a new project'));
    await page.getByPlaceholder('e.g. Smith St reno').fill('Reader Reno');
    await tap(page.getByRole('button', { name: 'Next' }));
    await tap(page.getByRole('button', { name: /Create project with 5 rooms/ }));
    await page.locator('h1', { hasText: 'Reader Reno' }).waitFor();
  });

  await check('snap a receipt: read on the phone, confirmed with cards', async () => {
    await choose(async () => tap(await addMenu('Snap a receipt')), join(FIXTURES, 'bunnings-photo.jpg'));
    await page.locator('.scan-line').waitFor();
    await shot('scanning');
    await sheet().locator('.flash-card').waitFor({ timeout: 90000 });
    await shot('card-details');
    assert.equal(await sheet().getByPlaceholder('Store or supplier').inputValue(), 'Bunnings');
    assert.equal(await sheet().locator('.fc-field.total input').inputValue(), '144.21');
    assert.equal(await sheet().locator('.fc-field input[type="date"]').inputValue(), '2026-10-27');
    await tap(sheet().getByRole('button', { name: 'All correct' }));
    await sheet().getByText('Where’s this for?').waitFor();
    await shot('card-room');
    await tap(sheet().locator('.room-tile', { hasText: 'Kitchen' }));
    await finishCards();
    await sheet().getByText('Items add up to the total').waitFor();
    assert.equal(await sheet().locator('.sum-row').count(), 5);
    await shot('card-summary');
    await tap(sheet().getByRole('button', { name: 'Save expense' }));
    await expectToast('Expense saved');
    await tap(page.locator('.tab', { hasText: 'Expenses' }));
    await page.locator('.expense-row', { hasText: 'Buildex Screw Batten' }).locator('.tag.tool').waitFor();
    await tap(page.locator('.expense-row', { hasText: 'Bunnings' }));
    await page.locator('.group-title', { hasText: 'Items' }).waitFor();
    assert.equal(await page.locator('.line-row').count(), 5);
    await page.locator('.line-row', { hasText: 'Ozito 18V Drill Driver Skin Only' }).getByText(/Tools · Tool/).waitFor();
    await shot('detail-items');
    await tap(page.locator('.nav-back'));
    // Search finds an item on the receipt.
    await page.getByPlaceholder('Search store, item, room, amount').fill('gorilla');
    await page.locator('.expense-row', { hasText: 'Bunnings' }).waitFor();
    await page.getByPlaceholder('Search store, item, room, amount').fill('');
  });

  await check('quick snap is read in the background, then checked from the inbox', async () => {
    await choose(async () => tap(await addMenu('Quick snap')), join(FIXTURES, 'kennards-photo.jpg'));
    await expectToast('Receipt saved to inbox and being read');
    await tap(page.getByText('1 receipt to sort'));
    await page.locator('.tile-badge.ready').waitFor({ timeout: 90000 });
    await page.locator('.inbox-tile', { hasText: '$167.00' }).waitFor();
    await shot('inbox-read');
    await tap(page.getByRole('button', { name: 'Check receipt' }));
    await sheet().locator('.flash-card').waitFor();
    assert.equal(await sheet().getByPlaceholder('Store or supplier').inputValue(), 'Kennards Hire');
    assert.equal(await sheet().locator('.fc-field input[type="date"]').inputValue(), '2026-10-14');
    await tap(sheet().getByRole('button', { name: 'All correct' }));
    await tap(sheet().locator('.room-tile', { hasText: 'Deck' }));
    // "Delivery" could be anything, so it gets a card.
    await sheet().getByText('Not sure about one item').waitFor();
    assert.equal(await sheet().locator('.fc-item-desc').inputValue(), 'Delivery');
    await shot('card-item');
    await tap(sheet().locator('.flash-card .chip', { hasText: 'Equipment hire' }));
    await sheet().getByText('All set?').waitFor();
    assert.equal(await sheet().locator('.sum-row').count(), 3);
    await tap(sheet().getByRole('button', { name: 'Save expense' }));
    await expectToast('Expense saved');
    await page.getByText('All sorted').waitFor();
  });

  await check('the reader remembers your choices; Edit all opens the form', async () => {
    await choose(async () => tap(await addMenu('Snap a receipt')), join(FIXTURES, 'kennards-photo.jpg'));
    await sheet().locator('.flash-card').waitFor({ timeout: 90000 });
    assert.equal(await sheet().locator('.dots span').count(), 3); // details, room, summary: no item cards now
    // Swipe right to confirm a card.
    const card = await sheet().locator('.flash-card').boundingBox();
    const y = card.y + 60;
    await page.mouse.move(card.x + 60, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(card.x + 60 + i * 16, y);
    await page.mouse.up();
    await sheet().getByText('Where’s this for?').waitFor();
    await tap(sheet().locator('.room-tile', { hasText: 'Deck' }));
    await sheet().getByText('All set?').waitFor();
    await tap(sheet().getByRole('button', { name: 'Save expense' }));
    await page.getByText('Looks like one you’ve already logged').waitFor();
    await tap(page.locator('.action-cancel'));
    await page.waitForTimeout(400);
    await tap(sheet().getByRole('button', { name: 'Edit all', exact: true }));
    await page.getByText('New expense').waitFor();
    await sheet().locator('.split-desc').nth(2).waitFor();
    assert.equal(await sheet().locator('.split-desc').count(), 3);
    assert.equal(await sheet().locator('.split-desc').nth(2).inputValue(), 'Delivery');
    await shot('edit-all-form');
    await tap(sheet().getByRole('button', { name: 'Cancel' }));
    await page.waitForTimeout(400);
  });

  await check('online order PDF is read exactly', async () => {
    await choose(async () => tap(await addMenu('Upload PDF or screenshot')), join(FIXTURES, 'online-order.pdf'));
    await sheet().locator('.flash-card').waitFor({ timeout: 30000 });
    assert.equal(await sheet().getByPlaceholder('Store or supplier').inputValue(), 'Amazon');
    assert.equal(await sheet().locator('.fc-field.total input').inputValue(), '151.95');
    assert.equal(await sheet().locator('.fc-field input[type="date"]').inputValue(), '2026-10-21');
    await tap(sheet().getByRole('button', { name: 'All correct' }));
    await tap(sheet().locator('.room-tile', { hasText: 'General' }));
    await finishCards();
    assert.equal(await sheet().locator('.sum-row').count(), 2);
    await sheet().getByText('Items add up to the total').waitFor();
    await tap(sheet().getByRole('button', { name: 'Save expense' }));
    await expectToast('Expense saved');
    await tap(page.locator('.tab', { hasText: 'Home' }));
    await page.locator('.tile', { hasText: 'Tools' }).locator('strong', { hasText: '$211' }).waitFor(); // drill $59 + laser $119 + tape $32.95
    await shot('dashboard-reader');
  });

  assert.deepEqual(errors, [], `Browser errors:\n${errors.join('\n')}`);
  console.log('\nAll browser checks passed.');
} finally {
  await browser.close();
  server.close();
  const { rmSync } = await import('node:fs');
  rmSync(join(FIXTURES, '..', '.tmp-backup.zip'), { force: true });
}
