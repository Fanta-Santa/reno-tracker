// The dashboard house: an early-1900s Australian cottage on a floating island, drawn from your rooms and stages.
// It's single-storey: interior rooms (kitchen, bathroom, bedroom, living, laundry, other) run in a row from the
// back of the house to the front. Cream weatherboards, a navy corrugated-iron hipped roof (your roof/exterior work)
// and a bullnose verandah (your first deck/outdoor area), lit by warm lamps at dusk. A garage shed, garden, Hills
// Hoist and picket fence sit around it. Whole-house stages (e.g. Painting) float above as tags.
// It starts closed up, with the roof on. Tap it and the roof lifts and the side wall fades, like a dollhouse, so you
// can see into each room, its budget status and tap it.

import { html, useEffect, useRef } from '../lib.js';
import { roomType } from '../defaults.js';

const S = 40; // pixels per unit
const C = Math.cos(Math.PI / 6);
const D = 1.15; // room depth
const H = 0.72; // wall height
const T = 0.07; // wall thickness
const SLAB = 0.09;
const FLOOR_Z = 0.12; // the cottage sits on low stumps
const VW = 0.62; // verandah width
const LOW = 0.34; // interior walls are cut low in a two-row house, so you can see the back rooms
const HALL = 0.32; // the central hallway between the two rows
const MAX_ROOMS = 10;

const STATUS = { ok: '#0ca30c', near: '#fab219', over: '#d03b3b' };
const FLOOR = {
  living: '#EACBA8', kitchen: '#F2E5CE', bathroom: '#D2E6EE', bedroom: '#E6DCF0', laundry: '#D7EBDE', other: '#EFE6D8',
};
const WALL_TOP = '#FFFDF8';
const WALL_BACK = '#F7F0E6';
const WALL_SIDE = '#EEE4D7';
// Cottage colours: cream weatherboards, white trim, navy corrugated iron, warm lamplight
const BOARD = '#F3E5CB'; // walls facing the soft evening light
const BOARD_SHADE = '#E6D3B5'; // walls in shade
const BOARD_LINE = '#E2CDAA';
const BOARD_LINE_SHADE = '#D6BF9C';
const IRON = '#3B4F73';
const IRON_LIGHT = '#4B628A';
const IRON_DARK = '#28374F';
const IRON_RIB = '#33466A';
const CAPPING = '#D3DAE6';
const BRICK = '#B56B52';
const SLAB_SIDE = '#E4DACC';
const WOOD = '#C69466';
const WHITE = '#FFFFFF';
const GREEN = '#7DBE74';
const DOOR = '#4E7A68'; // heritage green
// Gradients defined in <House>: lamplit glass, the soft glow around a lamp, and a pool of light on the floor.
const GLASS = 'url(#hs-glass)';
const GLOW = 'url(#hs-glow)';
const POOL = 'url(#hs-pool)';
const EAVE = 'url(#hs-eave)';

// From the back of the house to the front: wet areas at the back, bedrooms and the living room at the front.
const INTERIOR = ['laundry', 'bathroom', 'kitchen', 'other', 'living', 'bedroom'];

// ---------- Geometry ----------

const r2 = (n) => Math.round(n * 100) / 100;
// A slightly higher viewpoint than true isometric, so you can see into the rooms.
const P = (x, y, z) => [r2((x - y) * C * S), r2(((x + y) * 0.6 - z * 0.88) * S)];

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `#${((1 << 24) | (f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)}`;
}

const poly = (pts, fill, extra = {}) => ({ t: 'poly', pts, fill, ...extra });
const line = (pts, stroke, sw = 1) => ({ t: 'line', pts, stroke, sw });

/** A box seen from the front: its top, its left-front face (+y) and right-front face (+x). */
function box(x, y, z, w, d, h, color, { top, left, right, faces = 'lrt' } = {}) {
  const x1 = x + w;
  const y1 = y + d;
  const z1 = z + h;
  const out = [];
  if (faces.includes('l')) out.push(poly([P(x, y1, z1), P(x1, y1, z1), P(x1, y1, z), P(x, y1, z)], left || shade(color, -0.05)));
  if (faces.includes('r')) out.push(poly([P(x1, y, z1), P(x1, y1, z1), P(x1, y1, z), P(x1, y, z)], right || shade(color, -0.16)));
  if (faces.includes('t')) out.push(poly([P(x, y, z1), P(x1, y, z1), P(x1, y1, z1), P(x, y1, z1)], top || shade(color, 0.1)));
  return out;
}

const flat = (x, y, z, w, d, fill, extra) => poly([P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)], fill, extra);
/** A rectangle drawn on a wall facing the viewer's left (+y face at y = Y). */
const onY = (Y, xa, xb, za, zb, fill) => poly([P(xa, Y, zb), P(xb, Y, zb), P(xb, Y, za), P(xa, Y, za)], fill);
/** A rectangle drawn on a wall facing the viewer's right (+x face at x = X). */
const onX = (X, ya, yb, za, zb, fill) => poly([P(X, ya, zb), P(X, yb, zb), P(X, yb, za), P(X, ya, za)], fill);
const ball = (x, y, z, r, fill, cls) => ({ t: 'circle', c: P(x, y, z), r: r * S, fill, cls });
/** A soft glow (screen-space ellipse) around a light at (x, y, z); size in house units. */
const glow = (x, y, z, rx, ry = rx * 0.8, fill = GLOW) => ({ t: 'ellipse', c: P(x, y, z), rx: rx * S, ry: ry * S, fill });
/** A pool of lamplight on a floor at height z. */
const pool = (x, y, z, r) => ({ t: 'ellipse', c: P(x, y, z), rx: r * C * S * 1.4, ry: r * 0.6 * S * 1.4, fill: POOL });
function ringOnY(Y, cx, cz, r, fill) {
  const pts = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    pts.push(P(cx + r * Math.cos(a), Y, cz + r * Math.sin(a)));
  }
  return poly(pts, fill);
}

// A back-wall window seen from inside: the evening sky outside.
function windowOnY(Y, xa, xb, za, zb) {
  return [onY(Y, xa - 0.03, xb + 0.03, za - 0.03, zb + 0.03, WHITE), onY(Y, xa, xb, za, zb, '#CBD8EE'),
    onY(Y, (xa + xb) / 2 - 0.01, (xa + xb) / 2 + 0.01, za, zb, WHITE)];
}

/** A lamplit sash window on an outside wall facing the viewer's left (+y face), with its glow. */
function litWindowOnY(Y, xa, xb, za, zb) {
  const mid = (za + zb) / 2;
  return [
    onY(Y, xa - 0.035, xb + 0.035, za - 0.03, zb + 0.035, WHITE),
    onY(Y, xa, xb, za, zb, GLASS),
    onY(Y, xa, xb, mid - 0.008, mid + 0.008, WHITE),
    onY(Y, (xa + xb) / 2 - 0.007, (xa + xb) / 2 + 0.007, za, zb, WHITE),
    onY(Y, xa - 0.06, xb + 0.06, za - 0.055, za - 0.03, '#E8DCC6'), // sill
    glow((xa + xb) / 2, Y + 0.02, mid, (xb - xa) * 1.25, (zb - za) * 1.05),
  ];
}

