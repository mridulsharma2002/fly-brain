// Arena, levels, and the two kinds of fly: one driven by the brain,
// one driven by a hand-written behaviour tree (a classic game NPC).
import { MAX_RATE } from './brain.js';

export const W = 600;
export const WALL_W = 10;
const SUGAR_LAMBDA = 80, LEMON_SIGMA = 48;

export const LEVELS = [
  { name: 'Open field', walls: [], sugar: [[470, 150]], lemon: [[160, 190]], start: [300, 400, -1.57] },
  { name: 'The wall', walls: [[150, 300, 450, 300]], sugar: [[300, 130]], lemon: [], start: [300, 480, -1.57] },
  { name: 'Zig-zag', walls: [[0, 210, 400, 210], [200, 400, 600, 400]], sugar: [[500, 100]], lemon: [], start: [90, 520, -1.57] },
  { name: 'Lemon gate', walls: [[0, 300, 150, 300], [450, 300, 600, 300]], sugar: [[300, 120]], lemon: [[230, 300], [370, 300]], start: [300, 500, -1.57] },
  { name: 'Maze', walls: [[200, 0, 200, 390], [400, 210, 400, 600], [200, 390, 290, 390], [310, 210, 400, 210]], sugar: [[510, 90]], lemon: [[300, 520]], start: [90, 520, -1.57] },
];

export function segDist(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy || 1;
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / L; t = Math.max(0, Math.min(1, t));
  const cx = s.x1 + t * dx, cy = s.y1 + t * dy;
  return { d: Math.hypot(px - cx, py - cy), cx, cy };
}

export class World {
  constructor() { this.sugar = []; this.lemon = []; this.walls = []; this.respawn = false; this.keepSugar = 0; }
  load(lv) {
    this.walls = lv.walls.map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
    this.sugar = lv.sugar.map(([x, y]) => ({ x, y, a: 1 }));
    this.lemon = lv.lemon.map(([x, y]) => ({ x, y }));
    this.start = lv.start;
  }
  toLevel(name) {
    const r = v => Math.round(v);
    return { name, walls: this.walls.map(s => [r(s.x1), r(s.y1), r(s.x2), r(s.y2)]),
      sugar: this.sugar.map(s => [r(s.x), r(s.y)]), lemon: this.lemon.map(s => [r(s.x), r(s.y)]),
      start: this.start || [300, 400, -1.57] };
  }
  sugarAt(x, y) {
    let c = 0;
    for (const s of this.sugar) c += s.a * Math.exp(-Math.hypot(x - s.x, y - s.y) / SUGAR_LAMBDA);
    return c;
  }
  lemonAt(x, y) {
    let c = 0;
    for (const s of this.lemon) { const d2 = (x - s.x) ** 2 + (y - s.y) ** 2; c += Math.exp(-d2 / (2 * LEMON_SIGMA ** 2)); }
    return Math.min(1, c * 1.3);
  }
  touching(x, y) {
    if (x < 6 || y < 6 || x > W - 6 || y > W - 6) return 1;
    for (const s of this.walls) if (segDist(x, y, s).d < WALL_W / 2 + 3) return 1;
    return 0;
  }
  freeSpot(avoid = []) {
    for (let k = 0; k < 300; k++) {
      const x = 40 + Math.random() * (W - 80), y = 40 + Math.random() * (W - 80);
      if (this.walls.some(s => segDist(x, y, s).d < 30)) continue;
      if (this.lemon.some(s => Math.hypot(s.x - x, s.y - y) < 70)) continue;
      if (avoid.some(p => Math.hypot(p.x - x, p.y - y) < 130)) continue;
      if (avoid.length && k < 250 && !avoid.some(p => Math.hypot(p.x - x, p.y - y) < 320)) continue; // keep it within smelling range
      return { x, y };
    }
    return { x: W / 2, y: W / 2 };
  }
  topUp(flies) {
    while (this.keepSugar && this.sugar.length < this.keepSugar) {
      const p = this.freeSpot(flies);
      this.sugar.push({ x: p.x, y: p.y, a: 1 });
    }
  }
}

// Weber-style receptor: firing grows with the log of concentration, so the
// left-right difference stays readable both far away and up close.
const receptor = c => c <= 0 ? 0 : Math.max(0, Math.min(MAX_RATE, MAX_RATE + 30 * Math.log(c)));

