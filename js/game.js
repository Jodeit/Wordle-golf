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

// ---------------------------------------------------------------- knowledge

// What each kind of feedback is worth. A green is a placed letter and worth
// double a floating one. Greys genuinely help — five dead letters narrows the
// field — but only a little: eliminating is not advancing.
const GREEN_VALUE = 2;
const YELLOW_VALUE = 1;
const GREY_VALUE = 0.15;
const GREY_MAX = 1.5;      // greys alone can never walk you up the fairway
const KNOWLEDGE_CAP = 0.95; // only holing out puts the ball in the cup

// How much of the word you have pinned down, 0..1, from all feedback so far.
export function knowledgeFrom(rows) {
  const greenPositions = new Set();
  const present = new Set();
  const absent = new Set();

  for (const row of rows) {
    row.marks.forEach((mark, i) => {
      const letter = row.guess[i];
      if (mark === 'correct') greenPositions.add(i);
      else if (mark === 'present') present.add(letter);
      else absent.add(letter);
    });
  }
  // A duplicate letter can come back both present and absent; the stronger
  // signal wins, otherwise it would be counted twice.
  for (const letter of present) absent.delete(letter);
  for (const row of rows) {
    row.marks.forEach((mark, i) => {
      if (mark === 'correct') absent.delete(row.guess[i]);
    });
  }

  const greens = greenPositions.size;
  const yellows = Math.min(5 - greens, present.size);
  const value = greens * GREEN_VALUE
    + yellows * YELLOW_VALUE
    + Math.min(absent.size * GREY_VALUE, GREY_MAX);

  return Math.min(KNOWLEDGE_CAP, value / 10);
}

// ---------------------------------------------------------------- shot model

// Distance is a function of what you know, not of how many swings you have
// taken. Calibrated against how a golfer would read the same result:
//
//   nothing but greys   -> a pop-up that barely clears the forward tees
//   two floating letters-> a mediocre drive, still a long way in
//   three greens        -> 300 down the middle, and par is yours to lose
//   four greens         -> pin high, flicking a wedge
//
// The old model floored the first shot at 62% of the hole whatever you learned,
// which made a zero-letter drive look like a good one.
const DUFF_FLOOR = 0.06;   // even a shank moves the ball a little
const KNOWLEDGE_CURVE = 0.669;
const MIN_ADVANCE = 0.012; // never draw two shots on top of each other
const MAX_UNSOLVED = 0.985;

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
  const headroom = Math.max(0.05, KNOWLEDGE_CAP - previousKnowledge);
  const share = gain / headroom;
  if (share >= 0.45) return 'pure';
  if (share >= 0.28) return 'solid';
  if (share >= 0.15) return 'ok';
  if (share >= 0.09) return 'poor';
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
      return index >= 4 ? 'Putt drops at last. Grinding.' : 'Drains the putt.';
    }
    if (previousLie === 'bunker') return 'Holed it out of the sand!';
    if (previousLie === 'trees') return 'Holed it from the trees. Ridiculous.';
    return 'Holed it from off the green!';
  }

  const distance = `${remainingYards} yards out`;

  // Off the tee, the strike is the story.
  if (index === 0) {
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
    if (lie === 'green') return `Driving the green on a par ${hole.par}?!`;
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
    const feet = Math.max(2, Math.round(remainingYards * 3));
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
