# R8 DRAFT: open the 2027 season on production, Tuesday 23 February 2027 11:00 AEDT (ISSUE-350; FOR APPROVAL, NOT EXECUTED)

**Status.** Draft production plan, prepared 2026-11-22 (backlog run c) on the owner's planning date (decision 6). Nothing has run.
It needs its own owner approval, and the `approve` phase needs the owner's typed digest on the day. Sources: procedure 01
(`docs/v2/evidence/remediation-20261114/run2/ops/procedures/01-season-opening.md`, §3-§8), packet R8, `kits/KITS-20261122.md` R8,
`tools/v2/gap029-ops/prod-stage.sh` header, `profile.production.env`. Re-derive every pin below in the week before; any difference
is a STOP.

## 1. When

- **Tue 23 Feb 2027, 11:00 AEDT (= Tue 00:00Z)**: after the weekly 10:00-10:30 slot (never inside it; the opening is its own
  operation). Inside the owner's window 2027-02-15..03-03; gate G0 by 2027-03-10; Opening Round 2027-03-17.
- Avoid 02:10-02:40 (scheduled backup, once R3 is installed), Wednesday 03:20-03:45, 04:50-05:45 (settle), 05:45-07:15 (apt).
- `prep`, `preflight` and `capture` plus the isolated restore and `plan` may run a few days earlier (proposed Thu 18 Feb 2027
  10:30 AEDT); the plan digest re-baselines at plan time and the approval binds that digest. If anything writes `import_batches`
  between `plan` and `apply` (every nightly does), the `apply` gate decides; re-plan rather than force.

## 2. Revision R and pins (to re-derive)

| Pin | Expected | How |
|---|---|---|
| R (execution revision) | the serving revision after A1: **`7d92042fd11010eaa20966e2f49ae7a93e286568`** if A1 is accepted (it carries stage I350: `prod-stage.sh` and `tools/v2/` are unchanged in `c8d4202a..7d92042f`). If A1 did not release, R = `c8d4202a…` and step 9 cannot run (see §4) | `release.mjs status`; `git show R:data/reference/seasons.json` states `last_season` 2027 |
| Database | `afldb_prod`, OID 66668, system id 7674454702926115004, ledger 118 rows, head `118_fixtures_unconfirmed_participants.sql` | `preflight` asserts; the G0 check asserts again |
| Node | v22.23.2 at `/home/arm/.nvm/versions/node/v22.23.2/bin/node` | profile |
| OPS root | `/home/arm/ops/gap029-stages/<R:0:8>/cand` | profile |
| Comparison digest | the 2026-11-14 `de1f574b…` is for comparison only; approve the digest `plan` prints | — |

## 3. Preconditions (each a STOP)

1. **G0b**: R2 delivering: the forced-command key installed (A2), the hourly check approved and running, delivery proven (proven for
   the channel on 22 Nov). Without the hourly cron, G0b is only partly met: the owner decides whether to open anyway.
2. **R3 verified**: scheduled backups running, at least one verified off-host copy, and the first-copy restore recorded (A2).
3. **The 371/372 release is serving with `AFLDB_REVALIDATE_URL`/`AFLDB_REVALIDATE_SECRET` in `.env`** (A1), or the refresh step is
   knowingly skipped (residual: a stale `/seasons/2027` 404 head for up to one ISR window per worker).
4. Procedure 01 §3 rows 1-8: R published and pinned; production released with the ISSUE-350 settle HALT (packet R8 re-derived `c8d4202a` as qualifying; re-check against `current`);
   `.env` key names present; no settle in progress and none due; no release in flight; the owner present for `approve`.
5. Admin season editor quiet; no other attended operation in the window.

## 4. Commands (procedure 01 §5 verbatim with R; production host, `arm`, from `<OPS>/cand`)

```
bash prod-stage.sh prep      R <tar sha256>          # 1. verify the uploaded R tarball, extract, pin (idempotent)
bash prod-stage.sh preflight R I350                  # 2. read-only: order gate, exclusivity, identity, ledger
bash prod-stage.sh capture   R I350                  # 3. ONE fresh backup (BACKUP_ROOT, never pruned); run name I350-<stamp>
# 4. streamanator: restore that dump on a NEW isolated cluster and assemble the sealed evidence (restore-assemble-host.sh, STAGE=I350)
bash prod-stage.sh plan      R I350 RUN              # 5. read-only plan: digest, manifest, summary
#    OWNER reviews: "1 seasons row; last_season 2027 on 18 clubs and 18 organisations; 1 audit import_batches row; nothing else"
bash prod-stage.sh approve   R I350 RUN <DIGEST> <STATEMENT_FILE> <EXPIRES> [NOT_BEFORE]   # 6. owner act
bash prod-stage.sh apply     R I350 RUN              # 7. ONE detached apply; no retry
bash prod-stage.sh accept    R I350 RUN              # 8. read-only: COMMITTED_VERIFIED + state + verify
```
Then, from the serving checkout (`/home/arm/projects/afldb`):
```
( set -a; . /home/arm/projects/afldb/.env; set +a
  node --import tsx tools/v2/season-opening-check.ts --dsn-env AFLDB_BACKUP_DATABASE_URL \
    --expect-database afldb_prod --expect-oid 66668 --expect-sysid 7674454702926115004 --json ); echo "exit=$?"   # G0: exit 0 OPEN, identityResolvedForYear 18
npx tsx tools/maintenance/revalidate-season.ts --season 2027; echo "exit=$?"   # 9. expect 0, "2/2 worker(s)"; never restart as a fallback
```

## 5. Effect, acceptance, recovery

- **Effect:** 1 `seasons` row (2027); `last_season` 2027 on 18 clubs and 18 organisations; 1 audit `import_batches` row. Publicly,
  max season 2027 after the refresh (or after the ISR window). No interruption.
- **Acceptance:** `COMMITTED_VERIFIED`; G0 exit 0 `OPEN` with `identityResolvedForYear` 18; step 9 exit 0 with 2/2; **G0c**: the next
  nightly (24 Feb ~05:00) applies with no `season_row_missing` HALT (R2 check OK plus unit `Result=success`, or `c7-observe.ts`).
- **Recovery:** `reverse-opening.sql` as `afldb_owner`, only while nothing depends on 2027; re-check its id lists against the plan's
  `changes.clubIds`/`changes.orgIds` (procedure 01 §8). Failure handling: procedure 01 §7 (no retry, no improvisation).

## 6. Approval text (blank; separate from A1/A2)

> I approve opening season 2027 on production per procedure 01 with execution revision ________, plan digest ________, on
> Tuesday 23 February 2027 from 11:00 AEDT (D-350-1); capture and plan may run from ________.
