// Drawing: the arena with its flies, and the live brain (2D map or 3D cloud).
import { W, WALL_W } from './world.js';

const SUGAR_GLOW = 150, LEMON_GLOW = 82;

export function drawArena(c, scale, world, flies, opts) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 1;
  c.beginPath();
  for (let i = 40; i < W; i += 40) { c.moveTo(i, 0); c.lineTo(i, W); c.moveTo(0, i); c.lineTo(W, i); }
  c.stroke();
  for (const s of world.sugar) {
    const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, SUGAR_GLOW);
    g.addColorStop(0, `rgba(255,181,71,${0.15 * s.a})`); g.addColorStop(1, 'rgba(255,181,71,0)');
    c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, SUGAR_GLOW, 0, 7); c.fill();
  }
  for (const s of world.lemon) {
    const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, LEMON_GLOW);
    g.addColorStop(0, 'rgba(198,224,90,0.16)'); g.addColorStop(1, 'rgba(198,224,90,0)');
    c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, LEMON_GLOW, 0, 7); c.fill();
  }
  for (const s of world.sugar) {
    const r = 8 + 10 * s.a;
    c.fillStyle = '#ffb547'; c.beginPath(); c.arc(s.x, s.y, r, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    for (let k = 0; k < 5; k++) { const a = k * 2.4 + s.x; c.fillRect(s.x + Math.cos(a) * r * 0.5 - 1.2, s.y + Math.sin(a) * r * 0.5 - 1.2, 2.4, 2.4); }
  }
  for (const s of world.lemon) {
    c.save(); c.translate(s.x, s.y); c.rotate(0.5);
    c.fillStyle = '#c6e05a'; c.beginPath(); c.ellipse(0, 0, 15, 11, 0, 0, 7); c.fill();
    c.fillStyle = '#a9c23e'; c.beginPath(); c.ellipse(15, 0, 3, 2.4, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(-4, -4, 5, 2.5, -0.3, 0, 7); c.fill();
    c.restore();
  }
  c.lineCap = 'round'; c.strokeStyle = '#8d8d95'; c.lineWidth = WALL_W;
  for (const s of world.walls) { c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke(); }
  if (opts.drag) { c.strokeStyle = 'rgba(141,141,149,0.6)'; c.beginPath(); c.moveTo(opts.drag.x1, opts.drag.y1); c.lineTo(opts.drag.x2, opts.drag.y2); c.stroke(); }
  if (opts.start) {
    const [x, y] = opts.start;
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1.2; c.setLineDash([4, 4]);
    c.beginPath(); c.arc(x, y, 18, 0, 7); c.stroke(); c.setLineDash([]);
  }
  for (const f of flies) drawFly(c, f, opts.time, f === opts.focus && flies.length > 2);
  if (opts.labels) for (const f of flies) {
    c.font = '600 12px Inter, sans-serif'; c.textAlign = 'center';
    c.fillStyle = f.tag === 'Brain' ? '#ff9a88' : '#9ec3ff';
    c.fillText(f.tag, f.x, f.y - 28);
  }
}

export function drawFly(c, f, time, ring) {
  const { x, y, th } = f, inp = f.inputs || {};
  const robot = f.kind === 'script';
  if (ring) { c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 24, 0, 7); c.stroke(); }
  c.save(); c.translate(x, y); c.rotate(th); c.scale(1.35, 1.35);
  c.strokeStyle = robot ? '#7d8aa3' : '#2b2118'; c.lineWidth = 1.4; c.lineCap = 'round';
  const ph = f.phase;
  for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) {
    const tri = (i % 2 === 0) === (sd === 1) ? 0 : Math.PI;
    const sw = f.eating || Math.abs(f.v) < 2 ? 0 : Math.sin(ph + tri) * 3.5;
    const bx = 3 - i * 4, ex = bx + 6 - i * 6 + sw;
    c.beginPath(); c.moveTo(bx, sd * 3); c.lineTo(bx + (2 - i * 3) + sw * 0.5, sd * 9); c.lineTo(ex, sd * 13); c.stroke();
  }
  c.fillStyle = 'rgba(210,225,255,0.28)'; c.strokeStyle = 'rgba(220,230,255,0.5)'; c.lineWidth = 0.8;
  for (const sd of [-1, 1]) { c.beginPath(); c.ellipse(-9, sd * 5, 10, 4.2, sd * 0.32, 0, 7); c.fill(); c.stroke(); }
  const hue = f.hue;
  c.fillStyle = robot ? '#8e9bb5' : hue != null ? `hsl(${hue},55%,52%)` : '#c08a3e';
  c.beginPath(); c.ellipse(-8, 0, 8.5, 5.6, 0, 0, 7); c.fill();
  c.fillStyle = robot ? '#3b4558' : '#4a3017';
  for (let k = 0; k < 3; k++) { c.beginPath(); c.ellipse(-6 - k * 3.4, 0, 0.9, 5.2 - k * 0.8, 0, 0, 7); c.fill(); }
  c.fillStyle = robot ? '#6f7d98' : '#a8742f'; c.beginPath(); c.ellipse(2, 0, 5, 4.6, 0, 0, 7); c.fill();
  c.fillStyle = robot ? '#5d6a84' : '#9b6a2a'; c.beginPath(); c.ellipse(8, 0, 3.4, 4.2, 0, 0, 7); c.fill();
  c.fillStyle = robot ? '#6fd3ff' : '#d2332a';
  for (const sd of [-1, 1]) { c.beginPath(); c.ellipse(8.5, sd * 3.4, 2.4, 2.1, 0, 0, 7); c.fill(); }
  if (f.eating) {
    const ext = 4 + Math.sin(time / 90) * 1.5;
    c.strokeStyle = '#e9b070'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(11, 0); c.lineTo(11 + ext, 0); c.stroke();
  }
  c.restore();
  for (const sd of [-1, 1]) {
    const a = f.antenna(sd);
    const hx = x + Math.cos(th) * 13, hy = y + Math.sin(th) * 13;
    c.strokeStyle = robot ? '#7d8aa3' : '#6b4a22'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(hx, hy); c.lineTo(a.x, a.y); c.stroke();
    const sug = sd < 0 ? inp.sl : inp.sr, lem = sd < 0 ? inp.ll : inp.lr, tou = sd < 0 ? inp.tl : inp.tr;
    let col = 'rgba(255,255,255,0.35)', r = 1.8;
    if (tou) { col = '#7fb2ff'; r = 3.2; } else if (lem > 0.08) { col = '#c6e05a'; r = 1.8 + lem * 2; } else if (sug > 0.05) { col = '#ffb547'; r = 1.8 + Math.min(1, sug) * 2; }
    c.fillStyle = col; c.beginPath(); c.arc(a.x, a.y, r, 0, 7); c.fill();
  }
}

