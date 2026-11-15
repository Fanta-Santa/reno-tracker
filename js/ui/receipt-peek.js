// The receipt, pinned where you're filling in its details (the expense form and the check cards), so you can read
// it as you go: scroll inside it, tap it for the full-screen viewer, or hide it (remembered).

import { html, useEffect, useState } from '../lib.js';
import { Icon } from './icons.js';
import { state, getFile, setPrefs } from '../store.js';
import { openPdf, renderPage } from '../images.js';

/** A receipt as the form or the cards hold it: a saved file's id, a not-yet-saved file, or { id, pending }. */
function asPeekFile(f) {
  if (typeof f === 'string') return { id: f };
  if (f?.blob) return { id: f.id, pending: f };
  return f;
}

/** A picture of a receipt (saved or not yet saved): photos as they are, a PDF's first page. */
export function useReceiptImage(f) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let made = null;
    setUrl(null);
    (async () => {
      const file = f?.pending || (f && await getFile(f.id));
      if (!file?.blob) return;
      let blob = file.blob;
      if (file.type === 'application/pdf') {
        const pdf = await openPdf(blob);
        try {
          const canvas = await renderPage(await pdf.getPage(1), 1000);
          blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
          canvas.width = canvas.height = 0;
        } finally {
          pdf.destroy();
        }
      }
      made = URL.createObjectURL(blob);
      if (alive) setUrl(made);
      else URL.revokeObjectURL(made);
    })().catch((err) => console.warn('Receipt preview failed', err));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [f?.id]);
  return url;
}

/** Is the pinned receipt switched on? (Hide switches it off, everywhere, until Show.) */
export const peekShown = () => state.prefs.receiptPeek !== false;

/**
 * files: the receipts (see asPeekFile). index/onIndex: which one is showing. onView: open the full-screen viewer.
 * small: less tall (while typing, to leave room above the keyboard). compact: shorter still, for the check cards.
 */
export function ReceiptPeek({ files, index = 0, onIndex, onView, small, compact }) {
  const list = files.map(asPeekFile);
  const at = Math.min(index, list.length - 1);
  const url = useReceiptImage(list[at]);
  if (!list.length) return null;
  if (!peekShown()) {
    return html`<button class="peek-bar" onClick=${() => setPrefs({ receiptPeek: true })}>
      <${Icon} name="receipt" size=${18} /> Show the receipt while you fill this in</button>`;
  }
  const view = () => onView?.(at);
  return html`<div class="receipt-peek ${small ? 'small' : ''} ${compact ? 'compact' : ''}">
    <div class="peek-frame">
      ${url ? html`<img src=${url} alt="Receipt" onClick=${view} />` : html`<span class="peek-loading"><span class="spinner" /></span>`}
    </div>
    <div class="peek-tools">
      ${list.length > 1 && onIndex && html`<span class="peek-count">
        <button onClick=${() => onIndex(at - 1)} disabled=${at === 0} aria-label="Previous receipt"><${Icon} name="chevronLeft" size=${18} stroke=${2.4} /></button>
        <span>${at + 1} of ${list.length}</span>
        <button onClick=${() => onIndex(at + 1)} disabled=${at === list.length - 1} aria-label="Next receipt"><${Icon} name="chevronRight" size=${18} stroke=${2.4} /></button>
      </span>`}
      <button class="peek-btn" onClick=${view} aria-label="View the receipt full screen"><${Icon} name="expand" size=${18} stroke=${2.2} /></button>
      <button class="peek-btn" onClick=${() => setPrefs({ receiptPeek: false })}>Hide</button>
    </div>
  </div>`;
}
