// Genetic algorithm after Sims: a population of genotypes, the best fifth
// survive each generation and reproduce in proportion to their fitness, by
// mutation (40%), crossover (30%) or grafting (30%).
//
// Beyond Sims: the population can be split into islands that select and mate
// separately, with each island's best migrating to the next one every few
// generations. In a single population one lineage took over within about 25
// generations (300 founders -> 12 by gen 3, 1 by gen 27), so the first body
// that worked was the only one evolution ever refined. Islands alone weren't
// enough: migrants took over each island they reached, until all were alike.
//
// So there is also novelty pressure: each body is placed in a descriptor
// space (size, arm length, extents, shapes, joints, ...), and its novelty is
// its mean distance to the 10 nearest bodies in the whole population (all
// islands) and an archive of past novel bodies. Selection ranks creatures by a
// blend of fitness rank and novelty rank, while each island's two fittest
// always survive. And a share of mutants get one structural change (a new
// limb, a duplicated segment, a chain, a moved attachment, ...), where plain
// mutation is almost all parameter tweaks.

import { TEMPLATES, randomGenome, mutate, structural, descriptor, crossover, graft, clone, develop, interpenetrates, tooBig, armLength, growArm, JOINT_DOFS } from './genome.js';
import { makeRng } from './math.js';
import { TASKS } from './sim.js';

// minArm: required length of the longest appendage, in segments (0 = any)
export function viable(g, minArm = 0) {
  if (!g.nodes.length) return false;
  const { parts, overflow } = develop(g);
  if (parts.length < 2 || (overflow && g.plan)) return false;
  if (minArm && armLength(parts) < minArm) return false;
  if (!parts.some(p => p.parent >= 0 && JOINT_DOFS[p.joint]?.length)) return false;
  return !tooBig(parts) && !interpenetrates(parts);
}

export class Evolver {
  // evaluate(jobs) -> Promise<number[][]>, one fitness array per job
  // body: { plan: {type: 'free'|'bilateral'|'radial', n}, round: bool, minArm: segments }
  // islands: number of sub-populations; migrate: generations between migrations
  // novelty: 0..1 weight of novelty rank in selection; structural: share of
  // mutants given a structural change; migrate: 0 = never. All 0 with
  // islands 1 is Sims' scheme, and reproduces earlier runs exactly.
  // teams (competition): 1 = one population playing its own previous best;
  // 2 = two species that never interbreed, each scored against the other's
  // best of the previous generation (Sims' interspecies competition). Team B
  // is a second Evolver in `rival`; this one is team A. bodyB: team B's body
  // (its own plan, so snakes can play insects); null = the same as team A's.
  constructor({ task, popSize = 300, survival = 0.2, seed = 1, evaluate, body = {}, bodyB = null, islands = 1, migrate = 10, novelty = 0, structural = 0, scene = null, teams = 1 }) {
    this.body = body;
    this.scene = scene;   // sim scene parameters (sim.js SCENE); null = the legacy scene
    this.islands = Math.max(1, Math.min(islands, Math.floor(popSize / 10)));
    this.migrate = migrate;
    this.novelty = novelty;
    this.structural = structural;
    this.archive = [];      // descriptors of past novel bodies
    this.task = task;
    this.popSize = popSize;
    this.survival = survival;
    this.rng = makeRng(seed);
    this.evaluate = evaluate;
    this.gen = 0;
    this.pop = [];          // {g, fit, id}
    this.history = [];      // per generation: {gen, best, mean, median, bestGenome}
    this.nextId = 1;
    this.opponent = null;   // competition and cooperation: best of the previous generation
    this.champ = null;      // this population's best of the latest generation
    this.teams = teams === 2 && TASKS[task].pair ? 2 : 1;
    this.rival = this.teams === 2 ? new Evolver({ task, popSize, survival, seed: seed * 7919 + 101, evaluate, body: bodyB || body, islands, migrate, novelty, structural, scene }) : null;
    if (this.rival) this.rival.team = 1;
  }

  // A run evolves within one body plan: every genome must carry the run's plan
  // (free = no plan), so mutation, crossover and grafting never cross plans.
  inPlan(g) {
    const want = this.body.plan && this.body.plan.type !== 'free' ? this.body.plan : null;
    if (!want) return !g.plan || g.plan.type === 'free';
    return !!g.plan && g.plan.type === want.type && (g.plan.n || 0) === (want.n || 0);
  }
  checkPlan(g) {
    if (!this.inPlan(g)) throw new Error(`genome plan ${JSON.stringify(g.plan || { type: 'free' })} is not this run's plan ${JSON.stringify(this.body.plan)}`);
    return g;
  }

