import { initPhysics, Sim, TASKS, DT, sceneFor, defaultScene } from './sim.js';
import { Evolver } from './evolve.js';
import { Pool } from './pool.js';
import { View } from './view.js';
import { makeRng } from './math.js';
import { Recorder } from './record.js';

const $ = id => document.getElementById(id);
const UNITS = { speed: 'm/s', jump: 'm high', follow: 'm/s closing', compete: 'score 0–2', cooperate: 'score 0–2', volley: 'passes', wrestle: 'score 0–2', climb: 'm climbed', lift: 'm lifted' };
const COLORS = ['#e8b04a', '#4fa3d9', '#d9534f', '#6cbf6a', '#b07ad9', '#e07a3f', '#4fc1b8', '#d96fa3', '#9aa64a', '#7a8cd9', '#c9a27a', '#5f9e8f'];

await initPhysics();
const view = new View($('view'));
const nWorkers = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
const pool = new Pool(onMsg => {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  w.onmessage = e => onMsg(e.data);
  return job => w.postMessage(job);
}, nWorkers);

let task = 'swim';
let evolver = null;
let running = false;
let selected = -1;            // generation shown, -1 = champion / none
let replay = null;            // {genome, opponent, phase, label, trial, task, cells?}
                              // cells: several creatures side by side, [{genome, opponent, label, color}]
const rtask = () => (replay && replay.task) || task;
let sim = null, sims = [], pauseUntil = 0;   // sim = sims[0], the one the HUD reports
let pendingGen = -1;          // newer generation waiting for the replay to finish

// ---------------------------------------------------------------- task buttons
for (const [key, t] of Object.entries(TASKS)) {
  const b = document.createElement('button');
  b.textContent = t.label;
  b.dataset.task = key;
  b.onclick = () => { if (!running) setTask(key); };
  $('tasks').append(b);
}

function setTask(key) {
  task = key;
  for (const b of $('tasks').children) b.classList.toggle('on', b.dataset.task === key);
  $('sUnit').textContent = 'best ' + UNITS[TASKS[key].kind];
  view.setEnv(TASKS[key].env);
  switchRun();
}

// ---------------------------------------------------------------- scene
// Each run has its own scene (sim.js SCENE): lifespan, gravity, the
// competition's prize and start distance... Changing it mid-run re-scores
// everyone from the next generation, and the creature on screen replays in
// the new scene straight away.
const SC_FIELDS = { duration: 'scDuration', gravity: 'scGravity', friction: 'scFriction', drag: 'scDrag', lightDist: 'scLightDist',
  ball: 'scBall', ballSize: 'scBallSize', ballMass: 'scBallMass', gap: 'scGap', zone: 'scZone', slope: 'scSlope', maxVolume: 'scMaxVolume',
  grip: 'scGrip', metric: 'scMetric', sameSize: 'scSameSize', apart: 'scApart', settle: 'scSettle', goalDist: 'scGoalDist', goalSize: 'scGoalSize', together: 'scTogether',
  stepHeight: 'scStepHeight', stepDepth: 'scStepDepth', steps: 'scSteps', ring: 'scRing' };
function readScene() {
  const s = {};
  for (const [k, id] of Object.entries(SC_FIELDS)) {
    const el = $(id);
    if (el.type === 'checkbox') s[k] = el.checked;
    else if (el.tagName === 'SELECT') s[k] = el.value;
    else s[k] = el.value === '' || !isFinite(+el.value) ? defaultScene(task)[k] : +el.value;
  }
  return s;
}
function writeScene(s) {
  const full = sceneFor(task, s);   // null: the legacy scene
  for (const [k, id] of Object.entries(SC_FIELDS)) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!full[k];
    else if (k === 'duration') el.value = s?.duration ?? '';
    else el.value = String(full[k]);
  }
  showScene();
}
function showScene() {
  const t = TASKS[task];
  $('scDuration').placeholder = String(t.duration);
  for (const el of document.querySelectorAll('[data-env]')) el.hidden = el.dataset.env !== t.env;
  for (const el of document.querySelectorAll('[data-kind]')) el.hidden = !el.dataset.kind.split(' ').includes(t.kind);
  const s = evolver?.scene;
  $('sceneNote').textContent = !s ? 'This run uses the original scene: timed settling with friction; in competition a 0.8 m cube 1.5 m away.'
    : evolver.sceneGen > 0 ? `Scene changed at generation ${evolver.sceneGen}; fitness before and after isn't comparable.` : '';
}
function sceneChanged() {
  evolver.scene = readScene();
  if (evolver.history.length) { evolver.rescore = true; evolver.sceneGen = evolver.gen; }
  showScene();
  if (replay) {
    // its recorded score was in another scene
    if (!replay.rescened) replay.label = replay.label.replace(', in the original cube scene', '') + ', in the scene set here';
    replay.rescened = true; replay.fitness = undefined;
    replay.scene = evolver.scene; restartSim();
  }
}
for (const id of Object.values(SC_FIELDS)) $(id).onchange = sceneChanged;
$('scReset').onclick = () => { writeScene(defaultScene(task)); sceneChanged(); };

