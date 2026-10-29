# ISSUE-316 C2 height exception evidence review — 2026-10-21

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `283465423f9743af` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. Its verification limitation (incomplete predecessor hash verification) is unchanged by this retention review. Applicability remains pending. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Retained-evidence review complete with verification limitations; applicability PENDING, production NO-GO.** The nine name-mismatch spellings were documented in predecessor work. Retained aggregate counts do not establish that the four Collingwood discrepancies or the nine individual jumper disagreements were previously explained or adjudicated. No unmatched row is approved by this review.

## 1. Scope, evidence status and limits

One agent. Read AGENTS.md and the [height applicability review](issue316-c2-height-applicability-2026-10-21.md) and [source reconciliation worksheet](issue316-c2-height-source-reconciliation-2026-10-21.md). Reused the latter's completed measurements, candidate file hashes and exception lists; no source reconciliation, raw-data aggregation or stage was rerun. Implementation basis remains `4a2eea89cccc465f2f017fb06ad55a7d4cb7733d` and its retained rehearsal candidate. Predecessor counters are historical context, never substituted for successor measurements.

Evidence references:

- **E1:** [source reconciliation worksheet](issue316-c2-height-source-reconciliation-2026-10-21.md), §§1–5 and §7: recorded candidate hash comparisons, predicates, individual exceptions, diagnostic facts and jumper sets. This session reuses that report; it does not freshly verify its raw files or independently reproduce its measurements.
- **E2:** [ISSUE-118 runbook](../../issues/closed/AFLDB-ISSUE-118.md), §23.16 H2.1 / ambiguity policy (lines 3016–3044), source report (3055–3073) and canonical coverage (3075–3088). This is predecessor decision/history evidence, not a candidate execution record. §23.5 (2596–2616) identifies the older register and its acquisition context.
- **E3:** the same runbook, §23.19 H3.1–H3.3 (3228–3259): separate AFL API corroboration and height-source disagreements. These concern heights, not an adjudication of register-versus-match Goals or these spelling/jumper discrepancies.
- **E4:** [height adjudications](../../data/players/height-adjudications.csv), header and the two data rows: Paddy McCartin and Jamarra Ugle-Hagan, both `retain_afltables`, referenced to ISSUE-118 §23.26. Neither row concerns an exception reviewed here. These height-value decisions do not approve identity matching by another name.
- **E5:** [fitzRoy contract](../../tools/rebuild/fitzroy/fitzroy-contract.json), `player_details` → `height_enrichment` block (lines 291–313 in the inspected copy): predecessor register/supplement description and canonical count pins. It supplies no per-row Collingwood or jumper adjudication. It must not be adopted as successor metadata.
- **E6:** [height applicability review](issue316-c2-height-applicability-2026-10-21.md), §§3, 5–6: raw-URL source aggregation, separate core correction/continuity rules, canonical/evidence dependencies and runner/coaches supplement boundary.

E2 was inspected narrowly for source reconciliation, decisions, coverage and exception/report locators. Relevant ISSUE-129 and ISSUE-136 runbook references were searched for context; their match-completeness/core-continuity history does not supply a decision on these goals, names or jumpers. Targeted searches of `docs/data-dictionary.md`, `docs/v2/coverage-matrix.md`, `data/reference/stat-availability.json`, `data/reference/fitzroy-accepted-baselines.json` and `data/players/height-evidence-wikipedia.csv` returned no named exception evidence for the reviewed people. This is a bounded search result, not a claim about every possible retained file or unavailable historical output. No predecessor row-level height report was located through the examined runbook/report references and relevant retained snapshot directory listings.

**Binding limitation:** E1/E6 contain previously recorded and previously measured candidate bindings. They are reused as recorded evidence, not represented as new hash observations. The repository documentation, E2/E4/E5 and the targeted negative-search records above were read as local records; no pre-existing binding for their current bytes was established in this review. Their repository placement is not provenance. An attempted further inspection/hash-binding lookup stalled in the native in-process tool; its unreturned results were not used. No new SHA-256 observation is claimed. Consequently the predecessor narrative establishes what the inspected record says, with this disclosed integrity limitation; it does not establish byte identity with its original execution inputs or candidate bytes. No external evidence, source repair or alternative command execution was used to overcome this boundary.

## 2. Four Collingwood goal discrepancies — reviewed first

E1 §4 supplies the exact candidate observations below. Its diagnostic URL associations remain same-name/same-club source observations, not selected identities. E2 §23.16 records nine unmatched predecessor rows in aggregate but does not enumerate these four Caps, names, goals or their causes. Equal aggregate counts cannot identify the underlying rows. The inspected correction/coverage/decision records contain no applicable per-row adjudication of these differences.

