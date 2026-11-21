# Procedure 01: open the 2027 season in production (ISSUE-350, decision D-350-1, gate G0 by 2027-03-10)

Status: **procedure, not executed.** Nothing here has run on production. Author: scope `ops`, remediation run 2, 2026-11-14.
Canonical sources: `docs/v2/evidence/remediation-20261114/rollover/README.md` §5 (public effect), §8 (ceremony), §10 (recovery);
`tools/v2/gap029-ops/prod-stage.sh` (phases); `tools/v2/season-opening-check.ts` (gate). This file adds prerequisites, roles,
the gate command in a form that works on the production host, failure handling and what is unverified.

## 1. Purpose

Production has no 2027 `seasons` row and all 18 current clubs hold `last_season` 2026 (read-only, 2026-11-14). Without the row,
the first nightly settle that has a 2027 unit HALTs `season_row_missing` (with the release carrying the ISSUE-350 change) or
throws `23503 afl_api_match_season_fkey` (with the release running today). The I350 operation inserts the one `seasons` row,
sets `last_season` 2027 on 18 clubs and 18 organisations, and writes one audit `import_batches` row, in one transaction as
`afldb_import`, and proves the result before commit.

## 2. When

Decision **D-350-1** (owner, not yet taken). Recommended (b): at least a week before Opening Round (2027-03-17T00:00Z), so
**by 2027-03-10 (gate G0)**, and after the release of this candidate (B1). Opening earlier is safe but publishes an empty 2027
season page, a 2027 comparison option and a 2027 admin ceiling for the whole off-season (rollover README §5). Choosing never
is a decision to let the nightly HALT from the first concluded match.

Do it in a daytime window: not 02:10-02:40 (scheduled backup, once installed), not 04:50-05:45 (nightly settle), not
05:45-07:15 (apt-daily-upgrade, which can restart `afldb` and PostgreSQL until the procedure-02 policy is installed).

## 3. Prerequisites (all must hold; a missing one is a stop)

