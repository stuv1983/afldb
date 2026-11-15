# B1a — ISSUE-365 conditional repair of season 2026: concrete transaction (PROPOSED; separately approved; not executed)

Supersedes the procedure shape of `../../run4/brownlow/README.md` §6.3 for production by fixing it to what B0 read (`../B0-FINDINGS.md` §2).
B1a stays **conditional and separately approved**: approving A or B1 approves nothing here.

## 1. Why, measured

B0 (2026-11-15 20:19 AEDT): the three 2026 Brownlow coverage rows read `pending`; **all 669** 2026 `player_season_stats` rows read
`brownlow_status = not_applicable` with NULL votes; 0 medal rows; no other season affected. Public effect: every 2026 player-season cell says
"No medal" / "No Brownlow Medal was awarded for this season." Admin is not locked (coverage is `pending`). B1 alone repairs nothing.

## 2. Transaction scope (exactly one transaction, one database, one season)

| | |
|---|---|
| Database | `afldb_prod` (OID 66668, sysid `7674454702926115004`), role from `AFLDB_IMPORT_DATABASE_URL` (the settle role, which already runs this function nightly in season) |
| Code | `recomputeSeasonBrownlowStatus(tx, 2026)` from `src/db/queries/player-derived.ts` of the published candidate (unchanged since the serving revision `c1c4b22e`); `recomputeBrownlowCoverage` only if a 2026 coverage row reads `not_applicable` at run time (B0: none, so it will **not** run) |
| Rows written | `player_season_stats` WHERE `season = 2026`: `brownlow_status` `not_applicable` → `pending`, `brownlow_votes` NULL → NULL. 669 rows. Nothing else. |
| Not written | `stat_availability` (unless (a) runs), `brownlow_*` tables, `data_edits`/`data_overrides` (derived projection, same as every settle recompute), any other season |
| Runner | `b1a-repair-2026.mts` (this directory; records path, excluded from the repo typecheck/lint by design). Dry run by default; `--commit` commits only when every assertion holds inside the transaction |
| Locks / limits | `lock_timeout 5s`, `statement_timeout 120s`; touches 669 rows; seconds |

Command (from the serving checkout at the published candidate, as `arm`, with the unit's pinned Node first on `PATH`, `.env` sourced
into the environment of that one command only, never echoed):

```bash
cd ~/projects/afldb
set -a; . ./.env; set +a      # in a subshell; prints nothing
node --import tsx docs/v2/evidence/remediation-20261114/run5/b1a/b1a-repair-2026.mts \
  --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 \
  --expect-sysid 7674454702926115004 --expect-rows 669            # 1) dry run: must print OUTCOME DRY-RUN-PASS
node --import tsx docs/v2/evidence/remediation-20261114/run5/b1a/b1a-repair-2026.mts \
  --dsn-env AFLDB_IMPORT_DATABASE_URL --expect-db afldb_prod --expect-oid 66668 \
  --expect-sysid 7674454702926115004 --expect-rows 669 --commit   # 2) only after 1) passed and the backup is verified
```

## 3. Preconditions (each checked inside the transaction; any difference rolls back and exits 1)

1. Approval B1a given; A published; B1 done and `release.mjs status --expect <new id>` PASS (so the release in service matches the checkout that runs this).
2. A **backup taken and verified immediately before**, in the same sitting, of `afldb_prod` (`backup.sh --dir <dir>`, never bare: the serving
   checkout's bare `backup.sh` prunes dumps; verify the dump lists and its sha256 is recorded). No scheduled backup exists (B6 not installed).
3. `afldb-settle-afl-api.service` inactive; no other write job running (`systemctl is-active`, `pgrep -af "settle|import_|rebuild"`).
4. Inside the transaction: identity is `afldb_prod`/66668/`7674454702926115004` and the session is read-write; `seasons.status` 2026 = `complete`;
   exactly 3 coverage rows; 0 `brownlow_season_votes` rows for 2026 (a loaded medal is out of scope: stop); exactly 669 player-season rows
   for 2026 (`--expect-rows`). If neither a coverage row nor a player-season row reads `not_applicable`, it exits `NOTHING-TO-REPAIR` (0).

## 4. Assertions (inside the same transaction, before COMMIT)

- `brownlow_season_total` and `brownlow_match_votes`: `pending`, `is_recorded = false`; `brownlow_round_votes`: `pending`, or `partial` only
  when 2026 round-vote rows exist and (a) ran (B0: (a) will not run, so it stays `pending`).
- 2026 `player_season_stats`: one status only, `pending`, 669 rows, 0 non-null votes.
- Brownlow `not_applicable` coverage rows for seasons ≥ 1924 outside 1942–1945: 0; for 1942–1945: 12.
- Fingerprints of `player_season_stats` (status/votes counts per season) and of `stat_availability` for every season other than 2026 are
  unchanged; the 2026 coverage rows are unchanged when (a) did not run.

## 5. After COMMIT

Re-read with the B0 probe's `pss2026`/`cov2026` queries (read-only): 669 × `pending`. Public pages converge without a restart: `/players/[slug]`
and `/seasons/[year]` use `revalidate = 3600`, so a page cached before the repair is regenerated on the first request after it expires
(at most about an hour, per worker). The public note then reads "Not yet awarded" / "The season is still in progress; the Brownlow Medal has
not been awarded." until D-365-W changes the `pending` wording (a code change; no data step).

## 6. Recovery

- Primary: the exact inverse, valid only because B0 and the precondition fixed the prior state (all 669 rows `not_applicable`, votes NULL):
  `UPDATE player_season_stats SET brownlow_status = 'not_applicable' WHERE season = 2026 AND brownlow_status = 'pending';` in one
  transaction, expecting 669 rows (it re-introduces the defect; use it only if the repair itself caused a fault).
- Backstop: the verified dump from precondition 2 (a full restore is a separate, owner-approved operation; it would discard every write
  since the dump).

## 7. Rehearsal

`dry-run.txt`: the runner, unmodified, on fresh copies of the 4 Nov snapshot template (state identical to production for 2026, see
`../B0-FINDINGS.md` §2) and of the accepted rebuild, at the new executable revision: dry run, two refusal cases (wrong row count, wrong
database name), `--commit` on the disposable copy, and a re-run after it; each copy was then dropped. It is a rehearsal on a
production-derived copy, not a production run.
