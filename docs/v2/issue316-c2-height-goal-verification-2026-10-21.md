# ISSUE-316 C2 Collingwood height-join goal verification — 2026-10-21

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `3e6d835b2a5dc95f` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. All four cases remain unresolved as to cause and historical correctness; the existing nonmapping refusals are preserved (N6). Public-page reads recorded here are not independent source authority. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Targeted public-page review complete with freshness/access limits. All four cases remain UNRESOLVED as to cause and historical correctness. Existing nonmapping refusals remain. Production NO-GO.** No source replacement, correction, identity/alias decision or acceptance.

## 1. Scope, access and evidence distinctions

One agent. Read AGENTS.md and relevant [source reconciliation](issue316-c2-height-source-reconciliation-2026-10-21.md) §§1–4 and [exception evidence review](issue316-c2-height-exception-evidence-2026-10-21.md). Reused their completed candidate observations; no reconciliation rerun or raw candidate reads. Implementation basis remains 4a2eea89cccc465f2f017fb06ad55a7d4cb7733d and its retained rehearsal candidate.

Access date for all public-page attempts below: **2026-10-21 (Australia/Sydney)**. Browser/web reads only. The web tool supplied rendered publisher text through its retrieval service, with the crawl ages listed below. These are NOT all fresh origin reads. A direct browser attempt failed because the in-app browser was unavailable; browser inventory was empty. Consequently current-origin verification is incomplete. “Retrieved page” below means the returned published-page representation, with its explicit cache limitation, not a guarantee that the origin serves identical bytes now. No raw HTML snapshot, response-byte hash or independent acquisition binding was created or claimed.

Retained candidate values are E1 = source reconciliation §4, measured previously against the bindings recorded there. E2 = exception review §1 records incomplete predecessor hash verification. That check **has not passed** here. Resetting the stalled local inspection runtime restored document access only; it did not validate any predecessor binding. Earlier limited/failed evidence, raw bytes and manifests remain untouched.

All retrieved football evidence is AFL Tables. Agreement between its pages is same-publisher corroboration, not independent authority. Live/cache agreement cannot establish historical correctness, a correction, an approved identity mapping or stage applicability.

## 2. Exact public URLs and retrieval status

| Ref | Exact URL | Returned scope / freshness reported by web tool |
|---|---|---|
| R | https://afltables.com/afl/stats/alltime/collingwood.html | Collingwood all-time register; crawled today. Relevant rows at rendered lines 221, 983, 291 and 91. |
| J | https://afltables.com/afl/stats/players/J/Jim_Jackson.html | Exact E1 diagnostic profile; crawled 2 months ago. Season table and By team table, lines 43–52 and 73–77. |
| V | https://afltables.com/afl/stats/players/V/Victor_Jackson.html | Exact E1 diagnostic profile; direct and register-link attempts failed with “Cache miss”. No profile contents verified. |
| B | https://afltables.com/afl/stats/players/B/Bert_Chapman1.html | Exact E1 diagnostic profile, including suffix 1; crawled 5 months ago. Season table, lines 43–49. |
| T | https://afltables.com/afl/stats/players/T/Terry_Waters.html | Exact E1 diagnostic profile; crawled 2 months ago. Season table, lines 41–51. |
| S12 | https://afltables.com/afl/stats/1912.html | Direct register season link; inspected only relevant Collingwood Jackson rows, lines 92–93. Crawled last month. |
| G12 | https://afltables.com/afl/stats/teams/collingwood/1912_gbg.html | Linked from S12 Collingwood Players Game by Game; inspected Victor's row, line 18. Crawled 9 months ago. |
| S60 | https://afltables.com/afl/stats/1960.html | Direct register season link; inspected Collingwood Chapman row, line 86. Crawled 3 weeks ago. |
| S63 | https://afltables.com/afl/stats/1963.html | Direct register season link; inspected Collingwood Chapman/Waters rows, lines 79/110. Crawled last month. |

Navigation-only page: https://afltables.com/afl/teams/collingwood_idx.html (crawled today), reached from J's Collingwood link; its All Time Player List link led to R. R's four player links resolve to J/V/B/T exactly. No alternative same-name profile was selected. No other publisher, paid source, bulk crawl or acquisition tool was used. No match page was opened: the inspected summaries supply no identified disputed match for J/B/T, and Victor's small linked season tally provides the bounded corroboration available without broadening investigation.

