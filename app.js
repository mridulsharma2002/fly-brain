// Fly Brain NPC: a FlyWire sub-network (867 neurons) running a leaky
// integrate-and-fire model (Shiu et al. 2024 parameters) drives a toy body.
(() => {
'use strict';

// ---------- brain model constants (Shiu et al. 2024) ----------
const DT = 0.1;            // ms per step
const V0 = -52, VTH = -45, VRST = -52;
const TMBR = 20, TAU = 5, TRFC = 2.2;
const DELAY = 18;          // 1.8 ms synaptic delay in steps
const WSYN = 0.275;        // mV per synapse
const POI_KICK = 68.75;    // mV per Poisson input spike (w_syn * 250)
const MAX_RATE = 150;      // Hz, sensor drive at full strength
const TRACE_TAU = 0.25;    // s, smoothing for displayed firing rates

const $ = s => document.querySelector(s);
const arenaC = $('#arena'), brainC = $('#brain');
const actx = arenaC.getContext('2d'), bctx = brainC.getContext('2d');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let B = null; // brain
fetch('brain.json').then(r => r.json()).then(init).catch(e => {
  $('#firing').textContent = 'brain failed to load';
  console.error(e);
});

function b64(s, T) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new T(u.buffer);
}

function init(d) {
  const n = d.n;
  const ptr = b64(d.ptr, Int32Array), post = b64(d.post, Int16Array), wi = b64(d.w, Int16Array);
  const w = new Float32Array(wi.length);
  for (let k = 0; k < wi.length; k++) w[k] = wi[k] * WSYN;
  const find = (type, side) => {
    const out = [];
    for (let i = 0; i < n; i++) if (d.type[i] === type && (!side || d.side[i] === side)) out.push(i);
    return out;
  };
  // Readouts picked by simulating the full 139k-neuron brain: which output
  // neurons fire for sugar / bitter / touch on the left versus the right.
  const R = {
    bitterL: find('DNp42', 'l').concat(find('DNge067', 'l')),
    bitterR: find('DNp42', 'r').concat(find('DNge067', 'r')),
    touchL: find('DNg35', 'l').concat(find('DNg84', 'l')),
    touchR: find('DNg35', 'r').concat(find('DNg84', 'r')),
    feed: find('CB0701'), // MN9, proboscis motor neuron
  };
  // Sugar left-vs-right is spread over many output neurons, so we read it with a
  // linear decoder fitted on 440 simulated runs (held-out r = 0.95).
  const dec = d.decoder;
  // full-strength firing (Hz, summed over the group), measured offline
  const NORM = { bitterL: 50, bitterR: 24, touchL: 208, touchR: 202, feed: 100 };
  const S = { sugarL: d.sensors.sugarL, sugarR: d.sensors.sugarR, bitterL: d.sensors.bitterL,
              bitterR: d.sensors.bitterR, touchL: d.sensors.antL, touchR: d.sensors.antR };
  const sensorOf = new Int8Array(n).fill(-1);
  const sensorKeys = Object.keys(S);
  sensorKeys.forEach((k, j) => S[k].forEach(i => { sensorOf[i] = j; }));
  const readOf = new Int8Array(n).fill(-1);
  Object.keys(R).forEach((k, j) => R[k].forEach(i => { readOf[i] = j; }));

  // top targets per neuron, for drawing spike streaks
  const top = new Int32Array(n * 2).fill(-1);
  for (let i = 0; i < n; i++) {
    let b1 = -1, b2 = -1, w1 = 0, w2 = 0;
    for (let k = ptr[i]; k < ptr[i + 1]; k++) {
      const a = Math.abs(w[k]);
      if (a > w1) { b2 = b1; w2 = w1; b1 = post[k]; w1 = a; } else if (a > w2) { b2 = post[k]; w2 = a; }
    }
    top[2 * i] = b1; top[2 * i + 1] = b2;
  }

  B = {
    d, n, ptr, post, w, R, NORM, dec, S, sensorKeys, sensorOf, readOf, top,
    v: new Float32Array(n).fill(V0), g: new Float32Array(n), rf: new Float32Array(n),
    trace: new Float32Array(n), slow: new Float32Array(n), flash: new Float32Array(n), sil: new Uint8Array(n),
    ring: Array.from({ length: DELAY }, () => ({ a: new Int32Array(n), c: 0 })),
    t: 0, rates: new Float32Array(sensorKeys.length), spikesThisFrame: [], spikeCount: 0,
  };
  buildMeters();
  resize();
  seedScene();
  requestAnimationFrame(loop);
  window.__fly = { B, world, fly };
}

// ---------- brain step ----------
function stepBrain(steps, frameDt) {
  const { n, ptr, post, w, v, g, rf, sil, ring, sensorOf, rates, trace, slow, flash } = B;
  const pRate = new Float32Array(rates.length);
  for (let j = 0; j < rates.length; j++) pRate[j] = rates[j] * DT / 1000;
  const fired = B.spikesThisFrame; fired.length = 0;
  let count = 0;
  for (let s = 0; s < steps; s++) {
    const slot = ring[B.t % DELAY];
    // deliver spikes emitted DELAY steps ago
    for (let q = 0; q < slot.c; q++) {
      const i = slot.a[q];
      for (let k = ptr[i]; k < ptr[i + 1]; k++) g[post[k]] += w[k];
    }
    slot.c = 0;
    for (let i = 0; i < n; i++) {
      if (sil[i]) { v[i] = V0; g[i] = 0; continue; }
      if (rf[i] > 0) { rf[i] -= DT; continue; }
      v[i] += DT * (V0 - v[i] + g[i]) / TMBR;
      g[i] -= g[i] * DT / TAU;
      const j = sensorOf[i];
      if (j >= 0 && pRate[j] > 0 && Math.random() < pRate[j]) v[i] += POI_KICK;
      if (v[i] > VTH) {
        v[i] = VRST; g[i] = 0; rf[i] = j >= 0 ? 0 : TRFC;
        slot.a[slot.c++] = i;
        trace[i] += 1 / TRACE_TAU; slow[i] += 1 / 0.5; flash[i] = 1; count++;
        if (fired.length < 400) fired.push(i);
      }
    }
    B.t++;
  }
  const decay = Math.exp(-frameDt / TRACE_TAU);
  const decay2 = Math.exp(-frameDt / 0.5);
  for (let i = 0; i < n; i++) { trace[i] *= decay; slow[i] *= decay2; flash[i] *= 0.82; }
  B.spikeCount = count;
}
function decodeTaste() {
  let s = 0, tot = 0;
  for (const [i, wt] of B.dec) { s += B.slow[i] * wt; tot += B.slow[i]; }
  const total = tot / 3000;
  return { side: s + B.d.decBias * Math.min(1, total * 2), total };
}
function groupLevel(key) {
  let s = 0; for (const i of B.R[key]) s += B.trace[i];
  return s / B.NORM[key];
}

// ---------- world ----------
const W = 600; // logical arena size
const world = { sugar: [], lemon: [], walls: [], eaten: 0 };
const fly = { x: 300, y: 330, th: -Math.PI / 2, v: 0, trend: 0, phase: 0, back: 0, eating: false, noise: 0, cool: 0 };
const SUGAR_LAMBDA = 80, SUGAR_SIGMA = 130, LEMON_SIGMA = 48, WALL_W = 10;

function seedScene() {
  world.sugar.push({ x: 470, y: 150, a: 1 });
  world.lemon.push({ x: 160, y: 190 });
  world.walls.push({ x1: 360, y1: 250, x2: 470, y2: 250 });
}

function segDist(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy || 1;
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / L; t = Math.max(0, Math.min(1, t));
  const cx = s.x1 + t * dx, cy = s.y1 + t * dy;
  return { d: Math.hypot(px - cx, py - cy), cx, cy };
}
function sugarAt(x, y) {
  let c = 0;
  for (const s of world.sugar) c += s.a * Math.exp(-Math.hypot(x - s.x, y - s.y) / SUGAR_LAMBDA);
  return c;
}
// Weber-style receptor: firing grows with the log of concentration, so the
// left-right difference stays readable both far away and up close.
const receptor = c => c <= 0 ? 0 : Math.max(0, Math.min(MAX_RATE, MAX_RATE + 30 * Math.log(c)));
function lemonAt(x, y) {
  let c = 0;
  for (const s of world.lemon) { const d2 = (x - s.x) ** 2 + (y - s.y) ** 2; c += Math.exp(-d2 / (2 * LEMON_SIGMA ** 2)); }
  return Math.min(1, c * 1.3);
}
function touching(x, y) {
  if (x < 6 || y < 6 || x > W - 6 || y > W - 6) return 1;
  for (const s of world.walls) if (segDist(x, y, s).d < WALL_W / 2 + 3) return 1;
  return 0;
}
function antenna(side) { // side -1 = left, +1 = right
  const a = fly.th + side * 1.0;
  return { x: fly.x + Math.cos(a) * 22, y: fly.y + Math.sin(a) * 22 };
}

let stateText = 'Wandering';
function stepBody(dt) {
  const aL = antenna(-1), aR = antenna(1);
  const sl = sugarAt(aL.x, aL.y), sr = sugarAt(aR.x, aR.y);
  const ll = lemonAt(aL.x, aL.y), lr = lemonAt(aR.x, aR.y);
  const tl = touching(aL.x, aL.y), tr = touching(aR.x, aR.y);
  const r = B.rates;
  r[0] = receptor(sl); r[1] = receptor(sr); r[2] = MAX_RATE * ll; r[3] = MAX_RATE * lr;
  r[4] = MAX_RATE * tl; r[5] = MAX_RATE * tr;
  B.inputs = { sl, sr, ll, lr, tl, tr };

  // ---- the bridge: brain outputs -> body ----
  const taste = decodeTaste();
  const tasteL = Math.max(0, taste.side), tasteR = Math.max(0, -taste.side);
  const bitL = groupLevel('bitterL'), bitR = groupLevel('bitterR');
  const touL = groupLevel('touchL'), touR = groupLevel('touchR');
  const feed = groupLevel('feed');
  B.levels = { tasteL, tasteR, bitL, bitR, touL, touR, feed };

  let turnLeft = 16 * taste.side + 4.0 * (bitR - bitL) + 3.2 * (touR - touL);
  fly.noise += (-fly.noise * 1.2 + (Math.random() - 0.5) * 9) * dt;
  const smell = Math.min(1, taste.total);
  // Is the brain's sugar response rising or falling? If falling, we're walking
  // away from food, so turn harder (how fly larvae and bacteria search too).
  fly.trend += (((taste.total - (fly.lastTot ?? taste.total)) / Math.max(dt, 1e-3)) - fly.trend) * Math.min(1, dt * 3);
  fly.lastTot = taste.total;
  const losing = smell > 0.05 && fly.trend < -0.02;
  if (losing) turnLeft += 3.2 * (taste.side >= 0 ? 1 : -1);
  turnLeft += fly.noise * (smell > 0.15 ? 0.25 : 1);

  const mouthX = fly.x + Math.cos(fly.th) * 15, mouthY = fly.y + Math.sin(fly.th) * 15;
  let onSugar = null;
  for (const s of world.sugar) if (Math.hypot(mouthX - s.x, mouthY - s.y) < 8 + 10 * s.a + 4) onSugar = s;

  fly.cool = Math.max(0, fly.cool - dt);
  const alarm = Math.max(bitL + bitR, touL + touR);
  if (fly.back <= 0 && fly.cool <= 0 && alarm > 0.5) { fly.back = 0.55; fly.cool = 0.9; }

  let speed;
  fly.eating = false;
  if (fly.back > 0) {
    fly.back -= dt; speed = -48;
    stateText = (bitL + bitR) > (touL + touR) ? 'Backing away from the lemon' : 'Bumped something, backing up';
  } else if (onSugar && feed > 0.3) {
    fly.eating = true; speed = 0; turnLeft *= 0.1;
    onSugar.a -= dt * 0.22;
    stateText = 'Eating (MN9 is firing)';
    if (onSugar.a <= 0.05) { world.sugar.splice(world.sugar.indexOf(onSugar), 1); world.eaten++; $('#eaten').textContent = world.eaten; }
  } else {
    speed = smell > 0.15 ? 62 * (1 - Math.min(0.75, Math.abs(taste.side) * 4)) * (losing ? 0.5 : 1) : 52;
    if (onSugar) { speed = 8; stateText = B.sil[B.R.feed[0]] ? 'On sugar, but it can\'t eat' : 'Tasting sugar'; }
    else if (smell > 0.15) stateText = taste.side > 0.06 ? 'Sugar is to the left' : taste.side < -0.06 ? 'Sugar is to the right' : 'Heading for sugar';
    else stateText = 'Wandering';
  }
  fly.th -= turnLeft * dt;
  fly.v += (speed - fly.v) * Math.min(1, dt * 6);
  let nx = fly.x + Math.cos(fly.th) * fly.v * dt, ny = fly.y + Math.sin(fly.th) * fly.v * dt;
  // collisions (the body can't walk through walls)
  const R0 = 11;
  nx = Math.max(R0, Math.min(W - R0, nx)); ny = Math.max(R0, Math.min(W - R0, ny));
  for (const s of world.walls) {
    const q = segDist(nx, ny, s);
    if (q.d < R0 + WALL_W / 2) {
      const k = (R0 + WALL_W / 2 - q.d) / (q.d || 1);
      nx += (nx - q.cx) * k; ny += (ny - q.cy) * k;
    }
  }
  fly.x = nx; fly.y = ny;
  fly.phase += Math.abs(fly.v) * dt * 0.5;
}

// ---------- drawing: arena ----------
let aScale = 1, dpr = 1;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const ar = arenaC.getBoundingClientRect();
  arenaC.width = Math.round(ar.width * dpr); arenaC.height = Math.round(ar.width * dpr);
  aScale = arenaC.width / W;
  const br = brainC.getBoundingClientRect();
  brainC.width = Math.round(br.width * dpr); brainC.height = Math.round(br.height * dpr);
  if (B) buildBrainBg();
}
window.addEventListener('resize', () => { clearTimeout(resize.t); resize.t = setTimeout(resize, 120); });

