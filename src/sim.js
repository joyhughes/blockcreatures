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
import { develop, interpenetrates, tooBig, bounds, JOINT_DOFS, NSENS, NEYE, EYE_H, EYE_V, EYE_CH, EYE_RANGE, EYE_GAZE, EYE_SPREAD, eyeIndex, TEMPLATES } from './genome.js';
import { compileBrain, brainStep, initBrain, learnedWeights, applyLearned } from './brain.js';
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
  frictionPasses: 4,  // solver passes per substep, new scenes (see Sim)
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
  centaur: { label: 'Centaur walking', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'upright', plan: 'centaur',
    scene: { settle: 'timed' } },
  // a light cube on the ground beside it: lift it as high as it can hold it
  // "I get knocked down, but I get up again": a pendulum swings in from a
  // random direction (two opposite ones, re-drawn each generation) and
  // knocks the creature over; it scores for standing again
  knock: { label: 'Knocked down', env: 'land', duration: 12, settle: 1, trials: 2, kind: 'knock', scene: { settle: 'timed' } },
  // skis on every foot, down a snowy hill (scene hill; 0 = skating on ice):
  // as far downhill (or, on the flat, as far) as it gets without falling
  ski: { label: 'Skiing', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'ski', scene: { settle: 'timed', friction: 0.08 } },
  // figure skating: skates on the feet, on flat ice; jump, spin in the air as
  // many turns as it can, and land upright on its skates (Sim.spinStep)
  spin: { label: 'Skating spins', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'spin', scene: { settle: 'timed', friction: 0.08 } },
  // speed skating: long blades on flat ice (skiing with no hill; the blades
  // grip sideways, so it pushes off their edges); as far straight ahead, the
  // way it faced at the start, as it gets without falling
  speedSkate: { label: 'Speed skating', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'ski', scene: { settle: 'timed', friction: 0.02, hill: 0, skiDrag: 0.002, skates: true } },
  // cross-country skiing: skis on snow up a gentle climb (hill -2: skiing
  // uphill), as far up it as it gets without falling. Skis slide along their
  // line and grip across it, so it can skate (push off an edge, the other ski
  // lifted) or climb in a herringbone (skis splayed, pushing off their inside
  // edges); grip wax (or scales) stops a ski sliding back; only the skis
  // may touch the snow
  crossCountry: { label: 'Cross-country skiing', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'ski', scene: { settle: 'timed', friction: 0.05, hill: -2, skiDrag: 0.002, wax: 0.5 } },
  // cross-country on a real trail (Sim.buildCourse): climbs, descents and
  // bends, marked by poles either side; as far along the trail as it gets
  // without falling, and no further once it strays off it
  xcCourse: { label: 'Cross-country course', env: 'land', duration: 20, settle: 1, trials: 1, kind: 'ski', scene: { settle: 'timed', friction: 0.05, hill: 0, skiDrag: 0.002, wax: 0.5, course: true } },
  // skiing round gates: as skiing, but distance past a missed gate doesn't count
  slalom: { label: 'Slalom', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'ski', scene: { settle: 'timed', friction: 0.08, slalom: 2 } },
  // ski jumping: skis on the feet, at the top of a real hill (Sim.buildJump):
  // down the inrun, off the takeoff and as far down the landing hill as it
  // can fly, with air drag; extra points for landing on its skis
  skiJump: { label: 'Ski jumping', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'skijump', scene: { settle: 'timed', friction: 0.08, skiDrag: 0.002 } },
  // stand as long and as tall as it can, under walking's fall rules
  stand: { label: 'Standing', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'stand', scene: { settle: 'timed' } },
  // stand up from lying or sitting (scene `start`), and stay up
  getUp: { label: 'Getting up', env: 'land', duration: 10, settle: 0.5, trials: 1, kind: 'getup', scene: { settle: 'timed' } },
  // the barbell's plates are 0.12 m in radius: a 6 cm bar, 12 cm off the
  // ground, that a hand can close round and a trunk can still get under
  // (runs before kept their 0.2 m plates)
  lift: { label: 'Lifting', env: 'land', duration: 15, settle: 1, trials: 1, kind: 'lift',
    scene: { ball: 'barbell', ballSize: 0.12, ballMass: 0.3, duration: 15 } },
  // throwing: the implement rests on a stand in front of the creature, at
  // the height of its centre of mass; score: the farthest throw (Sim.throwStep)
  shotPut: { label: 'Shot put', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'throw', scene: { settle: 'timed', ball: 'shot', ballSize: 0.06, implMass: 0.05 } },
  javelin: { label: 'Javelin', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'throw', scene: { settle: 'timed', ball: 'javelin', ballSize: 0.6, implMass: 0.01, grab: true } },
  // javelin pre-training: take the javelin off its stand in the hands, lift
  // it and hold it up; no throwing (scene grabOnly)
  javelinGrab: { label: 'Javelin grip', env: 'land', duration: 10, settle: 1, trials: 1, kind: 'throw', scene: { settle: 'timed', ball: 'javelin', ballSize: 0.6, implMass: 0.01, grab: true, grabOnly: true } },
};
// targets that came after scenes: a run without one has no legacy scene
const NEW_KINDS = ['cooperate', 'volley', 'wrestle', 'climb', 'lift', 'upright', 'getup', 'stand', 'knock', 'ski', 'spin', 'throw', 'skijump'];

