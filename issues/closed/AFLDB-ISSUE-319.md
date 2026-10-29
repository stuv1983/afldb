# AFLDB-ISSUE-319 — Successor source-evidence requirements unresolved

**Status:** RESOLVED 2026-10-23 (§6). The owner decided every §4 item explicitly. Item 5, the in-run raw replay, is implemented in `691bdbae` and proven inside the enforced v4 rehearsal. The deferred data-quality questions move to AFLDB-ISSUE-321. Resolution does not authorise apply.
*History:* registered 2026-10-23 as OPEN / BLOCKED. Part of it was resolved by evidence; the rest needed owner adjudication or evidence that was not available. Second evidence pass 2026-10-23 (§4): five questions prepared, none adjudicated at that time.
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

## 4. Prepared for owner decision (2026-10-23, second pass)
The full package is in `C:/tmp/afldb-c2-REHEARSAL-V3-15e43562-20261023T0017Z/source-evidence-319/SOURCE_QUESTIONS.md`. Every script and JSON sits beside it.

**What this pass did and did not do.**
* Earlier evidence was reused. The 479-id classing and the ten-coach totals were not re-measured.
* New publisher reads are separately labelled captures: GET only, robots.txt 404 captured first, every response
  hashed in `MANIFEST.tsv`.
* Nothing was adjudicated, name-matched, voted on, averaged or zero-filled.

1. **NM 1940.**
   * *Observed:* in the packaged core (34,112 (match, club) groups, 1,642 blank), the only blank Coach groups after
     1922 are exactly these eleven games. R1–R7 carry "Thomas, Len".
   * *Publisher statement, new capture* (`nm1940-match-pages-capture-20261023T0037Z/`, 18 match pages, HTTP 200):
     every R8–R18 page lists **two** North Melbourne coaches, Carter and Adamson. Their joint counters run 1 → 11.
     R1–R7 list Thomas only. These are the only two-coach games in the capture.
   * `match_coaches` is keyed `(match_id, club_id)` (migration 087), so a joint attribution is not representable
     today.
   * *Owner choice:*
     * (a) keep unattributed as a recorded limitation;
     * (b) adopt the joint attribution, which needs a schema/importer design change;
     * (c) designate another authority. Wikipedia's Thomas 12 / Adamson 6 contradicts both AFL Tables and the core's
       7 Thomas games.
2. **479 ids.**
   * A targeted check joined by `providerId` only. 443 of the 479 have no publisher `debutYear`, but 387 of the 1,916
     *mapped* ids also lack one. The field cannot show never-debuted players, so the question is not resolved.
   * Nine class-C ids state a debut. They are listed in the package.
   * *Owner choice:* name acceptable non-name identity evidence (a cross-publisher mapping source, or an explicit
     attribute-key policy), or keep the ids excluded.
3. **Caps and heights.**
   * The first byte-hashed origin reads of the nine Collingwood pages (`caps-capture-20261023T0051Z/`). Victor
     Jackson's profile, unreadable on 2026-10-21, is now read: DOB 9-Apr-1889, 185 cm, 1912 Collingwood, 3 games / 4
     goals.
   * The register's 22/blank/34/181 against the profiles' 18/4/35/180 persists. These are same-publisher statements.
   * *Owner choice:* designate an independent authority and authorise evidence from it, or accept the differences as
     evidence-only.
4. **Roster completeness.**
   * No evidence obtainable after the fact can establish the completeness of the 2026-09-04 capture.
   * *Owner choice:* a separately labelled successor capture with raw retention (broad, not authorised here), or
     frozen evidence-only use with completeness unvalidated.
5. **Parsed-only coaches.**
   * A fail-closed prototype (`raw-replay-preflight/`) verifies the parsed CSVs the run would load against an
     in-memory replay of the package's own raw tar. It needs no package path change.
   * Positive result: equal three ways. 8 of 8 negative controls refuse. A void first control is retained.
   * `OPTION.md` holds the exact implementation and tests. They are **not implemented**, and no rehearsal executed
     them.
   * *Owner choice:* out-of-band replay proof is sufficient, or in-run verification is required. Choosing in-run
     verification means a new commit, a new package and a fresh enforced rehearsal.

## 5. Next action
Owner answers to §4 items 1–5, or named additional evidence. No item is accepted by default.

**Unchanged by the v3 rehearsal at `15e43562` (2026-10-23; ISSUE-320).**
* The rehearsal passed, but it answers none of §4.
* Its coaches stage ran parsed-only. The log line is `raw/ not present (the tracked parsed artefacts are the rebuild input)`.
* The cross-check gave 376 / 386, the same as before. `match_coaches` has 32,470 rows; 621 matches have no coach.
* The raw-replay prototype was not implemented or executed.
* NM 1940, the 479 ids, caps and heights, roster completeness and the parsed-only policy all stay PENDING owner choice.

