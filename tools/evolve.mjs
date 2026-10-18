// Headless evolution: node tools/evolve.mjs <task> [generations] [popSize] [seed] [plan] [round]
//   plan: free | bilateral | radialN (e.g. radial5) | snake | quadruped | insect | arachnid | crustacean | centipede | biped | centaur | ducktopus;
//   round: round = allow capsules/spheres
// Env: ISLANDS=K sub-populations (default 6; 1 = Sims' single population),
//      NOVELTY=w weight of body novelty in selection (default 0.3),
//      STRUCT=p share of mutants given a structural change (default 0.25),
//      MIGRATE=n generations between migrations (default 30, 0 = never),
//      MIN_ARM=k require an appendage at least k segments long,
//      SEED_FROM=<file with a .genome, or a run file> start from mutants of that creature (a run's best),
//      TRAINED=1 (biped, quadruped) start from the trained walker in starters/<plan>.json,
//        lightly mutated, so it can already stand and walk,
//      REQUIRE=role,role optional template parts every creature keeps (e.g. upperArm),
//      SCENE=<json> scene overrides (sim.js SCENE), LEGACY=1 the old cube scene,
//      TEAMS=2 competition between two species, each against the other's best
//      (team B's history goes in the run file as rivalHistory),
//      LAMARCK=0 don't keep learned weights (default: Hebbian weights are written back into genomes),
//      TEAM_B=<plan> two teams with team B in another body plan (implies TEAMS=2),
//      RESUME=<run file> continue that run (same arguments) up to [generations]:
//      from its saved population, or for files saved before populations
//      were, from mutants of its latest best. The file keeps its history.
// Writes the best genome of every generation to
// runs/<task>-<seed>[-plan][-round][-armK][-islK][-teams][-vs-planB][-seeded].json.
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { Pool } from '../src/pool.js';
import { Evolver, TRAINED_SEED } from '../src/evolve.js';
import { defaultScene } from '../src/sim.js';
import { makeRng } from '../src/math.js';

