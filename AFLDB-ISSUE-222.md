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

Acceptance: `H-linked` = 5 and `H-unlinked` = 1 (the ledger, unchanged); `B-linked` = the
deployment dataset's `bridges.length` **exactly** (= the importer's `authority: bridge`);
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
`--dry-run` (must report `authority: bridge` = the DEV dataset's `bridges.length`, `ledger` and
`live_override` consistent with Q6, and **0 HALTs**) → real run → §6.1 and §6.4 on DEV (live
decisions reproduced exactly; manual picks and overrides intact against Q7) → build/restart →
§6.6 browser checks. The importer runs inside one transaction: a HALT rolls everything back and
leaves the failed `import_batches` row as the audit. Live human decisions win over the bridge by
construction; `data_overrides` are replayed inside the same transaction.

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
