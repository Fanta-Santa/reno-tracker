// Facts about the phone/browser the app is running in.

/** True when opened from the Home Screen icon rather than a Safari tab. */
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Where the link was opened, so the install steps can match what's on screen:
 * 'safari' (iPhone/iPad Safari, the only place an iPhone can add it reliably), 'in-app' (inside Facebook, Instagram,
 * Gmail and the like, which can't add to the Home Screen), 'ios-other' (Chrome, Firefox… on an iPhone),
 * 'android' (Chrome and most others), 'samsung' (Samsung Internet) or 'computer'.
 */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|MicroMessenger|Line\/|TikTok|musical_ly|Pinterest|GSA\/|Twitter/;
export function browserKind(ua = navigator.userAgent, ios = isIOS()) {
  if (IN_APP.test(ua)) return 'in-app';
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave/.test(ua) ? 'ios-other' : 'safari';
  if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? 'samsung' : 'android';
  return 'computer';
}

/** Should first-run setup start with "add it to your Home Screen"? On phones, when it isn't installed yet. */
export const needsInstall = () => !isStandalone() && browserKind() !== 'computer';

// Chrome on Android offers to install the app. We hold on to the offer, so the install screen (or Settings) can
// show it when the person taps Install.
let installOffer = null;
let installed = false;
const installListeners = new Set();
const installChanged = () => { for (const fn of installListeners) fn(); };
globalThis.addEventListener?.('beforeinstallprompt', (event) => {
  event.preventDefault();
  installOffer = event;
  installChanged();
});
globalThis.addEventListener?.('appinstalled', () => {
  installOffer = null;
  installed = true;
  installChanged();
});

/** 'offer' (a tap on Install can install it), 'installed' (just now), or null (follow the written steps). */
export const installState = () => (installed ? 'installed' : installOffer ? 'offer' : null);
export function onInstallChange(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}
/** Shows Chrome's own "Install app?" box. Resolves true if they said yes. */
export async function promptInstall() {
  const offer = installOffer;
  if (!offer) return false;
  installOffer = null; // each offer can only be shown once
  await offer.prompt();
  const { outcome } = await offer.userChoice;
  installChanged();
  return outcome === 'accepted';
}

/**
 * Sends a link through the phone's Share sheet (Messages, WhatsApp, email…), or copies it where there's no Share
 * sheet (or with copyOnly). Resolves 'shared', 'copied', 'cancelled' or 'failed'.
 */
export async function shareLink({ title, text, url, copyOnly = false }) {
  if (navigator.share && !copyOnly) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text ? `${text} ${url}` : url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * Hands a file to the phone: the Share sheet on iPhone (Save to Files, Mail, AirDrop…), or a normal download
 * elsewhere. Returns false if the person cancelled.
 */
export async function shareFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (err) {
      if (err.name === 'AbortError') return false;
      throw err;
    }
    return true;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
