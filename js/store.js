// The app's data, kept in memory for speed and saved to the phone's database on every change.
// Screens read `state` through useStore() and re-render whenever something changes.

import { useEffect, useState } from './lib.js';
import * as db from './db.js';
import { DEFAULT_CATEGORIES, DEFAULT_STORES } from './defaults.js';
import { expenseGst, todayISO } from './format.js';
import { itemKey } from './reader/categorize.js';

export const state = {
  loaded: false,
  project: null, // { key: 'project', name, gstRate, createdAt }
  prefs: { key: 'prefs' }, // lastStore, lastRoomId, lastBackupAt, autoRead
  learned: {}, // receipt item → the category you chose for it: { [itemKey]: { categoryId, isTool } }
  rooms: [], // { id, name, type, budgetCents, order, archived }
  categories: [], // { id, name, isTool, order, archived }
  stores: [], // { id, name, defaultCategoryId, order }
  expenses: [], // see blankExpense()
  quotes: [], // Stage 3
};

const listeners = new Set();
let version = 0; // goes up on every change

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  version += 1;
  for (const fn of listeners) fn();
}

/** Hook: re-renders the calling screen whenever the data changes. */
export function useStore() {
  const [, setTick] = useState(0);
  const seen = version;
  useEffect(() => {
    const unsubscribe = subscribe(() => setTick((n) => n + 1));
    // The data may have changed between drawing and starting to listen (e.g. it finished loading): catch up.
    if (version !== seen) setTick((n) => n + 1);
    return unsubscribe;
  }, []);
  return state;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const byNewest = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);
const sameText = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

export async function loadAll() {
  const [meta, rooms, categories, stores, expenses, quotes] = await Promise.all(
    ['meta', 'rooms', 'categories', 'stores', 'expenses', 'quotes'].map((s) => db.getAll(s)),
  );
  state.project = meta.find((m) => m.key === 'project') || null;
  state.prefs = meta.find((m) => m.key === 'prefs') || { key: 'prefs' };
  state.learned = meta.find((m) => m.key === 'learned')?.items || {};
  state.rooms = rooms.sort(byOrder);
  state.categories = categories.sort(byOrder);
  state.stores = stores.sort(byOrder);
  state.expenses = expenses.sort(byNewest);
  state.quotes = quotes;
  state.loaded = true;
  changed();
}

// ---------- Lookups ----------

export const activeRooms = () => state.rooms.filter((r) => !r.archived);
export const activeCategories = () => state.categories.filter((c) => !c.archived);
export const roomById = (id) => state.rooms.find((r) => r.id === id);
export const categoryById = (id) => state.categories.find((c) => c.id === id);
export const storeByName = (name) => state.stores.find((s) => sameText(s.name, name));
export const filedExpenses = () => state.expenses.filter((e) => e.status !== 'inbox');
export const inboxExpenses = () => state.expenses.filter((e) => e.status === 'inbox');
export const gstRate = () => state.project?.gstRate ?? 0.1;

// ---------- Project ----------

export async function createProject({ name, rooms }) {
  const now = Date.now();
  const categories = DEFAULT_CATEGORIES.map((c, i) => ({
    id: uid(), name: c.name, isTool: !!c.isTool, order: i, archived: false,
  }));
  const stores = DEFAULT_STORES.map((s, i) => ({
    id: uid(),
    name: s.name,
    order: i,
    defaultCategoryId: categories.find((c) => c.name === s.defaultCategory)?.id ?? null,
  }));
  const roomRecords = rooms.map((r, i) => ({
    id: uid(), name: r.name, type: r.type, budgetCents: r.budgetCents ?? null, order: i, archived: false,
  }));
  await db.write([
    { store: 'meta', put: { key: 'project', name, gstRate: 0.1, createdAt: now } },
    { store: 'meta', put: { key: 'prefs' } },
    ...roomRecords.map((put) => ({ store: 'rooms', put })),
    ...categories.map((put) => ({ store: 'categories', put })),
    ...stores.map((put) => ({ store: 'stores', put })),
  ]);
  await loadAll();
}

export async function updateProject(patch) {
  state.project = { ...state.project, ...patch };
  await db.put('meta', state.project);
  changed();
}

export async function setPrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  await db.put('meta', state.prefs);
  changed();
}

// ---------- Receipt files ----------

const thumbUrls = new Map();

/** A saved file record: { id, type, name, size, blob, thumb, createdAt }. */
export const getFile = (id) => db.get('files', id);

/** Object URL for a saved file's thumbnail (cached), or null if it has none. */
export async function thumbUrl(id) {
  if (thumbUrls.has(id)) return thumbUrls.get(id);
  const file = await db.get('files', id);
  const url = file?.thumb ? URL.createObjectURL(file.thumb) : null;
  thumbUrls.set(id, url);
  return url;
}

