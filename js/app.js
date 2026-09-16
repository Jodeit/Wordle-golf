// UI glue: wires the course, the grid, the map and the scorecard together.

import { buildCourse, randomCourseCode, normalizeCode } from './course.js';
import { isValidGuess } from './words.js';
import {
  HARD_LIMIT, scoreGuess, shotFor, strokesFor, scoreName, scoreEmoji,
  toParLabel, newRound, roundTotals,
} from './game.js';
import { HoleView } from './hole-view.js';
import { PerspectiveView } from './perspective-view.js';
import { celebrate, celebrateRound } from './celebrate.js';
import * as store from './leaderboard.js';

const $ = (id) => document.getElementById(id);

const state = {
  course: null,
  round: null,
  previewCourse: null,
  current: '',         // the guess being typed
  locked: false,       // true while a shot is in the air
  pendingSubmit: false, // an enter pressed mid-animation, played once it lands
};

// Two views of the same hole: the full-screen perspective the player stands in,
// and the overhead inset that shows where the ball actually is.
let scene = null;
let minimap = null;

// ------------------------------------------------------------------ modals

function openModal(id) {
  $('modal-root').hidden = false;
  for (const modal of document.querySelectorAll('.modal')) modal.hidden = modal.id !== id;
}

function closeModal() {
  $('modal-root').hidden = true;
  for (const modal of document.querySelectorAll('.modal')) modal.hidden = true;
}

function flash(text) {
  const el = $('message');
  el.textContent = text;
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 1800);
}

// ------------------------------------------------------------------ render

function holeState() {
  return state.round.holes[state.round.currentHole];
}

function holeSpec() {
  return state.course.holes[state.round.currentHole];
}

function renderHeader() {
  $('course-name').textContent = state.course.name;
  $('course-code').textContent = state.course.code;
}

function applyNotesSetting(on) {
  document.body.classList.toggle('no-notes', !on);
  const box = $('toggle-notes');
  if (box) box.checked = on;
}

function renderHole() {
  const hole = holeSpec();
  $('hole-number').textContent = hole.number;
  $('hole-par').textContent = hole.par;
  $('hole-yards').textContent = hole.yards;
  $('hole-notes').textContent = hole.notes.join(' ');

  const totals = roundTotals(state.round, state.course);
  $('round-total').textContent = totals.played ? toParLabel(totals.toPar) : 'E';

  const shots = holeState().shots;
  scene.setHole(hole, shots);
  minimap.setHole(hole, shots);
  $('shot-label').textContent = shots.length ? shots[shots.length - 1].label : 'On the tee.';
}

function renderGrid() {
  const grid = $('grid');
  const rows = holeState().rows;
  grid.innerHTML = '';

  // The board opens at par and grows a row at a time. Six empty rows used to
  // say "six tries"; with no limit that means nothing, while par is the number
  // actually worth looking at — so the grid shows the target and the rows you
  // spend beyond it.
  const par = holeSpec().par;
  const rowCount = Math.min(HARD_LIMIT, Math.max(par, rows.length + 1));
  grid.style.gridTemplateRows = `repeat(${rowCount}, 1fr)`;
  grid.classList.toggle('grid-tall', rowCount > 6);
  grid.classList.toggle('grid-taller', rowCount > 8);

  for (let r = 0; r < rowCount; r++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'grid-row';
    if (r >= par) rowEl.classList.add('over-par');
    rowEl.dataset.row = String(r);

    const row = rows[r];
    const typing = r === rows.length ? state.current : '';
    for (let c = 0; c < 5; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      if (row) {
        tile.textContent = row.guess[c];
        tile.classList.add(row.marks[c]);
      } else if (typing[c]) {
        tile.textContent = typing[c];
        tile.classList.add('filled');
      }
      rowEl.appendChild(tile);
    }
    grid.appendChild(rowEl);
  }
  // Keep the row you are typing into in view once the board starts scrolling.
  if (rowCount > 6) grid.scrollTop = grid.scrollHeight;
}

const KB_ROWS = ['qwertyuiop', 'asdfghjkl', '↵zxcvbnm⌫'];

