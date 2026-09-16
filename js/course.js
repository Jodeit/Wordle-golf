// Course generation: turns a short course code into nine holes with pars,
// yardages and a name. Everything is derived from the code, so two players who
// type the same code play exactly the same course.

import { ANSWERS } from './words.js';
import { tabulatedPar } from './pars.js';

// ---------------------------------------------------------------- seeded rng

// Small, fast, fully deterministic PRNG (mulberry32).
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Course codes are short, unambiguous and shout-able across a group chat.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I

export function randomCourseCode() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

// ------------------------------------------------------------ par & yardage

// Letters that show up in the popular openers (LEARN, STARE, CRANE, SLATE,
// ADIEU). A word built from these is easy to chip away at, so it plays short.
const OPENER_LETTERS = new Set(['s', 't', 'a', 'r', 'e', 'l', 'n', 'c', 'i', 'o', 'u', 'd']);
const AWKWARD_LETTERS = new Set(['j', 'q', 'x', 'z', 'v', 'k', 'w']);

// Par comes from a measured table (see js/pars.js): a solver plays every answer
// from standard openers and par follows its expected strokes. Counting letters
// cannot see the traps — BRIDE is all common letters and looks easy, but a
// standard opener leaves BRIDE and PRIDE with nothing to separate them.
//
// The letter counts here no longer set par. They survive only to explain a
// hole to the player, which is what holeNotes uses them for.
export function rateWord(word) {
  const letters = word.split('');
  const distinct = new Set(letters);
  const duplicates = letters.length - distinct.size;

  let openerCover = 0;
  let awkward = 0;
  for (const letter of distinct) {
    if (OPENER_LETTERS.has(letter)) openerCover += 1;
    if (AWKWARD_LETTERS.has(letter)) awkward += 1;
  }

  return { par: tabulatedPar(word), duplicates, awkward, openerCover };
}

// Answers sitting one letter away from this one. These are what actually cost
// strokes: you can know four letters and still be guessing.
export function nearNeighbours(word) {
  return ANSWERS.filter((other) => {
    if (other === word) return false;
    let differences = 0;
    for (let i = 0; i < 5; i++) {
      if (other[i] !== word[i] && ++differences > 1) return false;
    }
    return differences === 1;
  });
}

// Why a hole plays the way it does, in caddie language.
export function holeNotes(word) {
  const { par, duplicates, awkward, openerCover } = rateWord(word);
  const neighbours = nearNeighbours(word);
  const notes = [];

  // Near neighbours are only worth warning about on a hole that plays long.
  // STARE has nine of them and is still a par 3, because an opener walks
  // straight onto it — saying "careful" there would just be confusing.
  if (par >= 4) {
    if (neighbours.length >= 3) {
      notes.push(`Careful — ${neighbours.length} other answers sit one letter from this one.`);
    } else if (neighbours.length === 2) {
      notes.push('Two other answers are a single letter away. Pick carefully.');
    } else if (neighbours.length === 1) {
      notes.push('There is another answer one letter from this one. A coin flip waits.');
    }
  }

  if (duplicates >= 2) notes.push('Three of a kind in there somewhere — brutal.');
  else if (duplicates === 1) notes.push('There is a repeated letter.');
  if (awkward >= 2) notes.push('Two letters your opener will never find.');
  else if (awkward === 1) notes.push('One awkward letter hiding in the trees.');

  if (!notes.length) {
    if (openerCover >= 4) notes.push('Wide fairway — a standard opener lights it up.');
    else if (openerCover <= 2) notes.push('Narrow off the tee. Common letters will not help much.');
    else notes.push('Honest par golf. Hit the fairway and go.');
  }
  if (par === 5 && notes.length < 2) notes.push('This one plays long.');
  return notes;
}

function yardageFor(par, rng) {
  if (par === 3) return 145 + Math.round(rng() * 65); // 145-210
  if (par === 5) return 495 + Math.round(rng() * 90); // 495-585
  return 335 + Math.round(rng() * 115); // 335-450
}

// ----------------------------------------------------------- hole geometry

// The hole runs tee (t=0) to green (t=1). A dogleg bends the centre line.
export function centerX(t, dogleg) {
  return 0.5 + dogleg * Math.sin(Math.PI * t);
}

