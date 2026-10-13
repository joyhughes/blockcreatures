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
import { develop, interpenetrates, tooBig, bounds, JOINT_DOFS, NSENS, TEMPLATES } from './genome.js';
import { compileBrain, brainStep, initBrain } from './brain.js';
import { quatFromMat, qmul, qconj, qrot, qlog, dot, sub, add, scale, cross, len } from './math.js';

let ready = null;
export function initPhysics() { return (ready ||= RAPIER.init()); }

export const DT = 1 / 60;
export const PHYS = {
  strength: 12,      // max effector torque per (cross-section area)^1.5
  servoFreq: 12,     // servo joints: natural frequency (rad/s) of the drive toward the target angle
  servoDamp: 0.7,    //   and its damping ratio
  // reflexes run on Rapier's joint motors, which are implicit: a motor drives
  // the joint toward a target turning rate with whatever torque that takes,
  // up to the muscle's strength, and stays stable however light the parts
  toneRate: 8,       // tone: target turning rate back toward the built angle, per rad off it (1/s)
  reflexRate: 6,     // level and brace: target turning rate toward the built orientation, per rad off it (1/s)
  reflexGain: 5,    // how hard a motor holds its target rate: full force at 1/this rad/s off it
                     // (force-based motors; Rapier's acceleration-based ones didn't hold a load;
                     // at 20 the motors were near-rigid and the solver gained energy at impacts)
  reflexMaxRate: 8,  // target rates are capped at this (rad/s)
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
  // at the surface: gravity and buoyancy, water below and air above
  surfaceSwim: { label: 'Surface swimming', env: 'surface', duration: 10, settle: 2, trials: 1, kind: 'speed' },
  walk: { label: 'Walking', env: 'land', duration: 10, settle: 1.5, trials: 1, kind: 'speed' },
  jump: { label: 'Jumping', env: 'land', duration: 6, settle: 1.5, trials: 1, kind: 'jump' },
  followWater: { label: 'Following (water)', env: 'water', duration: 8, settle: 0, trials: 3, kind: 'follow' },
  followLand: { label: 'Following (land)', env: 'land', duration: 8, settle: 1, trials: 3, kind: 'follow' },
  // scene duration 20 s: a 10 s game rarely gave them time to reach the ball
  // (runs whose scene says null keep the task's 10 s)
  compete: { label: 'Competition', env: 'land', duration: 10, settle: 0.5, trials: 1, kind: 'compete', pair: true,
    scene: { ballSize: 0.25, ballMass: 0.15, duration: 20 } },
  // both start behind a heavy ball and share one score for getting it into
  // the goal: progress toward it, or 1 + the share of time left on scoring
  cooperate: { label: 'Cooperation', env: 'land', duration: 15, settle: 0.5, trials: 1, kind: 'cooperate', pair: true,
    scene: { ballSize: 0.35, ballMass: 0.6 } },
  // facing each other across a light ball, they share one score: how many
  // times they pass it back and forth
  volley: { label: 'Volley', env: 'land', duration: 20, settle: 0.5, trials: 1, kind: 'volley', pair: true,
    scene: { ballSize: 0.25, ballMass: 0.15, gap: 1.5, duration: 20 } },
  // face to face, no ball: whoever pushes the other back further
  wrestle: { label: 'Wrestling', env: 'land', duration: 20, settle: 0.5, trials: 1, kind: 'wrestle', pair: true,
    scene: { gap: 0.1, duration: 20 } },
  // from a pit at the bottom of a square stepped amphitheatre, climb
  stairs: { label: 'Stairs', env: 'land', duration: 20, settle: 1, trials: 1, kind: 'climb',
    scene: { duration: 20 } },
  // walking without falling: the biped or quadruped body plan, and only the
  // parts its template marks `ground` (feet, paws, toes, tail) may touch the
  // ground; settling is timed, brain on, so it can stand up
  biped: { label: 'Biped walking', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'upright', plan: 'biped',
    scene: { settle: 'timed' } },
  quadruped: { label: 'Quadruped walking', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'upright', plan: 'quadruped',
    scene: { settle: 'timed' } },
  // a light cube on the ground beside it: lift it as high as it can hold it
  // stand up from lying or sitting (scene `start`), and stay up
  getUp: { label: 'Getting up', env: 'land', duration: 10, settle: 0.5, trials: 1, kind: 'getup', scene: { settle: 'timed' } },
  lift: { label: 'Lifting', env: 'land', duration: 15, settle: 1, trials: 1, kind: 'lift',
    scene: { ball: 'barbell', ballSize: 0.2, ballMass: 0.3, duration: 15 } },
};
// targets that came after scenes: a run without one has no legacy scene
const NEW_KINDS = ['cooperate', 'volley', 'wrestle', 'climb', 'lift', 'upright', 'getup'];

