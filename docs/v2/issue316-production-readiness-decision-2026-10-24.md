# AFLDB-ISSUE-316: production-readiness decision package (2026-10-24)

**Current status: D/P APPROVED for readiness proof only; production NO-GO.** The owner ruling in §0b supersedes the historical approval drafts and restrictions below. It was prepared read-only and locally, with
native file reads of the tracked ledger, the ISSUE-316 runbook, the 2026-10-21 decision and release-plan documents, the
G application and rebuild specifications and the J2 proposal. No shell, Git, SSH, SQL, census, dry run, apply, rebuild,
activation, push or deployment was run to prepare it.

**Production: NO-GO.** ISSUE-316 is open. ISSUE-322, ISSUE-323, ISSUE-324 and ISSUE-325 stay resolved.

**Revised 2026-10-25 for the activation separation.** §2, §3, §4, §6, §8 and §9 (U2, U7) no longer describe
activation inside the apply, an eight-file apply, `rebuild-test.ts` changing during the apply, or activation rollback as
part of whole-rollover recovery. The design is
[`issue316-successor-activation-separation-2026-10-25.md`](issue316-successor-activation-separation-2026-10-25.md);
the owner rulings are in §0a. The J2 pins in §1 describe the **old coupled shape** and are proof evidence only.

**Local gate update 2026-10-25:** final focused validation PASS (1,539 passed / 5 skipped / 0 failed, exit 0) with normal C: temp and 85.183609008789063 GiB free immediately before execution; no source/assertion modification. [Exact preflight, output and evidence reverification](../../issues/open/AFLDB-ISSUE-316-activation-separation-20261025/LOCAL-GATE.md). Candidate `c438f844` unchanged. Structural gate **CLOSED / ACCEPTED**; implementation `c438f8449e65c28cf9f00879aaa045131b5f0d3a`, evidence/tracking `def676517da3955aa18db3606785463aac464188`. Evidence/admission gates remain accepted; no owner re-adjudication. Then prepare the D/P structural proposal for owner adjudication. U3 CONFIRMED; U4 Route B; Brownlow untouched; production NO-GO.

**D/P evidence accepted (2026-10-25):** retained J2 167/167 and inputs 264/264; real offline validator exit 0 / 3-of-3 PASS / all pins match; seven-file apply shape; B inactive/rebuild-ineligible; projected C 1,640 rows / 91 checks; exact-P DB-free validation and typecheck PASS. Proposal-only repair supersedes the earlier B 2,956/7/32 failure: broader B **2,966/7/0**, C **2,992/7/0**; focused B **395/0/0**, C **396/0/0**, all exit 0. Fresh-context restatement review GO, no findings. No accepted product/test assertions changed; no new rebuild required. Fresh proof is **NOT RUN**, awaiting the approved day-D window. [Approved readiness runbook](../../issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/readiness/READINESS-RUNBOOK.md).

## 0b. D/P and read-only readiness authority (owner, 2026-10-25)

**Current owner ruling (2026-10-25):** structural gate **CLOSED / ACCEPTED**; D/P **APPROVED for readiness proof**. **D = 2026-10-27**, window **02:00–04:00 UTC / 13:00–15:00 AEDT (Melbourne)**; exact **P = `def676517da3955aa18db3606785463aac464188`**, implementation `c438f8449e65c28cf9f00879aaa045131b5f0d3a`. A later documentation/evidence commit never becomes P. Authorised in that window: current read-only host/native-policy proof, fresh three-target censuses, required nightly/canonical check and enforced dry run without `--apply`. No apply, activation, deactivation, deployment, disposable rebuild, push or Brownlow work. U3 **CONFIRMED**; U4 **Route B**; ISSUE-316 **OPEN**; production **NO-GO pending separate apply approval**.

**D/P evidence accepted (2026-10-25):** retained J2 167/167 and inputs 264/264; real offline validator exit 0 / 3-of-3 PASS / all pins match; seven-file apply shape; B inactive/rebuild-ineligible; projected C 1,640 rows / 91 checks; exact-P DB-free validation and typecheck PASS. Proposal-only repair supersedes the earlier B 2,956/7/32 failure: broader B **2,966/7/0**, C **2,992/7/0**; focused B **395/0/0**, C **396/0/0**, all exit 0. Fresh-context restatement review GO, no findings. No accepted product/test assertions changed; no new rebuild required. Fresh proof is **NOT RUN**, awaiting the approved day-D window.

The exact frozen hashes and the complete authorised procedure are in the
[approval record](../../issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/readiness/APPROVAL.json) and
[day-D runbook](../../issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/readiness/READINESS-RUNBOOK.md).
No approved input is silently regenerated. P remains exact even after the local
documentation commit. Candidate-affecting canonical drift, date/P drift, any
CRIT/HIGH, or MED affecting native completeness/visibility/provenance/isolation
stops and returns to the owner. Ordinary native version drift fully captured by
a fresh policy, normal enforcement/self-check and independent review GO may proceed
without another owner round-trip. J2 policy and censuses remain expired.

