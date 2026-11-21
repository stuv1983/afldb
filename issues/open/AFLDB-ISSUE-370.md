# AFLDB-ISSUE-370: the awarded 2026 Brownlow is unpublishable and reads as "Not yet awarded"

Opened 2026-11-21 from the owner's browser observation during the Release 7R2 sitting. Worktree
`D:\dev\afldb-bv2026`, branch `claude/brownlow-2026-publication-20261121`, based on 7R2 PREP `4484a6d0`
(executable tree = `a3c8c67c`). Nothing in this runbook has touched production.

## 1. Owner observation and hold (verbatim, 2026-11-21)

> Hold Release 7R2 at P3. Do not promote or restart under the current packet. Record my owner browser observation: on Scott
> Pendlebury's player page, the 2026 BV cell displayed "Not yet awarded". That confirms the displayed text, but I dispute its
> correctness. The 2026 season finished in September and the Brownlow was awarded on Monday 21 September 2026. I can see 2026
> votes on the season page, but the 2026 results appear to be missing from https://beta.afldb.com/brownlow.

Sitting state at the hold (`run7r2/sitting-exec-20261121/README.md` in `D:\dev\afldb-close-20261121`): P0–P2 PASS, the
production checkout fast-forwarded to `a3c8c67c`, P3/P3b built and verified release `a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg`
(13,002 files). **P4 (promote) was not run.** Production still serves `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`; no restart.

## 2. Live reproduction (served release `a2e6ea99`, 2026-11-21 ~03:30Z)

Playwright MCP (`@playwright/mcp`, user scope), browser signed in by the owner; no cookie, code or link entered chat or logs.

| Page | URL | Displayed |
|---|---|---|
| Player season table | `/players/scott-pendlebury-11724` | 2026 (Collingwood, 17 games) BV **"Not yet awarded"**, title "The season is still in progress; the Brownlow Medal has not been awarded." 2025 **2**, 2024 **2** |
| Game log | `/players/scott-pendlebury-11724/matches?season=2026` | 17 rows, BV column present, every cell **"—"** (R8 and R21 included) |
| Season | `/seasons/2026` | "218 matches · 18 clubs · Premiers: Brisbane Lions". 25 round "Brownlow votes" blocks **with votes** (Round 8: Pendlebury 3; Round 21: Pendlebury in the 2-vote tier; Round 1: Nick Daicos 3 …). Season-total section: **"No votes recorded for 2026"** |
| Match R8 | `/matches/17247` (Essendon v Collingwood) | **No BV column** |
| Match R21 | `/matches/17151` (Adelaide v Collingwood) | **No BV column**; Pendlebury row present |
| Brownlow | `/brownlow` | No season selector (the only `<select>` is a club filter, 25 options, no 2026); no `/brownlow/2026` link; latest row 2025 Matt Rowell 39 |
| Brownlow 2026 | `/brownlow/2026` | **HTTP 404**, "Page not found" |

## 3. Source to screen

| Surface | Reader | Source | 2026 state |
|---|---|---|---|
| Player BV cell | `getPlayerSeasons` (`src/db/queries/players.ts:612`) → `formatBrownlow` | `player_season_stats.brownlow_status/votes` | 669 rows `pending`, votes NULL (B1a, 18 Nov) |
| Season round blocks | `getSeasonRoundVotes` (`src/db/queries/rounds.ts:138`) | `brownlow_round_votes` by season | 9,522 rows; at `a2e6ea99` ungated, so shown |
| Season total, `/brownlow`, `/brownlow/[year]` (`generateStaticParams`, revalidate 3600) | bsv readers | `brownlow_season_votes` | **0 rows** |
| Match BV, game-log BV | `getMatchPlayers` (`matches.ts:137`), `getPlayerMatches` (`players.ts:711`) | `player_match_stats.brownlow_votes` mirror | NULL for every 2026 cell |

