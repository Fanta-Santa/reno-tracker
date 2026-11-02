// Checks that receipt text is understood: store, date, total, GST, items and categories.
// The receipts below are real outputs of the on-device reader for test photos (tilted, shadowed, faded),
// including its typical slips. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, findAmounts, normaliseLine, tidyDescription, shortName } from '../js/reader/parse.js';
import { suggestCategory, itemKey, scoreKinds, breakdownFromItems } from '../js/reader/categorize.js';
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

// What the reader made of tests/fixtures/mitre-docket.jpg: each item's name on one line, with its stock code,
// quantity and price on the line under it.
const MITRE_DOCKET = [
  [95, 'MITRE 10'],
  [95, 'Strathpine Mitre 10 Mega'],
  [91, 'ABN 12 345 678 991'],
  [95, 'TAX INVOICE'],
  [57, 'Date 03/10/2026 09:15  T4113'],
  [91, 'Docket 0048213 Staff KT'],
  [88, 'DULUX WASHSWEAR Low SHEEN VIVID WHITE 4L'],
  [87, '1234567 1 EA @ 89.00         89.00'],
  [93, 'UNI-PRO ROLLER KIT 230MM 5PC'],
  [93, '2045531   1 EA @ 24.50         24.50'],
  [93, 'HOLMAN DWV PVC BEND 90MM 88DEG'],
  [86, '3301872 2 EA @ 8.95          17.90'],
  [93, 'SELLEYS NO MORE GAPS WHITE 4506'],
  [88, '1187704 1 EA @ 6.98'],
  [96, 'SUBTOTAL                       138.38'],
  [95, 'TOTAL                          138.38'],
  [95, 'GST INCLUDED                    12.58'],
  [93, 'EFTPOS                         138.38'],
  [95, 'Thank you for shopping at Mitre 10'],
].map(([confidence, text]) => ({ text, confidence }));

test('Mitre 10 docket: the name comes from the line above the code, quantity and price', () => {
  const r = parseReceipt(MITRE_DOCKET, { today: TODAY });
  assert.equal(r.store.value, 'Mitre 10');
  assert.equal(r.total.cents, 13838);
  assert.equal(r.gst.cents, 1258);
  assert.deepEqual(r.items.map((i) => [i.description, i.amountCents, i.qty]), [
    ['Dulux Washswear Low Sheen', 8900, 1],
    ['Uni-Pro Roller Kit 230MM 5PC', 2450, 1], // one word over: kept, rather than left dangling
    ['Holman DWV PVC Bend', 1790, 2], // 2 EA @ 8.95
    ['Selleys No More Gaps', 698, 1], // the line total was too faint to read: 1 × 6.98
  ]);
  assert.equal(r.items[0].details, 'Dulux Washswear Low Sheen Vivid White 4L'); // the whole line, for the category
  assert.equal(r.itemsMatchTotal, true);
  assert.deepEqual(r.unmatched, []); // the docket number is part of the header
});

test('an item name over two lines: named from the longer one, and both are kept together', () => {
  const r = parseReceipt(lines(`
MITRE 10
Tax Invoice
DULUX WASH&WEAR LOW SHEEN VIVID
WHITE 4L
 1234567   1 EA @ 89.00   89.00
SELLEYS NO MORE GAPS
450G WHITE
 1187704   2 EA @ 6.98    13.96
TOTAL   102.96`), { today: TODAY });
  assert.deepEqual(r.items.map((i) => [i.description, i.details, i.amountCents, i.qty]), [
    ['Dulux Wash&Wear Low Sheen Vivid', 'Dulux Wash&Wear Low Sheen Vivid White 4L', 8900, 1],
    ['Selleys No More Gaps', 'Selleys No More Gaps 450G White', 1396, 2],
  ]);
  assert.deepEqual(r.unmatched, []);
});

test('a code and quantity line never becomes the item, whatever the layout', () => {
  // Everything on one line, with the stock code first and a tax flag after the price
  const one = parseReceipt(lines(`MITRE 10
2045531  UNI-PRO ROLLER KIT 230MM 5PC     1  EA     24.50   24.50   G
TOTAL 24.50`), { today: TODAY });
  assert.deepEqual(one.items.map((i) => [i.description, i.amountCents]), [['Uni-Pro Roller Kit 230MM 5PC', 2450]]);
  // "QTY 2" and "SKU" on the price line
  const sku = parseReceipt(lines(`Hardware Store
Tax Invoice
CONCRETE MIX 20KG BAG
SKU 330187  QTY 2 x 9.50   19.00
TOTAL 19.00`), { today: TODAY });
  assert.deepEqual(sku.items.map((i) => [i.description, i.amountCents]), [['Concrete Mix 20KG Bag', 1900]]);
  // Near the top, a name can't be told apart from the shop's name above it, so only the line above the price is used
  const top = parseReceipt(lines(`MITRE 10
DULUX WASH&WEAR 4L
1234567 1 EA @ 89.00   89.00
TOTAL 89.00`), { today: TODAY });
  assert.deepEqual(top.items.map((i) => i.description), ['Dulux Wash&Wear 4L']);
});

