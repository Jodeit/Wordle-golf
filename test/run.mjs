// Logic tests. No framework, no install: `node test/run.mjs`.

import { buildCourse, rateWord, normalizeCode, fairwayHalfWidth } from '../js/course.js';
import { ANSWERS, ALLOWED, isValidGuess } from '../js/words.js';
import { scoreGuess, shotFor, knowledgeFrom, scoreEmoji, strokesFromEmoji, BLOWUP_STROKES } from '../js/game.js';
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

// The whole premise: opener-friendly words play short, awkward ones play long.
for (const word of ['stare', 'learn', 'crane', 'trail', 'solar']) {
  check(`${word} is a par 3`, rateWord(word).par === 3, `got par ${rateWord(word).par}`);
}
for (const word of ['wispy', 'queen', 'fluff', 'vivid', 'knock']) {
  check(`${word} is a par 5`, rateWord(word).par === 5, `got par ${rateWord(word).par}`);
}
check('every answer rates 3, 4 or 5', ANSWERS.every((w) => [3, 4, 5].includes(rateWord(w).par)));

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
check('knowledge only grows',
  rows.every((_, i) => i === 0 || knowledgeFrom(rows.slice(0, i + 1)) >= knowledgeFrom(rows.slice(0, i))));

// The map draws the ball at centreline + lateral, so the lie has to be judged
// against the same fairway width the renderer uses.
let geometryChecked = 0;
let geometryMismatch = 0;
for (const h of course.holes) {
  for (const opener of ['stare', 'learn', 'pinky', 'vodka', 'mirth']) {
    const rs = [{ guess: opener, marks: scoreGuess(opener, h.word) }];
    const shot = shotFor({ hole: h, rows: rs, index: 0, solved: opener === h.word });
    if (shot.solved || shot.lie === 'bunker' || shot.lie === 'green') continue;
    geometryChecked += 1;
    const onShortGrass = Math.abs(shot.lateral) <= fairwayHalfWidth(h, shot.progress);
    if (onShortGrass !== (shot.lie === 'fairway')) geometryMismatch += 1;
  }
}
check('the drawn lie matches the reported lie',
  geometryChecked > 20 && geometryMismatch === 0, `${geometryMismatch}/${geometryChecked} disagreed`);

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

// A known course, pinned. If this moves, shared codes have broken.
eq('course 7KQ2F still plays the same nine',
  buildCourse('7KQ2F').holes.map((h) => h.word).join(','),
  'favor,alarm,stake,happy,humor,anger,spray,event,gleam');

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
