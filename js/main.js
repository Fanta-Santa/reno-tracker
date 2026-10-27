// Starts the app: loads your data, picks the screen from the link, and draws the tab bar.

import { html, render, useLayoutEffect, useRef } from './lib.js';
import { loadAll, useStore, inboxExpenses } from './store.js';
import { useRoute, navigate } from './ui/router.js';
import { SheetHost, ToastHost, BusyHost, toast } from './ui/kit.js';
import { ViewerHost } from './ui/viewer.js';
import { Icon } from './ui/icons.js';
import { DashboardView, QuotesView } from './views/dashboard.js';
import { ExpensesView, ExpenseDetailView, InboxView } from './views/expenses.js';
import { SettingsView, ListSettingsView } from './views/settings.js';
import { SetupView } from './views/setup.js';
import { openAddMenu } from './views/capture.js';

function screenFor(path) {
  const parts = path.split('/').filter(Boolean);
  switch (parts[0]) {
    case undefined: return { tab: 'home', view: html`<${DashboardView} />` };
    case 'expenses':
      return parts[1]
        ? { tab: 'expenses', view: html`<${ExpenseDetailView} id=${parts[1]} />` }
        : { tab: 'expenses', view: html`<${ExpensesView} />` };
    case 'inbox': return { tab: 'expenses', view: html`<${InboxView} />` };
    case 'quotes': return { tab: 'quotes', view: html`<${QuotesView} />` };
    case 'settings':
      return ['rooms', 'categories', 'stores'].includes(parts[1])
        ? { tab: 'settings', view: html`<${ListSettingsView} kind=${parts[1]} />` }
        : { tab: 'settings', view: html`<${SettingsView} />` };
    default: return { tab: 'home', view: html`<${DashboardView} />` };
  }
}

function TabBar({ tab }) {
  const inbox = inboxExpenses().length;
  const item = (id, path, icon, label, badge) => html`<a href=${`#${path}`} class="tab ${tab === id ? 'active' : ''}"
    aria-current=${tab === id ? 'page' : undefined} onClick=${(e) => { e.preventDefault(); navigate(path); }}>
    <span class="tab-icon"><${Icon} name=${icon} size=${24} stroke=${tab === id ? 2.1 : 1.8} />
      ${badge > 0 && html`<span class="tab-badge">${badge}</span>`}</span>
    <span class="tab-label">${label}</span>
  </a>`;
  return html`<nav class="tab-bar" aria-label="Main">
    ${item('home', '/', 'house', 'Home')}
    ${item('expenses', '/expenses', 'list', 'Expenses', inbox)}
    <button class="tab-add" onClick=${openAddMenu} aria-label="Add expense"><${Icon} name="plus" size=${28} stroke=${2.4} /></button>
    ${item('quotes', '/quotes', 'quote', 'Quotes')}
    ${item('settings', '/settings', 'gear', 'Settings')}
  </nav>`;
}

// Each screen remembers how far down you'd scrolled.
const scrollPositions = new Map();
let scrollPath = null;
addEventListener('scroll', () => { if (scrollPath) scrollPositions.set(scrollPath, scrollY); }, { passive: true });

function App() {
  const s = useStore();
  const path = useRoute();
  const lastPath = useRef(null);

  useLayoutEffect(() => {
    if (lastPath.current !== path) {
      lastPath.current = path;
      scrollPath = null; // ignore the scroll jump while the new screen swaps in
      scrollTo(0, scrollPositions.get(path) || 0);
      requestAnimationFrame(() => { scrollPath = path; });
    }
  }, [path]);

  const overlays = html`<${SheetHost} /><${ViewerHost} /><${ToastHost} /><${BusyHost} />`;
  if (!s.loaded) return html`<div class="splash"><span class="spinner" /></div>`;
  if (!s.project) return html`<div class="app"><${SetupView} />${overlays}</div>`;

  const { tab, view } = screenFor(path);
  return html`<div class="app">
    <main class="screen" key=${path}>${view}</main>
    <${TabBar} tab=${tab} />
    ${overlays}
  </div>`;
}

function ErrorScreen({ error }) {
  return html`<div class="setup"><div class="setup-step">
    <div class="setup-house small">😕</div>
    <h1>The app couldn’t start</h1>
    <p class="setup-sub">${error?.message || String(error)}</p>
    <button class="wide-btn primary" onClick=${() => location.reload()}>Try again</button>
  </div></div>`;
}

// ---------- Updates (service worker) ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  // Reload once a new version takes over, but not on the very first visit.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) {
      reloading = true;
      location.reload();
    }
  });

  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => toast('A new version of the app is ready', {
      actionLabel: 'Update',
      onAction: () => worker.postMessage('skipWaiting'),
      duration: 10 * 60 * 1000,
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    // Check for a new version whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('Offline support unavailable', err));
}

// ---------- Start ----------

const root = document.getElementById('app');
render(html`<${App} />`, root);
loadAll()
  .then(() => navigator.storage?.persist?.())
  .catch((err) => {
    console.error(err);
    render(html`<${ErrorScreen} error=${err} />`, root);
  });
registerServiceWorker();
