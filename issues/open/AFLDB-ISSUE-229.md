# AFLDB-ISSUE-229 — AFL API fixture ingestion

**Status:** Open. **Severity:** Medium. **Opened:** 2026-09-23 (ISSUE-228 §13.1, §16 S10).
**This runbook:** created 2026-09-26 in the bulk successor pass on
`opus/afl-api-successors-229-234` (base `main` `2e587415`). Uncommitted.

**State after pass 1:** **BLOCKED ON SOURCE EVIDENCE.** No fixture-writer code was written.
The shared season enumeration from ISSUE-231 now reports the provider's status vocabulary
verbatim on every settle, so the evidence can be collected without new code.

**State after pass 2 (2026-09-26, uncommitted): PARTIALLY EVIDENCED — STILL BLOCKED.** One
genuine pre-match record now exists as hash-bound evidence (§2a). It defines the `SCHEDULED` row
only. It does not define the contract, so no fixture ingestion was implemented.

---

## 1. The contract ISSUE-228 already decided (§12, §13.2–§13.5)

- **One family, one identity.** `afl_api.match`, keyed by `CD_M…`, is the same record at every
  status. The spine already holds its transition history.
- **Status-selected target.** `fixtures` before `CONCLUDED`; `matches` from `CONCLUDED` (the
  existing ISSUE-228 path).
- **Upsert by `(source_id = afl_api, source_record_id = CD_M)`.** `fixture_key = randomUUID()` is
  minted once (the 097 rule) and never derived. `fixtures_source_record_uq` already exists.
- **Precedence (ISSUE-162 §7).** A manual row is never overwritten. A manually created fixture
  for the same real-world match is detected by `(season, round_code, home, away)` equality and
  reported as `foreign_owned_collision`, never merged.
- **Changes while pre-match.** Date/time/venue/round → `rescheduled`; clubs → `corrected`. Both
  auto-apply only onto an `afl_api`-owned, unlocked row with no active `data_overrides` row.
  Contradictions become candidates plus `data_issues`.
- **Absence** is a review signal only, never a DELETE. It uses the ISSUE-231 sweep, which is
  itself blocked on D-231-1.
- **Transition to `CONCLUDED`.** The match family inserts `matches`. The fixture row is never
  mutated by it, and no `match_id` is stored (ISSUE-162 D-6).
- **Migration.** Widen `canonical_applications_target_table_ck` to admit `fixtures` (§12:
  "decided now, executed later"). That is the only schema change the plan names.

## 2. Why implementation stops here (the brief's first stop condition)

1. **No genuine pre-match season-feed payload is retained in this repository.**
   - `tests/fixtures/afl_api/match/01-fixture-result.json` is `CONCLUDED`.
   - `data/sources/afl_api/` does not exist in this worktree (gitignored, host-local).
   - ISSUE-228 §2.1 records `CONCLUDED` only, plus `POSTGAME` from the operator's monitor, and
     calls pre-match values "unobserved… must be measured, never assumed" (§15 Q4).
2. **The one `SCHEDULED` record anywhere is a simulator artefact** (`issues.md`, ISSUE-228 S7
   follow-up, `CD_M20250140807`). It reported a match that had been played as `SCHEDULED` with no
   score block. It is evidence of neither the vocabulary nor the shape.
3. **`UNCONFIRMED_TEAMS` / `PROVISIONAL_TEAM`** (migration 077, acquisition doc §13.3) belong
   to the lineup/roster endpoint's `status` and `teamStatus`, not the season matches feed. They do
   not transfer.
4. **The shape matters as much as the words.** The `afl_api.match` registry contract makes all six
   score fields `required_columns` (`home.score.goals` … `away.score.totalScore`). If a real
   pre-match record omits its score block, as the simulator's did, it is refused as a build
   failure before any fixture logic runs. Relaxing required columns by status is a contract change
   that must be made from measured payloads.
5. **Target vocabulary.** `fixtures.status` is `scheduled | cancelled | void` (migration 097).
   How a provider postponement or cancellation appears in the feed (a status? a date change? the
   record vanishing?) is unobserved. Mapping it now would be inventing it.

The code can be structured around an explicit observed-status table in which unknown values
refuse. That structure is not built yet, because each row must cite a measurement.

## 2a. Pass 2 — the one genuine pre-match record (re-evaluation)

Found by operator-authorised read-only inspection of `D:\dev\testAFLGrab`
(`D:\dev\afldb-issue-228` no longer exists):

- **`CD_M20260142901`**, the 2026 Grand Final (Fremantle `CD_T60` v Brisbane Lions `CD_T20`, MCG
  `CD_V40`, round `CD_R202601429` "GF" roundNumber 29), `status: "SCHEDULED"`, `utcStartTime
  2026-09-26T04:30:00.000+0000`.
- **Authentic, not a simulator artefact** (high confidence): it sits inside the retained raw
  season feed `AFLGamesSamples\00-season-matches.raw.json` (sha256 `9c358984…75ee`), retrieved
  2026-09-19T10:29:29Z (README lines 2 and 9–10, `source-manifest.json`) by
  `grab-afl-current-sample.ps1` with raw `Invoke-WebRequest .Content`. That is 7 days BEFORE the
  match, so `SCHEDULED` was the true state. It is consistent with the rest of the file (both
  preliminary finals CONCLUDED, latest CONCLUDED start 2026-09-19T07:15Z). No simulator, mock or
  generator exists in that tree. The previously known simulator record `CD_M20250140807` is
  `CONCLUDED` there; its `SCHEDULED` form is not in either tree.
