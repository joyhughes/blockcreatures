// Do dancers react to sound? Each dancer of a troupe dances 6 s in silence
// and 6 s to a synthetic 120 bpm beat (genome.js NAUD channels); reports how
// far its joint angles differ between the two (rad, mean over joints and
// time), whether it is still up (COM height kept), and audit failures.
// Then breeds a few generations from random picks to check offspring.
// PLAN=biped|quadruped|insect|... TRAINED=1 (start from the plan's starter)
// node tools/dancetest.mjs
import { readFileSync } from 'node:fs';
import { initPhysics, Sim, AUDIO, DT } from '../src/sim.js';
import { Troupe } from '../src/dance.js';
import { hears } from '../src/genome.js';
await initPhysics();
const plan = process.env.PLAN || 'biped';
const starter = process.env.TRAINED ? JSON.parse(readFileSync(`starters/${plan}.json`)).genome : null;
const troupe = new Troupe({ body: { plan: { type: plan } }, size: 9, seed: +(process.env.SEED || 1) });
troupe.start(starter);

function beat(t) {
  const ph = (t * 2) % 1, kick = Math.exp(-ph / 0.08);
  AUDIO[0] = 0.4 + 0.5 * kick; AUDIO[1] = kick; AUDIO[2] = 0.3 + 0.2 * Math.sin(t * 3); AUDIO[3] = ((t * 4) % 1) < 0.1 ? 0.8 : 0.1; AUDIO[4] = Math.exp(-ph / 0.2);
}
function run(g, sound) {
  AUDIO.fill(0);
  const sim = new Sim('dance', [g], {});
  const c = sim.creatures[0];
  if (!c.valid) return null;
  const angles = [], ys = [];
  for (let k = 0; k < 7 / DT; k++) {
    if (sound && !sim.settling) beat(sim.t); else AUDIO.fill(0);
    sim.step();
    if (sim.settling) continue;
    angles.push(c.joints.flatMap(j => j.dofs.map(d => j.angle[d])));
    ys.push(c.com()[1]);
  }
  const r = { angles, y0: ys[0], y1: ys[ys.length - 1], failed: sim.failed[0] };
  sim.free();
  return r;
}
function report(gen) {
  console.log(`generation ${gen}`);
  troupe.dancers.forEach((g, k) => {
    const a = run(g, false), b = run(g, true);
    if (!a) return console.log(`  #${k + 1} invalid`);
    const per = a.angles[0].map((_, j) => a.angles.reduce((t, row, i) => t + Math.abs(row[j] - b.angles[i][j]), 0) / a.angles.length);
    const top = per.slice().sort((x, y) => y - x).slice(0, 3);
    console.log(`  #${k + 1} hears ${hears(g) ? 'yes' : 'NO '} · reacts ${(per.reduce((t, x) => t + x, 0) / per.length).toFixed(3)} rad mean, top joints ${top.map(x => x.toFixed(2)).join(' ')} · com ${b.y0.toFixed(2)} -> ${b.y1.toFixed(2)} m${a.failed || b.failed ? ' · AUDIT FAIL' : ''}`);
  });
}
report(0);
for (let gen = 1; gen <= 2; gen++) {
  troupe.breed([0, 1 + troupe.rng.int(8)], 'normal');
  report(gen);
}
