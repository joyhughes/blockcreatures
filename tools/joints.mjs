import { readFileSync } from 'node:fs';
import { initPhysics, Sim } from '../src/sim.js';
await initPhysics();
const run = JSON.parse(readFileSync(process.argv[2]));
const h = run.history[run.history.length - 1];
const sim = new Sim(run.task, [h.genome], { phase: h.phase });
const c = sim.creatures[0];
for (const j of c.joints) console.log('joint part', j.part, c.parts[j.part].joint, 'dofs', j.dofs, 'limits', j.limits.map(l => l.map(x => x.toFixed(2)).join('..')).join(' '), 'iEff', j.iEff.map(x=>x.toExponential(1)).join(','), 'strength', j.strength.toFixed(3));
for (let s = 0; s < 600; s++) {
  sim.step();
  if (s >= +(process.argv[3]||120) && s < +(process.argv[3]||120)+20) console.log(s, c.joints.map(j => j.dofs.map(k => `${j.angle[k].toFixed(3)}/${j.rate[k].toFixed(1)}`).join(' ')).join(' | '), 'w', c.bw.map(w => Math.hypot(...w).toFixed(1)).join(','), 'eff', Array.from(c.brain.effOut).map(x => x.toFixed(2)).join(','));
}