The historical combined dry-run/apply drafts below grant no apply authority.
Only the enforced dry run without `--apply` is authorised. No package hold,
installation or timer mutation is authorised. Three censuses are read-only, on
D, preferably within six hours; the production census must be no older than six
hours when the dry run begins. After proof, return the full decision package
and request the separate production-apply decision. State B must later be
validated before a separate activation decision. Brownlow stays Route B.

## 0a. Ruling recorded with the activation separation (owner, 2026-10-25)

- **Design accepted.** The fresh-context review GO (no CRIT/HIGH) is accepted subject to these rulings. Production stays NO-GO.
- **F1: State B accepted as defined.** B is *applied / successor installed / successor inactive / rebuild-ineligible*:
  - the successor documents are installed and `SUCCESSOR_LADDER_TUPLES_JSON` is unchanged;
  - a rebuild that needs the successor profile refuses ("Unsupported ladder expectation"); that fail-closed state is
    intended, and B is **not** redesigned so the predecessor stays rebuildable against successor documents;
  - the web application is unaffected: it does not read the table;
  - the successor's database rebuild proof waits for State C, after a separately authorised activation.
  - B's validation is deliberately **not** a database or rebuild proof. B has **not** passed a successor database
    rebuild. Its proof is:
    - the apply completed with its exact write set;
    - `rebuild-test.ts` stayed byte-identical to its pre-apply inactive pin;
    - the successor tuple is absent;
    - the activation dry run validates the exact projected C state;
    - the inactive-state validator confirms the installed profile refuses as expected;
    - the application and read-only production checks stay healthy.
- **F2: the U2 date-only exception is superseded.** The production candidate is **not** a date-only re-pin of J2. It
  must never be described as "date-only". The write set is 7 files, not 8, and the change-set semantics, production
  apply validation, recovery boundaries, post-apply criteria, activation authority artefact and the test
  interpretation across B and C all change.
- **F3: tests are classified by state, not forced onto one tree.** Invariant tests stay unchanged; State B tests assert
  the applied-inactive tree; State C tests assert the activated tree. No test may imply that B and C are the same tree,
  and an empty-table test is never rewritten merely to pass after activation.
- **Rebuild proof standing.** No new disposable rebuild is required by this change on its own. The J2 rebuild remains
  the proof of the underlying rebuild semantics, because rebuild resolution code, tuple meaning and the successor
  data and reconstruction semantics are unchanged: activation changes **when** the tuple becomes authoritative, not
  how a rebuild reads it. A later change that touches rebuild semantics, rebuild inputs, expected reconstruction,
  canonical data or the validators J2 relied on returns to the owner to adjudicate whether a new rebuild is needed.
- **Apply and activation are separate approvals.** After an authorised apply, State B is validated first. Only then
  may activation be separately authorised.
- **U4 stays Route B; Brownlow is untouched.** No Brownlow work advances this gate.
- **Not authorised (unchanged):** a production census, a D/P selection, a rollover or apply, successor activation,
  a deployment, a disposable rebuild and a push.

## 0. Ruling recorded with this package (owner, 2026-10-24)

- **Post-restore verification accepted.** The Revision J2 proof window is complete and closed:
  - `POST-RESTORE VERIFIED`;
  - 0 temporary J2 holds remain, and the hold set equals the pre-J2 set;
  - all four apt timers are enabled and active;
  - the restore installed, upgraded and removed nothing, and nothing was installed straight after it;
  - the single disposable rebuild attempt is still consumed;
  - no J2 rebuild PostgreSQL instance or listener remains;
  - the accepted J2 proof and its retained evidence are unchanged.
- No further J2 host action is required.
- **Recorded limitation (INFO, no action):** `apt-auto-upgrade.timer` lists no next trigger. It is enabled and active,
  and its pre-J2 next-trigger value was never captured. That gives no reason to change the timer, so normal host
  maintenance is left alone.
- **Native policy `a8e586e0…` is proof-window evidence only.** The hold ended at 2026-10-24T07:52:08Z. The policy must
  not be reused as production or apply evidence. A future apply must establish the host's native state at that time,
  and derive and review a replacement policy if the state has drifted.
- **I325-3** stays resolved at the staged, tested and reviewed level. Its missing Linux execution does not block
  ISSUE-316 now, because no reuse of the rebuild harness is authorised. Before any future reuse: hash-verify I325-3 on
  Linux and run its focused Linux validation.
- **Not authorised:**
  - a production, DEV or test census;
  - successor activation;
  - the production apply;
  - production deployment;
  - executing the rollover;
  - another rebuild.
- **`--rollover-date 2026-10-24` belongs to the J2 proof.** It must not be carried into a later production run without
  being stated again. If the rollover or apply happens on any other date, the affected transition material is
  regenerated, re-pinned and reviewed, and the old and new pins are presented before execution (§1).

