// Leaderboard + share cards.
//
// There is no server here, so a course leaderboard lives in your browser. The
// way it travels between friends is the share card: paste a mate's card in and
// their round joins your board for that course. Because a course code fully
// determines the pars, an imported card reconstructs real strokes, not guesses.

import { scoreEmoji, strokesFromEmoji, toParLabel } from './game.js';

const STORE_PREFIX = 'wordle-golf:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    /* private mode or full quota — the round still plays, it just won't persist */
  }
}

// -------------------------------------------------------------- player name

export function getPlayerName() {
  return read('player', '') || '';
}

export function setPlayerName(name) {
  write('player', String(name || '').slice(0, 20));
}

// ------------------------------------------------------------- saved rounds

export function saveRound(round) {
  write(`round:${round.courseCode}`, round);
}

export function loadRound(courseCode) {
  return read(`round:${courseCode}`, null);
}

export function clearRound(courseCode) {
  try {
    localStorage.removeItem(`${STORE_PREFIX}round:${courseCode}`);
  } catch (err) {
    /* nothing to clean up */
  }
}

// -------------------------------------------------------------- leaderboard

export function getLeaderboard(courseCode) {
  const entries = read(`board:${courseCode}`, []);
  return entries.sort((a, b) => a.strokes - b.strokes || a.at - b.at);
}

export function submitScore(courseCode, entry) {
  const entries = read(`board:${courseCode}`, []);
  const key = entry.player.trim().toLowerCase();
  const existing = entries.findIndex((e) => e.player.trim().toLowerCase() === key);

  if (existing >= 0) {
    // Keep a player's best round on the board, not their latest.
    if (entries[existing].strokes <= entry.strokes) return getLeaderboard(courseCode);
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }
  write(`board:${courseCode}`, entries);
  return getLeaderboard(courseCode);
}

export function knownCourses() {
  const courses = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${STORE_PREFIX}board:`)) {
        courses.push(key.slice(`${STORE_PREFIX}board:`.length));
      }
    }
  } catch (err) {
    /* storage unavailable */
  }
  return courses;
}

// ------------------------------------------------------------- share cards

export function buildShareCard({ course, player, strokes, toPar, holeStrokes, url }) {
  const marks = holeStrokes
    .map((s, i) => (s == null ? '▫️' : scoreEmoji(s, course.holes[i].par)))
    .join('');
  const lines = [
    `⛳ Wordle Golf — ${course.name}`,
    `Course ${course.code} · Par ${course.par}`,
    `${player} — ${strokes} (${toParLabel(toPar)})`,
    marks,
  ];
  if (url) lines.push(`Play it: ${url}`);
  return lines.join('\n');
}

// Split an emoji run into single glyphs, keeping variation selectors attached.
function splitEmoji(text) {
  const out = [];
  for (const ch of Array.from(text)) {
    if (ch === '️' && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

const SCORE_GLYPHS = new Set(['🕳️', '🕳', '🦅', '🐦', '⚪', '🟨', '🟧', '🟥', '❌']);

// Parse a pasted share card back into a leaderboard entry. Returns null if the
// text is not a card, or an object with an `error` when it is a card we cannot
// trust (wrong course, wrong hole count, totals that do not add up).
export function parseShareCard(text, course) {
  const raw = String(text || '');
  if (!/wordle golf/i.test(raw)) return null;

  const codeMatch = raw.match(/course\s+([A-Z0-9]{3,8})/i);
  const scoreMatch = raw.match(/^\s*(.{1,30}?)\s+[—-]\s+(\d{1,3})\s*\(([+-]?\d+|E)\)/m);
  if (!codeMatch || !scoreMatch) return null;

  const code = codeMatch[1].toUpperCase();
  if (code !== course.code) {
    return { error: `That card is for course ${code}, not ${course.code}.` };
  }

  let marks = null;
  for (const line of raw.split('\n')) {
    const glyphs = splitEmoji(line.trim());
    if (glyphs.length && glyphs.every((g) => SCORE_GLYPHS.has(g))) {
      marks = glyphs;
      break;
    }
  }
  if (!marks) return null;
  if (marks.length !== course.holes.length) {
    return { error: `That card has ${marks.length} holes, this course has ${course.holes.length}.` };
  }

  const holeStrokes = marks.map((glyph, i) =>
    strokesFromEmoji(glyph === '🕳' ? '🕳️' : glyph, course.holes[i].par));
  if (holeStrokes.some((s) => s == null)) return null;

  const strokes = Number(scoreMatch[2]);
  const derived = holeStrokes.reduce((a, b) => a + b, 0);
  // Anything better than an eagle collapses into the same glyph, so each 🦅
  // can understate the round by a shot. Allow for that, and treat a bigger
  // gap as a card that has been edited.
  const eagles = marks.filter((g) => g === '🦅').length;
  if (Math.abs(derived - strokes) > eagles + 1) {
    return { error: 'That card\'s total does not match its hole-by-hole marks.' };
  }

  return {
    player: scoreMatch[1].trim().slice(0, 20),
    strokes,
    toPar: strokes - course.par,
    holeStrokes,
    at: Date.now(),
    imported: true,
  };
}
