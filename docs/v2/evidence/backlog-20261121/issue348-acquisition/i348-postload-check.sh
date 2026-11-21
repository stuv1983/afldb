#!/usr/bin/env bash
# AFLDB-ISSUE-348: READ-ONLY post-load checks for the sealed DraftGuru reload of annual-html-20261122.
#
# PURPOSE
#   The owner accepted the rehearsed write set (F2-DECISION-REVIEW.md section 4). This script proves, from row-level
#   snapshots taken before and after the load, that the load changed exactly that set and nothing else:
#     * every F-2 change group (a)-(k): changed-row COUNT equals F2 section 4 AND the sha256 of the sorted changed-id
#       list equals a constant pinned below (derived from the rehearsal pre -> post pair; identical for reh1, reh2, reh3);
#     * the three owner club rulings (pick ids 5961, 6784, 6626) hold the exact owner bytes (zero-width spaces included);
#     * unchanged identity links: 0 changes to player_id / link status / match method on every pre-existing pick,
#       person and external identity; 31 new identities, all player_id NULL and unmatched;
#     * 0 inserted or deleted picks / persons; player_link_resolutions, players, data_edits, data_overrides unchanged;
#     * import_batches +1, the newest row completed, every older row unchanged;
#     * "only these columns changed": a per-row residual md5 over every column NOT listed in F2 section 4 is unchanged
#       for every row, and the set of rows whose whole-row md5 changed equals the union of the per-group changed ids.
#   NULL is never coerced to 0: snapshots carry COPY text with \N for NULL, and the NULL -> value transitions are counted.
#
# READ-ONLY GUARANTEE
#   `snap` opens ONE transaction BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY as role afldb_backup, with
#   default_transaction_read_only=on, statement_timeout and lock_timeout; it SELECTs only, then ROLLBACKs. A DO block
#   asserts the session role, database, read-only flag and isolation level before any data is read. The snapshot
#   files are written by psql \copy on THIS host into <outdir> (created 0700, must be empty). `compare` is offline
#   (awk/sort/sha256sum over the snapshot files only) and contacts no database. Nothing here retries, repairs or writes.
#   Connection strings are read from the env file into the child environment only: never argv, never printed.
#
# HOW IT COMPLEMENTS (does not replace) THE SEALED RUNNER
#   `i348-load.sh digest pre|post` proves whole-surface equality with the sealed expected-pre/expected-post md5 lines.
#   This script adds per-row evidence (which rows, which columns, what transitions) so a sitting can show the owner
#   exactly the accepted write set. It is NOT a precondition of the load and does not alter the runner's gates.
#
# PRODUCTION USAGE (host afldb-prod, user arm, no sudo; same defaults as the runner)
#   bash i348-postload-check.sh snap pre  /home/arm/ops/i348/postcheck/pre      # BEFORE:  bash i348-load.sh load
#   ... bash i348-load.sh load ; bash i348-load.sh digest post ...
#   bash i348-postload-check.sh snap post /home/arm/ops/i348/postcheck/post     # AFTER the sealed `digest post`
#   bash i348-postload-check.sh compare /home/arm/ops/i348/postcheck/pre /home/arm/ops/i348/postcheck/post
#   The snapshots are public historical draft data but are kept 0700; delete them when the sitting closes.
#   `derive <pre> <post>` prints the group table (name count sha256) that the pinned constants were taken from.
#
# REHEARSAL (no env file, never on afldb-prod): I348_REHEARSAL_SOCKET=<dir> I348_REHEARSAL_DB=<name ending _test>
#   [I348_REHEARSAL_PORT=<port, default 61540>] connects over that unix socket as afldb_backup.
#   Other overrides, as in the runner: I348_ENV_FILE, I348_EXPECT_DB, I348_EXPECT_HOST, I348_PGBIN.
#
# STATUS: lives outside the sealed set (not in i348-transfer.SHA256SUMS or SEALED-PLAN.md section 1); adding it
#   changes no sealed digest and the runner never calls it.
set -u -o pipefail
export LC_ALL=C
umask 077
ENV_FILE=${I348_ENV_FILE:-/home/arm/projects/afldb/.env}
EXPECT_DB=${I348_EXPECT_DB:-afldb_prod}
EXPECT_HOST=${I348_EXPECT_HOST:-afldb-prod}
PGBIN=${I348_PGBIN:-/usr/lib/postgresql/16/bin}
REH_SOCK=${I348_REHEARSAL_SOCKET:-}
REH_DB=${I348_REHEARSAL_DB:-}
REH_PORT=${I348_REHEARSAL_PORT:-61540}

step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD AFLDB_IMPORT_DATABASE_URL; echo "STOP: $1"; exit "${2:-20}"; }
envval() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
creds() {   # creds VAR ROLE: PG* for psql from the env file; refuses any other role or database
  local v; v=$(envval "$1"); [ -n "$v" ] || return 2
  [[ "$v" =~ $RE ]] || { unset v; return 3; }
  PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}
  PGPASSWORD=$(printf '%b' "${BASH_REMATCH[4]//\%/\\x}"); unset v BASH_REMATCH
  [ "$PGUSER" = "$2" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] || return 4
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}

