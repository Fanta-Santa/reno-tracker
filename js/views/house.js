// The dashboard house: a toy-like dollhouse on a floating island, drawn from your rooms and stages.
// Interior rooms (kitchen, bathroom, bedroom, living, laundry, other) become open-fronted rooms, stacked
// into floors; a garage, deck and garden sit beside them; roof/exterior rooms are the roof. Whole-house
// stages (e.g. Painting) float above as tags. Each part glows with its budget status and can be tapped.

import { html } from '../lib.js';
import { roomType } from '../defaults.js';

const S = 40; // pixels per unit
const C = Math.cos(Math.PI / 6);
const D = 1.15; // room depth
const H = 0.72; // wall height
const T = 0.07; // wall thickness
const SLAB = 0.09;
const GAP = 0.6; // floors float apart so you can see into each one
const ROOF_LIFT = 0.85; // and the roof floats above the top floor

const STATUS = { ok: '#0ca30c', near: '#fab219', over: '#d03b3b' };
const FLOOR = {
  living: '#E8C59F', kitchen: '#F1E3C8', bathroom: '#CBE6F2', bedroom: '#E3D9F4', laundry: '#D3EEDF', other: '#EFE6D8',
};
const WALL_TOP = '#FFFFFF';
const WALL_BACK = '#F8F4EF';
const WALL_SIDE = '#EDE6DE';
const OUTSIDE = '#F5EDE3';
const SLAB_SIDE = '#E4DACC';
const WOOD = '#C9925E';
const WHITE = '#FFFFFF';
const GREEN = '#6DBE6A';

// Ground floor first: living areas downstairs, bedrooms and bathrooms up.
const INTERIOR = ['living', 'kitchen', 'laundry', 'other', 'bathroom', 'bedroom'];

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
const ball = (x, y, z, r, fill) => ({ t: 'circle', c: P(x, y, z), r: r * S, fill });
function ringOnY(Y, cx, cz, r, fill) {
  const pts = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    pts.push(P(cx + r * Math.cos(a), Y, cz + r * Math.sin(a)));
  }
  return poly(pts, fill);
}

function windowOnY(Y, xa, xb, za, zb) {
  return [onY(Y, xa - 0.03, xb + 0.03, za - 0.03, zb + 0.03, WHITE), onY(Y, xa, xb, za, zb, '#BFE3FA'),
    onY(Y, (xa + xb) / 2 - 0.01, (xa + xb) / 2 + 0.01, za, zb, WHITE)];
}
function windowOnX(X, ya, yb, za, zb) {
  return [onX(X, ya - 0.03, yb + 0.03, za - 0.03, zb + 0.03, WHITE), onX(X, ya, yb, za, zb, '#A9D6F5'),
    onX(X, (ya + yb) / 2 - 0.01, (ya + yb) / 2 + 0.01, za, zb, WHITE)];
}

// ---------- Furniture (x from the room's left wall, y from its back wall) ----------

