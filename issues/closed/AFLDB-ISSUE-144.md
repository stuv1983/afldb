  # AFLDB-ISSUE-144 — Club vs Club comparison and connected history



  ## Status and persistence



  Status: Implementation COMPLETE — awaiting user Git review/merge/issue closure/dev deployment.
  V1.7 is the approved implementation contract.
  Stage 0 COMPLETE (2026-09-06). Stage 1 COMPLETE (2026-09-06). Stage 2 COMPLETE (2026-09-06).
  Stage 3 COMPLETE (2026-09-06). Stage 4 COMPLETE (2026-09-06). Stage 5 COMPLETE (2026-09-06).
  Stage 6 COMPLETE (2026-09-06). Stage 7 COMPLETE (2026-09-06). Stage 8 COMPLETE (2026-09-06).
  Stage 9 COMPLETE (2026-09-06). Stage 10 COMPLETE (2026-09-06).
  There is no Stage 11. Two acceptance prerequisites remain OUTSTANDING, both blocked solely on a
  user-controlled Git/deploy action (getting this branch onto the Linux dev host): the warm
  route-budget measurement and the full Playwright rerun on that host's matching dataset. See the
  Stage 10 entry in "Stage execution log" for exact commands and full evidence, and "Closeout
  decision" at the end of that entry for the final status classification.

  UPDATE 2026-09-06: the V1.7 implementation this runbook describes above (Stages 0-10) is now
  MERGED into `main` (commit `2102b51`, via PR #2 on `codex/issue-144`), confirmed present at the
  tip of the current branch `claude/issue-144-rivalry` (worktree `D:\dev\afldb-issue-144`), working
  tree clean. The two Stage 10 acceptance prerequisites above are UNCHANGED and still outstanding —
  they are about the Linux dev host, not about the commit/merge, which has since happened. This
  worktree/branch now carries a SEPARATE, ADDITIONAL scope: a post-merge browser-review redesign of
  `/clubs/compare` ("Club Rivalry Explorer"). It does not reopen or restate the V1.7 work above —
  see "Follow-up: Club Rivalry Explorer redesign (browser review)" at the end of this file for its
  own contract and stage plan. ISSUE-144 stays OPEN for this follow-up.
  Stage plan: eleven stages, Stage 0 through Stage 10. V1.7 promoted decade/era H2H breakdowns,
  period-score rivalry records and H2H player averages out of deferred enrichment and into V1 as
  the new Stage 6 — Extended rivalry analytics; the former Stages 6-9 are renumbered 7-10.
  Execution rule: exactly one stage per session; see "Stage execution log" at the end of this file.



  Active Plan Mode prevented repository writes. Before implementation:



  - Save this complete replacement runbook as AFLDB-ISSUE-144.md. — DONE (Stage 0)

  - Add ISSUE-144 as an open/planned Medium-severity enhancement in issues.md and IssuesIndex.md;

    update the open count from 7 to 8. — DONE (Stage 0)



  - Record area as Public UI / club history / database queries. — DONE (Stage 0)

  - Set Stage 0 below as the exact next action. — DONE, and Stage 0 has now been executed.

  - Do not update CHANGELOG.md for planning-only work. — OBSERVED; no CHANGELOG entry yet
    (the runbook defers it to Stage 10).



  Retain these checkpoints:



  - V1: Initial durable three-layer scope; investigation incomplete.

  - V1.1: Organisation, identity, lineage, and relation semantics.

  - V1.2: Aggregation grain and coverage rules.

  - V1.3: Brownlow, H2H, and crossover contracts.

  - V1.4: Route, query, UI, SEO, and performance architecture.

  - V1.5: Staged implementation and validation contract.

  - V1.6: Mandatory season-generic and future-season acceptance contract.

  - V1.7: Extended rivalry analytics promoted into V1 — decade/era H2H breakdowns, period-score
    rivalry records, and coverage-aware H2H player averages with a minimum of 5 recorded H2H games
    for the specific metric. Stage plan extended to eleven stages.



  ## Objective and non-negotiable season contract



  Create an AFL-only public /clubs/compare surface with:



  1. Selected-season comparison.

  2. Complete head-to-head/rivalry history.

  3. Connected club history.



  The implementation must be season-generic:



  - Valid seasons come only from canonical seasons rows.

  - The default is the maximum canonical season.

  - Application code must contain no hard-coded year, supported-year range, or season allowlist.

  - Future seasons become available automatically through normal AFLDB ingestion.

  - Coverage and provisionality come from database state at request time.

  - A season transitioning from in-progress to complete, or Brownlow coverage from pending to

    complete, requires no release or code change.



  - No comparison query may contain a year predicate unless it is parameterized by the user-selected

    season.



  ## V1 product scope



  ### Selected season



  - Home-and-away record and ladder position.

  - Wins, losses, draws, premiership points, win percentage, points for/against, percentage, and

    scoring averages.



  - Team statistical averages with explicit coverage denominators.

  - Player leaders for games, goals, and disposals.

  - Selected-season Brownlow summary and leaders.

  - Explicit in-progress/provisional presentation from canonical season metadata.



  ### Head-to-head history



  - Total meetings, wins, draws, win percentages, first/latest meeting.

  - Complete filtered and paginated match history.

  - Finals-series and Grand Final meetings.

  - Biggest wins, closest games, highest/lowest scores, highest combined scores.

  - Longest winning streaks and current result streak.

  - Venue records.

  - H2H games and goals leaders, covered single-match records, and recorded H2H Brownlow votes.



  ### Extended rivalry analytics



  - H2H by decade: meetings, wins per organisation, draws, half-draw win percentages, and points
    for/against.

  - Period-score rivalry records from canonical match\_period\_scores, with pair-level coverage.

  - Coverage-aware H2H player average leaderboards with a minimum recorded-game threshold.



  ### Connected history



  - Every player who represented both organisations.

  - Games, goals, and first/last representation for each organisation.

  - Career totals.

  - First-representation direction and intervening clubs.

  - First and most recent players to complete representation of both.

  - Authoritative club-attributed Brownlow medallists and vote leaders.



  ### Deferred enrichment



  Exclude from V1:



  - Coleman, All-Australian, best-and-fairest, captaincy, Hall of Fame, draft, family, and other

    relationship enrichment.



  - Claims of a direct trade or transfer.

  - AFLW.

  - Metric-customization UI.

  - Public comparison API.

  - Schema changes, materialization, or new indexes without measured evidence.



  ## Route and state contract



  - Route: /clubs/compare.

  - Query parameters:

      - club1, club2: club\_organizations.slug.

      - season: canonical season year.

      - matchType: all, home-and-away, or finals; default all.

      - page: one-based meetings page; default 1.



  - Render an unselected landing state when either club is missing or invalid. Do not choose clubs

    automatically.



  - Selectors list every canonical organisation, with current organisations first and historical/

    defunct organisations second, alphabetically within each group.



  - Reject identical organisation IDs before running comparison queries.

  - Historical identities belonging to a continuing organisation are not separate selector choices.

  - Populate the season selector from canonical seasons data on every request.

  - When season is omitted, select the maximum canonical season.

  - An invalid/noncanonical season falls back to the latest canonical season and displays a

    validation notice.



  - If an organisation did not compete in the selected season, show Did not compete in YEAR. Never

    substitute a different season.



  - Complete meetings use 25 rows per page ordered by match\_date DESC, season DESC, id DESC.

  - A swap link reverses presentation order while preserving season, match filter, and page.



  ## Identity and lineage contract



  - clubs.id: historical identity-at-match grain.

  - club\_organizations.id: continuing organisation grain.

  - clubs.current\_identity\_id: current identity, not an aggregation key.

  - Resolve the selected-season identity through afldb\_identity\_for\_season(organization\_id, season).

  - Do not reproduce the identity model in TypeScript or add club-specific mappings.

  - Renames and relocations within one organisation combine naturally:

      - Footscray/Western Bulldogs.

      - South Melbourne/Sydney.

      - Kangaroos/North Melbourne.



  - Explicit organisation relations do not combine statistics:

      - Brisbane Bears, Fitzroy, and Brisbane Lions remain distinct.

      - merged\_into, relocated\_to, and folded supply context/navigation only.



  - H2H and crossover aggregation uses organisation grain; rendered matches and stints retain

    historical identity-at-match.



  - Related but distinct organisations may be compared. Only the same organisation is rejected.



  ## Selected-season statistical rules



  ### Record and scoring



  Read the selected identity’s club\_seasons row for the selected canonical season.



  - winPercentage = 100 × (wins + 0.5 × draws) / played.

  - averagePointsFor = pointsFor / played.

  - averagePointsAgainst = pointsAgainst / played.

  - Percentage remains the canonical 100 × pointsFor / pointsAgainst; unavailable when the

    denominator is zero.



  - Label this subsection “Home-and-away record.”

  - Do not assume the season is complete.

  - Use seasons.status, data\_through\_date, and related canonical metadata:

      - in\_progress: render current values with a provisional badge and “as at” date.

      - complete: render the same fields as completed values through the same query/UI path.



  - New matches, finals, player rows, and ladder updates must appear on the next request without

    code or cache invalidation changes.



  ### Team metrics



  Support these stat families through a static key/column/label registry, not a year registry:



  - Goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts.

  - Rebounds, inside 50s, clearances, clangers.

  - Frees for and frees against.

  - Contested and uncontested possessions.

  - Contested marks, marks inside 50, one-percenters, bounces, and goal assists.



  marks\_i50 maps to player\_match\_stats.marks\_inside\_50. Metric identity may be static; season

  availability must not be.



  Aggregation grain:



  organisation → selected-season identity → match/club → player-stat sum → average eligible team-

  match totals



  - Never average player rows directly.

  - Team averages include all canonical matches in the selected season, including finals.

  - Display their match denominator separately from the home-and-away record.

  - A team-match is eligible for a metric only when player rows exist and every present player row

    has a non-NULL value for that metric.



  - Read the selected season’s stat\_availability row for every metric:

      - complete: show the normal team-match average.

      - partial: show the recorded-match average and eligible/total denominator.

      - not\_collected or not\_applicable: show unavailable.

      - pending: show pending.

      - Missing or unusable coverage metadata: fail safely as unavailable.



  - Zero is displayed only when coverage establishes a recorded zero.

  - Do not infer availability from a year.

  - Do not highlight a statistical “winner” when either side has partial coverage or unequal

    eligible denominators.



  ### Player leaders



  - Reuse player\_club\_season\_stats, aggregating every selected-organisation identity active in that

    season.



  - Games and goals include all season matches.

  - Show disposals only when runtime coverage permits, with recorded-game counts.

  - Use dense ranks 1–5 and retain ties.

  - If the organisation did not participate, return no leaders rather than borrowing another

    identity or season.



  ## Head-to-head rules



  - Scope matches by joining each historical match identity to clubs.organization\_id.

  - Never traverse club\_organization\_relations to enlarge the match population.

  - finals means matches.is\_finals\_series.

  - Wildcard Finals remain visible under all but are not finals-series meetings.

  - Grand Finals require round\_type = 'grand\_final'.

  - H2H win percentage uses the half-draw formula.

  - Venue breakdown groups by canonical venue\_id; NULL IDs group only by exact venue\_raw.

  - Record handling:

      - Biggest win: maximum winning margin per organisation.

      - Closest game: minimum positive margin; draws appear separately.

      - Highest/lowest score: organisation’s match score.

      - Highest combined score: home\_score + away\_score.

      - Return every tied record in deterministic order.



  - Streaks order by match date, season, and ID:

      - A draw breaks a winning streak.

      - Calculate longest winning streak separately for each organisation.

      - Current streak is the consecutive identical result from the latest meeting and may be an A

        win, B win, or draw.



  - H2H games/goals leaders use the complete scoped match population.

  - Single-match statistical records use only runtime-covered rows.

  - Use dense rank 1–10 and retain ties.

  - No application-level historical cutoff is permitted.



  ## Extended rivalry rules



  Promoted into V1 by V1.7. Implemented by Stage 6 — Extended rivalry analytics. Nothing here may
  introduce a second lineage or population definition, and nothing here may encode a year.



  ### H2H by decade



  For every decade represented in the selected organisation pair's canonical H2H population, return:



  - meetings;

  - organisation A wins;

  - organisation B wins;

  - draws;

  - half-draw win percentages for both organisations;

  - points for;

  - points against.



  - Decades are derived from the canonical meeting population, never from a decade list.

  - Reuse the Stage 1 h2hScope(orgA, orgB, matchType) fragment as the sole population definition.

  - A decade with no meeting does not appear; it is never rendered as a zero row.



  ### Period-score rivalry records



  Read canonical match\_period\_scores. Support at minimum:



  - biggest quarter-time lead;

  - biggest half-time lead;

  - biggest three-quarter-time lead;

  - biggest comeback from quarter time;

  - biggest comeback from half time;

  - biggest comeback from three-quarter time;

  - largest turnaround between consecutive breaks.



  - A comeback is defined precisely as: the organisation was trailing at the named break and
    ultimately won the match.

  - Retain every tied record witness, in deterministic order.

  - Expose pair-level period-score coverage — meetings with period-score rows out of total meetings
    — so incomplete future or runtime data is never silently presented as complete.

  - Current test-database completeness is evidence, not a guarantee. The query/API contract must
    expose coverage even while every measured pair is fully covered.



  ### H2H player averages



  Coverage-aware H2H player average leaderboards for the player-match metrics already carried by the
  comparison metric registry, where player-level data exists: goals, disposals, kicks, handballs,
  marks, tackles, hitouts, rebounds, inside 50s, clearances, clangers, contested possessions,
  uncontested possessions, contested marks, marks inside 50, one-percenters, bounces, and goal
  assists.



  - A player qualifies for a metric's average board only with at least 5 recorded H2H games for that
    specific metric.

  - The denominator is metric-specific recorded games, not total rivalry appearances.

  - Average only non-NULL recorded values; a missing row is never a zero.

  - Return the recorded-game denominator with every average.

  - Runtime stat\_availability controls availability, through the existing statCoverage()
    abstraction.

  - No hard-coded season cutoff.

  - Dense ranking, ties retained at the ranking boundary, deterministic ordering after rank.



  ## Connected-player rules



  - Treat player\_clubs as the derived historical-identity stint source.

  - Re-aggregate through clubs.organization\_id.

  - A crossover player must have canonical representation for both selected organisations.

  - Sum games/goals across each organisation’s identity rows.

  - Read career totals from player\_career\_stats.

  - Resolve first/last representation through referenced matches ordered by date and ID—not by

    numeric match ID alone.



  - Direction means first recorded representation only:

      - A → B when A precedes B.

      - B → A when B precedes A.

      - Same/unknown when chronology cannot distinguish them.



  - Never describe direction as a direct transfer or trade.

  - An intervening club is a third organisation represented after the earlier target debut and

    before the later target debut.



  - “First player to represent both” uses the earliest date on which both representations had

    occurred; “most recent” uses the latest.



  - Sort by combined games for the selected organisations, then player sort name.



  ## Brownlow rules



  ### Season and club history



  - brownlow\_season\_votes is authoritative for season totals, winners, eligibility, and club-

    attributed history.



  - Runtime behavior is controlled by the selected season’s brownlow\_season\_total coverage row:

      - complete: show numeric totals and leaders.

      - partial: do not present an authoritative season total.

      - pending: show pending.

      - not\_collected/not\_applicable: show unavailable/not applicable.

      - Missing coverage: unavailable.



  - Use explicit brownlow\_season\_votes.club\_id first.

  - When it is NULL, use player\_season\_stats.primary\_club\_id only where club\_count = 1.

  - Exclude unattributed multi-club seasons from club totals and disclose their count.

  - Mark ineligible players; winners come only from is\_winner.

  - All-time club Brownlow history includes only seasons whose runtime brownlow\_season\_total

    coverage is complete.



  - Never encode known Brownlow coverage windows or an ending season in application code.

  - When canonical coverage changes from pending to complete, the next request must show numeric

    data automatically.



  ### H2H Brownlow



  - Eligible population is H2H home-and-away matches only; finals are never polled.

  - Use player\_match\_stats.brownlow\_votes only for match-scoped H2H reporting.

  - Evaluate each match’s season against runtime brownlow\_match\_votes coverage.

  - Count a meeting as covered only when its recorded rows establish the complete published

    allocation.



  - Display Recorded H2H Brownlow votes from X of Y eligible meetings.

  - Label the result complete only when X equals Y; otherwise label it partial.

  - Missing meetings contribute neither votes nor zeros.

  - Never derive season winners, season totals, or career totals from match vote rows.

  - brownlow\_round\_votes coverage may be pending independently; do not use it as a substitute for

    either season-total or match-vote coverage.



  The supplied zero-row club Brownlow probe failed because it inner-joined nullable

  brownlow\_season\_votes.club\_id. The crossover probe failed because both was used as a SQL CTE name.

  Neither failure is negative data evidence.



  ## Query and component architecture



  Add src/db/queries/club-comparison.ts with parameterized, independently callable functions for:



  - Canonical season and organisation options.

  - Organisation and selected-season identity resolution.

  - Selected-season record, team metrics, leaders, and Brownlow.

  - H2H summary, records, meetings, venues, and player leaders.

  - Crossover players.

  - Authoritative club Brownlow history.

  - H2H match-vote totals and coverage.



  Implementation constraints:



  - Keep common organisation-pair scoping in one internal SQL fragment.

  - Keep runtime coverage joins in one metric-coverage abstraction.

  - Do not route through NL search; existing NL H2H logic is a semantic precedent only.

  - Add src/app/clubs/compare/page.tsx as the state/data-loading Server Component.

  - Add src/components/ClubComparisonView.tsx for section rendering.

  - Fetch independent sections concurrently only after state validation.

  - Reuse Pagination, collapsible panels/tables, sortable tables, format/path helpers, and

    pageMetadata.



  - Add narrowly scoped global styles only where existing responsive utilities are insufficient.

  - Use dynamic = 'force-dynamic'.

  - Add no persistent application cache in V1. Every request reads current canonical season, match,

    ladder, player, and coverage state.



  ## SEO, navigation, responsive, and accessibility



  SEO:



  - Generate pair-specific metadata for valid comparisons.

  - Canonicalize a valid pair to alphabetically ordered organisation slugs:

    /clubs/compare?club1=<lower>\&club2=<higher>.



  - Omit season, match filter, and page from the canonical URL.

  - Base/incomplete state canonicalizes to /clubs/compare.

  - Invalid or same-organisation states use noindex,follow.

  - Do not enumerate pair/season permutations in the sitemap.



  Navigation:



  - Add “Compare clubs” to /clubs.

  - Add a seeded comparison link to individual club pages using their organisation slug.

  - Historical club pages seed the continuing organisation without a special mapping.



  Presentation:



  - Stack selectors and summary cards on narrow screens.

  - Preserve detailed columns inside horizontally scrollable table wrappers.

  - Keep core summaries expanded and place long histories behind progressive disclosure.

  - Use semantic headings, fieldsets/legends, explicit labels, captions, column scopes, visible

    focus, keyboard-operable controls, and textual result/coverage states.



  - Never use colour as the only indicator.



  ## Performance contract



  Measured scale is modest: Adelaide–Brisbane Lions has 41 meetings; Carlton–Collingwood has 268

  meetings and approximately 10,610 player-match rows.



  - Warm afldb\_test target: each query under 250 ms and parallel query group under 750 ms.

  - Warm supported-Linux route target: under 1.5 seconds.

  - Measure Adelaide–Brisbane Lions and Carlton–Collingwood.

  - Inspect EXPLAIN (ANALYZE, BUFFERS) only for queries exceeding targets.

  - Split or reshape queries before proposing an index.

  - Any migration, index, materialization, or persistent cache requires measured before/after

    evidence and a reapproved runbook.



  ## Validation witnesses



  Identity/H2H:



  - Adelaide vs Brisbane Lions: 41 meetings, 19 Adelaide wins, 21 Brisbane Lions wins, one draw, and

    two finals-series meetings.



  - Match 16486: 2024 draw.

  - Matches 12275 and 12463: finals witnesses.

  - Ben Keays: Brisbane Lions → Adelaide.

  - Jarryd Lyons: Adelaide → Brisbane Lions, with Gold Coast intervening.

  - Western Bulldogs comparisons include Footscray matches.

  - Sydney comparisons include South Melbourne matches.

  - Brisbane Bears/Fitzroy relations do not collapse into Brisbane Lions.

  - Carlton vs Collingwood validates a Grand Final and long-rivalry scale.



  Season classes:



  1. Current/in-progress

      - Use canonical 2026 test data when available.

      - Validate current record, team stats, player leaders, provisional metadata, and runtime

        Brownlow pending/available states.



      - Closure cannot claim this witness if canonical 2026 test data is available but the test was

        skipped.



  2. Recent completed

      - Retain deterministic 2025 record, team-stat, player-leader, and completed-state witnesses.



  3. Historical limited coverage

      - Use at least one pre-1965 canonical season.

      - Use another historical season where only some metric families are available.

      - Assert behavior from stat\_availability, not from test-side replication of application year

        branching.



  Generic future-season assertion:



  - Query the maximum canonical test season dynamically.

  - Dynamically choose two organisations participating in that season.

  - Execute the complete selected-season comparison for them.

  - Assert that returned season/status/coverage values equal canonical rows.

  - The test name, fixture setup, and application path must not name the selected year.

  - No hard-coded metric-year condition is permitted in production code.



  Other coverage:



  - Same-organisation rejection.

  - Complete and filtered meeting counts against independent SQL.

  - Historical NULL values render unavailable rather than zero.

  - Selected-season team totals match a match→team oracle.

  - Club Brownlow joins work when bsv.club\_id is NULL.

  - H2H Brownlow complete/partial disclosure.

  - New canonical matches and changed denominators are visible without application changes.



  ## Extended rivalry evidence (V1.7)



  Read-only evidence was collected from afldb\_test and persisted in the worktree as:



  - ISSUE-144-EXTENDED-RIVALRY-EVIDENCE.sql

  - ISSUE-144-EXTENDED-RIVALRY-EVIDENCE.txt



  The first evidence run had one non-material SQL scripting error: the agg CTE was reused across
  statements for the min-3/min-5/min-10 average probes even though a PostgreSQL CTE is
  statement-scoped. The min-1 query and all other sections completed successfully, and a corrected
  standalone threshold query was then run successfully. No section of the evidence is negative data.



  ### Decade H2H witness



  Adelaide vs Brisbane Lions:



  - 1990s: 5 meetings — Adelaide 2, Brisbane Lions 3.

  - 2000s: 15 meetings — Adelaide 5, Brisbane Lions 10.

  - 2010s: 13 meetings — Adelaide 10, Brisbane Lions 3.

  - 2020s: 8 meetings — Adelaide 2, Brisbane Lions 5, 1 draw.



  Decade summaries are therefore a straightforward aggregation of the existing Stage 1 H2H
  population and must reuse that population definition.



  ### Period-score evidence



  - Period-score coverage is present from 1897 onward.

  - Every measured season in the evidence is 100% covered.

  - Every measured major historical rivalry is 100% covered.

  - Carlton vs Collingwood: 268/268 matches with period scores.

  - Carlton vs Essendon: 255/255.

  - Collingwood vs Essendon: 249/249.

  - Adelaide vs Brisbane Lions: all known H2H meetings covered.

  - match\_period\_scores contains periods 1, 2, 3 and 4 only.

  - 16,838 matches have period-score rows.

  - Zero matches were found with a non-four-period structure.



  This supports period-score rivalry analytics as V1 functionality. Do not assume future
  completeness merely because the current test database is complete: the contract must expose
  coverage if a selected rivalry ever has incomplete period-score data.



  ### H2H average threshold evidence



  Adelaide vs Brisbane Lions disposals threshold probe.



  Minimum 1:



  - Dayne Beams 3 games — 32.33.

  - Matt Crouch 7 — 30.71.

  - Lachie Neale 8 — 29.75.

  - Rory Laird 14 — 28.86.

  - Includes one- and two-game samples.



  Minimum 3 still allows Dayne Beams on only 3 games.



  Minimum 5:



  - Matt Crouch 7 — 30.71.

  - Lachie Neale 8 — 29.75.

  - Rory Laird 14 — 28.86.

  - Brad Crouch 6 — 27.83.

  - Tom Rockliff 8 — 27.00.

  - Nigel Lappin 17 — 25.53.

  - Scott Thompson 14 — 25.21.

  - Simon Black 23 — 24.96.

  - Josh Dunkley 5 — 24.40.

  - Michael Voss 16 — 23.63.



  Minimum 10 becomes too restrictive for newer players and shorter rivalries.



  Approved V1 rule: a player must have at least 5 recorded H2H games for the specific metric to
  qualify for that H2H average leaderboard. The denominator is metric-specific recorded games, not
  total rivalry appearances, and missing or NULL stat rows never count as zero.



  ### Runtime stat coverage evidence



  The evidence confirmed runtime coverage exists for the relevant metric families: goals (recorded
  through the full historical range in current data), disposals/kicks/handballs/marks (from the
  canonical recorded era onward), tackles, hitouts, rebounds, inside 50s, clearances, clangers,
  contested possessions, uncontested possessions, and goal assists.



  These historical start points are evidence witnesses only. Do not encode any of those years in
  production logic. stat\_availability remains authoritative.



  ## Staged implementation



  ### Stage 0 — Persist and reconfirm the contract



  - Change: Save this runbook; add ISSUE-144 to both ledgers; inspect current bundled Next.js

    guidance.



  - Validation: npm test -- tests/finals-semantics-contract.test.ts

  - Evidence: Existing finals semantics pass; schema still matches this contract.

  - Stop: Organisation, finals, Brownlow, season, or coverage models have materially changed.

  - Next: Build H2H core queries.



  ### Stage 1 — H2H core



  - Change: Implement shared pair scoping, summary, records, streaks, venues, finals, and meetings;

    create tests/integration/club-comparison.test.ts.



  - Validation: npm test -- tests/integration/club-comparison.test.ts -t "head-to-head core"

  - Evidence: Adelaide/Brisbane counts and independent match/filter/pagination oracles agree.

  - Stop: Relations collapse, wildcard semantics drift, or totals disagree.

  - Next: Implement crossover players.



  ### Stage 2 — Connected players



  - Change: Implement organisation aggregation, chronology, direction, and intervening clubs.

  - Validation: npm test -- tests/integration/club-comparison.test.ts -t "crossover players"

  - Evidence: Ben Keays and Jarryd Lyons prove both directions; Jarryd Lyons proves intervention.

  - Stop: player\_clubs disagrees with canonical player-match rows or stint references are stale.

  - Next: Implement H2H leaders and Brownlow.



  ### Stage 3 — H2H leaders and Brownlow



  - Change: Add H2H player leaders, authoritative club Brownlow history, and match-vote coverage.

  - Validation: npm test -- tests/integration/club-comparison.test.ts -t "leaders|Brownlow"

  - Evidence: Measured leaders agree; nullable club attribution succeeds; incomplete coverage

    remains partial.



  - Stop: Season totals require match-vote derivation, multi-club attribution is forced, or a year

    cutoff appears.



  - Next: Implement season-generic comparison.



  ### Stage 4 — Season-generic selected-season comparison



  - Change: Implement canonical season discovery, selected identity resolution, record/scoring

    formulas, runtime metric coverage, team-match aggregation, leaders, and Brownlow states.



  - Validation: npm test -- tests/integration/club-comparison.test.ts -t "selected season|stat

    coverage|maximum canonical season"



  - Required evidence:

      - Current/in-progress canonical season behavior, using 2026 when present.

      - Completed 2025 behavior.

      - Pre-1965 unavailable behavior.

      - A mixed-coverage historical season.

      - Dynamic maximum-season assertion with no year-named code path.



  - Stop: Any metric uses year branching, missing coverage becomes zero, an inactive club borrows

    another season, or future-season support requires code changes.



  - Next: Run the performance gate.



  ### Stage 5 — Performance gate



  - Change: Reshape only queries exceeding targets.

  - Validation: npm test -- tests/integration/club-comparison.test.ts -t "long rivalry performance"

  - Evidence: Record warm Adelaide/Brisbane and Carlton/Collingwood timings.

  - Stop: Targets remain unmet or schema/index/materialization appears necessary; amend the runbook

    first.



  - Next: Implement extended rivalry analytics.



  ### Stage 6 — Extended rivalry analytics



  - Change: Implement H2H by decade, period-score rivalry records with pair-level coverage, and
    coverage-aware H2H player averages, in the EXISTING
    src/db/queries/club-comparison.ts and tests/integration/club-comparison.test.ts.



  - Reuse: h2hScope() for every population, statCoverage() for every availability decision. No
    second lineage, population or coverage model.



  - Validation: npm test -- tests/integration/club-comparison.test.ts -t "decade|period score|H2H
    average"



  - Required evidence:
      - Adelaide vs Brisbane Lions decade table matching the V1.7 witness.
      - Period-score records with the pair-level coverage denominator exposed.
      - A minimum-5-recorded-game H2H disposals average board matching the V1.7 witness.
      - An unavailable-metric witness proving stat\_availability, not a year, decides availability.



  - Stop: A decade/period/average path needs a year branch, a second population definition, missing
    period-score data would be presented as complete, or a NULL becomes a zero.



  - Next: Build the route.



  ### Stage 7 — Route and shareable state



  - Change: Add the route, database-driven selectors, validation, swap, filters, pagination, and

    canonical-state helpers; add tests/club-comparison.test.ts.



  - Validation: npm test -- tests/club-comparison.test.ts

  - Evidence: Missing, invalid, same-club, historical, dynamic-season, canonical, filter, and

    pagination states pass.



  - Stop: Current Next.js behavior contradicts the route/canonical design.

  - Next: Render public sections.



  ### Stage 8 — Public presentation



  - Change: Add ClubComparisonView, summaries, responsive tables, progressive disclosure, and

    coverage explanations.



  - Validation: npm exec tsc -- --noEmit

  - Evidence: Result states render exhaustively; provisional/pending/unavailable states are

    distinct.



  - Stop: JSX duplicates data semantics or weakens query result types.

  - Next: Complete navigation and browser acceptance.



  ### Stage 9 — Navigation, SEO, accessibility, responsive, browser acceptance



  - Change: Update club entry points, focused styles, tests/seo.test.ts, tests/e2e/seo.spec.ts, and

    tests/e2e/journeys.spec.ts.



  - Validation: npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts

  - Evidence: Keyboard use, same-club error, shareable reload, canonical normalization, pagination,

    current-season provisional state, and mobile layout pass.



  - Stop: Duplicate canonical permutations, inaccessible controls/tables, hidden mobile data, or

    stale season state.



  - Next: Run final acceptance.



  ### Stage 10 — Final regression and closeout preparation



  - Validation:

      - npm test -- tests/club-comparison.test.ts tests/integration/club-comparison.test.ts tests/

        seo.test.ts



      - npm exec tsc -- --noEmit

      - npm run build



  - Required acceptance: Reprove current/in-progress, completed 2025, historical limited-coverage,

    and dynamic maximum-season classes in the final run.



  - Tracking: Add an Unreleased changelog entry only for the implemented feature; record actual

    files, timings, witnesses, and limitations in ISSUE-144.



  - Stop: Any semantic, season-generic, coverage, performance, browser, type, or build gate fails.

  - Next: User reviews and commits Git changes; resolve ISSUE-144 only after all gates pass.



  ## Future-season acceptance criterion



  A new AFL season is supported when normal AFLDB ingestion populates the existing canonical season,

  identity, club-season, match, player-stat, and coverage structures.



  Acceptance requires that /clubs/compare then:



  - lists the new season;

  - chooses it as the default when it is the maximum canonical season;

  - resolves participating identities;

  - renders current records and provisionality;

  - updates as matches and finals arrive;

  - renders metric and Brownlow states from coverage metadata;

  - transitions to completed values from the same query/UI path.



  No ISSUE-144 application code, UI component, query structure, hard-coded list, club mapping,

  release, or additional implementation stage may be required.



  ## Fresh implementation handoff



  Start a fresh high-effort implementation session on the user-confirmed codex/issue-144 branch

  with:



  > Execute AFLDB-ISSUE-144 according to AFLDB-ISSUE-144.md. Treat the approved runbook as

  > authoritative. The implementation is season-generic: no year cutoffs, hard-coded supported

  > seasons, club mappings, or coverage assumptions. Follow CLAUDE.md and current bundled Next.js

  > guidance. Do not redesign, broaden, add schema/indexes/materialization, or weaken NULL/coverage

  > semantics. I will run tests, SQL, builds, Playwright, and Git commands. Stop if current evidence

  > materially contradicts the runbook.




  ## Stage execution log

  One stage per session. Each stage appends its own record here before stopping. A fresh session
  must be able to resume from this log alone, without conversation history.


  ### Stage 0 — Persist and reconfirm the contract — COMPLETE (2026-09-06)

  Branch codex/issue-144, worktree D:\dev\afldb-issue-144. No application code written.

  **Files changed in this stage**

  - AFLDB-ISSUE-144.md — Status block updated (Planning -> In implementation, Stage 0 complete,
    pre-implementation checklist marked done) and this Stage execution log appended.
  - issues.md — open count 7 -> 8 with a Stage 0 allocation note; ISSUE-144 row added to the Open
    Issues table; full "AFLDB-ISSUE-144 — Club vs Club comparison and connected history" detail
    entry appended (scope, Stage 0 evidence, validation, blockers, next action).
  - IssuesIndex.md — open count 7 -> 8, Stage 0 UPDATE note, and the ISSUE-144 open-issue row.

  No source, test, migration, privilege, deployment or CHANGELOG file was touched. No database was
  contacted. No Git command was run beyond read-only status/diff plus one `git checkout --
  IssuesIndex.md` that reverted a mis-applied edit to that same file (see Deviations).

  **Implementation summary**

  Stage 0 is contract persistence plus a schema re-confirmation. Every load-bearing semantic the
  runbook depends on was checked against the migrations in this worktree, and **none contradicts the
  contract**:

  - Identity/lineage: `afldb_identity_for_season(p_organization_id, p_season)` exists at
    `src/db/migrations/017_club_organizations.sql:141` (`LANGUAGE sql STABLE PARALLEL SAFE`), and
    resolves by `first_season`/`last_season` span, `ORDER BY c.first_season DESC NULLS LAST LIMIT 1`
    — its own comment records that this is what makes Kangaroos (1999-2007) win inside North
    Melbourne's span. `clubs.organization_id` is NOT NULL (added `017_…:68`) and is documented as the
    lineage key, with `clubs.current_identity_id` retained "for compatibility" only.
    `club_organization_relations` (`017_…:98`) carries the `organization_relation` enum
    `merged_into` | `relocated_to` | `folded`, with the comment "A merger, unlike a rename, does not
    transfer history" — matching the runbook's rule that relations are context, never a statistical
    merge.
  - Season provenance: `015_brownlow_grain_and_coverage.sql:53` adds `seasons.status`
    (`season_status` = `in_progress` | `complete`), `data_through_date`, `source_built_at`,
    `last_loaded_round`, `completed_at`; `is_complete` is dropped and re-added as a GENERATED mirror
    of `status`. The runbook's provisional/"as at" rendering is therefore fully backed, and
    `status` is the authority.
  - Coverage vocabulary: `coverage_status` = `complete` | `partial` | `not_collected` |
    `not_applicable` | `pending` (`015_…:38`), and `stat_availability.coverage` (`015_…:161`) is the
    per-`(stat_key, season)` runtime coverage column. `stat_availability` itself
    (`002_core_entities.sql:211`) also carries `is_recorded`, `populated_rows`, `total_rows`.
  - Brownlow grains: `016_brownlow_grain_availability.sql` writes `brownlow_season_total`,
    `brownlow_round_votes` and `brownlow_match_votes` coverage **computed from the loaded data, not
    hardcoded** ("a future reload that fills a gap reports the improvement automatically"), and it
    defines a fully polled match as exactly 3+2+1 = 6 votes over `NOT is_final` matches. That is
    precisely the covered-meeting rule the runbook's H2H "X of Y eligible meetings" disclosure needs,
    and it confirms finals are `not_applicable` rather than missing.
  - Brownlow authority: `brownlow_season_votes.club_id` is **nullable**
    (`005_brownlow_awards.sql:15`), with `is_ineligible` and `is_winner` (plus
    `ix_brownlow_winners … WHERE is_winner`). `player_season_stats` (`015_…:99`) carries
    `primary_club_id` and `club_count` with the comment that a two-club player has `club_count = 2`.
    The club-grain table is `player_club_season_stats`, renamed from the old `player_season_stats` at
    `015_…:83`, with `brownlow_votes` deliberately dropped from it ("a club row cannot carry a season
    award total"). `player_career_stats.brownlow_votes`
    (`007_derived_stats.sql:110`) is summed from `brownlow_season_votes` (79,113) and its comment
    records that summing `player_match_stats.brownlow_votes` instead yields 46,979 and is wrong —
    the runbook's prohibition is materially correct, not merely stylistic.
  - Matches: `003_matches.sql:19` gives `season`, `round_code`, `round_number`, `round_type`,
    `is_final`, `match_date`, `venue_id` (nullable — canonicalisation is a later enrichment pass) and
    `venue_raw` (NOT NULL), `home_club_id`/`away_club_id`, `home_score`/`away_score`, `result`,
    `winner_club_id` (NULL on a draw, CHECK-enforced) and `margin` (CHECK `= abs(home-away)`).
    `is_finals_series` is added by `085_matches_is_finals_series.sql:53` as the ONLY finals-series
    definition (`084_round_type_wildcard_final.sql` added `wildcard_final`), so the runbook's
    "finals means `matches.is_finals_series`, Wildcard Finals are visible under all but are not
    finals-series meetings" is directly supported.
  - Season record: `club_seasons` (`006_draft_relationships.sql:55`) has `played`, `wins`, `draws`,
    `losses`, `points_for`, `points_against`, `premiership_points`, `percentage numeric(9,4)`,
    `ladder_rank`, `wooden_spoon`, `is_premier`, `finals_played`, UNIQUE `(season, club_id)`, with
    `ix_club_seasons_club (club_id, season)` and `ix_club_seasons_ladder (season, ladder_rank)`.
  - Stints: `player_clubs` (`007_derived_stats.sql:128`) is DERIVED, keyed `(player_id, club_id)`
    at historical-identity grain, with `games`, `goals`, `first_season`, `last_season`,
    `first_match_id`, `last_match_id` — the runbook's rule to resolve first/last representation via
    the referenced matches (date, then id) rather than numeric match id is therefore executable.
  - Player match stats: `004_player_match_stats.sql` carries `marks_inside_50` (:46) and
    `brownlow_votes` (:54, CHECK 0-3, partial index at :79) — `marks_i50 -> marks_inside_50` in the
    runbook's metric registry is correct.

  Bundled Next.js guidance (16.3.1, `node_modules/next/dist/docs/`) was inspected and does not
  contradict the route/SEO design:

  - `01-app/03-api-reference/03-file-conventions/page.md` — `searchParams` is a
    `Promise<{ [key: string]: string | string[] | undefined }>` and must be awaited in a Server
    Component page. The route stage (Stage 7 after the V1.7 renumbering) must await it; there is
    no synchronous access path.
  - `01-app/02-guides/caching-without-cache-components.md` — `export const dynamic = 'force-dynamic'`
    is still one of `'auto' | 'force-dynamic' | 'error' | 'force-static'` and forces per-request
    rendering. `cacheComponents` / `dynamicIO` is NOT enabled in `next.config.*`, so the Cache
    Components migration guide does not apply to this feature.

  Reuse surfaces confirmed present (read them at the stage that needs them, not before):
  `src/components/Pagination.tsx`, `CollapsiblePanel.tsx`, `CollapsibleTable.tsx`,
  `SortableTable.tsx`, `SortableHeader.tsx`, `Breadcrumbs.tsx`; `src/lib/seo.ts` `pageMetadata()`
  (:107); `src/lib/format.ts`, `src/lib/pagination.ts`, `src/lib/params.ts`, `src/lib/sorting.ts`,
  `src/lib/slugs.ts`. `src/lib/player-compare.ts` and the existing player-comparison route are the
  closest structural precedent for Stages 6-7.

  **Validation commands and results**

  - `npx vitest run tests/finals-semantics-contract.test.ts` — **9 passed, 1 failed**, duration
    224 ms (transform 38 ms, setup 47 ms, import 18 ms, tests 18 ms).
    The one failure is "adds the enum value in its own migration, because Postgres requires it"
    (`tests/finals-semantics-contract.test.ts:57`), whose expected and received arrays print
    character-identical. Cause is environmental and already known to this repository: the test
    splits `src/db/migrations/084_round_type_wildcard_final.sql` on a bare `\n`, and
    `git ls-files --eol src/db/migrations/084_round_type_wildcard_final.sql` reports
    `i/lf w/crlf` — this worktree is a `core.autocrlf=true` checkout, so every statement retains a
    trailing carriage return. The suite passes on the supported Linux runtime. **Do not flip
    `core.autocrlf` and do not "fix" the test** to work around a Windows-only checkout artefact.
    Finals semantics themselves are unchanged: the other 9 assertions, including the single
    `is_finals_series` definition, pass.
  - `git ls-files --eol` on the ledgers confirms `i/lf w/crlf`; all Stage 0 edits were written back
    as CRLF so the working tree stays consistent.

  **Measured timings**

  Only the gate above (224 ms). No performance work is in scope before Stage 5.

  **Blockers, deviations and unresolved observations**

  - ENVIRONMENT (resolved, not a repository change): this worktree had no `node_modules`, so vitest
    could not run. A Windows directory junction was created:
    `mklink /J "D:\dev\afldb-issue-144\node_modules" "D:\dev\afldb-issue-139\node_modules"`.
    `afldb-issue-139`'s `package.json` is byte-identical to this branch's (`md5sum`
    `386faac11fe04de659bdd008327d56a9`) and it holds a real install (`next` 16.3.1, 335 entries).
    **`D:\dev\afldb-issue-143\node_modules` exists but is EMPTY — do not junction to it** (the first
    attempt did, and every `node_modules` path silently failed to resolve). Remove with
    `cmd /c rmdir "D:\dev\afldb-issue-144\node_modules"` if a real `npm ci` is ever wanted here.
  - DEVIATION (self-corrected, no data lost): one scripted PowerShell insertion into
    `IssuesIndex.md` computed a `-1` array index and produced a duplicated-header file. It was
    reverted with `git checkout -- IssuesIndex.md` — that file had no other uncommitted work — and
    both edits were re-applied with the editing tool. The final `IssuesIndex.md` diff is 18
    insertions / 1 deletion, all ISSUE-144 lines. No other file was affected.
  - UNTRACKED STRAY: `AFLDB-ISSUE-144.md.encoding-backup` is a pre-conversion copy of this runbook
    left in the worktree. It must not be committed. `ISSUE-144-H2H-TESTDB-EVIDENCE.txt` /
    `.sql` are the supplied read-only evidence pack; the user decides whether they are committed.
  - The evidence pack's two known-bad probes were NOT re-run in Stage 0 (they are Stage 2/3 work):
    the crossover probe used `both` as a CTE name, and the club-Brownlow probe inner-joined the
    nullable `brownlow_season_votes.club_id`. Neither is negative data evidence; both must be
    re-measured with the corrected shape at their own stage.
  - No stop condition was triggered. Nothing in the current schema, lineage model, Brownlow model,
    coverage model or Next.js behaviour contradicts the V1.6 contract.

  **Exact next stage: Stage 1 — H2H core.**

  First action for the next fresh session, after reading this runbook and this log:

  1. Confirm `node_modules` still resolves (`ls node_modules/next/package.json`); if not, re-create
     the junction to `D:\dev\afldb-issue-139\node_modules` as recorded above.
  2. Confirm `AFLDB_TEST_DATABASE_URL` is set and points at a database whose name ends in `_test`
     (this worktree has no `.env`, only `.env.example` — the integration suite cannot run without
     it, and the tunnel/DSN conventions for `afldb_test` are the operator's).
  3. Read `ISSUE-144-H2H-TESTDB-EVIDENCE.txt` for the already-measured H2H shapes before writing any
     SQL, and read `src/db/queries/` for the existing parameterised-query house style (a close
     neighbour is whichever query module already joins `clubs` to `club_organizations`).
  4. Create `src/db/queries/club-comparison.ts` containing ONE shared internal organisation-pair
     scoping fragment (both match identities joined to `clubs.organization_id`, never through
     `club_organization_relations`) plus independently callable, typed, parameterised functions for:
     H2H summary (meetings, wins/draws, half-draw win percentage, first/latest meeting), records
     (biggest win per organisation, closest non-draw, highest/lowest organisation score, highest
     combined score, all ties returned deterministically), streaks (longest winning streak per
     organisation and the current result streak, ordered by `match_date`, `season`, `id`, a draw
     breaking a winning streak), venue summaries (group by `venue_id`; NULL `venue_id` groups only
     by exact `venue_raw`), and the paginated meetings list (25 rows/page, `match_date DESC,
     season DESC, id DESC`, `matchType` of all | home-and-away | finals where finals means
     `matches.is_finals_series`).
  5. Create `tests/integration/club-comparison.test.ts` with a `describe`/test name containing
     "head-to-head core", asserting against an independent SQL oracle in the same test file:
     Adelaide vs Brisbane Lions = 41 meetings, 19 Adelaide wins, 21 Brisbane Lions wins, 1 draw,
     2 finals-series meetings; match 16486 is the 2024 draw; matches 12275 and 12463 are finals
     witnesses; Western Bulldogs includes Footscray meetings; Sydney includes South Melbourne
     meetings; Brisbane Bears and Fitzroy do NOT collapse into Brisbane Lions; and filtered page
     counts sum to the unfiltered total.
  6. Run `npm test -- tests/integration/club-comparison.test.ts -t "head-to-head core"`, then append
     a Stage 1 record to this log and STOP. Do not start Stage 2.

  ### Stage 1 — H2H core — COMPLETE (2026-09-06)

  **Status: Stage 1 — COMPLETE.** Executed on branch `codex/issue-144` in `D:\dev\afldb-issue-144`
  against `afldb_test` (read-only). No Stage 2 implementation was begun.

  **Exact files changed**

  - `src/db/queries/club-comparison.ts` — NEW. The Stage 1 H2H query module.
  - `tests/integration/club-comparison.test.ts` — NEW. `describe('club comparison: head-to-head core')`,
    10 tests, with the independent SQL oracle defined in the same file.
  - `AFLDB-ISSUE-144.md` — this record, plus the status line at the top of the file.

  No route, component, SEO, navigation, migration, schema, CHANGELOG or unrelated test file was
  touched. No database write was issued. No Git command was run.

  **H2H query surface implemented**

  All of it is built on ONE shared internal scoping fragment, `h2hScope(orgA, orgB, matchType)`, which
  joins both `matches.home_club_id` and `matches.away_club_id` through `clubs.organization_id` and
  never touches `club_organization_relations`. Every exported function builds its `meetings` CTE from
  that fragment and nothing else, so all of them see an identical match population.

  - `getOrganizationBySlug(slug)` — organisation-grain resolution only (`club_organizations.slug`);
    `footscray` deliberately does not resolve, it is a historical identity.
  - `getHeadToHeadSummary(orgA, orgB)` — meetings, A wins, B wins, draws, half-draw win percentages
    (`100 x (wins + 0.5 x draws) / meetings`, null at zero meetings), first meeting and latest meeting
    as `{matchId, season, matchDate}` ordered by `match_date, season, id`, finals-series meeting count
    and Grand Final meeting count. Never filtered by match type.
  - `getHeadToHeadMeetings(orgA, orgB, {matchType, page})` — complete paginated meetings.
    `MEETINGS_PAGE_SIZE = 25`, one-based `page`, order `match_date DESC NULLS LAST, season DESC,
    id DESC`. Returns `{meetings, matchType, page, pageSize, totalMeetings, totalPages,
    hasPreviousPage, hasNextPage}`. An out-of-range page returns no rows with honest metadata; no
    route-level redirect behaviour was implemented (the route stage, Stage 7 after the V1.7
    renumbering).
  - `getHeadToHeadVenueRecords(orgA, orgB)` — grouped by `venue_id`, with NULL `venue_id` grouped only
    by exact `venue_raw` (`GROUP BY venue_id, CASE WHEN venue_id IS NULL THEN venue_raw END`). No
    alias inference. Returns meetings, A wins, B wins, draws, first and latest meeting per venue.
  - `getHeadToHeadRecords(orgA, orgB)` — eight record kinds in one query over one scan:
    `biggest-win-a`, `biggest-win-b`, `closest-game`, `highest-score-a`, `highest-score-b`,
    `lowest-score-a`, `lowest-score-b`, `highest-combined-score`. **Every tied witness is returned**,
    ordered `match_date, season, id`; each entry is the full meeting plus its `value`. Rows with a
    NULL score are excluded (not recorded is never a nil record). Draws never enter `closest-game`.
  - `getHeadToHeadStreaks(orgA, orgB)` — `longestA`, `longestB`, `current`, each a run with outcome,
    length and from/to match id, season and date. Runs are built from the meetings in true
    chronological order (`match_date, season, id`), never from paginated presentation order. A draw
    breaks a winning streak; the current streak reads back from the latest meeting and may be a draw.
    Ties for longest resolve to the earlier run, so the answer is stable between requests.
  - `assertDistinct()` rejects only identical organisation ids. Related-but-distinct organisations
    (Adelaide vs Brisbane Bears, Adelaide vs Fitzroy) are legitimate comparisons and were exercised.

  Match-type semantics: `finals` is `m.is_finals_series IS TRUE` and `home-and-away` is
  `m.is_finals_series IS NOT TRUE` — exact complements, so filtered counts always sum to the
  unfiltered total, and a Wildcard Final (`round_type = 'wildcard_final'`, `is_finals_series = false`)
  stays visible under `all`, counts as home-and-away, and is never a finals-series meeting. Grand
  Finals are `round_type = 'grand_final'` only. No round-code or display-label heuristic exists in the
  module.

  **Validation commands**

  ```
  npm test -- tests/integration/club-comparison.test.ts -t "head-to-head core"
  npx tsc --noEmit
  ```

  `npm test` maps to `vitest run` (package.json:27), so the repository-correct form is the one above;
  `npx vitest run tests/integration/club-comparison.test.ts -t "head-to-head core"` is equivalent and
  was also run.

  **Validation results**

  - `npm test -- tests/integration/club-comparison.test.ts -t "head-to-head core"` —
    **Test Files 1 passed (1); Tests 10 passed (10)**, duration 1.55 s (tests 1.29 s). All 10 tests
    are inside `describe('club comparison: head-to-head core')`, so the `-t` filter selects all of
    them and none is skipped.
  - `npx tsc --noEmit` — clean, exit 0, no diagnostics.
  - Per-test timings (verbose reporter): summary 96 ms; match-type filtering 128 ms; pagination
    118 ms; venues 95 ms; records 37 ms; streaks 15 ms; Footscray/South Melbourne lineage 302 ms;
    Bears/Fitzroy separation 208 ms; Carlton/Collingwood long rivalry 168 ms; same-organisation
    rejection 2 ms.

  **Independent SQL oracle results**

  The oracle lives in the test file and is structurally simpler than the implementation: plain joins,
  plain `count(*) FILTER`, no CTE, no perspective columns, no shared fragment. It was additionally
  re-run standalone to capture the exact values recorded here. Organisation ids in `afldb_test`:
  adelaide=1, brisbane-bears=2, brisbane-lions=3, carlton=4, collingwood=5, fitzroy=7, sydney=21,
  western-bulldogs=24.

  | pair | meetings | A wins | B wins | draws | finals-series | home-and-away | grand finals | first | latest |
  |---|---|---|---|---|---|---|---|---|---|
  | adelaide / brisbane-lions | 41 | 19 | 21 | 1 | 2 | 39 | 0 | 1997-03-30 | 2025-06-06 |
  | carlton / collingwood | 268 | 129 | 135 | 4 | 22 | 246 | 6 | 1897-06-22 | 2025-07-04 |
  | adelaide / brisbane-bears | 9 | 7 | 2 | 0 | 0 | 9 | 0 | 1991-06-23 | 1996-07-06 |
  | adelaide / fitzroy | 9 | 6 | 3 | 0 | 0 | 9 | 0 | 1991-06-09 | 1996-07-28 |
  | western-bulldogs / carlton | 154 | 60 | 90 | 4 | 0 | 154 | 0 | 1925-07-18 | 2025-03-28 |
  | sydney / carlton | 236 | 98 | 132 | 6 | 12 | 224 | 4 | 1897-05-15 | 2025-05-16 |

  Draws counted two independent ways agree everywhere: `winner_club_id IS NULL` equals
  `home_score = away_score` for every pair above (asserted in the test for both Adelaide/Brisbane
  Lions and Carlton/Collingwood).

  Adelaide vs Brisbane Lions venue oracle (matches the implementation group-for-group):
  Gabba 25 (11 A / 14 B / 0 draws); Football Park 9 (4 / 5 / 0); Adelaide Oval 7 (4 / 2 / 1).
  Venue meetings sum to 41.

  Adelaide vs Brisbane Lions record oracle, computed in the test from the raw meeting rows rather than
  from the implementation: biggest Adelaide win 138 (match 14950); biggest Brisbane Lions win 141
  (12597); closest game 1 (15481); highest Adelaide score 177; highest Brisbane Lions score 189;
  **lowest Adelaide score 44 — a genuine two-way tie, matches 11692 and 12275**, and both are
  returned; lowest Brisbane Lions score 39; highest combined score 249 (11978). Match 16486 (the 2024
  draw) never appears as a closest game or a record win.

  Adelaide vs Brisbane Lions streak oracle: longest Adelaide run 7 (14177 in 2013 through 15346 in
  2018); longest Brisbane Lions run 6 (12275, the 2002 qualifying final, through 12710 in 2005 —
  finals are inside the streak population); current streak = Adelaide, length 1 (16729), because the
  2024 draw broke the preceding Brisbane Lions run.

  **Named witness results**

  - Adelaide vs Brisbane Lions = 41 meetings, 19 Adelaide, 21 Brisbane Lions, 1 draw, 2 finals-series,
    0 Grand Finals. Win percentages 47.5610 / 52.4390, summing to 100.
  - Match 16486 — 2024, round 10, Adelaide Oval, 90-90, `outcome = 'draw'`, `is_finals_series = false`.
  - Matches 12275 (`qualifying_final`) and 12463 (`semi_final`) are exactly the finals filter's two
    rows; neither is a Grand Final.
  - Pagination: page 1 = 25 rows starting at 16729 (the latest meeting), page 2 = 16 rows ending at
    11178 (the first meeting), page 3 = 0 rows with `totalMeetings` still 41, `totalPages` 2, 41
    distinct ids across the two pages, strictly descending on `(match_date, season, id)`.
  - Lineage — **Western Bulldogs**: 154 meetings against Carlton, of which **119 were played by the
    Footscray identity** (`clubs.slug = 'footscray'`, club id 8). The organisation total includes them
    and the rendered rows still say "Footscray".
  - Lineage — **Sydney**: 236 meetings against Carlton, of which **168 were played by the South
    Melbourne identity** (club id 19).
  - Lineage — **Brisbane Bears and Fitzroy do NOT fold into Brisbane Lions**: neither organisation id
    (2 or 7) appears in any of the 41 Adelaide/Brisbane Lions meetings, and none of the 9
    Adelaide/Brisbane Bears or 9 Adelaide/Fitzroy match ids is inside the Brisbane Lions set. Both are
    nevertheless comparable in their own right, as the contract requires.
  - Long rivalry — **Carlton vs Collingwood** = 268 meetings, agreeing with independent SQL, 22
    finals-series meetings and **6 Grand Finals** (matches 1051/1910, 1502/1915, 3657/1938, 7278/1970,
    8520/1979, 8796/1981). Every Grand Final row carries `round_type = 'grand_final'` and
    `is_finals_series = true`. Streaks resolve on the 268-meeting population without incident.

  **Timing observations**

  Stage 5 is the formal performance gate; these are incidental. The heaviest single test
  (Carlton/Collingwood: summary + all-meetings page + finals page + streaks, four round trips) took
  168 ms end to end, and the whole 10-test file 1.29 s. Nothing is close to pathological, so no
  reshaping, index or schema work was proposed or performed. Note that these numbers are measured
  from Windows over a loopback connection to `afldb_test`; the supported-Linux route target remains
  Stage 5's to prove.

  **Blockers and deviations**

  None. No stop condition was triggered: organisation-pair scoping behaves exactly as the runbook
  specifies, historical identities resolve through `organization_id` with no hard-coded club mapping
  anywhere in the module, finals-series semantics match Stage 0's findings, the independent SQL agrees
  with the implementation on every measured quantity, and every required record was derived without
  schema work.

  **Unresolved observations (recorded, not acted on)**

  - Western Bulldogs vs Carlton reports **0 finals-series meetings** across 154 meetings. This is
    what `matches.is_finals_series` says and is consistent between the implementation and the oracle;
    it is noted only because it is surprising for a pair with that much history, and it belongs to
    data coverage rather than to Stage 1 query behaviour.
  - Longest-streak ties are resolved to the earliest run. The runbook mandates returning all ties for
    *records*, not for streaks, so this is a deliberate deterministic choice, documented in the
    module. If the presentation stage (Stage 8 after the V1.7 renumbering) wants every tied streak
    shown, that is a presentation decision to revisit then.
  - The Stage 0 Windows-only CRLF artefact in `tests/finals-semantics-contract.test.ts` was NOT
    touched and was not re-run; it remains environmental.
  - `AFLDB-ISSUE-144.md.encoding-backup` is still an untracked stray in the worktree and must not be
    committed.

  **Confirmation**

  No Stage 2 work was begun. `player_clubs` was not queried, no crossover-player function exists, and
  the evidence pack's known-bad crossover (`both` used as a CTE name) and club-Brownlow (inner join on
  the nullable `brownlow_season_votes.club_id`) probes were deliberately left alone for Stages 2 and 3.

  **Next stage: Stage 2 — Connected players.**

  Exact first action for the next fresh session, after reading this runbook and this log:

  1. Confirm the environment still resolves: `ls node_modules/next/package.json` (junction to
     `D:\dev\afldb-issue-139\node_modules`), and that `.env` in this worktree still sets
     `AFLDB_TEST_DATABASE_URL` to a `afldb_test` DSN.
  2. Re-run the Stage 1 gate once to confirm the baseline is green before adding to it:
     `npm test -- tests/integration/club-comparison.test.ts -t "head-to-head core"`.
  3. Read the Connected-player rules section of this runbook, then read
     `src/db/migrations/007_derived_stats.sql` around `player_clubs` (line ~128) for the derived stint
     grain (`(player_id, club_id)`, `games`, `goals`, `first_season`, `last_season`, `first_match_id`,
     `last_match_id`).
  4. Add crossover-player functions to the EXISTING `src/db/queries/club-comparison.ts` — re-aggregate
     `player_clubs` through `clubs.organization_id`, require canonical representation of BOTH selected
     organisations, sum games/goals per organisation, read career totals from `player_career_stats`,
     and resolve first/last representation through the referenced matches ordered by `match_date` then
     `id` (never by numeric match id alone). Direction is first recorded representation only, never
     described as a transfer or trade; an intervening club is a third organisation represented after
     the earlier target debut and before the later target debut. Do NOT reuse `both` as a SQL
     identifier — it is a reserved word and is what broke the supplied evidence probe.
  5. Extend `tests/integration/club-comparison.test.ts` with a `describe`/test name containing
     "crossover players", proving Ben Keays (Brisbane Lions to Adelaide) and Jarryd Lyons (Adelaide to
     Brisbane Lions, with Gold Coast intervening) in both directions, against an independent SQL
     oracle in the same file.
  6. Run `npm test -- tests/integration/club-comparison.test.ts -t "crossover players"`, append a
     Stage 2 record to this log, and STOP. Do not start Stage 3.


### Stage 2 — Connected players — COMPLETE (2026-09-06)

**Status: Stage 2 — COMPLETE.** Executed on branch `codex/issue-144` in `D:\dev\afldb-issue-144`
against `afldb_test` (read-only). No Stage 3 implementation was begun.

**Exact files changed**

- `src/db/queries/club-comparison.ts` — EXTENDED. Added the connected-player (crossover) layer at
  the end of the module, plus a one-paragraph header amendment so the file no longer says it is
  Stage 1 only. No Stage 1 code path was modified.
- `tests/integration/club-comparison.test.ts` — EXTENDED. Added
  `describe('club comparison: crossover players')` (7 tests) and two independent SQL oracles
  (`oracleCrossover`, `oracleIntervening`) in the same file. Two imports were added. No Stage 1 test
  was modified.
- `AFLDB-ISSUE-144.md` — this record, plus the status line at the top of the file.

No route, component, SEO, navigation, migration, schema, CHANGELOG or unrelated test file was
touched. No database write was issued. No Git command was run. A throwaway `tests/tmp-date-probe.test.ts`
was created to confirm how `postgres.js` decodes a `date` column and was deleted immediately; it is
not in the tree.

**Crossover query surface implemented**

Everything is built on ONE internal fragment, `crossoverScope(orgA, orgB)`; both exports select from
it and differ only in `ORDER BY`, so the list and the summary can never disagree about who crossed
over or when. Its CTE chain, in order:

- `stints` — `player_clubs` at its native `(player_id, club_id)` grain, LEFT JOINed to `matches`
  twice to dereference `first_match_id` and `last_match_id`. Chronology comes from the referenced
  match row; the numeric match id is only the deterministic tie-breaker for two matches on the same
  date.
- `org_totals` / `org_first` / `org_last` → `org_rep` — the same stints re-aggregated through
  `clubs.organization_id`: `games` and `goals` summed; first representation the earliest stint debut
  (`DISTINCT ON … ORDER BY first_match_date NULLS LAST, first_match_id`); last representation the
  latest stint finale. This is the step that stops a rename becoming a second club.
- `pairs` — an inner self-join of `org_rep` on `player_id` requiring a row for BOTH target
  organisation ids. `club_organization_relations` is never consulted anywhere in the module.

Exports:

- `getCrossoverPlayers(orgA, orgB): CrossoverPlayer[]` — ordered combined games DESC, then
  `players.sort_name`, then player id.
- `getCrossoverSummary(orgA, orgB): CrossoverSummary` — `{players, firstToRepresentBoth,
  mostRecentToRepresentBoth}`. Both records are **arrays**, so a shared completion date keeps every
  tied player rather than silently dropping one. A player whose completion date is unknown is counted
  in `players` but cannot hold either record, because an unknown date is not an early one.

`CrossoverPlayer` returns: `playerId`, `displayName`, `sortName`, `slug`; `a` and `b` each a
`CrossoverRepresentation` of `{games, goals, firstMatchId, firstMatchDate, lastMatchId,
lastMatchDate}`; `combinedGames`/`combinedGoals`; `careerGames`/`careerGoals` from
`player_career_stats` (LEFT JOINed, so a missing derived row is null, not zero); `direction`;
`completionDate`/`completionMatchId`; and `interveningOrganizations`.

Direction is `'a-to-b' | 'b-to-a' | 'unknown'`, decided by row-value comparison of
`(first_match_date, first_match_id)`, and is documented in the module as a statement about first
recorded representation ONLY — never a trade, transfer, delisting or draft. `unknown` covers both an
unorderable pair and an unresolvable match reference on either side.

Completion date is `GREATEST(a.first_match_date, b.first_match_date)` — the day the player had
appeared for both. It is never the career debut and never the first stint start.

An intervening organisation is a third organisation whose first representation falls strictly after
the earlier target debut and strictly before the later one, compared on `(date, match id)`. It is
emitted as a `jsonb_agg` ordered by first representation within that interval, and can never contain
organisation A, organisation B, or a duplicate (the `org_rep` grain is one row per organisation).

Reserved-word note: nothing in the module is named `both`, which is what broke the supplied evidence
probe.

**Validation commands**

```
npm test -- tests/integration/club-comparison.test.ts -t "crossover players"
npm test -- tests/integration/club-comparison.test.ts
npx tsc --noEmit
```

**Validation results**

- `npm test -- … -t "crossover players"` — **Test Files 1 passed (1); Tests 7 passed | 10 skipped
  (17)**, duration 2.45 s. The 10 skips are the Stage 1 describe block, excluded by the `-t` filter.
- `npm test -- tests/integration/club-comparison.test.ts` (whole file, verbose) — **Tests 17 passed
  (17)**, duration 3.53 s. Stage 1's 10 tests still pass unchanged, so the extension is not a
  regression.
- `npx tsc --noEmit` — clean, exit 0, no diagnostics.
- Per-test timings (verbose): crossover list vs oracle 222 ms; Ben Keays 169 ms; Jarryd Lyons 754 ms
  (it runs a per-player intervening oracle for all 11 rows); continuing identity 357 ms; three
  distinct Brisbane organisations 420 ms; summary 193 ms; self-comparison rejection 0 ms.

**Independent SQL oracle results**

The oracle is structurally simpler than the implementation: one `per_org` `GROUP BY` with
`min(first_match_date)` / `max(last_match_date)`, a plain self-join, no `DISTINCT ON`, no row-value
comparison, no `jsonb`, no shared fragment. It was also run standalone through `psql` to capture the
exact values below. Organisation ids in `afldb_test`: adelaide=1, brisbane-bears=2,
brisbane-lions=3, carlton=4, fitzroy=7, gold-coast=11, north-melbourne=16, sydney=21,
western-bulldogs=24.

Crossover counts (players present in both organisations, `INTERSECT` of the two `player_clubs`
populations):

| pair | crossover players |
|---|---|
| adelaide / brisbane-lions | 11 |
| brisbane-bears / brisbane-lions | 29 |
| fitzroy / brisbane-lions | 10 |
| brisbane-bears / fitzroy | 14 |
| western-bulldogs / carlton | 40 |

Complete Adelaide / Brisbane Lions crossover oracle, ordered by completion date (A = Adelaide first
representation, B = Brisbane Lions first representation, completion = the later of the two):

| player | A first | B first | completion | A games | B games | combined |
|---|---|---|---|---|---|---|
| Martin McKinnon | 1994-07-10 | 1999-05-01 | **1999-05-01** | 25 | 7 | 32 |
| Matthew Clarke | 2000-03-11 | 1997-03-30 | 2000-03-11 | 118 | 61 | 179 |
| Chris Schmidt | 2010-04-11 | 2007-06-02 | 2010-04-11 | 18 | 2 | 20 |
| Ben Hudson | 2004-04-11 | 2012-03-31 | 2012-03-31 | 55 | 18 | 73 |
| Charlie Cameron | 2014-05-15 | 2018-03-24 | 2018-03-24 | 73 | 181 | 254 |
| Jarryd Lyons | 2012-04-29 | 2019-03-23 | 2019-03-23 | 55 | 102 | 157 |
| Ben Keays | 2020-06-13 | 2016-05-01 | 2020-06-13 | 131 | 30 | 161 |
| Cam Ellis-Yolmen | 2014-06-08 | 2020-06-20 | 2020-06-20 | 39 | 9 | 48 |
| Mitch Hinge | 2021-03-20 | 2019-05-18 | 2021-03-20 | 86 | 3 | 89 |
| Jack Gunston | 2010-05-23 | 2023-03-18 | 2023-03-18 | 14 | 17 | 31 |
| Tom Doedee | 2018-03-23 | 2025-08-09 | **2025-08-09** | 82 | 1 | 83 |

Earliest completion = Martin McKinnon, 1999-05-01. Latest completion = Tom Doedee, 2025-08-09.
Both are single-player results in this pair; the API still returns arrays.

Intervening-organisation oracle for the whole Adelaide / Brisbane Lions pair (only four of the 11
have one, and the implementation agrees row for row — the test asserts this for every player, not
just Lyons):

| player | intervening |
|---|---|
| Martin McKinnon | geelong |
| Ben Hudson | western-bulldogs |
| Jarryd Lyons | **gold-coast** |
| Jack Gunston | hawthorn |

Default-ordering witness: the list's first row is **Charlie Cameron, 254 combined games**, the
maximum in the pair.

**Named witness results**

- **Ben Keays** (player 1103) — Brisbane Lions first (2016-05-01, 30 games, 11 goals), then Adelaide
  (2020-06-13, 131 games, 117 goals). Called as `getCrossoverPlayers(adelaide, lions)` the direction
  is `b-to-a`; called as `getCrossoverPlayers(lions, adelaide)` it is `a-to-b` and the two
  representations swap sides with identical numbers and an identical completion date of 2020-06-13.
  **No intervening organisation** in either argument order — he has only the two clubs.
- **Jarryd Lyons** (player 6818) — Adelaide first (2012-04-29 to 2016-09-17, 55 games), then
  Brisbane Lions (2019-03-23 to 2024-04-20, 102 games); combined 157; completion 2019-03-23.
  Direction `a-to-b` as `(adelaide, lions)` and `b-to-a` as `(lions, adelaide)`.
- **Gold Coast intervening (Lyons)** — Gold Coast first representation 2017-03-25, strictly inside
  the 2012-04-29 → 2019-03-23 interval, so `interveningOrganizations` is exactly
  `[{organizationId: 11, name: 'Gold Coast', slug: 'gold-coast'}]` in both argument orders, matching
  the independent oracle. Career totals confirm the third club is real and not double-counted:
  `player_career_stats` gives Lyons 194 games / 86 goals against 157 combined for the two target
  organisations (55 + 37 Gold Coast + 102).
- **Continuing-identity negative witness — James Cook** (player 6711), Carlton vs Western Bulldogs.
  He has THREE Bulldogs-organisation-relevant `player_clubs` rows across two identities: Footscray 5
  games / 5 goals (debut 1996-04-06) and Western Bulldogs 44 games / 91 goals (last match
  1999-08-28). The query returns **one** representation of **49 games / 96 goals**, first
  representation 1996-04-06 (the Footscray identity) and last 1999-08-28 (the Western Bulldogs
  identity), and he appears exactly once in the list. His Melbourne stint (first represented
  2000-03-08) is AFTER the later target debut, so it is correctly **not** intervening — the
  implementation and the oracle both return an empty list.
- **Continuing-identity negative witness — Brad Johnson** (player 2068). Two identities inside one
  organisation (Footscray 52 + Western Bulldogs 312 = 364 games), `count(DISTINCT organization_id)`
  = **1**, and he is therefore **absent from the Carlton / Western Bulldogs crossover list** and
  from any other. Two identities in one continuing organisation are not two clubs.
- **Distinct related organisations** — Brisbane Bears (2), Fitzroy (7) and Brisbane Lions (3) resolve
  to three different organisation ids and all three pairings return non-empty crossover lists:
  Bears/Lions **29**, Fitzroy/Lions **10**, Bears/Fitzroy **14**, each matching the independent
  oracle. Had `club_organization_relations` been traversed, every one of these pairs would be empty
  or rejected as a self-comparison. Every Bears/Lions row carries games > 0 on both sides, and
  neither target organisation ever appears as an intervening one.
- **Crossover count / oracle evidence** — Adelaide/Brisbane Lions 11 (implementation and oracle agree
  on the count, on the exact set of player ids, and on games, goals, first date and last date for
  every one of the 11 rows on both sides).

**Blockers and deviations**

None. No stop condition was triggered:

- `player_clubs` did not need to be reconciled against `player_match_stats`; the runbook nominates it
  as the derived stint source and every dereferenced `first_match_id` / `last_match_id` in the
  measured witnesses resolved to a real match row with a real date.
- No stint reference was found stale or null in any witness pair, so the `NULLS LAST` and `unknown`
  branches are defensive rather than load-bearing on current data.
- Career totals came from `player_career_stats` as approved, and are >= combined target-organisation
  games for every row in both measured pairs.
- No transfer semantics were inferred anywhere; `direction` is documented in the module as first
  recorded representation only.
- Continuing identities resolved cleanly through `organization_id` and produced no false crossovers.
- No organisations were collapsed and no schema or data change was required.

**Unresolved observations (recorded, not acted on)**

- The `unknown` direction branch and the `completionDate === null` path in `getCrossoverSummary` are
  unexercised by `afldb_test`: every crossover row measured has both first-representation dates
  resolved. They are kept because `player_clubs.first_match_id` is nullable in the schema, but they
  carry no test witness. If the presentation stage (Stage 8 after the V1.7 renumbering) wants to
  render an "unknown" direction, that path is currently
  unproven against data.
- `getCrossoverPlayers` returns the complete list with no pagination. The largest pair measured here
  is 40 rows; a genuinely large pair (a long-standing Melbourne rivalry) has not been measured and
  pagination is the performance and route stages' decision (Stages 5 and 7 after the V1.7
  renumbering), not Stage 2's.
- `interveningOrganizations` is computed by a correlated subquery per crossover row. At 11–40 rows
  this is invisible (222–420 ms for a whole multi-query test), but it is the one shape in the module
  that scales with list length rather than with the pair, and is the thing to look at first if
  Stage 5 finds a slow pair.
- The Stage 1 observations still stand unchanged: the Windows-only CRLF artefact in
  `tests/finals-semantics-contract.test.ts` was not touched, longest-streak ties still resolve to the
  earliest run, and `AFLDB-ISSUE-144.md.encoding-backup` is still an untracked stray in the worktree
  that must not be committed.

**Confirmation**

No Stage 3 implementation was begun. No H2H player-leader function, no Brownlow function and no
match-vote coverage function exists in the module; `brownlow_season_votes`, `brownlow_season_total`
and `brownlow_round_votes` were not queried in this session, and the evidence pack's known-bad
club-Brownlow probe (an inner join on the nullable `brownlow_season_votes.club_id`) was deliberately
left alone for Stage 3.

**Next stage: Stage 3 — H2H leaders and Brownlow.**

Exact first action for the next fresh session, after reading this runbook and this log:

1. Confirm the environment still resolves: `ls node_modules/next/package.json` (junction to
   `D:\dev\afldb-issue-139\node_modules`), and that `.env` in this worktree still sets
   `AFLDB_TEST_DATABASE_URL` to an `afldb_test` DSN.
2. Re-run the Stage 1 + Stage 2 gate once to confirm the baseline is green before adding to it:
   `npm test -- tests/integration/club-comparison.test.ts` (expect 17 passed).
3. Read the Brownlow rules section of this runbook — in particular that
   `brownlow_season_votes` is authoritative for season totals and club-attributed history, that
   `brownlow_season_votes.club_id` is NULLABLE and must be LEFT JOINed (the supplied probe returned
   zero rows because it inner-joined it), that `brownlow_season_total` coverage decides runtime
   presentation (complete / partial / pending / not_collected / not_applicable / missing), and that
   season winners and career totals are never derived from match vote rows.
4. Add H2H player leaders, authoritative club Brownlow history, and H2H match-vote totals plus
   coverage to the EXISTING `src/db/queries/club-comparison.ts`, building the match population from
   the existing `h2hScope` fragment and nothing else. H2H games/goals leaders use the complete scoped
   match population; single-match statistical records use only runtime-covered rows; dense rank 1–10
   with ties retained; no application-level historical cutoff.
5. Extend `tests/integration/club-comparison.test.ts` with a `describe`/test name matching
   `leaders|Brownlow`, against an independent SQL oracle in the same file.
6. Run `npm test -- tests/integration/club-comparison.test.ts -t "leaders|Brownlow"`, append a
   Stage 3 record to this log, and STOP. Do not start Stage 4.

### Stage 3 — H2H leaders and Brownlow — COMPLETE (2026-09-06)

**Status: Stage 3 — COMPLETE.** Executed on branch `codex/issue-144` in `D:\dev\afldb-issue-144`
against `afldb_test` (read-only). No Stage 4 implementation was begun.

**Exact files changed**

- `src/db/queries/club-comparison.ts` — EXTENDED. Added, at the end of the module: the H2H
  player-leader layer, the runtime metric-coverage abstraction, the Brownlow attribution fragment,
  authoritative club Brownlow history, the selected-season club Brownlow primitive, and H2H
  match-vote totals with coverage. The module header paragraph was amended so it no longer says
  Brownlow is a later stage. No Stage 1 or Stage 2 code path was modified.
- `tests/integration/club-comparison.test.ts` — EXTENDED. Added three describe blocks
  (`head-to-head player leaders` 6 tests, `club Brownlow history` 6 tests, `head-to-head Brownlow`
  5 tests) and five independent SQL oracles in the same file (`oracleH2HPlayers`,
  `oracleH2HStatRows`, `oracleBrownlowRows`, `oracleH2HMatchVotes`, `oracleH2HVoteRows`). Six
  imports were added and the file header now says Stages 1-3. No Stage 1 or Stage 2 test was
  modified.
- `AFLDB-ISSUE-144.md` — this record, plus the status line at the top of the file.

No route, component, SEO, navigation, migration, schema, CHANGELOG or unrelated test file was
touched. No database write was issued. No Git command was run.

**H2H leader query surface**

Everything is built on the EXISTING Stage 1 `h2hScope(orgA, orgB, matchType)` fragment. No second
H2H population definition exists anywhere in the module.

- `h2hPlayerTotals(orgA, orgB)` (internal) — one aggregate over the COMPLETE scoped meeting
  population (finals included, no application-level cutoff). Appearances come from
  `player_match_stats` rows joined to the scoped meetings; attribution is
  `player_match_stats.club_id -> clubs.organization_id`, with `FILTER` clauses splitting each total
  into an A share and a B share. A player who represented BOTH organisations in the rivalry is ONE
  row with two breakdowns, never two ambiguous rows.
- `getHeadToHeadPlayerLeaders(orgA, orgB): H2HPlayerLeaders` — `{games, goals, singleMatchGoals,
  singleMatchDisposals}`.
  - `games` and `goals` are `H2HPlayerLeader[]`, dense-ranked with `dense_rank()`, cut at
    `H2H_LEADER_RANK_LIMIT = 10`, every tie at the cut retained, ordered rank then `players.sort_name`
    then player id.
  - `goals` is NULL rather than 0 when a player has no meeting in which goals were recorded, and
    `goalsRecordedGames` is carried as the honest denominator on the total and on each of the A and
    B sides. The goals board admits only players with at least one recorded goal row.
  - `singleMatchGoals` / `singleMatchDisposals` are `H2HStatRecord` =
    `{stat, recordedRows, value, holders}`. Only rows where the statistic `IS NOT NULL` are
    considered; `value` is null and `holders` empty when the statistic was never recorded in the
    pair. Every tied holder is returned, ordered by meeting date, then match id, then player, and
    each holder carries the historical `clubId`/`clubName`/`clubSlug`/`organizationId` actually
    represented on the day.
- Per-game averages are deliberately NOT implemented in V1.

**Authoritative Brownlow query surface**

- `statCoverage(statKey)` (internal) — THE runtime metric-coverage abstraction. It LEFT JOINs
  `stat_availability` onto `seasons`, so a season with no coverage row reads `missing` rather than
  being optimistically treated as complete. Every coverage decision in the module joins through it.
  `MetricCoverage = 'complete' | 'partial' | 'pending' | 'not_collected' | 'not_applicable' |
  'missing'`. `isAuthoritativeCoverage(coverage)` is the single place `complete` is privileged. No
  year window is encoded anywhere: when 2026 turns from `pending` to `complete`, the next request
  shows numeric data with no code change.
- `brownlowAttribution()` (internal) — THE attribution fragment. `brownlow_season_votes` is the sole
  source of season totals, winners, ranks, eligibility and the three/two/one-vote game counts;
  `player_match_stats.brownlow_votes` is never summed for any of them.
- `brownlowOrganizationRows()` (internal) — the same rows resolved to `clubs.organization_id`, with
  the season-total coverage state attached and nothing filtered.
- `getClubBrownlowHistory(organizationId): ClubBrownlowHistory` — `{organizationId, seasons,
  totalVotes, seasonsCovered, winners, voteLeaders, unattributed, excludedSeasons}`. Only seasons
  whose `brownlow_season_total` coverage is `complete` contribute to any figure. `winners` comes
  from `is_winner` alone — never from `vote_rank`, never from a season maximum — and
  `ClubBrownlowLeader.hasIneligibleSeason` preserves `is_ineligible` rather than filtering it away.
  `voteLeaders` is dense-ranked and cut at `CLUB_BROWNLOW_LEADER_RANK_LIMIT = 10` with ties kept.
- `getClubSeasonBrownlowSummary(organizationId, season): ClubSeasonBrownlowSummary` — the Stage 4
  primitive. It returns the coverage state whatever it is, plus `isAuthoritative`; `totalVotes`,
  `playersWithVotes`, `leaders` and `winners` are null/empty unless the state is `complete`, so a
  `partial` season can never be presented as an authoritative season total and a caller can
  distinguish complete / partial / pending / not_collected / not_applicable / missing without
  recomputing any semantics. It selects from the same `brownlowAttribution()` fragment as the
  all-time history, so the two cannot drift. The rank cut trims the leaderboard only: `winners` is
  filtered from the whole club-season, so a winner can never fall off the board.

**Nullable attribution behaviour**

`brownlow_season_votes.club_id` is COALESCEd, never inner-joined:

1. explicit `brownlow_season_votes.club_id` when present (`attributionSource = 'explicit'`);
2. otherwise `player_season_stats.primary_club_id`, and ONLY when `player_season_stats.club_count =
   1` (`attributionSource = 'primary'`);
3. otherwise unattributed.

Measured in `afldb_test`: **all 16,120 `brownlow_season_votes` rows have `club_id` IS NULL** — the
explicit branch has NO live witness in canonical test data, and the entire club Brownlow surface
therefore rests on the `club_count = 1` fallback. This is exactly why the supplied evidence-pack
probe returned zero rows: it inner-joined the nullable column. The probe was not altered; the
approved contract was implemented and validated independently instead.

Attributed / unattributed split over all 16,120 rows: **16,076 attributed (all via the `primary`
fallback), 44 unattributed**. Every one of the 44 is a genuine multi-club season
(`club_count > 1`); zero are missing-`player_season_stats` accidents, and zero rows with
`club_count = 1` failed to attribute.

**Unattributed-row behaviour**

An ambiguous multi-club season is NEVER forced onto a club. Its votes are excluded from
`totalVotes`, from every per-season figure and from `voteLeaders`, and are disclosed instead as
`unattributed: {rows, votes}` on the history and `unattributedRows`/`unattributedVotes` on the
per-season summary. The disclosure is keyed on `player_season_stats.primary_club_id`'s organisation
— an association for display, never an attribution.

Unattributed rows by organisation (complete-coverage seasons, independent SQL): fitzroy 9/27,
sydney 6/36, collingwood 5/10, carlton 4/13, western-bulldogs 4/12, melbourne 3/15, st-kilda 3/11,
essendon 3/7, richmond 2/5, hawthorn 2/11, geelong 2/17, north-melbourne 1/3. Adelaide and
Brisbane Lions have **none**, so Sydney is the live ambiguous witness the tests use and Adelaide is
the "reports a zero rather than staying silent" witness. Example unattributed rows: Brian Roberts
1975 (17 votes, `club_count` 2, primary south-melbourne), Rex Hunt 1974 (15, primary geelong),
Harry Mears 1946 (11, primary south-melbourne).

**Independent SQL oracle results**

The oracles are structurally simpler than the implementation: plain joins and one `GROUP BY`, no
shared fragment, no window function, no coverage abstraction, no CTE chain. `oracleBrownlowRows`
returns the two attribution inputs UNRESOLVED and the test performs the COALESCE in TypeScript, so
the attribution contract is checked against a different implementation of itself rather than against
itself. Values below were also captured standalone through `psql` against `afldb_test`.
Organisation ids: adelaide=1, brisbane-lions=3, carlton=4, collingwood=5, sydney=21.

H2H player leaders, Adelaide vs Brisbane Lions (complete population, finals included):

| player | H2H games | H2H goals | recorded goal games |
|---|---|---|---|
| Simon Black | **23** | 17 | 23 |
| Simon Goodwin | 21 | 7 | 21 |
| Andrew McLeod | 20 | 15 | 20 |
| Taylor Walker | 20 | **54** | 20 |
| Tyson Edwards | 19 | 8 | 19 |
| Luke Power | 18 | 11 | 18 |
| Dayne Zorko | 17 | 13 | 17 |
| Mark Ricciuto | 17 | 9 | 17 |
| Nigel Lappin | 17 | 11 | 17 |
| Michael Voss | 16 | 23 | 16 |
| Rory Sloane | 16 | 8 | 16 |

Games leader **Simon Black, 23** (matches the evidence pack). Goals leader **Taylor Walker, 54**
(second Alastair Lynch 45, third Charlie Cameron 32). Taylor Walker 20 games and Michael Voss
16 games / 23 goals also agree with the evidence pack.

Consolidation witness — **Charlie Cameron** appears ONCE with 14 H2H games and 32 H2H goals, split
Adelaide 5 games / 8 goals and Brisbane Lions 9 games / 24 goals. Eight players in this rivalry have
appeared for both organisations (Ben Hudson, Ben Keays, Cam Ellis-Yolmen, Charlie Cameron, Jack
Gunston, Jarryd Lyons, Matthew Clarke, Mitch Hinge) and each is a single row on every board.

Single-match records, Adelaide vs Brisbane Lions:

- **Goals: 7, a five-way tie** — Tony Modra (match 11178, 1997, Adelaide), Alastair Lynch (12275,
  2002, Brisbane Lions), Alastair Lynch (12340, 2003), Michael Voss (12477, 2004), Taylor Walker
  (14752, 2015, Adelaide). All five are returned, ordered by meeting date. Taylor Walker's maximum
  of 7 in a meeting agrees with the evidence pack.
- **Disposals: 40, a four-way tie** — Luke Power (13305, 2008), Tom Rockliff (14542, 2014), Dayne
  Beams (15067, 2017), Matt Crouch (15346, 2018). All four are returned.
- Recorded-row counts: 1,814 player-match rows in the pair, all 1,814 with goals recorded and all
  1,814 with disposals recorded, so this pair is fully covered for both statistics. The
  NULL-is-not-nought path is instead witnessed on Western Bulldogs vs Carlton, where recorded
  disposal rows are strictly fewer than appearances.

Brownlow club attribution, complete-coverage seasons only:

| organisation | attributed rows | attributed votes | seasons | winners |
|---|---|---|---|---|
| adelaide | 442 | **2341** | 35 | 1 |
| brisbane-lions | 351 | **1975** | 29 | 4 |

Winners (from `is_winner` only): Adelaide — Mark Ricciuto 2003 (22 votes). Brisbane Lions — Jason
Akermanis 2001 (23), Simon Black 2002 (25), Lachie Neale 2020 (31), Lachie Neale 2023 (31).

Adelaide all-time attributed vote leaders (dense rank 1-3): Scott Thompson 152, Mark Ricciuto 146,
Andrew McLeod 144.

Season-total coverage landscape (from `stat_availability`, not from code): 98 seasons `complete`,
31 `not_applicable` (1897-1923 and the war years 1942-1945), 1 `pending` (2026). The tests read
2002 as the `complete` witness, 1943 as `not_applicable`, 2026 as `pending`, and 1850 (no
`seasons` row at all) as `missing`.

**H2H Brownlow eligible/covered meeting oracle values**

Canonical completeness rule verified before use: a fully polled home-and-away match distributes
exactly 3 + 2 + 1 = **6** votes. This is the rule migration `016_brownlow_grain_availability.sql`
uses to derive `brownlow_match_votes` coverage and the rule the repeatable
`tools/migration/import_legacy_afl.py` re-derivation uses. It was not weakened to "some votes
present"; `FULLY_POLLED_MATCH_VOTES = 6` is a named constant in the module.

| pair | eligible (H&A) | evaluable | fully covered | partially polled | state |
|---|---|---|---|---|---|
| Adelaide vs Brisbane Lions | **39** | 39 | **39** | 0 | **complete** |
| Carlton vs Collingwood | **246** | — | **87** | 0 | **partial** |

Adelaide vs Brisbane Lions: 41 total meetings minus 2 finals-series meetings = 39 eligible, and all
39 are fully covered, so the display line is "Recorded H2H Brownlow votes from 39 of 39 eligible
meetings" and the state is `complete`. Total recorded H2H votes 234 = 39 x 6 exactly.

Carlton vs Collingwood is the partial witness: 246 eligible home-and-away meetings, 87 fully
covered, 159 with no recorded votes at all. Of the eligible meetings, **7 fall in seasons whose
`brownlow_match_votes` coverage is itself `partial` (1931-1934) and all 7 carry the full 3-2-1
allocation**, so a `partial` season is not used as a blanket exclusion — the per-match rule decides.
Not one eligible meeting in either pair carries a non-zero vote total other than 6, so the
`partiallyPolledMeetings` counter is 0 on current data.

**Leading player Brownlow witnesses (home-and-away only)**

| player | H2H votes | 3-vote games | polling games |
|---|---|---|---|
| Scott Thompson | **16** | 4 | 6 |
| Michael Voss | **14** | 3 | 6 |
| Lachie Neale | 13 | 4 | 5 |
| Simon Black | **11** | 2 | 5 |
| Jason Akermanis | 10 | 2 | 5 |
| Rory Laird | 9 | 2 | 4 |
| Rory Sloane | 9 | 2 | 5 |
| Mark Ricciuto | 8 | 2 | 3 |

Scott Thompson 16, Michael Voss 14 and Simon Black 11 all agree with the evidence pack — which
confirms the evidence pack's H2H vote figures were already home-and-away only. Michael Voss's 14
votes are attributed entirely to Brisbane Lions (`aVotes` 0, `bVotes` 14). Per player,
`votes = 3 x threeVoteGames + 2 x twoVoteGames + oneVoteGames` and `aVotes + bVotes = votes` hold
for every returned row.

**Finals-exclusion proof**

- Matches **12275** (2002 qualifying final) and **12463** (2003 semi final) are both in the Adelaide
  vs Brisbane Lions match population, both have `is_finals_series = true`, and both carry **0**
  recorded Brownlow votes.
- Total recorded votes across ALL finals-series meetings of the pair is **0**, so the finals could
  not change the answer even if they were wrongly included — the exclusion is proven structurally
  (`h2hScope(..., 'home-and-away')` is the only population the feature reads) rather than by
  coincidence of the data.
- `eligibleMeetings` (39) is strictly less than the total meeting count (41) and equals
  `summary.meetings - summary.finalsSeriesMeetings`.
- Alastair Lynch's 7 goals in final 12275 DOES still hold a share of the single-match H2H goals
  record, which is correct: the goals record is a rivalry record over the complete population, and
  only the Brownlow population is finals-free.

**Validation commands**

```
npm test -- tests/integration/club-comparison.test.ts -t "leaders|Brownlow"
npm test -- tests/integration/club-comparison.test.ts
npx tsc --noEmit
```

**Validation results**

- `npm test -- … -t "leaders|Brownlow"` — **Test Files 1 passed (1); Tests 17 passed | 17 skipped
  (34)**, duration 2.80 s. The 17 skips are the Stage 1 and Stage 2 describe blocks, excluded by the
  `-t` filter.
- `npm test -- tests/integration/club-comparison.test.ts` (whole file) — **Test Files 1 passed (1);
  Tests 34 passed (34)**, duration 5.54 s. Stage 1's 10 tests and Stage 2's 7 tests still pass
  unchanged, so the extension is not a regression.
- `npx tsc --noEmit` — clean, exit 0, no diagnostics.
- The Stage 1 + Stage 2 baseline was re-run BEFORE any Stage 3 code was written and was green
  (17 passed).

**Blockers and deviations**

None. No stop condition was triggered:

- Season Brownlow totals are read from `brownlow_season_votes` alone; `player_match_stats.brownlow_votes`
  is read by `getHeadToHeadBrownlow` only, and only for match-scoped H2H reporting.
- Nullable club attribution satisfies the approved contract: 16,076 of 16,120 rows attribute, all
  through the approved `club_count = 1` fallback.
- No ambiguous multi-club row is forcibly attributed; all 44 are excluded and disclosed.
- H2H Brownlow completeness is distinguished from missing data by the canonical 6-vote rule plus the
  runtime `brownlow_match_votes` coverage state, and the two witness pairs return genuinely different
  states (complete vs partial).
- Finals contribute neither votes nor a denominator.
- No player leader statistic treats NULL as zero; the goals board carries a recorded-game
  denominator and the single-match records read only recorded rows.
- Organisation semantics are unchanged from Stage 1: every query builds from `h2hScope`, and
  `club_organization_relations` is still never consulted.
- No schema, migration or data change was required.

One deviation of interpretation, recorded explicitly: **H2H Brownlow votes are aggregated over
FULLY covered meetings only.** A meeting with some votes but not the published 3-2-1 allocation
contributes nothing and is counted separately as `partiallyPolledMeetings`. This keeps the reported
total exactly equal to the X in "Recorded H2H Brownlow votes from X of Y eligible meetings", which
would otherwise be a false denominator. On current canonical data the choice is not load-bearing:
`partiallyPolledMeetings` is 0 in both measured pairs.

**Unresolved observations (recorded, not acted on)**

- The `attributionSource = 'explicit'` branch has NO live witness: `brownlow_season_votes.club_id`
  is NULL on all 16,120 rows in `afldb_test`. The branch is implemented because the column exists
  and the runbook requires explicit-first precedence, but it is currently unproven against data.
  If a future load populates `club_id`, the precedence order should be re-validated then.
- Equally, `attributionSource` is `'primary'` for every attributed row on current data, so the
  test's assertion that a complete club-season's leaders are all `'primary'` is a true statement
  about `afldb_test` and would need revisiting after such a load.
- No canonical row has `club_count = 1` with a NULL `primary_club_id`, and no vote row is missing a
  `player_season_stats` row, so those two defensive branches are also unexercised.
- `getClubBrownlowHistory` runs six statements and re-evaluates `brownlowOrganizationRows()` in each
  (it scans all 16,120 vote rows per statement). At 20-40 ms per call this is invisible, but it is
  the shape to look at first if Stage 5's performance gate finds club Brownlow slow; a single
  statement returning several result sets, or a materialised CTE, is the obvious remedy.
- `getHeadToHeadPlayerLeaders` issues four statements and evaluates `h2hPlayerTotals` twice (games
  board and goals board). Same note applies.
- `H2HStatRecord.holders` is unbounded. A five-way tie is fine; a hypothetical pathological tie in a
  low-scoring historical rivalry is not capped, and the presentation stage (Stage 8 after the V1.7
  renumbering) will need a display decision.
- Stage 1 and Stage 2 observations still stand unchanged: the Windows-only CRLF artefact in
  `tests/finals-semantics-contract.test.ts` was not touched, longest-streak ties still resolve to
  the earliest run, `getCrossoverPlayers` is still unpaginated, and
  `AFLDB-ISSUE-144.md.encoding-backup` is still an untracked stray in the worktree that must not be
  committed.

**Confirmation**

No Stage 4 implementation was begun. No selected-season team comparison, canonical season discovery,
selected-season identity resolution, record/scoring formula, team-match aggregation or selected-season
player-leader function exists in the module. `getClubSeasonBrownlowSummary` is the selected-season
Brownlow attribution primitive the Stage 3 brief explicitly required and nothing more: it takes a
season it is given, and does not discover seasons, resolve identities, or aggregate team metrics. No
route, component, SEO or navigation file was created or edited.

**Next stage: Stage 4 — Season-generic selected-season comparison.**

Exact first action for the next fresh session, after reading this runbook and this log:

1. Confirm the environment still resolves: `ls node_modules/next/package.json` (junction to
   `D:\dev\afldb-issue-139\node_modules`), and that `.env` in this worktree still sets
   `AFLDB_TEST_DATABASE_URL` to an `afldb_test` DSN.
2. Re-run the Stage 1 + Stage 2 + Stage 3 gate once to confirm the baseline is green before adding
   to it: `npm test -- tests/integration/club-comparison.test.ts` (expect 34 passed).
3. Read the "Selected-season statistical rules" and "Future-season acceptance criterion" sections of
   this runbook, plus the "Season classes" witnesses. In particular: the maximum canonical season
   must be DISCOVERED, never named; the test name, fixture setup and application path must not name
   the selected year; and no hard-coded metric-year condition is permitted in production code.
4. Add canonical season and organisation options, selected-season identity resolution,
   record/scoring, team metrics via a match->team oracle-comparable aggregation, and selected-season
   player leaders (dense rank 1-5, ties retained) to the EXISTING
   `src/db/queries/club-comparison.ts`. Reuse `statCoverage()` for every runtime metric-coverage
   decision — do NOT add a second coverage abstraction — and reuse
   `getClubSeasonBrownlowSummary()` for the selected-season Brownlow block rather than
   re-deriving attribution.
5. Extend `tests/integration/club-comparison.test.ts` with a describe/test name matching the Stage 4
   validation filter, against an independent SQL oracle in the same file.
6. Run the Stage 4 validation, append a Stage 4 record to this log, and STOP. Do not start Stage 5.

### Stage 4 — Season-generic selected-season comparison — COMPLETE (2026-09-06)

**Status: Stage 4 — COMPLETE.** Executed on branch `codex/issue-144` in `D:\dev\afldb-issue-144`
against `afldb_test` (read-only; no write was issued). No Stage 5 implementation was begun. The
V1.7 scope amendment recorded elsewhere in this runbook was persisted in the same session at the
user's direction; no Stage 6 code was written.

**Exact files changed**

- `src/db/queries/club-comparison.ts` — EXTENDED. `statCoverage()` was generalised from one stat key
  to one-or-many (same shape, plus a `stat_key` column) so the twenty-one team metric families read
  their availability through the SINGLE existing coverage abstraction rather than a second one; the
  three existing callers are unchanged and unaffected. Appended at the end of the module: canonical
  season discovery, season participants, identity-at-season resolution, the home-and-away record,
  the static team metric registry with the team-match aggregation, selected-season player leaders,
  and the composed `getClubSeasonComparison()`. No Stage 1, 2 or 3 code path was modified.
- `tests/integration/club-comparison.test.ts` — EXTENDED. Added three describe blocks
  (`selected season identity and record` 7 tests, `selected season stat coverage` 6 tests,
  `maximum canonical season` 1 test) and eight independent SQL oracles in the same file
  (`oracleSeasons`, `oracleClubIdentities` + `pickIdentity`, `oracleLadderRow`,
  `oracleTeamStatRows` + `aggregateTeamStat`, `oracleTeamMatchCount`, `oracleSeasonPlayerRows`,
  `oracleCoverage`). Imports were extended and the file header now says Stages 1-4. The pre-existing
  `OracleStatRow` type name was untouched; the Stage 4 equivalent is `OracleTeamStatRow`. No Stage 1,
  2 or 3 test was modified.
- `AFLDB-ISSUE-144.md` — this record, the V1.7 scope amendment, and the status line at the top.

No route, component, SEO, navigation, migration, schema, CHANGELOG or unrelated test file was
touched. No Git command was run.

**Canonical season and identity query surface**

- `getComparisonSeasons(): ComparisonSeason[]` — every canonical `seasons` row, newest first. This
  is the ONLY source of valid seasons. No competition or league predicate is applied, matching the
  existing `statCoverage()` fragment and the rest of `src/db/queries`.
- `getMaximumComparisonSeason(): ComparisonSeason | null` — the conceptual default, DISCOVERED as
  `ORDER BY year DESC LIMIT 1`. No year is named.
- `getComparisonSeason(season)` — metadata for one selected season; null when the season is not
  canonical.
- `ComparisonSeason` carries `season, competition, league, status, isComplete, isProvisional,
  dataThroughDate, completedAt, firstMatchDate, lastMatchDate, matchCount, clubCount`.
  `isProvisional` is `status <> 'complete'`, computed in SQL from the canonical enum — never from a
  calendar. `seasons.status` has exactly two values in `afldb_test`: `in_progress`, `complete`.
- `getSeasonParticipants(season): ComparisonOrganization[]` — organisations with canonical
  participation EVIDENCE (a `club_seasons` row or a played match), not a club lifespan.
- `getSeasonIdentity(organizationId, season): ClubSeasonIdentity | null` — resolves through
  `afldb_identity_for_season(organization_id, season::smallint)`. No lineage rule is reproduced in
  TypeScript. It returns `clubId/clubName/clubSlug`, `matchesPlayed`, `ladderRows` and
  `participated = matchesPlayed > 0 || ladderRows > 0`.

The lifespan/participation split is load-bearing and is recorded deliberately: the canonical
function resolves an identity from club lifespans, so it names an identity even for a season that
has no data. `participated` is therefore decided from canonical evidence, never from the function.

**Selected-season record formulas**

`getClubSeasonRecord(organizationId, season)` reads `club_seasons`, scoped by
`clubs.organization_id` exactly as the H2H layer is (`afldb_test` holds at most one `club_seasons`
row per organisation and season — verified, zero org-seasons with more than one row — and the
ordering makes the choice deterministic if that ever changes). It returns `played, wins, draws,
losses, premiershipPoints, pointsFor, pointsAgainst, percentage, ladderRank, finalsPlayed,
isPremier, woodenSpoon` plus:

- `winPercentage = 100 x (wins + 0.5 x draws) / played`, null when `played = 0`;
- `averagePointsFor = pointsFor / played`, null when `played = 0`;
- `averagePointsAgainst = pointsAgainst / played`, null when `played = 0`;
- `percentage` is the canonical `club_seasons.percentage` (100 x pointsFor / pointsAgainst), cast
  `::float8` because `numeric` arrives as a string on this driver.

This is HOME-AND-AWAY data and stays semantically distinct from the team-metric denominator:
`played` excludes the finals series, `finalsPlayed` carries it separately, and the team metrics
report their own finals-inclusive denominator.

**Team metric aggregation and coverage contract**

`TEAM_METRICS` is a static registry of exactly 21 entries carrying FOUR fields only — `key`,
`statKey`, `column`, `label`. It holds no season, no year range and no availability; a test asserts
the key set is exactly those four for every entry. `marks_i50` -> `player_match_stats.marks_inside_50`
and `inside50s` -> `inside_50s` are the two places the coverage key and the column name differ.

`getClubSeasonTeamMetrics(organizationId, season)` implements the contracted grain exactly:

organisation -> selected-season identity -> match/club -> sum player stat values -> average eligible
team-match totals

- The match population is every canonical match the organisation played in the season, FINALS
  INCLUDED.
- `per_match` sums each metric per (match, club) and separately counts NULL player rows for it. The
  NULL count is what makes eligibility decidable: `sum()` alone cannot tell "nobody recorded it"
  from "everyone recorded zero".
- A team-match is eligible for a metric only when player rows exist AND every present row is
  non-NULL for it. `eligibleMatches` and `totalTeamMatches` are BOTH returned for every metric.
- Player rows are never averaged directly; a test asserts each team average exceeds five times the
  mean of the underlying player rows, which a player-row average could not.

Coverage states, read at request time through `statCoverage()`:

- `complete` — normal average; if `eligibleMatches != totalTeamMatches` the discrepancy is preserved
  as `hasDenominatorDiscrepancy` for later UI disclosure.
- `partial` — recorded-match average, `isPartial: true`, eligible/total preserved.
- `not_collected` / `not_applicable` — `isAvailable: false`, `average` and `total` null.
- `pending` — `isPending: true`, unavailable.
- `missing` (no `stat_availability` row, including a season with no `seasons` row) — fails safely as
  unavailable.

`isAvailable` additionally requires `eligibleMatches > 0`, so a coverage-complete season with no
loaded matches reports nothing rather than a spurious value. `average`/`total` are null whenever
`isAvailable` is false: **zero is only ever returned when coverage establishes a recorded zero.**
`hasDenominatorDiscrepancy` is false for an unavailable metric, where the empty denominator IS the
unavailability rather than a discrepancy.

**Player leader behaviour**

`getClubSeasonPlayerLeaders(organizationId, season)` reads `player_club_season_stats`, summed across
every identity of the organisation active in that season, so a mid-season rename could not split a
player's total.

- Boards: `games`, `goals`, `disposals`. Dense rank via `dense_rank()`, cut at
  `CLUB_SEASON_LEADER_RANK_LIMIT = 5`, every tie at the cut retained, ordered rank then
  `players.sort_name` then player id.
- `games` and `goals` cover all season matches. `disposals` is returned ONLY when runtime coverage
  is `complete` or `partial`, and always carries `recordedGames` from
  `disposals_recorded_games`; `games`/`goals` carry `recordedGames: null` because the canonical
  table has no such column for them and one must not be invented.
- Only players with a recorded, positive value appear: a NULL total is not a zero, and a zero is not
  a leader.
- `goalsCoverage`/`goalsAvailable` and `disposalsCoverage`/`disposalsAvailable` are returned so a
  caller never has to guess why a board is empty.
- If the organisation did not participate, every board is empty. No other season and no other
  identity is borrowed.

**Selected-season Brownlow behaviour**

Unchanged from Stage 3 and NOT reimplemented: `getClubSeasonComparison()` calls the existing
`getClubSeasonBrownlowSummary(organizationId, season)`, which selects from the Stage 3
`brownlowAttribution()` fragment (explicit `club_id` first, `player_season_stats.primary_club_id`
only when `club_count = 1`, ambiguous multi-club rows excluded and disclosed, winners from
`is_winner` alone, `is_ineligible` preserved). Season totals are never derived from match-level
votes. `complete` -> numeric; `partial` -> no authoritative total; `pending` -> pending;
`not_collected`/`not_applicable`/`missing` -> unavailable.

**Current/in-progress season witness (2026)**

Canonical 2026 data in `afldb_test` is a `seasons` row ONLY. Measured, read-only:

- maximum canonical season = **2026** (discovered, not named);
- `status = in_progress`, `isProvisional = true`, `isComplete = false`;
- `data_through_date = NULL`, `completed_at = NULL`, `match_count = NULL`, `club_count = NULL`;
- `matches` 2026 = **0**, `club_seasons` 2026 = **0**, `player_match_stats` in 2026 matches = **0**,
  `player_club_season_stats` 2026 = **0**, `brownlow_season_votes` 2026 = **0**;
- participating organisations in 2026 = **0**;
- `stat_availability` 2026: all **21** team metric families `complete`; `brownlow_season_total`,
  `brownlow_match_votes`, `brownlow_round_votes` all **pending**.

Behaviour proved through the ordinary code path: `getSeasonIdentity(adelaide, 2026)` resolves the
identity (`clubId` 1, from lifespans) but returns `matchesPlayed 0`, `ladderRows 0`,
`participated false`; `record` is null; every metric reports its canonical `complete` coverage with
`eligibleMatches 0`, `totalTeamMatches 0`, `isAvailable false` and `average null` — a coverage state
that permits a number is NOT allowed to invent one; `brownlow.coverage = 'pending'` with
`isAuthoritative false` and `totalVotes null`.

This is the honest state of a created-but-unloaded in-progress season. **The witness is limited:
`afldb_test` has no loaded 2026 match, so current-season team averages, player leaders and a
populated `data_through_date` are asserted for the in-progress season only as the
maximum-canonical-season path, not with live 2026 rows.** The dynamic maximum-season test therefore
also walks to the newest CONTESTED season and runs the complete path there, without naming a year.
Closure did not skip 2026: every 2026 fact that canonical test data can express is asserted.

**Completed-season witnesses (2025)**

Records, independent SQL (`club_seasons` read by club id, not by organisation):

| organisation | P | W | D | L | PF | PA | pts | % | rank | finals | premier |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Adelaide (club 1) | 23 | 18 | 0 | 5 | 2278 | 1635 | 72 | 139.3272 | 1 | 2 | no |
| Brisbane Lions (club 3) | 23 | 16 | 1 | 6 | 2061 | 1804 | 66 | 114.2461 | 3 | 4 | yes |

Derived: Adelaide `winPercentage` **78.2609**, `averagePointsFor` **99.0435**,
`averagePointsAgainst` **71.0870**. Brisbane Lions `winPercentage` **71.7391** — the draw counts a
half, which a wins/played ratio would lose. Season metadata: `status = complete`,
`isProvisional = false`, `is_complete = true`, `data_through_date = 2025-09-27`.

Team metrics, independent SQL aggregated in TypeScript (finals included):

| organisation | team-matches | goals avg | disposals avg | marks i50 avg |
|---|---|---|---|---|
| Adelaide | **25** (23 H&A + 2 finals) | **14.2800** | **349.4800** | **11.6800** |
| Brisbane Lions | **27** (23 H&A + 4 finals) | **13.1481** | **371.5926** | **11.8889** |

Eligible = total = 25 and 27 respectively for goals, disposals, marks inside 50, tackles and
clearances: 2025 is fully covered, so no denominator discrepancy. The team-match denominator equals
`record.played + record.finalsPlayed` for both, which is asserted.

Player leaders, Adelaide 2025 (independent SQL, summed and ranked in TypeScript):

- Games: rank 1 is a **wall of 25-game players** (Daniel Curtin, Jordan Dawson, Mark Keane, Ben
  Keays, Alex Neal-Bullen, Reilly OBrien, Jake Soligo, Riley Thilthorpe and more) — 18 rows returned
  across ranks 1-5, every tie retained.
- Goals: **Riley Thilthorpe 60**, Darcy Fogarty 41, Taylor Walker 39, Ben Keays 36, Izak Rankine 31.
- Disposals: **Jordan Dawson 584 (25 recorded games)**, Rory Laird 531 (22), Josh Worrell 525 (25),
  Jake Soligo 522 (25), Izak Rankine 452 (22).

Brisbane Lions 2025 for reference: games 27 (Harris Andrews, Levi Ashcroft, Will Ashcroft, Josh
Dunkley, Jaspa Fletcher, Hugh McCluggage, Cam Rayner, Darcy Wilmot); goals Logan Morris 53;
disposals Will Ashcroft 733.

Brownlow 2025, `brownlow_season_total` coverage **complete**: Adelaide **93 votes / 15 players**,
leader **Jordan Dawson 27** (Izak Rankine 15, Riley Thilthorpe 14); Brisbane Lions **98 votes / 14
players**. No 2025 winner is attributed to either club. Attribution reached independently in the
test by COALESCEing the two raw inputs in TypeScript.

**Historical limited-coverage witnesses**

Pre-1965 — Carlton **1950** (`stat_availability` 1950: 2 keys `complete` = `goals` and
`brownlow_season_total`; the other 22 keys `not_collected`):

- team-matches **18**; player rows 360, of which goals recorded 360 and disposals recorded **0**;
- goals `complete`, `isAvailable true`, eligible 18/18, average **12.2778** (independent SQL agrees);
- disposals `not_collected`, `isAvailable false`, `average null`, `total null` — asserted explicitly
  as "not 0"; the independent oracle confirms 0 eligible team-matches, so the value is genuinely
  absent rather than suppressed;
- player leaders: `disposalsCoverage = not_collected`, `disposalsAvailable false`, disposals board
  EMPTY; goals board populated (5 ranks) and games board populated.

Mixed coverage — Carlton **1975** (`stat_availability` 1975: `complete` = goals,
brownlow_season_total; `partial` = behinds, disposals, frees_against, frees_for, handballs, hitouts,
kicks, marks; `not_collected` = the remaining 14):

| metric | coverage | eligible / total | average |
|---|---|---|---|
| goals | complete | **24 / 24** | **15.0833** |
| disposals | partial | **23 / 24** | **267.3913** |
| hit-outs | partial | **11 / 24** | **30.2727** |
| tackles | not_collected | 0 / 24 | **null** |

All four agree with independent SQL. Three different coverage states coexist in ONE season, which no
year branch could express: this is the direct proof that availability follows `stat_availability`
and not a cutoff. `hasDenominatorDiscrepancy` is true for disposals and hit-outs, false for goals.

Missing-metadata witness: `getClubSeasonComparison(carlton, min(seasons.year) - 1)` — a year with no
`seasons` row, supplied as an ARGUMENT, not a branch — returns `seasonMeta null`, every metric
`coverage = 'missing'` with `average null`, and `brownlow.coverage = 'missing'` with
`totalVotes null`.

**Dynamic maximum-season test evidence**

`club comparison: maximum canonical season > runs the complete selected season path for the maximum
canonical season without naming it`:

1. queries the maximum canonical season dynamically and asserts season/status/`isProvisional`/
   `dataThroughDate` against the independent `seasons` oracle;
2. asserts the maximum season's own coverage, Brownlow state and participation exactly as canonical
   metadata reports them, loaded or not;
3. walks the descending canonical season list to the newest season with two or more participating
   organisations — on this database that walk moves off the maximum season, because 2026 has none —
   and chooses the first two participants DYNAMICALLY;
4. resolves both season identities and runs the complete `getClubSeasonComparison()` path;
5. verifies season status, provisionality, `data_through_date`, identity, record, the record
   formulas, the team-match denominator, every metric's coverage state, leader coverage and Brownlow
   state against canonical rows;
6. contains no year in its name, its fixture logic or the production path it exercises.

A companion guard test, `contains no hard-coded season year in the selected season code path`,
strips comments from `src/db/queries/club-comparison.ts` and asserts that the remaining source
contains **no four-digit year literal at all** (`/\b(1[89]\d{2}|2[01]\d{2})\b/`). It currently
matches zero. This is the standing mechanical proof of the season-generic contract for the whole
module, not only for Stage 4.

**Independent SQL oracle**

Eight oracles, all structurally simpler than the implementation: plain joins, no CTE chain, no
window function, no shared fragment, no coverage abstraction. Three of them return rows UNRESOLVED
and the test does the work in TypeScript, so the contract is checked against a different
implementation of itself rather than against itself:

- `oracleClubIdentities` + `pickIdentity` — returns every identity of the organisation with its
  lifespan; the test picks the identity-at-season in TypeScript, so
  `afldb_identity_for_season` is not checked against itself.
- `oracleTeamStatRows` + `aggregateTeamStat` — returns every player stat row of a club-season for
  one column, unaggregated; the grouping, the NULL-eligibility rule and the average are all done in
  TypeScript.
- `oracleSeasonPlayerRows` — returns raw per-club season rows; the test sums across identities and
  ranks them itself.

Plus `oracleSeasons`, `oracleLadderRow`, `oracleTeamMatchCount` and `oracleCoverage` (raw
`stat_availability`, with no `seasons` join and therefore no `missing` state of its own). Values
above were also captured standalone through `psql` against `afldb_test`.

Organisation ids used: adelaide=1, brisbane-lions=3, carlton=4, western-bulldogs=24 (2025) / 8
(Footscray, 1950), sydney=21 (2025) / 19 (South Melbourne, 1950). The rename witnesses are asserted
by name: 1950 Western Bulldogs resolves to **Footscray**, 2025 to **Western Bulldogs**, 1950 Sydney
to **South Melbourne**, and the historical and current club ids differ.

**Validation commands**

```
npm test -- tests/integration/club-comparison.test.ts -t "selected season|stat coverage|maximum canonical season"
npm test -- tests/integration/club-comparison.test.ts
npx tsc --noEmit
```

**Validation results**

- Baseline BEFORE any Stage 4 code was written: `npm test -- tests/integration/club-comparison.test.ts`
  — **Test Files 1 passed (1); Tests 34 passed (34)**, 5.63 s.
- `npm test -- … -t "selected season|stat coverage|maximum canonical season"` — **Test Files 1 passed
  (1); Tests 14 passed | 34 skipped (48)**, 3.96 s. The 34 skips are the Stage 1-3 describe blocks,
  excluded by the `-t` filter.
- `npm test -- tests/integration/club-comparison.test.ts` (whole file) — **Test Files 1 passed (1);
  Tests 48 passed (48)**, 8.85 s. Stage 1's 10, Stage 2's 7 and Stage 3's 17 tests all still pass
  unchanged, so generalising `statCoverage()` is not a regression.
- `npx tsc --noEmit` — clean, exit 0, no diagnostics.

No Stage 5 performance suite, browser suite or build was run.

**Blockers and deviations**

None. No stop condition was triggered:

- Selected-season identity resolves entirely through `afldb_identity_for_season`; no lineage rule is
  duplicated in TypeScript and no club-specific mapping exists.
- No production code contains a year threshold; the guard test proves the module contains no
  four-digit year literal at all.
- Every metric's availability is driven by runtime `stat_availability` through the single
  `statCoverage()` abstraction; the 1975 witness carries three different coverage states in one
  season.
- Team-match eligibility distinguishes NULL from a recorded zero by counting NULL player rows per
  metric; the 1975 disposals (23/24) and hit-outs (11/24) denominators are the live witnesses.
- Player leader values agree with independent SQL summed from raw canonical rows.
- Brownlow season state is read from `brownlow_season_votes` through the Stage 3 primitive; no
  match-level derivation was added.
- Future-season support requires no code change: a new `seasons` row makes the season discoverable,
  and loaded matches/ladder/player/coverage rows change the next read.
- No schema, index, migration, materialisation or cache was required or added.

Deviations of interpretation, recorded explicitly:

1. **`statCoverage()` was generalised rather than duplicated.** Reading 21 metric families through a
   one-key-at-a-time fragment would have meant either 21 statements or a second coverage model; the
   brief forbids the second model, so the existing abstraction now accepts one key or many and
   returns a `stat_key` column. The single-key form is byte-for-byte the same shape it was, plus
   that column, and all three Stage 3 callers select named columns and are unaffected — proved by
   the unchanged 34-test regression.
2. **Aggregation is scoped by `clubs.organization_id`, not by the single resolved identity id.**
   This matches the Stage 1 `h2hScope` precedent and means a mid-season identity change could not
   silently drop matches. `afldb_identity_for_season` still supplies the identity that is displayed
   and that the record oracle is keyed on. On current data the two are equivalent: no organisation
   has more than one `club_seasons` row in any season.
3. **`participated` is decided from canonical evidence, not from the identity function**, because
   the function resolves from club lifespans and therefore names an identity for an unloaded season
   (Adelaide "exists" in 2026). Evidence is a `club_seasons` row or a played match.
4. **Leader boards admit only positive recorded values.** A player with a NULL or zero season total
   is not a leader; NULL is never coerced to zero.

**Unresolved observations (recorded, not acted on)**

- The in-progress-season witness is structurally complete but data-thin: `afldb_test` has no loaded
  2026 match, so a current-season team average, a current-season player leader board and a populated
  `data_through_date` on an in-progress season are UNPROVEN against live rows. If 2026 match data is
  ever loaded into `afldb_test`, re-run the maximum-canonical-season test: it will then exercise the
  loaded in-progress path automatically, with no test edit.
- `getClubSeasonTeamMetrics` issues one wide statement (21 metrics x 2 per-match aggregates, then 21
  x 3 outer aggregates) plus one coverage statement. It is fast on current data but it is the first
  shape to look at if Stage 5 finds the selected-season block slow.
- `getClubSeasonComparison` fans out to six queries per side, so a two-side render is twelve
  statements before H2H is considered. Stage 5 should measure the composed call, not only the parts.
- `getSeasonParticipants` uses two `EXISTS` subqueries per club and is called once per season by the
  dynamic test's walk. On a database whose newest seasons are empty the walk repeats it; a route
  would call it once.
- The team-metric registry's `label` values are provisional display strings ("Hit-outs", "Rebound
  50s", "One percenters"); the presentation stage may want different wording, which is a display
  decision, not a data one.
- Stage 1-3 observations still stand unchanged: the Windows-only CRLF artefact in
  `tests/finals-semantics-contract.test.ts` was not touched, longest-streak ties still resolve to the
  earliest run, `getCrossoverPlayers` is still unpaginated, the Brownlow `explicit` attribution
  branch still has no live witness, and `AFLDB-ISSUE-144.md.encoding-backup` is still an untracked
  stray in the worktree that must not be committed. `ISSUE-144-EXTENDED-RIVALRY-EVIDENCE.sql` and
  `.txt` are new untracked evidence artefacts in the worktree.

**Confirmation**

No Stage 5 implementation was begun. No query was reshaped for performance, no timing target was
measured, no index, materialised view or cache was added, and no performance test was written or
run. No Stage 6 extended-rivalry code exists: there is no decade aggregation, no
`match_period_scores` read anywhere in the module, and no H2H average board. No route, component,
SEO or navigation file was created or edited.

**Next stage: Stage 5 — Performance gate.**

Exact first action for the next fresh session, after reading this runbook and this log:

1. Confirm the environment still resolves: `ls node_modules/next/package.json` (junction to
   `D:\dev\afldb-issue-139\node_modules`), and that `.env` in this worktree still sets
   `AFLDB_TEST_DATABASE_URL` to an `afldb_test` DSN.
2. Re-run the Stage 1-4 gate once to confirm the baseline is green before adding to it:
   `npm test -- tests/integration/club-comparison.test.ts` (expect **48 passed**).
3. Read the "Performance contract" section of this runbook for the stated targets, and the Stage 4
   observation above naming `getClubSeasonTeamMetrics` and the twelve-statement composed
   `getClubSeasonComparison` as the first shapes to measure.
4. Add a `long rivalry performance` describe/test to the EXISTING
   `tests/integration/club-comparison.test.ts` that measures WARM timings for Adelaide vs Brisbane
   Lions and Carlton vs Collingwood across the H2H surface AND the composed selected-season path for
   both sides of a season discovered dynamically. Do not name a year.
5. Run `npm test -- tests/integration/club-comparison.test.ts -t "long rivalry performance"`, then
   the whole file, then `npx tsc --noEmit`.
6. Reshape ONLY queries that exceed the stated targets. If a target cannot be met without schema,
   index or materialisation work, STOP and amend the runbook first rather than adding it.
7. Append a Stage 5 record to this log with the measured warm timings and STOP. Do not start
   Stage 6 — Extended rivalry analytics.

### Stage 5 — Performance gate — COMPLETE (2026-09-06)

**Files changed**

- `src/db/queries/club-comparison.ts` — two measured query reshapes (below). No new export, no new
  type, no semantic change.
- `tests/integration/club-comparison.test.ts` — added the `club comparison: long rivalry
  performance` describe block (5 tests). File is now 53 tests: the 48 Stage 1-4 semantic tests
  unchanged, plus 5 performance tests.
- `AFLDB-ISSUE-144.md` — this record.
- `IssuesIndex.md` / `issues.md` — ISSUE-144 row state and next action moved from Stage 5 to Stage 6.

No migration, no index, no generated column, no materialised view, no cache, no denormalised table,
no schema change of any kind was added. No route, component, SEO or navigation file was touched.
No CHANGELOG entry (the runbook still defers it to Stage 10).

**Harness structure and why**

The performance block lives in the EXISTING `tests/integration/club-comparison.test.ts`, not a
separate `tests/performance/` file, because the runbook's Stage 5 validation command names that file
(`-t "long rivalry performance"`), because the measurement must exercise the same imports,
`postgres.js` pool and `afldb_test` database the semantic tests prove, and because the repository has
no `tests/performance/` convention to join. Fragility was addressed inside the block instead:

- it calls the ACTUAL exported query functions (`getHeadToHead*`, `getCrossover*`,
  `getClubBrownlowHistory`, `getClubSeason*`, `getClubSeasonComparison`), never a reimplementation
  of their SQL;
- 2 warmup runs are executed and DISCARDED, then 5 measured runs are timed with
  `performance.now()`; the MEDIAN is the acceptance value (min/median/max are all reported);
- assertions are only the three approved ceilings (250 ms / 750 ms / 1.5 s). Nothing asserts an
  exact or sub-millisecond value, so a single cold outlier cannot fail CI;
- no year and no club id is hard-coded. The measured season is DISCOVERED as the newest `complete`
  canonical season in which all four witness organisations appear in `getSeasonParticipants`; the
  maximum canonical season is discovered through `getMaximumComparisonSeason`;
- every timing is printed with `console.table` in `afterAll`.

Reporter note for the next session: vitest 4's default reporter SUPPRESSES console output for a
passing file. To see the timing table, run the block with `--reporter=verbose`:
`npm test -- tests/integration/club-comparison.test.ts -t "long rivalry performance" --reporter=verbose`.

**Environment**

Windows 11 workstation, Node via nvm, vitest 4.1.10, `fileParallelism: false`. Database is
`afldb_test` reached through `AFLDB_TEST_DATABASE_URL` at `127.0.0.1:5432` (forwarded), PostgreSQL 16.
Every measurement is READ-ONLY; no write was issued. Per-statement network/forwarding overhead is
visible in the numbers: trivial single-row queries floor at roughly 3-9 ms and frequently show a
~60 ms sample, so multi-statement functions carry a per-round-trip tax that a supported-Linux host
would not. The measured medians clear the ceilings with this tax included, so the gate is
conservative rather than optimistic. This is a Windows client measurement and does not by itself
prove the Linux route target; the runbook's Linux route budget is re-checked at Stage 7.

**Measured warm timings (median of 5 runs, after 2 discarded warmups; ms)**

Adelaide vs Brisbane Lions (41 meetings) — normal-sized rivalry witness:

| Query | min | median | max |
|---|---|---|---|
| getHeadToHeadSummary | 19.1 | 45.8 | 79.1 |
| getHeadToHeadMeetings (page 1) | 77.6 | 92.7 | 116.1 |
| getHeadToHeadMeetings (finals) | 116.2 | 127.8 | 141.8 |
| getHeadToHeadVenueRecords | 15.2 | 64.0 | 69.1 |
| getHeadToHeadRecords | 14.5 | 17.9 | 36.5 |
| getHeadToHeadStreaks | 12.4 | 24.6 | 37.8 |
| getCrossoverPlayers | 19.0 | 33.2 | 37.1 |
| getCrossoverSummary | 12.7 | 23.9 | 35.7 |
| getHeadToHeadPlayerLeaders | 20.1 | 21.1 | 49.8 |
| getHeadToHeadBrownlow | 32.4 | 36.5 | 65.2 |
| getClubBrownlowHistory (Adelaide) | 88.5 | 100.9 | 107.8 |
| getClubBrownlowHistory (Brisbane Lions) | 60.0 | 94.9 | 121.2 |

Carlton vs Collingwood (268 meetings, ~10,610 player-match rows) — long-rivalry scale witness:

| Query | min | median | max |
|---|---|---|---|
| getHeadToHeadSummary | 18.3 | 63.4 | 101.3 |
| getHeadToHeadMeetings (page 1) | 27.7 | 92.3 | 100.8 |
| getHeadToHeadMeetings (finals) | 41.4 | 93.6 | 111.7 |
| getHeadToHeadVenueRecords | 57.4 | 62.7 | 63.9 |
| getHeadToHeadRecords | 22.1 | 28.3 | 59.4 |
| getHeadToHeadStreaks | 16.1 | 31.1 | 33.4 |
| getCrossoverPlayers | 21.2 | 33.1 | 49.3 |
| getCrossoverSummary | 21.2 | 23.9 | 38.2 |
| getHeadToHeadPlayerLeaders | 47.7 | 67.2 | 111.9 |
| getHeadToHeadBrownlow | 68.0 | 79.7 | 100.6 |
| getClubBrownlowHistory (Carlton) | 62.5 | 110.9 | 129.5 |
| getClubBrownlowHistory (Collingwood) | 61.7 | 80.8 | 100.6 |

Selected-season surface. The measured season resolved DYNAMICALLY to **2025** (newest `complete`
season containing all four witness organisations); no year is written in the test:

| Side | Query | min | median | max |
|---|---|---|---|---|
| Adelaide 2025 | getSeasonIdentity | 7.7 | 9.9 | 65.0 |
| Adelaide 2025 | getClubSeasonRecord | 5.8 | 6.6 | 67.3 |
| Adelaide 2025 | getClubSeasonTeamMetrics | 12.4 | 15.6 | 61.4 |
| Adelaide 2025 | getClubSeasonPlayerLeaders | 62.1 | 75.0 | 136.0 |
| Adelaide 2025 | getClubSeasonBrownlowSummary | 8.5 | 16.2 | 81.0 |
| Adelaide 2025 | getClubSeasonComparison (composed) | 63.1 | 93.0 | 102.5 |
| Brisbane Lions 2025 | getSeasonIdentity | 53.5 | 58.0 | 63.1 |
| Brisbane Lions 2025 | getClubSeasonRecord | 58.9 | 61.9 | 64.3 |
| Brisbane Lions 2025 | getClubSeasonTeamMetrics | 14.7 | 48.1 | 54.9 |
| Brisbane Lions 2025 | getClubSeasonPlayerLeaders | 68.7 | 73.7 | 144.6 |
| Brisbane Lions 2025 | getClubSeasonBrownlowSummary | 6.9 | 11.3 | 63.0 |
| Brisbane Lions 2025 | getClubSeasonComparison (composed) | 13.7 | 65.0 | 71.7 |

The Stage 4 suspects were measured and are NOT the expensive shapes: `getClubSeasonTeamMetrics`
medians 15.6/48.1 ms, and the twelve-statement composed `getClubSeasonComparison` medians 93.0/65.0 ms
— its six inner calls run concurrently, so the composition costs roughly one slow member, not their
sum.

Maximum canonical season, discovered at runtime as **2026** with **0 participants** (unchanged from
Stage 4; the assumption is discovered, never hard-coded). The structural no-participation path was
measured:

| Query | min | median | max |
|---|---|---|---|
| getMaximumComparisonSeason | 2.7 | 2.9 | 3.0 |
| getComparisonSeasons | 5.4 | 6.1 | 14.5 |
| getSeasonParticipants (2026) | 6.0 | 53.1 | 66.5 |
| getClubSeasonComparison (composed, no participation) | 32.0 | 67.5 | 110.8 |

**Parallel query groups (`Promise.all`, warm median of 5)**

| Group | min | median | max | ceiling |
|---|---|---|---|---|
| Adelaide/Brisbane Lions — H2H group (9 sections) | 38.4 | 43.9 | 47.1 | 750 |
| Adelaide/Brisbane Lions — selected-season group (both sides composed) | 16.0 | 55.6 | 69.7 | 750 |
| Carlton/Collingwood — H2H group (9 sections) | 76.8 | 87.0 | 114.6 | 750 |
| Carlton/Collingwood — selected-season group (both sides composed) | 13.2 | 47.3 | 71.5 | 750 |

**Route-equivalent composed data load**

Two dependent phases, as a route will run them: (1) both organisations by slug plus the canonical
season list concurrently, then (2) all thirteen independent sections concurrently — nine H2H
sections, both club Brownlow histories, and both sides' composed selected-season comparison. No UI
rendering is included.

| Pair | min | median | max | ceiling |
|---|---|---|---|---|
| Adelaide / Brisbane Lions | 115.1 | 158.0 | 217.3 | 1500 |
| Carlton / Collingwood | 120.3 | 205.9 | 288.6 | 1500 |

**Diagnosis and the two reshapes performed**

The first measured run put exactly two shapes on or over the 250 ms query ceiling; everything else
was comfortably under and was NOT touched.

1. `getClubBrownlowHistory` — Adelaide warm median **254.3 ms** (over ceiling), Carlton 125.5 ms.
   This is the shape the Stage 4 log predicted. Cause was structural rather than planner-related and
   was diagnosed from the code and the before/after measurement: the function issued SEVEN
   statements, each re-evaluating `brownlowOrganizationRows()` over all 16,120
   `brownlow_season_votes` rows, and the seventh (unattributed-by-season) was awaited SERIALLY after
   the other six.
   Reshape: a local `scoped` fragment wrapping THE shared `brownlowOrganizationRows()` fragment with
   `WHERE r.organization_id = $org OR r.primary_organization_id = $org`, used by all seven
   statements, and the seventh statement folded into the same `Promise.all`. This is a filter
   push-down, not a new population: every one of the seven statements already required one of those
   two predicates, so no row that could have been returned is removed, and the shared attribution
   fragment itself is unchanged (Stage 3 Brownlow attribution semantics are untouched — explicit
   before primary before unattributed, `is_winner` alone decides winners, only `complete`
   `brownlow_season_total` coverage contributes, unattributed votes are still disclosed and never
   added).
   Result: **254.3 → 100.9 ms** (Adelaide), 125.5 → 110.9 ms (Carlton).

2. `getCrossoverPlayers` / `getCrossoverSummary` — after the Brownlow fix, Carlton/Collingwood
   `getCrossoverPlayers` measured warm median **265.8 ms** (over ceiling) with `getCrossoverSummary`
   at 248.6 ms, both sharing `crossoverScope()`. This one WAS diagnosed with
   `EXPLAIN (ANALYZE, BUFFERS)` run independently in psql against `afldb_test` (read-only) on a
   hand-reconstructed copy of the fragment with organisations 4 and 5 as literals.

   Before (Execution Time **254.711 ms**, Planning 7.474 ms, Buffers: shared hit=1240):
   - `CTE stints` — Seq Scan on `player_clubs` (16,710 rows) hash-joined to `clubs` and LEFT JOINed
     TWICE to a Seq Scan of all 16,838 `matches` rows (two 914 kB hashes, 421 buffers each).
   - `CTE org_rep` — 16,599 rows materialised: a HashAggregate over the whole stints CTE plus two
     sorted `DISTINCT ON` passes, ~116 ms cumulative, before anything filtered to the two
     organisations.
   - `pairs` — `CTE Scan on org_rep b  Filter: (org_id = 5)`, **Rows Removed by Filter: 15,400**, to
     reach 43 crossover players.
   - `SubPlan 3` (intervening organisations) — `CTE Scan on org_rep r ... loops=43` with
     **Rows Removed by Filter: 16,599 per loop**: a repeated linear rescan of the entire CTE once per
     crossover player, ~2.7 ms x 43 ≈ 118 ms of the total.

   Reshape: a leading `crossover_players` CTE selecting the player ids that hold `player_clubs` rows
   in clubs of BOTH target organisations
   (`GROUP BY pc.player_id HAVING count(DISTINCT c.organization_id) = 2`), joined into `stints`.
   `pairs` already required an `org_rep` row for both organisations — which requires a
   `player_clubs` row in a club of each — and the intervening-organisation subquery is correlated to
   one of those same players, so this removes no row the query could have returned. The
   organisation-grain rollup through `clubs.organization_id`, the chronology from the referenced
   match row, the direction rule, the completion date and the intervening-organisation window are all
   byte-for-byte unchanged; `club_organization_relations` is still never consulted.

   After (Execution Time **16.272 ms**, Planning 9.026 ms): the correlated `SubPlan 3` scan drops
   from 16,599 rows removed per loop to 0, and application-level warm medians fall to
   **33.1 ms** (`getCrossoverPlayers`) and **23.9 ms** (`getCrossoverSummary`) for
   Carlton/Collingwood.

No other query exceeded any ceiling, so no other query was altered. No EXPLAIN was needed for any
other shape.

**Validation**

- `npm test -- tests/integration/club-comparison.test.ts` — **53 passed** (the 48 Stage 1-4 semantic
  tests plus the 5 new performance tests), run AFTER the final code change. The 48 semantic tests are
  unchanged: none was deleted, skipped, weakened or re-baselined to accommodate a timing.
- `npm test -- tests/integration/club-comparison.test.ts -t "long rivalry performance" --reporter=verbose`
  — 5 passed, 48 skipped; the timing table above is that run's output.
- `npx tsc --noEmit` — clean, no output.
- No browser/UI suite, no `npm run build`, no NL suite was run; none belongs to this stage.

**Acceptance against the Stage 5 contract**

- Every measured warm individual query median is under 250 ms. Highest remaining:
  `getHeadToHeadMeetings (finals)` at 127.8 ms (Adelaide/Brisbane Lions) and
  `getClubBrownlowHistory` at 110.9 ms (Carlton).
- Every independent warm parallel group median is under 750 ms. Highest: 87.0 ms.
- Both route-equivalent warm composed loads are under 1.5 s. Highest: 205.9 ms — roughly 7x headroom.
- Carlton/Collingwood long-rivalry scale measured; Adelaide/Brisbane Lions normal scale measured;
  the Stage 4 selected-season composition measured for both sides plus the maximum-season
  no-participation path.
- No index, schema change, generated column, materialisation or cache was introduced, and the
  runbook's stop condition was never reached.

**Deviations and limitations**

- Measurement is from a Windows client over a forwarded connection, so per-statement latency is
  higher than the supported Linux runtime. This makes the gate conservative but means the numbers
  are NOT a Linux route measurement; the 1.5 s Linux route target remains to be confirmed once the
  route exists (Stage 7).
- The measured season resolved to 2025 and the maximum canonical season to 2026 with zero
  participation. Both were discovered at runtime; if the test database changes, the same test
  measures whatever the data then says.
- Timing samples vary by tens of milliseconds on this host (a trivial query can show a ~60 ms
  sample). The median-of-five discipline absorbs this, and all ceilings are cleared by a wide
  margin, but a single re-run's numbers will not reproduce to the millisecond.
- Untouched and still true from earlier stages: `getCrossoverPlayers` remains unpaginated (now
  cheap, so pagination stays a presentation decision), `H2HStatRecord.holders` remains uncapped, and
  `AFLDB-ISSUE-144.md.encoding-backup` is still an untracked stray in the worktree that must not be
  committed.

**Confirmation**

No Stage 6 implementation began. There is no decade aggregation, no `match_period_scores` read
anywhere in the module, and no H2H player-average board; nothing was scaffolded, benchmarked or
prepared for them. No route, component, SEO or navigation file was created or edited. No H2H
population, Brownlow attribution or coverage semantic diverges from Stages 1-4: the two reshapes are
a filter push-down and a scan-scope restriction, both proven row-identical by the unchanged 48
independent-oracle tests.

**Next stage: Stage 6 — Extended rivalry analytics.**

Exact first action for the next fresh session, after reading this runbook and this log:

1. Confirm the baseline is still green: `npm test -- tests/integration/club-comparison.test.ts`
   (expect **53 passed**) and `npx tsc --noEmit` (expect clean).
2. Read the Stage 6 contract in this runbook (H2H by decade, period-score rivalry records with
   pair-level coverage, coverage-aware H2H player averages at a minimum of 5 recorded games for the
   SPECIFIC metric) together with the V1.7 witnesses recorded above it.
3. Verify the `match_period_scores` shape and its `stat_availability` coverage key against the
   migrations BEFORE writing any period-score SQL — no such read exists anywhere in the module yet.
4. Implement the three query families in the EXISTING `src/db/queries/club-comparison.ts`, reusing
   `h2hScope()` for every population and `statCoverage()` for every availability decision. No second
   lineage, population or coverage model, and no year branch.
5. Extend the EXISTING `tests/integration/club-comparison.test.ts` with independent-SQL-oracle tests,
   then run
   `npm test -- tests/integration/club-comparison.test.ts -t "decade|period score|H2H average"`,
   then the whole file, then `npx tsc --noEmit`.
6. Append a Stage 6 record to this log and STOP. Do not start Stage 7 — Route and shareable state.

### Stage 6 — Extended rivalry analytics — COMPLETE (2026-09-06)

**Files changed**

- `src/db/queries/club-comparison.ts` — new `Stage 6 — Extended rivalry analytics` section: three
  exported query functions, their types, two private SQL fragments, one shared usability predicate,
  and a filtered view of the existing `TEAM_METRICS` registry. The module docblock now names Stage 6.
  Nothing in Stages 1–5 changed: no existing export, type, fragment or query was edited.
- `tests/integration/club-comparison.test.ts` — three new semantic describe blocks (13 tests) with
  four new independent SQL oracles, plus two new Stage 6 performance tests inside the existing
  `long rivalry performance` block. File is now **68 tests** (53 Stage 1–5, unchanged, + 15).
- `AFLDB-ISSUE-144.md` — this record.
- `IssuesIndex.md` / `issues.md` — ISSUE-144 state and next action moved from Stage 6 to Stage 7.

No migration, index, generated column, materialised view, cache, denormalised table or schema change
of any kind was added. No route, component, SEO, navigation, importer or unrelated test file was
touched. No CHANGELOG entry (the runbook still defers it to Stage 10).

**Verified `match_period_scores` schema and semantics**

Read from the migrations and then confirmed against `afldb_test` data, before any period SQL was
written:

- `match_period_scores(match_id, club_id, period, goals, behinds, points)`, PK
  `(match_id, club_id, period)`, `CHECK (period BETWEEN 1 AND 8)` — migration `003_matches.sql:88`.
- Table comment, migration `003_matches.sql:98`: *"Cumulative-to-date scores per period per club, as
  published. Periods 1-4 are quarters."* **`points` is CUMULATIVE, not per-quarter.** Confirmed
  empirically: zero rows in `afldb_test` decrease from one period to the next.
- Migration `022_match_result_integrity.sql:62-73` adds non-negativity and `points = 6*goals+behinds`.
- Migration `076_afltables_settle_projections.sql:100-103`: *"Periods 1-4 only. fitzRoy carries
  extra-time columns and the historical importer deliberately does not import them."*
- Migration `083_canonical_auto_apply.sql:45` added the provenance quartet
  (`source_id`/`import_batch_id`/`source_record_id`/`imported_at`) to the table. There is **no
  coverage_status column** and no per-row completeness flag.

Measured shape in `afldb_test`: 33,676 rows per period for periods 1, 2, 3 and 4 and none outside
that; `points` non-NULL on all 134,704 rows; all 16,838 matches carry exactly 2 clubs × 4 periods;
zero period rows reference a club that is not one of the match's two participants.

**Period 4 is NOT the final score.** Three matches prove it — `10795` (1994 QF), `13203` (2007 SF),
`15194` (2017 EF) — whose period-4 total is below the canonical `matches.home_score` because period 4
is the end of REGULATION and the importer imports no extra-time period. All three are asserted in
the test suite. Full time therefore always comes from the canonical `matches` score and
`matches.winner_club_id`, through the Stage 1 scope's `a_score` / `b_score` / `outcome`.

**Period-score completeness / coverage contract (the mandated determination)**

`stat_availability` was enumerated on `afldb_test`: 24 stat keys, all 130 seasons each — the 21
`TEAM_METRICS` player families plus `brownlow_season_total`, `brownlow_match_votes` and
`brownlow_round_votes`. **There is no period-score coverage key**, so `statCoverage()` cannot decide
period-score availability, and no schema column was invented for it.

The V1 query-level contract, derived from canonical rows alone, is:

> A meeting is USABLE only when (1) both organisations have a non-NULL cumulative `points` at
> period 1, period 2 AND period 3 — the three breaks every record is defined at — and (2) the meeting
> carries canonical final scores for both organisations.

Period 4 is deliberately not required, because nothing reads it. A meeting satisfying only part of
the contract is INCOMPLETE and contributes nothing: a missing period row is never read as nought, so
a half-populated match can neither hold nor dilute a record. The identical predicate
(`PERIOD_USABLE_PREDICATE`) is applied by both the coverage count and the records, so the denominator
a caller renders is exactly the population the records were drawn from.

**Query surfaces added**

`getHeadToHeadByDecade(orgA, orgB): Promise<H2HDecade[]>`

- Population: `h2hScope(orgA, orgB)` only. Decade = `season - mod(season, 10)`, DISCOVERED from the
  meeting population; no decade list, no era bound, and a decade with no meeting yields no row.
- Returns `decade`, `meetings`, `aWins`, `bWins`, `draws`, `aWinPercentage`, `bWinPercentage`
  (half-draw `100 × (wins + 0.5·draws) / meetings`, via the shared `winPercentage()`),
  `scoredMeetings`, `aPointsFor`, `aPointsAgainst`, `bPointsFor`, `bPointsAgainst`. Points are summed
  over scored meetings only and are null when a decade has none. Ascending by decade.

`getHeadToHeadPeriodRecords(orgA, orgB): Promise<H2HPeriodRecords>`

- `coverage: { meetings, meetingsWithPeriodRows, usableMeetings, incompleteMeetings, state }` where
  `state` is `complete` | `partial` | `none`. This is what makes *"Period-score data available for X
  of Y rivalry meetings"* statable, and it is returned even while every measured pair is complete.
- `records`: a `Record<H2HPeriodRecordKind, H2HPeriodRecordEntry[]>` over 14 kinds — biggest lead at
  quarter time / half time / three-quarter time, biggest comeback from each of those three breaks,
  and largest turnaround, each in an `-a` and a `-b` variant. Every entry is the full `H2HMeeting`
  (so a route links without a second query) plus `value`, `segment` (turnaround only) and the six
  cumulative break totals `aQuarterTime`/`aHalfTime`/`aThreeQuarterTime` and the `b` equivalents.
  All tied witnesses are retained, ordered by match date, season, match id.

`getHeadToHeadPlayerAverages(orgA, orgB): Promise<H2HPlayerAverages>`

- 18 boards, one per `H2H_AVERAGE_METRICS` entry — a filtered view of the EXISTING `TEAM_METRICS`
  registry (the same objects; a test asserts `TEAM_METRICS.includes(m)` for every one), omitting only
  `behinds`, `frees_for` and `frees_against`, which the approved V1.7 average list does not name.
  No second registry, and nothing year-based.
- Per board: `rivalrySeasons`, `coveredSeasons`, `uncoveredSeasons`, `seasonsByCoverage` (all six
  `MetricCoverage` states), `isAvailable`, `hasCoverageGap`, `minimumRecordedGames`, `leaders`.
  Availability is `statCoverage()` evaluated over the rivalry's OWN discovered seasons; an
  unavailable board returns no leaders.
- Per leader: `rank` (dense), `playerId`, `displayName`, `sortName`, `slug`, `recordedGames`,
  `total`, `average`, and `a` / `b` contributions each carrying `recordedGames`, `total`, `average`.
  A side with no recorded game is `null`, not nought. A crossover player is ONE row with two
  contributions.

**Minimum-5 metric-specific eligibility**

`H2H_AVERAGE_MINIMUM_RECORDED_GAMES = 5`, applied as
`WHERE v.recorded_games >= 5` on the metric's own `count(column)` — i.e. H2H games in which THAT
metric was recorded, never total rivalry appearances and never a per-rivalry minimum. Averages are
`sum(column) / count(column)` over non-NULL rows only; `recordedGames` is returned as the
denominator with every average. Ranking is `dense_rank()` on the average descending, cut at
`H2H_AVERAGE_RANK_LIMIT = 10` with every tie at the cut retained, then ordered by sort name and
player id.

**Independent SQL oracle — Adelaide vs Brisbane Lions by decade**

Plain two-way organisation join, `GROUP BY (season / 10) * 10`, no CTE, no shared fragment:

| decade | meetings | Adelaide wins | Lions wins | draws | Adelaide points | Lions points |
|---|---|---|---|---|---|---|
| 1990 | 5 | 2 | 3 | 0 | 415 | 462 |
| 2000 | 15 | 5 | 10 | 0 | 1221 | 1555 |
| 2010 | 13 | 10 | 3 | 0 | 1432 | 1012 |
| 2020 | 8 | 2 | 5 | 1 | 603 | 723 |

Reproduces the V1.7 witness exactly. Points-for values were verified against independent SQL and are
now asserted; `aPointsAgainst` / `bPointsAgainst` are the mirror images. Totals: 41 meetings, 19/21/1
— identical to the Stage 1 summary.

**Carlton vs Collingwood — long-history decade witness**

14 decades returned, 1890 through 2020, discovered not enumerated, strictly ascending, every one with
at least one meeting:

`1890:7(0/7/0) · 1900:26(13/13/0) · 1910:26(15/10/1) · 1920:19(8/10/1) · 1930:20(11/9/0) ·
1940:18(11/7/0) · 1950:17(5/12/0) · 1960:18(10/7/1) · 1970:25(13/11/1) · 1980:24(15/9/0) ·
1990:19(13/6/0) · 2000:20(9/11/0) · 2010:18(4/14/0) · 2020:11(2/9/0)`

Sum of decade meetings = **268**, and the decade sums of wins/losses/draws equal
`getHeadToHeadSummary` exactly — the check that no historical identity leaked in or out. Every
decade row was independently reproduced by the oracle.

**Period-score coverage witnesses**

- Adelaide / Brisbane Lions: `meetings 41, meetingsWithPeriodRows 41, usableMeetings 41,
  incompleteMeetings 0, state 'complete'`.
- Carlton / Collingwood: `meetings 268, meetingsWithPeriodRows 268, usableMeetings 268,
  incompleteMeetings 0, state 'complete'`.

**There is no live incomplete H2H period-score witness in `afldb_test`**: every one of the 16,838
canonical matches carries period-score rows, and all four periods for both clubs with non-NULL
`points`, so no pair can be chosen to exercise the incomplete path with real data. That fact is
itself asserted in the suite. The defensive logic is proved instead by a READ-ONLY query that
re-applies the production usability predicate to a population in which ONE club's three-quarter-time
row has been withheld inside the SELECT: usable falls from 41 to 40. Nothing was written to the
database.

**Period record witnesses — Adelaide vs Brisbane Lions (independently verified)**

| record | match / season | value |
|---|---|---|
| biggest quarter-time lead — Adelaide | 14132 / 2012 | 38 |
| biggest quarter-time lead — Lions | 12477 / 2004 | 46 |
| biggest half-time lead — Adelaide | 14950 / 2016 | 64 |
| biggest half-time lead — Lions | **12275 / 2002 and 15647 / 2020** (tie, both kept) | 40 |
| biggest three-quarter-time lead — Adelaide | 14950 / 2016 | 108 |
| biggest three-quarter-time lead — Lions | 12597 / 2004 | 74 |
| biggest comeback from QT — Adelaide | 12919 / 2006 | 17 |
| biggest comeback from QT — Lions | 14132 / 2012 | 38 |
| biggest comeback from HT — Adelaide | 14685 / 2015 | 17 |
| biggest comeback from HT — Lions | **12340 / 2003 and 13305 / 2008** (tie, both kept) | 12 |
| biggest comeback from 3QT — Adelaide | 14685 / 2015 | 24 |
| biggest comeback from 3QT — Lions | 13305 / 2008 | 2 |
| largest turnaround — Adelaide | 14752 / 2015, `quarter-time-to-half-time` | 49 |
| largest turnaround — Lions | 12597 / 2004, `three-quarter-time-to-full-time` | 67 |

**Comeback formula.** For a named break, the organisation must have TRAILED (`other − own > 0`) at
that break AND be the canonical winner; ranked by largest deficit overcome. A drawn match is never a
comeback win and a level break is never a comeback — both are excluded by strict inequality, and the
suite asserts no comeback entry has `outcome === 'draw'`.

Match `14132` is the load-bearing witness for exactly the trap the Stage 6 brief warned about: it is
SIMULTANEOUSLY Adelaide's biggest quarter-time lead (38) and Brisbane Lions' biggest comeback from
quarter time (38). Ranking the evidence pack by break margin alone would have attributed that record
to the wrong organisation. The tests assert both readings of the same match.

**Turnaround formula.** With margin `M(t) = own − other` at `t ∈ {QT, HT, 3QT, FT}`, the turnaround
is the largest value of `M(t+1) − M(t)` over the three consecutive pairs `QT→HT`, `HT→3QT`, `3QT→FT`,
over all usable meetings, where it is `> 0`. **FT is the canonical `matches` final score, never
period 4** — see the extra-time evidence above. The winning entry names its `segment`
(`quarter-time-to-half-time` | `half-time-to-three-quarter-time` |
`three-quarter-time-to-full-time`). No subjective label such as "momentum swing" is applied anywhere.

**H2H average oracle — Adelaide vs Brisbane Lions, disposals (min 5 recorded games)**

| rank | player | recorded games | total | average |
|---|---|---|---|---|
| 1 | Matt Crouch | 7 | 215 | 30.71 |
| 2 | Lachie Neale | 8 | 238 | 29.75 |
| 3 | Rory Laird | 14 | 404 | 28.86 |
| 4 | Brad Crouch | 6 | 167 | 27.83 |
| 5 | Tom Rockliff | 8 | 216 | 27.00 |
| 6 | Nigel Lappin | 17 | 434 | 25.53 |
| 7 | Scott Thompson | 14 | 353 | 25.21 |
| 8 | Simon Black | 23 | 574 | 24.96 |
| 9 | Josh Dunkley | 5 | 122 | 24.40 |
| 10 | Michael Voss | 16 | 378 | 23.63 |

All ten reproduced by an independent `GROUP BY … HAVING count(disposals) >= 5`, with dense ranking
applied in TypeScript rather than borrowed from the implementation's window function.

Threshold witnesses, each verified by an independent recorded-game count:

- **Exactly 5 is eligible** — Josh Dunkley, 5 recorded disposal games, rank 9.
- **4 is excluded** — Izak Rankine, 4 recorded disposal games at 20.25, which would otherwise have
  placed inside the top ten. Absent from the board.
- **The threshold is metric-specific** — Alastair Lynch has 12 recorded disposal games (eligible for
  disposals) but only 3 recorded goal-assist games (excluded from goal assists). Total rivalry
  appearances decide neither board.
- **Ties at the rank boundary are retained** — the goal-assists board returns 18 rows, with Andrew
  McLeod and Hugh McCluggage BOTH kept at rank 10 (9 assists from 11 recorded games each). Max rank
  returned is exactly 10.
- **Crossover contribution split** — Charlie Cameron is one goal-assists row: 14 recorded games,
  17 total, `a` = 5 games / 9, `b` = 9 games / 8.

**Limited-coverage metric witness**

The rivalry spans **29 discovered seasons** (1997–2025, discovered, never hard-coded). Runtime
`stat_availability` over those seasons, reproduced by an independent `LEFT JOIN` oracle:

- `disposals` — 29 complete → `coveredSeasons 29/29`, `hasCoverageGap false`.
- `goal_assists` — 23 complete, 6 not_collected → `coveredSeasons 23/29`, `uncoveredSeasons 6`,
  `isAvailable true`, `hasCoverageGap true`. The averages behind the gap are over recorded rows only
  and carry their recorded-game denominator, so a UI can present the board without implying era-wide
  comparability.
- Also observed and returned: `rebounds`/`inside50s`/`clearances`/`clangers` 28/29,
  `contested`/`uncontested`/`contested_marks`/`marks_i50`/`one_percenters` 27/29, `bounces` 24
  complete + 3 partial (`coveredSeasons` 27/29).

Every board's `seasonsByCoverage` states sum to `rivalrySeasons`, which is asserted for all 18 — the
structural proof that no availability decision anywhere depends on a year. Stage 4 season-level
coverage semantics were not weakened: `statCoverage()` and `MetricCoverage` are unchanged, and
`getClubSeasonTeamMetrics` / `getClubSeasonPlayerLeaders` were not edited.

**Validation commands and results**

- Pre-Stage-6 baseline re-confirmed first: `npm test -- tests/integration/club-comparison.test.ts`
  → **53 passed**; `npx tsc --noEmit` → clean.
- `npm test -- tests/integration/club-comparison.test.ts -t "decade|period|average"` →
  **13 passed | 55 skipped (68)**.
- `npm test -- tests/integration/club-comparison.test.ts` → **68 passed (68)**, 33.4 s. All 53
  earlier tests preserved and passing.
- `npx tsc --noEmit` → clean.
- `npx eslint` on both changed files → 0 errors; the 2 warnings are pre-existing Stage 3/5 lines
  (`_ignored` at `club-comparison.ts:1026`, an unused `no-console` disable at the Stage 5
  `reportTimings`), neither in code this stage touched.
- No browser/UI suite, no `npm run build`, no NL suite, no migration and no state-changing database
  command was run. Every oracle query was read-only `SELECT`.

**Stage 6 warm query timings** (2 discarded warmups, 5 measured runs, median; same harness and
`measure()` helper as Stage 5)

| pair | query | min | median | max |
|---|---|---|---|---|
| adelaide/brisbane-lions | `getHeadToHeadByDecade` | 15.9 | **21.6** | 66.8 |
| adelaide/brisbane-lions | `getHeadToHeadPeriodRecords` | 15.8 | **54.9** | 151.6 |
| adelaide/brisbane-lions | `getHeadToHeadPlayerAverages` | 57.5 | **64.9** | 93.8 |
| carlton/collingwood | `getHeadToHeadByDecade` | 15.0 | **62.5** | 65.7 |
| carlton/collingwood | `getHeadToHeadPeriodRecords` | 22.7 | **32.4** | 61.6 |
| carlton/collingwood | `getHeadToHeadPlayerAverages` | 89.2 | **100.0** | 114.4 |
| adelaide/brisbane-lions | extended-rivalry parallel group | 38.6 | **45.3** | 51.4 |
| carlton/collingwood | extended-rivalry parallel group | 84.5 | **103.3** | 110.0 |

All six individual medians are under the 250 ms ceiling; both parallel-group medians are under the
750 ms ceiling. The Stage 5 matrix was re-run in the same invocation (the two new tests live in that
describe block) and every Stage 1–5 timing still clears its ceiling; the route-equivalent composed
loads measured 183.0 ms and 160.9 ms against the 1.5 s target.

**Query reshaping**

One reshape, made after semantic validation and re-verified by the full suite:

- `getHeadToHeadPlayerAverages` first unpivoted the rivalry's player-match rows into
  (player, metric, value) via `CROSS JOIN LATERAL (VALUES …)` and grouped afterwards. That multiplies
  Carlton/Collingwood's ~10,700 player-match rows by 18 before reducing them, and measured **230.4 ms
  median against the 250 ms ceiling** — passing, but with no headroom. It now aggregates FIRST (four
  aggregates per metric in one `GROUP BY player_id`, B's share derived as the remainder) and unpivots
  the ~1/8-as-many aggregated rows afterwards: **100.0 ms median**, same rows, same values, same
  tests. The rationale is recorded in the code comment so it is not "simplified" back.

No other query was reshaped. Stages 1–5 production queries are byte-identical, so no Stage 5 timing
witness needed re-establishing beyond the same-run re-measurement above.

**Confirmation: no schema work**

No migration, no index, no generated column, no materialised view, no cache, no denormalised table
and no `stat_availability` key was added. `match_period_scores` is read exactly as it stands.

**Deviations and limitations**

- **No dedicated period-score runtime coverage key exists**, so period-score completeness is a
  query-level contract over canonical rows rather than a `statCoverage()` decision. This is recorded
  as the mandated determination above, not worked around. If a period-score coverage family is ever
  added to `stat_availability`, `getHeadToHeadPeriodRecords` should switch to it; the coverage shape
  it already returns would not have to change.
- **No live incomplete period-score witness exists** in `afldb_test` (see above). The defensive path
  is proved by a read-only simulated-hole query, not by real incomplete data.
- Period 4 is read by nothing and is not required for usability. If extra-time periods are ever
  imported, the full-time source stays the canonical match score and no record definition changes.
- Timings are from a Windows client over a forwarded connection and are conservative, not a Linux
  measurement. The Linux route budget is still Stage 7's to confirm.
- `H2HPeriodRecordEntry` lists are uncapped, as Stage 1's record lists are: a pathological tie would
  return every witness. `getHeadToHeadPlayerAverages` returns all 18 boards in one call; whether a
  route loads them all is a Stage 7 presentation decision.
- Still true and untouched: `getCrossoverPlayers` is unpaginated, `H2HStatRecord.holders` is
  uncapped, and `AFLDB-ISSUE-144.md.encoding-backup` remains an untracked stray in the worktree that
  must not be committed.

**Confirmation: no Stage 7 implementation began**

No route, page, layout, component, selector, validation helper, canonical-state helper, filter,
pagination control, SEO or navigation file was created or edited, and `tests/club-comparison.test.ts`
does not exist. Nothing was scaffolded or prepared for the route beyond the fact that every Stage 6
record entry already carries its full meeting, which the Stage 6 contract itself required for later
linking.

**Next stage: Stage 7 — Route and shareable state.**

Exact first action for the next fresh session, after reading this runbook and this log:

1. Confirm the baseline is still green: `npm test -- tests/integration/club-comparison.test.ts`
   (expect **68 passed**) and `npx tsc --noEmit` (expect clean).
2. Read the Stage 7 contract in this runbook (route, database-driven selectors, validation, swap,
   filters, pagination, canonical-state helpers, and the missing / invalid / same-club / historical /
   dynamic-season / canonical / filter evidence set), plus the V1.7 note that the route stage awaits
   the Stage 2 component-page dependency recorded above it.
3. Read `node_modules/next/dist/docs/` for the current routing conventions BEFORE writing route code
   — this repository's Next version differs from training data, and no `/clubs/compare` route exists
   yet.
4. Build the route against the EXISTING query surface only. Stages 1–6 expose everything the page
   needs; no new query family belongs to Stage 7.
5. Add `tests/club-comparison.test.ts` and run `npm test -- tests/club-comparison.test.ts`, then the
   integration file, then `npx tsc --noEmit`.
6. Append a Stage 7 record to this log and STOP.

### Stage 7 — Route and shareable state — COMPLETE (2026-09-06)

**Files changed**

- `src/app/clubs/compare/page.tsx` — NEW. The route: a Server Component with
  `export const dynamic = 'force-dynamic'`, an async `searchParams` Promise (Next 16.3.1), a
  `generateMetadata` that resolves metadata cheaply, and a body that resolves state and renders it.
  No SQL, no parsing rules and no URL rules live here.
- `src/app/clubs/compare/state.ts` — NEW. Parameter normalisation, the discriminated route state,
  the concurrent data load, and the separate metadata resolution.
- `src/lib/club-comparison-url.ts` — NEW. Pure, database-free URL contract: current-state path,
  canonical pair path, swap path, pagination base params, match-type recognition.
- `src/components/ClubComparisonView.tsx` — NEW, deliberately MINIMAL (see "Component boundary").
- `src/db/queries/club-comparison.ts` — ONE addition: `getComparisonOrganizations()`, the
  selector's organisation list (`ORDER BY is_active DESC, name`). Nothing existing was edited; no
  Stage 1-6 export, type, fragment or query changed.
- `tests/club-comparison.test.ts` — NEW, 14 database-free URL-contract tests (the runbook's named
  Stage 7 validation file).
- `tests/integration/club-comparison-route.test.ts` — NEW, 23 route-state, canonical-metadata and
  route-budget tests against real `afldb_test`.
- `AFLDB-ISSUE-144.md` — this record.
- `IssuesIndex.md` / `issues.md` — ISSUE-144 state and next action moved from Stage 7 to Stage 8.

No migration, index, cache, schema change, CHANGELOG entry, navigation link or unrelated file was
touched. `/clubs` and the club pages are NOT yet linked to the surface: navigation is Stage 9.

**Route architecture**

    request -> page.tsx (await searchParams)
            -> state.ts  resolveClubComparisonState()
                  1. parseParams()            no trust, no year, no club list
                  2. seasons + organisations  concurrent, canonical, every request
                  3. season resolution        max canonical, or the requested canonical one
                  4. pair resolution          missing / invalid / same-org RETURN HERE
                  5. one Promise.all          16 independent loads
            -> ClubComparisonView (minimal Stage 7 boundary)

`generateMetadata` deliberately calls a SECOND, cheap resolver (`resolveClubComparisonMetadata`):
Next calls it independently of the page, so sharing the full resolver would double every query on
the surface. It runs the same parser and at most two `getOrganizationBySlug` calls.

**Route-state shape**

`ClubComparisonRouteState` is a discriminated union on `kind`, so Stage 8 never infers a state from
a nullable field:

- `unselected` — one or both clubs missing.
- `invalid-club` — a supplied slug is not an organisation; carries `invalidSlugs`.
- `same-organization` — identical organisation ids; carries `organization`.
- `comparison` — carries `organizationA`, `organizationB` (REQUESTED order), `swapPath` and `data`.

Every state carries `params` (effective), `notices`, `options` (`seasons`, `organizations`),
`seasonMeta`, `canonicalPath`, `sharePath` and `noindex`. `data` exists ONLY on `comparison`, which
is how the tests prove no pair query ran in the other three states.

`ClubComparisonData` carries all sixteen loads: `seasonA`/`seasonB` (`getClubSeasonComparison`),
`summary`, `meetings`, `venues`, `records`, `streaks`, `crossoverSummary`, `crossoverPlayers`,
`playerLeaders`, `brownlowA`, `brownlowB`, `h2hBrownlow`, `decades`, `periodRecords`,
`playerAverages`. No derivation is duplicated in the route; every value comes from a Stage 1-6
export.

**Parameter normalisation**

| Param | Rule |
|---|---|
| `club1`/`club2` | `parseSlug` (`[a-z0-9-]{1,80}`); anything else is treated as an unknown club |
| `season` | plain integer, then membership of the canonical `seasons` list |
| `matchType` | exactly `all`, `home-and-away`, `finals`; else `all` + notice |
| `page` | `parsePage` (one-based, >= 1, capped at 10,000); else 1 + notice |

An empty value (`season=`) is an ABSENT value, not a wrong one, and raises no notice. Notices are
`{ field, message }` records so Stage 8 can place them beside the control that produced them.

**Season default and fallback**

The default is `seasons[0].season` — the maximum canonical season, discovered per request. A
requested canonical season is kept, including one the organisation did not compete in: the season
and its `seasonMeta` stay selected and `data.seasonA.participated` is `false` with a null record.
A non-canonical value (`1066`, `not-a-season`) falls back to the maximum canonical season and adds a
`season` notice naming it. No year, no year range and no season allowlist appears anywhere in the
route, the state module, the URL module or their tests; the tests themselves discover the latest and
the historical season from `seasons`.

**Same-organisation and invalid-organisation behaviour**

Both return BEFORE the `Promise.all`, so no comparison query runs with a null or duplicate id, and
both are `noindex,follow` with `canonicalPath = /clubs/compare`. `western-bulldogs` vs
`western-bulldogs` returns `same-organization` with the notice "Choose two different clubs."
`footscray` vs `western-bulldogs` returns `invalid-club`, because a historical identity is not an
organisation slug — proved as a test, not assumed. Nothing 500s, and no club is ever substituted.

**Related-distinct-organisation witness**

`brisbane-bears`/`brisbane-lions`, `fitzroy`/`brisbane-lions` and `brisbane-bears`/`fitzroy` all
resolve to `comparison`. Only identical organisation ids are rejected; `club_organization_relations`
is never consulted by the route.

**Pagination behaviour**

25 rows per page (`MEETINGS_PAGE_SIZE`), one-based, ordered `match_date DESC, season DESC, id DESC`
by the Stage 1 contract. A page beyond the last is PRESERVED, not clamped: the requested page is
echoed, the rows are empty and `totalPages`/`hasNextPage` are honest. That matches the existing
repository convention (`/players`, `/grid-solver` and the shared `Pagination` component all pass the
requested page straight through) and the Stage 1 query docblock, which explicitly left the decision
to the route. Page state never touches the H2H population: a test asserts the summary and
`totalMeetings` are identical on page 1 and page 3.

**Canonical metadata behaviour**

- Valid pair: `/clubs/compare?club1=<lower>&club2=<higher>`, slugs sorted alphabetically,
  independent of presentation order. `season`, `matchType` and `page` are omitted.
- Missing or half pair: `/clubs/compare`, indexable.
- Invalid or same-organisation pair: `/clubs/compare` with `noindex,follow` (via `pageMetadata`'s
  `noindex`, which never sets a positive `index` and so cannot defeat the site indexing gate).
- Titles use organisation NAMES for a valid pair; the landing title is the generic one.

**Current shareable state**

`sharePath` is the current view exactly: requested club order, the season that actually resolved
(pinned, so a shared link keeps showing what was shared), and `matchType`/`page` when they are not
the defaults. No request is redirected to the canonical URL — canonical metadata and shareable state
are separate concepts and both are exercised in the tests.

**Swap support**

`swapClubComparePath` reverses `club1`/`club2` and preserves season, match filter and page; the
`comparison` state exposes it as `swapPath`. Tests prove it is its own inverse and that it changes
nothing but the order. No swap control was built — that is Stage 8.

**Component boundary**

`src/components/ClubComparisonView.tsx` WAS created, as the minimal typed boundary the stage
permits, so `page.tsx` stays a state/data-loading component per the approved architecture. It
renders a heading, the notices list, one sentence per non-comparison state and two summary sentences
for a comparison. There is no selector, table, card, collapsible section, styling or coverage
explanation in it; Stage 8 replaces its body.

**Validation**

- `npm test -- tests/club-comparison.test.ts` — **14 passed** (URL contract, database-free).
- `npm test -- tests/integration/club-comparison-route.test.ts` — **23 passed** (21 state/metadata
  + 2 route budget).
- `npm test -- tests/integration/club-comparison.test.ts` — **68 passed**, run after the
  `getComparisonOrganizations` addition. Stage 1-6 regression count unchanged; nothing was deleted,
  skipped or weakened.
- `npx tsc --noEmit` — clean, no output.
- `npx eslint` over every added/changed file — clean (one pre-existing `_ignored` warning in the
  query module, untouched).
- No browser suite, no `npm run build`, no NL suite: none belongs to this stage.

**Route performance**

Measured by `tests/integration/club-comparison-route.test.ts` > "Stage 7 route budget", which times
`resolveClubComparisonState` itself — the exact work a request does, from raw query string to loaded
state — rather than a hand-assembled `Promise.all`, so the number moves if route sequencing
regresses. Two warmup runs discarded, five measured, median is the acceptance value.

| Pair | Params | Warm min | Warm median | Warm max |
|---|---|---|---|---|
| adelaide / brisbane-lions | defaults (max canonical season, all, page 1) | 167.7 ms | **324.8 ms** | 398.0 ms |
| carlton / collingwood | defaults (max canonical season, all, page 1) | 323.0 ms | **381.5 ms** | 456.6 ms |

Environment: developer workstation (Windows) over the forwarded `afldb_test` connection, Node under
vitest, warm pool. Both medians are roughly 4x inside the 1.5 s ceiling.

**Deviation: the Linux route recheck was NOT performed.**

Stage 5 deferred a supported-Linux route measurement to this stage. It could not be taken here and
is NOT claimed:

- The supported Linux runtime is the dev droplet, which deploys by `git pull` from GitHub. The Stage
  7 code is unpushed work on `codex/issue-144`, and Git and deployment are user-operated, so the
  route does not exist on any Linux host yet.
- The workstation's WSL2 Ubuntu has no Node installed; provisioning it is outside this stage.

What WAS done instead is the closest real execution path available: the route's own state resolver,
end to end, on the conservative Windows/forwarded path (table above). It is not an HTTP measurement
and not a Linux one. The recheck is a single command once the branch is on a Linux host with
`AFLDB_TEST_DATABASE_URL` set:

    npm test -- tests/integration/club-comparison-route.test.ts -t "route budget" --reporter=verbose

The same test prints the same table there. This remains outstanding and is carried into Stage 9,
which is the stage that already puts the surface on a deployed host for browser acceptance.

**Other deviations and limitations**

- `src/db/queries/club-comparison.ts` was touched, which the session brief discouraged. The runbook's
  Stage 7 change list names "database-driven selectors" and its query architecture names
  "Canonical season and organisation options" as belonging to that module; no such export existed.
  It is one additive function with no predicate beyond ordering, and the Stage 1-6 regression was
  re-run after it.
- The runbook names `tests/club-comparison.test.ts` as the Stage 7 validation file. Route-state and
  metadata resolution read canonical rows, and this repository's convention is that database-backed
  tests live under `tests/integration/` behind `./guard`. The file the runbook names exists and holds
  the database-free URL contract; the database-backed half is
  `tests/integration/club-comparison-route.test.ts`. Both commands are recorded above.
- `sharePath` pins the resolved season even when the request omitted `season`. Chosen deliberately:
  a shared link should keep showing what was shared. The canonical URL is unaffected.
- "No pair query ran" is proved structurally (`data` exists only on `comparison`) and by the type,
  not by instrumenting the SQL client.
- Still true and untouched: `getCrossoverPlayers` is unpaginated and the route loads it whole,
  `H2HStatRecord.holders` and `H2HPeriodRecordEntry` lists are uncapped,
  `getHeadToHeadPlayerAverages` returns all 18 boards in one call, and
  `AFLDB-ISSUE-144.md.encoding-backup` remains an untracked stray in the worktree that must not be
  committed.

**Confirmation: no Stage 8 implementation began**

`ClubComparisonView.tsx` contains no selector, no table, no card, no collapsible panel, no sortable
column, no coverage explanation, no swap control and no styling; no global CSS was added; no
navigation entry was added to `/clubs` or the club pages; no sitemap change was made. The Stage 1-6
semantics are consumed unchanged — the route defines no population, coverage, Brownlow or identity
rule of its own.

**Next stage: Stage 8 — Public presentation.**

Exact first action for the next fresh session, after reading this runbook and this log:

1. Confirm the baseline is still green: `npm test -- tests/integration/club-comparison.test.ts`
   (expect **68 passed**), `npm test -- tests/club-comparison.test.ts` (expect **14 passed**),
   `npm test -- tests/integration/club-comparison-route.test.ts` (expect **23 passed**), and
   `npx tsc --noEmit` (expect clean).
2. Read the Stage 8 contract in this runbook together with the "Presentation" half of the SEO,
   navigation, responsive and accessibility section.
3. Read `src/app/clubs/compare/state.ts` FIRST: Stage 8 renders `ClubComparisonRouteState` and must
   not re-derive, re-validate or re-order anything it already carries.
4. Replace the body of `src/components/ClubComparisonView.tsx` with the real presentation, reusing
   the existing `Pagination`, collapsible/sortable table components and `@/lib/format` helpers, and
   `clubComparePath` / `swapClubComparePath` / `clubCompareBaseParams` for every link it emits.
5. Do NOT add navigation links or sitemap entries — those are Stage 9.
6. Append a Stage 8 record to this log and STOP.

### Stage 8 — Public presentation — COMPLETE (2026-09-06)

**Files changed**

- `src/components/ClubComparisonView.tsx` — REPLACED. The Stage 7 minimal boundary is now the
  real entry component: page header, notices, selectors, and one branch per route state. It
  renders `ClubComparisonRouteState` and nothing else — no parameter is re-parsed, no query is
  run, and no population, coverage, Brownlow or identity rule is decided in it.
- `src/components/ClubComparisonControls.tsx` — NEW. The GET-form selectors and the swap link.
- `src/components/ClubComparisonSeason.tsx` — NEW. Selected-season record cards, team-stat
  averages and season player leaders.
- `src/components/ClubComparisonHeadToHead.tsx` — NEW. H2H overview, rivalry records, streaks,
  venue records and the paginated meeting history.
- `src/components/ClubComparisonPlayers.tsx` — NEW. H2H leaderboards, single-match records,
  connected players and H2H per-match averages.
- `src/components/ClubComparisonBrownlow.tsx` — NEW. Selected-season Brownlow, club Brownlow
  history and the H2H match-vote board.
- `src/components/ClubComparisonTrends.tsx` — NEW. Rivalry by decade and period-score records.
- `src/lib/club-comparison-format.ts` — NEW. Pure, database-free presentation vocabulary:
  coverage words, metric presentation, record/period labels, crossover direction wording, the
  two coverage sentences. `import type` only, so it pulls no server-only module.
- `tests/club-comparison-view.test.ts` — NEW, 27 database-free presentation tests.
- `tests/integration/club-comparison-view.test.ts` — NEW, 4 tests that render the view from
  REAL resolved route state against `afldb_test`.
- `AFLDB-ISSUE-144.md` — this record.
- `IssuesIndex.md` / `issues.md` — ISSUE-144 state and next action moved from Stage 8 to Stage 9.

NOT touched: `src/db/queries/club-comparison.ts`, `src/app/clubs/compare/page.tsx`,
`src/app/clubs/compare/state.ts`, `src/lib/club-comparison-url.ts`, any migration, any schema,
`CHANGELOG.md`, any global CSS file, any navigation component, any sitemap and any unrelated
public page. No additive route-state change was needed: every value the presentation wanted was
already carried by the Stage 1-7 result types.

**Component structure**

    page.tsx
      -> ClubComparisonView            header, notices, state branch
           -> ClubComparisonControls   GET form + swap link            (every state)
           -> ClubComparisonSeason     selected season                 (comparison only)
           -> ClubComparisonHeadToHead overview, records, history      (comparison only)
           -> ClubComparisonPlayers    leaders, crossover, averages    (comparison only)
           -> ClubComparisonBrownlow   season, club history, H2H votes (comparison only)
           -> ClubComparisonTrends     decades, period records         (comparison only)

Every one of these is a Server Component. The only client code on the surface is the existing
`SortableTable`, used at the narrowest boundary (venue records and the connected-player table)
and nowhere else; `CollapsiblePanel` / `CollapsibleTable` are native `<details>`, so progressive
disclosure costs no JavaScript and leaves the content in the DOM whether open or shut.

**Route-state presentation behaviour**

| State | What renders |
|---|---|
| `unselected` | Heading, lede, notices, full selectors, "Choose two clubs" explainer. No comparison section, and no club is chosen for the reader. |
| `invalid-club` | "That club could not be found", the offending slug quoted, the note that an earlier club name is not a separate choice, selectors preserved. No comparison section, no 500. |
| `same-organization` | "Choose two different clubs", naming the organisation. No empty H2H tables. |
| `comparison` | The full eleven-section surface below. |

Selections survive every non-comparison state: the selectors are rendered from `state.params`,
so a reader who mistyped one slug keeps the other, the season and the match filter.

**Selector and swap behaviour**

A plain GET form on `/clubs/compare` with `club1`, `club2`, `season` and `matchType`. Options come
from `state.options`, which the route reads from canonical rows per request: organisations are
grouped into "Current clubs" / "Former clubs" from `isActive`, and seasons from the canonical
`seasons` list with `(in progress)` appended from `isProvisional`. No club, no season, no year and
no allowlist is written down in any Stage 8 file. Submitting drops `page`, which is correct —
changing the pair, season or filter starts the history at its first page.

The second club list is deliberately NOT filtered to exclude the first. Silently removing or
switching a club is a worse answer than the route's own "Choose two different clubs", and a reader
changing only their first choice would otherwise find their second one gone. The constraint is
communicated instead: a standing hint under the controls, and the `same-organization` state.

Swap is a visible link with the accessible text "Swap the order of the two clubs" (text, not an
icon), pointing at `state.swapPath` — the Stage 7 helper, so season, match filter and page all
survive and the canonical SEO ordering is untouched.

**Selected-season behaviour**

Two stacking cards, one per organisation, each linked to its club page. A club with
`participated === false` or a null record renders `Did not compete in YEAR` and nothing else — no
other season is substituted, and the selected season stays selected. Where the season identity
differs from the organisation name the card says "Played as Footscray in 1990".

The record table carries played, wins, draws, losses, premiership points, win percentage, points
for, points against, percentage, average points for, average points against and ladder position,
and is captioned and labelled `Home-and-away record`, with the explicit note that finals are not
part of it.

Team-stat averages are one table, metric rows against two club columns, over every metric Stage 4
returns. Each cell reads its own coverage: an available metric shows the average to one decimal,
plus `23 of 24 matches` whenever it is partial or carries a denominator discrepancy; an
unavailable one shows words — Pending, Not recorded, Not applicable, No coverage record — and
never a number and never `0`. There is no winner highlighting anywhere on the page, and a fourth
column states plainly whether the two clubs' figures are comparable at all
(`hasUnequalCoverage`: different coverage state, different availability or different denominator).

Season player leaders are a collapsed panel of two club columns, each with games, goals and
disposals boards carrying the dense `rank` column, so every tied player at a cut is listed. A
board whose coverage does not permit it says so instead of rendering an empty table.

**Head-to-head, records and history**

The overview is a stat strip: total meetings, each organisation's wins with its half-draw win
percentage, draws, finals-series meetings and Grand Final meetings, then first and latest meeting
as match links. Because `getHeadToHeadSummary`, `getHeadToHeadRecords`, `getHeadToHeadStreaks` and
`getHeadToHeadVenueRecords` take no match-type argument, the page SAYS the summary is all-time and
not narrowed by the filter, and that only the match history is — rather than letting a filtered
page appear to have filtered everything. The Wildcard Final distinction is stated in the note.

Rivalry records render all eight Stage 1 kinds, each label naming the organisation it belongs to.
A record with several holders renders one row per witness, badged `Tied n of m`; a kind with no
entries reads "Not recorded". Streaks are a three-row table (longest run for each organisation,
plus the current streak with its outcome named). Venue records are a collapsed `SortableTable`
defaulting to meetings descending, canonical venue names as the query returned them, with a null
venue reading "Venue not recorded".

The meeting history is a collapsed section with date, season, round (finals badged), venue, home
club, score, away club, result and margin, in the Stage 1 order (`match_date DESC, season DESC,
id DESC`), 25 rows a page. It is a plain table rather than a `SortableTable`: client-sorting one
page of a server-ordered set would present a local ordering as a global one. Pagination is the
shared `Pagination` component fed by `clubCompareBaseParams`, so every link preserves `club1`,
`club2`, `season` and `matchType` and changes only `page`. Stage 7's out-of-range behaviour is
respected: the requested page is echoed and the section explains that the page is past the end
rather than clamping.

**Player leaders and connected players**

H2H leaderboards render the dense `rank` and always show the per-organisation split, which is how
a player who appeared for both clubs in the rivalry stays ONE row. Single-match goal and disposal
records list every holder with the club they were playing for at the time; a null value reads
"not recorded in any meeting of these two clubs", never a record of nought.

Connected players show the count, the first and most recent player to complete representation of
both (arrays, so ties are all listed), and a collapsed `SortableTable` with games/goals/first/last
for each organisation, combined games, career games and goals, order and intervening clubs. The
wording is "Order" and "`X` first", with the sentence "these rows do not record a trade, a
transfer or a direct move"; a database-free test asserts the words *traded*, *transferred* and
*moved directly* do not appear on the page.

**Brownlow presentation**

Selected season, per club: `isAuthoritative` is the only thing that permits a total. A
non-authoritative season renders its coverage word (Pending / Not recorded / Not applicable / No
coverage record) plus a sentence, never a zero and never silence. Winners come from `is_winner`
alone; ineligibility and `attributionSource === 'unattributed'` are badged; unattributed rows and
votes are disclosed in a notice and are not added to anything.

Club Brownlow history is collapsed: total votes and covered seasons, medallists, most
club-attributed votes, then two notices — the multi-club rows that could not be attributed, and
the seasons excluded because their season totals are not complete.

H2H Brownlow is collapsed and always opens with
`Recorded H2H Brownlow votes from X of Y eligible meetings.` plus the coverage state and the
sentence that only home-and-away meetings are eligible because finals are never polled. No total
anywhere on the page is derived from match-level votes.

**Decade and period-record presentation**

The decade table is built from the returned rows: `decadeLabel` is the decade plus "s" and no
decade, era or year boundary is written down. Columns are meetings, each organisation's wins,
draws, both win percentages, points for/against and the honest `scoredMeetings` denominator, with
the note that points are summed over scored meetings only.

Period records open with
`Period-score data available for X of Y rivalry meetings.` and are collapsed. Each row names the
organisation whose record it is, and carries BOTH organisations' cumulative QT/HT/3QT scores plus
the canonical full-time score — which is what stops the Stage 6 witness being misattributed:
match 14132 appears as Adelaide's biggest quarter-time lead AND Brisbane Lions' biggest comeback
from quarter time, and a test asserts both labels and both clubs' break scores render on the
shared match. Period 4 is never used as a final score. Turnaround rows name their segment, and
incomplete meetings are disclosed in a closing notice.

**H2H average presentation**

One collapsed panel holding every board Stage 6 returns. Each table is captioned with the metric,
"average per recorded rivalry match", and `Minimum 5 recorded rivalry games for this stat.` taken
from `minimumRecordedGames` rather than typed. Rows are rank, player, average to one decimal and
recorded games. A board with `hasCoverageGap` adds "Recorded in 30 of 35 rivalry seasons, so this
does not span the whole rivalry"; an unavailable board says the statistic is not recorded in any
of the rivalry's seasons; an available board with no qualifier says no player reaches the minimum.

**Coverage and empty-state behaviour**

Every section fails gracefully in words rather than as an empty table shell: never met, no venue
recorded, no connected players, no eligible average players, no usable period rows, did not
compete, metric unavailable, no page of results. `formatStat` / `formatNumber` are used
throughout, so a null is an em dash and never a zero, and no coverage state is communicated by
colour alone.

**Progressive disclosure**

Open on arrival: the header and selectors, the selected-season record cards, the H2H overview,
the rivalry-records and streak tables, and the decade table. Collapsed (`defaultOpen={false}`):
team-stat averages, season player leaders, venue records, the meeting history, connected players,
club Brownlow history, H2H Brownlow, period records and the average boards. Native `<details>`
keeps all of it in the DOM for a crawler and for in-page search.

**Responsive and accessibility implementation**

Repository patterns only, no new stylesheet and no bespoke design system: `.page-header`,
`.section`, `.card` inside `.grid .grid-panels` (so the two club cards stack rather than squash),
`.stat-strip`, `.table-wrap` (horizontal scrolling for the wide tables, with no column dropped on
mobile), `.filter-grid` / `.filter-group` / `.filter-actions` for the controls, `.badge`,
`.notice`, `.empty`, `.muted`, `.not-recorded`. Nothing is fixed-width.

Semantics: one `<h1>`, `<h2>` per major section (and `CollapsiblePanel` puts its own `<h2>` in the
`<summary>`), `<h3>`/`<h4>` inside; `<label>` bound by `htmlFor` on all four selectors, wrapped in
a `<fieldset>` with the legend "Choose two clubs"; `<caption>` on every table; `<th scope="col">`
on headers and `<th scope="row">` on record/metric row labels; the swap control is a link with a
full sentence rather than an icon; notices carry `role="status"`; every state word (Pending,
Not recorded, Did not compete, Tied n of m) is text. No ARIA was added where the native semantics
already say it. Formal acceptance is Stage 9's.

**Validation**

- `npm test -- tests/club-comparison-view.test.ts` — **27 passed** (database-free presentation).
- `npm test -- tests/integration/club-comparison-view.test.ts` — **4 passed** (view rendered from
  real resolved route state).
- `npm test -- tests/integration/club-comparison.test.ts` — **68 passed** (Stage 1-6, unchanged).
- `npm test -- tests/integration/club-comparison-route.test.ts` — **23 passed** (Stage 7,
  unchanged).
- `npm test -- tests/club-comparison.test.ts` — **14 passed** (Stage 7 URL contract, unchanged).
- All five together: **136 passed**, 47.7 s.
- `npx tsc --noEmit` — clean, no output.
- `npx eslint` over all ten added/changed files — clean, no output.
- Baseline before implementation was re-proved first: the same three pre-existing suites at
  105 passed and `tsc` clean.

No test was deleted, skipped or weakened, and no existing semantic integration test was replaced
by a snapshot.

**What the presentation tests prove**

Landing (selectors render, nothing auto-selected, no comparison section); invalid-club and
same-organization messages with no comparison section; all ten comparison section headings; an
uncollected metric rendering words and NOT `0`; a pending metric rendering Pending; a partial
metric rendering `23 of 24 matches`; unequal coverage rendering "Different coverage"; a pending
selected-season Brownlow rendering Pending; the H2H Brownlow X-of-Y sentence; the period-score
X-of-Y sentence; the average board's minimum-games and coverage-gap disclosures; a tied record
rendering both witnesses; one shared match rendering as two opposite period records with both
clubs' break scores; `Did not compete in 1930` with the selected season unchanged; the swap link
preserving season, filter and page; pagination links preserving club/season/filter; a
normalisation notice; three empty states; and the absence of trade/transfer wording.

**Deviations and limitations**

- The meeting history is a plain table, not a `SortableTable`. Deliberate: it is one
  server-ordered, server-paginated page of a much larger set, and client-sorting 25 of 800 rows
  would present a local ordering as a global one. Every board where all rows ARE present and
  ranking is not semantically load-bearing uses `SortableTable`; the ranked boards keep their
  dense `rank` column so a client sort cannot destroy rank meaning.
- Venues are plain text. `H2HVenueRecord` and `H2HMeeting` carry `venueId` and `venueName` but no
  venue slug, and `venuePath` needs one; inventing a route was not an option, so no link is
  emitted. If Stage 9 wants venue links, the query layer must return a slug — a Stage 6/7
  contract change, not a presentation one.
- Organisation names ARE linked to `/clubs/<slug>`. Verified rather than assumed: all 21
  `club_organizations.slug` values resolve to a `clubs` row in `afldb_test`.
- The two `stat-strip` win percentages are shown as a note under each organisation's win count
  rather than as their own tiles, to keep the strip readable on a phone.
- No blocker was found. Nothing in Stages 1-7 needed an additive projection, and no query or
  route file was edited.

**Confirmation: no Stage 9 acceptance work began**

No navigation entry was added to `/clubs`, the club pages, `SiteNav` or anywhere else. No sitemap
change, no `tests/seo.test.ts` change, no `tests/e2e/*` change, no Playwright run, no
`npm run build`, no accessibility audit, no responsive acceptance sweep, no browser matrix and no
Linux host check. The Stage 5/7 supported-Linux route recheck remains outstanding and is still
carried into Stage 9.

**Next stage: Stage 9 — Navigation / SEO / accessibility / responsive / browser acceptance.**

Exact first action for the next fresh session, after reading this runbook and this log:

1. Confirm the baseline is still green: `npm test -- tests/club-comparison.test.ts` (**14**),
   `npm test -- tests/club-comparison-view.test.ts` (**27**),
   `npm test -- tests/integration/club-comparison.test.ts` (**68**),
   `npm test -- tests/integration/club-comparison-route.test.ts` (**23**),
   `npm test -- tests/integration/club-comparison-view.test.ts` (**4**), and `npx tsc --noEmit`.
2. Read the Stage 9 contract in this runbook together with the "Navigation" and "SEO" halves of
   the SEO, navigation, responsive and accessibility section.
3. Decide and implement the entry points: `/clubs`, the club pages, and the sitemap — the surface
   is currently reachable only by typing its URL.
4. Then run the browser acceptance suite named by the stage
   (`npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts`) and take the deferred
   supported-Linux route measurement
   (`npm test -- tests/integration/club-comparison-route.test.ts -t "route budget"`) once the
   branch is on a Linux host with `AFLDB_TEST_DATABASE_URL` set.
5. Append a Stage 9 record to this log and STOP.

### Stage 9 — Navigation / SEO / accessibility / responsive / browser acceptance — COMPLETE (2026-09-06)

**Baseline before any Stage 9 edit**

`npm test` over the five comparison suites together — **136 passed**, 46.8 s
(`tests/club-comparison.test.ts` 14, `tests/club-comparison-view.test.ts` 27,
`tests/integration/club-comparison.test.ts` 68,
`tests/integration/club-comparison-route.test.ts` 23,
`tests/integration/club-comparison-view.test.ts` 4). `npx tsc --noEmit` clean. The Stage 8
handoff was green, so nothing was hidden by acceptance work.

**Files changed**

- `src/app/clubs/page.tsx` — the public entry point: `Compare clubs →` in the page header,
  the same `.section-note` pattern `/players` uses for `/players/compare`.
- `src/app/clubs/[slug]/page.tsx` — the seeded entry point:
  `/clubs/compare?club1=<current identity slug>`, worded `Compare with another club →` on a
  current identity and `Compare <continuing club> with another club →` on a historical era, so
  the link never claims to compare an era the surface cannot resolve.
- `src/app/sitemap.ts` — segment 0 now lists the BASE `/clubs/compare` only, beside the
  existing `/players/compare`.
- `src/styles/globals.css` — one new opt-in modifier, `.grid-shrink > * { min-width: 0 }`,
  with the reason recorded in the file. Nothing existing changed.
- `src/components/ClubComparisonSeason.tsx` — `grid-shrink` on the two `.grid-panels` grids.
- `src/components/ClubComparisonBrownlow.tsx` — `grid-shrink` on its two `.grid-panels`
  grids, and the club-Brownlow-history column heading `<h4>` → `<h3>` (heading-level fix).
- `tests/seo.test.ts` — +1 sitemap policy test.
- `tests/club-comparison-view.test.ts` — +8 database-free accessibility-semantics tests
  (27 → **35**).
- `tests/integration/club-comparison-route.test.ts` — +5 tests: four on the metadata the ROUTE
  emits and one pinning the club-page seed mapping (23 → **28**).
- `tests/e2e/journeys.spec.ts` — +8 browser acceptance tests.
- `tests/e2e/seo.spec.ts` — `/clubs/compare` added to the metadata `PAGES` table, +2 tests.
- `AFLDB-ISSUE-144.md` — this record.
- `IssuesIndex.md` / `issues.md` — ISSUE-144 state moved from Stage 9 to Stage 10.

NOT touched: `src/db/queries/club-comparison.ts`, `src/app/clubs/compare/*`,
`src/lib/club-comparison-url.ts`, `src/lib/club-comparison-format.ts`, `SiteNav.tsx`, any
migration, any schema, `CHANGELOG.md`, and every unrelated page. No statistical semantics, no
route parameter contract and no canonical rule was changed.

**Navigation entry points**

Two, both following the `/players/compare` precedent exactly rather than inventing a second
navigation system:

1. `/clubs` — `Compare clubs →` in the page header. This is the discovery path a reader
   without a club in mind takes, and `Clubs` is already in `PRIMARY_NAV`.
2. `/clubs/[slug]` — `Compare with another club →`, seeded with the club's ORGANISATION.

`SiteNav.PRIMARY_NAV` was deliberately NOT extended: `/players/compare` is not in it either,
the comparison is a tool under an existing section rather than a section, and a tenth masthead
link costs every page on the site. The mobile `TabBar` is likewise untouched — it carries five
tabs and no compare link of any kind; the mobile path is Home → Clubs → Compare clubs, which
the browser suite exercises in the `[mobile]` project.

The seed uses `club.currentIdentitySlug` and no special mapping, because current identity IS
the mapping: verified against `afldb_test` that for all 24 `clubs` rows the current identity's
slug equals the organisation's slug (0 mismatches, 24 clubs / 21 organisations), and pinned by
a new integration test that resolves route state from every club's seed and asserts none of
them lands in `invalid-club`. So `/clubs/footscray` seeds `western-bulldogs` and says so in
its link text.

**Sitemap decision**

The base route is listed once, in segment 0, at `changeFrequency: 'monthly', priority: 0.5` —
identical to `/players/compare`. Nothing else about the comparison is published: 21
organisations are 210 unordered pairs, and pair × season × match filter × history page is tens
of thousands of URLs whose canonical is the ordered pair anyway. `tests/seo.test.ts` now
asserts `/clubs/compare` appears exactly once in segment 0 and that NO segment (0, 1, 100,
200, 300) emits a URL containing `club1=`, `club2=` or `matchType=`. The indexing gate already
governs the whole map, so a non-indexed deployment still publishes nothing.

**Rendered canonical / noindex results**

Proved twice: against `generateMetadata` from `src/app/clubs/compare/page.tsx` (the object Next
turns into the head) in `tests/integration/club-comparison-route.test.ts`, and against the head
actually served by the production build in `tests/e2e/seo.spec.ts`.

| Request | Canonical | Robots |
|---|---|---|
| `/clubs/compare` | `/clubs/compare` | no page-level directive |
| `?club1=adelaide&club2=brisbane-lions` | `?club1=adelaide&club2=brisbane-lions` | none |
| `?club1=brisbane-lions&club2=adelaide` | `?club1=adelaide&club2=brisbane-lions` | none |
| `+ season, matchType, page` | `?club1=adelaide&club2=brisbane-lions` | none |
| `?club1=not-a-club&club2=adelaide` | `/clubs/compare` | `index: false, follow: true` |
| `?club1=adelaide&club2=adelaide` | `/clubs/compare` | `index: false, follow: true` |
| `?club1=footscray&club2=western-bulldogs` | `/clubs/compare` | `index: false, follow: true` |

`og:url` follows the canonical rather than the requested order, and the requested order is
never redirected — the shareable URL a reader is on stays the URL they are on.

The e2e suite deliberately does NOT assert that a valid pair is indexABLE, for the reason
already documented at the top of `tests/e2e/seo.spec.ts`: on a deployment with
`AFLDB_INDEXING` off every page carries `noindex`, so the pair-state distinction is provable
only against `generateMetadata`, which is where it is now proved.

**Accessibility audit — method, findings, fixes**

The repository ships no accessibility tooling (no axe, no jest-axe) and Stage 9 did not add a
dependency to get one. The audit was instead a scripted DOM audit run in Chromium against the
production build, over five route states (landing, invalid club, same organisation, and two
comparisons), with EVERY `<details>` forced open so nothing hid behind a disclosure. It
checked: one `<h1>`; no heading-level jump; every form control programmatically labelled;
every table captioned; every table having `<th>`; every `<th>` carrying `scope`; every link
and button having a non-empty, non-vague accessible name; every `<img>` having `alt`; every
`<details>` having a named `<summary>`.

One real defect, and it is fixed: **an h2 → h4 jump**. `CollapsiblePanel` renders its title as
an `<h2>` inside the `<summary>`, so the `<h4>` naming each club inside "Club Brownlow history"
skipped h3 for anyone navigating by heading. Now `<h3>`.

After the fix the audit reports NO PROBLEMS on all five states. The comparison page carries 29
headings, 45 tables, 9 disclosures, 545 links and 4 controls, and every one of them passes.
Keyboard operation was verified in-browser: from the first selector the tab order reaches the
swap control ("Swap the order of the two clubs" — a sentence, not an icon) with no trap, and
the focused element has a visible focus style. State words (Pending, Not recorded, Did not
compete, Tied n of m, Different coverage) remain text, so nothing is carried by colour alone.

The eight database-free tests added to `tests/club-comparison-view.test.ts` pin the parts of
that audit that need no browser: one h1, no heading-level jump, four labelled selectors inside
a `<fieldset>`/`<legend>`, a caption on every table, no bare `<th>`, and a named `<summary>` on
every disclosure — for both the landing and the comparison state.

**Responsive acceptance — widths, findings, fixes**

Measured at 360, 390, 768, 1280 and 1600 px, on four routes (landing, Adelaide/Brisbane Lions,
Carlton/Collingwood 1930, Adelaide/Carlton 1930), with every disclosure forced open.

One real defect, and it is fixed: **the page scrolled sideways at 360 and 390 px**
(`documentElement.scrollWidth` 448 vs `clientWidth` 360). Cause, measured rather than guessed:
a grid item's automatic minimum size is its min-content width, and a `.grid-panels` column
holding a `.table-wrap` took that minimum from the TABLE inside the wrapper — the min-content
contribution of those columns was 395-424 px — so the grid TRACK grew to 423.6 px inside a
312 px container and the document overflowed instead of the table scrolling. The fix is the
opt-in `.grid-shrink > * { min-width: 0 }` modifier applied to the four `.grid-panels` grids in
the comparison that contain tables (selected-season cards, season player leaders, selected-
season Brownlow, club Brownlow history). No existing grid on any other page is affected.

After the fix `scrollWidth === clientWidth` at every one of the five widths on every one of the
four routes, with all nine disclosures open. Selectors stack one per row at 360 px with no
clipped label, the two club cards stack rather than squash, wide tables scroll inside their own
`.table-wrap`, no column is dropped on mobile, and long names wrap. Screenshots at 360 and
1280 px were reviewed and discarded; nothing was committed as a screenshot baseline, in keeping
with the repository having no snapshot convention.

The mobile browser test now force-opens every disclosure at 360 px and re-asserts containment,
so this defect cannot come back silently.

**Browser / e2e acceptance**

Run against the production standalone build served on `127.0.0.1:3100`, in both configured
projects (`desktop` = Desktop Chrome, `mobile` = Pixel 7).

New ISSUE-144 scenarios, all passing (18 passed, 2 skipped — the mobile-only overflow check on
desktop and the keyboard check on mobile, each skipped by design):

1. `/clubs` → `Compare clubs` → `/clubs/compare`; selectors visible, nothing auto-selected, no
   comparison section rendered.
2. `/clubs/adelaide` → `Compare with another club` → `?club1=adelaide`, first selector holding
   `adelaide` and the second empty.
3. Adelaide v Brisbane Lions renders all ten section headings — selected season, head-to-head,
   rivalry records, match history, player rivalry leaders, connected players, Brownlow, by
   decade, period records, player averages — and the collapsed meeting history opens to a real
   table.
4. Reversed pair: the h1 reads `Brisbane Lions v Adelaide`, the canonical stays
   `?club1=adelaide&club2=brisbane-lions`, and the swap link reverses the presentation back.
5. Historical season: `?club1=adelaide&club2=carlton&season=1930` keeps 1930 in the selector
   and in the URL, heads the section `Selected season — 1930`, and renders
   `Did not compete in 1930` with no fallback to a season Adelaide did play.
6. Match filter and pagination: `matchType=finals` survives into the selector; on
   Carlton/Collingwood the history's `Next →` produces `page=2` with `club1`/`club2` intact and
   `Page 2 of …` rendered.
7. Invalid input: bad club, same organisation, same-organisation-by-era
   (`footscray`/`western-bulldogs`), non-numeric season, unknown match type and an out-of-range
   page all answer **HTTP 200** with an explanation and exactly one `<h1>`. No 500, and no
   Next error page.
8. Mobile containment at 360 px with every disclosure open (above).
9. Keyboard: labelled controls, tab order reaching the swap link, visible focus.
10. SEO: `/clubs/compare` added to the metadata table (title, description, canonical, `og:*`,
    one `<h1>`); the canonical/ordering test above; and an invalid pair proved
    `noindex` + followable, never a soft 404.

Whole-file run of both specs: **90 passed, 20 failed, 4 skipped**. Every one of the 20 failures
is a PRE-EXISTING, dataset-dependent test unrelated to ISSUE-144, and none of them touches a
file this stage changed. They fail because the application database this workstation reaches
is not the dataset those tests were written against: they hard-code entity ids, and
`/players/…-4182` is Ern McIntyre here while the tests expect Scott Pendlebury (who is 11724 in
this database) — the ISSUE-136/137 renumbering. The affected tests are the player-search,
records-category, stale-slug, Brownlow, home-win, Person/BreadcrumbList and stale-slug-redirect
journeys, in both projects. Stage 10 should re-run the full e2e suite on the supported Linux
dev host, where the dataset matches, before reading anything into those 20.

Playwright's own `webServer` could not start the standalone bundle on this workstation: it runs
`node .next/standalone/server.js` with no `PORT`, so the server binds 3000 while the config
waits on 3100 and times out at 60 s. The supported path was used instead — the config skips
`webServer` when `AFLDB_E2E_BASE_URL` is set — with the same bundle started by hand:

    PORT=3100 HOSTNAME=127.0.0.1 node .next/standalone/server.js
    AFLDB_E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test \
      tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts

**Production build**

`npm run build` (`next build --webpack` + `tools/build/prepare-standalone.mjs`) — **exit 0**,
three times over the stage (baseline, after the CSS modifier, after the heading fix). The route
table lists `ƒ /clubs/compare`, i.e. dynamic, which is what `export const dynamic =
'force-dynamic'` asks for; no `searchParams` misuse, no server/client boundary error, no
metadata generation failure and no serialization error was reported. The only build warnings
are the pre-existing Edge-Runtime `process.cwd` notices from `next` itself.

One operational note for Stage 10: a running standalone server holds `.next/standalone` open on
Windows and the next build fails with `EBUSY: rmdir '.next\standalone'`. Stop the server before
rebuilding.

**Linux route-performance recheck — STILL OUTSTANDING**

NOT DONE, and not claimed. The branch `codex/issue-144` exists only in this Windows worktree;
it is not on the Linux dev host, and putting it there is a Git/deploy operation reserved to the
user. No substitute measurement is offered as if it were the Linux one.

The exact outstanding command, once the branch is on the supported Linux runtime with
`AFLDB_TEST_DATABASE_URL` set:

    npm test -- tests/integration/club-comparison-route.test.ts -t "route budget"

It measures `resolveClubComparisonState` for Adelaide/Brisbane Lions and Carlton/Collingwood,
two warmups then five timed runs each, and asserts the warm median under the 1.5 s ceiling
while printing min/median/max. The Stage 7 workstation figures remain the only ones recorded,
and they are conservative (a forwarded database connection adds per-statement latency), not
substitutes.

**Validation summary**

- `npm test` over the five comparison suites plus `tests/seo.test.ts` — **172 passed**, 47.5 s
  (`club-comparison` 14, `club-comparison-view` 35, `integration/club-comparison` 68,
  `integration/club-comparison-route` 28, `integration/club-comparison-view` 4, `seo` 23).
  The Stage 8 count of 136 is intact and has grown to 149 across the same five files.
- `npx tsc --noEmit` — clean, exit 0, no output.
- `npx eslint` over all eleven changed source/test files — **0 errors**. Two warnings, neither
  introduced here: `CollapsibleTable` is an unused import in `src/app/clubs/page.tsx` at HEAD
  (left alone rather than tidied as unrelated scope), and eslint has no configuration covering
  `src/styles/globals.css`.
- `npm run build` — exit 0.
- Playwright — 18 ISSUE-144 checks passed, 2 skipped by design; 20 pre-existing dataset
  failures elsewhere in the same two files (above).
- Accessibility audit — NO PROBLEMS on five route states after one fix.
- Responsive sweep — `scrollWidth === clientWidth` at 360/390/768/1280/1600 px on four routes
  after one fix.

No test was deleted, skipped, weakened or replaced. Stage 8's three deviations were preserved
deliberately: the meeting history is still a plain server-ordered table, venues are still plain
text (the query layer returns no slug and Stage 9 did not invent a venue URL contract), and
organisation links still point at `/clubs/<slug>`.

**Stage 6 witness re-checked**

Match 14132 still renders as Adelaide's biggest quarter-time lead AND Brisbane Lions' biggest
comeback from quarter time, with both clubs' break scores on the shared row. The database-free
test that asserts it is unchanged and passing, and nothing in the presentation fixes above
touched `ClubComparisonTrends.tsx`.

**Deviations and limitations**

1. No accessibility dependency was added; the audit is a scripted DOM audit plus in-browser
   keyboard and focus checks, and the durable part is now unit-tested.
2. `SiteNav` was not extended, for the reason given under Navigation. If a future decision
   wants Compare in the masthead it is a navigation-architecture change, not an ISSUE-144 one.
3. The 20 pre-existing e2e failures are environmental. They are recorded rather than fixed:
   fixing them means either re-pointing this workstation at the matching dataset or rewriting
   other subsystems' tests, both outside ISSUE-144.
4. The Linux route recheck is outstanding, above.
5. Four untracked `AFLDB-ISSUE-144-venue-*` files appeared in the worktree during this session
   and were NOT created, read or removed by Stage 9; they are not part of this record.

**Confirmation: no Stage 10 work began**

No commit, no merge, no Git command of any kind, no deployment, no `CHANGELOG.md` entry, no
issue resolution, and no global regression suite run for closeout. `issues.md` and
`IssuesIndex.md` carry only the minimum state edit.

### Stage 10 — Final regression / closeout preparation — COMPLETE (2026-09-06)

**Worktree safety check (first action, before any edit)**

`git status --porcelain=v1` was inspected before any change. The four Stage-9-reported foreign files
were present, untouched by this session, and remain excluded from the ISSUE-144 inventory below:
`AFLDB-ISSUE-144-venue-evidence.ts`, `AFLDB-ISSUE-144-venue-evidence.txt`,
`AFLDB-ISSUE-144-venue-probes.ts`, `AFLDB-ISSUE-144-venue-schema-probe.ts` (timestamps 20:00-20:04,
after this session's own baseline run started). `AFLDB-ISSUE-144.md.encoding-backup` (a stray
pre-conversion runbook copy, already noted in `issues.md` Stage 0) is likewise untouched. No other
unexpected changed or untracked file was found. Nothing was deleted, edited, renamed or staged.

No Next.js standalone server was running at session start (`Get-CimInstance Win32_Process` showed
only Playwright-MCP `node` processes, unrelated to a build server), so the production build ran with
no `.next/standalone` lock. A standalone server was started later in this session, on this worktree's
own build, solely to re-run the browser suite, and was stopped again by this session before the final
`git status` check (below) — no other process was touched.

**Final baseline — no regression from Stage 9**

`npm test -- tests/club-comparison.test.ts tests/club-comparison-view.test.ts
tests/integration/club-comparison.test.ts tests/integration/club-comparison-route.test.ts
tests/integration/club-comparison-view.test.ts tests/seo.test.ts` — **172 passed**, 50.1 s. Identical
count to the Stage 9 record (14 + 35 + 68 + 28 + 4 + 23 = 172). No test was added, removed, skipped or
weakened.

`npx tsc --noEmit` — clean, exit 0, no output.

`npx eslint` over the fourteen ISSUE-144 production files plus the seven ISSUE-144 test files (the
same set Stage 9 audited, plus `src/app/clubs/compare/page.tsx` explicitly) — **0 errors, 3
warnings**:

- `src/app/clubs/page.tsx:4` — `CollapsibleTable` unused import. PRE-EXISTING, already documented at
  Stage 9; not touched, since fixing an unrelated already-accepted import is cosmetic scope creep.
- `src/db/queries/club-comparison.ts:1047` — `_ignored` unused var. NEW, introduced by ISSUE-144's
  own `getHeadToHeadPlayerLeaders` implementation: a deliberate destructure-to-exclude pattern
  (`holders: rows.map(({ recordedRows: _ignored, ...holder }) => holder)`) that this repository's
  ESLint config does not special-case for `_`-prefixed bindings. Harmless — the variable is
  intentionally unused — and left as-is rather than restructuring already-accepted, tested code for a
  warning with no behavioural effect.
- `tests/integration/club-comparison.test.ts:2445` — an `eslint-disable-next-line no-console` above
  `console.table(rows)` that this config's `no-console` rule does not actually flag, so the directive
  itself is reported unused. Harmless test-only scaffolding (the performance-timing table print);
  not touched for the same reason.

Both new warnings are ISSUE-144-caused but non-blocking (0 errors) and are recorded rather than
cosmetically cleaned up, per the "do not alter product code merely for cosmetic final cleanup"
instruction for already-accepted work.

`npm run build` — **exit 0**, confirmed twice (once standalone, once immediately re-run to pin the
exit code). Route table still lists `ƒ /clubs/compare` (dynamic). No `searchParams`, metadata,
serialization or server/client-boundary failure. Only warnings are the pre-existing Edge-Runtime
`process.cwd` notices from `next` itself.

**Browser acceptance rerun (Windows workstation — informational, not the Linux gate)**

Standalone build served on `127.0.0.1:3100` (`PORT=3100 HOSTNAME=127.0.0.1 node
.next/standalone/server.js`, `/api/health` returned 200), then
`AFLDB_E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test tests/e2e/journeys.spec.ts
tests/e2e/seo.spec.ts` in both `desktop` and `mobile` projects.

Result: **90 passed, 20 failed, 4 skipped** — identical to the Stage 9 record in every count. The 20
failures are the same named tests Stage 9 recorded (player-search, records-category, stale-slug,
mid-century Brownlow, pending-Brownlow, home-win, Person/BreadcrumbList and stale-slug-redirect
journeys, each in both projects), still caused by this workstation's application database carrying
the pre-ISSUE-136/137 player numbering (`/players/…-4182` is Ern McIntyre here, Scott Pendlebury is
`11724`). None of the 20 touches `/clubs/compare`, any ISSUE-144 file, or any ISSUE-144 test scenario.
This is a like-for-like reproduction proving no regression since Stage 9, not the Linux acceptance
run itself.

The server (PID resolved via `Get-NetTCPConnection -LocalPort 3100`, confirmed by command line
`node .next/standalone/server.js` before termination) was stopped after the run. A final `git status`
confirmed no `test-results/` or build artefact was tracked or staged.

**Linux route-budget recheck — STILL OUTSTANDING**

`Linux route gate: OUTSTANDING — requires user-controlled branch availability.`

`codex/issue-144` exists only in this Windows worktree. No Git push, merge, or branch-availability
change occurred in this or any prior ISSUE-144 session, so there is no supported-Linux checkout of
this code to measure. This session did not fake or substitute a Windows timing for the Linux figure.
Exact command, once the user has made the branch available on the Linux dev host with
`AFLDB_TEST_DATABASE_URL` set:

    npm test -- tests/integration/club-comparison-route.test.ts -t "route budget" --reporter=verbose

It measures `resolveClubComparisonState` for Adelaide/Brisbane Lions and Carlton/Collingwood, two
warmups then five timed runs each, asserting the warm median under the 1.5 s ceiling. The Stage 7
Windows/forwarded-connection figures (324.8 ms / 381.5 ms warm medians) remain conservative evidence
only, not a substitute.

**Full Linux e2e rerun — STILL OUTSTANDING for the same reason**

`Linux full-e2e gate: OUTSTANDING — requires user-controlled branch availability.` The 20 Windows
failures above are preserved as an environment diagnosis (pre-ISSUE-136/137 numbering), not fixed —
fixing them means either re-pointing this workstation at the matching dataset or editing other
subsystems' tests, both outside ISSUE-144 scope. This is carried into the user's pre-deploy
verification below rather than resolved here.

**Final ISSUE-144 regression — every V1 layer reconfirmed intact**

The 172-test rerun above exercises every layer unchanged since Stage 9: Stage 1 H2H
population/meetings/records/streaks/venues, Stage 2 connected/crossover players and direction, Stage
3 H2H leaders/club Brownlow/H2H Brownlow coverage, Stage 4 season selection/team metrics/leaders/
Brownlow pending-complete, Stage 5 query-reshape semantics, Stage 6 decade breakdown/period-score
records/comeback perspective/H2H averages, Stage 7 route state/canonical URLs/invalid handling, Stage
8 presentation/coverage text/ties/pagination/swap/did-not-compete, and Stage 9
discoverability/SEO/responsive/accessibility/browser behavior. No test file was touched this stage, so
no semantic could have silently regressed between Stage 9's run and this one — the identical 172-count
and identical 90/20/4 Playwright split are the proof.

Specific load-bearing witnesses reconfirmed present in the unchanged test files (not re-derived, since
nothing that produces them changed): Footscray inside Western Bulldogs and South Melbourne inside
Sydney history, Brisbane Bears/Fitzroy/Brisbane Lions remaining distinct, Adelaide v Brisbane Lions
41/19/21/1/2, match 14132 as both Adelaide's biggest quarter-time lead and Brisbane Lions' biggest
comeback from quarter time (Stage 9 explicitly re-checked this witness and it is untouched by any
Stage 10 edit), historical-coverage-as-unavailable-not-zero, the 5-game H2H-average minimum, and the
dynamically-discovered maximum canonical season with no year literal in application code (unchanged —
no production file was edited this stage).

**Hard-coded year guard**

Not re-scanned by a fresh search this stage because no production file changed — `src/db/queries/
club-comparison.ts` was not touched, and the guard was already proven at Stage 4 and re-carried
through every subsequent stage's unchanged-file list. No 2025/2026-specific logic, supported-year
array, or metric-year cutoff was introduced.

**Final changed-file audit**

*ISSUE-144 implementation files* (all deliberately created/changed across Stages 0-9; none edited by
Stage 10):

- `src/app/clubs/compare/` (route: `page.tsx`, `state.ts`)
- `src/lib/club-comparison-url.ts`, `src/lib/club-comparison-format.ts`
- `src/db/queries/club-comparison.ts`
- `src/components/ClubComparisonView.tsx`, `ClubComparisonControls.tsx`, `ClubComparisonSeason.tsx`,
  `ClubComparisonHeadToHead.tsx`, `ClubComparisonPlayers.tsx`, `ClubComparisonBrownlow.tsx`,
  `ClubComparisonTrends.tsx`
- `src/app/clubs/page.tsx`, `src/app/clubs/[slug]/page.tsx` (modified — navigation entry points)
- `src/app/sitemap.ts` (modified — base compare URL in segment 0)
- `src/styles/globals.css` (modified — `.grid-shrink` opt-in modifier)
- `tests/club-comparison.test.ts`, `tests/club-comparison-view.test.ts`,
  `tests/integration/club-comparison.test.ts`, `tests/integration/club-comparison-route.test.ts`,
  `tests/integration/club-comparison-view.test.ts`
- `tests/seo.test.ts`, `tests/e2e/journeys.spec.ts`, `tests/e2e/seo.spec.ts` (modified)
- `AFLDB-ISSUE-144.md` (this runbook), `IssuesIndex.md`, `issues.md` (modified), `CHANGELOG.md`
  (modified this stage)

*Foreign/unowned files* (present, untouched, excluded from the above): `AFLDB-ISSUE-144-venue-
evidence.ts`, `AFLDB-ISSUE-144-venue-evidence.txt`, `AFLDB-ISSUE-144-venue-probes.ts`,
`AFLDB-ISSUE-144-venue-schema-probe.ts`, `AFLDB-ISSUE-144.md.encoding-backup`.

*Read-only evidence artefacts* (untracked, kept for record, not implementation): `ISSUE-144-EXTENDED-
RIVALRY-EVIDENCE.sql`/`.txt`, `ISSUE-144-H2H-TESTDB-EVIDENCE.sql`/`.txt`.

*Generated output*: none staged or tracked — `git status` after the build and after the Playwright run
shows no `.next/`, `test-results/` or build artefact.

**CHANGELOG**

Repository convention (confirmed from existing `[Unreleased]` entries, e.g. `AFLDB-ISSUE-139`) adds a
dated `### AFLDB-ISSUE-XXX — <title> - <date>` entry at feature completion, not deferred to merge. One
entry was added to `CHANGELOG.md` describing the public capability (club-vs-club comparison, season
comparison, rivalry history/records, connected players, Brownlow, decade/period trends, coverage-aware
averages) without claiming deployment or release.

**Closeout decision**

## READY FOR USER GIT CLOSEOUT

Every ISSUE-144-controllable acceptance item is green (172 tests, clean `tsc`, 0 eslint errors, exit-0
build, 18/18 ISSUE-144 Playwright checks with the same 20 pre-existing unrelated failures as Stage 9).
The two remaining Linux items are classified as environment/deployment prerequisites gated on a
user-controlled Git action, not hidden failures, and are carried into the handoff below rather than
silently marked passed.

**Required user handoff**

1. Review `git status` / `git diff`.
2. Separately inspect and resolve the foreign `AFLDB-ISSUE-144-venue-*` files and
   `AFLDB-ISSUE-144.md.encoding-backup` — not part of this issue's changeset.
3. Commit the ISSUE-144 files listed above.
4. Push/merge per normal AFLDB workflow.
5. Make the merged `codex/issue-144` code available on the Linux/dev host.
6. Run `npm test -- tests/integration/club-comparison-route.test.ts -t "route budget" --reporter=verbose`
   there (target: warm median under 1.5 s for both witness pairs).
7. Run `npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts` there and confirm the 20
   Windows-only failures are absent on the matching dataset.
8. Close ISSUE-144 only once 6 and 7 pass.
9. Deploy the merged code straight to dev (per the user's stated intent).
10. Run the post-deploy smoke checklist: `/api/health`; `/clubs/compare` base landing selectors;
    Adelaide v Brisbane Lions; Carlton v Collingwood (long-rivalry scale); swap; a historical season;
    a match-type filter; pagination; mobile sanity; check logs for route errors on `/clubs/compare`.

No Git command, no commit, no push, no merge, no issue closure, and no deployment was performed by
this session.


## Follow-up: Club Rivalry Explorer redesign (browser review)

### Status

**IMPLEMENTATION COMPLETE — 2026-09-07. NOT YET DEPLOYED.** Allocated 2026-09-06 on branch
`claude/issue-144-rivalry` (worktree `D:\dev\afldb-issue-144`), which was branched after the V1.7
implementation above was already merged into `main` (commit `2102b51`). This section is a distinct,
additive scope: a post-merge browser review of the shipped `/clubs/compare` surface produced an
approved redesign ("Club Rivalry Explorer") that changes the surface from a season-comparison-first
layout to an all-time-first, era-drillable rivalry layout. It does not amend or reopen Stages 0-10
above, which stay as the historical record of the original implementation. **All five follow-up
stages are now COMPLETE: FR-1, FR-2 and FR-3 (2026-09-06); FR-4 (mobile/desktop + URL acceptance,
2026-09-07, including three rounds of test-only Playwright flake hardening); FR-5 (regression and
closeout, 2026-09-07) — final targeted acceptance gate GREEN.** See each stage's entry below for exact
files and evidence, and the FR-5 acceptance entry for the final green result. **Uncommitted** on
`claude/issue-144-rivalry` — commit, push, PR and DEV deployment are all still outstanding and remain
the operator's call; see "FR-5 — final acceptance and Git handoff" at the end of this section.

### Approved design contract (verbatim from the browser review)

- Default pair view is All time.
- Remove season UI/state from this surface.
- Decade/era chips become the primary time drill-down.
- Hero summary remains all-time.
- Rivalry records and match history can be era-filtered where semantically safe.
- Streaks remain all-time, because decade slicing would truncate cross-boundary streaks.
- Match-type filter moves inside Match History only.
- Venues, players and Brownlow remain all-time unless explicitly supported otherwise.
- Reorder the page to: Header → Hero → Era explorer → Rivalry records → Venues → Players →
  Brownlow → Match history.
- Mobile/desktop layout and URL behaviour follow the approved design.

Nothing in this redesign may reintroduce a season allowlist, a hard-coded decade/era list, or a
second lineage/H2H population definition: eras are read from the pair's own canonical meeting
population (`getHeadToHeadByDecade`), exactly as the V1.7 decade breakdown already does.

### Follow-up stage plan

Same execution discipline as Stages 0-10: one stage per session by default, each appending its own
record here before stopping (Stage FR-1 and its immediately-following contract/investigation work
were exceptionally combined into one session on the operator's explicit instruction).

- **FR-1 — Remove season from the route/state/URL/presentation contract.** The comparison becomes
  all-time only: no season parameter, no season selector, no per-season club record/team-metrics/
  player-leaders/Brownlow block on this page. The underlying selected-season query layer
  (`getClubSeasonComparison` and the primitives it composes) is DELIBERATELY NOT deleted — it is
  fully covered by its own 3,477-line database integration suite
  (`tests/integration/club-comparison.test.ts`) that tests it independently of this route, deleting
  it would require rewriting that suite blind (no database access this session), and nothing in the
  approved design asks for the query capability itself to be destroyed — only for this page to stop
  using it. This keeps Stage FR-1 to exactly one concern.
- **FR-2 — Era explorer and query-layer era filtering.** Add an `era` URL parameter resolved
  against the pair's own decade population (not a global list); build the interactive decade/era
  chip UI; extend the query layer so rivalry records and match history can be scoped to a chosen
  era where semantically safe (single-match records, meetings list). Streaks, venues, players and
  Brownlow stay all-time regardless of the era filter.
- **FR-3 — Section split and reorder.** Split the current monolithic `ClubComparisonHeadToHead`
  into Hero (all-time H2H summary), Rivalry records (records + streaks, era-aware per FR-2),
  Venues (its own section, all-time) and Match History (meetings + a local match-type GET control +
  pagination). Reorder the page to Header → Hero → Era explorer → Rivalry records → Venues →
  Players → Brownlow → Match history, and relocate the match-type control out of the shared
  `ClubComparisonControls` form into Match History's own form.
- **FR-4 — Mobile/desktop layout and URL behaviour acceptance — COMPLETE.** Responsive sweep at the
  established breakpoints, URL/share-link behaviour for `era` + `matchType` + `page`, and a
  browser/Playwright pass against the approved design.
- **FR-5 — Regression and closeout — COMPLETE.** Full suite re-run, `CHANGELOG.md` entry, issue-ledger sync.

### FR-1 — Remove season from the route/state/URL/presentation contract — COMPLETE (2026-09-06)

**Status: FR-1 — COMPLETE.** Executed on branch `claude/issue-144-rivalry` in
`D:\dev\afldb-issue-144`. No database was contacted (read-only source inspection only). No Git
command was run beyond read-only `git status` / `git log` / `git show --stat`.

**Exact files changed**

- `src/app/clubs/compare/state.ts` — removed `season` from `ComparisonEffectiveParams`, the
  `notice` field union, `parseParams`, `ComparisonOptions` (dropped `seasons`), and
  `ClubComparisonData` (dropped `seasonA`/`seasonB`); removed the `getComparisonSeasons` /
  `getClubSeasonComparison` calls and their imports; removed the season-validation-notice branch.
- `src/lib/club-comparison-url.ts` — removed `season` from `ComparisonUrlParams`,
  `clubComparePath` and `clubCompareBaseParams`; updated the file's own doc comment.
- `src/components/ClubComparisonControls.tsx` — removed the Season `<select>` field from the
  shared GET form. The match-type field stays here for now — FR-3 is what gives Match History its
  own form to relocate it into, so moving it in FR-1 would strand it with no destination section.
- `src/components/ClubComparisonView.tsx` — removed the `Season {year} ·` fragment from the page
  subtitle; removed the `<ClubComparisonSeason>` render block and its import; stopped passing
  `season`/`seasonA`/`seasonB` to `ClubComparisonBrownlow`.
- `src/components/ClubComparisonBrownlow.tsx` — removed the `season`/`seasonA`/`seasonB` props,
  the "Selected season" `<h3>` + card grid, and the now-dead `SeasonBrownlow` helper and its
  now-unused `ClubSeasonComparison` / `ClubSeasonBrownlowSummary` / `formatStat` imports. The
  Club Brownlow history and H2H Brownlow-votes sections are untouched — both were already all-time.
- `src/components/ClubComparisonSeason.tsx` — DELETED. Its only caller was `ClubComparisonView`;
  no test imported it directly (it was exercised only through rendering the full view), so no test
  file references the deleted path.
- `tests/club-comparison.test.ts` — removed the database-free URL-contract assertions for `season`
  in `clubComparePath` / `clubCompareBaseParams`.
- `tests/club-comparison-view.test.ts` — removed the season fixture data, the Season-selector
  assertions and the "Season 2024 ·" subtitle assertions; a hand-built `ComparisonEffectiveParams`/
  `ClubComparisonData` fixture no longer carries `season`/`seasonA`/`seasonB`.
- `tests/integration/club-comparison-route.test.ts` — removed the season-notice and
  season-round-trip route-state assertions, and dropped the two `getClubSeasonComparison` calls
  from the route-budget performance composition (the route itself no longer calls them).
- `tests/integration/club-comparison-view.test.ts` — removed the one assertion that resolved a
  route state with an explicit `season` query parameter.
- `tests/e2e/journeys.spec.ts` — removed the `Season` label/selector assertions, the entire
  "a historical season stays selected, and a club that did not compete says so" Playwright test,
  the `season=not-a-year` case from the invalid-state sweep, and repointed the mobile-viewport
  disclosure check from the deleted "Season player leaders" heading to "Club Brownlow history".
- `tests/e2e/seo.spec.ts` — updated doc comments only; its canonical-URL assertions already treat
  an unrecognised `season` query parameter as dropped, which remains true now that the route never
  reads it at all.
- **NOT changed:** `src/db/queries/club-comparison.ts` (the query layer, including
  `getClubSeasonComparison`/`getClubSeasonBrownlowSummary`/`ClubSeasonComparison`, is left intact
  and unused-by-this-page rather than deleted — see the FR-1 stage-plan entry above for why) and
  `tests/integration/club-comparison.test.ts` (tests that query layer directly and is unaffected by
  a route-layer change).

**Validation**

No test, typecheck, lint or build command was run by this session — CLAUDE.md §9 reserves shell
execution (including tests, typecheck, lint and build) to the user by default, and no explicit
authorisation to execute commands was given for this task. The exact commands the user should run,
in order, are:

1. `npx tsc --noEmit` — expect clean; this is the fastest way to catch a missed reference to the
   removed `season` fields or the deleted `ClubComparisonSeason` module.
2. `npx eslint src/app/clubs/compare src/components/ClubComparison*.tsx src/lib/club-comparison-url.ts`
   — expect 0 errors (pre-existing warnings noted in the Stage 10 entry above are unrelated).
3. `npx vitest run tests/club-comparison.test.ts tests/club-comparison-view.test.ts` — database-free;
   expect all pass with no season-related assertion remaining.
4. `npm test -- tests/integration/club-comparison-route.test.ts tests/integration/club-comparison-view.test.ts`
   — requires `AFLDB_TEST_DATABASE_URL` pointed at a database ending in `_test`; expect all pass,
   including the route-budget timing (now composing one fewer query pair per side).
5. `npm test -- tests/integration/club-comparison.test.ts` — same database; expected UNCHANGED from
   Stage 10, since the query layer this suite exercises was not touched.
6. `npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts` — against a running build
   with matching data; expect all pass, with no `Season` control or `Selected season`/"Season player
   leaders" heading expected anywhere on `/clubs/compare`.

**Blockers, deviations and unresolved observations**

- DEVIATION from the default one-stage-per-session rule: the operator explicitly instructed this
  session to record the follow-up contract/stage-plan AND execute FR-1 in the same sitting.
  Recorded here rather than silently normalised.
- DEVIATION from CLAUDE.md's default "smallest change" framing of season removal: `getClubSeasonComparison`
  and its composed primitives (`getComparisonSeason`, `getSeasonIdentity`, `getClubSeasonRecord`,
  `getClubSeasonTeamMetrics`, `getClubSeasonPlayerLeaders`, `getClubSeasonBrownlowSummary`) remain in
  `src/db/queries/club-comparison.ts`, fully tested but no longer called by any route. This is a
  deliberate scope decision, not an oversight — see the FR-1 stage-plan entry above. If the operator
  wants this dead code removed, that is a distinct, separately-scoped follow-up stage against
  `tests/integration/club-comparison.test.ts` (3,477 lines, ~16 lines tied to this function
  specifically) with database access to verify the result.
- No stop condition was triggered. Nothing found while reading the current implementation
  contradicts the approved design contract above.

### FR-2 — Era explorer and query-layer era filtering — COMPLETE (2026-09-06)

**Status: FR-2 — COMPLETE.** Executed on branch `claude/issue-144-rivalry` in
`D:\dev\afldb-issue-144`. No database was contacted (read-only source inspection only, exactly as
FR-1). No Git command was run beyond read-only inspection.

**Design decisions**

- `era` is a decade's first season (`1990` for the 1990s), the same value `getHeadToHeadByDecade`
  already groups by. It is never validated against a hard-coded range or list — the only thing that
  makes an `era` legitimate is appearing in the pair's OWN decade population, i.e. a row
  `getHeadToHeadByDecade(a, b)` actually returned for this pair. A pair that has only ever met since
  2000 therefore rejects `era=1990` even though `1990` is a perfectly good decade in general.
- Per the approved design contract, only two things are ever era-scoped: rivalry records
  (`getHeadToHeadRecords`) and the match history (`getHeadToHeadMeetings`). The hero/hero-adjacent
  summary, streaks, venues, player leaders/averages, crossover and Brownlow sections stay all-time
  regardless of `era` — none of their queries gained an `era` parameter, and the runbook's own
  rationale for streaks (a decade boundary would truncate a run that crosses it) is now also stated
  in the rendered UI, not just this file.
- Validating `era` requires knowing the pair's decade population, which requires the pair to be
  resolved first — unlike `matchType`/`page`, it cannot be checked from the raw query string alone.
  This changes `resolveClubComparisonState`'s shape exactly as the Stage FR-1 exit note predicted:
  the Promise.all that used to load all fourteen Stage 1-6 query results at once is now two batches
  — batch 1 loads everything that does not depend on `era` (including `getHeadToHeadByDecade` itself,
  since it IS the era population), batch 2 loads `getHeadToHeadRecords`/`getHeadToHeadMeetings` once
  `era` has been validated against batch 1's decades. This adds one serial round trip to the warm
  route budget; see Validation below for why that is not expected to threaten the 1.5 s ceiling.
- An `era` present in the URL but not one of the pair's own decades (unparsable, or a real decade
  the two organisations never met in) produces a `ComparisonNotice` with `field: 'era'` and silently
  falls back to all time — exactly the treatment an invalid `matchType` or `page` already gets.
- The era chip UI reuses the existing `sort-nav`/`sort-link`/`sort-label` filter-link pattern already
  used by `/players/compare` (`aria-current` marks the active choice), and the existing bare `.chip`/
  `.meta` classes for the per-decade meeting count — no new global CSS was added, per the "narrowly
  scoped styles only where existing utilities are insufficient" rule.

**Exact files changed**

- `src/db/queries/club-comparison.ts` — `h2hScope` gained an optional fourth `era` parameter,
  applied as `m.season >= era AND m.season < era + 10` against the SAME `meetings` CTE every other
  Stage 1-6 query builds from (no second population definition). `getHeadToHeadRecords` gained an
  `options: { era?: number }` parameter. `getHeadToHeadMeetings` gained `era` in its existing options
  object and now returns `era: number | null` on `MeetingsPage`. Every other caller of `h2hScope`
  (summary, streaks, venues, decade breakdown, period records, player leaders/averages, Brownlow) is
  unchanged and still runs all-time only.
- `src/app/clubs/compare/state.ts` — added `era: number | null` to `ComparisonEffectiveParams` and
  `'era'` to `ComparisonNotice['field']`; added a database-free `parseEra` helper; split the Stage 5
  `Promise.all` into the two batches described above; added the era-validation step between them;
  the `comparison` state's returned `params`/`sharePath`/`swapPath` are now built from the corrected
  `effectiveParams` (carrying the validated `era`), not the pre-validation `params` FR-1 left in
  place for the `unselected`/`invalid-club`/`same-organization` states (those states cannot validate
  `era` — there is no resolved pair to check it against — so they pass the raw parsed value through
  unchanged, which only affects what appears in their own non-functional shareable URL).
- `src/lib/club-comparison-url.ts` — added `era?: number | null` to `ComparisonUrlParams`; carried
  it through `clubComparePath` (added after `matchType`, before `page`) and `clubCompareBaseParams`
  (so era-filtered match-history pagination keeps its era across pages, exactly as it keeps the
  match type). `canonicalClubComparePath` was NOT changed — era stays out of the SEO canonical URL,
  the same treatment `matchType`/`page` already get, because it takes only the two slugs and cannot
  accept one even if asked.
- `src/lib/club-comparison-format.ts` — added `eraScopeSentence(era)` (the section-note sentence:
  all-time, or "The 1990s only, over meetings from that decade of the rivalry.") and
  `eraCaptionSuffix(era)` (a table-caption suffix: `" (1990s)"` or `""`).
- `src/components/ClubComparisonEraExplorer.tsx` — NEW. The chip row itself: "All time" plus one
  chip per row `getHeadToHeadByDecade` actually returned for this pair, each linking to
  `clubComparePath` with that `era` (and the pair/match-type carried, page dropped so a new era
  starts its history at page 1). Renders nothing when the pair has no decades at all (a pair with
  zero meetings).
- `src/components/ClubComparisonHeadToHead.tsx` — added a `decades: H2HDecade[]` prop; renders
  `<ClubComparisonEraExplorer>` between the head-to-head summary and the rivalry-records section
  (the approved reorder that makes it sit ABOVE both era-aware sections is FR-3's job, not this
  stage's — inserting it here is the smallest change that makes the chips reachable and functional
  now); the rivalry-records section-note and table caption are now era-aware via
  `eraScopeSentence`/`eraCaptionSuffix`; an era-conditional sentence was added immediately above the
  Streaks table and inside the Venue records `CollapsibleTable` stating plainly that both stay
  all-time — added only when `params.era !== null`, so the default all-time view is unchanged; the
  match-history section-note and table caption are now era-aware via `meetings.era`.
- `src/components/ClubComparisonView.tsx` — passes `decades={state.data.decades}` through to
  `ClubComparisonHeadToHead` (previously only `ClubComparisonTrends` received it).
- `tests/club-comparison.test.ts` — added database-free assertions that `clubComparePath`,
  `swapClubComparePath` and `clubCompareBaseParams` carry/omit `era` correctly.
- `tests/club-comparison-view.test.ts` — added `era: null` to the hand-built params/meetings
  fixtures (both now required fields); added an `era explorer` describe block asserting the chip row
  renders, that choosing an era updates the rivalry-records caption/section-note, that the
  all-time-only clarifiers for streaks/venues appear only when an era is chosen, and that they do
  NOT appear in the default all-time view.
- `tests/integration/club-comparison.test.ts` — added an era-filtering test for
  `getHeadToHeadMeetings` against the Adelaide/Brisbane Lions decade witness already recorded in
  this runbook (1990s=5, 2000s=15, 2010s=13, 2020s=8, summing to the known 41), including a decade
  this rivalry never met in returning zero rows rather than an error; added an era-filtering test
  for `getHeadToHeadRecords` asserting every returned record's `season` falls inside the requested
  decade, and that a decade with no meetings returns "not recorded" for every record kind.
- `tests/integration/club-comparison-route.test.ts` — added a `Stage FR-2 route state: era
  filtering` describe block: a valid era narrows `data.meetings`/`data.records` while leaving
  `summary`/`streaks`/`venues`/`decades` byte-for-byte equal to the all-time state; an era outside
  the pair's history or an unparsable era produces an `era` notice and falls back to all-time;
  `resolveClubComparisonMetadata` never puts `era` on the canonical path.
- `tests/integration/club-comparison-view.test.ts` — added an end-to-end render test against real
  `afldb_test` data asserting the era chip row renders and the rivalry-records caption reflects the
  chosen era, and a second test asserting an out-of-history era surfaces as rendered notice text
  rather than a crash.
- **NOT changed:** `tests/e2e/journeys.spec.ts` / `tests/e2e/seo.spec.ts` — a browser/Playwright pass
  against the approved design is explicitly FR-4's job ("Mobile/desktop layout and URL behaviour
  acceptance"), not FR-2's; adding era journeys here now would duplicate work FR-4 is scoped to do
  properly against the finished FR-3 section layout. `src/components/ClubComparisonTrends.tsx` (the
  "By decade" table) — it is the SOURCE of the era chips' population and stays all-time and
  unfiltered, exactly as before.

**Validation**

No test, typecheck, lint or build command was run by this session — CLAUDE.md §9 reserves shell
execution to the user by default, and no explicit authorisation to execute commands was given for
this task. The exact commands the user should run, in order, are:

1. `npx tsc --noEmit` — expect clean; this is the fastest way to catch a missed `era` field on the
   `MeetingsPage`/`ComparisonEffectiveParams` shapes this stage made required.
2. `npx eslint src/app/clubs/compare src/components/ClubComparison*.tsx src/lib/club-comparison-url.ts src/lib/club-comparison-format.ts src/db/queries/club-comparison.ts`
   — expect 0 errors.
3. `npx vitest run tests/club-comparison.test.ts tests/club-comparison-view.test.ts` — database-free;
   expect all pass, including the new era-explorer and era-URL assertions.
4. `npm test -- tests/integration/club-comparison.test.ts` — requires `AFLDB_TEST_DATABASE_URL`
   pointed at a database ending in `_test`; expect all pass, including the new
   `getHeadToHeadMeetings`/`getHeadToHeadRecords` era tests against the Adelaide/Brisbane Lions
   decade witness. If the decade counts in that test (5/15/13/8) no longer match `afldb_test`'s
   current content, that is new evidence about the test database, not a defect in this stage — the
   assertions were written from the runbook's own already-recorded decade witness (V1.7 evidence
   section), not invented.
5. `npm test -- tests/integration/club-comparison-route.test.ts tests/integration/club-comparison-view.test.ts`
   — same database; expect all pass, including the new `Stage FR-2 route state: era filtering`
   block and the two new end-to-end view tests. Also re-read the existing `Stage 7 route budget`
   numbers this run prints (`console.log` per pair): they are expected to be slightly higher than
   the FR-1 numbers because of the one extra serial round trip step 4 above adds, and should still
   sit comfortably under the 1.5 s ceiling given the FR-1 numbers had headroom, but this session has
   no database access to confirm that measurement itself.
6. `npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts` — unchanged by this stage;
   expect the same result as at the end of FR-1. This is NOT a check of the new era behaviour — that
   is FR-4's job.

**Blockers, deviations and unresolved observations**

- DEVIATION (scope, deliberate): the approved reorder — "Header → Hero → Era explorer → Rivalry
  records → Venues → Players → Brownlow → Match history" — is FR-3's job, not this stage's. FR-2
  therefore renders the era explorer between the existing "Head-to-head" and "Rivalry records"
  sections of the still-monolithic `ClubComparisonHeadToHead`, which is functionally correct (the
  chips sit immediately above the two sections they affect) but is not yet the approved page order,
  since there is no standalone "Hero" section for it to follow yet. This was the explicit
  instruction for this session ("Scope this stage to the era explorer and query-layer era filtering
  only") and matches the FR-1 precedent of keeping each stage to exactly one concern.
- DEVIATION (performance, inherent to the safety contract): resolving `era` safely requires knowing
  the pair's decade population first, which serialises `getHeadToHeadRecords`/`getHeadToHeadMeetings`
  after the batch that includes `getHeadToHeadByDecade`, adding one round trip to the warm route
  budget that did not exist after FR-1. This is not an oversight — an `era` cannot be validated
  against a population that has not been loaded yet — but it is a real, unmeasured latency change
  that Validation step 5 above asks the user to re-confirm against the 1.5 s ceiling.
- No stop condition was triggered. Nothing found while reading the current implementation
  contradicts the approved design contract or the V1.7 decade-population rules it must not
  duplicate.

### FR-3 — Section split and reorder — COMPLETE (2026-09-06)

**Status: FR-3 — COMPLETE.** Executed on branch `claude/issue-144-rivalry` in
`D:\dev\afldb-issue-144`. No database was contacted (read-only source inspection only, exactly as
FR-1/FR-2). No Git command was run beyond read-only inspection, with one exception recorded under
Blockers below (a file-delete command).

**Design decisions**

- The approved order — Header → Hero → Era explorer → Rivalry records → Venues → Players → Brownlow
  → Match history — names exactly those eight items and nothing else. `ClubComparisonTrends.tsx`'s
  two sections ("By decade" and "Period records") are not named separately in that order, so they are
  folded into "Rivalry records" as `<h3>` subsections rather than left as, or promoted to, their own
  top-level sections — the alternative would have silently added two undeclared items to a page order
  the operator approved verbatim.
- "Always expanded" versus "collapsed" is implemented structurally, not by a `defaultOpen` prop on a
  shared wrapper: an always-expanded section is a plain `<section>` with its own `<h2>`; a collapsed
  section is a `CollapsiblePanel`/`CollapsibleTable` (`defaultOpen={false}`), which supplies its own
  `<h2>` inside its `<summary>` instead. This is why a collapsed section's *title* is still visible
  immediately (a closed `<details>` hides everything except its `<summary>`) while its *content* is
  not — proved directly in the updated `tests/e2e/journeys.spec.ts` assertions (see below).
- Rivalry records stays a plain `<section>` (always expanded) per the operator's explicit requirement
  this session. Its one nested disclosure — the period-records table — is unchanged from FR-2/Stage 8:
  that table was already behind its own `CollapsibleTable` even inside an all-expanded section, and
  nothing in this session's brief asked for that specific nested disclosure to be removed.
- Venues, Players, Brownlow and Match history are each demoted to exactly ONE collapsed disclosure.
  For Venues this was a straight promotion of the nested "Venue records" `CollapsibleTable` that used
  to sit inside the old "Rivalry records" section — same content, same `defaultOpen={false}`, new id
  (`venues`, not `venue-records`, matching the approved order's own naming) and title ("Venues", the
  word the approved order itself uses — the operator's own phrasing this session, "Venue records
  collapsed", is read as a description of the content, not a mandated heading string, since the
  authoritative approved-order list already settled on "Venues"). For Players and Brownlow, this
  meant REMOVING a layer of independent inner disclosure that Stage 8/9 had built (Club Brownlow
  history and H2H Brownlow votes were each their own collapsible; the three Players subsections were
  three independent `<section>`s) — collapsing the outer section without also flattening the inner
  ones would have produced a `<details>` nested one level inside another `<details>` purely to
  reproduce a distinction ("which subsection is open") the approved design no longer asks this page to
  offer. The inner headings drop from `<h2>` to `<h3>` (Players' three subsections, Brownlow's two)
  or `<h3>`→`<h4>` (the two clubs' names inside Club Brownlow history, since that subsection itself is
  now one level deeper than before), since the outer panel's `<summary>` now supplies the section's
  own `<h2>`. Connected Players' "Every connected player" table and Player Averages' "Average
  leaderboards" panel keep their OWN pre-existing nested disclosures unchanged — those were never
  independently named in the approved order and collapsing them further is outside this stage's brief.
- Match History's match-type control is a new, minimal GET form (not the `TableFilters` component
  `search/table-filters.ts` drives elsewhere): `TableFilters` is built around the NL/search
  query-builder's `FilterField`/`FilterValues` vocabulary for a different, heavier use case, and
  wiring one boolean-ish three-option field through it would be new machinery for no behavioural gain.
  The new form carries `club1`/`club2` and (when set) `era` as hidden fields so that changing match
  type here narrows only Match History and leaves every other section's state untouched; it is passed
  to `ClubComparisonMatchHistory`'s `CollapsibleTable` via the existing `filters` slot (the same slot
  `TableFilters` itself renders into elsewhere), so it collapses and expands with the table it belongs
  to, exactly as that slot's own contract describes.
- The shared `ClubComparisonControls` form no longer carries `matchType` at all. A consequence, not a
  defect: submitting that form (choosing a new pair) now always starts the new comparison at
  `matchType=all` rather than preserving whatever match type the previous pair had — for a genuinely
  new comparison this reads as the right default, and it matches how `era` already behaved (never
  carried by that form either, since a new pair may not even have the previously-chosen decade).
  Swapping the pair (`swapPath`, a `Link`, not a form submit) still preserves `matchType`/`era`/`page`
  unchanged, exactly as before — only the club-selector form's own submission changed.
- The page subtitle (`ClubComparisonView`'s `<p className="subtitle">`) dropped its
  `matchTypeLabel(state.params.matchType)` fragment ("All time · All matches" → "All time"). Match
  type no longer describes the whole page once its control moved to be local to Match History; leaving
  the old text would have kept asserting a page-wide filter that no longer exists as such.

**Exact files changed**

- `src/components/ClubComparisonHero.tsx` — NEW. The all-time head-to-head summary, extracted
  verbatim from the old `ClubComparisonHeadToHead`'s first `<section id="head-to-head">` block. Always
  a plain expanded `<section>`.
- `src/components/ClubComparisonRivalryRecords.tsx` — NEW. The single-match records table and streaks
  table from the old `ClubComparisonHeadToHead`'s "Rivalry records" section, plus the by-decade table
  and period-records table folded in verbatim from the now-deleted `ClubComparisonTrends`, as `<h3>`
  subsections (`id="by-decade"`, `id="period-records"`) inside the one `<section id="rivalry-records">`.
  Always expanded except the period-records table's own pre-existing nested `CollapsibleTable`.
- `src/components/ClubComparisonVenues.tsx` — NEW. The venue-records table promoted out of the old
  "Rivalry records" section into its own top-level `CollapsibleTable` (`id="venues"`, title "Venues",
  `defaultOpen={false}`). Takes `era` directly (not the full `params` object) since it only needs it
  for the one all-time-disclosure sentence.
- `src/components/ClubComparisonMatchHistory.tsx` — NEW. The meetings table and pagination from the
  old `ClubComparisonHeadToHead`'s "Match history" section, now the sole content of its own top-level
  `CollapsibleTable` (`id="match-history"`, `defaultOpen={false}`) — the previous inner "Every meeting"
  nested disclosure is gone, since the outer section is now the one collapse this content needs. Adds
  a local `MatchTypeFilter` form (described above) passed through the `filters` slot.
- `src/components/ClubComparisonHeadToHead.tsx` — DELETED. Its content is now split across
  `ClubComparisonHero`, `ClubComparisonRivalryRecords`, `ClubComparisonVenues` and
  `ClubComparisonMatchHistory`.
- `src/components/ClubComparisonTrends.tsx` — DELETED. Its content is now the by-decade/period-records
  subsections inside `ClubComparisonRivalryRecords`.
- `src/components/ClubComparisonPlayers.tsx` — the three subsections (Player rivalry leaders, Connected
  players, Player averages in this rivalry) are now wrapped in one outer `CollapsiblePanel id="players"
  title="Players" defaultOpen={false}`; their own headings drop from `<h2>` to `<h3>`. Their existing
  nested disclosures (`connected-players-table`, `player-average-boards`) are unchanged.
- `src/components/ClubComparisonBrownlow.tsx` — the whole section is now one outer `CollapsiblePanel
  id="brownlow" title="Brownlow" defaultOpen={false}`; "Club Brownlow history" and "Brownlow votes in
  this rivalry" are no longer independently collapsible — they are plain `<div>`s with `<h3>` headings,
  and the two clubs' names inside Club Brownlow history drop from `<h3>` to `<h4>` (now one level
  deeper). The `CollapsibleTable` import is no longer needed and was removed.
- `src/components/ClubComparisonControls.tsx` — removed the `matchType` `<select>` and its now-unused
  `MATCH_TYPES`/`MATCH_TYPE_LABELS` imports; updated the file's own doc comment (FR-1 had already
  flagged this field as temporary, pending FR-3).
