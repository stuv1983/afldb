# ISSUE-316 C2 quarter-score reconciliation — 2026-10-21

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `67fe0606cbdba0b2` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. The offline arithmetic was re-measured at retention from the rehearsal package CSVs (240,672 quarter cells, 0 failures of points = 6×goals + behinds, 0 non-monotone, 0 Q4 ≠ final). "Owner acceptance PENDING" below is history: N3 (2026-10-22) accepts the Q1–Q4 consistency fact as evidence for proposal drafting only. Extra time stays unknown (N4); an empty cell is never zero. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Internal consistency: PASS. Owner acceptance PENDING; production NO-GO.** No unexplained discrepancy was found in the authorised 218 match groups. Extra-time applicability remains **BLOCKED / not established**, independently of the successful empty-value preservation check.

## 1. Scope and provenance

One agent; bounded offline, in-process filesystem reads, SHA-256 and CSV parsing only. The target was absent before work and created exclusively. Implementation basis is `4a2eea89cccc465f2f017fb06ad55a7d4cb7733d`, reusing the established provenance in [linkage review §11](issue316-c2-linkage-review-2026-10-21.md#11-provenance-reconciliation-and-parsed-linkage-verification--2026-10-21-later-session-supersedes-10s-failblocked-conclusions). No Git/current-HEAD, archive, full-tree or host verification was repeated. Candidate interpretation uses the hash-bound **rehearsal-only** contract, not the repository contract; it remains a test artifact.

Read the repository AGENTS.md, [field worksheet](issue316-c2-field-review-2026-10-21.md) and linkage review §11. No graph tools were available; exact retained paths and narrowly selected source ranges supplied the code evidence. No importer or retained script was executed or imported. The JavaScript analysis ran in memory using Node filesystem/crypto APIs; no shell or child process was used.

`S` = `C:/tmp/afldb-c2-brownlow-fix-20261021/REHEARSAL-ONLY-source/`. Every consumed retained input was read as bytes and hashed before interpretation. All expected and observed hashes below are equal. Repository navigation/tracking records are not raw-data acceptance bindings.

| S-relative input | Verified SHA-256 | Recorded binding |
|---|---|---|
| data/reference/clubs.json | `9aaa8d4688206d03b0960bd03dcda199a642c5f7343570cc8bc2d439f5674f32` | Linkage §11.1 (commit/archive/bundle/inventory/S equality) |
| tools/migration/import_fitzroy_core.py | `4786d336349170bce6b210fceeb6f72de79d8eebc1471b79e25a8f9e18e75cc5` | Linkage §11.1 (commit/archive/bundle/inventory/S equality) |
| tools/rebuild/fitzroy/fitzroy-contract.json | `a0c01bc285b98c902d2a64b37ded687d2ac552cb71edc5bf9cc6459a7053cfb8` | Linkage §11.2; worksheet §2 |
| docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json | `02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988` | Worksheet §2; CSV entries also checked in the verified manifest |
| data/sources/afltables/fitzroy_core/c2-2026-final-core-v1/results.csv | `73769e3ef608103c6c4e7ac6f58ce82484f85bd8058955ec502a9d64cb834f52` | Worksheet §2; CSV entries also checked in the verified manifest |
| data/sources/afltables/fitzroy_core/c2-2026-final-core-v1/player_stats_2026.csv | `79db69732ea1018b577e548622e6c702c1a79270478cc019dc80571fc217898f` | Worksheet §2; CSV entries also checked in the verified manifest |

The verified manifest agrees with both CSV hashes, exact header order and row counts. Results: 17,056 rows, 16 columns; 218 rows in 2026. Stats: 10,028 rows, **81 columns**, every row full width and Season 2026. The worksheet's 78-column statement is superseded by linkage §11.5 and this parsed measurement. No historical statistical comparison was repeated.

## 2. Evidenced field semantics

All line references below are in the hash-verified S/tools/migration/import_fitzroy_core.py:

- Lines 220–223 define exactly 24 fields: H/A × Q1–Q4 × G/B/P, ordered side, quarter, kind.
- Lines 1545–1551 identify these as repeated match-grain team scores that must agree between player rows; lines 1626–1630 enforce tuple equality.
- Lines 1942–1958 explicitly state **cumulative-to-date** team scores, preserving NULLs, and emit periods 1–4. The docstring says the historical path deliberately excludes fitzRoy extra-time columns.
- Lines 3078–3097 again state cumulative-to-date and write the corresponding goals, behinds and points unchanged; a fully NULL side/period writes no row.
- The rehearsal contract's source-club/row-correction rules are unchanged under linkage §11.2 and do not target these 2026 quarter cells. Its period-availability note is not used to infer ET applicability from an empty cell.

Thus Q1–Q4 are cumulative observations, not incremental scores to sum. Arithmetic uses P = 6×G + B at each quarter. Progression requires nondecreasing G, B and P; differences between successive cumulative observations must also satisfy that arithmetic. Q1's baseline is the arithmetic origin (0,0,0), not a replacement for any missing cell. Final reconciliation compares Q4 G/B/P directly to results Home/Away.Goals/Behinds/Points and Q4 P to every player row's Home/Away.score. No player period statistics or external factual authority is established.

## 3. Method and checks

A strict character-state CSV parser handled commas inside quotes, doubled quotes, CRLF/LF and embedded quoted newlines, retained each cell's quoted status, and refused malformed quotes, trailing characters, duplicate headers or row-width mismatches. In-memory edge probes for quoted commas, escaped quotes, embedded newline and empty cells passed. CSVs were not split on commas. Empty, NA and zero were never conflated. All 240,672 quarter cells were required to be populated decimal nonnegative integers before arithmetic.

Raw group key: (Season, Date, oriented Home.team, Away.team). Each of 218 groups has 46 rows; all 10,028 rows are included. For results linkage only, reuse §11's established 2026 mappings GWS → Greater Western Sydney and Footscray → Western Bulldogs; other labels are unchanged. Results R<n> corresponds to stats numeric round and the exact Wildcard Final → WF alias is reused. There are 218 unique corresponding results keys, zero missing/orphan groups and no duplicate results key. No new alias/policy was introduced or resolver/importer executed.

| Check | Status | Exhaustive result |
|---|---|---|
| Consumed input hash bindings and parsed shape | PASS | Six inputs equal recorded SHA-256; both CSVs match verified manifest hashes, headers and row counts |
| Repeated H/A Q1–Q4 G/B/P values | PASS | 235,440 exact lexical comparisons against each group's first row (218×45×24); zero differences |
| Quarter integer domain and arithmetic | PASS | 240,672 populated nonnegative integer cells; 1,744 match/side/quarter triples satisfy P=6G+B |
| Cumulative quarter progression | PASS | 3,924 Q2–Q4 component transitions nondecreasing; all 1,744 side/quarter increments satisfy ΔP=6ΔG+ΔB |
| Q4/final reconciliation | PASS | 1,308 Q4/result G/B/P comparisons plus 20,056 Q4/player-row final-point comparisons; zero differences |
| WF and ordinary finals receive identical applicable checks | PASS | 207 R<n> groups, 2 WF, 9 ordinary finals (2 QF, 2 EF, 2 SF, 2 PF, 1 GF); no exemptions |
| Preserve ET observations | PASS | HQETG/HQETB/HQETP/AQETG/AQETB/AQETP: 60,168 unquoted-empty cells; zero populated, quoted-empty, NA or explicit-zero cells; no coercion/write |
| Establish ET applicability or ET score semantics | BLOCKED | Not supplied by these observations; not inferred or required for the bounded Q1–Q4 consistency verdict |

The first-row arithmetic is exhaustive at match grain because every corresponding quarter cell on all remaining rows is lexically identical. Final points were additionally checked on every player row. No unexplained discrepancy triggered the stop condition.

## 4. Explicit finals evidence

Every row below passed repetition, domain, quarter arithmetic, progression, final reconciliation and ET-empty checks. Values are cumulative **G/B/P**, home then away; match keys use the raw stats labels. This is retained internal evidence, not confirmation of real-world results.

| Game / round | Exact match key | Home Q1; Q2; Q3; Q4 | Away Q1; Q2; Q3; Q4 | Final points H–A |
|---|---|---|---|---|
| 17046 / WF | `2026|2026-08-28|Western Bulldogs|Collingwood` | 4/1/25; 7/6/48; 10/8/68; 14/12/96 | 4/0/24; 6/2/38; 8/8/56; 14/9/93 | 96–93 |
| 17047 / WF | `2026|2026-08-29|Melbourne|Carlton` | 4/3/27; 5/6/36; 7/10/52; 7/13/55 | 1/3/9; 5/5/35; 8/8/56; 10/14/74 | 55–74 |
| 17048 / QF | `2026|2026-09-03|Fremantle|Hawthorn` | 1/3/9; 1/4/10; 4/7/31; 5/10/40 | 4/4/28; 6/7/43; 9/10/64; 10/12/72 | 40–72 |
| 17049 / EF | `2026|2026-09-04|Geelong|Carlton` | 1/5/11; 4/10/34; 10/13/73; 14/23/107 | 4/3/27; 5/7/37; 7/8/50; 11/8/74 | 107–74 |
| 17050 / QF | `2026|2026-09-05|Sydney|Brisbane Lions` | 6/6/42; 10/8/68; 16/13/109; 21/15/141 | 2/4/16; 5/8/38; 9/9/63; 13/10/88 | 141–88 |
| 17051 / EF | `2026|2026-09-05|Adelaide|Western Bulldogs` | 3/1/19; 7/2/44; 9/5/59; 14/6/90 | 1/7/13; 5/8/38; 5/10/40; 9/14/68 | 90–68 |
| 17052 / SF | `2026|2026-09-11|Fremantle|Geelong` | 6/2/38; 10/5/65; 15/6/96; 18/12/120 | 2/1/13; 7/2/44; 12/8/80; 16/10/106 | 120–106 |
| 17053 / SF | `2026|2026-09-12|Brisbane Lions|Adelaide` | 6/6/42; 10/12/72; 16/15/111; 21/18/144 | 2/3/15; 5/4/34; 7/9/51; 13/13/91 | 144–91 |
| 17054 / PF | `2026|2026-09-18|Sydney|Fremantle` | 4/5/29; 7/6/48; 10/10/70; 10/11/71 | 2/1/13; 4/5/29; 7/7/49; 12/11/83 | 71–83 |
| 17055 / PF | `2026|2026-09-19|Hawthorn|Brisbane Lions` | 5/1/31; 11/1/67; 12/5/77; 19/8/122 | 5/2/32; 8/5/53; 15/7/97; 20/11/131 | 122–131 |
| 17056 / GF | `2026|2026-09-26|Fremantle|Brisbane Lions` | 3/4/22; 6/7/43; 10/12/72; 12/17/89 | 3/5/23; 6/7/43; 9/8/62; 14/12/96 | 89–96 |

## 5. Discrepancies, limitations and next bounded proposal

**Unexplained discrepancies: none. Exact unresolved match keys/fields/values: none within the tested checks.** ET applicability remains unresolved for all 218 keys, with all six ET fields observed as empty; emptiness proves neither absence of extra time nor a numeric zero. No input was repaired or check relaxed. No source, policy, accepted binding, active reference or availability record changed.

This verifies internal consistency only. Cumulative semantics are supported by retained implementation evidence; publisher authentication and independent real-world quarter/result verification were not attempted. Existing rehearsal/D7 evidence and provenance are reused, not newly executed. No acceptance of results, quarter fields, availability or production successor inputs is recorded. All three 2026 Brownlow keys remain PENDING; AFL API authority, eligibility and ownership restrictions are unchanged. The test contract/register and 1,640 remain rehearsal-only; ISSUE-316 stays OPEN and production NO-GO.

**Next bounded proposal:** owner review may record explicit worksheet §4 results/linkage and quarter-field decisions against the linkage and quarter reviews, retaining empty ET as an unresolved coverage limitation unless separately evidenced. Remaining field/21-key/height decisions stay pending. Any further measurement requires a separately bounded scope; external verification needs separate authority. Successor bindings, fresh scoped census, rollover and release gates remain separate, unexecuted next stages.

Stop here. No shell/Git, network, host/database access, WSL, installation, acquisition, census, importer execution, gates, rebuild, D7, rehearsal rerun, cleanup, commit, push or deployment occurred. Unrelated changes and .codex/ were untouched. Only this review and necessary ISSUE-316 tracking links/next actions were written; no changelog entry is required for this investigation-only record.
