# AFLDB 2026+ API-First Acquisition — Investigation & Runbook

**Mode:** investigation/planning only. No implementation. No Git.
**Date:** 2026-08-28. **Model/effort:** Opus / High / Plan.
**Deliverable of this plan:** write this document into the repository as
`AFLDB-2026-API-ACQUISITION.md`, then create the recommended issues. Nothing else.
**Not in scope of this plan:** `AFLDB-ISSUE-086` and its worktree/patch — paused separately
and not to be accessed, applied or resumed by this work.

## Evidence legend

Every claim in this document carries one of four tags. Nothing is asserted untagged.

| Tag | Meaning |
|---|---|
| **[SRC]** | Proven by reading current repository source. Cited by file and line. |
| **[PROBE]** | Obtained 2026-08-28 from a live API call or current public documentation. |
| **[UNKNOWN]** | Not established. Resolved only by a named probe P1–P7 (§8). |
| **[DECISION]** | Architectural choice explicitly approved by the user this session (§0). |

---

## 0. Approved standing policy [DECISION]

These are the user's decisions from this session. They are constraints on everything below,
not proposals.

1. **Free/hobby sources only.** No commercial licence, no Champion Data contract.
2. **Fetch, staging and diff computation may run automatically.**
3. **Canonical promotion is reviewed by default.** A super-admin action, not a scheduled job.
4. **Lineups are staging-only** and never become canonical participation. Canonical
   participation remains the played match sheet.
5. **Only the in-progress season belongs to this pipeline.**
6. **Once complete, that season is re-acquired through the standard full-history fitzRoy
   path and supersedes the in-season provenance.**

> **AMENDED 2026-09-21 (AFLDB-ISSUE-228 S8, operator decision Q7).** Item 6 predates `afl_api`
> holding any canonical-write authority and is now qualified by §5's amendment below: the
> rollover supersedes provisional Squiggle/Kali *staging* evidence as before, but it
> **corroborates, never re-owns, a canonical row `afl_api` independently promoted** — an
> ownership transfer needs an explicit rule or operator decision, never "the rollover ran
> later." See §5 for the full wording.

---

## Document map

> **Added 2026-09-21 (AFLDB-ISSUE-228 documentation pass).** §§1–13 below are the
> 2026-08-28 investigation that led to the current architecture — they are retained as
> lineage and are the evidence base for the source-of-truth matrix (§3) and the
> AFL.com.au lineup/roster staging-only families (§13.9–§13.11, ISSUE-100/118). They
> predate, and do **not** describe, the direct-HTTP AFL.com.au current-season
> match/player-statistics/Brownlow integration that ISSUE-228 subsequently built.
>
> **§14 below is the canonical architectural and operator reference for that
> integration** (provider access, the acquire→settle pipeline, ownership and
> corroboration, the database model, identity resolution, admin controls, systemd
> operation, manual commands, the Brownlow pipeline, safety, reconciliation,
> acceptance criteria and known limitations). For the detailed one-off Brownlow
> live-count operator procedure, see
> `docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md`, which §14.9 links to
> rather than duplicates. For per-stage implementation history and evidence, see
> `issues.md` under `AFLDB-ISSUE-228`; for the frozen design contract, see
> `issues/open/AFLDB-ISSUE-228.md`.

## Context

AFLDB's historical core is now frozen and legacy-free: `AFLDB-ISSUE-093` shipped the
nine-stage canonical rebuild against the accepted fitzRoy baseline `full-history-20260827`
(1897–2025, 719,042 rows), and Stage 9 asserts `matches_after_accepted_last_season = 0` —
2026 is deliberately excluded from that core. `tools/rebuild/fitzroy/fitzroy-contract.json`
(`current_season_excluded`) states plainly that 2026 "is owned by the separate current-season
pipeline". **[SRC]**

That pipeline exists but is narrow: it stages Squiggle/Kali *match* rows only, and can write
canonical `matches` rows directly. Everything else a live season produces — player match
statistics, lineups, rosters, the ladder, awards — has **no 2026+ acquisition path at all**.
`AFLDB-ISSUE-095` already records the ladder half of that gap. This investigation establishes
what the remaining families can and cannot get from APIs, and what the standing architecture
for 2026 and every future season should be.

---

## 1. What is actually implemented today [SRC]

> **CURRENT STATE — AFLDB-ISSUE-122 S7 (2026-09-02).** Squiggle and Kali are deprecated
> fallback sources. Their clients, parsers, source registrations, immutable observations,
> mutable staging projection, diagnostic reporting, corroboration evidence and historical
> provenance remain available. Their former canonical `matches` writer is retired: this path
> performs no canonical INSERT or UPDATE. `--update-matches` now fails explicitly, while
> `--insert-missing-matches` retains its existing refusal. The older implementation inventory
> and defect evidence below are retained as architectural lineage and are superseded wherever
> they describe a Squiggle/Kali canonical writer.
>
> **CURRENT STATE — AFLDB-ISSUE-128 (2026-09-03).** The admin surface's legacy
> `mode=auto` is **removed**, not relabelled: it meant "Kali + apply", the shape of the
> retired automatic writer, and a `mode=auto` post is now refused rather than
> reinterpreted. `parseCurrentSeasonSources()` no longer defaults to `kali` — there is no
> default fallback source at all. `/admin/current-season` states that AFL Tables via
> fitzRoy is the primary and only automatic current-season source, and AFL Tables is
> deliberately absent from the fallback source list because it is not acquired through this
> code path.

| Piece | File | Reality |
|---|---|---|
| Source registry | `src/db/migrations/063_external_current_match_sources.sql:10-19` | `squiggle_api`, `kali_afl_stats` registered as `upstream_dataset` |
| Raw snapshot | same, `:21-63` | `staging.external_current_matches`, PK `(source_id, external_game_id)`, `raw_payload jsonb`, `fetched_at`/`last_seen_at`, score-component CHECK constraints |
| Match provenance | `064_matches_external_provenance.sql` | `add_provenance_columns('matches')` → `source_id`, `source_record_id`, `import_batch_id` |
| API clients | `src/lib/external-afl/current-matches.ts` | Squiggle `?q=teams` + `?q=games`; Kali `GET /matches?year=&limit=200` with `Authorization: Bearer` |
| Orchestration | `src/lib/external-afl/current-season-import.ts` | fetch → resolve club → resolve local match → upsert staging → optional canonical update/insert, all inside one `sql.begin` |
| CLI | `tools/current-season/update-current-season.ts` | `npm run current-season:update`, dry-run default, `--apply`, `--insert-missing-matches`, `--update-matches`, `--report` |
| Admin | `src/app/admin/current-season/{page,actions}.tsx` | super-admin only, audited. **Superseded by ISSUE-128:** `mode=auto` is gone; the only fallback modes are `manual` (explicit source, no canonical write) and `report` |
| Debug contract | `.agents/skills/afldb-api-data-debug/SKILL.md` | pipeline-correctness skill; records a live 2026 dry-run whose aggregate and per-source counters contradict each other |

**Data families covered today: matches only.** Player stats, lineups, rosters, ladder, awards,
draft and venues have no current-season API path.

### 1.1 Defects proven by reading the shipped code [SRC]

Read from source, not inferred. None is separately tracked today.

1. **Canonical inserts fabricate a venue.** `current-season-import.ts:619` inserts
   `venue_raw = ${match.venueRaw ?? 'Unknown'}`. `matches.venue_raw` is `NOT NULL` and
   `venue_id` is left NULL, so a promoted row can carry the literal string `Unknown` forever.
2. **Canonical inserts create half-matches.** The same INSERT (`:607-629`) writes
   `attendance = NULL, attendance_status = 'not_collected'` and never writes
   `match_period_scores` or `player_match_stats`. A season built this way has matches with no
   quarter scores, no attendance and no player participation.
3. **Staging cannot distinguish a correction from a deletion.** The staging write is
   `ON CONFLICT … DO UPDATE` (`:420-439`): a retrospectively changed payload silently replaces
   the previous one and the prior snapshot is unrecoverable. `last_seen_at` is written but
   never read, so a fixture that *disappears* from a source is indistinguishable from one that
   was never refreshed.
4. **Counters are incoherent.** `unresolved -= candidates.length` (`:633`) subtracts per
   inserted match key with no floor, so the counter can go negative; and
   `records_inserted = staged + inserted` (`:657`) sums staging rows and canonical rows under
   one name. This is the reporting incoherence the debug skill documents (source-level
   resolved 197+199=396 vs top-level resolved 0).
5. **Opening Round handling is a heuristic.** `localRoundCodes` (`:219-225`) appends
   `roundNumber + 1` for `season >= 2024`, so a match can resolve against two candidate round
   codes. It works, but it is a source-numbering guess embedded in the resolver rather than a
   declared per-source round mapping.

   > **[AMENDED 2026-08-28 — see §13.5]** P5 upgraded this from a suspicion to a proven
   > structural divergence. AFL Tables numbers the 2026 Opening Round as Round **1**, Squiggle
   > numbers it **0**, and the AFL API's `round.roundNumber` **25** is *Wildcard Finals* while
   > AFL Tables' Round 25 is the last home-and-away round. Three sources, three round
   > vocabularies colliding on the same integers. A **declared per-source round mapping** is
   > therefore a contract requirement, not a cleanup.

### 1.2 Overlap with `AFLDB-ISSUE-086` — reference only, no duplicate issue

`--update-matches` (`current-season-import.ts:567-590`) overwrites
`home_score/away_score/goals/behinds/result/winner/margin` on any unambiguously resolved match
and re-stamps `source_id`, with **no ownership predicate**. **[SRC]**

This is the same behaviour class `AFLDB-ISSUE-086` already tracks — a source refresh silently
overwriting a row it does not own, including one an admin has edited — reached from the
current-season direction rather than the data-editor direction. It is **referenced** by the
architecture work (§4 rules 5 and 6) and by issue C's context, and **no duplicate issue is
created for it**. ISSUE-086 keeps ownership of the behaviour and its severity triage.

---

## 2. Sources investigated, and what each can actually provide

All **[PROBE]** statements are from live calls or current public documentation on 2026-08-28.

### 2.1 FINDING — Kali's public fixture endpoint is a verbatim Squiggle proxy [PROBE]

`GET https://kaliaflstats.com/api/afl/v1/fixture` returns Squiggle's `games` schema, with
Squiggle's own game ids and Squiggle's own `updated` timestamps:

```
Kali     /api/afl/v1/fixture           → id 38494, Sydney 132 v Carlton 69, Opening Round,
                                          complete 100, updated "2026-03-05 22:16:49"
Squiggle ?q=games&year=2026&round=0     → id 38494, Sydney 132 v Carlton 69, Opening Round,
                                          complete 100, updated "2026-03-05 22:16:49"
```

Identical id, identical `updated` string, identical field names (`hteamid`, `roundname`,
`unixtime`, `tz`, `is_grand_final`, `winnerteamid`).

**Consequence:** for the fixture/score family, Squiggle and Kali are not independent
witnesses, so `sourceDisagreements` and `--source all` can report *self*-agreement as
corroboration. AFLDB reads Kali's authenticated `/matches` endpoint — a different shape
(`homeTeam`/`homeScore`, human-readable dates) **[SRC]** — so proxying is **proven for
`/fixture`** and **[UNKNOWN] for `/matches`** until P1.

### 2.2 Squiggle — `https://api.squiggle.com.au/` [PROBE]

- Query types: `teams`, `games`, `sources`, `tips`, `standings`, `ladder`, `power`;
  `virtual` and `pav` deprecated.
- `games` fields: `id, year, round, roundname, date, localtime, unixtime, tz, venue, hteam,
  hteamid, ateam, ateamid, hgoals, hbehinds, hscore, agoals, abehinds, ascore, winner,
  winnerteamid, complete, is_final, is_grand_final, timestr, updated`.
- `standings` fields: `id, name, rank, played, wins, draws, losses, for, against, pts,
  percentage, goals_for, behinds_for, goals_against, behinds_against`.
- Depth: 2000 onward. Preseason = round 0 (−1 from 2024).
- Latency: games 60 s, standings 5 min, teams 1 hr (Standard API, delayed by design).
- Constraints: User-Agent must identify the bot and a contact email (AFLDB already sets
  `AFLDB_EXTERNAL_API_USER_AGENT` **[SRC]**); cache and reuse; do not point browsers at it;
  do not poll the Standard API like the Event API. Free, **explicitly no warranty, "may
  disappear without warning"**.
- Not provided: attendance, quarter scores, player statistics, lineups, rosters, awards, draft.
- Correction/mutability policy: **[UNKNOWN]** — undocumented. `updated` is nevertheless a
  usable change signal, and AFLDB does not currently store it **[SRC]**.

**Verdict: excellent completion/latency signal, good current ladder. Never authoritative for a
fact AFL Tables also carries.**

### 2.3 Kali AFL Stats — `https://kaliaflstats.com/api/afl/v1` [PROBE]

- Endpoints: `/teams`, `/teams/:id`, `/players`, `/players/:id`, `/matches`, `/player-stats`,
  `/player-stats-advanced`, `/leaderboards`, `/head-to-head`, `/standings`, `/venues`,
  `/tips`, `/fixture` (public).
- Auth: Bearer key on everything except `/fixture`. Free tier **1,000 req/day**.
- Depth: documented as 2000–present, "27 seasons", 5,315 matches, 2,865 players, 36 venues.
- `/player-stats` fields: `matchId, playerName, teamId, kicks, handballs, disposals, marks,
  goals, behinds, tackles, hitouts, goalAssists, inside50s, clearances, clangers, rebound50s,
  freesFor, freesAgainst, aflFantasyPts, supercoachPts`.
- `/player-stats-advanced` fields: `contestedPossessions, uncontestedPossessions,
  effectiveDisposals, disposalEfficiencyPct, contestedMarks, goalAssists, marksInside50,
  onePercenters, bounces, centreClearances, stoppageClearances, scoreInvolvements,
  metresGained, turnovers, intercepts, tacklesInside50, timeOnGroundPct`.
- Filters: `match_id, player_id, year, round, team_id, sort_by, order, limit, offset`.
- **Player identity: [UNKNOWN] and critical.** Documented response fields show `playerName`,
  not a player id, yet `player_id` is an accepted *filter*. Resolved by P2.
- Correction behaviour, update latency, retrospective mutation: **[UNKNOWN]**.

**Verdict: covers 19 of AFLDB's 21 `player_match_stats` columns, so a genuinely useful
statistics corroborator — but only after P1 (independence) and P2 (stable player id). The
1,000 req/day ceiling is a real design constraint: per-match fetches for a 9-match round are
cheap, per-player fetches are not.**

### 2.4 fitzRoy → AFL Tables (`fetch_*_afltables`) — the incumbent canonical source

Already the frozen historical core (`AFLDB-ISSUE-093`; contract at
`tools/rebuild/fitzroy/fitzroy-contract.json`), pinned at fitzRoy **1.8.0** with a fail-closed
version gate. **[SRC]**

**Proven live for 2026 [PROBE]:** `https://afltables.com/afl/seas/2026.html` exists and carries
the season through **Round 25, completed 2026-08-23** — five days before this investigation —
including per-match player-statistics links, venue, attendance and a full ladder. The
historical source is therefore **also a current-season source**, which the existing
architecture does not exploit.

> **[AMENDED 2026-08-28 — see §13.5]** The "0 NA" figure below was measured by `AFLDB-ISSUE-093`
> on **completed** seasons and does not hold for the **in-progress** season. P5 measured 2026
> directly: `url` is **0 NA** and 1:1 with `ID` (663 ↔ 663), but **`ID` is 82 NA across 5
> players**, four of whom also have NA `Player` and NA `DOB`, and whose urls never carry an `ID`
> anywhere in 2026. **The in-season settle path must key on `url`; `ID` is an enrichment field.**
> The original text is retained below unaltered.

Per the contract **[SRC]**, `fetch_player_stats_afltables` supplies at player-match grain:
stable AFL Tables `ID` + profile `url` (0 NA), name, DOB, all 21 AFLDB statistic columns,
`Brownlow.Votes` at the correct per-player-per-match grain, `Attendance`, and quarter-by-quarter
**team** scores (`HQ1G..AQ4P`). `fetch_results_afltables` supplies match identity, scores and
venue but **no attendance**. `fetch_ladder_afltables` exists and is unused by AFLDB.
`player_match_period_stats` (per-quarter *player* stats) is **MISSING** from this source and
stays missing.

`tools/rebuild/fitzroy/acquire_core.R` already accepts `--from`/`--to`, producing a snapshot
labelled `partial` with a SHA-256 manifest; `partial` is correctly refused by normal rebuild
mode, so an in-season consumer must opt in explicitly. **[SRC]**

**Verdict: the authoritative settle source for every match fact and every player fact. Slower
than Squiggle (hours, not minutes), and that is the correct trade.**

### 2.5 fitzRoy → AFL.com.au API (`fetch_*_afl`) — the key unlock [PROBE]

`fetch_fixture_afl`, `fetch_results_afl`, `fetch_ladder_afl`, `fetch_player_stats_afl`,
`fetch_player_details_afl`, **`fetch_lineup_afl`**. Documentation states **no API key is
required**; coverage spans AFLM, AFLW, VFL, VFLW, WAFL, U18B, U18G.