// ---------- Furniture (x from the room's left wall, y from its back wall) ----------

function furniture(type, x0, y0, z0) {
  const b = (x, y, z, w, d, h, color, o) => box(x0 + x, y0 + y, z0 + z, w, d, h, color, o);
  const f = (x, y, z, w, d, fill) => flat(x0 + x, y0 + y, z0 + z, w, d, fill);
  const back = (xa, xb, za, zb, fill) => onY(y0 + T, x0 + xa, x0 + xb, z0 + za, z0 + zb, fill);
  switch (type) {
    case 'living': return [
      back(0.36, 0.62, 0.38, 0.58, '#F6C453'),
      f(0.18, 0.42, 0.004, 0.64, 0.52, '#F4A88C'),
      ...b(0.14, 0.1, 0, 0.62, 0.1, 0.32, '#5FB3B3'),
      ...b(0.1, 0.1, 0, 0.06, 0.34, 0.2, '#58A6A6'),
      ...b(0.16, 0.2, 0, 0.58, 0.22, 0.14, '#73C7C5'),
      ...b(0.74, 0.1, 0, 0.06, 0.34, 0.2, '#58A6A6'),
      ...b(0.36, 0.6, 0, 0.26, 0.16, 0.12, WOOD),
      ...b(0.84, 0.82, 0, 0.1, 0.1, 0.1, '#E08A5F'),
      ball(x0 + 0.89, y0 + 0.87, z0 + 0.24, 0.12, GREEN), ball(x0 + 0.86, y0 + 0.84, z0 + 0.29, 0.06, '#8BD487'),
      // A floor lamp in the corner
      pool(x0 + 0.86, y0 + 0.3, z0 + 0.004, 0.28),
      ...b(0.85, 0.28, 0, 0.02, 0.02, 0.5, '#8C7A68'),
      ...b(0.8, 0.23, 0.46, 0.12, 0.12, 0.12, '#FFE3A6', { left: '#FFE7B3', right: '#F6CF85', top: '#FFF1D2' }),
      glow(x0 + 0.86, y0 + 0.29, z0 + 0.5, 0.3),
    ];
    case 'kitchen': return [
      back(0.08, 0.7, 0.36, 0.5, '#DCEFF7'),
      ...b(0.06, 0.08, 0, 0.66, 0.24, 0.3, WHITE, { top: '#D8D1C7' }),
      onY(y0 + 0.32, x0 + 0.28, x0 + 0.29, z0 + 0.03, z0 + 0.27, '#E3DDD5'), onY(y0 + 0.32, x0 + 0.5, x0 + 0.51, z0 + 0.03, z0 + 0.27, '#E3DDD5'),
      f(0.3, 0.12, 0.302, 0.18, 0.14, '#A9C7D8'),
      ...b(0.06, 0.08, 0.5, 0.42, 0.12, 0.16, WHITE),
      ...b(0.74, 0.08, 0, 0.2, 0.24, 0.62, '#E3E8EE', { top: '#F4F6F8' }),
      ...b(0.24, 0.62, 0, 0.42, 0.2, 0.26, '#7FA6C9', { top: '#EEE8E0' }),
      ...b(0.29, 0.9, 0, 0.08, 0.08, 0.16, WOOD), ...b(0.52, 0.9, 0, 0.08, 0.08, 0.16, WOOD),
    ];
    case 'bathroom': return [
      back(0.04, 0.96, 0.02, 0.4, '#DDF1F8'),
      ...b(0.06, 0.08, 0, 0.58, 0.3, 0.2, WHITE, { top: '#FDFDFD' }),
      f(0.1, 0.12, 0.202, 0.5, 0.22, '#8FD0EC'),
      onX(x0 + T, y0 + 0.66, y0 + 0.92, z0 + 0.4, z0 + 0.62, '#CDE7F5'),
      ...b(0.08, 0.62, 0, 0.16, 0.34, 0.26, WOOD, { top: WHITE }),
      ...b(0.76, 0.08, 0.1, 0.16, 0.07, 0.18, WHITE),
      ...b(0.78, 0.15, 0, 0.12, 0.18, 0.14, WHITE),
      f(0.36, 0.5, 0.004, 0.3, 0.16, '#F4A88C'),
    ];
    case 'bedroom': return [
      f(0.22, 0.78, 0.004, 0.5, 0.28, '#F6C453'),
      ...b(0.18, 0.08, 0, 0.58, 0.05, 0.36, '#B58BD8'),
      ...b(0.18, 0.13, 0, 0.58, 0.62, 0.14, WOOD),
      ...b(0.2, 0.13, 0.14, 0.54, 0.6, 0.06, WHITE),
      ...b(0.24, 0.16, 0.2, 0.22, 0.12, 0.05, WHITE), ...b(0.5, 0.16, 0.2, 0.22, 0.12, 0.05, WHITE),
      ...b(0.2, 0.37, 0.2, 0.54, 0.36, 0.03, '#B9A1EC'),
      ...b(0.8, 0.1, 0, 0.14, 0.14, 0.16, WOOD),
      pool(x0 + 0.87, y0 + 0.24, z0 + 0.004, 0.18),
      ball(x0 + 0.87, y0 + 0.17, z0 + 0.25, 0.05, '#FFE3A0'),
      glow(x0 + 0.87, y0 + 0.17, z0 + 0.25, 0.2),
    ];
    case 'laundry': return [
      ...b(0.08, 0.08, 0, 0.24, 0.24, 0.3, WHITE), ringOnY(y0 + 0.32, x0 + 0.2, z0 + 0.14, 0.08, '#C8D2DA'), ringOnY(y0 + 0.32, x0 + 0.2, z0 + 0.14, 0.055, '#9FC5DD'),
      ...b(0.34, 0.08, 0, 0.24, 0.24, 0.3, WHITE), ringOnY(y0 + 0.32, x0 + 0.46, z0 + 0.14, 0.08, '#C8D2DA'), ringOnY(y0 + 0.32, x0 + 0.46, z0 + 0.14, 0.055, '#E5EAEE'),
      ...b(0.64, 0.08, 0, 0.28, 0.24, 0.28, '#E3E8EE'), f(0.68, 0.12, 0.282, 0.2, 0.16, '#A9C7D8'),
      ...b(0.5, 0.62, 0, 0.18, 0.14, 0.14, '#E9C49F'),
    ];
    default: return [
      ...b(0.15, 0.15, 0, 0.3, 0.3, 0.26, '#D9B38C'),
      ...b(0.52, 0.2, 0, 0.26, 0.26, 0.2, '#E2C29E'),
      ...b(0.22, 0.2, 0.26, 0.2, 0.2, 0.18, '#E8CDA9'),
      f(0.2, 0.28, 0.262, 0.3, 0.04, '#C9A27A'),
    ];
  }
}

