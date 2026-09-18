# AFLDB-ISSUE-222 Phase 3 — operator sign-off pack (recommendations only, 2026-09-18)

**Phase 3 remains PENDING.** This pack analyses every mandatory recheck row using retained local
evidence and records a *recommended* verdict and reason per row. No `operator_verdict` has been
set on any row, and nothing here accepts Phase 3 or begins Phase 4. Companion files:
`bridge-review-signoff-20260918-v1.csv` (one row per mandatory recheck) and
`bridge-review-signoff-20260918-v1.json` (hash-linked structured decision pack).

Review method: offline retained-evidence comparison (decision O-4 revision 2) plus this
operator-exception/audit analysis. No network request, database connection, import, Playwright
session, or Git command was used to produce this pack.

## 0. A tool defect was found and corrected before this analysis

Both of the sample's original `BIRTH_YEAR_CONFLICT` rows (`darren_mead/1`, `tim_walsh/1`) showed
`implied_birth_year` exactly equal to the player's `debut_season` — an age-zero debut, which is
impossible. The cause: the accepted fitzRoy snapshot records a literal `Age = "0"` on some rows when
DOB is unknown (confirmed directly against the season CSVs — e.g. Darren Mead's 1997 and 1998
season-openers, Tim Walsh's single career game), and the review tool's `implied_birth_year`
computation used the earliest dated row's `Age` verbatim, sentinel included.

**Bounded population-wide check** (all offline, no network): scanned all 13,275 distinct fitzRoy
`player_stats` URLs for an earliest-dated-row `Age` of literal `"0"`. Found **78** such URLs
overall, of which **10** are among the 3,564 parent-bridged identities (`Colin_Garland`,
`Darren_Mead`, `Ezra_Poyas`, `Ian_McMullin`, `Lachie_Jones`, `Michael_Gallagher`, `Peter_Russo`,
`Robert_Copeland`, `Tim_Walsh`, `Tony_Francis`). The 997-row sample drew exactly 2 of those 10,
consistent with ~28% sampling coverage. No other outcome in the 997-row sample was affected by this
mechanism.

**Fix:** `tools/rebuild/draftguru/review_person_bridge_offline.py` — added `AGE_ARTIFACT_FLOOR =
5.0`; `implied_birth_year` now skips any dated row at or below the floor and uses the next valid
row, or `None` (never a guess) if every row is below it. `debut_date`/`debut_season`/`last_season`
are unaffected. `TOOL_VERSION` 1.0.0 → 1.0.1. Added 4 regression checks (§14 of
`tests/python/draftguru_offline_review_contract.py`) against a synthetic `Age="0"` fixture, proving
both the skip-and-fall-back behaviour and the "no valid row → `None`" behaviour, plus that
`debut_date` stays anchored to the true earliest row.

**Full rerun, twice:** identical `rows_sha256`
(`412f0b595d7cf068acee85d414d2aaf90217de871d4138908da1c67559a2eb53`). Totals moved from
`offline_strong` 959 / `offline_limited` 1 / `offline_contradict` 9 / `target_unregistered` 28 to
`offline_strong` **960** / `offline_limited` **2** / `offline_contradict` **7** /
`target_unregistered` **28** (unchanged) — 997 total, reconciles. `darren_mead/1` resolved cleanly
to `offline_strong` (corrected implied birth year 1971, an exact match to DraftGuru's title year)
and **left the recheck population entirely**. `tim_walsh/1` moved to `offline_limited`
(`BIRTH_YEAR_UNAVAILABLE` — its only dated row is itself the artifact, so no valid retained age
evidence exists at all for this identity; games 1/1, club and debut timing still corroborate).
v1 outputs are retained unmodified as superseded evidence; v2 outputs are the new, current record.
The immutable sample/parent/child kept their v1 paths and hashes throughout — this was a tool
correction, not an input change.

Validation: both Python contracts green (including the 4 new checks); `py_compile` clean;
`npx vitest run tests/draftguru-acquisition.test.ts tests/match-backtest-compare.test.ts` → 187
passed / 1 failed (pre-existing `AFLDB-ISSUE-223`, confirmed unrelated) / 3 skipped — identical to
the prior pass; `npx tsc --noEmit -p .` clean.

## 1. Recheck population and outcome totals

- **111** distinct mandatory recheck rows under v2 (112 under v1, before Darren Mead's exit).
- Machine outcomes among the 111: `offline_strong` 74, `target_unregistered` 28,
  `offline_contradict` 7, `offline_limited` 2.
- Recommended-verdict totals: **agree 76**, **withhold 24**, **contradict 7**,
  **source_discrepancy_same_person 4**. (76 + 24 + 7 + 4 = 111.)
- All 997 rows carry terminal offline outcomes; 30-row audit set unchanged between v1 and v2.

## 2. The contradiction cases (originally 9, now 7 genuine)

### 2.1 The two birth-year conflicts — resolved as an age-calculation boundary issue, not a wrong bridge

Both are the tool defect in §0, not different-person contradictions:

| Identity | DraftGuru | Retained (before fix) | Retained (after fix) | Disposition |
|---|---|---|---|---|
| `darren_mead/1` → `Darren_Mead.html` | born 1971; 122 games, 8 goals; clubs Essendon→Brisbane→Port Adelaide (1988–1996 draft rows) | implied birth year 1997 (= debut season; the artifact) | implied birth year **1971** (exact match); 122 games, 8 goals, Port Adelaide — all match | **Resolved upstream**: now `offline_strong`, no longer a recheck row |
| `tim_walsh/1` → `Tim_Walsh.html` | born 1985; 1 game, 1 goal; Western Bulldogs 2002 pick 4 | implied birth year 2005 (= debut season; the artifact) | implied birth year **None** (only dated row is the artifact; honestly missing, not guessed) | `offline_limited`; recommend **agree** — games (1/1) and club (Western Bulldogs) match exactly, debut (2005) not before recruitment (2002) |

### 2.2 The seven career-ended-before-recruitment cases — genuine contradictions, source-side (DraftGuru), not an AFLDB or tool defect

All seven share one identical, hand-confirmed signature: **DraftGuru's own capture records 0 career
games** for that specific drafted entry (i.e. by DraftGuru's own data this drafted person never
played a senior game), while the captured href resolves to an **unrelated, already-established**
AFL/VFL player whose retained career ended before the draft year:

| Identity | Draft event (0 games/0 goals per DraftGuru) | Retained player's actual career (unrelated) |
|---|---|---|
| `peter_whyte/1` | 1990 National pick 68, Brisbane | 1986–1988, 22 games, Geelong |
| `craig_somerville/1` | 1988 Trade, Brisbane | 1986, 8 games, Footscray |
| `bret_hutchinson/1` | 1989 Pre-Season pick 38, West Coast | 1985, 1 game, Melbourne |
| `tim_bourke/1` | 1991 Trade, North Melbourne | 1989–1990, 5 games, Geelong |
| `david_williams/1` | 1989 Pre-Season pick 7, Richmond | 1983–1988, 67 games, Melbourne |
| `simon_taylor/1` (suffix `Simon_Taylor0.html`) | 1991 Pre-Season pick 30, Fitzroy | 1989, 2 games, Collingwood |
| `glen_bartlett/1` | 1989 Mid-Season pick 38, Brisbane | 1987, 4 games, West Coast |

Each of the 7 was checked for a tool defect first (an earlier stage_a row wrongly skipped as the
"earliest original recruitment"): **none exists** — every one of these 7 DraftGuru person-pages
carries only a single captured draft row, so there is nothing for the tool to have chosen wrongly.
The mismatch is DraftGuru's own href assignment: when a drafted player never plays a senior game,
AFL Tables typically has no dedicated profile for him, and DraftGuru's site appears to fall back to
an unrelated same-named, already-retired player's existing profile instead of leaving the href
absent. Recommended verdict: **contradict** for all 7 (agrees with the machine outcome) — the
bridge for each of these specific DraftGuru identities should remain withheld.

## 3. Numbering and spelling exceptions — strong evidence beyond name, routed to curation, not auto-applied

Checked all 4 directly against the accepted snapshot (offline, no network):

| Identity | Href asserts | Snapshot actually has | Corroboration (beyond name) |
|---|---|---|---|
| `tom_murphy/1` | `Tom_Murphy.html` (plain, absent) | `Tom_Murphy0.html` + `Tom_Murphy1.html` (suffixed; `1` already bridged via `tom_murphy/2`) | games 113/113 exact; birth year ≈1986 exact; clubs Hawthorn→Gold Coast exact |
| `joel_smith/1` | `Joel_Smith.html` (plain, absent) | `Joel_Smith0.html` + `Joel_Smith1.html` (suffixed) | games 221/221 exact; birth year ≈1977 exact; clubs St Kilda→Hawthorn exact |
| `josh_smith/1` | `Josh_Smith.html` (plain, absent) | `Josh_Smith0.html` + `Josh_Smith1.html` (suffixed) | games 11/11 exact; birth year ≈1986 exact; club North Melbourne exact |
| `stephen_schwerdt/1` | `Steven_Schwerdt.html` (misspelled, absent) | `Stephen_Schwerdt.html` (correct spelling; DraftGuru's own captured page already displays "Stephen") | games 25/25 exact; birth year 1968 exact; club Adelaide exact; span 1992–1994 |

AFL Tables retroactively suffixes every name shared by 2+ players, and DraftGuru's captured hrefs for
these four use a form (plain-unsuffixed, or a single-letter misspelling) that does not exist in the
accepted snapshot. Each corrected identity is corroborated by three independent signals beyond name
— exactly the standard the offline tool itself requires for `offline_strong`. **Recommended verdict:
`source_discrepancy_same_person` for all 4.** Because the existing bridge contract joins on the
literal captured href only (no suffix-fallback, no fuzzy spelling), and D-9 prohibits name-only
matching, this pack does **not** recommend auto-applying these corrections through the automated
bridge; it recommends routing all 4 to operator player-link curation, naming the exact corrected
identity above. The machine outcome (`target_unregistered`) is left unchanged for all 4.

## 4. The offline-limited row not covered above

`keith_thomas/2` → `Keith_Thomas1.html`: a numeric-suffix identity with no club overlap (DraftGuru's
sole draft club, Melbourne 1982, versus the retained club, Fitzroy) — correctly not `offline_strong`
under the suffix rule. Birth year (1961/1961 exact) and games (28/28 exact) both corroborate
strongly. Recommend **agree**.

## 5. The 24 remaining `target_unregistered` rows — recommend withhold

All 24 are 2023–2025 DraftGuru draft entries with **no retained evidence at all** (absent from the
accepted snapshot's 13,275-URL set through season 2025), consistent with the measured finding
(correction handoff §10.3) that every `target_not_registered` path is simply not yet in the accepted
historical baseline — not a staleness or misregistration defect. Recommend **withhold** for all 24;
no forced match. Full list and per-row draft year: see the CSV/JSON.

## 6. The 30-row deterministic audit — confirmed clean

Every one of the 30 audit rows' retained evidence (birth year vs. DraftGuru title year, games/goals
vs. Stage A parity figures, debut season vs. earliest original recruitment, club history overlap)
was independently re-read and manually recomputed against runbook §5's rules — not merely accepted
from the machine's `offline_strong` label. **All 30 confirm cleanly; no disagreement found.**
Informational codes present on some rows (`GAMES_INCONSISTENT`, `DEBUT_BEFORE_EARLIEST_RECRUITMENT`,
`BIRTH_YEAR_CONSISTENT_TOLERANCE`) are correctly non-blocking per the runbook and do not indicate a
problem. The audit set is unchanged between v1 and v2 (the tool fix did not touch any audit-pool
member). Reported here as one auditable group, per the task's own instruction, rather than 30
individual narratives — full row-level evidence is preserved in the CSV/JSON.

## 7. The 10 name-variant rows and the remaining weak/suffix/continuity rows — recommend agree

The 10 listed name-variant pairs (`dan_curtin`, `matthew_scharenberg`, `ed_allan`,
`harrison_jones/1`, `harrison_jones/2`, `lachlan_fogarty`, `ollie_hanrahan`, `lachie_bramble`,
`lachie_sullivan`, `matt_cottrell`) and the remaining weak-evidence / numeric-suffix / continuity-
rule rows (`jack_graham/3`, `jack_ross/3` and the other suffixed identities) all corroborate
correctly on the retained facts (birth year, games, club overlap where required). Recommend
**agree** for all.

## 8. Minimal operator decision table

Only these **11 rows** genuinely require operator judgement (contradict, or strongly-evidenced but
not auto-appliable source discrepancies); the other 100 rows are mechanical `agree`/`withhold`
dispositions an operator can confirm quickly from the CSV:

| player_url | machine outcome | recommended | why it needs a human call |
|---|---|---|---|
| `peter_whyte/1` | offline_contradict | contradict | confirm withhold — DraftGuru mislink (0-game draftee vs. retired namesake) |
| `craig_somerville/1` | offline_contradict | contradict | same |
| `bret_hutchinson/1` | offline_contradict | contradict | same |
| `tim_bourke/1` | offline_contradict | contradict | same |
| `david_williams/1` | offline_contradict | contradict | same |
| `simon_taylor/1` | offline_contradict | contradict | same |
| `glen_bartlett/1` | offline_contradict | contradict | same |
| `tom_murphy/1` | target_unregistered | source_discrepancy_same_person | decide whether to curate the link to `Tom_Murphy0.html` |
| `joel_smith/1` | target_unregistered | source_discrepancy_same_person | decide whether to curate the link to `Joel_Smith0.html` |
| `josh_smith/1` | target_unregistered | source_discrepancy_same_person | decide whether to curate the link to `Josh_Smith0.html` |
| `stephen_schwerdt/1` | target_unregistered | source_discrepancy_same_person | decide whether to curate the link to `Stephen_Schwerdt.html` |

## 9. Confirmations

- All 997 rows carry terminal offline outcomes (v2); exactly 111 distinct mandatory recheck rows.
- 30/30 audit rows confirmed, deterministic, unchanged between v1 and v2.
- No `operator_verdict` has been set on any row — all remain `null`.
- No network request, database connection, import/link action, Git command, or DEV/PROD action
  occurred while producing this pack.
- Phase 3 remains **PENDING** operator sign-off. Phase 4 has not begun. `AFLDB-ISSUE-221.md` was not
  touched.
