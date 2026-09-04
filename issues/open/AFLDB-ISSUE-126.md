# AFLDB-ISSUE-126 — Production-only state from the 2026-09-02 cutover, held only in `afldb_prod_auth_recovery`

- **Status:** Open — operator approved T1/T2/T5/T6 (T4 retired) 2026-09-04; **T0 green, rehearsals green, PAUSED before any DML** on a rehearsal side effect (§7.5); no production row written
- **Severity:** Medium
- **Area:** Database / Admin / Security / Audit trail / Operations
- **Branch:** `claude/issue-126` (worktree `D:\dev\afldb-issue-126`)
- **Session:** Fable 5.1 / High, 2026-09-04 (stages 1–3); Fable 5.1 / xhigh, 2026-09-04 evening (execution)
- **Related:** `AFLDB-ISSUE-122` §S8 (the cutover), `AFLDB-ISSUE-125` (the promotion procedure and
  the production-only table contract in `tools/db/promotion-inventory.ts`), `AFLDB-ISSUE-137`
  (untouched; its own close-out also lists the recovery database)
- **Scripts (this branch):** `issues/open/AFLDB-ISSUE-126-export.sh` (read-only export from the
  recovery database), `-t1-audit.sql`, `-t2-content.sql`, `-t4-join-request.sql`, `-t5-aflw.sh`,
  `-t6-marker.sql` (each commit-gated; see §6)

> **Boundary.** No production write has been made. Every command in §3 ran under
> `default_transaction_read_only=on` from `/home/arm/projects/afldb/.env`'s owner DSN with the
> database name swapped. Nothing here prints a DSN, a code, a hash, a secret or a session token.
> `afldb_prod_auth_recovery` **must not be dropped** while this issue is open (§9).

---

## 1. Problem

The 2026-09-02 cutover (`AFLDB-ISSUE-122` §S8) recreated `afldb_prod` from the rebuilt
`afldb_test` dump. Football data was replaced correctly; so was every table that only ever existed
on production. The real super admin was recovered the same night; everything else production-only
was left in `afldb_prod_auth_recovery` (a full restore of the pre-cutover dump
`/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump`) for a deliberate per-table decision.
This runbook is that decision.

## 2. Stage 1 — schema findings (repository)

| Table | PK / identity | FKs out | Unique | Secret columns | Write path (app) | Grants (`afldb_auth`) | Behaviour when empty |
|---|---|---|---|---|---|---|---|
| `site_settings` (034) | `key text` PK, no sequence | `updated_by → auth_users(id)` (nullable) | PK only | none by design — public-readable by `afldb_app` | `/admin/settings` and `/admin/content` upsert **every** key of their form on each save (`ON CONFLICT (key) DO UPDATE`), binding `${JSON.stringify(v)}::jsonb` — so every stored value is a **jsonb string scalar** holding JSON text, which `fromStore()` in `src/lib/site-settings.ts` decodes | SELECT, INSERT, UPDATE | `parseSiteSettings()` returns the compiled defaults; nothing throws |
| `beta_access_codes` (023/036) | `id integer GENERATED ALWAYS`, seq `beta_access_codes_id_seq` | `created_by → auth_users(id)` | `code_hash` UNIQUE | `code_hash` (sha256 of the code; clear text shown once at creation and never stored) | `/admin/access` INSERT; `/beta` redeem `UPDATE … use_count+1 WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR use_count < max_uses)` | SELECT, INSERT, UPDATE | code entry is refused with the generic message |
| `auth_audit_log` (023/082) | `id bigint GENERATED ALWAYS`, seq `auth_audit_log_id_seq` | `actor_user_id → auth_users(id)` (nullable, no cascade) | PK only | none (`ip inet`, `detail jsonb` of named event fields) | one writer, `insertAuditRow()` in `src/lib/auth/session.ts`, binding `detail` with `sql.json()`; **append-only by grant** | SELECT, INSERT (no UPDATE/DELETE) | admin dashboard shows fewer rows (`ORDER BY at DESC LIMIT 15`) |
| `auth_sessions` (023) | `id bigint GENERATED ALWAYS` | `user_id → auth_users(id) ON DELETE CASCADE` | `token_hash` UNIQUE | `token_hash` | login INSERT / logout revoke | SELECT, INSERT, UPDATE | everyone signs in again |

Constraints that bind a restore: `auth_audit_log_detail_is_object_ck` (082: `detail IS NULL OR
jsonb_typeof(detail) = 'object'`); identity columns are `GENERATED ALWAYS`, so original ids need
`OVERRIDING SYSTEM VALUE` and a `setval` afterwards; every FK into `auth_users` must resolve to the
same identity in production (it does — §3.4).

**ISSUE-125's contract** (`tools/db/promotion-inventory.ts`) names 23 production-only public
tables plus `staging_aflw.*`. All of them were measured in §3, not just the three the issue named.

## 3. Stage 2 — PROD read-only evidence (2026-09-04 19:42–19:48 AEST)

### 3.1 Host and application

