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

## 2b. Pass 3 — operator-decision investigation (2026-10-02, read-only)

Branch `sonnet/issue-229-fixture-ingestion`, base `main` `e4026bb2`. Repository reads only: no
network, no database, no DEV/PROD, no Git, no code change.

**1. §2 item 3 is contradicted by later evidence.** The season matches feed does carry
`UNCONFIRMED_TEAMS`. ISSUE-231 §8 (operator-run DEV acceptance, snapshot
`afl-api-2026-2026-09-25-235854`) recorded season-feed status counts `CONCLUDED 217,
UNCONFIRMED_TEAMS 1`. The record id was not recorded, and neither was its shape. The GF was then
the only unplayed 2026 match, so that record is very probably `CD_M20260142901`. That is an
inference from counts, not an observation. The lifecycle evidence for that one match is now:

| When | Status | Evidence | Bytes in repo |
|---|---|---|---|
| 2026-09-19T10:29:29Z | `SCHEDULED` | §2a slice, sha256 `4d22766d…5d7a` | yes |
| snapshot `…-09-25-235854` (before the GF start whether the label is UTC or AEST) | `UNCONFIRMED_TEAMS` | count only (ISSUE-231 §8) | no |
| snapshot `…-10-01-092238` | `CONCLUDED` | count only (ISSUE-232 D1) | no |

**2. More pre-match bytes may already exist on DEV.** Every acquisition writes the whole season
feed (`00-season-matches.json`) whatever it selects (`acquire-afl-api.ts`). The 2026 DEV snapshot labels before the GF named in tracked files are
`afl-api-2026-2026-09-21-011148`, `…-09-21-031725`, `…-09-23-002226` and `…-09-25-235854`. This pass
did not verify that any of them is still on the host. Reading them needs no AFL network fetch.

**3. No other authentic status evidence is tracked.** Every `POSTGAME`/`LIVE` test case
(`tests/afl-api-match.test.ts`, `tests/afl-api-settle-plan.test.ts`,
`tests/afl-api-player-bridge-cli.test.ts`) mutates the status string of a `CONCLUDED` payload and
keeps its score block. Those cases are synthetic and are not shape evidence. `POSTGAME` comes only from the
operator's monitor (ISSUE-228 §7.3). `LIVE`, `POSTPONED`, `CANCELLED` and any TBC date/time
representation are unobserved.

**4. Decisions the D-229-1..4 list omits** (found by reading the current code):
- **D-229-5: date and time.** `fixtures.match_date`/`match_time` are venue-local, and NULL means
  "genuinely unknown / TBC" (097). The `afl_api.match` registry notes forbid projecting
  `match_date`/`match_time` from `utcStartTime` alone for a `matches` write. The only conversion in
  use (`convertUtcInstantToVenueLocal`) is a read-only correlation in
  `afl-api-fixture-identity.ts`. Leaving both NULL would misstate a known start as TBC, and deriving
  them is a new write rule. How the provider marks a TBC time is unobserved.
- **D-229-6: human edits of an `afl_api` row.** `admin-fixtures.ts` `lockFixture()` and `editFixture()` are
  source-agnostic. An edit writes a `manual_admin_edit:<token>` override, and
  `replay_admin_overrides('fixtures')` re-creates the row as `source_id = manual_admin_edit`
  (`tools/migration/common.py` 2302–2323). A rebuild therefore turns that row into a manual one, and
  the next AFL API run then meets it as a `foreign_owned_collision`.
- **D-229-7: durability.** `fixtures` is a registry table, so a rebuild or promotion empties it. Replay
  restores only the rows that have an override. A re-ingested `afl_api` fixture gets a new
  `fixture_key`. The ISSUE-233 census counts `matches` only.
- **D-229-8: spine scope.** Persisting pre-match payloads into the `afl_api`/`match` family brings
  them inside the ISSUE-231 absence sweep for `season=<S>`. An unplayed match that the provider removes
  (the unobserved cancellation shape) would then HALT the `CONCLUDED` settle (D-231-3).
- **Superseded premise in §1:** "the match family inserts `matches`" on `CONCLUDED`. An
  `afl_api` first write of a match is now refused operationally (ISSUE-232 D1, ISSUE-233 D-233-3).
  Played linkage stays the read-time ISSUE-162 §18 resolution (season, `round_code`, club pair
  in either orientation) against whichever source owns the `matches` row. Fixture identity does not change.

**5. Input availability.** All 218 matches in the 2026 feed are `CONCLUDED` (2026-10-01). A writer
built now has no live pre-match input until the 2027 season feed is published and 2027 is declared
(the `afl-api-identities.json` season, ISSUE-233, plus an `afl_api_2027` round vocabulary).

## 2c. Pass 6 — B1 evidence (operator-run on DEV, 2026-10-02)

**Execution.** The operator ran the §3a command.
- Host `streamanator`, Python 3.12.3.
- Read-only SSH/file inspection only: no database, no service action, no remote file write, no
  AFL API fetch.