# ---------------------------------------------------------------------------------------------------------------
# Pinned constants. Counts are F2-DECISION-REVIEW.md section 4. Digests are sha256 of the sorted changed-id list
# (one id per line, trailing newline; picks/persons ids numeric order, identity external_ids C-locale byte order),
# derived from the rehearsal pre (afldb_v2_b348_r0tpl_test) -> post (reh1, reh2, reh3) pairs, identical in all three.
# group-name  expected-count  sha256-of-sorted-changed-ids
PINNED='
persons.name_key 31 a66685b7111be05c62479baa6cb57640ba47d3736d5fc248bc98cb97a845a440
picks.source_record_id 1472 56026505c967409e52d5cde57b26cde2ad90cf684b3cb89d9c0cb548076298eb
picks.draft_age 101 9ae2d9fdd9656ae9b05317fd3e2c79006ecf883db42436f2c0afa0edebab67f5
picks.height_cm 8 7f6f594a4a69d3d9afb39d7b1db72aa6ee0e60d7f1c948cdb380fd2ee4228aa2
picks.reported_games 362 a896d2ebfb26b4cc5b2b3c83e5f0d4a6522165cbdb05d0f94ce4606c85abe659
picks.reported_goals 178 6d265024640eed06d8b582f61d7e5224708490d11bdbfa442b530ad0fb59451e
persons.reported_games 270 f099381c17d849c05e69ac60acce5db73e34b58b5a40dccb64a4cb5ebc250886
persons.reported_goals 138 adfb86e8b1925eae2f7a3433ee3167a78f0abf27238e3513af402943f069869f
picks.dg_person_id 6676 ca1948ee2c6e832e1062bbe97fc498f5c1975bfbd697b7acd679ad8b2502f0af
persons.dg_person_id 4967 ad085189b35d0795739da27f731aeaf6875ff6e9a0b29c78eb0920f7c32a1006
picks.confidence_notes 35 d0a1632b45d0bdeab5117b614b3e0e559b102e2507565fa15442173e3fe67591
persons.confidence_notes 31 a66685b7111be05c62479baa6cb57640ba47d3736d5fc248bc98cb97a845a440
picks.competition 35 d0a1632b45d0bdeab5117b614b3e0e559b102e2507565fa15442173e3fe67591
picks.original_club_raw 191 296c9f0659837207faa7675453a81710ab3849c7fe6e572b9a22bb4e79dd2b0a
idents.notes 5057 dbafa870296496734c2d9fb5354880a7ac546086688170a756302bbba958ef5c
picks.import_batch_id 6845 75f355702b2fb5408162ed447d2aa597e196fd6cdf27f126d51c9e50c87cd585
idents.inserted 31 76dc6b702ca0a3de6db1dfd50f6e0077ecec58fac7dce5fcd2fcc1a35cbb6b32
batches.inserted 1 -
'
# Identity notes label: md5 of "stage_a_snapshot=annual-html-20260826" (R0 state) and "...-20261122" (after the load).
NOTES_PRE_MD5=$(printf 'stage_a_snapshot=annual-html-20260826' | md5sum | cut -d' ' -f1)
NOTES_POST_MD5=6bfa2cb810037123270374475cddf58a
# Owner rulings (three-rows.json / reconciliation owner_rulings), original_club_raw as UTF-8 hex. The U+200B zero-width
# space (e2808b) follows every "/" in these values and is part of the owner's bytes.
HEX_5961_PRE=537572726579205061726b2fe2808b58617669657220436f6c6c6567652fe2808b4f616b6c6569676820553138
HEX_6784_PRE=537572726579205061726b2fe2808b58617669657220436f6c6c6567652fe2808b4f616b6c6569676820553138
HEX_6626_PRE=436f6c6c656769616e732fe2808b5765736c657920436f6c6c6567652fe2808b4f616b6c6569676820553138
HEX_5961_POST=4b657720526f766572732fe2808b58617669657220436f6c6c6567652fe2808b4f616b6c6569676820553138
HEX_6784_POST=4b657720526f766572732fe2808b58617669657220436f6c6c6567652fe2808b4f616b6c6569676820553138
HEX_6626_POST=537572726579205061726b2fe2808b5765736c657920436f6c6c6567652fe2808b4f616b6c6569676820553138

