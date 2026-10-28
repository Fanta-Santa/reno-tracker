// The add / edit expense form. Opens as a sheet from the ＋ button, the inbox or an expense.

import { html, useEffect, useMemo, useState } from '../lib.js';
import {
  state, useStore, activeRooms, activeCategories, categoryById, storeByName,
  blankExpense, saveExpense, deleteExpense, findDuplicates, gstRate, uid,
} from '../store.js';
import { centsToInput, expenseGst, formatDate, formatMoney, parseMoney, splitEvenly } from '../format.js';
import { roomType } from '../defaults.js';
import { prepareFile } from '../images.js';
import {
  openSheet, SheetHeader, Switch, Segmented, Chips, Thumb, toast, toastUndo, withBusy, pickFiles,
  confirmAction,
} from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { openViewer } from '../ui/viewer.js';
import { currentPath, goBack } from '../ui/router.js';

// ---------- Opening the form ----------

function defaultRoomId() {
  const rooms = activeRooms();
  return rooms.find((r) => r.id === state.prefs.lastRoomId)?.id || rooms[0]?.id || null;
}

/** The store's usual category, if it has one. Otherwise left blank for you to pick, rather than guessing. */
function defaultCategoryId(storeName) {
  const id = storeByName(storeName)?.defaultCategoryId;
  return activeCategories().some((c) => c.id === id) ? id : null;
}

function newLine(roomId, categoryId, amountText = '') {
  return { id: uid(), roomId, categoryId, amountText, isTool: !!categoryById(categoryId)?.isTool };
}

/** Builds the editable draft from an expense (new ones get smart defaults). */
function draftFrom(expense, pendingFiles = []) {
  const store = expense.store || (expense.status === 'inbox' ? '' : state.prefs.lastStore || '');
  const lines = expense.lines.length
    ? expense.lines.map((l) => ({ ...l, amountText: centsToInput(l.amountCents) }))
    : [newLine(defaultRoomId(), defaultCategoryId(store))];
  return {
    expense,
    store,
    date: expense.date,
    description: expense.description,
    notes: expense.notes,
    amountText: centsToInput(expense.totalCents),
    gstMode: expense.gstMode || 'auto',
    gstText: expense.gstMode === 'custom' ? centsToInput(expense.gstCents) : '',
    split: lines.length > 1,
    lines,
    files: [
      ...expense.fileIds.map((id) => ({ id })),
      ...pendingFiles.map((p) => ({ id: p.id, pending: p })),
    ],
    removedFileIds: [],
  };
}

/**
 * Opens the expense form.
 *  - { expense }        edit an existing expense or sort an inbox receipt
 *  - { pendingFiles }   new expense with photos/PDFs already picked
 *  - { draft }          reopen a discarded draft (Undo)
 */
export function openExpenseForm({ expense, pendingFiles = [], draft } = {}) {
  const initial = draft || draftFrom(expense || blankExpense(), pendingFiles);
  openSheet(({ close }) => html`<${ExpenseForm} initial=${initial} close=${close} />`, { full: true, dismissible: false });
}

// ---------- The form ----------

const snapshot = (d) => JSON.stringify({ ...d, files: d.files.map((f) => f.id), expense: undefined });