function furniture(type, x0, z0) {
  const b = (x, y, z, w, d, h, color, o) => box(x0 + x, y, z0 + z, w, d, h, color, o);
  const f = (x, y, z, w, d, fill) => flat(x0 + x, y, z0 + z, w, d, fill);
  const back = (xa, xb, za, zb, fill) => onY(T, x0 + xa, x0 + xb, z0 + za, z0 + zb, fill);
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
      ball(x0 + 0.89, 0.87, z0 + 0.24, 0.12, GREEN), ball(x0 + 0.86, 0.84, z0 + 0.29, 0.06, '#8BD487'),
    ];
    case 'kitchen': return [
      back(0.08, 0.7, 0.36, 0.5, '#DCEFF7'),
      ...b(0.06, 0.08, 0, 0.66, 0.24, 0.3, WHITE, { top: '#D8D1C7' }),
      onY(0.32, x0 + 0.28, x0 + 0.29, z0 + 0.03, z0 + 0.27, '#E3DDD5'), onY(0.32, x0 + 0.5, x0 + 0.51, z0 + 0.03, z0 + 0.27, '#E3DDD5'),
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
      onX(x0 + T, 0.66, 0.92, z0 + 0.4, z0 + 0.62, '#CDE7F5'),
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
      ball(x0 + 0.87, 0.17, z0 + 0.25, 0.05, '#FFE08A'),
    ];
    case 'laundry': return [
      ...b(0.08, 0.08, 0, 0.24, 0.24, 0.3, WHITE), ringOnY(0.32, x0 + 0.2, z0 + 0.14, 0.08, '#C8D2DA'), ringOnY(0.32, x0 + 0.2, z0 + 0.14, 0.055, '#9FC5DD'),
      ...b(0.34, 0.08, 0, 0.24, 0.24, 0.3, WHITE), ringOnY(0.32, x0 + 0.46, z0 + 0.14, 0.08, '#C8D2DA'), ringOnY(0.32, x0 + 0.46, z0 + 0.14, 0.055, '#E5EAEE'),
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

function statusShapes(floorPts, status) {
  if (!STATUS[status]) return [];
  return [poly(floorPts, STATUS[status], { o: 0.22 }), poly(floorPts, 'none', { stroke: STATUS[status], sw: status === 'over' ? 3 : 2, cls: status === 'over' ? 'pulse' : '' })];
}

function roomCell(room, x0, z0, { last, ground, status }) {
  const type = room ? room.type : 'empty';
  const floor = FLOOR[type] || '#EFE6D8';
  const shapes = [
    ...box(x0, 0, z0 - SLAB, 1, D, SLAB, SLAB_SIDE, { top: floor, left: SLAB_SIDE, right: shade(SLAB_SIDE, -0.1) }),
    ...box(x0, 0, z0, 1, T, H, WALL_TOP, { faces: 'lt', left: WALL_BACK, top: WALL_TOP }),
    ...(type !== 'bathroom' && type !== 'kitchen' ? windowOnY(T, x0 + 0.62, x0 + 0.86, z0 + 0.36, z0 + 0.6) : []),
    ...box(x0, 0, z0, T, D, H, WALL_TOP, { faces: 'rt', right: WALL_SIDE, top: WALL_TOP }),
  ];
  const floorPts = [P(x0 + T, T, z0), P(x0 + 1, T, z0), P(x0 + 1, D, z0), P(x0 + T, D, z0)];
  shapes.push(...statusShapes(floorPts, status));
  if (room) shapes.push(...furniture(type, x0, z0));
  if (last) {
    shapes.push(...box(x0 + 1 - T, 0, z0, T, D, H, OUTSIDE, { faces: 'rt', right: shade(OUTSIDE, -0.08), top: WALL_TOP }));
    shapes.push(...windowOnX(x0 + 1, 0.22, 0.48, z0 + 0.32, z0 + 0.58));
    if (ground) shapes.push(onX(x0 + 1, 0.66, 0.9, z0, z0 + 0.52, '#7FA6C9'), onX(x0 + 1, 0.85, 0.87, z0 + 0.24, z0 + 0.28, '#F6C453'));
  }
  return shapes;
}

function garageShapes(x0, status) {
  const w = 1.1;
  const h = 0.62;
  return [
    ...box(x0, 0, -SLAB, w, D, SLAB, SLAB_SIDE, { top: '#D7DADF' }),
    ...box(x0, 0, 0, w, D, h, OUTSIDE, { left: OUTSIDE, right: shade(OUTSIDE, -0.1), top: '#E8E0D6' }),
    onY(D, x0 + 0.14, x0 + 0.96, 0, 0.5, '#C9CDD3'),
    ...[0.08, 0.16, 0.24, 0.32, 0.4].map((z) => onY(D, x0 + 0.14, x0 + 0.96, z, z + 0.015, '#B3B8BF')),
    ...box(x0 - 0.03, -0.03, h, w + 0.06, D + 0.06, 0.06, '#CFC5B8'),
    ...statusShapes([P(x0, 0, h + 0.06), P(x0 + w + 0.03, 0, h + 0.06), P(x0 + w + 0.03, D + 0.03, h + 0.06), P(x0, D + 0.03, h + 0.06)], status),
    ...windowOnX(x0 + w, 0.35, 0.8, 0.28, 0.48),
  ];
}

function deckShapes(x0, status) {
  const w = 1.1;
  const y0 = 0.06;
  const d = D - 0.12;
  const shapes = [...box(x0, y0, 0, w, d, 0.1, '#D9A877', { top: '#E6BB8C' })];
  for (let i = 1; i < 6; i++) shapes.push(poly([P(x0 + (w * i) / 6, y0, 0.1), P(x0 + (w * i) / 6 + 0.008, y0, 0.1), P(x0 + (w * i) / 6 + 0.008, y0 + d, 0.1), P(x0 + (w * i) / 6, y0 + d, 0.1)], '#C99B6B'));
  shapes.push(...statusShapes([P(x0, y0, 0.1), P(x0 + w, y0, 0.1), P(x0 + w, y0 + d, 0.1), P(x0, y0 + d, 0.1)], status));
  // Railing along the back and right edges.
  shapes.push(...box(x0, y0, 0.1, w, 0.03, 0.3, '#E6BB8C', { faces: 'lt' }));
  for (const yy of [y0, y0 + d / 2, y0 + d - 0.04]) shapes.push(...box(x0 + w - 0.04, yy, 0.1, 0.04, 0.04, 0.32, '#C99B6B'));
  // A sun lounger, an umbrella and a pot plant.
  shapes.push(...box(x0 + 0.2, 0.32, 0.1, 0.42, 0.2, 0.08, WHITE, { top: '#FFF6E8' }));
  shapes.push(...box(x0 + 0.2, 0.32, 0.18, 0.08, 0.2, 0.14, WHITE));
  shapes.push(...box(x0 + 0.78, 0.5, 0.1, 0.02, 0.02, 0.62, '#9A9A9A'));
  shapes.push(poly([P(x0 + 0.79, 0.51, 0.78), P(x0 + 0.49, 0.51, 0.62), P(x0 + 0.79, 0.81, 0.62)], '#F26B5B'),
    poly([P(x0 + 0.79, 0.51, 0.78), P(x0 + 0.79, 0.81, 0.62), P(x0 + 1.09, 0.51, 0.62)], '#F59585'));
  shapes.push(...box(x0 + 0.86, 0.12, 0.1, 0.12, 0.12, 0.12, '#E08A5F'), ball(x0 + 0.92, 0.18, 0.34, 0.13, GREEN));
  return shapes;
}

function gardenShapes(x0, y0, w, status) {
  const d = 0.6;
  const shapes = [
    ...box(x0, y0, -0.06, w, d, 0.1, '#9B6B47', { top: '#8FD07A' }),
    ...statusShapes([P(x0, y0, 0.04), P(x0 + w, y0, 0.04), P(x0 + w, y0 + d, 0.04), P(x0, y0 + d, 0.04)], status),
  ];
  const flowers = ['#F48FB1', '#FFD166', '#FFFFFF', '#F48FB1', '#FFD166', '#C3A6F2'];
  for (let i = 0; i < 6; i++) {
    const fx = x0 + 0.15 + (i % 3) * (w - 0.3) / 2;
    const fy = y0 + 0.16 + Math.floor(i / 3) * 0.28;
    shapes.push(ball(fx, fy, 0.13, 0.07, '#5BAA58'), ball(fx, fy, 0.18, 0.035, flowers[i]));
  }
  shapes.push(...box(x0 + w - 0.18, y0 + 0.2, 0.04, 0.05, 0.05, 0.3, '#8B5E3C'), ball(x0 + w - 0.15, y0 + 0.22, 0.52, 0.22, '#5BB35A'), ball(x0 + w - 0.2, y0 + 0.18, 0.6, 0.12, '#7ACB6F'));
  return shapes;
}

/** A gable roof, lifted up and back off the top floor so you can see into the rooms below it. */
function roofShapes(x0, x1, base, status) {
  const back = 0.45; // shifted towards the back of the house
  const eave = base;
  const ridge = eave + 0.5;
  const ya = -0.12 - back;
  const yb = D + 0.12 - back;
  const ym = (ya + yb) / 2;
  const front = [P(x0, yb, eave), P(x1, yb, eave), P(x1, ym, ridge), P(x0, ym, ridge)];
  return [
    ...box(x0 + 0.3, ya + 0.24, eave + 0.05, 0.16, 0.16, 0.62, '#D9694B'),
    poly(front, '#EF7B5A'),
    ...[0.12, 0.24, 0.36].map((k) => {
      const y = yb - (yb - ym) * (k / 0.5);
      const z = eave + k;
      return poly([P(x0, y, z), P(x1, y, z), P(x1, y + 0.012, z - 0.012), P(x0, y + 0.012, z - 0.012)], '#E06A4A');
    }),
    poly([P(x0, yb, eave), P(x1, yb, eave), P(x1, yb, eave - 0.06), P(x0, yb, eave - 0.06)], '#C95A3E'),
    poly([P(x1, ya, eave), P(x1, yb, eave), P(x1, ym, ridge)], '#F7B39A'),
    poly([P(x1, ya, eave), P(x1, yb, eave), P(x1, yb, eave - 0.06), P(x1, ya, eave - 0.06)], '#D9694B'),
    ...windowOnX(x1, ym - 0.16, ym + 0.16, eave + 0.06, eave + 0.26),
    ...(STATUS[status] ? [poly(front, 'none', { stroke: STATUS[status], sw: status === 'over' ? 3 : 2, cls: status === 'over' ? 'pulse' : '' })] : []),
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
  shapes.push(poly([P(xa + ix, yb - iy, bottom), P(xb - ix, yb - iy, bottom), apex], '#B88A62'));
  shapes.push(poly([P(xb - ix, ya + iy, bottom), P(xb - ix, yb - iy, bottom), apex], '#987150'));
  shapes.push(...box(xa, ya, bottom, xb - xa, yb - ya, 0.32, '#C4936A', { top: '#A9DB8F', left: '#C9996F', right: '#AE7F58' }));
  // Grass lip
  shapes.push(poly([P(xa, yb, top), P(xb, yb, top), P(xb, yb, top - 0.07), P(xa, yb, top - 0.07)], '#8CC874'));
  shapes.push(poly([P(xb, ya, top), P(xb, yb, top), P(xb, yb, top - 0.07), P(xb, ya, top - 0.07)], '#7DB866'));
  return shapes;
}

// ---------- Layout ----------

/**
 * Works out where everything goes. rooms: your active rooms. status(roomId) → 'none' | 'ok' | 'near' | 'over'.
 * Returns { parts: [{ id, roomId, shapes }], pins: [{ roomId, at: [x, y] }], stages: [room], extras: [room], viewBox }.
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

  const placed = interior.slice(0, 12);
  const extras = [...interior.slice(12), ...garages.slice(1), ...outdoor.slice(2), ...exterior.slice(1)];
  const n = Math.max(1, placed.length);
  const floorCount = n <= 3 ? 1 : n <= 8 ? 2 : 3;
  const perFloor = Math.ceil(n / floorCount);
  const floors = [];
  for (let f = 0; f < floorCount; f++) floors.push(placed.slice(f * perFloor, (f + 1) * perFloor));
  if (!placed.length) floors[0] = [null]; // an empty shell until rooms are added

  const garage = garages[0];
  const deck = outdoor[0];
  const garden = outdoor[1];
  const roof = exterior[0];
  const groundWidth = floors[0].length;
  const garageX = groundWidth;
  const deckX = groundWidth + (garage ? 1.1 : 0);
  const rightEdge = deckX + (deck ? 1.1 : 0);
  const frontEdge = garden ? D + 0.95 : D + 0.45;

  const parts = [];
  const pins = [];
  const add = (id, roomId, shapes, pinAt) => {
    parts.push({ id, roomId, shapes });
    if (roomId && pinAt) pins.push({ roomId, at: pinAt });
  };

  add('shadow', null, [{ t: 'ellipse', c: P(rightEdge / 2 + 0.3, frontEdge / 2 + 0.2, -2.15), rx: (rightEdge + frontEdge) * C * S * 0.3, ry: 0.32 * S, fill: 'rgba(40, 60, 120, 0.13)', cls: 'house-shadow' }]);
  add('island', null, islandShapes(-0.5, rightEdge + 0.45, -0.5, frontEdge));
  add('tree', null, [...box(-0.3, -0.3, -SLAB, 0.06, 0.06, 0.5, '#8B5E3C'), ball(-0.27, -0.27, 0.62, 0.3, '#5BB35A'), ball(-0.33, -0.33, 0.74, 0.18, '#7ACB6F')]);

  floors[0].forEach((room, i) => add(room ? room.id : 'empty', room?.id, roomCell(room, i, 0, {
    last: i === floors[0].length - 1 && !garage, ground: true, status: room ? status(room.id) : 'none',
  }), P(i + 0.55, D * 0.62, 0.42)));
  if (garage) add(garage.id, garage.id, garageShapes(garageX, status(garage.id)), P(garageX + 0.55, D * 0.5, 0.95));
  if (deck) add(deck.id, deck.id, deckShapes(deckX, status(deck.id)), P(deckX + 0.35, D * 0.55, 0.55));
  if (garden) add(garden.id, garden.id, gardenShapes(0, D + 0.18, Math.min(1.6, Math.max(1, groundWidth - 0.2)), status(garden.id)), P(0.55, D + 0.5, 0.45));

  let base = 0;
  for (let f = 1; f < floors.length; f++) {
    base = f * (H + GAP);
    const z0 = base;
    floors[f].forEach((room, i) => add(room.id, room.id, roomCell(room, i, z0, {
      last: i === floors[f].length - 1, ground: false, status: status(room.id),
    }), P(i + 0.55, D * 0.62, z0 + 0.42)));
  }
  const topWidth = floors[floors.length - 1].length;
  const roofBase = base + H + ROOF_LIFT;
  add(roof ? roof.id : 'roof', roof?.id, roofShapes(-0.1, topWidth + 0.1, roofBase, roof ? status(roof.id) : 'none'),
    P(topWidth * 0.55, D / 2 - 0.45, roofBase + 0.62));

  // Fit the picture: bounds of every point, plus room for the pins.
  const xs = [];
  const ys = [];
  for (const p of parts) {
    for (const s of p.shapes) {
      if (s.t === 'poly') for (const [x, y] of s.pts) { xs.push(x); ys.push(y); }
      else if (s.t === 'circle') { xs.push(s.c[0] - s.r, s.c[0] + s.r); ys.push(s.c[1] - s.r, s.c[1] + s.r); }
      else { xs.push(s.c[0] - s.rx, s.c[0] + s.rx); ys.push(s.c[1] - s.ry, s.c[1] + s.ry); }
    }
  }
  for (const pin of pins) ys.push(pin.at[1] - 36);
  const pad = 14;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const viewBox = [minX, minY, Math.max(...xs) - minX + pad, Math.max(...ys) - minY + pad].map(r2);
  return { parts, pins, stages, extras, viewBox };
}

// ---------- Drawing ----------

function Shape({ s }) {
  if (s.t === 'circle') return html`<circle cx=${s.c[0]} cy=${s.c[1]} r=${s.r} fill=${s.fill} />`;
  if (s.t === 'ellipse') return html`<ellipse class=${s.cls} cx=${s.c[0]} cy=${s.c[1]} rx=${s.rx} ry=${s.ry} fill=${s.fill} />`;
  const points = s.pts.map((p) => p.join(',')).join(' ');
  if (s.stroke) return html`<polygon class=${s.cls || ''} points=${points} fill="none" stroke=${s.stroke} stroke-width=${s.sw} stroke-linejoin="round" />`;
  return html`<polygon points=${points} fill=${s.fill} fill-opacity=${s.o ?? 1}
    stroke=${s.o ? 'none' : s.fill} stroke-width="0.6" stroke-linejoin="round" />`;
}

const STATUS_ICON = { ok: '✓', near: '!', over: '‼' };
export const STATUS_TEXT = { ok: 'On track', near: 'Nearly at budget', over: 'Over budget', none: 'No budget' };

/** A room's bubble: its emoji with a badge showing its budget status (shape + colour). */
export function StatusBadge({ status }) {
  if (!STATUS_ICON[status]) return null;
  return html`<span class="status-badge s-${status}" aria-hidden="true">${STATUS_ICON[status]}</span>`;
}

/**
 * The house. rooms: active rooms. stats: Map roomId → { status, ... }.
 * selectedId / onSelect(roomId | null): which part is lifted.
 */
export function House({ rooms, stats, selectedId, onSelect }) {
  const status = (id) => stats.get(id)?.status || 'none';
  const { parts, pins, viewBox } = buildHouse(rooms, status);
  const [vx, vy, vw, vh] = viewBox;
  const roomName = (id) => rooms.find((r) => r.id === id)?.name || '';
  return html`<div class="house" style=${`aspect-ratio:${vw} / ${vh}`}>
    <svg viewBox=${viewBox.join(' ')} class="house-svg ${selectedId ? 'has-selection' : ''}" role="img"
      aria-label="Your house. Tap a room to see its spending." onClick=${(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
      <g class="house-float">
        ${parts.map((p) => html`<g key=${p.id} class="house-part ${p.roomId ? 'tappable' : ''} ${p.roomId && p.roomId === selectedId ? 'selected' : ''}"
          onClick=${p.roomId ? (e) => { e.stopPropagation(); onSelect(p.roomId === selectedId ? null : p.roomId); } : undefined}>
          ${p.shapes.map((s, i) => html`<${Shape} key=${i} s=${s} />`)}
        </g>`)}
      </g>
    </svg>
    ${pins.map((pin) => {
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
  </div>`;
}
