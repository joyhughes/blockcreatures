import { readFileSync } from 'node:fs';
import { initPhysics, Sim } from '../src/sim.js';
await initPhysics();
const run = JSON.parse(readFileSync(process.argv[2]));
const h = run.history[run.history.length - 1];
const sim = new Sim(run.task, [h.genome], { phase: h.phase });
const c = sim.creatures[0];
const E = () => c.bodies.reduce((s, b, i) => s + 0.5 * c.mass[i] * (c.bv[i][0] ** 2 + c.bv[i][1] ** 2 + c.bv[i][2] ** 2) + c.mass[i] * 9.81 * c.bc[i][1], 0);
const E0 = E(); let prevEx = 0;
while (!sim.done) {
  sim.step();
  const ex = E() - E0 - c.work;
  if (ex - prevEx > 0.05) console.log(sim.steps, 'dEx', (ex - prevEx).toFixed(3), 'low', c.lowest().toFixed(3), 'angles', c.joints.map(j => j.angle.map(a => a.toFixed(2)).join(',')), 'lim', c.joints.map(j => j.limits.map(l => l.map(x => x.toFixed(2)).join('..')).join(' ')), 'v', c.bv.map(v => v.map(x => x.toFixed(1)).join(',')).join(' | '));
  prevEx = ex;
}
