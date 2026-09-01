# AFLDB ISSUE-102 CONTINUATION HANDOFF

**Self-contained. A fresh session with no conversational history can resume from this file alone.**
Written 2026-08-30 at the end of the ISSUE-102 pass-2 architecture pass.

---

## Worktree
`D:\dev\afldb-issue-102`

Work only here. **Do not access or modify `D:\dev\afldb`.** It is a git worktree; the stash stack
is shared with other worktrees and other sessions.

## Branch
`claude/issue-102`

## Baseline
`95819a3` — "Resolve ISSUE-109 data override privileges"

## Model / pass
Claude Opus, High effort. **Architecture + issue design + handoff pass. No implementation.**

Pass history:
- **Pass 1 (2026-08-30)** — architecture/scope adjudication of ISSUE-102. Recommended keeping it
  record-only and delegating implementation (Option B).
- **Pass 2 (2026-08-30, this pass)** — operator adopted Option B, revised ISSUE-102 to parent
  scope, approved the curated-manifest and Coleman-derivation directions, authorised child issues
  111/112/113. Documents written, ledgers reconciled, this handoff created.

---

## Scope — current

`AFLDB-ISSUE-102` is the **parent architecture / dependency-inventory / child-coordination /
acceptance record** for legacy-free awards and honours acquisition.

The former "record only — do not design the replacement" boundary is **superseded** by operator
decision on 2026-08-30. The superseded text is retained as lineage in the `issues.md` entry.

**ISSUE-102 does not implement replacement loaders.** Implementation belongs to the children.

Not in scope for 102: writing any loader/parser/manifest/migration; acquiring or scraping external
data; selecting the ISSUE-113 source; changing `import_legacy_afl.py`; creating a broader
`import_legacy_afl.py` parent issue (deliberately deferred); broadening `afldb_import` privileges
(none is needed); editing any applied migration.

Authoritative detail: `issues/open/AFLDB-ISSUE-102.md`.

---

## Operator decisions — authoritative, do not re-litigate

1. **ISSUE-102 becomes the parent architecture/coordination record.** Do not mark it Resolved.
2. **Curated manifests are the approved architecture for the seven external honours families.**
   Runtime scraping, brittle HTML parsing, paid APIs and undocumented endpoints are **not**
   authorised without a separate operator decision. Manifests must carry stable source identity,
   provenance, deterministic validation, reviewability, idempotent reload, `reload_keyed`
   compatibility, manual-link preservation, `confirmed_unlinked` preservation and admin-owned-row
   protection.
3. **Coleman is derived from canonical AFLDB facts and the rows are PERSISTED** to
   `award_winners` — not a transient view, because `award_winners` participates in durable linking
   and reload infrastructure.
4. **Coleman ties: every player tied on the qualifying total gets a winner row.** No arbitrary
   tie-breaker. Stable identity must stay deterministic for tied rows.
5. **Coleman season span must preserve real award semantics.** Do not retroactively label every
   leading goalkicker since 1897 a Coleman winner. Establish the first award season from evidence.
6. **`AFLDB-ISSUE-110` is taken** by active NL semantic-mapping work **not merged into this
   worktree**. Do not use, modify or invent it. Children are 111, 112, 113.
7. **Brownlow season totals stay separate** as ISSUE-113. Do not conflate with `import_awards.py`.
   Do not choose an external source without evidence.
8. **Canonical rebuild is an acceptance requirement** for 111 and 112. The end-state must not
   silently leave required tables empty, **and legacy SQLite must never be bolted back into
   `rebuild-test.ts`**.

---

## Completed this pass

| File | Action |
|---|---|
| `issues/open/AFLDB-ISSUE-102.md` | **Rewritten** — parent architecture record: revised scope, operator decisions, verified dependency inventory, acquisition matrix, canonical-rebuild gap, integrity contracts, test contract, child structure, **eight closure criteria**, unresolved items |
| `issues/open/AFLDB-ISSUE-111.md` | **Created** — Coleman derivation design, gates G0-G9, test plan |
| `issues/open/AFLDB-ISSUE-112.md` | **Created** — curated-manifest honours design, seven families, manifest architecture, removal policy, gates G0-G8 |
| `issues/open/AFLDB-ISSUE-113.md` | **Created** — Brownlow season-total design, coverage proof, downstream consumers, four undecided source classes |
| `issues/open/AFLDB-ISSUE-102-HANDOFF.md` | **Created** — this file |
| `issues.md` | Open Issues table rewritten (5 rows + an ISSUE-110 reservation note); ISSUE-102 detail entry re-scoped with lineage preserved, children and closure criteria added; **new detail entries appended for 111, 112, 113** |
| `IssuesIndex.md` | Header count and ISSUE-110 reservation note; ISSUE-102 row replaced with the parent-scope row; new rows for 111, 112, 113 inserted before the ISSUE-104 row |

**No `CHANGELOG.md` entry.** Repository policy (`CLAUDE.md` §5) excludes investigation-only
updates with no retained project change. This pass changed no application behaviour.

**A stray temp file was accidentally created at `D:\dev\afldb-issue-112.md.tmp` and immediately
deleted.** Verified gone. It was outside the worktree and never tracked.

---

## CHECKPOINT — pass 3 (2026-08-30): ISSUE-111 evidence gates measured

Operator ran the gating measurements read-only against `afldb_dev` over a localhost tunnel. All
detail is in `issues/open/AFLDB-ISSUE-111.md` §3.1–§3.5. Summary:

| Gate | Result |
|---|---|
| **G0** — Coleman span | **PASS.** `awards.first_season = 1980`, `last_season = 2025`, **46 winner rows, exactly one per season 1980–2025, no gaps**, 1 row with `player_id NULL`. **Decision: the derived span begins 1980. Do not backfill 1955–1979; do not extend to 1897.** |
| **G1** — H&A goal completeness | **PASS.** 341,981 `player_match_stats` rows over 7,941 H&A matches, 1980–2025, **`goals IS NULL` = 0**, zero seasons with any NULL. |
| **G3** — independent derivation vs legacy | **PASS with explained identity reconciliation.** MATCH 45, DERIVED_ONLY 1, LEGACY_UNLINKED 1, **LEGACY_ONLY 0**. Both exceptional rows are the same 1982 winner. **No football-semantic disagreement.** |
| **G4** — club semantics | **DECIDED.** All 45 linked winners represented exactly one H&A club and every legacy `club_id` matched; zero multi-club winners exist historically. Forward rule: one distinct H&A club → that club; more than one → **NULL**. No invented tie-break. Synthetic multi-club test required. |
| **G6** — human decisions | **Human-decision evidence PASS.** **Zero** Coleman `player_link_resolutions` rows of any kind; row 9441 has none. Transition mechanism designed in ISSUE-111 §7.1. |

**Correction recorded so it is not repeated:** an `information_schema` query as `afldb_app`
appeared to show no `player_link_resolutions` table. That was **privilege visibility, not
absence**. Migration 056 creates it, 067 extends it, 068 grants SELECT to `afldb_import`;
confirmed live under `afldb_import`.

**1982 Malcolm Blight:** legacy `award_winners.id = 9441`, `player_id NULL`,
`link_status_value 'implausible'`, `source_record_id 'coleman:1982:537'`, club 115 North
Melbourne. Canonical derivation gives `player_id = 1534`, 94 H&A goals, North Melbourne sole
qualifying club. No human decision exists, so the derived row is born linked and overrides nothing.

