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

Coming next: the interactive house dashboard with charts and budget warnings, quotes, CSV/Excel export, and the install guide for friends.

## How it's built

Plain HTML, CSS and JavaScript with no build step. Opening `index.html` through any web server runs the app.

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | Page shell and all the styling |
| `js/main.js` | Starts the app, picks the screen, draws the tab bar |
| `js/store.js`, `js/db.js` | Your data, saved in the phone's built-in database (IndexedDB) |
| `js/format.js` | Money (whole cents), GST and dd/mm/yyyy dates |
| `js/images.js` | Shrinks photos and makes thumbnails; reads PDFs |
| `js/backup.js`, `js/zip.js` | Backup and restore as one .zip file |
| `js/ui/` | Shared pieces: sheets, Undo bar, switches, receipt viewer |
| `js/views/` | The screens |
| `sw.js` | Keeps the app working offline and delivers updates |
| `vendor/` | Small third-party libraries, copied in (see `vendor/README.md`) |

## Trying it on a computer

```sh
node tests/serve.mjs        # then open http://localhost:8080
```

## Tests

```sh
node --test tests/unit.test.mjs   # money, GST, dates, backup zip (no browser needed)
node tests/e2e.mjs                # clicks through the whole app in a phone-sized browser (needs Playwright)
```
