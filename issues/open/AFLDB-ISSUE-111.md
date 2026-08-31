# AFLDB-ISSUE-111 — Coleman Medal derivation from canonical AFLDB facts

**Status: Open. Implementation in progress — see §12.**
**Parent:** `AFLDB-ISSUE-102` (`issues/open/AFLDB-ISSUE-102.md`).
**Severity:** Medium — **Area:** Data acquisition / Import architecture / Derived data.
**Created:** 2026-08-30 (ISSUE-102 pass 2, operator-authorised).

Replace the legacy-SQLite-sourced Coleman Medal winner rows with a derivation from AFLDB's own
canonical match and player-statistic facts, persisted to `award_winners`, integrated into the
canonical rebuild, and preserving every existing link and reload guarantee.

**`AFLDB-ISSUE-110` is a different, unmerged issue. Do not use that id.**

---

## 1. Why this family is derivable and the others are not

`data/reference/stat-availability.json` declares `goals` as a single unbroken range:

```
goals   complete   1897   2026
```

No `partial`, no `not_collected`, no `not_applicable`. Goal-scoring is the one award-relevant
statistic AFLDB holds for the whole history. Every other honours family
(`AFLDB-ISSUE-112`) depends on a vote, a selection or an induction that no match fact implies.

---

## 2. Source — exact tables and join

**Authoritative base: `player_match_stats` joined to `matches`.**

```sql
SELECT m.season, pms.player_id, sum(pms.goals) AS goals
  FROM player_match_stats pms
  JOIN matches m ON m.id = pms.match_id
 WHERE NOT m.is_final
 GROUP BY m.season, pms.player_id
```

### 2.1 Do NOT derive from `player_season_stats`

`player_season_stats.goals` is `sum(c.goals)` over **every** game of the season, finals included
(`tools/migration/rebuild_derived.py`, `REBUILDS["player_season_stats"]`, `agg` CTE — verified).
It is also a *derived* table, so using it would make the award a derivation of a derivation.

`src/db/queries/seasons.ts:148-166` `getSeasonGoalkickers()` reads exactly that column and is
documented as *"The season's leading goalkickers are ranked on each player's whole season"*.

**That is the decisive semantic evidence** for operator decision 5: AFLDB already has a
"leading goalkicker" concept, it already includes finals, and it is **not** the Coleman Medal.
The derivation must not merge them, and it must not change `getSeasonGoalkickers`.

### 2.2 The home-and-away filter is exact, not approximate

`src/db/migrations/003_matches.sql:69`:

```sql
CONSTRAINT matches_is_final_ck CHECK (is_final = (round_type <> 'home_and_away'))
```

So `NOT m.is_final` is precisely "home-and-away round", enforced by the database. This matches
the award description AFLDB already ships, `tools/migration/import_awards.py:315`:

> `"coleman": "Awarded to the leading goalkicker of the home-and-away season."`

### 2.3 NULL is not zero — a pre-flight invariant, not an assumption

`player_match_stats.goals` is `smallint`, **nullable** (`src/db/migrations/004_player_match_stats.sql:33`).
`SUM()` skips NULLs, so a season containing NULL goals rows would silently understate a total.
`stat-availability.json` claims `complete` coverage, which should mean zero NULLs — a claim to
**verify**, not trust.

**G1 — MEASURED AND PASSED (operator, read-only, 2026-08-30).** Over
`matches` ⋈ `player_match_stats` filtered to `m.season BETWEEN 1980 AND 2025` and
`m.round_type = 'home_and_away'`:

| Measure | Value |
|---|---|
| `player_match_stats` rows | **341,981** |
| matches | **7,941** |
| season range | 1980 – 2025 |
| `goals IS NULL` | **0** |
| seasons containing any NULL-goals row | **0** |

Canonical home-and-away goal statistics are therefore complete across the entire derivation span.
The NULL-vs-zero hazard does not arise for Coleman. **G1 = PASS.** Do not re-measure without a
contradicting source finding.

---

## 3. Season / competition scope

| Question | Rule |
|---|---|
| Competition | AFL/VFL only — the `matches` table's own population. No state-league match reaches it. |
| Grain | player × season, over home-and-away matches only |
| Finals | **excluded** (§2.2) |
| Which seasons materialise | only **completed** seasons. A season with `seasons.status = 'in_progress'` must not receive a winner row — the award is not decided. Mirror `rebuild_derived.py`'s Brownlow `pending` treatment rather than inventing a new rule. |
| Player identity | `player_match_stats.player_id` — already a resolved AFLDB player, so **every derived row is born linked**. This is a real difference from the legacy path (§7). |
| Club | **DECIDED — see §3.2.** Collect `DISTINCT pms.club_id` over the winner's qualifying home-and-away matches that season: exactly one → persist it; more than one → persist **NULL**. |

### 3.1 First award season — MEASURED AND DECIDED (G0 = PASS)

**Measured read-only by the operator, 2026-08-30**, against `afldb_dev` (role `afldb_app`, over a
localhost tunnel, in an explicit `READ ONLY` transaction), using the SQL this section previously
specified as gate G0:

| Measure | Value |
|---|---|
| `awards.slug` | `coleman` |
| `awards.first_season` | **1980** |
| `awards.last_season` | **2025** |
| winner rows | **46** |
| `min(winner.season)` | **1980** |
| `max(winner.season)` | **2025** |
| rows with `player_id IS NULL` | 1 (the 1982 row — see §3.4) |

Exactly one legacy winner row exists for **every** season from 1980 to 2025 inclusive. **No gaps.**
46 seasons, 46 rows.

**AUTHORITATIVE DECISION (operator, 2026-08-30): the derived Coleman span begins in 1980.**

- **Do NOT backfill 1955–1979** under ISSUE-111. AFLDB has never asserted those winners, and
  acquiring them is not authorised by this issue.
- **Do NOT extend to 1897** merely because `goals` coverage reaches it. Leading-goalkicker history
  before AFLDB's measured award contract is a different concept (§2.1), already served by
  `getSeasonGoalkickers()`.
- The measurement satisfied the pre-committed decision rule: the measured minimum (1980) is later
  than 1955, so the **measured contract is preserved as-is**. It is not earlier than 1955, so no
  pre-medal semantic defect exists to adjudicate.

The tracked declaration (§3.5) must record `first_season = 1980` **and** state that the boundary
preserves AFLDB's measured legacy award contract — not an external claim about when the medal was
first awarded.

**G0 = PASS.** Do not re-run this measurement to reconfirm it.

### 3.2 Club rule — DECIDED (G4)

**Measured read-only by the operator, 2026-08-30**, over all 45 currently linked legacy Coleman
winners:

| Measure | Value |
|---|---|
| winners represented by exactly one H&A club that season | **45 / 45** |
| legacy `club_id` present among that season's H&A clubs | **45 / 45** |
| legacy `club_id` equal to the player's H&A club | **45 / 45** |
| multi-club winners | **0** |
| NULL `club_id` among linked winners | **0** |
| club mismatches | **0** |

So the 1980–2025 Coleman dataset contains **no** mid-season-transfer winner, and therefore
**cannot** establish a historical primary-club tie-break rule. There is no evidence to fit.

**AUTHORITATIVE RULE (operator, 2026-08-30).** For each derived winner, collect
`DISTINCT pms.club_id` over the qualifying home-and-away matches of that season:

- exactly one distinct club → `award_winners.club_id` = that club;
- more than one distinct club → `award_winners.club_id` = **NULL**.

**Do not invent** a "most games", "most goals", "final club", "first club", "current club" or
ordinal rule. A multi-club season is genuinely ambiguous at the award grain and NULL is the honest
representation; `award_winners.club_id` is nullable (migration 005 verified), so NULL is
schema-legal.

Source-compatibility check performed this pass: `award_winners.club_id` has no NOT NULL
constraint and no consumer requires it — `src/db/queries/awards.ts` selects it with a LEFT JOIN
and renders `clubName` as nullable. No invariant blocks NULL.

**Implementation requirement:** a synthetic multi-club winner fixture proving the NULL behaviour,
since history supplies no real case. **G4 = DECIDED.**

### 3.3 Independent derivation vs the legacy set — G3 = PASS with explained identity reconciliation

**Measured read-only by the operator, 2026-08-30.** An independent derivation — `matches` +
`player_match_stats` only, home-and-away only, `SUM(goals)` grouped by `(season, player_id)`,
per-season `MAX`, all players tied at the maximum retained — was compared against the 46 legacy
`draftguru` Coleman observations:

| Outcome | Count |
|---|---|
| MATCH | **45** |
| DERIVED_ONLY | **1** |
| LEGACY_UNLINKED | **1** |
| LEGACY_ONLY | **0** |

The two exceptional rows are **both the same 1982 winner** (§3.4). `LEGACY_ONLY = 0` is the
important number: the derivation never fails to produce a season the legacy source asserts.

**There is no football-semantic winner-set disagreement.** The legacy observation and the canonical
derivation identify the same person in every one of the 46 seasons. The apparent mismatch exists
solely because the legacy observation was left unresolved while `player_match_stats` already
carries canonical player identity.

**G3 = PASS WITH EXPLAINED IDENTITY RECONCILIATION.** Do not record 1982 as a Coleman data
disagreement, and do not raise a `data_issues` row for it.

### 3.4 The 1982 row — Malcolm Blight

| Side | Facts |
|---|---|
| Legacy observation | `award_winners.id = 9441`; `season = 1982`; `player_name_raw = 'Malcolm Blight'`; **`player_id = NULL`**; `link_status_value = 'implausible'`; `club_id = 115` (North Melbourne); `source = draftguru`; `source_record_id = 'coleman:1982:537'` |
| Canonical derivation | `player_id = 1534` (Malcolm Blight); **94** home-and-away goals in 1982; North Melbourne is the sole qualifying H&A club |
| Human decisions | **none** — see §3.5 |

The derived row is therefore **born linked** to player 1534. Linking it overrides no human
judgement: the `implausible` status is an *import-derived* classification from the legacy name
matcher, not an admin decision. Transition treatment: §7.1.

### 3.5 Human link decisions on Coleman — G6 human-decision evidence = PASS

**Measured read-only by the operator, 2026-08-30**, using role `afldb_import` against `afldb_dev`
inside an explicit `BEGIN TRANSACTION READ ONLY`.

**Correction of an earlier false reading, recorded so it is not repeated:** an initial
`information_schema` query as `afldb_app` appeared to show no `player_link_resolutions` table.
That was **privilege visibility, not absence**. Direct source proves the table: migration 056
creates it, migration 067 extends it, migration 068 grants SELECT to `afldb_import`. It was then
confirmed live under `afldb_import`, with columns `id, target_table, target_id, action, player_id,
previous_status, admin_user_id, note, created_at, match_method, match_score, algorithm_version`.
**`player_link_resolutions` is present and readable. Do not conclude otherwise.**

Results, joining every Coleman `award_winners` row to `player_link_resolutions`:

| Measure | Value |
|---|---|
| `linked` decisions | **0** |
| `confirmed_unlinked` decisions | **0** |
| total Coleman resolution rows | **0** |
| resolution rows for `target_table = 'award_winners'`, `target_id = 9441` | **0** |

Consequences: no Coleman linked decision needs migrating; no `confirmed_unlinked` decision needs
migrating; the 1982 observation carries no human decision, so linking the derived row overrides
nothing; and no Coleman-specific `player_link_resolutions` state can be orphaned by the source
transition.

**G6 human-decision evidence = PASS.** This does **not** by itself authorise a delete-and-recreate
strategy — "no human decisions exist" and "any transition is safe" are different claims. The
transition mechanism is designed in §7.1 and is the remaining half of G6.

### 3.6 The tracked span declaration — where it belongs

The declaration records **metadata about a derivation contract** (first season 1980, the
derivation rule, its version), not honours facts. Location was chosen against current conventions
rather than by default:

| Candidate | Verdict |
|---|---|
| `data/reference/*.json` | **Acceptable for this file, unlike for ISSUE-112's manifests.** ISSUE-112 rejects `data/reference/` because `tools/migration/load_reference_data.py` TRUNCATEs its targets and has no link-decision handling — fatal for honours *rows*. A span declaration is never loaded into a link-target table, so that objection does not apply. It is the established home for tracked contracts read by tooling (`fitzroy-accepted-baselines.json`, `stat-availability.json`, `source-families.json`, `draftguru-link-decisions.json`). |
| `data/awards/` | Rejected — that directory holds honours **manifests** (`22-under-22.csv`) under a `.gitignore` whitelist, and is ISSUE-112's territory. A contract declaration is not a manifest. |
| a constant in `import_awards.py` | Rejected — the boundary is a measured contract that a reader must be able to audit without reading Python. |

**Recommended: a new tracked JSON contract under `data/reference/`** (suggested
`coleman-derivation.json`), carrying at minimum `first_season: 1980`, `derivation_method`,
`method_version`, the tie rule, the club rule and a note recording that the boundary preserves
AFLDB's measured legacy contract. It must be **read by the loader and by the tests**, so a silent
divergence is impossible. It must **not** be added to `load_reference_data.py`'s `GROUPS` — it is
read directly by the Coleman loader, not loaded into a table.

**No file is created in this pass.** This is design; the file is implementation work.

---

## 4. Ties

**Operator decision 4: every player tied on the qualifying total receives a winner row.** No
arbitrary tie-breaker, no "fewest games" discriminator, no silent single-row pick.

Implications the implementation must handle:

- A season may produce more than one `award_winners` row for `coleman`. Nothing in the schema
  forbids it — `award_winners` has no season-unique constraint (migration 005 verified).
- The stable identity must stay deterministic across reloads for tied rows (§5).
- The derivation must **not** consult `player_season_stats` to break a tie.
- Reporting must surface tie seasons explicitly so a curator can see them.

Ties are also the one place a derived row can legitimately **disagree** with the legacy row set,
because the real award has historically used its own tie handling. That disagreement must be
reported, never silently reconciled — see G3.

---

## 5. Stable identity — G5 RESOLVED

`award_winners` reloads by `(source_id, source_record_id)`, so the derivation needs a deterministic
`source_record_id`. The runbook's first proposal, `coleman:<season>:<player_id>`, was
**investigated and rejected** this pass.

### 5.1 `players.id` is NOT rebuild-stable — proven

`AFLDB-ISSUE-108` §9.4 established, and this pass re-verified in source, that a canonical rebuild
**re-seeds `players.id`**: `tools/migration/import_fitzroy_core.py` inserts players with no
`legacy_player_id` and resolves identity by AFL Tables profile URL. Every legacy id pinned in the
test suite came to address a different person after the 2026-08-27 rebuild. A surrogate id is
therefore stable only *within* one database lineage, and ISSUE-111 explicitly requires canonical
rebuild support. **`coleman:<season>:<player_id>` is rejected.**

### 5.2 The durable identity the rebuild actually uses

`data/reference/fitzroy-accepted-baselines.json`, `identity_scan.$comment`, verbatim:

> *"Canonical identity is the AFL Tables profile URL. The fitzRoy numeric ID is optional: 83
> recent-2025 rows carry none, and `distinct_urls - distinct_ids = 5` is exactly the five players
> who have no ID anywhere in the snapshot."*

Measured in the same accepted baseline:

| Measure | Value |
|---|---|
| `identity_scan.rows` | 685,473 |
| `identity_scan.missing_url` | **0** |
| `identity_scan.malformed_url` | **0** |
| `identity_scan.distinct_urls` | **13,275** |
| `measured.players` | **13,275** |
| `identity_scan.missing_id` | 83 — *the numeric id is NOT usable* |

`distinct_urls == players` and `missing_url == 0`: **exactly one profile URL per player, none
missing.** The fitzRoy numeric ID is explicitly optional and must not be used.

### 5.3 Where it is persisted, and in what form

`external_identities` (`src/db/migrations/002_core_entities.sql:178-194`):

| Column | Value for this identity |
|---|---|
| `source_id` | the `afltables` source |
| `match_method` | `'afltables_profile_url'` |
| `external_id` | the **normalised profile path**, e.g. `players/B/Malcolm_Blight.html` |
| `status` | `'unique'` |
| `player_id` | the canonical player |
| constraint | `external_identities_uq UNIQUE (source_id, external_id)` |

Normalisation is `normalise_profile_url()` (`import_fitzroy_core.py:242-252`): strip `../`, strip
the `https?://afltables.com/afl/stats/` prefix, strip a leading `/`. Its docstring states it
*"mirrors `enrich_birth_dates.py` so both writers of `match_method='afltables_profile_url'` agree
on the external_id form"* — so there is one canonical form, not two.

Release gates already protect the property this design depends on
(`tests/integration/release-gates.test.ts:748-780`): *"matches players on the profile URL rather
than the name"* pins 13,275 rows at `match_method = 'afltables_profile_url'` and
`status = 'unique'`; *"stores the profile URL it matched on, not a legacy row id"* asserts
**zero** `external_id` values matching `^[0-9]+$`.

### 5.4 Decision

**`source_record_id` = `coleman:<season>:<normalised-profile-path>`**

Example for the 1982 winner: `coleman:1982:players/B/Malcolm_Blight.html`.

| Property | Why it holds |
|---|---|
| Unique | `external_identities_uq` makes the path unique per source; a player cannot win the same season twice, so `(season, path)` is unique. Tied winners are different people → different paths → distinct keys. |
| Deterministic | read from a table, not computed from a ranking or an ordinal |
| Survives repeated reloads | the key is identity, not position; `reload_keyed` matches and UPDATEs in place |
| Survives ties | a tied set changing size does not move any surviving row's key — the defect that killed the ordinal option |
| Survives canonical rebuild / id reseed | the profile URL is exactly what the rebuild itself resolves identity by (§5.2) |
| Survives display-name corrections | `players.display_name` is not in the key. The path comes from AFL Tables, and the accepted baseline is hash-frozen, so it cannot drift under an accepted contract. |
| Needs no network | read from `external_identities` in the same database |
| `reload_keyed`-compatible | `award_winners.source_record_id` is `text`, unbounded (migration 005); the key is compared as text by `_key_match` |

**Rejected alternatives:** `coleman:<season>:<ordinal>` — positional, and a changed tied set shifts
ordinals and would trip the name guard. `coleman:<season>:<player_id>` — not rebuild-stable (§5.1).
`coleman:<season>:<fitzRoy numeric ID>` — 83 players carry none (§5.2).

**Hashing rejected.** ISSUE-108 used a digest for a *test baseline* identity set, not for row keys.
Every row key in this repository is readable — `22under22:2012:b:1`, `fkg-017`,
`season=YYYY;round=NN`. A hash would cost auditability and buy nothing: the path is short and
`text` is unbounded. Do not hash for aesthetics.

**Escaping / normalisation, required.** Compose the key from the **already-normalised** path only —
never a raw URL. Following the `AFLDB-ISSUE-100` delimiter-refusing precedent, the loader must
**refuse** (not sanitise) if a normalised path contains the `:` separator. AFL Tables paths do not,
so this is a fail-closed guard, not a transformation.

### 5.5 Residual risk — G5a, a required pre-flight

The derivation reads `external_identities` from **whatever database it runs against**. In a
canonically rebuilt database coverage is total (§5.2). In `afldb_dev`, which is legacy-loaded, the
profile-URL population was written by `enrich_birth_dates.py` and `AFLDB-ISSUE-090` measured
**12,472** there against the canonical **13,275** — so coverage is *not* guaranteed outside a
canonical rebuild.

**The loader must fail closed** when a derived winner has no `afltables_profile_url` identity with
`status IN ('unique','resolved')`. It must **never** fall back to `players.id`, to the fitzRoy
numeric id, or to a name. New pre-flight gate **G5a** (read-only, cheap):

```sql
-- Every Coleman winner candidate must have exactly one durable profile identity.
WITH ha AS (
  SELECT m.season, pms.player_id, sum(pms.goals) AS goals
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
   WHERE NOT m.is_final AND m.season BETWEEN 1980 AND 2025
   GROUP BY m.season, pms.player_id
), top AS (
  SELECT season, player_id
    FROM (SELECT season, player_id, goals,
                 max(goals) OVER (PARTITION BY season) AS best
            FROM ha) r
   WHERE goals = best
)
SELECT count(*)                                              AS winners,
       count(*) FILTER (WHERE ei.external_id IS NULL)        AS missing_identity
  FROM top t
  LEFT JOIN external_identities ei
         ON ei.player_id = t.player_id
        AND ei.match_method = 'afltables_profile_url'
        AND ei.status IN ('unique','resolved')
  GROUP BY ();
```

`missing_identity` must be **0**. If it is not, ISSUE-111 is blocked on identity coverage in that
database — not on this design.

---

## 6. Provenance — CORRECTED to the repository's proven convention

An earlier draft of this runbook proposed a new `afldb_derived_coleman` source row. **That is
rejected**: it is not what AFLDB does for a derivation from canonical facts.

**Proven precedent — `AFLDB-ISSUE-095`'s `club_seasons`.** That table is derived entirely from
canonical `matches`, and `tools/migration/rebuild_derived.py`'s `REBUILDS["club_seasons"]` stamps:

```sql
(SELECT id FROM sources WHERE key = 'afltables')
```

Its header records that provenance was deliberately **moved `sports_data_lab` → `afltables`**. The
convention is therefore: **a derived row is stamped with the underlying canonical source of the
facts it was derived from**, not with a synthetic "derived" source.

**Decision for Coleman:**

| Field | Value |
|---|---|
| `source_id` | **`afltables`** — the source of `player_match_stats` (`import_fitzroy_core.py`, `SOURCE_KEY_AFLTABLES = "afltables"`) |
| `source_record_id` | `coleman:<season>:<normalised-profile-path>` (§5.4) |
| `import_batch_id` | per run, via the existing `import_batch(...)` context manager |
| derivation method + version | recorded in the tracked contract file (§3.6), read by both loader and tests |

Consequences, all favourable:

- **`draftguru` is no longer claimed**, which is the point — the goals came from AFL Tables via
  fitzRoy, not from DraftGuru's award scrape. This is *more* honest, not a relabelling.
- **No new `sources` row, and therefore no migration.** `afltables` already exists in
  `data/reference/sources.json`.
- **The ownership scope is clean and exclusive.** No other `award_winners` writer uses `afltables`
  — the existing writers use `draftguru`, `wikipedia`, `wikipedia_22under22`, `footywire` and
  `manual_admin_edit` — so `(award_id = coleman AND source_id = afltables)` isolates exactly the
  derived rows.
- `require_source()` (`import_awards.py:261-275`) must still be used, so a missing `afltables` row
  fails closed rather than producing `source_id = ANY(ARRAY[NULL])`.

The **derivation character** lives in the tracked contract and in `award_winners.note`, not in a
fabricated source identity. There is no provenance laundering: the row says "these facts came from
AFL Tables", which is true, and the contract says "and AFLDB computed the award from them".

---

## 7. Player-link integrity

`award_winners` is one of the seven `LINK_TARGET_TABLES` (`src/db/queries/player-links.ts:37-45`),
so every `reload_keyed` guarantee applies unchanged (parent §6). Specific to this family:

