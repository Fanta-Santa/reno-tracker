// Shared building blocks: page layout, slide-up sheets, the Undo bar, switches, chips...

import { html, useEffect, useRef, useState } from '../lib.js';
import { Icon } from './icons.js';
import { goBack } from './router.js';
import { thumbUrl, cachedThumbUrl } from '../store.js';
import { openCamera, useAppCamera } from './camera.js';

// ---------- Tiny pub/sub for the overlays below ----------

function createSignal(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? next(value) : next;
      for (const fn of listeners) fn(value);
    },
    use() {
      const [v, setV] = useState(value);
      useEffect(() => {
        listeners.add(setV);
        setV(value);
        return () => listeners.delete(setV);
      }, []);
      return v;
    },
  };
}

// ---------- Page layout ----------

/**
 * A screen with an iOS-style large title that shrinks into the top bar as you scroll.
 * back: { label, to } shows a back button. actions: buttons on the right of the bar.
 */
export function Page({ title, subtitle, back, actions, children, class: cls = '' }) {
  const sentinel = useRef();
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return html`<div class="page ${cls}">
    <header class="nav-bar ${compact ? 'is-compact' : ''}">
      <div class="nav-side">
        ${back && html`<button class="nav-back" onClick=${() => goBack(back.to)}>
          <${Icon} name="chevronLeft" size=${24} stroke=${2.2} /><span>${back.label}</span>
        </button>`}
      </div>
      <div class="nav-title">${title}</div>
      <div class="nav-side nav-actions">${actions}</div>
    </header>
    <div class="large-title" ref=${sentinel}>
      <h1>${title}</h1>
      ${subtitle && html`<p class="subtitle">${subtitle}</p>`}
    </div>
    <div class="page-body">${children}</div>
  </div>`;
}

/** A rounded, grouped list section like the iOS Settings app. */
export function Group({ title, footer, children, class: cls = '' }) {
  return html`<section class="group ${cls}">
    ${title && html`<h2 class="group-title">${title}</h2>`}
    <div class="group-card">${children}</div>
    ${footer && html`<p class="group-footer">${footer}</p>`}
  </section>`;
}

/** One row in a Group. Pass onClick to make it tappable (with a chevron). */
export function Row({ icon, iconBg, label, detail, onClick, chevron = !!onClick, danger, children, class: cls = '' }) {
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} class="row ${onClick ? 'tappable' : ''} ${danger ? 'danger' : ''} ${cls}" onClick=${onClick}>
    ${icon && html`<span class="row-icon" style=${iconBg ? `background:${iconBg}` : ''}>
      ${/\p{Extended_Pictographic}/u.test(icon) ? icon : html`<${Icon} name=${icon} size=${18} />`}
    </span>`}
    <span class="row-label">${label}</span>
    ${children}
    ${detail != null && html`<span class="row-detail">${detail}</span>`}
    ${chevron && html`<${Icon} name="chevronRight" size=${16} class="row-chevron" stroke=${2.2} />`}
  <//>`;
}

export function EmptyState({ emoji, title, text, children }) {
  return html`<div class="empty">
    <div class="empty-emoji">${emoji}</div>
    <h3>${title}</h3>
    ${text && html`<p>${text}</p>`}
    ${children}
  </div>`;
}

// ---------- Controls ----------

export function Switch({ checked, onChange, label }) {
  return html`<label class="switch">
    <input type="checkbox" role="switch" checked=${checked} aria-label=${label}
      onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span class="switch-track"><span class="switch-thumb" /></span>
  </label>`;
}