// Half-width of the fairway at t. It pinches slightly through the landing
// zone, like a real hole. Both the shot model and the map read this, so a ball
// drawn on the short grass is always scored as being on the short grass.
export function fairwayHalfWidth(hole, t) {
  const pinch = 1 - 0.14 * Math.sin(Math.PI * Math.min(1, t / 0.8));
  return hole.features.fairwayWidth * pinch;
}

// ------------------------------------------------------------ hole features

function featuresFor(par, rng) {
  return {
    // Doglegs bend the fairway; sign decides which way.
    dogleg: rng() < 0.45 ? (rng() < 0.5 ? -1 : 1) * (0.12 + rng() * 0.18) : 0,
    bunkers: par === 3 ? 1 + Math.round(rng()) : 2 + Math.round(rng() * 2),
    water: rng() < (par === 5 ? 0.45 : 0.3),
    fairwayWidth: 0.16 + rng() * 0.1,
    greenSize: par === 3 ? 0.11 + rng() * 0.03 : 0.085 + rng() * 0.035,
    treeSeed: Math.floor(rng() * 100000),
  };
}

// ------------------------------------------------------------ course naming

const NAME_FIRST = [
  'Cedar', 'Birch', 'Hollow', 'Bramble', 'Thistle', 'Clover', 'Foxglove', 'Heron',
  'Osprey', 'Badger', 'Kestrel', 'Windmill', 'Quarry', 'Saltmarsh', 'Ironwood',
  'Pebble', 'Tanglewood', 'Bellrock', 'Harrow', 'Muirfield', 'Stonecross',
  'Gorse', 'Mallard', 'Copper', 'Whistling', 'Blackthorn', 'Larkspur', 'Dunmore',
];
const NAME_SECOND = [
  'Ridge', 'Hollow', 'Bend', 'Point', 'Downs', 'Moor', 'Glen', 'Bluff', 'Landing',
  'Commons', 'Meadow', 'Run', 'Crossing', 'Head', 'Sands', 'Reach', 'Wood', 'Vale',
];
const NAME_SUFFIX = [
  'Golf Club', 'Links', 'National', 'Country Club', 'Golf Links', 'Municipal',
  'Golf & Country Club', 'Dunes', 'Park',
];

function nameFor(rng) {
  const first = NAME_FIRST[Math.floor(rng() * NAME_FIRST.length)];
  let second = NAME_SECOND[Math.floor(rng() * NAME_SECOND.length)];
  if (second === first) second = 'Ridge';
  const suffix = NAME_SUFFIX[Math.floor(rng() * NAME_SUFFIX.length)];
  return `${first} ${second} ${suffix}`;
}

// A classic nine: two par 3s, five par 4s, two par 5s — par 36 every time, so
// scores from different courses are still comparable.
const LAYOUTS = [
  [4, 5, 3, 4, 4, 3, 5, 4, 4],
  [4, 3, 5, 4, 4, 5, 3, 4, 4],
  [5, 4, 3, 4, 5, 4, 3, 4, 4],
  [4, 4, 3, 5, 4, 3, 4, 5, 4],
  [3, 4, 5, 4, 3, 4, 4, 5, 4],
];

// --------------------------------------------------------------- generation

export function buildCourse(code) {
  const normalized = normalizeCode(code) || 'TEEUP';
  const rng = makeRng(hashString(`wordle-golf::${normalized}`));

  const buckets = { 3: [], 4: [], 5: [] };
  for (const word of ANSWERS) buckets[rateWord(word).par].push(word);

  const layout = LAYOUTS[Math.floor(rng() * LAYOUTS.length)];
  const used = new Set();
  const holes = layout.map((par, index) => {
    const pool = buckets[par].length ? buckets[par] : buckets[4];
    let word = pool[Math.floor(rng() * pool.length)];
    let attempts = 0;
    while (used.has(word) && attempts++ < 50) {
      word = pool[Math.floor(rng() * pool.length)];
    }
    used.add(word);

    return {
      number: index + 1,
      word,
      par,
      yards: yardageFor(par, rng),
      notes: holeNotes(word),
      features: featuresFor(par, rng),
    };
  });

  return {
    code: normalized,
    name: nameFor(rng),
    holes,
    par: holes.reduce((sum, hole) => sum + hole.par, 0),
    yards: holes.reduce((sum, hole) => sum + hole.yards, 0),
  };
}