## 6. Owner decisions and resolution (2026-10-23)
### 6.1 Owner decisions (verbatim substance)
| §4 item | Decision | Effect |
|---|---|---|
| 1. NM 1940 R8–R18 | "remains unattributed. Defer multi-coach schema changes." | Option (a). The eleven games keep no NM coach, as the core has it. `match_coaches (match_id, club_id)` is unchanged. Joint attribution → ISSUE-321 |
| 2. 479 unmapped roster ids | "remain excluded pending stable identity evidence." | No name inference and no mapping. Excluded from roster corroboration → ISSUE-321 |
| 3. Conflicting goals/heights | "remain evidence-only. Preserve existing authority, rejected matches and missing-value semantics." | Heights stay AFL Tables. The 18 rejections stay rejected. Caps, the 737 AFL API and 24 Wikipedia differences are evidence-only. NULL stays NULL → ISSUE-321 |
| 4. Roster completeness | "remains evidence-only, with completeness unvalidated. No new broad roster capture is required for this scope." | Frozen `rosters-20260905` (15/15) is used as evidence only; no acquisition → ISSUE-321 |
| 5. Parsed-only coaches | "Require raw-to-parsed coach replay inside preflight." | Implemented and proven (§6.2) |

These decisions are the owner's adjudication. They do not document the questions away. No value was chosen, averaged, name-matched or force-mapped. Authority and eligibility are unchanged.

### 6.2 Mandatory in-run raw replay (`691bdbae580c32a952411df48d59849f0198683a`)
**Implementation:**
* The network-free parser moved byte-identically into `tools/rebuild/afltables/coach_snapshot_parser.py`, with `render_csv`.
  * The quarantined acquisition adapter imports it, so acquisition output is unchanged.
  * No tools→legacy import was added and no parser logic was duplicated.
* `import_match_coaches.py --require-raw-bundle` (validate, dry-run and load modes):
  * the bundle pin `coaches.accepted_snapshot.raw_bundle` (`coaches-20260905-raw.tar`, `24685690…1e4a`, 24,023,040 B, 387 members) is checked against the bundle's filename rule, size, `O_NOFOLLOW` read, fstat identity and sha256;
  * members are read in memory with no extraction, and exact coverage is required: changed, missing, extra, duplicate, unsafe or non-regular members refuse;
  * the genuine parser is replayed, and its CSV bytes are compared with the manifest sha256 and with **the exact bytes the loader reads to load**.
* `rebuild-test.ts` runs the replay inside `runPreflight`, before the first stage and so before census, capture and reset.
  * A successor or rehearsal profile with an absent pin or bundle refuses: "Nothing has been destroyed".
  * Only `predecessor-1897-2025` is exempt.
  * The coaches stage repeats the replay.
* The package filename alphabet is unchanged: the raw tar is a single regular source member.

**Tests** (existing suites extended): `tests/coach-reconciliation.test.ts` (the prototype's controls plus `pin_leading_dash`, the genuine-bundle replay, the parser-move equivalence, the parser-failure and missing index/page controls, with the void first control kept as history), `tests/db-test-rebuild.test.ts` (preflight order and argv) and `tests/afl-api-cutover.test.ts`. 5 suites 1,854 passed / 4 skipped; `tsc` 0.

**Real-launcher controls (v4, isolated control database, 0 tables before/after):**
* NCR1, bundle absent: refused at preflight with 0 stages.
* NCR2, one member byte flipped and re-pinned: `REFUSED: 1 raw members differ from the manifest`, 0 stages.
* NCR2's first attempt was a harness spec-lookup fault (exit 2, gate not reached). It is retained as VOID.

**Enforced full rehearsal v4** (`C:/tmp/afldb-c2-REHEARSAL-V4-691bdbae-20261023T0248Z/EXECUTION_RECORD.md`), exit 0, 30 stages:
* The preflight `AFLDB-COACH-RAW-REPLAY VERIFIED … replayed (387 members): coaches_index 525ae887…42ef, coach_pages ec4959a4…113b equal to the replay, the manifest and the loaded files` is at `rebuild.log` line 103. That is before the first stage marker (149), the census (150) and the reset (160).
* It repeats in the coaches stage (line 425).
* Those digests equal the installed package's parsed files after the run.
* The out-of-band prototype was not relied on.

### 6.3 Verdict
**RESOLVED.** Items 1–5 have an owner decision, and item 5 is satisfied by implementation and in-run proof.
* §3 item 6 (N2/N3, +89) and the deferred consequences of items 1–4 are tracked as **AFLDB-ISSUE-321**. They are retained limitations, not acceptance of the disputed values.
* Unchanged: Brownlow 2026 pending; ET unresolved; authority, eligibility and ownership restrictions.
* Resolution does not authorise rollover/apply, a populated-target rebuild or deployment.
