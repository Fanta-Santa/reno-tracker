// Quotes: log a quote, flick it between Quoted → Accepted → Paid with one tap (or a swipe), record deposits
// and payments (each becomes an expense), and compare what was quoted with what it actually cost.

import { html, useEffect, useMemo, useState } from '../lib.js';
import {
  state, useStore, activeRooms, activeCategories, roomById, categoryById, storeByName, blankExpense, blankQuote,
  saveQuote, setQuoteStatus, deleteQuote, saveItem, uid,
} from '../store.js';
import { addDays, centsToInput, daysBetween, formatDate, formatMoney, parseMoney, splitByWeights, todayISO } from '../format.js';
import { roomType } from '../defaults.js';
import { quoteParts, quoteProgress, quoteTotals } from '../stats.js';
import { prepareFile } from '../images.js';
import { suggestCategory, breakdownFromItems } from '../reader/categorize.js';
import { scanFiles, readerEnabled } from '../reader/queue.js';
import {
  Page, Group, Row, EmptyState, Chips, Segmented, Switch, Thumb, SwipeRow, openSheet, SheetHeader, toast, toastUndo,
  withBusy, pickFiles,
} from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { navigate, goBack } from '../ui/router.js';
import { openViewer } from '../ui/viewer.js';
import { openExpenseForm } from './expense-form.js';
import { openCategoryEditor } from './editors.js';

const STATUS_LABEL = { quoted: 'Quoted', accepted: 'Accepted', paid: 'Paid', declined: 'Declined' };
const STATUS_OPTIONS = [
  { value: 'quoted', label: 'Quoted' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'paid', label: 'Paid' },
];

const quoteTitle = (q) => q.supplier || q.description || 'Quote';

/**
 * When a payment is due, in words, with a status for its badge: overdue ('over'), due within a week ('near'),
 * or later ('none'). days: from today (negative = overdue).
 */
export function dueText(days, iso) {
  if (days < 0) return { text: `Overdue by ${-days} ${days === -1 ? 'day' : 'days'}`, status: 'over' };
  if (days === 0) return { text: 'Due today', status: 'near' };
  if (days === 1) return { text: 'Due tomorrow', status: 'near' };
  if (days <= 7) return { text: `Due in ${days} days`, status: 'near' };
  return { text: `Due ${formatDate(iso)}`, status: 'none' };
}
const isOpen = (q) => q.status === 'quoted' || q.status === 'accepted';
const dueFor = (q) => (q.dueDate && isOpen(q) ? dueText(daysBetween(todayISO(), q.dueDate), q.dueDate) : null);

// ---------- Payments ----------

/**
 * Opens the expense form filled in from the quote. final: this payment finishes the quote (it's marked Paid);
 * otherwise it's a deposit or progress payment (marked Paid automatically once the full amount is covered).
 * A quote that covers several categories splits each payment across them, in proportion.
 */
export function openPaymentForm(quote, { final }) {
  const left = quoteProgress(quote, state.expenses).left;
  const parts = quoteParts(quote);
  const shares = parts.map((pt) => pt.amountCents);
  const totalCents = final ? left || quote.amountCents : null;
  const amounts = totalCents != null ? splitByWeights(totalCents, shares) : shares.map(() => null);
  const expense = {
    ...blankExpense(),
    store: quote.supplier,
    description: quote.description ? `${quote.description} (${final ? 'final payment' : 'payment'})` : (final ? 'Final payment' : 'Payment'),
    totalCents,
    quoteId: quote.id,
    lines: parts.map((pt, i) => ({
      id: uid(), roomId: quote.roomId, categoryId: pt.categoryId, amountCents: amounts[i], isTool: !!categoryById(pt.categoryId)?.isTool,
    })),
  };
  openExpenseForm({
    expense,
    shares: parts.length > 1 ? shares : null,
    title: final ? 'Final payment' : 'Record a payment',
    onSaved: async () => {
      const current = state.quotes.find((q) => q.id === quote.id);
      const covered = quoteProgress({ ...current, status: 'accepted' }, state.expenses).left === 0;
      const next = final || covered ? 'paid' : current.status === 'quoted' ? 'accepted' : current.status;
      return next !== current.status ? setQuoteStatus(quote.id, next) : null;
    },
  });
}