- **Derived rows are born linked.** `player_id` comes from `player_match_stats`, so
  `link_status_value` is `resolved` and `player_name_raw` is the canonical display name. There is
  no unlinked-name problem here — unlike Hall of Fame or the All-Australian tail.
- **Measured: there are currently ZERO Coleman link decisions of any kind** (§3.5). Nothing to
  migrate, nothing to orphan.
- **An admin decision recorded in future must still be honoured.** `reload_keyed` re-applies it
  (`:648-658`); do not special-case derived rows out of the decision path.
- **`confirmed_unlinked` on a derived row is a contradiction worth surfacing** — a curator
  believing the derivation attributed goals to the wrong person. `reload_keyed` keeps the row
  unlinked and reports the disagreement (`:602-608`). Do not suppress that report.
- **Ownership scoping is mandatory**: `scope_column="award_id"` (the `coleman` award) **and**
  `scopes=[("source_id", [afltables_id], False)]`, so any `manual_admin_edit` Coleman row stays
  outside the UPDATE/INSERT/DELETE population (ISSUE-080).

### 7.1 Legacy → derived transition — RESOLVED: rekey in place, model A

**No row is deleted. All 46 existing `award_winners.id` values are preserved, including 9441.**

#### 7.1.1 Why a transition step is needed at all

`reload_keyed` matches within its ownership scope. The 46 legacy rows are `source_id = draftguru`;
the derived loader scopes to `source_id = afltables`. Left alone, the derived loader would see an
empty scope, **INSERT 46 new rows**, and leave the legacy 46 in place — 92 Coleman rows, silently
duplicated. Neither constraint stops this: `award_winners_source_uq (source_id, source_record_id)`
(migration 042) and `uq_award_winners_source (award_id, source_record_id) WHERE source_record_id IS
NOT NULL` (migration 023) are both satisfied by two rows with different keys.

So the transition is **mandatory**, and it must run **before** the first derived load.

#### 7.1.2 The proven precedent

`tools/records/import-first-kick-goal.ts` `--rekey` (`:312-411`) is the repository's one-time
in-place source-transition pattern:

- an exact **1:1 preflight** that prints its counts and **writes nothing** unless every count
  reconciles (`mappings.length === owned.length === active.length`, zero unmatched, zero
  ambiguous);
- **retry-safe by state**: all-legacy → rekey; all-new-format → verify and no-op; **mixed → abort**;
- the mutation is `UPDATE … WHERE id = <rowId>` inside a **single transaction**, and the code
  reports *"Rekeyed N row(s) in place; every surrogate id is unchanged."*

Coleman's transition is the same pattern with one addition: `source_id` changes as well as
`source_record_id`. Nothing blocks that — `afldb_import` holds full DML on `award_winners` (seeded
`import_writable_tables`, migration 045), and `player_link_resolutions.target_id` is deliberately
**not** a foreign key, so preserved ids keep any future decision valid.

#### 7.1.3 The three-part transition

**Step 1 — stop the legacy group producing Coleman.** `import_awards.py:417-420` already excludes
awards owned by another group:

```python
other_group_awards = [
    award_ids[slug] for slug in (UNDER_22_SLUG, ALL_AUSTRALIAN_SLUG)
    if slug in award_ids
]
```
…passed as `scope_column="award_id", scope_values=other_group_awards, scope_exclude=True`.

**Add the Coleman slug to that tuple.** This is the exact mechanism `under_22` already uses to own
a family inside the same file — a proven pattern, not a new one. After it, the legacy `awards`
group can never insert, update or delete a Coleman winner again.

*Note, not scope:* the `coleman` **award definition** row (keyed on `slug`) still comes from the
legacy `awards` group and already carries `first_season = 1980`, `last_season = 2025`. Leave it.
`AFLDB-ISSUE-112` owns the definitions when it replaces that group's input.

**Step 2 — one-time rekey.** Preconditions, all fail-closed:

| Precondition | Required value |
|---|---|
| rows in scope (`award_id = coleman`) | exactly **46** |
| all owned by `draftguru` | yes — mixed state **aborts**, per the precedent |
| existing `source_record_id` form | `coleman:<season>:<legacy-int>` for all 46 |
| seasons covered | 1980–2025, exactly one row each, no gaps |
| Coleman `player_link_resolutions` rows | **0** (re-verify; §3.5 measured 0) |
| every row maps 1:1 to a derived key | yes — else abort |
| new keys already present | none |

The mutation, in one transaction:

```sql
UPDATE award_winners
   SET source_id = <afltables>, source_record_id = <derived key>
 WHERE id = <rowId>;
```

**Only `source_id` and `source_record_id` change.** `player_id`, `link_status_value`, `club_id`,
`player_name_raw`, `votes` and `note` are deliberately left to the derived loader's own UPDATE —
the same split as the first-kick-goal precedent, which rekeys the key and nothing else. This keeps
the transition auditable: it moves ownership, it does not assert facts.

Bridging the 46 legacy rows to their derived keys is by **`(award_id, season)`** — safe precisely
because G0 measured exactly one legacy row per season with no gaps, and G3 measured
`LEGACY_ONLY = 0`, so the derivation produces a winner for every one of those seasons. Any season
that fails to bridge 1:1 aborts the whole transaction.

Retry-safety, by state: all 46 `draftguru` → rekey; all 46 `afltables` with valid derived keys →
verify and no-op; **any mixture → abort with both counts and write nothing.**

**Step 3 — first derived load.** The 46 rows are now inside the derived scope, so `reload_keyed`
matches them by key and UPDATEs in place. **Expected report: 46 updated, 0 inserted, 0 deleted** —
and that report is itself the acceptance signal. A single insert or delete means the bridge was
wrong.

#### 7.1.4 Expected before/after

| | Before | After rekey | After first load |
|---|---|---|---|
| Coleman rows | 46 | 46 | **46** |
| row ids | ids A…Z incl. **9441** | **identical** | **identical** |
| `source_id` | `draftguru` ×46 | `afltables` ×46 | `afltables` ×46 |
| `source_record_id` | `coleman:YYYY:<int>` | `coleman:YYYY:<path>` | unchanged |
| `player_id IS NULL` | 1 (the 1982 row) | 1 (untouched) | **0** |
| `link_status_value = 'implausible'` | 1 | 1 (untouched) | **0** |
| `player_link_resolutions` rows | 0 | 0 | 0 |

#### 7.1.5 Isolation — what the transition must never touch

Scoped to `award_id = <coleman>` **and** `source_id = <draftguru>` and nothing else. It must not
touch: non-Coleman `award_winners`; `manual_admin_edit` or NULL-provenance rows; other `draftguru`
families (All-Australian, club B&F, named medals — `AFLDB-ISSUE-112`); `award_nominations`;
`hall_of_fame`; `honour_team_members`; `captaincies`; any Brownlow table (`AFLDB-ISSUE-113`). A
row count other than exactly 46 in scope is a **refusal**, not a warning.

#### 7.1.6 Model choice

**Model A — rekey/re-own in place — is chosen.** Model B (retire the legacy rows and insert derived
ones) is rejected: it would destroy 46 surrogate ids for no benefit, and surrogate ids are durable
application identity that `player_link_resolutions.target_id` points at. There is no third pattern
in the repository, and none should be invented.

#### 7.1.7 The 1982 row, explicitly

`award_winners.id = 9441` is **preserved**. The rekey changes only its `source_id` and
`source_record_id`; the first derived load then sets `player_id = 1534`,
`link_status_value = 'resolved'`, `player_name_raw` to the canonical display name, and `club_id` to
North Melbourne (its sole qualifying H&A club — the same club 115 the legacy row already carried).

This **overrides no human decision**: §3.5 measured **zero** `player_link_resolutions` rows for
`target_id = 9441`. The legacy `implausible` status was an import-derived classification from the
legacy name matcher, not an admin judgement. `reload_keyed`'s decision path is a no-op here because
`_DECISIONS` is empty, so no `LinkDecisionLoss` can arise.

`player_name_raw` will change from the legacy spelling to the canonical display name. That is safe
**only because there are no decisions**: with a decision present, `reload_keyed`'s name guard
(`:586-592`) would classify it discarded and abort. The rekey preflight must therefore **re-verify
that the decision count is still zero at run time**, not trust this document.

---

## 8. Reload and rebuild

| Property | Requirement |
|---|---|
| Deterministic | same database → byte-identical row set and ordering (emit ordered by `season`, then normalised path) |
| Idempotent | a second consecutive run reports 0 inserted, 0 deleted, byte-identical row-id fingerprint |
| Link-preserving | via `reload_keyed`, unmodified |
| Safe when canonical data changes | a corrected `player_match_stats` row changes the winner; the key is identity-based, so the row is UPDATEd, not churned |
| Rebuild-integrated | a new stage in `tools/db/rebuild-test.ts`, **after** FITZROY (it needs `matches`, `player_match_stats` and `external_identities`) and independent of `player_season_stats` |
| Stage-9 gate | a Coleman row-count / season-span gate in FINAL VALIDATION, **only once the stage exists** (parent §5) |
| No legacy | `tests/db-test-rebuild.test.ts:716` ("carries no `AFLDB_LEGACY_SQLITE` anywhere in the plan") must still pass |

Where the code lives: **extend `tools/migration/import_awards.py` with a new group** rather than
creating a new tool. `under_22` already proves a group can be legacy-free in that file, and
`GROUP_ORDER` / `GROUP_REQUIRES` / `set_reload_scope` / `import_batch` / `require_source` are all
reusable. Add the group to `GROUPS` and `GROUP_ORDER`, and — critically — the `needs_legacy`
predicate at `:1407` must be extended so the Coleman group, like `under_22`, does not demand
`AFLDB_LEGACY_SQLITE`.

---

## 9. Acceptance gates

| Gate | State | Statement |
|---|---|---|
| **G0** | **PASS** | Coleman span measured 1980–2025, 46 rows, one per season, no gaps. Declared span begins **1980**. No backfill to 1955; no extension to 1897. (§3.1) |
| **G1** | **PASS** | 341,981 H&A `player_match_stats` rows over 7,941 matches, 1980–2025, `goals IS NULL` = 0, zero season exceptions. (§2.3) |
| **G2** | **PASS** | An **independent** query shape in the integration test reproduces the loader's winner set *and* the per-winner goal totals (the ISSUE-103 oracle pattern). Operator-run against `afldb_test`, pass 4. (§17.1) |
| **G3** | **PASS, explained** | MATCH 45, DERIVED_ONLY 1, LEGACY_UNLINKED 1, LEGACY_ONLY 0 — both exceptions are the same 1982 winner; no semantic disagreement. (§3.3, §3.4) |
| **G4** | **DECIDED** | One distinct H&A club → `club_id`; more than one → **NULL**. Zero historical multi-club winners, so a synthetic fixture is required. (§3.2) |
| **G5** | **RESOLVED** | `source_record_id` = `coleman:<season>:<normalised AFL Tables profile path>`, read from `external_identities`. `players.id` is **not** rebuild-stable and is rejected. (§5) |
| **G5a** | **PASS** | Every 1980–2025 Coleman winner has an `afltables_profile_url` identity with `status IN ('unique','resolved')` — `missing_identity = 0`. The missing, ambiguous and `:`-in-path cases all make the loader refuse against a real database, writing nothing; it never falls back to `players.id` or a name. Operator-run, pass 6. (§5.5, §18.1) |
| **G6** | **PASS** | Zero Coleman `player_link_resolutions` rows before and after, re-verified at run time (§3.5); the transition is **rekey in place, model A**, and all 46 ids are preserved (§7.1), proven by fixture in pass 7. A `linked` and a `confirmed_unlinked` decision both survive the derived reload, the name guard refuses a drifted decided row, and the refusal is recoverable — pass 8. (§20.1, §21.1) |
| **G7** | **PASS** | The destructive canonical rebuild of `afldb_test` completed **exit 0** on 2026-08-30: the `coleman` stage reported `46 winners (46 seasons, 0 updated, 46 inserted, 0 deleted)` and FINAL VALIDATION returned `AFLDB-FINAL-VALIDATION PASSED: 26 checks` with all seven Coleman gates green. No legacy SQLite is in the plan. (§33) |
| **G8** | **PASS** | Three consecutive reloads idempotent — 0 inserted / 0 deleted on runs 2 and 3, byte-identical `md5(id\|source_record_id)` fingerprint (pass 3) — and every one of the 46 ids unchanged from before the transition and after the first derived load (pass 7). (§16.1, §20.1) |
| **G9** | **PASS** | No operational `AFLDB_LEGACY_SQLITE` dependency remains for Coleman — `needs_legacy` is no longer true for the Coleman group, proved by a real `--groups coleman` run spawned with the variable dropped from the child environment (pass 3). (§16.1) |

---

## 10. Tests

Reuse existing homes. Do not create a new test file where one fits.

| Kind | Home | Cases |
|---|---|---|
| DB-free source/contract | new focused suite in the `tests/under-22-importer.test.ts` mould | span declaration is honoured; finals excluded; ties produce N rows; identity format; provenance is not `draftguru`; no legacy symbols in the loader |
| Integration — derivation | `tests/integration/awards-reload-links.test.ts` (the semantic home; it already owns the awards ETL boundary) | derived rows match the independent oracle (G2) |
| Integration — tie fixture | same | a synthetic season with two tied leaders yields two rows with distinct deterministic keys |
| Integration — season boundary | same | the season before the declared first season yields **no** row; an `in_progress` season yields no row |
| Integration — H&A semantics | same | a player whose finals goals would change the ranking does **not** change the winner |
| Integration — stable-ID reload | same | three reloads, byte-identical row-id fingerprint (G8) |
| Integration — manual link | same | an admin `linked` decision and a `confirmed_unlinked` decision both survive a reload; the disagreement is reported |
| Integration — ownership | same | a `manual_admin_edit` Coleman row and a legacy `draftguru` row are untouched by the derived loader |
| Rebuild | `tests/db-test-rebuild.test.ts` | the new stage is in the plan, in the right order, with no legacy reference |
| Independent PostgreSQL truth | integration | recompute from `matches` + `player_match_stats` with a different query shape and compare |
| Multi-club NULL fixture | integration | a **synthetic** winner with H&A matches for two clubs yields `club_id IS NULL` — history supplies no real case (§3.2) |
| Identity coverage (G5a) | integration + DB-free guard | a winner with no `afltables_profile_url` identity makes the loader **refuse**; it never falls back to `players.id`, the fitzRoy numeric id, or a name |
| Key composition | DB-free | the key is built from the **normalised** path; a path containing `:` is **refused**, not sanitised |
| Rebuild-stability of the key | DB-free | the key contains no `players.id` and no display name |
| Transition preflight | integration | 46-row all-`draftguru` state rekeys 1:1; an all-`afltables` state verifies and no-ops; a **mixed** state aborts writing nothing; a season that fails to bridge aborts |
| Transition id preservation | integration | every one of the 46 `award_winners.id` values — **including 9441** — is byte-identical before and after transition **and** after the first derived load |
| Transition isolation | integration | non-Coleman `award_winners`, `manual_admin_edit` rows and other `draftguru` families are untouched |
| First-load signal | integration | the first derived load after transition reports **46 updated / 0 inserted / 0 deleted** |
| No-decision-regression audit | integration | Coleman `player_link_resolutions` count is 0 before and after; the preflight re-verifies it at run time rather than trusting the runbook |

Integration tests use `AFLDB_TEST_DATABASE_URL` against a `_test` database, and the restricted
role parity harness (`tests/integration/import-role-parity.ts`) where the importer is spawned.

---

## 11. Explicit exclusions

- No change to `getSeasonGoalkickers`, `getClubGoalkickers`, or any leading-goalkicker page.
- No change to `player_season_stats` or `player_career_stats`.
- No other award family — those are ISSUE-112.
- No Brownlow work — that is ISSUE-113.
- No external acquisition, scraping or fetching of any kind.
- No privilege change; no migration editing.
- No production or `afldb_dev` mutation. The §3.1 measurement is **read-only**.

---

## 12. Implementation — pass 1 (2026-08-30)

Design was not revisited. Items 1–16 of the handoff's ordered work were executed as
written except where noted below. **No database was mutated, no test was run and no Git
command was run in this pass** — validation is the operator's, and stops at the DB-free
boundary before any integration work.

### 12.1 Delivered

| Handoff item | Where |
|---|---|
| 1 tracked span declaration | `data/reference/coleman-derivation.json` — `first_season: 1980`, derivation method, `method_version: 1`, tie rule, club rule, provenance, key format, identity rule, separator rule, and the whole `legacy_transition` block |
| 2 new group | `tools/migration/import_awards.py` — `GROUPS`/`GROUP_ORDER` gain `coleman`; reuses `require_source`, `import_batch`, `set_reload_scope`, `reload_keyed` |
| 3 `needs_legacy` | generalised to `LEGACY_FREE_GROUPS = {"under_22", COLEMAN_GROUP}` |
| 4 derivation query | `COLEMAN_DERIVATION_SQL` — `player_match_stats ⋈ matches`, `NOT m.is_final`, `sum(goals)` by `(season, player_id)`, per-season `max`, **all ties retained**. `player_season_stats` appears nowhere but in the comment saying why |
| 5 completed seasons | `JOIN seasons s ON s.year = m.season AND s.status = 'complete'` |
| 6 span filter | `m.season >= %(first_season)s`, bound from the declaration; no year literal in the loader |
| 7 G5a identity | `LEFT JOIN LATERAL` over `external_identities` on the declared `match_method`/statuses; missing → refuse, more than one → refuse, `:` in the path → refuse (never sanitise). No fallback to `players.id`, the fitzRoy id or a name |
| 8 key composition | `coleman:<season>:<normalised path>`; emit ordered by `(season, profile_path)` |
| 9 club logic | `count(DISTINCT club_id)` over the qualifying H&A matches — one → that club, more → NULL, reported as a warning |
| 10 provenance | `source_id = afltables` via `require_source(sources, contract["source_key"])`; `import_batch` source key `afltables` |
| 11 `reload_keyed` | key `(source_id, source_record_id)`; `scope_column="award_id"` **and** `scopes=[("source_id",[afltables],False)]`; `delete_missing` default |
| 12 legacy exclusion | `other_group_awards` gains `COLEMAN_SLUG` — the exact `under_22` mechanism |
| 13 one-time transition | `--rekey-coleman` + `rekey_coleman()`, modelled on `import-first-kick-goal.ts:312-411` |
| 14 rebuild stage | `tools/db/rebuild-test.ts` — new `coleman` data stage |
| 15 Stage-9 gate | `colemanChecks()` / `colemanFirstSeason()`, added in the same change as the stage |
| 16 docs | `docs/deployment.md` §7 |

DB-free tests: `tests/coleman-derivation.test.ts` (new), plus Coleman coverage added to
`tests/db-test-rebuild.test.ts` and the three assertions in
`tests/under-22-importer.test.ts` that pinned the now-generalised predicates.

### 12.2 Deviations from the handoff, with the evidence requiring them

**(a) The Coleman award DEFINITION is created when it does not exist.** The handoff said
to leave the definition to the legacy group and to ISSUE-112 (§7.1.3 note). That is
correct in a legacy-loaded database and is preserved: `coleman_award_id()` returns an
existing definition untouched, and never UPDATEs one. But handoff item 14 requires a
canonical-rebuild stage, and a canonical rebuild runs **no legacy awards group at all** —
`planStages()` has no awards stage, so `awards` would hold no `coleman` row and the
derived winners would have no parent under a NOT NULL `award_id` foreign key.
Create-if-missing is the smallest change that makes both paths work without taking
ownership. **This is a gap in the handoff, not a contradiction of its evidence.**

**(b) The rebuild stage runs after `derived`, not immediately after `fitzroy`.** The
handoff said "after FITZROY"; that is satisfied, but it is not sufficient. The
completed-season rule reads `seasons.status`, and `seasons.status` is written by
`rebuild_derived.py`'s `season_metadata` target (migration 015 defaults the column to
`'complete'`). Placing the stage before `derived` would read a default rather than a
computed status and could name a winner for a season still being played. The same
reasoning moved the Coleman pass after `rebuild_derived.py` in `docs/deployment.md` §7.

**(c) `votes` is left NULL and the goal total goes in `note`.** §7.1.3 left `votes` to the
derived loader without saying what to write. `src/app/awards/[slug]/page.tsx:376` labels
that column **"Votes"**; a goal total is not a vote total, so writing it there would
mislabel the fact in the UI. The total is recorded in `award_winners.note`, which §6
already names as the home for the derivation's character.

**(d) `club_name_raw` is NULL.** There is no source club spelling to preserve — the club
is a canonical id computed from the winner's own match rows, not a name read from a
source.

**(e) A per-run NULL-goals guard was added.** §2.3 frames zero NULL H&A goals as "a
pre-flight invariant, not an assumption". `COLEMAN_NULL_GOALS_SQL` proves it per run and
refuses rather than silently understating a season total. G1 measured 0, so this should
never fire; if it does, it is real information.

### 12.3 Not yet done

- Every **integration** test in §10 / the handoff's test matrix: the PostgreSQL oracle
  (G2), the synthetic tie and multi-club fixtures, the in-progress and season-boundary
  exclusions, the identity-refusal fixture, the three-reload fingerprint (G8), the
  transition preflight/id-preservation/isolation cases, the 46/0/0 first-load signal, and
  the manual-link and no-decision-regression audits. Home:
  `tests/integration/awards-reload-links.test.ts`.
- G5a has **not** been run against any database.
- The transition has **not** been executed anywhere.
- `CHANGELOG.md` — deferred until the behaviour is validated.

**Superseded by §14** for the items pass 2 delivered.

## 14. DB-free validation — PASSED (operator-run, 2026-08-30)

Run by the operator against the pass-1 code, no database contact:

- `npm ci` — 419 packages, 0 vulnerabilities.
- `npm test -- tests/coleman-derivation.test.ts tests/under-22-importer.test.ts
  tests/db-test-rebuild.test.ts` — **3/3 files, 263/263 tests passed** in 2.55 s
  (`db-test-rebuild` 213, `coleman-derivation` 42, `under-22-importer` 8).
- `npx tsc --noEmit` — **exit 0, zero diagnostics**.

No database was mutated, no integration test ran, no `afldb_test` write occurred, no
`afldb_dev` mutation occurred, no production access occurred.

The handoff §6 "most likely failure mode" — the source-text contract assertions in
`tests/coleman-derivation.test.ts` — **did not occur**. The pass-1 implementation needed no
correction.

## 15. Implementation — pass 2 (2026-08-30): the derived-load integration boundary

Added to `tests/integration/awards-reload-links.test.ts` — the existing owner of the awards
ETL boundary, with the role-parity harness, the honours table lock and a shared connection
pool. No new integration file was created.

New describe: **`Coleman Medal derived from canonical match facts (AFLDB-ISSUE-111)`**,
gated on `canRunFixtureImporter` (Python + psycopg + validated
`AFLDB_TEST_IMPORT_DATABASE_URL`) and **not** on `AFLDB_LEGACY_SQLITE` — this group reads
no legacy database, which is the point.

