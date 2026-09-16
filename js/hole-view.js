// Overhead hole renderer — the little Mario Golf style map. Tee at the bottom,
// green at the top, your shots plotted up the fairway as you guess.

import { makeRng, centerX, fairwayHalfWidth, FIELD_YARDS } from './course.js';

const COLORS = {
  rough: '#2f6d3a',
  roughDark: '#275c31',
  fairway: '#4c9e50',
  fairwayLight: '#5cb160',
  green: '#7fd37f',
  greenRim: '#6bc26b',
  sand: '#e3cf9a',
  water: '#3d7fd1',
  tree: '#1d4a26',
  treeTop: '#276033',
  ball: '#ffffff',
  trail: 'rgba(255,255,255,0.75)',
};

export class HoleView {
  constructor(canvas, { compact = false } = {}) {
    this.canvas = canvas;
    // As a small inset there is no room for scenery detail; the point is
    // simply where the ball sits relative to the fairway.
    this.compact = compact;
    this.ctx = canvas.getContext('2d');
    this.hole = null;
    this.shots = [];
    this.animation = null;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(40, rect.width || this.canvas.clientWidth || 320);
    const height = Math.max(50, rect.height || this.canvas.clientHeight || 420);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.w = width;
    this.h = height;
  }

  setHole(hole, shots = []) {
    this.hole = hole;
    this.shots = shots;
    this.draw();
  }

  // Animate the newest shot flying from the previous ball position.
  playShot(shots, onDone) {
    this.shots = shots;
    const to = shots[shots.length - 1];
    const from = shots.length > 1 ? shots[shots.length - 2] : null;
    const start = performance.now();
    const duration = 620;

    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      // Ease out so the ball decelerates as it lands.
      const eased = 1 - Math.pow(1 - p, 2.2);
      this.draw({ flight: { from, to, p: eased } });
      if (p < 1) this.animation = requestAnimationFrame(step);
      else {
        this.animation = null;
        this.draw();
        if (onDone) onDone();
      }
    };
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- drawing

  // Logical (0..1, 0..1) space -> canvas pixels. t=0 is the tee (bottom).
  point(x, t) {
    const pad = 0.08;
    const usable = 1 - pad * 2;
    return {
      x: x * this.w,
      y: this.h - (pad + t * usable) * this.h,
    };
  }

  draw({ flight = null } = {}) {
    if (!this.hole) return;
    const { ctx, w, h } = this;
    const f = this.hole.features;
    const rng = makeRng(f.treeSeed);

    ctx.clearRect(0, 0, w, h);
    this.drawRough(rng);
    if (f.water) this.drawWater(rng);
    this.drawFairway();
    this.drawBunkers(rng);
    this.drawGreen();
    if (!this.compact) this.drawTrees(rng);
    this.drawTee();
    this.drawShots(flight);
    this.drawFlag();
  }

  drawRough(rng) {
    const { ctx, w, h } = this;
    ctx.fillStyle = COLORS.rough;
    ctx.fillRect(0, 0, w, h);
    // Mown stripes, the reason golf courses photograph well.
    ctx.fillStyle = COLORS.roughDark;
    for (let y = 0; y < h; y += 26) {
      if ((Math.floor(y / 26) % 2) === 0) ctx.fillRect(0, y, w, 13);
    }
  }

  // The real, scored edge — shared with the shot model, so a ball drawn on
  // the short grass is always scored as being on the short grass.
  fairwayEdge(t, side) {
    return centerX(t, this.hole.features.dogleg) + side * fairwayHalfWidth(this.hole, t);
  }

  // A wobble layered on top of the real edge, purely so the fairway reads as
  // mown ground and not a ruler-straight lane — like the bunker and tree
  // scatter, it is cosmetic and never touches the width shots are scored
  // against. Fades to nothing at the tee and the green so both stay clean.
  edgeWobble(seedSalt) {
    const rng = makeRng(this.hole.features.treeSeed ^ seedSalt);
    const a1 = 0.018 + rng() * 0.024;
    const a2 = 0.008 + rng() * 0.016;
    const p1 = rng() * Math.PI * 2;
    const p2 = rng() * Math.PI * 2;
    return (t) => {
      const envelope = Math.sin(Math.PI * Math.min(1, t));
      return (Math.sin(t * 5.3 + p1) * a1 + Math.sin(t * 11.4 + p2) * a2) * envelope;
    };
  }

  drawFairway() {
    const { ctx } = this;
    const wobbleLeft = this.edgeWobble(0x2c1f);
    const wobbleRight = this.edgeWobble(0x7ae3);
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const p = this.point(this.fairwayEdge(t, -1) + wobbleLeft(t), t);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = 40; i >= 0; i--) {
      const t = i / 40;
      const p = this.point(this.fairwayEdge(t, 1) + wobbleRight(t), t);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = COLORS.fairway;
    ctx.fill();

    // Lighter mowing stripes running up the fairway.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = COLORS.fairwayLight;
    for (let i = 0; i < 18; i++) {
      const t = i / 18;
      const a = this.point(0, t);
      const b = this.point(1, t + 1 / 36);
      if (i % 2 === 0) ctx.fillRect(0, b.y, this.w, a.y - b.y);
    }
    ctx.restore();
  }

