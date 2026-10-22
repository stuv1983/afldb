# ISSUE-316 C2 raw-linkage explanation — 2026-10-21

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `e0aba8ecc47c48af` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. Its own §11 status block already supersedes the earlier statuses in this file; nothing below changes that. Independent authority for the raw source is not established by this review. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Current result (§11): provenance PASS; parsed linkage verification PASS. All 47 raw match-key nonmatches / 2,162 player rows are club-label representation differences (`GWS` and `Footscray` against `Greater Western Sydney` and `Western Bulldogs`) that the existing canonical resolver maps to one unique canonical results match each. No unexplained discrepancy in the tested linkage dimensions. Owner decisions remain PENDING; production NO-GO.**

*Original headline, kept as history (written before any hash or CSV parse; superseded by §11): "All 47 … are explained as club-label representation differences … Byte-level hash verification was NOT performed (§1), so every finding is conditional on the two consumed CSVs matching their recorded hashes."*

Implementation basis: `4a2eea89cccc465f2f017fb06ad55a7d4cb7733d`, as recorded in the retained rehearsal evidence. No Git or current-HEAD verification was performed by this session. One agent, bounded offline explanation authorised by the owner for [field worksheet §3](issue316-c2-field-review-2026-10-21.md). This is an evidence record, not an accepted contract, register entry, field acceptance or production acceptance. Only Read/Grep/Glob and file-editing tools were used; no script, resolver or importer was executed. The target file was absent before work.