function drawArena(time) {
  const c = actx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, arenaC.width, arenaC.height);
  c.setTransform(aScale, 0, 0, aScale, 0, 0);
  // grid
  c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 1;
  c.beginPath();
  for (let i = 40; i < W; i += 40) { c.moveTo(i, 0); c.lineTo(i, W); c.moveTo(0, i); c.lineTo(W, i); }
  c.stroke();
  // sugar fields + piles
  for (const s of world.sugar) {
    const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, SUGAR_SIGMA * 1.6);
    g.addColorStop(0, `rgba(255,181,71,${0.16 * s.a})`); g.addColorStop(1, 'rgba(255,181,71,0)');
    c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, SUGAR_SIGMA * 1.6, 0, 7); c.fill();
  }
  for (const s of world.lemon) {
    const g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, LEMON_SIGMA * 1.7);
    g.addColorStop(0, 'rgba(198,224,90,0.16)'); g.addColorStop(1, 'rgba(198,224,90,0)');
    c.fillStyle = g; c.beginPath(); c.arc(s.x, s.y, LEMON_SIGMA * 1.7, 0, 7); c.fill();
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
  // walls
  c.lineCap = 'round'; c.strokeStyle = '#8d8d95'; c.lineWidth = WALL_W;
  for (const s of world.walls) { c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke(); }
  if (drag) { c.strokeStyle = 'rgba(141,141,149,0.6)'; c.beginPath(); c.moveTo(drag.x1, drag.y1); c.lineTo(drag.x2, drag.y2); c.stroke(); }
  drawFly(c, time);
}