/** Changes status from the toggle or a swipe. Choosing Paid with money still owed asks for the final payment. */
export async function changeStatus(quote, status) {
  if (status === quote.status) return;
  if (status === 'paid') {
    const { left } = quoteProgress(quote, state.expenses);
    if (left > 0) {
      openPaymentForm(quote, { final: true });
      return;
    }
  }
  const undo = await withBusy('Saving…', () => setQuoteStatus(quote.id, status));
  if (undo) toastUndo(`${quoteTitle(quote)}: ${STATUS_LABEL[status].toLowerCase()}`, undo);
}

// ---------- Pieces ----------

/** Quoted vs actual for a paid quote: an arrow and words, not colour alone. */
function Comparison({ diff, amount }) {
  if (diff == null) return null;
  if (diff === 0) return html`<span class="q-diff even"><${Icon} name="check" size=${14} stroke=${2.6} />Exactly as quoted</span>`;
  const pct = amount ? Math.round((Math.abs(diff) / amount) * 100) : 0;
  return diff > 0
    ? html`<span class="q-diff over">▲ ${formatMoney(diff, { whole: true })} over the quote${pct ? ` (${pct}%)` : ''}</span>`
    : html`<span class="q-diff under">▼ ${formatMoney(-diff, { whole: true })} under the quote${pct ? ` (${pct}%)` : ''}</span>`;
}

function StatusToggle({ quote }) {
  if (quote.status === 'declined') {
    return html`<div class="q-declined" onClick=${(e) => e.stopPropagation()}>
      <span>Declined</span>
      <button class="link-btn small" onClick=${() => changeStatus(quote, 'quoted')}>Restore</button>
    </div>`;
  }
  return html`<div class="q-toggle" onClick=${(e) => e.stopPropagation()} onPointerDown=${(e) => e.stopPropagation()}>
    <${Segmented} small value=${quote.status} options=${STATUS_OPTIONS} onChange=${(s) => changeStatus(quote, s)} />
  </div>`;
}

function QuoteCard({ quote }) {
  const p = quoteProgress(quote, state.expenses);
  const due = dueFor(quote);
  const room = roomById(quote.roomId);
  const next = { quoted: ['accepted', 'Accept', 'check'], accepted: ['paid', 'Paid', 'check'], paid: ['accepted', 'Reopen', 'restore'], declined: ['quoted', 'Restore', 'restore'] }[quote.status];
  const actions = [{ label: next[1], icon: next[2], tone: 'accent', onAction: () => changeStatus(quote, next[0]) }];
  if (quote.status === 'quoted' || quote.status === 'accepted') actions.push({ label: 'Decline', icon: 'x', tone: 'danger', onAction: () => changeStatus(quote, 'declined') });
  return html`<${SwipeRow} onTap=${() => navigate(`/quotes/${quote.id}`)} actions=${actions}>
    <div class="q-card s-${quote.status}">
      <div class="q-top">
        ${quote.fileIds[0] ? html`<${Thumb} fileId=${quote.fileIds[0]} size=${44} />` : html`<span class="q-icon">${room ? roomType(room.type).emoji : '📝'}</span>`}
        <div class="q-main">
          <strong>${quoteTitle(quote)}</strong>
          <small>${[quote.supplier && quote.description, room?.name].filter(Boolean).join(' · ') || formatDate(quote.date)}</small>
        </div>
        <div class="q-amount"><strong>${formatMoney(quote.amountCents, { whole: true })}</strong><small>${formatDate(quote.date)}</small></div>
      </div>
      ${due && html`<span class="tag due s-${due.status}"><${Icon} name="calendar" size=${12} stroke=${2.2} />${due.text}</span>`}
      <${StatusToggle} quote=${quote} />
      ${quote.status === 'accepted' && html`<div class="q-progress">
        <span class="meter small"><span style=${`width:${Math.min(100, p.pct * 100)}%`} /></span>
        <small>${p.paid ? `Paid ${formatMoney(p.paid, { whole: true })} of ${formatMoney(quote.amountCents, { whole: true })} · ` : ''}${formatMoney(p.outstanding, { whole: true })} still to pay</small>
      </div>`}
      ${quote.status === 'paid' && html`<div class="q-progress"><small>Actual ${formatMoney(p.paid, { whole: true })}</small><${Comparison} diff=${p.diff} amount=${quote.amountCents} /></div>`}
    </div>
  <//>`;
}