- **Retained minimal raw evidence:** `tests/fixtures/afl_api/match/04-season-feed-scheduled.raw-slice.json`,
  a byte-exact slice of that feed (bytes 317,497–318,553 of the original captured response, no
  re-serialisation), 1,056 bytes, sha256
  **`4d22766d4755aeb1271829a4285cf040c7302ad3b49d3a2a9a732c3505bb5d7a`**. The whole feed is also
  retained (ISSUE-231 §2a) as a sanitised derivative, in which the same slice sits at bytes
  **317,211–318,267**; a test proves the slice is a substring of that committed feed at offset
  317,211. The 286-byte shift is caused solely by replacing the Queue-it token value, which
  precedes the slice; the slice bytes and hash are unchanged.
- **Measured shape:** top-level keys `id, providerId, compSeason, round, home, away, venue,
  utcStartTime, status, metadata`, the same key set as every CONCLUDED entry in the same
  response. **`home` and `away` carry only `team`: there is no `score` block.** It is the only
  entry of 218 without one. `metadata.finals_match_label` is present.
- **Today's contract refuses it** (DB-free test): `afl_api/match is missing required column(s):
  home.score.goals, home.score.behinds, home.score.totalScore, away.score.goals,
  away.score.behinds, away.score.totalScore.`
- The only non-CONCLUDED status anywhere in the sample trees is this one `SCHEDULED`.
  `UNCONFIRMED_TEAMS`, `LIVE`, `POSTGAME`, `POSTPONED` and `CANCELLED` are all unobserved.

**Re-evaluation.** This evidence supports exactly one row of D-229-1 (`SCHEDULED` → `fixtures`)
and one fact for D-229-2 (a `SCHEDULED` record omits both score blocks entirely, rather than
carrying zeros or nulls). It does not define:
- any other pre-match or live status, or how the record moves from `SCHEDULED` to `CONCLUDED`;
- how a postponement, cancellation or reschedule appears (D-229-3);
- whether the `foreign_owned_collision` check covers AFL Tables-derived fixtures (D-229-4);
- the status-conditional `required_columns` rule as a whole (a `LIVE` record may carry a partial
  score block).

Per the brief ("do not implement fixture ingestion unless the observed payload is sufficient to
define its status and required-column contract"), implementation stays stopped. A reasonable
next step, once decided: an observed-status table with the single cited row `SCHEDULED`, every
other value refused and counted, and a `SCHEDULED`-only relaxation of the six score columns. That
still needs D-229-1/2 approved on this one citation, plus the §12 migration.

## 3. Evidence to capture (operator; no code needed)

The ISSUE-231 enumeration prints every status string verbatim, for example `Season feed
CD_S2026014: 218 match(es), complete; statuses observed: CONCLUDED 217, <X> 1.` Two zero-write
ways to use it:

1. **Existing DEV snapshots (no network, no database).** For each retained
   `data/sources/afl_api/matches/<label>/` and `…/fixtures/<label>/` on DEV:
   `npx tsx tools/current-season/settle-afl-api.ts --label <label> --validate-only` (or
   `settle-afl-api-fixtures.ts … --validate-only`). Any snapshot acquired before a finals match was
   played holds that match's genuine pre-match record in `00-season-matches.json`. This is the
   same run as ISSUE-231 rehearsal step 1.
2. **A live capture** while any match is still pre-match or live. The last 2026 candidate is the
   Grand Final, if it has not yet been played. Otherwise use the 2027 fixture once AFL publishes
   it, which needs the 2027 season registered first (ISSUE-233).
   `npx tsx tools/current-season/acquire-afl-api.ts --season <S> --fixtures-only` writes the full
   feed whatever it selects. It reads the ingestion switch, so run it where that database is
   reachable (DEV).

For each non-`CONCLUDED` record, retain the raw object as a hash-bound fixture under
`tests/fixtures/afl_api/match/` (the pattern of §19.5 and Assertion 9). Record its status string,
whether `home.score`/`away.score` are present, and any field absent from the registry's
`known_columns`. Several captures across a match's life (pre-match, live, `POSTGAME`,
`CONCLUDED`) are needed before any row of the table below is filled.

## 4. Decisions that follow the evidence

- **D-229-1:** the observed-status → target table (`fixtures` / deferred / `matches`), each row
  citing a retained payload. Unknown values refuse, and stay visible through `statusCounts`.
- **D-229-2:** the pre-match `afl_api.match` contract: which `required_columns` become
  status-conditional, and how the projection represents "no score yet".
- **D-229-3:** how provider postponement and cancellation map onto `fixtures`
  (`status_reason`, or reschedule only). Cancel/void stays a human action unless the evidence
  says otherwise.
- **D-229-4:** whether `afl_api` fixture rows participate in the `foreign_owned_collision` check
  against AFL Tables-derived rows as well as manual ones. The co-source rule (Q1) covers
  `matches`. `fixtures` has no AFL Tables writer today (`admin-fixtures.ts` and the rebuild's
  `tools/migration/common.py` only).

## 5. Dependencies

- **ISSUE-231 (done in this pass):** the season enumeration, as the evidence surface and the
  future absence carrier.
- **ISSUE-233:** registering the next season (2027 compSeason) is what makes its pre-match feed
  acquirable.
- **ISSUE-232:** the installed nightly timer retains a full season feed every night. In-season,
  that alone accumulates the evidence.

## 6. Files changed (this pass, for this issue)

None specific to ISSUE-229. The status-vocabulary reporting ships with ISSUE-231
(`afl-api-season-enumeration.ts`, both settle CLIs).

Pass 2:
- **N** `tests/fixtures/afl_api/match/04-season-feed-scheduled.raw-slice.json` (authentic
  byte-exact slice, sha256 above)
- **M** `tests/afl-api-match.test.ts` (slice provenance and shape; today's contract refuses it)
