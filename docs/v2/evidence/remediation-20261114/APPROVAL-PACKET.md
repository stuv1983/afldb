# Remediation run 2026-11-14 — approval packet

> **SUPERSEDED (2026-11-14, remediation run 2) by `run2/APPROVAL-PACKET-2.md`.** Do not approve from this file: its candidate, pins,
> B3 (notifier: it delivers nothing on its own) and B7 (the Caddy install is now one combined file with a different hash) are
> out of date. It is kept unchanged below as the run-1 record.

One packet, two kinds of approval: **A. publication** (Git only), then **B. production operations**, each a separate owner
approval in the order given. Nothing in this packet has been executed. Pins below were read on 2026-11-14 (read-only) and
must be re-read immediately before each step; any difference is a stop.

## Pins

| Pin | Value (2026-11-14) |
|---|---|
| `origin/main` | `de640826` (unchanged since the full review) |
| Candidate | the tip of local branch `claude/remediation-20261114`: the commit that adds this packet (`git log -1 --format=%H -- docs/v2/evidence/remediation-20261114/APPROVAL-PACKET.md`). Last code change `3aa82166`; final code check at `6c8b02cd` (`QUALIFICATION.md` §2). Contains the review commit `5035ed96` and every remediation commit after it (`HANDOFF.md`). |
| Production database | `afldb_prod`, OID 66668, system identifier 7674454702926115004; ledger head `118_fixtures_unconfirmed_participants.sql` |
| Production releases | `current` `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`; `previous` `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN` |
| Production `AFLDB_BETA_EPOCH` | `1` (so the ISSUE-362 epoch-held admin claims change nothing at deploy) |
| Production 2027 season | `NOT_OPEN` (seasons stop at 2026; 18 open club identities hold `last_season` 2026) |
| Production host | kernel 6.8.0-137 running, newer installed, `/var/run/reboot-required` present since about 2026-08-16 |
| DEV | `8b024098` (branch `dev-v2-main`); not touched by this run |
| Schema change in the candidate | **none** (no file under `src/db/migrations/`) |

## A. Publication (Git; recommended: approve)

**What:** fast-forward `origin/main` from `de640826` to the candidate tip. That publishes the full-review commit `5035ed96`
and the remediation commits (list: `HANDOFF.md`). No deployment follows automatically.

**Before:** `git fetch origin` and confirm `origin/main` is still `de640826` (otherwise stop: rebase is a new qualification).
**Command (owner):** from the integration worktree, `git push origin claude/remediation-20261114:main` (a fast-forward; refuse
`--force`). **Recovery:** a further revert commit; never rewrite `main`.

**Breaking change to note:** `deploy/release.mjs promote`/`rollback` now require `--attended` (ISSUE-351, D-HO-4).