Acceptance (`src/db/queries/brownlow-readiness.ts`): a season is public when it is not `not_applicable` and either coverage is
`complete` or `brownlow_season_authority.published_revision` is set. 2026: coverage `pending`, authority unpublished. **ISSUE-367**
(in `a3c8c67c`) applies that rule to the round, match, game-log, head-to-head and NL readers, so releasing 7R2 as packaged would
also **remove the round blocks**, the only place the owner can currently see 2026 votes. **D-365-W** (in `a3c8c67c`) relabels
the cell "Results not loaded", which is also untrue: the results are loaded but unverified. **D-365-1 / B1a** (669 rows
`pending`) is correct: AFLDB has not accepted 2026, and this issue does not dispute it.

## 4. What is stored, and does it reconcile

Measured on a restored copy of the 18 November production dump (`afldb_v2_bv2026_rst_test`, streamanator):

- `brownlow_round_votes` 2026: **9,522 rows, all source `afltables`, all `match_id` NULL** (the pre-094 legacy round grain).
  621 positive, **1,242 votes**. Loaded by AFL Tables batch 34 (28 Sep 2026), a week after the count.
- Attaching each row by the migration-094 §27.5 rule resolves **all 9,522** to exactly one match. **207/207** home-and-away
  matches have exactly one 3/2/1 set, with no positive votes outside H&A.
- `player_match_stats` mirror: NULL. `brownlow_season_votes`: none. Authority: unpublished. Coverage: `pending`.
- Official result: Nick Daicos won with a record **47**, ahead of Bailey Smith **36** and Marcus Bontempelli **34** (ABC News,
  21 Sep 2026). Zero Hanger's final top ten matches the stored totals row for row: Gawn 28; Ashcroft, Cripps, Sheezel 27;
  Butters, Heeney 26. Pendlebury polled **5** (R8 3, R21 2).

**The data is complete and matches the official result. It is stored at the wrong grain and has never been published.**

## 5. First divergence

The award happened on 21 Sep. AFLDB stored the complete count on 28 Sep, but only at the legacy round grain. Nothing owned
the step that makes a season publishable:
- Block B's match attachment (`brownlow-production-correction.ts:129`) is policy-limited to **1984–2025, 2026 excluded**.
- AFL Tables acquisition was retired on 2 Nov.
- The AFL API Brownlow successor is deferred to 2027 (ISSUE-332).