function drawFly(c, time) {
  const { x, y, th } = fly;
  const inp = B.inputs || {};
  c.save(); c.translate(x, y); c.rotate(th); c.scale(1.35, 1.35);
  // legs
  c.strokeStyle = '#2b2118'; c.lineWidth = 1.4; c.lineCap = 'round';
  const ph = fly.phase;
  for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) {
    const tri = (i % 2 === 0) === (sd === 1) ? 0 : Math.PI;
    const sw = fly.eating || Math.abs(fly.v) < 2 ? 0 : Math.sin(ph + tri) * 3.5;
    const bx = 3 - i * 4, ex = bx + 6 - i * 6 + sw;
    c.beginPath(); c.moveTo(bx, sd * 3); c.lineTo(bx + (2 - i * 3) + sw * 0.5, sd * 9); c.lineTo(ex, sd * 13); c.stroke();
  }
  // wings
  c.fillStyle = 'rgba(210,225,255,0.28)'; c.strokeStyle = 'rgba(220,230,255,0.5)'; c.lineWidth = 0.8;
  for (const sd of [-1, 1]) { c.beginPath(); c.ellipse(-9, sd * 5, 10, 4.2, sd * 0.32, 0, 7); c.fill(); c.stroke(); }
  // abdomen
  c.fillStyle = '#c08a3e'; c.beginPath(); c.ellipse(-8, 0, 8.5, 5.6, 0, 0, 7); c.fill();
  c.fillStyle = '#4a3017';
  for (let k = 0; k < 3; k++) { c.beginPath(); c.ellipse(-6 - k * 3.4, 0, 0.9, 5.2 - k * 0.8, 0, 0, 7); c.fill(); }
  // thorax + head
  c.fillStyle = '#a8742f'; c.beginPath(); c.ellipse(2, 0, 5, 4.6, 0, 0, 7); c.fill();
  c.fillStyle = '#9b6a2a'; c.beginPath(); c.ellipse(8, 0, 3.4, 4.2, 0, 0, 7); c.fill();
  c.fillStyle = '#d2332a';
  for (const sd of [-1, 1]) { c.beginPath(); c.ellipse(8.5, sd * 3.4, 2.4, 2.1, 0, 0, 7); c.fill(); }
  // proboscis
  if (fly.eating) {
    const ext = 4 + Math.sin(time / 90) * 1.5;
    c.strokeStyle = '#e9b070'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(11, 0); c.lineTo(11 + ext, 0); c.stroke();
  }
  c.restore();
  // antennae (sensors), drawn in world space
  for (const sd of [-1, 1]) {
    const a = antenna(sd);
    const hx = x + Math.cos(th) * 13, hy = y + Math.sin(th) * 13;
    c.strokeStyle = '#6b4a22'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(hx, hy); c.lineTo(a.x, a.y); c.stroke();
    const sug = sd < 0 ? inp.sl : inp.sr, lem = sd < 0 ? inp.ll : inp.lr, tou = sd < 0 ? inp.tl : inp.tr;
    let col = 'rgba(255,255,255,0.35)', r = 1.8;
    if (tou) { col = '#7fb2ff'; r = 3.2; } else if (lem > 0.08) { col = '#c6e05a'; r = 1.8 + lem * 2; } else if (sug > 0.05) { col = '#ffb547'; r = 1.8 + sug * 2; }
    c.fillStyle = col; c.beginPath(); c.arc(a.x, a.y, r, 0, 7); c.fill();
  }
}

