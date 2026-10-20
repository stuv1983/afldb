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
- **Consequence.** "Stored eligible" cannot be offered as counter-evidence; the provider flag cannot be
  trusted on its own either. Each player below was checked against official AFL reporting of 2025
  home-and-away suspensions. The governing rule applied: a player suspended for a reportable offence
  during the home-and-away season is ineligible for that year's Brownlow Medal (votes are still polled
  and counted; the player simply cannot win).
- The unchanged winner is **not** used as evidence: the winner (Matt Rowell, p9235, 39 votes) is
  unaffected whichever way the 12 are ruled.

## 2. Proposed correction table

`decided basis` for all rows is `audited_correction` (2025 is sealed). Identity = the durable identity
the decision ledger would store (`resolvePlayerIdentity`). Votes = 2025 season total. Citations are
official afl.com.au article ids (MRO / Tribunal reports and the Brownlow count coverage) as retrieved on
2026-10-20; **the owner should open each before recording**, because the ledger stores the citation
verbatim.

| Player (player_id) | Durable identity | Votes | Provider | Stored | Offence (2025 H&A) | Citation (afl.com.au article id) | Proposed | Confidence |
|---|---|---|---|---|---|---|---|---|
| Toby Greene (12446) | `afltables:players/T/Toby_Greene.html` | 14 | ineligible | default | R20 striking Heeney, 1 match | 1373677 (MRO); 1427225 (count coverage names Greene ineligible through suspension) | **ineligible** | HIGH (directly stated in count coverage) |
| Tristan Xerri (12869) | `afltables:players/T/Tristan_Xerri.html` | 7 | ineligible | default | R18 striking Sparrow, 3 matches | 1365693; 1365899 | **ineligible** | HIGH |
| Zac Bailey (13246) | `afltables:players/Z/Zac_Bailey.html` | 6 | ineligible | default | R18 rough conduct Haynes, 1 match | 1361425; 1365899 | **ineligible** | HIGH |
| Rory Laird (11386) | `afltables:players/R/Rory_Laird.html` | 5 | ineligible | default | R22 rough conduct Cripps, 1 match | 1388030; 1388249 | **ineligible** | HIGH |
| Sam Durham (11625) | `afltables:players/S/Sam_Durham.html` | 4 | ineligible | default | R13 front-on contact Cerra, 2 matches | 1339570 | **ineligible** | HIGH |
| Dan Houston (3191) | `afltables:players/D/Dan_Houston.html` | 3 | ineligible | default | R4 rough conduct Fogarty, 2 matches | 1292232 | **ineligible** | HIGH |
| Dylan Shiel (4006) | `afltables:players/D/Dylan_Shiel.html` | 3 | ineligible | default | R22 rough conduct O'Connor, 1 match | 1388249; 1383983 | **ineligible** | HIGH |
| Patrick Voss (10252) | `afltables:players/P/Patrick_Voss.html` | 3 | ineligible | default | R5 striking Vlastuin, 3 matches | 1300207; 1300516 | **ineligible** | HIGH |
| Liam Baker (8798) | `afltables:players/L/Liam_Baker.html` | 2 | ineligible | default | R24 rough conduct Warner, 1 match | 1401221 | **ineligible** | HIGH |
| Ollie Wines (10130) | `afltables:players/O/Ollie_Wines.html` | 2 | ineligible | default | R23 rough conduct Lord, 3 matches | 1393572; 1396382 | **ineligible** | HIGH |
| Shannon Neale (11831) | `afltables:players/S/Shannon_Neale.html` | 2 | ineligible | default | R23 high bump, 1 match | 1396161 | **ineligible** | HIGH |
| James Peatling (6737) | `afltables:players/J/James_Peatling.html` | 1 | ineligible | default | R5 tackle Mullin, 1 match | 1297048 | **ineligible** | HIGH |

Confidence note. Only Greene's ineligibility is stated outright in count coverage; the other eleven are
derived by applying the rule to an official MRO/Tribunal outcome. All twelve are consistent with the
provider. The converse was also checked: a third-party suspensions tracker (35 rows) was cross-read
against the vote-getters, and exactly these 12 suspended vote-getters appear; no suspended vote-getter
is provider-eligible. The one near miss (a banned player the provider kept eligible) was a
*conduct-unbecoming* sanction, which is not a reportable offence under the rule, so that player stays
eligible. The third-party tracker is corroboration only and is not cited as authority.

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

## 5. Reproduction

Evidence (restricted, not in Git): `/home/rehearsal/evidence/b2025/eligibility/` in the rehearsal
distro: reconciliation JSON before/after, the decision results, and the before/after
`brownlow_season_votes` rows. The sandbox script records only against `afldb_v2_rb_gap023_test` and
refuses any other database.