| Candidate Team/Cap | E1 candidate facts | Previous observation / explanation / adjudication established here | Applicability and smallest remaining requirement |
|---|---|---|---|
| Collingwood/162, Jim Jackson | Register 22 Goals; diagnostic stats aggregate 18; games 93 and season sets agree | Aggregate predecessor unmatched count only (E2 3063); no individual observation, explanation or adjudication established | E1 measures these candidate bytes. No predecessor decision shown to apply. External verification would need club-register and relevant profile/match goal evidence to explain 22 versus 18; neither source is selected here. |
| Collingwood/182, Victor Jackson | Register Goals blank; existing parser produces 0; diagnostic stats aggregate 4; games 3 and season 1912 agree | Same evidence limit; no individual disposition established | Verify literal blank separately from its meaning. External register/profile/match evidence is needed to explain blank versus 4. Any decision to treat blank differently requires separate policy authority; no such decision is implied. |
| Collingwood/615, Bert Chapman | Register 34; diagnostic stats aggregate 35; games 68 and season sets agree | Same evidence limit; no individual disposition established | External register/profile/match evidence needed for the one-goal difference. No correction or preferred total follows from this review. |
| Collingwood/649, Terry Waters | Register 181; diagnostic stats aggregate 180; games 163 and season sets agree | Same evidence limit; no individual disposition established | External register/profile/match evidence needed for the one-goal difference. No correction or preferred total follows from this review. |

The source worksheet's “unexplained” classification therefore remains warranted within the inspected evidence. These are newly individually documented candidate differences; this review cannot prove they are new source defects or absent from every historical report. E2's historical canonical fills/coverage and ISSUE-118 closure do not adjudicate these source facts. No local remeasurement is proposed: the differing values are already measured; their explanation requires evidence or an explicit decision about future verification.

## 3. Nine name_mismatch rows

E2 §23.16, line 3065 explicitly lists all nine spelling categories, including multiplicities. E2 lines 3027–3044 prescribe rejection of nonmapped rows, not aliases or name-only canonical matching. Thus the categories are established predecessor limitations; the candidate row locations and exact candidate URLs come from E1 §4. The historical shorthand “facts unique” is not sufficient for Sydney/205: E1 records three fact candidates, and the existing predicate still yields `name_mismatch` because none matches the register name. No preferred URL is selected.

| Candidate Team/Cap and register name | Prior documented category (E2 3065) | Candidate evidence / disposition applicability | Smallest remaining requirement |
|---|---|---|---|
| Adelaide/42 — Jonathon Ross | Jonathon/Jonathan Ross | E1 candidate `players/J/Jonathan_Ross.html`; known spelling category, still rejected | No change needed to preserve rejection. Any identity exception needs separate direct profile/register evidence and explicit authority. |
| Melbourne/1032 — Steven Icke | Steven/Stephen Icke ×2 | E1 candidate `players/S/Stephen_Icke.html`; category applies descriptively, not as an approved match | Same boundary; no alias or identity selected. |
| North Melbourne/672 — Steven Icke | Steven/Stephen Icke ×2 | Same E1 profile candidate; still rejected | Same boundary. |
| North Melbourne/159 — Jack Patterson | Jack Patterson/Paterson ×2 | E1 candidate `players/J/Jack_Paterson.html`; still rejected | Same boundary. |
| Sydney/447 — Jack Patterson | Jack Patterson/Paterson ×2 | Same E1 profile candidate; still rejected | Same boundary. |
| North Melbourne/688 — Glenn Scanlon | Glenn/Glen Scanlon ×2 | E1 candidate `players/G/Glen_Scanlon.html`; still rejected | Same boundary; blank Goals remains under existing parser behaviour only. |
| Western Bulldogs/665 — Glenn Scanlon | Glenn/Glen Scanlon ×2 | Same E1 profile candidate; still rejected | Same boundary. |
| Western Bulldogs/443 — Lyle Anderson | Lyle/Lyall Anderson | E1 candidate `players/L/Lyall_Anderson.html`; still rejected | Same boundary. |
| Sydney/205 — Norman Paternoster | Norman Paternoster | E1 candidates `players/H/Henry_Paternoster.html`, `players/J/John_Roberts1.html`, `players/J/Joe_Larkin.html`; all remain unselected | Any future identity proposal needs direct evidence distinguishing the people and explaining the name, plus separate authority. Prior naming of Norman is no identity adjudication. |

