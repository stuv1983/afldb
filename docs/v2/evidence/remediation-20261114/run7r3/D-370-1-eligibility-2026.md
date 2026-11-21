# D-370-1: players who polled 2026 Brownlow votes while ineligible to win (evidence, 21 November 2026)

**Status: PROPOSED, awaiting the owner's decision.** Nothing here has been written to any database except the DEV self-test copy.
The placeholder used in the 21 November rehearsal (an empty list) is withdrawn.

## 1. Votes polled versus eligibility to win

- **Votes polled.** The 3-2-1 votes the umpires awarded in each match. They are facts of the count and are published in full for
  every player, eligible or not. AFLDB already holds all 2026 votes: 9,522 round rows, 621 positive, 1,242 votes (207 matches x 6).
  Nothing in D-370-1 changes a vote.
- **Eligibility to win.** Under the AFL rule, a player found guilty of a suspendable offence during the home-and-away season (Tribunal
  or Match Review Officer, including an early-plea one-match ban) cannot win the Medal. He keeps his votes and his place in the overall
  count. A club-imposed sanction is not a suspension for this purpose. A ban the Tribunal overturns does not count.

## 2. Method

1. **Who polled.** SEN's club-by-club list of every player's 2026 total (https://www.sen.com.au/news/2026/09/21/brownlow-medal-2026-club-by-club-votes),
   cross-checked against AFLDB: 183 players polled, 1,242 votes. Each club's figures add up to its stated total.
2. **Who was suspended.** The Zero Hanger 2026 MRO and Tribunal tracker
   (https://www.zerohanger.com/2026-afl-suspensions-mro-and-tribunal-tracker/) and its count-eve list "BANNED: The 30 AFL players
   ineligible for the Brownlow Medal" (https://www.zerohanger.com/banned-the-30-afl-players-ineligible-for-the-brownlow-medal-182905/).
   The list was re-read directly: all 30 names, and none of Noble, Heeney, Warner, Blakey or Bice, are as stated below. Its date and
   byline came only from a model summary of the page, so they are not verified.
3. **Intersection.** Every listed player was matched to an AFLDB player who appears in 2026, by name and 2026 club, and his stored 2026
   round-grain votes were read. The query ran read-only on the DEV copy of the 18 Nov production dump, so the ids are production's.
   All 30 matched. Mark O'Connor is stored as "Mark OConnor" (id 9119) and polled 0.
4. **Corroboration.** Statements that name ineligible players in coverage of the count:
   - afl.com.au, "Your club's Brownlow: total votes, first timers, biggest shocks"
     (https://www.afl.com.au/news/1617930/your-clubs-2026-brownlow-medal-night-leader-top-five-total-votes): "The ineligible Jason
     Horne-Francis (22) drew the bulk of the Power's other votes", and "while ineligible the Zac Bailey was next on 13". These are the
     only two sentences on the page with "ineligible". The article names no other players either way, so it is not a complete list.
   - adelaidefc.com.au (https://www.afc.com.au/news/2137902/brownlow-medal-2026-a-career-best-finish-for-a-crow-plus-all-the-votes):
     "Thilthorpe, Fogarty and Walker were ineligible for the Brownlow due to suspensions during the season."
   - Each suspension's own report on afl.com.au. Some examples:
     - Sicily and Moore: R6, /news/1501392;
     - Xerri: R3, /news/1487717;
     - Curtis: R14, /news/1542286;
     - Humphrey: R2, /news/1484114;
     - Long: R17, cut to one match, /news/1555984;
     - Byrne-Jones: R22, /news/1579625;
     - van Rooyen: R23, upheld, /news/1589382;
     - Horne-Francis: R18, /news/1559841.

     Reid: R24, upheld, served in rounds 1–2 of 2027, westcoasteagles.com.au /news/2113424. These articles were gathered by a research
     agent; only the Zero Hanger list and the two count-coverage pages above were re-read in this session.
5. **Exclusions checked.**
   - **The Sydney five** remain eligible: Heeney (6079, 26 votes), Warner (2561, 12), Blakey (9903, 5), Bice (11034, 2) and Jordon
     (6724, 0). The AFL CEO said on 24 August 2026 (https://www.afl.com.au/news/1594851/...): "They're still eligible for Brownlow,
     but they're under a club suspension".
   - **John Noble** (7664, 7 votes) remains eligible: the Tribunal overturned his round 6 ban.
   - **Max Michalanney's** ban was in the finals, and **Jed Walter's** and **Harry Schoenberg's** were pre-season. None of the three
     polled.
6. **No official consolidated list was available.**
   - The AFL's ineligibility explainer did not load.
   - Footyinfo's annotated table refused automated access (HTTP 403).
   - AFL Tables carries no ineligibility markers.

## 3. The 14 players who polled votes and were ineligible (proposed D-370-1)

| AFLDB id | Player (slug-id) | Club | 2026 votes | Suspension (offence round) | Named ineligible in count coverage |
|---|---|---|---|---|---|
| 6841 | Jason Horne-Francis (`jason-horne-francis-6841`) | Port Adelaide | 22 | R18 rough conduct, 1 match | **afl.com.au 1617930** |
| 5480 | Harley Reid (`harley-reid-5480`) | West Coast | 15 | R24 rough conduct, 2 matches (upheld) | Wikipedia "2026 Brownlow Medal" footnote; ZH list |
| 13246 | Zac Bailey (`zac-bailey-13246`) | Brisbane Lions | 13 | Opening Round, struck, 1 match | **afl.com.au 1617930** |
| 6667 | Jacob van Rooyen (`jacob-van-rooyen-6667`) | Melbourne | 10 | R23 struck, 3 matches (upheld) | ZH list (Footyinfo marker seen only in a search snippet) |
| 11041 | Riley Thilthorpe (`riley-thilthorpe-11041`) | Adelaide | 5 | R11 struck, 1 match | **adelaidefc.com.au 2137902** |
| 3295 | Darcy Fogarty (`darcy-fogarty-3295`) | Adelaide | 4 | R19 struck, 3 matches | **adelaidefc.com.au 2137902** |
| 12205 | Taylor Walker (`taylor-walker-12205`) | Adelaide | 3 | R13 rough conduct, 1 match | **adelaidefc.com.au 2137902** |
| 6746 | James Sicily (`james-sicily-6746`) | Hawthorn | 3 | R6 struck, 1 match | ZH list |
| 12869 | Tristan Xerri (`tristan-xerri-12869`) | North Melbourne | 3 | R3 serious misconduct, 3 matches | ZH list |
| 4004 | Dylan Moore (`dylan-moore-4004`) | Hawthorn | 2 | R6 struck, 1 match | ZH list |
| 10282 | Paul Curtis (`paul-curtis-10282`) | North Melbourne | 2 | R14 rough conduct, 3 matches | ZH list |
| 940 | Bailey Humphrey (`bailey-humphrey-940`) | Gold Coast | 1 | R2 rough conduct, 2 matches | ZH list |
| 1108 | Ben Long (`ben-long-1108`) | Gold Coast | 1 | R17 rough conduct, 1 match (reduced) | ZH list |
| 3292 | Darcy Byrne-Jones (`darcy-byrne-jones-3292`) | Port Adelaide | 1 | R22 rough conduct, 1 match | ZH list |

The list holds 14 players with 85 votes between them. The highest is Horne-Francis's 22, against the winner's 47, so **no entry can
change the winner** (Nick Daicos, 47, eligible).

The other 16 listed players polled no votes:
- Gallop 12893, Andrews 5539, Gardiner 3297 and Hayward 13191;
- Langford 8339, O'Connor 9119, Clohesy 11610 and Fonti 7325;
- Weddle 7905, Trainor 8960, S. Ryan 11689 and Faull 7820;
- Butler 3183, Sheldrick 680, Robertson 3724 and Baker 8798.

**These 16 cannot be entered:** the publisher refuses an ineligible id that polled no votes (`publishBrownlowSeason`,
`src/db/queries/admin-brownlow.ts`, the stray-id check).

**Confidence.**
- **High (5 players): Horne-Francis, Bailey, Thilthorpe, Fogarty and Walker.** Each is named ineligible by the AFL's or his club's
  count coverage and has a sourced home-and-away suspension.
- **Secondary (2 players): Reid and van Rooyen.** Each is named ineligible by a secondary source, with a sourced suspension.
- **Good (7 players): Sicily, Xerri, Moore, Curtis, Humphrey, Long and Byrne-Jones.** Each has a sourced home-and-away suspension and
  is on the count-eve ineligible list. No count-night source names them, because the coverage only mentions ineligible players who
  polled prominently.

## 4. How the publisher uses the list, and what a wrong entry would change publicly

- **How the list is entered.**
  - At `/admin/brownlow/2026` the Super Admin ticks players in "Ineligible players (n marked)", a checkbox per polled player
    (`PublishPanel.tsx`).
  - For 2026 the panel starts empty: no 2026 season rows exist yet to prefill from.
  - The ticked ids go to `publishSeasonAction`, then `publishBrownlowSeason`, then `deriveSeasonRows` (`src/lib/brownlow/entry.ts`).
- **What the publisher does with it.** For each listed id, the season row gets `is_ineligible = true`. The player:
  - keeps his votes and his overall `vote_rank`;
  - gets no eligible rank, and every eligible player below him moves up one eligible place;
  - can never be `is_winner`.

  The winner is the eligible player, or players if tied, at eligible rank 1. Publication is audited, and a later re-publication with
  a corrected list creates a new revision.
- **What the public sees.**
  - On `/brownlow/2026`, a "Recorded ineligible" badge on each listed row. Votes and order are unchanged.
  - The winner line and badge: Nick Daicos either way.
  - Club Brownlow comparisons: an "Ineligible" badge where such a player is shown.
  - Wherever an eligible rank or best eligible finisher is derived from `is_ineligible`.
  - Vote totals on player, match, season and game-log pages are **not** affected.
- **A wrong inclusion** labels an eligible player "Recorded ineligible" and drops him from the eligible ranking: a public false
  statement about a named player.
- **A wrong omission** shows an ineligible player as eligible and ranks him among the eligible players. For example, Horne-Francis's
  22 would sit as an eligible top-ten finisher.
- **Either error is corrected** by re-publishing 2026 with the right list (audited, new revision; no data restore needed).

## 5. The decision needed

> **D-370-1 (smallest form):** "Publish 2026 with these 14 players marked ineligible: ids 6841, 5480, 13246, 6667, 11041, 3295, 12205,
> 6746, 12869, 4004, 10282, 940, 1108, 3292."

The alternatives, if you prefer:
- **(b)** Mark only the 5 named by the AFL and Adelaide (6841, 13246, 11041, 3295, 12205). Then re-publish once the others are confirmed.
- **(c)** Hold publication until an official AFL list is obtained.

Recommendation: the 14. Every entry has a sourced suspension and appears on the count-eve list. The cross-check accounts for all 183
players who polled.