// ---------------------------------------------------------------- body plan
let planType = 'free';
const PLAN_NOTES = {
  free: 'Sims\' original genotype: any shape, with optional per-connection reflection.',
  bilateral: 'Mirror-symmetric about the midplane. Attachments near the plane stay on it; others come in left/right pairs. Each side senses which side it is on (+1 / −1), so the two can move in antiphase.',
  radial: 'N-fold symmetric about the vertical axis. Parts on the axis become cylinders; other attachments are repeated around it. Each arm senses its position (2k/N), so the arms can beat in a travelling wave.',
};
function body() {
  const plan = planType === 'radial' ? { type: 'radial', n: +$('radialN').value } : { type: planType };
  return { plan, round: $('round').checked, minArm: +$('minArm').value };
}
function showPlan() {
  for (const b of $('plan').children) b.classList.toggle('on', b.dataset.plan === planType);
  $('nWrap').hidden = planType !== 'radial';
  $('planNote').textContent = PLAN_NOTES[planType] + ($('round').checked ? ' Round parts: genes may choose capsules or spheres; capsules lie along the attachment axis, so recursive chains taper into tentacles.' : '')
    + (+$('minArm').value ? ` Min arm: only creatures with an appendage of at least ${$('minArm').value} segments are viable.` : '');
}
for (const b of $('plan').children) b.onclick = () => { if (running) return; planType = b.dataset.plan; showPlan(); switchRun(); };
$('radialN').onchange = $('round').onchange = $('minArm').onchange = () => { if (running) return; showPlan(); switchRun(); };
const setBodyEnabled = on => { for (const el of [...$('plan').children, $('radialN'), $('round'), $('minArm'), $('islands'), $('teams')]) el.disabled = !on; };

// Each target and body plan (arm count and round-parts setting included) has
// its own run: evolution stays within the plan, and switching plans keeps the
// other plans' runs to come back to. So does Teams in competition and
// cooperation: one gene pool and two co-evolving teams are separate runs.
const runs = new Map();
const runKey = () => task + planTag() + (TASKS[task].pair && $('teams').value === '2' ? '-teams' : '');
function newRun() {
  running = false;
  $('go').textContent = 'Evolve';
  evolver = new Evolver({
    task, popSize: +$('pop').value, seed: +$('seed').value,
    evaluate: jobs => pool.run(jobs), body: body(), islands: +$('islands').value,
    novelty: +$('novelty').value, structural: +$('structural').value, migrate: +$('migrate').value,
    scene: readScene(), teams: +$('teams').value,
  });
  runs.set(runKey(), evolver);
  showScene();
  selected = -1; pendingGen = -1;
  $('gens').innerHTML = '';
  refresh();
}
function switchRun() {
  const r = runs.get(runKey());
  // a target's first run: the panel's scene, with the target's own ball
  if (!r) { writeScene({ ...readScene(), ...(TASKS[task].scene || {}) }); newRun(); loadChampion(); return; }
  evolver = r;
  $('pop').value = r.popSize;
  $('islands').value = String(r.islands);
  $('teams').value = String(r.teams);
  $('novelty').value = String(r.novelty); $('structural').value = String(r.structural); $('migrate').value = String(r.migrate);
  writeScene(r.scene);
  selected = -1; pendingGen = -1;
  $('gens').innerHTML = '';
  refresh();
  if (r.history.length) showGen(r.history.length - 1);
  else loadChampion();
}

// ---------------------------------------------------------------- evolution
let evalCount = 0, evalT0 = 0;
let loopDone = Promise.resolve();   // settles when the evolution loop has stopped
async function evolveLoop() {
  if (!evolver.pop.length) evolver.seed();
  evalT0 = performance.now(); evalCount = 0;
  while (running) {
    const before = evolver.pop.filter(p => p.fit === null).length;
    const varying = TASKS[task].kind === 'follow' || !!TASKS[task].pair;
    const h = await evolver.step();
    evalCount += (varying ? evolver.popSize * TASKS[task].trials : before) * evolver.teams;
    const secs = (performance.now() - evalT0) / 1000;
    $('sRate').textContent = (evalCount / secs).toFixed(0);
    // watching latest: switch once the current replay has played out
    if ($('follow').checked) {
      const g = $('show').value === 'ever' ? bestGen() : h.gen;
      // a champion or example on screen gives way at once, unless it's being
      // recorded: then the new generation waits for the clip to finish
      if (!replay || (replay.gen === undefined && !recorder.recording)) showGen(g, false);
      else pendingGen = g;
    }
    refresh();
  }
}

