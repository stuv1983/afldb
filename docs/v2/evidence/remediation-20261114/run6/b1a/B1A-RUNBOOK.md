# B1a prep: ISSUE-365 2026 Brownlow repair on `afldb_prod` + B1a-0 backup/restore verification (read-only preparation)

Prepared 2026-11-16 from worktree `D:\dev\afldb-rem-20261114` at C′ `a2e6ea99`. Nothing was executed against any host or database.

> Packet 6 (`../RELEASE-AND-REPAIR-PACKET-6.md`) is the contract and supersedes `../../run5/b1a/README.md` §3 item 1, §5 and §6:
> B1a-0 and B1a run **after B1 step S2 (serving checkout fast-forwarded to C′) and before B1 step S3 (build)**, while
> `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` still serves. The acceptance and reversal SQL are the standalone files `b1a-accept.sql` and
> `b1a-reverse.sql` in this directory; the inline SQL drafts below are superseded by them.
`R=docs/v2/evidence/remediation-20261114/run5`. Line refs are at C′ unless stated.

Verified offline: runner blob sha256 at C′ = `8453572e796f16fbe5f7900404e021bff62f13d764ac35197f1ceedb5fd7a27c` (equals the rehearsed upload,
`$R/b1a/dry-run.txt:2`); `git diff f6af6da9 a2e6ea99` is empty for `player-derived.ts`, `brownlow-readiness.ts`, `backup.sh`, `restore-test.sh`,
`package-lock.json`. `git diff c1c4b22e a2e6ea99`: `backup.sh` unchanged; `restore-test.sh` changed (209 lines touched, ISSUE-341/342); `player-derived.ts`
changed only from line 624 on (`recomputeSeasonBrownlowStatus` at :379-400 and `brownlowStatusSql` untouched, as README §2 claims).

Common shell prelude (as `arm` on production; every block below runs inside ONE subshell so `.env` never leaks into the login shell):

```bash
cd /home/arm/projects/afldb && export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
# move a DSN's password out of argv (same rule as backup.sh:29-38 / restore-test.sh:99-109); sets $DSN, exports PGPASSWORD
pgconn() { local d="${!1}" re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; [[ $d =~ $re ]] || { echo "bad DSN shape in $1" >&2; return 1; }
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD; DSN="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"; }
```

## 0. Preflight (as arm, read-only; all must hold, else stop)

```bash
git -C ~/projects/afldb rev-parse HEAD                      # = a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5 (B1 S2 done)
git -C ~/projects/afldb --no-optional-locks status --porcelain | wc -l   # 0
sha256sum docs/v2/evidence/remediation-20261114/run5/b1a/b1a-repair-2026.mts   # 8453572e…a27c
sha256sum tools/maintenance/backup.sh tools/maintenance/restore-test.sh        # compare: git show a2e6ea99:<path> | sha256sum (workstation)
test -f node_modules/tsx/package.json && test -f node_modules/postgres/package.json && echo deps-ok
node --version                                              # v22.23.2
node deploy/release.mjs status                              # STATUS PASS, current = c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x (packet 6 order)
systemctl is-active afldb-settle-afl-api.service            # inactive
systemctl list-timers afldb-settle-afl-api.timer apt-daily-upgrade.timer apt-daily.timer --no-pager   # next run > 90 min away (B0 §3)
pgrep -af 'settle|import_|rebuild|pg_dump|pg_restore' || echo no-writers
df -h /home/arm                                             # ≥ 2 GB free (B1a-0 needs ~0.1 GB dump + ~0.6 GB restore DB + WAL)
```
`arm` cannot stop the settle timer (no sudo, procedure 05 §4): choose a window clear of 05:00–05:15 settle and 06:00–07:00 apt/needrestart.

## 1. B1a-0 — fresh backup + restore verification (separate approval)

