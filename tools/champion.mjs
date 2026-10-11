// Pick a champion from a headless run and write champions/<task>.json.
// node tools/champion.mjs runs/<task>-<seed>.json
// For tasks whose conditions vary (following), the last 20 generations' bests
// are re-scored over several light placements and the most robust is kept.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { initPhysics, evaluate, TASKS, Sim } from '../src/sim.js';
await initPhysics();
const run = JSON.parse(readFileSync(process.argv[2]));
const H = run.history, task = run.task, kind = TASKS[task].kind;
const scene = run.scene ?? null;   // null: the legacy scene (runs from before scenes)
let pick = H[H.length - 1], score = pick.best;
if (kind === 'follow') {
  // most robust of the last 20 generation bests: mean closing speed with the
  // light in 8 directions (3 trials each), disqualified if any of those runs
  // trips the energy audit (a body that breaks the joint solver somewhere)
  score = -Infinity;
  for (const h of H.slice(-20)) {
    let sum = 0, n = 0, broke = false;
    for (let k = 0; k < 8 && !broke; k++) for (let trial = 0; trial < TASKS[task].trials; trial++) {
      const sim = new Sim(task, [h.genome], { trial, phase: k * Math.PI / 4, scene });
      while (!sim.done) sim.step();
      if (sim.failed[0] && sim.creatures[0].valid) broke = true;
      sum += sim.fitness()[0]; n++;
      sim.free();
    }
    if (!broke && sum / n > score) { score = sum / n; pick = { ...h, phase: 0 }; }
  }
} else if (kind === 'compete') {
  // "all vs. best" scores only say how a creature did against the previous
  // best, so they hover near 1 in an arms race. Play the bests of every 10th
  // generation (and the last) against each other, both sides, and keep the
  // one with the best average; its opponent is the strongest of the rest
  // that it beats (or simply the strongest of the rest).
  const pool = H.filter((h, i) => i % 10 === 9 || i === H.length - 1);
  const m = pool.map(a => pool.map(b => (a === b ? 1 : evaluate(task, [a.genome, b.genome], { scene })[0])));
  const avg = m.map(row => (row.reduce((t, v) => t + v, 0) - 1) / (pool.length - 1));
  const order = avg.map((v, i) => i).sort((x, y) => avg[y] - avg[x]);
  const opp = order.slice(1).find(j => m[order[0]][j] > 1) ?? order[1];
  pick = { ...pool[order[0]], opponent: pool[opp].genome };
  score = avg[order[0]];
  console.log('round robin', pool.map((h, i) => `gen ${h.gen} ${avg[i].toFixed(2)}`).join(', '));
} else {
  for (const h of H) if (h.best > score) { score = h.best; pick = h; }
}
const fit = evaluate(task, pick.opponent ? [pick.genome, pick.opponent] : [pick.genome], { phase: pick.phase, scene })[0];
mkdirSync('champions', { recursive: true });
// plan-specific champions: champions/<task>[-<plan>][-round][-seeded].json,
// also listed under Examples in the app
const b = run.body || { plan: { type: 'free' } };
const planName = b.plan.type === 'radial' ? 'radial' + b.plan.n : b.plan.type;
const seeded = process.argv[2].includes('-seeded');
const tag = (planName === 'free' ? '' : '-' + planName) + (b.round ? '-round' : '') + (seeded ? '-seeded' : '');
const file = `champions/${task}${tag}.json`;
const label = `${TASKS[task].label} · ${planName === 'free' ? 'free' : b.plan.type + (b.plan.n ? ' ×' + b.plan.n : '')}${b.round ? ', round parts' : ''}${seeded ? ', from tentacles' : ''}`;
writeFileSync(file, JSON.stringify({
  task, generations: H.length, gen: pick.gen, fitness: fit, phase: pick.phase || 0,
  genome: pick.genome, opponent: pick.opponent || null, label, ...(scene ? { scene } : {}),
}));
if (tag) {
  const idx = existsSync('examples/index.json') ? JSON.parse(readFileSync('examples/index.json')) : [];
  const entry = { file: '../' + file, label };
  const i = idx.findIndex(e => e.file === entry.file);
  if (i >= 0) idx[i] = entry; else idx.push(entry);
  writeFileSync('examples/index.json', JSON.stringify(idx, null, 1));
}
console.log(file, 'gen', pick.gen, 'fitness', fit.toFixed(3), kind === 'follow' ? `(mean over 8 light directions x ${TASKS[task].trials} trials ${score.toFixed(3)})` : kind === 'compete' ? `(round-robin average ${score.toFixed(3)})` : '');