- Final output: `B1 RESULT present=2/4 violations=0`, `EXIT 0`.

**Snapshots present on DEV:**

| Label | Manifest sha256 | Feed (`00-season-matches.json`) sha256 | Feed bytes | Status counts |
|---|---|---|---|---|
| `afl-api-2026-2026-09-21-011148` | `dcbd0626e64a6fcf0ed9c73e910b8b83c10aae50a8552e69be172df184c33ecb` | `a44065703717566379c4349eb8959eaf11e990df5b984dd669b7f0db4682a058` | 318,465 | `CONCLUDED 217`, `SCHEDULED 1` |
| `afl-api-2026-2026-09-25-235854` | `afb2a754943fba59a48eabf0bf01dbae7e64046e012318864dc84f68c96907c7` | `ec7eb186d19a4900ceb16576e7ab30a9c85c0994fcad2da89ceb2bcb7ffac390` | 318,473 | `CONCLUDED 217`, `UNCONFIRMED_TEAMS 1` |

**Absent on DEV during B1:** `afl-api-2026-2026-09-21-031725` and `afl-api-2026-2026-09-23-002226`.

**The non-`CONCLUDED` record in each snapshot (byte-exact slices, cut and verified by the §3a
script):**

| Snapshot | Provider id | Status | Offset | Bytes | Raw-slice sha256 |
|---|---|---|---|---|---|
| `…-09-21-011148` | `CD_M20260142901` | `SCHEDULED` | 317,317 | 1,146 | `e7c7aedf239d1028dd2f1b485ac45222248a12733d4e847d4453781e9d4c139a` |
| `…-09-25-235854` | `CD_M20260142901` | `UNCONFIRMED_TEAMS` | 317,317 | 1,154 | `e39ac375cabf5f1fc2f182e4e7e28e53d072a4a8d49001320d163bb904867da7` |

No enqueue-token warning was emitted for either slice.

**Shape result (operator-reported).** The recovered 09-21 `SCHEDULED` and 09-25 `UNCONFIRMED_TEAMS`
raw JSON objects differ **only in the value of `status`**. Both have:
- `utcStartTime` `2026-09-26T04:30:00.000+0000`, round `CD_R202601429`, venue `CD_V40`, and
  `venue.timezone` `Australia/Melbourne`;
- home `CD_T60`, away `CD_T20`;
- top-level keys `id, providerId, compSeason, round, home, away, venue, utcStartTime, status,
  metadata`;
- `home` and `away` keys: `team` only, so there is **no `home.score` or `away.score` block**;
- metadata key `finals_match_label` only.

The 8-byte length difference (1,154 − 1,146) equals `len("UNCONFIRMED_TEAMS") −
len("SCHEDULED")`, which is consistent with that report.

**What this settles.**
- The §2b inference is now observed. The 2026-09-25 `UNCONFIRMED_TEAMS` record is
  `CD_M20260142901`.
- §2 item 3, which said `UNCONFIRMED_TEAMS` belongs only to the roster endpoint, is disproved for
  the season feed by authentic bytes.
- The observed lifecycle for this match is: `SCHEDULED` (09-19, tracked slice; 09-21, DEV) →
  `UNCONFIRMED_TEAMS` (09-25, DEV) → `CONCLUDED` (10-01, DEV, counts only).

**Not settled by B1 (do not infer).**
- The 09-21 `SCHEDULED` slice (1,146 bytes, `e7c7aedf…`) is **not** byte-identical to the tracked
  09-19 slice (1,056 bytes, `4d22766d…`). The 90-byte difference lies outside the fields the §3a
  `SHAPE`/`COMPARE` lines print: top-level, `home`, `away` and `metadata` key lists, plus the named
  values above. B1 did not characterise it.
- **Pass 7 update.** Now that the 09-25 slice is tracked (below), the **tracked 09-19 `SCHEDULED`**
  and **tracked 09-25 `UNCONFIRMED_TEAMS`** records can be compared directly. They differ in
  exactly four leaf paths, which a test pins:
  - `compSeason.currentRoundNumber`: 28 → 29;
  - `round.utcStartTime` and `round.utcEndTime`: absent → `2026-09-26T04:30:00.000+0000`;
  - `status`.

  Both round fields are already declared in the registry's `known_columns`. That pair of
  added round fields is exactly 90 bytes, and 28 → 29 keeps the length. So, together with B1's
  report that 09-21 and 09-25 differ only in `status`, the 09-19 → 09-21 difference is consistent
  with those three non-status changes. The 09-21 bytes are not tracked, so that remains an
  inference.

  The 09-19 and 09-25 records are therefore **not** claimed to differ only in `status`. B1's
  "only `status`" result covers the recovered 09-21 and 09-25 records only.
- Whether `UNCONFIRMED_TEAMS` arrives for every match, and how long before the start, is not known.