// ---------- drawing: brain ----------
let bg = null, bmap = null;
function buildBrainBg() {
  const d = B.d, Wc = brainC.width, Hc = brainC.height;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < d.bg.length; k += 2) { const x = d.bg[k], y = d.bg[k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = 14 * dpr, s = Math.min((Wc - 2 * pad) / (x1 - x0), (Hc - 2 * pad) / (y1 - y0));
  const ox = (Wc - (x1 - x0) * s) / 2, oy = (Hc - (y1 - y0) * s) / 2;
  bmap = { f: (x, y) => [ox + (x - x0) * s, oy + (y - y0) * s] };
  bg = document.createElement('canvas'); bg.width = Wc; bg.height = Hc;
  const c = bg.getContext('2d');
  c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, Wc, Hc);
  c.fillStyle = 'rgba(160,160,175,0.16)';
  const r = Math.max(1, 1.1 * dpr);
  for (let k = 0; k < d.bg.length; k += 2) { const [px, py] = bmap.f(d.bg[k], d.bg[k + 1]); c.fillRect(px - r / 2, py - r / 2, r, r); }
  B.px = new Float32Array(B.n); B.py = new Float32Array(B.n);
  for (let i = 0; i < B.n; i++) { const [px, py] = bmap.f(d.x[i], d.y[i]); B.px[i] = px; B.py[i] = py; }
  c.font = `${10 * dpr}px "IBM Plex Mono", monospace`; c.fillStyle = 'rgba(200,200,210,0.45)';
  c.fillText('LEFT', 10 * dpr, Hc - 10 * dpr);
  const t = 'RIGHT'; c.fillText(t, Wc - c.measureText(t).width - 10 * dpr, Hc - 10 * dpr);
}
const COLORS = ['#ffb547', '#ffb547', '#c6e05a', '#c6e05a', '#7fb2ff', '#7fb2ff'];
function neuronColor(i) {
  const j = B.sensorOf[i];
  if (j >= 0) return COLORS[j];
  if (B.readOf[i] >= 0 || B.d.role[i] === 'o') return '#ff7a66';
  return '#f4f4f5';
}
function drawBrain() {
  if (!bg) return;
  const c = bctx, { n, px, py, trace, flash, sil, top } = B;
  c.globalCompositeOperation = 'source-over';
  c.drawImage(bg, 0, 0);
  // streaks from spikes to their strongest targets
  c.globalCompositeOperation = 'lighter';
  c.lineWidth = 0.8 * dpr;
  for (const i of B.spikesThisFrame) {
    for (let q = 0; q < 2; q++) {
      const j = top[2 * i + q]; if (j < 0) continue;
      c.strokeStyle = neuronColor(i) === '#f4f4f5' ? 'rgba(255,255,255,0.10)' : hexA(neuronColor(i), 0.18);
      c.beginPath(); c.moveTo(px[i], py[i]); c.lineTo(px[j], py[j]); c.stroke();
    }
  }
  const r0 = 1.6 * dpr;
  for (let i = 0; i < n; i++) {
    const lv = Math.min(1, trace[i] / 60 + flash[i] * 0.6);
    if (sil[i]) continue;
    const col = neuronColor(i);
    if (lv < 0.02) { c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(px[i] - r0 / 2, py[i] - r0 / 2, r0, r0); continue; }
    c.fillStyle = hexA(col, (col === '#f4f4f5' ? 0.15 : 0.25) + (col === '#f4f4f5' ? 0.5 : 0.75) * lv);
    const r = r0 * (0.8 + lv * (col === '#f4f4f5' ? 0.9 : 1.6));
    c.beginPath(); c.arc(px[i], py[i], r, 0, 7); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  c.strokeStyle = '#ff5a4a'; c.lineWidth = 1.2 * dpr;
  const xr = 2.6 * dpr;
  for (let i = 0; i < n; i++) if (sil[i]) {
    c.beginPath(); c.moveTo(px[i] - xr, py[i] - xr); c.lineTo(px[i] + xr, py[i] + xr); c.moveTo(px[i] + xr, py[i] - xr); c.lineTo(px[i] - xr, py[i] + xr); c.stroke();
  }
  if (hover >= 0) { c.strokeStyle = '#fff'; c.lineWidth = 1 * dpr; c.beginPath(); c.arc(px[hover], py[hover], 6 * dpr, 0, 7); c.stroke(); }
}
const hexCache = {};
function hexA(h, a) {
  let rgb = hexCache[h];
  if (!rgb) { rgb = hexCache[h] = [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)).join(','); }
  return `rgba(${rgb},${a.toFixed(3)})`;
}