// ---------- Parts of the house ----------

// Status overlays only show once the house is opened up (class "st").
function statusShapes(floorPts, status) {
  if (!STATUS[status]) return [];
  return [poly(floorPts, STATUS[status], { o: 0.22, cls: 'st' }), poly(floorPts, 'none', { stroke: STATUS[status], sw: status === 'over' ? 3 : 2, cls: status === 'over' ? 'st pulse' : 'st' })];
}
const statusOutline = (pts, status) => (STATUS[status]
  ? [poly(pts, 'none', { stroke: STATUS[status], sw: status === 'over' ? 3 : 2, cls: status === 'over' ? 'st pulse' : 'st' })] : []);

/**
 * One room: floor, back wall, left wall and furniture, open towards you like a dollhouse.
 * walls: { back, left, front } heights (0 = none).
 */
function roomCell(room, x0, y0, z0, { status, walls }) {
  const type = room ? room.type : 'empty';
  const floor = FLOOR[type] || '#EFE6D8';
  const shapes = [
    ...box(x0, y0, z0 - SLAB, 1, D, SLAB, SLAB_SIDE, { top: floor, left: SLAB_SIDE, right: shade(SLAB_SIDE, -0.1) }),
    ...box(x0, y0, z0, 1, T, walls.back, WALL_TOP, { faces: 'lt', left: WALL_BACK, top: WALL_TOP }),
    ...(walls.back >= H && type !== 'bathroom' && type !== 'kitchen' ? windowOnY(y0 + T, x0 + 0.62, x0 + 0.86, z0 + 0.36, z0 + 0.6) : []),
    ...box(x0, y0, z0, T, D, walls.left, WALL_TOP, { faces: 'rt', right: WALL_SIDE, top: WALL_TOP }),
  ];
  const floorPts = [P(x0 + T, y0 + T, z0), P(x0 + 1, y0 + T, z0), P(x0 + 1, y0 + D, z0), P(x0 + T, y0 + D, z0)];
  shapes.push(...statusShapes(floorPts, status));
  if (room) shapes.push(...furniture(type, x0, y0, z0));
  if (walls.front) shapes.push(...box(x0, y0 + D - T, z0, 1, T, walls.front, WALL_TOP, { faces: 'lt', left: WALL_SIDE, top: WALL_TOP }));
  return shapes;
}

/** The central hallway: polished boards and a runner from the front door. */
function hallShapes(cols, y0) {
  const shapes = [...box(0, y0, FLOOR_Z - SLAB, cols, HALL, SLAB, SLAB_SIDE, { top: '#D9AA78', left: SLAB_SIDE, right: shade(SLAB_SIDE, -0.1) })];
  for (let x = 0.1; x < cols; x += 0.12) shapes.push(poly([P(x, y0, FLOOR_Z), P(x + 0.006, y0, FLOOR_Z), P(x + 0.006, y0 + HALL, FLOOR_Z), P(x, y0 + HALL, FLOOR_Z)], '#CB9C6B'));
  shapes.push(flat(0.25, y0 + 0.07, FLOOR_Z + 0.003, cols - 0.35, HALL - 0.14, '#B65C4F'));
  shapes.push(flat(0.3, y0 + 0.1, FLOOR_Z + 0.005, cols - 0.45, HALL - 0.2, '#C9705F'));
  return shapes;
}

/** Lattice skirt and stumps under the floor. */
function skirtShapes(n, depth) {
  const shapes = [...box(0, 0, -SLAB, n, depth, FLOOR_Z, '#8C7864', { faces: 'lr', left: '#8C7864', right: '#7A6857' })];
  for (let x = 0.08; x < n; x += 0.12) shapes.push(onY(depth, x, x + 0.02, -SLAB, FLOOR_Z - SLAB, '#6E5D4D'));
  for (let y = 0.08; y < depth; y += 0.12) shapes.push(onX(n, y, y + 0.02, -SLAB, FLOOR_Z - SLAB, '#655546'));
  return shapes;
}

/** The front of the cottage: weatherboards in soft shade, a front door with a lit fanlight, and a lamplit sash window either side. */
function facadeShapes(n, depth, door, windows) {
  const x = n;
  const z0 = FLOOR_Z;
  const shapes = [...box(x - T, 0, z0, T, depth, H, BOARD_SHADE, { faces: 'rt', right: BOARD_SHADE, top: WALL_TOP })];
  for (let z = z0 + 0.05; z < z0 + H - 0.01; z += 0.055) shapes.push(onX(x, 0, depth, z, z + 0.008, BOARD_LINE_SHADE));
  for (const [ya, yb] of windows) {
    shapes.push(
      onX(x, ya - 0.035, yb + 0.035, z0 + 0.17, z0 + 0.6, WHITE),
      onX(x, ya, yb, z0 + 0.2, z0 + 0.56, GLASS),
      onX(x, ya, yb, z0 + 0.375, z0 + 0.39, WHITE),
      onX(x, ya - 0.05, yb + 0.05, z0 + 0.15, z0 + 0.175, '#E8DCC6'),
      glow(x + 0.02, (ya + yb) / 2, z0 + 0.38, (yb - ya) * 1.2, 0.36),
    );
  }
  const [da, db] = [door - 0.115, door + 0.115];
  shapes.push(
    onX(x, da - 0.02, db + 0.02, z0, z0 + 0.62, WHITE),
    onX(x, da, db, z0, z0 + 0.5, DOOR),
    onX(x, da, db, z0 + 0.52, z0 + 0.6, GLASS), // fanlight
    onX(x, da + 0.025, db - 0.025, z0 + 0.06, z0 + 0.22, '#5C8B78'),
    onX(x, da + 0.025, db - 0.025, z0 + 0.26, z0 + 0.44, '#5C8B78'),
    onX(x, db - 0.05, db - 0.035, z0 + 0.26, z0 + 0.28, '#E9C46A'),
  );
  return shapes;
}

/**
 * The side of the house facing you on the left: weatherboards and a lamplit window for each room, with the soft
 * shadow of the eaves along the top. It's there while the roof is on, and fades away to show the rooms.
 */
function sideWallShapes(cols, depth) {
  const Y = depth;
  const z0 = FLOOR_Z;
  const shapes = [...box(0, Y - T, z0, cols, T, H, BOARD, { faces: 'l', left: BOARD })];
  for (let z = z0 + 0.05; z < z0 + H - 0.01; z += 0.055) shapes.push(onY(Y, 0, cols, z, z + 0.008, BOARD_LINE));
  shapes.push(onY(Y, 0, 0.045, z0, z0 + H, WHITE), onY(Y, cols - 0.045, cols, z0, z0 + H, WHITE)); // corner boards
  for (let c = 0; c < cols; c++) shapes.push(...litWindowOnY(Y, c + 0.36, c + 0.64, z0 + 0.2, z0 + 0.56));
  shapes.push(onY(Y, 0, cols, z0 + H - 0.16, z0 + H, EAVE));
  return shapes;
}

