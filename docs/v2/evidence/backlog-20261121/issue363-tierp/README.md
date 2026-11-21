# ISSUE-363 Q9 "S + P-full": opt-in tier P overlay, 22 Nov 2026

Owner decision Q9 = "S + P-full": keep the source-only rebuild (tier S) as the default; add an OPT-IN tier P built from tracked,
reviewed curation evidence; verify the Gridley acceptance ids G-a and G-b on tier P, including a repeat build.

**Result: G-a pass, G-b pass (0 unapproved), G-c FAIL (118 = 78 unsupported + 40 criterion disagreement), solved 10,209/10,287, no
gapped criterion, on BOTH independent tier P builds. The two builds are deterministic (identical content fingerprint, rekeyed evidence,
Gridley summaries). The tier S template is byte-identical before and after.** These are the 21 Nov prototype's numbers, now produced by
a tracked tool.

## 1. What was built

* `tools/v2/rebuild-tier-p.ts`: the tier P overlay (labels via the UNCHANGED audited applier `tools/v2/apply-gap029-match-events.ts`;
  8 Rookie selections via the audited `createManualPickInTransaction`). Contract and refusals: the file header and
  `docs/v2/isolated-rebuild.md` section 7.
* Tests: `tests/v2-gap029-label-checks.test.ts` (30 tests, 26 new): target refusals, rekey happy path and 0 / more-than-one refusals,
  rookie resolution, fingerprint SQL.
* Tier S, `tools/db/rebuild-test.ts` and every default path are unchanged.
* Declared dependency (docs section 7): "G-a and G-b require tier P (curated GAP-029 labels + 8 reviewed Rookie selections)".

## 2. Host, tested revision, what was touched

* DEV host streamanator. Workspace `/mnt/ssd/afldb-backlog-20261122b-363` (0700, 3.4 GB; cluster 1.8 GB). Isolated cluster on port
  **61530**, `AFLDB_V2_PG_ROOT=<ws>/pg`, PostgreSQL 16, Node 22.23.2, `AFLDB_PYTHON=/home/arm/projects/afldb/.venv/bin/python`
  (read-only use). Cluster **stopped** at the end (port closed).
* **Tested revision:** checkout of `claude/backlog-20261122` at `7d92042f` (git bundle of the tip, `npm ci`), plus the three working-tree
  files of this change copied over it. Their sha256 equals the committed files: tool `9fc96a12…1dc0`, test `c7df3b8d…0d85`,
  docs `7d1e0a69…a80f`. The tool records its own hashes (and the applier, editor, evidence and outcomes hashes) in each report.
* The orchestrator's concurrent DraftGuru edits were NOT in the tested checkout: the bridge step ran the committed
  `tools/rebuild/draftguru/import_draftguru.py` at `7d92042f`.
* Nothing else was touched: no other port, cluster or workspace, the shared `afldb_test`, DEV's service/.env/deployment, or production.
  Preserved paths were not read except the three inputs below, which were read-only (dump, restore helper, bridge child, 42 Stage A raw
  pages, verified against the tracked manifest, copied into the checkout and removed again; `porcelain` showed only the 3 change files).
* No production data: the template is the accepted source-only rebuild dump. The only credentials in the databases are the placeholder
  clone-local actors (below); the workspace holds the cluster's own generated role passwords under `pg/secrets` (0600) and no other.

## 3. Tier S template and fingerprint

| Step | Result |
|---|---|
| dump `afldb_v2_rb_rem3-6d5388ea.dump` | sha256 `d8397aab…165c63` verified, restored (`afldb_v2_rb_s0_test`, never touched again) |
| bridge child `…bridge-child-v3-6d5388ea.json` | sha256 `1200e702…6e9d` verified; `import_draftguru.py --label annual-html-20260826 --bridge` rc 0 + ANALYZE |
| template `afldb_v2_rb_s_test` | draft_picks **6,810**, draft_persons **5,057**, bridge identities **3,559**, import_batches 27, ledger 118, data_overrides 0, auth_users 0 |
| `fp.sql` (full, no exclusions) before any tier P | sha256 `c3681477…beb55`, 98 lines |
| `fp.sql` after both builds, 4 negative controls and all 12 Gridley-suite runs | sha256 `c3681477…beb55`: **byte-identical** (`cmp`) |

