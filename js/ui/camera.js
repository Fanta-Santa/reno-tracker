// The app's own camera, which opens with the iPhone's light switched on. Receipts read much better
// when they're evenly lit. (Web apps can't turn on the flash in the iPhone's built-in camera, but they
// can use the light.) If the camera can't start, it offers the iPhone camera instead.

import { html, useEffect, useRef, useState } from '../lib.js';
import { Icon } from './icons.js';
import { state, setPrefs } from '../store.js';

let showCamera = () => {};

export const cameraSupported = () => !!navigator.mediaDevices?.getUserMedia;

/** Use the app's camera rather than the iPhone's? (Settings → Receipt reading.) */
export const useAppCamera = () => state.prefs.appCamera !== false && cameraSupported();

/**
 * Opens the camera. Resolves with the photos taken as Files ([] if closed).
 * multiple: keep shooting until Done. fallback(): opens the iPhone camera (must run straight from a tap).
 */
export function openCamera({ multiple = false, fallback }) {
  return new Promise((resolve) => showCamera({ multiple, fallback, resolve }));
}

/**
 * The ＋ button's camera. After each photo: Check now (resolves { action: 'check', files }) or Sort later (saved
 * through onLater(file) while the camera stays open for the next one). Under the shutter sit the other ways in,
 * `extras`: [{ id, label, icon, pick? }]. One with pick() runs it straight from the tap (a file picker) and resolves
 * { action: 'extra', id, files }; the others resolve { action: 'extra', id } once the camera has closed. Closing
 * resolves { action: 'closed', later } with how many went to the inbox.
 */
export function openAddCamera({ extras = [], onLater, fallback }) {
  return new Promise((resolve) => showCamera({ add: true, extras, onLater, fallback, resolve }));
}

export function CameraHost() {
  const [cam, setCam] = useState(null);
  showCamera = setCam;
  if (!cam) return null;
  return html`<${Camera} multiple=${cam.multiple} add=${cam.add} extras=${cam.extras} onLater=${cam.onLater} fallback=${cam.fallback}
    onDone=${(result) => { setCam(null); cam.resolve(result); }} />`;
}

/**
 * The part of the video inside the guide frame (plus a little margin), in video pixels, allowing for the video
 * being scaled to fill the screen. Null if the frame isn't showing or the sums don't work out.
 */
function frameCrop(video, frame) {
  if (!frame) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const vr = video.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  if (!vw || !vh || !vr.width || !fr.width || !fr.height) return null;
  const scale = Math.max(vr.width / vw, vr.height / vh); // object-fit: cover
  const offX = vr.left + (vr.width - vw * scale) / 2;
  const offY = vr.top + (vr.height - vh * scale) / 2;
  const margin = 0.04; // a little around the frame, so an edge that's just outside isn't lost
  const x0 = Math.max(0, (fr.left - fr.width * margin - offX) / scale);
  const y0 = Math.max(0, (fr.top - fr.height * margin - offY) / scale);
  const x1 = Math.min(vw, (fr.right + fr.width * margin - offX) / scale);
  const y1 = Math.min(vh, (fr.bottom + fr.height * margin - offY) / scale);
  const w = Math.round(x1 - x0);
  const h = Math.round(y1 - y0);
  if (w < vw * 0.2 || h < vh * 0.2) return null;
  return { x: Math.round(x0), y: Math.round(y0), w, h };
}

/** Turns the light on or off. Returns true (worked), false (no light) or null (can't tell). */
async function setTorch(track, on) {
  if (!track) return false;
  const caps = track.getCapabilities?.() || {};
  if ('torch' in caps && !caps.torch) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
  } catch {
    try {
      await track.applyConstraints({ torch: on });
    } catch {
      return false;
    }
  }
  const settings = track.getSettings?.() || {};
  if ('torch' in settings) return settings.torch === on;
  return 'torch' in caps ? true : null;
}

function errorMessage(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    return 'Camera access is switched off for this app. Allow it when asked, or use the iPhone camera instead.';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'No camera was found.';
  return 'The camera couldn’t start.';
}

