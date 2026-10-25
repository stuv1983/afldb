# v4 → v5 delta

The machine-checked inventory is `V5-DELTA.json` (v4 and v5 SHA-256 for every member). Rationale per
change follows. Each change falls in one permitted class: **T** transport, **P** principal/identity
binding, **A** attempt-marker boundary, **O** replacement operational observation integration,
**V** tests/evidence required by those changes, **R** record/approval binding that those changes
make necessary.

## Byte-identical to v4

`assert-post.sql`, `canonical-gates.sql`, `lock-assert.sql`, `locks.sql`, `migration-guard.sql`,
`snapshot.sql`, `note.txt`, `expected-migrations.json`, `protected.json`, `schema-evidence.json`,
`audit-log-source.txt`, `audit-schema-source.txt`, `ACTOR-EVIDENCE.json`, `SEMANTICS.md`,
`V3-NO-GO.md`, `validate-order.cjs`. These hold all lock, snapshot, protected-data, drift and
assertion semantics.

## Changed

| File | Class | Exact change |
|---|---|---|
| `identity.sql` | P | `session_user`/`current_user` = `afldb_owner` (was `postgres`). Database, OID and system identifier unchanged. |
| `preflight.sql`, `repair.sql`, `postcheck.sql` | P | One added line: `\ir principal.sql` directly after `\ir identity.sql`. In `repair.sql` that is after every lock, so the F-004 pre-lock prefix is unchanged. |
| `operational-guard.sql` | P | Visibility record and refusal unless `update_process_title=on` (or superuser / `pg_read_all_stats`), inserted before the unchanged PASS marker. The v4 checks are unchanged. |
| `repair-body.sql` | R | Only the `execution_operator` literal: names Claude Code and the `afldb_owner` transport (was "Codex … sudo postgres"). Both writes, all guards and the audit shape are unchanged. `database_session_user` and `database_current_user` are still recorded dynamically. |
| `checks.sql` | R | Only the literal expected `approval_reference`, set to the current owner instruction. |
| `binding.json` | R | `approval_reference` and `approval_sha256` (hash of the new `OWNER-RULING.md`). Actor, note, edit94, authority93 and constraints are unchanged. |
| `OWNER-RULING.md` | R | v4 text plus the appended v5 ruling excerpt. |
| `operational-host.sh` | O | Rewritten: no sudo, pipefail, each producer's status checked; host part of the passed observation; stdin closed. Closes F-006. |
| `run.cjs` | T, A, O | Observation, then read-only prerequisite session, then marker, then one write session; pinned transport call; principal markers required. The v4 SQL composition and verdict logic are kept. |
| `runtime.json` | T | Same Node/SSH pins; trusted remote paths updated (no `sudo`/`env`); credential location documented. |
| `README.md` | — | Rewritten for v5. |
| `DERIVATION.json` | — | Derived from v4; source of the observation copy. |
| `validate.cjs` | V | `sql()` also omits `principal.sql` unless asked; adds the principal-refusal case; scope text. All 19 v4 cases unchanged. |
| `validate-pg.cjs` | V | Role-model fixture; inherited cases run as `afldb_owner` with `principal.sql`; new principal and transport cases; credential-leak scans; SCRAM-verifier role setup. Inherited database assertions unchanged. |
| `validate-remote.cjs` | V | Transfer allowlist adds `principal.sql`, `transport.sh`, `operational-host.sh`; v5 directory names; longer timeout. |
| `validate-wrapper.cjs` | V | Rewritten for the three-spawn boundary (30 cases plus static composition). |

## Added

`principal.sql` (P), `transport.sh` (T), `operational-observation.sh` (O; byte copy of the passed
observation), `V4-REVIEW.md` (v4 GO report, for lineage), `V5-DELTA.md`, `V5-DELTA.json`, and the
regenerated `VALIDATION.json`, `WRAPPER-VALIDATION.json` and `VALIDATION-EVIDENCE.json`.

## Removed

`PG-TRANSPORT.json`, `PG-TRANSPORT.stdout.log` and `PG-TRANSPORT.stderr.log`: the v4 candidate's
failed validation-transport record, which stays in frozen v4.
