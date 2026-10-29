# Reno Tracker

A phone app for tracking DIY renovation spending: snap receipts, split them across rooms, and see spending against budget.
It's a web app you add to your iPhone Home Screen. There are no accounts and no servers. Everything is stored on the phone itself.

**Open it:** https://fanta-santa.github.io/reno-tracker/ (in Safari on iPhone, then Share → Add to Home Screen)

## What's in it so far (Stage 1)

- First-run setup: name the project and pick rooms/stages, each with an optional budget and a type
- Add an expense by photo, PDF/screenshot upload, or manual entry
- AUD amounts with GST worked out automatically (or GST-free / custom)
- Split one receipt across several rooms and categories; flag tools
- Receipt inbox: quick-snap now, fill in details later
- Smart defaults: today's date, last store and room, and each store's usual category
- Duplicate warning (same store, date and total)
- Expenses list with search, filters, sorting, swipe to delete, and an Undo bar instead of "Are you sure?"
- Receipt viewer with pinch-zoom, including multi-page PDFs
- Settings for rooms, categories and stores, plus a full backup and restore (.zip with every receipt)

## Receipt reading

- Snap or upload a receipt and the app reads the store, date, total, GST and every line item, right on the phone.
  PDFs from online orders are read exactly; photos go through Tesseract, a free text-recognition engine that runs
  in the browser (about 7 MB, downloaded the first time it's used, then kept offline).
- Each item gets a suggested category and tool flag. Confirmation cards then ask only about what the app isn't
  sure of: the details (one tap if right), the room, any unclear items, and a final summary.
- Quick-snapped receipts are read in the background, so the inbox is ready to check.
- The app remembers the categories you pick for items and suggests them next time.
- Anything not matched to an item is saved as "Other items", with the receipt lines it probably covers listed
  underneath (on the summary card, the expense and the edit form). Tap + on a line to make it its own item.
- The app's own camera opens with the iPhone's light on (web apps can't switch on the flash in the iPhone's
  built-in camera, but they can use the light). It can take several receipts in a row for Quick snap, and offers
  the iPhone camera if it can't start. Switch it off in Settings → Receipt reading.
- It can be switched off in Settings → Receipt reading.

## Dashboard (Stage 2)

- An illustrated early-1900s Australian cottage on a floating island, built from your rooms: always single-storey,
  with rooms either side of a central hallway once there are more than three. Cream weatherboards, a coral
  corrugated-iron hipped roof (your roof/exterior work) and bullnose verandah (your deck/outdoor area), plus a garage
  shed, garden, Hills Hoist and picket fence, softly lit at dusk by lamplit windows and porch and gate lamps.
  Whole-house stages (like Painting) float above as tags.
- It starts closed up with the roof on: just your project's name, the house, and a status at the top right that
  shows the budget at a glance (✓ on track, ! at risk, or ‼ over budget). Tap the house (or the status) and the roof
  lifts off to show every room; drag the roof back down to close it up.
- Every room shows its budget status with a badge: ✓ on track, ! nearly at budget (90%+), ‼ over budget.
  Tap a room to lift it and see what's been spent there, its top categories and recent receipts.
- Warnings for anything over (or nearly over) budget, the headline numbers (spent, budget, committed, remaining),
  payments coming up (quotes and bills with a due date), and charts: budget by room (each bar is that room's own
  budget), tools vs everything else, spending by category, and a smooth spend-over-time line.

## Quotes (Stage 3)

- Log a quote from a tradie or supplier (amount, room/stage, category, notes, and the quote itself as a photo or PDF,
  read on the phone to fill in the blanks). Add one from the Quotes tab or the ＋ button.
- One tap moves a quote between Quoted · Accepted · Paid. Swipe a quote left for the next step (a long swipe does it
  straight away), or to decline it. Declined quotes are tucked away and can be restored.
- Accepted quotes count as committed on the dashboard (tap the Committed tile to see them) until they're paid.
- Record a deposit or progress payment with Add payment. Tapping Paid opens the final payment, filled in with
  what's left to pay. Each payment is a normal expense, tagged "Quote" and linked back to its quote.
- Quoted vs actual: paid quotes show ▲ over or ▼ under the quote, in dollars and %.
- Undo takes back a payment and the status change it caused, together.
- A quote can cover several categories (e.g. labour, equipment hire and freight): tap each one and type the amounts
  for the extras; the first one gets the rest. Add a missing category (like Freight) right there with ＋ New.
  Attached quotes with priced lines are split automatically. Payments are split across the categories in proportion.
- Bills to pay go in the same way. Switch on "Payment due" to set when the next payment is due: it shows under
  Payments coming up on the dashboard (overdue ‼, due within a week !) with the total due in the next 30 days.

## Export and backups (Stage 4)

- Settings → Export to Excel or CSV, or the share button on the Expenses list to export just what you've filtered
  (a room, a store, a date range…).
- Excel: tabs for a Summary (totals, GST, budget, by room and category), every Expense, every Item (splits on
  their own rows, with their share of the GST) and your Quotes. Dates are real dates and amounts are real numbers,
  so sums, filters and pivot tables work. CSV: every item, for any spreadsheet app.
- Choose everything, this financial year or last (1 July to 30 June), or the filtered list.
- Switch on Receipt photos to get one .zip with the spreadsheet and every photo and PDF, named to match the
  spreadsheet's references (R001 2026-10-01 Bunnings.jpg).
- The backup reminder on the dashboard only shows when something has changed since your last backup: after
  14 days, or sooner once 10 or more receipts and quotes are new or changed.

## The look ("Glass")

- A soft evening sky behind every screen: peach at the top, pink in the middle and lilac at the bottom, starting as
  the light grey iOS draws behind the clock, so there's no line at the very top.
- Frosted glass cards, deep plum text, cobalt-blue links and choices, and a coral-to-pink ＋ button and main
  buttons. Titles and amounts use Bricolage Grotesque; everything else uses Aptos (or Albert Sans where Aptos
  isn't installed).
- The app icon is a budget ring: a glass ring filling up as you spend, with the house in the middle.

Coming next: the install guide for friends, and dark mode.

## How it's built

Plain HTML, CSS and JavaScript with no build step. Opening `index.html` through any web server runs the app.

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | Page shell and all the styling |
| `icons/` | The app icon: `icon.svg`, and the PNGs drawn from it by `node tools/make-icons.mjs` |
| `js/main.js` | Starts the app, picks the screen, draws the tab bar |
| `js/store.js`, `js/db.js` | Your data, saved in the phone's built-in database (IndexedDB) |
| `js/format.js` | Money (whole cents), GST and dd/mm/yyyy dates |
| `js/stats.js` | Dashboard numbers: budget status, by room, by category, spend over time |
| `js/images.js` | Shrinks photos and makes thumbnails; reads PDFs |
| `js/backup.js`, `js/zip.js` | Backup and restore as one .zip file |
| `js/export.js` | Spreadsheet export: Excel (.xlsx) and CSV |
| `js/ui/` | Shared pieces: sheets, Undo bar, switches, receipt viewer |
| `js/reader/` | Receipt reading: text from photos/PDFs (`ocr.js`), making sense of it (`parse.js`), category suggestions (`categorize.js`), background reading (`queue.js`) |
| `js/views/` | The screens (`review.js` is the confirmation cards, `quotes.js` the Quotes tab) |
| `sw.js` | Keeps the app working offline and delivers updates |
| `vendor/` | Small third-party libraries, copied in (see `vendor/README.md`) |

## Trying it on a computer

```sh
node tests/serve.mjs        # then open http://localhost:8080
```

## Tests

```sh
node --test tests/unit.test.mjs tests/reader.test.mjs tests/stats.test.mjs   # no browser needed
node tests/e2e.mjs                # clicks through the whole app in a phone-sized browser (needs Playwright)
```