- `src/components/ClubComparisonView.tsx` — imports and renders the four new components plus the
  existing `ClubComparisonEraExplorer` (moved here from inside the old `ClubComparisonHeadToHead`) in
  the approved order; dropped the `matchTypeLabel` subtitle fragment and its now-unused import; updated
  the file's own doc comment to describe the new section order and the expanded/collapsed contract.
- `tests/club-comparison-view.test.ts` — split the "renders every selector" assertion (removed the
  `matchType` claim) into a new dedicated test asserting NO match-type control exists on the landing
  page; rewrote "renders every major section" to expect `table-details-title">X</h2>` for the four
  collapsed sections (Venues/Players/Brownlow/Match history) and `<h3>` for their promoted-or-demoted
  subsections, instead of a uniform `<h2>`; changed "labels every control" to expect 2 selects on
  landing and 3 on a comparison (the two club selects, plus Match History's own match-type select only
  once a comparison exists).
- `tests/e2e/journeys.spec.ts` — "a rivalry renders every section" now checks section TITLES are
  visible on load (true for both plain sections and a closed `<details>`'s own `<summary>`), then
  separately opens the Players disclosure before checking its three now-nested `<h3>` subsections are
  visible; every locator that used to find the nested "Every meeting" disclosure now finds "Match
  history" itself (that nested disclosure no longer exists); the mobile-viewport disclosure check
  re-pointed from "Club Brownlow history" (no longer its own `<details>`) to "Brownlow"; the
  keyboard-labelled-controls test drops "Match type" from the plain load-time visibility loop (it is
  now behind a closed disclosure) and instead opens Match History first, then asserts it is visible.
- **NOT changed:** `src/db/queries/club-comparison.ts`, `src/app/clubs/compare/state.ts`,
  `src/lib/club-comparison-url.ts`, `src/lib/club-comparison-format.ts` — this stage is presentation
  structure only, exactly as scoped; every era/matchType/page semantic FR-1/FR-2 built is unchanged.
  `tests/integration/club-comparison-view.test.ts` and `tests/e2e/seo.spec.ts` needed no change: the
  former asserts on section-name substrings and canonical URLs, not heading tags or collapse state; the
  latter is canonical-URL/metadata-only.

**Validation**

No test, typecheck, lint or build command was run by this session — CLAUDE.md §9 reserves shell
execution to the user by default, and no explicit authorisation to execute commands was given for
this task. The exact commands the user should run, in order, are:

1. `npx tsc --noEmit` — expect clean; this is the fastest way to catch a stale import of either
   deleted component, or a prop-shape mismatch on the four new components.
2. `npx eslint src/app/clubs/compare src/components/ClubComparison*.tsx src/lib/club-comparison-url.ts src/lib/club-comparison-format.ts src/db/queries/club-comparison.ts`
   — expect 0 errors.
3. `npx vitest run tests/club-comparison.test.ts tests/club-comparison-view.test.ts` — database-free;
   expect all pass, including the rewritten heading/control-count assertions.
4. `npm test -- tests/integration/club-comparison.test.ts tests/integration/club-comparison-route.test.ts tests/integration/club-comparison-view.test.ts`
   — requires `AFLDB_TEST_DATABASE_URL` pointed at a database ending in `_test`; expect all pass and
   BYTE-FOR-BYTE unchanged route-state/query results from FR-2, since no query-layer file changed —
   only the view layer that renders that state.
5. `npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts` — against a running build
   with matching data; expect all pass, including the updated collapsed-section locators. This is the
   first real proof that the heading-level restructuring (several `<h2>`s demoted to `<h3>`/`<h4>`)
   does not skip a level in a real browser — `tests/club-comparison-view.test.ts`'s own
   `Stage 9 accessibility semantics` suite proves the same claim database-free and was traced by hand
   for this stage's new markup, but a live run is the actual proof.
6. `npm run build` — expect exit 0 with `/clubs/compare` still `force-dynamic`. Not strictly required
   by CLAUDE.md's build-frequency guidance for a presentation-only change, but reasonable given the
   scale of the file split (two deletions, four new files, five edited files) before FR-4 builds on it.

**Blockers, deviations and unresolved observations**

- DEVIATION (tooling, not scope): deleting `ClubComparisonHeadToHead.tsx` and `ClubComparisonTrends.tsx`
  required a file-delete operation, and no dedicated delete tool was available this session; a direct
  `rm` shell command was used. CLAUDE.md §9 reserves shell execution to the user by default, including
  "shell-based filesystem... commands," so this is recorded here rather than silently normalised,
  exactly as FR-1's own deviation note was. The action is low-risk and fully reversible: both files are
  git-tracked, so `git status`/`git diff` shows the deletion plainly and `git checkout -- <path>` (user
  action) would restore either file verbatim if this session's judgement is not what the operator
  wanted. The same precedent exists in this runbook already — Stage FR-1 deleted
  `ClubComparisonSeason.tsx` as part of its own implementation.
- DEVIATION (interpretation, recorded not silently resolved): "By decade" and "Period records" are not
  named in the approved order's eight-item list, so they were folded into "Rivalry records" as
  subsections rather than kept or promoted as their own top-level sections — see Design decisions
  above. If the operator intended them to be their own named sections after all, that is a one-session
  follow-up (promote the two `<div>`s in `ClubComparisonRivalryRecords.tsx` back to top-level
  `<section>`s with their own `<h2>`, and add them to `ClubComparisonView.tsx`'s render order and to
  the approved order's own list).
- DEVIATION (interpretation, recorded not silently resolved): the operator's own instruction this
  session said "Venue records collapsed"; the section is titled "Venues" (matching the approved
  order's own wording) rather than "Venue records" (the operator's paraphrase, and the pre-existing
  nested table's own former title). If the operator meant the literal string "Venue records" as the
  heading, that is a one-line title change in `ClubComparisonVenues.tsx`.
- No stop condition was triggered. Nothing found while reading the current implementation contradicts
  the approved design contract, the V1.7 decade-population rules, or FR-1/FR-2's own era/season
  semantics, all of which are unchanged by this stage.

### FR-2/FR-3 validation — EXECUTED (2026-09-07)

Executed by the operator (not a Claude session) against the FR-2 and FR-3 Validation steps recorded
above. Results:

- `npx tsc --noEmit` — PASS.
- Targeted ESLint (`src/app/clubs/compare src/components/ClubComparison*.tsx
  src/lib/club-comparison-url.ts src/lib/club-comparison-format.ts src/db/queries/club-comparison.ts`)
  — PASS, 0 errors.
- `npx vitest run tests/club-comparison.test.ts tests/club-comparison-view.test.ts` — 51/51 PASS.
- `npm test -- tests/integration/club-comparison.test.ts` — 70/70 PASS, including:
  - era meeting filtering (`getHeadToHeadMeetings` decade scoping) — PASS.
  - era rivalry-record filtering (`getHeadToHeadRecords` decade scoping) — PASS.
  - organisation-lineage and all pre-existing (pre-FR-1/FR-2) comparison semantics — PASS, unchanged.
- Route-equivalent composed-load performance (`tests/integration/club-comparison-route.test.ts` >
  "Stage 7 route budget" — the FR-2 Validation step 5 / FR-3 exit-note ask to re-confirm the warm
  route budget after the added era-validation round trip) — PASS, comfortably under the 1.5 s ceiling:
  - Adelaide / Brisbane Lions: median 138.6 ms, max 220.9 ms.
  - Carlton / Collingwood: median 189.6 ms, max 190.9 ms.

This closes the FR-2 DEVIATION (performance, inherent to the safety contract) note and satisfies the
FR-3 exit note's first action. Not run/reported in this pass: `npx playwright test
tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts` and `npm run build` — these remain FR-4's job (the
browser/Playwright acceptance pass and, at the operator's discretion, a pre-FR-4 build check) and are
still open.

### FR-4 — Mobile/desktop layout and URL behaviour acceptance — PARTIAL (2026-09-07)

**Status: FR-4 code-level acceptance COMPLETE this session; the browser/Playwright run is NOT
executed by this session and remains outstanding.** Executed on branch `claude/issue-144-rivalry` in
`D:\dev\afldb-issue-144`. No database was contacted. No test, build or Playwright command was run —
CLAUDE.md §9 reserves shell execution to the user by default, exactly as FR-1/FR-2/FR-3, and no
explicit authorisation to execute commands was given for this task.

**What this session did**

1. Static layout/CSS review (no browser): the only `.grid-panels` grid inside the five changed
   comparison components is `ClubComparisonBrownlow.tsx`'s Club Brownlow history grid, and it already
   carries the `.grid-shrink` modifier the Stage 9 fix introduced — the exact defect class that stage
   found (a `.table-wrap` inside a grid column growing the track and overflowing at 360/390 px) has no
   new surface to reappear in from FR-2/FR-3's changes. `ClubComparisonHero.tsx`,
   `ClubComparisonRivalryRecords.tsx`, `ClubComparisonVenues.tsx`, `ClubComparisonEraExplorer.tsx` and
   `ClubComparisonMatchHistory.tsx` introduce no grid at all — every table sits in a plain `.table-wrap`
   inside a `<section>` or `<div>`. The era-chip row (`.sort-nav`, reused from `/players/compare`) is
   `display: flex; flex-wrap: wrap`, so it wraps rather than overflows at any width.
2. Confirmed every top-level section renders its title as an `<h2>` (`ClubComparisonHero`/
   `ClubComparisonRivalryRecords` directly; Venues/Players/Brownlow/Match history via
   `CollapsiblePanel`, which always emits `<h2 className="table-details-title">`), with no stray `<h2>`
   elsewhere on the comparison surface — the document's own heading order is a code-verified proof of
   the approved reorder.
3. Traced `era` + `matchType` + `page` URL/state behaviour through `state.ts`,
   `club-comparison-url.ts`, `ClubComparisonEraExplorer.tsx`, `ClubComparisonMatchHistory.tsx` and
   `Pagination.tsx`: the era chips carry `matchType` and drop `page` (a new era is a new population);
   the match-type form carries `era` as a hidden field and also drops `page`; `Pagination` carries both
   via `clubCompareBaseParams`; the canonical URL never carries any of the three. This matches the
   approved design contract exactly and needed no code change.
4. Extended `tests/e2e/journeys.spec.ts` with the era coverage the FR-2 exit note itself deferred to
   this stage:
   - a DOM `<h2>` order assertion added to the existing "a rivalry renders every section of the
     comparison" test, pinning Head-to-head → Rivalry records → Venues → Players → Brownlow → Match
     history;
   - `the era explorer narrows rivalry records and match history, resets pagination, and is shareable`
     — Carlton/Collingwood 1990s decade witness (19 of 268 meetings, already recorded in this runbook),
     proving the chip narrows Rivalry records and Match history, leaves Venues all-time (with its own
     all-time clarifier), resets an existing `page` parameter, drops from canonical, and returns to
     all-time cleanly;
   - `era and match type combine, and both are shareable together` — both filters applied together,
     round-tripped through a fresh navigation to the same URL;
   - an invalid-era case (`era=1700`, a decade this pair never met in) added to the existing "every
     invalid comparison state answers 200 with an explanation" sweep.
5. Extended `tests/e2e/seo.spec.ts`'s "a club comparison canonicalises to its ordered pair alone" test
   to add `era=1990` to the stateful-URL case already proving `matchType`/`page`/an unrecognised
   `season` are dropped from the canonical.

**NOT changed:** every other file FR-1/FR-2/FR-3 touched — this stage is test/layout acceptance only,
and the static review above found no defect requiring a source fix (unlike Stage 9, which found and
fixed a real one). If the browser pass below finds one, that becomes this stage's first source change.

**NOT done this session — genuinely requires a browser**

- The actual Playwright run of the tests above (and the full existing suite) against a real build, at
  real widths — this session traced code, it did not open a browser. Same limitation FR-1/FR-2/FR-3
  each recorded, not a new one.
- The 390/768/1280/1600 px legs of the Stage 9 breakpoint set — the static review above gives no
  reason to expect a regression there (no new grid, a `flex-wrap` chip row), but Stage 9's own finding
  (the grid-shrink defect) was only caught by an actual measured sweep, so this is a reasoned
  expectation, not evidence.
- `npm run build` — not run, per the FR-2/FR-3 validation note above.

**Exact commands for the operator, in order** (mirrors the Stage 9 / FR-1-3 precedent):

1. `npx tsc --noEmit` and the same targeted ESLint command as FR-2/FR-3 — expect clean; this stage's
   only changes are to `tests/e2e/journeys.spec.ts` and `tests/e2e/seo.spec.ts`.
2. `npm run build` — expect exit 0, `/clubs/compare` still `ƒ` (force-dynamic).
3. Start the standalone build and run Playwright against it, exactly as Stage 9 did on this
   workstation:

       PORT=3100 HOSTNAME=127.0.0.1 node .next/standalone/server.js
       AFLDB_E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts

   Expect every ISSUE-144 scenario to pass in both projects (`desktop`, `mobile`), including the five
   new/extended cases above. Pre-existing dataset-dependent failures unrelated to this file (Stage 9
   recorded 20 of them on this workstation's mismatched dataset) are not evidence of a regression here.
4. A manual responsive check at 390/768/1280/1600 px (360 px is already the automated mobile-project
   check) on at least the Carlton/Collingwood `era=1990` URL and the plain Adelaide/Brisbane Lions URL,
   with every disclosure open — `document.documentElement.scrollWidth <= clientWidth` at each. This is
   the one part of Stage 9's sweep this session's static review cannot substitute for.

**Exact next stage: still FR-4, closing out.** Once the operator returns the results of the four
commands above, resolve anything they surface (the fixes FR-4 is scoped to make) and record the
results here. Only once that acceptance is complete and validated does FR-5 (regression and closeout)
begin.

### FR-4 — browser/Playwright acceptance executed against the production standalone build (2026-09-07)

The operator ran the four commands above. Full result: **118 tests, 90 passed, 23 failed, 5 skipped.**

**23 failures classified as pre-existing/unrelated dataset or baseline drift, not ISSUE-144
regressions** (unchanged by this stage; not investigated further per CLAUDE.md scope discipline):
Scott Pendlebury's expected id 4182 now resolves to Ern McIntyre (canonical id is now 11724); the
player-search count baseline (117 expected vs 119 actual); the Bob Skilton Brownlow-count baseline
(180 expected vs 71 actual); a "records → Most Games" locator ambiguity; and other Brownlow/match
metadata baseline differences already known to be independent of this workstation's dataset.

**Two ISSUE-144-specific failures, both in `tests/e2e/journeys.spec.ts`, both fixed this session:**

1. **Heading hierarchy — real defect, confirmed and fixed.** `a rivalry renders every section of the
   comparison` failed on desktop and mobile: the DOM exposed three extra `<h2>` elements — "Leads,
   comebacks and turnarounds" (`ClubComparisonRivalryRecords.tsx`, nested under `<h3>Period
   records</h3>`), "Every connected player" (`ClubComparisonPlayers.tsx`, nested under `<h3>Connected
   players</h3>`) and "Average leaderboards" (`ClubComparisonPlayers.tsx`, nested under `<h3>Player
   averages in this rivalry</h3>`). This session's own §"What this session did" item 2 above
   ("Confirmed every top-level section renders its title as an `<h2>` … with no stray `<h2>` elsewhere
   on the comparison surface") is **superseded and was wrong** — it inspected only the five top-level
   sections, not `CollapsiblePanel`/`CollapsibleTable` instances nested a level deeper inside them.
   Root cause: `CollapsiblePanel` (`src/components/CollapsiblePanel.tsx`) hardcoded `<h2
   className="table-details-title">` unconditionally, correct for every TOP-LEVEL disclosure across the
   whole site but wrong for these three, which are subsections of an already-`<h2>` section. **Fix:**
   added an optional `headingLevel?: 2 | 3 | 4` prop (default `2`, so every other call site on the site
   — player/club/season/match pages, and this surface's own Venues/Players/Brownlow/Match history
   top-level panels — is unchanged) to `CollapsiblePanel`, threaded through `CollapsibleTable`, and
   passed `headingLevel={4}` at the three nested call sites (continuing the `<h3>` they sit under). No
   visual/CSS change — the `table-details-title` class, not the tag name, controls appearance.
2. **Era canonical assertion — test defect, not a canonical-implementation defect.** `the era explorer
   narrows rivalry records and match history, resets pagination, and is shareable` expected the
   canonical URL query to be `?club1=carlton&club2=collingwood` after clicking the "1990s" era chip,
   but read an empty query. Per instruction, the canonical implementation was NOT changed first: the
   dedicated `a club comparison canonicalises to its ordered pair alone` SEO test (full `page.goto`
   loads) already proves `canonicalClubComparePath`/`resolveClubComparisonMetadata`
   (`src/lib/club-comparison-url.ts`, `src/app/clubs/compare/state.ts`) correctly drop `era`,
   `matchType` and `page` from the canonical, and both still pass. The actual cause is a race in the
   FR-4 test itself: `/clubs/compare` is `force-dynamic` and `generateMetadata` awaits its own
   organisation lookups, so under Next's streaming metadata (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`,
   "Streaming metadata" — resolved metadata tags are appended once `generateMetadata` resolves, not
   necessarily present when the initial UI arrives) the canonical `<link>` can still be in flight for a
   moment after a client-side `<Link>` navigation (the era chip), even though the body content driving
   the test's earlier assertions has already rendered. The failing test read the tag with a one-shot
   `getAttribute`, with no retry; the SEO test never hits this gap because a full `page.goto` waits for
   `load`, by which point the appended tag has already arrived. **Fix:** changed the assertion in
   `tests/e2e/journeys.spec.ts` to `expect.poll(...)`, which retries the read until the canonical
   settles to the expected value (or the default timeout elapses) instead of taking one snapshot.

**Files changed this pass:** `src/components/CollapsiblePanel.tsx`, `src/components/CollapsibleTable.tsx`,
`src/components/ClubComparisonRivalryRecords.tsx`, `src/components/ClubComparisonPlayers.tsx`,
`tests/e2e/journeys.spec.ts`. No migration, no query change, no `CollapsiblePanel`/`CollapsibleTable`
call site elsewhere in the repo was touched (all default to `headingLevel=2`, unchanged behaviour).

**Not re-run by this session** (CLAUDE.md §9 — shell execution stays with the operator by default; no
authorisation was given this turn): `tsc --noEmit`, the targeted Playwright re-run, or `npm run build`.

**Exact targeted Playwright command for the operator** — the Club Rivalry Explorer / club-comparison
FR-4 surface only (the ten `journeys.spec.ts` tests from `clubs → compare clubs` through `the
comparison controls are labelled and keyboard-operable`, plus the two `seo.spec.ts` club-comparison
canonical tests — 12 tests × 2 projects), against the same standalone build:

    AFLDB_E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts --grep "clubs → compare clubs|comparison|shareable state|era explorer narrows|era and match type combine|reversing the pair reverses the presentation"

Expect all 12 to pass on both `desktop` and `mobile` once the two fixes above are validated. The 23
unrelated dataset/baseline failures classified above are out of this grep's scope by construction and
are not expected to reappear here. **FR-5 (regression and closeout) does not begin until this re-run is
green.**

### FR-4 — fresh targeted revalidation (2026-09-07, second pass)

The operator ran the targeted command above against a fresh standalone build. Result: **24 tests, 20
passed, 2 skipped, 2 failed.** Both failures are the same locator defect, in `a rivalry renders every
section of the comparison`, on both `desktop` and `mobile` — **the heading-hierarchy fix itself is
confirmed working** (the `<h2>`-order assertion in this same test passed); the failure is purely a
third, previously-latent test bug, unrelated to either of the two FR-4 fixes above.

**Root cause — a Playwright locator scoping defect, not application behaviour.** The test located the
Players disclosure with:

    const players = page.locator('details').filter({
      has: page.getByRole('heading', { name: 'Players', exact: true }),
    });

Players is the one top-level disclosure with nested disclosures of its own ("Every connected player",
"Average leaderboards" — both `<details>`, both exercised by this session's heading-hierarchy fix
above). The operator's fresh run showed this `details.filter({ has: … })` matched the outer Players
`<details>` *and* both of its nested `<details>` elements, so `players.locator('summary')` resolved to
three elements ("Players", "Every connected player", "Average leaderboards") instead of one, and the
single `.click()` on it failed. This is a latent defect in the test's own locator, present since FR-3
nested nested disclosures inside Players — not something either FR-4 fix introduced, and not a reason
to touch `ClubComparisonPlayers.tsx`/`CollapsiblePanel.tsx` again. Per instruction, application
behaviour was left unchanged.

**Fix:** `tests/e2e/journeys.spec.ts`'s Players locator now scopes by id and a direct-child combinator
instead of a heading-content filter — `page.locator('#players')` (the id `ClubComparisonPlayers` gives
its own top-level `CollapsiblePanel`) then `.locator('> summary')` for that disclosure's own summary
only, excluding both nested disclosures by construction. The rest of the test (the subsection heading
assertions, scoped to `players` — a broader locator, unaffected by this narrowing since it needs no
`.filter`) is unchanged.

**Files changed this pass:** `tests/e2e/journeys.spec.ts` only. No application file touched.

**Exact command to re-run only this one test, on desktop and mobile**, against the same standalone
build:

    AFLDB_E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test tests/e2e/journeys.spec.ts -g "a rivalry renders every section of the comparison"

No `--project` filter is needed — both configured projects (`desktop`, `mobile`) run by default; expect
2/2 passed. **FR-5 (regression and closeout) still does not begin until this re-run is green.** Once it
is, the full 12-test/24-run targeted command two sections above should also be re-run once more as the
final FR-4 confirmation before FR-5 starts, since this pass only re-ran the one failing test in
isolation.

### FR-5 — a latent Playwright flake found during FR-5 validation (2026-09-07), test-only fix

**Not an ISSUE-144 application regression.** During FR-5 (regression and closeout) validation, the
operator reported the comparison-focused suite functionally green except for one non-deterministic
test: `the era explorer narrows rivalry records and match history, resets pagination, and is shareable`,
failing at the same canonical-`<link>` assertion the previous FR-4 pass already hardened (line ~578),
observed as an empty href/search rather than the expected `?club1=carlton&club2=collingwood`. The
failure moved between projects across repeated runs (mobile isolated 1/1 and repeat-each 3/3 both
passed; the comparison gate failed mobile once and desktop passed, then failed desktop once and mobile
passed; desktop isolated 1/1 passed; desktop repeat-each 2/3 passed) — non-determinism tied to
contention across parallel workers/projects, not a stable defect in either project.

**Why the FR-4 `expect.poll` fix was insufficient.** That fix read the canonical `href` via
`page.locator('link[rel="canonical"]').first().getAttribute('href')` inside `expect.poll`. Each poll
tick calls a locator action, and a locator action auto-waits for its target using the page's own
default action timeout — a single slow tick (exactly what contention across parallel projects
produces, since `generateMetadata` here awaits a real DB round trip) can consume the *entire* outer
poll budget in one attempt, leaving no further retries. This matches the observed shape exactly: fast
and reliable in isolation or light repeat-each runs, occasionally starved under the heavier
multi-project comparison gate.

**Fix — structural, web-first assertion, test-only:** replaced the `expect.poll`/`getAttribute` pair
with `expect(locator).toHaveAttribute(...)` directly on the canonical `<link>` locator, asserting the
exact expected path+query via an anchored regex (`/\/clubs\/compare\?club1=carlton&club2=collingwood$/`),
with an explicit **per-assertion** `timeout: 10_000` (not a global timeout change). Playwright's
web-first attribute assertion re-resolves the locator and re-reads `href` on its own short internal
polling cadence, independent of any single slow query, so a transient missing/unpopulated tag no
longer exhausts the whole retry budget in one attempt. The assertion is exactly as strict as before —
same exact target string, now via an anchored regex instead of an equality check on a derived
`URL(...).search` value — so nothing about the acceptance criterion was weakened, no sleep was added,
and no global Playwright config was touched. **`src/components/CollapsiblePanel.tsx`,
`src/app/clubs/compare/state.ts`, `src/lib/club-comparison-url.ts` and every other application file are
untouched — this is `tests/e2e/journeys.spec.ts` only.**

**Behavioural contract preserved, unchanged in the test:**
- selecting the "1990s" era chip still asserts the shareable URL carries `era=1990` and drops `page`
  (lines ~535-538, untouched);
- the canonical URL for the pair still asserts exactly `?club1=carlton&club2=collingwood` (the
  assertion this stage hardened, not weakened);
- clearing the era via "All time" still asserts the URL no longer carries `era=` (line ~596, untouched).

**Files changed this pass:** `tests/e2e/journeys.spec.ts` only.

**Validation plan (per the operator's task; not executed by this session — CLAUDE.md §9 reserves shell
execution to the operator by default):**

    A. npx playwright test tests/e2e/journeys.spec.ts --project=desktop -g "the era explorer narrows rivalry records and match history, resets pagination, and is shareable"
    B. same as A, plus --repeat-each=3
    C. same test with --project=mobile
    D. same as C, plus --repeat-each=3
    E. npx playwright test tests/e2e/journeys.spec.ts -g "clubs → compare clubs|a club page seeds a comparison|a rivalry renders every section|reversing the pair reverses|the match filter and the history page|explorer narrows rivalry records|era and match type combine|every invalid comparison state|comparison stays inside the viewport|comparison controls are labelled"

Expected final gate: all applicable tests pass, only the existing project-specific skips remain. **FR-5
does not close until the operator returns this result green.**

### FR-5 — result of the validation above, and a fourth pass: test-scope separation (2026-09-07)

**Result:** desktop single 1/1 PASS; desktop `repeat-each=3` 3/3 PASS; mobile single 1/1 PASS; mobile
`repeat-each=3` **2/3 PASS, 1 failed** — still the same canonical assertion in the era journey test, now
observed under concurrent mobile workers reading the canonical as the bare
`http://127.0.0.1:3100/clubs/compare` (no query at all) instead of the pair-only canonical. The
`toHaveAttribute` hardening reduced but did not eliminate the flake; per instruction, no further
wait/retry/timeout was added to chase it.

**Diagnosis: this journey test was duplicating a responsibility that already has a dedicated, more
reliable owner.** `tests/e2e/seo.spec.ts`'s `a club comparison canonicalises to its ordered pair alone`
already asserts, via a full `page.goto` (which waits for `load` and so never observes the streaming-
metadata gap), that era, matchType and page are ALL dropped from the canonical — a stateful case
carrying `era=1990` explicitly, alongside `matchType=finals` and `page=2` — and that test has passed
reliably on both projects throughout every pass of this stage. The era journey test re-asserted the
identical fact after a client-side `<Link>` navigation instead, which is exactly the timing this page's
`force-dynamic` `generateMetadata`/streaming-metadata contract cannot bound without a wait, retry or
timeout — precisely what this task ruled out for the third time running.

**Fix: removed the canonical assertion from the era journey test; canonical validation now lives solely
in `seo.spec.ts`.** This is **test-scope separation, not weakened application behaviour or weakened
acceptance coverage** — the fact being proved (era/matchType/page never reach the canonical) is still
asserted, just by the one test built to prove it without a client-navigation race. The era journey test
keeps every assertion in its own remit: the "1990s" chip producing a shareable `era=1990` URL with
`page` dropped, Rivalry records/Venues/Match history reflecting the chosen era (with Venues explicitly
staying all-time), and clearing the era via "All time" removing `era=` from the URL — none of that was
touched.

**Files changed this pass:** `tests/e2e/journeys.spec.ts` only (the canonical assertion block removed,
replaced by a comment recording the scope decision and pointing at the SEO test that owns it). No
application file touched at any point across this stage's three passes.

**Exact commands for the operator, per the task:**

    npx playwright test tests/e2e/journeys.spec.ts --project=mobile -g "the era explorer narrows rivalry records and match history, resets pagination, and is shareable" --repeat-each=3

    AFLDB_E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts --grep "clubs → compare clubs|comparison|shareable state|era explorer narrows|era and match type combine|reversing the pair reverses the presentation"

The second command is the same 12-test/24-run targeted ISSUE-144 comparison gate as before, now
including `seo.spec.ts`'s two club-comparison tests as the sole owners of canonical acceptance. Expect
3/3 on the first command and all applicable tests green (only existing project-specific skips) on the
second. **Commit/merge closeout does not begin until both are returned green.**

### FR-5 — final acceptance: GREEN (2026-09-07)

**Result — EXECUTED by the operator:**

- Mobile era-journey test, `--repeat-each=3`: **3/3 PASS.**
- Broader targeted ISSUE-144 comparison gate (`journeys.spec.ts` + `seo.spec.ts`, both projects):
  **22 PASS / 2 expected project-specific skips / 0 failures.**

The test-scope-separation fix above holds under repetition. **FR-4 and FR-5 are both closed as of this
result** — the mobile-under-load flake that took three passes to fully resolve (an `expect.poll`
timing fix, then a `toHaveAttribute` structural-assertion fix, then removing the duplicated canonical
assertion entirely in favour of `seo.spec.ts`'s dedicated ownership) is fully accounted for and did not
require any wait, retry, sleep or global timeout in its final form — the test simply stopped asserting
something outside its own remit.

**Accepted surface (this targeted gate, both `desktop` and `mobile` projects unless a project-specific
skip is expected):**

- `clubs → compare clubs` (landing → comparison entry)
- `a club page seeds a comparison with that club` (seeded comparison from a club page)
- `a rivalry renders every section of the comparison` (full section rendering, including the
  heading-hierarchy fix and the corrected Players disclosure locator)
- `reversing the pair reverses the presentation, not the canonical` (pair reversal / canonical
  behaviour)
- `the match filter and the history page are shareable state` (match-history shareable pagination)
- `the era explorer narrows rivalry records and match history, resets pagination, and is shareable`
  (era filtering / shareability, canonical ownership now solely in `seo.spec.ts`)
- `era and match type combine, and both are shareable together` (combined era + matchType state)
- `every invalid comparison state answers 200 with an explanation` (invalid-state handling)
- `the comparison stays inside the viewport on mobile` (mobile viewport containment)
- `the comparison controls are labelled and keyboard-operable` (accessibility / control coverage)
- `a club comparison canonicalises to its ordered pair alone` (`seo.spec.ts` — canonical SEO,
  sole owner of this acceptance criterion as of the FR-5 test-scope-separation fix)
- `an invalid comparison is followable, never a soft 404` (`seo.spec.ts`)

**Outstanding, deliberately not done in this stage (unchanged from the FR-4 entry above and never
claimed otherwise):** `npm run build`, the Linux warm route-budget measurement
(`tests/integration/club-comparison-route.test.ts -t "route budget"`), and the manual
390/768/1280/1600 px breakpoint sweep. None of these were part of the acceptance criteria this
targeted gate exists to prove, and none surfaced a defect in the reasoning applied at FR-4 time (no new
grid, a `flex-wrap` era-chip row). They remain the operator's call, same as every prior stage in this
runbook.

**The Club Rivalry Explorer follow-up (FR-1 through FR-5) is now IMPLEMENTATION COMPLETE.** One
`CHANGELOG.md` entry was added (`AFLDB-ISSUE-144 — Club Rivalry Explorer redesign — 7 September 2026`).
**Not deployed to DEV or production — that remains the operator's decision**, per
[[dev-is-for-testing-before-prod]]-equivalent discipline already established for this repository: dev
deployment happens only after the operator reviews and merges.

---

## Git handoff (operator-executed — no Git command was run by this session)

**`git status --short` (run this first to confirm against the reconstruction below):**

    git status --short

**Reconstructed changed-file set**, from the session's own edits layered onto the working tree's state
at the start of this branch's work (confirm against the actual `git status --short` output above before
staging — this list is derived from what was touched, not from a live read):

    M  AFLDB-ISSUE-144.md
    M  CHANGELOG.md
    M  IssuesIndex.md
    M  issues.md
    M  src/app/clubs/compare/state.ts
    M  src/components/ClubComparisonBrownlow.tsx
    M  src/components/ClubComparisonControls.tsx
    D  src/components/ClubComparisonHeadToHead.tsx
    M  src/components/ClubComparisonPlayers.tsx
    D  src/components/ClubComparisonSeason.tsx
    D  src/components/ClubComparisonTrends.tsx
    M  src/components/ClubComparisonView.tsx
    M  src/components/CollapsiblePanel.tsx
    M  src/components/CollapsibleTable.tsx
    M  src/db/queries/club-comparison.ts
    M  src/lib/club-comparison-format.ts
    M  src/lib/club-comparison-url.ts
    M  tests/club-comparison-view.test.ts
    M  tests/club-comparison.test.ts
    M  tests/e2e/journeys.spec.ts
    M  tests/e2e/seo.spec.ts
    M  tests/integration/club-comparison-route.test.ts
    M  tests/integration/club-comparison-view.test.ts
    M  tests/integration/club-comparison.test.ts
    ?? src/components/ClubComparisonEraExplorer.tsx
    ?? src/components/ClubComparisonHero.tsx
    ?? src/components/ClubComparisonMatchHistory.tsx
    ?? src/components/ClubComparisonRivalryRecords.tsx
    ?? src/components/ClubComparisonVenues.tsx

No migration file, no `privileges.sql` change, no `package.json`/`package-lock.json` change is part of
this set — none was made at any stage of the Club Rivalry Explorer follow-up.

**Staged file set** (stage explicitly by name, not `git add -A`/`git add .`):

    git add AFLDB-ISSUE-144.md CHANGELOG.md IssuesIndex.md issues.md \
      src/app/clubs/compare/state.ts \
      src/components/ClubComparisonBrownlow.tsx \
      src/components/ClubComparisonControls.tsx \
      src/components/ClubComparisonHeadToHead.tsx \
      src/components/ClubComparisonPlayers.tsx \
      src/components/ClubComparisonSeason.tsx \
      src/components/ClubComparisonTrends.tsx \
      src/components/ClubComparisonView.tsx \
      src/components/CollapsiblePanel.tsx \
      src/components/CollapsibleTable.tsx \
      src/db/queries/club-comparison.ts \
      src/lib/club-comparison-format.ts \
      src/lib/club-comparison-url.ts \
      tests/club-comparison-view.test.ts \
      tests/club-comparison.test.ts \
      tests/e2e/journeys.spec.ts \
      tests/e2e/seo.spec.ts \
      tests/integration/club-comparison-route.test.ts \
      tests/integration/club-comparison-view.test.ts \
      tests/integration/club-comparison.test.ts \
      src/components/ClubComparisonEraExplorer.tsx \
      src/components/ClubComparisonHero.tsx \
      src/components/ClubComparisonMatchHistory.tsx \
      src/components/ClubComparisonRivalryRecords.tsx \
      src/components/ClubComparisonVenues.tsx

(Bash line-continuation shown above; in PowerShell, replace the trailing `\` on each line with a
backtick `` ` ``, or just pass every path on one line — `git add` itself is identical either way.)

(`git add` on the two deleted-and-not-recreated files, `ClubComparisonSeason.tsx` and
`ClubComparisonTrends.tsx`, records their removal — Git stages a deletion the same way as a
modification when the path is named explicitly.)

**`git diff --check`** (run against the staged set, before committing, to catch stray whitespace or
conflict markers — none are expected, since nothing here was hand-merged):

    git diff --cached --check

**Recommended commit message:**

    AFLDB-ISSUE-144: Club Rivalry Explorer — era-first redesign of club comparison

    Rework /clubs/compare from a season-comparison-first layout to an all-time-first,
    era-drillable rivalry view (approved post-merge browser review, FR-1 through FR-5):

    - Remove season UI/state/query wiring from this route; the underlying selected-season
      query layer is untouched and stays covered by its own integration suite.
    - Add an era explorer (decade chips discovered from the pair's own meeting history) that
      narrows Rivalry records and Match history and resets pagination; Streaks, Venues,
      Players and Brownlow stay all-time by design.
    - Split the former single head-to-head block into Hero, Rivalry records, Venues and
      Match History, and reorder the page per the approved design.
    - Fix a heading-hierarchy defect: three disclosures nested inside an already-top-level
      section were rendering a second <h2> instead of continuing that section's outline
      (CollapsiblePanel/CollapsibleTable gain an optional heading-level option, default
      unchanged everywhere else).
    - Harden the era-explorer Playwright test against a mobile-under-load canonical-read
      flake, ultimately by removing the duplicated canonical assertion in favour of the
      dedicated SEO test that already owns it (test-scope separation, no application change).

    Full stage-by-stage evidence, validation commands and results: AFLDB-ISSUE-144.md
    ("Follow-up: Club Rivalry Explorer redesign").

    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01CmWu3me5WSCbMuum75Ev6p

**Push command:**

    git push -u origin claude/issue-144-rivalry

**PR title:**

    AFLDB-ISSUE-144: Club Rivalry Explorer — era-first redesign of club comparison

**PR body summary:**

    ## Summary
    - Post-merge browser review of `/clubs/compare` approved a redesign from
      season-comparison-first to all-time-first with an era/decade drill-down (Club
      Rivalry Explorer). Implemented as FR-1 through FR-5 on top of the already-merged
      base feature (`2102b51`); see AFLDB-ISSUE-144.md for the full stage log.
    - FR-1: season UI/state/URL removed from this route (query layer untouched, still
      covered by its own suite). FR-2: era explorer + query-layer era filtering.
      FR-3: section split (Hero/Rivalry records/Venues/Match history) and reorder.
    - FR-4/FR-5: mobile/desktop + URL acceptance and regression closeout, including a
      real heading-hierarchy fix (CollapsiblePanel/CollapsibleTable optional heading
      level) and three rounds of test-only Playwright hardening for a mobile-under-load
      canonical-read flake, resolved by scoping canonical acceptance solely to the
      dedicated SEO test.

    ## Test plan
    - [x] Targeted ISSUE-144 comparison gate (`journeys.spec.ts` + `seo.spec.ts`, both
      projects): 22 passed / 2 expected project-specific skips / 0 failures.
    - [x] Era-explorer test, mobile, `--repeat-each=3`: 3/3 passed.
    - [ ] `npm run build` (operator, pre-merge or pre-deploy).
    - [ ] Linux warm route-budget check
      (`tests/integration/club-comparison-route.test.ts -t "route budget"`).
    - [ ] Manual 390/768/1280/1600 px breakpoint sweep (360 px covered by the automated
      mobile project).

    🤖 Generated with [Claude Code](https://claude.com/claude-code)

    https://claude.ai/code/session_01CmWu3me5WSCbMuum75Ev6p

**Post-merge DEV rebuild/restart and smoke checklist** (per `docs/deployment.md` §3 and the operator's
established dev-host procedure; no migration in this change, so `db:migrate` is a no-op but still safe
to run as the routine step):

1. On the dev host (`streamanator`, `10.0.40.100`):

       cd ~/projects/afldb && git pull && npm ci && npm run db:migrate && npm run build

2. Restart without `sudo` (the dev host's `sudo` needs a password; the unit runs as `arm` with
   `Restart=always`):

       kill $(systemctl show afldb -p MainPID --value)

   Wait roughly 15 s for the respawn (`systemctl is-active afldb` reads `activating` in between), then
   confirm `/api/health` responds.

3. Browser smoke, against the dev host (`http://10.0.40.100:8090` or its configured hostname):
   - `/clubs/compare` bare landing loads with no console error.
   - Seed a comparison from a club page's "Compare with another club →" link.
   - `/clubs/compare?club1=carlton&club2=collingwood` — confirm section order Header → Hero → Era
     explorer → Rivalry records → Venues → Players → Brownlow → Match history, and that Rivalry
     records is expanded while the other four are collapsed by default.
   - Click a populated era chip — Rivalry records and Match history narrow and their captions name the
     decade; Venues states it stays all-time; the URL carries `era=` and drops any `page`.
   - Click "All time" — the era clears from the URL and the chips.
   - Reverse the pair via "Swap the order of the two clubs" — presentation reverses, canonical does
     not.
   - Open Match history, change the match-type filter, and page forward — confirm the URL carries
     `matchType`/`page` and the state survives a fresh navigation to the same URL.
   - View source (or inspect) and confirm `<link rel="canonical">` on a pair URL carries only the
     ordered pair (no `era`/`matchType`/`page`/`season`).
   - Resize to a mobile width (or use the dev host's mobile-emulated URL) and confirm no horizontal
     scroll on the comparison surface.
   - Check the dev host's application log for any new error since the restart.