`fetch_lineup_afl` is the only free source found in this investigation that supplies
**lineups at all** — the docs explicitly note footywire and squiggle return a warning instead.
Returned column names are **[UNKNOWN]** (the reference page documents only "a Tibble with the
lineup"), as are the exact fields of `fetch_player_details_afl` and whether AFL provider ids
are exposed and stable. Resolved by P3/P4.

> **[RESOLVED 2026-08-28 by P3 and P4 — see §13.3 and §13.4]** Both column sets are now measured
> and both endpoints expose stable provider ids in **one shared namespace**: match `CD_M…`, team
> `CD_T…`, player `CD_I…`. All **26 of 26** distinct round-20 Carlton lineup `player.playerId`
> values appear as `providerId` in `fetch_player_details_afl` — cross-endpoint usability is
> **directly proven, not inferred**. Two constraints came with it: the lineup column count is
> **not stable across rounds** (19 at R25, 20 at R20), and `weightInKg` is **0 for all 46 of 46**
> Carlton roster rows — a systematic zero-as-missing that must map to NULL. The risk statement
> below is unchanged: this remains staging-only or corroborating, never a sole canonical path.

**Risk recorded honestly:** this reads the AFL's own website API through a third-party package.
Free and unauthenticated today, but not a published public contract with AFLDB, and revocable
without notice. It must therefore be **staging-only or corroborating**, never the sole path to
a canonical fact.

### 2.6 Champion Data / AFL Data Platform [PROBE]

Real, and the genuine authoritative feed (fixtures, match statistics, squads, player data).
Swagger is auth-gated with M2M credentials; access is obtained through a Champion Data service
desk. **Out of scope by [DECISION] (free sources only).** Recorded as the escalation path only.

### 2.7 Sources with no API — recorded, not forced

- **Awards** (Coleman, Rising Star, All-Australian, AFLCA, AFLPA, club B&F): no API on any
  investigated source **[PROBE]**. `tools/migration/import_awards.py:1408` still calls
  `require_env("AFLDB_LEGACY_SQLITE")` **[SRC]** — the same legacy dependency `AFLDB-ISSUE-095`
  records for ladders, and it is untracked. Brownlow is the exception: per-match votes already
  arrive via AFL Tables `Brownlow.Votes`, and Coleman is derivable from
  `player_match_stats.goals`.
- **Draft**: no API. DraftGuru is already canonical (`tools/rebuild/draftguru/import_draftguru.py`;
  legacy `import_draft.py` tombstoned) **[SRC]**. Keep it.
- **Venues / clubs**: no source may create an identity. `data/reference/venue-canonical.json`,
  `clubs.json`, `club_aliases` and `venue_aliases` stay the only writers. An unmapped API
  display name is a **refusal**, never an insert.

---

## 3. Source-of-truth matrix (2026+)

> **AMENDED 2026-09-02 (AFLDB-ISSUE-122).** The prior reviewed-promotion policy and matrix
> wording below are retained as architectural lineage. For current-season canonical data, the
> guarded AFL Tables applier is now the automatic authority. Squiggle and Kali are deprecated,
> non-writing fallbacks: acquisition, observation/history, staging, diagnostics, explicit human
> fallback investigation, corroboration evidence and historical provenance remain; canonical
> INSERT/UPDATE and automatic failover do not.

Promotion policy per §0: staging always automatic, canonical always reviewed.

| Data family | Preferred source | Corroborating | AFLDB target / staging | Stable source identity | Auto-promote? | Known gaps / risk |
|---|---|---|---|---|---|---|
| Fixture / schedule (unplayed) | AFL API `fetch_fixture_afl` | Squiggle `q=games` | **new** `staging.external_fixtures` | AFL match providerId `CD_M…` **[PROBE P3]**; Squiggle `id` stable | Stage auto; **never promoted** | `matches` requires NOT NULL `home_score/away_score/result/margin` **[SRC]** — an unplayed fixture is **not storable** in `matches` today. Staging-only avoids a schema change. |
| Match result / scores / completion | AFL Tables via fitzRoy | Squiggle `complete`+`updated`; Kali `/matches` pending P1 | `matches` (+ existing `staging.external_current_matches`) | AFL Tables match page; Squiggle `id` | **Reviewed** | Squiggle is the *trigger*, never the authority. The existing unrestricted overwrite is ISSUE-086's class (§1.2). |
| Quarter / period scores | AFL Tables `HQ1G..AQ4P` | AFL API | `match_period_scores` | derived from match identity | Reviewed | Unavailable from Squiggle/Kali; today's canonical inserts write none. |
| Attendance | AFL Tables `player_stats.Attendance` | — | `matches.attendance` + `attendance_status` | — | Reviewed | Absent from `fetch_results_afltables`; must be deduped from player-match grain. NULL ≠ 0. |
| Player match statistics | AFL Tables via fitzRoy | Kali `/player-stats` + `/player-stats-advanced` | `player_match_stats` | **profile `url` (0 NA in 2026, 1:1 with `ID`) — the key. `ID` is 82 NA in-season [PROBE P5]** | **Reviewed** | Kali covers 19 of 21 columns but its player id is **[UNKNOWN]** (P2, **BLOCKED — no API key**). Absent-era values stay NULL. |
| Brownlow round votes | AFL Tables `Brownlow.Votes` | — | `brownlow_round_votes` | as above | Reviewed | Correct grain already proven; NA ≠ 0 (finals stay NA). |
| Per-quarter *player* stats | **none** | — | `player_match_period_stats` | — | n/a | MISSING from every free source. Remains unpopulated for 2026+. |
| Player identity | AFL Tables `ID` + profile URL | AFL API providerId (stage as a second `external_identities` row) | `players`, `external_identities` | AFL Tables ID: **stable, proven** | **Reviewed** — a new player is always a human decision | Never match on name. `external_identities` writes go through the `AFLDB-ISSUE-092` population-drop gate. |
| Rosters / DOB / height / weight / jumper | AFL API `fetch_player_details_afl` | AFL Tables `player_details` (HT/WT/Cap/#, **no DOB, no stable ID**) | `players`, `player_birth_evidence` | `providerId` `CD_I…`, stable and shared with the lineup endpoint **[PROBE P4]** | Reviewed | DOB writes must respect the `dob_conflict` ownership rules from `AFLDB-ISSUE-090` / migration 072. **`weightInKg` is 0 for 46/46 rows — map to NULL, never 0.** |
| Lineups / team announcements / late changes / subs | AFL API `fetch_lineup_afl` | — | **new** `staging.external_lineups` | `providerId` / `teamId` / `player.playerId` — 0 duplicates over 572 rows **[PROBE P3, P3b]** | Stage auto; **never promoted** **[DECISION]** | Only free lineup source found. Unofficial endpoint. Column set varies by round because **`lateChanges` is conditional** (19 vs 20, now fully enumerated **[P3b]**); **no substitute field exists** — `EMERG`/`INT` are positions — and **no substitution semantics are derivable**: `lateChanges` is team-grain free text with no player ids, and pre/post-change row state is unknown. `player.captain` is a sentinel (572/572 `FALSE`) and is not projected. **Absence sweeping disabled** — match-set completeness is proven, row-grain completeness is not. |
| Ladder / team-season | **resolved by `AFLDB-ISSUE-095` into `recomputeClubSeasons`** — see §6 | Squiggle `q=standings` (all 15 fields **[PROBE]**); AFL Tables season ladder; `fetch_ladder_afl` | `club_seasons` | — | Reviewed | *(Corrected 2026-09-22, ISSUE-244 F021.)* `club_seasons` is derived from canonical `matches` by `recomputeClubSeasons`; ISSUE-095's D1–D7 are implemented, not open (§6 correction box). The AFL API settle also invokes the recompute after applicable canonical writes (ISSUE-244 F001). No new ladder implementation is implied here. The source evidence listed is retained as lineage. |
| Awards — Brownlow | AFL Tables `Brownlow.Votes` | — | `brownlow_round_votes`, `brownlow_season_votes` | — | Reviewed | Already solved by the fitzRoy path. |
| Awards — Coleman | derived from `player_match_stats.goals` | — | `award_winners` | — | Reviewed | Derivable, not acquired. Confirm the H&A-only rule before deriving. |
| Awards — Rising Star, All-Australian, AFLCA, AFLPA, club B&F | **no API** | FootyWire / Wikipedia scrapes (existing) | `award_winners`, `award_nominations`, `honour_team_members` | — | Manual | `import_awards.py` still requires `AFLDB_LEGACY_SQLITE` — see issue G. |
| Draft | **no API** — DraftGuru | — | `draft_persons`, `draft_picks` | DraftGuru id (existing ledger) | Reviewed | Keep the existing path. Do not force an API. |
| Venues | registry only | AFL Tables / AFL API strings → `venue_aliases` | `venues`, `venue_aliases` | — | **Never** | An unmapped display name is a refusal. Addresses §1.1.1. |
| Clubs | registry only (`clubs.json`, `club_organizations`) | source strings → `club_aliases` | `clubs`, `club_aliases` | — | **Never** | Historical identity via `afldb_identity_for_season`; Brisbane Bears/Lions stays unbridged. |

---

## 4. Recommended architecture

Keep the existing shape — it is right — and generalise it. **external API → immutable snapshot
→ resolution → reconciliation diff → reviewed promotion → canonical with provenance.**

Standing rules for every 2026+ family:

1. **Snapshot before any canonical write, and never overwrite a snapshot.** Replace
   `ON CONFLICT DO UPDATE` with an append-only observation keyed
   `(source_id, external_record_id, payload_hash)`, or add a superseded-row archive. Today a
   retrospective source edit is unrecoverable (§1.1.3).
2. **Retain raw source ids and per-source record identity.** Already done for matches; extend
   to every family. Store Squiggle `updated` and its equivalents as the change signal.
3. **Reconcile, never truncate-and-reload.** The `AFLDB-ISSUE-078/080/085` lesson applies in
   full: a current-season loader must never become another destructive reload.
4. **Absence is not deletion.** A record that stops appearing gets `absent_since`, a report
   line, and no canonical change. Distinguish *corrected*, *rescheduled*, *absent*.
5. **Preserve surrogate AFLDB ids and manual decisions.** `player_link_resolutions` and
   data-editor edits outrank any source refresh. A promotion that would revert a manual
   decision **fails closed** and is queued for review — see `AFLDB-ISSUE-086` (§1.2).
6. **Fail closed on foreign-owned natural-key collisions.** A promotion may only write rows
   this source owns, scoped by `source_id` — reuse the `AFLDB-ISSUE-092` `--source-key`
   containment pattern rather than reinventing it.
7. **Idempotent refreshes.** Re-running over unchanged upstream data must produce zero
   canonical writes and a stable report.
8. **Provenance on every row.** `import_batches` per run, `source_id` + `source_record_id` per
   row; and stop conflating staging and canonical counts in one counter (§1.1.4).
9. **Compare before promoting.** A promotion candidate carries its agreeing/disagreeing source
   set. Disagreement is surfaced, never resolved by processing order — and per §2.1, Squiggle
   and Kali may not be counted as two until independence is proven.
10. **Reviewed promotion by default [DECISION].** The only automatic canonical write worth
    later consideration is a final score for a completed match where resolution is unambiguous,
    the AFL Tables settle pass and Squiggle agree exactly, and the local row is still owned by
    this source. Everything else — inserts, player stats, rosters, ladders — is a super-admin
    action in `/admin/current-season`.

**What must not be built:** a second competing importer; an alias for a placeholder string
(`not recorded`, `TBD`); a nullable-score change to `matches` to hold fixtures; any promotion
of lineup data into canonical participation.

---

## 5. Operating lifecycle, 2026 → future seasons

> **AMENDED 2026-09-02 (AFLDB-ISSUE-122).** The lifecycle table below retains the original
> architecture as lineage. Its current interpretation is: Squiggle/Kali completion and
> provisional-score work writes observation history and staging only, when explicitly run for
> diagnostics or fallback investigation. The overnight AFL Tables settle pass is the guarded
> automatic canonical path. There is no automatic Squiggle/Kali fallback writer.

> **AMENDED 2026-09-21 (AFLDB-ISSUE-228 S8, operator decision Q7, 2026-09-19).** The Rollover
> row below no longer says the completed-season re-acquisition "supersedes in-season
> provenance" — that wording predates `afl_api` holding any canonical-write authority and is
> incompatible with it. **Corroborate, never re-own:** the fitzRoy/AFL Tables full-history
> rollover corroborates canonical rows independently sourced by `afl_api` (agreement is
> recorded; a disagreement opens a `data_issues` `source_disagreement` row, advisory only) and
> may enrich only through the declared field-group exception (`CO_SOURCE_ENRICHMENT`, today
> `matches.attendance` only — `AFLDB-ISSUE-228` §7.5). **Any ownership transfer away from the
> row's first-writer source is an explicit rule or an explicit operator decision, with its own
> `canonical_applications` ledger rows — never a side effect of the rollover running later.**
> This amendment updates the doctrine only; the rollover runbook itself (season promotion,
> `fitzroy-accepted-baselines.json`, `seasons.json.in_progress_seasons`, the Stage-9
> `matches_after_accepted_last_season` gate) remains `AFLDB-ISSUE-101`/F's own document to
> update, not this one's.

| Phase | Job | Source | Writes | Cadence |
|---|---|---|---|---|
| Preseason (Nov–Feb) | roster refresh | AFL API player details | staging → **reviewed** new players | weekly |
| Fixture release | fixture load | AFL API fixture + Squiggle games | `staging.external_fixtures` only | on release, then weekly |
| Team announcement (T−48 h → T−1 h) | lineup capture | `fetch_lineup_afl` | `staging.external_lineups` only | 2×/day match week |
| Match day | completion watch | Squiggle `complete` / `timestr` | **nothing** | ≤ hourly during matches (respect Standard-API guidance) |
| Post-match (T+2 h) | provisional score | Squiggle | staging only | per match |
| Overnight settle (T+12–24 h) | **AFL Tables settle pass, and (AFLDB-ISSUE-228 S8) the independent `afl_api` settle pass** | `acquire_core.R --from 2026 --to 2026` (partial snapshot + SHA-256 manifest) → import; `acquire-afl-api.ts` → `settle-afl-api.ts` | staging → **reviewed** `matches`, `match_period_scores`, `attendance`, `player_match_stats`, `brownlow_round_votes`; co-source corroboration, never re-ownership, between the two (§7.5) | nightly in season |
| End of round | ladder + diff report | per `AFLDB-ISSUE-095` | staging → **reviewed** `club_seasons` | weekly |
| End of home-and-away | final ladder, finals qualification | as above | reviewed | once |
| Finals | as per round | — | reviewed | weekly |
| Post-Grand Final | premier / wooden spoon / `seasons.status` | derived from matches (existing SQL semantics) | reviewed | once |
| Awards period (Sep–Oct) | Brownlow votes via settle pass (AFL Tables), and independently via the `afl_api` Brownlow settle when enabled for the live count (`AFLDB-ISSUE-228` §10); **everything else manual** | AFL Tables; `afl_api` (live count only); no API for the rest | reviewed | AFL Tables once; `afl_api` polled during the live count only |
| Draft (Nov–Dec) | DraftGuru re-acquisition | existing path | reviewed | once |
| **Rollover (Dec–Feb)** | **season promotion [DECISION]** — re-acquire the completed season through the standard full-history path, extend `data/reference/fitzroy-accepted-baselines.json`, **corroborate/enrich (never supersede) any independently-`afl_api`-owned in-season canonical rows per §7.5's field-group rule (AFLDB-ISSUE-228 Q7)**, advance `seasons.json.in_progress_seasons`, re-point the Stage-9 `matches_after_accepted_last_season` gate | fitzRoy full-history | reviewed, gated | once per season |

---

## 6. Interaction with `AFLDB-ISSUE-095` — coordinate, do not absorb

> **CORRECTED 2026-08-29 (AFLDB-ISSUE-101).** This section was written while ISSUE-095 was
> open. `AFLDB-ISSUE-095` is now **Resolved** and its **D1–D7 decisions are implemented, not
> open**. Two statements below are therefore superseded and are corrected in place; the
> surrounding evidence is retained as lineage because it is what the decisions were made on.
>
> 1. **"D1–D7 are open and not pre-empted here"** — superseded. They are settled. The
>    resolved architecture: `club_seasons` is derived from AFLDB's own canonical `matches`
>    under a declared 4/2/0 rule (`tools/migration/rebuild_derived.py`
>    `REBUILDS["club_seasons"]`; `recomputeClubSeasons` in
>    `src/db/queries/player-derived.ts`), `source_id` is `afltables`, `ladder_rank` fails
>    closed to NULL on an exact tie, and `fetch_ladder_afltables` is a **validation witness
>    only** — never a fact source. The derivation carries no hard-coded year.
> 2. **The "Blocking note" below** — superseded. `recomputeClubSeasons` no longer reads
>    `staging.team_seasons` at all, so it does **not** throw on every match mutation on a
>    canonically rebuilt database. It now derives from `matches` and refuses only when the
>    season has zero home-and-away matches (`AFLDB-ISSUE-099` F10). There is nothing to
>    "fix" and no guard to weaken.
> 3. **"Do not add a `club_seasons` Stage-9 gate until ISSUE-095 lands"** — superseded by
>    events: ISSUE-095 landed and its D7 **added six** `club_seasons` Stage-9 gates
>    (`tools/db/rebuild-test.ts:688-733`). The standing instruction for `AFLDB-ISSUE-101` is
>    now the opposite in form and the same in intent: **do not add another one.**
>
> What rollover actually coordinates with ISSUE-095 is the **accepted ladder witness**:
> `validate_ladder_witness.py --compare` is a bidirectional set equality against the whole
> `club_seasons` table, so the witness must cover exactly the accepted completed span.

ISSUE-095 owns the ladder/team-season domain. This investigation contributed evidence only:

- **D1 (authoritative source):** three free candidates now have evidence —
  `fetch_ladder_afltables`; the AFL Tables season-page ladder (proven live for 2026 **[PROBE]**);
  `fetch_ladder_afl`; and Squiggle `q=standings`, whose 15 probed fields cover every ISSUE-095
  column except `wooden_spoon`, `is_premier` and `finals_played` — all three of which the
  existing SQL already derives from matches. **Squiggle's depth is 2000+ only**, so it can serve
  2026+ but cannot serve 1897–1999; that asymmetry is exactly why D1 stays ISSUE-095's decision.
- **D1 evidence added 2026-08-28 by P6 — see §13.6. Evidence only; no D-decision is made here.**
  `fetch_ladder_afltables(season = 2026)` returns **18 × 8**: `Season, Team, Round.Number,
  Season.Points, Score.For, Score.Against, Percentage, Ladder.Position`. It therefore supplies
  precisely the two fields ISSUE-095's own fitzRoy capability split records as **not** provable
  from match facts — the published `Ladder.Position` and the `Season.Points` premiership tally —
  and supplies **no** `played`/`wins`/`draws`/`losses`, which stay match-derived. The call
  defaults to the most recent round only (Round 25 here); a per-round series needs an explicit
  round argument.
- **D4 (provenance):** a 2026+ API-sourced ladder row must not inherit the hardcoded
  `sports_data_lab` `source_id`. A new `data/reference/sources.json` key may be required.
- **Coexistence:** the API pipeline supplies the *in-progress* season's ladder; ISSUE-095's
  chosen canonical chain supplies completed seasons. At rollover the completed season's ladder
  is re-derived through ISSUE-095's path and supersedes the in-season rows.
- **Blocking note — SUPERSEDED 2026-08-29, retained as lineage.** This read: *"ISSUE-095 §6
  records that `recomputeClubSeasons` fails closed on an empty `staging.team_seasons`, so on a
  canonically rebuilt database **every** match create/delete/score-edit throws."* That is no
  longer true — ISSUE-095 re-pointed the function at `matches`; see the correction box at the
  top of this section.
- **Do not add a `club_seasons` Stage-9 gate — SUPERSEDED 2026-08-29.** ISSUE-095 landed and
  its D7 added six. The standing instruction for `AFLDB-ISSUE-101` is **do not add another**.

---

## 7. Gap analysis — what an API-first 2026+ pipeline still cannot deliver

| Consumer | Covered | Remaining gap |
|---|---|---|
| Public match/season pages | matches, scores, quarter scores, attendance, venue | unplayed fixtures have no canonical home (`matches` NOT NULL scores) |
| Public player pages | participation, all 21 stats, career derivation | per-quarter player stats (`player_match_period_stats`) — **no free source** |
| Ladders | ISSUE-095 dependent; source evidence now exists | premiership-points rules and published rank for 2026+ still need ISSUE-095's decision |
| Derived statistics | `player_season_stats`, `player_career_stats`, `player_clubs` rebuild from the above | none new, provided `player_match_stats` is complete per round |
| NL search | all match/player/club-season vocabulary | club-season answers stay degraded until ISSUE-095 lands |
| Grid Solver | match/player/club facts | same club-season dependency |
| Admin / player-links | new-player review is the intended promotion gate | `external_identities` writes must route through the ISSUE-092 gate |
| Awards | Brownlow ✔, Coleman derivable | Rising Star, All-Australian, AFLCA, AFLPA, club B&F — **no API**, and the importer still needs legacy SQLite |
| Draft | DraftGuru path is canonical | no API; unchanged, and that is fine |
| Current-season updates | matches + player stats + ladder + rosters | lineups staged but never public; late changes/subs not modelled |

**Permanent gaps under the free-source constraint:** per-quarter player statistics; canonical
unplayed fixtures; non-Brownlow awards; official late-change/substitution history.

> **[CONFIRMED 2026-08-28 — see §13.5 and §13.3]** The substitution gap is now proven from **both**
> candidate sources rather than assumed. AFL Tables' `Substitute` column exists in the 2026
> player-stats dataset but is **NA for all 9,522 rows**, and the AFL API lineup has **no
> substitute field at all** — its `EMERG` and `INT` values are field positions, not a medical-sub
> marker. Nothing free supplies late-change or substitution history.

---

## 8. Evidence gates — probes P1–P7

These are **evidence gates, not issue dependencies**. An issue may be created and designed
before its probe runs; only *implementation* is blocked where stated in §9. Nothing here
writes.

> **RUN 2026-08-28 — results in §13.** P3 **PASS**, P4 **PASS**, P5 **PASS** (stop condition
> **not** triggered), P6 **PASS**. P1 and P2 were **BLOCKED** on a missing `KALI_AFL_API_KEY`,
> then **RE-RUN the same day once the key was supplied: both PASS** — see §13.1 and
> §13.2, which retain the superseded BLOCKED records. **P1 changed the contract**: Kali
> `/matches` is *not* a Squiggle proxy, so the two are two witnesses; `/fixture` remains a proven
> proxy. **P2 proved the player-grain identity gap** rather than leaving it unknown. P7 remains
> **BLOCKED** — SSH to the dev host was refused non-interactively, **no database was queried**,
> and no local database may substitute for it. The probe definitions below are retained verbatim
> as the specification.

**P1 — Is Kali `/matches` independent of Squiggle?** (§2.1; decides whether AFLDB has one match
witness or two)
```bash
curl -s -H "Authorization: Bearer $KALI_AFL_API_KEY" \
  "https://kaliaflstats.com/api/afl/v1/matches?year=2026&limit=3" | head -c 2000
```
Compare `id` values and any `updated` field against Squiggle ids `38494/38495/38496`.
Identical ids ⇒ proxy ⇒ Kali is not a second witness for matches.

**P2 — Does Kali expose a stable player id?** (decides usability at player grain)
```bash
curl -s -H "Authorization: Bearer $KALI_AFL_API_KEY" \
  "https://kaliaflstats.com/api/afl/v1/player-stats?year=2026&round=1&limit=2" | head -c 2000
```

**P3 — AFL API lineup shape.** (supplies the `staging.external_lineups` columns)
```bash
Rscript -e 'library(fitzRoy); x <- fetch_lineup_afl(season=2026, round_number=25); print(dim(x)); print(names(x)); print(head(as.data.frame(x), 2))'
```

**P4 — AFL API roster shape and provider ids.**
```bash
Rscript -e 'library(fitzRoy); x <- fetch_player_details_afl(team="Carlton", season=2026, current=TRUE); print(dim(x)); print(names(x))'
```

**P5 — In-season AFL Tables settle is viable.** (proves the nightly settle pass has data)
```bash
Rscript -e 'library(fitzRoy); x <- fetch_player_stats_afltables(season=2026); print(dim(x)); print(range(as.Date(x$Date))); print(sum(is.na(x$ID))); print(sum(is.na(x$url)))'
```

**P6 — AFL Tables ladder shape.** (evidence for ISSUE-095 D1, not a decision)
```bash
Rscript -e 'library(fitzRoy); x <- fetch_ladder_afltables(season=2026); print(dim(x)); print(names(x))'
```

**P7 — Current staging reality on dev** (read-only; confirms §1.1.1/§1.1.2 in live data)
```sql
SELECT count(*) FILTER (WHERE venue_raw = 'Unknown') AS unknown_venue,
       count(*) FILTER (WHERE attendance IS NULL)     AS no_attendance,
       count(*) AS total_2026
  FROM matches WHERE season = 2026;
SELECT count(*) AS period_score_rows
  FROM match_period_scores p JOIN matches m ON m.id = p.match_id WHERE m.season = 2026;
SELECT count(*) AS player_stat_rows
  FROM player_match_stats s JOIN matches m ON m.id = s.match_id WHERE m.season = 2026;
```

**Stop conditions.** If P1 shows `/matches` is also a Squiggle proxy, Kali drops to a
statistics-only source and issue B's scope widens. If P5 shows AFL Tables lacks stable
`ID`/`url` for 2026, issue D's implementation is blocked and the in-season plan reverts to
Squiggle-provisional-only — do not proceed past that point without a fresh decision.

---

## 9. Recommended issues

**ID allocation:** do **not** assume 096 or trust any older snapshot. At creation time, inspect
the current `issues.md` headings and the `IssuesIndex.md` Open Issues table and allocate the
actual next unused IDs in order.

| # | Proposed issue | Boundary | Depends on | Implementation gated by | Evidence |
|---|---|---|---|---|---|
| **A** | **2026+ API-first acquisition architecture and contract** (parent) | **Design/contract only — no family-specific importer implementation.** Covers: the immutable/generalised staging contract; the reconciliation/diff model; the reviewed-promotion queue; and the provenance, ownership, absence and idempotence rules (§4 rules 1–10). | none | none | Proven need **[SRC]** |
| **B** | **Squiggle/Kali source independence: `/v1/fixture` is a verbatim Squiggle proxy** | The proven `/fixture` proxying is itself the tracked defect/risk. P1 then determines whether the finding extends to Kali `/matches`, and therefore whether Kali may count as a second match witness. Outcome updates `sourceDisagreements` and `--source all` corroboration semantics. | none | P1 for the `/matches` half | **Proven for `/fixture` [PROBE]** |
| **C** | **Shipped current-season importer defects** | Independently actionable containment of §1.1: fabricated `venue_raw = 'Unknown'`; canonical inserts creating incomplete/half matches without attendance, period scores or player participation; negative/incoherent counters; staging/canonical count conflation. **References `AFLDB-ISSUE-086` for the unrestricted canonical score overwrite (§1.2) and does not duplicate it.** Kept separate from A; not folded in. | none — **not dependent on A or B** | P7 recommended to size the live impact, not required to start | Proven in source **[SRC]** |
| **D** | **In-season AFL Tables settle stage** | Nightly partial fitzRoy acquisition (`--from/--to`) + snapshot manifest + reviewed promotion of matches, period scores, attendance, player stats and Brownlow votes. Reuses the ISSUE-093 machinery. | A | **P5** | Source proven live to 2026 R25 **[PROBE]** |
| **E** | **Staging-only lineup / team-announcement domain** | New `staging.external_lineups` fed by `fetch_lineup_afl`. Never promoted to canonical participation **[DECISION]**. No public surface. | A | **P3** (must supply the source shape) | Source exists **[PROBE]**; columns **[UNKNOWN]** |
| **F** | **End-of-season promotion / baseline rollover** | Extend `fitzroy-accepted-baselines.json` to the completed season, supersede in-season provenance, advance `seasons.json.in_progress_seasons`, re-point the Stage-9 `matches_after_accepted_last_season` gate. **Must not independently redefine completed-season `club_seasons` ownership** — that stays with ISSUE-095. | **D**, and coordination/completion of the relevant `AFLDB-ISSUE-095` canonical ladder/team-season path | — | Proven need **[SRC]** |
| **G** | **Awards have no canonical legacy-free acquisition path — record only** | Record that `tools/migration/import_awards.py:1408` still depends on `AFLDB_LEGACY_SQLITE`, and identify it as the legacy-free acquisition gap and the direct sibling of ISSUE-095. **Do not design the replacement under this investigation.** | none | — | Proven in source **[SRC]** |

**Exclusions preserved — do not create:**
- a Champion Data licensing issue (out of scope by **[DECISION]**);
- a `player_match_period_stats` issue while no free source exists to fix it with;
- any duplicate of `AFLDB-ISSUE-095` (ladder/team-season);
- any duplicate of `AFLDB-ISSUE-086` (unrestricted canonical overwrite, §1.2).

---

## 10. Implementation stages

Ordered to match the dependencies in §9.

1. **Run P1–P7** and record every result in the repository runbook. Observe the §8 stop
   conditions before going further.
2. **Issue A — contract/design.** Agree the standing rules (§4) and the generalised staging
   contract. No code, no family importer.
3. **Issue C — shipped-path containment.** Repair the proven defects (venue refusal instead of
   `'Unknown'`, no more half-match inserts, coherent counters) so the current season stops
   accruing bad rows while A, D and E land. Independent of A and B; may run in parallel with A.
4. **Issue D — settle path.** The nightly AFL Tables settle stage; the single highest-value
   piece, because it is the only thing that gives 2026 player statistics at all. Requires A;
   implementation gated on P5.
5. **Issue E — staging-only lineups.** Requires A; implementation gated on P3.
6. **Close issue B on the evidence.** Fix `sourceDisagreements` and corroboration semantics
   according to what P1 actually showed.
7. **Coordinate `AFLDB-ISSUE-095`** for the ladder family. Do not implement it here.
8. **Issue F — rollover.** After D, and after the relevant ISSUE-095 path is coordinated and
   complete. Schedule before the 2026 season closes.
9. **Issue G — remains record-only.** No design work under this investigation.

**Validation strategy:** extend `tests/current-season-import.test.ts` (the existing semantic
home) with deterministic fixtures per defect — never live-API-dependent; add a
snapshot-immutability test and an absence-≠-deletion test to the same suite; reuse the
ISSUE-092 `--source-key` containment pattern in every new importer test; integration tests
against `afldb_test` only. Never run a `--apply` path against production or `afldb_dev` during
development.

---

## 11. Unresolved unknowns [UNKNOWN]

The original list is retained; each item now carries its 2026-08-28 status.

1. Kali `/matches` independence (P1) and stable player id (P2). — **STILL UNKNOWN. P1/P2
   BLOCKED**, no API key. Until resolved, the corroboration contract treats Kali as *derived
   from* Squiggle for the match family and counts the two as **one** witness (§13.1).
2. AFL API lineup and player-details column sets, and whether provider ids are stable (P3/P4). —
   **RESOLVED 2026-08-28** (§13.3, §13.4). Shared `CD_M…`/`CD_T…`/`CD_I…` namespace; cross-endpoint
   use directly proven. New sub-unknown: **why the lineup column count differs between rounds**
   (19 at R25, 20 at R20) — observed, not diagnosed. — **SUB-UNKNOWN RESOLVED 2026-08-29 by P3b
   (§13.10):** the differing column is **`lateChanges`**, and it is **conditional** — present only
   in a round where at least one match carried a late change, absent from the payload entirely
   otherwise. R25's 19 columns are a strict subset of R20's 20.
3. Squiggle and Kali retrospective-correction behaviour — undocumented by both. — **STILL
   UNKNOWN.** Mitigated rather than resolved: the contract detects corrections by payload hash
   and never relies on a source declaring one.
4. AFL API terms of use for third-party consumption via fitzRoy. Not published; treat as
   revocable. — **STILL UNKNOWN**, unchanged.
5. Kali's true earliest season and player-population completeness (2,865 players over 27
   seasons looks low; unverified). — **STILL UNKNOWN**, blocked with P1/P2.
6. Whether the live 2026 `matches` rows already carry `venue_raw = 'Unknown'` (P7). — **STILL
   UNKNOWN. P7 BLOCKED** on interactive SSH/database access; nothing was queried (§13.7).
7. **New, 2026-08-28:** `player.captain` was `FALSE` for all 468 round-20 lineup rows. Recorded
   as observed; whether the field is unpopulated or genuinely false was not diagnosed (§13.3). —
   **RESOLVED 2026-08-29 by P3b (§13.10):** `FALSE` for **572 of 572** rows across 11 matches,
   22 team instances and 2 rounds, with 0 `TRUE` and 0 `NA`. Every AFL team names a captain, so
   the field carries **no captain signal** in the source as measured. It is **not projected** in
   v1 and is deliberately **not** declared zero-is-missing; it stays in `known_columns` so its
   disappearance remains detectable drift.

8. **New, 2026-08-29 (P3b, §13.10):** whether a match's lineup rows represent the team **before or
   after** a late change. Both the named incoming and the named outgoing player appeared in the
   returned rows for the one observed late change, and **n = 1** cannot settle it. Consequence:
   `lateChanges` is stored verbatim and never parsed.

9. **New, 2026-08-29 (P3b, §13.10):** whether the player rows returned for an individual team are
   **row-grain complete** on every run. Match-set completeness is proven; row-grain completeness
   is not, so **absence sweeping stays disabled for `afl_api.lineup`**.

---

## 12. Files this plan will change

- **New:** `AFLDB-2026-API-ACQUISITION.md` (this document, as the durable repository runbook).
- **Modified:** `issues.md` (new entries + Open Issues table), `IssuesIndex.md` (new rows) —
  only for issues actually created, with IDs allocated per §9.
- **Not modified:** `CHANGELOG.md` (investigation-only, per instruction); no source, schema,
  tooling or test file; no Git operation; nothing under the `AFLDB-ISSUE-086` worktree.

---

## 13. Evidence results — probes P1–P7, run 2026-08-28

Run by Claude under a one-task authorisation to execute the read-only §8 probes. Every command,
result and interpretation is recorded below. Nothing wrote. No production or canonical access
occurred. The `[SRC]`/`[PROBE]`/`[UNKNOWN]`/`[DECISION]` vocabulary of §"Evidence legend" applies
unchanged.

| Gate | Status | Outcome |
|---|---|---|
| P1 Kali `/matches` independence | **BLOCKED** | No API key. Kali **must not** count as an independent match witness. |
| P2 Kali stable player id | **BLOCKED** | No API key. Player-grain usability unresolved. |
| P3 AFL API lineup shape | **PASS** | Full provider identity + announcement state. `[UNKNOWN]` resolved. |
| P4 AFL API roster identity | **PASS** | Stable `providerId`, proven identical to the lineup player id. `[UNKNOWN]` resolved. |
| P5 2026 AFL Tables settle | **PASS — stop condition NOT triggered** | `url` 0 NA and 1:1 with `ID`; **`ID` 82 NA**. Settle keys on `url`. |
| P6 AFL Tables ladder shape | **PASS** | 18 × 8. Evidence for ISSUE-095 D1 only. |
| P7 2026 database reality | **BLOCKED (execution)** | SSH refused non-interactively. **No database was queried.** |

**Stop-condition adjudication (§8).** P5's condition — "AFL Tables lacks stable `ID`/`url` for
2026" — **did not trigger**: `url` is complete and 1:1 with `ID`, so identity is viable and
`AFLDB-ISSUE-099` is **not** blocked. P1's condition is **unadjudicated**, so its conservative
branch is adopted by contract: Kali is treated as a Squiggle-derived source for matches until
proven otherwise.

### 13.1 P1 — Kali `/matches` independence — **PASS, re-run 2026-08-28** [PROBE]

> **Supersedes the BLOCKED result recorded earlier the same day.** That record is retained
> verbatim at the end of this subsection: it is what the contract was built on, and the
> fail-closed default it forced was correct while it stood.

- **Commands:** `GET /api/afl/v1/matches?year=2026&limit=3`, then `&limit=100&offset=0|100|200`,
  with `Authorization: Bearer $KALI_AFL_API_KEY`; compared against
  `GET https://api.squiggle.com.au/?q=games&year=2026`. Read-only. The key was consumed from the
  environment and never printed.
- **Kali `/matches` 2026:** `meta.total` **204**, ids **11405–11611**, **14 columns** —
  `id, round, year, homeTeam, homeShortName, awayTeam, awayShortName, homeScore, awayScore,
  venue, date, startDatetime, crowd, sourcedAt`. Envelope is
  `{data, meta{limit,offset,count,total}}`. Served by Google Frontend; the envelope carries
  **no provenance/attribution field**.
- **Squiggle `q=games&year=2026`:** 218 rows, ids **38494–38729**, 26 columns.

**VERDICT: `/matches` is NOT a Squiggle proxy.** Five independent proofs, not one:

| # | Proof | Detail |
|---|---|---|
| 1 | **A real value disagreement** | Essendon v Port Adelaide, **2026-08-23**: Kali **95–105**, Squiggle **95–104**, with Squiggle `complete = 100`. A verbatim proxy cannot disagree with its upstream on a completed match. |
| 2 | **A fact class Squiggle does not publish** | `crowd` is populated for **80 of 204** rows (Opening Round 40,372 / 19,859 / 82,528 / 31,606). Squiggle's `games` has **no attendance field at all**, so Kali must have another upstream. |
| 3 | **Disjoint identity spaces** | **0** shared ids between 11405–11611 and 38494–38729. |
| 4 | **A different venue vocabulary** | **80 of 160** jointly observed games differ: `Marvel Stadium`/`Docklands`, `GMHBA Stadium`/`Kardinia Park`. |
| 5 | **A different projection** | Kali carries no goals/behinds; Squiggle carries both. |

- **`sourcedAt` is a stored per-record timestamp, not fetch time — directly measured.** Two
  fetches 1.5 s apart returned **byte-identical** payloads, and the five most recent rows carried
  **five distinct** values spanning 2026-08-21 → 2026-08-23. A response-time field would have
  been uniform and would have advanced. One row (West Coast v Hawthorn, played 08-23) carries
  `sourcedAt` **08-27** alongside a populated `crowd`, consistent with a genuine re-source when a
  late fact arrived.
- **Round vocabulary:** Kali numbers **Opening Round 0** (ids 11405–11409, 5–8 March 2026)
  and the last home-and-away round **24** — the same integers as Squiggle, with **0
  disagreements across all 160 jointly observed games**. AFL Tables numbers those same two rounds
  **1** and **25**. A shared *convention*, not evidence of a shared *dataset*.
- **⚠ RESIDUAL UNKNOWN, recorded rather than assumed away.** P1 disproves **pairwise**
  derivation, which is exactly what this runbook's independence definition tests. It does **not**
  exclude a **common ultimate upstream** — both could read AFL.com.au. Corroboration by these
  two groups is therefore weaker than two fully independent witnesses, and a disagreement between
  them stays a **review** signal, never an auto-resolution.
- **Join caveat, so the numbers are not over-read.** The Kali×Squiggle join keys on
  (date, home, away) with names canonicalised, and team naming differs between the feeds (`GWS`
  vs `Greater Western Sydney`). It matched **160** of 204/218. The 43 "Kali-only" and 56
  "Squiggle-only" keys are therefore **join artefacts plus genuine coverage differences**
  (Squiggle carries unplayed fixtures; Kali carries completed matches only) and are **not**
  evidence of anything on their own. The five proofs do not depend on that join being complete
  — proofs 2, 3 and 5 need no join at all.
- **Architectural implication — CHANGES THE CONTRACT.** `AFLDB-ISSUE-096`'s registry moves
  Kali `match` out of the `squiggle` independence group into its own `kali` group, and Squiggle +
  Kali become **two** witnesses for matches. The `/fixture` endpoint remains a **proven verbatim
  Squiggle proxy** and stays in the `squiggle` group — the same source can proxy on one
  endpoint and not on another, which is precisely why independence is declared **per family**.
- **Changes the runbook?** **Yes, materially.** §2.1's `[UNKNOWN] for /matches` is resolved;
  §4 rule 9's fail-closed default is no longer the operative case for this pair;
  `AFLDB-ISSUE-097` is unblocked.

**Superseded record — P1 BLOCKED, earlier on 2026-08-28** *(retained, not deleted)*

- **Command (not run at that time):** §8 P1.
- **Exact missing prerequisite:** `KALI_AFL_API_KEY`. In `.env` it existed only as the commented
  placeholder `# KALI_AFL_API_KEY=CHANGE_ME` (`.env:157`); `.env.example:163` carried the same
  placeholder.
- **Result:** none. Nothing was concluded, and the corroboration model failed closed by counting
  Squiggle + Kali as **one** independence group. That default was correct while the evidence was
  absent; it is superseded by evidence, not by preference.

### 13.2 P2 — Kali stable player identity — **PASS, re-run 2026-08-28** [PROBE]

> **Supersedes the BLOCKED result recorded earlier the same day**, retained at the end of this
> subsection.

- **Commands:** `/player-stats?year=2026&round=1|20&limit=2|200`, `/player-stats-advanced`,
  `/players?limit=200&offset=…` (paged to exhaustion), `/players/:id`, and a `player_id`
  filter round-trip. Read-only.

**VERDICT: there is NO stable provider player identifier on the player-stat grain.**

| Measure | Value |
|---|---|
| `/player-stats` columns | `matchId, playerName, teamId` + 17 statistics — **no player id** |
| `/player-stats-advanced` columns | `matchId, playerName, teamId` + 17 more — **no player id** |
| Id-shaped fields on a stat row | `matchId`, `teamId` only |
| `/players` population | **2,865** rows, `meta.total` 2,865 |
| `/players` columns | `id` (numeric), `name`, `currentTeamId` (slug), `onlineId` (slug) |
| `id` / `onlineId` distinct | **2,865 / 2,865**, **0 null** either field |
| Distinct `name` | **2,846** — **19 names shared by 38 players** |
| `player_id` filter | **WORKS** on the numeric id (`player_id=301` → `meta.total` 17, all "Nasiah Wanganeen-Milera"); the slug is rejected **HTTP 400** |

- **Kali holds the player id internally and simply does not project it.** The filter proves the
  join exists server-side; the response withholds it.
- **Name + team context is a heuristic, not an identity.** On a 200-row round-20 sample it
  resolved **200 of 200** (2 ambiguous by name — Bailey Williams, Matthew Kennedy — and
  **0** once `teamId` was applied). It nevertheless **must not** be promoted to an identity: the
  population contains same-name players on the **same** team (**two Alwyn Daveys, both
  `currentTeamId` = `essendon`**), and `currentTeamId` is the player's **current** team, not the
  team at match time — so the heuristic degrades exactly where history matters. The clean
  200/200 is a *current-season* result and does not generalise backwards.
- **The one viable identity path is enumeration:** page `/players` (2,865 rows) and fetch
  `/player-stats?player_id=…` per player. At the free tier's **1,000 requests/day** that is a
  multi-day crawl for a single season — a real design constraint, not a detail.
- **Architectural implication:** unchanged in direction, now **proven** rather than assumed —
  Kali cannot be designed into the player-grain path, and AFL Tables profile `url` remains the
  sole proven player-match identity for 2026 (§13.5). `AFLDB-ISSUE-096`'s registry records the
  gap as an explicit `identity_only` family, so it fails closed by contract rather than by memory.
- **Changes the runbook?** Resolves §2.3's `[UNKNOWN] and critical` player-identity question
  and §11 item 1. The 19 covered statistics columns still make Kali a useful corroborator
  **if** the identity gap is ever closed.

**Superseded record — P2 BLOCKED, earlier on 2026-08-28** *(retained, not deleted)*

- **Command (not run at that time):** §8 P2, same missing key.
- **Result:** none. Whether `/player-stats` returned a player id was **[UNKNOWN]**; §2.3's
  observation that `player_id` is an accepted *filter* while only `playerName` is a documented
  *response* field was unexplained. **It is now explained: both are true simultaneously.**

### 13.9 Provider independence versus ultimate authority — **[DECISION] 2026-08-28**

P1 settled a narrower question than the words "independent sources" suggest, and the distinction is
recorded here so no later issue quietly widens it.

- **Proven:** Kali `/matches` and Squiggle are **provider/pipeline-independent** for the `match`
  family — neither is derived from or mirrors the other (§13.1). This is exactly what
  §4's independence definition tests, so separate independence groups are correct.
- **Not proven:** that they rest on **distinct ultimate factual authorities**. Both could take some
  facts from a common upstream such as AFL.com.au.
- **Consequences, standing:** the two count as **two provider/pipeline witnesses** for matches;
  they are **not** two proven-distinct ultimate authorities; **separate independence groups are by
  themselves insufficient evidence for automatic canonical promotion**; and if promotion policy
  ever requires independent *ultimate authorities*, that must be a **new explicit contract and
  evidence decision**, never an inference from `independence_group`.
- **No behaviour changes today:** `AFLDB-ISSUE-096` S1 declares zero automatically promotable
  families and S2 builds no automatic promotion path, so this is a boundary being fixed while it is
  still cheap, not a defect being repaired.

### 13.3 P3 — AFL API lineup shape — PASS

- **Commands:** `Rscript -e 'library(fitzRoy); fetch_lineup_afl(season=2026, round_number=25)'`
  and the same for `round_number=20`. Environment: R 4.6.1, **fitzRoy 1.8.0** (the pinned
  contract version **[SRC]**).

| Measure | Round 25 (upcoming) | Round 20 (played) |
|---|---|---|
| Dimensions | **104 × 19** | **468 × 20** |
| `status` | `UNCONFIRMED_TEAMS` | `CONCLUDED` |
| `teamStatus` | `PROVISIONAL_TEAM` | `FINAL_TEAM` |
| Shape | 2 matches | 18 teams × **26** named players |

- **Columns (R25):** `providerId, utcStartTime, status, compSeason.shortName, round.name,
  round.roundNumber, venue.name, teamAbbr, teamName, teamNickname, teamId, position,
  player.playerId, player.captain, player.playerJumperNumber, player.playerName.givenName,
  player.playerName.surname, teamStatus, teamType`.
- **Match identity:** `providerId` = `CD_M20260142502`. **Team identity:** `teamId` = `CD_T140`
  (Western Bulldogs), `CD_T30` (Carlton). **Player identity:** `player.playerId` = `CD_I1020621`.
- **Round identity:** `round.roundNumber` **and** `round.name` (`"Wildcard Finals"` at 25).
- **Position vocabulary, 20 values:** `BPL BPR C CHB CHF EMERG FB FF FPL FPR HBFL HBFR HFFL HFFR
  INT R RK RR WL WR`. The 26 named players are on-field plus `INT` plus `EMERG`.
- **No substitute field exists.** `EMERG`/`INT` are positions, not a medical-sub marker.
- `player.captain` was `FALSE` for all 468 R20 rows — **observed, not diagnosed** (§11 item 7).
- **The column count differs between rounds (19 vs 20)** — direct evidence; cause not probed.
> **[CORRECTED 2026-08-29 by P3b — see §13.10]** The round-25 row of the table below reads
> `status = UNCONFIRMED_TEAMS` / `teamStatus = PROVISIONAL_TEAM` as though the whole payload
> were unconfirmed. It is not: round 25 is **50/50 mixed at match grain** — `CD_M20260142502`
> was `CONCLUDED`/`FINAL_TEAM` and `CD_M20260142501` was `UNCONFIRMED_TEAMS`/`PROVISIONAL_TEAM`.
> P3 appears to have characterised a sampled row rather than the whole payload. The **[UNKNOWN]**
> P3 resolved and the identity finding below are unaffected; the 20th column P3 counted but did
> not enumerate is `lateChanges`, enumerated by P3b.

- **Interpretation:** identity is fully adequate for `staging.external_lineups`, and
  `status`/`teamStatus` are the fields that make a lineup change meaningful rather than noise.
- **Architectural implication:** `AFLDB-ISSUE-100` is **unblocked**, with two new constraints —
  the staging projection is declared over a **required column subset**, and an unexpected or
  missing column is a **refusal**, not a silent NULL. The **[DECISION]** that lineups never
  become canonical participation is unaffected.
- **Changes the runbook?** Resolves the §2.5 and §3 `[UNKNOWN] (P3)`. Adds the schema-instability
  constraint, which is new.

### 13.4 P4 — AFL API roster / player details — PASS

- **Command:** `Rscript -e 'library(fitzRoy); fetch_player_details_afl(team="Carlton",
  season=2026, current=TRUE)'` → **46 × 17**.
- **Columns:** `firstName, surname, id, team, season, jumperNumber, position, providerId,
  dateOfBirth, draftYear, heightInCm, weightInKg, recruitedFrom, debutYear, draftType,
  draftPosition, data_accessed`.
- **Stable provider id: YES** — `providerId` = `CD_I1000953`, alongside a separate numeric `id`
  (`692`).
- **Cross-endpoint usability: DIRECTLY PROVEN.** All **26 of 26** distinct Carlton round-20
  lineup `player.playerId` values are present in this endpoint's `providerId` column. This is a
  measured join, not an inference from a shared prefix.
- `dateOfBirth`: **0 NA** across 46 rows. `heightInCm`: populated.
- **`weightInKg` = 0 for all 46 of 46 rows** — systematic zero-as-missing, not one bad row.
- `data_accessed` is AFLDB's own fetch date, not an upstream timestamp.
- **Interpretation:** adequate for roster staging and for a **secondary** `external_identities`
  row. It does **not** displace AFL Tables `url` as primary player identity, and a new player
  remains a human decision (§3).
- **Architectural implication:** two hard rules — `weightInKg` maps to **NULL, never 0** (AFLDB's
  "missing ≠ zero" rule; promoting it would write 0 kg for every player), and `data_accessed`
  is excluded from payload hashing and is **not** an upstream update timestamp (§13.8).
  `external_identities` writes still route through the `AFLDB-ISSUE-092` population-drop gate.
- **Changes the runbook?** Resolves the §2.5 and §3 `[UNKNOWN] (P4)`. The `weightInKg` finding is
  new and material.

### 13.5 P5 — 2026 AFL Tables settle viability — PASS, stop condition NOT triggered

- **Command:** `Rscript -e 'library(fitzRoy); fetch_player_stats_afltables(season=2026)'`, plus a
  follow-up characterising the NA-`ID` rows.
- **Dimensions:** **9,522 × 81**. **Date range:** 2026-03-05 → 2026-08-23. **207** distinct
  matches. **Rounds 1–25**, all numeric, **no finals rows yet**; rounds 21–25 each hold 414 rows.

| Identity measure | Value |
|---|---|
| `url` NA | **0** |
| `ID` NA | **82** |
| distinct real `ID` | 663 |
| distinct `(ID, url)` pairs | **663 — 1:1**, 663 ids ↔ 663 urls |
| NA-`ID` rows | 82 rows spanning **5 distinct urls**, 2 named players |
| Do those 5 urls carry an `ID` anywhere in 2026? | **0 of 5** |
| `Attendance` NA | **0** |
| `Substitute` | **NA for all 9,522 rows** |

- **⚠ Contradiction with an earlier assumption — recorded, not silently rewritten.**
  - *Previous assumption* (§2.4, §3): AFL Tables supplies "stable AFL Tables `ID` + profile `url`
    (0 NA)". That figure came from `AFLDB-ISSUE-093`, measured on **completed** seasons.
  - *New probe result*: for the **in-progress** season, `ID` is **82 NA across 5 players**, four
    of whom also carry NA `Player` and NA `DOB`. Their profile urls exist but never carry an `ID`.
  - *Architectural consequence*: **the settle path keys on `url`, not `ID`.** `ID` becomes an
    enrichment field. A row whose `url` is unknown to AFLDB is `unresolved_identity` and goes to a
    human — never an auto-created player. A debutant can arrive **with no name at all**, which is
    itself an argument for the reviewed-promotion **[DECISION]**.
- **⚠ Second contradiction — round numbering** (see the §1.1.5 amendment). AFL Tables numbers the
  Opening Round match (2026-03-05, Sydney v Carlton, S.C.G.) as Round **1**; Squiggle numbers it
  **0**; the AFL API's `round.roundNumber` **25** is *Wildcard Finals* while AFL Tables' Round 25
  is the last home-and-away round, played 2026-08-23. Three vocabularies on the same integers.
  A **declared per-source round mapping** is a contract requirement.
- **Third finding:** `Substitute` exists but is entirely NA — see the §7 amendment.
- **Interpretation and stop-condition adjudication:** stable identity **is** viable via `url`.
  The condition does **not** trigger; `AFLDB-ISSUE-099` is **not** blocked.
- **Changes the runbook?** Yes — materially. §2.4 and §3 amended; §1.1.5 upgraded from suspicion
  to proven divergence; §7 substitution gap confirmed from source.

### 13.6 P6 — AFL Tables ladder shape — PASS (ISSUE-095 evidence only)

- **Command:** `Rscript -e 'library(fitzRoy); fetch_ladder_afltables(season=2026)'`.
- **Dimensions:** **18 × 8**. 18 teams. `Round.Number` **25 only** — the call warns "No round
  number specified, trying to return most recent ladder".
- **Columns:** `Season, Team, Round.Number, Season.Points, Score.For, Score.Against, Percentage,
  Ladder.Position`.
- **Interpretation:** supplies exactly the two fields ISSUE-095's own fitzRoy capability split
  records as **not** provable from match facts — published `Ladder.Position` and the
  `Season.Points` premiership tally — and supplies **no** `played`/`wins`/`draws`/`losses`.
- **Architectural implication:** none for ISSUE-096. **This is evidence contributed to
  `AFLDB-ISSUE-095` D1 and nothing more. No D1–D7 decision is made, implied or altered, and
  ISSUE-095's architecture is untouched.**
- **Changes the runbook?** Adds a D1 evidence bullet to §6. Changes no decision.

### 13.7 P7 — current 2026 database reality — BLOCKED (execution); nothing queried

- **Command attempted:** `ssh -o BatchMode=yes arm@10.0.40.100 '… psql "$DATABASE_URL" -X -A -t
  -c "SELECT current_database(), current_user, inet_server_addr(), inet_server_port(),
  pg_is_in_recovery(), version();"'` — the **database-identity proof**, deliberately run before
  any measurement query.
- **Result:** `arm@10.0.40.100: Permission denied (publickey,password).` No key or agent is
  available in a non-interactive shell.
- **No database was queried, and no measurement was attempted.** Database identity was never
  proven, so per the standing rule nothing ran. The local `127.0.0.1:5432/afldb_dev` in `.env`
  was **deliberately not substituted** — it is a different database from the one the
  current-season importer has been exercised against, and substituting it would have produced
  confident numbers about the wrong system.
- **Architectural implication:** none. P7 is *recommended* for sizing `AFLDB-ISSUE-098`, **not
  required** to start it, and ISSUE-096's contract does not depend on it.
- **To resolve, in an interactive shell with SSH access** — identity proof first, then the §8
  measurements, all read-only:

  ```bash
  ssh arm@10.0.40.100 'cd ~/projects/afldb && set -a && . ./.env && set +a &&
    psql "$DATABASE_URL" -X -A -t -c "SELECT current_database(), current_user,
      inet_server_addr(), inet_server_port(), pg_is_in_recovery();"'
  ```

  Only if that prints a database you have confirmed is **not production**, run the §8 P7 queries
  against the same DSN. If the identity line is unexpected in any way, **HALT and query nothing.**

### 13.8 Cross-cutting consequences for the ISSUE-096 contract

Five findings changed the contract rather than merely filling a blank:

1. **Payload hashing, not source timestamps, is the change oracle.** P4 shows `data_accessed` is
   an AFLDB-side fetch date, and P3 shows `utcStartTime` is a **scheduled event start time**.
   Neither is an upstream mutation timestamp. Only Squiggle's `updated` genuinely is. Change
   detection therefore rests on the payload hash; an upstream update timestamp is a corroborating
   signal where one truthfully exists, and NULL otherwise.
2. **`url`, not `ID`, is the player-match key for the in-progress season** (§13.5).
3. **Round vocabularies must be declared per source**, not inferred (§13.5, §1.1.5).
4. **Zero is not missing** — `weightInKg` = 0 across an entire roster (§13.4) is the concrete case
   the rule exists for.
5. **Source schemas drift within a season** — the lineup column set differed between two rounds of
   the same competition (§13.3), so a staging projection must declare its required columns and
   refuse surprises.

The full contract these feed into is `issues/closed/AFLDB-ISSUE-096.md`.

### 13.10 P3b — AFL API lineup shape, types, NULLs and round completeness — PASS

`AFLDB-ISSUE-100`'s own bounded follow-up to P3, run **2026-08-29** in the same environment
(**R 4.6.1, fitzRoy 1.8.0**). P3 answered *"is the identity adequate"* and passed. P3b answers
*"can a fail-closed staging projection be declared"*, which needs the column P3 counted but never
enumerated, plus types, NULL behaviour and completeness. **It supersedes nothing in §13.3 except
the round-25 status characterisation corrected above**; the identity findings stand unchanged.

- **Commands:** `fetch_lineup_afl(season=2026, round_number=20 | 25)` and
  `fetch_fixture_afl(season=2026, round_number=20 | 25)`, read-only, no database.

| Measure | Round 20 | Round 25 |
|---|---|---|
| Lineup dimensions | **468 × 20** | **104 × 19** |
| Fixture dimensions | 9 × 55 | 2 × 58 |
| `status` | `CONCLUDED` 468 | `CONCLUDED` 52, `UNCONFIRMED_TEAMS` 52 |
| `teamStatus` | `FINAL_TEAM` 468 | `FINAL_TEAM` 52, `PROVISIONAL_TEAM` 52 |

- **The 20th column is `lateChanges`.** `EXTRA_IN_R20: lateChanges`; `EXTRA_IN_R25:` empty. Round
  25's 19 columns are a **strict subset** of round 20's 20, so the two shapes differ by exactly
  one conditional column and nothing else. This resolves §11 item 2's sub-unknown and closes the
  §13.8 point-5 refusal by **measurement**, not by relaxing the projection gate.
- **Types, identical for every shared column across both shapes:** 2 `integer`
  (`round.roundNumber`, `player.playerJumperNumber`), 1 `logical` (`player.captain`), the
  remaining 17/16 `character`. Flat tibble — no list-columns, no nested frames.
- **NULL/blank:** round 20 has **0 NA in every column except `lateChanges` (442 NA / 26 non-NA)**;
  round 25 has **0 NA in every column**. **0 blank or whitespace-only strings** in every character
  column of both rounds. `lateChanges` is the family's only nullable field, and the payload has no
  empty-string-as-missing idiom.
- **External key re-proven:** `duplicated(providerId, teamId, player.playerId)` = **0** in both
  rounds. Counts reconcile exactly at 9 × 2 × 26 = 468 and 2 × 2 × 26 = 104.
- **Round completeness — match-set equality, both directions empty in both rounds.** Round 20:
  lineup 9 / fixture 9. Round 25: lineup 2 / fixture 2. Every match returned exactly 52 rows, and
  round 25's `UNCONFIRMED_TEAMS` match **still returned a full 26-player provisional team on both
  sides** — an unannounced match is enumerated, not omitted. `fetch_fixture_afl` exposes
  `providerId` as a real top-level column, so this joins on the same `CD_M…` identity and needed
  no substitute key. fitzRoy's own progress output (`Fetching match ids` → `Checking lineups for 9
  matches`) shows the call enumerates the fixture and then fetches per match, which is why
  `fixture ∖ lineup` is the meaningful direction.
- **`player.captain` is a sentinel, not a signal.** `FALSE` for **468/468** and **104/104** —
  **572 rows, 11 matches, 22 team instances, 2 rounds, 0 `TRUE`, 0 `NA`**. Every AFL team names a
  captain. §11 item 7 recorded this as observed-not-diagnosed at 468 rows; P3b more than doubles
  the sample and the count of `TRUE` stays zero.
- **`player.playerJumperNumber`:** `integer`, 0 NA, 0 blanks, observed **1–51** (R20) and **1–47**
  (R25). No zero, no negative, no sentinel.
- **`position`:** the same **20 values** in both rounds, 0 NA, distributed perfectly regularly —
  18 distinct on-field positions once per team, plus `INT` ×5 and `EMERG` ×3 = 26 per team.
- **`teamType`** `home`/`away` only; **`compSeason.shortName`** `Premiership` only (572/572).

**`lateChanges` — what it is, and what it is not.** All 26 non-NA round-20 rows belong to **one**
`(match, team)` — `CD_M20260142007` / `CD_T130`, away — repeating one identical string
denormalised onto every player row of that team:
`INS: A.Caminiti OUTS: R.Marshall(Injured)`. So its measured grain is **team-level**, its content
is **free text with abbreviated human names and no provider player ids**, and 1 of 9 matches and
1 of 18 team instances carried any late change at all. **It is never parsed and never
name-matched** — joining it to `player.playerId` would need exactly the name matching this
document forbids at every grain (§3, player identity row).

**Two limitations recorded rather than assumed away:**

1. **Pre/post-change state is UNKNOWN.** In the single observed late change, **both** the named
   incoming and the named outgoing player still appear in the returned player rows. Whether a
   match's rows reflect the team before or after a late change cannot be established from **n = 1**,
   and resolving it from `EMERG`/`INT` would be an inference the position vocabulary does not
   support. §13.3's "no substitute field exists" is unchanged and is now joined by "no derivable
   substitution semantics either".
2. **Match-set completeness is not row-grain completeness.** P3b proves every fixture was queried;
   it does **not** prove the set of player rows returned for an individual team is complete on
   every future run. **Absence sweeping is therefore DISABLED for `afl_api.lineup`** —
   `markMissingObservationsAbsent()` is never called for it, `absent_since` is never set for it,
   and a missing player row is never read as a withdrawal. Migration-074 observation/version
   persistence is otherwise reused unchanged: a changed payload creates a normal version, an
   identical payload stays idempotent. Enabling absence needs an explicit durable row-grain
   completeness contract and belongs to a future issue.

- **Architectural implication:** `AFLDB-ISSUE-100` is **GREEN for source-contract completion and
  schema planning**. The measured vocabularies of `status`, `teamStatus`, `teamType`,
  `compSeason.shortName` and `position` are **measurements, not exhaustive provider contracts**
  (2, 2, 2, 1 and 20 distinct values from two rounds of one competition) and must not become
  closed database or source enum CHECKs; presence and type drift stay fail-closed through the
  source-family column contract instead. `required_columns` stays at the five identity/state
  fields — P3b's 0-NULL measurement establishes other columns as typed and usable but is not a
  provider guarantee that they can never be absent.
- **Changes the runbook?** Yes, in four places: it enumerates the §11 item 2 sub-unknown, corrects
  §13.3's round-25 status characterisation, resolves §13.8 point 5 for this family, and settles
  §11 item 7 as a sentinel. The §2.5 staging-only risk statement and the **[DECISION]** that
  lineups never become canonical participation are **unaffected**.

### 13.11 AFLDB-ISSUE-100 L2 — lineup acquisition and observation bundle — IMPLEMENTED

DB-free implementation record, 2026-08-29. Evidence basis: §13.3 (P3, identity) and §13.10
(P3b, shape/types/NULLs/completeness). **Nothing here persists, promotes or resolves anything.**

**A separate source contract, deliberately.** `tools/rebuild/fitzroy/fitzroy-contract.json`
declares `applies_to_source` = *AFL Tables via fitzRoy*, and all three of its acquisition kinds
(`core_snapshot`, `validation_witness`, `in_season_partial`) are season-ranged AFL Tables
snapshots gated on `data/reference/fitzroy-accepted-baselines.json`. A round-bounded AFL.com.au
API lineup fetch is none of those, so adding a fourth kind there would misrepresent that
contract's source. `tools/rebuild/afl_api/afl-api-contract.json` was created instead, following
the per-source layout `tools/rebuild/draftguru/` already establishes. The manifest **shape** is
reused; the source contract is not.

**Three durable contracts, all family-local to `afl_api.lineup`:**

1. **`external_record_id` = `providerId|teamId|player.playerId`**, in declared `external_key`
   order. **No generic external-key encoder exists in this repository and none was created**:
   `afltables.match` joins with `|` only because it inherits the canonical `matches.match_key`
   (`import_fitzroy_core.py:1188`, `:1579`), and `afltables.player_match_stats` uses `@` around
   one (`:1366`). Fail-closed: a component that is missing, blank, non-string or itself contains
   `|` **refuses emission**. The delimiter is never escaped, replaced or hashed, and player names
   are never a fallback — that assertion is what makes the encoding structurally unambiguous
   rather than dependent on the `CD_*` namespace holding forever.
2. **`scope_key` = `season=<int>;round=<int>`**, extending the existing single-pair
   `season=<int>` convention to the true acquisition grain. A season-only scope would overstate
   what one `fetch_lineup_afl` call enumerated.
3. **Enumeration `complete: false`, permanently in v1**, with a fixed reason retaining all three
   facts. `complete` is typed as the **literal `false`**, so widening it fails typecheck rather
   than merely failing a test.

**JSON, not CSV, for the raw artefact.** This family's payload contract requires NULL, `false`,
`0` and `""` to remain four distinct values, and an empty CSV field is ambiguous between `""`
and NA. JSON is lossless for the three types this source returns, so the reader invents **no**
coercion rules — a material difference from the AFL Tables path, whose Python importer does
explicit typed parsing.

**Determinism.** Records are sorted by `(family, external_record_id)` and enumeration ids are
sorted, exactly as the ISSUE-099 emitter does, so source row order is not carried at all;
serialisation reuses `observations.ts`'s `canonicalJson`, so no second canonical form exists.
Acquisition timestamps stay in the outer manifest and never enter a payload or the bundle.

**Validated end-to-end against live upstream, not only fixtures.** Round 20 acquired
**468 × 20** with `lateChanges` present; round 25 **104 × 19** with the column absent — matching
§13.10 exactly. In the real round-20 bundle: 468 records, ids sorted, **26** rows carrying one
distinct verbatim `lateChanges` string and **442** present-and-null, `player.captain` `false` on
468/468, jumper numbers all integer over 1–51, every `projection` null, `complete: false`. The
round-25 bundle carries **no `lateChanges` key at all**. Re-acquire → re-emit reproduced a
byte-identical bundle. The adapter refuses a missing `--season`, a missing `--round` and
`--round latest`.

**Gates:** `tests/afl-api-lineup.test.ts` **38/38**; with `reference-data`,
`current-season-import` and `fitzroy-acquisition` **272 passed / 2 pre-existing Python-gated
skips**; typecheck at the exact pre-existing **13-error, 4-unrelated-file** baseline with zero
ISSUE-100 errors.

**Still not built, by decision:** migration 077, the `afl_api` `sources` row, any staging table
or projection, any resolved match/club/player id, any captain or substitution model, promotion
candidates, `data_issues`, spine persistence, and absence sweeping. The **[DECISION]** that
lineups never become canonical participation is unaffected.

---

# 14. The AFL.com.au direct-API integration (`AFLDB-ISSUE-228`) — canonical architecture

**Added 2026-09-21, documentation-only pass.** This section documents the COMPLETE direct-HTTP
AFL.com.au integration for current-season fixtures/results, match/player statistics and the
Brownlow Medal count, exactly as implemented. It supersedes nothing above — §§1–13 predate this
work — and is the entry point a future maintainer should start from. Every fact below was
verified by reading the current implementation (source files, the migration, the registry, the
admin UI) and the operator-supplied validation evidence in `issues.md`; nothing here is inferred
from the frozen plan document (`issues/open/AFLDB-ISSUE-228.md`) where the two disagree — the
plan is the design contract, this section is what actually shipped.

## 14.0 Status, as of 2026-09-21

| Stage | State |
|---|---|
| S1 registry, identities, round translation | **COMPLETE**, operator-validated on `afldb_test` |
| S2 acquisition client/CLI | **COMPLETE** |
| S3 bundle emitter + backtest | **COMPLETE** |
| S4 migration 103 (typed projections) | **COMPLETE**, applied to `afldb_test` |
| S5 player provider bootstrap bridge | **COMPLETE**, 398/400 providers linked (afldb_test). *(Annotated 2026-09-22, ISSUE-244 F021.)* Current DEV full-season evidence, 2026-09-21 snapshot: **577 linked, 92 unresolved**. The `afldb_test` link set (398/400) and the DEV full-season evidence (577 linked / 92 unresolved) are **different datasets / evidence sets**, not a regression or a correction of one by the other; the earlier figure is retained as history. The 92 unresolved providers are owned by ISSUE-224. |
| S6 settle writer (match/roster/player-stats) | **COMPLETE**, operator-validated |
| S7 Brownlow settle engine + typed projection | **Implemented and operator-validated for historical replay (2022–2025, see §14.10) and for the completed 2025 season backtest. The real 2026 live-count capture/replay requirement is the one item still open** — see §14.11. |
| S8 operations (systemd units, docs, admin controls) | **COMPLETE**. Deploy files exist and are **NOT installed or enabled** on any host. |
| S9 DEV validation (real-feed dry-run/apply) | **IMPLEMENTED / NOT ACCEPTED — PARTIALLY EXECUTED** *(reconciled 2026-09-22; supersedes "PAUSED before any real-feed acquisition")*. A real 2026 acquisition occurred (snapshot `afl-api-2026-2026-09-21-011148`, manifest sha256 `dcbd0626…`, 217 concluded matches, 9,983 player-match rows, 0 bundle build failures; a later acquisition `…-031725` exists as lineage). The full-season bridge's 577 links were imported to DEV and a full DEV settle **dry-run** was **INCOMPLETE** (`unresolvedIdentityMatch 0`, `unresolvedIdentityPlayer 830`); it predates ISSUE-244 and is **not** current acceptance evidence. **No committed canonical `afl_api` apply, no S9 DEV smoke, no timer installation/enablement.** All committed S9 acceptance work must run on the post-ISSUE-244 lineage. **Route A (operator, 2026-09-22):** ISSUE-224 registration/linkage must let the same snapshot settle with `unresolvedIdentityPlayer = 0` and pass the F004 completeness gate; a partial-player apply by removing `--require-complete-source` is **rejected for S9 acceptance** (the flag's absence stays technically possible, just not the selected route). |
| S10 successors (fixture ingestion issue, season discovery, rekey/absence-sweep gaps) | **NOT STARTED** |
| Assertion 9 (§14.15) | **SKIPPED**, explicitly, not silently — distinct from S7/S9 |

**Deployment:** merged to `main` and deployed to DEV (commit `bbf87566` — *historical evidence of the
2026-09-21 merge deploy, not the current DEV SHA*); migration 103 applied on DEV; no AFL API timer
enabled; Brownlow deployment gate not enabled; PROD untouched. `27d7e5aa` (schema-drift fix) and
`4e67ce38` (full-season player-evidence emitter), cited in `issues.md`, are likewise historical
evidence of those two deploys. **Reconciliation 2026-09-22:** ISSUE-244 closed on main at `7f242ecc`
and the S9 branch starts from it; **which commit DEV currently runs is UNMEASURED** — the exact DEV
deployed SHA must be measured in the next read-only S9 preflight and equal the commit selected for
acceptance before any write/apply phase. DEV is not claimed to run `7f242ecc`.

## 14.1 Provider / API architecture

**Provider:** AFL.com.au's own JSON APIs — not a published, contracted, or licensed feed; no
operator credential is required, and it is treated as **revocable without notice** (the same
risk class §2.5 already records for the fitzRoy-mediated lineup/roster families).

**Three independently configurable host families**
(`src/lib/acquisition/afl-api-client.ts`, `resolveAflApiEndpointBases()`):

| Base | Default host | Auth | Serves |
|---|---|---|---|
| `public` | `https://aflapi.afl.com.au` | none | the season matches feed (`/afl/v2/matches`) — fixtures, results, scores, round identity |
| `cfs` | `https://api.afl.com.au/cfs` | `WMCTok` media token (`x-media-mis-token` header) | `playerStats/match/<CD_M>`, `matchRoster/full/<CD_M>`, and (S7) `bfawards/season/<CD_S>` + `bfawards/leaderboard/season/<CD_S>` |
| `sapi` | `https://sapi.afl.com.au` | — | **reserved**; declared for symmetry, no implemented endpoint uses it |

Each base is overridden independently via `AFLDB_AFL_API_BASE_URL` /
`AFLDB_AFL_API_CFS_BASE_URL` / `AFLDB_AFL_API_SAPI_BASE_URL` (all optional; unset = the real
host). The **`cfs` base is the only one a local Brownlow simulator redirects**
(`http://127.0.0.1:22880`, serving `POST /cfs/afl/WMCTok` and the `bfawards` routes) — pointing
it at the simulator never touches the `public` base, so match-family acquisition and Brownlow
acquisition can be independently rehearsed. **Real operation requires all three overrides to be
absent**: a leftover `AFLDB_AFL_API_CFS_BASE_URL` pointed at localhost would silently acquire
simulator data under a real-looking label, which is exactly what the Brownlow live-count runbook
(§14.9) adds an explicit clear-and-verify preflight step to prevent.

**Season/match discovery.** `GET {public}/afl/v2/matches?competitionId=1&compSeasonId=<id>&pageSize=1000`
returns the whole season's match objects in one call (largest observed season: 218 entries,
2026). `competitionId=1` is a measured constant (the AFL men's senior competition in every
sample 2022–2026), never a caller parameter. `compSeasonId` comes from the season identity
registry (§14.5).

