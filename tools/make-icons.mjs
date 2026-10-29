// Draws the app's PNG icons from icons/icon.svg (Home Screen, Android and the install prompt use the PNGs).
// Run: node tools/make-icons.mjs    (needs Playwright with Chromium, like the end-to-end test)
// Not part of the app: the PNGs it writes are checked in.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ICONS = fileURLToPath(new URL('../icons/', import.meta.url));
const svg = readFileSync(`${ICONS}icon.svg`, 'utf8');
const SIZES = { 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name, size] of Object.entries(SIZES)) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: `${ICONS}${name}`, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`  icons/${name} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
