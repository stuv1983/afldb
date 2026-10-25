# ISSUE-316 v4: unprivileged replacement observation, then STOP before the frozen wrapper

Owner instruction (2026-10-25 Sydney): the failed `sudo -n ps` observation (`../metadata-repair-v4-production-20261024T200631Z/`)
is a pre-attempt harness failure. It consumes no attempt. Replace only the external observation with a no-sudo `arm`
observation. If that passes, reverify the pins, then run the frozen preflight, repair and postcheck once. No sudo
credentials, sudoers change, PostgreSQL grant or host-security change.

## Artifacts (separate from the frozen v4 package)

| File | SHA-256 |
|---|---|
| `operational-observation-v2.sh` (as run) | `8ac6c6fea81743595418139bb257903ee8b2bd23881cc66615b4f49fd9e095dc` |
| `observe-only.cjs` (as run) | `2ec301ce3e7fda50d7116d4dc87bb51689445890b9e1dedeaad7a2db5a5cc268` |
| `observe-only.cjs` (current, oid comparison fixed after the run) | `9b054860055360a70f62e217e28074d9dcaff642e17a7be568c4d9a483033349` |

The script runs as `arm` with no sudo and writes nothing on the host. Each producer's exit status is checked before its
captured output is analysed. Process arguments are kept with credentials redacted (URL userinfo and `*pass*=`/`*token*=`
style values). The launcher is observe-only: it never invokes `run.cjs execute` and never creates `ATTEMPT.json`.

## Result: run `run-20261024T202811Z/` (2026-10-24T20:28:11–12Z = 2026-10-25 07:28 AEDT)

Every remote gate passed (SSH exit 0, empty stderr, `I316_OBS_DECISION=PASS`):

- **Host:** `afldb-prod` / `arm`. `/proc` is mounted `rw,nosuid,nodev,noexec,relatime`, with no hidepid.
- **Processes:** `ps` exit 0; 131 rows, 0 malformed. PID 1 root arguments are visible. 34 non-`arm` processes have
  readable arguments (root, postgres, caddy, systemd-* and others). 8 postgres rows, 7 of them PostgreSQL process
  titles, including 2 `afldb_prod` client backends. The `afldb.service` MainPID 2626763 (`server-cluster.mjs`) is
  visible. `UNSAFE_PROCESSES 0`.
- **Services:** `afldb.service` is active/running and has been since 2026-10-18 13:06 AEDT. No relevant queued jobs and no
  relevant transitioning services. `afldb-settle-afltables.service` is inactive (its timer next fires on 2026-10-26 at
  04:31 AEDT). The afl-api, brownlow and email-intake units are not installed. No Git operation markers are present in the
  deployed checkout.
- **Database** (read-only `afldb_backup`): identity `afldb_prod`, OID 66668, system ID 7674454702926115004, read_only on,
  PG 160015. The role is not a superuser and lacks `pg_read_all_stats`, so the query text of both `afldb_app`/`postgres.js`
  sessions is redacted. `update_process_title=on`, and the host process titles were proven visible, which covers the
  redaction. Every activity count is 0: DDL, idle-in-transaction, tooling application names, schema-class relation locks,
  prepared transactions, create-index, cluster, COPY FROM and manual-vacuum progress.

The launcher then reported `Observation STOP: identity`. This was a false stop caused by my launcher, not a production
finding: `jsonb_build_object` renders the `oid` as the string `"66668"`, and the launcher compared it with the number
`66668`. The comparison is now `String(identity.oid)==='66668'`. I did not contact production again just to re-record a
PASS, because any execution must be preceded by its own fresh observation anyway.

**Pin reverify (local, read-only, after the run):** `run.cjs verify 829fc30a…848ecf84` gives `PACKAGE_HASHES_PASS`.
REVIEW.json is `39e71a77…04a913a2` (GO, 0 stopping findings, manifest pin matches) and REVIEW.md is `c36dc24a…2374712`.
There is no `ATTEMPT.json`.

## STOP before the frozen wrapper: the frozen repair itself requires passwordless sudo

The frozen package does not use only the external observation's privileges:

- `metadata-repair-v4/run.cjs:69` runs `exec sudo -n -u postgres env -i … /usr/bin/psql … --dbname=afldb_prod -f -`.
  `metadata-repair-v4/identity.sql:5` refuses unless `current_user` and `session_user` are both `postgres`. No sudo-free path
  exists without changing the frozen bytes.
- `run.cjs:63` creates the exclusive `ATTEMPT.json` **before** SSH. After that, the package refuses any relaunch, even if
  the failure happened before any database contact.
- `metadata-repair-v4/operational-host.sh:7` runs the same `sudo -n /usr/bin/ps` that failed with `a password is required`.
  Under `set -eu` without pipefail it then fails open and prints `I316_OPERATIONAL_HOST_GATE_PASS` (retained F-006 LOW). It
  is now deterministic rather than hypothetical, though the replacement observation covers it.
- Evidence about `arm`'s sudo on production: `sudo -n ps` needs a password (2026-10-24T20:07:59Z). The DEV records show
  password-required `(ALL : ALL) ALL` (ISSUE-238 handoff), and `issues.md` records an earlier `sudo -n systemctl` failure.
  No repository evidence shows a NOPASSWD rule that matches the exact `env -i … psql` command line as `postgres` on
  `afldb-prod`. That hop has never been exercised on production; v4 validation used a private cluster on streamanator.

Running the wrapper would therefore most likely create `ATTEMPT.json`, then fail at `sudo -n -u postgres` before psql
starts. The owner's own boundary forbids fixing that with credentials, sudoers or grants. Launching it would spend the
package's single-launch marker on a precondition already known to be unmet. Per the stop condition "the repair execution
is ambiguous", and because this contradicts the instruction's premise that only the external observation needed sudo,
execution is returned for owner adjudication.

**Not done:** no `run.cjs execute`, no `ATTEMPT.json`, no frozen preflight, no `postgres`-role connection, no sudo of any
kind, and no production write. The attempt is unconsumed and the frozen package is unchanged. U3 is unconfirmed; U4 stays
Route B; Brownlow is untouched; production remains NO-GO. No census, seal/rollover, successor activation, apply,
deployment, rebuild or push.

## Owner decision needed

1. **Confirm the `postgres` hop.** If a NOPASSWD rule for that exact command already exists, the owner can confirm it
   (for example by checking `/etc/sudoers.d` interactively). Then resume with a fresh `observe-only.cjs` PASS immediately
   before `run.cjs execute`, accepting that `ATTEMPT.json` is created first and that F-006 will fail open.
2. **Otherwise, the frozen v4 cannot execute under the current boundary.** The frozen `sudo -n` never prompts, so an
   interactive password cannot be used without changing the frozen bytes. The routes left are both the owner's call: a
   narrowly scoped NOPASSWD rule for that exact command, which is an owner security decision this session will not take,
   or a v5 whose transport and identity bind differently. A v5 needs new validation and an independent review.
