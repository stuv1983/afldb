# AFLDB-ISSUE-222 — Trusted draft-player linking: DraftGuru Stage B3 person-page acquisition and the person-page bridge into `draft_persons` / `draft_picks`

**Status: Phase 1 (tooling + isolated-test-database validation) APPROVED, IMPLEMENTED and
CLOSED (2026-09-18) — see §11. O-1/O-2/O-3 DECIDED (2026-09-18) — see §0. Phase 2 (acquisition)
separately AUTHORISED (2026-09-18) for exactly ONE new whole-population snapshot — see §11.
Phases 3–5 remain NOT authorised.** Written 2026-09-18 (Fable 5.1, High, planning only, worktree
`D:\dev\afldb-issue-221`, no Git command, no acquisition, no database write). **Revision 2
(2026-09-18, same session):** revised against an eight-point document review; every review
finding was verified against the importer, the corpus suite and the governing contracts before
adoption (see §10). The operator decisions in §0 are recorded from the operator's own answers of
2026-09-18 (U1–U6 at runbook approval; O-1–O-3 after Phase 1 closed). Phase 1 implementation,
validation record and the Phase 2 authorisation are recorded in §11 and in `issues.md`'s
`AFLDB-ISSUE-222` ledger entry, which is authoritative for validation evidence; this file is
authoritative for the runbook and its decisions.

Successor to the draft-linking follow-up recorded on `AFLDB-ISSUE-164` (RESOLVED 2026-09-12,
runbook `issues/closed/AFLDB-ISSUE-164.md`) and on `AFLDB-ISSUE-093` (Stage B3, "PROPOSED / NOT
APPROVED / NOT STARTED", `issues/closed/AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md` §18). Evidence
base: `AFLDB-ISSUE-221.md` §2–§5 and the `AFLDB-ISSUE-221` ledger entry in `issues.md`. Neither
164 nor 093 is reopened; their resolved history, decisions and D-9 are preserved and cited.

---

## 0. Operator decisions (recorded 2026-09-18) and what they bind

| # | Decision | Binding consequence in this runbook |
|---|---|---|
| U1 | **Open AFLDB-ISSUE-222**; ISSUE-164's resolved history and D-9 preserved | D-9 remains ISSUE-164's decision and stays in force throughout. This runbook never re-admits `draft_person` to unattended bulk approval. If a future reconsideration of D-9 is ever proposed, it is written as a dated addendum on ISSUE-164's ledger entry citing §9.1 and the evidence in §6.10 here, never silently here. |
| U2 | **Deterministic ISSUE-093 bridge** stores the links; matcher backtesting is **calibration evidence only** and authorises no link | Links come from the person-page AFL Tables href, byte-exact URL → registered AFL Tables identity, through `import_draftguru.py --bridge` under the B2 handoff §13 authority order and §14 admissibility contract. `npm run match:backtest -- --labels` is run over the Tier 2 population to record the §9.1 table (§6.10) and nothing more. |
| U3 | **Whole-population, resumable acquisition**, a **new immutable snapshot** and a **tracked bridge artefact**; acquisition **not authorised to start** in the planning session | §2. One new label `person-html-<YYYYMMDD>`; `person-html-20260826` is never promoted in place (B2 §18). The bridge artefacts are tracked JSON under `data/reference/` (§4.5). No network request has been made. |
| U4 | **Integrate through the rebuild stage**; verify the DEV/PROD procedure before prescribing importer commands; preserve human decisions and operational data | §4, §5 Phase 4, §7. The `draftguru` stage of `npm run db:test:rebuild` consumes the dataset. DEV/PROD receive links through the established in-place data-refresh path (`docs/deployment.md` §7), which is the same importer with reload-by-key, live-decision precedence and `data_overrides` replay — verified from source in §4.3. The candidate-database promotion (`docs/production-promotion.md`) is NOT prescribed: it governs a rebuilt-database promotion and is currently refused/paused (ISSUE-139/143/151). |
| U5 | **No manual decision for Sam Chapman** (`draft_person:4163`). An absent admissible href means **unresolved identity**; neither that absence nor reported zero games proves he has no canonical player | §3.6. His disposition after Tier 2 is one of: bridged (admissible href) / **unresolved** (no admissible href) — never "confirmed no player". The matcher's `name_exact` top-1 is not evidence. |
| U6 | **ISSUE-221's commit/merge and DEV smoke complete before any linkage reaches DEV**; planning proceeds now | §5 Phase 0 gate. ISSUE-221's DEV check (a) ("No data" on a draft axis) is only observable while the gap exists, so it must be recorded before Phase 4b touches DEV. Phases 1–3 touch no database other than the isolated integration-test database (§5). |
| O-1 | **DECIDED 2026-09-18.** §3.5 review: **census stratum in full** (every bridged National Draft top-10 person, exhaustive) **plus a random stratum of n = 598** of the remaining bridged persons (the 0.5% bound row of the §3.5 table). The revision 2 sampling rule (salted `sha256(salt + "\|" + player_url)` ordering, `"AFLDB-ISSUE-222/v1"` salt) and failure-handling rule (no redraw-until-clean; a failure triggers root-cause investigation, a new dataset version and independent revalidation with a new salt) are **preserved unchanged** — this decision sets `n` only, nothing else in §3.5. |
| O-2 | **DECIDED 2026-09-18.** **No change** to `import_draftguru.py`'s `external_identities.notes`. Provenance for a bridge-derived link continues to live in the dataset artefacts (`data/reference/draftguru-person-bridge-*.json`, `provenance`/`parent_sha256`/`target_registration`) and in `draft_persons.confidence_notes` (`"draftguru person-page bridge -> <identity>"`) exactly as already implemented — §4.3's "default: not changed" stands as the decision, not merely a default. |
| O-3 | **DECIDED 2026-09-18.** Stage B3 acquisition stops for diagnosis (not a data decision) when: the overall terminal-failure rate exceeds **2%**; any single draft year's failure rate exceeds **5%**; or **any** failed identity holds a National Draft top-10 pick. Matches the contract's `person_stage.b3.crawl_failure_ceiling_pct` (2.0) and `concentration_triggers` (`by_year_failed_pct: 5.0`, `any_national_top10_failed: true`) exactly — already implemented in Phase 1, no code change required by this decision. |
| O-4 | **DECIDED 2026-09-18, PROSPECTIVE — revision 2 IN FORCE** (revision 1 superseded before any execution; neither is part of the original gate, never retroactive). Revision 1 approved a Playwright browser-evidence review of all 997 rows and was never executed. Revision 2: the §3.5 review is an **offline comparison of all 997 sampled rows against retained evidence** — the captured DraftGuru snapshot versus the accepted fitzRoy `full-history-20260902` snapshot (hash-verified 131/131) and the `afldb_test` registered identities — plus operator review of every exception and a deterministic 30-row audit of clean offline agreements (salt `AFLDB-ISSUE-222/audit-v1`); live AFL Tables acquisition only for a measured, operator-reported residual under a new explicit authorisation (none exists); Playwright an exception/clarification tool only; sample membership, order, salt and n unchanged; D-9 unchanged; name-only matching still prohibited; Phase 3 remains PENDING. | Contract: `AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md`; revision history, rationale, retained-evidence inventory, measured join feasibility and the corrections that must precede the run: `AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §0, §9–§11; pointer §11.7. Outcome wording: "retained fitzRoy/AFLDB comparison plus operator exception/audit review". fitzRoy/AFLDB evidence is AFL Tables-derived, not independent of it; DraftGuru's captured href is the independent assertion. |

---

## 1. Scope and baseline

### 1.1 The confirmed problem

Every `draft_picks`-backed answer in the product is drawn from **5 linked rows of 6,810** on
every current database (`AFLDB-ISSUE-221.md` §2, measured 2026-09-17 on `afldb_dev` and
`afldb_test`, identical figures):

| Fact | Value |
|---|---|
| `draft_picks` rows | 6,810 (Stage A `annual-html-20260826`, 42 annual pages, years 1981, 1982, 1986–2025) |
| trusted links (`link_status_value IN ('unique','resolved')`) | **5**, all `resolved`, `match_method = 'draftguru_explicit_admin_decision'` |
| `draft_persons` | 5,057: 5 `resolved`, 5,052 `unmatched`, 0 `ambiguous` / `implausible` |
| national top-10 picks with a trusted link | **0** |
| `father_son_selections` | unaffected — fully linked, not in scope |

These are recorded observations, not guaranteed current counts; Phase 0 re-measures them
read-only before anything else (§5).

**Root cause (settled by ISSUE-164 §12 P1c, not re-investigated here):** the historical
automatic linker (`tools/migration/import_draft.py`, retired and tombstoned under ISSUE-093
Stage B2-7) linked through `players.legacy_player_id`; ISSUE-093 ruled automatic historical links
inadmissible as durable identity and never replayed them. The five links are the five explicit
human decisions in the tracked ledger `data/reference/draftguru-link-decisions.json`. **Nothing
human was lost; nothing is recoverable by repair; the population must be acquired.**

### 1.2 Affected consumers

- Grid Solver, eight builders (`src/db/queries/grid-solver.ts`, group *Draft & recruitment*):
  `drafted_by_club`, `draft_pick_between`, `draft_year_between`, `draft_type_is`,
  `drafted_by_club_never_played`, `recruited_via`, `traded_min_times`,
  `national_draft_pick_between`. Since ISSUE-221 an empty axis renders **"No data"**.
- Gridley criteria mapped onto them (`src/search/gridley-compat.ts`): `pick1`, `picktop5`,
  `picktop10`, `pickrookie`, `freeagent1`, `traded1` — all `dataset gap` under the corpus
  suite's `draftLinks` probe (`tests/integration/gridley-corpus.test.ts`). `fatherson` is no
  longer a draft builder (remapped to `father_son_selection` by ISSUE-221).
- `/draft/[year]` (`src/app/draft/[year]/page.tsx`) — rows render whether linked or not; only
  the player link is missing.
- The player-profile draft card and the query builder's `player.draft_picks` relationship.
- `/admin/player-links?table=draft_picks` (the manual queue, `src/db/queries/player-links.ts`)
  and `/admin/draft` (`src/db/queries/admin-draft.ts`, the only `INSERT INTO draft_picks` in
  `src/`).

### 1.3 Three populations that must never be conflated

| Population | What it is | Correct end state |
|---|---|---|
| **Missing source data** | a DraftGuru person whose page carries no AFL Tables href, or whose page failed to fetch, or whose href fails the §14 admissibility contract | `unmatched`, **identity unresolved** — recorded with the reason, never invented either way |
| **Unresolved identity** | a person whose href *is* admissible but whose AFL Tables path is not registered in `external_identities(afltables)` on the target database, or is claimed by two `player_url` values | `unmatched` on that target plus a withheld record with reason; a human may resolve it through `/admin/player-links` on independent evidence |
| **Non-player records** | persons DraftGuru reports with zero senior games and no href | `unmatched`, `is_matching_backlog = false` (migration 019's model) — but per U5 this is **"no evidence of a canonical player"**, not proof of absence |

`reported_games` selects **whether a human should look**, never **which player anyone is**
(B2 handoff §15), and in this runbook it is a **reporting breakdown only** — never an identity
input and never an acceptance gate (§6.1). A zero-game person with an admissible href is bridged
like anyone else (B2 §18 measured 4 of 24 zero-game persons carrying one). Trade and free-agency
rows carry the **receiving** club and no pick number; they are list moves, not drafts
(ISSUE-221 finding 3), and are linked through the same person.

### 1.4 Explicit exclusions

- No name matching, games-based identity, fuzzy candidates, historical automatic-link replay or
  ordinal collapse — permanently excluded by B2 handoff §13. **The retired `import_draft.py`
  is never reactivated.**
- No change to `draft_person` bulk eligibility, scoring weights, bands or thresholds (ISSUE-164
  §9.1 / §12 P1c / D-9).
- No change to the importer's authority contract: `apply_authority()`'s order and its HALT
  semantics (contradiction with a human decision; a bridge target resolving to ≠ 1 canonical
  player; a dataset naming an unknown person) are **not** modified (§4.5).
- No change to the Stage A snapshot, the event-kind contract
  (`data/reference/draftguru-event-kinds.json`) or migration 069's reload keys.
- No Grid Solver product code change. ISSUE-221's rendering and fixture tests are consumed, not
  modified; the one proposed test-tooling change is in §6.3 and touches the corpus suite only.
- No DEV/PROD database write before the DEV/PROD gates in §7.
- Sam Chapman: no manual decision (U5).

### 1.5 Dependencies on ISSUE-221

- ISSUE-221 must be **committed, merged and DEV-smoked** before Phase 4b (U6). Its DEV check (a)
  is the last observation of the pre-link state.
- ISSUE-221's `tests/integration/grid-solver.test.ts` draft-fixture describe (a namespaced
  `issue221-draft-fixture` player with a 1982 `'National Draft'` pick 7, 1996 rookie 3, two
  trades and a free-agency signing) is the builder-**semantics** oracle and must stay green with
  real links present. It is not a substitute for §6.3's evaluation on the real population.
- ISSUE-221's corrected `draftLinks` comment in `tests/integration/gridley-corpus.test.ts`
  states the pre-link baseline; Phase 5 updates the comment, not the probe.

---

## 2. Source acquisition — Stage B3 (Tier 2)

### 2.1 Scope and authoritative identity evidence

- **Population:** every distinct `player_url` in the accepted Stage A snapshot
  `annual-html-20260826` `parsed/persons.jsonl` — 5,057 persons (B2 §18 candidate shape).
  Not scoped by `reported_games` (rejected in B2 §18).
- **Identity evidence:** the person page's own outbound AFL Tables href, reduced by the
  existing canonicaliser (`draftguru-contract.json` `person_stage.afltables_link.normalisation`,
  mirroring `import_fitzroy_core.py normalise_profile_url()`), path shape
  `^players/[A-Za-z]/[^/]+\.html$`, byte-exact `player_url` on the DraftGuru side. **The
  rendered name is never identity** (contract `identity_rules`).
- **Why this is admissible as identity:** an upstream editorial identity assertion mediated by
  a URL, matched URL-to-URL with no scored family reused (ISSUE-164 §12 P1c item 3); the Stage
  B1 reconciliation measured **same 33 / contradicts 0** against every identity AFLDB already
  held, and 100/100 observed hrefs in one uniform form with 0 collisions
  (`docs/rebuild-manifests/draftguru/person-html-20260826.json`; acquisition handoff §32.1).
- **What it cannot do:** cover persons whose page carries no href (B1: 20 of 120, all 14
  zero-game controls, and one side of every convergence pair). Those stay unresolved.

### 2.2 Snapshot pinning, provenance, admissibility

- **New label** `person-html-<YYYYMMDD>` under `data/sources/draftguru/` (local, git-ignored)
  with its manifest under `docs/rebuild-manifests/draftguru/` (tracked, hash-bound). The Stage
  B1 label `person-html-20260826` is `immutable: true`, `identity_complete: false`,
  `import_capable: false` and **must never be promoted in place** (B2 §18).
- **Manifest semantics must be earned** (B2 §18 Amendment 4): a Stage B3 snapshot may declare
  `identity_complete` / `import_capable` only under a new, reviewed contract block
  (`draftguru-contract.json` `person_stage.b3`, proposed in §5 Phase 1) that defines the
  conditions, and only after the profiler's aggregate outputs exist for every one of the 5,057
  identities (`fetched + failed = 5,057`; the B1 `completion_rule` generalised).
- **Layout** reuses the B1 contract exactly (`raw/persons/<slug>__<ordinal>.html`,
  `http/persons/<slug>__<ordinal>.json`, `http/persons_index.json`,
  `parsed/person_profile.jsonl`, `parsed/afltables_link_profile.json`); a filename is storage
  only, never identity.
- **Regression expectation across acquisition dates is semantic, not byte-level** (B2 §18
  Amendment 2): the 120 B1 anchors must reproduce the same `player_url`, terminal
  classification and AFL Tables identity / absence, or the drift is reported as a finding.
  Stage B3's profile output is diffed against `person-html-20260826` before any dataset is
  derived (§5 Phase 2 gate).
- **Resumability:** the existing terminal-classification contract (successful raw+HTTP pairs and
  terminal failure records reused, never silently retried) makes the run resumable; retrying a
  terminal failure is an explicit later decision (§2.6).

### 2.3 Preflight

`import_draftguru.py --validate-only --bridge <dataset>` already loads the dataset (`validate()`
→ `load_bridge()`): schema version, canonical `player_url` form, canonical AFL Tables path,
one-URL-one-identity in both directions. It does **not** check that each identity resolves to
exactly one canonical player — that check lives in `apply_authority()` and is exercised only by
`--dry-run` (whole transaction, rolled back) or a real import. The rebuild's own preflight
(`draftguruValidateArgv` in `tools/db/rebuild-test.ts`) derives its argv from the data stage's
argv, so adding `--bridge` to `draftguruImportArgv` covers both structurally.

### 2.4 Placement within the reproducible rebuild

The dataset is consumed by the **existing** `draftguru` stage (`tools/db/rebuild-test.ts`,
`id: 'draftguru'`, "must follow fitzroy"), not by a new stage: the importer's `apply_authority()`
is the single writer of `draft_persons.link_status`, and B2 §12 rejected "import unlinked, link
in a second pass" as two writers of one invariant. Proposed wiring: `draftguruImportArgv()` gains
the tracked **source-evidence** dataset path (§4.5), `DRAFTGURU_PREFLIGHT_FILES` gains it, and
the FINAL VALIDATION stage gains `draft_persons` bridged / `draft_picks` linked expectations
read from the dataset's own counts (§6.1).

### 2.5 Free/hobby-source constraints (existing project policy)

DraftGuru is a free hobby site and the project's standing policy is "free/hobby sources only"
(`docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §0). The inherited HTTP policy is binding and
unchanged: concurrency 1, 1.5 s minimum pacing, 20 s timeout, 3 retries at 2/4/8 s, same-host
redirects only, robots.txt fetched once and respected with `/players/*` checked, the tracked
`user_agent` with contact address. **5,057 requests at 1.5 s pacing is about 2.1 hours of pacing
before retries**, run once, resumable, and never scheduled or repeated without an explicit
decision. No API, no bulk export, no commercial licence.

### 2.6 Acquisition failures — ceiling, distribution and what a reason does not prove

Three separate things, never collapsed into one percentage:

1. **Crawl-failure ceiling (run health).** Terminal failures (`terminal_classification =
   'failed'`) over the whole run must stay below a pre-declared ceiling — **decision O-3
   (DECIDED 2026-09-18, §0): 2%**. Exceeding it stops the run for diagnosis (site change,
   robots change, network) before any retry decision. This ceiling says nothing about coverage.
2. **Failure distribution (concentration).** The profiler output is broken down **by draft
   year of the person's first appearance and by top-10 National Draft membership** before any
   dataset is derived. A concentrated gap — **decision O-3 triggers (DECIDED 2026-09-18, §0):
   any year with more than 5% of its persons failed, or any** failed page belonging to a
   national pick 1–10 — requires an explicit retry decision (a bounded re-run of the failed
   identities only, under the same policy, as a resumed acquisition) before Phase 3. An
   acceptable overall percentage never hides a concentrated gap.
3. **Coverage acceptance** is §6.1–§6.2 and is stated per (year, kind, pick range). Every
   unresolved person carries a reason, but **a recorded reason does not make the user-facing
   capability complete**: the closeout states capability coverage per cell (linked over
   expected) and the recorded gaps are gaps, not acceptance.

---

## 3. Matching and trust

### 3.1 §9.1 and D-9 — cited, unchanged

ISSUE-164 §9.1 (frozen 2026-09-12): a class may be admitted to unattended approval only on
**n ≥ 253 bulk-eligible confirmed-link rows with 0 false positives**, 0 hard conflicts,
`name_exact` / `name_alias_exact` evidence on every row, ≥ 2 independent corroborating families,
and (item 10) median gap ≥ 25, with the achieved confidence bound recorded beside it and the
100% hand review of the initial live bulk-ready set completed. **D-9 (decided 2026-09-12):
`draft_person` is suspended from unattended bulk approval until that standard is met.**

**This runbook does not attempt to meet §9.1 and does not reconsider D-9 (U2).** The bridge
needs no §9.1 because it is not the matcher: it is a deterministic, name-free identity path
governed by ISSUE-093 §13/§14. The §9.1 table is still produced (§6.10) so that ISSUE-164's
recorded evidence gap is honestly measured, and it is recorded as calibration only.

### 3.2 The evidence hierarchy applied here

Authority order (B2 §13, enforced in `apply_authority()`): **explicit human decision** (tracked
ledger or live `player_link_resolutions`) > **admissible bridge** > **unmatched**. A bridge that
contradicts a human decision **HALTs the import** (ImportFailure, transaction rolled back; the
audit is the failed `import_batches` row) — never a silent override, never a merge.

### 3.3 Outcomes and the human-review boundary

There is no candidate generation and no confidence band on the bridge path: a person either has
exactly one admissible, registered, unclaimed AFL Tables identity on the target database or has
none. Every person lands in exactly one of these **mutually exclusive authority outcomes**, and
§6.1 reconciles the population against them:

| Outcome code | Case | Stored result | Who decides |
|---|---|---|---|
| `H-linked` | ledger or live human decision `linked` | `resolved`, `draftguru_explicit_admin_decision` | already decided; a bridge must agree or the import HALTs |
| `H-unlinked` | human decision `confirmed_unlinked` | `unmatched`, explicit method | already decided; a bridge for this person HALTs |
| `B-linked` | admissible href, registered on this target, claimed once | `unique`, `draftguru_person_page_afltables_bridge` | importer, deterministically |
| `W-unregistered` | admissible href, **not registered** in `external_identities(afltables)` on this target | withheld from this target's deployment dataset (§4.5); `unmatched` | curator, via `/admin/player-links`, on independent evidence |
| `W-collision` | admissible href **claimed by two `player_url` values** | withheld on both sides only under `--acknowledge-bridge-collisions`; otherwise the exporter refuses; `unmatched` | operator acknowledges; a curator resolves |
| `U-no-href` | page fetched, no AFL Tables href | `unmatched`, identity unresolved | nobody — no evidence either way |
| `U-inadmissible` | href present but a §14 flag is set (malformed, multiple candidates, non-reducing host, self-link disagreement, parse error) | `unmatched`, finding recorded | curator may review |
| `U-page-failed` | terminal fetch failure | `unmatched`, retry decision per §2.6 | operator |

The manual path (`resolveLink` → `applyLockedLink` in `player-links.ts`) writes `resolved` and
propagates per person; it is unchanged and remains the only way a human adds a link.

### 3.4 Duplicate names, Jnr/Snr, aliases, historical collisions

- **Same-name persons** are distinct `player_url` values (ordinal-disambiguated); the contract's
  regression anchor is `brad_miller/1` vs `brad_miller/2`. Distinctness is structural.
- **Jnr/Snr and aliases** never enter: no name is compared anywhere on this path.
- **Collisions** (two persons → one AFL Tables path) are a HALT/withhold, never a merge (§14).
- **The AFL Tables side** may hold two `external_identities` rows for one path only if the
  fitzRoy import registered them that way; the importer refuses any target resolving to ≠ 1
  canonical player. A rebuilt database has closed the "889 played-but-unregistered" legacy gap
  (B2 §38); DEV/PROD are re-measured by Q5 in §5 Phase 0 before any dataset is resolved there.
- **Conflicting evidence** between the bridge and a human decision is a HALT (§3.2).

### 3.5 Bridge precision: what is known, what the sample must establish, and how failures are handled

**What is known.** Five live links prove nothing about the bridge; the Tier 1 run (114 labels,
Very High 54/54, Top-1 98.96%) measured the *matcher* against the bridge, not the bridge against
independent truth. The only independent measurement of the bridge is the B1 reconciliation:
**33 same / 0 contradicts** where AFLDB already held an identity — a 0.00% observed
contradiction rate on n = 33, whose one-sided 95% upper bound is about 8.7%. Far too weak to
carry thousands of public links. The importer's own HALT on any bridge/human disagreement adds
a second, small, independent check (the ledger persons that carry an href).

**Sampling population.** All `B-linked` persons in the source-evidence dataset (§4.5), i.e.
every person the bridge would link. Withheld and unresolved persons are outside it (they
receive no link).

**Selection.** Two strata, both pre-declared before any page is inspected:

1. **Census stratum — every bridged person who holds a National Draft pick 1–10.** These are
   the headline public rows (`/draft/[year]`, `picktop10`) and the population is bounded (at
   most 420 across 42 drafts). Reviewed exhaustively; no sampling.
2. **Random stratum — the remaining bridged persons**, ordered by `sha256(player_url)` hex
   ascending (the contract's existing deterministic, name-free `control_ordering`) with a
   declared salt (`"AFLDB-ISSUE-222/v1"` prepended to the URL before hashing) so that a later
   revalidation can declare a different salt and draw a disjoint sample. The first **n** are
   reviewed.

**Choosing n — for this bridge, not borrowed from the matcher.** With 0 failures in n, the
one-sided 95% upper bound on the bridge error rate is `1 − 0.05^(1/n)`
(`zeroFailureUpperBound` in `tools/matching/label-set.ts`). The consequence of a wrong bridge
link is a **public, cross-page identity error** (a wrong player's name on a draft page, a wrong
draft on a player page, wrong Grid Solver answers) that is reversible only per person after
someone notices. The bound should therefore be tied to the number of wrong public links the
operator is willing to tolerate at the bound, given the expected bridged population P (Phase 0
Q3 × ~97%; plausibly ~3,000):

| n (random stratum) | bound | wrong links admitted at the bound for P ≈ 3,000 |
|---|---|---|
| 253 | 1.18% | ≈ 35 |
| 300 | 1.00% | ≈ 30 |
| **598** | **0.50%** | **≈ 15** |
| 1,000 | 0.30% | ≈ 9 |

**Decision O-1 (DECIDED 2026-09-18, §0):** census stratum in full plus **n = 598** on the random
stratum (0.5% bound). 253 is the matcher-parity floor and is **not** the basis for this decision
(it is listed so the trade-off is visible; not chosen). The **achieved bound is recorded beside
the observed count and never rounded to "99.9%"**. The census stratum contributes no bound (it is
exhaustive, not a sample) and is reported separately.

**Review criterion — same human, not same club.** For each pair the reviewer opens the AFL
Tables page named by the href and the DraftGuru page and answers *is this the same person*, on:
name consistent allowing spelling variants, nicknames and Jnr/Snr; AFL Tables debut season not
earlier than the draft year (same year for mid-season and pre-season drafts, later for
rookie-list elevations); birth date or age consistent with DraftGuru's draft age where AFL
Tables shows it; and career span consistent with the transaction sequence. **Club is
corroborating evidence only**: the drafting club, the receiving club on a trade or free-agency
row and the AFL Tables debut club may all legitimately differ (traded before debut, delisted and
re-drafted, rookie elevation at another club), and a club difference is never by itself a
failure. The reviewer records `same` / `different` / `undetermined` with a one-line reason;
`undetermined` is not a pass and is escalated, not re-drawn.

**Failure handling — no re-draw-until-clean.**

1. Every observed failure and the **original sample list and results are preserved verbatim**
   (tracked under `docs/rebuild-manifests/draftguru/` as `bridge-review-<label>-v<N>.json`),
   including any later-overturned verdict. The record for dataset v1 states its observed
   failures; **v1 can never be described as 0-failure after the fact.**
2. A failure triggers **root-cause investigation across the affected population**, not just
   the failed person: classify the mechanism (DraftGuru editorial error on the page; canonicaliser
   or path normalisation; exporter logic; AFL Tables registration ambiguity; convergence-pair
   mislabel), then search the whole profile output for every person the same mechanism could
   affect, and report the count.
3. The corrected dataset is a **new version** (`draftguru-person-bridge-<label>-v<N+1>.json`)
   carrying `parent_sha256` of v<N>, the mechanism, and every withheld person with reason
   `review_failure:<mechanism>`; v<N> is retained, never edited.
4. **Independent revalidation:** a fresh random stratum with a new salt (`"AFLDB-ISSUE-222/v<N+1>"`)
   of the same n, disjoint from the previous draw where the population allows, reviewed by the
   same criterion, again requiring 0 failures — plus the census stratum re-checked only for the
   persons the mechanism could affect. The achieved bound is stated for v<N+1> only.
5. Any failure whose mechanism cannot be established → STOP; the dataset does not ship.

### 3.6 Sam Chapman (`draft_person:4163`, `sam_chapman/2`) — disposition rule (U5)

Evidence on record (ISSUE-164 §12 P1c item 8): `Draft · 2000 · Rookie`, Geelong, reported
0 games / 0 goals, `unmatched`, not in the B1 snapshot; matcher v1 top-1 Paul Chapman #10273 on
non-name evidence only, v2 top-1 Sam Chapman #11609 on `name_exact` only, neither corroborated.

After Tier 2 his disposition is recorded as exactly one of the §3.3 outcomes:

1. **`B-linked`** — his page carries an admissible, registered, unclaimed href → `unique`
   through the importer like anyone else (and he enters the §3.5 population).
2. **`U-no-href` / `U-inadmissible` / `W-*`** — recorded as *identity unresolved*,
   `unmatched`, `is_matching_backlog = false` because `reported_games = 0`. **This is not a
   finding that he has no canonical player**; zero reported games and an absent href are
   absence of evidence. No `confirmed_unlinked` decision is written.

No manual decision in either direction. The matcher's suggestions are not evidence.

---

## 4. Link storage and propagation

### 4.1 Choice: the ISSUE-093 bridge, not matcher re-admission (U2, evidence)

- The bridge path **exists and is fail-closed** (`import_draftguru.py`: `load_bridge()` lines
  333–364, `apply_authority()` step 2 lines 699–729, `BRIDGE_MATCH_METHOD`). Nothing new writes
  a link; only the dataset is new.
- The matcher route is circular for this problem: its only admissible truth is the same href,
  so every person it could bulk-approve already has a deterministic link, and the persons it
  could add are exactly those with no truth to validate it against.
- Provenance stays split: bridge links are `unique`; `resolved` remains reserved for humans (§14).

### 4.2 Propagation

Identity is person-grained (migration 019). The importer writes `player_id` / `link_status` /
`match_method` / `confidence_notes` on `draft_persons` and copies the same values onto **every
`draft_picks` row of that person** (`pick_rows()`), so a person cannot be linked on one pick and
unlinked on another. `draft_picks_link_ck` and `draft_persons_link_ck` make an unevidenced link
impossible to store.

### 4.3 Stable keys, audit, idempotency, stale-input safeguards (verified from source)

- **Keys:** `draft_persons (source_id, player_url)` and
  `draft_picks (source_id, player_url, draft_year, draft_kind)` (migration 069) — reload by key,
  `delete_missing=False` on persons, childless persons deleted; admin-created picks
  (`source_id IS NULL`) are outside the key and untouched (partial unique index).
- **Human decisions on a live database:** `read_live_decisions()` reads the newest
  `player_link_resolutions` row per pick, normalised to the person, HALTs on contradictory
  decisions across one person's picks, and feeds `apply_authority()` **ahead of** the bridge.
- **Admin overrides:** `replay_admin_overrides(pg, "draft_picks")` runs inside the same
  transaction after the reload, so `data_overrides` authority (manual picks, field overrides)
  is re-applied on every run.
- **Audit:** the `import_batches` row (success or failure with `error`), `external_identities`
  (`draftguru`) one row per person carrying `status` / `match_method` / `player_id`,
  and the tracked datasets themselves, hash-pinned to the tracked manifest. (The importer's
  `notes` currently carry the Stage A label only; carrying the B3 label and observed href per
  §14 "stored provenance" would have been a small importer change — **decision O-2 (DECIDED
  2026-09-18, §0): not changed**; provenance lives in the dataset + `confidence_notes`.)
- **Idempotency:** re-running with the same dataset is a no-op reload by key; `--dry-run` runs
  the whole transaction and rolls back. **Links are recomputed on every run**: the importer
  passes `link_columns=None` to `reload_keyed`, so `reload_keyed`'s link-loss guard is not
  engaged for this table and `apply_authority()` alone decides every link every time. A run
  with a stale or truncated dataset therefore silently drops the bridge links the dataset omits
  — which is why the dataset is hash-pinned (§4.5) and the importer's `authority: bridge` count
  is compared against the dataset's declared count on every run (§6.1, §7.4).
- **Stale input:** the dataset names the snapshot label and manifest sha256 it was derived
  from; the exporter refuses to run if the tracked manifest hash differs; the importer refuses a
  dataset naming a person the Stage A snapshot does not carry.
- **Population-drop guard:** `reconcile_draftguru_identities()` calls `check_population_drop`
  on **person rows** (stored vs asserted `external_identities(draftguru)` rows), not on links,
  so neither a bridge load nor a reversal trips it; the existing
  `--acknowledge-population-drop` idiom is unchanged.

### 4.4 Approval and canonical-write boundaries

| Write | Where | Approval |
|---|---|---|
| raw snapshot + manifest | local `data/sources/`, tracked `docs/rebuild-manifests/` | operator approves the acquisition (Phase 2) |
| source-evidence bridge + per-target deployment datasets | tracked `data/reference/` | reviewed edit, operator commit (Phase 3) |
| `afldb_test` links | `npm run db:test:rebuild` (`--acknowledge-destroy afldb_test`) | operator runs the rebuild (Phase 4a) |
| DEV links | in-place `import_draftguru.py --bridge` on the DEV host | separate DEV gate (§7.2) |
| PROD links | same importer with the PROD import DSN, after a proven backup | separate PROD gate (§7.3) |

The `afldb_import` role is the only writer; the web process never writes a link on this path.

### 4.5 One immutable source-evidence bridge, explicit per-target deployment datasets

**The constraint, verified from source.** `apply_authority()` step 2 raises `ImportFailure`
("a bridge target resolves to N canonical players … expected exactly one") for **any** dataset
entry whose AFL Tables path is not registered exactly once on the target database. That is the
authority contract and it is **not changed** by this runbook. Consequently a dataset that lists
every admissible href cannot be imported unchanged on a target that has not registered every
one of them, and a single "the dataset that passed is the dataset that ships" rule cannot hold
across databases with different registration states. The resolution:

| Artefact | Content | Depends on a database? | Hash |
|---|---|---|---|
| **Source-evidence bridge** `data/reference/draftguru-person-bridge-<label>-v<N>.json` | every §14-admissible `(player_url, afltables_external_id)` pair from the snapshot, plus `withheld[]` for `W-collision` (acknowledged), `U-inadmissible`, `U-page-failed`, `review_failure:*`; `provenance {label, manifest_sha256, exporter_version}` | **No** — derived from the snapshot alone | `sha256` recorded in the ledger; immutable per version |
| **Per-target deployment dataset** `data/reference/draftguru-person-bridge-<label>-v<N>.<target>.json` (`target` ∈ `afldb_test`, `dev`, `prod`) | the parent's `bridges[]` minus entries whose identity is not registered exactly once on that target, moved to `withheld[]` with reason `target_not_registered` (or `target_ambiguous` for > 1); `parent_sha256`; `target_registration {count, measured_at}` | **Yes** — a read-only registration export from that target (Phase 0 Q5 shape) | `sha256` recorded; a new hash whenever the parent or the target's registration changes |

Both files use the `load_bridge()` schema (`schema_version 1`, `bridges[]`) so the importer
needs no change; the extra sections are ignored by `load_bridge()` and read by the exporter's
self-check. The importer always receives a **deployment** dataset, and its `--dry-run` on the
target must report `authority: bridge` equal to that dataset's `bridges.length` with 0 HALTs
(§7.2). On a rebuilt `afldb_test` the deployment dataset is **expected to equal the parent**
(every played player registered, B2 §38); a non-empty `target_not_registered` list there is a
finding to explain before Phase 4a proceeds. The §3.5 review is performed on the **parent**
(every person that could ever be linked), so a per-target subset never needs a separate review;
each target's withheld list is reported in §6.1 as `W-unregistered`.

An alternative — changing the importer to withhold-and-file rather than HALT on an unregistered
target — is explicitly **not proposed**, because it would move a fail-closed authority check
into a silent skip.

---

## 5. Phased implementation

Every phase has a stop condition; "STOP" means stop and report, nothing is written. Database
boundaries per phase: **Phase 1** — no network, no database except the isolated integration-test
database (`AFLDB_TEST_DATABASE_URL`, name ending `_test`) written only by the test suites;
**Phase 2** — network only, no database; **Phase 3** — read-only registration exports, no
write; **Phase 4a** — `afldb_test` only; **Phase 4b** — DEV then PROD under §7.

### Phase 0 — Sequencing gate and read-only baseline (operator, no code)

Prerequisite (U6): ISSUE-221 committed → `npm run merge:ready -- --issue 221` → merged →
`deploy/sync-dev.ps1` → its four DEV browser checks (`AFLDB-ISSUE-221.md` §6) recorded →
ISSUE-221 resolved. Then a fresh worktree for this issue:

```text
npm run worktree:bootstrap -- --issue 222 --branch <agent>/issue-222
npm run preflight -- --mode implementation --issue 222
```

Read-only baseline on `afldb_test` (and DEV, read-only) — all SELECT, no writes:

```sql
-- Q1 population by link status / method (expect 5 resolved explicit decisions, rest unmatched)
SELECT link_status, match_method, count(*) FROM draft_persons GROUP BY 1,2 ORDER BY 3 DESC;
-- Q2 picks linked (the draftLinks probe's own arithmetic; 3,405 of 6,810 flips it)
SELECT count(*) AS total,
       count(*) FILTER (WHERE link_status_value IN ('unique','resolved')) AS linked
  FROM draft_picks;
-- Q3 persons by reported games (a BREAKDOWN of the expected bridge population, not a gate)
SELECT (reported_games > 0) AS played, count(*) FROM draft_persons GROUP BY 1;
-- Q4 national top-10 picks 1981+, by year (the §6.2 denominator; persons, not picks)
SELECT draft_year, count(*) FILTER (WHERE pick_number BETWEEN 1 AND 10) AS top10_picks,
       count(DISTINCT draft_person_id) FILTER (WHERE pick_number BETWEEN 1 AND 10) AS top10_persons
  FROM draft_picks WHERE draft_kind = 'national' GROUP BY 1 ORDER BY 1;
-- Q5 registered AFL Tables identities on THIS target (the per-target resolution input, §4.5)
SELECT count(*) FROM external_identities ei JOIN sources s ON s.id = ei.source_id
 WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
   AND ei.status IN ('unique','resolved') AND ei.player_id IS NOT NULL;
-- Q6 live human decisions on draft picks (expect 0 rows on a rebuilt DB; DEV may differ)
SELECT action, count(*) FROM player_link_resolutions WHERE target_table = 'draft_picks' GROUP BY 1;
-- Q7 admin-created picks and active draft overrides (operational data to be preserved, §7.4)
SELECT (source_id IS NULL) AS manual, count(*) FROM draft_picks GROUP BY 1;
SELECT count(*) FROM data_overrides WHERE entity_type = 'draft_picks' AND is_active;
```

Gate: Q1/Q2 reproduce the §1.1 baseline (or the difference is explained); Q3 gives the expected
positive population; Q4 gives the top-10 denominator per year; Q6/Q7 are recorded as the
operational-data baseline for §7.4. STOP if Q1 shows any non-explicit `match_method` (someone
reactivated an automatic path).

### Phase 1 — Contract and tooling (implementation session)

Boundary: no network request; no database write outside the isolated integration-test database,
and there only through the test suites. All of the following is **proposed tooling that does
not exist yet**:

1. `draftguru-contract.json` gains a `person_stage.b3` block: population rule ("every
   `player_url` in the accepted Stage A `persons.jsonl`"), new label pattern
   `^person-html-[0-9]{8}$` with the B1 label listed under `refused_labels` for B3 writes,
   completion rule `fetched + failed = distinct_persons`, the crawl-failure ceiling and
   concentration triggers (§2.6), the earned-manifest conditions for `identity_complete` /
   `import_capable`, the §14 admissibility flags restated by name, and the two dataset schemas
   of §4.5 (`schema_version 1`, `bridges[]` as `load_bridge()` already reads, plus `withheld[]`,
   `provenance`, `parent_sha256`, `target_registration`).
2. `tools/rebuild/draftguru/stage_b1_sample.py` (or a new `stage_b3_population.py`): a
   full-population mode that writes a `sample.json` of all 5,057 persons with
   `primary_cohort: "population"` and a `zero_game` descriptive tag, bypassing the frozen
   120/8/68/30/14 assertion **only** under the B3 label pattern; the B1 assertion stays
   untouched for B1 labels.
3. `tools/rebuild/draftguru/acquire_persons.py`: accept the B3 label and population sample;
   probe mode and resume unchanged; the by-year / top-10 failure breakdown of §2.6 added to the
   profiler aggregate; manifest written last with the B3 block's semantics.
4. New `tools/rebuild/draftguru/export_person_bridge.py`, two modes:
   `--source-evidence` (offline over `parsed/person_profile.jsonl`, applies every §14 flag,
   emits the parent with `withheld[]`, refuses collisions unless
   `--acknowledge-bridge-collisions`, verifies the manifest sha256 first) and
   `--resolve-against <target>` (the `reconcile_person_bridge.py` read-only envelope: `.env`
   parsed not sourced, read-only transaction, aggregate egress; emits the per-target deployment
   dataset with `parent_sha256` and `target_not_registered` / `target_ambiguous` withheld
   entries). Both self-validate by re-reading their output through `load_bridge()`.
   Also `--review-sample` (emits the §3.5 census + salted random strata lists from a parent).
5. `tools/db/rebuild-test.ts`: `draftguruImportArgv()` gains `--bridge <tracked parent path>`
   (the rebuild's target is a rebuilt `afldb_test`, for which the parent is the expected
   deployment dataset — the FINAL VALIDATION expectation in §6.1 proves it),
   `DRAFTGURU_PREFLIGHT_FILES` gains the path, FINAL VALIDATION gains the bridged/linked
   expectations.
6. `tests/integration/gridley-corpus.test.ts`: the `AFLDB_GRIDLEY_SCORE_DRAFT=1` override of
   §6.3 (scoring-only; the probe, the strict/diagnostic modes and every other gap untouched).
7. Tests, extending existing homes: `tests/draftguru-acquisition.test.ts` (contract, population
   sample, exporter modes, review-sample determinism — DB-free) and
   `tests/integration/draftguru-import.test.ts` (a bridge dataset on an ISSUE-221-style
   namespaced fixture: agree-with-human, contradict-human HALT, unregistered target HALT on an
   unfiltered dataset and withheld on a resolved one, collision refused, propagation to every
   pick, idempotent re-run, **and the load → reversal → reload identity comparison of §7.4 in
   miniature**). `tests/match-backtest-compare.test.ts` unchanged.

Gate (DB-free): `npx vitest run tests/draftguru-acquisition.test.ts`, `npx tsc --noEmit -p .`,
eslint clean; `import_draftguru.py --validate-only --bridge <empty dataset>` passes. Gate
(isolated test database): `npx vitest run tests/integration/draftguru-import.test.ts` green.
STOP if any change is needed to `apply_authority()`'s authority order or HALT semantics.

### Phase 2 — Acquisition (operator-run, network only, separately approved)

Not authorised by this runbook's approval alone: the operator approves the run explicitly
(B2 §18: "no complete person snapshot may be acquired until the user separately approves it").

```text
# proposed argv shape, final flags fixed in Phase 1
.venv/Scripts/python.exe tools/rebuild/draftguru/stage_b3_population.py --label person-html-<YYYYMMDD>
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_persons.py --label person-html-<YYYYMMDD> --probe <one player_url>
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_persons.py --label person-html-<YYYYMMDD>
```

Expected outputs: `fetched + failed = 5,057`; `parsed/person_profile.jsonl`,
`parsed/afltables_link_profile.json` (with the by-year / top-10 failure breakdown), manifest
written last. Gate: the 120 B1 anchors reproduce their identity/absence semantically (drift
listed as findings); `collisions`, `multiple_candidates`, `self_link_disagreement`,
`malformed_links` reported with counts; the §2.6 ceiling and concentration triggers evaluated
and, where triggered, the retry decision recorded before Phase 3. STOP if robots.txt disallows
`/players/*`, if the ceiling is exceeded, or if any B1 anchor changes identity.

### Phase 3 — Derive, review and resolve the datasets (implementation + operator review)

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/export_person_bridge.py --source-evidence --label person-html-<YYYYMMDD> --out data/reference/draftguru-person-bridge-<YYYYMMDD>-v1.json
.venv/Scripts/python.exe tools/rebuild/draftguru/export_person_bridge.py --review-sample data/reference/draftguru-person-bridge-<YYYYMMDD>-v1.json --salt AFLDB-ISSUE-222/v1 --n <O-1> --out docs/rebuild-manifests/draftguru/bridge-review-<YYYYMMDD>-v1.json
.venv/Scripts/python.exe tools/rebuild/draftguru/export_person_bridge.py --resolve-against afldb_test --parent data/reference/draftguru-person-bridge-<YYYYMMDD>-v1.json --out data/reference/draftguru-person-bridge-<YYYYMMDD>-v1.afldb_test.json
.venv/Scripts/python.exe tools/rebuild/draftguru/import_draftguru.py --validate-only --bridge data/reference/draftguru-person-bridge-<YYYYMMDD>-v1.afldb_test.json
```

Expected outputs: parent counts (`B-linked` candidates, withheld by reason), the review-sample
file (census + random strata, unreviewed), the `afldb_test` deployment dataset (expected equal to
the parent; any `target_not_registered` explained). The Tier 2 label file for §6.10 via
`npm run match:draft-labels` (same session, read-only). Gate: the §3.5 review is completed and
recorded **on the parent** with 0 failures at the chosen n (or the §3.5 failure procedure has
run to a new version with its own 0-failure revalidation); the operator reviews the withheld
lists; the datasets and review records are committed. STOP on any unexplained failure, any
collision the operator has not acknowledged, or a review verdict of `undetermined`.

### Phase 4a — `afldb_test` rebuild, then the demonstrated rollback

```text
npm run db:test:rebuild -- --acknowledge-destroy afldb_test
```

Expected: the `draftguru` stage reports `authority: bridge = <deployment bridges.length>`,
`ledger = 6`, FINAL VALIDATION green including the new expectations. Gate: §6.1–§6.5, §6.7,
§6.8 items 1–4 and the **§7.4 rollback exercise** on `afldb_test`. STOP on any HALT
(bridge/human contradiction, target ≠ 1 player) or any §6.3 known-answer failure not adjudicated.

### Phase 4b — DEV, then PROD (separate gates, §7)

DEV uses the established in-place data refresh (`docs/deployment.md` §7) — the same importer,
on the host, against the DEV import DSN, with the **DEV deployment dataset** (§4.5, resolved
against DEV's own registration in Phase 3 or a Phase 4b pre-step), in this order:
`--validate-only`, then `--dry-run`, then the real run; `tools/migration/rebuild_derived.py` is
**not** required (verified 2026-09-18: it contains no reference to draft tables); then
`npm run build && sudo systemctl restart afldb` for the ISR pages; **then** the §6.6 browser
checks. PROD repeats it after a proven backup (`backup.sh`, the `docs/production-promotion.md` §4
procedure), never on the same day as DEV.

### Phase 5 — Closeout

Gridley corpus comment update, ISSUE-222 ledger Resolution, `IssuesIndex.md`, Open Issues table,
`CHANGELOG.md` (data behaviour materially changed: draft links populated), and the §6.10
calibration table recorded as an addendum on ISSUE-164's ledger entry **without** changing D-9.

---

## 6. Validation and acceptance

### 6.1 Reconciliation — persons and picks, separately, in one unit each

**Person level (5,057 persons on every target).** Every `draft_persons` row is assigned exactly
one §3.3 outcome from the datasets and the stored row, and the partition must sum to the
population:

```sql
-- stored outcome per person; the exporter's reason for every non-linked person is joined
-- from the deployment dataset's withheld[] and the profile output, offline
SELECT link_status, match_method,
       (reported_games > 0) AS played,            -- breakdown only
       count(*)
  FROM draft_persons GROUP BY 1,2,3 ORDER BY 1,2,3;
```

Acceptance (AFLDB-ISSUE-222 Phase 3 correction, §A): `H-linked` = 5 and `H-unlinked` = 1 (the
ledger, unchanged). `B-linked` = the importer's `authority: bridge` counter — **not** the
deployment dataset's `bridges.length` directly, because `apply_authority()` step 2 excludes a
bridge row that agrees with an existing explicit human decision (it `continue`s without
incrementing `stats["bridge"]`) rather than re-applying it. The two must be asserted
**separately**: `bridges.length` (currently 3,463) = `authority: bridge` (currently expected
3,460, per the correction handoff §3) + the number of agreeing human-decision rows the ledger
already carries for a target the bridge also names (currently 3: `matt_rendell/1`,
`nathan_fyfe/1`, `ryan_o'keefe/1`) — reported via `authority: ledger` (5 `H-linked` + 1
`H-unlinked` = 6, unaffected by the agreement, since those three were already counted there).
`W-*` + `U-*` = the rest, each with a reason, and `W-unregistered` on `afldb_test` is 0 or
explained. `played` is reported beside each outcome as a breakdown; **a `B-linked` person with
`reported_games = 0` is not a defect and an `U-no-href` person with `reported_games > 0` is a
recorded gap, not a failure of this run**. No outcome is inferred from games.

**Pick level (6,810 picks).** Every pick inherits its person's outcome (§4.2), so:

```sql
SELECT dp.draft_year, dp.draft_kind,
       count(*) AS picks,
       count(*) FILTER (WHERE dp.link_status_value = 'resolved') AS human_linked,
       count(*) FILTER (WHERE dp.link_status_value = 'unique')   AS bridge_linked,
       count(*) FILTER (WHERE dp.link_status_value NOT IN ('unique','resolved')) AS unlinked,
       count(*) FILTER (WHERE per.reported_games > 0) AS played   -- breakdown only
  FROM draft_picks dp JOIN draft_persons per ON per.id = dp.draft_person_id
 GROUP BY 1,2 ORDER BY 1,2;
```

Acceptance: for every (year, kind) cell, `bridge_linked` = the number of picks whose person is
`B-linked` (computed offline from the dataset joined to the Stage A `rows.jsonl`) and
`human_linked` = picks of `H-linked` persons; `unlinked` = picks of `W-*` / `U-*` persons. A cell
where the stored counts differ from the dataset-derived expectation is a defect. **Capability
statement per cell:** `bridge_linked + human_linked` over `picks`, published in the closeout as
the honest coverage — the `unlinked` remainder is a recorded gap, not acceptance (§2.6 item 3).
Pick range: the same table filtered to `pick_number BETWEEN 1 AND 10` and `11 AND 30` for
`national` and `rookie`.

Consistency check across the two levels: every pick's `player_id` equals its person's
`player_id` (expect 0 mismatches).

### 6.2 National Draft picks 1–10, 1981 onwards

Denominator from Phase 0 Q4 (42 drafts: 1981, 1982, 1986–2025; **1983–1985 are intentional
source gaps — no draft held**, `draftguru-contract.json` `known_coverage_gaps`; the 1981/1982/1987
rows are `'National Draft'`/`national`, absent-column contract). For every top-10 national pick
the closeout lists its person's §3.3 outcome code and, for `B-linked`, the player id and the
census-review verdict (§3.5). A top-10 pick who never played senior football is expected to be
`U-no-href` and is **not** a defect; a top-10 pick with an AFL career at `U-*`/`W-*` **is** a
finding to investigate (page, href, registration), never to hand-link from the score. Acceptance:
zero rows without an outcome code, zero `undetermined` census verdicts, and the by-year coverage
(`B-linked + H-linked` over `top10_picks`) stated for every draft.

### 6.3 The eight builders and six Gridley criteria — on the real linked population

Fixture tests and coverage tables do not prove the criteria answer correctly; the real eligible
sets must be compared with Gridley's known answers regardless of the global probe:

1. `tests/integration/grid-solver.test.ts` (ISSUE-221 draft-fixture describe and the whole
   file) green on `afldb_test` — builder **semantics** only.
2. **Direct evaluation of the six draft criteria (proposed test-tooling change, Phase 1
   item 6).** Today `gappedCriteria` (line 398) routes every cell touching a draft criterion to
   `dataset gap` at line 509–511 **before** any known-answer comparison whenever the probe is
   below 50%, so a run below the threshold cannot score them at all. Proposed: an explicit
   env override `AFLDB_GRIDLEY_SCORE_DRAFT=1` that sets `gaps.draftLinks = true` **only** (the
   probe's measured value is still logged; `matchEvents`, `heights`, `dobs`, `coaches`,
   `fatherSon`, `siblings`, `afterSiren`, `maxSeason`, the strict/diagnostic split at line 457
   and the "NOT an acceptance run" notice are untouched). Under it, `pick1`, `picktop5`,
   `picktop10`, `pickrookie`, `freeagent1`, `traded1` go through the normal per-cell path and
   their eligible sets are compared with Gridley's answer keys cell by cell.
3. Run: `AFLDB_GRIDLEY_DIAGNOSTIC=1 AFLDB_GRIDLEY_SCORE_DRAFT=1 npx vitest run tests/integration/gridley-corpus.test.ts`,
   and separately without the override to confirm the rest of the corpus is byte-identical in
   its findings (zero movement outside the six criteria).
4. Every finding on the six criteria is triaged to exactly one cause: **linkage** (a person the
   bridge linked wrongly or failed to link — blocks closure until corrected or explicitly
   adjudicated as a source gap with the outcome code recorded), **builder semantics** (a new
   issue; not fixed here), or **Gridley's own key** (recorded as `external source disagreement`
   with evidence, as the suite already does for other criteria). An untriaged
   `incorrect known answer` on a draft criterion blocks closure.
5. If the probe does cross 50% the override becomes a no-op and the same evaluation runs
   natively; the comment in the suite is updated in Phase 5 either way.

### 6.4 Negative controls — authority-aware

- **Bridge-derived links only:** for every `draft_persons` row with
  `match_method = 'draftguru_person_page_afltables_bridge'`, the linked player's
  `external_identities(afltables, afltables_profile_url)` path equals the person's observed href
  in the dataset (SQL join against the dataset's `bridges[]`, expect 0 mismatches). This check is
  **not** applied to human-decided rows.
- **Human-decided rows against their own authority records:** the five `linked` and one
  `confirmed_unlinked` ledger persons carry `match_method = 'draftguru_explicit_admin_decision'`
  with the ledger's target (`afltables` path → player, or the seeded `draftguru` identity for
  `fred_rodriguez/1` / `riley_onley/1`, which carry **no href** and must not be expected to);
  on DEV/PROD, every live `player_link_resolutions` decision (Phase 0 Q6) is reproduced exactly
  (same action, same `player_id`). Expect 0 differences.
- **Convergence pairs (and every same-slug pair):** both members keep distinct
  `draft_persons` rows and distinct `external_identities(draftguru)` rows; the two members
  **never share a `player_id`** (collision rule); each member's link, if any, is justified by
  its **own** href or its own human decision. A previously silent member that now carries an
  admissible href **may** link — that is new evidence, not a defect. Expect 0 shared ids.
- The `confirmed_unlinked` person stays `unmatched`; trade and free-agency rows still carry
  `pick_number IS NULL`; `drafted_by_club(X)` excludes them (ISSUE-221 fixture) and
  `traded_min_times` counts them; `draft_type_is('<kind>')` returns only that kind's rows.
- Sam Chapman: outcome per §3.6; `player_id` is 11609 or 10273 only if `B-linked` to that
  registered identity.
- **Known-answer failures caused by linkage block closure** until corrected in a new dataset
  version or explicitly adjudicated in the ledger (§6.3 item 4).

### 6.5 Independent bridge precision (the trust criterion)

Executed as §3.5: census stratum (every bridged national top-10 person) reviewed in full; random
stratum n per O-1 with the declared salt, **0 failures required**; the achieved bound
(`zeroFailureUpperBound(n)`) recorded beside n; original sample and every verdict preserved; any
failure follows the §3.5 procedure (root cause across the population, new dataset version,
independent revalidation with a new salt) — **never** withhold-and-redraw on the same version.
No DEV write before this criterion is met on the version that ships.

### 6.6 Surfaces (post-DEV browser checks, after Phase 4b DEV)

- `/draft/[year]` for 1981, 1987, 2001 (the anchor year), 2025: linked players render as
  links; unlinked rows still render.
- Player pages: Nathan Fyfe (already linked, unchanged), one newly bridged top-10 pick, one
  traded player (list move shown, not a draft).
- `/admin/player-links?table=draft_picks`: queue shrinks to the unresolved population; a manual
  approval on one unresolved person still works and still propagates (`resolved`).
- `/admin/draft`: manual pick creation unaffected; `listManualPlayersAwaitingIdentity()`
  unchanged.
- `/grid-solver` (super admin): `national_draft_pick_between(1,10)` renders players, not "No
  data"; the ISSUE-221 "Invalid value" and Reset behaviours unchanged.

### 6.7 The `draftLinks` probe and its 50% threshold — what it proves and does not

The probe (`gridley-corpus.test.ts` line ~341) is `linked × 2 ≥ total`. Crossing it means only
that at least 3,405 of 6,810 picks carry a trusted link, so the suite **natively** starts
scoring the six draft criteria instead of classifying them `dataset gap`. It proves nothing
about correctness, top-10 coverage or the unresolved population. Whether it is crossed depends
on Phase 0 Q3 times the bridge's coverage (B1: 97% of the played cohort). **Either way the six
criteria are evaluated against the real population under §6.3; crossing 50% is not acceptance,
and failing to cross it is neither failure nor an excuse to skip the evaluation.**

### 6.8 Test ladder

1. DB-free: `npx vitest run tests/draftguru-acquisition.test.ts tests/match-backtest-compare.test.ts`; `npx tsc --noEmit -p .`; eslint.
2. Isolated test database: `npx vitest run tests/integration/draftguru-import.test.ts tests/integration/grid-solver.test.ts`.
3. `afldb_test` after Phase 4a: §6.1, §6.2, §6.4, the §7.4 rollback exercise.
4. Corpus on `afldb_test`: `AFLDB_GRIDLEY_DIAGNOSTIC=1 AFLDB_GRIDLEY_SCORE_DRAFT=1 npx vitest run tests/integration/gridley-corpus.test.ts` and the control run without the override.
5. DEV: the §7.2 command sequence, then the §6.6 browser checks; `npm run build` is part of the
   DEV refresh.

### 6.9 Acceptance summary

Closure requires §6.1 (both levels reconciled, capability stated per cell), §6.2, §6.3 (every
draft-criterion finding triaged; linkage causes corrected or adjudicated), §6.4, §6.5, §6.6,
§7.4 (rollback demonstrated), and §6.10 recorded on ISSUE-164 with D-9 unchanged.

### 6.10 Calibration table (ISSUE-164 §9.1, recorded, not acted on)

```text
npm run match:draft-labels -- <person-html-<date>>/parsed/person_profile.jsonl --out draft-labels-b3-<date>.json --label-set draft-b3-person-page-<date> --zero-game-cohort <tag fixed in Phase 1 item 2>
npm run match:backtest -- --labels draft-labels-b3-<date>.json --out backtest-p1c-draft-labels-b3.json
```

Expected: exit code 2 (the D-9 stop condition, bulk n = 0) with the full §9.1 table, the true-
negative table and every wrong top-1 enumerated. Recorded as an addendum on ISSUE-164; **no D-9
change, no weight change, no bulk change.**

---

## 7. Promotion and reversal

### 7.1 Gates before any DEV command

All on `afldb_test` (Phase 4a) or the isolated test database, none on DEV: §6.1, §6.2, §6.3,
§6.4, §6.5 on the version that ships, §6.8 items 1–4, and the §7.4 rollback exercise. Browser
checks (§6.6) are **post-DEV** and are not a precondition of the DEV command. The deployment
dataset that ships to DEV is the DEV-resolved child (§4.5) of the **same parent version** that
passed on `afldb_test`; a new parent version restarts Phase 3.

### 7.2 DEV gate

Preconditions: ISSUE-221 resolved on DEV (U6); Phase 0 Q5/Q6/Q7 on DEV recorded (registration
count, every live human draft decision, manual picks and active overrides); the DEV deployment
dataset resolved against that registration; a DEV backup exists. Sequence: `--validate-only` →
`--dry-run` (AFLDB-ISSUE-222 Phase 3 correction §A: must report `authority: bridge` = the DEV
dataset's `bridges.length` **minus** any bridge rows that agree with an existing explicit human
decision for that target — assert the two counts separately, not `bridges.length` directly;
`ledger` and `live_override` consistent with Q6, and **0 HALTs**) → real run → §6.1 and §6.4 on
DEV (live decisions reproduced exactly; manual picks and overrides intact against Q7) →
build/restart → §6.6 browser checks. The importer runs inside one transaction: a HALT rolls
everything back and leaves the failed `import_batches` row as the audit. Live human decisions win
over the bridge by construction; `data_overrides` are replayed inside the same transaction.

### 7.3 PROD gate

Separate approval, after DEV has been used for at least one operator test cycle
(`dev-is-for-testing-before-prod`). Proven backup first. Same sequence with the PROD deployment
dataset and the PROD import DSN. Do not run the promotion adapters of
`docs/production-promotion.md`: that document governs a rebuilt-candidate promotion, not this
in-place data refresh.

### 7.4 Reversal — demonstrated on `afldb_test` before DEV, then available on every target

**Two different operations, named apart:**

- **Initial-load rollback** — return a target to the pre-bridge state: re-run
  `import_draftguru.py` on that target **without** `--bridge`. Reload-by-key rewrites every
  `B-linked` person back to `unmatched` / `player_id NULL` (links are recomputed every run,
  §4.3), leaves every explicit human decision exactly as `apply_authority()` step 1 recomputes
  it (ledger and live), replays `data_overrides`, reconciles `external_identities(draftguru)`
  to `unmatched` through `reconcile_draftguru_identities()` (person rows are neither added nor
  deleted, so the population-drop guard does not engage), and records a new `import_batches`
  row.
- **Restore an earlier accepted dataset version** — re-run with `--bridge` naming the earlier
  version's deployment file (its sha256 is in the ledger); the same recomputation lands exactly
  that version's `B-linked` set. This is how a v2 that turns out wrong is backed out to v1
  without touching anything human.

**Mandatory exercise on `afldb_test` (Phase 4a, before any DEV command):**

1. Snapshot **S0** (pre-bridge, after the plain rebuild or after step 4 below): full row images
   of `draft_persons (player_url, player_id, link_status, match_method, confidence_notes,
   is_matching_backlog)`, `draft_picks` keyed by `(player_url, draft_year, draft_kind)` with
   `(player_id, link_status_value, match_method)` plus every `source_id IS NULL` row in full,
   `external_identities` where `source_id = draftguru` `(external_id, player_id, status,
   match_method)`, `player_link_resolutions` for `draft_picks` in full, `data_overrides` for
   `draft_picks` in full. Not counts — **identities**.
2. Load with `--bridge <afldb_test deployment v<N>>` → snapshot **S1**. Assert: S1 − S0 differs
   **only** in rows whose person is in the dataset's `bridges[]` (exactly `bridges.length`
   persons moved `unmatched → unique` with the expected `player_id`; their picks moved
   likewise); every `H-*` row identical; every `source_id IS NULL` pick identical; every
   `player_link_resolutions` and `data_overrides` row identical; `external_identities(draftguru)`
   changed only for those persons.
3. Reverse (no `--bridge`) → snapshot **S2**. Assert **S2 = S0 exactly**, row for row.
4. Reload with the same deployment dataset → snapshot **S3**. Assert **S3 = S1 exactly**
   (idempotent restoration) and the `import_batches` rows record the three runs.
5. (Only if a v2 exists) load v2 → restore v1 → assert the result equals S1.

A comparison script for S0–S3 is proposed tooling (Phase 1 item 7 holds the miniature; the
`afldb_test` exercise may use `psql` `\copy` exports diffed offline). Any difference outside the
asserted set → STOP; the reversal is not proven and DEV is not touched.

**Single-person reversal on any target:** withhold the person in a new dataset version (with
reason) and re-run; or a curator records a human decision through `/admin/player-links`, which
then outranks the bridge on every future run.

**Never:** raw `UPDATE draft_picks` / `draft_persons`; deleting `player_link_resolutions` rows;
editing the ledger or a shipped dataset version by hand.

### 7.5 Conditions requiring a stop or renewed review

Any bridge/human contradiction HALT; any collision not acknowledged; any §6.5 failure (the §3.5
procedure, never a redraw); a B1 anchor changing identity between snapshots; `--dry-run` on
DEV/PROD reporting `authority: bridge` different from that target's dataset `bridges.length`;
a §7.4 snapshot comparison differing outside the asserted set; `draftLinks` or `B-linked`
regressing after a later reload; a Grid Solver known-answer failure on a draft criterion traced
to linkage and not yet corrected or adjudicated.

---

## 8. Handoff

### 8.1 Recommended sequence

Phase 0 (after ISSUE-221 resolves) → Phase 1 (one implementation session, Sonnet 5 or Fable 5.1,
High) → Phase 2 (operator, ~3 h wall clock) → Phase 3 (one session + operator review; the §3.5
review is operator time — at n = 598 plus the census, plan for several hours) → Phase 4a incl.
the rollback exercise → Phase 4b DEV → operator test cycle → Phase 4b PROD → Phase 5.

### 8.2 Remaining risks and operator decisions

- ~~**O-1**~~ **DECIDED 2026-09-18 (§0): n = 598** on the random stratum (0.5% bound), census
  stratum in full, revision 2 sampling/failure-handling rules preserved.
- ~~**O-2**~~ **DECIDED 2026-09-18 (§0): not changed.** `external_identities.notes` stays as-is;
  provenance in the dataset artefacts and `confidence_notes`.
- ~~**O-3**~~ **DECIDED 2026-09-18 (§0): 2% overall / 5% per year / any national top-10
  failure** — already implemented in Phase 1 (`person_stage.b3.crawl_failure_ceiling_pct`,
  `concentration_triggers`), no code change required.
- **Population unknowns** until Phase 2 actually runs: how many persons played, how many pages
  carry hrefs, whether the 50% probe flips. Acceptance does not depend on them.
- **Registration delta between databases:** handled by the per-target deployment datasets
  (§4.5); a large `target_not_registered` list on DEV/PROD is a finding to explain before
  Phase 4b, not a reason to filter silently.
- **`--zero-game-cohort` tag** for the B3 population: fixed in Phase 1 implementation as
  `"games_zero"` (`stage_b3_population.py --zero-game-cohort`, default `games_zero`).
- **Settled:** `tools/migration/rebuild_derived.py` reads no draft table (searched 2026-09-18),
  so the DEV/PROD refresh needs no derived rebuild after the import.

### 8.3 Acceptance evidence required for closure

§6.1 both levels reconciled with capability stated per cell; §6.2 top-10 disposition list with
zero unexplained rows; §6.3 real-population evaluation with every draft-criterion finding
triaged and linkage causes corrected or adjudicated; §6.4 controls all 0/unchanged; §6.5 n,
achieved bound, 0 failures on the shipped version, with every earlier version's failures
preserved; §7.4 rollback exercise S0–S3 proven on `afldb_test`; §6.6 browser checks on DEV;
§6.10 table recorded on ISSUE-164 with D-9 unchanged; the dataset versions (parent and
per-target, with hashes), manifest and `import_batches` ids named in the ledger. Reconsideration
of D-9 is **not** a closure condition and is not proposed.

### 8.4 Self-contained prompt for the implementation session (use after approval)

```text
Work in the worktree created by `npm run worktree:bootstrap -- --issue 222 --branch <agent>/issue-222`.
Model/effort: Sonnet 5 or Fable 5.1, High. Mode: implementation of an APPROVED runbook.
Task: execute AFLDB-ISSUE-222 Phase 1 only, per AFLDB-ISSUE-222.md §5 Phase 1 items 1-7 and §2-§4, §6.3 item 2, §7.4.
Read first: CLAUDE.md; IssuesIndex.md; AFLDB-ISSUE-222.md in full; issues/closed/AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md §12-§15, §18; tools/rebuild/draftguru/{draftguru-contract.json, acquire_persons.py, stage_b1_sample.py, profile_person_pages.py, import_draftguru.py (load_bridge, apply_authority, read_live_decisions, reconcile_draftguru_identities, validate, run_import), reconcile_person_bridge.py}; tools/migration/common.py (reload_keyed, check_population_drop); tools/db/rebuild-test.ts (draftguru stage, draftguruImportArgv, DRAFTGURU_PREFLIGHT_FILES, final validation); tests/integration/gridley-corpus.test.ts (gaps, gappedCriteria, lines ~330-345, ~395-410, ~505-512, ~457-467); tests/draftguru-acquisition.test.ts; tests/integration/draftguru-import.test.ts.
Boundaries: no network request; no database write except the isolated integration-test database (AFLDB_TEST_DATABASE_URL, name ending _test) and only through the test suites; no change to apply_authority()'s authority order or HALT semantics; no change to any Stage A / B1 artefact; the B1 label stays refused for B3 writes; no name-based matching anywhere; D-9 untouched; the AFLDB_GRIDLEY_SCORE_DRAFT override changes gaps.draftLinks only; the user runs all commands and Git.
Stop at the Phase 1 gate and report: files changed, DB-free results, isolated-test-database results, tsc/eslint, and the exact Phase 2 and Phase 3 command lines with their final flags. Do not start Phase 2. Do not touch afldb_test, DEV or PROD.
```

---

## 9. Reading order for the reviewer of this draft

1. §0 (decisions), §1 (scope), §10 (what changed in revision 2).
2. `AFLDB-ISSUE-221.md` §2–§4 (evidence) — not repeated here.
3. `issues/closed/AFLDB-ISSUE-164.md` §9.1, §12 P1c items 5, 6, 8, 10, §13 item 2b, §17 D-9.
4. `issues/closed/AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md` §12–§15, §18.
5. `tools/rebuild/draftguru/import_draftguru.py` `load_bridge()`, `apply_authority()`,
   `read_live_decisions()`, `reconcile_draftguru_identities()`, `run_import()`.
6. §3.5, §4.5, §6.3, §7.4 (the revised trust, artefact, evaluation and rollback contracts).

## 10. Revision 2 record (2026-09-18) — review findings and their verification

| # | Finding | Disposition | Evidence checked |
|---|---|---|---|
| 1 | §6.1 mixed pick-level links with games-based expectations | **Accepted** — separate person/pick reconciliation on the §3.3 outcome codes; games is a breakdown only; zero-game bridged persons are ordinary | migration 019 model; B2 §15/§18 (4 of 24 zero-game persons bridged) |
| 2 | §3.5/§6.5 allowed withhold-and-redraw; n = 253 borrowed from the matcher | **Accepted** — census + salted random strata, n tied to the bound and the public consequence, failures preserved, root cause across the population, versioned dataset, salted revalidation; club differences allowed | `label-set.ts` `zeroFailureUpperBound`; contract `control_ordering`; ISSUE-164 §12 P1c item 6 (the 253 parity rule is a matcher rule) |
| 3 | "ship the tested dataset" vs per-target filtering | **Accepted** — one immutable source-evidence parent plus hashed per-target deployment children; importer unchanged | `apply_authority()` step 2 raises `ImportFailure` on a target resolving to ≠ 1 player, so an unfiltered dataset cannot import on a target that has not registered every identity |
| 4 | Six draft criteria unscored below 50% | **Accepted** — `AFLDB_GRIDLEY_SCORE_DRAFT=1` override (proposed, scoring-only) and mandatory triage | `gridley-corpus.test.ts` line 398 (`gappedCriteria`) and 509–511 (`dataset gap` before any comparison) |
| 5 | href-equality check applied to human rows; convergence member forced unlinked | **Accepted** — check scoped to `match_method = bridge`; human rows checked against ledger/live records; same-slug pairs distinct with no shared `player_id`; new evidence may link | ledger persons `fred_rodriguez/1` / `riley_onley/1` are seeded `draftguru`-source targets with no href (B1 UNLABELLED list); §14 collision rule |
| 6 | Rollback asserted, not demonstrated | **Accepted** — mandatory S0–S3 identity comparison on `afldb_test`; initial-load rollback vs restore-earlier-version distinguished | `reload_keyed(..., link_columns=None)` → links recomputed each run; `check_population_drop` counts person rows, so a reversal does not trip it |
| 7 | Phase 1 "no DB" vs test writes; browser checks before DEV command | **Accepted** — per-phase database boundaries; §7.1 test-DB gates, §7.2 DEV sequence, §6.6 post-DEV; prompt aligned | — |
| 8 | Crawl failures collapsed into coverage | **Accepted** — §2.6 separates ceiling, concentration (by year / top-10) and coverage; reason ≠ capability | profiler aggregate has no per-year breakdown today (proposed in Phase 1 item 3) |

---

## 11. Phase 1 closeout and Phase 2 authorisation (2026-09-18)

**This section is a pointer, not the evidence.** The authoritative validation record — exact
pass/fail/skip counts, the real-`afldb_test` runs, the snapshot verification-before-copy, and
every fix made along the way — is the `AFLDB-ISSUE-222` entry in `issues.md`. Nothing here
restates it; this section only records what is now decided/authorised and the resulting
boundary for the next session.

### 11.1 Phase 1 — CLOSED

Implemented and validated by Sonnet 5, worktree `afldb-issue-222`, branch `sonnet/issue-222`,
uncommitted: `person_stage.b3` contract block; `stage_b3_population.py` (new);
`export_person_bridge.py` (new, `--source-evidence`/`--resolve-against`/`--review-sample`);
`profile_person_pages.py` and `acquire_persons.py` extended for the B3 shape and the §2.6
by-year/top-10 breakdown; `tools/db/rebuild-test.ts` threads an optional `--draftguru-bridge`
through preflight, the data stage and FINAL VALIDATION; `tests/integration/gridley-corpus.test.ts`
gained the scoring-only `AFLDB_GRIDLEY_SCORE_DRAFT=1` override; test suites extended accordingly.
DB-free and isolated-`afldb_test` validation both genuinely executed and green — exact counts in
`issues.md`. No `apply_authority()`/HALT-semantics change; D-9 untouched; no DEV/PROD write.

### 11.2 O-1 / O-2 / O-3 — DECIDED 2026-09-18 (recorded in §0 and at each cited section)

See §0's O-1/O-2/O-3 rows and the updated §2.6, §3.5, §4.3, §8.2. Summary: O-1 census-in-full +
n = 598 random stratum, revision 2 rules preserved; O-2 no importer change; O-3 2% overall / 5%
per year / any national top-10 failure — the latter two already match Phase 1's implemented
contract defaults exactly, so no further code change is required by these decisions.

### 11.3 Phase 2 — AUTHORISED, narrowly (2026-09-18)

**Authorised:** exactly **one** new Stage B3 whole-population acquisition run (§2, §5 Phase 2),
producing one new immutable snapshot under label `person-html-<YYYYMMDD>` (the date of the run;
`person-html-20260826`, the accepted Stage B1 snapshot, stays refused for this write), under the
existing robots/pacing/retry/immutability rules (§2.2, §2.5, §2.6) — concurrency 1, 1.5s minimum
pacing, 20s timeout, 3 retries at 2/4/8s, robots.txt respected with `/players/*` checked, manifest
written last.

**NOT authorised by this decision:** any database import (`import_draftguru.py --bridge` on any
target, including `afldb_test`); any DEV/PROD write; any deployment; Phase 3 (bridge
derivation/review), Phase 4 (rebuild integration) or Phase 5 (closeout). Acquisition output is a
local, gitignored snapshot only. The next session's own boundary and exact commands are in the
fresh-session handoff prepared alongside this runbook update (see `issues.md` for its filename and
location) — that document, not this paragraph, is the operating brief for the acquisition session.

### 11.4 Phase 2 executed — aggregation defect, fix, and result (2026-09-18)

The operator ran the Phase 2 acquisition session under label `person-html-20260918`. The HTTP
fetch layer completed cleanly (5,057/5,057 fetched, 0 HTTP failures), then `acquire_persons.py`
crashed during post-fetch aggregation, before any parsed output or manifest was written:
`KeyError: 'residual_input'` in `profile_person_pages.py`'s `aggregate()`.

**Root cause:** `aggregate()` and `acquire_persons.py`'s `build_manifest()` both unconditionally
read Stage B1-only `sample.json` fields (`residual_input`, `selection.control_ordering`) that a
Stage B3 whole-population `sample.json` (`stage_b3_population.py`) does not carry — a pre-existing
Phase 1 gap never exercised end to end against a full Stage B3 population run.

**Fixed** (same session, separate implementation pass): both functions now branch on
`sample.get("stage") == "B3"` and build a stage-appropriate `sample_basis`/`selection` — B1's
output is byte-identical to before (same keys/values under `sort_keys=True` serialisation); B3
instead records `selection.population_rule`, `stage_a_persons_jsonl_sha256`,
`stage_a_rows_jsonl_sha256`, and the `"stage"` field is no longer hardcoded to `"B1"`. Four new
DB-free regression tests added to `tests/draftguru-acquisition.test.ts`. Full detail, validation
evidence and the resumed-run result: `issues.md` → `AFLDB-ISSUE-222`.

**Resumed aggregation (zero network — all 5,057 identities were already terminal from the
interrupted run):** `docs/rebuild-manifests/draftguru/person-html-20260918.json` now exists —
`fetched: 5057`, `failed: 0`. Both O-3 conditions pass clean: `crawl_failure_ceiling.observed_pct`
0.0 vs ceiling 2.0 (not exceeded); `failure_concentration.retry_decision_required: false`
(`years_triggered: []`, `national_top10_trigger_fired: false`). AFL Tables identity coverage:
3,564/5,057 (70.48%) with a single canonical identity, 1,493 absent, 0 ambiguous, 0 collisions.
Wikipedia link capture (§5a): 1,943/5,057 (38.42%) with a captured candidate, 0 ambiguous.
Phase 3 (bridge derivation) remains unaffected and still requires its own separate authorisation —
not implied by this execution.

### 11.5 Phase 3 executed — datasets derived and resolved, reconciliation complete, §6.5 review PENDING (2026-09-18)

**This section is a pointer, not the evidence.** Full detail, every query and the automated
cross-check's complete methodology are in the `AFLDB-ISSUE-222` entry in `issues.md`.

Ran, in order: `export_person_bridge.py --source-evidence` (label `person-html-20260918`) →
`--review-sample` (parent, salt `AFLDB-ISSUE-222/v1`, `--n 598`) →
`--resolve-against afldb_test` (session-only DSN port override to the existing 55432 tunnel,
`.env` unchanged, no credential printed) → read-only reconciliation queries against `afldb_test`
(each its own rolled-back, `default_transaction_read_only=on` transaction) → the DB-free test
ladder. **Zero writes of any kind; no `import_draftguru.py`; no Phase 4/5 work.**

- **Parent** (`data/reference/draftguru-person-bridge-20260918-v1.json`, sha256 `92ff142e…97320e`):
  bridges 3,564, withheld 1,493 (all `U-no-href`), 0 collisions. `provenance.manifest_sha256`
  verified byte-exact against the tracked manifest.
- **`afldb_test` deployment child** (`…v1.afldb_test.json`, sha256 `596bbb68…a9a27f`): bridges
  3,463, withheld 1,594 (1,493 `U-no-href` + 101 `target_not_registered`, 0 `target_ambiguous`).
- **Person-level (5,057):** `H-linked` 5, `H-unlinked` 1, `B-linked` 3,460, `W-unregistered` 101,
  `U-no-href` 1,490. The deployment's 3,463 bridges = 3,460 `B-linked` + 3 ledger persons whose
  href also independently resolves on `afldb_test` (Matt Rendell, Nathan Fyfe, Ryan O'Keefe) — all
  3 **AGREE** with the existing human decision (0 contradicts), the runbook's second, independent
  ledger-href check (§3.5). Every `U-no-href` person has `reported_games = 0` (0/1,490 played);
  every `W-unregistered` person has `reported_games > 0` (101/101).
- **`target_not_registered` (101) investigated — corrected 2026-09-18 (Phase 3 correction §E,
  §10.3; the original "registration lag" narrative below this line did not reproduce from
  `rows.jsonl` and is retired):** 6 are an AFL Tables numeric-disambiguation mismatch (bridge
  names the bare path, `afldb_test` registers a suffixed one, e.g. `Joel_Smith.html` vs
  registered `Joel_Smith0.html`/`Joel_Smith1.html` for two distinct AFLDB players; 5 of the 6 have
  strong retained sibling evidence, `Aaron_Black` remains inferred) — correctly withheld, not a
  wrong link; 2 are spelling/name-change cases found by an **untracked** fuzzy search and **not
  fully proven by retained tracked evidence** (Dean Laidley → registered as Dani Laidley; Matthew
  Capuano → registered as Mathew Capuano); `stephen_schwerdt/1` → registered `Steven_Schwerdt.html`
  (1989, 25 games) is a **likely third spelling case**, not registration lag. The offline
  measurement (correction handoff §10.3) found **0 of the 101** `target_not_registered` paths
  appear anywhere in the accepted fitzRoy `full-history-20260902` snapshot's 13,275-URL set, while
  all 3,463 bridged paths do — `afldb_test`'s registered set equals the accepted snapshot's URL
  set, so "not registered" means **no appearance in the accepted 1897–2025 source** (a 2026
  debutant, a player yet to debut, or a numbering/spelling case whose captured path differs from
  the snapshot's), never `afldb_test` staleness. By first DraftGuru draft year the 101 split: 2025
  60, 2024 14, 2023 14, 2022 2, 2021 2, 2009 1, 2007 1, 2006 1, 2004 1, 2003 1, 1994 1, 1992 2,
  1989 1. Whether a live AFL Tables page nonetheless exists for a given path is a separate fact,
  not required for Phase 3.
- **National Draft top-10 (§6.2):** 420 picks / 418 persons across 42 years. Projected:
  `B-linked` 389, `U-no-href` 19, `W-unregistered` 12; coverage 92.62%. All 12 gaps explained by
  the mechanisms above — the entire 2025 top-10 (registration lag) plus Joel Smith (renumbering)
  and Jagga Smith (registration lag).
- **Pick-level (6,810), PROJECTED not applied:** `human_linked` 5, `bridge_linked` 5,101,
  `unlinked` 1,704 — capability 74.98%. Currently stored (unchanged this session): 5 / 0 / 6,805.
- **§3.5 review sample** (`docs/rebuild-manifests/draftguru/bridge-review-20260918-v1.json`,
  sha256 `036cc082…445ba84`): census 399 (every bridged national top-10 person, exhaustive),
  random 598 (salt `AFLDB-ISSUE-222/v1`, first 598 of 3,165 remaining), disjoint (verified), all
  997 verdicts unreviewed as written.
- **Review status — PENDING, not passed.** An automated, read-only, no-fetch cross-check (name
  and age/DOB consistency only, from the already-captured snapshot and `afldb_test` player data)
  found 0 genuine contradictions across all 997 sampled persons (969 checkable against a
  registered `afldb_test` identity; 28 cannot be checked this way, all `target_not_registered`).
  This is **not** the §3.5/§6.5 review: that review is an operator opening the named AFL Tables
  and DraftGuru pages per person and judging the full criterion (name, debut season, age, **and**
  career span against the transaction sequence), which cannot honestly be completed without a
  live fetch this phase forbids. Per the objective's own fallback, the review pack is complete and
  the automated check is reported as supplementary corroboration, but the gate itself is **PENDING
  operator review** — Phase 3 is not accepted, and Phase 4a must not proceed on this basis alone.
- **Tests:** `npx vitest run tests/draftguru-acquisition.test.ts tests/match-backtest-compare.test.ts`
  → 180 passed / 1 failed (pre-existing `AFLDB-ISSUE-223`, unrelated, confirmed unaffected) / 3
  skipped / 184 total — unchanged from the Phase 1/2 baseline (no code touched this pass).
  `npx tsc --noEmit -p .` clean.
- **Files this pass:** three new untracked datasets under `data/reference/` and
  `docs/rebuild-manifests/draftguru/` (named above), `AFLDB-ISSUE-222.md` (this section),
  `issues.md`, `IssuesIndex.md`. No other repository file changed; `AFLDB-ISSUE-221.md` untouched;
  no Git command run.

### 11.6 Phase 3 independent review, correction handoff and prospective decision O-4 (2026-09-18, Fable 5.1, governance only)

An independent review (Fable 5.1, High, read-only) reproduced the parent (3,564 / 1,493), the
`afldb_test` child (3,463 / 1,594, 101 `target_not_registered`) and the review sample (399 + 598,
disjoint, exact order) from the raw snapshot: **the datasets are sound; Phase 3 remains PENDING.**
The review found corrections required in the surrounding evidence, not the data — chiefly that the
importer will apply **3,460** net-new links, not 3,463 (three child rows carry agreeing human
decisions), so the §6.1/§7.2 `authority: bridge = bridges.length` identity cannot hold; an
exporter/importer target-resolution divergence; a residual-93 narrative in §11.5 and `issues.md`
that does not reproduce; and the §3.5 item 1 / sample-file contradiction on where verdicts live.
Full findings, corrected counts in both units, and the fresh correction-session prompt:
**`AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md`**.

**Decision O-4 revision 1 (prospective, recorded 2026-09-18 before any browser review, §0) —
SUPERSEDED the same day by revision 2 (§11.7), never executed:** it would have replaced the §3.5
wording that had the operator personally open both pages for all 997 rows with a Playwright
browser-evidence review of all 997 rows plus operator exception review and a deterministic 30-row
audit. Its runbook was withdrawn before any page was opened; its audit, exception, checkpoint,
acceptance and safety requirements are carried into the revision 2 runbook. No import, DEV/PROD
action or Phase 4 was authorised by it.

### 11.7 Decision O-4 revision 2 — retained evidence first; offline review runbook (2026-09-18, Fable 5.1, governance only)

Before any review execution, revision 1 was superseded by **revision 2**: the §3.5 review is an
offline comparison of all 997 immutable sample rows against evidence the repository already retains
— the captured DraftGuru snapshot (`person-html-20260918`) on the source side; the accepted fitzRoy
snapshot `full-history-20260902` and the `afldb_test` registered identities on the target side —
plus operator review of every exception and a deterministic 30-row audit of clean offline agreements.
Live AFL Tables acquisition is **not authorised**; it is reserved for a measured residual reported to
the operator by category, count and URL, under a new explicit authorisation. Playwright MCP is an
exception/clarification tool only. Sample, salt, n, D-9 and the name-only prohibition are unchanged.
Contract: **`AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md`** (inputs and hashes, population, comparison
fields, output artefacts, the six machine outcomes with the `offline_strong` rule, checkpoint/resume,
recheck queue, acceptance, residual network decision, fresh Sonnet prompt).

**Evidence inventory and feasibility (read-only, no database, no network; correction handoff §9–§10).**
The accepted snapshot's 131 artefacts are absent from every repository checkout on the workstation but
survive in the operator's backup root (Pass 19 staging copy) and **hash-match the tracked manifest
131/131**; `player_stats` carries, per profile URL, name, `Age` (dense) and `DOB` (sparse), debut,
span, games, goals and clubs; `player_details.csv` has no URL/ID/DOB and is never joined. All **969**
registered sample rows (387 census + 582 random) have snapshot rows with three corroborating signals
beyond name; the **28** `target_not_registered` rows (12 + 16) have none, and **0 of the 101**
`target_not_registered` paths appear in the snapshot's 13,275-URL set while all 3,463 bridged paths
do — so "not registered" means **no appearance in the accepted 1897–2025 source** (2026 debutants,
players yet to debut, numbering/spelling cases), not database staleness; the "registration lag"
wording is retired. In-sample flags: 34 numeric-suffix paths, 2 continuity-rule paths, 12 name
variants (11 diminutive/formal + Schwerdt), 15 trade-only persons. No row is known to need a network
request before the run.

**Honest limitation.** fitzRoy/AFLDB evidence is derived from AFL Tables and is not independent of it;
DraftGuru's captured href is the independent source-side assertion. The outcome is recorded as
"retained fitzRoy/AFLDB comparison plus operator exception/audit review".

**Order of work:** corrections + offline tool (handoff §6 A–K, gates §7) → offline comparison →
operator rechecks + 30-row audit → residual decision → only then can §6.5 be assessed. No import,
database import, DEV/PROD action or Phase 4 is authorised. Files this pass: the offline runbook
(new), the correction handoff (revised), `AFLDB-ISSUE-222.md` (§0 O-4 row, §11.6, this section),
`issues.md`, `IssuesIndex.md`; the uncommitted Playwright runbook removed. No dataset, code, test,
network, database or Git action.

### 11.8 Phase 3 corrections implemented and the offline comparison executed (2026-09-18, Sonnet 5, High)

**This section is a pointer, not the evidence.** Full detail is in the `AFLDB-ISSUE-222` entry in
`issues.md` and in the tracked output artefacts named below. **Phase 3 remains PENDING** — this
pass implements the handoff §6 A–K corrections, builds the offline tool, and runs it over all 997
rows; it does **not** perform the operator rechecks or the 30-row audit confirmation, which remain
the operator's.

**Phase A (immutable-input verification, before any code change):** all 131 accepted fitzRoy
artefacts hash-matched the tracked manifest exactly (131 ok / 0 missing / 0 unexpected / 0
mismatch); `artefact_set_sha256` independently recomputed and matched the accepted-baseline
register; every other §1 immutable hash (parent, child, sample, B3/Stage A manifests and parsed
outputs, fitzRoy contract, ledger, aliases, awards identity CSV in both LF and CRLF form)
reproduced exactly; the sample's 399 census + 598 random rows were confirmed disjoint and the
random stratum's order was independently reproduced from `sha256(salt + "|" + player_url)` hex
ascending. No stop condition was hit; nothing was reacquired or repaired.

**Phase B (corrections):**

- **§B exporter/importer alignment:** `export_person_bridge.py`'s `REGISTRATION_SQL` now filters
  on the pinned `match_method` (duplicated as a local constant, pinned equal to
  `import_draftguru.py`'s by a cross-file test, rather than importing that module — the exporter
  must never carry a database-import surface transitively) and counts `count(*)` rather than
  `count(DISTINCT ei.player_id)`, so a duplicate registration is counted the way
  `resolve_afltables_players()`'s un-deduplicated candidate list counts it. Because
  `external_identities` carries `UNIQUE (source_id, external_id)`, a literal duplicate row cannot
  exist under the current schema; the alignment is proved directly on the real functions with a
  fabricated row set standing in for what the query would return
  (`tests/python/draftguru_bridge_resolution_contract.py`). Whether this change would alter the
  *contents* of the already-generated `afldb_test` child cannot be determined this session — that
  requires `--resolve-against`, a live database read, which is out of bounds here; per handoff §7
  gate 9, the child is **not** regenerated, and this is recorded as open for the operator's DB
  session (§7 below).
- A second, real bug found while implementing §B: `admissibility_reason()` required only a
  non-null `afltables_identity`, not the contract's full `canonical_required` (also
  `distinct_afltables_identity_count == 1`). Fixed; on the real captured
  `person_profile.jsonl` the two conditions never diverge (3,564/3,564), so the parent bridge's
  contents are unaffected. `--review-sample` also gained an explicit refusal of a `kind:
  "deployment"` input (previously relied on the absent `provenance.stage_a_label` field alone).
- **§C tests:** all seven required items (duplicate-row registration, `target_ambiguous`, the
  pinned `sha256(salt + "|" + player_url)` digest, `--review-sample` rejecting a deployment child,
  `canonical_required`'s two conjuncts, the real B3 artefact shape, agreeing-human-decision
  exclusion from `stats["bridge"]`) implemented and green — 8 new/modified assertions in
  `tests/draftguru-acquisition.test.ts` plus the new DB-free
  `tests/python/draftguru_bridge_resolution_contract.py` (12 checks, all pass).
- **§D DB-free validate-only**, run against the real (unmodified) child:
  `python tools/rebuild/draftguru/import_draftguru.py --validate-only --bridge data/reference/draftguru-person-bridge-20260918-v1.afldb_test.json`
  → `persons 5057, picks 6810, ledger 6 explicit decisions, bridge 3463 entries` →
  `validate-only: every input check passed. No database was contacted.` (exit 0). This reports the
  *input* count only (`bridges.length`); the `authority: bridge` resolution count (§A, expected
  3,460) is produced only by an actual `--dry-run`/real run, which needs a database and was not
  performed.
- **§A/§E documentation corrections:** `AFLDB-ISSUE-222.md` §6.1 and §7.2 now assert the bridge
  count (3,460, `authority: bridge`) and the agreeing human-decision count (3) separately rather
  than the broken `bridges.length` identity; §11.5, `issues.md`'s Phase 3 entry and
  `IssuesIndex.md` no longer describe the 101 `target_not_registered` residual as "registration
  lag" — they now state the measured fact (0 of the 101 paths appear anywhere in the accepted
  snapshot's 13,275-URL set, so "not registered" means no appearance in the accepted 1897–2025
  source, never `afldb_test` staleness) and record the Schwerdt/Laidley/Capuano evidence honestly
  as inferred, not proven.
- **§F/§G verdict schema:** implemented exactly as the runbook §4 defines it — the sample (`…v1`,
  hash unchanged) stays immutable with every `verdict: null`; the separate verdict artefact
  (below) carries every machine outcome and the full per-row evidence block.

**Phase C (offline tool):** `tools/rebuild/draftguru/review_person_bridge_offline.py` (new, ~800
lines) implements the full runbook §3–§6 contract: joins the captured DraftGuru snapshot to the
accepted fitzRoy `player_stats` (one pass over all 129 season files, applying the two tracked
Jim-Stewart row-drops and folding all four `profile_url_continuity` pairs into one record reachable
from either path), the `afldb_test` child's registration status, the ledger, curated aliases and
the awards/Brownlow identity censuses; produces the six machine outcomes with reason codes; never
imports `psycopg`, never reads a `*DATABASE_URL*` variable, never opens a socket (asserted directly
by poisoning `socket.socket` in a test and confirming no exception); never modifies the parent,
child or sample. `tests/python/draftguru_offline_review_contract.py` (55 checks) exercises every
outcome, the name-variant table (including Stephen/Steven), the multi-word-surname suffix match
(fixes a real false-`SURNAME_DIFFERENT` bug the first full run surfaced, on "de Goey"/"Ah
Chee"/"van Unen"-shaped names), club-overlap gating for numeric-suffix/continuity identities, the
DEBUT-vs-CAREER-ENDED distinction, the games-consistency rule, the pinned audit digest and its
exclusion of recheck classes 1–10, determinism, and all three refusal paths (hash mismatch, wrong
row count, a deployment child passed as the parent) — all green, plus a regression test for a
second real bug the first full run surfaced (`known_exception_class` computed against the bare
slug constants but never actually matched against the full player URL, so the numbering/spelling/
Schwerdt flags stayed `None` on every row until fixed).

**Phase D (executed over all 997 real rows, twice, `rows_sha256` identical both times —
`940f050a4306cb66e4d644e334033a2e2f0ee73e90ed877b665041f769bca3a6`):**

| Outcome | Rows |
|---|---|
| `offline_strong` | 959 |
| `offline_limited` | 1 |
| `offline_contradict` | 9 |
| `target_unregistered` | 28 |
| `offline_unavailable` | 0 |
| `tooling_or_schema_error` | 0 |
| **Total** | **997** |

`target_unregistered` = 28 (12 census + 16 random) matches the handoff's independent prediction
exactly; the 34 numeric-suffix and 2 continuity-rule identity counts also matched exactly. The two
`offline_contradict` rows carrying `BIRTH_YEAR_CONFLICT` (`tim_walsh/1`, `darren_mead/1`) match the
handoff's own feasibility measurement ("|Δ| ≥ 2 for 2"). Seven further `offline_contradict` rows
(`peter_whyte/1`, `craig_somerville/1`, `bret_hutchinson/1`, `tim_bourke/1`, `david_williams/1`,
`simon_taylor/1`, `glen_bartlett/1`) are a **new finding this pass**, not previously flagged: each
person's retained fitzRoy career ended before their earliest DraftGuru-captured original-recruitment
event — the runbook's own written rule (§5) makes `CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT` a
contradiction code, distinct from the informational `DEBUT_BEFORE_EARLIEST_RECRUITMENT`, and all
seven carry both codes. Read together with the captured evidence (each has exactly one Stage A row,
a `National`-type re-listing years after their real, earlier AFL Tables career had ended — the
shape of a delisted veteran redrafted without further senior games) these look like correct
identity matches surfaced by a genuinely surprising data pattern rather than mis-links, but that
judgement is the operator's per the runbook's design, not this tool's. **Stop condition met:**
the runbook requires stopping and recording evidence, not claiming acceptance, when any
`offline_contradict` occurs — done here; Phase 3 stays PENDING.

Outputs written (LF bytes, atomic, hash-linked to the sample/parent/child and to each other):
`docs/rebuild-manifests/draftguru/bridge-review-verdicts-20260918-v1.json` (sha256
`5830946d0fdcbd0bbd1d992ebd730feb89b6708d0d330fcecd09e3f14401962a`),
`…verdicts-20260918-v1.csv` (`2d0d6b887e20065df919a83862c03eff2d5424f2a7695502dc29abe548fb1330`),
`…recheck-20260918-v1.json` (`e1462729c7c5711d57080cff2e7a3cb993745958ab04ce733a955ecfee9d6f88`),
`…residual-20260918-v1.json` (`8474fe91eb91d1726e7df8a0738c4c18168ff16416a7a4771e7d286e8f862376`).
Recheck queue: 112 distinct rows across the 11 mandatory classes (9 contradict, 1 limited, 28
target_unregistered, 0 unavailable, 0 tooling error, 3 numbering, 10 spelling/name-variant, 1
Schwerdt, 0 ledger overlap, 38 weak/suffix/continuity, 30 deterministic audit — some rows fall in
more than one class). Residual report: `network_acquisition_required: false` for every category —
no row was found to need a live fetch before operator adjudication. The 30-row audit
(`AFLDB-ISSUE-222/audit-v1`, drawn once, never redrawn) is recorded in the recheck artefact's
`classes.11_deterministic_audit`.

**Phase E (validation):** `npx vitest run tests/draftguru-acquisition.test.ts
tests/match-backtest-compare.test.ts` → 187 passed / 1 failed (pre-existing `AFLDB-ISSUE-223`,
confirmed unrelated — the `GRID_DRAFT_TYPES` shape it asserts on is untouched by this pass) / 3
skipped / 191 total; `npx tsc --noEmit -p .` clean; `python -m py_compile` clean on every
touched/new Python file (no Python linter is configured in this repository).

**Boundaries held:** no network request; no database connection; no Playwright; `import_draftguru.py`
run only via its DB-free `--validate-only` mode; `export_person_bridge.py` not run in any mode that
rewrites the parent, child or sample (all three re-verified byte-identical after every pass); no
link import; no DEV/PROD action; no build; no Git command; `AFLDB-ISSUE-221.md` untouched.

**Files this pass:** new — `tools/rebuild/draftguru/review_person_bridge_offline.py`,
`tests/python/draftguru_bridge_resolution_contract.py`,
`tests/python/draftguru_offline_review_contract.py`, the four verdict/recheck/residual/CSV
artefacts above. Modified — `tools/rebuild/draftguru/export_person_bridge.py`,
`tests/draftguru-acquisition.test.ts`, `AFLDB-ISSUE-222.md` (§6.1, §7.2, §11.5, this section),
`issues.md`, `IssuesIndex.md`. Untouched — the parent, child and sample datasets; every other
repository file.

**Next action:** the operator works the 112-row recheck queue and the 30-row audit
(`docs/rebuild-manifests/draftguru/bridge-review-recheck-20260918-v1.json`), giving particular
attention to the 9 `offline_contradict` rows (2 birth-year conflicts, 7 career-ended-before-
recruitment veteran-redraft cases) since the runbook's acceptance gate requires zero genuine
contradictions to remain. Separately, a future DB-enabled session should determine whether the §B
exporter alignment changes the generated `afldb_test` child's contents (it could not be tested
without a database this pass) and, if the operator wants `players.id` values recorded for the 101
`target_not_registered` persons, run the tracked read-only registration extract the correction
handoff names. Phase 3 remains **PENDING** until the operator completes every recheck and all 30
audit rows.

### 11.9 Population-wide offline mislink scan — all 3,564 parent bridge candidates (2026-09-18, Sonnet 5, High)

**PARTIALLY WITHDRAWN — see §11.11 (independent review + correction, 2026-09-18).** This section's
`confirmed_source_mislink` outcome (23 rows) and every count derived from it are **retracted**: an
independent review found the classification invalid (DraftGuru's per-entry games figure is games
following that specific listing, not career games, so a "0" there proves nothing about whether the
person ever played; Stage A's own listed age agrees with the retained target's birth year on every
one of the 23 rows — evidence FOR the same person, not against) and found 21 further rows sharing
the identical shape that this section's scanner had classified `population_clean` only because of an
arbitrary one-year boundary in the career-ended-before-recruitment comparison. All 44 rows are now
the single neutral outcome `relisting_signature_review`, requiring operator adjudication — never a
confirmed mislink, never automatically safe. `confirmed_source_mislink` is removed from the
scanner's vocabulary (v1→v2, `tools/rebuild/draftguru/scan_person_bridge_population.py`). This
section's artefacts (`bridge-population-scan-20260918-v1.{json,csv}` etc.) are **preserved unchanged
as superseded evidence**, per governance rule — they are historical record of the withdrawn
classification, not a current fact. The rest of this section (suspected/discrepancy/insufficient/
human-authority-overlap counts, the two tool-defect fixes, validation) is unaffected and remains
current.

Prompted by §11.8's operator sign-off pack (`bridge-review-signoff-20260918-v1.md`), which found the
7 `offline_contradict` sample rows share one identical signature — a DraftGuru entry recording **0**
career games whose captured href resolves to an unrelated, already-retired same-named AFL/VFL
player whose career ended before that entry's earliest original recruitment (or, for a trade-only
entry, before the earliest trade year). Because that signature is a population-level stop condition
(correction handoff §I / runbook §8), this pass scans **all 3,564** parent bridge candidates for it,
not only the 997-row sample, before any operator sign-off or import. **Phase 3 remains PENDING**;
this pass authorises nothing.

**Tool defect found and fixed first (inert on the sample):** `evaluate_row()`'s ledger-agreement
check compared `target.source` (the constant string `"afltables"`) to the candidate's AFL Tables
path instead of `target.external_id`, so a genuinely agreeing ledger decision could never register
as `linked_agreeing` — every afltables-agreeing ledger row silently fell through to
`linked_disagreeing`. This never affected the 997-row sample (0 ledger overlap there, correction
handoff §5) but would have misclassified all 3 of the population's genuinely agreeing ledger rows
(`matt_rendell/1`, `nathan_fyfe/1`, `ryan_o'keefe/1`) as contradictions. Fixed in
`review_person_bridge_offline.py` (`TOOL_VERSION` 1.0.1 → 1.0.2); the sample's `rows_sha256`
(`412f0b59…`) reproduced byte-identical before and after the fix, proving it inert for the reviewed
997 rows.

**Scanner:** new `tools/rebuild/draftguru/scan_person_bridge_population.py` (v1.0.0). A thin
orchestration + classification layer over the reviewed `review_person_bridge_offline.py`
(`evaluate_row`, `build_fitzroy_index` including the `AGE_ARTIFACT_FLOOR` sentinel-age correction,
name/club normalisation) — single source of truth for corroboration rules, reused unmodified except
for the ledger fix above. Adds: iteration over all 3,564 parent bridges instead of the 997-row
sample; a population outcome layer (`population_clean`, `confirmed_source_mislink`,
`suspected_source_mislink`, `source_discrepancy_same_person`, `insufficient_evidence`,
`human_authority_overlap`, `tooling_or_schema_error`); and a bounded, evidence-gated
alternate-registered-identity probe for `target_unregistered` rows (numeric-suffix 0–19 and a
visible-name spelling substitution, promoted only under the same bar `evaluate_row` requires for
`offline_strong` — name consistency, birth-year tolerance ≤1, ≥1 games/debut/span signal, club
overlap for a suffixed candidate; never on name alone, D-9). `confirmed_source_mislink` requires
ALL of: `CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT`, DraftGuru's own reported games for that entry
== 0, and the retained target has actually played (`career_games` > 0). Regression tests:
`tests/python/draftguru_population_scan_contract.py` (15 sections: the confirmed signature across
National/Trade/Pre-Season/Mid-Season events including a trade-only fallback; a genuine later
re-draft/veteran and a genuine trade/re-listing that must not be flagged; the shared
`AGE_ARTIFACT_FLOOR`; birth-year tolerance and missing-DOB refusal; same-exact-name-incompatible-
career; the Schwerdt-style spelling probe; suffix candidates requiring club overlap and refusing an
ambiguous two-candidate tie; a legitimate zero-game/unregistered draftee and a snapshot-cutoff
draftee both landing `insufficient_evidence`, never a forced mislink; agreeing/disagreeing ledger
overlap; the pure candidate builders; deterministic hashing; no-network/no-database; and 5 CLI
refusal checks). All pass.

**Execution (twice, identical `rows_sha256` `ddd5faba8a292d91b52d5beef86f9aae91dfef0ab2a14dec9ba5894f2968c8c0`):**
all 3,564 parent candidates reconciled, 0 remaining —

| Outcome | Count |
|---|---|
| `population_clean` | 3,422 |
| `confirmed_source_mislink` | **23** |
| `suspected_source_mislink` | 2 |
| `source_discrepancy_same_person` | 7 |
| `insufficient_evidence` | 107 (94 `target_not_registered` with no alternate evidence + 13 `offline_limited`) |
| `human_authority_overlap` | 3 (`matt_rendell/1`, `nathan_fyfe/1`, `ryan_o'keefe/1` — the ledger fix above) |
| `tooling_or_schema_error` | 0 |

**The mechanism extends beyond the 7 sampled rows.** All 7 sample `offline_contradict` rows
reproduce exactly among the 23 confirmed (`peter_whyte/1`, `craig_somerville/1`,
`bret_hutchinson/1`, `tim_bourke/1`, `david_williams/1`, `simon_taylor/1`, `glen_bartlett/1`); **16
further confirmed mislinks exist outside the sample** (`andrew_krakouer/1`, `bradley_sparks/1`,
`chris_o'dwyer/1`, `darren_williams/1`, `david_sullivan/1`, `gary_keane/1`, `ian_rickman/1`,
`john_ahern/1`, `john_peter-budge/1`, `mark_mcleod/1`, `mark_pitura/1`, `nathan_irvin/1`,
`paul_mifka/1`, `peter_freeman/1`, `rodney_gladman/1`, `tony_furey/1`). None of the 23 or the 2
suspected overlap the national top-10 census stratum or the human ledger. The `source_discrepancy_
same_person` probe independently rediscovered exactly the 6 known numbering cases plus Schwerdt (7
total: `aaron_black/1`, `alwyn_davey/1`, `joel_smith/1`, `josh_smith/1`, `sam_butler/1`,
`stephen_schwerdt/1`, `tom_murphy/1`) with zero false positives — it correctly declined the
Laidley/Capuano name-change cases (no href-derivable clue permits a safe, D-9-compliant candidate
for a genuine name change). The 2 `suspected_source_mislink` rows (`adrian_deluca/1`,
`setanta_ó hailpín/1`) are flagged only by `SURNAME_DIFFERENT` with every other signal (birth year,
debut timing, games, club overlap) agreeing — almost certainly the same real, well-known players
(Adrian De Luca; Setanta Ó hAilpín) misflagged by a surname-tokenisation gap on compound/diacritic
surnames in the reused corroboration logic, not genuine mislinks; recommended for manual
confirmation, not exclusion. Full per-row facts, reason codes and a blank `operator_verdict` for
every non-clean row: `docs/rebuild-manifests/draftguru/bridge-population-scan-20260918-v1.{json,csv}`;
compact sign-off pack: `…-signoff-20260918-v1.md`; hash-linked manifest: `…-manifest-20260918-v1.json`.

**Impact if the 23 confirmed mislinks are excluded (projection only; no dataset regenerated this
pass):** all 23 are currently `bridges[]` entries on the `afldb_test` child and none overlap the 3
ledger-agreeing rows, so the projected net-new bridge count falls from **3,460 to 3,437** and
projected unresolved persons rises from **1,592 to 1,615**; projected bridge-covered picks fall from
5,101 to 5,078 and unresolved picks rise from 1,704 to 1,727 (each of the 23 carries exactly one
Stage A draft-event row). The National Draft top-10 reconciliation (389/420 picks, 387/418 people,
92.62%/92.58%) is **unchanged** — none of the 23 confirmed or 2 suspected rows are top-10 people.
The existing v1/v2 parent, child and 997-row sample **remain valid historical evidence** unmodified
(re-verified byte-identical throughout this pass); a corrected v2 parent/child excluding the 23
confirmed rows, and whether the review sample needs an independent-salt v2 redraw per runbook §7
item 9, is an **operator decision this pass does not make**.

**Phase F (validation):** `python tests/python/draftguru_population_scan_contract.py`,
`tests/python/draftguru_offline_review_contract.py` and
`tests/python/draftguru_bridge_resolution_contract.py` all pass; `python -m py_compile` clean on
every touched/new Python file; `npx vitest run tests/draftguru-acquisition.test.ts
tests/match-backtest-compare.test.ts` → 187 passed / 1 failed (pre-existing `AFLDB-ISSUE-223`,
confirmed unrelated, identical to the §11.8 baseline) / 3 skipped / 191 total; `npx tsc --noEmit -p .`
clean.

**Boundaries held:** no network request; no database connection; no Playwright; `import_draftguru.py`
not run at all this pass; `export_person_bridge.py` not run; parent, child and sample re-verified
byte-identical (never modified); no link import; no DEV/PROD action; no deployment; no Git command;
`AFLDB-ISSUE-221.md` untouched; no `operator_verdict` set anywhere; Phase 3 acceptance not claimed;
Phase 4 not begun.

**Files this pass:** new — `tools/rebuild/draftguru/scan_person_bridge_population.py`,
`tests/python/draftguru_population_scan_contract.py`, the population-scan JSON/CSV/manifest/sign-off
artefacts above. Modified — `tools/rebuild/draftguru/review_person_bridge_offline.py` (ledger-
agreement fix, `TOOL_VERSION` → 1.0.2), `AFLDB-ISSUE-222.md` (this section), `issues.md`,
`IssuesIndex.md`. Untouched — the parent, child and 997-row sample datasets; every recheck/residual/
verdict artefact from §11.8; `AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` and
`AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md` (content unchanged; both already record Phase 3 PENDING
and are not re-edited to describe this pass's outcomes, consistent with their own stated convention
of not being re-edited after execution); `AFLDB-ISSUE-221.md`.

**Next action:** the operator reviews the population-scan sign-off pack alongside the existing
997-row recheck queue, decides the disposition of the 23 confirmed and 2 suspected rows (and the 7
`source_discrepancy_same_person` numbering/spelling cases, unchanged in recommendation from §11.8),
and decides whether/how to regenerate a corrected v2 parent/child and whether the sample requires an
independent-salt v2 redraw (runbook §7 item 9) before Phase 3 can be accepted. Phase 3 remains
**PENDING**; no import is authorised.

### 11.10 Population-scan decision pack repair and completion (2026-09-18, Sonnet 5, High)

**WITHDRAWN — see §11.11.** This section's every statement calling the 23 rows "confirmed
mislinks", the 588 clean-survivor denominator, and the recalculated "~0.51%"/"0.508%" residual
bound (stated below as valid "only as a residual bound on further-undiscovered failure modes") are
**all withdrawn**. §11.11 explains why: the 588 figure itself was arithmetically wrong even under
this section's own v1 labels — it silently counted 13 `insufficient_evidence`/`target_not_registered`
random-stratum rows as if they were confirmed-clean survivors (598 − 7 − 3 = 588, never subtracting
those 13; the true `population_clean` random-stratum count was 575, so 598 − 7 − 3 − 13 = 575, not
588) — and independently, no zero-failure bound can ever be built on `population_clean` because that
category is defined by the same machine rule being assessed (circular). Both defects apply
regardless of the classification correction in §11.11. The decision-pack artefacts this section
produced (`bridge-population-scan-decision-pack-20260918-v1.{md,csv,json}`) are **preserved
unchanged as superseded evidence**; the corrected replacement is
`bridge-population-scan-decision-pack-20260918-v2.{md,csv,json}` (§11.11). The 101 = 94 + 7
decomposition, the mutual-exclusivity proof, and the Scenario A/B/C exclusion projections below are
also superseded — Scenario A/B assumed the withdrawn 23-row exclusion; no exclusion is decided by
this pass, so the "current" figures below (3,460 net-new etc.) remain the operative baseline, just
without any of the invalid statistical narrative.

**Verification first.** The four population-scan artefacts named in §11.9
(`bridge-population-scan-20260918-v1.json/.csv`, `bridge-population-scan-manifest-20260918-v1.json`)
and the prior `bridge-review-signoff-20260918-v1.{md,csv,json}` pack were located at exactly the
paths §11.9 already records; the JSON's 3,564 rows, `rows_sha256`
(`ddd5faba8a292d91b52d5beef86f9aae91dfef0ab2a14dec9ba5894f2968c8c0`) and outcome totals were
re-verified against the manifest, and every immutable parent/child/sample hash the manifest carries
was re-checked — all matched exactly. A repository-wide search for
`docs/rebuild-manifests/draftguruff-20260918-v1.md` (and the bare string `draftguruff`) found no
match anywhere: that path never existed under any name or spelling in this repository. It was a
malformed reference in how this pass was requested, not an actual mis-named artefact; no file was
renamed, created, or deleted to "correct" it.

**What was incomplete.** `bridge-population-scan-signoff-20260918-v1.md` is a correct but bounded
summary — outcome totals and four per-category tables, no cross-tabulations, no scenario
projections, no sample/statistical impact. This pass computed the missing analysis exclusively from
the retained population-scan JSON and the immutable 997-row sample (no network, no database, no
regenerated dataset, no rewrite of any existing artefact) and wrote a new, separate artefact set:
`docs/rebuild-manifests/draftguru/bridge-population-scan-decision-pack-20260918-v1.{md,csv,json}`.
It proves, with exact programmatically-verified figures:

- the 101 `target_not_registered` rows decompose exactly as 94 `insufficient_evidence`
  (`TARGET_NOT_REGISTERED_NO_EVIDENCE`) + 7 `source_discrepancy_same_person`
  (`ALTERNATE_REGISTERED_IDENTITY_CORROBORATED`) = 101, with 0 confirmed/suspected mislinks among
  them;
- all 3,564 rows are mutually exclusive across the 7 outcomes (verified by summation and by
  identity-set disjointness);
- the full 23-row confirmed table (7 originally sampled, all random stratum + 16 non-sample), the
  2 suspected rows, and the 7 same-person discrepancy rows, each with sample bucket, child
  membership and affected-pick-count detail;
- the 107-row `insufficient_evidence` grouping (94 `TARGET_NOT_REGISTERED_NO_EVIDENCE`, all
  target-unregistered; 13 `OFFLINE_LIMITED`, all currently bridged), both defaulting to withhold;
- **Scenario A** (exclude the 23 confirmed only) reproduces this section's already-published
  3,460→3,437 net-new / 1,592→1,615 unresolved persons / 5,101→5,078 covered picks /
  1,704→1,727 unresolved picks exactly, with national top-10 unchanged;
- **Scenario B** (conservative: admit only the 3,422 `population_clean` rows) projects 3,422
  net-new, 1,630 unresolved persons, 5,055 covered picks, 1,750 unresolved picks, and a national
  top-10 drop of exactly 2 currently-bridged census persons (`keith_thomas/2`, `tim_walsh/1`, 1
  affected pick each) to 387/420 picks and 385/418 persons;
- **Scenario C** (hypothetical: Scenario B plus successful curation of all 7 discrepancy rows) —
  explicitly labelled not approved;
- the sample/statistical impact finding that the pre-existing "0.50% zero-failure bound on n=598"
  claim (§3.5) does **not** hold as stated: the random stratum was not actually a zero-failure draw
  for the mislink mechanism (7 confirmed + 3 discrepancy rows were within it, a 1.17% observed
  rate). A recalculated ~0.51% bound on the 588 clean survivors is presented as a residual bound on
  further undiscovered failure modes only — not a restatement of the original claim, and not a
  basis to redraw or top up the sample, which this pass explicitly does not decide (governance
  rule; presented for independent review only).

**Validation:** `python tools/rebuild/draftguru/scan_person_bridge_population.py` run twice against
the same immutable inputs reproduced identical `rows_sha256` and totals;
`python tests/python/draftguru_population_scan_contract.py` and
`draftguru_offline_review_contract.py` both green; `python -m py_compile` clean on every touched/new
Python file. No TypeScript or application code was touched this pass, so no Vitest/`tsc` re-run was
required.

**Boundaries held:** no network request; no database connection; no SSH tunnel; no Playwright; no
importer run; no exporter run; no rewrite of any existing/immutable artefact; no bridge v2 dataset
generated; no parent/child/sample overwrite; no `operator_verdict` set anywhere; no import; no
DEV/PROD action; no deployment; no Git command; `AFLDB-ISSUE-221.md` untouched. Phase 3 remains
PENDING; Phase 4 remains unauthorised.

**Files this pass:** new —
`docs/rebuild-manifests/draftguru/bridge-population-scan-decision-pack-20260918-v1.{md,csv,json}`,
this section, `issues.md`, `IssuesIndex.md`. No other repository file changed; every existing
population-scan, sample, parent and child artefact is untouched and re-verified byte-identical.

**Next action (superseded by §11.11):** see §11.11 for the corrected next action.

### 11.11 Independent statistical review, scanner correction, and operator adjudication pack (2026-09-18, Fable 5.1 review; Sonnet 5, High, correction and execution)

**Phase 3 remains PENDING.** An independent (Fable 5.1) statistical review of §11.9/§11.10 found
the `confirmed_source_mislink` classification and every statistical claim built on it invalid. This
pass verified the review's findings against the retained evidence, corrected the population scanner,
regenerated the population scan as a new version, corrected the affected documentation, and produced
an operator adjudication pack. **No operator verdict was set. No bridge v2 dataset or v2 validation
sample was generated. No network, database, SSH tunnel, Playwright, import, exporter run, or Git
command occurred.**

**Phase A (verification, before any change).** Re-verified and confirmed unchanged: parent (3,564
rows, sha256 `92ff142e…`), child (3,463 bridged / 1,594 withheld, sha256 `596bbb68…`), the 997-row
sample (399 census + 598 random, sha256 `036cc082…`), the accepted fitzRoy snapshot (131/131,
`artefact_set_sha256` `15ba5dc6…`), Stage A ages and draft events, the v1 population-scan
`rows_sha256` (`ddd5faba…`, reproduced exactly before any code change), and the current
`bridge-review-verdicts-20260918-v2.json` (`rows_sha256` `412f0b59…`, tool version 1.0.1 — confirmed
current and inert against the ledger-agreement fix that later bumped the review tool to 1.0.2,
per §11.9). No unexpected immutable change was found; nothing was stopped.

**Independently reproduced, before any code change (read-only analysis of the retained v1 population
scan):** applying the substantive signature described below — a DraftGuru entry recording zero games
following its listing event, whose captured href resolves to a retained target with a real played
career (`career_games > 0`) whose `last_season` is **at or before** the listing year, with the
DraftGuru title birth year and the retained birth year agreeing within tolerance — to the v1
population-scan JSON reproduces **exactly** the union of the 23 `confirmed_source_mislink` rows and
21 `population_clean` rows (44 total, verified as an exact set match, not an approximation); the sole
axis separating the two groups in v1 was whether `last_season < recruitment_year` (23 rows) or
`last_season == recruitment_year` (21 rows) — the arbitrary one-year boundary. All 44 rows carry
`BIRTH_YEAR_CONSISTENT` or `BIRTH_YEAR_CONSISTENT_TOLERANCE` (max |Δ| = 1 across all 44); 0 carry a
birth-year conflict.

**Phase B (scanner correction).** `tools/rebuild/draftguru/scan_person_bridge_population.py`:
removed `confirmed_source_mislink` from `POPULATION_OUTCOMES`/`SIGNOFF_OUTCOMES`; added
`relisting_signature_match()` (a single predicate: retained target has a real career, the
DraftGuru per-entry games figure for the listing is 0, the retained career's `last_season` is at or
before the recruitment/trade year, and no independent identity contradiction — birth-year conflict,
surname difference, multiple fitzRoy ids, or ledger disagreement — is present); wired it into
`classify_population_row()` ahead of both the `offline_contradict` and `offline_strong` branches, so
the same neutral `relisting_signature_review` outcome is reached regardless of which side of the old
boundary a row fell on. A genuine contradiction (e.g. a real birth-year conflict on the same
zero-games/career-ended shape) is still represented as `suspected_source_mislink`, never absorbed.
`recommended_disposition()` now returns `operator_adjudication_required` for the new outcome.
`SCANNER_VERSION` 1.0.0 → 2.0.0; `SCHEMA_VERSION` 1 → 2 (breaking: the outcome vocabulary changed).
`tests/python/draftguru_population_scan_contract.py` extended (now 47 checks, all green): the full
event-type mix (National/Pre-Season/Mid-Season/trade-only) reaches `relisting_signature_review`;
Stage A `BIRTH_YEAR_CONSISTENT` is retained on every such row (never guessed away); a row with
`last_season` exactly at the recruitment year and one exactly one year earlier reach the *identical*
outcome and reason (proves the boundary no longer matters); a person with a later DraftGuru entry
recording real games (so the per-entry-zero on an earlier entry is not read as zero career games)
stays `population_clean`; a genuine birth-year conflict on the same shape stays
`suspected_source_mislink` with `BIRTH_YEAR_CONFLICT` named explicitly; the two untouched
genuine-veteran/trade-of-an-established-player fixtures remain `population_clean`; determinism, no
network/database use, and all five CLI refusal checks remain green.

**Phase C (new v2 population outputs, v1 preserved unchanged).** Ran twice against the unmodified
v1 parent/child (immutable inputs, no re-acquisition):

| Outcome | v1 (superseded) | v2 (corrected) |
|---|---:|---:|
| `population_clean` | 3,422 | 3,401 |
| `confirmed_source_mislink` (removed) | 23 | — |
| `relisting_signature_review` (new) | — | 44 |
| `suspected_source_mislink` | 2 | 2 |
| `source_discrepancy_same_person` | 7 | 7 |
| `insufficient_evidence` | 107 | 107 |
| `human_authority_overlap` | 3 | 3 |
| `tooling_or_schema_error` | 0 | 0 |
| **Total** | **3,564** | **3,564** |

Both runs produced identical `rows_sha256` = `ad134d1447b10b6a9880e14507be6d88da8001659b69ab996d91580cbb64908f`
(v1's `rows_sha256`, `ddd5faba…`, re-verified unchanged — the v1 files were never touched). All
outcomes remain mutually exclusive (verified by summation and identity-set disjointness); exactly 44
`relisting_signature_review` rows; 0 unsupported "confirmed mislink" rows anywhere. The 44 decompose
as 23 rows the withdrawn v1 scanner called `confirmed_source_mislink` (7 originally-sampled random,
16 non-sample; all 23 already carried `BIRTH_YEAR_CONSISTENT`) plus 21 rows v1 called
`population_clean` (4 random, 17 non-sample); 0 are census/national-top-10 rows, so the 389/420 pick
and 387/418 person top-10 reconciliation is **unaffected**. Corrected random-stratum cross-tab
(598 rows, current/authoritative): `population_clean` 571, `relisting_signature_review` 11,
`source_discrepancy_same_person` 3, `insufficient_evidence` 13 (571+11+3+13 = 598). Outputs (new,
v1 untouched): `bridge-population-scan-20260918-v2.{json,csv}`,
`bridge-population-scan-manifest-20260918-v2.json`, `bridge-population-scan-signoff-20260918-v2.md`,
`bridge-population-scan-decision-pack-20260918-v2.{md,csv,json}` (Phase C/D deliverable, corrected
replacement for the v1 decision pack — see below).

**Phase D (statistical and governance correction).**

1. **The 0.51%/0.508% claim is invalid and withdrawn**, for two independent reasons, both recorded
   here and in the v2 decision pack: (a) it is circular — `population_clean` is defined by exactly
   the machine rule whose error rate the bound purports to measure, so 0 failures in that population
   proves nothing about rows the rule itself might misclassify; (b) its **588 denominator was
   itself computed wrongly**, even under the withdrawn v1 labels — the original arithmetic was
   `598 − 7 (confirmed) − 3 (discrepancy) = 588`, which never subtracted the 13 random-stratum
   `insufficient_evidence`/`target_not_registered` rows, silently counting them as confirmed-clean
   survivors. The v1 labels' true random-stratum breakdown is **575 `population_clean` + 7
   machine-flagged (the withdrawn `confirmed_source_mislink`) + 3 `source_discrepancy_same_person` +
   13 `insufficient_evidence` = 598** — `575`, not `588`, is the actual clean-survivor count under
   those labels. No formal residual-error bound exists.
2. **The 986 full-sample "clean survivor" claim** (decision-pack v1 §9) is withdrawn on the same
   basis (it summed the same invalid categories across both strata).
3. **Every statement calling the 23 rows "confirmed mislinks"** is corrected to: 23 of the 44
   `relisting_signature_review` rows were originally sampled (all random stratum); none is a
   confirmed mislink; all 44 require operator adjudication.
4. **Redraw-rule conflict corrected**: `AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §7 gate 9's
   "using the same salt" clause conflicted with this document's own §3.5 item 4 (which requires a
   *new* salt, `"AFLDB-ISSUE-222/v<N+1>"`, for a post-failure revalidation redraw, disjoint from the
   previous draw). §3.5 item 4 governs; the handoff gate is corrected to defer to it, and the v1
   decision pack's "(runbook Sec.7 item 9)" citation — wrong on both the document (it is handoff §7,
   not the runbook) and the salt policy — is not carried into the v2 decision pack.
5. **Substance retained going forward:** the original 598-row random sample remains preserved,
   immutable evidence (never redrawn or topped up by this pass); the fact that 0 of the reviewed
   `population_clean` rows show a genuine identity contradiction is descriptive, not a confidence
   bound; the 44-row `relisting_signature_review` class requires operator adjudication as one class;
   the 30-row audit remains operator-unconfirmed; no formal residual-error bound exists until a
   future, disjoint, new-salt validation sample is completed under frozen bridge-v2 eligibility
   (§11's Phase F record below) — not decided or generated by this pass.

Documentation updated: this section; §11.9/§11.10 above (retraction notices added, content
otherwise preserved as superseded historical record per governance rule — never silently rewritten);
`AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §7 gate 9 (redraw-salt correction);
`AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md` (reviewed; no factual claim there depended on the
withdrawn classification, so no edit was required beyond this record); `issues.md`; `IssuesIndex.md`.

**Phase E (operator adjudication pack, new).**
`docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.{md,csv,json}`
(83 rows across four sections, every `operator_verdict` field blank):

1. **44 `relisting_signature_review` rows** — full identity, event, DraftGuru and retained-target
   evidence per row; allowed verdicts `same_person_valid_relisting` / `different_person_wrong_href` /
   `undetermined_withhold`.
2. **2 suspected tokenisation rows** (`adrian_deluca/1`, `setanta_ó hailpín/1`) — allowed verdicts
   `same_person_valid_href` / `different_person_wrong_href` / `undetermined_withhold`.
3. **7 source discrepancies** (numbering/spelling, including Schwerdt) with the corrected identity's
   name/games/clubs looked up directly from the retained fitzRoy index — allowed verdicts
   `approve_manual_curation` / `reject_candidate` / `undetermined_withhold`.
4. **30-row deterministic audit** (salt `AFLDB-ISSUE-222/audit-v1`, unchanged, drawn once from
   `bridge-review-recheck-20260918-v2.json`'s class 11) — allowed verdicts `agree` / `contradict` /
   `undetermined`.

Every section is hash-linked to the parent, child, immutable sample, corrected v2 population scan,
retained fitzRoy snapshot, DraftGuru snapshot manifest and the existing v2 review-verdict artefact.
A compact Markdown summary table accompanies every section so the operator does not need to read
raw JSON.

**Phase F (future v2 validation — recorded, not generated).** Unchanged from §3.5/§11.10: bridge v2
must first be frozen after operator adjudication of this pack; the target population for a future
validation sample is non-census bridge-v2 rows, excluding prior discovery/random rows; new salt
`AFLDB-ISSUE-222/v2`; ordering `sha256(salt + "|" + player_url)` ascending, ties by URL; intended
`n = 598`; sample membership and tool hashes frozen before review; operator same-person verdict
required per row; any failure stops acceptance; no post-hoc exclusion or survivor-only confidence
claim; any tool/rule change voids the sample and requires a new version/salt. **Not generated by
this pass.**

**Phase G (validation).** `python tools/rebuild/draftguru/scan_person_bridge_population.py` run
twice against the unmodified v1 parent/child → identical `rows_sha256` `ad134d14…`;
`python tests/python/draftguru_population_scan_contract.py` (47 checks) green;
`python tests/python/draftguru_offline_review_contract.py` and
`draftguru_bridge_resolution_contract.py` green (untouched by this pass); `python -m py_compile`
clean on every touched/new Python file; `npx vitest run tests/draftguru-acquisition.test.ts
tests/match-backtest-compare.test.ts` and `npx tsc --noEmit -p .` — results recorded in `issues.md`
(no TypeScript file was touched this pass, so this reruns the existing §11.9 baseline unchanged).

**Boundaries held:** no network request; no database connection; no SSH tunnel; no Playwright; no
importer run; no exporter run; no rewrite of any v1 (or earlier) artefact — every one re-verified
byte-identical; no bridge v2 dataset generated; no v2 validation sample generated; no
`operator_verdict` set anywhere; no import; no DEV/PROD action; no deployment; no Git command;
`AFLDB-ISSUE-221.md` untouched. Phase 3 remains **PENDING**; Phase 4 remains unauthorised.

**Files this pass:** new — `docs/rebuild-manifests/draftguru/bridge-population-scan-20260918-v2.{json,csv}`,
`…manifest-20260918-v2.json`, `…signoff-20260918-v2.md`,
`…decision-pack-20260918-v2.{md,csv,json}`, `…operator-adjudication-pack-20260918-v1.{md,csv,json}`,
this section. Modified — `tools/rebuild/draftguru/scan_person_bridge_population.py`,
`tests/python/draftguru_population_scan_contract.py`,
`AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` (§7 gate 9), `AFLDB-ISSUE-222.md` (§11.9/§11.10
retraction notices, this section), `issues.md`, `IssuesIndex.md`. Untouched —
`AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md`; every v1 (and earlier) population-scan, decision-pack,
review-verdict, recheck and residual artefact; the parent, child and 997-row sample datasets;
`AFLDB-ISSUE-221.md`.

**Next action:** the operator works the operator adjudication pack (44 + 2 + 7 + 30 = 83 rows)
alongside the existing 997-row recheck queue, deciding: the disposition of each relisting-signature
row (same-person-valid-relisting / different-person-wrong-href / undetermined-withhold); the 2
tokenisation rows; the 7 source discrepancies; and confirming or contradicting the 30-row audit.
Separately, the operator decides whether/how to generate a corrected bridge v2 dataset once
adjudication is complete, and whether/when to generate the future disjoint-salt v2 validation sample
(Phase F). Phase 3 remains **PENDING**; no import is authorised.

### 11.12 Local operator-adjudication GUI helper (build task, 2026-09-18, Sonnet 5, High)

Built, not run: `tools/rebuild/draftguru/review_bridge_operator.py`, a dependency-free Tkinter
tool that loads `bridge-operator-adjudication-pack-20260918-v1.json` read-only and lets the
operator record a verdict for each of its 83 rows without editing JSON by hand. It sets **no**
operator verdict itself, never preselects or defaults a verdict, and never marks Phase 3 accepted,
generates bridge v2, generates a v2 validation sample, or imports anything.

Before opening the GUI it independently re-verifies: the pack's own sha256, every hash-linked input
the pack names (parent, child, immutable sample, corrected v2 population scan, retained fitzRoy
manifest), exactly 83 rows split 44/2/7/30, every source `operator_verdict` blank, and no duplicate
row identity — refusing to start on any mismatch and never opening the pack file for writing.
Verdicts checkpoint atomically (after every change) to the gitignored
`data/review/draftguru-bridge-operator-20260918-v1/progress.json`, guarded by a `review.lock` that
refuses a second concurrent session unless `--force-unlock` is given. Finalising (only once all 83
rows carry a valid, correctly-noted verdict) re-validates everything again and writes the canonical
`docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.json` plus deterministically
derived `.csv`/`.md` views.

Launch (PowerShell, the discovered repository interpreter):

```powershell
C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe tools\rebuild\draftguru\review_bridge_operator.py
```

Headless validation only (no GUI, no lock, no checkpoint):

```powershell
C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe tools\rebuild\draftguru\review_bridge_operator.py --validate-only
```

New DB-free contract test: `tests/python/draftguru_bridge_operator_review_contract.py` (GUI-free
fixtures only — never the real 83-row pack). **No operator verdict has been entered by this pass;
the GUI has not been launched or operated by Sonnet. Phase 3 remains PENDING.**

### 11.13 Operator adjudication — COMPLETE and independently validated (2026-09-18, operator)

**Status: Phase 3 operator adjudication COMPLETE and independently validated.** The operator
worked the 83-row `docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.{json,csv,md}`
(§11.11) to a verdict on every row and reported an independent verification pass over the
completed artefacts. **This record reflects the operator's own report; Claude did not execute or
independently re-run any of the commands below this pass.**

**Reported verification:**

| Check | Result |
|---|---|
| `py_compile` | PASS |
| complete DraftGuru operator-review contract suite | PASS |
| `--validate-final-output` | PASS |
| Final line | "All DraftGuru operator-adjudication-review checks hold." |
| Source or verdict artefact modified | No |

Reported review window: 2026-09-18T05:19:18Z – 2026-09-18T08:43:12Z.

**Reported hashes** (stated unchanged from the §11.11/§11.12 build pass):

| Artefact | sha256 (as reported) |
|---|---|
| source adjudication pack | `02d0cbe995b4482cf249fe216a10da18b325de6dfcb0504df2d3dbcba31ae292` |
| canonical JSON | `b2ae2f4022cd3c22e91bfe6e399538949c02fe8cada95b5c355e6516c82a8822` |
| derived CSV | `a74c6f185030cba3d58bd54b755eae14db3a006ad45ade19ec0f5bd8eaf17267` |
| derived Markdown | `60c529df55313099f85b52af977512fa4fed8f5076fb7ce7263d04e2c05732c0` |

**Decision totals (83/83):**

| Section | Rows | Verdicts |
|---|---|---|
| relisting-signature | 44 | `same_person_valid_relisting` 42, `different_person_wrong_href` 2 |
| tokenisation | 2 | `same_person_valid_href` 2 |
| source discrepancy | 7 | `approve_manual_curation` 7 |
| 30-row audit | 30 | `agree` 30 |

Bridge-v2 eligible: **81**. Withheld: **2** (`different_person_wrong_href`):

- Craig Somerville — `https://www.draftguru.com.au/players/craig_somerville/1`
- David Sullivan — `https://www.draftguru.com.au/players/david_sullivan/1`

`uncertain`: 0.

**Event-club derived totals:** `no_senior_appearance_ever` 40, `pre_event_only` 4,
`not_applicable` 39 (sums to 83). Operator acknowledgements: `no_senior_appearance_ever` 40,
`pre_event_only` 4, 0 overridden observations.

**Deterministic validation reported:** CSV byte-identical re-render PASS; Markdown byte-identical
re-render PASS; source pack byte-identity PASS; validation performed no writes.

**What this does and does not close out.**

- The two wrong-href rows (Craig Somerville, David Sullivan) **remain withheld** — adjudication
  records them as wrong-href; it does not delete or reclassify them.
- **Bridge v2 has not been generated.** The 81 eligible verdicts are a decision record, not yet
  applied to a new parent/child dataset.
- **Target resolution (`--resolve-against afldb_test`) has not been rerun.**
- **The disjoint, new-salt (`AFLDB-ISSUE-222/v2`) validation sample (Phase F, §11.11) has not been
  generated.**
- **No database import has occurred.** `afldb_test`, DEV and PROD remain unchanged — `draft_persons`
  still carries 5 human links and 0 bridge links everywhere.
- **AFLDB-ISSUE-222 remains in progress.** This closes the operator-adjudication step of Phase 3;
  it does not close Phase 3 itself and does not authorise Phase 4.

### 11.14 Bridge v2 SOURCE-EVIDENCE parent generated — DB-free, operator-executed (2026-09-18)

**Status: the v2 source-evidence parent and its manifests exist. The afldb_test deployment child
does NOT exist and has not been resolved.** `tools/rebuild/draftguru/build_person_bridge_v2.py`
applied the 83 completed §11.13 verdicts — and nothing else — to the frozen v1 parent. No database
connection, network request, importer run, DEV/PROD action or Git command occurred at any point.
**This record reflects the operator's own execution report; Claude executed none of the commands.**

**Reported execution sequence:**

| Step | Result |
|---|---|
| `py_compile` | PASS |
| bridge-v2 contract (`tests/python/draftguru_bridge_v2_contract.py`) | PASS, all sections including 5.9–5.11, 6 and 7 |
| existing operator-review / offline-review / population-scan / bridge-resolution contracts | PASS |
| `--validate-only` (pre-write) | PASS, nothing written |
| first `--write` | all six artefacts created |
| `--validate-only` (post-write) | PASS, counts and hashes reproduced |
| second `--write` | all six reported `identical` |
| independent `Get-FileHash` | matched the generator's hashes |

**Reported reconciliation (v1 → v2 source-evidence parent):**

| Quantity | Value |
|---|---|
| population | 5,057 |
| accepted v1 → v2 | 3,564 → 3,562 (−2) |
| withheld v1 → v2 | 1,493 → 1,495 (+2) |
| unchanged (no verdict touched the row) | 3,481 |
| confirmed (verdict confirmed an existing mapping, content identical) | 74 |
| corrected (structured corrected target applied) | 7 |
| removed / withheld | 2 |
| added | 0 |
| unaccounted | 0 |
| `child_status` | `requires --resolve-against afldb_test` |

The net accepted change is **−2, not +81**: 74 eligible verdicts confirmed a mapping without
changing it, 7 corrected a target in place, 0 promoted a withheld row, and 2 rejected a mapping.

**Reported artefact hashes:**

| Artefact | sha256 (as reported) |
|---|---|
| `data/reference/draftguru-person-bridge-20260918-v2.json` | `ad25d965cba72b97be895451dc488bf03a1899421e902394baa52a620abe8e57` |
| `docs/rebuild-manifests/draftguru/bridge-v2-parent-20260918-v1.csv` | `8405de83ccf03d0771ad01c3523a82e19e3419222bf0d590c09ea09a11faeee9` |
| `docs/rebuild-manifests/draftguru/bridge-v2-reconciliation-20260918-v1.json` | `01b7c65f63152a3458af7a10c3572478cd7cda570fbe9aad0a299a06ed8f100c` |
| `docs/rebuild-manifests/draftguru/bridge-v2-withheld-20260918-v1.json` | `3fb2903d18180d687fa54fe75c6fc0ec4e49b6932d1fa8e3b426414a9ab3c9bc` |
| `docs/rebuild-manifests/draftguru/bridge-v2-withheld-20260918-v1.csv` | `d57cbda472e1477710f0634df258822170ca48e7290d6ee35472e0667820774f` |
| `docs/rebuild-manifests/draftguru/bridge-v2-summary-20260918-v1.md` | `5091395fb09807129350bd595f7683ff543195db556b5d4cb284ee29468f45f5` |
| v2 parent `rows_sha256` (content-addressed) | `ce7816f7905f8a758761676ce50f2673055cc0be9c5174d004fdee7931327e7f` |

Every artefact is byte-reproducible: `generated_utc` is frozen to the verdict artefact's
`review_completed_utc` (2026-09-18T08:43:12Z), never a wall clock. The eight pinned immutable
inputs were re-hashed before and after the run and were unchanged.

**Two contract corrections were made during this pass** (both in the generator's own DB-free
surface; neither changed a single output byte, proven by the post-correction `--validate-only`
reproducing all seven hashes exactly):

1. the output screen's Windows-path pattern accepted only one path separator, so a path
   backslash-doubled by `json.dumps` — the form every JSON artefact carries — was not screened at
   all. The pattern now catches drive and UNC paths in both the raw and escaped views while still
   allowing evidence URLs and the Stage A ` ` award strings;
2. the "reads no environment variable" check was a text search that matched the word
   *environment* inside the screen's own refusal label. It is now an AST check that reports the
   offending node and position and ignores filesystem `os` calls.

**What this does and does not close out.**

- **The afldb_test deployment child does not exist.** `child_status` is
  `requires --resolve-against afldb_test`; no child artefact was generated and no final child
  accepted/withheld count is published anywhere.
- **The seven corrected targets have never been resolved against a database.** All seven were
  `target_not_registered` in the v1 child, so their corrected targets are unmeasured.
- **The two rejected mappings cannot re-enter.** `players/C/Craig_Somerville.html` and
  `players/D/David_Sullivan.html` appear in the v2 parent only as `v1_afltables_external_id`
  audit provenance inside `operator_adjudication.affected_rows`; neither is in `bridges[]`.
- **No import, no Phase F sample, no Phase 4.** `afldb_test`, DEV and PROD are unchanged —
  `draft_persons` still carries 5 human links and 0 bridge links everywhere.
- **Phase 3 is not accepted and AFLDB-ISSUE-222 remains in progress.** This closes only the
  DB-free parent-v2 generation step.

### 11.15 v2 `afldb_test` child resolved (operator-reported) — DB-free child validation and Phase F tooling PREPARED, NOT yet run (2026-09-18, Fable 5.1)

**Status: the v2 deployment child exists (operator-executed, read-only resolution). Its
independent DB-free validation and the Phase F sample generation are PREPARED as tools and
contracts in this pass and have NOT been executed. Phase 3 acceptance and Phase 4 remain
pending; nothing was imported; `afldb_test`, DEV and PROD are unchanged.** Claude executed no
command in this pass (no Python, no database, no network, no Git).

**Operator-reported resolution** (`export_person_bridge.py --resolve-against afldb_test
--parent …-v2.json --out …-v2.afldb_test.json`): child sha256
`b996c60e9d4de3aeb6f250f360b2a66164a2211b9604338a65918e79fa29e1c5`; `kind: deployment`;
`parent_sha256` `ad25d965…` (= v2 parent); parent bridges 3,562; accepted 3,468; withheld 1,589;
population 5,057; `target_registration.count` 13,275; `measured_at` 2026-09-18T09:59:26Z. The
resolver contract (deployment-as-parent refusal, no-overwrite, SELECT-only, server-enforced
read-only, importer unreachable) is reported as PASS before the run.

**File-level reconciliation from the artefacts themselves** (native file reads and searches
only; the operator-run validator below proves the same facts row by row):

| Fact | Observed in the artefacts |
|---|---|
| child `counts` | bridges 3,468 / parent_bridges 3,562 / withheld 1,589; 3,468 + 1,589 = 5,057 |
| child `provenance` | identical to the v2 parent's, including `v2_operator_verdicts_sha256` `b2ae2f40…` |
| the 7 corrected persons | all present in child `bridges[]` with the v2 targets (`Aaron_Black0`, `Alwyn_Davey0`, `Joel_Smith0`, `Josh_Smith0`, `Sam_Butler0`, `Stephen_Schwerdt`, `Tom_Murphy0`); all 7 were `target_not_registered` in the v1 child |
| the 2 rejected persons | `craig_somerville/1`, `david_sullivan/1` in child `withheld[]` with reason `different_person_wrong_href` (carried from the v2 parent); `players/C/Craig_Somerville.html` and `players/D/David_Sullivan.html` occur nowhere in the v2 child or the v2 parent |
| `target_not_registered` | 101 in the v1 child → **94** in the v2 child (101 − 7) |
| `U-no-href` | 1,493 in every parent and child |
| withheld composition | 1,493 `U-no-href` + 2 `different_person_wrong_href` + 94 `target_not_registered` = 1,589 |
| registration | 13,275 in both children (= the accepted snapshot's `distinct_urls`) |
| timestamps | child 09:59:26Z > parent 08:43:12Z (= verdicts `review_completed_utc`) > v1 child 00:56:58Z |

Implied carry-forward = 3,468 − 7 = 3,461 = 3,463 − 2. **The per-row identity of those 3,461
mappings, the absence of any other state change, and the child hash are asserted only by the
operator-run validator, not by this reading.**

**Transition table — the nine persons whose child state changed (v1 child → v2 child):**

| Person | v1 child | v2 child | Operator verdict (structured source) |
|---|---|---|---|
| `aaron_black/1` | `target_not_registered` (parent → `players/A/Aaron_Black.html`) | accepted `players/A/Aaron_Black0.html` | `approve_manual_curation` (`evidence.corrected_identity_candidate`) |
| `alwyn_davey/1` | `target_not_registered` (`players/A/Alwyn_Davey.html`) | accepted `players/A/Alwyn_Davey0.html` | `approve_manual_curation` (structured) |
| `joel_smith/1` | `target_not_registered` (`players/J/Joel_Smith.html`) | accepted `players/J/Joel_Smith0.html` | `approve_manual_curation` (structured) |
| `josh_smith/1` | `target_not_registered` (`players/J/Josh_Smith.html`) | accepted `players/J/Josh_Smith0.html` | `approve_manual_curation` (structured) |
| `sam_butler/1` | `target_not_registered` (`players/S/Sam_Butler.html`) | accepted `players/S/Sam_Butler0.html` | `approve_manual_curation` (structured) |
| `stephen_schwerdt/1` | `target_not_registered` (`players/S/Steven_Schwerdt.html`) | accepted `players/S/Stephen_Schwerdt.html` | `approve_manual_curation` (structured) |
| `tom_murphy/1` | `target_not_registered` (`players/T/Tom_Murphy.html`) | accepted `players/T/Tom_Murphy0.html` | `approve_manual_curation` (structured) |
| `craig_somerville/1` | accepted `players/C/Craig_Somerville.html` | withheld `different_person_wrong_href` | `different_person_wrong_href` (`evidence.captured_afltables_href`) |
| `david_sullivan/1` | accepted `players/D/David_Sullivan.html` | withheld `different_person_wrong_href` | `different_person_wrong_href` (structured) |

**Tooling added (uncommitted, none executed):**

- `tools/rebuild/draftguru/validate_person_bridge_child.py` — read-only, DB-free validator
  (sections 1–7: hash chain incl. the operator-reported child hash; kind/target/exporter/
  `parent_sha256`/provenance; importer-equivalent schema gate, counts, partition, sort order;
  parent containment and rejected-target absence; the exact v1→v2 transition with the seven
  corrections proven through `evidence.corrected_identity_candidate` only; registration and
  timestamps; DSN/path/credential screen and canonical LF bytes). Prints the transition table
  and a `summary_sha256` for two-run comparison. Pins the reconciliation manifest hash
  `01b7c65f…` from §11.14's operator report.
- `tools/rebuild/draftguru/build_validation_sample.py` — Phase F generator (§3.5 item 4):
  see the design record below. Gated on the child validator passing in-process.
- `tests/python/draftguru_lineage_fixture.py` (shared 12-person fixture lineage),
  `tests/python/draftguru_child_validation_contract.py`,
  `tests/python/draftguru_validation_sample_contract.py`; both contracts spawned from
  `tests/draftguru-acquisition.test.ts`. `tools/rebuild/draftguru/README.md` documents both tools.

**Phase F design as implemented (from §3.5 item 4, §11.11 "Phase F", decision pack v2 §9):**
frame = v2 SOURCE-EVIDENCE parent `bridges[]` (3,562; never the child, per §4.5 and the
`--review-sample` guard) minus the census (bridged national top-10, expected 399 and required to
equal the v1 census) minus the v1 sample (399 census + 598 random, salt `AFLDB-ISSUE-222/v1`;
`craig_somerville/1` was in the v1 random stratum and is already withheld, `joel_smith/1` is
census) minus, by default, the 83 adjudicated pack persons ("prior discovery rows"); ordering
`sha256(salt + "|" + player_url)` hex ascending, ties by URL; salt `AFLDB-ISSUE-222/v2`;
`n = 598`; expected eligible frame ≈ 3,562 − 399 − 597 − (adjudicated pack persons still
bridged, non-census, not in the v1 sample) — measured by the tool, never predicted. Disjointness
is proven by construction and recorded as zero-overlap counts against the census, the v1 census,
the v1 random stratum and the pack, with the v1 sample's sha256. Generation is fully DB-free
after child resolution (inputs: v2 parent, validated v2 child, v1 sample, operator verdicts,
Stage A `rows.jsonl` for the top-10 index, contract regex). Outputs
`docs/rebuild-manifests/draftguru/bridge-validation-sample-20260918-v2.{json,csv}` carrying
every input hash, every tool hash, the bound formula (`1 − 0.05^(1/598)` = 0.4997%), per-row
parent identity, child status and selection key, and **no verdict field**; `generated_utc` frozen
to the child's `2026-09-18T09:59:26Z`. Acceptance before Phase 3 can be accepted: every one of
the 598 rows reviewed under the §3.5 same-person criterion with 0 failures (an `undetermined`
is escalated, never redrawn), verdicts in a separate versioned artefact hash-linked to the
sample, unchanged tool and input hashes, and the achieved bound stated beside the observed
count; rows that are `target_not_registered` on `afldb_test` are terminal `target_unregistered`
exactly as under v1.

**Operator decisions required before `--write`:**

- **O-5** — exclude the 83 adjudicated pack persons from the Phase F frame (tool default,
  conservative reading of "prior discovery rows"), or keep them (`--include-adjudicated`)?
- **O-6** — frame on the parent (existing rule; unregistered rows count toward `n` and review as
  terminal `target_unregistered`, as 16 of 598 did under v1) or restrict to child-accepted rows
  (a contract change to §3.5 that this pass did not make)?
- **O-7** — confirm the reconciliation-manifest hash pinned in the validator (`01b7c65f…`, the
  only recorded source is §11.14's operator report); a mismatch is a validator refusal, not a
  child defect.

**Not done by this pass:** no command executed; child validation not yet run; handoff §6.D's
`import_draftguru.py --validate-only --bridge <child>` still never run on any child; Phase F
sample not generated; no import; Phase 3 acceptance and Phase 4 not authorised.

### 11.16 Operator run of §11.15: real child PASSES twice; synthetic fixture defect corrected (2026-09-18, Fable 5.1)

**Operator-reported evidence (commands run by the operator, not by the model):**

- `validate_person_bridge_child.py` on the real v2 child: every check passed, twice, with an
  identical `summary_sha256` `5bc5336be116cc797b011900b3fdbc010cd4dd59a9eba4c4495c321f7e6ce590`;
  child SHA-256 `b996c60e…` confirmed; O-7's pinned reconciliation hash matched.
- `import_draftguru.py --validate-only --bridge <child>`: passed, contacted no database.
- `build_validation_sample.py --validate-only`: passed, nothing written. Salt `AFLDB-ISSUE-222/v2`,
  n 598, parent bridges 3,562, census 399, non-census 3,163, excluded union 634, eligible frame
  2,529, sample 582 bridged + 16 `target_not_registered`, all four overlaps zero;
  `rows_sha256` `91be2942…`, JSON `6523bad6…`, CSV `afa2b917…`. O-5/O-6 remain operator
  decisions before `--write`.
- The two Python contracts FAILED on the synthetic fixture only (child contract 1.1 via validator
  5.3/5.4/5.7, 1.2, 3.1; the Phase F contract transitively, because `build_validation_sample`
  correctly refused the invalid fixture child).

**Fixture root cause:** `draftguru_lineage_fixture.py` accepted the manual-curation person
`fix_p04/1` in the **v1 child** with its original target `Fix_P04`, then accepted it in the v2
child with `Fix_P040`. The validator's transition model (line 447 of the validator, mirroring the
real lineage where all 7 corrected persons were among the 101 v1 `target_not_registered`) admits
only v1 withheld → v2 accepted for a corrected person, so the fixture measured a change in place
(5.3), an empty newly-accepted set (5.4) and a wrong v1 state (5.7); measured counts were
carry-forward 6 / corrected 0 / removed 1 / tnr_v1 1 / tnr_v2 1. **Fix:** the v1 child now bridges
p01–p03 and p05–p08 (7) and withholds p04 and p09 as `target_not_registered` (5 withheld);
`expect.v1_target_not_registered` is 2; contract check 1.2 expects `target_not_registered_v1: 2`.
p09 is retained as the unchanged `target_not_registered` row. Measured transition is now 6
carry-forward / 1 corrected / 1 removed / no in-place change.

**Cause of the 3.1 "non-repeatability":** not digest instability. Contract check 3.1 was written
as `digest_1 == digest_2 AND no failures`; the clean fixture failed 1.1, so 3.1 failed on its
second conjunct. Audit of every digest input (`tool`, `tool_version`, repository-relative
`child`, `child_sha256`, the pinned-input hex hashes, the ordered check list with failure details
built only from sorted lists and repository-relative strings, the URL-sorted transition table,
the counts) found no temp path, wall-clock value or unordered collection; the validator imports
`datetime` for parsing only. The contract now asserts repeatability alone (3.1), a clean run
separately (3.1a), the same digest from a second temporary root (3.1b, proves no absolute path
enters the digest) and repeatability of a deliberately failing run (3.1c).

**Production code unchanged:** `validate_person_bridge_child.py`, `build_validation_sample.py`,
both real parents, both real children, verdicts, pack, reconciliation manifests and every Phase F
canonical output are untouched. The Vitest failure on `GRID_DRAFT_TYPES` is `AFLDB-ISSUE-223`
(pre-existing, ISSUE-221 reshape at `f1a8daca`); this pass only appended the two `itPy` wrappers
at the end of `tests/draftguru-acquisition.test.ts` and did not touch that test or
`grid-solver-spec.ts`. `.gitattributes` already forces LF on `docs/rebuild-manifests/**` and
`data/reference/*.json`, so every hash-pinned artefact of this issue is protected from
`core.autocrlf`; no rule change needed.

**Operator rerun:** `python tests/python/draftguru_child_validation_contract.py`, then
`python tests/python/draftguru_validation_sample_contract.py`, then
`npx vitest run tests/draftguru-acquisition.test.ts -t "deployment-child validation tool|Phase F validation-sample tool"`.

### 11.17 Phase F sample GENERATED (operator-reported); review and acceptance path PREPARED, NOT run (2026-09-18, Fable 5.1)

**Operator-reported (commands run by the operator, not by the model):** the canonical Phase F
v2 sample exists and is hash-confirmed — `--validate-only`, first `--write`, post-write
`--validate-only` (both identical), second `--write` (identical), independent PowerShell hashes
matched. `docs/rebuild-manifests/draftguru/bridge-validation-sample-20260918-v2.json`
`6523bad65d8d92bb2c1bc792d6799660e681c047fdcb5bc2581d85dbf5665578`, `.csv`
`afa2b9172211609d1e3032c0d02d0dd92b435138b58dda2fcf2a570f82a17cf2`, `rows_sha256`
`91be2942255fcf086036e5cac7f38651f6d8948b48d5ca54866e258b2d573b52`; n 598, salt
`AFLDB-ISSUE-222/v2`, parent bridges 3,562, census 399, non-census 3,163, excluded union 634
(597 v1 random + 63 adjudicated pack), eligible 2,529, 582 bridged + 16 `target_not_registered`,
all four overlaps zero, bound 0.004997. **O-5** pack excluded, **O-6** parent-based frame retained,
**O-7** reconciliation hash pinned; `--include-adjudicated` not used. The sample is UNREVIEWED.

**Review mechanism determined from the repository (not invented):** §3.5 item 4 requires the
redraw "reviewed by the same criterion, again requiring 0 failures"; the criterion is §3.5's
same-human test and the mechanism in force is decision O-4 revision 2 (handoff §0; offline
runbook): offline retained-evidence comparison by `review_person_bridge_offline.py`'s rules for
every row, then operator adjudication of every mandatory recheck row (runbook §7 classes 1–10)
plus the deterministic audit (class 11), acceptance per runbook §8. The v1 tool **cannot consume
the v2 sample unchanged**: it reads `census_stratum`/`random_stratum` (the v2 sample has one
`rows[]`), defaults `--expect-total-rows` to 997, stamps a wall-clock `generated_utc`, overwrites
unconditionally, and with `--label 20260918-v2` would name its outputs
`bridge-review-verdicts-20260918-v2.json` — the **existing** corrected v1-sample artefact. It
also must not be edited: the sample freezes its hash in `tool_hashes` and declares any tool-hash
change voids the sample.

**Built (DB-free; not run against the real sample):**

- `tools/rebuild/draftguru/review_validation_sample.py` — Phase F machine review. Imports the v1
  rules verbatim (`evaluate_row`, `build_fitzroy_index`, `build_recheck_queue`,
  `build_residual_report`), applies them in sample order to the v2 `rows[]`; pins the sample
  JSON/CSV/`rows_sha256`, the whole child lineage, the retained-evidence inputs the v1 review
  measured (profile `bad43909…`, Stage A manifest/persons, fitzRoy register/manifest/contract,
  ledger, aliases) and the child validation `summary_sha256` `5bc5336b…` (re-run in-process);
  checks salt, n, zero overlaps, selection keys, the sample's frozen tool hashes and every row's
  identity/child status against parent and child (any disagreement refuses). Outputs
  `bridge-validation-verdicts-20260918-v2.{json,csv}`, `bridge-validation-recheck-20260918-v2.json`,
  `bridge-validation-residual-20260918-v2.json`, frozen to the sample's `generated_utc`,
  idempotent, never overwriting a differing file. Each row carries the machine `outcome` **and** a
  separate `deployment_status` + `identity_evaluable`; audit salt `AFLDB-ISSUE-222/audit-v2`.
- Operator verdicts: `bridge-validation-operator-verdicts-20260918-v2.json` (copy of the recheck
  queue + `source_recheck_sha256`/`verdicts_sha256`/`sample_sha256`/`review_completed_utc`;
  `agree`/`contradict`/`undetermined`, notes and evidence required for the latter two; machine
  outcome never edited). No GUI mode was built for it (scope).
- `tools/rebuild/draftguru/validate_validation_review.py` — independent, read-only final validator
  and acceptance decision (33 checks over sections 1–7, 34 with `--expect-verdicts-sha256`; exit 0
  ACCEPTED / 2 NOT ACCEPTED / 1 FAIL;
  `summary_sha256` for two-run comparison).
- `tests/python/draftguru_validation_review_contract.py` (fixture lineage + generated fixture
  sample, n = 4, injected fitzRoy index) + a Vitest wrapper; `draftguru_lineage_fixture.py` gained
  an `identity_suffix` parameter (default unchanged) so fixture identities can be non-suffixed.
- `tools/rebuild/draftguru/README.md` sections for both tools.

**Treatment of the 16 `target_not_registered` rows:** terminal deployment status, never an identity
contradiction — documentary basis: runbook §5 (outcome table: "no retained target facts to
compare"), §7 item 3 ("settled disposition is continued withholding"), §9 (continued withholding,
no network), correction handoff §10.3 (0 of the 101 paths appear in the accepted 1897–2025
source), decision O-6 (count toward n, "as 16 of 598 did under v1"). They are mandatory recheck
class 3; the operator confirms continued withholding with `agree`. The v1 distribution over 997
(960 strong / 2 limited / 7 contradict / 28 unregistered / 0 unavailable / 0 tooling, §11.8 and
the corrected rerun) shows the acceptable Phase F shapes: `offline_strong` rows are clean;
`offline_limited` rows need an operator `agree` from retained evidence; `target_unregistered`
rows are terminal withholding; `offline_contradict` rows are acceptable only when the operator
resolves them to `agree` with evidence (the v1 seven were DraftGuru-side href mislinks that the
operator withheld — under Phase F such a row is a genuine failure unless resolved).

**Failure and acceptance (as enforced):** a genuine identity contradiction (machine
`offline_contradict` not resolved to `agree` with evidence, or any operator `contradict`) or an
`undetermined` (not a pass; escalated, never redrawn — §3.5) blocks; every mandatory and audit
row needs a terminal verdict; every audit row must be `agree`; `offline_unavailable` /
`tooling_or_schema_error` rows block until rerun. Statement on acceptance: 0 failures, one-sided
95% upper bound `1 − 0.05^(1/598)` = 0.4997% at n = 598 (O-6) and `1 − 0.05^(1/582)` = 0.5134%
over the identity-evaluated rows (conservative), comparison target AFL Tables-derived retained
evidence, wording "retained fitzRoy/AFLDB comparison plus operator exception/audit review".

**Operator decisions required:** **O-8** — O-4 revision 2 coverage (mandatory recheck rows +
30-row audit; validator default) versus §11.11's "operator same-person verdict required per row"
(validator `--require-per-row-operator-verdicts`); **O-9** — confirm audit salt
`AFLDB-ISSUE-222/audit-v2` before the first `--write` (recorded in the recheck artefact).

**Known limitation (pre-existing design):** `build_validation_sample.py` freezes tool hashes as
on-disk bytes; on this `autocrlf=true` worktree those are CRLF bytes, so the sample's `tool_hashes`
(and the review's) reproduce only on a checkout with the same line endings. The review tool
therefore refuses on a LF checkout ("tool changed since the sample was drawn") — run the Phase F
review on the checkout that generated the sample.

**Not done:** no command executed by the model (one read-only `head` over the sample was run
before the shell boundary was re-applied; nothing else); the real review not generated; no
operator verdict; no acceptance; no import; Phase 3 acceptance and Phase 4 not authorised;
`AFLDB-ISSUE-221.md` untouched.

**Operator commands, in order (stop at the first non-zero exit):**

```text
python -m py_compile tools/rebuild/draftguru/review_validation_sample.py tools/rebuild/draftguru/validate_validation_review.py tests/python/draftguru_validation_review_contract.py tests/python/draftguru_lineage_fixture.py
python tests/python/draftguru_child_validation_contract.py
python tests/python/draftguru_validation_sample_contract.py
python tests/python/draftguru_validation_review_contract.py
python tools/rebuild/draftguru/review_validation_sample.py --validate-only
python tools/rebuild/draftguru/review_validation_sample.py --write
python tools/rebuild/draftguru/review_validation_sample.py --validate-only
python tools/rebuild/draftguru/review_validation_sample.py --write
python tools/rebuild/draftguru/validate_validation_review.py          (expected exit 2: pending operator verdicts)
  -- operator adjudicates bridge-validation-recheck-20260918-v2.json into bridge-validation-operator-verdicts-20260918-v2.json --
python tools/rebuild/draftguru/validate_validation_review.py --expect-verdicts-sha256 <sha256 of bridge-validation-verdicts-20260918-v2.json>
python tools/rebuild/draftguru/validate_validation_review.py --expect-verdicts-sha256 <same>   (identical summary_sha256)
npx vitest run tests/draftguru-acquisition.test.ts -t "Phase F"
```

### 11.18 Phase F machine review GENERATED and independently validated (operator-reported); operator-adjudication GUI BUILT, not run (2026-09-18, Fable 5.1)

**Operator-reported (commands run by the operator, not by the model):** the §11.17 command order was
executed. Canonical machine-review artefacts:
`docs/rebuild-manifests/draftguru/bridge-validation-verdicts-20260918-v2.json`
`2caf980b0a9246c784334c357f08818da7d06f716a672768a3050b4c92fae766`, `.csv`
`d2a5c3369588ef770474ea4bca838eb90bff96eee0ecb84f855c816506bba88a`,
`bridge-validation-recheck-20260918-v2.json`
`3e509021221456d5ac87276b075573eb4d7268a5b89add9155ea7975a627c175`,
`bridge-validation-residual-20260918-v2.json`
`d20a3c6f42cdf98727aaa114ced9ec46ddc5ca39967061bd1f17b488ead2cf26`; machine `rows_sha256`
`14d918a183fb37c9b214c28d2cd95073b1f26777d40dd0ce06cab659451d3166`. Outcomes over n = 598:
`offline_strong` 578, `offline_limited` 4, `target_unregistered` 16, `offline_contradict` 0,
`offline_unavailable` 0, `tooling_or_schema_error` 0; identity-evaluable 582; deployment 582
bridged + 16 `target_not_registered`. Recheck: 39 mandatory distinct rows, 30 audit rows (salt
`AFLDB-ISSUE-222/audit-v2`, **O-9 confirmed** by the write), operator queue union exactly 69.
`validate_validation_review.py`: all structural checks passed, `summary_sha256`
`7657fd85608824c2f7141681b8ab58970182a75ada286a6aee232f59879f34f6`, exit status 2 -- correctly
pending: operator artefact absent, 69 of 69 required rows lack a verdict.

**Operator-artefact contract as enforced by the validator (section 6) and the recheck's
`operator_verdict_storage`:** `bridge-validation-operator-verdicts-20260918-v2.json` is a copy of
the recheck queue (same class keys, same rows in the same order, machine `outcome` unedited) with
`source_recheck_sha256` (sha256 of the recheck file bytes), `verdicts_sha256`, `sample_sha256` and a
UTC `review_completed_utc`; per ref `operator_verdict` in {`agree`, `contradict`, `undetermined`}
with a UTC `reviewed_utc`, `notes` and `evidence` both required for `contradict` / `undetermined`, no
verdict for a person outside the sample, no conflicting verdicts for a person across classes.
Acceptance additionally requires every mandatory and audit row filled, every audit row `agree`, zero
`contradict`, zero `undetermined`, and a machine `offline_contradict` resolved to `agree` **with
evidence** (none exists in this review).

**Built (DB-free, network-free; not run by the model):**

- `tools/rebuild/draftguru/review_validation_operator.py` -- Tk GUI over the 69 required rows: one
  entry per person (multi-class memberships listed), mandatory rows then the audit, sample order;
  pins the four artefacts and the sample to the hashes above, re-derives the queue and refuses on
  any disagreement; shows the DraftGuru person, the proposed AFL Tables identity, review reasons,
  the machine identity outcome and the child deployment status separately (with the fixed
  statement that `target_not_registered` is not an identity contradiction), the retained
  comparison table, Stage A rows, reason-code meanings, and Open/Copy evidence links built from
  the canonical identity under a scheme/host allow-list (opening never records anything). Verdict
  radios carry the stored values, nothing is preselected, saving is explicit, `contradict` /
  `undetermined` and every verdict on a machine-contradiction row require notes and evidence,
  audit rows are never auto-agreed, no bulk action. Fixed footer with Previous/Next (packed before
  the body), Alt+Left/Right, scroll-to-top per row, Save/Discard/Stay on unsaved edits, `UNSAVED:`
  status until saved, four order-preserving filters. Checkpoint
  `data/review/draftguru-validation-operator-20260918-v2/progress.json` (atomic, lock, hash-linked
  to every artefact and the derived queue, refused on mismatch, no migration from the 83-row
  lineage). Finalise gated on the full contract, writes exactly the operator artefact path, never
  overwrites a differing file, then instructs the operator to run the final validator.
- `tests/python/draftguru_validation_operator_contract.py` (headless; fixture of 8 rows including a
  two-class person, a machine contradiction and a `target_not_registered` row; reads the real
  artefacts read-only to prove 39 + 30 = 69) + a Vitest wrapper in `tests/draftguru-acquisition.test.ts`.
- `tools/rebuild/draftguru/README.md` section.

**Not done:** no command executed by the model; the GUI not launched; no verdict entered; the
operator artefact not generated; no canonical artefact modified; `review_bridge_operator.py`
untouched; `AFLDB-ISSUE-221.md` untouched; no import; Phase F acceptance, Phase 3 acceptance and
Phase 4 not authorised. **O-8** (coverage: recheck + audit per O-4 rev 2 is what the GUI
adjudicates; `--require-per-row-operator-verdicts` remains the operator's call) is still open.

**Operator commands, in order (stop at the first non-zero exit):**

```text
python -m py_compile tools/rebuild/draftguru/review_validation_operator.py tests/python/draftguru_validation_operator_contract.py
python tests/python/draftguru_validation_operator_contract.py
python tools/rebuild/draftguru/review_validation_operator.py --validate-only
python tools/rebuild/draftguru/review_validation_operator.py
  -- adjudicate all 69 rows; Finalise writes bridge-validation-operator-verdicts-20260918-v2.json --
python tools/rebuild/draftguru/validate_validation_review.py --expect-verdicts-sha256 2caf980b0a9246c784334c357f08818da7d06f716a672768a3050b4c92fae766
python tools/rebuild/draftguru/validate_validation_review.py --expect-verdicts-sha256 2caf980b0a9246c784334c357f08818da7d06f716a672768a3050b4c92fae766   (identical summary_sha256)
npx vitest run tests/draftguru-acquisition.test.ts -t "Phase F"
```

### 11.19 Phase F ACCEPTED (operator-reported); pre-import import-scope and rollback assessment; read-only plan/verify gates BUILT, not run (2026-09-18, Fable 5.1)

**Operator-reported (commands run by the operator, not by the model):** the §11.18 order was
executed to completion. Operator artefact
`docs/rebuild-manifests/draftguru/bridge-validation-operator-verdicts-20260918-v2.json`, sha256
`b8cf98bb9329a5ea2d6d065d556adbd2f8f6d1cc7c75d596dc7053ceb7b68758`. Final
`validate_validation_review.py`: `summary_sha256`
`63c89265565f8c1cb73b99f91e668cc3bb7e8af6b46187188ef29a37c7e516c9`, **ACCEPTANCE: ACCEPTED** —
598 sampled rows, 582 identity-evaluable, 16 `target_not_registered` terminally withheld, 69/69
required operator verdicts `agree` (0 `contradict`, 0 `undetermined`), 0 failures; one-sided 95%
upper error bound 0.4997% at n = 598 and 0.5134% at identity-evaluable n = 582. §6.5 / §3.5 item 4
is satisfied. **O-8** is resolved by the run as recheck+audit coverage (69 rows). The deployment
child is unchanged: `data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json`
`b996c60e9d4de3aeb6f250f360b2a66164a2211b9604338a65918e79fa29e1c5` — 3,468 accepted, 1,589
withheld (1,493 `U-no-href`, 94 `target_not_registered`, 2 `different_person_wrong_href`), 5,057
total. `import_draftguru.py --validate-only --bridge <child>` passed and contacted no database.

**Authorised by the operator for this pass:** preparation only. No command run, no database
connection, no backup, no import, no deploy, no Git action, no `afldb_dev` / production access by
the model. Every artefact above is preserved byte-for-byte; `AFLDB-ISSUE-221.md` untouched.

#### 11.19.1 Code-level import-scope assessment (`import_draftguru.py`, `tools/migration/common.py`)

Read in full: `run_import()`, `apply_authority()`, `reconcile_draftguru_identities()`,
`seed_player()`, `read_live_decisions()`, `resolve_*()`; `common.ImportBatch` / `import_batch()`,
`copy_rows()`, `reload_keyed()`, `check_population_drop()`, `analyze()`,
`replay_admin_overrides(draft_picks)`; migrations 019 / 069 / 002 / 056 / 073.

| Item | Finding |
|---|---|
| Tables written | `import_batches` (one row per run, plus `import_rejections` only if a row is rejected — none are on this path); `draft_persons`; `draft_picks`; `external_identities` (source `draftguru`); `players` **only** when a ledger decision with a `draftguru` target has no registered shell on the target (`seed_player`; `--no-seed` turns that into a refusal). Temp table `_afldb_incoming` (session-local). `ANALYZE` on the three data tables (statistics only). |
| Columns written | `draft_persons`: the 13 `PERSON_COLUMNS` — `source_id, dg_person_id, player_url, display_name_raw, name_key, player_id, link_status, candidate_count (0), match_method, confidence_notes, reported_games, reported_goals, is_matching_backlog` (link columns come from `apply_authority()`; the rest from the frozen snapshot derivations). `draft_picks`: the 31 `PICK_COLUMNS` — every source-derived column plus the person's `player_id / link_status_value / match_method / confidence_notes`, `draft_person_id`, `dg_person_id`, and **`import_batch_id` rewritten on all 6,810 DraftGuru rows on every run**; `weight_kg`, `grade`, `signing_detail` always NULL. `external_identities(draftguru)`: `external_name, external_url, player_id, status, match_method, notes (= "stage_a_snapshot=<label>")`, `candidate_count 0`. |
| INSERT / UPDATE / DELETE | `reload_keyed(draft_persons, key (source_id, player_url), delete_missing=False)`: temp-table COPY → duplicate-key refusal → `UPDATE … WHERE e.source_id = ANY(%s) AND key match` (every matched row, all columns) → `INSERT` of keys not stored. `reload_keyed(draft_picks, key (source_id, player_url, draft_year, draft_kind), refuse_out_of_scope_key=True)`: the same, plus `DELETE` of scoped rows whose key the snapshot no longer carries. Then `DELETE FROM draft_persons` (scoped) for childless persons; `INSERT … ON CONFLICT (source_id, external_id) DO UPDATE` for all 5,057 identities and a scoped `DELETE … external_id <> ALL(asserted)` guarded by `check_population_drop` (person rows, not links). `replay_admin_overrides("draft_picks")`: re-creates/updates `manual_admin_edit` selections and patches source-owned overrides keyed `source_id|player_url|draft_year|draft_kind`. `link_columns=None` on both reloads, so `reload_keyed`'s own decision guard is not engaged — the person-grained authority is `apply_authority()` alone. Admin picks (`source_id IS NULL`) are outside every predicate (partial index `draft_picks_source_uq`). |
| Transaction boundaries | Connection `connect_pg(AFLDB_IMPORT_DATABASE_URL)`, autocommit off. **Commit 1:** `ImportBatch.__post_init__` inserts the `running` batch row and commits before any data statement. Everything from `resolve_source_id` through `replay_admin_overrides` is one transaction (DDL on the temp table, COPY, `SET CONSTRAINTS draft_persons_source_id_dg_person_id_key DEFERRED`, all writes). **Commit 2:** `batch.finish("completed")` — `UPDATE import_batches` then `conn.commit()`. `analyze()` then commits (no-op) and runs `ANALYZE` in autocommit. |
| Commit / rollback | Any exception inside the block (`ImportFailure`, `RuntimeError` from `reload_keyed` / `check_population_drop` / `replay_admin_overrides`, a server error, `DryRunComplete`) → `conn.rollback()` → `batch.finish("failed", error=…)` (a separate committed transaction) → re-raise; `--dry-run` therefore leaves a `failed` batch row whose `error` is `DryRunComplete: ` and no data change. Phase A (`validate()`) needs no connection. |
| Partial import possible? | **Data: no.** All data writes share one transaction with a single commit point; a failure before it leaves the three tables untouched. **Audit row: yes, before this pass** — see 11.19.2. After the correction the data and the `completed` status are one commit; the only remaining window is between that commit and `ANALYZE`, which affects planner statistics only. |
| Can trusted / manual links be overwritten? | No. Step 1 of `apply_authority()` applies the tracked ledger and every live `player_link_resolutions` decision (newest row per pick, person-normalised, HALT on contradiction across a person's picks) **before** the bridge; step 2 refuses (`ImportFailure`, whole run rolled back) any bridge row that disagrees with a human decision, and merely `continue`s on an agreeing one. `data_overrides` are re-applied after the reload. Admin-created picks are outside the scope. The only thing the run *does* overwrite is a previous bridge link — links are recomputed every run (§4.3), which is exactly the §7.4 reversal mechanism. |
| The six ledger decisions × 3,468 bridge rows | `aaron_bruce/1` confirmed_unlinked → `unmatched` / `draftguru_explicit_admin_decision` (a bridge row for him would HALT; there is none — he is `U-no-href`). `fred_rodriguez/1`, `riley_onley/1` linked to their own DraftGuru identity → `resolved` on the shells the rebuild seeded (`dg_identities`); with `--no-seed` the run refuses if either shell is missing. `matt_rendell/1` → `players/M/Matthew_Rendell.html`, `nathan_fyfe/1` → `players/N/Nat_Fyfe.html`, `ryan_o'keefe/1` → `players/R/Ryan_OKeefe.html` → `resolved` / ledger; each is expected to also appear in `bridges[]` with the same identity, in which case step 2 verifies agreement and does **not** count it (`authority: bridge` = 3,468 − 3 = **3,465**; `authority: ledger` = 6). A different identity in the bridge for any of the three would HALT. The plan gate prints the exact agreeing set. |
| Expected difference classes | **Bridge rows** 3,468 = **newly linked** 3,465 (`unmatched` → `unique` / `draftguru_person_page_afltables_bridge` / `"draftguru person-page bridge -> <identity>"`, `is_matching_backlog` → false) + **already agreeing** 3 (ledger, unchanged). **Already agreeing, unlinked** 1,587 (unchanged rows). **Withheld** 1,589 = 1,493 `U-no-href` (of which 3 are ledger persons) + 94 `target_not_registered` + 2 `different_person_wrong_href` — none receives a link; they are not "changed" rows. Persons after: `resolved|ledger` 5, `unmatched|ledger` 1, `unique|bridge` 3,465, `unmatched|` 1,586; linked 3,470. Picks: every pick inherits its person; `import_batch_id` changes on all 6,810; the plan prints the by-status totals. `external_identities(draftguru)`: 3,465 rows change `player_id / status / match_method`; `notes` unchanged if the stored Stage A label equals the run's label (**if `afldb_test` was last loaded from `annual-html-20260902`, every `notes` value and possibly `source_record_id` / `detail` would change — the plan refuses on that and the label question must be settled first; only `annual-html-20260826` and `person-html-20260918` bytes are present locally**). |

#### 11.19.2 Atomicity — finding and the smallest correction (production code changed)

`run_import()` called `analyze(pg, …)` **inside** the `with import_batch(...)` block. `analyze()`
(`common.py`) executes `conn.commit()` before toggling autocommit, so the data transaction was
committed there, and `batch.finish("completed")` ran afterwards in its own transaction. A crash
between the two left committed links beside a `running` batch row; an `ANALYZE` failure raised
into `import_batch`'s `except`, whose `rollback()` had nothing to undo, and recorded the batch as
`failed` beside committed data — a misleading audit trail, though never partial data. Correction:
the `analyze()` call moved to after the block (importer docstring "Atomicity" section and an
in-code comment explain why); the module's other behaviour is unchanged. DB-free proof:
`tests/python/draftguru_import_atomicity_contract.py` drives the real `run_import()` on the
scripted connection in `tests/python/draftguru_fake_pg.py` and asserts: exactly one commit before
the first data statement; **no commit between the first data statement and the `completed`
batch-row update**; `ANALYZE` only after that commit, under autocommit; an injected server error
mid-write → one rollback, then only the `failed` row with the error, no `ANALYZE`; `--dry-run` →
the same path with `DryRunComplete`; a bridge/human contradiction → refused before any data
statement; every `draft_persons` / `draft_picks` write DraftGuru-scoped and no other table
written. `tests/draftguru-import.test.ts` pins the call position and spawns the contract.

#### 11.19.3 Read-only gates — `tools/rebuild/draftguru/bridge_import_gate.py plan | verify`

Described in `tools/rebuild/draftguru/README.md`. In one sentence: the importer's own
`validate()` + `apply_authority()` (seeding forbidden) replayed against the target's registration
and live decisions, over a connection that can only read `afldb_test`, compared with the stored
rows, fail-closed on anything but "newly linked persons and their picks / identity rows", with
ordered content hashes so the post-import check is content-based, not count-based. Contract
`tests/python/draftguru_import_gate_contract.py`; Vitest wrappers in both DraftGuru suites.

**Expected `plan` assertions on `afldb_test` (first import of the v2 child):**

```text
1.1-1.6  PASS   counts: bridges 3468, withheld 1589 {U-no-href 1493, target_not_registered 94,
                 different_person_wrong_href 2}, persons_in_snapshot 5057, picks_in_snapshot 6810
2.1-2.4  PASS   on / on / afldb_test / UTC; live decisions consistent
3.1-3.4  PASS   5057 persons, 6810 picks, no duplicates, picks agree with persons
         live_decisions 0 (a WARN line otherwise); draft_picks_overrides_active 0 expected
         decided_persons_in_bridge = the 3 ledger persons (matt_rendell/1, nathan_fyfe/1, ryan_o'keefe/1)
         expected_bridged 3465
4.1-4.3  PASS   no unregistered / ambiguous bridge target; no withheld identity now registered;
                 no person reaches Craig_Somerville.html / David_Sullivan.html
5.1-5.9  PASS   authority: ledger 6, live_override 0, bridge 3465, unmatched 1587, seeded 0
6.x      PASS   persons.newly_linked 3465; already_agreeing_linked_human 5;
                 already_agreeing_linked_bridge 0; already_agreeing_unlinked 1587;
                 link_dropped / relinked / link_metadata_change / unexpected_link_change /
                 missing / extra / nonlink_change / dg_person_id_permutation 0;
                 picks.link_change = the picks of those 3465 persons (printed), nonlink_change 0;
                 identities.link_change 3465, other_change 0; manual 0 / 0 / 0
7        totals_after.persons_by_status_method {resolved|draftguru_explicit_admin_decision: 5,
                 unique|draftguru_person_page_afltables_bridge: 3465,
                 unmatched|draftguru_explicit_admin_decision: 1, unmatched|: 1586};
                 linked_persons 3470; changes 3465; five hashes printed; baseline digests printed
8.1      PASS   -> "PLAN: OK -- every check held; nothing was written", exit 0
```

Record from the plan output: `after_state_sha256`, `picks_after_sha256`, `newly_linked_sha256`,
`baseline_sha256`, `changes_sha256`, `import_batches_before`, `summary_sha256`. Any FAIL → stop;
the importer is not run.

#### 11.19.4 Backup — convention and commands

Convention: `tools/maintenance/backup.sh` / `docs/backup-restore.md` §1 (`pg_dump --format=custom
--compress=6 --no-owner`, partial-then-rename, `pg_restore --list` verification, password moved
out of argv into `PGPASSWORD`, file named after the database, mode-restricted directory).
`backup.sh` cannot be pointed at `afldb_test` from this worktree: it sources `.env` after any
exported override and `.env`'s `AFLDB_BACKUP_DATABASE_URL` names `afldb_dev`, and `afldb_test` is
listed in `docs/backup-restore.md` §5 as "not backed up (reproducible)". The new
`tools/maintenance/backup-afldb-test.ps1` mirrors the script's contract for this one database and
writes outside the repository (`D:\backups\afldb\issue-222`, the established off-host location —
memory "Prod DB backup 2026-08-18"). Credentials never appear in its output.

```powershell
# from the worktree root, PowerShell
powershell -ExecutionPolicy Bypass -File tools\maintenance\backup-afldb-test.ps1
#   -> writes D:\backups\afldb\issue-222\afldb_test-<yyyyMMdd-HHmmss>.dump, prints size,
#      object count, sha256. Record the file name and sha256 in this section.
# independent re-check of the two facts the script printed:
Get-FileHash -Algorithm SHA256 D:\backups\afldb\issue-222\afldb_test-<stamp>.dump
& "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" --list D:\backups\afldb\issue-222\afldb_test-<stamp>.dump | Select-String '^\d' | Measure-Object
```

**Rollback, three tiers (execute only if `verify` refuses or the import HALTs after writing):**

1. **Importer reversal (§7.4 "initial-load rollback"; no restore).** Same environment as the
   import, without `--bridge`: `python tools/rebuild/draftguru/import_draftguru.py --no-seed`.
   Links are recomputed to the pre-bridge state (ledger and live decisions untouched,
   `data_overrides` replayed, identities reconciled). Proof that S2 = S0: run
   `bridge_import_gate.py plan` again — it must print the **same** `after_state_sha256`,
   `newly_linked_sha256`, `changes_sha256` and `baseline_sha256` as the pre-import plan, with
   `changes 3465` and `import_batches_before` two higher (dry-run + reversal rows).
2. **Restore into a separate recovery database** (never over `afldb_test`; requires the DEV host's
   `postgres` superuser — no repository credential can `CREATE DATABASE`; sudo is
   password-gated there):
   ```text
   scp D:\backups\afldb\issue-222\afldb_test-<stamp>.dump streamanator:/tmp/
   ssh streamanator "sha256sum /tmp/afldb_test-<stamp>.dump"                       (must equal the recorded sha256)
   ssh -t streamanator "sudo -u postgres createdb -T template0 afldb_test_recovery"
   ssh -t streamanator "sudo -u postgres pg_restore --dbname=afldb_test_recovery --no-owner --jobs=4 /tmp/afldb_test-<stamp>.dump"
   ssh -t streamanator "sudo -u postgres psql -X -At -d afldb_test_recovery -c 'select count(*) filter (where player_id is not null), count(*) from draft_persons'"
   ```
   Expected: 5 linked of 5,057 (the pre-bridge state). "must be owner of extension" for
   `pg_trgm` / `unaccent` is the documented harmless message (`docs/backup-restore.md` §2).
   Compare `afldb_test_recovery` with `afldb_test` before deciding anything further.
3. **Last resort — restore over `afldb_test` itself** (owner DSN from the workstation; destroys
   the current `afldb_test`; only after tier 2 has proven the dump):
   `pg_restore --clean --if-exists --no-owner --jobs=4 --dbname=<AFLDB_TEST_DATABASE_URL> <dump>`
   then `npm run db:privileges:test` (the privileges reconciler is mandatory after any restore).

#### 11.19.5 The 16 `target_not_registered` rows → `AFLDB-ISSUE-224`

Investigated from retained artefacts only (`bridge-validation-verdicts-20260918-v2.{csv,json}`,
handoff §10.3). 15 of the 16 are 2021–2025 draftees (10 from 2025), one is a 1992 `spelling`
case (Matthew Capuano). Hussien El Achkar (`hussien_el%20achkar/1`, 2025 National pick 53,
Essendon, 9 games / 10 goals, DOB 02 Apr 2007) is the operator-observed strong example: both
sources agree on the person, AFLDB search returns no player, verdict `agree`, withheld. The
measured statement stands: none of the 94 withheld paths appears in the accepted 2025 baseline's
13,275-URL registered set; a 2026 debutant cannot be registered by it. **Nothing here is a bridge
error and nothing is added to any database by the ISSUE-222 import**; the deferred
registration/current-season gap is recorded as `AFLDB-ISSUE-224` (`issues.md`, `IssuesIndex.md`).

#### 11.19.6 Operator sequence (stop at the first non-zero exit or FAIL; nothing below is done)

```powershell
# --- A. DB-free, from the worktree root ---------------------------------------------------
python -m py_compile tools/rebuild/draftguru/import_draftguru.py tools/rebuild/draftguru/bridge_import_gate.py tests/python/draftguru_fake_pg.py tests/python/draftguru_import_atomicity_contract.py tests/python/draftguru_import_gate_contract.py
python tests/python/draftguru_import_atomicity_contract.py       # "All DraftGuru importer atomicity checks hold."
python tests/python/draftguru_import_gate_contract.py            # "All DraftGuru import-gate checks hold."
python tools/rebuild/draftguru/import_draftguru.py --validate-only --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json
npx vitest run tests/draftguru-import.test.ts tests/draftguru-acquisition.test.ts -t "scripted connection|ANALYZE runs after|bridge import gate"

# --- B. Read-only plan (AFLDB_TEST_DATABASE_URL from .env; tunnel 55432 must be up) -------
python tools/rebuild/draftguru/bridge_import_gate.py plan
#   expect the 11.19.3 assertions; copy after_state_sha256, picks_after_sha256,
#   newly_linked_sha256, baseline_sha256, changes_sha256, import_batches_before, summary_sha256
python tools/rebuild/draftguru/bridge_import_gate.py plan --print-manifest > D:\backups\afldb\issue-222\plan-manifest-<stamp>.txt
#   (optional; the redirect is the operator's, outside the repository; identical hashes expected)

# --- C. Backup ---------------------------------------------------------------------------
powershell -ExecutionPolicy Bypass -File tools\maintenance\backup-afldb-test.ps1
Get-FileHash -Algorithm SHA256 D:\backups\afldb\issue-222\afldb_test-<stamp>.dump

# --- D. Importer DSN: the afldb_import role on afldb_test (memory: derive by swapping the
#        database name; the importer's load_env() is setdefault, so the exported value wins) ---
$line = Get-Content .env | Where-Object { $_ -like 'AFLDB_IMPORT_DATABASE_URL=*' } | Select-Object -First 1
$env:AFLDB_IMPORT_DATABASE_URL = (($line -replace '^AFLDB_IMPORT_DATABASE_URL=', '').Trim()) -replace '/afldb_dev(\?|$)', '/afldb_test$1'
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -X -At -c "select current_user, current_database()" -d $env:AFLDB_IMPORT_DATABASE_URL
#   must print exactly: afldb_import|afldb_test   (anything else: stop; do not import)

# --- E. Dry run, then re-plan --------------------------------------------------------------
python tools/rebuild/draftguru/import_draftguru.py --dry-run --no-seed --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json
#   expect: authority: ledger 6, live_override 0, bridge 3465, unmatched 1587, seeded 0;
#           "DRY RUN — the transaction was rolled back; nothing was written."; exit 0
python tools/rebuild/draftguru/bridge_import_gate.py plan
#   expect: every hash identical to step B; import_batches_before = B + 1 (the dry-run's failed
#           row, error "DryRunComplete: "); PLAN: OK. Record this import_batches_before as N.

# --- F. Import (the only writing step) ------------------------------------------------------
python tools/rebuild/draftguru/import_draftguru.py --no-seed --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json
#   expect the same authority lines, no REFUSED, exit 0

# --- G. Post-import verification (read-only) -------------------------------------------------
python tools/rebuild/draftguru/bridge_import_gate.py verify --expect-after-sha256 <B> --expect-picks-after-sha256 <B> --expect-newly-linked-sha256 <B> --expect-baseline-sha256 <B> --expect-batches-before <N>
#   expect: 8.1-8.14 PASS, changes 0, persons.already_agreeing_linked_bridge 3465,
#           "VERIFY: OK -- every check held; nothing was written"; exit 0
python tools/rebuild/draftguru/bridge_import_gate.py verify --expect-after-sha256 <B> --expect-picks-after-sha256 <B> --expect-newly-linked-sha256 <B> --expect-baseline-sha256 <B> --expect-batches-before <N>
#   second run: identical summary_sha256

# --- H. Rollback command (do NOT run unless G refuses): see 11.19.4 tier 1 -------------------
python tools/rebuild/draftguru/import_draftguru.py --no-seed          # reversal, then `plan` must reproduce B's hashes
Remove-Item Env:AFLDB_IMPORT_DATABASE_URL
```

`verify` passing is the §6.1 / §6.5-on-database evidence for the person and pick levels; the
§7.4 S0–S3 exercise (reverse, reload, compare) and §6.2–§6.4 remain to be run before DEV, with
the same gate providing the S-comparisons (`plan` after a reversal = S0; `verify` after a reload
= S1).

**Files changed by this pass:** `tools/rebuild/draftguru/import_draftguru.py` (analyze placement,
docstring), `tools/rebuild/draftguru/bridge_import_gate.py` (new),
`tools/maintenance/backup-afldb-test.ps1` (new), `tests/python/draftguru_fake_pg.py` (new),
`tests/python/draftguru_import_atomicity_contract.py` (new),
`tests/python/draftguru_import_gate_contract.py` (new), `tests/draftguru-import.test.ts`,
`tests/draftguru-acquisition.test.ts`, `tools/rebuild/draftguru/README.md`, `AFLDB-ISSUE-222.md`
(this section), `AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §16, `issues.md`, `IssuesIndex.md`,
`CHANGELOG.md`. **Not done:** backup, import, Phase 3 database acceptance, §7.4 exercise, DEV,
Phase 4, any command.

#### 11.19.7 Operator-reported first Step A run — FAILED on two test defects; corrected, not rerun (2026-09-19, Fable 5.1)

No database was contacted. Passed unchanged: `draftguru_import_atomicity_contract.py` (all
checks), the bridge-resolution regression contract (all checks), `import_draftguru.py
--validate-only` (no database contacted), and every `draftguru_import_gate_contract.py` check
except 3.7. Two failures, both in test code; production code and every hash are unchanged.

1. **`draftguru_import_gate_contract.py` check 3.7** — the gate refused check 4.3 ("no stored
   draftguru person reaches a rejected AFL Tables identity"). Cause: the fixture's "benign" live
   decision linked the non-bridged person `charlie_three/1` to player **1003**, and 1003 is the
   player the fixture registers for the REJECTED identity `players/R/Rejected_Five.html` (the
   stand-in for `Craig_Somerville.html` / `David_Sullivan.html`). The gate was right: a live
   decision is human authority the importer would honour, so the gate is the only thing standing
   between a rejected identity and a stored DraftGuru link, and 4.3 must fire regardless of who
   authored the link. Correction: a fifth registered identity `players/E/Echo_Six.html` → player
   1004 (named by no bridge, ledger or rejection) is the target of the honoured live decision in
   3.7; new check **3.9** asserts that the same live decision aimed at 1003 is refused by 4.3.
   Check 4.3 in `bridge_import_gate.py` is unchanged.
2. **`tests/draftguru-import.test.ts` line 230** — the new source pin
   `/\n    analyze(...)\n\n    return 0/` assumed LF, and `readFileSync` returned CRLF on this
   autocrlf worktree. Correction: `importerSource` is normalised once (`\r\n` → `\n`) immediately
   after reading, so every existing slice/index/`toContain` pin and the new regex operate on one
   representation; the same normalisation was added to the `bridge_import_gate.py` source pin in
   `tests/draftguru-acquisition.test.ts` (its `\s*\n` patterns tolerated CRLF, but one
   representation is the rule). `import_draftguru.py` was not touched for this. The audit found
   no other new LF-only assumption: the Python contracts read no source files and hash only
   temp JSON they write themselves.

**Step A is NOT complete**; the read-only plan (Step B) has not been run. Rerun, in order, and
stop at the first failure:

```text
python -m py_compile tests/python/draftguru_import_gate_contract.py
python tests/python/draftguru_import_gate_contract.py
npx vitest run tests/draftguru-import.test.ts tests/draftguru-acquisition.test.ts -t "scripted connection|ANALYZE runs after|bridge import gate"
```

#### 11.19.8 Operator-reported real read-only plan — PLAN: OK; printed batch counter missing, corrected before backup (2026-09-19, Fable 5.1)

**Operator-reported (run by the operator, not the model):** after the §11.19.7 rerun,
`bridge_import_gate.py plan` was run against `afldb_test`. Every check passed, the output ended
`PLAN: OK -- every check held; nothing was written`, and nothing was written (read-only
connection, rolled back and closed). The five content hashes (`after_state_sha256`,
`picks_after_sha256`, `newly_linked_sha256`, `changes_sha256`, `baseline_sha256`), the
`summary_sha256`, the exact counts and the zero-conflict classification are as printed by that
run; **the operator is to paste them here from the retained output** — none is reproduced in
this section because none was supplied to the model and no value is ever invented.
Expected shape (§11.19.3): newly_linked 3,465, already_agreeing_linked_human 5,
already_agreeing_unlinked 1,587, every conflict / missing / extra / non-link / permutation class
0, authority ledger 6 / bridge 3,465 / unmatched 1,587 / seeded 0.

**Defect found before backup or dry-run:** the CLI printed neither `import_batches_before` nor
`import_batches_expected_after`, although §11.19.6 step G needs the former for
`--expect-batches-before`. Both values were already read in the plan's single read-only
snapshot (`read_target`, `BATCH_COUNT_SQL`) and were already inside the hashed summary payload;
only the `emit` lines were missing. Correction (`bridge_import_gate.py` only, no import logic
touched): section 3 now prints `import_batches_before: <n> (draftguru batches now; max id <m>)`
in both modes and, in `plan`, `import_batches_expected_after: <n + 1>`; section 8 of `plan`
repeats both beside the verdict. **Summary consequence:** none for the hash inputs — both keys
were already in the payload, so a rerun over an unchanged target reproduces the operator's
`summary_sha256` exactly; the printed lines are not hashed. (No real-run hash is pinned in code.)
Contract additions: 1.12a–c (both counters printed, equal to the summary, inside the hashed
payload), 1.13a (a second plan prints the same values), 5.1 / 5.1a (verify consumes the PRINTED
before count under its documented semantics: pass when the target holds exactly that count + 1;
verify prints `import_batches_before` and no `expected_after`). Vitest wrapper unchanged.

**State:** backup, dry-run, import and verify remain pending. Rerun, in order, then the plan:

```text
python -m py_compile tools/rebuild/draftguru/bridge_import_gate.py tests/python/draftguru_import_gate_contract.py
python tests/python/draftguru_import_gate_contract.py
npx vitest run tests/draftguru-acquisition.test.ts -t "bridge import gate"
python tools/rebuild/draftguru/bridge_import_gate.py plan
```

Expected from the plan rerun: the same five hashes and `summary_sha256` as the operator's first
real run (unchanged target), plus the two new lines; record `import_batches_before` as the value
for step G. Stop; do not proceed to backup on the strength of this section.

#### 11.19.9 `afldb_test` import COMPLETE and verified twice (operator-reported); Phase 3 / Phase 4a acceptance decision; next read-only validation (2026-09-19, Fable 5.1)

**Operator-reported evidence (every command run by the operator; the model ran nothing,
connected to nothing, and changed no canonical artefact):**

| Step | Evidence |
|---|---|
| Backup | `D:\backups\afldb\issue-222\afldb_test-20260919-051022.dump`, 23,744,832 bytes, sha256 `aa4f1cac61f4df156039ae6ce1670edd3d1790cd37589425577f7d91d24ac1a2`, `pg_restore --list` PASS. **Catalogue-readable, not restore-proven** (§11.19.4 tier 2 would prove it; needs the DEV host's `postgres` superuser). |
| Plan after the dry-run | `import_batches` 191 before the dry-run; `import_batches_before` 192 (the dry-run's retained `failed` row), expected after 193; `summary_sha256` `966897b94700a1d1b022d3ceadfec7cc288b5310482a5956ba5b0b50bc58551b`; `after_state_sha256` `4f0a2cc567d03f2660132a1cdde66aa5e006c5e1e848a2dc5db724bd726b469d`; `picks_after_sha256` `ffa7fd60a02d8caee2d9fa22b9500725e9e12fc4ca8aba1d21e94675aa400c8d`; `newly_linked_sha256` `3ff560472aa38b63a9ef28d57501e31da9cdb907cf44bcf304a42140a02471e3`; `baseline_sha256` `71178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a4`. |
| Import | role/database `afldb_import|afldb_test`; `authority: ledger 6`, `bridge 3465`, `unmatched 1587`, `seeded 0`; completed successfully. |
| Verify (run twice, digest-identical) | `summary_sha256` `32cf72a5577cc68bfc487b1b378fa5e54aa9812dd8e84f4dea560b31761eea1a`, **VERIFY: OK**; `import_batches` 193 (max id 1382); linked persons 3,470; linked picks 5,115; pick capability 75.11%; `resolved|ledger` 5, `unique|bridge` 3,465, `unmatched|ledger` 1, `unmatched|` 1,586; every planned change applied, 0 remaining changes; all 1,589 withheld persons unlinked by the bridge; Craig Somerville and David Sullivan did not re-enter; baseline digests unchanged; no duplicate person or target; no batch left running. |

This is the runbook's **S1** state. The pre-import plan (S0 → S1 prediction) and this verify
(S1 observed) agree on all four content hashes.

**Phase 3 acceptance — decision.** The Phase 3 gate (§5 Phase 3) is: the §3.5 review completed
and recorded on the parent with 0 failures at the chosen n; the withheld lists reviewed; the
datasets and review records committed. The first two are **satisfied** (§6.5 via Phase F,
ACCEPTED, bound 0.4997%; the 83-row adjudication pack and the 94 `target_not_registered`
explained in handoff §10.3 and tracked as ISSUE-224). The third is **pending the operator's
commit** — everything since `ebea0d4c` is uncommitted. Phase 3 is therefore accepted on evidence,
subject to that commit.

**Phase 4a database acceptance — decision: NOT yet satisfied.** Its gate (§5 Phase 4a / §7.1)
is §6.1–§6.5, §6.7, §6.8 items 1–4 and the §7.4 reversal exercise. Satisfied by this run: §6.1
person level and cross-level consistency (verify 3.4, 8.1–8.3, totals); §6.4 bullets 1–3 and
the confirmed-unlinked control (verify 8.4, 8.1/8.9, 8.8); §6.5; §6.7 stated (5,115 × 2 >
6,810 — the corpus now scores the draft criteria natively, so the `AFLDB_GRIDLEY_SCORE_DRAFT`
override is a no-op per §6.3 item 5; the suite comment is a Phase 5 item); §6.8 item 1 in part
(the DraftGuru DB-free suites and contracts; `tsc --noEmit` / eslint not yet reported).
Outstanding: §6.1 pick-level per-cell capability statement; §6.2; §6.3 (corpus known-answer
evaluation with every draft-criterion finding triaged); §6.4 remaining controls (trade /
free-agency `pick_number`, Sam Chapman outcome, convergence-pair listing); §6.8 items 2–4; the
§7.4 S0–S3 exercise. **No DEV or PROD claim is made.** ISSUE-224 stays open; none of its 94
persons (Hussien El Achkar included) was added.

**Dry-run message corrected (production code, message only).** `--dry-run` printed "the
transaction was rolled back; nothing was written", but `import_batch()` retains a committed
`failed` batch row with error `DryRunComplete: ` (visible in this very run: `import_batches`
was **191 before the dry-run, 192 after it** — the value the post-dry-run plan printed — and
**193 after the real import**; an earlier draft of this section wrongly wrote "192 → 193 between
the two plans"). `import_draftguru.py` now prints `DRY_RUN_MESSAGE`: every data write rolled
back (`draft_persons`, `draft_picks`, `external_identities`, `players` unchanged) and the
`import_batches` audit row retained with status `failed` and that error. Contract checks
3.5–3.7 in `draftguru_import_atomicity_contract.py` pin the message to the scripted log
(status and error text the message names are the ones the fake recorded);
`tests/draftguru-import.test.ts` pins the source. Import logic untouched.

**Read-only versus mutating validation paths on `afldb_test` (inspected from source):**

| Path | Effect on `afldb_test` | Use |
|---|---|---|
| `bridge_import_gate.py verify` | read-only (server-asserted) | done; the S-comparator |
| `tests/integration/draft-linkage.test.ts` (new) | SELECT only by construction; no fixture, no cleanup; owner DSN, so read-only is by review, not server enforcement | §6.1 both levels, §6.4 remaining controls, §6.2 coverage printed, the six draft builders and `solveCellSummary` on the real population |
| `tools/rebuild/draftguru/afldb_test_draft_linkage_checks.sql` (new) | one `READ ONLY` transaction, rolled back; `PGOPTIONS` makes the session read-only server-side | the same facts as psql output for the closeout record |
| `tests/integration/gridley-corpus.test.ts` | SELECT only (solver runs); the only write is the optional `AFLDB_GRIDLEY_REPORT` file, outside the repository; ~15 min | §6.3 known-answer evaluation; `AFLDB_GRIDLEY_DIAGNOSTIC=1` keeps dataset gaps as findings |
| `tests/integration/grid-solver.test.ts` | **MUTATES**: seeds a 2097 wildcard season and the ISSUE-221 draft fixture, deletes them in `afterAll`; sequences advance and a failed cleanup would change the verify baseline | builder semantics only (§6.3 item 1); not a verification step for this import |
| `tests/integration/draftguru-import.test.ts` | **MUTATES**: runs the importer | §6.8 item 2 only, after the §7.4 exercise |
| importer reversal / reload, `db:test:rebuild` | **MUTATES** by design | the §7.4 exercise (reversal → `plan` must reproduce the pre-import hashes = S2 ≡ S0; reload → `verify` with the same hashes = S3 ≡ S1) / never as verification |

**Next safe, read-only functional validation (worktree root, PowerShell, tunnel up; nothing here
writes to the database):**

```powershell
# DB-free first
python -m py_compile tools/rebuild/draftguru/import_draftguru.py tests/python/draftguru_import_atomicity_contract.py
python tests/python/draftguru_import_atomicity_contract.py
npx vitest run tests/draftguru-import.test.ts -t "dry-run|scripted connection|ANALYZE runs after"
npx tsc --noEmit -p .

# read-only, against afldb_test
if (-not $env:AFLDB_TEST_DATABASE_URL) { $env:AFLDB_TEST_DATABASE_URL = ((Get-Content .env | Where-Object { $_ -like 'AFLDB_TEST_DATABASE_URL=*' } | Select-Object -First 1) -replace '^AFLDB_TEST_DATABASE_URL=', '').Trim() }
$env:PGOPTIONS = '-c default_transaction_read_only=on'
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -X -v ON_ERROR_STOP=1 -f tools/rebuild/draftguru/afldb_test_draft_linkage_checks.sql -d $env:AFLDB_TEST_DATABASE_URL
Remove-Item Env:PGOPTIONS
npx vitest run tests/integration/draft-linkage.test.ts
$env:AFLDB_GRIDLEY_DIAGNOSTIC = '1'
$env:AFLDB_GRIDLEY_REPORT = 'D:\backups\afldb\issue-222\gridley-corpus-20260919.json'
npx vitest run tests/integration/gridley-corpus.test.ts
Remove-Item Env:AFLDB_GRIDLEY_DIAGNOSTIC
Remove-Item Env:AFLDB_GRIDLEY_REPORT
```

Expected: the SQL file prints `afldb_test | … | on` first and every "Expected" annotation holds
(5057 / 6810 / mismatched 0 / linked 5,115 / 75.11 / 0 shared players / 0 rejected reach /
`aaron_bruce/1` unmatched / 0 pick-number violations / probe true / newest batch `completed`);
`draft-linkage.test.ts` green with its `[draft-linkage]` lines recorded here (top-10 coverage
by year, the six builder counts, the populated national-top-10 cell); the corpus run's
`[gridley-corpus]` findings with every draft-criterion finding triaged per §6.3 item 4 (linkage
→ blocks; builder semantics → new issue; Gridley key → recorded). Record the outputs in this
section before the §7.4 exercise.

**Remaining Phase 4 / DEV steps, in order (stop before `afldb_dev`):** (1) the read-only
validation above and its record; (2) §6.3 triage; (3) the §7.4 exercise on `afldb_test`
(reversal → `plan` reproduces `966897b9…`'s hashes; reload → `verify` reproduces
`32cf72a5…`'s checks), then §6.8 item 2's mutating suites; (4) eslint; (5) operator commit of
datasets, tooling and records, `merge:ready`, push/merge (deploy is a git pull); (6) DEV Phase 0
Q5/Q6/Q7 read-only exports on the host (registration count, live decisions, manual picks and
overrides); (7) the DEV child via `export_person_bridge.py --resolve-against dev` (new hash;
`validate_person_bridge_child.py` and `bridge_import_gate.py` are pinned to `afldb_test` and
need a reviewed DEV-target mode before use — a tooling step, not built here); (8) DEV backup
(`backup.sh`), then §7.2: `--validate-only` → `--dry-run` → real run → verify → build/restart →
§6.6 browser checks. PROD only after the DEV soak (§7.3). **None of (5)–(8) is authorised by
this section.**

**Files changed by this pass:** `tools/rebuild/draftguru/import_draftguru.py` (`DRY_RUN_MESSAGE`),
`tests/python/draftguru_import_atomicity_contract.py` (3.5–3.7), `tests/draftguru-import.test.ts`
(message pin), `tests/integration/draft-linkage.test.ts` (new, read-only),
`tools/rebuild/draftguru/afldb_test_draft_linkage_checks.sql` (new, read-only), this file,
`AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §17, `issues.md`, `IssuesIndex.md`,
`tools/rebuild/draftguru/README.md`, `CHANGELOG.md`. `AFLDB-ISSUE-221.md` untouched.

#### 11.19.10 Read-only application validation run (operator-reported) — SQL checks PASS, `draft-linkage` 10/11, one FALSE failure traced to a query fan-out and corrected; Phase 4a still pending (2026-09-19, Fable 5.1)

**Operator-reported (run under `default_transaction_read_only=on`; no database write occurred;
the model ran nothing):** the DB-free checks passed. `afldb_test_draft_linkage_checks.sql`
passed every assertion: 5,057 persons, 6,810 picks, 3,470 linked persons, 5,115 linked picks,
75.11% capability, probe crossed, newest batch 1382 `completed` (the real import), 1381 `failed`
(the dry-run's retained audit row). `tests/integration/draft-linkage.test.ts` passed 10 of 11:
all six production draft builders returned non-empty sets — national top-10 388, pick 1 41,
any-kind top-10 789, rookie 644, traded ≥ 1 868, father-son 94, drafted 2001 90 — and the
ISSUE-221 cell (national top-10 × any career) is populated with 388 eligible players. The one
failure was "every bridge-linked person's player carries exactly the href the child asserts",
reporting `jack_graham/3` joined to `players/J/Jack_Graham.html`, `jack_ross/3` to
`players/J/Jack_Ross.html`, `jack_williams/8` to `players/J/Jack_Williams.html`,
`charlie_cameron/4` to `players/C/Charlie_Cameron.html`. The Gridley corpus did not run because
the enclosing command block stopped at that failure.

**Investigation (repository artefacts and code only):**

| DraftGuru person | Child asserts (`data/reference/…v2.afldb_test.json`) | Failing query showed | Same human? |
|---|---|---|---|
| `charlie_cameron/4` | `players/C/Charlie_Cameron3.html` | `players/C/Charlie_Cameron.html` | yes — rule `2025-charlie-cameron-renumbered-profile` (AFL Tables ID 12277, career game 229 → 230, 2024 → 2025) |
| `jack_graham/3` | `players/J/Jack_Graham2.html` | `players/J/Jack_Graham.html` | yes — `2025-jack-graham-renumbered-profile` (ID 12576, game 131 → 132) |
| `jack_ross/3` | `players/J/Jack_Ross3.html` | `players/J/Jack_Ross.html` | yes — `2025-jack-ross-renumbered-profile` (ID 12712, game 70 → 71) |
| `jack_williams/8` | `players/J/Jack_Williams3.html` | `players/J/Jack_Williams.html` | yes — `2025-jack-williams-renumbered-profile` (ID 12962, game 29 → 30) |

1. **Why the query returned the other identity.** `tests/integration/draft-linkage.test.ts`
   (the block at line ~108) joined `draft_persons.player_id` to **every** `external_identities`
   row of that player under source `afltables` / `afltables_profile_url` / `unique|resolved`,
   then compared each row's `external_id` with the child's href. For these four players that
   join fans out to two rows: the continuing (ID-bearing) path and the renumbered path. The
   renumbered row matched the child; the continuing row did not and was reported. The stored
   link itself was never wrong.
2. **Can a canonical player carry two AFL Tables identities?** Yes, by design.
   `external_identities` is unique on `(source_id, external_id)`, not on `player_id`.
   `import_fitzroy_core.py` (the "AFL Tables external identities" block, ~line 2762) registers
   **every** profile path of a player folded under a tracked `profile_url_continuity` rule to the
   one `players.id` — "the population is one row per path" — with the renumbered row's `notes`
   naming the rule and the continuing path. The four rules live in
   `tools/rebuild/fitzroy/fitzroy-contract.json`, each bound to the AFL Tables ID on the
   continuing profile, non-overlapping seasons and `Career.Games` continuing by exactly one
   (ISSUE-136, DB-validated 2026-09-04). These are AFL Tables' own renumberings of one person —
   not aliases, not redirects, not a registration conflation. DraftGuru's person page links the
   live (renumbered) url, which is why the child asserts the suffixed path.
3. **Why gate check 8.4 passed.** `verify` 8.4 walks the child in the identity → player
   direction: `afl_players[child target]` must be exactly one player and must equal the
   person's stored `player_id`, with `unique` / bridge method / the bridge note. Each renumbered
   path is registered exactly once, so 8.4 (and the exporter's `--resolve-against`, which
   counts rows per `external_id`) never saw an ambiguity; 8.8 confirmed no canonical player is
   claimed by two persons. The gate was right; the new test's join direction was wrong.
   **No stored link is incorrect; no rollback is indicated.**

**Correction (test code only; production code and every canonical artefact unchanged):**
`tests/draft-linkage-invariants.ts` (new, pure, no database import) holds the invariant as a
function: for every admitted child bridge, the child's exact `afltables_external_id` is
registered **exactly once** under `afltables` / `afltables_profile_url` (`missing` /
`ambiguous` otherwise), that row's `player_id` equals the DraftGuru person's stored
`player_id` (`wrongPlayer`), and the person stores `unique` + the bridge method unless it is
a decided person — ledger or live — which must store `resolved` + the ledger method
(`wrongState`). Separately, every linked player carrying more than one AFL Tables path is
**reported** (`multiIdentity`) and must be **explained** by a tracked continuity rule whose
pair is exactly that player's two paths, with the child target on the pair; anything else is
`unexplained` and fails. `tests/integration/draft-linkage.test.ts` now queries the three row
sets directly (registrations for the child targets, the bridged persons, every path of the
linked players) and asserts all five lists empty plus `decided` = bridges minus expected
bridged. `tests/draft-linkage-invariants.test.ts` (new, DB-free) pins the exact fan-out shape
— a player with two paths, child naming the renumbered one — as a pass with the rule named,
shows the old comparison would have flagged the continuing path, and proves `wrongPlayer`,
`missing`, `ambiguous`, `wrongState`, an unexplained second path and a third path off the
rule pair each still fail. If a future database registers a second path with no tracked rule,
the integration test keeps failing and names the player: that is a fitzRoy registration defect
to raise, not a bridge defect.

**Expected on rerun:** 11/11, with the `[draft-linkage]` line listing exactly the four
players above as `explained: true` with their rule ids. **Phase 4a remains pending** (§6.3
corpus triage, §7.4 exercise and the rest of §11.19.9's list); nothing else changes.

```powershell
# DB-free
npx tsc --noEmit -p .
npx vitest run tests/draft-linkage-invariants.test.ts
# read-only, targeted rerun (owner DSN; SELECT-only by construction)
npx vitest run tests/integration/draft-linkage.test.ts
# then, unchanged from §11.19.9: the Gridley corpus in diagnostic mode
```

#### 11.19.11 Gridley corpus run (operator-reported, read-only) — 1,163/1,166; §6.3 triage of the 99 `incorrect known answer` cells: 62 draft cells on nine linked players (three causes), 37 pre-existing non-draft cells; two 2026 embedded players unregistered; corrections prepared, no reclassification; Phase 4a still pending (2026-09-19, Fable 5.1)

**Operator-reported evidence (the model ran no Python, Node, Vitest, Git, database, network,
import, rollback or deployment command; the only command the model executed was `Get-FileHash`
on the report file, to honour the instruction to refuse analysis on a hash mismatch):**

| Item | Evidence |
|---|---|
| Run | `tests/integration/gridley-corpus.test.ts`, `AFLDB_GRIDLEY_DIAGNOSTIC=1`, against `afldb_test` with server-enforced `default_transaction_read_only=on`. **No database write. No rollback.** The real import (S1, verify `32cf72a5…`) stands. |
| Result | **1,163 passed / 3 failed of 1,166**; 10,161 of 10,287 cells solved; 1,143 boards. |
| Report | `D:\backups\afldb\issue-222\gridley-corpus-20260919.json`, 8,814,976 bytes, **sha256 `7f14ff2ca5c52afb42032dc74e5dc541ad507c7cb0368055efee9934da6f27ed`** (operator-confirmed independently; recomputed by the model before analysis: match). Analysis is refused if the bytes no longer match. |
| Findings by category | time of board 21,240; list membership 1,223; external source disagreement 383; **incorrect known answer 99**; unsupported 78 (the seven §23.36 deferrals); adjudicated source conflict 63; source coverage gap 54; dataset gap 42 (all match-event criteria: `bigfreeze-playedin-1`, `dreamtime-playedin-1`, `anzac-playedin-1` — this `afldb_test` carries no `matches.match_event`, pre-existing, not a draft matter); parse 6. |
| Draft probe | crossed natively (5,115 × 2 > 6,810); `AFLDB_GRIDLEY_SCORE_DRAFT` not needed. The six draft criteria were scored cell by cell for the first time. |

**The three failures.**

- **A — `willem-duursma-teammate-13491` / `jagga-smith-teammate-13333`: "override …/2026 matched
  0 players"** (the `criteria` test's `unresolvedLog`). Both are parse-classified on their boards
  (#990 ×3, #992 ×3 = the 6 `parse` cells).
- **B — embedded-bridge count 399, expected 401**: the same two players (the `bridges` test
  counts `bridge.size + gappedBridges`; an *unresolved* reference is neither).
- **C — 99 `incorrect known answer` cells.** The first 40 listed were all draft cells; the full
  report holds 62 draft cells and 37 non-draft cells (§ below).

**Same failures as the 2026-09-17 record.** `issues.md` (ISSUE-221 closeout, 2026-09-17) recorded
exactly these three failures on the pre-import `afldb_test`: the two 2026 debutants (399 vs 401,
6 `parse`) and **37 `incorrect known answer` cells "all on `captain`, `teammates-100/150`,
`games100clubs2` and `clubbestfairest` pairs"**, with the six draft criteria still `dataset gap`.
The import therefore changed the corpus in exactly one way: 280 draft cells left `dataset gap`
(322 → 42) and were scored, producing **62 new draft findings**; nothing else moved.

**Task 1/5 — the 99 cells grouped (every cell is "Gridley lists, AFLDB omits"; no cell is
"AFLDB lists, Gridley omits"):**

| Gridley criterion (→ AFLDB axis) | Gridley id = AFLDB id, name | Cells | Boards / cells | Cause (one per row) |
|---|---|---|---|---|
| `pickrookie` → `draft_type_is(rookie)` | 39 = 57 Adam Schneider | 3 | #81 2-0, 2-1; #151 2-2 | R (below) |
| | 4580 = 8350 Lachie Henderson | 3 | #81 2-1; #151 2-2; #169 2-1 | R |
| | 5956 = 10673 Phil Davis | 4 | #81 2-1; #151 2-2; #169 2-0, 2-2 | R |
| | 6501 = 11672 Sam Reid (Sydney, debut 2010) | 2 | #81 2-1; #151 2-2 | R |
| | 4829 = 8793 Lewis Taylor | 1 | #151 2-2 | R |
| | 5769 = 10348 Paul Seedsman | 2 | #151 2-2; #169 2-0 | R |
| | 5307 = 9575 Michael Rischitelli | 3 | #81 2-1, 2-2; #151 2-2 | R |
| | 1319 = 2443 Bryce Gibbs | 5 | #81 2-1, 2-2; #151 2-2; #169 2-0, 2-1 | R |
| `picktop5` → `national_draft_pick_between(1,5)` | 1089 = 2054 Brad Crouch | 1 | #573 0-2 | M (below) |
| `picktop10` → `national_draft_pick_between(1,10)` | 1089 = 2054 Brad Crouch | 38 | #575 ×2, #604 ×2, #611, #634, #656, #710, #714 ×2, #728 ×2, #737, #784 ×2, #847 ×2, #868 ×2, #890 ×2, #894, #898, #906, #948, #950, #966, #978, #992, #1017 ×2, #1030, #1059 ×2, #1099, #1115 ×2, #1117 | M |
| **draft subtotal** | **9 players** | **62** | | |
| `captain` → `club_captain_any` | 1350 = 2489 Cameron Bruce | 11 | #908, #919 ×2, #923, #938, #948, #988, #1005, #1140 ×3 | pre-existing (2026-09-17), not draft, not ISSUE-222 |
| | 6788 = 12093 Steven May | 9 | #938, #988 ×2, #1005, #1111 ×2, #1140 ×3 | pre-existing |
| `teammates-150` → `career_teammates_min(150)` | 1359 = 2502 Cameron Mooney; 3211 = 5927 Hugh Greenwood (×2); 41 = 59 Adam Simpson; 6173 = 11061 Robbie Tarrant; 1141 = 2126 Braydon Preuss (×2); 4287 = 7870 Josh Gibson; 1846 = 3305 Darcy Tucker (×2); 1130 = 2111 Brandon Matera (×2); 1128 = 2109 Brandon Ellis; 3507 = 6461 Jack Newnes | 14 | #1024 0-0 ×7, 0-1 ×3, 0-2 ×4 | pre-existing |
| `teammates-100` → `career_teammates_min(100)` | 379 = 669 Angus Brayshaw | 1 | #993 0-1 | pre-existing |
| `games250sameclub` → `games_at_one_club_min_incl_merged(250)` | 2012 = 3581 David Swallow | 1 | #938 0-1 | pre-existing |
| `games100clubs2` → `games_at_multiple_clubs_min_incl_merged(100,2)` | 2269 = 4006 Dylan Shiel | 1 | #967 0-2 | pre-existing |
| **non-draft subtotal** | **14 players** | **37** | | |
| **total** | **23 players** | **99** | | |

So the 99 do **not** reduce to the nine draft players: 62 do; the other 37 are the 2026-09-17
non-draft residue on 14 other players, untouched by (and outside) ISSUE-222. They have no owning
issue of their own (ISSUE-118 closed with 0; they appeared with the 2026-09-13 `afldb_test`
baseline) — an operator decision, D3 below.

**Task 2 — the two 2026 embedded players (Failure A/B).** Evidence from repository artefacts:

| | Willem Duursma | Jagga Smith |
|---|---|---|
| DraftGuru person | `willem_duursma/1`, 2025 National pick 1 West Coast, title "born 2007", 22 games at the Aug-2026 capture | `jagga_smith/1`, 2024 National pick 3 Carlton, title "born 2006", 23 games |
| Captured AFL Tables href | `players/W/Willem_Duursma.html` | `players/J/Jagga_Smith.html` |
| v2 parent | admitted (`bridge-v2-parent-20260918-v1.csv`: accepted, unchanged) | admitted |
| `afldb_test` child | **withheld `target_not_registered`** (`bridge-population-scan-20260918-v2.csv` row 3524; verdicts v1/v2 row 394, census, `TARGET_NOT_REGISTERED`) | **withheld `target_not_registered`** (scan row 1433; verdicts row 167) |
| Corpus resolver | override `Willem Duursma/2026` → `hit.length 0` and **not** routed to the gap branch | same |

The resolver's gap branch fires only when `override.debutSeason > maxSeason` (`max(season) FROM
matches`). Failure A proves `maxSeason ≥ 2026` on this `afldb_test` (2026 matches are present),
while no player named Duursma/Smith with a 2026 debut exists in `players`. Both identities are
absent from `external_identities` on the target (that is what `target_not_registered` measured),
and ISSUE-224 records that the accepted fitzRoy 13,275-URL set (= `afldb_test`'s registered set)
covers 1897–2025 only. **Classification: player-registration gap — AFLDB-ISSUE-224 owns it;** not
season freshness (the season is there), not a bad override (the names and debut seasons are right
by DraftGuru's own page), not a bridge defect (the parent admits both; the child withholds them by
the fail-closed rule). The corpus reported a register gap as an override mismatch — a test/corpus
defect, corrected below.

*Encoding, tested explicitly, not assumed.* "JaggaáSmith" is the cp850 console rendering of
U+00A0: DraftGuru renders every player name with a no-break space (`display_names_raw`
`"Jagga\u00a0Smith"`, `"Willem\u00a0Duursma"`, `"Lachie\u00a0Henderson"`, …). That text is
source payload on the DraftGuru side; the bridge is keyed by the AFL Tables href, and the corpus
resolver compares Gridley's ASCII title with **AFLDB's** `players.display_name` / given + surname —
DraftGuru names never enter that comparison. The NBSP is therefore **not** the cause of Failure A.
It did expose a latent defect: `normalisePlayerName` stripped a NBSP as a non-`[a-z0-9 ]`
character, fusing "Jagga Smith" into `jaggasmith`, so a register that *did* hold an NBSP-spelt
name could never have matched. Fixed (production one-liner, below) and pinned. The one fact only
the database can supply — that no `players` row spells either name with an NBSP — is the first
read-only query in the rerun block.

**Task 3 — the eight `pickrookie` players.** Gridley's criterion text: *"Player has been selected
in a Rookie Draft (1996 to present)."* AFLDB maps it to `draft_type_is(rookie)` = a trusted-linked
`draft_picks` row with `draft_kind = 'rookie'`. Every one of the eight is **bridged and linked**
(`offline_strong`, `population_clean`, `retain_bridge`; present in the `afldb_test` child), so the
disagreement is not a link gap. Their complete DraftGuru event rows (Stage A
`annual-html-20260826/parsed/rows.jsonl`, the rows the import stores):

| AFLDB id | Canonical name | DraftGuru person | Every DraftGuru event row (`draft_year` `event_type_raw` → `draft_kind`, pick, club) | Rookie row? |
|---|---|---|---|---|
| 57 | Adam Schneider | `adam_schneider/1` | 2001 National → `national` pick 60 Sydney; 2007 Trade → `trade` St Kilda | no |
| 8350 | Lachie Henderson | `lachie_henderson/1` | 2007 National pick 8 Brisbane; 2009 Trade Carlton; 2015 Trade Geelong | no |
| 10673 | Phil Davis | `phil_davis/1` | 2008 National pick 10 Adelaide; 2011 Pre-Draft → `pre_draft` GWS (signing `Uncontracted`) | no |
| 11672 | Sam Reid (Sydney, b. 1991) | `sam_reid/3` (→ `Sam_Reid2.html`) | 2009 National pick 38 Sydney | no |
| 8793 | Lewis Taylor | `lewis_taylor/1` | 2013 National pick 28 Brisbane; 2019 Trade Sydney | no |
| 10348 | Paul Seedsman | `paul_seedsman/1` | 2010 National pick 76 Collingwood; 2015 Trade Adelaide | no |
| 9575 | Michael Rischitelli | `michael_rischitelli/1` | 2003 National pick 61 Brisbane; 2010 Pre-Draft Gold Coast | no |
| 2443 | Bryce Gibbs | `bryce_gibbs/1` | 2006 National pick 1 Carlton; 2017 Trade Adelaide | no |

None has a Rookie event on the linked page, and no second DraftGuru person (`/2`) exists for any
of them in `persons.jsonl`. All eight share one profile: a nationally drafted player who changed
club and finished his career at a second (or third) club — the profile of a **late-career rookie
re-listing** (delisted and re-selected in the Rookie Draft by the same club). DraftGuru *does*
record such re-listings when its annual page carries them: the other Sam Reid (`sam_reid/2`, GWS)
has **2015 Rookie pick 8 GWS** after 2007 National / 2011 Pre-Draft. So the linked source is
inconsistent, not the mapping. **Classification: DraftGuru source coverage gap** (missing source
rows for late-career rookie re-listings) *if* each re-listing is a fact, which the repository
cannot prove offline — the alternative for any individual is Gridley's own key. It is not an
event-vocabulary mapping (`Rookie` → `rookie` is contract-exact and the GWS Sam Reid row proves
the path), not a semantic difference in the criterion, not a wrong link, and not a builder defect
(`draft-linkage.test.ts` reports `rookie` = 644 players). Under §6.3 item 4 this is the "explicitly
adjudicated as a source gap with the outcome code recorded" branch — an operator decision (D2).

**Task 4 — AFLDB 2054 Brad Crouch (`picktop5` ×1, `picktop10` ×38).** Gridley: *"Player was a top
10 [top 5] pick in the National Draft. Includes drafts from 1981 to present."* DraftGuru
`brad_crouch/1` (→ `players/B/Brad_Crouch.html`, bridged `offline_strong`, `retain_bridge`, in the
child, linked): **2011 Mini-Draft → `mini_draft` pick 2 Adelaide** (row 4434; age 17, the GWS
17-year-old mini-draft) and 2020 Free Agency → `free_agency` St Kilda. No National row.
`national_draft_pick_between` requires `draft_kind = 'national'` (and `pick1`/`picktop5`/
`picktop10` are deliberately national-only, `tests/gridley-compat.test.ts`), so the pick-2 row is
excluded. **Classification: Gridley's own key against DraftGuru's event taxonomy** — Gridley
counts the 2011 mini-draft as a National Draft pick; the source records another event kind, and
Gridley's own description says "National Draft". Not an ISSUE-222 bridge gap (linked), not
ISSUE-224 (registered), not a source omission (the row is present), not a builder defect
(`draft_pick_between(1,10)`, any kind, includes him — the "any-kind top-10 789" count). Consistent
internally: he is in TOP 5 and TOP 10 but not PICK 1. Under §6.3 item 4: "Gridley's own key —
recorded as `external source disagreement` with evidence" — an operator decision (D1), not made
automatically here.

**Task 6 — smallest evidence-correct fixes, kept separate:**

| Class | Finding | Fix |
|---|---|---|
| test/corpus mapping defect | resolver treats a register gap as an override mismatch (Failure A/B) | **done** — `buildResolver` (now pure, `tests/gridley-corpus-support.ts`) routes a 0-hit override to the gap log when no player of that name exists AND no player on the database debuted after the override's season (register horizon), with an ISSUE-224 message; a namesake, or a register that does reach the season, stays unresolved and fails. `gaps.registerSeason` added to the probe; the "complete database" assertion requires both horizons ≥ 2026. |
| test/corpus mapping defect (latent) | `normalisePlayerName` deletes a NBSP and fuses the name | **done** — every Unicode space folds to a space before the strip (`src/search/gridley-compat.ts`, one line). |
| triage evidence (no reclassification) | draft findings carried no cause | **done** — the suite reads every trusted-linked `draft_picks` row once (SELECT, `LEFT JOIN clubs`) and appends `draft triage [cause]: …` to a draft-criterion finding's detail: `unlinked` / `satisfied` / `non_national_pick_in_range` / `no_linked_row_matches` / `unassessed`. **Category unchanged.** |
| DraftGuru source / event taxonomy | Crouch's mini-draft pick; the eight missing Rookie rows | **not changed** — D1/D2 are operator decisions; no classifier rule, no blanket exception, no assertion weakened. |
| player registration | Duursma, Smith (and the other 92) | **ISSUE-224**, unchanged. |
| trusted-link gaps | none found: all nine draft players are bridged and linked | — |
| genuinely incorrect Gridley answers | Crouch (by Gridley's own description) is the one candidate; the eight rookie cells are more likely source omissions | recorded, not asserted. |

**Task 7 — DB-free regression tests** (`tests/gridley-compat.test.ts`, new describe "Gridley
corpus support (AFLDB-ISSUE-222)" + one NBSP case in the normalisation test): the register-gap
routing (2026 matches, 2025 register → gap naming ISSUE-224; database ending 2025 → the original
gap; a register holding a 2026 debut → unresolved; a namesake → unresolved; an override that hits
→ resolves; a duplicate plain name → unresolved with ids); `normalisePlayerName('Jagga\u00a0Smith')
=== 'jagga smith'`; the triage on the exact row shapes — Crouch → `non_national_pick_in_range`
(TOP 5 / TOP 10), `no_linked_row_matches` (PICK 1), `satisfied` (any-kind 1–10, `Mini-Draft`
kind); Henderson → `no_linked_row_matches` (rookie) but `satisfied` (top 10, traded ≥ 1); GWS Sam
Reid's real 2015 Rookie row → `satisfied`; no rows → `unlinked`; `drafted_by_club` → `unassessed`.

**Task 8 — state.** Corpus ran read-only; 1,163/1,166; 99 `incorrect known answer` cell findings
pending triage decisions (62 draft / 9 players, 37 pre-existing non-draft / 14 players); two
unresolved 2026 embedded players (ISSUE-224); **Phase 4a remains pending** (§6.3 item 4 decisions
D1/D2, §6.1 pick level, §6.2, remaining §6.4, §6.8 items 2–4, §7.4); **no database write, no
rollback**; the real import stands; ISSUE-224 open; no canonical bridge artefact touched.
**Phase 4a acceptance is NOT claimed.**

**Operator decisions required:**

- **D1 (Crouch, 39 cells):** accept "Gridley's own key" for `picktop5`/`picktop10` on a linked
  player whose only pick inside the range is a non-national event (`non_national_pick_in_range`),
  to be recorded as `external source disagreement` with the row named — a classifier rule to add
  only on this decision; or keep the 39 cells failing.
- **D2 (eight rookie players, 23 cells):** confirm each late-career rookie re-listing against an
  independent source (or refute it), then decide the representation: (a) a tracked supplement
  artefact for source-omitted draft events (does not exist; a new issue), (b) record a DraftGuru
  source coverage gap with an outcome code per person and classify `no_linked_row_matches` rookie
  cells as `source coverage gap` (still fails strict), or (c) Gridley key error per person. None
  is implemented.
- **D3 (37 pre-existing non-draft cells, 14 players):** open a separate issue (they predate
  ISSUE-222; ISSUE-118 closed at 0) or accept them as the known `afldb_test` baseline residue.
- **D4:** whether to run the register query below before accepting the resolver correction as
  the explanation of Failure A/B.

**Validation commands.** DB-free (no database, no network):

```powershell
npx tsc --noEmit -p .
npx vitest run tests/gridley-compat.test.ts tests/draft-linkage-invariants.test.ts
npx eslint tests/gridley-corpus-support.ts tests/gridley-compat.test.ts tests/integration/gridley-corpus.test.ts src/search/gridley-compat.ts
```

Targeted read-only `afldb_test` reruns (tunnel up; `PGOPTIONS` makes the psql session read-only
server-side; the vitest run is SELECT-only by construction):

```powershell
if (-not $env:AFLDB_TEST_DATABASE_URL) { $env:AFLDB_TEST_DATABASE_URL = ((Get-Content .env | Where-Object { $_ -like 'AFLDB_TEST_DATABASE_URL=*' } | Select-Object -First 1) -replace '^AFLDB_TEST_DATABASE_URL=', '').Trim() }
$env:PGOPTIONS = '-c default_transaction_read_only=on'
# 1. the register facts behind Failure A/B (expected: max_match_season 2026, max_debut_season 2025, no NBSP names, 0 rows for both players and both hrefs)
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -X -v ON_ERROR_STOP=1 -d $env:AFLDB_TEST_DATABASE_URL -c "SELECT (SELECT max(season) FROM matches) AS max_match_season, (SELECT max(debut_season) FROM player_career_stats) AS max_debut_season, (SELECT count(*) FROM players WHERE display_name ~ E'\u00a0' OR given_name ~ E'\u00a0' OR surname ~ E'\u00a0') AS nbsp_names;" -c "SELECT p.id, p.display_name, c.debut_season FROM players p LEFT JOIN player_career_stats c ON c.player_id = p.id WHERE p.surname IN ('Smith','Duursma') AND p.given_name IN ('Jagga','Willem');" -c "SELECT ei.external_id FROM external_identities ei JOIN sources s ON s.id = ei.source_id WHERE s.key = 'afltables' AND ei.external_id IN ('players/J/Jagga_Smith.html','players/W/Willem_Duursma.html');"
# 2. the nine players' linked rows as the database holds them (expected: Crouch 2011 mini_draft 2 + 2020 free_agency; no rookie row for the eight)
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -X -v ON_ERROR_STOP=1 -d $env:AFLDB_TEST_DATABASE_URL -c "SELECT dp.player_id, p.display_name, dp.draft_year, dp.draft_kind, dp.pick_number, dp.link_status_value FROM draft_picks dp JOIN players p ON p.id = dp.player_id WHERE dp.player_id IN (57,8350,10673,11672,8793,10348,9575,2443,2054) ORDER BY dp.player_id, dp.draft_year;"
Remove-Item Env:PGOPTIONS
# 3. the corpus criteria block only (beforeAll + 5 criteria tests, ~2 min; expected: 5/5 — unresolvedLog empty, the two 2026 refs in the gap log, bridges 399 + 2 gapped = 401)
$env:AFLDB_GRIDLEY_DIAGNOSTIC = '1'
npx vitest run tests/integration/gridley-corpus.test.ts -t "Gridley corpus -- criteria"
Remove-Item Env:AFLDB_GRIDLEY_DIAGNOSTIC
```

**Must the full five-minute corpus be rerun now?** No. Failure A/B and the resolver correction are
proven by block 3 (the criteria tests run on the same `beforeAll`). Failure C's 99 cells are
unchanged by anything done here (no category moved); rerunning the cell pass now would reproduce
the same 99 with the triage evidence appended to the 62 draft details. **One** full diagnostic
rerun (`AFLDB_GRIDLEY_REPORT` to a new dated file) belongs after D1–D3 are decided and any
classifier rule they authorise is implemented — that run is the §6.3 closure evidence.

**Files changed by this pass:** `tests/gridley-corpus-support.ts` (new, pure),
`tests/integration/gridley-corpus.test.ts` (resolver/overrides moved out; `registerSeason` probe;
linked-draft-rows query; triage evidence appended; comments), `tests/gridley-compat.test.ts`
(DB-free regressions), `src/search/gridley-compat.ts` (`normalisePlayerName` folds Unicode
spaces), this file, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`. No canonical bridge artefact,
importer, gate, migration or database was touched.

#### 11.19.12 Operator decisions on §11.19.11 — D1 approved narrowly (implemented), D2 pending (review pack prepared), D3 → AFLDB-ISSUE-225 opened, D4 completed (registration gap confirmed); full corpus not rerun; Phase 4a still pending (2026-09-19, Fable 5.1)

**The model ran no Python, Node, Vitest, Git, database, network, import, rollback or deployment
command in this pass. No data, canonical artefact, importer, gate or database was changed.**

**D4 — APPROVED, COMPLETED.** Operator-reported result of the §11.19.11 register query on
`afldb_test` under server-enforced `default_transaction_read_only=on`:

| Fact | Value | Meaning |
|---|---|---|
| `max(matches.season)` | **2026** | the database carries the 2026 season's matches — why the resolver's match-horizon gap test did not fire |
| `max(player_career_stats.debut_season)` | **2025** | the player register ends at the accepted 2025 baseline — the horizon the corrected resolver (`gaps.registerSeason`) now reads |
| players with U+00A0 in `display_name` / `given_name` / `surname` | **0** | encoding is excluded as a cause of Failure A |
| `players` rows for Jagga Smith / Willem Duursma | **0** | neither 2026 debutant has a player row |
| `external_identities` (`afltables`) for `players/J/Jagga_Smith.html` / `players/W/Willem_Duursma.html` | **0** | neither identity is registered: exactly the child's `target_not_registered` |

This is the confirmed evidence for the ISSUE-224 registration-gap explanation of Failures A and
B. On the corrected suite both references land in the gap log ("no player on this database
debuted after season 2025 … AFLDB-ISSUE-224"), the two criteria are counted as gapped bridges
(399 + 2 = 401) and their six cells become `dataset gap` instead of `parse`. Recorded on
ISSUE-224 in `issues.md` as well.

**D1 — APPROVED narrowly, IMPLEMENTED.** Decision: Brad Crouch's 2011 Mini-Draft pick 2 is not
a National Draft top-5/top-10 selection; the affected Gridley answers are recorded as a
specifically evidenced Gridley-key/external-source disagreement; national-draft semantics are
not broadened and no generic player exception is added. Implementation:

- `tests/gridley-corpus-support.ts` — `nationalPickKeyDisagreement(rows, axis)`: returns the
  evidence sentence only when the axis is `national_draft_pick_between` and the triage cause is
  `non_national_pick_in_range` (a linked player whose only trusted-linked pick inside the range
  is a non-national event); null for any other builder, a satisfied range (a real national pick
  — AFLDB must list him), no pick in range (nothing evidences Gridley's answer) or an unlinked
  player (a linkage matter). It names the row: for Crouch, "2011 mini_draft pick 2 (Adelaide)".
- `tests/integration/gridley-corpus.test.ts` — applied only in the direction "Gridley lists,
  AFLDB omits, the draft axis is the lacking axis"; the finding is pushed as
  `external source disagreement` with the sentence appended. Every other draft finding keeps
  `incorrect known answer` with the `draft triage [cause]` evidence. `INFORMATIONAL` text names
  the case. `national_draft_pick_between`, `GRIDLEY_RULES` and `resolveDraftKind` are untouched.
- `tests/gridley-compat.test.ts` — DB-free pin: Crouch TOP 10 / TOP 5 → the sentence; PICK 1 →
  null; Henderson (real national pick 8) → null; unlinked → null; `pickrookie` and the any-kind
  range → null; `picktop10` still maps `national_draft_pick_between(1, 10)`.

Expected effect on the next full run (not yet run): the 39 Crouch cells move
`incorrect known answer` → `external source disagreement` (99 → 60; 383 → 422). No other cell
moves under D1.

**D2 — PENDING, NOT classified.** No data, classifier or acceptance category changed for the
eight rookie cases; their 23 cells remain `incorrect known answer` (with
`draft triage [no_linked_row_matches]` and the linked rows in the detail). Prepared:
`docs/rebuild-manifests/draftguru/rookie-relisting-independent-review-20260919-v1.md` — one row
per player (AFLDB id, canonical name, linked DraftGuru person and href, every linked DraftGuru
row, the expected finding explicitly marked UNVERIFIED RECOLLECTION, and empty columns for the
independent source with URL/date/quoted text, draft year, club, pick number or list category, and
the verdict Gridley-supported / DraftGuru-supported / Undetermined), the source order to consult
(AFL/club Rookie Draft announcements, the player's Wikipedia article and its references, the
year's Rookie Draft article, DraftGuru's own pages), the cells at stake, and the three
consequence paths, none authorised by the pack. **No network access was used;** the citation
columns are therefore empty and must be filled by the operator or by an explicitly authorised
network-enabled pass.

**D3 — DONE: AFLDB-ISSUE-225 opened** for the 37 pre-existing non-draft cells (`captain` 20,
`teammates-150` 14, `teammates-100` 1, `games250sameclub` 1, `games100clubs2` 1; 14 players;
cell-by-cell table on the issue). Recorded as present before the import (2026-09-17) and after
it (2026-09-19), root cause not investigated, not a draft matter, not accepted as baseline and
not claimed as resolved by ISSUE-222. `issues.md` Open Issues table and `IssuesIndex.md` updated
(open issues 4 → 5).

**Full corpus:** NOT rerun, per the operator. **Phase 4a remains pending** (D2 verdicts; §6.1
pick level; §6.2; remaining §6.4; §6.8 items 2–4; §7.4). No DEV/PROD claim.

**Validation for this pass (DB-free; nothing here touches a database):**

```powershell
npx tsc --noEmit -p .
npx vitest run tests/gridley-compat.test.ts tests/draft-linkage-invariants.test.ts
npx eslint tests/gridley-corpus-support.ts tests/gridley-compat.test.ts tests/integration/gridley-corpus.test.ts src/search/gridley-compat.ts
```

Read-only, targeted (unchanged from §11.19.11 block 3; ~2 min; expected 5/5 with the two 2026
refs in the gap log):

```powershell
$env:AFLDB_GRIDLEY_DIAGNOSTIC = '1'
npx vitest run tests/integration/gridley-corpus.test.ts -t "Gridley corpus -- criteria"
Remove-Item Env:AFLDB_GRIDLEY_DIAGNOSTIC
```

The one full diagnostic rerun (new dated `AFLDB_GRIDLEY_REPORT`) follows the D2 verdicts;
expected before D2: `incorrect known answer` 60 (23 rookie + 37 ISSUE-225), `external source
disagreement` 422, `parse` 0, `dataset gap` 48, everything else as in `7f14ff2c…`.

**Files changed by this pass:** `tests/gridley-corpus-support.ts` (D1 rule),
`tests/integration/gridley-corpus.test.ts` (D1 wiring, `INFORMATIONAL` text),
`tests/gridley-compat.test.ts` (D1 pin),
`docs/rebuild-manifests/draftguru/rookie-relisting-independent-review-20260919-v1.md` (new, D2
pack), this file, `issues.md` (ISSUE-222 record, ISSUE-224 D4 evidence, ISSUE-225 opened + Open
Issues table), `IssuesIndex.md` (ISSUE-222, ISSUE-225, count), `CHANGELOG.md`.

#### 11.19.13 D2 completed for the eight `pickrookie` players — all eight independently confirmed Gridley-supported, evidence-keyed classifier implemented; D1 unchanged; full corpus not rerun; Phase 4a still pending (2026-09-19, Sonnet 5)

**Scope of this pass.** Complete operator decision D2 (§11.19.12) using independently sourced
evidence for the eight late-career Rookie Draft re-listings, then implement only the resulting
per-person DraftGuru source-coverage outcomes. No Git, database, import, migration or full-corpus
command was run. §7.4 was not touched.

**Evidence.** Every URL cited in the D2 review pack (and, where a cited page could not be
retrieved or lacked the pick number, a supplementary primary or reputable-secondary source found
by search) was opened over the network and read; no verdict was recorded from recollection. Full
citations, extracts, draft year, club, pick number and evidence strength are in
`docs/rebuild-manifests/draftguru/rookie-relisting-independent-review-20260919-v1.md` (updated in
place, dated entries added rather than overwritten). Summary:

| AFLDB id | Player | Independent source (best available) | Year | Club | Pick | Strength |
|---|---|---|---|---|---|---|
| 57 | Adam Schneider | saints.com.au (club, primary) | 2014 | St Kilda | 54 | primary |
| 8350 | Lachie Henderson | geelongcats.com.au (club, primary) | 2019 | Geelong | 35 | primary |
| 10673 | Phil Davis | Rookie Me Central pick-by-pick + GWS review (specialist, secondary) | 2022 | Greater Western Sydney | 3 | secondary |
| 11672 | Sam Reid (b. 1991) | afl.com.au (AFL, primary) | 2023 (for 2024) | Sydney | 11 | primary |
| 8793 | Lewis Taylor | sydneyswans.com.au (club, primary) | 2021 | Sydney | 10 | primary |
| 10348 | Paul Seedsman | afl.com.au (AFL, primary) | 2022 | Adelaide | 21 | primary |
| 9575 | Michael Rischitelli | goldcoastfc.com.au (club, primary, no pick number) + Wikipedia "2019 AFL rookie draft" (secondary, pick number) | 2018 (labelled "2019") | Gold Coast | 2 | mixed |
| 2443 | Bryce Gibbs | Zero Hanger citing The Age (secondary) | 2020 (for 2021, inactive) | Adelaide | 1 | secondary |

**All eight: Gridley supported.** Every player has independent confirmation of a Rookie Draft
selection or administrative re-listing that DraftGuru's linked page omits — a DraftGuru source
coverage gap for a bridged, trusted-linked person, not a Gridley-key error, not a trusted-link
error and not a draft-kind mapping error (unchanged from the §11.19.11 Task 3 analysis). No player
was left Undetermined and none was DraftGuru-supported, so no `external source disagreement` rule
was needed for this pack (unlike D1, §11.19.12).

**Source disagreements/numbering notes, recorded, not treated as blocking:**

- AFL rookie drafts are named inconsistently across sources — by the year the draft was *held*
  (Schneider, Henderson, Davis, Seedsman) or by the *season it feeds* (Wikipedia's "2024 rookie
  draft" for Reid's draft held in the 2023 period; "2019 AFL rookie draft" for Rischitelli's
  selection committed in November 2018). This does not affect the criterion (`draft_type_is
  ('rookie')` has no year filter) and is noted per row rather than resolved to one convention.
- Phil Davis and Bryce Gibbs rest on reputable specialist/secondary sources (Rookie Me Central;
  Zero Hanger citing The Age) because no primary AFL/club article naming the exact pick number was
  retrievable (the GWS and Crows player-profile pages carry no draft-history text; the Wikipedia
  "2022 AFL draft" page's rookie-draft table could not be fully retrieved to cross-check Davis).
  Michael Rischitelli's pick number (2) is sourced from Wikipedia alone; the primary club source
  confirms the selection and year but not the pick number. Both are flagged explicitly in the
  artefact's `evidence_strength` column rather than silently treated as equal to the six
  primary-sourced players.
- Bryce Gibbs's case is a genuine list-status curiosity, not a numbering dispute: he was drafted
  with rookie pick 1 for administrative/salary-cap reasons only, remained retired and never played
  again. The independent evidence explicitly corroborates this (never "no re-listing" — he was
  re-listed, just inactively), matching Gridley's *"selected in a Rookie Draft"* criterion text
  exactly regardless of playing status.

**Implementation — the smallest evidence-keyed classification, per the required-work list:**

1. `data/players/rookie-relisting-outcomes.csv` (new) — one row per reviewed player, keyed by the
   AFL Tables profile path (never by name or by a database-generated id, matching
   `height-adjudications.csv` / `sibling-supplements.csv` / `father-son-selections.csv`
   convention); columns `afltables_profile, player, event_year, event_club, pick,
   evidence_strength, verdict, evidence, decided_on, reference`; all eight rows carry
   `verdict = gridley_supported`. The other two contract values (`draftguru_supported`,
   `undetermined`) exist for a future review and are unused here.
2. `tests/rookie-relisting-outcomes.ts` (new, not a test file, mirrors `tests/height-adjudications.ts`)
   — `loadRookieRelistingOutcomes()`: reads and validates the CSV (unique profiles, a real AFL
   Tables path shape, an allowed verdict/strength, a dated decision, an `AFLDB-ISSUE-NNN`
   reference), refusing a malformed file rather than applying it.
3. `tests/gridley-corpus-support.ts` — `rookieSourceCoverageGap(rows, axis, outcome)`: returns the
   evidence sentence only when the axis is `draft_type_is` with `draftType` resolving to `rookie`,
   the triage cause (from the SAME `triageDraftFinding` D1 already uses) is
   `no_linked_row_matches`, AND the caller-supplied `outcome` for that exact player has
   `verdict === 'gridley_supported'`; null for every other case — no outcome recorded, a
   `draftguru_supported`/`undetermined` outcome, any other builder or draft kind, a `satisfied` or
   `unlinked` cause. No player id or name is hard-coded in the classifier; the eight identities
   live only in the CSV.
4. `tests/integration/gridley-corpus.test.ts` — `beforeAll` loads the artefact once and resolves
   each row's AFL Tables profile against this database's own `external_identities` (the same
   `byProfile` map the height-adjudications wiring already builds) into `rookieOutcomes: Map<afldbId,
   RookieRelistingOutcome>`; a profile with no identity on this database is skipped, never guessed.
   In the draft-finding loop, applied in the same direction as D1 (Gridley lists, AFLDB omits, the
   draft axis is the lacking axis) and checked immediately after the D1 `nationalPickKeyDisagreement`
   check: when `rookieSourceCoverageGap` returns non-null the finding is pushed as
   `source coverage gap` with the evidence appended, `continue`d past the generic triage-evidence
   append. Every other draft finding is unaffected and still gets `draft triage [cause]: …`
   evidence appended as before. `DATA_GAPS['source coverage gap']` text extended to name this
   second cause (previously `has_brother`-only, §23.31); `source coverage gap` remains a
   `DATA_GAPS` category — it still fails strict acceptance and is only counted/named in diagnostic
   mode, exactly like the `has_brother` case.
5. D1 (`nationalPickKeyDisagreement`) is untouched: still `national_draft_pick_between`-only,
   still keyed off the same triage, checked and short-circuited before the D2 check so the two
   never compete for the same cell (they cannot: D1 is national-range-only, D2 is
   `draft_type_is(rookie)`-only).

**Task 4 — DB-free tests proving the required properties** (`tests/gridley-compat.test.ts`, same
"Gridley corpus support" describe block, six new `it`s using the existing `henderson`/`crouch`/
`gwsSamReid`/`top10`/`rookie` fixtures plus a `hendersonOutcome` fixture and the real loaded
artefact):

- a reviewed `gridley_supported` outcome (Henderson) classifies its exact `pickrookie` cell —
  the exact evidence sentence pinned;
- a player with **no** reviewed outcome is never reclassified under the identical
  `no_linked_row_matches` cause (Henderson and Crouch both tested with `outcome: undefined`) —
  there is **no** general "missing Rookie row means source gap" rule;
- a `draftguru_supported` or `undetermined` verdict on the same outcome record never reclassifies
  a cell (review history is not an instruction to reclassify);
- another builder (`national_draft_pick_between`, `draft_type_is('Trade')`, `traded_min_times`) is
  unaffected by a matching outcome;
- an unlinked player (`rows: []`) is unaffected even under a matching outcome — a linkage matter,
  never a source gap;
- D1 and D2 do not interfere (Crouch: D1 fires on `top10`, D2 does not fire on the same player;
  Henderson: neither fires on `top10`, a real national pick; GWS Sam Reid: a `satisfied` rookie
  cause blocks D2 even under a mismatched-but-present outcome, proving the rule reads the triage
  cause, not player identity);
- every one of the eight rows in the real `data/players/rookie-relisting-outcomes.csv` is
  recognised by the classifier (loaded via `loadRookieRelistingOutcomes()`, asserted length 8, all
  `gridley_supported`, each fired against a synthetic no-rookie-row fixture).

**D2 — DONE for all eight players; §6.3 item 4 branch (b) implemented** (a per-person outcome code,
`source coverage gap`, still fails strict). Branch (a) — a general reviewed-supplement mechanism
analogous to `data/players/sibling-supplements.csv` for source-omitted draft events — was **not**
built: the CSV here is deliberately the narrower, D2-specific form (an outcome per person, not a
general drafted-event supplement), matching "the smallest evidence-keyed classification needed."
Branch (c) (Gridley key error) was not used because no player resolved DraftGuru-supported.

**Expected effect on the next full run (not yet run).** Combined with D1 (§11.19.12, already
implemented): the 23 rookie cells (62 total draft cells − 39 Crouch) move `incorrect known answer`
→ `source coverage gap`; `incorrect known answer` 60 → 37 (the 37 ISSUE-225 cells only);
`external source disagreement` remains 422 (D1's 39 Crouch cells, already counted there);
`source coverage gap` 54 (`has_brother`, pre-existing) → 77; `parse` 0; `dataset gap` 48 — matching
the projection given when this pass was authorised. **Not yet run in this pass; a projection.**

**Phase 4a still pending:** §6.1 pick level, §6.2, remaining §6.4, §6.8 items 2–4, §7.4 (not
touched, per instruction), ISSUE-225 (D3) unresolved, one full diagnostic rerun still owed as the
§6.3 closure evidence.

**Validation for this pass (DB-free; nothing here touches a database):**

```powershell
npx tsc --noEmit -p .
npx vitest run tests/gridley-compat.test.ts tests/draft-linkage-invariants.test.ts
npx eslint tests/gridley-corpus-support.ts tests/gridley-compat.test.ts tests/integration/gridley-corpus.test.ts src/search/gridley-compat.ts
```

Results: `tsc --noEmit` clean; vitest 2 files / 42 tests passed (`tests/gridley-compat.test.ts`,
`tests/draft-linkage-invariants.test.ts`); eslint clean on all four files (also run, though not in
the authorised list, on the two new non-test modules, `tests/rookie-relisting-outcomes.ts` and the
CSV's own consumer path — clean).

**The model ran no Python, Git, database, deployment or full-corpus command in this pass.** Network
access (`WebFetch`/`WebSearch`) was used only to read the cited public pages above; no canonical
bridge dataset, DraftGuru snapshot, importer, import gate, migration or database row was touched;
§7.4 was not run.

**Files changed by this pass:** `data/players/rookie-relisting-outcomes.csv` (new, D2 outcome
artefact), `.gitignore` (added the `!/data/players/rookie-relisting-outcomes.csv` exception —
`data/players/*` is ignored by default and every tracked curated file needs its own exception, the
same convention `height-adjudications.csv` etc. already use; missed on the first write, caught by
`git status` reading nothing back for the new file), `tests/rookie-relisting-outcomes.ts` (new,
loader), `tests/gridley-corpus-support.ts` (`rookieSourceCoverageGap`),
`tests/integration/gridley-corpus.test.ts` (D2 wiring, `rookieOutcomes` map, `DATA_GAPS` text),
`tests/gridley-compat.test.ts` (D2 DB-free pins),
`docs/rebuild-manifests/draftguru/rookie-relisting-independent-review-20260919-v1.md` (verdicts
filled in), this file, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.

#### 11.19.14 Full Gridley corpus rerun (operator-reported, read-only) — the projected 99 → 37 collapse confirmed exactly; zero draft-criterion cells remain; §7.4 scoped out of this closure; core linkage objective satisfied, formal resolution still awaits commit → DEV smoke (2026-09-19, Sonnet 5)

**Scope of this pass.** Verify the operator's report of the "next action" full corpus rerun named
in §11.19.13, decide the §7.4 scope question, and update tracking. No Python, Git, database,
deployment or full-corpus command was run by the model; no classifier, test, canonical bridge
artefact or database row was touched.

**Report identity.** `D:\backups\afldb\issue-222\gridley-corpus-20260919-d1-d2.json`, operator-
reported 8,837,244 bytes, sha256 `659e29ed6e936388b5e23c48a14bb75e4956d98908836872ff25881ebd947b96`.
**Size/hash not independently recomputed this pass** (no shell command executed, per the
established shell boundary) — the operator command below closes that gap. Independent of the
operator's summary, the model read the report file directly (`Grep`/`Read`, no trust in the
narrative) and confirmed its internal `findingsByCategory` block verbatim: `boards` 1,143,
`cells` 10,287, `solvedCells` 10,161, `time of board` 21,240, `unsupported` 78, `list membership`
1,223, `external source disagreement` 422, `source coverage gap` 77, `adjudicated source conflict`
63, `dataset gap` 48, `incorrect known answer` 37 (`parse` absent = 0) — an exact match to the
operator's reported category totals and to the §11.19.13 projection.

**37-cell comparison against AFLDB-ISSUE-225 — exact match.** The string `"category": "incorrect
known answer"` occurs 38 times in the report: 1 summary field + 37 cell records (confirmed by
reading every occurrence with its `detail` line). Grouped by axis and player, the 37 records are:
`captain` → `club_captain_any` 20 (gridley 1350 = afldb 2489 Cameron Bruce ×11; gridley 6788 =
afldb 12093 Steven May ×9); `teammates-150` → `career_teammates_min(150)` 14 (afldb 2502 ×1, 5927
×2, 59 ×1, 11061 ×1, 2126 ×2, 7870 ×1, 3305 ×2, 2111 ×2, 2109 ×1, 6461 ×1); `teammates-100` →
`career_teammates_min(100)` 1 (afldb 669); `games250sameclub` 1 (afldb 3581);
`games100clubs2` 1 (afldb 4006). This reproduces AFLDB-ISSUE-225's table cell-for-cell and
player-for-player, with no unexplained residue and no cell outside that list. **No draft-criterion
axis appears among the 37** — every `rowAxis`/`colAxis` pair inspected is one of
`club_captain_any`, `career_teammates_min`, `games_at_one_club_min_incl_merged`,
`games_at_multiple_clubs_min_incl_merged`; none of the six draft builders
(`national_draft_pick_between`, `draft_type_is`, etc.) appears in an `incorrect known answer`
record.

**D1/D2 behaved exactly as projected (§11.19.13's "Expected effect", now realised):**
`incorrect known answer` 99 → 37; `external source disagreement` → 422 (Crouch's 39 cells, D1);
`source coverage gap` 54 → 77 (the eight rookie re-listings, D2, + the pre-existing `has_brother`
case); `dataset gap` 48; `parse` 0. The pass/fail test-runner summary (1,183 passed / 1 failed /
1,184 total, 308.27 s) and its single named failing test (`"writes the run report and has no
failing cells"`) are as reported by the operator; the model did not independently capture a
vitest log for those figures, only the JSON report's own counters above.

**§7.4 scope decision — Phase 4a-only, deferred; not required for this closure.** §5's phase
database-boundary line is explicit: "**Phase 3** — read-only registration exports, no write;
**Phase 4a** — `afldb_test` only; **Phase 4b** — DEV then PROD under §7" (line 480-481). §5's
Phase 4a heading is "`afldb_test` rebuild, then the demonstrated rollback", gated on "§6.1–§6.5,
§6.7, §6.8 items 1–4 and the **§7.4 rollback exercise**" (line 614-623), and §8.1's recommended
sequence places "Phase 4a incl. the rollback exercise" as a distinct step *after* Phase 3 and
*before* "Phase 4b DEV" (line 921-926). §7.4 itself is titled "Reversal — demonstrated on
`afldb_test` before **DEV**" (line 860) and its mandatory exercise is captioned "before any DEV
command" (line 877). The trusted-linkage import this issue exists to deliver was already
performed on `afldb_test` through the real importer (not `db:test:rebuild`) and independently
verified twice (§11.19.9, `32cf72a5…`), then corpus-proven on the six draft criteria (this pass:
zero draft-criterion cells in `incorrect known answer`). §7.4 proves the import is *reversible*
before that dataset is ever pushed to DEV/PROD — a Phase 4a/4b deployment-safety concern, not a
linkage-correctness concern. **§7.4 is therefore not required to close the core trusted-linkage
objective; it is required before any Phase 4b DEV/PROD command.** Recommendation: defer §7.4
together with the rest of Phase 4a (§6.1 pick level, §6.2, remaining §6.4, §6.8 items 2–4) as
follow-up scoped to a future DEV/PROD promotion of this dataset, on the same footing as
AFLDB-ISSUE-225's deferral.

**Database/Git/deployment actions this pass: none.** No write, no rollback, no reversal, no
import, no `db:test:rebuild`, no commit.

**Next guarded operator command:** none required for this closure decision. §7.4's guarded
reversal procedure remains **not drafted** — it is deferred with the rest of Phase 4a per the
scope decision above and will be produced when a Phase 4b DEV promotion is actually undertaken.

**§7.4 status correction (2026-09-19, operator decision).** The deferral above was scoped to
"core-objective recognition" only. The operator has since authorised closing out this issue's
trusted linkage into DEV (commit → `merge:ready` → merge/push → `sync-dev.ps1` → `afldb_dev`
import → smoke). §7.4's own text requires the S0–S3 rollback exercise "before any DEV command"
(line 877) and §8.1 places it as a gate immediately before "Phase 4b DEV" (line 921-926/1085).
**§7.4 is therefore required before the `afldb_dev` import step of this closeout — the "future
DEV/PROD promotion" language above no longer applies, because that promotion is this pass.**
PROD remains out of scope and untouched; §7.4's mandatory exercise still runs only on
`afldb_test` per its own text and does not itself require a separate rehearsal against
`afldb_dev`.

**Independent size/hash check (operator-run, not yet executed):**

```powershell
$f = 'D:\backups\afldb\issue-222\gridley-corpus-20260919-d1-d2.json'
(Get-Item $f).Length
(Get-FileHash $f -Algorithm SHA256).Hash
```

Expected: `8837244` and
`659E29ED6E936388B5E23C48A14BB75E4956D98908836872FF25881EBD947B96` (PowerShell's `Get-FileHash`
returns upper-case).

**Status recorded, not resolved.** The core trusted-linkage corpus gate (draft criteria) is
satisfied on this evidence. ISSUE-222 is **not** marked Resolved in `issues.md`/`IssuesIndex.md`
by this pass: the project's standard lifecycle closes an issue only after `operator commits the
reviewed local change → npm run merge:ready -- --issue 222 → operator push/merge →
deploy/sync-dev.ps1 → DEV smoke → close the issue`, none of which has occurred (everything remains
uncommitted). This pass records the scope decision and the corpus evidence supporting it; the
operator's commit is the next step.

**Files changed by this pass:** this file, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`. No other
repository file touched; no test, classifier or canonical bridge artefact changed.

#### 11.19.15 §7.4 exercise defined for the operator; the DraftGuru bridge import gate generalised to `afldb_dev` (no database, Git, network or deployment command run) (2026-09-19, Sonnet 5, High)

**Scope of this pass.** The operator authorised (§11.19.14 addendum) closing this issue's
trusted linkage into DEV: commit → `merge:ready` → merge/push → `sync-dev.ps1` → `afldb_dev`
import → smoke. §7.4's own text (line 877) requires its S0–S3 rollback exercise "before any DEV
command". Two things blocked that: (1) §7.4's exercise was "not drafted" (§11.19.14); (2)
`bridge_import_gate.py` could only ever address `afldb_test`. This pass removes both blockers.
Nothing on `afldb_test` or `afldb_dev` was touched; no DEV child was generated; no Git, network
or deployment command ran; AFLDB-ISSUE-224/225 were not expanded; the canonical v1/v2 parent and
`afldb_test` child artefacts were not modified.

**Correction (2026-09-19, second pass, Sonnet 5, High) — sequencing and terminology only, no
code/test/artefact change.** The operator command sequence originally drafted below (item 6) put
`sync-dev.ps1` (which builds, restarts and health-checks the DEV site) *before* the DEV child was
generated and *before* the real DEV import/verify — the release order actually wanted is: commit
the tooling as its own checkpoint → run §7.4 → generate and commit the DEV child alongside the
§7.4 evidence → merge → back up `afldb_dev` → import and independently verify the database → only
then deploy/restart the site via `sync-dev.ps1` → smoke → a separate documentation-only closure
commit. Item 6 below is corrected to that order. This correction also makes the S0/S1/S2/S3
terminology explicit (see the definitions immediately before the command block in item 2) and
removes a manual `npm run build && sudo systemctl restart afldb` step that duplicated exactly what
`sync-dev.ps1` already performs (build, restart, and its own health-readiness poll) — leaving one
deployment path, not two. Nothing else in this section changed: the §7.4 interpretation (item 1),
the `bridge_import_gate.py --target` generalisation (item 3), validation (item 5), and every file
already committed or proposed are unaffected. No command was run for this correction beyond
read-only inspection of `deploy/sync-dev.ps1` to confirm it already performs the build/restart/
health sequence.

**Correction (2026-09-19, third pass, Sonnet 5, High) — the §7.4 exercise/runbook itself, not yet
safe to run.** A reviewer stopped the operator command block the second pass produced: it omitted
`--no-seed` from every reverse/load call; it captured a snapshot before capturing the read-only
plan that predicts it, instead of after; it substituted arithmetic (`BASE.before + N`) for
`--expect-batches-before` instead of reading each run's own printed value; it compared the six
row-set snapshots with `Compare-Object` over decoded text rather than a fail-closed SHA-256
comparison of the raw files; the connection guards, evidence-outside-the-repository rule and
backup re-verification existed only as prose, not as anything that actually enforced them; and
item 1's "no helper script was written" directly contradicted the `s74-snapshot.sql` paragraph a
few lines below it. Item 1 and item 2 below are corrected in place (this is draft procedure, never
executed, so it is corrected rather than superseded by a dated addendum — the historical
"uncommitted" language a few passes have used is addressed separately, in this section's closing
note, now that a real commit exists). The fix is a new, small, tracked, self-contained PowerShell
script, `tools/rebuild/draftguru/s74-rollback-exercise.ps1`, rather than a longer copy/paste
block, because the corrected requirements (hard guards, fail-closed hashing, independent backup
re-verification, a refuse-if-exists evidence directory) need real control flow to be trustworthy.
Nothing was executed: no database, Git, network or deployment command ran for this pass, and the
exercise itself remains **not run**.

**Correction (2026-09-19, fourth pass, Sonnet 5, High) — the committed script's `-WhatIf`
preflight failed safely, but only by accident.** The operator ran
`s74-rollback-exercise.ps1 -WhatIf` on this workstation. Observed: path resolution and directory
creation were correctly suppressed by `-WhatIf` (an automatic consequence of `New-Item` being
ShouldProcess-aware and consulting `$WhatIfPreference`); the read-only connection guards passed;
the script then **incorrectly continued into the backup step**, invoked a bare `pwsh`, which is
**not installed on this workstation**, and failed there — no evidence directory or backup was
created and no importer ran, but only because `pwsh` happened to be absent, not because the
script itself refused. On a machine where `pwsh` exists, `-WhatIf` would have run the real backup
(and only the backup, since the deliberate-confirmation gate that follows it does correctly stop a
`-WhatIf` run before any mutation) — a genuine, if narrow, "dry run does something real" defect.
Root cause: the script's own `ShouldProcess` gate sat immediately before the *first mutating*
step (REVERSE #1), one step after the backup, so `-WhatIf` never had a chance to prevent the
backup invocation; and the backup was invoked as `& pwsh ...`, assuming `pwsh` on `PATH`, which is
never guaranteed (Windows PowerShell 5.1 ships no `pwsh.exe` at all). Fixed by (1) a new
`-PowerShellExe` parameter, defaulted to `$PSHOME\pwsh.exe` under PowerShell Core or
`$PSHOME\powershell.exe` under Windows PowerShell, required to exist and resolved to an absolute
path before anything else runs; (2) the backup now invoked as
`& $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $BackupScript`, never a bare `pwsh`;
(3) an explicit `if ($WhatIfPreference) { ...; return }` early exit placed immediately after the
connection guards — the first point in the script's execution order after which `-WhatIf` must
change behaviour — printing that backup/import/snapshot were skipped and returning successfully,
strictly before the backup step. A new DB-free static regression,
`tests/s74-rollback-exercise-static.test.ps1`, pins all three facts by parsing the script's own
AST (never executing it): no bare `pwsh` command remains; the backup invocation's command name is
the `$PowerShellExe` variable, carrying `-NoProfile -ExecutionPolicy Bypass -File $BackupScript`;
and the first `$WhatIfPreference` reference's source offset precedes the backup invocation's
offset, with the `$WhatIfPreference` branch itself verified to contain a `return`/`exit` and to
never reference `$PowerShellExe` or `$ImporterPy` (confirming the early exit is real, not merely
present in the file). The test was verified to fail against a scratch copy with the old `& pwsh`
invocation reintroduced, and to pass against the fixed script, before being kept. Nothing was
executed against `afldb_test`, `afldb_dev`, or any other database for this pass: no backup, no
importer run, no Git action, no deployment. `git diff --check` reported no whitespace errors.

**Correction (2026-09-19, fifth pass, Sonnet 5, High) — the first real attempt, honestly
recorded: stopped safely, before confirmation and before any importer invocation.** The operator
ran the fixed script for real against `afldb_test`. What succeeded: the fresh backup
(`D:\backups\afldb\issue-222\afldb_test-20260919-091558.dump`, independently recomputed SHA-256
`51fc825d686731784c9244368d3a8b20aa5fb8b8df4b88fefd7e359a5931ba85`, `pg_restore --list` read
1,469 objects) and the baseline `plan` (read-only, `import_batches_before` **193**;
`after_state_sha256 4f0a2cc567d03f2660132a1cdde66aa5e006c5e1e848a2dc5db724bd726b469d`;
`picks_after_sha256 ffa7fd60a02d8caee2d9fa22b9500725e9e12fc4ca8aba1d21e94675aa400c8d`;
`newly_linked_sha256 3ff560472aa38b63a9ef28d57501e31da9cdb907cf44bcf304a42140a02471e3`;
`baseline_sha256 71178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a4`;
`summary_sha256 d4b1fbef305736ee8c0e70bd7cfc2fa60c48e0cbc3b6edd6af911ffd998782a9`). What then failed,
before the deliberate typed confirmation and before any mutation: `Read-GatePlanValues: Cannot
bind argument to parameter 'Lines' because it is an empty string.` **Root cause:** `Invoke-Gate`
correctly preserved the gate's own blank separator lines in `$Result.Output` (needed unmodified
for the console echo and the saved `*.log` transcript), but `Get-GateValue`/`Read-GatePlanValues`
passed that same array directly into a `[Parameter(Mandatory)][string[]]` parameter --
PowerShell's binder rejects *any* array containing a blank/empty-string element for a mandatory
parameter, exactly as it would reject a bare empty-string argument. **Consequence:** no
confirmation prompt was reached, no `import_draftguru.py` process ran, no `import_batches` row
was added -- `afldb_test` remained in its starting post-import state at batch count 193, and the
verified backup and its evidence directory are the untouched record of that safe stop.

**Fix.** A new `Get-GateParseLines` helper builds a *separate, filtered* copy of a gate result's
output (`@($Result.Output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })`) for parsing
only; `$Result.Output` itself is never filtered, so `Assert-GateOk`'s console echo and
`Save-GateLog`'s transcript keep every blank line exactly as the tool printed it.
`Read-GatePlanValues` and the final-checks call site now both parse through this filtered copy,
never the raw output. `Get-GateValue` itself was also hardened: it now collects **every** match
for a key rather than returning on the first, and refuses with a clear message if a required key
is missing (unchanged) **or appears more than once** (new -- a duplicate is exactly as unsafe as
a missing key, since neither tells the caller which value is authoritative); `Get-GateParseLines`
separately refuses if filtering leaves zero lines at all. A new DB-free regression,
`tests/s74-rollback-exercise-gate-parsing.test.ps1`, extracts *only* the function definitions from
the script's own AST (`FunctionDefinitionAst` nodes' `Extent.Text`, dot-sourced) so the test never
executes `param()` or the top-level connection-guard/backup/importer flow, then feeds
`Read-GatePlanValues` realistic gate output built from this incident's own reported values with
blank and whitespace-only lines interspersed exactly as the real tool emits them: all four hashes
and `import_batches_before` parse exactly; a dropped `baseline_sha256` line refuses clearly
("could not find"); a duplicated `after_state_sha256` line refuses clearly ("appears 2 times");
output that is entirely blank/whitespace refuses clearly ("no non-blank output lines"); and,
directly reproducing the original defect, calling `Get-GateValue` on the *unfiltered* array still
throws PowerShell's own "empty string" binding error, proving the regression is real and the fix
is load-bearing, not incidental. The pre-existing `tests/s74-rollback-exercise-static.test.ps1`
(pwsh/`-WhatIf` ordering) was rerun unchanged and still passes.

**Preserved, untouched by this pass:** the evidence directory
`D:\backups\afldb\issue-222\s74-20260919-issue222-final` and the backup
`D:\backups\afldb\issue-222\afldb_test-20260919-091558.dump` are the record of the failed attempt
and remain exactly as the script left them. **The next real attempt must use a new `-Label`** --
this one is not reused or overwritten, per the script's own refuse-if-exists rule. No database,
backup, importer, Git, network or deployment command ran during this (documentation and code)
pass; only the fixed script's own AST was parsed and the two static/functional regressions above
were executed, all DB-free.

**Correction (2026-09-19, sixth pass, Opus 5, High) — the second real attempt, honestly recorded:
the fifth-pass fix held, and the parser then refused the gate's own intended output.** The operator
ran the fixed script for real against `afldb_test` a second time, with a new `-Label`
(`s74-20260919-issue222-retry1`). **What succeeded:** the fresh backup
(`D:\backups\afldb\issue-222\afldb_test-20260919-092814.dump`, independently recomputed SHA-256
`fc113c97c330e01cd6919ed6423a15e614a0c9b0c10e790ea585983442b3bf99`, `pg_restore --list` read 1,469
objects) and the baseline `plan`, whose transcript is byte-identical (sha256
`21f0f554ab2016d732ad2377a1804fb3b3d04691775de2ee015af463f3fdcf66`) to attempt 1's and reports the
same values: `import_batches_before` **193**, `after_state_sha256 4f0a2cc5…`, `picks_after_sha256
ffa7fd60…`, `newly_linked_sha256 3ff56047…`, `baseline_sha256 71178a54…`, `summary_sha256
d4b1fbef…`. **What then failed, again before the deliberate typed confirmation and before any
mutation:** `REFUSED: 'import_batches_before' appears 2 times in the gate's own output -- refusing
to guess which is authoritative.`

**Root cause.** The fifth pass hardened `Get-GateValue` to refuse *any* repeated key, on the
reasoning that "a duplicate is exactly as unsafe as a missing key". That reasoning is right for the
four hashes and wrong for `import_batches_before`, which a successful `plan` prints **twice by
design**: once in section 3 (`bridge_import_gate.py` line ~872, with the trailing
`(draftguru batches now; max id <m>)` detail) and again in section 8's plan verdict (line ~1035,
bare). Both come from the same read-only snapshot — one `BATCH_COUNT_SQL` read inside one
REPEATABLE READ transaction — so the two printed numbers are the same number by construction, and
the gate's own DB-free contract (`tests/python/draftguru_import_gate_contract.py`, checks
1.12a-1.12c) pins that printed value. **The deeper root cause is the fifth-pass regression test
itself:** its fixture was *synthetic* and emitted `import_batches_before` once, so it passed while
the real run failed. A test built from an idea of the tool's output cannot protect a parser of that
output.

**Consequence.** No confirmation prompt was reached, no `import_draftguru.py` process ran, no
`import_batches` row was added. `afldb_test` remained at batch count **193**, in the accepted
post-import state from §11.19.9. No restore was required or performed.

**Fix (sixth pass).** `bridge_import_gate.py` was **not** changed: printing that counter in both
sections is its contract, not a defect, and a read-only gate must not be reshaped to suit a
wrapper. Instead `s74-rollback-exercise.ps1` now declares an explicit **per-key** contract in a new
`Get-GateValueRule` function — the stricter of the two designs considered, chosen because the real
transcript shows exactly one key that legitimately repeats:

- `after_state_sha256`, `picks_after_sha256`, `newly_linked_sha256`, `baseline_sha256` — appear
  **exactly once**; value must match `^[0-9a-f]{64}$` (case-sensitively: the gate emits
  `hexdigest()`). A repeat refuses **even when the two values are identical**, because a repeat of
  one of these means the gate's output contract changed underneath the script.
- `import_batches_before` — repeats are allowed, and only for this key; every occurrence must carry
  the identical value (ordinal comparison, not PowerShell's case-insensitive `-eq`); value must
  match `^(?:0|[1-9][0-9]{0,8})$`, i.e. a non-negative integer with no sign, no leading zero and
  short enough that the later `[int]` cast cannot overflow.
- Any key with no declared rule refuses outright, so a future call site cannot parse an unpinned
  key by accident.

A generic "duplicates are fine when they agree" rule was rejected for exactly that reason: it would
silently absorb a change to section 7. Blank/whitespace filtering (`Get-GateParseLines`, fifth
pass) is unchanged, and `$Result.Output` is still never filtered, so the console echo and the saved
`*.log` transcripts keep the tool's own output line for line.

`tests/s74-rollback-exercise-gate-parsing.test.ps1` was **replaced**. Its fixture is now the
byte-exact 93-line transcript of the real attempt-2 `base-plan.log`, reproduced verbatim in the
test (verified line-for-line, ordinal, against the preserved file, and against attempt 1's
identical copy) so the test is self-contained and reads nothing outside the repository. It carries
the two identical `import_batches_before` lines, both `import_batches_expected_after` lines, every
blank separator, the `changes_sha256` line the script does not consume and the `baseline: {...}`
line that must never be read as `baseline_sha256`. It proves: exact parsing; identical parsing when
the separators are whitespace-only instead of empty; refusal of a disagreeing repeat; refusal of an
*identical* repeat of a once-only key; refusal of a conflicting repeat of a once-only key;
missing-key refusal for all five keys; five malformed-hash refusals (short, long, non-hex,
uppercase, `n/a`); seven malformed batch-count refusals (`abc`, `-1`, `1.5`, `0193`, `+193`, `1e3`,
`9999999999`) with `0` accepted; empty and absent output refusal; unpinned-key refusal; and that
the attempt-1 unfiltered-array binding defect still reproduces. It was verified to **fail** against
the fifth-pass parser (reproducing attempt 2's exact refusal message) and against a scratch copy
with the value-shape check disabled, before being kept; both scratch copies were deleted and
nothing under version control was touched by those checks.

**Three further defects found by the same audit and fixed in this pass** (none of them the cause of
either attempt, all of them ahead of the exercise on the path it has not yet reached):

1. **The S0/S1/S2/S3 captures were the only step first exercised *after* a mutation, and they rest
   on an unproven assumption.** `\copy ... TO 'persons.csv'` resolves its target **client-side**,
   against psql's own working directory; the script set that with `Push-Location`, which changes
   PowerShell's location but not `[System.Environment]::CurrentDirectory` — two different things,
   and which one a child process inherits is a PowerShell implementation detail. Both preserved
   evidence directories show `S0`-`S3` **empty**: that path has never run. Fixed two ways.
   `Invoke-Snapshot` is now a thin wrapper over a general `Invoke-PsqlCopyScript`, which sets the
   PowerShell location **and** the process working directory (restoring both in `finally`), so a
   relative `\copy` target can only resolve inside the stage directory. And a new tracked
   one-statement read-only helper, `tools/rebuild/draftguru/s74-snapshot-path-probe.sql`
   (`\copy (SELECT 1) TO 'snapshot-path-probe.csv'`), is run through that same helper, the same
   psql flags and the same forced-read-only session as step 1b — immediately after the `-WhatIf`
   exit and **before the backup**. A wrong working directory now refuses while `afldb_test` is
   untouched, instead of surfacing immediately after REVERSE #1.
2. **A refused gate's transcript was the one transcript never saved.** Every call site ran
   `Assert-GateOk` (which throws) *before* `Save-GateLog`, so a `plan`/`verify` that refused
   mid-exercise left no `*.log` behind. The two calls are reordered at all six sites.
3. **Two false safety claims in the script's own comments.** `$PSCmdlet.ShouldProcess` was
   documented as covering `-Confirm:$false`; it does not — that suppresses the prompt and
   ShouldProcess returns true, so the typed phrase is the only gate on such a run. And the typed
   phrase was compared with `-ne`, which is case-**insensitive** in PowerShell, while the prompt
   says "the exact phrase"; it is now `-cne`. Both comment and comparison are corrected.

**One operational addition.** Everything from REVERSE #1 to the end of step 16 is now wrapped in a
single `try`/`finally` whose only job is to print, if the run does not reach the end, that
`afldb_test` may not be in its starting state, the exact tier-1 command (the LOAD is idempotent, so
it is correct whether the run stopped reversed or already loaded), the verified backup path for
tiers 2/3, and the §11.19.4 reference. Nothing is ever restored automatically. The enclosed block
is deliberately not re-indented, so the diff shows the guard and nothing else.

**Findings recorded but deliberately NOT changed this pass** (each would touch a code path the
connection guards do not prove before a mutation, and the objective is a third attempt that
succeeds, not a third way to fail):

- `Invoke-ReadOnlySql` and `Invoke-PsqlCopyScript` pass the DSN to `psql` as `-d <dsn>`, so the
  password appears in that child process's command line (readable by any process running as this
  user). `tools/maintenance/backup-afldb-test.ps1` already establishes the repository's contract
  for this — `backup.sh`'s `dsn_scrub`: move the password into `PGPASSWORD` and pass a scrubbed
  DSN. Nothing is printed or logged, and the same credential is already in `.env`, so this is
  hygiene rather than exposure. Apply the same scrub **after** §7.4 succeeds.
- The evidence directory (and `S0`-`S3`) is created *before* the connection guards run, so a guard
  refusal leaves a stray empty directory and burns that `-Label` under the script's own
  refuse-if-exists rule. Harmless; pick another label.
- `Save-GateLog` writes with `Set-Content -Encoding utf8`, which in Windows PowerShell 5.1 means
  UTF-8 **with BOM** and CRLF line endings. The transcripts are content-complete but not byte-
  identical to the tool's stdout.
- `Invoke-Gate` captures only stdout; a Python traceback on stderr reaches the console but not the
  saved transcript. The non-zero exit still refuses.
- An untracked zero-byte file literally named `$finalBefore` sits in the worktree root (created
  2026-09-19 09:30, i.e. just after attempt 2 — shell debris from reading the script, not written
  by it). It is not part of any change and should be deleted by the operator before the next
  commit.

**Preserved, untouched by this pass:** both failed attempts' evidence directories
(`s74-20260919-issue222-final`, `s74-20260919-issue222-retry1`) and both backups
(`afldb_test-20260919-091558.dump` `51fc825d…`, `afldb_test-20260919-092814.dump` `fc113c97…`).
Both evidence directories still contain only `backup-manifest.txt` and `base-plan.log` with
`S0`-`S3` empty, which is itself the proof that neither attempt reached a snapshot, an importer
call or a confirmation. **The third attempt must use a third, new `-Label`** — neither existing
directory is reused or overwritten. No database, backup, importer, Git, network or deployment
command ran during this pass.

**1. §7.4 interpretation — no new capability was required, though two small tracked helpers were
written.** §7.4 (line 897) says in its own text: "a comparison script for S0–S3 is proposed
tooling ... the `afldb_test` exercise may use `psql` `\copy` exports diffed offline". The
mandatory exercise itself is two existing operations run in sequence — `import_draftguru.py` with
`--bridge <the pinned v2 afldb_test child>` (load) and without it (reversal, §7.4's "Initial-load
rollback") — with `psql \copy` snapshots taken between them and diffed offline. Nothing about the
exercise's five numbered steps (lines 879–895) needs a capability the importer, `psql`, and
`bridge_import_gate.py` do not already have. **Correction (third pass):** "no new tooling" does
not mean "no file was written" -- `s74-snapshot.sql` (the `\copy` list itself) and, after this
pass's correction, `s74-rollback-exercise.ps1` (sequencing, guards and fail-closed comparison) are
both small, tracked, single-purpose helpers implementing exactly the "`psql` `\copy` exports
diffed offline" text names — never a general-purpose comparison/orchestration *program*, and
never a substitute for reading §7.4 itself. See item 2 below for what each one does.

**2. The exact operator sequence for §7.4 on `afldb_test`.** `afldb_test` is **already** in the
post-load state from the real, twice-verified 2026-09-19 import (§11.19.9, plan `966897b9…`,
verify `32cf72a5…`) — there is no separate "before the bridge" snapshot on file, because that
import happened before this exercise was drafted. The exercise therefore performs the load/reverse
cycle **twice** starting from that already-loaded state, so every one of §7.4's five assertions
(S0=S2, S1=S3, `bridges.length` movement, everything else untouched) is proven directly rather
than assumed from an earlier, differently-shaped baseline. It ends with `afldb_test` back in
exactly its current, already-verified state.

**Correction (2026-09-19, third pass, Sonnet 5, High).** A prior draft of this section (the
inline `powershell` block previously here) had four defects a reviewer correctly refused to run:
it omitted `--no-seed` from the reverse/load calls; it captured a snapshot before the read-only
plan that predicts it, instead of after; it substituted arithmetic for `--expect-batches-before`
instead of the gate's own printed value; and it compared snapshots with `Compare-Object` over text
lines rather than a fail-closed SHA-256 comparison of the raw files. Rather than keep growing an
un-runnable copy/paste block, the corrected procedure is now a single tracked, self-contained
PowerShell script -- **`tools/rebuild/draftguru/s74-rollback-exercise.ps1`** (new) -- and this
section describes what it does rather than duplicating its logic (the script's own header comment
is the authoritative step-by-step reference; this prose must never drift from it). The script was
written, not merely a longer copy/paste block, because the corrected requirements (hard connection
guards enforced in code, not prose; fail-closed hashing; a backup that is independently
re-verified, not merely trusted; an evidence directory the script refuses to reuse) need real
control flow and error handling to be trustworthy -- a markdown code block cannot enforce
"throw on the first mismatch" or "restore PGOPTIONS no matter what happens." It remains a small,
single-purpose script, not a general framework: it does one exercise, on one target, and nothing
else.

Preconditions the operator confirms before running it: a working tunnel/port-forward to
`127.0.0.1:55432`; `AFLDB_TEST_DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL` both set to that
tunnel, targeting `afldb_test` (never the default `.env` values, which target `afldb_dev`); the
pinned v2 `afldb_test` deployment child unchanged since the last accepted import.

```powershell
powershell -ExecutionPolicy Bypass -File tools\rebuild\draftguru\s74-rollback-exercise.ps1
```

**What it does, in order** (identical to the script's own header comment; corrected per the
review above):

0. **Connection guards, in executable PowerShell, before any mutation.** `AFLDB_TEST_DATABASE_URL`
   and `AFLDB_IMPORT_DATABASE_URL` must each parse as `postgresql://user:pass@127.0.0.1:55432/afldb_test`
   (shape and host/port/database checked; the DSN value itself is never printed or logged). A
   read-only probe over each then requires `current_database() = afldb_test` (test DSN) and
   `current_user = afldb_import` **and** `current_database() = afldb_test` (import DSN). The TCP
   port is confirmed open again immediately before the first mutating call.
0a. **`-WhatIf` stops here, before anything else.** Immediately after the connection guards, an
   explicit `if ($WhatIfPreference) { ...; return }` prints that backup/import/snapshot were
   skipped and exits successfully — **before** the backup is invoked. This is a fourth-pass fix
   (see the correction above): it exists because the backup is an *external process*
   (`-PowerShellExe`), which has no concept of `$WhatIfPreference` and would otherwise run for
   real even under `-WhatIf`, unlike the `New-Item` evidence-directory creation above, which is
   automatically suppressed because it is itself a ShouldProcess-aware cmdlet.
0b. **Snapshot working-directory preflight** (sixth-pass addition; the script labels this step
   `1b`). `tools/rebuild/draftguru/s74-snapshot-path-probe.sql` — one read-only
   `\copy (SELECT 1) TO 'snapshot-path-probe.csv'` — is run through the same helper, psql flags and
   forced-read-only session a real S0/S1/S2/S3 capture uses, into a `preflight/` directory under the
   evidence root. `\copy` resolves its target client-side, against psql's own working directory;
   the captures are the only step that first runs *after* a mutation, so the contract they depend on
   is proven here, while `afldb_test` is still untouched.
1. **Fresh backup**, via `backup-afldb-test.ps1`, invoked as
   `& $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $BackupScript` -- **never** a bare
   `pwsh` (never assumed to be on `PATH`; `-PowerShellExe` defaults to `$PSHOME\pwsh.exe` under
   PowerShell Core or `$PSHOME\powershell.exe` under Windows PowerShell, and is required to exist
   before anything else runs). The script parses the backup's own printed file path and SHA-256,
   requires the file to be non-zero length, **independently recomputes** the SHA-256 (never
   trusting the printed value alone), and re-runs `pg_restore --list` itself to confirm the
   archive is readable. The path, recomputed hash, object count and the tracked recovery
   reference (§11.19.4 below) are written to `backup-manifest.txt` in the evidence directory.
   **This backup is the recovery point for the untouched, already-verified STARTING post-import
   database -- it is not a snapshot of S0** (see the definitions below). No automatic restore is
   ever attempted, on any failure, at any point in the script.
2. **Baseline plan (`BASE`)** -- `bridge_import_gate.py plan --target test` against the untouched
   starting state, before anything mutates. Its four hashes and `import_batches_before` are parsed
   from the tool's own printed output (never guessed) and become the values every later stage must
   reproduce.
3. **A deliberate, typed confirmation** ("I have a fresh verified afldb_test backup and intend to
   reverse and reload the bridge"), after which the script proceeds only if it is typed exactly --
   `ShouldProcess` defence in depth for an explicit `-Confirm:$false` or an interactive decline
   (`-WhatIf` itself already returned at step 0a, before this point is ever reached).
4. **REVERSE #1** -- `import_draftguru.py --no-seed` (no `--bridge`).
5. **Capture S0** -- the six `s74-snapshot.sql` row-sets, via `psql`, session forced read-only.
6. **Plan R1** -- `bridge_import_gate.py plan --target test --bridge <child>`, predicting LOAD #1
   from S0. Its hashes and `import_batches_before` are parsed and kept as `R1`.
7. **LOAD #1** -- `import_draftguru.py --no-seed --bridge <child>`.
8. **Verify #1**, passing **R1's own captured values** as `--expect-*` (never recomputed, never
   assumed) -- then asserts `R1` equals `BASE` on all four hashes.
9. **Capture S1**.
10. **REVERSE #2** -- `import_draftguru.py --no-seed` (no `--bridge`).
11. **Capture S2**, then assert **S2 = S0 exactly** -- `Get-FileHash -Algorithm SHA256` over each
    of the six raw files in turn, throwing immediately on the first mismatch (never `Compare-Object`
    over decoded text lines, and never claimed "byte for byte" without this).
12. **Plan R2** -- predicting LOAD #2 from S2 -- then asserts **R2 equals R1** on all four hashes
    (an internal-consistency check beyond §7.4's literal text: if S2 truly equals S0, reloading the
    same child onto it must predict exactly what R1 predicted).
13. **LOAD #2** -- `import_draftguru.py --no-seed --bridge <child>`.
14. **Verify #2**, passing **R2's own captured values** -- then asserts `R2` equals `BASE`.
15. **Capture S3**, then assert **S3 = S1 exactly** (same fail-closed SHA-256 method as step 11).
16. **Final checks** -- one more `plan` reads the current `import_batches_before` and asserts it
    equals `BASE.before + 4` **exactly** (reverse/load/reverse/load) -- a count assertion, never
    substituted into any `--expect-batches-before` argument, and never used in place of a gate's
    own printed value at any step above.

**S0/S1/S2/S3 defined (the authoritative definition; identical in the script's NOTES; nowhere
else in this issue's tracking describes S0 differently).** `afldb_test` starts this exercise in
the **post-import (bridged) state** — the real, twice-verified 2026-09-19 import (§11.19.9). That
starting state is **not** S0; it is what the step-1 backup protects, and what S1 reconstructs.

- **S0 -- the reconstructed pre-bridge state**, captured only *after* REVERSE #1. §7.4's own text
  (line 879) explicitly allows this: "Snapshot S0 (pre-bridge, after the plain rebuild **or after
  step 4 below**)" — S0 need not come from a fresh, never-bridged database; it may be reached by
  undoing an existing load first, which is exactly this case. **S0 is never the untouched starting
  database** — that database is already bridged, and a snapshot of it untouched would be S1, not
  S0.
- **S1 -- the post-load (bridged) state**, captured after LOAD #1. Because the same,
  already-accepted child is reloaded onto the same reversed rows, S1 reconstructs — and verify #1
  independently confirms it equals — the exercise's own starting state (the one the backup
  protects).
- **S2 -- the second reconstructed pre-bridge state**, captured after REVERSE #2. Must equal S0
  **exactly**, by SHA-256 over the raw files (§7.4 line 892).
- **S3 -- the second post-load state**, captured after LOAD #2. Must equal S1 **exactly**, by the
  same method -- proving the restoration is idempotent (§7.4 line 894).

**`import_batches` is deliberately excluded from the S0=S2/S1=S3 file comparison.** It legitimately
gains one row per mutating call (four total across reverse/load/reverse/load); comparing it as a
row-image would make S0 and S2 differ by construction. It is instead checked as a *count*
(`BASE.before + 4`, step 16), read from the gate's own printed `import_batches_before` at every
stage, never computed or guessed (§7.4's own batch bookkeeping, `bridge_import_gate.py` README).

**Recovery reference (never run automatically by the script).** Any thrown error stops the script
immediately, leaving `afldb_test` exactly where the last successful step left it. The tracked
recovery procedure is **§11.19.4 above, "Rollback, three tiers"**: tier 1 is an importer reversal
(no restore -- likely already the last thing the script ran); tier 2 restores the step-1 backup
into a separate `afldb_test_recovery` database on the DEV host, never over `afldb_test`; tier 3 is
the last-resort restore over `afldb_test` itself, followed by `npm run db:privileges:test`. The
script never attempts any of these itself.

**Evidence.** Every snapshot, every `plan`/`verify` transcript and the backup manifest are written
under a fresh, must-not-already-exist directory beneath `D:\backups\afldb\issue-222` (never inside
the repository -- the script refuses to run otherwise), so nothing from this exercise is ever left
as an untracked file in the worktree.

**`tools/rebuild/draftguru/s74-snapshot.sql`** (tracked, small, read-only helper -- unchanged by
this correction). Six `\copy` statements over exactly the row sets §7.4 names — `draft_persons`/
`draft_picks` link columns for `source_id = draftguru`, every `source_id IS NULL` pick in full,
`external_identities(draftguru)` link columns, `player_link_resolutions` for `draft_picks` in
full, `data_overrides` for `draft_picks` in full — ordered by natural key so two snapshots of the
same state are byte identical. It is the direct implementation of §7.4's own "`psql` `\copy`
exports diffed offline" text: a small tracked helper, not a full comparison/orchestration program
in itself -- the sequencing, guards and fail-closed comparison logic that make it safe to run four
times in one sitting now live in `s74-rollback-exercise.ps1` above, not in a hand-typed runbook
block.

**3. `bridge_import_gate.py` generalised to `--target {test, dev}`.** Full detail in
`tools/rebuild/draftguru/README.md`. Summary: `--target` defaults to `test` (every pre-existing
invocation is unchanged); `dev` reads its own `AFLDB_DEV_DATABASE_URL` (new — mirrors
`AFLDB_TEST_DATABASE_URL`'s naming exactly; deliberately never the importer's own write-role DSN
or the migration schema-owner DSN, so this read-only gate can never silently follow an edit made
to either of those); `dev` requires the connected database to be exactly `afldb_dev`; `dev` has no
default `--bridge` (mandatory, and refused outright if it resolves to the `afldb_test` child
path); a child whose own `target` field does not match the selected database is refused
regardless of path; there is no PROD entry in the closed target list and no way to add one from
the command line. Plan/verify's read-only discipline (session + `SELECT`-only cursor enforcement,
rollback-and-close unconditionally, no DSN/credential ever printed) is identical across both
targets.

**4. The DEV child does not exist yet and was not generated this pass.** Producing
`data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json` needs
`export_person_bridge.py --resolve-against dev` run against a real `afldb_dev` connection (per
`tools/rebuild/draftguru/README.md`'s existing `--resolve-against` tool, itself already
target-agnostic — it takes the target name and required database on its own command line and was
not modified this pass). Per the corrected release order in item 6 below, this is a **pre-merge**
step: the operator generates and validates the DEV child from the still-open feature branch (a
read-only `afldb_dev` connection is all it needs — the DEV site's deployed *code* does not need to
be current for this, since the child is produced by a workstation-run Python tool, not by the
running Next.js app), then commits that child file together with the §7.4 evidence in the "final
pre-deployment commit" (item 6 step 5), before `merge:ready`/merge/push. `sync-dev.ps1` runs much
later in the corrected order — after the DEV database is imported and independently verified, not
before.

**5. Validation (DB-free only; nothing executed against a database).**
`python -m py_compile tools/rebuild/draftguru/bridge_import_gate.py
tests/python/draftguru_import_gate_contract.py` clean;
`python tests/python/draftguru_import_gate_contract.py` — every check holds, including new
coverage for: the legacy/default (no `--target`) invocation, explicit `--target test`, explicit
`--target dev`, per-target DSN environment selection, per-target database-name guards, refusal of
a cross-target child artefact in both directions, refusal of `prod`/unknown/empty target strings,
a full DEV-target `plan`→`verify` run reproducing the test-target's own hashes on the identical
fixture frame, and CLI-level coverage of the mandatory-`--bridge`/no-silent-afldb_test-reuse/
no-PROD-choice guards;
`npx vitest run tests/draftguru-acquisition.test.ts -t "DraftGuru bridge import gate"` — 2 passed,
0 failed (this includes the pre-existing source-text contract asserting the module never names
the importer's write DSN or the migration owner DSN by string — the new docstring/comments were
worded to respect that literally). No TypeScript changed; no lint run (no linted file touched).
The Gridley corpus was not rerun.

**Third-pass validation (the correction above).** No Python or TypeScript file changed, so
`py_compile`/the contract/vitest were not rerun (they remain valid against the unchanged
`5987ac2e` tooling). The new `tools/rebuild/draftguru/s74-rollback-exercise.ps1` was syntax-checked
with `[System.Management.Automation.Language.Parser]::ParseFile()` (0 errors) — parsing only,
never executed, never connecting to anything. `git diff --check` reported no whitespace errors.
The script itself was not run: no backup, no reversal, no load, no snapshot, no database
connection of any kind.

**Fourth-pass validation (the `-WhatIf`/`-PowerShellExe` fix above).**
`[System.Management.Automation.Language.Parser]::ParseFile()` — 0 errors on both
`s74-rollback-exercise.ps1` and the new `tests/s74-rollback-exercise-static.test.ps1`. The new
static regression was run directly (`powershell -NoProfile -ExecutionPolicy Bypass -File
tests\s74-rollback-exercise-static.test.ps1`) and passed against the fixed script; it was also
run against a scratch copy with the old bare `& pwsh` invocation reintroduced and confirmed to
**fail** there, proving the regression is real, not vacuous (the scratch copy was deleted
afterward; nothing under version control was touched by that check). `git diff --check` reported
no whitespace errors. No Python/TypeScript file changed. Nothing was executed against
`afldb_test`, `afldb_dev`, or any database: no backup, no `import_draftguru.py`, no
`bridge_import_gate.py` run against a real connection, no Git mutation, no DEV action, no
deployment.

**Fifth-pass validation (the gate-output blank-line parsing fix above).**
`[System.Management.Automation.Language.Parser]::ParseFile()` — 0 errors on
`s74-rollback-exercise.ps1` and the new `tests/s74-rollback-exercise-gate-parsing.test.ps1`. The
new functional regression was run directly and passed all five checks (exact parse with blank/
whitespace lines present; missing-key refusal; duplicate-key refusal; all-blank refusal; the
original unfiltered-array defect reproduced directly against `Get-GateValue`). The pre-existing
`tests/s74-rollback-exercise-static.test.ps1` was rerun and still passes. `git diff --check`
reported no whitespace errors. No Python/TypeScript file changed. Nothing was executed against
`afldb_test`, `afldb_dev`, or any database this pass: no backup, no `import_draftguru.py`, no
`bridge_import_gate.py` run against a real connection, no Git mutation, no DEV action, no
deployment. The preserved evidence directory and backup from the first real attempt
(`s74-20260919-issue222-final`, `afldb_test-20260919-091558.dump`) were not touched, deleted or
reused.

**Sixth-pass validation (the per-key gate-output contract, the snapshot preflight and the audit
fixes above) — all DB-free.**
`[System.Management.Automation.Language.Parser]::ParseFile()` — 0 errors on
`s74-rollback-exercise.ps1`, `tests/s74-rollback-exercise-static.test.ps1` and the rewritten
`tests/s74-rollback-exercise-gate-parsing.test.ps1`.
`tests\s74-rollback-exercise-static.test.ps1` — PASS, unchanged (4 assertions).
`tests\s74-rollback-exercise-gate-parsing.test.ps1` — PASS against the byte-exact real transcript;
verified to FAIL against the fifth-pass duplicate rule (reproducing attempt 2's exact refusal
message) and against a scratch copy with the value-shape check disabled ("expected a throw; none
occurred"), so it is not vacuous. Both scratch copies were deleted; nothing under version control
was touched by those checks.
Fixture fidelity independently checked: the test's embedded 93-line here-string compared
line-for-line, ordinal, against `s74-20260919-issue222-retry1\base-plan.log` — 0 differing lines;
that file and `s74-20260919-issue222-final\base-plan.log` both hash to
`21f0f554ab2016d732ad2377a1804fb3b3d04691775de2ee015af463f3fdcf66`.
`python tests/python/draftguru_import_gate_contract.py` — all checks hold (rerun to confirm
`bridge_import_gate.py` is untouched and its 1.12a-1.12c printed-counter contract still stands).
`git diff --check` — no whitespace errors. No TypeScript or Python file changed; the Gridley corpus
was not rerun. Nothing was executed against `afldb_test`, `afldb_dev` or any database: no `psql`,
no backup, no `import_draftguru.py`, no `bridge_import_gate.py` against a real connection, no Git
mutation, no DEV action, no deployment. The §7.4 exercise itself was **not** attempted a third time
this pass.

**6. Exact operator commands, in order, for the remainder of this closeout.** Every `<...>` value
must be read off the immediately preceding step's own output, never assumed or reused from an
older run. This is the corrected release order (2026-09-19, second pass): the tooling is checked
in as its own reviewable unit before it is exercised; the DEV child and the §7.4 evidence travel
in the same pre-deployment commit as everything else the DEV import needs; the database is
imported and independently verified *before* the site is ever rebuilt or restarted; `sync-dev.ps1`
therefore runs once, last, as the single deployment path -- never duplicated by a manual
build/restart.

```text
# 1) Tooling checkpoint -- commit the validated gate, the §7.4 helper and this documentation on
#    their own, before anything is exercised against a real database.
git add tools/rebuild/draftguru/bridge_import_gate.py tools/rebuild/draftguru/s74-snapshot.sql \
  tests/python/draftguru_import_gate_contract.py tools/rebuild/draftguru/README.md \
  AFLDB-ISSUE-222.md issues.md IssuesIndex.md CHANGELOG.md .env.example docs/deployment.md \
  deploy/afldb.service deploy/afldb-email-intake.service deploy/afldb-settle-afltables.service
git commit -m "AFLDB-ISSUE-222: DraftGuru bridge import gate --target {test,dev}; §7.4 exercise defined"

# 2) §7.4 on afldb_test, using the tooling just committed -- the full sequence in item 2 above,
#    including the S0/S1/S2/S3 definitions immediately before it. STOP on any failure; restore
#    from the step-0 backup, never from an S0/S1/S2/S3 CSV.

# 3) Record the exercise's exact evidence in this file (S0/S1/S2/S3 hashes or Compare-Object
#    results, the four import_batches rows, the final bridge_import_gate.py verify output) as a
#    dated addendum -- the same discipline every other operator-reported result in this issue
#    follows.

# 4) Generate and validate the DEV-specific child -- pre-merge, read-only against afldb_dev (a
#    workstation-run Python tool; the DEV site's deployed code does not need to be current yet).
python tools/rebuild/draftguru/export_person_bridge.py --resolve-against dev \
  --parent data/reference/draftguru-person-bridge-20260918-v2.json \
  --out data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json
python tools/rebuild/draftguru/validate_person_bridge_child.py --target dev \
  --child data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json \
  --expect-sha256 <the new child's own sha256, printed by the export step>
#   --target dev defaults nothing: both --child and --expect-sha256 are mandatory, and the
#   afldb_test child is refused by path, by name and by bytes (§11.19.17).

# 5) Final pre-deployment commit -- the DEV child plus the §7.4 evidence from step 3, still on
#    the feature branch.
git add data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json AFLDB-ISSUE-222.md
git commit -m "AFLDB-ISSUE-222: afldb_dev deployment child; §7.4 afldb_test rollback evidence"

# 6) merge:ready.
npm run merge:ready -- --issue 222

# 7) Merge/push to main (operator-run; the model executes no Git command).

# 8) Fresh afldb_dev backup (the DEV-host twin of backup-afldb-test.ps1 / backup.sh; confirm the
#    exact script name/path from docs/deployment.md before running -- not re-derived here). This
#    is the afldb_dev recovery point, exactly as step 0's backup-afldb-test.ps1 was for afldb_test.

# 9) DEV validate-only, then a transactional dry run (AFLDB_IMPORT_DATABASE_URL pointed at
#    afldb_dev -- the DEFAULT .env value on the DEV host, per docs/deployment.md §7).
python tools/rebuild/draftguru/import_draftguru.py --validate-only \
  --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json
python tools/rebuild/draftguru/import_draftguru.py --dry-run \
  --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json

# 10) DEV read-only plan -- capture every generated hash plus import_batches_before. Nothing in
#     the database changes yet.
python tools/rebuild/draftguru/bridge_import_gate.py plan --target dev \
  --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json
# read after_state_sha256 / picks_after_sha256 / newly_linked_sha256 / baseline_sha256 /
# import_batches_before off this plan's output -- call them $DEV_*

# 11) The real DEV import.
python tools/rebuild/draftguru/import_draftguru.py \
  --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json

# 12) Two independent DEV verifies, using the $DEV_* values captured in step 10 (the §7.5
#     "deterministic" requirement: both must print the identical summary_sha256).
python tools/rebuild/draftguru/bridge_import_gate.py verify --target dev \
  --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json \
  --expect-after-sha256 <$DEV_after_state_sha256> \
  --expect-picks-after-sha256 <$DEV_picks_after_sha256> \
  --expect-newly-linked-sha256 <$DEV_newly_linked_sha256> \
  --expect-baseline-sha256 <$DEV_baseline_sha256> \
  --expect-batches-before <$DEV_import_batches_before>
python tools/rebuild/draftguru/bridge_import_gate.py verify --target dev \
  --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json \
  --expect-after-sha256 <$DEV_after_state_sha256> \
  --expect-picks-after-sha256 <$DEV_picks_after_sha256> \
  --expect-newly-linked-sha256 <$DEV_newly_linked_sha256> \
  --expect-baseline-sha256 <$DEV_baseline_sha256> \
  --expect-batches-before <$DEV_import_batches_before>
# confirm both runs printed the same summary_sha256. Only past this point is afldb_dev's data
# independently proven -- everything before here touched no deployed code and no live traffic.

# 13) ONLY NOW, with the database independently verified twice, sync and deploy DEV code.
#     sync-dev.ps1 already performs git pull, npm ci, npm run db:migrate, npm run build, the
#     systemd restart, and its own readiness (health) poll -- there is no separate manual
#     "npm run build && sudo systemctl restart afldb" step; running one here would duplicate what
#     this single command already does and create two competing deployment paths.
deploy/sync-dev.ps1

# 14) Health and Grid Solver draft smoke checks: the four DEV browser checks named in §6.6, plus
#     a Grid Solver draft-criterion smoke (a national-draft-pick query on a known-linked player)
#     against the DEV site -- on top of sync-dev.ps1's own automated /api/health readiness poll.

# 15) Documentation-only closure commit (operator, after (1)-(14) all hold): mark ISSUE-222
#     Resolved in issues.md, remove it from IssuesIndex.md / the Open Issues table, add the
#     CHANGELOG.md entry. This commit touches no code and no data artefact.
```

**Database/Git/network/deployment actions across all three passes: none.** No `psql`, no
`import_draftguru.py`, no `bridge_import_gate.py` run against a real connection, no backup, no
push, no `sync-dev.ps1`, no `export_person_bridge.py --resolve-against dev`. AFLDB-ISSUE-224 and
AFLDB-ISSUE-225 were not touched or expanded. The canonical v1/v2 parent, the `afldb_test` child,
and every Gridley corpus artefact are unchanged. The second pass ran no command beyond a read-only
`Read` of `deploy/sync-dev.ps1`. This third pass ran no command beyond `python -m py_compile`
(unaffected by this pass -- no Python file changed), `[System.Management.Automation.Language.
Parser]::ParseFile()` over the new `.ps1` (syntax check only, never executed), and `git status` /
`git diff --check` for the report the operator required.

**Tooling checkpoint committed (operator-run, between the second and third pass):** `5987ac2e`
"feat(draftguru): add DEV gate and reversal tooling" — contains everything the first and second
passes produced (`bridge_import_gate.py`, `s74-snapshot.sql`, the extended contract, `README.md`,
this file, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `.env.example`, `docs/deployment.md`,
the three `deploy/*.service` files). **Statements elsewhere in this section that call those files
"uncommitted" describe the state as it was at the time they were written and are preserved as
historical record; they no longer describe the current state.** Everything from this third
(correction) pass — the `--no-seed`/ordering/hashing/evidence-location/connection-guard fixes to
this section's prose, and the new `tools/rebuild/draftguru/s74-rollback-exercise.ps1` — remains
**uncommitted** as of this pass.

**Files changed by the third pass:** `AFLDB-ISSUE-222.md` (this section: items 1 and 2 rewritten;
this closing note), `tools/rebuild/draftguru/s74-rollback-exercise.ps1` (new), plus short pointer
additions to `issues.md` and `IssuesIndex.md`. `tools/rebuild/draftguru/README.md` gained a
corresponding update. No code that runs against a database changed (`bridge_import_gate.py`,
`s74-snapshot.sql`, `import_draftguru.py`, and every test are byte-identical to `5987ac2e`); no
canonical bridge artefact, ISSUE-224/225 content, or Gridley classification was touched.

**Files changed by the fourth pass (the `-WhatIf`/`-PowerShellExe` fix):**
`tools/rebuild/draftguru/s74-rollback-exercise.ps1` (the `-PowerShellExe` parameter, the moved
`$WhatIfPreference` early exit, the corrected backup invocation), `tests/s74-rollback-exercise-static.test.ps1`
(new), `AFLDB-ISSUE-222.md` (this section), `tools/rebuild/draftguru/README.md`, plus short
pointer additions to `issues.md` and `IssuesIndex.md`. `bridge_import_gate.py`, `s74-snapshot.sql`,
`import_draftguru.py` and every Python test remain byte-identical to `5987ac2e`; no canonical
bridge artefact, ISSUE-224/225 content, or Gridley classification was touched; nothing was run
against `afldb_test`, `afldb_dev`, or any database.

**Files changed by the fifth pass (the gate-output blank-line parsing fix):**
`tools/rebuild/draftguru/s74-rollback-exercise.ps1` (`Get-GateValue` hardened against missing
*and* duplicate keys; new `Get-GateParseLines` helper; `Read-GatePlanValues` and the final-checks
call site now parse through the filtered copy), `tests/s74-rollback-exercise-gate-parsing.test.ps1`
(new), `AFLDB-ISSUE-222.md` (this section), plus short pointer additions to `issues.md` and
`IssuesIndex.md`. `tools/rebuild/draftguru/README.md` was not changed this pass -- it does not
document the gate-output parsing implementation, only the tool's externally observable contract,
which is unchanged. `bridge_import_gate.py`, `s74-snapshot.sql`, `import_draftguru.py` and every
Python test remain byte-identical to `5987ac2e`; no canonical bridge artefact, ISSUE-224/225
content, or Gridley classification was touched. The evidence directory and backup from the first
real attempt (`s74-20260919-issue222-final`, `afldb_test-20260919-091558.dump`) were not touched,
deleted or reused. Nothing was run against `afldb_test`, `afldb_dev`, or any database.

**Files changed by the sixth pass (the per-key gate-output contract and the audit fixes):**
`tools/rebuild/draftguru/s74-rollback-exercise.ps1` (new `Get-GateValueRule`; `Get-GateValue`
rewritten around it; `Invoke-Snapshot` refactored onto a new `Invoke-PsqlCopyScript` that sets both
working directories; the step-1b preflight; `Save-GateLog` before `Assert-GateOk` at all six sites;
`-cne` for the typed phrase; the post-mutation `try`/`finally` recovery banner; header NOTES),
`tools/rebuild/draftguru/s74-snapshot-path-probe.sql` (new),
`tests/s74-rollback-exercise-gate-parsing.test.ps1` (rewritten around the real transcript),
`AFLDB-ISSUE-222.md` (this section), `tools/rebuild/draftguru/README.md`, plus short pointer
additions to `issues.md` and `IssuesIndex.md`. `bridge_import_gate.py`, `s74-snapshot.sql`,
`import_draftguru.py` and every Python test remain byte-identical to `5987ac2e`; no canonical
bridge artefact, ISSUE-224/225 content, or Gridley classification was touched. Both failed
attempts' evidence directories and both backups were not touched, deleted or reused.

#### 11.19.16 Third §7.4 attempt (`retry2`) succeeded: full S0–S3 rollback cycle proven; §7.4 satisfied, DEV promotion unblocked (2026-09-19, operator-run, Sonnet 5 read-only review)

**Evidence read directly from `D:\backups\afldb\issue-222\s74-20260919-issue222-retry2\` (native
file reads only, no command executed by the model).**

- **Backup.** `backup-manifest.txt`: `afldb_test-20260919-094228.dump`, sha256
  `6e82e5db4af0b609b2c6477a7c4e4b6531e586ea70a28f2de3323bf051fc4180`, 1,469 catalogue objects —
  matches exactly.
- **Batch bookkeeping across the run** (`base-plan.log`, `r1-plan.log`, `verify1.log`,
  `r2-plan.log`, `final-plan.log`, all `import_batches_before`): 193 (base) → 194 (after REVERSE
  #1) → 195 (after LOAD #1) → 196 (after REVERSE #2) → 197 (after LOAD #2, = the final/verify2
  reading). BASE 193 and final 197 both confirmed verbatim.
- **Exactly four mutating operations, in the required order.** `reverse1.log` and `reverse2.log`
  each show `bridge : 0 entries (no bridge dataset supplied)` and `authority: bridge 0` /
  `authority: unmatched 5,052` — the reversal shape. `load1.log` and `load2.log` each show
  `bridge : 3468 entries` and `authority: bridge 3,465` — the load shape. All four logs print
  `authority: seeded 0`, and every plan/verify log in the sequence prints `PASS 5.5 nothing would
  be seeded` under "apply_authority, seeding forbidden" — consistent with `--no-seed` on every
  invocation. (The literal `--no-seed` flag text is not itself echoed into any log; the
  `seeded 0` result on all four operations is the recorded evidence for it.) Sequence confirmed:
  reverse → load → reverse → load.
- **Canonical final hashes** (`final-plan.log` §7, reproduced identically in `verify2.log`):
  `after_state_sha256 4f0a2cc567d03f2660132a1cdde66aa5e006c5e1e848a2dc5db724bd726b469d`,
  `picks_after_sha256 ffa7fd60a02d8caee2d9fa22b9500725e9e12fc4ca8aba1d21e94675aa400c8d`,
  `newly_linked_sha256 3ff560472aa38b63a9ef28d57501e31da9cdb907cf44bcf304a42140a02471e3`,
  `baseline_sha256 71178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a4` — all match.
- **Summary hashes:** `verify1.log` → `summary_sha256
  cfd8b24b39f29f170e0cd211a09274e09cdbee84d804fb1b55d864527f11a7b3`; `verify2.log` → `summary_sha256
  3faa54d2f0b03fa23fbae563894c925bfcf40c088c1ba0c100494ce66f69da17`; `final-plan.log` →
  `summary_sha256 5b6b16f67880503a451cceb03c0937975832ee13e098c76c53734afb2ffa4474`. All three
  match; `verify1.log` and `verify2.log` each independently show all fourteen post-import checks
  (§8.1–§8.14) PASS, including "8.14 after/picks_after/newly_linked/baseline_sha256 equals the
  plan's value" and "8.7 Craig Somerville and David Sullivan did not re-enter".
- **`S0`/`S1`/`S2`/`S3` directories.** All six expected CSVs (`persons.csv`, `picks_dg.csv`,
  `picks_manual_null.csv`, `identities.csv`, `resolutions.csv`, `overrides.csv`) are present in
  each of the four snapshot directories. Spot content check on the two identity rows this issue
  already tracks (`paul_seedsman/1`, `timothy_malseed/1`, §11.15's transition table) shows the
  expected pattern exactly: `S0` and `S2` both carry the pre-bridge `unmatched` state for
  `paul_seedsman/1` byte-for-byte at the same row, and `S1`/`S3` both carry the identical
  post-bridge `unique|draftguru_person_page_afltables_bridge` → player `10348` state at the same
  row; `timothy_malseed/1` is `unmatched` identically across all four snapshots (it is not a
  bridge target). This is consistent with the claimed S0≡S2 / S1≡S3 byte-identity, but the full
  SHA-256 values for the twelve CSVs quoted in the operator's brief were **not independently
  recomputed in this session** — `persons.csv`/`picks_dg.csv`/`identities.csv` run 5,057–6,810
  rows each, and neither a whole-file read-and-compare of all twelve files (against §3's read
  discipline) nor running a hashing command (against §9's shell-execution boundary, which this
  read-only pass did not have standing authorisation to cross) was appropriate for this addendum.
  If independent re-confirmation of the twelve file hashes is wanted, see the verification command
  below.
- **`preflight/snapshot-path-probe.csv`** present, single data row (`probe,1`), consistent with
  the sixth-pass working-directory preflight (§11.19.15 item 3) having run before the backup.

**Conclusion.** Every fact independently checked against the saved transcripts matches the
operator's brief exactly, including all three summary hashes and the four canonical final-state
hashes, which is the strongest single signal that `retry2` reproduced the intended S0–S3 cycle
deterministically. The batch-count and reverse/load/reverse/load sequencing is fully corroborated
from the plan/verify logs' own printed counters, not merely restated from the prompt. §7.4's
mandatory rollback exercise is therefore satisfied on `afldb_test`. **§7.4 is satisfied; DEV
promotion (the `afldb_dev` bridge-import path, §11.19.15 item 4 onward) is unblocked.**
**AFLDB-ISSUE-222 is not marked Resolved by this pass** — Phase 4b (DEV) has not been attempted,
and closure per §14 also requires the DEV import, its independent verify, `sync-dev.ps1`, and the
browser/Grid Solver smoke checks.

**Verification command, if independent re-confirmation of the twelve S0–S3 CSV hashes is wanted**
(operator-run; not executed by the model):

```powershell
Get-ChildItem 'D:\backups\afldb\issue-222\s74-20260919-issue222-retry2\S0','D:\backups\afldb\issue-222\s74-20260919-issue222-retry2\S2' -Filter *.csv |
  Group-Object Name | ForEach-Object {
    $h = $_.Group | Get-FileHash -Algorithm SHA256
    "{0}: {1}" -f $_.Name, ((($h.Hash | Sort-Object -Unique).Count -eq 1) ? "MATCH $($h.Hash[0])" : "MISMATCH $($h.Hash -join ' vs ')")
  }
Get-ChildItem 'D:\backups\afldb\issue-222\s74-20260919-issue222-retry2\S1','D:\backups\afldb\issue-222\s74-20260919-issue222-retry2\S3' -Filter *.csv |
  Group-Object Name | ForEach-Object {
    $h = $_.Group | Get-FileHash -Algorithm SHA256
    "{0}: {1}" -f $_.Name, ((($h.Hash | Sort-Object -Unique).Count -eq 1) ? "MATCH $($h.Hash[0])" : "MISMATCH $($h.Hash -join ' vs ')")
  }
```

**Files changed by this pass:** `AFLDB-ISSUE-222.md` (this section), plus short pointer additions
to `issues.md` and `IssuesIndex.md`. No code, test, or canonical bridge/child artefact changed.
No database, Git, network, import, backup, or deployment command was run; ISSUE-224 and ISSUE-225
were not touched.

#### 11.19.17 DEV child exported and independently validated: `validate_person_bridge_child.py` generalised to `--target {test,dev}` (no database, Git, network or deployment command run) (2026-09-19, Opus 5)

**Root cause of the gap.** `validate_person_bridge_child.py` already exposed `--child`, but its
`EXPECT` block and its pinned-lineage defaults were hard-coded to the v2 `afldb_test` child, and
check 5.1 compared the *pinned v1 child's* `target` against `EXPECT["target"]` — so the historical
`afldb_test` v1 child could only satisfy it while the validated target was also `afldb_test`. The
earlier DEV run omitted `--child`, so it validated the `afldb_test` child and compared its
`b996c60e…` hash against the DEV hash; those passes were not DEV validation.

**Change (smallest fail-closed generalisation).** An explicit closed target selection
`--target {test,dev}`, default `test`:

- `test` is unchanged in every respect — pinned child, pinned hash, `TOOL_VERSION` 1.0.0 and every
  check name. Re-run on the real `afldb_test` child it reproduces `summary_sha256`
  `5bc5336be116cc797b011900b3fdbc010cd4dd59a9eba4c4495c321f7e6ce590` exactly, and
  `validate_validation_review.py` check 1.3 (in-process re-validation against that pinned digest)
  still passes.
- `dev` defaults nothing: `--child` and `--expect-sha256` are both mandatory, the hash must be 64
  lowercase hex, the `afldb_test` child is refused three ways (pinned path, `.afldb_test.json`
  name, pinned bytes under any name), and the child's own `target` field must be exactly `dev` —
  the exporter's real `TARGET_DSN_ENV` label, pinned against that module's source by the contract.
  No PROD target, no arbitrary target string, no DEV path or hash hard-coded anywhere.
- Target-independent v1→v2 **source-evidence** lineage still runs against the pinned historical
  `afldb_test` v1 child for either target; section 5 and checks 5.1/5.2/6.1/6.2 now name that
  baseline explicitly under `--target dev`, so no report line claims it is a DEV deployment. No
  lineage check was weakened. The DEV expectation pins the operator-reported DEV measurement
  (3,468 / 1,589 / 13,275); a different DEV measurement is a refusal, not a pass.

**DEV child validated (model-run, read-only, DB-free).**
`data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json`, sha256
`a9652e4a6ca96ced32d64d36cb0a3a1b6cdf1e2591927e628753b399c6647c95`, `target: "dev"`,
`parent_sha256 ad25d965…`, 3,468 bridges / 1,589 withheld (1,493 `U-no-href`, 94
`target_not_registered`, 2 `different_person_wrong_href`), `target_registration.count` 13,275 —
**all 48 checks PASS**, exit 0, `summary_sha256`
`cd8d6da2675cdd25828bfc6a92496b0cd511bbf425c078052d862b0a623ad9c5`.

**Consequence the operator must decide (not a defect).** Editing the validator changes its source
sha256 (`35c41602e6602b23b4231a3dd3c7e962b3ccece332b04eed8b605889d9b77437` → new), and that hash is
frozen into the accepted Phase F artefacts. `validate_validation_review.py` now reports
`FAIL 2.5 … drifted ['validate_person_bridge_child']` → `ACCEPTANCE: NOT ACCEPTED`, which is the
designed "any tool change voids the review" alarm firing on a *post-acceptance* tooling change:
check 1.3 confirms the child's validation is bit-identical to the accepted one. Options are to
record Phase F as closed at source hash `35c41602…` (the acceptance evidence
`63c89265…` stands), or to re-freeze by regenerating the Phase F sample/review artefacts under a
new salt — an operator decision, not taken here.

**Validation run (DB-free only).** `py_compile` on both changed Python files; the extended
`tests/python/draftguru_child_validation_contract.py` (existing sections 1–5 unchanged and
passing, plus a new section 6 of 32 target-selection checks); the real-lineage `test` run
(`5bc5336b…`) and the real `dev` run above; `npx vitest run tests/draftguru-acquisition.test.ts`
— 161 passed, 3 skipped, 2 failed, **both pre-existing and unrelated**: the `GRID_DRAFT_TYPES`
mapping contract (AFLDB-ISSUE-223) and check `41z` in
`draftguru_bridge_operator_review_contract.py` (the committed
`bridge-operator-verdicts-20260918-v1.md` hashes `2ce361f6…` against a pinned `60c529df…`; that
contract references neither changed file and the artefact is unmodified in the working tree —
worth a separate look, not touched here). `git diff --check` clean.

**Files changed by this pass:** `tools/rebuild/draftguru/validate_person_bridge_child.py`,
`tests/python/draftguru_child_validation_contract.py`,
`tools/rebuild/draftguru/README.md`, `AFLDB-ISSUE-222.md` (this section and the §11.19.15 step-4
command), plus pointer lines in `issues.md` and `IssuesIndex.md`. The DEV child, both canonical
parents, the `afldb_test` children, every verdict/reconciliation/sample artefact, ISSUE-224 and
ISSUE-225 were not touched. Nothing was staged or committed. **AFLDB-ISSUE-222 is not Resolved**:
the DEV import, its independent verify, `sync-dev.ps1` and the browser/Grid Solver smoke checks
remain.

#### 11.19.18 Governance decision: Phase F stays accepted at its frozen source hash; the `--target` generalisation is Phase 4b tooling, not a Phase F regeneration (operator decision, 2026-09-19)

**Decision (operator, dated 2026-09-19, prospective — governs this and any later tool change of
the same shape).**

1. **Phase F remains accepted at its original frozen source hash**
   `35c41602e6602b23b4231a3dd3c7e962b3ccece332b04eed8b605889d9b77437`, with acceptance evidence
   `63c89265…` standing unchanged. The accepted child, parent, verdicts, sample and review bytes
   underlying that acceptance are not reopened, not regenerated and not rewritten by this decision
   or by the §11.19.17 tooling change.
2. **The `--target {test,dev}` generalisation of `validate_person_bridge_child.py` is Phase 4b
   deployment tooling**, produced after Phase F's review and acceptance were already closed. It
   exists to validate the `afldb_dev` deployment child ahead of the DEV import — a task Phase F's
   scope never covered — not to redo, extend or supersede Phase F.
3. **The DEV validation this tooling produced (all 48 checks, exit 0, `summary_sha256
   cd8d6da2675cdd25828bfc6a92496b0cd511bbf425c078052d862b0a623ad9c5`, §11.19.17) is additional
   evidence for Phase 4b, not a replacement for, or a regeneration of, Phase F.** The `test`-target
   path of the same tool remains byte-for-byte unchanged and still reproduces the pinned Phase F
   child digest `5bc5336be116cc797b011900b3fdbc010cd4dd59a9eba4c4495c321f7e6ce590` (check 1.3 of
   `validate_validation_review.py` confirms this).
4. **The current `validate_validation_review.py` check 2.5 result — `FAIL 2.5 … drifted
   ['validate_person_bridge_child']` → `ACCEPTANCE: NOT ACCEPTED` — is the expected, designed
   consequence of a post-acceptance tool-hash change, not a newly failed review.** It must not be
   reported or logged as "Phase F review failed" or "Phase F not accepted" in any later pass,
   issue entry, changelog line or operator briefing. The correct characterisation is: Phase F was
   accepted at source hash `35c41602…`; a later, unrelated tooling change changed
   `validate_person_bridge_child.py`'s own hash; check 2.5 is functioning exactly as designed by
   detecting that drift; check 1.3 independently confirms the accepted child validation is still
   bit-identical to what was reviewed.
5. **No historical acceptance artefact is rewritten by this decision.** The Phase F sample,
   review, verdicts and the `63c89265…` acceptance record are left exactly as accepted. This
   decision is recorded prospectively, alongside them, not merged into them.

**What this decision does not authorise.** It does not regenerate the validation sample, does not
change its salt, does not repeat operator review of the Phase F sample, and does not modify any
Phase F artefact. It does not touch ISSUE-224 or ISSUE-225. It does not stage or commit any file.

**Validation.** Read-only inspection only: `git status`, `git diff --check`. No database, Git
(beyond the read-only inspection commands), network or deployment command ran.

**Files changed by this pass:** `AFLDB-ISSUE-222.md` (this section), `issues.md`,
`IssuesIndex.md`, `CHANGELOG.md`. No code, test, or artefact file was changed; the validator
implementation, its tests, the DEV child bytes, the canonical parents/test children and the Phase
F sample/review/verdict artefacts are all untouched by this pass. Nothing was staged or committed.

#### 11.19.19 First real DEV pre-import attempt: validate-only and dry-run PASSED, the `plan` gate REFUSED on a target-label defect; the gate's target model split into database vs child label (2026-09-19, Opus 5)

**The attempt, reported honestly.** The operator ran the §11.19.15 item-6 steps 9-10 against
`afldb_dev` on the DEV host. **No real import ran; no linkage, person, pick or identity row was
written or committed.**

1. `import_draftguru.py --validate-only --bridge …afldb_dev.json` — **PASSED**: 5,057 persons,
   6,810 picks, 3,468 child bridges, **no database contact**.
2. `import_draftguru.py --dry-run --bridge …afldb_dev.json` — **PASSED** against target
   `afldb_import@localhost:5432/afldb_dev`: authority ledger 6, authority bridge 3,465, authority
   unmatched 1,587, authority seeded 0; **all data writes rolled back**. As designed, the dry run
   retained exactly **one `import_batches` audit row with `status=failed` and the
   `DryRunComplete` marker** — the tool's deliberate audit-trail behaviour, not a failure of the
   run and not a data change.
3. `bridge_import_gate.py plan --target dev --bridge …afldb_dev.json` — **REFUSED**, before any
   plan output, with:

       ERROR: REFUSED: the child targets 'dev', not afldb_dev

   The refusal was fail-closed and correct in spirit — nothing proceeded — but the check itself
   was wrong, so the DEV import stopped here.

**Failed plan transcript (preserved outside the repository):**
`/home/arm/backups/afldb/issue-222/dev-plan-20260919-preimport.txt`.

**The `afldb_dev` recovery point taken before step 9 remains valid and untouched:**
`/home/arm/backups/afldb/afldb_dev-20260919-102636.dump`, sha256
`0768fe01cc93aab3a0ba8e6307ccc7d1545baa3369eb727bf77b39806be7e005`.

**Exact root cause.** `bridge_import_gate.load_child()` compared the child artefact's own `target`
field with the **physical database name** (`required_database`, i.e. `afldb_dev`). The child's
`target` field is not a database name: it is the exporter's `--resolve-against` label, copied
verbatim by `export_person_bridge.build_deployment_dataset()`. That vocabulary is **asymmetric**
by accepted contract — `export_person_bridge.TARGET_DSN_ENV` maps `"afldb_test" -> afldb_test` and
`"dev" -> afldb_dev` — so the accepted `afldb_test` child carries `"afldb_test"` (which merely
*happens* to equal its database name) while the accepted `afldb_dev` child carries `"dev"`. The
gate's single `required_database` field conflated two different things and was only ever correct
for the `test` target, where the two coincide by accident. `validate_person_bridge_child.py`
already modelled this correctly (`TEST_TARGET_LABEL` / `DEV_TARGET_LABEL`, §11.19.17); the gate
did not.

**Target mapping, before and after.**

| `--target` | `current_database()` guard | accepted child `target` — BEFORE | accepted child `target` — AFTER |
|---|---|---|---|
| `test` (default) | `afldb_test` | `afldb_test` (= database name) | `afldb_test` (`child_target`, equal by specification) |
| `dev` | `afldb_dev` | `afldb_dev` ← **wrong; no exporter run ever produces it** | `dev` (`child_target`, the exporter's real label) |

**Change (smallest fail-closed correction; no alias, no child edit).** `TARGETS` now carries
`database` (physical: the DSN path check and the `current_database()` assertion) and
`child_target` (the artefact label) as **separate fields**; new module constants
`TEST_CHILD_TARGET = "afldb_test"` and `DEV_CHILD_TARGET = "dev"` match
`validate_person_bridge_child.py`'s literals exactly. `load_child()`'s third target parameter is
now `expect_child_target` and compares against the label, never the database name; its refusal
message states the distinction. A new `refuse_test_child_under()` helper concentrates the
afldb_test-child DENY rules and adds the two the gate was missing relative to the validator: the
`.afldb_test.json` **name** rule and the pinned-**bytes** rule (a rename no longer launders the
test child into a DEV run). No loose alias was added, no child artefact was edited, and no
existing refusal was weakened.

**Every safety property preserved (verified by the contract, not asserted):** default target is
still `test` and every no-`--target` invocation is unchanged in behaviour; `--target dev` still
requires an explicit `--bridge`; DEV refuses the `afldb_test` child by path, name, bytes and
target; `test` refuses the DEV child; `prod`/unknown/empty targets remain impossible; the DEV
`current_database()` guard remains exactly `afldb_dev` (a server reporting the *label* `dev` is
refused); `AFLDB_DEV_DATABASE_URL` remains separate and mandatory; session read-only, REPEATABLE
READ, the `SELECT`-only cursor and unconditional rollback-and-close are untouched; no import or
owner DSN fallback exists; the gate still writes nothing, to disk or to any database. The gate's
printed output and hashed summary payload are unchanged, so the §7.4 transcript fixture in
`tests/s74-rollback-exercise-gate-parsing.test.ps1` and every recorded `summary_sha256` still
describe the current tool.

**Regression coverage added (DB-free) in `tests/python/draftguru_import_gate_contract.py`:**
2b.0aa (`database` and `child_target` are separate fields and differ for `dev`); 7.8/7.9 (a server
whose `current_database()` is the label `dev` is refused; the DEV physical guard stays
`afldb_dev`); 8.1-8.3 (`afldb_test` label refused under `dev`, the real `target: "dev"` shape
accepted under `dev`, refused under `test`); 8.4 (a child mislabelled `afldb_dev` refused under
`dev`); 8.5-8.7 (the bytes and name DENY rules fire under `dev` and never under `test`);
8b.1-8b.4 (the **real committed** DEV child hashes to `a9652e4a…`, declares `target: "dev"`, is
accepted under `dev` and refused under `test`; the real `afldb_test` child still loads with its
pinned hash and counts); 8b.5 (each target's `child_target` -> `database` mapping equals
`export_person_bridge.TARGET_DSN_ENV`, read from that module's source by `ast` without importing
its database surface); 9.5-9.6 (an end-to-end CLI `plan --target dev` over the **real** DEV child
is no longer refused on its target label and passes every offline guard — pinned child bytes, the
v2 `parent_sha256` chain, the Stage A snapshot — stopping only where it would open a connection).
Sections 1-7 are otherwise unchanged and still pass, including the DEV `plan`->`verify`
deterministic parity checks (7.1-7.6).

**Validation (DB-free only).** `python -m py_compile` on both changed Python files;
`python tests/python/draftguru_import_gate_contract.py` — **all checks hold**, exit 0;
`python tests/python/draftguru_child_validation_contract.py` — all checks hold (unchanged tool,
run to confirm the two tools' target literals still agree);
`npx vitest run tests/draftguru-acquisition.test.ts` — 161 passed, 3 skipped, **2 failed, both
pre-existing and unrelated** and identical to the two recorded in §11.19.17: the `GRID_DRAFT_TYPES`
mapping contract (AFLDB-ISSUE-223) and check `41z` in
`draftguru_bridge_operator_review_contract.py` (the committed
`bridge-operator-verdicts-20260918-v1.md` hashes `2ce361f6…` against a pinned `60c529df…`);
`npx vitest run tests/draftguru-acquisition.test.ts -t "bridge import gate"` — 2 passed, 164
skipped; `git diff --check` — clean. The real DEV child and the real `afldb_test` child are
**byte-identical** to `59a67a9e`
(`a9652e4a6ca96ced32d64d36cb0a3a1b6cdf1e2591927e628753b399c6647c95` and
`b996c60e9d4de3aeb6f250f360b2a66164a2211b9604338a65918e79fa29e1c5`).

**Next plan must use a NEW evidence filename.** The failed transcript
`/home/arm/backups/afldb/issue-222/dev-plan-20260919-preimport.txt` is retained evidence and must
never be overwritten; the retry writes
`/home/arm/backups/afldb/issue-222/dev-plan-20260919-preimport-retry1.txt`. The step-9 dry run does
**not** need repeating (it passed and its retained `status=failed` / `DryRunComplete` audit row is
expected); resume at §11.19.15 item-6 step 10 with the corrected gate, once the fix below is
committed and deployed to the DEV host.

**Database/Git/network/deployment actions this pass: none.** No `psql`, no `import_draftguru.py`,
no `bridge_import_gate.py` against a real connection, no backup, no export, no Git mutation, no
`sync-dev.ps1`, no Gridley run. AFLDB-ISSUE-224 and AFLDB-ISSUE-225 were not touched. No child,
parent, verdict, reconciliation, sample or review artefact was modified.

**Files changed by this pass:** `tools/rebuild/draftguru/bridge_import_gate.py`,
`tests/python/draftguru_import_gate_contract.py`, `tools/rebuild/draftguru/README.md`,
`AFLDB-ISSUE-222.md` (this section), `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`. Nothing was
staged or committed. **AFLDB-ISSUE-222 remains open**: the DEV `plan`, the real DEV import, its two
independent verifies, `sync-dev.ps1` and the browser/Grid Solver smoke checks are still ahead.

#### 11.19.20 Second real DEV pre-import attempt REFUSED on 6.4/6.6/6.7 — root cause is a Stage A **label** mismatch, not drift; `--link-only` designed, implemented and DB-free proven (2026-09-19, Opus 5)

**No database, import, dry-run, backup, Git, network, deployment or Gridley command was run by
the model in this pass. Nothing is staged or committed.**

##### 1. What the retried plan refused on

`bridge_import_gate.py plan --target dev` (transcript
`/home/arm/backups/afldb/issue-222/dev-plan-20260919-preimport-retry1.txt`) cleared every target,
child and authority guard and then refused exactly three checks:

| Check | Refusal |
|---|---|
| 6.4 | 92 `draft_persons` non-link changes, fields `reported_games` / `reported_goals` |
| 6.6 | 128 `draft_picks` non-link changes, same two fields |
| 6.7 | 5,057 `external_identities(draftguru)` `notes` changes — i.e. **every** row |

##### 2. Root cause — a label, not drift

`afldb_dev` was loaded from **`annual-html-20260902`**; the gate and the importer both defaulted
to **`annual-html-20260826`**.

* `CHANGELOG.md` (2 September 2026) records `annual-html-20260902` as **the accepted** Stage A
  snapshot and `annual-html-20260826` as *"historical and superseded"*, and closes with the
  operational note that a rebuild must pass `--draftguru-label annual-html-20260902` "until that
  default is repointed". Every rebuild from ISSUE-102/112/113/118 did so. The CLI default was
  never repointed.
* `reconcile_draftguru_identities()` writes `notes = f"stage_a_snapshot={label}"` on **every**
  identity row unconditionally, so a label change rewrites all 5,057. The count *is* the
  signature.
* `reported_games` / `reported_goals` are the only stored columns derived from the annual pages'
  volatile Games/Goals cells (`build_picks()`, `max()` per person, copied onto every pick of that
  person). The two acquisitions are a week apart **inside the 2026 season**, so those cells moved;
  92 persons → 128 picks is the person→pick fan-out for re-listed players.
* Offline comparison of the two tracked manifests: identical in **every** structural field —
  `parity` (status PASS, `csv_total_rows` 6810, event totals, special-pick totals),
  `identity_validation`, `schema_variants`, `trade_column_profile`, `person_pages`,
  `known_coverage_gaps`, and the per-page `url`/`raw_filename`/`year` lists — differing only in
  label, extraction timestamps, `working_directory` and all 42 raw sha256s. The changelog's
  "render drift only (CSRF token + a `Content-Type` change on 13 pages)" acceptance is not
  contradicted: **the `parity` block never hashes the Games/Goals cell values**, so a genuine
  week-of-football movement in those two columns was simply never measured by it.

This was foreseen. §11.19.1's import-scope table already said: *"if `afldb_test` was last loaded
from `annual-html-20260902`, every `notes` value … would change — the plan refuses on that and
the label question must be settled first"*. `afldb_test` was in fact last loaded from
`annual-html-20260826`, which is why its own plan showed zero non-link changes; `afldb_dev` was
not. The two databases sit on two different accepted snapshots.

**Verdict: a deterministic pinned-source label mismatch, not unexplained drift.** A normal import
would have been a *regression*, not a refresh: it would move DEV's source-owned data onto a
retired snapshot and stamp `stage_a_snapshot=annual-html-20260826` on all 5,057 identity rows,
contradicting the tracked acceptance register.

##### 2a. Why the obvious fix is unavailable

Re-running the import with `--label annual-html-20260902` needs that snapshot's 42 raw pages.
Exhaustive local and DEV-host searches found no accepted raw page directory or archive. They
cannot be re-acquired: the pages are Rails-rendered and carry a per-render CSRF token, so a
refetch would create a **third** label rather than reproduce the accepted bytes. Operator
decision 2026-09-19: **do not reacquire.**

##### 2b. Why approving the change was rejected

Approving 6.4/6.6/6.7 is also not self-consistent with the existing gate. `baseline_sha256`
includes `draft_persons_draftguru_nonlink` and `draft_picks_draftguru_nonlink`; an approved
import moves both, so `verify`'s check **8.14 would then fail**. Approving the refusal would cost
the post-import verification contract as well as the data.

##### 3. Decision (2026-09-19): implement a fail-closed `--link-only` mode

Apply only the already-reviewed trusted linkage to the existing `afldb_dev` DraftGuru population;
reload and rewrite no source-owned Stage A data. The mode is built from the stored population, the
pinned deployment child, the target's registered AFL Tables identities and the tracked ledger plus
live decisions — never from a snapshot. See `tools/rebuild/draftguru/README.md` §`--link-only` for
the full contract.

**Committed write set**

| Table | Columns |
|---|---|
| `import_batches` | one row; `notes` = `mode=link_only stage_a_snapshot=<label> bridge_sha256=… parent_sha256=…` |
| `draft_persons` | `player_id`, `link_status`, `match_method`, `confidence_notes`, `is_matching_backlog` |
| `draft_picks` | `player_id`, `link_status_value`, `match_method`, `confidence_notes` |
| `external_identities` (`draftguru`) | `player_id`, `status`, `match_method` |

**Two columns beyond the three named in the task specification, and why.** The specification asked
for `player_id`, `link_status`, `match_method` only.

* `is_matching_backlog` is **structurally mandatory**: migration 019's
  `draft_persons_backlog_ck` is `NOT is_matching_backlog OR (player_id IS NULL AND
  COALESCE(reported_games,0) > 0)`. Setting `player_id` on a person the row still flags as backlog
  violates the CHECK and the statement fails, so the narrow three-column set cannot commit at all.
* `confidence_notes` is the link's own provenance (`draftguru person-page bridge -> <identity>`).
  Omitting it leaves ~3,465 newly linked persons carrying provenance describing the previous
  decision — a false audit trail — and fails the gate's existing verify check **8.4**, which would
  then have to be weakened. Writing it keeps every existing gate check intact.

Both are link-derived; neither is a Stage A fact. The resulting set is exactly the gate's
already-reviewed `LINK_COLUMNS` / `PICK_LINK` vocabulary, so checks 6.4/6.6/6.7 keep their
existing non-link definitions rather than acquiring a second vocabulary.

##### 4. Implementation

`import_draftguru.py` gains a **separate** entry point and write path (`main_link_only()`,
`validate_link_only()`, `run_link_only_import()`) rather than a flag threaded through the full
reload, so `run_import()` and `validate()` contain no `link_only` branch and cannot drift. Three
set-based `UPDATE`s, one per table, each scoped to the DraftGuru `source_id`, keyed on the stored
row's natural key, each carrying an `IS DISTINCT FROM` guard so a re-run is a genuine no-op. No
`INSERT`/`DELETE`/`COPY`/temp table/`SET CONSTRAINTS`; `replay_admin_overrides` is not called;
`players` is never touched. `common.import_batch()` gained an optional `notes=None` parameter —
additive, every existing caller passes at most four positional arguments and stores `NULL` exactly
as before.

`bridge_import_gate.py` gains `--link-only`, which models that write set. Checks 6.4/6.6/6.7 are
**proven, not skipped**, in three layers: the write-set half reads the `SET` clause of the
importer's own statements back through `set_clause_columns()`; `6.4a`/`6.6a`/`6.7b` require the
modelled after-state to differ in nothing else; and `verify`'s new `8.15` re-reads four
server-side digests (`draft_persons_draftguru_nonlink`, `draft_picks_draftguru_nonlink`,
`external_identities_draftguru_nonlink`, `draft_picks_draftguru_batch_ids`) and requires the
`baseline_sha256` they belong to to equal the plan's. The last two digests are added **only** in
link-only mode, so the full path's `baseline_sha256` stays byte-identical to every value already
recorded against `afldb_test`. `8.12` is inverted (no pick may be re-stamped) rather than dropped;
`8.10`/`8.10a` require exactly one completed batch declaring `mode=link_only` and the asserted
label.

##### 5. Validation (DB-free only)

`tests/python/draftguru_link_only_contract.py` (new) — **120/120 PASS**. Includes two falsifiable
RED proofs: a smuggled extra `SET` column is detected by `link_only_write_set()`, and a moved
non-link digest makes `verify` refuse on 8.14/8.15. Also proves at runtime that
`validate_link_only()` completes with every Stage A entry point booby-trapped.

`draftguru_import_atomicity_contract.py` and `draftguru_import_gate_contract.py` both still pass
**unchanged**, which is the proof that the full reload and the gate's full mode are untouched.
`tests/draftguru-import.test.ts` 46/46 pass; `tsc --noEmit` clean; `eslint` unchanged at the
same 49 pre-existing errors in `draftguru-acquisition.test.ts` (0 in added code, proven against a
pristine HEAD worktree); `git diff --check` clean.

Six DB-free vitest failures remain repository-wide, **all pre-existing**: the `GRID_DRAFT_TYPES`
vocabulary test (AFLDB-ISSUE-223), the operator-review `41z` Markdown hash and
`finals-semantics-contract` (both Windows CRLF, reproduced on a pristine HEAD worktree), two
`honours-lifecycle-public-contract` scans (same), and one `fitzroy-core-import` case that needs a
live database (`psycopg.errors.ConnectionTimeout` in `connect_pg`, untouched code).

##### 6. Not done in this pass

The default Stage A label was **not** repointed; no child, parent, manifest, sample, verdict or
review artefact was touched; ISSUE-224/225 were not touched; no `20260902` page was reacquired,
copied or fabricated.

**Files changed by this pass:** `tools/rebuild/draftguru/import_draftguru.py`,
`tools/rebuild/draftguru/bridge_import_gate.py`, `tools/migration/common.py`,
`tests/python/draftguru_link_only_contract.py` (new),
`tests/python/draftguru_import_gate_contract.py`, `tests/draftguru-import.test.ts`,
`tests/draftguru-acquisition.test.ts`, `tools/rebuild/draftguru/README.md`,
`AFLDB-ISSUE-222.md` (this section), `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`. Nothing was
staged or committed. **AFLDB-ISSUE-222 remains open**: the DEV link-only validate-only, dry-run,
plan, real import, two independent verifies, `sync-dev.ps1` and the smoke checks are still ahead.
