#!/usr/bin/env bash
# hostops ISSUE-352 rehearsal: the scheduled-backup wrapper over backup.sh and restore-test.sh against the ISOLATED cluster
# (port 55620), a production-snapshot copy as the source. Never production, never DEV's 5432, never ~/backups/afldb.
# Plan review H-1/H-2/H-4: explicit directories under $W, explicit isolated DSNs (via isolated-pg run), run from a checkout
# proven to hold no .env, the resolved target logged first, no systemctl enable/start, nothing under ~/.config/systemd.
# Usage: W=/mnt/ssd/afldb-rem-hostops-20261114 bash rehearse-352.sh
set -u -o pipefail
: "${W:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=55620
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
CAND="$W/cand"; R="$W/rehearsal"; EV="$W/evidence/r352"; mkdir -p "$EV" "$R"
TMPL=afldb_v2_remhostops_tmpl_test; SRC=afldb_v2_remhostops_src_test
BK="$R/backups"; OFF="$R/offhost"; PULL="$R/pulled"
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/rehearsal.log"; }
T() { local s=$(date +%s); "$@"; local rc=$?; say "  elapsed $(( $(date +%s) - s ))s rc=$rc"; return $rc; }
SCRIPT="$CAND/tools/maintenance/scheduled-backup.sh"

say "== guards"
[ -e "$CAND/.env" ] && { say "REFUSED: $CAND holds an .env file (.env.example is the tracked template and is fine)"; exit 1; }
say "checkout $(cd "$CAND" && git rev-parse HEAD) .env files: none"
ss -ltn | awk '{print $4}' | grep -E ":$PORT$" || { say "REFUSED: nothing listens on $PORT"; exit 1; }
say "isolated cluster listening on 127.0.0.1:$PORT (DEV 5432 is never named)"
[ "$BK" != "$HOME/backups/afldb" ] && say "backup dir $BK (not the DEV ~/backups/afldb)"

say "== databases"
IR list 2>&1 | tail -5
(IR create-db "$SRC" --template "$TMPL" 2>&1 | tail -2) || true
(cd "$CAND" && node "$W/in/mk-restore-db.mjs") 2>&1 | tee -a "$EV/rehearsal.log"
say "isolated-pg create-db refuses afldb_restore_test: $(cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts create-db afldb_restore_test 2>&1 | tail -1)"

rm -rf "$BK" "$OFF" "$PULL"; mkdir -p "$OFF" "$PULL"
export AFLDB_BACKUP_DIR="$BK"

say "== 1. status before any backup must FAIL"
bash "$SCRIPT" status; say "  status rc=$? (expect 1)"

say "== 2. backup (real backup.sh, afldb_backup role, isolated source copy)"
T RUNDB "$SRC" bash "$SCRIPT" backup 2>&1 | tee "$EV/backup1.log" | sed 's/^/    /'
ls -la "$BK" "$BK/.state" | tee "$EV/backup1.ls"
(cd "$BK" && sha256sum -c ./*.dump.sha256)

say "== 3. verify (fresh dump + real restore-test.sh into afldb_restore_test on the isolated cluster)"
T RUNDB "$SRC" bash "$SCRIPT" verify 2>&1 | tee "$EV/verify1.log" | sed 's/^/    /'
bash "$SCRIPT" status; say "  status rc=$? (expect 0)"

say "== 4. off-host push to a local stand-in directory (copy + sha256 + pg_restore --list + retention)"
AFLDB_OFFHOST_DEST="$OFF" AFLDB_OFFHOST_KEEP=2 T RUNDB "$SRC" bash "$SCRIPT" backup 2>&1 | sed 's/^/    /'
ls -la "$OFF"
(cd "$OFF" && sha256sum -c ./*.dump.sha256)

say "== 5. off-host PULL run (offhost-pull.sh) from the backup dir into a separate directory"
T bash "$CAND/tools/maintenance/offhost-pull.sh" "$BK" "$PULL" --keep 3 2>&1 | sed 's/^/    /'
say "  second pull is a no-op:"; bash "$CAND/tools/maintenance/offhost-pull.sh" "$BK" "$PULL" --keep 3 2>&1 | sed 's/^/    /'
say "  a corrupted source dump is quarantined at the destination and fails the run:"
bad="$BK/afldb_v2_remhostops_src_test-99990101-000000.dump"; head -c 4096 "$(ls -1 "$BK"/*.dump | head -1)" > "$bad"
( cd "$BK" && sha256sum "$(basename "$bad")" > "$(basename "$bad").sha256" ); echo tamper >> "$bad"
bash "$CAND/tools/maintenance/offhost-pull.sh" "$BK" "$PULL" --keep 3 2>&1 | sed 's/^/    /'; say "  pull rc=${PIPESTATUS[0]} (expect 1)"
ls -la "$PULL" "$PULL/quarantine"; rm -f "$bad" "$bad.sha256"; rm -f "$PULL/quarantine/"*

say "== 6. failure handling: a wrong backup-role password fails the run, writes FAILED, status fails; success clears it"
RUNDB "$SRC" env AFLDB_BACKUP_DATABASE_URL="postgresql://afldb_backup:wrong@127.0.0.1:$PORT/$SRC" bash "$SCRIPT" backup 2>&1 | sed 's/^/    /'
say "  wrapper rc=${PIPESTATUS[0]} (expect 1); FAILED: $(cat "$BK/.state/FAILED")"
bash "$SCRIPT" status | sed 's/^/    /'
RUNDB "$SRC" bash "$SCRIPT" backup > /dev/null 2>&1; say "  recovery backup rc=$?; FAILED present: $([ -f "$BK/.state/FAILED" ] && echo yes || echo no)"

say "== 7. concurrency: a second run while one holds the lock exits 75 without a marker"
( exec 9> "$BK/.state/lock"; flock -n 9 && { bash "$SCRIPT" backup > /dev/null 2>&1; say "  second run rc=$? (expect 75)"; } )

say "== 8. sizes"
du -sh "$BK" "$OFF" "$PULL"; ls -la "$BK"/*.dump | awk '{print $5, $9}'
say "== done"
