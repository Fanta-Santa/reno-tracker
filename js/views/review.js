// Confirmation cards: after a receipt is read, a short run of cards checks what was found.
//   1. Store, date and total: one tap if all correct
//   2. Which room or stage
//   3. Only the items the reader wasn't sure about
//   4. A summary of everything, then Save
// Swipe a card right to confirm it, or left to go back.

import { html, useEffect, useMemo, useRef, useState } from '../lib.js';
import {
  state, useStore, activeRooms, activeCategories, categoryById, roomById, storeByName, uid, blankExpense,
  saveExpense, findDuplicates, inboxExpenses, gstRate,
} from '../store.js';
import { centsToInput, formatDate, formatMoney, gstFromTotal, parseMoney, todayISO } from '../format.js';
import { roomType } from '../defaults.js';
import { suggestCategory, scoreKinds, categoryForKind } from '../reader/categorize.js';
import { scanFiles, foundSomething } from '../reader/queue.js';
import {
  openSheet, SheetHeader, Switch, Chips, Thumb, toast, toastUndo, withBusy, confirmAction,
} from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { openViewer } from '../ui/viewer.js';
import { openExpenseForm } from './expense-form.js';

// ---------- Building the review from what the reader found ----------

function defaultRoomId() {
  const rooms = activeRooms();
  return rooms.find((r) => r.id === state.prefs.lastRoomId)?.id || rooms[0]?.id || null;
}

/** Uses your spelling of a store when the reader found one you already have. */
function canonicalStore(name) {
  return storeByName(name)?.name || name || '';
}

/** The category with the most money on the receipt; or "Other" when nothing has one yet. */
function mostCommonCategory(items) {
  const totals = new Map();
  for (const it of items) {
    if (!it.categoryId || it.isDiscount) continue;
    totals.set(it.categoryId, (totals.get(it.categoryId) || 0) + Math.abs(parseMoney(it.amountText) ?? 0));
  }
  const cats = activeCategories();
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    || cats.find((c) => /^other/i.test(c.name))?.id || cats[0]?.id || null;
}

function buildReview({ expense, pendingFiles = [], scan }) {
  const r = scan?.result;
  const store = canonicalStore(r?.store.value || expense.store);
  const storeCategoryId = storeByName(store)?.defaultCategoryId || null;
  const categories = state.categories;
  const items = (r?.items || []).map((it) => {
    const s = suggestCategory(it.description, { categories, learned: state.learned, storeName: store, storeCategoryId });
    return {
      id: uid(),
      description: it.description,
      amountText: centsToInput(it.amountCents),
      categoryId: s.categoryId,
      isTool: s.isTool,
      confidence: s.confidence,
      alternatives: s.alternatives,
      ocrConfidence: it.ocrConfidence ?? 90,
      isDiscount: it.isDiscount,
      roomId: null, // null = the receipt's room
    };
  });
  // Discounts belong with what they discounted: use the receipt's main category.
  const main = mostCommonCategory(items);
  for (const it of items) if (it.isDiscount) Object.assign(it, { categoryId: main, isTool: false, confidence: 'high' });

  // With no items, guess one category for the whole receipt.
  let wholeCategoryId = storeCategoryId;
  if (!items.length && r?.text) {
    const top = scoreKinds(r.text, store)[0];
    wholeCategoryId = (top && categoryForKind(top.kind, categories)?.id) || storeCategoryId;
  }

  return {
    expense,
    pendingFiles,
    scan,
    store,
    storeConfidence: r?.store.confidence || 'low',
    date: r?.date.found ? r.date.value : expense.date || todayISO(),
    dateConfidence: r?.date.found ? r.date.confidence : 'low',
    totalText: centsToInput(r?.total.cents ?? expense.totalCents),
    totalConfidence: r?.total.confidence || 'low',
    gstCents: r?.gst.cents ?? null,
    gstFound: r?.gst.cents != null,
    roomId: defaultRoomId(),
    items,
    wholeCategoryId,
    wholeIsTool: !!categoryById(wholeCategoryId)?.isTool,
    receiptText: r?.text || '',
  };
}

