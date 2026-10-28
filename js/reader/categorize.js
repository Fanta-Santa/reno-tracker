// Suggests a category for each receipt item, from keywords and from what you've chosen before.
// Pure functions (no DOM), so they can be unit tested in Node.

import { splitByWeights } from '../format.js';

// Each rule's words are matched as whole words (plurals allowed). Phrases count for more than single words.
const RULES = {
  tools: {
    phrases: ['skin only', 'nail gun', 'heat gun', 'glue gun', 'spirit level', 'laser level', 'tape measure', 'measuring tape',
      'stud finder', 'socket set', 'drill bit', 'bit set', 'hole saw', 'tool box', 'tool bag', 'shop vac', 'wet and dry',
      'utility knife', 'stanley knife', 'tile cutter', 'tile saw', 'caulking gun', 'mixing paddle', 'safety glasses',
      'circular saw', 'mitre saw', 'drop saw', 'multi tool', 'rotary hammer', 'impact driver', 'drill driver', 'pry bar'],
    words: ['drill', 'driver', 'saw', 'jigsaw', 'sander', 'grinder', 'multitool', 'oscillating', 'router', 'planer', 'nailer',
      'battery', 'charger', '18v', '36v', '12v', 'makita', 'dewalt', 'ryobi', 'milwaukee', 'bosch', 'ozito', 'hikoki', 'metabo',
      'festool', 'aeg', 'chisel', 'hammer', 'mallet', 'clamp', 'spanner', 'wrench', 'pliers', 'screwdriver', 'blade', 'ladder',
      'trestle', 'sawhorse', 'wheelbarrow', 'toolbox', 'vacuum', 'workbench', 'multimeter', 'crimper', 'crowbar', 'trowel',
      'respirator', 'earmuffs', 'gloves', 'goggles', 'leveller'],
  },
  hardware: {
    phrases: ['wall plug', 'liquid nails', 'construction adhesive', 'cable tie', 'zip tie', 'batten screw', 'decking screw',
      'chipboard screw', 'joist hanger', 'nail plate', 'tie down', 'coach screw', 'threaded rod', 'thread tape', 'hose clamp',
      'duct tape', 'gaffer tape', 'tek screw', 'wd 40', 'wd40'],
    words: ['screw', 'bolt', 'nut', 'washer', 'nail', 'anchor', 'plug', 'bracket', 'hinge', 'hook', 'rivet', 'dowel', 'staple',
      'fixing', 'fastener', 'glue', 'adhesive', 'silicone', 'sealant', 'sikaflex', 'sika', 'tek', 'bugle', 'galv', 'galvanised',
      'zinc', 'chain', 'rope', 'lubricant', 'clip', 'saddle', 'magnet', 'buildex', 'pryda', 'ramset', 'cable ties'],
  },
  materials: {
    phrases: ['tile adhesive', 'fibre cement', 'deck board', 'cement mix', 'rapid set', 'pvc pipe', 'roof sheet', 'twin and earth',
      'vinyl plank', 'spotted gum', 'treated pine', 'mgp10', 'mgp12'],
    words: ['timber', 'pine', 'treated', 'h3', 'h4', 'f17', 'lvl', 'hardwood', 'merbau', 'blackbutt', 'plywood', 'ply', 'mdf',
      'particleboard', 'osb', 'gyprock', 'plasterboard', 'plaster', 'cornice', 'villaboard', 'hardiflex', 'cement', 'concrete',
      'sand', 'mortar', 'gravel', 'aggregate', 'sleeper', 'decking', 'batten', 'joist', 'bearer', 'post', 'beam', 'stud', 'noggin',
      'architrave', 'skirting', 'moulding', 'dressed', 'primed', 'tile', 'grout', 'membrane', 'waterproofing', 'insulation', 'batts',
      'sarking', 'colorbond', 'roofing', 'flashing', 'gutter', 'downpipe', 'fascia', 'pipe', 'conduit', 'cable', 'paver', 'brick',
      'besser', 'stone', 'pebbles', 'mulch', 'soil', 'turf', 'lattice', 'fencing', 'paling', 'laminate', 'flooring', 'underlay',
      'carpet', 'sheet', 'board'],
  },
  paint: {
    phrases: ['drop sheet', 'drop cloth', 'masking tape', 'painters tape', 'gap filler', 'no more gaps', 'sanding block',
      'sanding disc', 'wash wear', 'low sheen', 'semi gloss', 'ceiling white', 'mineral turps', 'sugar soap', 'decking oil',
      'british paints', 'feast watson', 'paint tray'],
    words: ['paint', 'primer', 'undercoat', 'sealer', 'stain', 'varnish', 'polyurethane', 'oil', 'lacquer', 'enamel', 'dulux',
      'taubmans', 'wattyl', 'haymes', 'cabot', 'cabots', 'intergrain', 'rustoleum', 'roller', 'brush', 'tray', 'masking', 'frogtape',
      'filler', 'putty', 'spakfilla', 'polyfilla', 'caulk', 'sandpaper', 'sanding', 'abrasive', 'gloss', 'matt', 'turps',
      'thinner', 'metho'],
  },
  fixtures: {
    phrases: ['shower head', 'towel rail', 'power point', 'ceiling fan', 'smoke alarm', 'hot water', 'toilet roll holder',
      'lever set', 'robe hook', 'batten light'],
    words: ['tap', 'mixer', 'basin', 'vanity', 'toilet', 'cistern', 'shower', 'rose', 'rail', 'towel', 'handle', 'knob', 'pull',
      'light', 'downlight', 'pendant', 'switch', 'powerpoint', 'gpo', 'fan', 'exhaust', 'door', 'lock', 'latch', 'deadbolt', 'sink',
      'benchtop', 'cabinet', 'drawer', 'mirror', 'blind', 'curtain', 'shelf', 'shelving', 'oven', 'cooktop', 'rangehood',
      'dishwasher', 'heater', 'splashback', 'led'],
  },
  hire: {
    phrases: ['per day', 'day hire', 'weekend hire', 'half day', '1 day', '2 day', '3 day', '4 hour'],
    words: ['hire', 'hired', 'rental', 'rent', 'kennards', 'coates'],
  },
  waste: {
    phrases: ['skip bin', 'bin hire', 'tip fee', 'green waste', 'rubbish removal'],
    words: ['skip', 'rubbish', 'waste', 'disposal', 'dump', 'landfill', 'recycling', 'removal', 'tip'],
  },
  freight: {
    phrases: ['delivery fee', 'delivery charge', 'freight charge'],
    words: ['freight', 'delivery', 'shipping', 'cartage', 'courier', 'postage'],
  },
  labour: {
    phrases: ['call out', 'service fee', 'electrical work', 'plumbing work', 'labour charge'],
    words: ['labour', 'labor', 'install', 'installation', 'installed', 'callout', 'electrician', 'plumber', 'tiler', 'carpenter',
      'hours', 'hrs', 'hourly', 'contractor'],
  },
};

