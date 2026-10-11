// node tools/inspect.mjs runs/swim-1.json [gen]
import { readFileSync } from 'node:fs';
import { initPhysics, Sim } from '../src/sim.js';
await initPhysics();
const run = JSON.parse(readFileSync(process.argv[2]));
const h = run.history[process.argv[3] ? +process.argv[3] : run.history.length - 1];
const g = h.genome;
const sim = new Sim(run.task, h.opponent ? [g, h.opponent] : [g], { phase: h.phase });
const c = sim.creatures[0];
console.log('gen', h.gen, 'best', h.best, 'parts', c.parts.length, 'bodies', c.nb);
c.parts.forEach(p => console.log(' part', p.index, 'node', p.node, 'joint', p.joint, 'shape', p.shape, 'phase', p.phase, 'half', p.half.map(x => x.toFixed(2)).join(','), 'parent', p.parent));
for (const nd of g.nodes) console.log(' node neurons', nd.neurons.map(n => n.fn + '(' + n.p.toFixed(2) + ')').join(' '), 'eff', nd.effectors.map(e => e.src.t + (e.src.i ?? e.src.v?.toFixed(2)) + '*' + e.w.toFixed(2)).join(' '));
console.log(' globals', g.globals.map(n => n.fn).join(' '));
let flips = 0, prev = null, maxW = 0, maxV = 0, chat = 0, chatN = 0, prevRates = null;
const log = [];
while (!sim.done) {
  sim.step();
  const e = Array.from(c.brain.effOut);
  if (prev) e.forEach((x, i) => { if (Math.sign(x) !== Math.sign(prev[i])) flips++; });
  prev = e;
  const rates = c.joints.flatMap(j => j.dofs.map(k => j.rate[k]));
  if (prevRates) rates.forEach((r, i) => { chatN++; if (Math.abs(r) > 2 && Math.abs(prevRates[i]) > 2 && Math.sign(r) !== Math.sign(prevRates[i])) chat++; });
  prevRates = rates;
  for (let i = 0; i < c.nb; i++) { maxW = Math.max(maxW, Math.hypot(...c.bw[i])); maxV = Math.max(maxV, Math.hypot(...c.bv[i])); }
  if (sim.steps % 60 === 0) log.push(`t=${sim.t.toFixed(1)} com=${c.com().map(x => x.toFixed(2)).join(',')} eff=${e.map(x => x.toFixed(2)).join(',')}`);
}
console.log(log.join('\n'));
console.log('effector sign flips/s per effector', (flips / sim.t / Math.max(1, prev.length)).toFixed(1), 'maxW', maxW.toFixed(1), 'maxV', maxV.toFixed(2), 'chatter', (100 * chat / Math.max(1, chatN)).toFixed(1) + '%', 'fitness', sim.fitness());