test('item names: tidy capitals, and the first four words of a long name', () => {
  assert.equal(tidyDescription('HOLMAN DWV PVC BEND 90MM'), 'Holman DWV PVC Bend 90MM');
  assert.equal(tidyDescription('DULUX WASHSWEAR Low SHEEN'), 'Dulux Washswear Low Sheen');
  assert.equal(tidyDescription('UNI-PRO W&W NO MORE GAPS'), 'Uni-Pro W&W No More Gaps');
  assert.equal(tidyDescription('Floor sander drum 1 day'), 'Floor sander drum 1 day'); // not in capitals: left alone
  assert.equal(shortName('DULUX WASH&WEAR LOW SHEEN VIVID WHITE 4L'), 'Dulux Wash&Wear Low Sheen');
  assert.equal(shortName('OZITO 18V DRILL DRIVER SKIN ONLY'), 'Ozito 18V Drill Driver Skin Only'); // one more word: kept
  assert.equal(shortName('BUILDEX SCREW BATTEN 14G X 75 50PK'), 'Buildex Screw Batten 14G x 75 50PK'); // sizes don't count
  assert.equal(shortName('Labour - install vanity and tapware 8 hrs'), 'Labour - install vanity');
  assert.equal(shortName('Paint brush set with tray and roller'), 'Paint brush set'); // no dangling "with"
});

test('a shortened name still gets its category from the whole line', () => {
  const r = parseReceipt(lines(`Hardware Store
Tax Invoice
OZITO PXC 18V CORDLESS BRUSHLESS HAMMER DRILL KIT   249.00
TOTAL 249.00`), { today: TODAY });
  const [item] = r.items;
  assert.equal(item.description, 'Ozito PXC 18V Cordless Brushless');
  const s = suggestCategory(item.description, { categories: CATS, details: item.details });
  assert.equal(CATS.find((c) => c.id === s.categoryId).name, 'Tools'); // "drill" is only in the full line
  assert.equal(s.isTool, true);
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
  assert.equal(normaliseLine('Glue  $14.9S'), 'Glue  $14.95');
  assert.equal(normaliseLine('Timber   44.B0'), 'Timber   44.80');
  assert.equal(normaliseLine('PINE 2.4M'), 'PINE 2.4M'); // a length, not a price
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

test('a quote covering labour, hire and freight is split by category', () => {
  const categories = [...CATS, { id: 'f', name: 'Freight' }];
  const item = (description, amountCents) => ({ description, amountCents });
  // Priced without GST; the quote's total includes it.
  const items = [item('Labour - install vanity and tapware 8 hrs', 300000), item('Equipment hire - core drill 1 day', 90000),
    item('Freight', 10000)];
  assert.deepEqual(breakdownFromItems(items, 440000, { categories }), [
    { categoryId: id('Trades / labour'), amountCents: 330000 },
    { categoryId: id('Equipment hire'), amountCents: 99000 },
    { categoryId: 'f', amountCents: 11000 },
  ]);
  // Unsure lines go in with the biggest; all one category, or lines that don't add up, give nothing.
  const withUnsure = [...items.slice(0, 2), item('Sundries', 10000)];
  assert.equal(breakdownFromItems(withUnsure, 400000, { categories })[0].amountCents, 310000);
  assert.equal(breakdownFromItems([item('Labour 4 hrs', 40000), item('Labour call out fee', 10000)], 50000, { categories }), null);
  assert.equal(breakdownFromItems(items, 999900, { categories }), null);
  // Without a freight category, "Freight" is just unsure.
  assert.equal(breakdownFromItems(items, 440000, { categories: CATS }).length, 2);
});

test('renamed categories still match by name', () => {
  const categories = [{ id: 'x', name: 'Power tools' }, { id: 'y', name: 'Timber & sheet materials' }];
  assert.equal(suggestCategory('Ryobi 18V drill', { categories }).categoryId, 'x');
  assert.equal(suggestCategory('Treated pine sleeper', { categories }).categoryId, 'y');
  assert.equal(scoreKinds('Treated pine sleeper')[0].kind, 'materials');
});

test('lines that did not become items are listed, so you can match them up', () => {
  const r = parseReceipt(lines(`
BUNNINGS WAREHOUSE
ABN 26 008 672 179
TAX INVOICE
27/10/2026 14:02
SCREW BATTEN 14G X 75 50PK      $18.98
GORILLA GLUE 115ML              $14.9S
HANDLE GRIP PK2                 $ ..
PINE MGP10 90X45 2.4M
4 @ $11.2O    $44.B0
$7.20
9312345000017
TOTAL                          $92.43
EFTPOS                         $92.43`), { today: TODAY });
  // Misread prices are rescued: "$14.9S" is $14.95, and 4 @ $11.20 is $44.80.
  assert.deepEqual(r.items.map((i) => [i.description, i.amountCents]), [
    ['Screw Batten 14G x 75 50PK', 1898],
    ['Gorilla Glue 115ML', 1495],
    ['Pine MGP10 90X45 2.4M', 4480],
  ]);
  // An item with no readable price, and a price with no item, are listed as they appear on the receipt.
  assert.deepEqual(r.unmatched.map((u) => [u.label, u.amountCents, u.text]), [
    ['Handle Grip PK2', null, 'HANDLE GRIP PK2   $ ..'],
    ['', 720, '$7.20'],
  ]);
  // Header lines (store, ABN, date) and barcodes aren't listed.
  assert.ok(!r.unmatched.some((u) => /abn|bunnings|tax invoice|9312345/i.test(u.text)));
});

test('nothing is listed as unmatched when every line became an item', () => {
  assert.deepEqual(parseReceipt(BUNNINGS, { today: TODAY }).unmatched, []);
  assert.deepEqual(parseReceipt(KENNARDS, { today: TODAY }).unmatched, []);
});