# ---------------------------------------------------------------------------------------------------------------
# snap: one read-only REPEATABLE READ transaction -> per-row TSV snapshots (COPY text format: NULL is \N).
# The SQL template is a single quoted block; each \copy is ONE physical line (psql requirement).
read -r -d '' SNAP_SQL <<'SQL'
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'Etc/UTC';
SET LOCAL extra_float_digits = 3;
DO $chk$ BEGIN IF current_user <> 'afldb_backup' OR current_database() <> '@DB@' OR current_setting('transaction_read_only') <> 'on' OR current_setting('transaction_isolation') <> 'repeatable read' THEN RAISE EXCEPTION 'i348 snap: unexpected session identity'; END IF; END $chk$;
\copy (SELECT t.id, t.player_url, t.draft_year, t.draft_kind, t.competition, md5(t.confidence_notes), t.dg_person_id, encode(convert_to(t.original_club_raw, 'UTF8'), 'hex'), t.source_record_id, t.reported_games, t.reported_goals, t.draft_age, t.height_cm, t.player_id, t.link_status_value, t.match_method, t.candidate_count, t.draft_person_id, t.import_batch_id, md5((to_jsonb(t) - ARRAY['import_batch_id','created_at','updated_at'])::text), md5((to_jsonb(t) - ARRAY['import_batch_id','created_at','updated_at','competition','confidence_notes','dg_person_id','original_club_raw','source_record_id','reported_games','reported_goals','draft_age','height_cm'])::text) FROM draft_picks t WHERE t.source_id = (SELECT id FROM sources WHERE key = 'draftguru') ORDER BY t.id) TO '@OUT@/picks.tsv'
\copy (SELECT t.id, t.player_url, t.name_key, t.dg_person_id, md5(t.confidence_notes), t.reported_games, t.reported_goals, t.player_id, t.link_status, t.match_method, t.candidate_count, t.is_matching_backlog, md5((to_jsonb(t) - ARRAY['import_batch_id','created_at','updated_at'])::text), md5((to_jsonb(t) - ARRAY['import_batch_id','created_at','updated_at','name_key','dg_person_id','confidence_notes','reported_games','reported_goals'])::text) FROM draft_persons t WHERE t.source_id = (SELECT id FROM sources WHERE key = 'draftguru') ORDER BY t.id) TO '@OUT@/persons.tsv'
\copy (SELECT t.external_id, t.player_id, t.status, t.match_method, t.candidate_count, md5(t.notes), md5((to_jsonb(t) - ARRAY['id','import_batch_id','created_at','updated_at'])::text), md5((to_jsonb(t) - ARRAY['id','notes','import_batch_id','created_at','updated_at'])::text) FROM external_identities t WHERE t.source_id = (SELECT id FROM sources WHERE key = 'draftguru') ORDER BY t.external_id COLLATE "C") TO '@OUT@/idents.tsv'
\copy (SELECT t.id, md5(to_jsonb(t)::text) FROM draft_picks t WHERE t.source_id IS DISTINCT FROM (SELECT id FROM sources WHERE key = 'draftguru') ORDER BY t.id) TO '@OUT@/nondg_picks.tsv'
\copy (SELECT t.id, (SELECT s.key FROM sources s WHERE s.id = t.source_id), t.tool, t.target_table, t.status, t.completed_at IS NOT NULL, t.records_read, t.records_inserted, t.records_updated, t.records_rejected, md5(t.notes), t.error IS NULL, md5(to_jsonb(t)::text) FROM import_batches t ORDER BY t.id) TO '@OUT@/batches.tsv'
\copy (SELECT * FROM (VALUES ('snap_kind', '@KIND@'), ('role', current_user), ('database', current_database()), ('read_only', current_setting('transaction_read_only')), ('isolation', current_setting('transaction_isolation')), ('server_version', current_setting('server_version')), ('snapshot_utc', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), ('plr_n', (SELECT count(*)::text FROM player_link_resolutions)), ('plr_md5', coalesce((SELECT md5(string_agg(to_jsonb(t)::text, chr(10) ORDER BY t.id)) FROM player_link_resolutions t), '-')), ('players_n', (SELECT count(*)::text FROM players)), ('players_md5', coalesce((SELECT md5(string_agg(to_jsonb(t)::text, chr(10) ORDER BY t.id)) FROM players t), '-')), ('data_edits_n', (SELECT count(*)::text FROM data_edits)), ('data_edits_md5', coalesce((SELECT md5(string_agg(to_jsonb(t)::text, chr(10) ORDER BY t.id)) FROM data_edits t), '-')), ('data_overrides_n', (SELECT count(*)::text FROM data_overrides)), ('data_overrides_md5', coalesce((SELECT md5(string_agg(to_jsonb(t)::text, chr(10) ORDER BY t.id)) FROM data_overrides t), '-')), ('import_batches_n', (SELECT count(*)::text FROM import_batches))) AS v(k, v)) TO '@OUT@/meta.tsv'
ROLLBACK;
SQL