### 1.1 Why not bare `backup.sh`
`backup.sh` always prunes after a successful dump: `ls -1t "${BACKUP_DIR}"/"${DB_NAME}"-*.dump | tail -n +$((KEEP+1)) | … rm -f`
(`tools/maintenance/backup.sh:123-127`), default `KEEP=7` (:41), default dir `${AFLDB_BACKUP_DIR:-$HOME/backups/afldb}` (:40). It sources the
checkout `.env` (:21), and `.env` holds an `AFLDB_BACKUP_DIR` key (value unread; procedure 05 §1), so the env var alone is not trustworthy;
`--dir` is parsed after `.env` (:44-50) and wins. `~/backups/afldb` holds 90 per-operation files that packets bind by hash (procedure 05 §1,
`docs/backup-restore.md:22-25`). **Safe form: a new, empty directory via `--dir`, plus a large `--keep`** (prune is then a no-op either way).

### 1.2 Commands (as arm)
```bash
( cd /home/arm/projects/afldb
  D=/home/arm/backups/afldb-b1a-$(date +%Y%m%d-%H%M%S); test ! -e "$D" || exit 1
  bash tools/maintenance/backup.sh --dir "$D" --keep 1000            # expect: "==> Backing up afldb_prod to $D/afldb_prod-<stamp>.dump",
                                                                     # "archive readable, N objects", "1 backup(s) of afldb_prod retained"
  F=$(ls -1 "$D"/afldb_prod-*.dump); [ "$(ls -1 "$D"/*.dump | wc -l)" = 1 ] || exit 1
  (cd "$D" && sha256sum "$(basename "$F")" > "$(basename "$F").sha256" && chmod 600 *.sha256 && cat *.sha256)   # RECORD this hash
  pg_restore --list "$F" | sed -n '1,20p' | grep -E 'dbname: afldb_prod|Archive created|TOC Entries'   # dbname must be afldb_prod
  pg_restore --list "$F" | grep -cE '^[0-9]+;'                                                         # object count = backup.sh's N
  pg_restore --list "$F" | grep -E 'TABLE DATA public (player_season_stats|stat_availability|brownlow_season_votes|auth_users|data_edits) '
  # DB-free proof the dump holds the PRE-repair 2026 state (expect: "not_applicable 669" and "votes_non_null 0"):
  pg_restore --data-only --table=player_season_stats --file=- "$F" | awk -F'\t' '
    /^COPY public.player_season_stats /{s=$0;sub(/^[^(]*\(/,"",s);sub(/\).*/,"",s);n=split(s,c,", ");
      for(i=1;i<=n;i++){if(c[i]=="season")si=i;if(c[i]=="brownlow_status")bi=i;if(c[i]=="brownlow_votes")vi=i};on=1;next}
    on&&/^\\\.$/{on=0;next} on&&$si==2026{k[$bi]++;if($vi!="\\N")nn++} END{for(x in k)print x,k[x];print "votes_non_null",nn+0}'
  du -h "$F" )
```
- **Role/env:** `AFLDB_BACKUP_DATABASE_URL` from `.env` (`backup.sh:21,42`; refuses if unset, :55-60; never the owner DSN). Role `afldb_backup`,
  `pg_read_all_data`, no write (`docs/backup-restore.md:19`); B0 ran as this role and asserted `afldb_prod`/66668/sysid (`B0-FINDINGS.md:9`).
  Filename uses the DSN's database name (:70-75, :81). Password moved to `PGPASSWORD` (:95). `pg_dump -Fc --compress=6 --no-owner` (:98-102),
  written as `.partial`, renamed only after `pg_restore --list` reads it (:85-88, :107-115). Mode 700 dir / 600 file (:78, :104).
- **Size/time:** production dump 30.1 MB for a 518 MB database (2026-11-12, `docs/backup-restore.md:117`); rehearsal fresh dump 9 s. pg_dump
  takes ACCESS SHARE locks only; it does not block the app or B1a.

