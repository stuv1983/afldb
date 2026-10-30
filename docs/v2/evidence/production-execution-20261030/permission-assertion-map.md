# Privileges suite 43 assertions → production read-back facts (D-V2-PROD-EXEC-1, P-5)

**Purpose.** Gate T runs the unmodified `tests/integration/privileges.test.ts` (43 `it()` blocks) only on
the isolated clone B (frozen bytes, ACLs kept, after the exact A-REL sequence). Production never runs the
suite or any fixture-writing test. Gate V2 instead runs `permission-readback.sql` as `afldb_backup` in a
read-only transaction on production after A-REL and compares it with the same read-back of clone B
(`snapshot-compare.mjs permissions`). This map shows that every catalogue input each assertion reads is a
compared fact, so "B passed 43/43 and P's read-back equals B's" carries the suite's verdict to production.

**The suite is catalogue-only.** Every assertion reads `pg_roles`, `pg_has_role`, `has_*_privilege`,
`pg_default_acl`/`aclexplode`, `pg_proc`, `pg_attribute`, `information_schema.columns`, the two
`afldb_meta` registries, `afldb_meta.owned_sequences()` and `OPERATIONAL_TABLES` from code (lines 75–1635
inspected 2026-10-30). Its two `beforeAll` hooks only check that roles/functions exist. The `has_*_privilege`
functions report effective privilege, including PUBLIC grants and inherited membership, so the `E|` lines
are the effective answer the suite receives, independent of which cluster mechanism produced it.

## Fact families (permission-readback.sql)