**G5 — RESOLVED.** `players.id` is **not** rebuild-stable (ISSUE-108 §9.4; the canonical rebuild
re-seeds it). The rebuild's durable identity is the **AFL Tables profile URL**, persisted in
`external_identities` (`match_method='afltables_profile_url'`, `status='unique'`, normalised path)
with `missing_url = 0` and `distinct_urls = players = 13,275`. Final key:
**`coleman:<season>:<normalised profile path>`**. Raw, not hashed — every row key in this repo is
readable. Residual risk **G5a**: coverage is total only in a canonically rebuilt database
(`afldb_dev` has the older 12,472 population), so the loader must **fail closed** and never fall
back to `players.id` or a name.

**Provenance — CORRECTED.** Derived rows are stamped **`source_id = afltables`**, not a new
"derived" source. Proven precedent: ISSUE-095's `club_seasons` derivation stamps
`(SELECT id FROM sources WHERE key = 'afltables')` in `rebuild_derived.py`. **No new sources row,
and therefore no migration, is required.** `draftguru` is correctly no longer claimed.

**Legacy→derived transition — RESOLVED: rekey in place (model A).** All **46** `award_winners.id`
values are preserved, including 9441; nothing is deleted. A transition is *mandatory* — left alone
the derived loader would insert 46 new rows and leave the legacy 46, giving 92 silently duplicated
Coleman rows. Three steps: add the Coleman slug to `import_awards.py:417-420`'s
`other_group_awards` exclusion (the mechanism `under_22` already uses); a one-time fail-closed
rekey of `source_id`/`source_record_id` only, modelled on `import-first-kick-goal.ts:312-411`
(exact 1:1 preflight, retry-safe three-way state, single transaction, `UPDATE … WHERE id`); then
the first derived load, which must report **46 updated / 0 inserted / 0 deleted**.

**ISSUE-111 is NOT blocked. Its design is complete.**
`issues/open/AFLDB-ISSUE-111-HANDOFF.md` is the **authoritative implementation continuation** for
ISSUE-111 — a fresh account should start there.

**ISSUE-112** remains the curated-manifest child (blocked on its G0 measurement and the one-time
extraction decision). **ISSUE-113** remains the Brownlow season-total child (source undecided).
Neither was investigated in pass 3, deliberately.

**Pass 3 wrote no implementation code, ran no Git command, ran no test suite, mutated no database,
and accessed no production system.** ISSUE-102's parent architecture is now complete enough for
child implementation to begin.

---

## CHECKPOINT — pass 4 (2026-09-01): ISSUE-112 G0 — operator decision recorded, measurement BLOCKED

Scope of the pass: ISSUE-112 G0 only. Read-only. No implementation, no manifests, no scrape;
ISSUE-111 and ISSUE-113 untouched; `D:\dev\afldb` not accessed; no Git command.

- **Operator decision recorded** (`AFLDB-ISSUE-112.md` §11.1, §13): the one-time curated-manifest
  bootstrap extraction source is the **existing legacy-loaded AFLDB PostgreSQL state**, not a
  fresh upstream scrape. Prerequisite §11.1 is now **DECIDED**.
- **G0 per-family measurement — BLOCKED, failed closed.** The worktree has no proven path to
  `afldb_dev`: no `.env`, no `AFLDB_*`/`PG*` env vars (Git Bash and PowerShell both checked), no
  `psql`/`pg_isready`, no listening tunnel port. The pass was authorised only on condition the
  connection be *proven* `afldb_dev` first; it could not be, so no connection was made and no
  query ran. Database safety proof — NOT ESTABLISHED.
- **Delivered instead (repository-only, no DB):** `AFLDB-ISSUE-112.md` §14 now carries the exact
  reproducible G0 measurement contract per family (§14.2, `SELECT`-only, with a step-0 connection
  guard), and the structure-only lossless-export assessment against the chosen PostgreSQL source
  (§14.3), derived from the applied schema (migrations 005/042/059/061) and `import_awards.py`.
- **Key lossless finding (structural, needs the measured values to finalise):** the §4.2 common
  manifest column **`source_citation`** cannot be extracted from PostgreSQL at per-row page
  granularity for any of the five link-target tables — none has a `source_url`/`source_citation`
  column and the loader drops the legacy per-row URL. Recoverable only at *source* granularity
  (`draftguru`/`wikipedia`/`footywire`). One operator choice needed (accept source-granularity /
  read `source_url` from the legacy SQLite file / reconstruct from `docs/acquisition/`). **No
  scrape proposed — the pass stops at stating the gap.** Secondary: `hall_of_fame` and
  `honour_team_members` persist no stable id (ids minted once at bootstrap, already the §4.2
  design); `captaincies` and Rising Star club/opponent are reconstructed from `club_id`
  (deterministic, total) rather than carried verbatim.
- **Files changed this pass:** `issues/open/AFLDB-ISSUE-112.md`, `issues/open/AFLDB-ISSUE-102-HANDOFF.md`,
  `IssuesIndex.md` (next-action lines for ISSUE-102 and ISSUE-112 only). No `CHANGELOG.md` change.
- **Exact next action:** operator supplies a proven `afldb_dev` connection (tunnel + worktree
  `.env`, or run §14.2 and return output); a fresh session records the measured values, sets G0
  PASS/FAIL per family against the existing §5/§10 contract, and resolves the §14.3 pending items
  (`source_citation` granularity, §11.3 ledger coverage, §11.4 natural-key decision). Only then
  does §11.2 phasing (honour teams first) begin.

---

## CHECKPOINT — pass 5 (2026-09-01): ISSUE-112 G0 measurement EXECUTED — all families PASS

Scope: ISSUE-112 G0 only. Read-only. No implementation, no manifests, no scrape; ISSUE-111 and
ISSUE-113 untouched; `D:\dev\afldb` not accessed; no Git command.

**The G0 measurement blocked in pass 4 was run.** Path used: **SSH to the streamanator
development server** (`arm@10.0.40.100`, `/home/arm/projects/afldb`), DSN read from that
checkout's `.env` (`AFLDB_IMPORT_DATABASE_URL`, password never printed), a single `psql` session
opened as `BEGIN TRANSACTION READ ONLY`, the full `AFLDB-ISSUE-112.md` §14.2 contract piped over
stdin, then `ROLLBACK`. No server-side file written, no database row changed.

- **Connection / read-only safety proof (observed):** `current_database() = 'afldb_dev'`,
  `current_user = 'afldb_import'` (chosen so the link tables are SELECT-visible — `afldb_app`
  cannot read `player_link_resolutions` / `player_link_suggestions`),
  host `127.0.0.1:5432`, `transaction_read_only = 'on'`, PostgreSQL 16.15. The
  `db='afldb_dev' AND txn_read_only='on'` precondition passed before any measurement query.
  `afldb_test` not used.
- **G0 PASS for all nine families (A, 1–7, L).** Full measured matrix now in
  `AFLDB-ISSUE-112.md` §14.4; full pass log in §14.6. Headlines:
  - Every `season`-bearing family (1, 4, 5, 6, 7): **`source_record_id` NULL = 0 and
    distinct = row count** — the §14.2 completeness/uniqueness verdict PASSes for all five.
    Families 2 & 3 have no such column by design (ids minted `hof:<seq>` /
    `honourteam:<team-slug>:<seq>` at bootstrap).
  - **Every natural-key probe returned zero true collisions** — HoF `(name, inducted_year)` and
    `name` alone (343 rows, 45 with NULL year); honour teams `(team_name, player_name_raw)` and
    `(team_name, player_id)`; captaincies `(season, club_id, player_name_raw, role)`.
    All-Australian's 10 `(season, player_name_raw)` pairs are the 1984 state/club dual selection
    (9) + one genuine same-name (1), and don't touch the `(source_id, source_record_id)` key.
  - Row counts: A 40 defs · 1 AA 1,158 (1953–2025) · 2 HoF 343 · 3 honour teams 113 ·
    4 captaincies 1,375 (all linked) · 5 Rising Star 766 (1993–2026, 1 winner/decided season) ·
    6 club B&F 752 (19 `bf-*`) · 7 named medals 979 (17 slugs).
  - **Family L link ledger:** `player_link_resolutions` 74 awards-scoped rows (`award_winners`
    68, `hall_of_fame` 5, `honour_team_members` 1; `award_nominations` 0, `captaincies` 0).
    **Orphan check clean — 0 missing target rows, 0 `linked`-decision player mismatches.**
    `player_link_suggestions` empty.
