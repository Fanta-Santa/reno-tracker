# Third-party code

Copied in as-is so the app needs no install or build step, and works offline.

| File | From | Licence |
|---|---|---|
| `preact-htm.js` | `htm@3.1.1`, file `preact/standalone.module.js` (htm + Preact 10 in one file) | htm: Apache-2.0 (`LICENSE-htm.txt`). Preact: MIT (below) |
| `tesseract/tesseract.min.js`, `tesseract/worker.min.js` | `tesseract.js@7.0.0`, `dist/tesseract.esm.min.js` (renamed) and `dist/worker.min.js` | Apache-2.0 (`tesseract/LICENSE.txt`) |
| `tesseract/core/*-lstm.wasm.js` | `tesseract.js-core@7.0.0` (the three LSTM-only builds; each phone downloads just the one it needs) | Apache-2.0 |
| `tesseract/lang/eng.traineddata.gz` | `@tesseract.js-data/eng@1.0.0`, `4.0.0_best_int/` (Tesseract's English model) | Apache-2.0 (model), MIT (package) |
| `pdfjs/pdf.min.js`, `pdfjs/pdf.worker.min.js` | `pdfjs-dist@4.10.38`, `build/pdf.min.mjs` and `build/pdf.worker.min.mjs` (renamed to `.js` so every web host serves them as JavaScript) | Apache-2.0 (`pdfjs/LICENSE.txt`) |

To update one, download the package with `npm pack <name>@<version>`, copy the same file over, and bump `VERSION` in `sw.js`
(for anything in `tesseract/`, bump `READER_CACHE` instead).

## Preact licence (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
