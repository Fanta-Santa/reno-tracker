// First run: (on iPhone) how to install to the Home Screen, then name the project and add rooms.

import { html, useState } from '../lib.js';
import { createProject } from '../store.js';
import { SUGGESTED_ROOMS, roomType } from '../defaults.js';
import { formatMoney } from '../format.js';
import { Switch } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { openRoomEditor } from './editors.js';
import { runRestore } from './settings.js';
import { isIOS, isStandalone } from '../device.js';

let skippedInstall = false;

export function SetupView() {
  const [step, setStep] = useState(isIOS() && !isStandalone() && !skippedInstall ? 'install' : 'welcome');
  const [name, setName] = useState('');
  const [rooms, setRooms] = useState(() => SUGGESTED_ROOMS.map((r, i) => ({ ...r, key: i, on: true, budgetCents: null })));
  const [saving, setSaving] = useState(false);

  if (step === 'install') return html`<${InstallGuide} onSkip=${() => { skippedInstall = true; setStep('welcome'); }} />`;

  if (step === 'welcome') {
    return html`<div class="setup">
      <div class="setup-hero">
        <img class="setup-icon" src="icons/icon.svg" alt="" width="140" height="140" />
        <h1>Reno Tracker</h1>
        <p>Snap every receipt, split it across rooms, and see what you’ve spent against your budget.</p>
      </div>
      <div class="setup-actions">
        <button class="wide-btn primary" onClick=${() => setStep('name')}>Start a new project</button>
        <button class="wide-btn secondary" onClick=${runRestore}><${Icon} name="restore" size=${20} /> Restore from a backup</button>
        <p class="fine-print">Everything stays on this phone. There are no accounts and nothing is uploaded.</p>
      </div>
    </div>`;
  }

  if (step === 'name') {
    return html`<div class="setup">
      <div class="setup-step">
        <span class="step-count">Step 1 of 2</span>
        <h1>What’s your project called?</h1>
        <input class="big-input" type="text" placeholder="e.g. Smith St reno" value=${name} autofocus
          onInput=${(e) => setName(e.currentTarget.value)}
          onKeyDown=${(e) => e.key === 'Enter' && name.trim() && setStep('rooms')} />
      </div>
      <div class="setup-actions">
        <button class="wide-btn primary" disabled=${!name.trim()} onClick=${() => setStep('rooms')}>Next</button>
        <button class="wide-btn plain" onClick=${() => setStep('welcome')}>Back</button>
      </div>
    </div>`;
  }

  const chosen = rooms.filter((r) => r.on);
  const update = (key, patch) => setRooms((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const edit = (r) => openRoomEditor({
    room: r,
    onSave: (next) => update(r.key, { ...next, on: true }),
    onDelete: () => setRooms((list) => list.filter((x) => x.key !== r.key)),
  });
  const add = () => openRoomEditor({
    room: { type: 'other', budgetCents: null },
    onSave: (next) => setRooms((list) => [...list, { ...next, key: Date.now(), on: true }]),
  });
  const finish = async () => {
    setSaving(true);
    try {
      await createProject({ name: name.trim(), rooms: chosen });
      navigator.storage?.persist?.();
    } finally {
      setSaving(false);
    }
  };

  return html`<div class="setup">
    <div class="setup-step">
      <span class="step-count">Step 2 of 2</span>
      <h1>Rooms & stages</h1>
      <p class="setup-sub">Pick the parts of the reno you’ll spend on. Tap one to rename it or set a budget. You can change all of this later in Settings.</p>
      <div class="list-card">
        ${rooms.map((r) => html`<div class="row setup-room ${r.on ? '' : 'off'}" key=${r.key}>
          <button class="setup-room-main" onClick=${() => edit(r)}>
            <span class="row-icon plain">${roomType(r.type).emoji}</span>
            <span class="row-label">${r.name}<small>${r.budgetCents != null ? `Budget ${formatMoney(r.budgetCents, { whole: true })}` : 'No budget yet'}</small></span>
          </button>
          <${Switch} label=${`Include ${r.name}`} checked=${r.on} onChange=${(on) => update(r.key, { on })} />
        </div>`)}
        <button class="row tappable add-row" onClick=${add}><${Icon} name="plus" size=${20} /> Add a room or stage</button>
      </div>
    </div>
    <div class="setup-actions">
      <button class="wide-btn primary" disabled=${!chosen.length || saving} onClick=${finish}>
        ${saving ? 'Setting up…' : `Create project with ${chosen.length} ${chosen.length === 1 ? 'room' : 'rooms'}`}
      </button>
      <button class="wide-btn plain" onClick=${() => setStep('name')}>Back</button>
    </div>
  </div>`;
}

function InstallGuide({ onSkip }) {
  return html`<div class="setup">
    <div class="setup-step">
      <div class="setup-house small">📲</div>
      <h1>Add it to your Home Screen first</h1>
      <p class="setup-sub">This turns the page into an app with its own icon. It also keeps your receipts safe: Safari can clear data from websites you haven’t visited for a while, but not from Home Screen apps.</p>
      <ol class="install-steps">
        <li><span class="install-num">1</span><span>Tap the <strong>Share</strong> button <${Icon} name="share" size=${18} /> in Safari. If you can’t see it, tap <strong>•••</strong> first.</span></li>
        <li><span class="install-num">2</span><span>Scroll down and tap <strong>Add to Home Screen</strong>.</span></li>
        <li><span class="install-num">3</span><span>Leave <strong>Open as Web App</strong> switched on, then tap <strong>Add</strong>.</span></li>
        <li><span class="install-num">4</span><span>Open <strong>Reno</strong> from your Home Screen and set up your project there.</span></li>
      </ol>
    </div>
    <div class="setup-actions">
      <button class="wide-btn plain" onClick=${onSkip}>Continue in Safari anyway</button>
      <p class="fine-print">Anything you enter here in Safari stays separate from the Home Screen app.</p>
    </div>
  </div>`;
}