function renderKeyboard() {
  const kb = $('keyboard');
  const marks = {};
  const rank = { absent: 0, present: 1, correct: 2 };
  for (const row of holeState().rows) {
    row.marks.forEach((mark, i) => {
      const letter = row.guess[i];
      // A letter keeps its best-known state: green beats yellow beats grey.
      if (!marks[letter] || rank[mark] > rank[marks[letter]]) marks[letter] = mark;
    });
  }

  kb.innerHTML = '';
  for (const rowText of KB_ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    for (const ch of rowText) {
      const key = document.createElement('button');
      key.className = 'key';
      if (ch === '↵') { key.classList.add('wide'); key.textContent = 'Enter'; key.dataset.key = 'enter'; }
      else if (ch === '⌫') { key.classList.add('wide'); key.textContent = '⌫'; key.dataset.key = 'back'; }
      else {
        key.textContent = ch;
        key.dataset.key = ch;
        if (marks[ch]) key.classList.add(marks[ch]);
      }
      rowEl.appendChild(key);
    }
    kb.appendChild(rowEl);
  }
}

function renderScorecard() {
  const card = $('scorecard');
  card.innerHTML = '';
  state.course.holes.forEach((hole, i) => {
    const st = state.round.holes[i];
    const el = document.createElement('div');
    el.className = 'sc-hole';
    if (i === state.round.currentHole) el.classList.add('current');

    let score = '–';
    if (st.status !== 'playing') {
      const strokes = strokesFor(st);
      score = String(strokes);
      if (strokes < hole.par) el.classList.add('under');
      if (strokes > hole.par) el.classList.add('over');
    }
    el.innerHTML = `${hole.number}<span class="sc-score">${score}</span><span class="sc-par">par ${hole.par}</span>`;
    card.appendChild(el);
  });
}

// Tell the scene how much of the screen it actually gets to use, so it can
// frame the hole above the game panel rather than behind it.
function layoutScene() {
  const readout = document.querySelector('.readout');
  const panel = document.querySelector('.play-panel');
  const edge = readout || panel;
  if (!scene || !edge) return;
  scene.layout(edge.getBoundingClientRect().top);
  scene.draw();
}

function renderAll() {
  renderHeader();
  renderHole();
  renderGrid();
  renderKeyboard();
  renderScorecard();
  requestAnimationFrame(layoutScene);
}

// -------------------------------------------------------------- game flow

function typeLetter(letter) {
  if (state.current.length >= 5) return;
  state.current += letter;
  renderGrid();
}

function backspace() {
  state.current = state.current.slice(0, -1);
  renderGrid();
}

function shakeRow() {
  const rowEl = document.querySelector(`.grid-row[data-row="${holeState().rows.length}"]`);
  if (!rowEl) return;
  rowEl.classList.add('shake');
  setTimeout(() => rowEl.classList.remove('shake'), 420);
}

function submitGuess() {
  // Pressing enter while the shot is still in the air used to be swallowed.
  // Hold the submission and play it the moment the ball comes to rest.
  if (state.locked) {
    if (state.current.length === 5) state.pendingSubmit = true;
    return;
  }
  const guess = state.current.toLowerCase();
  const hole = holeSpec();
  const st = holeState();

  if (guess.length < 5) { flash('Need five letters'); shakeRow(); return; }
  if (!isValidGuess(guess)) { flash('Not in the word list'); shakeRow(); return; }

  const marks = scoreGuess(guess, hole.word);
  st.rows.push({ guess, marks });
  state.current = '';

  const solved = guess === hole.word;
  // Only the backstop ends a hole now, and even then the score is your guesses.
  const out = !solved && st.rows.length >= HARD_LIMIT;
  const shot = shotFor({ hole, rows: st.rows, index: st.rows.length - 1, solved });
  st.shots.push(shot);

  renderGrid();
  renderKeyboard();
  requestAnimationFrame(layoutScene);

  state.locked = true;
  $('shot-label').textContent = shot.label;
  minimap.playShot(st.shots);
  // The perspective camera runs longest, so it owns the "shot finished" moment.
  scene.playShot(st.shots, () => {
    state.locked = false;
    if (solved || out) {
      st.status = solved ? 'won' : 'lost';
      state.pendingSubmit = false;
      store.saveRound(state.round);
      setTimeout(() => finishHole(), 420);
    } else {
      store.saveRound(state.round);
      if (state.pendingSubmit) {
        state.pendingSubmit = false;
        submitGuess();
      }
    }
  });
}

