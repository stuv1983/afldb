# ISSUE-316 C2 baseline height source reconciliation — 2026-10-21

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `a3f01308975476b4` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. The four Collingwood goal discrepancies named below remain **unexplained**: the [goal verification](issue316-c2-height-goal-verification-2026-10-21.md) did not resolve cause or historical correctness, and N6 (2026-10-22) preserves all height and identity rejections. Nothing in this retention review closes them. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Source-side measurement complete; STOP on four unexplained Collingwood goal discrepancies. Stage applicability PENDING. Production NO-GO.** One agent; implementation basis 4a2eea89cccc465f2f017fb06ad55a7d4cb7733d. This is the baseline-only worksheet proposed in the [height applicability review](issue316-c2-height-applicability-2026-10-21.md) §6. No owner field, availability, applicability or successor-binding acceptance.

## 1. Scope and binding verification

R = C:/tmp/afldb-c2-brownlow-fix-20261021; S = R/REHEARSAL-ONLY-source. Reused established provenance/linkage, quarter, supplement overlap and D7/rehearsal findings; none rerun. Exact S bytes supply implementation evidence. Graph tools unavailable in this session; source inspected directly. Only native in-process filesystem, crypto and pure source-side parsing/measurement used. No retained module imported/executed, entry point, database dry-run, write logic or core correction/continuity transformation run. No shell/Git/network/host/database/WSL/install/acquisition/census/gates/rehearsal.

Previously recorded bindings were compared with newly measured SHA-256 observations. Equality is byte verification, not accepted successor binding or a new independent provenance anchor. run-config locator was read and verified against R/SHA256SUMS.txt before reliance. Inventory hash matches run-config and the prior review; completed commit/archive/bundle provenance was reused, not reconstructed. All 130 stats files (1897–2026) plus one register match BOTH core-manifest and SOURCE_SHA256SUMS.json entries. All headers/order and row counts match manifest. No applicable hash drift found.

| Artifact | Newly measured SHA-256 (matches existing binding) | Recorded binding |
|---|---|---|
| R/run-config.json | 547be7ce9260a764abcb6b615fde2f240d56ed2a50e89830de62c220da370531 | R/SHA256SUMS.txt |
| S/SOURCE_SHA256SUMS.json | b4a407b38d9f88f27631c51b5ba72d36ca0585f514cfc3d9badd31923055bdfc | run-config source_manifest_sha256; prior review |
| S/tools/migration/enrich_heights.py | 647bb383eb661f0ab0b0d6cac2dafe495b27a3f7361c7ea3ffafd50a51a6bcf0 | SOURCE_SHA256SUMS.json |
| S/docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json | 02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988 | SOURCE_SHA256SUMS.json |
| S/tools/rebuild/fitzroy/fitzroy-contract.json | a0c01bc285b98c902d2a64b37ded687d2ac552cb71edc5bf9cc6459a7053cfb8 | SOURCE_SHA256SUMS.json |
| S/tools/migration/import_fitzroy_core.py | 4786d336349170bce6b210fceeb6f72de79d8eebc1471b79e25a8f9e18e75cc5 | SOURCE_SHA256SUMS.json |
| S/tools/db/rebuild-test.ts | 5903e5115b6a6110963de6c7b8312b276b81869b5ea236df55a9d23676b51419 | SOURCE_SHA256SUMS.json |

Contract source_row_corrections and profile_url_continuity provide retained explanatory policy context only. Height reconciliation never invokes them. The separately hash-bound rehearsal contract remains distinct from repository policy; no policy or contract was changed. The predecessor supplement was excluded as instructed; overlap was not remeasured.

## 2. Exact source predicates and parser

References below are verified S/tools/migration/enrich_heights.py:

- 97–104: height-local aliases Footscray→Western Bulldogs, Kangaroos→North Melbourne, South Melbourne→Sydney, Greater Western Sydney→GWS; height limits 120–230.
- 112–148: names NFKD → ASCII ignoring non-ASCII → lowercase → replace each non-alphanumeric run with a space → trim. Seasons comma-separated four-digit years/inclusive ranges; malformed or reversed range returns empty set. HT full-match whitespace + 2–3 digits + optional whitespace + literal lowercase cm + whitespace, inclusive 120–230; otherwise no height. Games/Goals strip then integer; blank becomes zero.
- 168–196: aggregate by (raw stripped URL, height-local register club), increment games for EVERY raw row, sum parsed Goals, collect integer Season, nonblank stripped Jumper.No., and both normalised First.name + Surname and Player. Missing URL or unknown club refuses. Zero such refusals observed. No URL normalisation, corrections, deduplication or continuity merging here.
- 215–246: register key (stripped Team, Games, Goals, exact season set); no candidates if season set empty. Exactly one fact candidate containing nonempty normalised register Player maps; >1 named candidates ambiguous; fact candidates with no name match name_mismatch; no fact candidates unmatched. Mapping may occur among several fact candidates: 1,661 mapped rows had multiple fact candidates. Jumper sets use comma-split stripped #, compared by exact string intersection only when both sets nonempty; otherwise unavailable. Jumper disagreement never chooses or rejects identity.
- 249–255: asserted-height counts grouped by unchanged raw URL over mapped rows with parsed HT, counting every register occurrence. Canonical lookup/normalisation at 391–417 is outside this worksheet.
- 271–298,345–364: manifest-file verification/read path; validate-only exits BEFORE reconciliation. No validate-only/stage entry point run.