/** The bullnose verandah across the front: timber floor and steps, turned posts, fretwork and a curved iron roof. */
function verandahShapes(n, depth, door, status) {
  const x0 = n;
  const x1 = n + VW;
  const deck = FLOOR_Z - 0.03;
  const beam = FLOOR_Z + 0.5;
  const ya = -0.04;
  const yb = depth + 0.04;
  const sa = door - 0.135; // the steps line up with the front door
  const sb = door + 0.135;
  const shapes = [
    ...box(x0, ya, -SLAB, VW, yb - ya, deck + SLAB, '#C99A6B', { top: '#E2B88A', left: '#B98B5E', right: '#A87C52' }),
  ];
  for (let x = x0 + 0.08; x < x1; x += 0.09) shapes.push(poly([P(x, ya, deck), P(x + 0.006, ya, deck), P(x + 0.006, yb, deck), P(x, yb, deck)], '#CFA375'));
  shapes.push(...statusShapes([P(x0, ya, deck), P(x1, ya, deck), P(x1, yb, deck), P(x0, yb, deck)], status));
  // The porch light: a warm pool on the boards by the front door
  shapes.push(pool(x0 + VW * 0.42, door, deck, 0.42), glow(x0 + 0.04, door, FLOOR_Z + 0.2, 0.34, 0.3));
  // Front steps down to the path
  shapes.push(...box(x1, sa, -SLAB, 0.14, sb - sa, deck - 0.03 + SLAB, '#C99A6B', { top: '#E2B88A' }));
  shapes.push(...box(x1 + 0.14, sa, -SLAB, 0.12, sb - sa, (deck + SLAB) / 2 - 0.02, '#C99A6B', { top: '#E2B88A' }));
  // Balustrade: a white rail with dowel balusters, either side of the steps
  const px = x1 - 0.05;
  for (const [y0, y1] of [[ya + 0.02, sa], [sb, yb - 0.02]]) {
    for (let y = y0 + 0.04; y < y1 - 0.01; y += 0.05) shapes.push(...box(px + 0.012, y, deck, 0.012, 0.012, 0.26, WHITE, { right: '#F1EEE8' }));
    shapes.push(...box(px, y0, deck + 0.26, 0.04, y1 - y0, 0.03, WHITE, { right: '#EDE8E0' }));
  }
  // Turned posts with fretwork brackets
  const posts = [ya + 0.02, sa - 0.04, sb, yb - 0.06];
  for (const [a, b] of [[ya + 0.02, sa - 0.04], [sb, yb - 0.06]]) {
    const extra = Math.floor((b - a) / 0.75);
    for (let k = 1; k <= extra; k++) posts.push(a + ((b - a) * k) / (extra + 1));
  }
  for (const y of posts.sort((p, q) => p - q)) {
    shapes.push(...box(px, y, deck, 0.04, 0.04, beam - deck, WHITE, { right: '#ECE6DD' }));
    shapes.push(onX(px + 0.04, y - 0.1, y, beam - 0.004, beam, WHITE), poly([P(px + 0.04, y - 0.1, beam), P(px + 0.04, y, beam), P(px + 0.04, y, beam - 0.1)], WHITE));
    shapes.push(poly([P(px + 0.04, y + 0.04, beam), P(px + 0.04, y + 0.14, beam), P(px + 0.04, y + 0.04, beam - 0.1)], WHITE));
  }
  // Beam and a lacework frieze
  shapes.push(...box(px - 0.01, ya, beam, 0.05, yb - ya, 0.05, WHITE, { right: '#F0EBE3' }));
  for (let y = ya + 0.06; y < yb - 0.04; y += 0.06) shapes.push(ball(px + 0.045, y, beam - 0.025, 0.012, WHITE));
  // The bullnose roof: corrugated iron curving down from the wall (tucked under the main roof's eaves) to the beam
  const top = FLOOR_Z + H - 0.04;
  const drop = top - (beam + 0.05);
  const steps = 10;
  const prof = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    prof.push([x0 - 0.02 + (VW + 0.06) * Math.sin(a), top - drop * (1 - Math.cos(a))]);
  }
  for (let i = 0; i < steps; i++) {
    const [xa, za] = prof[i];
    const [xb, zb] = prof[i + 1];
    const k = i / steps;
    shapes.push(poly([P(xa, ya - 0.03, za), P(xb, ya - 0.03, zb), P(xb, yb + 0.03, zb), P(xa, yb + 0.03, za)], shade(IRON_LIGHT, -0.3 * k)));
  }
  for (let y = ya + 0.02; y < yb + 0.03; y += 0.065) shapes.push(line(prof.map(([px2, pz]) => P(px2, y, pz)), IRON_RIB, 0.9));
  // The curved end of the verandah roof (facing you on the left)
  shapes.push(poly([...prof.map(([px2, pz]) => P(px2, yb + 0.03, pz)), ...prof.slice().reverse().map(([px2, pz]) => P(px2, yb + 0.03, pz - 0.035))], IRON_DARK));
  return shapes;
}

/** A garden shed / garage out the back: weatherboards, a roller door and a corrugated roof. */
function garageShapes(x0, status) {
  const w = 1.1;
  const d = D - 0.1;
  const y0 = 0.05;
  const h = 0.55;
  const shapes = [
    ...box(x0, y0, -SLAB, w, d, SLAB, SLAB_SIDE, { top: '#D7DADF' }),
    ...box(x0, y0, 0, w, d, h, BOARD, { left: BOARD, right: shade(BOARD, -0.1), top: '#E8E0D6' }),
  ];
  for (let z = 0.05; z < h; z += 0.055) shapes.push(onY(y0 + d, x0, x0 + w, z, z + 0.007, BOARD_LINE));
  shapes.push(onY(y0 + d, x0 + 0.14, x0 + 0.96, 0, 0.44, '#C3C9D2'));
  for (const z of [0.08, 0.16, 0.24, 0.32]) shapes.push(onY(y0 + d, x0 + 0.14, x0 + 0.96, z, z + 0.015, '#AEB5BF'));
  // Skillion roof sloping to the back
  const r = [P(x0 - 0.05, y0 + d + 0.08, h + 0.02), P(x0 + w + 0.05, y0 + d + 0.08, h + 0.02), P(x0 + w + 0.05, y0 - 0.06, h + 0.2), P(x0 - 0.05, y0 - 0.06, h + 0.2)];
  shapes.push(poly(r, IRON_LIGHT));
  for (let x = x0; x < x0 + w + 0.04; x += 0.065) shapes.push(line([P(x, y0 + d + 0.08, h + 0.02), P(x, y0 - 0.06, h + 0.2)], IRON_RIB, 0.9));
  shapes.push(poly([P(x0 - 0.05, y0 + d + 0.08, h + 0.02), P(x0 + w + 0.05, y0 + d + 0.08, h + 0.02), P(x0 + w + 0.05, y0 + d + 0.08, h - 0.02), P(x0 - 0.05, y0 + d + 0.08, h - 0.02)], IRON_DARK));
  // A lamp over the roller door
  shapes.push(ball(x0 + w / 2, y0 + d + 0.02, 0.5, 0.025, '#FFE3A0'), glow(x0 + w / 2, y0 + d + 0.02, 0.46, 0.3, 0.22));
  shapes.push(...statusOutline(r, status));
  return shapes;
}

