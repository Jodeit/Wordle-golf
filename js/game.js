// Game rules: Wordle feedback, golf scoring, and the shot model that turns
// each guess into a ball on the overhead map. Pure logic — no DOM in here.

import { makeRng, hashString, fairwayHalfWidth } from './course.js';
import { ANSWERS } from './words.js';

export const MAX_GUESSES = 6;
// Walk off without holing out and you are taking a lost-ball penalty.
export const BLOWUP_STROKES = 8;

// ------------------------------------------------------------ wordle scoring

// Standard Wordle marking, including the fiddly duplicate-letter rule: a
// letter only goes yellow if the answer still has an unmatched copy of it.
export function scoreGuess(guess, answer) {
  const g = guess.toLowerCase().split('');
  const a = answer.toLowerCase().split('');
  const marks = new Array(g.length).fill('absent');
  const remaining = {};

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) marks[i] = 'correct';
    else remaining[a[i]] = (remaining[a[i]] || 0) + 1;
  }
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'correct') continue;
    if (remaining[g[i]] > 0) {
      marks[i] = 'present';
      remaining[g[i]] -= 1;
    }
  }
  return marks;
}

// ---------------------------------------------------------------- knowledge

// How far you are along the hole is how much is still unknown — literally, how
// many words could still be the answer. Counting greens and yellows cannot tell
// the difference between three greens that leave a hundred candidates and three
// that leave one; -ONE- is a tap-in, not a 58-yard approach. Greys need no
// special weighting either: eliminating letters shrinks the field on its own,
// by exactly as much as it actually helps.

const POOL = ANSWERS.length;
const MAX_BITS = Math.log2(POOL);

// Answers consistent with every piece of feedback so far.
export function candidatesRemaining(rows) {
  if (!rows.length) return POOL;
  const live = ANSWERS.filter((word) =>
    rows.every((row) => scoreGuess(row.guess, word).join('') === row.marks.join('')));
  // The hole's word is drawn from this pool, so it is always in there; guard
  // anyway so an impossible board cannot divide by zero.
  return Math.max(1, live.length);
}

// Cache by the exact sequence of guesses and marks: a hole is rebuilt in full
// on every shot, so the same prefixes get asked for repeatedly.
const candidateCache = new Map();
function candidatesCached(rows) {
  const key = rows.map((r) => `${r.guess}:${r.marks.join('')}`).join('|');
  let n = candidateCache.get(key);
  if (n === undefined) {
    n = candidatesRemaining(rows);
    if (candidateCache.size > 500) candidateCache.clear();
    candidateCache.set(key, n);
  }
  return n;
}

// 0 at the tee with the whole pool live, 1 when exactly one word can be right.
export function knowledgeFrom(rows) {
  const remaining = candidatesCached(rows);
  return Math.max(0, Math.min(1, 1 - Math.log2(remaining) / MAX_BITS));
}

// ---------------------------------------------------------------- shot model

// Distance is a function of what you know, not of how many swings you have
// taken. Calibrated against how a golfer would read the same result:
//
//   ~350 words left -> a pop-up that barely clears the forward tees
//   ~90 words left  -> a mediocre drive, still a long way in
//   ~30 words left  -> down the middle, a mid-iron in
//   ~6 words left   -> a wedge to the flag
//   1 word left     -> you know it; this is a tap-in
//
// The old model floored the first shot at 62% of the hole whatever it taught
// you, and before that counted greens, which could not tell a constraining
// three greens from a loose one.
const DUFF_FLOOR = 0.03;   // even a shank moves the ball a little
const KNOWLEDGE_CURVE = 0.75;
const MIN_ADVANCE = 0.012; // never draw two shots on top of each other
const MAX_UNSOLVED = 0.995; // knowing the word for certain is a tap-in, not a hole-out

export function progressFromKnowledge(knowledge) {
  const k = Math.max(0, Math.min(1, knowledge));
  return DUFF_FLOOR + (1 - DUFF_FLOOR) * Math.pow(k, KNOWLEDGE_CURVE);
}

// Position comes from total knowledge; how the shot was *struck* comes from
// what this swing added. A guess that tells you nothing new is a shank, even
// if you are already sitting in the middle of the fairway.
// Judged against how much there was left to find out, so the same absolute
// gain is a fine strike late on and a wasted swing off the tee.
export function shotQuality(gain, previousKnowledge = 0) {
  const headroom = Math.max(0.05, 1 - previousKnowledge);
  const share = gain / headroom;
  if (share >= 0.5) return 'pure';
  if (share >= 0.32) return 'solid';
  if (share >= 0.2) return 'ok';
  if (share >= 0.12) return 'poor';
  return 'duff';
}

