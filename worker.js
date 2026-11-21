// Runs a share of the swarm's brains off the main thread.
import { Wiring, Brain } from './brain.js';
let wiring = null, brains = new Map();
onmessage = e => {
  const m = e.data;
  if (m.type === 'init') { wiring = new Wiring(m.d); return; }
  if (m.type === 'set') {
    brains = new Map();
    for (const b of m.brains) brains.set(b.id, new Brain(wiring, b.w));
    return;
  }
  if (m.type === 'step') {
    const t0 = performance.now();
    const out = [];
    for (const it of m.items) {
      const b = brains.get(it.id); if (!b) continue;
      b.rates.set(it.rates);
      if (it.sil) b.sil.set(it.sil);
      b.record = it.id === m.focus;
      b.step(m.steps, m.dt);
      const t = b.decode();
      const o = { id: it.id, side: t.side, total: t.total, bitL: b.level('bitterL'), bitR: b.level('bitterR'),
        touL: b.level('touchL'), touR: b.level('touchR'), feed: b.level('feed'), active: b.activeCount() };
      if (b.record) { o.trace = b.trace.slice(); o.flash = b.flash.slice(); o.fired = b.fired.slice(); }
      out.push(o);
    }
    postMessage({ type: 'out', gen: m.gen, out, ms: performance.now() - t0 });
  }
};