function cardsFor(rv) {
  const cards = [{ type: 'details' }];
  if (activeRooms().length > 1) cards.push({ type: 'room' });
  if (rv.items.length) {
    const unsure = rv.items.filter((it) => !it.isDiscount && (it.confidence !== 'high' || it.ocrConfidence < 70));
    unsure.forEach((it, i) => cards.push({ type: 'item', itemId: it.id, n: i + 1, of: unsure.length }));
  } else {
    cards.push({ type: 'category' });
  }
  cards.push({ type: 'summary' });
  return cards;
}

// ---------- Opening the cards ----------

/**
 * Reads a receipt (showing a scanning screen), then opens the cards.
 * Falls back to the normal form if nothing useful could be read.
 */
export function scanThenReview({ expense, pendingFiles = [], next }) {
  const files = pendingFiles.length ? pendingFiles : expense.fileIds;
  openSheet(({ close }) => html`<${ScanSheet} files=${files} close=${close}
    onDone=${(scan) => {
      if (scan && foundSomething(scan.result)) openReview({ expense, pendingFiles, scan, next });
      else {
        openExpenseForm({ expense: expense.status === 'inbox' ? expense : undefined, pendingFiles });
        toast(scan ? 'Couldn’t find the total on this one. Please fill it in.' : 'Couldn’t read this receipt. Please fill it in.', { icon: 'alert', duration: 6000 });
      }
    }}
    onManual=${() => openExpenseForm({ expense: expense.status === 'inbox' ? expense : undefined, pendingFiles })} />`,
  { full: true, dismissible: false });
}

/** Opens the cards for a receipt that has already been read. next() runs after saving (multi-receipt review). */
export function openReview({ expense, pendingFiles = [], scan, next, draft, position }) {
  const initial = draft || buildReview({ expense, pendingFiles, scan });
  openSheet(({ close }) => html`<${Review} initial=${initial} close=${close} next=${next} position=${position} />`,
    { full: true, dismissible: false });
}

/** New photo/PDF from the ＋ button. */
export function reviewNewCapture(pendingFiles) {
  scanThenReview({ expense: blankExpense(), pendingFiles });
}

/** Goes through inbox receipts one after another, starting with `startId` (or the first). */
export function reviewInbox(startId) {
  const ids = inboxExpenses().map((e) => e.id);
  const queue = startId ? [startId, ...ids.filter((id) => id !== startId)] : ids;
  const total = queue.length;
  const step = (i) => {
    const expense = state.expenses.find((e) => e.id === queue[i] && e.status === 'inbox');
    if (!expense) {
      if (i + 1 < total) step(i + 1);
      return;
    }
    const next = i + 1 < total ? () => step(i + 1) : null;
    const position = total > 1 ? { n: i + 1, of: total } : null;
    if (expense.scan?.status === 'done' && foundSomething(expense.scan.result)) openReview({ expense, scan: expense.scan, next, position });
    else if (expense.scan?.status === 'done') openExpenseForm({ expense });
    else scanThenReview({ expense, next });
  };
  if (total) step(0);
}

// ---------- Scanning screen ----------