  ok(g) { return this.inPlan(g) && viable(g, this.body.minArm || 0); }

  // With a required arm length, random genomes rarely have one, so an arm is
  // grown onto those that don't.
  withArm(g) {
    const k = this.body.minArm;
    if (k && !TEMPLATES[g.plan?.type] && armLength(develop(g).parts) < k) growArm(g, this.rng, k + this.rng.int(3), this.body);
    return g;
  }

  randomViable() {
    for (let i = 0; i < 2000; i++) {
      const g = this.withArm(randomGenome(this.rng, this.body));
      if (this.ok(g)) return g;
    }
    throw new Error('could not make a viable random genome');
  }

  islandSizes() {
    const K = this.islands, base = Math.floor(this.popSize / K);
    return Array.from({ length: K }, (_, i) => base + (i < this.popSize % K ? 1 : 0));
  }
  // round robin, so a population sorted by fitness is spread evenly
  assignIslands() { this.pop.forEach((p, j) => { p.isl = j % this.islands; }); }

  seed(genomes = []) {
    this.pop = genomes.slice(0, this.popSize).map(g => ({ g: clone(this.checkPlan(g)), fit: null, id: this.nextId++ }));
    while (this.pop.length < this.popSize) this.pop.push({ g: this.randomViable(), fit: null, id: this.nextId++ });
    for (const p of this.pop) p.founder = p.id;   // generation-0 ancestor, for diversity statistics
    this.assignIslands();
    this.rival?.seed();
  }

  // Population of the given genome plus mutants of it.
  seedFrom(g) {
    this.checkPlan(g);
    this.pop = this.ok(g) ? [{ g: clone(g), fit: null, id: this.nextId++ }] : [];
    while (this.pop.length < this.popSize) {
      let m = null;
      for (let i = 0; i < 20 && !m; i++) { const c = this.withArm(mutate(clone(g), this.rng, 3, this.body)); if (this.ok(c)) m = c; }
      this.pop.push({ g: m || this.randomViable(), fit: null, id: this.nextId++ });
    }
    for (const p of this.pop) p.founder = p.id;
    this.assignIslands();
    // team B of another plan can't descend from team A's creature
    if (this.rival) this.rival.inPlan(g) ? this.rival.seedFrom(g) : this.rival.seed();
  }

  // Run one generation: evaluate, record, select, reproduce. With two teams,
  // both run a generation, each against the other's previous best; the
  // history entry is team A's, with team B's results as rival*.
  async step() {
    const r = this.rival;
    if (!r) return this.stepOne();
    for (const k of ['scene', 'novelty', 'structural', 'migrate']) r[k] = this[k];
    if (this.rescore) r.rescore = true;
    if (!r.pop.length) r.seed();
    const a = this.champ || this.pop[this.rng.int(this.pop.length)].g;
    const b = r.champ || r.pop[r.rng.int(r.pop.length)].g;
    this.opponent = clone(b); r.opponent = clone(a);
    const [ha, hb] = await Promise.all([this.stepOne(), r.stepOne()]);
    return Object.assign(ha, { rivalBest: hb.best, rivalMean: hb.mean, rivalGenome: hb.genome, rivalOpponent: hb.opponent });
  }