$('go').onclick = () => {
  running = !running;
  $('go').textContent = running ? 'Pause' : 'Evolve';
  for (const b of $('tasks').children) b.disabled = running;
  setBodyEnabled(!running);
  if (running) loopDone = evolveLoop();
};
$('reset').onclick = () => { if (running) $('go').click(); newRun(); loadChampion(); };
$('pop').onchange = $('seed').onchange = $('islands').onchange = () => { if (!running && evolver.gen === 0) newRun(); };
// the other Teams setting's run, or a new one in the current scene
$('teams').onchange = () => {
  if (running) return;
  if (runs.has(runKey())) return switchRun();
  newRun(); loadChampion();
};
// these can change during a run; they apply from the next generation
for (const id of ['novelty', 'structural', 'migrate']) $(id).onchange = () => { evolver[id] = +$(id).value; };

// ---------------------------------------------------------------- replay
function startReplay(r) {
  if (recorder.recording) stopRecording();   // a different creature ends the clip
  replay = r;
  replay.trial = 0;
  restartSim();
}

function restartSim() {
  for (const s of sims) s.free();
  sims = []; sim = null;
  view.clear();
  if (!replay) return;
  const cells = replay.cells || [{ genome: replay.genome, opponent: replay.opponent }];
  sims = cells.map(c => new Sim(rtask(), c.opponent ? [c.genome, c.opponent] : [c.genome], { trial: replay.trial, phase: replay.phase || 0, scene: replay.scene }));
  sim = sims[0];
  // settling isn't shown: the frame loop runs it unseen, then shows the
  // creatures as measuring starts
  settleLabels = replay.cells ? cells.map(c => ({ text: c.label, short: c.short, color: c.color })) : [];
  settled = false;
}
let settled = true, settleLabels = [];
// run settling for up to `ms`; once every sim is measuring, load the view
function settleSims(ms) {
  const t0 = performance.now();
  let busy = true;
  while (busy && performance.now() - t0 < ms) {
    busy = false;
    for (const s of sims) if (s.settling && !s.done) { s.step(); busy = true; }
  }
  if (busy) return;
  settled = true;
  view.load(sims, settleLabels);
  if (replay.focus >= 0) view.focus_(replay.focus, true);
  pauseUntil = performance.now() + 400;
}

$('restart').onclick = () => { if (replay) { replay.trial = 0; restartSim(); } };