### 1.3 What `restore-test.sh` (C′ version) does
- Target: **`afldb_restore_test`** on the same cluster (`restore-test.sh:41`), connected as the **owner role** from `AFLDB_OWNER_DATABASE_URL`
  (:34-39) with the path swapped (:112-115). Exists on production (~0.4 GB, older marker; `docs/backup-restore.md:107-108`); created once by
  `01_setup_service.sh:95-97` (`createdb -O afldb_owner`). If absent it refuses before any change (:149-154); creating it needs sudo/postgres.
- Safety: strips libpq routing env (:26-31); DSN must match a strict single-host URL contract (:63-87); refuses source == target (:89-92);
  every write stream starts with an identity guard `current_database()='afldb_restore_test' AND current_user=<DSN user>` (:125-136, :181, :304).
- Writes (all in `afldb_restore_test` only): `COMMENT ON DATABASE … IS NULL` + `DROP TABLE … CASCADE` of every table (:179-194); `pg_restore
  --clean --if-exists --no-owner --no-privileges --no-comments --jobs=4` (:218-225); on success `COMMENT ON DATABASE afldb_restore_test IS
  'afldb.restore_test.v1 sha256=<dump sha>'` (:300-308) — this **replaces** the existing marker that `db:promotion:check --phase freeze-dump` reads.
  Plus a `mktemp` log in `/tmp` (:214).
- Reads of `afldb_prod`: nine `SELECT count/sum` parity queries as the owner role (:274-298, source at :280). No write to `afldb_prod`.
- Verdict: pg_restore exit 0 clean, or exit 1 with only extension-owner errors matching the summary count (:229-267); then 9 parity checks;
  any difference exits 1 (:309-311). Parity compares LIVE `afldb_prod` to the dump, so a concurrent write fails it (safe direction).
- Impact: up to 4 restore workers + index builds on the production cluster; WAL roughly the database size; disk ≈ replaces ~0.4 GB with
  ~0.5–0.6 GB (45 GB free on 2026-11-14). Duration: 17 s end to end on the isolated DEV-class rehearsal (`docs/backup-restore.md:117`);
  **not measured on production** (expect under a few minutes; brief CPU/IO spike — off-peak).
- Do **not** run it bare: it picks the newest `afldb_prod-*.dump` by mtime in `${AFLDB_BACKUP_DIR:-~/backups/afldb}` (:33, :139-141), not `$D`.

### 1.4 Recommended minimal verification (what the owner approves as B1a-0)
```bash
( cd /home/arm/projects/afldb && bash tools/maintenance/restore-test.sh "$F" ; echo "exit=$?" )
# expect: 9 × "PASS", "recorded restored dump sha256 <same hash as $F.sha256>", "==> Restore verified: the backup is proven.", exit=0
```
Approval text should state: **writes only `afldb_restore_test` on the production cluster (drops and recreates all its tables, overwrites its
database comment), reads `afldb_prod` with 9 aggregate SELECTs as `afldb_owner`, adds one dump + `.sha256` under a new `$D`; prunes
nothing.** `pg_restore --list` alone proves a readable TOC, not restorability; the awk check proves the dump carries the pre-repair rows.

## 2. B1a transaction

### 2.1 Commands (as arm, after §0 and §1 passed, same sitting)
```bash
( cd /home/arm/projects/afldb && set -a && . ./.env && set +a
  M=docs/v2/evidence/remediation-20261114/run5/b1a/b1a-repair-2026.mts
  A="--dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 --expect-sysid 7674454702926115004 --expect-rows 669"
  node --import tsx "$M" $A;          echo "exit=$?"     # 1) dry run
  # STOP unless 1) printed exactly the expected BEFORE/AFTER lines below and OUTCOME DRY-RUN-PASS (rolled back), exit=0
  node --import tsx "$M" $A --commit; echo "exit=$?" )   # 2) commit (separate keystroke, after the §3 BEFORE capture)
```

