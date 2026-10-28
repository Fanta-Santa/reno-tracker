// Turns a receipt (photo, screenshot or PDF) into lines of text, entirely on the phone.
//  - PDFs from online orders usually contain real text, which is read exactly.
//  - Photos and screenshots go through Tesseract, a free text-recognition engine that runs
//    inside the browser. Its files (~7 MB) download from this site the first time and are then kept offline.

import { openPdf, renderPage } from '../images.js';

const BASE = new URL('../../vendor/tesseract/', import.meta.url).href;
const IDLE_MS = 90_000; // free the reader's memory after a while unused

let workerPromise = null;
let idleTimer;
let onProgress = null; // the current job's progress callback

function report(status, progress) {
  onProgress?.({ status, progress });
}

async function getWorker() {
  clearTimeout(idleTimer);
  if (!workerPromise) {
    workerPromise = (async () => {
      report('Getting the receipt reader ready', 0);
      const { default: Tesseract } = await import('../../vendor/tesseract/tesseract.min.js');
      const worker = await Tesseract.createWorker('eng', 1 /* LSTM only */, {
        workerPath: `${BASE}worker.min.js`,
        corePath: `${BASE}core/`,
        langPath: `${BASE}lang`,
        workerBlobURL: false,
        cacheMethod: 'none', // the app's offline cache keeps these files; no second copy needed
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text') report('Reading receipt', m.progress);
          else report('Getting the receipt reader ready', m.progress);
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: '4', // a single column of text of variable sizes: suits receipts
        preserve_interword_spaces: '1', // keep the gap between an item and its price
        debug_file: '/dev/null', // silence the engine's chatter ("Estimating resolution as …")
      });
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

function scheduleRelease() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const pending = workerPromise;
    workerPromise = null;
    try { (await pending)?.terminate(); } catch { /* already gone */ }
  }, IDLE_MS);
}

// ---------- Image clean-up before reading ----------

async function loadBitmap(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Greyscale, evens out shadows and uneven lighting, and boosts contrast, so faded
 * thermal-paper receipts read better. Returns a canvas.
 */
export async function prepareForReading(source) {
  const img = source instanceof Blob ? await loadBitmap(source) : source;
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  // Text reads best at roughly 1200–2000 px wide.
  const scale = Math.min(2, Math.max(1, 1400 / w0), 2600 / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  // A blurry, tiny copy approximates the paper's brightness everywhere (the "background").
  const bw = Math.max(8, Math.round(w / 24));
  const bh = Math.max(8, Math.round(h / 24));
  const bg = document.createElement('canvas');
  bg.width = bw;
  bg.height = bh;
  const bctx = bg.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(canvas, 0, 0, bw, bh);
  const bgData = bctx.getImageData(0, 0, bw, bh).data;

  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const gray = new Float32Array(w * h);
  let lo = 255;
  let hi = 0;
  for (let y = 0; y < h; y++) {
    const by = Math.min(bh - 1, Math.floor((y / h) * bh));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const bx = Math.min(bw - 1, Math.floor((x / w) * bw));
      const b = (by * bw + bx) * 4;
      const g = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
      const back = Math.max(40, 0.299 * bgData[b] + 0.587 * bgData[b + 1] + 0.114 * bgData[b + 2]);
      const v = Math.min(255, (g / back) * 235); // divide out the lighting
      gray[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < gray.length; i++) {
    const v = ((gray[i] - lo) / range) * 255; // stretch contrast to the full range
    const p = i * 4;
    px[p] = px[p + 1] = px[p + 2] = v;
    px[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  bg.width = bg.height = 0;
  return canvas;
}

// ---------- Reading ----------

function linesFromResult(data) {
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const text = (line.text || '').replace(/\s+$/, '');
        if (text.trim()) lines.push({ text, confidence: Math.round(line.confidence ?? 0) });
      }
    }
  }
  if (!lines.length && data.text) {
    for (const t of data.text.split('\n')) if (t.trim()) lines.push({ text: t, confidence: Math.round(data.confidence ?? 50) });
  }
  return lines;
}

async function ocrCanvas(canvas) {
  const worker = await getWorker();
  try {
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    return linesFromResult(data);
  } finally {
    scheduleRelease();
  }
}

/** Real text inside a PDF, grouped into lines. Returns null if the PDF is just a picture. */
async function pdfText(pdf) {
  const lines = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 6); n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const [, , , , x, y] = it.transform;
      const height = Math.abs(it.height || it.transform[3]) || 8;
      let row = rows.find((r) => Math.abs(r.y - y) < height * 0.55);
      if (!row) {
        row = { y, height, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x, width: it.width || it.str.length * height * 0.5, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y); // PDF y runs bottom-up
    for (const row of rows) {
      row.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let end = null;
      for (const part of row.parts) {
        if (end != null) {
          const gap = part.x - end;
          text += gap > row.height * 1.2 ? '    ' : gap > row.height * 0.15 ? ' ' : '';
        }
        text += part.str;
        end = part.x + part.width;
      }
      if (text.trim()) lines.push({ text, confidence: 99 });
    }
  }
  return lines.join('').length > 15 || lines.length > 3 ? lines : null;
}

let queue = Promise.resolve();

/**
 * Reads a receipt file ({ blob, type }) and returns
 * { lines: [{ text, confidence }], source: 'pdf-text' | 'ocr' }.
 * progress({ status, progress }) is called as it goes. One receipt is read at a time.
 */
export function readReceiptFile(file, progress) {
  const job = queue.then(() => readOne(file, progress));
  queue = job.catch(() => {});
  return job;
}

async function readOne(file, progress) {
  onProgress = progress;
  try {
    if (file.type === 'application/pdf') {
      const pdf = await openPdf(file.blob);
      try {
        const text = await pdfText(pdf);
        if (text) return { lines: text, source: 'pdf-text' };
        // A scanned PDF: read the first page as a picture.
        const page = await pdf.getPage(1);
        const canvas = await renderPage(page, 1600);
        return { lines: await ocrCanvas(await prepareForReading(canvas)), source: 'ocr' };
      } finally {
        pdf.destroy();
      }
    }
    const canvas = await prepareForReading(file.blob);
    const lines = await ocrCanvas(canvas);
    canvas.width = canvas.height = 0;
    return { lines, source: 'ocr' };
  } finally {
    onProgress = null;
  }
}