// ---------- Quotes screen ----------

export function QuotesView() {
  useStore();
  const [showDeclined, setShowDeclined] = useState(false);
  const t = useMemo(() => quoteTotals(state.quotes, state.expenses), [state.quotes, state.expenses]);
  const groups = [
    ['quoted', 'Waiting on you', 'Tap Accepted when you go ahead with one.'],
    ['accepted', 'Accepted', 'Counted as committed on the dashboard until paid.'],
    ['paid', 'Paid', null],
  ];
  const declined = state.quotes.filter((q) => q.status === 'declined');

  return html`<${Page} title="Quotes" subtitle=${state.quotes.length ? `${state.quotes.length} ${state.quotes.length === 1 ? 'quote' : 'quotes'}` : null}
    actions=${html`<button class="nav-icon-btn" onClick=${() => openQuoteForm()} aria-label="Add a quote"><${Icon} name="plus" /></button>`}>
    ${!state.quotes.length ? html`<${EmptyState} emoji="📝" title="No quotes yet"
        text="Log quotes from tradies and suppliers (and bills to pay), flick them to Accepted when you go ahead, add when payments are due, then record payments as you make them.">
        <button class="wide-btn primary" onClick=${() => openQuoteForm()}>Add a quote</button>
      <//>`
      : html`<div class="glass-card q-summary">
        <div><small>Still to pay</small><strong>${formatMoney(t.committed, { whole: true })}</strong><span>${t.acceptedCount} accepted</span></div>
        <div><small>Waiting on you</small><strong>${formatMoney(t.quoted, { whole: true })}</strong><span>${t.quotedCount} quoted</span></div>
        <div><small>Paid on quotes</small><strong>${formatMoney(t.paid, { whole: true })}</strong>
          ${t.paidCount ? html`<${Comparison} diff=${t.paidDiff} amount=${t.paidQuoted} />` : html`<span>none yet</span>`}</div>
      </div>
      ${groups.map(([status, title, footer]) => {
        const list = state.quotes.filter((q) => q.status === status);
        return list.length > 0 && html`<${Group} title=${title} footer=${footer} key=${status}>
          ${list.map((q) => html`<${QuoteCard} key=${q.id} quote=${q} />`)}
        <//>`;
      })}
      ${declined.length > 0 && html`<button class="link-btn" onClick=${() => setShowDeclined(!showDeclined)}>
        ${showDeclined ? 'Hide' : 'Show'} ${declined.length} declined</button>`}
      ${showDeclined && declined.length > 0 && html`<${Group} title="Declined">${declined.map((q) => html`<${QuoteCard} key=${q.id} quote=${q} />`)}<//>`}
      <p class="hint-text">Tip: swipe a quote left to move it to the next step.</p>`}
  <//>`;
}

// ---------- Quote detail ----------

