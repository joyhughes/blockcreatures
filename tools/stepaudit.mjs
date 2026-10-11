// Per-step energy audit with exact accounting: translation + rotation +
// gravity + energy held in joint-limit springs must not rise by more than
// the muscle work done in that step. Prints the worst per-step gains.
import { readFileSync } from 'node:fs';
import { initPhysics, Sim } from '../src/sim.js';
await initPhysics();
const file = process.argv[2];
const d = JSON.parse(readFileSync(file));
const g0 = d.genome || d.history.at(-1).genome, task = d.task, phase = d.phase ?? d.history?.at(-1).phase ?? 0;
const sim = new Sim(task, [g0], { phase });
const c = sim.creatures[0];
const E = () => c.fullEnergy(sim.g);
let prevE = E(), prevW = c.work, worst = [];
const E0 = E(); let minX = 0, rise = 0, riseAt = 0;
while (!sim.done) {
  sim.step();
  if (sim.failed[0]) break;
  const e = E(), gain = (e - prevE) - (c.work - prevW);
  worst.push([gain, sim.steps]);
  prevE = e; prevW = c.work;
  const x = e - E0 - c.work;
  minX = Math.min(minX, x);
  if (x - minX > rise) { rise = x - minX; riseAt = sim.steps; }
}
worst.sort((a, b) => b[0] - a[0]);
console.log(file.split('/').pop().padEnd(36), 'mass', c.totalMass.toFixed(2), 'fit', sim.fitness()[0].toFixed(3), 'failed', sim.failed[0], 'worst step gain', worst[0][0].toFixed(3), 'max rise above running min', rise.toFixed(3), `(${(rise / c.totalMass).toFixed(3)} J/kg) @${riseAt}`, 'work', c.work.toFixed(1));