**Fixtures/results, scores, rosters:** all three come from that one season feed plus two
per-match CFS endpoints:
- `GET {cfs}/afl/playerStats/match/<CD_M>` — 23 player rows per team (46 per match), all 21
  AFLDB statistic columns except `career_game_no` and `brownlow_votes`;
- `GET {cfs}/afl/matchRoster/full/<CD_M>` — team lists, positions, per-period team scores,
  weather, umpires, and (as measured, not yet used) `lateChanges`/`milestones`/`clubDebuts`.

**Brownlow (S7):** `GET {cfs}/afl/bfawards/season/<CD_S>` (per-match vote sets) and
`GET {cfs}/afl/bfawards/leaderboard/season/<CD_S>` (the reconciliation witness) — see §14.9.

**Token handling (`WMCTok`).** `POST {cfs}/afl/WMCTok` returns `{ token: string }`
(operator-verified live 2026-09-19); the token is held **in memory only**, never written to
disk or logged, reissued **once** automatically on a `401`/`403` from any CFS request, and a
second `401`/`403` with the fresh token is **not** retried again — that means the token
mechanism itself changed, not that one token expired, and the run fails rather than looping.
Every request retries transport/5xx failures 3× with exponential backoff
(`requestAflApi()`); a `401`/`403` is never retried at the transport layer, only via the
one-time reissue.

