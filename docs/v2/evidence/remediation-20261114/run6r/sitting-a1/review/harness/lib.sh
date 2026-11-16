#!/usr/bin/env bash
# Packet 6R sitting harness (local, Git Bash). No network, no production, no DEV. Each block runs exactly as at the sitting
# (`tr -d '\r' < block | bash -s -- args`) after ONLY these textual substitutions (fixed host paths -> case sandbox, and three
# external programs -> stubs). Everything else in the block is byte-identical; see subst() below.
set -uo pipefail
H=/mnt/ssd/afldb-r6r-harness-20261116
REPO=/mnt/ssd/afldb-rem5-t2-20261115/cand
SIT=$H/sitting
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; H0=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade; PREP=611630e41f3f27391173615d961c0ab5e1ea7810
OLD_ID=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x; OLD_PREV=0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN
STAMP=20261117T230000Z
RAW=$H/raw; mkdir -p "$RAW"

subst() { # $1 block path, $2 output path
  # /mnt/ssd/ first: $HT itself lives under /mnt/ssd/, so a later pass would rewrite the inserted paths again.
  sed -e "s#/mnt/ssd/#$HT/ssd/#g" \
      -e "s#/home/arm/\.nvm/versions/node/v22\.23\.2/bin#$HT/bin#g" \
      -e "s#/home/arm/projects/afldb#$HT/chk#g" \
      -e "s#/home/arm/afldb-releases#$HT/rel#g" \
      -e "s#/home/arm/b1a-r6r-#$HT/home/b1a-r6r-#g" \
      -e "s#/home/arm/backups/#$HT/home/backups/#g" \
      -e "s#/home/arm/b1-build-#$HT/home/b1-build-#g" \
      -e "s#bash tools/maintenance/backup\.sh#bash $HT/bin/backup.sh#g" \
      -e "s#bash deploy/post-install-check\.sh#bash $HT/bin/post-install-check.sh#g" \
      -e "s#bash \"\$W/art/b1a0/b1a0-dev-restore-verify\.sh\"#bash \"$HT/bin/verify-stub.sh\"#g" \
      "$1" > "$2"
}

ensure_origin() { # bare origin + one prod-like checkout shared by all cases (reset per case)
  if [ ! -d "$H/origin.git" ]; then
    git clone -q --bare --shared "$REPO" "$H/origin.git"
    git -C "$H/origin.git" fetch -q "$H/r6r.bundle" "+refs/heads/*:refs/bundle/*"
    git -C "$H/origin.git" update-ref refs/heads/main "$PREP"
    git -c core.autocrlf=false clone -q --shared "$H/origin.git" "$H/chk"
    git -C "$H/chk" config core.autocrlf false
  fi
}

newcase() { # $1 case name; fresh sandbox, checkout reset to $2 (default CP), origin main at $3 (default PREP)
  CASE=$1; HT=$H/cases/$CASE; export HT
  rm -rf "$HT"; mkdir -p "$HT/bin" "$HT/home/backups" "$HT/ssd" "$HT/rel/releases"
  cp "$H/stubs/node" "$H/stubs/psql" "$H/stubs/pg_restore" "$HT/bin/"; bash "$H/stubs/misc.sh" "$HT/bin"; chmod +x "$HT/bin"/*
  : > "$HT/calls.log"; export STUB_ACCEPT=$H/fixtures/accept-before.txt
  git -C "$H/origin.git" update-ref refs/heads/main "${3:-$PREP}"
  git -C "$H/chk" checkout -q -f -B main "${2:-$CP}"; git -C "$H/chk" clean -fdq
  git -C "$H/chk" update-ref -d refs/remotes/origin/main 2>/dev/null || true
  git -C "$H/chk" branch -q -u origin/main 2>/dev/null || true
  rm -f "$HT/chk"; ln -s "$H/chk" "$HT/chk" 2>/dev/null || cp -r "$H/chk" "$HT/chk"
  printf '%s\n' 'AFLDB_BACKUP_DATABASE_URL=postgres://afldb_backup:p%40ss@127.0.0.1:5432/afldb_prod' \
    'AFLDB_IMPORT_DATABASE_URL=postgres://afldb_import:x@127.0.0.1:5432/afldb_prod' 'AFLDB_BETA_GATE=on' 'AFLDB_BETA_EPOCH=1' 'PORT=3000' > "$H/chk/.env"
  for id in "$OLD_ID" "$OLD_PREV"; do mkdir -p "$HT/rel/releases/$id"; done
  ln -sfn "releases/$OLD_ID" "$HT/rel/current"; ln -sfn "releases/$OLD_PREV" "$HT/rel/previous"; echo '{"op":"seed"}' > "$HT/rel/events.log"
  mkdir -p "$H/chk/node_modules/tsx" "$H/chk/node_modules/postgres"; echo '{}' > "$H/chk/node_modules/tsx/package.json"; echo '{}' > "$H/chk/node_modules/postgres/package.json"
}

run() { # $1 block file (path; substituted copy is made), rest = args. Output -> $RAW/$CASE.txt ; sets RC
  local blk=$1; shift; subst "$blk" "$HT/$(basename "$blk")"
  { echo "### CASE $CASE  block=$(basename "$blk") sha256=$(sha256sum < "$blk" | cut -c1-16) args=$*"
    ( cd "$HT" && PATH="$HT/bin:$PATH" tr -d '\r' < "$HT/$(basename "$blk")" | PATH="$HT/bin:$PATH" bash -s -- "$@" ) 2>&1
    echo "### EXIT ${PIPESTATUS[0]}"; } > "$RAW/$CASE.txt"
  RC=$(sed -n 's/^### EXIT //p' "$RAW/$CASE.txt")
  { echo "### calls"; cat "$HT/calls.log"; } >> "$RAW/$CASE.txt"
}

expect() { # $1 description, $2 grep -E pattern that MUST appear in the case output, optional $3 pattern that must NOT appear
  local ok=1; grep -qE -- "$2" "$RAW/$CASE.txt" || ok=0
  [ -n "${3:-}" ] && grep -qE -- "$3" "$RAW/$CASE.txt" && ok=0
  if [ $ok = 1 ]; then echo "PASS  $CASE: $1"; else echo "FAIL  $CASE: $1"; fi | tee -a "$RAW/SUMMARY.txt"
}