function finishHole() {
  const hole = holeSpec();
  const st = holeState();
  const strokes = strokesFor(st);
  const solved = st.status === 'won';
  const reaction = celebrate(strokes, hole.par, solved);

  // The hole just closed out, so the strip and the running total are stale.
  renderScorecard();
  $('round-total').textContent = toParLabel(roundTotals(state.round, state.course).toPar);

  if (!solved || strokes > hole.par) document.body.classList.add('mourn');
  setTimeout(() => document.body.classList.remove('mourn'), 950);

  $('result-score').textContent = solved ? scoreName(strokes, hole.par) : 'Picked up';
  $('result-word').textContent = hole.word;
  $('result-line').textContent = solved
    ? `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} on a par ${hole.par}. ${reaction.sub}`
    : `That is enough. ${strokes} strokes and on to the next.`;

  const totals = roundTotals(state.round, state.course);
  const last = state.round.currentHole === state.round.holes.length - 1;
  $('result-card').innerHTML = `Through ${totals.played}: <strong>${totals.strokes}</strong> (${toParLabel(totals.toPar)})`;
  $('btn-next').textContent = last ? 'See your card →' : 'Next tee →';

  // Let the banner have the stage before the dialog slides in.
  setTimeout(() => openModal('modal-hole'), 1500);
}

function nextHole() {
  closeModal();
  const last = state.round.currentHole >= state.round.holes.length - 1;
  if (last) { finishRound(); return; }
  state.round.currentHole += 1;
  state.current = '';
  state.pendingSubmit = false;
  store.saveRound(state.round);
  renderAll();
}

function finishRound() {
  const totals = roundTotals(state.round, state.course);
  const holeStrokes = state.round.holes.map((st) => (st.status === 'playing' ? null : strokesFor(st)));
  const player = state.round.player || 'You';

  store.submitScore(state.course.code, {
    player, strokes: totals.strokes, toPar: totals.toPar, holeStrokes, at: Date.now(),
  });
  store.clearRound(state.course.code);

  const url = new URL(window.location.href);
  url.search = `?course=${state.course.code}`;
  const card = store.buildShareCard({
    course: state.course, player, strokes: totals.strokes, toPar: totals.toPar,
    holeStrokes, url: url.toString(),
  });

  $('round-title').textContent = totals.toPar <= 0 ? 'Round of your life' : 'Round complete';
  $('round-summary').innerHTML = `
    <div class="big">${totals.strokes} <small>(${toParLabel(totals.toPar)})</small></div>
    <div>${state.course.name} · par ${state.course.par}</div>
    <div>${holeStrokes.map((s, i) => scoreEmoji(s, state.course.holes[i].par)).join('')}</div>`;
  $('share-card').textContent = card;
  celebrateRound(totals.toPar);
  openModal('modal-round');
}

// ----------------------------------------------------------- start & join

function startRound(course, playerName) {
  state.course = course;
  store.setPlayerName(playerName);

  const saved = store.loadRound(course.code);
  // Resume an unfinished round on this course rather than wiping it.
  state.round = saved && saved.holes && saved.holes.length === course.holes.length
    ? saved
    : newRound(course, playerName);
  state.round.player = playerName;

  // If the saved round's current hole is already done, walk forward.
  while (state.round.currentHole < state.round.holes.length - 1
    && state.round.holes[state.round.currentHole].status !== 'playing') {
    state.round.currentHole += 1;
  }

  state.current = '';
  $('game').hidden = false;
  closeModal();
  if (!scene) scene = new PerspectiveView($('scene'));
  if (!minimap) minimap = new HoleView($('minimap'), { compact: true });
  scene.resize();
  minimap.resize();
  renderAll();
  window.addEventListener('resize', () => requestAnimationFrame(layoutScene));

  const url = new URL(window.location.href);
  url.search = `?course=${course.code}`;
  window.history.replaceState({}, '', url);
}

function showPreview(course) {
  state.previewCourse = course;
  $('preview-name').textContent = course.name;
  $('preview-code').textContent = course.code;
  $('preview-par').textContent = course.par;
  $('preview-yards').textContent = course.yards.toLocaleString();
}

function openStart(code) {
  $('input-name').value = store.getPlayerName();
  showPreview(buildCourse(code || randomCourseCode()));
  openModal('modal-start');
}

// ----------------------------------------------------------- leaderboard

