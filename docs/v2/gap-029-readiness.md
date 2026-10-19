# GAP-029 bounded acceptance and backend handoff

**Current owner decision (2026-10-20):** [D-V2-MIGRATION-SEPARATION](migration-acceptance-2026-10-20.md)
approves separate backend-migration and strict Gridley criteria. GAP-029 stays OPEN as data
quality debt: **149 strict / 99 approved / 50 unapproved**. Its 50 findings remain unapproved.
It is no longer an automatic backend blocker only if production-data preservation and query
compatibility prove no newly introduced discrepancy and functional contracts, permissions,
audit and rollback hold. That evidence is currently **INCOMPLETE**; production remains NO-GO.
The recommendation/next-decision section below is historical and superseded by that decision.
See [the concrete rehearsal commands](production-shadow-commands.md). No approved local backup
is available; no synthetic result substitutes for production parity.

2026-10-20; starting HEAD `ed4c429c`, `v2/rebuild`. Owner instruction and approval provenance:
[D-GAP029-21](owner-instruction-2026-10-20.md). This record supersedes earlier 71-unapproved
and unapproved-sibling statements; those remain historical evidence.

| Acceptance dimension | Current assessment |
|---|---|
| Demonstrated backend functionality | Prior isolated PG16 rebuild: 30 stages, migrations through 115, 89 validations; snapshot/replay, promotion, Brownlow publication and 98-season reconciliation, Coleman comparison/publication, and local application rollback demonstrated. These are retained local results, not rerun or production acceptance. |
| Strict frozen-corpus parity | **FAIL: 149 strict findings**, including all 21 approved sibling disagreements. No additional data matches. |
| Conformance to explicit approvals | **FAIL: 50 unapproved findings**. 78 pre-existing deferrals + 21 exact sibling disagreements = **99 approved; 0 data matches**. Approval guards and negative tests pass; the corpus as a whole does not conform. |
| Remaining source coverage | 42 event cells + eight board-date membership cells; UNKNOWN membership where unavailable. [Exact requests](gap-029-source-requests.md). No waived findings or invented data. |
| Production / host acceptance | **NO-GO**. Production-dump shadow parity, Linux execution, host backup/restore and rollback, Caddy/systemd/TLS/service operations, owner visual acceptance and existing ISSUE-316/C4/D-316-13 approvals remain. ISSUE-229 B2 requires authentic 2027 evidence and separate first-apply approval. |

Focused results and commands are retained in `evidence/gap-029-acceptance-verification.json`.
Compatibility/adjudication: **59/59 pass**. Affected Gridley integration: **1,207 pass / three
expected failures** (dataset completeness, strict parity, policy conformance); combined
**1,266 pass / three fail / zero skipped**. Typecheck and changed-file lint pass (zero findings).
All 149 residual membership records compare exactly with the retained baseline; strict finding
content is unchanged apart from structured approval evidence and the approval-neutral detail
prefix. Original strict artifacts remain untouched. No solver cell exceeded four seconds.
The complete workflow's previous **13,740 passed / 9 failed / 31 skipped** is unchanged and
not green. No full workflow, historical rebuild, screenshots or rollback rehearsal was rerun.

## Do the 50 differences affect only Gridley validation?

**No: they expose source coverage gaps in shared canonical data**, while the number 50 counts
Gridley finding cells rather than 50 corrupt matches or players. Existing evidence does not
establish a backend migration defect or general corruption of the stored history.

- Event criteria compile directly against `matches.match_event` joined to
  `player_match_stats` (`src/db/queries/grid-solver.ts:887–927`). The compatibility mapper
  (`src/search/gridley-compat.ts:432–436`) maps Anzac, Dreamtime and Big Freeze onto those
  builders. The corpus probes only whether any event label exists
  (`tests/integration/gridley-corpus.test.ts:293,386–401`). Partial labels would conceal
  incompleteness. Public match detail also selects `match_event`
  (`src/db/queries/matches.ts:86`); this is canonical metadata debt beyond an external oracle.
- Two missing 2026 debutant registrations and incomplete board-date participation prevent
  complete eight-cell intersections, as documented in `gap-029-targeted-recovery.json`.
  The resolver checks both match and registration horizons
  (`tests/gridley-corpus-support.ts:86–130`). `teammate_of` uses shared club/season rows
  (`src/db/queries/grid-solver.ts:976–981`); public player comparison instead joins actual
  match participants (`src/db/queries/player-compare.ts:68–76`). Both rely on canonical
  identity/participation coverage, although their teammate semantics differ. These gaps can
  affect current-season player/stat/relationship answers, not merely test reporting.
- The frozen reference and the local historical baseline have different temporal coverage.
  The eight cells are not proof of complete 2026 coverage elsewhere. No broader census was
  performed or claimed. A September roster and club selection announcements cannot establish
  April/May eligibility. The approved sibling discrepancy establishes no missing senior game.

## Historical recommendation and next owner decision (now decided above)

Recommend **separating exact external Gridley parity from acceptance of a data-preserving
backend migration**, but only by an explicit owner release-policy amendment. Strict 149 and
policy 50 must continue to be reported as failures; GAP-029 and its source requests stay open.
Before any migration acceptance, an approved production-dump shadow must prove that existing
canonical rows, IDs, relationships and affected query outputs are preserved without new
regressions. Agree measurable source-coverage limits and how incomplete event/current-season
answers are presented. This is not evidence that those conditions already hold.

**Concrete next decision:** keep zero-unapproved Gridley conformance as a migration blocker,
or explicitly approve the above separation, with a named scope, production-shadow thresholds,
source-gap owner and acceptance conditions. This task's 21-cell approval does not make that
decision. Until a separate decision is recorded, **GAP-029 remains a release blocker** and
production remains NO-GO. Host and other production gates apply in either case.

## Credential containment

The process-ownership guard verified the dedicated cluster/data directory before authentication
on 127.0.0.1:55433. All five AFLDB roles and the dedicated superuser were rotated using the
existing recovery-first transaction and local secret-file replacement. All six new logins
succeeded; all six old logins failed with PostgreSQL `28P01`. No credentials or DSNs are retained
in evidence. No connection through 55432, remote log inspection, shared credential change or
SSH modification occurred in this task. Earlier shared-development endpoint contact is
supported; successful login, SQL execution and remote cluster identity remain unestablished.
The process-check race and unvalidated Linux ownership branch remain documented limitations.
