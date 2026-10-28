// Checks that receipt text is understood: store, date, total, GST, items and categories.
// The receipts below are real outputs of the on-device reader for test photos (tilted, shadowed, faded),
// including its typical slips. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, findAmounts, normaliseLine, tidyDescription } from '../js/reader/parse.js';
import { suggestCategory, itemKey, scoreKinds } from '../js/reader/categorize.js';
import { DEFAULT_CATEGORIES } from '../js/defaults.js';

const lines = (text, confidence = 92) => text.trim().split('\n').map((t) => ({ text: t.replace(/^\s*\d+ \| /, ''), confidence }));
const TODAY = '2026-11-20';

const BUNNINGS = lines(`
BUNNINGS WAREHOUSE
Bunnings Group Limited
ABN 26 008 672 179
BRENDALE QLD 4500
TAX INVOICE
| 27/10/2026 14:02 Reg 12 Trans 4821
BUILDEX SCREW BATTEN 14G X 75 50PK
9310067123458          $18.98
PINE MGP10 90X45 2.4M
4 @ $11.20            $44.80
0ZITO 18V DRILL DRIVER SKIN ONLY
9312345000017          $59.00
SANDPAPER 120 GRIT 5PK          $6.48
GORILLA GLUE 115ML              $14.95
TOTAL                          $144.21
GST INCLUDED IN TOTAL          $13.11
$144.21
EFTPOS
$0.00
CHANGE
Thank you for shopping at Bunnings`);

const MITRE = lines(`
MITRE 10
Brendale Mitre 10 Mega
ABN 12 345 673 901
Tax Invoice
Date: 03/11/2026   Time: 09:15
Dulux Wash&Wear 41 White
89.00
Roller Kit 230mm              24.50
Drop Sheet Plastic 3x4m        6.20
Masking Tape 36mm x2          11.80
Member discount              -5.00
SUBTOTAL                     126.50
GST                            11.50
TOTAL                         126.50
Visa
126.50`);

const KENNARDS = lines(`
Kennards Hire
Kennards Hire Pty Ltd ABN 33 000 000 000
Tax Invoice 778201
Hire date 14 Nov 2026
Floor sander drum 1 day      $95.00
Sanding belts x6             $42.00
Delivery                     $30.00
Total (inc GST)             $167.00
GST                          $15.18`);

test('Bunnings receipt: store, date, total, GST and every item', () => {
  const r = parseReceipt(BUNNINGS, { today: TODAY });
  assert.deepEqual(r.store, { value: 'Bunnings', confidence: 'high' });
  assert.equal(r.date.value, '2026-10-27');
  assert.equal(r.date.confidence, 'high');
  assert.deepEqual(r.total, { cents: 14421, confidence: 'high' });
  assert.equal(r.gst.cents, 1311);
  assert.deepEqual(r.items.map((i) => [i.description, i.amountCents]), [
    ['Buildex Screw Batten 14G x 75 50PK', 1898],
    ['Pine MGP10 90X45 2.4M', 4480],
    ['Ozito 18V Drill Driver Skin Only', 5900],
    ['Sandpaper 120 Grit 5PK', 648],
    ['Gorilla Glue 115ML', 1495],
  ]);
  assert.equal(r.items[1].qty, 4);
  assert.equal(r.itemsMatchTotal, true);
});

test('Mitre 10 receipt: price on its own line, discount, payment after its label', () => {
  const r = parseReceipt(MITRE, { today: TODAY });
  assert.equal(r.store.value, 'Mitre 10');
  assert.equal(r.date.value, '2026-11-03');
  assert.equal(r.total.cents, 12650);
  assert.equal(r.total.confidence, 'high');
  assert.equal(r.gst.cents, 1150);
  assert.deepEqual(r.items.map((i) => i.amountCents), [8900, 2450, 620, 1180, -500]);
  assert.equal(r.items[0].description, 'Dulux Wash&Wear 41 White');
  assert.equal(r.items[4].isDiscount, true);
  assert.equal(r.itemsMatchTotal, true);
});

test('Kennards hire invoice: "Total (inc GST)" and a written-out date', () => {
  const r = parseReceipt(KENNARDS, { today: TODAY });
  assert.equal(r.store.value, 'Kennards Hire');
  assert.equal(r.date.value, '2026-11-14');
  assert.equal(r.total.cents, 16700);
  assert.equal(r.gst.cents, 1518);
  assert.equal(r.items.length, 3);
  assert.equal(r.itemsMatchTotal, true);
});

test('your own store names are recognised, longest match first', () => {
  const r = parseReceipt(lines('MITRE 10 MEGA BRENDALE\nScrews  5.00\nTOTAL 5.00'), { knownStores: ['Mitre 10 Mega'], today: TODAY });
  assert.equal(r.store.value, 'Mitre 10 Mega');
});

test('a misread store name still matches', () => {
  const r = parseReceipt(lines('BUNN1NGS WAREH0USE\nTOTAL $5.00'), { today: TODAY });
  assert.equal(r.store.value, 'Bunnings');
});

test('an unknown store falls back to the first name-like line, marked unsure', () => {
  const r = parseReceipt(lines("Joe's Timber Yard\n12 Smith St\nTax Invoice\nDecking 4.20\nTOTAL 4.20"), { today: TODAY });
  assert.equal(r.store.value, "Joe's Timber Yard");
  const caps = parseReceipt(lines("JOE'S TIMBER YARD\nTOTAL 4.20"), { today: TODAY });
  assert.equal(caps.store.value, "Joe's Timber Yard");
  assert.equal(r.store.confidence, 'low');
});