## 1. Common evidence ledger: what exists, what is proof-only, what has expired

| Evidence | Value | Standing on 2026-10-24 |
|---|---|---|
| J2 disposable rebuild proof | Enforced dry run `20261024T034905Z` passed 24/24. Rebuild: 30 stages, 91 checks PASSED, 1,640 club-seasons, `AFLDB-POST PASSED` | **Accepted, proof-only.** It proves the post-transition state at the J2 pins on a disposable database. It is not production state, and it cannot be rerun |
| J2 pinned checkout | `876dadbfa024de7d66cdb16cefb4f769d9fdd709` | Proof pin. Current HEAD `2156539e` differs from it only in tracking commits (the commit subjects say so; this was not verified by diff) |
| J2 pinned change set | `85b5f05af179c83fa0fcc4898263204a6d92e6ed99069cb8bb8384f2cb1886a1` (unpinned body `5a410a82…`) | **Bound to `--rollover-date 2026-10-24`, and to the coupled 8-file shape.** Valid for no other date. Since 2026-10-25 it is also **refused** by the planner and the activation binding (it names `rebuild-test.ts` in `write_set` and `final_sha256`) |
| J2 simulated commits | commit 1 `a1e16e67`, commit 2′ `87da1563` on `i316/J2-post-transition-on-876dadbf` | Simulation only, of the coupled (activated) tree. Neither is an apply, and neither is a model of State B |
| J2 native policy and record | policy `a8e586e0…`, record `82e25a10…` (streamanator) | **Expired** at the hold restore, 2026-10-24T07:52:08Z |
| V4 native policy and record | policy `30199b6a…`, record `685a281c…` | **Superseded** by the libz drift of 2026-10-23T16:16Z. Never an apply input |
| Censuses (three targets) | `afldb_prod` 03:28:51Z, `afldb_dev` 03:28:40Z, `afldb_test` 03:28:41Z, all on 2026-10-23, pass, total 0 | **Expired.** They are outside every freshness window, and J2 reused them only as dry-run inputs |
| G application specification | `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-G-20261023T0600Z/APPLICATION_SPEC.md` | **The procedure is the reference shape; its values are superseded.** G-pinned `7beb7347…`, commit `303e3804`, the V4 runtime paths and the 2026-10-24 date must not be used |
| Rebuild specification | `REBUILD_SPEC.md` in the same package | The target database is still **AWAITING OWNER**. The code refuses `afldb_dev` and `afldb_prod` by name |
| Production inspection | 2026-10-20, about 19:46–19:54Z ([release plan](production-release-plan-2026-10-21.md)) | **Expired.** It is a point-in-time observation, taken while writers were active |
| Release backup | `release117-20261020T194848633969Z` | A rehearsal input, taken with writers active. **Not** the frozen release rollback baseline |
| I325-3 harness | `rbstage3-I325/`, `STAGE.sha256` `6e589e77…` | Staged and reviewed. **Not executed on Linux** |

## 2. Dependency order

```
(1) date D + new structural pin P  ──►  owner reviews the new pins (not a date-only diff)
                                      │
            on day D (UTC):           ▼
   native-state check ──► (3) three censuses ──► enforced dry run ──► (4) --apply  ──►  State B validated
   (new policy on drift)      (≤ 6 h before                          (7 files; the        (inactive; no DB proof)
                               the dry run)                           successor stays            │
                                                                      inactive)                  ▼
                                      (2) activation: separate authority, separate approval ──► State C
                                                                                                 │
                                                                      review / merge ──► (5) deployment
   (6) recovery route, backups and stop rules are approved BEFORE (4), and again before (5)
```

Every arrow is a separate owner approval unless the owner deliberately grants them together. No approval implies
another. In particular **apply and activation are separate approvals**, and activation may only be considered after
State B has been validated.

---

## 3. Item 1: production rollover date and successor pin

**Existing evidence.**
- The J2 pins in §1. The planner checks only the format of `--rollover-date` (`ISO_DATE`,
  `src/lib/rollover/season-rollover.ts:1555`) and never compares it with the clock.
- The date is written as content:
  - `changed_at` in the AFL Tables network switch (`src/lib/rollover/afltables-network-retirement.ts:127`);
  - `resolved_on`, `accepted_on` and `validated_on` (`season-rollover.ts:1794`, `:1927`, `:1960`).
- The ruled date-bearing blobs are `data/reference/afltables-network.json`, `data/reference/fitzroy-accepted-baselines.json`
  and `tools/rebuild/fitzroy/fitzroy-contract.json`.

**Expired or proof-only.** Every J2 pin is valid only for 2026-10-24 **and only for the coupled shape**: the change set,
the three date-bearing finals, simulated commit 1 and commit 2′, and both bundles. The production candidate is a new
**structural** candidate, regenerated from the activation-separated code. It is **not a date-only re-pin of J2**, and
no document derived from this package may call it one.

