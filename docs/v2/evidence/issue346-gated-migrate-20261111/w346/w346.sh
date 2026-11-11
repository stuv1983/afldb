#!/usr/bin/env bash
# W-346 write-mode rehearsal driver (AFLDB-ISSUE-346). Runs ONLY inside $WS on streamanator, against a
# dedicated isolated cluster ($WS-pg, 127.0.0.1:$PORT) and marked afldb_v2_*_test databases.
# Usage: WS=/mnt/ssd/afldb-i346-... PORT=555xx bash w346.sh setup|cases|stop
set -uo pipefail
: "${WS:?}" "${PORT:?}"
[[ "$WS" == /mnt/ssd/afldb-i346-* ]] || { echo "refused: WS must be /mnt/ssd/afldb-i346-*"; exit 2; }
[[ "$PORT" =~ ^555[0-9][0-9]$ ]] || { echo "refused: PORT must be 55500-55599"; exit 2; }
CLONE="$WS/clone"; ORIGIN="$WS/origin.git"; KIT="$WS/kit"; SECRETS="$WS/secrets"
export AFLDB_V2_PG_ROOT="$WS-pg" AFLDB_V2_PG_PORT="$PORT" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
NODE_BIN="$HOME/.nvm/versions/node/v22.23.2/bin"
export PATH="$NODE_BIN:$PATH"
TPL=afldb_v2_i346t117_test
LOG="$WS/w346.log"
say() { echo "[w346] $*" | tee -a "$LOG"; }
ipg() { (cd "$CLONE" && "$NODE_BIN/npx" --no-install tsx tools/v2/isolated-pg.ts "$@"); }
fp() { ipg run "$1" -- "$NODE_BIN/node" "$KIT/fp.mjs" "$CLONE" "${@:2}" 2>>"$LOG"; }
# The effective target before every state-changing step: tool verify + server facts + guard.
prove() {
  local db="$1" facts
  ipg verify "$db" >>"$LOG" 2>&1 || { say "PROVE FAILED (verify) $db"; return 1; }
  facts="$(fp "$db" facts)" || { say "PROVE FAILED (facts) $db"; return 1; }
  say "PROVE $db $facts"
  [[ "$facts" == *'"listen":"127.0.0.1"'* && "$facts" == *"\"port\":\"$PORT\""* && "$facts" == *'"writeGuard":true'* && "$facts" == *'"cluster":"afldb_v2_isolated"'* ]]
}
dsn_file() { printf '%s/%s.dsn' "$SECRETS" "$1"; }
make_dsn() { ipg run "$1" -- /bin/sh -c 'umask 077; printf "%s" "$AFLDB_OWNER_DATABASE_URL" > "$0"' "$(dsn_file "$1")" 2>>"$LOG"; }

