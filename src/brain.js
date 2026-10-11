// Neural control system. The genotype's per-node neural circuits are copied
// into every part instance, wired to that part's sensors, its parent's and
// children's neurons and the global neurons, then flattened into arrays.
// All neurons update in parallel from the previous values; the brain runs two
// steps per physics step, as in Sims' system.

import { NSENS, JOINT_DOFS } from './genome.js';

const FN_IDS = {};
['sum', 'product', 'divide', 'sumThreshold', 'greaterThan', 'signOf', 'min', 'max', 'abs', 'if',
  'interpolate', 'sin', 'cos', 'atan', 'log', 'expt', 'sigmoid', 'integrate', 'differentiate',
  'smooth', 'memory', 'oscWave', 'oscSaw'].forEach((n, i) => { FN_IDS[n] = i; });

export function compileBrain(g, parts) {
  const S = parts.length * NSENS;
  const base = [];            // first neuron index of each part
  let N = 0;
  for (const p of parts) { base.push(N); N += g.nodes[p.node].neurons.length; }
  const gbase = N; N += g.globals.length;

  const fn = new Uint8Array(N), param = new Float64Array(N);
  const inIdx = [], inW = [], inK = [];
  const nIn = new Uint8Array(N);

  function resolve(src, part) {
    // returns [valueIndex, constant]; valueIndex -1 means use the constant
    // indices wrap around the neurons actually present, so every link
    // made by mutation or mating stays live
    const neuronOf = (pi, i) => {
      if (pi < 0 || pi >= parts.length) return -2;
      const cnt = g.nodes[parts[pi].node].neurons.length;
      return cnt ? S + base[pi] + (i % cnt) : -2;
    };
    switch (src.t) {
      case 's': return [part * NSENS + src.i, 0];
      case 'rs': return [src.i, 0];
      case 'n': return [neuronOf(part, src.i), 0];
      case 'rn': return [neuronOf(0, src.i), 0];
      case 'p': return [neuronOf(parts[part].parent, src.i), 0];
      case 'c': {
        const nc = g.nodes[parts[part].node].conns.length;
        const ch = nc ? parts[part].children[src.c % nc] : undefined;
        return [ch === undefined ? -2 : neuronOf(ch, src.i), 0];
      }
      case 'g': return [g.globals.length ? S + gbase + (src.i % g.globals.length) : -2, 0];
      case 'k': return [-1, src.v];
    }
    return [-2, 0];
  }

  function add(k, nr, part) {
    fn[k] = FN_IDS[nr.fn];
    param[k] = nr.p;
    nIn[k] = nr.inputs.length;
    for (let j = 0; j < 3; j++) {
      const inp = nr.inputs[j];
      if (!inp) { inIdx.push(-2); inW.push(0); inK.push(0); continue; }
      const [ix, kv] = resolve(inp.src, part);
      inIdx.push(ix); inW.push(ix === -2 ? 0 : inp.w); inK.push(kv);
    }
  }
  parts.forEach((p, pi) => g.nodes[p.node].neurons.forEach((nr, j) => add(base[pi] + j, nr, pi)));
  g.globals.forEach((nr, j) => add(gbase + j, nr, 0));

  // effectors: one per free DOF of each non-root joint
  const effectors = [];
  parts.forEach((p, pi) => {
    if (p.parent < 0) return;
    const nd = g.nodes[p.node];
    for (const axis of JOINT_DOFS[nd.joint]) {
      const e = nd.effectors[axis];
      const [ix, kv] = resolve(e.src, pi);
      effectors.push({ part: pi, axis, idx: ix, w: ix === -2 ? 0 : e.w, k: kv });
    }
  });

  return {
    S, N, fn, param, nIn,
    inIdx: Int32Array.from(inIdx), inW: Float64Array.from(inW), inK: Float64Array.from(inK),
    vals: new Float64Array(S + N), next: new Float64Array(N), state: new Float64Array(N * 2),
    effectors, effOut: new Float64Array(effectors.length),
  };
}

