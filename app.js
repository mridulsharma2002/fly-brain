// Fly Brain NPC: modes, UI and the main loop.
import { Wiring, Brain, DT, mutate } from './brain.js';
import { W, LEVELS, World, BrainFly, ScriptedFly, BT_NODES, segDist } from './world.js';
import { drawArena, BrainView } from './render.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const arenaC = $('#arena'), actx = arenaC.getContext('2d');
const small = matchMedia('(max-width: 700px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

const RACE_TO = 5, GEN_SECONDS = 30, SWARM = small ? 6 : 10;
const LEDES = {
  play: 'Drop sugar, lemons and walls, and watch it hunt. Then try some brain surgery.',
  race: 'Blue: a hand-written behaviour tree, the way most game NPCs work. Orange: the real brain. Same antennae, same senses. First to 5 sugars wins.',
  evolve: `${SWARM} flies, each wired a little differently. Every ${GEN_SECONDS} seconds the best sugar hunters survive and the rest are replaced by mutated copies of them.`,
};

let wiring, view, world = new World(), flies = [], focus = null, mode = 'play';
let mainBrain, scale = 1, timeScale = 1, simMs = 8, paused = false, raceClock = 0;
let evo = null, levels = [], levelIdx = 0;
const perf = { arena: 0, brain: 0, sim: 0 };

fetch('brain.json').then(r => r.json()).then(init).catch(e => { $('#firing').textContent = 'brain failed to load'; console.error(e); });

function init(d) {
  wiring = new Wiring(d);
  mainBrain = new Brain(wiring); mainBrain.record = true;
  view = new BrainView($('#brain'), wiring);
  try { pool = new Pool(d, Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))); } catch (e) { pool = null; }
  loadLevels();
  buildMeters(); buildBT();
  resize();
  const q = new URLSearchParams(location.hash.slice(1));
  const m = q.get('mode');
  setMode(['play', 'race', 'evolve'].includes(m) ? m : 'play');
  requestAnimationFrame(loop);
  window.__fly = { get world() { return world; }, get flies() { return flies; }, get focus() { return focus; }, wiring, setMode, get evo() { return evo; }, get timeScale() { return timeScale; }, setLevel, perf };
}

