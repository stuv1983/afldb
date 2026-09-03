# AFLDB-ISSUE-129 — AFL Tables' Wildcard Final has no canonical representation in AFLDB

> Routed out of `AFLDB-ISSUE-128` on 2026-09-03 by explicit operator decision.
> **Nothing is implemented.** This file carries the evidence and the decision that has to
> be made before anything is.
>
> Operator instruction, verbatim: *"Do not silently classify Wildcard Final as a normal
> final or non-final in this issue. That needs an explicit AFLDB-wide semantic decision and
> regression coverage. Do not implement migration 084 here."*

---

## 1. The defect

AFL Tables publishes a **Wildcard Final** round in the 2026 season. AFLDB cannot store it,
so every Wildcard Final match and every player-match row in one is silently absent from
canonical data. `AFLDB-ISSUE-128` made the loss **audible** — the settle run now reports
`SOURCE COMPLETENESS: INCOMPLETE` and its unit exits non-zero — but the rows still do not
land. This issue is what makes them land.

---

## 2. Evidence [MEASURED 2026-09-03, live source]

### 2.1 The two matches

From `https://afltables.com/afl/stats/biglists/bg3.txt`, read live:

```text
17046. 28-Aug-2026  WF  Western Bulldogs  14.12.96  Collingwood  14.9.93   M.C.G.
17047. 29-Aug-2026  WF  Melbourne          7.13.55  Carlton      10.14.74  M.C.G.
```

fitzRoy 1.8.0 returns both, plus **92** `player_stats` rows for them.

### 2.2 The two source vocabularies

| Artefact | Column | Value | Note |
|---|---|---|---|
| `results.csv` | `Round` | `WF` | |
| `results.csv` | `Round.Type` | `Regular` | **wrong, and fitzRoy's**: `fetch_results_afltables()` computes it as `ifelse(Round %in% c("QF","EF","SF","PF","GF"), "Finals", "Regular")`, and `WF` is in neither list |
| `results.csv` | `Round.Number` | *(empty)* | `round_levels` has no `WF` level, so the factor is `NA` and `dense_rank()` yields `NA` |
| `player_stats_2026.csv` | `Round` | `Wildcard Final` | a third spelling, at the player grain |

**Do not trust fitzRoy's `Round.Type` for this round.** AFLDB must decide the type from the
round code, which it already does — `normalise_results_round()` derives `round_type` from
`FINALS_CODES`, never from the `Round.Type` column.

### 2.3 Where the rows are lost

`tools/migration/import_fitzroy_core.py:136`:

```python
FINALS_CODES = {"EF": "elimination_final", "QF": "qualifying_final",
                "SF": "semi_final", "PF": "preliminary_final", "GF": "grand_final"}
```

`normalise_results_round('WF')` and `normalise_stats_round('Wildcard Final')` both raise
`MatchIdentityError`; `results_identity()` / `player_match_identity()` return `None`; the
rows become **unkeyed rejections** with no representable presence, and both enumerations go
`complete: false`.

Measured end to end: 209 matches / 9,614 player rows acquired → **207 / 9,522** emitted,
**94** unkeyed rejections, exit 0. Identical to what production recorded on snapshot
`settle-2026-09-02-1958`.

### 2.4 The schema limitation

`src/db/migrations/003_matches.sql:8`:

```sql
CREATE TYPE round_type AS ENUM (
  'home_and_away', 'elimination_final', 'qualifying_final',
  'preliminary_final', 'semi_final', 'grand_final');
```

and `:67-69`:

```sql
CONSTRAINT matches_round_number_ck CHECK (
  (round_type = 'home_and_away' AND round_number IS NOT NULL) OR
  (round_type <> 'home_and_away' AND round_number IS NULL)),
CONSTRAINT matches_is_final_ck CHECK (is_final = (round_type <> 'home_and_away')),
```

Two consequences that decide the shape of any fix:

1. A Wildcard Final **cannot** be `home_and_away`: it has no round number, and the CHECK
   forbids that combination. So a **new enum value is unavoidable** — this is not a data
   question that can be dodged.
2. `is_final` is **derived from `round_type` by CHECK**. Adding any non-`home_and_away`
   value makes every wildcard final `is_final = true` **by construction**, across the whole
   application, unless each consumer excludes it explicitly.

`src/db/migrations/076_afltables_settle_projections.sql:74,134` reuses the same enum and
repeats the `is_final` CHECK, so the settle projection inherits the decision automatically.

---

## 3. The decision to make — and it is a product decision

**Does a Wildcard Final count as a finals appearance in AFLDB?**

It changes user-visible answers: "finals played", "finals wins", finals-only search filters,
NL answers about finals, Grid Solver finals criteria, and every career aggregate that splits
home-and-away from finals. Whatever is chosen becomes AFLDB's retroactive definition from
2026 onward and must be documented, not implied.