**Why real operation requires the test/simulator overrides to be absent:** the client has no
way to distinguish "the simulator" from "the real host" except by URL — there is no simulator
flag, no environment name check, nothing but the three base-URL variables. A stray override is
therefore a silent data-source substitution, not a refused run; §14.9's live-count runbook is
built around removing that hazard by positive verification (`Remove-Item` + re-read-and-assert)
rather than by convention.

## 14.2 Current-season match-family flow

```
AFL API (public feed + 2 CFS endpoints per match)
  -> acquisition (tools/current-season/acquire-afl-api.ts)         — manifest LAST, SHA-256/ETag/status per file
  -> bundle emitter (src/lib/acquisition/afl-api-bundle.ts)        — parse -> resolve -> project -> bundle (S3)
  -> observation spine (persistSourceObservation, migration 074)  — immutable, versioned, shared with AFL Tables
  -> settle plan (afl-api-settle-plan.ts)                          — identity, ownership, corroboration (S6-D)
  -> canonical writer (settle-afl-api.ts + canonical-apply.ts)     — matches / match_period_scores / player_match_stats
  -> typed projections (staging.afl_api_match / afl_api_player_match, migration 103)
       — a match row only for a match the settle PLANS (afl_api-owned or new), never for a
       corroborated foreign-owned match (§14.4, I244-F006)
  -> reporting (settle-report.ts)
```

