// How a skateboarder scores: replay a run's best (or a creature file) and
// report the board's and the body's travel, time rolling with nothing on
// the ground, pushes (a part touching the ground while a foot is on the
// board), which parts touched the deck and the ground, and the ride's end.
// node tools/skaterun.mjs <run or creature file> [gen]
import { readFileSync } from 'node:fs';
import { initPhysics, Sim, evaluate } from '../src/sim.js';
await initPhysics();
const d = JSON.parse(readFileSync(process.argv[2]));
const h = d.history ? d.history[process.argv[3] !== undefined ? +process.argv[3] : d.history.length - 1] : d;
const task = d.task, scene = h.scene ?? d.scene;
const sim = new Sim(task, [h.genome], { phase: h.phase ?? 0, scene });
const c = sim.creatures[0], role = k => c.genome.nodes[c.parts[k].node].role || `part${k}`;
let pushes = 0, pushing = false, both = 0, deckParts = new Set(), groundParts = new Set(), b0 = null, c0 = null;
while (!sim.done) {
  sim.step();
  if (sim.settling) continue;
  const b = sim.cube.translation();
  b0 ??= [b.x, b.z]; c0 ??= [c.com()[0], c.com()[2]];
  const on = sim.onBoard(c);
  on.forEach(k => deckParts.add(role(k)));
  const ground = c.parts.map((p, k) => (c.onGround[k] && !on.has(k) ? k : -1)).filter(k => k >= 0);
  ground.forEach(k => groundParts.add(role(k)));
  const push = on.size > 0 && ground.length > 0;
  if (push) both += 1 / 60;
  if (push && !pushing) pushes++;
  pushing = push;
}
const tr = sim.track[0], b = sim.cube.translation();
console.log('logged', h.fitness?.toFixed(3), 'replayed', sim.fitness()[0].toFixed(3), 'evaluate', evaluate(task, [h.genome], { phase: h.phase ?? 0, scene })[0].toFixed(3), sim.failed[0] ? 'AUDIT FAIL' : '');
console.log('end', tr.off ? 'stepped off' : tr.fell !== undefined ? `fell at ${(tr.fell - sim.tStart).toFixed(1)}s` : 'rode to the end', '| board moved', Math.hypot(b.x - b0[0], b.z - b0[1]).toFixed(2), 'm | body moved', Math.hypot(c.com()[0] - c0[0], c.com()[2] - c0[1]).toFixed(2), 'm | counted', tr.start && tr.last ? ((tr.last[0] - tr.start[0]) * tr.fwd[0] + (tr.last[2] - tr.start[2]) * tr.fwd[2]).toFixed(2) : 0, 'm');
console.log('rolling (nothing on the ground)', (tr.rolled || 0).toFixed(1), 's | pushing (deck + ground)', both.toFixed(1), 's in', pushes, 'pushes');
console.log('on the deck:', [...deckParts].join(' ') || '-', '| on the ground:', [...groundParts].join(' ') || '-', '| parts', c.parts.length, 'mass', c.totalMass.toFixed(3), 'board', sim.board.body.mass().toFixed(3));
