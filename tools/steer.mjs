// Closing speed of a champion toward lights in 8 directions: a creature that
// merely travels straight averages ~0; positive everywhere means it steers.
import { readFileSync } from 'node:fs';
import { initPhysics, Sim } from '../src/sim.js';
await initPhysics();
const c = JSON.parse(readFileSync(process.argv[2]));
const out = [];
for (let k = 0; k < 8; k++) {
  const sim = new Sim(c.task, [c.genome], { trial: 0, phase: k * Math.PI / 4 - Math.PI / 3, scene: c.scene });
  while (!sim.done) sim.step();
  out.push(sim.fitness()[0]);
  sim.free();
}
console.log(c.task, out.map(x => x.toFixed(2)).join(' '), 'mean', (out.reduce((a, b) => a + b) / 8).toFixed(3));
