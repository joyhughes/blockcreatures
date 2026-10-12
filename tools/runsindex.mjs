// Write runs/index.json, the listing behind the app's Runs menu, for a
// static host (GitHub Pages) where serve.py can't list the folder itself:
// node tools/runsindex.mjs. Run it before committing new or updated runs.
import { readdirSync, statSync, writeFileSync } from 'node:fs';

export const SKIP = new Set(['index.json', 'baseline.json']);   // baseline: tools/regress.mjs, not a run
const runs = readdirSync('runs')
  .filter(f => f.endsWith('.json') && !SKIP.has(f))
  .map(f => { const st = statSync('runs/' + f); return { file: f, mtime: st.mtimeMs / 1000, size: st.size }; })
  .sort((a, b) => b.mtime - a.mtime);
writeFileSync('runs/index.json', JSON.stringify(runs, null, 1) + '\n');
console.log(`runs/index.json: ${runs.length} runs`);