export function QuoteDetailView({ id }) {
  useStore();
  const quote = state.quotes.find((q) => q.id === id);
  if (!quote) {
    return html`<${Page} title="Quote" back=${{ label: 'Quotes', to: '/quotes' }}><${EmptyState} emoji="🫥" title="This quote was deleted" /><//>`;
  }
  const p = quoteProgress(quote, state.expenses);
  const room = roomById(quote.roomId);
  const category = categoryById(quote.categoryId);
  const parts = quoteParts(quote);
  const remove = async () => {
    const undo = await withBusy('Deleting…', () => deleteQuote(quote.id));
    if (!undo) return;
    goBack('/quotes');
    toastUndo('Quote deleted', undo);
  };

  return html`<${Page} title=${quoteTitle(quote)} back=${{ label: 'Quotes', to: '/quotes' }}
    actions=${html`<button class="nav-text-btn" onClick=${() => openQuoteForm(quote)}>Edit</button>`}>
    ${quote.fileIds.length > 0 && html`<div class="receipt-gallery">
      ${quote.fileIds.map((fid, i) => html`<button class="receipt-big" key=${fid} onClick=${() => openViewer(quote.fileIds, i)} aria-label="View quote">
        <${Thumb} fileId=${fid} size=${150} radius=${16} />
      </button>`)}
    </div>`}

    <div class="detail-hero">
      <div class="detail-amount">${formatMoney(quote.amountCents)}</div>
      <div class="detail-meta">Quoted ${formatDate(quote.date)}${quote.acceptedAt ? ` · accepted ${formatDate(new Date(quote.acceptedAt).toISOString().slice(0, 10))}` : ''}</div>
    </div>
    <${StatusToggle} quote=${quote} />

    ${(quote.status === 'accepted' || quote.status === 'paid') && html`<div class="glass-card q-pay">
      <div class="q-pay-row"><span>Paid so far</span><strong>${formatMoney(p.paid)}</strong></div>
      ${quote.status === 'accepted' && html`<div class="q-pay-row"><span>Still to pay</span><strong>${formatMoney(p.outstanding)}</strong></div>`}
      <span class="meter"><span style=${`width:${Math.min(100, p.pct * 100)}%`} /></span>
      ${quote.status === 'paid' && html`<${Comparison} diff=${p.diff} amount=${quote.amountCents} />`}
      ${quote.status === 'accepted' && html`<div class="button-row">
        <button class="pill-btn" onClick=${() => openPaymentForm(quote, { final: false })}><${Icon} name="plus" size=${16} /> Add payment</button>
        <button class="pill-btn" onClick=${() => changeStatus(quote, 'paid')}><${Icon} name="check" size=${16} /> Final payment</button>
      </div>`}
    </div>`}

    ${p.payments.length > 0 && html`<${Group} title="Payments">
      ${p.payments.map((e) => html`<${Row} key=${e.id} icon="receipt" iconBg="#2a78d6" label=${html`${e.description || e.store || 'Payment'}<small>${formatDate(e.date)}</small>`}
        detail=${formatMoney(e.totalCents)} onClick=${() => navigate(`/expenses/${e.id}`)} />`)}
    <//>`}

    <${Group} title="Details">
      <${Row} icon="store" iconBg="#FF8A3D" label="Supplier" detail=${quote.supplier || '—'} />
      ${dueFor(quote) && html`<${Row} icon="calendar" iconBg=${dueFor(quote).status === 'over' ? '#d03b3b' : '#FF8A3D'} label="Next payment due"
        detail=${dueFor(quote).status === 'none' ? formatDate(quote.dueDate) : `${formatDate(quote.dueDate)} · ${dueFor(quote).text.replace(/^Due /, '')}`} />`}
      ${quote.description && html`<${Row} icon="tag" iconBg="#7A5CF0" label="For" detail=${quote.description} />`}
      <${Row} icon=${room ? roomType(room.type).emoji : '❔'} label="Room or stage" detail=${room?.name || '—'} />
      ${parts.length < 2 && html`<${Row} icon="quote" iconBg="#8C7A9E" label="Category" detail=${category?.name || '—'} />`}
    <//>
    ${parts.length > 1 && html`<${Group} title="Breakdown" footer="Payments are split across these in proportion.">
      ${parts.map((pt) => html`<${Row} key=${pt.categoryId} label=${categoryById(pt.categoryId)?.name || 'Other'} detail=${formatMoney(pt.amountCents)} />`)}
    <//>`}
    ${quote.notes && html`<${Group} title="Notes"><p class="notes">${quote.notes}</p><//>`}

    <div class="form-footer">
      ${quote.status !== 'declined' && quote.status !== 'paid' && html`<button class="wide-btn secondary" onClick=${() => changeStatus(quote, 'declined')}>Decline this quote</button>`}
      <button class="wide-btn danger" onClick=${remove}><${Icon} name="trash" size=${20} /> Delete quote</button>
    </div>
  <//>`;
}

// ---------- Add / edit a quote ----------

export function openQuoteForm(quote) {
  openSheet(({ close }) => html`<${QuoteForm} quote=${quote || blankQuote()} close=${close} />`, { full: true, dismissible: false });
}