### 2.2 README claim → runner enforcement (`b1a-repair-2026.mts`)
| README | Runner | Enforced? |
|---|---|---|
| §3.1 approval, A published, B1 done, `release.mjs status` PASS | — | **NO** (operator; §0) |
| §3.2 backup taken+verified immediately before | — | **NO** (operator; §1) |
| §3.3 settle inactive, no other writer | — | **NO** (operator; §0). A concurrent write makes the fingerprints differ → rollback (safe) |
| §3.4 identity `afldb_prod` | :65-69 | yes (`id.db !== expectDb`) |
| §3.4 OID 66668 / sysid | :68 | **only if `--expect-oid/--expect-sysid` are passed** (`expectOid && …`); :26 requires only db+rows |
| §3.4 read-write session | :68 (`ro !== 'off'`) | yes |
| §3.4 season 2026 `complete` | :76 | yes |
| §3.4 exactly 3 coverage rows | :77 | count only; their values are asserted after (:88-92, :98) |
| §3.4 0 `brownlow_season_votes` 2026 | :78 | yes |
| §3.4 669 rows | :79 | yes |
| §3.4 NOTHING-TO-REPAIR (exit 0) | :80, :106, :111 | yes |
| §6 "precondition fixed prior state (all 669 not_applicable, votes NULL)" | — | **NO**: :74 only needs ≥1 not_applicable row; a mixed state would be repaired too. Prior state is visible only in the printed BEFORE line |
| §2 lock 5 s / statement 120 s | :63-64 | yes (`SET LOCAL`) |
| §2 coverage recompute only if a 2026 coverage row is `not_applicable` | :75, :82 | yes |
| §4 season_total & match_votes pending, unrecorded | :88-89 | yes |
| §4 round_votes pending (or partial with rows) | :90-92 | yes |
| §4 2026 pss: one status, pending, 669, 0 votes | :93-94 | yes |
| §4 not_applicable coverage ≥1924 outside 1942–45 = 0; 1942–45 = 12 | :45-48, :95-96 | yes |
| §4 other seasons' pss fingerprint unchanged | :38-41, :97 | yes (status/count/votes-count per season, not row-level) |
| §4 other seasons' stat_availability unchanged | :42-44, :99 | yes (coverage + is_recorded only; not populated/total_rows) |
| §4 2026 coverage unchanged when (a) not run | :98 | yes (key/coverage/is_recorded only) |
| dry run always rolls back; commit only if all pass | :101-102 | yes (Abort inside `sql.begin` → ROLLBACK) |

### 2.3 SQL effect
Only statement that writes: `recomputeSeasonBrownlowStatus(tx, 2026)` (`src/db/queries/player-derived.ts:379-400`):
`UPDATE player_season_stats SET brownlow_status = <brownlowStatusSql>, brownlow_votes = CASE WHEN status='complete' THEN … ELSE NULL END
WHERE season = 2026`. `brownlowStatusSql` (`src/db/queries/brownlow-readiness.ts:18-28`): season_total coverage `not_applicable` → not_applicable;
accepted (coverage `complete` or published authority) **and** a medal row → complete; else **pending**. With coverage `pending` and 0 medal
rows → `pending`; votes → NULL. All 669 rows written (`not_applicable`→`pending`, NULL→NULL); allowed by `pss_brownlow_grain_ck`
(`015_brownlow_grain_and_coverage.sql:140-143`). No triggers on `player_season_stats` (none in migrations). Not written: `stat_availability`
(:82 skipped because no coverage row is `not_applicable`), `brownlow_*`, `data_edits`, `data_overrides`, any other season, any other table.

