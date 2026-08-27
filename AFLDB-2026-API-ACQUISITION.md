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

---

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

| Piece | File | Reality |
|---|---|---|
| Source registry | `src/db/migrations/063_external_current_match_sources.sql:10-19` | `squiggle_api`, `kali_afl_stats` registered as `upstream_dataset` |
| Raw snapshot | same, `:21-63` | `staging.external_current_matches`, PK `(source_id, external_game_id)`, `raw_payload jsonb`, `fetched_at`/`last_seen_at`, score-component CHECK constraints |
| Match provenance | `064_matches_external_provenance.sql` | `add_provenance_columns('matches')` → `source_id`, `source_record_id`, `import_batch_id` |
| API clients | `src/lib/external-afl/current-matches.ts` | Squiggle `?q=teams` + `?q=games`; Kali `GET /matches?year=&limit=200` with `Authorization: Bearer` |
| Orchestration | `src/lib/external-afl/current-season-import.ts` | fetch → resolve club → resolve local match → upsert staging → optional canonical update/insert, all inside one `sql.begin` |
| CLI | `tools/current-season/update-current-season.ts` | `npm run current-season:update`, dry-run default, `--apply`, `--insert-missing-matches`, `--update-matches`, `--report` |
| Admin | `src/app/admin/current-season/{page,actions}.tsx` | super-admin only, audited, `mode=auto` ⇒ Kali + apply + insert-missing |
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
| Lineups / team announcements / late changes / subs | AFL API `fetch_lineup_afl` | — | **new** `staging.external_lineups` | `providerId` / `teamId` / `player.playerId` **[PROBE P3]** | Stage auto; **never promoted** **[DECISION]** | Only free lineup source found. Unofficial endpoint. Column set is **not stable across rounds** (19 vs 20); **no substitute field exists** — `EMERG`/`INT` are positions. |
| Ladder / team-season | **owned by `AFLDB-ISSUE-095`** — see §6 | Squiggle `q=standings` (all 15 fields **[PROBE]**); AFL Tables season ladder; `fetch_ladder_afl` | `club_seasons` | — | Reviewed | Do **not** pre-empt ISSUE-095's D1–D7. This document supplies source evidence only. |
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

| Phase | Job | Source | Writes | Cadence |
|---|---|---|---|---|
| Preseason (Nov–Feb) | roster refresh | AFL API player details | staging → **reviewed** new players | weekly |
| Fixture release | fixture load | AFL API fixture + Squiggle games | `staging.external_fixtures` only | on release, then weekly |
| Team announcement (T−48 h → T−1 h) | lineup capture | `fetch_lineup_afl` | `staging.external_lineups` only | 2×/day match week |
| Match day | completion watch | Squiggle `complete` / `timestr` | **nothing** | ≤ hourly during matches (respect Standard-API guidance) |
| Post-match (T+2 h) | provisional score | Squiggle | staging only | per match |
| Overnight settle (T+12–24 h) | **AFL Tables settle pass** | `acquire_core.R --from 2026 --to 2026` (partial snapshot + SHA-256 manifest) → import | staging → **reviewed** `matches`, `match_period_scores`, `attendance`, `player_match_stats`, `brownlow_round_votes` | nightly in season |
| End of round | ladder + diff report | per `AFLDB-ISSUE-095` | staging → **reviewed** `club_seasons` | weekly |
| End of home-and-away | final ladder, finals qualification | as above | reviewed | once |
| Finals | as per round | — | reviewed | weekly |
| Post-Grand Final | premier / wooden spoon / `seasons.status` | derived from matches (existing SQL semantics) | reviewed | once |
| Awards period (Sep–Oct) | Brownlow votes via settle pass; **everything else manual** | AFL Tables; no API for the rest | reviewed | once |
| Draft (Nov–Dec) | DraftGuru re-acquisition | existing path | reviewed | once |
| **Rollover (Dec–Feb)** | **season promotion [DECISION]** — re-acquire the completed season through the standard full-history path, extend `data/reference/fitzroy-accepted-baselines.json`, supersede in-season provenance, advance `seasons.json.in_progress_seasons`, re-point the Stage-9 `matches_after_accepted_last_season` gate | fitzRoy full-history | reviewed, gated | once per season |

---

## 6. Interaction with `AFLDB-ISSUE-095` — coordinate, do not absorb

ISSUE-095 owns the ladder/team-season domain and its D1–D7 decisions are **open and not
pre-empted here**. This investigation contributes evidence only:

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
- **Blocking note:** ISSUE-095 §6 records that `recomputeClubSeasons` fails closed on an empty
  `staging.team_seasons`, so on a canonically rebuilt database **every** match create/delete/
  score-edit throws. Any 2026+ promotion writing `matches` will hit this. The API work must not
  "fix" it by weakening the guard.
- **Do not add a `club_seasons` Stage-9 gate** until ISSUE-095 lands.

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
   (19 at R25, 20 at R20) — observed, not diagnosed.
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
   as observed; whether the field is unpopulated or genuinely false was not diagnosed (§13.3).

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

The full contract these feed into is `AFLDB-ISSUE-096.md`.