An in-memory character-state CSV parser handled quoted commas, doubled quotes, embedded newlines, CRLF/LF and trailing empty cells; refused malformed quoting, duplicate headers and unequal widths. A probe combining quoted comma, escaped quote, embedded newline and empty cell returned expected cells. Parsed strings were preserved. Numeric predicates were translated for source-only measurement; all numeric tokens used were safe integer text. No malformed/empty register season sets. Team/Cap is unique across all 16,731 register rows. No aliases, identities or policy semantics were invented.

**Blank semantics are observed implementation behaviour only:** blank Games=0, blank Goals=4,437 in register; blank stats Goals=0. parse_int maps any blank Games/Goals to zero. This does not approve the meaning of empty Goals, nor authorise changing it. No such change was made.

## 3. Measured counters and accounting

| Source measurement | Count |
|---|---:|
| Candidate stats files / raw rows | 130 / 695501 |
| Raw (URL, register-club) aggregates | 16734 |
| Register rows | 16731 |
| mapped | 16713 |
| unmatched | 9 |
| ambiguous | 0 |
| name_mismatch | 9 |
| HT valid / empty / nonempty invalid | 15888 / 843 / 0 |
| mapped rows with valid HT / empty HT | 15,870 / 843 |
| nonmapped rows with valid HT | 18 |
| Mapped jumper corroborated / disagreed / unavailable | 14,630 / 9 / 2,074 |
| Raw URLs with mapped valid height assertions | 12580 |
| Raw URLs asserting >1 distinct height | 0 |

16,713 + 9 + 0 + 9 = 16,731. 15,888 + 843 + 0 = 16,731. 14,630 + 9 + 2,074 = 16,713. Nonmapped rows have no selected jumper test (18); unavailable-mapped is separate. All 18 exceptions have valid HT. Height assertion occurrences = 15,870, over 12,580 RAW URLs. These are actual reconciliation measurements, not canonical-player counts inferred from populated HT. Zero raw-URL conflicts does not imply zero canonical-player conflicts across multiple URLs.

## 4. Exact register exceptions

Candidate URLs below are ONLY those returned by the existing fact/name predicate. An unmatched empty list remains empty.

| Team/Cap | Register Player | Games / Goals / Seasons | HT | Status | Predicate candidate raw URLs |
|---|---|---|---|---|---|
| Adelaide/42 | Jonathon Ross | 20 / 4 / 1992-1994,  1996 | 193cm | name_mismatch | https://afltables.com/afl/stats/players/J/Jonathan_Ross.html |
| Brisbane Lions/195 | Charlie Cameron | 208 / 410 / 2018-2026 | 181cm | unmatched | [] |
| Collingwood/162 | Jim Jackson | 93 / 22 / 1910-1915,  1920 | 174cm | unmatched | [] |
| Collingwood/182 | Victor Jackson | 3 / (blank→0) / 1912 | 185cm | unmatched | [] |
| Collingwood/615 | Bert Chapman | 68 / 34 / 1960,  1962-1966 | 170cm | unmatched | [] |
| Collingwood/649 | Terry Waters | 163 / 181 / 1963-1972 | 188cm | unmatched | [] |
| Melbourne/1032 | Steven Icke | 78 / 17 / 1982-1985,  1987 | 184cm | name_mismatch | https://afltables.com/afl/stats/players/S/Stephen_Icke.html |
| North Melbourne/159 | Jack Patterson | 31 / 27 / 1932,  1934-1935 | 165cm | name_mismatch | https://afltables.com/afl/stats/players/J/Jack_Paterson.html |
| North Melbourne/672 | Steven Icke | 120 / 33 / 1975-1981 | 184cm | name_mismatch | https://afltables.com/afl/stats/players/S/Stephen_Icke.html |
| North Melbourne/688 | Glenn Scanlon | 4 / (blank→0) / 1977 | 180cm | name_mismatch | https://afltables.com/afl/stats/players/G/Glen_Scanlon.html |
| Richmond/1162 | Jack Ross | 112 / 25 / 2019-2026 | 187cm | unmatched | [] |
| St Kilda/217 | Jim Stewart | 83 / 77 / 1905-1910 | 170cm | unmatched | [] |
| St Kilda/301 | Jim Stewart | 3 / 1 / 1909,  1911 | 166cm | unmatched | [] |
| Sydney/205 | Norman Paternoster | 2 / (blank→0) / 1908 | 182cm | name_mismatch | https://afltables.com/afl/stats/players/H/Henry_Paternoster.html<br>https://afltables.com/afl/stats/players/J/John_Roberts1.html<br>https://afltables.com/afl/stats/players/J/Joe_Larkin.html |
| Sydney/447 | Jack Patterson | 14 / 14 / 1931 | 165cm | name_mismatch | https://afltables.com/afl/stats/players/J/Jack_Paterson.html |
| West Coast/271 | Jack Williams | 54 / 46 / 2022-2026 | 198cm | unmatched | [] |
| Western Bulldogs/443 | Lyle Anderson | 24 / 5 / 1957-1959 | 178cm | name_mismatch | https://afltables.com/afl/stats/players/L/Lyall_Anderson.html |
| Western Bulldogs/665 | Glenn Scanlon | 5 / 4 / 1978 | 180cm | name_mismatch | https://afltables.com/afl/stats/players/G/Glen_Scanlon.html |