**Conflict warning:** the `D:\dev\afldb` worktree (branch `claude/issue-339-deploy-preflight`) has unrelated uncommitted
edits to files this candidate also changes (`issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `blockers.md`,
`docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md`, `src/db/queries/admin-draft.ts`, `src/lib/auth/session.ts`,
`tests/auth.test.ts`, `tests/integration/admin-draft.test.ts`, `tests/afl-api-ingestion-safety.test.ts`,
`tests/gap029-ops.test.ts`, `tools/v2/gap029-ops/prod-stage.sh`; 12 files in all). Expect a
merge when that work is next committed. Nothing in that worktree was touched.

## B. Production operations (each separately approved; order matters)

### B1. Release the published candidate to production (recommended: approve, in a normal attended window)

Code-only; no migration. Follows `docs/deployment.md` (now with `--attended`). Effects visible to users: the fixes for
ISSUE-353 to 361 and the `next dev`/sitemap rewrite. The serving checkout's `deploy/afldb-settle-afl-api.sh` gains the
warn-only `node_modules` check. Gate: `node deploy/release.mjs host-gate` before promote (it refuses while apt runs or is due
within 90 minutes). Verification: `release.mjs status --expect <new id>`, `deploy/post-install-check.sh <new id>`, the
public smoke. Recovery: `release.mjs rollback --attended` to `c1c4b22e…` (no schema difference).

### B2. ISSUE-350: open the 2027 season (decision D-350-1; recommended (b): at least a week before 2027-03-17, after B1)

The I350 ceremony on the production host from a clean checkout at the published revision: `prep` → `preflight` → `capture`
(fresh backup) → isolated restore and evidence → `plan` (read-only; the owner reviews the summary *1 `seasons` row; `last_season`
2027 on 18 clubs and 18 organisations; 1 audit `import_batches` row; nothing else* and the digest) → `approve` (typed digest,
statement naming D-350-1) → `apply` (one run, no retry) → `accept` → `season-opening-check.ts` exit 0 `OPEN`. Full procedure:
`rollover/README.md` §8. Recovery: `reverse-opening.sql` (owner, single transaction) only while nothing depends on 2027.
Rehearsed on snapshot copies: apply, verify, idempotent re-apply, reversal.

### B3. ISSUE-332: install the settle failure notifier (D-332-1; recommended: install, then choose a transport)

Four `sudo` commands in `rollover/README.md` §9 (template unit, drop-in directory, drop-in, `daemon-reload`). Changes no
schedule and enables no job. Recovery: remove the drop-in and `daemon-reload`. Limit: the template has
`PrivateNetwork=true`; a network transport needs a unit change later.

### B4. ISSUE-351: host patching policy (D-HO-1, recommended: install both files + weekly owned window)

`sudo install -m 0644 deploy/host-policy/needrestart-afldb-hold.conf /etc/needrestart/conf.d/50-afldb-hold.conf` and
`sudo install -m 0644 deploy/host-policy/apt-52-afldb-unattended.conf /etc/apt/apt.conf.d/52-afldb-unattended`. Security
updates keep installing; only the automatic restarts of `afldb`/PostgreSQL and unattended PostgreSQL server upgrades stop.
Verify: `sudo needrestart -r l`, `apt-config dump | grep -i Package-Blacklist`, `node deploy/release.mjs host-gate --strict`.
Recovery: `sudo rm` both files. Cost: a weekly 30-minute owned window (`hostops/README.md` §6b).

### B5. ISSUE-351: the pending reboot (D-HO-6; recommended: a separate attended operation, after B4 and a verified off-host backup)

Procedure `hostops/README.md` §6a (outside 05:00–07:00 AEDT; stop the settle timer; reboot; verify kernel, services,
`release.mjs status`, `post-install-check.sh`; restart the timer). **Unverified:** DigitalOcean console/GRUB access for a
fallback to kernel 137. Confirm that access first.

### B6. ISSUE-352: scheduled backups (D-HO-2/3/5/7; recommended: install units after B1; destination A; no post-settle dump yet)

Install per `docs/backup-restore.md` §3, with an attended first run of `afldb-backup.service` and `afldb-backup-verify.service`
and `scheduled-backup.sh status` exit 0, then enable the timers (02:20 daily; Wednesday 03:30). Off-host: option A, pull with
`tools/maintenance/offhost-pull.sh` from an owner host using a forced-command read-only key. D-HO-7 (stale `afldb_prod_*`
databases) is a separate owner choice. Recovery: disable the timers, remove the units.

### B7. ISSUE-362: install the Caddyfile and handle pre-fix logs (O-3, then O-1; recommended: both)

O-3: back up `/etc/caddy/Caddyfile`; install `deploy/Caddyfile.production`; `sudo caddy validate --config
/etc/caddy/Caddyfile`; `sudo systemctl reload caddy` (no restart); probe `https://beta.afldb.com/beta/verify?token=PROBE` and
confirm the newest log line shows the redacted URI. Recovery: restore the backup and reload. O-1: after O-3, check
`auth_invites` expiry, then roll and delete the pre-fix `afldb-access.log*`/`afldb-apex.log*` (irreversible by design).

## C. Decisions that need no production action now (recommendations)

| Issue | Decision | Recommendation |
|---|---|---|
| 348 | Reconciliation at the Nov–Dec acquisition; REPLACE_CLUB 5961/6784/6626; 6,845 contract re-baseline | run `--guard-report`, owner rules each replacement, re-baseline only with the reviewed reconciliation |
| 357 | ISR residual (~50 KB per distinct 404/redirect path) | Caddy deny of junk path shapes + accept the residual (monitor disk) |
| 363 | Committed-fixture leaks in the shared integration DB | per-file disposable database for those suites; move awards 2091/2093 |
| 364 | Lint gate | run `npm run lint:gate` in the operator pre-merge step |
| 361 | Compare gate default | 2 |
| 360 | Tie policy constants | keep 10 rows / window 200 |
| 356/NL | head-to-head by club slug vs organisation | keep slugs now; organisation ids if lineage reads are wanted |
| 353 | Period stats as a dependent | leave until a writer exists |