function gardenShapes(x0, y0, w, status) {
  const d = 0.6;
  const shapes = [
    ...box(x0, y0, -0.06, w, d, 0.1, '#A07655', { top: '#9ACB86' }),
    ...statusShapes([P(x0, y0, 0.04), P(x0 + w, y0, 0.04), P(x0 + w, y0 + d, 0.04), P(x0, y0 + d, 0.04)], status),
  ];
  const flowers = ['#F2A7C0', '#FFD98A', '#FFFFFF', '#F2A7C0', '#FFD98A', '#C9B3EE'];
  for (let i = 0; i < 6; i++) {
    const fx = x0 + 0.15 + (i % 3) * (w - 0.3) / 2;
    const fy = y0 + 0.16 + Math.floor(i / 3) * 0.28;
    shapes.push(ball(fx, fy, 0.13, 0.07, '#69AD63'), ball(fx, fy, 0.18, 0.035, flowers[i]));
  }
  // A frangipani
  shapes.push(...box(x0 + w - 0.18, y0 + 0.2, 0.04, 0.05, 0.05, 0.28, '#8B6A4E'), ball(x0 + w - 0.15, y0 + 0.22, 0.46, 0.18, '#6CAF62'));
  for (const [dx, dy, dz] of [[-0.08, 0, 0.55], [0.05, 0.04, 0.5], [0.02, -0.06, 0.6], [-0.02, 0.07, 0.42]]) {
    shapes.push(ball(x0 + w - 0.15 + dx, y0 + 0.22 + dy, dz, 0.035, '#FFF8E1'), ball(x0 + w - 0.15 + dx, y0 + 0.22 + dy, dz, 0.014, '#FFC94D'));
  }
  return shapes;
}

/**
 * A hipped roof of navy corrugated iron with a brick chimney (and a wisp of smoke). It sits on the walls; when the
 * house is opened up, <House> lifts it up and back like a lid.
 */
function roofShapes(x0, x1, depth, base, status) {
  const eave = base;
  const rise = Math.min(0.62, 0.3 + depth * 0.16);
  const ridge = eave + rise;
  const ya = -0.14;
  const yb = depth + 0.14;
  const ym = (ya + yb) / 2;
  const run = Math.min(ym - ya, (x1 - x0) / 2 - 0.05);
  const r0 = P(x0 + run, ym, ridge);
  const r1 = P(x1 - run, ym, ridge);
  const front = [P(x0, yb, eave), P(x1, yb, eave), r1, r0];
  const backSlope = [P(x0, ya, eave), P(x1, ya, eave), r1, r0];
  const hip = [P(x1, ya, eave), P(x1, yb, eave), r1];
  const backHip = [P(x0, ya, eave), P(x0, yb, eave), r0];
  const cx = x0 + 0.45;
  const cy = ya + 0.3;
  const top = eave + rise + 0.37;
  const shapes = [
    // The far slopes first, catching the last of the sky
    poly(backSlope, '#566E97'),
    poly(backHip, '#4E668F'),
    ...box(cx, cy, eave + 0.1, 0.18, 0.16, rise + 0.22, BRICK),
    ...box(cx - 0.02, cy - 0.02, eave + rise + 0.32, 0.22, 0.2, 0.05, '#E9DCCB'),
    ...box(cx + 0.03, cy + 0.03, top, 0.05, 0.05, 0.08, '#C3775A'),
    ...box(cx + 0.11, cy + 0.03, top, 0.05, 0.05, 0.08, '#C3775A'),
    ball(cx + 0.07, cy + 0.06, top + 0.2, 0.05, 'rgba(255, 255, 255, 0.55)', 'smoke s1'),
    ball(cx + 0.07, cy + 0.06, top + 0.2, 0.065, 'rgba(255, 255, 255, 0.45)', 'smoke s2'),
    ball(cx + 0.07, cy + 0.06, top + 0.2, 0.08, 'rgba(255, 255, 255, 0.35)', 'smoke s3'),
    poly(front, IRON_LIGHT),
  ];
  // Corrugations running down the front slope and the hip
  for (let x = x0 + 0.04; x < x1 - 0.02; x += 0.065) {
    const t = Math.min(1, (x - x0) / run, (x1 - x) / run);
    shapes.push(line([P(x, yb, eave), P(x, yb - (yb - ym) * t, eave + rise * t)], IRON, 0.9));
  }
  shapes.push(poly(hip, IRON));
  for (let y = ya + 0.04; y < yb - 0.02; y += 0.065) {
    const t = 1 - Math.abs(y - ym) / (yb - ym);
    shapes.push(line([P(x1, y, eave), P(x1 - run * t, y, eave + rise * t)], IRON_DARK, 0.9));
  }
  shapes.push(
    line([r0, r1], CAPPING, 2.4), // ridge capping
    line([r1, P(x1, yb, eave)], CAPPING, 2), // hip capping
    line([r0, P(x0, yb, eave)], CAPPING, 2),
    line([r1, P(x1, ya, eave)], '#B9C3D3', 1.6),
    poly([P(x0, yb, eave), P(x1, yb, eave), P(x1, yb, eave - 0.05), P(x0, yb, eave - 0.05)], WHITE), // fascia
    poly([P(x0, yb, eave - 0.05), P(x1, yb, eave - 0.05), P(x1, yb + 0.03, eave - 0.05), P(x0, yb + 0.03, eave - 0.05)], IRON_DARK), // gutter
    poly([P(x1, ya, eave), P(x1, yb, eave), P(x1, yb, eave - 0.05), P(x1, ya, eave - 0.05)], '#EFEAE2'),
  );
  shapes.push(...statusOutline(front, status));
  return shapes;
}