const [task = 'swim', gens = '30', pop = '300', seed = '1', planArg = 'free', roundArg = ''] = process.argv.slice(2);
const env = (k, d) => (process.env[k] === undefined ? d : +process.env[k]);
const minArm = env('MIN_ARM', 0), islands = env('ISLANDS', 6), novelty = env('NOVELTY', 0.3), structural = env('STRUCT', 0.25), migrate = env('MIGRATE', 30);
const parsePlan = a => { const r = /^radial(\d+)$/.exec(a); return r ? { type: 'radial', n: +r[1] } : { type: a }; };
const body = { plan: parsePlan(planArg), round: roundArg === 'round', minArm };
if (process.env.REQUIRE) body.require = process.env.REQUIRE.split(',');
const trained = !!env('TRAINED', 0);
if (trained) Object.assign(body, { trained: true, require: [...new Set([...(body.require || []), ...(JSON.parse(readFileSync(`starters/${planArg}.json`)).require || [])])] });
const planB = process.env.TEAM_B && process.env.TEAM_B !== planArg ? process.env.TEAM_B : '';
const teams = planB ? 2 : env('TEAMS', 1), lamarck = !!env('LAMARCK', 1);
// team B keeps the run's settings but its own plan's required parts and trained walker
const starter = p => { try { return JSON.parse(readFileSync(`starters/${p}.json`)); } catch { return null; } };
const bodyB = planB ? { ...body, plan: parsePlan(planB), require: undefined, trained: undefined } : null;
if (bodyB && trained && starter(planB)) Object.assign(bodyB, { trained: true, require: starter(planB).require || [] });
const tag = `${task}-${seed}${planArg !== 'free' ? '-' + planArg : ''}${body.round ? '-round' : ''}${minArm ? '-arm' + minArm : ''}${islands > 1 ? '-isl' + islands : ''}${novelty ? '-nov' + novelty : ''}${structural ? '-st' + structural : ''}${teams === 2 ? '-teams' : ''}${planB ? '-vs-' + planB : ''}${lamarck ? '' : '-nolam'}${process.env.SEED_FROM ? '-seeded' : ''}${trained ? '-trained' : ''}${JSON.parse(process.env.SCENE || '{}').gait && JSON.parse(process.env.SCENE).gait !== 'none' ? '-' + JSON.parse(process.env.SCENE).gait : ''}`;
const n = Math.max(1, cpus().length - 1);
const pool = new Pool(onMsg => {
  const w = new Worker(new URL('../src/worker.js', import.meta.url));
  w.on('message', onMsg);
  return job => w.postMessage(job);
}, n);
// SCENE='{"gap":3,"duration":15}' overrides scene parameters (sim.js SCENE); LEGACY=1 uses the old cube scene
// the target's default scene, as the app starts a run (its own ball and lifespan)
const scene = process.env.LEGACY ? null : { ...defaultScene(task), ...JSON.parse(process.env.SCENE || '{}') };
const ev = new Evolver({ task, popSize: +pop, seed: +seed, evaluate: jobs => pool.run(jobs), body, bodyB, islands, novelty, structural, migrate, scene, teams, lamarck });
// SEED_FROM=<file with a .genome> starts from mutants of that creature
const resume = process.env.RESUME && JSON.parse(readFileSync(process.env.RESUME));
if (resume) {
  const last = resume.history.at(-1);
  if (resume.pop) {
    ev.pop = resume.pop.map(p => ({ g: p.g, fit: null, id: ev.nextId++, founder: p.founder, isl: p.isl }));
    if (ev.rival && resume.rivalPop) ev.rival.pop = resume.rivalPop.map(p => ({ g: p.g, fit: null, id: ev.rival.nextId++, founder: p.founder, isl: p.isl }));
    else ev.rival?.seed();
  } else ev.seedFrom(last.genome);
  ev.history = resume.history;
  ev.gen = resume.history.length;
  ev.champ = last.genome;
  if (last.opponent) ev.opponent = last.opponent;
  if (resume.rivalHistory && ev.rival) { ev.rival.history = resume.rivalHistory; ev.rival.gen = ev.gen; ev.rival.champ = resume.rivalHistory.at(-1).genome; ev.rival.rng = makeRng(+seed * 7919 + ev.gen + 101); }
  ev.rng = makeRng(+seed * 7919 + ev.gen);
  console.log(`resuming at generation ${ev.gen} from ${resume.pop ? 'the saved population' : 'mutants of the latest best'}`);
} else if (trained) {
  ev.seedFrom(starter(planArg).genome, TRAINED_SEED);
  if (ev.rival && planB && bodyB.trained) ev.rival.seedFrom(starter(planB).genome, TRAINED_SEED);
}
else if (process.env.SEED_FROM) {
  // a creature file, or a run file: its best of any generation
  const f = JSON.parse(readFileSync(process.env.SEED_FROM));
  ev.seedFrom(f.genome || f.history.reduce((a, h) => (h.best > a.best ? h : a)).genome);
}
else ev.seed();
mkdirSync('runs', { recursive: true });
const t0 = Date.now();
for (let i = ev.gen; i < +gens; i++) {
  const h = await ev.step();
  const parts = h.genome.nodes.length;
  console.log(`gen ${h.gen} best ${h.best.toFixed(4)} mean ${h.mean.toFixed(4)} median ${h.median.toFixed(4)} nodes ${parts} founders ${h.founders} diversity ${h.diversity.toFixed(3)} spread ${h.islandSpread.toFixed(3)}${h.islands.length > 1 ? ' islands ' + h.islands.map(f => f.toFixed(2)).join(' ') : ''}${ev.rival ? ` | team B best ${h.rivalBest.toFixed(4)} mean ${h.rivalMean.toFixed(4)}` : ''} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  writeFileSync(process.env.RESUME || `runs/${tag}.json`, JSON.stringify({ task, seed: +seed, body, islands, novelty, structural, migrate, scene, teams, bodyB, lamarck, history: ev.history, rivalHistory: ev.rival?.history,
    pop: ev.pop.map(p => ({ g: p.g, isl: p.isl, founder: p.founder })), rivalPop: ev.rival?.pop.map(p => ({ g: p.g, isl: p.isl, founder: p.founder })) }));
}
process.exit(0);
