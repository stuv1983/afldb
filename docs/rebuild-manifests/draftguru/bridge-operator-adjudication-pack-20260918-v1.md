# AFLDB-ISSUE-222 -- operator adjudication pack (20260918-v1)

**Phase 3 remains PENDING.** This pack sets no `operator_verdict` anywhere. It decides nothing, imports nothing, generates no bridge v2 dataset, and generates no v2 validation sample. Full per-row detail (every field): `bridge-operator-adjudication-pack-20260918-v1.json` / `.csv`. This document is the compact summary the operator can adjudicate from without reading raw JSON.

## Hash links

| Input | Path | Hash |
|---|---|---|
| Parent bridge (v1, immutable) | `data/reference/draftguru-person-bridge-20260918-v1.json` | `92ff142ef71d175046b4949b0a85d5925bc396d3586b5b1fc3f44e51f097320e` |
| `afldb_test` child (v1, immutable) | `data/reference/draftguru-person-bridge-20260918-v1.afldb_test.json` | `596bbb684424b40f43c22368f1b77aa4198eec8b56a1109a7bb587c5c7a9a27f` |
| 997-row review sample (v1, immutable) | `docs/rebuild-manifests/draftguru/bridge-review-20260918-v1.json` | `036cc0826428c03a622448d299b803c23bac011bd5cd92eea86c4283e445ba84` |
| Corrected population scan (v2) | `docs/rebuild-manifests/draftguru/bridge-population-scan-20260918-v2.json` | `3178f935540f1737b9c75be86006a97277bb4f01c2d85d08ac6d062df9b21e2e` (rows_sha256 `ad134d1447b10b6a9880e14507be6d88da8001659b69ab996d91580cbb64908f`) |
| Retained fitzRoy snapshot | `full-history-20260902` | manifest `2bd66e3df5ce80411363da9e15c6dddadc9eefe5c5c9eca3f5b7bd7106b0a0c1`, artefact set `15ba5dc624535d95fd1661c7c5e757ae4fc2d31782a2c0b1414e19358580dd6c` |
| DraftGuru snapshot manifest | `docs/rebuild-manifests/draftguru/person-html-20260918.json` | -- |
| Existing review-verdict artefact (v2) | `docs/rebuild-manifests/draftguru/bridge-review-verdicts-20260918-v2.json` | `a7d78f0faebf5fe954104d2ee6894d62a14413e33b2cd81d7260963f3440a847` |

## Section 1 -- 44 relisting-signature rows (`same_person_valid_relisting` / `different_person_wrong_href` / `undetermined_withhold`)

A DraftGuru entry recording **zero games following that specific listing event** (per-entry games, never career games) whose captured href resolves to a retained target with a genuine played career (`career_games > 0`) that had already ended **at or before** that event's year. Stage A's own listed age at the event agrees with the retained target's birth year (within tolerance) on every row below. This is the corrected, neutral classification for what the withdrawn v1 population scan called `confirmed_source_mislink` on 23 of these rows and left as `population_clean` on the other 21 -- the only difference between the two groups was whether the retained career ended exactly in the event year or one year earlier, an arbitrary boundary with no evidentiary basis. **Neither label is correct: this pattern is equally consistent with a delisted/veteran player being genuinely relisted years later, and with a genuine source mislink. Only the operator can decide.**

