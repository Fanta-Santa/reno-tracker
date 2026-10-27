// Reads receipts: straight away for a fresh snap, and quietly in the background for the inbox,
// so quick-snapped receipts are ready to confirm by the time you look at them.

import { useEffect, useState } from '../lib.js';
import { state, subscribe, inboxExpenses, getFile, setScan } from '../store.js';
import { todayISO } from '../format.js';
import { readReceiptFile } from './ocr.js';
import { parseReceipt } from './parse.js';

export const readerEnabled = () => state.prefs.autoRead !== false;

/**
 * Reads one receipt (all its pages/photos) and works out what's on it.
 * files: saved file ids, or prepared files ({ blob, type }).
 * Returns { status: 'done', readAt, source, result } — result as from parseReceipt().
 */
export async function scanFiles(files, progress) {
  let lines = [];
  let source = null;
  for (const f of files.slice(0, 4)) {
    const file = typeof f === 'string' ? await getFile(f) : f;
    if (!file) continue;
    const read = await readReceiptFile(file, progress);
    lines = lines.concat(read.lines);
    source = source || read.source;
  }
  const result = parseReceipt(lines, { knownStores: state.stores.map((s) => s.name), today: todayISO() });
  return { status: 'done', readAt: Date.now(), source, result };
}

/** Did the reader find enough to be worth showing the cards? */
export const foundSomething = (result) => !!result && (result.total.cents != null || result.items.length > 0);

// ---------- Background reading of the inbox ----------

let current = null; // id of the inbox receipt being read now
const watchers = new Set();
const setCurrent = (id) => {
  current = id;
  for (const fn of watchers) fn(id);
};

/** Hook: the id of the inbox receipt being read right now (or null). */
export function useReadingId() {
  const [id, setId] = useState(current);
  useEffect(() => {
    watchers.add(setId);
    return () => watchers.delete(setId);
  }, []);
  return id;
}

const failedThisSession = new Set();
let busy = false;

async function pump() {
  if (busy || !readerEnabled()) return;
  // Unread receipts, plus ones that failed in an earlier session (e.g. no signal for the first download).
  const next = inboxExpenses().find((e) => e.fileIds.length && !failedThisSession.has(e.id)
    && (!e.scan || e.scan.status === 'failed'));
  if (!next) return;
  busy = true;
  setCurrent(next.id);
  try {
    await setScan(next.id, await scanFiles(next.fileIds));
  } catch (err) {
    console.warn('Background reading failed', err);
    failedThisSession.add(next.id);
    await setScan(next.id, { status: 'failed', readAt: Date.now() });
  } finally {
    busy = false;
    setCurrent(null);
    setTimeout(pump, 300);
  }
}

/** Starts watching the inbox for receipts to read. */
export function startBackgroundReading() {
  subscribe(() => setTimeout(pump, 0));
  setTimeout(pump, 1500); // let the app settle first
}
