// Leaky integrate-and-fire model of a FlyWire sub-network.
// Equations and constants follow Shiu et al. 2024 (Nature), "A Drosophila
// computational brain model reveals sensorimotor processing".

export const DT = 0.2;            // ms per step (the paper uses 0.1; 0.2 behaves the same here and is 2x cheaper)
const V0 = -52, VTH = -45, VRST = -52;
const TMBR = 20, TAU = 5, TRFC = 2.2;
const DELAY = Math.round(1.8 / DT); // 1.8 ms synaptic delay, in steps
const WSYN = 0.275;               // mV per synapse
const POI_KICK = 68.75;           // mV per Poisson input spike (w_syn * 250)
export const MAX_RATE = 150;      // Hz, sensor drive at full strength
const TRACE_TAU = 0.25, SLOW_TAU = 0.5; // s, smoothing for firing-rate estimates

function b64(s, T) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new T(u.buffer);
}

// Shared wiring + metadata. One per page.
export class Wiring {
  constructor(d) {
    this.d = d;
    const n = this.n = d.n;
    this.ptr = b64(d.ptr, Int32Array);
    this.post = b64(d.post, Int16Array);
    const wi = b64(d.w, Int16Array);
    this.w = new Float32Array(wi.length);
    for (let k = 0; k < wi.length; k++) this.w[k] = wi[k] * WSYN;
    this.nEdges = wi.length;
    const find = (type, side) => {
      const out = [];
      for (let i = 0; i < n; i++) if (d.type[i] === type && (!side || d.side[i] === side)) out.push(i);
      return out;
    };
    // Readouts found by simulating the full 139k-neuron brain.
    this.R = {
      bitterL: find('DNp42', 'l').concat(find('DNge067', 'l')),
      bitterR: find('DNp42', 'r').concat(find('DNge067', 'r')),
      touchL: find('DNg35', 'l').concat(find('DNg84', 'l')),
      touchR: find('DNg35', 'r').concat(find('DNg84', 'r')),
      feed: find('CB0701'), // MN9, proboscis motor neuron
    };
    this.NORM = { bitterL: 50, bitterR: 24, touchL: 208, touchR: 202, feed: 100 };
    // Left vs right sugar is spread over ~100 output neurons: linear decoder
    // fitted on 440 simulated runs (held-out r = 0.95).
    this.decI = new Int32Array(d.decoder.map(p => p[0]));
    this.decW = new Float32Array(d.decoder.map(p => p[1]));
    this.decBias = d.decBias;
    // leftover bias when both sides taste the same, measured at each activity level
    this.biasT = [0, 0.009, 0.048, 0.141, 0.313, 0.515, 0.641, 0.865, 0.967, 1.115, 1.254, 1.426, 3];
    this.biasV = [0, 0.036, 0.132, 0.143, 0.088, 0.009, -0.001, -0.004, -0.008, 0.014, 0.038, 0.056, 0.056];
    this.S = [d.sensors.sugarL, d.sensors.sugarR, d.sensors.bitterL, d.sensors.bitterR, d.sensors.antL, d.sensors.antR];
    this.sensorOf = new Int8Array(n).fill(-1);
    this.S.forEach((g, j) => g.forEach(i => { this.sensorOf[i] = j; }));
    this.sensorList = new Int32Array(this.S.flat());
    this.isOut = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (d.role[i] === 'o') this.isOut[i] = 1;
    // strongest two targets per neuron (for drawing spike streaks)
    const top = this.top = new Int32Array(n * 2).fill(-1);
    for (let i = 0; i < n; i++) {
      let b1 = -1, b2 = -1, w1 = 0, w2 = 0;
      for (let k = this.ptr[i]; k < this.ptr[i + 1]; k++) {
        const a = Math.abs(this.w[k]);
        if (a > w1) { b2 = b1; w2 = w1; b1 = this.post[k]; w1 = a; } else if (a > w2) { b2 = this.post[k]; w2 = a; }
      }
      top[2 * i] = b1; top[2 * i + 1] = b2;
    }
  }
}