**Acquisition** (`tools/current-season/acquire-afl-api.ts`, `npm run acquire:afl-api`): selects
matches by `--status` (default `CONCLUDED`), `--since YYYY-MM-DD`, or explicit `--match CD_M…`
(which bypasses the status filter entirely); writes raw bytes verbatim per match
(`fixture.json`/`player-stats.json`/`match-roster.json`) under
`data/sources/afl_api/matches/<label>/`, then the manifest **last**, so a failed run leaves no
manifest and self-cleans its own partial directory
(`cleanupPartialSnapshot()`/`claimSnapshotDir()`). Labels are collision-safe
(`YYYY-MM-DD-HHMMSS`, retried with a numeric suffix on a same-second collision) — a genuine fix
after two same-minute acquisitions once silently wrote into the same directory (S7 finding,
2026-09-20). A `--fixtures-only` mode exists that fetches **only** the public season feed (no
CFS request at all) into a separate `data/sources/afl_api/fixtures/<label>/` tree — see §14.5's
"fixture-only identity" note.

**Bundle emission** (S3, `afl-api-bundle.ts`) combines one match's three payloads into one
`AflApiMatchBundle`: resolved match facts, resolved roster/period-score facts, resolved player
stat rows, and a derived, cross-checked local match date/time (§11.1: the roster's own
`venueLocalStartTime` must agree, to the second, with the match feed's `utcStartTime` converted
through the venue's own IANA timezone — a genuine disagreement between the two independently
observed values is a HALT-class contract violation, `local_time_contradiction`, never silently
resolved toward one side). **Canonical `match_time` format (Q5-B, decided 2026-09-22):** once
the two values are proved to agree, the emitted canonical `match_time` is the venue-local wall clock
rendered as zero-padded **`HH:MM`** (`19:40:00` → `19:40`, `07:05:00` → `07:05`; seconds dropped);
`NULL` still means "not published / unavailable"; the agreement check itself stays at **second**
precision (`19:40:01` vs `19:40:59` is still a `local_time_contradiction`, not two equal `19:40`s);
`match_time` is non-identity; no AFL Tables data was rewritten and no column was typed. Semantic hashing canonicalises the declared-column observation
(sorted keys, stable array order) before hashing — never the raw HTTP bytes — with **every
family's `hash_exclusions` empty** (§14.3's semantic-hashing rule: an exclusion needs ≥3
evidenced pairs, a registry `evidence[]` entry and a fixture regression test before it may ever
be added; none has been).

**Round translation** is centralised in one module, `src/lib/acquisition/afl-api-rounds.ts`,
`translateAflRound()` — the only code path in the repository allowed to turn an AFL round number
into AFLDB's `(round_code, round_number, round_type, is_final)`. Per-season vocabularies are
declared data (`data/reference/source-families.json` → `round_vocabularies.afl_api_<year>`),
covering Opening Round (present 2024+, absent 2022–2023), ordinary home-and-away rounds,
Wildcard Finals, a mixed Qualifying/Elimination round split by `metadata.finals_match_label`
text-matching rules, and Semi/Preliminary/Grand Final. Typed refusals, never a guess:
`round_vocabulary_missing` (a season with no declared table — a run-level HALT before any DB
connection), `round_unmapped`, `round_vocabulary_drift` (an observed name/abbreviation disagrees
with the declared row), `finals_label_required` (the mixed round's label is absent or
unrecognised — the real, measured 2025 limitation, see below), `round_inconsistent`. A dedicated
Brownlow entry point, `translateAflApiBrownlowRound()`, additionally refuses any round that
translates to a non-home-and-away type (`brownlow_round_not_home_and_away`), because the
`bfawards` feed publishes only a bare `roundNumber` with no abbreviation/name/label to translate
against.

**Measured limitation, not yet acted on:** the fuller 2025 season feed's finals rounds carry
`metadata.prematch_label` ("1st Qualifying Final", …), not `metadata.finals_match_label` (which
is `undefined` on every 2025 finals record measured) — so four 2025 fixture-only records
(`CD_M20250142501`–`04`) currently refuse `finals_label_required`. This does not affect Brownlow
(finals are excluded from that feed both naturally and defensively) and is recorded as an open
gap in §14.15, not fixed by this documentation pass.

**Validation gates** (per match unit, all named and refused independently, never guessed past):
status (fixture `CONCLUDED`; roster `CONCLUDED` for period/stat targets — see §14.3's
POSTGAME/deferral model), season/round agreement, team resolution (map-only, refuses on
name/abbreviation drift), match resolution (§14.5), score arithmetic
(`total = 6×goals + behinds` both sides), period-score cumulative-conversion-reproduces-final,
player counts (23 per team, 46 per match, no duplicate `CD_I`), goal/behind reconciliation
against the roster's own per-player rows, integrality (every stat is an integer — a genuine
non-integral float, as opposed to a measured `9.0`, refuses the record), provider-id
cross-consistency, player identity resolution (§14.5 — an unresolved player refuses that one
player unit, never the whole match), and the existing canonical-conflict gates (ownership,
manual authority, baseline hash, in-progress season, completion).

**Apply semantics.** `--apply` without `--auto-apply` persists spine observations and typed
projections only — no canonical write; `--apply --auto-apply` additionally writes
`matches`/`match_period_scores`/`player_match_stats` through `applyCanonicalUnit()`, subject to
every gate above re-evaluated inside its own savepoint against freshly re-read state.
`--dry-run` runs the identical write path and unconditionally rolls it back. `--validate-only`
re-hashes the manifest and validates the registry contract without opening a database
connection at all. A failed unit's write is isolated to its own savepoint
(`canonical_apply_failed` finding + `data_issues` row) and never aborts the run or any other
unit.

**Replay/idempotency.** An unchanged re-observation of an already-projected/applied match is a
`head_refreshed` spine touch and a no-op write (`nothing_to_write` per target, proven by the
baseline-hash comparison inside `applyCanonicalUnit()`). A changed payload creates a new spine
version and, if the row is `afl_api`-owned (or the field is the one enrichable attendance
group), an ordinary `corrected` write; a foreign-co-source-owned row is corroborated, never
overwritten (§14.3).

## 14.3 Source / provenance model

**Observation vs. ownership vs. corroboration vs. enrichment vs. disagreement — the four
distinct concepts, precisely:**

- **Observation**: any parsed, validated payload persisted to the migration-074 spine. Every
  status (`SCHEDULED`, `LIVE`, `POSTGAME`, `CONCLUDED`) is observed; only `CONCLUDED` is
  promotable.
- **Canonical ownership**: `matches.source_id` names exactly one source per row —
  `afltables` or `afl_api`, whichever was the FIRST source to promote that real-world match.
  Ownership is **never transferred as a side effect of a later settle run**, from either
  direction.
- **Corroboration**: when a co-source (see below) observes a row it does **not** own, its
  observation is compared to the canonical value and classified agreeing/disagreeing
  (`classifyCorroboration()`), counted (`corroboratedForeignOwned`), and — on disagreement —
  raises an advisory `data_issues` row. **No write happens either way.** The row's owner and
  every already-canonical field are unchanged.
- **Enrichment**: the **one** declared exception (§ below): a co-source may write into a
  **specific, narrow field group** on a row it does not own, never touching ownership or any
  other field.
- **Disagreement**: a corroboration outcome, not a write outcome — a `data_issues` row
  (`issue_type = 'afl_api_settle'`, advisory), resolved automatically once a later poll agrees.

**How `afltables` and `afl_api` coexist (Q1, co-source corroboration).** Both are declared a
co-source pair for the `matches`/`match_period_scores`/`player_match_stats`/`brownlow_round_votes`
targets (`data/reference/source-families.json` → `co_source_groups: [["afltables", "afl_api"]]`).
Existing 2026 `afltables`-owned rows stay `afltables`-owned when `afl_api` later observes the
same match; a match first promoted by `afl_api` (i.e. `afltables`' nightly settle has not yet
run for it) is `afl_api`-owned. `autoApplyOwnership()`'s foreign-ownership refusal (E3) is
**never weakened** — the co-source classification is applied by the settle core **after** E3's
verdict, and only for a declared co-source pair; a non-co-source foreign owner is still an
ordinary refused/exception path. No code path sets `matches.source_id` on an `UPDATE`
(`provenanceForUpdate()`, deliberately excludes `source_id` from every canonical `UPDATE`'s
`SET` list — a real bug found and fixed during S6 closure, proven by a source-scan test, never
observed to change a written value at runtime because E3 already refused any UPDATE that would
have reached a foreign-owned row).

**Attendance enrichment (Q2) — the actual, verified direction.** Corrected here against an
earlier draft of this documentation that had the direction backwards (see `issues.md`'s
"operational-control gap" paragraph, 2026-09-21, for the full audit trail):

> **`afl_api` never proposes or enriches attendance, for any match.** It has none to give — no
> AFL.com.au feed this integration reads carries an attendance/crowd field. Every `afl_api`
> match proposal fixes `attendance = NULL`, `attendance_status = 'not_collected'`,
> `attendance_source_id = NULL` on INSERT, and **omits all three fields from every UPDATE**
> (`proposedAflApiMatchValues()`), so an ordinary correction can never claw back an existing
> AFL-Tables enrichment.
>
> The one enrichment sweep that exists (`applyAttendanceEnrichment()`,
> `CO_SOURCE_ENRICHMENT = { matches: { attendance: ['attendance', 'attendance_status',
> 'attendance_source_id'] } }`) is triggered **from within `settle-afl-api.ts`**
> (`sweepAttendanceEnrichment()`) but **always enriches with `afltables` as the enriching
> source** — it reads AFL Tables' own typed projection (`staging.afltables_match`) read-only and
> targets matches the **current (`afl_api`) run owns**. There is no code path anywhere in the
> repository where `afl_api` is the enriching source (`settle-afltables.ts` never calls
> `applyAttendanceEnrichment` with `afl_api`, and no other caller exists).
>
> So the one real scenario is: **an `afl_api`-owned match receives `afltables`-sourced
> attendance.** After enrichment, `matches.source_id` stays `afl_api` (enrichment never
> re-owns) and `attendance_source_id = afltables`. For an `afltables`-owned match, attendance
> was written directly by `settle-afltables.ts`'s own proposal at promotion time
> (`attendance_source_id = afltables`) and no cross-source enrichment mechanism ever runs
> against it — the sweep only iterates the current run's **own** owned match keys.
> `attendance_source_id` is therefore always `afltables` whenever it is set at all, regardless
> of which source owns the match — but the *direction of the write* only ever runs one way:
> AFL Tables data flowing into an AFL-API-owned match, never the reverse.

**The gate, all seven conditions, re-evaluated inside `applyAttendanceEnrichment()`'s own
savepoint against freshly re-read state (never carried in from an earlier read):**

1. the canonical `matches` row already exists (enrichment never inserts);
2. the row's current owner is a **different**, declared co-source of the enriching source;
3. `matches.attendance_source_id IS NULL` (the field is genuinely unsourced — via the
   migration-020 `coverage_status` CHECK, this implies `attendance IS NULL` and
   `attendance_status <> 'complete'`; a value already citing **any** source, including a manual
   admin edit, is never touched automatically, whatever its value);