- **PostgreSQL bootstrap completeness:** every manifest field is present or deterministically
  reconstructable, with exactly the three §14.3-predicted gaps and no new one — (1)
  `source_citation` only at *source* granularity (`draftguru`/`wikipedia`/`footywire`); (2) HoF /
  honour-team ids minted at bootstrap; (3) captaincies raw club + Rising Star club/opponent
  reconstructed from `club_id`.
- **§11.3 (person-link ledger) — partially resolved.** `data/reference/draftguru-link-decisions.json`
  holds **6 explicit decisions**; 94.5% of `draftguru` award links (2,567 / 2,716) are automatic
  and regenerated by the scorer. Row-by-row coverage proof is a **G1** item (`award_winners`
  drops the `player_url` bridge key).
- **§11.4 (natural keys) — measurement supports keeping them.** Zero collisions on every
  relevant key. Only the rename-is-link-losing property remains, as an operator policy
  acknowledgement.
- **Still an operator decision, no scrape proposed:** `source_citation` granularity
  (accept source-granularity / read `source_url` from the legacy SQLite file / reconstruct from
  `docs/acquisition/`). Recorded as explicitly pending — **not** decided by this pass.
- **Files changed this pass:** `issues/open/AFLDB-ISSUE-112.md`,
  `issues/open/AFLDB-ISSUE-102-HANDOFF.md`, `IssuesIndex.md` (ISSUE-112 next-action text only).
  No `CHANGELOG.md` change.
- **Exact next action:** ISSUE-112 implementation phasing (§11.2) begins — **honour teams first**
  (113 rows, minted ids, natural key proven collision-free). Operator settles the
  `source_citation` granularity choice and acknowledges the §11.4 rename property before a merge;
  neither blocks starting honour teams. Then G1 (manifest round-trips to the same row set).

---

## CHECKPOINT — pass 6 (2026-09-01): ISSUE-112 slice 1 (HONOUR TEAMS) — BLOCKED, spec handed off

Scope: the first ISSUE-112 implementation slice, **honour teams only**. Read-only bootstrap
extraction from `afldb_dev` authorised on proof of connection; DB-free tests / `tsc` /
`afldb_test`-only integration / `git diff --check` authorised. No scrape, no `afldb_dev`
mutation, no production, ISSUE-111 / ISSUE-113 untouched, `D:\dev\afldb` not accessed, no Git.

**Outcome: BLOCKED, fail-closed (as Pass 4). No manifest, no loader change, no test written.**
Full detail in `AFLDB-ISSUE-112.md` §15.

- **Blocker 1 — no reachable bootstrap source.** The manifest needs the *contents* of the 113
  `afldb_dev.honour_team_members` rows; G0 measured only aggregates and the rows are not in the
  repo. This worktree @ `78380eb` has no `.env`, no `AFLDB_*`/`PG*` env vars, no `psql`, no
  listening tunnel port, no legacy SQLite / fixture anywhere, and `data/awards/` holds only
  `22-under-22.csv`. `~/.ssh/config` has a `dev` / `streamanator` host (`10.0.40.100`, host key
  known) but key auth is **refused** (`Permission denied (publickey,password)`) and no
  non-interactive password path exists. Pass 5's `afldb_dev` read was an operator-assisted SSH
  session; that path is not available now. Database safety proof NOT established — no connection
  made.
- **Blocker 2 — `source_citation` value undecided.** §4.2 requires the column; PostgreSQL
  retains citation only at source granularity (`wikipedia`); the value policy is an open
  operator decision (§14.5 item 1) this pass must not invent. Missing field: **`source_citation`**.
- **Carried-forward risk (not a slice-1 blocker):** `import_honour_teams` has no resolver and
  only 1 of 89 linked rows is in `player_link_resolutions`; carrying `player_id` verbatim
  reproduces the family in the legacy-loaded DB (G1) but `players.id` is not rebuild-stable
  (ISSUE-111 G5). Record against the deferred canonical-rebuild stage (§7).
- **Delivered instead (repo-only, no DB):** `AFLDB-ISSUE-112.md` §15 now carries the finalised
  honour-teams manifest design (path `data/awards/honour-teams.csv`, exact 11-column header and
  order, `honourteam:<slug>:<seq>` mint rule, deterministic ordering, parser module shape, the
  full §5 refusal list, and the exact `import_awards.py` loader edit), plus §15.5 — the
  complete read-only bootstrap extraction SQL (one `BEGIN TRANSACTION READ ONLY` block, step-0
  connection guard, manifest body + provenance + the 1 link decision + natural-key re-proof +
  field completeness + value vocabularies + the §15.3 rebuild-stability probe).
- **Files changed this pass:** `issues/open/AFLDB-ISSUE-112.md`,
  `issues/open/AFLDB-ISSUE-102-HANDOFF.md`, `IssuesIndex.md` (ISSUE-112 next-action text only).
  No `CHANGELOG.md` change.
- **Exact next action:** operator supplies a proven read-only `afldb_dev` connection (or runs
  §15.5 and returns output) **and** settles the `source_citation` policy; a pass then populates
  the CSV, writes `tools/migration/honour_teams.py`, rewires only `import_honour_teams`'s input,
  adds `"honour_teams"` to `LEGACY_FREE_GROUPS` + a `"wikipedia"` `BATCH_SOURCE_KEYS` entry, and
  adds the DB-free + honour-teams-slice integration tests. Validation: DB-free → `tsc` →
  focused `awards-reload-links` on `afldb_test` under the restricted role → `git diff --check`.
  Do not resolve ISSUE-112; do not add the canonical-rebuild stage yet.

---

## CHECKPOINT — pass 7 (2026-09-01): ISSUE-112 slice 1 (HONOUR TEAMS) — IMPLEMENTED

