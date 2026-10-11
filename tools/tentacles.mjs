// Hand-built radial creature with capsule tentacles, to check that chains
// of round parts develop and simulate cleanly. Writes examples/tentacles.json.
import { writeFileSync } from 'node:fs';
import { initPhysics, Sim } from '../src/sim.js';
import { develop } from '../src/genome.js';
import { viable } from '../src/evolve.js';
await initPhysics();
const osc = (phaseSrc) => ({ fn: 'oscWave', p: -0.2, inputs: [{ src: { t: 'k', v: 0 }, w: 0 }, { src: phaseSrc, w: 1 }] });
const g = {
  plan: { type: 'radial', n: 6 },
  nodes: [
    { shape: 'box', dims: [0.7, 0.25, 0.7], joint: 'rigid', limits: [[-1, 1], [-1, 1], [-1, 1]], recur: 1,
      neurons: [], effectors: [0, 1, 2].map(() => ({ src: { t: 'k', v: 0 }, w: 0 })),
      conns: [{ to: 1, face: 0, u: 0, v: 0, rot: [0, 0, -0.5], scale: 1, reflect: -1, terminal: false }] },
    { shape: 'capsule', dims: [0.36, 0.14, 0.14], joint: 'universal', limits: [[-0.6, 0.6], [-0.6, 0.6], [-0.6, 0.6]], recur: 5,
      // each segment's oscillator is shifted by its arm's position and its parent's output -> waves
      neurons: [osc({ t: 's', i: 15 })],
      effectors: [{ src: { t: 'k', v: 0 }, w: 0 }, { src: { t: 'n', i: 0 }, w: 1 }, { src: { t: 'p', i: 0 }, w: 0.6 }],
      conns: [{ to: 1, face: 0, u: 0, v: 0, rot: [0, 0, 0], scale: 0.85, reflect: -1, terminal: false }] },
  ],
  globals: [],
};
const { parts } = develop(g);
console.log('parts', parts.length, 'shapes', [...new Set(parts.map(p => p.shape))].join(','), 'viable', viable(g));
for (const task of ['swim', 'walk']) {
  const sim = new Sim(task, [g]);
  const c = sim.creatures[0];
  const g0 = task === 'walk' ? 9.81 : 0;
  const E0 = c.energy(g0);
  let worst = -Infinity;
  while (!sim.done) { sim.step(); worst = Math.max(worst, c.energy(g0) - E0 - c.work); }
  console.log(task, 'fitness', sim.fitness()[0].toFixed(3), 'failed', sim.failed[0], 'excess energy', worst.toFixed(3));
  sim.free();
}
writeFileSync('examples/tentacles.json', JSON.stringify({ task: 'swim', label: 'hand-built tentacles (radial ×6)', genome: g }));