**Historical note: `-09-21-011148`.** ISSUE-228 (runbook top block and §20, 2026-09-22) recorded
that snapshot's bytes as "absent from every local root" and superseded it as acceptance evidence
under D-9b. That statement stands as the observation made at that time. B1 later (2026-10-02)
observed the snapshot present on DEV, with the full manifest sha256 above, whose prefix
`dcbd0626` matches the prefix ISSUE-228 recorded. That does not reverse D-9b: `-09-21-031725`
remains the ISSUE-228 S9 acceptance snapshot. The §3a note quoting ISSUE-228 is left unchanged.

**Evidence retention: RETAINED, byte-exact and hash-verified (pass 7, 2026-10-02). B1 is
COMPLETE.**
- **Path:** `tests/fixtures/afl_api/match/05-season-feed-unconfirmed-teams.raw-slice.json`.
- **Content:** provider id `CD_M20260142901`, status `UNCONFIRMED_TEAMS`.
- **Size and hash:** 1,154 bytes, sha256
  `e39ac375cabf5f1fc2f182e4e7e28e53d072a4a8d49001320d163bb904867da7`.
- **Source:** snapshot `afl-api-2026-2026-09-25-235854`, feed (`00-season-matches.json`) sha256
  `ec7eb186d19a4900ceb16576e7ab30a9c85c0994fcad2da89ceb2bcb7ffac390`, byte offset 317,317.
- **How it was made:** the operator wrote it from the B1 `B64` output with the command below, which
  checks length, hash and token before writing.
- **No token material:** none was detected, either by B1 (no enqueue-token warning) or by the
  command's own check.
- **Score blocks:** neither `home.score` nor `away.score` is present.
- **Git treatment:** `.gitattributes` gives it `-text -diff !eol`, the same as the `04-…` slice, so
  Git never rewrites its bytes on any platform.
- **Tests:** `tests/afl-api-match.test.ts`, in the describe block "against AUTHENTIC retained bytes
  (AFLDB-ISSUE-229 B1, …)". Three tests cover:
  - the hash, length, absence of a token, key sets, absent score blocks, start time, venue,
    timezone and clubs;
  - the exact four-path difference from the tracked 09-19 slice;
  - the fact that today's match contract refuses the record on the six score columns, the same as
    the `SCHEDULED` record.

The retention command, kept as provenance (local only, no network):

```powershell
$b64  = '<paste the B64 value here>'
$want = 'e39ac375cabf5f1fc2f182e4e7e28e53d072a4a8d49001320d163bb904867da7'
$path = 'D:\dev\afldb-issue-229\tests\fixtures\afl_api\match\05-season-feed-unconfirmed-teams.raw-slice.json'
$bytes = [Convert]::FromBase64String($b64.Trim())
$sha = -join ([Security.Cryptography.SHA256]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
if ($sha -ne $want) { throw "sha256 mismatch: $sha" }
if ($bytes.Length -ne 1154) { throw "length mismatch: $($bytes.Length)" }
if ([Text.Encoding]::UTF8.GetString($bytes) -match '(?i)enqueuetoken') { throw 'token material present; do not retain' }
if (Test-Path $path) { throw "already exists: $path" }
[IO.File]::WriteAllBytes($path, $bytes)
(Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
```

**Next evidence gate: B2.** The first authentic 2027 pre-match season feed is still required before
the fixture writer is wired or applied. ISSUE-229 remains Open.

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

## 3a. B1 — recover the retained pre-Grand-Final bytes (operator-run, read-only; prepared 2026-10-02)

**The snapshot contract** (`tools/current-season/acquire-afl-api.ts:132-137`, `:153-165`,
`:243-248`, `:296-373`):
- **Location:** `<repo>/data/sources/afl_api/matches/<label>/`. A `--fixtures-only` run uses
  `…/fixtures/<label>/`. DEV's repo is `/home/arm/projects/afldb` (ISSUE-232 runbook).
- **Label:** `afl-api-<season>-<YYYY-MM-DD>-<HHMMSS>`, in **UTC**. `-09-25-235854` is
  2026-09-25T23:58:54Z, about 4.5 hours before the Grand Final (04:30Z). `claimSnapshotDir()` may
  add a suffix on a collision.
- **`00-season-matches.json`:** the HTTP body text written as UTF-8 and never re-serialised.
- **`<CD_M>/fixture.json`:** a re-serialised derivative (`JSON.stringify(…, null, 2)`), written for
  selected matches only. Selection defaults to `CONCLUDED`, so a pre-match record exists only
  inside `00-season-matches.json`.
- **`manifest.json`:** written last. It has `source_key`, `acquisition_kind`
  (`afl_api_match_snapshot`), `fixtures_only`, `label`, `season`, `selection`, `acquired_at`,
  `counts`, and `files[]` with a `sha256` of each file's UTF-8 bytes plus HTTP status and
  `retrieved_at`.
