# Block Creatures

A browser re-creation of Karl Sims' *Evolving Virtual Creatures* (SIGGRAPH 1994)
and *Evolving 3D Morphology and Behavior by Competition* (ALife IV, 1994):
creatures made of jointed blocks, with their bodies and neural controllers
evolved together, for the same evolutionary targets Sims used:

| Target | Environment | Fitness (as in Sims) |
|---|---|---|
| Swimming | water: no gravity, viscous drag on every face | COM speed: ½ × max distance from start / T + ½ × speed over the final third (rewards straight, sustained motion) |
| Walking | land: gravity, ground friction | same, horizontal, measured after a 1.5 s settling period so falling over doesn't count |
| Jumping | land | maximum height reached by the *lowest* part of the creature |
| Following (water / land) | either | closing speed toward a light source, averaged over 3 trials with the light in different directions; per-block photosensors |
| Competition | land, two creatures, a ball (or Sims' cube) between them | 1 + (d_opp − d_self)/(d_opp + d_self) from the final distances to the ball; each creature competes against the previous generation's best ("all vs. best"); sizes capped at equal volume |

## Body plans and round parts (beyond Sims)

Two run settings let you experiment with body organization. Both are stored
in the genome (`plan`, and `shape` per node), so creatures replay correctly.

- **Body plan**
  - *Free*: Sims' original genotype, with per-connection reflection.
  - *Bilateral*: mirror symmetry about the midplane z = 0. A connection
    from a part on the plane either stays on it, when it attaches within a
    quarter of the part's width of the plane (it is snapped onto it, attachment
    axis in-plane), or becomes a left/right pair. The pair's subtrees are
    mirror images, and parts off the plane are never paired again.
  - *Radial ×N*: N-fold rotational symmetry about the vertical axis.
    Attachments near the axis on a top or bottom surface stay on the axis;
    others are repeated N times around it. Boxes on the axis become cylinders
    (a square can't be 5-fold symmetric).
- **Symmetry position sensor**: every part senses its side (+1 / −1) or arm
  (2k/N), 0 on the plane or axis. Oscillator neurons take a second, phase-shift
  input (1 = half a cycle). Without this, mirror and rotated copies run
  identical brains and can only move in lockstep. With it, a single
  connection can put the two sides in antiphase or send a travelling wave
  around the arms.
- **Round parts**: genes may choose capsule or sphere as well as box.
  A capsule lies along the attachment axis, so a recursive chain with scale
  below 1 tapers into a tentacle (the recursive limit is now up to 6).
  Attachments on round parts sit on the curved surface and follow its normal.
  Mass and inertia are exact per shape, which matters for the
  stability bound.
- **Rolling resistance** (`PHYS.rolling` = 0.3): with round parts on land,
  evolution immediately found frictionless wheels and "ballbots" (a ball rolled
  by holding a weight ahead of it) doing 10 m/s. Round parts touching the
  ground now feel a torque opposing their horizontal spin, so wheels still
  evolve but within plausible limits.

Symmetric bodies may have up to 40 parts and are rejected rather than
truncated past that, since truncation would break the symmetry.
`tools/symtest.mjs` checks that every developed body is exactly symmetric, and
`tools/symdyn.mjs` that twins move as mirror or rotated images.

**Evolution stays within a body plan.** Every target and body plan (arm
count and round-parts setting included) has its own run in the app. Switching
plans keeps the other runs, so you can go back to them. The evolver rejects any
genome whose plan differs from its run's, so mutation, crossover and grafting
never mix plans. A headless `SEED_FROM` creature must have the run's plan.

**Waves along arms.** Every segment of a chain is a copy of the same gene
and runs the same circuit, so segments flex in lockstep. Two additions make
travelling waves easy:

- **Chain position sensor** (sensor 16): 0 at the base of a recursive chain,
  1 at its tip. An oscillator whose phase input reads it runs each segment
  a little behind the one before it. The input's weight sets the wavelength:
  1 = half a wave along the chain.
- **Servo joints** (a per-gene flag): the brain's output is a target angle
  across the joint's range, and the muscle drives toward it (PD control, ω =
  12 rad/s, damping 0.7). Torque is capped by the same strength and
  acceleration limits, and its work is audited like any muscle. With torque
  control, a wave of torques along a chain mostly cancels: each joint pushes
  its child one way and its parent the other. In tests, bends came out small
  and alternating in sign. With servos, a wave of targets becomes a wave of
  bending: 0.3–0.8 rad per segment, each 10–30 steps behind the one before
  it. Random genes are servos a quarter of the time, and mutation toggles the
  flag. Genomes from before have no flag and replay exactly as before.