export const cachedThumbUrl = (id) => thumbUrls.get(id);

function fileRecord(pending) {
  return {
    id: pending.id,
    type: pending.type,
    name: pending.name,
    size: pending.blob.size,
    blob: pending.blob,
    thumb: pending.thumb || null,
    createdAt: pending.createdAt || Date.now(),
  };
}

// ---------- Expenses ----------

export function blankExpense() {
  const now = Date.now();
  return {
    id: uid(),
    status: 'filed', // 'inbox' = photo saved, details still to fill in
    date: todayISO(),
    store: '',
    description: '',
    totalCents: null, // GST-inclusive
    gstMode: 'auto', // 'auto' = 1/11 of total, 'none' = GST-free, 'custom' = gstCents as entered
    gstCents: null,
    notes: '',
    lines: [], // [{ id, roomId, categoryId, amountCents, isTool, description? }] — add up to totalCents
    receiptText: '', // what the receipt reader saw, kept for search
    fileIds: [],
    quoteId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function putExpenseInState(record) {
  state.expenses = [...state.expenses.filter((e) => e.id !== record.id), record].sort(byNewest);
}

/** Possible duplicates: same store, date and total as another saved expense. */
export function findDuplicates(expense) {
  if (expense.totalCents == null) return [];
  return state.expenses.filter((e) => e.id !== expense.id
    && e.totalCents === expense.totalCents
    && e.date === expense.date
    && sameText(e.store, expense.store));
}

/** Remembers the last store and room, and each store's usual category. */
async function learnFrom(expense) {
  if (expense.status === 'inbox' || !expense.lines.length) return;
  const main = [...expense.lines].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents))[0];
  const ops = [];
  const storeName = expense.store.trim();
  if (storeName) {
    const existing = storeByName(storeName);
    if (existing) {
      if (existing.defaultCategoryId !== main.categoryId) {
        const updated = { ...existing, defaultCategoryId: main.categoryId };
        state.stores = state.stores.map((s) => (s.id === updated.id ? updated : s));
        ops.push({ store: 'stores', put: updated });
      }
    } else {
      const added = {
        id: uid(),
        name: storeName,
        defaultCategoryId: main.categoryId,
        order: state.stores.reduce((max, s) => Math.max(max, s.order ?? 0), -1) + 1,
      };
      state.stores = [...state.stores, added];
      ops.push({ store: 'stores', put: added });
    }
  }
  state.prefs = { ...state.prefs, lastStore: storeName, lastRoomId: main.roomId };
  ops.push({ store: 'meta', put: state.prefs });

  // Remember each item's category, so the receipt reader suggests it next time.
  const items = expense.lines.filter((l) => l.description && !l.auto && itemKey(l.description));
  if (items.length) {
    const learned = { ...state.learned };
    for (const l of items) {
      const key = itemKey(l.description);
      delete learned[key]; // re-insert so the newest are kept when trimming
      learned[key] = { categoryId: l.categoryId, isTool: !!l.isTool };
    }
    const keys = Object.keys(learned);
    for (const k of keys.slice(0, Math.max(0, keys.length - 2000))) delete learned[k];
    state.learned = learned;
    ops.push({ store: 'meta', put: { key: 'learned', items: learned } });
  }
  await db.write(ops);
}

/** Stores what the receipt reader found for an inbox receipt (no Undo needed). */
export async function setScan(id, scan) {
  const current = state.expenses.find((e) => e.id === id);
  if (!current) return;
  const record = { ...current, scan };
  await db.put('expenses', record);
  putExpenseInState(record);
  changed();
}

/**
 * Saves an expense with any newly attached files and removed ones.
 * Returns an undo function that puts everything back as it was.
 */
export async function saveExpense(expense, { newFiles = [], removedFileIds = [] } = {}) {
  const previous = state.expenses.find((e) => e.id === expense.id) || null;
  const removedFiles = (await Promise.all(removedFileIds.map((id) => db.get('files', id)))).filter(Boolean);
  const record = { ...expense, updatedAt: Date.now() };
  record.gstCents = record.totalCents == null ? null : expenseGst(record, gstRate());

  await db.write([
    ...newFiles.map((f) => ({ store: 'files', put: fileRecord(f) })),
    ...removedFileIds.map((id) => ({ store: 'files', delete: id })),
    { store: 'expenses', put: record },
  ]);
  putExpenseInState(record);
  await learnFrom(record);
  changed();

  return async () => {
    await db.write([
      ...newFiles.map((f) => ({ store: 'files', delete: f.id })),
      ...removedFiles.map((put) => ({ store: 'files', put })),
      previous ? { store: 'expenses', put: previous } : { store: 'expenses', delete: record.id },
    ]);
    if (previous) putExpenseInState(previous);
    else state.expenses = state.expenses.filter((e) => e.id !== record.id);
    changed();
  };
}

