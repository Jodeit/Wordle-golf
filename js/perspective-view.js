// The view from behind the ball, looking down the hole at the pin.
//
// A real pinhole projection rather than a faked gradient: world coordinates are
// yards (x across, y up, z down the hole from the tee), the camera stands at the
// ball at eye height and yaws to keep the pin centred. Everything else follows
// from that, which is why walking up the fairway reads correctly — the green
// grows, the flag rises, the fairway edges spread past you.

import { makeRng, centerX, fairwayHalfWidth } from './course.js';

// How many yards across the drawn world is. The shot model works in fractions
// of the hole's width, so this converts between the two.
// Real fairways run 30-45 yards across. Wider than that and the foreground
// becomes a featureless wash of green.
const FIELD_YARDS = 90;
// An elevated camera set back behind the player, the view golf coverage and
// Mario Golf both use. High enough to read the whole hole at once, which a
// ground-level camera cannot do: from down there the fairway rushes past and
// everything worth seeing compresses into a sliver under the horizon.
const EYE_HEIGHT = 17;
// How far back the camera sits is derived per layout, not fixed: the game panel
// leaves a band of very different heights on a tall phone versus a desktop, and
// a fixed distance overflows it and buries the ball behind the glass.
const CAM_BACK_MIN = 16;
const CAM_BACK_MAX = 75;
const FLAG_HEIGHT = 2.4;
const NEAR_PLANE = 1.2;

// Sky and light through the round: hole 1 at dawn, midday at the turn, the
// ninth played into a low sun. Keyframed, then interpolated per hole.
const TIME_KEYS = [
  { at: 1, skyTop: '#27548a', skyHaze: '#f0a878', sun: '#ffe2b4', sunHeight: 0.09,
    grass: '#4c8f52', grassLit: '#5da360', rough: '#2f5c37', tree: '#2c5539', hazeMix: 0.3 },
  { at: 4, skyTop: '#2f7fc4', skyHaze: '#bfe0f0', sun: '#fffdf2', sunHeight: 0.5,
    grass: '#4f9e55', grassLit: '#63b869', rough: '#2f6036', tree: '#2a5731', hazeMix: 0.18 },
  { at: 7, skyTop: '#3a86c9', skyHaze: '#f0d9b0', sun: '#fff0c8', sunHeight: 0.28,
    grass: '#54a257', grassLit: '#6dbd68', rough: '#316437', tree: '#2d5a35', hazeMix: 0.22 },
  { at: 9, skyTop: '#2b3d73', skyHaze: '#f5a862', sun: '#ffd79a', sunHeight: 0.1,
    grass: '#498853', grassLit: '#5a9d5e', rough: '#2c5734', hazeMix: 0.28, tree: '#284d31' },
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const m = (x, y) => Math.round(x + (y - x) * t);
  const hex = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  // Hex in, hex out: results get re-blended (palette, then distance haze), so
  // returning rgb() here would make the next hexToRgb parse produce NaN.
  return `#${hex(m(r1, r2))}${hex(m(g1, g2))}${hex(m(b1, b2))}`;
}

