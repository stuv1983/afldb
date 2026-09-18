# AFLDB-ISSUE-222 -- operator verdicts (20260918-v1)

Source pack: `docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.json` sha256 `02d0cbe995b4482cf249fe216a10da18b325de6dfcb0504df2d3dbcba31ae292`

Operator: Stu
Review started: 2026-09-18T05:19:18Z  Review completed: 2026-09-18T08:43:12Z
Completion status: **complete** (83/83)

## Totals by group

| Group | Rows |
|---|---:|
| relisting | 44 |
| tokenisation | 2 |
| discrepancy | 7 |
| audit | 30 |

## Totals by verdict

| Verdict | Rows |
|---|---:|
| agree | 30 |
| approve_manual_curation | 7 |
| different_person_wrong_href | 2 |
| same_person_valid_href | 2 |
| same_person_valid_relisting | 42 |

## Totals by derived event-club appearance relationship

| Derived relationship | Rows |
|---|---:|
| no_senior_appearance_ever | 40 |
| not_applicable | 39 |
| pre_event_only | 4 |

## Totals by operator event-club observation

| Operator observation | Rows |
|---|---:|
| no_senior_appearance_ever | 40 |
| pre_event_only | 4 |

> event_club_appearance_relationship_derived is derived at review time, EVENT-RELATIVE: each row's own captured draft/listing event club and event year (taken exactly as recorded -- no destination-season inference) are compared against the player's retained whole-career start/end years and retained senior-playing clubs (case/whitespace-normalised, with a small set of same-organization club-rename aliases; a merger -- e.g. Fitzroy into the Brisbane Lions -- is never aliased). It is NOT a manually maintained database fact, and it never changes or preselects the identity verdict above it -- a relisted player correctly deriving 'pre_event_only' can still correctly receive a same-person verdict. event_club_observation is the operator's own confirmation or question of that derived value, recorded independently; it is required only for a same-person verdict on a row whose derivation is 'no_senior_appearance_ever' or 'pre_event_only'. Once draft/listing links are imported, AFLDB should derive this event-relative relationship at query time from draft_picks versus recorded senior appearances and seasons -- not store it as a redundant Boolean column.

## Rows (source-pack order)