Grown arms (below) start with such a wave controller on servo joints, at
0.4–1.4 Hz. A structural mutation can add one to any chain that evolves.
Evolution tunes frequency, wavelength and amplitude.

**Min arm** (Body plan) makes only creatures with an appendage at least that
many segments long viable. Random creatures that lack one get a tapering
arm grown from the root, which radial plans repeat N times (octopus or
jellyfish), and evolution can't shorten it below the minimum. Without the
setting, short paddles win early: seeded with 6 long tentacles, evolution cut
them to 2 segments. Long-armed creatures start slow (a few cm/s) and cost
2–3× as much to simulate. Symmetric bodies may now have up to 64 parts,
chains repeat up to 8 times and creatures may be 5 m across.

## Islands, and seeing the whole population

With a single population, one lineage takes over almost at once. In a walking
run, 300 founding lineages fell to 12 by generation 3 and 1 by generation 27.
From then on, the first body that worked was the only one refined; later
changes were tuning. **Islands** (default 6) splits the population into
sub-populations that select and mate separately. Every 30 generations
(**Migrate**), each island's best migrates to the next island. Migration every
10 generations made the islands alike: a fitter migrant takes over the island
it reaches, so after 34 generations the 6 islands shared 2 lineages.
`Islands 1` is Sims' original scheme.

Islands alone don't produce new designs, so two more settings do:

- **Novelty** (default 0.3): each body is a point in a descriptor space (part
  count, longest arm, nodes used, extents, part size and elongation, shape
  mix, joint freedom, share of end parts). Its novelty is the mean distance
  to its 10 nearest neighbours in the whole population (all islands), plus an
  archive of the most novel body of each past generation. Survivors are chosen
  by a blend of fitness rank and novelty rank. Each island's two fittest
  always survive, so the best fitness never drops. Because novelty is
  measured across islands, islands that resemble each other are pushed apart.
- **New structures** (default 25%): plain mutation makes about 1.5 changes per
  child, nearly all parameter tweaks; a new part appears in roughly 1 child in
  50. This share of mutants gets one structural change instead: a new limb,
  a duplicated segment that can then diverge, a new chain, a moved attachment,
  a different joint or shape, or a part made twice or half as long.

The Islands panel reports body diversity (mean descriptor distance between
creatures), how far apart the islands' averages are, and how many founding
lineages survive. In a 40-generation swimming comparison (one seed, so
indicative only), the old settings ended with 2 lineages across 6 islands and a
best of 0.39 m/s. The new defaults ended with 4 lineages and 0.48 m/s. Novelty
can be changed during a run. `NOVELTY`, `STRUCT` and `MIGRATE` set these for
headless runs; 0, 0 and Islands 1 reproduce Sims' scheme.

- In any view of several creatures, **click a creature** to zoom in and
  follow it. It becomes the creature on screen for the genotype graph,
  **Evolve from this** and **Record**. Click empty space or press Esc to zoom
  back out.
- The **Islands** panel shows each island's best fitness for the generation
  being replayed (with **Watch latest** on, a replay plays to the end before
  moving to a newer generation). The island holding that generation's best is
  outlined. Click one to watch it. The fitness chart draws each island's best
  as a thin line.
