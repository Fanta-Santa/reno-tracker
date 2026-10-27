// Facts about the phone/browser the app is running in.

/** True when opened from the Home Screen icon rather than a Safari tab. */
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
