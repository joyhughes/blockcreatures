// Simulate random symmetric creatures in water with the phase sensor unused:
// mirror/rotated twins should stay mirror/rotated images of each other.
import { initPhysics, Sim } from '../src/sim.js';
import { randomGenome } from '../src/genome.js';
import { viable } from '../src/evolve.js';
import { makeRng } from '../src/math.js';
await initPhysics();
const rng = makeRng(5);
for (const plan of [{ type: 'bilateral' }, { type: 'radial', n: 5 }]) {
  const errs = [];
  for (let t = 0; t < 12;) {
    const g = randomGenome(rng, { plan, round: true });
    if (!viable(g)) continue;
    t++;
    // strip any reference to sensor 15 so twins get identical brains
    const strip = inp => { if (inp.src.t === 's' && inp.src.i === 15) inp.src = { t: 'k', v: 0 }; };
    g.nodes.forEach(nd => { nd.effectors.forEach(strip); nd.neurons.forEach(n => n.inputs.forEach(strip)); });
    g.globals.forEach(n => n.inputs.forEach(strip));
    const sim = new Sim('swim', [g]);
    const c = sim.creatures[0];
    for (let s = 0; s < 180; s++) sim.step();
    const com = c.com();
    const map = plan.type === 'bilateral' ? p => [p[0], p[1], 2 * com[2] - p[2]] : null;
    let worst = 0;
    c.parts.forEach((p, i) => {
      if (!map || p.phase !== 1) return;
      const twin = c.parts.findIndex((q, j) => q.phase === -1 && q.node === p.node && Math.hypot(q.center[0] - p.center[0], q.center[1] - p.center[1], q.center[2] + p.center[2]) < 1e-6);
      const a = map(c.partPose(i).c), b = c.partPose(twin).c;
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    });
    // radial: compare the spread of distances of corresponding parts from the axis of the body
    if (!map) {
      const groups = {};
      c.parts.forEach((p, i) => { if (p.phase) { const key = p.node + ':' + Math.round(Math.hypot(p.center[0], p.center[2]) * 1e4) + ':' + Math.round(p.center[1] * 1e4); (groups[key] ||= []).push(i); } });
      for (const ids of Object.values(groups)) {
        const d = ids.map(i => { const pc = c.partPose(i).c; return Math.hypot(pc[0] - com[0], pc[1] - com[1], pc[2] - com[2]); });
        worst = Math.max(worst, Math.max(...d) - Math.min(...d));
      }
    }
    errs.push(worst);
    sim.free();
  }
  console.log(plan.type, 'max twin asymmetry after 3 s (m):', errs.map(e => e.toFixed(4)).join(' '));
}
