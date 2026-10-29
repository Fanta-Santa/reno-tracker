// Spreadsheet export: your expenses as an Excel workbook (Summary, Expenses, Items and Quotes tabs) or a CSV of
// every item, optionally zipped up with the receipt photos. No DOM here, so it can be tested in Node.
//
// The .xlsx is written by hand: a zip of a few small XML files (the Office Open XML format), with real dates and
// dollar amounts so sums, filters and pivot tables just work.

import { createZip } from './zip.js';
import { formatDate, splitByWeights } from './format.js';
import { budgetStatus, quoteParts, quoteProgress } from './stats.js';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Australia's financial year (1 July to 30 June) that `iso` falls in; offset -1 for the one before. */
export function financialYear(iso, offset = 0) {
  const [y, m] = iso.split('-').map(Number);
  const start = (m >= 7 ? y : y - 1) + offset;
  return { from: `${start}-07-01`, to: `${start + 1}-06-30`, label: `${start}–${String(start + 1).slice(2)}` };
}

export const fileExtension = (type) => (type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg');

/** A safe, readable file name part: "Pete's Plumbing / Gas" → "Pete's Plumbing - Gas". */
export const cleanName = (text) => (text || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);

// ---------- What goes in ----------

const STATUS_WORDS = { ok: '✓ On track', near: '! Nearly at budget', over: '‼ Over budget', none: '' };
const QUOTE_STATUS = { quoted: 'Quoted', accepted: 'Accepted', paid: 'Paid', declined: 'Declined' };
const money = (cents) => (cents == null ? null : { m: cents });
const date = (iso) => (iso ? { d: iso } : null);

/**
 * Puts the expenses in order (oldest first) and gives each a reference (R001, R002…) used in every tab and in the
 * receipt photos' file names. items: [{ expense, lines }], where lines are the ones to include: all of an expense's
 * lines, or just the ones a filter matched.
 */
export function numberItems(items) {
  return items
    .slice()
    .sort((a, b) => a.expense.date.localeCompare(b.expense.date) || (a.expense.createdAt ?? 0) - (b.expense.createdAt ?? 0))
    .map((it, i) => ({ ...it, ref: `R${String(i + 1).padStart(3, '0')}` }));
}

/** Each line's share of its receipt's GST (in proportion, adding up exactly). */
function lineGst(expense) {
  const shares = splitByWeights(expense.gstCents ?? 0, expense.lines.map((l) => Math.abs(l.amountCents)));
  return new Map(expense.lines.map((l, i) => [l.id, shares[i]]));
}

/**
 * Builds the tabs. numbered: from numberItems(). ctx: { project, rooms, categories, quotes, allExpenses, period,
 * today, everything (whole reno: include budgets and quotes), photos: Map ref → [file names] (when photos are
 * included) }. Returns [{ name, rows, widths, table }]; the first row of a table is its header.
 */
export function buildSheets(numbered, ctx) {
  const roomName = (id) => ctx.rooms.find((r) => r.id === id)?.name || '';
  const categoryName = (id) => ctx.categories.find((c) => c.id === id)?.name || '';
  const quoteName = (id) => { const q = ctx.quotes.find((x) => x.id === id); return q ? q.supplier || q.description || 'Quote' : ''; };
  const photoCell = (it) => (ctx.photos ? (ctx.photos.get(it.ref) || []).join(', ') || 'No' : it.expense.fileIds.length ? 'Yes' : 'No');

  const items = [['Ref', 'Date', 'Store', 'Item', 'Room / stage', 'Category', 'Tool', 'Amount', 'GST', 'Receipt total', 'Receipt photo', 'Notes']];
  const expenses = [['Ref', 'Date', 'Store', 'What', 'Rooms / stages', 'Categories', 'Total', 'GST', 'Excl. GST', 'Tools', 'Receipt photo', 'Paid against quote', 'Notes']];
  const byRoom = new Map();
  const byCategory = new Map();
  let spent = 0;
  let gst = 0;
  let tools = 0;

  for (const it of numbered) {
    const e = it.expense;
    const gstOf = lineGst(e);
    let total = 0;
    let lineGstSum = 0;
    let toolCents = 0;
    for (const l of it.lines) {
      const g = gstOf.get(l.id) ?? 0;
      total += l.amountCents;
      lineGstSum += g;
      if (l.isTool) toolCents += l.amountCents;
      byRoom.set(l.roomId, (byRoom.get(l.roomId) || 0) + l.amountCents);
      byCategory.set(l.categoryId, (byCategory.get(l.categoryId) || 0) + l.amountCents);
      items.push([it.ref, date(e.date), e.store, l.description || e.description || '', roomName(l.roomId), categoryName(l.categoryId),
        l.isTool ? 'Yes' : '', money(l.amountCents), money(g), money(e.totalCents), photoCell(it), e.notes || '']);
    }
    const partial = it.lines.length < e.lines.length;
    const notes = [partial ? `Part of a $${(e.totalCents / 100).toFixed(2)} receipt.` : '', e.notes || ''].filter(Boolean).join(' ');
    expenses.push([it.ref, date(e.date), e.store, e.description || it.lines.find((l) => l.description)?.description || '',
      [...new Set(it.lines.map((l) => roomName(l.roomId)))].join(', '), [...new Set(it.lines.map((l) => categoryName(l.categoryId)))].join(', '),
      money(total), money(lineGstSum), money(total - lineGstSum), money(toolCents), photoCell(it), e.quoteId ? quoteName(e.quoteId) : '', notes]);
    spent += total;
    gst += lineGstSum;
    tools += toolCents;
  }

  // Summary
  const photos = numbered.filter((it) => it.expense.fileIds.length).length;
  const summary = [
    [{ title: `${ctx.project?.name || 'Renovation'}: spending` }],
    [],
    ['Period', ctx.period],
    ['Exported', date(ctx.today)],
    ['Expenses', { n: numbered.length }],
    ['With a receipt photo', { n: photos }],
    [],
    [{ b: 'Spent (incl. GST)' }, { bm: spent }],
    ['GST', money(gst)],
    ['Excl. GST', money(spent - gst)],
    ['Tools', money(tools)],
  ];
  const outstanding = new Map();
  let committed = 0;
  if (ctx.everything) {
    for (const q of ctx.quotes) {
      const owed = quoteProgress(q, ctx.allExpenses).outstanding;
      committed += owed;
      if (owed) outstanding.set(q.roomId, (outstanding.get(q.roomId) || 0) + owed);
    }
    const budget = ctx.rooms.filter((r) => !r.archived).reduce((sum, r) => sum + (r.budgetCents || 0), 0);
    if (budget) summary.push(['Budget', money(budget)], ['Accepted quotes still to pay', money(committed)], [{ b: 'Remaining' }, { bm: budget - spent - committed }]);
  }
  summary.push([]);
  const rooms = ctx.rooms.filter((r) => byRoom.has(r.id) || (ctx.everything && !r.archived));
  summary.push(ctx.everything
    ? [{ h: 'Room / stage' }, { h: 'Spent' }, { h: 'Budget' }, { h: 'Used' }, { h: 'Status' }]
    : [{ h: 'Room / stage' }, { h: 'Spent' }]);
  for (const r of rooms) {
    const s = byRoom.get(r.id) || 0;
    summary.push(ctx.everything
      ? [r.name, money(s), money(r.budgetCents || null), r.budgetCents ? { p: s / r.budgetCents } : null,
        STATUS_WORDS[budgetStatus(s, r.budgetCents || 0, outstanding.get(r.id) || 0)]]
      : [r.name, money(s)]);
  }
  summary.push([{ b: 'Total' }, { bm: spent }], [], [{ h: 'Category' }, { h: 'Spent' }, { h: 'Share' }]);
  for (const [id, cents] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    if (cents) summary.push([categoryName(id) || 'Other', money(cents), spent ? { p: cents / spent } : null]);
  }

  const sheets = [
    { name: 'Summary', rows: summary, widths: [30, 16, 14, 9, 20] },
    { name: 'Expenses', rows: expenses, widths: [7, 11, 22, 28, 22, 24, 12, 11, 12, 11, 16, 20, 34], table: true },
    { name: 'Items', rows: items, widths: [7, 11, 22, 34, 20, 20, 6, 12, 11, 13, 16, 30], table: true },
  ];
  if (ctx.everything && ctx.quotes.length) {
    const quotes = [['Date', 'Supplier', 'For', 'Room / stage', 'Categories', 'Status', 'Quoted', 'Paid so far', 'Still to pay', 'Over (+) / under (−)', 'Next payment due']];
    for (const q of ctx.quotes.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
      const p = quoteProgress(q, ctx.allExpenses);
      const open = q.status === 'quoted' || q.status === 'accepted';
      quotes.push([date(q.date), q.supplier, q.description || '', roomName(q.roomId), quoteParts(q).map((pt) => categoryName(pt.categoryId)).filter(Boolean).join(', '),
        QUOTE_STATUS[q.status] || q.status, money(q.amountCents), money(p.paid), open ? money(p.left) : null, p.diff != null ? money(p.diff) : null,
        open ? date(q.dueDate) : null]);
    }
    sheets.push({ name: 'Quotes', rows: quotes, widths: [11, 22, 28, 20, 26, 10, 12, 12, 12, 16, 15], table: true });
  }
  return sheets;
}

// ---------- CSV ----------

function csvValue(cell) {
  if (cell == null) return '';
  let s;
  if (typeof cell === 'string') s = /^[=+\-@\t\r]/.test(cell) && !/^-?\d/.test(cell) ? `'${cell}` : cell; // never read as a formula
  else if ('m' in cell || 'bm' in cell) s = ((cell.m ?? cell.bm) / 100).toFixed(2);
  else if ('d' in cell) s = formatDate(cell.d);
  else if ('n' in cell) s = String(cell.n);
  else if ('p' in cell) s = `${Math.round(cell.p * 100)}%`;
  else s = String(cell.b ?? cell.h ?? cell.title ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A table as CSV: UTF-8 with a byte-order mark (so Excel reads it correctly), dd/mm/yyyy dates, plain amounts. */
export function toCSV(rows) {
  return `﻿${rows.map((r) => r.map(csvValue).join(',')).join('\r\n')}\r\n`;
}

// ---------- Excel (.xlsx) ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); // characters XML can't hold
const colName = (i) => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const serial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000 + 25569; };

// Cell styles (indexes into cellXfs below)
const ST = { text: 0, header: 1, money: 2, date: 3, title: 4, boldMoney: 5, bold: 6, percent: 7 };

function cellXml(cell, ref, header) {
  if (cell == null || cell === '') return '';
  const str = (v, s) => `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const num = (v, s) => `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
  if (typeof cell === 'string') return str(cell, header ? ST.header : 0);
  if ('m' in cell) return num((cell.m / 100).toFixed(2), ST.money);
  if ('bm' in cell) return num((cell.bm / 100).toFixed(2), ST.boldMoney);
  if ('d' in cell) return num(serial(cell.d), ST.date);
  if ('n' in cell) return num(cell.n, 0);
  if ('p' in cell) return num(cell.p.toFixed(4), ST.percent);
  if ('h' in cell) return str(cell.h, ST.header);
  if ('b' in cell) return str(cell.b, ST.bold);
  if ('title' in cell) return str(cell.title, ST.title);
  return '';
}

function sheetXml(sheet) {
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const rows = sheet.rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => cellXml(c, `${colName(j)}${i + 1}`, sheet.table && i === 0)).join('')}</row>`).join('');
  const lastRef = `${colName(width - 1)}${Math.max(1, sheet.rows.length)}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<dimension ref="A1:${lastRef}"/>`
    + `<sheetViews><sheetView workbookViewId="0"${sheet.table ? '' : ' showGridLines="0"'}>${sheet.table ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${(sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rows}</sheetData>`
    + (sheet.table && sheet.rows.length > 1 ? `<autoFilter ref="A1:${lastRef}"/>` : '')
    + '</worksheet>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>'
  + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="15"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE4EEFB"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="8">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** The workbook's files, ready to zip: [{ name, data }]. */
export function xlsxEntries(sheets) {
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const filters = sheets.map((s, i) => (s.table && s.rows.length > 1
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!$A$1:$${colName(Math.max(...s.rows.map((r) => r.length)) - 1)}$${s.rows.length}</definedName>` : '')).join('');
  return [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><bookViews><workbookView/></bookViews><sheets>`
      + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + `</sheets>${filters ? `<definedNames>${filters}</definedNames>` : ''}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
}

/** The workbook as an .xlsx Blob. */
export async function toXLSX(sheets) {
  const zip = await createZip(xlsxEntries(sheets));
  return new Blob([zip], { type: XLSX_TYPE });
}