// ---------------------------------------------------------------- video
// Record restarts the replay and captures every trial of it, then saves the
// clip; clicking again stops early. Playback speed applies to the clip too.
const recorder = new Recorder($('view'));
if (!Recorder.supported()) { $('record').disabled = true; $('record').title = 'This browser cannot record video'; }
$('record').onclick = () => {
  if (recorder.recording) return stopRecording();
  if (!replay) return;
  replay.trial = 0;
  restartSim();
  recorder.start();
  recName = clipName();
  $('record').classList.add('rec');
};
let recName = 'creature';
function clipName() {
  const g = replay.genome, p = g.plan;
  const plan = !p || p.type === 'free' ? 'free' : p.type + (p.n || '');
  const round = g.nodes.some(nd => nd.shape && nd.shape !== 'box') ? '-round' : '';
  const what = replay.gen !== undefined ? 'gen' + replay.gen : (replay.label.match(/^\w+/) || ['creature'])[0];
  return `${rtask()}-${plan}${round}-${what}`;
}
async function stopRecording() {
  $('record').classList.remove('rec');
  $('record').textContent = '● Record';
  const blob = await recorder.stop();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${recName}.${recorder.ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// generation with the highest best score of the run (for Show: Best so far).
// In following and competition everyone is re-scored each generation under
// new conditions, so a generation's best can score below an earlier one.
function bestGen() {
  const H = evolver.history;
  let g = 0;
  H.forEach((h, k) => { if (h.best > H[g].best) g = k; });
  return g;
}
// which island holds a generation's best
const topIsland = h => (h.islands && h.islands.length > 1 ? h.islands.indexOf(Math.max(...h.islands)) : -1);

// What a generation's replay shows, by the Show menu: its best (or the run's
// best so far), each island's best side by side, or (latest generation only)
// the top 25 or everyone.
function showGen(gen, user = true) {
  const h = evolver.history[gen];
  if (!h) return;
  if (!user && replay && replay.gen === gen && replay.show === $('show').value) return;
  selected = gen;
  if (user) $('follow').checked = gen === evolver.history.length - 1;
  const mode = $('show').value;
  const ti = topIsland(h);
  const r = { genome: h.genome, opponent: h.opponent, phase: h.phase, scene: h.scene, gen, show: mode, fitness: h.best,
    label: (mode === 'ever' ? `best so far: generation ${gen}` : `generation ${gen} best`) + (ti >= 0 ? ` (island ${ti + 1})` : '') };
  // two teams: the creature shown is team A's, facing team B's previous best
  const vs = ['compete', 'wrestle'].includes(TASKS[task].kind) ? 'against' : 'with';
  if (h.rivalGenome) {
    r.label = r.label.replace(/best/, 'team A best') + `, ${vs} team B's best of generation ${gen - 1}`;
    if (gen === 0) r.label = r.label.replace(/team B's best of generation -1/, 'a random team B creature');
  }
  if (mode === 'rival' && h.rivalGenome) Object.assign(r, { genome: h.rivalGenome, opponent: h.rivalOpponent, fitness: h.rivalBest,
    label: `generation ${gen} team B best, ${vs} ` + (gen ? `team A's best of generation ${gen - 1}` : 'a random team A creature') });
  const lp = evolver.lastPop;
  if ((mode === 'top' || mode === 'all') && lp && lp.gen === gen) {
    const m = mode === 'top' ? lp.members.slice(0, 25) : lp.members;
    r.cells = m.map((p, i) => ({ genome: p.g, opponent: lp.opponent, label: `#${i + 1}${evolver.islands > 1 ? ' · island ' + (p.isl + 1) : ''} · ${p.fit.toFixed(3)}`, short: p.fit.toFixed(3), color: COLORS[(p.isl || 0) % COLORS.length] }));
    r.phase = lp.phase; r.scene = lp.scene;
    r.label = mode === 'top' ? `generation ${gen}, top ${m.length}` : `generation ${gen}, all ${m.length} creatures`;
  } else if (mode !== 'best' && mode !== 'ever' && mode !== 'rival' && h.islandGenomes) {
    r.cells = h.islandGenomes.map((g, k) => ({ genome: g, opponent: h.opponent, label: `island ${k + 1} · ${h.islands[k].toFixed(3)}`, color: COLORS[k % COLORS.length] }));
    r.label = `generation ${gen}, best of each island` + (mode !== 'islands' ? ' (the whole population is kept only for the latest generation)' : '');
  }
  if (r.cells) r.fitness = undefined;
  startReplay(r);
  drawGraph(r.genome);
  markGens();
  drawIslands();
}
$('labels').onchange = () => view.setLabels($('labels').checked);

// Clicking a creature in a crowd zooms in on it and makes it the creature on
// screen (genotype graph, Evolve from this, Record); clicking empty space or
// Esc zooms back out.
function pick(k) {
  if (!replay?.cells) return;
  replay.focus = k;
  const cell = replay.cells[k] || replay.cells[0];
  replay.genome = cell.genome;
  drawGraph(cell.genome);
}
view.onPick = pick;
addEventListener('keydown', e => {
  if (e.key === 'Escape' && replay?.focus >= 0) { view.focus_(-1); pick(-1); }
});
$('show').onchange = () => {
  const latest = evolver.history.length - 1;
  if (latest < 0) return;
  // the whole population is kept only for the latest generation
  const m = $('show').value;
  if (m === 'ever') showGen(bestGen());
  else showGen((m === 'top' || m === 'all' || $('follow').checked || selected < 0) ? latest : selected);
};

// Mate the islands' best creatures with each other (see Evolver.mateIslands),
// then show the hybrids, best first. The best of them join the islands.
$('mate').onclick = async () => {
  if (!evolver.history.length || evolver.islands < 2) return;
  const wasRunning = running;
  if (running) { $('go').click(); await loopDone; }   // the population must not change underneath
  $('mate').disabled = true;
  $('mateNote').textContent = 'Mating and scoring hybrids…';
  const parents = evolver.islandBests().map(p => p.fit);
  const kids = await evolver.mateIslands();
  $('mate').disabled = false;
  if (!kids.length) { $('mateNote').textContent = 'No viable hybrids.'; return; }
  const unit = UNITS[TASKS[task].kind];
  lastMate = `Last mating: ${kids.length} hybrids. Best ${kids[0].fit.toFixed(3)} ${unit} (best parent ${Math.max(...parents).toFixed(3)}); `
    + `${kids.filter(k => k.fit > Math.max(...parents)).length} beat every parent. The top ${Math.min(kids.length, 2 * evolver.islands)} joined the islands.`;
  drawIslands();
  const h = evolver.history[evolver.history.length - 1];
  selected = -1;
  $('follow').checked = false;
  markGens();
  const shown = kids.slice(0, 25);
  startReplay({ scene: h.scene,
    genome: shown[0].g, opponent: h.opponent, phase: h.phase, label: `hybrids of the island bests, generation ${h.gen}`,
    cells: shown.map(k => ({ genome: k.g, opponent: h.opponent, label: `${k.a + 1}×${k.b + 1} ${k.op === 'crossover' ? 'cross' : 'graft'} · ${k.fit.toFixed(3)}`, color: COLORS[k.a % COLORS.length] })),
  });
  drawGraph(shown[0].g);
  if (wasRunning) $('go').click();
};

// champions/<task>[-<plan>][-round].json, falling back to the free-plan one
function planTag(b = body()) {
  const p = b.plan.type === 'radial' ? 'radial' + b.plan.n : b.plan.type;
  return (p === 'free' ? '' : '-' + p) + (b.round ? '-round' : '') + (b.minArm ? '-arm' + b.minArm : '');
}

// Only a champion of exactly this target and body plan; for the free plan with
// round parts, the plain free champion (box-only genomes are valid there).
function championNames(b) {
  const names = [task + planTag(b)];
  return b.plan.type === 'free' && b.round && !b.minArm ? [...names, task] : names;
}

let champToken = 0;
async function loadChampion() {
  const token = ++champToken, b = body();
  try {
    let c = null;
    for (const n of championNames(b)) {
      const r = await fetch(`champions/${n}.json`);
      if (r.ok) { c = await r.json(); break; }
    }
    if (token !== champToken) return;
    if (!c) throw 0;
    $('champ').disabled = false;
    // shown automatically when the run is empty; a click also stops "watch latest"
    $('champ').onclick = e => {
      selected = -1;
      if (e) $('follow').checked = false;
      const gp = c.genome.plan, round = c.genome.nodes.some(nd => nd.shape && nd.shape !== 'box');
      const plan = gp ? ` ${gp.type}${gp.n ? ' ×' + gp.n : ''}${round ? ', round parts' : ''}` : '';
      startReplay({ genome: c.genome, opponent: c.opponent, phase: c.phase, scene: c.scene, label: `champion${plan} (${c.generations} generations)` + (c.scene ? '' : sceneFor(task).ball === 'cube' && TASKS[task].kind === 'compete' ? ', in the original cube scene' : ''), fitness: c.fitness });
      drawGraph(c.genome);
      markGens();
    };
    if (!evolver.history.length) { $('follow').checked = true; $('champ').onclick(); }
  } catch {
    if (token !== champToken) return;
    $('champ').disabled = true;
    // no champion with this plan yet: show an unevolved creature that has it
    const g = new Evolver({ task, seed: +$('seed').value, body: b }).randomViable();
    const plan = `${b.plan.type}${b.plan.n ? ' ×' + b.plan.n : ''}${b.round ? ', round parts' : ''}${b.minArm ? `, arms ≥ ${b.minArm}` : ''}`;
    $('follow').checked = true;
    startReplay({ genome: g, scene: evolver.scene, label: `random ${plan} creature, unevolved: press Evolve` });
    drawGraph(g);
  }
}

// ---------------------------------------------------------------- panel
function refresh() {
  const H = evolver.history;
  $('sGen').textContent = H.length ? H.length - 1 : '–';
  $('sBest').innerHTML = H.length ? Math.max(...H.map(h => h.best)).toFixed(3) + (evolver.rival ? `<small class="teamB">team B ${Math.max(...H.map(h => h.rivalBest ?? -Infinity)).toFixed(3)}</small>` : '') : '–';
  $('showRival').hidden = !evolver.rival;
  if (!evolver.rival && $('show').value === 'rival') $('show').value = 'best';
  if (!running) $('sRate').textContent = '–';
  const box = $('gens');
  while (box.children.length < H.length) {
    const i = box.children.length;
    const d = document.createElement('div');
    d.innerHTML = `<span>gen ${i}</span><span>${H[i].best.toFixed(3)}${H[i].rivalBest !== undefined ? ' · B ' + H[i].rivalBest.toFixed(3) : ''}</span>`;
    d.onclick = () => showGen(i);
    box.prepend(d);
  }
  while (box.children.length > H.length) box.lastChild.remove();
  markGens();
  drawChart();
  drawIslands();
}

// body diversity: mean descriptor distance between creatures, and between
// island averages (0 = all alike)
let lastMate = '';
function diversityText(h) {
  return `Body diversity ${h.diversity?.toFixed(3) ?? '–'} (generation 0: ${evolver.history[0].diversity?.toFixed(3) ?? '–'}); `
    + `islands ${h.islandSpread?.toFixed(3) ?? '–'} apart. ${h.founders} of the ${evolver.popSize} founding lineages survive.`;
}

// The chips show the generation being replayed (with Watch latest on, the
// replay finishes playing before it moves to a newer generation), or the
// latest. The island holding that generation's best is outlined.
function drawIslands() {
  const H = evolver.history, h = H[replay?.gen ?? -1] || H[H.length - 1];
  $('islandGen').textContent = h ? `generation ${h.gen}` : '';
  const ti = h ? topIsland(h) : -1;
  $('islandBox').hidden = evolver.islands < 2;
  $('mate').disabled = !h;
  const list = $('islandList');
  list.innerHTML = '';
  if (evolver.islands < 2) return;
  for (let k = 0; k < evolver.islands; k++) {
    const d = document.createElement('div');
    const f = h?.islands?.[k];
    d.innerHTML = `<i style="background:${COLORS[k % COLORS.length]}"></i>${k + 1} <span>${f === undefined ? '–' : f.toFixed(3)}</span>`;
    d.title = 'Watch the best creature of this island' + (k === ti ? ' (the best of this generation)' : '');
    if (k === ti) d.className = 'top';
    d.onclick = () => {
      if (!h?.islandGenomes) return;
      selected = -1; $('follow').checked = false; markGens();
      startReplay({ genome: h.islandGenomes[k], opponent: h.opponent, phase: h.phase, scene: h.scene, label: `island ${k + 1} best, generation ${h.gen}`, fitness: h.islands[k] });
      drawGraph(h.islandGenomes[k]);
    };
    list.append(d);
  }
  if (h && !$('mate').disabled) $('mateNote').textContent = diversityText(h) + (lastMate ? ' ' + lastMate : '');
}

function markGens() {
  const H = evolver.history, box = $('gens');
  [...box.children].forEach((d, k) => d.classList.toggle('on', H.length - 1 - k === selected));
}

function drawChart() {
  const cv = $('chart'), g = cv.getContext('2d');
  const w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = cv.clientHeight * devicePixelRatio;
  g.clearRect(0, 0, w, h);
  const H = evolver.history;
  if (H.length < 1) return;
  const pad = 8 * devicePixelRatio;
  const teams = H[0].rivalBest !== undefined;
  let lo = Math.min(0, ...H.map(x => x.mean), ...(teams ? H.map(x => x.rivalMean ?? 0) : [])), hi = Math.max(...H.map(x => x.best), ...(teams ? H.map(x => x.rivalBest ?? 0) : [])) || 1;
  if (hi - lo < 1e-6) hi = lo + 1;
  const X = i => pad + (w - 2 * pad) * (H.length === 1 ? 0.5 : i / (H.length - 1));
  const Y = v => h - pad - (h - 2 * pad) * (v - lo) / (hi - lo);
  g.strokeStyle = '#2c323c'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(w - pad, Y(0)); g.stroke();
  // each island's best, thin
  if (H[0].islands?.length > 1) {
    g.lineWidth = devicePixelRatio;
    H[0].islands.forEach((_, k) => {
      g.strokeStyle = COLORS[k % COLORS.length] + '99';
      g.beginPath();
      H.forEach((x, i) => (i ? g.lineTo(X(i), Y(x.islands[k])) : g.moveTo(X(i), Y(x.islands[k]))));
      g.stroke();
    });
  }
  // two teams: team B's best and mean in lilac, team A's as usual
  for (const [key, col] of [...(teams ? [['rivalMean', '#9b8ac4'], ['rivalBest', '#c9b6f2']] : []), ['mean', '#4fa3d9'], ['best', '#e8b04a']]) {
    g.strokeStyle = col; g.lineWidth = 2 * devicePixelRatio;
    g.beginPath();
    H.forEach((x, i) => (i ? g.lineTo(X(i), Y(x[key])) : g.moveTo(X(i), Y(x[key]))));
    g.stroke();
  }
  g.fillStyle = '#8b93a1'; g.font = `${10 * devicePixelRatio}px system-ui`;
  g.fillText(hi.toFixed(2), pad, pad + 10 * devicePixelRatio);
}

// Genotype as Sims drew it: nodes are parts, arrows are connections.
function drawGraph(gn) {
  const svg = $('graph');
  svg.innerHTML = '';
  if (!gn) { $('graphNote').textContent = ''; return; }
  const W = svg.clientWidth || 300, H = svg.clientHeight || 200;
  const n = gn.nodes.length;
  const R = Math.min(W, H) * 0.34;
  const pos = gn.nodes.map((_, i) => n === 1 ? [W / 2, H / 2] : [W / 2 + R * Math.sin(2 * Math.PI * i / n), H / 2 - R * Math.cos(2 * Math.PI * i / n)]);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.append(e); return e; };
  const defs = el('defs', {});
  defs.innerHTML = '<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#8b93a1"/></marker>';
  gn.nodes.forEach((nd, i) => {
    const counts = {};
    nd.conns.forEach(c => {
      counts[c.to] = (counts[c.to] || 0) + 1;
      const k = counts[c.to] - 1;
      const [x1, y1] = pos[i], [x2, y2] = pos[c.to];
      const dash = c.terminal ? '3 3' : '';
      if (c.to === i) {
        const r = 14 + 6 * k;
        el('path', { d: `M${x1 - 8},${y1 - 12} a${r},${r} 0 1 1 16,0`, fill: 'none', stroke: '#8b93a1', 'stroke-dasharray': dash, 'marker-end': 'url(#arr)' });
      } else {
        const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
        const bend = 18 * (k + 1) * (i < c.to ? 1 : -1);
        const mx = (x1 + x2) / 2 - dy / L * bend, my = (y1 + y2) / 2 + dx / L * bend;
        const ex = x2 - dx / L * 18, ey = y2 - dy / L * 18;
        el('path', { d: `M${x1},${y1} Q${mx},${my} ${ex},${ey}`, fill: 'none', stroke: '#8b93a1', 'stroke-dasharray': dash, 'marker-end': 'url(#arr)' });
      }
    });
  });
  gn.nodes.forEach((nd, i) => {
    const [x, y] = pos[i];
    const s = 10 + 8 * Math.max(...nd.dims);
    const style = { fill: COLORS[i % COLORS.length], stroke: i === 0 ? '#fff' : 'none', 'stroke-width': 2 };
    if (nd.shape === 'sphere') el('circle', { cx: x, cy: y, r: s * 0.85, ...style });
    else el('rect', { x: x - s, y: y - s * 0.7, width: 2 * s, height: 1.4 * s, rx: nd.shape === 'capsule' ? s * 0.7 : 3, ...style });
    const t = el('text', { x, y: y + 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#14171c', 'font-weight': 600 });
    t.textContent = nd.joint === 'rigid' ? 'rig' : nd.joint.slice(0, 4);
    const r = el('text', { x: x + s + 2, y: y - s * 0.7, 'font-size': 9, fill: '#8b93a1' });
    r.textContent = '×' + nd.recur;
  });
  const neurons = gn.nodes.reduce((a, nd) => a + nd.neurons.length, 0) + gn.globals.length;
  const plan = gn.plan ? (gn.plan.type === 'radial' ? `radial ×${gn.plan.n}` : 'bilateral') : 'free';
  $('graphNote').textContent = `${plan} body plan; ${n} node${n > 1 ? 's' : ''}, ${neurons} neurons (${gn.globals.length} global). White outline = root, ×n = recursive limit, dashed = terminal-only connection; rounded = capsule, circle = sphere.`;
}

// ---------------------------------------------------------------- examples
(async () => {
  try {
    const list = await (await fetch('examples/index.json')).json();
    for (const e of list) {
      const o = document.createElement('option');
      o.value = e.file; o.textContent = e.label;
      $('examples').append(o);
    }
  } catch { $('examples').disabled = true; }
})();

$('examples').onchange = async e => {
  if (!e.target.value) return;
  const c = await (await fetch('examples/' + e.target.value)).json();
  e.target.value = '';
  selected = -1;
  $('follow').checked = false;
  const label = (c.label || 'example').replace(`${TASKS[c.task].label} · `, '');
  startReplay({ genome: c.genome, opponent: c.opponent, phase: c.phase, scene: c.scene, task: c.task, label, fitness: c.fitness });
  drawGraph(c.genome);
  markGens();
};

// Start a new run whose population is mutants of the creature on screen,
// with the body plan and target it was shown with.
$('seedFrom').onclick = () => {
  if (!replay) return;
  if (running) $('go').click();
  const g = replay.genome;
  if (rtask() !== task) {
    task = rtask();
    for (const b of $('tasks').children) b.classList.toggle('on', b.dataset.task === task);
    $('sUnit').textContent = 'best ' + UNITS[TASKS[task].kind];
  }
  planType = g.plan?.type || 'free';
  if (g.plan?.n) $('radialN').value = String(g.plan.n);
  if (g.nodes.some(nd => nd.shape && nd.shape !== 'box')) $('round').checked = true;
  showPlan();
  newRun();
  evolver.seedFrom(g);
  $('go').click();
};

// ---------------------------------------------------------------- save / load
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('save').onclick = () => {
  download(`creatures-${task}-gen${evolver.gen}.json`, JSON.stringify({
    task, seed: evolver.rng && +$('seed').value, popSize: evolver.popSize, gen: evolver.gen,
    history: evolver.history, pop: evolver.pop.map(p => ({ g: p.g, fit: p.fit, isl: p.isl, founder: p.founder })), opponent: evolver.opponent,
    body: evolver.body, islands: evolver.islands, novelty: evolver.novelty, structural: evolver.structural, migrate: evolver.migrate,
    scene: evolver.scene, teams: evolver.teams, champ: evolver.champ,
    rival: evolver.rival && { history: evolver.rival.history, gen: evolver.rival.gen, champ: evolver.rival.champ, opponent: evolver.rival.opponent,
      pop: evolver.rival.pop.map(p => ({ g: p.g, fit: p.fit, isl: p.isl, founder: p.founder })) },
  }));
};

$('load').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  const d = JSON.parse(await f.text());
  if (running) $('go').click();
  if (d.task && d.task !== task) {
    task = d.task;
    for (const b of $('tasks').children) b.classList.toggle('on', b.dataset.task === task);
    $('sUnit').textContent = 'best ' + UNITS[TASKS[task].kind];
  }
  $('pop').value = d.popSize || 300;
  const b = d.body || { plan: { type: 'free' }, round: false };
  planType = b.plan.type;
  if (b.plan.n) $('radialN').value = String(b.plan.n);
  $('round').checked = !!b.round;
  $('minArm').value = String(b.minArm || 0);
  $('islands').value = String(d.islands || 1);
  $('teams').value = String(d.teams || 1);
  $('novelty').value = String(d.novelty ?? 0); $('structural').value = String(d.structural ?? 0); $('migrate').value = String(d.migrate ?? 10);
  showPlan();
  newRun();
  evolver.scene = d.scene ?? null;   // saves from before scenes: the legacy scene
  writeScene(evolver.scene);
  evolver.rng = makeRng((d.seed || 1) * 7919 + (d.gen || 0));
  evolver.history = d.history || [];
  evolver.gen = d.gen ?? evolver.history.length;
  evolver.opponent = d.opponent || null;
  evolver.pop = (d.pop || []).map(p => ({ g: p.g, fit: p.fit, isl: p.isl, founder: p.founder, id: evolver.nextId++ }));
  evolver.champ = d.champ || null;
  const rv = evolver.rival;
  if (rv && d.rival) {
    rv.rng = makeRng((d.seed || 1) * 7919 + (d.gen || 0) + 101);
    Object.assign(rv, { history: d.rival.history || [], gen: d.rival.gen ?? evolver.gen, champ: d.rival.champ || null, opponent: d.rival.opponent || null });
    rv.pop = (d.rival.pop || []).map(p => ({ g: p.g, fit: p.fit, isl: p.isl, founder: p.founder, id: rv.nextId++ }));
  }
  $('gens').innerHTML = '';
  refresh();
  if (evolver.history.length) showGen(evolver.history.length - 1);
  e.target.value = '';
};

// ---------------------------------------------------------------- frame loop
let acc = 0, last = performance.now(), slowed = false;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const allDone = () => sims.every(s => s.done);
  if (sim && !settled) {
    settleSims(25);
    if (!settled) $('hudSub').textContent = 'settling…';
  }
  const live = sim && settled;
  if (live && now <= pauseUntil && !allDone()) $('hudSub').textContent = hudText();
  if (live && now > pauseUntil) {
    acc += dt * +$('speed').value;
    let n = 0;
    slowed = false;
    while (acc >= DT && n < 16) {
      if (allDone()) break;
      for (const s of sims) if (!s.done) s.step();
      acc -= DT; n++;
      // a big crowd plays slower rather than freezing the page
      if (performance.now() - now > 30) { slowed = acc >= DT; acc = 0; break; }
    }
    if (allDone()) {
      // show the result briefly, then the next trial (or loop)
      acc = 0;
      if (!sim.finishedAt) {
        sim.finishedAt = now;
        $('hudSub').textContent = hudText(sims.length > 1 ? undefined : sim.fitness()[0]);
      } else if (now - sim.finishedAt > 1500) {
        replay.trial = (replay.trial + 1) % TASKS[rtask()].trials;
        if (replay.trial === 0 && recorder.recording) stopRecording();   // whole replay captured
        if (replay.trial === 0 && pendingGen >= 0 && $('follow').checked && pendingGen !== replay.gen) {
          showGen(pendingGen, false);
          pendingGen = -1;
        } else restartSim();
      }
    } else {
      $('hudSub').textContent = hudText();
    }
  }
  if (live) view.update();
  $('hudTitle').textContent = replay ? `${TASKS[rtask()].label} · ${replay.label}${replay.cells?.[replay.focus] ? ' › ' + replay.cells[replay.focus].label : ''}` : TASKS[task].label;
  if (!replay) $('hudSub').textContent = 'Press Evolve to start a run.';
  view.render();
  if (recorder.recording && settled) {
    recorder.frame($('hudTitle').textContent, $('hudSub').textContent);
    const t = Math.floor(recorder.seconds);
    $('record').textContent = `■ Stop ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  requestAnimationFrame(frame);
}

function hudText(finalFit) {
  const T = TASKS[rtask()];
  let s = `t = ${Math.max(0, sim.t - (sim.tStart ?? sim.t)).toFixed(1)} / ${sim.T}s`;
  if (sim.settling) s = sim.relaxing && sim.tStart === null ? `relaxing ${sim.t.toFixed(1)}s (no friction, no muscles)` : `settling ${sim.t.toFixed(1)}s`;
  if (T.trials > 1) s += ` · trial ${replay.trial + 1}/${T.trials}`;
  if (sim.coop) s += sim.scored !== null ? ` · GOAL at ${sim.scored.toFixed(1)}s` : sim.tStart !== null ? ` · ball ${sim.ballToGoal().toFixed(2)} m from the goal` : '';
  if (sim.lift && sim.cube && sim.tStart !== null) s += ` · cube ${Math.max(0, sim.cube.translation().y - sim.ballR).toFixed(2)} m up`;
  if (sim.statics && sim.tStart !== null && sim.creatures[0].valid) s += ` · lowest part ${Math.max(0, sim.creatures[0].lowest()).toFixed(2)} m up`;
  if (sim.volley && sim.tStart !== null) s += ` · ${sim.passes} pass${sim.passes === 1 ? '' : 'es'}`;
  if (sim.coop && sim.scene.together > 0 && sim.playSteps) s += ` · both on it ${Math.round(100 * sim.bothSteps / sim.playSteps)}%`;
  if (finalFit !== undefined) s += ` · this trial ${finalFit.toFixed(3)} ${UNITS[T.kind]}`;
  else if (replay.fitness !== undefined) s += ` · fitness ${replay.fitness.toFixed(3)} ${UNITS[T.kind]}`;
  if (sims.length > 1) return s + ` · ${sims.length} creatures` + (slowed ? ', slowed down to keep up' : '') + (replay.focus >= 0 ? ' · Esc or click empty space to zoom out' : ' · click a creature to zoom in');
  if (!sim.creatures[0].valid) s += ' · invalid body (parts interpenetrate)';
  else if (sim.failed[0]) s += ' · simulation error (speed or energy audit)';
  return s;
}

showPlan();
writeScene(defaultScene('swim'));
setTask('swim');
requestAnimationFrame(frame);
window.bc = { get evolver() { return evolver; }, get sim() { return sim; }, view, pool };