// Scene parameters, adjustable per run (the UI's Scene section). A run's
// scene travels with its jobs, history and champions; a saved creature
// without one replays under LEGACY_SCENE, the conditions it evolved in.
//   duration   seconds measured after settling (null = the task's own)
//   gravity    m/s^2 on land          friction   ground and body friction
//   drag       water viscosity        lightDist  light's distance (following)
//   start      getting up: the pose it starts in, 'side' (rolled onto its side), 'back' (upside
//              down) or 'sitting' (pitched back 60 degrees, rump down)
//   buoyancy   surface swimming: water's density relative to the creatures' (1.5 floats a
//              creature about two thirds under)
//   ball       'sphere' | 'cube' | 'barbell' (lifting: a bar between two plates, the bar
//              off the ground so a part can get under it)
//              ballSize   radius / half side (m); a barbell's plate radius
//   ballMass   kg                     gap        start distance from the ball centre, at ground level
//   zone       starting zone (as Sims): 'plane' = behind a plane rising from the ground `gap` from
//              the ball at `slope` degrees, so taller bodies start further back; 'length' = the
//              contestant's longest dimension is added to `gap`; 'none' = near side at `gap`
//   slope      the plane's angle above the ground (45 = a point at height h starts h further back)
//   maxVolume  contestants are scaled down to at most this volume (m^3)
//   sameSize   ... and scaled up to it too: every contestant has exactly maxVolume
//   grip       Sims' control bonus: touching the ball on the far side from your own centre of mass
//              (wrapping around it) shortens your distance by up to the ball's radius
//   metric     competition's distance to the ball: 'com' (Sims) = from the centre of mass to the
//              ball's centre; 'surface' = from the nearest part, so any touch counts as 0
//   settle     on land, before scoring: 'stable' (Sims) = no friction and no muscles until the
//              centre of mass stops dropping; 'timed' = the task's fixed settle time, friction on
//   apart      competition and cooperation, settle 'stable': each creature relaxes on its own,
//              well clear of the ball and the other creature and with its brain idle, then
//              moves into its start zone; false = relaxes in place against the zone, sensing
//   goalDist   cooperation: the goal's centre, this far from the ball's start (m), away from the creatures
//   goalSize   cooperation: the goal's radius; the ball is in when its centre is inside
//   stepHeight, stepDepth, steps   stairs: each step's rise and tread (m), and how many
//   ring       wrestling: the ring's radius (m) around the middle
//   engage     wrestling: points both wrestlers get for the share of the bout they're in contact
//   bothSides  two-creature games: each bout is played twice, swapping which creature is
//              simulated first, and the scores averaged. Rapier solves in a fixed order, so
//              side A can win a mirror match outright, and evolution exploited being side A
//   together   cooperation: the share of the score (0..1) given for the share of the measured time
//              both creatures touch the ball at once
export const SCENE = {
  duration: null, gravity: 9.81, friction: 1.0, drag: 3, lightDist: 6, buoyancy: 1.5, start: 'side',
  ball: 'sphere', ballSize: 0.25, ballMass: 0.15, gap: 1, zone: 'plane', slope: 45, maxVolume: 1, sameSize: true, grip: true,
  settle: 'stable', goalDist: 3, goalSize: 0.6, metric: 'surface', apart: true, together: 0.2,
  stepHeight: 0.15, stepDepth: 0.4, steps: 12, ring: 2, engage: 0.5, bothSides: true,
};
// competition as the bundled champions evolved it: a 0.8 m cube 1.5 m away
export const LEGACY_SCENE = { ball: 'cube', ballSize: 0.4, ballMass: 0.256, gap: 1.5, zone: 'none', grip: false, settle: 'timed', metric: 'surface', apart: false, together: 0, sameSize: false, bothSides: false, engage: 0 };
// a task's default scene: SCENE with the task's own ball
export const defaultScene = taskName => ({ ...SCENE, ...(TASKS[taskName].scene || {}) });
export function sceneFor(taskName, scene) {
  // scenes saved before a setting existed get its old behaviour; cooperation
  // came after scenes, so it has no legacy scene
  const old = scene && { zone: scene.gapBody ? 'length' : 'none', grip: false, settle: 'timed', metric: 'surface', apart: false, together: 0, sameSize: false, bothSides: false, engage: 0 };
  const legacy = NEW_KINDS.includes(TASKS[taskName].kind) ? {} : LEGACY_SCENE;
  const s = { ...defaultScene(taskName), ...(scene ? old : legacy), ...(scene || {}) };
  if (!(s.duration > 0)) s.duration = TASKS[taskName].duration;
  return s;
}
const RELAX_STILL = 0.5;   // stable: the centre of mass hasn't dropped for this long (s)
const RELAX_MIN = 0.3, RELAX_MAX = 5;   // ... but at least / at most this long
const BALL_ROLL = 0.02;
const APART = 50;   // settling apart: each creature this far to the side (m)
const WRESTLE_SCALE = 1;   // wrestling: this much further (m) outside the ring than the other is a full loss
const WRESTLE_CENTRE = 0.5;   // wrestling: weight of holding the middle (mean distance from it, in ring radii)
// Rapier axis numbers (3-5 = rotation about the joint frame's X, Y, Z) left
// free by each joint type, as created in Creature
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const MOTOR_AXES = { spherical: [3, 4, 5], revolute: [3], twist: [3], universal: [4, 5], bendtwist: [4, 5], twistbend: [4, 5] };
// getting up: start poses, turned from the built (standing) pose; X is forward, Z to the side
const START_POSE = {
  side: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },           // rolled 90 degrees onto its side
  back: { x: 1, y: 0, z: 0, w: 0 },                                  // upside down
  sitting: { x: 0, y: 0, z: Math.sin(Math.PI / 6), w: Math.cos(Math.PI / 6) },   // pitched back 60 degrees, nose up
};
const BUOY_BAND = 0.05;   // surface water: buoyancy on a sample point fades in over this depth (m)
// share of a sample point's buoyancy at height y (0 above the band, 1 below),
// and its potential: dP/dy = -wet(y), so buoyancy is conservative
const wet = y => Math.max(0, Math.min(1, 0.5 - y / BUOY_BAND));
const wetP = y => (y <= -BUOY_BAND / 2 ? -y : y >= BUOY_BAND / 2 ? 0 : (BUOY_BAND / 2 - y) ** 2 / (2 * BUOY_BAND));
const STAIR_MARGIN = 0.3;   // stairs: the pit reaches this far (m) past the creature's widest point
const STAIR_TOP = 10;   // stairs: the top step is a plateau this wide (m), so climbing over it can't fall off the far side
const LIFT_GAP = 0.3;   // lifting: the cube starts this far (m) beyond the creature's furthest point in +x
const LIFT_HOLD = 1;   // lifting: the cube's height is averaged over the last this many seconds
const PASS_MIN = 0.5;   // volley: the ball travels at least this far (m) between the two creatures' touches
const COOP_SPACING = 0.5;   // cooperation: gap between the two creatures at the start (m)    // rolling resistance of the ball: it rolls far, but stops

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
    this.world = world;
    this.valid = parts.length > 0 && !tooBig(parts) && !interpenetrates(parts);
    this.parts = parts;
    if (!this.valid) return;
    if (opts.maxVolume) {
      const vol = parts.reduce((s, p) => s + massProps(p).m, 0);
      if (vol > opts.maxVolume || opts.sameSize) {
        const k = Math.cbrt(opts.maxVolume / vol);
        for (const p of parts) {
          p.half = p.half.map(x => x * k); p.center = scale(p.center, k); p.anchor = scale(p.anchor, k);
        }
      }
    }
    this.brain = compileBrain(genome, parts);
    initBrain(this.brain);
    this.sens = this.brain.vals;  // sensors live at the start of the brain's value array

    // opts.tilt: a start pose turned from the built one (getting up)
    const q0 = opts.tilt ? qmul(yawQuat(opts.yaw || 0), opts.tilt) : yawQuat(opts.yaw || 0);
    const pos = (opts.pos || [0, 0, 0]).slice();
    // competition: start with the creature's near side `clear` from the origin,
    // plus its own longest dimension if `clearBody`
    if (opts.clear) {
      const [lo, hi] = bounds(parts);
      const len = opts.clearBody ? Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
      pos[0] = opts.side * (opts.clear + len + hi[0]);
    }
    // the built pose standing on the ground: its centre of mass's height
    {
      let minY = Infinity, m = 0, cy = 0;
      for (const p of parts) { minY = Math.min(minY, p.center[1] - support(p, p.R, [0, 1, 0])); const pm = massProps(p).m; m += pm; cy += pm * p.center[1]; }
      this.standY = cy / m - minY;
      // its feet: the parts within 3 cm of the ground as built (for plans
      // without a template's ground parts)
      this.feet = new Set(parts.map((p, k) => (p.center[1] - support(p, p.R, [0, 1, 0]) <= minY + 0.03 ? k : -1)).filter(k => k >= 0));
    }
    if (opts.ground || opts.float) {
      // which way is up in the creature's frame, in its start pose
      const u = opts.tilt ? qrot(qconj(q0), [0, 1, 0]) : [0, 1, 0];
      let minY = Infinity, maxY = -Infinity;
      for (const p of parts) {
        minY = Math.min(minY, dot(p.center, u) - support(p, p.R, u));
        maxY = Math.max(maxY, dot(p.center, u) + support(p, p.R, u));
      }
      // floating: as deep as a box of uniform density would (1 / buoyancy of its height)
      pos[1] = opts.float ? -minY - (maxY - minY) / opts.float : -minY + 0.02;
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
      const iP = [], iC = [];
      const iEff = [0, 1, 2].map(k => {
        const ip = this.inertiaAbout(pb, this.bodyCom(pb), F[k]), ic = this.inertiaAbout(cb, this.bodyCom(cb), F[k]);
        iP.push(ip); iC.push(ic);
        return ip * ic / (ip + ic);
      });
      // reflexes: gains, and which way is up in each part's own frame as built
      const rf = genome.nodes[p.node].reflex || [0, 0, 0];
      const upOf = k => qrot(qconj(this.partQ[k]), [0, 1, 0]);
      const strength = PHYS.strength * Math.min(partArea(p.half), partArea(par.half)) ** 1.5;
      const lim = genome.nodes[p.node].limits;
      this.joints.push({
        part: i, pb, cb, F, qF: quatFromMat(F), sigma, dofs, iEff, strength, limits: lim,
        servo: !!this.genome.nodes[p.node].servo,
        reflex: rf, anyReflex: rf.some(x => x > 0), iP, iC, pp: p.parent, upC: upOf(i), upP: upOf(p.parent),
        // Rapier's motor axes: the free angular axes of the joint's frame on the parent
        handle: joint.handle, f1: joint.frameX1(), raxes: MOTOR_AXES[p.joint], mTarget: [0, 0, 0], mRate: [0, 0, 0], mMax: 0, motors: false,
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

  // min over the creature's points of dot(point, w), w any direction
  minAlong(w) {
    const n = len(w), u = scale(w, 1 / n);
    let m = Infinity;
    for (let i = 0; i < this.parts.length; i++) {
      const { c, q } = this.partPose(i);
      const axes = [qrot(q, [1, 0, 0]), qrot(q, [0, 1, 0]), qrot(q, [0, 0, 1])];
      m = Math.min(m, dot(c, w) - n * support(this.parts[i], axes, u));
    }
    return m;
  }

  // move the whole creature rigidly (joints are unaffected)
  shift(d) {
    for (const b of this.bodies) { const t = b.translation(); b.setTranslation({ x: t.x + d[0], y: t.y + d[1], z: t.z + d[2] }, true); }
    this.read();
  }

  setFriction(f) { for (const col of this.colliders) col.setFriction(f); }

  // closest point of part i to world point pt (box-like clamp; exact for boxes)
  closestPoint(i, pt) {
    const { c, q } = this.partPose(i), p = this.parts[i], h = p.half;
    const l = qrot(qconj(q), sub(pt, c));
    let k;
    if (p.shape === 'sphere') { const d = len(l); k = d > h[0] ? scale(l, h[0] / d) : l; }
    else if (p.shape === 'capsule') {
      const a = Math.max(-(h[0] - h[1]), Math.min(h[0] - h[1], l[0])), r = sub(l, [a, 0, 0]), d = len(r);
      k = add([a, 0, 0], d > h[1] ? scale(r, h[1] / d) : r);
    } else k = l.map((x, j) => Math.max(-h[j], Math.min(h[j], x)));
    return add(c, qrot(q, k));
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
      // reflex motors: Rapier doesn't report the torque a motor applied, so
      // each is credited its most (full force times the turning rate) while
      // the joint turns the way the motor drives it, and nothing otherwise. The
      // audit can only be lenient here, never fail an honest reflex.
      if (j.motors) {
        const fq = qmul(this.bq[j.pb], j.f1), wrel = sub(this.bw[j.cb], this.bw[j.pb]);
        j.raxes.forEach((r, n) => {
          const rate = (j.mRate[n] + dot(wrel, qrot(fq, AXES[r - 3]))) / 2;
          if (rate * j.mTarget[n] > 0) this.work += j.mMax * Math.abs(rate) * DT;
        });
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
    // balance: up and spin in each part's frame (z mirrored for mirrored
    // parts; spin is an axial vector, so its x and y flip instead)
    for (let i = 0; i < this.parts.length; i++) {
      const { q } = this.partPose(i), qi = qconj(q), d = this.parts[i].d;
      const up = qrot(qi, [0, 1, 0]), w = qrot(qi, this.bw[this.partBody[i]]), o = i * NSENS;
      S[o + 17] = up[0]; S[o + 18] = up[1]; S[o + 19] = d * up[2];
      S[o + 20] = d * w[0]; S[o + 21] = d * w[1]; S[o + 22] = w[2];
    }
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

  // Reflexes: each joint's motors get a target turning rate for the child
  // relative to its parent, blended from the three loops by their gains:
  //   tone   back toward the built angle (held within the joint's limits)
  //   level  the child toward its built orientation to gravity, cancelling the
  //          parent's tumbling, so a head stays level while the body moves
  //   brace  the parent toward its built orientation, which a planted limb
  //          turns into righting the body
  // Orientation errors are rotation vectors e = (built up, now) x (world up);
  // spin about the vertical is left free. With reflexes off, motors go slack.
  reflexMotors(on) {
    const raw = this.world.impulseJoints.raw;
    for (const j of this.joints) {
      if (!j.anyReflex) continue;
      const [tone, level, brace] = j.reflex, gs = tone + level + brace;
      const max = on ? j.strength * Math.min(1, gs) : 0;
      if (!on) {
        if (j.motors) for (const r of j.raxes) raw.jointSetMotorMaxForce(j.handle, r, 0);
        j.motors = false; j.mMax = 0;
        continue;
      }
      const tumble = w => [w[0], 0, w[2]];
      const wP = this.bw[j.pb], wC = this.bw[j.cb];
      let goal = [0, 0, 0];
      if (tone > 0) {
        // the joint's rotation from its built angle (or the nearest angle its limits allow)
        let th = [0, 0, 0];
        for (const k of j.dofs) {
          const lo = Math.max(-PHYS.limitMax, j.limits[k][0]), hi = Math.min(PHYS.limitMax, j.limits[k][1]);
          th = add(th, scale(j.axis[k], j.sigma[k] * (j.angle[k] - Math.max(lo, Math.min(hi, 0)))));
        }
        goal = add(goal, scale(th, -tone * PHYS.toneRate));
      }
      const e = (part, upLocal) => { const u = qrot(this.partPose(part).q, upLocal); return [-u[2], 0, u[0]]; };   // u x (0, 1, 0)
      if (level > 0) goal = add(goal, scale(sub(scale(e(j.part, j.upC), PHYS.reflexRate), tumble(wP)), level));
      if (brace > 0) goal = add(goal, scale(sub(tumble(wC), scale(e(j.pp, j.upP), PHYS.reflexRate)), brace));
      goal = scale(goal, 1 / gs);
      const fq = qmul(this.bq[j.pb], j.f1), wrel = sub(wC, wP);
      j.raxes.forEach((r, n) => {
        const b = qrot(fq, AXES[r - 3]);
        const target = Math.max(-PHYS.reflexMaxRate, Math.min(PHYS.reflexMaxRate, dot(goal, b)));
        if (!j.motors) raw.jointConfigureMotorModel(j.handle, r, 1);   // force-based
        raw.jointConfigureMotorVelocity(j.handle, r, target, PHYS.reflexGain * j.strength);
        raw.jointSetMotorMaxForce(j.handle, r, max);
        j.mTarget[n] = target; j.mRate[n] = dot(wrel, b);
      });
      j.motors = true; j.mMax = max;
    }
  }



  // reflexes: whether the reflex loops run (off only while relaxing as Sims did)
  actuate(active, reflexes = false) {
    this.reflexMotors(reflexes);
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
  // At the surface (`surface`), only the submerged share of each sample counts.
  drag(surface = false) {
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
              const under = surface ? wet(com[1] + r[1]) : 1;
              if (under <= 0) continue;
              const f = scale(n, -s * this.dragK * dA * vn * under);
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

  // Surface water: buoyancy. Each part is sampled on a 3x3x3 grid (points
  // inside its shape), each point carrying an equal share of the part's
  // volume; a submerged point is pushed up by rho * g * its volume. The force
  // fades in across BUOY_BAND at the surface, and buoyEnergy is its potential,
  // so the energy audit covers it.
  buoySamples() {
    if (this.bs) return this.bs;
    this.bs = this.parts.map(p => {
      const pts = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const l = [a * p.half[0] * 2 / 3, b * p.half[1] * 2 / 3, c * p.half[2] * 2 / 3];
        if (surfaceDist(p, l) === 0) pts.push(l);
      }
      const v = massProps(p).m / pts.length;
      return pts.map(l => ({ l, v }));
    });
    return this.bs;
  }
  buoy(rho, g) {
    const F = [], T = [], bs = this.buoySamples();
    for (let b = 0; b < this.nb; b++) { F.push(0); T.push([0, 0, 0]); }
    for (let i = 0; i < this.parts.length; i++) {
      const b = this.partBody[i], { c, q } = this.partPose(i), com = this.bc[b];
      for (const { l, v } of bs[i]) {
        const pt = add(c, qrot(q, l)), u = wet(pt[1]);
        if (u <= 0) continue;
        const f = rho * g * v * u, r = sub(pt, com);
        F[b] += f;
        T[b] = add(T[b], cross(r, [0, f, 0]));
      }
    }
    for (let b = 0; b < this.nb; b++) {
      this.bodies[b].applyImpulse({ x: 0, y: F[b] * DT, z: 0 }, true);
      this.bodies[b].applyTorqueImpulse(V(scale(T[b], DT)), true);
    }
  }
  buoyEnergy(rho, g) {
    let e = 0;
    const bs = this.buoySamples();
    for (let i = 0; i < this.parts.length; i++) {
      const { c, q } = this.partPose(i);
      for (const { l, v } of bs[i]) e += rho * g * v * wetP(c[1] + qrot(q, l)[1]);
    }
    return e;
  }
  // Surface water: a face whose centre is under water feels it, on the
  // face's contact sensor, the way a face touching the ground does
  feelWater() {
    const S = this.sens;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i], { c, q } = this.partPose(i);
      for (let k = 0; k < 3; k++) for (const sg of [1, -1]) {
        const l = [0, 0, 0]; l[k] = sg * p.half[k];
        if (c[1] + qrot(q, l)[1] >= 0) continue;
        const s = sg * (k === 2 ? p.d : 1);
        S[i * NSENS + 3 + 2 * k + (s > 0 ? 0 : 1)] = 1;
      }
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
    // surface water has gravity too (the scene's); deep water has none
    this.surface = task.env === 'surface';
    this.g = land || this.surface ? sc.gravity : 0;
    // Sims' settling: relax with no friction and no muscles until the centre
    // of mass stops dropping; toppling then can't carry the body anywhere
    this.relaxing = land && sc.settle === 'stable';
    const world = this.world = new RAPIER.World({ x: 0, y: -this.g, z: 0 });
    world.timestep = DT;
    // extra solver iterations: with 4, contacts on small, light round parts
    // put measurable energy into the system (1 J/kg); 12 brings it to noise
    world.numSolverIterations = PHYS.solverIterations;
    if (land) {
      // an analytic half-space: Rapier's box-vs-cylinder contacts are its
      // least robust, and spinning cylinders on a box floor gained energy
      this.groundCol = world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setFriction(this.relaxing ? 0 : sc.friction));
      this.groundHandle = this.groundCol.handle;
    }
    this.light = task.kind === 'follow' ? lightPos(taskName, trial, phase, sc.lightDist) : null;
    // the competition's ball (or cube); `cube` is the body, whichever shape
    this.cube = null;
    const copts = { friction: this.relaxing ? 0 : sc.friction, drag: sc.drag, groundHandle: this.groundHandle };
    if (task.pair) {
      const coop = this.coop = task.kind === 'cooperate';
      // volley: passes so far; who touched the ball last, and where it was
      // when they last touched it; whether each has touched it at all
      if ((this.volley = task.kind === 'volley')) Object.assign(this, { passes: 0, lastTouch: -1, lastPos: null, touched: [false, false] });
      this.wrestle = task.kind === 'wrestle';
      if (!this.wrestle) this.addBall([0, 0, 0]);
      else { this.ring = sc.ring; this.boutSteps = this.contactSteps = 0; }
      this.creatures = genomes.map((g, i) => new Creature(world, g, { ...copts,
        ground: true, maxVolume: sc.maxVolume, sameSize: sc.sameSize,
        side: i && !coop ? 1 : -1, yaw: i && !coop ? Math.PI : 0,
        clear: sc.gap, clearBody: sc.zone === 'length',
      }));
      // cooperation: both behind the ball, side by side with their near sides
      // COOP_SPACING apart across the line to the goal
      if (coop) {
        this.goal = [sc.goalDist, 0, 0];
        this.scored = null;   // seconds into the measured time when the ball went in
        this.playSteps = this.bothSteps = 0;   // measured steps, and those with both touching the ball
        this.creatures.forEach((c, i) => {
          if (!c.valid) return;
          const s = i ? 1 : -1;
          c.shift([0, 0, s * COOP_SPACING / 2 - c.minAlong([0, 0, s]) * s]);
        });
      }
      // the plane zone: placed against it as built, and kept against it
      // every step while relaxing (relaxStep)
      if (sc.zone === 'plane') this.placeInZone();
      // settling apart: off to either side, so nothing about the ball or the
      // other creature can shape how a body settles (frictionless ground:
      // where it is doesn't matter); back into place when measuring starts
      if (this.relaxing && sc.apart) {
        this.apart = this.creatures.map((c, i) => (i ? APART : -APART));
        this.creatures.forEach((c, i) => { if (c.valid) c.shift([0, 0, this.apart[i]]); });
      }
    } else {
      this.creatures = genomes.map(g => new Creature(world, g, { ...copts, ground: land, float: this.surface ? sc.buoyancy : 0,
        tilt: task.kind === 'getup' ? START_POSE[sc.start] || START_POSE.side : null }));
      if (task.kind === 'climb') this.buildStairs();
      // lifting: the cube appears when measuring starts (addBall), so the
      // creature can't settle onto it; its height over the last LIFT_HOLD s
      if ((this.lift = task.kind === 'lift')) Object.assign(this, { liftSum: 0, liftN: 0 });
    }
    this.t = 0;
    this.steps = 0;
    // measuring starts at tStart: after the fixed settle time, or (relaxing)
    // once every body is still
    this.tStart = this.relaxing ? null : task.settle;
    this.totalSteps = this.relaxing ? Infinity : Math.round((task.settle + this.T) / DT);
    this.failed = this.creatures.map(c => !c.valid);
    this.e0 = this.energy();
    this.xMin = 0;
    this.mass = this.creatures.reduce((s, c) => s + (c.valid ? c.totalMass : 0), 0) + (this.cube ? this.cube.mass() : 0);
    this.track = this.creatures.map(() => ({ start: null, mark: null, maxDist: 0, maxLow: 0, d0: 0 }));
    this.relax = this.creatures.map(() => ({ minY: Infinity, still: 0 }));
    if (this.creatures.every(c => !c.valid)) this.steps = this.totalSteps = 0;
  }

  get settling() { return this.tStart === null || this.t < this.tStart; }

  // the ball (or cube) resting on the ground at p; added mid-run (lifting),
  // its energy joins the audit's starting energy
  addBall(p) {
    if (this.scene.ball === 'barbell') return this.addBarbell(p);
    const sc = this.scene, r = this.ballR = sc.ballSize, sphere = this.ballSphere = sc.ball === 'sphere';
    const vol = sphere ? 4 / 3 * Math.PI * r ** 3 : 8 * r ** 3;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p[0], r, p[2]).setCanSleep(false));
    this.ballCol = this.world.createCollider((sphere ? RAPIER.ColliderDesc.ball(r) : RAPIER.ColliderDesc.cuboid(r, r, r))
      .setDensity(sc.ballMass / vol).setFriction(sc.friction), body);
    this.cube = body;
    if (this.e0 !== undefined) { this.e0 += body.mass() * this.g * r; this.mass += body.mass(); }
  }

  // a barbell lying across the +x direction (bar along z): square plates
  // 2r high at the ends of a bar 6r long, so the bar is r off the ground.
  // Square, like hex dumbbells: round plates roll away when pushed.
  addBarbell(p) {
    const sc = this.scene, r = this.ballR = sc.ballSize, t = r / 4, L = 3 * r;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p[0], r, p[2]).setCanSleep(false));
    const barVol = 8 * t * t * L, plateVol = 8 * r * r * t;
    // 30% of the mass in the bar, 35% in each plate
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(t, t, L).setDensity(0.3 * sc.ballMass / barVol).setFriction(sc.friction), body);
    for (const z of [-L, L]) this.world.createCollider(RAPIER.ColliderDesc.cuboid(r, r, t).setTranslation(0, 0, z).setDensity(0.35 * sc.ballMass / plateVol).setFriction(sc.friction), body);
    this.barbell = [{ box: [t, t, L], at: [0, 0, 0] }, { box: [r, r, t], at: [0, 0, -L], plate: true }, { box: [r, r, t], at: [0, 0, L], plate: true }];
    this.ballSphere = false;
    this.cube = body;
    if (this.e0 !== undefined) { this.e0 += body.mass() * this.g * r; this.mass += body.mass(); }
  }

  // stairs: square rings stacked into an amphitheatre around a pit that
  // clears the creature's widest point by STAIR_MARGIN. Step k is a ring of
  // four boxes from its inner edge out to the edge of the flight; beyond it,
  // a solid ring as high as the top step makes a STAIR_TOP plateau. (Stretching
  // the step boxes out to the plateau's edge instead made Rapier's contacts
  // on them worse: a champion's energy spikes went from 1.7 J to 17 J.)
  buildStairs() {
    const c = this.creatures[0], sc = this.scene;
    if (!c.valid) return;
    const r0 = Math.max(...[[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(w => -c.minAlong(w))) + STAIR_MARGIN;
    const h = sc.stepHeight, d = sc.stepDepth, R = r0 + sc.steps * d;
    this.statics = []; this.staticCols = [];
    const ring = (a, b, y0, y1) => {   // a square ring from a to b out, between heights y0 and y1
      const w = (b - a) / 2, y = (y0 + y1) / 2, hy = (y1 - y0) / 2;
      for (const [cx, cz, hx, hz] of [[a + w, 0, w, b], [-a - w, 0, w, b], [0, a + w, a, w], [0, -a - w, a, w]]) {
        this.statics.push({ c: [cx, y, cz], h: [hx, hy, hz] });
        this.staticCols.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, y, cz).setFriction(this.relaxing ? 0 : sc.friction)));
      }
    };
    for (let k = 0; k < sc.steps; k++) ring(r0 + k * d, R, k * h, (k + 1) * h);
    ring(R, R + STAIR_TOP, 0, sc.steps * h);
  }

  // competition: move each contestant toward the ball until it touches the
  // starting plane (Sims): every point at height y is at least gap + y/tan(slope)
  // from the ball centre, along the line between the starting zones
  placeInZone() {
    const sc = this.scene, k = 1 / Math.tan(Math.max(1, Math.min(90, sc.slope)) * Math.PI / 180);
    this.creatures.forEach((c, i) => {
      if (!c.valid) return;
      const s = i && !this.coop ? 1 : -1;
      const m = c.minAlong([s, -k, 0]);   // min of (distance from the ball) - k * height
      c.shift([s * (sc.gap - m), 0, 0]);
    });
  }

  // relaxing: a body is still when its centre of mass hasn't dropped for
  // RELAX_STILL; then friction comes on, contestants move up to their zone,
  // and measuring starts
  relaxStep() {
    // on frictionless ground a horizontal shift doesn't change how a body
    // settles, so contestants glide along the plane as they topple rather
    // than jump to it at the end
    if (this.task.pair && this.scene.zone === 'plane' && !this.apart) this.placeInZone();
    let still = this.t >= RELAX_MIN;
    this.creatures.forEach((c, i) => {
      if (!c.valid || this.failed[i]) return;
      const r = this.relax[i], y = c.com()[1];
      if (y < r.minY - 1e-3) { r.minY = y; r.still = 0; } else r.still += DT;
      if (r.still < RELAX_STILL) still = false;
    });
    if (!still && this.t < RELAX_MAX) return;
    const f = this.scene.friction;
    this.groundCol.setFriction(f);
    this.creatures.forEach(c => { if (c.valid) c.setFriction(f); });
    for (const col of this.staticCols || []) col.setFriction(f);
    if (this.apart) {
      this.creatures.forEach((c, i) => { if (c.valid) c.shift([0, 0, -this.apart[i]]); });
      if (this.scene.zone === 'plane') this.placeInZone();
      this.apart = null;
    }
    this.tStart = this.t;
    this.totalSteps = this.steps + Math.round(this.T / DT);
  }

  get done() { return this.steps >= this.totalSteps; }

  cubePos() { return this.cube ? A(this.cube.translation()) : null; }

  step() {
    const { task, world } = this;
    const active = this.tStart !== null && this.t >= this.tStart;
    const cube = this.cubePos();
    const cs = this.creatures;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.valid || this.failed[i]) continue;
      let target = this.light || cube, other = null;
      // wrestling: both photosensors see the opponent
      if (this.wrestle && cs[1 - i]?.valid) target = cs[1 - i].com();
      // cooperation: the second photosensor sees the goal instead of the partner
      if (this.coop) other = this.goal;
      else if (task.pair && cs[1 - i] && cs[1 - i].valid) other = cs[1 - i].com();
      c.sense(world, target, other);   // joint angles and rates too, for limits and damping
      if (this.surface) c.feelWater();
      // settling apart, the brain waits: its senses are from the wrong place
      if (!this.apart) {
        brainStep(c.brain, DT / 2);
        brainStep(c.brain, DT / 2);
      }
      // reflexes hold posture from the start, except while relaxing as Sims did
      c.actuate(active, this.tStart !== null || !this.relaxing);
      if (task.env === 'water') c.drag();
      else if (this.surface) { c.drag(true); c.buoy(this.scene.buoyancy, this.g); }
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
      // upright walking: a fall is any part its template doesn't mark
      // `ground` touching the ground, settling included; it ends the walk
      if (task.kind === 'upright' && this.track[i].fell === undefined && c.parts.some((p, k) => c.onGround[k] && !TEMPLATES[c.genome.plan?.type]?.roles[c.genome.nodes[p.node].role]?.ground)) this.track[i].fell = this.t;
      if (this.tStart !== null && this.t >= this.tStart) this.trackStep(i);
    }
    if (this.tStart === null) this.relaxStep();
    if (this.lift && this.tStart !== null && this.t >= this.tStart) this.liftStep();
    if (this.volley && this.tStart !== null && this.t >= this.tStart) this.volleyStep();
    // wrestling: how long the two are in contact
    if (this.wrestle && this.tStart !== null && this.t >= this.tStart) {
      this.boutSteps++;
      if (this.wrestling()) this.contactSteps++;
    }
    // cooperation: how long both touch the ball at once, until the game ends
    if (this.coop && this.tStart !== null && this.t >= this.tStart && this.scored === null) {
      this.playSteps++;
      if (this.scene.together > 0 && cs.every((c, i) => c.valid && !this.failed[i] && this.touching(c))) this.bothSteps++;
    }
    // cooperation: a goal ends the game
    if (this.coop && this.tStart !== null && this.t >= this.tStart && this.scored === null && this.ballToGoal() <= this.scene.goalSize) {
      this.scored = this.t - this.tStart;
      this.totalSteps = this.steps;
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

  // Sims' control bonus: a contestant touching the prize on the side away from
  // its own centre of mass (wrapped around it) gets up to the prize's radius
  // off its distance: r * (how far round the far side its touching point is)
  grip(c) {
    const ball = this.cubePos(), r = this.ballR;
    const u0 = sub(ball, c.com()), n = len(u0);
    if (n < 1e-9) return 0;
    const u = scale(u0, 1 / n);
    let best = 0;
    for (let i = 0; i < c.parts.length; i++) {
      const rel = this.touchPoint(c, i, ball);
      if (rel) best = Math.max(best, dot(rel, u) / Math.max(len(rel), 1e-9));
    }
    return r * best;
  }

  // part i's closest point to the prize relative to its centre, if the part
  // touches it: within 2 cm of its surface
  touchPoint(c, i, ball = this.cubePos()) {
    const r = this.ballR, rel = sub(c.closestPoint(i, ball), ball);
    const touch = this.ballSphere ? len(rel) <= r + 0.02
      : qrot(qconj(this.cube.rotation()), rel).every(x => Math.abs(x) <= r + 0.02);
    return touch ? rel : null;
  }

  // wrestling: whether any part of one creature touches the other
  wrestling() {
    const [a, b] = this.creatures;
    if (!a?.valid || !b?.valid) return false;
    for (const col of a.colliders) {
      let hit = false;
      this.world.contactPairsWith(col, other => {
        if (hit || !b.colliderPart.has(other.handle)) return;
        this.world.contactPair(col, other, m => { if (m.numContacts() > 0) hit = true; });
      });
      if (hit) return true;
    }
    return false;
  }

  touching(c) {
    const ball = this.cubePos();
    for (let i = 0; i < c.parts.length; i++) if (this.touchPoint(c, i, ball)) return true;
    return false;
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
    this.creatures.forEach(c => { if (c.valid) e += c.fullEnergy(this.g) + (this.surface ? c.buoyEnergy(this.scene.buoyancy, this.g) : 0); });
    if (this.cube) {
      const v = this.cube.linvel(), w = this.cube.angvel(), m = this.cube.mass();
      e += m * (0.5 * (v.x * v.x + v.y * v.y + v.z * v.z) + this.g * this.cube.translation().y);
      if (this.barbell) {
        // w in the principal frame: 1/2 sum I_k w_k^2
        const I = this.cube.principalInertia(), f = qmul(this.cube.rotation(), this.cube.principalInertiaLocalFrame());
        const wl = qrot(qconj(f), [w.x, w.y, w.z]);
        e += 0.5 * (I.x * wl[0] ** 2 + I.y * wl[1] ** 2 + I.z * wl[2] ** 2);
      } else {
        const r = this.ballR, I = this.ballSphere ? 0.4 * m * r * r : m * (2 * r) ** 2 / 6;
        e += 0.5 * I * (w.x * w.x + w.y * w.y + w.z * w.z);
      }
    }
    return e;
  }

  trackStep(i) {
    const c = this.creatures[i], tr = this.track[i], task = this.task;
    const elapsed = this.t - this.tStart;
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
      if (task.env !== 'water') p = [p[0], 0, p[2]];   // on land and at the surface, horizontal
      if (!tr.start) tr.start = p;
      tr.maxDist = Math.max(tr.maxDist, len(sub(p, tr.start)));
      if (!tr.mark && elapsed >= this.T * 2 / 3) { tr.mark = p; tr.yMark = tr.minYMark = y; }
      tr.last = p;
    } else if (task.kind === 'getup') {
      // standing: the root's uprightness, (1 + up) / 2 (on its back 0, on its
      // side 0.5, as built 1, so rolling over already counts) x the centre of
      // mass's height as a share of the built pose's (no more for jumping),
      // halved while any part but its feet touches the ground: a template's
      // ground parts, or else the parts on the ground as built
      const q = c.partPose(0).q, u = qrot(q, qrot(qconj(c.partQ[0]), [0, 1, 0]));
      const roles = TEMPLATES[c.genome.plan?.type]?.roles;
      const foot = k => (roles ? roles[c.genome.nodes[c.parts[k].node].role]?.ground : c.feet.has(k));
      const down = c.parts.some((p, k) => c.onGround[k] && !foot(k));
      const s = (1 + u[1]) / 2 * Math.max(0, Math.min(1, y / c.standY)) * (down ? 0.5 : 1);
      tr.sum = (tr.sum || 0) + s; tr.n = (tr.n || 0) + 1;
      if (elapsed >= this.T * 2 / 3) { tr.late = (tr.late || 0) + s; tr.nLate = (tr.nLate || 0) + 1; }
    } else if (task.kind === 'upright') {
      if (tr.fell === undefined) {
        const p = [c.com()[0], 0, c.com()[2]];
        if (!tr.start) tr.start = p;
        tr.maxDist = Math.max(tr.maxDist, len(sub(p, tr.start)));
        if (!tr.mark && elapsed >= this.T * 2 / 3) tr.mark = p;
        tr.last = p;
      }
    } else if (task.kind === 'jump') {
      // the lowest part's height counts only as far as the COM has also risen
      // above its height when measuring began: a tall body that topples
      // swings its grounded parts up while its COM falls, which isn't a jump
      tr.maxLow = Math.max(tr.maxLow, Math.min(c.lowest(), y - tr.y0));
    } else if (task.kind === 'follow') {
      const d = len(sub(c.com(), this.light));
      if (tr.start === null) tr.start = d;
      tr.last = d;
    } else if (task.kind === 'wrestle') {
      // furthest its centre of mass got outside the ring, or outside its
      // start if that was further out (a tall body starts further back)
      const p = c.com(), r = Math.hypot(p[0], p[2]);
      if (tr.edge === undefined) { tr.edge = Math.max(this.ring, r); tr.rSum = 0; tr.rN = 0; }
      tr.maxOut = Math.max(tr.maxOut || 0, r - tr.edge);
      tr.rSum += r; tr.rN++;
    } else if (task.kind === 'climb') {
      tr.last = y; tr.low = c.lowest();
    } else if (task.kind === 'cooperate' || task.kind === 'volley' || (task.kind === 'lift' && this.cube)) {
      const d = c.distanceTo(this.cubePos());
      if (tr.start === null) tr.start = d;
      tr.last = d;
    }
  }

  // lifting: the cube is placed when measuring starts; then its height off
  // the ground over the last LIFT_HOLD seconds is averaged
  liftStep() {
    const c = this.creatures[0];
    if (!this.cube) {
      if (c.valid) this.addBall([-c.minAlong([-1, 0, 0]) + LIFT_GAP + this.scene.ballSize, 0, 0]);
      return;
    }
    if (this.t - this.tStart >= this.T - LIFT_HOLD) { this.liftSum += Math.max(0, this.cube.translation().y - this.ballR); this.liftN++; }
  }

  // volley: a pass is a touch by one creature after the other's, with the
  // ball at least PASS_MIN from where it was when the other last touched it.
  // Both on the ball at once is a scrum: the next touch isn't a pass.
  volleyStep() {
    const cs = this.creatures, b = this.cubePos();
    const on = cs.map((c, i) => c.valid && !this.failed[i] && this.touching(c));
    on.forEach((x, i) => { if (x) this.touched[i] = true; });
    if (on[0] && on[1]) { this.lastTouch = -1; this.lastPos = b; return; }
    if (!on[0] && !on[1]) return;
    const i = on[0] ? 0 : 1;
    if (this.lastTouch === 1 - i && Math.hypot(b[0] - this.lastPos[0], b[2] - this.lastPos[2]) >= PASS_MIN) this.passes++;
    this.lastTouch = i; this.lastPos = b;
  }

  // cooperation: horizontal distance from the ball's centre to the goal's
  ballToGoal() { const b = this.cubePos(); return Math.hypot(b[0] - this.goal[0], b[2] - this.goal[2]); }

  // fitness of each creature in this trial
  fitness() {
    const task = this.task, T = this.T;
    if (this.coop) {
      // shared: 0.8 x the share of the way the ball got to the goal's edge,
      // plus 0.2 x the share of their distance to the ball the two closed on
      // average (so creatures that never touch it can still improve); on a
      // goal, 1 + the share of the time left (1..2). Scene `together` takes
      // its share from these for the time both touch the ball at once. A
      // blown-up simulation scores nothing for either.
      const cs = this.creatures;
      if (cs.every(c => !c.valid) || cs.some((c, i) => c.valid && this.failed[i])) return cs.map(() => 0);
      const sc = this.scene;
      const clamp = x => Math.max(0, Math.min(1, x));
      const live = cs.map((c, i) => this.track[i]).filter((tr, i) => cs[i].valid && tr.start > 0);
      const near = live.reduce((t, tr) => t + clamp(1 - tr.last / tr.start), 0) / Math.max(1, live.length);
      // together: share w of the score for the share of the game both
      // creatures spent touching the ball at once, taken from the rest
      const w = clamp(sc.together || 0), both = this.bothSteps / Math.max(1, this.playSteps);
      const f = this.scored !== null ? 1 + (1 - w) * Math.max(0, 1 - this.scored / T) + w * both
        : (1 - w) * (0.8 * clamp((sc.goalDist - this.ballToGoal()) / Math.max(0.01, sc.goalDist - sc.goalSize)) + 0.2 * near) + w * both;
      return cs.map(() => f);
    }
    if (this.wrestle) {
      // sumo: how far each one's centre of mass ever got outside the ring
      // (or its own start, if further out);
      // further out than the other by WRESTLE_SCALE metres is a full loss
      // (0) and win (2). Scoring advances, then distance pushed back from
      // the start, both let them walk straight past each other.
      const cs = this.creatures;
      if (cs.some((c, i) => !c.valid || this.failed[i])) return cs.map(() => 0);
      // Plus holding the middle: WRESTLE_CENTRE x the difference in mean
      // distance from it, in ring radii, so standing apart at the edges
      // (a sure draw otherwise) loses to coming in.
      const [oa, ob] = this.track.map(tr => tr.maxOut || 0);
      const [ma, mb] = this.track.map(tr => (tr.rN ? tr.rSum / tr.rN : 0));
      const fa = 1 + Math.max(-1, Math.min(1, (ob - oa) / WRESTLE_SCALE + WRESTLE_CENTRE * (mb - ma) / this.ring));
      // Both get scene `engage` x the share of the bout spent in contact:
      // without it, wrestlers that never met drew or won on the other
      // wandering off, so evolution kept them apart
      const e = (this.scene.engage || 0) * this.contactSteps / Math.max(1, this.boutSteps);
      return [fa + e, 2 - fa + e];
    }
    if (this.volley) {
      // shared: one point a pass; before the first, up to 0.75 for getting
      // there: 0.25 for each creature that touched the ball and 0.25 x the
      // share of their distance to it the two closed on average
      const cs = this.creatures;
      if (cs.every(c => !c.valid) || cs.some((c, i) => c.valid && this.failed[i])) return cs.map(() => 0);
      const live = cs.map((c, i) => this.track[i]).filter((tr, i) => cs[i].valid && tr.start > 0);
      const near = live.reduce((t, tr) => t + Math.max(0, Math.min(1, 1 - tr.last / tr.start)), 0) / Math.max(1, live.length);
      const f = this.passes + 0.25 * (this.touched[0] + this.touched[1]) + 0.25 * near;
      return cs.map(() => f);
    }
    if (task.kind === 'compete') {
      const cube = this.cubePos(), com = this.scene.metric === 'com';
      const dist = c => (com ? len(sub(c.com(), cube)) : c.distanceTo(cube)) - (this.scene.grip ? this.grip(c) : 0);
      const d = this.creatures.map((c, i) => (c.valid && !this.failed[i] ? dist(c) : Infinity));
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
      if (task.kind === 'upright') {
        // as walking (Sims' max distance plus the final third's distance),
        // up to the fall; plus 0.1 x the share of the time it stayed up,
        // settling included, so that standing longer is a first step
        const up = tr.fell === undefined ? 1 : tr.fell / (task.settle + T);
        if (!tr.start) return 0.1 * up;
        return 0.5 * tr.maxDist / T + 0.5 * (tr.mark ? len(sub(tr.last, tr.mark)) : 0) / (T / 3) + 0.1 * up;
      }
      if (task.kind === 'jump') return Math.max(0, tr.maxLow);
      // getting up: standing over the last third, plus a quarter for the whole time
      if (task.kind === 'getup') return tr.nLate ? 0.75 * tr.late / tr.nLate + 0.25 * tr.sum / tr.n : 0;
      // stairs: half the COM's rise, half the lowest point's final height,
      // so standing up tall earns little and every part has to climb
      if (task.kind === 'climb') return tr.last === undefined ? 0 : Math.max(0, 0.5 * (tr.last - tr.y0) + 0.5 * Math.max(0, tr.low));
      // lifting: the cube's average height off the ground over the last
      // LIFT_HOLD s, plus up to 0.2 for closing on it
      if (task.kind === 'lift') {
        const near = tr.start > 0 ? Math.max(0, Math.min(1, 1 - tr.last / tr.start)) : 0;
        return (this.liftN ? this.liftSum / this.liftN : 0) + 0.2 * near;
      }
      if (task.kind === 'follow') return tr.start === null ? 0 : (tr.start - tr.last - (tr.y0 === undefined ? 0 : tr.y0 - tr.minY)) / T;
      return 0;
    });
  }

  free() { this.world.free(); }
}

// Run a full evaluation (all trials) and return fitness per genome.
export function evaluate(taskName, genomes, opts = {}) {
  const task = TASKS[taskName];
  // both sides: the same bout with the creatures in swapped order, each
  // creature's two scores averaged
  if (task.pair && genomes.length === 2 && sceneFor(taskName, opts.scene).bothSides) {
    const a = evaluate(taskName, genomes, { ...opts, scene: { ...opts.scene, bothSides: false } });
    const b = evaluate(taskName, [genomes[1], genomes[0]], { ...opts, scene: { ...opts.scene, bothSides: false } });
    return [(a[0] + b[1]) / 2, (a[1] + b[0]) / 2];
  }
  const sum = genomes.map(() => 0);
  for (let trial = 0; trial < task.trials; trial++) {
    const sim = new Sim(taskName, genomes, { ...opts, trial });
    while (!sim.done) sim.step();
    sim.fitness().forEach((f, i) => { sum[i] += f; });
    sim.free();
  }
  return sum.map(s => s / task.trials);
}