// Which of your categories each kind of item belongs in, matched on the category's name.
const KIND_TO_CATEGORY = {
  tools: /tool/i,
  hardware: /hardware|fixing|fastener/i,
  materials: /material|timber|building/i,
  paint: /paint|finish/i,
  fixtures: /fixture|fitting|appliance/i,
  hire: /hire|rental/i,
  waste: /waste|disposal|rubbish|skip/i,
  labour: /trade|labou?r|contractor/i,
  freight: /freight|deliver|shipping|cartage/i, // only if you've added a category like "Freight"
};

// Some stores mostly sell one kind of thing.
const STORE_KIND = [
  [/kennards|coates|hire/i, 'hire'],
  [/total tools|sydney tools|tool kit depot|trade tools/i, 'tools'],
  [/dulux|taubmans|haymes|inspirations paint|paint/i, 'paint'],
  [/reece|tradelink/i, 'fixtures'],
  [/beaumont|tile/i, 'materials'],
  [/skip|waste|rubbish/i, 'waste'],
];

// Words that often turn up in other kinds of items too, so they count for less.
const WEAK = new Set(['board', 'sheet', 'post', 'stud', 'light', 'pull', 'rose', 'rail', 'tip', 'plug', 'oil', 'tray', 'blade',
  'cable', 'pipe', 'led', 'handle', 'sand', 'chain', 'rope', 'clip', 'saddle', 'magnet', 'stone', 'batten', 'driver', 'gloves',
  'removal', 'dump', 'stain', 'tap', 'nut', 'hook', 'matt', 'gloss', 'towel', 'rent', 'delivery']);

