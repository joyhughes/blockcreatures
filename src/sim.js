// Physical simulation of developed creatures in Rapier, plus Sims' five
// evolutionary targets: swimming, walking, jumping, following a light and
// competing for possession of a cube.
//
// Every body is created with the same orientation (the creature's heading),
// so a body's local frame is the creature's rest frame. Blocks are rotated
// colliders inside their body, which lets each joint be a Rapier generic joint
// whose frame we pick freely. Effectors apply equal and opposite torques
// about the joint's free axes, joint limits are spring torques, both computed
// here rather than by the engine, as in Sims' system.

import RAPIER from './rapier.js';
import { develop, interpenetrates, tooBig, bounds, JOINT_DOFS, NSENS } from './genome.js';
import { compileBrain, brainStep, initBrain } from './brain.js';
import { quatFromMat, qmul, qconj, qrot, qlog, dot, sub, add, scale, cross, len } from './math.js';

let ready = null;
export function initPhysics() { return (ready ||= RAPIER.init()); }

export const DT = 1 / 60;
export const PHYS = {
  strength: 12,      // max effector torque per (cross-section area)^1.5
  servoFreq: 12,     // servo joints: natural frequency (rad/s) of the drive toward the target angle
  servoDamp: 0.7,    //   and its damping ratio
  alphaMax: 150,     // effector torque capped at this angular accel (numerical guard)
  jointDamp: 3,      // joint damping, per unit effective inertia
  solverIterations: 12,
  energyTol: 1.0,    // J/kg of unexplained energy gain treated as a simulation error
  limitReturn: 5, limitReturnMax: 1,   // return speed past a limit: 5 rad/s per rad, at most 1 rad/s
  limitMax: 1.6,     // |joint limit| cap, keeps rotation-vector angles away from the pi wrap
  drag: 3,           // viscosity for water
  friction: 1.0,
  maxSpeed: 30,      // anything faster is a simulation error -> fitness 0
  rolling: 0.3,      // rolling-resistance coefficient for round parts on the ground (soft body, soft ground)
};

export const TASKS = {
  swim: { label: 'Swimming', env: 'water', duration: 10, settle: 0, trials: 1, kind: 'speed' },
  walk: { label: 'Walking', env: 'land', duration: 10, settle: 1.5, trials: 1, kind: 'speed' },
  jump: { label: 'Jumping', env: 'land', duration: 6, settle: 1.5, trials: 1, kind: 'jump' },
  followWater: { label: 'Following (water)', env: 'water', duration: 8, settle: 0, trials: 3, kind: 'follow' },
  followLand: { label: 'Following (land)', env: 'land', duration: 8, settle: 1, trials: 3, kind: 'follow' },
  compete: { label: 'Competition', env: 'land', duration: 10, settle: 0.5, trials: 1, kind: 'compete', pair: true },
};

// Scene parameters, adjustable per run (the UI's Scene section). A run's
// scene travels with its jobs, history and champions; a saved creature
// without one replays under LEGACY_SCENE, the conditions it evolved in.
//   duration   seconds measured after settling (null = the task's own)
//   gravity    m/s^2 on land          friction   ground and body friction
//   drag       water viscosity        lightDist  light's distance (following)
//   ball       'sphere' | 'cube'      ballSize   radius / half side (m)
//   ballMass   kg                     gap        each contestant's start: near side this far from the ball centre
//   gapBody    add the contestant's own length to `gap`, so a tall body can't just topple onto the ball
//   maxVolume  contestants are scaled down to at most this volume (m^3)
export const SCENE = {
  duration: null, gravity: 9.81, friction: 1.0, drag: 3, lightDist: 6,
  ball: 'sphere', ballSize: 0.25, ballMass: 0.15, gap: 2.5, gapBody: true, maxVolume: 0.6,
};
// competition as the bundled champions evolved it: a 0.8 m cube 1.5 m away
export const LEGACY_SCENE = { ball: 'cube', ballSize: 0.4, ballMass: 0.256, gap: 1.5, gapBody: false };
export function sceneFor(taskName, scene) {
  const s = { ...SCENE, ...(scene || LEGACY_SCENE) };
  if (!(s.duration > 0)) s.duration = TASKS[taskName].duration;
  return s;
}
const BALL_ROLL = 0.02;    // rolling resistance of the ball: it rolls far, but stops

const yawQuat = a => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const V = a => ({ x: a[0], y: a[1], z: a[2] });
const A = v => [v.x, v.y, v.z];

// light position for a follow trial: spread around the creature
export function lightPos(task, trial, phase = 0, FOLLOW_DIST = SCENE.lightDist) {
  const n = TASKS[task].trials;
  const a = phase + (trial + 0.5) * 2 * Math.PI / n;
  if (TASKS[task].env === 'water') {
    const el = (trial % 2 ? 0.4 : -0.3);
    return [FOLLOW_DIST * Math.cos(a) * Math.cos(el), FOLLOW_DIST * Math.sin(el), FOLLOW_DIST * Math.sin(a) * Math.cos(el)];
  }
  return [FOLLOW_DIST * Math.cos(a), 0.3, FOLLOW_DIST * Math.sin(a)];
}