| # | DraftGuru URL | Was originally... | Sample | Event | DraftGuru name | Retained target | Target span/games | Age/birth agree |
|---:|---|---|---|---|---|---|---|---|
| 1 | `https://www.draftguru.com.au/players/andrew_krakouer/1` | confirmed mislink (v1) | non_sample | 1992 Mid-Season | Andrew Krakouer | Andrew Krakouer (b.1971) | 1989-1990 / 8g | True |
| 2 | `https://www.draftguru.com.au/players/andrew_tarpey/1` | population_clean (v1) | non_sample | 1991 Mid-Season | Andrew Tarpey | Andrew Tarpey (b.1965) | 1988-1991 / 9g | True |
| 3 | `https://www.draftguru.com.au/players/athas_hrysoulakis/1` | population_clean (v1) | non_sample | 1990 Mid-Season | Athas Hrysoulakis | Athas Hrysoulakis (b.1969) | 1987-1990 / 19g | True |
| 4 | `https://www.draftguru.com.au/players/bradley_sparks/1` | confirmed mislink (v1) | non_sample | 1990 Pre-Draft | Bradley Sparks | Bradley Sparks (b.1967) | 1987-1988 / 4g | True |
| 5 | `https://www.draftguru.com.au/players/bret_hutchinson/1` | confirmed mislink (v1) | random | 1989 Pre-Season | Bret Hutchinson | Bret Hutchinson (b.1964) | 1985-1985 / 1g | True |
| 6 | `https://www.draftguru.com.au/players/chris_o'dwyer/1` | confirmed mislink (v1) | non_sample | 1992 Pre-Season | Chris O'Dwyer | Chris ODwyer (b.1971) | 1990-1991 / 8g | True |
| 7 | `https://www.draftguru.com.au/players/craig_somerville/1` | confirmed mislink (v1) | random | 1988 Trade | Craig Somerville | Craig Somerville (b.1968) | 1986-1986 / 8g | True |
| 8 | `https://www.draftguru.com.au/players/darren_morgan/1` | population_clean (v1) | non_sample | 1990 Pre-Draft | Darren Morgan | Darren Morgan (b.1965) | 1984-1990 / 92g | True |
| 9 | `https://www.draftguru.com.au/players/darren_williams/1` | confirmed mislink (v1) | non_sample | 1990 Pre-Season | Darren Williams | Darren Williams (b.1960) | 1979-1989 / 109g | True |
| 10 | `https://www.draftguru.com.au/players/david_sullivan/1` | confirmed mislink (v1) | non_sample | 1989 Pre-Season | David Sullivan | David Sullivan (b.1966) | 1986-1988 / 11g | True |
| 11 | `https://www.draftguru.com.au/players/david_williams/1` | confirmed mislink (v1) | random | 1989 Pre-Season | David Williams | David Williams (b.1962) | 1983-1988 / 67g | True |
| 12 | `https://www.draftguru.com.au/players/dean_strauch/1` | population_clean (v1) | non_sample | 1989 Mid-Season | Dean Strauch | Dean Strauch (b.1966) | 1986-1989 / 5g | True |
| 13 | `https://www.draftguru.com.au/players/gary_keane/1` | confirmed mislink (v1) | non_sample | 1989 Trade | Gary Keane | Gary Keane (b.1964) | 1985-1988 / 55g | True |
| 14 | `https://www.draftguru.com.au/players/gerard_healy/1` | population_clean (v1) | non_sample | 1990 Pre-Season | Gerard Healy | Gerard Healy (b.1961) | 1979-1990 / 211g | True |
| 15 | `https://www.draftguru.com.au/players/glen_bartlett/1` | confirmed mislink (v1) | random | 1989 Mid-Season | Glen Bartlett | Glen Bartlett (b.1964) | 1987-1987 / 4g | True |
| 16 | `https://www.draftguru.com.au/players/gordon_fode/1` | population_clean (v1) | non_sample | 1995 Pre-Season | Gordon Fode | Gordon Fode (b.1971) | 1988-1995 / 52g | True |
| 17 | `https://www.draftguru.com.au/players/ian_rickman/1` | confirmed mislink (v1) | non_sample | 1989 Pre-Season | Ian Rickman | Ian Rickman (b.1963) | 1982-1984 / 11g | True |
| 18 | `https://www.draftguru.com.au/players/jason_daniltchenko/1` | population_clean (v1) | non_sample | 1997 Pre-Season | Jason Daniltchenko | Jason Daniltchenko (b.1975) | 1993-1997 / 29g | True |
| 19 | `https://www.draftguru.com.au/players/john_ahern/1` | confirmed mislink (v1) | non_sample | 1990 Trade | John Ahern | John Ahern (b.1970) | 1989-1989 / 2g | True |
| 20 | `https://www.draftguru.com.au/players/john_fidge/1` | population_clean (v1) | random | 1989 Pre-Draft | John Fidge | John Fidge (b.1966) | 1984-1989 / 59g | True |
| 21 | `https://www.draftguru.com.au/players/john_peter-budge/1` | confirmed mislink (v1) | non_sample | 1990 National | John Peter-Budge | John Peter-Budge (b.1968) | 1986-1988 / 45g | True |
| 22 | `https://www.draftguru.com.au/players/justin_pickering/1` | population_clean (v1) | non_sample | 1991 National | Justin Pickering | Justin Pickering (b.1967) | 1988-1991 / 59g | True |
| 23 | `https://www.draftguru.com.au/players/lynton_fitzpatrick/1` | population_clean (v1) | non_sample | 1989 Pre-Season | Lynton Fitzpatrick | Lynton Fitzpatrick (b.1967) | 1987-1989 / 18g | True |
| 24 | `https://www.draftguru.com.au/players/mark_majerczak/1` | population_clean (v1) | random | 1991 Pre-Season | Mark Majerczak | Mark Majerczak (b.1968) | 1987-1991 / 17g | True |
| 25 | `https://www.draftguru.com.au/players/mark_mcleod/1` | confirmed mislink (v1) | non_sample | 1990 Pre-Season | Mark McLeod | Mark McLeod (b.1969) | 1989-1989 / 3g | True |
| 26 | `https://www.draftguru.com.au/players/mark_o'donoghue/1` | population_clean (v1) | non_sample | 1988 Trade | Mark O'Donoghue | Mark ODonoghue (b.1967) | 1988-1988 / 2g | True |
| 27 | `https://www.draftguru.com.au/players/mark_pitura/1` | confirmed mislink (v1) | non_sample | 1995 Pre-Season | Mark Pitura | Mark Pitura (b.1974) | 1993-1993 / 2g | True |
| 28 | `https://www.draftguru.com.au/players/michael_garvey/1` | population_clean (v1) | non_sample | 1989 Pre-Season | Michael Garvey | Michael Garvey (b.1965) | 1988-1989 / 3g | True |
| 29 | `https://www.draftguru.com.au/players/nathan_irvin/1` | confirmed mislink (v1) | non_sample | 1994 National | Nathan Irvin | Nathan Irvin (b.1973) | 1993-1993 / 1g | True |
| 30 | `https://www.draftguru.com.au/players/paul_mifka/1` | confirmed mislink (v1) | non_sample | 1990 Pre-Draft | Paul Mifka | Paul Mifka (b.1965) | 1987-1987 / 1g | True |
| 31 | `https://www.draftguru.com.au/players/paul_tuddenham/1` | population_clean (v1) | non_sample | 1991 Pre-Season | Paul Tuddenham | Paul Tuddenham (b.1967) | 1987-1991 / 40g | True |
| 32 | `https://www.draftguru.com.au/players/peter_baldwin/1` | population_clean (v1) | non_sample | 1990 Pre-Season | Peter Baldwin | Peter Baldwin (b.1968) | 1987-1990 / 5g | True |
| 33 | `https://www.draftguru.com.au/players/peter_freeman/1` | confirmed mislink (v1) | non_sample | 1991 National | Peter Freeman | Peter Freeman (b.1969) | 1988-1990 / 5g | True |
| 34 | `https://www.draftguru.com.au/players/peter_whyte/1` | confirmed mislink (v1) | random | 1990 National | Peter Whyte | Peter Whyte (b.1969) | 1986-1988 / 22g | True |
| 35 | `https://www.draftguru.com.au/players/ricky_jackson/1` | population_clean (v1) | non_sample | 1991 Trade | Ricky Jackson | Ricky Jackson (b.1967) | 1986-1991 / 80g | True |
| 36 | `https://www.draftguru.com.au/players/robert_walker/1` | population_clean (v1) | random | 1992 Pre-Season | Robert Walker | Robert Walker (b.1970) | 1990-1992 / 5g | True |
| 37 | `https://www.draftguru.com.au/players/rodney_gladman/1` | confirmed mislink (v1) | non_sample | 1989 Pre-Season | Rodney Gladman | Rodney Gladman (b.1968) | 1987-1987 / 1g | True |
| 38 | `https://www.draftguru.com.au/players/simon_hawking/1` | population_clean (v1) | non_sample | 1996 Pre-Draft | Simon Hawking | Simon Hawking (b.1973) | 1993-1996 / 60g | True |
| 39 | `https://www.draftguru.com.au/players/simon_luhrs/1` | population_clean (v1) | non_sample | 1992 Mid-Season | Simon Luhrs | Simon Luhrs (b.1970) | 1991-1992 / 12g | True |
| 40 | `https://www.draftguru.com.au/players/simon_taylor/1` | confirmed mislink (v1) | random | 1991 Pre-Season | Simon Taylor | Simon Taylor (b.1970) | 1989-1989 / 2g | True |
| 41 | `https://www.draftguru.com.au/players/tim_bourke/1` | confirmed mislink (v1) | random | 1991 Trade | Tim Bourke | Tim Bourke (b.1969) | 1989-1990 / 5g | True |
| 42 | `https://www.draftguru.com.au/players/tony_elshaug/1` | population_clean (v1) | random | 1988 Pre-Season | Tony Elshaug | Tony Elshaug (b.1960) | 1979-1988 / 137g | True |
| 43 | `https://www.draftguru.com.au/players/tony_furey/1` | confirmed mislink (v1) | non_sample | 1988 Pre-Season | Tony Furey | Tony Furey (b.1963) | 1983-1985 / 41g | True |
| 44 | `https://www.draftguru.com.au/players/warren_dean/1` | population_clean (v1) | non_sample | 1989 Pre-Season | Warren Dean | Warren Dean (b.1964) | 1987-1989 / 32g | True |

