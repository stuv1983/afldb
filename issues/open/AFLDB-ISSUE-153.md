# AFLDB-ISSUE-153 — deferred natural-language relationship and cross-domain semantics

| Field | Value |
|---|---|
| Status | **OPEN — STAGES 1-5 AND 7 IMPLEMENTED 2026-09-09. Stage 6 (C1/D6/C5/C6) NOT STARTED and NOT AUTHORISED. All DB-backed tests are WRITTEN BUT UNRUN — the 55432 tunnel was down. `PARSER_VERSION` 39 -> 40, bumped once for the whole Stages 2-5 checkpoint. Operator decisions Q1, Q1a(a), Q2 (127 selection events), Q3, Q4, Q5 and Q6 are LOCKED and implemented as given. Stage 0 (§1-§10) is the settled record and must NOT be re-run. READ §11 FIRST — it is the session handoff.** |
| Branch | `opus/issue-153-nl-deferred-semantics` (worktree `D:\dev\afldb-issue-153`) |
| Base | `1476de6` — the accepted ISSUE-152 Phase F checkpoint on fresh `main` |
| Parser baseline | `PARSER_VERSION` **39** at Stage 0 (`src/search/nl/plan.ts`) — verified, and unchanged by Stage 0. **Now 40**: bumped exactly once by the Stages 2–5 semantic checkpoint (§11.1). Do not bump again for anything already in that checkpoint. |
| Evidence | `nl-ui-out-152-phaseg/evidence/ISSUE-153-stage0-evidence-afldb_test-20260909-215150.txt` and `...-addendum-afldb_test-20260909-215331.txt` (both `afldb_test`, role `afldb_app`, `default_transaction_read_only=on`, `BEGIN TRANSACTION READ ONLY … ROLLBACK`, backend pids 2420889 / 2422426). Production untouched. |
| Predecessor | `AFLDB-ISSUE-152` Finding **F1**, decisions **D6**/**D8**, and Phase F decision **F-D1** |

---

## 1. Scope

ISSUE-153 exists to resolve the semantic cases deliberately deferred from ISSUE-152:
**C1, FS1, FS2, FS3, FS6, D6, D8, X3**, together with the public-page defect
(**F1**) that is their common cause.

These are **not** Phase F regressions and are **not** permission to reopen accepted
ISSUE-152 semantics. Everything in §2 is frozen.

Stage 0 is investigation only. It recovers each label's exact definition from the
record, measures every answerable candidate interpretation against `afldb_test`,
and proposes decisions. **It implements nothing.**

### 1.1 What ISSUE-152 handed over, verbatim

- **F1** (ISSUE-152 §8) — `/records/father-son` and `/records/family` do not read what
  their prose says. Recorded as an *external dependency*; ISSUE-152 repaired neither page.
- **D6** — "biggest football families": all relationship types, or siblings?
  DEFERRED, on the ground that the metric was unmeasured (**M5**).
- **D8** — "father-son" names two different things in AFLDB's own UI.
  DEFERRED, on the ground that *"no witness can distinguish the two readings"*.
- **F-D1** — X3 deferred, option (b), because its son-side wording intersects D8.

---

## 2. Frozen — accepted ISSUE-152 semantics that ISSUE-153 must not change

Phase F is accepted and merged. The following are settled and are **not** in scope:

1. **"played and also coached" is a conjunction, not a chronology.**
2. **Actual coaching appearance is required** — `match_coaches`, not the `coaches`
   identity seam (X1 = 365, not the 368 identity-only figure).
3. **`played_for_club` semantics** as already proven (F-D4).
4. **Coaching club scope folds through `clubs.organization_id`.**
5. **One-sided ambiguous club composition fails closed** (F-D3).
6. **Temporal wording — "later coached", "went on to coach", "became a coach" —
   remains unsupported** unless ISSUE-153 separately proves and adopts a chronology
   contract. Stage 0 proposes **no** chronology contract; see §7.6.
7. **`PARSER_VERSION` baseline is 39.** Stage 0 does not bump it.
8. **X3 is a list, never a ranking** (D9).
9. C2, C3, C4 and FS4 are shipped and accepted. Their wording is relationship-typed
   and is not reopened.

---

## 3. Recovered definitions — what each of the eight labels actually means

Recovered from `issues/open/AFLDB-ISSUE-152.md` §5.1/§5.2/§5.3/§7/§8/§22/§25/§26,
`issues.md`, `IssuesIndex.md`, `ISSUE-152-nl-evidence.sql`, the Phase D/F corpora,
and current parser/builder code. **No label's meaning was inferred from its name.**

| Label | Recovered definition | Source of record |
|---|---|---|
| **C1** | "Biggest football families" — a **`family` grain** question: `family_key`-grouped rows with a member list, ranked by a size metric. GAP-DECIDE on **D6**. | §5.1 row C1; §6.2 |
| **FS1** | Father–son **selections** — the AFL **draft rule**, the SON side. Reuses the existing `father_son_selection` builder. GAP-DECIDE on **D8**. | §5.1 row FS1; §6.3 |
| **FS2** | **Club-scoped** father–son selections ("Geelong father-son selections"). Needs a **new** club-scoped builder. GAP-DECIDE on **D8**. | §5.1 row FS2 |
| **FS3** | Father–son selections **by draft year** ("father-son selections in 2022"). Needs a **new** year-scoped builder. GAP-DECIDE on **D8**. | §5.1 row FS3 |
| **FS6** | Father–son selections **by club / by year as a distribution** — an `achievement_summary`-shaped grouping, not a player list. Rated **GAP-SAFE**, blocked only by D8. | §5.1 row FS6 |
| **D6** | The **decision**: is a "football family" every relationship type grouped by `family_key`, or siblings only? Also (via **M5**) *what makes one biggest* — member count or combined career games. | §7 row D6; §5.3.G M5 |
| **D8** | The **decision**: does the bare phrase "father-son" bind to the **draft rule** (`father_son_selections`) or to the recorded **parent–child relationship** (`player_relationships`)? | §7 row D8; §8 F1 |
| **X3** | Father–son **selected** player who **also coached** — a cross-domain conjunction of `father_son_selection` AND `has_coached`. Deferred by **F-D1(b)**, not by lack of evidence. | §5.1 row X3; §25.9; §26.4 |

### 3.1 The two tables these labels sit over

```
father_son_selections            (migration 006, checks 088)   -- the DRAFT RULE
  drafted_player_id  -> the SON selected under the rule   + drafted_link_status
  father_player_id   -> the FATHER                        + father_link_status
  club_id -> clubs(id)   draft_year   selection_pick   rule   competition

player_relationships             (migration 006)               -- the RELATIONSHIP
  person_a_player_id / person_a_role     person_b_player_id / person_b_role
  relationship (enum)   relationship_label   family_key   family_name
```

Direction is **role-typed**, never positional: `person_a_role = 'father'`,
`person_b_role = 'son'` (the Phase D builders say so explicitly,
`src/db/queries/grid-solver.ts:1331`).

### 3.2 Current decline behaviour — exactly how each label is held today

| Mechanism | Location | Effect |
|---|---|---|
| **The D8 guard** | `src/search/nl/vocab.ts:1166` `FATHER_SON_RULE_RE = /\bfather[- ]son\b/`, applied at `parser.ts:706` | *Any* father-son wording that is not an explicit **FATHER-side FS4 cue** stops the relationship extractor dead, consuming nothing. The pre-existing leftover-token decline then fires. Holds **FS1, FS2, FS3, FS6**. |
| **No family frame** | `vocab.ts` relationship frames | No frame matches "biggest football families", so the extractor never fires. Holds **C1**. |
| **Named family decline** | `vocab.ts` `relationshipFrame('(?:famil(?:y\|ies)|relatives?…)')` | "AFLDB cannot yet answer a question about a football family as a whole." |
| **Phase F in-reading refusal** | `src/search/nl/parser.ts:1837` | Inside the cross-domain reading, **any** father-son wording is refused by name before a predicate is emitted — the F-D1 back door. Holds **X3**. |
| **Corpus pins** | `tests/nl-ui/corpora/afldb-ui-questions-relationships-decline-v1-20260909.csv` rows `rel_dec_001`–`006`; `...cross-domain-decline-...csv` rows `xd_dec_012`–`015` | One named decline row per boundary, so a phrasing that starts answering fails the sweep by name. |

---

## 4. Measured evidence — `afldb_test`, read-only, 2026-09-09

All figures below are from the two transcripts named in the header. Section numbers
are this issue's evidence pack, not ISSUE-152's.

### 4.1 D8 — the collapse is a **set identity**, and it is **structural**

ISSUE-152 measured population *sizes* and concluded the readings "coincide
extensionally". A size collapse is not a set identity — 127 = 127 is consistent with
two disjoint sets. Stage 0 tested the sets themselves.

| Test | Rule reading | Relationship reading | In both | Rule only | Relationship only |
|---|---|---|---|---|---|
| §1.1 **sons** (trusted) | 99 | 99 | **99** | **0** | **0** |
| §1.2 **fathers** (trusted) | 107 | 107 | **107** | **0** | **0** |
| §1.3 **(father, son) pairs** | 96 | 96 | **96** | **0** | **0** |
| §1.4 divergence witnesses | — | — | — | **0 rows** | **0 rows** |

The readings are **identical at every level**, not merely equinumerous.

**§1.5 — why. This is the decisive new fact.**

| Table | `source_id` | rows | `import_batch_id` | `extraction_method` |
|---|---|---|---|---|
| `father_son_selections` | **11** | 127 | **12** | ∅ |
| `player_relationships` `parent_child` | **11** | 127 | **12** | **`father_son.py`** |

The `parent_child` rows were produced by **`father_son.py`, from the same source and
the same import batch as `father_son_selections`**. The "relationship" reading is not
an independent dataset that happens to agree — it is a **derived projection of the
draft-rule table**. There is one underlying fact, recorded twice.

**§1.6** — every `parent_child` row carries the single label
`father and son (AFL father–son rule selection)`; every `father_son_selections` row
carries `rule = 'father-son'` (competition: national 96, pre-draft 22, rookie 9).
**§0.2** — all 127 rows are `father → son`; no other role pair exists.
**§1.7** — 0 rule sons with no relationship row, 0 relationship sons with no rule row,
0 sons selected more than once.

> **This retires D8's stated ground.** ISSUE-152 deferred because "no witness can
> distinguish the two readings". That is true, and Stage 0 now knows *why*: there is
> nothing to distinguish. The decision is therefore not a choice between two rival
> truths but a choice of **which record is authoritative** — answerable, and answered
> in §7.1.

### 4.2 FS1 — the answer population

| Reading | Definition | Players |
|---|---|---|
| **A** | trusted drafted link — the existing `father_son_selection` builder | **99** |
| **B** | trusted drafted link **and** father also trusted-linked | 96 |
| **C** | trusted drafted link **and** the son actually played | **99** |
| **D** | the shipped `has_afl_father` builder (father linked **and** played) | 96 |

**A = C** — §2.2 returned **0 rows**: every trusted rule son actually played. No
"has played" filter is needed, and adding one would be dead code.

**A − D = exactly 3 players** (§A1, §A2), and the difference is meaningful:

| Son | id | Draft year | Father | Father link status |
|---|---|---|---|---|
| Shane Morrison | 11802 | 1999 | Peter Morrison | `unmatched` |
| Mitch Morton | 9715 | 2004 | Noel Morton | `unmatched` |
| Max Michalanney | 9409 | 2022 | Jim Michalanney | `unmatched` |

These three **were** selected under the father–son rule, so they belong in FS1; their
fathers are **names, not player identities**, so they must **not** appear in
`has_afl_father`. **FS1 is therefore not an alias of C3** — it is a genuinely
different question with a different answer, and needs its own builder.

### 4.3 FS2 — club lineage

17 organizations; **0** selections have a NULL `club_id`, so no fail-closed club case
exists in this data (§3.3). Two organizations span more than one `club_id` (§3.2):

| org | `club_id`s | seasons | selections folded |
|---|---|---|---|
| **16** | 16 North Melbourne (1925–2026) + 14 Kangaroos (1999–2007) | rename | 6 + 1 = **7** |
| **24** | 8 Footscray (1925–1996) + 24 Western Bulldogs (1997–2026) | rename | 2 + 9 = **11** |

Both are **renames**, which combine through `organization_id` — the established club
lineage rule. **Fitzroy (org 7, one selection, 1993) stays separate** from Brisbane
(org 3, 6 selections): that is a **merger**, and mergers are link-only, not combining.
Folding it would be a data-modelling error, not a lineage improvement.

Top organizations: Collingwood 17, Geelong 14, Carlton 13, Western Bulldogs 11,
Essendon 9, Melbourne 9, Richmond 8.

### 4.4 FS3 — the chronology trap (decisive)

| Linked sons who played | Debut **=** draft year | Debut **+1** | Debut **+2 or more** | Debut **before** draft |
|---|---|---|---|---|
| 99 | **0** | 60 | 39 | 0 |

**Not one of the 99 debuts in the season they were drafted.** `draft_year` and any
playing-season reading are therefore **disjoint concepts in this data** — the
divergence is total, not marginal. Witnesses run to +3 years (Ayce Cordy 2008→2011,
Jed Bews 2011→2014, Michael James 1988→1991, Tyler Brown 2017→2020).

Coverage: 1988–2025, 35 distinct draft years.

> FS3's builder must own its **own** year range, separately from `seasonMin`/`seasonMax`,
> and a question that mixes a draft-year scope with a playing-season scope must fail
> closed. Folding FS3 into the generic season scope would answer a different question
> for every single row.

### 4.5 FS6 — the denominator changes the public answer

| Grouping | Groups | All rows | Trusted rows |
|---|---|---|---|
| by organization | 17 | **127** | **99** |
| by draft year | 35 | **127** | **99** |

**14 of 17 organizations change** between the two denominators (§5.2). The largest
divergences: Carlton **13 → 7**, Geelong **14 → 10**, Adelaide **4 → 1**,
Collingwood **17 → 15**. This is not a rounding difference; for Carlton and Adelaide
it is most of the answer.

### 4.6 D6 / C1 — what a "family" is, and what makes one "biggest"

**Extension (§6.1, §6.2 — exhaustive).**

| relationship | rows | with `family_key` | without | distinct keys |
|---|---|---|---|---|
| `sibling` | 498 | **498** | 0 | 378 |
| `parent_child` | 127 | **0** | 127 | 0 |

**Zero** `family_key` groups contain a non-sibling row (§6.2). So today a family
**is** a sibling family, in fact — `/records/family`'s prose is accurate but its query
does not enforce it. F1's family half is latent exactly as ISSUE-152 recorded, and
Stage 0 confirms the enforcement is a **no-op on current data**.

**Metric — gap M5 is now closed, and the two metrics disagree violently (§6.3, §6.4).**

| family | members | combined games | rank by members | rank by games | shift |
|---|---|---|---|---|---|
| `ablett-0004` | 5 | 906 | 1 | 1 | 0 |
| `hiskins-0415` | 4 | 375 | 2 | 36 | **+34** |
| `calverley-0156` | 4 | 190 | 2 | 136 | **+134** |
| `pender-0682` | 4 | **33** | 2 | **303** | **+301** |

`pender-0682` is the **2nd biggest family by member count and the 303rd by games**.
"Biggest" is not one question. Top by games: Ablett 906, Madden 710, Burgoyne 647,
Nankervis 578, McVeigh 557, Cornes 555.

**`getFamilyRecords` already ranks by `combined_games DESC, linked_members DESC`**
(`src/db/queries/family-records.ts:39`). The product therefore already answers
"biggest" as combined career games; no third reading needs inventing.

**Folding `parent_child` in (reading R3, §6.5, §6.6).** 96 linked parent-child edges;
only **14** touch an existing sibling family; **77 sit in no sibling family at all**.
Folding would create ~77 families that do not exist today and extend 14 more
(Cloke +3, Daniher +2, Cordy +2, Harvey, Hawkins, Viney, Ebert, Dear, Kelly,
Richardson, Barham, Burgoyne, Davey). That is **a different product, not a repair**.

**Identity hazard (§6.7).** `ablett-0004` holds two distinct player ids both displaying
as **"Gary Ablett"** (4700, 4701). A family answer must disambiguate by id, never by
name. **Fail-closed size (§6.8):** 81 `family_key`s have an unlinked side, over 109 rows.

**Family size distribution (§A3, §A4):** 351 families with at least one linked member,
704 linked players — sizes 1×46, 2×262, 3×39, 4×3, 5×1. **46 families of size 1**
(only one side linked) must be excluded from any "family" answer: a family of one is
not a family.

### 4.7 X3 — the answer does not depend on D8 at all

| Reading | Answer |
|---|---|
| **A** rule reading × `coaches` identity only | **1** |
| **B** rule reading × actually coached (`match_coaches`) | **1** |
| **C** relationship reading × `coaches` identity only | **1** |
| **D** relationship reading × actually coached | **1** |

All four agree, and the row is the same under both readings:
**Rhyce Shaw, player 10974, coach 233, 29 coached games**, 1999 Collingwood selection
(org 5), father **Ray Shaw** (10853) — confirming the figures carried in the brief.

**The FATHER side is a much larger set (§7.4): 11 players** — Robert Walls (347 coached
games), Tony Jewell (153), Tony Shaw (88), Graeme John (66), Francis Bourke (46),
Tim Watson (44), Darren Crocker (15), Scott Camporeale (11), Jarrad Schofield (7),
Donald McDonald (5), Todd Viney (5).

> **Finding.** FS4 — the father-side wording — is **already shipped and answering**
> (`rel_022`–`rel_026`). But the Phase F in-reading refusal at `parser.ts:1837` blocks
> *any* father-son wording inside the cross-domain reading, so the father-side
> composition declines too. F-D1's stated scope was the **son** side; the guard as
> built is broader than its own justification and collaterally blocks an 11-row
> answer whose wording is accepted everywhere else. See §7.5.

---

## 5. Decision tables

The twelve-field table requested, per label. "Evidence §" refers to §4 above.

### 5.1 C1 — biggest football families

| # | Field | Value |
|---|---|---|
| 1 | Exact wording tested | `biggest football families` (`rel_dec_001`); `which family has the most AFL players`; `families with three AFL players` (C5) |
| 2 | Intended subject | a **family**, not a player — a new grain |
| 3 | Intended object | the family's member set |
| 4 | Directionality | none; a family is symmetric |
| 5 | DB source / seam | `player_relationships.family_key` → `players` → `player_career_stats.games` |
| 6 | Can the DB prove it? | **Yes**, for sibling families: 351 families / 704 linked players, both metrics computable (§4.6) |
| 7 | Identity / linkage | both sides must be linked; **`ablett-0004` has two ids named "Gary Ablett"** — disambiguate by id, never name; 46 size-1 families must be excluded |
| 8 | Club / lineage | **not applicable** — a family has no club |
| 9 | Chronology | **not applicable** |
| 10 | Current parser behaviour | no frame matches; extractor never fires; pre-existing leftover-token decline |
| 11 | Current decline | `rel_decline_family_grain`, plus the named "football family as a whole" decline |
| 12 | Why 152 deferred it | **D6** unresolved *and* **M5** unmeasured — the ranking metric was never measured |
| 13 | Candidate semantics | **(a)** family = sibling `family_key` group, ranked by **combined career games** (matches the existing page); **(b)** same, ranked by **member count**; **(c)** fold `parent_child` in by player graph (R3) |
| 14 | What must be measured | **DONE.** M5 closed (§4.6): metrics disagree by up to 301 rank places; R3 costed at 77 new + 14 extended families |

### 5.2 FS1 — father–son selections (the draft rule)

| # | Field | Value |
|---|---|---|
| 1 | Exact wording tested | `players selected under the father-son rule` (`rel_dec_003`) |
| 2 | Intended subject | the **SON** — the player selected under the rule |
| 3 | Intended object | the selection itself (father is not named in the question) |
| 4 | Directionality | **son side.** The mirror-image father side (FS4) is **already shipped** |
| 5 | DB source / seam | `father_son_selections.drafted_player_id`, `drafted_link_status IN ('unique','resolved')` — the existing `father_son_selection` builder |
| 6 | Can the DB prove it? | **Yes — 99 players** (§4.2) |
| 7 | Identity / linkage | 28 selections have an unlinked son (a name, never an identity). **All 99 trusted sons actually played**, so no games filter is needed |
| 8 | Club / lineage | none in the bare form; the builder must own no club |
| 9 | Chronology | none in the bare form |
| 10 | Current parser behaviour | the **D8 guard** (`vocab.ts:1166`) stops the extractor dead; nothing is consumed |
| 11 | Current decline | `rel_decline_fs1`; leftover-token decline |
| 12 | Why 152 deferred it | **D8** — the bare phrase's two readings were held to be indistinguishable |
| 13 | Candidate semantics | **(a)** bind to `father_son_selections` = **99**; **(b)** bind to `parent_child` = the same 99 by §4.1; **(c)** keep declining |
| 14 | What must be measured | **DONE.** Readings (a) and (b) are **set-identical** (§4.1); FS1 ≠ C3 by exactly 3 players (§4.2) |

### 5.3 FS2 — club-scoped father–son selections

| # | Field | Value |
|---|---|---|
| 1 | Exact wording tested | `geelong father-son selections` (`rel_dec_004`) |
| 2 | Intended subject | the SON, scoped to the selecting club |
| 3 | Intended object | the selection, and the club that made it |
| 4 | Directionality | son side, club-owned |
| 5 | DB source / seam | `father_son_selections.club_id` → `clubs.organization_id`; needs a **new** `father_son_selection_for_club(org)` builder |
| 6 | Can the DB prove it? | **Yes** — 17 organizations, exhaustive (§4.3) |
| 7 | Identity / linkage | as FS1; club-scoped trusted counts in §4.3 |
| 8 | Club / lineage | **material.** Renames fold: org 16 = North Melbourne + Kangaroos (**7**), org 24 = Footscray + Western Bulldogs (**11**). **Fitzroy (org 7, 1) must NOT fold into Brisbane** — merger, link-only. 0 NULL `club_id`s |
| 9 | Chronology | none |
| 10 | Current parser behaviour | D8 guard; club token then survives as leftover |
| 11 | Current decline | `rel_decline_fs2` |
| 12 | Why 152 deferred it | **D8**, plus no club-owning builder existed (the v33 ownership rule would fail closed) |
| 13 | Candidate semantics | **(a)** fold by `organization_id` (consistent with every other AFLDB club scope); **(b)** raw `club_id` — would split the Bulldogs 2/9 and the Kangaroos 6/1 |
| 14 | What must be measured | **DONE** (§4.3). Reading (b) is inconsistent with the rest of the product and is not recommended |

### 5.4 FS3 — father–son selections by draft year

| # | Field | Value |
|---|---|---|
| 1 | Exact wording tested | `father-son selections in 2022` (`rel_dec_005`) |
| 2 | Intended subject | the SON, scoped to a year |
| 3 | Intended object | the selection, and the year it was made |
| 4 | Directionality | son side, year-owned |
| 5 | DB source / seam | `father_son_selections.draft_year`; needs a **new** `father_son_selection_between(from,to)` builder |
| 6 | Can the DB prove it? | **Yes** — 1988–2025, 35 distinct years (§4.4) |
| 7 | Identity / linkage | as FS1 |
| 8 | Club / lineage | none |
| 9 | Chronology | **decisive.** `draft_year` is a **selection** year, not a playing season. **0 of 99** sons debut in their draft year; 60 debut +1, 39 debut +2 or more (§4.4) |
| 10 | Current parser behaviour | D8 guard; the year is then read by the generic season extractor and left unowned |
| 11 | Current decline | `rel_decline_fs3` |
| 12 | Why 152 deferred it | **D8**, plus no year-owning builder |
| 13 | Candidate semantics | **(a)** the year means `draft_year`; **(b)** the year means a playing season — a **different set for every row**; **(c)** decline any year wording |
| 14 | What must be measured | **DONE** (§4.4). (a) and (b) share **zero** rows. FS3 must own `draft_year` separately from `seasonMin`/`seasonMax`, and mixing them must fail closed |

### 5.5 FS6 — father–son selections by club / by year (distribution)

| # | Field | Value |
|---|---|---|
| 1 | Exact wording tested | `father-son selections by club` (`rel_dec_006`) |
| 2 | Intended subject | the **distribution**, not a player list |
| 3 | Intended object | counts per organization or per draft year |
| 4 | Directionality | son side (one row = one selection) |
| 5 | DB source / seam | `father_son_selections` grouped by `clubs.organization_id` or `draft_year`; `achievement_summary`-shaped |
| 6 | Can the DB prove it? | **Yes** — 17 organization groups, 35 year groups (§4.5) |
| 7 | Identity / linkage | **this is FS6's own decision, and it is not FS1's.** A distribution can honestly count a selection whose son is unlinked; a player *list* cannot |
| 8 | Club / lineage | same as FS2 — fold renames by `organization_id` |
| 9 | Chronology | same as FS3 — `draft_year`, never a playing season |
| 10 | Current parser behaviour | D8 guard |
| 11 | Current decline | `rel_decline_fs6` |
| 12 | Why 152 deferred it | **D8 only.** FS6 was rated **GAP-SAFE** — the grouping shape already exists |
| 13 | Candidate semantics | **(a)** count **trusted** rows = 99, consistent with every other NL surface; **(b)** count **all** rows = 127, correct for "how many selections were made" |
| 14 | What must be measured | **DONE** (§4.5). The two denominators change **14 of 17** organizations — Carlton 13→7, Adelaide 4→1. **This is a real operator choice, not a formality** |

### 5.6 D6 — the family decision

| # | Field | Value |
|---|---|---|
| 1 | Exact wording tested | drives C1/C5/C6; page prose `src/app/records/family/page.tsx:15,99` |
| 2 | Intended subject | a family as a unit |
| 3 | Intended object | its members |
| 4 | Directionality | none |
| 5 | DB source / seam | `getFamilyRecords` (`family-records.ts:39`) groups **every** relationship type by `family_key` with **no** `relationship` filter |
| 6 | Can the DB prove it? | **Yes, and the defect is a no-op today**: `parent_child` has 0 `family_key`s, and 0 `family_key` groups contain a non-sibling row (§4.6) |
| 7 | Identity / linkage | 81 keys have an unlinked side; 46 families are size 1; `ablett-0004` name collision |
| 8 | Club / lineage | not applicable |
| 9 | Chronology | not applicable |
| 10 | Current parser behaviour | no family grain exists in NL |
| 11 | Current decline | named "football family as a whole" decline |
| 12 | Why 152 deferred it | ambiguity **plus** unmeasured metric (**M5**) |
| 13 | Candidate semantics | **extension:** (a) siblings only — enforce what the prose says; (b) all types via `family_key`; (c) fold `parent_child` in by player graph. **metric:** (d) combined games; (e) member count |
| 14 | What must be measured | **DONE** (§4.6). (a) and (b) are identical **on today's data**; (c) is +77 new / 14 extended families; (d) vs (e) differ by up to **301** rank places |

### 5.7 D8 — the father–son decision

| # | Field | Value |
|---|---|---|
| 1 | Exact wording tested | explicit: `players selected under the father-son rule`, `father-son selections`. Bare/vague: `which father-son players also coached` (`xd_dec_013`) |
| 2 | Intended subject | depends entirely on the reading |
| 3 | Intended object | a draft selection, **or** a recorded parent–child relationship |
| 4 | Directionality | father side **shipped** (FS4); son side **blocked** (FS1) |
| 5 | DB source / seam | `father_son_selections` **vs** `player_relationships WHERE relationship='parent_child'` |
| 6 | Can the DB prove it? | **The readings are set-identical** at son (99), father (107) and pair (96) level, with **0** divergence witnesses (§4.1) |
| 7 | Identity / linkage | identical link splits: 96 both-linked, 31 with a side unlinked |
| 8 | Club / lineage | only `father_son_selections` carries `club_id` — the relationship table has **no club at all** |
| 9 | Chronology | only `father_son_selections` carries `draft_year` — the relationship table has **no date at all** |
| 10 | Current parser behaviour | `FATHER_SON_RULE_RE` guard at `vocab.ts:1166` / `parser.ts:706`, plus the in-reading refusal at `parser.ts:1837` |
| 11 | Current decline | four named corpus rows plus the cross-domain refusal |
| 12 | Why 152 deferred it | "no witness can distinguish the two readings" — **true, and Stage 0 now knows why** |
| 13 | Candidate semantics | **(a)** `father_son_selections` is authoritative; **(b)** `parent_child` is authoritative; **(c)** split by **explicitness** — explicit rule/selection wording → draft rule, bare "father-son" keeps declining; **(d)** keep declining everything |
| 14 | What must be measured | **DONE** (§4.1). Provenance settles it: `parent_child` was written by **`father_son.py`** from **the same source 11 / batch 12**. It is a **projection** of the draft-rule table, which additionally carries club, year, pick and competition |

### 5.8 X3 — father–son selected player who also coached

| # | Field | Value |
|---|---|---|
| 1 | Exact wording tested | `players selected under the father-son rule who also coached` (`xd_dec_014`); `which father-son players also coached` (`xd_dec_013`); ranked form `xd_dec_015` |
| 2 | Intended subject | the SON, who is also a coach |
| 3 | Intended object | the coaching career (no club named) |
| 4 | Directionality | son side; the **father** side is a different, larger question (§4.7) |
| 5 | DB source / seam | `father_son_selection` **AND** `has_coached` (`coaches` → `match_coaches`) |
| 6 | Can the DB prove it? | **Yes — exactly 1 under all four readings** (§4.7) |
| 7 | Identity / linkage | player id **10974** ↔ coach id **233**; the 28 unlinked selected players are names, never identities |
| 8 | Club / lineage | **none** — X3 names no club. A club in an X3 question must refuse (F-D3) |
| 9 | Chronology | **frozen**: conjunction only. "later"/"became" remain declined (§2.6) |
| 10 | Current parser behaviour | the in-reading refusal at `parser.ts:1837` fires before any predicate is emitted |
| 11 | Current decline | `cross_domain_decline_father_son` ×4 |
| 12 | Why 152 deferred it | **F-D1(b)** — not evidence, but the product surface: a phrase that declines alone must not become answerable by appending "and also coached" |
| 13 | Candidate semantics | **(a)** ship with FS1 once D8 lands (F-D1's own re-add condition); **(b)** ship son-side only via a composition-scoped cue (F-D1 option (a), rejected); **(c)** keep deferred |
| 14 | What must be measured | **DONE** (§4.7). **X3's answer is invariant across all four readings**, so it is blocked by *wording*, never by evidence. Father-side composition = **11** and is collaterally blocked |

---

## 6. Semantic collisions and dependencies — how many decisions are really here?

**Eight labels. Two root decisions. Six stages.**

```
  D8  (what "father-son" binds to)          D6  (what a "family" is + what "biggest" means)
   |                                          |
   +-- FS1  son-side list          (99)       +-- C1   family grain + ranking
   +-- FS2  + club ownership       (17 orgs)  |
   +-- FS3  + draft-year ownership (35 yrs)   +-- (C5/C6 ride along — see §8 Q5)
   +-- FS6  + distribution grouping
   +-- X3   + coaching conjunct    (1)
```

- **No cross-group dependency.** ISSUE-152 §13.15 already established that none of
  C1/FS1/FS2/FS3/FS6/D6/D8 supplies a predicate, plan field or vocabulary rule that
  X1/X2/X3 consumes — except the single explicit F-D1 link, which is D8→X3 and sits
  inside Group 1.
- **Group 1 is one decision plus four mechanical extensions.** Once D8 binds,
  FS1 needs no new builder at all (`father_son_selection` exists and is tested);
  FS2 and FS3 need one small builder each, mirroring shapes that already exist; FS6
  needs a grouping shape that already exists; X3 needs **zero** new builders — only
  the removal of a refusal.
- **FS6 carries one sub-decision that is genuinely its own** (the 99-vs-127
  denominator, §4.5). It is not implied by D8.
- **X3 is answer-invariant** (§4.7), so it is the cheapest item in Group 1 and can
  ship in the same stage as the refusal removal.
- **Group 2 is the expensive one.** C1 needs a **new grain** (`family`), a new payload
  variant, a new renderer section and the F1 family-page repair. It shares nothing
  with Group 1.
- **F1 is upstream of both.** The public pages are what make "father-son" and
  "family" mean something in this product. Deciding the pages decides the NL binding;
  deciding NL first would risk shipping wording that contradicts the boards.

### 6.1 The asymmetry finding — the D8 guard is wider than its own justification

ISSUE-152 shipped, and the rendered corpus pins as **answering**:

| Corpus row | Wording | Binds to |
|---|---|---|
| `rel_023` | `players whose son was selected under the father-son rule` | `father_son_father` → **`father_son_selections`** |
| `rel_022` | `fathers of father-son selections` | `father_son_father` → **`father_son_selections`** |
| `rel_024` | `which father-son fathers played the most games` | `father_son_father` → **`father_son_selections`** |

and pins as **declining**:

| Corpus row | Wording |
|---|---|
| `rel_dec_003` | `players selected under the father-son rule` |

`rel_023` and `rel_dec_003` contain the **identical explicit phrase** "selected under
the father-son rule". The product therefore **already commits to the draft-rule
reading for that exact wording** — it simply does so on one side only.

The product also already has a **working disambiguation convention**, shipped and
accepted in Phase D:

- naming the **rule** → the draft-rule table (`father_son_father`, FS4);
- naming only the **relationship** → `player_relationships`
  (`has_afl_father` / `has_afl_son`, C3 — e.g. `players whose father also played AFL`).

D8's stated ground ("no witness can distinguish the readings") applies **identically**
to `rel_023`, which ships. The asymmetry is an artefact of `father_son_father` having
been the one builder the parser could already reach — not a semantic position.

---

## 7. Recommended decisions

Each recommendation names the evidence it rests on. **None may be implemented before
§8 is answered.**

### 7.1 D8 — bind explicit rule wording to `father_son_selections`; keep bare wording declining

**Recommend candidate (c), with (a) as its authority rule.**

- `father_son_selections` is **authoritative**; `player_relationships.parent_child` is
  its **projection**, written by `father_son.py` from the same source and batch (§4.1).
  This is not a coin-flip between rival truths.
- The draft-rule table additionally carries `club_id`, `draft_year`, `selection_pick`,
  `rule` and `competition` — every scope FS2, FS3 and FS6 need. The relationship table
  carries **no club and no date at all** (§5.7 rows 8–9). Only one reading can answer
  FS2/FS3/FS6 even in principle.
- **Explicit** rule/selection wording binds to it; **bare** "father-son players" /
  "father-son pairs" keeps declining, because that wording really is ambiguous between
  the draft rule and any father-and-son, and C3/C4 already serve the relationship
  reading under unambiguous wording.
- This is **symmetric with what already ships** (§6.1) and introduces no reading the
  product has not already committed to.
- **Add a durability invariant.** Migration 088 already holds father-son link checks.
  Add a `db-health` assertion that the two populations stay set-identical, so the
  binding is monitored rather than assumed. This converts an undecidable semantic into
  a checked one — and is the answer to "nothing enforces that" in ISSUE-152 §8.

### 7.2 FS1 — answer **99**, reading A, using the existing builder

`father_son_selection` unchanged. No games filter (A = C, §4.2). FS1 is **not** an
alias of C3: the three unmatched-father witnesses (§4.2) must be in FS1 and must not
be in `has_afl_father`. Rendered wording must say **"selected under the father–son
rule"**, never the bare "father-son".

### 7.3 FS2 / FS3 — fold clubs by organization; own `draft_year` separately

- **FS2**: `father_son_selection_for_club(org)`, folding renames by `organization_id`
  (Bulldogs 11, Kangaroos 7); **Fitzroy does not fold into Brisbane**. Register in
  `NL_CAREER_CLUB_OWNING_BUILDERS` (the v33 rule) or the club fails closed.
- **FS3**: `father_son_selection_between(from,to)` over **`draft_year`**, owning its
  own range. Because 0 of 99 sons debut in their draft year (§4.4), the rendered
  wording must say **"drafted in 2022"**, never "in 2022", and a question mixing a
  draft-year scope with a playing-season scope must **fail closed**.

### 7.4 FS6 — count **trusted** rows (99), and disclose the excluded 28

Consistent with every other NL surface, which is fail-closed on identity. The 28
excluded selections have an unlinked son. **But this is a real choice** — "how many
father-son selections has Carlton made" is arguably 13, not 7 — so it is raised as
operator question **Q2** rather than settled here.

### 7.5 X3 — ship with FS1, and ship the father side with it

X3's answer is **1 under all four readings** (§4.7), so F-D1's own re-add condition
("cleanly re-addable the day D8 lands") is satisfied the moment §7.1 is adopted.
Zero new builders. Additionally, **narrow the in-reading refusal at `parser.ts:1837`**
so it blocks only *bare* father-son wording: as written it also blocks the
**father-side** composition, whose wording is already accepted outside the
cross-domain reading and whose answer is **11 players** (§4.7).
Frozen constraints hold unchanged: conjunction only, `match_coaches` required,
list never a ranking, a named club refuses.

### 7.6 Chronology — propose **no** chronology contract

§2.6 stays frozen. Stage 0 measured the only chronology fact available
(`draft_year` vs debut season, §4.4) and it concerns FS3's **scope**, not a
playing-then-coaching ordering. Nothing in this evidence supports "later coached".
**Recommend: "later"/"became" remain declined by name.**

### 7.7 D6 / C1 — enforce siblings, rank by combined games, do not fold parent–child

- **Extension:** add `relationship = 'sibling'` to `getFamilyRecords`. On today's data
  this changes **nothing** (§4.6) — which is exactly why it is safe, and why it should
  be done now rather than after the data changes.
- **Metric:** **"biggest" = combined career games**, matching what the page already
  ranks by. "Most players" is a **separate** reading with separate wording; the two
  must never share a phrasing, because they disagree by up to 301 rank places (§4.6).
- **Do not fold `parent_child` into families** (R3). +77 new and 14 extended families
  is a product change, not a defect repair. If wanted, allocate a separate issue.
- **Fail-closed rules for the family grain:** exclude the 46 size-1 families;
  disambiguate members by **id** (`ablett-0004`); never render an unlinked side as a
  player.

---

## 8. Operator questions — implementation may not start until these are answered

| # | Question | Recommendation | Evidence |
|---|---|---|---|
| **Q1** | **D8 binding.** Adopt "explicit father-son *rule/selection* wording → `father_son_selections`; bare 'father-son' keeps declining"? | **ANSWERED 2026-09-09 — APPROVED, with a symmetry clause. See §8.1.** | §4.1, §5.7, §6.1, §7.1 |
| **Q2** | **FS6 denominator.** Does "father-son selections by club" report **99** trusted or **127** all? | **99 + disclosure**, for consistency with the fail-closed contract — but 127 is defensible for a *count of selections* | §4.5 |
| **Q3** | **F1, father-son page.** Re-point `/records/father-son` to `father_son_selections`, or correct its prose to say parent–child? | **Re-point.** The relationship rows are a projection of that table, which also carries club, year and pick | §4.1 |
| **Q4** | **F1, family page.** Add `relationship = 'sibling'` to `getFamilyRecords`? | **Yes** — a no-op on current data, and it makes the prose true by construction | §4.6 |
| **Q5** | **C5/C6 scope.** They sit outside the eight labels but are blocked by the same family grain. Do they ride along in Stage 6? | **Yes** — the grain is the whole cost; C5/C6 are then a `metricCondition` | §4.6, §A3 |
| **Q6** | **X3 father side.** Narrow `parser.ts:1837` so the already-accepted FS4 wording composes with coaching (11 players)? | **Yes** — the guard is currently wider than F-D1's stated scope | §4.7, §7.5 |

**One further question is design, not semantics:** whether R3 (folding parent–child
into families, +77 families) is wanted at all. Recommend **no** for ISSUE-153, and a
separate issue if the operator wants a combined "football family" board.

### 8.1 Q1 — ANSWERED 2026-09-09 (operator)

**Recorded verbatim:**

> Q1 APPROVED: explicit "father-son rule", "father-son selection", or equivalent
> draft/selection wording binds to `father_son_selections`. Bare "father-son" remains
> fail-closed. Apply this contract symmetrically to selected players and fathers.

**D8 is therefore decided: candidate (c), with (a) as its authority rule** (§7.1).
`father_son_selections` is authoritative; `player_relationships.parent_child` is its
`father_son.py` projection (§4.1). Binding consequences:

1. Wording that **names the rule, a selection, a draft or a pick** binds to
   `father_son_selections` — on **both** sides. This unblocks FS1 (99, §4.2),
   FS2 (§4.3), FS3 (§4.4), FS6 (§4.5) and X3 (1, §4.7) as *semantics*; each still
   depends on its own stage and on the questions still open below.
2. Wording that says only **"father-son"** with no rule/selection/draft/pick cue stays
   **fail-closed**, on both sides. C3/C4 continue to serve the plain relationship
   reading under unambiguous wording.
3. The explicitness test is **one shared test**, applied to the son side and the father
   side alike. Neither side gets a wording the other is denied.
4. §7.1's **durability invariant** (Stage 7 `db-health` set-identity assertion) is
   adopted with the binding, so the projection relationship is monitored, not assumed.

**Q1a — NEW, and it must be answered before Stage 2 can be written.**

The symmetry clause collides with **exactly one shipped artefact**. FS4's cue list holds
`/\bfather[- ]son fathers?\b/` (`src/search/nl/vocab.ts:1159`), pinned as **answering**
by corpus row `rel_024` — *"which father-son fathers played the most games"*. That
wording names **no** rule, selection, draft or pick: it is bare "father-son" plus the
role noun "fathers". A strictly literal symmetric test would have to decline it, which
**reopens frozen §2 item 9** (FS4 accepted and not to be reopened) and turns a shipped
answering row into a decline. The other four FS4 cues (`vocab.ts:1158,1160–1162`) all
name a selection/draft explicitly and are unaffected either way.

| Option | Effect on `rel_024` | Effect on the son side | Cost |
|---|---|---|---|
| **(a)** treat *"father-son" + an explicit **role** noun* (`fathers`/`sons`) as equivalent qualifying wording | keeps answering (107) | the mirror `father-son sons` also answers (99); `father-son players` / `pairs` / `duos` still decline | none; §2 stays frozen |
| **(b)** grandfather the cue as a named exception | keeps answering | son side has no mirror | the contract is asymmetric by construction — i.e. declines the clause you approved |
| **(c)** retire the cue | flips answering → **decline** | fully symmetric on the letter | a shipped regression and a §2 reopen |

**Recommendation: (a).** It is the only option that is both symmetric and leaves §2
frozen. The role noun resolves the *side*, which is what the symmetry clause is about;
the rule-vs-relationship ambiguity it leaves open is **answer-invariant on this data**
(§4.1 — fathers 107 = 107, sons 99 = 99, 0 divergence witnesses) and is exactly what
consequence 4's durability invariant watches. Note plainly: (a) does relax "bare
father-son remains fail-closed" for **role-qualified** forms only. If that relaxation is
unwanted, (c) is the literal reading and its price is `rel_024`.

---

## 9. Proposed staged implementation order

No stage may begin before §8 is answered. Each stage is independently shippable and
independently revertible.

| Stage | Content | Depends on | New builders | Migration | Parser bump |
|---|---|---|---|---|---|
| **1** | **F1 page repair** — `getFamilyRecords` + `relationship='sibling'`; `/records/father-son` re-pointed or its prose corrected. **This is ISSUE-153's own title** and it settles the product meaning both NL groups must follow. | Q3, Q4 | 0 | no | no |
| **2** | **D8 binding + FS1.** Replace the blanket `FATHER_SON_RULE_RE` guard with the explicitness rule. `father_son_selection` reused unchanged. | Stage 1, Q1 | **0** | no | yes |
| **3** | **FS2 + FS3.** `father_son_selection_for_club(org)` and `father_son_selection_between(from,to)`, both registered as owning builders. | Stage 2 | 2 | no | yes |
| **4** | **FS6 distribution.** `achievement_summary`-shaped grouping over Stage 3's keys. | Stage 3, Q2 | 0 | no | yes |
| **5** | **X3 + father-side composition.** Narrow the in-reading refusal; no new builder. | Stage 2, Q6 | **0** | no | yes |
| **6** | **D6 / C1 family grain** (+ C5/C6 per Q5). New `family` grain, payload variant and renderer section. The largest piece; shares nothing with 2–5. | Stage 1, Q4, Q5 | 1 (`has_relative`) | no | yes |
| **7** | **Durability invariant** — `db-health` assertion that the two father-son populations stay set-identical. | Stage 2 | 0 | possible | no |

Stages 2–5 are one chain over one decision. Stage 6 is a separate chain. Stages 1 and
7 are the honesty guarantees at each end.

**Corpus and acceptance:** every stage appends decline→plan conversions to the pinned
rendered corpora. The frozen 271, 319, 349 and 1,495 sets do not move; each stage adds
its own set, as Phases D and F did.

---

## 10. Stage 0 completion

- Eight labels recovered from the record, not from their names (§3).
- All twelve requested decision-table fields populated for each (§5).
- Every answerable candidate interpretation measured read-only against `afldb_test`
  (§4), including the three ISSUE-152 gaps: **M5 closed**, the D8 collapse escalated
  from a count to a **set identity with a provenance explanation**, and the FS3
  chronology divergence measured for the first time.
- Positive witnesses, negative witnesses, divergence/trap cases, unlinked-identity
  counts and lineage differences retained (§4).
- **No implementation code written. No parser change. No migration. Not committed.**

### 10.1 What was run

| Check | Result |
|---|---|
| `phase-d-evidence.ps1 -DryRun` (static parse, no connection) | **PASS** — 34 statements, 74 meta-commands, target `afldb_test` |
| Main evidence pack | **COMPLETE** — `afldb_test`, `afldb_app`, read-only, pid 2420889, ROLLBACK |
| Addendum pack | **COMPLETE** — `afldb_test`, `afldb_app`, read-only, pid 2422426, ROLLBACK |
| `git diff --check` | clean |

Production was not touched. No write, DDL, loader or migration ran. The worktree was
given a `node_modules` junction and a local gitignored `.env` (port rewritten to the
documented 55432 tunnel convention) so the evidence runner could execute.

---

# 11. SESSION HANDOFF — 2026-09-09, Stages 1–5 and 7 implemented

> **READ THIS SECTION FIRST. Do not re-run Stage 0. Do not reopen any decision in
> §8 or §11.4. Everything in §1–§10 above is the settled record and must be treated
> as evidence, not as a proposal.**

## 11.1 Where the work stands

| Stage | Content | State |
|---|---|---|
| **0** | Investigation and measurement | **COMPLETE** (§4). Never re-run. |
| **1** | F1 page repair — `/records/father-son` prose, sibling constraint | **COMPLETE, green** |
| **2** | D8 binding (Q1/Q1a) + FS1 | **COMPLETE, green** |
| **3** | FS2 selecting club + FS3 draft year | **COMPLETE, green** |
| **4** | FS6 distributions, denominator 127 | **COMPLETE, green** |
| **5** | X3 + father-side composition (Q6) | **COMPLETE, green** |
| **6** | C1 / D6 / C5 / C6 — the `family` grain | **NOT STARTED. NOT AUTHORISED.** |
| **7** | Durability invariant (projection drift) | **IMPLEMENTED**, written but **UNRUN** |

**Nothing is partially implemented.** Every stage that was started is finished; the
only thing outstanding for Stages 1–5 is *execution* of the DB-backed tests, which
this session could not run.

`PARSER_VERSION` is **40** (was 39). It was bumped **exactly once**, for the whole
Stages 2–5 semantic checkpoint, per the operator's instruction. A fresh session
must **not** bump it again for anything already in this checkpoint.

## 11.2 The one thing that was NOT done, and why

**Every DB-backed test is written but has never been executed.** The 55432 tunnel
to `afldb_test` was not up in this session:

```
Error: connect ECONNREFUSED 127.0.0.1:55432
```

This is the only outstanding validation for Stages 1–5. The tests are written to be
oracles, not smoke checks: each figure is compared against an independently
hand-written query over the same table, and several are written to FAIL loudly on
the specific wrong answer this issue exists to prevent (see §11.7).

No rendered Playwright sweep was run either, and none should be until §11.8 is
settled.

## 11.3 Files changed, and why each one changed

**Stage 1 — the public record surfaces**

| File | Why |
|---|---|
| `src/db/queries/family-records.ts` | `relationship = 'sibling'` stated on every `player_relationships` scan in `getFamilyRecords` **and** `getFamilyRecordsSummary` (Q4). The summary was included deliberately: a stat strip counting a wider population than the table it introduces would be a new defect. `getFatherSonRecords`' docblock now records *what the rows are* — the authority, the projection, and the fact that only `father_son_selections` carries club/year/pick. |
| `src/app/records/father-son/page.tsx` | Q3, prose only. Each row is one **selection made under the AFL father–son rule**; `father_son_selections` named as the authority; the `parent_child` rows disclosed as its same-source/same-batch projection; club, draft year, pick and pathway disclosed as **absent** from this board. The garbled "not fabricated a player" sentence replaced. Stat label "Recorded pairs" → "Recorded selections". **The page was NOT re-pointed** — Stage 0 proved the projection faithful, and Q3 forbids a schema detour. |
| `src/app/records/family/page.tsx` | One clause making the now-enforced sibling constraint visible, and the reciprocal cross-link reworded. |
| `src/app/records/page.tsx` | The records index card carried the same inaccurate "father and son pairs" copy. |
| `tests/family-records-surfaces.test.ts` | **NEW.** Both Stage 1 changes are unprovable against today's data (the sibling filter is a no-op — §4.6), so what is pinned is the **contract**: the SQL states the constraint, and the page states what the record is. |

**Stages 2–5 — the semantics**

| File | Why |
|---|---|
| `src/search/nl/vocab.ts` | `FATHER_SON_SELECTION_CUES` (the son side, mirroring `FATHER_SON_FATHER_CUES`); `FATHER_SON_RULE_RE` re-documented as holding only the bare/collective forms; `FATHER_SON_PLAYING_SEASON_MIX_RE` (FS3's fail-closed condition); `FATHER_SON_SUMMARY_CUES` (FS6). |
| `src/search/nl/parser.ts` | Step **1b** in `extractRelationship` — FS1, placed after FS4 and before the guard, so the father side keeps its claim on wording it already ships. Step **5e-bis** — FS6, claimed *before* the metric extractor. FS2/FS3 emitted as **scoped builders** so the club and year are owned, never discarded. The Phase F in-reading refusal narrowed to bare/collective only (Q6), claiming the explicit cue itself because step 5e is suppressed for a coaching reading. The relationship-grain guard exempts FS6 and only FS6. |
| `src/search/nl/plan.ts` | `PARSER_VERSION` 39 → **40** with the full v40 note. `NL_FATHER_SON_SELECTION_BUILDERS`; both scoped builders registered in `NL_CAREER_CLUB_OWNING_BUILDERS` / `NL_CAREER_SEASON_OWNING_BUILDERS`; all three in `NL_RELATIONSHIP_POPULATION_BUILDERS` so the unlinked-relative caveat still fires. **V7 retired**, **V6 narrowed to the cross-domain composition**, **V6b** added (the `clubs_played` misreading of "by club"). New `fatherSonSummary` plan field + its validation branch, fail-closed on every scope. `describePlan` labels the club as the **selecting** club and the years as **draft years**. |
| `src/search/nl/describe.ts` | FS1 subject/pinned wording — always "selected under the father–son rule", never the bare phrase. `fatherSonSelectionScope()` — "by Geelong", "in the 2022 draft". FS6: unit-aware counting ("127 recorded father–son selections", never "players"), the `draft_year` group noun, and the Q2 disclosure surfaced as a caveat. |
| `src/search/nl/answer-types.ts` | Optional `unit` and `disclosure` on the `achievement_summary` payload. |
| `src/search/grid-solver-spec.ts` | Two builders registered, catalogue **166 → 168**. The year parameter is labelled "draft year" in every place a reader can see it. |
| `src/db/queries/grid-solver.ts` | The two builders' SQL. Club folds by `organization_id`; the year is `draft_year`. |
| `src/db/queries/nl/father-son-summary.ts` | **NEW.** FS6's executor. Its header is the record of *why the denominator is 127*; **no link filter appears anywhere in it, deliberately**, and a future edit adding one is a semantic change, not a tightening. |
| `src/db/queries/nl/execute.ts` | Routes the shared grain to whichever summary the plan names. |
| `tests/nl-parser.test.ts` | The ISSUE-152 block "the blocked father-son SELECTION forms still decline" is **replaced** by FS1, FS2/FS3, FS6 and X3 blocks plus a narrowed collective-decline block. This is the intended flip, and it is the single largest behavioural change in the diff. |
| `tests/nl-plan.test.ts` | V6 narrowed, V6b added, V7 replaced by its retirement test. |
| `tests/nl-describe.test.ts` | FS6 wording, written to fail if 99 is substituted for 127 or if the sentence says "players". |
| `tests/grid-solver-spec.test.ts` | Catalogue count 166 → 168, with the reason recorded inline. |

**Stage 7 + the DB oracles**

| File | Why |
|---|---|
| `tests/integration/nl-answers-relationships.test.ts` | Appended, never rewritten. The ISSUE-153 oracle block (§11.7) and the Stage 7 projection invariant. |

**Tracking**

`issues.md`, `IssuesIndex.md` (the ISSUE-153 row, rewritten to match this section),
`CHANGELOG.md` (Unreleased), and this file.

## 11.4 Operator decisions — LOCKED. Do not reopen.

| # | Decision | Implemented as |
|---|---|---|
| **Q1** | `father_son_selections` is authoritative for explicit **rule / selection / draft / pick** wording, **symmetrically** on both sides — son → `drafted_player_id`, father → `father_player_id`. Bare collective wording stays fail-closed. | `FATHER_SON_SELECTION_CUES` + the narrowed `FATHER_SON_RULE_RE` guard |
| **Q1a** | Option **(a)**: `father-son` + an explicit **role noun** qualifies. `father-son fathers` answers; `father-son sons` answers; `father-son players` / `pairs` / `duos` / `families` decline. **`rel_024` must keep answering.** | cue 2 of each list; asserted in `tests/nl-parser.test.ts` |
| **Q2** | FS6 counts **127 selection events**, not 99 linked players. The 99 is disclosed, never substituted. | `father-son-summary.ts` (no link filter) + the `disclosure` caveat |
| **Q3** | Correct the prose narrowly. **No routing or schema redesign.** | page prose only; the board still reads the projection |
| **Q4** | The sibling-family surface states `relationship = 'sibling'` explicitly. | both family queries |
| **Q5** | C5/C6 stay with Stage 6. | not touched |
| **Q6** | **Only** the narrow guard change needed for the already-provable father-side composition. No broadening of generic relationship composition. | the in-reading refusal now consults the two explicit cue lists and nothing else |

## 11.5 Frozen ISSUE-152 behaviour — verified still true

- "played and also coached" is a **conjunction, not a chronology**; "later coached",
  "went on to coach", "became a coach" still decline **by name** (asserted).
- **Actual coaching appearance** (`match_coaches`) required, not the `coaches`
  identity seam (asserted both ways in the oracle block).
- `played_for_club` semantics unchanged; coaching club still folds by organization.
- **One-sided ambiguous club composition still fails closed** (asserted).
- `rel_024` still answers via `father_son_father` (asserted).
- The frozen 271 / 319 / 349 / 1,495 corpora were **not edited** — see §11.8.

## 11.6 Stage 0 oracle counts these tests rely on

Retained verbatim from §4; a fresh session must treat these as facts, not re-measure them.

| Fact | Value |
|---|---|
| Selected players (FS1) | **99** |
| Father side (FS4) | **107** |
| Selection events (FS6 denominator) | **127** |
| Selecting organizations | **17** |
| NULL selecting clubs | **0** |
| FS1 − `has_afl_father` | exactly **3**: Morrison **11802**, Morton **9715**, Michalanney **9409** |
| Draft-year trap | **0/99** debut in draft year; **60** at +1; **39** at +2 or later |
| FS6 127-vs-99 | materially changes **14 of 17** organizations |
| Carlton | **13** selection events vs **7** linked selected players |
| X3 (selected + actually coached) | **1** — Rhyce Shaw, player **10974**, coach **233** |
| Father side + actually coached | **11** |
| Projection invariant | sons 99/99 overlap 99; fathers 107/107 overlap 107; pairs 96/96 overlap 96; **zero** divergence witnesses |
| Provenance | both tables `source_id` **11**, `import_batch_id` **12**; `parent_child` written by `father_son.py` |

## 11.7 Tests — what was run, what was not

**Run, and green:**

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npx eslint` on every changed file | **clean** (0 errors, 0 new warnings) |
| `tests/family-records-surfaces.test.ts` | **6/6** |
| `tests/nl-parser.test.ts` | **PASS** |
| `tests/nl-plan.test.ts` | **PASS** |
| `tests/nl-describe.test.ts` | **PASS** |
| `tests/grid-solver-spec.test.ts` | **PASS** |
| Whole DB-free suite (integration/e2e/nl-ui excluded) | **3,809 passed / 14 skipped**, 3 failures — all pre-existing |
| `git diff --check` | **clean** |

**The 3 failures are PRE-EXISTING and unrelated.** All three fail identically on the
unmodified tree, and none imports anything this work touched:

1. `tests/finals-semantics-contract.test.ts` — the known Windows-CRLF failure
   (the suite splits on a bare `\n` in an `autocrlf=true` checkout; passes on Linux).
2. `tests/fitzroy-core-import.test.ts` — needs the database.
3. `tests/reference-data.test.ts` — `external_grid_*` tables not registered for
   `afldb_import`; that is ISSUE-151 territory.

**Written but NEVER RUN — the whole outstanding validation:**

`tests/integration/nl-answers-relationships.test.ts` (the appended ISSUE-153 block).
It asserts, each against an independently hand-written query:

- FS1 = **99**; every selected player has played (so no games filter is needed);
- FS1 − `has_afl_father` is **exactly** Michalanney / Morton / Morrison, **by name**;
- father side still **107**;
- the Bulldogs **rename** folds through one organization across two `club_id`s;
- **Fitzroy does not fold into Brisbane**;
- **0 of 99** debut in their draft year;
- FS6 total = **127**, and `expect(payload.total).not.toBe(99)` — written to fail on
  the substitution; the group counts **sum** to 127; **Carlton is asserted by name**
  to be its selection count and explicitly *not* its linked-player count;
- 17 organization groups; 35 draft-year groups, chronological, no `href`;
- X3 = **[10974]** exactly; father side = **11**, and the identity seam proven wider;
- **Stage 7**: same source/batch, and `EXCEPT` in **both** directions at son, father
  and pair level, plus row-count parity and the `family_key` no-op Q4 rests on.

## 11.8 THE ONE OPEN CONFLICT — an operator decision, not a bug

Five rows pinned as **declines** in the ISSUE-152 corpora now legitimately **answer**:

| Row | Wording | Now |
|---|---|---|
| `rel_dec_003` | `players selected under the father-son rule` | **answers** (FS1) |
| `rel_dec_004` | `geelong father-son selections` | **answers** (FS2) |
| `rel_dec_005` | `father-son selections in 2022` | **answers** (FS3) |
| `rel_dec_006` | `father-son selections by club` | **answers** (FS6) |
| `xd_dec_014` | `players selected under the father-son rule who also coached` | **answers** (X3) |

`xd_dec_013` (`which father-son players also coached`) and `xd_dec_015` (the ranked
form) correctly **still decline**.

Those rows live in the **source CSVs that `PHASE_G_SETS.current` (319) and `.next`
(349) are built from**, so they cannot be reclassified without changing the frozen
319 and 349 sets — and `tools/issue-152/build-phase-g-corpora.ts` refuses a size
change by design, telling the operator to "update `PHASE_G_SETS` and the issue
record together, rather than loosening the gate".

**No CSV was edited and no set was re-pinned in this session.** Until this is
decided, a rendered sweep of the 319 or 349 set **will fail on those five rows, and
the failure is correct behaviour meeting a stale expectation.**

The two honest options: append an ISSUE-153 generation that supersedes the five
rows, or reclassify in place and re-pin `PHASE_G_SETS` with the issue record updated
in the same commit.

## 11.9 Known residual behaviours, recorded rather than hidden

1. **X3 wording is limited by an ISSUE-152 cue, not by this work.**
   `CROSS_DOMAIN_COMPOSITION_RE` requires the token "players" within a six-word
   window of "also coached", so `father-son selections who also coached`
   (`xd_dec_012`) still declines — on the *composition* cue, not on father-son
   grounds. Widening that regex is an ISSUE-152 change and Q6 does not authorise it.
   The forms that do compose: `players selected under the father-son rule who also
   coached`, `players who were father-son selections and also coached`, `players who
   were father-son fathers and also coached`.
2. **FS6 refuses every scope.** "Geelong father-son selections by year" declines by
   name. Fail-closed on purpose; a scoped distribution is unbuilt, not broken.
3. **FS3's mixing guard is a word test.** A father-son selection question carrying a
   year *and* a playing word leaves the year unowned so the ownership gate refuses
   it. `which father-son sons played the most games` is unaffected (no year).

## 11.10 Exact next action for a fresh session

**Do not re-run Stage 0. Do not reopen §8 or §11.4. Do not start Stage 6.**

1. Bring up the tunnel to `afldb_test` on **55432**, then run the only outstanding
   validation:

   ```
   npx vitest run tests/integration/nl-answers-relationships.test.ts
   ```

   Expected: the pre-existing Phase D block plus the whole ISSUE-153 block green. A
   failure here is a real finding — every number in it is independently derived.

2. If green, run the neighbouring DB-backed NL suites to prove nothing else moved:

   ```
   npx vitest run tests/integration/nl-answers-cross-domain.test.ts tests/integration/nl-vocab.test.ts tests/integration/nl-semantic-mapping.test.ts
   ```

3. Then put **§11.8** to the operator. Nothing rendered should run before it is
   answered.

4. Stage 6 (C1/D6/C5/C6) remains held and unauthorised. Stage 0 proved D6 is a real
   product decision — biggest-by-members and biggest-by-games disagree by up to
   **301 rank places** (§4.6) — and that contract must not be invented.

Cheap re-validation of what is already done, if needed:

```
npm run typecheck
npx vitest run tests/nl-parser.test.ts tests/nl-plan.test.ts tests/nl-describe.test.ts tests/grid-solver-spec.test.ts tests/family-records-surfaces.test.ts
```