const QUALITY_SPREAD = { pure: 0.05, solid: 0.14, ok: 0.3, poor: 0.6, duff: 1 };

// Build every shot on the hole in one pass. Each shot needs the one before it
// — for its lie, which drives the recovery commentary, and to stop two shots
// being drawn on top of each other — so they cannot be computed in isolation.
function shotSeries(hole, rows, solvedAt) {
  const series = [];
  let previousProgress = 0;
  let previousKnowledge = 0;

  for (let i = 0; i < rows.length; i++) {
    const solved = i === solvedAt;
    const knowledge = knowledgeFrom(rows.slice(0, i + 1));
    const gain = knowledge - previousKnowledge;
    const quality = solved ? 'pure' : shotQuality(gain, previousKnowledge);

    let progress = solved ? 1 : Math.min(MAX_UNSOLVED, progressFromKnowledge(knowledge));
    progress = Math.min(1, Math.max(progress, previousProgress + MIN_ADVANCE));

    const remainingYards = Math.max(0, Math.round(hole.yards * (1 - progress)));
    const rng = makeRng(hashString(`${hole.word}:${hole.number}:${i}:${rows[i].guess}`));
    const spread = QUALITY_SPREAD[quality] * (1 - progress * 0.55) * 0.55;
    const lateral = (rng() * 2 - 1) * spread;
    const lie = lieFor({ hole, progress, lateral, remainingYards, solved, quality, rng });

    series.push({
      index: i,
      guess: rows[i].guess,
      marks: rows[i].marks,
      knowledge,
      gain,
      quality,
      progress,
      remainingYards,
      lateral,
      lie,
      solved,
      previousLie: i === 0 ? 'tee' : series[i - 1].lie,
    });

    previousProgress = progress;
    previousKnowledge = knowledge;
  }
  return series;
}

export function shotFor({ hole, rows, index, solved }) {
  const series = shotSeries(hole, rows, solved ? index : -1);
  const shot = series[index];
  return { ...shot, label: shotLabel({ ...shot, hole }) };
}

function lieFor({ hole, progress, lateral, remainingYards, solved, quality, rng }) {
  if (solved) return 'hole';
  const width = fairwayHalfWidth(hole, progress);
  const offLine = Math.abs(lateral);

  if (remainingYards <= Math.round(hole.yards * hole.features.greenSize)) {
    if (quality === 'duff' || (quality === 'poor' && rng() < 0.5)) return 'bunker';
    return 'green';
  }
  if (offLine > width * 2.1) {
    if (hole.features.water && rng() < 0.3) return 'water';
    return 'trees';
  }
  if (offLine > width * 1.5 && quality !== 'pure' && rng() < 0.45) return 'bunker';
  if (offLine > width) return 'rough';
  return 'fairway';
}

const LIE_NAMES = {
  fairway: 'fairway',
  rough: 'rough',
  bunker: 'bunker',
  trees: 'trees',
  water: 'water hazard',
  green: 'green',
  hole: 'bottom of the cup',
};

export function lieName(lie) {
  return LIE_NAMES[lie] || lie;
}