4. no active `data_overrides` row for `(matches, <match_key>, 'attendance')`;
5. the incoming value is a valid integer ≥ 0, with a non-NULL citing source id required for a
   zero crowd (the migration-020 zero-crowd rule);
6. only the attendance field group is written — `matches.source_id` (ownership) is never
   touched;
7. the write goes through `applyCanonicalUnit()`'s own ledger path, producing one
   `canonical_applications` row (`target_table='matches'`, `verb='update'`, `new_values` =
   exactly the three attendance fields).

**Completion never freezes the field.** The gate keys on `attendance_source_id IS NULL`, never
on match completion, `CONCLUDED` status, or `is_final` — a fully settled, already-corroborated
`afl_api`-owned match remains eligible for attendance-only enrichment for as long as its
attendance is unsourced. Every other already-sourced field (scores, period scores, statistics)
is protected by ordinary ownership/authority rules and moves only through `corrected`
candidates, never automatically.

**Import-batch lifecycle (AFLDB-ISSUE-244 I244-F008).** Every AFL API writer that commits an
`import_batches` row — `settle-afl-api.ts`, `settle-afl-api-brownlow.ts` (apply *and*
`--observe-only`) and `settle-afl-api-fixtures.ts` — closes that row in the **same transaction**:

```text
BEGIN
  INSERT import_batches            (status 'running', started_at, records_read)
  observe / plan / write / record import_rejections and data_issues
  [--require-complete-source gate  -> refuses => whole transaction rolls back, batch row included]
  finalizeSettleImportBatch()      (status 'completed', completed_at, counters)   <- settle-core.ts
  [--dry-run                       -> rolls back, batch row included]
COMMIT
```

- **A row with `status = 'running'` can therefore only mean a crashed process**, never a
  finished run whose writer forgot to close it. Dry-run, a `--require-complete-source`
  refusal, a run-level HALT and any thrown error roll the batch row back with everything else,
  so **no committed batch exists for a run that did not commit**. Pre-transaction refusals (the
  ingestion gate, the F016 database-identity check, the F006 fixture-identity requirement)
  never open a batch at all. A dry-run still executes the real finalising `UPDATE` before it
  rolls back, so it proves that statement against the real privileges.
- If the finalising `UPDATE` does not close exactly one `running` row, or fails, the
  transaction fails — committed data is never left beside an open batch.
- A committed run that refused some *records* (an unresolved player, an unknown Brownlow match)
  is still `completed`: `import_status` is `running | completed | failed | rolled_back`, and
  record-level refusals are reported by `records_rejected`, not by a different status.

Column semantics (migration 001; the AFL Tables settle and `tools/migration/common.py` follow
the same contract):