/** iOS segmented control. options: [{ value, label }] */
export function Segmented({ options, value, onChange, small }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return html`<div class="segmented ${small ? 'small' : ''}" role="tablist"
    style=${`--count:${options.length};--index:${index}`}>
    <span class="segmented-thumb" />
    ${options.map((o) => html`<button role="tab" aria-selected=${o.value === value}
      class=${o.value === value ? 'active' : ''} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

/**
 * A row of tappable pills. items: [{ value, label, emoji }].
 * With multi, value is an array and taps toggle items.
 */
export function Chips({ items, value, onChange, multi, wrap, allowNone }) {
  const isOn = (v) => (multi ? (value || []).includes(v) : value === v);
  const tap = (v) => {
    if (multi) onChange(isOn(v) ? value.filter((x) => x !== v) : [...(value || []), v]);
    else onChange(isOn(v) && allowNone ? null : v);
  };
  return html`<div class="chips ${wrap ? 'wrap' : ''}">
    ${items.map((it) => html`<button type="button" class="chip ${isOn(it.value) ? 'on' : ''}" onClick=${() => tap(it.value)}>
      ${it.emoji && html`<span class="chip-emoji">${it.emoji}</span>`}${it.label}
    </button>`)}
  </div>`;
}

/** Thumbnail of a saved receipt (photo or first page of a PDF). */
export function Thumb({ fileId, size = 48, radius }) {
  const [url, setUrl] = useState(() => (fileId ? cachedThumbUrl(fileId) : null));
  useEffect(() => {
    let alive = true;
    const cached = fileId ? cachedThumbUrl(fileId) : null;
    if (cached !== undefined) setUrl(cached);
    else thumbUrl(fileId).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [fileId]);
  const style = `width:${size}px;height:${size}px;${radius ? `border-radius:${radius}px` : ''}`;
  if (!fileId) return html`<span class="thumb thumb-empty" style=${style}><${Icon} name="receipt" size=${size * 0.45} /></span>`;
  if (!url) return html`<span class="thumb thumb-empty" style=${style}><${Icon} name="doc" size=${size * 0.45} /></span>`;
  return html`<img class="thumb" src=${url} alt="Receipt" style=${style} loading="lazy" />`;
}

// ---------- Slide-up sheets ----------

const sheets = createSignal([]);
let nextSheetId = 1;

/**
 * Opens a sheet that slides up from the bottom. render({ close }) returns its content.
 * Options: full (nearly full screen), dismissible (tap outside / drag down to close),
 * onClose (called after it closes), variant 'actions' for an iOS action sheet.
 */
export function openSheet(render, { full = false, dismissible = true, onClose, variant } = {}) {
  const id = nextSheetId++;
  toastSignal.set(null); // a new sheet is a new context; don't leave an old message on top of it
  const close = () => {
    sheets.set((list) => list.map((s) => (s.id === id ? { ...s, closing: true } : s)));
    setTimeout(() => {
      sheets.set((list) => list.filter((s) => s.id !== id));
      onClose?.();
    }, 340);
  };
  sheets.set((list) => [...list, { id, render, full, dismissible, close, variant, closing: false }]);
  return close;
}

function Sheet({ render, full, dismissible, close, variant, closing }) {
  const [shown, setShown] = useState(false);
  const panel = useRef();

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Drag the top of the sheet down to close it.
  const onPointerDown = (e) => {
    if (!dismissible || !e.target.closest('[data-drag]')) return;
    const el = panel.current;
    const startY = e.clientY;
    const startT = performance.now();
    let dy = 0;
    el.style.transition = 'none';
    const move = (ev) => {
      dy = Math.max(0, ev.clientY - startY);
      el.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      const velocity = dy / (performance.now() - startT);
      el.style.transition = '';
      el.style.transform = '';
      if (dy > 120 || (dy > 30 && velocity > 0.6)) close();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };

  const open = shown && !closing;
  return html`<div class="sheet-layer ${open ? 'open' : ''} ${variant === 'actions' ? 'is-actions' : ''}">
    <div class="sheet-backdrop" onClick=${dismissible ? close : undefined} />
    <div class="sheet ${full ? 'full' : ''}" ref=${panel} onPointerDown=${onPointerDown} role="dialog" aria-modal="true">
      ${variant !== 'actions' && dismissible && html`<div class="sheet-grabber" data-drag><span /></div>`}
      ${render({ close })}
    </div>
  </div>`;
}

export function SheetHost() {
  const list = sheets.use();
  useEffect(() => {
    const open = list.some((s) => !s.closing);
    document.documentElement.classList.toggle('sheet-open', open);
    // Dim the status bar along with the page behind a sheet (where iOS supports it).
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', open ? '#ababab' : '#fbfbfb');
  }, [list]);
  return list.map((s) => html`<${Sheet} key=${s.id} ...${s} />`);
}

/** A sheet's top bar: Cancel on the left, title, and a bold action on the right. */
export function SheetHeader({ title, onCancel, cancelLabel = 'Cancel', onDone, doneLabel = 'Done', doneDisabled }) {
  return html`<div class="sheet-header" data-drag>
    <button class="text-btn" onClick=${onCancel}>${cancelLabel}</button>
    <div class="sheet-title">${title}</div>
    ${onDone ? html`<button class="text-btn strong" disabled=${doneDisabled} onClick=${onDone}>${doneLabel}</button>`
    : html`<span class="text-btn-spacer" />`}
  </div>`;
}

/**
 * An iOS action sheet. actions: [{ label, icon, onSelect, destructive }].
 * Returns nothing; each action closes the sheet before running.
 */
export function openActions({ title, message, actions }) {
  openSheet(({ close }) => html`<div class="action-sheet">
    <div class="action-group">
      ${(title || message) && html`<div class="action-head">
        ${title && html`<strong>${title}</strong>`}${message && html`<span>${message}</span>`}
      </div>`}
      ${actions.map((a) => html`<button class="action-btn ${a.destructive ? 'danger' : ''}"
        onClick=${() => { close(); a.onSelect(); }}>
        ${a.icon && html`<${Icon} name=${a.icon} size=${22} />`}<span>${a.label}</span>
      </button>`)}
    </div>
    <button class="action-btn action-cancel" onClick=${close}>Cancel</button>
  </div>`, { variant: 'actions' });
}

/** Asks a yes/no question with an action sheet. Resolves true if confirmed. */
export function confirmAction({ title, message, confirmLabel, destructive = true }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(({ close }) => html`<div class="action-sheet">
      <div class="action-group">
        <div class="action-head"><strong>${title}</strong>${message && html`<span>${message}</span>`}</div>
        <button class="action-btn ${destructive ? 'danger' : ''}"
          onClick=${() => { answered = true; close(); resolve(true); }}>${confirmLabel}</button>
      </div>
      <button class="action-btn action-cancel" onClick=${close}>Cancel</button>
    </div>`, { variant: 'actions', onClose: () => !answered && resolve(false) });
  });
}

// ---------- Undo bar (toast) ----------

const toastSignal = createSignal(null);
let toastTimer;

/** Shows a short message at the bottom, optionally with an action such as Undo. */
export function toast(message, { actionLabel, onAction, duration = 5000, icon } = {}) {
  clearTimeout(toastTimer);
  const id = Date.now();
  toastSignal.set({ id, message, actionLabel, onAction, icon });
  toastTimer = setTimeout(() => toastSignal.set((t) => (t?.id === id ? null : t)), duration);
}

/** Shows "message · Undo" and runs undo() if tapped. */
export function toastUndo(message, undo) {
  toast(message, {
    actionLabel: 'Undo',
    onAction: async () => {
      await undo();
      toast('Undone', { duration: 1800, icon: 'check' });
    },
  });
}

export function ToastHost() {
  const t = toastSignal.use();
  if (!t) return null;
  return html`<div class="toast" key=${t.id} role="status">
    ${t.icon && html`<${Icon} name=${t.icon} size=${18} />`}
    <span class="toast-msg">${t.message}</span>
    ${t.actionLabel && html`<button class="toast-action" onClick=${() => { toastSignal.set(null); t.onAction(); }}>
      ${t.actionLabel}</button>`}
  </div>`;
}

// ---------- Busy overlay ----------

const busySignal = createSignal(null);

/** Shows a spinner with a label while fn runs. Errors are shown as a message. */
export async function withBusy(label, fn) {
  busySignal.set(label);
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong.', { icon: 'alert', duration: 6000 });
    return undefined;
  } finally {
    busySignal.set(null);
  }
}

