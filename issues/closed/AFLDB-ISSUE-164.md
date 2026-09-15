# AFLDB-ISSUE-164 — Recalibrate player-link confidence and expand evidence-aware bulk matching

**Status:** RESOLVED 2026-09-12 — **P0, P1 (comparison half), P2, P1a, P1b, P1c, P3A/P3B, P4 and
P5 (closeout) all COMPLETE, final operator validation COMPLETE.** Shipped policy:
`ALGORITHM_VERSION` = `v3`, S3 = 15 / S4 = 15, draft frozen, **D-9 in force**. P4 (§12 P4)
admitted **no new bulk class**, found **0 newly bulk-eligible rows**, proved stale-cache
integrity and a current-code approval live on dev, proved the bulk path by test rather than by a
live `bulk_suggested` write, and recorded that **no product-level unlink/reversal workflow
exists**. §13 items 3a, 6 and 7 are met; **item 2b is deliberately unmet** — P1c's Tier 1
labelling run left the draft population at 5 / bulk-eligible n = 0, so the §9.1 standard cannot
be met from this tranche's evidence and D-9 stays in force; this is the runbook's own stop
condition working, not a blocker to closure (§13 item 2b, §16). Final DB-free and DB-backed
validation (P5.4, 2026-09-12) is green; see §12 P5.4 and §13.

*Superseded status line, kept for history:* "P1c DESIGN AND RECONCILIATION COMPLETE 2026-09-12,
its labelling run outstanding (operator). Next phase: P3, which cannot start until the P1c
population exists." P1b measured
the normalisation-only change with no regression anywhere and no bulk-eligible draft row
(§12 P1b record). P1c reconciled the five-row draft population to its cause, ranked the
admissible truth sources, and built the evaluation tooling; it did **not** produce the
population, and D-9 therefore remains in force (§12 P1c record). The rest of the §12 P1
instrumentation list is still unbuilt and was not required by P1b or P1c.** No scoring weight, no
band, no gap and no bulk threshold has been changed. Two deliberate policy changes ship with
P1a, both pre-decided: `ALGORITHM_VERSION` → `v2` (D-8) and `draft_person` suspended from
unattended approval (D-9). Every code claim below cites the file and line it was read from at
base `0955db3` on `sonnet/issue-164-player-link-confidence`; every P0 figure is the operator's
own measurement (§2.10, §12 P0).

**Operator sign-off 2026-09-12 (first pass):** D-1, D-2, D-3, D-4, D-6 and D-7 approved as
written. D-5 amended before approval (see §17): Hall of Fame stays non-bulk by default and may
be admitted only under the pre-declared rule in §9.1, frozen before any v2 result is inspected.
Stale cached scoring is an integrity-of-presentation requirement (§10 item 13, §11 item 4,
§12 P2), not optional polish.

**P0 revision 2026-09-12 (second pass):** P0 proved that the 79-point draft plateau is a
**source-text normalisation defect** (U+00A0 in every `draft_persons` name; §2.10, §3.1), not
weight insufficiency, and that the 44-point historical rows are genuine namesake ambiguity.
Consequences: D-2 is **amended and approved** (normalisation before aliases, §17); the phase
order gains a normalisation-first sequence P1a → P1b → P1c ahead of any recalibration (§16,
D-7 amended); the executable v1 baseline is 6,324 labelled rows, not the 9,356 of ISSUE-075
(§2.10); the labelled `draft_person` population is **5 rows**, so nothing in the current
baseline validates draft matching or draft bulk policy (§9.1, §12 P1c).

**Operator sign-off 2026-09-12 (third pass):** D-7 approved as amended with the final order
P0 → P1 → **P2** → P1a → P1b → P1c → P3 → P4 → P5. D-8 decided: the normalisation fix ships
under the next algorithm version (`v2`), so P2 precedes P1a. D-9 decided: `draft_person`
unattended bulk approval is suspended in the P1a change set until P1c re-gates it under §9.1;
suggestions and manual approval remain. All decisions D-1 … D-9 are now signed off; no
decision is pending.

**Parent work:** `AFLDB-ISSUE-075` (the deterministic suggestion/confidence system, resolved
2026-08-22; `issues.md:4540-4722`).

**Planning model:** Fable 5.1, medium.

---

## 1. Problem statement

The `/admin/player-links` suggestion system scores every unresolved source row against a
candidate set with one additive, explainable policy (`MATCH_POLICY`). Three populations are
under-served by that policy, not by the evidence:

1. **Modern draft rows** whose name *visually* matches exactly, with the drafting club in the
   player's club history, draft-year-before-debut, and matching draft-source games/goals
   plateau at exactly **79 / High**, never Very High and never bulk-ready. **P0 finding:** the
   name is *not* an exact match to the scorer because every `draft_persons.display_name_raw`
   uses U+00A0 (no-break space) as its word separator and `afldb_normalise_name()` preserves
   it; the row falls through to `name_trigram_high` (26) instead of `name_exact` (44). This is
   a text-normalisation defect in the evidence layer, not a weighting problem (§2.10, §3.1).
2. **Historical award/honour rows** (Hall of Fame, honour teams, some `award_winners`) with an
   exact normalised name and no competing candidate sit at exactly **44 / Low** and, when a
   namesake exists, **Needs review**. **P0 finding:** the named examples are genuine unresolved
   namesake ambiguity (two or three exact-name candidates tied at 44, gap 0); they need
   additional evidence, not a name-weight change (§3.2).
3. The bulk-ready population is limited by (1) and (2), so the queue cannot shrink without a
   human touching every one of those rows.

The objective is to raise trustworthy Very High and bulk-ready counts **without** weakening the
false-positive protections already measured, and to make every remaining cap explainable on
the page. Two baselines exist and must not be conflated: the **historical ISSUE-075
calibration** (9,356 links; top-1 99.69%, Very High precision 99.99%, bulk precision 100%
after the class gate) and the **current executable v1 baseline** frozen by P0 (6,324 labelled
rows; top-1 99.64%, Very High precision 99.98%, bulk precision 100%; §2.10). Acceptance gates
in §13 are measured against the current executable baseline.

---

## 2. Current architecture (verified)

### 2.1 Candidate generation — `src/db/queries/player-match-candidates.ts:295-462`

Three index-backed arms per source row, unioned inside one `LATERAL` (lines 314-323):

| Arm | Predicate | Cap |
|---|---|---|
| exact name | `players.search_name = afldb_normalise_name(raw)` | none |
| exact alias | `player_name_aliases.search_alias = normalised` | none |
| trigram neighbourhood | `search_name % nname`, ordered by `similarity DESC, id`, then filtered `similarity >= 0.45` (`blocking.trigramFloor`) | 20 (`trigramCandidatesPerSource`) |

Per-source cap 25 (`maxCandidatesPerSource`), exact and alias sorted first so only fuzzy tail
is discarded (lines 445-459). `nameSimilarity` is `GREATEST(similarity(search_name), max
alias similarity)` computed in SQL (lines 331-335). Club history comes from `player_clubs`
(lines 351-370); `clubHistoryComplete` = `sum(player_clubs.games) == player_career_stats.games`
(lines 415-417). Uniqueness collisions are looked up only for `honour_team_members` by
`team_name` (lines 372-401).

Normalisation (`afldb_normalise_name`, migration 009:18-30): lowercase, unaccent, strip
`' \` . ,`, turn `- _ /` into spaces, collapse whitespace. Generational suffixes ("Jnr", "Jr",
"Sr", "Snr") are **not** stripped.