function rgbaFromHex(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function paletteFor(holeNumber) {
  let lo = TIME_KEYS[0];
  let hi = TIME_KEYS[TIME_KEYS.length - 1];
  for (let i = 0; i < TIME_KEYS.length - 1; i++) {
    if (holeNumber >= TIME_KEYS[i].at && holeNumber <= TIME_KEYS[i + 1].at) {
      lo = TIME_KEYS[i];
      hi = TIME_KEYS[i + 1];
      break;
    }
  }
  const span = hi.at - lo.at;
  const t = span ? (holeNumber - lo.at) / span : 0;
  const out = {};
  for (const key of Object.keys(lo)) {
    out[key] = typeof lo[key] === 'number'
      ? lo[key] + (hi[key] - lo[key]) * t
      : mixHex(lo[key], hi[key], t);
  }
  return out;
}

export class PerspectiveView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hole = null;
    this.shots = [];
    this.animation = null;
    this.camera = { z: 0, x: 0 };
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.w = width;
    this.h = height;
    // A ~62 degree field of view: wide enough to show the flanking trees
    // without the barrel-distorted look a wider lens gives.
    this.focal = width * 1.05;
    this.camBack = this.camBack || 24;
    this.layout();
  }

  // The game panel covers the bottom of the screen, so only a band of the page
  // actually shows the course. Compose for that band: place the horizon so the
  // ball lands near its foot and the fairway, green and flag fill the rest.
  // Without this the whole hole hides behind the glass.
  layout(visibleBottom) {
    if (typeof visibleBottom === 'number' && visibleBottom > 80) {
      this.visibleBottom = visibleBottom;
    } else if (!this.visibleBottom) {
      this.visibleBottom = this.h * 0.5;
    }
    const band = this.visibleBottom;
    const ballY = band * 0.84;
    // Put the horizon near the top of the band and the ball near its foot, then
    // solve for the camera distance that produces exactly that drop.
    const drop = Math.max(40, ballY - band * 0.26);
    this.camBack = Math.max(CAM_BACK_MIN,
      Math.min(CAM_BACK_MAX, (this.focal * EYE_HEIGHT) / drop));
    this.horizon = ballY - (this.focal * EYE_HEIGHT) / this.camBack;
    if (this.hole) {
      this.camera = this.cameraFor(this.shots.length ? this.shots[this.shots.length - 1] : null);
    }
  }

  setHole(hole, shots = []) {
    this.hole = hole;
    this.shots = shots;
    this.palette = paletteFor(hole.number);
    this.scenery = this.buildScenery(hole);
    this.camera = this.cameraFor(shots.length ? shots[shots.length - 1] : null);
    this.draw();
  }

  // ------------------------------------------------------------ world model

  // Centre line of the hole at distance z, in yards off the middle.
  centerAt(z) {
    const t = Math.max(0, Math.min(1, z / this.hole.yards));
    return (centerX(t, this.hole.features.dogleg) - 0.5) * FIELD_YARDS;
  }

  halfWidthAt(z) {
    const t = Math.max(0, Math.min(1, z / this.hole.yards));
    return fairwayHalfWidth(this.hole, t) * FIELD_YARDS;
  }

  // Where the ball lies. The camera stands CAM_BACK yards behind it.
  ballFor(shot) {
    if (!shot) return { z: 0, x: this.centerAt(0) };
    const z = this.hole.yards * Math.min(1, shot.progress);
    return { z, x: this.centerAt(z) + shot.lateral * FIELD_YARDS };
  }

  cameraFor(shot) {
    const ball = this.ballFor(shot);
    return { z: ball.z - this.camBack, x: ball.x, ballZ: ball.z, ballX: ball.x };
  }

  // Trees, bunkers and the green, fixed per hole so the view is stable.
  buildScenery(hole) {
    const rng = makeRng(hole.features.treeSeed);
    const trees = [];
    for (let i = 0; i < 120; i++) {
      const z = rng() * (hole.yards + 120) - 40;
      const side = rng() < 0.5 ? -1 : 1;
      const off = this.halfWidthAt(Math.max(0, z)) + 8 + rng() * 55;
      trees.push({
        x: this.centerAt(Math.max(0, z)) + side * off,
        z,
        height: 7 + rng() * 9,
        width: 3 + rng() * 3.5,
        shade: 0.75 + rng() * 0.5,
      });
    }

    const bunkers = [];
    for (let i = 0; i < hole.features.bunkers; i++) {
      const t = i === 0 ? 0.94 : 0.45 + rng() * 0.42;
      const z = hole.yards * t;
      const side = rng() < 0.5 ? -1 : 1;
      bunkers.push({
        x: this.centerAt(z) + side * (this.halfWidthAt(z) + 2 + rng() * 9),
        z,
        rx: 6 + rng() * 9,
        rz: 4 + rng() * 6,
      });
    }

    let water = null;
    if (hole.features.water) {
      const side = rng() < 0.5 ? -1 : 1;
      const z = hole.yards * (0.55 + rng() * 0.25);
      water = { z, side, length: hole.yards * 0.3 };
    }

    return {
      trees: trees.sort((a, b) => b.z - a.z), // painter's algorithm: far first
      bunkers,
      water,
      greenRadius: hole.features.greenSize * FIELD_YARDS * 1.25,
    };
  }

  // ------------------------------------------------------------- projection

  project(wx, wy, wz) {
    const pinZ = this.hole.yards;
    const dxPin = this.centerAt(pinZ) - this.camera.x;
    const dzPin = Math.max(1, pinZ - this.camera.z);
    const yaw = Math.atan2(dxPin, dzPin);

    const dx = wx - this.camera.x;
    const dz = wz - this.camera.z;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // Rotate so the pin direction becomes straight ahead (+z).
    const ez = dx * sin + dz * cos;
    const ex = dx * cos - dz * sin;
    if (ez < NEAR_PLANE) return null;

    return {
      x: this.w / 2 + (this.focal * ex) / ez,
      y: this.horizon + (this.focal * (EYE_HEIGHT - wy)) / ez,
      scale: this.focal / ez,
      depth: ez,
    };
  }

  // Distant things wash out toward the horizon colour.
  haze(depth) {
    const p = this.palette;
    const start = 90;   // yards before anything starts to soften
    if (depth <= start) return 0;
    const t = (depth - start) / (this.hole.yards + 150);
    return Math.min(p.hazeMix, t * p.hazeMix * 1.6);
  }

  // ---------------------------------------------------------------- drawing

  playShot(shots, onDone) {
    this.shots = shots;
    const to = shots[shots.length - 1];
    const from = shots.length > 1 ? shots[shots.length - 2] : null;
    const startCam = this.cameraFor(from);
    const endCam = this.cameraFor(to);
    const start = performance.now();
    const duration = 900;

    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      // Ball flight finishes first, then the camera settles at the new lie.
      const flight = Math.min(1, p / 0.62);
      const travel = p < 0.62 ? 0 : (p - 0.62) / 0.38;
      const eased = 1 - Math.pow(1 - travel, 2.4);

      this.camera = {
        z: startCam.z + (endCam.z - startCam.z) * eased,
        x: startCam.x + (endCam.x - startCam.x) * eased,
        ballZ: startCam.ballZ + (endCam.ballZ - startCam.ballZ) * eased,
        ballX: startCam.ballX + (endCam.ballX - startCam.ballX) * eased,
      };
      this.draw({ flight: { from: startCam, to: endCam, p: flight } });

      if (p < 1) this.animation = requestAnimationFrame(step);
      else {
        this.animation = null;
        this.camera = endCam;
        this.draw();
        if (onDone) onDone();
      }
    };
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = requestAnimationFrame(step);
  }

  draw({ flight = null } = {}) {
    if (!this.hole) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawSky();
    this.drawGround();
    this.drawFairway();
    this.drawTeeBox();
    if (this.scenery.water) this.drawWater();
    for (const bunker of this.scenery.bunkers) this.drawBunker(bunker);
    this.drawGreen();
    this.drawTrees();
    this.drawFlag();
    this.drawBall(flight);
    this.drawVignette();
  }

  drawVignette() {
    const { ctx, w, h } = this;
    const grad = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.22, w / 2, h * 0.45, h * 0.78);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.26)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  drawSky() {
    const { ctx, w, h } = this;
    const p = this.palette;
    const sky = ctx.createLinearGradient(0, 0, 0, this.horizon);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.skyHaze);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, this.horizon + 1);

    // Sun, low and warm at either end of the round.
    const sunY = this.horizon - p.sunHeight * this.horizon * 1.7;
    const glow = ctx.createRadialGradient(w * 0.68, sunY, 0, w * 0.68, sunY, w * 0.5);
    glow.addColorStop(0, rgbaFromHex(p.sun, 0.85));
    glow.addColorStop(0.15, rgbaFromHex(p.sun, 0.32));
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, this.horizon + 1);

    this.drawHills();
  }

  drawHills() {
    const { ctx, w } = this;
    const p = this.palette;
    const rng = makeRng(this.hole.features.treeSeed ^ 0x9e37);
    for (let layer = 0; layer < 2; layer++) {
      const amp = 11 + layer * 9;
      const base = this.horizon + 1;
      const lift = 6 + layer * 13;
      ctx.beginPath();
      ctx.moveTo(0, base);
      const seedA = rng() * 10;
      const seedB = rng() * 10;
      for (let x = 0; x <= w; x += 8) {
        const n = Math.sin(x / (170 + layer * 90) + seedA) * 0.6
          + Math.sin(x / (61 + layer * 33) + seedB) * 0.4;
        ctx.lineTo(x, base - lift - n * amp);
      }
      ctx.lineTo(w, base);
      ctx.closePath();
      ctx.fillStyle = mixHex('#31543a', p.skyHaze, layer === 0 ? 0.42 : 0.6);
      ctx.fill();
    }
  }

  drawGround() {
    const { ctx, w, h } = this;
    const p = this.palette;
    const ground = ctx.createLinearGradient(0, this.horizon, 0, h);
    ground.addColorStop(0, mixHex(p.rough, p.skyHaze, p.hazeMix));
    ground.addColorStop(0.18, p.rough);
    ground.addColorStop(1, mixHex(p.rough, '#000000', 0.06));
    ctx.fillStyle = ground;
    ctx.fillRect(0, this.horizon, w, h - this.horizon);
  }

  // Sample the hole in z and build the fairway as a projected ribbon.
  fairwayEdgePoints(sign) {
    const points = [];
    const startZ = this.camera.z + NEAR_PLANE * 1.5;
    const endZ = this.hole.yards + 12;
    const steps = 70;
    for (let i = 0; i <= steps; i++) {
      // Denser sampling near the camera, where perspective changes fastest.
      const f = Math.pow(i / steps, 1.7);
      const z = startZ + (endZ - startZ) * f;
      const pt = this.project(this.centerAt(z) + sign * this.halfWidthAt(z), 0, z);
      if (pt) points.push(pt);
    }
    return points;
  }

  drawFairway() {
    const { ctx } = this;
    const p = this.palette;
    const left = this.fairwayEdgePoints(-1);
    const right = this.fairwayEdgePoints(1);
    if (left.length < 2 || right.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (const pt of left) ctx.lineTo(pt.x, pt.y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.save();
    ctx.clip();

    const p0 = left[0];
    const pEnd = left[left.length - 1];
    const grad = ctx.createLinearGradient(0, pEnd.y, 0, p0.y);
    grad.addColorStop(0, mixHex(p.grass, p.skyHaze, p.hazeMix));
    grad.addColorStop(0.25, p.grass);
    grad.addColorStop(1, mixHex(p.grass, '#000000', 0.04));
    ctx.fillStyle = grad;
    ctx.fillRect(0, this.horizon - 2, this.w, this.h);

    // Mown bands, 18 yards apart, converging naturally under projection.
    ctx.fillStyle = p.grassLit;
    const band = 14;
    for (let z = 0; z < this.hole.yards + band; z += band * 2) {
      const near = this.project(0, 0, z);
      const far = this.project(0, 0, z + band);
      if (!near || !far) continue;
      const alpha = 1 - this.haze(far.depth);
      ctx.globalAlpha = Math.max(0, alpha * 0.4);
      ctx.fillRect(0, far.y, this.w, Math.max(0.5, near.y - far.y));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // The tee deck you are standing on. Only visible from the tee: once you have
  // hit, it is behind the camera and the projection drops it.
  drawTeeBox() {
    const { ctx } = this;
    const cx = this.centerAt(0);
    const back = -8;
    const front = 5;
    const halfWidth = 6;

    const corners = [
      this.project(cx - halfWidth, 0, back),
      this.project(cx + halfWidth, 0, back),
      this.project(cx + halfWidth, 0, front),
      this.project(cx - halfWidth, 0, front),
    ];
    if (corners.some((c) => !c)) return;

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (const c of corners.slice(1)) ctx.lineTo(c.x, c.y);
    ctx.closePath();
    // Tee decks are mown tighter and flatter than the fairway around them.
    ctx.fillStyle = mixHex(this.palette.grassLit, '#d8e8c8', 0.35);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // The markers you must tee up between.
    for (const side of [-1, 1]) {
      const marker = this.project(cx + side * (halfWidth - 1.2), 0.35, 0.5);
      if (!marker) continue;
      const r = Math.max(2, marker.scale * 0.035);
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#e8503a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // A circle in world space, projected point by point — correct under
  // perspective, unlike drawing an ellipse on screen.
  groundCircle(cx, cz, rx, rz) {
    const points = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const pt = this.project(cx + Math.cos(a) * rx, 0, cz + Math.sin(a) * rz);
      if (pt) points.push(pt);
    }
    return points;
  }

  fillGroundShape(points, fill) {
    if (points.length < 3) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const pt of points) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  drawBunker(bunker) {
    // A bunker level with the player spreads across the whole frame as a slab
    // of sand. Anything that close is beside you, not ahead of you.
    const centre = this.project(bunker.x, 0, bunker.z);
    if (!centre || centre.depth < this.camBack * 1.2) return;
    const pts = this.groundCircle(bunker.x, bunker.z, bunker.rx, bunker.rz);
    if (!pts.length) return;
    const fade = this.haze(pts[0].depth);
    this.fillGroundShape(pts, mixHex('#e6d3a3', this.palette.skyHaze, fade));
  }

  drawWater() {
    const { water } = this.scenery;
    const z = water.z;
    const x = this.centerAt(z) + water.side * (this.halfWidthAt(z) + 26);
    const centre = this.project(x, 0, z);
    if (!centre || centre.depth < this.camBack * 1.2) return;
    const pts = this.groundCircle(x, z, 22, water.length / 2);
    if (!pts.length) return;
    this.fillGroundShape(pts, mixHex('#2f6fb8', this.palette.skyHaze, this.haze(pts[0].depth)));
  }

  drawGreen() {
    const pinZ = this.hole.yards;
    const r = this.scenery.greenRadius;
    const pts = this.groundCircle(this.centerAt(pinZ), pinZ, r, r * 0.8);
    if (!pts.length) return;
    const fade = this.haze(pts[0].depth);
    this.fillGroundShape(pts, mixHex('#7fcf75', this.palette.skyHaze, fade * 0.8));
  }

  drawFlag() {
    const pinZ = this.hole.yards;
    const pinX = this.centerAt(pinZ);
    const base = this.project(pinX, 0, pinZ);
    let top = this.project(pinX, FLAG_HEIGHT, pinZ);
    if (!base || !top) return;
    const { ctx } = this;
    if (base.y - top.y < 14) top = { ...top, y: base.y - 14, x: base.x };

    // The cup, then the stick, then the flag catching the light.
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, Math.max(1, base.scale * 0.14), Math.max(0.6, base.scale * 0.07), 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,40,22,0.85)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.strokeStyle = 'rgba(250,250,250,0.92)';
    ctx.lineWidth = Math.max(1.6, base.scale * 0.035);
    ctx.stroke();

    const flagW = Math.max(7, base.scale * 0.5);
    const flagH = Math.max(5, base.scale * 0.34);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + flagW, top.y + flagH * 0.42);
    ctx.lineTo(top.x, top.y + flagH);
    ctx.closePath();
    ctx.fillStyle = '#ef4136';
    ctx.fill();
  }

  drawTrees() {
    const { ctx } = this;
    const p = this.palette;
    for (const tree of this.scenery.trees) {
      const base = this.project(tree.x, 0, tree.z);
      const top = this.project(tree.x, tree.height, tree.z);
      if (!base || !top) continue;
      // Anything nearer than this fills the screen with a single canopy.
      if (base.depth < this.camBack * 1.5) continue;
      if (base.x < -120 || base.x > this.w + 120) continue;

      const fade = this.haze(base.depth);
      const height = base.y - top.y;
      const width = Math.max(1.5, base.scale * tree.width * 0.5);
      const colour = mixHex(mixHex(p.tree, '#000000', (tree.shade - 1) * 0.22), p.skyHaze, fade);

      // Trunk, then a stack of three canopy blobs — cheap, reads as a conifer.
      ctx.fillStyle = mixHex('#3a2a1c', p.skyHaze, fade);
      ctx.fillRect(base.x - width * 0.12, base.y - height * 0.22, width * 0.24, height * 0.22);

      ctx.fillStyle = colour;
      for (let i = 0; i < 3; i++) {
        const f = i / 3;
        const cy = base.y - height * (0.25 + f * 0.62);
        const r = width * (1 - f * 0.45) * tree.shade;
        ctx.beginPath();
        ctx.ellipse(base.x, cy, r, height * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawBall(flight) {
    const { ctx } = this;

    if (flight && flight.p < 1) {
      // The ball arcs away from where you were standing toward the new lie.
      const fromZ = flight.from.ballZ ?? flight.from.z;
      const toZ = flight.to.ballZ ?? flight.to.z;
      const t = flight.p;
      const z = fromZ + (toZ - fromZ) * t;
      const fromX = flight.from.ballX ?? flight.from.x;
      const toX = flight.to.ballX ?? flight.to.x;
      const x = fromX + (toX - fromX) * t;
      const peak = Math.min(34, (toZ - fromZ) * 0.14);
      const y = Math.sin(Math.PI * t) * peak;
      const pt = this.project(x, y, z);
      if (pt) this.paintBall(pt.x, pt.y, Math.max(5, pt.scale * 0.09), false);
      return;
    }

    // At rest: the actual ball position, CAM_BACK yards ahead of the lens.
    const pt = this.project(this.camera.ballX ?? this.camera.x, 0,
      (this.camera.ballZ ?? this.camera.z) + 0);
    if (!pt) return;
    this.paintBall(pt.x, pt.y, Math.max(7, pt.scale * 0.1), true);
  }

  paintBall(x, y, r, grounded) {
    const { ctx } = this;
    if (grounded) {
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.85, r * 1.7, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
    }
    // A ring of contrast so the ball never disappears into the fairway.
    ctx.beginPath();
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    const shine = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    shine.addColorStop(0, '#ffffff');
    shine.addColorStop(1, '#cfd8cd');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = shine;
    ctx.fill();
  }
}
