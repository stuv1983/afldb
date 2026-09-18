# AFLDB-ISSUE-222 -- population-wide offline mislink scan sign-off pack (20260918-v1)

**Phase 3 remains PENDING.** This pack is a bounded, evidence-based screen of all 3,564 parent bridge candidates for the DraftGuru-side mislink mechanism confirmed by the Phase 3 sample review (a zero-game DraftGuru draftee whose captured AFL Tables href resolves to an unrelated, already-retired same-named player). No `operator_verdict` has been set on any row, and nothing here accepts Phase 3, authorises an import, or begins Phase 4.

Scanner: `tools/rebuild/draftguru/scan_person_bridge_population.py` v1.0.0, reusing `tools/rebuild/draftguru/review_person_bridge_offline.py` v1.0.2 for every name/club normalisation, fitzRoy snapshot indexing and corroboration rule.

## 1. Reconciliation and outcome totals

- Total parent bridge candidates: **3564** (expected 3,564).
- `rows_sha256`: `ddd5faba8a292d91b52d5beef86f9aae91dfef0ab2a14dec9ba5894f2968c8c0`

| Outcome | Count |
|---|---|
| `population_clean` | 3422 |
| `confirmed_source_mislink` | 23 |
| `suspected_source_mislink` | 2 |
| `source_discrepancy_same_person` | 7 |
| `insufficient_evidence` | 107 |
| `human_authority_overlap` | 3 |
| `tooling_or_schema_error` | 0 |

## 2. Confirmed source mislinks (recommend exclude_from_bridge)

| DraftGuru URL | Captured href | Source (DraftGuru) evidence | Retained target | Disposition |
|---|---|---|---|---|
| `https://www.draftguru.com.au/players/andrew_krakouer/1` | `players/A/Andrew_Krakouer0.html` | Andrew Krakouer (born 1971), 0 games, 1992 Mid-Season | Andrew Krakouer, birth_year=1971, games=8, span=1989-1990 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/bradley_sparks/1` | `players/B/Bradley_Sparks.html` | Bradley Sparks (born 1967), 0 games, 1990 Pre-Draft | Bradley Sparks, birth_year=1967, games=4, span=1987-1988 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/bret_hutchinson/1` | `players/B/Bret_Hutchinson.html` | Bret Hutchinson (born 1964), 0 games, 1989 Pre-Season | Bret Hutchinson, birth_year=1964, games=1, span=1985-1985 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/chris_o'dwyer/1` | `players/C/Chris_ODwyer.html` | Chris O'Dwyer (born 1971), 0 games, 1992 Pre-Season | Chris ODwyer, birth_year=1971, games=8, span=1990-1991 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/craig_somerville/1` | `players/C/Craig_Somerville.html` | Craig Somerville (born 1968), 0 games, ?  | Craig Somerville, birth_year=1968, games=8, span=1986-1986 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/darren_williams/1` | `players/D/Darren_Williams.html` | Darren Williams (born 1960), 0 games, 1990 Pre-Season | Darren Williams, birth_year=1960, games=109, span=1979-1989 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/david_sullivan/1` | `players/D/David_Sullivan.html` | David Sullivan (born 1966), 0 games, 1989 Pre-Season | David Sullivan, birth_year=1966, games=11, span=1986-1988 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/david_williams/1` | `players/D/David_Williams.html` | David Williams (born 1961), 0 games, 1989 Pre-Season | David Williams, birth_year=1962, games=67, span=1983-1988 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/gary_keane/1` | `players/G/Gary_Keane.html` | Gary Keane (born 1964), 0 games, ?  | Gary Keane, birth_year=1964, games=55, span=1985-1988 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/glen_bartlett/1` | `players/G/Glen_Bartlett.html` | Glen Bartlett (born 1964), 0 games, 1989 Mid-Season | Glen Bartlett, birth_year=1964, games=4, span=1987-1987 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/ian_rickman/1` | `players/I/Ian_Rickman.html` | Ian Rickman (born 1963), 0 games, 1989 Pre-Season | Ian Rickman, birth_year=1963, games=11, span=1982-1984 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/john_ahern/1` | `players/J/John_Ahern.html` | John Ahern (born 1970), 0 games, ?  | John Ahern, birth_year=1970, games=2, span=1989-1989 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/john_peter-budge/1` | `players/J/John_Peter-Budge.html` | John Peter-Budge (born 1968), 0 games, 1990 National | John Peter-Budge, birth_year=1968, games=45, span=1986-1988 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/mark_mcleod/1` | `players/M/Mark_McLeod.html` | Mark McLeod (born 1968), 0 games, 1990 Pre-Season | Mark McLeod, birth_year=1969, games=3, span=1989-1989 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/mark_pitura/1` | `players/M/Mark_Pitura.html` | Mark Pitura (born 1974), 0 games, 1995 Pre-Season | Mark Pitura, birth_year=1974, games=2, span=1993-1993 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/nathan_irvin/1` | `players/N/Nathan_Irvin.html` | Nathan Irvin (born 1973), 0 games, 1994 National | Nathan Irvin, birth_year=1973, games=1, span=1993-1993 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/paul_mifka/1` | `players/P/Paul_Mifka.html` | Paul Mifka (born 1965), 0 games, 1990 Pre-Draft | Paul Mifka, birth_year=1965, games=1, span=1987-1987 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/peter_freeman/1` | `players/P/Peter_Freeman.html` | Peter Freeman (born 1969), 0 games, 1991 National | Peter Freeman, birth_year=1969, games=5, span=1988-1990 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/peter_whyte/1` | `players/P/Peter_Whyte.html` | Peter Whyte (born 1969), 0 games, 1990 National | Peter Whyte, birth_year=1969, games=22, span=1986-1988 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/rodney_gladman/1` | `players/R/Rodney_Gladman.html` | Rodney Gladman (born 1968), 0 games, 1989 Pre-Season | Rodney Gladman, birth_year=1968, games=1, span=1987-1987 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/simon_taylor/1` | `players/S/Simon_Taylor0.html` | Simon Taylor (born 1970), 0 games, 1991 Pre-Season | Simon Taylor, birth_year=1970, games=2, span=1989-1989 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/tim_bourke/1` | `players/T/Tim_Bourke.html` | Tim Bourke (born 1969), 0 games, ?  | Tim Bourke, birth_year=1969, games=5, span=1989-1990 | exclude_from_bridge |
| `https://www.draftguru.com.au/players/tony_furey/1` | `players/T/Tony_Furey.html` | Tony Furey (born 1963), 0 games, 1988 Pre-Season | Tony Furey, birth_year=1963, games=41, span=1983-1985 | exclude_from_bridge |

