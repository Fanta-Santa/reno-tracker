// IndexedDB: the database built into the browser. Everything lives on this phone only.

const DB_NAME = 'reno-tracker';
const DB_VERSION = 1;

// meta is keyed by 'key' (project, prefs); everything else by 'id'.
export const STORE_NAMES = ['meta', 'rooms', 'categories', 'stores', 'expenses', 'quotes', 'files'];

let dbPromise;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORE_NAMES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Close other open copies of the app and try again.'));
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Saving was cancelled.'));
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await openDB();
  return request(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDB();
  return request(db.transaction(store).objectStore(store).get(key));
}

/**
 * Runs several writes as one all-or-nothing transaction.
 * ops: [{ store, put: value } | { store, delete: key } | { store, clear: true }]
 */
export async function write(ops) {
  const db = await openDB();
  const stores = [...new Set(ops.map((op) => op.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const op of ops) {
    const os = tx.objectStore(op.store);
    if (op.clear) os.clear();
    else if ('delete' in op) os.delete(op.delete);
    else os.put(op.put);
  }
  return done(tx);
}

export const put = (store, value) => write([{ store, put: value }]);
export const remove = (store, key) => write([{ store, delete: key }]);
