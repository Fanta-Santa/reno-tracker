// Screens are addressed by the part of the link after '#', e.g. #/expenses/abc123.

import { useEffect, useState } from '../lib.js';

let depth = 0; // how many screens deep we've gone inside the app (for Back buttons)

export function currentPath() {
  return location.hash.replace(/^#/, '') || '/';
}

export function navigate(path, { replace = false } = {}) {
  if (currentPath() === path) return;
  if (replace) {
    history.replaceState(null, '', `#${path}`);
    dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    depth += 1;
    location.hash = path;
  }
}

/** Goes back a screen, or to `fallback` when the app was opened straight onto this one. */
export function goBack(fallback) {
  if (depth > 0) {
    depth -= 1;
    history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}

export function useRoute() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return path;
}
