// The ＋ button: snap, upload, type in, or quick-snap into the inbox.

import { addToInbox } from '../store.js';
import { prepareFile } from '../images.js';
import { openActions, pickFiles, toast, withBusy } from '../ui/kit.js';
import { openExpenseForm } from './expense-form.js';

async function prepare(files) {
  if (!files.length) return null;
  return withBusy(files.length > 1 ? `Preparing ${files.length} receipts…` : 'Preparing receipt…',
    () => Promise.all(files.map(prepareFile)));
}

/** Camera or file → fill in the details now. */
export async function captureThenFill(kind) {
  const prepared = await prepare(await pickFiles(kind, { multiple: kind === 'file' }));
  if (prepared) openExpenseForm({ pendingFiles: prepared });
}

/** Camera or photo library → straight into the inbox, details later. */
export async function captureToInbox(kind = 'camera') {
  const prepared = await prepare(await pickFiles(kind, { multiple: kind !== 'camera' }));
  if (!prepared) return;
  const undo = await withBusy('Saving…', () => addToInbox(prepared));
  if (!undo) return;
  const what = prepared.length > 1 ? `${prepared.length} receipts` : 'Receipt';
  toast(`${what} saved to inbox`, {
    actionLabel: 'Snap another',
    onAction: () => captureToInbox('camera'),
    duration: 7000,
  });
}

export function openAddMenu() {
  openActions({
    title: 'Add an expense',
    actions: [
      { label: 'Snap a receipt', icon: 'camera', onSelect: () => captureThenFill('camera') },
      { label: 'Upload PDF or screenshot', icon: 'upload', onSelect: () => captureThenFill('file') },
      { label: 'Enter manually', icon: 'pencil', onSelect: () => openExpenseForm() },
      { label: 'Quick snap — sort later', icon: 'inbox', onSelect: () => captureToInbox('camera') },
    ],
  });
}
