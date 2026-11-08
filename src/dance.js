// Dancing: evolution by eye, after Sims' evolved images. A small troupe dances
// to whatever the microphone hears; the person watching picks the ones they
// like, and the next troupe is the picked dancers themselves plus their
// offspring: mutants of one, or (with two or more picked) crosses and grafts
// of two. There is no score. Every newcomer gets ears (genome.js wireAudio)
// unless a muscle already listens, so the troupe always reacts to the sound.

import { Evolver } from './evolve.js';
import { mutate, crossover, graft, structural, clone, hears, wireAudio, AUDIO_SRC } from './genome.js';

// how hard offspring differ from their parents (genome.js mutate amount)
export const DANCE_MUTATION = { gentle: 0.75, normal: 1.5, wild: 3 };

const withEars = fn => { AUDIO_SRC.on = true; try { return fn(); } finally { AUDIO_SRC.on = false; } };

export class Troupe {
  // body: as Evolver's (plan, round, minArm, require); size: dancers on the floor
  constructor({ body, size = 9, seed = 1 }) {
    this.size = size;
    // the Evolver only lends its viability checks, random genomes and seeding
    this.ev = new Evolver({ task: 'dance', popSize: size, seed, body, evaluate: async jobs => jobs.map(j => j.genomes.map(() => 0)) });
    this.rng = this.ev.rng;
    this.gens = [];   // each generation: { dancers: [genome], parents: [index into the generation before] }
  }

  get gen() { return this.gens.length - 1; }
  get dancers() { return this.gens[this.gen]?.dancers || []; }

  // a dancer with no muscle driven by the sound gets 2-4 new links to it (a
  // neuron reading it can easily be one whose output nothing much uses)
  ears(g) { return hears(g, true) ? g : wireAudio(g, this.rng, 2 + this.rng.int(3)); }

  // a first troupe: random bodies of the plan, or mutants of a starter genome
  // (a trained walker, which can stand: much better on its feet)
  start(starter = null, amount = 1.5) {
    withEars(() => {
      if (starter) this.ev.seedFrom(starter, { amount, copies: 1 });
      else this.ev.seed();
    });
    this.gens = [{ dancers: this.ev.pop.map(p => this.ears(clone(p.g))), parents: [] }];
  }

  // the next troupe from the dancers picked (indices into the current one)
  breed(picked, mutation = 'normal') {
    const amount = DANCE_MUTATION[mutation] ?? 1.5;
    const parents = picked.map(k => this.dancers[k]).filter(Boolean);
    if (!parents.length) return false;
    const rng = this.rng, ev = this.ev;
    const next = parents.map(g => clone(g));
    withEars(() => {
      while (next.length < this.size) {
        let child = null;
        for (let tries = 0; tries < 30 && !child; tries++) {
          const a = rng.pick(parents);
          let g;
          if (parents.length > 1 && rng.chance(0.5)) {
            let b = rng.pick(parents);
            while (b === a) b = rng.pick(parents);
            g = rng.chance(0.6) ? crossover(a, b, rng) : graft(a, b, rng);
            mutate(g, rng, amount / 2, ev.body);
          } else if (rng.chance(0.2)) g = mutate(structural(clone(a), rng, ev.body), rng, amount / 2, ev.body);
          else g = mutate(clone(a), rng, amount, ev.body);
          g = ev.withArm(g);
          if (ev.ok(g)) child = g;
        }
        next.push(this.ears(child || mutate(clone(rng.pick(parents)), rng, amount, ev.body)));
      }
    });
    this.gens.push({ dancers: next, parents: picked.slice() });
    return true;
  }

  // the troupe before this one (the picks are lost)
  back() {
    if (this.gens.length < 2) return false;
    this.gens.pop();
    return true;
  }

  toJSON() { return { size: this.size, gens: this.gens }; }
  load(d) { this.size = d.size; this.gens = d.gens; }
}