**Regenerate before the execution day (offline and local), once the owner names a date D:**
1. Choose the pinned commit P, a commit that contains the activation-separated code. Because P differs from `876dadbf`
   in code, the full J2 DB-free validation set re-runs at P: the full relevant test suites, the focused rollover
   tests, the focused rebuild and cutover tests, `tsc` and the static package and pin checks. The enforced
   production-candidate dry run follows in the D/P window (§6). This does not by itself require another disposable
   rebuild (§0a).
2. At P, confirm that the **seven** apply write-set files hash to their base pins, apart from any file a reviewed code
   change has altered. `tools/db/rebuild-test.ts` is not an apply write; it is bound read-only until activation, and
   its inactive pin is re-derived at P because the file has moved since the J2 base. Any other difference stops this step.
3. Regenerate the transition change set with `--rollover-date D`. Its `write_set` and `final_sha256` name the seven
   files and never `rebuild-test.ts`. Re-pin it.
4. Derive the **activation authority** (`afldb.rollover.successor_activation/1`) for `activate` and for
   `deactivate`. Re-pin:
   - the source commit P and the rollover date D;
   - the 7-file apply write set and the exact transition change set;
   - the transition change-set SHA-256;
   - the successor tuple and its SHA-256;
   - the **inactive** `rebuild-test.ts` SHA-256 and the **projected active** `rebuild-test.ts` SHA-256;
   - the migration-set binding (count, last name, set digest);
   - every date-bearing production document, and every decision-package hash that consumes the artefacts above.
5. Re-run the post-transition simulation as **two trees**, not one: State B (the apply's seven files) and State C (B
   plus the activation edit). Restate the affected tests per state (§0a, F3), and search the restated tests for the
   literal `2026-10-24`. Do not assume it is absent.
6. Run a local pinned dry run with exit 0, 3/3 gates, 1622 → 1640, 4 renumbered, 91 checks and "pins match this plan
   for every file". The activation dry run must also report the projected active state resolving the successor
   profile with 1,640 rows and the installed inactive state refusing it.
7. Present a table of **old vs new pins** for: the pinned commit, the change set, every final pin that changed, the
   activation authority, both `rebuild-test.ts` pins, and the simulated trees and bundles.
8. Present a **semantic diff** of each changed final against its J2 counterpart. It will not be date-only: it shows
   the write-set and pin-set change, and the seven finals still equal J2 modulo the date fields.

**Destructive or production-affecting.** None. Every step is offline. The pin produced here is what the apply is
authorised against.

**Stop/go.**
- GO only if:
  - the seven apply finals are byte-equal to J2 apart from the date fields (`changed_at`, `resolved_on`,
    `accepted_on`, `validated_on` and any date-derived text);
  - the sole structural differences are the ones §0a names (seven-file write set, activation authority,
    `rebuild-test.ts` bound read-only and pinned in both states);
  - the full validation set above passes at P.
- STOP on:
  - any other non-date change;
  - a base-pin mismatch;
  - a failing suite;
  - a dry run that is not the expected shape;
  - a code change at P that touches rebuild semantics, rebuild inputs, expected reconstruction, canonical data or the
    validators J2 relied on. That returns to the owner for adjudication of whether a new rebuild is needed;
  - a date D that differs from the date the apply will actually run (UTC). The tool does not check that last one; the
    operator does.
- If D slips after regeneration, regenerate again. A pin never carries over to another date.

**U2 is superseded.** The earlier ruling accepted a date-only re-pin on six conditions. The candidate is no longer
date-only (§0a, F2), so that exception does not apply to it. Its conditions stay recorded in `issues.md` as history.
Whether the J2 rebuild proof covers the structural candidate is ruled in §0a: it does, provided no rebuild semantics,
inputs, reconstruction, canonical data or relied-on validator changes.

**Owner approval required (draft).**
> Rollover date **D = YYYY-MM-DD**. Pinned commit **P** (activation-separated code). Regenerate and re-pin the
> ISSUE-316 transition offline for D as a structural candidate, with the 7-file change set and the activation
> authority, and present the old/new pin table and the semantic diffs for review. This authorises no census, dry run
> on a host, apply, activation or deployment.

## 4. Item 2: successor activation

**What activation is.** `tools/db/rebuild-test.ts` reads `SUCCESSOR_LADDER_TUPLES_JSON = '{}'` (the closed table
the rebuild resolves a ladder profile from). Activation is the **one-line edit** that adds the reviewed
`c2-2026-successor` tuple to it, and nothing else. It is made **only** by `tools/db/successor-activation.ts`, under
a bound `afldb.rollover.successor_activation/1` authority. **The apply never writes `rebuild-test.ts`**, and the
accepted-register, contract and witness finals the apply does write grant nothing on their own.

**Separation (decided; see §0a).** Activation is a separate approval from the apply (item 4):
- **State B, applied / inactive:** the apply is complete and the successor documents are installed. The table does not
  list the profile, so any rebuild that needs it refuses ("Unsupported ladder expectation"). That is intended.