**23** rows were labelled `confirmed_source_mislink` by the withdrawn v1 scan (all originally-sampled random-stratum or non-sample rows, 0 census); **21** were labelled `population_clean` by v1 and share the identical shape. Both groups are now the SAME neutral class. 0 of the 44 are national-top-10 census rows; the census stratum's 385 clean rows and current 389/420 pick, 387/418 person top-10 reconciliation are unaffected.

## Section 2 -- 2 suspected tokenisation rows (`same_person_valid_href` / `different_person_wrong_href` / `undetermined_withhold`)

Flagged only by a surname-tokenisation limitation in the reused surname-suffix matcher on a compound/diacritic surname; every other signal (birth year, games, club overlap) agrees. Almost certainly the same real, well-known player in both cases.

| DraftGuru URL | DraftGuru name | Captured href | Retained target | Birth year (DG/target) | Games |
|---|---|---|---|---|---|
| `https://www.draftguru.com.au/players/adrian_deluca/1` | Adrian Deluca | `players/A/Adrian_De_Luca.html` | Adrian De Luca | 1982/1982 | 46 |
| `https://www.draftguru.com.au/players/setanta_%C3%B3%20hailp%C3%ADn/1` | Setanta Ó hAilpín | `players/S/Setanta_OhAilpin.html` | Setanta OhAilpin | 1983/1983 | 88 |