// ---------- meters ----------
const METERS = [
  { name: 'Sugar side', sub: '106 output neurons', l: 'tasteL', r: 'tasteR', col: '#ffb547', k: 3 },
  { name: 'Bitter alarm', sub: 'DNp42 · DNge067', l: 'bitL', r: 'bitR', col: '#c6e05a' },
  { name: 'Touch', sub: 'DNg35 · DNg84', l: 'touL', r: 'touR', col: '#7fb2ff' },
  { name: 'Feeding', sub: 'MN9 motor neuron', one: 'feed', col: '#ff7a66' },
];
function buildMeters() {
  const box = $('#meters');
  box.innerHTML = METERS.map((m, k) => m.one
    ? `<div class="meter single"><div class="nm">${m.name}<small>${m.sub}</small></div><div class="bar"><i id="m${k}" style="background:${m.col}"></i></div></div>`
    : `<div class="meter"><div class="nm">${m.name}<small>${m.sub}</small></div><div class="bar l" title="left"><i id="m${k}l" style="background:${m.col}"></i></div><div class="bar" title="right"><i id="m${k}r" style="background:${m.col}"></i></div></div>`
  ).join('');
}
function updateMeters() {
  const L = B.levels; if (!L) return;
  const pct = v => Math.min(100, Math.max(0, v * 100)).toFixed(1) + '%';
  METERS.forEach((m, k) => {
    if (m.one) $('#m' + k).style.width = pct(L[m.one] / 1.2);
    else { const g = m.k || 1; $('#m' + k + 'l').style.width = pct(L[m.l] * g); $('#m' + k + 'r').style.width = pct(L[m.r] * g); }
  });
  let active = 0; for (let i = 0; i < B.n; i++) if (B.trace[i] > 2) active++;
  $('#firing').textContent = `${active} neurons firing`;
  $('#state').textContent = stateText;
}