// One running brain. Can carry its own (mutated) weights.
export class Brain {
  constructor(wiring, weights = null) {
    const n = wiring.n;
    this.W = wiring;
    this.w = weights || wiring.w;
    this.v = new Float32Array(n).fill(V0);
    this.g = new Float32Array(n);
    this.rf = new Float32Array(n);
    this.trace = new Float32Array(n);
    this.slow = new Float32Array(n);
    this.flash = new Float32Array(n);
    this.sil = new Uint8Array(n);
    this.ring = new Int32Array(DELAY * n);
    this.ringC = new Int32Array(DELAY);
    this.t = 0;
    this.rates = new Float32Array(6);
    this.pr = new Float64Array(6);
    this.act = new Int32Array(n); this.inAct = new Uint8Array(n); this.na = 0;
    this.fired = [];       // spikes this frame (capped), for drawing
    this.record = false;
  }
  reset() {
    this.v.fill(V0); this.g.fill(0); this.rf.fill(0); this.trace.fill(0); this.slow.fill(0);
    this.flash.fill(0); this.ringC.fill(0); this.inAct.fill(0); this.na = 0;
  }
  step(steps, frameDt) {
    const { n, ptr, post, sensorOf, sensorList } = this.W;
    const { w, v, g, rf, sil, ring, ringC, trace, slow, flash, rates, act, inAct } = this;
    const pr = this.pr;
    for (let j = 0; j < 6; j++) pr[j] = rates[j] * DT / 1000;
    const fired = this.fired; fired.length = 0;
    const rec = this.record;
    const kt = 1 / TRACE_TAU, ks = 1 / SLOW_TAU;
    const a = DT / TMBR, b = DT / TAU;
    let na = this.na;
    // sensors with input are always awake
    for (let q = 0; q < sensorList.length; q++) {
      const i = sensorList[q];
      if (pr[sensorOf[i]] > 0 && !inAct[i]) { inAct[i] = 1; act[na++] = i; }
    }
    for (let s = 0; s < steps; s++) {
      const slot = this.t % DELAY, base = slot * n;
      const c = ringC[slot];
      for (let q = 0; q < c; q++) {
        const i = ring[base + q];
        for (let k = ptr[i]; k < ptr[i + 1]; k++) {
          const p = post[k];
          g[p] += w[k];
          if (!inAct[p]) { inAct[p] = 1; act[na++] = p; }
        }
      }
      let cnt = 0, keep = 0;
      for (let q = 0; q < na; q++) {
        const i = act[q];
        if (rf[i] > 0) { rf[i] -= DT; act[keep++] = i; continue; }
        const j = sensorOf[i];
        let vi = v[i], gi = g[i];
        if (sil[i]) { v[i] = V0; g[i] = 0; inAct[i] = 0; continue; }
        vi += a * (V0 - vi + gi);
        gi -= gi * b;
        if (j >= 0 && pr[j] > 0 && Math.random() < pr[j]) vi += POI_KICK;
        if (vi > VTH) {
          vi = VRST; gi = 0; rf[i] = j >= 0 ? 0 : TRFC;
          ring[base + cnt++] = i;
          trace[i] += kt; slow[i] += ks;
          if (rec) { flash[i] = 1; if (fired.length < 300) fired.push(i); }
        }
        v[i] = vi; g[i] = gi;
        // fall asleep once back at rest with no input
        if (gi < 1e-3 && gi > -1e-3 && vi - V0 < 1e-3 && vi - V0 > -1e-3 && rf[i] <= 0 && !(j >= 0 && pr[j] > 0)) {
          v[i] = V0; g[i] = 0; inAct[i] = 0;
        } else act[keep++] = i;
      }
      na = keep;
      ringC[slot] = cnt;
      this.t++;
    }
    this.na = na;
    const d1 = Math.exp(-frameDt / TRACE_TAU), d2 = Math.exp(-frameDt / SLOW_TAU);
    for (let i = 0; i < n; i++) { trace[i] *= d1; slow[i] *= d2; }
    if (rec) for (let i = 0; i < n; i++) flash[i] *= 0.82;
  }
  level(key) {
    let s = 0; for (const i of this.W.R[key]) s += this.trace[i];
    return s / this.W.NORM[key];
  }
  decode() {
    const { decI, decW, decBias } = this.W;
    let s = 0, tot = 0;
    for (let k = 0; k < decI.length; k++) { const r = this.slow[decI[k]]; s += r * decW[k]; tot += r; }
    const total = tot / 3000;
    const T = this.W.biasT, V = this.W.biasV;
    let k = 1; while (k < T.length - 1 && T[k] < total) k++;
    const f = Math.max(0, Math.min(1, (total - T[k - 1]) / (T[k] - T[k - 1])));
    return { side: s + decBias * Math.min(1, total * 2) - (V[k - 1] + f * (V[k] - V[k - 1])), total };
  }
  activeCount() { let c = 0; for (let i = 0; i < this.W.n; i++) if (this.trace[i] > 2) c++; return c; }
}

// Evolution: copy weights and nudge a fraction of them.
export function mutate(weights, rate = 0.08, size = 0.35) {
  const out = new Float32Array(weights);
  for (let k = 0; k < out.length; k++) {
    if (Math.random() < rate) {
      const z = Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(6.2831853 * Math.random());
      out[k] *= Math.exp(size * z);
    }
  }
  return out;
}
