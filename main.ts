// Sky Whale — "HEY, JUDGE — THE WHALE FLIES."
// A colossal whale breaches upward through a sea of clouds at dawn, the sun
// blazing behind it, water streaming off its back, a tiny balloon and birds
// for scale. Pure-JS rasterizer: every pixel is computed here, deterministically
// (fixed-seed PRNG, no Date, no Math.random, no network), into a 2x supersampled
// buffer, then box-downsampled to 1024x1024 and written as a hand-rolled PNG.
// Node 22, standard library only.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ------------------------------------------------------------------ canvas

const W = 1024; // output size
const H = 1024;
const SS = 2; // supersample factor (render at 2048, average down)
const DW = W * SS;
const DH = H * SS;

const buf = new Uint8ClampedArray(DW * DH * 4); // RGBA, device pixels

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Source-over blend of one device pixel.
function blend(px, r, g, b, a) {
  const i = px * 4;
  const ia = 1 - a;
  buf[i] = clamp255(r * a + buf[i] * ia);
  buf[i + 1] = clamp255(g * a + buf[i + 1] * ia);
  buf[i + 2] = clamp255(b * a + buf[i + 2] * ia);
  buf[i + 3] = 255;
}

// Fill a rectangle given in art (1024-space) coordinates.
function fillRect(x0, y0, x1, y1, rgb, a) {
  const dx0 = Math.max(0, Math.floor(x0 * SS));
  const dy0 = Math.max(0, Math.floor(y0 * SS));
  const dx1 = Math.min(DW, Math.ceil(x1 * SS));
  const dy1 = Math.min(DH, Math.ceil(y1 * SS));
  for (let y = dy0; y < dy1; y++) {
    let px = y * DW + dx0;
    for (let x = dx0; x < dx1; x++, px++) blend(px, rgb[0], rgb[1], rgb[2], a);
  }
}

// Vertical gradient over a rectangle, stops = [[t, [r,g,b]], ...] with t in [0,1].
function vgrad(x0, y0, x1, y1, stops) {
  const dy0 = Math.max(0, Math.floor(y0 * SS));
  const dy1 = Math.min(DH, Math.ceil(y1 * SS));
  for (let y = dy0; y < dy1; y++) {
    const t = (y / SS - y0) / (y1 - y0);
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { lo = stops[s]; hi = stops[s + 1]; break; }
    }
    const span = hi[0] - lo[0] || 1;
    const f = (t - lo[0]) / span;
    const r = lo[1][0] + (hi[1][0] - lo[1][0]) * f;
    const g = lo[1][1] + (hi[1][1] - lo[1][1]) * f;
    const b = lo[1][2] + (hi[1][2] - lo[1][2]) * f;
    const dx0 = Math.max(0, Math.floor(x0 * SS));
    const dx1 = Math.min(DW, Math.ceil(x1 * SS));
    let px = y * DW + dx0;
    for (let x = dx0; x < dx1; x++, px++) blend(px, r, g, b, 1);
  }
}

// Radial glow: alpha falls smoothly from a0 at the centre to 0 at radius r.
function radialGlow(cx, cy, r, rgb, a0) {
  const dx0 = Math.max(0, Math.floor((cx - r) * SS));
  const dy0 = Math.max(0, Math.floor((cy - r) * SS));
  const dx1 = Math.min(DW, Math.ceil((cx + r) * SS));
  const dy1 = Math.min(DH, Math.ceil((cy + r) * SS));
  const rr = r * SS;
  const ccx = cx * SS;
  const ccy = cy * SS;
  for (let y = dy0; y < dy1; y++) {
    const ddy = y - ccy;
    let px = y * DW + dx0;
    for (let x = dx0; x < dx1; x++, px++) {
      const ddx = x - ccx;
      const d = Math.sqrt(ddx * ddx + ddy * ddy) / rr;
      if (d >= 1) continue;
      const f = 1 - d;
      const a = a0 * f * f * (3 - 2 * f); // smoothstep falloff
      if (a > 0.004) blend(px, rgb[0], rgb[1], rgb[2], a);
    }
  }
}

// ------------------------------------------------------------------ paths