class Body {
  constructor(x, y, th) {
    Object.assign(this, { x, y, th, v: 0, phase: Math.random() * 6, back: 0, cool: 0, eating: false, eaten: 0, state: 'Wandering', inputs: {} });
  }
  antenna(side) { const a = this.th + side * 1.0; return { x: this.x + Math.cos(a) * 22, y: this.y + Math.sin(a) * 22 }; }
  sense(world) {
    const aL = this.antenna(-1), aR = this.antenna(1);
    return this.inputs = {
      sl: world.sugarAt(aL.x, aL.y), sr: world.sugarAt(aR.x, aR.y),
      ll: world.lemonAt(aL.x, aL.y), lr: world.lemonAt(aR.x, aR.y),
      tl: world.touching(aL.x, aL.y), tr: world.touching(aR.x, aR.y),
    };
  }
  mouthSugar(world) {
    const mx = this.x + Math.cos(this.th) * 15, my = this.y + Math.sin(this.th) * 15;
    for (const s of world.sugar) if (Math.hypot(mx - s.x, my - s.y) < 8 + 10 * s.a + 4) return s;
    return null;
  }
  eat(world, s, dt) {
    const bite = Math.min(s.a, dt * 0.4);
    s.a -= bite; this.eaten += bite;
    if (s.a <= 0.05) { this.eaten += s.a; world.sugar.splice(world.sugar.indexOf(s), 1); if (this.score != null) this.score++; return true; }
    return false;
  }
  move(world, turnLeft, speed, dt) {
    this.th -= turnLeft * dt;
    this.v += (speed - this.v) * Math.min(1, dt * 6);
    let nx = this.x + Math.cos(this.th) * this.v * dt, ny = this.y + Math.sin(this.th) * this.v * dt;
    const R0 = 11;
    nx = Math.max(R0, Math.min(W - R0, nx)); ny = Math.max(R0, Math.min(W - R0, ny));
    for (const s of world.walls) {
      const q = segDist(nx, ny, s);
      if (q.d < R0 + WALL_W / 2) { const k = (R0 + WALL_W / 2 - q.d) / (q.d || 1); nx += (nx - q.cx) * k; ny += (ny - q.cy) * k; }
    }
    this.x = nx; this.y = ny;
    this.phase += Math.abs(this.v) * dt * 0.5;
  }
}

// ---- the brain-driven fly. Every input to think() is a neuron's firing rate. ----
export class BrainFly extends Body {
  constructor(x, y, th, brain) { super(x, y, th); this.brain = brain; this.noise = 0; this.trend = 0; this.lastTot = null; this.levels = {}; this.out = null; }
  // senses -> sensor firing rates (Hz) for the brain
  drive(world) {
    const inp = this.sense(world), r = this.brain.rates;
    r[0] = receptor(inp.sl); r[1] = receptor(inp.sr);
    r[2] = MAX_RATE * inp.ll; r[3] = MAX_RATE * inp.lr; r[4] = MAX_RATE * inp.tl; r[5] = MAX_RATE * inp.tr;
  }
  readBrain() {
    const B = this.brain, t = B.decode();
    return { side: t.side, total: t.total, bitL: B.level('bitterL'), bitR: B.level('bitterR'), touL: B.level('touchL'), touR: B.level('touchR'), feed: B.level('feed') };
  }
  update(world, dt, steps) { // brain on this thread
    this.drive(world);
    this.brain.step(steps, dt);
    this.out = this.readBrain();
    this.act(world, dt);
  }
  // brain outputs -> body. Every input here is a neuron firing rate.
  act(world, dt) {
    const o = this.out; if (!o) { this.move(world, 0, 0, dt); return; }
    const taste = { side: o.side, total: o.total }, { bitL, bitR, touL, touR, feed } = o;
    this.levels = { tasteL: Math.max(0, taste.side), tasteR: Math.max(0, -taste.side), bitL, bitR, touL, touR, feed };

    let turnLeft = 16 * taste.side + 4.0 * (bitR - bitL) + 3.2 * (touR - touL);
    const smell = Math.min(1, taste.total);
    // brain's sugar response falling? we're walking away from food: turn harder
    this.trend += (((taste.total - (this.lastTot ?? taste.total)) / Math.max(dt, 1e-3)) - this.trend) * Math.min(1, dt * 3);
    this.lastTot = taste.total;
    const losing = smell > 0.05 && this.trend < -0.02;
    if (losing) turnLeft += 3.2 * (taste.side >= 0 ? 1 : -1);
    this.noise += (-this.noise * 1.2 + (Math.random() - 0.5) * 9) * dt;
    turnLeft += this.noise * (smell > 0.15 ? 0.25 : 1);

    const onSugar = this.mouthSugar(world);
    this.cool = Math.max(0, this.cool - dt);
    const alarm = Math.max(bitL + bitR, touL + touR);
    if (this.back <= 0 && this.cool <= 0 && alarm > 0.5) { this.back = 0.55; this.cool = 0.9; }
    let speed; this.eating = false;
    if (this.back > 0) {
      this.back -= dt; speed = -48;
      this.state = (bitL + bitR) > (touL + touR) ? 'Backing away from the lemon' : 'Bumped something, backing up';
    } else if (onSugar && feed > 0.3) {
      this.eating = true; speed = 0; turnLeft *= 0.1; this.state = 'Eating (MN9 is firing)';
      this.eat(world, onSugar, dt);
    } else {
      speed = smell > 0.15 ? 62 * (1 - Math.min(0.75, Math.abs(taste.side) * 4)) * (losing ? 0.5 : 1) : 52;
      const B = this.brain, cut = B.sil && B.sil[B.W.R.feed[0]] && B.sil[B.W.R.feed[1]];
      if (onSugar) { speed = 8; this.state = cut ? 'On sugar, but it can\'t eat' : 'Tasting sugar'; }
      else if (smell > 0.15) this.state = taste.side > 0.06 ? 'Sugar is to the left' : taste.side < -0.06 ? 'Sugar is to the right' : 'Heading for sugar';
      else this.state = 'Wandering';
    }
    this.move(world, turnLeft, speed, dt);
  }
}

