// Re-evaluate every bundled champion; compare against a saved baseline.
// node tools/regress.mjs [save]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { initPhysics, evaluate, TASKS } from '../src/sim.js';
await initPhysics();
const out = {};
for (const t of Object.keys(TASKS)) {
  const c = JSON.parse(readFileSync(`champions/${t}.json`));
  out[t] = evaluate(t, c.opponent ? [c.genome, c.opponent] : [c.genome], { phase: c.phase })[0];
}
const file = 'runs/baseline.json';
if (process.argv[2] === 'save' || !existsSync(file)) writeFileSync(file, JSON.stringify(out));
const base = JSON.parse(readFileSync(file));
for (const t in out) console.log(t.padEnd(12), out[t].toFixed(6), out[t] === base[t] ? 'same' : `CHANGED (was ${base[t].toFixed(6)})`);
