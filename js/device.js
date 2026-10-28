// Facts about the phone/browser the app is running in.

/** True when opened from the Home Screen icon rather than a Safari tab. */
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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
