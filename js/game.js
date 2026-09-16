// Game rules: Wordle feedback, golf scoring, and the shot model that turns
// each guess into a ball on the overhead map. Pure logic — no DOM in here.

import { makeRng, hashString, fairwayHalfWidth } from './course.js';
import { ANSWERS } from './words.js';

// There is no failing a hole in golf — you keep swinging until the ball drops
// and card whatever it cost. So there is no six-guess wall and no penalty
// score: a hole you grind out in seven is simply a seven. The limit below is
// only a backstop so the grid cannot grow without end.
export const HARD_LIMIT = 12;
// Kept so older share cards still decode; nothing scores this any more.
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

// Positions you have nailed down. Four of five means you are one letter from
// the answer, whatever the candidate count says — and being one letter away is
// a putting problem, not an approach shot.
export function greensPlaced(rows) {
  const placed = new Set();
  for (const row of rows) {
    row.marks.forEach((mark, i) => { if (mark === 'correct') placed.add(i); });
  }
  return placed.size;
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

    // With four letters placed you are on the green by definition: the only
    // question left is which word, and that is settled with the putter. How
    // long the putt is depends on how many words still fit.
    if (!solved && greensPlaced(rows.slice(0, i + 1)) >= 4) {
      const live = candidatesCached(rows.slice(0, i + 1));
      const spread = Math.min(1, Math.log2(Math.max(1, live)) / Math.log2(20));
      const puttYards = hole.features.greenRadius * (0.08 + 0.92 * spread);
      progress = Math.max(progress, 1 - puttYards / hole.yards);
    }

    progress = Math.max(progress, previousProgress + MIN_ADVANCE);
    // Only holing out reaches the cup, so an unsolved shot always leaves
    // something — otherwise a missed putt reads as "0 yards out".
    progress = solved ? 1 : Math.min(MAX_UNSOLVED, progress);

    const remainingYards = solved ? 0 : Math.max(1, Math.round(hole.yards * (1 - progress)));
    const rng = makeRng(hashString(`${hole.word}:${hole.number}:${i}:${rows[i].guess}`));
    const spread = QUALITY_SPREAD[quality] * (1 - progress * 0.55) * 0.55;
    const lateral = (rng() * 2 - 1) * spread;
    const onGreenByLetters = !solved && greensPlaced(rows.slice(0, i + 1)) >= 4;
    const lie = lieFor({
      hole, progress, lateral, remainingYards, solved, quality, rng,
      previousLie: i === 0 ? 'tee' : series[i - 1].lie, onGreenByLetters,
    });

    const previousLie = i === 0 ? 'tee' : series[i - 1].lie;
    // Count the putts: a swing taken from the green is one, and holing out
    // from the green is the last of them.
    const previousPutts = i === 0 ? 0 : series[i - 1].putts;
    const putts = previousLie === 'green' ? previousPutts + 1 : 0;

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
      previousLie,
      putts,
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

// "Two-putt", "four-putt" — the phrase golfers actually use.
const PUTT_WORDS = ['', '', 'Two-putt', 'Three-putt', 'Four-putt', 'Five-putt', 'Six-putt'];
export function puttPhrase(putts) {
  return PUTT_WORDS[Math.min(putts, PUTT_WORDS.length - 1)] || `${putts}-putt`;
}

function lieFor({
  hole, progress, lateral, remainingYards, solved, quality, rng,
  previousLie, onGreenByLetters,
}) {
  if (solved) return 'hole';
  // You do not putt your way into a bunker. Once on the green you stay there,
  // and four letters placed puts you there regardless of how you struck it.
  if (previousLie === 'green' || onGreenByLetters) return 'green';

  const width = fairwayHalfWidth(hole, progress);
  const offLine = Math.abs(lateral);

  if (remainingYards <= hole.features.greenRadius) {
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

function shotLabel({ index, lie, quality, remainingYards, solved, hole, previousLie, putts }) {
  if (solved) {
    if (index === 0) return 'HOLE IN ONE. Absolute nonsense.';
    if (previousLie === 'green') {
      // `putts` already includes this one, the putt that drops.
      const total = Math.max(1, putts || 1);
      if (total >= 4) return `${puttPhrase(total)}. That one hurt.`;
      if (total === 3) return 'Three-putt. Grim work on the greens.';
      if (total === 2) return 'Two-putt, and away we go.';
      return 'Knocks it in.';
    }
    if (previousLie === 'bunker') return 'Holed it out of the sand!';
    if (previousLie === 'trees') return 'Holed it from the trees. Ridiculous.';
    return 'Holed it from off the green!';
  }

  const distance = `${remainingYards} yards out`;

  // Off the tee, the strike is the story — but check where it finished first,
  // or a drive good enough to reach the green gets called offline.
  if (index === 0) {
    // Reaching the green off the tee is the whole point of a par 3, so only
    // shout about it on a hole where it is a genuine feat.
    if (lie === 'green') {
      const feet = Math.max(1, Math.round(remainingYards * 3));
      if (hole.par === 3) {
        return feet <= 8
          ? `On the green, stiff. ${feet === 1 ? 'A foot' : `${feet} feet`} for it.`
          : `Green in regulation. ${feet} feet for it.`;
      }
      return `Drove it onto the green. On a par ${hole.par}!`;
    }
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

  if (lie === 'green') {
    const feet = Math.max(1, Math.round(remainingYards * 3));
    const puttDistance = feet === 1 ? 'a foot' : `${feet} feet`;
    // Already putting: say so, rather than describing it as an approach.
    if (putts >= 1) {
      if (putts >= 3) return `Missed again. ${puttDistance} left. Please.`;
      if (putts === 2) return `Slid it by. ${puttDistance} back.`;
      return `Missed the putt — ${puttDistance} left.`;
    }
    if (feet <= 8) return `Stone dead. ${puttDistance} for it.`;
    if (quality === 'pure') return `Stuffed it. ${feet} feet for it.`;
    return `On the green, ${feet} feet for it.`;
  }

  if (quality === 'duff') {
    if (lie === 'bunker') return `Shanked it into the sand — ${distance}.`;
    if (lie === 'trees') return `Chunked it into the trees — ${distance}.`;
    if (lie === 'water') return `Duffed it into the water — ${distance}.`;
    return `Barely moved it — ${distance}.`;
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

// Your strokes are your guesses. Always, however many that took.
export function strokesFor(holeState) {
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
    // A wreck of a hole collapses into one glyph; par+4 is the common reading.
    case '❌': return par + 4;
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
