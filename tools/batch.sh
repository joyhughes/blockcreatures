#!/bin/zsh
# Re-evolve every bundled champion: tools/batch.sh  (takes about an hour)
cd "$(dirname "$0")/.."
export ISLANDS=1 NOVELTY=0 STRUCT=0   # as the bundled champions were evolved (Sims' single population)
run() {  # task gens pop seed [plan] [round]
  local tag="$1-$4${5:+-$5}${6:+-$6}"
  node tools/evolve.mjs "$@" 2>&1 | grep -v deprecat > runs/$tag.log
  node tools/champion.mjs runs/$tag.json 2>&1 | grep -v deprecat
}
for t in swim walk jump compete; do run $t 150 300 2; done
for t in followWater followLand; do run $t 300 300 5; done
run swim 150 300 1 radial5 round
run walk 150 300 1 radial5 round
run swim 150 300 1 bilateral round
run walk 150 300 1 bilateral round
run jump 150 300 1 radial4 round
run followWater 100 300 1 bilateral round
SEED_FROM=examples/tentacles.json node tools/evolve.mjs swim 150 300 1 radial6 round 2>&1 | grep -v deprecat > runs/swim-1-radial6-round-seeded.log
node tools/champion.mjs runs/swim-1-radial6-round-seeded.json 2>&1 | grep -v deprecat
echo batch done
