// Service worker: keeps a copy of the app on the phone so it opens instantly and works offline.
// When VERSION changes, phones download the new files and the app offers an "Update" button.
// Your data is NOT stored here. It lives in the app's database and is never touched by updates.

const VERSION = '0.10.0';
const CACHE = `reno-tracker-${VERSION}`;

// The receipt reader is big (~7 MB), so it isn't downloaded with the app. Each file is fetched the
// first time it's needed and then kept, across app updates. Bump this when vendor/tesseract changes.
const READER_CACHE = 'reno-tracker-reader-7.0.0';
const READER_FILES = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'vendor/tesseract/lang/eng.traineddata.gz',
];

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
  'js/export.js',
  'js/format.js',
  'js/images.js',
  'js/lib.js',
  'js/main.js',
  'js/stats.js',
  'js/store.js',
  'js/version.js',
  'js/zip.js',
  'js/reader/categorize.js',
  'js/reader/ocr.js',
  'js/reader/parse.js',
  'js/reader/queue.js',
  'js/ui/camera.js',
  'js/ui/charts.js',
  'js/ui/icons.js',
  'js/ui/kit.js',
  'js/ui/router.js',
  'js/ui/viewer.js',
  'js/views/capture.js',
  'js/views/dashboard.js',
  'js/views/editors.js',
  'js/views/expense-form.js',
  'js/views/expenses.js',
  'js/views/export.js',
  'js/views/house.js',
  'js/views/quotes.js',
  'js/views/review.js',
  'js/views/settings.js',
  'js/views/setup.js',
  'vendor/fonts/albert-sans.woff2',
  'vendor/fonts/bricolage-grotesque.woff2',
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
      if (key.startsWith('reno-tracker-') && key !== CACHE && key !== READER_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (READER_FILES.some((f) => url.pathname.endsWith(f))) {
    event.respondWith((async () => {
      const cache = await caches.open(READER_CACHE);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(request);
    }
    return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
  })());
});
