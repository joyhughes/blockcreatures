// Energy audit: translational KE + PE of all bodies must stay below the
// initial energy plus the muscle work done.
import { readFileSync } from 'node:fs';
import { initPhysics, Sim, PHYS } from '../src/sim.js';
await initPhysics();
const run = JSON.parse(readFileSync(process.argv[2]));
const h = run.history[process.argv[3] ? +process.argv[3] : run.history.length - 1];
const sim = new Sim(run.task, [h.genome], { phase: h.phase });
const c = sim.creatures[0];
const g = sim.task.env === 'land' ? 9.81 : 0;
// full mechanical energy: translation + rotation (world inertia from Rapier) + gravity
const rot = (b, w) => {
  const M = b.effectiveAngularInertia();
  const Iw = [M.m11 * w[0] + M.m12 * w[1] + M.m13 * w[2], M.m12 * w[0] + M.m22 * w[1] + M.m23 * w[2], M.m13 * w[0] + M.m23 * w[1] + M.m33 * w[2]];
  return 0.5 * (w[0] * Iw[0] + w[1] * Iw[1] + w[2] * Iw[2]);
};
const E = () => c.bodies.reduce((s, b, i) => s + 0.5 * c.mass[i] * (c.bv[i][0] ** 2 + c.bv[i][1] ** 2 + c.bv[i][2] ** 2) + rot(b, c.bw[i]) + c.mass[i] * g * c.bc[i][1], 0);
const E0 = E();
let worst = -Infinity, at = 0;
while (!sim.done) {
  sim.step();
  const ex = E() - E0 - c.work;
  if (ex > worst) { worst = ex; at = sim.t; }
}
console.log('(incl. rotation) mass', c.totalMass.toFixed(3), 'work', c.work.toFixed(2), 'worst excess energy', worst.toFixed(3), 'at t', at.toFixed(2), 'fitness', sim.fitness()[0].toFixed(3));
