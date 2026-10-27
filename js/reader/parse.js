// Makes sense of a receipt's text: store, date, total, GST and the line items.
// Pure functions (no DOM), so they can be unit tested in Node.
//
// Each finding comes with a confidence: 'high', 'medium' or 'low'. The review cards
// only ask about what isn't 'high'.

// Shops common on Australian reno receipts. Your own store list is checked too.
export const KNOWN_STORES = [
  'Bunnings', 'Mitre 10', 'Total Tools', 'Home Hardware', 'Sydney Tools', 'Tool Kit Depot', 'Trade Tools',
  'Bretts', 'Reece', 'Tradelink', 'Beaumont Tiles', 'Kennards Hire', 'Coates', 'IKEA', 'Officeworks', 'Kmart',
  'Big W', 'Target', 'Harvey Norman', 'The Good Guys', 'JB Hi-Fi', 'Bing Lee', 'Amazon', 'eBay', 'Temu',
  'Dulux', 'Taubmans', 'Haymes', 'Inspirations Paint', 'Bowens', 'Carbatec', 'Supercheap Auto', 'Repco',
  'Clark Rubber', 'Spotlight', 'Laminex', 'Carpet Court', 'Tile Mart', 'Masters', 'Stratco', 'Steeline',
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ---------- Text clean-up ----------

/** Fixes common OCR slips inside numbers: O→0, l/I→1, S→$ before digits, "12,50"→"12.50". */
export function normaliseLine(raw) {
  let t = raw.replace(/[|¦]/g, ' ').replace(/—|–/g, '-');
  t = t.replace(/(?<=\d)[oO](?=[\d.,])|(?<=[\d.,])[oO](?=\d)/g, '0');
  t = t.replace(/(?<=\d)[lI](?=[\d.,])|(?<=[\d.,])[lI](?=\d)/g, '1');
  t = t.replace(/(\d[.,])([\doO]{2})\b/g, (m, a, b) => a + b.replace(/[oO]/g, '0')); // cents like .5O
  t = t.replace(/(^|\s)[S5](?=\d{1,4}[.,]\d{2}\b)/g, '$1$'); // "S84.50" → "$84.50"
  t = t.replace(/(\d)\s?,\s?(\d{2})(?!\d)/g, '$1.$2'); // decimal comma
  t = t.replace(/(\d)\s\.\s?(\d{2})\b/g, '$1.$2'); // "84 .50"
  return t.replace(/\s+$/, '');
}

const AMOUNT_RE = /(-\s?)?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)(\s?-)?/g;

/** Money amounts in a line, in cents, with where they sit. */
export function findAmounts(text) {
  const out = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    // Skip things like "2.4M" or "1.20m" (lengths), and dates such as 27.10.2026.
    const end = m.index + m[0].length;
    const after = text.slice(end, end + 2);
    if (/^[a-z]/i.test(after) && !m[0].includes('$')) continue; // a length like "1.20m"
    if (/^[./%]/.test(after)) continue; // a date like 27.10.2026, or a percentage
    if (/[\d][./]$/.test(text.slice(Math.max(0, m.index - 2), m.index))) continue;
    const cents = Number(m[2].replace(/,/g, '')) * 100 + Number(m[3]);
    const negative = !!(m[1] || m[4]);
    out.push({ cents: negative ? -cents : cents, index: m.index, length: m[0].length });
  }
  return out;
}

const KIND_PATTERNS = [
  ['subtotal', /\bsub\s?-?\s?total\b/i],
  ['change', /\bchange\b|\brounding\b|\bround(ed)?\b/i],
  ['payment', /\b(eftpos|visa|master\s?card|mastercard|amex|american express|debit|credit|card|cash|tendered|tender|paid|payment|apple pay|google pay|paypal|afterpay|zip\s?pay|gift card|account|on account|savings? acc)\b/i],
  ['gst', /\bgst\b|\btax\b(?!\s*invoice)/i],
  ['total', /\b(total|amount due|balance due|to pay|amount payable|grand total)\b/i],
  ['discount', /\b(discount|saving|savings|promo|voucher|coupon|member price|less)\b/i],
  // Lines with numbers on them that aren't things you bought.
  ['noise', /\b(abn|acn|tax invoice|invoice no|receipt no|phone|ph|tel|fax|www|thank|thanks|reg|trans|terminal|auth|approved|merchant|ref|order no|cashier|operator|served by|docket|items sold|item count|no of items|pty|ltd)\b|\.com\b/i],
];