| # | Prerequisite | How to check | State on 2026-11-14 |
|---|---|---|---|
| 1 | The candidate is **published** and a revision `R` (40 hex) is frozen; the ceremony checkout is a clean checkout at `R` | `git rev-parse HEAD` equals `R`, `git status --porcelain` empty, on the workstation, before building the tarball | not published |
| 2 | Production was **released** with the ISSUE-350 settle change (B1), so a missed opening HALTs rather than throws | `node deploy/release.mjs status` shows `current` built from a revision at or after the candidate | `current` is `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (pre-candidate) |
| 3 | `data/reference/seasons.json` and `clubs.json` at `R` still state 2027 (`last_season` 2027, `in_progress_seasons` [2027]) | `git show R:data/reference/seasons.json` | true at `e8666c17` |
| 4 | The database identity is as pinned: `afldb_prod`, OID 66668, system identifier 7674454702926115004, ledger head `118_fixtures_unconfirmed_participants.sql` | the `preflight` phase asserts it; the gate command below asserts it again | read 2026-11-14 |
| 5 | A fresh backup is produced by the ceremony itself (`capture`) and restored on an isolated cluster with sealed evidence (`restore-assemble-host.sh`, `STAGE=I350`) | the `plan` phase refuses without it | procedure only |
| 6 | `.env` on the production host holds the role DSNs the tool reads | key **names** `AFLDB_BACKUP_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_OWNER_DATABASE_URL` are present (read-only probe `raw/prod-ro-ops-procedures.txt`); values were never read | names verified |
| 7 | No settle run is in progress and none is due in the window; no release is in flight (`promote` without its restart) | `systemctl is-active afldb-settle-afl-api.service` is `inactive`; `release.mjs status` shows no "restart pending" | per run |
| 8 | The owner is present for `approve` | n/a | n/a |

## 4. Roles

- **Owner**: decides D-350-1; reviews the plan summary and digest; types the approval (`approve`), whose statement must name
  D-350-1 and the digest. Only the owner's approval makes `apply` possible.
- **`arm` on the production host, no `sudo`**: every ceremony phase (`prep`, `preflight`, `capture`, `plan`, `approve`,
  `apply`, `report`, `state`, `accept`) runs as `arm` from the pinned checkout (`prod-stage.sh` refuses any other user or host:
  `EXPECT_USER`). The tool reads as `afldb_backup` and writes as `afldb_import`; both DSNs come from the checkout `.env`
  inside the wrapper and are never printed. **No step needs root.**
- **What `arm` cannot do**: read the system journal (not in `adm`/`systemd-journal`); run `systemctl restart`. Neither is
  needed here.
- **Reversal** (`reverse-opening.sql`) needs `afldb_owner`; that is the owner's credential, run through `run-sql.mjs` or
  `psql --single-transaction`.

## 5. Commands

The ceremony is the I336 one with stage `I350`; run phase by phase on the production host from `OPS_ROOT/<R:0:8>/cand`.
Exact phase grammar: the header of `tools/v2/gap029-ops/prod-stage.sh`. In order:

```
bash prod-stage.sh prep      R <tar sha256>               # verify and pin the uploaded checkout tarball
bash prod-stage.sh preflight R I350                       # read-only: order gate, exclusivity, identity, ledger
bash prod-stage.sh capture   R I350                       # ONE fresh backup; run name I350-<UTC stamp>
# restore that dump on an isolated cluster and assemble the sealed evidence: restore-assemble-host.sh (STAGE=I350)
bash prod-stage.sh plan      R I350 RUN                   # read-only plan, digest, manifest, summary
# OWNER reviews: "1 seasons row; last_season 2027 on 18 clubs and 18 organisations; 1 audit import_batches row; nothing else"
bash prod-stage.sh approve   R I350 RUN <DIGEST> <STATEMENT_FILE> <EXPIRES> [NOT_BEFORE]
bash prod-stage.sh apply     R I350 RUN                   # ONE detached apply; no retry
bash prod-stage.sh accept    R I350 RUN                   # read-only: outcome + state + verify
```

The plan **re-baselines at plan time**: the 2026-11-14 digest (`de1f574b…`) is a pin to compare against, not the value to
approve (the nightly writes `import_batches` rows, so approve the digest `plan` prints).

**Gate G0 evidence (read-only)**, from the pinned checkout, with the node the unit pins on `PATH`. The tool reads the DSN
from the named environment variable and never prints it; load `.env` into a subshell only, as `tools/maintenance/backup.sh`
already does (`set -a; . ./.env`):

```
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
cd "$OPS_ROOT/<R:0:8>/cand"
( set -a; . /home/arm/projects/afldb/.env; set +a
  node --import tsx tools/v2/season-opening-check.ts --dsn-env AFLDB_BACKUP_DATABASE_URL \
    --expect-database afldb_prod --expect-oid 66668 --expect-sysid 7674454702926115004 --json )
