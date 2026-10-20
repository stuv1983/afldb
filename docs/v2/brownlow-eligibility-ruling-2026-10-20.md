# Brownlow 2025: the 12 eligibility disagreements — evidence and proposed rulings (2026-10-20)

Status: **PROPOSAL for owner ruling. Nothing was recorded against production or any shared database.**
The sandbox demonstration below ran on a disposable clone, is labelled as such, and is excluded from
every migration-preservation comparison. Part of V2-GAP-016 ([known-gaps](known-gaps.md)).

## 1. What the provider field means, and what "stored eligible" means

- **Provider.** `eligible` is an explicit boolean on every record of the retained authentic snapshot
  (`afl-api-brownlow-2025-2026-10-20-014218`): vote flags 597 true / 24 false, `players[]` 176 / 12,
  leaderboard 176 / 12. It is never absent or null. `emitAflApiBrownlowMatchVotes/Leaderboard`
  (`src/lib/acquisition/afl-api-bundle.ts`) carries it through as `eligible === true`, so any non-`true`
  value reads as ineligible; here it was always a literal `false` for the same 12 players in all three
  places.
- **Stored.** `brownlow_season_votes.is_ineligible` is `boolean NOT NULL DEFAULT false`. Across every
  season only **3** rows are `true` (1996 p3063, 1997 p2763, 2012 p7273); for 2025 `eligible_rank` equals
  `vote_rank` for all 188 players. So a stored `false` for these 12 is the **column default, not a
  recorded eligibility finding**: the archive never evaluated eligibility for the API era.
- **Consequence.** "Stored eligible" cannot be offered as counter-evidence. This review directly read
  every originally cited article, then read outcome/served-ban follow-ups. Initial charges alone do
  not establish the final sanction. The earlier blanket HIGH-confidence table is superseded below.
