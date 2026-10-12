// Genotype: a directed graph of part-nodes (Sims 1994). Each node describes a
// rigid block, the joint that attaches it to its parent, a recursive limit, a
// local neural circuit and one effector per joint DOF. Connections carry the
// attachment position, orientation, scale, reflection and terminal-only flag.
// A few global neurons sit outside the morphology.
//
// Two extensions beyond Sims: a body plan (free, bilateral or N-fold radial
// symmetry, applied during development) and round parts (capsules and
// spheres as well as boxes), so recursive chains can become tentacles.
// A third: animal templates (snake, quadruped, insect, ...), bilateral
// genomes whose graph is fixed by the template; see TEMPLATES.

import { I3, mv, mtv, mm, mdiag, det, add, sub, scale, norm, rotX, rotY, rotZ, cross, dot, makeRng } from './math.js';

export const JOINTS = ['rigid', 'revolute', 'twist', 'universal', 'bendtwist', 'twistbend', 'spherical'];
// free rotational axes of each joint in the joint frame: 0 = twist (X, along
// the attachment normal), 1 and 2 = bend axes (Y, Z)
export const JOINT_DOFS = {
  rigid: [], revolute: [1], twist: [0], universal: [1, 2],
  bendtwist: [0, 1], twistbend: [0, 2], spherical: [0, 1, 2],
};

// Neuron functions and how many inputs each reads.
export const NEURON_FNS = {
  sum: 2, product: 2, divide: 2, sumThreshold: 2, greaterThan: 2, signOf: 1,
  min: 2, max: 2, abs: 1, if: 3, interpolate: 3, sin: 1, cos: 1, atan: 1,
  log: 1, expt: 1, sigmoid: 1, integrate: 2, differentiate: 1, smooth: 1,
  memory: 2, oscWave: 2, oscSaw: 2,    // oscillators: frequency input, phase-shift input
};
export const FN_NAMES = Object.keys(NEURON_FNS);

// Per-part sensors: 0-2 joint angles, 3-8 contact faces (+X -X +Y -Y +Z -Z),
// 9-11 photosensor (light / cube direction), 12-14 second photosensor
// (opponent direction, competition only), 15 symmetry position (bilateral:
// +1 / -1 for the two sides, radial: 2k/N for arm k, 0 on the midplane/axis),
// 16 chain position: 0 at the base of a recursive chain, 1 at its tip. Every
// segment of a chain runs the same circuit, so without 16 they can only flex
// in lockstep; an oscillator whose phase input reads it makes a travelling
// wave, its weight setting the wavelength (1 = half a wave along the chain).
export const NSENS = 17;

export const SHAPES = ['box', 'capsule', 'sphere'];
export const PLANS = ['free', 'bilateral', 'radial', 'snake', 'quadruped', 'insect', 'arachnid', 'crustacean', 'centipede', 'biped'];

export const LIMITS = {
  dimMin: 0.1, dimMax: 1.0,
  scaleMin: 0.6, scaleMax: 1.4,
  effMin: 0.06,              // smallest developed block edge
  sMin: 0.3, sMax: 2,        // bounds on the scale accumulated down a chain
  maxExtent: 5,              // largest allowed creature bounding-box edge
  recurMax: 8,
  maxParts: 20,              // free plan: development is truncated here
  maxPartsSym: 64,           // symmetric plans: more parts make the creature invalid (8 arms × 7 + body)
  maxNodes: 12,
  maxNeurons: 4,             // per node
  maxGlobals: 4,
};

// ---------------------------------------------------------------- random

function randSrc(rng, kind) {
  // kind: 'part' sources a part neuron can read, 'global' for global neurons,
  // 'effector' same as part.
  const r = rng();
  if (kind === 'global') {
    if (r < 0.3) return { t: 'g', i: rng.int(LIMITS.maxGlobals) };
    if (r < 0.5) return { t: 'rs', i: rng.int(NSENS) };
    if (r < 0.7) return { t: 'rn', i: rng.int(LIMITS.maxNeurons) };
    return { t: 'k', v: rng.range(-1, 1) };
  }
  if (r < 0.28) return { t: 's', i: rng.int(NSENS) };
  if (r < 0.55) return { t: 'n', i: rng.int(LIMITS.maxNeurons) };
  if (r < 0.65) return { t: 'p', i: rng.int(LIMITS.maxNeurons) };
  if (r < 0.73) return { t: 'c', c: rng.int(3), i: rng.int(LIMITS.maxNeurons) };
  if (r < 0.85) return { t: 'g', i: rng.int(LIMITS.maxGlobals) };
  return { t: 'k', v: rng.range(-1, 1) };
}

function randInput(rng, kind) {
  return { src: randSrc(rng, kind), w: rng.range(-2, 2) };
}

export function randNeuron(rng, kind = 'part') {
  // oscillators are what get anything moving at first, so favour them a bit
  const fn = rng.chance(0.3) ? rng.pick(['oscWave', 'oscSaw', 'oscWave']) : rng.pick(FN_NAMES);
  const n = NEURON_FNS[fn];
  return { fn, p: rng.range(-1, 1), inputs: Array.from({ length: n }, () => randInput(rng, kind)) };
}

function randLimits(rng) {
  return [0, 1, 2].map(() => {
    const a = rng.range(0.2, 1.2);
    const c = rng.range(-0.4, 0.4);
    return [Math.max(-1.6, c - a), Math.min(1.6, c + a)];
  });
}

export function randConnection(rng, nNodes) {
  return {
    to: rng.int(nNodes),
    face: rng.int(6),
    u: rng.range(-1, 1), v: rng.range(-1, 1),
    rot: [rng.range(-Math.PI, Math.PI), rng.range(-0.8, 0.8), rng.range(-0.8, 0.8)],
    scale: rng.range(LIMITS.scaleMin, LIMITS.scaleMax),
    reflect: rng.chance(0.3) ? rng.int(3) : -1,   // axis mirrored, -1 = none
    terminal: rng.chance(0.15),
  };
}

// opts: { plan: {type, n}, round: bool } — run settings for body plan and shapes
const randShape = (rng, opts) => (opts?.round ? rng.pick(['box', 'capsule', 'capsule', 'sphere']) : 'box');

export function randNode(rng, opts) {
  const joint = rng.pick(JOINTS.slice(1).concat(['revolute', 'universal']));
  return {
    shape: randShape(rng, opts),
    dims: [0, 1, 2].map(() => Math.exp(rng.range(Math.log(LIMITS.dimMin * 1.5), Math.log(LIMITS.dimMax * 0.8)))),
    joint,
    limits: randLimits(rng),
    recur: 1 + rng.int(3),
    servo: rng.chance(0.25),   // effector outputs are target angles, not torques
    neurons: Array.from({ length: rng.int(3) }, () => randNeuron(rng)),
    effectors: [0, 1, 2].map(() => randInput(rng, 'part')),
    conns: [],
  };
}

export function randomGenome(rng, opts) {
  if (TEMPLATES[opts?.plan?.type]) return templateGenome(rng, opts);
  const nNodes = 1 + rng.int(4);
  const nodes = Array.from({ length: nNodes }, () => randNode(rng, opts));
  // the root tends to be the biggest block
  nodes[0].dims = nodes[0].dims.map(d => Math.min(LIMITS.dimMax, d * 1.4));
  // make sure every node is reachable: a spanning chain, then extra links
  for (let i = 1; i < nNodes; i++) {
    const c = randConnection(rng, nNodes);
    c.to = i;
    nodes[rng.int(i)].conns.push(c);
  }
  const extra = rng.int(3);
  for (let k = 0; k < extra; k++) nodes[rng.int(nNodes)].conns.push(randConnection(rng, nNodes));
  if (nNodes === 1 && nodes[0].conns.length === 0) {
    const c = randConnection(rng, 1); nodes[0].conns.push(c);
  }
  const g = {
    nodes,
    globals: Array.from({ length: rng.int(3) }, () => randNeuron(rng, 'global')),
  };
  if (opts?.plan && opts.plan.type !== 'free') g.plan = { ...opts.plan };
  return g;
}