/** A Hills Hoist in the backyard, with a towel on the line. */
function hillsHoist(x, y) {
  const top = 0.62;
  const shapes = [...box(x - 0.012, y - 0.012, -SLAB, 0.024, 0.024, top + SLAB, '#B9BEC4')];
  for (const r of [0.34, 0.24, 0.14]) {
    shapes.push(line([P(x - r, y - r, top + 0.03), P(x + r, y - r, top + 0.03), P(x + r, y + r, top + 0.03), P(x - r, y + r, top + 0.03), P(x - r, y - r, top + 0.03)], '#C9CED4', 0.8));
  }
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) shapes.push(line([P(x, y, top), P(x + dx * 0.36, y + dy * 0.36, top + 0.04)], '#AEB3B9', 1.2));
  shapes.push(poly([P(x + 0.04, y + 0.34, top + 0.03), P(x + 0.2, y + 0.34, top + 0.03), P(x + 0.2, y + 0.34, top - 0.1), P(x + 0.04, y + 0.34, top - 0.1)], '#F48FB1'));
  shapes.push(poly([P(x - 0.3, y + 0.1, top + 0.03), P(x - 0.3, y + 0.24, top + 0.03), P(x - 0.3, y + 0.24, top - 0.07), P(x - 0.3, y + 0.1, top - 0.07)], '#8EC9F0'));
  return shapes;
}

/** A white picket fence along the front, with lamplit gateposts opening onto a brick path to the steps. */
function fenceShapes(xf, ya, yb, n, door) {
  const shapes = [poly([P(n + VW + 0.26, door - 0.105, 0), P(xf, door - 0.105, 0), P(xf, door + 0.105, 0), P(n + VW + 0.26, door + 0.105, 0)], '#D9B79A')];
  shapes.push(pool(xf - 0.2, door, 0, 0.36));
  for (const [y0, y1] of [[ya, door - 0.135], [door + 0.135, yb]]) {
    shapes.push(...box(xf, y0, 0.08, 0.02, y1 - y0, 0.025, WHITE, { right: '#EEE9E1' }));
    for (let y = y0 + 0.01; y < y1 - 0.02; y += 0.055) {
      shapes.push(poly([P(xf + 0.02, y, -0.02), P(xf + 0.02, y + 0.03, -0.02), P(xf + 0.02, y + 0.03, 0.18), P(xf + 0.02, y + 0.015, 0.21), P(xf + 0.02, y, 0.18)], WHITE));
    }
  }
  for (const y of [door - 0.17, door + 0.135]) {
    shapes.push(...box(xf - 0.005, y, -0.02, 0.035, 0.035, 0.28, WHITE, { right: '#EDE7DD' }));
    shapes.push(...box(xf - 0.012, y - 0.007, 0.26, 0.05, 0.05, 0.065, '#FFE3A6', { left: '#FFE8B6', right: '#F5CC80', top: '#4A5E80' }));
    shapes.push(glow(xf + 0.013, y + 0.017, 0.29, 0.2, 0.17));
  }
  return shapes;
}

function jacaranda(x, y) {
  return [
    ...box(x - 0.03, y - 0.03, -SLAB, 0.06, 0.06, 0.62, '#7D5A40'),
    ball(x, y, 0.72, 0.36, '#A38BD6'), ball(x - 0.12, y - 0.05, 0.86, 0.22, '#B9A5E6'), ball(x + 0.14, y + 0.06, 0.66, 0.2, '#957ECB'),
  ];
}

function islandShapes(xa, xb, ya, yb) {
  const top = -SLAB;
  const bottom = top - 0.32;
  const shapes = [];
  // An upside-down rocky cone under the island, so it floats.
  const ix = (xb - xa) * 0.1;
  const iy = (yb - ya) * 0.12;
  const apex = P((xa + xb) / 2 + 0.3, (ya + yb) / 2 + 0.2, bottom - 1.35);
  shapes.push(poly([P(xa + ix, yb - iy, bottom), P(xb - ix, yb - iy, bottom), apex], '#BD9472'));
  shapes.push(poly([P(xb - ix, ya + iy, bottom), P(xb - ix, yb - iy, bottom), apex], '#A07D60'));
  shapes.push(...box(xa, ya, bottom, xb - xa, yb - ya, 0.32, '#C79D78', { top: 'url(#hs-grass)', left: '#CCA47F', right: '#B38B68' }));
  // Grass lip
  shapes.push(poly([P(xa, yb, top), P(xb, yb, top), P(xb, yb, top - 0.07), P(xa, yb, top - 0.07)], '#9ACB86'));
  shapes.push(poly([P(xb, ya, top), P(xb, yb, top), P(xb, yb, top - 0.07), P(xb, ya, top - 0.07)], '#8BBC78'));
  return shapes;
}

// ---------- Layout ----------

/**
 * Works out where everything goes. rooms: your active rooms. status(roomId) → 'none' | 'ok' | 'near' | 'over'.
 * Returns { parts: [{ id, roomId, layer, shapes }], pins: [{ roomId, at: [x, y] }], stages: [room], extras: [room],
 * viewBox, roofLift: [dx, dy], openExtra }. The picture is the house closed up, roof on. Opened, the roof part
 * moves by roofLift and the "shell" layer (the side wall) fades; pins are for the opened house, and openExtra is
 * how much taller (in viewBox units) the opened picture is.
 */