### Unmatched diagnostic facts, without selecting identities

The following are same-normalised-name, same-club aggregates, listed solely to expose fact differences. They are NOT reconciliation candidates, identity resolutions or newly approved mappings. Names alone are insufficient. No aggregation was merged, repaired or rerun.

| Register Team/Cap | Related raw URL | Raw games | Raw goals | Raw season set |
|---|---|---:|---:|---|
| Brisbane Lions/195 | https://afltables.com/afl/stats/players/C/Charlie_Cameron.html | 156 | 317 | 2018,2019,2020,2021,2022,2023,2024 |
| Brisbane Lions/195 | https://afltables.com/afl/stats/players/C/Charlie_Cameron3.html | 52 | 93 | 2025,2026 |
| Collingwood/162 | https://afltables.com/afl/stats/players/J/Jim_Jackson.html | 93 | 18 | 1910,1911,1912,1913,1914,1915,1920 |
| Collingwood/182 | https://afltables.com/afl/stats/players/V/Victor_Jackson.html | 3 | 4 | 1912 |
| Collingwood/615 | https://afltables.com/afl/stats/players/B/Bert_Chapman1.html | 68 | 35 | 1960,1962,1963,1964,1965,1966 |
| Collingwood/649 | https://afltables.com/afl/stats/players/T/Terry_Waters.html | 163 | 180 | 1963,1964,1965,1966,1967,1968,1969,1970,1971,1972 |
| Richmond/1162 | https://afltables.com/afl/stats/players/J/Jack_Ross.html | 70 | 15 | 2019,2020,2021,2022,2023,2024 |
| Richmond/1162 | https://afltables.com/afl/stats/players/J/Jack_Ross3.html | 42 | 10 | 2025,2026 |
| St Kilda/217 | https://afltables.com/afl/stats/players/J/Jim_Stewart0.html | 84 | 79 | 1905,1906,1907,1908,1909,1910 |
| St Kilda/217 | https://afltables.com/afl/stats/players/J/Jim_Stewart1.html | 4 | 1 | 1909,1911 |
| St Kilda/301 | https://afltables.com/afl/stats/players/J/Jim_Stewart0.html | 84 | 79 | 1905,1906,1907,1908,1909,1910 |
| St Kilda/301 | https://afltables.com/afl/stats/players/J/Jim_Stewart1.html | 4 | 1 | 1909,1911 |
| West Coast/271 | https://afltables.com/afl/stats/players/J/Jack_Williams.html | 29 | 21 | 2022,2023,2024 |
| West Coast/271 | https://afltables.com/afl/stats/players/J/Jack_Williams3.html | 25 | 25 | 2025,2026 |

Expected unresolved categories: three same-club register careers span approved raw-URL continuity boundaries (Brisbane Lions/195, Richmond/1162, West Coast/271); exact per-URL rows remain split. Jack Graham's club change does not imply another unmatched row. St Kilda/217 and /301 retain the known raw Jim Stewart Cartesian rows because height does not apply core drops. These reuse established policies, not fresh continuity/correction proofs. Nine name_mismatch rows retain exact predicate candidates, including three fact candidates for Sydney/205; no alias or preferred candidate chosen.

**STOP: four unexplained source goal disagreements:** Collingwood/162 register 22 versus same-name/club raw aggregate 18; /182 blank→0 versus 4; /615 34 versus 35; /649 181 versus 180. Games and season sets agree in each displayed diagnostic pair. Cause, correct values and any identity/correction authority are unestablished. No external evidence sought, further investigation, repair, new policy or gate relaxation undertaken. These observations remain explicit unresolved evidence, not an explained or accepted exception allowance.

## 5. Jumper disagreements

Existing predicate still maps these rows; corroboration is informational. Causes/correct jumper values remain unresolved; no repair or external lookup. All other mapped rows are accounted for in §3.