URLs in this table abbreviate E1's literal `https://afltables.com/afl/stats/` prefix for citation only. No URL aggregation or matching was performed here. These are the previously measured candidate lists, not newly constructed aliases. No predecessor per-row hash equality was established; recognition of the same spelling categories does not prove predecessor/candidate raw rows are byte-identical.

Existing evidence resolves the narrow historical question for these nine rows: their mismatch categories were already documented, with fail-closed treatment. It does not resolve their identities or grant successor exception acceptance. Owner review can acknowledge the continued limitation while retaining rejection; changing that disposition requires a separately evidenced and authorised proposal.

## 4. Nine jumper disagreements

E2 lines 3031–3032 establish jumper corroboration as reported and never decisive. E2 line 3069 records 14,639 checked / nine disagreeing predecessor rows, but gives no individual row/name/number list. Therefore the informational policy is established; prior observation of each individual disagreement below is not established by the equal count. E1 §5 supplies every candidate row and selected source URL; no canonical identity is inferred.

| Candidate Team/Cap — name | Register # / candidate stats jumper set (E1 §5) | Previous individual disposition and candidate applicability | Smallest remaining requirement |
|---|---|---|---|
| Carlton/222 — Alick Barningham | 20 / {1, 23} | No row-level prior adjudication located; E2 informational-only policy applies | Retain the reported disagreement. Direct jumper evidence is needed only if a correction or individual explanation is sought. |
| Carlton/245 — Ned Bowen | 21 / {2} | Same evidence boundary | Same requirement. |
| Carlton/312 — Robert White | 25 / {22} | Same evidence boundary | Same requirement. |
| Fitzroy/1038 — Brendan Ryan | 21 / {40} | Same evidence boundary | Same requirement. |
| Richmond/576 — Graeme McCartney | 19 / {1} | Same evidence boundary | Same requirement. |
| West Coast/266 — Aaron Black | 47 / {26} | Same evidence boundary | Same requirement. |
| West Coast/267 — Angus Dewar | 49 / {39} | Same evidence boundary | Same requirement. |
| West Coast/268 — Stefan Giro | 48 / {22} | Same evidence boundary | Same requirement. |
| Western Bulldogs/414 — Nick Gelavis | 14 / {6} | Same evidence boundary | Same requirement. |

No source is declared wrong. General commentary that registers print one number and match rows several is not an explanation of disjoint sets in these specific rows. No new exemption is needed to reproduce the existing informational predicate, but this review does not approve source values, mappings or stage applicability. External verification of jumpers is not proposed as a prerequisite for retaining current informational treatment.

## 5. Remaining boundary and one concrete proposal

**Next proposal: request an owner decision authorising an external-evidence review restricted to Collingwood Caps 162, 182, 615 and 649.** Its deliverable would retain exact register/profile/match evidence and explain or leave unresolved the four goal differences, explicitly preserving Victor Jackson's blank separately from zero. No source edits, identity decisions, aliases, acceptance or stage execution would be included. No further local measurement is proposed because it cannot decide which already-measured total or blank meaning is justified.

The nine spelling categories and informational jumper policy can be carried forward as documented limitations for consideration, with their current rejection/reporting behaviour intact. They are not approved successor exceptions. Individual jumper histories and all identity-changing proposals remain unverified. Any future source correction, blank-Goals policy, identity exception or runner/contract change needs separate authority and review. Fresh binding verification of predecessor records remains limited as disclosed in §1; it cannot be silently replaced by this note's existence.

All field/availability, successor and stage-applicability decisions remain pending. ET applicability unresolved. All three 2026 Brownlow keys — `brownlow_match_votes`, `brownlow_round_votes`, `brownlow_season_total` — remain pending. Canonical suppression/publication, AFL API authority, eligibility and ownership restrictions unchanged. 1,640 remains rehearsal-only; no active-reference change or production acceptance.

## 6. Changes and validation

Created this review; updated only necessary ISSUE-316 links/next actions in `IssuesIndex.md`, `issues.md`, `issues/open/AFLDB-ISSUE-316.md` and `docs/v2/issue316-c2-preparation-2026-10-21.md`. ISSUE-316 stays OPEN; index/Open Issues membership unchanged. Investigation-only: no CHANGELOG entry. Earlier worksheets remain historical records and were not rewritten. Unrelated changes and `.codex/` untouched.

Validation consists of bounded retained-record inspection and comparison with completed worksheet observations, with the hash/tool limitation in §1. No new reconciliation, shell/Git, network, host/database, WSL, installation, acquisition, census, gates, rebuild, D7, rehearsal, cleanup, commit/push or deployment. No source correction, identity rule, acceptance, threshold relaxation, policy or runner/contract change. Stop.