function useFilePreview(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file || typeof file === 'string') return undefined;
    const u = URL.createObjectURL(file.thumb || file.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

function ScanSheet({ files, close, onDone, onManual }) {
  const [status, setStatus] = useState({ status: 'Reading receipt', progress: 0 });
  const stopped = useRef(false);
  const preview = useFilePreview(files[0]);

  useEffect(() => {
    scanFiles(files, (p) => !stopped.current && setStatus(p))
      .then((scan) => { if (!stopped.current) { stopped.current = true; close(); onDone(scan); } })
      .catch((err) => {
        console.warn(err);
        if (!stopped.current) { stopped.current = true; close(); onDone(null); }
      });
  }, []);

  const manual = () => {
    stopped.current = true;
    close();
    onManual();
  };
  const firstTime = status.status.startsWith('Getting');
  return html`<${SheetHeader} title="Reading receipt" onCancel=${manual} cancelLabel="Type it in" />
  <div class="sheet-body scan">
    <div class="scan-photo">
      ${typeof files[0] === 'string' ? html`<${Thumb} fileId=${files[0]} size=${220} radius=${18} />`
        : preview ? html`<img src=${preview} alt="Receipt" />` : html`<span class="pdf-tile"><${Icon} name="doc" />PDF</span>`}
      <span class="scan-line" />
    </div>
    <div class="scan-status">
      <strong>${status.status}…</strong>
      <div class="meter small"><span style=${`width:${Math.round((status.progress || 0) * 100)}%`} /></div>
      <small>${firstTime ? 'First time only: downloading the reader (about 7 MB). After this it works offline.' : 'Everything is read on this phone. Nothing is uploaded.'}</small>
    </div>
  </div>`;
}

// ---------- The cards ----------

const confidenceTag = (c) => (c !== 'high' ? html`<span class="unsure">Check</span>` : null);

function useSwipe({ onRight, onLeft }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const down = (e) => {
      if (e.target.closest('input, select, textarea, button, .chips, .sum-list')) return;
      const x0 = e.clientX;
      const y0 = e.clientY;
      let mode = null;
      let dx = 0;
      const move = (ev) => {
        dx = ev.clientX - x0;
        const dy = ev.clientY - y0;
        if (!mode && Math.abs(dx) + Math.abs(dy) > 10) mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
        if (mode !== 'swipe') return;
        el.style.transition = 'none';
        el.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
        el.dataset.hint = dx > 40 ? 'yes' : dx < -40 ? 'back' : '';
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        el.style.transition = '';
        el.style.transform = '';
        el.dataset.hint = '';
        if (mode !== 'swipe') return;
        if (dx > 90) onRight?.();
        else if (dx < -90) onLeft?.();
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    };
    el.addEventListener('pointerdown', down);
    return () => el.removeEventListener('pointerdown', down);
  });
  return ref;
}