| Option | Cost |
|---|---|
| **A — `wildcard_final`, counts as a final** | One migration; every consumer inherits `is_final = true` from the CHECK with no further edits. Semantically arguable: a wildcard final is a pre-finals qualifying playoff, and seeds 7–10 losing one have arguably not "played finals". |
| **B — `wildcard_final`, NOT counted as a final** | Same migration, but `is_final` is schema-derived, so **every** user-visible consumer needs an explicit exclusion. Larger, and easy to miss one. |
| **C — model it as home-and-away** | **Impossible** without also changing `matches_round_number_ck`. Not recommended. |

No option is authorised. §4 lists what has to be inspected either way.

---

## 4. Known `is_final` consumers [CONFIRMED]

34 files reference `is_final` / `isFinal`. Excluding AFLW (a separate `text`-typed schema)
and migrations, the production consumers to review are:

**Queries** — `src/db/queries/`: `matches.ts`, `match-search.ts`, `match-sheet.ts`,
`match-admin.ts`, `grid-solver.ts`, `player-derived.ts`, `db-health.ts`,
`nl/head-to-head.ts`, `nl/player-career.ts`, `nl/player-game.ts`, `nl/team-match.ts`,
`nl/team-streak.ts`.

**Search / library** — `src/search/query-builder-spec.ts`,
`src/lib/acquisition/settle-afltables.ts`, `src/lib/ingest/datasets.ts`.

**Tools** — `tools/migration/`: `import_fitzroy_core.py`, `import_legacy_afl.py`,
`import_awards.py`, `rebuild_derived.py`.

**Also needing a decision, not only a review:**

- `src/lib/format.ts:76-89` — `ROUND_LABELS` / `ROUND_SHORT` have no wildcard entry.
  `formatRound()` degrades to its `fallback` (the source `round_code`), so this is a
  cosmetic gap, not a crash — but the label should be deliberate.
- `src/search/nl/vocab.ts` — whether users can say "wildcard final" at all.
- `tools/migration/import_fitzroy_core.py:1561,1779,1825` — `round_code not in FINALS_CODES`
  gates **Brownlow round-vote** derivation. Adding `WF` to `FINALS_CODES` would change that
  gate's meaning; confirm the intended behaviour rather than inheriting it.
- `src/db/queries/seasons.ts` / `matches.ts:278` — `round_type = 'grand_final'` premiership
  logic is unaffected, but should be re-read once.

**AFLW is out of scope**: `025_staging_aflw.sql` stores `round_type` as `text` with its own
CHECK and does not share the enum.

---

## 5. Implementation sketch — NOT authorised

1. Decide §3, and record the decision and its reasoning in this file before writing code.
2. Claim a migration number by **re-scanning every live branch tip** (`IssuesIndex.md`
   requires this; `084` is next free as seen from `codex/issue-127` but is **not**
   reserved). `ALTER TYPE round_type ADD VALUE …` cannot run inside a transaction block on
   older PostgreSQL — check the runner's transaction handling in `tools/db/migrate.ts`
   before writing it.
3. Add `WF` → the new type in `FINALS_CODES`, and `Wildcard Final` to
   `normalise_stats_round()`. Both vocabularies, or the match and player grains disagree
   and every player row is rejected on a round mismatch
   (`import_fitzroy_core.py:1436-1439`).
4. Add the display label and short code in `src/lib/format.ts`.
5. Work §4 consumer by consumer under the §3 decision.
6. Regression coverage: extend the `AFLDB-ISSUE-128` fixture suite in
   `tests/fitzroy-core-import.test.ts`, which already builds a snapshot carrying the exact
   real `WF` / `Wildcard Final` vocabulary and currently asserts it is **refused and
   reported**. Those assertions must be inverted deliberately, not deleted.
7. Prove the two real matches reach canonical `matches` and `player_match_stats` against
   `afldb_test`, and that a rerun writes nothing.
8. `AFLDB-ISSUE-128`'s completeness verdict then goes `complete` on its own — it is a
   measurement, not a suppression, so no ISSUE-128 code should need changing. If it still
   reports incomplete, something else is being dropped and that is a finding.

---

## 6. Interaction with AFLDB-ISSUE-128

Until this issue is resolved, the nightly settle unit will exit **non-zero** on every run
whose acquired window contains the Wildcard Round, while still committing every match it
*can* represent. That is intended: the run really is not a complete import. Removing
`--require-complete-source` to silence it would restore the exact silent-success defect
ISSUE-128 was opened for and must not be done.

---

## 7. Exact next action

**Decide §3.** Nothing else can start. No migration number is claimed and no code exists.