### 2.4 Expected stdout (from `dry-run.txt:8-10,20-23`, B0 state)
```
BEFORE {"coverage":["brownlow_match_votes=pending","brownlow_round_votes=pending","brownlow_season_total=pending"],"pss":["not_applicable:669/votes:0"],"season":"complete","medalRows":0,"roundRows":9522,"naOutside":0,"naWar":12}
AFTER(in tx) {"coverage":["brownlow_match_votes=pending","brownlow_round_votes=pending","brownlow_season_total=pending"],"pss":["pending:669/votes:0"],"season":"complete","medalRows":0,"roundRows":9522,"naOutside":0,"naWar":12}
OUTCOME DRY-RUN-PASS (rolled back)      # run 1, exit 0          |  OUTCOME COMMITTED   # run 2, exit 0
```
Other outcomes: `OUTCOME NOTHING-TO-REPAIR` exit 0 (**nothing written — on run 2 this means someone else changed the rows: stop and
investigate**); `OUTCOME ROLLED-BACK <reason>` exit 1; `OUTCOME ERROR <msg, DSN redacted>` exit 1 (:105, :111). A missing env/flag throws
before connecting (:25-26), uncaught, exit 1. **Decide on the OUTCOME string, never on the exit code alone; BEFORE must equal the line above
byte for byte, else do not commit.**

## 3. Acceptance (read-only; capture BEFORE the commit, re-run AFTER, diff)

```bash
( cd /home/arm/projects/afldb && set -a && . ./.env && set +a && pgconn AFLDB_BACKUP_DATABASE_URL &&
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -d "$DSN" -f /home/arm/b1a-accept.sql ) | tee /home/arm/b1a-accept-$(date +%H%M%S).txt
```
`b1a-accept.sql` (written by the operator; read-only role `afldb_backup`):
```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $$ DECLARE r record; BEGIN
  SELECT current_database() db, d.oid::text oid, c.system_identifier::text sysid, current_setting('transaction_read_only') ro INTO r
    FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database();
  IF r.db <> 'afldb_prod' OR r.oid <> '66668' OR r.sysid <> '7674454702926115004' OR r.ro <> 'on' THEN
    RAISE EXCEPTION 'identity/read-only mismatch: % % % %', r.db, r.oid, r.sysid, r.ro; END IF; END $$;
SELECT 'pss2026', brownlow_status::text, count(*), count(brownlow_votes) FROM player_season_stats WHERE season=2026 GROUP BY 2 ORDER BY 2;
SELECT 'cov2026', stat_key, coverage::text, is_recorded, populated_rows, total_rows FROM stat_availability
 WHERE season=2026 AND stat_key IN ('brownlow_season_total','brownlow_round_votes','brownlow_match_votes') ORDER BY stat_key;
SELECT 'inputs2026', (SELECT status::text FROM seasons WHERE year=2026),
  (SELECT count(*) FROM brownlow_season_votes WHERE season=2026), (SELECT count(*) FROM brownlow_round_votes WHERE season=2026),
  (SELECT string_agg(status::text||':'||n, ',' ORDER BY status::text) FROM (SELECT status, count(*) n FROM brownlow_vote_entry_state WHERE season=2026 GROUP BY 1) v),
  (SELECT count(*) FROM brownlow_season_authority WHERE season=2026 AND published_revision IS NOT NULL);
SELECT 'fp_pss_other', md5(string_agg(p::text, E'\n' ORDER BY p.season, p.player_id)) FROM player_season_stats p WHERE season<>2026;
SELECT 'fp_pss2026_nonbrownlow', md5(string_agg(((to_jsonb(p)-'brownlow_status')-'brownlow_votes')::text, E'\n' ORDER BY p.player_id))
  FROM player_season_stats p WHERE season=2026;
SELECT 'fp_sa_all_but_2026brownlow', md5(string_agg(sa::text, E'\n' ORDER BY sa.season, sa.stat_key)) FROM stat_availability sa
 WHERE NOT (season=2026 AND stat_key LIKE 'brownlow%');
SELECT 'na_cov', count(*) FILTER (WHERE season>=1924 AND season NOT BETWEEN 1942 AND 1945), count(*) FILTER (WHERE season BETWEEN 1942 AND 1945)
  FROM stat_availability WHERE stat_key LIKE 'brownlow%' AND coverage='not_applicable';
SELECT 'na_pss', count(*) FILTER (WHERE season>=1924 AND season NOT BETWEEN 1942 AND 1945),
  count(*) FILTER (WHERE season BETWEEN 1897 AND 1923 OR season BETWEEN 1942 AND 1945) FROM player_season_stats WHERE brownlow_status='not_applicable';
ROLLBACK;
```
| Line | BEFORE (B0) | AFTER (expected) |
|---|---|---|
| `pss2026` | `not_applicable|669|0` | **`pending|669|0`** (single row) |
| `cov2026` | 3 × `pending|f||` | identical to BEFORE |
| `inputs2026` | `complete|0|9522|<ves>|<auth>` | identical |
| `fp_pss_other`, `fp_pss2026_nonbrownlow`, `fp_sa_all_but_2026brownlow` | hashes H1,H2,H3 | **H1,H2,H3 unchanged** |
| `na_cov` | `0|12` | `0|12` |
| `na_pss` | `669|9553` | **`0|9553`** |