**P0 defect (operator hex evidence, 2026-09-12):** the whitespace step handles ordinary ASCII
space only. A source name whose separator is U+00A0 (UTF-8 `c2 a0`; e.g. `Aaron<NBSP>Cadman`,
bytes `4161726f6ec2a04361646d616e`) is lowercased but the NBSP is preserved, so the normalised
source string is never byte-equal to `players.search_name` and the exact arm never fires. The
row reaches the candidate only through the trigram arm (similarity typically 1.00) and is
scored `name_trigram_high` (26), not `name_exact` (44), and fails `strongName`. Measured scope:
**5,057 / 5,057 `draft_persons` rows (100%) contain U+00A0**; 5,052 are `unmatched`, 5 are
`resolved`. This is a systematic source/text-normalisation defect over the whole draft
population, not a handful of malformed names. Whether other source tables carry Unicode
whitespace is **not yet measured** (P1a must check before choosing the fix's breadth).

### 2.2 Source evidence per table — `player-match-candidates.ts:157-269`

| Source (resolution grain) | club_id | active season (scope) | draft year | induction | span | games/goals |
|---|---|---|---|---|---|---|
| `award_winners` | yes | season, **external** | – | – | – | – |
| `award_nominations` | yes | season, afldb | – | – | – | – |
| `hall_of_fame` | **NULL** (only `club_name_raw`) | – | – | `inducted_year` | `playing_career` text | – |
| `honour_team_members` | **NULL** (only `club_name_raw`) | – | – | – | – | – |
| `captaincies` | yes | season, afldb | – | – | – | – |
| `player_achievements` | yes | season, afldb | – | – | – | – |
| `draft_person` (via first pick) | first pick's club | – | first pick's `draft_year` | – | – | `reported_games`, `reported_goals` |

`toTemporal` (lines 94-118) labels each year: `active_season`, `draft_year`, `induction_year`,
`active_range`. Induction year and draft year never reach the era scorer (`types.ts:63-86`).

### 2.3 Scoring — `src/lib/player-matching/score-candidate.ts`, weights in `confidence.ts:21-67`

One signal per family, first match wins (`score-candidate.ts:14-28`):

| Family | Signal | Points | Condition (score-candidate.ts) |
|---|---|---|---|
| name | `name_exact` | 44 | `searchName === normalisedName` (86) |
| name | `name_alias_exact` | 41 | alias equality (89) |
| name | `name_trigram_high` | 26 | similarity ≥ 0.90 (97) |
| name | `name_surname_initial` | 20 | same last token + compatible first initial (106-118) |
| name | `name_trigram_medium` | 15 | similarity ≥ 0.75 (120) |
| club | `club_in_season` | 36 | source club row covers an **active season** (142-159) |
| club | `club_anywhere` | 15 | source club in `player_clubs` at any time (160-165) |
| era | `era_season_in_career` | 17 | every active season inside `[debut, final]` (184) |
| era | `era_season_near_career` | 9 | worst season ≤ 1 outside (192) |
| career_span | `career_span_exact` | 17 | asserted span == AFLDB range (213) |
| career_span | `career_span_overlap` | 9 | spans overlap (221) |
| draft_timing | `draft_year_before_debut` | 13 | `0 ≤ debut − draftYear ≤ 3` (242) |
| draft_games | exact / near | 15 / 7 | diff 0 / ≤ 2 (251-277) |
| draft_goals | exact / near | 10 / 5 | diff 0 / ≤ 2 |

Score is `min(100, sum)` (line 417). `corroboratingFamilies` counts distinct families with
`draft_games`+`draft_goals` folded into one `draft_stats` group (379-389). `strongName` is true
only for `name_exact` / `name_alias_exact` (422-423).

### 2.4 Contradictions — `score-candidate.ts:292-369`

| Reason | Fires when |
|---|---|
| `season_outside_career` | an **afldb-scoped** active season is > 1 season outside a complete career (games > 0) |
| `club_not_in_history` | source has club_id AND an afldb-scoped season AND `clubHistoryComplete` AND club absent |
| `career_span_no_overlap` | asserted span shares no season with a complete career |
| `uniqueness_collision` | honour-team slot already occupied by this player |

Reported games/goals are never a contradiction (361-366). Any conflict caps the band to `low`
(`confidence.ts:213-215`) and blocks bulk (`confidence.ts:273`). `plmc_bulk_ck` (migration
067:78) enforces `NOT bulk_eligible OR NOT hard_conflict` at the cache.

### 2.5 Bands, gap, ambiguity — `confidence.ts:100-109, 199-265`

| Band | Score | Gap (null gap = alone = passes) |
|---|---|---|
| very_high | ≥ 85 | ≥ 15 |
| high | ≥ 70 | ≥ 10 |
| medium | ≥ 55 | – |
| low | ≥ 40 | – |
| none | < 40 | – |

`gap = best.score − alternatives[0].score` measured against the next candidate **including
conflicted ones** (228-226 comment). `nearTies` = alternatives within 5 points.
`ambiguous = nearTies > 0 || (score ≥ 70 && gap < 10)`.

### 2.6 Bulk eligibility — `confidence.ts:117-172, 267-279`; page rule `page.tsx:529`

All of: source class allowed (`award_winners`, `award_nominations`, `draft_person`,
`player_achievements` true; `captaincies`, `hall_of_fame`, `honour_team_members`, `draft_picks`
false), no hard conflict, not ambiguous, band very_high, score ≥ 90, gap ≥ 25 or alone,
`corroboratingFamilies ≥ 2` (name counts as one, so name + one other), `strongName`. The page
additionally withholds bulk from any raw-name group whose records disagree about the player
(`page.tsx:526-529`, `group.disagrees`).

### 2.7 Approval and versioning

- `resolveLinkFromSuggestion` (`src/db/queries/player-links.ts:673-752`): locks the target
  `FOR UPDATE`, re-reads the source evidence for that entity, runs `assessOneSource` inside the
  same import transaction, and refuses unless the fresh best is the approved player, no
  conflict, band ≠ none, and (bulk) still `bulkEligible`. The browser score is never read.
  The recorded `match_score` / `algorithm_version` are the fresh ones (728-729).
- Cache (`player_link_match_candidates`, migration 067) stores the top 4 ranks per entity with
  `algorithm_version`; `refreshMatchCandidates` (`player-match-candidates.ts:632-718`) is
  wholesale (`DELETE` + insert in one transaction) so every cached row carries one version.
- **Correction to the ISSUE-075 ledger wording:** approval does *not* compare the cached
  version with `ALGORITHM_VERSION`; it ignores the cache entirely and re-scores. A version bump
  therefore changes approval behaviour immediately, while the page keeps showing the old cached
  numbers until someone presses Refresh. Nothing on the page today warns that the cache is
  stale relative to the code (`page.tsx` only forwards `algorithmVersion` to the drawer footer,
  `ResolveControls.tsx:243`).

### 2.8 Explainability today — `src/lib/player-matching/describe.ts`

Evidence and conflict labels per signal (155-179); `describeBulkCriteria` (234-254) lists four
criteria but is rendered **only when the row is already bulk-eligible**
(`ResolveControls.tsx:246-255`). A row capped at High or Low shows its evidence badges and the
runner-up line, and nothing says *why* it is not higher.

### 2.9 Backtest — `tools/matching/backtest.ts`

`npm run match:backtest` (read-only DSN, refuses the import URL) over links with status
`unique`/`resolved`; reports band precision, bulk precision, score-bucket precision,
false-contradiction counts, signal frequency, per-source table, every bulk/very-high false
positive, and `--queue` mode for the live queue. `--table`, `--limit`, `--out <json>`. It does
**not** report precision per (source × score bucket), per-signal precision lift, the reachable
ceiling per row, or a policy-to-policy band-migration matrix.

**Updated by P1 (2026-09-12):** the band-migration matrix and the whole baseline-versus-candidate
comparison now exist — `npm run match:compare`, plus `--baseline` / `--compare-out` on the
backtest itself (§12 "P1 implementation record"). The other three gaps in this paragraph are
still open and are not required by P1b.

### 2.10 Executable v1 baseline (P0, operator, 2026-09-12) — IMMUTABLE EVIDENCE

Frozen at algorithm version `v1`, git commit `0955db3`. Files **`backtest-v1-baseline.json`**
and **`queue-v1-baseline.json`** in the worktree root are pre-change evidence and must never
be regenerated over those filenames after any implementation change; later runs use new
names (e.g. `backtest-p1b-normalised.json`) and are compared against these.

Environment note: the first `npm run match:backtest` attempts in the fresh worktree failed only
because it lacked `node_modules` / `tsx`; `npm ci` installed the locked dependencies and the
runs then succeeded. Those failures were environment setup, not matcher or test failures.
`npm ci` also reported 6 vulnerabilities (2 moderate, 3 high, 1 critical); that is **out of
ISSUE-164 scope** — recorded as an observation only, no `npm audit fix` and no dependency
change under this issue.

**Labelled backtest (`backtest-v1-baseline.json`):** 6,324 ground-truth rows (links with
status `unique`/`resolved` as of `0955db3`). This is the current executable population; the
9,356-link figure belongs to the ISSUE-075 historical calibration and is no longer the
baseline for this issue.

| Metric | Value |
|---|---|
| candidate-generation recall | 6,310 / 6,324 = 99.78% |
| top-1 | 6,301 / 6,324 = 99.64% |
| top-3 / top-5 | 6,310 / 6,324 = 99.78% |
| very_high | n 5,527, correct 5,526, precision 99.98% |
| high | n 5, correct 5, precision 100% |
| medium | n 270, correct 268, precision 99.26% |
| low | n 487, correct 481, precision 98.77% |
| none | n 35, correct 21 |
| bulk eligible | n 3,817, correct 3,817, precision 100%, false positives 0 |

Per source (resolution grain):

| Source | n | top-1 | very_high (precision) | bulk (precision) |
|---|---|---|---|---|
| `award_nominations` | 750 | 99.60% | 687 (100%) | 687 (100%) |
| `award_winners` | 3,468 | 99.88% | 3,130 (100%) | 3,130 (100%) |
| `captaincies` | 1,774 | 99.44% | 1,710 (99.94%, 1 FP: `captaincies#1036` Jobe Watson) | disabled |
| `draft_person` | **5** | 80% (recall 100%) | 0 | 0 |
| `hall_of_fame` | 239 | 98.74% | 0 | 0 |
| `honour_team_members` | 88 | 97.73% | 0 | 0 |

The only Very High false positive is in `captaincies`, which reinforces the existing
class-level exclusion. **`player_achievements` contributes no rows to the executable
baseline** (the six classes above sum to 6,324), so the class that anchors the §9.1 parity
standard (253 bulk rows, 0 FP) is visible today only in the ISSUE-075 historical record.

**Binding interpretation.** The aggregate 99.64% top-1 and 100% observed bulk precision do
**not** validate draft matching policy: the labelled `draft_person` population is five rows.
No claim about draft precision, draft Very High precision or draft bulk safety may be made
from this baseline (§12 P1c).

**Live queue (`queue-v1-baseline.json`):** 5,390 rows at resolution grain.

| Band | Rows |
|---|---|
| very_high | 38 (all 38 bulk-eligible) |
| high | 2,645 |
| medium | 426 |
| low | 386 |
| none | 1,895 |

The draft part of the queue is dominated by 79-point High rows composed of
`name_trigram_high` + `club_anywhere` + `draft_year_before_debut` + `draft_games_exact` +
`draft_goals_exact`, and by 64–66-point Medium rows where the same NBSP-induced trigram name
score combines with fewer corroborating signals. A normalisation-only correction adds exactly
18 name points where a genuinely exact name moves from `name_trigram_high` (26) to
`name_exact` (44): 79 → 97, 64 → 82, 66 → 84. The arithmetic says which rows *could* cross the
Very High line (85) or the bulk floor (90); it says nothing about whether they are correct.
**Bulk eligibility is never inferred from arithmetic** — only from the P1b measurement plus
the P1c labelled population.

**Cached examples (P0 query 1).** All four named draft rows have the *same* composition:

| Row | Score / band | bulk | Signals | Conflicts |
|---|---|---|---|---|
| Aaron Cadman `draft_person` | 79 / High | false | name_trigram_high 26, club_anywhere 15, draft_year_before_debut 13, draft_games_exact 15, draft_goals_exact 10 | none |
| Aaron Mullett `draft_person` | 79 / High | false | same five | none |
| Aaron Sandilands `draft_person` | 79 / High | false | same five | none |
| Aaron Vandenberg `draft_person` | 79 / High | false | same five | none |
| Aaron Cadman `award_winners` (control) | 97 / Very High | **true** | name_exact 44, club_in_season 36, era_season_in_career 17 | none |
| Frank Johnson `award_winners` | 44 / Low | false | name_exact only; three exact-name candidates tied at 44, gap 0, ambiguous | none |
| Jack Lynch `award_winners` | 44 / Low | false | name_exact only; two exact-name candidates tied at 44, gap 0, ambiguous | none |

The control row proves the same person's name *does* score `name_exact` when the source text
is clean; the draft row for the same person cannot, because of the NBSP.

**Invalid P0 queries, recorded so they are not re-used as evidence.** The earlier "raw source
names" query in §12 P0 (`lower(display_name_raw) LIKE 'aaron %'`) and any Aaron look-ups that
returned zero rows searched for an ASCII space after the forename. The source contains U+00A0,
so those zero-row results are an artefact of the query, not evidence that the draft records
were absent. Any future draft-name query must match on the normalised form after the P1a fix,
or use `replace(display_name_raw, U&'\00A0', ' ')` / a byte-level predicate explicitly.

---

## 3. Exact explanation of the observed 79 and 44 patterns

### 3.1 Why a draft row lands on 79

A `draft_person` row carries **no `active_season`** (`player-match-candidates.ts:243-249`
supplies only `draftYear`). Consequences in the scorer:

- `clubSignal` computes `activeSeasons(source.temporal)` = `[]`, so `club_in_season` (36) is
  unreachable and the drafting club can only ever earn `club_anywhere` (15)
  (`score-candidate.ts:142-165`).
- `eraSignal` returns null (no seasons, line 179).

The reachable draft ceiling is therefore name + 15 + 13 + 15 + 10 = **97 with an exact name,
79 with a trigram-high name**. The exact sums that produce 79:

| Composition | Sum | What it means |
|---|---|---|
| trigram_high 26 + club_anywhere 15 + draft_timing 13 + games_exact 15 + goals_exact 10 | **79** | *every* non-name family agrees; the only shortfall is a non-exact name string. `strongName` is false, so this row is structurally excluded from bulk at any score. |
| name_exact 44 + club_anywhere 15 + draft_timing 13 + games_near 7 | **79** | exact name; goals absent or off by > 2 |
| name_exact 44 + club_anywhere 15 + games_exact 15 + goals_near 5 | **79** | exact name; draft timing failed (debut > 3 years after the draft, or debut before the draft, e.g. a rookie re-listing) |

Adjacent plateau: name_exact + club + timing + games_near + goals_exact = **89**, Very High but
**not bulk** (floor 90, `confidence.ts:118`).

**P0 classification (binding).** All four named draft rows are composition row 1: every
non-name family agrees and the *only* shortfall is the name string (§2.10). The "near-miss" is
not a suffix, a double letter or a different given name — it is the U+00A0 separator in the
source text, which the normaliser preserves. The name similarity is 1.00; the strings differ
by one byte pair. So the 79 plateau is **not evidence that trigram-high is under-weighted**,
and it is **not** a case for aliases: no alias could be recorded that would make a
NBSP-separated string equal a space-separated one without encoding source corruption as
identity data.

Causes, re-stated after P0:

1. **Normalisation defect (proven, primary).** `afldb_normalise_name()` does not canonicalise
   U+00A0 to ordinary whitespace, so 100% of `draft_persons` rows can never reach `name_exact`
   or `strongName`. Fixing the shared canonical normalisation (P1a) is the first remedy; it
   changes no weight, band or threshold.
2. **The club family is worth 15 for drafts, not 36** (structural, unchanged by P0), because
   "played there in the source season" cannot be evaluated without a season. After P1a a
   clean draft row reaches 97 with all five families; this cause only matters for rows that
   lack one of games/goals/timing. Whether S2 (`club_at_debut`) is still needed is decided
   *after* P1b measures the post-normalisation distribution, not before.
3. **`reported_games`/`reported_goals` are a scrape snapshot** (migration 019:55-58). The
   earlier speculation that snapshot drift explained Aaron Cadman's 79 is **withdrawn**: his
   draft row scores `draft_games_exact` and `draft_goals_exact`. W6 remains a general risk for
   active players but has no P0 example.

### 3.2 Why a historical honour row lands on 44

44 is exactly `name_exact` with **no other family scoring**:

| Source | Why nothing else scores |
|---|---|
| `honour_team_members` | `clubId` NULL (only `club_name_raw`), no season, no span, no draft data (`player-match-candidates.ts:215-222`). Ceiling = 44. |
| `hall_of_fame` | `clubId` NULL; `playing_career` absent/unparseable, or candidate `debut/final` NULL → `careerSpanSignal` null. With a parsed span: 61 (exact) / 53 (overlap). Ceiling = 61. |
| `award_winners` with NULL `club_id` | era only (17) if the candidate has a career range → 61; otherwise 44. |

44 ≥ `lowScore` 40 → **Low**. **Needs review** appears when `ambiguous` is true: with an exact
name and nothing else, any *second* player with the same normalised name also scores 44,
gap = 0, `nearTies` ≥ 1 (`confidence.ts:256-265`). That is the Frank Johnson / Jack Lynch
shape: common historical names with several AFLDB namesakes, no club id, no season.

**P0 confirmation (binding).** Frank Johnson (`award_winners`, three exact-name candidates
tied at 44) and Jack Lynch (`award_winners`, two tied at 44) are genuine unresolved namesake
ambiguity under the evidence currently available to the scorer. They are correctly Low and
correctly Needs review. Raising the name weight or lowering thresholds would not distinguish
the namesakes; only additional evidence can (club-in-span, lineage-aware club matching, exact
club-text resolution, career span/era where the source supplies it — S1, S3, S4). This branch
of the plan is unchanged by the draft finding.

The page's "multiple records converging on the same player" is real but **not scored**: the
raw-name grouping on `page.tsx:260-276` shows `sharedPlayer` across a name group, but each row
is scored alone and the scorer has no cross-record family. (Correctly so today: the same name
string across two Wikipedia-derived tables is not independent identity evidence — see §6.)

---

## 4. Confirmed weaknesses

| # | Weakness | Evidence | Kind |
|---|---|---|---|
| W1 | Per-profile structural ceilings: draft 97/79, HoF 61, honour team 44, club-less award 61 — under one global band scale (vh ≥ 85) | §2.2, §3 | structural ceiling |
| W2 | Draft club evidence undervalued (15) because the season-corroborated form is unreachable without an active season | `score-candidate.ts:142-165` | source-profile bias toward season-bearing sources |
| W3 | Non-exact name penalty (−18) is not offset by any amount of corroboration, and forecloses bulk via `strongName` regardless of what the near-miss is. **P0 re-scope:** the 79-point draft population is *not* an instance of W3 — its near-miss is the W11 normalisation defect. W3 is retained only as a general property of the policy with no P0 example; it justifies no trigram weight change (D-2 amended) | `confidence.ts:28-30`, `score-candidate.ts:422` | policy property, currently unevidenced as a defect |
| W4 | Available-but-unscored evidence: HoF and honour-team `club_name_raw` (resolvable through `clubs.name` / `club_aliases`, migration 002:34-82); HoF span + club together; draft "debut club == drafting club"; prior human resolutions of the same name | §2.2; `player-match-candidates.ts:200-222` | unscored families |
| W5 | Club comparison is on raw `clubs.id`; `player_clubs` holds historical identities while a source `club_id` may resolve to a different identity of the same organisation (`clubs.current_identity_id`, ISSUE-149 uses `organization_id`). Effect: lost club signal and, with an afldb season + complete history, a false `club_not_in_history` (3 residual on correct links in the ISSUE-075 backtest) | `score-candidate.ts:139, 322` | lineage semantics |
| W6 | Draft games/goals snapshot drift for active players | migration 019:55-58 | metadata decay |
| W7 | Bands and bulk floors were set from the **aggregate** score distribution; no per-(source × score) precision table exists to say whether 85/90 are right for each profile | `backtest.ts:205-218` | thresholds not profile-verified |
| W8 | No "why capped" explanation; `describeBulkCriteria` only renders on already-eligible rows | `ResolveControls.tsx:246-255` | explainability |
| W9 | No stale-cache indicator after a version bump; approval and page can disagree silently | §2.7 | operations |
| W10 | Backtest has no leave-one-out protection for any signal derived from existing links (needed before W4's "prior resolution" signal can be measured honestly) | `backtest.ts` | measurement |
| W11 | **`afldb_normalise_name()` preserves U+00A0**, so 5,057 / 5,057 `draft_persons` names (100%) can never satisfy the exact-name arm or `strongName`; they score `name_trigram_high` at similarity 1.00. Proven by P0 hex evidence. Primary cause of the 79 plateau | migration 009:18-30; §2.10 | source-text normalisation defect (evidence layer) |
| W12 | **The labelled `draft_person` population is 5 rows** (top-1 4/5), against 5,052 unmatched. No draft precision, Very High precision or bulk-safety claim is supportable from the current baseline, although the class is bulk-admitted on ISSUE-075's historical 2,319-row evidence. The gap between that historical population and today's 5 labelled rows is unexplained and must be reconciled in P1c | §2.10 | calibration population missing |

Not weaknesses (kept deliberately): one-signal-per-family; contradictions outside the score;
games/goals never contradicting; captaincies excluded from bulk; the gap measured against
conflicted rivals; the honour-team uniqueness scope.

---

## 5. Candidate new / changed evidence signals

Each candidate is stated with source, independence, contradiction capacity, unknown-vs-false
semantics and era safety. **No weight is chosen here**; the weight column lists what must be
measured (§12) and the ceiling arithmetic it would produce.

| ID | Signal | Family | Provides | Independent of name? | Can contradict? | Missing = unknown? | Era-safe? | Notes |
|---|---|---|---|---|---|---|---|---|
| S1 | `club_lineage_*` — compare source club and `player_clubs` through the organisation lineage (`clubs.current_identity_id` / `organization_id`) instead of raw id, for both the reward and the `club_not_in_history` contradiction | club (rule change) | `clubs` | yes | yes (only the existing conflict, now lineage-aware) | yes | yes; Footscray/Western Bulldogs, Fitzroy, South Melbourne/Sydney, Kangaroos are exactly the historical cases | Measured by false-conflict count on correct links before/after |
| S2 | `club_at_debut` — drafting club equals the club of the candidate's first `player_clubs` row (min `first_season`) and `draft_year_before_debut` holds | club (replaces `club_anywhere` when it fires) | `draft_picks.club_id`, `player_clubs` | yes | no (a player drafted by X may debut for Y after a trade — absence is not disagreement) | yes | modern only by construction (drafts) | Candidate weight: the `clubSeason` level; must be tested with trigram-high names separately |
| S3 | `club_in_span` — HoF asserted span overlaps the candidate's `player_clubs` seasons at the source club (club resolved from `club_name_raw` via `clubs.name` / `club_aliases`) | club | `hall_of_fame.club_name_raw`, `club_aliases`, `player_clubs` | yes | no (HoF club text may list a non-VFL club) | yes; unresolvable club text → no signal | yes | Resolution of the raw club text must be exact (lower(alias)), never trigram |
| S4 | `club_anywhere` for `hall_of_fame` / `honour_team_members` via the same club-text resolution | club | as S3 | yes | no | yes | yes | Gives honour teams a second family (ceiling 44 → 59) |
| S5 | `name_variant_exact` — exact after stripping a generational suffix (`jnr|jr|snr|sr|ii|iii`) from either side, or the name is a recorded alias — **or**, preferred, no scorer change: add the missing variants as `player_name_aliases` rows (ISSUE-075 follow-up) | name | `player_name_aliases` | – | no | – | yes | **P0 outcome:** the 79-row near-misses are U+00A0 artefacts, not variants. S5 is **not** the remedy for them; the remedy is the P1a normalisation fix (D-2 amended). S5 stays available only for genuine alternate names / spelling variants / nicknames / suffix cases that remain after P1b, if any are found |
| S6 | `resolved_namesake_agreement` — another row (any source table) with the same normalised name that a **human** resolved (`link_status = 'resolved'`, `player_link_resolutions` audit present) to this candidate, and whose own evidence carried a non-name family | corroborating_link (new) | `player_link_resolutions`, source tables | partly: independent human judgement, but the *name* is the same string | no | yes | yes | Must be leave-one-out in the backtest; must **never** count toward `minCorroboratingFamilies`; propagates a wrong earlier link, so weight must stay below the band it would need to change alone |
| S7 | `honour_scope_era` — team names encode an era ceiling (e.g. "Team of the Century" selections were 1996-era, careers ≤ 1996) | era | `honour_team_members.team_name` | yes | could, but should not (weak, curated) | yes | only for the five tracked teams (`honour_teams.py:49-55`) | Low value: 89 confirmed rows, 113 total; recommend **not** scoring, only using as a page hint |
| S8 | `draft_stats_monotonic` — for an active player, `reported ≤ actual` within the drift window | draft_stats | as today | – | no | yes | modern | Recommend **not** adding: weak and hard to bound; instead measure how much W6 costs and consider re-snapshotting the source |

Rejected outright: any signal from `players.dob` (no source carries a DOB; 93% of players have
none, migration 002:130-135); any trigram-based club resolution; any use of `hall_of_fame.state`
as identity evidence; counting sibling draft picks or nomination rounds as repeated records.

---

## 6. Independence model

Families are grouped by the **AFLDB-side fact** they test and the **source-side field** they
come from. Two signals are independent only if both differ.

| Family | Source field | AFLDB fact | Counts once with |
|---|---|---|---|
| name | raw name | `players.search_name` / aliases | – |
| club | club id / club text | `player_clubs` | S1–S4 are all this family |
| era | active season | `debut_season..final_season` | – (note: `club_in_season` already implies era-in-career; both score today, kept) |
| career_span | HoF `playing_career` | `debut..final` | – |
| draft_timing | `draft_year` | `debut_season` | – |
| draft_stats | `reported_games`, `reported_goals` | `player_career_stats` | one group (as today) |
| corroborating_link (S6) | same raw name elsewhere | a human's earlier decision | never counts for bulk independence |

Rules carried forward: duplicated source material is one record (draft picks per person,
nomination rounds per season); HoF `playing_career` and `club_name_raw` are two facts from one
page — they count as two families for scoring but the bulk rule for a newly admitted class
must require at least one family that is **not** from the same source page (for HoF that
means the club or span must be corroborated by `player_clubs` match data, which S3 provides by
construction).

---

## 7. Proposed scoring / calibration options

| Option | Description | Verdict |
|---|---|---|
| A. Additive + new families | Keep `MATCH_POLICY` shape; add S1–S4 (S5 as data or signal per P0); re-measure weights and floors with the extended backtest | **Recommended core** |
| B. Profile-relative bands | Express thresholds as a fraction of each profile's reachable ceiling | Rejected as a scoring rule: completeness is not precision — a name-only profile at "100% of ceiling" is still a namesake lottery. Reuse the ceiling computation only for explanation (§11) |
| C. Probabilistic re-fit (log-odds per signal from the backtest) | Replace hand weights with fitted ones | Rejected for this issue: loses the one-visible-diff policy property, needs a held-out split the 6,324 executable labelled rows cannot spare per class (five of them are draft rows), and nothing in §4 requires it |
| D. Per-source scoring systems | Separate weight tables per source | Rejected: the same facts (club, era) mean the same thing across sources; the observed bias is in *which facts are reachable*, which Option A fixes at the evidence layer |

Weight-setting procedure (binding, replaces intuition):

1. Freeze a v1 baseline backtest JSON (`--out`) at the current commit. **DONE (P0):**
   `backtest-v1-baseline.json` and `queue-v1-baseline.json` at `0955db3`, immutable (§2.10).
2. For each proposed change, run the extended backtest and accept only if **all** of: top-1
   per class not reduced; Very High precision ≥ 99.9% per class; bulk false positives = 0 in
   every admitted class; false-contradiction count on correct links not increased; band
   migration matrix (v1 band → v2 band) shows no correct link moving *down* out of Very High
   without a stated reason.
3. Weights are chosen from a small candidate grid (e.g. S2 at 30/36), each row of the grid a
   separate backtest run recorded in this runbook. **No global trigram weight increase is on
   the grid** (D-2 amended): P0 showed the trigram-high population that motivated it is a
   normalisation artefact, and fuzzy-name matches remain non-bulk unless the existing bulk
   rules are independently satisfied after proper normalisation and calibration.
4. No grid row is run before P1a/P1b/P1c are complete (§16): the post-normalisation
   distribution is the only valid starting point for any weight comparison.

---

## 8. Recommended design

0. **Normalisation first (P1a, before everything below)**: the shared canonical
   name-normalisation behaviour canonicalises proven U+00A0 whitespace consistently with
   ordinary whitespace, with narrow regression tests. Other Unicode whitespace only where it
   can be done safely and explicitly; no broad lossy name rewriting without tests. Stored raw
   source text (`display_name_raw` and equivalents) stays untouched — source preservation and
   comparison normalisation are separate concerns; only the comparison output changes.
1. **Evidence layer (SQL)**: resolve `club_name_raw` for `hall_of_fame` and
   `honour_team_members` to a `clubId` by exact lower-case match on `clubs.name`,
   `clubs.short_name` or `club_aliases.alias` (never fuzzy); carry `organizationId` /
   `currentIdentityId` on every `CandidateClub` and on the source club so the scorer can
   compare lineage; carry the candidate's debut club.
2. **Scorer**: S1 lineage-aware club match and contradiction; S2 `club_at_debut` for draft
   rows; S3 `club_in_span` for HoF rows; S4 `club_anywhere` for HoF/honour rows. Trigram-high
   weight **untouched**: P0 proved the 79-row near-misses are systematic *and* un-aliasable,
   but the cause is normalisation (item 0), not weighting. Whether S2 is still needed is
   decided on the P1b post-normalisation distribution.
3. **Name variants**: proven Unicode/source-text artefacts are canonicalised (item 0) before
   any alias handling; aliases remain identity data for genuine alternate names, spelling
   variants, nicknames and suffix cases only; source corruption such as NBSP is never encoded
   as an alias. If a suffix rule is still needed after P1b it is suffix-only and produces a
   `strongName`-qualifying signal only when the stripped forms are byte-equal.
4. **S6 corroborating_link**: implement only behind the leave-one-out backtest and only as a
   display/ordering aid unless the measurement shows it is precise; never a bulk criterion.
5. **Bands unchanged** unless the per-(source × bucket) precision table (P1) shows a bucket at
   or above 85 with precision below 99.9% (lower the line) or a bucket below 85 with ≥ 99.9%
   whose population meets the §9.1 sample rule across two classes (raise the evidence, not
   the line — i.e. prefer adding the missing family to moving the threshold).
6. **`ALGORITHM_VERSION` → `v2`** with any scorer or policy change; page-level stale-cache
   banner (§11).
7. **Explainability**: a pure `explainLimits()` in `src/lib/player-matching` returning typed
   reasons; rendered on the row and in the drawer.

---

## 9. Bulk-policy design

Display band and unattended approval stay separate. Row-level rules (`confidence.ts:267-279`)
are retained verbatim, including `requireStrongName` and `minCorroboratingFamilies` (now with
S6 excluded from the count by construction).

### 9.1 Pre-declared class admission rule (frozen 2026-09-12, before any v2 result exists)

The first draft of this section used "n ≥ 200". That number had no basis beyond round-number
intuition and is **withdrawn**. The sample-size rule below is derived, is fixed now, and may
not be revisited after v2 results are seen.

**Basis.** With zero false positives observed in a bulk population of n rows, the one-sided
95% upper confidence bound on the true false-positive rate is approximately 3/n (the
"rule of three", from (1 − p)^n = 0.05). Zero failures therefore proves only that the rate is
probably below 3/n; a small n proves very little.

**Standard.** A class may be admitted to unattended approval only if its bulk population under
the final policy bounds the false-positive rate at least as tightly as the weakest class
ISSUE-075 already admitted. That class is `player_achievements`: 253 bulk rows, 0 FP, bound
≈ 1.19% (`issues.md:4648`, `confidence.ts:135`). Hence:

> **n_min = 253 bulk-eligible confirmed-link rows with 0 false positives**, i.e. the new class
> must present at least as much evidence as the smallest class already trusted. A larger n is
> better; a smaller n is not admissible, however clean it looks.

The same bound is recorded for every already-admitted class in the v2 re-gate
(`award_winners` 2,750 → ≈ 0.11%; `draft_person` 2,319 → ≈ 0.13%; `award_nominations` 702
→ ≈ 0.43%; `player_achievements` 253 → ≈ 1.19%) so the standard is visible beside the numbers
it is compared with.

**Historical versus executable (P0, 2026-09-12).** The four figures above are the ISSUE-075
historical calibration. The current executable baseline (§2.10) reproduces two of them in
spirit (`award_winners` 3,130 bulk → ≈ 0.10%; `award_nominations` 687 → ≈ 0.44%), contains
**no `player_achievements` rows**, and holds only **5 labelled `draft_person` rows with 0 bulk**.
The n_min = 253 standard stays frozen as written (its derivation does not depend on the
current population), but two consequences are binding:

- `draft_person`'s existing bulk admission rests on historical evidence that the current
  backtest cannot re-run. Under this runbook that admission is neither revoked nor extended:
  **no broadening of draft bulk eligibility** (no weight, band, floor or rule change that
  increases the draft bulk population beyond what the existing unchanged rules yield after
  proper normalisation) until the P1c labelled draft population meets the same §9.1 standard
  — a bulk-eligible confirmed-link subset of at least 253 rows scored under the final policy
  with 0 false positives. **D-9 (decided): the class is suspended from unattended approval in
  the P1a change set** until that standard is met; suggestions and manual approval remain.
- The unexplained drop from ISSUE-075's 2,319 draft bulk rows to today's 5 labelled draft
  rows must be reconciled in P1c before any draft population figure is trusted.

**Consequence stated in advance.** `hall_of_fame` has 240 confirmed links in total
(`issues.md:4650`), so its bulk population under any policy is at most 240 < 253. Under this
rule Hall of Fame **cannot** be admitted on the current confirmed-link population, whatever
v2 measures. It stays suggestion-only. Admission can be re-gated only after the confirmed
population grows through ordinary human approvals of Hall of Fame rows (each becomes a
confirmed link), and then only by re-running the whole rule below on the enlarged set.

Class admission requires, per class, on the confirmed-link backtest, **every row scored under
the final proposed evidence and scoring policy**:

| Criterion | Threshold |
|---|---|
| bulk-eligible population n | > 0 **and** n ≥ 253 (§9.1 rule of three at parity with `player_achievements`) |
| bulk false positives | 0 (100% observed bulk precision) |
| hard conflicts among admitted rows | 0 |
| name evidence on every admitted row | `name_exact` or `name_alias_exact` only; no fuzzy-name row (`strongName`, unchanged) |
| independent corroborating families | ≥ 2 counting the name, i.e. name plus at least one family from a different source field **and** a different AFLDB fact (§6); S6 never counts |
| unresolved club text | contributes no positive and no negative evidence (S3/S4 absent, no conflict) |
| runner-up gap | existing rule unchanged: gap ≥ 25 or no rival, not ambiguous |
| Very High precision | ≥ 99.9% |
| top-1 | not below the v1 figure for that class |
| hard conflicts on correct links (class-wide) | not above v1 |
| exact-name collision rate | reported (share of rows whose exact name matches > 1 player); a class above 10% needs a manual sample of collided rows |
| gap distribution of bulk rows | reported; median ≥ 25 |
| live queue | the **entire** initial bulk-ready set of a newly admitted class is reviewed by hand, with 0 wrong, before unattended approval is enabled (the ISSUE-075 44/44 procedure) |

If the measured sample is too small for the rule, the class remains suggestion-only regardless
of apparent correctness. Admission is never a post-hoc operator choice after seeing results:
the rule is applied mechanically and its inputs are recorded in this runbook.

Expected outcome by class (to be confirmed by measurement, not assumed):

- `award_winners`, `award_nominations`: remain admitted; re-verified under the final policy
  against the same table on the executable baseline. **CONFIRMED under `v3`, P4 2026-09-12**
  (§12 P4.3): `award_winners` 3,130 bulk / 0 FP / bound ≈ 0.096%; `award_nominations` 687
  bulk / 0 FP / bound ≈ 0.437%.
- `player_achievements`: remains admitted on ISSUE-075 evidence; cannot be re-verified until
  the executable baseline contains its rows (P1c must say why it has none). **Still not
  re-verified as at P4 2026-09-12: the executable `v3` labelled population for this class is
  0, so its admission rests on the historical 253 / 0-FP evidence alone. §9.1 must not be
  described as re-verified under `v3` for this class.**
- `draft_person`: **suspended from unattended approval in P1a (D-9)**; re-admitted only when
  the P1c population meets this table in full and the initial live bulk-ready set is hand
  reviewed 100% (see the historical-versus-executable note above).
- `captaincies`: remains excluded (class-level semantic divergence, ISSUE-075). Unchanged.
- `hall_of_fame`: **non-bulk by default and not admissible on the current population** (240
  < 253). S3/S4 still improve its display band and its explanation; every row is approved by
  a human.
- `honour_team_members`: **not admitted** (89 confirmed links, uniqueness scope, ceiling 59
  even with S4). Stays suggestion-only; the page gains the reason.
- Fuzzy-name draft rows (§3.1 row 1): never bulk, by `strongName`. Unchanged.

---

## 10. Safety invariants that must remain unchanged

1. Scoring stays pure and identical on page, approval and backtest (`types.ts:3-14`).
2. Candidate generation stays separate from scoring; the two exact arms stay uncapped.
3. At most one signal per family; contradictions never net against positives.
4. A contradiction caps the band to Low and blocks bulk; `plmc_bulk_ck` stays.
5. Approval locks the target, re-reads evidence, re-scores server-side, and refuses on
   player change / conflict / weak / not-bulk (`player-links.ts:687-711`); browser scores are
   never read.
6. Bulk stays stricter than display; class gate is explicit per class with no default.
7. Only afldb-scoped seasons may contradict a career; external competitions never do.
8. Games/goals disagreement is never a contradiction.
9. Absence of data (NULL club, unparsed span, incomplete history) is never a contradiction.
10. The page-level `group.disagrees` bulk withhold stays.
11. `captaincies` stay out of unattended approval.
12. A wholesale cache refresh carries one `algorithm_version`.
13. **A cached suggestion computed under a different `ALGORITHM_VERSION` than the running
    code is never presented or acted on silently.** The page must detect and label it, and an
    approval must report that the displayed suggestion was stale or changed. Invariant 5 is
    untouched: the server still re-locks, re-reads and re-scores under current code, and
    nothing ever approves under the stale algorithm.

---

## 11. UI / explainability changes (minimal, no page redesign)

1. **Typed limit reasons** from a pure `explainLimits(assessment, source, sourceType)`:
   `name_not_exact`, `no_independent_corroboration`, `below_bulk_score_floor`,
   `below_bulk_gap_floor`, `near_tie`, `hard_conflict`, `source_class_not_bulk`,
   `profile_ceiling_below_very_high` (with the computed ceiling), `group_disagrees` (page).
   Labels in `describe.ts` next to the existing tables.
2. **Row**: one muted line under the band badge, e.g. "Capped at High: name is not exact" or
   "Not bulk-ready: hall_of_fame is suggestion-only (policy)".
3. **Drawer** (`ResolveControls.tsx`): always render the four bulk criteria with ✓/✗ (today
   only on eligible rows), plus "Highest score this record type can reach: N" derived from the
   source's available fields.
4. **Stale cached state is an integrity-of-presentation requirement** (invariant 13):
   - *Detectable*: the page compares each cached row's `algorithm_version` with
     `ALGORITHM_VERSION` on the server; a page-level banner appears when any row differs, and
     each stale row carries a "Stale (v1)" badge beside its band.
   - *Warned*: the drawer states, above the Approve button, that the displayed score and
     evidence were computed under the old version and will be re-scored under the current one.
   - *Surfaced at approval*: the approval action reads that target's cached
     `algorithm_version` (server-side, read-only; never from the browser), runs the existing
     lock → re-read → re-score, and then: refuses with the existing `changed` / `conflict` /
     `weak` / `not_bulk` messages if the fresh result no longer supports the player; or, when
     it does, completes and returns a notice that the displayed suggestion was stale
     (e.g. "shown as v1 score 79; approved on v2 score 92"). Bulk approval reports the same
     per row in its existing skipped/approved summary.
   - *No stale approval*: there is no path that approves on the cached score; the recorded
     `match_score` / `algorithm_version` are always the fresh ones (`player-links.ts:728-729`).
   - *No weakening*: the re-score-under-lock rule and its contract tests
     (`tests/player-link-mutations.test.ts:600-790`) are unchanged.
5. New evidence signals get short/long labels; nothing else on the page moves.

---

## 12. Test / backtest plan

### P0 — evidence capture (operator, read-only, before any code) — **COMPLETE 2026-09-12**

Results are recorded in §2.10 and classified in §3. The second query below (the
`LIKE 'aaron %'` form) is **invalid as written**: it assumes an ASCII space and returned zero
rows against a source that uses U+00A0; it is kept only so the mistake is not repeated. The
hex inspection that replaced it (`encode(convert_to(display_name_raw,'UTF8'),'hex')` style)
is the evidence of record.

Cached scores and evidence for the named examples (run against the dev application DB;
adjust the name list freely):

```sql
SELECT c.target_table, c.target_id, c.resolution_entity_type, c.rank, p.display_name,
       c.score, c.band, c.gap, c.near_ties, c.ambiguous, c.bulk_eligible,
       c.algorithm_version, c.evidence, c.conflicts
  FROM player_link_match_candidates c
  JOIN players p ON p.id = c.player_id
 WHERE (c.resolution_entity_type, c.resolution_entity_id) IN (
         SELECT resolution_entity_type, resolution_entity_id
           FROM player_link_match_candidates c1 JOIN players p1 ON p1.id = c1.player_id
          WHERE c1.rank = 1
            AND p1.display_name IN ('Aaron Cadman','Aaron Mullett','Aaron Sandilands',
                                    'Aaron Vandenberg','Frank Johnson','Jack Lynch'))
 ORDER BY p.display_name, c.target_table, c.target_id, c.rank;
```

Raw source names behind the draft rows, to classify the name near-misses:

```sql
SELECT per.id, per.display_name_raw, afldb_normalise_name(per.display_name_raw) AS n,
       per.reported_games, per.reported_goals, per.link_status,
       dp.draft_year, dp.draft_type, cl.name AS club
  FROM draft_persons per
  JOIN draft_picks dp ON dp.draft_person_id = per.id
  LEFT JOIN clubs cl ON cl.id = dp.club_id
 WHERE per.link_status IN ('ambiguous','unmatched','implausible')
   AND lower(per.display_name_raw) LIKE 'aaron %'
 ORDER BY per.display_name_raw, dp.draft_year;
```

Baseline backtest and queue report, frozen as JSON:

```bash
npm run match:backtest -- --out backtest-v1-baseline.json
npm run match:backtest -- --queue --out queue-v1-baseline.json
```

### P1 — backtest instrumentation (no scoring change)

Extend `tools/matching/backtest.ts` with: precision per (sourceType × score bucket); per-signal
precision lift (rows where the signal fired: correct/wrong); reachable ceiling per row and a
"ceiling < 85" count per class; exact-name collision rate per class; gap distribution per
class for bulk rows; `--baseline <json>` producing a band-migration matrix and the list of
rows that changed band or bulk state, with correctness; `--holdout-self` leave-one-out for S6.
The `--baseline` comparison is a prerequisite of P1b and must reproduce the §2.10 v1 numbers
exactly when run against `backtest-v1-baseline.json` with no code change.

#### P1 implementation record — baseline comparison (2026-09-12, Opus 5)

Scope of this session was the **comparison capability only**: the part of P1 that P1b cannot
proceed without. The remaining P1 instrumentation (precision per sourceType × score bucket,
per-signal precision lift, reachable ceiling per row, exact-name collision rate per class,
gap distribution per class for bulk rows, `--holdout-self`) is **not built** and is not
required by P1b, which measures a normalisation-only change against a frozen baseline.

**New pure library — `tools/matching/compare-reports.ts`.** DB-free and side-effect-free
apart from the two file helpers at the end. It reads two saved reports, reduces both kinds to
one `RowView` shape, joins them on the stable resolution key (`resolutionKey`, e.g.
`draft_person:412`) and derives every aggregate from the joined rows. Nothing is synthesised
from aggregate counts: equal band counts can hide any number of offsetting moves, so the
migration matrix is built row by row or not at all. `absent` is a first-class band on both
axes, so a row present in only one run is reported, never silently dropped.

**New CLI — `tools/matching/compare.ts`, `npm run match:compare`.** A separate entry point
from `backtest.ts` deliberately: `backtest.ts` imports the application db client, which throws
at module load when `DATABASE_URL` is unset, so an offline file-to-file comparison could not
live there. `npm run match:compare -- <baseline.json> <candidate.json> [--out <delta.json>]`
runs with no DSN and no environment. The report kind (labelled backtest vs queue) is detected
from the payload, and the two must match.

**`backtest.ts` additions.** `--baseline <json>` compares a live run against a saved report in
the same pass (labelled and `--queue` modes both); `--compare-out <json>` persists that
comparison. Neither input file can be overwritten — a `--compare-out` path that resolves to an
input is refused, so the frozen §2.10 baselines cannot be destroyed by the tool that measures
against them.

**Schema extension (the only one needed).** The queue report was `{ proposals: [...] }` with no
run metadata. It now carries `algorithmVersion`, `gitCommit`, `startedAt` and `tableFilter`
beside an unchanged `proposals` array, so `queue-v1-baseline.json` still parses and its
metadata simply reads as `unknown (not recorded)`. The labelled backtest report already carried
all four and is unchanged. **No scoring behaviour was touched and no baseline regenerated.**

**Comparisons supported** (both report kinds unless noted): run metadata; population; overall
candidate-generation recall, top-1/3/5, band counts, Very High count/precision/false positives,
bulk count/precision/false positives, ambiguity count, hard-conflict count (the correctness-
derived figures are `n/a` for queue reports, which have no ground truth, rather than assumed);
a full band-migration matrix with unchanged / moved-up / moved-down / added / removed totals;
the same metric set per logical source type; and row-level lists — every changed top-1 (with
correctness on both sides, enumerated in full for labelled runs per §13 item 2a), every change
in the expected player's rank, every band change with direction, ambiguity gained and lost,
gap changes with a materiality flag, bulk eligibility gained and lost, and every change of
name evidence between the exact and fuzzy families. Every list is sorted by resolution key, so
two runs of the tool on the same inputs produce byte-identical JSON and console output.

**D-9 stop condition.** Any `draft_person` / `draft_picks` row that is bulk-eligible in the
**candidate** run is reported as `draftBulk` in the JSON, printed under a
`*** STOP CONDITION ***` banner, and sets **exit code 2** (distinct from 1, a tool failure).

**Not comparable retrospectively against the frozen v1 evidence**, and why:

- `queue-v1-baseline.json` carries no algorithm version, git commit, run timestamp or table
  filter, because the metadata block did not exist when it was written. The comparison prints
  `unknown (not recorded)` and names the missing fields; §2.10 records externally that the file
  is `v1` at `0955db3` over the whole population. Every P1b queue report will carry them.
- `queue-v1-baseline.json` carries no `policy` block, so no policy diff is possible for the
  queue side; the labelled reports have one on both sides.
- Neither report records the ranked candidate set beyond the top row (queue keeps three
  alternatives as display strings only), so changes below rank 1 are comparable only through
  the labelled reports' `rank` of the expected player. That is sufficient for every §12 P1b
  question and no instrumentation was added for it.
- Per-signal precision lift, per-bucket precision, per-row ceilings and exact-name collision
  rate are absent from both files and are not part of this comparison; they are the unbuilt
  half of P1 above.

**Verification.** `npm run match:compare -- backtest-v1-baseline.json backtest-v1-baseline.json`
reproduces §2.10 exactly with every delta zero: 6,324 rows, recall 6,310 (99.78%), top-1 6,301
(99.64%), top-3/top-5 6,310, very_high 5,527 / 5,526 correct (99.98%) / 1 FP, bulk 3,817 /
100% / 0 FP, bands 5,527 / 5 / 270 / 487 / 35, and the per-source table reproducing
`award_nominations` 750, `award_winners` 3,468 (top-1 3,464), `captaincies` 1,774 (1 Very High
FP), `draft_person` 5 (top-1 4), `hall_of_fame` 239, `honour_team_members` 88. The same
self-comparison of `queue-v1-baseline.json` reproduces 5,390 rows, very_high 38 = bulk 38, and
recovers all five logical source classes from the entity keys. This satisfies the §16 P1 gate.

### P1a — Unicode / name-normalisation correction (first code change; normalisation only)

Scope, binding:

- Correct the **shared canonical name-normalisation behaviour** so that U+00A0 is
  canonicalised consistently with ordinary whitespace before the existing strip/collapse
  steps. P1a first establishes *where* that behaviour lives and how many copies exist
  (`afldb_normalise_name` in migration 009 is the SQL side; any TypeScript mirror used by
  the page, import or backtest must be found by search and changed identically, or the
  duplication must be recorded as a finding).
- Consider other Unicode whitespace (e.g. U+2007, U+202F, U+3000) only where the
  implementation can do so safely and explicitly, each with its own test; no broad lossy
  name rewriting without tests.
- Add narrow regression tests: a NBSP-separated source name normalises byte-equal to its
  ASCII-space form; an existing ASCII name normalises unchanged; the pure scorer awards
  `name_exact` (not `name_trigram_high`) for the canonicalised pair.
- **Do not** change scoring weights, bands or bulk thresholds in the same step. Two deliberate
  exceptions, both operator-decided: `ALGORITHM_VERSION` → `v2` (D-8, because the
  canonicalisation changes matching semantics and cached v1 results must be visibly stale),
  and `draft_person` removed from the bulk-allowed classes (D-9) so that no
  post-normalisation draft row can be approved unattended before P1c re-gates the class.
  Both changes carry their own unit assertions and are named in the P1a commit.
- **Source preservation versus comparison normalisation:** stored raw source text
  (`draft_persons.display_name_raw` and every other `*_raw` column) stays byte-for-byte
  untouched; only the normalised comparison output changes. P1a records explicitly that no
  source row is rewritten.
- Assess and record the consequences of the fix being (probably) a SQL function change:
  whether `players.search_name` / `player_name_aliases.search_alias` are stored values that
  must be recomputed, whether any player or alias name itself contains U+00A0, and whether a
  migration is therefore required (this contradicts the earlier "no migration expected" in
  §15, which is now conditional). Any migration is planned here and executed only after
  operator approval; none is created during planning.
- Measure whether other source tables contain U+00A0 (award, honour, HoF, captaincy,
  achievement raw-name columns) so the fix's expected reach is known before P1b.

#### P1a implementation record (2026-09-12, Opus 5)

**Where the behaviour lives — answered by search, not assumption.** There is exactly **one**
implementation and it is SQL. `afldb_normalise_name()` is defined in migration 008:13-23 and
corrected in 009:18-30; nothing else normalises names for matching. TypeScript deliberately
does not fork it (`src/lib/player-matching/types.ts:168` — "computed in SQL so TS never forks
it"); the scorer compares two strings the SQL function produced (`score-candidate.ts:57,76`);
the Python ETL calls the same function to compute the stored columns
(`tools/migration/common.py:1099,1195`); every application lookup goes through it
(`search.ts`, `players.ts`, `admin-draft.ts`, `admin-coaches.ts`, `ingest/datasets.ts`,
`external-afl/current-season-import.ts`, `data-edits.ts`). **No duplication finding to
record.** (`src/search/gridley-compat.ts:622 normalisePlayerName` is the Grid Solver's own
oracle-comparison helper and is not part of the player-link matcher; untouched.)

**Change — `src/db/migrations/099_normalise_unicode_whitespace.sql`.** Before the existing
lower/unaccent/strip/collapse pipeline, `translate()` maps a named, explicit list of Unicode
space separators to an ordinary space: U+00A0, U+1680, U+2000–U+200A (so U+2007 FIGURE SPACE
is included), U+2028, U+2029, U+202F, U+205F, U+3000. `translate()` rather than a regex
character class, so each code point is visible in the diff and no regex locale behaviour is
relied on. Zero-width characters (U+200B, U+FEFF) are **not** touched: they are not
separators, and either deleting them or spacing them would change a name's token count —
that is an unproven decision and out of P1a scope. Punctuation classes, `unaccent`, the
`\s+` collapse and `btrim` are byte-for-byte as 009 left them, so an ASCII name normalises
exactly as before.

**Behaviour, before → after.**

| Input | v1 | v2 (099) |
|---|---|---|
| `Aaron<U+00A0>Cadman` | `aaron<U+00A0>cadman` | `aaron cadman` |
| `Aaron Cadman` | `aaron cadman` | `aaron cadman` (unchanged) |
| `  John   Smith  ` | `john smith` | `john smith` (unchanged) |
| `Gary O'Donnell` | `gary odonnell` | `gary odonnell` (unchanged) |
| `Anthony McDonald-Tipungwuti` | `anthony mcdonald tipungwuti` | unchanged |
| `Aaron<U+200B>Cadman` | `aaron<U+200B>cadman` | `aaron<U+200B>cadman` (deliberately unchanged) |

**Migration required: yes.** The function is SQL, so the fix cannot ship as application code.
Two consequences are handled in the same migration, both precedents set by 009:

- the function is used in index expressions, so `ix_clubs_name_trgm`, `ix_club_aliases_trgm`,
  `ix_venues_name_trgm` and `ix_venue_aliases_trgm` are `REINDEX`ed in the same transaction;
  without that they would silently answer from the old function. (`players.search_name` and
  `player_name_aliases.search_alias` are indexed as plain columns, so their indexes follow
  their values.)
- `players.search_name` and `player_name_aliases.search_alias` are **stored** columns, not
  expressions (002:124,168; 009:40-43), so they are recomputed — guarded by
  `IS DISTINCT FROM`, which makes the statement a no-op on an already-ASCII corpus and also
  the measurement of whether any player or alias name itself carries Unicode whitespace.

**No stored raw data was rewritten.** `draft_persons.display_name_raw` and every other `*_raw`
source column, plus `players.display_name`, `players.slug`, `players.sort_name` and
`player_name_aliases.alias`, are untouched. Only derived comparison output changes.

**Algorithm version: `v1` → `v2`** (`confidence.ts:19`, D-8). No weight, band, gap or bulk
threshold moved; the matching *semantics* did, so every cached suggestion is stale until the
queue is refreshed. P2's stale detection, banner, badges and approval-time notice are already
in place, so the §14 stop condition ("a P1a deploy on a host without P2") is satisfied.

**`draft_person` suspended from unattended approval** (`confidence.ts` bulk `sourceTypes`,
D-9), with the reasoning recorded beside the historical calibration it suspends. Suggestions
and manual approval are unchanged.

**Tests added (narrow, extending existing suites — no new file).**

- `tests/integration/player-matching.test.ts`, new `describe('name normalisation')`: U+00A0
  normalises byte-equal to its ASCII form; each other admitted Unicode separator does the
  same; U+200B deliberately does not; migrations 008/009 behaviour (lowercase, apostrophe,
  full stop, hyphen, unaccent) unchanged; whitespace collapse/trim deterministic with Unicode
  and ASCII mixed. This is the only place the SQL function can be proven.
- `tests/player-matching.test.ts`, new `describe('Unicode whitespace in source names')`: the
  DB-free scoring consequence — the preserved-NBSP form reproduces the exact P0 composition
  (`name_trigram_high` + `club_anywhere` + `draft_year_before_debut` + `draft_games_exact` +
  `draft_goals_exact` = 79, `strongName` false), the canonicalised form scores `name_exact`
  for 97 with `strongName` true, and `ALGORITHM_VERSION` is `v2`.
- `tests/player-matching.test.ts` class gate: `draft_person` moved out of the admitted list
  into its own suspension case (still `very_high`, no longer bulk-eligible).

**Still owed by P1a, operator-run (see §12 P1a bullet 6):** the migration has not been applied
anywhere, and the U+00A0 reach across the other source tables (award, honour, HoF, captaincy,
achievement raw-name columns) has not been measured. Both are in the operator command set
handed over with this session; P1b may not start until they are answered.

### P1b — Re-score / rebuild and measure the normalisation-only impact

With P1a applied and nothing else changed, refresh the cache and run the P1-instrumented
backtest and queue report to **new** filenames, then compare against
`backtest-v1-baseline.json` and `queue-v1-baseline.json`. Report, in this runbook:

- band migration matrix (v1 band → post-P1a band), labelled rows and queue rows separately;
- candidate-generation recall and top-1 changes; **every changed top-1 among labelled rows**
  enumerated with correctness;
- ambiguity / gap changes (rows entering or leaving `ambiguous`, gap distribution);
- newly Very High rows, by class;
- newly bulk-eligible rows, by class, with the count of draft rows among them;
- representative draft rows that move 79 → 97 and 64/66 → 82/84, inspected by hand;
- confirmation that no unrelated source class regresses (top-1, Very High precision, false
  contradictions on correct links not worse than §2.10 per class).

Newly bulk-eligible draft rows in the live queue are **not** approved unattended on the
strength of P1b (see §14 and D-9); P1b is measurement.

Exact commands, with the P1 comparison instrumentation in place (the v1 filenames are inputs
and are never written):

```bash
npm run match:backtest -- --out backtest-p1b-normalised.json
npm run match:backtest -- --queue --out queue-p1b-normalised.json

npm run match:compare -- backtest-v1-baseline.json backtest-p1b-normalised.json \
  --out compare-backtest-v1-to-p1b.json
npm run match:compare -- queue-v1-baseline.json queue-p1b-normalised.json \
  --out compare-queue-v1-to-p1b.json
```

Equivalently, each run can compare itself in the same pass:
`npm run match:backtest -- --out backtest-p1b-normalised.json --baseline backtest-v1-baseline.json
--compare-out compare-backtest-v1-to-p1b.json`.

Stop conditions P1b must enforce, each readable from the comparison output:

1. **Any** bulk-eligible `draft_person` / `draft_picks` row in the candidate queue or backtest
   run (D-9, §14). The comparison prints the `*** STOP CONDITION ***` block and exits 2.
2. Any bulk false positive in the labelled run (`bulk false positives` delta above 0, or a
   non-zero candidate count in any class).
3. Very High precision below 99.9% in any class, or below the §2.10 per-class figure.
4. Top-1 reduced overall or in any class against §2.10.
5. Hard conflicts on correct links above the baseline count, or a new conflict reason.
6. Any correct link moving *down* out of Very High or out of bulk without a recorded reason
   (`band moved down` and `ceased bulk-eligible` lists).
7. Any row appearing in only one of the two runs that is not explained by the refresh
   (`rows only in candidate` / `rows only in baseline` must be 0 unless the population
   deliberately changed).
8. Any diff to a `*_raw` source column (§14) — checked outside this tool.


#### P1b measurement record (operator run 2026-09-12; transcribed and re-verified 2026-09-12, Opus 5)

Artefacts in the worktree root: `backtest-p1b-normalised.json`, `queue-p1b-normalised.json`,
`compare-backtest-v1-to-p1b.json`, `compare-queue-v1-to-p1b.json`. Every figure below was read
back out of the two comparison files rather than retyped from a summary.

**Metadata caveat (binding on every citation).** Both P1b reports record
`algorithmVersion v2`, `gitCommit 0955db3`. The commit is the *base*: the v2 work is
uncommitted in this worktree, so these are **working-tree v2 results based on `0955db3`**, not
results from pristine `0955db3`. `queue-v1-baseline.json` still reports its four metadata
fields as `missingFields` — it predates the P1 metadata block — and §2.10 remains the external
record that it is `v1` at `0955db3`.

**Labelled backtest (6,324 rows, population unchanged, 0 rows added or removed).**

| Metric | Delta v1 → P1b |
|---|---|
| population, recall, top-1, top-3, top-5 | **0** (6,324 / 6,310 / 6,301 / 6,310 / 6,310) |
| very_high | +1 (correct +1, false positives **0**) |
| bulk eligible, bulk correct, bulk FP | **0** (3,817 / 3,817 / 0) |
| ambiguous, hard conflicts | **0** (hard conflicts 9) |
| bands | very_high +1, high −1, low +2, none −2 |
| rows changed | top-1 **0**, expected rank **0**, band 3, gap 2, name evidence 3, bulk gained/lost **0** |

The three moved rows are the three labelled draft rows whose name evidence changed:

| Row | name evidence | band | score |
|---|---|---|---|
| Fred Rodriguez | `name_trigram_high` → `name_exact` | none → low | 26 → 44 |
| Riley Onley | `name_trigram_high` → `name_exact` | none → low | 26 → 44 |
| Ryan O'Keefe | `name_trigram_high` → `name_exact` | high → very_high | 79 → 97 |

`draft_person` Very High moves 0 → 1. No other class moves at all, so no class regresses
against §2.10 and §13 item 2a's "no correct link moves down" holds trivially: **zero** rows
moved down and zero ceased to be bulk-eligible.

**Live queue (5,390 rows, population unchanged).**

| Band | v1 | P1b |
|---|---|---|
| very_high | 38 | **2,680** |
| high | 2,645 | 425 |
| medium | 426 | 330 |
| low | 386 | 168 |
| none | 1,895 | 1,787 |

`draft_person` Very High 0 → **2,642**; ambiguity 384 → 379 (6 ceased, 1 became); hard conflicts
23 → 23, unchanged; 3,490 rows changed band and **every one moved up**; 3,491 name-evidence
changes; 1,880 gap changes of which 1,876 are material. Bulk-eligible stays at **38**, all of
them non-draft, with 0 gained and 0 lost.

**Exactly one queue top-1 changed:** `draft_person:4163` "Sam Chapman", Paul Chapman #10273
(28) → Sam Chapman #11609 (44). Analysed in the P1c record below; the determination is
deferred, not decided by the score.

**Stop conditions — all clear.** `draftBulk.triggered` is `false` with `count: 0` in **both**
comparisons, so D-9 holds: no `draft_person` / `draft_picks` row is bulk-eligible. No bulk false
positive; no class below its §2.10 Very High precision; no top-1 reduction; no new conflict
reason and no increase in conflicts on correct links; no correct link moved down; no row present
in only one run. The `*_raw` check (stop condition 8) is outside this tool and is covered by the
P1a record: the migration rewrites only the derived `search_name` / `search_alias` columns.

**Conclusion.** The normalisation fix behaved exactly as §2.10 predicted arithmetically: the
79 → 97 and 26 → 44 moves are real and the labelled population shows no regression anywhere.
It also confirms the binding limitation — 2,642 draft rows are now Very High while the labelled
draft population is still **5**, which is precisely why D-9 exists and why P1c must produce a
calibration population before any draft policy moves.
### P1c — Expand the labelled draft evaluation population before any draft-policy change

The current labelled `draft_person` population is 5 rows. No draft precision, Very High
precision or bulk-safety claim may be made from it. P1c must:

- **Reconcile the population.** Explain why ISSUE-075 measured 2,319 draft bulk rows and the
  current backtest finds 5 labelled draft rows with 5,052 unmatched (a reload/rebuild of
  `draft_persons`, a link-status change, a backtest population filter, or something else),
  from evidence — `import_batches`, migration history, `player_link_resolutions` — not
  assumption. Also state why `player_achievements` contributes no rows.
- **Design a reproducible way to build a substantially larger confirmed draft evaluation
  set**, recorded as a procedure in this runbook. Candidate approaches to evaluate (not yet
  chosen): (a) ordinary human approval of draft rows through the admin page, where each
  reviewer decision is made and recorded against evidence *independent of the scorer's
  signals* (e.g. external draft/profile identity, debut club, career dates) rather than by
  accepting the suggestion; (b) recovery of historical draft links from the ISSUE-075 era if
  the reconciliation shows they were lost rather than never present; (c) a deterministic
  cross-reference to another already-confirmed source for the same person (e.g. a confirmed
  `award_winners` link for the same AFLDB player with matching debut club and draft year),
  used as ground truth only if it does not reuse a scorer signal.
- **Maintain holdout discipline.** Evidence used to establish ground truth must not leak
  into scoring: rows labelled during P1c are excluded from any weight-grid tuning and used
  only for evaluation; if the labelling procedure consults the page's suggestion, that must
  be recorded and the row treated as scorer-influenced; a fixed split (tuning / holdout) is
  declared before the first grid row is run.
- **Minimum evidence before tuning or broadening draft bulk eligibility** is the already
  frozen §9.1 standard, applied to the draft class as if newly admitted: a bulk-eligible
  confirmed-link subset of at least 253 rows under the final policy, 0 false positives, and
  every other §9.1 row. This is derived from the rule of three at parity with
  `player_achievements`; no separate sample-size number is invented for drafts. Until it is
  met, draft weights, draft-specific signals (S2) and draft bulk rules are not changed.

#### P1c reconciliation and design record (2026-09-12, Opus 5)

Scope of this session: **reconciliation, truth-source design and evaluation tooling.** No
weight, band, gap or bulk threshold moved; migration 099 and the normalisation behaviour are
untouched; no frozen baseline or P1b report was rewritten; D-9 remains in force. The labelling
run itself is operator work and is specified in item 11 below.

**Metadata correction carried forward.** `backtest-p1b-normalised.json`,
`queue-p1b-normalised.json` and both `compare-*-v1-to-p1b.json` record `gitCommit 0955db3`
because the v2 work is uncommitted in this worktree. They are **working-tree v2 results based
on 0955db3**, not pristine `0955db3` results, and must be cited that way.

##### 1. Why the executable backtest sees five labelled draft rows — answered from evidence

The backtest's labelled population is `link_status IN ('unique','resolved')`
(`player-match-candidates.ts:47,258`). For drafts that status is written by the importer, and
the importer changed.

- `tools/migration/import_draft.py` is a **tombstone** (retired, ISSUE-093 Stage B2-7). Its own
  header records what it used to do: it "resolved links through `players.legacy_player_id`"
  from `AFLDB_LEGACY_SQLITE`. That is the mechanism that produced the large historical `unique`
  draft population ISSUE-075 measured.
- The supported importer is `tools/rebuild/draftguru/import_draftguru.py`, and the rebuilt path
  **never populates `legacy_player_id`** (`import_fitzroy_core.py` builds `players` only from
  fitzRoy `player_stats` rows). The legacy link mechanism therefore resolves nothing on a
  rebuilt database and no automatic draft link is reproduced.
- On the rebuilt path a draft person acquires a link from exactly three places
  (`import_draftguru.py:616-735`): the explicit decision ledger
  (`data/reference/draftguru-link-decisions.json`), a live admin override, or an **approved
  bridge dataset supplied with `--bridge`** — and no bridge dataset exists, so `stats["bridge"]`
  is 0 by construction.
- The decision ledger is `EXPECTED_DECISIONS = 6`, distributed `{afltables: 3, draftguru: 2,
  null: 1}` (`export_link_decisions.py:75-77`): five `linked` decisions plus one
  `confirmed_unlinked`. **Those five are the five labelled rows**, and three of them are the
  rows P1b saw change name evidence (Fred Rodriguez, Riley Onley, Ryan O'Keefe).

**This is not data loss.** `export_link_decisions.py:10` states that exactly six explicit
human/admin decisions existed in `player_link_resolutions` on the pre-rebuild `afldb_dev`, and
the ledger's own `$comment` is explicit: *"Authoritative for explicit human decisions only —
automatic historical links are never replayed and never appear here."* The historical draft
links were **automatic**, and ISSUE-093 deliberately declined to replay automatic evidence as
durable identity. Nothing a human decided was lost; nothing is recoverable by repair.

**Consequence for the U+00A0 finding.** The normalisation defect did not cause the population
gap — the gap predates it and has a different cause — but the two compound: with no legacy
mapping and no bridge, every unlinked draft person falls to the suggestion queue, and until
migration 099 not one of them could reach `name_exact`.

**Why `player_achievements` contributes no rows.** The table exists (migration 053) with a
populated `link_status_value`, and the source query includes it unconditionally
(`player-match-candidates.ts:236-243`). Its absence from the 6,324 is therefore a **population**
fact, not a filter: the first-kick-goal load has not been run on this database. Operator query
Q5 below confirms or refutes this in one count; if the table is non-empty the finding changes
and this item must be revisited.

##### 2. Truth-source hierarchy (binding for P1c)

Ranked by distance from the evidence the scorer reads. Implemented as `PROVENANCE_RANK` in
`tools/matching/label-set.ts` and printed beside every metric.

| Rank | Provenance | What establishes the label | Shares a scored family? |
|---|---|---|---|
| 1 | `human_link_decision` | an explicit decision in `player_link_resolutions` / the tracked decision ledger | no — an independent human judgement, the standard AFLDB already treats as authoritative |
| 2 | `draftguru_person_page_afltables_bridge` | the DraftGuru person page's own outbound AFL Tables href, matched **byte-exactly by URL** | **no** — no name, club, draft year, games, goals or era is consulted |
| 3 | `manual_review` | a curator reading the sources side by side | yes: name, club, draft_timing, draft_stats — scorer-adjacent, evaluation only |
| 4 | `confirmed_cross_source` | another confirmed AFLDB link for the same person | yes: the name string, so a namesake error propagates; admissible only on a non-name key |
| 5 | `zero_game_no_bridge` | a negative: no identity on the page **and** the person reports no senior games | the zero-games half reads `reported_games`, which the scorer scores as `draft_stats` |

**Rejected outright, by name in code** (`SCORER_DERIVED_PROVENANCES`): `scorer_top1`,
`match_suggestion`, `match_suggestion_accepted`, `player_link_match_candidates`,
`bulk_approval`. Parsing a label file carrying any of them fails. The scorer's own Top-1 is not
evidence about the scorer however high its confidence, and a cached suggestion is the same
value written down. An unrecognised provenance is not rejected but is reported
`admissible=false`, so no precision claim can be made from those rows without a decision.

##### 3. Leakage and holdout discipline

The bridge label carries the population, and it reuses **nothing** the scorer scores: the
identity is a URL-to-URL match, and its AFLDB side (`external_identities`,
`match_method = 'afltables_profile_url'`) was established by the fitzRoy import from AFL
Tables' own pages, not from any draft-source field. Stated honestly: DraftGuru's editors
presumably used a name when they authored the href, so the label is an *upstream editorial
identity assertion mediated by a URL* — the same kind of thing as a human admin approval, and
admissible on the same grounds. It is not the scorer's name family.

`--holdout-self` is **not required in P1c**, for two independent reasons, and the condition
that would change that is recorded now:

1. S6 (`resolved_namesake_agreement`) is the only signal that would read existing links, and it
   is unimplemented. No current signal consults `player_link_resolutions` or another row's link.
2. The evaluation path **never writes a label as a link**. `--labels` resolves natural keys to
   ids in read-only SQL and carries the answer beside `SourceEvidence`, which has no field that
   could hold it — the same containment the confirmed-link backtest already relies on.

`--holdout-self` becomes mandatory the moment either (a) S6 or any other link-derived signal is
implemented, or (b) a label set is promoted into real links (Stage B3) **and** the same rows are
then used to tune. The declared split is therefore: **every P1c-labelled row is holdout.** No
P1c label may enter a P3 weight grid. If P3 needs a tuning set it must be drawn separately and
declared before the first grid row, per §12 P1c.

##### 4. Recovering historical labels — the honest answer

**Zero recoverable.** The five that exist are already in the database and already in the
backtest. There is no larger durable human-decision population to export: **pre-rebuild**,
`player_link_resolutions` held six draft decisions in total, and the automatic links that
carried ISSUE-075's numbers were ruled out as identity evidence by ISSUE-093 and are not
retained in a form this issue may replay.

**Where those six decisions live now — corrected 2026-09-12 against operator evidence.** An
earlier draft of this item expected operator query Q3 to return six rows from
`player_link_resolutions` on the current database. **That expectation was wrong for a rebuilt
database, and the correction does not change the substantive finding.** Four distinct things
must be kept apart:

| # | Artefact | State |
|---|---|---|
| 1 | **Pre-rebuild** `player_link_resolutions` | held the six explicit human/admin draft decisions |
| 2 | **Durable tracked ledger** `data/reference/draftguru-link-decisions.json` | holds all six, keyed on natural keys; this is the durable decision source |
| 3 | **Rebuilt** `player_link_resolutions` | **empty — 0 rows, and that is expected** |
| 4 | **Rebuilt** `draft_persons` | five `resolved` + one `unmatched` confirmed-unlinked, all `match_method = 'draftguru_explicit_admin_decision'` |

The mechanism is recorded on ISSUE-093: the six decisions were keyed by `draft_picks.id`, a
**rebuild-unstable surrogate**, so they could not survive a rebuild *as stored*. The ISSUE-093
exporter converted them once into the natural-key ledger, and the rebuilt
`import_draftguru.py` replays that ledger into `draft_persons` — linked decisions become
`link_status = 'resolved'`, the confirmed-unlinked decision stays `unmatched`, and both carry
`match_method = 'draftguru_explicit_admin_decision'`. **The importer does not recreate
`player_link_resolutions` audit rows, and this issue does not invent a database audit trail
that does not exist.**

Operator evidence 2026-09-12 confirms all four lines: `draft_persons` returns 5 resolved + 1
unmatched explicit decisions out of 5,057 (no legacy/automatic method present at all),
`players.legacy_player_id` is populated on 0 of 13,273 rows, and `player_link_resolutions` is
empty for every `target_table`. **Nothing human was lost** — the conclusion stands on the
ledger and on `draft_persons`, which is where a rebuilt database keeps it. Q3 below has been
replaced with a check that reads the durable replay state rather than one that expects
rebuilt audit rows; a rebuilt database returning 0 audit rows is **expected**, not a failure.

##### 5. Where the larger population comes from instead

Not recovery — **acquisition**. The DraftGuru person page carries its own AFL Tables link, and
AFLDB has already measured how well (`docs/rebuild-manifests/draftguru/person-html-20260826.json`):

| Cohort (Stage B1, `person-html-20260826`) | persons | with an AFL Tables identity | coverage |
|---|---|---|---|
| `residual` (played, needing a link) | 68 | 66 | 97.06% |
| `decade_control` | 30 | 30 | 100% |
| `convergence` (same-slug pairs) | 8 | 4 | 50% |
| `zero_game_control` | 14 | 0 | 0% — correct; these people have no AFLDB player |
| **total** | **120** | **100** | **83.33%** |

with `collisions: 0`, `multiple_candidates: 0`, `self_link_disagreement: 0` and
`malformed_links: 0`. The zero-game row is not a failure: those are the true negatives.

Two tiers follow, deliberately separable:

- **Tier 1, available now, no acquisition:** the existing 120-record snapshot yields **100
  `linked` + 14 `unlinked` = 114 labels** (the 6 residual/convergence rows with no href are
  reported UNLABELLED, never invented as negatives). That is 22× the current population and is
  enough to measure Very High precision and enumerate failures, though **not** enough to admit
  the class under §9.1.
- **Tier 2, the admission-grade set:** re-run the Stage B1 acquisition over the whole person
  population. At the measured 97% residual coverage this yields a labelled positive population
  in the low thousands and a true-negative population in the thousands, which is the only route
  to the §9.1 standard.

**Admissibility.** ISSUE-093 §21 admits the Stage B1 snapshot as a *profiling / validation
oracle only, never an import source*. Evaluating a matcher against it is exactly that admitted
use. Turning the same pairs into stored links is Stage B3's separate `--bridge` path, is
governed by ISSUE-093 rather than this issue, and **P1c does not do it**. The label file is
deliberately keyed on `player_url` in the same shape the approved bridge dataset uses, so a set
that survives review is promotable later without re-keying.

##### 6. Sample-size rule — derived, and stated apart from §9.1

§9.1's **n ≥ 253 with 0 failures** is frozen and is a *parity* rule: it requires a new class to
bound its false-positive rate at least as tightly as `player_achievements`, the weakest class
already admitted. It is **not** a proof of 99.9% precision, and P1c does not restate it as one.

With zero failures in n rows, the exact one-sided 95% upper bound is `1 − 0.05^(1/n)`:

| n | exact 95% bound | rule-of-three 3/n |
|---|---|---|
| 253 | **1.177%** | 1.186% |
| 687 | 0.435% | 0.437% |
| 2,319 | 0.129% | 0.129% |
| 2,995 | **0.100%** | 0.100% |
| 4,603 | 0.065% (this is the **99%**-confidence n for 0.1%) | 0.065% |

So:

- to **bound** the draft bulk false-positive rate below 0.1% at 95% confidence:
  **n ≥ 2,995 bulk-eligible labelled rows with 0 false positives**; at 99% confidence, 4,603;
- an **observed** precision of 99.9% is not even expressible below n = 1,000, because one error
  in 253 rows is 99.60%. An observed rate and a confidence bound are different statements, and
  §13's "Very High precision ≥ 99.9%" is the former.

**Recommendation (does not amend §9.1, which is frozen):** draft re-admission requires the §9.1
table in full *and* the achieved bound recorded beside it. Given that P1b puts 2,642 draft rows
at Very High, 2,995 is plausibly reachable on a Tier-2 population and 253 certainly is — so the
gap between "admissible under §9.1" and "99.9% proven" should be closed by measurement rather
than by wording. `zeroFailureUpperBound`, `requiredZeroFailureSample` and
`smallestSampleExpressing` in `tools/matching/label-set.ts` compute all three figures, are unit
tested, and the `--labels` run prints them beside the population it measured.

##### 7. Tooling built (evaluation only; no scorer behaviour changed)

- **`tools/matching/label-set.ts`** — pure, DB-free. Parses and validates a label file;
  enforces the canonical `player_url` and AFL Tables path forms; rejects scorer-derived
  provenance by name; requires a target on `linked` and forbids one on `unlinked`; raises a
  **contradiction** naming both sides when one person carries two labels, and when two persons
  claim one AFLDB player — it never resolves either. Also holds the truth-source hierarchy, the
  leakage table and the three sample-size functions.
- **`tools/matching/backtest.ts` `--labels <file>`** — scores every labelled draft person
  regardless of stored `link_status` (unresolved and trusted rows are both read), joining truth
  by two name-free joins: `player_url → draft_persons.id`, and AFL Tables path →
  `external_identities → players.id`. Reports the full standard table (recall, top-1/3/5,
  bands, Very High precision, bulk precision, ambiguity, conflicts, score and gap distribution,
  per-source, every bulk and Very High false positive) plus P1c-specific sections:
  truth-source independence, **name evidence exact vs fuzzy**, a 14-bucket **stratification**,
  **every wrong top-1 enumerated in full** (not sampled), the **true-negative** table with every
  Very High hit on a person who has no AFLDB player, and the §9.1 arithmetic. A label whose
  person or whose AFL Tables target does not resolve is **reported, never dropped** — silently
  shrinking the population would flatter every rate computed from it. Output uses the existing
  `cases` shape so `npm run match:compare` reads a label run unchanged; negatives live in a
  separate `negatives` array so the comparator's `expectedPlayerId` contract holds. **D-9 is
  enforced:** any bulk-eligible draft row prints the `*** STOP CONDITION ***` block and sets
  exit code 2.
- **`tools/matching/export-draft-labels.ts`, `npm run match:draft-labels`** — offline; turns a
  Stage B1-style `person_profile.jsonl` into a label file. Emits `linked` on an observed
  identity; emits `unlinked` **only** when there is no identity *and* the person is in the
  declared zero-game cohort; reports everything else as UNLABELLED. A page carrying two distinct
  identities is a finding and is skipped, never resolved by choosing one. It validates its own
  output through `parseLabelSet` before writing.
- **Tests** — `tests/match-backtest-compare.test.ts` (the existing tools/matching suite,
  extended; no new file): label parsing and ordering, scorer-derived provenance refused,
  surrogate key refused, both contradiction classes named rather than resolved, target
  required/forbidden, the three leakage cases, and the sample-size arithmetic including the
  explicit assertion that 253 zero-failure rows do **not** prove 99.9%. 29 tests green;
  `tsc --noEmit` clean; `tests/player-matching.test.ts` and
  `tests/player-link-mutations.test.ts` unchanged and green (130 across the three suites).

##### 8. `draft_person:4163` "Sam Chapman" — determination deferred, not guessed

Both runs, read from the frozen queue reports:

| Run | Top-1 | Score | Composition | Runner-up |
|---|---|---|---|---|
| v1 | Paul Chapman #10273 | 28 | `club_anywhere` 15 + `draft_year_before_debut` 13 — **no name signal at all** | Sam Chapman #11609 (26, `name_trigram_high` only) |
| P1b v2 | Sam Chapman #11609 | 44 | `name_exact` only | Paul Chapman #10273 (28) |

Context: `Draft · 2000 · Rookie`. Neither candidate is corroborated. Paul Chapman scored *only*
non-name evidence; Sam Chapman scores *only* the name. Neither earns `draft_games_exact` or
`draft_goals_exact`, so the draft source's reported stats agree with neither. The band moved
`none → low`; the row is not bulk-eligible, not ambiguous, gap 16.

**The new result is not treated as truth because it now wins.** An exact name with no
corroborating family is precisely the §3.2 namesake shape, and the row's own club/timing
evidence points at the *other* candidate. This is the best worked example of why P1c exists,
and it is settled by an authorised source, not by the score.

**Correction, 2026-09-12, against operator evidence.** An earlier draft of this item said
operator query Q4 returns a `player_url` "whose DraftGuru page carries the AFL Tables href that
decides it". **That was too strong.** Q4 returns the durable key and nothing more:

| Field | Value |
|---|---|
| `player_url` | `https://www.draftguru.com.au/players/sam_chapman/2` |
| `display_name_raw` | renders as "SamA Chapman" — U+00A0 present in the source formatting |
| `reported_games` / `reported_goals` | 0 / 0 |
| `link_status` | `unmatched` |
| context | `Draft · 2000 · Rookie`, Geelong |

- `sam_chapman/2` is **not** in `draft-labels-b1-120.json`, and a direct search of the accepted
  Stage B1 `person_profile.jsonl` returned no record for it either.
- **Tier 1 therefore cannot resolve this person.** The snapshot that exists does not contain
  him, so there is no href to read.
- The status remains **undetermined**. Future determination requires an authorised source or
  acquisition that includes this person — Tier 2 under ISSUE-093 governance is the expected
  route.
- The v2 `name_exact` win is **not** evidence of correctness. A scorer result is not truth, and
  this row is the worked example of why.

##### 9. The historical 2,319 draft bulk result — **not reproducible, and must not be carried forward**

| Question | Answer |
|---|---|
| Reproducible today? | **No.** |
| Why | Its ground truth was the legacy automatic `legacy_player_id` link population, produced by a retired importer against a source (`AFLDB_LEGACY_SQLITE`) the rebuilt path does not have and a column (`players.legacy_player_id`) it never populates. |
| Recoverable from audit/resolution history? | **No.** `player_link_resolutions` held six draft decisions; all six are exported to the tracked ledger. |
| Invalidated by schema change? | Not by schema — by a **governance decision**: ISSUE-093 ruled automatic historical links inadmissible as durable identity, and the ledger records that they are "never replayed". |
| Was it ever human-verified? | Not at that scale. ISSUE-075 verified its *initial live bulk-ready set* by hand (the 44/44 procedure); the 2,319 backtest rows were automatic links measured against automatic links. |

Beyond irreproducibility there is a **methodological** objection that stands on its own: if the
legacy auto-linker matched on normalised name, then measuring a name-weighted scorer against
its output is partly circular, and the 100% / 0-FP figure is weaker than it reads. The four
§9.1 bounds (`award_winners` 0.109%, `draft_person` 0.129%, `award_nominations` 0.426%,
`player_achievements` 1.177%) stay in the runbook as the **historical** record they are already
labelled as; `draft_person` 2,319 may not be cited as current evidence for anything, and D-9
already encodes that.

##### 10. D-9 — remains in force

Unchanged. **Updated 2026-09-12 after the Tier 1 run (item 12).** The tooling has now been run
and the labelled draft population is 114, not 5 — but the evidence for re-admission still does
not exist. Tier 1 produced **0 bulk-eligible labelled rows** (D-9 suspends the class, so there
is nothing to bound) against a §9.1 floor of 253, and no bridge acquisition has happened. P1c
has produced the *method* and a *calibration measurement*; it has not produced
*admission-grade* evidence. D-9 is reconsidered only when a
`--labels` run over a Tier-2 population presents the §9.1 table in full — ≥ 253 bulk-eligible
labelled rows, 0 false positives, 0 hard conflicts among them, exact name evidence on every one,
≥ 2 independent corroborating families, median gap ≥ 25 — with the achieved confidence bound
recorded beside it and the 100% hand review of the initial live bulk-ready set completed.

##### 11. Operator commands (read-only unless stated)

Reconciliation, all `SELECT`, against the dev application database:

```sql
-- Q1  the draft population by stored link status, and how it was matched
SELECT link_status, match_method, count(*)
  FROM draft_persons GROUP BY 1, 2 ORDER BY 3 DESC;

-- Q2  does any player still carry the legacy identity the old linker resolved through?
SELECT count(*) FILTER (WHERE p.legacy_player_id IS NOT NULL) AS with_legacy,
       count(*) AS players
  FROM players p;

-- Q3  the durable human decision population, as a REBUILT database holds it.
--     CORRECTED 2026-09-12. player_link_resolutions keys decisions on the
--     rebuild-unstable surrogate draft_picks.id and is NOT replayed by
--     import_draftguru.py, so it is EMPTY on a rebuilt database and 0 rows is
--     the expected answer, not a failure. The durable source is the tracked
--     ledger data/reference/draftguru-link-decisions.json; the observable
--     replay state is in draft_persons. Expect 5 resolved + 1 unmatched.
SELECT link_status, count(*) AS decisions
  FROM draft_persons
 WHERE match_method = 'draftguru_explicit_admin_decision'
 GROUP BY 1 ORDER BY 1;

-- Q3b (optional, confirms the absence is the expected one rather than a filter
--      artefact: expect NO ROWS on a rebuilt database)
SELECT target_table, count(*), count(DISTINCT target_id)
  FROM player_link_resolutions GROUP BY 1;

-- Q4  Sam Chapman: the durable key, and ONLY the durable key. It does not
--     settle the determination — see item 8; the accepted Stage B1 snapshot
--     does not contain this person.
SELECT per.id, per.player_url, per.display_name_raw, per.reported_games, per.reported_goals,
       per.link_status, dp.draft_year, dp.draft_type, cl.name AS club
  FROM draft_persons per
  JOIN draft_picks dp ON dp.draft_person_id = per.id
  LEFT JOIN clubs cl ON cl.id = dp.club_id
 WHERE per.id = 4163;

-- Q5  why player_achievements contributes no labelled rows
SELECT link_status_value, count(*) FROM player_achievements GROUP BY 1;

-- Q6  how many bridge targets could land on a registered player at all
SELECT count(*) AS afltables_identities
  FROM external_identities ei
  JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
 WHERE ei.match_method = 'afltables_profile_url' AND ei.status IN ('unique','resolved');
```

Tier 1 labelling and measurement, from the accepted Stage B1 snapshot already on the host
(substitute the snapshot's own working directory for `<snapshot>`):

```bash
npm run match:draft-labels -- <snapshot>/parsed/person_profile.jsonl \
  --out draft-labels-b1-120.json --label-set draft-b1-person-page-20260826

npm run match:backtest -- --labels draft-labels-b1-120.json \
  --out backtest-p1c-draft-labels-b1.json
```

Exit code 2 from the second command is the D-9 stop condition, not a tool failure. Neither
command writes to the database; neither touches a frozen baseline.

Tier 2 (admission-grade) is a Stage B1 acquisition over the whole person population under
ISSUE-093 governance, and is **not** authorised by this runbook. It is the recommended next
step and should be raised on ISSUE-093, with P1c consuming its parsed output through the same
two commands above.

##### 12. Tier 1 measurement — executed (operator, 2026-09-12) — P1c MEASUREMENT COMPLETE

Both commands in item 11 ran against the accepted Stage B1 snapshot. Artefacts:
`draft-labels-b1-120.json`, `backtest-p1c-draft-labels-b1.json`. No database write, no frozen
baseline touched.

**Label export.** 120 records read → **114 labels written** (100 `linked`, 14 `unlinked`), **6
UNLABELLED** and correctly *not* invented as negatives: `adam_houlihan/2`, `andrew_hill/1`,
`brad_miller/2`, `fred_rodriguez/1`, `michael_brown/2`, `riley_onley/1` — each has no AFL
Tables href.

**Scored population.** 110 persons resolved, 0 persons not found, **4 positive targets not
found in AFLDB** — Aidan Schubert, Archie Ludowyke, Oscar Ryan, Talor Byrne — **reported
explicitly and excluded from the rates rather than silently dropped**. Scored: **96 resolvable
positives + 14 true negatives = 110 rows**.

**Positive metrics (n = 96).**

| Metric | Result |
|---|---|
| candidate recall | 96/96 = **100%** |
| Top-1 | 95/96 = **98.96%** |
| Top-3 | 96/96 = 100% |
| Top-5 | 96/96 = 100% |

**Bands (positives).** Very High 54, **54 correct = 100% precision**; High 32/32; Medium 3/3;
Low 6/6; None 1, 0 correct. **No Very High false positives. No hard conflicts.** Ambiguous 2,
of which 1 correct. Bulk eligible **0**, bulk FP 0 — D-9 in force.

**The single wrong Top-1, in full.** `draft_person:3214` / `draft_picks#1000` "Matt Rendell" —
chose Matt Rowell #9235, score 0, gap 0, band `none`; expected Matt Rendell #9310 at **rank 2**.
That is the only Top-1 error in the population.

**True negatives (n = 14).** Very High **0**, High 0, Medium 0, Low 1, None 13. **Confident
false positives: 0. Bulk-eligible: 0.**

**Where the error lives — stratification.** Name evidence: exact 94/94 correct, fuzzy 1/1
correct, none 1/1 **wrong**. Draft stats exact 86/86; stats **drifted 9/10**. Club evidence
present 56/56; club evidence **absent 39/40**. No rival 34/34; exact-name rival present 0; hard
conflict 0; true player missing from the candidate set 0. **The failure is entirely in the
weak-evidence tail** — stats-drifted, club-absent, `none`/ambiguous — not in the confident
population.

**P1c decisions recorded.**

- Tier 1 labels produced = **114**; methodologically admissible = **yes** (ISSUE-093 §21 admits
  the snapshot as a profiling/validation oracle, which is exactly this use).
- Resolvable positive evaluation n = **96**; true-negative evaluation n = **14**.
- v2 Top-1 **98.96%**; v2 Very High precision **100% (54/54)**; Very High FP **0**; confident
  false positives on true negatives **0**.
- **Draft calibration is improved substantially and is now measured on a real population
  22× the previous one.** That is the honest extent of the claim.
- **Tier 1 is NOT enough to reconsider D-9.** Bulk n = 0 because D-9 suspends the class, so
  §9.1 cannot be satisfied by this run under any reading; 114 labels is also below the 253
  floor and far below the 2,995 a 0.1% bound costs.
- **Tier 2 is required before draft bulk re-admission**, and — under the frozen P1c rule —
  **also before any draft-specific scoring or weight change such as S2 is tuned**. No draft
  scoring change is authorised from this Tier 1 result.
- `draft_person:4163` **Sam Chapman remains undetermined** (item 8): he is not in this snapshot.

**Report-wording defect found and fixed in the same pass.** The run printed
`95% upper bound on bulk FP rate  n/a (a failure was observed, so the zero-failure rule does
not apply)`. **That wording was wrong for this run:** no bulk failure was observed; the bulk
sample is empty because D-9 disables draft bulk. `describeZeroFailureBound(n, failures)` in
`tools/matching/label-set.ts` now separates the three cases — `n = 0` → "no bulk-eligible
labelled rows in this population"; `n > 0` with failures → the failure wording, naming the
count; `n > 0` with zero failures → the computed bound — and `backtest.ts` calls it. Unit
tested in `tests/match-backtest-compare.test.ts`. **No scoring, band, weight, threshold or D-9
behaviour changed.**


Only after P1a, P1b and P1c are complete may S1–S4 evidence additions, weight grids, band
changes or draft bulk-policy changes be evaluated (P3).

### P2 — unit coverage (extend, do not create)

- `tests/player-matching.test.ts`: S1 lineage match and lineage-aware conflict; S2 fires only
  with timing and the first club; S3/S4 club-text resolution passed in as evidence; unresolved
  club text yields no signal and no conflict; S6 never counts toward independence; ceilings per
  profile; `explainLimits` reasons; determinism and order-independence for every new signal.
- `tests/player-matching-describe.test.ts`: labels for new signals and limit reasons; bulk
  criteria rendered as ✓/✗ for ineligible rows; stale-version label wording.
- `tests/player-link-mutations.test.ts`: the existing "suggested match approval" and action
  contracts stay green unchanged (re-score under lock, bulk refusal, no browser score), plus
  new cases for invariant 13: a cached row under `v1` with current `v2` is approved only on
  the fresh v2 result and the outcome carries the stale notice; a stale row whose fresh best
  differs is refused with `changed`; the action reads the cached version from the database,
  never from the form; bulk approval reports stale rows per row.
- `tests/player-link-mutations.test.ts` "queue page contracts": the page derives staleness
  from the server-side cache version, and renders the banner and per-row badge.
- `tests/integration/player-matching.test.ts`: club-text resolution against real `clubs` /
  `club_aliases`; "raises no contradiction against links AFLDB already confirmed" remains
  green under v2; a lineage case (Footscray ↔ Western Bulldogs) recalls the true player.

### P3 — deterministic backtest gates (operator)

Run per §7 procedure after each grid row; record the tables in this runbook. Acceptance in
§13.

#### P3A implementation record — evidence plumbing only (2026-09-12, Opus 5)

**Scope executed:** S1 (lineage-aware club identity), the exact club-text resolution S3 and S4
depend on, and the S3/S4 signals themselves. **No weight was invented.** §7 step 3 freezes a
candidate number for S2 ("30/36") and for nothing else, so the S3/S4 weights ship as `null` and
score nothing; the grid below is put to the operator before any of it is measured. S2 and every
other draft-specific rule are **untouched** (D-9 unchanged, `draft_person` still non-bulk,
`draftTiming` / `draftGames` / `draftGoals` / bands / gaps / bulk floors all byte-identical).

**`ALGORITHM_VERSION` = `v3`.** D-8 reserves `v3` for the first P3 scoring change and S1 is one:
it changes both the club reward and the `club_not_in_history` contradiction. The whole cache is
therefore stale at `v2` until an operator Refresh, which is exactly what P2's banner, per-row
badge, drawer warning and approval-time stale notice exist to show. None of that work was
touched; approval still locks, re-reads through `fetchSourceEvidence` (so lineage and resolution
reach it identically) and re-scores under current code.

##### S1 — lineage-aware club identity

`CandidateClub` now carries `organizationId` (`clubs.organization_id`, joined onto
`player_clubs`), and `SourceEvidence` carries `clubOrganizationId` for its `club_id`. One helper,
`sameClubLineage`, decides club identity everywhere:

- both sides know their organization → compare organizations;
- either side does not → fall back to the raw `clubs.id` comparison, i.e. exactly v2 behaviour.

It is used in **both** places §5 requires: the positive club signal and the
`club_not_in_history` contradiction. The signal names are unchanged (`club_in_season`,
`club_anywhere`) because §6 makes S1–S4 one family and a second club signal for one club fact
would be double payment; a lineage-driven match is visible in the band-migration matrix and in
the evidence detail rather than as a new signal id.

Direction of change is one-way and worth stating before the measurement: lineage can only
**remove** `club_not_in_history` (two identities that share an id already share an organization)
and **add** club agreement. It cannot manufacture a new club contradiction. It can still move a
namesake's score, which is what the backtest is for.

Mergers are deliberately not lineage. `club_organization_relations` (migration 017) records
Fitzroy → Brisbane Lions as a relation between two organizations precisely so the records do not
combine, so a Fitzroy source row is never corroborated by a Brisbane Lions career.

##### Club-text resolution (D-4, read time, exact only)

`src/lib/player-matching/club-identity.ts`, pure and unit-tested; the index is built once per
query in `fetchClubLineage` from `clubs.name`, `clubs.short_name` and `club_aliases.alias`. Both
sides pass through one normaliser (`normaliseClubText`: NFC, lower-case, Unicode whitespace
collapsed, trimmed — **nothing else stripped**), so a SQL `lower()` and a TypeScript normaliser
cannot drift apart. Rules:

1. Split the raw field on `|` and `,`. Those are the separators the sources actually use —
   Hall of Fame writes `Collingwood | Fitzroy`, honour teams write
   `Claremont, North Melbourne, St Kilda`, and both use a trailing comma for a competition tag
   (`Carlton, VFL`, `Norwood, SANFL, ANFC`). A tag simply fails to resolve.
2. Resolve each segment by **exact** equality against a canonical club string. Never trigram,
   never prefix, never token overlap.
3. One extension, exact and fail-closed: a segment of the form `A (B)` resolves only when `A`
   **and** `B` are both canonical clubs of the **same** continuing club. This is
   `Western Bulldogs (Footscray)`, the form 12 Hall of Fame rows use. `Fremantle (1882)` — an
   1882 Victorian club — resolves to nothing, because `1882` is not a club, which is why no
   parenthetical is ever stripped. `Glenorchy (New Town)` resolves to nothing for the same
   reason. **This rule is an addition to §8 item 1 and is flagged for operator veto.**
4. Fail closed on ambiguity: a segment matching identities of more than one organization (a
   short name shared by Brisbane Bears and Brisbane Lions, say) is unresolved. So is a matched
   identity with no `organization_id`.
5. Unresolved text yields no positive evidence, no negative evidence and **no contradiction**.
   Most of a Hall of Fame club list is SANFL, WAFL and Tasmanian clubs AFLDB does not hold at
   all, and "not an AFLDB club" is not evidence against anybody.
6. Multi-club fields stay multi-club: the resolution is a list, one entry per continuing club,
   in source order. Nothing is flattened and no raw text is rewritten.
7. Resolution is scoped to `hall_of_fame` and `honour_team_members` — the two sources that carry
   club text and no `club_id`. Rows that carry a `club_id` do not re-resolve their own printed
   name (that would be a second club signal for one club). A club-less `award_winners` row such
   as Jack Lynch's is therefore **not** in scope; widening the rule to those tables is a separate
   measurement and was not made here.

The inventory the rules were written against is in the tracked sources, not inferred:
`data/awards/hall-of-fame.csv` (343 rows, 193 distinct club strings, 25 empty) and
`data/awards/honour-teams.csv` (113 rows, 41 distinct, 67 empty).

##### S3 — `club_in_span` (Hall of Fame)

Family `club`. Fires when a resolved club's lineage appears in the candidate's `player_clubs`
**and** that club stint overlaps the career span the Hall of Fame row itself asserts
(`playing_career`, already parsed into `active_range`). No contradiction on non-overlap: §5 is
explicit that a Hall of Fame club list may name a non-VFL club, and absence is unknown.

##### S4 — `club_text_anywhere` (Hall of Fame, honour teams)

Family `club`. Fires when a resolved club's lineage appears anywhere in `player_clubs`. S3 is
tried first and only one club signal ever scores, so S4 is reached only when no resolved club
sits inside the asserted span, or when the source asserts no span at all (every honour-team row).
No contradiction, ever.

##### P3B — candidate weight grid, for operator approval

The runbook does **not** freeze a number for either signal, so nothing has been measured yet.
What the runbook does fix is S4's magnitude: §5 S4 states the honour-team ceiling moves
**44 → 59**, which is `name_exact` + 15, i.e. S4 inherits the existing `clubAnywhere` weight.
S4 is therefore held at 15 across the grid and S3 is the only free variable. S3 must stay below
`clubSeason` (36) — a stint overlapping a multi-year asserted span is weaker evidence than a
club corroborated in one named season — and at or above `clubAnywhere` (15), since S3 is
strictly more than "played there at some point".

| Row | `clubTextInSpan` (S3) | `clubTextAnywhere` (S4) | Full HoF profile | Rationale |
|---|---|---|---|---|
| P3-0 | `null` | `null` | 61 | Control: S1 only, i.e. the code as it now stands. Isolates the lineage change. |
| P3-A | 15 | 15 | 76 | S3 and S4 both inherit `clubAnywhere`; the span adds nothing but a label. Lower bound. |
| P3-B | 20 | 15 | 81 | Span overlap worth more than "anywhere", still short of Very High. |
| P3-C | 24 | 15 | **85** | The first value at which a full HoF profile (exact name 44 + span exact 17 + S3) reaches Very High exactly. |
| P3-D | 28 | 15 | 89 | Above the line but still below the bulk floor of 90, so the band can be tested without approaching bulk. |

Five backtest runs, each a separate recorded policy configuration per §7 step 3. No band, gap,
trigram, bulk-floor or draft weight moves in any row; the only edit between rows is those two
numbers. **Nothing in this table has been run, and `hall_of_fame` and `honour_team_members`
remain suggestion-only in every row** — D-5 is frozen and the current 240-link Hall of Fame
population cannot meet §9.1 however well it scores.

##### Representative cases — status at P3A

- **Frank Johnson** (`hof:176`, inducted 2007, `player_id` 3130, already `resolved`): club text
  `South Melbourne | Port Melbourne`, span `1960-1964, 1950-1957` → `1950-1964`. `South
  Melbourne` resolves to the Sydney lineage; `Port Melbourne` (VFA) resolves to nothing and
  contributes nothing. So the evidence that could separate the two Frank Johnsons is now
  **resolved and carried**, and under P3-0 it still scores nothing. Whether it actually
  discriminates is a P3B measurement, not a claim available now.
- **Jack Lynch** (`aah:1953`, All-Australian 1953, `West Adelaide`, `link_status` *ambiguous*):
  an `award_winners` row, not a club-text source. `West Adelaide` is a SANFL club AFLDB does not
  hold, so it resolves to nothing under any grid row. **P3 does not touch this case and must not
  be reported as improving it.** He stays ambiguous, which is the correct outcome.
- **Multi-club Hall of Fame row:** `Western Bulldogs (Footscray) | Fitzroy` (2 rows) exercises
  the bracketed-identity rule and the multi-club list in one string; `Collingwood | Sydney`-shaped
  rows exercise "credit whichever club the career actually shows".
- **Unresolved club text:** `Norwood | West Adelaide | Sturt`, `Claremont, WAFL, ANFC`, `SANFL`,
  `VFL/AFL` and `former coach of North Melbourne` all resolve to nothing and raise nothing.
- **Lineage case for S1:** any source row whose `club_id` is Western Bulldogs against a career
  recorded under Footscray (and the South Melbourne/Sydney pair). Both are pinned as unit tests
  and as integration assertions against the real `clubs` table.

##### Tests completed locally (no database)

`npx tsc --noEmit` clean. `tests/player-matching.test.ts` **86 passed** (34 new: club-text
resolution, S1 lineage and contradiction, merger-is-not-lineage, S3/S4 selection and precedence,
unresolved text, multi-club, one-signal-per-family), `tests/player-matching-describe.test.ts` and
`tests/player-link-mutations.test.ts` green unchanged — **146 across the three suites.** The
S3/S4 selection cases run under a locally applied candidate weight that is restored afterwards,
because the shipped policy scores nothing from club text; the shipped `null`s are themselves
asserted.

`tests/integration/player-matching.test.ts` gains nine database-backed cases (lineage pinned for
Footscray/Western Bulldogs and South Melbourne/Sydney, the Fitzroy/Brisbane Lions separation,
Kangaroos where the schema has it, lineage present on every source row and candidate club, Hall
of Fame text resolving only to verbatim segments, and no club contradiction from either
club-text source). **Operator run required.**

##### Open before the next P3 tranche

1. Operator approves, amends or rejects the P3B grid above; no weight may be set without it.
2. Operator vetoes or accepts the bracketed-identity rule (item 3 of the resolution rules).
3. Operator runs the integration suite and the P3-0 backtest/compare pair, so the lineage change
   is measured on its own before any weight is added.

#### P3B decision record — the grid, measured and selected (2026-09-12, operator + Opus 5)

**Selected: S3 `clubTextInSpan` = 15, S4 `clubTextAnywhere` = 15.** These are now the shipped
values in `MATCH_POLICY.scoring.club` (`src/lib/player-matching/confidence.ts`); the nulls are
gone. `ALGORITHM_VERSION` stays `v3` — the version was already taken by S1 in the same tranche,
and the whole cache is already stale at `v2`.

The grid was run against the labelled set with the shipped policy untouched, each row declared
on the command line and recorded in its own report (§7 step 3). `S4` was held at 15 throughout
per §5, so S3 was the only free variable.

##### Measured grid

| Row | S3 | S4 | Labelled Top-1 | HoF Top-1 | Very High | VH FP | Bulk | Hard conflicts | Ambiguity |
|---|---|---|---|---|---|---|---|---|---|
| P3-0 (control, S1 only) | null | null | 6301/6324 = 99.64% | 236/239 = 98.74% | 5528 | 1 | 3817/3817 | 9 | 25 |
| **P3-A (selected)** | **15** | **15** | **6303/6324 = 99.67%** | **238/239 = 99.58%** | 5528 | 1 | 3817/3817 | 9 | **19** |
| P3-B | 23 | 15 | unchanged from P3-A | unchanged | — | — | — | — | — |
| P3-C | 24 | 15 | unchanged | unchanged | — | — | — | — | — |
| P3-D | 29 | 15 | unchanged | unchanged | — | — | — | — | — |

Top-3 and Top-5 are unchanged in every row. Signal frequencies at 15/15: `club_in_span` 226,
`club_text_anywhere` 43.

##### Why 15 wins

15/15 buys the **entire** measurable identity improvement the club-text evidence has to offer,
and every higher S3 buys only score. Under the "lowest useful weight" rule frozen before the
grid ran:

- **P3-B (23)** moved 74 rows up a band and changed 136 material gaps, and corrected **no**
  additional identity.
- **P3-C (24)** moved 151 Hall of Fame rows from High to Very High. All 151 were correct, so
  nothing was broken — but nothing was *fixed* either, and Very High is a claim about certainty,
  not a reward for having more evidence types. Inflating it without a matching accuracy gain is
  exactly the failure §9.1 exists to prevent.
- **P3-D (29)** improved no expected rank at all; pure score inflation.

23, 24 and 29 are therefore **rejected as confidence inflation without identity improvement**.

##### The two confirmed corrections (the whole of the labelled improvement)

1. `hall_of_fame#36` **Frank Hughes** — wrong Frank Hughes `#4385` (score 44, low) →
   correct Frank Hughes `#4386` (score 59, medium).
2. `hall_of_fame#276` **Mark Williams** — wrong Mark Williams `#9149` (score 53, low) →
   correct Mark Williams `#9150` (score 68, medium).

**No correct Top-1 became wrong anywhere in the grid.** Both corrections land in *medium*, not
Very High: the evidence separates a namesake pair, it does not certify the row, which is the
intended shape.

##### Safety at the selected policy

Very High count, Very High false positives (1), bulk (3817/3817, 0 FP) and hard conflicts (9)
are **all identical to the P3-0 control**. Ambiguity falls 25 → 19. Nothing was promoted into a
stronger claim than it had before; the improvement is entirely in which candidate ranks first.

##### Unresolved queue at the selected policy (P3-0 → P3-A)

Population 5390 unchanged; Very High 2680 → 2680; bulk 38 → 38; hard conflicts 23 → 23;
ambiguity aggregate 379 → 379; `draft_person` **completely unchanged**. No new Very High, no new
bulk. Six low-confidence band promotions and one changed Top-1 suggestion:

- **`hall_of_fame#38` George Coulthard** — George Card `#4884` (score 0) → George Collard
  `#4900` (score 15), on `club_text_anywhere`, against a `career_span_no_overlap` conflict. Band
  stays `none`, bulk false. Recorded as a **changed weak suggestion, not a confirmed
  improvement**: a score of 15 with a span conflict is a hint for a human, nothing more.
- **`hall_of_fame#168` John Murphy** — Top-1 unchanged (John Murphy `#7655`, score 76,
  `name_exact` + `club_in_span` + `career_span_exact`); the alternative John Murphy `#7656` rose
  to 68, gap 8, so the row is now medium **and ambiguous**. This is the safety machinery working:
  two near-identical candidates should refuse to look settled. Not a regression.
- **Norman Ware — `Western Bulldogs (Footscray)`**: gap +15 under S3/S4, confirming the approved
  same-organization parenthetical rule (resolution rule 3) resolves and pays as designed.

##### Draft: frozen, and verified frozen

Raw club-id semantics, no S1 lineage for draft, S2 not implemented, **D-9 remains active**, no
draft bulk, no Tier 2 work. `draft_person` is byte-identical across the whole grid on the
unresolved queue, and a DB-free unit case re-scores a draft row at 15/15, 23/15, 24/15 and 29/15
and asserts the scored result is unchanged.

##### Shipped-policy semantics after selection

The calibration mechanism is **kept**, not removed — the next question about these weights
deserves the same reproducibility this one got — with its meaning updated:

- shipped values come from `MATCH_POLICY`, and are 15/15;
- no override (every application code path) = 15/15, reported as `source: 'shipped'`;
- an explicit `--club-text-in-span N --club-text-anywhere M` still overrides, still records
  itself as `calibration-override`, and still may not touch `MATCH_POLICY`;
- `setClubTextCalibration(null)` returns to 15/15, never to "not scored";
- still no environment variable: application behaviour that an exported shell variable can move
  is behaviour nobody can reproduce.

Unchanged and re-asserted: bands, gaps, bulk floors, source bulk policy, Hall of Fame and
honour-team **non-bulk** (D-5), D-9, draft raw-id matching, stale-cache safety,
`ALGORITHM_VERSION` = `v3`.

##### Validation

`npx tsc --noEmit` clean. `tests/player-matching.test.ts`, `tests/match-backtest-compare.test.ts`
and `tests/player-link-mutations.test.ts`: **177 passed**. Operator run required for
`tests/integration/player-matching.test.ts`, then a final shipped-policy backtest and queue run
with **no** calibration override, to prove default v3 reproduces the selected 15/15 result
exactly.

### P4 — representative cases, bulk-class review and live proof — **COMPLETE 2026-09-12**

Phase headings in this section are aligned with §16: the live proof belongs to P4, and P5 is
closeout. The earlier split ("P4 — representative cases" / "P5 — live proof") is superseded;
nothing in the historical evidence below it was rewritten.

#### P4.1 Representative cases

Pin the P0 rows (four modern draft, two historical, plus the Aaron Cadman `award_winners`
control) as a fixture list in the runbook with their v1 (§2.10), post-P1a and final-policy
outcomes; add DB-free unit cases that reproduce the trigram-high 79 composition with a NBSP
name, the same row after canonicalisation (97 arithmetic, bulk state asserted from the
unchanged rules, not assumed), the two exact-name 79 compositions, and the 44 / Needs-review
namesake composition from §3.

#### P4.2 Shipped policy under review

`ALGORITHM_VERSION` = `v3`; S3 `clubTextInSpan` = 15; S4 `clubTextAnywhere` = 15; draft keeps
raw-club-id semantics; **D-9 remains active**; `hall_of_fame`, `honour_team_members`,
`captaincies`, `draft_person` and `draft_picks` remain non-bulk.

#### P4.3 Bulk-class review under v3 (§9.1 applied mechanically)

| Class | Labelled n | Bulk | FP | Observed precision | Rule-of-three bound | Outcome under v3 |
|---|---|---|---|---|---|---|
| `award_winners` | 3,468 | 3,130 | 0 | 100% | ≈ 0.096% | **Admitted, re-verified under v3** |
| `award_nominations` | 750 | 687 | 0 | 100% | ≈ 0.437% | **Admitted, re-verified under v3** |
| `player_achievements` | 0 | — | — | — | — | **Policy-admitted on historical ISSUE-075 evidence only** (253 bulk / 0 FP / ≈ 1.19%). The executable v3 population contains **no** `player_achievements` rows, so §9.1 is **NOT** re-verified under v3 for this class. Do not describe it as re-verified. |
| `captaincies` | — | 0 | — | — | — | Non-bulk by policy (class-level semantic divergence). The measured Very High false positive remains Jobe Watson. No admission. |
| `draft_person` | 5 | 0 | — | — | — | Non-bulk under **D-9**. No admission. |
| `draft_picks` | — | 0 | — | — | — | Non-bulk. |
| `hall_of_fame` | 239 | 0 | — | — | — | Shipped 15/15 yields 0 bulk, and 239 < the frozen 253 minimum in any case. Non-bulk / suggestion-only. |
| `honour_team_members` | 88 | 0 | — | — | — | Non-bulk. |

**No new class is admissible, and none was admitted.**

#### P4.4 Live stale-cache proof (dev, cache `v1` vs code `v3`)

Pre-refresh state of `afldb_dev`: `algorithm_version` = `v1` only; 10,394 cache rows; 4,615
rank-1 entities; 38 bulk rows; `computed_at` 2026-09-11 14:21:22+10.

A local `v3` worktree was served against that still-`v1` cache. Confirmed visually:

- the page banner reported 4,615 cached suggestions computed under `v1` while the current
  algorithm is `v3`, and warned that scores, bands and bulk flags were stale;
- the banner stated that approval re-scores under `v3` and refuses unsupported or changed
  evidence;
- per-row **STALE (V1)** badges rendered;
- the Aaron Cadman drawer showed algorithm `v1` (current `v3`), a prominent stale warning and
  the current-code re-score/refusal wording;
- the **Recompute suggestions** control was visible.

This satisfies invariant 13 and §13 item 3a live, at a cache/code version distance of v1→v3.

#### P4.5 Live refresh

**Recompute suggestions** was run through the admin UI. Post-refresh the banner and every
stale badge were gone, the Aaron Cadman drawer reported algorithm `v3`, and the queue showed
5,390 unresolved / 10,394 candidates / 38 bulk-ready.

DB proof after refresh (`afldb_dev`): `algorithm_version` = `v3` only; 10,394 cache rows;
4,615 rank-1 entities; 38 bulk rows; `computed_at` 2026-09-12 17:44:26+10.

#### P4.6 Live bulk population

All 38 post-refresh bulk rows were enumerated: **1 `award_nominations` row (#50) and 37
`award_winners` rows**, all algorithm `v3`, all score 97. **No** `draft_person`, `draft_picks`,
`hall_of_fame`, `honour_team_members`, `captaincies` or `player_achievements` row appears in
the live bulk population. This exactly matches the deterministic shipped-`v3` queue population
already measured in P3.

**Evidential wording, deliberately precise.** The aggregate count stayed at 38, and the
deterministic v1/v2/v3 queue comparisons report `becameBulkEligible = []` and
`ceasedBulkEligible = []`. Because Refresh rebuilds the cache wholesale and **no SQL snapshot
of the 38 live `v1` row identities was taken before the refresh**, this runbook does **not**
claim a literal historical DB-table identity diff across the refresh. What is claimed, and
supported: deterministic row-level queue comparison shows zero bulk-eligibility changes, and
the live post-refresh population and count match that result.

**Newly bulk-eligible rows = 0.** §13 item 6's manual-inspection population is therefore
empty. The 38 rows were enumerated to prove source-class containment and live/model
reconciliation — **not** to assert that all 38 were individually hand-verified correct.

#### P4.7 Live current-code approval proof

Aaron Cadman, `award_winners#1563`. Pre-state: `player_id` NULL; `link_status_value` =
`implausible`; no resolution history; current `v3` suggestion = player `#3`, score 97, bulk
eligible.

A single-row UI approval succeeded. DB after approval: `player_id` = 3; `link_status_value` =
`resolved`; a `player_link_resolutions` row created with `action` = `linked`,
`previous_status` = `implausible`, `match_method` = `suggested`, `match_score` = 97,
`algorithm_version` = `v3`.

This proves the real `v3` current-code approval path, that the server-computed score and
version are what get persisted, and that the target state changes as expected. It does **not**
prove a live `bulk_suggested` browser mutation.

#### P4.8 Bulk-path contract proof (tests, not a live write)

The bulk UI is `ResolvePanel` → `BulkApproveControls` → `bulkApproveSuggestions`
(`src/app/admin/player-links/actions.ts:301`). The posted payload carries only target
identities/status and suggested player ids — no browser score, band, bulk flag or algorithm
version. `bulkApproveSuggestions` calls the **same** `resolveLinkFromSuggestion`
(`src/db/queries/player-links.ts:697`) per row. The bulk-specific differences are exactly
four: `method = 'bulk_suggested'`; a fresh `assessment.bulkEligible` requirement
(`player-links.ts:734`); a set-wise cache-version lookup for stale reporting; and per-row
failures being skipped while the batch continues.

`tests/player-link-mutations.test.ts` proves: stale rows re-score under current code; a
changed best is refused; a no-longer-bulk row is refused; the server-computed score and
version are written; browser score/band/bulk/version are never trusted; per-row stale
reporting; one failed row does not abandon the batch; and the bulk action uses
`method: 'bulk_suggested'`.

**Conclusion.** A further live bulk write would add only browser-wiring and live
`match_method` evidence. §13 does not require it, and it was **not** performed.

#### P4.9 Reversal finding

**There is no product-level unlink or reversal workflow.** The player-links UI exposes no
unlink control, and `player_link_resolutions` supports only `linked` / `confirmed_unlinked`.
The earlier §12 wording requiring "one *reversible* real approval" was therefore inaccurate
and has been removed.

The dev test cleanup was **operator maintenance, not product functionality**. A guarded
owner-role transaction restored Aaron Cadman: `player_id` → NULL, `link_status_value` →
`implausible`, and the exact ISSUE-164 test resolution row deleted. Verified afterwards:
`player_id` NULL, status `implausible`, `resolution_rows` = 0, and the current `v3` suggestion
still player `#3` at score 97.

#### P4.10 P4 conclusion

- No new class admitted.
- No new bulk-eligible rows (newly bulk-eligible = 0).
- No forbidden source class present in the live bulk population.
- Stale-cache integrity proved live (cache `v1` vs code `v3`).
- Current-code approval proved live under `v3`.
- The bulk server contract is proved by tests, not by a live bulk write.
- No product-level reversal exists.

### P5 — closeout — **COMPLETE 2026-09-12 (explainability + final validation)**

**P5.1 — §11 items 1–3 implemented (the one acceptance gap P5 planning found).**

§13 item 1 was UNMET for a structural reason: the typed limit reasons §11 specifies had never
been written, so the page could show WHAT a row scored but not why it was capped. A reviewer
reading "Low · 44" against a name they recognised could not tell an unlucky row from a
structurally impossible one.

Implemented, explainability only:

- `src/lib/player-matching/explain-limits.ts` (new, pure). `explainLimits(assessment, profile,
  { groupDisagrees })` returns typed reasons, the six evaluated bulk criteria and the reachable
  ceiling. It never rescores: every number it reports is read from the assessment the server
  already computed or from `MATCH_POLICY`, and it returns explanation only — it cannot move a
  score, a band or a bulk flag. `bulkReady` repeats `assessment.bulkEligible`, narrowed only by
  the page-level group rule.
- Reason vocabulary (§11 item 1, all present): `group_disagrees`, `hard_conflict`, `near_tie`,
  `source_class_not_bulk`, `name_not_exact`, `no_independent_corroboration`,
  `below_bulk_score_floor`, `below_bulk_gap_floor`, `profile_ceiling_below_very_high`. Each
  variant carries its own structured data (score/required, gap/required, families/required,
  ceiling/required, source type), so no human-readable string has to be parsed to recover a
  number. Wording lives in `describe.ts` beside the evidence and conflict tables.
- Priority, most decisive first: group disagreement, hard conflict, near tie, source-class
  exclusion, non-exact name, insufficient corroboration, bulk score floor, bulk gap floor,
  profile ceiling. The row shows `primary` only; the drawer lists them all.
- **Reachable ceiling.** `reachableCeiling(profile)` sums the best signal each family the source
  can actually supply could earn, one signal per family, S1–S4 as one club family, capped at 100
  exactly as the scorer caps. It reproduces the §3 arithmetic: complete draft profile 97
  (club_in_season unreachable without an active season), honour-team row with no resolvable club
  text 44, award row with a season and no `club_id` 61, Hall of Fame with a parsed span and a
  resolved club 76. Weights are read from `MATCH_POLICY` / `clubTextWeights()` at call time, not
  restated. Explanatory only: nothing in `assessMatch` or `scoreCandidate` consults it.
- **Source profiles are derived, not guessed.** `profileFromSourceEvidence` for the live path;
  `profileFromSourceDetail` for the queue page. `readSourceDetails` now emits `hasClubId` for
  `award_winners` and `player_achievements`, whose club NAME is `COALESCE(clubs.name,
  club_name_raw)` — without it a text-only row would have been credited a club ceiling it can
  never reach (the §3.2 case). Club text counts as resolved only where a ranked candidate
  actually scored `club_in_span` / `club_text_anywhere`; unresolved text is reported as
  contributing neither for nor against, and it adds no reason and no ceiling of its own.
- **Row (§11 item 2).** One muted line under the band badge, suppressed on rows that propose
  nothing and on bulk-ready rows.
- **Drawer (§11 item 3).** `ResolveControls.tsx` renders the criteria block for every suggested
  match, ✓/✗ per criterion, not only when `bulkEligible`. Six criteria: strong name, independent
  corroborating families, bulk score floor, bulk gap floor, no hard conflict, source class
  permitted. Plus "Highest score this record type can reach: N", flagged "— never Very High"
  where the ceiling is below 85, the unresolved-club-text note, and the full reason list. The
  invariant-13 stale warning is unchanged and still sits above the Approve button.
- Policy exclusion is kept distinct from evidence failure throughout: a captaincy scoring 97 on
  every family shows all six evidence criteria ticked and reads "captaincies is suggestion-only
  (policy)".

**P5.2 — S6 (`resolved_namesake_agreement`): NOT implemented in ISSUE-164. Decision recorded.**

§16 P5 required S6 to be decided on its own leave-one-out measurement. The measurement cannot
be made, and the reason is a population, not a preference:

- The qualifying population under the S6 definition (§5 row S6: another row with the same
  normalised name that a **human** resolved, with a `player_link_resolutions` audit present,
  whose own evidence carried a non-name family) is **zero**. The rebuilt
  `player_link_resolutions` is empty by design and the tracked human decisions number five
  (P1c); none of them forms a same-normalised-name pair with another human-resolved row.
- A leave-one-out treatment arm over a zero population measures nothing. Admitting a signal on
  an empty arm would be exactly the error §9.1 exists to prevent.
- **Decision: defer/reject for ISSUE-164.** Revisit only after ordinary admin use has created a
  meaningful, independently measured human-decision population.
- If it is ever revisited: `--holdout-self` is mandatory (§14 stop condition — any backtest run
  without it is invalid), and S6 **never** counts toward `minCorroboratingFamilies` (§6, §9.1).
- No new issue is created now for a zero-population hypothetical. The design rows (§5 S6, §6,
  §7 step 4) stay in this runbook as the record of what a future measurement would have to do.

**P5.3 — migration 099 deployment state (verified on `afldb_dev`, operator, 2026-09-12).**

99 migration files, 99 applied, `099_normalise_unicode_whitespace.sql` applied, 0 pending.
Deployment ordering is unchanged and remains **migration first → application build/restart**.

**P5.4 — final operator validation (2026-09-12). No code, no test, no scoring/policy/version
change; this record is closeout evidence only.**

- **DB-free:** `npx tsc --noEmit` clean; focused suites 187/187 passed.
- **DB-backed:** `tests/integration/player-matching.test.ts` — first attempt failed 23/23 only
  because the shell's `AFLDB_TEST_DATABASE_URL` pointed at `127.0.0.1:5432` while the active
  tunnel was on `55432`; classified as environment/setup failure, not a product or test
  regression. After pointing the test DSN at the active `55432` tunnel: **23/23 passed**,
  ~5.15s.
- **Shipped-default (`v3`, no calibration override) labelled backtest and queue re-run —
  discharges the P3B "still owed" obligation (`issues.md` P3B record) and confirms default `v3`
  reproduces the selected S3/S4 = 15/15 result exactly:**
  - labelled: population 6,324; top-1 6,303/6,324 = 99.67%; recall 6,310/6,324 = 99.78%;
    Very High 5,528, correct 5,527 = 99.98%; bulk 3,817/3,817 = 100%; ambiguous 19; hard
    conflicts 9 — identical to the P3B 15/15 measurement.
  - queue: population 5,390; Very High 2,680; High 426; Medium 331; Low 169; None 1,784;
    bulk 38; ambiguous 379; hard conflicts 23 — identical to the P3B 15/15 measurement.
  - explicit `--club-text-in-span 15 --club-text-anywhere 15` override vs shipped default:
    labelled 6,324/6,324 identical, queue 5,390/5,390 identical — confirms the shipped default
    and an explicit 15/15 override are the same policy, as designed.
- **Migration verification:** `npm run db:status` against `afldb_dev` — 99 migration files, 99
  applied, `099_normalise_unicode_whitespace.sql` applied, 0 pending (re-confirms P5.3).
- **Artefact disposition (decided).** `backtest-v1-baseline.json` and `queue-v1-baseline.json`
  are the immutable P0 evidence (§2.10) and are tracked; `draft-labels-b1-120.json` (the P1c
  Tier 1 label snapshot) is tracked at its existing root path — not moved, since this runbook
  references that filename extensively. `.gitignore` ignores `/backtest-*.json`,
  `/queue-*.json` and `/compare-*.json` with explicit exceptions for the two tracked baseline
  files; every other generated backtest/queue/compare report is local scratch and must not be
  committed. Two stray zero-byte files (`0)`, `item.signal`) were deleted as session debris, not
  runbook artefacts.

**§13 acceptance is now fully current: items 1, 2, 2a, 3, 3a, 4, 5, 6 and 7 are MET; item 2b is
DELIBERATELY UNMET / deferred under D-9 and Tier 2, which the runbook (§13 item 2b, §16) already
defines as non-blocking to closure. ISSUE-164 is RESOLVED on this evidence — see `issues.md`
Resolution (2026-09-12).**

---

## 13. Acceptance criteria

1. Every P0 example is explained on the page by a typed reason, and the reason matches the
   arithmetic in §3. **MET 2026-09-12 (§12 P5.1).** `explainLimits` ships the full §11 reason
   vocabulary; `reachableCeiling` reproduces the §3 ceilings (draft 97, honour team 44, award
   with a season and no `club_id` 61, Hall of Fame with span and resolved club 76) from
   `MATCH_POLICY` rather than from restated constants. The §3.1 draft shape reads
   `name_not_exact` with `below_bulk_score_floor` beneath it; the §3.2 namesake shape reads
   `near_tie` above `below_bulk_gap_floor`; an honour-team row reads
   `profile_ceiling_below_very_high` (44 against the 85 floor) alongside, and distinct from,
   `source_class_not_bulk`. Covered by `tests/player-matching-describe.test.ts` (helper and
   arithmetic) and `tests/player-link-mutations.test.ts` (page and drawer contracts).
2. Backtest under the **final shipped policy (`v3`)**, whole population, measured against the
   executable baseline
   `backtest-v1-baseline.json` (§2.10): top-1 ≥ 99.64% (6,301 / 6,324) and not reduced per
   class; Very High precision ≥ 99.98% overall and ≥ 99.9% per class; bulk FP = 0; false
   contradictions on correct links not above the count in the baseline file and none new by
   reason. (The ISSUE-075 figures 99.69% / 99.99% / ≤ 8 are historical and are no longer the
   gate.) **MET 2026-09-12 (§12 P5.4):** shipped-default (no override) `v3` re-run — top-1
   6,303/6,324 = 99.67% (≥ 99.64%, not reduced); Very High 5,527/5,528 = 99.98% overall; bulk
   3,817/3,817 = 100%, 0 FP; hard conflicts 9 (not above §2.10). Identical to the P3B 15/15
   measurement.
2a. Normalisation-only step (P1a/P1b): the P1b report exists in this runbook with every
   changed labelled top-1 enumerated; no class regresses against §2.10; no source row's raw
   text changed. **MET** (§12 P1b implementation/measurement record).
2b. Draft policy: no draft weight, signal, band or bulk rule changed unless the P1c labelled
   draft population meets the §9.1 standard (≥ 253 bulk-eligible confirmed rows, 0 FP).
   **DELIBERATELY UNMET — deferred under D-9.** P1c's Tier 1 run produced 114 labels with a
   bulk-eligible population of n = 0, so the §9.1 standard is not met and cannot be met from
   the evidence this tranche has. The criterion is therefore satisfied in its *binding*
   direction: nothing draft-related moved. `draft_person` stays suspended from unattended
   approval, draft sources keep raw `club_id` semantics, and no draft weight, signal or band
   changed. Re-admission requires a Tier 2 acquisition and a fresh §9.1 measurement, and
   nothing else may re-admit the class. This is not a failure of ISSUE-164; it is the stop
   condition working.
3. Per admitted class: §9.1 table met, with the rule-of-three bound recorded beside each
   class; no class admitted on a population below 253. **MET 2026-09-12 (§12 P4.3, §9.1):**
   `award_winners` and `award_nominations` re-verified under `v3` at their recorded bounds;
   `player_achievements` remains policy-admitted on the historical ISSUE-075 evidence only
   (253 bulk / 0 FP / ≈1.19%) — its executable `v3` labelled population is 0, so it is **not**
   re-verified under `v3` and must not be described as such; no class was admitted below 253;
   `hall_of_fame` (239) and `draft_person` (P1c Tier 1, bulk n = 0) both remain correctly
   excluded.
3a. Stale cache (invariant 13), stated generically: whenever a row's cached
   `algorithm_version` differs from the running `ALGORITHM_VERSION`, the banner and per-row
   badges render; approving a stale row returns the stale notice and records the score
   computed by the **running** algorithm; a stale row whose fresh best differs is refused;
   after Refresh the banner is gone. **MET 2026-09-12 (§12 P4.4–P4.5)** at a live version
   distance of cache `v1` vs code `v3`; the refusal and stale-notice branches are additionally
   covered by `tests/player-link-mutations.test.ts`.
4. Band-migration matrix: no correct link leaves Very High or bulk because of v2 without a
   recorded reason; movers *into* Very High/bulk have precision ≥ 99.9% as a group. **MET**
   (§12 P1b measurement record: 3,490 queue rows changed band and every one moved up, 0 moved
   down; the three labelled rows that changed band all moved up, one into Very High).
5. `tests/player-matching*.test.ts`, `tests/player-link-mutations.test.ts`,
   `tests/integration/player-matching.test.ts` green; `tsc --noEmit` clean. **MET 2026-09-12
   (§12 P5.4):** `tsc --noEmit` clean; 187/187 DB-free focused suites;
   `tests/integration/player-matching.test.ts` 23/23 (the first attempt's 23/23 failure was an
   `AFLDB_TEST_DATABASE_URL` port mismatch — 5432 vs the active 55432 tunnel — environment
   setup, not a product or test regression).
6. Live queue: refreshed under `v3`; newly bulk-eligible rows in an admitted class inspected
   100% by hand with 0 wrong. **MET 2026-09-12 (§12 P4.5–P4.6): newly bulk-eligible rows = 0,
   so the manual-inspection population is empty.** The 38 live bulk rows were enumerated to
   prove source-class containment and live/model reconciliation, which is not the same claim
   as hand-verifying all 38.
7. `ALGORITHM_VERSION = 'v3'`; stale banner shown before refresh, gone after. **MET
   2026-09-12 (§12 P4.4–P4.5).**

---

## 14. Risks and stop conditions

| Risk | Stop condition |
|---|---|
| Club-text resolution mis-maps a raw club (e.g. "Fitzroy" to the wrong lineage) | any new `club_not_in_history` on a correct link → stop, fix resolution, re-run |
| S2 lifts trigram-high draft rows into Very High and they are namesakes | Very High FP in `draft_person` > 0 → drop S2 for non-`strongName` rows or keep the 79 cap |
| S6 leaks ground truth in the backtest | any backtest run without `--holdout-self` for S6 is invalid |
| HoF admitted on a population below the §9.1 rule | not permitted; the rule is frozen and HoF stays suggestion-only on the current 240-link population |
| Version bump with no refresh | the §11 item 4 detection, warning and approval notice must exist and be tested (P2) before any `v2` bump is merged (P3) |
| Lineage change alters approval outcomes for rows a human is mid-review | acceptable: approval re-scores and refuses on `changed`; message already exists |
| Thresholds moved to chase counts | forbidden by §7 procedure; any threshold move needs a per-bucket precision table in the runbook |
| P1a lifts thousands of draft rows to 97 and `draft_person` was a bulk-admitted class, so the live queue would show a large **new bulk-ready draft set backed by only 5 labelled rows** | **Closed by D-9:** `draft_person` is removed from the bulk-allowed classes in the P1a change set, so no draft row is bulk-eligible until P1c re-gates the class under §9.1. A P1b queue report showing any bulk-eligible draft row is a stop condition |
| Normalisation fix over-reaches (canonicalises characters that carry identity, or rewrites stored raw text) | P1a is limited to proven whitespace code points, each with a test; any diff to a `*_raw` column → stop and revert |
| P1a changes cached results, so the page could show silently stale v1 scores until refresh | **Closed by D-8:** P1a bumps `ALGORITHM_VERSION` to `v2`, and P2's stale detection, banner, badges and approval-time notice ship first; a P1a deploy on a host without P2 is a stop condition |
| Historical-versus-executable confusion (9,356 / 99.69% quoted as the current gate) | §2.10 and §13 item 2 are the only baseline figures; any acceptance claim citing ISSUE-075 numbers as current is invalid |

---

## 15. Files / subsystems likely affected

- `src/lib/player-matching/confidence.ts` (policy, version), `score-candidate.ts` (S1–S4,
  optional S5/S6), `types.ts` (club lineage fields, new family, limit reasons),
  `describe.ts` (labels, limits), new `explain-limits.ts` (pure).
- `src/db/queries/player-match-candidates.ts` (club-text resolution, lineage columns, debut
  club; S6 lookup with self-exclusion).
- `src/app/admin/player-links/page.tsx`, `ResolveControls.tsx` (reasons, banner).
- `tools/matching/backtest.ts` (P1 instrumentation).
- Tests listed in §12.
- `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` (Unreleased, on delivery).
- **Migration status revised by P0**: the S1–S4 evidence work still needs no migration
  (evidence is jsonb in the cache; club resolution is read-time SQL over existing tables;
  persisted `club_id` columns remain a separate decision, D-4). **P1a probably does** need
  one, because `afldb_normalise_name` is a SQL function (migration 009) and any stored
  `search_name` / `search_alias` values derived from it may need recomputing; P1a assesses
  this and a migration is created only after operator approval, never during planning.
- `docs/` entry for the normalisation contract if one exists (P1a locates it by search).

---

## 16. Phased implementation plan

Revised 2026-09-12 on the P0 evidence (D-7 amended). Normalisation is corrected and measured
**before** any recalibration; weights are not tuned first.

| Phase | Content | Gate |
|---|---|---|
| P0 | Operator runs §12 P0 queries and baseline backtest; results recorded in §2.10 | **COMPLETE 2026-09-12**: all four draft rows are the trigram-high composition caused by U+00A0; historical rows are genuine namesake ties |
| P1 | Backtest instrumentation only; version unchanged; `--baseline` comparison | v1 numbers reproduced exactly from `backtest-v1-baseline.json` with the new tables |
| P1a | Unicode/name-normalisation correction (§12 P1a); narrow regression tests; raw source text untouched; **`ALGORITHM_VERSION` → `v2`** (D-8); **`draft_person` removed from the bulk-allowed classes** (D-9); no weight, band or threshold change | tests green; a NBSP name normalises byte-equal to its ASCII form; no `*_raw` column changed; migration (if any) approved by the operator; P2's stale banner/badges render against the still-v1 cache; no draft row is bulk-eligible |
| P1b | Refresh + re-run backtest and queue to new filenames; band migration, top-1 changes, ambiguity/gap, newly Very High, newly bulk-eligible, hand inspection of 79→97 and 64/66→82/84 rows; no class regresses | P1b report recorded in this runbook; §13 item 2a |
| P1c | Reconcile the draft labelled population (5 vs ISSUE-075's 2,319) and the missing `player_achievements` rows; design and run the reproducible larger draft evaluation set with holdout discipline; apply the §9.1 standard to drafts | **DESIGN AND RECONCILIATION COMPLETE 2026-09-12** (§12 P1c record): the five rows are the five explicit human decisions in the tracked DraftGuru ledger, the historical population was automatic `legacy_player_id` links that ISSUE-093 ruled inadmissible and never replayed, and 2,319 is **not reproducible**. Truth-source hierarchy ranked and enforced in code; every P1c label declared holdout; evaluation tooling (`--labels`, `npm run match:draft-labels`) built and tested. **The labelling run itself is outstanding**, so the population is still 5 and §13 item 2b is NOT met |
| P2 | Explainability (`explainLimits`, labels, drawer) **and the stale-cache integrity requirement** (§11 item 4: detection, banner + per-row badge, drawer warning, approval-time stale notice, bulk per-row notice); no scoring change | unit + describe + mutation-contract suites green; page shows reasons for the P0 rows; the invariant-13 contract tests pass with a simulated `v1` cache against `v2` code. **Ships before P1a** (D-7 as amended, D-8): the `v2` bump in P1a must land on a page that already detects and labels stale v1 rows |
| P3 | Evidence layer + S1–S4 (+S5 only for genuine variants left after P1b); `v2`; backtest grid (no trigram increase); band review per §8.5; draft changes only if P1c's gate is met | §13 items 2–4 |
| P4 | Bulk class review per §9; live refresh on dev; 100% inspection of any **new** bulk rows; live current-code approval proof; bulk-path contract proof by test | **COMPLETE 2026-09-12** (§12 P4): no new class admitted, newly bulk-eligible = 0, stale-cache integrity and a live `v3` approval proved, bulk path proved by `tests/player-link-mutations.test.ts`, and **no product-level reversal exists** (the earlier "reversible approval proof" wording was inaccurate and is withdrawn). §13 items 6–7 met |
| P5 | Ledger, index, CHANGELOG; decide S6 separately on its leave-one-out measurement | **COMPLETE 2026-09-12** (§12 P5.1–P5.4): explainability shipped, S6 decided (deferred, zero population), migration 099 verified, final DB-free/DB-backed validation green, shipped-default backtest/queue re-run discharges the P3B obligation |

**Final order (D-7 approved as amended, D-8 decided):** P0 complete → P1 → **P2** → P1a →
P1b → P1c → P3 → P4 → P5. As at 2026-09-12 **all phases through P5 are complete**; P1c's Tier 1
labelling run left the draft population at 5 / bulk-eligible n = 0, so §13 item 2b stays
deliberately unmet and the draft class stays suspended under D-9 — the runbook's own stop
condition working, not a blocker to closure. ISSUE-164 is RESOLVED (see `issues.md`
Resolution, 2026-09-12).
P2 precedes P1a because P1a carries the `v2` version bump and the
stale-cache integrity work must be live before any cached v1 row can be presented against v2
code. P3 cannot start until P1c closes.

Sessions: P0 was operator-only; P1 + P1a fit one implementation session; P1b is
operator-driven with one session for analysis; P1c is operator-led (labelling) with one
session for design and reconciliation; P2 fits one session; P3 needs at least one session plus
operator backtest turns; P4 is operator-driven with one session for analysis.

---

## 17. Runbook recommendation

**Yes, a dedicated `AFLDB-ISSUE-164.md` is required — this file is it.** The work spans
several sessions, every scoring decision is gated by operator-run backtests whose numbers must
be recorded beside the policy they measured, and the bulk-class decisions need explicit
sign-off. Decisions awaiting the operator before P3 starts:

- **D-1** Accept Option A (§7) and the weight-setting procedure as binding.
  **APPROVED 2026-09-12 as written.**
- **D-2** (original text, superseded: "S5: aliases-as-data first; a suffix rule only if P0
  shows systematic suffix misses." Approved 2026-09-12 as written, then amended on P0.)
  **Amended binding rule:**
  - Proven Unicode/source-text normalisation artefacts must be canonicalised before alias
    handling.
  - U+00A0 must normalise consistently with ordinary whitespace.
  - Consider other Unicode whitespace only where the implementation can do so safely and
    explicitly; do not introduce broad lossy name rewriting without tests.
  - Aliases remain identity data for genuine alternate names, spelling variants, nicknames,
    suffix cases, etc.
  - Do not encode source corruption such as NBSP as player aliases.
  - No global trigram weight increase.
  - Fuzzy-name matches remain non-bulk unless the existing bulk rules are independently
    satisfied after proper normalisation and calibration.
  **AMENDED AND APPROVED 2026-09-12 on the P0 evidence (§2.10, §3.1).**
- **D-3** S6 in scope for measurement only (not for bulk) — or defer entirely.
  **APPROVED 2026-09-12 as written.**
- **D-4** Club text resolution at read time (recommended) vs persisted `club_id` columns.
  **APPROVED 2026-09-12 as written (read time).**
- **D-5** `hall_of_fame` remains **non-bulk by default**. It may become bulk-eligible only if
  its final measured population meets the pre-declared §9.1 admission rule, which is frozen
  now, before any v2 scoring or backtest result is inspected, and is applied mechanically:
  a non-zero bulk population of at least 253 confirmed-link rows (rule of three at parity
  with `player_achievements`, the weakest class already admitted), every row scored under the
  final proposed evidence/scoring policy, 100% observed bulk precision, zero hard conflicts,
  exact-quality name evidence on every admitted row, at least two genuinely independent
  corroborating families, no fuzzy-name row, unresolved club text contributing neither
  positive nor negative evidence, the existing runner-up-gap rule satisfied, and the entire
  initial live Hall of Fame bulk-ready set manually reviewed before unattended approval is
  enabled. If the sample is too small for that standard, Hall of Fame stays suggestion-only
  regardless of apparent correctness, and admission is never a discretionary post-hoc choice.
  The earlier "n ≥ 200" figure is withdrawn as unfounded; on the current 240-link population
  the rule cannot be met, so Hall of Fame stays suggestion-only until the confirmed
  population grows and the rule is re-run in full.
  **AMENDED AND APPROVED 2026-09-12.**
- **D-6** Bands stay unless the P1 per-bucket table forces a change (§8.5).
  **APPROVED 2026-09-12 as written.**
- **D-7** (original: phase order P0 → P1 → P2 → P3 → P4 → P5, P2 shippable before P3, P2
  carrying the stale-cache integrity gate. Approved 2026-09-12 as written.)
  **Amended on P0:** phase order is P0 → P1 → P1a → P1b → P1c → P2 → P3 → P4 → P5 (§16), with
  the normalisation-first sequence P1a/P1b/P1c inserted before any recalibration and P3 not
  starting until P1c closes. The stale-cache gate is unchanged and not weakened: cached
  `algorithm_version` mismatch is never silent; visible stale scores get banner/badge/warning;
  the server reads the version from the DB and never trusts a browser value; approval remains
  lock + current-code re-score; a changed best or no-longer-supported result is refused; bulk
  follows the same rule row by row; a stale display is never itself authoritative for
  approval. **P2 must ship before any scoring-version bump is exposed.**
  **APPROVED AS AMENDED 2026-09-12 (operator).** Final order: P0 complete → P1
  instrumentation → **P2 stale-cache/version integrity** → P1a normalisation correction →
  P1b measurement → P1c draft calibration population → P3 evidence/scoring work → P4 → P5.
  P3 cannot start until P1c closes.
- **D-8** Version handling for the P1a normalisation fix. **DECIDED 2026-09-12 (operator):
  VERSION BUMP REQUIRED.** The U+00A0 canonicalisation changes matching semantics and can
  change candidate scores, confidence bands and bulk eligibility; it must not silently remain
  `v1`. P1a ships under the next `ALGORITHM_VERSION` (`v2`), so old cached v1 results are
  visibly stale and cannot be acted on silently. Consequently P2 (stale detection, banner,
  per-row badge, drawer warning, approval-time stale notice, bulk per-row notice, contract
  tests) ships **before** P1a. The planning recommendation to keep `v1` is withdrawn. Any
  later scoring change in P3 takes the version after that (`v3`), so "v2" now means "the
  normalisation-corrected matcher", not "the S1–S4 policy".
- **D-9** Interim status of `draft_person` unattended (bulk) approval. **DECIDED 2026-09-12
  (operator): SUSPEND `draft_person` UNATTENDED BULK APPROVAL UNTIL P1c RE-GATES IT.** The
  current executable calibration population has 5 confirmed draft rows, P1a can move a large
  population from 79 → 97, and `draft_person` is currently an admitted bulk source; that
  combination is too weakly calibrated for unattended approval. Suggestions and manual
  (row-by-row) approval stay available; the class-level bulk flag (`confidence.ts:135`,
  `sourceClassBulkAllowed` or its equivalent) is set to false in the P1a change set, so the
  suspension is live before the first post-normalisation refresh and carries the same version
  bump. Re-admission happens only through the §9.1 rule applied to the P1c population (≥ 253
  bulk-eligible confirmed rows, 0 FP, every other row of the table) and the 100% initial
  hand review. This is the one deliberate source-policy change permitted before P3.

Planning session note: one read-only shell command (`Get-Content` line count/tail of
`issues.md`) was run in breach of CLAUDE.md §9 while locating the ledger insert point; it
changed nothing and is recorded here for honesty. The P0 revision session ran no commands.
