# Block Creatures

A browser re-creation of Karl Sims' *Evolving Virtual Creatures* (SIGGRAPH 1994)
and *Evolving 3D Morphology and Behavior by Competition* (ALife IV, 1994):
creatures made of jointed blocks, with their bodies and neural controllers
evolved together, for the same evolutionary targets Sims used:

| Target | Environment | Fitness (as in Sims) |
|---|---|---|
| Swimming | water: no gravity, viscous drag on every face | COM speed: ½ × max distance from start / T + ½ × speed over the final third (rewards straight, sustained motion) |
| Surface swimming (beyond Sims) | water surface: gravity, buoyancy, drag only under water, air above | as swimming, horizontal; measured after 2 s afloat with the muscles off |
| Walking | land: gravity, ground friction | same, horizontal, measured after the body has relaxed (see below) so falling over doesn't count |
| Jumping | land | maximum height reached by the *lowest* part of the creature |
| Following (water / land) | either | closing speed toward a light source, averaged over 3 trials with the light in different directions; per-block photosensors |
| Competition | land, two creatures, a ball (or Sims' cube) between them | 1 + (d_opp − d_self)/(d_opp + d_self) from the final distances to the ball (nearest part), less a bonus for wrapping around it; each creature competes against the previous generation's best ("all vs. best"), of its own population or, with **Teams**, of a rival species; sizes capped at equal volume |
| Cooperation (beyond Sims) | land, two creatures side by side behind a heavy ball, a goal ahead | one shared score: 0.8 × the share of the way the ball got to the goal + 0.2 × the share of their distance to the ball the two closed; a goal ends the game and scores 1 + the share of time left (so 1–2) |
| Volley (beyond Sims) | land, two creatures facing each other across a light ball | one shared score: the number of passes (the ball travels ≥ 0.5 m between one creature's touch and the other's), plus up to 0.75 before the first for touching it and closing on it |
| Wrestling (beyond Sims) | land, two same-size creatures face to face, no ball | sumo: 1 + (how far the opponent's centre of mass ever got outside a 2 m ring − how far mine did) / 1 m + 0.5 × (its mean distance from the middle − mine) / 2 m, capped to 0–2, + 0.5 × the share of the bout the two are in contact; all vs. best like competition |
| Stairs (beyond Sims) | land, a pit at the bottom of a square stepped amphitheatre (12 steps of 0.15 × 0.4 m) | metres climbed: ½ the centre of mass's rise + ½ the lowest part's final height. Animal templates (new runs) climb under walking's fall rules, the steps counting as ground: a fall ends the climb, keeping its height from 2 s before, and the standing bonus is added. Without them bipeds and quadrupeds toppled before reaching the steps, and lost nothing |
| Biped walking (beyond Sims) | land, the biped template | as walking, up to the first time any part but a foot or the tail touches the ground, + 0.1 × the share of the time it stayed up |
| Quadruped walking (beyond Sims) | land, the quadruped template | as biped walking, falls being anything but the paws, toes or tail touching the ground |
| Centaur walking (beyond Sims) | land, the centaur template | as quadruped walking, falls being anything but the hooves or tail touching the ground (the human half must stay off it); canned gaits drive its horse half as a quadruped's |
| Knocked down (beyond Sims) | land; one second in, a pendulum ball (2 × the creature's mass, 2.5 m rope, from 75°) swings in from a random direction and is taken away after one pass; two opposite directions per test, re-drawn each generation | standing, as in getting up, from the strike on: ¾ the last third's average, ¼ the whole time's |
| Skiing (beyond Sims) | land on skis: a plank under every foot, slippery snow (friction 0.08) with edges that grip sideways, down an 8° hill (Scene: *Hill*; 0 = skating on ice) | metres downhill (on the flat, in any direction) per second until any fall, plus the standing bonus. Only the skis may touch the snow: a boot or toes on it is a fall too |
| Cross-country skiing (beyond Sims) | as skiing, up a 2° climb (Hill −2), snow friction 0.05, light air drag | metres up the climb per second until any fall. Skis slide along their line and grip across it, so a skier can skate (push off one ski's edge, the other lifted) or herringbone (skis splayed, pushing off their inside edges) |
| Cross-country course (beyond Sims) | skis with grip wax on a 45 m trail over real terrain (a heightfield): climbs and descents up to about 9°, bends of 30–60°, red marker poles either side that the eyes see; 20 s. Scene Course hills / Course turns scale it, Trail width sets the poles' spacing | metres along the trail per second until any fall; nothing past where the centre of mass first strays off the trail |
| Standing (beyond Sims) | land; walking's fall rules | half the share of the time it stays up, half its average height (a share of its built pose's) over the whole time |
| Getting up (beyond Sims) | land; the creature starts lying on its side, on its back or sitting (Scene: *Start*) | how well it stands, 0–1: uprightness (on its back 0, on its side 0.5, as built 1) × centre-of-mass height as a share of the built pose's, halved while any part but its feet touches the ground (a template's feet, paws, toes and tail; otherwise the parts on the ground as built); ¾ the last third's average, ¼ the whole run's |
| Lifting (beyond Sims) | land, a barbell (a 0.72 m bar, 6 cm thick, between two square 0.24 m plates, 0.3 kg; the bar 0.12 m off the ground: thin enough for a hand to close round, high enough for a trunk to get under; runs before had a 1.2 m bar between 0.4 m plates) beside the creature | the barbell's height off the ground averaged over the last second, + up to 0.2 for closing on it |
| Slalom (beyond Sims) | as skiing, with two gates down the hill (3.5 m apart, alternately 0.8 m to either side): each a 1.6 m opening between two tall red panels, which eyes see as salient up to 5 m away and bodies pass through (breakaway; solid ones stopped every straight-line beginner dead) | as skiing, but distance past the first gate missed doesn't count. Scene: *Gates*, spacing, offset, width |
| Skating spins (beyond Sims) | flat ice (friction 0.08), short skates (0.3 m blades) on the feet | turns in the air in its best jump that it landed on its skates alone and held upright for 0.5 s; a jump ending in a fall scores a tenth of its turns. Turns are the whole body's: its angular momentum about the vertical through its centre of mass over its moment of inertia, with the momentum held to no more than at take-off, so twisting one part against the rest (as a falling cat rights itself) nets nothing, pulling the limbs in spins it faster, and the solver can't add spin. Shaping (Scene, ≤ 0.1): a third each for net turns spun upright on the ice, time in the air, and landing any jump |
| Shot put, Javelin (beyond Sims) | land; the implement (a 6 cm-radius shot, 5% of the creature's mass; a 1.2 m javelin, 1%) appears on a stand in front of the creature, as high as its centre of mass, as measuring starts | the farthest throw: from where it was let go (nothing else touching it) to where it first lands, so carrying, rolling or pushing it off the stand earn nothing; a biped must let go from a hand; a javelin landing other than tip first scores a quarter. Shaping (Scene, ≤ 0.1): half for touching it, half for lifting it up to 0.5 m |
| Javelin grip (beyond Sims) | as javelin, no throw | pre-training for the javelin: 0.1 for reaching a hand to it, 0.1 for touching it, 0.3 for lifting it in the hands alone (two or more hand parts on it, nothing else) up to 0.2 m, 0.5 for holding it there 2 s. A fall, or knocking it onto the ground, scores 0. In Javelin (Scene: *Grab*) a throw counts only once it has been held up 0.5 s, and falls or knocking it away score 0 |
| Speed skating (beyond Sims) | flat ice (friction 0.02) on long blades 6 cm tall that grip across their line, light air drag | metres straight ahead (the way it faced as measuring began) per second until any fall. Only the blades may touch the ice: a boot on it is a fall. A skater may lift a skate and push out sideways off the other |
| Ski jumping (beyond Sims) | a hill of solid snow boxes: a 35° inrun curving up into an 11° takeoff table, maybe a kicker swooping up at its end (Scene: *Kicker*), the edge standing *Edge height* above the knoll, a 35° landing hill, the flat outrun; rounded skis, light air drag | 0.1 for getting down the inrun (shaping), a point per 10 m from the edge to the first touch of the landing hill, +0.5 for landing on the skis alone and holding it 1 s, +0.5 × the share of 3 s more it rides out upright on its skis alone (a fall ends the ride) |

### Falling over: Sims' rules

Evolution's first trick on land is to be tall and fall over. Sims' papers
use five defences, all of which are used here:

1. **Relax before scoring** (*Evolving Virtual Creatures*, §5.2): "first
   running the simulation with no friction and no effector forces until the
   height of the center of mass reaches a stable minimum." Without friction a
   toppling body can't push itself anywhere: with no horizontal force on it,
   its centre of mass falls straight down. Settling ends when the centre of
   mass hasn't dropped (by 1 mm) for 0.5 s, after at least 0.3 s and at most
   5 s; then friction and muscles come on and the clock starts.
2. **Walking counts only horizontal motion.**
3. **Jumping scores the lowest part's height**, which a toppling body keeps
   on the ground.
4. **Diagonal starting zones** (*Evolving 3D Morphology and Behavior by
   Competition*, §2): each contestant starts "behind a diagonal plane
   slanting up and away from the cube", "so taller creatures must start
   further back." With a 45° plane, a point at height h starts at least h
   further back, which is as far as toppling carries it. A long, low crawler
   isn't pushed back at all.
5. **Relax before placing**: on frictionless ground where a body is doesn't
   change how it settles, so with **Settle apart** (default) each contestant
   relaxes (rule 1) on its own, 50 m off to the side, where neither the ball
   nor the other creature can touch it, and with its brain idle (its senses
   would be from the wrong place); then it moves to its plane in its slumped
   posture and its brain starts with the clock. Without Settle apart (older
   runs) contestants relax beside the ball against their plane, sensing, and
   are kept touching it as they slump.

Replays don't show settling: they start when the clock does.

Competition also has Sims' **control bonus**: "further decreasing the
distance value ... when a creature is touching the cube on the side that
opposes its center of mass". Here, a part touching the ball at a point whose
direction from the ball's centre lines up with the line from the creature's
centre of mass through the ball takes up to the ball's radius off its
distance, in proportion (fully round the far side: the whole radius; touching
from the near side: nothing).

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

**Animal templates**: *Snake*, *Quadruped*, *Insect*, *Arachnid*,
*Crustacean*, *Centipede*, *Biped*, *Centaur* and *Ducktopus* are bilateral body plans whose genome graph is fixed
(`TEMPLATES` in `src/genome.js`). Each node has a role, and the role fixes
what the node attaches to, on which face, how often a chain may repeat
(within a range), which joints it may have, and the range of its size.
Evolution tunes everything inside that: sizes, joint types and limits,
attachment points and angles (within ranges), chain lengths and brains.
It also switches optional parts on and off: a part that is off has its
connections skipped, with everything hanging from it. After every mutation
and mating the genome is snapped back onto its template. Plain mutation
never adds or removes parts, and crossover lines up the two parents'
matching roles. Grafting swaps one role's node for the other parent's.

| Template | Parts |
|---|---|
| Snake | head; body chain of 3–8 segments, ending in a tail chain of 1–6 |
| Quadruped | body; four legs with hip and knee, each ending in a paw (fused) with five toes; head, optional neck and trunk (2–5 segments); optional tail (2–6); optional blades at the tips of the tail (fluke) and trunk; optional dorsal fin |
| Insect | thorax with six legs, each with a hip and a knee; head with optional antennae (1–3 segments) and mandibles; abdomen with optional stinger |
| Arachnid | body with eight legs with hip and knee, optional pincers on the front pair; head with optional mandibles; optional tail (2–6) with stinger |
| Crustacean | carapace with ten legs with hip and knee, the front pair ending in pincers; head with antennae (1–4 segments); optional segmented tail (2–6) |
| Centipede | head with optional pincers; 3–8 segments with two legs each, with hip and knee |
| Biped | upright torso; two legs with hip, knee and ankle, ending in a flat foot; optional head, two-joint arms and tail (1–5) |
| Centaur | a horse's body, spine and withers on four legs with hip and knee, each ending in a hoof (fused); optional tail (2–5); a human waist (1–2 segments) and chest rising from the withers, with a head and two arms with the biped's hands |
| Ducktopus | an octopus's mantle on eight arms (3–6 tapering segments), four low on each side fanned fore and aft; a duck's head with a flat bill on a neck (1–3); optional tail feathers (a blade) |

Insect, arachnid, crustacean and centipede legs have knees: the upper leg
leaves the body roughly level and the lower leg bends down from it. The
lower legs come last in the genome, so the earlier one-joint champions still
replay unchanged, and seeding from one gives it knees.

The quadruped's toes are fused to the paw. Jointed, they were light enough
for the solver to gain energy, and one in eight random quadrupeds failed the
energy audit. Toes fan outward so neighbours never cross.

The quadruped's tail and trunk can end in a flat blade (optional, rigid or
on a hinge). Evolution sets its dims, so it can come out broad up and down
like a fish's tail fin or side to side like a whale's fluke, up to 0.45 m
across. Without it, a tail could only get broad along its whole length,
since a chain repeats one part, tapering. The tail and trunk segments can
also be up to 0.2 m thick (was 0.12). An optional dorsal fin stands up from
the middle of the back, anywhere fore and aft, up to 0.4 m tall and 0.5 m
long. The blades and the fin come last in the genome and
start switched off in genomes from before them, so those replay unchanged.
In the energy audit, random quadrupeds with all three on stayed under the
1 J/kg limit in water (worst 0.58). The same body with none of them gained
0.28, so the blades only shift the solver's noise.

**Biped walking** and **Quadruped walking** (targets): each uses its
template whatever plan is picked. Only the parts the template marks as
ground parts may touch the ground: the biped's feet and tail, the
quadruped's paws, toes, tail and fluke.
Any other part touching it is a fall, and the walk ends there. Settling is timed with the brain on, so
the creature can stand up. Scoring is the walking score up to the fall
(half max distance / T, half the last third's distance / (T/3)), plus
0.1 × the share of the time it stayed up, settling included. Random bipeds
all fall within half a second, so standing longer is the first thing to evolve.
Quadruped walking came after the plain Walking target's quadruped champion
crawled on its side, its body upright only 4% of the time. **Centaur
walking** is the same with the centaur template: hooves and tail only, and
the canned gaits (Scene: *Gait*, now with a lateral *pace*) drive its four
legs and the horse's back, never the human waist.

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

## Cooperation

A game for two that isn't in Sims' paper. Both creatures start side by side
behind a ball (0.35 m radius, 0.6 kg, about as heavy as the biggest
creature), 0.5 m apart, and a goal circle lies ahead (**Goal distance** 3 m,
**Goal size** 0.6 m radius). They share one score, so neither gains by
getting in the other's way. Getting the ball into the goal ends the game and
scores 1 + the share of the time left, so a fast goal is worth nearly 2.
Short of a goal, 0.8 of the score is how far the ball got toward the goal's
edge and 0.2 is how much of the distance to the ball the two closed. Without
that last part, random creatures that never touch the ball all score 0 and
evolution has nothing to climb.

**Together bonus** (default 0.2) rewards teamwork directly: that share of the
score goes to the share of the game (until a goal or the end) that both
creatures spend touching the ball at once, and the parts above are shrunk to
make room: (1 − w) of them plus w × time together. A goal still scores at
least 1 and no goal at most 1. The HUD shows `both on it` as a percentage.
Runs from before this setting have it at 0.

They sense the ball with the photosensor that follows the light or the
prize. In cooperation the second photosensor, which otherwise points at the
opponent, points at the goal, so each creature knows where to push. The start
zone and relaxing rules are the competition's. Lifespan is 15 s. Pairing works
as in competition: with one population, each creature plays with the
population's previous best; with **Two teams**, two species each play with the
other's previous best. Show *Team B best* shows team B's side.

## Volley

A second game for two: the creatures face each other across a light ball
(0.25 m, 0.15 kg), 1.5 m from it on either side as in competition, and share
one score for passing it back and forth for 20 s. A **pass** is a touch by
one creature after the other's, with the ball at least 0.5 m from where it
was when the other last touched it; both on the ball at once is a scrum, and
the touch after it doesn't count. Each pass is a point. Before the first,
they can earn up to 0.75: 0.25 for each creature that touches the ball and
0.25 for how much of the distance to it the two closed. The ball rolls, so
passes are mostly along the ground rather than true volleys. The HUD counts
passes; Teams works as in cooperation.

## Wrestling, stairs and lifting

**Wrestling**: two creatures face each other across a 0.1 m gap (start zones
0.05 m either side of the middle, Sims' slope), both scaled to the same
volume, with no ball. Each photosensor sees the opponent. It's sumo: a ring
(**Ring radius**, 2 m) is drawn around the middle, and the score compares
how far each one's centre of mass ever got outside it during the 20 s
(or outside its own start, for a tall body that Sims' start zone puts
further back than the ring):
1 + (how far you got out − how far I did) / 1 m, plus 0.5 × the difference
in average distance from the middle in ring radii, capped to 0–2. Without
the centre term, standing apart at the edges was a sure draw and evolved
wrestlers barely moved. On top, both get 0.5 × the share of the bout they
spend touching each other (**Contact bonus**). With the centre term alone
and a 1 m gap, evolved wrestlers still never met: they won by drifting to
the middle while the other wandered out on its own. Walking
straight through takes both out the far side, a draw, so staying in and
shoving the other out is what wins. Two earlier rules, the pair's midpoint
moving toward the opponent and then distance pushed back from the start,
both evolved wrestlers that walked straight past each other. Evolved all vs. best like competition,
with Teams. The bundled champion (generation 49 of 100, seeded from the competition
champion, picked by round-robin) shoves its opponent 0.3–0.5 m out of the
ring from either side; with the champion taken away, the same opponent
stays in.

**Stairs**: the creature starts in a pit at the bottom of a square stepped
amphitheatre, so it can climb in any direction. The pit clears the
creature's widest point by 0.3 m; **Step height**, **Step depth** and
**Steps** are in the scene panel (0.15 m, 0.4 m, 12). The top step is a
10 m plateau, so a creature that climbs over the top stays up there rather
than falling off the far side. The score is half the
centre of mass's rise plus half the lowest part's final height: standing up
tall earns a little, and every part has to get up the steps to earn the
rest. The HUD shows the lowest part's height.

**Lifting**: when measuring starts, a barbell appears 0.3 m beyond the
creature's furthest point, lying across its path where its photosensors can
see it: a bar 1.2 m long between two square plates 0.4 m high, so the bar
is 0.2 m off the ground and a part can get under it (0.3 kg in all; the
scene's Prize, Size and Mass, Size being the plates' half-height). The
plates are square, like hex dumbbells, because round ones rolled away when
pushed. The score is the barbell's height off the ground averaged over the
last second of 15, so it has to be held up, not kicked, plus up to 0.2 for
closing on it. There is no grip: a creature has to hook or scoop the bar.
A light cube (Prize: cube) is the original object; with it, evolution found
only propping it against the body (6 cm). The bundled champion (150
generations) topples onto the barbell, scoops it up on one limb and carries
it level about 0.5–0.9 m up for the rest of the bout.

## Both sides

Rapier solves contacts in a fixed order, so the two creatures in a game
aren't quite equal: in wrestling, a creature playing a copy of itself won
2–0 every time from the first side. Evolution always plays the creature
being scored first, so it learned to exploit that, and the median creature
"beat" the previous best outright. With **Both sides** (default, scene
panel) every two-creature game is played twice with the order swapped and
the scores averaged, which makes a mirror match exactly 1–1. It doubles the
evaluation time. Replays show the first side, so a replay's final score can
differ from the averaged fitness. Runs from before the setting score one
side.

## Reflexes and balance

Random bipeds and quadrupeds used to flop: heads drooped onto the ground and
most bodies sagged to under half their height within a second. There were
three reasons. Creatures had no sense of which way was up. Muscles were off
while settling. And the numerical cap on muscle torque (a joint's lightest-case
inertia × 150 rad/s²) let a leg use only about a tenth of its strength.

- **Balance sensors** (17–22 on every part): the direction of up in the
  part's frame (a level part reads 0, 1, 0), and its spin about its own
  axes. The brain can wire them into its own feedback loops.
- **Reflexes**: three fixed feedback loops at every joint, each with an
  evolvable gain from 0 to 1 (`node.reflex = [tone, level, brace]`):
  *tone* pulls the joint back toward its built angle (within its limits);
  *level* turns the part toward its built orientation to gravity, cancelling
  the parent's tumbling, so a head holds its view while the body moves;
  *brace* rights the part it hangs from, so planted legs hold the trunk up.
- Reflexes run on **Rapier's joint motors**, not explicit torques. Each joint
  is given a target turning rate, blended from the three loops by their
  gains, and the motor applies whatever torque that takes, up to the
  muscle's strength. Motors are solved implicitly, so they stay stable on
  very light legs under a heavy body, where explicit torques had to stay
  under a tenth of a leg's strength. They use Rapier's force-based model,
  because the acceleration-based one didn't hold a load. They reach full
  force at 0.2 rad/s off their target rate; at 0.05 rad/s they were nearly
  rigid, and the solver gained energy at impacts.
- Reflexes run from the start, settling included, except during Sims'
  relax-until-still settling, where all muscles are off by design. The brain's
  own muscle commands are unchanged.
- **Energy audit**: Rapier doesn't report a motor's torque, so a motor is
  credited its most (full force × turning rate) while the joint turns the way
  the motor drives it. That can only make the audit lenient on reflex joints,
  never fail an honest one. With reflexes, 0–2 in 40 random bipeds and
  quadrupeds failed the audit, about the same as without (1 in 40).

In tests on 16 random bipeds with the brain silent, 13 had fallen after one
second without reflexes and 1 with full reflexes, and the bodies kept about
two-thirds of their height instead of under 40%. Holding a posture isn't
balancing, though: most random bipeds still topple within 5 s, and many
random quadrupeds settle pitched onto their head or rump because their legs
grew to different lengths. Evolution has to find bodies and brains that
balance. Genomes from before reflexes have none and replay unchanged.

**Muscles and joints** (Scene panel, every creature, old ones included; the
defaults are the usual values): *Strength* ×, minimum *Tone*, *Level* and
*Brace* for every joint (raise them to stiffen any creature, whatever its
genes say), *Joint range* (every limit cut to within this many radians of the
built angle; small ranges stop legs circling like paddlewheels, which is
what surface swimmers did), passive *Damping*, and the reflexes' speeds.
With each set hard (all three reflex minimums at 1, strength ×4, range 0.5,
damping 0), random walkers kept passing the energy audit.

## Joints, anatomy and falls

**Joints held by the physics engine.** The joint limits used to be
inelastic stops this project applied by hand, sized for the lightest case. A
body's weight pushed legs up to 3 rad past them, and the champion insect's
ball-jointed legs went right round, 126 times in one walk: it rolled on its
joints. Now each joint is built in its own frame, so Rapier's axes are our
twist and two bend axes, and Rapier holds the limits. In a stress test every
joint type stayed within 0.05 rad. The Scene setting *Joints* chooses
*limited* (the default), *rolling* (twist axes spin freely, like wheels and
axles, with the bends still limited) or *old*. Saved runs and champions from
before keep *old*, so they replay as they evolved. Under *limited*, the
champion insect scores 0.01 instead of 0.44, without its rolling gait. One
known gap: with three free axes at large combined angles (ball joints),
Rapier's per-axis angles and ours part, so a loaded ball joint can sit past
our limit by up to 1.5 rad. The anatomical templates below use no ball joints
in limbs.

**Anatomy** (animal templates):
- hips, shoulders, necks, ankles and wrists bend two ways (universal joints,
  no twist); knees and elbows only hinge (revolute);
- snakes have two degrees of freedom at every joint;
- bipeds and quadrupeds have a bendable trunk: a pelvis or hindquarters, a
  spine of 1–4 two-way segments (a human torso to an otter) and a chest. For
  a quadruped the spine grows forward from the hindquarters, so the chest,
  forelegs and head keep the orientation the one-piece body had; for a biped
  it grows up from the pelvis, and the chest's head and arms hang as before;
- an insect's or crab's body is one solid piece (abdomen and tail fused);
- an arachnid's abdomen moves on its own two-way joint and carries the tail;
- every template has feet: paws, toes, feet and tails as before, lower legs
  for insects, arachnids, crustaceans (claws too) and centipedes, and every
  part of a snake.

**Falls** (Scene: *Falls end a walk*, on for new runs; Walking, Standing,
Biped and Quadruped walking): a walk ends when a new part other than the
feet touches the ground (parts already resting on it when measuring starts,
like a dragging abdomen, are posture), the root tilts more than 60° from its
built uprightness (35° for bipeds: an upright walker's trunk shouldn't lean
further), or the centre of mass drops below 60% of its starting height. A
biped's tail is a prop, not a foot: one evolved to lean back slowly and sit
on its tail, which counted its 0.5 m lean as walking. Nothing after a fall counts: the score is the time spent standing up
to the fall, plus the speed only up to 2 seconds before it, so the topple
itself never pays (a tall biped can lean for over a second before it passes
60°; half a second, at first, wasn't enough). The simulation also runs 2
seconds past the measured time: nothing then counts, but a fall still does,
so a lunge or topple begun just before the end doesn't pay. Distances count
net of the centre of mass's drop. The biped champion stood still for 9 s and
fell over backwards in the last second, which was most of its score (0.28);
under these rules it scores 0.12, nearly all for standing.

**Friction** (Scene, up to 20) is a coefficient between bodies and the
ground; the default is now 3, grippier than rubber on a rough surface, so
bodies can't skid around as easily and standing is easier. Runs keep what
they had (1, then 2). Measured at the contact points of evolved walkers,
though, feet slide about as much at friction 10 as at 2 (0.13–0.45 m/s
while touching): the sliding comes from feet that carry little weight, which
no coefficient grips, more than from the coefficient.

**Speed is net distance** (Scene: *Speed*, new runs; every speed target:
walking, swimming, surface swimming, biped and quadruped walking). Speed is
the straight line from start to finish (or to a fall's rollback point) over
the time, less any drop and sliding. Rocking back and forth or circling nets
nothing; only going somewhere counts. Sims' formula, half the furthest it got
from the start and half the final third's distance, paid for a lean out and
back, or a rock caught at the right moment; saved runs keep it. Champions
that travel lose little: the swimmer keeps 91% of its score, the insect 95%.

**Head first** (Scene, new runs): animals (templates) on land score only for
distance in the direction they faced when measuring began, so walking
rump-first or sideways earns nothing. The first quadruped to walk (run
quadruped-9304, 3.2 m in 10 s) went rump-first, dragging its front feet; it
moved 2.45 m backwards along its facing, and under this rule its score falls
from 0.45 to 0.20 (standing and steps). Free, bilateral and radial bodies
have no front and may go any way.

**Skiing** (target): sliding is good here, so the sliding rule is off. Every
foot (a template's feet, paws, lower legs and claws; otherwise the parts on
the ground as built) gets a ski, a 60 cm plank pointing the creature's way,
fixed to the foot. The snow is slippery, but a ski on the snow grips
sideways on its edge: its sideways velocity is taken out, up to the weight
the touching skis share (Coulomb on the edge, so it only removes energy).
That lets a skier steer, and on the flat skate by pushing off an edge. The
hill is gravity tilted downhill on flat ground, so placement, falls and
reflexes work unchanged, and the view tilts the picture to make the ground a
slope. Everything that stays up accelerates alike, so air drag (*Air drag*,
on frontal area) makes tucking low and narrow pay. A ski on the snow is felt
on its foot's underside. Random creatures slid 4–9 m in 10 s, with no energy
gain.

The first winners gamed it: a quadruped skied with its head dragging on the
snow as a third runner (14.8 m), and an insect sledged on its belly, its
skis down only a third of the time. Now only the skis and their feet may
touch the snow, with no allowance for parts resting on it at the start; a
creature that does is fallen, and scores only for standing. Under that rule
the best of the first runs is a biped that rides its skis the whole way
(8.1 m in 10 s).

**Walking is falling forward and catching yourself.** A beginner takes a
step or two and falls, and rolling the score back 2 s erased exactly those
first steps, so there was nothing to climb toward but standing still or
sliding. Now a step counts: a foot (a paw and its toes are one) that leaves
the ground for 0.15 s and lands at least 2 cm further along the creature's
way than where it lifted (forward along its facing, for animals; further
from the start, for other bodies). Counting any 5 cm step at first,
creatures marched in place for the bonus; a marching biped that took 27
"steps" now takes none and scores only for standing. On a fall, the
score keeps its progress up to the last step, unless that came more than 2 s
before the fall; a pure topple still earns nothing. Steps also earn a bonus
of their own (Scene: *Step bonus*, 0.1 × the share of 20 steps taken);
stepping in place no longer counts.

**The brain drives through the motors.** Reflexes hold a pose with the
muscle's full strength on Rapier's motors, but the brain's torques were
capped at a tenth of it, so the reflexes held the legs still and the brain
could only wiggle them. The best biped of a 30-generation run never lifted a
foot: its feet slid 8–13 cm while its body crept 0.29 m, and two-thirds of
its score was the standing bonus. In new runs, a reflexed joint's command
moves the reflexes' set point: from the standing pose by up to half the
joint's range each way, within its limits, and the motor takes the joint
there at full strength, the command outweighing level and brace. A silent
brain stands; an oscillating one swings the legs around the standing pose.
Random quadrupeds and arachnids now take the odd step, where none did.

**Creeping feet** (fixed). Creatures standing still with their brains
silent slid along: quadrupeds drifted up to 0.45 m in 10 s, with paws in
constant contact sliding even at friction 5. Two causes. Reflexes aimed at
the built pose, which a body standing on several feet can't reach exactly,
so the joints fought each other through the ground; once measuring starts,
reflexes now hold the pose the creature stands in (getting up and knocked
down still aim at the built pose). And Rapier solves friction at the
velocity level, one pass per substep by default, which leaves a little
sliding under a steady sideways load each step. New scenes use four passes
(about 30% slower): 9 in 12 silent quadrupeds stay up, instead of 4, and most
drift a few centimetres; the worst still creeps about 1 cm/s, which the
sliding rule below discounts. Runs from before keep one pass.

**Sliding isn't walking.** Each step, the slowest foot on the ground is the
creature's anchor, and however far the anchor itself slides is subtracted
from its progress. A planted foot slides nowhere, so walking and shuffling
lose nothing; when every foot skids at once, as when a quadruped swinging a
heavy weight on its trunk slid along sideways, the skid doesn't count.
Airborne phases count, and snakes are exempt (slithering is sliding). Blades
(fluke, trunk tip, dorsal fin) must also be flat: one of their two cross
dimensions stays under 6 cm (evolution picks which, a fin or a fluke).
Before, a "blade" could grow into a 0.45 m block, a weight to swing.

**Knocked down** (target): "I get knocked down, but I get up again". The
pendulum is aimed through the creature's centre of mass and arrives at about
6 m/s; it's drawn as a ball on a rope, and eyes see it coming. Its energy is
added to the energy audit when it's hung and taken off when it's removed. In
tests it knocked over about 7 in 16 standing random quadrupeds and 3 in 16
bipeds, and no insects (low and wide, they get shoved but don't tip), with no
audit failures in 48 runs. Scene: *Pendulum mass*.

Evolution found two ways out: dodging the ball, and taking the hit propped
on a tail. So the ball is now bigger (0.35 m) and aimed 0.15 m above the
centre of mass, to tip rather than shove (10 in 16 random quadrupeds go
over); standing counts only real feet (feet, paws, toes, lower legs, claws:
propped on a tail isn't standing); and a creature never knocked over (tilted
past 60°, or below 60% of its height, after the strike) keeps only half its
score, since getting back up is the point. Heavier balls knocked over few
more and broke the energy audit (2–3 in 16), so the mass stays at 2.

**Standing first.** Walking adds a standing bonus, weighted by the Scene
setting *Standing bonus* (0.1 by default): half the share of the time it
stayed up, half how tall it stood as measuring began. Raise it to make
standing pay first, then lower it as gaits appear; or evolve the
**Standing** target first and seed a walking run from its champion with
*Evolve from this*. Animal templates in new runs settle standing, reflexes
on, as biped and quadruped walking always did, instead of Sims'
relax-until-still. In tests on 12 random creatures of each plan under these
rules, insects, arachnids and crustaceans stood 70–89% of the time and
quadrupeds 52%; random bipeds all fell at once, and score by how tall they
stood.

## Eyes, proprioception and a learning brain

- **Eyes**: two on the head (an animal's head part, else its chest; for
  other bodies, the part furthest forward and up near the middle; the root,
  the first fallback, put a headless biped's eyes on its pelvis), drawn
  as white eyes with pupils. Where they sit is an evolvable trait,
  `genome.eyes.spread` (0–1): at 0 they're on the front of the head, gazing
  10° off straight ahead; at 1 they're on the sides, gazing straight out.
  Each eye is a retina of 5 × 3 rays covering 80° × 50° out to 5 m. Side
  eyes see almost all round; front eyes overlap. The trade-off is depth:
  - each eye alone (banks 0 and 1) sees whether something is there, with
    only a coarse sense of distance (near, middle or far), and whether it's
    the prize or another creature;
  - the binocular bank (2) is a 5 × 3 grid looking straight ahead (50° ×
    50°), wired from the overlap of the two fields. A pixel both eyes see
    gets the true nearness (1 at the eyes, 0 at range) and the prize flag; a
    pixel outside the overlap reads 0. Front eyes fill the whole grid, eyes
    gazing 30° out fill its middle, and eyes gazing more than 40° out none.

  That's 90 inputs any neuron can read (source `e`). A mirrored part reads
  the other eye, and the binocular grid flipped left to right, so mirror
  twins see mirror images. Rays are cast only for brains that read the eyes,
  and refresh at 30 Hz.
- **Proprioception** (sensors 23–28 on every part): each joint axis's
  turning rate, and its muscle's effort (the brain's torque as a share of
  the muscle's strength), alongside the joint angles (0–2).
- **Hebbian learning**: a neuron can have a learning rate (gene `hebb`, about
  30% of new neurons, negative = anti-Hebbian). Its input weights then change
  during the creature's life by Oja's rule, dw = rate × post × (pre − post ×
  w): inputs that fire with it grow stronger, and the weights stay bounded.
  Only neurons that are firing learn, so in random brains most synapses stay
  put.
- **Keep learned weights** (Evolution panel, on by default; `LAMARCK=0` turns
  it off on the command line): what a brain's Hebbian synapses learn carries from each trial to the
  next, and is written back into its genome after the test (averaged over a
  gene's copies), so survivors keep it and offspring inherit it. That's
  Lamarckian inheritance. Off, every life starts from the weights it was born
  with; runs saved before the setting existed keep it off.
- **A bigger brain**: up to 8 neurons per part (was 4) and 16 global neurons
  (was 4), room for a central network that the eyes and body senses feed.

Old genomes have none of these and replay unchanged (all 24 champions
checked).

**Replays match their scores.** With learned weights kept, the genome
written back after a life (what offspring inherit) isn't the one that
earned its score, and run files saved that one: a winner replayed from the
weights it ended its life with, and a quadruped that scored 0.66 replayed at
0.23. The history now keeps each winner's genome as it was scored.

**Getting up** (target): the creature starts lying on its side, on its back
or sitting, pitched back 60° with its rump down (Scene: *Start*), and has to
stand and stay standing. Its reflexes already pull toward the standing pose,
since level and brace aim at the built orientation, not the start pose.

## Surface swimming

Sims' water has no gravity and no surface. Surface swimming adds both: the
creature floats in water whose density (Scene: *Buoyancy*, default 1.5 × the
creatures') holds it about two thirds under. Its speed counts only
horizontally, so leaping and diving are allowed but only pay if they carry it
along. Buoyancy acts on a 3×3×3 grid of sample points inside each part, each
carrying an equal share of the part's volume. A point's buoyancy fades in over
the top 5 cm of water, which makes it a conservative force with a potential,
and the energy audit counts that potential. Viscous drag uses the face samples
of deep-water swimming, scaled by how far under water each one is, so parts in
the air move freely. A face whose centre is under water triggers its contact
sensor, so a creature can feel the surface. Creatures start at the depth a
uniform box would float at and settle for 2 s with their muscles off before
measuring starts.

## Two teams

In competition and cooperation, **Teams** (Evolution panel) chooses who a
creature plays against or with.
*One population* (default) is the self-play used so far: everyone plays the
population's own best of the previous generation. *Two teams* is Sims'
interspecies competition: two species that never interbreed or migrate, each
scored against the other team's best of the previous generation, so each
keeps adapting to whatever the other is doing. Both teams have the run's
population size, islands and settings, and evolve side by side (a generation
takes twice as long).

The run's history, generation list and Show *Best* follow team A, shown as
the orange creature against team B's previous best; Show *Team B best* shows
team B's best the same way. The generation list and the best readout give
both teams' scores (`1.12 · B 1.05`), and the chart adds team B's best and
mean in lilac. Scores are shares of a bout (they sum to 2), so a team doing
better than 1 is beating the other's previous best. Mate island bests mates
each team's islands among themselves. One population and two teams are
separate runs, like body plans: switching Teams (while paused) keeps the other
setting's run to come back to, and a new one starts in the current scene.
Save and Load keep both teams.

**Team B** (shown with two teams) gives team B its own body plan, so different
animals evolve against or with each other: snake v insect, crustacean v
arachnid, a radial creature v a biped. It defaults to *same plan*. Radial uses
the Arms count, and Round parts and Min arm apply to both teams. Each team
stays within its own plan. When the run is seeded from a creature (Evolve from
this), team B starts from random creatures if that creature isn't in team B's
plan. Each team B plan is a separate run, and labels name the plans (`team A
(snake) best, against team B (insect)'s best of generation 4`). Before the first
generation, the view shows a random creature of each plan.

## Canned gaits and hands

**Quadruped gaits** (Scene: *Gait*; quadrupeds walking on land). A central
pattern generator drives each hip (its fore-aft axis) and knee in a fixed
footfall pattern, in place of the brain, which keeps the spine's sideways
bend, the neck, the tail and the hips' splay for balance:

| Gait | Footfalls | Duty | Strides/s |
|---|---|---|---|
| walk | four-beat: LH, LF, RH, RF; three feet down at a time | 0.7 | 1.0 |
| trot | diagonal pairs together | 0.5 | 1.6 |
| canter | three-beat: RH, then LH with RF, then the leading LF | 0.45 | 1.8 |
| gallop | transverse (a horse's): RH LH, then RF LF | 0.4 | 2.2 |
| run | rotary (a cheetah's): LH RH, then RF LF, the back flexing | 0.35 | 2.6 |

In stance a foot sweeps back from forward; in swing the knee folds the foot
back under the body while the hip carries it forward. Which joint axis
swings each leg forward, and which way folds a knee, is read from the body
as it stands. Each swing is centred and cut to fit the joint's limits (an
evolved hip stood at its limit), and the motors lead with the pattern's own
speed: chasing the error alone, a hip lagged its stride by about 60°. Evolution
fits the body, and a trait (genome.gait: stride rate ×0.6–1.6, hip swing
0.15–0.6 rad, knee lift 0.3–1.2 rad, back flex) fits the gait to it. Muscle
strength scales with a limb's cross-section, so thin legs evolved for a
brain that barely lifted them can't swing a gait: such a body follows it
at ×10 strength (correlation 0.92–0.99), not at ×1.

**Hands** (biped template; arms are optional). Each arm ends in a palm on a
two-way wrist, three fingers of two or three hinged segments that close
toward the palm, and a thumb from the palm's side, angled across it, whose
base swings two ways (it opposes the fingers) and whose tip hinges. Fingers
are tiny next to a body, which solvers dislike, and at first two in three
handed bipeds blew up, fingers spinning about their length at up to
400 rad/s. Three standard fixes: digits are 10× as dense as the rest;
they get armature (extra turning inertia, 5× their largest principal
moment, as robot simulators add); and a hand's parts don't collide with
each other or their forearm (side by side, fingers touched every step).
Now none do. Genomes from before hands replay without them.

## Scene

The **Scene** panel sets the world a run is scored in:

- **Lifespan**: seconds each creature is scored for, after settling (blank =
  the target's default).
- **Gravity** and **Friction** on land; **Viscosity** in water.
- **Light distance** for following.
- **Settle** on land: *Sims: relax until still* (default; rule 1 above), or
  *timed, with friction* (this project's earlier fixed 0.5–1.5 s).
- Competition: the **Prize**, a ball (default) or Sims' cube, with its
  **Size** and **Mass**. The ball rolls, with a little rolling resistance, so
  creatures can push and dribble it. **Start distance** is where the start
  zone meets the ground. **Start zone**: *Sims' slope* (default; rules 4–5),
  with its **Slope** angle (90° = height doesn't count); *+ body length* (the
  contestant's longest dimension is added); or *none*. **Volume** (default 1 m³)
  with **Same size** (default) scales every contestant to exactly that
  volume, up or down, so neither a small nor a big body wins by its size;
  without Same size it only scales bigger ones down (runs from before the
  setting). **Wrap bonus** turns Sims' control bonus on or off. **Distance
  from**: *nearest part* (default) measures from each contestant's closest
  surface to the prize; *centre of mass* measures from its centre of mass to
  the prize's centre. Centre of mass was tried as the default and bred small,
  slow creatures, since a small body gets its centre closest. Competition's
  lifespan is 20 s (runs from before keep 10 s).

The scene belongs to the run: it is saved with it, recorded in each
generation's history, and used when that generation is replayed. Changing it
mid-run re-scores everyone from the next generation (the note says from which
generation scores aren't comparable), and replays the creature on screen in
the new scene straight away. Creatures saved before scenes existed replay in
the scene they evolved in (timed settling; a 0.8 m cube 1.5 m away).

**Examples ▸** replays example creatures, including hand-built tentacles.
**Evolve from this** starts a new run seeded with mutants of whatever creature
is on screen, with its body plan and target.

**Runs…** (under Save) opens any run in `runs/`, newest first, including the
command-line runs from `tools/evolve.mjs`: its generations, chart, island and
team B bests, and Evolve to carry on from where it stopped. **Load run…**
takes the same files from disk. Locally, `serve.py` lists the folder as it is
now. On GitHub Pages, the list is the committed `runs/index.json`
(`node tools/runsindex.mjs`), so run that before committing new runs.

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
node tools/runsindex.mjs                                       # -> runs/index.json, the Runs menu on GitHub Pages
node tools/champion.mjs runs/<task>-<seed>.json                # -> champions/<task>.json
node tools/inspect.mjs runs/<task>-<seed>.json [gen]           # morphology, brain, trajectory
node tools/energy.mjs  runs/<task>-<seed>.json [gen]           # energy audit (exploit check)
node tools/jointtest.mjs                                       # joint sensing/torque sign test
node tools/symtest.mjs / symdyn.mjs                            # body-plan symmetry checks
node tools/regress.mjs                                         # bundled champions unchanged?
node tools/cdp.mjs <url> out.png [waitMs] [js]                 # headless Chrome screenshot
```

Tasks: `swim surfaceSwim walk jump followWater followLand compete cooperate volley wrestle stairs lift biped quadruped`. Env: `ISLANDS=K`
(default 6; 1 = single population), `MIN_ARM=k`, `SEED_FROM=file`,
`SCENE='{"gap":4,"duration":15}'` (scene overrides, see `SCENE` in `src/sim.js`),
`LEGACY=1` (the old cube scene), `TEAMS=2` (competition between two
species; team B's history and population are saved as `rivalHistory` and
`rivalPop`), `TEAM_B=<plan>` (two teams with team B in another plan, e.g.
`TEAM_B=insect node tools/evolve.mjs compete 150 300 1 snake`); e.g.
`MIN_ARM=4 node tools/evolve.mjs swim 150 300 1 radial8 round`. Body plans for the
headless runner: `node tools/evolve.mjs walk 150 300 1 bilateral round` (plan
`free | bilateral | radialN | snake | quadruped | insect | arachnid | crustacean | centipede | biped`, then `round` to allow capsules and spheres;
`SEED_FROM=examples/tentacles.json` starts from mutants of a creature).

## Bundled champions

Evolved headlessly at population 300. The water champions evolved in a
single population (`tools/batch.sh`) and replay in the original scene. The
land champions were re-evolved under Sims' rules against falling over
(relaxed settling; in competition the diagonal start zone and wrap bonus),
with 6 islands, novelty 0.3 and 25% structural mutations
(`node tools/evolve.mjs <task> 150 300 7 [plan] [round]`, then
`tools/champion.mjs`). Every one replays exactly (`tools/regress.mjs`) and
passes the energy audit: peak unexplained energy ≤ 0.13 J/kg, except the
radial jumper's 0.71 J/kg (most of it on landing; at most 4 cm of its height).

| Target | Body plan | Generations | Result |
|---|---|---|---|
| Swimming | free | 150 | 0.68 m/s |
| Walking | free | 150 | 1.51 m/s |
| Jumping | free | 150 | lowest part 1.24 m up: two 1 m blocks on a hinge that fling themselves clear of the ground |
| Following (water) | free | 300 | 0.12–0.39 m/s closing, from all 8 test directions |
| Following (land) | free | 150 | 0.17–0.45 m/s closing from 7 of 8 directions (−0.08 from the eighth); chosen as the most robust of the last 20 generation bests, none of which may trip the energy audit in any of 24 runs |
| Competition | free, ball scene | 150 | 1.40 average in a round robin of every 10th generation's best (gen 59 edges it at 1.48 but only ties its bout); shown beating the next strongest 1.50 to 0.50 |
| Cooperation | free, two teams, from the competition champion | 60 | 1.42: the ball goes in at 8.8 s of 15; alone, neither scores a goal (0.61 and 0.71) |
| Swimming | radial ×5, round | 150 | 0.74 m/s |
| Swimming | bilateral, round | 150 | 0.63 m/s |
| Swimming | radial ×6, from the tentacle example | 150 | 0.67 m/s |
| Walking | radial ×5, round | 150 | 0.89 m/s |
| Walking | bilateral, round | 150 + 60 | 2.71 m/s: the earlier champion (2.69 m/s, 1.33 under the new rules) re-adapted for 60 generations; a fresh 150-generation run reached only 1.04 |
| Jumping | radial ×4, round | 150 | 0.78 m |
| Following (water) | bilateral, round | 100 | 0.12–0.20 m/s from all 8 directions |
| Walking | snake | 150 | 0.10 m/s: slithers 0.56 m in 10 s |
| Walking | insect | 150 | 0.44 m/s: 4.2 m on its legs, mandibles helping; stinger off |
| Walking | arachnid | 150 | 0.89 m/s: 8.8 m, body partly dragging; mandibles, pincers and tail off |
| Walking | crustacean | 150 | 0.78 m/s: 7.4 m on its legs, pincers and antennae touching down |
| Walking | centipede | 150 | 0.21 m/s: 1.1 m on its legs |
| Biped walking | biped | 200 | 0.28: a striding gait on its feet alone, upright the whole bout (0.9 m in 10 s); arms off |

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
- **Falling isn't moving** (a backstop to Sims' rules above, and the only
  defence in the timed settle): a tall creature that stays up through the
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
