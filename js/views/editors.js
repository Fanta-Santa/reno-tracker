// Edit sheets for rooms/stages, categories and stores (used by setup and Settings).

import { html, useState } from '../lib.js';
import { state, activeCategories } from '../store.js';
import { ROOM_TYPES } from '../defaults.js';
import { centsToInput, parseMoney } from '../format.js';
import { openSheet, SheetHeader, Switch, toast } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';

/**
 * room: { name, type, budgetCents } (new or existing). onSave(updatedRoom).
 * onDelete is optional; shows a delete button when given.
 */
export function openRoomEditor({ room, onSave, onDelete }) {
  openSheet(({ close }) => html`<${RoomEditor} room=${room} close=${close} onSave=${onSave} onDelete=${onDelete} />`, { full: true });
}

function RoomEditor({ room, close, onSave, onDelete }) {
  const [name, setName] = useState(room.name || '');
  const [type, setType] = useState(room.type || 'other');
  const [budget, setBudget] = useState(centsToInput(room.budgetCents));
  const isNew = !room.name;

  const save = () => {
    const budgetCents = budget.trim() ? parseMoney(budget) : null;
    if (!name.trim()) return toast('Give it a name.', { icon: 'alert' });
    if (budget.trim() && (budgetCents == null || budgetCents < 0)) return toast('That budget doesn’t look right.', { icon: 'alert' });
    onSave({ ...room, name: name.trim(), type, budgetCents });
    close();
  };

  return html`<${SheetHeader} title=${isNew ? 'New room or stage' : 'Edit room or stage'} onCancel=${close} onDone=${save} doneLabel="Save" />
  <div class="sheet-body form">
    <div class="form-group">
      <label class="field">
        <span class="field-label">Name</span>
        <input type="text" placeholder="e.g. Ensuite, Back deck, Painting" value=${name}
          onInput=${(e) => setName(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="field-label">Budget (optional)</span>
        <div class="money-field"><span>$</span>
          <input inputmode="decimal" placeholder="No budget" value=${budget} onInput=${(e) => setBudget(e.currentTarget.value)} />
        </div>
      </label>
    </div>
    <div class="form-group">
      <span class="field-label">What is it? <small>This places it on your dashboard house.</small></span>
      <div class="type-grid">
        ${ROOM_TYPES.map((t) => html`<button type="button" class="type-tile ${type === t.id ? 'on' : ''}" onClick=${() => setType(t.id)}>
          <span class="type-emoji">${t.emoji}</span><span>${t.label}</span>
        </button>`)}
      </div>
    </div>
    ${onDelete && html`<div class="form-footer">
      <button class="wide-btn danger" onClick=${() => { close(); onDelete(); }}><${Icon} name="trash" size=${20} /> Delete</button>
    </div>`}
  </div>`;
}

export function openCategoryEditor({ category, onSave, onDelete }) {
  openSheet(({ close }) => html`<${CategoryEditor} category=${category} close=${close} onSave=${onSave} onDelete=${onDelete} />`);
}

function CategoryEditor({ category, close, onSave, onDelete }) {
  const [name, setName] = useState(category.name || '');
  const [isTool, setIsTool] = useState(!!category.isTool);
  const save = () => {
    if (!name.trim()) return toast('Give it a name.', { icon: 'alert' });
    onSave({ ...category, name: name.trim(), isTool });
    close();
  };
  return html`<${SheetHeader} title=${category.name ? 'Edit category' : 'New category'} onCancel=${close} onDone=${save} doneLabel="Save" />
  <div class="sheet-body form">
    <div class="form-group">
      <label class="field">
        <span class="field-label">Name</span>
        <input type="text" placeholder="e.g. Plumbing" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
      </label>
      <div class="field-row">
        <span class="tool-label"><${Icon} name="wrench" size=${18} /> Counts as tools <small>New items in this category are flagged as tools</small></span>
        <${Switch} label="Counts as tools" checked=${isTool} onChange=${setIsTool} />
      </div>
    </div>
    ${onDelete && html`<div class="form-footer">
      <button class="wide-btn danger" onClick=${() => { close(); onDelete(); }}><${Icon} name="trash" size=${20} /> Delete</button>
    </div>`}
  </div>`;
}

export function openStoreEditor({ store, onSave, onDelete }) {
  openSheet(({ close }) => html`<${StoreEditor} store=${store} close=${close} onSave=${onSave} onDelete=${onDelete} />`);
}

function StoreEditor({ store, close, onSave, onDelete }) {
  const [name, setName] = useState(store.name || '');
  const [categoryId, setCategoryId] = useState(store.defaultCategoryId || '');
  const save = () => {
    const clash = state.stores.find((s) => s.id !== store.id && s.name.toLowerCase() === name.trim().toLowerCase());
    if (!name.trim()) return toast('Give it a name.', { icon: 'alert' });
    if (clash) return toast(`${clash.name} is already in your list.`, { icon: 'alert' });
    onSave({ ...store, name: name.trim(), defaultCategoryId: categoryId || null });
    close();
  };
  return html`<${SheetHeader} title=${store.name ? 'Edit store' : 'New store'} onCancel=${close} onDone=${save} doneLabel="Save" />
  <div class="sheet-body form">
    <div class="form-group">
      <label class="field">
        <span class="field-label">Name</span>
        <input type="text" placeholder="e.g. Reece Plumbing" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="field-label">Usual category <small>Filled in for you when you pick this store</small></span>
        <select value=${categoryId} onChange=${(e) => setCategoryId(e.currentTarget.value)}>
          <option value="">None</option>
          ${activeCategories().map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      </label>
      ${store.name && html`<p class="field-note">Renaming also updates past expenses from ${store.name}.</p>`}
    </div>
    ${onDelete && html`<div class="form-footer">
      <button class="wide-btn danger" onClick=${() => { close(); onDelete(); }}><${Icon} name="trash" size=${20} /> Remove from quick-pick list</button>
    </div>`}
  </div>`;
}
