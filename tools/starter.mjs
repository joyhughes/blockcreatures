// Save a trained walker for TRAINED=1 runs and the app's Trained walker option:
//   node tools/starter.mjs <run file> [generation]
// takes that generation's best (default: the best of any generation), checks
// it replays at its logged score, and writes starters/<plan>.json with the
// parts every run started from it must keep (its arms and head).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initPhysics, evaluate, TASKS } from '../src/sim.js';

const [file, genArg] = process.argv.slice(2);
const r = JSON.parse(readFileSync(file));
const h = genArg === undefined ? r.history.reduce((a, x) => (x.best > a.best ? x : a)) : r.history[+genArg];
const plan = r.body.plan.type;
await initPhysics();
const fit = evaluate(r.task, [h.genome], { scene: r.scene })[0];
if (Math.abs(fit - h.best) > 1e-9) throw new Error(`replays at ${fit}, logged ${h.best}`);
const on = new Set(h.genome.nodes.filter(nd => nd.on !== false).map(nd => nd.role));
const require = ['upperArm', 'head'].filter(x => on.has(x));
mkdirSync('starters', { recursive: true });
writeFileSync(`starters/${plan}.json`, JSON.stringify({
  plan, about: `a ${plan} evolved for ${TASKS[r.task].label.toLowerCase()} (${fit.toFixed(2)}, generation ${h.gen})`,
  require, source: file.split('/').pop(), task: r.task, gen: h.gen, fitness: fit, scene: r.scene, genome: h.genome,
}));
console.log(`starters/${plan}.json: ${r.task} gen ${h.gen} fitness ${fit.toFixed(4)} keeps ${require.join(', ') || 'nothing'}`);