// ---- the scripted NPC: a behaviour tree, same senses, rules written by hand ----
export const BT_NODES = [
  { id: 'bump', cond: 'Bumped a wall?', act: 'Back up, turn 90°' },
  { id: 'lemon', cond: 'Smell a lemon?', act: 'Turn away from it' },
  { id: 'eat', cond: 'On sugar?', act: 'Eat' },
  { id: 'seek', cond: 'Smell sugar?', act: 'Turn to the stronger side' },
  { id: 'wander', cond: 'Otherwise', act: 'Wander' },
];
export class ScriptedFly extends Body {
  constructor(x, y, th) { super(x, y, th); this.node = 'wander'; this.turnDir = 1; this.wander = 0; }
  update(world, dt) {
    const s = this.sense(world);
    let turnLeft = 0, speed = 55; this.eating = false;
    this.cool = Math.max(0, this.cool - dt);
    if (this.back > 0) { // still running the bump action
      this.back -= dt; speed = -45; turnLeft = 2.6 * this.turnDir; this.node = 'bump';
    } else if ((s.tl || s.tr) && this.cool <= 0) {
      this.back = 0.6; this.cool = 1; this.turnDir = s.tl && !s.tr ? -1 : s.tr && !s.tl ? 1 : (Math.random() < 0.5 ? 1 : -1);
      this.node = 'bump'; speed = -45;
    } else if (s.ll + s.lr > 0.25) {
      this.node = 'lemon'; turnLeft = s.ll > s.lr ? -3 : 3; speed = 35;
    } else if (this.mouthSugar(world)) {
      this.node = 'eat'; speed = 0; this.eating = true; this.eat(world, this.mouthSugar(world), dt);
    } else if (s.sl + s.sr > 0.02) {
      // classic NPC rule: if one side is clearly stronger, turn that way at a fixed rate
      this.node = 'seek'; const ratio = (s.sl + 1e-6) / (s.sr + 1e-6);
      turnLeft = ratio > 1.15 ? 2.2 : ratio < 1 / 1.15 ? -2.2 : 0; speed = 58;
    } else {
      this.node = 'wander'; this.wander += (Math.random() - 0.5) * 8 * dt; this.wander *= 0.98; turnLeft = this.wander;
    }
    this.state = BT_NODES.find(n => n.id === this.node).act;
    this.move(world, turnLeft, speed, dt);
  }
}
