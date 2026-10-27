// Turns photos, screenshots and PDFs into what we store: a reasonably sized file plus a small thumbnail.
// Photos are re-saved as JPEG, which also strips hidden data such as GPS location.

import { uid } from './store.js';

const MAX_PIXELS = 2_400_000; // about 1900 x 1270: plenty to read a receipt, ~300 KB
const MAX_SIDE = 4096;
const THUMB_SIDE = 360;

export const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

/** Prepares a picked file for saving: { id, type, name, blob, thumb }. */
export async function prepareFile(file) {
  return isPdf(file) ? preparePdf(file) : prepareImage(file);
}

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("That picture couldn't be opened. Try a photo, screenshot or PDF.");
  } finally {
    // The decoded image stays usable after the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the picture.'))), 'image/jpeg', quality);
  });
}

async function drawScaled(source, width, height, scale, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // screenshots can be transparent; JPEG can't
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, quality);
  canvas.width = canvas.height = 0; // free memory straight away on iPhone
  return blob;
}

async function prepareImage(file) {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)), MAX_SIDE / Math.max(w, h));
  const blob = await drawScaled(img, w, h, scale, 0.72);
  const thumb = await drawScaled(img, w, h, Math.min(1, THUMB_SIDE / Math.max(w, h)), 0.7);
  return { id: uid(), type: 'image/jpeg', name: (file.name || 'receipt').replace(/\.\w+$/, '') + '.jpg', blob, thumb };
}

async function preparePdf(file) {
  let thumb = null;
  try {
    const pdf = await openPdf(file);
    const page = await pdf.getPage(1);
    const canvas = await renderPage(page, THUMB_SIDE * 2);
    thumb = await canvasToBlob(canvas, 0.7);
    pdf.destroy();
  } catch (err) {
    console.warn('PDF preview failed', err);
  }
  const blob = file.type === 'application/pdf' ? file : new Blob([file], { type: 'application/pdf' });
  return { id: uid(), type: 'application/pdf', name: file.name || 'receipt.pdf', blob, thumb };
}

// ---------- PDF (pdf.js is only loaded when a PDF is used) ----------

let pdfjsPromise;

function loadPdfjs() {
  pdfjsPromise ??= import('../vendor/pdfjs/pdf.min.js').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
    return pdfjs;
  });
  return pdfjsPromise;
}

export async function openPdf(blob) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

/** Renders a PDF page onto a new canvas that is `pixelWidth` wide. */
export async function renderPage(page, pixelWidth) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: pixelWidth / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}