function words(text) {
  return ` ${text.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

function hasWord(haystack, word) {
  return haystack.includes(` ${word} `) || haystack.includes(` ${word}s `) || haystack.includes(` ${word}es `);
}

/** Scores each kind for a description. Returns [{ kind, score }] best first. */
export function scoreKinds(description, storeName = '') {
  const h = words(description);
  const scores = [];
  for (const [kind, rule] of Object.entries(RULES)) {
    let score = 0;
    for (const p of rule.phrases) if (h.includes(` ${p} `)) score += 3;
    for (const w of rule.words) if (hasWord(h, w)) score += WEAK.has(w) ? 0.75 : 1.5;
    if (score) scores.push({ kind, score });
  }
  for (const [re, kind] of STORE_KIND) {
    if (re.test(storeName)) {
      const s = scores.find((x) => x.kind === kind);
      if (s) s.score += 1;
      else scores.push({ kind, score: 0.5, fromStore: true });
      break;
    }
  }
  return scores.sort((a, b) => b.score - a.score);
}

/** A short key for remembering what you chose: "Buildex Screw Batten 14G x 75 50PK" → "buildex screw batten". */
export function itemKey(description) {
  return words(description).trim().split(' ').filter((w) => w.length >= 3 && !/\d/.test(w)).slice(0, 3).join(' ');
}

/** Finds your category for a kind of item, or null if you've renamed/removed it. */
export function categoryForKind(kind, categories) {
  const re = KIND_TO_CATEGORY[kind];
  return (re && categories.find((c) => !c.archived && re.test(c.name))) || null;
}

/**
 * Suggests a category for one item.
 * categories: your categories. learned: { [itemKey]: { categoryId, isTool } }.
 * Returns { categoryId, isTool, confidence: 'high'|'medium'|'low', alternatives: [categoryId] }.
 */
export function suggestCategory(description, { categories, learned = {}, storeName = '', storeCategoryId = null }) {
  const active = categories.filter((c) => !c.archived);
  const isActive = (id) => active.some((c) => c.id === id);
  const toolFor = (id) => !!active.find((c) => c.id === id)?.isTool;

  const key = itemKey(description);
  const memory = key && learned[key];
  const ranked = scoreKinds(description, storeName)
    .map((s) => ({ ...s, category: categoryForKind(s.kind, active) }))
    .filter((s) => s.category);
  const alternatives = [...new Set(ranked.map((s) => s.category.id))];

  if (memory && isActive(memory.categoryId)) {
    return { categoryId: memory.categoryId, isTool: memory.isTool ?? toolFor(memory.categoryId), confidence: 'high', alternatives, source: 'learned' };
  }
  if (ranked.length) {
    const [top, second] = ranked;
    const clearWinner = !top.fromStore && top.score >= 1.5 && (!second || top.score - second.score >= 1);
    const decent = !top.fromStore && (!second || top.score > second.score);
    return {
      categoryId: top.category.id,
      isTool: toolFor(top.category.id),
      confidence: clearWinner ? 'high' : decent ? 'medium' : 'low',
      alternatives,
      source: top.fromStore ? 'store' : 'keywords',
    };
  }
  if (storeCategoryId && isActive(storeCategoryId)) {
    return { categoryId: storeCategoryId, isTool: toolFor(storeCategoryId), confidence: 'low', alternatives, source: 'store' };
  }
  return { categoryId: null, isTool: false, confidence: 'low', alternatives, source: 'none' };
}

/**
 * Works out a quote's breakdown by category from the lines read off it, e.g. labour, equipment hire and freight.
 * The lines may be priced with or without GST; the total is split in proportion. Lines the app isn't sure about go
 * in the biggest category. Returns [{ categoryId, amountCents }] biggest first, or null if it's all one category
 * (or the lines don't add up to the total).
 */
export function breakdownFromItems(items, totalCents, ctx) {
  if (!totalCents || items.length < 2) return null;
  const sum = items.reduce((s, it) => s + it.amountCents, 0);
  const near = (a, b) => Math.abs(a - b) <= Math.max(2, Math.round(b * 0.01));
  if (!near(sum, totalCents) && !near(Math.round(sum * 1.1), totalCents)) return null;
  const groups = new Map();
  let unsure = 0;
  for (const it of items) {
    const s = suggestCategory(it.description, ctx);
    if (s.categoryId && s.confidence !== 'low') groups.set(s.categoryId, (groups.get(s.categoryId) || 0) + it.amountCents);
    else unsure += it.amountCents;
  }
  if (groups.size < 2) return null;
  const list = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  list[0][1] += unsure;
  const amounts = splitByWeights(totalCents, list.map(([, cents]) => cents));
  return list.map(([categoryId], i) => ({ categoryId, amountCents: amounts[i] }));
}
