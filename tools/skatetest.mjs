// Skateboarding check: random bodies and saved creatures on the board.
// Per creature: fitness, audit failure, how the ride ended, time rolling
// with no foot down, the full energy audit's worst rise (J/kg).
// node tools/skatetest.mjs [task=skate] [n random=20] [files...]   (PLAN=quadruped: random animals)
import { readFileSync } from 'node:fs';
import { initPhysics, Sim } from '../src/sim.js';
import { randomGenome, develop, interpenetrates } from '../src/genome.js';
import { makeRng } from '../src/math.js';
await initPhysics();
const [task = 'skate', nArg = '20', ...files] = process.argv.slice(2);
const rng = makeRng(11);
const gs = [];
while (gs.length < +nArg) { const g = randomGenome(rng, process.env.PLAN ? { plan: { type: process.env.PLAN } } : undefined); if (!interpenetrates(develop(g).parts)) gs.push(['random' + gs.length, g]); }
for (const f of files) { const d = JSON.parse(readFileSync(f)); gs.push([f.split('/').pop(), d.genome || d.history.at(-1).genome]); }
let fails = 0;
for (const [name, g] of gs) {
  const sim = new Sim(task, [g], {});
  const c = sim.creatures[0];
  if (!c.valid) { console.log(name.padEnd(24), 'invalid'); continue; }
  let rise = 0, xMin = 0;
  const e0 = sim.energy();
  while (!sim.done) {
    sim.step();
    if (sim.failed[0]) break;
    const x = sim.energy() - e0 - c.work;
    xMin = Math.min(xMin, x); rise = Math.max(rise, x - xMin);
  }
  const tr = sim.track[0], f = sim.fitness()[0], b = sim.cube ? sim.cube.translation() : { x: 0, z: 0 };
  if (sim.failed[0]) fails++;
  const end = sim.failed[0] ? 'AUDIT/EXPLODE' : tr.off ? `off@${(tr.fell - sim.tStart).toFixed(1)}` : tr.fell !== undefined ? `fell@${(tr.fell - sim.tStart).toFixed(1)}` : 'rode';
  console.log(name.padEnd(24), 'fit', f.toFixed(3), end.padEnd(14), 'rolled', (tr.rolled || 0).toFixed(1) + 's', 'board x', b.x.toFixed(2), 'z', b.z.toFixed(2), 'rise', (rise / sim.mass).toFixed(3), 'J/kg', 'mass', c.totalMass.toFixed(2));
}
console.log('audit failures', fails, '/', gs.length);