Scope: complete the honour-teams slice Pass 6 left blocked. Two new operator decisions unblocked
it: a dedicated SSH key (`~/.ssh/afldb_dev`, distinct from the `dev` host alias's default key)
authenticates to the streamanator server where Pass 6 found auth refused; and `source_citation`
is decided as source-granularity `wikipedia` for every honour-teams row.

- **Bootstrap extraction executed, read-only, proven** — same `BEGIN TRANSACTION READ ONLY`
  step-0 guard discipline as Pass 5, over SSH to `arm@10.0.40.100`, `psql` reading
  `AFLDB_IMPORT_DATABASE_URL` from `/home/arm/projects/afldb/.env`. Proven `db=afldb_dev`,
  `role=afldb_import`, `txn_read_only=on`. 113 rows extracted, matching G0 exactly; zero
  natural-key collisions re-confirmed; the one `player_link_resolutions` decision (Ted Whitten)
  confirmed consistent with the live row.
- **Manifest built:** `data/awards/honour-teams.csv` (114 lines), `source_key` minted
  `honourteam:<slug>:<seq>`, `source_citation = wikipedia` throughout, whitelisted in
  `.gitignore`.
- **Loader wired:** new `tools/migration/honour_teams.py` (validating parser, DB-free `--check`,
  no best-effort coercion); `import_awards.py`'s `import_honour_teams()` now calls
  `load_honour_teams()` instead of reading legacy SQLite `team_selections` — `lite` dropped from
  its signature; `reload_keyed` call, the advisory lock and the §4.3/§4.4 collision preflight are
  byte-identical to before; `"honour_teams"` added to `LEGACY_FREE_GROUPS`;
  `BATCH_SOURCE_KEYS["honour_teams"] = "wikipedia"` added. No other group touched.
- **Tests added:** `tests/honour-teams-source.test.ts` (22 DB-free cases, all passing) and a new
  legacy-free describe block in `tests/integration/awards-reload-links.test.ts` (113-row parity,
  3x idempotent reload fingerprint, the one link decision survives, 24 unlinked stay unlinked,
  `manual_admin_edit` row untouched, no other family's row counts change).
- **Validation:** DB-free 22/22 passed; `npx tsc --noEmit` clean; `git diff --check` clean. The
  integration file was executed against the **real `afldb_test`** on streamanator (owner DSN via
  a temporary SSH tunnel) to prove the new block loads and is wired correctly — it **self-skips**
  along with every other legacy-gated block in that file (59 skipped, 0 run), because
  `AFLDB_TEST_IMPORT_DATABASE_URL` (the restricted `afldb_import` test-role credential every one
  of these blocks requires) is not configured anywhere reachable. This is a pre-existing
  environment gap, not introduced by this pass — provisioning that credential is the concrete
  next action for real DB-backed validation.
- **Carried-forward risk (not a slice-1 blocker, unchanged from Pass 6 §15.3):** the manifest
  carries `player_id` verbatim from `afldb_dev` for the 89 linked rows; `players.id` is not
  rebuild-stable (ISSUE-111 G5), and 4 of the 89 linked rows do not even carry a unique
  `afltables_profile_url` today, so a rebuild-stable re-resolution step could not cover all 89
  without a fresh adjudication. Recorded against the deferred canonical-rebuild AWARDS/HONOURS
  stage (§7); `source_key`, not `player_id`, is the manifest's durable identity.
- **Files changed this pass:** `.gitignore`, `data/awards/honour-teams.csv` (new),
  `tools/migration/honour_teams.py` (new), `tools/migration/import_awards.py`,
  `tests/honour-teams-source.test.ts` (new), `tests/integration/awards-reload-links.test.ts`,
  `issues/open/AFLDB-ISSUE-112.md` §16, this file, `IssuesIndex.md`. No `CHANGELOG.md` entry —
  nothing has been deployed or run against a live application database. No Git command run.
  `afldb_dev` was read-only. ISSUE-111 / ISSUE-113 untouched. `D:\dev\afldb` not accessed.
- **Exact next action:** provision `AFLDB_TEST_IMPORT_DATABASE_URL` for a `_test` database's
  `afldb_import` role and run the new integration block for real; then phase 2 (Hall of Fame,
  343 rows), per the §11.2 order. Do not resolve ISSUE-112.

---

## CHECKPOINT — pass 8 (2026-09-01): ISSUE-112 slice 1 (HONOUR TEAMS) — real DB-backed validation EXECUTED, GREEN

Scope: Pass 7's exact next action — provision the restricted `afldb_import` test-role credential
and run the new integration block for real, without persisting credentials or touching the
streamanator checkout. Executed entirely from `D:\dev\afldb-issue-102`; streamanator used only as
the PostgreSQL endpoint over a temporary SSH local port-forward (`arm@10.0.40.100`, key
`~/.ssh/afldb_dev`), opened and closed within this pass. No file was written to or modified on the
streamanator host.

- **DSN safety proof (both, over the tunnel, before any test ran):** `AFLDB_TEST_DATABASE_URL` →
  `current_database()=afldb_test`, `current_user=afldb_owner`. `AFLDB_TEST_IMPORT_DATABASE_URL`
  did not exist anywhere reachable (confirmed absent from the streamanator `.env`, same finding as
  Pass 7) — derived ephemerally in-process from `AFLDB_IMPORT_DATABASE_URL` by substituting only
  the database name (`afldb_dev` → `afldb_test`), never written to disk; proof:
  `current_database()=afldb_test`, `current_user=afldb_import`. No password or full DSN printed at
  any point.
- **Local blocker found and resolved:** the suite spawns `import_awards.py` as a Python child
  process; Windows `python` (3.12.10) lacked `psycopg`, which would have made `canSpawnPython`
  false and self-skipped the whole file regardless of DSN configuration — a different cause than
  Pass 7's skip. Installed `psycopg[binary]` locally via `pip install --user` (local machine only;
  no repository or server file touched).
- **Executed:** `npx vitest run tests/integration/awards-reload-links.test.ts -t "honour-teams
  manifest reload"` — **6/6 passed**, 0 failed (53 other pre-existing tests excluded by the `-t`
  filter, not restricted-role skips). Results:
  - 113-row parity: `import_batches` records `records_read=113`, `records_rejected=0`,
    `status=completed`; `honour_team_members` split `total=113, linked=89, unlinked=24, teams=5`.
  - Idempotent: three consecutive reloads produce a byte-identical `(id, team_name,
    player_name_raw, player_id)` fingerprint.
  - The one explicit `player_link_resolutions` decision (Ted Whitten) stays resolved across a
    reload.
  - All 24 unlinked rows stay unlinked.
  - A synthetic `manual_admin_edit`-sourced row survives a reload untouched.
  - `hall_of_fame`, `captaincies`, `award_winners`, `award_nominations` row counts unchanged by a
    `honour_teams`-only run.
- **`git diff --check`:** clean.
- **Files changed this pass:** `issues/open/AFLDB-ISSUE-112.md` §17, this file, `IssuesIndex.md`.
  No server file touched (streamanator checkout unchanged — verified before and after: the
  honour-teams slice files remain absent there). No migration run. No production contact. No
  `afldb_dev` contact. No Git command run. Hall of Fame not started. ISSUE-112 not resolved.
- **Exact next action:** honour-teams family-specific G1–G4 (`AFLDB-ISSUE-112.md` §10) are now
  satisfied by this pass's evidence — but this closes G1–G4 **for the honour-teams family only**,
  not for ISSUE-112 as a whole (six families remain unstarted; G2/G3 need all seven). Phase 2 —
  Hall of Fame (343 rows) — is the next implementation slice, per the §11.2 order. Do not resolve
  ISSUE-112.

---

## CHECKPOINT — pass 9 (2026-09-01): ISSUE-112 slice 2 (HALL OF FAME) — IMPLEMENTED and DB-validated

Scope: the second ISSUE-112 implementation slice, **Hall of Fame only** (§11.2 phase 2). Full
detail in `AFLDB-ISSUE-112.md` §18. Read-only `afldb_dev` bootstrap authorised on proof of
connection; DB-free tests / `tsc` / `afldb_test`-only integration under the restricted role /
`git diff --check` authorised. No scrape, no `afldb_dev` mutation, no production, no migration,
no privilege change, ISSUE-111 / ISSUE-113 untouched, `D:\dev\afldb` not accessed, streamanator
checkout not modified, no Git command.

**Outcome: COMPLETE and GREEN.**

- **Bootstrap extraction executed, read-only, proven** — same `BEGIN TRANSACTION READ ONLY`
  step-0 guard as Passes 5/7, over SSH to `arm@10.0.40.100` (`psql` reading
  `AFLDB_IMPORT_DATABASE_URL` from the streamanator `.env`, password never printed). Proven
  `current_database() = afldb_dev`, `current_user = afldb_import`, `transaction_read_only = on`,
  host `127.0.0.1:5432`, PostgreSQL 16.15. 343 rows extracted, matching G0 exactly: provenance
  `wikipedia` for all; `inducted_year` 1996–2026 with 45 NULL; linked 246 / name-only 97; 34
  legends; `(name, inducted_year)` and `name`-alone duplicates both 0; **5** `player_link_resolutions`
  decisions (all `action = linked`, latest-per-target = 5, 0 orphaned, 0 player mismatch);
  `player_link_suggestions` empty. New (vs honour teams): **3 `player_id` values appear on more
  than one row** (same person on a dated + an undated row) — legitimate, `hall_of_fame` has no
  linked-identity uniqueness constraint, so the parser does not enforce global `player_id`
  uniqueness.
- **Manifest:** `data/awards/hall-of-fame.csv` (344 lines), `source_key` minted `hof:<seq>` as an
  **internal manifest key** (the DB reload key stays the natural `(name, inducted_year)`);
  deterministic order `inducted_year ASC NULLS LAST, name` with `name` extracted under
  `COLLATE "C"` so the validator's code-point comparison matches byte-for-byte (recorded: the
  first extraction used the default collation and the ordering validator correctly rejected it —
  re-extracted). `source_citation = wikipedia` throughout (source-granularity operator policy,
  same as the honour-teams slice). `.gitignore` whitelisted.