function kindOf(label) {
  if (/\btotal\b/i.test(label) && /\b(saving|savings|discount|items?|qty|units?)\b/i.test(label)) return 'noise';
  for (const [kind, re] of KIND_PATTERNS) if (re.test(label)) return kind;
  return null;
}

/** Splits a line into its words and its money, and works out what kind of line it is. */
function analyse(raw, confidence) {
  const text = normaliseLine(raw);
  const amounts = findAmounts(text);
  let label = text;
  for (const a of [...amounts].reverse()) label = label.slice(0, a.index) + ' ' + label.slice(a.index + a.length);
  let qty = null;
  const q = label.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*(?:@|x|×|ea\b|each\b)\s*$/i) || label.match(/^\s*(?:qty:?\s*)?(\d{1,3})\s*(?:@|x|×)\s*/i);
  if (q) {
    qty = Number(q[1]);
    label = label.replace(q[0], ' ');
  }
  const code = label.match(/\b\d{8,14}\b/);
  if (code) label = label.replace(code[0], ' ');
  label = label.replace(/[\s:*#=~_.-]+$/, '').replace(/^[\s:*#=~_.-]+/, '').replace(/\s{2,}/g, ' ').trim();
  const letters = (label.match(/[a-z]/gi) || []).length;
  return {
    raw,
    text,
    label: letters >= 2 ? label : '',
    amount: amounts.length ? amounts[amounts.length - 1].cents : null,
    unitAmount: amounts.length > 1 ? amounts[0].cents : null,
    qty,
    confidence: confidence ?? 90,
    kind: letters >= 2 ? kindOf(label) : null,
  };
}

/**
 * Receipts often print an item's price on its own line (or OCR splits it off), and
 * sometimes a label like "EFTPOS" lands just after its amount. This joins them back up.
 */
function joinOrphans(lines) {
  const out = [];
  const used = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    if (line.amount != null && !line.label) {
      const prev = out[out.length - 1];
      const next = lines[i + 1];
      const prevFree = prev && prev.amount == null && prev.label && prev.kind !== 'noise';
      const nextIsKeyword = next && next.amount == null && next.label && ['payment', 'change', 'total', 'gst', 'subtotal'].includes(next.kind);
      if (nextIsKeyword && !(prevFree && !prev.kind)) {
        out.push({ ...next, amount: line.amount, unitAmount: line.unitAmount, qty: line.qty ?? next.qty, confidence: Math.min(line.confidence, next.confidence) });
        used.add(i + 1);
        continue;
      }
      if (prevFree) {
        out[out.length - 1] = { ...prev, amount: line.amount, unitAmount: line.unitAmount ?? prev.unitAmount, qty: line.qty ?? prev.qty, confidence: Math.min(line.confidence, prev.confidence) };
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

// ---------- Store ----------

function simplify(s) {
  return s.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's').replace(/[^a-z0-9]+/g, ' ').trim();
}

function editDistance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Is `name` in `line`, allowing for a misread letter or two? Returns 0 (exact), 1 (close) or null. */
function storeMatch(line, name) {
  const l = ` ${simplify(line)} `;
  const n = simplify(name);
  if (!n) return null;
  if (l.includes(` ${n} `) || l.replace(/ /g, '').includes(n.replace(/ /g, ''))) return 0;
  const allowed = n.length >= 8 ? 2 : n.length >= 5 ? 1 : 0;
  if (!allowed) return null;
  const words = l.trim().split(' ');
  const size = n.split(' ').length;
  for (let i = 0; i + size <= words.length; i++) {
    if (editDistance(words.slice(i, i + size).join(' '), n) <= allowed) return 1;
  }
  return null;
}

/** "JOE'S TIMBER YARD" -> "Joe's Timber Yard"; text that isn't all capitals is left alone. */
function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])[a-z]/g, (c) => c.toUpperCase());
}

