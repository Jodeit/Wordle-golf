// Regenerates js/pars.js by measuring how hard each answer actually is.
//
// Run with: node tools/build-pars.mjs
//
// A solver plays every answer from three standard openers, choosing sensibly
// and paying the real cost when candidates cannot be told apart. A word's
// expected strokes is the average, and par follows from it. This exists
// because counting letters cannot see the traps: BRIDE is all common letters
// and looks easy, but an opener leaves BRIDE and PRIDE with nothing to
// separate them, and that ambiguity is the stroke.

import fs from 'fs';
import { ANSWERS } from '../js/words.js';
import { scoreGuess } from '../js/game.js';

const OPENERS = ['stare', 'crane', 'slate'];
const PAR_3_BELOW = 3.02;
const PAR_5_ABOVE = 3.70;
const SOLVED = 'correctcorrectcorrectcorrectcorrect';

const key = (guess, word) => scoreGuess(guess, word).join('');

const memo = new Map();

// Expected guesses to finish from a set of still-possible answers.
function expected(candidates) {
  const n = candidates.length;
  if (n === 1) return 1;
  if (n === 2) return 1.5;            // a coin flip, and half the time it costs
  const id = candidates.join(',');
  if (memo.has(id)) return memo.get(id);

  let best = Infinity;
  for (const guess of candidates.slice(0, Math.min(n, 30))) {
    const buckets = new Map();
    for (const word of candidates) {
      const k = key(guess, word);
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    let cost = 1;
    for (const [k, size] of buckets) {
      if (k === SOLVED) continue;
      cost += (size / n) * (size === 1 ? 1 : size === 2 ? 1.5 : 1 + Math.log2(size) / 1.6);
    }
    if (cost < best) best = cost;
  }
  memo.set(id, best);
  return best;
}

function expectedStrokes(answer) {
  let total = 0;
  for (const opener of OPENERS) {
    if (opener === answer) { total += 1; continue; }
    const marks = key(opener, answer);
    total += 1 + expected(ANSWERS.filter((w) => key(opener, w) === marks));
  }
  return total / OPENERS.length;
}

function wrap(words) {
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line.length + 6 > 92) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

const buckets = { 3: [], 4: [], 5: [] };
for (const answer of ANSWERS) {
  const strokes = expectedStrokes(answer);
  buckets[strokes < PAR_3_BELOW ? 3 : strokes > PAR_5_ABOVE ? 5 : 4].push(answer);
}
for (const par of [3, 4, 5]) buckets[par].sort();

const header = fs.readFileSync(new URL('../js/pars.js', import.meta.url), 'utf8')
  .split('const PAR_3 =')[0];

fs.writeFileSync(new URL('../js/pars.js', import.meta.url),
  `${header}const PAR_3 = \`\n${wrap(buckets[3])}\n\`;\n\nconst PAR_5 = \`\n${wrap(buckets[5])}\n\`;\n\n`
  + `const toSet = (source) => new Set(source.split(/\\s+/).filter(Boolean));\n\n`
  + `export const PAR_3_WORDS = toSet(PAR_3);\nexport const PAR_5_WORDS = toSet(PAR_5);\n\n`
  + `// Everything not called short or long is an honest par 4.\n`
  + `export function tabulatedPar(word) {\n`
  + `  if (PAR_3_WORDS.has(word)) return 3;\n  if (PAR_5_WORDS.has(word)) return 5;\n  return 4;\n}\n`);

console.log(`par 3: ${buckets[3].length}  par 4: ${buckets[4].length}  par 5: ${buckets[5].length}`);