Every tier P build and every test run used a fresh `--template` copy. After the template was built, it was touched only by
`CREATE DATABASE ... TEMPLATE` and the two read-only fingerprints.

## 4. Two tier P builds (`afldb_v2_rb_p1_overlay_test`, `afldb_v2_rb_p2_overlay_test`)

Each build: fresh copy of `afldb_v2_rb_s_test`, `tier-p.sh <label> build`, 6 s. Reports in `runs/p1_out_tier-p-report.json`,
`runs/p2_out_tier-p-report.json`.

| | p1 | p2 |
|---|---|---|
| labels kept / ids differing from production | 64 / 3 (the 2026 entries) | 64 / 3 |
| applier: planned, verified, audit rows, active overrides | 64, true, 64, 64 | same |
| Rookie selections written; player ids differing from production | 8; 7 | 8; 7 |
| draft_picks before to after | 6,810 to 6,818 | same |
| active overrides | `matches/match_event` 64, `draft_picks/selection` 8 | same |
| data_edits / auth_users | 72 / 2 (applier's `example.invalid` actor + the clone-local Super Admin) | same |
| rekeyed evidence sha256 | `d1e75ddb…ccd63` | `d1e75ddb…ccd63` (**equal**) |
| applier report sha256 | `e427081c…efd` | `87b69443…8d5` (differs: it embeds the database name) |
| **content fingerprint digest (volatile-excluded)** | `6f988a67…24256` | `6f988a67…24256` (**equal**) |
| raw `fp.sql` (no exclusions) | `83270ee7…8111c` | `59cfbd69…bc614` (differs, see below) |

**Determinism.** The raw whole-database fingerprint differs between p1 and p2 in exactly four tables (`auth_users`,
`data_edits`, `data_overrides`, `draft_picks`). The cause is what the overlay stamps with the time or a random value, and nothing else:
`created_at`/`updated_at`, the editor's random UUID token (`manual_admin_edit:<uuid>`, `manual:<uuid>`, `pick_token` in the audit
payload), and the evidence-file path that the unchanged applier writes into each `data_edits.note` (the path is under `--out`). The tool
fingerprint excludes a DECLARED list (`VOLATILE_COLUMNS`, `NORMALISED_COLUMNS`; the lists are in each report, with every table's
`<rows>:<hash>` line). With them excluded the two builds are identical in every table. An untouched table is hashed whole
(`x::text`), exactly as `fp.sql` does. My first pair of builds exposed the `note` path (only `data_edits` still differed); the
normalisation was added and both builds were redone at the final tool revision. The superseded builds are kept on the host
(`ev/superseded-p1`, `ev/superseded-p2`) and not used for any result.

**What tier P changes against tier S** (raw `fp.sql`, `compare.sh`): exactly `auth_users`, `data_edits`, `data_overrides`,
`draft_picks` and `matches` (the 64 `match_event` labels). Every other base table in public/staging/afldb_meta is equal.

**Prototype cross-check (21 Nov, read-only).** The rekeyed `entries` and `counts` are canonically equal to the prototype's
(`ov_rbb/evidence-rekeyed.json`, 64 entries). The rekeyed FILE sha256 is NOT the prototype's `d21a3eba…f819`: the tool writes
path-free, clock-free metadata (the prototype recorded an absolute checkout path and a "prototype" note), so the bytes differ by design;
the entries do not.

## 5. Refusal controls against real databases (`runs/negctl.txt`)

Each on a fresh disposable copy, `--apply` given; the tool exited 1, wrote nothing, created no `--out` directory:

| Control | Refusal |
|---|---|
| target `afldb_v2_rb_nc1_test` (not `*_overlay_test`) | `database name … is not afldb_v2_rb_*_overlay_test` |
| copy of a built tier P database (2 `auth_users`) | `the target already holds 2 auth_users row(s)` |
| `--template-name` equal to the target | `the target IS the template` |
| `--template-name` naming a missing database | `template … does not exist or does not carry the isolated-test marker` |

