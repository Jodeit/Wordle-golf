// Game rules: Wordle feedback, golf scoring, and the shot model that turns
// each guess into a ball on the overhead map. Pure logic — no DOM in here.

import { makeRng, hashString, fairwayHalfWidth } from './course.js';

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

// How much of the word you have pinned down, 0..1. Greens count double
// because knowing the slot is worth more than knowing the letter.
export function knowledgeFrom(rows) {
  const greens = new Set();
  const presentLetters = new Set();
  for (const row of rows) {
    row.marks.forEach((mark, i) => {
      if (mark === 'correct') greens.add(i);
      else if (mark === 'present') presentLetters.add(row.guess[i]);
    });
  }
  // Letters known-present but not yet placed are worth half a green.
  const value = greens.size * 2 + Math.min(5 - greens.size, presentLetters.size);
  return Math.min(1, value / 10);
}

// ---------------------------------------------------------------- shot model

// A golfer always advances the ball, even off a bad swing, so every shot has a
// floor. Good information pushes you past that floor and closer to the cup.
const SHOT_PACE = [0.62, 0.8, 0.895, 0.945, 0.975, 0.99];

export function shotFor({ hole, rows, index, solved }) {
  const knowledge = knowledgeFrom(rows.slice(0, index + 1));
  const infoProgress = 1 - Math.pow(1 - knowledge, 1.6);
  const previous = index === 0 ? 0 : shotProgressCache(hole, rows, index - 1);
  let progress = Math.max(SHOT_PACE[index] ?? 0.99, infoProgress, previous + 0.03);
  if (solved) progress = 1;
  progress = Math.min(1, progress);

  const remainingYards = Math.max(0, Math.round(hole.yards * (1 - progress)));
  const row = rows[index];
  const greys = row.marks.filter((m) => m === 'absent').length;
  const wildness = greys / row.marks.length;

  // Seeded per hole and per shot so replaying a round redraws it identically.
  const rng = makeRng(hashString(`${hole.word}:${hole.number}:${index}:${row.guess}`));
  const spread = (1 - progress * 0.75) * (0.25 + wildness * 0.9);
  const lateral = (rng() * 2 - 1) * spread;

  const lie = lieFor({ hole, progress, lateral, remainingYards, solved, rng });
  return {
    index,
    guess: row.guess,
    marks: row.marks,
    knowledge,
    progress,
    remainingYards,
    lateral,
    lie,
    solved,
    label: shotLabel({ index, lie, remainingYards, solved, hole }),
  };
}

// Progress is defined recursively (a shot never goes backwards), so memoize
// the chain rather than recomputing it for every redraw.
const progressCache = new Map();
function shotProgressCache(hole, rows, index) {
  const key = `${hole.number}:${index}:${rows.slice(0, index + 1).map((r) => r.guess).join(',')}`;
  if (progressCache.has(key)) return progressCache.get(key);
  const knowledge = knowledgeFrom(rows.slice(0, index + 1));
  const infoProgress = 1 - Math.pow(1 - knowledge, 1.6);
  const previous = index === 0 ? 0 : shotProgressCache(hole, rows, index - 1);
  const progress = Math.min(1, Math.max(SHOT_PACE[index] ?? 0.99, infoProgress, previous + 0.03));
  progressCache.set(key, progress);
  return progress;
}

function lieFor({ hole, progress, lateral, remainingYards, solved, rng }) {
  if (solved) return 'hole';
  const width = fairwayHalfWidth(hole, progress);
  const offLine = Math.abs(lateral);

  if (remainingYards <= Math.round(hole.yards * hole.features.greenSize)) {
    if (offLine > width * 1.25 && rng() < 0.55) return 'bunker';
    return 'green';
  }
  if (offLine > width * 2.1) {
    if (hole.features.water && rng() < 0.3) return 'water';
    return 'trees';
  }
  if (offLine > width) return 'rough';
  if (offLine > width * 1.6 && rng() < 0.4) return 'bunker';
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

function shotLabel({ index, lie, remainingYards, solved, hole }) {
  if (solved) {
    if (index === 0) return 'HOLE IN ONE. Absolute nonsense.';
    if (remainingYards === 0 && index === 1) return 'Holed it from off the green!';
    return index >= 3 ? 'Putt drops. Grinding.' : 'In the cup.';
  }
  const distance = `${remainingYards} yards out`;
  if (index === 0) {
    if (lie === 'fairway') return `Drive down the middle — ${distance}.`;
    if (lie === 'rough') return `Pulled it into the rough — ${distance}.`;
    if (lie === 'bunker') return `Found the fairway bunker — ${distance}.`;
    if (lie === 'water') return `That is wet. Reload — ${distance}.`;
    if (lie === 'green') return `Driving the green on a par ${hole.par}?!`;
    return `Sprayed into the trees — ${distance}.`;
  }
  if (lie === 'green') {
    const feet = Math.max(2, Math.round(remainingYards * 3));
    return `On the green, ${feet} feet for it.`;
  }
  if (lie === 'bunker') return `Short-sided in the sand — ${distance}.`;
  if (lie === 'water') return `In the hazard — ${distance}.`;
  if (lie === 'trees') return `Stymied behind a tree — ${distance}.`;
  if (lie === 'rough') return `In the thick stuff — ${distance}.`;
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