  async stepOne() {
    const task = TASKS[this.task];
    const rng = this.rng;
    // the scene changed (main.js): scores from the old one don't carry over
    if (this.rescore) { this.rescore = false; for (const p of this.pop) p.fit = null; }
    // tasks whose conditions change between generations get re-evaluated
    const varying = task.kind === 'follow' || !!task.pair;
    const phase = task.kind === 'follow' ? rng() * 2 * Math.PI : 0;
    const todo = this.pop.filter(p => varying || p.fit === null);
    if (task.pair && !this.opponent) this.opponent = this.pop[rng.int(this.pop.length)].g;
    const jobs = todo.map(p => ({
      task: this.task,
      genomes: task.pair ? [p.g, this.opponent] : [p.g],
      opts: { phase, scene: this.scene },
    }));
    const res = await this.evaluate(jobs);
    todo.forEach((p, i) => { p.fit = res[i][0]; });

    this.pop.sort((a, b) => b.fit - a.fit);
    const div = this.measureNovelty();
    const fits = this.pop.map(p => p.fit);
    const best = this.pop[0];
    this.history.push({
      gen: this.gen, best: best.fit,
      mean: fits.reduce((a, b) => a + b, 0) / fits.length,
      median: fits[fits.length >> 1],
      genome: clone(best.g), id: best.id, phase, scene: this.scene,
      // diversity: distinct generation-0 ancestors (first parent) in the population
      founders: new Set(this.pop.map(p => p.founder)).size,
      diversity: div.within, islandSpread: div.between,
      opponent: task.pair ? clone(this.opponent) : null,
    });
    this.champ = clone(best.g);
    if (task.pair && !this.rival && !this.team) this.opponent = clone(best.g);

    // selection and reproduction, separately on each island
    const sizes = this.islandSizes();
    if (this.pop.some(p => p.isl === undefined || p.isl >= sizes.length)) this.assignIslands();   // loaded or resized runs
    const next = [], islandBest = [];
    sizes.forEach((size, k) => {
      const members = this.pop.filter(p => p.isl === k);   // already sorted by fitness
      islandBest.push(members[0]);
      next.push(...this.reproduce(members, size, k));
    });
    // migration: each island's best replaces the newest child on the next island
    if (sizes.length > 1 && this.migrate > 0 && (this.gen + 1) % this.migrate === 0) {
      islandBest.forEach((b, k) => {
        const to = (k + 1) % sizes.length;
        const i = next.findLastIndex(p => p.isl === to);
        next[i] = { g: clone(b.g), fit: varying ? null : b.fit, id: this.nextId++, founder: b.founder, isl: to };
      });
    }
    // per island: best fitness and genome, for the island chart and side-by-side replays
    Object.assign(this.history[this.history.length - 1], {
      islands: islandBest.map(b => b.fit),
      islandGenomes: sizes.length > 1 ? islandBest.map(b => clone(b.g)) : undefined,
    });
    // the evaluated generation, best first, for showing the whole population
    this.lastPop = { gen: this.gen, phase, scene: this.scene, opponent: this.history[this.history.length - 1].opponent,   // the one they faced
      members: this.pop.map(p => ({ g: p.g, fit: p.fit, isl: p.isl })) };
    this.pop = next;
    this.gen++;
    return this.history[this.history.length - 1];
  }

  // Best creature of each island in the current population (survivors are
  // stored first on each island, best first).
  islandBests() {
    return Array.from({ length: this.islands }, (_, k) => this.pop.find(p => p.isl === k)).filter(Boolean);
  }

  // Mate the islands' best creatures with each other: every ordered pair, by
  // crossover and by grafting (the first parent gives the root and most of
  // the body). Each hybrid is scored under the conditions of the latest
  // generation, and the best ones join the islands: two per island, replacing
  // its newest children, so selection decides whether they last.
  // -> [{g, fit, a, b, op}] best first
  async mateIslands() {
    const rng = this.rng, task = TASKS[this.task];
    const bests = this.islandBests();
    const kids = [];
    for (const a of bests) for (const b of bests) {
      if (a === b) continue;
      for (const op of ['crossover', 'graft']) {
        for (let tries = 0; tries < 6; tries++) {
          const g = op === 'crossover' ? crossover(a.g, b.g, rng) : graft(a.g, b.g, rng);
          if (this.ok(g)) { kids.push({ g, a: a.isl, b: b.isl, op, founder: a.founder }); break; }
        }
      }
    }
    if (!kids.length) return [];
    const last = this.history[this.history.length - 1];
    const phase = last?.phase || 0;
    const res = await this.evaluate(kids.map(k => ({
      task: this.task, genomes: task.pair ? [k.g, last?.opponent || this.opponent] : [k.g], opts: { phase, scene: this.scene },
    })));
    kids.forEach((k, i) => { k.fit = res[i][0]; });
    if (this.rival) await this.rival.mateIslands();
    kids.sort((x, y) => y.fit - x.fit);
    const varying = task.kind === 'follow' || !!task.pair;
    const placed = new Set();
    kids.slice(0, 2 * this.islands).forEach((k, i) => {
      const isl = i % this.islands;
      const j = this.pop.findLastIndex((p, idx) => p.isl === isl && !placed.has(idx));
      placed.add(j);
      this.pop[j] = { g: clone(k.g), fit: varying ? null : k.fit, id: this.nextId++, founder: k.founder, isl };
    });
    return kids;
  }