| Team/Cap | Register Player | Selected raw URL | Register # | Stats jumper set |
|---|---|---|---|---|
| Carlton/222 | Alick Barningham | https://afltables.com/afl/stats/players/A/Alick_Barningham.html | 20 | 1, 23 |
| Carlton/245 | Ned Bowen | https://afltables.com/afl/stats/players/N/Ned_Bowen.html | 21 | 2 |
| Carlton/312 | Robert White | https://afltables.com/afl/stats/players/R/Robert_White.html | 25 | 22 |
| Fitzroy/1038 | Brendan Ryan | https://afltables.com/afl/stats/players/B/Brendan_Ryan.html | 21 | 40 |
| Richmond/576 | Graeme McCartney | https://afltables.com/afl/stats/players/G/Graeme_McCartney.html | 19 | 1 |
| West Coast/266 | Aaron Black | https://afltables.com/afl/stats/players/A/Aaron_Black1.html | 47 | 26 |
| West Coast/267 | Angus Dewar | https://afltables.com/afl/stats/players/A/Angus_Dewar.html | 49 | 39 |
| West Coast/268 | Stefan Giro | https://afltables.com/afl/stats/players/S/Stefan_Giro.html | 48 | 22 |
| Western Bulldogs/414 | Nick Gelavis | https://afltables.com/afl/stats/players/N/Nick_Gelavis.html | 14 | 6 |

## 6. Implications and smallest next bounded proposal

A separately reviewed runner/contract change still must support baseline-only heights without the current nonempty supplement requirement, account for coaches sharing the same supplement pins, and use actual capture metadata and newly evidenced expectations. This worksheet supplies source-only counters for review; it does not authorise that change, promote counters into accepted pins, add continuity to height reconciliation, resolve source exceptions or justify stage success. Redundant predecessor input stays excluded.

**Next bounded proposal:** a documentation-only decision review of the four goal discrepancies and nine name exceptions/jumper disagreements, explicitly defining whether existing retained evidence suffices or whether separate external-evidence authority is necessary. Preserve current predicates and refusals; do not execute a runner or edit source/policy. Any source correction, alias, identity rule, blank-Goals decision or new external evidence requires separate authority. The unexplained discrepancy stop must be addressed before further applicability validation is proposed as executable.

Still missing for stage-success assessment: exact successor canonical identity map (source/method/status/player linkage and continuity paths, tied to import/input evidence); target height/evidence state; target-specific no-canonical rows, assertions/fills/agreements/internal/existing conflicts, rejection evidence and evidence linkage/invariant counts. None inferred here. API/Wikipedia pinned inputs, successor resolution/distinct canonical evidence-player counts, and coaches frozen source/profile/canonical-match/assignment expectations remain outside this worksheet as recorded in height applicability §6. No canonical map, fills, target conflicts, linkage or success claim follows from source mapping.

All field/availability and stage-applicability decisions and successor bindings remain pending. ET applicability unresolved. All three 2026 Brownlow keys — brownlow_match_votes, brownlow_round_votes, brownlow_season_total — remain pending, with canonical suppression/publication restrictions unchanged. AFL API authority, eligibility and ownership restrictions preserved. 1,640 remains rehearsal-only; no production acceptance, active-reference change, rollover or release authority.

## 7. Per-file newly measured observations

Every value below equals its PREVIOUSLY RECORDED candidate manifest hash and S inventory hash. This table records new observations, not new accepted bindings. Rows/header order also match each manifest entry.