function renderBoard() {
  const list = $('board-list');
  const entries = store.getLeaderboard(state.course.code);
  $('board-course').textContent = `${state.course.name} · ${state.course.code} · par ${state.course.par}`;
  list.innerHTML = '';

  if (!entries.length) {
    list.innerHTML = '<p class="board-empty">No cards in yet. Finish a round, or paste a friend\'s share card below.</p>';
    return;
  }
  for (const entry of entries) {
    const marks = entry.holeStrokes
      .map((s, i) => (s == null ? '▫️' : scoreEmoji(s, state.course.holes[i].par)))
      .join('');
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="bl-row">
        <span class="bl-name">${escapeHtml(entry.player)}</span>
        <span class="bl-score">${entry.strokes} (${toParLabel(entry.toPar)})</span>
      </div>
      <div class="bl-marks">${marks}</div>`;
    list.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function importCard() {
  const text = $('input-import').value;
  const msg = $('import-msg');
  const parsed = store.parseShareCard(text, state.course);

  if (!parsed) { msg.textContent = 'That does not look like a Wordle Golf card.'; return; }
  if (parsed.error) { msg.textContent = parsed.error; return; }

  store.submitScore(state.course.code, parsed);
  $('input-import').value = '';
  msg.textContent = `Added ${parsed.player} — ${parsed.strokes} (${toParLabel(parsed.toPar)}).`;
  renderBoard();
}

// ---------------------------------------------------------------- events

function onKeyDown(event) {
  if (!$('modal-root').hidden || !state.round) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key;
  if (key === 'Enter') { event.preventDefault(); submitGuess(); }
  else if (key === 'Backspace') { event.preventDefault(); backspace(); }
  else if (/^[a-zA-Z]$/.test(key)) { event.preventDefault(); typeLetter(key.toLowerCase()); }
}

function wire() {
  $('keyboard').addEventListener('click', (event) => {
    const key = event.target.closest('.key');
    if (!key) return;
    if (key.dataset.key === 'enter') submitGuess();
    else if (key.dataset.key === 'back') backspace();
    else typeLetter(key.dataset.key);
  });

  document.addEventListener('keydown', onKeyDown);

  $('btn-play').addEventListener('click', () => {
    const name = ($('input-name').value || '').trim() || 'You';
    startRound(state.previewCourse, name);
  });

  $('btn-reroll').addEventListener('click', () => showPreview(buildCourse(randomCourseCode())));

  $('btn-join').addEventListener('click', () => {
    const code = normalizeCode($('input-code').value);
    if (code.length < 3) { $('input-code').focus(); return; }
    showPreview(buildCourse(code));
  });

  $('btn-next').addEventListener('click', nextHole);
  $('btn-again').addEventListener('click', () => { closeModal(); openStart(); });
  $('btn-menu').addEventListener('click', () => openStart());
  $('btn-help').addEventListener('click', () => openModal('modal-help'));

  $('toggle-notes').addEventListener('change', (event) => {
    const on = event.target.checked;
    store.setSetting('caddieNotes', on);
    applyNotesSetting(on);
    // The scene is framed against the readout, which just changed height.
    requestAnimationFrame(layoutScene);
  });

  $('btn-board').addEventListener('click', () => {
    if (!state.course) return;
    renderBoard();
    $('import-msg').textContent = '';
    openModal('modal-board');
  });

  $('btn-import').addEventListener('click', importCard);

  $('btn-copy').addEventListener('click', async () => {
    const text = $('share-card').textContent;
    const done = await copyText(text);
    $('btn-copy').textContent = done ? 'Copied ✓' : 'Copy failed — select it';
    setTimeout(() => { $('btn-copy').textContent = 'Copy share card'; }, 1800);
  });

  $('course-code').addEventListener('click', async () => {
    if (!state.course) return;
    const url = new URL(window.location.href);
    url.search = `?course=${state.course.code}`;
    const done = await copyText(url.toString());
    flash(done ? 'Course link copied' : state.course.code);
  });

  // An explicit close, because the backdrop is a thin strip behind a tall sheet.
  for (const button of document.querySelectorAll('[data-dismiss]')) {
    button.addEventListener('click', closeModal);
  }

  // Backdrop closes anything except the dialogs that need a decision.
  $('modal-root').addEventListener('click', (event) => {
    if (!event.target.dataset.close) return;
    const open = [...document.querySelectorAll('.modal')].find((m) => !m.hidden);
    if (!open) { closeModal(); return; }
    if (open.id === 'modal-hole') return;                  // you have to walk to the next tee
    if (open.id === 'modal-start' && !state.round) return; // nothing to go back to yet
    closeModal();
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Clipboard API needs a secure context; fall back to the old trick.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (err2) {
      return false;
    }
  }
}

function boot() {
  wire();
  applyNotesSetting(store.getSetting('caddieNotes', true));
  const params = new URLSearchParams(window.location.search);
  const code = normalizeCode(params.get('course') || '');
  openStart(code || null);
  if (code) $('input-code').value = code;
}

boot();