- **Loader:** new `tools/migration/hall_of_fame.py` (validating parser, DB-free `--check`, no
  best-effort coercion — full §5 refusal list plus the `is_legend`/`legend_year` and
  `removed_year`/`category='removed'` cross-field invariants, both directions).
  `import_awards.py`'s `import_hall_of_fame()` now calls `load_hall_of_fame()` instead of reading
  legacy SQLite — `lite` dropped from its signature and its `main()` call. The `reload_keyed`
  call (key `(name, inducted_year)`, 14-column value list, `scope_column="source_id"`,
  `name_column="name"`, `refuse_out_of_scope_key=True`) is **byte-identical** to before.
  `"hall_of_fame"` added to `LEGACY_FREE_GROUPS`; `BATCH_SOURCE_KEYS["hall_of_fame"] = "wikipedia"`
  added. No other group, `GROUPS`, `GROUP_ORDER`, `GROUP_REQUIRES` entry, or the `--dry-run`
  legacy-table list changed. No migration, no privilege change.
- **Tests:** `tests/hall-of-fame-source.test.ts` (new, 24 DB-free cases, all passing) and a new
  legacy-free `describe` block in `tests/integration/awards-reload-links.test.ts`
  (`canRunHallOfFameImporter`, mirrors the honour-teams block): 343-row parity, 3× idempotent
  reload fingerprint, all 5 explicit `player_link_resolutions` decisions survive with id +
  decided `player_id` stable, all 97 name-only rows stay unlinked, `manual_admin_edit` row
  untouched, no other family's row counts change.
- **Validation:** DB-free 24/24 passed; `npx tsc --noEmit` clean; `git diff --check` clean. The
  integration block was **executed for real against `afldb_test`** under the restricted
  `afldb_import` role, over a temporary SSH local port-forward to streamanator's PostgreSQL
  (opened and closed within the pass; `AFLDB_TEST_IMPORT_DATABASE_URL` derived ephemerally
  in-process, never persisted, since it is still unconfigured anywhere reachable — same finding
  as Pass 8) — **6/6 green**; re-run alongside the honour-teams block gives **12/12**, confirming
  honour teams is not regressed. DSN safety proved (`afldb_test` / `afldb_owner` and
  `afldb_test` / `afldb_import`) before any test ran; no password or full DSN printed.
- **Carried-forward risk (not a slice-2 blocker, same kind as Pass 6/7 §16.3):** the manifest
  carries `player_id` verbatim from `afldb_dev` for the 246 linked rows; `players.id` is not
  rebuild-stable (ISSUE-111 G5), and 7 of the 246 linked rows lack a unique
  `afltables_profile_url` today. Recorded against the deferred §7 canonical-rebuild AWARDS/HONOURS
  stage; `source_key`, not `player_id`, is the manifest's durable identity.
- **Files changed this pass:** `.gitignore`, `data/awards/hall-of-fame.csv` (new),
  `tools/migration/hall_of_fame.py` (new), `tools/migration/import_awards.py`,
  `tests/hall-of-fame-source.test.ts` (new), `tests/integration/awards-reload-links.test.ts`,
  `issues/open/AFLDB-ISSUE-112.md` §13/§18, this file, `IssuesIndex.md`. No `CHANGELOG.md` entry
  — nothing deployed or run against a live application database. Two stray 0-byte tooling-artefact
  files in the worktree root (`operator`, `!line.includes('`) were removed; never tracked. No Git
  command run. `afldb_dev` was read-only. The streamanator checkout was not modified.
- **Exact next action:** phase 3 — **captaincies (1,375 rows)**, per the §11.2 order. Captaincies
  reloads on `(source_id, source_record_id)` (not a natural key) and has ISSUE-085 ownership
  scoping + the `buildCaptaincyFixtureDb` precedent, so its manifest shape differs from the two
  natural-keyed slices done so far. Do not resolve ISSUE-112; do not add the canonical-rebuild
  AWARDS/HONOURS stage yet.

---

## CHECKPOINT — pass 10 (2026-09-01): ISSUE-112 slice 3 (CAPTAINCIES) — IMPLEMENTED and DB-validated

Scope: the third ISSUE-112 implementation slice, **captaincies only** (§11.2 phase 3). Full
detail in `AFLDB-ISSUE-112.md` §19. Read-only `afldb_dev` bootstrap authorised on proof of
connection; DB-free tests / `tsc` / `afldb_test`-only integration under the restricted
`afldb_import` role / combined ISSUE-112 regression / `git diff --check` authorised. No scrape,
no `afldb_dev` mutation, no production, no migration, no privilege change, ISSUE-111 / ISSUE-113
untouched, `D:\dev\afldb` not accessed, streamanator checkout not modified, no Git command.

**Outcome: COMPLETE and GREEN.**

- **Bootstrap extraction executed, read-only, proven** — same `BEGIN TRANSACTION READ ONLY`
  step-0 guard as Passes 5/7/9, over SSH to `arm@10.0.40.100` (`psql` reading
  `AFLDB_IMPORT_DATABASE_URL` from the streamanator `.env`, password never printed). Proven
  `current_database() = afldb_dev`, `current_user = afldb_import`, `transaction_read_only = on`,
  host `127.0.0.1:5432`, PostgreSQL 16.15. 1,375 rows extracted, matching G0 exactly: provenance
  `wikipedia` for all; `source_record_id` all `^[0-9a-f]{24}$`, distinct = 1,375, none null;
  season 1897–2026, 130 distinct (contiguous); linked 1,375 / unlinked 0; `club_id` NOT NULL,
  18 distinct clubs; role vocabulary `{Captain}`; `period` on all, `notes` on 178; natural key
  `(season, club_id, player_name_raw, role)` dup 0; **`player_link_resolutions` and
  `player_link_suggestions` for captaincies both 0**. **New probe:** all 1,375 rows verified to
  round-trip — stored `club_id` equals `identity_for_season(org, season)`, so re-resolving the
  canonical `clubs.name` season-aware reproduces every `club_id` exactly (0 mismatches). All 444
  distinct linked `player_id`s resolve to exactly one `afltables_profile_url` (0 with none).
- **Manifest:** `data/awards/captaincies.csv` (1,376 lines). Columns
  `source_key,season,club,player,player_id,link_status,role,period,note,source_citation`.
  **`source_key` = the preserved `source_record_id`, carried verbatim — NOT re-minted** (the key
  difference from slices 1 & 2, which mint internal ids because their tables have no persisted
  id). Deterministic order: `source_key` ascending under `COLLATE "C"`. `club` = canonical
  `clubs.name`, re-resolved by the loader's season-aware `ClubResolver` → a rebuild-stable club
  identity, not a frozen `club_id`. `source_citation = wikipedia` throughout (source-granularity
  operator policy). `.gitignore` whitelisted.