| Check | Value |
|---|---|
| `hostname` | `afldb-prod` |
| Checkout | `main` @ `169d738` (2026-09-04 11:11 +1000, "Merge ISSUE-113 tracked Brownlow season artefact"); untracked settle manifests only |
| `.next/BUILD_ID` | `MRjsomoqFJRsjZWElQ6A0` |
| `/api/health` (port 3100) | `{"status":"ok","database":"ok","latencyMs":1}` |
| `afldb`, `afldb-settle-afltables.timer` | active, active |
| Databases | `afldb_prod`, `afldb_prod_auth_recovery`, `afldb_restore_test` |
| Migrations | prod `085_matches_is_finals_series.sql` (2026-09-03 19:00); recovery `083_canonical_auto_apply.sql` (2026-09-02 19:57 — i.e. the pre-cutover database had 082's jsonb repair and CHECK applied before the dump) |
| Newest backups | `afldb_prod-20260904-115413.dump` (Sep 4 11:54, ISSUE-137's), `afldb_prod-20260903-185612.dump`; pre-cutover dump present at `/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump` (18,865,740 bytes) |

### 3.2 Row counts, production-only tables (ISSUE-125 contract)

| Table | RECOVERY | PROD now | Note |
|---|---|---|---|
| `auth_users` | 1 | 2 | prod id 1 = the same super admin (same email, same `created_at` 2026-08-16 13:00:47.926753+10, password + TOTP enrolled); prod id 2 = an `admin` created 2026-09-04 12:59 (ISSUE-137 browser stage) |
| `admin_invites` | 0 | 1 | nothing to restore |
| `auth_sessions` | 17 | 7 | §3.6 |
| `auth_audit_log` | **92** | **11** | §3.5 |
| `beta_access_codes` | **1** | **1** | §3.4 |
| `beta_allowed_emails` / `beta_login_tokens` | 0 / 0 | 0 / 0 | nothing |
| `beta_join_requests` | **1** | 0 | §3.8 |
| `site_settings` | **11** | **0** | §3.3 |
| `site_media` | **1** | 0 | §3.7 |
| `data_edits` | **2** | 0 | §3.9 |
| `data_overrides` / `data_submissions` / `_rows` / `promotion_decisions` | 0 | 0 | nothing |
| `player_link_suggestions` / `player_link_resolutions` | **2 / 6** | 0 / 0 | §3.10 |
| `player_link_match_candidates` | 2944 | 0 | regenerate, never restore (contract) |
| `nl_search_log` / `nl_search_feedback` / `app_health_events` | **88 / 1 / 2** | 4 / 0 / 4 | §3.11 |
| `staging_aflw.*` (8 tables) | **51,018** | **0** | §3.12 — the public AFLW read model on production is empty |

Sequences (PROD → RECOVERY): `auth_audit_log_id_seq` 26 → 181; `auth_sessions_id_seq` 7 → 37;
`auth_users_id_seq` 2 → 1; `beta_access_codes_id_seq` 1 → 4.

### 3.3 `site_settings` — classification against `src/lib/site-settings.ts` defaults

All 11 recovery rows are jsonb **string** scalars (the writer's double encoding; the reader absorbs
it). `updated_by` = 1 on every row. Six keys the current build knows
(`search.placeholders_*`, `search.placeholder_*`, `site.page_intros`, `site.frontend_theme`) were
added after the last save (2026-08-19) and were never stored — nothing to restore for them.

| Key | Recovery value (summary) | Differs from compiled default? | PROD has row? | Proposed action |
|---|---|---|---|---|
| `apex.content` | 5,842-char content document (keys `hero, meta, pair, notes, header, features, sections, wideShot`; hero heading "Every player. Every game. Since 1897 - Present."), saved 2026-08-16 21:57 | operator-authored; it is the document the live `afldb.com` page was published from (§3.7) | no | **restore** (T2, with `site_media`) |
| `early_access.intro` | "AFLDB is in closed beta. Leave your email and we will be in touch as places open up." | **yes** (default has "…while the record is verified…") | no | **restore** (T2) |
| `early_access.notify` | `true` | **yes** (default `false`) — re-enables the email to the notify address on each new join request; production SMTP is the Brevo relay already in use | no | **restore** (T2) |
| `early_access.notify_to` | `requests@afldb.com` | no (equals default) | no | retire — default already in force |
| `early_access.open` | `false` | no | no | retire — default already in force |
| `early_access.questions` | 14 questions (`interest, nuffie, club, search-discover, useful, testing-appetite, will-report, will-feedback, devices, anything-else, data-interests, csv-contribute, keep-accurate, skills`) | **yes** (default is the single `interest` question) | no | **restore** (T2) |
| `grid_solver.audience` | `super_admin` | no | no | retire — default already in force |
| `home.aflw_leaders` | `games` | **yes** (default `goals`) | no | **restore** (T2) |
| `home.record_of_the_week` | `most-brownlow-votes` | **yes** (default `most-goals`) | no | **restore** (T2) |
| `home.sections` | `{order:[stats,vault,record,browse],hidden:[]}` | no | no | retire — default already in force |
| `site.footer` | 2 lines + `admin@afldb.com` + "About this data →", saved 2026-08-16 21:57 | **yes** (compiled default has a third line, "Statistics not collected … never as zero"); the live published apex footer was rendered from this value | no | **restore** (T2) |

Seven rows restored verbatim (same double-encoded shape the running writer produces, original
`updated_at`/`updated_by`), four retired because production already behaves identically. Exact
`md5(value::text)` of each restored row is asserted by T2 before insert.

### 3.4 `beta_access_codes`

| | id | label | max_uses | use_count | created | expires | revoked | redeemable now |
|---|---|---|---|---|---|---|---|---|
| RECOVERY | 4 | `screenGrabs` | 1 | 1 | 2026-08-16 14:33 | 2026-11-14 | — | **no** (spent: `use_count = max_uses`) |
| PROD | 1 | `me` | unlimited | 0 | 2026-09-04 12:51 | 2026-12-03 | — | yes |

Production already has a live code the operator cut on 2026-09-04. The recovered code was
single-use and was consumed on 2026-08-16 14:37 (its `access.code_created` and
`beta.code_redeemed` events are among the 92 audit rows). Restoring it would re-enable nothing and
would only add a spent row under a colliding-looking id. **Decision: do not restore; the old
credential is intentionally retired.** No current operational need exists.

### 3.5 `auth_audit_log`

| | rows | id range | `at` range (AEST) | actors | NULL actor | `detail` types |
|---|---|---|---|---|---|---|
| RECOVERY | 92 | **90–181** | 2026-08-16 13:28:19 → 2026-09-02 10:16:18 | `actor_user_id` 1 only (72 rows) | 20 | 73 object, 19 NULL — satisfies the 082 CHECK |
| PROD | 11 | **16–26** | 2026-09-03 06:23:06 → 2026-09-04 13:13:42 | 1 (7 rows), 2 (3 rows) | 1 | (all valid) |

Recovery actions: `admin.login` 17, `admin.login_failed` 14, `settings.saved` 17, `content.saved`
11, `content.published` 10, `settings.test_email` 5, `beta.join_requested` 3, `player_link.*` 7,
`data_edit.saved` 2, `beta.code_*` 3, `access.code_created` 1, `content.media_uploaded` 1,
`nl_search.exported` 1. Zero out-of-order `(id, at)` pairs within the recovery set. Actor labels
are the super admin's address, `screenGrabs`, `anonymous`, and two other addresses on
`beta.join_requested` / `admin.login_failed` rows (actor NULL; not reproduced here).

Merge analysis:

- **Ids do not collide** (90–181 vs 16–26) and **timestamps do not overlap** (recovery max
  2026-09-02 10:16 < production min 2026-09-03 06:23), so ordering by `at` — which is how the
  application reads the log — is unambiguous and monotonic across both sets.
- **Actor references resolve to the same identity**: every non-NULL `actor_user_id` is 1, and
  production's `auth_users` id 1 is the same person with the same `created_at`.
- The only discontinuity is that ids 16–26 (written 2026-09-03/04) are numerically lower than ids
  90–181 (written in August). Ids 1–89 were already absent in the pre-cutover source, and ids
  1–15 are absent in production (they belonged to the rebuilt database's fixture rows). Restoring
  with the **original ids** keeps the rows byte-identical to the source and keeps the gaps
  visible; the sequence is advanced to 181 so future rows continue from 182, and a marker row
  (§3.13) states all of this in the log itself.

**Decision: restore the 92 rows with their original ids plus an explicit `database.recovered`
marker row.** The history does not pretend to be continuous: the marker names the cutover, the
restored range, the post-cutover range written before the recovery, and the gaps.

### 3.6 `auth_sessions`

Recovery: 17 rows, one user, created 2026-08-16 → 2026-09-02 10:16, **latest `expires_at`
2026-09-02 22:16 — zero unexpired**, none revoked. Production: 7 rows of its own since the cutover,
2 live. **Decision: not restored** (stale by inspection, and the architecture never wants a session
to survive a database identity change).

### 3.7 `site_media` and the published apex page

Recovery holds one row: `screenshot-2026-08-16-175814.png` (`image/png`, 81,118 bytes, 1903×909,
uploaded 2026-08-16 17:59 by user 1), and it is referenced by the recovered `apex.content`.
On disk, `/var/www/afldb-soon/` (AFLDB_APEX_DIR) still carries the page published 2026-08-16
21:57 with that image under `img/u/` and the recovered hero heading in `index.html` — so the live
`afldb.com` holding page is unaffected today. But the database no longer holds the source document:
the next save from `/admin/content` would start from `DEFAULT_APEX_CONTENT`, and `publishApex()`
prunes any upload not in `site_media`, so the live page would be overwritten with defaults and lose
the image. **Decision: restore the media row together with `apex.content`, `site.footer` (T2).**

### 3.8 `beta_join_requests`

One `pending` request, 2026-08-16 20:32, `st***@gmail.com`, with a name and an `answers` document
of one key (`interest`); never reviewed. Production: 0 rows, sequence untouched (`last_value 1,
is_called f`). Reader-supplied and unreconstructible; the contract treats it as reinstate; one row,
no FK issues. **Decision: restore (T4) — operator may prefer to retire it (the address looks like it
may be the operator's own); either is acceptable, say which.**

### 3.9 `data_edits` — two human corrections that the rebuild lost

| id | table | row_id | field_group | old → new | note | at |
|---|---|---|---|---|---|---|
| 1 | players | 4375 | `dob` | `NULL/unknown` → `1873-11-21 / sourced` | `https://www.footyinfo.com/player/kelly-robinson` | 2026-08-19 18:10:33 |
| 2 | players | 4375 | `birth_year` | `1899 [1897–1901] estimated` → same values, `sourced` | same | 2026-08-19 18:10:41 |

In the recovery database id 4375 is **Kelly Robinson** (57 games, 1897–1901, `dob 1873-11-21
sourced`). In production **id 4375 is Frank Hince**; Kelly Robinson is **id 8065** (same 57 games,
1897–1901) with `dob NULL / unknown` and `birth_year NULL`. `data_overrides` was empty before the
cutover (migration 073 post-dates these edits), so nothing replayed them.

**Decision: do not insert the two audit rows** — their `row_id` would name the wrong person in
production, which is exactly the deceptive history this issue forbids. The corrections themselves
are **re-applied by the operator through `/admin/data-editor` on production player 8065**, which
writes fresh `data_edits`, `data_overrides` (so future rebuilds replay them) and an audit row.
The original edit content above is the source. Note the pre-existing oddity for the operator to
judge while re-applying: a `dob` of 1873 alongside a `birth_year` estimate of 1899.

### 3.10 `player_link_resolutions` (6) and `player_link_suggestions` (2)

All six decisions target `honour_team_members` ids 232/244/269/275/325/334 and three name players
2268/2521/2113. In production **none of those honour ids exist** (the rows were rebuilt with ids
6/18/43/49/99/108) and **the three player ids now denote different people** (Brian Henderson,
Campbell Heath, Brandon Starcevich). Restoring verbatim would record false decisions.
**Decision: retire (recorded gap).** Current production state of the same honours rows, for the
operator to redo through `/admin/player-links` if wanted:

| Team | Name | Recovery decision (2026-08-19) | Production now |
|---|---|---|---|
| AFL/VFL Team of the Century | Ted Whitten | linked → Whitten | already `resolved` → id 12314 (tracked manifest) |
| AFL/VFL Team of the Century | Ron Barassi | linked → Barassi (note: Wikipedia URL) | `ambiguous`, unlinked; Barassi is id 11247 (`players/R/Ron_Barassi0.html`) |
| Indigenous Team of the Century | Maurice Rioli | linked → Rioli Snr | `ambiguous`, unlinked; Rioli Snr is id 9336 (`players/M/Maurice_Rioli0.html`) |
| Indigenous Team of the Century | Bill Dempsey | confirmed unlinked (suggestion: "not a afl/vfl player") | `unmatched` |
| Queensland Team of the 20th Century | Barry Clarke | confirmed unlinked | `unmatched` |
| Queensland Team of the 20th Century | Alex McGill | confirmed unlinked | `unmatched` |

`player_link_match_candidates` (2,944) is regenerated from `/admin/player-links`, never restored.

### 3.11 Telemetry (`nl_search_log` 88, `nl_search_feedback` 1, `app_health_events` 2)

Recovery ids `nl_search_log` 1–95 and `app_health_events` 1–2 **collide** with production's
post-cutover rows (27–30 and 5–8). Restoring would need re-keying and remapping
`parent_search_id` / `related_search_id`, for pre-cutover telemetry of an older parser version.
**Decision: retire (recorded gap).**

### 3.12 `staging_aflw.*` — the AFLW section of production is empty

| Table | RECOVERY | PROD |
|---|---|---|
| `seasons` | 11 (2017–2026, incl. `7` = 2022 Season 7) | 0 |
| `fixtures` | 818 | 0 |
| `matches` | 710 | 0 |
| `ladders` | 144 | 0 |
| `player_seasons` | 3,972 | 0 |
| `player_match_stats` | 29,878 | 0 |
| `scoring_events` | 15,483 | 0 |
| `issues` | 2 | 0 |

`aflw.seasons` / `aflw.matches` / `aflw.players` on production all read **0**; the `aflw` views
exist (no materialized views), `afldb_app` holds SELECT on every `staging_aflw` table and USAGE on
`aflw`. The rebuild never produces this schema (ISSUE-125 §1) and the cutover did not reinstate
it. FKs are internal to the schema (season_key / match_key); the only sequence is
`staging_aflw.issues_id_seq` (never called on prod). The pre-cutover dump carries `TABLE DATA` for
all eight tables. **Decision: restore all eight tables from the pre-cutover dump, per table in
FK order, each `--single-transaction` (T5).** This is the largest item and is a public-facing
repair, so it is approved separately.

### 3.13 The marker row

Written last (T6) so that its detail reflects what was actually approved and executed: it counts
the restored audit rows, lists the restored setting keys, media, join request and AFLW rows from the
live state at that moment, and names every retired item (§3.4, §3.6, §3.9–§3.11) and the id-range
facts of §3.5. `actor_user_id` NULL, `actor_label` `operator: cutover recovery (AFLDB-ISSUE-126)`,
`action` `database.recovered` — the same shape as ISSUE-125's `database.promoted` marker.

## 4. Decisions (summary)

| State | Decision | Mechanism |
|---|---|---|
| `site_settings` 11 rows | **7 restored** (operator overrides + the apex/footer documents), **4 retired** (equal to defaults) | T2 |
| `site_media` 1 row | restore (coupled to `apex.content`) | T2 |
| `beta_access_codes` 1 row | **retire** — spent single-use code; production already has a live code | none (recorded) |
| `auth_audit_log` 92 rows | **restore with original ids 90–181 + marker** | T1 + T6 |
| `auth_sessions` 17 rows | **not restored** — all expired | none (recorded) |
| `beta_join_requests` 1 row | restore (operator may retire instead) | T4 |
| `data_edits` 2 rows | audit rows **not restored**; corrections re-applied via the data editor on player 8065 | operator, UI |
| `player_link_resolutions` 6 / `_suggestions` 2 | **retire**; redo via `/admin/player-links` if wanted | operator, UI |
| `player_link_match_candidates` | regenerate via `/admin/player-links` refresh | operator, UI |
| `nl_search_log` 88 / feedback 1 / health 2 | **retire** (id collisions) | none (recorded) |
| `staging_aflw.*` 51,018 rows | **restore** from the pre-cutover dump | T5 |
| `afldb_prod_auth_recovery` | **retain** until this issue is closed; drop is a separate destructive approval | §9 |

## 5. Stage 3 — exact DML plan

All transactions run on **`afldb-prod`**, as `afldb_owner` (the owner DSN from the host `.env`
with the database name forced to `afldb_prod`; `afldb_auth` could not `setval` or insert
identity values). `PGOPTIONS` must be **unset** for the DML sessions. Every script refuses unless
`current_database() = 'afldb_prod'`, the session is read-write, and `afldb_prod_auth_recovery`
still exists; every script re-asserts the §3 counts before writing and the expected counts after;
every script **rolls back unless invoked with `-v commit=1`**, so each can be rehearsed first.
The scripts are not on the production checkout (it tracks `main`); ship them by `scp` and strip
the Windows CR before running (`sed -i 's/\r$//' /home/arm/i126_*.{sh,sql}`), the same transport
as every probe in §3.

### T0 — preconditions (operator, before any DML)

```bash
# PROD: afldb-prod
hostname
cd ~/projects/afldb && git log -1 --oneline && curl -s http://127.0.0.1:3100/api/health; echo
bash tools/maintenance/backup.sh --keep 14
PRE=$(ls -1t ~/backups/afldb/afldb_prod-*.dump | head -1); echo "$PRE"; sha256sum "$PRE"
pg_restore --list "$PRE" | grep -c '^[0-9]'
bash tools/maintenance/restore-test.sh "$PRE"          # restore-proven into afldb_restore_test
# then copy $PRE + its sha256 off-host (D:\backups\afldb\), and re-run the read-only preflight
```

Then export the source rows from the recovery database (read-only; files mode 600 under
`/home/arm/i126/`, deleted at close-out):

```bash
bash issues/open/AFLDB-ISSUE-126-export.sh
```

Expected: `audit.csv` 93 lines (header + 92), `settings.csv` 8 lines (header + 7; multi-line
values may raise the line count — the row-count assertion is in T2, not here), `media.csv`,
`join.csv`.

### T1 — `auth_audit_log`: 92 rows, original ids (`AFLDB-ISSUE-126-t1-audit.sql`)

| | |
|---|---|
| Preconditions asserted | staged: 92 rows, ids 90–181, `at` 2026-08-16 13:28:19.054484 → 2026-09-02 10:16:18.319137 (+10), every `actor_user_id` NULL or 1, every non-NULL `detail` an object. Production: 11 rows, ids 16–26, min `at` > staged max `at`, no id in 90–181, sequence at 26, `auth_users` id 1 is the super admin with `created_at` 2026-08-16 13:00:47.926753+10 |
| Writes | `INSERT … OVERRIDING SYSTEM VALUE` of the 92 rows; `setval(auth_audit_log_id_seq, 181, true)` |
| Post-assertions | 103 rows; exactly 92 with id in 90–181; max id 181; ids 16–26 untouched |
| Rollback | `DELETE FROM auth_audit_log WHERE id BETWEEN 90 AND 181; SELECT setval(…, 26, true)` as owner — itself recorded in this runbook; or restore the T0 backup |

### T2 — content and settings (`AFLDB-ISSUE-126-t2-content.sql`)

| | |
|---|---|
| Preconditions asserted | production `site_settings` **0 rows** and `site_media` **0 rows** (any row = refuse: someone saved settings since §3); staged 7 settings rows with exactly the §3.3 keys and `md5(value::text)` values; staged media row `screenshot-2026-08-16-175814.png`, `byte_size 81118 = length(bytes)`; `auth_users` id 1 exists |
| Writes | 7 `site_settings` rows verbatim (`key, value, updated_at, updated_by`); 1 `site_media` row verbatim |
| Post-assertions | `site_settings` = 7, `site_media` = 1 |
| Effect | immediate on the public home page (record of the week → Brownlow votes, AFLW leaders → games), the early-access form (14 questions, notify on) and the admin content editor; ISR-cached pages refresh on their own schedule |
| Rollback | `DELETE FROM site_settings WHERE key IN (…7 keys…); DELETE FROM site_media WHERE name = 'screenshot-2026-08-16-175814.png'` |

### T3 — `beta_access_codes` and `auth_sessions`: no DML

Recorded decisions (§3.4, §3.6). Post-check only: production still holds exactly one code
(`me`, `use_count 0`, not the recovered label) and no session created before 2026-09-03.

### T4 — `beta_join_requests`: 1 row (`AFLDB-ISSUE-126-t4-join-request.sql`) — optional

| | |
|---|---|
| Preconditions asserted | production 0 rows, sequence `last_value 1 / is_called false`; staged 1 row, id 1, status `pending`, requested 2026-08-16 20:32:13.27126+10, `reviewed_by` NULL |
| Writes | `INSERT … OVERRIDING SYSTEM VALUE`; `setval(…, 1, true)` |
| Post-assertions | 1 row |
| Rollback | `DELETE FROM beta_join_requests WHERE id = 1; SELECT setval(…, 1, false)` |

### T5 — `staging_aflw.*`: 51,018 rows (`AFLDB-ISSUE-126-t5-aflw.sh`)

| | |
|---|---|
| Source | `/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump` (the file `afldb_prod_auth_recovery` was restored from; counts cross-checked against that database) |
| Preconditions asserted | all eight production tables empty; dump lists `TABLE DATA` for all eight |
| Writes | eight `pg_restore --data-only --no-owner --no-privileges --single-transaction --exit-on-error --schema=staging_aflw --table=<t>` in FK order `seasons, fixtures, matches, ladders, player_seasons, player_match_stats, scoring_events, issues`; then `setval(staging_aflw.issues_id_seq, max(id), true)` |
| Post-assertions | counts 11 / 818 / 710 / 144 / 3,972 / 29,878 / 15,483 / 2; `aflw.seasons` = 11, `aflw.matches` = 710 |
| Failure mode | a failing table leaves earlier tables committed and that table empty; the script stops and names it |
| Rollback | `TRUNCATE staging_aflw.seasons, fixtures, matches, ladders, player_seasons, player_match_stats, scoring_events, issues` (returns to the post-cutover state) |
| Grants | none needed — `afldb_app` already holds SELECT on the schema; `privileges.sql` unchanged |

### T6 — marker (`AFLDB-ISSUE-126-t6-marker.sql`) — last

| | |
|---|---|
| Preconditions asserted | no `database.recovered` row exists |
| Writes | one `auth_audit_log` row (§3.13), detail computed from live counts |
| Post-assertions | exactly one marker; it is the max id |
| Rollback | `DELETE FROM auth_audit_log WHERE action = 'database.recovered'` |

### Post-commit verification (all)

1. `hostname`; `/api/health` ok.
2. Counts: `auth_audit_log` 104 (92 + 11 + marker) if T1+T6; `site_settings` 7; `site_media` 1;
   `beta_access_codes` 1 (`me`); `beta_join_requests` 1 if T4; `auth_sessions`: none with
   `created_at < '2026-09-03'`; `staging_aflw` per §3.12; `afldb_prod_auth_recovery` still present.
3. Audit chronology: `SELECT id, at, action FROM auth_audit_log ORDER BY at` is monotonic; the
   marker is last by `at` and by id.
4. Operator, browser: sign in as the super admin (writes a fresh `admin.login` row after the
   marker); `/admin/settings` shows Brownlow votes / games / 14 questions / notify on;
   `/admin/content` shows the apex document with its image; `/admin/access` shows only `me`; the
   home page and `/aflw` render the restored choices and AFLW seasons.
5. Then the UI follow-through of §3.9 and §3.10 at the operator's discretion.

## 6. Operator approval boundary — **STOP HERE**

Nothing below this line has been executed. Approve any subset of:

- **T1** audit rows (92, original ids) — recommended
- **T2** content + settings (7 + 1 rows) — recommended
- **T4** join request (1 row) — optional; say "retire" to skip and record the gap instead
- **T5** AFLW staging data (51,018 rows) — recommended; largest change, public-facing
- **T6** marker — recommended whenever T1 runs; still useful (as a gap record) if T1 is refused

T3 needs no approval (no DML). Every approved script is rehearsed once without `-v commit=1`
(rolls back), then run with it, in the order T0 → T1 → T2 → T4 → T5 → T6.

## 7. Execution evidence

### 7.1 Operator approval (2026-09-04, verbatim decisions)

**T1 approved** (92 audit rows, original ids). **T2 approved** (7 operator-override settings + the
`site_media` row). **T4 retired** — the historical `beta_join_requests` row is not restored.
**T5 approved** (all eight `staging_aflw` tables, FK order). **T6 approved** (marker, last).
Explicitly retired: the spent recovery `beta_access_codes` row, the expired recovery
`auth_sessions`, the stale `data_edits`, the stale player-link decisions, and the telemetry with
unsafe id collisions. The Kelly Robinson DOB correction and any player-link decisions are redone
through the admin UI. Order: T0 → rehearse every approved script without `-v commit=1` → stop on
any unexpected count, changed production state, FK mismatch, id collision, schema drift,
restore-test failure or assertion failure → only then commit one unit at a time → verify → close.
`afldb_prod_auth_recovery` stays until close-out is committed and reviewed.

Because T4 is retired, `AFLDB-ISSUE-126-t6-marker.sql` was amended before shipping so the marker's
`retired` object also names `beta_join_requests` (one line added; nothing else changed).

### 7.2 Transport

Scripts shipped by `scp` to `/home/arm/i126_{export,t0,run,t5}.sh` and
`/home/arm/i126_{t1,t2,t6,verify}.sql` (LF, no BOM; sha256 of every file identical on both sides).
`i126_t0.sh` is the T0 runner (identity → backup → checksum → restore-test → read-only preflight of
every §3 count on PROD and RECOVERY → export); `i126_run.sh <unit> [commit]` runs one unit and tees
to `/home/arm/i126/<unit>-<mode>-<stamp>.log`; `i126_verify.sql` is the read-only §5 post-check.
Session: Fable 5.1 / xhigh, operator-authorised execution over the `afldb` SSH alias.

### 7.3 T0 — preconditions (2026-09-04 20:10:37 → 20:10:56 AEST) — **GREEN**

| Check | Result |
|---|---|
| `hostname` | `afldb-prod` |
| Checkout / build / service | `169d738`; `.next/BUILD_ID` `MRjsomoqFJRsjZWElQ6A0`; `afldb` active, settle timer active; `/api/health` `{"status":"ok","database":"ok","latencyMs":1}` |
| `current_database()` | `afldb_prod` (T0 session forced read-only: `default_transaction_read_only = on`) |
| Databases | `afldb_prod`, `afldb_prod_auth_recovery`, `afldb_restore_test` — recovery database present |
| Migrations | prod `085_matches_is_finals_series.sql`; recovery `083_canonical_auto_apply.sql` |
| Pre-cutover dump | `/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump`, 18,865,740 bytes, 2026-09-02 20:04:02; lists 8 `TABLE DATA staging_aflw` entries |
| **Backup** | `/home/arm/backups/afldb/afldb_prod-20260904-201037.dump`, 21,543,086 bytes, 7 s, 1,199 objects, 6 backups retained (`--keep 14`) |
| **sha256** | `e8cfa912557555faad2ad5db716a7b043c96beeffc9728fa2ea74969956fd639` (written beside the dump as `.sha256`) |
| **restore-test** | restored into `afldb_restore_test` in 10 s; `pg_restore` exit 1 from the two tolerated extension-owner messages only; parity **9/9 PASS** (player_match_stats 694,273; players 13,273; matches 17,047; clubs 24; career games 694,273; career goals 413,049; Brownlow votes 79,113; unrecorded disposals 248,996; stat_availability 3,120) — "Restore verified: the backup is proven." |
| **Off-host copy** | `D:\backups\afldb\afldb_prod-20260904-201037.dump` + `.sha256`, 21,543,086 bytes; local SHA-256 recomputed = `e8cfa912…d639` — **verified** |

PROD read-only preflight (every assertion passed): `auth_audit_log` 11 rows, ids 16–26,
`at` 2026-09-03 06:23:06 → 2026-09-04 13:13:42, 0 in 90–181, 0 markers; `auth_audit_log_id_seq`
26 (`is_called t`); `auth_users` id 1 `super_admin` created 2026-08-16 13:00:47.926753+10, id 2
`admin` created 2026-09-04 12:59:40; `admin_invites` 1; `site_settings` 0; `site_media` 0;
`beta_access_codes` 1 (id 1, `me`, `use_count` 0); `beta_allowed_emails` 0; `beta_login_tokens` 0;
`beta_join_requests` 0 (seq 1, `is_called f`); `auth_sessions` 7, 0 before 2026-09-03, 2 live;
`data_edits` 0, `data_overrides` 0, `player_link_resolutions` 0, `player_link_suggestions` 0;
`staging_aflw.*` all 0; `aflw.seasons/matches/players` 0/0/0.

RECOVERY read-only preflight (every assertion passed): `auth_audit_log` 92 rows, ids 90–181,
`at` 2026-08-16 13:28:19.054484 → 2026-09-02 10:16:18.319137 (+10), 0 foreign actors, 0 non-object
`detail`; `auth_users` id 1 as above; `site_settings` 11, the 7 restore keys match their §3.3 md5s,
`updated_by` 1 on all; `site_media` 1 (`screenshot-2026-08-16-175814.png`, `image/png`, 81,118 =
`length(bytes)`, 1903×909); `beta_join_requests` 1 (id 1, pending, 2026-08-16 20:32:13 — retired);
`beta_access_codes` 1 (retired); unexpired `auth_sessions` 0 (retired); `staging_aflw`
11 / 818 / 710 / 144 / 3,972 / 29,878 / 15,483 / 2.

Export (read-only, `afldb_prod_auth_recovery`, `default_transaction_read_only = on`): `COPY 92`,
`COPY 7`, `COPY 1`, `COPY 1` → `/home/arm/i126/{audit,settings,media,join}.csv` (93 / 8 / 2 / 2
lines; sha256 `c117548e…152e`, `9f4b5c30…9e3b`, `77a173da…3ecec`, `53507acb…f2250`).
`join.csv` exists but T4 is retired and is not run.

### 7.4 Rehearsals (no `-v commit=1`; every SQL unit ended in `ROLLBACK`)

| Unit | Time (AEST) | Result |
|---|---|---|
| T1 | 20:19:56 | **GREEN** — `COPY 92`; preconditions OK (staged 92, ids 90–181; production 11, ids 16–26); `INSERT 0 92`; post-check OK (103 rows, 92 restored, 11 untouched); action histogram 19 actions; `ROLLBACK` |
| T2 | 20:19:56 | **GREEN** — `COPY 7`, `COPY 1`; preconditions OK (7 + 1 staged, production empty); `INSERT 0 7`, `INSERT 0 1`; post-check OK (7 / 1); the 7 md5s and the media row printed as measured; `ROLLBACK` |
| T5 | 20:19:57 | **REFUSED** at "dump lists TABLE DATA": `REFUSED: dump has no data for staging_aflw.seasons`. Nothing written (the script refuses before any `pg_restore`). Cause: `pg_restore --list … \| grep -qE …` — `grep -q` exits on the first match and closes the pipe, `pg_restore` dies on SIGPIPE, and `set -o pipefail` reports the pipeline failed. The TOC does list `TABLE DATA staging_aflw <table> afldb_owner` for all eight (checked read-only at 20:20). **Fix** (`AFLDB-ISSUE-126-t5-aflw.sh`): read the TOC once into a variable and grep that; additionally assert that `pg_restore --list --data-only --schema=staging_aflw --table=<t>` selects exactly **one** `TABLE DATA` entry per table (the same flags the restore uses). |
| T5 (re-run) | 20:21:45 | **GREEN** — all eight tables listed, selection = 1 entry each; all eight target tables empty; "REHEARSAL ONLY — nothing written" |
| T6 | 20:21:46 | **GREEN** mechanically — marker inserted as **id 182**, post-check OK, `jsonb_pretty(detail)` printed with `retired.beta_join_requests` present and the live counts (0 / [] / 0 / 0 as expected before T1/T2/T5); `ROLLBACK` |

### 7.5 STOP — changed production state found by the rehearsal (20:22 AEST)

The T6 rehearsal's marker id was **182**, not 27. PostgreSQL sequence operations are
**non-transactional**: T1's `setval('auth_audit_log_id_seq', 181, true)` ran inside the rehearsal
transaction and survived its `ROLLBACK`; the T6 rehearsal then consumed `nextval` → 182. Read-only
confirmation at 20:22:54 AEST on `afldb_prod`:

| State | Value |
|---|---|
| `auth_audit_log_id_seq` | `last_value 182`, `is_called t` (was 26 at T0) |
| `auth_audit_log` | **11 rows, ids 16–26, 0 in 90–181 — unchanged** |
| `beta_join_requests_id_seq`, `staging_aflw.issues_id_seq` | 1 / `is_called f` — untouched |
| `site_settings`, `site_media`, `staging_aflw.seasons` | 0 / 0 / 0 — untouched |

No row was written. The only production change is the audit id sequence value, and it is
self-inflicted by the rehearsal the approval required. Consequence: the approved T1 refuses on
commit (`REFUSED: auth_audit_log_id_seq is at 182, expected 26`), and any application audit insert
made before T1 would take id 183+. Per the approval's stop conditions ("changed production state",
"assertion failure") **no unit was committed**; T1, T2, T5 and T6 remain un-run with `commit`.

Script change made (tracked, not yet run): `AFLDB-ISSUE-126-t1-audit.sql` now executes the `setval`
**only inside the `\if :commit` branch**, so a rehearsal never touches the sequence again. Its
precondition still requires the sequence at 26.

**Operator decision needed (one of):**

- **(a) Recommended — restore the pre-rehearsal state, then resume as approved.** On `afldb-prod`,
  as the owner role: `SELECT setval('auth_audit_log_id_seq', 26, true);` — exact pre-T0 value; no
  row holds an id above 26 (asserted above), so no collision is possible; T1 then commits with its
  approved precondition intact and re-advances the sequence to 181 itself; the real marker gets
  182 as planned.
- **(b) Accept 182 and relax T1's precondition** to `seq >= 26` (T1's `setval(181)` then moves the
  sequence *down* to 181 and the marker still gets 182). Works, but weakens an approved assertion.

Resume path after (a): `bash /home/arm/i126_run.sh t1` (rehearsal, now sequence-safe) →
`bash /home/arm/i126_run.sh t1 commit` → `t2 commit` → `t5 commit` → `t6` (rehearse, inspect the
live detail) → `t6 commit` → `bash /home/arm/i126_run.sh verify`, then §8 and close-out.

## 8. Post-checks

_(not yet run — execution paused at §7.5 before any commit)_

## 9. `afldb_prod_auth_recovery` retention

**Retained.** It is the only online copy of everything §3 retires, and the cross-check for
everything §5 restores. It may be considered for removal only after this issue is Resolved, as a
separately approved destructive action (`sudo -u postgres dropdb afldb_prod_auth_recovery` needs
the operator's password on this host anyway). The pre-cutover dump file stays under normal
backup retention regardless.

## 10. Exact next action

**Paused before any DML (§7.5).** Operator: choose (a) or (b) in §7.5 — (a) is a single
`setval('auth_audit_log_id_seq', 26, true)` on `afldb_prod` as the owner role, restoring the exact
pre-rehearsal value — and say so. Then, on `afldb-prod`, the resume path in §7.5 (each approved unit
rehearsed then committed, one at a time, evidence into §7/§8), the §5 post-checks, the operator's
browser pass (super-admin login; `/admin/settings`, `/admin/content`, `/admin/access`, home,
`/aflw`), and close-out: resolve the ledger entry, retire the index row, move this file to
`issues/closed/`, delete `/home/arm/i126/` and `/home/arm/i126_*`, commit on `claude/issue-126`,
push, do not merge. `afldb_prod_auth_recovery` and the T0 backup stay until then.
