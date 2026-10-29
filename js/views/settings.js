// Settings: project name, rooms/stages, categories, stores, backup & restore, and this phone's storage.

import { html, useEffect, useState } from '../lib.js';
import { state, useStore, updateProject, saveItem, removeItem, moveItem, isInUse, setPrefs } from '../store.js';
import { roomType } from '../defaults.js';
import { formatBytes, formatMoney, formatTimestamp } from '../format.js';
import { saveBackup, inspectBackup, restoreBackup } from '../backup.js';
import {
  Switch, Page, Group, Row, openSheet, SheetHeader, toast, toastUndo, withBusy, pickFiles, confirmAction,
} from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { navigate } from '../ui/router.js';
import { isIOS, isStandalone } from '../device.js';
import { APP_VERSION } from '../version.js';
import { openRoomEditor, openCategoryEditor, openStoreEditor } from './editors.js';
import { openExportSheet } from './export.js';
import { backupReminder } from '../stats.js';

// ---------- Backup & restore (also used by first-run setup) ----------

export async function runBackup() {
  const saved = await withBusy('Packing up your receipts…', saveBackup);
  if (saved) toast('Backup ready — keep the file somewhere safe', { icon: 'check' });
}

export async function runRestore() {
  const [file] = await pickFiles('zip');
  if (!file) return;
  const backup = await withBusy('Checking backup…', () => inspectBackup(file));
  if (!backup) return;
  const { summary } = backup;
  const hasData = !!state.project;
  const ok = await confirmAction({
    title: `Restore “${summary.projectName}”?`,
    message: `${summary.expenses} expenses and ${summary.receipts} receipts, backed up ${summary.exportedAt ? formatTimestamp(Date.parse(summary.exportedAt)) : 'on an unknown date'}.`
      + (hasData ? ' This replaces everything currently in the app on this phone.' : ''),
    confirmLabel: hasData ? 'Replace and restore' : 'Restore',
    destructive: hasData,
  });
  if (!ok) return;
  const done = await withBusy('Restoring…', async () => { await restoreBackup(backup); return true; });
  if (done) {
    navigator.storage?.persist?.();
    navigate('/', { replace: true });
    toast('Backup restored', { icon: 'check' });
  }
}

// ---------- Main settings screen ----------

/** Has the receipt reader's language file been downloaded and kept for offline use? */
function useReaderCached() {
  const [cached, setCached] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const key = (await caches.keys()).find((k) => k.startsWith('reno-tracker-reader'));
        const hit = key && await (await caches.open(key)).match('vendor/tesseract/lang/eng.traineddata.gz');
        setCached(!!hit);
      } catch {
        setCached(false);
      }
    })();
  }, []);
  return cached;
}

function useStorageInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    (async () => {
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      const persisted = await navigator.storage?.persisted?.().catch(() => false);
      setInfo({ used: estimate?.usage, persisted });
    })();
  }, []);
  return info;
}