// ---- part shapes: 'box', 'sphere', or 'capsule' lying along the part's
// local X. All are in the part's proper frame R; half = bounding half extents.

// Rapier capsules lie along their local Y; this turns local Y onto X.
const CAPSULE_Q = quatFromMat([[0, -1, 0], [1, 0, 0], [0, 0, 1]]);

// half-width of the part along world direction u, given its world axes
function support(p, axes, u) {
  const h = p.half;
  if (p.shape === 'sphere') return h[0];
  if (p.shape === 'cylinder') {
    const c = Math.abs(dot(axes[p.cyl], u));
    return h[p.cyl] * c + h[(p.cyl + 1) % 3] * Math.sqrt(Math.max(0, 1 - c * c));
  }
  if (p.shape === 'capsule') return (h[0] - h[1]) * Math.abs(dot(axes[0], u)) + h[1];
  return h[0] * Math.abs(dot(axes[0], u)) + h[1] * Math.abs(dot(axes[1], u)) + h[2] * Math.abs(dot(axes[2], u));
}

// distance from local point l to the part's surface (0 inside)
function surfaceDist(p, l) {
  const h = p.half;
  if (p.shape === 'sphere') return Math.max(0, Math.hypot(...l) - h[0]);
  if (p.shape === 'cylinder') {
    const c = p.cyl, rho = Math.hypot(l[(c + 1) % 3], l[(c + 2) % 3]);
    return Math.hypot(Math.max(0, rho - h[(c + 1) % 3]), Math.max(0, Math.abs(l[c]) - h[c]));
  }
  if (p.shape === 'capsule') {
    const a = h[0] - h[1], x = Math.max(-a, Math.min(a, l[0]));
    return Math.max(0, Math.hypot(l[0] - x, l[1], l[2]) - h[1]);
  }
  return Math.hypot(Math.max(0, Math.abs(l[0]) - h[0]), Math.max(0, Math.abs(l[1]) - h[1]), Math.max(0, Math.abs(l[2]) - h[2]));
}

// mass (density 1) and principal moments about the part's own axes
export function massProps(p) {
  const h = p.half;
  if (p.shape === 'sphere') {
    const r = h[0], m = 4 / 3 * Math.PI * r ** 3, I = 0.4 * m * r * r;
    return { m, I: [I, I, I] };
  }
  if (p.shape === 'cylinder') {
    const c = p.cyl, r = h[(c + 1) % 3], len = 2 * h[c], m = Math.PI * r * r * len;
    const I = [0, 0, 0].map(() => m * (3 * r * r + len * len) / 12);
    I[c] = m * r * r / 2;
    return { m, I };
  }
  if (p.shape === 'capsule') {
    const r = h[1], len = 2 * (h[0] - h[1]);
    const mc = Math.PI * r * r * len, ms = 4 / 3 * Math.PI * r ** 3;
    const Ix = mc * r * r / 2 + 0.4 * ms * r * r;
    const Ip = mc * (len * len / 12 + r * r / 4) + ms * (0.4 * r * r + len * len / 4 + 3 * len * r / 8);
    return { m: mc + ms, I: [Ix, Ip, Ip] };
  }
  const m = 8 * h[0] * h[1] * h[2];
  return { m, I: [m / 3 * (h[1] ** 2 + h[2] ** 2), m / 3 * (h[2] ** 2 + h[0] ** 2), m / 3 * (h[0] ** 2 + h[1] ** 2)] };
}

function partArea(h) {
  const s = [...h].sort((a, b) => b - a);
  return 4 * s[0] * s[1];
}