// Scene parameters, adjustable per run (the UI's Scene section). A run's
// scene travels with its jobs, history and champions; a saved creature
// without one replays under LEGACY_SCENE, the conditions it evolved in.
//   duration   seconds measured after settling (null = the task's own)
//   gravity    m/s^2 on land          friction   ground and body friction (coefficient; 3 = very grippy,
//              more than rubber on a rough surface; it was 1, then 2, and scenes keep what they had)
//   drag       water viscosity        lightDist  light's distance (following)
//   strength   muscle strength, x PHYS.strength (all creatures)
//   toneMin, levelMin, braceMin   every joint's reflex gains are at least these (0..1), whatever
//              its genes say: stiffens any creature, old ones included
//   toneRate, reflexRate   reflex speeds (PHYS.toneRate, PHYS.reflexRate)
//   jointDamp  passive joint damping, per unit effective inertia
//   jointRange every joint limit is cut to within this many radians of the built angle (1.6 =
//              no change); small ranges stop legs circling like paddlewheels
//   joints     'limited': Rapier holds every joint within its limits; 'rolling': the same, but
//              twist axes spin freely (wheels); 'old': inelastic stops applied by hand, which a
//              body's weight could push through (scenes from before joints existed)
//   falls      walking on land: the walk ends, and stops counting, when a part other than the
//              creature's feet touches the ground (template ground parts; otherwise the parts on the
//              ground when measuring starts; snakes are all feet); false = scenes from before
//   speed      speed targets: 'net' = the straight-line distance from start to finish over the time
//              (rocking and circling net nothing); 'sims' = Sims' max distance and final third
//   hill       skiing: the slope, degrees (gravity tilts downhill, +X; the view tilts the picture
//              to match); 0 = skating on flat ice
//   gait       quadrupeds walking on land: 'none' (the brain walks) or a canned gait, 'walk', 'trot',
//              'canter', 'gallop' or 'run' (GAITS), driving the hips and knees; evolution tunes the
//              body and the trait genome.gait (stride rate, swing, lift, back flex)
//   implMass   throwing: the shot's or javelin's mass, a multiple of the creature's
//   throwShape throwing: weight of the shaping (half for touching the implement, half for lifting it
//              up to 0.5 m off its stand)
//   spinShape  skating spins: weight of the shaping (net turns spun upright on the ice, time in
//              the air), at most this much; a landed jump scores its turns. 0 once they jump
//   slalom     skiing: how many gates down the hill (0 = none); past the first one missed, no more
//              distance counts. gateGap: metres between gates (and to the first); gateOffset: each
//              gate's offset to alternate sides; gateWidth: the opening between its panels
//   jumpInrun, jumpLength   ski jumping: the inrun's angle (degrees) and straight length (m)
//   jumpTakeoff ski jumping: the takeoff table's angle, degrees down (real hills: 10-11)
//   jumpLanding ski jumping: the landing hill's angle, degrees (the knoll curves into it)
//   jumpHeight ski jumping: the edge's height above the knoll below it (m)
//   jumpKick   ski jumping: a kicker at the end of the table, swooping up this many degrees above
//              level (JUMP.rk radius) for a higher, longer flight; 0 = none, the table ends flat
//   jumpRide   ski jumping: extra points for riding on after the landing without crashing: this
//              x the share of JUMP.ride s it stays upright on its skis alone (0: the jump ends
//              once the landing is held)
//   jumpLand   ski jumping: extra points for landing on its skis and holding it JUMP.hold s
//              (distance scores a point per JUMP.per m)
//   course     skiing: a cross-country trail (COURSE) over real terrain, a heightfield, in place of
//              the tilted flat (hill is ignored); distance is along the trail, and stops counting
//              where the centre of mass first strays more than courseWidth/2 off its middle.
//              courseHills, courseTurns: the climbs' and descents' heights, and the bends' angles,
//              as multiples of COURSE's (0 = flat, straight)
//   wax        skiing: grip wax (or fishscales): a ski sliding back along its line grips, up to
//              wax x its share of the weight; forward it runs free (cross-country). 0 = none
//   bladesOnly skiing and speed skating: only the skis or blades may touch the snow or ice (a
//              boot on it is a fall; ski jumping too), and skis and blades stand taller (SKI_TALL,
//              SPEED_BLADE); false (scenes from before): any part of a ski's or skate's foot, on
//              2 cm skis and 2.4 cm blades
//   skates     skiing on the flat: speed skates (SPEED_SKATE blades) and only distance straight ahead
//              (the way it faced as measuring began; +X for a body without a template) counts
//   grab       throwing: a throw counts only after the creature has held the implement up in its
//              hands (GRAB: only hand parts touching it, two at least, GRAB.lift off the stand for
//              GRAB.arm s), and only if let go from a hand; a fall (walking's fall rules) or the
//              implement knocked onto the ground scores nothing at all. Shaping: the grip score
//   grabOnly   throwing, with grab: no throws; score the grip alone (0..1): a tenth for reaching a
//              hand to it, a tenth for touching it with one, 0.3 for how high it was held (up to
//              GRAB.lift), half for how long it was held up there at a stretch (up to GRAB.hold s)
//   gateBonus  slalom: points for each gate passed through its opening (up to the first one missed)
//   gateHit    slalom: points off for each gate whose panels it touched (they're sensors: breakaway
//              gates, so a hit costs points but doesn't stop the skier)
//   skiDrag    skiing: air drag, N per (m/s)^2 per m^2 of frontal area: tucking low pays
//   forward    net speed, animal templates on land: only distance in the direction it faced when
//              measuring began counts (head first; a quadruped evolved to walk rump-first)
//   stepWeight walking with falls: weight of the step bonus (the share of 20 steps taken; a step is a
//              foot off the ground 0.15 s landing 5 cm from where it lifted)
//   standWeight walking with falls: weight of the standing bonus (half the share of the time up,
//              half the height it stood at when measuring began). Start high so standing pays,
//              then lower it as gaits appear
//   knockMass  knocked down: the pendulum ball's mass, a multiple of the creature's
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
  duration: null, gravity: 9.81, friction: 3.0, drag: 3, lightDist: 6, buoyancy: 1.5, start: 'side',
  strength: 1, toneMin: 0, levelMin: 0, braceMin: 0, toneRate: 8, reflexRate: 6, jointDamp: 3, jointRange: 1.6,
  joints: 'limited', falls: true, standWeight: 0.1, stepWeight: 0.1, knockMass: 2, speed: 'net', forward: true, hill: 8, skiDrag: 0.3, gait: 'none', spinShape: 0.1, slalom: 0, gateGap: 3.5, gateOffset: 0.8, gateWidth: 1.6, gateBonus: 0.2, gateHit: 0.1, jumpInrun: 35, jumpLength: 10, jumpTakeoff: 11, jumpLanding: 35, jumpLand: 0.5, jumpHeight: 0.6, jumpKick: 0, jumpRide: 0.5, grab: false, grabOnly: false, skates: false, bladesOnly: true, wax: 0, course: false, courseHills: 1, courseTurns: 1, courseWidth: 3, implMass: 0.05, throwShape: 0.1,
  ball: 'sphere', ballSize: 0.25, ballMass: 0.15, gap: 1, zone: 'plane', slope: 45, maxVolume: 1, sameSize: true, grip: true,
  settle: 'stable', goalDist: 3, goalSize: 0.6, metric: 'surface', apart: true, together: 0.2,
  stepHeight: 0.15, stepDepth: 0.4, steps: 12, ring: 2, engage: 0.5, bothSides: true,
};
// competition as the bundled champions evolved it: a 0.8 m cube 1.5 m away
export const LEGACY_SCENE = { friction: 1, joints: 'old', falls: false, speed: 'sims', forward: false, ball: 'cube', ballSize: 0.4, ballMass: 0.256, gap: 1.5, zone: 'none', grip: false, settle: 'timed', metric: 'surface', apart: false, together: 0, sameSize: false, bothSides: false, engage: 0 };
// a task's default scene: SCENE with the task's own ball
export const defaultScene = taskName => ({ ...SCENE, ...(TASKS[taskName].scene || {}) });
export function sceneFor(taskName, scene) {
  // scenes saved before a setting existed get its old behaviour; cooperation
  // came after scenes, so it has no legacy scene
  const old = scene && { zone: scene.gapBody ? 'length' : 'none', grip: false, settle: 'timed', metric: 'surface', apart: false, together: 0, sameSize: false, bothSides: false, engage: 0, joints: 'old', falls: false, friction: 1, speed: 'sims', forward: false, gateBonus: 0, gateHit: 0, grab: false, grabOnly: false, jumpRide: 0, bladesOnly: false };
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
// joints built in our frame (hard limits): Rapier axes locked besides position, per joint type
const FRAME_LOCK = { spherical: 0, revolute: 8 | 32, twist: 16 | 32, universal: 8, bendtwist: 32, twistbend: 16 };
const MOTOR_AXES = { spherical: [3, 4, 5], revolute: [3], twist: [3], universal: [4, 5], bendtwist: [4, 5], twistbend: [4, 5] };
// getting up: start poses, turned from the built (standing) pose; X is forward, Z to the side
const START_POSE = {
  side: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },           // rolled 90 degrees onto its side
  back: { x: 1, y: 0, z: 0, w: 0 },                                  // upside down
  sitting: { x: 0, y: 0, z: Math.sin(Math.PI / 6), w: Math.cos(Math.PI / 6) },   // pitched back 60 degrees, nose up
};
const STEP_AIR = 0.15, STEP_LEN = 0.02, STEP_MAX = 20;   // walking with falls: a step is a foot off the ground this long (s), landing this much (m) further along its way than it lifted
const FALL_TILT = Math.PI / 3, FALL_LOW = 0.6, FALL_BACK = 2, FALL_GRACE = 2;   // walking with falls: see Sim.step (2 s: a slow topple can lean for over a second before it passes FALL_TILT)
// knocked down: the pendulum (a ball on a rigid rope from a fixed pivot)
// (r 0.35, aimed `aim` above the centre of mass: a 0.25 m ball at the centre was dodged or shrugged off)
const KNOCK = { delay: 1, len: 2.5, angle: 75 * Math.PI / 180, r: 0.35, aim: 0.15 };
// getting up and knocked down, new scenes: the parts that are feet for standing (not tails or flukes)
const REAL_FEET = ['foot', 'paw', 'toe', 'lowerLeg', 'frontLower', 'clawLower', 'hoof', 'arm'];
// skiing: the planks under the feet (half extents: length, thickness, width), and which template parts get them
const SKI = { half: [0.3, 0.01, 0.045], grip: 1.0 };
// (scene bladesOnly) on a binding: 6 cm tall, so a foot broader than the ski
// can tip it onto an edge without touching the snow
const SKI_TALL = { half: [0.3, 0.03, 0.045], grip: 1.0 };
// figure skating: a skate's blade (half extents, as SKI.half), short so it can turn
const SKATE = { half: [0.15, 0.01, 0.02] };
// speed skating: a long, thin blade (as SKI.half), gripping sideways as skis do
const SPEED_SKATE = { half: [0.25, 0.012, 0.006], grip: 1.0 };
// (scene bladesOnly) 6 cm tall, so a skater can lean into a push without its
// boot touching the ice: under the 2.4 cm blade, a broad foot's edge came
// down at 11-25 degrees, and evolved skaters pushed off their boots
const SPEED_BLADE = { half: [0.25, 0.03, 0.006], grip: 1.0 };
// figure skating: a landing counts once the skater has held it this long (s)
// on its skates alone, upright; turns in a jump that ends in a fall count this much
// throwing: the stand's half width (m) and its gap from the creature; a
// javelin's half thickness; a throw that lands other than tip first (javelin)
// scores this share; shaping: lifting the implement this high (m) off the
// stand is worth scene throwShape
const THROW = { stand: 0.15, gap: 0.05, rod: 0.015, flat: 0.25, lift: 0.5 };
// throwing with scene grab: held up means this high (m) off the stand in the
// hands; a throw is allowed once it was held up this long (s); the grip
// score's full hold
const GRAB = { lift: 0.2, arm: 0.5, hold: 2 };
// slalom: each gate's panels (half extents: thin along the slope, tall, wide across)
const GATE = { panel: [0.03, 0.7, 0.3] };
// ski jumping: the hill's fixed shape (m): the start straight above the
// creature, curve radii (inrun to takeoff, knoll, landing to outrun), the
// takeoff table's length, the step down under the edge, landing slope
// length, half width, the curves' segment length, the snow boxes' depth and
// how far each runs on under its neighbours in a valley; and scoring: points per m of distance, the time a
// landing must be held on the skis alone, the shaping for getting down the
// inrun without falling (its share of the way to the edge)
const JUMP = { top: 2.5, at: 1.5, r1: 12, table: 2, rk: 6, drop: 0.15, r2: 15, land: 28, r3: 15, w: 5, seg: 0.5, thick: 1, over: 1, per: 10, hold: 1, ride: 3, shape: 0.1 };
// cross-country trail: its sections, [length m, bend degrees (+ = left),
// rise m], each rise eased in (smoothstep: the steepest pitch 1.5x the
// average); a flat run-up behind the start; the trail sampled every `step`
// m; the terrain a heightfield of `cell` m squares, `margin` m beyond the
// trail, each point's height a soft blend (sigma m) of the nearest trail's;
// marker poles every `pole` m either side
const COURSE = {
  sections: [[3, 0, 0], [4, 0, 0.35], [2, 30, 0], [4, 0, -0.45], [5, -60, 0], [4, 0, 0.4], [3, 40, -0.3], [4, 0, 0], [5, 0, 0.5], [5, -45, -0.6], [6, 0, 0]],
  back: 4, step: 0.05, cell: 0.25, margin: 5, sigma: 1, pole: 2.5, poleHalf: [0.02, 0.5, 0.02],
};
const courses = new Map();
// the trail's samples (x, z, height, heading, station) and the terrain's
// heights, cached per shape (every evaluation builds the same one)
function courseFor(sc) {
  const hills = sc.courseHills ?? 1, turns = sc.courseTurns ?? 1, key = hills + ',' + turns;
  if (courses.has(key)) return courses.get(key);
  const D = Math.PI / 180, st = COURSE.step, P = [];
  let x = -COURSE.back, z = 0, th = 0, h = 0, s = -COURSE.back;
  const put = () => P.push({ x, z, h, ux: Math.cos(th), uz: -Math.sin(th), s });
  for (let d = 0; d < COURSE.back - 1e-9; d += st) { put(); x += st; s += st; }
  for (const [L, bend, rise] of COURSE.sections) {
    const n = Math.round(L / st), h0 = h;
    for (let i = 0; i < n; i++) {
      put();
      th += bend * turns * D / n;
      x += st * Math.cos(th); z -= st * Math.sin(th); s += st;
      const f = (i + 1) / n; h = h0 + rise * hills * f * f * (3 - 2 * f);
    }
  }
  put();
  // the terrain
  const m = COURSE.margin, cell = COURSE.cell;
  const x0 = Math.min(...P.map(p => p.x)) - m, x1 = Math.max(...P.map(p => p.x)) + m;
  const z0 = Math.min(...P.map(p => p.z)) - m, z1 = Math.max(...P.map(p => p.z)) + m;
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  const H = new Float32Array((nx + 1) * (nz + 1)), few = P.filter((p, i) => i % 5 === 0), k2 = 1 / (2 * COURSE.sigma ** 2);
  let lo = Infinity;
  for (let j = 0; j <= nx; j++) for (let i = 0; i <= nz; i++) {
    const gx = x0 + j * cell, gz = z0 + i * cell;
    let dmin = Infinity;
    const d2 = few.map(p => { const d = (p.x - gx) ** 2 + (p.z - gz) ** 2; if (d < dmin) dmin = d; return d; });
    let sw = 0, sh = 0;
    few.forEach((p, k) => { const w = Math.exp(-(d2[k] - dmin) * k2); sw += w; sh += w * p.h; });
    // (Rapier's layout: column-major, rows along Z)
    lo = Math.min(lo, H[j * (nz + 1) + i] = sh / sw);
  }
  // the trail's middle follows the terrain under it
  const c = { P, H, nx, nz, x0, z0, cell, lo, i0: Math.round(COURSE.back / st) };
  for (const p of P) p.h = courseHeight(c, p.x, p.z).y;
  courses.set(key, c);
  return c;
}
// the terrain's height and upward normal at (x, z), bilinear in its cell
function courseHeight(c, x, z) {
  const fx = Math.max(0, Math.min(c.nx - 1e-6, (x - c.x0) / c.cell)), fz = Math.max(0, Math.min(c.nz - 1e-6, (z - c.z0) / c.cell));
  const j = Math.floor(fx), i = Math.floor(fz), u = fx - j, v = fz - i, N = c.nz + 1;
  const a = c.H[j * N + i], b = c.H[(j + 1) * N + i], d = c.H[j * N + i + 1], e = c.H[(j + 1) * N + i + 1];
  const y = a * (1 - u) * (1 - v) + b * u * (1 - v) + d * (1 - u) * v + e * u * v;
  const hx = ((b - a) * (1 - v) + (e - d) * v) / c.cell, hz = ((d - a) * (1 - u) + (e - b) * u) / c.cell, l = Math.hypot(hx, 1, hz);
  return { y, n: [-hx / l, 1 / l, -hz / l] };
}
const SPIN = { hold: 0.5, fallen: 0.1, minAir: 0.1, iceTurns: 5, air: 0.5 };
const SKI_ROLES = ['foot', 'paw', 'lowerLeg', 'frontLower', 'clawLower', 'hoof'];
// a ducktopus skis (and skates) on the tips of its arms
const SKI_TIPS = ['arm'];
const HAND_ROLES = ['hand', 'finger', 'thumb', 'thumbTip'];
// Canned quadruped gaits (scene gait): a central pattern generator drives the
// hips (fore-aft swing) and knees in a fixed footfall pattern, in place of
// the brain, which keeps the other joints (spine sideways, neck, tail, hip
// splay) for balance. Per leg (LF, RF, LH, RH): when in the cycle (0..1) its
// stance begins. duty: the share of the cycle a foot is down. hz: strides a
// second. spine: how much the back flexes and extends with the stride.
//   walk    four-beat, LH LF RH RF, three feet down at a time
//   trot    diagonal pairs together
//   canter  three-beat: RH, then LH with RF, then the leading LF
//   gallop  transverse (a horse's): RH LH, then RF LF
//   run     rotary (a cheetah's): LH RH, then RF LF, the back bending hard
//   pace    lateral pairs together (a pacing horse's, a camel's)
export const GAITS = {
  walk: { hz: 1.0, duty: 0.7, spine: 0, phase: { LF: 0.25, RF: 0.75, LH: 0, RH: 0.5 } },
  trot: { hz: 1.6, duty: 0.5, spine: 0, phase: { LF: 0, RF: 0.5, LH: 0.5, RH: 0 } },
  canter: { hz: 1.8, duty: 0.45, spine: 0.5, phase: { LF: 0.6, RF: 0.3, LH: 0.3, RH: 0 } },
  gallop: { hz: 2.2, duty: 0.4, spine: 0.5, phase: { LF: 0.6, RF: 0.5, LH: 0.1, RH: 0 } },
  run: { hz: 2.6, duty: 0.35, spine: 1, phase: { LF: 0.6, RF: 0.5, LH: 0, RH: 0.1 } },
  pace: { hz: 1.6, duty: 0.5, spine: 0, phase: { LF: 0, RF: 0.5, LH: 0, RH: 0.5 } },
};
// the evolvable trait genome.gait (each 0..1, absent = 0.5) scales the canned
// gait to the body: stride rate (x the gait's hz), hip swing and knee lift
// (rad either way), and the back's flex (rad, x the gait's spine)
// the plans with four legs a gait can drive, and the parts of their backs
// that flex with it (a centaur's human chest and waist stay out of it)
const GAIT_PLANS = ['quadruped', 'centaur'];
const GAIT_BACK = { quadruped: ['spine', 'chest'], centaur: ['spine', 'withers'] };
const GAIT_RANGE = { hz: [0.6, 1.6], swing: [0.15, 0.6], lift: [0.3, 1.2], spine: [0, 0.5] };
const GAIT_RAMP = 0.5;   // s: the stride grows from nothing, so it doesn't start with a kick
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