function findStore(lines, knownStores) {
  // Longer names first, so "Mitre 10 Mega" beats "Mitre 10".
  const names = [...new Set(knownStores)].sort((a, b) => b.length - a.length);
  let best = null;
  lines.forEach((line, i) => {
    const header = i < 8;
    for (const name of names) {
      const m = storeMatch(line.text, name);
      if (m == null) continue;
      const score = (m === 0 ? 2 : 1) + (header ? 1 : 0);
      if (!best || score > best.score) best = { value: name, score };
      break;
    }
  });
  if (best) return { value: best.value, confidence: best.score >= 3 ? 'high' : 'medium' };

  // Otherwise: the first header line that looks like a name.
  for (const line of lines.slice(0, 6)) {
    const words = line.text.replace(/[^a-z0-9&' -]/gi, ' ').trim();
    if ((words.match(/[a-z]/gi) || []).length < 3) continue;
    if (/\b(tax invoice|invoice|receipt|abn|welcome|date|time)\b/i.test(words)) continue;
    if (/\d{3,}/.test(words)) continue;
    return { value: titleCase(words.replace(/\s+/g, ' ')).slice(0, 40), confidence: 'low' };
  }
  return { value: '', confidence: 'low' };
}

// ---------- Date ----------

function validDate(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function datesIn(text) {
  const found = [];
  const t = text.toLowerCase();
  for (const m of t.matchAll(/\b(\d{1,2})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?(\d{4}|\d{2})\b/g)) {
    // Australian receipts are day/month/year.
    const iso = validDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (iso) found.push({ iso });
  }
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const iso = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) found.push({ iso });
  }
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4}|\d{2})\b/g)) {
    const mi = MONTHS.indexOf(m[2]);
    const iso = mi >= 0 && validDate(Number(m[3]), mi + 1, Number(m[1]));
    if (iso) found.push({ iso });
  }
  for (const m of t.matchAll(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[1]);
    const iso = mi >= 0 && validDate(Number(m[3]), mi + 1, Number(m[2]));
    if (iso) found.push({ iso });
  }
  return found;
}

function daysApart(a, b) {
  const t = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.abs(t(b) - t(a)) / 86400000;
}

function findDate(lines, today) {
  const candidates = [];
  lines.forEach((line, i) => {
    for (const d of datesIn(line.text)) {
      if (today && d.iso > today) continue; // receipts aren't from the future
      candidates.push({ ...d, labelled: /\b(date|dated|issued|purchased|hire date|order date)\b/i.test(line.text), index: i });
    }
  });
  if (!candidates.length) return { value: today || null, confidence: 'low', found: false };
  const pick = candidates.find((c) => c.labelled) || candidates[0];
  const distinct = new Set(candidates.map((c) => c.iso)).size;
  // A date months ago might be a misread (or a month/day mix-up), so it's worth a second look.
  const old = today && daysApart(pick.iso, today) > 120;
  const confidence = (pick.labelled || distinct === 1) && !old ? 'high' : 'medium';
  return { value: pick.iso, confidence, found: true };
}

// ---------- Description tidy-up ----------

/** "BUILDEX SCREW BATTEN 14G X 75 50PK" → "Buildex Screw Batten 14G x 75 50PK" */
export function tidyDescription(label) {
  let s = label.replace(/\s{2,}/g, ' ').trim().replace(/\b0(?=[A-Za-z]{2})/g, 'O'); // "0ZITO" → "OZITO"
  const letters = s.replace(/[^a-z]/gi, '');
  if (letters && letters === letters.toUpperCase()) {
    s = s.split(' ').map((w) => (/\d/.test(w) ? w : w.length <= 2 && w !== 'X' ? w : w === 'X' ? 'x' : w[0] + w.slice(1).toLowerCase())).join(' ');
  }
  return s.replace(/^[^a-z0-9]+/i, '').slice(0, 80);
}