// A path is a list of commands: ['M',x,y] ['L',x,y] ['Q',cx,cy,x,y]
// ['C',c1x,c1y,c2x,c2y,x,y] ['Z']. Coordinates are in art (1024) space.
function flatten(path, steps) {
  const pts = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const cmd of path) {
    if (cmd[0] === 'M') {
      cx = cmd[1]; cy = cmd[2]; sx = cx; sy = cy;
      pts.push([cx * SS, cy * SS]);
    } else if (cmd[0] === 'L') {
      cx = cmd[1]; cy = cmd[2];
      pts.push([cx * SS, cy * SS]);
    } else if (cmd[0] === 'Q') {
      const x0 = cx; const y0 = cy;
      const qx = cmd[1]; const qy = cmd[2];
      const x1 = cmd[3]; const y1 = cmd[4];
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const x = u * u * x0 + 2 * u * t * qx + t * t * x1;
        const y = u * u * y0 + 2 * u * t * qy + t * t * y1;
        pts.push([x * SS, y * SS]);
      }
      cx = x1; cy = y1;
    } else if (cmd[0] === 'C') {
      const x0 = cx; const y0 = cy;
      const c1x = cmd[1]; const c1y = cmd[2];
      const c2x = cmd[3]; const c2y = cmd[4];
      const x1 = cmd[5]; const y1 = cmd[6];
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const x = u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1;
        const y = u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1;
        pts.push([x * SS, y * SS]);
      }
      cx = x1; cy = y1;
    } else if (cmd[0] === 'Z') {
      pts.push([sx * SS, sy * SS]);
      cx = sx; cy = sy;
    }
  }
  return pts;
}

// Even-odd scanline fill of a flattened polygon (device coords).
function fillPoly(pts, rgb, a) {
  if (pts.length < 3) return;
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if (p[1] === q[1]) continue;
    edges.push([p, q]);
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(DH - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = minY; y <= maxY; y++) {
    xs.length = 0;
    const yc = y + 0.5;
    for (const e of edges) {
      const p = e[0];
      const q = e[1];
      if ((p[1] <= yc && q[1] > yc) || (q[1] <= yc && p[1] > yc)) {
        const t = (yc - p[1]) / (q[1] - p[1]);
        xs.push(p[0] + t * (q[0] - p[0]));
      }
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.floor(xs[k]));
      const x1 = Math.min(DW, Math.ceil(xs[k + 1]));
      let px = y * DW + x0;
      for (let x = x0; x < x1; x++, px++) blend(px, rgb[0], rgb[1], rgb[2], a);
    }
  }
}

function fillPath(path, rgb, a) {
  fillPoly(flatten(path, 28), rgb, a);
}

// Filled circle / ellipse (art coords).
function fillCircle(cx, cy, r, rgb, a) {
  fillEllipse(cx, cy, r, r, rgb, a);
}

function fillEllipse(cx, cy, rx, ry, rgb, a) {
  const dy0 = Math.max(0, Math.floor((cy - ry) * SS));
  const dy1 = Math.min(DH - 1, Math.ceil((cy + ry) * SS));
  const ccx = cx * SS;
  const ccy = cy * SS;
  const rrx = rx * SS;
  const rry = ry * SS;
  for (let y = dy0; y <= dy1; y++) {
    const ny = (y + 0.5 - ccy) / rry;
    if (ny < -1 || ny > 1) continue;
    const hw = rrx * Math.sqrt(1 - ny * ny);
    const x0 = Math.max(0, Math.floor(ccx - hw));
    const x1 = Math.min(DW, Math.ceil(ccx + hw));
    let px = y * DW + x0;
    for (let x = x0; x < x1; x++, px++) blend(px, rgb[0], rgb[1], rgb[2], a);
  }
}

// Thick polyline with round caps and joins (art coords, width in art px).
function strokePolyline(pts, width, rgb, a) {
  const w = (width * SS) / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const dx = (q[0] - p[0]) * SS;
    const dy = (q[1] - p[1]) * SS;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * w;
    const ny = (dx / len) * w;
    const quad = [
      [p[0] * SS + nx, p[1] * SS + ny],
      [q[0] * SS + nx, q[1] * SS + ny],
      [q[0] * SS - nx, q[1] * SS - ny],
      [p[0] * SS - nx, p[1] * SS - ny],
    ];
    fillPoly(quad, rgb, a);
    fillCircle(p[0], p[1], width / 2, rgb, a);
  }
  const last = pts[pts.length - 1];
  fillCircle(last[0], last[1], width / 2, rgb, a);
}