test('no total line: falls back to the card payment, then the largest amount', () => {
  assert.equal(parseReceipt(lines('Shop\nThing 12.00\nOther 3.00\nEFTPOS 15.00'), { today: TODAY }).total.cents, 1500);
  const r = parseReceipt(lines('Shop\nThing 12.00\nOther 3.00'), { today: TODAY });
  assert.equal(r.total.cents, 1200);
  assert.equal(r.total.confidence, 'low');
});

test('dates in all the usual Australian formats', () => {
  const d = (text) => parseReceipt(lines(`Shop\n${text}\nTOTAL 1.00`), { today: TODAY }).date.value;
  assert.equal(d('Date 05/11/2026'), '2026-11-05');
  assert.equal(d('05-11-26 10:30'), '2026-11-05');
  assert.equal(d('2026-11-05'), '2026-11-05');
  assert.equal(d('5 November 2026'), '2026-11-05');
  assert.equal(d('Nov 5, 2026'), '2026-11-05');
  assert.equal(d('31/02/2026'), TODAY); // not a real date
  assert.equal(d('05/11/2027'), TODAY); // in the future
});

test('amount detection ignores lengths, dates, percentages and barcodes', () => {
  assert.deepEqual(findAmounts('PINE 2.4M 1.20m $44.80').map((a) => a.cents), [4480]);
  assert.deepEqual(findAmounts('27.10.2026 GST 10.00% 9310067123458').map((a) => a.cents), []);
  assert.deepEqual(findAmounts('Member discount -5.00').map((a) => a.cents), [-500]);
  assert.deepEqual(findAmounts('Return 5.00-').map((a) => a.cents), [-500]);
  assert.deepEqual(findAmounts('$1,234.56').map((a) => a.cents), [123456]);
});

test('OCR slips in numbers are fixed', () => {
  assert.equal(normaliseLine('TOTAL S84.50'), 'TOTAL $84.50');
  assert.equal(normaliseLine('Screws 1O.5O'), 'Screws 10.50');
  assert.equal(normaliseLine('Timber 48,00'), 'Timber 48.00');
  assert.equal(tidyDescription('GORILLA GLUE 115ML'), 'Gorilla Glue 115ML');
});

// ---------- Categories ----------

const CATS = DEFAULT_CATEGORIES.map((c, i) => ({ id: `c${i}`, name: c.name, isTool: !!c.isTool }));
const id = (name) => CATS.find((c) => c.name === name).id;
const suggest = (desc, extra = {}) => suggestCategory(desc, { categories: CATS, ...extra });

test('items get sensible categories', () => {
  const cases = [
    ['Buildex Screw Batten 14G x 75 50PK', 'Hardware & fixings'],
    ['Pine MGP10 90X45 2.4M', 'Materials'],
    ['Ozito 18V Drill Driver Skin Only', 'Tools'],
    ['Sandpaper 120 Grit 5PK', 'Paint & finishes'],
    ['Gorilla Glue 115ML', 'Hardware & fixings'],
    ['Dulux Wash&Wear 41 White', 'Paint & finishes'],
    ['Drop Sheet Plastic 3x4m', 'Paint & finishes'],
    ['Floor sander drum 1 day', 'Equipment hire'],
    ['Skip bin 6m3 hire', 'Waste / disposal'],
    ['Tile adhesive 20kg', 'Materials'],
    ['Mixer tap chrome', 'Fixtures & fittings'],
    ['Electrician labour 3 hrs', 'Trades / labour'],
  ];
  for (const [desc, cat] of cases) {
    const s = suggest(desc, { storeName: desc.includes('sander') ? 'Kennards Hire' : '' });
    assert.equal(CATS.find((c) => c.id === s.categoryId)?.name, cat, desc);
  }
});

test('tools are flagged as tools', () => {
  const s = suggest('Makita 18V impact driver skin only');
  assert.equal(s.categoryId, id('Tools'));
  assert.equal(s.isTool, true);
  assert.equal(s.confidence, 'high');
});

test('unclear items are marked unsure so a card asks about them', () => {
  assert.equal(suggest('Delivery', { storeName: 'Kennards Hire' }).confidence, 'low');
  assert.equal(suggest('Misc item 123').confidence, 'low');
  assert.equal(suggest('Steel post 2.4m').confidence, 'medium');
});

test('what you chose before wins, with high confidence', () => {
  const learned = { [itemKey('Delivery charge')]: { categoryId: id('Other'), isTool: false } };
  const s = suggest('DELIVERY CHARGE', { learned });
  assert.equal(s.categoryId, id('Other'));
  assert.equal(s.confidence, 'high');
  assert.equal(itemKey('Buildex Screw Batten 14G x 75 50PK'), 'buildex screw batten');
});

test('renamed categories still match by name', () => {
  const categories = [{ id: 'x', name: 'Power tools' }, { id: 'y', name: 'Timber & sheet materials' }];
  assert.equal(suggestCategory('Ryobi 18V drill', { categories }).categoryId, 'x');
  assert.equal(suggestCategory('Treated pine sleeper', { categories }).categoryId, 'y');
  assert.equal(scoreKinds('Treated pine sleeper')[0].kind, 'materials');
});
