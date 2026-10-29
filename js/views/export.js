// The Export sheet: your expenses as an Excel workbook or a CSV, for everything, a financial year or the list as
// you've filtered it, optionally zipped with the receipt photos (named to match the spreadsheet's references).
// It's all made on the phone, then handed to the Share sheet (Save to Files, Mail, AirDrop…).

import { html, useState } from '../lib.js';
import { state, filedExpenses, getFile } from '../store.js';
import { formatDate, formatMoney, todayISO } from '../format.js';
import { buildSheets, numberItems, toCSV, toXLSX, financialYear, fileExtension, cleanName, XLSX_TYPE } from '../export.js';
import { createZip } from '../zip.js';
import { shareFile } from '../device.js';
import { SheetHeader, Segmented, Chips, Switch, openSheet, toast, withBusy } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';

const slug = (text) => (text || 'reno').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reno';
const allItems = (expenses) => expenses.map((e) => ({ expense: e, lines: e.lines }));

/**
 * Makes the file. items: [{ expense, lines }]. everything: the whole reno (adds budgets and the Quotes tab).
 * Returns a File: .xlsx or .csv, or a .zip of it plus the receipt photos.
 */
export async function makeExport(items, { format, photos, everything, period }) {
  const numbered = numberItems(items);
  const today = todayISO();
  let photoNames = null;
  const photoEntries = [];
  if (photos) {
    photoNames = new Map();
    for (const it of numbered) {
      const names = [];
      const ids = it.expense.fileIds;
      for (let i = 0; i < ids.length; i++) {
        const file = await getFile(ids[i]);
        if (!file) continue;
        const name = `${it.ref} ${it.expense.date} ${cleanName(it.expense.store) || 'Receipt'}${ids.length > 1 ? ` (${i + 1})` : ''}.${fileExtension(file.type)}`;
        names.push(name);
        photoEntries.push({ name: `Receipts/${name}`, data: file.blob });
      }
      photoNames.set(it.ref, names);
    }
  }
  const sheets = buildSheets(numbered, {
    project: state.project, rooms: state.rooms, categories: state.categories, quotes: state.quotes,
    allExpenses: state.expenses, period, today, everything, photos: photoNames,
  });
  const base = `reno-${slug(state.project?.name)}-${today}`;
  const sheet = format === 'xlsx'
    ? new File([await toXLSX(sheets)], `${base}.xlsx`, { type: XLSX_TYPE })
    : new File([toCSV(sheets.find((s) => s.name === 'Items').rows)], `${base}.csv`, { type: 'text/csv' });
  if (!photos) return sheet;
  const zip = await createZip([{ name: sheet.name, data: sheet }, ...photoEntries]);
  return new File([zip], `${base}-with-receipts.zip`, { type: 'application/zip' });
}

/**
 * Opens the sheet. filtered: { items: [{ expense, lines }], label } when opened from a filtered Expenses list
 * (lines: just the ones that matched, e.g. the kitchen part of a split receipt).
 */
export function openExportSheet({ filtered } = {}) {
  openSheet(({ close }) => html`<${ExportSheet} close=${close} filtered=${filtered} />`);
}

function ExportSheet({ close, filtered }) {
  const today = todayISO();
  const fy = financialYear(today);
  const lastFy = financialYear(today, -1);
  const [format, setFormat] = useState('xlsx');
  const [period, setPeriod] = useState(filtered ? 'filtered' : 'all');
  const [photos, setPhotos] = useState(false);

  const all = filedExpenses();
  const between = (r) => allItems(all.filter((e) => e.date >= r.from && e.date <= r.to));
  const choices = {
    ...(filtered ? { filtered: { label: `As filtered (${filtered.items.length})`, items: filtered.items, title: `Filtered: ${filtered.label}` } } : {}),
    all: { label: 'Everything', items: allItems(all), title: 'Everything' },
    fy: { label: `FY ${fy.label}`, items: between(fy), title: `Financial year ${fy.label} (${formatDate(fy.from)} – ${formatDate(fy.to)})` },
    lastFy: { label: `FY ${lastFy.label}`, items: between(lastFy), title: `Financial year ${lastFy.label} (${formatDate(lastFy.from)} – ${formatDate(lastFy.to)})` },
  };
  const chosen = choices[period];
  const total = chosen.items.reduce((sum, it) => sum + it.lines.reduce((s, l) => s + l.amountCents, 0), 0);
  const withPhotos = chosen.items.filter((it) => it.expense.fileIds.length).length;

  const run = async () => {
    const file = await withBusy(photos ? 'Packing up your receipts…' : 'Making your spreadsheet…',
      () => makeExport(chosen.items, { format, photos, everything: period === 'all', period: chosen.title }));
    if (!file) return;
    try {
      if (!(await shareFile(file))) return;
    } catch (err) {
      // Safari only allows sharing straight after a tap; if making the file took too long, ask for one more tap.
      if (err.name !== 'NotAllowedError') throw err;
      close();
      toast('Your export is ready', { actionLabel: 'Share', onAction: () => shareFile(file).catch(() => {}), duration: 20000 });
      return;
    }
    close();
    toast('Export ready', { icon: 'check' });
  };

  return html`<${SheetHeader} title="Export" onCancel=${close} cancelLabel="Close" />
  <div class="sheet-body form">
    <div class="form-group">
      <div class="field-block">
        <span class="field-label">Format</span>
        <${Segmented} value=${format} onChange=${setFormat} options=${[{ value: 'xlsx', label: 'Excel' }, { value: 'csv', label: 'CSV' }]} />
      </div>
      <p class="export-note">${format === 'xlsx'
        ? 'Tabs for a summary, every expense, every item (splits on their own rows) and your quotes. Opens in Excel, Numbers and Google Sheets.'
        : 'Every item on its own row, for any spreadsheet app.'}</p>
    </div>

    <div class="form-group">
      <div class="field-block">
        <span class="field-label">What to include <small>Financial years run 1 July to 30 June.</small></span>
        <${Chips} wrap items=${Object.entries(choices).map(([value, c]) => ({ value, label: c.label }))} value=${period} onChange=${setPeriod} />
      </div>
      <div class="field-row">
        <span class="tool-label"><${Icon} name="photo" size=${18} /> Receipt photos <small>Adds every photo and PDF in one .zip, named to match the spreadsheet (R001, R002…)</small></span>
        <${Switch} label="Receipt photos" checked=${photos} onChange=${setPhotos} />
      </div>
    </div>

    <p class="export-summary">${chosen.items.length} ${chosen.items.length === 1 ? 'expense' : 'expenses'} · ${formatMoney(total)}${photos ? ` · ${withPhotos} with a receipt photo` : ''}</p>
    <button class="wide-btn primary" disabled=${!chosen.items.length} onClick=${run}><${Icon} name="share" size=${20} /> Export</button>
  </div>`;
}