export const clone = g => JSON.parse(JSON.stringify(g));

// Longest appendage: the most joints on any path from the root part to a leaf.
export function armLength(parts) {
  const depth = new Array(parts.length).fill(0);
  let best = 0;
  for (const p of parts) if (p.parent >= 0) best = Math.max(best, depth[p.index] = depth[p.parent] + 1);
  return best;
}

// Give a genome an arm at least k segments long: a new node, elongated along
// its attachment axis (local X), repeated k times through a self-connection on
// its far end and hung from the root. Under a radial plan the root's
// connection is repeated, so this makes N arms; under bilateral, a pair.
// Used to seed runs that require long appendages.
// A wave controller for a chain's node: an oscillator whose phase is shifted
// by the chain position, so each segment lags the one before it and a wave
// runs from base to tip. It drives both bend axes with independent gains, so
// the wave can ripple in a plane or sweep at an angle. Evolution then tunes
// frequency, wavelength and strength.
export function addWave(nd, rng) {
  if (nd.neurons.length >= LIMITS.maxNeurons) return false;
  const i = nd.neurons.length;
  nd.neurons.push({
    fn: 'oscWave', p: rng.range(-0.2, 1.0),   // 0.4 to 1.4 Hz
    inputs: [{ src: { t: 'k', v: 0 }, w: 1 }, { src: { t: 's', i: 16 }, w: -rng.range(0.6, 2.4) }],
  });
  if (!JOINT_DOFS[nd.joint].some(a => a > 0)) nd.joint = rng.pick(['universal', 'revolute', 'universal']);
  nd.servo = true;
  // the first bend axis gets a strong drive, a second one a weaker one
  const bends = JOINT_DOFS[nd.joint].filter(a => a > 0);   // twist stays as it was
  bends.forEach((axis, j) => {
    nd.effectors[axis] = { src: { t: 'n', i }, w: (rng.chance(0.5) ? 1 : -1) * (j === 0 ? rng.range(0.6, 1.6) : rng.range(0, 0.8)) };
  });
  return true;
}

export function growArm(g, rng, k, opts) {
  const nd = randNode(rng, opts);
  if (opts?.round) nd.shape = 'capsule';
  nd.dims = [rng.range(0.25, 0.45), rng.range(0.08, 0.16), rng.range(0.08, 0.16)];
  nd.recur = Math.min(LIMITS.recurMax, k);
  addWave(nd, rng);
  const self = g.nodes.length;
  nd.conns.push({
    to: self, face: 0, u: 0, v: 0,
    rot: [rng.range(-0.3, 0.3), rng.range(-0.15, 0.15), rng.range(-0.15, 0.15)],
    scale: rng.range(0.8, 0.97), reflect: -1, terminal: false,
  });
  g.nodes.push(nd);
  const c = randConnection(rng, g.nodes.length);
  c.to = self;
  c.face = rng.int(6); c.terminal = false; c.reflect = -1;
  c.scale = 1;
  g.nodes[0].conns.push(c);
  return g;
}

// ---------------------------------------------------------------- development

// Face frame of a node's local box face f: columns n (outward normal), t1, t2.
function faceFrame(f) {
  const axis = f >> 1, sign = (f & 1) ? -1 : 1;
  const n = [0, 0, 0]; n[axis] = sign;
  const t1 = [0, 0, 0]; t1[(axis + 1) % 3] = 1;
  return [n, t1, cross(n, t1)];
}

// Half extents of a part from its developed dims. A capsule lies along the
// local X axis (the attachment axis), so chains of them read as tentacles.
// (Cylinders only occur on the axis of radial bodies; their axis is local
// X, or local Y for the root.)
function shapeHalf(shape, dims) {
  if (shape === 'sphere') { const r = (dims[0] + dims[1] + dims[2]) / 6; return [r, r, r]; }
  if (shape === 'capsule') { const r = (dims[1] + dims[2]) / 4; return [Math.max(dims[0] / 2, r), r, r]; }
  return dims.map(x => x / 2);
}

// The point on a round part's core that a surface point projects from.
function corePoint(shape, half, L, cyl = 0) {
  if (shape === 'capsule') { const a = half[0] - half[1]; return [Math.max(-a, Math.min(a, L[0])), 0, 0]; }
  return [0, 0, 0];
}

// Push a local point on the bounding box out/in to the part's real surface;
// returns the point and the outward normal (null for boxes, which keep the
// face normal).
function toSurface(shape, half, L, cyl = 0) {
  if (shape === 'box') return { L, n: null };
  if (shape === 'cylinder') {
    const o = (cyl + 1) % 3, o2 = (cyl + 2) % 3, r = half[o], hh = half[cyl];
    const rho = Math.hypot(L[o], L[o2]);
    const out = L.slice();
    if (Math.abs(L[cyl]) >= hh - 1e-9 && rho <= r) {   // on an end cap
      const n = [0, 0, 0]; n[cyl] = Math.sign(L[cyl]);
      return { L: out, n };
    }
    const n = [0, 0, 0];
    if (rho < 1e-9) n[o] = 1; else { n[o] = L[o] / rho; n[o2] = L[o2] / rho; }
    out[o] = n[o] * r; out[o2] = n[o2] * r;
    out[cyl] = Math.max(-hh, Math.min(hh, L[cyl]));
    return { L: out, n };
  }
  const p0 = corePoint(shape, half, L);
  let d = sub(L, p0);
  if (Math.hypot(...d) < 1e-9) d = [1, 0, 0];
  const n = norm(d);
  return { L: add(p0, scale(n, half[1])), n };
}

// Ray from local point o (inside the box) along d to the box surface.
function boxHit(half, o, d) {
  let t = Infinity;
  for (let k = 0; k < 3; k++) if (Math.abs(d[k]) > 1e-9) t = Math.min(t, ((d[k] > 0 ? half[k] : -half[k]) - o[k]) / d[k]);
  return add(o, scale(d, t));
}

// Make column k of frame A exactly `target` and re-orthonormalize the others,
// keeping A's handedness.
function snapFrame(A, k, target) {
  const d0 = Math.sign(det(A)) || 1;
  const i = (k + 1) % 3, j = (k + 2) % 3;
  const cols = [null, null, null];
  cols[k] = target.slice();
  let ci = sub(A[i], scale(target, dot(A[i], target)));
  if (Math.hypot(...ci) < 1e-6) ci = Math.abs(target[0]) < 0.9 ? cross(target, [1, 0, 0]) : cross(target, [0, 1, 0]);
  cols[i] = norm(ci);
  cols[j] = scale(cross(cols[k], cols[i]), d0);
  return cols;
}

const rotYw = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; };
const MIRROR_Z = A => A.map(c => [c[0], c[1], -c[2]]);