const lim = x => (x > 100 ? 100 : x < -100 ? -100 : (x === x ? x : 0));

export function brainStep(b, dt) {
  const { S, N, fn, param, inIdx, inW, inK, vals, next, state } = b;
  for (let k = 0; k < N; k++) {
    const o = k * 3;
    const i0 = inIdx[o], i1 = inIdx[o + 1], i2 = inIdx[o + 2];
    const a = i0 >= 0 ? vals[i0] * inW[o] : inK[o] * inW[o];
    const c = i1 >= 0 ? vals[i1] * inW[o + 1] : inK[o + 1] * inW[o + 1];
    const e = i2 >= 0 ? vals[i2] * inW[o + 2] : inK[o + 2] * inW[o + 2];
    const p = param[k];
    let y = 0;
    switch (fn[k]) {
      case 0: y = a + c; break;
      case 1: y = a * c; break;
      case 2: y = Math.abs(c) < 1e-3 ? 0 : a / c; break;
      case 3: y = a + c > p ? 1 : -1; break;
      case 4: y = a > c ? 1 : -1; break;
      case 5: y = Math.sign(a); break;
      case 6: y = Math.min(a, c); break;
      case 7: y = Math.max(a, c); break;
      case 8: y = Math.abs(a); break;
      case 9: y = a > 0 ? c : e; break;
      case 10: { const t = Math.min(1, Math.max(0, (a + 1) / 2)); y = c + (e - c) * t; break; }
      case 11: y = Math.sin(a + p * 3); break;
      case 12: y = Math.cos(a + p * 3); break;
      case 13: y = Math.atan(a); break;
      case 14: y = Math.log(Math.abs(a) + 1e-3); break;
      case 15: y = Math.exp(Math.min(4, a)); break;
      case 16: y = Math.tanh(a + p); break;
      case 17: { // integrate a, reset when c > 0
        let s = state[2 * k];
        s = c > 0 ? 0 : Math.max(-10, Math.min(10, s + a * dt));
        state[2 * k] = s; y = s; break;
      }
      case 18: { y = (a - state[2 * k]) / dt; state[2 * k] = a; y = Math.max(-10, Math.min(10, y)); break; }
      case 19: { // smooth: first-order lag, rate from param
        const r = 1 - Math.exp(-dt * 10 * Math.exp(p));
        state[2 * k] += (a - state[2 * k]) * r; y = state[2 * k]; break;
      }
      case 20: { if (c > 0) state[2 * k] = a; y = state[2 * k]; break; }
      case 21: case 22: { // oscillators: frequency set by param, modulated by the
        // first input; the second input shifts the phase (1 = half a cycle),
        // which lets symmetric copies run in antiphase or as a travelling wave
        const f = 0.5 * Math.exp(p) * (1 + Math.tanh(a));
        let ph = state[2 * k] + dt * f;
        ph -= Math.floor(ph);
        state[2 * k] = ph;
        if (fn[k] === 21) y = Math.sin(2 * Math.PI * (ph + state[2 * k + 1]) + Math.PI * c);
        else { const q = ph + c / 2; y = 2 * (q - Math.floor(q)) - 1; }
        break;
      }
    }
    next[k] = lim(y);
  }
  vals.set(next, S);
  const eff = b.effectors, out = b.effOut;
  for (let j = 0; j < eff.length; j++) {
    const e = eff[j];
    const x = e.idx >= 0 ? vals[e.idx] * e.w : e.k * e.w;
    out[j] = x > 1 ? 1 : x < -1 ? -1 : x;
  }
}

// Oscillator starting phase is taken from the neuron's param.
export function initBrain(b) {
  for (let k = 0; k < b.N; k++) b.state[2 * k + 1] = (b.param[k] + 2) * 0.25;
}
