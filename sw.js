// Service worker: keeps a copy of the app on the phone so it opens instantly and works offline.
// When VERSION changes, phones download the new files and the app offers an "Update" button.
// Your data is NOT stored here. It lives in the app's database and is never touched by updates.

const VERSION = '0.1.0';
const CACHE = `reno-tracker-${VERSION}`;

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/backup.js',
  'js/db.js',
  'js/defaults.js',
  'js/device.js',
  'js/format.js',
  'js/images.js',
  'js/lib.js',
  'js/main.js',
  'js/store.js',
  'js/version.js',
  'js/zip.js',
  'js/ui/icons.js',
  'js/ui/kit.js',
  'js/ui/router.js',
  'js/ui/viewer.js',
  'js/views/capture.js',
  'js/views/dashboard.js',
  'js/views/editors.js',
  'js/views/expense-form.js',
  'js/views/expenses.js',
  'js/views/settings.js',
  'js/views/setup.js',
  'vendor/preact-htm.js',
  'vendor/pdfjs/pdf.min.js',
  'vendor/pdfjs/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('reno-tracker-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(request);
    }
    return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
  })());
});