export class Creature {
  constructor(world, genome, opts = {}) {
    let { parts } = develop(genome);
    this.genome = genome;
    this.valid = parts.length > 0 && !tooBig(parts) && !interpenetrates(parts);
    this.parts = parts;
    if (!this.valid) return;
    if (opts.maxVolume) {
      const vol = parts.reduce((s, p) => s + massProps(p).m, 0);
      if (vol > opts.maxVolume) {
        const k = Math.cbrt(opts.maxVolume / vol);
        for (const p of parts) {
          p.half = p.half.map(x => x * k); p.center = scale(p.center, k); p.anchor = scale(p.anchor, k);
        }
      }
    }
    this.brain = compileBrain(genome, parts);
    initBrain(this.brain);
    this.sens = this.brain.vals;  // sensors live at the start of the brain's value array

    const q0 = yawQuat(opts.yaw || 0);
    const pos = (opts.pos || [0, 0, 0]).slice();
    // competition: start with the creature's near side `clear` from the origin,
    // plus its own longest dimension if `clearBody`
    if (opts.clear) {
      const [lo, hi] = bounds(parts);
      const len = opts.clearBody ? Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
      pos[0] = opts.side * (opts.clear + len + hi[0]);
    }
    if (opts.ground) {
      let minY = Infinity;
      for (const p of parts) minY = Math.min(minY, p.center[1] - support(p, p.R, [0, 1, 0]));
      pos[1] = -minY + 0.02;
    }
    this.q0 = q0; this.pos0 = pos;

    // bodies and colliders
    this.bodies = []; this.origin = []; this.partBody = [];
    this.colliders = []; this.colliderPart = new Map();
    this.partQ = []; this.partC = [];
    parts.forEach((p, i) => {
      let b;
      if (p.joint === 'rigid') b = this.partBody[p.parent];
      else {
        const o = p.center;
        const wp = add(pos, qrot(q0, o));
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(wp[0], wp[1], wp[2]).setRotation(q0).setCanSleep(false));
        b = this.bodies.length;
        this.bodies.push(body); this.origin.push(o);
      }
      this.partBody.push(b);
      const lc = sub(p.center, this.origin[b]);
      const lq = quatFromMat(p.R);
      this.partC.push(lc); this.partQ.push(lq);
      let cd;
      if (p.shape === 'sphere') cd = RAPIER.ColliderDesc.ball(p.half[0]).setRotation(lq);
      else if (p.shape === 'capsule') cd = RAPIER.ColliderDesc.capsule(p.half[0] - p.half[1], p.half[1]).setRotation(qmul(lq, CAPSULE_Q));
      else if (p.shape === 'cylinder') {
        const r = p.half[(p.cyl + 1) % 3];
        cd = RAPIER.ColliderDesc.cylinder(p.half[p.cyl], r).setRotation(p.cyl === 1 ? lq : qmul(lq, CAPSULE_Q));
      }
      else cd = RAPIER.ColliderDesc.cuboid(p.half[0], p.half[1], p.half[2]).setRotation(lq);
      cd.setTranslation(lc[0], lc[1], lc[2])
        .setDensity(1).setFriction(opts.friction ?? PHYS.friction).setRestitution(0);
      if (opts.groups !== undefined) cd.setCollisionGroups(opts.groups);
      const col = world.createCollider(cd, this.bodies[b]);
      this.colliders.push(col);
      this.colliderPart.set(col.handle, i);
    });
    this.mass = this.bodies.map(b => b.mass());
    this.totalMass = this.mass.reduce((a, b) => a + b, 0);
    this.dragK = opts.drag ?? PHYS.drag;

