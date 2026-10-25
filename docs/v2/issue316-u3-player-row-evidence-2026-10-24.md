# ISSUE-316: U3 extra player-row evidence and U4 Route B (2026-10-24)

**Current status (2026-10-25): U3 CONFIRMED.** The historical investigation and pending wording below are superseded by the accepted correction, derived/period/aggregate checks and [executed metadata repair v5](../../issues/open/AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V5-RECORD.md). U4 Route B; Brownlow untouched; production NO-GO.

**Subsequent owner ruling:** the single audited correction is authorised. The 10:54:47Z read-only precheck
passed, but browser availability blocks execution; no correction was submitted. U3 remains unconfirmed.
See the [current execution record](../../issues/open/AFLDB-ISSUE-316-u3-correction-20261024/RECORD.md).
The proposal and earlier investigation below are preserved as history.

Production remains **NO-GO**. Ordinary 2026 settlement check remains **PASS**, but **U3 is not confirmed**.
This record proposes a correction; no correction was executed. ISSUE-316 remains OPEN.

## Exact row and provenance

| Field | Evidence |
|---|---|
| Canonical row | `player_match_stats.id=705437` |
| Player | Brayden Fiorini, `player_id=2121`, slug `brayden-fiorini` |
| Match | `match_id=17214`, 2026-03-28, round 4, Essendon 69–81 North Melbourne |
| Natural match key | `2026|4|2026-03-28|Essendon|North Melbourne` |
| Represented club | Essendon, `club_id=6`, jumper 8 |
| Row owner | `source_id=6` / `afl_api`; the match remains `source_id=10` / `afltables` |
| Source record | `CD_M20260140305|CD_T50|CD_I993799`, family `player_match_stats`, version 1 |
| Canonical application | `id=20834`, verb `insert`, target `{player_id:2121, match_id:17214}`, previous values NULL |
| Application time | 2026-09-27T21:11:30.460661Z |
| Batch | `32`, `settle-afl-api.ts`, completed; 10,417 observations read/inserted, 0 updated/rejected |
| Source payload hash | `828744dee7dea294f7afe819508fdc8ba0d38786cf6afc356c7fb5d2af7706a5` |

All 21 ordinary canonical statistics are zero. `career_game_no=126` is present now but was absent from the
application's proposed fields; it is derived, not independent evidence that he played.

The retained source payload explicitly names Fiorini and carries `player.player.position=EMERG`,
`playerStats.timeOnGroundPercentage=0`, and an all-zero statistics vector. The current API projection agrees.
The application history for this player/match has exactly one entry: the insert above. No later machine
update/delete supersedes it. This is one erroneous appearance, not two duplicate rows at the same key.
The canonical unique constraint is `(player_id, match_id)` (migration 004).

**Established adjudication:** this exact provider/player/match is the unused emergency already identified and
ruled in [ISSUE-255](../../issues/closed/AFLDB-ISSUE-255.md) and ISSUE-233 §4.11.11. ISSUE-255's suppression fix
was committed as `f6d189d0` on 2026-10-01; this production insert predates it. The root cause was treating every
API statistics entry as an appearance. Current code checks non-participation before identity resolution
(`src/lib/acquisition/afl-api-settle-plan.ts:460`). The full predicate uses the separate roster, zero TOG and
all projected statistics zero (`src/lib/acquisition/afl-api-bundle.ts:475`); the nested stats-payload position alone
is not substituted for that roster check. This query returned no separate lineup projection for this key;
the prior exact-key adjudication supplies the established unused-emergency classification.

## Identity, duplicate and rebuild checks

- Production has 10,029 2026 player rows; current AFL Tables staging has 10,028. A two-way anti-join at
  `(match_key,player_id,club_id)` returns exactly this one canonical-only key and **zero** staging-only keys.