function Review({ initial, close, next, position }) {
  useStore();
  const [rv, setRv] = useState(initial);
  const [cards] = useState(() => cardsFor(initial));
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const set = (patch) => setRv((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));
  const setItem = (id, patch) => set((cur) => ({ items: cur.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));

  const card = cards[step];
  const isNew = !state.expenses.some((e) => e.id === rv.expense.id);
  const totalCents = parseMoney(rv.totalText);

  const go = (d) => {
    setDir(d);
    setStep((s) => Math.max(0, Math.min(cards.length - 1, s + d)));
  };
  const forward = () => go(1);
  const back = () => step > 0 && go(-1);

  // ----- Leaving -----

  const record = () => buildRecord(rv);
  const editAll = () => {
    close();
    // The form adds the not-yet-saved photos itself.
    openExpenseForm({ expense: { ...record(), fileIds: rv.expense.fileIds }, pendingFiles: rv.pendingFiles });
  };
  const cancel = () => {
    close();
    if (isNew) toast('Receipt not saved', { actionLabel: 'Undo', onAction: () => openReview({ draft: rv, next, position }) });
  };
  const sortLater = async () => {
    const undo = await withBusy('Saving…', () => saveExpense({
      ...blankExpense(), id: rv.expense.id, status: 'inbox', date: rv.date, fileIds: rv.pendingFiles.map((f) => f.id), scan: rv.scan,
    }, { newFiles: rv.pendingFiles }));
    if (!undo) return;
    close();
    toastUndo('Saved to inbox to check later', undo);
  };
  const save = async () => {
    const rec = record();
    const dupe = findDuplicates(rec).find((e) => e.status !== 'inbox');
    if (dupe) {
      const ok = await confirmAction({
        title: 'Looks like one you’ve already logged',
        message: `${dupe.store || 'No store'} · ${formatDate(dupe.date)} · ${formatMoney(dupe.totalCents)}`,
        confirmLabel: 'Save anyway',
        destructive: false,
      });
      if (!ok) return;
    }
    const undo = await withBusy('Saving…', () => saveExpense(rec, { newFiles: rv.pendingFiles }));
    if (!undo) return;
    close();
    toastUndo('Expense saved', undo);
    if (next) setTimeout(next, 380);
  };

  // ----- Cards -----

  let body;
  let onConfirm = forward;
  if (card.type === 'details') {
    const ok = totalCents != null && totalCents !== 0 && !!rv.date;
    onConfirm = () => (ok ? forward() : toast('Enter the total first.', { icon: 'alert' }));
    body = html`<${DetailsCard} rv=${rv} set=${set} totalCents=${totalCents} onConfirm=${onConfirm} canSortLater=${isNew} onSortLater=${sortLater} />`;
  } else if (card.type === 'room') {
    body = html`<${RoomCard} rv=${rv} onPick=${(roomId) => { set({ roomId }); setTimeout(forward, 200); }} onConfirm=${forward} />`;
  } else if (card.type === 'item') {
    const it = rv.items.find((x) => x.id === card.itemId);
    onConfirm = () => (it?.categoryId ? forward() : toast('Pick a category for this item.', { icon: 'alert' }));
    body = it ? html`<${ItemCard} it=${it} card=${card} setItem=${setItem} onPicked=${() => setTimeout(forward, 220)} onConfirm=${onConfirm} />` : null;
  } else if (card.type === 'category') {
    onConfirm = () => (rv.wholeCategoryId ? forward() : toast('Pick a category.', { icon: 'alert' }));
    body = html`<${CategoryCard} rv=${rv} set=${set} onPicked=${() => setTimeout(forward, 220)} onConfirm=${onConfirm} />`;
  } else {
    onConfirm = save;
    body = html`<${SummaryCard} rv=${rv} set=${set} setItem=${setItem} totalCents=${totalCents} onSave=${save} onEditAll=${editAll} />`;
  }

  const swipeRef = useSwipe({ onRight: card.type === 'summary' ? null : onConfirm, onLeft: back });

  return html`<${SheetHeader} title=${position ? `Receipt ${position.n} of ${position.of}` : 'Check receipt'}
      onCancel=${cancel} onDone=${editAll} doneLabel="Edit all" />
    <div class="sheet-body review">
      <div class="review-progress">
        ${step > 0 && html`<button class="icon-btn" onClick=${back} aria-label="Back"><${Icon} name="chevronLeft" /></button>`}
        <div class="dots">${cards.map((_, i) => html`<span class=${i === step ? 'on' : i < step ? 'done' : ''} />`)}</div>
      </div>
      <div class="card-stack">
        ${step < cards.length - 1 && html`<div class="card-ghost g2" />`}
        ${step < cards.length - 1 && html`<div class="card-ghost g1" />`}
        <div class="flash-card ${dir > 0 ? 'from-right' : 'from-left'}" key=${step} ref=${swipeRef}>
          <span class="swipe-hint yes"><${Icon} name="check" size=${18} stroke=${2.6} /> Correct</span>
          <span class="swipe-hint back"><${Icon} name="chevronLeft" size=${18} stroke=${2.6} /> Back</span>
          ${body}
        </div>
      </div>
    </div>`;
}

function ReceiptPeek({ rv }) {
  const pending = rv.pendingFiles[0];
  const preview = useFilePreview(pending);
  const files = rv.pendingFiles.length ? rv.pendingFiles : rv.expense.fileIds;
  if (!files.length) return null;
  return html`<button class="fc-receipt" onClick=${() => openViewer(files, 0)} aria-label="View receipt">
    ${pending ? (preview && pending.thumb ? html`<img src=${preview} alt="" />` : html`<span class="pdf-tile"><${Icon} name="doc" />PDF</span>`)
      : html`<${Thumb} fileId=${files[0]} size=${64} radius=${12} />`}
  </button>`;
}

function DetailsCard({ rv, set, totalCents, onConfirm, canSortLater, onSortLater }) {
  const [editingStore, setEditingStore] = useState(rv.storeConfidence !== 'high' || !rv.store);
  const gst = rv.gstFound ? rv.gstCents : gstFromTotal(totalCents ?? 0, gstRate());
  return html`<div class="fc-body">
    <div class="fc-top">
      <div>
        <span class="fc-kicker">Receipt details</span>
        <h2>Is this right?</h2>
      </div>
      <${ReceiptPeek} rv=${rv} />
    </div>
    <div class="fc-fields">
      <label class="fc-field">
        <span class="fc-label">Store ${confidenceTag(rv.storeConfidence)}</span>
        <input type="text" value=${rv.store} placeholder="Store or supplier" onFocus=${() => setEditingStore(true)}
          onInput=${(e) => set({ store: e.currentTarget.value, storeConfidence: 'high' })} />
      </label>
      ${editingStore && state.stores.length > 0 && html`<div class="fc-chips">
        <${Chips} items=${state.stores.map((s) => ({ value: s.name, label: s.name }))}
          value=${state.stores.find((s) => s.name.toLowerCase() === rv.store.trim().toLowerCase())?.name}
          onChange=${(store) => set({ store, storeConfidence: 'high' })} />
      </div>`}
      <label class="fc-field">
        <span class="fc-label">Date ${confidenceTag(rv.dateConfidence)}</span>
        <input type="date" value=${rv.date} onInput=${(e) => set({ date: e.currentTarget.value, dateConfidence: 'high' })} />
      </label>
      <label class="fc-field total">
        <span class="fc-label">Total ${confidenceTag(rv.totalConfidence)}</span>
        <span class="fc-money"><span>$</span><input inputmode="decimal" value=${rv.totalText} placeholder="0.00"
          onInput=${(e) => set({ totalText: e.currentTarget.value, totalConfidence: 'high' })} /></span>
        <small>${totalCents ? `GST ${formatMoney(gst)}${rv.gstFound ? '' : ' (worked out)'}` : 'Couldn’t find the total. Please type it in.'}</small>
      </label>
    </div>
    <div class="fc-actions">
      <button class="wide-btn primary" onClick=${onConfirm}><${Icon} name="check" size=${20} stroke=${2.4} /> All correct</button>
      ${canSortLater && html`<button class="wide-btn plain" onClick=${onSortLater}>Check later (save to inbox)</button>`}
    </div>
  </div>`;
}

function RoomCard({ rv, onPick, onConfirm }) {
  return html`<div class="fc-body">
    <span class="fc-kicker">Room or stage</span>
    <h2>Where’s this for?</h2>
    <p class="fc-sub">For everything on this receipt. You can move single items on the last card.</p>
    <div class="room-grid">
      ${activeRooms().map((r) => html`<button class="room-tile ${rv.roomId === r.id ? 'on' : ''}" onClick=${() => onPick(r.id)}>
        <span class="room-emoji">${roomType(r.type).emoji}</span><span>${r.name}</span>
      </button>`)}
    </div>
    <div class="fc-actions">
      <button class="wide-btn primary" onClick=${onConfirm}><${Icon} name="check" size=${20} stroke=${2.4} /> ${roomById(rv.roomId)?.name || 'Next'}</button>
    </div>
  </div>`;
}

function categoryChips(preferred) {
  const cats = activeCategories();
  const first = [...new Set(preferred)].filter((id) => cats.some((c) => c.id === id));
  return [...first.map((id) => cats.find((c) => c.id === id)), ...cats.filter((c) => !first.includes(c.id))]
    .map((c) => ({ value: c.id, label: c.isTool ? `🔧 ${c.name}` : c.name }));
}

function ItemCard({ it, card, setItem, onPicked, onConfirm }) {
  const amount = parseMoney(it.amountText);
  const chips = useMemo(() => categoryChips([it.categoryId, ...(it.alternatives || [])].filter(Boolean)), [it.id]);
  return html`<div class="fc-body">
    <span class="fc-kicker">Not sure about ${card.of === 1 ? 'one item' : `item ${card.n} of ${card.of}`}</span>
    <h2>${it.categoryId ? 'Is this right?' : 'What is this?'}</h2>
    <div class="fc-item">
      <input class="fc-item-desc" value=${it.description} aria-label="Item"
        onInput=${(e) => setItem(it.id, { description: e.currentTarget.value })} />
      <span class="fc-item-amount">${amount != null ? formatMoney(amount) : ''}</span>
    </div>
    ${it.ocrConfidence < 70 && html`<p class="fc-sub">The writing was hard to read. Fix the name if it’s wrong.</p>`}
    <div class="fc-field">
      <span class="fc-label">Category</span>
      <${Chips} wrap items=${chips} value=${it.categoryId}
        onChange=${(categoryId) => { setItem(it.id, { categoryId, isTool: !!categoryById(categoryId)?.isTool, confidence: 'high' }); onPicked(); }} />
    </div>
    <div class="field-row">
      <span class="tool-label"><${Icon} name="wrench" size=${18} /> Tool <small>reusable across the reno</small></span>
      <${Switch} label="Tool" checked=${it.isTool} onChange=${(isTool) => setItem(it.id, { isTool })} />
    </div>
    <div class="fc-actions">
      <button class="wide-btn primary" disabled=${!it.categoryId} onClick=${onConfirm}><${Icon} name="check" size=${20} stroke=${2.4} /> Correct</button>
    </div>
  </div>`;
}

function CategoryCard({ rv, set, onPicked, onConfirm }) {
  const chips = useMemo(() => categoryChips([rv.wholeCategoryId].filter(Boolean)), []);
  return html`<div class="fc-body">
    <span class="fc-kicker">Category</span>
    <h2>What kind of purchase?</h2>
    <p class="fc-sub">No separate items were found, so this sets the whole receipt.</p>
    <${Chips} wrap items=${chips} value=${rv.wholeCategoryId}
      onChange=${(id) => { set({ wholeCategoryId: id, wholeIsTool: !!categoryById(id)?.isTool }); onPicked(); }} />
    <div class="field-row">
      <span class="tool-label"><${Icon} name="wrench" size=${18} /> Tool</span>
      <${Switch} label="Tool" checked=${rv.wholeIsTool} onChange=${(wholeIsTool) => set({ wholeIsTool })} />
    </div>
    <div class="fc-actions">
      <button class="wide-btn primary" disabled=${!rv.wholeCategoryId} onClick=${onConfirm}><${Icon} name="check" size=${20} stroke=${2.4} /> Correct</button>
    </div>
  </div>`;
}

function itemsTotal(rv) {
  return rv.items.reduce((s, it) => s + (parseMoney(it.amountText) ?? 0), 0);
}

function SummaryRow({ it, rv, setItem, onRemove }) {
  const [open, setOpen] = useState(false);
  const cat = categoryById(it.categoryId);
  const room = roomById(it.roomId || rv.roomId);
  const amount = parseMoney(it.amountText);
  return html`<div class="sum-row ${open ? 'open' : ''}">
    <button class="sum-main" onClick=${() => setOpen(!open)}>
      <span class="sum-text">
        <span class="sum-desc">${it.description || 'Item'}</span>
        <small>${cat?.name || 'No category'}${it.roomId && it.roomId !== rv.roomId ? ` · ${roomType(room?.type).emoji} ${room?.name}` : ''}${it.isTool ? ' · 🔧 Tool' : ''}</small>
      </span>
      <strong class=${amount < 0 ? 'neg' : ''}>${formatMoney(amount ?? 0)}</strong>
    </button>
    ${open && html`<div class="sum-edit">
      <input value=${it.description} aria-label="Item" onInput=${(e) => setItem(it.id, { description: e.currentTarget.value })} />
      <div class="split-selects">
        <span class="fc-money small"><span>$</span><input inputmode="decimal" value=${it.amountText} aria-label="Amount"
          onInput=${(e) => setItem(it.id, { amountText: e.currentTarget.value })} /></span>
        <select value=${it.categoryId || ''} aria-label="Category"
          onChange=${(e) => setItem(it.id, { categoryId: e.currentTarget.value, isTool: !!categoryById(e.currentTarget.value)?.isTool })}>
          <option value="" disabled>Category…</option>
          ${activeCategories().map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      </div>
      <div class="split-selects">
        <select value=${it.roomId || rv.roomId} aria-label="Room" onChange=${(e) => setItem(it.id, { roomId: e.currentTarget.value })}>
          ${activeRooms().map((r) => html`<option value=${r.id}>${roomType(r.type).emoji} ${r.name}</option>`)}
        </select>
        <label class="inline-switch"><${Icon} name="wrench" size=${16} /> Tool
          <${Switch} label="Tool" checked=${it.isTool} onChange=${(isTool) => setItem(it.id, { isTool })} /></label>
      </div>
      <button class="link-btn small danger-text" onClick=${onRemove}><${Icon} name="trash" size=${16} /> Remove this item</button>
    </div>`}
  </div>`;
}

function SummaryCard({ rv, set, setItem, totalCents, onSave, onEditAll }) {
  const room = roomById(rv.roomId);
  const sum = itemsTotal(rv);
  const remainder = (totalCents ?? 0) - sum;
  const hasItems = rv.items.length > 0;
  const missingCategory = hasItems ? rv.items.some((it) => !it.categoryId && !it.isDiscount) : !rv.wholeCategoryId;
  const over = hasItems && remainder < 0;
  const removeItem = (id) => set((cur) => ({ items: cur.items.filter((it) => it.id !== id) }));

  return html`<div class="fc-body summary">
    <span class="fc-kicker">Last step</span>
    <h2>All set?</h2>
    <p class="fc-sub"><strong>${rv.store || 'No store'}</strong> · ${formatDate(rv.date)} · <strong>${formatMoney(totalCents ?? 0)}</strong>
      <br />${room ? `${roomType(room.type).emoji} ${room.name}` : ''}</p>
    <div class="sum-list">
      ${hasItems ? rv.items.map((it) => html`<${SummaryRow} key=${it.id} it=${it} rv=${rv} setItem=${setItem} onRemove=${() => removeItem(it.id)} />`)
        : html`<div class="sum-row"><div class="sum-main static">
            <span class="sum-text"><span class="sum-desc">Whole receipt</span>
              <small>${categoryById(rv.wholeCategoryId)?.name || 'No category'}${rv.wholeIsTool ? ' · 🔧 Tool' : ''}</small></span>
            <strong>${formatMoney(totalCents ?? 0)}</strong></div></div>`}
      ${hasItems && remainder > 0 && html`<div class="sum-row extra"><div class="sum-main static">
        <span class="sum-text"><span class="sum-desc">Other items on the receipt</span>
          <small>Not read clearly · ${categoryById(mostCommonCategory(rv.items))?.name || 'Other'}</small></span>
        <strong>${formatMoney(remainder)}</strong></div></div>`}
    </div>
    ${hasItems && html`<div class="sum-check ${over ? 'warn' : 'ok'}">
      ${over ? html`<${Icon} name="alert" size=${16} /> Items add up to ${formatMoney(-remainder)} more than the total. Tap one to fix it.`
        : remainder > 0 ? html`<${Icon} name="info" size=${16} /> ${formatMoney(remainder)} wasn’t matched to an item and is added as “Other items”.`
          : html`<${Icon} name="check" size=${16} stroke=${2.4} /> Items add up to the total`}
    </div>`}
    <div class="fc-actions">
      <button class="wide-btn primary" disabled=${over || missingCategory} onClick=${onSave}>Save expense</button>
      ${over && html`<button class="wide-btn secondary" onClick=${() => set({ items: [], wholeCategoryId: mostCommonCategory(rv.items) })}>Save as one total instead</button>`}
      <button class="wide-btn plain" onClick=${onEditAll}>Edit all details</button>
    </div>
  </div>`;
}

// ---------- Turning the review into an expense ----------

function buildRecord(rv) {
  const totalCents = parseMoney(rv.totalText);
  let lines;
  if (rv.items.length) {
    lines = rv.items.map((it) => ({
      id: it.id,
      description: it.description.trim(),
      amountCents: parseMoney(it.amountText) ?? 0,
      categoryId: it.categoryId || mostCommonCategory(rv.items), // discounts follow the main category
      roomId: it.roomId || rv.roomId,
      isTool: !!it.isTool,
    }));
    const remainder = (totalCents ?? 0) - lines.reduce((s, l) => s + l.amountCents, 0);
    if (remainder > 0) {
      lines.push({
        id: uid(), description: 'Other items on the receipt', amountCents: remainder, categoryId: mostCommonCategory(rv.items),
        roomId: rv.roomId, isTool: false, auto: true, // auto: not a real item, so it isn't learned from
      });
    }
  } else {
    lines = [{ id: uid(), amountCents: totalCents ?? 0, categoryId: rv.wholeCategoryId, roomId: rv.roomId, isTool: !!rv.wholeIsTool }];
  }
  const named = rv.items.filter((it) => !it.isDiscount && it.description.trim());
  const record = {
    ...rv.expense,
    status: 'filed',
    store: rv.store.trim(),
    date: rv.date,
    totalCents,
    gstMode: rv.gstFound && totalCents && Math.abs(rv.gstCents - gstFromTotal(totalCents, gstRate())) > 2 ? 'custom' : 'auto',
    gstCents: rv.gstFound ? rv.gstCents : null,
    description: rv.expense.description || (named.length ? `${named[0].description}${named.length > 1 ? ` + ${named.length - 1} more` : ''}` : ''),
    lines,
    fileIds: [...rv.expense.fileIds, ...rv.pendingFiles.map((f) => f.id).filter((id) => !rv.expense.fileIds.includes(id))],
    receiptText: rv.receiptText || rv.expense.receiptText || '',
  };
  delete record.scan;
  return record;
}
