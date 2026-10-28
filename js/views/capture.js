// The ＋ button: snap, upload, type in, quick-snap into the inbox, or log a quote.

import { addToInbox } from '../store.js';
import { prepareFile } from '../images.js';
import { openActions, pickFiles, toast, withBusy } from '../ui/kit.js';
import { openExpenseForm } from './expense-form.js';
import { openQuoteForm } from './quotes.js';
import { reviewNewCapture } from './review.js';
import { readerEnabled } from '../reader/queue.js';

async function prepare(files) {
  if (!files.length) return null;
  return withBusy(files.length > 1 ? `Preparing ${files.length} receipts…` : 'Preparing receipt…',
    () => Promise.all(files.map(prepareFile)));
}

/** Camera or file → read it and confirm with cards (or fill in the form if reading is off). */
export async function captureThenFill(kind) {
  const prepared = await prepare(await pickFiles(kind, { multiple: kind === 'file' }));
  if (!prepared) return;
  if (readerEnabled()) reviewNewCapture(prepared);
  else openExpenseForm({ pendingFiles: prepared });
}

/** Camera or photo library → straight into the inbox, details later. The app's camera can take several in a row. */
export async function captureToInbox(kind = 'camera') {
  const prepared = await prepare(await pickFiles(kind, { multiple: true }));
  if (!prepared) return;
  const undo = await withBusy('Saving…', () => addToInbox(prepared));
  if (!undo) return;
  const what = prepared.length > 1 ? `${prepared.length} receipts` : 'Receipt';
  toast(`${what} saved to inbox${readerEnabled() ? ' and being read' : ''}`, {
    actionLabel: 'Snap another',
    onAction: () => captureToInbox('camera'),
    duration: 7000,
  });
}

export function openAddMenu() {
  openActions({
    title: 'Add',
    actions: [
      { label: 'Snap a receipt', icon: 'camera', onSelect: () => captureThenFill('camera') },
      { label: 'Upload PDF or screenshot', icon: 'upload', onSelect: () => captureThenFill('file') },
      { label: 'Enter manually', icon: 'pencil', onSelect: () => openExpenseForm() },
      { label: 'Quick snap — sort later', icon: 'inbox', onSelect: () => captureToInbox('camera') },
      { label: 'Add a quote', icon: 'quote', onSelect: () => openQuoteForm() },
    ],
  });
}