| Test | Gate | What it proves |
|---|---|---|
| derives and loads with `AFLDB_LEGACY_SQLITE` unset | **G9** | the child process genuinely runs without the variable, and stdout never announces a legacy source |
| records its own batch against the derived provenance | — | `import_batches` row `target_table='coleman'`, status `completed`, `source_id` = `afltables`, `records_read` = rows, `records_rejected` = 0 |
| owns every row under the derived provenance and the durable key | **G5** | every row is `afltables`-owned; no key of the rejected `coleman:<season>:<players.id>` form; each key's season field matches its row and each key's path is a **persisted `afltables_profile_url` identity**; every key unique |
| is born linked, and records the goal total in `note` rather than `votes` | deviations (c)(d) | `player_id` non-NULL, `resolved`, `candidate_count` 0, `player_name_raw` = `players.display_name`, `votes` NULL, `club_name_raw` NULL, `note` matches the declared format and carries `method_version` |
| reproduces the persisted winner set with an independent oracle query | **G2** | a deliberately different query shape — `round_type = 'home_and_away'` instead of `NOT is_final`, a season subquery instead of a join, a separately grouped per-season maximum joined back instead of a window function (see §16.2 — the original correlated-`max` form timed out) — names the same winners **and the same goal totals** |
| honours the declared span and the completed-season rule | — | `min(season)` = the contract's `first_season`, nothing before it, **no winner in a season whose `seasons.status <> 'complete'`**, and the derived season count equals the count of complete seasons whose facts can decide the award |
| persists the sole home-and-away club, or NULL when there is more than one | **G4** | one distinct H&A club → that club; more than one → NULL, over the real corpus |
| is stable across three consecutive reloads | **G8** | runs 2 and 3 report **0 inserted / 0 deleted** with every row updated in place, and the `md5(id\|source_record_id)` fingerprint is byte-identical across all three |
| creates no player-link decision of its own | — | the Coleman `player_link_resolutions` count is unchanged by the load |

**Deliberate refusal in `beforeAll`.** The suite measures Coleman rows owned by a source
other than the contract's before it runs anything. If any exist, it **throws with an
actionable message** rather than loading: the derived loader scopes to `afltables`, so
running it beside legacy `draftguru` rows is exactly the 92-row duplication the one-time
transition exists to prevent. The suite will not manufacture that state, and it does not
silently run `--rekey-coleman` either, because the next slice must observe the transition's
own **46 updated / 0 inserted / 0 deleted** signal directly.

**Not `runImporter()`.** That helper's `sqlitePath` parameter defaults to the ambient legacy
path, so passing `undefined` would silently restore it. `runColeman()` spawns through
`importRole.spawn` with `AFLDB_LEGACY_SQLITE: undefined`, which node drops from the child
environment entirely — that is what makes the G9 assertion real rather than decorative.

### 15.1 Still not done after pass 2

- Synthetic fixtures against a real database: the tie season, the multi-club NULL winner,
  the in-progress season, the season boundary, the finals-exclusion case, and the
  missing/ambiguous identity refusal (the pure half of these is already covered DB-free).
- The whole legacy → derived transition suite: 1:1 preflight, retry/no-op, mixed-state
  refusal, unbridgeable refusal, id preservation including 9441, isolation, and the
  **46/0/0** first-load signal.
- The manual-link survival audit (a `linked` and a `confirmed_unlinked` decision).
- G5a against `afldb_dev` (read-only), and the transition executed anywhere.
- G7 — `npm run db:test:rebuild -- --acknowledge-destroy afldb_test`.
- `CHANGELOG.md`.

## 16. Pass 3 (2026-08-30) — first execution against `afldb_test`, and the G2 fix

### 16.1 The measured result

Operator-run, against a proven `afldb_test`:

```
npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"
```

**8 passed, 1 failed**, 24 unrelated tests in the file skipped by the `-t` filter.

| Test | Gate | Result |
|---|---|---|
| derives and loads with `AFLDB_LEGACY_SQLITE` unset | G9 | **PASS** |
| records its own batch against the derived provenance | — | **PASS** |
| owns every row under the derived provenance and the durable key | G5 | **PASS** |
| born linked; goal total in `note`; `votes` and `club_name_raw` NULL | (c)(d) | **PASS** |
| reproduces the persisted winner set with an independent oracle query | **G2** | **FAIL — statement timeout** |
| honours the declared span and the completed-season rule | — | **PASS** |
| persists the sole home-and-away club, or NULL when there is more than one | G4 | **PASS** |
| is stable across three consecutive reloads | G8 | **PASS** |
| creates no player-link decision of its own | — | **PASS** |

This is the **first time the derived loader has touched any database**, and it is the first
runtime evidence for G4, G5, G8 and G9. `beforeAll` did **not** throw, so `afldb_test` held
no legacy `draftguru`-owned Coleman family; the G5a identity guard did **not** fire, so every
derived winner in `afldb_test` had a persisted `afltables_profile_url` identity; and
`min(season)` matched the contract's `first_season`.

**`afldb_test` has been mutated.** Its Coleman family is now derived, `afltables`-owned and
keyed on profile paths, written four times (the first load plus the three G8 reloads). Do not
plan later work on the assumption that it still holds the legacy `draftguru` state.

### 16.2 G2 — diagnosis

```
PostgresError: canceling statement due to statement timeout
tests/integration/awards-reload-links.test.ts (the G2 oracle)
```

**Not a semantic mismatch.** The oracle never returned a row, so no winner comparison was ever
made. It is a defect in the oracle's own shape, and the diagnosis is structural rather than
inferred from timing:

- the oracle's `totals` CTE was referenced **twice** — once as `t`, once as `t2` inside
  `(SELECT max(t2.goals) FROM totals t2 WHERE t2.season = t.season)`;
- PostgreSQL 12+ **materialises** a CTE referenced more than once, and a materialised CTE
  carries **no index**;
- so the correlated `max` was a full CTE Scan **per outer row**, not an indexed lookup;
- `totals` is one row per (season, player) with any home-and-away appearance — roughly
  46 seasons x ~750 goalkickers ≈ 34k rows — giving ≈ 34k x 34k ≈ 1.2 billion row
  comparisons for a result set of 46 rows.

The client is `sql` from `src/db/client.ts`, whose `connection.statement_timeout` is
**5000 ms** (`src/db/client.ts:22,37`). The quadratic rescan cannot fit in that, and it should
not have to: the surrounding work (one scan of `player_match_stats`, a hash join to `matches`,
one hash aggregate) is linear.

### 16.3 G2 — the fix

`tests/integration/awards-reload-links.test.ts`, the G2 oracle only. The per-season maximum is
computed **once** as its own grouped aggregate and equi-joined back:

```sql
maxima AS (
  SELECT season, max(goals) AS goals
    FROM totals
   GROUP BY season
)
...
  FROM totals t
  JOIN maxima mx ON mx.season = t.season AND mx.goals = t.goals
 WHERE t.goals >= <minimum_goals>
 ORDER BY t.season, t.player_id
```

**What is preserved:**

- **Independence.** Three deliberate shape differences from `COLEMAN_DERIVATION_SQL` remain:
  `round_type = 'home_and_away'` instead of `NOT m.is_final`; a season subquery instead of a
  join to `seasons`; and a grouped aggregate joined back instead of the implementation's
  `max(goals) OVER (PARTITION BY season)`. The oracle still recomputes the goal totals from
  `player_match_stats` itself — it reads nothing the loader wrote.
- **Strength.** Winner identity and goal totals are both still compared, as ordered lists, with
  no tolerance: `expect(...).toEqual(...)` on `season:playerId` and on the totals parsed out of
  the persisted `note`.
- **Ties.** An equi-join on the season maximum retains **every** tied leader, exactly as the
  previous form did. No `DISTINCT ON`, no `LIMIT`, no row collapsing.
- **The `minimum_goals` floor** is still applied after the maximum, as in the implementation.
- **Determinism.** Same `ORDER BY t.season, t.player_id`.

**What was rejected:** raising `statement_timeout`. `AFLDB_STATEMENT_TIMEOUT_MS` is read once by
`createClient()` for the whole shared pool, so raising it would relax the bound for every suite
in the run, and the repository has explicit precedent against it (ISSUE-076: *"Do not raise or
bypass the normal 5-second `statement_timeout`"*; ISSUE-103's oracles were captured under the
same 5 s bound). A linear query removes the need entirely — nothing here justifies an exemption.

**No loader change.** `COLEMAN_DERIVATION_SQL`, the contract, the rebuild stage, the gates and
every other test are untouched by this fix.

### 16.4 Environment facts established by the pass-3 run

- The integration harness resolves Python from **`AFLDB_PYTHON`**, not `PYTHON`
  (`tests/integration/awards-reload-links.test.ts:54`).
- The working interpreter was a worktree-local virtualenv,
  `D:\dev\afldb-issue-102\.venv\Scripts\python.exe`, carrying **psycopg 3.3.4**.
- The harness's automatic probe is `.venv/bin/python` (the POSIX layout), which does not exist
  on Windows, so `AFLDB_PYTHON` is **required** here. Recorded as a follow-up observation, not
  fixed in this slice.
- Proven targets immediately before the run: `AFLDB_TEST_DATABASE_URL` →
  `afldb_test | afldb_owner`; `AFLDB_TEST_IMPORT_DATABASE_URL` → `afldb_test | afldb_import`.

## 17. Pass 4 (2026-08-30) — G2 re-run PASSED, and the derivation-rule fixtures

### 17.1 G2 — the rewritten oracle, measured

Operator-run, unchanged command:

```
npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"
```

**1 file passed; 9 ISSUE-111 tests passed, 0 failed**, 24 unrelated tests filtered out; suite
duration **5.49 s**. The rewritten G2 oracle returned in **351 ms** — comfortably inside the
5 s `statement_timeout` that the previous quadratic form could not meet — and it named
**exactly** the persisted winner set and the persisted goal totals. G8 (three consecutive
reloads) and G9 (legacy-free derived load) passed again on the same run.

**G2 is therefore PASSED, and the whole pass-2/pass-3 derived-load integration block is green.**
The diagnosis in §16.2 is confirmed by measurement: the failure was the oracle's own cost, not a
semantic disagreement between the loader and an independent query shape. `AFLDB_PYTHON` remained
`D:\dev\afldb-issue-102\.venv\Scripts\python.exe`.

### 17.2 The rules history cannot demonstrate

The real corpus exercises exactly one shape of the derivation. G4 measured **45 of 45**
historical winners representing exactly one home-and-away club; there is no historical tie
inside the declared span, no multi-club winner, no in-progress season that has produced a
leader, and no finals total large enough to reorder a season. Four contract rules were therefore
carried by **no runtime evidence at all** after pass 3:

| Rule | Contract | Previously proven by |
|---|---|---|
| every tied leader wins | `tie_rule` | DB-free synthetic rows only |
| a two-club winner persists `club_id` NULL | `club_rule` | DB-free synthetic rows only |
| an `in_progress` season decides nothing | `completed_seasons_rule` | nothing |
| finals goals never count | `home_and_away_rule` | nothing |
| the season before `first_season` yields nothing | `first_season` | nothing |

Pass 4 adds a second integration describe — **`Coleman derivation rules that history cannot
demonstrate (AFLDB-ISSUE-111)`** — in the same file, which builds each of those cases as
**synthetic canonical data** and loads it through the **real** `--groups coleman` importer.
Nothing in the block reimplements `COLEMAN_DERIVATION_SQL`; the point is to prove it.

### 17.3 Fixture design

**Reserved seasons.** 2090–2093 sit above every real season and below `seasons_year_ck`'s 2100
ceiling, so they cannot collide with the corpus. The boundary case must be the season
immediately before the contract's own `first_season`, so it is computed from the contract
(`first_season - 1`) rather than written as a literal — a later span change moves the fixture
with it.

| Season | Case | Fixture | Expected |
|---|---|---|---|
| 2090 | tie | A 3+2, B 5, C 4 | **two** winner rows (A and B, 5 each), distinct keys |
| 2091 | multi-club | A 4 for club 1 + 3 for club 2, B 2 | one row, 7 goals, `club_id` **NULL** |
| 2092 | in progress | A 9, season `in_progress` | **no** row |
| 2093 | finals | A 6 H&A; B 4 H&A **+ 10 in a final** | one row, **A**, 6 goals |
| `first_season - 1` | span boundary | A 99 | **no** row |

The 2093 fixture is the sharpest of the five: B leads the season 14–6 and trails home-and-away
4–6, so a derivation that read `player_season_stats` — the excluded source — would name B.

**Real players, real clubs.** The fixtures exercise the derivation, not the identity contract,
so the three players are chosen at run time as the lowest-numbered players holding **exactly
one** `afltables_profile_url` identity. A player holding two would make the loader refuse for a
reason this block is not testing. No player, club, `external_identities` or `awards` row is
created or modified.

**Cleanup is defensive at both ends.** The release gates count `matches` and
`player_match_stats`, so a crashed run must not leave synthetic rows behind. The corpus is
removed on entry *and* on exit, in foreign-key order (`player_match_stats` → `matches` →
fixture-season `award_winners` → `seasons`). Synthetic matches are identified by a
`match_key` prefix and synthetic seasons by a fixture `notes` marker — **never by year**, so a
boundary season that already exists in a fully loaded database is never deleted. `afterAll`
then re-runs the loader and requires the `md5(id|source_record_id)` fingerprint of the real
family to come back **byte-identical**, which proves both that `delete_missing` removed the
fixture winners and that no real surrogate id moved.

### 17.4 What pass 4 changed

- `tests/integration/awards-reload-links.test.ts` — one new describe (§17.2–§17.3) plus the
  module-level fixture constants and `removeFixtureCorpus()` beside the existing Coleman
  helpers. **No existing test, helper, query or assertion was changed.**
- `issues/open/AFLDB-ISSUE-111.md` — this section; Status renumbered §17 → §18.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — validation state, pass-4 record and next prompt.

No loader, contract, rebuild stage, gate, migration, privilege file, manifest, `CHANGELOG.md`,
`issues.md`, `IssuesIndex.md` or ISSUE-110/112/113 material was touched, and no Git command was
run.

### 17.5 Still not proven by pass 4

The identity refusal (**G5a**) is deliberately **not** in this block: it needs a player with no
`afltables_profile_url` identity, which means creating a synthetic player rather than reusing a
real one, and it must assert a **non-zero exit** rather than a loaded row. It is its own slice.
The legacy → derived transition and G7 are likewise untouched.

## 18. Pass 5 (2026-08-30) — the fixture block PASSED, and the G5a refusal slice

### 18.1 The measured result — operator-run against `afldb_test`

`npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` with
`AFLDB_PYTHON=D:\dev\afldb-issue-102\.venv\Scripts\python.exe`:

- **1 test file passed; 15 ISSUE-111 tests passed, 0 failed**; 24 unrelated tests filtered out;
  8.36 s.
- Existing derived-load block: **9 of 9 PASS**, with **G2 in 354 ms** (the pass-3 fix holding at
  the same order of magnitude as its 351 ms re-run) and **G8** and **G9** PASS.
- New derivation-rule block: **6 of 6 PASS** — the fixture corpus loads; tied season leaders are
  all awarded; the two-club winner persists `club_id` NULL; the in-progress season produces no
  award; the season before `first_season` produces no award; finals are excluded from the goal
  totals.
- **No `afterAll` restoration failure.** The real Coleman family came back with a byte-identical
  `md5(id|source_record_id)` fingerprint, so fixture cleanup and restoration are proven, not
  assumed.

The pass-4 handoff predicted fourteen tests. That count was simply off by one: the new block
contains six tests, not five, so 9 + 6 = **15**. No test was added, removed or renamed to reach
it.

**This closes the four contract rules that carried no runtime evidence** — `tie_rule`,
`club_rule`, `completed_seasons_rule` and `home_and_away_rule` — plus the `first_season`
boundary. Every rule in `data/reference/coleman-derivation.json` except the identity rule
(§5.5) and the legacy transition (§7.1) is now measured against a real database.

### 18.2 The G5a identity-refusal block — WRITTEN, unrun

A third describe was appended to `tests/integration/awards-reload-links.test.ts`:
**`Coleman durable-identity refusals against a real database (AFLDB-ISSUE-111 G5a)`**, on the
same `canRunFixtureImporter` gate.

`tests/coleman-derivation.test.ts` already proves all three refusals DB-free by driving
`build_coleman_winners()` over synthetic rows through a Python subprocess. What it cannot prove
is the same refusal reached through `COLEMAN_DERIVATION_SQL` — that the query's LATERAL really
returns no path for a winner holding no identity, two paths for one holding two, and the stored
path verbatim for one carrying the key separator. That is what this block adds.

**The fixture.** One reserved season (**2094**, above the pass-4 seasons and below the
`seasons_year_ck` ceiling), one synthetic match, and one synthetic player who is that season's
only goalkicker and therefore unambiguously its winner. A synthetic player is unavoidable:
every real player in `afldb_test` already holds the identity this block needs to withhold.
Only the player's `external_identities` rows change between cases, so identity is the isolated
cause of each refusal.

| # | Case | Identity state | Expected |
|---|---|---|---|
| 1 | missing | none | refuse; batch marked `failed` with the reason |
| 2 | ambiguous | two `unique` profile paths | refuse, naming both; never picks one |
| 3 | unsafe path | one path containing `:` | refuse, REFUSED not sanitised |
| 4 | control | exactly one ordinary path | **load succeeds**, keyed on the path |

Four design points:

1. **The acceptance shape is inverted.** Each refusal asserts a **non-zero exit**, the refusal
   text (including *"will not fall back to players.id"* and *"Nothing has been written."*), and
   — measured, not assumed — an **unmoved database**: the real family's fingerprint and row
   count unchanged, and no row written for the fixture season under any key.
2. **The control case is load-bearing.** Without it, three refusals would be equally consistent
   with a fixture that could never load at all. Giving the same player one ordinary identity and
   requiring the load to succeed *keyed on that path* is what makes the refusals evidence about
   the identity contract.
3. **One cleanup scheme, not two.** `removeFixtureCorpus()` was extended rather than duplicated:
   it now also removes the synthetic player and its identities, matched on the same
   `notes = 'AFLDB-ISSUE-111 synthetic fixture'` marker it already matches seasons on, after the
   `award_winners` delete because a derived winner can point at that player. `CREATED_SEASONS`
   and the pass-4 status assertions are untouched; the identity season is added only to the
   deletion scope.
4. **The synthetic player's id is taken above the corpus** (`coalesce(max(id), 0) + 1`), not from
   the identity sequence, which the canonical import seeds with explicit ids and can therefore
   leave behind `max(id)`.

### 18.3 What pass 5 changed

- `tests/integration/awards-reload-links.test.ts` — one new describe (§18.2); `key_separator`
  added to the `ColemanContract` type; `removeFixtureCorpus()` extended and its scope constant
  widened. **No existing test, assertion or query was changed.**
- `issues/open/AFLDB-ISSUE-111.md` — this section; Status renumbered §18 → §19.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — validation state, pass-5 record and next prompt.

No loader, contract, rebuild stage, gate, migration, privilege file, manifest, `CHANGELOG.md`,
`issues.md`, `IssuesIndex.md` or ISSUE-110/112/113 material was touched, and no Git command was
run.

## 19. Pass 6 (2026-08-30) — G5a PASSED, and the transition suite

### 19.1 The measured result — operator-run against `afldb_test`

`npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` with
`AFLDB_PYTHON=D:\dev\afldb-issue-102\.venv\Scripts\python.exe`:

- **1 test file passed; 19 ISSUE-111 tests passed, 0 failed**; 24 unrelated tests filtered out;
  15.40 s.
- Derived-load block: **9 of 9 PASS**, G2 in **334 ms**, G8 and G9 PASS.
- Derivation-rule block: **6 of 6 PASS** — ties preserved, multi-club winner persists `club_id`
  NULL, in-progress season excluded, pre-`first_season` boundary excluded, finals excluded.
- **New G5a block: 4 of 4 PASS** — a missing durable identity refuses the whole load; two
  durable identities refuse rather than choosing; a profile path containing `:` is REFUSED, not
  sanitised; and the same synthetic winner loads successfully once exactly one ordinary durable
  identity exists, keyed on that path.
- **No `afterAll` restoration or fingerprint failure**, so fixture cleanup and restoration are
  measured again rather than assumed.

**G5a is therefore PROVEN against a real database**, through `COLEMAN_DERIVATION_SQL` and not
only through the DB-free `build_coleman_winners()` suite. The identity contract (§5, §5.5) is
not to be weakened or revisited without new evidence.

**Every rule in `data/reference/coleman-derivation.json` except the legacy transition (§7.1)
now carries runtime evidence.** The transition itself remains executed nowhere.

### 19.2 The transition suite — WRITTEN, unrun

A fourth describe was appended to `tests/integration/awards-reload-links.test.ts`:
**`Coleman legacy to derived ownership transition (AFLDB-ISSUE-111)`**, on the same
`canRunFixtureImporter` gate. It covers handoff items 8–14 in one block, because they are one
choreography over one manufactured state rather than seven independent fixtures.

**The state problem, and how it is solved.** `afldb_test`'s Coleman family is already derived,
`afltables`-owned and keyed on profile paths (passes 3–5 put it there), so the all-`draftguru`
state the preflight demands no longer exists anywhere. The block manufactures it **from the
derived family itself** — rewriting `source_id` to `draftguru` and `source_record_id` to
`coleman:<season>:<id>`, the legacy form the preflight recognises — and restores it **by id**
afterwards. `--rekey-coleman` is never run against a state this block did not deliberately
establish.

That choice also sharpens the acceptance test: the derived key every row must arrive at is
exactly the key it started with, so a correct 1:1 rekey restores the baseline
`md5(id|source_record_id)` fingerprint **byte for byte**. The 1:1 claim is measured, not
inferred from a count.

| # | Test | State exercised | Expected |
|---|---|---|---|
| 1 | already-derived retry | untouched derived family | exit 0, *"Already rekeyed"*, no mutation reported, ownership unchanged |
| 2 | mixed ownership | one row legacy, 45 derived | **non-zero exit**, *"Mixed ownership state"*, nothing written |
| 3 | unbridgeable season | all legacy, two rows on one season | **non-zero exit**, *"carry more than one legacy row"*, whole transaction aborted |
| 4 | the transition | all 46 legacy | exit 0, 46 exact 1:1 mappings, every id preserved, baseline fingerprint restored |
| 5 | isolation | as above | non-Coleman `award_winners` byte-identical after both the rekey and the load |
| 6 | first derived load | 46 transitioned rows | **46 updated / 0 inserted / 0 deleted**; the unlinked row is adopted and linked |

Six design points:

1. **Every state transition happens in `beforeAll`, in one ordered choreography**, and each `it`
   asserts over a captured snapshot. A failing assertion therefore cannot strand `afldb_test`
   midway through a manufactured legacy state.
