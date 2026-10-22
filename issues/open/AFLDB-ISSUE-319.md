# AFLDB-ISSUE-319 — Successor source-evidence requirements unresolved

**Status:** OPEN / BLOCKED, registered 2026-10-23. Part of it is resolved by evidence; the rest needs owner adjudication or evidence that is not available.
**Severity:** High, as an ISSUE-316 successor gate. **Area:** source provenance and coverage (coaches, rosters, heights, identity).
**Linked:** AFLDB-ISSUE-316 (gate G1 of successor package E).

## 1. Requirement (owner decision, 2026-10-23)
"Source coverage: more evidence is required before acceptance. Track the related unresolved source-evidence requirements as one issue."

Not permitted:
* closing this by documenting the items;
* accepting observation in place of evidence;
* inferring identity from names;
* force-mapping rejected ids;
* choosing disputed values;
* changing eligibility or source authority.

The evidence for this issue is in `C:/tmp/afldb-c2-SUCCESSOR-READINESS-E-20261023/source-evidence/`. Its labels:
* **observed arithmetic**;
* **publisher statement** (what one publisher says);
* **independent corroboration** (another publisher agrees);
* **adjudication** (a designated authority decides). No item below was adjudicated by this work.

## 2. Resolved by evidence (2026-10-23)
| Item | Result | Kind |
|---|---|---|
| Coach raw → parsed provenance | All 387 recovered raw files equal the tracked manifest `coaches-20260905`. Replaying the acquisition adapter's own `parse_index`, `parse_page` and `write_csv` (quarantined `legacy/offline/tools/rebuild/afltables/acquire_coaches.py`, imported, no network) regenerates `coaches_index.csv` (`525ae887…42ef`) and `coach_pages.csv` (`ec4959a4…113b`) byte for byte, equal to the tracked files and to the manifest | observed (deterministic replay) |
| Eight 2026 coach-season differences (Scott, Beveridge, Fagan, Longmuir, Nicks, Mitchell, Cox, Fraser) | Every row of the 2026-09-05 pages agrees with the core's per-match Coach strings. The core-only rows were exactly each coach's finals (QF/EF/SF/PF/GF; the WF games appear on both). A NEW labelled capture of the same pages (2026-10-22T22:55:51Z–22:56:12Z, `coach-recapture-20261023T1110Z/MANIFEST.tsv`, HTTP 200, robots.txt 404) now lists exactly those finals: no row is core-only and no row is page-only. The QF (3 Sept) and EF (4 Sept) were played before the 2026-09-05T06:36:13Z extraction, so the cause is the publisher updating its pages late, not capture timing alone. `coaches.source_games_coached` is evidence only (migration 087) and is never used as a total; assignments come from the core | publisher statement (later) agrees with the same publisher's match data |
| Wikipedia height rows (84) | New capture by the cited revids through the MediaWiki API (`wikipedia-capture-4-20261023T1025Z/MANIFEST.tsv`): all 84 rows STATED_EXACTLY by the revision each cites (title, timestamp and infobox height equal; 84 returned; no badrevids). This proves what those revisions said. It does not prove the height, or coverage | publisher statement |
| Roster artefacts | 15/15 files equal the manifest `rosters-20260905` (`61aff99a…69a7`). Scope 2012–2026, fitzRoy 1.8.0, `completeness: unvalidated` | observed (bytes only) |

## 3. Still blocked: the exact questions
1. **NM 1940 R8–R18 coach** (match ids 3815, 3818, 3828, 3830, 3840, 3843, 3851, 3854, 3862, 3870, 3876).
   * AFL Tables lists all eleven games on both `Jim_Adamson.html` (unchanged byte for byte today, `516053…98ad`) and `Wally_Carter0.html` (still listed today).
   * AFL Tables' own match data leaves the NM coach blank for all eleven, and the rebuild consequently assigns none.
   * Wikipedia `List_of_North_Melbourne_Football_Club_coaches` rev 1372770354 (2026-09-02T05:03:11Z) gives 1940 as Len Thomas 12 games and Adamson 6, and Carter only for 1948–53 and 1958–62.

   *Question:* which authority adjudicates this? Who, if anyone, is attributed as coach for these eleven games? The present state is no attribution, and that is not acceptance.
2. **479 unmapped roster provider ids.** No retained evidence links them to AFL Tables profiles except names, and name inference is forbidden.

   *Question:* what identity evidence does the owner accept, for example an AFL API ↔ AFL Tables profile link from a named source? Or are these to stay excluded from roster corroboration?
3. **Rejected identity/height matches and height disagreements.** These are:
   * the 18 register rejections;
   * the Collingwood caps (four unexplained goal discrepancies: 22/blank/34/181 against 18/4/35/180);
   * 737 AFL API and 24 Wikipedia height disagreements with AFL Tables.

   They are statements by different publishers. Heights stay AFL Tables, and the authority is unchanged.

   *Question:* which source, if any, adjudicates disagreements? Or does the owner accept them as evidence-only differences?
4. **Roster completeness and raw provenance.** Completeness is declared `unvalidated`, and raw API responses were not retained, so the parsed roster cannot be replayed from raw. A new capture would be the publisher's current data, not the 2026-09-04 capture.

   *Question:* is a new, separately labelled roster capture required? That would be a broad acquisition, which is not authorised here.
5. **Parsed-only consumption.** The successful rebuild consumed parsed coach CSVs only ("raw/ not present"). Raw cannot be a package member, because the package path alphabet refuses the space in `Allan_La Fontaine.html`, so it was bound as a hashed bundle and verified out of band.

   *Question:* is the proven deterministic replay (§2) sufficient, or must the rebuild verify raw in-run? The latter needs a bounded design for carrying the raw bundle.
6. **Other retained limitations from the decision package:**
   * N2 authority and roster completeness;
   * N3 publisher authentication and per-quarter data;
   * the unattributed +89 delete counter of the sequential measurement.

ET applicability and Brownlow 2026 stay under ISSUE-316 (owner: unresolved and unapproved).

## 4. Next action
Owner answers to §3 items 1–5, or named additional evidence. No item is accepted by default.