- Essendon in this match has 24 canonical/API rows versus 23 AFL Tables rows. The suspect player has one
  canonical row for this match across clubs. The AFL Tables 23 profiles name 23 different players; none is an
  equivalent Fiorini record under another identity. There is only one canonical player with his normalised name.
- External identities agree: `afl_api:CD_I993799 → 2121` (unique; exact-stat-vector bootstrap on two games) and
  `afltables:players/B/Brayden_Fiorini.html → 2121` (unique; profile URL). No identity reassignment is proposed.
- Fiorini has exactly two AFL Tables 2026 appearances: round 2, 2026-03-13, career game 124; round 3,
  2026-03-22, career game 125. Canonical has those two plus the phantom round-4 game 126.
- Independently parsed the retained frozen `c2-2026-final-core-v1/player_stats_2026.csv`: **10,028** rows;
  Essendon's round-4 23 profile URLs exactly equal current staging's 23; Fiorini is absent from that match and
  appears only in rounds 2 and 3 under the same profile/fitzRoy ID 12481.
- Frozen manifest SHA-256 `02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988` equals the J2 change-set's `core_manifest` pin.
  The CSV hash `79db69732ea1018b577e548622e6c702c1a79270478cc019dc80571fc217898f` equals that manifest's file entry (10,028 rows).
  Thus J2's bound source omits this exact erroneous appearance; the one-row production/staging key difference
  explains the 695,500 versus 695,499 overall totals. This is membership evidence, not a fresh full value-equivalence
  proof or permission to discard the row automatically.

## Proposed audited correction — requires separate owner approval

Use **`data_editor`**, the Data Editor Match Sheet for match 17214, to remove only player 2121. The local
implementation has the required same-transaction removal, durable `data_overrides` authority and `data_edits`
audit, followed by derived-stat recomputation (`src/db/queries/match-sheet.ts:240`, `:280`, `:315`, `:337`).
The action requires `data.dataEditor` (`src/app/admin/data-editor/actions.ts:207`).

Before any approved execution, verify the deployed workflow/version and permissions, load a fresh sheet/stale
token, and require the reviewed change to contain only `removedPlayerIds=[2121]`, with no other field/score
changes. Preserve the API observation, source-version/payload, batch and original canonical application.
Use durable removal intent so a later source run cannot silently reinsert the appearance. Verify the resulting
canonical absence, durable override, audit note, corrected appearance totals/derived statistics and unchanged
Brownlow vote rows. Any affected successor/correction material must be regenerated and reviewed before use;
this proposed non-date correction must not be smuggled into U2's date-only permission.

Proposed decision note (not yet an executed owner decision):

> Remove only Brayden Fiorini (player_id 2121), Essendon (club_id 6), from match 17214 (2026 round 4, 2026-03-28). Canonical row 705437 was inserted by canonical application 20834, AFL API batch 32, on 2026-09-27T21:11:30.460661Z. This is the unused-emergency case adjudicated in AFLDB-ISSUE-255: EMERG, zero time on ground, all projected statistics zero. The retained payload hash is 828744dee7dea294f7afe819508fdc8ba0d38786cf6afc356c7fb5d2af7706a5. The J2-bound AFL Tables baseline contains the other 23 Essendon participants and only Fiorini’s genuine rounds 2 and 3 appearances. Preserve source observations and canonical audit history; record durable row absence and recompute affected derived statistics. This decision does not adjudicate Brownlow 2026.

Expected row counts after that correction, if approved and verified with no intervening changes: 10,028 in
2026, 695,499 overall; Essendon round-4 participants 23; Fiorini 2026 appearances 2. No fix, settle, new test,
service change or database write was performed in this investigation. The existing suppression implementation
remains resolved under ISSUE-255; historical production residue is tracked under ISSUE-316/U3, with no duplicate issue.

## U4 ruling: Route B

Brownlow 2026 does not block the ordinary 2026 seal. It is a separate U4 workstream. Do not move settlement
ahead of C2 to preserve the normal writer, and never use the normal production
`settle-afl-api-brownlow.ts` writing path for 2026 after the seal.

