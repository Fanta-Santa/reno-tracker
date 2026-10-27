# Reno Tracker

Installable web app (PWA) for tracking DIY renovation receipts, aimed at iPhone Safari "Add to Home Screen".
Hosted on GitHub Pages from the repo root of `main`. All data lives on-device in IndexedDB. There is no server
and there are no accounts. The owner is not a developer, so explain run/test steps plainly.

## Rules

- **No build step, no npm dependencies at runtime.** Plain ES modules; third-party code is copied into `vendor/`
  (Preact + htm for UI, pdf.js for PDFs). Use `.js` extensions for anything the browser loads as a module.
- **Every asset path is relative** (no leading `/`): the site is served from `/reno-tracker/`.
- **Money is integer cents** (`js/format.js`). GST is 1/11 of a GST-inclusive total. Never use floats for totals.
- **Dates are stored `YYYY-MM-DD` (local) and shown `dd/mm/yyyy`.** Currency is AUD.
- **When adding/removing/renaming any file the app loads, update `FILES` in `sw.js`.** When releasing, bump
  `VERSION` in `sw.js` and `APP_VERSION` in `js/version.js` together. The unit tests enforce both.
- Changing the IndexedDB shape needs a `DB_VERSION` bump with an upgrade path in `js/db.js`, plus a `SCHEMA` bump
  and migration in `js/backup.js` so old backups still restore.
- Destructive actions use an Undo toast (`toastUndo`), not confirmation dialogs. The exception is restore, which
  replaces everything and so asks first.
- Room `type` (see `ROOM_TYPES` in `js/defaults.js`) decides where a room sits on the dashboard house.
- Receipt reading is on-device only (Tesseract in `vendor/tesseract/`, loaded on first use and cached by the
  service worker under `READER_CACHE`). Never send receipt images or text off the phone. `js/reader/parse.js` and
  `categorize.js` are pure; add a case to `tests/reader.test.mjs` for every receipt format fixed.
- Expense lines may carry `description` (a receipt item). Lines marked `auto` were made up by the app (e.g. the
  unmatched remainder) and are not learned from.

## Checks before pushing

```sh
node --test tests/unit.test.mjs tests/reader.test.mjs
node tests/e2e.mjs --shots <scratch dir>   # Playwright + Chromium, phone viewport; review the screenshots
```