- **State C, activated:** the bound tuple is present, the active `rebuild-test.ts` hash equals the authority, and a
  rebuild resolves the successor profile with 1,640 rows.
- **State D, deactivated:** the exact inverse of activation, byte-identical to B. The rollover files are untouched.
- Activation takes effect where the edited `rebuild-test.ts` is: in the checkout where it is run, in the repository
  once that commit is merged, and on production once that commit is deployed. The web runtime does not read the table.

**Existing evidence.**
- Readiness E approved the successor baseline conditionally on ISSUE-319 and ISSUE-320. Both are now resolved:
  ISSUE-320 **for streamanator only**.
- The proposed-state validator accepts `c2-2026-successor` with 1,640 rows and 91 checks.
- The J2 rebuild proved the activated state on a disposable database. Activation separation leaves that proof's
  standing as ruled in §0a: rebuild semantics are unchanged.
- The activation dry run proves, in memory and without any database, that the projected C state resolves exactly the
  profile and 1,640, and that the installed B state refuses it.

**Proof-only.** 1,640 and the 91-check fingerprint stay rehearsal and proof values until the activation commit is merged.
No database rebuild proof of the successor exists for State B, and none is possible there. It waits for State C.

**Prerequisite: State B validated first.** Activation is considered only after the apply and its State B validation
(§6): the apply's exact write set, `rebuild-test.ts` byte-identical to its inactive pin, the tuple absent, the activation
dry run valid for the exact projected C state, the inactive validator refusing as expected, and healthy application
and read-only production checks.

**Regenerate on the day.** The enforced dry run at the new pin must report:
- the successor `c2-2026-successor`;
- `club_seasons expected 1622 -> 1640`;
- `players_with_renumbered_profile 4`;
- `final-validation checks 91`;
- the `tuple_sha256` and the `rebuild_sha256.inactive` and `.active` values the authority carries. The operator
  compares each against the authority before any `--apply` of either tool.

**Commit 2 content (owner review required; this is not mechanical).**
- 2027 is `unsupported` in all five `COVERAGE_REGISTRY` families (ADR 0011).
- `docs/v2/coverage-matrix.md` is regenerated (655 cells).
- The restated tests are restated without weakening, **per state** (§0a, F3). The earlier count of 99 described the
  coupled single tree and is re-derived at P.

The G specification calls these statuses "owner-reviewed". This review found no recorded owner acceptance of them.

**Destructive or production-affecting.** Activation changes the rebuild expectation for every later rebuild, from the
merge of the activation commit onward. It is reversible by itself: `deactivate` is the exact inverse edit (or reverting
the activation commit), and it never touches the rollover (§8). After deployment the apply seals 2026; activation does
not.

**Stop/go.**
- STOP if the dry run selects any profile other than `c2-2026-successor`.
- STOP if the 1640, 91 or renumbered-4 values differ.
- STOP if the tree is not in State B (every apply pin holding, `rebuild-test.ts` equal to the inactive pin). A second
  activation, or deactivating an inactive state, refuses and never no-ops.
- STOP if the printed active `rebuild-test.ts` hash differs from the authority.
- STOP if commit 2 is not owner-accepted before merge.

**Owner approval required (draft).** Separate from the item 4 apply approval, and only after State B is validated:
> Activate the `c2-2026-successor` ladder tuple under activation authority **<authority hash>**, bound to change set
> **<new pinned change set SHA-256>**, tuple **<tuple SHA-256>**, head commit **<HEAD>**, source commit **<P>**. I accept
> the commit 2 content as presented: 2027 `unsupported` ×5, the matrix and the restated tests.

## 5. Item 3: fresh production census

**Existing evidence.**
- The census tool is `tools/db/afl-api-ownership-census.ts`. Its arguments are exactly `--database`, `--dsn-env`,
  `--through-season` and `--out` (`:61`).
- It refuses when the DSN or `current_database()` names a database other than `--database` (`:128`, `:153`).
- The planner requires `captured_at_utc` (`src/lib/rollover/afl-api-ownership-census.ts:456`) and prints each JSON's
  sha256 and capture time in its notes.
- Reviewed census bundle `df019ae5…`, `census-run.sh` `4a17c74b…`, SQL `22c84db5…`.

**Expired.** All earlier census JSONs (§1).

**Freshness is procedural, not enforced by the code.** The tool checks that a capture time is present. It does not
check the time's age, so the window below is an operator and reviewer gate.

**Definition (take on day D only, under a separate approval).**

| Target | Identity to re-verify (last observed 2026-10-22; a change is a STOP for review) | Credential |
|---|---|---|
| `afldb-prod` / `afldb_prod` | system id `7674454702926115004`, OID `66668` | role `afldb_backup`, DSN through an env var, never argv |
| `streamanator` / `afldb_dev` | system id `7673872117032104869`, OID `202860` | DSN through an env var |
| `streamanator` / `afldb_test` | the same cluster as `afldb_dev`, OID `45428` | DSN through an env var |