- **Loader:** new `tools/migration/captaincies.py` (validating DB-free `--check` parser, no
  best-effort coercion). `import_awards.py`'s `import_captaincies()` now calls
  `load_captaincies()` instead of reading legacy SQLite — **`lite` dropped from its signature
  and its `main()` call**. `_refuse_captaincy_natural_key_collisions()` (function and call) and
  the `reload_keyed(...)` call (key `(source_id, source_record_id)`, 11-column value list,
  `scope_column="source_id"`, `allow_link_loss`) are **byte-identical**; `captaincies_natural_uq`
  semantics untouched. `"captaincies"` added to `LEGACY_FREE_GROUPS`;
  `BATCH_SOURCE_KEYS["captaincies"] = "wikipedia"` added. `GROUPS` / `GROUP_ORDER` /
  `GROUP_REQUIRES` / `--dry-run` list unchanged. No migration, no privilege change.
- **Tests:** `tests/captaincies-source.test.ts` (new, 22 DB-free cases, all passing) and a new
  legacy-free `describe` block in `tests/integration/awards-reload-links.test.ts`
  (`canRunCaptainciesImporter`): 1,375-row parity, per-era-identity club re-resolution, 3×
  idempotent fingerprint, resolved-link id/player stability, all-linked preservation,
  `manual_admin_edit` protection **(AFLDB-ISSUE-085)** and natural-key collision fail-closed
  **(AFLDB-ISSUE-085)**, other-family non-interference. The synthetic-SQLite
  `buildCaptaincyFixtureDb` + the `describe('captaincies reload reconciles only wikipedia-owned
  rows (AFLDB-ISSUE-085)')` block were **retired** (the importer no longer reads a legacy SQLite
  handle) — their two protections are **preserved manifest-driven** in the new block; the dead
  `CaptaincyRow` type and `node:os`/`mkdtempSync`/`rmSync` imports were removed with them.
- **Validation:** DB-free 22/22; `npx tsc --noEmit` clean; `git diff --check` clean. Integration
  **executed for real against `afldb_test`** under the restricted `afldb_import` role, over a
  temporary SSH local port-forward to streamanator's PostgreSQL (opened and closed within the
  pass; `AFLDB_TEST_IMPORT_DATABASE_URL` derived ephemerally in-process — host:port to the
  tunnel, `afldb_dev → afldb_test` — never persisted, since it is still unconfigured anywhere
  reachable, same finding as Passes 8/9). DSN safety proved (`afldb_test`/`afldb_owner` and
  `afldb_test`/`afldb_import`) before any test ran; no password or full DSN printed. Results:
  **captaincies block 8/8 green**; **combined ISSUE-112 regression (honour teams + Hall of Fame
  + captaincies) 20/20**, confirming slices 1 & 2 not regressed; **whole
  `awards-reload-links.test.ts` file 50 passed / 21 skipped / 0 failed** (the 21 skips are the
  pre-existing `AFLDB_LEGACY_SQLITE`-gated blocks — unchanged by this pass).
- **Carried-forward risk (not a slice-3 blocker, same kind as Pass 7/9):** the manifest carries
  `player_id` verbatim; `players.id` is not rebuild-stable (ISSUE-111 G5). *Better than earlier
  slices:* every linked captaincy player has a unique `afltables_profile_url`, so a
  rebuild-stable re-resolution is possible — but it is the deferred §7 stage's job. **The club
  identity is already rebuild-stable** via `ClubResolver` re-resolution. Recorded against §7.
- **Files changed this pass:** `.gitignore`, `data/awards/captaincies.csv` (new),
  `tools/migration/captaincies.py` (new), `tools/migration/import_awards.py`,
  `tests/captaincies-source.test.ts` (new), `tests/integration/awards-reload-links.test.ts`,
  `issues/open/AFLDB-ISSUE-112.md` (§13, §19), this file, `IssuesIndex.md`. No `CHANGELOG.md`
  entry — nothing deployed or run against a live application database. One stray 0-byte
  tooling-artefact file in the worktree root (`tuple[list[str]`) was removed; never tracked. No
  Git command run. `afldb_dev` read-only for the §19.1 extraction only. No migration. No
  production contact. The streamanator checkout was not modified. ISSUE-111 / ISSUE-113
  untouched. `D:\dev\afldb` not accessed.
- **Exact next action:** phase 4 — **Rising Star (766 rows)**, per the §11.2 order (Rising Star
  → All-Australian → club best-and-fairest → named medals). Rising Star reloads on
  `(source_id, source_record_id)` like captaincies, targets `award_nominations`, carries a
  `stat_line` jsonb + round grain, and needs the `awards` definition present first. Do not
  resolve ISSUE-112; do not add the canonical-rebuild AWARDS/HONOURS stage yet.

---

## Confirmed source findings

Each verified by direct read at baseline `95819a3`.

### Legacy dependency
- `tools/migration/import_awards.py:1407-1416` —
  `needs_legacy = any(key != "under_22" for key in selected)`, then
  `require_env("AFLDB_LEGACY_SQLITE") if needs_legacy else None`. **Per-group, not per-file.**
- `tools/migration/common.py:71-77` `connect_legacy()` opens SQLite **read-only**
  (`file:{path}?mode=ro`).
- Groups (`import_awards.py:1320-1328`): `awards`, `all_australian`, `under_22`, `rising_star`,
  `hall_of_fame`, `honour_teams`, `captaincies`. Only `under_22` is legacy-free.
- Other `AFLDB_LEGACY_SQLITE` consumers: `import_legacy_afl.py:1021`,
  `enrich_birth_dates.py:406`, `tools/validation/validate_migration.py:340`, `.env.example:198`,
  `tools/maintenance/00_install_postgres*.sh`, plus the test guard at
  `tests/integration/awards-reload-links.test.ts:59,76-79` and four **negative** contract tests.
- `docs/deployment.md` §7 ("Data refresh", ~`:240-250`) still lists `import_awards.py` in the
  standing dev/production refresh sequence → **still operationally required**.
- `issues.md:6772-6776` states the legacy file is *"an aggregation of upstream sources
  (fitzRoy/AFL Tables, DraftGuru, Wikipedia, FootyWire), not a primary source"*.

### Canonical rebuild gap
- `tools/db/rebuild-test.ts` stages: PRECHECK, RESET, MIGRATIONS, PRIVILEGES, REFERENCE, FITZROY,
  DRAFTGURU, DERIVED, LADDER-WITNESS, FINAL VALIDATION. **No awards stage** — searching that file
  for `award|honour|captainc|hall_of_fame` returns one unrelated comment.
- Consequence: a canonical rebuild leaves `awards`, `award_winners`, `award_nominations`,
  `hall_of_fame`, `honour_team_members`, `captaincies` at **zero rows**, with no Stage-9 gate.
- `tests/db-test-rebuild.test.ts:716` asserts the plan carries no `AFLDB_LEGACY_SQLITE` — must
  keep passing.

### Coleman (proven this pass — the key new evidence)
- `data/reference/stat-availability.json`: `goals` is **one unbroken range,
  `complete 1897-2026`**.
- `src/db/migrations/003_matches.sql:69` —
  `CONSTRAINT matches_is_final_ck CHECK (is_final = (round_type <> 'home_and_away'))`. So
  `NOT is_final` is **exactly** the home-and-away filter, database-enforced.
- `tools/migration/import_awards.py:315` — the shipped description is *"Awarded to the leading
  goalkicker of the home-and-away season."*
- **`player_season_stats.goals` sums finals too** — `rebuild_derived.py`
  `REBUILDS["player_season_stats"]`, `agg` CTE, `sum(c.goals)` over every game — and
  `src/db/queries/seasons.ts:148-166` `getSeasonGoalkickers()` reads it as AFLDB's whole-season
  "leading goalkicker" concept. **That concept already exists and is NOT the Coleman Medal.**
  Derive from `player_match_stats` + `matches`, never from `player_season_stats`.