## Section 3 -- 7 source discrepancies (`approve_manual_curation` / `reject_candidate` / `undetermined_withhold`)

The captured href resolves to an unregistered path; a bounded, evidence-gated probe found a corroborated ALTERNATE registered identity (numeric-suffix or spelling variant) satisfying the same corroboration bar `offline_strong` requires. D-9 forbids auto-promoting on name equality alone, so the current href-only bridge contract cannot apply this correction automatically -- it requires manual curation.

| DraftGuru URL | Captured href | Corrected identity | Corrected name | Games | Clubs |
|---|---|---|---|---|---|
| `https://www.draftguru.com.au/players/tom_murphy/1` | `players/T/Tom_Murphy.html` | `players/T/Tom_Murphy0.html` | Tom Murphy | 113 | Gold Coast, Hawthorn |
| `https://www.draftguru.com.au/players/joel_smith/1` | `players/J/Joel_Smith.html` | `players/J/Joel_Smith0.html` | Joel Smith | 221 | Hawthorn, St Kilda |
| `https://www.draftguru.com.au/players/josh_smith/1` | `players/J/Josh_Smith.html` | `players/J/Josh_Smith0.html` | Josh Smith | 11 | North Melbourne |
| `https://www.draftguru.com.au/players/stephen_schwerdt/1` | `players/S/Steven_Schwerdt.html` | `players/S/Stephen_Schwerdt.html` | Stephen Schwerdt | 25 | Adelaide |
| `https://www.draftguru.com.au/players/aaron_black/1` | `players/A/Aaron_Black.html` | `players/A/Aaron_Black0.html` | Aaron Black | 57 | Geelong, North Melbourne |
| `https://www.draftguru.com.au/players/alwyn_davey/1` | `players/A/Alwyn_Davey.html` | `players/A/Alwyn_Davey0.html` | Alwyn Davey | 100 | Essendon |
| `https://www.draftguru.com.au/players/sam_butler/1` | `players/S/Sam_Butler.html` | `players/S/Sam_Butler0.html` | Sam Butler | 166 | West Coast |

## Section 4 -- 30-row deterministic audit (`agree` / `contradict` / `undetermined`)

Salt `AFLDB-ISSUE-222/audit-v1`; selection: first 30 of offline_strong rows outside classes 1-10, sha256(salt+"|"+player_url) hex ascending, ties by URL. Drawn once from the `offline_strong` rows outside every other exception class; never redrawn.