| # | Group | DraftGuru URL | Machine classification | Event club | Club observation | Verdict | Notes |
|---:|---|---|---|---|---|---|---|
| 1 | relisting | `https://www.draftguru.com.au/players/andrew_krakouer/1` | relisting_signature_review | North Melbourne | pre_event_only | same_person_valid_relisting | https://en.wikipedia.org/wiki/Andrew_Krakouer_(footballer,_born_1971) |
| 2 | relisting | `https://www.draftguru.com.au/players/andrew_tarpey/1` | relisting_signature_review | Richmond | no_senior_appearance_ever | same_person_valid_relisting | https://en.wikipedia.org/wiki/Andrew_Tarpey |
| 3 | relisting | `https://www.draftguru.com.au/players/athas_hrysoulakis/1` | relisting_signature_review | Richmond | no_senior_appearance_ever | same_person_valid_relisting | https://en.wikipedia.org/wiki/Athas_Hrysoulakis |
| 4 | relisting | `https://www.draftguru.com.au/players/bradley_sparks/1` | relisting_signature_review | Sydney | no_senior_appearance_ever | same_person_valid_relisting | https://en.wikipedia.org/wiki/Bradley_Sparks |
| 5 | relisting | `https://www.draftguru.com.au/players/bret_hutchinson/1` | relisting_signature_review | West Coast | no_senior_appearance_ever | same_person_valid_relisting | https://en.wikipedia.org/wiki/Bret_Hutchinson |
| 6 | relisting | `https://www.draftguru.com.au/players/chris_o'dwyer/1` | relisting_signature_review | Carlton | no_senior_appearance_ever | same_person_valid_relisting | https://www.draftguru.com.au/players/chris_o'dwyer/1 https://en.wikipedia.org/wiki/Chris_O%27Dwyer https://afltables.com/afl/stats/players/C/Chris_ODwyer.html |
| 7 | relisting | `https://www.draftguru.com.au/players/craig_somerville/1` | relisting_signature_review | Brisbane | no_senior_appearance_ever | different_person_wrong_href | https://en.wikipedia.org/wiki/Craig_Somerville |
| 8 | relisting | `https://www.draftguru.com.au/players/darren_morgan/1` | relisting_signature_review | Sydney | no_senior_appearance_ever | same_person_valid_relisting | https://en.wikipedia.org/wiki/Darren_Morgan_(Australian_footballer)   |
| 9 | relisting | `https://www.draftguru.com.au/players/darren_williams/1` | relisting_signature_review | Essendon | pre_event_only | same_person_valid_relisting | https://en.wikipedia.org/wiki/Darren_Williams_(Australian_footballer) |
| 10 | relisting | `https://www.draftguru.com.au/players/david_sullivan/1` | relisting_signature_review | Richmond | no_senior_appearance_ever | different_person_wrong_href | https://en.wikipedia.org/wiki/David_Sullivan_(footballer)  |
| 11 | relisting | `https://www.draftguru.com.au/players/david_williams/1` | relisting_signature_review | Richmond | no_senior_appearance_ever | same_person_valid_relisting | https://www.draftguru.com.au/players/david_williams/1 https://en.wikipedia.org/wiki/David_Williams_(Australian_rules_footballer) https://afltables.com/afl/stats/players/D/David_Williams.html |
| 12 | relisting | `https://www.draftguru.com.au/players/dean_strauch/1` | relisting_signature_review | Brisbane | no_senior_appearance_ever | same_person_valid_relisting |  |
| 13 | relisting | `https://www.draftguru.com.au/players/gary_keane/1` | relisting_signature_review | Geelong | no_senior_appearance_ever | same_person_valid_relisting |  |
| 14 | relisting | `https://www.draftguru.com.au/players/gerard_healy/1` | relisting_signature_review | Collingwood | no_senior_appearance_ever | same_person_valid_relisting |  |
| 15 | relisting | `https://www.draftguru.com.au/players/glen_bartlett/1` | relisting_signature_review | Brisbane | no_senior_appearance_ever | same_person_valid_relisting |  |
| 16 | relisting | `https://www.draftguru.com.au/players/gordon_fode/1` | relisting_signature_review | Hawthorn | no_senior_appearance_ever | same_person_valid_relisting |  |
| 17 | relisting | `https://www.draftguru.com.au/players/ian_rickman/1` | relisting_signature_review | Western Bulldogs | pre_event_only | same_person_valid_relisting |  |
| 18 | relisting | `https://www.draftguru.com.au/players/jason_daniltchenko/1` | relisting_signature_review | Hawthorn | no_senior_appearance_ever | same_person_valid_relisting |  |
| 19 | relisting | `https://www.draftguru.com.au/players/john_ahern/1` | relisting_signature_review | North Melbourne | no_senior_appearance_ever | same_person_valid_relisting |  |
| 20 | relisting | `https://www.draftguru.com.au/players/john_fidge/1` | relisting_signature_review | Sydney | no_senior_appearance_ever | same_person_valid_relisting |  |
| 21 | relisting | `https://www.draftguru.com.au/players/john_peter-budge/1` | relisting_signature_review | Richmond | no_senior_appearance_ever | same_person_valid_relisting |  |
| 22 | relisting | `https://www.draftguru.com.au/players/justin_pickering/1` | relisting_signature_review | Western Bulldogs | no_senior_appearance_ever | same_person_valid_relisting |  |
| 23 | relisting | `https://www.draftguru.com.au/players/lynton_fitzpatrick/1` | relisting_signature_review | Geelong | no_senior_appearance_ever | same_person_valid_relisting |  |
| 24 | relisting | `https://www.draftguru.com.au/players/mark_majerczak/1` | relisting_signature_review | Western Bulldogs | no_senior_appearance_ever | same_person_valid_relisting |  |
| 25 | relisting | `https://www.draftguru.com.au/players/mark_mcleod/1` | relisting_signature_review | Hawthorn | no_senior_appearance_ever | same_person_valid_relisting |  |
| 26 | relisting | `https://www.draftguru.com.au/players/mark_o'donoghue/1` | relisting_signature_review | Sydney | no_senior_appearance_ever | same_person_valid_relisting |  |
| 27 | relisting | `https://www.draftguru.com.au/players/mark_pitura/1` | relisting_signature_review | Collingwood | no_senior_appearance_ever | same_person_valid_relisting |  |
| 28 | relisting | `https://www.draftguru.com.au/players/michael_garvey/1` | relisting_signature_review | Geelong | no_senior_appearance_ever | same_person_valid_relisting |  |
| 29 | relisting | `https://www.draftguru.com.au/players/nathan_irvin/1` | relisting_signature_review | Western Bulldogs | no_senior_appearance_ever | same_person_valid_relisting |  |
| 30 | relisting | `https://www.draftguru.com.au/players/paul_mifka/1` | relisting_signature_review | Brisbane | no_senior_appearance_ever | same_person_valid_relisting |  |
| 31 | relisting | `https://www.draftguru.com.au/players/paul_tuddenham/1` | relisting_signature_review | Carlton | no_senior_appearance_ever | same_person_valid_relisting |  |
| 32 | relisting | `https://www.draftguru.com.au/players/peter_baldwin/1` | relisting_signature_review | North Melbourne | no_senior_appearance_ever | same_person_valid_relisting |  |
| 33 | relisting | `https://www.draftguru.com.au/players/peter_freeman/1` | relisting_signature_review | West Coast | no_senior_appearance_ever | same_person_valid_relisting |  |
| 34 | relisting | `https://www.draftguru.com.au/players/peter_whyte/1` | relisting_signature_review | Brisbane | no_senior_appearance_ever | same_person_valid_relisting |  |
| 35 | relisting | `https://www.draftguru.com.au/players/ricky_jackson/1` | relisting_signature_review | Western Bulldogs | no_senior_appearance_ever | same_person_valid_relisting |  |
| 36 | relisting | `https://www.draftguru.com.au/players/robert_walker/1` | relisting_signature_review | Hawthorn | no_senior_appearance_ever | same_person_valid_relisting |  |
| 37 | relisting | `https://www.draftguru.com.au/players/rodney_gladman/1` | relisting_signature_review | Collingwood | no_senior_appearance_ever | same_person_valid_relisting |  |
| 38 | relisting | `https://www.draftguru.com.au/players/simon_hawking/1` | relisting_signature_review | Brisbane | no_senior_appearance_ever | same_person_valid_relisting |  |
| 39 | relisting | `https://www.draftguru.com.au/players/simon_luhrs/1` | relisting_signature_review | Hawthorn | no_senior_appearance_ever | same_person_valid_relisting |  |
| 40 | relisting | `https://www.draftguru.com.au/players/simon_taylor/1` | relisting_signature_review | Fitzroy | no_senior_appearance_ever | same_person_valid_relisting |  |
| 41 | relisting | `https://www.draftguru.com.au/players/tim_bourke/1` | relisting_signature_review | North Melbourne | no_senior_appearance_ever | same_person_valid_relisting |  |
| 42 | relisting | `https://www.draftguru.com.au/players/tony_elshaug/1` | relisting_signature_review | St Kilda | no_senior_appearance_ever | same_person_valid_relisting |  |
| 43 | relisting | `https://www.draftguru.com.au/players/tony_furey/1` | relisting_signature_review | North Melbourne | pre_event_only | same_person_valid_relisting |  |
| 44 | relisting | `https://www.draftguru.com.au/players/warren_dean/1` | relisting_signature_review | West Coast | no_senior_appearance_ever | same_person_valid_relisting |  |
| 45 | tokenisation | `https://www.draftguru.com.au/players/adrian_deluca/1` | OTHER_CONTRADICTION:SURNAME_DIFFERENT |  | not_applicable | same_person_valid_href |  |
| 46 | tokenisation | `https://www.draftguru.com.au/players/setanta_%C3%B3%20hailp%C3%ADn/1` | OTHER_CONTRADICTION:SURNAME_DIFFERENT |  | not_applicable | same_person_valid_href |  |
| 47 | discrepancy | `https://www.draftguru.com.au/players/tom_murphy/1` | source_discrepancy_manual_curation_candidate |  | not_applicable | approve_manual_curation |  |
| 48 | discrepancy | `https://www.draftguru.com.au/players/joel_smith/1` | source_discrepancy_manual_curation_candidate |  | not_applicable | approve_manual_curation |  |
| 49 | discrepancy | `https://www.draftguru.com.au/players/josh_smith/1` | source_discrepancy_manual_curation_candidate |  | not_applicable | approve_manual_curation |  |
| 50 | discrepancy | `https://www.draftguru.com.au/players/stephen_schwerdt/1` | source_discrepancy_manual_curation_candidate |  | not_applicable | approve_manual_curation |  |
| 51 | discrepancy | `https://www.draftguru.com.au/players/aaron_black/1` | source_discrepancy_manual_curation_candidate |  | not_applicable | approve_manual_curation |  |
| 52 | discrepancy | `https://www.draftguru.com.au/players/alwyn_davey/1` | source_discrepancy_manual_curation_candidate |  | not_applicable | approve_manual_curation |  |
| 53 | discrepancy | `https://www.draftguru.com.au/players/sam_butler/1` | source_discrepancy_manual_curation_candidate |  | not_applicable | approve_manual_curation |  |
| 54 | audit | `https://www.draftguru.com.au/players/chad_morrison/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 55 | audit | `https://www.draftguru.com.au/players/ben_speight/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 56 | audit | `https://www.draftguru.com.au/players/matt_clape/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 57 | audit | `https://www.draftguru.com.au/players/jarrad_mcveigh/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 58 | audit | `https://www.draftguru.com.au/players/jamarra_ugle-hagan/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 59 | audit | `https://www.draftguru.com.au/players/stephen_coniglio/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 60 | audit | `https://www.draftguru.com.au/players/sean_denham/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 61 | audit | `https://www.draftguru.com.au/players/zach_reid/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 62 | audit | `https://www.draftguru.com.au/players/nick_mitchell/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 63 | audit | `https://www.draftguru.com.au/players/cameron_venables/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 64 | audit | `https://www.draftguru.com.au/players/jake_stringer/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 65 | audit | `https://www.draftguru.com.au/players/bryce_retzlaff/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 66 | audit | `https://www.draftguru.com.au/players/ken_judge/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 67 | audit | `https://www.draftguru.com.au/players/dean_turner/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 68 | audit | `https://www.draftguru.com.au/players/jesse_dattoli/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 69 | audit | `https://www.draftguru.com.au/players/jeff_white/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 70 | audit | `https://www.draftguru.com.au/players/matthew_kreuzer/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 71 | audit | `https://www.draftguru.com.au/players/paddy_ryder/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 72 | audit | `https://www.draftguru.com.au/players/ty_zantuck/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 73 | audit | `https://www.draftguru.com.au/players/david_ogg/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 74 | audit | `https://www.draftguru.com.au/players/wayne_hernaman/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 75 | audit | `https://www.draftguru.com.au/players/peter_matera/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 76 | audit | `https://www.draftguru.com.au/players/will_schofield/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 77 | audit | `https://www.draftguru.com.au/players/andrew_purser/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 78 | audit | `https://www.draftguru.com.au/players/daniel_healy/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 79 | audit | `https://www.draftguru.com.au/players/will_hams/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 80 | audit | `https://www.draftguru.com.au/players/darren_baxter/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 81 | audit | `https://www.draftguru.com.au/players/josh_wooden/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 82 | audit | `https://www.draftguru.com.au/players/darcy_tucker/1` | offline_strong_audit_row |  | not_applicable | agree |  |
| 83 | audit | `https://www.draftguru.com.au/players/tim_taranto/1` | offline_strong_audit_row |  | not_applicable | agree |  |
