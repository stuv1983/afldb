# Run 4, scope `leaks` (F-003): shared-mode test residue, attributed and fixed

Worker: Sonnet 5.5 (`afldb-worker`), branch `claude/rem4-leaks-20261115`, base B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`.
Code commit `ec537f4f71ca3af976fc01fd86d5764b056ff921` (seven test files, no `src/`). This record is a docs-only commit on top.
Host: `streamanator`, workspace `/mnt/ssd/afldb-rem4-leaks-20261115`, own cluster `/mnt/ssd/afldb-rem4-leaks-20261115-pg` on port 55691
(never the shared `afldb_test`, never DEV 5432). Evidence copy: `raw/` (host `evidence/`), `scripts/` (host `in/`). Hashes: `SHA256SUMS`.

## 1. Bases and method

* Snapshot base: the 4 Nov restored snapshot (ledger 118, 83 tables), template DB `afldb_v2_rem4leaks_snap_tmpl_test`.
* Rebuild base: the accepted rebuild, plain restore, template DB `afldb_v2_rem4leaks_rb_tmpl_test`. **Deviation:** no bridge child / Stage A
  (baseline C1/C2 had them); those only affect the draft-linkage and draftguru-import importer groups, not any residue below.
* Shared mode: `AFLDB_TEST_PER_FILE_DB` unset, the 99 files of the baseline C2 order (`scripts/c2-order.txt`) serially against ONE database that is a
  fresh `--template` copy of the base. `scripts/leaks-one.sh` takes, before and after every file, the exact `count(*)` of all 105 ordinary tables, the number
  of row versions written since the file began (`xmin >= txid`), and id-less md5 content fingerprints of seasons, club_seasons, clubs, sources, auth_users,
  data_overrides, data_edits, player_season_stats, matches, draft_picks, draft_persons.
* Per-file mode: `run2/tests363/run-integration-per-file.sh` (`MODE=all`, `AUDIT=` jsonl) on a copy of each base.
* RED = checkout `cand-red` at B4 (clean). GREEN = checkout `cand` at `ec537f4f` (clean; `git status --porcelain` empty before and after, recorded in
  `raw/run-final.out`, `raw/gates.out`).

## 2. Attribution (red = B4)

`raw/attrib-redsnap.tsv` and `raw/attrib-redrb.tsv` (net row delta per file per table). Totals reproduce the baseline exactly.

| table | file | snapshot | rebuild | scope |
|---|---|---|---|---|
| auth_users | match-results-promotion | +1 | +1 | mine |
| auth_users | submission-promotion | +1 | +1 | mine |
| auth_users | join-request-approval | +1 | +1 | mine |
| auth_users | after-siren | +1 | +1 | other |
| auth_users | sealed-editor-guard (throwaway admin, removal error swallowed) | 0 (admin pre-existed) | +1 per-file only (`raw/pf-redrb-audit.jsonl`) | mine |
| data_edits | sealed-editor-guard | +4 | +4 | mine |
| data_edits | match-admin-delete | +2 | +2 | mine |
| data_overrides | sealed-editor-guard | +2 | +2 | mine |
| data_overrides | admin-season-lists | 0 | +1 | other (see 5) |
| club_seasons | match-admin-delete | 0 (content CHANGED) | +2 | mine |
| seasons / player_season_stats / club_seasons content | sealed-editor-guard, match-admin-delete | CHANGED, count same | CHANGED | mine |
| import_batches | awards-reload-links | +118 | +118 | other |
| import_batches | match-results-promotion | +60 | +60 | mine |
| import_batches | dob-enrichment-issues | +34 | +34 | mine |
| import_batches | after-siren | +6 | +6 | other |
| import_batches | submission-promotion | +4 | +4 | mine |
| import_batches | draftguru-import | +3 | +3 | mine |
| import_rejections | dob-enrichment-issues | +3 | +3 | mine |
| sources | dob-enrichment-issues | +1 | +1 | mine |
| award_winners | awards-reload-links | +1 | 0 | other |
| award_winners | v2-coleman-publication | -1 | -1 | other |
| fixtures | admin-fixtures | -218 | 0 | other |

Run totals RED: snapshot auth_users +4, data_edits +6, data_overrides +2, import_batches +225, import_rejections +3, sources +1, fixtures -218
(C3). Rebuild auth_users +4, data_edits +6, data_overrides +3, club_seasons +2, import_batches +225, import_rejections +3, sources +1, award_winners -1 (C2).
225 = 118 + 60 + 34 + 6 + 4 + 3.

GREEN totals (`raw/attrib-greensnap.tsv`, `raw/attrib-greenrb.tsv`): every residue left comes from a file this scope does not own:
snapshot auth_users +1 (after-siren), import_batches +124 (awards-reload-links 118, after-siren 6), fixtures -218 (admin-fixtures), award_winners net 0
(awards-reload-links +1, v2-coleman-publication -1). Rebuild auth_users +2 (after-siren, admin-season-lists), data_overrides +1 (admin-season-lists),
import_batches +124, award_winners -1. Files failing (rc 1) are the same set red and green (11 on snapshot, 18 on rebuild): no file newly fails on either base.

## 3. Fixes (tests only, all seven files extend their own suites)

Every cleanup deletes only rows this suite created (an id floor taken in `beforeAll`, a RETURNING test for "this run created the fixture row", or a
byte-for-byte capture) and fails loudly instead of swallowing errors.

| file | change |
|---|---|
| `match-admin-delete` | captures the fixture season's `seasons`, `club_seasons`, `player_season_stats` rows (fixture season = `max(seasons.year)`, a real season) before writing; `afterAll` restores exactly them and throws unless the recapture equals the capture; deletes its own `match_deletion` audit rows (id floor + actor + marker) unconditionally, and the throwaway admin only if it created it |
| `sealed-editor-guard` | same capture/restore for real seasons 1990/2026 (seasons, club_seasons, player_season_stats), `data_edits`/`data_overrides` above a floor for its actor, admin removal no longer `.catch`-swallowed |
| `submission-promotion`, `match-results-promotion` | delete their own `admin-upload` import_batches (`notes = 'submission <id>'`) and the fixture admin only when created by this run |
| `join-request-approval` | deletes the fixture admin and its `auth_audit_log` rows only when created by this run |
| `dob-enrichment-issues` | deletes the importer batches above a floor (`enrich_birth_dates*.py`; rejections cascade) inside a transaction with `SET LOCAL statement_timeout='300s'` (the shared client's short timeout cancelled the delete), and the fixture source only when created |
| `draftguru-import` (reload-guard block) | deletes the `import_draftguru.py` batches above a floor |

Mechanism of the `club_seasons` leak: a successful `deleteMatch` recomputes the season (`src/db/queries/match-admin.ts` ~683, `player-derived.ts` 425/527)
and the suite then raw-deletes the fixture matches; with the real latest season (rebuild 2027, no ladder) that leaves 2 `club_seasons` rows.
Two traps hit while fixing, both recorded: postgres.js `unsafe` needs `$1::text::jsonb` for a JSON-text parameter (plain `$1::jsonb` raised
"cannot call jsonb_populate_recordset on a non-array"); and the dob afterAll delete hit the client's `statement_timeout`.

## 4. Red/green evidence

Exact failure text is in `raw/`; commands are the scripts in `scripts/` (heavy lock per multi-file group; focused loops `LOCKCMD=env`).

* Shared mode, snapshot, 99 files: RED `raw/attrib-redsnap.*` vs GREEN `raw/attrib-greensnap.*` (table in section 2).
* Shared mode, rebuild, 99 files: RED `raw/attrib-redrb.*` vs GREEN `raw/attrib-greenrb.*`.
* Per-file mode, seven changed files, both bases: RED `raw/pf-redsnap-audit.jsonl`, `raw/pf-redrb-audit.jsonl`; GREEN (dirty-tree focused runs)
  `raw/pf-greensnap-audit.jsonl`, `raw/pf-greenrb-audit.jsonl`; GREEN on the clean final commit `raw/pf-finalsnap-audit.jsonl`,
  `raw/pf-finalrb-audit.jsonl`. All six runs: `Test Files 7 passed (7)`, `Tests 136 passed | 2 expected fail | 1 skipped (162)`. Residue RED: e.g. rebuild
  match-results-promotion `auth_users +1, import_batches +60`; GREEN: none. The only entries left GREEN are version-only (rows written then restored to
  identical content: seasons, club_seasons, player_season_stats; draft_picks v1), net 0 and id-less fingerprints unchanged.
* Two-file shared proof on the rebuild (`raw/attrib-chainredrb*`, `raw/attrib-chaingreenrb*`; 11-file chain, match-admin-delete before
  afl-api-c7-observation): RED `afl-api-c7-observation` `Tests 3 failed | 3 passed (6)` with
  `update or delete on table "seasons" violates foreign key constraint "club_seasons_season_fkey" on table "club_seasons"`; GREEN `Tests 6 passed (6)`.
* typecheck rc 0 and `lint:gate` PASSED at `ec537f4f` (`raw/typecheck.log`, `raw/lint-gate.log`, `raw/gates.out`; ratchet 338 errors / 43 files, same as
  baseline; `--update` never run).

## 5. Findings and amendments

1. F-003 validated: every leaked row is attributed (section 2), six suspected files confirmed except that `after-siren` is not mine (reported only).
2. AMENDED: the baseline's "afl-api-c7-observation x3 fails only in shared mode on `club_seasons_season_fkey`" is true but incomplete. After the
   `match-admin-delete` fix the file passes in the chain above, yet it STILL fails 3 tests in the full-order rebuild run (`raw/attrib-greenrb-logs/`) with
   `update or delete on table "seasons" violates foreign key constraint "awards_last_season_fkey" on table "awards"`. Cause: `awards-reload-links`
   (other scope) leaves one `awards` row with `last_season = 2027` (template 0 rows, after the run 1; `awards-reload-links` is the only file that
   writes `awards`, 46 row versions). Owner of `awards-reload-links` must restore it.
3. UNMASKING (expected, consistent with baseline C1): on the rebuild, files that pick `SELECT id FROM auth_users ORDER BY id LIMIT 1` or create an admin
   with `ON CONFLICT` no longer inherit a leaked admin. `admin-season-lists` now creates its own admin, fails its `afterAll` with
   `data_overrides_admin_user_id_fkey` (its own `data_overrides` +1 left) and leaves `auth_users +1`; its test failure `2027: expected true to be false`
   is the baseline's pre-existing one (the rebuild already has a 2027 season). `settle-afl-api-state-b` (throws "no auth_users row") and
   `special-records-lifecycle` pass in the full order only because `admin-season-lists` and `after-siren` still leak an admin. Fix belongs to those owners:
   each suite must create and remove its own admin.
4. Season 2075 / prefix `CD_I4070`: **collision**, `tests/integration/brownlow-fixture.ts:55` already has `BROWNLOW_ACCOUNTING_SEASON = 2075`. This scope
   committed no synthetic season (it restores real-season rows instead), created no `CD_I4070` rows, and needs no `leaked-fixtures.ts` change.

### Residual INFO / owner list (files this scope does not own; nothing edited)

| file | residue | grade |
|---|---|---|
| `v2-coleman-publication` | deletes the real Coleman 2001 `award_winners` row after the publication is refused (net -1, both bases) | MED (data loss in the test DB; escalate) |
| `awards-reload-links` | `import_batches` +118 (tests read relatively, harmless), `award_winners` +1 on snapshot, `awards.last_season=2027` on rebuild (breaks c7) | MED |
| `admin-fixtures` | deletes all 218 `fixtures` rows on the snapshot (218 to 0) | MED |
| `admin-season-lists` | leaves `auth_users +1`, `data_overrides +1` on a base with no admin; own afterAll fails | MED |
| `after-siren` | `auth_users +1` (`ON CONFLICT DO UPDATE SET role='admin'` also overwrites a pre-existing role), `import_batches +6` | LOW |
| `settle-afl-api-brownlow`, `-backtest`, `-reschedule`, `settle-afl-api` | `seasons`/`club_seasons`/`player_season_stats` content CHANGED (counts equal) | INFO to the brownlow/settle owners |
| `settle-afl-api-state-b`, `special-records-lifecycle` | depend on a leaked admin (see finding 3) | INFO |

## 6. Operating notes (disclosed)

* Full-order RED shared run on the snapshot (`redsnap`, 99 files) ran each file with `LOCKCMD=env` (no heavy lock) as single-file focused runs, `nice 10`;
  the other three full-order runs, typecheck and lint:gate held the heavy lock per file/command.
* A host process started with a nested `cand-red` worktree path was removed (`git worktree remove`) and recreated at the right path; two
  mistakenly started `redsnap` attempts (wrong order-file column; no template copy) were killed and their database dropped, all inside my workspace.
* The rebuild restore waited about 45 minutes on the heavy lock (22:16Z to 23:02Z).
* No push, no production, DEV, `afldb_test`, RB-1, quarantined-store or `wsl` contact; no `lint:gate --update`.
