// First run: (on a phone) how to install it to the Home Screen, then name the project and add rooms.

import { html, useEffect, useState } from '../lib.js';
import { createProject } from '../store.js';
import { SUGGESTED_ROOMS, roomType } from '../defaults.js';
import { formatMoney } from '../format.js';
import { Switch, toast } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { openRoomEditor } from './editors.js';
import { runRestore } from './settings.js';
import { isIOS, browserKind, needsInstall, installState, onInstallChange, promptInstall, shareLink } from '../device.js';

let skippedInstall = false;

/** The friends' guide (how to install and use the app), next to the app itself. */
export const GUIDE = 'guide.html';

export function SetupView() {
  const [step, setStep] = useState(needsInstall() && !skippedInstall ? 'install' : 'welcome');
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
        <a class="link-btn small guide-link" href=${GUIDE}><${Icon} name="book" size=${18} /> How it works, in 2 minutes</a>
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

const Step = ({ n, children }) => html`<li><span class="install-num">${n}</span><span>${children}</span></li>`;

/** Copies the app's link, to paste into Safari (or Chrome) when it was opened somewhere that can't install it. */
async function copyAppLink() {
  const url = new URL('./', location.href).href;
  const result = await shareLink({ title: 'Reno Tracker', text: '', url, copyOnly: true });
  if (result === 'copied') toast('Link copied. Now paste it into the address bar.', { icon: 'check' });
  else toast(`Copy this link: ${url}`, { duration: 20000 });
}

/**
 * Before setup on a phone: how to install the app from wherever the link was opened. Safari on iPhone gets the
 * Share → Add to Home Screen steps; a preview inside another app (Facebook, Instagram, Gmail…) or another iPhone
 * browser is sent to Safari first; Android gets Chrome's Install button, or the menu steps.
 */
function InstallGuide({ onSkip }) {
  const kind = browserKind();
  const [install, setInstall] = useState(installState());
  useEffect(() => onInstallChange(() => setInstall(installState())), []);
  const ios = isIOS();
  const browser = ios ? 'Safari' : 'Chrome';
  const homeScreen = ios ? 'Home Screen' : 'home screen';

  let title = 'Add it to your Home Screen first';
  let intro = html`This turns the page into an app with its own icon. It also keeps your receipts safe: Safari can clear
    data from websites you haven’t visited for a while, but not from Home Screen apps.`;
  let steps = null;
  let action = null;
  let skip = 'Continue in Safari anyway';
  let note = 'Anything you enter here in Safari stays separate from the Home Screen app.';

  if (kind === 'safari') {
    steps = [
      html`Tap the <strong>Share</strong> button <${Icon} name="share" size=${18} /> in Safari. If you can’t see it, tap <strong>•••</strong> first.`,
      html`Scroll down and tap <strong>Add to Home Screen</strong> <${Icon} name="addSquare" size=${18} />.`,
      html`Leave <strong>Open as Web App</strong> switched on, then tap <strong>Add</strong>.`,
      html`Open <strong>Reno</strong> from your Home Screen and set up your project there.`,
    ];
  } else if (kind === 'in-app') {
    title = `Open this in ${browser} first`;
    intro = `You’re looking at this inside another app, which can’t add it to your ${homeScreen}. Open it in ${browser} instead.`;
    steps = [
      html`Tap <strong>•••</strong> or the menu, at the top or bottom of the screen.`,
      html`Choose <strong>Open in ${browser}</strong>. It might say <strong>Open in browser</strong>.`,
      html`Then follow the steps there to add it to your ${homeScreen}.`,
    ];
    action = html`<button class="wide-btn secondary" onClick=${copyAppLink}><${Icon} name="copy" size=${20} /> Or copy the link</button>`;
    skip = 'Continue here anyway';
    note = 'Apps like this can clear what you add here, so your receipts might not be kept.';
  } else if (kind === 'ios-other') {
    title = 'Open this in Safari first';
    intro = 'On iPhone, Safari is the surest way to add it to your Home Screen, where your receipts are kept safe.';
    steps = [
      html`Tap <strong>Copy the link</strong> below.`,
      html`Open <strong>Safari</strong>, tap the address bar, paste the link and go.`,
      html`Tap <strong>Share</strong> <${Icon} name="share" size=${18} />, then <strong>Add to Home Screen</strong>.`,
    ];
    action = html`<button class="wide-btn primary" onClick=${copyAppLink}><${Icon} name="copy" size=${20} /> Copy the link</button>`;
    skip = 'Continue here anyway';
  } else {
    // Android: Chrome (or Samsung Internet)
    title = install === 'installed' ? 'It’s installed' : 'Install it on your phone first';
    intro = install === 'installed'
      ? 'Open Reno from your home screen (or your list of apps) and set up your project there.'
      : 'It gets its own icon, opens like an app and works offline.';
    if (install === 'offer') {
      action = html`<button class="wide-btn primary" onClick=${promptInstall}><${Icon} name="addSquare" size=${20} /> Install Reno Tracker</button>`;
    } else if (install !== 'installed') {
      steps = kind === 'samsung' ? [
        html`Tap the menu <strong>≡</strong> at the bottom right.`,
        html`Tap <strong>Add page to</strong>, then <strong>Home screen</strong>.`,
        html`Open <strong>Reno</strong> from your home screen and set up your project there.`,
      ] : [
        html`Tap the menu <${Icon} name="dotsVertical" size=${18} stroke=${3} /> at the top right of Chrome.`,
        html`Tap <strong>Install app</strong>. On some phones it’s <strong>Add to Home screen</strong>, then <strong>Install</strong>.`,
        html`Open <strong>Reno</strong> from your home screen and set up your project there.`,
      ];
    }
    skip = install === 'installed' ? 'Set it up here instead' : 'Continue in the browser';
    note = 'It’s the same app either way: the icon just opens it quicker.';
  }

  return html`<div class="setup">
    <div class="setup-step">
      <img class="setup-icon small" src="icons/icon.svg" alt="" width="92" height="92" />
      <h1>${title}</h1>
      <p class="setup-sub">${intro}</p>
      ${steps && html`<ol class="install-steps">${steps.map((text, i) => html`<${Step} n=${i + 1}>${text}<//>`)}</ol>`}
    </div>
    <div class="setup-actions">
      ${action}
      <button class="wide-btn plain" onClick=${onSkip}>${skip}</button>
      <p class="fine-print">${note}</p>
      <a class="link-btn small guide-link" href=${GUIDE}><${Icon} name="book" size=${18} /> Read the guide</a>
    </div>
  </div>`;
}