Keep the BEFORE file: §4(a) consumes `inputs2026`, H1 and H2.

## 4. Recovery

### 4(a) Guarded reversal (use ONLY if the repair itself caused a fault)
Must NOT be used if: any `inputs2026` value differs from the BEFORE capture (a medal, round votes, a vote-entry decision or a
publication was loaded); any 2026 coverage row is not the 3 × pending/unrecorded; 2026 pss is not exactly 669 × pending/NULL; H1/H2 differ;
a release/settle/admin action ran since the commit (it would legitimately recompute 2026 — the reversal would then re-break correct data);
or the runner's BEFORE line was not exactly `not_applicable:669/votes:0` (the inverse then is not the true prior state). In any of those
cases: stop, keep current state, take a fresh B1a-0-style dump, and plan a targeted fix (or 4(b)) as a new approval.

Run as the import role (it holds UPDATE on `player_season_stats`, `privileges.sql:248-251` via the 045 registry), from the BEFORE file values:
```bash
( cd /home/arm/projects/afldb && set -a && . ./.env && set +a && pgconn AFLDB_IMPORT_DATABASE_URL &&
  psql -X -v ON_ERROR_STOP=1 -d "$DSN" -v inputs="<inputs2026 line from BEFORE>" -v h1="<H1>" -v h2="<H2>" -f /home/arm/b1a-reverse.sql; echo "exit=$?" )
```
```sql
BEGIN;
SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'; SET LOCAL idle_in_transaction_session_timeout = '120s';
SELECT set_config('b1a.inputs', :'inputs', true), set_config('b1a.h1', :'h1', true), set_config('b1a.h2', :'h2', true);
LOCK TABLE player_season_stats, stat_availability, brownlow_season_votes, brownlow_round_votes IN SHARE MODE;  -- freeze writers, readers unaffected
DO $guard$ DECLARE r record; n int; p int; v int; cn int; cp int; s text; BEGIN
  SELECT current_database() db, d.oid::text oid, c.system_identifier::text sysid, current_setting('transaction_read_only') ro INTO r
    FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database();
  IF r.db <> 'afldb_prod' OR r.oid <> '66668' OR r.sysid <> '7674454702926115004' OR r.ro <> 'off' THEN
    RAISE EXCEPTION 'REVERSE REFUSED identity: % % % ro=%', r.db, r.oid, r.sysid, r.ro; END IF;
  SELECT count(*), count(*) FILTER (WHERE brownlow_status='pending'), count(brownlow_votes) INTO n, p, v FROM player_season_stats WHERE season=2026;
  IF n <> 669 OR p <> 669 OR v <> 0 THEN RAISE EXCEPTION 'REVERSE REFUSED pss2026 total=% pending=% votes=%', n, p, v; END IF;
  IF (SELECT count(*) FROM brownlow_season_votes WHERE season=2026) <> 0 THEN RAISE EXCEPTION 'REVERSE REFUSED medal rows present'; END IF;
  SELECT count(*), count(*) FILTER (WHERE coverage='pending' AND NOT is_recorded) INTO cn, cp FROM stat_availability
   WHERE season=2026 AND stat_key IN ('brownlow_season_total','brownlow_round_votes','brownlow_match_votes');
  IF cn <> 3 OR cp <> 3 THEN RAISE EXCEPTION 'REVERSE REFUSED coverage rows=% pending=%', cn, cp; END IF;
  SELECT 'inputs2026|'||concat_ws('|', (SELECT status::text FROM seasons WHERE year=2026),
    (SELECT count(*) FROM brownlow_season_votes WHERE season=2026), (SELECT count(*) FROM brownlow_round_votes WHERE season=2026),
    (SELECT string_agg(status::text||':'||k, ',' ORDER BY status::text) FROM (SELECT status, count(*) k FROM brownlow_vote_entry_state WHERE season=2026 GROUP BY 1) q),
    (SELECT count(*) FROM brownlow_season_authority WHERE season=2026 AND published_revision IS NOT NULL)) INTO s;
  IF s IS DISTINCT FROM current_setting('b1a.inputs') THEN RAISE EXCEPTION 'REVERSE REFUSED 2026 inputs changed: %', s; END IF;
  IF (SELECT md5(string_agg(x::text, E'\n' ORDER BY x.season, x.player_id)) FROM player_season_stats x WHERE season<>2026) <> current_setting('b1a.h1')
    THEN RAISE EXCEPTION 'REVERSE REFUSED other seasons changed'; END IF;
  IF (SELECT md5(string_agg(((to_jsonb(x)-'brownlow_status')-'brownlow_votes')::text, E'\n' ORDER BY x.player_id)) FROM player_season_stats x WHERE season=2026)
     <> current_setting('b1a.h2') THEN RAISE EXCEPTION 'REVERSE REFUSED 2026 non-Brownlow columns changed'; END IF;
END $guard$;
DO $rev$ DECLARE k int; BEGIN
  UPDATE player_season_stats SET brownlow_status = 'not_applicable'
   WHERE season = 2026 AND brownlow_status = 'pending' AND brownlow_votes IS NULL;
  GET DIAGNOSTICS k = ROW_COUNT;
  IF k <> 669 THEN RAISE EXCEPTION 'REVERSE ABORTED updated % rows, expected 669', k; END IF;
  IF (SELECT count(*) FROM player_season_stats WHERE season=2026 AND brownlow_status='not_applicable' AND brownlow_votes IS NULL) <> 669
     OR EXISTS (SELECT 1 FROM player_season_stats WHERE season=2026 AND brownlow_status <> 'not_applicable')
    THEN RAISE EXCEPTION 'REVERSE ABORTED post-state wrong'; END IF;
  RAISE NOTICE 'REVERSE OK 669 rows';
END $rev$;
COMMIT;
```
Note: the `inputs2026` line psql prints is `|`-separated with a leading `inputs2026` label; pass it verbatim (the guard rebuilds the same
`inputs2026|…` string; a NULL `ves` aggregate prints empty and `concat_ws` skips NULLs — check the BEFORE value before relying on it, and
if they cannot be made to match exactly, do not run the reversal). Any RAISE/ON_ERROR_STOP aborts; psql exits non-zero and the server rolls
back on disconnect; COMMIT is never reached. Afterwards re-run §3: expect `pss2026` back to `not_applicable|669|0`, all hashes unchanged.