export function BusyHost() {
  const label = busySignal.use();
  if (!label) return null;
  return html`<div class="busy"><div class="busy-card"><span class="spinner" /><span>${label}</span></div></div>`;
}

// ---------- File pickers ----------

/**
 * Opens the camera or file picker. Must be called straight from a tap.
 * kind: 'camera' | 'photos' | 'file' (photo or PDF) | 'zip'. Resolves with an array of Files (empty if cancelled).
 */
export function pickFiles(kind, { multiple = false } = {}) {
  if (kind === 'camera' && useAppCamera()) {
    return openCamera({ multiple, fallback: () => nativePicker('camera', { multiple: false }) });
  }
  return nativePicker(kind, { multiple });
}

/** The phone's own picker: the iPhone camera, the photo library or Files. */
function nativePicker(kind, { multiple }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = {
      file: 'image/*,application/pdf,.pdf',
      zip: '.zip,application/zip,application/x-zip-compressed',
    }[kind] || 'image/*';
    if (kind === 'camera') input.capture = 'environment';
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve([...(input.files || [])]);
      input.remove();
    });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// ---------- Swipe actions on list rows ----------

/**
 * A list row you can swipe left to reveal actions, like Mail.
 * actions: [{ label, icon, tone: 'danger' | 'accent', onAction }]. A long swipe runs the first one.
 */
export function SwipeRow({ actions, onTap, children, class: cls = '' }) {
  const content = useRef();
  const offset = useRef(0);
  const width = actions.length * 80;

  const setX = (x, animate) => {
    offset.current = x;
    const el = content.current;
    el.style.transition = animate ? 'transform .3s cubic-bezier(.2,.8,.2,1)' : 'none';
    el.style.transform = x ? `translateX(${x}px)` : '';
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = offset.current;
    let mode = null; // 'swipe' | 'scroll'
    const rowWidth = content.current.offsetWidth;

    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!mode && Math.abs(dx) + Math.abs(dy) > 8) mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
      if (mode !== 'swipe') return;
      let x = Math.min(0, start + dx);
      if (x < -width) x = -width + (x + width) * 0.6; // rubber band past the buttons
      setX(x, false);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (mode === 'swipe') {
        content.current.dataset.swiped = '1'; // swallow the click that follows
        if (offset.current < -rowWidth * 0.55) {
          setX(-rowWidth, true);
          setTimeout(() => { actions[0].onAction(); setX(0, false); }, 220);
        } else setX(offset.current < -width / 2 ? -width : 0, true);
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };

  const onClick = (e) => {
    if (content.current.dataset.swiped) {
      delete content.current.dataset.swiped;
      e.preventDefault();
      return;
    }
    if (offset.current) setX(0, true);
    else onTap?.();
  };

  return html`<div class="swipe-row ${cls}">
    <div class="swipe-actions" style=${`width:${width}px`}>
      ${actions.map((a) => html`<button class="swipe-action ${a.tone || ''}" onClick=${() => { setX(0, true); a.onAction(); }}>
        ${a.icon && html`<${Icon} name=${a.icon} size=${20} />`}<span>${a.label}</span>
      </button>`)}
    </div>
    <div class="swipe-content" ref=${content} onPointerDown=${onPointerDown} onClick=${onClick}>${children}</div>
  </div>`;
}
