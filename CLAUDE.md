# Reno Tracker

Installable web app (PWA) for tracking DIY renovation receipts, aimed at iPhone Safari "Add to Home Screen".
Hosted on GitHub Pages from the repo root of `main`. All data lives on-device in IndexedDB. There is no server
and there are no accounts. The owner is not a developer, so explain run/test steps plainly.

## Rules

- **Font:** `"Aptos"` first (where installed), then Albert Sans (OFL, bundled in `vendor/fonts/`). Aptos itself
  must not be bundled: its licence doesn't allow it on a public website.
- **Cards are glass:** use `var(--card)` + `var(--card-blur)` + `var(--card-border)`, not solid white.
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
- Room `type` (see `ROOM_TYPES` in `js/defaults.js`) decides where a room sits on the dashboard house
  (`js/views/house.js`, hand-drawn isometric SVG; `buildHouse()` lays it out). The house is always single-storey:
  an early-1900s Australian cottage (cream weatherboards, red corrugated iron, bullnose verandah). Up to 3 rooms in
  a row; more go either side of a central hallway with low-cut interior walls. The roof floats up and back.
- Dashboard numbers come from `js/stats.js` (pure). Budget status: 'none' | 'ok' | 'near' (90%+, or accepted quotes
  would tip it over) | 'over'. Status colours (#0ca30c / #fab219 / #d03b3b) always come with a ✓ / ! / ‼ badge.
- Charts (`js/ui/charts.js`): spending is #2a78d6, tools #eb6834 (pair validated for colour blindness); one axis only.
  Lines are smoothed with `smoothPath()` (monotone cubic, never overshoots).
- Screens that read the store use `useStore()`, which catches up on changes made before it subscribed.
- Quotes (`js/views/quotes.js`): status 'quoted' | 'accepted' | 'paid' | 'declined'. Payments are ordinary expenses
  with `quoteId`; `quoteProgress()` in `js/stats.js` works out paid / still owed / quoted vs actual. Committed =
  accepted quotes less what's been paid against them. Choosing Paid with money owed opens the final payment form;
  the form's `onSaved` hook updates the quote and its undo is folded into the payment's Undo.
- Receipt reading is on-device only (Tesseract in `vendor/tesseract/`, loaded on first use and cached by the
  service worker under `READER_CACHE`). Never send receipt images or text off the phone. `js/reader/parse.js` and
  `categorize.js` are pure; add a case to `tests/reader.test.mjs` for every receipt format fixed.
- Expense lines may carry `description` (a receipt item). Lines marked `auto` were made up by the app (e.g. the
  unmatched remainder) and are not learned from; an `auto` line may carry `unmatched` (receipt text lines it covers).
- `pickFiles('camera')` opens the app's own camera (`js/ui/camera.js`, getUserMedia with the torch on) unless
  `prefs.appCamera === false`; it falls back to the iPhone camera (`<input capture>`) from a tap.
- The top of the page matches the light grey (`--statusbar`, #fbfbfb) iOS draws behind the clock in Home Screen apps.

## Checks before pushing

```sh
node --test tests/unit.test.mjs tests/reader.test.mjs tests/stats.test.mjs
node tests/e2e.mjs --shots <scratch dir>   # Playwright + Chromium, phone viewport; review the screenshots
```