// Grow the phenotype: a list of parts with their rest-pose placement.
//   A      3x3 local axes in creature space (may be improper when mirrored)
//   R      proper rotation used for the physical block (A with Z flipped if det<0)
//   d      det(A) = +-1
//   shape  'box' | 'capsule' | 'sphere'
//   half   half extents along R's columns (bounding box for round parts)
//   center position of the block centre
//   anchor joint position (on the parent's surface), parent index, conn index
//   phase  symmetry position (sensor 15)
//
// Body plans: the root lies on the symmetry element (the midplane z = 0 for
// bilateral, the vertical axis for radial). A connection from a part on the
// element either stays on it (when it attaches close to it: the part is
// snapped onto the element) or is replicated: a mirror pair, or N copies
// rotated about the axis. Parts off the element are not replicated again, as
// their whole subtree is copied with them.
export function develop(g, maxParts) {
  const parts = [];
  const nodes = g.nodes;
  const plan = TEMPLATES[g.plan?.type] ? 'bilateral' : g.plan?.type || 'free';
  const N = plan === 'radial' ? Math.max(2, g.plan.n || 5) : 1;
  const sym = plan !== 'free';
  const cap = maxParts ?? (sym ? LIMITS.maxPartsSym : LIMITS.maxParts);
  if (!nodes.length) return { parts };
  const root = {
    node: 0, parent: -1, conn: -1, A: I3(), s: 1, counts: new Array(nodes.length).fill(0),
    onAxis: sym, axisIdx: 1, phase: 0,
  };
  root.counts[0] = 1;
  const queue = [root];
  let overflow = false;
  while (queue.length) {
    if (parts.length >= cap) { overflow = true; break; }
    const p = queue.shift();
    const nd = nodes[p.node];
    const dims = nd.dims.map(x => Math.max(nd.minDim ?? LIMITS.effMin, x * p.s));
    let shape = nd.shape || 'box';
    const cyl = p.axisIdx;
    if (plan === 'radial' && p.onAxis) {
      // parts on the axis are made round about it: boxes become cylinders
      const [a, b] = [0, 1, 2].filter(k => k !== p.axisIdx);
      dims[a] = dims[b] = (dims[a] + dims[b]) / 2;
      if (shape === 'box') shape = 'cylinder';
      if (shape === 'capsule' && p.axisIdx !== 0) shape = 'sphere';
    }
    const half = shapeHalf(shape, dims);
    const d = Math.sign(det(p.A)) || 1;
    const R = mdiag(p.A, [1, 1, d]);
    let center;
    if (p.parent < 0) center = [0, 0, 0];
    else center = add(p.anchor, scale(p.A[0], half[0]));
    const part = {
      index: parts.length, node: p.node, parent: p.parent, conn: p.conn,
      A: p.A, R, d, s: p.s, shape, cyl, half, center, anchor: p.anchor || center,
      joint: p.parent < 0 ? 'root' : nd.joint, children: [], phase: p.phase, onAxis: p.onAxis,
      chain: nd.recur > 1 ? (p.counts[p.node] - 1) / (nd.recur - 1) : 0,
    };
    if (p.parent >= 0 && parts[p.parent].children[p.conn] === undefined) parts[p.parent].children[p.conn] = part.index;
    parts.push(part);

    const atLimit = p.counts[p.node] >= nd.recur;
    nd.conns.forEach((c, ci) => {
      if (c.to < 0 || c.to >= nodes.length || c.off) return;
      if (c.terminal && !atLimit) return;
      if (p.counts[c.to] + 1 > nodes[c.to].recur) return;
      const counts = p.counts.slice(); counts[c.to]++;
      // reflection mirrors the parent's frame for this connection's subtree
      const rd = [1, 1, 1]; if (c.reflect >= 0) rd[c.reflect] = -1;
      const Ap = mdiag(p.A, rd);
      const axis = c.face >> 1, sign = (c.face & 1) ? -1 : 1;
      let L = [0, 0, 0];
      L[axis] = sign * half[axis];
      L[(axis + 1) % 3] = c.u * half[(axis + 1) % 3];
      L[(axis + 2) % 3] = c.v * half[(axis + 2) % 3];
      let G = faceFrame(c.face);
      const surf = toSurface(shape, half, L, cyl);
      L = surf.L;
      if (surf.n) {
        // round parent: the attachment frame follows the surface normal
        const t1 = norm(sub(G[1], scale(surf.n, dot(G[1], surf.n))));
        G = [surf.n, t1, cross(surf.n, t1)];
      }
      let anchor = add(part.center, mv(Ap, L));
      let A = mm(Ap, mm(G, mm(rotX(c.rot[0]), mm(rotY(c.rot[1]), rotZ(c.rot[2])))));
      const child = {
        node: c.to, parent: part.index, conn: ci, counts,
        s: clamp(p.s * c.scale, LIMITS.sMin, LIMITS.sMax),
        onAxis: false, axisIdx: 0, phase: p.phase,
      };
      if (!sym || !p.onAxis) { queue.push({ ...child, A, anchor }); return; }

      const nWorld = mv(Ap, G[0]);
      if (plan === 'bilateral') {
        const ez = part.half.reduce((acc, h, k) => acc + h * Math.abs(part.R[k][2]), 0);
        if (Math.abs(anchor[2]) < 0.25 * ez && Math.abs(nWorld[2]) < 0.5) {
          // medial: snap onto the midplane, one axis along the plane normal
          const Lm = mtv(Ap, sub([anchor[0], anchor[1], 0], part.center));
          anchor = add(part.center, mv(Ap, toSurface(shape, half, Lm, cyl).L));
          // (the attachment axis X must stay in the plane, so Y or Z is snapped)
          const k = Math.abs(A[1][2]) >= Math.abs(A[2][2]) ? 1 : 2;
          A = snapFrame(A, k, [0, 0, Math.sign(A[k][2]) || 1]);
          queue.push({ ...child, A, anchor, onAxis: true });
        } else {
          queue.push({ ...child, A, anchor, phase: 1 });
          queue.push({ ...child, A: MIRROR_Z(A), anchor: [anchor[0], anchor[1], -anchor[2]], phase: -1 });
        }
        return;
      }
      // radial: the axis is the creature's vertical line through the root
      const rho = Math.hypot(anchor[0], anchor[2]);
      const ext = k => part.half.reduce((acc, h, q) => acc + h * Math.abs(part.R[q][k]), 0);
      if (rho < 0.35 * Math.min(ext(0), ext(2)) && Math.abs(nWorld[1]) > 0.7) {
        // axial: snap onto the axis, child's attachment axis along it
        const up = Math.sign(nWorld[1]);
        const dirL = mtv(Ap, [0, up, 0]);
        const Lm = shape === 'box' ? boxHit(half, [0, 0, 0], dirL) : toSurface(shape, half, scale(dirL, 10), cyl).L;
        anchor = add(part.center, mv(Ap, Lm));
        anchor[0] = 0; anchor[2] = 0;
        A = snapFrame(A, 0, [0, up, 0]);
        queue.push({ ...child, A, anchor, onAxis: true, axisIdx: 0 });
        return;
      }
      // parts on the axis are round about it, so rotated copies of the
      // attachment stay on its surface
      for (let k = 0; k < N; k++) {
        const Rk = rotYw(2 * Math.PI * k / N);
        queue.push({ ...child, A: mm(Rk, A), anchor: mv(Rk, anchor), phase: 2 * k / N });
      }
    });
  }
  return { parts, overflow };
}

// Separating-axis test between two oriented boxes, slightly shrunk so that
// touching faces don't count.
export function obbOverlap(a, b, shrink = 0.96) {
  const ha = a.half.map(x => x * shrink), hb = b.half.map(x => x * shrink);
  const T = [b.center[0] - a.center[0], b.center[1] - a.center[1], b.center[2] - a.center[2]];
  const axes = [...a.R, ...b.R];
  for (const u of a.R) for (const v of b.R) {
    const c = cross(u, v);
    if (Math.hypot(...c) > 1e-6) axes.push(c);
  }
  for (const ax of axes) {
    const ra = ha[0] * Math.abs(dot(a.R[0], ax)) + ha[1] * Math.abs(dot(a.R[1], ax)) + ha[2] * Math.abs(dot(a.R[2], ax));
    const rb = hb[0] * Math.abs(dot(b.R[0], ax)) + hb[1] * Math.abs(dot(b.R[1], ax)) + hb[2] * Math.abs(dot(b.R[2], ax));
    if (Math.abs(dot(T, ax)) > ra + rb) return false;
  }
  return true;
}

// Axis-aligned bounding box of the developed creature: [min, max].
export function bounds(parts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let k = 0; k < 3; k++) {
      const e = p.half[0] * Math.abs(p.R[0][k]) + p.half[1] * Math.abs(p.R[1][k]) + p.half[2] * Math.abs(p.R[2][k]);
      lo[k] = Math.min(lo[k], p.center[k] - e);
      hi[k] = Math.max(hi[k], p.center[k] + e);
    }
  }
  return [lo, hi];
}

export function tooBig(parts) {
  const [lo, hi] = bounds(parts);
  return hi.some((h, k) => h - lo[k] > LIMITS.maxExtent);
}