function shotLabel({ index, lie, quality, remainingYards, solved, hole, previousLie }) {
  if (solved) {
    if (index === 0) return 'HOLE IN ONE. Absolute nonsense.';
    if (previousLie === 'green') {
      if (index >= 4) return 'Putt drops at last. Grinding.';
      return index === 1 ? 'Knocks it in.' : 'Drains the putt.';
    }
    if (previousLie === 'bunker') return 'Holed it out of the sand!';
    if (previousLie === 'trees') return 'Holed it from the trees. Ridiculous.';
    return 'Holed it from off the green!';
  }

  const distance = `${remainingYards} yards out`;

  // Off the tee, the strike is the story — but check where it finished first,
  // or a drive good enough to reach the green gets called offline.
  if (index === 0) {
    if (lie === 'green') return `Drove it onto the green. On a par ${hole.par}!`;
    if (quality === 'duff') return `Pop-up off the tee — ${distance}. Grim.`;
    if (quality === 'poor') return `Thin and short — ${distance}.`;
    if (quality === 'pure') {
      return lie === 'fairway'
        ? `Striped it. Miles down the middle — ${distance}.`
        : `Huge, but offline — ${distance}.`;
    }
    if (lie === 'fairway') return `Good drive, short grass — ${distance}.`;
    if (lie === 'rough') return `Pulled it into the rough — ${distance}.`;
    if (lie === 'bunker') return `Found the fairway bunker — ${distance}.`;
    if (lie === 'water') return `That is wet. Reload — ${distance}.`;
    return `Sprayed into the trees — ${distance}.`;
  }

  // A recovery is only heroic if you were in trouble to begin with.
  const wasInTrouble = previousLie === 'trees' || previousLie === 'bunker' || previousLie === 'water';
  if (quality === 'pure' && wasInTrouble) {
    return lie === 'green'
      ? `Heroic recovery — on the dance floor from there.`
      : `Somehow escaped, and it is pin-high — ${distance}.`;
  }

  if (quality === 'duff') {
    if (lie === 'bunker') return `Shanked it into the sand — ${distance}.`;
    if (lie === 'trees') return `Chunked it into the trees — ${distance}.`;
    if (lie === 'water') return `Duffed it into the water — ${distance}.`;
    return `Barely moved it — ${distance}.`;
  }

  if (lie === 'green') {
    const feet = Math.max(1, Math.round(remainingYards * 3));
    if (feet <= 8) return `Stone dead. ${feet === 1 ? 'A foot' : `${feet} feet`} for it.`;
    if (quality === 'pure') return `Stuffed it. ${feet} feet for it.`;
    return `On the green, ${feet} feet for it.`;
  }
  if (lie === 'bunker') return `Short-sided in the sand — ${distance}.`;
  if (lie === 'water') return `In the hazard — ${distance}.`;
  if (lie === 'trees') return `Stymied behind a tree — ${distance}.`;
  if (lie === 'rough') return `In the thick stuff — ${distance}.`;
  if (quality === 'pure') return `Flushed it — ${distance}.`;
  if (quality === 'poor') return `Advanced it, not much more — ${distance}.`;
  return `Back on the short grass — ${distance}.`;
}

// ------------------------------------------------------------- golf scoring

export function strokesFor(holeState) {
  if (holeState.status === 'won') return holeState.rows.length;
  if (holeState.status === 'lost') return BLOWUP_STROKES;
  return holeState.rows.length;
}

export function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one';
  const diff = strokes - par;
  if (diff <= -3) return 'Albatross';
  if (diff === -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  if (diff === 2) return 'Double bogey';
  if (diff === 3) return 'Triple bogey';
  return 'Blow-up hole';
}

export function toParLabel(diff) {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

// Emoji used in the share card, keyed by strokes relative to par.
export function scoreEmoji(strokes, par) {
  if (strokes === 1) return '🕳️';
  const diff = strokes - par;
  if (diff <= -2) return '🦅';
  if (diff === -1) return '🐦';
  if (diff === 0) return '⚪';
  if (diff === 1) return '🟨';
  if (diff === 2) return '🟧';
  if (diff === 3) return '🟥';
  return '❌';
}

// Reverse of scoreEmoji, for importing a friend's share card. Ambiguous cases
// (an eagle could be -2 or better) resolve to the most common reading.
export function strokesFromEmoji(emoji, par) {
  switch (emoji) {
    case '🕳️': return 1;
    case '🦅': return Math.max(1, par - 2);
    case '🐦': return par - 1;
    case '⚪': return par;
    case '🟨': return par + 1;
    case '🟧': return par + 2;
    case '🟥': return par + 3;
    case '❌': return BLOWUP_STROKES;
    default: return null;
  }
}

// ------------------------------------------------------------- round state

export function newRound(course, playerName) {
  return {
    courseCode: course.code,
    courseName: course.name,
    player: playerName,
    startedAt: Date.now(),
    currentHole: 0,
    holes: course.holes.map((hole) => ({
      number: hole.number,
      word: hole.word,
      par: hole.par,
      rows: [],
      status: 'playing', // playing | won | lost
      shots: [],
    })),
  };
}

export function roundTotals(round, course) {
  let strokes = 0;
  let par = 0;
  let played = 0;
  for (let i = 0; i < round.holes.length; i++) {
    const state = round.holes[i];
    if (state.status === 'playing') continue;
    played += 1;
    strokes += strokesFor(state);
    par += course.holes[i].par;
  }
  return { strokes, par, played, toPar: strokes - par, complete: played === round.holes.length };
}