2. **`afterAll` restores by id, never by reloading.** Restoration must not depend on the loader
   the block is testing. It then proves the restoration twice — the fingerprint and the full
   ownership snapshot — and throws rather than asserts, so it still fires after a failure.
3. **The unlinked row is modelled.** One row is left `player_id NULL` / `implausible` in the
   legacy state, mirroring the measured 1982 Malcolm Blight row (§3.4). Test 4 requires the
   transition to leave it unlinked — it moves ownership without asserting a fact — and test 6
   requires the first derived load to adopt and link it **in place**, with its id unchanged.
4. **The isolation witnesses are created, not assumed.** A canonically rebuilt `afldb_test` need
   not contain any other award family, which would make an isolation assertion vacuous. The block
   inserts its own award carrying two witnesses: one owned by `draftguru` with a deliberately
   **legacy-Coleman-shaped key on a different award** (the transition scopes by `award_id`, so a
   key that merely looks like its own must survive verbatim), and one with manual/NULL
   provenance. Both are removed by `removeFixtureCorpus()`, which was extended rather than
   duplicated — one cleanup scheme still removes everything the ISSUE-111 fixtures create.
5. **The run-time zero is asserted.** Test 4 requires the preflight to print
   `Coleman player_link_resolutions rows 0`, because the first derived load rewrites
   `player_name_raw` and that is safe only while no human decision is attached.
6. **`46` is read from the contract, never written as a literal** — including the acceptance
   signal, which is cross-checked against `legacy_transition.first_load_expectation`.

`beforeAll` refuses, with a message naming the actual state, if the family is not exactly
`expected_rows` rows, if any row is not `afltables`-owned, or if any Coleman
`player_link_resolutions` row exists. Those are the three conditions that would make the
manufactured legacy state untestable rather than merely failing.

### 19.3 What pass 6 changed

- `tests/integration/awards-reload-links.test.ts` — one new describe (§19.2); `legacy_transition`
  added to the `ColemanContract` type; `removeFixtureCorpus()` extended with the isolation
  witnesses and their award. **No existing test, assertion or query was changed** — the pass-2/3/4/5
  blocks are byte-for-byte what passed 19 of 19.
- `issues/open/AFLDB-ISSUE-111.md` — this section; Status renumbered §19 → §20.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — validation state, pass-6 record and next prompt.

No loader, contract, rebuild stage, gate, migration, privilege file, manifest, `CHANGELOG.md`,
`issues.md`, `IssuesIndex.md` or ISSUE-110/112/113 material was touched, and no Git command was
run.

## 20. Pass 7 (2026-08-30) — the transition PASSED, and the decision-survival slice

### 20.1 The measured result — operator-run against `afldb_test`

`npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` with
`AFLDB_PYTHON=D:\dev\afldb-issue-102\.venv\Scripts\python.exe`:

- **1 test file passed; 25 ISSUE-111 tests passed, 0 failed**; 24 unrelated tests filtered out;
  21.15 s.
- Derived-load block **9 of 9** (G2 in 357 ms, G8 and G9 PASS); derivation-rule block **6 of 6**;
  G5a block **4 of 4** — all as measured in pass 6.
- **New legacy → derived transition block: 6 of 6 PASS.** An already-derived family verifies and
  no-ops; a mixed ownership state refuses without mutation; an unbridgeable season refuses and
  aborts the whole transaction; an all-legacy family rekeys exactly 1:1 with every
  `award_winners` surrogate id preserved; every other award family is untouched, including a
  deliberately legacy-Coleman-shaped key on a different award; and the first derived load
  reports exactly **46 updated / 0 inserted / 0 deleted**.
- **No `beforeAll` state refusal, no partial-mutation or fingerprint failure, and no `afterAll`
  restoration or ownership failure.** The transition choreography and its restoration are
  therefore proven against `afldb_test`.

**The one-time transition (§7.1) now carries runtime evidence**, so every rule in
`data/reference/coleman-derivation.json` — the `legacy_transition` block included — has been
measured. **Do not rerun or redesign the transition without new evidence.** It has still been
executed against no *real* legacy family: `afldb_dev` and production remain legacy-owned and
out of scope here.

### 20.2 The decision-survival slice — WRITTEN, unrun

§10's remaining test-matrix row is the manual-link half of the player-link audit: *a `linked`
and a `confirmed_unlinked` decision both survive a reload; the disagreement is reported.* Only
the no-decision half (Coleman `player_link_resolutions` count 0 before and after) was proven, in
pass 3.

This matters more for Coleman than for any other awards family. The derived loader is **born
linked**: it writes `player_id`, `link_status_value` **and** `player_name_raw` for every winner
from the canonical facts, so an admin decision on one of those rows is in direct competition
with the derivation on every reload. `import_coleman` passes `target_table="award_winners"` and
takes `reload_keyed`'s default `name_column="player_name_raw"`, so all three of that helper's
decision rules apply — but none of them had been measured through this loader.

A **fifth describe** was appended to `tests/integration/awards-reload-links.test.ts`:
**`Coleman derived reload preserves human link decisions (AFLDB-ISSUE-111)`**, on the same
`canRunFixtureImporter` gate. Two real derived rows are returned to the review queue and decided
through the real admin path (`resolveLink` / `confirmUnlinked`, which lock an UNRESOLVED target
and refuse anything else — the AFLDB-ISSUE-044 pattern already in this file), then the loader is
run three times.

| # | Test | State exercised | Expected |
|---|---|---|---|
| 1 | `linked` decision | earliest-season row linked to a player the derivation does not name | exit 0, `coleman decisions preserved 2`, the admin's player kept, `46 updated / 0 inserted / 0 deleted`, the disagreement warned |
| 2 | `confirmed_unlinked` decision | latest-season row vetted as unlinked | the row stays `player_id NULL` under its own key, its own disagreement warned, and `listConfirmedUnlinked()` still names it |
| 3 | name guard | the decided row's `player_name_raw` no longer matches the derivation | **non-zero exit**, *"cannot survive"*, *"1 human identity decision(s)"*, and **no reload signal at all** — nothing was written |
| 4 | recovery | the name restored by id | exit 0 again, both decisions still standing, baseline fingerprint intact |

Five design points:

1. **Test 3 is the runtime evidence for a §7.1 safety claim.** The runbook states that the first
   derived load rewriting `player_name_raw` — for the 1982 row, from the legacy spelling to the
   canonical display name — is safe *only* because zero decisions exist, and that with one
   present the name guard would classify it discarded and abort. That was asserted from source
   reading; test 3 measures it, and test 4 measures the recovery.
2. **The decisions must contradict the derivation.** The admin player is chosen at run time as a
   real player the derivation names for neither row, so the disagreement warnings are genuinely
   provoked rather than incidentally satisfied.
3. **Every state change happens in `beforeAll`**, and `afterAll` deletes the fixture decisions
   **first** — while one exists, every other Coleman block's guard refuses and a reload would
   keep re-applying it — then restores the three columns this block can move **by id**, and
   throws unless the fingerprint, the full link/name snapshot and the decision count all come
   back. The fixture admin is a dedicated `auth_users` row (the AFLDB-ISSUE-074 trap), and its
   decisions are deleted on entry as well as on exit.
4. **`beforeAll` refuses rather than adapts**, naming the actual state, if the family is not
   exactly `expected_rows` rows, if any row is not `afltables`-owned, if any Coleman decision it
   did not record exists, or if either chosen row is not in the born-linked derived state
   (`player_id` set, `resolved`, `player_name_raw = players.display_name`).
5. **Isolation is asserted, not assumed:** exactly the two decided rows differ from the derived
   baseline after the reload, and the fingerprint is unchanged throughout, so honouring a
   decision moves no surrogate id and perturbs no other row.

### 20.3 What pass 7 changed

- `tests/integration/awards-reload-links.test.ts` — one new describe and its two fixture
  constants, appended (§20.2). **No existing test, helper, assertion, query or cleanup function
  was changed** — the pass-2/3/4/5/6 blocks are byte-for-byte what passed 25 of 25.
- `issues/open/AFLDB-ISSUE-111.md` — this section; Status renumbered §20 → §21.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — validation state, pass-7 record and next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and next action only.

No loader, contract, rebuild stage, gate, migration, privilege file, manifest, `CHANGELOG.md`,
`issues.md` or ISSUE-110/112/113 material was touched, and no Git command was run.

## 21. Pass 8 (2026-08-30) — the decision block PASSED, and G7 readiness

### 21.1 The measured result — operator-run against `afldb_test`

`npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` with
`AFLDB_PYTHON=D:\dev\afldb-issue-102\.venv\Scripts\python.exe`:

- **1 test file passed; 29 ISSUE-111 tests passed, 0 failed**; 24 unrelated tests filtered out;
  24.19 s.
- Derived-load block **9 of 9** (G2 oracle **328 ms**, G8 PASS, G9 PASS); synthetic
  derivation-rule block **6 of 6**; G5a durable-identity block **4 of 4**; legacy → derived
  transition block **6 of 6** — all unchanged from pass 7.
- **New decision-survival block: 4 of 4 PASS.** An admin `linked` decision survives the derived
  reload; a `confirmed_unlinked` decision survives it; the loader reports both disagreements
  rather than overwriting the human decisions; the reload **refuses** when a decided row no
  longer carries the derived name; and once the name is restored the reload succeeds with both
  decisions still standing.
- **No `beforeAll` state refusal**, and **no `afterAll` cleanup, fingerprint or
  decision-count failure** — so the two fixture `player_link_resolutions` rows, the fixture
  `auth_users` admin and the three rewritten columns on two real Coleman rows all came back.

**§10's manual-link test-matrix row (§7 handoff item 16) is therefore CLOSED.** Both halves of
the player-link audit now carry runtime evidence: the no-decision regression (pass 3) and the
manual-link survival, disagreement reporting, name-guard refusal and recovery (this pass).

Most importantly, **the derived loader does not reintroduce the AFLDB-ISSUE-044 regression**
even though it is born linked — it writes `player_id`, `link_status_value` and
`player_name_raw` for every winner and still yields to a recorded human decision — and the
§7.1 `player_name_raw` safety claim about the 1982 Malcolm Blight row is no longer a
source-reading assertion: the name guard was measured firing, and measured recovering.

### 21.2 G7 readiness — verified in source this pass, no command run

Item 17, the canonical rebuild, is the next slice. It is the first ISSUE-111 execution of two
code paths that no test has reached, so its inputs were re-verified directly rather than
assumed:

| Verified | Where | Result |
|---|---|---|
| The Coleman stage exists, is `kind: 'data'`, and runs `--groups coleman` with `dataEnv` | `tools/db/rebuild-test.ts:470-483` | argv is **byte-identical** to `runColeman()`'s proven invocation (`tests/integration/awards-reload-links.test.ts:1476`) |
| Stage order | same | `… fitzroy → draftguru → derived → **coleman** → ladder-witness → fingerprints`; after `derived` as deviation (b) requires, so `seasons.status` is computed before it is read |
| The gates are appended, never ahead of their data source | `:689-692` | `colemanChecks(Number(measured.seasons_last))` inside `finalValidationChecks()` |
| The declared span the gates expect | `:735` + `data/reference/fitzroy-accepted-baselines.json:118` | `seasons_last = 2025`, `first_season = 1980` → `span = 46`. So `coleman_rows = 46`, `coleman_seasons = 46`, `coleman_first_season = 1980`, and the four zero-gates |
| The rebuild honours `AFLDB_PYTHON` | `:389-394`, `:1066-1075` | override, else `.venv\Scripts\python.exe` on win32; a missing interpreter refuses **before** anything is destroyed |
| The create-if-missing award definition is schema-legal | `tools/migration/import_awards.py:1143-1175`, `src/db/migrations/005_brownlow_awards.sql:63-75` | `AWARD_DESCRIPTIONS["coleman"]` exists (`:317`); `category = 'award'` satisfies `awards_category_ck`; `first_season`/`last_season` reference `seasons(year)`, which the derived seasons supply |

Two facts about the rebuild that follow from this, and that the run will measure:

1. **`planStages()` has no awards stage at all.** A canonically rebuilt `afldb_test` holds no
   legacy award family, which is exactly why the pass-6 transition block had to create its own
   isolation witnesses (§19.2). So the Coleman stage runs against an empty `awards` table and
   `coleman_award_id()`'s **create-if-missing** branch — deviation (a) — is what supplies the
   parent row. G7 is the acceptance test for that branch.
2. **The gates are all-or-nothing scalars.** A 45-row result would mean `seasons.status` for
   2025 came back `in_progress` from `rebuild_derived.py`'s `season_metadata`, not that the
   derivation is wrong — the completed-season rule would have worked exactly as declared. Report
   the gate output rather than relaxing the expectation.

### 21.3 What pass 8 changed

- `issues/open/AFLDB-ISSUE-111.md` — this section; Status renumbered §21 → §22.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — validation state, pass-8 record, G7 slice and next
  prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and next action only.

**No source or test file was changed in pass 8**, and no loader, contract, rebuild stage, gate,
migration, privilege file, manifest, `CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material
was touched. No Git command was run.

## 22. Pass 9 (2026-08-30) — the G7 rebuild REFUSED in preflight; cause is NOT ISSUE-111

### 22.1 What happened

The operator ran the §5 command with `AFLDB_PYTHON=D:\dev\afldb-issue-102\.venv\Scripts\python.exe`:

```
npm run db:test:rebuild -- --acknowledge-destroy afldb_test
```

It printed the banner (`target afldb_test`, `fitzRoy label full-history-20260827`,
`draftguru annual-html-20260826`) and then refused:

```
ERROR: snapshot file missing:
  D:\dev\afldb-issue-102\data\sources\afltables\fitzroy_core\full-history-20260827\player_stats_1897.csv