- **Manifest sha256 recorded in tracked files:**
  - `-09-25-235854`: `afb2a754943fba59a48eabf0bf01dbae7e64046e012318864dc84f68c96907c7` (ISSUE-237, ISSUE-252).
  - `-09-21-031725`: `5018a3d6e68329170836fb84520e6b4181124bf2807e1c2f0cb9708660de0b62` (ISSUE-228 §20).
  - `-09-21-011148`: `dcbd0626…`, prefix only. ISSUE-228 recorded its bytes as "absent from every local root".
  - `-09-23-002226`: no hash is tracked.
  - No feed (`00-season-matches.json`) hash is tracked for any of them.
- **Retention:** no pruning code for these directories exists in `deploy/` or `tools/`.
  `-09-25-235854` is also the hash-bound promotion input of ISSUE-252/238. Its presence on the host
  is unverified.

**Extraction contract** (the same as the §2a slice). The record's bytes are cut from the raw
feed and nothing is re-serialised:
- the slice runs from `{"id":<id>,"providerId":"<CD_M>"` to its balanced closing brace;
- it must re-parse equal to the parsed record;
- it is printed as raw text and as base64, with its byte offset and sha256.

Before any such slice is committed, check it for a third-party ticket-queue token, under the
ISSUE-231 §2a sanitisation precedent.

**Operator command (Windows PowerShell on the workstation).** One SSH connection to
`arm@10.0.40.100` (streamanator). On the far side it runs standard-library `python3 -B` from
stdin. It makes no database connection, takes no service action, fetches nothing over HTTP and
writes no file. The exit code is 0 when the 09-25 snapshot is verified, 1 when that snapshot is
missing, and 2 on any layout or hash contract violation.