- **Show** (next to Record) picks what a generation's replay shows: its
  *Best*, the run's *Best so far* (the highest-scoring generation best; in
  following and competition everyone is re-scored under new conditions every
  generation, so a generation's best can score below an earlier one), the *Island bests* side by side with labels, or the latest generation's
  *Top 25* or *Whole population*. Each creature runs in its own physics world,
  offset only in the picture. Big crowds play slower than real time. Labels
  shrink with distance in crowds of more than 9; past 25 they show only the
  fitness, coloured by island. **Labels** hides them.
- **Mate island bests** crosses every island's best with every other island's
  best, by crossover and by grafting (the first-named island gives the root).
  It scores the hybrids under the latest generation's conditions and shows
  the top 25 labelled like `2×5 cross · 0.84`. The best two per island replace
  that island's newest children, and selection decides whether they last.

## Scene

The **Scene** panel sets the world a run is scored in:

- **Lifespan**: seconds each creature is scored for, after settling (blank =
  the target's default).
- **Gravity** and **Friction** on land; **Viscosity** in water.
- **Light distance** for following.
- Competition: the **Prize**, a ball (default) or Sims' cube, with its
  **Size** and **Mass**. The ball rolls, with a little rolling resistance, so
  creatures can push and dribble it. **Start distance** puts each contestant's
  near side that far from the prize. **+ body length** adds each contestant's
  own longest dimension, so a tall body can't win by toppling onto the prize.
  **Size cap** scales bigger contestants down to that volume.

The scene belongs to the run: it is saved with it, recorded in each
generation's history, and used when that generation is replayed. Changing it
mid-run re-scores everyone from the next generation (the note says from which
generation scores aren't comparable), and replays the creature on screen in
the new scene straight away. Creatures saved before scenes existed replay in
the scene they evolved in (a 0.8 m cube 1.5 m away).

**Examples ▸** replays example creatures, including hand-built tentacles.
**Evolve from this** starts a new run seeded with mutants of whatever creature
is on screen, with its body plan and target.

## Running

Live: https://joyhughes.github.io/blockcreatures/

Locally, any static file server works; `serve.py` turns off caching so edits
show on reload:

```sh
python3 serve.py 8931
# open http://localhost:8931
```

three.js and Rapier are vendored in `vendor/` (MIT and Apache-2.0, licences
alongside), so the site runs as plain static files. `npm install` is only
needed to upgrade them: `npm install` then `tools/vendor.sh`.

Pick a target and press **Evolve**. Evaluation runs in a pool of web workers.
The replay shows the best creature of the newest generation, or click any
generation to watch its best. **Champion** replays a creature evolved headlessly
for 150 generations (from `champions/`). **Save run** / **Load run** store the
whole population, so a run can be resumed.

**● Record** (bottom left of the view) restarts the replay and saves it as a
video: MP4 in Chrome, Safari and recent Firefox, WebM otherwise. It captures
every trial, with the title and status text, and stops by itself at the end;
click again to stop early. The clip runs at the playback speed you pick. It
is the size of the view on screen, so enlarge the window for a bigger video.
Files are named by target, plan and creature, e.g. `walk-bilateral-round-champion.mp4`.

Headless evolution (uses all cores via worker_threads):

```sh
node tools/evolve.mjs <task> [generations] [popSize] [seed]   # -> runs/<task>-<seed>.json
node tools/champion.mjs runs/<task>-<seed>.json                # -> champions/<task>.json
node tools/inspect.mjs runs/<task>-<seed>.json [gen]           # morphology, brain, trajectory
node tools/energy.mjs  runs/<task>-<seed>.json [gen]           # energy audit (exploit check)
node tools/jointtest.mjs                                       # joint sensing/torque sign test
node tools/symtest.mjs / symdyn.mjs                            # body-plan symmetry checks
node tools/regress.mjs                                         # bundled champions unchanged?
node tools/cdp.mjs <url> out.png [waitMs] [js]                 # headless Chrome screenshot
```

Tasks: `swim walk jump followWater followLand compete`. Env: `ISLANDS=K`
(default 6; 1 = single population), `MIN_ARM=k`, `SEED_FROM=file`,
`SCENE='{"gap":4,"duration":15}'` (scene overrides, see `SCENE` in `src/sim.js`),
`LEGACY=1` (the old cube scene); e.g.
`MIN_ARM=4 node tools/evolve.mjs swim 150 300 1 radial8 round`. Body plans for the
headless runner: `node tools/evolve.mjs walk 150 300 1 bilateral round` (plan
`free | bilateral | radialN`, then `round` to allow capsules and spheres;
`SEED_FROM=examples/tentacles.json` starts from mutants of a creature).

## Bundled champions

Evolved headlessly at population 300, single population (`tools/batch.sh`
re-evolves them all, about an hour). Raising the size limits for long arms
changed which mutants are viable, so re-running it now evolves different
champions. Scores below are under the current fitness measures (see
"Falling isn't moving"). The saved ones still replay exactly (`tools/regress.mjs`). Every one passes the energy audit (≤ 0.45 J/kg).

| Target | Body plan | Generations | Result |
|---|---|---|---|
| Swimming | free | 150 | 0.68 m/s |
| Walking | free | 150 | 1.77 m/s |
| Jumping | free | 150 | lowest part 0.64 m up |
| Following (water) | free | 300 | 0.12–0.39 m/s closing, from all 8 test directions |
| Following (land) | free | 300 | 0.02–0.18 m/s closing from all 8 directions (re-evolved after the fall fix; straight-line motion would average ≈ 0) |
| Competition | free, 6 islands, ball scene | 150 | 1.49 average against the bests of every 10th generation (0.90 in a close race with the previous best); both contestants walk from 2.7 m to within 0.7 m of the ball in 10 s |
| Swimming | radial ×5, round | 150 | 0.74 m/s |
| Swimming | bilateral, round | 150 | 0.63 m/s |
| Swimming | radial ×6, from the tentacle example | 150 | 0.67 m/s |
| Walking | radial ×5, round | 150 | 0.59 m/s |
| Walking | bilateral, round | 150 | 2.69 m/s |
| Jumping | radial ×4, round | 150 | 1.41 m |
| Following (water) | bilateral, round | 100 | 0.12–0.20 m/s from all 8 directions |

Choosing a body plan shows the champion of exactly that target and plan,
or an unevolved random creature with the plan if there is none yet. All
champions are under **Examples**.

## What follows Sims

- **Genotype** (`src/genome.js`): a directed graph. Each node holds block
  dimensions, joint type, joint limits, a recursive limit, a local neural
  circuit and one effector per joint DOF. Each connection holds the attachment
  point on the parent's surface, orientation, scale, a reflection (negative
  scale on one axis, for symmetric subtrees) and a terminal-only flag.
- **Development**: the phenotype grows from the root node. Recursive
  connections repeat up to the node's limit, and terminal-only connections
  fire only at the end of a recursive chain. Neural circuits are copied into
  every part instance, wired to parent and child parts. Creatures whose
  non-adjacent parts interpenetrate are discarded.
- **Joints**: rigid, revolute, twist, universal, bend-twist, twist-bend and
  spherical. Joint limits are restoring spring torques, and effector strength
  scales with the parts' cross-sectional area.
- **Sensors**: joint angles, contact sensors on each face of every block, and
  photosensors (target direction in each block's frame); beyond Sims, symmetry
position and chain position.
- **Neurons**: Sims' full set: sum, product, divide, sum-threshold,
  greater-than, sign-of, min, max, abs, if, interpolate, sin, cos, atan, log,
  expt, sigmoid, integrate, differentiate, smooth, memory, oscillate-wave and
  oscillate-saw. Global neurons sit outside the body. The brain runs two steps
  per physics step.
- **Evolution** (`src/evolve.js`): population 300, the best fifth survive, and
  offspring are allotted in proportion to fitness. Reproduction is 40%
  mutation, 30% crossover and 30% grafting. Mutation rates are scaled
  inversely with genome size so each genome gets about the same number of
  mutations, followed by garbage collection of unreachable nodes. Mating is
  followed by mutation at a reduced rate.

## Where it differs, and why

- **Physics**: Rapier (impulse-based joints) instead of Sims' Featherstone
  articulated-body dynamics. Every body starts in the creature's rest
  orientation, and blocks are rotated colliders inside their body, so each
  joint frame can be chosen freely. Effectors and limits are torques computed
  in `src/sim.js`, not engine motors.
- **Joint angles** use a swing-twist decomposition: twist about the child's
  attachment axis, swing about the parent's bend axes. Torques are applied
  about those same axes. Applying twist about the parent's axis after a large
  swing was non-conservative and pumped energy into a "jumper".
- **Stability guards**: effector torque scales as area^1.5 and is capped at a
  fixed angular acceleration. Joint damping is explicit, so its gain is scaled
  by a *lower bound* on the effective inertia: each body's inertia about its
  own centre of mass, in series. Scaling by inertia about the joint anchor
  overestimated it, and the resulting step-to-step chatter, rectified by
  water drag, made a 2 m/s "swimmer" out of nothing.
- **Joint limits are inelastic stops**, not springs. Past a limit, an angular
  impulse cancels outward motion (including that step's muscle push) and
  sets a small return speed. Sized with the lower-bound inertia, it can
  only under-correct, so limits never add energy. Explicit limit springs on
  multi-axis joints, against ground contact, leaked energy. Evolution
  amplified that into the earlier 2.6 m "flea" jump, which now manages 3 cm.
- **Contacts**: the ground is an analytic half-space, and the solver runs 12
  iterations instead of Rapier's default 4. With 4, contacts on small, light
  round parts (notably cylinders on a box floor) created about 1 J/kg.
- **Water drag** is integrated over a 3×3 grid on each face. With only one
  sample at the face centre, a plate spinning about an in-plane axis felt no
  drag, and evolution promptly found that.
- **Falling isn't moving**: a tall creature that stays up through the
  settling period and then topples carries its centre of mass forward about
  as far as it drops (H/2 for a stick of height H). On land, the drop of the
  centre of mass below its height when measuring began is subtracted from
  distance (walking, following), and from the final-third distance using the
  drop within that third. A walker's centre of mass bobs but doesn't fall, so
  the walking champion lost under 2% (1.80 → 1.77 m/s). The old land-following
  champion fell to −0.01: it had been toppling toward the light. It was
  re-evolved under the new measure and now walks toward it. Jumping
  counts the lowest part's height only as far as the centre of mass has also
  risen: a toppling body swings its grounded parts up while its centre of
  mass falls. Real jumpers keep their scores (0.64 m; 1.43 → 1.41 m).
- **Exploit detection**: Sims noted that evolution finds every simulation bug.
  Here nobody scores if any body exceeds 30 m/s, or if the energy audit
  trips. Let x = full mechanical energy (translation, rotation, gravity;
  creatures and cube) − starting energy − positive muscle work (trapezoid
  rule, credited at the end of each step). Honest physics only lowers x, so a
  *rise of x above its own running minimum* is energy the simulator made.
  (Tracking the rise stops an earlier hard landing from masking a later
  gain.) Honest creatures stay under ~0.5 J/kg; the limit is 1 J/kg.
  `tools/stepaudit.mjs` reports it for any run or champion.
- **Size bounds**: accumulated scale is clamped to 0.3–2, creatures are
  limited to 20 blocks (64 with a symmetric plan) and a 5 m bounding box, and neural references wrap
  around the neurons actually present. Without the size bound, a 35 m tower
  "followed" the light by falling over.
- **Competition** uses one population against the previous best, rather than
  two co-evolving species.
- **Following** keeps the light still within a trial, and its placement
  changes every generation so creatures can't memorize it.