### 4(b) Restore from the B1a-0 dump (backstop; separate owner approval, needs sudo)
`docs/backup-restore.md:195-218` procedure A: stop app + settle timer, restore into a NEW `afldb_prod_restore_<stamp>`, `db:privileges`,
verify, rename-swap, start, `release.mjs status`. Consequences: discards **every** write since the dump (auth sessions, `auth_audit_log`,
`data_edits`, overrides, any settle or admin action); downtime; the database gets a **new OID** (every `66668` pin in runbooks/runner/guards
must be re-pinned; sysid unchanged); the old database is kept renamed until accepted. Never `pg_restore --clean` over the live name. For a
B1a-only fault, 4(a) or a targeted UPDATE built from the dump's 2026 rows (the §1.2 awk extract) is far narrower than a full restore.

### 4(c) Runner fails mid-way
Everything runs in one `sql.begin` (:62-103): any throw (Abort or DB error) → postgres.js ROLLBACK, outcome `ROLLED-BACK …`/`ERROR …`,
exit 1 (:104-111). The only write is one UPDATE statement, so a partial row set cannot commit. Process kill / SSH drop → the server rolls
back the open transaction on disconnect. Ambiguous case: connection lost **during COMMIT** (outcome `ERROR`): run §3 — `pss2026` reads
either `not_applicable|669|0` (not committed; rerun dry run) or `pending|669|0` (committed; proceed to acceptance). No other state is possible.

