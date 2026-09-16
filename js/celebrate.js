// End-of-hole theatre: confetti for birdies, a small rain cloud for bogeys.

const CONFETTI_COLORS = ['#ffd24a', '#7fd37f', '#4aa3ff', '#ff7a7a', '#ffffff', '#c98bff'];

function overlayCanvas() {
  let canvas = document.getElementById('fx-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'fx-canvas';
    document.body.appendChild(canvas);
  }
  const ratio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { canvas, ctx };
}

function confetti(intensity) {
  const { canvas, ctx } = overlayCanvas();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pieces = [];
  const count = Math.round(70 * intensity);

  for (let i = 0; i < count; i++) {
    pieces.push({
      x: w * (0.15 + Math.random() * 0.7),
      y: h * 0.35 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 9,
      size: 5 + Math.random() * 7,
      spin: (Math.random() - 0.5) * 0.35,
      angle: Math.random() * Math.PI,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    });
  }

  const start = performance.now();
  const tick = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    for (const p of pieces) {
      p.vy += 0.32; // gravity
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.995;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 2600);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (elapsed < 2600) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, w, h);
  };
  requestAnimationFrame(tick);
  return canvas;
}

function rain() {
  const { ctx } = overlayCanvas();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const drops = Array.from({ length: 90 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h - h,
    len: 10 + Math.random() * 16,
    speed: 7 + Math.random() * 7,
  }));

  const start = performance.now();
  const tick = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(180,205,230,0.55)';
    ctx.lineWidth = 1.4;
    for (const d of drops) {
      d.y += d.speed;
      if (d.y > h) d.y = -d.len;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 2, d.y + d.len);
      ctx.stroke();
    }
    if (elapsed < 2200) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, w, h);
  };
  requestAnimationFrame(tick);
}

const REACTIONS = {
  ace: { text: 'HOLE IN ONE', sub: 'Frame it. Put it on the wall.', mood: 'great' },
  albatross: { text: 'ALBATROSS', sub: 'That is once-in-a-lifetime stuff.', mood: 'great' },
  eagle: { text: 'EAGLE', sub: 'Absolutely striped it.', mood: 'great' },
  birdie: { text: 'BIRDIE', sub: 'Take that and run to the next tee.', mood: 'good' },
  par: { text: 'PAR', sub: 'Steady. Reliable. A stick in the mud.', mood: 'even' },
  bogey: { text: 'BOGEY', sub: 'Shake it off. Long way to go.', mood: 'bad' },
  double: { text: 'DOUBLE BOGEY', sub: 'That one stings.', mood: 'bad' },
  triple: { text: 'TRIPLE BOGEY', sub: 'Snap the club. Gently.', mood: 'bad' },
  blowup: { text: 'LOST BALL', sub: 'Pick it up. We never speak of this hole again.', mood: 'awful' },
};

export function reactionKey(strokes, par, solved) {
  if (!solved) return 'blowup';
  if (strokes === 1) return 'ace';
  const diff = strokes - par;
  if (diff <= -3) return 'albatross';
  if (diff === -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  if (diff === 2) return 'double';
  if (diff === 3) return 'triple';
  return 'blowup';
}

// Fires the banner + particles. Returns the reaction so callers can reuse the
// copy in the scorecard.
export function celebrate(strokes, par, solved) {
  const key = reactionKey(strokes, par, solved);
  const reaction = REACTIONS[key];

  const banner = document.createElement('div');
  banner.className = `fx-banner fx-${reaction.mood}`;
  banner.innerHTML = `<strong>${reaction.text}</strong><span>${reaction.sub}</span>`;
  document.body.appendChild(banner);

  if (reaction.mood === 'great') confetti(1.4);
  else if (reaction.mood === 'good') confetti(0.9);
  else if (reaction.mood === 'bad' || reaction.mood === 'awful') rain();

  setTimeout(() => {
    banner.classList.add('fx-out');
    setTimeout(() => banner.remove(), 500);
  }, 1900);

  return reaction;
}

export function celebrateRound(toPar) {
  if (toPar <= 0) confetti(1.6);
}