/** Deletes an expense and its receipts. Returns an undo function. */
export async function deleteExpense(id) {
  const record = state.expenses.find((e) => e.id === id);
  if (!record) return async () => {};
  const files = (await Promise.all(record.fileIds.map((fid) => db.get('files', fid)))).filter(Boolean);
  await db.write([
    { store: 'expenses', delete: id },
    ...record.fileIds.map((fid) => ({ store: 'files', delete: fid })),
  ]);
  state.expenses = state.expenses.filter((e) => e.id !== id);
  changed();

  return async () => {
    await db.write([
      { store: 'expenses', put: record },
      ...files.map((put) => ({ store: 'files', put })),
    ]);
    putExpenseInState(record);
    changed();
  };
}

/** Saves each photo as its own inbox item, to be sorted later. Returns an undo function. */
export async function addToInbox(pendingFiles) {
  const records = pendingFiles.map((f) => ({ ...blankExpense(), status: 'inbox', fileIds: [f.id] }));
  await db.write([
    ...pendingFiles.map((f) => ({ store: 'files', put: fileRecord(f) })),
    ...records.map((put) => ({ store: 'expenses', put })),
  ]);
  for (const r of records) putExpenseInState(r);
  changed();

  return async () => {
    await db.write([
      ...pendingFiles.map((f) => ({ store: 'files', delete: f.id })),
      ...records.map((r) => ({ store: 'expenses', delete: r.id })),
    ]);
    const ids = new Set(records.map((r) => r.id));
    state.expenses = state.expenses.filter((e) => !ids.has(e.id));
    changed();
  };
}

// ---------- Rooms, categories and stores ----------

/** Is this room/category used by any expense (or quote)? */
export function isInUse(kind, id) {
  const field = kind === 'rooms' ? 'roomId' : 'categoryId';
  if (kind === 'stores') return false;
  return state.expenses.some((e) => e.lines.some((l) => l[field] === id))
    || state.quotes.some((q) => q[field] === id);
}

/** Adds or updates a room, category or store. Renaming a store renames it on past expenses too. */
export async function saveItem(kind, item) {
  const list = state[kind];
  const previous = list.find((x) => x.id === item.id);
  const record = previous ? { ...previous, ...item } : {
    archived: false,
    ...item,
    id: item.id || uid(),
    order: list.reduce((max, x) => Math.max(max, x.order ?? 0), -1) + 1,
  };
  const ops = [{ store: kind, put: record }];

  if (kind === 'stores' && previous && !sameText(previous.name, record.name)) {
    for (const e of state.expenses.filter((x) => sameText(x.store, previous.name))) {
      const renamed = { ...e, store: record.name };
      putExpenseInState(renamed);
      ops.push({ store: 'expenses', put: renamed });
    }
  }
  await db.write(ops);
  state[kind] = [...list.filter((x) => x.id !== record.id), record].sort(byOrder);
  changed();
  return record;
}

/**
 * Removes a room, category or store. Rooms and categories that expenses still use are
 * archived instead (hidden from pickers, kept on old expenses). Returns { archived, undo }.
 */
export async function removeItem(kind, id) {
  const previous = state[kind].find((x) => x.id === id);
  const archived = isInUse(kind, id);
  if (archived) {
    await saveItem(kind, { ...previous, archived: true });
  } else {
    await db.remove(kind, id);
    state[kind] = state[kind].filter((x) => x.id !== id);
    changed();
  }
  return {
    archived,
    undo: async () => {
      await db.put(kind, previous);
      state[kind] = [...state[kind].filter((x) => x.id !== id), previous].sort(byOrder);
      changed();
    },
  };
}

/** Moves a room/category/store up or down one place. */
export async function moveItem(kind, id, direction) {
  const list = [...state[kind]];
  const i = list.findIndex((x) => x.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const renumbered = list.map((x, order) => ({ ...x, order }));
  await db.write(renumbered.map((put) => ({ store: kind, put })));
  state[kind] = renumbered;
  changed();
}

// ---------- Whole-database operations (backup / restore) ----------

export async function replaceEverything(data, files) {
  await db.write([
    ...db.STORE_NAMES.map((store) => ({ store, clear: true })),
    ...(data.project ? [{ store: 'meta', put: data.project }] : []),
    { store: 'meta', put: { ...(data.prefs || {}), key: 'prefs' } },
    { store: 'meta', put: { key: 'learned', items: data.learned || {} } },
    ...['rooms', 'categories', 'stores', 'expenses', 'quotes']
      .flatMap((store) => (data[store] || []).map((put) => ({ store, put }))),
    ...files.map((put) => ({ store: 'files', put })),
  ]);
  for (const url of thumbUrls.values()) if (url) URL.revokeObjectURL(url);
  thumbUrls.clear();
  await loadAll();
}