- `src/db/migrations/004_player_match_stats.sql:33` — `goals smallint`, **nullable**. NULL ≠ 0;
  verify, do not assume.
- **The first Coleman season is NOT stated anywhere in the repository.** `import_awards.py:359-361`
  sets `awards.first_season`/`last_season` from `min`/`max(season)` of the legacy rows — it is a
  **measured** value. `docs/data-dictionary.md:191` warns that in the legacy `awards` table *"most
  series begin 1980"*. Searches of `tests/`, `data/`, `src/`, `docs/`, `tools/nl/` found only the
  slug, the description string and unrelated people named Coleman.

### Brownlow
- `brownlow_season_votes` sole writer: `import_legacy_afl.py:684` `import_brownlow()`, which
  `truncate()`s **both** `brownlow_season_votes` and `brownlow_round_votes` (a coupling defect —
  the round table now has a canonical writer). Columns copied at `:720-725`.
- `brownlow_round_votes` canonical writer: `import_fitzroy_core.py:2515`.
- `stat-availability.json`: `brownlow_season_total` `complete 1924-1941` + `complete 1946-2025`;
  `brownlow_round_votes` `complete` only `1984-2025`. **~56 of ~102 decided seasons have no
  round-grain votes.**
- `rebuild_derived.py:23-26` and `src/db/queries/db-health.ts:94` both call the season table
  **AUTHORITATIVE**.
- **Silent-wrongness hazard:** `rebuild_derived.py`'s `season_brownlow` CTE marks a season
  `complete` only if a row exists, else `not_applicable`. With the table empty, every decided
  season 1924-2025 reads "no medal that season". Migration 015 `:147-148` fixes the semantics:
  `0` = polled none in a decided season; NULL = does not apply.
- Consumers: `player_season_stats`, `player_career_stats`, six Grid Solver axes
  (`grid-solver.ts:695,803,806,811,816,819`), `brownlow.ts:57,148`, `seasons.ts:197`,
  `players.ts:683`, `player-derived.ts:133,201,279,320,363,376`, `sitemap.ts:114`,
  `db-health.ts:254,273,348`.
- `brownlow_season_votes` is **not** in `LINK_TARGET_TABLES`, so it carries no
  `player_link_resolutions` decisions.

### Integrity contracts (all in `tools/migration/common.py:410-703` `reload_keyed()`)
Id-preserving UPDATE (`:662-670`); decisions read `DISTINCT ON (target_id) … created_at DESC`
(`:546-554`) and classified before any write; `LinkDecisionLoss` fail-closed (`:610-617`);
source-name-change guard (`:586-592`); domain-AND-provenance ownership via `scopes=`;
`ReloadOwnershipCollision` (`:506-540`); duplicate-key refusal (`:488-504`); decisions re-applied
(`:648-658`); disagreements reported not resolved (`:594-608`). Advisory lock `(717275, 1)` at
`import_awards.py:257-258`, byte-identical in `awards-admin.ts`.

`LINK_TARGET_TABLES` (`src/db/queries/player-links.ts:37-45`, CHECK-constrained in migration 056):
`award_winners`, `award_nominations`, `hall_of_fame`, `honour_team_members`, `captaincies`,
`player_achievements`, `draft_picks` — **five of seven are awards tables**.

**Privileges: no change needed.** The six awards tables predate migration 045 and are in the
seeded `afldb_meta.import_writable_tables`. `player_link_resolutions` is SELECT+INSERT only
(migrations 066/068); `player_link_suggestions` is SELECT only (migration 070).

### Test contract
- `tests/integration/awards-reload-links.test.ts:205-1247` — the whole link-preservation,
  ownership-refusal, idempotency and advisory-lock matrix — is **skipped** whenever
  `AFLDB_LEGACY_SQLITE` is unset or missing (`describe.skipIf(!canRunImporter)`, `:76-79`).
- `:158-204` (`under_22` role parity) and `:1248-1403` (captaincies, ISSUE-085) **do** run —
  and `:1248` builds its **own temporary SQLite fixture** (`buildCaptaincyFixtureDb`), proving the
  importer can be driven without the real legacy database.
- `tests/integration/release-gates.test.ts:65-81` already carries **skipped** Brownlow assertions
  annotated "no canonical legacy-free writer for `brownlow_season_votes`".

---

## Child issues

| Issue | Title | Runbook | State |
|---|---|---|---|
| `AFLDB-ISSUE-102` | Awards/honours legacy-SQLite acquisition dependency | `issues/open/AFLDB-ISSUE-102.md` | **PARENT**, Open, coordination only |
| `AFLDB-ISSUE-111` | Coleman Medal derivation from canonical AFLDB facts | `issues/open/AFLDB-ISSUE-111.md` | Open, design complete, **blocked on gate G0** |
| `AFLDB-ISSUE-112` | Replace legacy SQLite honours acquisition with curated manifests | `issues/open/AFLDB-ISSUE-112.md` | Open. **G0 PASS (all families)**; §11.1 DECIDED. **Slices 1–3 of 7 IMPLEMENTED + DB-validated 2026-09-01** (honour teams §16/§17, Hall of Fame §18, captaincies §19). Next: phase 4 — Rising Star. `source_citation` granularity + §11.4 rename acknowledgement remain pre-merge operator items |
| `AFLDB-ISSUE-113` | Replace legacy `brownlow_season_votes` acquisition | `issues/open/AFLDB-ISSUE-113.md` | Open, design complete, **source undecided**; outside 102's closure boundary |

**`AFLDB-ISSUE-110` is allocated to unmerged NL semantic-mapping work.** It does not exist in this
worktree at baseline `95819a3`. No ledger content was written for it — only a reservation note in
`issues.md` and `IssuesIndex.md` saying the id is taken and its content is unknown here.

---

## Merge-sensitive note — read before merging

`issues.md` and `IssuesIndex.md` were both edited in this worktree. The ISSUE-110 branch will have
edited the **same two files** to add its own rows and open-issue counts. On merge:

- **Preserve ISSUE-110's own rows verbatim** — do not let this branch's tables overwrite them.
- **Correct the open-issue counts** in both files. This branch says "5 tracked here"; the merged
  total should include ISSUE-110.
- The reservation notes this branch added become redundant once ISSUE-110's real rows land;
  remove them then.

Expect a textual conflict in the Open Issues table of `issues.md` and the open table of
`IssuesIndex.md`. It is a content merge, not a semantic conflict.

---

## Unresolved decisions

Genuinely open. Do not invent answers.

1. **ISSUE-111 G0 — the Coleman first/last award season.** A measured value; the read-only SQL and
   a pre-committed decision rule are in `issues/open/AFLDB-ISSUE-111.md` §3.1. Requires a database
   that still holds the legacy-loaded awards. **Not yet run — no database was touched this pass.**
2. **ISSUE-111 G4** — the `club_id` rule for a mid-season transfer.
3. **ISSUE-111 G5** — whether a `player_id`-bearing stable key is acceptable given that a canonical
   rebuild re-seeds `players.id` (ISSUE-108 §9.4).
4. **ISSUE-111 G6** — the retirement policy for the existing legacy `draftguru` Coleman rows.
5. **ISSUE-112 G0** — per-family read-only coverage measurement. **DONE 2026-09-01 (Pass 5):**
   executed read-only against `afldb_dev` via the streamanator dev server, connection proven,
   transaction rolled back. **All nine families PASS** (`AFLDB-ISSUE-112.md` §14.4, §14.6).
   No longer blocking.
