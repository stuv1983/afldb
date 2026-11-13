#!/usr/bin/env bash
# AFLDB-ISSUE-350 rehearsal driver (streamanator, isolated cluster on 127.0.0.1:55619 only; no production or DEV database is touched).
# Run from anywhere:  bash rehearse350.sh <phase> ...      Heavy phases are wrapped by the CALLER in
#   flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3 bash rehearse350.sh <phase>
# Phases (each is independent, each writes raw logs under $EV/<phase>/):
#   facts       esbuild-bundle prod-facts-entry.mts once ($W/in/facts.mjs); the same artifact read production and DEV
#   base        a detached worktree of the UNFIXED base commit (de640826) sharing the candidate's node_modules
#   red         DB red = fresh snapshot copy; the nightly-shaped settle (season 2027, no row) on the UNFIXED base: expect 23503
#   green-a     DB a = fresh snapshot copy; the same settle on the fixed candidate: expect HALT season_row_missing, nothing written
#   open-a      the full plan -> apply -> verify -> state -> second-apply flow on DB a (rehearse-opening.inner.sh, UTC)
#   green-c     the same nightly-shaped settle on DB a AFTER the opening: expect it to reach the completeness gate
#   offseason   the off-season nightly on DB a after the opening: expect a clean committed no-op
#   tz          DB b = fresh copy with Australia/Melbourne as the database default; the full flow with a Melbourne read helper (O-3)
#   reverse     DB b after its opening: reversal refused while dependents exist is shown on DB a; reversal committed on DB b; digest back to baseline
set -u -o pipefail
export W=/mnt/ssd/afldb-rem-rollover-20261114 PORT=55619
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python
CAND="$W/cand"; BASE="$W/base"; EV="$W/evidence"; TMPL=afldb_v2_remrollover_tmpl_test
HERE="docs/v2/evidence/remediation-20261114/rollover"
DB_RED=afldb_v2_remrollover_red_test; DB_A=afldb_v2_remrollover_a_test; DB_B=afldb_v2_remrollover_b_test
mkdir -p "$EV"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/rehearse.log"; }
# IRAT <dir> <isolated-pg args...>: the guarded runner of the CANDIDATE, with <dir> as the repository the command runs in
IRAT() { local d="$1"; shift; (cd "$d" && node --import tsx "$CAND/tools/v2/isolated-pg.ts" "$@"); }
newdb() { IRAT "$CAND" create-db "$1" --template "$TMPL"; }
clean() { sed -E 's/\x1b\[[0-9;]*m//g; s#postgres(ql)?://[^ ]+#<dsn>#g'; }
vitest_in() { # <dir> <db> <test-file>
  IRAT "$1" run "$2" -- node node_modules/vitest/vitest.mjs run "$3" 2>&1 | clean
}

phase_facts() {
  mkdir -p "$W/in"
  (cd "$CAND" && node_modules/tsx/node_modules/.bin/esbuild "$HERE/prod-facts-entry.mts" --bundle --platform=node --format=esm --target=node22 \
     --external:postgres --outfile="$W/in/facts.mjs" --log-level=warning) && sha256sum "$W/in/facts.mjs"
}
phase_base() {
  [ -d "$BASE" ] && { say "base exists"; return 0; }
  git -C "$CAND" worktree add --detach "$BASE" de640826d13489c58392563e7ae1ff62403ed293 >/dev/null 2>&1 || return 1
  ln -s "$CAND/node_modules" "$BASE/node_modules"
  git -C "$BASE" rev-parse HEAD
}
gen() { (cd "$CAND" && python3 "$HERE/repro/gen350.py" "$1" "$2"); }
phase_red() {
  mkdir -p "$EV/red"; newdb "$DB_RED" || return 1
  gen A "$BASE/tests/integration/rem350-a.test.ts" || return 1
  vitest_in "$BASE" "$DB_RED" tests/integration/rem350-a.test.ts | tee "$EV/red/run-a.out"
  rm -f "$BASE/tests/integration/rem350-a.test.ts"
}
phase_green-a() {
  mkdir -p "$EV/green-a"; newdb "$DB_A" || return 1
  gen A "$CAND/tests/integration/rem350-a.test.ts" || return 1
  vitest_in "$CAND" "$DB_A" tests/integration/rem350-a.test.ts | tee "$EV/green-a/run-a.out"
  rm -f "$CAND/tests/integration/rem350-a.test.ts"
}
phase_open-a() { # FACTS_BUNDLE is the artifact built by phase facts
  FACTS_BUNDLE="$W/in/facts.mjs" IRAT "$CAND" run "$DB_A" -- bash "$HERE/rehearse-opening.inner.sh" "$EV/open-a" Etc/UTC 2>&1 | clean | tee "$EV/open-a.out"
}
phase_green-c() {
  mkdir -p "$EV/green-c"
  gen C "$CAND/tests/integration/rem350-c.test.ts" || return 1
  vitest_in "$CAND" "$DB_A" tests/integration/rem350-c.test.ts | tee "$EV/green-c/run-c.out"
  rm -f "$CAND/tests/integration/rem350-c.test.ts"
}
phase_offseason() {
  mkdir -p "$EV/offseason"
  gen N "$CAND/tests/integration/rem350-n.test.ts" || return 1
  vitest_in "$CAND" "$DB_A" tests/integration/rem350-n.test.ts | tee "$EV/offseason/run-n.out"
  rm -f "$CAND/tests/integration/rem350-n.test.ts"
}
phase_tz() {
  newdb "$DB_B" || return 1
  # the database default becomes Australia/Melbourne (production's host zone); the tools still pin Etc/UTC per connection
  IRAT "$CAND" run "$DB_B" -- node "$HERE/set-db-tz.mjs" AFLDB_OWNER_DATABASE_URL 2>&1 | clean
  FACTS_BUNDLE="$W/in/facts.mjs" IRAT "$CAND" run "$DB_B" -- bash "$HERE/rehearse-opening.inner.sh" "$EV/tz-b" Australia/Melbourne 2>&1 | clean | tee "$EV/tz-b.out"
}
phase_reverse() {
  mkdir -p "$EV/reverse"
  say "reversal refused on DB a (matches for the season exist after green-c)"
  IRAT "$CAND" run "$DB_A" -- node "$HERE/run-sql.mjs" "$HERE/reverse-opening.sql" AFLDB_OWNER_DATABASE_URL 2>&1 | clean | tee "$EV/reverse/on-a-with-dependents.out"
  say "reversal DRY RUN then COMMIT on DB b (opened, no dependents)"
  IRAT "$CAND" run "$DB_B" -- node "$HERE/run-sql.mjs" "$HERE/reverse-opening.sql" AFLDB_OWNER_DATABASE_URL 2>&1 | clean | tee "$EV/reverse/on-b-dry.out"
  IRAT "$CAND" run "$DB_B" -- node "$HERE/run-sql.mjs" "$HERE/reverse-opening.sql" AFLDB_OWNER_DATABASE_URL commit 2>&1 | clean | tee "$EV/reverse/on-b-commit.out"
  IRAT "$CAND" run "$DB_B" -- bash -c "node --import tsx tools/v2/season-opening-check.ts --dsn-env AFLDB_BACKUP_DATABASE_URL --json; echo rc=\$?" 2>&1 | clean | tee "$EV/reverse/check-after-reversal.out"
}
for ph in "$@"; do
  say "PHASE $ph start"; "phase_$ph"; rc=$?; say "PHASE $ph rc=$rc"
  [ "$rc" -eq 0 ] || exit "$rc"
done