// ---------------- brain view ----------------
const WHITE = '#f4f4f5';
const SENSE_COL = ['#ffb547', '#ffb547', '#c6e05a', '#c6e05a', '#7fb2ff', '#7fb2ff'];
const hexCache = {};
function rgba(h, a) {
  let rgb = hexCache[h];
  if (!rgb) rgb = hexCache[h] = [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)).join(',');
  return `rgba(${rgb},${a.toFixed(3)})`;
}

export class BrainView {
  constructor(canvas, wiring) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.Wr = wiring;
    const d = wiring.d, n = wiring.n;
    this.mode = '3d'; this.yaw = 0.5; this.pitch = 0.18; this.spin = true; this.hover = -1;
    this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.col = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = wiring.sensorOf[i];
      this.col[i] = j >= 0 ? SENSE_COL[j] : wiring.isOut[i] ? '#ff7a66' : WHITE;
    }
    // world coords (nm-ish voxels; z is 10x coarser)
    const bx = d.bg.filter((_, k) => k % 2 === 0), by = d.bg.filter((_, k) => k % 2 === 1), bz = d.bgz;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < bx.length; k++) { x0 = Math.min(x0, bx[k]); x1 = Math.max(x1, bx[k]); y0 = Math.min(y0, by[k]); y1 = Math.max(y1, by[k]); z0 = Math.min(z0, bz[k] * 10); z1 = Math.max(z1, bz[k] * 10); }
    this.box = { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, r: (x1 - x0) / 2 };
    const norm = (x, y, z) => [(x - this.box.cx) / this.box.r, (y - this.box.cy) / this.box.r, (z * 10 - this.box.cz) / this.box.r];
    const lite = matchMedia('(max-width: 700px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
    this.lite = lite;
    const stride = lite ? 2 : 1, nbg = Math.floor(bx.length / stride);
    this.bg3 = new Float32Array(nbg * 3);
    for (let k = 0; k < nbg; k++) { const q = k * stride, p = norm(bx[q], by[q], bz[q]); this.bg3.set(p, 3 * k); }
    this.n3 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const p = norm(d.x[i], d.y[i], d.z[i]); this.n3.set(p, 3 * i); }
    this.bgP = new Float32Array(this.bg3.length / 3 * 2);
    this.resize();
  }
  resize() {
    const dpr = this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.c.getBoundingClientRect();
    this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
    this.bg2 = null;
  }
  // project unit-cube coords to the canvas
  project(src, dst, count, flat) {
    const Wc = this.c.width, Hc = this.c.height, s = Math.min(Wc * 0.46, Hc * 0.85), cx = Wc / 2, cy = Hc / 2;
    if (flat) {
      const s2 = Math.min(Wc * 0.47, Hc * 0.47 * (this.box.r * 2) / (this.box.y1 - this.box.y0));
      for (let k = 0; k < count; k++) { dst[2 * k] = cx + src[3 * k] * s2; dst[2 * k + 1] = cy + src[3 * k + 1] * s2; }
      return;
    }
    const cyw = Math.cos(this.yaw), syw = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    for (let k = 0; k < count; k++) {
      const x = src[3 * k], y = src[3 * k + 1], z = src[3 * k + 2];
      const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
      const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const f = 2.6 / (2.6 + z2);
      dst[2 * k] = cx + x1 * s * f; dst[2 * k + 1] = cy + y1 * s * f;
    }
  }
  draw(brain, dt) {
    const c = this.ctx, Wc = this.c.width, Hc = this.c.height, n = this.Wr.n, dpr = this.dpr;
    const flat = this.mode === '2d';
    if (!flat && this.spin && !this.dragging) this.yaw += dt * 0.25;
    const P = new Float32Array(n * 2);
    this.project(this.n3, P, n, flat);
    for (let i = 0; i < n; i++) { this.px[i] = P[2 * i]; this.py[i] = P[2 * i + 1]; }
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, Wc, Hc);
    // whole-brain silhouette
    const nb = this.bg3.length / 3;
    if (flat && this.bg2) c.drawImage(this.bg2, 0, 0);
    else {
      this.project(this.bg3, this.bgP, nb, flat);
      const r = Math.max(1, 1.1 * dpr);
      c.fillStyle = flat ? 'rgba(160,160,175,0.16)' : 'rgba(150,160,190,0.13)';
      for (let k = 0; k < nb; k++) c.fillRect(this.bgP[2 * k] - r / 2, this.bgP[2 * k + 1] - r / 2, r, r);
      if (flat) { this.bg2 = document.createElement('canvas'); this.bg2.width = Wc; this.bg2.height = Hc; this.bg2.getContext('2d').drawImage(this.c, 0, 0); }
    }
    if (!brain) return;
    const { trace, flash, sil } = brain, top = this.Wr.top;
    c.globalCompositeOperation = 'lighter';
    c.lineWidth = 0.8 * dpr;
    for (const i of brain.fired) for (let q = 0; q < 2; q++) {
      const j = top[2 * i + q]; if (j < 0) continue;
      c.strokeStyle = this.col[i] === WHITE ? 'rgba(255,255,255,0.10)' : rgba(this.col[i], 0.2);
      c.beginPath(); c.moveTo(this.px[i], this.py[i]); c.lineTo(this.px[j], this.py[j]); c.stroke();
    }
    const r0 = 1.6 * dpr;
    for (let i = 0; i < n; i++) {
      if (sil[i]) continue;
      const lv = Math.min(1, trace[i] / 60 + flash[i] * 0.6), col = this.col[i], white = col === WHITE;
      if (lv < 0.02) { c.fillStyle = 'rgba(255,255,255,0.13)'; c.fillRect(this.px[i] - r0 / 2, this.py[i] - r0 / 2, r0, r0); continue; }
      if (!flat && !this.lite && lv > 0.25) { // glow halo
        c.fillStyle = rgba(col, 0.08 * lv); c.beginPath(); c.arc(this.px[i], this.py[i], r0 * (3 + 4 * lv), 0, 7); c.fill();
      }
      c.fillStyle = rgba(col, (white ? 0.15 : 0.25) + (white ? 0.5 : 0.75) * lv);
      c.beginPath(); c.arc(this.px[i], this.py[i], r0 * (0.8 + lv * (white ? 0.9 : 1.6)), 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = '#ff5a4a'; c.lineWidth = 1.2 * dpr;
    const xr = 2.6 * dpr;
    for (let i = 0; i < n; i++) if (sil[i]) {
      c.beginPath(); c.moveTo(this.px[i] - xr, this.py[i] - xr); c.lineTo(this.px[i] + xr, this.py[i] + xr);
      c.moveTo(this.px[i] + xr, this.py[i] - xr); c.lineTo(this.px[i] - xr, this.py[i] + xr); c.stroke();
    }
    if (this.hover >= 0) { c.strokeStyle = '#fff'; c.lineWidth = dpr; c.beginPath(); c.arc(this.px[this.hover], this.py[this.hover], 6 * dpr, 0, 7); c.stroke(); }
    if (flat) {
      c.font = `${10 * dpr}px "IBM Plex Mono", monospace`; c.fillStyle = 'rgba(200,200,210,0.45)';
      c.fillText('LEFT', 10 * dpr, Hc - 10 * dpr);
      c.fillText('RIGHT', Wc - c.measureText('RIGHT').width - 10 * dpr, Hc - 10 * dpr);
    }
  }
  nearest(clientX, clientY) {
    const r = this.c.getBoundingClientRect(), x = (clientX - r.left) * this.dpr, y = (clientY - r.top) * this.dpr;
    let best = -1, bd = (12 * this.dpr) ** 2;
    for (let i = 0; i < this.Wr.n; i++) { const d2 = (this.px[i] - x) ** 2 + (this.py[i] - y) ** 2; if (d2 < bd) { bd = d2; best = i; } }
    return best;
  }
}
