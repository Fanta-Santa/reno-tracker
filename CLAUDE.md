# Reno Tracker

Installable web app (PWA) for tracking DIY renovation receipts, aimed at iPhone Safari "Add to Home Screen".
Hosted on GitHub Pages from the repo root of `main`. All data lives on-device in IndexedDB. There is no server
and there are no accounts. The owner is not a developer, so explain run/test steps plainly.

## Rules

- **Font:** `"Aptos"` first (where installed), then Albert Sans (OFL, bundled in `vendor/fonts/`). Aptos itself
  must not be bundled: its licence doesn't allow it on a public website. Titles and amounts use `--font-display`
  (`--font-round` points at it): Bricolage Grotesque (OFL, bundled in `vendor/fonts/`, with its optical sizes).
- **The look is "Glass":** a pastel sky (`--sky`: peach → pink → lilac) fixed behind everything on `body::before`,
  deep plum ink (`--text` #2a1640, `--text-2` #5e4a6e), cobalt accent (`--accent` #2f5bea) and the coral → pink
  `--hot` gradient for the ＋ button and primary buttons. Sheets are a lighter piece of the sky (`--sheet-bg`), over a
  plum backdrop. Separators inside glass cards are fine white lines.
- **Cards are glass:** use `var(--card)` + `var(--card-blur)` + `var(--card-border)` + `var(--shadow-card)`, not solid
  white. See-through white (`--surface-2`, `--fill`) vanishes on solid white, so solid-white cards (the receipt
  confirmation cards) override those tokens with a pink-lilac tint.
- **App icon:** the budget ring in `icons/icon.svg` (full bleed, everything inside the middle 80% so it also works as
  a maskable icon). After changing it, redraw the PNGs with `node tools/make-icons.mjs` (Playwright) and bump `VERSION`.
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
  an early-1900s Australian cottage (cream weatherboards, coral corrugated iron, bullnose verandah, in soft pastels to
  suit the sky), softly lit at dusk (lamplit windows, porch and gate lamps; gradients in `Defs`). Up to 3 rooms in a
  row; more go either side of a central hallway with low-cut interior walls. It starts closed (roof on, side wall up)
  with a budget status pill top right of the dashboard; tapping it lifts the roof up and back, fades the side wall
  (`layer: 'shell'`) and shows the room pins. The roof goes back on by dragging it down (no button; a
  screen-reader-only one). Status overlays (class `st`) only show while it's open. Closed, the top of the dashboard
  is just the title, the status pill and the house, sitting straight on the sky (no background of its own, so no
  edges).
- Dashboard numbers come from `js/stats.js` (pure). Budget status: 'none' | 'ok' | 'near' (90%+, or accepted quotes
  would tip it over) | 'over'. Status colours (#0ca30c / #fab219 / #d03b3b) always come with a ✓ / ! / ‼ badge.
- Charts (`js/ui/charts.js`): spending is #2a78d6, tools #eb6834 (pair validated for colour blindness); one axis only.
  The spend line is blurred with `smoothSeries()` (Gaussian, real start and end, never dips) and drawn with
  `smoothPath()` (monotone cubic, never overshoots); labels and the table show the real numbers. Budget bars are
  per room: each bar's full length is that room's own budget.
- Screens that read the store use `useStore()`, which catches up on changes made before it subscribed.
- Quotes (`js/views/quotes.js`): status 'quoted' | 'accepted' | 'paid' | 'declined'. Payments are ordinary expenses
  with `quoteId`; `quoteProgress()` in `js/stats.js` works out paid / still owed / quoted vs actual. Committed =
  accepted quotes less what's been paid against them. Choosing Paid with money owed opens the final payment form;
  the form's `onSaved` hook updates the quote and its undo is folded into the payment's Undo. A quote can cover
  several categories: `parts` [{ categoryId, amountCents }] (first = `categoryId`, which gets the rest; read with
  `quoteParts()`). Payments are split across the parts in proportion (`splitByWeights()`, the form's `shares`).
  Quotes (and bills, entered the same way) may have a `dueDate` for the next payment; `upcomingPayments()` feeds the
  dashboard's "Payments coming up" card until the quote is paid or declined.
- Export (`js/export.js`, pure): `buildSheets()` makes the Summary / Expenses / Items / Quotes tabs, `toXLSX()` writes
  a real .xlsx by hand (Office Open XML zipped with `createZip`, dates as Excel dates, amounts as numbers) and
  `toCSV()` the Items tab (BOM, dd/mm/yyyy, formula-safe). Expenses are numbered R001… oldest first; receipt photos
  in an export zip are named to match. The sheet is `js/views/export.js`; files go out through `shareFile()`
  (`js/device.js`). Financial years are 1 July – 30 June (`financialYear()`).
- Backup reminders come from `backupReminder()` in `js/stats.js`: only when something changed since the last backup,
  and then after 14 days or 10 changes.
- Receipt reading is on-device only (Tesseract in `vendor/tesseract/`, loaded on first use and cached by the
  service worker under `READER_CACHE`). Never send receipt images or text off the phone. `js/reader/parse.js` and
  `categorize.js` are pure; add a case to `tests/reader.test.mjs` for every receipt format fixed.
- Expense lines may carry `description` (a receipt item). Lines marked `auto` were made up by the app (e.g. the
  unmatched remainder) and are not learned from; an `auto` line may carry `unmatched` (receipt text lines it covers).
- `pickFiles('camera')` opens the app's own camera (`js/ui/camera.js`, getUserMedia with the torch on) unless
  `prefs.appCamera === false`; it falls back to the iPhone camera (`<input capture>`) from a tap.
- The friends' guide is `guide.html` (+ `css/guide.css`, on top of `css/app.css`): a plain page with no app code, linked
  from Settings (`?from=app` turns its buttons into "Back to the app") and shared by `shareWithFriend()`, which sends
  only the link. Keep it in step with the app when features or install steps change. The service worker serves the
  pages it keeps as themselves; any other address opens the app. Install steps follow `browserKind()` in
  `js/device.js` ('safari' | 'in-app' | 'ios-other' | 'android' | 'samsung' | 'computer'); Android's install offer
  (`beforeinstallprompt`) is kept there too.
- The top of the page matches the light grey (`--statusbar`, #fbfbfb) iOS draws behind the clock in Home Screen apps:
  the sky fades in from it. While a sheet is open, `SheetHost` sets `theme-color` to #bcb6c3 (that grey under the
  backdrop).

## Checks before pushing

```sh
node --test tests/unit.test.mjs tests/reader.test.mjs tests/stats.test.mjs
node tests/e2e.mjs --shots <scratch dir>   # Playwright + Chromium, phone viewport; review the screenshots
```
