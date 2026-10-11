// Per-step full-energy trace: shows steps where mechanical energy rises
// beyond muscle work, with joint-limit and contact state.
import { readFileSync } from 'node:fs';
import { initPhysics, Sim, PHYS } from '../src/sim.js';
await initPhysics();
const run = JSON.parse(readFileSync(process.argv[2]));
const h = run.history[run.history.length - 1];
const sim = new Sim(run.task, [h.genome], { phase: h.phase, scene: h.scene ?? run.scene });
const c = sim.creatures[0];
const g = sim.task.env === 'land' ? 9.81 : 0;
const rot = (b, w) => { const M = b.effectiveAngularInertia(); return 0.5 * (w[0] * (M.m11 * w[0] + M.m12 * w[1] + M.m13 * w[2]) + w[1] * (M.m12 * w[0] + M.m22 * w[1] + M.m23 * w[2]) + w[2] * (M.m13 * w[0] + M.m23 * w[1] + M.m33 * w[2])); };
const E = () => c.bodies.reduce((s, b, i) => s + 0.5 * c.mass[i] * (c.bv[i][0] ** 2 + c.bv[i][1] ** 2 + c.bv[i][2] ** 2) + rot(b, c.bw[i]) + c.mass[i] * g * c.bc[i][1], 0);
const E0 = E(); let prev = 0, tot = { lim: 0, free: 0, ground: 0 };
while (!sim.done) {
  sim.step();
  const ex = E() - E0 - c.work, d = ex - prev; prev = ex;
  const beyond = c.joints.some(j => j.dofs.some(k => j.angle[k] > Math.min(PHYS.limitMax, j.limits[k][1]) || j.angle[k] < Math.max(-PHYS.limitMax, j.limits[k][0])));
  const ground = c.onGround.some(Boolean);
  if (d > 0) { if (beyond) tot.lim += d; else tot.free += d; if (ground) tot.ground += d; }
  if (d > +(process.argv[3] || 0.05)) console.log(sim.steps, 'dEx', d.toFixed(3), 'beyondLimit', beyond, 'ground', ground, 'w', c.bw.map(w => Math.hypot(...w).toFixed(0)).join(','));
}
console.log('positive dEx while beyond a limit', tot.lim.toFixed(2), 'within limits', tot.free.toFixed(2), 'while touching ground', tot.ground.toFixed(2));