Bounded quotations, under 25 words per page: R's relevant column headings include **“Games (W-D-L)”**, **“Goals”**, **“Seasons”**. J and T label their goal column **“GL=Goals”**; B uses that same key. G12 is headed **“Collingwood - 1912 Game by Game Goal Tallies”**. Failed V retrieval returned **“Cache miss”**, a tool failure, not publisher evidence. All other values below are paraphrased observations rather than long quoted rows.

## 3. Retained observations versus retrieved register

R is explicitly a Collingwood list. Its entries agree with E1's retained register observations for these fields; this is a current-retrieval observation with R's freshness qualification, not a newly accepted binding.

| Cap / name | E1 retained register games / Goals / seasons | R retrieved games / Goals / seasons | R identifying details |
|---|---|---|---|
| 162 Jim Jackson | 93 / 22 / 1910–1915, 1920 | Same | DOB 1890-04-28; HT 174 cm; link J |
| 182 Victor Jackson | 3 / blank / 1912 | Same; Goals visibly empty, NOT a printed zero | DOB 1889-04-09; HT 185 cm; link V |
| 615 Bert Chapman | 68 / 34 / 1960, 1962–1966 | Same | DOB 1942-03-14; HT 170 cm; link B |
| 649 Terry Waters | 163 / 181 / 1963–1972 | Same | DOB 1943-12-14; HT 188 cm; link T |

## 4. Case findings

### Cap 162 — Jim Jackson: scope verified within publisher; difference unexplained