REFUSED: fitzRoy preflight failed. Nothing has been destroyed.
```

**Classification: rebuild-environment prerequisite, not an ISSUE-111 defect.** The refusal is
raised by `tools/migration/import_fitzroy_core.py:930-932` inside `validate_snapshot()`, called
from `runPreflight()` (`tools/db/rebuild-test.ts:1077-1084`) — **before**
`assertDestructiveAcknowledgement()` and before the reset stage. `afldb_test` was not destroyed,
no stage ran, and the Coleman stage (`:470-483`) was never reached. **No Coleman code, contract,
gate or test is implicated, and none was changed.** The interpreter override worked: the
`resolvePython()` guard at `:1066-1075` passed, so Python was found and the failure is about data.

### 22.2 Root cause, from source

`data/sources/` **does not exist in this worktree at all** — `data/` holds only the tracked files
(`data/awards/22-under-22.csv`, `data/records/first-kick-goal-ids.csv`, `data/reference/*.json`).
That is by design, not by damage:

- `.gitignore:37-48` ignores `/data/*` and re-admits only `data/reference/*.json` and the two
  curated CSVs. **Raw acquired snapshots are never tracked**, and
  `tools/rebuild/fitzroy/validate_ladder_witness.py:163-170` says so in its own refusal text:
  *"Raw snapshots are deliberately gitignored (ISSUE-093 convention)"*.
- A `git worktree` checkout therefore starts with **no snapshot bytes** — the same class of gap as
  the missing `.venv` that `AFLDB_PYTHON` exists to cover (`tools/db/rebuild-test.ts:373-388`).
- Every ISSUE-111 pass so far (2–8) ran the awards importer against an **already-populated**
  `afldb_test`. Nothing in passes 1–8 ever needed a snapshot, which is why this surfaced only at G7.

### 22.3 What the accepted snapshot is, and where it is declared

| Question | Answer | Source |
|---|---|---|
| Where `full-history-20260827` is accepted | `baselines[0].acceptance_status = "accepted"` under `selection_policy.rule = "exactly_one_accepted"` | `data/reference/fitzroy-accepted-baselines.json:25-64` |
| Expected directory | `data/sources/afltables/fitzroy_core/full-history-20260827` | same, `snapshot_dir` (`:64`); `SNAPSHOT_ROOT`, `import_fitzroy_core.py:87` |
| Expected contents | **131 files**, 719,042 rows, datasets `player_stats`, `player_details`, `results`, 1897–2025 | `:81-99`; per-file list in `docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260827.json` |
| Tracked or acquired | **acquired, never tracked**; only the manifest is tracked | `.gitignore:37-48` |
| How it is produced | `tools/rebuild/fitzroy/acquire_core.R --acquire --label <label>` (R + fitzRoy 1.8.0 pinned) | register `:70-73`; `acquire_core.R:52` |

**Two further preflight inputs are missing for the same reason**, and fixing only the fitzRoy one
would just move the refusal:

1. **Ladder witness** `ladder-20260828`, **129 files**, expected at
   `data/sources/afltables/fitzroy_core/ladder-20260828` —
   `tools/rebuild/fitzroy/fitzroy-contract.json:239-244`, checked by `runPreflight()` at
   `tools/db/rebuild-test.ts:1106-1113`.
2. **DraftGuru** `annual-html-20260826`, expected under `data/sources/draftguru/<label>/`
   (`raw/years/`, `http/years/`) — `tools/rebuild/draftguru/draftguru-contract.json:102`,
   `parse_draft_snapshot.py:405-421`; checked by the `--validate-only` preflight
   (`tools/db/rebuild-test.ts:1092-1098`), which must report **42 year pages, 5057 persons,
   6810 picks** (`DRAFTGURU_EXPECTED`, `:554-575`).

### 22.4 Provenance / integrity checks that must hold before any candidate bytes are used

Nothing may be "made to fit". The chain, all re-derived at validate time:

1. `manifest_sha256` — the acquisition manifest byte-for-byte
   (`a42c6d5f…21d09`, register `:68`; enforced `import_fitzroy_core.py:549-550`).
2. `artefact_set_sha256` — sha256 over sorted `'<filename> <sha256> <row_count>\n'` from the
   manifest's `files[]` (`8e14ce61…4125`, register `:84`; enforced `:555-556`).
3. **Per file**: presence, sha256 against the manifest entry, exact CSV column list, exact row
   count (`:930-947`).
4. The full-history gates and the identity scan, re-derived from the artefacts
   (`--require-accepted-baseline` implies `--require-full-history`, `:2681`).
5. The ladder witness manifest is bound the same way (`manifest_sha256`, contract `:243`) with
   per-file sha256 (`validate_ladder_witness.py:179-185`). **The literal recorded there,
   `70cc1776…8b6df`, is STALE — see §26.** The tracked manifest's canonical LF bytes hash to
   `604a8a16…8d3f`; `70cc1776…8b6df` is the SHA-256 of the same content with CRLF endings.

So a copy from another local checkout is safe **iff** the validators pass on the copied bytes; a
partial or edited copy fails closed rather than corrupting a rebuild.

### 22.5 State after the refusal

- `afldb_test` **untouched** by this attempt — it still holds the pass-8 derived Coleman family.
- `afldb_dev` and production **not contacted**.
- **No repository file changed** except this record and the handoff. No Coleman semantics touched.
- **G7 remains unrun and unblocked-by-design**: the blocker is missing local snapshot material.

## 24. Pass 10 (2026-08-30) — the snapshot prerequisite, from source. NO command run by Claude

Pass 10 wrote no code, ran no command, copied/acquired/deleted no snapshot byte and contacted no
database. It answers, from tracked source alone, what §22 left open: how each missing snapshot is
produced, what proves a candidate copy canonical, and why the DraftGuru directory holds 90 files.

### 24.1 The operator's read-only inventory (§5 Step 1), as reported

| Snapshot | `D:\dev\afldb-issue-102` | `D:\dev\afldb` | Manifest expectation |
|---|---|---|---|
| fitzRoy `full-history-20260827` | ABSENT | **PRESENT, 131 files** | 131 files |
| ladder `ladder-20260828` | ABSENT | **ABSENT** | 129 files |
| DraftGuru `annual-html-20260826` | ABSENT | **PRESENT, 90 files** | 42 **year pages** — see §24.4 |

FitzRoy probe `player_stats_1897.csv` = `79f7c8a2…1ef93`, **equal** to the manifest entry.

**The ladder witness is absent from both checkouts, so copying the other two cannot make the
rebuild runnable.** It is a hard preflight gate (`rebuild-test.ts:1106-1113`), run before the
destructive stage and after the DraftGuru gate.

### 24.2 How `ladder-20260828` is produced — and why the printed re-acquire command cannot run

- Adapter `tools/rebuild/fitzroy/acquire_core.R`, R with **fitzRoy 1.8.0 pinned** (manifest
  `fitzroy_version_pinned`, `fitzroy_version_match: true`).
- One call per season — `fitzRoy::fetch_ladder_afltables(season = s)` — written as
  `ladder_<season>.csv` (`acquire_core.R:322-341`); 129 seasons 1897–2025, 1,622 rows.
- Nominal command (`validate_ladder_witness.py:168-170`, `rebuild-test.ts:1111`):
  `Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label ladder-20260828 --datasets ladder --from 1897 --to 2025`
- **That command REFUSES as written.** `acquire_core.R:195-199` aborts when
  `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json` already exists — snapshot
  immutability, runbook §4 — and that manifest is **tracked and present**. So a re-acquisition
  must run under a **new label**, and the resulting bytes are only usable if they hash to the
  tracked `ladder-20260828` manifest, file by file. The refusal text in both call sites is
  therefore incomplete guidance, not a runnable recovery. *(Recorded, deliberately not "fixed":
  editing it is outside ISSUE-111's scope.)*
- The witness is `LOCALLY_COMPUTED` by fitzRoy from `fetch_results_afltables`
  (`fitzroy-contract.json` `datasets.ladder.provenance`). Its whole value is that a **second
  toolchain** reproduces AFLDB's home-and-away set. **Never regenerate it from AFLDB's own
  `results.csv` or from `matches`** — that would both fail the hashes and destroy the
  independence the gate exists for.
- The eight ladder columns carry **no `date_accessed` or timestamp** (manifest `columns`;
  `validate_ladder_witness.py:56-57`), so for completed seasons a fresh acquisition *can* be
  byte-identical. That is a reason re-acquisition is worth attempting — never a reason to assume
  it succeeded.

### 24.3 What proves a recovered/acquired ladder copy canonical

- Tracked manifest `docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json`, bound
  byte-for-byte by `datasets.ladder.accepted_witness.manifest_sha256`
  (`fitzroy-contract.json:239-249`): files **129**, rows **1622**, acquired 2026-08-28.
  **The recorded literal `70cc1776…8b6df` is the pre-ISSUE-108 CRLF hash and no longer matches
  the tracked bytes, which hash `604a8a16…8d3f` — §26. `validate_ladder_witness.py` check 1.3
  therefore FAILS today regardless of the ladder bytes, and must be repaired in the contract
  before Step 3 can pass.**
- **The one validator:** `tools/rebuild/fitzroy/validate_ladder_witness.py --label ladder-20260828`
  — the contract's own `validator` field, and the exact argv the rebuild re-runs
  (`rebuild-test.ts:1117-1120`). Offline: no database, no network. 26 checks (ISSUE-095 §13.7).
- It proves, re-derived every run: the witness role binding and label; the manifest's own sha256;
  manifest shape (`mode: acquire`, ladder only, 129 files, 1,622 rows); then **per file** —
  presence, sha256 against the manifest, the exact eight-column header, row count, `Season` echo,
  non-blank and unique `Team`, complete unique `Ladder.Position`, and `Percentage` equal to
  `Score.For/Score.Against`; then coverage exactly 1897–2025 with no duplicate season and 1,622
  rows total; then that **every (label, season) resolves through the real `ClubResolver`** to one
  era-correct AFLDB identity with no collisions.
- Missing bytes are the explicit fail-closed case: `WitnessError`, exit **2**
  (`validate_ladder_witness.py:161-170`).
- Cheap probe for any candidate directory: `ladder_1897.csv`, 8 rows, sha256
  `0470c6e59a615ea145b49290396ab7f3973f552a7ac82fe25c1ccd6c85817df1`.
- `import_fitzroy_core.py --require-full-history` must **never** be pointed at this label
  (contract `not_validated_by`); doing so manufactures a false failure.

### 24.4 DraftGuru — 90 files is EXPECTED; "42 year pages" is a different count

"42 year pages" is the count of **raw year pages**, i.e. `manifest.source_urls` (42 entries, one
per `expected_years`; 1983–1985 are declared no-draft gaps). It is printed by
`import_draftguru.py:921` as `42 year pages, sha256 verified` and asserted by
`assertDraftguruPreflight` (`rebuild-test.ts:554-575`). It was never a directory file count.

The accepted snapshot directory is expected to hold, from its own writers:

| Files | What | Written by |
|---|---|---|
| 42 | `raw/years/year_<YYYY>.html` — the hashed anchor | `acquire_draft.py:209-221` |
| 42 | `http/years/year_<YYYY>.json` — per-request record, read for charset/content-type | `acquire_draft.py:210-223`, `parse_draft_snapshot.py:438-439` |
| 2 | `http/robots.txt`, `http/robots_txt.json` | `acquire_draft.py:186-187` |
| 4 | `parsed/rows.jsonl`, `parsed/persons.jsonl`, `parsed/schema.json`, `parsed/trade_column_profile.json` | `parse_draft_snapshot.py:825-864` |
| **90** | **total** | |

**42 + 42 + 2 + 4 = 90 — exactly the observed count.** Only the 42 raw pages are hash-bound;
`parsed/*` is explicitly untrusted (`import_draftguru.py:211-212`) and the tested parser re-runs
over the raw bytes on every validate. The count is consistent with the accepted snapshot and is
**not** evidence of contamination — but it is consistency, not proof: the proof is §24.5.

### 24.5 Safety of copying the two present snapshots — structural, not a judgement call

Copying is safe **because adjudication is re-derived from this worktree's tracked contracts**, and
every check fails closed before anything is destroyed. `data/sources/**` is untracked
(`.gitignore:37-48`), so a copy changes nothing Git sees and contacts no database.

- **DraftGuru** — `import_draftguru.py --validate-only` (`rebuild-test.ts:548-551`) checks the
  manifest label/`import_capable`/`total_rows 6810`/`distinct_player_url_count 5057`, then the
  sha256 of **all 42** raw pages, then re-parses and re-validates identity. Copy the **whole**
  `annual-html-20260826` directory: `http/years/` is read during parsing, and `discover_years`
  **refuses** any file in `raw/years/` that is not `year_<YYYY>.html` or whose year is outside
  `expected_years` (`parse_draft_snapshot.py:417-435`) — so a partial or polluted copy refuses
  rather than passing quietly. Do **not** copy the other DraftGuru labels; the frozen CSV export
  label is explicitly refused as a snapshot (`parse_draft_snapshot.py:408-411`).
- **fitzRoy** — the matching probe hash proves **1 of 131 files** and nothing else. The proof is
  `import_fitzroy_core.py --label full-history-20260827 --validate-only --require-accepted-baseline`,
  which re-derives `manifest_sha256` (`a42c6d5f…21d09`), `artefact_set_sha256` (`8e14ce61…4125`,
  over sorted `'<filename> <sha256> <row_count>\n'`), then per file presence, sha256, exact column
  list and exact row count for all 131, then the full-history gates and identity scan
  (`--require-accepted-baseline` implies `--require-full-history`).

### 24.6 Where else the ladder bytes could be — from repository evidence only

- The **only** documented location is `data/sources/afltables/fitzroy_core/<label>/`
  (`validate_ladder_witness.py:53`, manifest `working_directory`). No cache, mirror, archive or
  backup location is documented anywhere in the repository, and `.gitignore:37-48` guarantees the
  bytes are in **no** Git history — so there is no `git`-based recovery.
- ISSUE-095 §13 records that the witness **was acquired on this machine on 2026-08-28** (129
  files, 1,622 rows, zero fetch failures), and §13.7 records the durability gate exercised by
  **moving the bytes aside and restoring them** (exit 2 absent → 0 restored). A local copy
  therefore existed; the issue records no filesystem path, and ISSUE-095 need not have run in
  `D:\dev\afldb`.
- Untried search space, in priority order: **other sibling working directories/worktrees under
  `D:\dev`**, and any **moved-aside or renamed** copy — found by the artefact name
  `ladder_1897.csv` rather than by directory name. That is the next action (§24.7).
- Claude did not and will not scan outside the repository boundary (CLAUDE.md §2); this is an
  operator command.

### 24.7 Decision tree for the next step

1. A `ladder_1897.csv` is found whose sha256 is `0470c6e5…7df1` → that directory is a canonical
   candidate. Operator copies all three snapshots into the worktree, then §5 Step 3's three
   offline validators must exit 0.
2. Found but the hash differs → it is a **different acquisition**, not the accepted witness. It
   may still be adjudicated file-by-file against the tracked manifest, but it is not assumed.
3. Nothing found → the accepted bytes do not exist locally. G7 is then blocked on a **network
   re-acquisition under a new label** plus hash adjudication against the tracked manifest — an
   operator decision outside ISSUE-111's authorised scope. **Do not** weaken the preflight, skip
   the witness gate, or synthesise the witness from AFLDB data.

### 24.8 State after pass 10

- `afldb_test`, `afldb_dev` and production: **not contacted**. No Git command run. No snapshot
  byte copied, acquired or deleted. No Coleman code, contract, gate or test touched.
- Repository files changed: this record, the handoff, `IssuesIndex.md`.

## 25. Pass 11 (2026-08-30) — the ladder reacquisition and adjudication procedure. NO command run by Claude

Pass 11 ran no command, acquired nothing, copied no byte and mutated no database. It records the
operator's §5 Step 1b result and designs — from source only — the exact safe procedure that could
return the accepted ladder witness bytes.

### 25.1 The operator's Step 1b result — outcome 3 of the §24.7 decision tree

Read-only local snapshot search, run by the operator:

| Probe | Result |
|---|---|
| `ladder_1897.csv` anywhere under `D:\dev` and `D:\backups` | **NONE FOUND** |
| any directory named `ladder*` under those roots | **NONE FOUND** |
| an alternate accepted ladder snapshot in another `D:\dev` worktree | **NONE FOUND** |
| DraftGuru `annual-html-20260826` decomposition in `D:\dev\afldb` | `raw/years` 42, `http/years` 42, `http` root 2, `parsed` 4 = **90**, **no `raw/years` strays** |
| fitzRoy `full-history-20260827` in `D:\dev\afldb` | present, 131 files, `player_stats_1897.csv` sha256 matching the tracked manifest |

**The accepted ladder-witness bytes are not available in the searched local locations**, so §24.7
outcome 3 holds. The DraftGuru directory is exactly the expected 42 + 42 + 2 + 4 layout (§24.4) and
is **not** anomalous; both present snapshots remain safe to copy under §24.5.

**Classification, unchanged:** the canonical rebuild (G7) is blocked **solely** because the accepted
ladder witness bytes are unavailable locally. Nothing ISSUE-111 owns is implicated. **Do not weaken
or bypass the ladder witness gate** (`rebuild-test.ts:1106-1113`).

### 25.2 The exact acquisition command — a NEW label, mandatory

```
cd D:\dev\afldb-issue-102
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label ladder-recover-20260830 --datasets ladder --from 1897 --to 2025
```

Every element is required, and each has a source reason:

- **Run from the repository root.** `acquire_core.R:57-59` refuses when
  `tools/rebuild/fitzroy/fitzroy-contract.json` is not resolvable from the working directory, and
  `WORKING_ROOT`/`MANIFEST_ROOT` (`:52-53`) are repo-relative.
- **A NEW label.** `:195-199` stops when `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`
  already exists — snapshot immutability — and `ladder-20260828.json` is tracked and present. The
  re-acquire command printed by `validate_ladder_witness.py:168-170` and `rebuild-test.ts:1111`
  therefore **cannot run as written** (§24.2). The label must match `^[A-Za-z0-9._-]+$` (`:192`).
- **`--datasets ladder`.** This makes the run *witness-only* (`is_witness`/`witness_only`,
  `:367-368`), so the season accounting counts the witness's own files rather than `player_stats`
  files, `acquisition_kind` is recorded as `validation_witness` (`:471-477`) and `verdict_authority`
  points at `validate_ladder_witness.py` (`:483-484`). Acquiring any other dataset under this label
  would make it a core snapshot and change the accounting.
- **`--to 2025` is not optional.** `--to` defaults to the current year (`:206`), which is **2026** —
  that would fetch a 130th season, write `ladder_2026.csv` for an in-progress season, and produce a
  directory the accepted manifest does not describe. `--from` defaults to 1897 (`:205`); state it
  anyway.
- **Never `--allow-version-mismatch`** (`:70`, `:83-87`). The recovery's whole premise is
  byte-identity with a fitzRoy 1.8.0 acquisition.

### 25.3 Prerequisites — R and packages, all fail-closed

| Requirement | Where | Behaviour if missing |
|---|---|---|
| `Rscript` on `PATH` | — | nothing runs |
| **fitzRoy exactly `1.8.0`** | `fitzroy-contract.json:186` `pinned_version`; `acquire_core.R:76-87` | `stop()` **before** any fetch, unless `--allow-version-mismatch` (do not pass it) |
| fitzRoy attachable via `library()` | `:45-48` | namespace-only calls fail with `object 'dictionary_afltables' not found` — the reason the script attaches it |
| `jsonlite` | `:40`, `:43` | `stop()` at load, before anything |
| **`digest` or `openssl`** | `:94-101` | `stop()` at the **first file hash** — after 129 network fetches and 129 written CSVs, with no manifest. The one expensive failure mode. |

The recorded environment for every fitzRoy acquisition in this repository is **R 4.6.1**
(`data/reference/source-families.json:371`; `docs/acquisition/AFLDB-2026-API-ACQUISITION.md:785,951`).
The contract pins **fitzRoy**, not R, so R 4.6.1 is corroborating context rather than a gate.

### 25.4 Blast radius — network and `data/sources` only, plus one manifest

- **No database access of any kind.** The script's header states it (`:4-5`), and it contains no
  DSN, no driver call and no `AFLDB_*` read. It needs no Python, no `psql` and no `.venv`.
- **Network:** `fitzRoy::fetch_ladder_afltables(season = s)` once per season — 129 calls
  (`:333-341`). Under pinned fitzRoy 1.8.0 each of those internally calls `fetch_results_afltables`
  against AFL Tables (`fitzroy-contract.json` `datasets.ladder.provenance`).
- **Writes 129 CSVs** into `data/sources/afltables/fitzroy_core/ladder-recover-20260830/`, which is
  untracked (`.gitignore:37-48`).
- **Writes exactly one repository-visible file:**
  `docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json` (`:195`, written last
  at `:490`). It appears as a new untracked file in `git status` and **must be deleted after
  adjudication** — it is not an accepted baseline, and while it exists that label can never be
  re-acquired (`:196-199`).
- It touches no accepted label, no contract, not the tracked ladder manifest, and no Coleman file.

### 25.5 Expected output shape

- 129 `wrote data/sources/afltables/fitzroy_core/ladder-recover-20260830/ladder_<season>.csv (N rows)`
  lines, one per season **1897–2025 inclusive**.
- A zero-row season aborts (`:340`); a fetch failure aborts **before** any manifest is written
  (`:336-337`), and because immutability is anchored on the manifest (`:200-204`) the same label may
  simply be retried.
- Closing lines: `acquisition kind: validation_witness (ladder)` and
  **`Acquisition complete: 129 file(s); 1622 total rows.`**
- `observations not satisfied:` should list nothing — witness-only accounting sets the required range
  to the requested range (`:376-393`).

The target shape is the contract's own: **129 seasons, 1897–2025, 1,622 rows**
(`fitzroy-contract.json` `datasets.ladder.coverage`, and `accepted_witness.files/rows` at `:239-244`).

### 25.6 Adjudication — against the TRACKED manifest, before anything is moved

The adjudication target is `docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json`
(129 `files[]` entries, each `{dataset, filename, row_count, sha256, columns}`), whose own sha256 is
`604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f` as tracked.
**`fitzroy-contract.json:243` still records `70cc1776…8b6df`, the CRLF-ending hash of the same
content — stale, see §26.** The 129 per-file `sha256` entries are unaffected: they hash gitignored
raw CSVs, which Git never end-of-line translates.

**The rule.** For every one of the 129 manifest entries, the temporary directory must hold that exact
filename and its sha256 must equal the manifest's. The directory must hold **no** file the manifest
does not list. Byte equality subsumes row count and header; both are independently re-derived by the
canonical validator afterwards (`validate_ladder_witness.py:228-241`, plus the `Season` echo, unique
non-blank `Team`, complete unique `Ladder.Position` and the `Percentage` recomputation).

**Acceptance is 129 present / 129 sha256-equal / 0 mismatched / 0 unexpected. Nothing less.**

**Do NOT adjudicate by pointing `validate_ladder_witness.py --label ladder-recover-20260830` at it.**
`load_witness` derives the manifest as `<manifest_dir>/<label>.json` (`:118`) and then checks that
the label is the one the contract accepts (`:137-139`) and that the manifest matches
`accepted_witness.manifest_sha256` (`:142-144`) — a temporary label fails both **by construction**
(exit 1). The `--contract` / `--manifest-dir` overrides (`:359-382`) exist so an ISSUE-101
**successor** witness can be proven against a *temporary successor contract*; using them here would
be adjudicating a candidate against a contract written to fit it. Not authorised under ISSUE-111.

**The fresh manifest will legitimately differ from the tracked one, and that is not evidence about
the bytes.** It carries a new `extraction_date` / `extraction_timestamp_utc` (`acquire_core.R:153-154`),
and `ladder-20260828.json` predates the ISSUE-095 witness-only accounting repair (`:356-368`): the
tracked file records `datasets_complete: false`, `seasons_complete: false`, numeric
`identity_observations`, the **core** `verdict_authority` and no `acquisition_kind` at all, whereas a
fresh witness-only run records `acquisition_kind: validation_witness`,
`identity_observations: "not_applicable"`, the witness verdict authority and both observations true.
**Only the 129 CSV hashes are the adjudication.** Never compare, edit, replace or regenerate the
tracked manifest.

The eight ladder columns carry **no timestamp**, so a fresh acquisition of completed seasons *can*
be byte-identical (§24.3). That is a reason to try, never a reason to assume.

### 25.7 The only outcome that permits the bytes to become canonical

All 129 filenames present, all 129 sha256 equal, no extra file. Then, in order:

1. the operator renames (or copies) `…/fitzroy_core/ladder-recover-20260830` →
   `…/fitzroy_core/ladder-20260828` — the one path the validator and the rebuild read
   (`validate_ladder_witness.py:53,161`);
2. the operator deletes
   `docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json`;
3. `validate_ladder_witness.py --label ladder-20260828` exits **0** with `All checks passed.` and
   **26 PASS** lines. That is the canonicity proof, and it is the exact argv the rebuild re-runs
   (`rebuild-test.ts:1117-1120`), so nothing is taken on trust.

Nothing else confers canonicity. Do not edit the contract, the tracked manifest,
`accepted_witness.manifest_sha256` or `ladderWitnessLabel()`.

### 25.8 If even ONE file differs — fail closed

The bytes are then a **different acquisition**, not the accepted witness. That is a real possibility:
fitzRoy recomputes the ladder from `fetch_results_afltables`, so a single corrected historical score
upstream changes one season's CSV.

Required response — all of it:

- **Do not** move the directory into `ladder-20260828`.
- **Do not** update `accepted_witness` (`snapshot_label`, `manifest_sha256`, `files`, `rows`), and
  **do not** regenerate or hand-edit `ladder-20260828.json`. The manifest hash exists precisely so
  the per-file list cannot be edited to cover for different bytes (`fitzroy-contract.json`
  `accepted_witness.$comment`); updating the accepted manifest to accommodate fresh upstream bytes
  would destroy the durability gate ISSUE-095 built.
- **Do not** re-point `ladderWitnessLabel()`, pass `--contract`/`--manifest-dir` to make it validate,
  or relax the rebuild's witness preflight.
- **Do not** synthesise the witness from AFLDB's own `results.csv` or `matches` — it is an
  independent second-toolchain witness and that would destroy the only property it has (§24.3).
- Delete the temporary directory and its manifest so nothing unadjudicated sits in the snapshot root,
  and report the exact list of differing filenames.

Adopting a **successor** witness is ISSUE-101's documented procedure, an operator decision outside
ISSUE-111's scope, and it would also re-open the D7 `--compare` cross-check against a rebuilt
database. Partial recovery does not exist: the preflight validates all 129 files.

### 25.9 After recovery — unchanged

The three offline validators of handoff §5 Step 3 (fitzRoy accepted baseline, ladder witness,
DraftGuru `--validate-only`), all three exiting 0 with DraftGuru reporting 42 year pages, 5057
persons and 6810 picks, and only then
`npm run db:test:rebuild -- --acknowledge-destroy afldb_test`.

### 25.10 Yes — run the local R/fitzRoy preflight before any network acquisition

It costs one offline command and no network, and it is the cheapest place to catch the one expensive
failure mode. Ranked by what each missing prerequisite actually costs:

- `digest` and `openssl` both absent → **129 network fetches, 129 CSVs written, then `stop()` on the
  first hash and no manifest** (`acquire_core.R:100`). Only a preflight catches this before the
  network work.
- fitzRoy ≠ 1.8.0 → `stop()` before any fetch (`:79-87`) — cheap, but it is better known before the
  operator commits to an acquisition.
- `jsonlite` absent or `Rscript` absent → immediate, obvious.

The same preflight also confirms the adjudication target is intact in this worktree
(`ladder-20260828.json` sha256 = **`604a8a16…8d3f`**, the canonical LF hash — the `70cc1776…8b6df`
expectation printed by the pass-11 preflight was the CRLF hash and was wrong; §26) and that the
temporary label is free.

### 25.11 State after pass 11

- `afldb_test`, `afldb_dev` and production: **not contacted**. No Git command run. No snapshot byte
  acquired, copied, generated or deleted. No Coleman code, contract, gate or test touched. No
  acquisition performed.
- Repository files changed: this record, the handoff, `IssuesIndex.md`.

## 26. Pass 12 — the Step 1c preflight FAILED; both discrepancies adjudicated

Pass 12 mutated no database, acquired/copied/deleted no snapshot byte, ran no Git command and
changed no Coleman source, contract, gate or test. The operator ran handoff §5 **Step 1c** offline
and it **failed on both of its prerequisite legs**. This section resolves both.

### 26.1 The operator's measured result

| Leg | Result |
|---|---|
| `Rscript` on `PATH` | resolves — `C:\Program Files\R\R-4.6.1\bin\Rscript` |
| package/version probe | **`Segmentation fault`** — fitzRoy / jsonlite / digest / openssl versions NOT established |
| tracked manifest hash | computed `604a8a16…8d3f`, expected `70cc1776…8b6df` — **MISMATCH** |
| snapshot working area | `data/sources/afltables/fitzroy_core` absent (unchanged, expected) |
| temp label `ladder-recover-20260830` | free |

**No acquisition was attempted, and none may be until both legs are cleared.**

### 26.2 Discrepancy 1 — RESOLVED: the manifest is intact; the CONTRACT literal is stale

**Proven, not inferred.** The tracked manifest as checked out here is LF-only and hashes
`604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`. Re-encoding **that same
content** with CRLF endings — changing nothing but line terminators, 53,915 bytes → 56,284 bytes,
one extra `\r` per line for 2,369 lines — hashes
`70cc17768685a3140a428d3eef796bf465ae2fd9dca71a66684f248cdde8b6df`, **exactly** the contract's
recorded value. The two hashes are the LF and CRLF renderings of one identical document.

Therefore:

- **The manifest content is unchanged since acquisition on 2026-08-28.** It is not corrupt, not
  truncated, and was **not** altered by any later ISSUE-095 or ISSUE-101 accounting repair — a
  content change could not preserve a CRLF-round-trip identity.
- **`604a8a16…8d3f` is the current authoritative tracked hash**, and is what
  `datasets.ladder.accepted_witness.manifest_sha256` should record.
- **`70cc1776…8b6df` came from `fitzroy-contract.json:243`**, recorded on 2026-08-28 when the
  file existed locally with CRLF endings — consistent with ISSUE-095 §13.7's
  `validate_ladder_witness.py --label ladder-20260828` → **26/26 PASS** on that date, which
  requires `sha256_bytes()` of the on-disk file to have been `70cc…` at that moment. (Whether the
  bytes turned LF at commit time or at ISSUE-108's renormalisation is not distinguishable without
  Git and does not change the repair.)
- **The handoff, this runbook and the Step 1c preflight all carried the stale literal.** Corrected
  at §24.1 item 5, §24.3, §25.6 and §25.10 above, and in handoff §2h/§2i/§5/§ next-prompt.

**This is the exact defect ISSUE-108 fixed for the CORE snapshot and missed for the LADDER
witness.** ISSUE-108 §10 records: `data/reference/fitzroy-accepted-baselines.json` —
`manifest_sha256` → **canonical LF hash** `a42c6d5f…`; `.gitattributes` (new) — `eol=lf` for
hash-bound artefacts, which explicitly covers `docs/rebuild-manifests/**`; and
`tests/db-test-rebuild.test.ts` — LF-normalised manifest-hash comparison. The ladder witness
binding was left at its CRLF value because **nothing tests its value**:
`tests/db-test-rebuild.test.ts:646` asserts only
`expect(accepted.manifest_sha256).toMatch(/^[0-9a-f]{64}$/)` — a shape check.

**Consequence, and why it BLOCKS Step 3 independently of the ladder bytes.**
`validate_ladder_witness.py:142-144` checks `sha256_bytes(manifest_path) == accepted["manifest_sha256"]`
on **raw bytes, with no normalisation**. On any checkout honouring `.gitattributes` — now every
platform, Linux included — that check **fails today**, before a single ladder CSV is examined. So
even a byte-perfect re-acquisition (§25.6 adjudication passing 129/129) would still fail handoff §5
**Step 3**, and `rebuild-test.ts:1117-1120` re-runs the same validator, so **G7 would refuse after a
perfect recovery.**

**The repair — one literal, and it is NOT a weakening.** Set
`tools/rebuild/fitzroy/fitzroy-contract.json` `datasets.ladder.accepted_witness.manifest_sha256`
to `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`, exactly as ISSUE-108 §10 did
for the core register. It re-points the binding at the **same document** in its canonical LF form;
it does not accept different content, does not touch the 129 per-file hashes, and leaves every other
check untouched. The alternative — normalising inside `validate_ladder_witness.py` — is rejected:
`import_fitzroy_core.py:549-550` hashes raw bytes against a stored LF literal, and the ladder
witness must not diverge from that precedent.

**Not done in this pass, deliberately.** The operator's boundary for this session was *do not modify
the tracked ladder manifest, do not weaken its integrity contract*. The manifest is untouched. The
contract literal is a **tracked integrity binding outside ISSUE-111's scope**, so it is recorded as
**`AFLDB-ISSUE-114`** rather than edited here, and it is now a hard prerequisite of ISSUE-111's
Step 3.

> **SUPERSEDED 2026-08-30 (pass 13), repair only — the diagnosis above stands verbatim.** The
> operator authorised the `AFLDB-ISSUE-114` slice and it is **APPLIED**: `fitzroy-contract.json:243`
> now records `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f` and
> `tests/db-test-rebuild.test.ts` binds that literal to the tracked manifest's LF bytes while
> rejecting the CRLF rendering of the identical content. Statements above that the literal *is
> still* `70cc1776…8b6df` describe the pre-repair state. **The manifest was not edited, the
> validator was not normalised and no gate was relaxed.** Authoritative record: `issues.md`
> § `AFLDB-ISSUE-114` → "Repair applied 2026-08-30"; ISSUE-111 delta: handoff §2l. The repair
> awaits one DB-free run (`npm test -- tests/db-test-rebuild.test.ts`, expect 214 passed).

**Nothing else in the recovery procedure changes.** The per-file `sha256` entries inside the manifest
hash **gitignored raw CSVs**, which Git never end-of-line translates, so §25.6's 129/129 adjudication
rule stands exactly as written.

### 26.3 Discrepancy 2 — the Rscript segfault, isolated to a probe ladder

Not yet resolved; narrowed. The probe that crashed was Step 1c's single combined command
(handoff §5, line ~1237):

```
Rscript -e "cat(R.version.string, '\n'); for (p in c('fitzRoy','jsonlite','digest','openssl')) cat(sprintf('%-9s %s\n', p, if (requireNamespace(p, quietly=TRUE)) as.character(utils::packageVersion(p)) else 'NOT INSTALLED'))"
```

It conflates four independent things, so a crash anywhere names none of them. Ranked candidates:

1. **A namespace load, most likely `fitzRoy`.** `requireNamespace()` **loads** the namespace and
   `dlopen`s its compiled dependencies. A package built against a different R ABI than R 4.6.1
   crashes there rather than erroring. This is the leading candidate and it matters directly:
   `acquire_core.R:48` runs `library(fitzRoy)`, so a fitzRoy load crash would kill the acquisition
   too, after any network work.
2. **R startup itself.** Ruled *in* only if a bare `--vanilla` start also crashes — then the
   install (or its sub-architecture launcher) is broken and no package question is meaningful yet.
3. **A startup file.** `Rscript` reads `.Rprofile`/`Renviron.site`/`Rprofile.site` unless
   `--vanilla`. **There is no `.Rprofile` anywhere in this repository** (verified), so any such file
   would be a user- or R-home-level one; a `--vanilla` start that succeeds while a default start
   crashes isolates this exactly.
4. **Shell interaction.** "Segmentation fault" is the POSIX rendering; the Windows analogue is exit
   `-1073741819` (0xC0000005). Reporting the exit code per probe distinguishes a real crash from a
   wrapper artefact.

**Version establishment does not require loading anything.** `utils::packageVersion()` reads
`DESCRIPTION` via `packageDescription()` and never loads a namespace or `dlopen`s a DLL. So the
three prerequisite versions can be established safely **even if a namespace load crashes R** — which
is why the next probe reads versions first and only then attempts one load per process.

**No package may be installed, reinstalled, updated or removed until the crash is isolated.**
Re-installing before isolation would destroy the evidence and could silently move fitzRoy off the
pinned **1.8.0** — and `--allow-version-mismatch` remains forbidden.

### 26.4 The acquisition gate is now FOUR conditions, not three

No network acquisition (Step 1d) until **all** hold:

1. `Rscript` demonstrably usable — a bare start exits 0;
2. **fitzRoy exactly 1.8.0** demonstrated, and its namespace demonstrably loadable (`acquire_core.R:48`);
3. `jsonlite` **and** at least one of `digest` / `openssl` demonstrated;
4. the authoritative ladder manifest hash established — **done: `604a8a16…8d3f`** (§26.2), with the
   contract repair (`AFLDB-ISSUE-114`) required before Step 3, though not before Step 1d.

### 26.5 State after pass 12

- `afldb_test`, `afldb_dev` and production: **not contacted**. No Git command run. No snapshot byte
  acquired, copied, generated or deleted. No R package installed or changed. No Coleman code,
  contract, gate or test touched. The tracked ladder manifest is **unmodified**.
- Repository files changed: this record, the handoff, `IssuesIndex.md`, `issues.md`
  (new `AFLDB-ISSUE-114`).

## 27. Passes 13–15 — the acquisition toolchain PROVEN, `AFLDB-ISSUE-114` RESOLVED, Step 1d issued

Recorded here in summary; the operative detail lives in the handoff (§2l, §2m, §2n, §5) and, for the
contract repair, in the `AFLDB-ISSUE-114` entry of `issues.md`.

**Pass 13 — §5 Step 1c-R PASSED.** One process per probe. `Rscript` = `C:\Program
Files\R\R-4.6.1\bin\Rscript`, R 4.6.1; both a `--vanilla` and a default start exit 0, so no startup
file is implicated; versions read from `DESCRIPTION` without loading anything gave **fitzRoy 1.8.0**
— exactly the pin, so `acquire_core.R:76-87` will not refuse and `--allow-version-mismatch` remains
forbidden — plus `jsonlite 2.0.0`, `openssl 2.4.2`, and `digest` **not installed** (allowed: the rule
is `digest` OR `openssl`). One `loadNamespace()` per process succeeded for `jsonlite`, `openssl` and
**`fitzRoy`**. The pass-12 segfault did not reproduce, so it was an artefact of the combined probe,
not of any package this acquisition needs. **All four §26.4 gate conditions are therefore satisfied
by measurement.** Pass 13 then repaired `AFLDB-ISSUE-114` in two files — the contract literal and a
new binding assertion — editing **no** manifest, **no** validator and **no** gate.

**Passes 14–15 — the repair is VALIDATED and `AFLDB-ISSUE-114` is RESOLVED.** The operator's first
DB-free run was 213 of 214 with the ISSUE-114 binding case green; the single failure was an unrelated
test-isolation defect (`runPreflight` resolves Python from `process.env` by design, and that one case
stubbed only the relative default as missing while the operator shell exports `AFLDB_PYTHON`),
repaired **in the test only** with every assertion unchanged. The confirming run is **214 tests, 214
passed, 0 failed, 404 ms**, with `AFLDB_PYTHON` still exported — the exact condition the repair had
to survive. `AFLDB-ISSUE-114` is resolved in `issues.md`, removed from `IssuesIndex.md` and the Open
Issues table, and recorded in `CHANGELOG.md`. **§5 Step 3's contract blocker is gone.**

**State.** `afldb_test`, `afldb_dev` and production: **not contacted** in any of these passes. No Git
command, no network call, no R package change, and **no snapshot byte acquired, copied, generated or
deleted**. `data/sources/` still does not exist in this worktree, the temporary label
`ladder-recover-20260830` is still free, and no
`docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json` exists.

**Next action: handoff §5 Step 1d** — one network acquisition under the temporary label
`ladder-recover-20260830` (`--datasets ladder --from 1897 --to 2025`, fitzRoy 1.8.0, never
`--allow-version-mismatch`, no database, no Git), expecting **129 files / 1,622 rows**. Its output is
**untrusted** until §25.6 / §5 Step 1e adjudicates it file-by-file against the tracked
`ladder-20260828.json`, in a separate session. Nothing may be renamed, copied, moved or deleted
between the two, and the printed `validate_ladder_witness.py --label ladder-recover-20260830` line is
**not** the adjudication — a temporary label fails the contract-binding checks by construction
(§25.6).

## 28. Pass 16 (2026-08-30) — the ladder reacquisition SUCCEEDED; the adjudication designed, not run

Pass 16 performed **no acquisition, no adjudication, no hashing, no file move/copy/rename/delete, no
database access, no Git command, no network call and no production access**, and changed no Coleman
implementation, no accepted manifest and no contract. Operative detail: handoff §2o and §5 Step 1e.

**The acquisition (handoff §5 Step 1d), operator-run, SUCCEEDED.**

```
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label ladder-recover-20260830 \
  --datasets ladder --from 1897 --to 2025
```

| Expected | Reported |
|---|---|
| 129 ladder CSV files | **129** |
| seasons 1897–2025 | **1897–2025** |
| 1,622 total rows | **1,622** |
| `acquisition_kind: validation_witness (ladder)` | as printed |
| `completeness: unvalidated (the acquirer does not adjudicate)` | as printed |
| temporary manifest `docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json` | written |
| raw CSVs under `data/sources/afltables/fitzroy_core/ladder-recover-20260830/` | present |
| no database contact | none |

Final line: `Acquisition complete: 129 file(s); 1622 total rows.` The generic
`validate_ladder_witness.py --label ladder-recover-20260830` line the tool prints was correctly
**not** run — a temporary label fails the contract's `snapshot_label` and `manifest_sha256` binding
checks by construction (§25.6) — and nothing was copied, renamed, moved or deleted.

**The bytes are UNTRUSTED.** 129/1,622 agreeing with `accepted_witness.files`/`rows`
(`fitzroy-contract.json:244-245`) is encouraging, not evidence: both are aggregates, and one
corrected historical score upstream would change a single season's CSV while leaving them identical.
The candidate's own manifest is **not** authority — `acquire_core.R` wrote it over the bytes it had
just written, so comparing it against itself proves nothing.

**The adjudication, designed this pass (handoff §5 Step 1e).** Read-only. It binds first —
`Get-FileHash` of the tracked `ladder-20260828.json` must equal
`datasets.ladder.accepted_witness.manifest_sha256` (`604a8a16…8d3f`, the canonical LF hash repaired
under `AFLDB-ISSUE-114`), reproducing `validate_ladder_witness.py:142-144` exactly — then iterates
the accepted manifest's 129 `files[]` entries, hashes each candidate file with SHA-256, and
recursively scans the directory for anything the manifest does not list. It reports **expected /
present / matched / missing / mismatched / unexpected**, and for every mismatch prints the filename
with its expected and actual SHA-256. `row_count` and `columns` appear only as a secondary
diagnostic (total candidate rows against `accepted_witness.rows`; per-mismatch row count and header
agreement) — **byte equality against the accepted manifest is the deciding criterion**, and no
row/column agreement rescues a hash difference.

**Only `expected=129, present=129, matched=129, missing=0, mismatched=0, unexpected=0` permits
recovery to continue.** After that exact result — and only then — the operator renames
`ladder-recover-20260830` → `ladder-20260828`, deletes the temporary manifest, and proves canonicity
with `validate_ladder_witness.py --label ladder-20260828` (26 PASS, exit 0). Any other result is
§25.8 fail-closed: nothing is moved, the accepted manifest and its `manifest_sha256` are never
updated to accommodate fresh upstream bytes, the candidate is deleted, and the differing filenames
are reported.

**State.** `afldb_test`, `afldb_dev` and production not contacted. Repository files changed by this
pass: this record, the handoff, `IssuesIndex.md`. The untracked candidate directory and its temporary
manifest exist on disk and are **unadjudicated**.

## 29. Pass 17 (2026-08-30) — the adjudication PASSED 129/129; promotion + canonical validation prepared

Pass 17 performed **no acquisition, no hashing, no file move/copy/rename/delete, no database access,
no Git command, no network call and no production access**, and changed no Coleman implementation, no
accepted manifest and no contract. It recorded the operator's adjudication result and prepared the
promotion step. Operative detail: handoff §2p and §5 Steps 1e/1f.

### 29.1 The operator's Step 1e adjudication — the ONLY permitted continuation was returned

The operator ran the exact read-only §5 Step 1e block against the accepted witness. No database, no
Git, no production; nothing moved, copied, renamed or deleted; no accepted manifest and no contract
changed.

| Binding proof | Value |
|---|---|
| accepted label | `ladder-20260828` |
| accepted `manifest_sha256` (contract) | `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f` |
| tracked manifest `Get-FileHash` | `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f` — **equal** |
| candidate | `data\sources\afltables\fitzroy_core\ladder-recover-20260830` |

| Adjudication counter | Value |
|---|---|
| expected | **129** |
| present | **129** |
| matched | **129** |
| missing | **0** |
| mismatched | **0** |
| unexpected | **0** |

Secondary diagnostic: accepted rows **1622**, candidate rows **1622**.

**VERDICT: RECOVERED — byte-for-byte identical to the accepted `ladder-20260828` manifest.** This is
exactly the §25.7 / §2o.4 continuation condition, and the only one. Every one of the nine §2o.3
proofs held: the adjudication bound to the accepted contract before it adjudicated anything, the
expected filename list came from the tracked manifest rather than the candidate directory, all 129
SHA-256 values are equal, the recursive scan found no unexpected file, and the candidate's own
`ladder-recover-20260830.json` was never consulted.

**Consequence: no successor-witness decision arises.** The reacquired bytes are not *a* correct
witness — they are *the* accepted witness, reproduced. `AFLDB-ISSUE-101`'s successor procedure is not
engaged, the accepted manifest, its `manifest_sha256`, `accepted_witness` and `ladderWitnessLabel()`
stay exactly as they are, and the §25.8 fail-closed branch is not reached. The ISSUE-093 durability
convention is vindicated by measurement: gitignored raw snapshot bytes were reproduced from the
tracked manifest alone, two days later, byte for byte.

### 29.2 Promotion + canonical validation — prepared this pass, not run

The remaining recovery operation is mechanical and is deliberately one atomic operator block
(handoff §5 Step 1f). It fails closed **before** it changes anything if the canonical target already
exists, if the candidate directory or the temporary manifest is missing, if the candidate no longer
holds exactly its adjudicated 129 files, or if the accepted manifest's hash no longer matches the
contract binding. It then performs **one rename** (`ladder-recover-20260830` → `ladder-20260828`;
nothing is copied, so the adjudicated bytes cannot be altered in transit), deletes **only** the
temporary acquisition manifest `docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json`,
and immediately runs the canonical validator.

Untouched by design: `docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json`,
`tools/rebuild/fitzroy/fitzroy-contract.json`, every Coleman file, every migration and every test.
`data/sources/**` and the temporary manifest are untracked (`.gitignore:37-48`), so Git sees nothing.

**Expected result:** `validate_ladder_witness.py --label ladder-20260828` prints **26 `PASS` lines
and zero `FAIL` lines** across its four sections — 4 (witness binding) + 4 (manifest shape) + 14 (raw
artefacts) + 4 (historical identity resolution) — then `All checks passed.` and exits **0**. Counted
from current source: `validate_ladder_witness.py:130-133,137-144` (4), `:150-159` (4), `:228-255`
(14), `:286-293` (4). The default mode makes **no database connection and no network request**
(`:7-8`); `--compare` is deliberately not used here because `club_seasons` has not been rebuilt yet.

**Why 26/26 is now reachable and was not on 2026-08-28's re-check:** `AFLDB-ISSUE-114` is RESOLVED
(§27) — `fitzroy-contract.json:243` carries the canonical LF hash, so the manifest-binding check at
`:142-144` passes on this LF checkout. That repair and these adjudicated bytes are the two halves of
the same gate.

### 29.3 State after pass 17

`afldb_test`, `afldb_dev` and production not contacted. No Git command run. Repository files changed
by this pass: this record, `issues/open/AFLDB-ISSUE-111-HANDOFF.md`, `IssuesIndex.md`. The candidate
directory and its temporary manifest still exist on disk under their acquisition names and are now
**ADJUDICATED and TRUSTED**, awaiting promotion. **Next action: handoff §5 Step 1f** — the single
promotion + canonical-validation block, expecting 26 PASS / exit 0. Then §5 Step 2 (the operator
copies the fitzRoy and DraftGuru snapshots in), §5 Step 3 (three offline validators), §5 Step 4 (the
rebuild). Those are separate slices and are not started here.

## 30. Pass 18 (2026-08-30) — Step 1f EXECUTED: the ladder witness is CANONICAL (26/26); Step 2 prepared

Pass 18 performed **no promotion, no acquisition, no hashing, no file move/copy/rename/delete, no
database access, no Git command, no network call and no production access**, and changed no Coleman
implementation, no accepted manifest and no contract. It recorded the operator's Step 1f result and
prepared the Step 2 copy. Operative detail: handoff §2q and §5 Steps 1f/2.

### 30.1 The operator's Step 1f promotion + canonical validation — SUCCEEDED

| Phase | Reported |
|---|---|
| preconditions | passed — accepted manifest SHA-256 `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`, candidate 129 files |
| promotion | `data\sources\afltables\fitzroy_core\ladder-recover-20260830` → `data\sources\afltables\fitzroy_core\ladder-20260828`, **129 files present after** |
| temporary manifest | `docs\rebuild-manifests\afltables_fitzroy_core\ladder-recover-20260830.json` **removed**, and only that file |
| accepted manifest | `docs\rebuild-manifests\afltables_fitzroy_core\ladder-20260828.json` present and **unchanged**, SHA-256 `604a8a16…8d3f` |
| validator | `tools/rebuild/fitzroy/validate_ladder_witness.py --label ladder-20260828` → **26 PASS, 0 FAIL**, `All checks passed.`, **exit 0** |

Key proofs inside those 26, as reported: accepted witness binding PASS; the manifest lists exactly
**129** ladder files; manifest rows total **1622**; every manifest SHA-256 matches disk; every row
count and the exact eight-column schema match; coverage is exactly **1897–2025**; total rows
**1622**; all **1622** historical label-season pairs resolve. That is the predicted
4 + 4 + 14 + 4 (§29.2), and section 5 correctly did not appear — `--compare` was not used, because
`club_seasons` has not been rebuilt yet and the D7 cross-check belongs to §5 Step 4's FINAL
VALIDATION.

**The accepted ladder witness is therefore RECOVERED and CANONICAL in this worktree.**
`AFLDB-ISSUE-114`'s contract repair and these adjudicated bytes were the two halves of the same
gate, and both now hold: the exact argv the rebuild re-runs (`rebuild-test.ts:1117-1120`) passes
offline. **G7's ladder-witness blocker is CLEARED.** Nothing about the binding changed — the bytes
are the accepted witness reproduced, not a successor (§29.1). Do not re-acquire, re-adjudicate or
re-run Step 1f; it now refuses on its first precondition (the canonical target exists), which is the
guard working.

### 30.2 On-disk prerequisite state after Step 1f

| Path (worktree-relative) | State |
|---|---|
| `data/sources/afltables/fitzroy_core/ladder-20260828` | **PRESENT, 129 files, canonical, validated 26/26** |
| `data/sources/afltables/fitzroy_core/ladder-recover-20260830` | gone — renamed, not copied |
| `data/sources/afltables/fitzroy_core/full-history-20260827` | **ABSENT — §5 Step 2** |
| `data/sources/draftguru/annual-html-20260826` | **ABSENT — §5 Step 2** |

### 30.3 Step 2 — the copy contract, prepared this pass and not executed

Two directories, whole, from `D:\dev\afldb` to the same worktree-relative paths: fitzRoy
`full-history-20260827` (**131 files**, the tracked manifest's `files[]` count) and DraftGuru
`annual-html-20260826` (**90 files** = 42 raw + 42 http + 2 robots + 4 parsed, §24.4). Both were
measured present with those counts in `D:\dev\afldb` in passes 10–11.

Both labels are **read from tracked source rather than typed** — the fitzRoy label and `snapshot_dir`
from the single `acceptance_status: accepted` baseline in `data/reference/fitzroy-accepted-baselines.json`
(`:57-64`), the DraftGuru label from `draftguruLabel` in `tools/db/rebuild-test.ts:1124` — so no
label the rebuild will not ask for can be copied, and no other snapshot label is touched.

The block **fails closed before copying anything** if either destination already exists, if either
source directory is missing, if either source file count is not its measured value, if the register
does not declare exactly one accepted fitzRoy baseline, if the DraftGuru label cannot be read, or if
the promoted ladder witness is absent or not 129 files. It contacts no database and no network, runs
no Git command, accesses no production, writes no tracked file, and names `ladder-20260828` only to
measure it before and after as proof of non-interference. `data/sources/**` is gitignored
(`.gitignore:37-48`), so Git sees nothing.

Copying remains safe **structurally, not by judgement** (§24.5): every copied byte is re-adjudicated
in §5 Step 3 against this worktree's tracked manifests — fitzRoy by `manifest_sha256` +
`artefact_set_sha256` + per-file sha256/columns/row-count over all 131, DraftGuru by manifest counts
+ all 42 raw sha256 + a full re-parse whose `discover_years` refuses any stray file — so a partial,
stale or polluted copy fails closed there rather than corrupting a rebuild. The block's single
`player_stats_1897.csv` probe hash is a smoke check proving **1 of 131 files**, never the snapshot.

### 30.4 State after pass 18

`afldb_test`, `afldb_dev` and production not contacted. No Git command run. No snapshot byte copied,
acquired, renamed or deleted by Claude. Repository files changed by this pass: this record,
`issues/open/AFLDB-ISSUE-111-HANDOFF.md`, `IssuesIndex.md`. **Next action: handoff §5 Step 2** — the
single operator copy block — then §5 Step 3 (three offline validators, exit 0) and §5 Step 4 (the
rebuild). No `CHANGELOG.md` entry: recovering gitignored local snapshot bytes is a checkout-state
change, not a retained project change.

## 31. Pass 19 (2026-08-30) — Step 2 EXECUTED: all three snapshots are IN; Step 3 prepared

Pass 19 performed **no copy, no acquisition, no hashing, no file move/rename/delete, no database
access, no Git command, no network call and no production access**, and changed no Coleman
implementation, no accepted manifest and no contract. It recorded the operator's Step 2 result and
prepared the Step 3 validation. Operative detail: handoff §2r and §5 Steps 2/3.

### 31.1 The operator's Step 2 copy — SUCCEEDED

| Phase | Reported |
|---|---|
| labels | read from tracked source — fitzRoy `full-history-20260827`, DraftGuru `annual-html-20260826` |
| sources in `D:\dev\afldb` | fitzRoy **131** files; DraftGuru **90** files |
| ladder witness before | **129** files |
| copies | fitzRoy **131** → `D:\dev\afldb-issue-102\data\sources\afltables\fitzroy_core\full-history-20260827`; DraftGuru **90** → `D:\dev\afldb-issue-102\data\sources\draftguru\annual-html-20260826` |
| probe | `player_stats_1897.csv` SHA-256 **MATCHES** the tracked manifest |
| ladder witness after | **129** files, unchanged |
| labels present | `fitzroy_core`: `full-history-20260827`, `ladder-20260828`; `draftguru`: `annual-html-20260826` |

No `REFUSED` line and no post-copy count mismatch occurred. No database was contacted, no Git command
run, no production accessed, and no tracked manifest or contract changed.

### 31.2 On-disk prerequisite state after Step 2

| Path (worktree-relative) | State |
|---|---|
| `data/sources/afltables/fitzroy_core/full-history-20260827` | **PRESENT, 131 files** — probe hash matching, unadjudicated until Step 3 |
| `data/sources/afltables/fitzroy_core/ladder-20260828` | **PRESENT, 129 files**, canonical, validated 26/26 in pass 18 |
| `data/sources/draftguru/annual-html-20260826` | **PRESENT, 90 files** (42 raw + 42 http + 2 robots + 4 parsed, §24.4) — unadjudicated until Step 3 |

`data/sources/` now holds **exactly the three prerequisite snapshots and nothing else**, so the
pass-9 refusal (`snapshot file missing: …full-history-20260827\player_stats_1897.csv`, §22) cannot
recur for the same reason. **G7's snapshot prerequisite is CLEARED.** The single probe hash proves
**1 of 131 files** and is not adjudication — Step 3 is the proof.

### 31.3 Step 3 — the validation contract, prepared this pass and not executed

Three offline validators, in order, in one operator block that **stops on the first non-zero exit**
so the first failure is reported rather than buried under the next validator's output. All three
resolve inputs from the repository root rather than the working directory
(`import_fitzroy_core.py:84-95`, `import_draftguru.py:53-73`), none opens a database connection or a
socket on the validate path, and the block refuses **before running any validator** if any of the
three snapshot directories is absent or does not hold its expected file count.

| # | Validator | Re-derived, from current source |
|---|---|---|
| 1 | `import_fitzroy_core.py --label full-history-20260827 --validate-only --require-accepted-baseline` | all 131 artefacts re-hashed against the manifest (`:930-938`); `--require-accepted-baseline` implies `--require-full-history` (`:2681`), so range, datasets, per-season coverage and identity coverage are re-derived from the CSVs (`:802-879`); the acceptance binding re-checks manifest SHA-256, `artefact_set_sha256`, artefact count, acquired rows, both contract versions, range/datasets and the fitzRoy pin (`:531-591`); then every measured drift gate must equal the register exactly (`:594-632`) |
| 2 | `validate_ladder_witness.py --label ladder-20260828` | the exact argv the rebuild re-runs (`rebuild-test.ts:1117-1120`): witness binding, manifest shape, 129 raw artefacts (bytes, eight columns, per-season row counts), historical identity resolution. `--compare` deliberately unused, so the `club_seasons` cross-check — the only database-touching section — never runs |
| 3 | `import_draftguru.py --validate-only` | Phase A in full with no psycopg on that path (`:927-931`): manifest `total_rows` / `distinct_player_url_count` must equal 6810 / 5057 (`:198-204`); all 42 raw pages re-hashed (`:208-226`); a full re-parse whose built picks/persons must again equal 6810 / 5057 (`:447-450`); the tracked six-decision ledger and the event-kind contract loaded and checked. Label defaults to `annual-html-20260826` (`:68`, `:899`) |

**Expected success evidence** (handoff §5 Step 3 carries the full transcripts): validator 1 —
`snapshot scan summary` with `matches 16838`, `players 13275`, `player_match_rows 685471`,
`seasons 1897-2025`, `brownlow_round_vote_rows 320861`, then `full-history gates PASSED — identity
coverage` with `rows 685473`, `missing_url 0`, `malformed_url 0`, `distinct_urls 13275`, then
`accepted canonical baseline VERIFIED` with `manifest_sha256 a42c6d5f…21d09`,
`artefact_set_sha256 8e14ce61…f4125`, `raw_artefacts 131`, `acquired_rows 719042`,
`contract_version 1`, and `Validation complete … (no database access).`; validator 2 — **26 `PASS`
lines, 0 `FAIL`, `All checks passed.`, exit 0**, with no section 5; validator 3 —
`annual-html-20260826 (42 year pages, sha256 verified)`, `persons : 5057`, `picks : 6810`,
`ledger : 6 explicit decisions`, `bridge : 0 entries (no bridge dataset supplied)` and
`validate-only: every input check passed. No database was contacted.` **Three exit-0 results are
what proves the rebuild will get past PRECHECK**; they are the same checks `runPreflight()` re-runs
itself.

**Failure is fail-closed and terminal for the slice.** A per-file SHA-256 mismatch means the copied
bytes are not the accepted snapshot; an acceptance-binding or drift-fingerprint refusal is a binding
problem, and re-acceptance is an ISSUE-093/101 decision outside ISSUE-111. The ISSUE-108/114
line-ending class is already repaired for both bindings involved here — the register carries the
canonical LF hash `a42c6d5f…21d09` and `.gitattributes` forces `docs/rebuild-manifests/** text
eol=lf` — so a hash mismatch now would be new information. In every case: report verbatim, re-copy
nothing, prune nothing, and edit no manifest, contract, register or validator.

### 31.4 State after pass 19

`afldb_test`, `afldb_dev` and production not contacted. No Git command run. No snapshot byte copied,
acquired, renamed, hashed or deleted by Claude. Repository files changed by this pass: this record,
`issues/open/AFLDB-ISSUE-111-HANDOFF.md`, `IssuesIndex.md`. **Next action: handoff §5 Step 3** — the
single fail-stop block of three offline validators — then §5 Step 4 (the rebuild), one re-run of the
integration command (expect 29/29), `npx tsc --noEmit`, `CHANGELOG.md` and the ledger closeout. No
`CHANGELOG.md` entry: copying gitignored local snapshot bytes is a checkout-state change, not a
retained project change.

## 32. Pass 20 (2026-08-30) — Step 3 EXECUTED: three validators, three exit 0; Step 4 prepared

Pass 20 performed **no command, no database access, no network call, no Git command and no
production access**, copied / moved / renamed / hashed / deleted no byte, and changed no Coleman
implementation, no accepted manifest and no contract. It recorded the operator's Step 3 result and
prepared the Step 4 rebuild. Operative detail: handoff §2s and §5 Step 4.

### 32.1 The operator's Step 3 adjudication — ALL THREE VALIDATORS EXIT 0

| # | Validator | Reported |
|---|---|---|
| — | inventory | fitzRoy **131**, ladder **129**, DraftGuru **90** — three `present` lines, no `REFUSED` |
| 1 | `import_fitzroy_core.py --label full-history-20260827 --validate-only --require-accepted-baseline` | scan summary exactly as predicted (`matches 16838`, `matches_with_player_rows 16838`, `attendance_known 15187`, `players 13275`, `players_with_dob 855`, `players_with_dob_conflict 0`, `player_match_rows 685471`, `venues 52`, `seasons 1897-2025`, `brownlow_round_vote_rows 320861`); `full-history gates PASSED — identity coverage` (`rows 685473`, `missing_id 83`, `missing_url 0`, `malformed_url 0`, `distinct_ids 13270`, `distinct_urls 13275`); `accepted canonical baseline VERIFIED` (`manifest_sha256 a42c6d5f…21d09`, `artefact_set_sha256 8e14ce61…f4125`, `raw_artefacts 131`, `acquired_rows 719042`, `contract_version 1`); **20.8 s, no database access** |
| 2 | `validate_ladder_witness.py --label ladder-20260828` | **26 PASS / 0 FAIL**, accepted manifest binding PASS, exactly **129** files, manifest rows **1622**, every file SHA-256 matching, every row count and schema matching, coverage exactly `1897-2025`, all **1622** label-season pairs resolving, `All checks passed.`, **no section 5** |
| 3 | `import_draftguru.py --validate-only` | `annual-html-20260826` — **42 year pages sha256 verified**, `persons 5057`, `picks 6810`, `ledger 6 explicit decisions`, `bridge 0 entries`, `validate-only: every input check passed. No database was contacted.` |

No database was contacted, no network used, no Git command run, no production accessed, and no
snapshot, manifest or contract changed.

**What it settles.** These are the same three checks `runPreflight()` re-runs itself
(`rebuild-test.ts:1077-1113`), so the pass-9 refusal class is **adjudicated**, not assumed away:
every one of the 131 fitzRoy artefacts, all 129 ladder CSVs and all 42 DraftGuru raw pages was
re-hashed against its tracked manifest, and the fitzRoy acceptance binding and every drift gate
still hold over **these** bytes. **The snapshot / input prerequisite is CLOSED, the rebuild is
expected to pass PRECHECK, and G7 is blocked on nothing but execution.** Nothing here is evidence
about the Coleman derivation — that is what Step 4 measures.

### 32.2 Step 4 — the environment contract, verified in current source

The harness enforces, **all before any destruction**: `AFLDB_TEST_DATABASE_URL` present and a valid
URL (`resolveTarget:186-198`); its database rejected unless it is `afldb_test` — not in the
forbidden list, not matching `/prod/i`, ending `_test`, equal to `SUPPORTED_TARGET`, not
`*pre_rebuild*` (`assertRebuildTargetName:153-176`); `AFLDB_TEST_IMPORT_DATABASE_URL` present and
naming the **same** database (`:205-226`); the interpreter from `AFLDB_PYTHON` existing
(`resolvePython:389-394`, `runPreflight:1066-1075`); and the `--acknowledge-destroy afldb_test`
echo, consumed at `:1244` **after** the preflight at `:1243` (`assertDestructiveAcknowledgement:232-241`).

Two gaps the operator block closes rather than the harness:

1. **The harness never checks which ROLE either DSN connects as** — only that both name the same
   `afldb_test`. So the block parses both DSNs and refuses unless they are
   `afldb_test | afldb_owner` and `afldb_test | afldb_import`, printing database, role and host
   only — never a password.
2. **`psql` must exist before the destructive reset**, not after: both the reset and stage 9 FINAL
   VALIDATION run through `runPsql` (`tools/db/psql.ts`).

Both DSNs are resolved the way `main()` resolves them — the process environment wins and `.env` only
fills a variable that is not already set (`:1154-1162`) — so what the block proves is what the
harness will use. **`afldb_dev` and production are unreachable from the run**: the target-name gate
plus `dataEnv = { AFLDB_IMPORT_DATABASE_URL: target.importDsn }` (`:402`) spawned as
`{ ...process.env, ...envOverlay }` (`:1176`), which overrides any ambient development DSN.

### 32.3 The expected Coleman evidence, reconfirmed from current source

| Claim | Verified at | Result |
|---|---|---|
| stage identity | `rebuild-test.ts:470-483` | `id: 'coleman'`, `COLEMAN — leading home-and-away goalkicker, derived`, `kind: 'data'`, `argv: [python, 'tools/migration/import_awards.py', '--groups', 'coleman']`, `envOverlay: dataEnv` |
| **stage order** | `planStages:406-507` | `precheck → recreate → migrations → privileges → reference → fitzroy → draftguru → derived → **coleman** → ladder-witness → fingerprints` — after `DERIVED`, before `LADDER WITNESS` and FINAL VALIDATION, exactly as deviation (b) requires |
| **INSERT, not update** | no awards stage exists in `planStages`; `coleman_award_id:1143-1175`; `import_coleman:1220-1231` | the rebuilt database holds no `awards` row and no `award_winners` row, so the create-if-missing branch runs for the first time ever and the ownership scope is empty: expect `coleman winners 46 (46 seasons, **0 updated, 46 inserted, 0 deleted**)` — not the 46-updated first-load signal, which belongs to the legacy→derived transition on an already-populated database |
| **span read, never written** | `colemanFirstSeason:704-718` reads `data/reference/coleman-derivation.json` `first_season: 1980` (`:7`) and refuses rather than defaulting; `colemanChecks:731-735` takes `Number(measured.seasons_last)` = **2025** from `data/reference/fitzroy-accepted-baselines.json:118` | `span = 2025 − 1980 + 1 = **46**` |

**Exact Stage-9 gate values** (`colemanChecks:731-782`, emitted by `buildFinalValidationSql:855-877`
as `WARNING:  AFLDB-FINAL-VALIDATION <key> = <actual> (expected <n>)`): `coleman_rows` **46**,
`coleman_seasons` **46**, `coleman_first_season` **1980**, `coleman_unlinked_rows` **0**,
`coleman_rows_not_derived_from_afltables` **0**, `coleman_rows_keyed_on_a_numeric_id` **0**,
`coleman_after_accepted_last_season` **0**, then `AFLDB-FINAL-VALIDATION PASSED: <n> checks` and
`Rebuild complete.`

### 32.4 Failure classification for Step 4

1. **PRECHECK refusal, before destruction** — `REFUSED: …`, exit 1, `afldb_test` intact. Shapes:
   `Unknown argument`; the two `AFLDB_TEST_DATABASE_URL` refusals; `Refusing to rebuild '<db>'…`;
   the `AFLDB_TEST_IMPORT_DATABASE_URL` refusals; `No Python interpreter at '…'`; `fitzRoy
   preflight failed`; `DraftGuru preflight …`; `Ladder witness preflight failed`; and the
   `--acknowledge-destroy` demand. After Step 3's three exit-0 results a preflight refusal would be
   **new information** — report it verbatim.
2. **A stage before `coleman` fails** — `FAILED: <id> exited <n>`, `REBUILD FAILED at stage '<id>'.`,
   `Not run: coleman, ladder-witness, fingerprints`. `afldb_test` is destroyed and partially
   rebuilt (recoverable by re-running) and this is **not ISSUE-111 work**: report and stop.
3. **The `coleman` stage fails** — `FAILED: coleman exited <n>`,
   `REBUILD FAILED at stage 'coleman'.`, `Not run: ladder-witness, fingerprints`. First execution of
   the stage **and** of create-if-missing, so the traceback is genuine new information. Sub-shapes:
   the award-definition INSERT (deviation (a)); a G5a identity refusal (*"will not fall back to
   players.id"* / *"Nothing has been written."*); the per-run NULL-goals guard (deviation (e)) — a
   fitzRoy-import finding, not a Coleman defect; or a contract-load refusal. **Change no Coleman
   code, contract, gate or test to get past it.**
4. **A final Coleman gate mismatch** — every data stage succeeded; FINAL VALIDATION collects all
   failures and raises `AFLDB-FINAL-VALIDATION FAILED: coleman_rows: got 45, expected 46; …`, then
   `FINAL VALIDATION did not pass (psql exited <n>)` and `REBUILD FAILED at stage 'fingerprints'.`
   The rebuild is **FAILED**, not "passed with a caveat". `coleman_rows 45` means `season_metadata`
   left 2025 `in_progress` and the completed-season rule worked as declared — report the gate line
   and the season's status; **never relax the gate**.

### 32.5 State after pass 20

`afldb_test`, `afldb_dev` and production not contacted. No Git command run. No snapshot byte
touched by Claude. Repository files changed by this pass: this record,
`issues/open/AFLDB-ISSUE-111-HANDOFF.md`, `IssuesIndex.md`. **Next action: handoff §5 Step 4** —
ONE operator block that proves the environment (interpreter, `psql`, `afldb_test | afldb_owner`,
`afldb_test | afldb_import`) and then runs
`npm run db:test:rebuild -- --acknowledge-destroy afldb_test`. Then one re-run of the integration
command (expect 29/29), `npx tsc --noEmit`, `CHANGELOG.md` (item 19) and the ledger closeout
(item 20). No `CHANGELOG.md` entry this pass: nothing retained changed.

## 33. Pass 21 (2026-08-30) — Step 4 EXECUTED: the canonical rebuild PASSED; ISSUE-111 RESOLVED

### 33.1 The operator's Step 4 result — the destructive rebuild, exit 0

The operator ran handoff §5 Step 4 in full. The pre-destruction environment proof reached its
only permitted continuation:

```
PROVEN: afldb_test/afldb_owner + afldb_test/afldb_import, interpreter, psql.
DESTROYING AND REBUILDING afldb_test NOW.
```

| Proof | Reported |
|---|---|
| `AFLDB_PYTHON` | `D:\dev\afldb-issue-102\.venv\Scripts\python.exe` |
| `psql` | `C:\Program Files\PostgreSQL\16\bin\psql.exe` |
| `AFLDB_TEST_DATABASE_URL` | database `afldb_test`, role `afldb_owner`, host `127.0.0.1` |
| `AFLDB_TEST_IMPORT_DATABASE_URL` | database `afldb_test`, role `afldb_import`, host `127.0.0.1` |

**No production and no `afldb_dev` target was used.** The import DSN's role is the one requirement
the harness itself does not check — it compares database names only — which is why the block proved
it before anything was destroyed.

### 33.2 PRECHECK and the canonical stages

PRECHECK **PASS**, re-running the same three adjudications Step 3 had already returned exit 0 for:
fitzRoy `full-history-20260827` (full-history gates PASSED, accepted canonical baseline VERIFIED,
**131** raw artefacts, **719,042** acquired rows); DraftGuru (**42** year pages SHA-256 verified,
**5,057** persons, **6,810** picks); ladder (accepted binding PASS, **129** files, **1,622** rows,
all checks passed).

`afldb_test` was then reset intentionally and **78** migration files applied successfully,
including migration 078. Privileges completed successfully.

| Stage | Measured |
|---|---|
| reference | sources 12, seasons 130 (1897–2026; 1 in progress), clubs 24, club_aliases 48, club_organizations 21, stat_definitions 24 |
| fitzRoy core | venues 52, players 13,275, matches 16,838, match_period_scores 134,704, player_match_stats 685,471, brownlow_round_votes 320,861 |
| DraftGuru | persons 5,057, picks 6,810, ledger authority 6 |
| derived | season_metadata 130, player_clubs 16,713, player_club_season_stats 58,425, player_season_stats 58,176, player_career_stats 13,275, club_seasons 1,622, search_rank 13,277 |

### 33.3 The Coleman stage — the fresh-load signal, exactly as predicted

```
coleman winners 46
46 seasons
0 updated
46 inserted
0 deleted
```

This is the **INSERT** signal §32.3 predicted, not the `46 updated` first-load signal that belongs
to the legacy → derived transition on an already-populated database. It proves the fresh canonical
rebuild exercises `coleman_award_id()`'s **create-if-missing** branch — the award definition being
created here for the first time ever — rather than the transition-update path, because a canonically
rebuilt `afldb_test` holds no `awards` row and no `award_winners` row for the reload scope to find.

### 33.4 Ladder witness including the D7 database cross-check — PASS

Beyond the canonical witness checks: every witness club-season exists in `club_seasons`,
`club_seasons` holds no extra club-season, and all **1,622** club-seasons agree on every compared
field.

### 33.5 FINAL VALIDATION — `AFLDB-FINAL-VALIDATION PASSED: 26 checks`

Every expected value passed: `matches 16838`, `matches_with_player_rows 16838`,
`seasons_first 1897`, `seasons_last 2025`, `venues 52`, `attendance_known 15187`,
`club_identities 24`, `players 13275`, `player_match_rows 685471`,
`brownlow_round_vote_rows 320861`, `matches_after_accepted_last_season 0`, `draft_persons 5057`,
`draft_picks 6810`, `club_seasons_rows 1622`, `club_seasons_identity_era_violations 0`,
`club_seasons_duplicate_identity_seasons 0`, `club_seasons_unranked_rows 0`,
`club_seasons_brisbane_lions_first_season 1997`, `club_seasons_after_accepted_last_season 0`.

The seven Stage-9 Coleman gates, all green and all matching §32.3's predictions exactly:

| Gate | Expected | Measured |
|---|---|---|
| `coleman_rows` | 46 | **46** |
| `coleman_seasons` | 46 | **46** |
| `coleman_first_season` | 1980 | **1980** |
| `coleman_unlinked_rows` | 0 | **0** |
| `coleman_rows_not_derived_from_afltables` | 0 | **0** |
| `coleman_rows_keyed_on_a_numeric_id` | 0 | **0** |
| `coleman_after_accepted_last_season` | 0 | **0** |

Neither 46 nor 1980 is hard-coded. `colemanFirstSeason()` (`rebuild-test.ts:704-718`) reads
`first_season: 1980` from `data/reference/coleman-derivation.json` and **refuses** rather than
defaulting; `colemanChecks()` (`:731-782`) takes `acceptedLastSeason` from `seasons_last: 2025` in
the accepted fitzRoy register; the span is the computed `2025 − 1980 + 1 = 46`. The measured
`seasons 130 (1897-2026; 1 in progress)` is why the completed-season rule is load-bearing here: 2026
exists as a season and correctly produced no Coleman row.

Final lines: `Rebuild complete.`, **rebuild exit code 0**.

### 33.6 What G7 settles, and what it deliberately does not

**Settles.** The `coleman` stage exists in the canonical plan in the right position (after `derived`,
before the ladder witness), runs with no legacy SQLite anywhere in the plan, creates the award
definition and its 46 winner rows from canonical facts alone on a database built from nothing but
adjudicated snapshots, and passes every Stage-9 gate. G7 was the last unproven gate; **all ten are
now proven** (§9).

**Does not settle, and is out of scope by §11.** The `--rekey-coleman` transition has still been
executed only against a manufactured legacy family (pass 6/7, `46 updated / 0 inserted / 0 deleted`,
every id preserved). `afldb_dev` and production still hold the real `draftguru`-keyed Coleman rows;
running the transition there is a deployment action documented in `docs/deployment.md` §7, not part
of this issue.

### 33.7 State after pass 21

`afldb_test` was intentionally destroyed and canonically rebuilt by the operator and now holds the
derived Coleman family. `afldb_dev` and production were not contacted. No Git command was run and
`D:\dev\afldb` was not touched. Repository files changed by this pass: `issues.md` (Status
Resolved, Resolved 2026-08-30, Files actual, Validation gate table, Resolution; row removed from the
Open Issues table and the count corrected 5 → 4), `IssuesIndex.md` (ISSUE-111 row removed, count
corrected, the parent ISSUE-102 row's two now-stale ISSUE-111 statements resynchronised),
`CHANGELOG.md` (the `Unreleased` closeout entry), this record and
`issues/open/AFLDB-ISSUE-111-HANDOFF.md`.

**This record and the handoff remain in `issues/open/` deliberately**, although the issue is
Resolved: the parent `AFLDB-ISSUE-102` is still open and cites `issues/open/AFLDB-ISSUE-111.md` in
eight places across its own runbook and handoff. Moving them to `issues/closed/` means editing
parent records that this session was fenced off from, so it is left as a one-line act for the
ISSUE-102 closeout.

**Remaining before the operator commits:** one confirmation block — the ISSUE-111 integration suite
re-run against the rebuilt database (expect 29 of 29) and the `npx tsc --noEmit` owed since passes
4–7 added TypeScript to `tests/integration/awards-reload-links.test.ts`. Neither is a gate: the
gates are proven above. They are the pre-commit proof that the retained implementation and tests
still hold against a canonically rebuilt `afldb_test`. A failure in either **reopens this issue**;
it does not license relaxing a gate.

## 34. Pass 22 (2026-08-30) — Step 5 EXECUTED: the pre-commit confirmation PASSED

**§5 Step 5 was run by the operator and PASSED on both legs.** It was the last owed action on
this issue. It is not a gate — every §9 gate was already proven in §33 — it is the proof that the
retained implementation and tests still hold against the **canonically rebuilt** `afldb_test`.

### 34.1 Environment, proven before either leg ran

| Fact | Value |
|---|---|
| `AFLDB_PYTHON` | `D:\dev\afldb-issue-102\.venv\Scripts\python.exe` |
| `psycopg` | importable by that interpreter |
| `AFLDB_TEST_DATABASE_URL` | database `afldb_test`, role `afldb_owner`, host `127.0.0.1` |
| `AFLDB_TEST_IMPORT_DATABASE_URL` | database `afldb_test`, role `afldb_import`, host `127.0.0.1` |

This matters because the suite **skips rather than fails** when `canRunFixtureImporter` is false
(`awards-reload-links.test.ts:53-81`). The proof block refused-or-proceeded before running, so a
silent all-skip could not be mistaken for success.

### 34.2 Leg 1 — the ISSUE-111 integration suite against the rebuilt database

```
npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"

Test Files  1 passed (1)
Tests       29 passed | 24 skipped (53)
leg 1 exit code: 0
```

**29 passed, 0 failed** — the number that matters, and the same 29 that passed against the
pre-rebuild database in pass 8. All five ISSUE-111 groups are green:

| Group | Cases |
|---|---|
| Coleman canonical match-fact derivation (incl. the independent PostgreSQL oracle) | 9 |
| Synthetic derivation rules — tie, multi-club, in-progress, finals exclusion, span boundary | 6 |
| Durable-identity refusals (G5a) | 4 |
| Legacy → derived transition, with id preservation | 6 |
| Human-link-decision preservation across the derived reload | 4 |
| **Total** | **29** |

The 24 skipped are the file's non-ISSUE-111 cases: those the `-t` filter excludes plus the legacy
describes gated on `AFLDB_LEGACY_SQLITE`, which is deliberately unset. **29 + 24 = 53, which is
exactly the number of `it()` cases in the file**, so every case is accounted for and none was lost.
(The Step 5 block predicted "49 cases / ~20 skipped"; that total was a stale estimate written before
the pass-7 describe was appended. The pass criterion — 29 passed, 0 failed, exit 0 — is met exactly.)

### 34.3 Leg 2 — the typecheck owed since passes 4–7

```
npx tsc --noEmit

leg 2 exit code: 0
```

No output, exit 0. This clears §7b: passes 4–7 added five describes, async fixture helpers,
module-level snapshot readers and a twice-widened `ColemanContract` type to
`tests/integration/awards-reload-links.test.ts`, and the last clean typecheck was the end of pass 1.
The whole worktree now typechecks clean.

### 34.4 Verdict

**`AFLDB-ISSUE-111` remains RESOLVED, dated 2026-08-30.** Nothing reopens. Nothing further is owed
on this issue: the ten §9 gates hold (§33), the pre-commit confirmation holds (this section), and
the durable records — `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, this runbook and the handoff —
are closed out.

### 34.5 State after pass 22

No database was mutated, no migration ran, no snapshot byte was read or written, no network was
used, no Git command was run, `afldb_dev` and production were not contacted, and `D:\dev\afldb`
was not touched. Repository files changed by this pass: **this record** and
`issues/open/AFLDB-ISSUE-111-HANDOFF.md` only — the Step 5 result and the landing manifest. No
source, test, contract, manifest, migration, privilege, `CHANGELOG.md`, `issues.md` or
`IssuesIndex.md` file was changed, because the resolution they already record is unaltered.

**The work is now landing-ready.** The operator owns staging, commit, push and merge; the exact
landing manifest is in `issues/open/AFLDB-ISSUE-111-HANDOFF.md`.

## 23. Status

*(Previously numbered §13, then §22; §14–§22 and §24–§33 were appended above it so the status
stays last.)*

# STATUS: RESOLVED — 2026-08-30

**Every acceptance gate in §9 is proven: G0, G1, G2, G3, G4, G5, G5a, G6, G7, G8 and G9.** The
last of them, **G7**, passed on 2026-08-30 when the operator's destructive canonical rebuild of
`afldb_test` completed **exit 0** with the `coleman` stage reporting
`46 winners (46 seasons, 0 updated, 46 inserted, 0 deleted)` and FINAL VALIDATION returning
`AFLDB-FINAL-VALIDATION PASSED: 26 checks`, including all seven Stage-9 Coleman gates (§33).

`issues.md` records Status **Resolved**, Resolved **2026-08-30**, the actual file list, the
gate-by-gate validation table and the Resolution. ISSUE-111 is removed from `IssuesIndex.md` and
from the Open Issues table (5 → 4 open), and `CHANGELOG.md` carries the `Unreleased` closeout entry.

**Out of scope and still true:** the `--rekey-coleman` transition has been executed only against a
manufactured legacy family. `afldb_dev` and production still hold the real `draftguru`-keyed Coleman
rows; running the transition there once, before the derived loader runs, is a deployment step
(`docs/deployment.md` §7), not ISSUE-111 work. Skipping it does not fail loudly — it silently
duplicates the family.

**The pre-commit confirmation is DONE and PASSED (2026-08-30, §34).** The ISSUE-111 integration
suite re-ran against the canonically rebuilt `afldb_test` — `29 passed | 24 skipped (53)`,
**leg 1 exit code 0** — and `npx tsc --noEmit` returned no output, **leg 2 exit code 0**, clearing
the typecheck owed since passes 4–7. **Nothing is owed on this issue.** It is landing-ready; the
operator owns staging, commit, push and merge, and the exact landing manifest is in
`issues/open/AFLDB-ISSUE-111-HANDOFF.md`.

The history below is retained unedited.

---

**Design COMPLETE. Implementation pass 1 written and DB-free-validated (§14). Pass 2 added
the derived-load integration boundary (§15). Pass 3 executed it and fixed the G2 oracle (§16).
Pass 4 re-ran it — 9 of 9 — and added the derivation-rule fixtures (§17). Pass 5 executed
those — 15 of 15 — and wrote the G5a identity-refusal block (§18). Pass 6 executed everything —
19 of 19 — and wrote the legacy → derived transition suite (§19). Pass 7 executed everything —
25 of 25 — proving the transition, and wrote the decision-survival block (§20). Pass 8 executed
everything: 29 of 29 PASSED, so the human-decision guarantees are proven too, and the whole
ISSUE-111 integration suite is complete (§21).**

All design questions are resolved: G0 PASS (span 1980), G1 PASS, G3 PASS with explained identity
reconciliation, G4 DECIDED, **G5 RESOLVED** (§5), **G6 transition design RESOLVED** (§7.1).

**ISSUE-111 is NOT blocked.** The remaining gates are implementation and validation gates, not
design unknowns. **G2, G4, G5, G5a, G8, G9, the legacy → derived transition and both halves of
the player-link audit are PASSED against `afldb_test`**, as are the tie, multi-club, in-progress,
finals-exclusion and span-boundary rules (§18.1, §19.1, §20.1, §21.1). **Every row of the §10
test matrix now carries runtime evidence.** Still unrun: **G7**, the canonical rebuild (§21.2),
then one `npx tsc --noEmit`, `CHANGELOG.md` and the ledger closeout.

**G7 was ATTEMPTED in pass 9 and REFUSED during the fitzRoy preflight, before any destructive
action (§22).** The cause is a missing acquired snapshot in this worktree — `data/sources/` does
not exist, because raw snapshots are deliberately gitignored — not an ISSUE-111 derivation
problem. `afldb_test` was not destroyed and nothing Coleman-related is implicated. **G7 is
BLOCKED on a rebuild-environment prerequisite** (three acquired snapshots: fitzRoy
`full-history-20260827`, ladder `ladder-20260828`, DraftGuru `annual-html-20260826`), tracked
here rather than as a new issue because it is a local checkout state, not a repository defect.

**Pass 10 (§24) established the prerequisite state from source, running no command.** The
operator's read-only inventory found fitzRoy `full-history-20260827` (131 files, probe hash
matching) and DraftGuru `annual-html-20260826` (90 files) in `D:\dev\afldb`, and the ladder
witness `ladder-20260828` in **neither** checkout. The DraftGuru count is **expected**: "42 year
pages" counts raw year pages, and the accepted snapshot holds 42 raw + 42 http + 2 robots + 4
parsed = **90** (§24.4). Both present snapshots are safe to copy because each is re-adjudicated
against this worktree's tracked manifests and fails closed (§24.5). The ladder witness is the
live blocker: it is a hard preflight gate, its bytes are in no Git history and no documented
cache, and `acquire_core.R:195-199` **refuses** to re-acquire under the accepted label because
its manifest is tracked — so the re-acquire command printed by the preflight and the validator
cannot run as written (§24.2). **Next action: the §5 Step 1b read-only search for a moved-aside
or sibling-worktree copy of the ladder bytes** (probe `ladder_1897.csv` = `0470c6e5…7df1`); the
three outcomes and their consequences are §24.7.

**Pass 11 (§25) received that search's result and designed the recovery, running no command.** The
operator found **no `ladder_1897.csv` and no `ladder*` directory anywhere under `D:\dev` or
`D:\backups`**, and no alternate accepted ladder snapshot in any worktree — **§24.7 outcome 3**. The
DraftGuru directory measured exactly the expected 42/42/2/4 = 90 layout with no `raw/years` strays,
so it is confirmed sound. **The canonical rebuild is blocked solely on the ladder witness bytes**,
and the ladder witness gate must not be weakened or bypassed. Pass 11 established from source: the
acquisition is `acquire_core.R --acquire --label <NEW> --datasets ladder --from 1897 --to 2025`
(a new label is forced by `:195-199`; `--to 2025` is mandatory because `--to` defaults to the current
year); it needs `Rscript`, **fitzRoy exactly 1.8.0** (never `--allow-version-mismatch`), `jsonlite`
and **`digest` or `openssl`**; it touches **network and `data/sources` only, with no database access
at all**, plus one new untracked manifest under `docs/rebuild-manifests/` that must be deleted after
adjudication; and it must produce **129 files, 1897–2025, 1,622 rows**. The candidate is then
adjudicated **file-by-file against the tracked `ladder-20260828.json`** — all 129 filenames present,
all 129 sha256 equal, no extra file — and **never** by pointing the validator at the temporary label,
which fails two contract-binding checks by construction. Only that exact outcome permits the
directory to be renamed to `ladder-20260828`, proven by
`validate_ladder_witness.py --label ladder-20260828` (26 checks, exit 0). **If even one file differs
the recovery fails closed**: the accepted manifest, its `manifest_sha256` and the witness label are
never updated to accommodate fresh upstream bytes — that is an ISSUE-101 successor decision outside
ISSUE-111's scope. **Next action: the offline R / fitzRoy prerequisite preflight (§25.10), before any
network acquisition.**

**Pass 12 (§26) adjudicated the failed Step 1c preflight**, and **passes 13–15 (§27) cleared both of
its findings**: the R toolchain is proven (R 4.6.1, **fitzRoy exactly 1.8.0**, `jsonlite` and
`openssl` load, no reproducible segfault) and **`AFLDB-ISSUE-114` is RESOLVED** — the contract literal
is the canonical LF hash, value-asserted, and the DB-free suite is **214 passed, 0 failed**.
**G7 is now blocked on exactly one thing: the ladder witness BYTES.**

**Pass 16 (§28): the acquisition SUCCEEDED.** §5 Step 1d ran under the temporary label
`ladder-recover-20260830` and produced **129 files, 1897–2025, 1,622 rows**,
`acquisition_kind: validation_witness`, `completeness: unvalidated`, with no database contact, no Git
and no production access. **Those bytes are UNTRUSTED**, and neither their counts nor their own
manifest is evidence. **Next action: handoff §5 Step 1e** — the read-only, file-by-file SHA-256
adjudication against the tracked `ladder-20260828.json`, reporting expected / present / matched /
missing / mismatched / unexpected. **Only `129 / 129 / 129 / 0 / 0 / 0` permits the recovery to
continue** (rename to `ladder-20260828`, delete the temporary manifest, then
`validate_ladder_witness.py --label ladder-20260828`); anything else fails closed per §25.8, with the
accepted manifest, its `manifest_sha256` and the witness label never updated. **No adjudication has
been performed, and nothing has been moved, copied, renamed or deleted.**

**Pass 17 (§29): the adjudication PASSED — `expected 129 / present 129 / matched 129 / missing 0 /
mismatched 0 / unexpected 0`, with the tracked manifest's `Get-FileHash` equal to the contract's
accepted `manifest_sha256` (`604a8a16…8d3f`) and candidate rows 1622 = accepted rows 1622.** The
reacquired witness is **byte-for-byte identical to the accepted `ladder-20260828` witness**, so it is
the accepted witness reproduced, **no successor-witness decision arises**, and the accepted manifest,
its `manifest_sha256`, `accepted_witness` and `ladderWitnessLabel()` remain untouched. **Next action:
handoff §5 Step 1f** — one operator block that fails closed if the canonical target already exists or
the candidate/temporary manifest is missing, renames `ladder-recover-20260830` → `ladder-20260828`,
deletes **only** the temporary acquisition manifest, and runs
`validate_ladder_witness.py --label ladder-20260828`, expecting **26 PASS, 0 FAIL, `All checks
passed.`, exit 0** — offline, no database and no network. **G7's ladder-witness blocker is then
cleared**, leaving §5 Step 2 (copy the fitzRoy and DraftGuru snapshots in), §5 Step 3 (three offline
validators) and §5 Step 4 (the rebuild) as later slices.

**Pass 18 (§30): the promotion SUCCEEDED and the ladder witness is CANONICAL.** §5 Step 1f passed its
preconditions (accepted manifest `604a8a16…8d3f`, candidate 129 files), promoted the adjudicated
candidate by **one rename** to `data\sources\afltables\fitzroy_core\ladder-20260828` (129 files
present after), deleted **only** the temporary acquisition manifest, left the accepted manifest
present and unchanged, and then proved the result:
`validate_ladder_witness.py --label ladder-20260828` = **26 PASS / 0 FAIL, `All checks passed.`,
exit 0** — accepted witness binding, exactly 129 ladder files, manifest rows 1622, every manifest
SHA-256 matching disk, every row count and the exact eight-column schema, coverage exactly
1897–2025, and all 1,622 historical label-season pairs resolving. Offline: no database, no network,
no Git, no production. **`AFLDB-ISSUE-114`'s repair and these bytes were the two halves of the same
gate and both now hold, so G7's ladder-witness blocker is CLEARED**; the accepted manifest, its
`manifest_sha256`, `accepted_witness` and `ladderWitnessLabel()` remain untouched, and Step 1f must
not be re-run (it now correctly refuses on its first precondition). **Next action: handoff §5
Step 2** — ONE operator block that copies the two remaining prerequisites from `D:\dev\afldb` into
the same worktree-relative paths, whole and nothing pruned: fitzRoy `full-history-20260827`
(**131 files**) and DraftGuru `annual-html-20260826` (**90 files**). Both labels are read from
tracked source (`fitzroy-accepted-baselines.json:57-64`, `rebuild-test.ts:1124`), never typed; the
block fails closed if either destination exists, either source is missing or either source count is
wrong, copies no other label, touches no tracked file, contacts no database or network, runs no Git,
and leaves `ladder-20260828`'s 129 files measured-but-untouched. Copy safety is structural (§24.5):
every byte is re-adjudicated in §5 Step 3, so a partial or polluted copy fails closed there rather
than corrupting a rebuild. Then §5 Step 3 (three offline validators, exit 0, DraftGuru reporting 42
year pages / 5057 persons / 6810 picks), §5 Step 4 (the rebuild), one re-run of the integration
command (expect 29/29), `npx tsc --noEmit`, `CHANGELOG.md` and the ledger closeout.

**Pass 19 (§31): the Step 2 copy SUCCEEDED and ALL THREE SNAPSHOT PREREQUISITES ARE NOW PRESENT.**
Labels were read from tracked source; the sources measured 131 / 90 in `D:\dev\afldb`; the ladder
witness measured 129 before; both directories were copied whole with **131** and **90** files present
after; the `player_stats_1897.csv` probe SHA-256 **matched** the tracked manifest; the ladder witness
measured **129 after, unchanged**; and exactly the labels `full-history-20260827`, `ladder-20260828`
and `annual-html-20260826` are present. No `REFUSED` line, no count mismatch, no database, no Git, no
production, no manifest or contract change. **`data/sources/` now holds exactly the three
prerequisite snapshots and nothing else, so G7's snapshot blocker is CLEARED** and the pass-9
refusal cannot recur for the same reason. The copied bytes remain **unadjudicated**: the single probe
hash proves 1 of 131 files. **Next action: handoff §5 Step 3** — ONE operator block running the three
offline canonical validators in order and **stopping on the first non-zero exit**, refusing before
any of them if a snapshot directory is absent or miscounted: (1)
`import_fitzroy_core.py --label full-history-20260827 --validate-only --require-accepted-baseline`,
expecting `full-history gates PASSED — identity coverage` (`rows 685473`, `missing_url 0`,
`malformed_url 0`, `distinct_urls 13275`) and `accepted canonical baseline VERIFIED`
(`manifest_sha256 a42c6d5f…21d09`, `artefact_set_sha256 8e14ce61…f4125`, `raw_artefacts 131`,
`acquired_rows 719042`, `contract_version 1`) over a scan summary of `matches 16838` /
`players 13275` / `player_match_rows 685471` / `seasons 1897-2025`; (2)
`validate_ladder_witness.py --label ladder-20260828`, expecting **26 PASS / 0 FAIL, `All checks
passed.`, exit 0** with **no** section 5 (`--compare` unused, so no database is touched); (3)
`import_draftguru.py --validate-only`, expecting **42 year pages, sha256 verified / persons 5057 /
picks 6810 / ledger 6 / bridge 0** and `validate-only: every input check passed. No database was
contacted.` All three are offline — no database, no network, no Git, and no snapshot copied, moved,
renamed, generated or deleted. **Three exit-0 results are what proves the rebuild will get past
PRECHECK**; any other result STOPS the slice, is reported verbatim, and changes nothing — no
re-copy, no pruning, and no edit to any manifest, contract, register or validator. Then §5 Step 4
(the rebuild), one re-run of the integration command (expect 29/29), `npx tsc --noEmit`,
`CHANGELOG.md` and the ledger closeout.

**Pass 20 (§32): the Step 3 adjudication PASSED — ALL THREE OFFLINE VALIDATORS RETURNED EXIT 0.**
Inventory 131 / 129 / 90; fitzRoy `full-history gates PASSED — identity coverage` (`rows 685473`,
`missing_id 83`, `missing_url 0`, `malformed_url 0`, `distinct_ids 13270`, `distinct_urls 13275`)
and `accepted canonical baseline VERIFIED` (`a42c6d5f…21d09`, `8e14ce61…f4125`, `raw_artefacts 131`,
`acquired_rows 719042`, `contract_version 1`) over the predicted scan summary, in 20.8 s with **no
database access**; ladder `ladder-20260828` **26 PASS / 0 FAIL**, 129 files, manifest rows 1622,
coverage 1897–2025, all 1622 label-season pairs resolving, `All checks passed.`, no section 5;
DraftGuru **42 year pages sha256 verified / persons 5057 / picks 6810 / ledger 6 / bridge 0**,
`every input check passed. No database was contacted.` These are the same three checks
`runPreflight()` re-runs, so **the input prerequisite is CLOSED, the rebuild is expected to pass
PRECHECK, and G7 is blocked on nothing but execution.** **Next action: handoff §5 Step 4** — ONE
operator block that first proves the environment and only then destroys: the interpreter
`AFLDB_PYTHON=D:\dev\afldb-issue-102\.venv\Scripts\python.exe`, `psql` on `PATH` (both the reset and
FINAL VALIDATION run through it), `AFLDB_TEST_DATABASE_URL` → **`afldb_test | afldb_owner`** and
`AFLDB_TEST_IMPORT_DATABASE_URL` → **`afldb_test | afldb_import`** — the last is proved by the block
because **the harness checks only that both DSNs name the same `afldb_test`, never which role either
connects as** — resolved the way `main()` resolves them (process environment first, `.env` only as a
fallback, `:1154-1162`), printing database/role/host and never a password; then
`npm run db:test:rebuild -- --acknowledge-destroy afldb_test`. **It is destructive to `afldb_test`
and to nothing else**: the target-name gate (`:153-176`), the acknowledgement echo (`:232-241`,
consumed only after the preflight) and the explicit `AFLDB_IMPORT_DATABASE_URL` overlay (`:402`,
`:1176`) together make `afldb_dev` and production unreachable. **Expected evidence:** the
`COLEMAN — leading home-and-away goalkicker, derived` stage between `DERIVED` and `LADDER WITNESS`
reporting `coleman winners 46 (46 seasons, **0 updated, 46 inserted, 0 deleted**)` — INSERT, because
a canonically rebuilt database holds no `awards` row at all and `coleman_award_id()`'s
create-if-missing branch runs for the first time ever — then the seven Stage-9 gates
`coleman_rows 46`, `coleman_seasons 46`, `coleman_first_season 1980`, `coleman_unlinked_rows 0`,
`coleman_rows_not_derived_from_afltables 0`, `coleman_rows_keyed_on_a_numeric_id 0`,
`coleman_after_accepted_last_season 0`, `AFLDB-FINAL-VALIDATION PASSED: <n> checks` and
`Rebuild complete.` **Neither 46 nor 1980 is hard-coded**: `colemanFirstSeason()` reads
`first_season: 1980` from `data/reference/coleman-derivation.json` and refuses rather than
defaulting, `colemanChecks()` takes `seasons_last: 2025` from the accepted register, and the span is
`2025 − 1980 + 1 = 46`. Four failure classes, three of which destroy nothing (§32.4): a PRECHECK
refusal (`REFUSED: …`, `afldb_test` intact — after Step 3 this would be new information); a failure
in a stage **before** Coleman (destroyed and partial, re-runnable, **not ISSUE-111 work**); a
**Coleman-stage** failure (first execution of the stage and of create-if-missing — report the
traceback, change no Coleman code, contract, gate or test); and a **final gate mismatch** (the
rebuild is FAILED — `coleman_rows 45` would mean `season_metadata` left 2025 `in_progress`, so
report the gate line and the season's status and **never relax the gate**). Then one re-run of
`npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` (expect 29/29),
`npx tsc --noEmit`, `CHANGELOG.md` and the ledger closeout.

The authoritative continuation for the implementing session is
`issues/open/AFLDB-ISSUE-111-HANDOFF.md`.