// ---------------- levels ----------------
function loadLevels() {
  levels = LEVELS.map(l => ({ ...l }));
  try { (JSON.parse(localStorage.getItem('flybrain.levels') || '[]')).forEach(l => levels.push({ ...l, mine: true })); } catch (e) { /* storage blocked */ }
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get('lv')) {
    try {
      const l = JSON.parse(decodeURIComponent(escape(atob(q.get('lv').replace(/-/g, '+').replace(/_/g, '/')))));
      if (Array.isArray(l.walls)) { levels.push({ ...l, name: l.name ? 'Shared: ' + String(l.name).slice(0, 30) : 'Shared level', walls: l.walls.slice(0, 60), sugar: (l.sugar || []).slice(0, 20), lemon: (l.lemon || []).slice(0, 20), start: l.start || [300, 400, -1.57] }); levelIdx = levels.length - 1; }
    } catch (e) { console.warn('bad level link'); }
  }
  fillLevelSelect();
}
function fillLevelSelect() {
  $('#level').innerHTML = levels.map((l, i) => `<option value="${i}">${l.mine ? '★ ' : ''}${escapeHtml(l.name)}</option>`).join('');
  $('#level').value = levelIdx;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function setLevel(i) { levelIdx = i; $('#level').value = i; setMode(mode); }
$('#level').addEventListener('change', e => setLevel(+e.target.value));

function encodeLevel(l) { return btoa(unescape(encodeURIComponent(JSON.stringify(l)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
$('#save').addEventListener('click', () => {
  const mine = levels.filter(l => l.mine);
  const l = world.toLevel(`My level ${mine.length + 1}`);
  l.mine = true; levels.push(l); levelIdx = levels.length - 1;
  try { localStorage.setItem('flybrain.levels', JSON.stringify(levels.filter(x => x.mine).map(({ mine, ...x }) => x))); } catch (e) { /* ignore */ }
  fillLevelSelect(); flash(`Saved as "${l.name}". Pick it in Race or Evolve too.`);
});
$('#share').addEventListener('click', async () => {
  const l = world.toLevel(levels[levelIdx].name);
  const url = `${location.origin}${location.pathname}#lv=${encodeLevel(l)}`;
  history.replaceState(null, '', `#lv=${encodeLevel(l)}`);
  try { await navigator.clipboard.writeText(url); flash('Link copied. Anyone who opens it gets this level.'); }
  catch (e) { flash('Link is in the address bar. Copy it from there.'); }
});
$('#clear').addEventListener('click', () => { world.sugar.length = 0; world.lemon.length = 0; world.walls.length = 0; });


// ---------------- worker pool for the swarm ----------------
class RemoteBrain { // what the main thread knows about a brain living in a worker
  constructor(wiring) { const n = wiring.n; this.W = wiring; this.rates = new Float32Array(6); this.sil = new Uint8Array(n); this.trace = new Float32Array(n); this.flash = new Float32Array(n); this.fired = []; this.active = 0; this.remote = true; }
  activeCount() { return this.active; }
}
class Pool {
  constructor(d, k) {
    this.ws = []; this.gen = 0; this.busy = 0; this.acc = 0; this.speed = 1;
    for (let i = 0; i < k; i++) {
      const w = new Worker('worker.js', { type: 'module' });
      w.onmessage = e => this.receive(e.data);
      w.onerror = () => { this.failed = true; };
      w.postMessage({ type: 'init', d });
      this.ws.push(w);
    }
  }
  set(flies) {
    this.gen++; this.busy = 0; this.acc = 0; this.flies = flies = flies.filter(f => f.brain && f.brain.remote); this.byId = new Map();
    const parts = this.ws.map(() => []);
    flies.forEach((f, k) => { f.id = k; this.byId.set(k, f); parts[k % this.ws.length].push({ id: k, w: f.gene ? f.gene.w : null }); });
    this.ws.forEach((w, i) => w.postMessage({ type: 'set', brains: parts[i] }));
  }
  tick(dt, focusId) {
    this.acc += dt;
    if (this.busy) { if (this.acc > 0.12) { this.acc = 0.12; this.lagging = true; } return; }
    const bdt = Math.min(this.acc, 0.12); this.acc = 0;
    if (bdt <= 0) return;
    const steps = Math.max(1, Math.round(bdt * 1000 / DT));
    this.sent = { bdt, t0: performance.now() };
    this.ws.forEach((w, i) => {
      const items = this.flies.filter((f, k) => k % this.ws.length === i).map(f => ({ id: f.id, rates: f.brain.rates.slice(), sil: f.id === focusId ? f.brain.sil.slice() : null }));
      w.postMessage({ type: 'step', gen: this.gen, steps, dt: bdt, focus: focusId, items });
    });
    this.busy = this.ws.length;
  }
  receive(m) {
    if (m.gen !== this.gen) return;
    for (const o of m.out) {
      const f = this.byId.get(o.id); if (!f) continue;
      f.out = o; f.brain.active = o.active;
      if (o.trace) { f.brain.trace.set(o.trace); f.brain.flash.set(o.flash); f.brain.fired = o.fired; }
    }
    this.maxMs = Math.max(this.maxMs || 0, m.ms);
    if (--this.busy === 0 && this.sent) {
      // can the workers compute brain time as fast as it passes? if not, slow the world down
      const need = this.maxMs / 1000, have = this.sent.bdt * 0.8;
      this.speed += (Math.min(1, have / Math.max(need, 1e-4)) - this.speed) * 0.2;
      this.maxMs = 0;
    }
  }
}
let pool = null;

// ---------------- modes ----------------
$$('.mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#restart').addEventListener('click', () => setMode(mode));

const useWorkers = () => pool && !pool.failed;
function makeBrainFly(brain, x, y, th) { const f = new BrainFly(x, y, th, brain || (useWorkers() ? new RemoteBrain(wiring) : mainBrain)); f.kind = 'brain'; return f; }

function setMode(m) {
  mode = m; document.body.dataset.mode = m;
  $$('.mode').forEach(b => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#modeLede').textContent = LEDES[m];
  $('#banner').hidden = true; paused = false; raceClock = 0;
  const lv = levels[levelIdx];
  world = new World(); world.load(lv);
  const [sx, sy, sth] = lv.start;
  mainBrain.reset();
  if (m === 'play') {
    world.keepSugar = 0;
    const f = makeBrainFly(null, sx, sy, sth);
    flies = [f]; setFocus(f); if (useWorkers()) pool.set(flies); $('#eaten').textContent = '0';
    setHint(toolHints[tool]);
  } else if (m === 'race') {
    world.keepSugar = 1; world.sugar = [];
    const ox = Math.cos(sth + Math.PI / 2) * 16, oy = Math.sin(sth + Math.PI / 2) * 16;
    const b = makeBrainFly(null, sx - ox, sy - oy, sth); b.tag = 'Brain'; b.score = 0;
    const s = new ScriptedFly(sx + ox, sy + oy, sth); s.kind = 'script'; s.tag = 'Script'; s.score = 0;
    flies = [b, s]; setFocus(b); world.topUp(flies); if (useWorkers()) pool.set(flies); setHint('');
  } else {
    world.sugar = []; world.keepSugar = 6; world.topUp([]);
    evo = { gen: 1, t: 0, history: [], pop: [] };
    for (let k = 0; k < SWARM; k++) evo.pop.push({ w: k === 0 ? wiring.w : mutate(wiring.w), hue: Math.round(k * 360 / SWARM), parent: k === 0 ? 'original wiring' : 'mutant of the original' });
    spawnGeneration();
    setHint('Tap a fly to watch its brain');
  }
  view.hover = -1; $('#tip').hidden = true;
  syncCutButtons(); updateTitle();
}

function spawnGeneration() {
  const lv = levels[levelIdx], [sx, sy] = lv.start;
  const remote = useWorkers();
  flies = evo.pop.map((g, k) => {
    const br = remote ? new RemoteBrain(wiring) : new Brain(wiring, g.w);
    const a = (k / evo.pop.length) * Math.PI * 2;
    const f = makeBrainFly(br, sx + Math.cos(a) * 18, sy + Math.sin(a) * 18, a);
    f.hue = g.hue; f.gene = g; return f;
  });
  world.sugar = []; world.topUp(flies);
  if (remote) pool.set(flies);
  setFocus(flies[0]);
}
function nextGeneration() {
  const ranked = [...flies].sort((a, b) => b.eaten - a.eaten);
  const best = ranked[0].eaten, avg = flies.reduce((s, f) => s + f.eaten, 0) / flies.length;
  evo.history.push({ best, avg });
  const E = Math.max(2, Math.ceil(flies.length * 0.3));
  const elites = ranked.slice(0, E);
  const pop = elites.map(f => ({ w: f.gene.w, hue: f.gene.hue, parent: `survivor, ate ${f.eaten.toFixed(1)}` }));
  for (let k = 0; pop.length < flies.length; k++) {
    const p = elites[k % E];
    pop.push({ w: mutate(p.gene.w), hue: (p.gene.hue + 8 + Math.random() * 10) % 360, parent: `child of a fly that ate ${p.eaten.toFixed(1)}` });
  }
  evo.pop = pop; evo.gen++; evo.t = 0;
  spawnGeneration();
  drawSpark();
}
function setFocus(f) {
  if (focus && focus.brain && focus.brain !== mainBrain) focus.brain.record = false;
  focus = f; if (f.brain) f.brain.record = true;
  updateTitle(); syncCutButtons();
}
function updateTitle() {
  if (mode === 'evolve' && focus) $('#brainTitle').textContent = `FLY ${flies.indexOf(focus) + 1} · ${focus.gene.parent.toUpperCase()}`;
  else $('#brainTitle').textContent = 'LIVE BRAIN';
}

// ---------------- tools / arena input ----------------
let tool = 'sugar', drag = null;
const toolHints = { sugar: 'Tap to drop sugar', lemon: 'Tap to drop a lemon', wall: 'Drag to draw a wall', erase: 'Tap something to remove it' };
$$('.tool').forEach(b => b.addEventListener('click', () => {
  $$('.tool').forEach(x => x.classList.toggle('on', x === b));
  tool = b.dataset.tool; setHint(toolHints[tool]);
}));
function setHint(t) { const h = $('#hint'); h.textContent = t; h.style.opacity = t ? 1 : 0; }
let flashT = 0;
function flash(t) { setHint(t); clearTimeout(flashT); flashT = setTimeout(() => setHint(''), 2600); }
function arenaPt(e) { const r = arenaC.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * W }; }
arenaC.addEventListener('pointerdown', e => {
  const p = arenaPt(e);
  if (mode === 'evolve') {
    let best = null, bd = 40;
    for (const f of flies) { const d = Math.hypot(f.x - p.x, f.y - p.y); if (d < bd) { bd = d; best = f; } }
    if (best) setFocus(best);
    return;
  }
  if (mode !== 'play') return;
  arenaC.setPointerCapture(e.pointerId);
  if (tool === 'wall') { drag = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }; return; }
  if (tool === 'sugar') { if (world.sugar.length >= 12) world.sugar.shift(); world.sugar.push({ x: p.x, y: p.y, a: 1 }); }
  if (tool === 'lemon') { if (world.lemon.length >= 12) world.lemon.shift(); world.lemon.push({ x: p.x, y: p.y }); }
  if (tool === 'erase') erase(p);
  setHint('');
});
arenaC.addEventListener('pointermove', e => { if (drag) { const p = arenaPt(e); drag.x2 = p.x; drag.y2 = p.y; } });
arenaC.addEventListener('pointerup', () => {
  if (!drag) return;
  if (Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1) > 12) { if (world.walls.length >= 40) world.walls.shift(); world.walls.push(drag); }
  drag = null; setHint('');
});
function erase(p) {
  for (const arr of [world.sugar, world.lemon]) {
    const k = arr.findIndex(s => Math.hypot(s.x - p.x, s.y - p.y) < 26);
    if (k >= 0) { arr.splice(k, 1); return; }
  }
  const k = world.walls.findIndex(s => segDist(p.x, p.y, s).d < 16);
  if (k >= 0) world.walls.splice(k, 1);
}

// ---------------- brain panel input ----------------
$$('.segb').forEach(b => b.addEventListener('click', () => {
  $$('.segb').forEach(x => x.classList.toggle('on', x === b));
  view.mode = b.dataset.view;
  $('#brainCap').textContent = view.mode === '3d'
    ? 'Grey is the whole fly brain (139k neurons) at its real shape. Bright dots are the 867 this game runs, at their real positions. Drag to turn it, tap a dot to switch it off.'
    : 'Seen from behind, so the fly\'s left is on the left. Grey is the whole brain (139k neurons). Dots are the ones this game runs. Tap a dot to switch it off.';
}));
const brainC = $('#brain');
let bdrag = null;
brainC.addEventListener('pointerdown', e => { bdrag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false }; });
brainC.addEventListener('pointermove', e => {
  if (bdrag && view.mode === '3d') {
    const dx = e.clientX - bdrag.x, dy = e.clientY - bdrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) { bdrag.moved = true; view.dragging = true; }
    if (bdrag.moved) { view.yaw = bdrag.yaw + dx * 0.01; view.pitch = Math.max(-1.2, Math.min(1.2, bdrag.pitch + dy * 0.008)); }
  }
  if (e.pointerType === 'mouse' && wiring && !(bdrag && bdrag.moved)) { view.hover = view.nearest(e.clientX, e.clientY); showTip(view.hover); }
});
const endDrag = e => {
  if (bdrag && !bdrag.moved && e.type === 'pointerup' && focus && focus.brain) {
    const i = view.nearest(e.clientX, e.clientY);
    if (i >= 0) { focus.brain.sil[i] ^= 1; view.hover = i; showTip(i); syncCutButtons(); }
  }
  bdrag = null; view.dragging = false;
};
brainC.addEventListener('pointerup', endDrag);
brainC.addEventListener('pointercancel', endDrag);
brainC.addEventListener('pointerleave', () => { view.hover = -1; $('#tip').hidden = true; });

const CLS = { central: 'interneuron', sensory: 'sensory neuron', descending: 'descending neuron (brain → body)', motor: 'motor neuron', ascending: 'ascending neuron (body → brain)' };
function showTip(i) {
  const tip = $('#tip');
  if (i < 0 || !focus || !focus.brain) { tip.hidden = true; return; }
  const d = wiring.d, side = { l: 'left', r: 'right' }[d.side[i]] || '';
  let name = d.type[i] || 'unnamed';
  if (name === 'CB0701') name = 'MN9 (CB0701)';
  const j = wiring.sensorOf[i];
  const what = j >= 0 ? ['sugar taste', 'sugar taste', 'bitter taste', 'bitter taste', 'antenna touch', 'antenna touch'][j] + ' sensor' : (CLS[d.cls[i]] || d.cls[i]);
  const b = focus.brain;
  tip.innerHTML = `<b>${escapeHtml(name)}</b> · ${side}<br>${escapeHtml(what)}${d.nt[i] ? ' · ' + escapeHtml(d.nt[i]) : ''}<br>${b.trace[i].toFixed(0)} Hz${b.sil[i] ? ' · switched off' : ''}<br><span style="opacity:.6">FlyWire ${d.ids[i]}</span>`;
  tip.hidden = false;
  const r = brainC.getBoundingClientRect();
  tip.style.left = Math.min(r.width - 190, Math.max(4, view.px[i] / view.dpr + 10)) + 'px';
  tip.style.top = Math.max(4, view.py[i] / view.dpr - 70) + 'px';
}

// ---------------- surgery ----------------
function cutSet(k) {
  if (k === 'feed') return wiring.R.feed;
  if (k === 'sugar') return wiring.S[0].concat(wiring.S[1]);
  if (k === 'bitter') return wiring.R.bitterL.concat(wiring.R.bitterR);
  return [];
}
$$('[data-cut]').forEach(b => b.addEventListener('click', () => {
  if (!focus || !focus.brain) return;
  const k = b.dataset.cut, sil = focus.brain.sil;
  if (k === 'reset') sil.fill(0);
  else { const set = cutSet(k), on = set.every(i => sil[i]); for (const i of set) sil[i] = on ? 0 : 1; }
  syncCutButtons();
}));
function syncCutButtons() {
  $$('[data-cut]').forEach(b => {
    const k = b.dataset.cut; if (k === 'reset') return;
    b.classList.toggle('cut', !!(focus && focus.brain) && cutSet(k).every(i => focus.brain.sil[i]));
  });
}

// ---------------- meters, behaviour tree, sparkline ----------------
const METERS = [
  { name: 'Sugar side', sub: '106 output neurons', l: 'tasteL', r: 'tasteR', col: '#ffb547', k: 3 },
  { name: 'Bitter alarm', sub: 'DNp42 · DNge067', l: 'bitL', r: 'bitR', col: '#c6e05a' },
  { name: 'Touch', sub: 'DNg35 · DNg84', l: 'touL', r: 'touR', col: '#7fb2ff' },
  { name: 'Feeding', sub: 'MN9 motor neuron', one: 'feed', col: '#ff7a66' },
];
function buildMeters() {
  $('#meters').innerHTML = METERS.map((m, k) => m.one
    ? `<div class="meter single"><div class="nm">${m.name}<small>${m.sub}</small></div><div class="bar"><i id="m${k}" style="background:${m.col}"></i></div></div>`
    : `<div class="meter"><div class="nm">${m.name}<small>${m.sub}</small></div><div class="bar l" title="left"><i id="m${k}l" style="background:${m.col}"></i></div><div class="bar" title="right"><i id="m${k}r" style="background:${m.col}"></i></div></div>`).join('');
}
function buildBT() {
  $('#bt').innerHTML = '<div class="h">BLUE NPC · BEHAVIOUR TREE (checked top to bottom)</div>' +
    BT_NODES.map(n => `<div class="node" data-n="${n.id}"><i></i><span>${n.cond}</span><span>${n.act}</span></div>`).join('');
}
let uiT = 0;
function updateUI(dt) {
  uiT += dt; if (uiT < 0.1) return; uiT = 0;
  const L = focus && focus.levels;
  if (L) {
    const pct = v => Math.min(100, Math.max(0, v * 100)).toFixed(1) + '%';
    METERS.forEach((m, k) => {
      if (m.one) $('#m' + k).style.width = pct((L[m.one] || 0) / 1.2);
      else { const g = m.k || 1; $('#m' + k + 'l').style.width = pct((L[m.l] || 0) * g); $('#m' + k + 'r').style.width = pct((L[m.r] || 0) * g); }
    });
  }
  if (focus && focus.brain) $('#firing').textContent = `${focus.brain.activeCount()} firing`;
  const slow = timeScale < 0.95 ? ` · ${timeScale.toFixed(1)}× speed` : '';
  if (mode === 'play') { $('#eaten').textContent = focus.eaten.toFixed(1); $('#state').textContent = focus.state + slow; }
  if (mode === 'race') {
    const [b, s] = flies;
    $('#sBrain').textContent = b.score; $('#sScript').textContent = s.score; $('#clock').textContent = raceClock.toFixed(1) + ' s';
    $('#state').textContent = slow.replace(' · ', '');
    $$('#bt .node').forEach(el => el.classList.toggle('on', el.dataset.n === s.node));
  }
  if (mode === 'evolve') {
    $('#gen').textContent = evo.gen; $('#genClock').textContent = `${Math.max(0, GEN_SECONDS - evo.t).toFixed(0)} s left`;
    const lead = flies.reduce((a, f) => f.eaten > a.eaten ? f : a, flies[0]);
    $('#best').textContent = lead.eaten.toFixed(1);
    $('#state').textContent = slow.replace(' · ', '');
    const h = evo.history, first = h[0], last = h[h.length - 1];
    $('#evoNote').innerHTML = h.length
      ? `Best per generation: <b>${h.map(x => x.best.toFixed(1)).slice(-8).join(' → ')}</b>. Average went from <b>${first.avg.toFixed(2)}</b> to <b>${last.avg.toFixed(2)}</b>. Tap any fly to see its brain.`
      : 'Generation 1: one fly has the original wiring, the rest are mutants. Tap any fly to see its brain.';
  }
}
function drawSpark() {
  const c = $('#spark'), dpr = Math.min(2, devicePixelRatio || 1), r = c.getBoundingClientRect();
  if (!r.width) return;
  c.width = r.width * dpr; c.height = r.height * dpr;
  const x = c.getContext('2d'), h = evo ? evo.history : [];
  x.clearRect(0, 0, c.width, c.height);
  if (h.length < 1) return;
  const max = Math.max(1, ...h.map(p => p.best)), n = Math.max(2, h.length);
  const P = (i, v) => [8 * dpr + i / (n - 1) * (c.width - 16 * dpr), c.height - 6 * dpr - v / max * (c.height - 12 * dpr)];
  for (const [key, col] of [['avg', '#8c8c92'], ['best', '#ffb547']]) {
    x.strokeStyle = col; x.lineWidth = 1.6 * dpr; x.beginPath();
    h.forEach((p, i) => { const [a, b] = P(i, p[key]); i ? x.lineTo(a, b) : x.moveTo(a, b); });
    x.stroke();
    const [a, b] = P(h.length - 1, h[h.length - 1][key]); x.fillStyle = col; x.beginPath(); x.arc(a, b, 2.5 * dpr, 0, 7); x.fill();
  }
}

// ---------------- loop ----------------
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), r = arenaC.getBoundingClientRect();
  arenaC.width = Math.round(r.width * dpr); arenaC.height = Math.round(r.width * dpr);
  scale = arenaC.width / W;
  if (view) view.resize();
  if (evo) drawSpark();
}
window.addEventListener('resize', () => { clearTimeout(resize.t); resize.t = setTimeout(resize, 120); });