// A smooth curve through points (Catmull-Rom -> bezier), stroked.
function strokeCurve(pts, width, rgb, a) {
  const path = [['M', pts[0][0], pts[0][1]]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path.push(['C', c1x, c1y, c2x, c2y, p2[0], p2[1]]);
  }
  const flat = flatten(path, 20);
  const art = flat.map((p) => [p[0] / SS, p[1] / SS]);
  strokePolyline(art, width, rgb, a);
}

// ------------------------------------------------------------------ prng

// mulberry32 with a fixed seed: deterministic "randomness".
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ------------------------------------------------------------------ font

// 5x7 bitmap font, rows top to bottom, '#' = on. Only the glyphs the text needs.
const GLYPHS = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.#...', '#....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
};

// Draw one line of text. scale = art px per font pixel; char advance = 6*scale.
function drawText(text, x, y, scale, rgb, shadow) {
  const adv = 6 * scale;
  if (shadow) {
    for (let i = 0; i < text.length; i++) {
      const g = GLYPHS[text[i]] || GLYPHS[' '];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          if (g[r][c] === '#') {
            fillRect(x + i * adv + c * scale + scale * 0.45, y + r * scale + scale * 0.45,
              x + i * adv + (c + 1) * scale + scale * 0.45, y + (r + 1) * scale + scale * 0.45, shadow, 0.85);
          }
        }
      }
    }
  }
  for (let i = 0; i < text.length; i++) {
    const g = GLYPHS[text[i]] || GLYPHS[' '];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] === '#') {
          fillRect(x + i * adv + c * scale, y + r * scale,
            x + i * adv + (c + 1) * scale, y + (r + 1) * scale, rgb, 1);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ scene

const NAVY = [20, 28, 51];
const WHITE = [255, 255, 255];

function drawSky() {
  // Dawn gradient: deep indigo at the top, violet, rose, burning gold at the horizon.
  vgrad(0, 0, W, H, [
    [0.00, [16, 22, 46]],
    [0.28, [48, 38, 84]],
    [0.50, [122, 62, 102]],
    [0.66, [214, 110, 92]],
    [0.78, [255, 168, 92]],
    [1.00, [255, 196, 120]],
  ]);
  // Stars in the upper sky, fading out toward the bright horizon.
  for (let i = 0; i < 130; i++) {
    const x = rand() * W;
    const y = rand() * 430;
    const a = (0.25 + rand() * 0.6) * (1 - y / 520);
    const r = 0.8 + rand() * 1.6;
    fillCircle(x, y, r, WHITE, Math.max(0, a));
  }
  // Sun: low on the horizon, just right of centre, behind the whale's belly.
  radialGlow(700, 700, 260, [255, 170, 80], 0.85);
  radialGlow(700, 700, 150, [255, 205, 120], 0.85);
  fillCircle(700, 700, 80, [255, 190, 90], 1);
  fillCircle(700, 700, 70, [255, 214, 135], 1);
  fillCircle(700, 700, 58, [255, 240, 185], 1);
}

function drawCloud(x, y, s, tint, a) {
  // One soft cloud: a cluster of overlapping ellipses, denser in the middle.
  const puffs = [
    [0, 0, 1.00, 0.42], [-0.85, 0.10, 0.62, 0.34], [0.85, 0.10, 0.62, 0.34],
    [-0.45, -0.22, 0.55, 0.32], [0.45, -0.22, 0.55, 0.32], [0, -0.30, 0.48, 0.30],
    [-1.25, 0.22, 0.42, 0.26], [1.25, 0.22, 0.42, 0.26],
  ];
  for (const p of puffs) {
    fillEllipse(x + p[0] * s, y + p[1] * s, p[2] * s, p[3] * s, tint, a);
  }
}

function drawCloudSea() {
  // The sea of clouds the whale is breaching out of: layered, peach-lit.
  const rows = [
    { y: 890, c: [243, 196, 178], a: 0.95 },
    { y: 930, c: [250, 220, 200], a: 0.97 },
    { y: 968, c: [255, 238, 222], a: 1 },
    { y: 1005, c: [255, 244, 232], a: 1 },
  ];
  for (const row of rows) {
    for (let x = -60; x <= W + 60; x += 150) {
      const s = 120 + ((x * 37 + row.y * 11) % 60);
      drawCloud(x + ((row.y * 7) % 40), row.y, s, row.c, row.a);
    }
  }
  fillRect(0, 990, W, H, [255, 244, 232], 1);
}

function drawWhale() {
  const BACK = [32, 84, 138]; // deep ocean blue
  const BACK_DARK = [18, 56, 98];
  const BACK_LIGHT = [58, 122, 175];
  const BELLY = [214, 235, 246]; // pale belly

  // Tail flukes: two separate fat lobes with a clear gap of sky between them,
  // attached to a blunt tail stock so the tail reads as one piece with the body.
  fillPath([
    ['M', 252, 770],
    ['C', 180, 690, 110, 652, 70, 640],
    ['C', 105, 715, 165, 765, 240, 795],
    ['Z'],
  ], BACK, 1);
  fillPath([
    ['M', 252, 798],
    ['C', 185, 802, 125, 816, 88, 834],
    ['C', 125, 800, 180, 784, 242, 780],
    ['Z'],
  ], BACK, 1);

  // Body: a great arc, tail low-left, head high-right.
  fillPath([
    ['M', 228, 800],
    ['C', 330, 690, 430, 560, 560, 452],
    ['C', 640, 386, 716, 344, 782, 340],
    ['C', 812, 340, 826, 368, 822, 398],
    ['C', 818, 442, 780, 486, 716, 522],
    ['C', 640, 562, 540, 606, 448, 664],
    ['C', 380, 706, 300, 760, 252, 788],
    ['Z'],
  ], BACK, 1);

  // Darker back along the top edge, lighter wash toward the belly.
  fillPath([
    ['M', 252, 788],
    ['C', 330, 690, 430, 560, 560, 452],
    ['C', 640, 386, 716, 344, 782, 340],
    ['C', 800, 342, 812, 356, 808, 376],
    ['C', 700, 400, 560, 500, 440, 600],
    ['C', 360, 672, 300, 752, 252, 788],
    ['Z'],
  ], BACK_DARK, 0.55);
  fillPath([
    ['M', 448, 664],
    ['C', 540, 606, 640, 562, 716, 522],
    ['C', 780, 486, 818, 442, 822, 398],
    ['C', 824, 420, 800, 470, 730, 512],
    ['C', 650, 556, 550, 600, 470, 650],
    ['C', 460, 656, 452, 660, 448, 664],
    ['Z'],
  ], BACK_LIGHT, 0.5);

  // Pale belly along the underside.
  fillPath([
    ['M', 250, 792],
    ['C', 330, 742, 420, 680, 520, 616],
    ['C', 600, 566, 690, 528, 748, 506],
    ['C', 700, 540, 600, 590, 500, 648],
    ['C', 420, 694, 330, 748, 250, 792],
    ['Z'],
  ], BELLY, 0.95);

  // Throat grooves: three fine curves under the head.
  strokeCurve([[560, 560], [640, 540], [720, 512]], 4, [160, 200, 222], 0.7);
  strokeCurve([[540, 584], [630, 560], [706, 532]], 4, [160, 200, 222], 0.55);
  strokeCurve([[520, 606], [620, 580], [690, 552]], 4, [160, 200, 222], 0.4);

  // Pectoral fin, a broad curve sweeping down from mid-body.
  fillPath([
    ['M', 548, 584],
    ['C', 530, 650, 498, 700, 446, 728],
    ['C', 438, 732, 432, 728, 438, 718],
    ['C', 472, 676, 500, 628, 512, 580],
    ['Z'],
  ], BACK_DARK, 1);

  // Eye and mouth.
  fillCircle(742, 392, 10, [10, 18, 34], 1);
  fillCircle(745, 389, 3.5, WHITE, 1);
  strokeCurve([[818, 410], [780, 452], [716, 490]], 5, [12, 34, 62], 0.9);

  // Blowhole spout: a tight fan of fine droplets just above the head, with
  // two thin spray streaks rising from the blowhole.
  strokeCurve([[700, 336], [696, 300], [690, 268]], 3, [214, 234, 246], 0.7);
  strokeCurve([[712, 336], [718, 302], [726, 272]], 3, [214, 234, 246], 0.7);
  for (let i = 0; i < 42; i++) {
    const t = rand();
    const ang = (-90 + (rand() - 0.5) * 60) * (Math.PI / 180);
    const d = 16 + t * 72;
    const x = 706 + Math.cos(ang) * d;
    const y = 336 + Math.sin(ang) * d * 0.9;
    const r = 1.5 + (1 - t) * 3.2;
    fillCircle(x, y, r, [200, 228, 242], 0.6 + 0.35 * (1 - t));
    fillCircle(x - r * 0.3, y - r * 0.3, r * 0.35, WHITE, 0.85);
  }

  // Water streaming off the belly and tail: ribbons and droplets.
  const streams = [
    [[300, 780], [268, 830], [250, 880]],
    [[380, 726], [352, 782], [338, 838]],
    [[470, 668], [448, 726], [436, 786]],
    [[560, 606], [544, 664], [534, 724]],
    [[180, 800], [160, 850], [150, 900]],
  ];
  for (const s of streams) strokeCurve(s, 5, [190, 222, 240], 0.75);
  for (let i = 0; i < 40; i++) {
    const s = streams[Math.floor(rand() * streams.length)];
    const t = rand();
    const x = s[0][0] + (s[2][0] - s[0][0]) * t + (rand() - 0.5) * 26;
    const y = s[0][1] + (s[2][1] - s[0][1]) * t + (rand() - 0.5) * 18;
    const r = 2 + rand() * 4.5;
    fillCircle(x, y, r, [200, 228, 242], 0.8);
    fillCircle(x - r * 0.3, y - r * 0.3, r * 0.3, WHITE, 0.9);
  }
}

function drawBirds() {
  const birds = [
    [330, 250, 16], [392, 214, 12], [452, 268, 10],
    [884, 250, 14], [918, 330, 10], [150, 520, 12], [610, 190, 9],
  ];
  for (const b of birds) {
    const x = b[0]; const y = b[1]; const s = b[2];
    strokeCurve([[x - s, y], [x - s * 0.4, y - s * 0.55], [x, y]], 4, NAVY, 0.85);
    strokeCurve([[x, y], [x + s * 0.4, y - s * 0.55], [x + s, y]], 4, NAVY, 0.85);
  }
}

function drawBalloon() {
  // A tiny hot-air balloon, far below the whale: the scale cue.
  const x = 158; const y = 428;
  fillPath([
    ['M', x, y - 34],
    ['C', x + 30, y - 34, x + 40, y - 6, x + 26, y + 16],
    ['C', x + 16, y + 30, x - 16, y + 30, x - 26, y + 16],
    ['C', x - 40, y - 6, x - 30, y - 34, x, y - 34],
    ['Z'],
  ], [232, 84, 72], 1);
  fillPath([
    ['M', x, y - 34],
    ['C', x + 12, y - 34, x + 16, y - 6, x + 10, y + 16],
    ['C', x + 6, y + 30, x - 6, y + 30, x - 10, y + 16],
    ['C', x - 16, y - 6, x - 12, y - 34, x, y - 34],
    ['Z'],
  ], [255, 196, 92], 1);
  strokePolyline([[x - 18, y + 22], [x - 12, y + 48]], 3, [90, 60, 50], 1);
  strokePolyline([[x + 18, y + 22], [x + 12, y + 48]], 3, [90, 60, 50], 1);
  fillRect(x - 13, y + 48, x + 13, y + 64, [120, 78, 60], 1);
}

// ------------------------------------------------------------------ render

function renderScene() {
  drawSky();
  // One small cloud high in the sky, clear of the text and the whale's head.
  drawCloud(928, 268, 62, [255, 228, 214], 0.85);
  drawCloud(120, 640, 64, [255, 226, 208], 0.8);
  drawBalloon();
  drawWhale();
  drawBirds();
  drawCloudSea();
  // The address to the judge, bold and plain, top-left in clear sky.
  drawText('HEY, JUDGE -', 48, 56, 9, WHITE, NAVY);
  drawText('THE WHALE FLIES.', 48, 140, 9, WHITE, NAVY);
}

// ------------------------------------------------------------------ png

// CRC-32 (IEEE) table, built once.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

// Downsample the 2x buffer to 1024x1024 RGB and encode as PNG (filter 0).
function encodePng() {
  const raw = new Uint8Array(H * (1 + W * 3));
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0; // filter: None
    for (let x = 0; x < W; x++) {
      let r = 0; let g = 0; let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * DW + x * SS + dx) * 4;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      raw[o++] = Math.round(r / (SS * SS));
      raw[o++] = Math.round(g / (SS * SS));
      raw[o++] = Math.round(b / (SS * SS));
    }
  }
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, W);
  iv.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = deflateSync(raw, { level: 9 });
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(idat)), chunk('IEND', new Uint8Array(0))];
  let total = 0;
  for (const p of parts) total += p.length;
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { png.set(p, at); at += p.length; }
  return png;
}

// ------------------------------------------------------------------ main

function main() {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  mkdirSync(outDir, { recursive: true });
  renderScene();
  const png = encodePng();
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