function Camera({ multiple, add, extras = [], onLater, fallback, onDone }) {
  const video = useRef();
  const frame = useRef();
  const stream = useRef(null);
  const [later, setLater] = useState(0); // ＋ camera: how many photos have gone to the inbox so far
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState('starting'); // starting | live | error
  const [error, setError] = useState(null);
  const [light, setLight] = useState(state.prefs.cameraLight !== false);
  const [lightWorks, setLightWorks] = useState(null);
  const [shots, setShots] = useState([]); // multiple mode: [{ file, url }]
  const [still, setStill] = useState(null); // single mode: the photo waiting for Use / Retake
  const [flash, setFlash] = useState(false);
  const [shown, setShown] = useState(false);
  const urls = useRef([]); // photo previews, freed when the camera closes

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    let alive = true;
    requestAnimationFrame(() => setShown(true));
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (!alive) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        const v = video.current;
        v.srcObject = s;
        await v.play();
        if (alive) setPhase('live');
      } catch (err) {
        console.warn('Camera failed', err);
        if (alive) {
          setError(err);
          setPhase('error');
        }
      }
    })();
    return () => {
      alive = false;
      stop();
    };
  }, []);

  // The light: on when the camera starts (unless you turned it off last time).
  useEffect(() => {
    if (phase !== 'live') return;
    const track = stream.current?.getVideoTracks()[0];
    setTorch(track, light).then(setLightWorks);
  }, [phase, light]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const toggleLight = () => {
    setLight(!light);
    setPrefs({ cameraLight: !light });
  };

  /** Closes the camera: the ＋ camera resolves a result, the others the photos taken. */
  const finish = (result) => {
    stop();
    setShown(false);
    setTimeout(() => onDone(result), 200);
  };
  const closeAdd = () => finish({ action: 'closed', later });

  const capture = async () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    // Keep just what's inside the guide frame: a cleaner picture to read, and to look at later
    const crop = frameCrop(v, frame.current) || { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight };
    const canvas = document.createElement('canvas');
    canvas.width = crop.w;
    canvas.height = crop.h;
    canvas.getContext('2d').drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    canvas.width = canvas.height = 0;
    const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
    const shot = { file, url: URL.createObjectURL(blob) };
    urls.current.push(shot.url);
    if (multiple) setShots((list) => [...list, shot]);
    else setStill(shot);
  };

  const retake = () => setStill(null);

  const useIphoneCamera = () => {
    stop();
    const picked = fallback?.(); // opens straight away, from this tap
    setShown(false);
    setTimeout(async () => {
      const files = picked ? await picked : [];
      onDone(add ? (files.length ? { action: 'check', files } : { action: 'closed', later }) : files);
    }, 200);
  };

  // ＋ camera: the photo just taken
  const checkNow = () => finish({ action: 'check', files: [still.file] });
  const sortLater = async () => {
    setSaving(true);
    try {
      await onLater(still.file);
      setLater((n) => n + 1);
      setStill(null);
    } finally {
      setSaving(false);
    }
  };
  const runExtra = (x) => {
    if (x.pick) {
      stop();
      const picked = x.pick(); // the file picker must open straight from this tap
      setShown(false);
      setTimeout(async () => onDone({ action: 'extra', id: x.id, files: await picked }), 200);
    } else {
      finish({ action: 'extra', id: x.id });
    }
  };

  const cancel = () => (add ? closeAdd() : finish(multiple ? shots.map((s) => s.file) : []));
  const lightLabel = lightWorks === false ? 'No light' : light ? 'Light on' : 'Light off';

  return html`<div class="camera ${shown ? 'open' : ''} ${phase} ${add ? 'add' : ''}" role="dialog" aria-label="Camera">
    <video class="camera-video" ref=${video} playsinline muted autoplay />
    ${phase === 'live' && !still && html`<div class="camera-frame" ref=${frame} aria-hidden="true"><span /><span /><span /><span /></div>`}
    ${flash && html`<div class="camera-flash" />`}

    <div class="camera-top">
      <button class="camera-round" onClick=${cancel} aria-label=${(multiple && shots.length) || later ? 'Done' : 'Close camera'}>
        <${Icon} name="x" size=${22} stroke=${2.2} /></button>
      ${phase === 'live' && !still && html`<button class="camera-light ${light && lightWorks !== false ? 'on' : ''}"
        disabled=${lightWorks === false} onClick=${toggleLight} aria-pressed=${light} aria-label="Light">
        <${Icon} name="bolt" size=${18} stroke=${2} /> ${lightLabel}</button>`}
    </div>

    ${phase === 'starting' && html`<div class="camera-message"><span class="spinner light" /></div>`}
    ${phase === 'error' && html`<div class="camera-message">
      <${Icon} name="camera" size=${40} />
      <strong>${errorMessage(error)}</strong>
      ${fallback && html`<button class="wide-btn primary" onClick=${useIphoneCamera}>Use iPhone camera</button>`}
      ${add && extras.length > 0 && html`<div class="camera-extras">${extras.map((x) => html`<button class="camera-extra" key=${x.id} onClick=${() => runExtra(x)}>
        <${Icon} name=${x.icon} size=${18} /> ${x.label}</button>`)}</div>`}
      <button class="wide-btn plain light" onClick=${cancel}>Cancel</button>
    </div>`}

    ${still && html`<div class="camera-review">
      <img src=${still.url} alt="Photo of the receipt" />
      ${add ? html`<div class="camera-choices">
        <button class="camera-text" onClick=${retake} disabled=${saving}>Retake</button>
        <div class="camera-choice-row">
          <button class="wide-btn secondary dark" onClick=${sortLater} disabled=${saving}><${Icon} name="inbox" size=${20} /> Sort later</button>
          <button class="wide-btn primary" onClick=${checkNow} disabled=${saving}><${Icon} name="check" size=${20} stroke=${2.4} /> Check now</button>
        </div>
      </div>` : html`<div class="camera-bottom">
        <button class="camera-text" onClick=${retake}>Retake</button>
        <span />
        <button class="camera-text strong" onClick=${() => finish([still.file])}>Use photo</button>
      </div>`}
    </div>`}

    ${phase === 'live' && !still && html`<div class="camera-bottom">
      ${multiple && shots.length
        ? html`<span class="camera-stack"><img src=${shots[shots.length - 1].url} alt="" /><span class="camera-count">${shots.length}</span></span>`
        : later ? html`<span class="camera-stack inbox" aria-label=${`${later} saved to sort later`}><${Icon} name="inbox" size=${24} /><span class="camera-count">${later}</span></span>`
          : fallback ? html`<button class="camera-text small" onClick=${useIphoneCamera}>iPhone camera</button>` : html`<span />`}
      <button class="shutter" onClick=${capture} aria-label="Take photo"><span /></button>
      ${(multiple && shots.length) || later
        ? html`<button class="camera-text strong" onClick=${cancel}>Done</button>`
        : html`<span class="camera-hint">${multiple ? 'Snap as many as you like' : ''}</span>`}
    </div>`}
    ${phase === 'live' && !still && add && extras.length > 0 && html`<div class="camera-extras">
      ${extras.map((x) => html`<button class="camera-extra" key=${x.id} onClick=${() => runExtra(x)}><${Icon} name=${x.icon} size=${18} /> ${x.label}</button>`)}
    </div>`}
    ${phase === 'live' && !still && html`<p class="camera-tip">Fit the whole receipt in the frame</p>`}
  </div>`;
}