// ---------- input: arena ----------
let tool = 'sugar', drag = null, placed = false;
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tool').forEach(x => x.classList.toggle('on', x === b));
  tool = b.dataset.tool;
  $('#hint').textContent = { sugar: 'Tap to drop sugar', lemon: 'Tap to drop a lemon', wall: 'Drag to draw a wall', erase: 'Tap something to remove it' }[tool];
  $('#hint').style.opacity = 1;
}));
$('#clear').addEventListener('click', () => { world.sugar.length = 0; world.lemon.length = 0; world.walls.length = 0; });
function arenaPt(e) {
  const r = arenaC.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * W };
}
arenaC.addEventListener('pointerdown', e => {
  const p = arenaPt(e);
  arenaC.setPointerCapture(e.pointerId);
  if (tool === 'wall') { drag = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }; return; }
  if (tool === 'sugar') { if (world.sugar.length >= 12) world.sugar.shift(); world.sugar.push({ x: p.x, y: p.y, a: 1 }); }
  if (tool === 'lemon') { if (world.lemon.length >= 12) world.lemon.shift(); world.lemon.push({ x: p.x, y: p.y }); }
  if (tool === 'erase') erase(p);
  hideHint();
});
arenaC.addEventListener('pointermove', e => { if (drag) { const p = arenaPt(e); drag.x2 = p.x; drag.y2 = p.y; } });
arenaC.addEventListener('pointerup', () => {
  if (drag) {
    if (Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1) > 12) { if (world.walls.length >= 20) world.walls.shift(); world.walls.push(drag); }
    drag = null; hideHint();
  }
});
function erase(p) {
  for (const arr of [world.sugar, world.lemon]) {
    const k = arr.findIndex(s => Math.hypot(s.x - p.x, s.y - p.y) < 26);
    if (k >= 0) { arr.splice(k, 1); return; }
  }
  const k = world.walls.findIndex(s => segDist(p.x, p.y, s).d < 16);
  if (k >= 0) world.walls.splice(k, 1);
}
function hideHint() { if (!placed) { placed = true; } $('#hint').style.opacity = 0; }