[Profile J](https://afltables.com/afl/stats/players/J/Jim_Jackson.html) names Jim Jackson and gives birth date 28 April 1890 and height 174 cm, consistent with R. Its Collingwood By team row gives **93 games / 18 goals**, agreeing with E1's retained stats observation. The Collingwood season rows are:

| Season | Games | Goals |
|---|---:|---:|
| 1910 | 5 | 1 |
| 1911 | 9 | 3 |
| 1912 | 18 | 4 |
| 1913 | 18 | 4 |
| 1914 | 17 | 2 |
| 1915 | 14 | 1 |
| 1920 | 12 | 3 |

These displayed figures sum to 93 games and 18 goals. S12 independently within the same publisher lists the 1912 Collingwood row as 18 games / 4 goals. J's **whole-career** totals are 116 games / 19 goals, including other clubs; those totals were not used as Collingwood totals.

**Supported finding:** R links to the exact recorded profile, with consistent identifying details and Collingwood games/seasons; retrieved pages contain 22 versus 18 at the same club scope. No inspected note attributes the four-goal difference to a season, match, correction or another player. Victor's four goals are not evidence that goals were transferred between the Jacksons. **UNRESOLVED:** which total is historically correct and why they differ. Stop this case: independent historical scoring evidence, or a documented publisher correction with underlying evidence, is required; a fresh origin read is also needed to establish current profile contents beyond the cached representation.

### Cap 182 — Victor Jackson: blank preserved; profile inaccessible

[R's Cap 182 entry](https://afltables.com/afl/stats/alltime/collingwood.html) links exactly to V and supplies the identifying details in §3. V could not be read, so its own identity details, complete career scope and current totals remain unverified. The directly linked [1912 season page](https://afltables.com/afl/stats/1912.html) lists Victor Jackson for Collingwood with **3 games / 4 goals**, consistent with E1 stats. The linked [Collingwood 1912 game-by-game page](https://afltables.com/afl/stats/teams/collingwood/1912_gbg.html) gives Victor three scoring entries, 1, 1 and 2, total 4. Its flattened rendering was not used to assign exact rounds or match dates.

**Supported finding:** retrieved register Goals is blank; the season/tally representations contain four goals in the relevant club/season scope. Existing height code's blank-to-zero conversion is separate implementation behaviour, not a zero printed on R or approved missing-value meaning. **UNRESOLVED:** meaning/cause of the blank, the correct historical goal total, and direct profile verification. Stop this case: a readable exact profile/current page and independent evidence for the three 1912 appearances/scoring would be needed for a stronger conclusion. No substitution, invented identity or blank policy change.

### Cap 615 — Bert Chapman: exact suffixed profile; one-goal difference unexplained

[Profile B](https://afltables.com/afl/stats/players/B/Bert_Chapman1.html) names Bert Chapman, DOB 14 March 1942, HT 170 cm, consistent with R; all its season rows are Collingwood. The seasons are 1960 and 1962–1966, games 10/11/16/14/11/6, and goals 4/2/17/10/2/blank respectively. The displayed profile total is **68 games / 35 goals**, consistent with E1 stats. No goal number is printed for its 1966 row; this review does not turn that blank into an approved zero. The numeric season goals alone sum to 35. S60 corroborates 10 games / 4 goals in 1960; S63 corroborates 16 / 17 in 1963.

**Supported finding:** register and exact linked profile agree on identifying details, games and season scope, while retrieved totals differ 34 versus 35. There is no other-club total involved. The sampled linked seasons do not locate the one-goal difference; no register season breakdown or correction note establishes a disputed match. **UNRESOLVED:** cause and historically correct total. Stop this case: independent club-season or match scoring evidence, or an evidenced publisher correction, is needed; fresh origin profile access remains incomplete.

### Cap 649 — Terry Waters: Collingwood-only scope; one-goal difference unexplained

[Profile T](https://afltables.com/afl/stats/players/T/Terry_Waters.html) identifies Terry Waters, DOB 14 December 1943, HT 188 cm, consistent with R. All listed seasons are Collingwood, 1963–1972. Its games by year are 17/19/17/15/19/15/21/22/12/6; goals are 50/41/25/11/13/9/15/6/9/1. These sum to **163 games / 180 goals**, the printed total and E1 stats observation. S63 corroborates 17 games / 50 goals in 1963.

**Supported finding:** same club/career scope and identifying details, but register 181 versus profile 180. No inspected note or linked sampled season explains the extra register goal or locates a disputed match. **UNRESOLVED:** cause and historically correct total. Stop this case: independent club-season/match scoring evidence, or an evidenced publisher correction, is needed; fresh origin profile access remains incomplete.

## 5. Decision boundary and smallest next decision

No case is explained at the level needed to authorise a data correction. The targeted evidence supports a publisher register-versus-profile/season inconsistency, subject to the retrieval freshness limits. It does not prove an acquisition defect, stale register, mistaken attribution, correct score, canonical identity mapping or accepted height exception.

**Smallest next decision:** owner decides whether to authorise independent historical goal verification for these same four Caps, explicitly including Victor's literal blank and three appearances. Such a review would need an independent club/history/statistical publisher or primary scoring records; availability and access terms have not been investigated. It should require current exact-profile access where missing and retain source-specific totals rather than choose a winner. No further AFL Tables crawl, source reconciliation or local measurement is proposed: those cannot establish independent historical correctness. Until further evidence/authority, preserve all four nonmapping refusals and the documented limitations.

All successor, field/availability and stage-applicability decisions remain pending. ET applicability unresolved. All three 2026 Brownlow keys — brownlow_match_votes, brownlow_round_votes, brownlow_season_total — remain pending; canonical suppression/publication and AFL API authority, eligibility and ownership restrictions unchanged. 1,640 remains rehearsal-only. No active-reference change, correction, identity/alias change, blank-Goals policy, gate relaxation, runner/contract change or stage execution.

## 6. Files and validation

Created this note and updated necessary current ISSUE-316 links/next actions in IssuesIndex.md, issues.md, issues/open/AFLDB-ISSUE-316.md and docs/v2/issue316-c2-preparation-2026-10-21.md. ISSUE-316 remains OPEN; Open Issues/index membership unchanged. No CHANGELOG entry for investigation-only findings. Earlier reviews, retained bytes/manifests and failed/limited evidence were preserved; unrelated changes and .codex/ untouched.

Validation: exact target absence check, relevant local-document reads, targeted web navigation/finds, explicit cache/failure accounting, arithmetic on displayed case summaries, and document/tracking readback. No source reconciliation rerun, acquisition tool, bulk crawling, source-data replacement, shell/Git, host/database, WSL, installation, census, import, rebuild, gates, D7, rehearsal, cleanup or deployment. Stop.