| DraftGuru URL | Stratum | DraftGuru name | Retained target | Birth year (DG/target) | Target span/games |
|---|---|---|---|---|---|
| `https://www.draftguru.com.au/players/chad_morrison/1` | random | Chad Morrison | -- | 1978/1978 | 1996-2006 / 169g |
| `https://www.draftguru.com.au/players/ben_speight/1` | random | Ben Speight | -- | 1990/1990 | 2010-2011 / 10g |
| `https://www.draftguru.com.au/players/matt_clape/1` | census | Matt Clape | -- | 1969/1969 | 1992-1998 / 87g |
| `https://www.draftguru.com.au/players/jarrad_mcveigh/1` | census | Jarrad McVeigh | -- | 1985/1985 | 2004-2019 / 325g |
| `https://www.draftguru.com.au/players/jamarra_ugle-hagan/1` | census | Jamarra Ugle-Hagan | -- | 2002/2002 | 2021-2024 / 67g |
| `https://www.draftguru.com.au/players/stephen_coniglio/1` | census | Stephen Coniglio | -- | 1993/1993 | 2012-2025 / 227g |
| `https://www.draftguru.com.au/players/sean_denham/1` | random | Sean Denham | -- | 1969/1969 | 1987-2000 / 186g |
| `https://www.draftguru.com.au/players/zach_reid/1` | census | Zach Reid | -- | 2002/2002 | 2021-2025 / 19g |
| `https://www.draftguru.com.au/players/nick_mitchell/1` | random | Nick Mitchell | -- | 1973/1973 | 1994-1995 / 9g |
| `https://www.draftguru.com.au/players/cameron_venables/1` | random | Cameron Venables | -- | 1975/1976 | 1999-1999 / 3g |
| `https://www.draftguru.com.au/players/jake_stringer/1` | census | Jake Stringer | -- | 1994/1994 | 2013-2025 / 227g |
| `https://www.draftguru.com.au/players/bryce_retzlaff/1` | random | Bryce Retzlaff | -- | 1991/1991 | 2011-2011 / 11g |
| `https://www.draftguru.com.au/players/ken_judge/1` | census | Ken Judge | -- | 1958/1958 | 1983-1988 / 89g |
| `https://www.draftguru.com.au/players/dean_turner/1` | census | Dean Turner | -- | 1959/1960 | 1984-1990 / 110g |
| `https://www.draftguru.com.au/players/jesse_dattoli/1` | random | Jesse Dattoli | -- | 2006/2006 | 2025-2025 / 3g |
| `https://www.draftguru.com.au/players/jeff_white/1` | census | Jeff White | -- | 1977/1977 | 1995-2008 / 268g |
| `https://www.draftguru.com.au/players/matthew_kreuzer/1` | census | Matthew Kreuzer | -- | 1989/1989 | 2008-2020 / 189g |
| `https://www.draftguru.com.au/players/paddy_ryder/1` | census | Paddy Ryder | -- | 1988/1988 | 2006-2022 / 281g |
| `https://www.draftguru.com.au/players/ty_zantuck/1` | random | Ty Zantuck | -- | 1982/1982 | 2000-2005 / 77g |
| `https://www.draftguru.com.au/players/david_ogg/1` | census | David Ogg | -- | 1967/1968 | 1991-1991 / 9g |
| `https://www.draftguru.com.au/players/wayne_hernaman/1` | census | Wayne Hernaman | -- | 1972/1972 | 1993-1994 / 20g |
| `https://www.draftguru.com.au/players/peter_matera/1` | census | Peter Matera | -- | 1969/1969 | 1990-2002 / 253g |
| `https://www.draftguru.com.au/players/will_schofield/1` | random | Will Schofield | -- | 1989/1988 | 2007-2020 / 194g |
| `https://www.draftguru.com.au/players/andrew_purser/1` | census | Andrew Purser | -- | 1958/1959 | 1983-1987 / 112g |
| `https://www.draftguru.com.au/players/daniel_healy/1` | census | Daniel Healy | -- | 1974/1974 | 1996-1999 / 38g |
| `https://www.draftguru.com.au/players/will_hams/1` | random | Will Hams | -- | 1994/1994 | 2013-2016 / 13g |
| `https://www.draftguru.com.au/players/darren_baxter/1` | random | Darren Baxter | -- | 1965/1965 | 1984-1994 / 156g |
| `https://www.draftguru.com.au/players/josh_wooden/1` | random | Josh Wooden | -- | 1978/1979 | 1997-2006 / 96g |
| `https://www.draftguru.com.au/players/darcy_tucker/1` | random | Darcy Tucker | -- | 1997/1997 | 2016-2025 / 156g |
| `https://www.draftguru.com.au/players/tim_taranto/1` | census | Tim Taranto | -- | 1998/1998 | 2017-2025 / 173g |

## Confirmations

- No operator_verdict has been set on any row in any section.
- No network request, database connection, SSH tunnel, Playwright session, import/link action, exporter run, or Git command occurred while producing this pack.
- The parent, afldb_test child, immutable 997-row sample, and all population-scan artefacts (v1 and v2) were read-only inputs; none were modified.
- No bridge v2 dataset was generated. No v2 validation sample was generated.
- Phase 3 remains PENDING operator adjudication. Phase 4 has not begun.