// ---------- input: brain ----------
let hover = -1;
function nearestNeuron(e) {
  const r = brainC.getBoundingClientRect();
  const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
  let best = -1, bd = (12 * dpr) ** 2;
  for (let i = 0; i < B.n; i++) { const d2 = (B.px[i] - x) ** 2 + (B.py[i] - y) ** 2; if (d2 < bd) { bd = d2; best = i; } }
  return best;
}
const CLS = { central: 'interneuron', sensory: 'sensory neuron', descending: 'descending neuron (brain → body)', motor: 'motor neuron', ascending: 'ascending neuron (body → brain)' };
function showTip(i, e) {
  const tip = $('#tip');
  if (i < 0) { tip.hidden = true; return; }
  const d = B.d, side = { l: 'left', r: 'right' }[d.side[i]] || '';
  let name = d.type[i] || 'unnamed';
  if (name === 'CB0701') name = 'MN9 (CB0701)';
  const j = B.sensorOf[i];
  const what = j >= 0 ? ['sugar taste', 'sugar taste', 'bitter taste', 'bitter taste', 'antenna touch', 'antenna touch'][j] + ' sensor' : (CLS[d.cls[i]] || d.cls[i]);
  tip.innerHTML = `<b>${name}</b> · ${side}<br>${what}${d.nt[i] ? ' · ' + d.nt[i] : ''}<br>${B.trace[i].toFixed(0)} Hz${B.sil[i] ? ' · switched off' : ''}<br><span style="opacity:.6">FlyWire ${d.ids[i]}</span>`;
  tip.hidden = false;
  const r = brainC.getBoundingClientRect();
  const x = (B.px[i] / dpr), y = (B.py[i] / dpr);
  tip.style.left = Math.min(r.width - 190, Math.max(4, x + 10)) + 'px';
  tip.style.top = Math.max(4, y - 70) + 'px';
}
brainC.addEventListener('pointermove', e => { if (!B || e.pointerType !== 'mouse') return; hover = nearestNeuron(e); showTip(hover, e); });
brainC.addEventListener('pointerleave', () => { hover = -1; $('#tip').hidden = true; });
brainC.addEventListener('click', e => {
  if (!B) return;
  const i = nearestNeuron(e); if (i < 0) return;
  B.sil[i] ^= 1; hover = i; showTip(i, e);
  syncCutButtons();
});

// ---------- surgery ----------
function cutSet(k) {
  if (k === 'feed') return B.R.feed;
  if (k === 'sugar') return B.S.sugarL.concat(B.S.sugarR);
  if (k === 'bitter') return B.R.bitterL.concat(B.R.bitterR);
  return [];
}
document.querySelectorAll('[data-cut]').forEach(b => b.addEventListener('click', () => {
  if (!B) return;
  const k = b.dataset.cut;
  if (k === 'reset') { B.sil.fill(0); syncCutButtons(); return; }
  const set = cutSet(k), on = set.every(i => B.sil[i]);
  for (const i of set) B.sil[i] = on ? 0 : 1;
  syncCutButtons();
}));
function syncCutButtons() {
  document.querySelectorAll('[data-cut]').forEach(b => {
    const k = b.dataset.cut; if (k === 'reset') return;
    b.classList.toggle('cut', cutSet(k).every(i => B.sil[i]));
  });
}

// ---------- loop ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!document.hidden) {
    stepBody(dt);
    stepBrain(Math.round(dt * 1000 / DT), dt);
    drawArena(now);
    drawBrain();
    updateMeters();
  }
  requestAnimationFrame(loop);
}
})();
