import { readFileSync } from 'node:fs';
import { initPhysics, Sim, TASKS } from '../src/sim.js';
await initPhysics();
const run = JSON.parse(readFileSync(process.argv[2]));
const h = run.history[run.history.length - 1];
for (let trial = 0; trial < TASKS[run.task].trials; trial++) {
  const sim = new Sim(run.task, h.opponent ? [h.genome, h.opponent] : [h.genome], { phase: h.phase, trial });
  const c = sim.creatures[0];
  const out = [];
  while (!sim.done) {
    sim.step();
    if (sim.steps % 60 === 0) out.push(`${sim.t.toFixed(0)}:${c.com().map(x => x.toFixed(1)).join(',')}`);
  }
  console.log('trial', trial, 'parts', c.parts.length, 'light', sim.light?.map(x => x.toFixed(1)), 'cube', sim.cubePos()?.map(x => x.toFixed(2)), 'failed', sim.failed, 'fit', sim.fitness().map(x => x.toFixed(3)), 'track', JSON.stringify(sim.track[0]).slice(0, 120));
  if (sim.cube) console.log('  dists', sim.creatures.map(cc => cc.valid ? cc.distanceTo(sim.cubePos()).toFixed(3) : 'invalid'));
  console.log('  ', out.join(' '));
}