// mass (density 1, or the part's own: p.density) and principal moments about the part's own axes
export function massProps(p) {
  if (p.density && p.density !== 1) {
    const { m, I } = massProps({ ...p, density: 1 });
    return { m: m * p.density, I: I.map(x => x * p.density) };
  }
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
    // a template role's density (fingers and thumbs: dense, so they aren't
    // too light for the solver next to the body)
    const tRoles = TEMPLATES[genome.plan?.type]?.roles;
    if (tRoles) for (const p of parts) { const d = tRoles[genome.nodes[p.node].role]?.density; if (d) p.density = d; }
    this.world = world;
    // the run's body settings (scene), defaulting to PHYS
    const ph = opts.phys || {};
    this.ph = { strength: ph.strength ?? 1, floor: [ph.toneMin || 0, ph.levelMin || 0, ph.braceMin || 0],
      toneRate: ph.toneRate ?? PHYS.toneRate, reflexRate: ph.reflexRate ?? PHYS.reflexRate,
      damp: ph.jointDamp ?? PHYS.jointDamp, range: Math.min(PHYS.limitMax, ph.jointRange ?? PHYS.limitMax), joints: ph.joints || 'old' };
    // the brain drives reflexed joints through their motors (see reflexMotors): new scenes
    this.brainDrive = this.ph.joints !== 'old';
    // a canned gait (quadrupeds, walking on land, new joints)
    this.gait = this.brainDrive && GAIT_PLANS.includes(genome.plan?.type) && GAITS[opts.gait] ? GAITS[opts.gait] : null;
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
      // which way is up in the creature's frame, in its start pose (on a
      // slope, opts.plane: its normal)
      const u = opts.plane ? qrot(qconj(q0), opts.plane.n) : opts.tilt ? qrot(qconj(q0), [0, 1, 0]) : [0, 1, 0];
      let minY = Infinity, maxY = -Infinity;
      for (const p of parts) {
        minY = Math.min(minY, dot(p.center, u) - support(p, p.R, u));
        maxY = Math.max(maxY, dot(p.center, u) + support(p, p.R, u));
      }
      // floating: as deep as a box of uniform density would (1 / buoyancy of its height)
      pos[1] = opts.float ? -minY - (maxY - minY) / opts.float : -minY + 0.02 + (opts.skis ? 2 * (opts.skis.half || SKI.half)[1] : 0);
      if (opts.plane) pos.splice(0, 3, ...add(opts.plane.p, scale(opts.plane.n, pos[1])));
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
        .setDensity(p.density || 1).setFriction(opts.friction ?? PHYS.friction).setRestitution(0);
      if (opts.groups !== undefined) cd.setCollisionGroups(opts.groups);
      // a hand's parts (palm, fingers, thumb) don't collide with each other or
      // their forearm: side by side, fingers touched every step, and contacts
      // between parts so small shook them apart. They still touch everything
      // else (Rapier: membership bits << 16 | filter bits)
      else if (HAND_ROLES.includes(genome.nodes[p.node].role)) cd.setCollisionGroups(0x0002fffd);
      else if (genome.nodes[p.node].role === 'forearm' && parts.some(q => genome.nodes[q.node].role === 'hand')) cd.setCollisionGroups(0x0002ffff);
      const col = world.createCollider(cd, this.bodies[b]);
      this.colliders.push(col);
      this.colliderPart.set(col.handle, i);
    });
    // armature (as robot simulators add it): a template role's tiny jointed
    // parts (fingers, thumbs) get extra turning inertia, armature x their
    // largest principal moment about every axis. Thin and light, a finger
    // spun about its own length at 100-400 rad/s and shook the hand apart
    if (tRoles) parts.forEach((p, i) => {
      const a = tRoles[genome.nodes[p.node].role]?.armature;
      if (!a || p.joint === 'rigid') return;
      const b = this.bodies[this.partBody[i]], I = b.principalInertia(), x = a * Math.max(I.x, I.y, I.z);
      b.setAdditionalMassProperties(0, { x: 0, y: 0, z: 0 }, { x, y: x, z: x }, { x: 0, y: 0, z: 0, w: 1 }, true);
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
      // Joint limits held by Rapier (scene joints 'limited' or 'rolling'):
      // the joint is built in our joint frame F, so Rapier's X, Y, Z are our
      // twist and two bend axes, and its limits are ours. The old inelastic
      // stops (joints 'old') were sized for the lightest case, and a body's
      // weight pushed legs up to 3 rad past them, round and round: insects
      // rolled on their joints. 'rolling' leaves the twist axis free.
      const hard = this.ph.joints !== 'old';
      if (hard) jd = RAPIER.JointData.generic(V(a1), V(a2), V(F[0]), L | FRAME_LOCK[p.joint]);
      const joint = world.createImpulseJoint(jd, this.bodies[pb], this.bodies[cb], true);
      joint.setContactsEnabled(false);
      if (hard) {
        const qF = quatFromMat(F);
        joint.setFrameX1(qF); joint.setFrameX2(qF);
        const lim = genome.nodes[p.node].limits, raw = world.impulseJoints.raw;
        for (const k of dofs) {
          if (k === 0 && this.ph.joints === 'rolling') continue;
          const lo = Math.max(-this.ph.range, lim[k][0]), hi = Math.min(this.ph.range, lim[k][1]);
          // limits are on our angle, sigma x Rapier's
          raw.jointSetLimits(joint.handle, 3 + k, sigma[k] > 0 ? lo : -hi, sigma[k] > 0 ? hi : -lo);
        }
      }
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
      const rf = (genome.nodes[p.node].reflex || [0, 0, 0]).map((x, k) => Math.max(x, this.ph.floor[k]));
      const upOf = k => qrot(qconj(this.partQ[k]), [0, 1, 0]);
      const strength = PHYS.strength * Math.min(partArea(p.half), partArea(par.half)) ** 1.5 * this.ph.strength;
      const lim = genome.nodes[p.node].limits;
      this.joints.push({
        part: i, pb, cb, F, qF: quatFromMat(F), sigma, dofs, iEff, strength, limits: lim,
        servo: !!this.genome.nodes[p.node].servo,
        reflex: rf, anyReflex: rf.some(x => x > 0), effort: [0, 0, 0], iP, iC, pp: p.parent, upC: upOf(i), upP: upOf(p.parent),
        // Rapier's motor axes: the free angular axes of the joint's frame on the parent
        handle: joint.handle, f1: joint.frameX1(), raxes: hard ? dofs.map(k => 3 + k) : MOTOR_AXES[p.joint], hard, mTarget: [0, 0, 0], mRate: [0, 0, 0], mMax: 0, motors: false,
        eff: dofs.map(a => effIndex.get(i * 3 + a)),
        angle: [0, 0, 0], rate: [0, 0, 0], axis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        mt: [0, 0, 0], mr: [0, 0, 0],
      });
    });
    this.nb = this.bodies.length;
    this.work = 0;
    this.onGround = new Array(parts.length).fill(false);
    this.bare = new Array(parts.length).fill(false);   // touching down itself, not through its ski
    this.groundHandle = opts.groundHandle ?? -1;
    this.bt = new Array(this.nb); this.bq = new Array(this.nb);
    this.bv = new Array(this.nb); this.bw = new Array(this.nb); this.bc = new Array(this.nb);
    if (opts.skis) this.makeSkis(world, opts);
    this.read();
    this.makeEyes();
  }

  // Skis: a thin plank under each foot (a template's feet, paws, lower legs
  // and claws; otherwise the parts on the ground as built), pointing the
  // creature's way (X), fixed to the foot's body. Snow is slippery (the
  // scene's friction), but a ski grips sideways on its edge (Sim.skiEdges),
  // so a skier can steer, and on the flat skate by pushing off an edge.
  makeSkis(world, opts) {
    const roles = TEMPLATES[this.genome.plan?.type]?.roles;
    const role = k => this.genome.nodes[this.parts[k].node].role;
    const tip = k => SKI_TIPS.includes(role(k)) && !this.parts.some(q => q.parent === k && role(q.index) === role(k));
    const foot = k => (roles ? SKI_ROLES.includes(role(k)) || tip(k) : this.feet.has(k));
    this.skis = [];
    this.parts.forEach((p, k) => {
      if (!foot(k)) return;
      const b = this.partBody[k], down = support(p, p.R, [0, 1, 0]);
      const half = opts.skis.half || SKI.half;
      const at = [this.partC[k][0], this.partC[k][1] - down - half[1], this.partC[k][2]];
      // ski jumping: round-edged, so they glide over the hill's facets
      const r = opts.skis.round ? half[1] * 0.9 : 0;
      const col = world.createCollider((r ? RAPIER.ColliderDesc.roundCuboid(half[0] - r, half[1] - r, half[2] - r, r) : RAPIER.ColliderDesc.cuboid(...half)).setTranslation(...at)
        .setDensity(1).setFriction(opts.friction ?? PHYS.friction).setRestitution(0), this.bodies[b]);
      this.colliderPart.set(col.handle, k);   // its contacts count as the foot's
      this.skis.push({ body: b, at, col, part: k, half });
    });
    // the skis' mass joins the bodies'
    this.mass = this.bodies.map(b => b.mass());
    this.totalMass = this.mass.reduce((a, b) => a + b, 0);
  }

  // Two eyes on the head (the template's head part, else the root). Spread
  // (genome.eyes) moves them from the front of the head, gazing nearly ahead,
  // to its sides, gazing straight out. Directions are in the head's frame,
  // from the creature's forward (X), up (Y) and side (Z) as built; eye 0 is
  // on the +Z side. Each pixel's ray turns from the eye's gaze by its azimuth
  // about up and its elevation, the same formula for both eyes, so a mirror
  // image of one eye's pixel is the other eye's pixel with the azimuth
  // reversed (mirrorEye). The binocular grid looks ahead from between the
  // eyes; a pixel counts only if it lies in both eyes' fields.
  makeEyes() {
    // the head; for an animal without one, its chest; otherwise the part
    // furthest forward and up, near the middle, which reads as a head (the root, the
    // first fallback, was a biped's pelvis or any block of a free body)
    const roles = TEMPLATES[this.genome.plan?.type] ? this.parts.map(p => this.genome.nodes[p.node].role) : null;
    let head = roles ? roles.indexOf('head') : -1;
    if (head < 0 && roles) head = roles.indexOf('chest');
    if (head < 0) {
      head = 0;
      const ahead = p => p.center[0] + 0.5 * p.center[1] - Math.abs(p.center[2]);   // forward, up, and near the middle
      this.parts.forEach((p, k) => { if (ahead(p) > ahead(this.parts[head])) head = k; });
    }
    const p = this.parts[head], qi = qconj(this.partQ[head]);
    const F = qrot(qi, [1, 0, 0]), U = qrot(qi, [0, 1, 0]), L = qrot(qi, [0, 0, 1]);
    const ext = u => support(p, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], u);
    const r = Math.max(0.03, Math.min(0.08, 0.25 * Math.min(...p.half)));   // drawn size only
    const spread = Math.max(0, Math.min(1, this.genome.eyes?.spread ?? EYE_SPREAD));
    const deg = Math.PI / 180, gz = (EYE_GAZE[0] + spread * (EYE_GAZE[1] - EYE_GAZE[0])) * deg;
    this.eyeGaze = gz / deg;
    // a retina: rays turned from `gaze` (horizontal) by azimuth and elevation
    const retina = (gaze, width) => {
      const across = cross(U, gaze), rays = [];
      for (let v = 0; v < EYE_V; v++) for (let h = 0; h < EYE_H; h++) {
        const az = (h / (EYE_H - 1) - 0.5) * width * deg, el = (v / (EYE_V - 1) - 0.5) * 50 * deg;
        const hz = add(scale(gaze, Math.cos(az)), scale(across, Math.sin(az)));
        rays.push({ h, v, az: az / deg, d: add(scale(hz, Math.cos(el)), scale(U, Math.sin(el))) });
      }
      return rays;
    };
    this.eyes = [1, -1].map(side => {
      const lat = scale(L, side);
      // on the side, a little forward and up; or on the front, either side of the middle
      const onSide = add(add(scale(lat, ext(lat) * 0.92), scale(F, 0.35 * ext(F))), scale(U, 0.3 * ext(U)));
      const onFront = add(add(scale(F, ext(F) * 0.92), scale(lat, 0.45 * ext(lat))), scale(U, 0.3 * ext(U)));
      const t = (gz / deg - EYE_GAZE[0]) / (EYE_GAZE[1] - EYE_GAZE[0]);
      const pos = add(scale(onFront, 1 - t), scale(onSide, t));
      const gaze = add(scale(F, Math.cos(gz)), scale(lat, Math.sin(gz)));
      return { part: head, pos, gaze, r, rays: retina(gaze, 80) };
    });
    // binocular: ahead from between the eyes, where both fields (80 degrees
    // wide about their gazes) cover the direction
    const mid = scale(add(this.eyes[0].pos, this.eyes[1].pos), 0.5);
    const both = 40 - gz / deg;
    this.bino = { part: head, pos: mid, rays: retina(F, 50).filter(ray => Math.abs(ray.az) <= both + 1e-9) };
  }

  // Fill the eye pixels (only if the brain reads them: rays are the costly
  // part of sensing). Eyes refresh every other step (30 Hz), holding the
  // image between. salient(body handle): the prize or another creature.
  look(salient) {
    if (!this.brain.usesEyes) return;
    const S = this.sens, E0 = this.brain.E0;
    if ((this.looks = (this.looks || 0) + 1) % 2 === 0) { S.set(this.seen, E0); return; }
    const own = this.colliderPart;
    const pred = col => !own.has(col.handle);
    // eyes 0 and 1 see distance only coarsely; the binocular grid (2) exactly
    [...this.eyes, this.bino].forEach((eye, e) => {
      const { c, q } = this.partPose(eye.part), o = add(c, qrot(q, eye.pos));
      for (const ray of eye.rays) {
        const d = qrot(q, ray.d);
        const hit = this.world.castRay(new RAPIER.Ray(V(o), V(d)), EYE_RANGE, true, undefined, undefined, undefined, undefined, pred);
        const i = E0 + eyeIndex(e, ray.h, ray.v, 0);
        if (!hit) { S[i] = 0; S[i + 1] = 0; continue; }
        const near = 1 - hit.timeOfImpact / EYE_RANGE;
        S[i] = e === 2 ? near : Math.ceil(near * 3) / 3;
        const body = hit.collider.parent();
        S[i + 1] = salient(body ? body.handle : -1, hit.collider.handle) ? 1 : 0;
      }
    });
    this.seen = S.slice(E0, E0 + NEYE);
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

  // the creature's widths across direction u (unit): sideways (horizontal)
  // and the other way (mostly up), its frontal box seen along u
  extentAcross(u) {
    let e1 = cross([0, 1, 0], u); const n = len(e1);
    e1 = n > 1e-6 ? scale(e1, 1 / n) : [0, 0, 1];
    const e2 = cross(u, e1);
    const width = w => -this.minAlong(scale(w, -1)) - this.minAlong(w);
    return [width(e1), width(e2)];
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
  // gx: gravity's downhill (+X) component (skiing), whose potential falls along X
  fullEnergy(g, gx = 0) {
    let e = 0;
    for (let i = 0; i < this.nb; i++) {
      const v = this.bv[i], w = this.bw[i];
      const M = this.bodies[i].effectiveAngularInertia();
      e += this.mass[i] * (0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + g * this.bc[i][1]);
      if (gx) e -= this.mass[i] * gx * this.bc[i][0];
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
      for (const k of j.dofs) {
        S[j.part * NSENS + k] = j.angle[k];
        S[j.part * NSENS + 23 + k] = j.rate[k];
        S[j.part * NSENS + 26 + k] = j.effort[k];
      }
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
    this.onGround.fill(false); this.bare.fill(false);
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i], p = this.parts[i];
      world.contactPairsWith(col, other => {
        world.contactPair(col, other, (m, flipped) => {
          if (m.numContacts() === 0) return;
          if (other.handle === this.groundHandle || this.groundExtra?.has(other.handle)) this.onGround[i] = this.bare[i] = true;
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
    // skis: a ski on the snow is its foot on the ground, felt on the foot's underside (-Y face)
    for (const ski of this.skis || []) {
      world.contactPairsWith(ski.col, other => {
        if (other.handle !== this.groundHandle && !this.groundExtra?.has(other.handle)) return;
        world.contactPair(ski.col, other, m => { if (m.numContacts() > 0) { this.onGround[ski.part] = true; S[ski.part * NSENS + 6] = 1; } });
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
  //
  // The brain drives through the same motors (new scenes; brainDrive): its
  // output moves the tone set point, from the standing pose by up to half
  // the joint's range each way (within its limits), and the motor takes the
  // joint there with the muscle's full strength, its command outweighing level
  // and brace. Brain torques were capped at a tenth of a muscle's strength,
  // so the reflexes held the legs still and the brain could only wiggle them:
  // creatures slid instead of stepping. A silent brain stands; an oscillating
  // one swings the legs around the standing pose.
  reflexMotors(on, active = false) {
    const raw = this.world.impulseJoints.raw, out = this.brain.effOut;
    for (const j of this.joints) {
      if (!j.anyReflex && !j.gaitDof) continue;
      const drive = active && this.brainDrive && (j.eff.some(e => e !== undefined) || !!j.gaitDof);
      const [tone0, level, brace] = j.reflex, tone = drive ? Math.max(1, tone0) : tone0, gs = tone + level + brace;
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
        j.dofs.forEach((k, n) => {
          const lo = Math.max(-this.ph.range, j.limits[k][0]), hi = Math.min(this.ph.range, j.limits[k][1]);
          let set = j.zero ? j.zero[k] : 0;
          if (drive && j.gaitDof === k) {
            // the gait's angle, from the standing pose
            set += j.gaitSet;
            j.effort[k] = Math.max(-1, Math.min(1, 2 * j.gaitSet / (hi - lo || 1)));
          } else if (drive && j.eff[n] !== undefined) {
            const cmd = Math.max(-1, Math.min(1, out[j.eff[n]]));
            set += cmd * (hi - lo) / 2;
            j.effort[k] = cmd;   // proprioception: the command
          }
          th = add(th, scale(j.axis[k], j.sigma[k] * (j.angle[k] - Math.max(lo, Math.min(hi, set)))));
        });
        goal = add(goal, scale(th, -tone * this.ph.toneRate));
      }
      const e = (part, upLocal) => { const u = qrot(this.partPose(part).q, upLocal); return [-u[2], 0, u[0]]; };   // u x (0, 1, 0)
      if (level > 0) goal = add(goal, scale(sub(scale(e(j.part, j.upC), this.ph.reflexRate), tumble(wP)), level));
      if (brace > 0) goal = add(goal, scale(sub(tumble(wC), scale(e(j.pp, j.upP), this.ph.reflexRate)), brace));
      goal = scale(goal, 1 / gs);
      // a gait also leads with its own speed (feed-forward): chasing the
      // error alone, a hip lagged its stride by about 60 degrees
      if (drive && j.gaitDof !== undefined) goal = add(goal, scale(j.axis[j.gaitDof], j.sigma[j.gaitDof] * j.gaitRate));
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



  // Reflexes hold the pose the creature stands in once measuring starts
  // (walking and standing with falls): tone the joint angles it has then, level
  // and brace its parts' orientations then. Aimed at the built pose instead,
  // the joints of a body standing on several feet fought each other through
  // the ground (it can't reach the built pose exactly), and the solver let its
  // feet creep: silent quadrupeds slid up to 0.45 m.
  // Canned gait, set up as it starts: which joint DOF swings each leg fore
  // and aft, which way is forward (and, for knees, which way folds the foot
  // back under the body), and the spine's pitch. Read from the body as it
  // stands now: turning a joint by d about sigma x axis moves a hanging foot
  // along axis x down = (a_z, 0, -a_x).
  gaitSetup() {
    const g = this.gait;
    const fwd = qrot(this.partPose(0).q, qrot(qconj(this.partQ[0]), [1, 0, 0]));
    const side = qrot(this.partPose(0).q, qrot(qconj(this.partQ[0]), [0, 0, 1]));
    const tr = this.genome.gait || {};
    const val = k => { const [lo, hi] = GAIT_RANGE[k]; return lo + (hi - lo) * Math.max(0, Math.min(1, tr[k] ?? 0.5)); };
    // the back's flex is shared among its joints (hindquarters, spine segments, chest)
    const back = GAIT_BACK[this.genome.plan.type];
    const nBack = this.joints.filter(j => back.includes(this.genome.nodes[this.parts[j.part].node].role)).length || 1;
    this.gaitP = { hz: g.hz * val('hz'), swing: val('swing'), lift: val('lift'), spine: g.spine * val('spine') / nBack };
    const along = (j, k, dir) => { const a = scale(j.axis[k], j.sigma[k]); return dot([a[2], 0, -a[0]], dir); };
    const best = (j, dir) => j.dofs.reduce((b, k) => (Math.abs(along(j, k, dir)) > Math.abs(along(j, b, dir)) ? k : b), j.dofs[0]);
    for (const j of this.joints) {
      const role = this.genome.nodes[this.parts[j.part].node].role;
      const fore = role === 'foreUpper' || role === 'foreLower', hind = role === 'hindUpper' || role === 'hindLower';
      // the room each way from the standing angle, within the joint's limits
      const room = k => {
        const lo = Math.max(-this.ph.range, j.limits[k][0]), hi = Math.min(this.ph.range, j.limits[k][1]), z = j.zero ? j.zero[k] : 0;
        return [z - lo, hi - z];
      };
      // a swing of amplitude a about the standing angle, moved (gaitC) and cut
      // (gaitAmp, as a share) to fit within the limits: evolved hips stood at a limit
      const fit = (k, a) => {
        const [down, up] = room(k), amp = Math.min(a, 0.95 * (down + up) / 2);
        j.gaitAmp = a > 0 ? amp / a : 0;
        j.gaitC = Math.max(-down + amp, Math.min(up - amp, 0));
      };
      if (back.includes(role)) {
        // the back's pitch: + arches it (the chest turns nose down)
        if (!g.spine) continue;
        const k = j.dofs.reduce((b, k) => (Math.abs(dot(j.axis[k], side)) > Math.abs(dot(j.axis[b], side)) ? k : b), j.dofs[0]);
        j.gaitDof = k; j.gaitSign = -Math.sign(j.sigma[k] * dot(j.axis[k], side)) || 1; j.gaitLeg = 'spine';
        fit(k, this.gaitP.spine);
        continue;
      }
      if (!fore && !hind) continue;
      // which side: the part's centre, across the body
      const across = dot(sub(this.partPose(j.part).c, this.partPose(0).c), side);
      j.gaitLeg = (across > 0 ? 'L' : 'R') + (fore ? 'F' : 'H');
      const k = best(j, fwd);
      j.gaitDof = k;
      const s = Math.sign(along(j, k, fwd)) || 1;
      if (role.endsWith('Upper')) { j.gaitSign = s; j.gaitKnee = false; fit(k, this.gaitP.swing); }
      else {
        // knees fold the foot back, unless the joint's limits leave room only the other way
        const [down, up] = room(k), roomBack = s > 0 ? down : up, roomFwd = s > 0 ? up : down;
        j.gaitSign = roomBack >= 0.3 || roomBack >= roomFwd ? -s : s; j.gaitKnee = true;
        // a knee folds from straight (as it stands) up to its limit
        j.gaitAmp = Math.min(1, 0.95 * Math.max(roomBack, roomFwd) / this.gaitP.lift); j.gaitC = 0;
      }
    }
  }

  // the gait's joint angles at time t (s since measuring began)
  gaitStep(t) {
    if (!this.gaitP) this.gaitSetup();
    const g = this.gait, P = this.gaitP, ramp = Math.min(1, t / GAIT_RAMP), cyc = t * P.hz;
    const at = leg => { const x = cyc - g.phase[leg]; return x - Math.floor(x); };
    for (const j of this.joints) {
      if (j.gaitDof === undefined) continue;
      let a;
      if (j.gaitLeg === 'spine') {
        // flexed as the hind feet land under the body, extended half a stride later
        const ph = (at('LH') + at('RH')) / 2;
        a = P.spine * Math.cos(2 * Math.PI * ph);
      } else {
        const ph = at(j.gaitLeg), d = g.duty;
        if (j.gaitKnee) a = ph < d ? 0 : P.lift * Math.sin(Math.PI * (ph - d) / (1 - d));
        // stance: the foot sweeps back from forward; swing: it is carried forward again
        else a = ph < d ? P.swing * (1 - 2 * ph / d) : -P.swing * Math.cos(Math.PI * (ph - d) / (1 - d));
      }
      const set = j.gaitC * ramp + j.gaitSign * j.gaitAmp * a * ramp;
      // its rate, for the motors' feed-forward
      j.gaitRate = j.gaitSet === undefined ? 0 : (set - j.gaitSet) / DT;
      j.gaitSet = set;
    }
  }

  holdPose() {
    for (const j of this.joints) {
      j.zero = j.angle.slice();
      j.upC = qrot(qconj(this.partPose(j.part).q), [0, 1, 0]);
      j.upP = qrot(qconj(this.partPose(j.pp).q), [0, 1, 0]);
    }
  }

  // reflexes: whether the reflex loops run (off only while relaxing as Sims did)
  actuate(active, reflexes = false) {
    this.reflexMotors(reflexes, active);
    const out = this.brain.effOut;
    for (const j of this.joints) {
      let tau = [0, 0, 0];
      j.dofs.forEach((k, n) => {
        const ang = j.angle[k], rate = j.rate[k], I = j.iEff[k];
        let t = 0;
        if (active && j.eff[n] !== undefined && !(this.brainDrive && reflexes && (j.anyReflex || j.gaitDof === k))) {
          const tMax = Math.min(j.strength, I * PHYS.alphaMax);
          if (j.servo) {
            // servo: the output (-1..1) is a target angle across the joint's
            // range, reached by a PD drive within the same torque limit, so a
            // wave of targets becomes a wave of bending rather than torques
            // whose reactions cancel along a chain
            const lo = Math.max(-this.ph.range, j.limits[k][0]), hi = Math.min(this.ph.range, j.limits[k][1]);
            const goal = lo + (Math.max(-1, Math.min(1, out[j.eff[n]])) + 1) / 2 * (hi - lo);
            const w0 = PHYS.servoFreq;
            t = I * (w0 * w0 * (goal - ang) - 2 * PHYS.servoDamp * w0 * rate);
            t = Math.max(-tMax, Math.min(tMax, t));
          } else t = out[j.eff[n]] * tMax;
          // positive muscle work, for energy audits: completed with the
          // rate after the step (trapezoid rule) in creditWork()
          j.mt[k] = t; j.mr[k] = rate;
          j.effort[k] = t / j.strength;   // proprioception, sensed next step
        }
        t -= this.ph.damp * I * rate;
        const lo = Math.max(-this.ph.range, j.limits[k][0]), hi = Math.min(this.ph.range, j.limits[k][1]);
        // Joint limits are inelastic stops: past a limit, an angular impulse
        // cancels outward motion (including this step's muscle push) and
        // sets a small return speed. Explicit limit springs leaked energy,
        // which evolution amplified into "jumps". Sized with the lower-bound
        // inertia, the impulse can only under-correct, so it never adds energy
        // beyond the small return speed.
        // (joints with hard limits: Rapier holds them, except a rolling twist)
        const ex = j.hard ? 0 : ang > hi ? ang - hi : ang < lo ? ang - lo : 0;
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
    // Animal templates (scene falls on: new runs) settle standing instead,
    // reflexes on, as biped and quadruped walking always did: an insect
    // relaxed with its muscles off lies on its belly before it starts.
    this.relaxing = land && sc.settle === 'stable' && !(sc.falls && genomes.every(g => TEMPLATES[g.plan?.type]));
    // skiing: gravity tilts downhill (+X) by the hill angle, on flat ground
    // (a cross-country course has real terrain instead)
    this.course = task.kind === 'ski' && sc.course ? courseFor(sc) : null;
    this.hill = task.kind === 'ski' && !this.course ? (sc.hill || 0) * Math.PI / 180 : 0;
    this.gx = this.g * Math.sin(this.hill);
    if (this.hill) this.g *= Math.cos(this.hill);
    const world = this.world = new RAPIER.World({ x: this.gx, y: -this.g, z: 0 });
    world.timestep = DT;
    // extra solver iterations: with 4, contacts on small, light round parts
    // put measurable energy into the system (1 J/kg); 12 brings it to noise
    world.numSolverIterations = PHYS.solverIterations;
    // Rapier solves friction at the velocity level, one pass per substep by
    // default; under a steady sideways load (reflex motors holding a pose
    // through planted feet) a little sliding was left every step, and feet
    // in constant contact crept 0.1-0.5 m in 10 s even at friction 5. Four
    // passes: most silent quadrupeds drift a few cm, and 11 of 12 stay up
    // instead of 4 (about 30% slower). Scenes from before keep one pass.
    world.integrationParameters.numInternalPgsIterations = sc.joints === 'old' ? 1 : PHYS.frictionPasses;
    if (land && this.course) {
      // the course's terrain is the ground
      const c = this.course;
      this.groundCol = world.createCollider(RAPIER.ColliderDesc.heightfield(c.nz, c.nx, c.H, { x: c.nx * c.cell, y: 1, z: c.nz * c.cell }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
        .setTranslation(c.x0 + c.nx * c.cell / 2, 0, c.z0 + c.nz * c.cell / 2).setFriction(this.relaxing ? 0 : sc.friction));
      this.groundHandle = this.groundCol.handle;
    } else if (land) {
      // an analytic half-space: Rapier's box-vs-cylinder contacts are its
      // least robust, and spinning cylinders on a box floor gained energy
      this.groundCol = world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setFriction(this.relaxing ? 0 : sc.friction));
      this.groundHandle = this.groundCol.handle;
    }
    this.light = task.kind === 'follow' ? lightPos(taskName, trial, phase, sc.lightDist) : null;
    // the competition's ball (or cube); `cube` is the body, whichever shape
    this.cube = null;
    const copts = { friction: this.relaxing ? 0 : sc.friction, drag: sc.drag, groundHandle: this.groundHandle, phys: sc };
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
      // ski jumping: the hill first, the creature on its inrun, tilted to the slope
      const jump = task.kind === 'skijump' ? this.buildJump() : null;
      this.creatures = genomes.map(g => new Creature(world, g, { ...copts, ground: land, float: this.surface ? sc.buoyancy : 0, skis: jump ? { ...(sc.bladesOnly ? SKI_TALL : SKI), round: true } : task.kind === 'ski' ? (sc.skates ? (sc.bladesOnly ? SPEED_BLADE : SPEED_SKATE) : sc.bladesOnly ? SKI_TALL : SKI) : task.kind === 'spin' ? SKATE : null,
        plane: jump?.plane, tilt: jump ? jump.tilt : task.kind === 'getup' ? START_POSE[sc.start] || START_POSE.side : null,
        gait: land && (task.kind === 'speed' || task.kind === 'upright') ? sc.gait : null,
      }));
      if (jump) {
        for (const c of this.creatures) if (c.valid) c.groundExtra = new Set(this.hillCols.map(col => col.handle));
        // settling, gravity points into the slope, as a skier already sliding
        // feels it (standing square to a 35 degree slope, every body
        // toppled); it turns straight down as the gate opens
        const A = sc.jumpInrun * Math.PI / 180;
        this.gTrue = this.g;
        this.gx = -this.g * Math.sin(A); this.g *= Math.cos(A);
        world.gravity = { x: this.gx, y: -this.g, z: 0 };
      }
      if (task.kind === 'climb') this.buildStairs();
      if (task.kind === 'ski' && sc.slalom > 0) this.buildGates();
      if (this.course) this.buildCourse();
      if (task.kind === 'throw') this.buildThrow();
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
    // walking with falls: a part other than the feet touching the ground ends the walk
    this.walkFalls = !!sc.falls && land && (task.kind === 'speed' || task.kind === 'upright' || task.kind === 'stand' || task.kind === 'ski' || task.kind === 'skijump' ||
      // stairs: animal templates only (a free body climbs with whatever part reaches the step)
      (task.kind === 'climb' && genomes.every(g => TEMPLATES[g.plan?.type])) ||
      // throwing with grab: falling scores nothing
      (task.kind === 'throw' && !!sc.grab));
    // stairs under the fall rules: the steps are ground too, so a body lying on them has fallen
    if (this.walkFalls && task.kind === 'climb' && this.staticCols) for (const c of this.creatures) if (c.valid) c.groundExtra = new Set(this.staticCols.map(col => col.handle));
    // ... and the sim runs FALL_GRACE s past the measured time: nothing then
    // counts, but a fall does (a topple begun just before the end rolls back)
    this.grace = this.walkFalls || task.kind === 'spin' || task.kind === 'throw' ? Math.round(FALL_GRACE / DT) : 0;
    if (this.totalSteps !== Infinity) this.totalSteps += this.grace;
    this.relax = this.creatures.map(() => ({ minY: Infinity, still: 0 }));
    // knocked down: the direction the pendulum comes from
    if (task.kind === 'knock') this.knock = { angle: phase + trial * 2 * Math.PI / task.trials, at: null };
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

  // Throwing: a stand in front of the creature (+X), as high as its centre of
  // mass, with the implement on it: a shot (a ball, radius ballSize) or a
  // javelin (a rod 2 x ballSize long, lying across, Z). Its mass is implMass
  // x the creature's.
  buildThrow() {
    const sc = this.scene, c = this.creatures[0];
    if (!c?.valid) return;
    const h = c.com()[1], x = -c.minAlong([-1, 0, 0]) + THROW.gap + THROW.stand, w = THROW.stand;
    this.statics = [{ c: [x, h / 2, 0], h: [w, h / 2, w] }];
    this.staticCols = [this.world.createCollider(RAPIER.ColliderDesc.cuboid(w, h / 2, w).setTranslation(x, h / 2, 0).setFriction(sc.friction))];
    this.throw = { at: [x, h], best: 0, lift: 0, last: null, flight: null, throws: 0 };
  }

  // the implement appears on the stand as measuring starts (as lifting's
  // barbell does): there from the start, a creature settling knocked it off
  placeImplement() {
    const sc = this.scene, c = this.creatures[0], [x, h] = this.throw.at;
    const m = (sc.implMass ?? 0.05) * c.totalMass, r = this.ballR = sc.ballSize;
    const javelin = this.javelin = sc.ball === 'javelin', t = THROW.rod;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, h + (javelin ? t : r), 0).setCanSleep(false));
    const vol = javelin ? 8 * t * t * r : 4 / 3 * Math.PI * r ** 3;
    this.implCol = this.world.createCollider((javelin ? RAPIER.ColliderDesc.cuboid(t, t, r) : RAPIER.ColliderDesc.ball(r)).setDensity(m / vol).setFriction(sc.friction), body);
    if (javelin) this.barbell = [{ box: [t, t, r], at: [0, 0, 0] }];
    this.ballSphere = !javelin;
    this.cube = body;
    this.throw.rest = h + (javelin ? t : r);
    this.e0 += body.mass() * this.g * this.throw.rest; this.mass += body.mass();
  }

  // Throwing, each step: what the implement touches. A throw starts when it
  // leaves the creature with nothing else touching it (a biped must let go
  // from a hand, finger or thumb) and ends where it first lands, on the
  // ground or the stand; it is the horizontal distance from where it was let
  // go to where it lands, so carrying it or rolling it earns nothing. A
  // javelin landing other than tip first (its end leading the flight lower)
  // scores THROW.flat of it. Caught again in flight: no throw. Throws must
  // start in the measured time; the grace time lets the last one land.
  throwStep() {
    const th = this.throw, c = this.creatures[0];
    if (!th || !c?.valid) return;
    if (!this.cube) { this.placeImplement(); return; }
    const w = this.world, col = this.implCol;
    const handRoles = HAND_ROLES, roles = TEMPLATES[c.genome.plan?.type]?.roles;
    const hands = roles && handRoles.some(r => roles[r]);
    let creature = false, byHand = false, ground = false, stand = false, other = false;
    const handParts = new Set();
    w.contactPairsWith(col, o => {
      w.contactPair(col, o, m => {
        if (m.numContacts() === 0) return;
        const k = c.colliderPart.get(o.handle);
        if (k !== undefined) {
          creature = true;
          // (a body plan without hands grips with any parts)
          if (!hands || handRoles.includes(c.genome.nodes[c.parts[k].node].role)) { byHand = true; handParts.add(k); } else other = true;
        } else { ground = true; if (this.staticCols?.some(s => s.handle === o.handle)) stand = true; }
      });
    });
    const t = this.cube.translation(), p = [t.x, t.y, t.z];
    if (this.scene.grab) this.gripStep(th, { byHand, handParts, other, ground, stand, lift: p[1] - th.rest, reach: this.handReach(c, hands, p) });
    // shaping: how high it was lifted, held or tossed, off the stand
    if (this.t <= this.tStart + this.T) th.lift = Math.max(th.lift, p[1] - th.rest);
    if (this.scene.grabOnly) return;
    if (creature) { th.flight = null; th.last = { p, hand: byHand }; if (this.t <= this.tStart + this.T) th.touched = true; return; }
    if (th.flight) {
      if (!ground) return;
      // landed
      let d = Math.hypot(p[0] - th.flight.p[0], p[2] - th.flight.p[2]);
      if (this.javelin) {
        const v = this.cube.linvel(), a = qrot(this.cube.rotation(), [0, 0, this.ballR]);
        const lead = (a[0] * v.x + a[2] * v.z) >= 0 ? a : scale(a, -1);
        if (!(lead[1] < 0)) d *= THROW.flat;
      }
      th.best = Math.max(th.best, d); th.throws++;
      th.flight = null; th.last = null;
      return;
    }
    // let go: in the air, last touched by the creature
    if (th.last && !ground && (!hands || th.last.hand) && (!this.scene.grab || th.armed) && this.t <= this.tStart + this.T) th.flight = { p: th.last.p };
    if (ground) th.last = null;
  }

  // Throwing with scene grab, each step: the grip. Held up: touched by two
  // hand parts or more and nothing else (no arm, chest or stand under it),
  // GRAB.lift off the stand; held so GRAB.arm s at a stretch arms the throw.
  // On the ground other than at the end of an armed throw, it was knocked
  // away, and nothing scores.
  gripStep(th, { byHand, handParts, other, ground, stand, lift, reach }) {
    const timed = this.t <= this.tStart + this.T;
    // reaching: how far the nearest hand closed on it, as a share of the start
    if (timed) { th.reach0 ??= Math.max(reach, 0.05); th.near = Math.max(th.near || 0, Math.min(1, 1 - reach / th.reach0)); }
    // (lying where a counted throw landed isn't knocked away)
    if (ground && !stand && !th.flight && !th.throws) { th.knocked = true; return; }
    if (!timed) return;
    if (byHand) th.handTouch = true;
    const held = handParts.size >= 2 && !other && !ground;
    if (held) th.heldLift = Math.max(th.heldLift || 0, Math.min(lift, GRAB.lift));
    if (held && lift >= GRAB.lift) {
      th.up = (th.up || 0) + DT;
      th.longest = Math.max(th.longest || 0, th.up);
      if (th.up >= GRAB.arm) th.armed = true;
    } else th.up = 0;
  }
  // the nearest hand part's centre to the implement's (any part, without hands)
  handReach(c, hands, p) {
    let d = Infinity;
    for (let k = 0; k < c.parts.length; k++) {
      if (hands && !HAND_ROLES.includes(c.genome.nodes[c.parts[k].node].role)) continue;
      d = Math.min(d, len(sub(c.partPose(k).c, p)));
    }
    return d;
  }
  // the grip score, 0..1 (scene grabOnly's whole score): a tenth for
  // reaching a hand to it, a tenth for touching it with one, 0.3 for how
  // high it was held, half for how long it was held up at a stretch
  gripScore(th) {
    return 0.1 * Math.max(0, th.near || 0) + 0.1 * (th.handTouch ? 1 : 0) + 0.3 * Math.max(0, th.heldLift || 0) / GRAB.lift + 0.5 * Math.min(1, (th.longest || 0) / GRAB.hold);
  }

  // Slalom: scene slalom gates down the hill (+X), gateGap apart, the first
  // gateGap from the start, alternately gateOffset to either side; each an
  // opening gateWidth wide between two tall panels, which the eyes see as
  // salient (Sim.salient), as far as EYE_RANGE, and bodies pass through
  buildGates() {
    const sc = this.scene, c = this.creatures[0];
    if (!c?.valid) return;
    const x0 = c.com()[0], z0 = c.com()[2], [hx, hy, hz] = GATE.panel;
    this.statics = []; this.staticCols = []; this.gateCols = new Set(); this.gateOf = new Map();
    this.gates = Array.from({ length: sc.slalom }, (_, k) => ({ x: x0 + (k + 1) * (sc.gateGap ?? 3.5), z: z0 + (k % 2 ? -1 : 1) * (sc.gateOffset ?? 0.8), w: (sc.gateWidth ?? 1.6) / 2 }));
    for (const g of this.gates) for (const s of [-1, 1]) {
      const cz = g.z + s * (g.w + hz);
      this.statics.push({ c: [g.x, hy, cz], h: [hx, hy, hz], gate: true });
      // a sensor (seen, not felt), as breakaway gates: solid, a panel stopped
      // a skier dead, and one on the straight line stopped every beginner
      const col = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(g.x, hy, cz).setSensor(true));
      this.staticCols.push(col); this.gateCols.add(col.handle); this.gateOf.set(col.handle, this.gates.indexOf(g));
    }
  }

  // Cross-country course: marker poles either side of the trail, every
  // COURSE.pole m, courseWidth apart; sensors (seen, not felt), which the
  // eyes see as salient, as slalom gates
  buildCourse() {
    const c = this.course, w = (this.scene.courseWidth ?? 3) / 2, [hx, hy, hz] = COURSE.poleHalf, every = Math.round(COURSE.pole / COURSE.step);
    this.statics ??= []; this.staticCols ??= []; this.markCols = new Set();
    for (let k = c.i0 + every; k < c.P.length; k += every) for (const sd of [-1, 1]) {
      const p = c.P[k], x = p.x - sd * p.uz * w, z = p.z + sd * p.ux * w, y = courseHeight(c, x, z).y + hy;
      this.statics.push({ c: [x, y, z], h: [hx, hy, hz], gate: true });
      const col = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setSensor(true));
      this.staticCols.push(col); this.markCols.add(col.handle);
    }
  }
  courseAt(x, z) { return courseHeight(this.course, x, z); }
  // where (x, z) is along the trail: the nearest sample within 3 m of
  // sample k; its station, and how far off the middle
  courseStation(x, z, k) {
    const P = this.course.P;
    let best = k, bd = Infinity;
    for (let i = Math.max(0, k - 60); i < Math.min(P.length, k + 61); i++) { const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    const p = P[best];
    return { k: best, s: p.s, off: Math.abs((x - p.x) * -p.uz + (z - p.z) * p.ux) };
  }

  // Ski jumping: the hill's profile in X (downhill) and Y: a straight start
  // above the creature, the inrun (jumpInrun degrees, jumpLength m), a curve
  // (JUMP.r1) up to the takeoff table (jumpTakeoff degrees, JUMP.table m),
  // maybe swooping up into a kicker (jumpKick degrees above level, JUMP.rk),
  // ending at the edge; a step down (jumpHeight m, JUMP.drop m forward); the
  // knoll curving (JUMP.r2) into the landing slope (jumpLanding degrees,
  // JUMP.land m); a curve (JUMP.r3) out onto the flat, which is the ground (y = 0) beyond. The creature
  // starts JUMP.at m down the start straight, tilted to the slope (settling,
  // gravity points into the slope, so it stays put). Returns its placement.
  //
  // The snow is solid boxes, one per segment, JUMP.thick deep and JUMP.w
  // either side. A thin trimesh failed both ways: with internal edges fixed,
  // skis sank through it on the curves (the audit saw 14 J/kg); without,
  // their tips caught the seams and stopped dead. Boxes leave no edge to
  // catch: where the slope eases (a valley: the inrun curve, the outrun)
  // each box runs on past both its ends under its neighbours, which lie
  // above its line there; where it steepens (the knoll, the edge) boxes
  // butt end to end, the next one below the last one's line.
  buildJump() {
    const sc = this.scene, D = Math.PI / 180, A = sc.jumpInrun * D, B = sc.jumpTakeoff * D, C = sc.jumpLanding * D;
    const pts = [[0, 0]];
    let th = A;   // heading, radians below the horizontal
    const go = d => { const [x, y] = pts.at(-1); pts.push([x + d * Math.cos(th), y - d * Math.sin(th)]); };
    const arc = (to, R) => { const n = Math.max(1, Math.ceil(Math.abs(to - th) * R / JUMP.seg)), d = (to - th) / n; for (let i = 0; i < n; i++) { th += d / 2; go(Math.abs(d) * R); th += d / 2; } th = to; };
    go(JUMP.top + sc.jumpLength); arc(B, JUMP.r1); go(JUMP.table);
    if (sc.jumpKick > 0) arc(-sc.jumpKick * D, JUMP.rk);
    const edge = pts.at(-1).slice(), ie = pts.length - 1;
    pts.push([edge[0] + JUMP.drop, edge[1] - (sc.jumpHeight ?? 0.6)]);
    th = B;   // the knoll leaves the step at the table's angle, whatever the kicker's
    arc(C, JUMP.r2); go(JUMP.land); arc(0, JUMP.r3);
    const y0 = pts.at(-1)[1];
    for (const p of pts) p[1] -= y0;
    edge[1] -= y0;
    this.hillPts = pts; this.edge = edge;
    // each segment's heading; a joint is a valley when the slope eases there
    const heads = pts.slice(1).map((p, i) => Math.atan2(pts[i][1] - p[1], p[0] - pts[i][0]));
    const valley = (i, k) => (k < 0 || k >= heads.length ? i === heads.length - 1 : heads[k] < heads[i] - 1e-6 === k > i);
    // (no box runs on past the edge: a kicker's ran out over the knoll as a
    // lip. With a kicker, no box under the step: its thickness, reaching back
    // under the lip, stood above the snow rising to the edge and stopped a
    // sled dead)
    // room[i]: from segment i's far end along the snow to the edge
    const room = heads.map(() => Infinity);
    for (let i = ie - 1, d = 0; i >= 0; i--) { room[i] = d; d += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); }
    this.hillCols = [];
    for (let i = 0; i < heads.length; i++) {
      if (i === ie && sc.jumpKick > 0) continue;
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), h = heads[i];
      const back = valley(i, i - 1) ? JUMP.over : 0, fwd = valley(i, i + 1) ? Math.min(JUMP.over, room[i]) : 0;
      const u = [Math.cos(h), -Math.sin(h)], n = [Math.sin(h), Math.cos(h)];
      const mid = (fwd - back) / 2;
      const cx = (ax + bx) / 2 + u[0] * mid - n[0] * JUMP.thick / 2, cy = (ay + by) / 2 + u[1] * mid - n[1] * JUMP.thick / 2;
      this.hillCols.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid((L + back + fwd) / 2, JUMP.thick / 2, JUMP.w)
        .setTranslation(cx, cy, 0).setRotation({ x: 0, y: 0, z: Math.sin(-h / 2), w: Math.cos(-h / 2) }).setFriction(sc.friction)));
    }
    const p = [JUMP.at * Math.cos(A), -JUMP.at * Math.sin(A) - y0, 0];
    return { plane: { p, n: [Math.sin(A), Math.cos(A), 0] }, tilt: { x: 0, y: 0, z: Math.sin(-A / 2), w: Math.cos(-A / 2) } };
  }

  // the hill's height and upward normal at x (the flat ground past its foot)
  hillAt(x) {
    const P = this.hillPts;
    if (!P || x >= P.at(-1)[0]) return { y: 0, n: [0, 1, 0] };
    let lo = 0, hi = P.length - 1;
    if (x <= P[0][0]) hi = 1;
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m][0] <= x) lo = m; else hi = m; }
    const [x0, y0] = P[hi - 1], [x1, y1] = P[hi], dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy);
    return { y: y0 + dy * (x - x0) / dx, n: [-dy / l, dx / l, 0] };
  }

  // Ski jumping, each measured step: down the inrun (a fall there, any part
  // but the skis and their feet touching the snow, or tilting past the fall
  // angle from the slope's normal, ends it with only the shaping), off the
  // edge into the air, and the landing: its distance is the centre of mass's
  // past the edge when anything first touches the snow beyond it. Landed on
  // the skis alone and held JUMP.hold s upright, the jumpLand bonus. Then
  // (jumpRide) the ride out: up to JUMP.ride s more upright on the skis
  // alone, until anything else touches the snow or it tilts over. The jump
  // ends there, and so does the sim (single creature).
  jumpStep(c, tr) {
    const j = tr.jump ??= { phase: 'inrun', x0: c.com()[0] };
    if (j.phase === 'crash' || j.phase === 'landed') return;
    if (this.t > this.tStart + this.T + 1e-9) { if (j.phase === 'landing') j.phase = 'crash'; if (j.phase === 'riding') j.phase = 'landed'; return this.endJump(j); }
    const skiBodies = tr.skiBodies ??= new Set(c.skis.map(s => s.body));
    let touching = false, other = false;
    // (bladesOnly: a boot on the snow is a fall too)
    for (let k = 0; k < c.parts.length; k++) if (c.onGround[k]) { touching = true; if (!skiBodies.has(c.partBody[k]) || (this.scene.bladesOnly && c.bare[k])) other = true; }
    // the snow it's on, for uprightness: the table until it's away, then the
    // landing hill (never the step under the edge)
    const com = c.com(), { y } = this.hillAt(com[0]);
    const { n } = this.hillAt(j.phase === 'inrun' ? Math.min(com[0], this.edge[0] - 1e-3) : Math.max(com[0], this.edge[0] + JUMP.drop + 1e-3));
    const up = qrot(c.partPose(0).q, qrot(qconj(c.partQ[0]), [0, 1, 0]));
    const tilted = dot(up, n) < Math.cos(TEMPLATES[c.genome.plan?.type]?.fallTilt ?? FALL_TILT);
    const progress = () => Math.max(0, Math.min(1, (com[0] - j.x0) / Math.max(0.1, this.edge[0] - j.x0)));
    // through the snow (the trimesh is a surface): nothing counts
    if (com[1] < y - 0.05 && j.phase === 'riding') { j.phase = 'landed'; j.why = 'through the snow'; return this.endJump(j); }
    if (com[1] < y - 0.05) { j.dist = 0; j.prog = progress(); j.phase = 'crash'; return this.endJump(j); }
    if (j.phase === 'inrun') {
      if (other || (touching && tilted)) { j.prog = progress(); j.phase = 'crash'; j.why = other ? 'body on the snow' : 'tilted'; return this.endJump(j); }
      if (!touching && com[0] > this.edge[0] - 0.5) { j.phase = 'air'; let P = [0, 0, 0]; for (let b = 0; b < c.nb; b++) P = add(P, scale(c.bv[b], c.mass[b])); j.v = len(P) / c.totalMass; }
      return;
    }
    if (j.phase === 'air') {
      if (!touching) return;
      if (com[0] < this.edge[0]) { j.phase = 'inrun'; return; }   // a hop on the table
      j.prog = 1; j.dist = com[0] - this.edge[0]; j.at = this.t;
      j.phase = other ? 'crash' : 'landing';
      if (other) return this.endJump(j);
      return;
    }
    // riding out: the same, but the landing's bonus is kept
    if (j.phase === 'riding') {
      if (other || (touching && tilted)) { j.phase = 'landed'; j.why = other ? 'body on the snow' : 'tilted'; return this.endJump(j); }
      j.ride = this.t - j.held;
      if (j.ride >= JUMP.ride) { j.phase = 'landed'; return this.endJump(j); }
      return;
    }
    // landing: held on the skis alone, upright to the slope
    if (other || (touching && tilted)) { j.phase = 'crash'; j.why = other ? 'body on the snow' : 'tilted'; return this.endJump(j); }
    if (this.t - j.at >= JUMP.hold) {
      j.held = this.t;
      if (this.scene.jumpRide > 0) { j.phase = 'riding'; j.ride = 0; return; }
      j.phase = 'landed'; return this.endJump(j);
    }
  }
  endJump(j) {
    j.end = this.t;
    if (this.creatures.length === 1) this.totalSteps = this.steps;
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
    this.totalSteps = this.steps + Math.round(this.T / DT) + (this.grace || 0);
  }

  get done() { return this.steps >= this.totalSteps; }

  // walking with falls: a snapshot of a walk's score so far, kept every
  // 0.1 s for the last FALL_BACK s, to roll back to on a fall
  keepPast(tr) {
    if (this.steps % 6) return;
    (tr.past ??= []).push(this.snap(tr));
    if (tr.past.length > FALL_BACK * 10) tr.past.shift();
  }
  snap(tr) { return { t: this.t, maxDist: tr.maxDist, last: tr.last, low: tr.low, gates: tr.gates && [...tr.gates], hits: tr.hits && [...tr.hits], cap: tr.cap, s: tr.s, mark: tr.mark, minY: tr.minY, yMark: tr.yMark, minYMark: tr.minYMark }; }

  // walking with falls: steps. A foot (a foot part's body: a paw and its
  // toes are one) that leaves the ground for STEP_AIR s and lands STEP_LEN
  // further along its way than where it lifted has taken a step, and the
  // score so far is kept as
  // the last catch. Walking is falling forward and catching yourself: a
  // beginner that steps, steps and falls keeps what its steps won.
  trackSteps(c, tr) {
    tr.footBodies ??= [...new Set(c.parts.map((p, k) => (tr.feet(k) ? c.partBody[k] : -1)).filter(b => b >= 0))];
    tr.fs ??= tr.footBodies.map(() => ({ off: 0, from: null }));
    tr.footBodies.forEach((b, n) => {
      const f = tr.fs[n], pos = c.bc[b];
      let down = false;
      for (let k = 0; k < c.parts.length && !down; k++) if (c.partBody[k] === b && c.onGround[k]) down = true;
      if (!down) { if (f.off === 0) f.from = [pos[0], pos[2]]; f.off += DT; return; }
      // it must go somewhere: land STEP_LEN further along the creature's way
      // (its facing, for animals) or further from the start, than it lifted.
      // Counting any 5 cm step, creatures marched in place for the bonus.
      const d = [pos[0] - f.from?.[0], 0, pos[2] - f.from?.[1]];
      const ahead = !f.from ? 0 : tr.fwd ? dot(d, tr.fwd)
        : tr.start ? Math.hypot(pos[0] - tr.start[0], pos[2] - tr.start[2]) - Math.hypot(f.from[0] - tr.start[0], f.from[1] - tr.start[2]) : 0;
      if (f.off >= STEP_AIR && ahead >= STEP_LEN) {
        tr.nSteps = (tr.nSteps || 0) + 1;
        tr.caught = this.snap(tr);
      }
      f.off = 0;
    });
  }

  // Speed from distance. 'net' (new scenes): the straight line from start
  // to finish (or to the fall's rollback point) over the time, less any drop:
  // rocking back and forth or circling nets nothing, only going somewhere
  // counts. 'sims' (scenes from before): Sims' half the furthest it got from
  // the start, half the final third's distance, which rewarded a lean out
  // and back, or a rock caught at the right moment.
  travel(tr, drop, dropLate, T) {
    if (this.scene.speed === 'net') {
      if (!tr.last) return 0;
      const d = sub(tr.last, tr.start);
      // head first: only the way it faced when measuring began counts
      return Math.max(0, (tr.fwd ? dot(d, tr.fwd) : len(d)) - drop) / T;
    }
    return Math.max(0, 0.5 * (tr.maxDist - drop) / T + 0.5 * (tr.mark ? Math.max(0, len(sub(tr.last, tr.mark)) - dropLate) : 0) / (T / 3));
  }

  // Head first (scene forward, animal templates on land): the horizontal
  // direction the creature faces, its root's built forward (X) as it is now.
  // An evolved quadruped walked rump-first. Other bodies have no front.
  facing(c) {
    if (!this.scene.forward || !TEMPLATES[c.genome.plan?.type] || this.task.env !== 'land') return null;
    const f = qrot(c.partPose(0).q, qrot(qconj(c.partQ[0]), [1, 0, 0]));
    const h = Math.hypot(f[0], f[2]);
    return h > 1e-6 ? [f[0] / h, 0, f[2] / h] : null;
  }

  // walking with falls: the step bonus, stepWeight x the share of STEP_MAX steps taken
  stepBonus(tr) { return (this.scene.stepWeight ?? 0.1) * Math.min(1, (tr.nSteps || 0) / STEP_MAX); }

  // walking with falls: which parts are feet, as a function of part index
  feetOf(c) {
    const roles = TEMPLATES[c.genome.plan?.type]?.roles;
    if (roles) return k => { const r = roles[c.genome.nodes[c.parts[k].node].role]; return !!r?.ground && !r.prop; };
    const on = new Set(c.parts.map((p, k) => (c.onGround[k] ? k : -1)).filter(k => k >= 0));
    return k => on.has(k);
  }

  // knocked down: hang the pendulum over the creature's centre of mass and
  // raise it KNOCK.angle toward the direction it comes from; its bottom
  // passes through the centre of mass. Its energy is added to the books.
  hangPendulum() {
    const c = this.creatures[0], com = c.com(), a = this.knock.angle;
    const pivot = [com[0], com[1] + KNOCK.aim + KNOCK.len, com[2]], d = [Math.cos(a), 0, Math.sin(a)];
    const b = [pivot[0] + d[0] * KNOCK.len * Math.sin(KNOCK.angle), pivot[1] - KNOCK.len * Math.cos(KNOCK.angle), pivot[2] + d[2] * KNOCK.len * Math.sin(KNOCK.angle)];
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...pivot));
    const ball = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...b).setCanSleep(false));
    const vol = 4 / 3 * Math.PI * KNOCK.r ** 3, m = (this.scene.knockMass ?? 2) * c.totalMass;
    this.world.createCollider(RAPIER.ColliderDesc.ball(KNOCK.r).setDensity(m / vol).setFriction(this.scene.friction), ball);
    // the rope: a ball joint at the pivot, the ball's centre KNOCK.len below it
    const off = sub(pivot, b);
    const joint = this.world.createImpulseJoint(RAPIER.JointData.spherical(V([0, 0, 0]), V(off)), fixed, ball, true);
    this.pend = { fixed, ball, joint, pivot };
    const e = this.pendEnergy();
    this.e0 += e; this.mass += ball.mass();
    this.knock.at = this.t;
  }
  pendEnergy() {
    const b = this.pend.ball, v = b.linvel(), w = b.angvel(), m = b.mass();
    return m * (0.5 * (v.x * v.x + v.y * v.y + v.z * v.z) + this.g * b.translation().y) + 0.5 * 0.4 * m * KNOCK.r ** 2 * (w.x * w.x + w.y * w.y + w.z * w.z);
  }
  // after one pass, the pendulum is taken away (and its energy off the books)
  dropPendulum() {
    this.e0 -= this.pendEnergy();
    this.mass -= this.pend.ball.mass();
    this.world.removeRigidBody(this.pend.ball);
    this.world.removeRigidBody(this.pend.fixed);
    this.pend = null;
  }

  // Skiing: each ski on the snow grips sideways. Its sideways velocity is
  // taken out by an impulse at the ski, up to SKI.grip x the weight the
  // touching skis share (Coulomb on the edge), so it only ever removes
  // energy. And air drag on the body, against its velocity: skiDrag x
  // frontal area (the bounding box seen along the motion) x v^2, so tucking
  // low and narrow is faster.
  skiEdges(c) {
    if (this.hillPts) return this.hillEdges(c, (x, z) => this.hillAt(x));
    if (this.course) return this.hillEdges(c, (x, z) => this.courseAt(x, z));
    const hy = s => (this.scene.bladesOnly ? s.half[1] : SKI.half[1]);   // (tall skis and blades)
    const on = c.skis.filter(s => { const b = c.bodies[s.body], q = b.rotation(), t = b.translation(), p = add([t.x, t.y, t.z], qrot(q, s.at)); return p[1] < 2 * hy(s) + 0.01; });
    const cap = on.length ? SKI.grip * c.totalMass * this.g * DT / on.length : 0;
    const wax = this.scene.wax || 0;
    for (const s of on) {
      const b = c.bodies[s.body], q = b.rotation(), t = b.translation();
      const p = add([t.x, t.y, t.z], qrot(q, s.at)), a = qrot(q, [1, 0, 0]);
      const h = Math.hypot(a[0], a[2]); if (h < 1e-6) continue;
      const side = [-a[2] / h, 0, a[0] / h];
      const v = add(c.bv[s.body], cross(c.bw[s.body], sub(p, c.bc[s.body])));
      const vs = dot(v, side), J = Math.max(-cap, Math.min(cap, -vs * c.mass[s.body]));
      b.applyImpulseAtPoint(V(scale(side, J)), V(p), true);
      // grip wax (cross-country): sliding back along its line, the ski grips
      // (Coulomb, wax x its share of the weight); forward it runs free
      if (wax > 0) {
        const fwd = [a[0] / h, 0, a[2] / h], va = dot(v, fwd);
        if (va < 0) b.applyImpulseAtPoint(V(scale(fwd, Math.min(wax * cap / SKI.grip, -va * c.mass[s.body]))), V(p), true);
      }
    }
    this.airDrag(c);
  }

  // skiing's edges on real snow (the jumping hill, a cross-country course):
  // as skiEdges, with "on the snow" and "sideways" taken from the surface
  // under each ski, surf(x, z) (its normal n: sideways = n x the ski's axis),
  // the cap from the weight's share pressing into the slope
  hillEdges(c, surf) {
    const on = [], wax = this.scene.wax || 0;
    for (const s of c.skis) {
      const b = c.bodies[s.body], q = b.rotation(), t = b.translation(), p = add([t.x, t.y, t.z], qrot(q, s.at));
      const { y, n } = surf(p[0], p[2]);
      if ((p[1] - y) * n[1] < 2 * (this.scene.bladesOnly ? s.half[1] : SKI.half[1]) + 0.01) on.push({ s, b, q, p, n });
    }
    for (const { s, b, q, p, n } of on) {
      const cap = SKI.grip * c.totalMass * this.g * n[1] * DT / on.length;
      const side0 = cross(n, qrot(q, [1, 0, 0])), h = len(side0);
      if (h < 1e-6) continue;
      const side = scale(side0, 1 / h);
      const v = add(c.bv[s.body], cross(c.bw[s.body], sub(p, c.bc[s.body])));
      const vs = dot(v, side), J = Math.max(-cap, Math.min(cap, -vs * c.mass[s.body]));
      b.applyImpulseAtPoint(V(scale(side, J)), V(p), true);
      // grip wax, as skiEdges: along the ski in the snow's plane
      if (wax > 0) {
        const fwd = cross(side, n), va = dot(v, fwd);
        if (va < 0) b.applyImpulseAtPoint(V(scale(fwd, Math.min(wax * cap / SKI.grip, -va * c.mass[s.body]))), V(p), true);
      }
    }
    this.airDrag(c);
  }

  airDrag(c) {
    const k = this.scene.skiDrag ?? 0.3;
    if (k > 0) {
      let P = [0, 0, 0]; for (let i = 0; i < c.nb; i++) P = add(P, scale(c.bv[i], c.mass[i]));
      const v = scale(P, 1 / c.totalMass), sp = len(v);
      if (sp > 1e-6) {
        const u = scale(v, 1 / sp), [lo, hi] = c.extentAcross(u);
        const F = k * lo * hi * sp * sp, imp = Math.min(F * DT, sp * c.totalMass);
        for (let i = 0; i < c.nb; i++) c.bodies[i].applyImpulse(V(scale(u, -imp * c.mass[i] / c.totalMass)), true);
      }
    }
  }

  // Getting up and knocked down: how well it stands, 0..1: the root's
  // uprightness, (1 + up) / 2, x its centre of mass's height as a share of
  // the built pose's, halved while any part but its feet touches the ground.
  // New scenes count only real feet (REAL_FEET; propped on a tail isn't
  // standing); before, a template's ground parts (tails too), or else the
  // parts on the ground as built.
  standing(c, y) {
    const u = qrot(c.partPose(0).q, qrot(qconj(c.partQ[0]), [0, 1, 0]));
    const roles = TEMPLATES[c.genome.plan?.type]?.roles;
    const foot = k => {
      const role = c.genome.nodes[c.parts[k].node].role;
      return roles ? (this.scene.falls ? REAL_FEET.includes(role) : !!roles[role]?.ground) : c.feet.has(k);
    };
    const down = c.parts.some((p, k) => c.onGround[k] && !foot(k));
    return { s: (1 + u[1]) / 2 * Math.max(0, Math.min(1, y / c.standY)) * (down ? 0.5 : 1), up: u[1] };
  }

  // what an eye sees as salient: the prize (ball, cube or barbell) or another creature's body
  salient(h, i, col) {
    if (col !== undefined && (this.gateCols?.has(col) || this.markCols?.has(col))) return true;
    if (this.cube && this.cube.handle === h) return true;
    if (this.pend && this.pend.ball.handle === h) return true;
    return this.creatures.some((c, k) => k !== i && c.valid && c.bodies.some(b => b.handle === h));
  }

  cubePos() { return this.cube ? A(this.cube.translation()) : null; }

  step() {
    const { task, world } = this;
    if (this.walkFalls && !this.posed && this.tStart !== null && this.t >= this.tStart) {
      this.posed = true;
      for (const c of this.creatures) if (c.valid) c.holdPose();
      // ski jumping: the start gate opens: gravity turns from into the slope
      // to straight down (setting friction here instead did nothing to a
      // body at rest: Rapier keeps a resting contact's old friction). The
      // audit's start moves with the potential, so nothing seems created or lost
      if (this.hillCols) {
        const e1 = this.energy();
        this.g = this.gTrue; this.gx = 0;
        world.gravity = { x: 0, y: -this.g, z: 0 };
        this.e0 += this.energy() - e1;
      }
    }
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
      c.look((h, col) => this.salient(h, i, col));
      if (this.surface) c.feelWater();
      // settling apart, the brain waits: its senses are from the wrong place
      if (!this.apart) {
        brainStep(c.brain, DT / 2);
        brainStep(c.brain, DT / 2);
      }
      if (c.gait && active) c.gaitStep(this.t - this.tStart);
      // reflexes hold posture from the start, except while relaxing as Sims did
      c.actuate(active, this.tStart !== null || !this.relaxing);
      if (c.skis) this.skiEdges(c);
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
      // walking with falls (scene falls), while measuring: a fall is a part
      // other than the feet touching down (the template's ground parts, or
      // else the parts on the ground when measuring started; all of a snake),
      // the root tilting over FALL_TILT from its built uprightness, or the
      // centre of mass dropping below FALL_LOW of its starting height. Parts
      // already resting on the ground when measuring starts (a dragging
      // abdomen, pincers) are posture, not a fall, and may stay down.
      // A topple can carry a body forward before anything but feet lands, so
      // on a fall the score rolls back FALL_BACK s, to before it began.
      if (this.walkFalls && !this.hillCols && this.tStart !== null && this.t >= this.tStart && this.track[i].fell === undefined) {
        const tr = this.track[i];
        if (!tr.feet) {
          tr.feet = this.feetOf(c);
          // (a template's props, like a biped's tail, may not rest on the ground)
          const roles = TEMPLATES[c.genome.plan?.type]?.roles;
          tr.resting = new Set(c.parts.map((p, k) => (c.onGround[k] && !roles?.[c.genome.nodes[p.node].role]?.prop ? k : -1)).filter(k => k >= 0));
          tr.h0 = c.com()[1] / c.standY;   // how tall it stands as measuring starts
          // skiing: only the skis and their feet may touch the snow, no
          // resting parts: winners dragged a head as a third runner, or
          // sledged on their bellies
          // bladesOnly: only the skis or blades themselves; a boot (the foot
          // itself, or toes fused to it) on the snow or ice is a fall too
          if (c.skis) {
            const on = new Set(c.skis.map(s => s.body));
            tr.feet = this.scene.bladesOnly ? k => on.has(c.partBody[k]) && !c.bare[k] : k => on.has(c.partBody[k]);
            tr.resting = new Set();
          }
        }
        const up = qrot(c.partPose(0).q, qrot(qconj(c.partQ[0]), [0, 1, 0]))[1];
        // (on a course, the height above the snow under it; it starts on the flat at 0)
        const cm = c.com(), low = tr.y0 !== undefined && cm[1] - (this.course ? this.courseAt(cm[0], cm[2]).y : 0) < FALL_LOW * tr.y0;
        // sliding: the slowest foot on the ground is the creature's anchor,
        // and however far the anchor itself slides is subtracted. A planted
        // foot (walking, shuffling) slides nowhere; when every foot skids, as
        // when a creature swinging a heavy weight slides along, the skid
        // doesn't count. Airborne phases count. Snakes are exempt:
        // slithering is sliding.
        if (task.kind !== 'stand') this.trackSteps(c, tr);
        if (c.genome.plan?.type !== 'snake') {
          let anchor = null, slow = Infinity;
          for (let k = 0; k < c.parts.length; k++) {
            if (!c.onGround[k] || !tr.feet(k)) continue;
            const b = c.partBody[k], v = add(c.bv[b], cross(c.bw[b], sub(c.partPose(k).c, c.bc[b])));
            const sp = Math.hypot(v[0], v[2]);
            if (sp < slow) { slow = sp; anchor = v; }
          }
          if (anchor) tr.slideOff = add(tr.slideOff || [0, 0, 0], [anchor[0] * DT, 0, anchor[2] * DT]);
        }
        if (up < Math.cos(TEMPLATES[c.genome.plan?.type]?.fallTilt ?? FALL_TILT) || low || (c.parts.some((p, k) => c.onGround[k] && !tr.feet(k) && !tr.resting.has(k)))) {
          tr.fell = this.t;
          // roll back FALL_BACK s, or only to the last step if that came later
          const back = tr.past?.[0], caught = tr.caught;
          const to = caught && (!back || caught.t > back.t) ? caught : back;
          if (to) { const { t, ...state } = to; Object.assign(tr, state); }
        }
      }
      if (this.tStart !== null && this.t >= this.tStart) this.trackStep(i);
    }
    if (this.tStart === null) this.relaxStep();
    // knocked down: the pendulum comes KNOCK.delay s into measuring and goes
    // once it has swung through and out the far side (about 1.5 half-periods)
    if (this.knock && this.tStart !== null) {
      if (this.knock.at === null && this.t >= this.tStart + KNOCK.delay && this.creatures[0]?.valid) this.hangPendulum();
      else if (this.pend && this.t >= this.knock.at + 1.5 * Math.PI * Math.sqrt(KNOCK.len / this.g)) this.dropPendulum();
    }
    if (this.lift && this.tStart !== null && this.t >= this.tStart) this.liftStep();
    if (this.throw && this.tStart !== null && this.t >= this.tStart) this.throwStep();
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
    this.creatures.forEach(c => { if (c.valid) e += c.fullEnergy(this.g, this.gx) + (this.surface ? c.buoyEnergy(this.scene.buoyancy, this.g) : 0); });
    if (this.pend) e += this.pendEnergy();
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

  // The whole body's spin about the vertical through its centre of mass:
  // [angular momentum, moment of inertia]. Their ratio is the body's mean
  // turning rate: a part twisting one way while the rest turns back (as a
  // falling cat rights itself) nets nothing, and pulling the limbs in speeds
  // it up, as it does a skater.
  spinOf(c) {
    const C = c.com();
    let L = 0, I = 0;
    for (let i = 0; i < c.nb; i++) {
      const v = c.bv[i], w = c.bw[i], r = sub(c.bc[i], C), m = c.mass[i];
      const M = c.bodies[i].effectiveAngularInertia();
      L += m * (r[2] * v[0] - r[0] * v[2]) + M.m12 * w[0] + M.m22 * w[1] + M.m23 * w[2];
      I += m * (r[0] * r[0] + r[2] * r[2]) + M.m22;
    }
    return [L, I];
  }

  // Figure skating: turns are counted only in the air (nothing touching the
  // ice), at the body's mean rate (spinOf), with its angular momentum held to
  // no more than it had at take-off (nothing in the air can add any; the
  // solver mustn't). A jump scores once it lands on its skates alone and
  // holds that, upright, SPIN.hold s; one that ends in a fall (anything else
  // on the ice, tilting past the fall angle, or sinking low) scores
  // SPIN.fallen of its turns. Score: its best landed jump. Jumps must take
  // off within the measured time; the grace time lets the last one land.
  spinStep(c, tr, y) {
    if (tr.y0 === undefined) { tr.y0 = y; tr.best = 0; tr.fallen = 0; tr.jumps = 0; tr.landed = 0; tr.ice = 0; tr.maxAir = 0; }
    const skates = new Set(c.skis.map(s => s.body));
    let ground = false, other = false;
    c.parts.forEach((p, k) => { if (c.onGround[k]) { ground = true; if (!skates.has(c.partBody[k])) other = true; } });
    const up = qrot(c.partPose(0).q, qrot(qconj(c.partQ[0]), [0, 1, 0]))[1];
    const down = other || up < Math.cos(TEMPLATES[c.genome.plan?.type]?.fallTilt ?? FALL_TILT) || y < FALL_LOW * tr.y0;
    const crash = turns => { tr.fallen = Math.max(tr.fallen, turns); };
    if (!ground) {
      if (!tr.air) {
        // take-off (only in the measured time); a landing not yet held is cut short
        if (this.t > this.tStart + this.T) return;
        if (tr.pend) { crash(tr.pend.turns); tr.pend = null; }
        tr.air = { L: this.spinOf(c)[0], turns: 0, t: this.t };
      }
      const [L, I] = this.spinOf(c), L0 = tr.air.L;
      const Lc = Math.sign(L0) * Math.min(Math.abs(L0), Math.max(0, Math.sign(L0) * L));
      if (I > 1e-9) tr.air.turns += Lc / I * DT / (2 * Math.PI);
      tr.maxAir = Math.max(tr.maxAir, this.t - tr.air.t);
      return;
    }
    // the wind-up: net turns spun upright on the skates (shaping, below)
    if (!down && this.t <= this.tStart + this.T) { const [L, I] = this.spinOf(c); if (I > 1e-9) tr.ice += L / I * DT / (2 * Math.PI); }
    if (tr.air) {
      // landing: a hop too short to be a jump is just skating
      const air = tr.air; tr.air = null;
      if (this.t - air.t >= SPIN.minAir) { tr.jumps++; tr.pend = { turns: Math.abs(air.turns), t: this.t }; }
    }
    if (tr.pend) {
      if (down) { crash(tr.pend.turns); tr.pend = null; }
      else if (this.t - tr.pend.t >= SPIN.hold) { tr.best = Math.max(tr.best, tr.pend.turns); tr.landed++; tr.pend = null; }
    }
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
    if (task.kind === 'spin') { this.spinStep(c, tr, y); return; }
    if (task.kind === 'skijump') { this.jumpStep(c, tr); return; }
    // walking with falls: nothing after the fall counts, nor in the grace time
    if (this.walkFalls && (tr.fell !== undefined || this.t > this.tStart + this.T + 1e-9)) return;
    if (task.env === 'land') {
      if (tr.y0 === undefined) tr.y0 = tr.minY = y;
      tr.minY = Math.min(tr.minY, y);
      if (tr.yMark !== undefined) tr.minYMark = Math.min(tr.minYMark, y);
    }
    if (task.kind === 'speed') {
      let p = c.com();
      if (task.env !== 'water') p = [p[0], 0, p[2]];   // on land and at the surface, horizontal
      if (tr.slideOff) p = sub(p, tr.slideOff);   // less any sliding
      if (!tr.start) { tr.start = p; tr.fwd = this.facing(c); }
      tr.maxDist = Math.max(tr.maxDist, len(sub(p, tr.start)));
      if (!tr.mark && elapsed >= this.T * 2 / 3) { tr.mark = p; tr.yMark = tr.minYMark = y; }
      tr.last = p;
      if (this.walkFalls) this.keepPast(tr);
    } else if (task.kind === 'ski') {
      const p = [c.com()[0], 0, c.com()[2]];
      // slalom: crossing each gate's line, through its opening or not; past
      // the first one missed, no more distance counts
      if (this.gates && tr.last) this.gates.forEach((g, k) => {
        if (tr.last[0] < g.x && p[0] >= g.x) {
          const z = tr.last[2] + (p[2] - tr.last[2]) * (g.x - tr.last[0]) / (p[0] - tr.last[0]);
          (tr.gates ??= [])[k] ??= Math.abs(z - g.z) <= g.w;
          if (!tr.gates[k] && tr.cap === undefined) tr.cap = g.x;
        }
      });
      // ... and which gates' panels any part touched (once a gate)
      if (this.gates) for (const col of c.colliders) this.world.intersectionPairsWith(col, o => {
        const k = this.gateOf.get(o.handle);
        if (k !== undefined) (tr.hits ??= [])[k] = true;
      });
      // course: along the trail; past where it first strayed off, no more counts
      if (this.course) {
        const st = this.courseStation(p[0], p[2], tr.ci ?? this.course.i0);
        tr.ci = st.k; tr.s = st.s;
        if (tr.s0 === undefined) tr.s0 = st.s;
        if (st.off > (this.scene.courseWidth ?? 3) / 2 && tr.cap === undefined) tr.cap = st.s;
      }
      if (!tr.start) { tr.start = p; if (this.scene.skates) tr.fwd = this.facing(c) || [1, 0, 0]; }
      tr.last = p;
      if (this.walkFalls) this.keepPast(tr);
    } else if (task.kind === 'stand') {
      // standing: its height as a share of the built pose's (no more for
      // jumping), each measured step until a fall
      tr.hSum = (tr.hSum || 0) + Math.max(0, Math.min(1, y / c.standY));
    } else if (task.kind === 'knock' && this.knock.at !== null) {
      // knocked down: standing, as in getting up, from the strike on; and
      // whether it was knocked over (tilted past 60 degrees, or below 60% of
      // its height), since getting back up is the point
      const { s, up } = this.standing(c, y);
      if (up < 0.5 || y < 0.6 * c.standY) tr.knocked = true;
      tr.sum = (tr.sum || 0) + s; tr.n = (tr.n || 0) + 1;
      if (elapsed >= this.T * 2 / 3) { tr.late = (tr.late || 0) + s; tr.nLate = (tr.nLate || 0) + 1; }
    } else if (task.kind === 'getup') {
      // standing: the root's uprightness, (1 + up) / 2 (on its back 0, on its
      // side 0.5, as built 1, so rolling over already counts) x the centre of
      // mass's height as a share of the built pose's (no more for jumping),
      // halved while any part but its feet touches the ground (see standing)
      const { s } = this.standing(c, y);
      tr.sum = (tr.sum || 0) + s; tr.n = (tr.n || 0) + 1;
      if (elapsed >= this.T * 2 / 3) { tr.late = (tr.late || 0) + s; tr.nLate = (tr.nLate || 0) + 1; }
    } else if (task.kind === 'upright') {
      if (tr.fell === undefined) {
        let p = [c.com()[0], 0, c.com()[2]];
        if (tr.slideOff) p = sub(p, tr.slideOff);   // less any sliding
        if (!tr.start) { tr.start = p; tr.fwd = this.facing(c); }
        tr.maxDist = Math.max(tr.maxDist, len(sub(p, tr.start)));
        if (!tr.mark && elapsed >= this.T * 2 / 3) { tr.mark = p; if (this.walkFalls) tr.yMark = tr.minYMark = y; }
        tr.last = p;
        if (this.walkFalls) this.keepPast(tr);
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
      // under the fall rules (new scenes), a climb ends at a fall, keeping
      // its height from FALL_BACK s before: toppling forward onto the steps
      // gained height, and nothing made a climber stay up
      tr.last = y; tr.low = c.lowest();
      if (this.walkFalls) this.keepPast(tr);
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
      if (task.kind === 'speed' && this.walkFalls) {
        // up to the fall: Sims' distance terms less the centre of mass's
        // drop (a topple nets about nothing), plus 0.1 x standing: half the
        // share of the time it stayed up, half how tall it stood as measuring
        // began (built height = 1), so even shuffling while standing is a
        // start, and so is standing taller before collapsing
        const T0 = this.tStart, up = tr.fell === undefined ? 1 : Math.min(1, Math.max(0, tr.fell - T0) / T);
        const stand = 0.5 * up + 0.5 * Math.max(0, Math.min(1, tr.h0 || 0));
        if (!tr.start) return (this.scene.standWeight ?? 0.1) * stand + this.stepBonus(tr);
        const drop = tr.y0 - tr.minY, dropLate = tr.yMark === undefined ? 0 : tr.yMark - tr.minYMark;
        return this.travel(tr, drop, dropLate, T) + (this.scene.standWeight ?? 0.1) * stand + this.stepBonus(tr);
      }
      if (task.kind === 'speed') {
        if (!tr.start || (!tr.mark && this.scene.speed !== 'net')) return 0;
        const drop = tr.y0 === undefined ? 0 : tr.y0 - tr.minY;
        const dropLate = tr.yMark === undefined ? 0 : tr.yMark - tr.minYMark;
        return this.travel(tr, drop, dropLate, T);
      }
      if (task.kind === 'upright') {
        // as walking (Sims' max distance plus the final third's distance),
        // up to the fall; plus 0.1 x the share of the time it stayed up,
        // settling included, so that standing longer is a first step
        const up = tr.fell === undefined ? 1 : Math.min(1, tr.fell / (task.settle + T));
        if (!tr.start) return 0.1 * up;
        if (this.walkFalls) {
          // less the centre of mass's drop up to the fall, so a topple nets about nothing
          const drop = tr.y0 === undefined ? 0 : tr.y0 - tr.minY, dropLate = tr.yMark === undefined ? 0 : tr.yMark - tr.minYMark;
          return this.travel(tr, drop, dropLate, T) + 0.1 * up + this.stepBonus(tr);
        }
        return this.travel(tr, 0, 0, T) + 0.1 * up;
      }
      if (task.kind === 'jump') return Math.max(0, tr.maxLow);
      // throwing: the farthest throw (m), plus shaping for lifting it
      if (task.kind === 'throw') {
        const th = this.throw;
        // grab: a fall, or the implement knocked to the ground, scores nothing
        if (this.scene.grab) {
          if (!th || tr.fell !== undefined || th.knocked) return 0;
          return this.scene.grabOnly ? this.gripScore(th) : th.best + (this.scene.throwShape ?? 0.1) * this.gripScore(th);
        }
        // shaping: half for touching it at all, half for lifting it
        return th ? th.best + (this.scene.throwShape ?? 0.1) * ((th.touched ? 0.5 : 0) + 0.5 * Math.min(1, Math.max(0, th.lift) / THROW.lift)) : 0;
      }
      // figure skating: the most turns in a jump it landed, and a little for
      // one it fell from (still in the air or not yet held at the end: a fall)
      // Shaping (scene spinShape, default 0.1, 0 = none), a third each: net
      // turns spun upright on the ice, up to SPIN.iceTurns; the longest time
      // in the air, up to SPIN.air s; and having landed a jump at all (a
      // first winner jumped and crashed every time). At most 0.1, a tenth of
      // one landed turn
      if (task.kind === 'spin') {
        const shape = (this.scene.spinShape ?? 0.1) * (Math.min(1, Math.abs(tr.ice || 0) / SPIN.iceTurns) + Math.min(1, (tr.maxAir || 0) / SPIN.air) + (tr.landed ? 1 : 0)) / 3;
        return (tr.best || 0) + SPIN.fallen * Math.max(tr.fallen || 0, tr.pend?.turns || 0, Math.abs(tr.air?.turns || 0)) + shape;
      }
      // skiing: downhill (+X) as far as it got before any fall, over the
      // time; on the flat, as far in any direction; plus the standing bonus
      if (task.kind === 'ski') {
        const up = tr.fell === undefined ? 1 : Math.min(1, Math.max(0, tr.fell - this.tStart) / T);
        const stand = 0.5 * up + 0.5 * Math.max(0, Math.min(1, tr.h0 || 0));
        if (!tr.start || !tr.last) return (this.scene.standWeight ?? 0.1) * stand;
        const d = sub(tr.last, tr.start);
        let dist = this.course ? (tr.s ?? 0) - (tr.s0 ?? 0) : this.hill ? d[0] : this.scene.skates && tr.fwd ? dot(d, tr.fwd) : len(d);
        if (tr.cap !== undefined) dist = Math.min(dist, tr.cap - (this.course ? tr.s0 : tr.start[0]));   // slalom: up to the missed gate (course: where it strayed)
        // slalom: gateBonus for each gate passed through its opening before
        // the first miss, less gateHit for each gate whose panels it touched
        let gates = 0;
        if (this.gates) {
          for (let k = 0; k < this.gates.length && tr.gates?.[k]; k++) gates += this.scene.gateBonus ?? 0;
          gates -= (this.scene.gateHit ?? 0) * (tr.hits || []).filter(Boolean).length;
        }
        return Math.max(0, Math.max(0, dist) / T + gates) + (this.scene.standWeight ?? 0.1) * stand;
      }
      // ski jumping: getting down the inrun (shaping), a point per JUMP.per m
      // of distance, jumpLand for a landing held on the skis, and jumpRide
      // for the share of the ride out after it
      if (task.kind === 'skijump') {
        const j = tr.jump;
        if (!j) return 0;
        const prog = j.prog ?? (j.phase === 'inrun' ? Math.max(0, Math.min(1, (c.com()[0] - j.x0) / Math.max(0.1, this.edge[0] - j.x0))) : 1);
        const landed = j.phase === 'landed' || j.phase === 'riding';
        return JUMP.shape * prog + Math.max(0, j.dist || 0) / JUMP.per + (landed ? this.scene.jumpLand ?? 0.5 : 0)
          + (this.scene.jumpRide ?? 0) * Math.min(1, (j.ride || 0) / JUMP.ride);
      }
      // standing: half the share of the time it stayed up, half its average
      // height over the whole time (nothing after a fall)
      if (task.kind === 'stand') {
        const steps = Math.round(T / DT), up = tr.fell === undefined ? 1 : Math.min(1, Math.max(0, tr.fell - this.tStart) / T);
        return 0.5 * up + 0.5 * Math.min(1, (tr.hSum || 0) / steps);
      }
      // getting up: standing over the last third, plus a quarter for the whole time
      if (task.kind === 'getup') return tr.nLate ? 0.75 * tr.late / tr.nLate + 0.25 * tr.sum / tr.n : 0;
      // knocked down: never knocked over (dodged, or shrugged it off) keeps
      // half: getting back up is what scores best
      if (task.kind === 'knock') return tr.nLate ? (0.75 * tr.late / tr.nLate + 0.25 * tr.sum / tr.n) * (tr.knocked ? 1 : 0.5) : 0;
      // stairs: half the COM's rise, half the lowest point's final height,
      // so standing up tall earns little and every part has to climb
      if (task.kind === 'climb') {
        const climb = tr.last === undefined ? 0 : Math.max(0, 0.5 * (tr.last - tr.y0) + 0.5 * Math.max(0, tr.low));
        if (!this.walkFalls) return climb;
        // under the fall rules, the standing bonus too (as skiing): half the
        // share of the time it stayed up, half how tall it stood at the start
        const up = tr.fell === undefined ? 1 : Math.min(1, Math.max(0, tr.fell - this.tStart) / T);
        return climb + (this.scene.standWeight ?? 0.1) * (0.5 * up + 0.5 * Math.max(0, Math.min(1, tr.h0 || 0)));
      }
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
// opts.learn (keeping learned weights): the first creature's Hebbian weights
// carry from each trial to the next, and the result is { fit, learned }, the
// weights it ended with (brain.js learnedWeights), to write into its genome.
export function evaluate(taskName, genomes, opts = {}) {
  const task = TASKS[taskName];
  // both sides: the same bout with the creatures in swapped order, each
  // creature's two scores averaged
  if (task.pair && genomes.length === 2 && sceneFor(taskName, opts.scene).bothSides) {
    const ra = evaluate(taskName, genomes, { ...opts, scene: { ...opts.scene, bothSides: false } });
    const b = evaluate(taskName, [genomes[1], genomes[0]], { ...opts, learn: false, scene: { ...opts.scene, bothSides: false } });
    const a = opts.learn ? ra.fit : ra;
    const fit = [(a[0] + b[1]) / 2, (a[1] + b[0]) / 2];
    return opts.learn ? { fit, learned: ra.learned } : fit;
  }
  const sum = genomes.map(() => 0);
  let gs = genomes, learned = null;
  for (let trial = 0; trial < task.trials; trial++) {
    const sim = new Sim(taskName, gs, { ...opts, trial });
    while (!sim.done) sim.step();
    sim.fitness().forEach((f, i) => { sum[i] += f; });
    const c = sim.creatures[0];
    if (opts.learn && c?.valid && c.brain.plastic) {
      learned = learnedWeights(c.brain);
      gs = [applyLearned(JSON.parse(JSON.stringify(gs[0])), learned), ...gs.slice(1)];
    }
    sim.free();
  }
  const fit = sum.map(s => s / task.trials);
  return opts.learn ? { fit, learned } : fit;
}