```powershell
$py = @'
import base64, hashlib, json, os, socket, sys
from collections import Counter
ROOT = '/home/arm/projects/afldb'
MATCHES = ROOT + '/data/sources/afl_api/matches'
FIXTURES = ROOT + '/data/sources/afl_api/fixtures'
LABELS = ['afl-api-2026-2026-09-21-011148', 'afl-api-2026-2026-09-21-031725',
          'afl-api-2026-2026-09-23-002226', 'afl-api-2026-2026-09-25-235854']
RECORDED = {'afl-api-2026-2026-09-21-011148': 'dcbd0626',
            'afl-api-2026-2026-09-21-031725': '5018a3d6e68329170836fb84520e6b4181124bf2807e1c2f0cb9708660de0b62',
            'afl-api-2026-2026-09-25-235854': 'afb2a754943fba59a48eabf0bf01dbae7e64046e012318864dc84f68c96907c7'}
FEED = '00-season-matches.json'
GF = 'CD_M20260142901'
TARGET = 'afl-api-2026-2026-09-25-235854'
bad = []
def say(*a): print(*a, flush=True)
def sha(b): return hashlib.sha256(b).hexdigest()
def rd(p):
    with open(p, 'rb') as f: return f.read()
def span(buf, start):
    depth, in_str, esc = 0, False, False
    for i in range(start, len(buf)):
        c = buf[i]
        if in_str:
            if esc: esc = False
            elif c == 0x5C: esc = True
            elif c == 0x22: in_str = False
        elif c == 0x22: in_str = True
        elif c == 0x7B: depth += 1
        elif c == 0x7D:
            depth -= 1
            if depth == 0: return i + 1
    return -1
def shape(x):
    h, a = x.get('home') or {}, x.get('away') or {}
    return {'status': x.get('status'), 'utcStartTime': x.get('utcStartTime'),
            'round': (x.get('round') or {}).get('providerId'), 'venue': (x.get('venue') or {}).get('providerId'),
            'venue_tz': (x.get('venue') or {}).get('timezone'),
            'home': (h.get('team') or {}).get('providerId'), 'away': (a.get('team') or {}).get('providerId'),
            'keys': list(x.keys()), 'home_keys': list(h.keys()), 'away_keys': list(a.keys()),
            'metadata_keys': sorted((x.get('metadata') or {}).keys())}
def emit(label, fb, x):
    pid, rid = x.get('providerId'), x.get('id')
    if not isinstance(pid, str) or type(rid) is not int:
        bad.append('%s: non-CONCLUDED record without integer id / string providerId' % label); return
    head = ('{"id":%d,"providerId":"%s"' % (rid, pid)).encode()
    if fb.count(head) != 1:
        bad.append('%s %s: record start absent or not unique (layout differs)' % (label, pid)); return
    s = fb.index(head); e = span(fb, s)
    if e < 0 or json.loads(fb[s:e]) != x:
        bad.append('%s %s: byte slice does not re-parse to the record' % (label, pid)); return
    b = fb[s:e]
    say('RECORD %s %s status=%s offset=%d bytes=%d sha256=%s' % (label, pid, x.get('status'), s, len(b), sha(b)))
    say('SHAPE %s %s %s' % (label, pid, json.dumps(shape(x))))
    if b'enqueuetoken' in b.lower():
        say('WARN %s %s: slice carries a ticket-queue token; sanitise before retaining (ISSUE-231 2a)' % (label, pid))
    say('RAW %s %s %s' % (label, pid, b.decode('utf-8')))
    say('B64 %s %s %s' % (label, pid, base64.b64encode(b).decode('ascii')))
say('B1 host=%s python=%s root=%s' % (socket.gethostname(), sys.version.split()[0], ROOT))
if not os.path.isdir(MATCHES):
    say('FAIL layout: %s does not exist' % MATCHES); sys.exit(2)
for parent in (MATCHES, FIXTURES):
    names = sorted(n for n in os.listdir(parent) if n.startswith('afl-api-2026-2026-09-')) if os.path.isdir(parent) else None
    say('LIST %s %s' % (parent, 'ABSENT' if names is None else '%d: %s' % (len(names), ' '.join(names))))
found, present = {}, []
for label in LABELS:
    d = MATCHES + '/' + label
    if not os.path.isdir(d):
        say('MISSING %s' % label); continue
    mp, fp = d + '/manifest.json', d + '/' + FEED
    if not (os.path.isfile(mp) and os.path.isfile(fp)):
        bad.append('%s: manifest.json or %s absent' % (label, FEED)); continue
    mb, fb = rd(mp), rd(fp)
    m = json.loads(mb)
    ent = [f for f in m.get('files', []) if f.get('file') == FEED]
    rec = RECORDED.get(label)
    say('MANIFEST %s sha256=%s recorded=%s kind=%s season=%s fixtures_only=%s selection=%s acquired_at=%s counts=%s files=%d'
        % (label, sha(mb), rec or '-', m.get('acquisition_kind'), m.get('season'), m.get('fixtures_only'),
           json.dumps(m.get('selection')), m.get('acquired_at'), json.dumps(m.get('counts')), len(m.get('files', []))))
    if rec and not sha(mb).startswith(rec):
        bad.append('%s: manifest sha256 differs from the tracked record' % label); continue
    checks = {'source_key': m.get('source_key') == 'afl_api', 'kind': m.get('acquisition_kind') == 'afl_api_match_snapshot',
              'label': m.get('label') == label, 'season': m.get('season') == 2026, 'feed_entry': len(ent) == 1}
    if not all(checks.values()):
        bad.append('%s: manifest contract differs %s' % (label, json.dumps(checks))); continue
    say('FEED %s bytes=%d sha256=%s manifest_sha256=%s http_status=%s retrieved_at=%s'
        % (label, len(fb), sha(fb), ent[0].get('sha256'), ent[0].get('http_status'), ent[0].get('retrieved_at')))
    if sha(fb) != ent[0].get('sha256'):
        bad.append('%s: feed sha256 differs from its manifest entry' % label); continue
    matches = json.loads(fb).get('matches')
    if not isinstance(matches, list) or any((x.get('compSeason') or {}).get('providerId') != 'CD_S2026014' for x in matches):
        bad.append('%s: feed is not a 2026 matches array' % label); continue
    say('STATUS %s n=%d %s' % (label, len(matches), json.dumps(dict(sorted(Counter(x.get('status') for x in matches).items())))))
    found[label] = {x.get('providerId'): x for x in matches}
    present.append(label)
    for x in matches:
        if x.get('status') != 'CONCLUDED': emit(label, fb, x)
say('REFERENCE repo tests/fixtures/afl_api/match/04-season-feed-scheduled.raw-slice.json 2026-09-19T10:29:29Z %s SCHEDULED sha256=4d22766d4755aeb1271829a4285cf040c7302ad3b49d3a2a9a732c3505bb5d7a' % GF)
for pid in sorted({GF} | {p for l in present for p, x in found[l].items() if x.get('status') != 'CONCLUDED'}):
    for l in present:
        x = found[l].get(pid)
        say('COMPARE %s %s %s' % (pid, l, 'ABSENT_FROM_FEED' if x is None else json.dumps(shape(x))))
if TARGET not in present:
    say('NOTE %s not verified on this host: the UNCONFIRMED_TEAMS bytes are not recoverable here' % TARGET)
for v in bad: say('VIOLATION ' + v)
say('B1 RESULT present=%d/%d violations=%d' % (len(present), len(LABELS), len(bad)))
sys.exit(2 if bad else (0 if TARGET in present else 1))
'@
$py  = ($py -replace "`r`n", "`n").TrimStart([char]0xFEFF)
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($py))
ssh -o BatchMode=yes -o ConnectTimeout=15 arm@10.0.40.100 "echo $b64 | base64 -d | python3 -B -"
"EXIT $LASTEXITCODE"
```

**Reading the output:**
- `STATUS` gives each snapshot's verbatim status counts.
- `RECORD`/`RAW`/`B64` give each non-`CONCLUDED` record's exact bytes. `B64` reconstructs them
  byte-for-byte, and `sha256` is the hash to pin.
- `COMPARE` puts the Grand Final (and any other pre-match id) side by side across every verified
  snapshot, against the tracked 09-19 slice.
- **If `-09-25-235854` is missing** (exit 1), the next evidence sources that need no network
  fetch, in order, are:
  1. the other labels this command verifies on DEV;
  2. the workstation copy `D:\dev\afldb\data\sources\afl_api\matches\afl-api-2026-2026-09-21-031725\`
     (recorded in ISSUE-228 §20; not inspected by this pass; it predates `UNCONFIRMED_TEAMS`);
  3. an operator-authorised read-only query of the DEV spine (`staging.source_payloads` for
     `CD_M20260142901`). That is a database contact, so it needs separate authorisation. It is
     likely to hold nothing pre-match, because selection defaults to `CONCLUDED`.

  A fresh AFL API request is not a substitute.

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

## 4a. Pass 4 — first-slice decisions recorded (operator, 2026-10-02)

The operator chose **Option B**. The fixture writer is held until the authentic 2027 pre-match feed
has been captured (B2). Evidence work continues (B1, §3a). The decisions below bind the first
slice. They were recorded in a read-only pass: no code, database, network or Git.

**Pass 5 (2026-10-02, operator, documentation only):** D-229-5 is final, and D-229-7 and D-229-8a
are decided. Every D-229 decision is now recorded. Option B is unchanged: B1 now, to recover the
authentic `UNCONFIRMED_TEAMS` bytes from the retained DEV snapshots (§3a), and B2 later, the first
authentic 2027 pre-match feed, before the writer is wired or applied.

**Pass 6 (2026-10-02, B1 evidence, §2c).** D-229-1 and D-229-2 are revised: `UNCONFIRMED_TEAMS` is
admitted as a second observed pre-match status. D-229-3 through D-229-8a are unchanged.

**B2 is still required before the writer is wired or applied.** It is the first authentic 2027
pre-match season feed, and it must provide:
- the genuine TBC date/time representation, if present;
- whole-season validation of the pre-match shape and of any new status or key variants.

- **D-229-1 — DECIDED (status routing), revised in pass 6 on B1 evidence (§2c).**
  - `SCHEDULED`: eligible for fixture projection, subject to the rest of the contract.
  - `UNCONFIRMED_TEAMS`: **now also eligible** for fixture projection. Authentic B1 bytes show it is
    the same pre-match shape, with only the provider status changed.
  - Both project to AFLDB fixture status **`scheduled`**. `UNCONFIRMED_TEAMS` is **not** added to
    AFLDB's fixture lifecycle vocabulary (`scheduled | cancelled | void`, migration 097).
  - `CONCLUDED`: the existing AFL API match/corroboration path. The fixture writer takes no action.
  - Every other value: fails closed and stays visible verbatim. No mapping is inferred for `LIVE`,
    `POSTGAME`, `POSTPONED`, `CANCELLED` or any unknown string.
  - *Pass-4 wording, superseded:* "`UNCONFIRMED_TEAMS`: unsupported until its authentic bytes are
    recovered (B1)."
- **D-229-2 — DECIDED, revised in pass 6 on B1 evidence (§2c).**
  - For both authentically observed pre-match statuses, `SCHEDULED` and `UNCONFIRMED_TEAMS`,
    `home.score` and `away.score` are entirely absent.
  - Absence means "no fixture score data", never zero.
  - If either observed pre-match status arrives with a score block, that is an unobserved shape and
    it refuses.
  - The rule is not generalised to `LIVE`, `POSTGAME` or any other status.
- **D-229-3 — DECIDED.**
  - Provider postponement and cancellation statuses stay unsupported until observed.
  - No provider status maps automatically to `cancelled` or `void`.
  - An unsupported status never mutates an existing fixture.
  - ISSUE-162's human cancel/void is not a licence to rewrite provider ownership.
- **D-229-4 — DECIDED.**
  - The I-1, I-2 and I-3 conflict checks are source-agnostic. They apply alike to manual, AFL Tables
    and AFL API rows.
  - A foreign or manual row is never merged or overwritten.
  - Today `admin-fixtures.ts:1001` and the replay (`common.py:2303`) are the only `fixtures`
    writers. No AFL Tables fixture writer exists, so a source-agnostic predicate covers one if it
    ever appears.
- **D-229-5 — DECIDED (final, pass 5).** A fixture `match_date`/`match_time` may be projected from
  `utcStartTime` only when all four conditions hold:
  1. `utcStartTime` is present and parses in the explicitly supported observed format, exactly
     `YYYY-MM-DDTHH:MM:SS.sss+0000` (the §2a slice). No lenient parsing.
  2. The provider venue id (`venue.providerId`) resolves deterministically to an AFLDB venue.
  3. The `venue.timezone` in the observed provider payload is a valid IANA timezone, i.e.
     `convertUtcInstantToVenueLocal` returns non-null.
  4. The conversion is exact to fixture storage precision (`HH:MM`). In the first slice a non-zero
     seconds value refuses and is never truncated.
  - **AFLDB does not own or store the timezone.** `venues` has no timezone column. The zone is the
    provider's observed value (`known_columns`, not `required_columns`), and it must never be
    called canonical.
  - **Refusal.** A missing, unparseable or ambiguous start time, an unresolved venue, or an invalid
    timezone refuses fixture projection. The raw observation stays in the retained snapshot.
  - **No false TBC.** A known start time is never written as NULL/TBC. How a genuine TBC start is
    represented is still evidence-pending until B2.
  - This is a fixture projection rule only. The canonical match-write rule (§11.1, roster
    cross-check) is unchanged.
- **D-229-6 — DECIDED.**
  - First-slice AFL API-owned fixtures are read-only in the admin UI.
  - All eight admin mutations (reschedule, venue, round, clubs, notes, cancel, reinstate, void) go
    through `editFixture()` (`admin-fixtures.ts:1372`). That function finds a row by `fixture_key`
    alone (`lockFixture`, `:695`), so it is the single guard point. It must refuse a row whose
    source is not `manual_admin_edit` before any write.
  - A manual create that collides with an AFL API row already refuses: I-1 `duplicate_fixture` and
    I-2 `club_already_scheduled` (`:913-946`) do not filter by source.
  - No existing override layer fits. `data_overrides` `fixtures` rows are keyed
    `manual_admin_edit:<token>`, and the replay re-creates them as manual rows
    (`common.py:2302-2323`), so no override layer is designed here.
- **D-229-8 — DECIDED (policy); D-229-8a DECIDED in pass 5, option (a). See below.**
  - The fixture-only path performs no absence sweep.
  - A pre-match record that leaves a later feed is never read as permission to delete, and never
    as a fatal absence caused by the fixture writer.
  - Cancellation or removal stays unsupported.
  - **Boundary (source-verified).** The ISSUE-231 sweep reads every `staging.source_records` row
    with `source_id = afl_api`, `family = 'match'` and `scope_key = 'season=<S>'`. It does not look
    at the payload's status or at which tool wrote the row (`afl-api-match-absence.ts:123-127`).
  - The record key is `(source_id, family, external_record_id)` (`074:124`). `scope_key` only
    records where the row was last seen. So any `match`-family persistence of a pre-match `CD_M`
    puts it inside the sweep, and a later disappearance HALTs the completed-match settle.
  - The ISSUE-228 S7 fixtures-only settle already writes this scope, but only for `CONCLUDED`
    records. That is unchanged.
  - **D-229-8a (operator), two ways to keep fixture observations out of the sweep:**
    - **(a)** The fixture path writes no `match`-family spine row. The raw payload stays in the
      hash-pinned snapshot (manifest-last, a sha256 per file), and provenance is
      `fixtures.import_batch_id` plus `import_batches`. Cost: `canonical_applications` has an FK to
      `staging.source_record_versions` (`083:103-104`), so the first slice can write no ledger row,
      and the ISSUE-228 §12 CHECK widening is deferred.
    - **(c)** Narrow the ISSUE-231 spine query to rows whose current payload is `CONCLUDED`. That
      changes resolved ISSUE-231 code and its tests.
    - **Recommended: (a).** It changes no completed-match code. Retained snapshots already satisfy
      "retain the raw observation".
  - **D-229-8a — DECIDED (pass 5): option (a).**
    - First-slice fixture ingestion does **not** persist pre-match rows into the existing AFL API
      `match` observation spine (`staging.source_records` / `source_record_versions` /
      `source_payloads`).
    - **Reason.** ISSUE-231's absence sweep reads that spine without separating rows by status or
      by the tool that wrote them. Storing pre-match rows there would tie a fixture's disappearance
      to the completed-match absence gate.
    - **Raw provenance** is the hash-pinned retained snapshot (`manifest.json` sha256 per file),
      plus `fixtures.source_id`, `fixtures.source_record_id` and `fixtures.import_batch_id`.
    - Fixture-only ingestion runs no absence sweep.
    - No `canonical_applications` row is written for fixture rows until a safe observation/audit
      model exists that does not create this coupling. The `canonical_applications` CHECK widening
      of ISSUE-228 §12 is therefore not part of the first slice.
    - ISSUE-231 is not changed by ISSUE-229, and option (c) is rejected.
- **D-229-7 — DECIDED (pass 5).** Evidence: §4b.
  - An AFL API-owned fixture may be re-ingested after a destructive rebuild with a new random
    `fixture_key`.
  - The durable provider identity is `(source_id, source_record_id)`, not `fixture_key`.
  - `fixture_key` continuity is still required for manually edited rows, which are carried through
    the `data_overrides` / `data_edits` replay.
  - **Preconditions:**
    - the D-229-6 admin guard stops provider-owned rows from becoming manual edits;
    - importer and audit identity use the provider identity, never `fixture_key`;
    - no new importer-owned FK or persisted artefact may depend on `fixture_key` continuity.
  - **Migration 097 is not edited.** Applied migrations are immutable. If the database
    `COMMENT ON COLUMN fixtures.fixture_key` needs correcting, migration 110 may issue a new
    `COMMENT ON COLUMN`. Otherwise the distinction is documented in current code and this runbook.

## 4b. D-229-7 — `fixture_key` reference inventory (source-verified, 2026-10-02)

A search of `src/`, `tools/`, `deploy/`, `data/`, migrations and tests for `fixture_key`/`fixtureKey`
and for any reference to `fixtures`:

| Holder | What it stores | Written for which rows | Continuity need |
|---|---|---|---|
| `fixtures.fixture_key` (`097:113`, `NOT NULL UNIQUE`) | the identity itself | every row | — |
| **FKs to `fixtures`** | **none.** No migration has `REFERENCES fixtures`. | — | none |
| `data_overrides` `entity_type 'fixtures'`, `entity_key 'manual_admin_edit:<fixture_key>'` (`097:249-284`, `admin-fixtures.ts:150`) | the token | rows mutated through `admin-fixtures.ts` only | the replay re-creates the row under the same token |
| `data_edits` `table_name 'fixtures'`, `row_id = fixtures.id` (`097:310-323`, `audit-log.ts:51`) | `fixtures.id`, remapped via `fixture_key` at promotion (`promotion-inventory.ts:435`, `:1843-1864`) | admin mutations only. Importers write no `data_edits` (`afldb_import` is INSERT-only on it, `canonical-apply.ts:104`). | the remap requires the key to exist in the candidate. The replay guarantees that for overridden rows only (`promotion-inventory.ts:431-434`). |
| Admin routes `/admin/fixtures/[season]/[fixtureKey]` and server actions (`src/app/admin/fixtures/**`) | the token in URLs and form posts | any row | ephemeral (an admin link) |
| `canonical_applications` | nothing today. The target CHECK does not admit `fixtures` (`083:108-110`). | — | a future ledger row must key on `{source, source_record_id}`, never the key or `fixtures.id` |
| Tracked artefacts (`data/`, `docs/rebuild-manifests/`) | none | — | — |

(`tools/db/promotion-source-dependency-rehearsal.ts` `fixtureKeysOf` is a false positive. It
renders test-world `match_key`s.)

**Findings.**
- **Two identities.** `fixture_key` is AFLDB's internal fixture identity. `(source_id,
  source_record_id)` is the provider observation identity, held unique by
  `fixtures_source_record_uq` and fixed by the provider.
- **Continuity is needed only where something durable points at the key.** The only durable
  pointers are `data_overrides` and `data_edits`. Both arise only from admin mutation.
- **D-229-6 removes those pointers.** It refuses every admin mutation of a non-manual row, so no
  `data_overrides` or `data_edits` row can ever reference an AFL API-owned fixture.
- **What a rebuild or promotion does.** It empties `fixtures` and replays manual rows only
  (`common.py:2142-2148`). An AFL API row is absent until the fixture path re-ingests it, under the
  same `(afl_api, CD_M)` and a new `fixture_key`. Nothing then refers to the old key, apart from an
  admin URL.
- **The 097 column comment overstates.** It says `fixture_key` "survives a destructive rebuild and
  a promotion". That is true for manual rows (through the replay), not for importer rows.

**Conclusion (evidence sufficient).** An AFL API-owned fixture can safely be re-ingested after a
rebuild with a new random `fixture_key`, on four conditions:
1. the D-229-6 guard is in place;
2. any importer audit row keys on `(source, source_record_id)`;
3. no new table stores `fixtures.id` or `fixture_key` for importer rows;
4. the 097 comment is corrected to "manual rows" when the writer lands.

Preserving continuity explicitly would need a new durable record for importer rows. Nothing in the
current architecture needs one.

**Decided in pass 5 (§4a, D-229-7).** Condition 4 is superseded. Migration 097 is immutable and is
not edited. If the column comment needs correcting, migration 110 may issue a new
`COMMENT ON COLUMN`. Otherwise the distinction lives in current code and this runbook.

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

Pass 7 (B1 retention):
- **N** `tests/fixtures/afl_api/match/05-season-feed-unconfirmed-teams.raw-slice.json`. The
  operator wrote it from the B1 `B64` output. It is byte-exact, sha256 `e39ac375…7da7`, 1,154 bytes.
- **M** `.gitattributes` (adds `-text -diff !eol` for the `05-…` slice)
- **M** `tests/afl-api-match.test.ts` (new describe block: three DB-free tests)
