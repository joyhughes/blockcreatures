// Headless evolution: node tools/evolve.mjs <task> [generations] [popSize] [seed] [plan] [round]
//   plan: free | bilateral | radialN (e.g. radial5); round: round = allow capsules/spheres
// Env: ISLANDS=K sub-populations (default 6; 1 = Sims' single population),
//      NOVELTY=w weight of body novelty in selection (default 0.3),
//      STRUCT=p share of mutants given a structural change (default 0.25),
//      MIGRATE=n generations between migrations (default 30, 0 = never),
//      MIN_ARM=k require an appendage at least k segments long,
//      SEED_FROM=<file with a .genome> start from mutants of that creature,
//      SCENE=<json> scene overrides (sim.js SCENE), LEGACY=1 the old cube scene.
// Writes the best genome of every generation to
// runs/<task>-<seed>[-plan][-round][-armK][-islK][-seeded].json.
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { Pool } from '../src/pool.js';
import { Evolver } from '../src/evolve.js';
import { SCENE } from '../src/sim.js';

const [task = 'swim', gens = '30', pop = '300', seed = '1', planArg = 'free', roundArg = ''] = process.argv.slice(2);
const m = /^radial(\d+)$/.exec(planArg);
const env = (k, d) => (process.env[k] === undefined ? d : +process.env[k]);
const minArm = env('MIN_ARM', 0), islands = env('ISLANDS', 6), novelty = env('NOVELTY', 0.3), structural = env('STRUCT', 0.25), migrate = env('MIGRATE', 30);
const body = { plan: m ? { type: 'radial', n: +m[1] } : { type: planArg }, round: roundArg === 'round', minArm };
const tag = `${task}-${seed}${planArg !== 'free' ? '-' + planArg : ''}${body.round ? '-round' : ''}${minArm ? '-arm' + minArm : ''}${islands > 1 ? '-isl' + islands : ''}${novelty ? '-nov' + novelty : ''}${structural ? '-st' + structural : ''}${process.env.SEED_FROM ? '-seeded' : ''}`;
const n = Math.max(1, cpus().length - 1);
const pool = new Pool(onMsg => {
  const w = new Worker(new URL('../src/worker.js', import.meta.url));
  w.on('message', onMsg);
  return job => w.postMessage(job);
}, n);
// SCENE='{"gap":3,"duration":15}' overrides scene parameters (sim.js SCENE); LEGACY=1 uses the old cube scene
const scene = process.env.LEGACY ? null : { ...SCENE, ...JSON.parse(process.env.SCENE || '{}') };
const ev = new Evolver({ task, popSize: +pop, seed: +seed, evaluate: jobs => pool.run(jobs), body, islands, novelty, structural, migrate, scene });
// SEED_FROM=<file with a .genome> starts from mutants of that creature
if (process.env.SEED_FROM) ev.seedFrom(JSON.parse(readFileSync(process.env.SEED_FROM)).genome);
else ev.seed();
mkdirSync('runs', { recursive: true });
const t0 = Date.now();
for (let i = 0; i < +gens; i++) {
  const h = await ev.step();
  const parts = h.genome.nodes.length;
  console.log(`gen ${h.gen} best ${h.best.toFixed(4)} mean ${h.mean.toFixed(4)} median ${h.median.toFixed(4)} nodes ${parts} founders ${h.founders} diversity ${h.diversity.toFixed(3)} spread ${h.islandSpread.toFixed(3)}${h.islands.length > 1 ? ' islands ' + h.islands.map(f => f.toFixed(2)).join(' ') : ''} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  writeFileSync(`runs/${tag}.json`, JSON.stringify({ task, seed: +seed, body, islands, novelty, structural, migrate, scene, history: ev.history }));
}
process.exit(0);
