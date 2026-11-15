// The ＋ button: it opens the camera straight away. Snap a receipt, then Check now or Sort later (it stays open for
// the next one). The other ways in sit under the shutter: type it in, a PDF or photo, a quote. Where the app's
// camera can't be used (switched off in Settings, or on a computer), a menu of the same choices appears instead.

import { addToInbox } from '../store.js';
import { prepareFile } from '../images.js';
import { openActions, pickFiles, nativePicker, toast, withBusy } from '../ui/kit.js';
import { openAddCamera, useAppCamera } from '../ui/camera.js';
import { openExpenseForm } from './expense-form.js';
import { openQuoteForm } from './quotes.js';
import { reviewNewCapture } from './review.js';
import { readerEnabled } from '../reader/queue.js';

async function prepare(files) {
  if (!files.length) return null;
  return withBusy(files.length > 1 ? `Preparing ${files.length} receipts…` : 'Preparing receipt…',
    () => Promise.all(files.map(prepareFile)));
}

/** Photos or PDFs → read them and confirm with cards (or fill in the form if reading is off). */
async function fillFrom(files) {
  const prepared = await prepare(files);
  if (!prepared) return;
  if (readerEnabled()) reviewNewCapture(prepared);
  else openExpenseForm({ pendingFiles: prepared });
}

/** Camera or file → read it and confirm with cards (or fill in the form if reading is off). */
export async function captureThenFill(kind) {
  await fillFrom(await pickFiles(kind, { multiple: kind === 'file' }));
}

const savedToInbox = (n) => `${n > 1 ? `${n} receipts` : 'Receipt'} saved to inbox${readerEnabled() ? ' and being read' : ''}`;

/** Camera or photo library → straight into the inbox, details later. The app's camera can take several in a row. */
export async function captureToInbox(kind = 'camera') {
  const prepared = await prepare(await pickFiles(kind, { multiple: true }));
  if (!prepared) return;
  const undo = await withBusy('Saving…', () => addToInbox(prepared));
  if (!undo) return;
  toast(savedToInbox(prepared.length), { actionLabel: 'Snap another', onAction: () => captureToInbox('camera'), duration: 7000 });
}

const EXTRAS = [
  { id: 'manual', label: 'Type it in', icon: 'pencil' },
  { id: 'file', label: 'PDF / photo', icon: 'upload', pick: () => nativePicker('file', { multiple: true }) },
  { id: 'quote', label: 'Quote', icon: 'quote' },
];

async function addWithCamera() {
  const result = await openAddCamera({
    extras: EXTRAS,
    fallback: () => nativePicker('camera'),
    onLater: async (file) => {
      const prepared = await prepare([file]);
      if (prepared) await addToInbox(prepared);
    },
  });
  if (result.action === 'check') await fillFrom(result.files);
  else if (result.action === 'extra' && result.id === 'manual') openExpenseForm();
  else if (result.action === 'extra' && result.id === 'quote') openQuoteForm();
  else if (result.action === 'extra' && result.id === 'file') await fillFrom(result.files || []);
  else if (result.action === 'closed' && result.later) toast(savedToInbox(result.later), { icon: 'check' });
}

export function openAddMenu() {
  if (useAppCamera()) {
    addWithCamera();
    return;
  }
  openActions({
    title: 'Add',
    actions: [
      { label: 'Snap a receipt', icon: 'camera', onSelect: () => captureThenFill('camera') },
      { label: 'Upload PDF or screenshot', icon: 'upload', onSelect: () => captureThenFill('file') },
      { label: 'Enter manually', icon: 'pencil', onSelect: () => openExpenseForm() },
      { label: 'Quick snap — sort later', icon: 'inbox', onSelect: () => captureToInbox('camera') },
      { label: 'Add a quote or bill', icon: 'quote', onSelect: () => openQuoteForm() },
    ],
  });
}
