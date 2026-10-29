# ISSUE-316 U3 — owner adjudication and completed read-only checks

2026-10-24. **Canonical correction accepted as successfully executed. Audit metadata defect remains open.**
U3 unconfirmed; U4 Route B; production NO-GO. No repeat removal or Match Sheet Save; no canonical/derived/authority
write, census, seal/rollover, activation, apply, deployment, rebuild, push or Git command in this continuation.

## Authorised read-only verification: PASS

All production SQL used afldb_backup, default_transaction_read_only=on, REPEATABLE READ READ ONLY,
identity-gated afldb_prod / OID 66668 / system ID 7674454702926115004, timeouts and explicit ROLLBACK.
The derived snapshot was **2026-10-24T11:46:45.164537Z**; final narrow aggregate/catalog snapshot
**11:48:04.938739Z**. Both reached their completion marker with SSH exit 0. Initial sandbox source inspection
failed DNS before a connection; its logs are retained separately. Escalated read-only source/catalog inspection
succeeded, SSH exit 0. No production file was written; scripts were streamed to bash stdin as raw bytes.

| Representation | Independently compared rows | Result |
|---|---:|---|
| player_career_stats, all affected players | 47 | Every statistical column agrees; rebuilt_at is checked separately |
| player_season_stats, 2026 | 47 | Every column agrees, including deployed Brownlow source semantics |
| player_club_season_stats, 2026 | 47 | Every column agrees |
| player_clubs, all careers | 59 | Every column agrees |
| Affected players' career_game_no and debut/final seasons | all source appearances / 47 players | Zero discrepancies |
| match_period_scores, match 17214 | 8 | Goals, behinds and points equal staged quarter scores |
| Team player totals, match 17214 | 2 teams / 46 players | Ten ordinary stat totals and row counts equal AFL Tables staging |
| Relevant 2026 club_seasons | Essendon and North Melbourne | Played, W/D/L, points for/against, finals and premier flag agree |

All 47 career rebuilt_at values equal removal transaction time **11:28:46.203865Z**. There were no inconsistencies
requiring the stop rule. Official score components/result/winner/margin agree with staging: **Essendon 9.15 (69),
North Melbourne 12.9 (81), away_win, winner 16, margin 12**. The full match row equals the original 11:30 postcheck;
that postcheck's accepted 2026 match fingerprint already equalled the fresh pre-save fingerprint.

The accepted canonical facts are retained: PMS 705437 absent, 2026 PMS 10,028, Essendon match rows 23,
zero extra/missing baseline keys; unrelated PMS/application 20834 fingerprints unchanged. These accepted facts were
not unnecessarily re-run as a census. Authority 93 and the complete edit 94 still equal the original postcheck.

## Target player's expected before/after effect

The **before_model is a SELECT-only reconstruction**, adding the retained removed row to the present canonical
source in a CTE. It does not insert a table row or claim a measured pre-save derived snapshot, which was not captured.
The actual after state matches the independently derived after state exactly.

| Quantity | Reconstructed before | Verified after |
|---|---:|---:|
| Career games / losses | 126 / 83 | 125 / 82 |
| Career recorded-game denominators (all eight supported) | 126 | 125 |
| Career last_match_date | 2026-03-28 | 2026-03-22 |
| 2026 games / losses (season and Essendon club-season) | 3 / 3 | 2 / 2 |
| 2026 four supported recorded-game denominators | 3 | 2 |
| Essendon player_clubs games / last_match_id | 3 / 17214 | 2 / 17210 |

Ordinary statistical sums are unchanged: career goals 43, disposals 2,562; season goals 2, disposals 30;
all ten sums are in the retained JSON. Gold Coast player_clubs is unchanged at 123 games/41 goals.
Career Brownlow remains 18/0 medals under the deployed authoritative season-row definition; 2026 votes remain
NULL with deployed status not_applicable. Those are observed deployed semantics, not a new U4 decision.
The current local player-derived.ts differs from deployed source in Brownlow-readiness logic; the reconciliation
uses the inspected **deployed** definitions, not an assumed local release. No Brownlow base table was written.

## Missing note investigation

- Live Playwright inspection after operator authentication confirms input **name=note**, type text,
  maxLength 2000, label **Verification / Audit note (optional)**, inside the Match Sheet save form.
  No fill, removal, save or other data mutation was performed. Browser closed after inspection.
- Current and deployed MatchSheetEditor.tsx, actions.ts, match-sheet.ts, audit-log.ts and the three audit reader/UI
  files match SHA-256 byte for byte. The deployed checkout source was read without Git. This does not by itself
  bind every compiled running server artifact or reconstruct the original request.
- actions.ts:216 reads formData.get('note'), trims and passes it at :236. match-sheet.ts:349 supplies input.note
  to recordDataEdit. audit-log.ts:121 normalises missing/blank text to SQL NULL; it does not discard nonblank removal notes.
- Authority **data_overrides 93** has no note/reason column and only {"present":false} in override_values.
  Its original identity/actor/timestamps/presence remain unchanged. Edit **data_edits 94.note is SQL NULL**.
- Live audit history displays the one committed correction with no note and no amendment control. The viewer
  source is SELECT-only. Generic editor entities exclude data_edits. The retained bounded src literal search found
  no supported metadata amendment/append workflow. Graph tools were not available; exact source fallback is disclosed.
- The approved note exists in the unchanged 967-character authority file. It was supplied in chat historically;
  **entry into the actual UI field is unproven**. No submitted FormData is retained. The operator has been asked
  which field received it; no answer establishing entry/omission has been received as of this record.
- **Cause unresolved.** No proven application note-loss path, so no separate product-defect issue or speculative
  regression test was added. If omission is confirmed, record execution/procedure failure. If acceptance and loss
  are established, register a separate issue and meaningful regression coverage in the closest existing suite.

## Metadata repair disposition

There is no supported audited repair workflow to use. No production repair was attempted. The
[metadata-only proposal](METADATA-REPAIR-PROPOSAL.md) identifies the exact NULL column/value, guarded transaction,
mandatory append audit, structural no-canonical-write proof, rollback and required independent review plus separate
owner execution approval. It contains no executable production SQL. Owner adjudication without a repair remains
an alternative permitted by the ruling. **U3 cannot be confirmed yet.**

## Evidence limits and standing

No separate period-score before snapshot exists: this continuation proves current source agreement, not retrospective
byte-level immutability. Likewise there is no new before/after Brownlow round-vote fingerprint proof. Those limits are
preserved, not hidden by a repeated save or restoration. No production correction is to be rolled back.

The user-authenticated Playwright session was new; initial sandbox network access was denied. The authorised network
escalation succeeded with existing installed Playwright 1.62.1; no installation/dependency/config change was needed.
Authentication generated normal authentication activity; there was no correction submission. No application code,
regression test, migration, importer or Git state was changed. No test/build ran against production or locally.

Authoritative trackers are updated in issues.md, IssuesIndex.md, the ISSUE-316 runbook and CHANGELOG.md;
blockers.md has a narrow current U3 navigation note, without reclassifying its historical audit/counts.
Every file changed/created in this continuation is enumerated in [SESSION-FILES.json](SESSION-FILES.json).
New and updated evidence is bound in SHA256SUMS; the prior manifest is retained as SHA256SUMS.before-adjudication.
All original raw evidence is preserved. U4 Route B; Brownlow untouched; production **NO-GO**.