| Code | Fact | Compared |
|---|---|---|
| S1 | schema owner + ACL | identical |
| S2 | relation kind, owner, ACL (tables, views, sequences, foreign) | identical |
| S3 | column ACLs | identical |
| S4 | routine kind, owner, SECURITY DEFINER, volatility, nargs, proconfig, md5(prosrc) | identical |
| S4b | routine ACL (explicit; NULL is reported as such) | identical |
| S5 | default ACLs (for role, schema, objtype, grantee, grantor, privilege) | identical |
| S6 | `app_readable_tables`, `import_writable_tables` names | identical |
| S7 | ledger names + checksums | identical |
| S8 | triggers (enabled state, function) | identical |
| S9 | sequence → owning table (`pg_depend`, the input of `owned_sequences()`) | identical |
| S10 | ordered live column list with types | identical |
| E1–E6 | effective table / any-column / column / sequence / schema / routine privilege of afldb_app, afldb_auth, afldb_import | identical |
| C1–C3 | afldb_* role attributes, memberships (PG16 options), database privileges; `afldb_v2_super` (the isolated cluster's own bootstrap superuser, P-6 F-003) excluded by name | listed; any difference → REVIEW |
| A0–A3 | role existence; afldb_app attributes; afldb_app non-membership; afldb_backup cannot execute the clear | each side must hold every line `|ok` |

## Assertion map

| # | Line | Assertion | Inputs read by the test | Compared read-back facts |
|---|---|---|---|---|
| 1 | 75 | afldb_app is an unprivileged login role | pg_roles attrs | A1 both sides; C1 |
| 2 | 92 | not a member of a writing role | pg_has_role(app, owner/import/auth/postgres) | A2 both sides; C2 |
| 3 | 104 | no write privilege on any table/view | has_table / has_any_column, pg_class | E1, E2, S2 |
| 4 | 129 | cannot advance a sequence | has_sequence_privilege | E4, S2 |
| 5 | 146 | cannot create in data schemas | has_schema_privilege | E5, S1 |
| 6 | 159 | cannot read auth/submission tables | has_any_column, OPERATIONAL_TABLES | E2 (code list is in the reviewed commit) |
| 7 | 191 | reads exactly the registry | has_any_column, app_readable_tables | E2, S6 |
| 8 | 226 | no default privilege for app | pg_default_acl | S5 |
| 9 | 248 | still reads the statistical tables | has_table_privilege | E1 |
| 10 | 269 | afldb_auth holds the admin grants | has_table_privilege | E1 |
| 11 | 344 | cannot rewrite what a reader said | has_table_privilege | E1 |
| 12 | 369 | link suggestion workflow, column-limited | has_table / has_column | E1, E3, S3 |
| 13 | 399 | auth advances only its own sequences | has_sequence_privilege, owned_sequences() | E4, S9 |
| 14 | 425 | auth holds nothing outside its list | has_any_column | E2 |
| 15 | 458 | auth no write on statistical tables | has_any_column | E2 |
| 16 | 519 | nl_search_telemetry_clear SECDEF/owner/search_path | pg_proc prosecdef, provolatile, proconfig, pronargs, proowner | S4 |
| 17 | 546 | clear executable by auth only | has_function_privilege (auth, app, import, backup), proacl | E6, S4b, A3 |
| 18 | 595 | clear body has no dynamic SQL/CASCADE/TRUNCATE | prosrc | S4 (md5 of prosrc) |
| 19 | 616 | auth has no DELETE/TRUNCATE on NL tables | has_table_privilege | E1 |
| 20 | 650 | import cannot touch auth/beta/invite/media | has_table / has_any_column, OPERATIONAL_TABLES | E1, E2 |
| 21 | 690 | import reads submissions at migration-023 width | has_table / has_column | E1, E3, S3 |
| 22 | 718 | no default privilege for import (outside staging) | pg_default_acl | S5 |
| 23 | 739 | import writes exactly the registry | has_table_privilege, import_writable_tables | E1, S6 |
| 24 | 833 | Brownlow workflow tables, never TRUNCATE | has_table, owned_sequences() | E1, E4, S9 |
| 25 | 874 | grid boards append-only | has_table / has_column / has_sequence, registry | E1, E3, E4, S6, S9 |
| 26 | 944 | own audit rows append-only | has_table / has_sequence | E1, E4 |
| 27 | 995 | canonical mutation ledger append-only | has_table / has_any_column / has_sequence, registries | E1, E2, E4, S6 |
| 28 | 1067 | afl_api identity ledger append-only | as 27 | E1, E2, E4, S6 |
| 29 | 1124 | curated-award proposals (migration 111) | has_table / has_any_column / has_column, registries, pg_attribute | E1, E2, E3, S6, S10 |
| 30 | 1200 | derived award results (112) | has_table / has_any_column / has_sequence, registries | E1, E2, E4, S6 |
| 31 | 1240 | Brownlow eligibility decisions (113) | as 30 | E1, E2, E4, S6 |
| 32 | 1279 | derived award projections (114) | as 30 | E1, E2, E4, S6 |
| 33 | 1316 | human overrides upsert only | has_table / has_column / has_sequence, registry, pg_attribute | E1, E3, E4, S6, S10 |
| 34 | 1383 | period stats read-only for import | has_table / has_sequence, owned_sequences() | E1, E4, S9 |
| 35 | 1420 | cannot reset operational sequences | has_sequence, owned_sequences(), OPERATIONAL_TABLES | E4, S9 |
| 36 | 1438 | can fast-forward bulk-load sequences | has_sequence, owned_sequences() | E4, S9 |
| 37 | 1454 | cannot write home-page settings | has_table_privilege | E1 |
| 38 | 1479 | still writes the statistical tables | has_table_privilege | E1 |
| 39 | 1530 | staging projections carry exactly the schema-wide grants | has_table_privilege, pg_class | E1, S2 |
| 40 | 1557 | staging inherits migration 014's default (the two A-REL defaults) | pg_default_acl | S5 |
| 41 | 1584 | app read-only on staging, auth out | has_table / has_any_column / has_schema | E1, E2, E5 |
| 42 | 1610 | migration 074 append-only boundary | has_table_privilege | E1 |
| 43 | 1635 | adding a data_issues column changed no grant | has_table / has_any_column, information_schema.columns | E1, E2, S10 |

`OPERATIONAL_TABLES` (tests 6, 20, 35) is code in the reviewed commit; the read-back covers every relation, so
the facts behind any list member are compared regardless of the list.

## Equivalence rule (what may be claimed)

- **IDENTICAL (exit 0):** every S| and E| fact equal, every required A| line present once and `|ok` on both
  sides, C| equal. Claim: *production's permission surface equals clone B's, on which the unmodified suite
  passed 43/43.* Never: "the suite passed on production".
- **REVIEW (exit 3):** S|/E| identical and A| ok, C| differs. Effective privileges are already equal (E|), so
  no assertion's input differs, but **clone equivalence is not claimed**: each C| line is listed for the owner
  with its effect (for example a membership in a built-in role). A-GO needs the owner's disposition.
- **DIFFERENT (exit 1):** any S|/E| difference or a missing or failing A| line. Stop before A-GO.
- **invalid (exit 2):** missing/unreadable input, unexpected line; nothing is written. Stop.

Controls proving each branch: `controls/rehearsal-controls.sh` T1 (widened grant), T2 (missing staging
default: suite 42/43 and an S5 difference), T3 (cluster fact → REVIEW), T4 (A| FAIL → DIFFERENT), T5
(ownership change → DIFFERENT).