// Sims discarded creatures whose (non-adjacent) parts interpenetrate.
export function interpenetrates(parts) {
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      if (b.parent === i || a.parent === j) continue;
      if (obbOverlap(a, b)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- mutation

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

function mutateSrc(rng, src, kind) {
  if (rng.chance(0.4)) return randSrc(rng, kind);
  const s = { ...src };
  if (s.t === 'k') s.v = clamp(s.v + rng.gauss() * 0.4, -2, 2);
  else if (s.i !== undefined) s.i = rng.chance(0.5) ? rng.int(s.t === 's' || s.t === 'rs' ? NSENS : LIMITS.maxNeurons) : s.i;
  return s;
}

function mutateInput(rng, inp, rate, kind) {
  let n = 0;
  if (rng.chance(rate)) { inp.w = clamp(inp.w + rng.gauss() * 0.6, -4, 4); n++; }
  if (rng.chance(rate)) { inp.src = mutateSrc(rng, inp.src, kind); n++; }
  return n;
}

function mutateNeuron(rng, nr, rate, kind) {
  let n = 0;
  if (rng.chance(rate)) {
    nr.fn = rng.pick(FN_NAMES);
    const k = NEURON_FNS[nr.fn];
    while (nr.inputs.length < k) nr.inputs.push(randInput(rng, kind));
    nr.inputs.length = k;
    n++;
  }
  if (rng.chance(rate)) { nr.p = clamp(nr.p + rng.gauss() * 0.4, -2, 2); n++; }
  for (const inp of nr.inputs) n += mutateInput(rng, inp, rate, kind);
  return n;
}

function mutateNeuronList(rng, list, rate, kind, max) {
  let n = 0;
  for (const nr of list) n += mutateNeuron(rng, nr, rate, kind);
  if (list.length < max && rng.chance(rate)) { list.push(randNeuron(rng, kind)); n++; }
  if (list.length && rng.chance(rate)) { list.splice(rng.int(list.length), 1); n++; }
  return n;
}

function mutateNode(rng, nd, rate, opts) {
  let n = 0;
  if (opts?.round && rng.chance(rate)) { nd.shape = randShape(rng, opts); n++; }
  for (let k = 0; k < 3; k++) {
    if (rng.chance(rate)) {
      nd.dims[k] = clamp(nd.dims[k] * Math.exp(rng.gauss() * 0.3), LIMITS.dimMin, LIMITS.dimMax); n++;
    }
    if (rng.chance(rate)) {
      const [lo, hi] = nd.limits[k];
      nd.limits[k] = [clamp(lo + rng.gauss() * 0.3, -1.6, 0), clamp(hi + rng.gauss() * 0.3, 0, 1.6)]; n++;
    }
  }
  if (rng.chance(rate)) { nd.joint = rng.pick(JOINTS); n++; }
  if (rng.chance(rate)) { nd.servo = !nd.servo; n++; }
  if (rng.chance(rate)) { nd.recur = clamp(nd.recur + (rng.chance(0.5) ? 1 : -1), 1, LIMITS.recurMax); n++; }
  n += mutateNeuronList(rng, nd.neurons, rate, 'part', LIMITS.maxNeurons);
  for (const e of nd.effectors) n += mutateInput(rng, e, rate, 'part');
  return n;
}

function mutateConn(rng, c, rate, nNodes) {
  let n = 0;
  if (rng.chance(rate)) { c.to = rng.int(nNodes); n++; }
  if (rng.chance(rate)) { c.face = rng.int(6); n++; }
  if (rng.chance(rate)) { c.u = clamp(c.u + rng.gauss() * 0.4, -1, 1); n++; }
  if (rng.chance(rate)) { c.v = clamp(c.v + rng.gauss() * 0.4, -1, 1); n++; }
  for (let k = 0; k < 3; k++) {
    if (rng.chance(rate)) {
      c.rot[k] = k === 0 ? wrapAngle(c.rot[k] + rng.gauss() * 0.8) : clamp(c.rot[k] + rng.gauss() * 0.3, -1, 1); n++;
    }
  }
  if (rng.chance(rate)) { c.scale = clamp(c.scale * Math.exp(rng.gauss() * 0.2), LIMITS.scaleMin, LIMITS.scaleMax); n++; }
  if (rng.chance(rate)) { c.reflect = rng.chance(0.5) ? -1 : rng.int(3); n++; }
  if (rng.chance(rate)) { c.terminal = !c.terminal; n++; }
  return n;
}

function countSites(g) {
  let n = g.globals.length * 4;
  for (const nd of g.nodes) n += 10 + nd.neurons.length * 4 + 6 + nd.conns.length * 10;
  return n;
}

// Sims: mutation frequencies are scaled inversely with the size of the graph
// so a genome gets roughly the same number of mutations whatever its size;
// at least one mutation always happens.
export function mutate(g, rng, amount = 1.5, opts) {
  const rate = Math.min(0.5, amount / countSites(g));
  const tpl = TEMPLATES[g.plan?.type];
  for (let tries = 0; tries < 50; tries++) {
    let n = 0;
    // 1. node internals
    for (const nd of g.nodes) n += mutateNode(rng, nd, rate, opts);
    // 2. new random node (connected below or garbage collected)
    if (!tpl && g.nodes.length < LIMITS.maxNodes && rng.chance(rate * 4)) {
      g.nodes.push(randNode(rng, opts));
      g.nodes[rng.int(g.nodes.length - 1)].conns.push({ ...randConnection(rng, g.nodes.length), to: g.nodes.length - 1 });
      n++;
    }
    // 3. connection parameters
    for (const nd of g.nodes) for (const c of nd.conns) n += mutateConn(rng, c, rate, g.nodes.length);
    // 4. add / remove connections (templates: switch an optional part on or off)
    if (tpl) {
      for (const nd of g.nodes) if (tpl.roles[nd.role]?.optional && rng.chance(rate * 2)) { nd.on = !nd.on; n++; }
    } else for (const nd of g.nodes) {
      if (nd.conns.length < 6 && rng.chance(rate * 2)) { nd.conns.push(randConnection(rng, g.nodes.length)); n++; }
      if (nd.conns.length && rng.chance(rate * 2)) { nd.conns.splice(rng.int(nd.conns.length), 1); n++; }
    }
    // global neurons
    n += mutateNeuronList(rng, g.globals, rate, 'global', LIMITS.maxGlobals);
    if (n > 0) break;
  }
  // 5. garbage-collect nodes unreachable from the root
  return tpl ? conform(g) : gc(g);
}

// One guaranteed change to the body's structure, as opposed to the parameter
// tweaks that make up almost all of mutate(): about 1.5 changes per child, of
// which a new part is ~2%. Without these, evolution keeps refining the
// first body that worked.
export function structural(g, rng, opts) {
  if (TEMPLATES[g.plan?.type]) return templateStructural(g, rng, opts);
  const nodes = g.nodes;
  const pickNode = () => rng.int(nodes.length);
  const allConns = () => nodes.flatMap(nd => nd.conns);
  const ops = [
    // a new limb: a new node hung from an existing one
    () => {
      if (nodes.length >= LIMITS.maxNodes) return false;
      nodes.push(randNode(rng, opts));
      nodes[pickNode() % (nodes.length - 1)].conns.push({ ...randConnection(rng, nodes.length), to: nodes.length - 1 });
      return true;
    },
    // gene duplication: copy a node and send one of the connections into it
    // to the copy, which can then diverge from the original
    () => {
      if (nodes.length >= LIMITS.maxNodes) return false;
      const into = allConns().filter(c => c.to > 0);
      if (!into.length) return false;
      const c = rng.pick(into);
      const copy = clone(nodes[c.to]);
      for (const cc of copy.conns) if (cc.to === c.to) cc.to = nodes.length;   // keep its recursion on itself
      nodes.push(copy);
      c.to = nodes.length - 1;
      mutateNode(rng, copy, 0.3, opts);
      return true;
    },
    // a chain: a node repeats through a self-connection on its far end
    () => {
      const i = pickNode();
      if (nodes[i].conns.some(c => c.to === i) || nodes[i].conns.length >= 6) return false;
      nodes[i].conns.push({ ...randConnection(rng, nodes.length), to: i, face: 0, u: 0, v: 0, scale: rng.range(0.7, 1), reflect: -1, terminal: false });
      nodes[i].recur = Math.max(nodes[i].recur, 2 + rng.int(4));
      return true;
    },
    // a travelling wave along a chain (a node that repeats through itself)
    () => {
      const chains = nodes.filter((nd, i) => nd.recur > 1 && nd.conns.some(c => c.to === i));
      return chains.length ? addWave(rng.pick(chains), rng) : false;
    },
    // a new connection between existing nodes
    () => { const nd = nodes[pickNode()]; if (nd.conns.length >= 6) return false; nd.conns.push(randConnection(rng, nodes.length)); return true; },
    // lose a connection (and whatever only it reached)
    () => { const nd = nodes[pickNode()]; if (!nd.conns.length) return false; nd.conns.splice(rng.int(nd.conns.length), 1); return true; },
    // move a limb to another face
    () => { const cs = allConns(); if (!cs.length) return false; const c = rng.pick(cs); c.face = rng.int(6); c.u = rng.range(-1, 1); c.v = rng.range(-1, 1); return true; },
    // repeat a part more or fewer times
    () => { const nd = nodes[pickNode()]; nd.recur = clamp(nd.recur + (rng.chance(0.5) ? 1 : -1) * (1 + rng.int(2)), 1, LIMITS.recurMax); return true; },
    // a different joint, or shape
    () => { const nd = nodes[pickNode()]; nd.joint = rng.pick(JOINTS); if (opts?.round && rng.chance(0.5)) nd.shape = randShape(rng, opts); return true; },
    // a part much longer, wider or thinner
    () => { const nd = nodes[pickNode()]; const k = rng.int(3); nd.dims[k] = clamp(nd.dims[k] * (rng.chance(0.5) ? 2 : 0.5), LIMITS.dimMin, LIMITS.dimMax); return true; },
  ];
  for (let tries = 0; tries < 10; tries++) if (rng.pick(ops)()) break;
  return gc(g);
}

// Body descriptor for novelty: a point in a space where distance means "looks
// different". Each entry is scaled to roughly 0..1.
export function descriptor(parts) {
  const n = parts.length;
  const [lo, hi] = bounds(parts);
  const ext = [0, 1, 2].map(k => hi[k] - lo[k]).sort((a, b) => b - a);
  const shapes = { box: 0, capsule: 0, sphere: 0, cylinder: 0 };
  let size = 0, aspect = 0, dofs = 0, leaves = 0;
  for (const p of parts) {
    shapes[p.shape] = (shapes[p.shape] || 0) + 1;
    size += Math.cbrt(p.half[0] * p.half[1] * p.half[2]);
    aspect += Math.log(Math.max(...p.half) / Math.min(...p.half));
    if (p.parent >= 0) dofs += (JOINT_DOFS[p.joint]?.length || 0);
    if (!p.children.some(c => c !== undefined)) leaves++;
  }
  return [
    Math.log(n) / Math.log(64), armLength(parts) / 8, new Set(parts.map(p => p.node)).size / LIMITS.maxNodes,
    ext[0] / 5, ext[1] / 5, ext[2] / 5,
    size / n / 0.5, aspect / n / Math.log(10),
    (shapes.box || 0) / n, (shapes.capsule || 0) / n, (shapes.sphere || 0) / n, (shapes.cylinder || 0) / n,
    dofs / Math.max(1, n - 1) / 3, leaves / n,
  ];
}

// Remove nodes not reachable from node 0 and renumber connections.
export function gc(g) {
  const seen = new Set([0]), stack = [0];
  while (stack.length) {
    const i = stack.pop();
    for (const c of g.nodes[i].conns) {
      if (c.to >= 0 && c.to < g.nodes.length && !seen.has(c.to)) { seen.add(c.to); stack.push(c.to); }
    }
  }
  const keep = [...seen].sort((a, b) => a - b);
  const remap = new Map(keep.map((old, i) => [old, i]));
  g.nodes = keep.map(i => g.nodes[i]);
  for (const nd of g.nodes) nd.conns = nd.conns.filter(c => remap.has(c.to)).map(c => ({ ...c, to: remap.get(c.to) }));
  return g;
}

// ---------------------------------------------------------------- mating

// Crossover: nodes of both parents are lined up and copied from the first
// parent up to a crossover point, then from the second. Connections that
// point past the end are reassigned at random.
export function crossover(a, b, rng) {
  const n = Math.max(a.nodes.length, b.nodes.length);
  const cut = rng.int(n + 1);
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const src = i < cut ? a.nodes[i] : b.nodes[i];
    if (src) nodes.push(clone(src));
  }
  if (!nodes.length) nodes.push(clone(a.nodes[0]));
  for (const nd of nodes) for (const c of nd.conns) if (c.to >= nodes.length) c.to = rng.int(nodes.length);
  const gcut = rng.int(Math.max(a.globals.length, b.globals.length) + 1);
  const globals = [];
  for (let i = 0; i < Math.max(a.globals.length, b.globals.length); i++) {
    const src = i < gcut ? a.globals[i] : b.globals[i];
    if (src) globals.push(clone(src));
  }
  const g = { nodes, globals };
  if (a.plan) g.plan = { ...a.plan };
  // templates: both parents have the same nodes in the same order, so this
  // swaps whole body regions
  return TEMPLATES[g.plan?.type] ? conform(g) : gc(g);
}

// Grafting: the first parent is copied, one of its connections is redirected
// to a random node of the second parent, whose nodes are appended.
export function graft(a, b, rng) {
  if (TEMPLATES[a.plan?.type]) {
    // templates: one of the second parent's parts (its node: shape, joint,
    // circuit and attachments) replaces the first parent's
    const g = clone(a), i = rng.int(Math.min(g.nodes.length, b.nodes.length));
    g.nodes[i] = clone(b.nodes[i]);
    return conform(g);
  }
  const g = clone(a);
  const off = g.nodes.length;
  for (const nd of b.nodes) {
    const c = clone(nd);
    for (const cc of c.conns) cc.to += off;
    g.nodes.push(c);
  }
  const all = [];
  g.nodes.slice(0, off).forEach((nd) => nd.conns.forEach(c => all.push(c)));
  const target = off + rng.int(b.nodes.length);
  if (all.length) rng.pick(all).to = target;
  else g.nodes[rng.int(off)].conns.push({ ...randConnection(rng, g.nodes.length), to: target });
  gc(g);
  if (g.nodes.length > LIMITS.maxNodes) {
    g.nodes.length = LIMITS.maxNodes;
    for (const nd of g.nodes) nd.conns = nd.conns.filter(c => c.to < LIMITS.maxNodes);
    gc(g);
  }
  return g;
}

// ---------------------------------------------------------------- animal templates

// A template fixes the graph: which parts there are, what each attaches to
// and on which face, how many times a chain repeats, and which joints a part
// may have. Evolution tunes everything within that: sizes (within each role's
// range), joint types (from the role's list) and limits, attachment points
// and angles (within ranges), chain lengths, the neural circuits, and whether
// each optional part is there. After every mutation and mating, conform()
// snaps the genome back onto its template.
//
// All templates are bilateral: the root lies on the midplane, parts attached
// near it (head, tail, abdomen) stay on it, and the rest come in mirror pairs.
// Each role's genome node develops as usual (develop()); an optional part
// that is switched off has its connections marked off, and develop() skips
// them with everything hanging from them.
//
// Frames: the root's X is forward, Y up, Z to the side. A child's X points
// out of the face it hangs from (its length), so a chain grows from its far
// face, 0. Faces: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. On a face, u and v
// (-1..1) run along the next two axes: X faces (u = Y, v = Z), Y faces
// (u = Z, v = X), Z faces (u = X, v = Y).
//
// Role fields: dims [x, y, z] ranges (m, before chain scaling), joints
// allowed, recur range, optional, minDim (smallest developed edge, if not
// LIMITS.effMin), conns: [{ to, face, u, v, rot: [twist, about Y, about Z],
// scale, terminal, unless }], each value a number or a [lo, hi] range;
// `unless`: the connection is off while that optional part is on.
// ground: biped and quadruped walking, the parts allowed to touch the ground.

const ANY = JOINTS, MOVE = JOINTS.slice(1);
const BEND = ['revolute', 'universal'];
const LIMB = ['revolute', 'universal', 'bendtwist', 'twistbend', 'spherical'];
const SEG = ['revolute', 'universal', 'twist', 'bendtwist', 'twistbend', 'spherical'];
const FIXED = ['rigid'];
const R0 = [[-0.3, 0.3], [-0.4, 0.4], [-0.4, 0.4]];
// a chain: the part repeats from its own far end
const chain = (to, scale = [0.75, 1], rot = [[-0.2, 0.2], [-0.3, 0.3], [-0.3, 0.3]]) => ({ to, face: 0, u: 0, v: 0, rot, scale });
// a pair of limbs on the +Z side face (mirrored to -Z) at fore-aft position u, tilted down
// the upper leg leaves roughly level (down < 0 lifts it), and a knee bends the lower leg down
const sideLeg = (to, u, splay = [-0.3, 0.3], down = [-0.5, 0.5]) => ({ to, face: 4, u: [u - 0.1, u + 0.1], v: [-0.8, 0.1], rot: [[-0.3, 0.3], down, splay], scale: [0.8, 1.2] });
const knee = to => ({ to, face: 0, u: 0, v: 0, rot: [[-0.2, 0.2], [0.4, 1], [-0.3, 0.3]], scale: [0.8, 1.1] });
// lower legs come last in each template, after the roles they hang from, so
// genomes from before knees keep their node numbers (and replay unchanged)
const LOWER = { dims: [[0.2, 0.5], [0.04, 0.09], [0.04, 0.09]], joints: BEND, conns: [] };
// five toes across a paw's front face, fanned outward (rotation about their Y
// turns them toward the paw's +Y side) so they never cross
const toes = to => [-0.8, -0.4, 0, 0.4, 0.8].map(v => ({ to, face: 5, u: [-0.3, 0.3], v: [v - 0.05, v + 0.05], rot: [[-0.05, 0.05], [0.3 * v - 0.03, 0.3 * v + 0.03], [-0.3, 0.3]], scale: 1 }));

export const TEMPLATES = {
  // a head and a body chain tapering into a tail
  snake: { roles: {
    head: { dims: [[0.15, 0.35], [0.08, 0.2], [0.1, 0.25]], joints: ANY, conns: [{ to: 'body', face: 1, u: 0, v: 0, rot: R0, scale: [0.8, 1.2] }] },
    body: { dims: [[0.2, 0.45], [0.06, 0.15], [0.08, 0.2]], joints: SEG, recur: [3, 8],
      conns: [chain('body', [0.85, 1.02]), { ...chain('tail', [0.7, 1]), terminal: true }] },
    tail: { dims: [[0.15, 0.4], [0.05, 0.12], [0.06, 0.16]], joints: SEG, recur: [1, 6], conns: [chain('tail', [0.7, 0.95])] },
  } },
  // a body on four legs (hip and knee joints), each ending in a paw with five
  // toes; a head, maybe on a neck, maybe with a trunk; maybe a tail
  quadruped: { roles: {
    body: { dims: [[0.5, 1.0], [0.2, 0.45], [0.35, 0.6]], joints: ANY, conns: [
      { to: 'neck', face: 0, u: [0, 0.8], v: 0, rot: [[-0.2, 0.2], [-0.2, 0.2], [0, 0.9]], scale: [0.8, 1.2] },
      { to: 'head', face: 0, u: [0, 0.6], v: 0, rot: R0, scale: [0.8, 1.2], unless: 'neck' },
      { to: 'tail', face: 1, u: [0, 0.8], v: 0, rot: [[-0.3, 0.3], [-0.3, 0.3], [-0.6, 0.8]], scale: [0.8, 1.2] },
      // legs hang from the underside near its edges, splayed outward only
      { to: 'foreUpper', face: 3, u: [0.7, 0.95], v: [0.5, 0.9], rot: [[-0.2, 0.2], [-0.4, 0.4], [0, 0.4]], scale: [0.8, 1.2] },
      { to: 'hindUpper', face: 3, u: [0.7, 0.95], v: [-0.9, -0.5], rot: [[-0.2, 0.2], [-0.4, 0.4], [0, 0.4]], scale: [0.8, 1.2] },
    ] },
    neck: { optional: true, dims: [[0.15, 0.5], [0.08, 0.2], [0.08, 0.2]], joints: MOVE,
      conns: [{ to: 'head', face: 0, u: 0, v: 0, rot: [[-0.2, 0.2], [-0.3, 0.3], [-0.9, 0.2]], scale: [0.8, 1.2] }] },
    head: { dims: [[0.15, 0.4], [0.12, 0.3], [0.12, 0.3]], joints: ANY,
      conns: [{ to: 'trunk', face: 0, u: [-0.8, 0], v: 0, rot: [[-0.2, 0.2], [-0.3, 0.3], [-0.6, 0.2]], scale: [0.8, 1.2] }] },
    trunk: { optional: true, dims: [[0.1, 0.25], [0.05, 0.12], [0.05, 0.12]], joints: SEG, recur: [2, 5],
      conns: [chain('trunk', [0.75, 0.95], [[-0.2, 0.2], [-0.3, 0.3], [-0.4, 0.1]])] },
    tail: { optional: true, dims: [[0.1, 0.3], [0.04, 0.12], [0.04, 0.12]], joints: SEG, recur: [2, 6], ground: true, conns: [chain('tail')] },
    foreUpper: { dims: [[0.2, 0.5], [0.08, 0.2], [0.08, 0.2]], joints: LIMB, conns: [{ to: 'foreLower', face: 0, u: 0, v: 0, rot: [[-0.2, 0.2], [-0.4, 0.4], [-0.1, 0.2]], scale: [0.8, 1.2] }] },
    foreLower: { dims: [[0.2, 0.5], [0.06, 0.16], [0.06, 0.16]], joints: BEND, conns: [{ to: 'paw', face: 0, u: 0, v: 0, rot: [[-0.2, 0.2], [-0.2, 0.2], [-0.2, 0.2]], scale: 1 }] },
    hindUpper: { dims: [[0.2, 0.5], [0.08, 0.2], [0.08, 0.2]], joints: LIMB, conns: [{ to: 'hindLower', face: 0, u: 0, v: 0, rot: [[-0.2, 0.2], [-0.4, 0.4], [-0.1, 0.2]], scale: [0.8, 1.2] }] },
    hindLower: { dims: [[0.2, 0.5], [0.06, 0.16], [0.06, 0.16]], joints: BEND, conns: [{ to: 'paw', face: 0, u: 0, v: 0, rot: [[-0.2, 0.2], [-0.2, 0.2], [-0.2, 0.2]], scale: 1 }] },
    // fused to the leg (the limb's joints are hip and knee), as are the toes
    // spread across its front: jointed, they were light enough to make the
    // solver gain energy
    paw: { dims: [[0.05, 0.1], [0.18, 0.22], [0.12, 0.22]], joints: FIXED, ground: true, conns: toes('toe') },
    toe: { dims: [[0.06, 0.18], [0.025, 0.028], [0.025, 0.028]], joints: FIXED, minDim: 0.02, ground: true, conns: [] },
  } },
  // a thorax with six one-joint legs, a head (antennae, mandibles) and an
  // abdomen (stinger)
  insect: { roles: {
    thorax: { dims: [[0.25, 0.6], [0.12, 0.3], [0.15, 0.35]], joints: ANY, conns: [
      { to: 'head', face: 0, u: 0, v: 0, rot: R0, scale: [0.8, 1.2] },
      { to: 'abdomen', face: 1, u: 0, v: 0, rot: R0, scale: [0.8, 1.2] },
      sideLeg('leg', 0.65, [0, 0.6]), sideLeg('leg', 0), sideLeg('leg', -0.65, [-0.6, 0]),
    ] },
    head: { dims: [[0.12, 0.3], [0.12, 0.3], [0.12, 0.3]], joints: ANY, conns: [
      { to: 'antenna', face: 2, u: [0.4, 0.9], v: [0.2, 0.9], rot: [[-0.3, 0.3], [-1, -0.3], [-0.5, 0.5]], scale: 1 },
      { to: 'mandible', face: 0, u: [-0.9, -0.3], v: [0.4, 0.9], rot: [[-0.3, 0.3], [-0.5, 0.5], [-0.5, 0.5]], scale: 1 },
    ] },
    antenna: { optional: true, dims: [[0.12, 0.35], [0.03, 0.06], [0.03, 0.06]], joints: MOVE, recur: [1, 3], minDim: 0.03, conns: [chain('antenna', [0.7, 1])] },
    mandible: { optional: true, dims: [[0.08, 0.2], [0.04, 0.08], [0.04, 0.08]], joints: BEND, minDim: 0.03, conns: [] },
    leg: { dims: [[0.2, 0.45], [0.05, 0.12], [0.05, 0.12]], joints: LIMB, conns: [knee('lowerLeg')] },
    abdomen: { dims: [[0.3, 0.8], [0.15, 0.35], [0.15, 0.4]], joints: ANY,
      conns: [{ to: 'stinger', face: 0, u: [-0.5, 0.5], v: 0, rot: R0, scale: 1 }] },
    stinger: { optional: true, dims: [[0.08, 0.2], [0.03, 0.06], [0.03, 0.06]], joints: MOVE, minDim: 0.03, conns: [] },
    lowerLeg: LOWER,
  } },
  // a body with eight one-joint legs, maybe pincers on the front pair; a head
  // (mandibles); maybe a tail with a stinger
  arachnid: { roles: {
    body: { dims: [[0.3, 0.7], [0.15, 0.3], [0.3, 0.6]], joints: ANY, conns: [
      { to: 'head', face: 0, u: 0, v: 0, rot: R0, scale: [0.8, 1.2] },
      sideLeg('frontLeg', 0.75, [0.2, 0.8]), sideLeg('leg', 0.25, [0, 0.4]), sideLeg('leg', -0.2, [-0.4, 0]), sideLeg('leg', -0.65, [-0.8, -0.2]),
      { to: 'tail', face: 1, u: [0, 0.8], v: 0, rot: [[-0.3, 0.3], [-0.3, 0.3], [0, 0.8]], scale: [0.8, 1.2] },
    ] },
    head: { dims: [[0.12, 0.3], [0.1, 0.25], [0.12, 0.3]], joints: ANY,
      conns: [{ to: 'mandible', face: 0, u: [-0.9, -0.3], v: [0.4, 0.9], rot: [[-0.3, 0.3], [-0.5, 0.5], [-0.5, 0.5]], scale: 1 }] },
    mandible: { optional: true, dims: [[0.08, 0.2], [0.04, 0.08], [0.04, 0.08]], joints: BEND, minDim: 0.03, conns: [] },
    frontLeg: { dims: [[0.2, 0.45], [0.05, 0.12], [0.05, 0.12]], joints: LIMB, conns: [knee('frontLower')] },
    pincer: { optional: true, dims: [[0.1, 0.25], [0.08, 0.15], [0.04, 0.08]], joints: BEND, conns: [] },
    leg: { dims: [[0.2, 0.45], [0.05, 0.12], [0.05, 0.12]], joints: LIMB, conns: [knee('lowerLeg')] },
    tail: { optional: true, dims: [[0.1, 0.25], [0.06, 0.14], [0.06, 0.14]], joints: SEG, recur: [2, 6],
      conns: [chain('tail', [0.8, 1], [[-0.2, 0.2], [-0.3, 0.3], [0, 0.6]]), { to: 'stinger', face: 0, u: 0, v: 0, rot: R0, scale: 1, terminal: true }] },
    stinger: { optional: true, dims: [[0.08, 0.2], [0.03, 0.06], [0.03, 0.06]], joints: MOVE, minDim: 0.03, conns: [] },
    // the front pair's lower legs carry the pincers
    frontLower: { ...LOWER, conns: [{ to: 'pincer', face: 0, u: 0, v: 0, rot: R0, scale: 1 }] },
    lowerLeg: LOWER,
  } },
  // a carapace with ten one-joint legs, the front pair ending in pincers; a
  // head with antennae; maybe a segmented tail
  crustacean: { roles: {
    carapace: { dims: [[0.35, 0.8], [0.15, 0.3], [0.3, 0.6]], joints: ANY, conns: [
      { to: 'head', face: 0, u: 0, v: 0, rot: R0, scale: [0.8, 1.2] },
      sideLeg('claw', 0.8, [0.3, 0.9], [-0.2, 0.6]), sideLeg('leg', 0.4, [0, 0.4]), sideLeg('leg', 0, [-0.2, 0.2]),
      sideLeg('leg', -0.4, [-0.4, 0]), sideLeg('leg', -0.8, [-0.8, -0.2]),
      { to: 'tail', face: 1, u: [-0.3, 0.5], v: 0, rot: [[-0.2, 0.2], [-0.3, 0.3], [-0.4, 0.4]], scale: [0.8, 1.2] },
    ] },
    head: { dims: [[0.1, 0.25], [0.1, 0.22], [0.12, 0.3]], joints: ANY,
      conns: [{ to: 'antenna', face: 0, u: [0, 0.8], v: [0.4, 0.9], rot: [[-0.3, 0.3], [-0.6, 0.2], [0, 0.8]], scale: 1 }] },
    antenna: { dims: [[0.15, 0.4], [0.03, 0.06], [0.03, 0.06]], joints: MOVE, recur: [1, 4], minDim: 0.03, conns: [chain('antenna', [0.7, 1])] },
    claw: { dims: [[0.2, 0.45], [0.06, 0.14], [0.06, 0.14]], joints: LIMB, conns: [knee('clawLower')] },
    pincer: { dims: [[0.12, 0.3], [0.1, 0.2], [0.05, 0.1]], joints: BEND, conns: [] },
    leg: { dims: [[0.2, 0.45], [0.04, 0.1], [0.04, 0.1]], joints: LIMB, conns: [knee('lowerLeg')] },
    tail: { optional: true, dims: [[0.12, 0.3], [0.08, 0.2], [0.15, 0.4]], joints: SEG, recur: [2, 6],
      conns: [chain('tail', [0.8, 0.98], [[-0.1, 0.1], [-0.2, 0.2], [-0.3, 0.3]])] },
    // the claws' lower legs (fore-arms) carry the pincers
    clawLower: { dims: [[0.15, 0.35], [0.05, 0.12], [0.05, 0.12]], joints: BEND, conns: [{ to: 'pincer', face: 0, u: 0, v: 0, rot: R0, scale: 1 }] },
    lowerLeg: LOWER,
  } },
  // a head (maybe pincers) and a chain of segments, a pair of one-joint legs on each
  centipede: { roles: {
    head: { dims: [[0.15, 0.35], [0.1, 0.25], [0.15, 0.35]], joints: ANY, conns: [
      { to: 'segment', face: 1, u: 0, v: 0, rot: R0, scale: [0.8, 1.2] },
      { to: 'pincer', face: 0, u: [-0.8, -0.2], v: [0.4, 0.9], rot: [[-0.3, 0.3], [-0.5, 0.5], [-0.5, 0.5]], scale: 1 },
    ] },
    pincer: { optional: true, dims: [[0.08, 0.2], [0.04, 0.08], [0.04, 0.08]], joints: BEND, minDim: 0.03, conns: [] },
    segment: { dims: [[0.15, 0.3], [0.08, 0.18], [0.15, 0.35]], joints: SEG, recur: [3, 8],
      conns: [chain('segment', [0.9, 1.05]), { to: 'leg', face: 4, u: [-0.3, 0.3], v: [-0.8, 0.1], rot: [[-0.3, 0.3], [-0.5, 0.5], [-0.4, 0.4]], scale: 1 }] },
    leg: { dims: [[0.1, 0.25], [0.04, 0.08], [0.04, 0.08]], joints: LIMB, conns: [knee('lowerLeg')] },
    lowerLeg: { dims: [[0.12, 0.3], [0.03, 0.07], [0.03, 0.07]], joints: BEND, conns: [] },
  } },
  // an upright torso on two legs (hip, knee, ankle); maybe a head, arms and a tail
  biped: { roles: {
    torso: { dims: [[0.15, 0.35], [0.3, 0.7], [0.25, 0.5]], joints: ANY, conns: [
      { to: 'head', face: 2, u: 0, v: [-0.3, 0.3], rot: R0, scale: [0.8, 1.2] },
      { to: 'upperArm', face: 4, u: [-0.3, 0.3], v: [0.4, 0.9], rot: [[-0.3, 0.3], [0.5, 1], [-0.4, 0.4]], scale: [0.8, 1.2] },
      { to: 'thigh', face: 3, u: [0.4, 0.9], v: [-0.3, 0.3], rot: [[-0.2, 0.2], [-0.3, 0.3], [-0.3, 0.3]], scale: [0.8, 1.2] },
      { to: 'tail', face: 1, u: [-0.9, -0.2], v: 0, rot: [[-0.3, 0.3], [-0.3, 0.3], [-0.9, -0.1]], scale: [0.8, 1.2] },
    ] },
    head: { optional: true, dims: [[0.15, 0.3], [0.15, 0.3], [0.15, 0.3]], joints: ANY, conns: [] },
    upperArm: { optional: true, dims: [[0.2, 0.45], [0.06, 0.12], [0.06, 0.12]], joints: LIMB,
      conns: [{ to: 'forearm', face: 0, u: 0, v: 0, rot: R0, scale: [0.8, 1.2] }] },
    forearm: { dims: [[0.2, 0.45], [0.05, 0.1], [0.05, 0.1]], joints: BEND, conns: [] },
    thigh: { dims: [[0.25, 0.55], [0.08, 0.18], [0.08, 0.18]], joints: LIMB, conns: [{ to: 'shin', face: 0, u: 0, v: 0, rot: R0, scale: [0.8, 1.2] }] },
    shin: { dims: [[0.25, 0.55], [0.07, 0.16], [0.07, 0.16]], joints: BEND, conns: [{ to: 'foot', face: 0, u: 0, v: 0, rot: [[-0.2, 0.2], [-0.2, 0.2], [-0.2, 0.2]], scale: 1 }] },
    // X down (thickness), Y across, Z along: the foot lies flat under the shin
    foot: { dims: [[0.05, 0.12], [0.1, 0.25], [0.2, 0.45]], joints: ['rigid', 'revolute', 'universal'], ground: true, conns: [] },
    tail: { optional: true, dims: [[0.12, 0.35], [0.05, 0.14], [0.05, 0.14]], joints: SEG, recur: [1, 5], ground: true, conns: [chain('tail')] },
  } },
};
// role order = node order; the first role is the root
for (const t of Object.values(TEMPLATES)) t.order = Object.keys(t.roles);

const pickIn = (rng, r) => (Array.isArray(r) ? rng.range(r[0], r[1]) : r);
const clampIn = (x, r) => (Array.isArray(r) ? clamp(x, r[0], r[1]) : r);
const rangeOf = r => (Array.isArray(r) ? r : [r, r]);

// Snap a template genome back onto its template: node count and order, each
// node's role, size ranges, allowed joints and chain lengths, and its
// connections (targets, faces and flags fixed; positions, angles and scales
// clamped into range). Nodes keep their circuits and evolved values.
export function conform(g) {
  const tpl = TEMPLATES[g.plan.type];
  const idx = new Map(tpl.order.map((r, i) => [r, i]));
  g.nodes.length = Math.min(g.nodes.length, tpl.order.length);
  tpl.order.forEach((role, i) => {
    const spec = tpl.roles[role];
    const nd = g.nodes[i] ??= randNode(makeRng(i + 1), {});   // (only a damaged genome is short)
    nd.role = role;
    nd.on = spec.optional ? nd.on !== false : true;
    if (spec.minDim) nd.minDim = spec.minDim; else delete nd.minDim;
    nd.dims = nd.dims.map((x, k) => clampIn(x, spec.dims[k]));
    if (!spec.joints.includes(nd.joint)) nd.joint = spec.joints[Math.max(0, JOINTS.indexOf(nd.joint)) % spec.joints.length];
    nd.recur = Math.round(clampIn(nd.recur, spec.recur || 1));
    nd.conns = spec.conns.map((cs, j) => {
      const c = nd.conns[j] || {};
      const rot = (c.rot || [0, 0, 0]).map((x, k) => clampIn(x, (cs.rot || R0)[k]));
      return { to: idx.get(cs.to), face: cs.face, u: clampIn(c.u ?? 0, cs.u), v: clampIn(c.v ?? 0, cs.v), rot,
        scale: clampIn(c.scale ?? 1, cs.scale), reflect: -1, terminal: !!cs.terminal };
    });
  });
  // connections into a part that's off, or that give way to one that's on
  tpl.order.forEach((role, i) => tpl.roles[role].conns.forEach((cs, j) => {
    const c = g.nodes[i].conns[j];
    c.off = !g.nodes[c.to].on || (cs.unless !== undefined && g.nodes[idx.get(cs.unless)].on);
    if (!c.off) delete c.off;
  }));
  return g;
}

function templateGenome(rng, opts) {
  const tpl = TEMPLATES[opts.plan.type];
  const nodes = tpl.order.map(role => {
    const spec = tpl.roles[role], nd = randNode(rng, opts);
    nd.dims = spec.dims.map(r => Math.exp(rng.range(Math.log(r[0]), Math.log(r[1]))));
    nd.joint = rng.pick(spec.joints);
    const rr = rangeOf(spec.recur || 1);
    nd.recur = rr[0] + rng.int(rr[1] - rr[0] + 1);
    if (spec.optional) nd.on = rng.chance(0.5);
    nd.conns = spec.conns.map(cs => ({
      u: pickIn(rng, cs.u), v: pickIn(rng, cs.v), scale: pickIn(rng, cs.scale),
      rot: (cs.rot || R0).map(r => pickIn(rng, r)),
    }));
    if (nd.recur > 1 && rng.chance(0.5)) addWave(nd, rng);
    return nd;
  });
  const g = { nodes, globals: Array.from({ length: rng.int(3) }, () => randNeuron(rng, 'global')), plan: { ...opts.plan } };
  return conform(g);
}

// One structural change that keeps the template: a part switched on or off,
// a chain longer or shorter, a different joint, a part much longer or
// thinner, an attachment moved within its range, or a travelling wave.
function templateStructural(g, rng, opts) {
  const tpl = TEMPLATES[g.plan.type];
  const roleOf = nd => tpl.roles[nd.role];
  const ops = [
    () => { const os = g.nodes.filter(nd => roleOf(nd).optional); if (!os.length) return false; const nd = rng.pick(os); nd.on = !nd.on; return true; },
    () => { const cs = g.nodes.filter(nd => roleOf(nd).recur); if (!cs.length) return false; const nd = rng.pick(cs); nd.recur += rng.chance(0.5) ? 1 : -1; return true; },
    () => { const nd = rng.pick(g.nodes); if (roleOf(nd).joints.length < 2) return false; nd.joint = rng.pick(roleOf(nd).joints); return true; },
    () => { const nd = rng.pick(g.nodes); const k = rng.int(3); nd.dims[k] *= rng.chance(0.5) ? 1.6 : 0.6; return true; },
    () => {
      const nd = rng.pick(g.nodes); if (!nd.conns.length) return false;
      const j = rng.int(nd.conns.length), cs = roleOf(nd).conns[j];
      nd.conns[j].u = pickIn(rng, cs.u); nd.conns[j].v = pickIn(rng, cs.v); return true;
    },
    () => { const cs = g.nodes.filter(nd => nd.recur > 1); return cs.length ? addWave(rng.pick(cs), rng) : false; },
  ];
  for (let tries = 0; tries < 10; tries++) if (rng.pick(ops)()) break;
  return conform(g);
}