- Command shape, run through the hash-verified `census-run.sh` exactly as in the 691bdbae execution record:
  `node node_modules/tsx/dist/cli.mjs tools/db/afl-api-ownership-census.ts --database <db> --dsn-env <VAR> --through-season 2026 --out <json>`,
  in one `SET TRANSACTION READ ONLY` transaction.
- Re-verify that the bundle's seven files are unchanged at pin P before use.
- Output paths: `artifacts/rollover/census/afl-api-ownership-census-<host>-<db>.json`.

**Acceptance.**
- All three show `verdict=pass total=0`, scope `1897..2026` with no exclusions, and the expected identity.
- All three were captured on the same UTC day as the enforced dry run and **no more than 6 h before it**.
- The dry-run notes name exactly these three files, with their sha256 and capture times.
- Anything else blocks: a failure, an unknown or missing result, a non-zero total or an identity change. "No known
  target change" is not a substitute.

**Destructive or production-affecting.** Read-only, but it touches the production database. It needs its own
approval.

**Owner approval required (draft).**
> On day D, take the three read-only censuses defined in §5 of the decision package, within 6 h before the enforced
> dry run.

## 6. Item 4: production apply

**Existing evidence.**
- The procedure, journal and recovery design (G §5–§7). The apply writes `afltables-network.json` **first**.
- The journaled, recoverable multi-file write. It is not a filesystem transaction.
- The J2 enforced dry-run shape.

**Expired or proof-only.**
- Every runtime path in G §5. The V4 auditor and policy are superseded, and the J2 policy has expired.
- The J2 apply roots on streamanator are proof leftovers and must not be reused.

**Regenerate on day D:**
1. **Native state.** On the apply host, re-measure the closure against the last reviewed policy (`a8e586e0…`). If any
   object differs, derive a new record and policy by the reviewed procedure in a **new** root. That needs an
   independent review (as J-11) before use. Whether to hold OS packages for the apply window is a separate owner
   choice (U8). The proof-window hold has ended and is not resumed by default.
2. A **new** mode-700 apply checkout, built from a bundle of P, with the inputs hash-verified against `FILE_ORIGINS.json`.
3. The censuses (item 3). Before the enforced dry run, also re-check the AFL Tables nightly’s latest result and
   require no unexplained canonical change since the production candidate was prepared. The nightly remains an
   authorised pre-seal writer until retirement/disable; legitimate corrections become current state. If canonical
   data changed, regenerate/re-pin and review all affected production material before proceeding. This authorises no day-D execution now.
4. **The enforced dry run** at the regenerated pin, under the day's auditor and policy. It must show:
   - exit 0;
   - "All three pre-apply gates PASSED";
   - renumbered 4;
   - 91 checks;
   - pins match for every file (the seven apply files; `rebuild-test.ts` is bound read-only);
   - the activation projection: `rebuild-test.ts` unchanged, the tuple absent, and the projected active hash and
     tuple hash equal to the activation authority;
   - 0 native REFUSED lines;
   - the checkout re-hashed unchanged;
   - census notes naming the day's files.
5. `--apply`: the identical command plus `--apply`, in the same checkout and environment, on the same day. It writes
   the seven files and **leaves the successor inactive** (State B). Activation is a separate approval (§4).

**Destructive or production-affecting.**
- The apply writes only to the disposable checkout. But it is the act that seals 2026 and retires AFL Tables in the
  reference state.
- **Historical U3 prerequisite (superseded by the v5 confirmation above):** ordinary completeness PASS was accepted, but final confirmation was withheld pending
  adjudication and verified disposition of the exact extra player row (PMS 705437; evidence linked in §9). After the
  seal, later 2026 changes require an audited correction. Brownlow 2026 is excluded and follows U4 Route B.

**Stop/go.**
- STOP on:
  - any native drift without a reviewed replacement policy;
  - any census failure;
  - any dry-run criterion missed;
  - any base or final pin mismatch;
  - a pending `.rollover-transaction.json`;
  - an execution date different from D.
