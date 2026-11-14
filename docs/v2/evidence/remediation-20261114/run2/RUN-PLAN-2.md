# Remediation run 2 (2026-11-14) — plan

Continuation of the remediation run from candidate `claude/remediation-20261114` at `e8666c17` (origin/main `de640826`
unchanged). Owner instruction 2026-11-14: finish all remaining work under the existing local implementation and
qualification authority (AGENT-PROTOCOL.md §2 applies unchanged). **Not authorised:** publication, production/DEV writes,
deployment, installation, restart, reboot, configuration change, log deletion. `D:\dev\afldb` and every ISSUE-331
restriction are preserved. Read-only production checks follow AGENT-PROTOCOL.md §6 and only where a brief grants them.

## Candidate state at start (verified 2026-11-14)

- Tip `e8666c17`, tree clean, last code change `3aa82166`, final code check `6c8b02cd`.
- Evidence manifests at `e8666c17` (`run2/evidence/manifest-verify-e8666c17.tsv`): 115 committed entries match, **5 do not**
  (`qualification/SHA256SUMS`: `iso-3aa82166/{build-next.log,serve.out,serve2.out,serve3.out}`, `visual/serve3.out`).
  The host originals hash to the manifest values; the committed blobs are the same bytes with CR removed by
  `.gitattributes` `* text=auto eol=lf`. 118 entries name host-only files (not committed; to be re-hashed on the host).
- Actual blockers (owner): publication; B1–B7 production operations; D-350-1; D-332-1; D-HO-1..7; O-1 (logs), O-3.
- Unfinished but already authorised (this run): ISSUE-363 per-file DB, ISSUE-364 gate wiring, ISSUE-357 Caddy
  path-shape protection (prepared, not installed), tractable review residuals, procedures, qualification gaps.