> **CURRENT STATUS (2026-10-21, provenance-reconciliation session; supersedes the status block below and §10's drift and BLOCKED conclusions where they conflict — see §11).** Provenance: **PASS**. The consumed rehearsal `clubs.json` and `import_fitzroy_core.py` are byte-identical to the blobs of commit `4a2eea89…` and to the retained bundle inventory; the repository contract and the hash-bound rehearsal-only contract are separate, individually bound artifacts, so §10's "drift" is withdrawn. Parsed linkage verification: **PASS** (§11.5) for all 47 keys / 2,162 rows. Correction to §5 finding 5: the empty-`Player` cells inside the 2,162 rows number **9**, not 1 (§11.6). Everything else in §3–§5 stands as the earlier Grep reading, now confirmed by the parsed result in the dimensions listed in §11.5. Quarter scores and other field measurements remain out of scope; all field, availability and Brownlow decisions remain PENDING.
>
> **Superseded status (hash-verification session; kept as history — see §10).** Hash binding: **FAIL (drift on one cited policy file; two policy files have no recorded binding)**. Both consumed CSVs and the bound S-tree contract and manifest match their recorded SHA-256 exactly. The parsed linkage verification was **NOT performed (BLOCKED)**. Everything in §3–§5 remains the earlier **unverified, conditional, Grep-based** explanation and must not be cited as verified. The §1 claim that the repository `fitzroy-contract.json` could be equated with the implementation basis is **withdrawn** (§10).

## 1. Consumed inputs and hash status

*(Historical, written before any hash was computed. The "Bytes re-hashed: No" column and "no drift was observed" wording are superseded by §10.)*

`R` = `C:/tmp/afldb-c2-brownlow-fix-20261021/`; `S` = `R/REHEARSAL-ONLY-source/`; `D` = `S/data/sources/afltables/fitzroy_core/c2-2026-final-core-v1/`.

**Limitation (blocking for a "verified" claim):** this session had no native capability to compute SHA-256, and execution was not authorised. The recorded hashes below were compared with each other (worksheet vs manifest entry vs `SHA256SUMS.txt`) but **the bytes of the consumed files were not re-hashed**. No drift was observed, but no drift check was possible. Findings must be treated as conditional until the operator-run command at the end of this section reports matching hashes.

| Consumed input | Recorded SHA-256 | Recorded-to-recorded check | Bytes re-hashed |
|---|---|---|---|
| D/results.csv (17,056 rows; 218 in 2026) | `73769e3ef608103c6c4e7ac6f58ce82484f85bd8058955ec502a9d64cb834f52` | Manifest entry (`row_count` 17056) equals worksheet §2 | **No** |
| D/player_stats_2026.csv (10,028 rows) | `79db69732ea1018b577e548622e6c702c1a79270478cc019dc80571fc217898f` | Manifest entry (`row_count` 10028) equals worksheet §2 | **No** |
| S/docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json | `02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988` (worksheet §2) | Read only for the entries above | **No** |
| R/SHA256SUMS.txt | observed `d00d0193…bac7e` per worksheet §2 | Read in full; its four R-output lines equal worksheet §2 | **No** |
| S/data/reference/clubs.json, S/tools/migration/import_fitzroy_core.py | not recorded in any consumed document | Alias-line count (3) and the four key code lines (181, 381, 458, 464) equal the repository copies | **No** |
| Repository `tools/migration/import_fitzroy_core.py`, `data/reference/clubs.json`, `tools/rebuild/fitzroy/fitzroy-contract.json` | not applicable (working tree) | The session-start git status snapshot lists no modification to these paths; that snapshot, not an executed command, is the only basis for equating them with the implementation basis | **No** |

Not consumed or relied on: the offline-analysis outputs, retained scripts, `repository-files.json` contents (searched, no hashes found), the other 128 player-stats files, the historical results prefix, the ladder CSV, any database or host. Completed import/D7/rehearsal evidence is reused as described in the worksheet and was not rerun.

**Operator command to close the gap (one PowerShell call; compare against the table, and for clubs.json/importer compare the S and repository copies with each other):**

```powershell
$D='C:\tmp\afldb-c2-brownlow-fix-20261021\REHEARSAL-ONLY-source'; Get-FileHash -Algorithm SHA256 -LiteralPath "$D\data\sources\afltables\fitzroy_core\c2-2026-final-core-v1\results.csv","$D\data\sources\afltables\fitzroy_core\c2-2026-final-core-v1\player_stats_2026.csv","$D\data\reference\clubs.json","D:\dev\afldbV2\data\reference\clubs.json","$D\tools\migration\import_fitzroy_core.py","D:\dev\afldbV2\tools\migration\import_fitzroy_core.py" | Format-Table Hash,Path -AutoSize
```

Any mismatch on the two CSVs invalidates this review (stop); a mismatch between the S and repository copies of `clubs.json` or the importer means §3's code trace must be redone against the S copy.

## 2. Relevant code locations (repository working tree, line numbers as read)

| Purpose | Location |
|---|---|
| Canonical club resolution (alias set, era remap, source rules) | `tools/migration/import_fitzroy_core.py` `ClubResolver`, lines 345–476; alias set 372–378; source-rule precedence 450–456; ordinary alias lookup 458–461; era-organisation remap 462–471 |
| Results round normalisation (`R12` -> `12`; finals codes) | same file, `normalise_results_round` 1229–1237; `FINALS_CODES` 166–173 |
| Stats round normalisation (exact alias `Wildcard Final` -> `WF`) | same file, `STATS_ROUND_ALIASES` 180–182; `normalise_stats_round` 1240–1249 |
| Canonical match identity (results side) | same file, `results_identity` 1252–1280; `interpret_results_row` 1307–1366, including the **duplicate-canonical-key refusal** at 1350–1354; `match_key_of` 1896–1900 (`season|round_code|date|home name|away name`) |
| Stats-to-results join and cross-checks | same file, `scan_player_stats` 1576–1607: join on `(date, home identity, away identity)` using `Home.team`/`Away.team`; round, `Home.score`/`Away.score`, `Venue` compared with the results match; `Playing.for` must be one of the two sides. `player_match_identity` 1504–1533 uses the same key |
| `Team` column | Not read by the importer (no `"Team"` reference in the file); it takes no part in the join |
| Club identities and aliases | `data/reference/clubs.json`: line 11 `Footscray` (era 1925–1996, successor `Western Bulldogs`); line 15 `Greater Western Sydney` (`short_name` and `abbreviation` `GWS`, era 2012–); line 27 `Western Bulldogs` (era 1997–) |
| Source-scoped normalisation rules | `tools/rebuild/fitzroy/fitzroy-contract.json` 141–174: only Brisbane Lions 1987–1996 and North Melbourne (results/ladder) 1999–2007. **None applies to 2026**, so the ordinary alias/era rule decides |

## 3. Raw-to-canonical relationship

Resolver trace for season 2026, read from the code above (not executed):

| Raw string | Where it occurs (2026) | Resolution | Canonical identity / name |
|---|---|---|---|
| `GWS` | results `Home.Team`/`Away.Team`; stats `Team` column | `alias_to_hist["GWS"]` = `Greater Western Sydney` (`short_name`/`abbreviation`); era 2012+ contains 2026, so direct | `Greater Western Sydney` |
| `Greater Western Sydney` | stats `Home.team`, `Away.team`, `Playing.for` | `hist`/`name` alias; same identity | `Greater Western Sydney` |
| `Footscray` | results `Home.Team`/`Away.Team`; stats `Team` column | alias to identity `Footscray`, whose era (1925–1996) excludes 2026; `_terminal` follows successor to `Western Bulldogs`; the organisation's members are `Footscray` and `Western Bulldogs`; exactly one (`Western Bulldogs`, 1997+) contains 2026 | `Western Bulldogs` |
| `Western Bulldogs` | stats `Home.team`, `Away.team`, `Playing.for` | direct alias, era contains 2026 | `Western Bulldogs` |

Both aliases are unique in `clubs.json` (the `GWS` and `Footscray` strings each appear on a single identity line; the constructor refuses cross-identity alias conflicts at 373–377, and the completed import loaded it). The era remap yields exactly one candidate, so it is neither missing nor ambiguous. No guessed alias, new rule or name-based inference was used: every mapping above is an existing `clubs.json` alias or the existing era rule.

**Label inventory, 2026 (row counts by pattern-anchored column position):**

| Column | `GWS` / `Footscray` | `Greater Western Sydney` / `Western Bulldogs` |
|---|---|---|
| results `Home.Team` | 12 / 12 matches | 0 / 0 |
| results `Away.Team` | 11 / 13 matches | 0 / 0 |
| stats `Home.team` | 0 / 0 rows | 552 rows (12 matches) / 552 rows (12 matches) |
| stats `Away.team` | 0 / 0 rows | 506 rows (11 matches) / 598 rows (13 matches) |
| stats `Playing.for` | 0 / 0 rows | 529 rows / 575 rows |
| stats `Team` | 529 rows / 575 rows | 0 / 0 rows |

So the results file and the stats `Team` column use `GWS`/`Footscray`, while the stats match columns (`Home.team`, `Away.team`, `Playing.for`) use `Greater Western Sydney`/`Western Bulldogs`. Within a stats row, `Playing.for` and `Team` therefore differ textually for these two clubs although they resolve to one identity.

## 4. Complete exception accounting

Results matches involving `GWS`: 23 (12 home + 11 away). Involving `Footscray`: 25 (12 home + 13 away). One match involves both (Game 16846). 23 + 25 − 1 = **47 distinct canonical keys**. Stats rows: GWS-involved 23 × 46 = 1,058; Bulldogs-involved 25 × 46 = 1,150; shared 46; 1,058 + 1,150 − 46 = **2,162 rows**, equal to the worksheet's unmatched total. The remaining 171 keys / 7,866 rows (218 − 47; 171 × 46) are those the worksheet already matched exactly; they were not re-measured.

Method per key: one anchored count of stats rows whose Season/Round/Date/Venue, `Home.team` label, `Home.score`, `Away.team` label and `Away.score` equal the results row (labels per §3, round per §2), and in which `Playing.for` is the home-side label with `Home.Away` = `Home`, or the away-side label with `Home.Away` = `Away`. **Every one of the 47 returned exactly 46** (so no key has missing, extra or duplicate rows; no second group shares any key).

`Rnd` = results Round -> stats Round -> canonical round code. `Canonical home | away` is the `match_key` tail (`2026|code|date|home|away`) and equals the stats raw `Home.team | Away.team` in all 47. Score = results Home.Points–Away.Points (equal to stats `Home.score`–`Away.score` on all 46 rows of each key).

| # | Game | Date | Rnd | Results raw home v away | Canonical home \| away | Score | Venue (results = stats) | Rows |
|---:|---:|---|---|---|---|---|---|---:|
| 1 | 16841 | 2026-03-07 | R1->1->1 | GWS v Hawthorn | Greater Western Sydney \| Hawthorn | 122–95 | Sydney Showground | 46 |
| 2 | 16842 | 2026-03-07 | R1->1->1 | Brisbane Lions v Footscray | Brisbane Lions \| Western Bulldogs | 106–111 | Gabba | 46 |
| 3 | 16846 | 2026-03-14 | R2->2->2 | Footscray v GWS | Western Bulldogs \| Greater Western Sydney | 134–53 | Docklands | 46 |
| 4 | 16854 | 2026-03-20 | R3->3->3 | Adelaide v Footscray | Adelaide \| Western Bulldogs | 88–94 | Adelaide Oval | 46 |
| 5 | 16856 | 2026-03-21 | R3->3->3 | GWS v St Kilda | Greater Western Sydney \| St Kilda | 74–78 | Sydney Showground | 46 |
| 6 | 16861 | 2026-03-27 | R4->4->4 | Collingwood v GWS | Collingwood \| Greater Western Sydney | 87–54 | Docklands | 46 |
| 7 | 16873 | 2026-04-05 | R5->5->5 | Footscray v Essendon | Western Bulldogs \| Essendon | 99–65 | Docklands | 46 |
| 8 | 16880 | 2026-04-11 | R6->6->6 | Hawthorn v Footscray | Hawthorn \| Western Bulldogs | 104–64 | Adelaide Oval | 46 |
| 9 | 16882 | 2026-04-12 | R6->6->6 | GWS v Richmond | Greater Western Sydney \| Richmond | 131–75 | Barossa Park | 46 |
| 10 | 16886 | 2026-04-17 | R7->7->7 | Sydney v GWS | Sydney \| Greater Western Sydney | 107–66 | S.C.G. | 46 |
| 11 | 16885 | 2026-04-17 | R7->7->7 | Geelong v Footscray | Geelong \| Western Bulldogs | 131–56 | Kardinia Park | 46 |
| 12 | 16893 | 2026-04-23 | R8->8->8 | Footscray v Sydney | Western Bulldogs \| Sydney | 60–126 | Docklands | 46 |
| 13 | 16901 | 2026-04-26 | R8->8->8 | GWS v North Melbourne | Greater Western Sydney \| North Melbourne | 105–98 | Manuka Oval | 46 |
| 14 | 16903 | 2026-05-01 | R9->9->9 | Footscray v Fremantle | Western Bulldogs \| Fremantle | 102–114 | Docklands | 46 |
| 15 | 16910 | 2026-05-03 | R9->9->9 | Gold Coast v GWS | Gold Coast \| Greater Western Sydney | 83–63 | Carrara | 46 |
| 16 | 16913 | 2026-05-08 | R10->10->10 | Port Adelaide v Footscray | Port Adelaide \| Western Bulldogs | 72–74 | Adelaide Oval | 46 |
| 17 | 16915 | 2026-05-09 | R10->10->10 | GWS v Essendon | Greater Western Sydney \| Essendon | 103–89 | Sydney Showground | 46 |
| 18 | 16925 | 2026-05-16 | R11->11->11 | Carlton v Footscray | Carlton \| Western Bulldogs | 74–62 | Docklands | 46 |
| 19 | 16928 | 2026-05-17 | R11->11->11 | West Coast v GWS | West Coast \| Greater Western Sydney | 88–71 | Perth Stadium | 46 |
| 20 | 16936 | 2026-05-24 | R12->12->12 | GWS v Brisbane Lions | Greater Western Sydney \| Brisbane Lions | 166–88 | Sydney Showground | 46 |
| 21 | 16937 | 2026-05-24 | R12->12->12 | Footscray v Melbourne | Western Bulldogs \| Melbourne | 93–90 | Docklands | 46 |
| 22 | 16942 | 2026-05-30 | R13->13->13 | Footscray v Collingwood | Western Bulldogs \| Collingwood | 97–93 | Docklands | 46 |
| 23 | 16943 | 2026-05-31 | R13->13->13 | Melbourne v GWS | Melbourne \| Greater Western Sydney | 70–119 | Traeger Park | 46 |
| 24 | 16946 | 2026-06-05 | R14->14->14 | Hawthorn v Footscray | Hawthorn \| Western Bulldogs | 71–77 | M.C.G. | 46 |
| 25 | 16953 | 2026-06-11 | R15->15->15 | Footscray v Adelaide | Western Bulldogs \| Adelaide | 64–121 | Docklands | 46 |
| 26 | 16959 | 2026-06-14 | R15->15->15 | St Kilda v GWS | St Kilda \| Greater Western Sydney | 96–88 | Docklands | 46 |
| 27 | 16963 | 2026-06-20 | R16->16->16 | GWS v Carlton | Greater Western Sydney \| Carlton | 65–88 | Sydney Showground | 46 |
| 28 | 16966 | 2026-06-21 | R16->16->16 | St Kilda v Footscray | St Kilda \| Western Bulldogs | 61–83 | Docklands | 46 |
| 29 | 16968 | 2026-06-26 | R17->17->17 | Hawthorn v GWS | Hawthorn \| Greater Western Sydney | 96–82 | M.C.G. | 46 |
| 30 | 16975 | 2026-07-03 | R18->18->18 | Sydney v Footscray | Sydney \| Western Bulldogs | 90–55 | S.C.G. | 46 |
| 31 | 16978 | 2026-07-04 | R18->18->18 | GWS v Fremantle | Greater Western Sydney \| Fremantle | 109–88 | Manuka Oval | 46 |
| 32 | 16986 | 2026-07-11 | R19->19->19 | GWS v Geelong | Greater Western Sydney \| Geelong | 86–73 | Sydney Showground | 46 |
| 33 | 16989 | 2026-07-12 | R19->19->19 | Footscray v West Coast | Western Bulldogs \| West Coast | 86–70 | Docklands | 46 |
| 34 | 16999 | 2026-07-19 | R20->20->20 | Gold Coast v Footscray | Gold Coast \| Western Bulldogs | 68–77 | Carrara | 46 |
| 35 | 17000 | 2026-07-19 | R20->20->20 | Essendon v GWS | Essendon \| Greater Western Sydney | 67–64 | Docklands | 46 |
| 36 | 17006 | 2026-07-25 | R21->21->21 | GWS v Sydney | Greater Western Sydney \| Sydney | 88–139 | Sydney Showground | 46 |
| 37 | 17007 | 2026-07-25 | R21->21->21 | Footscray v Richmond | Western Bulldogs \| Richmond | 105–48 | Docklands | 46 |
| 38 | 17011 | 2026-07-31 | R22->22->22 | Fremantle v Footscray | Fremantle \| Western Bulldogs | 78–41 | Perth Stadium | 46 |
| 39 | 17014 | 2026-08-01 | R22->22->22 | Port Adelaide v GWS | Port Adelaide \| Greater Western Sydney | 63–75 | Adelaide Oval | 46 |
| 40 | 17019 | 2026-08-06 | R23->23->23 | Footscray v North Melbourne | Western Bulldogs \| North Melbourne | 77–100 | Docklands | 46 |
| 41 | 17025 | 2026-08-09 | R23->23->23 | GWS v Gold Coast | Greater Western Sydney \| Gold Coast | 77–79 | Manuka Oval | 46 |
| 42 | 17034 | 2026-08-16 | R24->24->24 | GWS v West Coast | Greater Western Sydney \| West Coast | 111–57 | Sydney Showground | 46 |
| 43 | 17035 | 2026-08-16 | R24->24->24 | Footscray v Carlton | Western Bulldogs \| Carlton | 82–82 | Docklands | 46 |
| 44 | 17040 | 2026-08-22 | R25->25->25 | Melbourne v Footscray | Melbourne \| Western Bulldogs | 87–108 | M.C.G. | 46 |
| 45 | 17042 | 2026-08-22 | R25->25->25 | Adelaide v GWS | Adelaide \| Greater Western Sydney | 157–101 | Adelaide Oval | 46 |
| 46 | 17046 | 2026-08-28 | WF->Wildcard Final->WF | Footscray v Collingwood | Western Bulldogs \| Collingwood | 96–93 | M.C.G. | 46 |
| 47 | 17051 | 2026-09-05 | EF->EF->EF | Adelaide v Footscray | Adelaide \| Western Bulldogs | 90–68 | Adelaide Oval | 46 |
| | | | | | | | **Total** | **2,162** |

Key 1 is the worksheet's example (`2026|2026-03-07|Greater Western Sydney|Hawthorn`, stats Round `1`). Key 46 is the WF fixture; its `Wildcard Final` -> `WF` step is the existing exact alias at `STATS_ROUND_ALIASES`, and WF keeps its empty `Round.Number` (no numeric round invented). The other WF fixture (Melbourne v Carlton, 2026-08-29) involves neither club and is among the 171 exact matches.

## 5. Findings

1. **Representation, not identity.** The 47 keys differ from the results keys only in the club label for two clubs: `GWS` vs `Greater Western Sydney`, and `Footscray` vs `Western Bulldogs`. Both pairs resolve to one canonical identity through the existing `clubs.json` alias set and era rule; no source-scoped rule is involved. The R-prefix and `Wildcard Final` round differences already recorded in the worksheet apply on top and are also existing normalisation.
2. **No missing, duplicate or ambiguous mapping.** Each of the 47 canonical results keys has exactly one stats group of 46 rows; no stats group in the long-label columns lacks a results key (the 2,162 rows are fully consumed by the 47 keys); the importer refuses duplicate canonical results keys (1350–1354) and the alias/era lookups are unique (§3).
3. **Score, venue and orientation agree for all 2,162 rows** (previously untested): date, round, venue, `Home.score`, `Away.score`, `Home.team` and `Away.team` orientation against the results row, and `Playing.for` against `Home.Away` (each row matched the home-side or away-side alternative; the 23/23 split was not separately counted, but the per-club `Playing.for` totals 529 and 575 are exactly 23 per match).
4. **`Team` agrees with `Playing.for` on all 10,028 stats rows** under the same mapping: sixteen other clubs' `Playing.for` = `Team` row counts sum to 8,924, plus 529 (`Greater Western Sydney`/`GWS`) and 575 (`Western Bulldogs`/`Footscray`) = 10,028. This covers the 2,162 rows as a subset. `Team` is not read by the importer.
5. **One non-linkage observation, preserved:** the away-side `Greater Western Sydney` group has 505 rows when `Player` is required to be a quoted string and 506 when an unquoted empty `Player` is allowed, so one row among these 2,162 has an unquoted empty `Player` cell. This is consistent with the 71 known empty-Player rows in the worksheet, was not located to a specific key, and does not affect the join (the importer keys player identity on `url`, not name). No identity was inferred.
6. **Genuine unexplained discrepancies in the tested dimensions: none.** Nothing was repaired, dropped, aliased or reinterpreted.

## 6. Remaining limitations

- Hash bytes were not re-verified (§1); all findings are conditional on that.
- Counts are anchored-pattern measurements with Grep, not a CSV parser. They assume the column order in the 2026 stats header and that name fields before `Playing.for` contain no embedded commas; the structural cross-checks (552 = 12 × 46, 506 = 11 × 46, 598 = 13 × 46, 529 = 23 × 23, 575 = 25 × 23, per-club totals summing to 10,028) support that assumption but do not prove it for every cell.
- The resolver mapping was established by reading the code and `clubs.json`, not by executing them. Execution evidence is the completed import/D7 rehearsal reused from the worksheet, which was not rerun and not re-opened.
- The 171 exactly matched keys, quarter/extra-time scores, start time, attendance, biography, officials, details and Brownlow checks listed as untested in the worksheet were not touched.
- Internal consistency only: no independent publisher or external factual verification of any 2026 result, score or label was attempted or implied.
- This explains why the raw test fails; it does not decide whether the successor contract should record the label difference, and no policy was changed.

## 7. Decisions still pending

All worksheet §4 family and §5 availability decisions, the height/dependent-stage applicability choice, `Last`/details-Goals semantics and every external-evidence decision remain **PENDING**; none is accepted, rejected or inferred by this review. All three 2026 Brownlow keys stay pending; AFL API authority and the existing eligibility and ownership restrictions are unchanged. No successor binding, active reference, date, data, 1,640 production acceptance or rollover state changed.

## 8. Next bounded proposal

Operator runs the §1 hash command and returns the output; on any CSV mismatch stop. If hashes match, the owner may record the worksheet §4 results/linkage row decision using this review as evidence. The next separately authorised offline step would be the worksheet's untested quarter-score reconciliation (cumulative versus incremental interpretation, Q4 versus final score, per-match repetition agreement) over the 218 match groups. That step needs a runnable parser; this session's native-tools-only boundary cannot do it, so it requires explicit authority for an in-process script or equivalent.

## 9. Retention and validation

Writes in this session: this review and narrow current-link/next-action updates in `IssuesIndex.md`, `issues.md`, `issues/open/AFLDB-ISSUE-316.md` and `docs/v2/issue316-c2-preparation-2026-10-21.md`. Original evidence, source bytes and the unrelated `.codex/` directory were not touched. No shell, Git, network, host, database, WSL, installation, acquisition, census, import/rebuild, comparison rerun, rehearsal rerun, cleanup, commit, push or deployment was used. Validation is limited to the recorded-hash comparisons in §1 and the anchored counts above; no tests or build apply to documentation-only writes. No CHANGELOG entry (investigation-only). ISSUE-316 remains OPEN and production NO-GO.

## 10. Hash-binding verification and stop — 2026-10-21 (later session; supersedes §1 wording and the §8 operator command)

**Result: hash binding FAIL (drift + unsupported bindings) → parsed linkage verification BLOCKED, not run.**

**Authority and method.** Owner authorised a bounded local hash-and-CSV verification, one agent, local script execution solely for these checks, no dependency installation. Node v22.21.0 built-in `node:crypto` SHA-256 over the raw bytes (`readFileSync`) of each file, compared by string equality with the exact binding recorded in the decision package, field worksheet §2 or the retained inventory. Two scratch scripts, kept outside the repository (session scratchpad: `hash-check.mjs`, `contract-diff.mjs`), read files only and wrote nothing. No CSV was parsed, because the stop condition fired first.

| File | Actual SHA-256 | Recorded binding (source) | Result |
|---|---|---|---|
| D/results.csv | `73769e3e…834f52` | `73769e3ef608103c6c4e7ac6f58ce82484f85bd8058955ec502a9d64cb834f52` (decision package; worksheet §2; manifest) | **MATCH** |
| D/player_stats_2026.csv | `79db6973…17898f` | `79db69732ea1018b577e548622e6c702c1a79270478cc019dc80571fc217898f` (same sources) | **MATCH** |
| S/…/c2-2026-final-core-v1.json (manifest) | `02bbcf93…cf9988` | `02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988` (decision package) | **MATCH** |
| S/tools/rebuild/fitzroy/fitzroy-contract.json | `a0c01bc2…b053cfb8` | `a0c01bc285b98c902d2a64b37ded687d2ac552cb71edc5bf9cc6459a7053cfb8` (decision package, "test-only contract", provenance only) | **MATCH** |
| **Repository** `tools/rebuild/fitzroy/fitzroy-contract.json` | `e4001a8d3a9ec3afb936f9c09cabf5921cd203978c4061465655d2b756e7a466` | none recorded for the repository copy; the only recorded hash is `a0c01bc2…` above | **DRIFT / unsupported binding** |
| R/SHA256SUMS.txt | `d00d0193…bac7e` | `d00d0193e958864eb997c7f749f1c4d3c73bfd626c01094125b22eb2be7bac7e` (worksheet §2 observation only, not an independent anchor) | matches the observation |
| Every file listed inside R/SHA256SUMS.txt | recomputed | the inventory's own line for each | all listed entries **MATCH**; none DRIFT, ABSENT or unparsed |
| S/data/reference/clubs.json | `9aaa8d4688206d03b0960bd03dcda199a642c5f7343570cc8bc2d439f5674f32` | **none recorded** in any consumed document or in R/REPORT.md, R/SHA256SUMS.txt, the candidate/rebuild JSON or the decision package | **NO BINDING** |
| Repository `data/reference/clubs.json` | same `9aaa8d46…` | none recorded | NO BINDING; byte-identical to the S copy |
| S/tools/migration/import_fitzroy_core.py | `4786d336349170bce6b210fceeb6f72de79d8eebc1471b79e25a8f9e18e75cc5` | **none recorded** (R/REPORT.md line 143 only lists the path as a changed file) | **NO BINDING** |
| Repository `tools/migration/import_fitzroy_core.py` | same `4786d336…` | none recorded | NO BINDING; byte-identical to the S copy |

No binding was manufactured: the three hashes marked NO BINDING are observations, not acceptances, and the S-versus-repository equality of `clubs.json` and the importer is a relationship between two copies, not evidence that either is the policy the rehearsal governed on.

**Why this stops the run.** The instruction was to stop on drift or an unsupported policy binding. (1) The repository `fitzroy-contract.json` has a different hash from the only recorded contract binding. A narrow characterisation shows it is materially a different file: 392 lines in the repository versus 636 in the bound S copy, with the S copy carrying content (for example a `source_row_corrections` block at its start) that the repository line set lacks. No further diff analysis was done. (2) The two files that actually define canonical club resolution, `clubs.json` and `import_fitzroy_core.py`, have no recorded binding at all, so the identity policy for the planned verification is unsupported by any exact retained binding. Either condition alone triggers the stop.

**Corrections to current claims in this review (the earlier text is kept above as history):**

1. §1, "No drift was observed, but no drift check was possible" and every "Bytes re-hashed: No" cell: a drift check is now done. The two CSVs, the manifest and the S-tree contract match. The repository contract does not.
2. §1 row 20 and the statement that the session-start git status snapshot was a basis for equating the repository `fitzroy-contract.json` with the implementation basis: **withdrawn**. The file's actual hash differs from the only recorded contract binding, and this session did not run Git, so no statement about why (working-tree change, later commit or the test-only provenance of the bound copy) is made.
3. §2 row "Source-scoped normalisation rules" (`fitzroy-contract.json` 141–174, Brisbane Lions 1987–1996 and North Melbourne 1999–2007, "none applies to 2026"): those line numbers were read from the **repository** copy, which is not the bound file. The claim is **unverified** against the bound S contract, and nothing here shows the two copies carry the same source-scoped rules.
4. §3 "every mapping above is an existing `clubs.json` alias or the existing era rule", §5 finding 1 and the headline: these still rest on an unbound `clubs.json` and importer that were read, not executed. They remain a **conditional reading**, not a verified resolver result.
5. §5 findings 2–4 and the §4 per-key table (47 keys, 46 rows each, score, venue and orientation, `Team` equals `Playing.for`) remain **unverified Grep measurements** (§6 limitations unchanged). Specifically unaddressed because the parser step did not run: unique canonical fixture correspondence beyond row count, the raw-versus-canonical meaning of `Team` equalling `Playing.for` given that `Team` carries `GWS`/`Footscray` while `Playing.for` carries `Greater Western Sydney`/`Western Bulldogs`, and the location of the one empty `Player` cell. Finding 4's phrase "agrees … on all 10,028 rows" should be read as agreement **under the proposed canonical mapping**, not raw string equality, which §3's own label inventory contradicts for 1,104 rows; that wording was imprecise in the original and is corrected here.
6. §8 "Operator runs the §1 hash command": **superseded**. The CSV, manifest and S-contract hashes are now computed and match; the operator command is no longer needed for them.

**Next bounded proposal.** Owner decision on policy-binding scope, then, if authorised, rerun this parsed linkage verification (same method, same rules). Specifically the owner chooses one of: (a) bind the S-tree `clubs.json` (`9aaa8d46…`) and `import_fitzroy_core.py` (`4786d336…`) as the identity-policy files this review is conditional on, as a record-only provenance binding, and bind the S-tree contract `a0c01bc2…` as the only contract relied on (dropping the repository contract from the claim); or (b) supply different retained bindings. Either choice is the owner's; nothing was bound here. The parsed verification's scope is unchanged (47 keys / 2,162 rows, `Team` canonical equivalence, empty `Player` cell location). Quarter scores and other field measurements remain out of scope. All field, availability and Brownlow decisions remain PENDING; the three 2026 Brownlow keys stay pending and AFL API authority, eligibility and ownership restrictions are unchanged. No source, policy, binding, active reference, data, 1,640 acceptance or rollover state changed.

## 11. Provenance reconciliation and parsed linkage verification — 2026-10-21 (later session; supersedes §10's FAIL/BLOCKED conclusions)

**Provenance: PASS. Parsed linkage verification: PASS.** One agent, owner-authorised bounded offline work. Method: Python 3.12.10 (`-I -B`, standard library only) for hashing, `tarfile` inspection and `csv` parsing; read-only Git (`ls-tree`, `cat-file`, `rev-parse`) against the exact local commit; scratch scripts `prov.py`, `cdiff.py`, `cdiff2.py` and `link.py` in the session scratchpad, outside the repository, which read files and wrote only scratch output. The importer was neither run nor imported: its `ClubResolver`, round normalisation, results interpretation and stats join (lines read from the bound copy) were transcribed into the scratch script. No Git mutation, network, host, database, WSL, install, gate, rebuild, D7 or rehearsal. `R` = `C:/tmp/afldb-c2-brownlow-fix-20261021/`, `S` = `R/REHEARSAL-ONLY-source/`.

### 11.1 Evidence chain for the consumed `clubs.json` and `import_fitzroy_core.py`

**Previously retained records** (written by the rehearsal session, not by this one):

| Record | What it says |
|---|---|
| `R/REPORT.md` | Implementation commit `4a2eea89…`; original executable source verified against that commit, with only explicitly labelled rehearsal test contract/register bindings in the isolated copy; source bundle SHA-256 `73cb5dcd…716bd`; per-file source/input hashes retained |
| `R/SHA256SUMS.txt` | `source-implementation.tar` `1757813c…`, `privileges-source.tar` `665923ce…`, `candidate-bundle.tar.gz` `73cb5dcd…`, `run-config.json`, `candidate-prepared.json` and the preparation scripts |
| `R/run-config.json` | `commit`, `bundle_sha256`, `source_manifest_sha256` `b4a407b3…bdfc`, `verified_original_source_files` 524 |
| `R/candidate-prepared.json` | Rehearsal-only `contract_sha256` `a0c01bc2…53cfb8` and `register_sha256` `f05a069d…7b80` |
| `R/dev-logs/source-verification.json` | DEV run: `verified_files` 792, same bundle and inventory hashes, same commit. `run-dev.py` lines 85–95 assert the bundle hash, the inventory hash, then every one of the 792 inventory hashes against the extracted DEV tree before this file is written |
| `R/bundle-candidate.py` | Contains the assertion that every `source-implementation.tar` file except the two named test-only files hashes equal to the extracted source tree. That the script reached it is inferred from the bundle and inventory it goes on to write; `finish-bundle-config.py` only counts files (524) and does not itself verify |

**Newly measured this session** (these are measurements, not previously recorded bindings):

| Measurement | Result |
|---|---|
| Retained artefacts against their `SHA256SUMS.txt` lines (the 8 above) | all equal |
| `source-implementation.tar` | pax global-header comment `4a2eea89cccc465f2f017fb06ad55a7d4cb7733d` (the signature `git archive` writes); 526 files; no symlinks or hard links |
| Commit `4a2eea89…` (local; equals current `HEAD`) | 2,290 blobs hashed in-process; **all 526 archive files equal their commit blob; 0 differ** |
| `privileges-source.tar` | 1 file, `tools/maintenance/privileges.sql`, equal to its commit blob |
| `candidate-bundle.tar.gz` | 793 files = 792 inventory entries + `SOURCE_SHA256SUMS.json`; inventory SHA-256 equals `run-config.json` `source_manifest_sha256`; **0 inventory-versus-bundle mismatches**; bundle SHA-256 equals `run-config.json` |
| Local tree `S` now against the inventory | 793 files; 0 changed, 0 missing, 0 unlisted |
| Bundle against the commit | 525 identical (524 from the archive + `privileges.sql`); **2 differ — the named test-only contract and register**; 266 added (`REHEARSAL-ONLY.txt`, the inventory, 132 core and 130 ladder acquisition files, 2 manifests). The commit holds 2,290 files; the bundle carries 525 of them |
| `data/reference/clubs.json` | `9aaa8d4688206d03b0960bd03dcda199a642c5f7343570cc8bc2d439f5674f32` in the commit blob, archive, bundle member, inventory, local `S` and the repository working tree |
| `tools/migration/import_fitzroy_core.py` | `4786d336349170bce6b210fceeb6f72de79d8eebc1471b79e25a8f9e18e75cc5` in all six places |
| `results.csv`, `player_stats_2026.csv`, core manifest | inventory entries equal the recorded `73769e3e…`, `79db6973…`, `02bbcf93…`; bytes re-hashed in-script |

The consumed DEV tree is tied to local `S` through the retained DEV assertion (bundle hash, inventory hash, 792 file hashes) and the 0-mismatch inventory-to-bundle result above. DEV host bytes themselves were not re-read (no host access). The `git archive` command line itself was not retained; the pax comment plus blob-for-blob equality is the evidence instead.

### 11.2 Two contracts, two provenances

| Artifact | SHA-256 | Provenance |
|---|---|---|
| Repository contract `tools/rebuild/fitzroy/fitzroy-contract.json` | `e4001a8d3a9ec3afb936f9c09cabf5921cd203978c4061465655d2b756e7a466` | Equals the commit blob, the `source-implementation.tar` member and the working tree: it is the base the rehearsal contract was derived from. Not drift |
| Rehearsal-only contract (`S` copy) | `a0c01bc285b98c902d2a64b37ded687d2ac552cb71edc5bf9cc6459a7053cfb8` | Equals `candidate-prepared.json`, the inventory, the bundle and local `S`. Written by `prepare-candidate.py` from the base contract plus the proposed full-history, ladder and continuity values. Used here as the hash-bound contract for candidate verification. **Not copied into the repository and not production metadata** |

Semantic comparison (parsed JSON): after repairing an encoding artefact in 20 free-text strings (the rehearsal contract's comments/notes show UTF-8 text decoded with a legacy Windows codec, mojibake that a cp1252-to-UTF-8 round trip reverses; no functional field is affected, nothing was repaired on disk), the files differ only in the `_rehearsal_only` marker, the ladder witness/coverage fields (1,622 to 1,640 rows, 2025 to 2026, new label and manifest hash), `full_history` (last season 2026, excluded season 2027, `resolved_on` the placeholder `UNSET-OWNER-DECISION`) and the profile-continuity `renumbered_last_season`/`renumbered_rows`. `source_club_normalisation` (three rules: Brisbane Lions 1987–1996; North Melbourne 1999–2007 for results and for ladder) and `source_row_corrections` (two 1909 Jim Stewart drops) are **equal** in both. No rule applies to GWS, Footscray or Western Bulldogs in 2026, and none targets `player_stats_2026.csv`. The 392-versus-636 line-count difference seen in §10 is consistent with the rehearsal contract being re-serialised with `indent=2`; it is not content drift.

### 11.3 Provenance verdict

**PASS.** The consumed rehearsal `clubs.json` and `import_fitzroy_core.py` are identical to the exact implementation commit's blobs and to the retained, hash-bound bundle inventory; each of the two contracts matches its own provenance; every applicable hash agrees. The only declared differences from the commit are the two test-only files, the added acquisition data and the markers. Residual limits: DEV host bytes not re-read; archive command not retained; completion of `bundle-candidate.py`'s own assertion is inferred, which the independent comparison above makes moot.

### 11.4 What changes in earlier claims

1. §10 "Hash binding FAIL (drift + unsupported bindings)" and "BLOCKED": **withdrawn.** The repository contract (`e4001a8d…`) was compared with a binding that belongs to the other artifact (`a0c01bc2…`); that difference alone is not drift. `clubs.json` and the importer are bound transitively through the bundle hash, the inventory and the commit blobs (§11.1), which §10 did not trace. The §10 table rows themselves are measurements and stand.
2. §10 correction 3 (contract lines 141–174 read from the repository copy): the source-scoped rules are now verified equal between the repository and the bound contract (§11.2). The line numbers refer to the repository copy.
3. §2 line references for the resolver, round normalisation, results interpretation (duplicate-key refusal 1350–1354) and stats join (1576–1607) were re-read in the bound `S` copy and hold. `Team` is not read by the importer (no `"Team"` column access in the file).
4. §3 and §5 finding 1 are no longer a code reading only: the transcribed resolver gives `GWS` and `Greater Western Sydney` -> `Greater Western Sydney` (direct), `Footscray` -> `Western Bulldogs` (era remap, 1925–1996 identity superseded), `Western Bulldogs` direct, for both results and player_stats, with no source-scoped rule firing for 2026.

### 11.5 Parsed linkage verification — PASS

Input bytes re-hashed in-script against the recorded values; `results.csv` 17,056 rows (218 in 2026), `player_stats_2026.csv` 10,028 rows × 81 columns, every row full width, every `Season` 2026, no embedded newlines.

| Check | Result |
|---|---|
| Raw reproduction (Season, Date, `Home.team`, `Away.team`) | 218 raw groups of 46; **171 keys / 7,866 rows match raw; 47 keys / 2,162 rows do not** — reproduces the worksheet |
| Results side | 218 canonical keys, no duplicate (the importer's refusal rule), home never equals away, points = 6×goals + behinds and margin reconcile on every row, dates in season, `R<n>` equals `Round.Number` |
| Canonical fixture correspondence | each of the 218 results keys has **exactly one** stats group of 46; no raw group maps to more than one canonical key; no canonical group is fed by more than one raw group; 10,028 of 10,028 rows assigned |
| Row checks over all 10,028 rows (round code, `Home.score`, `Away.score`, venue, `Playing.for` is one of the two sides, `Home.Away` orientation, `Team` canonical equivalence) | **0 failures** |
| The 47 unmatched keys | 47 distinct canonical keys; 46 rows each (2,162); 23 `Home` rows for the home side and 23 `Away` rows for the away side in every key; one venue and one score pair per key, equal to the results row; rounds 45 `R<n>`, one `EF`, one `WF` (stats `Wildcard Final` -> `WF` through the existing exact alias) |
| Label cause | 48 label occurrences: `GWS` -> `Greater Western Sydney` 23 (matches), `Footscray` -> `Western Bulldogs` 25; **no other label differs**. One match (16846) carries both, so 23 + 25 - 1 = 47 keys |
| Per-key table | The §4 table (game, date, round chain, raw and canonical sides, score, venue, rows) is **identical** to the parsed result for all 47 keys; four same-date pairs are listed in a different order, with no content difference |
| `Team` versus `Playing.for` | Raw string equality on **8,924** of 10,028 rows; canonical equivalence on **10,028**. The 1,104 raw differences are exactly `GWS` against `Greater Western Sydney` (529) and `Footscray` against `Western Bulldogs` (575), and all sit inside the 2,162 rows (raw equal 1,058, canonical 2,162). `Playing.for` equals the side label of `Home.team`/`Away.team` raw on all 2,162 rows |

### 11.6 Empty `Player` cells (corrects §5 finding 5)

A lexical scan of every data line (tail columns `Player`, `Team`, `url`, `Age`, `Career.Games`, `Coach`, `DOB`, `Home.Away`) classifies 9,957 populated and **71 unquoted-empty** `Player` cells, no quoted-empty and no unmatched line, as the worksheet records. (Python 3.12's `csv.QUOTE_NOTNULL` did not separate unquoted empties on read, so the lexical scan, not that flag, is the evidence.)

- All 71 rows have blank `ID`, blank `DOB`, populated `First.name` and `Surname`, and `url` equal to one of the four renumbered-profile rule URLs in the bound contract: `Charlie_Cameron3` 27, `Jack_Graham2` 13, `Jack_Ross3` 19, `Jack_Williams3` 12. Those are **every** 2026 row of those four URLs (71). Clubs: Brisbane Lions 27, Richmond 19, West Coast 25. The rules' own counts (52/31/42/25, 2025–2026) agree with the preparation record's 79 + 71 split; only the 2026 part (71) was measured here.
- **9 of the 71 lie inside the 2,162 rows, not 1.** CSV lines (line = data row + 1): 146 (game 16842, Charlie Cameron3), 2020 (16882, Jack Ross3), 4116 (16928, Jack Williams3), 4491 (16936, Cameron3), 6933 and 6945 (16989, Graham2 and Williams3), 7770 (17007, Ross3), 9002 and 9015 (17034, Graham2 and Williams3). All nine are opposition players, none a GWS or Bulldogs player. The earlier "1 row" is correct only for the slice it counted (stats `Away.team` = `Greater Western Sydney`, 506 rows, which contains line 4116 only) and was wrong as a statement about the whole 2,162.
- Blank `ID` totals 88 = 71 + 17 `Billy_Wilson2` rows (Carlton, `Player` populated, ID blank), the documented split. In the 2,162 rows there are 12 blank-ID rows = the 9 above + 3 Billy Wilson rows (Carlton v Western Bulldogs 2026-05-16, Greater Western Sydney v Carlton 2026-06-20, Western Bulldogs v Carlton 2026-08-16).
- None of this affects the join, which keys on date and canonical sides; identity follows the profile `url`. No ID, DOB or `Player` value was inferred, and no identity evidence was added. The four renumbered profiles remain governed by the existing continuity rules and the display-only `First.name` + `Surname` fallback; `Billy_Wilson2` remains the separate case the ledger already records.

### 11.7 Limits and what stays pending

Linkage dimensions only: no quarter scores, attendance, start time, biography, officials, details or Brownlow field was measured. The resolver is a transcription of the bound code, not the executed importer; the importer's actual execution evidence remains the completed rehearsal and D7. Internal consistency only: no external verification of any 2026 result or label. This review does not decide whether a successor contract should record the label representation, and no policy, source, binding, active reference or data changed. All field, availability and family decisions remain **PENDING**; the three 2026 Brownlow keys stay pending; AFL API authority and eligibility/ownership restrictions are unchanged. The rehearsal contract and register are rehearsal-only, 1,640 is not accepted for production, and production remains NO-GO.

**Next bounded proposal.** The owner may now record the worksheet §4 results/linkage row decision against this review (the 47 keys are label representation, with unique canonical correspondence). The next separately authorised offline step would be the worksheet's untested quarter-score reconciliation over the 218 match groups, reusing this parser setup; it should state explicitly whether the rehearsal contract or the repository contract is the relevant policy file. Field, availability and release decisions follow their own gates.