| Column | Value | Source of truth |
|---|---|---|
| `status` | `completed` | the only terminal state a committed run can have |
| `started_at` | transaction start (schema default) | database |
| `completed_at` | `clock_timestamp()` at finalisation | database (`>= started_at`; `now()` would equal `started_at` exactly) |
| `records_read` | records the run was handed (settle records / vote sets) | stamped at open; equals `observationsSeen` |
| `records_inserted` | new `staging.source_record_versions` rows (the batch's own `target_table`) | `versionsAppended` |
| `records_updated` | `0` — that table is append-only; an unchanged replay writes no version | constant |
| `records_rejected` | **number of `import_rejections` rows persisted for the batch** | `SELECT count(*)` of the rows the transaction wrote, never an in-memory counter |
| `validation_result` | the run's counters, verbatim | the returned `counters` object |

Two consequences worth knowing when reading a batch. **`records_rejected` counts rows, not
refusals:** an unresolved player writes one `import_rejections` row; a Brownlow
`match_identity_conflict` refusal writes a `data_issues` row only (an automatic-apply refusal
finding is likewise a `data_issues` row — see the F009 subsection below) and `--observe-only`
writes no diagnostic rows at all, so `voteSetsRefused` in
`validation_result` can exceed `records_rejected`. **Canonical outcomes are not in
`records_inserted`/`records_updated`** — `canonicalRowsInserted`, `canonicalRowsUpdated` and the
rest are in `validation_result`, which is also where the admin read model looks for them. An
identical replay is a *new, terminal* batch: `records_inserted = 0`, `records_updated = 0`, all
canonical counters `0`, and `records_rejected` equal to the rejection rows that replay itself
wrote (an unbridged player is refused — and rejected — again).

**Automatic-apply refusals (AFLDB-ISSUE-244 I244-F009).** Under `--apply --auto-apply`, a target
`applyCanonicalUnit()` *declines without rolling back* used to leave nothing but the run counter
`canonicalApplyRefusals`: after the run nobody could say **which** target was refused or **why**
(the canonical example is a player-stat row `afltables` owns that differs from what `afl_api`
proposes — `foreign_source_owner`). Each such target now opens (or refreshes) **one** durable
finding, in the run's own transaction. Nothing canonical is written and ownership is never adopted.

| | |
|---|---|
| Where | `data_issues`, `issue_type = 'canonical_apply_failed'`, `details->>'owner' = 'AFLDB-ISSUE-122'`, `details->>'source_key' = 'afl_api'`. Listed by the settle exception report's *Open canonical apply failures* section (`settle-report.ts`) — that section now holds refusals as well as failures. |
| Key | `afl_api\|apply\|<family>\|<external record id>\|<target table>` — the **same** key as the failure finding for the target, so one open row describes the target's latest unresolved automatic-apply outcome |
| Reason | `details->>'refusal'`, the applier's own vocabulary verbatim: `foreign_source_owner`, `ownership_indeterminate`, `manual_authority_conflict`, `manual_authority_indeterminate`, `stale_canonical_target`, `no_canonical_match` (a dependent target whose match was itself refused). `description` carries the same code in words. `details` also names the canonical target, `family`, `external_record_id`, `source_version_seq`, the **field names** that would have changed and the `match_key` — never proposed values, payloads or error text. |
| Severity | `warning` for a refusal that is working as designed (`foreign_source_owner`, `manual_authority_conflict`, `stale_canonical_target`, `no_canonical_match`); `error` for a fail-closed one (`ownership_indeterminate`, `manual_authority_indeterminate`) |
| Not a finding | `nothing_to_write` (state already matches; it closes an open finding instead); `write_failed` (already durable as the existing failure finding) |
| Season gate | `season_not_in_progress` refuses *every* target of the season identically, so it is **one** run-level finding per season (`afl_api\|apply\|season\|<year>\|seasons`), not one per target |

*Replay.* One open row per key (`uq_data_issues_open_by_key`): an identical replay refreshes it in
place (`dataIssuesRefreshed`), a changed reason updates the same row, and nothing is duplicated.
*Self-heal.* The finding closes — in the same transaction — the run its target either applies
(`resolution = 'canonical_apply_succeeded'`), no longer differs from canonical state
(`'canonical_apply_not_needed'`, e.g. the other source was corrected to agree) or, for the season
gate, the season is in progress again (`'canonical_apply_refusal_cleared'`). The writer only ever
closes an **unresolved** row carrying its own `owner` and `source_key`. *Human decisions.* A row a
super admin resolved is never rewritten. If the refusal condition still holds, the next run opens
exactly one fresh finding beside it (the unique index is partial on unresolved rows) and later runs
refresh that one — the same recurrence contract every settle finding has; there is no
"acknowledged, do not re-raise" state. *Transaction.* Findings are written on the run's own
transaction, so `--dry-run`, a `--require-complete-source` refusal (F004) and a HALT leave none.

*Why `data_issues`, not `promotion_candidates` or `import_rejections`.* `promotion_candidates` is
the human review queue for a **proposal**: its verbs are the reconciliation vocabulary (it has no
`stale_canonical_target`, no distinct `ownership_indeterminate`, nothing for `no_canonical_match`),
it has no reason column, and a candidate can only leave `pending` together with an append-only
`promotion_decisions` row naming a human `admin_user_id` — which the automatic path may not
fabricate. It therefore could never self-heal (an existing pending candidate is left pending and
counted `candidatesMootLeftPending`). `import_rejections` records a **source** record the writer
rejected and feeds `records_rejected` (F008); a refused canonical write is a record the source
delivered and the spine observed, so nothing is written to it and `records_rejected` is unchanged.
No new counter was added: `dataIssuesOpened` / `dataIssuesRefreshed` / `dataIssuesResolved` carry
it, and `canonicalApplyRefusals` keeps its existing meaning (it also counts `nothing_to_write`).

*Already durable, deliberately not duplicated:* a match refused at planning
(`foreign_owned_collision`, `unresolved_identity` → pending candidate plus `import_rejections`;
other match-identity refusals → `afl_api_match_identity_refusal`); a provider venue that does not
resolve (`afl_api_venue_unmapped`, I244-F003); a match whose `data_overrides` authority conflicts
at the pre-check (a `corrected`/`new` candidate, `manualAuthorityRefusals`); an unbridged player
(candidate plus `import_rejections`); a corroboration disagreement (`afl_api_settle`); every
Brownlow refusal (`data_issues`, `import_rejections`; I244-F002/F007) and a failed write
(`canonical_apply_failed`). The fixtures-only tool never attempts canonical promotion. Correcting an
identity-bearing field is a separate contract, decided by I244-F010 (next subsection): F009 only
records a refusal.

*Reading it:* `SELECT issue_key, severity, details->>'refusal' AS refusal, description FROM
data_issues WHERE issue_type = 'canonical_apply_failed' AND resolved_at IS NULL AND
details->>'source_key' = 'afl_api' ORDER BY issue_key;`

**Identity-bearing corrections (AFLDB-ISSUE-244 I244-F010).** `matches.match_key` is
`season|round_code|match_date|home club name|away club name` — a **content address**, not a surrogate
id, and three things key on it as text: `data_overrides.entity_key` (human authority), the applier's
own lookup, and every other source's resolver. It is UNIQUE and is never recomputed by a database
trigger. Before F010, a provider correction to the round or date of an `afl_api`-owned match
auto-applied the new column values and left `match_key` rendering the old identity; the next source
to render the corrected identity (AFL Tables, by `match_key`) then missed the row and inserted a
duplicate fixture.

| Field | In `match_key` | Constrained to another column | Treatment on an **existing** row |
|---|---|---|---|
| `season` | yes | — | never proposed; a provider-id hit whose season differs HALTs (`provider_identity_contradiction`) |
| `round_code` | yes | drives the next three | **withheld** |
| `round_number`, `round_type`, `is_final` | no | `matches_round_number_ck`, `matches_is_final_ck` tie them to `round_code` | **withheld with `round_code`**, as one group (writing one alone violates a CHECK) |
| `match_date` | yes | — | **withheld** |
| `home_club_id`, `away_club_id` | yes (as club *names*) | `matches_clubs_differ_ck` | **withheld**; in practice unreachable — a club change on a provider-id hit HALTs first |
| `venue_id`, `venue_raw`, `match_time` | no | — | ordinary auto-apply (F003 governs venue) |
| scores, `result`, `winner_club_id`, `margin`, attendance | no | `matches_margin_ck`, `matches_winner_ck` (derived from scores and clubs only) | ordinary auto-apply |

*The rule.* The AFL API settle never writes an identity-bearing field on an existing row: they are
absent from the proposal the applier is offered (`splitMatchIdentityChange()`,
`automaticApplyTargets()`), **changed or not** — so a concurrent writer moving a field between the
run's read and the applier's re-read cannot be written back with `match_key` behind it. An INSERT
defines the identity and is not split (its `match_key` and columns come from the same bundle; a
collision with an existing key fails the unit's savepoint on `matches_match_key_key` as
`canonical_apply_failed`, never an overwrite or merge). Everything else in the same record —
scores, period scores, venue, kick-off time, player rows — still auto-applies, exactly as the
ISSUE-228 runbook §13.5 requires ("scores and period scores may still auto-apply"). Nothing is
partially applied *within* identity: no state can commit with a new round or date and the old key.

*Why not rekey.* The one rekey the applier supports (`match-rekey.ts`, ISSUE-131) proves the old
identity **retired** from a spine enumeration; the AFL API settle passes `NO_MATCH_REKEY_SCOPE`,
which proves nothing, and its own evidence is a provider id that is never retired. Supporting it
would mean a second retirement proof inside the shared applier, key propagation through the run's
in-memory references, the staging projections and `data_overrides`, and a collision policy — for a
case the runbook makes review-only, and for which no human path exists to apply an accepted
correction (the admin match editor changes attendance, scores, `match_time`, `match_event` and notes
only). Three incompatible `match_key` renderings also exist (ISSUE-182), so "consistent with the
row" has no single meaning for a rekey to target.

| | |
|---|---|
| Where | `data_issues`, `issue_type = 'canonical_apply_failed'`, owner `AFLDB-ISSUE-122`, `source_key = 'afl_api'` — listed with the F009 refusals in the settle report's *Open canonical apply failures* |
| Key | `afl_api\|apply\|match\|<CD_M…>\|matches:identity` — its **own** key, so neither this finding nor the F009 `…\|matches` finding can close the other |
| Reason | `details->>'refusal' = 'identity_change_requires_review'`. `details` carries `fields` (the differing identity fields), `changes` (`{field, canonical, provider}` scalars for those fields only), `canonical_match_key`, `provider_match_key`, `match_id`, `source_version_seq`. No payload, no other proposed value, no error text |
| Severity | `warning` |
| Counters | `canonicalApplyRefusals` +1 per record per run; `dataIssuesOpened` / `Refreshed` / `Resolved` carry the lifecycle. No counter or migration was added |
| Replay | an identical replay refreshes the one open row; a provider that moves to a third identity refreshes the same row with the current evidence |
| Self-heal | closes (`canonical_apply_not_needed`) the run the source and the canonical row agree on identity again — the provider reverted, or the canonical row was corrected under human authority. Checked on every automatic run that resolves the record to an `afl_api`-owned row |
| Human decision | a resolved row is never rewritten; a persisting difference opens one fresh row beside it (the F009 contract) |
| Transaction | the run's own; a dry-run, an F004 refusal and a HALT leave none, and no derived recompute runs for a refused identity |
| Review-first | a run without `--auto-apply` still drafts the whole proposal, identity included, as a `corrected` candidate; the finding is automatic-path only |

*Collision.* The provider-id hit resolves the record to its existing row without consulting the
proposed key, so a proposed identity that already belongs to **another** canonical match changes
nothing: both rows stay byte-identical, nothing is merged or deleted, and the finding's
`provider_match_key` names the other row's key for the operator.

*Ownership and authority.* A foreign-owned row is not an update target (planner: `corroborated`
or `foreign_owned_collision`), an unowned row is refused `ownership_indeterminate` for the rest of
its fields, and manual authority is asked only about fields the applier may write — identity never
reaches it, so it cannot be bypassed. **Correcting an identity is a supervised operator action**
(update the columns and `match_key` together, carrying `data_overrides` — the ISSUE-131 §8 repair
tool's territory); the next settle recognises the repaired row through its provider id and closes
the finding. **Brownlow is unchanged:** an existing non-null `match_id` X that differs from the
resolved Y still refuses the whole vote set (`match_identity_conflict`, F007) and stays
operator-reviewed; F010 does not reassign it.

*Not covered by F010 (recorded, not fixed).* (a) A row `afltables` owns whose date the AFL API
disagrees with is not found by provider id or by `match_key`, so the AFL API inserts a second row
— a cross-source identity disagreement that predates and is independent of F010. (b) Rows on which
an earlier, pre-F010 run already moved a column and left `match_key` behind are not detected;
measure them read-only before relying on the key for such rows.

*Reading it:* `SELECT issue_key, severity, details->'fields' AS fields, details->>'canonical_match_key'
AS canonical, details->>'provider_match_key' AS provider FROM data_issues WHERE issue_type =
'canonical_apply_failed' AND resolved_at IS NULL AND details->>'refusal' =
'identity_change_requires_review' ORDER BY issue_key;`

## 14.4 Database model (migration 103)

Migration 103 is **additive only** — no canonical column or CHECK constraint changes anywhere.
It adds three `staging` tables, each following Decision B (ISSUE-096): *"the jsonb spine never
feeds a promotion; a family with no typed projection cannot be promoted."*

| Table | Grain | Identity | Notable properties |
|---|---|---|---|
| `staging.afl_api_match` | one row per **planned** `match`-family observation (an `afl_api`-owned or new match), fully resolved — **not** one row per provider match | `(source_id, family, external_record_id)`, `family='match'` pinned | **AFLDB-ISSUE-244 I244-F006 contract:** written only when the settle plans the match; a provider match that merely corroborates an existing foreign-owned canonical match (e.g. an `afltables`-owned 2026 home-and-away match) is observed on the spine and counted `corroboratedForeignOwned` but gets **no** row here, by design. Real 2026 evidence (not an invariant): 217 source match heads, 4 rows. Brownlow therefore resolves a corroborated match only via `--use-fixture-identity` (§14.5/§14.9). Carries **both** the `match` family's own facts AND the companion `match_roster` family's period-score/local-time facts — its single `version_seq` FK tracks only the `match` family's own spine version; the period-score columns are joined in by the S6 settle writer, which the schema cannot itself enforce (documented as a known gap in the migration's own header). Attendance is pinned to a single fixed state (`NULL`/`not_collected`/`NULL`) via a CHECK, not merely a non-complete range, because this source never has an attendance-complete branch on any path. |
| `staging.afl_api_player_match` | one row per resolved `player_match_stats` observation | `(source_id, family, external_record_id)`, `external_record_id = <CD_M>\|<CD_T>\|<CD_I>` | No `brownlow_votes`/`brownlow_round_number` columns — Brownlow is a fully separate family and table, never carried on the stat row. `career_game_no` is always NULL (measured: `gamesPlayed` is `null` on every sampled row 2022–2026). Keyed by natural `match_key`, not a `match_id` FK — a canonically rebuilt database has zero 2026 matches, so a hard FK here would make every in-season projection unwritable before the first match promotes. |
| `staging.afl_api_brownlow_vote` | **one row per vote** (explodes the match-grain spine record) | `(source_id, family, external_record_id, provider_player_id)` | Option-B nullable canonical identity (`match_id`/`player_id`/`club_id` all nullable) — the same shape `afl_api_lineup` (077) already establishes: a vote is observed because the provider published it; canonical resolvability is separate enrichment. `club_id` is left NULL throughout (no provider-team-to-club resolution exists in this settle). `canonical_round_number` is `NOT NULL` — a row can only be written once round translation has succeeded. **Populated** by the S7 typed-projection closure (2026-09-20) for every fully-resolved (`planned`) vote set, independent of `--auto-apply`; skipped only under `--observe-only`. |

**Relationship to the observation spine (074).** All three tables carry a `FOREIGN KEY
(source_id, family, external_record_id, version_seq) REFERENCES
staging.source_record_versions(...)` — a typed projection can only ever cite a version that
genuinely exists in the immutable, ordered spine history; a stale or wrong `version_seq` fails
closed at the INSERT rather than silently misattributing provenance.

**Relationship to canonical tables.** None of the three staging tables is a canonical fact
store. They are read-audit / write-input surfaces only: `settle-afl-api.ts` and
`afl-api-brownlow.ts` derive every proposed canonical value from the DB-free bundle/plan, never
by reading these tables back (the same "never trust a projection table for the write itself"
convention `settle-afltables.ts` already establishes for `staging.afltables_match`). The one
place a typed projection **is** read back mid-settle is the attendance-enrichment sweep, which
reads `staging.afltables_match` (not its own table) to find AFL Tables' attendance value.

Grants mirror migrations 076/077 exactly: `afldb_import` gets full DML, `afldb_app` gets
`SELECT` only.

## 14.5 Identity model

**Match identity — resolution order (§6.1 of the runbook, implemented in
`afl-api-match-resolver.ts` `resolveAflApiMatch()`):**

1. **Provider id first.** `matches WHERE source_id = afl_api AND source_record_id = <CD_M>`. A
   hit is canonical regardless of its current `match_key` — this makes an upstream
   date/round/venue correction an exact rekey with no search needed. More than one hit is
   `provider_id_ambiguous` (refused, never picked).
2. **Then `match_key`** (`season|round_code|match_date|home hist|away hist`, rendered identically
   to `import_fitzroy_core.py::match_key_of()` via the shared `renderMatchKey()`). A hit is an
   `afltables`-owned or manually created row for the same real-world match → the co-source path
   (§14.3).
3. **Then the ISSUE-131 retired-identity search** — **deliberately disabled for `afl_api`**
   (`NO_MATCH_REKEY_SCOPE` passed at every call site). A provider id whose own natural key has
   since been retired is out of scope for this stage; steps 1–2 are unaffected. See §14.15.
4. **Otherwise the resolver returns `unresolved` — which means only that no supported identity
   resolution succeeded, not that no canonical fixture exists** (a row another source owns is
   invisible to a provider-id lookup, and a one-component round/date disagreement renders a
   different `match_key`). Before `new_target` is offered the planner (`planMatchFamily()`) asks
   `findPlausibleCanonicalFixtures()` (`match-rekey.ts`, AFLDB-ISSUE-244 I244-F030): is there a
   canonical row of **any owner** with the same season and the same oriented home/away clubs, a
   different `match_key`, and **at most one** of `round_code` / `match_date` differing? That is
   the same predicate the ISSUE-131 search uses (one shared fragment), minus its authority
   requirements. Any hit refuses the INSERT with `possible_existing_match` (an
   `afl_api_match_identity_refusal` finding listing the bounded candidate ids/keys, plus the
   usual `import_rejections` row; no `matches`, period, player or typed-projection write). The
   candidates are diagnostics: **nothing is linked, rekeyed, re-owned or picked**, and there is no
   date window, scoring or venue test. A genuine second meeting differs in **both** round and
   date and is unaffected. The applier repeats the same check inside its savepoint for a
   new-target INSERT (READ COMMITTED makes the planner's read non-binding); the residual window
   between that final SELECT and the INSERT is accepted, because closing it needs a constraint or
   serialisable isolation. A resolved provider record closes its stale identity finding
   (`match_identity_resolved`). Zero hits: `new_target`.

A provider-id hit whose observed `(season, home, away)` differ from the payload is a run-level
**HALT** (`provider_identity_contradiction`) — never a silent rekey.

**Fixture-only identity fallback (S7 follow-up, 2026-09-20).** Brownlow's `bfawards` feed
carries only `matchId`/`roundNumber` — no home/away/date to build a `match_key` from — so
Brownlow resolves a vote's match through the **already-settled** `staging.afl_api_match`
projection when the match family's settle planned that match (an `afl_api`-owned or new match),
never by re-parsing a bundle. A match that only corroborates a foreign-owned canonical match has
**no** typed row by design (§14.4, I244-F006), so those matches resolve only through the fallback
below. When the row does not exist (for that reason, or because the match-family
settle has not yet run for that match), a match-only `--fixtures-only` acquisition
(`acquire-afl-api.ts --fixtures-only`, `settle-afl-api-fixtures.ts`) persists **only** the
`match` family's own spine observation — no `staging.afl_api_match` row, no canonical write, no
promotion candidate — and `resolveAflApiMatchViaFixtureObservation()` resolves a Brownlow vote's
match by re-emitting that observation and matching `(season, home club, away club, exact
venue-local match date)` (never provider round, never `match_key`; corrected 2026-09-22,
ISSUE-244 F021) against existing `matches` rows: 0 candidates → `unknown_match`, exactly 1 → resolved, more than
1 → `fixture_identity_ambiguous` (never guessed). This path is **read-only** by construction —
it cannot write `matches`, so it can never re-own a foreign-owned row or create a duplicate. It
is opt-in only (`--use-fixture-identity` on the Brownlow settle CLI) and is **never enabled
implicitly**. Since I244-F006 the Brownlow CLI measures, from the snapshot's own vote sets and
before any write, how many have no typed row but resolve through the fallback: `--dry-run` /
`--apply` refuse (before any write) when that count is non-zero and the flag is absent;
`--observe-only` logs an advisory; `--validate-only` opens no connection and does not assess it.
The resolver function itself is unchanged for any caller that omits the fallback.

**Team/venue identity.** `CD_T…` → `clubs.legacy_club_hist` through the tracked
`data/reference/afl-api-identities.json` map only (18 clubs); an observed name/abbreviation that
drifts from the map's recorded raw strings refuses (`team_identity_drift`), never resolves by
name. `CD_V…` → `venues.legacy_name`; an unmapped venue is a warning and `venue_id NULL` —
`venue_raw` always carries the real string; no venue row is ever created by this integration.

**Player identity — the `afl_api` provider bridge.** Normal ingestion resolves a `CD_I…` through
exactly one place, `external_identities WHERE source_id = afl_api AND external_id = <CD_I> AND
status IN ('unique','resolved') AND player_id IS NOT NULL` (`resolveAflApiPlayer()`). This is a
**read-only** lookup module — the bridge itself is written exclusively by
`tools/migration/import_afl_api_player_bridge.py`, never by the settle. A miss is
`unresolved_identity` for that one player unit; the match still applies.

**The bridge is a bootstrap/backfill mechanism, not an ingestion step.** It is run on demand by
the operator, not automatically:
- `tools/migration/build_afl_api_player_bridge.py` — offline evidence builder. For each AFL API
  match that resolves to an `afltables`-owned canonical match, it joins each stat row to the
  canonical row at the same club and jumper number and accepts a `CD_I → player_id` link only
  when: the same `player_id` is implied across every observed match for that `CD_I`; that
  `player_id` is claimed by no other `CD_I`; ≥2 matched matches, or one match with ≥10 non-NULL
  agreeing statistics; and normalised-surname agreement (a validation-only check — a failure
  withholds the pair, never resolves it). Reads `afldb_test` read-only; writes nothing to any
  database, only an evidence artefact (`data/reference/afl-api-player-bridge-<date>.json`).
- `tools/migration/import_afl_api_player_bridge.py` — the **only** writer of `afl_api`
  `external_identities` rows: `--validate-only`/`--dry-run`/`--apply`, re-checking **live**
  database state at import time. A new provider id is INSERTed
  (`status='unique'`, `match_method='afl_api_stat_vector_bootstrap'`); an already-linked id to
  the same player is a no-op; an already-linked id to a **different** player is withheld and
  opens a `data_issues` contradiction row — the existing link is never modified. Append-only,
  never a fuzzy or name-based link.
- A companion bootstrap, `data/reference/afl-api-brownlow-name-bridge-2026-09-20.json`
  (`match_method='afl_api_name_team_season_bootstrap'`), covers 61 additional 2025 providers a
  name+team+season match evidences that the stat-vector bridge's narrower 14-sample corpus never
  observed. Both artefacts are read by the same importer's `--bridge` flag (repeatable) via a
  `load_bridges()` identity union: an identical mapping repeated across files is harmless; a
  conflicting mapping refuses, naming both files and both player ids, never silently preferring
  one.

**Debutants / unresolved players.** A `CD_I` the bridge cannot prove stays absent from
`external_identities` — never guessed. A debutant with no `players` row at all is exactly this
case (ISSUE-224, not closed by this integration). Coverage measured on the real 14-sample
backtest corpus: 398/400 providers linked via the stat-vector bridge (99.5%), plus 61/61 via the
name-bridge for the 2025 Brownlow census (188/188 leaderboard players ultimately resolved).

**Why canonical Brownlow votes are not identity evidence.** The bridge accepts a link only from
independently agreeing `player_match_stats` (kicks, marks, etc.), never from a player's vote
history — a vote count carries no statistical fingerprint that could disambiguate one player
from another, and using it would risk circular evidence (resolving identity from the very data
the Brownlow settle is trying to write).

**Manual identity adjudications (historical Brownlow closeout, §14.10).** Three provider ids
required a human decision rather than the deterministic bridge, each recorded in its own
artefact under `data/reference/afl-api-player-adjudication-<season>-<CD_I>.json` and applied via
the same importer/`--bridge` mechanism: `CD_I293854` (2022, "Matt Taberner") →
`players.id 9321` ("Matthew Taberner"); `CD_I1006114` (2023, "Bailey J. Williams") →
`players.id 947` ("Bailey Williams", West Coast — explicitly not the Western Bulldogs namesake,
`players.id 946`); `CD_I1020668` (2024, "Josh Draper") → `players.id 7862`. None of the three
used canonical Brownlow votes as evidence.

## 14.6 Admin / operational controls

Two independent, fail-closed, super-admin-only, DB-backed switches
(`site_settings`, migration 034 — added by the "operational-control gap" pass, 2026-09-21, after
DEV acceptance found no UI control existed and S9 was paused before any real-feed acquisition):

| Setting | Default | Governs |
|---|---|---|
| `acquisition.afl_api_current_season_enabled` | disabled | current-season match/stats acquisition and settle. **No outer environment gate exists for this family** — the DB switch is the whole of "enabled". |
| `acquisition.afl_api_brownlow_enabled` | disabled | one half of Brownlow's two-key gate (below). |

**Read path (`src/lib/acquisition/afl-api-ingestion-control.ts`,
`readAflApiIngestionControls()`).** Opens its **own**, short-lived, single-use `afldb_app`
connection (never `afldb_import`, which migration 045 deliberately denies **any** access to
`site_settings`, "a super admin's runtime choices … not the ETL's business" — widening that
grant would cross a boundary drawn on purpose). **Fails closed unconditionally**: an unset
`DATABASE_URL`, a connection failure, a missing table, or a malformed row all return the same
fully-disabled result as an explicit stored `false` — there is no code path that can produce
`true` from anything but a genuine stored `true`.

**Enforcement.** Every acquisition and settle CLI (`acquire-afl-api.ts`,
`acquire-afl-api-brownlow.ts`, `settle-afl-api.ts`, `settle-afl-api-fixtures.ts`,
`settle-afl-api-brownlow.ts`) checks the switch **itself**, before doing anything network- or
DB-write-capable — so a systemd timer and a direct CLI invocation are bound by exactly the same
switch the admin panel writes. **Read-only paths are deliberately not gated**:
`settle-afl-api.ts --report` and every tool's `--validate-only` run regardless of either switch.

**The Brownlow two-key gate.** `combineAflApiBrownlowGates(deploymentGateEnabled, adminEnabled)`
requires **both**:

```
AFLDB_AFL_API_BROWNLOW_ENABLED === 'true'   (deployment/environment — set in .env, outer, UI-unoverridable)
      AND
acquisition.afl_api_brownlow_enabled        (the new super-admin DB switch, inner)
      =
effectiveEnabled
```

Neither can enable Brownlow ingestion alone. The admin panel **cannot** turn on the deployment
gate — it is set only in `.env` by the operator, deliberately outside the live-count window, and
the UI states this plainly when the deployment gate is off. The panel
(`AflApiIngestionControls.tsx`, rendered on `/admin/current-season`) shows **all three** states
side by side for Brownlow — admin control, deployment gate, effective (AND-ed) result — never a
single collapsed "enabled" that could read as live when the deployment gate is actually closed.

**Capability and audit.** Both toggle actions
(`setAflApiCurrentSeasonIngestionAction`/`setAflApiBrownlowIngestionAction`,
`src/app/admin/current-season/actions.ts`) require the `acquisition.currentSeason` capability
(SUPER_ADMIN_ONLY, `src/lib/auth/capabilities.ts`) and write one `auth_audit_log` row per
attempt, carrying the actor, the unit and the requested state — the existing
`/admin/settings/actions.ts` audit convention, reused rather than reinvented.

## 14.7 Systemd / scheduled operation

**Two independent chains** — deliberately not one, so Brownlow can be enabled/disabled without
touching the match-family timer:

| Chain | Script | Service | Timer | Enable gate |
|---|---|---|---|---|
| Match/stats | `deploy/afldb-settle-afl-api.sh` | `afldb-settle-afl-api.service` | `afldb-settle-afl-api.timer` — nightly 05:00, staggered after the AFL Tables 04:30 timer | the DB switch alone (§14.6); no environment gate |
| Brownlow live count | `deploy/afldb-settle-afl-api-brownlow.sh` | `afldb-settle-afl-api-brownlow.service` | `afldb-settle-afl-api-brownlow.timer` — every 5 minutes, **always enabled** | both keys of the two-key gate (§14.6); the wrapper script no-ops (exit 0) when either is off, so the timer can stay permanently installed without ever reporting a false "failed" unit for the ~11 months the count is not running |

**NOT installed, enabled or started on any host by this work.** The six files above exist in
`deploy/` as approved artefacts for a future DEV/production wiring pass; nothing has been copied
into `/etc/systemd/system`. See `docs/deployment.md` §7d for the full installation procedure,
directory-permission requirements (`ReadWritePaths` scoped to `data/sources/afl_api/` only,
narrower than the fitzRoy chain), and monitoring commands (`journalctl -u afldb-settle-afl-api
-f`, `AFLDB_SETTLE_SUCCESS`/`AFLDB_SETTLE_FAILURE` markers, `systemctl list-timers`).

**Co-source safety.** Both units may run concurrently with `afldb-settle-afltables.service`
without coordination — a corroborated row is never overwritten and never silently re-owned
(§14.3), so no sequencing is required between the two source chains. The Brownlow chain **does**
have a real sequencing dependency on the match-family chain within its own source, documented in
§14.9.

**No on-demand admin "start now" trigger for either unit.** `settle-status.ts`/
`settle-trigger.ts` gained a read-only three-unit status table
(`readSettleUnitTableStatus()`, covering `afltables`/`afl_api`/`afl_api_brownlow`) but the
existing Super Admin "start now" button and its polkit rule remain `afltables`-only — extending
it is a disclosed follow-up (a genuine admin-authorization-surface change), not an ops-wiring
gap. Until then, a supervised run starts the same way the timer would, by hand
(`systemctl start --no-block afldb-settle-afl-api[.brownlow].service`).

**Timers do not themselves grant permission to ingest.** Installing and enabling a timer is a
necessary but not sufficient condition — the CLI it invokes still checks the DB switch (and, for
Brownlow, the environment gate too) on every single invocation, timer-triggered or manual.

## 14.8 Manual match-family operation — verified command reference

Flags below are read directly from each CLI's own `KNOWN_FLAGS` set; nothing here is invented.
The DB-backed super-admin switch (§14.6) is a prerequisite for every DB-write-capable command
below — a disabled switch causes the CLI to refuse before opening a connection.

**READ ONLY** (no network, no DB connection):
```
npm run settle:afl-api -- --label <label> --validate-only
npm run settle:afl-api -- --label <label> --report
npm run settle:afl-api-brownlow -- --label <label> --validate-only
```

**NETWORK / FILE-WRITING** (acquires from the real host or a configured override; writes only
under `data/sources/afl_api/`; no database contact):
```
npm run acquire:afl-api -- --season 2026 [--status CONCLUDED] [--since YYYY-MM-DD] [--match CD_M...] [--fixtures-only]
npm run acquire:afl-api-brownlow -- --season 2026
```
Each acquisition tool prints its own generated snapshot label on stdout
(`label afl-api-2026-<timestamp>[-N]`); labels are collision-safe and never hand-typed by a
reliable operator flow — extract them dynamically (the pattern
`docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md` §3.2/§3.3 uses) rather than
guessing a value.

**DB WRITE-CAPABLE** (opens `AFLDB_IMPORT_DATABASE_URL`; `--dry-run` still writes then rolls
back inside one transaction — never confuse "opens a connection" with "commits"):
```
npm run settle:afl-api -- --label <label> --dry-run --auto-apply
npm run settle:afl-api -- --label <label> --apply [--auto-apply] [--require-complete-source]
npm run settle:afl-api-fixtures -- --label <fixtures-only-label> --dry-run | --apply
npm run settle:afl-api-brownlow -- --label <label> --observe-only --apply
npm run settle:afl-api-brownlow -- --label <label> --dry-run --auto-apply
npm run settle:afl-api-brownlow -- --label <label> --apply --auto-apply [--use-fixture-identity]
python tools/migration/build_afl_api_player_bridge.py --validate-only | --write
python tools/migration/import_afl_api_player_bridge.py --bridge <artefact.json> [--bridge <artefact2.json>] --validate-only | --dry-run | --apply
```

`--auto-apply` is the automatic-canonical-write switch throughout: `--apply` alone persists
observations and typed projections only (staging), never a `matches`/`brownlow_round_votes` row.
The Brownlow CLI's `--allow-completed-season-backtest` flag is reserved for the completed-season
historical backtest (§14.10) and refuses outright unless the live connection's own
`current_database()` is exactly `afldb_test` — it must never be used for the live 2026 count
(§14.11 explicitly says so).

**No credential appears in any command above.** The WMCTok token is fetched at run time and held
in memory only.

## 14.9 Brownlow pipeline

```
AFL Brownlow API (bfawards/season + bfawards/leaderboard)
  -> acquisition (acquire-afl-api-brownlow.ts)
  -> immutable snapshot (data/sources/afl_api/brownlow/<label>/)
  -> S3 emitter validation (afl-api-bundle.ts): exactly 3 rows, values {3,2,1}, sum 6, no duplicate player/match — per match, all-or-none
  -> spine observation (persistSourceObservation, one record per match's whole vote set)
  -> match resolution (staged staging.afl_api_match projection, or the fixture-only fallback)
  -> player resolution (the trusted bridge, §14.5)
  -> round translation (translateAflApiBrownlowRound, defensive non-H&A refusal)
  -> canonical write (applyCanonicalUnit() x3 inside one extra savepoint — see below)
  -> typed projection (staging.afl_api_brownlow_vote, one row per vote)
  -> leaderboard reconciliation (advisory while LIVE, blocking once CONCLUDED)
```

**Vote-set shape, validated twice.** The emitter (`emitAflApiBrownlowMatchVotes()`) throws
before persistence on any malformed set; a structural CHECK on
`staging.afl_api_brownlow_vote.votes IN (1,2,3)` is a backstop, not the primary enforcement. An
empty `matchVotes[]`/`leaderboard[]` (the pre-count publication state) is explicitly valid, not
malformed — the registry's column gate has an opt-out for collection-grain families precisely so
a legitimate zero-record publication is never refused as if the source were broken.

**H&A vote handling and finals exclusion.** The feed never publishes finals vote records in
practice; AFLDB additionally refuses defensively, twice over: round translation rejects any
non-home-and-away round, and the resolved canonical match's own `is_final` is checked
independently. Neither path is reachable from the real feed as currently observed, but neither
is removed on that basis — this is the "belt and braces" pattern the codebase uses throughout.

**Match-grain atomicity, not player-grain.** `brownlow_round_votes` is keyed
`(season, player_id, round_number)` — player-grain, not match-grain — but §10's contract is "a
match's vote set is one unit, all-or-none". `applyAflApiBrownlowVoteSet()` therefore wraps its
three `applyCanonicalUnit()` calls in **one extra `tx.savepoint()` layer**: any of the three
landing on anything other than `applied` or the idempotent `nothing_to_write` refusal throws,
rolling the **whole set** back. This is enforced structurally, proven by a dedicated regression
test that deletes one of three already-staged projection rows and asserts the other two's
canonical writes never land either.

**Correction rules.** An `afl_api`-owned vote row's changed value auto-applies as an ordinary
UPDATE through the existing E3/E5 gates — no special-case code exists or was needed. A
foreign-owned `brownlow_round_votes` row (e.g. already `afltables`-owned) refuses — and because
the refusal happens inside the vote-set savepoint, it refuses the **whole match's set**, not
just that one player. §10 does not extend Q1's match-family corroboration exception to this
target, so no corroboration path exists for Brownlow votes: a foreign-owned vote row is always a
hard refusal, never an advisory disagreement.

**Round-reschedule correction (a real, disclosed fix, 2026-09-20).** `brownlow_round_votes
.round_number` is written from the **resolved canonical match's own `round_number`** — read
fresh from `matches` — **never** from `translateAflApiBrownlowRound()`'s translated provider
round. The two differ only for a genuinely rescheduled/postponed fixture (measured: two 2025
Gold Coast matches, one an Opening Round fixture actually played in Round 24's week); a
fixture's `round_number` is a stable identity fact a reschedule (which only ever moves
date/time) never touches, while the Brownlow feed groups a postponed match's votes under
whichever calendar week it was actually played. Both values are surfaced in the run's counters
(`voteSetsRescheduledRound`) so every such case is observable, never silently folded into the
ordinary count.

**AFL API ownership restriction / foreign-owned protection.** Identical in spirit to the match
family: `applyCanonicalUnit()`'s own E3 gate refuses a foreign-owned `brownlow_round_votes` row
exactly as it would for any other target, re-read inside the savepoint at write time.

**LIVE vs. CONCLUDED, and the leaderboard.** `reconcileAflApiBrownlowSeason()` reconstructs each
player's season total from the observed match votes and compares it against the leaderboard
feed's own `totalVotes`. The comparison's severity is keyed on the leaderboard feed's **own**
`status` field, a straight passthrough with no AFLDB-side derivation: mismatches are
**advisory** while `status !== 'CONCLUDED'` (expected while votes are still being revealed) and
**blocking** once `status === 'CONCLUDED'`. **The leaderboard is never promoted as canonical
vote data** — `brownlow_leaderboard`'s `promotion_policy` is `'never'` in the registry, and no
typed projection exists for it; it is purely a reconciliation witness and (at rollover, §14.15)
an artefact-builder input.

**Replay/idempotency.** No special-case code: `persistSourceObservation()`'s own head-touch
behaviour and `applyCanonicalUnit()`'s own baseline-hash comparison already compose to a total
no-op on a byte-identical or logically-unchanged re-poll — proven by a dedicated integration
test (`voteSetsNoOp`).

**Match-family prerequisite, ordering (corrected, AFLDB-ISSUE-244 I244-F006).** A Brownlow vote
set for a match refuses `unknown_match` until Brownlow can identify that match: through a typed
`staging.afl_api_match` row (written by `settle-afl-api.ts` **only for a match it plans** — an
`afl_api`-owned or new one) or, with `--use-fixture-identity`, through that match's match-family
observation resolved against the existing canonical `matches` row. `settle-afl-api.ts --apply`
(without `--auto-apply`) persists those observations for every acquired match but does **not**
stage a typed row for a match that only corroborates a foreign-owned canonical match, so it does
not by itself make a corroborated match resolvable without `--use-fixture-identity`. The safe
sequence for a season is: acquire+settle the match family first, then run the Brownlow chain
**with `--use-fixture-identity` whenever the snapshot contains matches owned by another source**
(for the real 2026 home-and-away matches, under the current data state, it does). A write-capable
Brownlow run that needs the fallback and lacks the flag refuses before any write, naming the
count, a sample of provider match ids and the flag. The CLI's `unknown_match` hint is printed
whenever `voteSetsRefused.unknown_match > 0`.

**Operational enablement.** Independently enable/disableable from the match-family settle
(§14.6/§14.7), defaults to disabled outside the live-count period, supports an `--observe-only`
mode (fetch/parse/validate/log/persist-spine-only, no canonical write attempt regardless of
`--apply`/`--auto-apply`) and a simulator redirect (§14.1). §10's operator instruction — exercise
end-to-end against the local simulator in both `--observe-only` and apply mode before ever
pointing at the live endpoint — is the basis for the detailed one-off procedure in
`docs/acquisition/AFLDB-2026-BROWNLOW-LIVE-COUNT-RUNBOOK.md`, which this section links to rather
than duplicates (see that document for the exact PowerShell preflight, positive database-target
verification, and ordered operator commands for the live count).

## 14.10 Historical Brownlow validation

**Role.** Proves the whole pipeline — match resolution, player resolution, round translation,
vote-set validation, canonical write, and leaderboard reconciliation — against **real, already-
concluded** AFL.com.au Brownlow feeds for 2022–2025, independent of and prior to the live 2026
count. This is backtest evidence, not a substitute for the live-count acceptance item (§14.11).

**Mechanism.** The completed-season backtest authority
(`requireAflApiBrownlowBacktestDatabase()` + `--allow-completed-season-backtest`) narrows
**exactly one** gate — `canonical-apply.ts`'s E2 (`season_not_in_progress`) — for the Brownlow
vote write only, and only after a **live** `SELECT current_database()` proves the connection is
`afldb_test`; any other database name is refused before any write is attempted, regardless of
DSN or hostname. Every other gate (identity, ownership, atomicity, round translation, finals
exclusion) is completely untouched by this authority.

**Result (operator-proven COMPLETE, 2026-09-21), every season 2022–2025:**

| Season | Vote sets | Positive vote rows | Provider identities trusted | Exact canonical equality | Mismatches / drift / failures |
|---|---|---|---|---|---|
| 2022 | 198 | 594 | 207/207 | 594/594 | 0 across every counter |
| 2023 | 207 | 621 | 201/201 | 621/621 | 0 across every counter |
| 2024 | 207 | 621 | 196/196 | 621/621 | 0 across every counter |
| 2025 | 207 | 621 | 188/188 | 621/621 | 0 across every counter |

The historical fixture-observation prerequisite (the real AFL fixture feed persisted ahead of
the census) is likewise satisfied for 2022–2024 (203/212/212 of 207/216/216 feed matches
observed; the shortfall in each season is exactly the four `finals_label_required` records
discussed in §14.2, which sit outside the H&A Brownlow population and produced zero Brownlow
match-resolution failures).

**Model.** Real archived AFL feeds → canonical match resolution (provider-id-first) → trusted
player identity resolution (the bridge, §14.5, plus three manual adjudications where the
deterministic bridge could not decide) → per-season vote-set/vote-value/round equality against
the canonical `brownlow_round_votes` table already loaded from the legacy AFL Tables path →
explicit disposition of any mismatch, never a silent pass.

**Distinct from the still-required 2026 live evidence.** This closeout proves the pipeline is
*correct* against completed data. It does **not** prove genuine LIVE→CONCLUDED transition
behaviour or genuine mid-count correction handling — those can only be observed during an
actual live count, which is §14.11's remaining item.

## 14.11 2026 Brownlow live acceptance — what remains required

**Status: OPEN.** The real 2026 live-count capture/replay requirement has not yet occurred.
Nothing in §14.10's historical closeout substitutes for it.

**If genuine live-count captures are obtained** (the intended path — see the live-count runbook
for the exact procedure): capture/replay the LIVE state, observe the transition to CONCLUDED,
handle any genuine mid-count correction the real feed issues, and reconcile the final
leaderboard. This is the only way to prove:
- genuine LIVE → CONCLUDED transition behaviour;
- genuine mid-count correction behaviour.

**If only the final post-count feed is captured**, that evidence can still prove: real final-feed
acquisition, vote-set validation, match/player resolution, canonical settle, equality/
reconciliation, and replay/idempotency — **but it cannot prove** the two live-transition items
above. §14.10's historical seasons already prove the completed-season path exhaustively; a
final-only 2026 capture would be additional confirmation, not new evidence for those two items.
**This distinction must not be overclaimed** in any future closeout of ISSUE-228.

**Explicitly forbidden for this acceptance item:** `--allow-completed-season-backtest` — that
flag exists for the historical backtest (§14.10) against `afldb_test` only, and using it for
2026's in-progress season would be the wrong authority path entirely (it deliberately requires
`current_database() = 'afldb_test'`, so it cannot reach DEV or PROD, but it is still the wrong
tool for a genuinely in-progress season).

**Separate from Assertion 9.** Even a fully clean 2026 live-count capture does **not** close
Assertion 9 (§14.15) — that is match-family semantic-hash evidence, a distinct requirement.

## 14.12 Safety / failure model

**Fail-closed protections, by category:**

- **Ingestion enable settings** (§14.6): DB-switch failure of any kind = disabled, never enabled
  by default or by ambiguity.
- **Brownlow dual gate** (§14.6): both keys required; the admin UI structurally cannot set the
  deployment key.
- **Real-host override clearing**: the live-count runbook positively verifies all three base-URL
  overrides are absent before any real-feed acquisition — never assumed cleared by convention.
- **Database-target verification**: the completed-season backtest authority (§14.10) and the
  live-count runbook's preflight both use a **live** `SELECT current_database()` probe against
  the connection that will perform the write, never a DSN string or hostname guess.
- **Manifest hash verification**: every settle CLI re-hashes its snapshot's manifest before
  opening any database connection (`--validate-only` proves this without ever connecting).
- **Acquisition-kind / source-key checks**: `settle-afl-api.ts` refuses a manifest whose
  `acquisition_kind` names the fixtures-only mode (`afl_api_fixture_snapshot`) with a clear
  pointer to the correct tool, rather than an opaque downstream failure.
- **Round vocabulary**: a season with no declared table is a run-level HALT before any DB
  connection, never a per-record guess.
- **Identity contradictions**: a provider id whose observed identity contradicts its already-
  canonicalised identity is a run-level HALT, rolling back the whole batch — never a partial
  commit.
- **Rekey collision**: the ISSUE-131 retired-identity search is disabled for `afl_api`
  end-to-end (§14.5/§14.15) — a narrower, not a weaker, resolution path.
- **Manual authority**: an active `data_overrides` row always wins over an automatic proposal,
  re-checked inside the write savepoint, on both the ordinary write path and the attendance
  enrichment path.
- **Canonical ownership**: `autoApplyOwnership()`'s E3 gate is never weakened by the co-source
  exception (§14.3) — corroboration is checked strictly after E3's own verdict.
- **Data override checks**: E4, re-read inside every savepoint.
- **Transaction behaviour / savepoints**: every canonical write attempt is isolated to its own
  savepoint (`applyCanonicalUnit()`); a write failure there is caught, logged as
  `canonical_apply_failed`, and never aborts the surrounding batch or any other unit.
- **Dry-run rollback**: `--dry-run` executes the complete write path against real
  constraints/privileges, then unconditionally rolls back — proving the path is genuinely
  write-capable without committing anything.
- **Import-batch lifecycle** (§14.3, I244-F008): a committed run's batch is closed
  (`completed`, `completed_at`, counters) inside the same transaction; a run that rolls back
  leaves no batch, so `status = 'running'` means a crashed process, not a finished run.
- **Automatic-apply refusals** (§14.3, I244-F009): a target the applier refuses without rolling
  back is never silent — one durable `canonical_apply_failed` finding per target with the machine
  reason, refreshed on replay, closed when the target applies or no longer differs, and rolled
  back with the run on a dry-run, an F004 refusal or a HALT.
- **Identity-bearing corrections** (§14.3, I244-F010): the AFL API settle never writes a round,
  date, club or season field on an existing `matches` row, so `match_key` can never be left
  rendering an identity the row no longer has. The difference is one durable finding
  (`…|matches:identity`), refreshed on replay and closed when the sides agree again; the rest of the
  record still applies.
- **Source completeness**: `recordsDeferred` (POSTGAME/pre-CONCLUDED matches) are excluded from
  `snapshotRejections` and from every completeness verdict — a season whose only non-applied
  records are legitimately not-yet-concluded reports `complete` and exits 0; a genuine gate
  failure on an already-CONCLUDED match still turns `--require-complete-source` red.
- **Brownlow invariants**: the whole-set savepoint (§14.9) makes "no partial 3/2/1 vote rows" a
  structural property, not a convention.
- **Replay/idempotency**: proven by dedicated tests across every family, not merely asserted.

**HALT vs. successful-but-incomplete — the distinction that matters for reading a run's
result:**

- **HALT** (`AflApiSettleHalt`/`AflApiBrownlowSettleHalt`): the whole batch rolls back, nothing
  is committed, exit non-zero. Reserved for run-level contradictions (identity contradiction,
  missing round vocabulary, a season enumeration shrinking past tolerance) — never for an
  ordinary per-unit refusal.
- **Successful-but-incomplete settle**: the batch commits; some units applied, some are
  `unresolved_identity`/`foreign_owned_collision`/deferred/refused and are visible as
  `promotion_candidates` rows, `data_issues` rows, or run counters. This is the **expected**
  shape of most real runs (an unbridged debutant, a POSTGAME match, a corroborating co-source
  observation) — it is not a failure, and a non-green acceptance-checklist counter here is not
  automatically a defect. §14.14 names which counters are expected to be zero.

## 14.13 Real source-to-source reconciliation

**Corrected here** against an earlier plan-stage assumption (see `issues.md`'s
"operational-control gap" paragraph, 2026-09-21, for the full audit): **`afltables_owned +
afl_api_owned = total` (the R1–R28-style ownership count) proves canonical ownership
partitioning only. It is not source-to-source reconciliation** — it says nothing about whether
the two sources' *values* agree for any given fact.

**The actual comparison evidence that exists:** whenever a co-source observes a row it does not
own, `classifyCorroboration()` compares the observed values against the canonical ones
(`CORROBORATED_MATCH_FIELDS` for the match family — scores; `match_time` is deliberately
excluded from this comparison per R8's known vocabulary-mismatch risk) and the outcome is
counted (`corroboratedForeignOwned`) and, on disagreement, surfaced as an advisory
`data_issues` row (`issue_type = 'afl_api_settle'` for `afl_api`'s own settle,
`'afl_api_brownlow_settle'` for Brownlow), resolved automatically once a later poll agrees. This
is the **entire** cross-source comparison surface — there is no separate score/stat
"reconciliation report" beyond `settle-report.ts`'s disagreement counters and this
`data_issues` trail.

**Coverage, stated plainly:**

| Fact class | Compared between sources? |
|---|---|
| Match scores (`home_score`/`away_score`) | **Yes** — `classifyCorroboration()` on every corroboration encounter |
| Match result/margin | derived from scores, not separately compared |
| Period scores | **No** — not part of `CORROBORATED_MATCH_FIELDS`; not separately reconciled |
| Player match statistics | **No routine reconciliation** — the S5/S5b player-identity bridge compares stat vectors as *identity evidence* (§14.5), but that is a one-time linking exercise, not an ongoing source-disagreement surface like the match family's. A row `afltables` owns that differs from `afl_api`'s proposal is, since I244-F009, *recorded* as a `foreign_source_owner` refusal finding (§14.3) — a durable trace of the disagreement, not a comparison of every stat between the sources |
| Brownlow votes | **Yes**, but against the leaderboard feed (the same source's own aggregate), not against AFL Tables — see §14.9; AFL Tables carries no separate live Brownlow feed to reconcile against in-season |

**Do not claim a stat is "reconciled" unless it appears in the table above as compared.** The
implementation genuinely compares match-level scores between the two sources; it does not
compare quarter-by-quarter period scores or individual player statistics between `afltables` and
`afl_api` on an ongoing basis.

## 14.14 Acceptance / success criteria — how an operator knows a run succeeded

**Match-family settle (`settle-afl-api.ts`), typical counters and how to read them:**

| Counter | Expected to be zero? | What a non-zero value means |
|---|---|---|
| `buildFailures` | Usually yes, per snapshot | A record's payload violated a hard contract (bad round vocabulary, malformed shape) — inspect the named provider match id |
| `voidsHalted` / HALT thrown at all | Always, for a healthy run | A run-level contradiction; nothing committed |
| `recordsDeferred.status_not_concluded` / `.roster_not_concluded` | **No** — legitimately non-zero whenever the snapshot includes a POSTGAME/pre-CONCLUDED match | Informational, not a defect |
| `corroboratedForeignOwned` | **No** — expected whenever the snapshot overlaps `afltables`-owned matches | Confirms co-source corroboration is running, not an error |
| `unresolvedIdentityMatch` | **No**, but should track the bridge's known unresolved list | An unbridged/debutant player; the match still applies |
| `canonicalApplyFailures` | Yes, for a healthy run | A write genuinely failed inside its savepoint; check the paired `canonical_apply_failed` `data_issues` row |
| `canonicalApplyRefusals` | **No** — expected whenever `afltables` owns a row `afl_api` disagrees with | A target was declined without rolling back (it also counts `nothing_to_write`). Each real refusal has one open `canonical_apply_failed` finding whose `details->>'refusal'` names the reason (§14.3, I244-F009); `dataIssuesOpened`/`Refreshed`/`Resolved` count its lifecycle. A withheld identity-bearing correction (I244-F010, `identity_change_requires_review`) also counts here, once per record per run |
| `attendanceEnrichmentsApplied` | **No** — non-zero whenever an `afltables`-owned attendance value newly fills an `afl_api`-owned match's gap | Expected, not a defect |
| a rerun's `canonicalRowsInserted`/`Updated` | Yes, for an identical replay | Confirms idempotency |

**Brownlow settle, typical counters:** `voteSetsSeen` should equal the snapshot's published vote
sets; `voteSetsRefused` (by reason) should be explainable (`unknown_match` when neither the typed
staging row nor — with `--use-fixture-identity` — the fixture path identifies the match, e.g.
before the match-family prerequisite has run; or a genuinely unresolved player); `voteSetsApplyFailed`
should be zero for a healthy run; `voteSetsNoOp` non-zero on a replay is expected;
`voteSetsRescheduledRound` non-zero is informational, not a defect (§14.9);
`leaderboardMismatches` non-zero is advisory while `LIVE`, must be zero (or explicitly
investigated) once `CONCLUDED`.

**Bridge (S5/S5b).** `linked`/`already_linked`/`contradictions_withheld` from the importer's
`--validate-only`/`--dry-run`/`--apply` output; a post-apply `--dry-run` should reproduce
`already_linked` for the full linked set and `contradictions_withheld: 0` — that reproduction
**is** the idempotency proof for the bridge.

**Source completeness.** A run whose only non-applied records are legitimately deferred reports
`complete` and exits 0; `--require-complete-source` turning red on a genuine gate failure
(rejected, not deferred, record) is the correct, expected behaviour, not a bug to route around.

## 14.15 Known limitations / open work

- **Unresolved/debutant identities**: 2 stat-vector-bridge-unresolved providers remain
  deliberately withheld (`CD_I1002231`/Patrick Naish, `CD_I999724`/Declan Mountford,
  `no_matching_evidence`) — not resolved by name, not closed by this integration. ISSUE-224
  (unregistered 2026 debutants) is a separate, still-open issue.
- **Current stat coverage**: `career_game_no` and `brownlow_votes` are never sourced by this
  integration on the `player_match_stats` row (both NULL, matching the AFL Tables in-season
  convention); the 21 measured-but-unstored `extendedStats`/percentage/efficiency fields
  (§4.2/§14.2) are retained in the raw payload but never projected.
- **Source-comparison coverage** (§14.13): match scores only — period scores and player
  statistics are not reconciled between `afltables` and `afl_api` on an ongoing basis. This is
  an accepted observability/provenance-breadth limit, not a canonical-write safety gap
  (ISSUE-244 F014, CLOSED / PASS).
- **No immediate ISR revalidation after an `afl_api` apply** (ISSUE-244 F013, CLOSED / ACCEPTED):
  the `afl_api` settle does not call `revalidateSeason()`, so a season page can stay stale for up
  to the one-hour ISR window after an `afl_api`-only write. Bounded, no canonical-data effect;
  an AFL Tables write may revalidate the same surface earlier, and the ISSUE-228 S9 DEV smoke
  covers `/seasons/2026`.
- **Scheduled chain may commit nothing until ISSUE-224 + S9** (ISSUE-244 F017, CLOSED / DEFERRED
  TO ISSUE-224): the nightly `afl_api` unit runs `--apply --auto-apply --require-complete-source`,
  and the F004 pre-commit refusal means an incomplete source refuses before commit. Until ISSUE-224
  registers the required 2026 debutants and the snapshot is re-settled under ISSUE-228 S9, the
  scheduled `afl_api` chain may commit nothing. **Route A (operator, 2026-09-22):** S9 acceptance
  goes through this guarded path — ISSUE-224 registers the 92 unresolved providers, the bridge is
  rebuilt/re-resolved on the same immutable snapshot, and the re-settle must reach
  `unresolvedIdentityPlayer = 0`. Removing `--require-complete-source` to force a partial-player
  apply is **not** the S9 acceptance route (the ability itself is unchanged). Timer
  installation/enablement is separately authorised work.
- **Finals/round quirks**: the 2025 `metadata.prematch_label` vs. `metadata.finals_match_label`
  divergence (§14.2) leaves four 2025 fixture-only records refusing
  `finals_label_required`; not fixed by this documentation pass. 2022–2024 finals cannot be
  split `QF`/`EF` from the feed at all (no label of either kind published) — an accepted,
  asserted-not-guessed backtest limitation, not a bug.
- **Attendance direction**: see §14.3 — `afl_api` never sources attendance; the one enrichment
  direction is `afltables` attendance into an `afl_api`-owned match. Do not document the
  opposite direction.
- **Brownlow live-transition evidence**: open — see §14.11.
- **Assertion 9** (§9.9/§19.5 of the frozen plan; match-family semantic-hash evidence over a
  second genuine monitor-capture pair of `CD_M20260142801`): **SKIPPED, explicitly, not
  silently.** Only one formal capture pair exists on disk in the layout the backtest reads. It
  is distinct from, and not closed by, any Brownlow evidence (historical or live). Before
  ISSUE-228's final closeout it must be either proven (a genuine second capture), reconstructed
  from an already-existing manual second capture if its bytes are inspectable, or explicitly
  recorded as a permitted SKIP in the backtest manifest with reasoning — not left an
  undocumented gap.
- **Systemd timers**: implemented, tested (`sh -n`), **not installed or enabled** on any host
  (§14.7).
- **DEV vs. PROD**: deployed to DEV (migration 103 applied, health/smoke PASS); **no timer
  enabled, neither ingestion switch enabled**; PROD entirely untouched. S9 (real-feed DEV
  validation) is **implemented / not accepted — partially executed** (reconciled 2026-09-22; see
  the §14.0 status table, "Status, as of 2026-09-21" — its S9 row carries the 2026-09-22 reconciliation), blocked on ISSUE-224 registration of the unresolved 2026 players.
- **ISSUE-131 retired-identity rekey search**: disabled end-to-end for `afl_api`
  (`NO_MATCH_REKEY_SCOPE`) — provider-id-first and `match_key` resolution are unaffected; only
  the narrow case of an `afl_api` row whose own provider id was never linked and whose natural
  key has since been retired is out of scope.
- **`match`-family absence sweep**: no implementation exists — it needs a season-enumeration-
  completeness concept the current `AflApiSettleBundle` does not carry (unlike AFL Tables'
  `SettleBundle.enumerations`). A match that silently leaves the season feed is not currently
  detected as absent by this source (AFL Tables' own settle, where applicable, is unaffected).
- **Tracked manifest gap**: unlike the fitzRoy chain, neither `acquire-afl-api.ts` nor
  `acquire-afl-api-brownlow.ts` copies its manifest into a tracked
  `docs/rebuild-manifests/afl_api/<label>.json` — only the untracked per-run `manifest.json`
  beside the raw payloads exists today.
- **No on-demand admin trigger** for the two new systemd units (§14.7) — a disclosed, deliberate
  scope cut, not an oversight.
- **Fixture ingestion proper** (pre-match `SCHEDULED`/`LIVE` status → the `fixtures` table) is a
  **successor issue** (`AFLDB-ISSUE-229` recommended in the frozen plan, not yet created) —
  ISSUE-228 stops at "observe every status; promote `CONCLUDED`".