    // joints
    this.joints = [];
    const effIndex = new Map(this.brain.effectors.map((e, j) => [e.part * 3 + e.axis, j]));
    parts.forEach((p, i) => {
      if (p.parent < 0 || p.joint === 'rigid') return;
      const pb = this.partBody[p.parent], cb = this.partBody[i];
      const a1 = sub(p.anchor, this.origin[pb]), a2 = sub(p.anchor, this.origin[cb]);
      const F = p.R, d = p.d, sigma = [d, d, 1];
      const dofs = JOINT_DOFS[p.joint];
      let jd;
      const L = 7, AX = 8, AY = 16, AZ = 32;
      switch (p.joint) {
        case 'spherical': jd = RAPIER.JointData.spherical(V(a1), V(a2)); break;
        case 'revolute': jd = RAPIER.JointData.generic(V(a1), V(a2), V(F[1]), L | AY | AZ); break;
        case 'twist': jd = RAPIER.JointData.generic(V(a1), V(a2), V(F[0]), L | AY | AZ); break;
        case 'universal': jd = RAPIER.JointData.generic(V(a1), V(a2), V(F[0]), L | AX); break;
        case 'bendtwist': jd = RAPIER.JointData.generic(V(a1), V(a2), V(F[2]), L | AX); break;
        case 'twistbend': jd = RAPIER.JointData.generic(V(a1), V(a2), V(F[1]), L | AX); break;
      }
      const joint = world.createImpulseJoint(jd, this.bodies[pb], this.bodies[cb], true);
      joint.setContactsEnabled(false);
      const par = parts[p.parent];
      // effective inertia of the relative rotation about each joint axis:
      // each body's inertia about the axis through its own centre of mass,
      // in series. That is a lower bound on the true response (the joint can
      // only add inertia), so explicit spring/damping gains scaled by it
      // stay stable.
      const iEff = [0, 1, 2].map(k => {
        const ip = this.inertiaAbout(pb, this.bodyCom(pb), F[k]), ic = this.inertiaAbout(cb, this.bodyCom(cb), F[k]);
        return ip * ic / (ip + ic);
      });
      const strength = PHYS.strength * Math.min(partArea(p.half), partArea(par.half)) ** 1.5;
      const lim = genome.nodes[p.node].limits;
      this.joints.push({
        part: i, pb, cb, F, qF: quatFromMat(F), sigma, dofs, iEff, strength, limits: lim,
        servo: !!this.genome.nodes[p.node].servo,
        eff: dofs.map(a => effIndex.get(i * 3 + a)),
        angle: [0, 0, 0], rate: [0, 0, 0], axis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        mt: [0, 0, 0], mr: [0, 0, 0],
      });
    });
    this.nb = this.bodies.length;
    this.work = 0;
    this.onGround = new Array(parts.length).fill(false);
    this.groundHandle = opts.groundHandle ?? -1;
    this.bt = new Array(this.nb); this.bq = new Array(this.nb);
    this.bv = new Array(this.nb); this.bw = new Array(this.nb); this.bc = new Array(this.nb);
    this.read();
  }

  bodyCom(b) {
    let m = 0, c = [0, 0, 0];
    this.parts.forEach((p, i) => {
      if (this.partBody[i] !== b) return;
      const mi = massProps(p).m;
      m += mi; c = add(c, scale(p.center, mi));
    });
    return scale(c, 1 / m);
  }

  // Inertia of body b (density 1, from its blocks) about the line through
  // point o along unit axis a, all in the creature rest frame.
  inertiaAbout(b, o, a) {
    let I = 0;
    this.parts.forEach((p, i) => {
      if (this.partBody[i] !== b) return;
      const { m, I: Ip } = massProps(p);
      for (let k = 0; k < 3; k++) {
        const c = dot(p.R[k], a);
        I += Ip[k] * c * c;
      }
      const r = sub(p.center, o), ra = dot(r, a);
      I += m * (dot(r, r) - ra * ra);
    });
    return I;
  }

  read() {
    for (let i = 0; i < this.nb; i++) {
      const b = this.bodies[i];
      this.bt[i] = A(b.translation()); this.bq[i] = b.rotation();
      this.bv[i] = A(b.linvel()); this.bw[i] = A(b.angvel()); this.bc[i] = A(b.worldCom());
    }
  }

  partPose(i) {
    const b = this.partBody[i];
    return { c: add(this.bt[b], qrot(this.bq[b], this.partC[i])), q: qmul(this.bq[b], this.partQ[i]) };
  }

  com() {
    let c = [0, 0, 0];
    for (let i = 0; i < this.nb; i++) c = add(c, scale(this.bc[i], this.mass[i]));
    return scale(c, 1 / this.totalMass);
  }

  lowest() {
    let m = Infinity;
    for (let i = 0; i < this.parts.length; i++) {
      const { c, q } = this.partPose(i);
      const axes = [qrot(q, [1, 0, 0]), qrot(q, [0, 1, 0]), qrot(q, [0, 0, 1])];
      m = Math.min(m, c[1] - support(this.parts[i], axes, [0, 1, 0]));
    }
    return m;
  }

  // distance from a point to the creature's nearest block surface
  distanceTo(pt) {
    let best = Infinity;
    for (let i = 0; i < this.parts.length; i++) {
      const { c, q } = this.partPose(i);
      best = Math.min(best, surfaceDist(this.parts[i], qrot(qconj(q), sub(pt, c))));
    }
    return best;
  }

  // Translational kinetic + potential energy: a lower bound on the true
  // mechanical energy, used to catch the simulator creating energy.
  energy(g) {
    let e = 0;
    for (let i = 0; i < this.nb; i++) {
      const v = this.bv[i];
      e += this.mass[i] * (0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + g * this.bc[i][1]);
    }
    return e;
  }

  // Credit the muscle work of the step just taken, using the joint rates
  // before and after it about the same axes.
  creditWork() {
    for (const j of this.joints) {
      for (const k of j.dofs) {
        if (!j.mt[k]) continue;
        const w = sub(this.bw[j.cb], this.bw[j.pb]);
        const r1 = j.sigma[k] * dot(w, j.axis[k]);
        this.work += Math.max(0, j.mt[k] * (j.mr[k] + r1) / 2) * DT;
        j.mt[k] = 0;
      }
    }
  }

  // Full mechanical energy: translation, rotation (world inertia from
  // Rapier), gravity and the energy held in joint-limit springs.
  fullEnergy(g) {
    let e = 0;
    for (let i = 0; i < this.nb; i++) {
      const v = this.bv[i], w = this.bw[i];
      const M = this.bodies[i].effectiveAngularInertia();
      e += this.mass[i] * (0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + g * this.bc[i][1]);
      e += 0.5 * (w[0] * (M.m11 * w[0] + M.m12 * w[1] + M.m13 * w[2]) + w[1] * (M.m12 * w[0] + M.m22 * w[1] + M.m23 * w[2]) + w[2] * (M.m13 * w[0] + M.m23 * w[1] + M.m33 * w[2]));
    }
    return e;
  }

  exploded() {
    for (let i = 0; i < this.nb; i++) {
      const v = this.bv[i], w = this.bw[i];
      const s = Math.hypot(...v), r = Math.hypot(...w);
      if (!(s < PHYS.maxSpeed) || !(r < 100)) return true;
    }
    return false;
  }

  sense(world, target, other) {
    const S = this.sens;
    S.fill(0, 0, this.brain.S);
    for (const j of this.joints) {
      const qp = this.bq[j.pb], qc = this.bq[j.cb];
      // swing-twist decomposition in the joint frame: twist about X (the
      // attachment axis), swing as a rotation vector about Y and Z
      const qj = qmul(qconj(j.qF), qmul(qmul(qconj(qp), qc), j.qF));
      const tw = 2 * Math.atan2(qj.x, qj.w);
      const twist = tw > Math.PI ? tw - 2 * Math.PI : tw < -Math.PI ? tw + 2 * Math.PI : tw;
      const sw = qlog(qmul(qj, { x: -Math.sin(twist / 2), y: 0, z: 0, w: Math.cos(twist / 2) }));
      // twist happens about the child's attachment axis, swing about the
      // parent's bend axes; torques are applied about the same axes
      const wrel = sub(this.bw[j.cb], this.bw[j.pb]);
      j.axis[0] = qrot(qc, j.F[0]);
      j.axis[1] = qrot(qp, j.F[1]);
      j.axis[2] = qrot(qp, j.F[2]);
      const ang = [twist, sw[1], sw[2]];
      for (let k = 0; k < 3; k++) {
        j.angle[k] = j.sigma[k] * ang[k];
        j.rate[k] = j.sigma[k] * dot(wrel, j.axis[k]);
      }
      for (const k of j.dofs) S[j.part * NSENS + k] = j.angle[k];
    }
    // symmetry position: which side / which arm this part belongs to
    for (let i = 0; i < this.parts.length; i++) { S[i * NSENS + 15] = this.parts[i].phase || 0; S[i * NSENS + 16] = this.parts[i].chain || 0; }
    // contact sensors, one per block face
    this.onGround.fill(false);
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i], p = this.parts[i];
      world.contactPairsWith(col, other => {
        world.contactPair(col, other, (m, flipped) => {
          if (m.numContacts() === 0) return;
          if (other.handle === this.groundHandle) this.onGround[i] = true;
          let n = A(flipped ? m.localNormal2() : m.localNormal1());
          if (p.shape === 'capsule' || (p.shape === 'cylinder' && p.cyl === 0)) n = [n[1], -n[0], n[2]];   // collider frame -> part frame
          let k = 0;
          if (Math.abs(n[1]) > Math.abs(n[k])) k = 1;
          if (Math.abs(n[2]) > Math.abs(n[k])) k = 2;
          const s = Math.sign(n[k]) * (k === 2 ? p.d : 1);
          S[i * NSENS + 3 + 2 * k + (s > 0 ? 0 : 1)] = 1;
        });
      });
    }
    // photosensors: normalized direction of the target in each block's frame
    if (target || other) {
      for (let i = 0; i < this.parts.length; i++) {
        const { c, q } = this.partPose(i), d = this.parts[i].d, qi = qconj(q);
        if (target) {
          const v = qrot(qi, sub(target, c)), l = Math.hypot(...v) || 1;
          S[i * NSENS + 9] = v[0] / l; S[i * NSENS + 10] = v[1] / l; S[i * NSENS + 11] = d * v[2] / l;
        }
        if (other) {
          const v = qrot(qi, sub(other, c)), l = Math.hypot(...v) || 1;
          S[i * NSENS + 12] = v[0] / l; S[i * NSENS + 13] = v[1] / l; S[i * NSENS + 14] = d * v[2] / l;
        }
      }
    }
  }

  actuate(active) {
    const out = this.brain.effOut;
    for (const j of this.joints) {
      let tau = [0, 0, 0];
      j.dofs.forEach((k, n) => {
        const ang = j.angle[k], rate = j.rate[k], I = j.iEff[k];
        let t = 0;
        if (active && j.eff[n] !== undefined) {
          const tMax = Math.min(j.strength, I * PHYS.alphaMax);
          if (j.servo) {
            // servo: the output (-1..1) is a target angle across the joint's
            // range, reached by a PD drive within the same torque limit, so a
            // wave of targets becomes a wave of bending rather than torques
            // whose reactions cancel along a chain
            const lo = Math.max(-PHYS.limitMax, j.limits[k][0]), hi = Math.min(PHYS.limitMax, j.limits[k][1]);
            const goal = lo + (Math.max(-1, Math.min(1, out[j.eff[n]])) + 1) / 2 * (hi - lo);
            const w0 = PHYS.servoFreq;
            t = I * (w0 * w0 * (goal - ang) - 2 * PHYS.servoDamp * w0 * rate);
            t = Math.max(-tMax, Math.min(tMax, t));
          } else t = out[j.eff[n]] * tMax;
          // positive muscle work, for energy audits: completed with the
          // rate after the step (trapezoid rule) in creditWork()
          j.mt[k] = t; j.mr[k] = rate;
        }
        t -= PHYS.jointDamp * I * rate;
        const lo = Math.max(-PHYS.limitMax, j.limits[k][0]), hi = Math.min(PHYS.limitMax, j.limits[k][1]);
        // Joint limits are inelastic stops: past a limit, an angular impulse
        // cancels outward motion (including this step's muscle push) and
        // sets a small return speed. Explicit limit springs leaked energy,
        // which evolution amplified into "jumps". Sized with the lower-bound
        // inertia, the impulse can only under-correct, so it never adds energy
        // beyond the small return speed.
        const ex = ang > hi ? ang - hi : ang < lo ? ang - lo : 0;
        if (ex !== 0) {
          const s = Math.sign(ex);
          const target = -s * Math.min(PHYS.limitReturn * Math.abs(ex), PHYS.limitReturnMax);
          const pred = rate + t * DT / I;
          if (s * (pred - target) > 0) t += I * (target - pred) / DT;
        }
        tau = add(tau, scale(j.axis[k], j.sigma[k] * t));
      });
      const imp = scale(tau, DT);
      this.bodies[j.cb].applyTorqueImpulse(V(imp), true);
      this.bodies[j.pb].applyTorqueImpulse(V(scale(imp, -1)), true);
    }
  }

  // Viscous water: every face moving outward is resisted in proportion to its
  // area and normal speed. The normal speed varies across a face when the
  // block rotates, so it is sampled on a 3x3 grid; the force and torque are
  // summed per body and applied once.
  drag() {
    const F = [], T = [];
    for (let b = 0; b < this.nb; b++) { F.push([0, 0, 0]); T.push([0, 0, 0]); }
    for (let i = 0; i < this.parts.length; i++) {
      const b = this.partBody[i];
      const { c, q } = this.partPose(i), h = this.parts[i].half;
      const v0 = this.bv[b], w = this.bw[b], com = this.bc[b];
      const ax = [qrot(q, [1, 0, 0]), qrot(q, [0, 1, 0]), qrot(q, [0, 0, 1])];
      for (let k = 0; k < 3; k++) {
        const n = ax[k], k1 = (k + 1) % 3, k2 = (k + 2) % 3;
        // round parts present about pi/4 of their bounding faces' area
        const dA = 4 * h[k1] * h[k2] / 9 * (this.parts[i].shape === 'box' ? 1 : Math.PI / 4);
        for (const s of [1, -1]) {
          for (let a = -1; a <= 1; a++) {
            for (let bb = -1; bb <= 1; bb++) {
              const r = [
                c[0] - com[0] + n[0] * s * h[k] + ax[k1][0] * a * h[k1] * 2 / 3 + ax[k2][0] * bb * h[k2] * 2 / 3,
                c[1] - com[1] + n[1] * s * h[k] + ax[k1][1] * a * h[k1] * 2 / 3 + ax[k2][1] * bb * h[k2] * 2 / 3,
                c[2] - com[2] + n[2] * s * h[k] + ax[k1][2] * a * h[k1] * 2 / 3 + ax[k2][2] * bb * h[k2] * 2 / 3,
              ];
              const vn = s * dot(add(v0, cross(w, r)), n);
              if (vn <= 0) continue;
              const f = scale(n, -s * this.dragK * dA * vn);
              F[b] = add(F[b], f);
              T[b] = add(T[b], cross(r, f));
            }
          }
        }
      }
    }
    for (let b = 0; b < this.nb; b++) {
      this.bodies[b].applyImpulse(V(scale(F[b], DT)), true);
      this.bodies[b].applyTorqueImpulse(V(scale(T[b], DT)), true);
    }
  }

  // Rolling resistance: Rapier's spheres and capsules roll for free, which
  // evolution turns into frictionless wheels. A round part touching the
  // ground feels a torque against its horizontal spin, of magnitude
  // c * weight * radius (smoothed to viscous below 2 rad/s for stability).
  roll(g) {
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (!this.onGround[i] || p.shape === 'box' || !p.shape) continue;
      const b = this.partBody[i], w = this.bw[b];
      const wh = [w[0], 0, w[2]], sp = Math.hypot(wh[0], wh[2]);
      if (sp < 1e-9) continue;
      const r = p.shape === 'cylinder' ? p.half[(p.cyl + 1) % 3] : p.half[1];
      const mag = PHYS.rolling * massProps(p).m * g * r / Math.max(sp, 2);
      this.bodies[b].applyTorqueImpulse(V(scale(wh, -mag * DT)), true);
    }
  }

  // world-space pose of every block (for rendering)
  poses() {
    return this.parts.map((_, i) => this.partPose(i));
  }
}