The three pending keys remain `brownlow_match_votes`, `brownlow_round_votes` and `brownlow_season_total`.
Before any correction, map **each** key's actual decision to its audited workflow, with the specific evidence,
actor and decision note the workflow requires. The route decision does not assign all three to one workflow:

| Actual decision | Permitted post-seal workflow and evidence requirement |
|---|---|
| Brownlow source/season authority or vote-entry decision | `brownlow_authority`; establish the authority/vote-entry scope and supporting vote evidence, and the authority/entry audit decision |
| Player-season eligibility ruling | `brownlow_eligibility_decision`, only after migration 113 is installed; verdict, citation, note, actor and basis, with the sealed-season correction record |
| Specific canonical fact correction supported by evidence | `data_editor`; exact entity/field scope, before/after evidence and decision note, with atomic edit audit and applicable durable intent |

These routes are not interchangeable. No per-key correction mapping is claimed complete here and no Brownlow
correction is authorised by this record. The existing **9,522 AFL Tables round-vote rows are not adjudicated**:
no deletion, replacement, publication or other alteration under this approval.

## U3 and day-D controls

The owner accepted the ordinary completeness PASS (218/218 settled, AFL Tables-owned, complete scores/periods/
player rows, no ordinary backlog or eligible AFL API settle, Brownlow excluded). U3 remains unconfirmed pending
the owner's adjudication of this exact row and an approved, verified disposition.

The AFL Tables nightly remains an authorised pre-seal writer until its retirement/disable step. Legitimate
pre-seal AFL Tables corrections become current 2026 state. On actual production day D, **before the enforced
dry run**, re-check the latest nightly result and require no unexplained canonical change since candidate
preparation. If canonical data changed, regenerate/re-pin every affected production material and review it
before proceeding. No dry run, census or other day-D action is authorised now.

Intended final U3 wording, **not yet confirmed**:

> Ordinary 2026 settlement is complete. No further ordinary 2026 AFL API settle is required before the seal.
> Later 2026 changes require an audited correction. Brownlow 2026 is excluded from U3 and proceeds independently
> under U4 through an approved post-seal audited workflow.

## Execution evidence and limitations

Raw evidence stays outside the repository at `C:/Users/stuar/AppData/Local/Temp/afldb-i316-u3-row-20261024-QRgJaq` (`SHA256SUMS`).
Production snapshot: **2026-10-24T10:11:16.291452Z**, `afldb_prod` / `afldb_backup`, OID `66668`, system ID
`7674454702926115004`. The query ran once, in one `REPEATABLE READ READ ONLY` transaction, with identity and
read-only gates, statement/lock timeouts and explicit ROLLBACK. Password was confined to the child environment;
no credential was printed or put on argv (output scan: zero DSN/password-assignment hits).

The first Windows SSH alias lookup failed before connection; a direct-IP attempt was blocked locally. The
network escalation then connected to the documented `arm@209.38.87.252` target. SQL completed, rolled back and
reached `READ_ONLY_PROVENANCE_QUERY_COMPLETED`, with no psql ERROR/FATAL. **SSH nevertheless exited 127**:
PowerShell's stdin framing appended a CR-only shell command (`$'\r': command not found`). This transport error
is retained, not represented as exit 0, and the production query was not repeated.

- Query script SHA-256: `0bbe49c1485b04b3c57fb241c0c0eea5779709e605d06b5ff11b01fb01ff569c`.
- Raw production log SHA-256: `7eaf96621ba2d5469b30f1b7f7d091332858c9e7a3e8d1ebb75108ce1ecfb827`.
- Codebase graph tools were unavailable; focused native file reads supplied source evidence. No shell inspection,
  Git, tests, database census, settle, correction, migration, advisory/destructive lock, service change, seal,
  enforced dry run, activation, apply, deployment or push was executed. The only shell execution was the
  authorised read-only SSH query and the failed connection attempts.