- After the apply, validate **State B** (applied / inactive). This is deliberately **not** a database or rebuild proof:
  - the seven paths equal the new finals, and the apply wrote exactly that write set;
  - `git status` shows exactly those seven paths plus the two untracked c2-2026 manifests;
  - `tools/db/rebuild-test.ts` is **byte-identical to its pre-apply inactive pin** (no changed line), the successor
    tuple is absent, and `CLUB_SEASONS_EXPECTED.rows` stays 1622;
  - the activation dry run validates the exact projected C state (the tuple, the active hash, 1,640 rows, the
    authority's bindings);
  - the inactive-state validator confirms the installed successor profile **refuses** as expected;
  - the application and the read-only production checks are healthy (the web runtime does not read the table);
  - no journal, `*.rollover-tmp` or `.activation-tmp` remains.
  Anything else is a STOP followed by §8 recovery. Never commit a mixed state. Do not describe B as having passed a
  successor database rebuild.

**Owner approval required (draft).**
> On streamanator on day D, at pinned commit **P** with pinned change set **<new>**: create the apply checkout, run
> the native-state check (a new policy only after review), run the enforced dry run and, if every §6 criterion passes
> the same day, `--apply`. Then make commit 1 (nine files: the seven apply paths plus the two untracked c2-2026 manifests; re-confirmed at P) and commit 2 (as accepted in §4). Activation is **not** part of this approval. I confirm U3: 2026 is
> complete, and no further 2026 AFL API settle is needed or will be done only through an audited correction.

## 7. Item 5: deployment and release

**Existing evidence.**
- [Release plan](production-release-plan-2026-10-21.md) steps 1–11, and runbook §7 C2 step 5: deploy **with a
  rebuild**, because the app's copy of the switch is fixed at build time.
- PROD as inspected on 2026-10-20 ran checkout `ff100dc2`, with ledger 110 and the AFL Tables timer enabled.

**Expired.** All production observations, and the 2026-10-20 backup as a rollback baseline.

**Open decision U9: the release vehicle.**
- The rollover commits will sit on `v2/rebuild`. Releasing that branch also carries migrations 111–117, the privilege
  reconciliation and the two default grants.
- The release plan requires A-GO, an A-REL covering 111–117 and both grants, a target- and revision-bound approval of
  the 116/117 schema, A-ROLLBACK and A-AFLT.
- Release-plan step 4 orders C2 before the V2 runtime is installed, and forbids attempting C2 through the V2 stub. The
  apply-checkout route (item 4) respects that, because it never uses the PROD runtime.
- No record found here decides whether the rollover ships inside the V2 release or separately. **This is an owner
  decision.**

**Regenerate on the release day:**
- the release-plan step 2 read-only preflight: identity, ledger and checksums, schema and ACLs, build and process,
  timers, writers, space;
- a frozen, non-pruning full backup with an off-host copy and a proven restore (step 5);
- the build artefact and configuration hashes of the exact merged commit;
- a fresh read-only check of the AFL Tables timer, the polkit state and any in-flight settle.

**Destructive or production-affecting:**
- the writer pause (`sudo systemctl stop afldb-settle-afltables.timer`);
- migrations 111–117 (`tools/db/migrate.ts --target prod`);
- the privilege writes;
- code install, restart and the traffic switch;
- AFL Tables timer and polkit retirement. That is optional at C2 and mandatory by C5 (A-AFLT).

All of these are production-affecting and each is a separate approval.

**Stop/go.** Use the release-plan step 11 stop list:
- wrong identity, drift or contention;
- any dump, restore or migration error;
- an unknown pending file;
- an unexpected schema, ACL, data or result change;
- missing authority;
- an unverified artefact;
- an active competing writer;
- failed readiness.

After deploy: the next nightly logs `AFLDB_AFLTABLES_RETIRED` and exits 0, or the timer is disabled. Readiness reports
INFO `afltables_network: retired`. No AFL Tables snapshot label is newer than the rollover's.

**Not part of this item.** The C3–C9 writer chain (D-316-2 … D-316-13), ISSUE-229 B2 and the Brownlow correction
operations (release-plan step 10) are each separate, later approvals.

**Owner approval required (draft).**
> Release vehicle for the rollover: **<V2 release | other>**. Approve A-GO, A-REL (111–117 and both default grants),
> the 116/117 schema approval, A-ROLLBACK and A-AFLT as separately worded records, with the release-day preflight and
> the frozen backup first.

## 8. Item 6: recovery and rollback

| Point reached | Recovery | Evidence that exists |
|---|---|---|
| The apply is interrupted | Journal recovery (G §6): **all new** → verify and remove the journal; **all old** → remove the journal and rerun from the dry run; **mixed** → restore every listed file to its old bytes, then rerun. First keep copies of the journal and the seven paths. The journal covers the seven files only; it can never restore or reverse the activation state. Deleting the journal is an operator action, taken on the owner's recovery decision | DB-free proof of the journal and binding (`c7443fc2`); never exercised on a host |
| Applied (State B), not merged | Discard the disposable apply checkout. The repository is untouched | n/a |
| Activated (State C), not merged | Deactivate (the exact inverse edit, back to the B bytes), or discard the checkout. The rollover files are untouched. Rollback is last-in, first-out: deactivate (C→B), then apply recovery (B→A). The activation tool refuses both directions on a tree whose rollover files are not the applied pins | DB-free test of the inverse and of the refusals (`tests/season-rollover.test.ts`); never exercised on a host |
| Merged, not deployed | Revert the **whole** rollover (commit 1, the activation commit if one was made, and commit 2). The activation commit can instead be reverted alone, which returns the tree to B. Never revert the switch alone: an active switch with `[2027]` is out of bounds | Runbook §7 Recovery |
| Deployed, before any 2027 `afl_api` canonical write | Revert the whole rollover (including any activation commit) and redeploy with a rebuild. For a V2 release, prefer reverting the app artefact and keep the forward schema, receipts and grants. 117's NULLs forbid restoring NOT NULL. 116's receipts are append-only. Reversing 111–114 loses data and needs exports and a separate approval | Release plan step 11. Populated rollback rehearsal at `a273b21a` covers 111–115 only |
| A host restore | The frozen verified archive, full sequence/auth/audit recovery, a writer freeze and A-ROLLBACK | No current-host restore test exists |
| After the first 2027 `afl_api` canonical write | **Forward-fix only.** AFL Tables cannot reclaim the row (`foreign_source_owner`) | Runbook §7 |

- **Regenerate before the apply and before the release.** Approve the recovery route, the backup and the restore
  proof. Do not rely on any earlier approval.
- **Owner approval required.** A-ROLLBACK: the named recovery route for each row above, and the backup that backs it.

---

## 9. Unresolved ISSUE-316 production and data decisions (the J2 proof resolves none of these)

| ID | Decision | Standing |
|---|---|---|
| U1 | Rollover date D and the pinned commit P (§3) | **Ruled 2026-10-24: not set.** Created only near the real apply window, with an old/new pin table, a semantic diff and an independent review |
| U2 | Whether the J2 proof covers a date-only re-pin, or a new rebuild is needed (§3) | **Superseded 2026-10-25 (owner, F2): the production candidate is structural, not date-only; rebuild standing is ruled in §0a.** The earlier ruling, kept as history: **2026-10-24: (a), conditional** on six conditions (`issues.md` ISSUE-316). Static verification done: the date is stamp-only. The owner confirmed the three condition-3 points on 2026-10-24 (derived pins, the two restated test literals, harness date literals). The independent condition-2 review returned GO with no CRIT, HIGH or MED, so condition 2 is satisfied. **The owner accepted the review on 2026-10-24 and it is not re-run.** Conditions 1 and 3–6 and the semantic diff at D/P remain |
| U3 | 2026 ordinary completeness and no further ordinary AFL API settle before the seal (?6) | **CONFIRMED (2026-10-25).** Canonical correction and derived/period/aggregate checks accepted; metadata repair v5 executed once, PASS, receipt 95 linked to 94, authority 93 and protected data unchanged. Attempt consumed. No further ordinary 2026 AFL API settle except an audited correction. Brownlow excluded; U4 Route B. [V5 evidence](../../issues/open/AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V5-RECORD.md) |
| U4 | Brownlow 2026: three pending keys (N9), separate from U3 | **Route B chosen (2026-10-24).** Does not block the ordinary seal. No normal production `settle-afl-api-brownlow.ts` write for 2026 after sealing; do not move ahead of C2 to preserve it. Each key needs its actual decision mapped to `brownlow_authority`, `brownlow_eligibility_decision` after migration 113, or `data_editor`, with the evidence and note required by that workflow. Routes are not interchangeable. Existing 9,522 AFL Tables round-vote rows unadjudicated and untouched |
| U5 | Extra time: empty means unknown, never zero (N4) | Unresolved |
| U6 | ISSUE-321 deferred source data-quality questions | Open; gates nothing |
| U7 | Commit 2 content: 2027 coverage statuses, the matrix, the restated tests per state (B and C; the 99 described the coupled tree) (§4) | Owner acceptance not recorded |
| U8 | Apply-host native state: drift handling, and whether to hold packages for the apply window (§6) | Open. Default: no hold; re-measure on the day |
| U9 | Release vehicle and A-GO / A-REL / 116–117 / A-ROLLBACK / A-AFLT (§7) | Open |
| U10 | When to retire the PROD AFL Tables timer and polkit rule (optional at C2, mandatory by C5) | Open |
| U11 | Whether any post-rollover rebuild is required, and on which target (`REBUILD_SPEC.md` §1). Any reuse of the harness needs I325-3 Linux validation | Awaiting owner |
| U12 | The C3–C9 chain (D-316-2 … D-316-13). D-316-6 is due before the 2027 rollover. ISSUE-229 B2 | Separate, later |
| U13 | Brownlow production correction operations (release-plan step 10). `v2-brownlow-production-correction` is 2 passed / 6 failed and needs the production pre-correction state | Separate, later |
| U14 | Accept the known residuals: full workflow 13,740 / 9 / 31, lint debt, Gridley 50 unapproved (release-plan step 1) | Open |
| U15 | Retained streamanator roots (the J2 apply roots, the disposable rebuild root) and the disposable V3/V4 credential rotation | Housekeeping. Not production blockers; any cleanup is separately approved |

## 10. What this package does not change

No reference data, no host and no database. The activation separation itself is local code and test work, recorded in [`issue316-successor-activation-separation-2026-10-25.md`](issue316-successor-activation-separation-2026-10-25.md); this package does not change it. Production stays NO-GO. ISSUE-316 stays open.