// One evaluation run of one task trial with one (or two) creatures.
export class Sim {
  constructor(taskName, genomes, { trial = 0, phase = 0, scene } = {}) {
    const task = this.task = TASKS[taskName];
    const sc = this.scene = sceneFor(taskName, scene);
    this.taskName = taskName;
    this.T = sc.duration;
    const land = task.env === 'land';
    this.g = land ? sc.gravity : 0;
    const world = this.world = new RAPIER.World({ x: 0, y: -this.g, z: 0 });
    world.timestep = DT;
    // extra solver iterations: with 4, contacts on small, light round parts
    // put measurable energy into the system (1 J/kg); 12 brings it to noise
    world.numSolverIterations = PHYS.solverIterations;
    if (land) {
      // an analytic half-space: Rapier's box-vs-cylinder contacts are its
      // least robust, and spinning cylinders on a box floor gained energy
      this.groundHandle = world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setFriction(sc.friction)).handle;
    }
    this.light = task.kind === 'follow' ? lightPos(taskName, trial, phase, sc.lightDist) : null;
    // the competition's ball (or cube); `cube` is the body, whichever shape
    this.cube = null;
    const copts = { friction: sc.friction, drag: sc.drag, groundHandle: this.groundHandle };
    if (task.kind === 'compete') {
      const r = this.ballR = sc.ballSize, sphere = this.ballSphere = sc.ball === 'sphere';
      const vol = sphere ? 4 / 3 * Math.PI * r ** 3 : 8 * r ** 3;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, r, 0).setCanSleep(false));
      world.createCollider((sphere ? RAPIER.ColliderDesc.ball(r) : RAPIER.ColliderDesc.cuboid(r, r, r))
        .setDensity(sc.ballMass / vol).setFriction(sc.friction), body);
      this.cube = body;
      this.creatures = genomes.map((g, i) => new Creature(world, g, { ...copts,
        ground: true, maxVolume: sc.maxVolume,
        side: i ? 1 : -1, clear: sc.gap, clearBody: sc.gapBody, yaw: i ? Math.PI : 0,
      }));
    } else {
      this.creatures = genomes.map(g => new Creature(world, g, { ...copts, ground: land }));
    }
    this.t = 0;
    this.steps = 0;
    this.totalSteps = Math.round((task.settle + this.T) / DT);
    this.failed = this.creatures.map(c => !c.valid);
    this.e0 = this.energy();
    this.xMin = 0;
    this.mass = this.creatures.reduce((s, c) => s + (c.valid ? c.totalMass : 0), 0) + (this.cube ? this.cube.mass() : 0);
    this.track = this.creatures.map(() => ({ start: null, mark: null, maxDist: 0, maxLow: 0, d0: 0 }));
    if (this.creatures.every(c => !c.valid)) this.steps = this.totalSteps;
  }

  get done() { return this.steps >= this.totalSteps; }

  cubePos() { return this.cube ? A(this.cube.translation()) : null; }

  step() {
    const { task, world } = this;
    const active = this.t >= task.settle;
    const cube = this.cubePos();
    const cs = this.creatures;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.valid || this.failed[i]) continue;
      let target = this.light || cube, other = null;
      if (task.pair && cs[1 - i] && cs[1 - i].valid) other = cs[1 - i].com();
      c.sense(world, target, other);
      brainStep(c.brain, DT / 2);
      brainStep(c.brain, DT / 2);
      c.actuate(active);
      if (task.env === 'water') c.drag();
      else c.roll(this.g);
    }
    if (this.ballSphere) this.ballRoll();
    world.step();
    this.t += DT;
    this.steps++;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.valid || this.failed[i]) continue;
      c.read();
      c.creditWork();
      if (c.exploded()) { this.failed[i] = true; continue; }
      if (this.t >= task.settle) this.trackStep(i);
    }
    // Energy audit. x = full mechanical energy (translation, rotation,
    // gravity; creatures and cube) minus the start and minus muscle work.
    // Physics only ever lowers x (friction, drag, damping, inelastic joint
    // stops), so a rise of x above its own running minimum is energy the
    // simulator created. Tracking the rise, rather than x itself, stops
    // earlier losses (a hard landing) from masking a later gain. Honest
    // creatures stay under ~0.5 J/kg; past 1 J/kg nobody scores.
    let work = 0;
    cs.forEach(c => { if (c.valid) work += c.work; });
    const x = this.energy() - this.e0 - work;
    this.xMin = Math.min(this.xMin, x);
    if (x - this.xMin > PHYS.energyTol * this.mass + 0.02) this.failed = cs.map(() => true);
  }

  // rolling resistance for the ball, as for creatures' round parts (Creature.roll)
  ballRoll() {
    const b = this.cube, r = this.ballR;
    if (b.translation().y > r + 0.01) return;
    const w = b.angvel(), sp = Math.hypot(w.x, w.z);
    if (sp < 1e-9) return;
    const mag = BALL_ROLL * b.mass() * this.g * r / Math.max(sp, 2);
    b.applyTorqueImpulse({ x: -w.x * mag * DT, y: 0, z: -w.z * mag * DT }, true);
  }

  energy() {
    let e = 0;
    this.creatures.forEach(c => { if (c.valid) e += c.fullEnergy(this.g); });
    if (this.cube) {
      const v = this.cube.linvel(), w = this.cube.angvel(), m = this.cube.mass();
      const r = this.ballR, I = this.ballSphere ? 0.4 * m * r * r : m * (2 * r) ** 2 / 6;
      e += m * (0.5 * (v.x * v.x + v.y * v.y + v.z * v.z) + this.g * this.cube.translation().y);
      e += 0.5 * I * (w.x * w.x + w.y * w.y + w.z * w.z);
    }
    return e;
  }

  trackStep(i) {
    const c = this.creatures[i], tr = this.track[i], task = this.task;
    const elapsed = this.t - task.settle;
    // On land, falling isn't moving: a tall creature that topples carries its
    // centre of mass forward about as far as it drops (H/2 for a stick of
    // height H). So the COM's drop below its height when measuring began
    // (and below its height at the final-third mark) is subtracted from the
    // distance. A walker's COM bobs but doesn't fall, so it loses ~nothing.
    const y = c.com()[1];
    if (task.env === 'land') {
      if (tr.y0 === undefined) tr.y0 = tr.minY = y;
      tr.minY = Math.min(tr.minY, y);
      if (tr.yMark !== undefined) tr.minYMark = Math.min(tr.minYMark, y);
    }
    if (task.kind === 'speed') {
      let p = c.com();
      if (task.env === 'land') p = [p[0], 0, p[2]];
      if (!tr.start) tr.start = p;
      tr.maxDist = Math.max(tr.maxDist, len(sub(p, tr.start)));
      if (!tr.mark && elapsed >= this.T * 2 / 3) { tr.mark = p; tr.yMark = tr.minYMark = y; }
      tr.last = p;
    } else if (task.kind === 'jump') {
      // the lowest part's height counts only as far as the COM has also risen
      // above its height when measuring began: a tall body that topples
      // swings its grounded parts up while its COM falls, which isn't a jump
      tr.maxLow = Math.max(tr.maxLow, Math.min(c.lowest(), y - tr.y0));
    } else if (task.kind === 'follow') {
      const d = len(sub(c.com(), this.light));
      if (tr.start === null) tr.start = d;
      tr.last = d;
    }
  }

  // fitness of each creature in this trial
  fitness() {
    const task = this.task, T = this.T;
    if (task.kind === 'compete') {
      const cube = this.cubePos();
      const d = this.creatures.map((c, i) => (c.valid && !this.failed[i] ? c.distanceTo(cube) : Infinity));
      if (d.length < 2) return [d[0] === Infinity ? 0 : 1];
      const [a, b] = d;
      // a blown-up simulation can't be blamed on one side: nobody scores
      if (a === Infinity || b === Infinity) return [0, 0];
      const s = a + b + 1e-6;
      return [1 + (b - a) / s, 1 + (a - b) / s];
    }
    return this.creatures.map((c, i) => {
      if (!c.valid || this.failed[i]) return 0;
      const tr = this.track[i];
      if (task.kind === 'speed') {
        if (!tr.start || !tr.mark) return 0;
        // Sims: straight movement rewarded via max distance from the start;
        // continuing movement rewarded by weighting the final phase.
        const drop = tr.y0 === undefined ? 0 : tr.y0 - tr.minY;
        const dropLate = tr.yMark === undefined ? 0 : tr.yMark - tr.minYMark;
        return Math.max(0, 0.5 * (tr.maxDist - drop) / T + 0.5 * Math.max(0, len(sub(tr.last, tr.mark)) - dropLate) / (T / 3));
      }
      if (task.kind === 'jump') return Math.max(0, tr.maxLow);
      if (task.kind === 'follow') return tr.start === null ? 0 : (tr.start - tr.last - (tr.y0 === undefined ? 0 : tr.y0 - tr.minY)) / T;
      return 0;
    });
  }

  free() { this.world.free(); }
}

// Run a full evaluation (all trials) and return fitness per genome.
export function evaluate(taskName, genomes, opts = {}) {
  const task = TASKS[taskName];
  const sum = genomes.map(() => 0);
  for (let trial = 0; trial < task.trials; trial++) {
    const sim = new Sim(taskName, genomes, { ...opts, trial });
    while (!sim.done) sim.step();
    sim.fitness().forEach((f, i) => { sum[i] += f; });
    sim.free();
  }
  return sum.map(s => s / task.trials);
}