## 5. Defects and risks

| Grade | Where | Finding / mitigation |
|---|---|---|
| MED | `b1a/README.md:65-67` | Reversal is unguarded (no identity, no medal/coverage/inputs check, "expecting 669" not enforced). Replace with §4(a). |
| MED | runner `:73-80` vs `README.md:65` | Runner does not require the prior state to be exactly 669 × `not_applicable`/NULL; README §6 assumes it. Operator must gate on the BEFORE line (§2.4) in both runs. |
| MED | `README.md:37` heading | "Preconditions (each checked inside the transaction)" — items 1–3 (approval/B1/release status, backup, no writers) are NOT checked by the runner; they are operator checks (§0, §1). |
| LOW | runner `:26`, `:68` | `--expect-oid`/`--expect-sysid` are optional; a mistyped flag silently drops the OID/sysid binding (db-name check remains). Use the exact `$A` string; the mismatch message omits sysid (:69). |
| LOW | `README.md:28` | `set -a; . ./.env` is "in a subshell" only by comment; as written it exports every secret (owner DSN) into the login shell. Use the `( … )` form in §2.1. |
| LOW | `restore-test.sh:300-308` | Overwrites the existing `afldb_restore_test` marker read by `db:promotion:check --phase freeze-dump` (ISSUE-250); confirm no packet still relies on the old one. |
| LOW | `restore-test.sh` (C′ vs `c1c4b22e`) | The ISSUE-341/342 version has never run on production; its strict DSN contract (:63-87) may refuse the real `.env` owner DSN (fails safe, before any write). Run B1a-0 only after B1 step S2 (checkout at C′); before it the old 2026-09-26 script would run. |
| LOW | `restore-test.sh:33,139-141` | Bare run picks newest dump in `AFLDB_BACKUP_DIR`/`~/backups/afldb`, not `$D`: always pass `"$F"`. |
| LOW | `restore-test.sh:224` | `--jobs=4` on the production cluster; duration unmeasured on prod. Off-peak; watch `/api/health`. |
| LOW | runner `:13`, `deploy/afldb-settle-afl-api.sh:45` | Needs devDependency `tsx` (package.json `"tsx": "^4.23.12"`) in the serving checkout's `node_modules`; the nightly settle already uses `node_modules/tsx/dist/cli.mjs`, B0 says lockfile unchanged. Check in §0. `.mts` is required (the `.ts` attempt failed as CJS top-level await, `dry-run.txt:4`). |
| LOW | runner `:38-44`, `:98` | Fingerprints are aggregate (pss: status/count per season; sa: coverage/is_recorded) — §3's row-level hashes close this outside the transaction. |
| INFO | role privileges | Import role: writable registry tables get SELECT/INSERT/UPDATE/DELETE (`privileges.sql:248-251`), non-registered tables `REVOKE ALL` (:258-259); the nightly settle runs the same function as this role, and the production dry run proves SELECT/UPDATE (a denial → `ERROR`, exit 1, nothing written). `pg_control_system()` ran as `afldb_backup` in B0. |
| INFO | `015_…sql:133` | `brownlow_status` DEFAULT `not_applicable`: any path that inserts 2026 pss rows without the recompute would re-create the defect; D-365-1/B1 covers coverage, not this default. |
| INFO | runner `:111` | `NOTHING-TO-REPAIR` exits 0 with no write: on the commit run that is a stop signal, not success. |