snap() {
  local kind=${1:-} out=${2:-} db sql
  [ "$kind" = pre ] || [ "$kind" = post ] || stop "usage: snap pre|post <outdir>" 2
  [[ "$out" =~ ^/[A-Za-z0-9_./-]+$ ]] || stop "outdir must be an absolute path made of [A-Za-z0-9_./-]" 2
  if [ -e "$out" ] && [ -n "$(ls -A "$out" 2>/dev/null)" ]; then stop "outdir $out exists and is not empty (never overwrite a snapshot)" 2; fi
  if [ -n "$REH_SOCK$REH_DB" ]; then
    [ "$(hostname)" != afldb-prod ] || stop "the rehearsal override is refused on afldb-prod" 3
    [ -n "$REH_SOCK" ] && [ -n "$REH_DB" ] || stop "set BOTH I348_REHEARSAL_SOCKET and I348_REHEARSAL_DB" 2
    [[ "$REH_SOCK" =~ ^/[A-Za-z0-9_./-]+$ ]] && [ -d "$REH_SOCK" ] || stop "rehearsal socket directory invalid" 2
    [[ "$REH_DB" =~ ^[a-z0-9_]+_test$ ]] || stop "rehearsal database name must match ^[a-z0-9_]+_test$" 2
    [[ "$REH_PORT" =~ ^[0-9]+$ ]] || stop "rehearsal port must be numeric" 2
    unset PGPASSWORD
    export PGUSER=afldb_backup PGHOST=$REH_SOCK PGPORT=$REH_PORT PGDATABASE=$REH_DB PGCONNECT_TIMEOUT=10
    db=$REH_DB
  else
    [ "$(hostname)" = "$EXPECT_HOST" ] || stop "host is $(hostname), not $EXPECT_HOST" 3
    [ -r "$ENV_FILE" ] || stop "env file unreadable" 3
    creds AFLDB_BACKUP_DATABASE_URL afldb_backup || stop "backup DSN missing or not afldb_backup@$EXPECT_DB" 3
    db=$EXPECT_DB
  fi
  step "snap $kind -> $out (db $db)"
  mkdir -p -m 700 "$out" || stop "cannot create $out" 2
  chmod 700 "$out"
  sql=${SNAP_SQL//@OUT@/$out}; sql=${sql//@DB@/$db}; sql=${sql//@KIND@/$kind}
  printf '%s\n' "$sql" | PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=2000' \
    PGAPPNAME=afldb-i348-postcheck PGCLIENTENCODING=UTF8 "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -f - \
    || { unset PGPASSWORD; stop "snapshot query failed (transaction rolled back; nothing was written to any database)" 4; }
  unset PGPASSWORD
  printf 'snap_host\t%s\n' "$(hostname)" >> "$out/meta.tsv"
  local f
  for f in picks persons idents nondg_picks batches meta; do [ -s "$out/$f.tsv" ] || stop "snapshot file $f.tsv is empty" 4; done
  (cd "$out" && sha256sum picks.tsv persons.tsv idents.tsv nondg_picks.tsv batches.tsv meta.tsv > SHA256SUMS)
  echo "rows: picks=$(wc -l < "$out/picks.tsv") persons=$(wc -l < "$out/persons.tsv") idents=$(wc -l < "$out/idents.tsv") nondg_picks=$(wc -l < "$out/nondg_picks.tsv") batches=$(wc -l < "$out/batches.tsv")"
  echo "SNAP $kind OK"
}

# ---------------------------------------------------------------------------------------------------------------
# compare / derive: offline.
FAILS=0
ck() {   # ck <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS $1 (expected=$2)"; else echo "FAIL $1 expected=$2 actual=$3"; FAILS=$((FAILS + 1)); fi
}
metaval() { awk -F'\t' -v k="$2" '$1 == k { print $2; exit }' "$1/meta.tsv"; }
diffcols() {   # diffcols <tbl> <pre.tsv> <post.tsv> "<name>:<col> ..."  (appends name,id,pre,post to $T/chg.tsv)
  : > "$T/ins.$1"; : > "$T/del.$1"
  awk -F'\t' -v OFS='\t' -v tbl="$1" -v spec="$4" -v T="$T" '
    BEGIN { n = split(spec, sp, " "); for (i = 1; i <= n; i++) { split(sp[i], kv, ":"); nm[i] = kv[1]; cn[i] = kv[2] } }
    FNR == NR { pre[$1] = $0; next }
    { id = $1
      if (!(id in pre)) { print id > (T "/ins." tbl); next }
      seen[id] = 1; split(pre[id], a, "\t")
      for (i = 1; i <= n; i++) { c = cn[i]; if ((a[c] "") != ($c "")) print tbl "." nm[i], id, a[c], $c } }
    END { for (id in pre) if (!(id in seen)) print id > (T "/del." tbl) }' "$2" "$3" >> "$T/chg.tsv"
}
ids_of() { awk -F'\t' -v n="$1" '$1 == n { print $2 }' "$T/chg.tsv" | LC_ALL=C sort "$2" -u; }   # $2: -n (numeric) or -s
gcount() { ids_of "$1" "$2" | wc -l | tr -d ' '; }
gsha() { ids_of "$1" "$2" | sha256sum | cut -d' ' -f1; }
gstat() { awk -F'\t' -v n="$1" -v k="$2" '$1 == n && $2 == k { print $3; f = 1 } END { if (!f) print 0 }' "$T/stats.tsv"; }
pinned() { awk -v n="$1" -v c="$2" '$1 == n { print $c }' <<< "$PINNED"; }

compute() {   # compute <pre> <post>: fills $T with chg.tsv, stats.tsv, ins.*/del.*
  local pre=$1 post=$2
  : > "$T/chg.tsv"
  diffcols picks "$pre/picks.tsv" "$post/picks.tsv" \
    "competition:5 confidence_notes:6 dg_person_id:7 original_club_raw:8 source_record_id:9 reported_games:10 reported_goals:11 draft_age:12 height_cm:13 import_batch_id:19 key_url:2 key_year:3 key_kind:4 player_id:14 link_status:15 match_method:16 candidate_count:17 draft_person_id:18 row_md5:20 residual_md5:21"
  diffcols persons "$pre/persons.tsv" "$post/persons.tsv" \
    "name_key:3 dg_person_id:4 confidence_notes:5 reported_games:6 reported_goals:7 player_url:2 player_id:8 link_status:9 match_method:10 candidate_count:11 is_matching_backlog:12 row_md5:13 residual_md5:14"
  diffcols idents "$pre/idents.tsv" "$post/idents.tsv" \
    "player_id:2 status:3 match_method:4 candidate_count:5 notes:6 row_md5:7 residual_md5:8"
  diffcols nondg "$pre/nondg_picks.tsv" "$post/nondg_picks.tsv" "row_md5:2"
  diffcols batches "$pre/batches.tsv" "$post/batches.tsv" "row_md5:13"
  awk -F'\t' -v OFS='\t' '
    { n = $1; a = $3; b = $4; c[n]++
      if (a == "\\N" && b != "\\N") n2v[n]++; else if (a != "\\N" && b == "\\N") v2n[n]++; else v2v[n]++
      if (a == "\\N" && b == "0") n2z[n]++
      if (a ~ /^-?[0-9]+$/ && b ~ /^-?[0-9]+$/) { if (b + 0 < a + 0) dec[n]++; else if (b + 0 > a + 0) inc[n]++; if (b - a == -1) m1[n]++ }
      if (b == "AFL") toafl[n]++ }
    END { for (n in c) { print n, "count", c[n]; print n, "n2v", n2v[n] + 0; print n, "v2n", v2n[n] + 0; print n, "v2v", v2v[n] + 0
            print n, "n2z", n2z[n] + 0; print n, "inc", inc[n] + 0; print n, "dec", dec[n] + 0; print n, "minus1", m1[n] + 0; print n, "toafl", toafl[n] + 0 } }' \
    "$T/chg.tsv" > "$T/stats.tsv"
}

GROUPS_LIST='a|persons.name_key|-n
b|picks.source_record_id|-n
c|picks.draft_age|-n
d|picks.height_cm|-n
e1|picks.reported_games|-n
e2|picks.reported_goals|-n
e3|persons.reported_games|-n
e4|persons.reported_goals|-n
f1|picks.dg_person_id|-n
f2|persons.dg_person_id|-n
g1|picks.confidence_notes|-n
g2|persons.confidence_notes|-n
h|picks.competition|-n
i|picks.original_club_raw|-n
j2|idents.notes|-s
k1|picks.import_batch_id|-n'

derive() {
  local pre=${1:-} post=${2:-} line g name mode
  [ -d "$pre" ] && [ -d "$post" ] || stop "usage: derive <predir> <postdir>" 2
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  compute "$pre" "$post"
  while IFS='|' read -r g name mode; do echo "$name $(gcount "$name" "$mode") $(gsha "$name" "$mode")"; done <<< "$GROUPS_LIST"
  echo "idents.inserted $(wc -l < "$T/ins.idents" | tr -d ' ') $(LC_ALL=C sort -u "$T/ins.idents" | sha256sum | cut -d' ' -f1)"
  echo "batches.inserted $(wc -l < "$T/ins.batches" | tr -d ' ') $(LC_ALL=C sort -n -u "$T/ins.batches" | sha256sum | cut -d' ' -f1)"
}

compare() {
  local pre=${1:-} post=${2:-} f g name mode exp pin letter
  [ -d "$pre" ] && [ -d "$post" ] || stop "usage: compare <predir> <postdir>" 2
  for f in picks persons idents nondg_picks batches meta; do
    [ -s "$pre/$f.tsv" ] && [ -s "$post/$f.tsv" ] || { echo "FAIL snapshot file $f.tsv missing or empty"; echo "POSTLOAD RESULT FAIL"; return 1; }
  done
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  step "compare $pre -> $post"
  # 0. Snapshot integrity and provenance.
  ck "snapshot integrity pre (SHA256SUMS)" ok "$( (cd "$pre" && sha256sum --quiet -c SHA256SUMS >/dev/null 2>&1) && echo ok || echo BAD)"
  ck "snapshot integrity post (SHA256SUMS)" ok "$( (cd "$post" && sha256sum --quiet -c SHA256SUMS >/dev/null 2>&1) && echo ok || echo BAD)"
  ck "pre snapshot kind" pre "$(metaval "$pre" snap_kind)"
  ck "post snapshot kind" post "$(metaval "$post" snap_kind)"
  for f in pre post; do
    d=$pre; [ "$f" = post ] && d=$post
    ck "$f session role" afldb_backup "$(metaval "$d" role)"
    ck "$f transaction_read_only" on "$(metaval "$d" read_only)"
    ck "$f isolation" "repeatable read" "$(metaval "$d" isolation)"
  done
  compute "$pre" "$post"

  # 1. Row population: no inserts or deletes of picks / persons; identities +31; non-DraftGuru picks untouched.
  ck "picks pre count" 6845 "$(wc -l < "$pre/picks.tsv" | tr -d ' ')"
  ck "picks post count" 6845 "$(wc -l < "$post/picks.tsv" | tr -d ' ')"
  ck "picks inserted" 0 "$(wc -l < "$T/ins.picks" | tr -d ' ')"
  ck "picks deleted" 0 "$(wc -l < "$T/del.picks" | tr -d ' ')"
  ck "persons pre count" 5088 "$(wc -l < "$pre/persons.tsv" | tr -d ' ')"
  ck "persons post count" 5088 "$(wc -l < "$post/persons.tsv" | tr -d ' ')"
  ck "persons inserted" 0 "$(wc -l < "$T/ins.persons" | tr -d ' ')"
  ck "persons deleted" 0 "$(wc -l < "$T/del.persons" | tr -d ' ')"
  ck "identities pre count" 5057 "$(wc -l < "$pre/idents.tsv" | tr -d ' ')"
  ck "identities post count" 5088 "$(wc -l < "$post/idents.tsv" | tr -d ' ')"
  ck "identities deleted" 0 "$(wc -l < "$T/del.idents" | tr -d ' ')"
  ck "non-DraftGuru picks count (pre=post)" 8 "$(wc -l < "$post/nondg_picks.tsv" | tr -d ' ')"
  ck "non-DraftGuru picks changed rows" 0 "$(gstat nondg.row_md5 count)"

  # 2. Change groups (a)-(k): count (F2 section 4) and sha256 of the sorted changed-id list (pinned).
  while IFS='|' read -r letter name mode; do
    exp=$(pinned "$name" 2); pin=$(pinned "$name" 3)
    ck "group ($letter) $name changed-row count" "$exp" "$(gcount "$name" "$mode")"
    ck "group ($letter) $name changed-id sha256" "$pin" "$(gsha "$name" "$mode")"
  done <<< "$GROUPS_LIST"
  ck "group (j1) external_identities inserted count" "$(pinned idents.inserted 2)" "$(wc -l < "$T/ins.idents" | tr -d ' ')"
  ck "group (j1) external_identities inserted external_id sha256" "$(pinned idents.inserted 3)" "$(LC_ALL=C sort -u "$T/ins.idents" | sha256sum | cut -d' ' -f1)"
  ck "group (k2) import_batches inserted count" "$(pinned batches.inserted 2)" "$(wc -l < "$T/ins.batches" | tr -d ' ')"

  # 3. Transitions (NULL is never zero): where F2 states them.
  ck "(c) draft_age rows changed by exactly -1" 101 "$(gstat picks.draft_age minus1)"
  ck "(c) draft_age NULL->value" 0 "$(gstat picks.draft_age n2v)"
  ck "(c) draft_age value->NULL" 0 "$(gstat picks.draft_age v2n)"
  ck "(d) height_cm NULL->value" 6 "$(gstat picks.height_cm n2v)"
  ck "(d) height_cm value->value" 2 "$(gstat picks.height_cm v2v)"
  ck "(d) height_cm value->NULL" 0 "$(gstat picks.height_cm v2n)"
  ck "(e1) picks reported_games NULL->value" 35 "$(gstat picks.reported_games n2v)"
  ck "(e1) picks reported_games increases" 327 "$(gstat picks.reported_games inc)"
  ck "(e1) picks reported_games decreases" 0 "$(gstat picks.reported_games dec)"
  ck "(e2) picks reported_goals NULL->value" 35 "$(gstat picks.reported_goals n2v)"
  ck "(e2) picks reported_goals increases" 143 "$(gstat picks.reported_goals inc)"
  ck "(e2) picks reported_goals decreases" 0 "$(gstat picks.reported_goals dec)"
  ck "(e3) persons reported_games NULL->0" 31 "$(gstat persons.reported_games n2z)"
  ck "(e3) persons reported_games NULL->value" 31 "$(gstat persons.reported_games n2v)"
  ck "(e3) persons reported_games increases" 239 "$(gstat persons.reported_games inc)"
  ck "(e3) persons reported_games decreases" 0 "$(gstat persons.reported_games dec)"
  ck "(e4) persons reported_goals NULL->0" 31 "$(gstat persons.reported_goals n2z)"
  ck "(e4) persons reported_goals NULL->value" 31 "$(gstat persons.reported_goals n2v)"
  ck "(e4) persons reported_goals increases" 107 "$(gstat persons.reported_goals inc)"
  ck "(e4) persons reported_goals decreases" 0 "$(gstat persons.reported_goals dec)"
  ck "(g1) picks confidence_notes -> NULL" 33 "$(gstat picks.confidence_notes v2n)"
  ck "(g2) persons confidence_notes -> NULL" 31 "$(gstat persons.confidence_notes v2n)"
  ck "(h) competition NULL->value" 35 "$(gstat picks.competition n2v)"
  ck "(h) competition set to AFL" 35 "$(gstat picks.competition toafl)"
  ck "(i) original_club_raw NULL->value" 3 "$(gstat picks.original_club_raw n2v)"
  ck "(i) original_club_raw value->NULL" 0 "$(gstat picks.original_club_raw v2n)"

  # 4. Unchanged identity links: 0 changes to player_id / link status / match method on every pre-existing row.
  for name in picks.player_id picks.link_status picks.match_method picks.candidate_count picks.draft_person_id picks.key_url picks.key_year picks.key_kind \
              persons.player_id persons.link_status persons.match_method persons.candidate_count persons.is_matching_backlog persons.player_url \
              idents.player_id idents.status idents.match_method idents.candidate_count; do
    ck "link/identity unchanged: $name changed rows" 0 "$(gstat "$name" count)"
  done
  ck "linked picks pre (player_id not NULL)" 5215 "$(awk -F'\t' '$14 != "\\N"' "$pre/picks.tsv" | wc -l | tr -d ' ')"
  ck "linked picks post" 5215 "$(awk -F'\t' '$14 != "\\N"' "$post/picks.tsv" | wc -l | tr -d ' ')"
  ck "linked persons pre" 3564 "$(awk -F'\t' '$8 != "\\N"' "$pre/persons.tsv" | wc -l | tr -d ' ')"
  ck "linked persons post" 3564 "$(awk -F'\t' '$8 != "\\N"' "$post/persons.tsv" | wc -l | tr -d ' ')"
  LC_ALL=C sort -u "$T/ins.idents" > "$T/newid.sorted"
  ck "new identities: all player_id NULL" "$(wc -l < "$T/newid.sorted" | tr -d ' ')" \
     "$(awk -F'\t' 'NR == FNR { n[$1] = 1; next } ($1 in n) && $2 == "\\N"' "$T/newid.sorted" "$post/idents.tsv" | wc -l | tr -d ' ')"
  ck "new identities: all status unmatched" "$(wc -l < "$T/newid.sorted" | tr -d ' ')" \
     "$(awk -F'\t' 'NR == FNR { n[$1] = 1; next } ($1 in n) && $3 == "unmatched"' "$T/newid.sorted" "$post/idents.tsv" | wc -l | tr -d ' ')"
  ck "new identities: all match_method NULL" "$(wc -l < "$T/newid.sorted" | tr -d ' ')" \
     "$(awk -F'\t' 'NR == FNR { n[$1] = 1; next } ($1 in n) && $4 == "\\N"' "$T/newid.sorted" "$post/idents.tsv" | wc -l | tr -d ' ')"
  ck "identity notes pre: rows labelled annual-html-20260826" 5057 "$(awk -F'\t' -v m="$NOTES_PRE_MD5" '$6 == m' "$pre/idents.tsv" | wc -l | tr -d ' ')"
  ck "identity notes post: rows labelled annual-html-20261122" 5088 "$(awk -F'\t' -v m="$NOTES_POST_MD5" '$6 == m' "$post/idents.tsv" | wc -l | tr -d ' ')"
  ck "picks: one post import_batch_id for all picks" 1 "$(cut -f19 "$post/picks.tsv" | sort -u | wc -l | tr -d ' ')"

  # 5. Owner club rulings (exact bytes, zero-width spaces included).
  for f in 5961 6784 6626; do
    eval "exp_pre=\$HEX_${f}_PRE; exp_post=\$HEX_${f}_POST"
    ck "ruling pick $f: pre original_club_raw bytes" "$exp_pre" "$(awk -F'\t' -v i="$f" '$1 == i { print $8 }' "$pre/picks.tsv")"
    ck "ruling pick $f: post original_club_raw bytes" "$exp_post" "$(awk -F'\t' -v i="$f" '$1 == i { print $8 }' "$post/picks.tsv")"
  done

  # 6. "Only these columns changed": residual md5 (every column not in F2 section 4) is unchanged on every row, and the
  #    rows whose whole-row md5 changed are exactly the union of the per-group changed ids.
  ck "picks residual (all other columns) changed rows" 0 "$(gstat picks.residual_md5 count)"
  ck "persons residual (all other columns) changed rows" 0 "$(gstat persons.residual_md5 count)"
  ck "identities residual (all columns but notes) changed rows" 0 "$(gstat idents.residual_md5 count)"
  for g in picks persons; do
    : > "$T/union.$g"
    if [ "$g" = picks ]; then
      cols="competition confidence_notes dg_person_id original_club_raw source_record_id reported_games reported_goals draft_age height_cm"
    else
      cols="name_key dg_person_id confidence_notes reported_games reported_goals"
    fi
    for name in $cols; do ids_of "$g.$name" -s >> "$T/union.$g"; done
    LC_ALL=C sort -u "$T/union.$g" -o "$T/union.$g"
    ids_of "$g.row_md5" -s > "$T/rowmd5.$g"
    ck "$g: whole-row-md5 changed rows minus union of group ids" 0 "$(comm -23 "$T/rowmd5.$g" "$T/union.$g" | wc -l | tr -d ' ')"
    ck "$g: union of group ids minus whole-row-md5 changed rows" 0 "$(comm -13 "$T/rowmd5.$g" "$T/union.$g" | wc -l | tr -d ' ')"
  done
  ids_of idents.row_md5 -s > "$T/rowmd5.idents"; ids_of idents.notes -s > "$T/notes.idents"
  ck "identities: whole-row-md5 changed rows differ from the notes relabel set" 0 "$(comm -3 "$T/rowmd5.idents" "$T/notes.idents" | wc -l | tr -d ' ')"

  # 7. Tables the load must not touch, and import_batches +1 completed.
  for f in plr_n plr_md5 players_n players_md5 data_edits_n data_edits_md5 data_overrides_n data_overrides_md5; do
    ck "unchanged: $f" "$(metaval "$pre" $f)" "$(metaval "$post" $f)"
  done
  ck "player_link_resolutions rows (post)" 0 "$(metaval "$post" plr_n)"
  ck "import_batches count +1" "$(( $(metaval "$pre" import_batches_n) + 1 ))" "$(metaval "$post" import_batches_n)"
  ck "import_batches deleted" 0 "$(wc -l < "$T/del.batches" | tr -d ' ')"
  ck "import_batches: pre rows changed" 0 "$(gstat batches.row_md5 count)"
  newb=$(sort -n "$T/ins.batches" | tail -1)
  ck "import_batches: newest post id is the inserted row" "$(cut -f1 "$post/batches.tsv" | sort -n | tail -1)" "$newb"
  ck "import_batches: new id above every pre id" yes "$( [ -n "$newb" ] && [ "$newb" -gt "$(cut -f1 "$pre/batches.tsv" | sort -n | tail -1)" ] && echo yes || echo no)"
  ck "import_batches: newest source" draftguru "$(awk -F'\t' -v i="$newb" '$1 == i { print $2 }' "$post/batches.tsv")"
  ck "import_batches: newest status" completed "$(awk -F'\t' -v i="$newb" '$1 == i { print $5 }' "$post/batches.tsv")"
  ck "import_batches: newest completed_at set" t "$(awk -F'\t' -v i="$newb" '$1 == i { print $6 }' "$post/batches.tsv")"
  ck "import_batches: newest error is NULL" t "$(awk -F'\t' -v i="$newb" '$1 == i { print $12 }' "$post/batches.tsv")"
  ck "import_batches: newest records_rejected" 0 "$(awk -F'\t' -v i="$newb" '$1 == i { print $10 }' "$post/batches.tsv")"
  ck "picks import_batch_id equals the new batch id" "$newb" "$(cut -f19 "$post/picks.tsv" | sort -u)"
  echo "info: newest batch id=$newb tool=$(awk -F'\t' -v i="$newb" '$1 == i { print $3 }' "$post/batches.tsv") read/ins/upd/rej=$(awk -F'\t' -v i="$newb" '$1 == i { print $7 "/" $8 "/" $9 "/" $10 }' "$post/batches.tsv")"

  if [ "$FAILS" = 0 ]; then echo "POSTLOAD RESULT PASS"; else echo "POSTLOAD RESULT FAIL ($FAILS check(s) failed)"; fi
  [ "$FAILS" = 0 ]
}

case "${1:-}" in
  snap) shift; snap "$@" ;;
  compare) shift; compare "$@" ;;
  derive) shift; derive "$@" ;;
  *) echo "usage: bash i348-postload-check.sh snap pre|post <outdir> | compare <predir> <postdir> | derive <predir> <postdir>"; exit 2 ;;
esac
