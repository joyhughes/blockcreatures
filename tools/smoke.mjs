import { initPhysics, evaluate, TASKS } from '../src/sim.js';
import { randomGenome, develop, interpenetrates } from '../src/genome.js';
import { makeRng } from '../src/math.js';
await initPhysics();
const rng = makeRng(7);
let valid = 0, parts = 0;
const gs = [];
for (let i = 0; i < 200; i++) {
  const g = randomGenome(rng); const ph = develop(g);
  const ok = !interpenetrates(ph.parts);
  if (ok) { valid++; gs.push(g); } parts += ph.parts.length;
}
console.log('valid', valid, '/200 avg parts', parts / 200);
for (const task of Object.keys(TASKS)) {
  const t0 = performance.now(); const f = [];
  const n = TASKS[task].pair ? 10 : 20;
  for (let i = 0; i < n; i++) f.push(TASKS[task].pair ? evaluate(task, [gs[i], gs[i + 1]])[0] : evaluate(task, [gs[i]])[0]);
  const ms = (performance.now() - t0) / n;
  f.sort((a, b) => b - a);
  console.log(task, ms.toFixed(1) + 'ms/eval', 'top', f.slice(0, 5).map(x => x.toFixed(3)).join(' '), 'zeros', f.filter(x => x === 0).length);
}