- **Applicable rule:** [2025 AFL Regulations, effective 28 February 2025](https://resources.afl.com.au/afl/document/2025/10/17/fd5ec52f-3343-48ce-a2e6-04644f027cbc/AFL-Regulations-effective-28-February-2025-Final-.pdf),
  regulations 21.2(c), 21.3–21.5, printed pages 90–91. A guilty finding for a reportable offence in a
  home-and-away match carrying Brownlow votes makes that player ineligible **in that season**;
  financial-sanction-only outcomes are excepted. Votes are still awarded. The offence season, rather
  than the season in which the suspension is served, controls this rule. No finals/pre-season,
  club-imposed or conduct-unbecoming ban is automatically treated as a qualifying offence.
- The unchanged winner is **not** used as evidence: the winner (Matt Rowell, p9235, 39 votes) is
  unaffected whichever way the 12 are ruled.

## 2. Proposed correction table

All rows concern **2025**. Numeric IDs are archive-local lookup aids; execution must re-resolve the
durable identity and refuse ambiguity. Proposed ledger basis is `audited_correction` because 2025 is
sealed. All provider flags are explicitly false; all stored flags are unevaluated defaults. These are
proposals, not recorded rulings. Review date: 2026-10-20.

The twelve archive IDs were re-checked read-only through `resolvePlayerIdentity` on the dedicated
marked isolated copy: **12/12** resolve exactly to the durable strings below. This confirms the archive
mapping, not current production IDs; the guarded runner re-checks identities at execution.

| Player / archive ID / votes | Durable identity | Final outcome and appeal evidence read directly | Rule application / proposed ruling |
|---|---|---|---|
| Toby Greene / 12446 / 14 | `afltables:players/T/Toby_Greene.html` | R20 striking Isaac Heeney, one match: [MRO 1373677](https://www.afl.com.au/news/1373677). The later [2025 count report 1427225](https://www.afl.com.au/news/1427225) expressly calls Greene ineligible through suspension, establishing the final Brownlow status. | **Ineligible**; directly confirmed at the count. |
| Tristan Xerri / 12869 / 7 | `afltables:players/T/Tristan_Xerri.html` | R18 striking Tom Sparrow, three matches: [initial challenge 1365693](https://www.afl.com.au/news/1365693); [Tribunal outcome 1365899](https://www.afl.com.au/news/1365899) upholds three matches and rejects the downgrade. | **Ineligible**; qualifying reportable offence, suspension upheld. |
| Zac Bailey / 13246 / 6 | `afltables:players/Z/Zac_Bailey.html` | R18 rough conduct against Nick Haynes, one match: [MRO 1361425](https://www.afl.com.au/news/1361425); [Tribunal outcome 1365899](https://www.afl.com.au/news/1365899) rejects the attempted reduction to low impact/a fine. | **Ineligible**; financial-only exception does not apply. |
| Rory Laird / 11386 / 5 | `afltables:players/R/Rory_Laird.html` | R22 rough conduct against Jamie Cripps, one match: [initial challenge 1388030](https://www.afl.com.au/news/1388030); [Tribunal 1388249](https://www.afl.com.au/news/1388249/the-verdict-is-in-essendon-bombers-veteran-dylan-shiel-learns-his-fate-at-tribunal) rejects it. [R24 follow-up](https://www.afl.com.au/news/1396186/medical-room-the-full-afl-injury-list-r24/amp) confirms return from that suspension. | **Ineligible**; the later R24 fine does not undo the R22 suspension. |
| Sam Durham / 11625 / 4 | `afltables:players/S/Sam_Durham.html` | R13 forceful front-on contact against Adam Cerra, two matches offered: [1339570](https://www.afl.com.au/news/1339570). [R14 follow-up 1339726](https://www.afl.com.au/news/1339726/medical-room-the-full-afl-injury-list-r14/amp) lists suspension/return R17; [R17 follow-up 1354977](https://www.afl.com.au/news/1354977/medical-room-the-full-afl-injury-list-r17) confirms return from suspension. No overturn is evidenced; the actual absence corroborates the sanction. | **Ineligible**; subsequent reports establish a served suspension, not merely an offered charge. |
| Dan Houston / 3191 / 3 | `afltables:players/D/Dan_Houston.html` | R4 rough conduct against Lachie Fogarty, two matches: [1292232](https://www.afl.com.au/news/1292232). [R7 follow-up 1305410](https://www.afl.com.au/news/1305410/medical-room-the-full-afl-injury-list-r7/amp) confirms he served the two-game suspension. | **Ineligible** for the 2025 offence; no reliance on the separate 2024 ban carried over. |
| Dylan Shiel / 4006 / 3 | `afltables:players/D/Dylan_Shiel.html` | R22 shove of Mark O'Connor causing Luamon Lual's fall: [referral 1383983](https://www.afl.com.au/news/1383983) proposed one match; [Tribunal 1388249](https://www.afl.com.au/news/1388249/the-verdict-is-in-essendon-bombers-veteran-dylan-shiel-learns-his-fate-at-tribunal) imposes one match for rough conduct. [R24 follow-up](https://www.afl.com.au/news/1396186/medical-room-the-full-afl-injury-list-r24/amp) confirms availability after suspension. | **Ineligible**; the Tribunal rejected the defence that injury to a teammate fell outside the rule. |
| Patrick Voss / 10252 / 3 | `afltables:players/P/Patrick_Voss.html` | R5 striking Nick Vlastuin, three matches: [initial challenge 1300207](https://www.afl.com.au/news/1300207); [Tribunal 1300516](https://www.afl.com.au/news/1300516) rejects reducing severe impact to high and leaves all three matches in place. | **Ineligible**; qualifying suspension upheld. |
| Liam Baker / 8798 / 2 | `afltables:players/L/Liam_Baker.html` | R24 rough conduct against Chad Warner, one match: [challenge 1401221](https://www.afl.com.au/news/1401221); [Tribunal 1403587](https://www.afl.com.au/news/1403587) rejects the impact downgrade. Ban to be served in 2026. | **Ineligible in 2025** under 21.2(c), because the offence occurred in the 2025 H&A match. This does not transfer any 2026 ownership. |
| Ollie Wines / 10130 / 2 | `afltables:players/O/Ollie_Wines.html` | R23 rough conduct against Cooper Lord, three matches: [1393572](https://www.afl.com.au/news/1393572); [Tribunal 1396382](https://www.afl.com.au/news/1396382/the-verdict-is-in-suns-young-gun-learns-his-fate-at-tribunal) rejects reducing severe impact to high and upholds three matches. | **Ineligible** for the 2025 offence, regardless of carry-over service. |
| Shannon Neale / 11831 / 2 | `afltables:players/S/Shannon_Neale.html` | R23 rough conduct/high bump against Jake Lloyd, one match offered: [1396161](https://www.afl.com.au/news/1396161/match-review-big-geelong-cat-shannon-neale-banned-for-high-bump). The later [Scott follow-up 1398164](https://www.afl.com.au/news/1398164/geelong-cats-coach-chris-scott-left-doubly-surprised-by-tribunals-bump-call), read directly, confirms the Cats did **not** appeal and Neale would miss Richmond. Davies' separate successful downgrade did not change Neale's sanction. | **Ineligible**; qualifying one-match suspension stood without an appeal. |
| James Peatling / 6737 / 1 | `afltables:players/J/James_Peatling.html` | R5 rough conduct/dangerous tackle against Oisin Mullin, one match: [1297048](https://www.afl.com.au/news/1297048). [R7 follow-up 1305410](https://www.afl.com.au/news/1305410/medical-room-the-full-afl-injury-list-r7/amp) confirms he served one match. | **Ineligible**; subsequent service confirms the sanction. |

All twelve proposed ineligible rulings are supported. No case remains unsupported in the final table.
Neale's initially unresolved acceptance is established by the added Scott follow-up. Tribunal reports establish
the outcomes they report; no unsupported assertion that every possible further appeal was exhaustively
searched is made. Served-ban/count reports are stronger final-status evidence where available. No
third-party tracker is used as authority. The old twelve-ruling sandbox remains historical evidence
of service mechanics, **not approval**; Neale's final sanction rests on the newly read follow-up.

## 3. Proposed effect (sandbox, clone `afldb_v2_rb_gap023_test`, NOT migration-preservation evidence)

The proposed rulings were recorded through the production service
`recordBrownlowEligibilityDecision` (Super Admin capability `data.brownlow.finalise`; synthetic
`@example.invalid` admin; real season registry, so 2025 is sealed and every row was `audited_correction`;
publication in the same transaction):

- 12/12 decisions accepted; none refused.
- Stored effect on the 12: `is_ineligible` false to true, `eligible_rank` N to NULL (competition
  ranking; the ineligible are unranked). Winner unchanged: p9235, 39 votes, `eligible_rank` 1.
- Reconciliation (same clone, real data): **before** `discrepancies` with 12
  `eligibility_flag_inconsistent` plus 12 `eligibility_rule_unrecorded`; **after** the decisions
  `reconciled` with 0 discrepancies; only the 12 `eligibility_rule_unrecorded` refusals remain under the
  default rule. Selecting the `stored_eligible_rank_one` rule then gives status `determined`, leader
  p9235 (39), provider leaderboard winner = stored winner, and no findings.

## 4. What remains an owner decision

1. **Rule on the 12** as tabulated (or any subset). Each is a separate ledger row; superseding is
   possible later. Production recording needs the Super Admin and the real citations.
2. **Season eligibility rule for API-era seasons** (V2-GAP-016): recording decisions does not by itself
   change the default `unrecorded` rule, which still refuses to state a leader while any ineligible
   player polled votes. The owner must select a rule (`stored_eligible_rank_one` is the one implemented).
3. Rulings for any **other** season are out of scope; the 3 historical `true` rows are untouched.

## 4a. Precise proposed API-era policy — separate policy approval

Approve policy **BP-2025-ELIGIBILITY-v1**, independently of execution:

1. Eligibility has three states: `eligible`, `ineligible`, `unknown`, with evidence basis retained.
   An absent/null/nonboolean provider field, unresolved identity, conflicting current flags or
   unreviewed conflict is **unknown**. Neither `is_ineligible = false` nor missing data proves eligible.
2. For a resolved player/season, a current audited administrator decision takes precedence. It must
   carry exact durable identity, season, verdict, official citation, reasoning, actor and supersedes ID.
   Sealed history uses the existing audited-correction service and atomic publication.
3. Otherwise a consistent **explicit boolean** on the current, identified AFL API snapshot may supply
   provider eligibility. Retain its source/version/observation evidence; it is provider evidence, not
   a fabricated tribunal finding. A provider/stored disagreement needs review, not silent publication.
4. Unknown eligibility can affect winner determination and eligible ranking. Refuse an authoritative
   eligible leader/rank when an unresolved candidate can change the result; show raw vote totals and
   explain the uncertainty. Preserve all tied eligible winners. An unchanged winner does not resolve
   the remaining eligibility cases.
5. Do not globally select `stored_eligible_rank_one` as a shortcut: it would promote unevaluated
   defaults into findings. Approving this policy does not implement a new runtime policy or select a
   season rule. Existing determinations continue to require review where applicable. This package's
   observation entry point refuses unknown provider flags before the legacy boolean emitter runs.
   Extending tri-state storage/runtime ingestion for missing provider flags is separate work, requiring
   its own schema/implementation review; it is not hidden in a correction command.

Execution approval must enumerate the exact approved records. Twelve supported proposals do not
authorise recording even one ruling. See the [production approval package](brownlow-production-approval-package-2026-10-20.md).

## 5. Reproduction

Evidence (restricted, not in Git): `/home/rehearsal/evidence/b2025/eligibility/` in the rehearsal
distro: reconciliation JSON before/after, the decision results, and the before/after
`brownlow_season_votes` rows. The sandbox script records only against `afldb_v2_rb_gap023_test` and
refuses any other database.