echo "exit=$?"
```

**Season-opening refresh (ISSUE-372, owner decision 2026-11-22, option B keeps it).** Immediately after `accept` (and the
G0 check), as `arm`, from the **serving checkout** (it must be a revision carrying `tools/maintenance/revalidate-season.ts`,
i.e. the ISSUE-371/372 release; the production `.env` must hold `AFLDB_REVALIDATE_URL` and `AFLDB_REVALIDATE_SECRET`, absent
on 2026-11-22 per `docs/v2/evidence/backlog-20261121/R0-SITTING-20261122.md`, with the web service restarted after adding
them):

```
cd /home/arm/projects/afldb && export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
npx tsx tools/maintenance/revalidate-season.ts --season 2027; echo "exit=$?"   # expect "REVALIDATED season 2027: 2/2 worker(s)"
```

Exit 0 every worker reached; 1 incomplete (re-run once; if still incomplete, record it); 2 not configured or refused (the
refresh did not happen; record it). Do **not** restart `afldb` as a fallback: a restarted worker does not know the route's
cache-control, so it takes exactly the stale-404 regeneration path this step avoids (ISSUE-371 README §6). The accepted
fallback is the residual itself: the wrong head lasts at most about one ISR window per worker, then the page regenerates
normally. Why:
a `/seasons/2027` 404 cached by any worker before the row existed would otherwise regenerate as a 200 page with the "Page not
found" title and `noindex` for up to one hour (ISSUE-371 README §3). The secret never appears on a command line.

Exit 0 `OPEN`, 10 `NOT_OPEN`, 11 `REFUSED`, 2 usage or helper error. The default `--dsn-env` is already
`AFLDB_BACKUP_DATABASE_URL` (review A-08, verified: `ops/README.md` §2.2); the application role is **not** an accepted
alternative, because it cannot read `afldb_meta.schema_migrations`.

## 6. Validation

1. `accept` reports outcome `COMMITTED_VERIFIED` and state `PLANNED RESULT PRESENT`, with `verify` reporting 0 problems.
2. The gate command above exits **0** (`OPEN`), reports `identityResolvedForYear` 18, season lists for 2026 and 2027 still 18/18,
   and a surface digest different from the pre-opening `de1f574b…`.
3. A second `apply` is `NOTHING_WRITTEN` (exit 0): the idempotence proof; do not run it on production without cause.
4. Public effect, as predicted in the rollover README §5: home `seasons` +1 and `lastSeason` 2027; `/seasons/2027` valid and empty;
   2027 selectable (provisional) in club comparison; admin fixtures and season lists administrable for 2027. Check with the
   public smoke after the next ISR window, not by assuming.
5. First nightly after opening (proposed gate G0c in `ops/README.md` §5): `c7-observe.ts` or the status check of procedure 04
   shows the run applied with no `season_row_missing` HALT. A successful post-opening nightly with a real 2027 round is **not
   proven by any rehearsal** (the shared fixture was a preliminary final).

## 7. Failure handling (no retry, no improvisation)

| Outcome or symptom | Meaning | Action |
|---|---|---|
| Any phase refuses (identity, ledger, order, backup age, digest, approval expiry) | a gate worked | fix the cause named; re-run **that** phase; never edit the manifest |
| `ROLLED_BACK` | the in-transaction proof failed or the baseline drifted | nothing was written; read the outcome report; re-plan from `plan` with a new run |
| `OUTCOME_UNDETERMINED` | the apply process ended without a recorded outcome | run `state` (read-only) and decide from its classification; **do not run `apply` again** |
| `NOT_OPEN` after a `COMMITTED_VERIFIED` | cannot happen by design | stop; report; do not reverse without the owner |
| Gate exit 11 `REFUSED` | the database holds something the contract does not allow | stop, owner decision |
| Gate exit 2 | helper error (DSN unset, role cannot read the ledger, identity mismatch message) | fix the invocation; never substitute another role |

## 8. Recovery

`docs/v2/evidence/remediation-20261114/rollover/reverse-opening.sql`: owner-run, one transaction, count-bounded; restores the
planned clubs' and organisations' `last_season` and deletes the `seasons` row. It refuses (foreign keys onto `seasons(year)`)
if anything depends on 2027, which is the intended "do not reverse" signal. **The id lists in the file are the 2026-11-14
production values: re-check them against the approved plan's `changes.clubIds` and `changes.orgIds` before any use.** The audit
`import_batches` row stays (history). After a restore of the pre-change backup instead, follow `docs/backup-restore.md` §6
procedure A (a restore over production is not a routine step).

## 9. Unverified

- The production run itself: no step of this procedure has executed on production. Rehearsal evidence is on isolated snapshot
  copies only (rollover README §6), including the reversal; the reversal's "dependents present" refusal was not exercised.
- `prod-stage.sh prep` on the production host with the production profile (`profile.production.env`): the profile contents were
  not read here.
- The `( set -a; . .env; set +a; node ... )` gate invocation on the production host: key names are verified, the invocation is not.
- A successful nightly after opening on real 2027 data.