`publishBrownlowSeason` (`src/db/queries/admin-brownlow.ts`) requires every H&A match to carry an attached 3/2/1 set, so
**2026 cannot be published**. Coverage therefore stays `pending` (correctly), and every acceptance-gated reader withholds it.
The player cell then compounds this: its wording asserts something about the *award* ("Not yet awarded"; D-365-W "Results not
loaded") when the only fact AFLDB holds is that *it* has not verified the result.

The award taking place and AFLDB accepting the import are different events. The first happened on 21 Sep; the second has
no path to happen.

## 6. Fix (committed locally on the branch; see §11 for the tested commit)

1. **Wording, season-aware, no year exception** (`src/lib/format.ts`, `src/app/players/[slug]/page.tsx:612`). Only the
   `pending` case changes:

   | `pending` and | Cell | Tooltip |
   |---|---|---|
   | season `complete` | **Awaiting verification** | "AFLDB has not yet verified and published the Brownlow results for this season." |
   | season unfinished | **Not yet available** | "Brownlow votes for this season are published once the count has been verified." |

   The other statuses are unchanged: `complete` shows the number (a genuine 0 shows "0"), `not_applicable` shows "No medal",
   `not_collected` shows "Not recorded".

   **D-370-W, owner-approved 2026-11-21. It supersedes D-365-W.** The owner's words: "I approve “Awaiting verification” for a
   completed season with pending results and “Not yet available” for an unfinished season. Use a factual tooltip such as
   “AFLDB has not yet verified and published the Brownlow results for this season.” Only claim the medal has been awarded if
   the application has evidence for that fact independently of season completion."

   The application holds no such evidence: no column records the count's date or outcome independently of `seasons.status`.
   So no text claims an award. The first local draft's tooltip ("…has been awarded…") was replaced before the commit.
2. **Guarded attachment** (`src/db/queries/brownlow-season-attachment.ts`, CLI `tools/v2/brownlow-season-attach.ts`). It
   makes a completed season's stored legacy-grain votes publishable without changing a single vote:
   - **Refuses** unless:
     - the season is `complete`;
     - coverage is `pending`;
     - the season is unpublished with no bsv rows and no mirror value present;
     - every row resolves;
     - every H&A match has exactly one 3/2/1 set.
   - **plan** is read-only and outputs a digest export.
   - **apply** needs the exact digest, the target identity proof (`proveCorrectionTarget`), an actor and a note. It runs as
     one transaction:
     - takes the advisory and table locks;
     - re-plans and refuses on drift;
     - runs the reviewed `applyRoundVoteMatchBackfill`;
     - fills the pms mirror (fill-only);
     - checks proofs (no unattached rows, mirror equals round grain, totals unchanged, other columns unchanged);
     - writes a `data_edits` audit row with the season seal.
   - **Dry run** is the default.
   - **reverse** is exact, and refuses once the season is published.
3. **Publication stays human.** After attachment, the Super Admin publishes at `/admin/brownlow/2026` with the season's
   ineligible list and a note. That writer computes bsv, coverage, status and career totals. It is the existing,
   unmodified `publishBrownlowSeason`.

## 7. Verification

- Typecheck rc 0. Unit tests 87/87, including `tests/format.test.ts` (season-aware wording; the complete-season note matches
  none of "not yet awarded", "not been awarded", "in progress", "not loaded").
- `tests/integration/brownlow-season-attachment.test.ts` (fixture season 2059, four H&A matches, legacy rows):
  - **4/4** on the production-dump copy and 4/4 on a fresh migrated, seeded synthetic database.
  - Covers: before state (publish refuses), plan and refusal, dry run, wrong digest, commit, re-apply refusal, exact
    reversal.
  - After publication: totals, winner, round block, match sheet (3/2/1 and a genuine 0), game log, the BV cell "6"/"0",
    and reversal refused.
- Adjacent suites (`admin-brownlow`, `brownlow-pending-coverage`, `-projection`, `b1a-successor`, `database`): failures are
  **identical** on the unchanged `a3c8c67c` tree against the same databases, so they are environment-bound, not caused here:
  - on the dump copy, the P2 preflight expects 0 unattached rows and the dump holds 9,522;
  - on the minimal seed, the tests need the rebuilt `afldb_test` historical seasons.
- **Rehearsal on the production-dump copy** (`afldb_v2_bv2026_rehearse_test`, B1a applied, 669 rows `pending`), CLI end to
  end:
  - `PLAN rows=9522 positive=621 votes=1242 matches=207/207 digest=100c112f…76aa7`;
  - dry run rolled back;
  - wrong digest REFUSED;
  - `APPLY COMMITTED attached=9522 mirrored=9522 unattached_after=0 audit=205`;
  - then `publishBrownlowSeason(2026, ineligible=[])` → `ok revision=2 rowCount=183 votesTotal=1242 winners=[Nick Daicos]`;
  - reconciliation: bsv vs round grain 0 differences, pss vs bsv 0 differences, pss 2026 669 `complete` summing 1,242;
  - all three coverage grains `complete`; Pendlebury 2026 5, 2025 2, 2024 2;
  - other seasons unchanged (16,120 rows, 79,113 votes); audit `attach_round_votes` 1, `publish` 1.
- Rendered before/after on that copy (standalone build, loopback, beta claim on loopback only): see §7a.

### 7a. Rendered before/after (DEV)

Candidate build `5qHVSeBrHIqiHsTAl2K-f`, served standalone on 127.0.0.1 with a loopback beta claim and ISR cleared before
each serve. **Before** = fresh dump copy plus B1a (production's current Brownlow state). **After** = the rehearsal copy
after attach and publish. Server logs show 0 errors. Full transcripts:
`AFLDB-ISSUE-370-evidence/rendered-before-after-SUMMARY.txt`.

("n/r": not read on the live site.)

| Surface | Live today (`a2e6ea99`) | Candidate, before | Candidate, after |
|---|---|---|---|
| Pendlebury 2026 BV cell | Not yet awarded | **Awaiting verification** (D-370-W tooltip) | **5** |
| Daicos 2026 BV cell (2026 winner) | n/r | Awaiting verification | **47** |
| Pendlebury game log 2026 | 17 × "—" | 17 rows, no positive cell (withheld) | R8 **3**, R21 **2**, sum **5** |
| Daicos game log 2026 | n/r | no positive cell | 18 polled matches, sum **47** |
| Match 17247 (R8) | no BV column | no positive cell | Pendlebury **3**, Daicos 2, Crisp 1 |
| Match 17151 (R21) | no BV column | no positive cell | Pendlebury **2** |
| `/seasons/2026` round blocks (served HTML) | 25 blocks shown (ungated) | **0** (ISSUE-367 withholds unpublished) | **25**, Pendlebury [3, 2]; Daicos 47 in the total |
| `/brownlow` | latest 2025; no 2026 | latest 2025; no 2026 | **2026 Nick Daicos Collingwood 47**, linked |
| `/brownlow/2026` | 404 | 404 | **200**, "Won by Nick Daicos with 47 votes"; Smith 36, Bontempelli 34, Pendlebury 5 |
| Accepted 2025 control: Pendlebury 2, Daicos 32 (log sum 32), `/brownlow/2025`, `/seasons/2025` 25 blocks, match 16677 3 polled | as shown | unchanged | unchanged |
| Anonymous `/brownlow` | — | 307 to `/beta?from=%2Fbrownlow` | 307 (unchanged) |

The genuinely pending **unfinished** season ("Not yet available") has no instance on the production dump: every stored
season is complete. It is covered by `tests/format.test.ts` and `tests/e2e/journeys.spec.ts` (the e2e base pins 2026 as in
progress). That e2e test previously required "Results not loaded" and now requires the neutral wording, and never "Not yet
awarded" or "Results not loaded".

The first rehearsal pass (`rehearsal-attach-publish-SUMMARY.txt`) is the authoritative record of the attach and publish
steps and their reconciliation. Its own after-render is void: its ISR-clearing glob also deleted compiled `brownlow` route
modules (500s). It was stopped, the build was redone, and the clearing was restricted to rendered output (`.html`/`.rsc`/`.meta`/
`.body`/segments) with a guard on the route module.

## 8. Why the 7R2 acceptance criteria need review

7R2 treats hiding 2026 as success:
- P10 `after` requires the D-365-W "Results not loaded" text on every sampled 2026 cell;
- its controls require `/seasons/2026` to show the no-votes text and `/brownlow/2026` to return **404**;
- the owner observation (§9, §11) expects **no 2026 vote number** on the season, match or game-log pages.

Those criteria hold only while the season is unpublishable. They would have certified as correct exactly what the owner
disputes. The approval R7R2 also pins `a3c8c67c` exactly, so it cannot carry this change.

**Release 7R2 is not executed further.** A revised packet must:
- target the new candidate;
- re-derive P10 so that before publication a completed pending season reads "Awaiting verification" (never "Not yet
  awarded" or "Results not loaded");
- after publication, require 2026 numbers on the cell, match and game log, `/brownlow/2026` 200 and Daicos 47;
- keep 2025 as the accepted control.

`tools/v2/b1a-successor/sitting/p10-pages.sh` and `tests/b1a-successor-lib.test.ts` are packet tooling and are revised with
that packet, not here.

## 9. Production action (each step needs fresh owner approval)

1. **Release** a revised packet (7R3) for the new candidate, after DEV qualification. Disposition of the built,
   unpromoted `a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg` and of the production checkout (now at `a3c8c67c`) belongs to that
   packet.
2. **Owner decision D-370-1:** the 2026 ineligible list. No stored source marks any 2026 player ineligible; 2025 used
   formal rulings (BP-2025-ELIGIBILITY-v1). The rehearsal used an empty list only as a placeholder.
3. **Data change** after a fresh verified backup:
   - run `node --import tsx --conditions=react-server tools/v2/brownlow-season-attach.ts plan --target <target.json> --season 2026 --out <file>`
     as the import role (DSN only via `AFLDB_BROWNLOW_ATTACH_DSN`). Expect exactly
     `rows=9522 positive=621 votes=1242 matches=207/207`; any other figure is a STOP;
   - the owner reviews the digest;
   - dry run, then `--commit` with that digest, the owner's actor id and a note.
   - Reversal (`reverse`) stays available until publication.
4. **Owner publishes** 2026 at `/admin/brownlow/2026` (Super Admin) with the D-370-1 list and a note. Expect 183 rows,
   1,242 votes, winner Nick Daicos 47, unless the list changes the winner.
5. **Acceptance stays open** until the owner observes on the live site:
   - Pendlebury 2026 BV = 5;
   - his R8/R21 game-log cells 3/2;
   - the BV column on matches 17247/17151;
   - `/brownlow` and `/brownlow/2026` showing Daicos 47;
   - 2025 unchanged.

   `/brownlow*` revalidates every 3600 s.

## 10. Follow-ups

- The test-database rebuild artefact ends at 2025 (`tools/db/rebuild-test.ts` `brownlowSeasonChecks`). Before any future
  rebuild-and-promote of production, confirm that 2026's publication is carried over and not dropped.
- 2027 onward belongs to the AFL API successor (ISSUE-332), whose plan must include this attachment-and-publication step for
  any season stored at the legacy grain.

## 11. Tested commit, 7R3 packet and D-370-1 (2026-11-21)

- **Approved wording D-370-W (owner, 2026-11-21):**
  - "Awaiting verification" for a completed season with pending results;
  - "Not yet available" for an unfinished season;
  - tooltip "AFLDB has not yet verified and published the Brownlow results for this season.";
  - claim an award only on evidence independent of season completion.
- **Tested commit `CAND` = `c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76`** (local, unpublished):
  - `f2741235`: code, tests and records;
  - `9626bce1`: the 7R2 P0–P3b sitting transcripts, force-added;
  - `c8d4202a`: test-only. The exact-checkout qualification of `9626bce1` showed `tests/v2-season-seal.test.ts` failing 2 tests:
    the new attachment writer was unclassified, and the sealed `recordDataEdit` count is 57, not 55. Fixed by classifying
    `brownlow-season-attachment.ts` as `governed`.
  - The delta from `a3c8c67c` is 44 paths, 10 of them code/test. It adds no migration, package or deploy change.
- **Qualification: QUALIFIED** (`docs/v2/evidence/remediation-20261114/run7r3/DEV-QUALIFICATION.md`). `CAND` adds 0 new failures; every remaining failure is identical on the byte-verified `a3c8c67c` tree against the same database. DEV-only incident: the e2e harness killed streamanator's `afldb.service` (port 3100) three times (16:05:38–16:06:01 AEDT), and systemd restarted it each time; for about 16 s DEV's LAN proxy (:8090) reached the test server. The public beta, served by the production droplet behind Cloudflare, was not affected. The harness was repaired (private port, own process group, stops only what it launched) and re-proven, and the full block self-test was re-run on the pinned bytes. See `DEV-QUALIFICATION.md` note 3.
- **Block self-test:** `…/run7r3/dev/BLOCKS-SELFTEST.md`. Every data and page block ran unchanged on a disposable copy of the
  production dump in production's current state: attach, exact reverse, re-attach, publish with the proposed list, and the
  post-publication reversal refusal.
- **Packet:** `docs/v2/evidence/remediation-20261114/run7r3/RELEASE-PACKET-7R3.md`; block manifest `run7r3/SHA256SUMS`.
- **D-370-1 evidence:** `docs/v2/evidence/remediation-20261114/run7r3/D-370-1-eligibility-2026.md`.
  - 14 players polled 2026 votes while suspended (85 votes). They are mapped to production ids, with sources.
  - None of them can change the winner: the highest is Horne-Francis 22, against Nick Daicos 47, who is eligible.
  - 16 more suspended players polled nothing and cannot be entered.
  - The owner stated an intention to use all 14. The nine not named in count coverage were re-verified from primary AFL, Tribunal and club sources, including appeals (evidence file §3a). Reid's R24 offence with its ban served in 2027 follows the 2025 Baker precedent under regulation 21.2(c). No change to the list; the decision is recorded when R7R3 is signed.
- **7R2 stays held at P3.** Its built release `a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg` is never promoted. 7R3 builds its own release
  from `c8d4202a`.