Non-loopback host, wrong port, unmarked database, template flag, 0 and more-than-one match refusals are covered DB-free by the unit tests
(no password, host or role appears in any message: asserted).

## 6. Gridley on tier P (fresh copy per file, shared mode, `AFLDB_GRIDLEY_REPORT`; `runs/gp1_*`, `runs/gp2_*`)

| | on p1 | on p2 | 21 Nov prototype `rbbovr` |
|---|---|---|---|
| **G-a** "has no probed dataset gap, unless run in diagnostic mode" | **pass** | **pass** | pass |
| **G-b** "conforms to the bounded approved-deferral policy" | **pass** (0 unapproved) | **pass** (0) | pass (0) |
| **G-c** "writes the run report and has no failing cells" | **FAIL**, 118 = 78 unsupported + 40 criterion disagreement | same | FAIL 118 |
| cells solved | 10,209 / 10,287 | 10,209 / 10,287 | 10,209 |
| gapped criteria | none | none | none |
| dataset flags | all true (draftLinks, matchEvents, heights, dobs, coaches, fatherSon, siblings, afterSiren) | same | same |
| `gridley-aa-oracle` | 61 passed / 1 skipped | same | 61 |
| `gridley-height-oracle` | 61 passed / 1 skipped | same | 61 |
| `grid-solver` | 222 / 222 | 222 / 222 | 222 |
| `grid-solver-investigation` | 1 / 1 | 1 / 1 | 1 |
| `release-gates` | 68 passed / 7 skipped | 68 / 7 | 68 / 7 |

`gridley-summary.mjs` output (`runs/gp1_gridley-summary.json`, `runs/gp2_gridley-summary.json`) is identical between p1 and p2 apart
from the report path (the per-run timing field `slowOver4s` is 0 in both). `findingsByCategory`: time of board 23,571, adjudicated key
disagreement 54, unsupported 78, list membership 1,232, external source disagreement 425, adjudicated source conflict 63, criterion
disagreement 40. `failingReadingMatchEvent` 0. No `source coverage gap`, no `dataset gap`, no `incorrect known answer`.

G-c is unchanged from the 21 Nov finding: it fails on every base, production-shaped data included (ISSUE-118's zero-acceptance
indicator), and is not a tier question.

## 7. Static checks

* `npm run typecheck`: rc 0. eslint on `tools/v2/rebuild-tier-p.ts` and `tests/v2-gap029-label-checks.test.ts`: rc 0.
* `tests/v2-gap029-label-checks.test.ts` 30/30; with `v2-module-boundaries`, `gap029-rookie-selections` and `v2-isolated-test-target`:
  4 files, 126 tests passed. The tools/v2 to `src/db/queries/admin-draft.ts` dynamic import needed no boundary allow-list entry.
* The workstation has no Node.js: `cli.js new-file` could not be used; the tool was created with the Write tool.

## 8. Files here

* `host-scripts/`: `setup.sh` (checkout, cluster, s0, bridge), `tier-p.sh` (fp, dry, build, negctl, gridley), `negctl.sh`,
  `compare.sh`, `fp.sql`, `gridley-summary.mjs` (the last two copied from `docs/v2/evidence/issue363-20261121/host-scripts/`).
* `runs/`: aggregates only, no row data, no DSNs: per-run summaries, both tier P reports (counts and per-table fingerprint lines),
  the Gridley summaries, the negative controls, the tier S fingerprints before and after, and the setup logs.
* On the host only (row-level or large): `ev/p*/out/` (rekeyed evidence, applier reports), the Gridley report bodies and vitest logs.

## 9. Left in place

The workspace `/mnt/ssd/afldb-backlog-20261122b-363` and its **stopped** cluster, holding `afldb_v2_rb_s0_test`, the tier S template
`afldb_v2_rb_s_test`, and the two built tier P databases `afldb_v2_rb_p1_overlay_test` and `afldb_v2_rb_p2_overlay_test`
(each about 299 MB).