export function buildHouse(rooms, status = () => 'none') {
  const active = rooms.filter((r) => !r.archived);
  const interior = active.filter((r) => INTERIOR.includes(r.type))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => INTERIOR.indexOf(a.r.type) - INTERIOR.indexOf(b.r.type) || a.i - b.i)
    .map((x) => x.r);
  const garages = active.filter((r) => r.type === 'garage');
  const outdoor = active.filter((r) => r.type === 'outdoor');
  const exterior = active.filter((r) => r.type === 'exterior');
  const stages = active.filter((r) => r.type === 'whole');

  // Always one storey. Up to 3 rooms sit in a row from the back of the house (left) to the front (right);
  // more than that go either side of a central hallway, like a classic cottage.
  const placed = interior.slice(0, MAX_ROOMS);
  const extras = [...interior.slice(MAX_ROOMS), ...garages.slice(1), ...outdoor.slice(2), ...exterior.slice(1)];
  const rows = placed.length > 3 ? 2 : 1;
  const cells = placed.length ? placed : [null];
  const cols = Math.ceil(cells.length / rows);
  const depth = rows === 2 ? 2 * D + HALL : D;
  const door = rows === 2 ? D + HALL / 2 : D / 2;
  const windows = rows === 2 ? [[0.32, 0.8], [depth - 0.8, depth - 0.32]] : [[0.1, 0.32], [D - 0.32, D - 0.1]];
  const garage = garages[0];
  const verandah = outdoor[0];
  const garden = outdoor[1];
  const roof = exterior[0];

  const fenceX = cols + VW + 0.55;
  const back = garage ? -1.7 : -1.05;
  const front = depth + (garden ? 1.0 : 0.7);

  const parts = [];
  const pins = [];
  const add = (id, roomId, shapes, pinAt, layer) => {
    parts.push({ id, roomId, shapes, layer });
    if (roomId && pinAt) pins.push({ roomId, at: pinAt });
  };

  add('shadow', null, [{ t: 'ellipse', c: P((back + fenceX) / 2 + 0.3, front / 2, -2.15), rx: (fenceX - back + front) * C * S * 0.3, ry: 0.32 * S, fill: 'rgba(70, 60, 120, 0.12)', cls: 'house-shadow' }]);
  add('island', null, islandShapes(back, fenceX + 0.2, -0.6, front));
  add('tree', null, jacaranda(back + 0.45, -0.32));
  if (garage) add(garage.id, garage.id, garageShapes(-1.45, status(garage.id)), P(-0.95, D * 0.55, 0.85));
  add('hoist', null, hillsHoist(back + 0.55, depth + 0.3));
  add('skirt', null, skirtShapes(cols, depth));
  const cell = (room, col, row) => {
    const y0 = row === 0 ? 0 : D + HALL;
    const walls = rows === 1 ? { back: H, left: H, front: 0 }
      : row === 0 ? { back: H, left: H, front: LOW } : { back: LOW, left: col === 0 ? H : LOW, front: 0 };
    add(room ? room.id : `empty-${col}-${row}`, room?.id, roomCell(room, col, y0, FLOOR_Z, { status: room ? status(room.id) : 'none', walls }),
      P(col + 0.55, y0 + D * 0.62, FLOOR_Z + 0.42));
  };
  // Back row first (further away), then the hallway, then the front row.
  cells.forEach((room, i) => { if (i % rows === 0) cell(room, Math.floor(i / rows), 0); });
  if (rows === 2) {
    add('hall', null, hallShapes(cols, D));
    for (let c = 0; c < cols; c++) cell(cells[c * 2 + 1] ?? null, c, 1);
  }
  add('facade', null, facadeShapes(cols, depth, door, windows));
  add('side', null, sideWallShapes(cols, depth), null, 'shell');
  add(verandah ? verandah.id : 'verandah', verandah?.id, verandahShapes(cols, depth, door, verandah ? status(verandah.id) : 'none'),
    P(cols + VW * 0.45, door + 0.42, FLOOR_Z + 0.2));
  if (garden) add(garden.id, garden.id, gardenShapes(0.2, depth + 0.25, Math.min(1.8, Math.max(1, cols - 0.4)), status(garden.id)), P(0.8, depth + 0.55, 0.42));
  add('fence', null, fenceShapes(fenceX, -0.5, front - 0.1, cols, door));
  // The roof sits on the walls. Opened up, it lifts up and slides back like a lid, so its front edge sits above
  // the back walls.
  const roofBase = FLOOR_Z + H;
  const lift = rows === 2 ? 1.3 : 1.15;
  const roofBack = rows === 2 ? depth * 0.72 : 0.6;
  const shift = P(0, -roofBack, lift);
  const roofLift = [r2(shift[0] - P(0, 0, 0)[0]), r2(shift[1] - P(0, 0, 0)[1])];
  const roofPin = P(cols * 0.5, depth / 2, roofBase + 0.45);
  add(roof ? roof.id : 'roof', roof?.id, roofShapes(-0.12, cols + 0.12, depth, roofBase, roof ? status(roof.id) : 'none'),
    [r2(roofPin[0] + roofLift[0]), r2(roofPin[1] + roofLift[1])], 'roof');

  // Fit the closed-up picture; the opened one also needs room above for the lifted roof and the pins.
  const xs = [];
  const ys = [];
  let openTop = Infinity;
  for (const p of parts) {
    const dy = p.layer === 'roof' ? roofLift[1] : 0;
    for (const sh of p.shapes) {
      let bx;
      let by;
      if (sh.pts) { bx = sh.pts.map((q) => q[0]); by = sh.pts.map((q) => q[1]); }
      else if (sh.t === 'circle') { bx = [sh.c[0] - sh.r, sh.c[0] + sh.r]; by = [sh.c[1] - sh.r, sh.c[1] + sh.r]; }
      else { bx = [sh.c[0] - sh.rx, sh.c[0] + sh.rx]; by = [sh.c[1] - sh.ry, sh.c[1] + sh.ry]; }
      if (sh.cls?.startsWith('smoke')) continue; // the smoke drifts off the top
      xs.push(...bx);
      ys.push(...by);
      openTop = Math.min(openTop, ...by.map((y) => y + dy));
    }
  }
  for (const pin of pins) openTop = Math.min(openTop, pin.at[1] - 40);
  const pad = 14;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const viewBox = [minX, minY, Math.max(...xs) - minX + pad, Math.max(...ys) - minY + pad].map(r2);
  const openExtra = r2(Math.max(0, minY - (openTop - pad)));
  return { parts, pins, stages, extras, viewBox, roofLift, openExtra };
}

// ---------- Drawing ----------

function Shape({ s }) {
  if (s.t === 'circle') return html`<circle class=${s.cls} cx=${s.c[0]} cy=${s.c[1]} r=${s.r} fill=${s.fill} />`;
  if (s.t === 'ellipse') return html`<ellipse class=${s.cls} cx=${s.c[0]} cy=${s.c[1]} rx=${s.rx} ry=${s.ry} fill=${s.fill} />`;
  const points = s.pts.map((p) => p.join(',')).join(' ');
  if (s.t === 'line') return html`<polyline points=${points} fill="none" stroke=${s.stroke} stroke-width=${s.sw} stroke-linecap="round" stroke-linejoin="round" />`;
  if (s.stroke) return html`<polygon class=${s.cls || ''} points=${points} fill="none" stroke=${s.stroke} stroke-width=${s.sw} stroke-linejoin="round" />`;
  // A hairline of the same colour closes the gaps between neighbouring shapes (not for see-through ones).
  const solid = !s.o && !s.fill.startsWith('url');
  return html`<polygon class=${s.cls} points=${points} fill=${s.fill} fill-opacity=${s.o ?? 1}
    stroke=${solid ? s.fill : 'none'} stroke-width="0.6" stroke-linejoin="round" />`;
}

/** Gradients for the lamplight and the soft evening shading. */
const Defs = () => html`<defs>
  <linearGradient id="hs-glass" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFEBB8" /><stop offset="1" stop-color="#F6BE63" />
  </linearGradient>
  <radialGradient id="hs-glow">
    <stop offset="0" stop-color="#FFD58C" stop-opacity="0.7" /><stop offset="0.45" stop-color="#FFD58C" stop-opacity="0.28" />
    <stop offset="1" stop-color="#FFD58C" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="hs-pool">
    <stop offset="0" stop-color="#FFE2A8" stop-opacity="0.6" /><stop offset="1" stop-color="#FFE2A8" stop-opacity="0" />
  </radialGradient>
  <linearGradient id="hs-eave" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6B5236" stop-opacity="0.24" /><stop offset="1" stop-color="#6B5236" stop-opacity="0" />
  </linearGradient>
  <radialGradient id="hs-grass" cx="0.55" cy="0.45" r="0.7">
    <stop offset="0" stop-color="#BFDFA6" /><stop offset="1" stop-color="#A5CF8F" />
  </radialGradient>
</defs>`;