// ---------- Putting it together ----------

/**
 * lines: [{ text, confidence }] from the reader.
 * options.knownStores: extra store names (yours). options.today: 'YYYY-MM-DD'.
 * Returns { store, date, total, gst, items, itemsMatchTotal, text }.
 */
export function parseReceipt(rawLines, { knownStores = [], today = null } = {}) {
  const analysed = rawLines.map((l) => analyse(l.text, l.confidence)).filter((l) => l.text.trim());
  const lines = joinOrphans(analysed);
  const store = findStore(analysed, [...knownStores, ...KNOWN_STORES]);
  const date = findDate(analysed, today);

  // Total: the biggest amount on a line that says "total" (but not subtotal/savings).
  const totalLines = lines.filter((l) => l.kind === 'total' && l.amount > 0)
    .concat(lines.filter((l) => l.kind === 'gst' && /\btotal\b/i.test(l.label) && l.amount > 0));
  const payments = lines.filter((l) => l.kind === 'payment' && l.amount > 0);
  let totalCents = null;
  let totalSource = null;
  if (totalLines.length) {
    totalCents = Math.max(...totalLines.map((l) => l.amount));
    totalSource = 'label';
  } else if (payments.length) {
    totalCents = Math.max(...payments.map((p) => p.amount));
    totalSource = 'payment';
  } else {
    const all = lines.filter((l) => l.amount > 0 && l.kind !== 'gst').map((l) => l.amount);
    if (all.length) {
      totalCents = Math.max(...all);
      totalSource = 'largest';
    }
  }

  // GST: a GST/tax line whose amount is about 1/11 of the total.
  let gstCents = null;
  if (totalCents) {
    const expected = Math.round(totalCents / 11);
    const gstLines = lines.filter((l) => (l.kind === 'gst' || /\bgst\b/i.test(l.label)) && l.amount > 0 && l.amount !== totalCents);
    if (gstLines.length) {
      gstCents = gstLines.map((l) => l.amount).sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))[0];
    }
  }

  // Items: lines with a price, above the totals, that aren't payments, GST and so on.
  const firstTotalIndex = lines.findIndex((l) => ['subtotal', 'total', 'gst', 'payment'].includes(l.kind) && l.amount != null);
  const end = firstTotalIndex >= 0 ? firstTotalIndex : lines.length;
  const items = [];
  for (const l of lines.slice(0, end)) {
    if (!l.amount || !l.label) continue; // no price, or a $0.00 line such as free delivery
    if (['noise', 'change', 'payment', 'gst', 'total', 'subtotal'].includes(l.kind)) continue;
    if (datesIn(l.text).length) continue;
    if (totalCents && l.amount === totalCents && items.length) continue;
    const description = tidyDescription(l.label);
    if (!description) continue;
    items.push({
      description,
      amountCents: l.amount,
      qty: l.qty,
      ocrConfidence: l.confidence,
      isDiscount: l.kind === 'discount' || l.amount < 0,
    });
  }

  const itemsSum = items.reduce((s, it) => s + it.amountCents, 0);
  const itemsMatchTotal = !!(items.length && totalCents != null && Math.abs(itemsSum - totalCents) <= 2);
  const gstMatches = gstCents != null && totalCents != null && Math.abs(gstCents - Math.round(totalCents / 11)) <= 2;
  const paymentMatches = payments.some((p) => p.amount === totalCents);

  let totalConfidence = 'low';
  if (totalCents != null) {
    const support = [gstMatches, paymentMatches, itemsMatchTotal].filter(Boolean).length;
    if (totalSource === 'label') totalConfidence = support >= 1 ? 'high' : 'medium';
    else if (totalSource === 'payment') totalConfidence = support >= 1 ? 'medium' : 'low';
  }

  return {
    store,
    date,
    total: { cents: totalCents, confidence: totalConfidence },
    gst: { cents: gstCents, matches: gstMatches },
    items,
    itemsSum,
    itemsMatchTotal,
    text: rawLines.map((l) => l.text).join('\n'),
  };
}