## 3. Suspected source mislinks (recommend manual_curation)

Note: rows flagged only by `SURNAME_DIFFERENT` with every other signal (birth year, debut timing, games, club overlap) agreeing are very likely the SAME person and a surname-tokenisation limitation (compound/diacritic surnames), not a genuine mislink; see the reason column and confirm from the CSV/JSON before any action.

| DraftGuru URL | Captured href | Source (DraftGuru) evidence | Retained target | Reason | Disposition |
|---|---|---|---|---|---|
| `https://www.draftguru.com.au/players/adrian_deluca/1` | `players/A/Adrian_De_Luca.html` | Adrian Deluca (born 1982), 46 games, 2003 National | Adrian De Luca, birth_year=1982, games=46, span=2004-2006 | OTHER_CONTRADICTION:SURNAME_DIFFERENT | manual_curation |
| `https://www.draftguru.com.au/players/setanta_%C3%B3%20hailp%C3%ADn/1` | `players/S/Setanta_OhAilpin.html` | Setanta Ó hAilpín (born 1983), 88 games, 2003 Rookie | Setanta OhAilpin, birth_year=1983, games=88, span=2005-2013 | OTHER_CONTRADICTION:SURNAME_DIFFERENT | manual_curation |

## 4. Source discrepancy, same person (numbering/spelling; recommend manual_curation)

| DraftGuru URL | Captured href | Corrected identity | Source evidence | Disposition |
|---|---|---|---|---|
| `https://www.draftguru.com.au/players/aaron_black/1` | `players/A/Aaron_Black.html` | `players/A/Aaron_Black0.html` | Aaron Black (born 1990) | manual_curation |
| `https://www.draftguru.com.au/players/alwyn_davey/1` | `players/A/Alwyn_Davey.html` | `players/A/Alwyn_Davey0.html` | Alwyn Davey (born 1984) | manual_curation |
| `https://www.draftguru.com.au/players/joel_smith/1` | `players/J/Joel_Smith.html` | `players/J/Joel_Smith0.html` | Joel Smith (born 1977) | manual_curation |
| `https://www.draftguru.com.au/players/josh_smith/1` | `players/J/Josh_Smith.html` | `players/J/Josh_Smith0.html` | Josh Smith (born 1986) | manual_curation |
| `https://www.draftguru.com.au/players/sam_butler/1` | `players/S/Sam_Butler.html` | `players/S/Sam_Butler0.html` | Sam Butler (born 1986) | manual_curation |
| `https://www.draftguru.com.au/players/stephen_schwerdt/1` | `players/S/Steven_Schwerdt.html` | `players/S/Stephen_Schwerdt.html` | Stephen Schwerdt (born 1968) | manual_curation |
| `https://www.draftguru.com.au/players/tom_murphy/1` | `players/T/Tom_Murphy.html` | `players/T/Tom_Murphy0.html` | Tom Murphy (born 1986) | manual_curation |

## 5. Insufficient evidence and tooling/schema errors

- `insufficient_evidence` total: **107**, by reason: OFFLINE_LIMITED=13, TARGET_NOT_REGISTERED_NO_EVIDENCE=94.
- `tooling_or_schema_error` total: **0**.
- Full per-row list (every row in these two categories, with source/target facts and a blank `operator_verdict`): `bridge-population-scan-20260918-v1.csv` / `.json`.

## 6. Human authority overlap

- 3 row(s) already carry an existing human decision (`draftguru-link-decisions.json`) that is not itself contradicted by retained evidence; the human decision remains authoritative. See CSV/JSON for the list.

## 7. Confirmations

- All 3564 parent bridge candidates reconciled; 0 remaining.
- No `operator_verdict` has been set on any row -- every row's field is blank.
- No network request, database connection, import/link action, Git command, or DEV/PROD action occurred while producing this pack.
- Phase 3 remains **PENDING** operator sign-off. Phase 4 has not begun.
