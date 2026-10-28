// Full backup to a single .zip file (data + every receipt), and restoring from one.
//
// Inside the zip:
//   backup.json           the project, rooms, categories, stores, expenses, ...
//   receipts/<id>.jpg     each receipt as saved (photos are .jpg, PDFs .pdf)
//   thumbs/<id>.jpg       small previews, so a restore doesn't need to redraw them

import * as db from './db.js';
import { createZip, readZip } from './zip.js';
import { state, replaceEverything, setPrefs } from './store.js';
import { todayISO } from './format.js';
import { shareFile } from './device.js';

const APP_ID = 'reno-tracker';
const SCHEMA = 1;

function extension(type) {
  return type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg';
}

function slug(text) {
  return (text || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
}

export async function createBackup() {
  const files = await db.getAll('files');
  const entries = [];
  const fileList = files.map((f) => {
    const path = `receipts/${f.id}.${extension(f.type)}`;
    entries.push({ name: path, data: f.blob });
    let thumbPath = null;
    if (f.thumb) {
      thumbPath = `thumbs/${f.id}.jpg`;
      entries.push({ name: thumbPath, data: f.thumb });
    }
    return { id: f.id, type: f.type, name: f.name, size: f.size, createdAt: f.createdAt, path, thumbPath };
  });

  const data = {
    app: APP_ID,
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    project: state.project,
    prefs: state.prefs,
    rooms: state.rooms,
    categories: state.categories,
    stores: state.stores,
    expenses: state.expenses,
    quotes: state.quotes,
    learned: state.learned,
    files: fileList,
  };
  entries.unshift({ name: 'backup.json', data: JSON.stringify(data, null, 1) });

  const blob = await createZip(entries);
  const name = `reno-backup-${slug(state.project?.name)}-${todayISO()}.zip`;
  return new File([blob], name, { type: 'application/zip' });
}

/** Hands the backup to the phone (Share sheet → Save to Files, or a download). Returns false if cancelled. */
export async function saveBackup() {
  const file = await createBackup();
  if (!(await shareFile(file))) return false;
  await setPrefs({ lastBackupAt: Date.now() });
  return true;
}

/** Checks a backup file and returns a summary, without changing anything yet. */
export async function inspectBackup(file) {
  const zip = await readZip(file);
  const json = zip.get('backup.json');
  if (!json) throw new Error("This zip isn't a Reno Tracker backup.");
  const data = JSON.parse(await (await json.blob()).text());
  if (data.app !== APP_ID) throw new Error("This zip isn't a Reno Tracker backup.");
  if (data.schema > SCHEMA) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  return {
    zip,
    data,
    summary: {
      projectName: data.project?.name || 'Unnamed project',
      expenses: (data.expenses || []).filter((e) => e.status !== 'inbox').length,
      receipts: (data.files || []).length,
      exportedAt: data.exportedAt,
    },
  };
}

/** Replaces everything on this phone with the backup's contents. */
export async function restoreBackup({ zip, data }) {
  const files = [];
  for (const f of data.files || []) {
    const entry = zip.get(f.path);
    if (!entry) continue;
    const raw = await entry.blob();
    const thumbEntry = f.thumbPath && zip.get(f.thumbPath);
    const thumb = thumbEntry ? new Blob([await thumbEntry.blob()], { type: 'image/jpeg' }) : null;
    files.push({
      id: f.id, type: f.type, name: f.name, size: f.size, createdAt: f.createdAt,
      blob: new Blob([raw], { type: f.type }),
      thumb,
    });
  }
  await replaceEverything(data, files);
}