## Scopes (one agent each; own worktree `D:\dev\afldb-rem2-<scope>` on `claude/rem2-<scope>-20261114` from `e8666c17`;
own scratch `D:\tmp\afldb-rem2-<scope>\`; own host workspace `/mnt/ssd/afldb-rem2-<scope>-20261114`, port, `_test` DBs)

| Scope | Port | Content |
|---|---|---|
| `evidence` | — (host read-only) | Fix the 5 CR discrepancies (raw bytes, `-text` attribute, no overwrite of verdicts); re-hash every host-only manifest entry; tested-revision table and carry-forward by file identity; failure-by-failure classification of every remaining failure (§1–§4 of QUALIFICATION.md) with evidence. |
| `tests363` | 55651 | ISSUE-363: per-file disposable databases for suites that commit fixtures; keep the leak guard and `_test`/identity guards; move awards 2091/2093. |
| `lint364` | 55652 | ISSUE-364 O-2: wire `lint:gate` into preflight/merge:ready/release qualification; refusal tests; ratchet wording; B-07 named refusal; A-09 distinguish check failure from drift. Baseline never expands. |
| `caddy357` | 55653 | ISSUE-357: Caddy path-shape deny, tested with the real Caddy binary on loopback against legitimate URLs, encoded paths, query strings and bypass variants; residual growth quantified; not installed. |
| `public` | 55654 | B-03 Round surname, B-04 int4 token validation, B-08 singular rivalry, B-06 bounded compare queue, ISSUE-360 tie window: can it omit genuine tied holders (fix or document). Parser change: parser suite + parse-only V5 corpus. |
| `admin` | 55655 | A-05 legacy NULL-`match_id` Brownlow votes in the Match Sheet dependents check; B-05 admin re-authentication after an epoch bump; per the contracts, no invented data, no security weakening. |
| `ops` | — (prod read-only if needed) | `--attended` caller/runbook review with proof; separate procedures (season opening, patching, reboot, notifier, backups/off-host, Caddy logging) with prerequisites, roles, validation, failure, recovery; notifier actual delivery path (A-07); sensitive-log access/retention proposal; ISSUE-332 proposed gates vs adopted decisions. |
| `fixtures` | — | Search authorised retained locations only (host `/mnt/ssd/afldb/records`, `/mnt/ssd/afldb/workspaces`, DEV read-only snapshot dirs) for the fitzRoy core snapshots and `person-html-20260826/sample.json`; provenance and hashes; never fabricate; report exact missing files. |

## Integration and qualification (orchestrator)

1. Plan review (`afldb-reviewer`) before any execution step; CRIT/HIGH stops.
2. Integrate scope commits with `cherry-pick -x` in dependency order onto `claude/remediation-20261114`.
3. Final qualification on the final executable revision on streamanator (fresh workspace `/mnt/ssd/afldb-rem2-int-20261114`,
   port 55660): typecheck, lint gate, unit (with the integration exclude), integration with per-file databases, focused
   regressions, production build, AFLW `%27` metadata on the integrated build, visual capture for any UI change. Repeat
   nothing whose code and inputs are byte-identical to an already passed run (justified by `git diff` on the inputs).
4. Independent review of the complete delta `de640826..final` (`afldb-reviewer`), then fixes.
5. Records: `issues.md` (+ Open Issues table), `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`, `HANDOFF.md`, new
   `APPROVAL-PACKET-2.md`; tree clean; every agent and host process stopped; no scratch deleted outside this run.

## Amendments after plan review (`PLAN-REVIEW-2.md`: 0 CRIT, 0 HIGH, 12 MED, 3 LOW — all adopted)

- **P2-01 order:** integrate → independent delta review → fixes → qualify revision **Q** (final code). After Q, records
  only, proven by `git diff --stat Q..tip` listing only documentation/records paths.
- **P2-02 caddy357:** every config `admin off`; only `caddy run|validate|adapt --config <own file>` (binary from
  `/usr/bin/caddy` v2.11.9 and the run-1 `caddy-2.11.4` copy, each sha256 recorded); `reload`, `stop`, `fmt --overwrite`,
  `systemctl` forbidden; `ss -ltnp` before/after. Ports 55653 (Caddy) and 55663 (upstream).
- **P2-03 tests363:** per-file mode opt-in by environment variable; creates/drops only names it generated in the same
  process (prefix + nonce + `_test`), never the DSN-named base; refusal unit test; never port 5432.
- **P2-04 fixtures:** exact roots only (`/mnt/ssd/afldb/records`, `/mnt/ssd/afldb/workspaces`,
  `/home/arm/projects/afldb/data` read-only), file names and `sha256sum` only, no copies, skip `private/`; no workstation
  search. Hits are consumed in place by the integration workspace; unit results stated with and without them.
- **P2-05 evidence:** named exception for exactly the five CR blobs; `qualification/SHA256SUMS` unedited; `.gitattributes`
  rule scoped to those paths; `git add --renormalize .` must change only those five; a host-only entry whose file is gone
  is reported MISSING, never regenerated or dropped.
- **P2-06:** step 5 runs `run2/evidence/verify-manifests.sh` (extended to all manifests) on a fresh clone of the final tip;
  zero mismatches required; output committed.
- **P2-07 file ownership:** `evidence` `.gitattributes`; `caddy357` `deploy/Caddyfile.production`, `deploy/Caddyfile`;
  `ops` `docs/deployment.md`, `docs/backup-restore.md`, `docs/v2/rollback-runbook.md`, `docs/production-cutover.md`,
  `docs/v2/known-gaps.md`, `deploy/afldb-backup*.service`, `deploy/afldb-settle-failure*`, `tools/v2/season-opening-check.ts`;
  `lint364` `package.json`, `tools/dev/**`, `deploy/afldb-settle-afl-api.sh`; `tests363` `vitest.config.mts`,
  `tests/setup.ts`, `tests/integration/guard.ts`, `tests/integration/leaked-fixtures.ts`, `packages/testing/**`;
  `public` `src/search/**`, `src/lib/home-records.ts`, `src/lib/concurrency-gate.ts`, `src/app/clubs/compare/**`;
  `admin` `src/middleware.ts`, `src/lib/auth/**`, `src/app/admin/**`, `src/db/queries/match-sheet.ts`. Anything else:
  ask the orchestrator first. `caddy357`/`lint364` hand procedure text to the orchestrator via their READMEs.
- **P2-08 integration order:** evidence, tests363, lint364, admin, public, caddy357, ops, fixtures. No run-1 integration
  result is carried forward (harness files are inputs to every suite); admin/public integration files re-run under the
  per-file harness.
- **P2-09 lint wiring:** `preflight --mode implementation|merge`, `merge:ready`, documented qualification step only; not
  `deploy/release.mjs`, not `deploy/sync-dev.ps1`, not `--mode read-only`. Acceptance: `git diff e8666c17..final --
  tools/dev/lint-baseline.json` raises no count and adds no file key.
- **P2-10:** `ops` corrects living runbooks with bare promote/rollback; dated packages/evidence are listed as historical.
- **P2-11:** `APPROVAL-PACKET-2.md` supersedes packet 1 (banner on packet 1); combined B7 Caddyfile install (362 filter +
  357 deny); pins re-read; `D:\dev\afldb` conflict list recomputed.
- **P2-12:** A-04, A-08 → `ops`; A-06 and QUALIFICATION §6 gaps → orchestrator; one residual register (`run2/RESIDUALS.md`);
  `DEV-STATE-BEFORE-2.txt` (captured 15:50 AEDT) and `DEV-STATE-AFTER-2.txt` with a diff; `ops` reads no Caddy log content.
- **LOW:** base bundle pre-step recorded in `AGENT-BRIEF-COMMON.md`; heavy jobs (build, full integration) take
  `flock /mnt/ssd/afldb-rem2-base/heavy.lock`; B-05 visual capture only if a page gains text.