function ExpenseForm({ initial, close }) {
  useStore();
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState({});
  const [startSnapshot] = useState(() => snapshot(initial));
  const set = (patch) => setD((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));

  const existing = state.expenses.find((e) => e.id === d.expense.id);
  const isInbox = existing?.status === 'inbox';
  const isNew = !existing;
  const title = isInbox ? 'Sort receipt' : isNew ? 'New expense' : 'Edit expense';

  const totalCents = parseMoney(d.amountText);
  const gstCents = d.gstMode === 'custom'
    ? parseMoney(d.gstText) ?? 0
    : expenseGst({ totalCents, gstMode: d.gstMode }, gstRate());
  const allocated = d.lines.reduce((sum, l) => sum + (parseMoney(l.amountText) ?? 0), 0);
  const remaining = (totalCents ?? 0) - allocated;

  // Room/category lists, including an archived one if this expense already uses it.
  const roomItems = useMemo(() => {
    const used = new Set(d.lines.map((l) => l.roomId));
    return state.rooms.filter((r) => !r.archived || used.has(r.id))
      .map((r) => ({ value: r.id, label: r.name, emoji: roomType(r.type).emoji }));
  }, [state.rooms, d.lines]);
  const categoryItems = useMemo(() => {
    const used = new Set(d.lines.map((l) => l.categoryId));
    return state.categories.filter((c) => !c.archived || used.has(c.id))
      .map((c) => ({ value: c.id, label: c.name }));
  }, [state.categories, d.lines]);

  // Object URLs for receipts that aren't saved yet.
  const pendingUrls = useMemo(() => {
    const map = new Map();
    for (const f of d.files) if (f.pending) map.set(f.id, URL.createObjectURL(f.pending.thumb || f.pending.blob));
    return map;
  }, [d.files]);
  useEffect(() => () => pendingUrls.forEach((u) => URL.revokeObjectURL(u)), [pendingUrls]);

  // ----- Field updates -----

  const updateLine = (id, patch) => set((cur) => ({
    lines: cur.lines.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      if ('categoryId' in patch) next.isTool = !!categoryById(patch.categoryId)?.isTool;
      return next;
    }),
  }));

  // Picking a store fills in its usual category. Typing one in only fills a blank category.
  const applyStoreCategory = (name, { overwrite }) => set((cur) => {
    const cat = defaultCategoryId(name);
    if (cur.split || !cat || (!overwrite && cur.lines[0].categoryId)) return {};
    return { lines: [{ ...cur.lines[0], categoryId: cat, isTool: !!categoryById(cat)?.isTool }] };
  });
  const pickStore = (name) => {
    set({ store: name });
    applyStoreCategory(name, { overwrite: true });
  };

  const startSplit = () => set((cur) => {
    const first = { ...cur.lines[0], amountText: cur.amountText };
    const otherRoom = activeRooms().find((r) => r.id !== first.roomId)?.id || first.roomId;
    return { split: true, lines: [first, newLine(otherRoom, first.categoryId)] };
  });

  const stopSplit = () => set((cur) => ({ split: false, lines: [{ ...cur.lines[0], amountText: '' }] }));

  const removeLine = (id) => set((cur) => {
    const lines = cur.lines.filter((l) => l.id !== id);
    return lines.length > 1 ? { lines } : { split: false, lines };
  });

  const splitEvenlyNow = () => {
    if (totalCents == null) return setErrors({ amount: true });
    const parts = splitEvenly(totalCents, d.lines.length);
    set((cur) => ({ lines: cur.lines.map((l, i) => ({ ...l, amountText: centsToInput(parts[i]) })) }));
  };

  const putRemainderOnLast = () => set((cur) => ({
    lines: cur.lines.map((l, i) => (i === cur.lines.length - 1
      ? { ...l, amountText: centsToInput((parseMoney(l.amountText) ?? 0) + remaining) } : l)),
  }));

  const addFiles = async (kind) => {
    const picked = await pickFiles(kind, { multiple: kind !== 'camera' });
    if (!picked.length) return;
    const prepared = await withBusy('Preparing receipt…', () => Promise.all(picked.map(prepareFile)));
    if (prepared) set((cur) => ({ files: [...cur.files, ...prepared.map((p) => ({ id: p.id, pending: p }))] }));
  };

  const removeFile = (id) => set((cur) => ({
    files: cur.files.filter((f) => f.id !== id),
    removedFileIds: cur.files.find((f) => f.id === id && !f.pending) ? [...cur.removedFileIds, id] : cur.removedFileIds,
  }));

  const viewFile = (i) => openViewer(d.files.map((f) => f.pending || f.id), i);

  // ----- Saving -----

  const buildRecord = (status) => ({
    ...d.expense,
    status,
    store: d.store.trim(),
    date: d.date,
    description: d.description.trim(),
    notes: d.notes.trim(),
    totalCents,
    gstMode: d.gstMode,
    gstCents: d.gstMode === 'custom' ? gstCents : null,
    lines: (d.split ? d.lines : d.lines.slice(0, 1)).map((l) => {
      const line = {
        id: l.id,
        roomId: l.roomId,
        categoryId: l.categoryId,
        amountCents: d.split ? parseMoney(l.amountText) ?? 0 : totalCents ?? 0,
        isTool: l.isTool,
      };
      if (l.description?.trim()) line.description = l.description.trim();
      if (l.auto) line.auto = true;
      if (l.auto && l.unmatched?.length) line.unmatched = l.unmatched;
      return line;
    }),
    fileIds: d.files.map((f) => f.id),
    scan: status === 'inbox' ? d.expense.scan : undefined, // the reader's findings are only needed until it's sorted
  });

  const persist = async (record, message) => {
    const undo = await withBusy('Saving…', () => saveExpense(record, {
      newFiles: d.files.filter((f) => f.pending).map((f) => f.pending),
      removedFileIds: d.removedFileIds,
    }));
    if (!undo) return;
    close();
    toastUndo(message, undo);
  };

  const save = async () => {
    const problems = {};
    if (totalCents == null || totalCents === 0) problems.amount = true;
    if (!d.date) problems.date = true;
    if (d.lines.some((l) => !l.roomId)) problems.room = true;
    if (d.lines.some((l) => !l.categoryId)) problems.category = true;
    if (d.split && remaining !== 0) problems.split = true;
    if (d.gstMode === 'custom' && parseMoney(d.gstText) == null) problems.gst = true;
    setErrors(problems);
    if (Object.keys(problems).length) {
      toast(problems.amount ? 'Enter the total amount.'
        : problems.split ? 'The split needs to add up to the total.'
          : problems.room ? 'Choose a room or stage.'
            : problems.category ? 'Choose a category.' : 'Check the highlighted fields.', { icon: 'alert' });
      return;
    }
    const record = buildRecord('filed');
    const dupes = findDuplicates(record).filter((e) => e.status !== 'inbox');
    if (dupes.length) {
      const dupe = dupes[0];
      const ok = await confirmAction({
        title: 'Looks like one you’ve already logged',
        message: `${dupe.store || 'No store'} · ${formatDate(dupe.date)} · ${formatMoney(dupe.totalCents)}${dupe.description ? ` · ${dupe.description}` : ''}`,
        confirmLabel: 'Save anyway',
        destructive: false,
      });
      if (!ok) return;
    }
    await persist(record, isInbox ? 'Receipt sorted' : isNew ? 'Expense saved' : 'Changes saved');
  };

  const saveToInbox = () => persist(buildRecord('inbox'), isInbox ? 'Kept in inbox' : 'Saved to inbox to sort later');

  const cancel = () => {
    close();
    if (snapshot(d) !== startSnapshot) {
      toast('Draft discarded', { actionLabel: 'Undo', onAction: () => openExpenseForm({ draft: d }) });
    }
  };

  const remove = async () => {
    const undo = await withBusy('Deleting…', () => deleteExpense(d.expense.id));
    if (!undo) return;
    close();
    if (currentPath() === `/expenses/${d.expense.id}`) goBack('/expenses');
    toastUndo(isInbox ? 'Receipt deleted' : 'Expense deleted', undo);
  };

  // ----- Render -----

  const line = d.lines[0];
  const hasPending = d.files.some((f) => f.pending) || isInbox;

  return html`<${SheetHeader} title=${title} onCancel=${cancel} onDone=${save} doneLabel="Save" />
  <div class="sheet-body form">
    <div class="receipt-strip">
      ${d.files.map((f, i) => html`<div class="receipt-tile" key=${f.id}>
        <button class="receipt-tile-img" onClick=${() => viewFile(i)} aria-label="View receipt">
          ${f.pending
            ? (f.pending.thumb ? html`<img src=${pendingUrls.get(f.id)} alt="" />` : html`<span class="pdf-tile"><${Icon} name="doc" />PDF</span>`)
            : html`<${Thumb} fileId=${f.id} size=${76} radius=${14} />`}
        </button>
        <button class="receipt-tile-x" onClick=${() => removeFile(f.id)} aria-label="Remove receipt"><${Icon} name="x" size=${14} stroke=${2.6} /></button>
      </div>`)}
      <button class="receipt-add" onClick=${() => addFiles('camera')}><${Icon} name="camera" /><span>Camera</span></button>
      <button class="receipt-add" onClick=${() => addFiles('file')}><${Icon} name="upload" /><span>File</span></button>
    </div>

    <div class="amount-card ${errors.amount ? 'has-error' : ''}">
      <label class="amount-label" for="amount">Total paid (incl. GST)</label>
      <div class="amount-input">
        <span>$</span>
        <input id="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" value=${d.amountText}
          onInput=${(e) => set({ amountText: e.currentTarget.value })}
          onBlur=${() => totalCents != null && set({ amountText: centsToInput(totalCents) })} />
      </div>
      <div class="gst-row">
        <${Segmented} small value=${d.gstMode} onChange=${(gstMode) => set({ gstMode })}
          options=${[{ value: 'auto', label: 'Incl. GST' }, { value: 'none', label: 'No GST' }, { value: 'custom', label: 'Custom' }]} />
        ${d.gstMode === 'custom'
          ? html`<input class="gst-input ${errors.gst ? 'has-error' : ''}" inputmode="decimal" placeholder="GST $"
              value=${d.gstText} onInput=${(e) => set({ gstText: e.currentTarget.value })} />`
          : html`<span class="gst-value">GST ${formatMoney(gstCents)}</span>`}
      </div>
    </div>

    <div class="form-group">
      <label class="field">
        <span class="field-label">Store / supplier</span>
        <input type="text" placeholder="e.g. Bunnings" value=${d.store} autocomplete="off"
          onInput=${(e) => set({ store: e.currentTarget.value })}
          onBlur=${(e) => applyStoreCategory(e.currentTarget.value, { overwrite: false })} />
      </label>
      ${state.stores.length > 0 && html`<div class="field-chips">
        <${Chips} items=${state.stores.map((s) => ({ value: s.name, label: s.name }))}
          value=${state.stores.find((s) => s.name.toLowerCase() === d.store.trim().toLowerCase())?.name}
          onChange=${pickStore} />
      </div>`}
      <label class="field ${errors.date ? 'has-error' : ''}">
        <span class="field-label">Date</span>
        <input type="date" value=${d.date} onInput=${(e) => set({ date: e.currentTarget.value })} />
      </label>
      <label class="field">
        <span class="field-label">What was it?</span>
        <input type="text" placeholder="e.g. Screws, timber, sander" value=${d.description}
          onInput=${(e) => set({ description: e.currentTarget.value })} />
      </label>
    </div>

    ${!d.split ? html`<div class="form-group">
      <div class="field-block ${errors.room ? 'has-error' : ''}">
        <span class="field-label">Room / stage</span>
        <${Chips} wrap items=${roomItems} value=${line.roomId} onChange=${(roomId) => updateLine(line.id, { roomId })} />
      </div>
      <div class="field-block ${errors.category ? 'has-error' : ''}">
        <span class="field-label">Category</span>
        <${Chips} wrap items=${categoryItems} value=${line.categoryId} onChange=${(categoryId) => updateLine(line.id, { categoryId })} />
      </div>
      <div class="field-row">
        <span class="tool-label"><${Icon} name="wrench" size=${18} /> Tool <small>reusable across the reno</small></span>
        <${Switch} label="Tool" checked=${line.isTool} onChange=${(isTool) => updateLine(line.id, { isTool })} />
      </div>
      <button class="link-btn" onClick=${startSplit}><${Icon} name="split" size=${18} /> Split across rooms or categories</button>
    </div>` : html`<div class="form-group split ${errors.split ? 'has-error' : ''}">
      <div class="split-head">
        <span class="field-label">${d.lines.some((l) => l.description) ? 'Items' : 'Split'} ${formatMoney(totalCents ?? 0)}</span>
        <button class="link-btn small" onClick=${stopSplit}>Don’t split</button>
      </div>
      ${d.lines.map((l, i) => html`<div class="split-line" key=${l.id}>
        <div class="split-line-top">
          <span class="split-num">${i + 1}</span>
          <div class="split-amount">
            <span>$</span>
            <input inputmode="decimal" placeholder="0.00" value=${l.amountText} aria-label="Amount"
              onInput=${(e) => updateLine(l.id, { amountText: e.currentTarget.value })}
              onBlur=${(e) => { const c = parseMoney(e.currentTarget.value); if (c != null) updateLine(l.id, { amountText: centsToInput(c) }); }} />
          </div>
          <button class="icon-btn" onClick=${() => removeLine(l.id)} aria-label="Remove line"><${Icon} name="x" size=${18} /></button>
        </div>
        <input class="split-desc" placeholder="Item (optional)" value=${l.description || ''} aria-label="Item"
          onInput=${(e) => updateLine(l.id, { description: e.currentTarget.value, auto: false })} />
        ${l.unmatched?.length > 0 && html`<span class="receipt-lines">${l.unmatched.map((t) => html`<span>${t}</span>`)}</span>`}
        <div class="split-selects">
          <select value=${l.roomId || ''} onChange=${(e) => updateLine(l.id, { roomId: e.currentTarget.value })} aria-label="Room">
            ${roomItems.map((r) => html`<option value=${r.value}>${r.emoji} ${r.label}</option>`)}
          </select>
          <select value=${l.categoryId || ''} onChange=${(e) => updateLine(l.id, { categoryId: e.currentTarget.value })} aria-label="Category">
            ${categoryItems.map((c) => html`<option value=${c.value}>${c.label}</option>`)}
          </select>
        </div>
        <div class="field-row compact">
          <span class="tool-label"><${Icon} name="wrench" size=${16} /> Tool</span>
          <${Switch} label="Tool" checked=${l.isTool} onChange=${(isTool) => updateLine(l.id, { isTool })} />
        </div>
      </div>`)}
      <div class="split-status ${remaining === 0 ? 'ok' : 'off'}">
        ${remaining === 0
          ? html`<span><${Icon} name="check" size=${16} stroke=${2.4} /> Adds up to the total</span>`
          : html`<span>${remaining > 0 ? `${formatMoney(remaining)} left to allocate` : `${formatMoney(-remaining)} over the total`}</span>
            <button class="link-btn small" onClick=${putRemainderOnLast}>Fix on last line</button>`}
      </div>
      <div class="split-actions">
        <button class="pill-btn" onClick=${() => set((cur) => ({ lines: [...cur.lines, newLine(defaultRoomId(), cur.lines[0].categoryId)] }))}>
          <${Icon} name="plus" size=${16} /> Add line</button>
        <button class="pill-btn" onClick=${splitEvenlyNow}>Split evenly</button>
      </div>
    </div>`}

    <div class="form-group">
      <label class="field">
        <span class="field-label">Notes</span>
        <textarea rows="3" placeholder="Warranty, colour code, returns…" value=${d.notes}
          onInput=${(e) => set({ notes: e.currentTarget.value })} />
      </label>
    </div>

    <div class="form-footer">
      ${(hasPending && (isNew || isInbox)) && html`<button class="wide-btn secondary" onClick=${saveToInbox}>
        <${Icon} name="inbox" size=${20} /> ${isInbox ? 'Keep in inbox for now' : 'Sort later (save to inbox)'}</button>`}
      ${!isNew && html`<button class="wide-btn danger" onClick=${remove}>
        <${Icon} name="trash" size=${20} /> ${isInbox ? 'Delete receipt' : 'Delete expense'}</button>`}
    </div>
  </div>`;
}
