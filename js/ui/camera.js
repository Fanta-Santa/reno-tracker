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

export function CameraHost() {
  const [cam, setCam] = useState(null);
  showCamera = setCam;
  if (!cam) return null;
  return html`<${Camera} multiple=${cam.multiple} fallback=${cam.fallback}
    onDone=${(files) => { setCam(null); cam.resolve(files); }} />`;
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

function Camera({ multiple, fallback, onDone }) {
  const video = useRef();
  const stream = useRef(null);
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

  const finish = (files) => {
    stop();
    setShown(false);
    setTimeout(() => onDone(files), 200);
  };

  const capture = async () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
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
    setTimeout(async () => onDone(picked ? await picked : []), 200);
  };

  const cancel = () => finish(multiple ? shots.map((s) => s.file) : []);
  const lightLabel = lightWorks === false ? 'No light' : light ? 'Light on' : 'Light off';

  return html`<div class="camera ${shown ? 'open' : ''} ${phase}" role="dialog" aria-label="Camera">
    <video class="camera-video" ref=${video} playsinline muted autoplay />
    ${phase === 'live' && !still && html`<div class="camera-frame" aria-hidden="true"><span /><span /><span /><span /></div>`}
    ${flash && html`<div class="camera-flash" />`}

    <div class="camera-top">
      <button class="camera-round" onClick=${cancel} aria-label=${multiple && shots.length ? 'Done' : 'Close camera'}>
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
      <button class="wide-btn plain light" onClick=${() => finish([])}>Cancel</button>
    </div>`}

    ${still && html`<div class="camera-review">
      <img src=${still.url} alt="Photo of the receipt" />
      <div class="camera-bottom">
        <button class="camera-text" onClick=${retake}>Retake</button>
        <span />
        <button class="camera-text strong" onClick=${() => finish([still.file])}>Use photo</button>
      </div>
    </div>`}

    ${phase === 'live' && !still && html`<div class="camera-bottom">
      ${multiple && shots.length
        ? html`<span class="camera-stack"><img src=${shots[shots.length - 1].url} alt="" /><span class="camera-count">${shots.length}</span></span>`
        : fallback ? html`<button class="camera-text small" onClick=${useIphoneCamera}>iPhone camera</button>` : html`<span />`}
      <button class="shutter" onClick=${capture} aria-label="Take photo"><span /></button>
      ${multiple && shots.length
        ? html`<button class="camera-text strong" onClick=${() => finish(shots.map((s) => s.file))}>Done</button>`
        : html`<span class="camera-hint">${multiple ? 'Snap as many as you like' : ''}</span>`}
    </div>`}
    ${phase === 'live' && !still && html`<p class="camera-tip">Fit the whole receipt in the frame</p>`}
  </div>`;
}