export function SettingsView() {
  useStore();
  const storage = useStorageInfo();
  const readerCached = useReaderCached();
  const autoRead = state.prefs.autoRead !== false;
  const lastBackup = state.prefs.lastBackupAt;
  const reminder = backupReminder(state, lastBackup);
  const active = (list) => list.filter((x) => !x.archived).length;

  const renameProject = () => openSheet(({ close }) => html`<${TextEditSheet} title="Project name" value=${state.project.name}
    close=${close} onSave=${(name) => updateProject({ name })} />`);

  return html`<${Page} title="Settings">
    ${isIOS() && !isStandalone() && html`<div class="callout warn">
      <${Icon} name="alert" size=${20} />
      <span>You’re using Reno Tracker in a Safari tab. Add it to your Home Screen so Safari can’t clear your receipts. Tap Share, then <strong>Add to Home Screen</strong>.</span>
    </div>`}

    <${Group} title="Project">
      <${Row} icon="🏡" label="Name" detail=${state.project.name} onClick=${renameProject} />
    <//>

    <${Group} title="Lists" footer="These fill the quick-pick buttons when you add an expense.">
      <${Row} icon="house" iconBg="#34C759" label="Rooms & stages" detail=${active(state.rooms)} onClick=${() => navigate('/settings/rooms')} />
      <${Row} icon="tag" iconBg="#5856D6" label="Categories" detail=${active(state.categories)} onClick=${() => navigate('/settings/categories')} />
      <${Row} icon="store" iconBg="#FF9500" label="Stores" detail=${state.stores.length} onClick=${() => navigate('/settings/stores')} />
    <//>

    <${Group} title="Receipt reading"
      footer="Reads the store, date, total and each item from your receipts, then asks you to confirm. It all happens on this phone. Nothing is uploaded. It learns from the categories you pick. The app’s camera turns the iPhone’s light on, which helps with faded receipts. Switch it off to use the iPhone’s own camera.">
      <${Row} icon="receipt" iconBg="#5E5CE6" label="Read receipts automatically">
        <${Switch} label="Read receipts automatically" checked=${autoRead} onChange=${(on) => setPrefs({ autoRead: on })} />
      <//>
      <${Row} icon="camera" iconBg="#FF9F0A" label="Use the app’s camera (light on)">
        <${Switch} label="Use the app’s camera" checked=${state.prefs.appCamera !== false} onChange=${(on) => setPrefs({ appCamera: on })} />
      <//>
      <${Row} icon="storage" iconBg="#8E8E93" label="Reader"
        detail=${readerCached == null ? '…' : readerCached ? 'Ready offline' : 'Downloads on first use (7 MB)'} />
    <//>

    <${Group} title="Export" footer="A spreadsheet of your spending (Excel or CSV), for your records, your accountant or insurance. Add the receipt photos to send everything in one .zip.">
      <${Row} icon="share" iconBg="#34C759" label="Export to Excel or CSV" onClick=${() => openExportSheet()} />
    <//>

    <${Group} title="Backup" footer=${`A backup is one .zip file with all your data and receipt photos. Save it to iCloud Drive or Files. It can be restored on this phone or a new one.${
      lastBackup && reminder.changes ? ` ${reminder.changes} ${reminder.changes === 1 ? 'change' : 'changes'} since your last backup.` : ''}`}>
      <${Row} icon="backup" iconBg="#007AFF" label="Back up now" detail=${lastBackup ? `Last: ${formatTimestamp(lastBackup)}` : 'Never'} onClick=${runBackup} />
      <${Row} icon="restore" iconBg="#8E8E93" label="Restore from a backup" onClick=${runRestore} />
    <//>

    <${Group} title="This phone">
      <${Row} icon="storage" iconBg="#30B0C7" label="Space used" detail=${storage?.used != null ? formatBytes(storage.used) : '…'} />
      <${Row} icon="check" iconBg=${storage?.persisted || isStandalone() ? '#34C759' : '#FF9500'} label="Storage protected"
        detail=${storage == null ? '…' : storage.persisted ? 'Yes' : isStandalone() ? 'Home Screen app' : 'Not guaranteed'} />
      <${Row} icon="info" iconBg="#8E8E93" label="Version" detail=${APP_VERSION} />
    <//>
  <//>`;
}

function TextEditSheet({ title, value, close, onSave }) {
  const [text, setText] = useState(value);
  const save = () => {
    if (!text.trim()) return;
    onSave(text.trim());
    close();
  };
  return html`<${SheetHeader} title=${title} onCancel=${close} onDone=${save} doneLabel="Save" doneDisabled=${!text.trim()} />
  <div class="sheet-body form">
    <div class="form-group">
      <input type="text" value=${text} onInput=${(e) => setText(e.currentTarget.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} />
    </div>
  </div>`;
}

// ---------- List screens: rooms, categories, stores ----------