| File (under candidate snapshot) | Rows | SHA-256 |
|---|---:|---|
| player_details.csv | 16731 | 03f790eeeca85426b7866e2b034c600091a4061177eb4c0e572667cea91f133f |
| player_stats_1897.csv | 2480 | 00f439ce050936f2ea3aeb27b122c41beda8dc058122ef3f93cd6412a91a4306 |
| player_stats_1898.csv | 2800 | 16ede022402ac31586ccaf1382b5164c306e06fd5d907441c3555c64059ca37b |
| player_stats_1899.csv | 2484 | 9bf1fcff20e00c35c014eb7ae14debfd8a7e8e99d2f1973a6ea956289fcdfefd |
| player_stats_1900.csv | 2520 | 9a538526ae65bbbf2255cf01fd018c401f3c1a5613239447945b3acc1ee44286 |
| player_stats_1901.csv | 2556 | 2f7e00cb4578038fe2709d7c5a97f6f685ea1cff51ead0cbfc96c70780c678d5 |
| player_stats_1902.csv | 2592 | fe1adeaff2ab9da80ea967b2fbd2607b39e41f83d9a34ebb1ec181c83e6354c0 |
| player_stats_1903.csv | 2556 | 651249c42251c445f49ee789513e204c9ab61fa2a4fd661a72137ee76e891c84 |
| player_stats_1904.csv | 2556 | f354c3d84554335a974dda51ea5e497487a19a691367f382f7e957d3572188ea |
| player_stats_1905.csv | 2592 | b9ec7a5dd6beb5a32ca89d1b15c4b20b58491d519c8ff18a9f1b3a65bbe67551 |
| player_stats_1906.csv | 2556 | 92c283e26a2179aeffa837100c6dd86421cb234c739b45c9506993344186d95c |
| player_stats_1907.csv | 2556 | 6357601c28f10f062e9d0308dccdf5929292740d6aab01c41119563aaf32a5c1 |
| player_stats_1908.csv | 3348 | f917862ff79943c88fe9120cc942d7f62a3742fb6076e32703789128a050860b |
| player_stats_1909.csv | 3386 | 8a51cdaeb103b96e33765f47b937d8302f77c6efaa0617115e8bcd55b66c71ec |
| player_stats_1910.csv | 3384 | 04bdcdadb9fa5305632c51f94d4f3f26b0b169bdeca8dbe0d5f4f7b031f1e483 |
| player_stats_1911.csv | 3348 | b6de7123a0cef1b2b1b1b9840cbae6e2a43ef378a729f13bb6cdc47a0e3e1e09 |
| player_stats_1912.csv | 3384 | d5f15a1bea8e4744944bdbfa055fe304f6053f8272d71943d6ab4376b63009c5 |
| player_stats_1913.csv | 3384 | 76dfcd6d3cc7728d9f8cff296ba38db6e0235ad5354631a19c73b2dad10c51fc |
| player_stats_1914.csv | 3384 | bcaab10c7b9bb561e9d101ff4b9db37fa7f5928c4d8d70805c176e81301bd6d0 |
| player_stats_1915.csv | 2736 | 1c070678e6a4d21e7856b763a22979df8b61092044a0b256f67d99d22c7b6deb |
| player_stats_1916.csv | 1008 | 281d8c356d4e9bd47ce18b013d1ede439a5aa65e6bc357b1af10192860364837 |
| player_stats_1917.csv | 1764 | c128b3e1aedd252efeb0d6041b8ae75caf3db55ef18db3ef3daa5a1c59bbeb92 |
| player_stats_1918.csv | 2124 | f7009787fb43c9cd1312f0da5c2605b22ce6250646a0e692da25631019a2e561 |
| player_stats_1919.csv | 2736 | c1e011af78584f327c1fa57e7146e486e2be1161f6cf6013cafe86606ebfd05a |
| player_stats_1920.csv | 2736 | d13896d7c6a6daae20908c1651179fe4c7818e62a49bf34cf353446dde82c029 |
| player_stats_1921.csv | 2736 | 21fe9beb0aafa6ce3caa459f8fca8fee930d5ec710abfa57e498f8123c9a1909 |
| player_stats_1922.csv | 2736 | 44b8f25e6abb3fec3df15b57412fc616d66bd818ff0c01d3b81e86bf609644d2 |
| player_stats_1923.csv | 2736 | 56a4d9c004a3c7edd5c2e8c3f4b8969e423b7fa2a8da0856bc29cf0ed85466df |
| player_stats_1924.csv | 2808 | fd745310f18a7445f8ec3a3001be9b07bcf8c16eb462a346f1155d4b4214dca7 |
| player_stats_1925.csv | 3816 | 7c2f738ba69c204135e6cefbd60ad373f362a338338b21972b854b32009365ee |
| player_stats_1926.csv | 4032 | 677bba19cdcf878bc115b1dbe53fd97d6e71f19f3de74e3a982af26b8283b5ec |
| player_stats_1927.csv | 3996 | b7dae441bd10378d2590606fa8e67fd6984ca9e8a6b3601df8a9180ff981337d |
| player_stats_1928.csv | 4032 | 771b46c5f80f4f9f2d6fd2304a209433981318f985afafdbb66a61962e1f7e65 |
| player_stats_1929.csv | 4032 | 1ca1e109f146c3a52ba14c396cfb0a550575643892c002ed6aec6f0ceefcde50 |
| player_stats_1930.csv | 4256 | b9fccd0ff1110608ab802fde6e1c83587eab0cfcc4e49012e2f83d79085f44e6 |
| player_stats_1931.csv | 4256 | aa1f35bee6dfbac1234ee58206d655ed4a29e62834fc84e034a8c2a603555077 |
| player_stats_1932.csv | 4256 | 535ff0f71fc5f27fbf486fd12b6ce263321ffec04f25a2f36238c3d525f3d6f0 |
| player_stats_1933.csv | 4256 | 22a3566276144790e72a3fe0870d8f540b6e37656288b6b15ca4d12f4acd2a36 |
| player_stats_1934.csv | 4256 | cede4df7b7b29ea6346f77b339240daa1992f44ad035eb6ae1a2c2ba23bce275 |
| player_stats_1935.csv | 4256 | 726f0c4dfa231ef42378c448a8549b6536832e382e1ac340ab7fa95a57d94505 |
| player_stats_1936.csv | 4256 | f4ad5a43c3fad105a9b5b61d9d8eb56f660b150b2e4a6a6e9034af0eecf97ed6 |
| player_stats_1937.csv | 4256 | d1230e908b971eb8e11b2b89fc083307e75981c34613b381ab463d54e72c17e1 |
| player_stats_1938.csv | 4256 | eddac95f20d0393d44fbcac2bb624e8ad99b3c241d0d491a260f3a807bc5d7b3 |
| player_stats_1939.csv | 4256 | 0b7aa660307769e30d461eef5a786a162e79019daa20247eab3a4b3f6305b52a |
| player_stats_1940.csv | 4256 | 15e4ac686d7f57b8a61b368096a4571db9340a03344ee172d305a8fa7add0d1c |
| player_stats_1941.csv | 4256 | 0c215fcf9247fbf8a7d32fb0d3f7d7fd5d30cd23f80dffcb6f2db0254b18dce9 |
| player_stats_1942.csv | 3192 | ed264b122455990f652bf7f2345865bfcdc202d7fad144a8cf8807c789195ecd |
| player_stats_1943.csv | 3192 | 0d312b14b8ca0f513702db12c402e8cbf1d3c91f84873b5e62fafaaa7bea0153 |
| player_stats_1944.csv | 4256 | c732a4bc9cc649dd493db325f20d7668532511b37f8b6660f26f9ee0ae510b16 |
| player_stats_1945.csv | 4712 | 00ed6c685c935e3e776679686c52fa5417852b205e75d0ba1e016f6f4f57a97f |
| player_stats_1946.csv | 4760 | 263ab96d110b91d6283e2ac90cf25beb031a0ae7e328ea8f51c08d6858fcdf89 |
| player_stats_1947.csv | 4720 | b26df67b5ee20519bbb01dfa4ee4b86e5fa66522c4522684f287003495c440ef |
| player_stats_1948.csv | 4760 | 6993c63290c0224bdb351524a3c5833b004ba545768334a5344e23b58402e223 |
| player_stats_1949.csv | 4720 | 6c430d4a6e060e9e117c8c08dfb326d5ef961c4d418b223d79a6960d9cd189aa |
| player_stats_1950.csv | 4480 | 72f1eb09f8d0e43fdfb90e3e2c15ab5d63d35908a688bdbab05e459616007c33 |
| player_stats_1951.csv | 4480 | b2914580f07d5fb933d215ac000076066d18643397015a7cc7c728b904cbe023 |
| player_stats_1952.csv | 4720 | 71bb04ee25533dcd41475a84c46a036600f0138fd95337b6d91ef544320d99d2 |
| player_stats_1953.csv | 4480 | 11546485b0be96ce5e4f31bd8f5b524f7c91762664df5b404fa9f8746e8b72e9 |
| player_stats_1954.csv | 4480 | 233280e386fc38c3ab143d4e7ef332fdf549e01e3e9e3cfd5f4814808735209d |
| player_stats_1955.csv | 4480 | 2bf503f71bcd895ac2b9032ff579e0020aa12600ff0746c237c70da1cef9eed0 |
| player_stats_1956.csv | 4480 | f158c37cfb96f804458d0ac01a6312012bc0cfddab7158367268a4c725432184 |
| player_stats_1957.csv | 4480 | 76889d76d85954068daf4c0332a7e90dbdb7a9d646d1f68c802b2d08af7ea4f1 |
| player_stats_1958.csv | 4480 | 40547b75954d8c6bab4aa6b6d39f507f7bcef3db84ff3137b6ac4b0a2000be9a |
| player_stats_1959.csv | 4480 | 9c56e9edf71cfd7bcccbf9c64b87fd54ae5e44c0468f32841d29bd37b573af2b |
| player_stats_1960.csv | 4480 | ff40f0cc28d736ac7624315264fc2ae1b364d2432e923e6bfe40e67f625b34e4 |
| player_stats_1961.csv | 4480 | ac918fae10f3bea99ac58559dff51cdb5bf3ae8f3c940a8a6dfc0dab7171423f |
| player_stats_1962.csv | 4520 | 32dfa95a12dbb764908644d480d6fe63e22ffe72efe6e8f812ee9c799c2e919c |
| player_stats_1963.csv | 4480 | 8c6f96cfd7ebb87aba31712fc3d7c45dd06aaf2fee586dd2abbb57a024add0b6 |
| player_stats_1964.csv | 4480 | 6cf78ff0c5f01ad76870f21b05c592a17afdf45073d1d8bf78ec9acc6ceb44ce |
| player_stats_1965.csv | 4480 | d3cde8b92ce84f04ba48528492ffa5579d411aa59ed3df88f99f7a036f6993cf |
| player_stats_1966.csv | 4480 | 0bc49a22a490459d0dd997109570134915d84f66dd8fce0cb7a6c59c14361b9e |
| player_stats_1967.csv | 4480 | 9787c589aaa2f3e4dffb370f5c02455421c23c1945aabeca50952fde029be9c4 |
| player_stats_1968.csv | 4960 | 95dadc606119c73e76c1a692aab0297b683716a475f86efb607c0ce3c8a39e6a |
| player_stats_1969.csv | 4960 | b1e40ca790de0d764b246e0bc8fdb23a64268d08c255f5c08fb268148fcd0790 |
| player_stats_1970.csv | 5440 | 914c6f687122b8220c4c3e2d4ba3b948ff28c7540d6624a71ffdb435f0e3d791 |
| player_stats_1971.csv | 5440 | 4408ce7f82751994ad705a3329a8159a08686c60cd911e4a201a239b5326cf2b |
| player_stats_1972.csv | 5560 | ebfb959bf631c56a960d5b0d74479c18288dc5bbc53d950bc583e56ab60eeb06 |
| player_stats_1973.csv | 5520 | 3601f5d91659697e4df4a1310436ecb47544fc3575a5f141ba938f4f89108c6d |
| player_stats_1974.csv | 5520 | 867a71d17eccd33a75e666284be58491077f87b734b2115385edc6b317cec5cd |
| player_stats_1975.csv | 5520 | 99e14cbb5fc5c281d7dcf5c135de04a2b6c2189234c5dcda1e1d3f5e4b38e9af |
| player_stats_1976.csv | 5520 | daec0184c7e4b449f3ac9262852d2472ce3608c90b68e904879d582fdcd82e72 |
| player_stats_1977.csv | 5560 | 6acd48c51af78ec4eb3db62d40bf7c9eb5a5ca6068b683e5d837a9dbcd8085e2 |
| player_stats_1978.csv | 5520 | 0f57c7e4dc35a3b724bd9db163f4ac7e9401c4f2122fd578a221be77378ab67a |
| player_stats_1979.csv | 5520 | bb4c984ba0d0f22caa5bbb83152a3023a92f9237890f298c5b74909cdf20f0ed |
| player_stats_1980.csv | 5520 | 415fcb4329c65a3235e92127e617e8472a93afce48d0161c259bdddd6d59b881 |
| player_stats_1981.csv | 5520 | 2e5d582c27388be19339d794e9cacdd83fb8c156115995f17661a8931bbf1ebf |
| player_stats_1982.csv | 5520 | 646ffac848b45ae0eecf7c4946b339dc1ffe894f608d571264242c9b40a0bf2d |
| player_stats_1983.csv | 5520 | 2dbaa1aa1c35e4208b822b8fed1b2f875a9fd9c48ab84dfeef1a5ec2c9e28898 |
| player_stats_1984.csv | 5520 | f41c2d6ee1ba12096e0455efda5814fea1e4cc0c1006ae3ca401f73eff04c9d8 |
| player_stats_1985.csv | 5520 | 47ed0ab339ca1e64754cf4b2400e8606fcebe919bd133272cc514158c2287c62 |
| player_stats_1986.csv | 5520 | e6564f2669114b2f78ac22823977d67fcd5d0003e38c1469de7ef58f41085b3c |
| player_stats_1987.csv | 6400 | 2baf017e932a6e4e81eb30223320fc0dc24ae36ac3cac5670e4ebd15dd6d2b65 |
| player_stats_1988.csv | 6400 | 74dea5a43207952ab1ffe124b6fd1c2b18a9ac19bab712f4aee75a076472b767 |
| player_stats_1989.csv | 6400 | 02a5b434082c96fe789a921287d4f38dd77537439fb972fd7bdb523c41380823 |
| player_stats_1990.csv | 6440 | 6e0aaad1b70fc5dda6ab8bb02d26caa7494cfd04712bcc544b866050a80d1bba |
| player_stats_1991.csv | 6880 | c83912a1ec8acd794f4fe060b53a59a50b93a9307117f96f91cc0f8c74b8aea3 |
| player_stats_1992.csv | 6880 | 2212972e93cd659c6a53de843ce0dda9d9191e94365d22cd6cd3c01f10497670 |
| player_stats_1993.csv | 6280 | d1068bcadc09c9f380b091c3be84e7774022f271fed01efb16bca365be43bcad |
| player_stats_1994.csv | 7308 | 6efc0bdafa5406169928ac5c601c70d6de27da7e34feb3bd7794416fe02aebb4 |
| player_stats_1995.csv | 7770 | 340cc2ba3bf1ace1c7110abd2a75610cf31ce83cade86790bb6eb3e5f650a7d3 |
| player_stats_1996.csv | 7779 | 9fe056e6c1578a044a5cfef1501b182f18e33a5c21c324eec9cdc6953535e494 |
| player_stats_1997.csv | 7770 | 80bb1a8bf202e2bc77618cdb8f579029259d77c30dc9c683af6acdca3be77c05 |
| player_stats_1998.csv | 8140 | c684bffc41854a6d95e1e6ca4ebc9f6376c33c1c33053af7b6c37c229d68b179 |
| player_stats_1999.csv | 8140 | d25542e2cc4ea55078fc23255ed0a2141c6585d7c3934509af70ee8df013ad9d |
| player_stats_2000.csv | 8140 | 532da47358c02bdd7624d7120a6b47fb4b357bf383f2b314409c9999a59a90ea |
| player_stats_2001.csv | 8140 | 62c739dd9fbfc8c74cb5df0dfce0be06ab8c65e957a2251cb703f6c10bbaf1fa |
| player_stats_2002.csv | 8140 | 57c344c08e61125b77ff2a25c403674e52e783a3d03178ea9b865133a38679ca |
| player_stats_2003.csv | 8140 | b972defee2616502849758fc6ffee123ae902d9be50703d503649eb9cf27d952 |
| player_stats_2004.csv | 8140 | 2ca38945a6d5339fcf9cf76e21face0d881d2e54b97622dcc5acb5aa66700ea5 |
| player_stats_2005.csv | 8140 | 7430cff9195649ff3c881e13790ab45b4ca2d32617a213c49137c14e838837a1 |
| player_stats_2006.csv | 8140 | d5a28de256028f10c78f866616c2169e66fc8b9f6ae4e30830e1eea483eaba04 |
| player_stats_2007.csv | 8140 | e410e7b536e7c4e148936c1fd4696f93bd32087bfbf89e14ab0bcc3c46a8b6bb |
| player_stats_2008.csv | 8140 | f99bb8f0f160282f6f94a11bbcb7fcb38b1e1a5e19e1e7ae96d7972fafaec921 |
| player_stats_2009.csv | 8140 | a98323fb84534665f05d92dd026e4f418935956ce52f76a49f9785b1a33fc97c |
| player_stats_2010.csv | 8184 | 3b8a77a496f40892f2ead3e7b0efdc0aa09b64efea6b9450b3ba84f7fd02e3c3 |
| player_stats_2011.csv | 8624 | 3162a19e6bf3abe65266133254a253c4ec132560580aafb8a7ebe2d4fc1cc387 |
| player_stats_2012.csv | 9108 | 3cd5b38fdf841cb8d6c20e789811d8363f472e33d7d102297d596c4cd69872f2 |
| player_stats_2013.csv | 9108 | 505b354f97656c64a97c88e81563aefc921056f487734ba98f2fca3dbe519e40 |
| player_stats_2014.csv | 9108 | 478e8caba3162b88d183405475817faef5c5477fe6e26991367e7da97b47d6eb |
| player_stats_2015.csv | 9064 | 1303aa4c5d0889ad7b00f302a057eb87cbf32df2b623eab819731d4e86ec8271 |
| player_stats_2016.csv | 9108 | 1713fb5f9e2e27fee75f231f9069d8debe8fee64ddfc5911ac0fd282b57b543f |
| player_stats_2017.csv | 9108 | 2be8e8fcc0941e6e8ba5ae23ece204e0cde82b35d7d49b9c7f2f223e900f491e |
| player_stats_2018.csv | 9108 | 12b819566d32c383ce0b3d863a1e658e48ede89daad25cf1d4c3e07492aa6a28 |
| player_stats_2019.csv | 9108 | 3b5b2674868b8280f2ccd0a8a7fa113c801da85a2485506136f718261cda41f6 |
| player_stats_2020.csv | 7128 | 5b8ae4d76e6c3c63604aaa8f2df2ec998754992adc1f5177d71d0b37b4a222b9 |
| player_stats_2021.csv | 9522 | 3582bf510dd156eb5256e0b04eb6742f026e74f14f637adf70fd366ca38b94d8 |
| player_stats_2022.csv | 9522 | 9ef09869fda8b6fc2d6bf532401d31ce50b3ebbf5db21a792c474ed5adc6a1f6 |
| player_stats_2023.csv | 9936 | d548769c2c827681c71d678a1cf65671bb5801bbd1d92ab9f5f206173b28500b |
| player_stats_2024.csv | 9936 | 250b3aad0455fb3b42e0294181f580503d41ba04370b38f875a7412d5f7c5dc1 |
| player_stats_2025.csv | 9936 | 166bd1e7b8f8127ebb4f80073a482a885b0f01bd8bb8b3240d0713a0b9de1d59 |
| player_stats_2026.csv | 10028 | 79db69732ea1018b577e548622e6c702c1a79270478cc019dc80571fc217898f |

## 8. Changes and validation

Created this worksheet and updated only ISSUE-316 current tracking links/next actions in IssuesIndex.md, issues.md, issues/open/AFLDB-ISSUE-316.md and docs/v2/issue316-c2-preparation-2026-10-21.md. ISSUE-316 remains OPEN; open table/index membership unchanged. No CHANGELOG entry for investigation-only findings. No source/contract changes, accepted bindings or unrelated/.codex/ edits. Validation: bound SHA-256 comparisons, CSV probe and manifest shape checks, complete bounded source reconciliation and arithmetic accounting, document readback. No tests/stages executed. Stop.
