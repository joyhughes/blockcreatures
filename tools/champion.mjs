// Pick a champion from a headless run and write champions/<task>.json.
// node tools/champion.mjs runs/<task>-<seed>.json
// For tasks whose conditions vary (following), the last 20 generations' bests
// are re-scored over several light placements and the most robust is kept.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { initPhysics, evaluate, TASKS } from '../src/sim.js';
await initPhysics();
const run = JSON.parse(readFileSync(process.argv[2]));
const H = run.history, task = run.task, kind = TASKS[task].kind;
let pick = H[H.length - 1], score = pick.best;
if (kind === 'follow') {
  score = -Infinity;
  for (const h of H.slice(-20)) {
    const phases = [0, 0.7, 1.4, 2.1];
    const s = phases.reduce((a, ph) => a + evaluate(task, [h.genome], { phase: ph })[0], 0) / phases.length;
    if (s > score) { score = s; pick = { ...h, phase: 0 }; }
  }
} else if (kind !== 'compete') {
  for (const h of H) if (h.best > score) { score = h.best; pick = h; }
}
const fit = pick.opponent ? evaluate(task, [pick.genome, pick.opponent], { phase: pick.phase })[0] : evaluate(task, [pick.genome], { phase: pick.phase })[0];
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
  genome: pick.genome, opponent: pick.opponent || null, label,
}));
if (tag) {
  const idx = existsSync('examples/index.json') ? JSON.parse(readFileSync('examples/index.json')) : [];
  const entry = { file: '../' + file, label };
  const i = idx.findIndex(e => e.file === entry.file);
  if (i >= 0) idx[i] = entry; else idx.push(entry);
  writeFileSync('examples/index.json', JSON.stringify(idx, null, 1));
}
console.log(file, 'gen', pick.gen, 'fitness', fit.toFixed(3), kind === 'follow' ? `(mean over 4 light placements ${score.toFixed(3)})` : '');
