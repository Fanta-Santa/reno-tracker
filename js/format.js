// Money and date helpers. Pure functions only (no DOM), so they can be unit tested in Node.
//
// Money is always stored as whole cents (integers) so totals never drift.
// Dates are stored as 'YYYY-MM-DD' strings in the phone's local time and shown as dd/mm/yyyy.

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const audWhole = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "$1,234.50". Pass { whole: true } to drop the cents for big dashboard numbers. */
export function formatMoney(cents, { whole = false } = {}) {
  if (cents == null || Number.isNaN(cents)) return '';
  return (whole ? audWhole : aud).format(cents / 100);
}

/**
 * Turns what someone typed ("12", "$1,234.5", ".50", "-20") into cents.
 * Returns null when it isn't a usable amount.
 */
export function parseMoney(input) {
  if (input == null) return null;
  const s = String(input).replace(/[\s$,]/g, '');
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  if (frac.length > 2) return null;
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** Cents back to an editable string: 1250 -> "12.50". */
export function centsToInput(cents) {
  if (cents == null) return '';
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** GST included in a GST-inclusive total. At 10% that is total / 11. */
export function gstFromTotal(totalCents, rate = 0.1) {
  if (totalCents == null) return 0;
  return Math.round((totalCents * rate) / (1 + rate));
}

/** GST for an expense, honouring its mode: 'auto' (included), 'none' (GST-free) or 'custom'. */
export function expenseGst(expense, rate = 0.1) {
  if (expense.gstMode === 'none') return 0;
  if (expense.gstMode === 'custom') return expense.gstCents ?? 0;
  return gstFromTotal(expense.totalCents, rate);
}

/** Splits a total into n parts that add up exactly, spreading leftover cents over the first parts. */
export function splitEvenly(totalCents, n) {
  if (n <= 0) return [];
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const base = Math.floor(abs / n);
  const extra = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < extra ? 1 : 0)));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Today's date on this phone as 'YYYY-MM-DD'. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 'YYYY-MM-DD' -> 'dd/mm/yyyy'. */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** 'YYYY-MM-DD' -> 'October 2026'. */
export function monthLabel(iso) {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** 'YYYY-MM-DD' -> '27 Oct'. Short form for lists. */
export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1].slice(0, 3)}`;
}

/** Whole days between two 'YYYY-MM-DD' dates (b - a). */
export function daysBetween(a, b) {
  const toUTC = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** Adds days to a 'YYYY-MM-DD' date. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** File-size label: 1536 -> "1.5 KB". */
export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** A timestamp in ms -> 'dd/mm/yyyy' in local time. */
export function formatTimestamp(ms) {
  if (!ms) return '';
  return formatDate(todayISO(new Date(ms)));
}