function QuoteForm({ quote, close }) {
  useStore();
  const isNew = !state.quotes.some((q) => q.id === quote.id);
  const rooms = activeRooms();
  const [q, setQ] = useState(() => {
    const parts = quote.parts?.length > 1 ? quote.parts : null;
    const main = quote.categoryId || activeCategories().find((c) => /trade|labou?r/i.test(c.name))?.id;
    return {
      ...quote,
      amountText: centsToInput(quote.amountCents),
      roomId: quote.roomId || rooms.find((r) => r.id === state.prefs.lastRoomId)?.id || rooms[0]?.id || null,
      // Several categories when the quote covers more than one (e.g. labour, equipment and freight). The first is
      // the main one: it gets whatever the others don't.
      categoryIds: parts ? parts.map((pt) => pt.categoryId) : [main].filter(Boolean),
      partTexts: parts ? Object.fromEntries(parts.slice(1).map((pt) => [pt.categoryId, centsToInput(pt.amountCents)])) : {},
    };
  });
  const [files, setFiles] = useState(quote.fileIds.map((id) => ({ id })));
  const [removed, setRemoved] = useState([]);
  const [reading, setReading] = useState(false);
  const set = (patch) => setQ((cur) => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));

  const urls = useMemo(() => new Map(files.filter((f) => f.pending?.thumb).map((f) => [f.id, URL.createObjectURL(f.pending.thumb)])), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const suggest = (description, supplier) => {
    const s = suggestCategory(description || '', { categories: state.categories, learned: state.learned, storeName: supplier, storeCategoryId: storeByName(supplier)?.defaultCategoryId });
    return s.confidence !== 'low' ? s.categoryId : null;
  };

  /** Reads an attached quote (on the phone) and fills in anything still blank, including a split by category. */
  const readQuote = async (prepared) => {
    if (!readerEnabled()) return;
    setReading(true);
    try {
      const { result } = await scanFiles(prepared);
      let filled = false;
      let split = 0;
      setQ((cur) => {
        const patch = {};
        if (!cur.supplier && result.store.value) { patch.supplier = storeByName(result.store.value)?.name || result.store.value; filled = true; }
        if (!parseMoney(cur.amountText) && result.total.cents) { patch.amountText = centsToInput(result.total.cents); filled = true; }
        if (result.date.found && cur.date === quote.date) { patch.date = result.date.value; filled = true; }
        if (!cur.description && result.items.length === 1) { patch.description = result.items[0].description; filled = true; }
        const parts = cur.categoryIds.length <= 1 && breakdownFromItems(result.items, parseMoney(patch.amountText ?? cur.amountText),
          { categories: state.categories, learned: state.learned, storeName: patch.supplier ?? cur.supplier });
        if (parts) {
          patch.categoryIds = parts.map((pt) => pt.categoryId);
          patch.partTexts = Object.fromEntries(parts.slice(1).map((pt) => [pt.categoryId, centsToInput(pt.amountCents)]));
          split = parts.length;
          filled = true;
        }
        return { ...cur, ...patch };
      });
      if (filled) toast(`Filled in from the quote${split ? `, split across ${split} categories` : ''}. Check the details.`, { icon: 'check' });
    } catch (err) {
      console.warn('Reading the quote failed', err);
    } finally {
      setReading(false);
    }
  };

  const addFiles = async (kind) => {
    const picked = await pickFiles(kind, { multiple: kind !== 'camera' });
    if (!picked.length) return;
    const prepared = await withBusy('Preparing…', () => Promise.all(picked.map(prepareFile)));
    if (!prepared) return;
    setFiles((cur) => [...cur, ...prepared.map((p) => ({ id: p.id, pending: p }))]);
    readQuote(prepared);
  };
  const removeFile = (id) => {
    setFiles((cur) => cur.filter((f) => f.id !== id));
    if (!files.find((f) => f.id === id)?.pending) setRemoved((r) => [...r, id]);
  };

  // The breakdown: amounts typed for the extra categories; the main one gets the rest.
  const amountCents = parseMoney(q.amountText);
  const extras = q.categoryIds.slice(1).map((id) => ({ categoryId: id, amountCents: parseMoney(q.partTexts[id] || '') }));
  const rest = (amountCents ?? 0) - extras.reduce((sum, pt) => sum + (pt.amountCents ?? 0), 0);
  const setPart = (id, text) => set((cur) => ({ partTexts: { ...cur.partTexts, [id]: text } }));
  const addCategory = () => openCategoryEditor({
    category: {},
    onSave: async (category) => {
      const record = await withBusy('Saving…', () => saveItem('categories', category));
      if (record) set((cur) => ({ categoryIds: [...cur.categoryIds, record.id] }));
    },
  });

  const save = async () => {
    if (!q.supplier.trim()) return toast('Who is the quote from?', { icon: 'alert' });
    if (!amountCents) return toast('Enter the quoted amount.', { icon: 'alert' });
    if (!q.roomId) return toast('Choose a room or stage.', { icon: 'alert' });
    const blank = extras.find((pt) => !pt.amountCents);
    if (blank) return toast(`Enter the amount for ${categoryById(blank.categoryId)?.name || 'each category'}, or untap it.`, { icon: 'alert' });
    if (extras.length && rest <= 0) return toast('The breakdown adds up to more than the quoted amount.', { icon: 'alert' });
    const record = {
      ...quote,
      supplier: q.supplier.trim(),
      description: q.description.trim(),
      amountCents,
      roomId: q.roomId,
      categoryId: q.categoryIds[0] ?? null,
      parts: extras.length ? [{ categoryId: q.categoryIds[0], amountCents: rest }, ...extras] : null,
      date: q.date,
      notes: q.notes.trim(),
      fileIds: files.map((f) => f.id),
      dueDate: q.dueDate || null,
    };
    const undo = await withBusy('Saving…', () => saveQuote(record, { newFiles: files.filter((f) => f.pending).map((f) => f.pending), removedFileIds: removed }));
    if (!undo) return;
    close();
    toastUndo(isNew ? 'Quote added' : 'Quote saved', undo);
  };

  const roomItems = rooms.map((r) => ({ value: r.id, label: r.name, emoji: roomType(r.type).emoji }));
  const categoryItems = state.categories.filter((c) => !c.archived || q.categoryIds.includes(c.id)).map((c) => ({ value: c.id, label: c.name }));
  const categoryName = (id) => categoryById(id)?.name || 'Other';

  return html`<${SheetHeader} title=${isNew ? 'New quote' : 'Edit quote'} onCancel=${close} onDone=${save} doneLabel="Save" />
  <div class="sheet-body form">
    <div class="receipt-strip">
      ${files.map((f, i) => html`<div class="receipt-tile" key=${f.id}>
        <button class="receipt-tile-img" onClick=${() => openViewer(files.map((x) => x.pending || x.id), i)} aria-label="View attachment">
          ${f.pending ? (f.pending.thumb ? html`<img src=${urls.get(f.id)} alt="" />` : html`<span class="pdf-tile"><${Icon} name="doc" />PDF</span>`)
            : html`<${Thumb} fileId=${f.id} size=${76} radius=${14} />`}
        </button>
        <button class="receipt-tile-x" onClick=${() => removeFile(f.id)} aria-label="Remove attachment"><${Icon} name="x" size=${14} stroke=${2.6} /></button>
      </div>`)}
      <button class="receipt-add" onClick=${() => addFiles('camera')}><${Icon} name="camera" /><span>Camera</span></button>
      <button class="receipt-add" onClick=${() => addFiles('file')}><${Icon} name="upload" /><span>PDF / photo</span></button>
      ${reading && html`<span class="reading-note"><span class="spinner tiny" /> Reading…</span>`}
    </div>

    <div class="amount-card">
      <label class="amount-label" for="quote-amount">Quoted amount (incl. GST)</label>
      <div class="amount-input"><span>$</span>
        <input id="quote-amount" inputmode="decimal" placeholder="0.00" autocomplete="off" value=${q.amountText}
          onInput=${(e) => set({ amountText: e.currentTarget.value })}
          onBlur=${() => { const c = parseMoney(q.amountText); if (c != null) set({ amountText: centsToInput(c) }); }} />
      </div>
    </div>

    <div class="form-group">
      <label class="field">
        <span class="field-label">From (tradie or supplier)</span>
        <input type="text" placeholder="e.g. Pete's Plumbing" value=${q.supplier} autocomplete="off"
          onInput=${(e) => set({ supplier: e.currentTarget.value })}
          onBlur=${() => set((cur) => (cur.categoryIds.length ? {} : { categoryIds: [suggest(cur.description, cur.supplier)].filter(Boolean) }))} />
      </label>
      ${state.stores.length > 0 && html`<div class="field-chips">
        <${Chips} items=${state.stores.map((s) => ({ value: s.name, label: s.name }))}
          value=${state.stores.find((s) => s.name.toLowerCase() === q.supplier.trim().toLowerCase())?.name}
          onChange=${(supplier) => set({ supplier })} />
      </div>`}
      <label class="field">
        <span class="field-label">What for?</span>
        <input type="text" placeholder="e.g. Rough-in and fit-off plumbing" value=${q.description}
          onInput=${(e) => set({ description: e.currentTarget.value })}
          onBlur=${() => set((cur) => { const c = cur.categoryIds.length < 2 && suggest(cur.description, cur.supplier); return c ? { categoryIds: [c] } : {}; })} />
      </label>
      <label class="field">
        <span class="field-label">Date of quote</span>
        <input type="date" value=${q.date} onInput=${(e) => set({ date: e.currentTarget.value })} />
      </label>
    </div>

    <div class="form-group">
      <div class="field-block">
        <span class="field-label">Room / stage</span>
        <${Chips} wrap items=${roomItems} value=${q.roomId} onChange=${(roomId) => set({ roomId })} />
      </div>
      <div class="field-block">
        <span class="field-label">Category <small>Covers more than one, like labour and freight? Tap each.</small></span>
        <${Chips} wrap multi items=${categoryItems} value=${q.categoryIds} onChange=${(categoryIds) => set({ categoryIds })}>
          <button type="button" class="chip add-chip" onClick=${addCategory}><${Icon} name="plus" size=${14} stroke=${2.4} />New</button>
        <//>
      </div>
      ${q.categoryIds.length > 1 && html`<div class="field-block q-parts">
        <span class="field-label">Breakdown</span>
        ${extras.map((pt) => html`<label class="q-part" key=${pt.categoryId}>
          <span class="q-part-name">${categoryName(pt.categoryId)}</span>
          <span class="split-amount"><span>$</span>
            <input inputmode="decimal" placeholder="0.00" aria-label=${`${categoryName(pt.categoryId)} amount`} value=${q.partTexts[pt.categoryId] || ''}
              onInput=${(e) => setPart(pt.categoryId, e.currentTarget.value)}
              onBlur=${(e) => { const c = parseMoney(e.currentTarget.value); if (c != null) setPart(pt.categoryId, centsToInput(c)); }} /></span>
        </label>`)}
        <div class="q-part main ${extras.length && rest <= 0 ? 'neg' : ''}">
          <span class="q-part-name">${categoryName(q.categoryIds[0])}<small>the rest</small></span>
          <span class="split-amount readonly"><span>$</span><strong>${centsToInput(rest)}</strong></span>
        </div>
      </div>`}
    </div>

    <div class="form-group">
      <div class="field-row">
        <span class="tool-label"><${Icon} name="calendar" size=${18} /> Payment due <small>Shows on the dashboard, to plan cash flow</small></span>
        <${Switch} label="Payment due" checked=${!!q.dueDate} onChange=${(on) => set({ dueDate: on ? addDays(todayISO(), 14) : null })} />
      </div>
      ${q.dueDate && html`<label class="field">
        <span class="field-label">Next payment due</span>
        <input type="date" value=${q.dueDate} onInput=${(e) => set({ dueDate: e.currentTarget.value || null })} />
      </label>`}
    </div>

    <div class="form-group">
      <label class="field">
        <span class="field-label">Notes</span>
        <textarea rows="3" placeholder="What's included, start date, deposit terms…" value=${q.notes}
          onInput=${(e) => set({ notes: e.currentTarget.value })} />
      </label>
    </div>
  </div>`;
}