setup() {
  say "setup $(date -u +%FT%TZ) WS=$WS PORT=$PORT"
  if ss -ltn | grep -q ":$PORT "; then say "port $PORT busy"; exit 2; fi
  mkdir -p "$SECRETS" && chmod 700 "$SECRETS"
  # One isolated cluster.
  ipg init >>"$LOG" 2>&1 && ipg start >>"$LOG" 2>&1 && ipg roles >>"$LOG" 2>&1 || { say 'cluster setup failed'; exit 1; }
  say "cluster conf: $(grep -E "^(listen_addresses|port|cluster_name)" "$WS-pg/data/postgresql.conf" | tr '\n' ' ')"
  # Published origin: a bare copy of the reviewed commit as main.
  git clone -q --bare "$CLONE" "$ORIGIN" && git -C "$ORIGIN" update-ref refs/heads/main "$(git -C "$CLONE" rev-parse HEAD)"
  say "origin main $(git -C "$ORIGIN" rev-parse main)"
  # Template at 117: a non-Git copy of the reviewed tree without the 118 migration.
  mkdir -p "$WS/tpl117" && git -C "$CLONE" archive HEAD | tar -x -C "$WS/tpl117"
  rm -f "$WS/tpl117"/src/db/migrations/118_*.sql && cp -al "$CLONE/node_modules" "$WS/tpl117/node_modules"
  say "tpl117 migrations: $(ls "$WS/tpl117/src/db/migrations" | grep -c '\.sql$'), last $(ls "$WS/tpl117/src/db/migrations" | grep '\.sql$' | tail -1)"
  ipg create-db "$TPL" >>"$LOG" 2>&1 || { say 'template create failed'; exit 1; }
  template
}
template() {
  prove "$TPL" || exit 1
  ipg run "$TPL" -- "$NODE_BIN/npm" --prefix "$WS/tpl117" run db:migrate:test >>"$LOG" 2>&1 || { say 'template migrate failed'; exit 1; }
  say "TEMPLATE $(fp "$TPL" facts)"
  # Stubs: systemctl and curl never reach a live unit or health URL; npm logs every call and skips ci only.
  mkdir -p "$KIT/stubs"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "systemctl $*" >> "$CALLS"' 'case "$*" in' \
    '  *ExecStart*) echo "{ path=$(command -v node) ; argv[]=node deploy/server-cluster.mjs ; }" ;;' \
    "  *ActiveState*|'is-active'*) echo active ;;" '  *SubState*) echo running ;;' 'esac' 'exit 0' > "$KIT/stubs/systemctl"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "curl $*" >> "$CALLS"' \
    "out=''; while (( \$# )); do case \"\$1\" in --output) out=\"\$2\"; shift ;; esac; shift; done" \
    "printf '{\"status\":\"ok\",\"database\":\"ok\"}' > \"\$out\"; printf 200" > "$KIT/stubs/curl"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "npm $*" >> "$CALLS"' \
    "if [[ \"\${1:-}\" == ci ]]; then echo '[w346 stub] npm ci skipped (node_modules pre-installed)'; exit 0; fi" \
    "if [[ \"\$*\" == 'run db:migrate'* ]]; then" \
    '  echo "MIGRATE_CHILD args=[$*] exported_target=${AFLDB_MIGRATE_TARGET-<unset>} exported_owner_dsn=${AFLDB_OWNER_DATABASE_URL+set} exported_test_dsn=${AFLDB_TEST_DATABASE_URL+set}" >> "$CALLS"' \
    'fi' 'exec "$REAL_NPM" "$@"' > "$KIT/stubs/npm"
  chmod +x "$KIT/stubs"/*
  say 'setup done'
}

# --- per case -------------------------------------------------------------------------------------
RESULTS="$WS/results.tsv"
new_case() { # new_case <id>: fresh A/B from the template, sentinel in B, a fresh published origin and checkout
  C="$WS/cases/$1"; A="afldb_v2_i346${1}a_test"; B="afldb_v2_i346${1}b_test"
  mkdir -p "$C/evidence" "$C/backup"; : > "$C/calls"
  ipg create-db "$A" --template "$TPL" >>"$LOG" 2>&1 && ipg create-db "$B" --template "$TPL" >>"$LOG" 2>&1 || return 1
  prove "$A" && prove "$B" || return 1
  fp "$B" sentinel "i346-$1-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')" >/dev/null || return 1
  make_dsn "$A" && make_dsn "$B" || return 1
  git clone -q --bare "$ORIGIN" "$C/origin.git" && git clone -q "$C/origin.git" "$C/work" || return 1
  PIN="$(git -C "$C/work" rev-parse origin/main)"
  (cd "$C/work" && git switch -q -c dev-v2-main "$PIN~1" && git branch -q -u origin/main dev-v2-main) || return 1
  cp -al "$CLONE/node_modules" "$C/work/node_modules"
  (umask 077; printf 'AFLDB_OWNER_DATABASE_URL=%s\n' "$(cat "$(dsn_file "$A")")" > "$C/work/.env")
  mkdir -p "$C/work/.next/standalone/.next" && echo I346REHEARSAL > "$C/work/.next/standalone/.next/BUILD_ID"
  (cd "$C/work" && tar -cf "$C/backup/app.tar" .next/standalone/.next/BUILD_ID) && (cd "$C/backup" && sha256sum app.tar > SHA256SUMS-app)
  # Backup FIXTURE in the dev-backup-verify.sh layout (the gate's backup logic is not under test here).
  local stamp; stamp="$(date -u -d "@$(( $(date +%s) - 3600 ))" +%FT%TZ)"
  printf '{"label":"live","database":"%s","readAt":"%s","ledger":{"n":117,"last":"117_brownlow_provider_eligibility_unknown.sql"},"counts":{"fixture":1}}\n' "$A" "$stamp" > "$C/backup/live-counts.json"
  printf '{"label":"restored","database":"%s","readAt":"%s","ledger":{"n":117,"last":"117_brownlow_provider_eligibility_unknown.sql"},"counts":{"fixture":1}}\n' "$A" "$stamp" > "$C/backup/restored-counts.json"
  echo fixture > "$C/backup/db.dump"; (cd "$C/backup" && sha256sum db.dump > SHA256SUMS && echo 'pg_restore exit=0 seconds=0 (W-346 fixture)' > verify-restore.txt)
  git -C "$C/work" rev-parse HEAD > "$C/head.before"
}
publish() { # publish <branch> <file> <content>: commit on top of $PIN in the case checkout and push to its origin
  (cd "$C/work" && git switch -q -c i346-publish "$PIN" && printf '%s\n' "$3" > "src/db/migrations/$2" \
    && git add "src/db/migrations/$2" && git -c user.name=w346 -c user.email=w346@e.invalid commit -qm "W-346 $2" \
    && git push -q origin "HEAD:refs/heads/$1" && git switch -q dev-v2-main && git branch -q -D i346-publish && git fetch -q origin)
}
run_case() { # run_case <id> <expected rc> <expected text> [NAME=value ...]; hostile exports come from HOSTILE
  local id="$1" erc="$2" text="$3" kv name value rc now ok=PASS why=''
  shift 3
  now="$(date +%s)"
  sed -e "s#/__PROJECT__#$C/work#g" -e "s#/__EVIDENCE__#$C/evidence#g" -e "s#/__BACKUP__#$C/backup#g" -e "s#/__ORIGIN__#$C/origin.git#g" \
    "$KIT/gen-w346.sh" > "$C/run.sh"
  for kv in "AFLDB_PF_EXPECTED_REVISION=$PIN" "AFLDB_PF_EXPECTED_DATABASE=$A" "AFLDB_PF_WINDOW_START=$((now - 600))" \
            "AFLDB_PF_WINDOW_END=$((now + 3600))" 'AFLDB_PF_ACCEPTANCE=ok:200' "$@"; do
    name="${kv%%=*}"; value="${kv#*=}"
    sed -i -e "s#^${name}=.*\$#${name}='${value}'#" "$C/run.sh"
  done
  # Payload guard: nothing live, nothing restarting, nothing building, no placeholder left.
  if grep -qE '/home/arm/projects/afldb|/mnt/ssd/afldb/records|__PROJECT__|__EVIDENCE__|__BACKUP__|__ORIGIN__|sudo|^kill |^npm run build' "$C/run.sh" \
      || ! grep -q "^AFLDB_PF_SERVICE='afldb-i346-rehearsal'$" "$C/run.sh"; then say "PAYLOAD GUARD FAILED $id"; return 1; fi
  prove "$A" || return 1
  (cd "$C" && env -i HOME="$HOME" USER="$USER" LANG=C.UTF-8 PATH="$KIT/stubs:$NODE_BIN:$AFLDB_V2_PG_BIN:/usr/local/bin:/usr/bin:/bin" \
     NVM_DIR="$C/no-nvm" CALLS="$C/calls" REAL_NPM="$NODE_BIN/npm" "${HOSTILE[@]}" bash "$C/run.sh" > "$C/out" 2>&1); rc=$?
  git -C "$C/work" rev-parse HEAD > "$C/head.after"
  fp "$A" facts > "$C/a.after"; fp "$B" facts > "$C/b.after"
  local child=no; grep -q '^MIGRATE_CHILD' "$C/calls" && child=yes
  (( rc == erc )) || { ok=FAIL; why+="rc $rc != $erc; "; }
  grep -qF -- "$text" "$C/out" || { ok=FAIL; why+="text missing; "; }
  grep -q "^RESULT exit=$erc " "$C"/evidence/*.txt 2>/dev/null || { ok=FAIL; why+="no RESULT exit=$erc; "; }
  cmp -s "$C/b.before" "$C/b.after" || { ok=FAIL; why+="B changed; "; }
  ! grep -q '^npm run build' "$C/calls" || { ok=FAIL; why+="build ran; "; }
  if [[ "$erc" != 0 ]]; then
    [[ $child == no ]] || { ok=FAIL; why+="child ran; "; }
    cmp -s "$C/a.before" "$C/a.after" || { ok=FAIL; why+="A changed; "; }
    cmp -s "$C/head.before" "$C/head.after" || { ok=FAIL; why+="checkout moved; "; }
  fi
  CASE_OK="$ok"; CASE_WHY="$why"; CASE_RC="$rc"; CASE_CHILD="$child"
}
record() { printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$CASE_RC" "$CASE_CHILD" "$CASE_OK" "${CASE_WHY:-}" | tee -a "$RESULTS" >> "$LOG"; }
case_begin() {
  CASE_OK=FAIL; CASE_WHY='run_case did not complete'; CASE_RC=-; CASE_CHILD=-
  new_case "$1" || { say "CASE SETUP FAILED $1"; printf '%s\t-\t-\t-\tFAIL\tsetup\n' "$1" >> "$RESULTS"; return 1; }
}
snap() { fp "$A" facts > "$C/a.before"; fp "$B" facts > "$C/b.before"; }
mig118() { ls "$CLONE/src/db/migrations" | grep '^118_'; }

cases() {
  [[ -s "$KIT/gen-w346.sh" ]] || { say 'missing kit/gen-w346.sh'; exit 2; }
  printf 'case\texpected_rc\trc\tmigration_child\tresult\tnotes\n' > "$RESULTS"
  local m ev blob t; m="$(mig118)"
  HOSTILE=()
  # W1: the approved transition applies exactly 118 to A; B unchanged; evidence recorded.
  if case_begin w1; then snap
    run_case w1 0 'PASS post-migration parity -- 118/118'
    ev="$(cat "$C"/evidence/*.txt)"
    blob="$(git -C "$C/work" cat-file blob "$PIN:src/db/migrations/$m" | sha256sum | cut -d' ' -f1)"
    grep -q '"ledgerN":118' "$C/a.after" && grep -q "\"ledgerLast\":\"$m\"" "$C/a.after" || { CASE_OK=FAIL; CASE_WHY+='A not at 118; '; }
    [[ "$(sed 's/.*"ledger117Hash":"\([0-9a-f]*\)".*/\1/' "$C/a.after")" == "$(sed 's/.*"ledgerHash":"\([0-9a-f]*\)".*/\1/' "$C/a.before")" ]] || { CASE_OK=FAIL; CASE_WHY+='first 117 rows changed; '; }
    grep -q "\"lastChecksum\":\"$blob\"" "$C/a.after" || { CASE_OK=FAIL; CASE_WHY+='118 checksum != blob; '; }
    [[ "$(grep -c '^MIGRATE_CHILD' "$C/calls")" == 1 ]] && grep -q '^MIGRATE_CHILD args=\[run db:migrate -- --target dev\] exported_target=<unset> exported_owner_dsn= exported_test_dsn=$' "$C/calls" || { CASE_OK=FAIL; CASE_WHY+='child line; '; }
    [[ "$(cat "$C/head.after")" == "$PIN" ]] || { CASE_OK=FAIL; CASE_WHY+='head != pin; '; }
    for t in 'INFO planned mutation steps -- checkout install migrate health (migration-only route, AFLDB-ISSUE-346' \
             'PASS migration target is the assessed database' 'PASS migration set is one db:migrate accepts -- 118 well-formed' \
             "PASS database identity -- $A afldb_owner" "PASS approved migration transition -- 117 -> 118 (pending $m)" \
             'PASS pre-migration revalidation' 'PASS post-migration parity -- 118/118' 'PASS preserved state after deploy' 'RESULT exit=0 '; do
      grep -qF -- "$t" <<<"$ev" || { CASE_OK=FAIL; CASE_WHY+="evidence lacks: $t; "; }
    done
    if grep -q 'pre-restart revalidation' <<<"$ev"; then CASE_OK=FAIL; CASE_WHY+='restart revalidated; '; fi
    grep -q 'serving BUILD_ID (not rebuilt): I346REHEARSAL' "$C/out" || { CASE_OK=FAIL; CASE_WHY+='build label; '; }
    record w1 0
  fi
  # X1: AFLDB_TEST_DATABASE_URL=B alone is not a refusal: --target dev never reads it; A advances, B unchanged.
  if case_begin x1; then snap
    HOSTILE=("AFLDB_TEST_DATABASE_URL=$(cat "$(dsn_file "$B")")")
    run_case x1 0 'PASS post-migration parity -- 118/118'
    HOSTILE=()
    grep -q '"ledgerN":118' "$C/a.after" || { CASE_OK=FAIL; CASE_WHY+='A not at 118; '; }
    grep -q 'exported_target=<unset> exported_owner_dsn= exported_test_dsn=set$' "$C/calls" || { CASE_OK=FAIL; CASE_WHY+='child line; '; }
    record x1 0
  fi
  # Refusals: exit 40, no migration child, A and B unchanged, checkout not moved.
  if case_begin r01; then snap; run_case r01 40 "unapproved pending: $m" AFLDB_PF_LEDGER_BEFORE= AFLDB_PF_LEDGER_AFTER=; record r01 40; fi
  if case_begin r02; then snap; run_case r02 40 'ledger has 117, approval expects 116 before' AFLDB_PF_LEDGER_BEFORE=116; record r02 40; fi
  if case_begin r03; then snap; run_case r03 40 'target has 118, approval expects 119 after' AFLDB_PF_LEDGER_AFTER=119; record r03 40; fi
  if case_begin r04; then snap; HOSTILE=("AFLDB_OWNER_DATABASE_URL=$(cat "$(dsn_file "$B")")")
    run_case r04 40 'AFLDB_OWNER_DATABASE_URL is exported in the deploy shell'; HOSTILE=(); record r04 40; fi
  if case_begin r05; then snap; HOSTILE=(AFLDB_MIGRATE_TARGET=test "AFLDB_TEST_DATABASE_URL=$(cat "$(dsn_file "$B")")")
    run_case r05 40 'AFLDB_MIGRATE_TARGET is exported in the deploy shell'; HOSTILE=(); record r05 40; fi
  if case_begin r06; then snap; HOSTILE=("AFLDB_OWNER_DATABASE_URL=$(cat "$(dsn_file "$B")")" AFLDB_MIGRATE_TARGET=test "AFLDB_TEST_DATABASE_URL=$(cat "$(dsn_file "$B")")")
    run_case r06 40 'AFLDB_MIGRATE_TARGET is exported in the deploy shell'; HOSTILE=(); record r06 40; fi
  if case_begin r07; then snap; (umask 077; printf 'AFLDB_OWNER_DATABASE_URL=%s\n' "$(cat "$(dsn_file "$B")")" > "$C/work/.env")
    run_case r07 40 "connected to '$B', expected '$A'"; record r07 40; fi
  if case_begin r08; then snap; run_case r08 40 "connected to '$A', expected 'afldb_dev'" AFLDB_PF_EXPECTED_DATABASE=afldb_dev; record r08 40; fi
  if case_begin r09; then snap; run_case r09 40 "on 'streamanator', expected 'elsewhere'" AFLDB_PF_EXPECTED_HOST=elsewhere; record r09 40; fi
  if case_begin r10; then prove "$A" && fp "$A" tamper >/dev/null; snap
    run_case r10 40 'checksum differs from the target revision'; record r10 40; fi
  if case_begin r11; then snap; echo '<!-- W-346 local edit -->' >> "$C/work/README.md"
    run_case r11 40 'FAIL working tree holds only permitted operational files'; record r11 40; fi
  if case_begin r12; then snap; run_case r12 40 'is not a commit here after the fetch' AFLDB_PF_EXPECTED_REVISION=0123456789abcdef0123456789abcdef01234567; record r12 40; fi
  if case_begin r13; then publish release-i346 119_i346_branch_local.sql 'SELECT 1;' \
      && (cd "$C/work" && git branch -q -u origin/release-i346 dev-v2-main); snap
    run_case r13 40 '119_i346_branch_local.sql is branch-local (not on origin/main)' AFLDB_PF_EXPECTED_UPSTREAM=origin/release-i346 \
      "AFLDB_PF_EXPECTED_REVISION=$(git -C "$C/work" rev-parse origin/release-i346)" AFLDB_PF_LEDGER_AFTER=119; record r13 40; fi
  if case_begin r14; then publish main 118_i346_collide.sql 'SELECT 1;'; snap
    run_case r14 40 "migration number 118 is claimed by $m and 118_i346_collide.sql" \
      "AFLDB_PF_EXPECTED_REVISION=$(git -C "$C/work" rev-parse origin/main)" AFLDB_PF_LEDGER_AFTER=119; record r14 40; fi
  if case_begin r15; then publish main 119_i346_next.sql 'SELECT 1;'; snap
    run_case r15 40 'the target is missing 119_i346_next.sql from origin/main'; record r15 40; fi
  say "results: $(awk -F'\t' 'NR>1 && $5=="PASS"' "$RESULTS" | wc -l) PASS, $(awk -F'\t' 'NR>1 && $5!="PASS"' "$RESULTS" | wc -l) FAIL"
}

stop() { ipg stop >>"$LOG" 2>&1; say "cluster stopped: $(ss -ltn | grep -c ":$PORT " || true) listener(s) on $PORT"; }

case "${1:-}" in setup) setup ;; template) template ;; cases) cases ;; stop) stop ;; *) echo 'usage: setup|cases|stop'; exit 2 ;; esac