6. **ISSUE-112 §11.1** — where the one-time manifest extraction comes from. **DECIDED 2026-09-01:**
   the existing legacy-loaded AFLDB PostgreSQL state, not a fresh scrape. **Follow-on choice still
   open: `source_citation` granularity** — G0-confirmed there is no per-row page citation in any
   of the five link-target tables; recoverable only at source granularity
   (`draftguru`/`wikipedia`/`footywire`). Operator picks: accept source-granularity / read
   `source_url` from the legacy SQLite file / reconstruct from `docs/acquisition/`. No scrape
   proposed. (`AFLDB-ISSUE-112.md` §14.5 item 1.)
7. **ISSUE-112 §11.4** — whether `hall_of_fame` and `honour_team_members` stay on name-based
   natural reload keys. **G0-measured 2026-09-01: data-safe** (zero collisions on every relevant
   key). Residual is only the operator's acknowledgement that a curated rename of a decided row
   stays link-losing (`AFLDB-ISSUE-112.md` §14.5 item 2).
8. **ISSUE-113 §4** — the replacement source class. Recommended next step (not a decision): a
   read-only probe of class B, a free structured season-summary source carrying `vote_rank`,
   `eligible_rank` and `is_ineligible`. **No probe performed; it needs separate authorisation.**

---

## Implementation status

**NO implementation code has been authorised or started during this pass.**

No loader, parser, manifest, migration, privilege change or schema change was written. No source
was acquired, scraped or fetched. No database was read or written. No test was run. No Git command
was run. No production or `afldb_dev` action. No issue was resolved. No existing test was changed
or skipped. ISSUE-110 was not touched.

The only repository changes are the seven documentation/ledger files listed under **Completed this
pass**.

---

## Next recommended task

**Implement `AFLDB-ISSUE-111` (Coleman derivation) first** — but only after gate G0.

Why 111 first:
- Lowest risk and highest confidence. It needs **no external source and no new data at all** —
  every fact already lives in `player_match_stats` and `matches`.
- Smallest blast radius: one award, one target table, one new group.
- It proves the derivation-provenance pattern that later work can reuse.
- Its design is complete and its semantics are proven from source, apart from the single measured
  boundary.
- ISSUE-112 is blocked on an unauthorised extraction decision; ISSUE-113 is blocked on an
  unselected source. Neither can start.

**The exact next action is not code.** It is the G0 measurement:

> Run `issues/open/AFLDB-ISSUE-111.md` §3.1's read-only SQL against a database that still holds
> the legacy-loaded awards (`afldb_dev`, or `afldb_test` **before** its canonical rebuild), record
> the measured span as a tracked declaration, and apply the pre-committed decision rule. The
> operator runs the SQL — Claude does not execute database commands by default.

If the measurement shows a minimum earlier than 1955, **stop and report** rather than deriving:
that would mean the legacy data asserts pre-medal leading-goalkicker rows as Coleman winners,
which is a semantic defect to adjudicate first.

---

## Required validation for the next pass

Nothing below has been run. All of it is outstanding.

**Gate G0 (read-only, must be first):**
```sql
SELECT a.slug, a.first_season, a.last_season, count(w.id) AS winner_rows,
       min(w.season) AS min_winner_season, max(w.season) AS max_winner_season,
       count(*) FILTER (WHERE w.player_id IS NULL) AS unlinked
  FROM awards a
  LEFT JOIN award_winners w ON w.award_id = a.id
 WHERE a.slug = 'coleman'
 GROUP BY a.slug, a.first_season, a.last_season;

SELECT w.season, count(*) AS rows_in_season
  FROM award_winners w JOIN awards a ON a.id = w.award_id
 WHERE a.slug = 'coleman'
 GROUP BY w.season ORDER BY w.season;
```

**Gate G1 (read-only) — NULL-vs-zero invariant inside the derived span:**
```sql
SELECT count(*) AS null_goals_rows
  FROM player_match_stats pms
  JOIN matches m ON m.id = pms.match_id
 WHERE NOT m.is_final AND pms.goals IS NULL;
```

**Tests to run once implementation begins** (none have been run):
- `npm test -- tests/integration/awards-reload-links.test.ts` — needs
  `AFLDB_TEST_DATABASE_URL` and, for role parity, `AFLDB_TEST_IMPORT_DATABASE_URL`.
- `npm test -- tests/db-test-rebuild.test.ts` — DB-free.
- `npm test -- tests/integration/privileges.test.ts` — must stay green with no grant widened.
- `npm test -- tests/awards-admin.test.ts`, `tests/under-22-importer.test.ts`,
  `tests/under-22-source.test.ts`.
- `npm run db:test:rebuild -- --acknowledge-destroy afldb_test` — **destructive to `afldb_test`
  only**, and only once a Coleman stage exists.

Boundaries: integration tests use `AFLDB_TEST_DATABASE_URL` and the target must end in `_test`.
Note `vitest.config.mts` sets `fileParallelism: false` (ISSUE-108), so `--no-file-parallelism` is
redundant.

---

## Source files to re-read on resume

Do not trust this summary for implementation detail; re-read these.

| File | Why |
|---|---|
| `issues/open/AFLDB-ISSUE-102.md` | parent scope, closure criteria |
| `issues/open/AFLDB-ISSUE-111.md` | the design to implement first; §3.1 is the blocking gate |
| `issues/open/AFLDB-ISSUE-112.md` | manifest architecture; §11 operator prerequisites |
| `issues/open/AFLDB-ISSUE-113.md` | Brownlow coverage proof; §4 undecided source |
| `tools/migration/common.py:410-703` | `reload_keyed` — the contract everything depends on |
| `tools/migration/import_awards.py` | groups (`:1320-1328`), `main()` (`:1379-1557`), the `under_22` precedent (`:1457-1520`) |
| `tools/migration/under_22.py` | the manifest parser template |
| `tools/records/import-first-kick-goal.ts` | `--assign-ids` / `--accept-rename` / `--accept-retirement` / `data_issues` patterns |
| `tools/migration/rebuild_derived.py` | `PLAYER_GAME_CONTEXT`, `REBUILDS["player_season_stats"]`, `REBUILDS["player_career_stats"]` |
| `tools/db/rebuild-test.ts` | stage list and Stage-9 gate construction |
| `tests/integration/awards-reload-links.test.ts` | guards at `:59,76-79`; the fixture precedent at `:1248` |
| `src/db/migrations/005_brownlow_awards.sql` | awards/honours schema |
| `data/reference/stat-availability.json` | coverage ranges — the basis of every derivability claim |

---

## Prohibited actions

Carried forward and still binding:

- **No Git commands of any kind.** No commit, checkout, reset, stash, clean, rebase, merge, or
  history modification. **The operator owns Git.**
- No production commands, production database access, or deployment.
- **No database mutation of any kind.** The G0/G1 measurements are read-only.
- No implementation loader code until the gating decisions are made.
- No web scraping, external data acquisition, or speculative source selection.
- Do not access or modify `D:\dev\afldb`. Work only in `D:\dev\afldb-issue-102`.
- Do not touch ISSUE-110 implementation or invent its ledger content.
- Do not change existing migration files (several are applied and checksum-frozen — 073, 076, 077).
- Do not broaden database privileges.
- **Do not mark ISSUE-102 Resolved.**
- Preserve unrelated local modifications.

---

## Git state

**Claude ran no Git command in this pass and holds no knowledge of the working tree's Git status
beyond the stated baseline `95819a3`.** The operator owns all Git operations: status, diff,
staging, commit, push, branch and merge. Seven files were modified or created (see **Completed
this pass**); the operator should review and commit them.

## Production

**No production operation is authorised.** No production database, deployment, migration or
service action was performed or is permitted under ISSUE-102 or any of its children as currently
scoped. The `afldb_dev` database may be read **read-only** for the G0/G1 measurements, and even
that is the operator's action to run.
