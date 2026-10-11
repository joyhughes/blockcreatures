// Check symmetric development: every part must have a counterpart under the
// plan's symmetry (mirror z -> -z, or rotation by 2pi/N about Y), with equal
// size and shape. Also reports how many random genomes are viable.
import { randomGenome, develop } from '../src/genome.js';
import { viable } from '../src/evolve.js';
import { makeRng } from '../src/math.js';
const rng = makeRng(11);
const plans = [{ type: 'bilateral' }, { type: 'radial', n: 3 }, { type: 'radial', n: 5 }, { type: 'radial', n: 8 }];
for (const plan of plans) for (const round of [false, true]) {
  let ok = 0, bad = 0, vi = 0, parts = 0;
  for (let t = 0; t < 400; t++) {
    const g = randomGenome(rng, { plan, round });
    const { parts: P, overflow } = develop(g);
    if (overflow) continue;
    if (viable(g)) { vi++; parts += P.length; }
    const map = plan.type === 'bilateral' ? c => [c[0], c[1], -c[2]] : (c => { const a = 2 * Math.PI / plan.n, co = Math.cos(a), si = Math.sin(a); return [co * c[0] + si * c[2], c[1], -si * c[0] + co * c[2]]; });
    const good = P.every(p => {
      const m = map(p.center);
      return P.some(q => q.node === p.node && q.shape === p.shape && Math.hypot(q.center[0] - m[0], q.center[1] - m[1], q.center[2] - m[2]) < 1e-6
        && q.half.every((h, k) => Math.abs(h - p.half[k]) < 1e-9));
    });
    good ? ok++ : bad++;
  }
  console.log(`${plan.type}${plan.n || ''} round=${round}: symmetric ${ok}/${ok + bad}, viable ${vi}/400, mean parts ${(parts / Math.max(1, vi)).toFixed(1)}`);
}