const LISTS = {
  rooms: {
    title: 'Rooms & stages',
    noun: 'room or stage',
    blank: () => ({ type: 'other', budgetCents: null }),
    open: openRoomEditor,
    key: 'room',
    icon: (r) => roomType(r.type).emoji,
    detail: (r) => (r.budgetCents != null ? formatMoney(r.budgetCents, { whole: true }) : 'No budget'),
    footer: 'Budgets are optional. The type decides where each room sits on the dashboard house.',
  },
  categories: {
    title: 'Categories',
    noun: 'category',
    blank: () => ({ isTool: false }),
    open: openCategoryEditor,
    key: 'category',
    icon: (c) => (c.isTool ? '🔧' : '🏷️'),
    detail: (c) => (c.isTool ? 'Tools' : ''),
    footer: 'Categories marked as tools flag new purchases as tools automatically.',
  },
  stores: {
    title: 'Stores',
    noun: 'store',
    blank: () => ({ defaultCategoryId: null }),
    open: openStoreEditor,
    key: 'store',
    icon: () => '🏪',
    detail: (s) => state.categories.find((c) => c.id === s.defaultCategoryId)?.name || '',
    footer: 'New stores are added automatically when you type one in. Each store remembers the category you used last.',
  },
};

export function ListSettingsView({ kind }) {
  useStore();
  const [reorder, setReorder] = useState(false);
  const cfg = LISTS[kind];
  const items = state[kind];
  const active = items.filter((x) => !x.archived);
  const archived = items.filter((x) => x.archived);

  const edit = (item) => cfg.open({
    [cfg.key]: item,
    onSave: (next) => withBusy('Saving…', () => saveItem(kind, next)),
    onDelete: item.id ? async () => {
      const result = await withBusy('Removing…', () => removeItem(kind, item.id));
      if (!result) return;
      toastUndo(result.archived ? `${item.name} archived — it stays on past expenses` : `${item.name} removed`, result.undo);
    } : undefined,
  });

  const unarchive = (item) => withBusy('Restoring…', () => saveItem(kind, { ...item, archived: false }));

  return html`<${Page} title=${cfg.title} back=${{ label: 'Settings', to: '/settings' }}
    actions=${active.length > 1 && html`<button class="nav-text-btn" onClick=${() => setReorder(!reorder)}>${reorder ? 'Done' : 'Reorder'}</button>`}>
    <${Group} footer=${cfg.footer}>
      ${active.map((item, i) => (reorder
        ? html`<div class="row" key=${item.id}>
            <span class="row-icon plain">${cfg.icon(item)}</span>
            <span class="row-label">${item.name}</span>
            <button class="icon-btn" disabled=${i === 0} onClick=${() => moveItem(kind, item.id, -1)} aria-label="Move up"><${Icon} name="arrowUp" size=${18} /></button>
            <button class="icon-btn" disabled=${i === active.length - 1} onClick=${() => moveItem(kind, item.id, 1)} aria-label="Move down"><${Icon} name="arrowDown" size=${18} /></button>
          </div>`
        : html`<${Row} key=${item.id} icon=${cfg.icon(item)} label=${item.name} detail=${cfg.detail(item)} onClick=${() => edit(item)} />`))}
      ${!reorder && html`<button class="row tappable add-row" onClick=${() => edit(cfg.blank())}><${Icon} name="plus" size=${20} /> Add ${cfg.noun}</button>`}
    <//>
    ${archived.length > 0 && html`<${Group} title="Archived" footer="Archived items are still used by past expenses but are hidden when adding new ones.">
      ${archived.map((item) => html`<${Row} key=${item.id} icon=${cfg.icon(item)}
        label=${html`${item.name}<small>Tap to restore</small>`}
        detail=${isInUse(kind, item.id) ? 'In use' : ''} onClick=${() => unarchive(item)} />`)}
    <//>`}
  <//>`;
}