const STATUS_ICON = { ok: '✓', near: '!', over: '‼' };
export const STATUS_TEXT = { ok: 'On track', near: 'Nearly at budget', over: 'Over budget', none: 'No budget' };

/** A room's bubble: its emoji with a badge showing its budget status (shape + colour). */
export function StatusBadge({ status, inline }) {
  if (!STATUS_ICON[status]) return null;
  return html`<span class="status-badge s-${status} ${inline ? 'inline' : ''}" aria-hidden="true">${STATUS_ICON[status]}</span>`;
}

/**
 * The house. rooms: active rooms. stats: Map roomId → { status, ... }.
 * open: roof off, rooms showing. onOpen(roomId?) opens it (and picks a room if one was tapped); onClose() when the
 * roof is dragged back down onto the house. selectedId / onSelect(roomId | null): which part is lifted (only open).
 */
export function House({ rooms, stats, open, onOpen, onClose, selectedId, onSelect }) {
  const status = (id) => stats.get(id)?.status || 'none';
  const { parts, pins, viewBox, roofLift, openExtra } = buildHouse(rooms, status);
  const [vx, vy, vw, vh] = viewBox;
  const houseRef = useRef();
  const svgRef = useRef();
  const roofRef = useRef();
  const shellRef = useRef();
  const draggedAt = useRef(0); // the click that follows a drag isn't a tap
  const roofPart = parts.find((p) => p.layer === 'roof');
  const roomName = (id) => rooms.find((r) => r.id === id)?.name || '';
  const tapPart = (e, roomId) => {
    e.stopPropagation();
    if (!open) onOpen(roomId);
    else onSelect(roomId === selectedId ? null : roomId);
  };
  const roofSelected = open && roofPart.roomId && roofPart.roomId === selectedId;
  const roofTransform = (t) => `translate(${r2(roofLift[0] * t)}px,${r2(roofLift[1] * t - (roofSelected ? 8 : 0))}px)`;

  // Stop the page scrolling when a finger lands on the lifted roof, so it can be dragged.
  useEffect(() => {
    const g = roofRef.current;
    if (!open || !g) return undefined;
    const stop = (e) => e.preventDefault();
    g.addEventListener('touchstart', stop, { passive: false });
    return () => g.removeEventListener('touchstart', stop);
  }, [open]);

  /** Drag the lifted roof back down onto the house to close it up (past halfway). A tap still picks it. */
  const dragRoof = (e) => {
    if (!open || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.stopPropagation();
    const g = roofRef.current;
    const shell = shellRef.current;
    const scale = svgRef.current.getBoundingClientRect().width / vw;
    const [lx, ly] = roofLift;
    const len2 = lx * lx + ly * ly;
    const [sx, sy] = [e.clientX, e.clientY];
    let t = 1;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!moved) {
        moved = true;
        houseRef.current.classList.add('dragging');
        g.style.transition = 'none';
        if (shell) shell.style.transition = 'none';
      }
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      t = Math.max(0, Math.min(1.1, 1 + (dx * lx + dy * ly) / len2)); // how far along the lift the finger has gone
      g.style.transform = roofTransform(t);
      if (shell) shell.style.opacity = String(Math.max(0, Math.min(1, (1 - t) * 1.6)));
    };
    const up = (ev) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      houseRef.current.classList.remove('dragging');
      g.style.transition = '';
      draggedAt.current = Date.now();
      if (!moved) {
        if (ev.type === 'pointerup' && roofPart.roomId) onSelect(roofPart.roomId === selectedId ? null : roofPart.roomId);
        return;
      }
      if (shell) shell.style.transition = '';
      if (ev.type === 'pointerup' && t < 0.55) {
        if (shell) shell.style.opacity = '1';
        setTimeout(() => { if (shell) shell.style.opacity = ''; }, 600);
        onClose();
      } else {
        g.style.transform = roofTransform(1); // spring back up
        if (shell) shell.style.opacity = '';
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };

  return html`<div class="house ${open ? 'open' : 'closed'} ${pins.length > 6 ? 'many' : ''}" ref=${houseRef}
    style=${`padding-top:${open ? (openExtra / vw) * 100 : 0}%`}>
    <div class="house-frame" style=${`aspect-ratio:${vw} / ${vh}`}>
      <svg viewBox=${viewBox.join(' ')} class="house-svg ${open && selectedId ? 'has-selection' : ''}" role="img" ref=${svgRef}
        aria-label=${open ? 'Your house, opened up. Tap a room to see its spending, or drag the roof back down to close it up.' : 'Your house. Tap it to look inside.'}
        onClick=${(e) => {
          if (Date.now() - draggedAt.current < 500) return; // already handled when the roof was let go
          if (!open) onOpen();
          else if (e.target === e.currentTarget) onSelect(null);
        }}>
        <${Defs} />
        <g class="house-float">
          ${parts.map((p) => {
            const selected = open && p.roomId && p.roomId === selectedId;
            const isRoof = p.layer === 'roof';
            return html`<g key=${p.id} ref=${isRoof ? roofRef : p.layer === 'shell' ? shellRef : undefined}
              class="house-part ${p.roomId ? 'tappable' : ''} ${selected ? 'selected' : ''} ${p.layer ? `layer-${p.layer}` : ''}"
              style=${isRoof && open ? `transform:${roofTransform(1)}` : ''}
              onPointerDown=${isRoof ? dragRoof : undefined}
              onClick=${isRoof ? undefined : p.roomId ? (e) => { if (Date.now() - draggedAt.current >= 500) tapPart(e, p.roomId); } : undefined}>
              ${p.shapes.map((sh, i) => html`<${Shape} key=${i} s=${sh} />`)}
            </g>`;
          })}
        </g>
      </svg>
      ${open && pins.map((pin) => {
        const room = rooms.find((r) => r.id === pin.roomId);
        const st = status(pin.roomId);
        return html`<button key=${pin.roomId} class="house-pin ${pin.roomId === selectedId ? 'selected' : ''} ${selectedId && pin.roomId !== selectedId ? 'dim' : ''}"
          style=${`left:${((pin.at[0] - vx) / vw) * 100}%;top:${((pin.at[1] - vy) / vh) * 100}%`}
          onClick=${() => onSelect(pin.roomId === selectedId ? null : pin.roomId)}
          aria-label=${`${roomName(pin.roomId)}: ${STATUS_TEXT[st]}`} aria-pressed=${pin.roomId === selectedId}>
          <span class="pin-emoji">${roomType(room?.type).emoji}</span>
          <${StatusBadge} status=${st} />
        </button>`;
      })}
    </div>
  </div>`;
}