function simulate(dt) {
  const steps = Math.max(1, Math.round(dt * 1000 / DT));
  const t0 = performance.now();
  if (useWorkers() && flies.some(f => f.brain && f.brain.remote)) {
    for (const f of flies) if (f.kind === 'brain') f.drive(world);
    pool.tick(dt, focus ? focus.id : -1);
    for (const f of flies) if (f.kind === 'brain') f.act(world, dt); else f.update(world, dt);
  } else for (const f of flies) {
    if (f.kind === 'brain') f.update(world, dt, steps); else f.update(world, dt);
  }
  const ms = performance.now() - t0;
  simMs += (ms / Math.max(timeScale, 0.1) - simMs) * 0.1; // cost of one real-time second slice
  if (mode !== 'play') world.topUp(flies);
}
function adapt() {
  // keep frames smooth: if brains cost too much, slow the whole world down evenly
  const budget = small ? 9 : 11;
  let target = Math.max(0.3, Math.min(1, budget / Math.max(simMs, 0.1)));
  if (useWorkers() && flies.some(f => f.brain && f.brain.remote)) target = Math.max(0.3, Math.min(1, pool.speed));
  timeScale += (target - timeScale) * 0.05;
}

let last = performance.now();
function loop(now) {
  const real = Math.min(0.05, (now - last) / 1000); last = now;
  if (!document.hidden && wiring) {
    const dt = real * timeScale;
    if (!paused) {
      simulate(dt);
      adapt();
      if (mode === 'race') raceStep(dt);
      if (mode === 'evolve') { evo.t += dt; if (evo.t >= GEN_SECONDS) nextGeneration(); }
    }
    const t1 = performance.now();
    drawArena(actx, scale, world, flies, { time: now, drag, focus, labels: mode === 'race' });
    const t2 = performance.now();
    view.draw(focus && focus.brain, real);
    const t3 = performance.now();
    updateUI(real);
    perf.arena += (t2 - t1 - perf.arena) * 0.05; perf.brain += (t3 - t2 - perf.brain) * 0.05; perf.sim = simMs;
  }
  requestAnimationFrame(loop);
}

function raceStep(dt) {
  raceClock += dt;
  const [b, s] = flies;
  const win = b.score >= RACE_TO ? b : s.score >= RACE_TO ? s : null;
  const timeUp = raceClock >= 120;
  if (!win && !timeUp) return;
  paused = true;
  const ban = $('#banner'); ban.hidden = false;
  if (win) ban.innerHTML = `<b>${win === b ? 'The real brain' : 'The scripted NPC'} wins</b>, ${b.score}–${s.score} in ${raceClock.toFixed(1)} s.<br>Try another level or switch off a neuron, then hit Restart.`;
  else ban.innerHTML = `<b>Time's up</b>: Brain ${b.score}, Script ${s.score}. ${b.score === s.score ? 'A draw.' : (b.score > s.score ? 'The brain wins.' : 'The script wins.')}<br>Hit Restart for a rematch.`;
}
