// Logic tests. No framework, no install: `node test/run.mjs`.

import { buildCourse, rateWord, normalizeCode, fairwayHalfWidth, nearNeighbours } from '../js/course.js';
import { tabulatedPar } from '../js/pars.js';
import { ANSWERS, ALLOWED, isValidGuess } from '../js/words.js';
import {
  scoreGuess, shotFor, knowledgeFrom, scoreEmoji, strokesFromEmoji, BLOWUP_STROKES,
  progressFromKnowledge, shotQuality, candidatesRemaining,
} from '../js/game.js';
import { buildShareCard, parseShareCard } from '../js/leaderboard.js';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, wanted ${e}`);
}

// ------------------------------------------------------------ wordle marking

eq('exact match is all green', scoreGuess('wispy', 'wispy'),
  ['correct', 'correct', 'correct', 'correct', 'correct']);

// The duplicate-letter rule: a second E has no unmatched E left to claim.
eq('duplicate letter only marks once', scoreGuess('speed', 'abide'),
  ['absent', 'absent', 'present', 'absent', 'present']);

eq('green consumes the letter before yellow', scoreGuess('geese', 'eject'),
  ['absent', 'present', 'correct', 'absent', 'absent']);

eq('repeat in guess, single in answer', scoreGuess('allay', 'alarm'),
  ['correct', 'correct', 'absent', 'present', 'absent']);

// --------------------------------------------------------------- par ratings

// Par is measured by simulating a solver, not by counting letters. Words a
// standard opener walks onto play short.
for (const word of ['stare', 'crane', 'slate', 'trail']) {
  check(`${word} is a par 3`, rateWord(word).par === 3, `got par ${rateWord(word).par}`);
}
// The -IVER family is the pool's worst trap: know four letters and still guess.
for (const word of ['river', 'diver', 'power', 'wider', 'shade']) {
  check(`${word} is a par 5`, rateWord(word).par === 5, `got par ${rateWord(word).par}`);
}
// Letter-counting called BRIDE easy because r/i/d/e are common, but a standard
// opener leaves BRIDE and PRIDE with nothing to tell them apart.
check('bride is a par 4, not a par 3', rateWord('bride').par === 4,
  `got par ${rateWord('bride').par}`);
check('bride has a one-letter neighbour', nearNeighbours('bride').includes('pride'));
check('every answer rates 3, 4 or 5', ANSWERS.every((w) => [3, 4, 5].includes(rateWord(w).par)));
check('the par table covers the whole pool',
  ANSWERS.every((w) => [3, 4, 5].includes(tabulatedPar(w))));
// Each bucket must be deep enough to fill the layout without repeating itself.
const buckets = { 3: 0, 4: 0, 5: 0 };
for (const w of ANSWERS) buckets[rateWord(w).par] += 1;
check('every par bucket can fill a course',
  buckets[3] >= 20 && buckets[4] >= 20 && buckets[5] >= 20,
  JSON.stringify(buckets));

// ------------------------------------------------------------------ courses

const course = buildCourse('7KQ2F');
check('a course has nine holes', course.holes.length === 9);
eq('a nine is always par 36', course.par, 36);
check('hole words are all playable answers', course.holes.every((h) => ANSWERS.includes(h.word)));
check('holes do not repeat', new Set(course.holes.map((h) => h.word)).size === 9);
eq('the same code builds the same course', JSON.stringify(buildCourse('7kq2f')), JSON.stringify(course));
check('different codes build different courses',
  JSON.stringify(buildCourse('ABCDE')) !== JSON.stringify(course));
eq('codes normalise to A-Z0-9', normalizeCode(' 7kq-2f! '), '7KQ2F');

// --------------------------------------------------------------- shot model

// A shot never travels backwards, and holing out puts the ball in the cup.
const hole = course.holes[0];
const guesses = ['stare', 'cloud', 'pinky', hole.word];
const rows = guesses.map((g) => ({ guess: g, marks: scoreGuess(g, hole.word) }));
const shots = rows.map((row, i) => shotFor({ hole, rows, index: i, solved: row.guess === hole.word }));

check('every shot advances the ball',
  shots.every((s, i) => i === 0 || s.progress >= shots[i - 1].progress));
check('holing out leaves nothing to the pin',
  shots[shots.length - 1].remainingYards === 0 && shots[shots.length - 1].lie === 'hole');
check('a first shot still covers ground', shots[0].remainingYards < hole.yards);

// ------------------------------------------------- shots match the golf

// A flat 400-yard par 4. The word must come from the answer pool: the shot
// model measures how many answers are still possible, so a hole word outside
// the pool makes the board unsatisfiable.
const testHole = {
  number: 1, word: 'money', par: 4, yards: 400,
  features: { fairwayWidth: 0.2, greenSize: 0.09, water: false, dogleg: 0, bunkers: 2, treeSeed: 1 },
};
check('the test hole word is a real answer', ANSWERS.includes(testHole.word));

const playHole = (words) => {
  const rs = words.map((w) => ({ guess: w, marks: scoreGuess(w, testHole.word) }));
  return rs.map((_, i) =>
    shotFor({ hole: testHole, rows: rs, index: i, solved: rs[i].guess === testHole.word }));
};
const carry = (shot) => testHole.yards - shot.remainingYards;

// Distance is how much is still unknown, so the field has to shrink for the
// ball to travel. Counting greens could not tell a constraining three greens
// from a loose one; -ONE- leaves one word and is a tap-in, not an approach.
check('the pool starts whole', candidatesRemaining([]) === ANSWERS.length);

const blank = playHole(['blitz'])[0];        // no letters, but five eliminated
check('a drive that learns little is short',
  carry(blank) < testHole.yards * 0.4, `carried ${carry(blank)}y`);
check('a drive that learns little is not struck well',
  blank.quality === 'duff' || blank.quality === 'poor', `rated ${blank.quality}`);

// Your round: STEAL, then HONED leaving only MONEY, then MONEY.
const round = playHole(['steal', 'honed', 'money']);
check('a one-yellow drive is a drive, not a pop-up',
  carry(round[0]) > 150 && carry(round[0]) < 260, `carried ${carry(round[0])}y`);
check('narrowing to one word puts you on the green', round[1].lie === 'green');
check('narrowing to one word leaves a tap-in',
  round[1].remainingYards <= 10, `${round[1].remainingYards}y left`);
check('the shot that narrowed it is the great one', round[1].quality === 'pure');
check('holing a tap-in is described as a putt',
  /putt|knocks it in/i.test(round[2].label), round[2].label);
// The point of the rewrite: the drama belongs to the shot that did the work.
check('the final tap-in is not billed as a miracle',
  !/heroic|holed it from/i.test(round[2].label), round[2].label);

// A swing that barely shrinks the field is a bad swing, wherever you lie.
const wasted = playHole(['steal', 'salts']);
check('a guess that adds little is a poor shot',
  wasted[1].quality === 'duff' || wasted[1].quality === 'poor', `rated ${wasted[1].quality}`);
check('a guess that adds little barely advances the ball',
  wasted[1].remainingYards > round[1].remainingYards + 80);

// Eliminating letters helps, and only as much as it actually helps.
const greyOnly = knowledgeFrom([{ guess: 'blitz', marks: scoreGuess('blitz', 'money') }]);
check('greys move you, but not to the green', progressFromKnowledge(greyOnly) < 0.45,
  `progress ${progressFromKnowledge(greyOnly).toFixed(2)}`);
check('fewer candidates is always further along',
  [945, 300, 90, 30, 6, 2, 1].every((n, i, arr) => {
    if (i === 0) return true;
    const k = (x) => 1 - Math.log2(x) / Math.log2(ANSWERS.length);
    return progressFromKnowledge(k(n)) > progressFromKnowledge(k(arr[i - 1]));
  }));
check('only holing out gets you to the cup', progressFromKnowledge(1) <= 1
  && playHole(['steal', 'honed'])[1].remainingYards > 0);

// The same absolute gain means different things early and late.
const RANK = { duff: 0, poor: 1, ok: 2, solid: 3, pure: 4 };
check('quality is judged against what was left to learn',
  RANK[shotQuality(0.1, 0)] < RANK[shotQuality(0.1, 0.8)],
  `${shotQuality(0.1, 0)} early vs ${shotQuality(0.1, 0.8)} late`);
check('a swing that teaches nothing is always a duff',
  shotQuality(0, 0) === 'duff' && shotQuality(0.005, 0.7) === 'duff');

// ------------------------------------------------------------- word list

check('popular openers are legal guesses',
  ['stare', 'learn', 'crane', 'slate', 'adieu', 'audio', 'raise', 'arose', 'tears'].every(isValidGuess));
check('everyday words are legal guesses',
  ['vodka', 'pizza', 'mould', 'jumps', 'happy'].every(isValidGuess));
// Words that a hand-written list had been turning away.
check('ordinary words are legal guesses',
  ['clone', 'filed', 'liner', 'grime', 'slant', 'porch', 'wedge', 'tonic', 'miner',
   'baled', 'toned', 'riled', 'paler', 'cored', 'sated'].every(isValidGuess));
check('the guess list is dictionary-sized', ALLOWED.size > 10000, `only ${ALLOWED.size}`);
check('nonsense is rejected',
  !isValidGuess('qqqqq') && !isValidGuess('zxcvb') && !isValidGuess('abcde'));

// The answer pool seeds course generation: change its contents or its order and
// every course code already shared silently repoints to different words.
eq('the answer pool is unchanged', ANSWERS.length, 945);
eq('the answer pool order is unchanged',
  `${ANSWERS[0]}/${ANSWERS[472]}/${ANSWERS[944]}`, 'about/model/zebra');
check('every answer is also a legal guess', ANSWERS.every(isValidGuess));

// A known course, pinned. If this moves, shared codes have broken. It last
// moved when par stopped being counted from letters and started being measured,
// which necessarily repartitioned the buckets courses are drawn from.
eq('course 7KQ2F still plays the same nine',
  buildCourse('7KQ2F').holes.map((h) => h.word).join(','),
  'extra,album,spent,judge,knife,alert,stool,going,glory');

// ------------------------------------------------------------- share cards

const holeStrokes = [4, 3, 3, BLOWUP_STROKES, 4, 4, 5, 4, 4];
const total = holeStrokes.reduce((a, b) => a + b, 0);
const card = buildShareCard({
  course, player: 'Jo', strokes: total, toPar: total - course.par, holeStrokes,
});
const parsed = parseShareCard(card, course);
eq('a card round-trips its strokes', parsed.holeStrokes, holeStrokes);
eq('a card round-trips its total', parsed.strokes, total);
eq('a card round-trips the player', parsed.player, 'Jo');

// A great round leans on the eagle glyph, which cannot express -3 or better.
const greatHoles = [1, 2, 1, 2, 2, 1, 2, 2, 3];
const greatTotal = greatHoles.reduce((a, b) => a + b, 0);
const greatCard = buildShareCard({
  course, player: 'Jo', strokes: greatTotal, toPar: greatTotal - course.par, holeStrokes: greatHoles,
});
check('an exceptional round still imports', !parseShareCard(greatCard, course).error);

check('a card for another course is refused',
  parseShareCard(card.replace('7KQ2F', 'ABCDE'), course).error);
check('an edited total is refused',
  parseShareCard(card.replace(`— ${total}`, '— 9'), course).error);
check('ordinary chat is not a card', parseShareCard('what are you playing tonight', course) === null);

// Every score glyph has to survive the trip back to a stroke count.
for (const par of [3, 4, 5]) {
  for (let strokes = 1; strokes <= BLOWUP_STROKES; strokes++) {
    const back = strokesFromEmoji(scoreEmoji(strokes, par), par);
    check(`glyph for ${strokes} on a par ${par} decodes`, back !== null);
  }
}

// ---------------------------------------------------------------- results

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
