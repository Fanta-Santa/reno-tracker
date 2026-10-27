// Full-screen receipt viewer: pinch to zoom, drag to move, double-tap to zoom in/out,
// swipe sideways between receipts and swipe down to close. PDFs show every page.

import { html, useEffect, useRef, useState } from '../lib.js';
import { Icon } from './icons.js';
import { getFile } from '../store.js';
import { openPdf, renderPage } from '../images.js';
import { toast } from './kit.js';

const MAX_PDF_PAGES = 15;

let setViewer = () => {};

/** files: array of saved file ids, or pending files ({ id, blob, type, name }). */
export function openViewer(files, index = 0) {
  setViewer({ files, index });
}

export function ViewerHost() {
  const [viewer, set] = useState(null);
  setViewer = set;
  if (!viewer) return null;
  return html`<${Viewer} ...${viewer} onClose=${() => set(null)} />`;
}

async function loadFile(f) {
  if (typeof f === 'string') return getFile(f);
  return f;
}

function Viewer({ files, index: startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const [file, setFile] = useState(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setShown(true));
    const onKey = (e) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let alive = true;
    setFile(null);
    loadFile(files[index]).then((f) => alive && setFile(f || { missing: true }));
    return () => { alive = false; };
  }, [index]);

  const close = () => {
    setShown(false);
    setTimeout(onClose, 220);
  };
  const go = (step) => {
    const next = index + step;
    if (next >= 0 && next < files.length) setIndex(next);
  };

  const share = async () => {
    if (!file?.blob) return;
    const shared = new File([file.blob], file.name || 'receipt', { type: file.type });
    if (navigator.canShare?.({ files: [shared] })) {
      try { await navigator.share({ files: [shared] }); } catch { /* cancelled */ }
    } else {
      toast("Sharing isn't available in this browser.");
    }
  };

  return html`<div class="viewer ${shown ? 'open' : ''}">
    <div class="viewer-bar">
      <button class="viewer-btn" onClick=${close} aria-label="Close"><${Icon} name="x" size=${22} stroke=${2.2} /></button>
      <span class="viewer-count">${files.length > 1 ? `${index + 1} of ${files.length}` : ''}</span>
      <button class="viewer-btn" onClick=${share} aria-label="Share"><${Icon} name="share" size=${22} /></button>
    </div>
    ${!file && html`<div class="viewer-loading"><span class="spinner light" /></div>`}
    ${file?.missing && html`<div class="viewer-loading">This receipt couldn't be found.</div>`}
    ${file?.blob && html`<${ZoomPane} key=${index} file=${file}
      onSwipe=${(dir) => (dir === 'down' ? close() : go(dir === 'left' ? 1 : -1))} />`}
    ${files.length > 1 && html`<div class="viewer-dots">
      ${files.map((_, i) => html`<span class=${i === index ? 'on' : ''} />`)}
    </div>`}
  </div>`;
}

function ZoomPane({ file, onSwipe }) {
  const outer = useRef();
  const inner = useRef();
  const view = useRef({ s: 1, x: 0, y: 0, fit: 1, cw: 1, ch: 1, vw: 1, vh: 1, tall: false });
  const [ready, setReady] = useState(false);
  const isPdf = file.type === 'application/pdf';

  const apply = (animate) => {
    const v = view.current;
    inner.current.style.transition = animate ? 'transform .25s cubic-bezier(.2,.8,.2,1)' : 'none';
    inner.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`;
  };

  const clamp = () => {
    const v = view.current;
    const w = v.cw * v.s;
    const h = v.ch * v.s;
    v.x = w <= v.vw ? (v.vw - w) / 2 : Math.min(0, Math.max(v.vw - w, v.x));
    v.y = h <= v.vh ? (v.vh - h) / 2 : Math.min(0, Math.max(v.vh - h, v.y));
  };

  const reset = (animate) => {
    const v = view.current;
    v.s = v.fit;
    v.x = 0;
    v.y = 0;
    clamp();
    apply(animate);
  };

  const measure = (cw, ch) => {
    const v = view.current;
    const box = outer.current.getBoundingClientRect();
    Object.assign(v, { cw, ch, vw: box.width, vh: box.height });
    v.fit = isPdf ? box.width / cw : Math.min(box.width / cw, box.height / ch);
    inner.current.style.width = `${cw}px`;
    inner.current.style.height = `${ch}px`;
    reset(false);
    setReady(true);
  };

  // Load the image or render the PDF pages.
  useEffect(() => {
    let alive = true;
    let url;
    const el = inner.current;
    if (isPdf) {
      (async () => {
        try {
          const pdf = await openPdf(file.blob);
          const width = outer.current.getBoundingClientRect().width;
          // Sharp enough to read when zoomed, without using so much memory that iPhone Safari gives up.
          const pixelWidth = Math.min(1600, Math.round(width * (devicePixelRatio || 2)));
          const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
          if (pdf.numPages > pages) toast(`Showing the first ${pages} of ${pdf.numPages} pages. Share it to see the rest.`);
          let top = 0;
          for (let n = 1; n <= pages && alive; n++) {
            const canvas = await renderPage(await pdf.getPage(n), pixelWidth);
            const h = (canvas.height / canvas.width) * width;
            Object.assign(canvas.style, { position: 'absolute', left: 0, top: `${top}px`, width: `${width}px`, height: `${h}px` });
            canvas.className = 'viewer-page';
            el.append(canvas);
            top += h + 12;
            measure(width, top - 12);
          }
          pdf.destroy();
        } catch (err) {
          console.error(err);
          if (alive) toast("This PDF couldn't be shown.", { icon: 'alert' });
        }
      })();
    } else {
      url = URL.createObjectURL(file.blob);
      const img = new Image();
      img.className = 'viewer-img';
      img.alt = 'Receipt';
      img.onload = () => {
        if (!alive) return;
        img.style.width = `${img.naturalWidth}px`;
        img.style.height = `${img.naturalHeight}px`;
        el.append(img);
        measure(img.naturalWidth, img.naturalHeight);
      };
      img.src = url;
    }
    return () => {
      alive = false;
      el.replaceChildren();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  // Gestures
  useEffect(() => {
    const el = outer.current;
    const pointers = new Map();
    let gesture = null;
    let lastTap = 0;

    const mid = () => {
      const [a, b] = [...pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const local = (e) => {
      const box = el.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };

    const down = (e) => {
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, local(e));
      const v = view.current;
      if (pointers.size === 2) {
        const m = mid();
        gesture = { type: 'pinch', s0: v.s, d0: m.d, px: (m.x - v.x) / v.s, py: (m.y - v.y) / v.s };
      } else if (pointers.size === 1) {
        const p = pointers.get(e.pointerId);
        gesture = { type: 'pan', sx: p.x, sy: p.y, x0: v.x, y0: v.y, t0: performance.now(), moved: false };
      }
    };

    const move = (e) => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, local(e));
      const v = view.current;
      if (gesture.type === 'pinch' && pointers.size >= 2) {
        const m = mid();
        v.s = Math.min(v.fit * 6, Math.max(v.fit * 0.8, gesture.s0 * (m.d / gesture.d0)));
        v.x = m.x - gesture.px * v.s;
        v.y = m.y - gesture.py * v.s;
        apply(false);
      } else if (gesture.type === 'pan') {
        const p = pointers.get(e.pointerId);
        const dx = p.x - gesture.sx;
        const dy = p.y - gesture.sy;
        if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
        const fitsW = v.cw * v.s <= v.vw + 1;
        const fitsH = v.ch * v.s <= v.vh + 1;
        v.x = gesture.x0 + (fitsW ? dx * 0.35 : dx);
        v.y = gesture.y0 + (fitsH ? Math.max(0, dy) * 0.6 : dy);
        apply(false);
      }
    };

    const up = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      const v = view.current;
      if (gesture?.type === 'pan' && pointers.size === 0) {
        const p = local(e);
        const dx = p.x - gesture.sx;
        const dy = p.y - gesture.sy;
        const fitsW = v.cw * v.s <= v.vw + 1;
        const fitsH = v.ch * v.s <= v.vh + 1;
        if (!gesture.moved) {
          const now = performance.now();
          if (now - lastTap < 300) {
            // Double-tap: zoom in around the finger, or back out.
            if (v.s > v.fit * 1.05) reset(true);
            else {
              const s = v.fit * 2.5;
              v.x = p.x - ((p.x - v.x) / v.s) * s;
              v.y = p.y - ((p.y - v.y) / v.s) * s;
              v.s = s;
              clamp();
              apply(true);
            }
            lastTap = 0;
            return;
          }
          lastTap = now;
        } else if (fitsH && dy > 110 && Math.abs(dy) > Math.abs(dx)) {
          onSwipe('down');
          return;
        } else if (fitsW && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
          onSwipe(dx < 0 ? 'left' : 'right');
        }
        clamp();
        apply(true);
        gesture = null;
      } else if (gesture?.type === 'pinch' && pointers.size < 2) {
        if (v.s < v.fit) v.s = v.fit;
        clamp();
        apply(true);
        // Carry on panning with the remaining finger.
        const [id] = pointers.keys();
        if (id !== undefined) {
          const p = pointers.get(id);
          gesture = { type: 'pan', sx: p.x, sy: p.y, x0: v.x, y0: v.y, moved: true };
        } else gesture = null;
      }
    };

    const onResize = () => {
      const v = view.current;
      if (v.cw > 1) {
        const box = el.getBoundingClientRect();
        Object.assign(v, { vw: box.width, vh: box.height });
        v.fit = isPdf ? box.width / v.cw : Math.min(box.width / v.cw, box.height / v.ch);
        reset(false);
      }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      removeEventListener('resize', onResize);
    };
  }, []);

  return html`<div class="viewer-stage" ref=${outer}>
    <div class="viewer-content ${ready ? 'ready' : ''}" ref=${inner} />
    ${!ready && html`<div class="viewer-loading"><span class="spinner light" /></div>`}
  </div>`;
}
