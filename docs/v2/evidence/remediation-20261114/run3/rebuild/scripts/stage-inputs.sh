#!/usr/bin/env bash
# Verify candidates (read-only), copy ONLY verified inputs into the checkout's gitignored data/, chmod a-w, re-verify.
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-rebuild-20261114
C=$W/cand
DEV=/home/arm/projects/afldb/data
PKG=/mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z/package/data
V=$W/verify-inputs.mjs
E=$W/evidence
mkdir -p "$E"

echo "== pre-copy: DEV data (read-only) =="
node $V $C $DEV --detail > $E/inputs-precopy-dev.txt 2>&1 || true
cat $E/inputs-precopy-dev.txt | cut -c1-260
echo "== pre-copy: i316 rebuild package (read-only) =="
node $V $C $PKG --detail > $E/inputs-precopy-i316pkg.txt 2>&1 || true
cat $E/inputs-precopy-i316pkg.txt | cut -c1-260

# Per-input source decision (DEV first per the brief; the retained host workspace only where DEV lacks a VERIFIED copy).
verified() { grep -E "^$2	VERIFIED" "$1" > /dev/null; }
S=$C/data/sources
mkdir -p $S/afl_api/rosters $S/afltables/club_lists $S/afltables/coaches $S/afltables/fitzroy_core $S/draftguru $C/data/records

cp_dir() { # src dest
  if [ -e "$2" ]; then echo "REFUSE: $2 exists"; exit 3; fi
  cp -r "$1" "$2"
}
verified $E/inputs-precopy-dev.txt afl-api-rosters   && cp_dir $DEV/sources/afl_api/rosters/rosters-20260905 $S/afl_api/rosters/rosters-20260905
verified $E/inputs-precopy-dev.txt club-lists        && cp_dir $DEV/sources/afltables/club_lists/club-lists-20260905 $S/afltables/club_lists/club-lists-20260905
verified $E/inputs-precopy-dev.txt draftguru-stage-a && cp_dir $DEV/sources/draftguru/annual-html-20260826 $S/draftguru/annual-html-20260826
verified $E/inputs-precopy-dev.txt first-kick-goal   && cp $DEV/records/first-kick-goal.csv $C/data/records/first-kick-goal.csv
verified $E/inputs-precopy-dev.txt coaches           && { mkdir -p $S/afltables/coaches/coaches-20260905; cp -r $DEV/sources/afltables/coaches/coaches-20260905/raw $S/afltables/coaches/coaches-20260905/raw; }
verified $E/inputs-precopy-i316pkg.txt fitzroy-core    && cp_dir $PKG/sources/afltables/fitzroy_core/c2-2026-final-core-v1 $S/afltables/fitzroy_core/c2-2026-final-core-v1
verified $E/inputs-precopy-i316pkg.txt ladder-witness  && cp_dir $PKG/sources/afltables/fitzroy_core/c2-2026-final-ladder-v1 $S/afltables/fitzroy_core/c2-2026-final-ladder-v1
verified $E/inputs-precopy-i316pkg.txt coaches-raw-bundle && cp $PKG/sources/afltables/coaches/coaches-20260905/coaches-20260905-raw.tar $S/afltables/coaches/coaches-20260905/coaches-20260905-raw.tar

chmod -R a-w $S $C/data/records/first-kick-goal.csv
echo "== post-copy verification (destination) =="
node $V $C $C/data --detail --list $E/inputs-files.sha256 | tee $E/inputs-postcopy.txt | cut -c1-300
echo "rc=$?"
wc -l $E/inputs-files.sha256
cd $C && git status --porcelain | head
