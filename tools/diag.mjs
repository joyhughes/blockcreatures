import { initPhysics, Sim } from '../src/sim.js';
import { randomGenome, develop, interpenetrates } from '../src/genome.js';
import { makeRng } from '../src/math.js';
await initPhysics();
const rng = makeRng(7);
const task = process.argv[2] || 'swim';
let shown = 0;
for (let i = 0; i < 200 && shown < 8; i++) {
  const g = randomGenome(rng);
  if (interpenetrates(develop(g).parts)) continue;
  const sim = new Sim(task, [g]);
  const c = sim.creatures[0];
  if (!c.joints.length) continue;
  shown++;
  let maxAng = 0, effAbs = 0, n = 0;
  while (!sim.done) {
    sim.step();
    for (const j of c.joints) for (const k of j.dofs) maxAng = Math.max(maxAng, Math.abs(j.angle[k]));
    for (const e of c.brain.effOut) { effAbs += Math.abs(e); n++; }
  }
  console.log(`parts ${c.parts.length} joints ${c.joints.map(j=>c.parts[j.part].joint).join(',')} failed ${sim.failed[0]} maxAng ${maxAng.toFixed(2)} meanEff ${(effAbs/Math.max(1,n)).toFixed(2)} strength ${c.joints.map(j=>Math.min(j.strength, j.iEff*250).toExponential(1)).join(',')} fit ${sim.fitness()[0].toFixed(4)}`);
}