  drawGreen() {
    const { ctx } = this;
    const f = this.hole.features;
    const c = this.point(centerX(1, f.dogleg), 1);
    // Across: the green's real width against the width of the drawn world.
    // Up the page: its real depth against the length of the hole.
    const rx = (f.greenRadius / FIELD_YARDS) * this.w * 1.15;
    const ry = Math.max(5, (f.greenRadius / this.hole.yards) * this.h * 0.9);

    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx + 4, ry + 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.greenRim;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.green;
    ctx.fill();
  }

  drawBunkers(rng) {
    const { ctx } = this;
    const f = this.hole.features;
    ctx.fillStyle = COLORS.sand;
    for (let i = 0; i < f.bunkers; i++) {
      // Bunkers cluster where a real architect puts them: the landing zone
      // and either side of the green.
      const t = i === 0 ? 0.93 : 0.45 + rng() * 0.45;
      const side = rng() < 0.5 ? -1 : 1;
      const offset = (f.fairwayWidth + 0.03 + rng() * 0.05) * side;
      const p = this.point(centerX(t, f.dogleg) + offset, t);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 9 + rng() * 10, 6 + rng() * 6, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawWater(rng) {
    const { ctx } = this;
    const f = this.hole.features;
    const side = rng() < 0.5 ? -1 : 1;
    ctx.fillStyle = COLORS.water;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const t = 0.5 + (i / 20) * 0.42;
      const x = centerX(t, f.dogleg) + side * (f.fairwayWidth + 0.06);
      const p = this.point(x, t);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = 20; i >= 0; i--) {
      const t = 0.5 + (i / 20) * 0.42;
      const x = centerX(t, f.dogleg) + side * (f.fairwayWidth + 0.2);
      const p = this.point(x, t);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  }

  drawTrees(rng) {
    const { ctx } = this;
    const f = this.hole.features;
    for (let i = 0; i < 46; i++) {
      const t = rng();
      const side = rng() < 0.5 ? -1 : 1;
      const offset = (f.fairwayWidth + 0.06 + rng() * 0.3) * side;
      const x = centerX(t, f.dogleg) + offset;
      if (x < 0.02 || x > 0.98) continue;
      const p = this.point(x, t);
      const r = 5 + rng() * 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y + 2, r, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.tree;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x - 1, p.y - 1, r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.treeTop;
      ctx.fill();
    }
  }

  // A raised deck, not just a patch of the fairway it sits on — a shadow to
  // lift it off the ground, a rounded platform, and markers for tee it up.
  drawTee() {
    const { ctx } = this;
    const p = this.point(centerX(0, this.hole.features.dogleg), 0);
    const hw = 15;
    const hh = 9;
    const r = 4;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.roundRect(p.x - hw, p.y - hh, hw * 2, hh * 2, r);
    ctx.fillStyle = '#e2edd2';
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(p.x - hw, p.y - hh, hw * 2, hh * 2, r);
    ctx.stroke();

    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(p.x + side * (hw - 3), p.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#e8503a';
      ctx.fill();
    }
  }

  drawFlag() {
    const { ctx } = this;
    const p = this.point(centerX(1, this.hole.features.dogleg), 1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#1b3f22';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - 26);
    ctx.strokeStyle = '#f5f5f5';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 26);
    ctx.lineTo(p.x + 15, p.y - 21);
    ctx.lineTo(p.x, p.y - 16);
    ctx.closePath();
    ctx.fillStyle = '#ef4136';
    ctx.fill();
  }

  ballPoint(shot) {
    const f = this.hole.features;
    const t = Math.min(1, shot.progress);
    // No extra squeeze here: shotFor already tightens the spread as the ball
    // nears the pin, and doubling it up would draw balls off their real lie.
    return this.point(centerX(t, f.dogleg) + shot.lateral, t);
  }

  drawShots(flight) {
    const { ctx } = this;
    const shots = this.shots;
    if (!shots.length) return;

    const teePoint = this.point(centerX(0, this.hole.features.dogleg), 0);
    const points = shots.map((s) => this.ballPoint(s));
    const visibleCount = flight ? points.length - 1 : points.length;

    // Dotted trail from the tee through every landed shot.
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = COLORS.trail;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(teePoint.x, teePoint.y);
    for (let i = 0; i < visibleCount; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < visibleCount; i++) this.drawBall(points[i], i === visibleCount - 1);

    if (flight) {
      const from = flight.from ? this.ballPoint(flight.from) : teePoint;
      const to = points[points.length - 1];
      const x = from.x + (to.x - from.x) * flight.p;
      const y = from.y + (to.y - from.y) * flight.p;
      // Arc the ball above the ground so it reads as a shot, not a roll.
      const lift = Math.sin(Math.PI * flight.p) * Math.min(46, Math.hypot(to.x - from.x, to.y - from.y) * 0.32);

      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();

      this.drawBall({ x, y: y - lift }, true);
    }
  }

  drawBall(p, highlight) {
    const { ctx } = this;
    if (highlight) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ball;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