  // Body descriptors, novelty of each creature (p.nov), and diversity: mean
  // descriptor distance between creatures, and between island centroids.
  measureNovelty() {
    const D = this.pop.map(p => (p.desc ??= descriptor(develop(p.g).parts)));
    const dist = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2; return Math.sqrt(s); };
    let within = 0, pairs = 0;
    for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) { within += dist(D[i], D[j]); pairs++; }
    const cents = [];
    for (let k = 0; k < this.islands; k++) {
      const m = D.filter((_, i) => this.pop[i].isl === k);
      if (m.length) cents.push(m[0].map((_, d) => m.reduce((a, x) => a + x[d], 0) / m.length));
    }
    let between = 0, bp = 0;
    for (let i = 0; i < cents.length; i++) for (let j = i + 1; j < cents.length; j++) { between += dist(cents[i], cents[j]); bp++; }
    if (this.novelty > 0) {
      const ref = D.concat(this.archive), K = 10;
      this.pop.forEach((p, i) => {
        const ds = ref.map((r, j) => (j === i ? Infinity : dist(D[i], r))).sort((a, b) => a - b);
        p.nov = ds.slice(0, K).reduce((a, b) => a + b, 0) / K;
      });
      // remember the most novel body of each generation
      let mi = 0;
      this.pop.forEach((p, i) => { if (p.nov > this.pop[mi].nov) mi = i; });
      this.archive.push(D[mi]);
      if (this.archive.length > 500) this.archive.shift();
    }
    return { within: pairs ? within / pairs : 0, between: bp ? between / bp : 0 };
  }

  // Survivors and their reproduction weights. Plain: the fittest fifth,
  // weighted by fitness. With novelty: the two fittest, then the best by a
  // blend of fitness rank and novelty rank, weighted by that blend.
  select(members, size) {
    const nSurv = Math.min(members.length, Math.max(2, Math.round(size * this.survival)));
    if (!(this.novelty > 0)) {
      const surv = members.slice(0, nSurv);
      const best = surv[0], minF = Math.min(...surv.map(s => s.fit));
      return { surv, w: surv.map(s => s.fit - minF + 1e-3 + 0.05 * (best.fit - minF)) };
    }
    const m = members.length, rank = new Map();
    members.forEach((p, i) => rank.set(p, { f: m > 1 ? 1 - i / (m - 1) : 1 }));   // members are sorted by fitness
    [...members].sort((a, b) => b.nov - a.nov).forEach((p, i) => { rank.get(p).n = m > 1 ? 1 - i / (m - 1) : 1; });
    const score = p => (1 - this.novelty) * rank.get(p).f + this.novelty * rank.get(p).n;
    const elites = members.slice(0, Math.min(2, nSurv));
    const rest = members.slice(elites.length).sort((a, b) => score(b) - score(a)).slice(0, nSurv - elites.length);
    const surv = elites.concat(rest);
    return { surv, w: surv.map(p => score(p) + 0.05) };
  }

  // The next generation of one island: its best fifth survive, and offspring
  // are allotted in proportion to fitness.
  reproduce(members, size, isl) {
    const rng = this.rng;
    const { surv, w } = this.select(members, size);
    const wsum = w.reduce((a, b) => a + b, 0);
    const pick = () => {
      let r = rng() * wsum;
      for (let i = 0; i < surv.length; i++) { r -= w[i]; if (r <= 0) return surv[i]; }
      return surv[surv.length - 1];
    };
    const next = surv.map(s => ({ ...s, isl }));
    while (next.length < size) {
      const a = pick();
      let child = null;
      for (let tries = 0; tries < 20 && !child; tries++) {
        const r = rng();
        let g;
        if (r < 0.4) {
          if (this.structural > 0 && rng.chance(this.structural)) g = mutate(structural(clone(a.g), rng, this.body), rng, 0.75, this.body);
          else g = mutate(clone(a.g), rng, 1.5, this.body);
        } else {
          let b = pick();
          if (b === a && surv.length > 1) b = pick();
          g = r < 0.7 ? crossover(a.g, b.g, rng) : graft(a.g, b.g, rng);
          if (rng.chance(0.5)) mutate(g, rng, 0.75, this.body);   // reduced-rate mutation after mating
        }
        if (this.ok(g)) child = g;
      }
      // no viable offspring in 20 tries: an unchecked mutant (as before islands,
      // so single-population runs reproduce exactly), or with a required arm
      // length, a copy of the parent if the mutant lost its arm
      if (!child) {
        child = mutate(clone(a.g), rng, 1.5, this.body);
        if (this.body.minArm && !this.ok(child)) child = clone(a.g);
      }
      next.push({ g: child, fit: null, id: this.nextId++, founder: a.founder, isl });
    }
    return next;
  }
}
