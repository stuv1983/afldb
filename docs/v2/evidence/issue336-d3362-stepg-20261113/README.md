# D-336-2 Step G on production (2026-11-13): read-only reconciliation and page check, PASS

Contract: `docs/v2/issue336-d3362-approval-packet-2026-11-11.md` §4 Step G (runbook `issues/closed/AFLDB-ISSUE-336.md` §3 step 7),
after Steps E+F were applied and ACCEPTED on 2026-11-12 (`docs/v2/evidence/issue336-d3362-apply-20261112/README.md`). Every
action here was read-only. There was no database write, apply retry, restart, deployment, timer or configuration change, and no
cache revalidation. Production access used Windows OpenSSH.

## 1. Reconciliation against the owner CSVs (Codex, 2026-11-13 ≈06:10 AEDT; 2026-11-12 ≈19:10Z)

- **Source CSVs:** the original owner folder was unavailable, so the preserved read-only copy on streamanator
  `/mnt/ssd/afldb/records/d3363-owner-draftguru-csv-20261111/` was used. All 35 files matched the recorded 2026-11-11 sha256s
  (`reconcile/csv-inventory.txt`, last line). 35 files, 5,966 rows, 1991–2025.
- **Production export:** `reconcile/export.sh` was run on afldb-prod from the ops checkout. It used one `REPEATABLE READ READ ONLY`
  transaction with `default_transaction_read_only` and a UTC session, and asserted identity before reading: `afldb_prod`, OID 66668,
  system identifier 7674454702926115004, `transaction_read_only on` (`reconcile/summary.json`). The DSN is read on the host and
  is not recorded.
- **Result** (`reconcile/reconcile.txt`, `reconcile/reconcile-detail.json`, `reconcile/summary.json`):

| Check | Expected | Observed |
|---|---|---|
| `draft_picks` total | 6,853 | 6,853 |
| DraftGuru rows 1991–2025 | 5,966 | 5,966 |
| Matched CSV ↔ DB, unmatched each side | 5,966 / 0 / 0 | 5,966 / 0 / 0 |
| Per (year, category) count differences | none | none |
| Inserted ids 6819–6853 present | 35 | 35 |
| Manual (`manual_admin_edit`) rows 1991–2025 | 8 | 8 (ids 6811–6818) |
| Active draft `data_overrides` (GAP-029) | 8 | 8 active, 8 GAP-029 |
| Field differences | only the D-336-3 origins | `origin` 187 and no other field |
| Stored (year, kind, pick) collisions; unnumbered kinds carrying a pick | none | none |

The 187 origin differences are the D-336-3 set, decided as option (A) on 2026-11-11 (stored origins kept, carried to the next
acquisition as ISSUE-348). Codex confirmed all 187 retained stored values match that decision.

## 2. Serving release (2026-11-13 ≈06:11 AEDT)

`release-status.txt`: current `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (revision `c1c4b22e…2ade`), previous
`0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`, health 200 `status=ok database=ok`, current build manifest 200, previous 404.
**STATUS PASS.**

## 3. Beta-gated page check (headed Chromium, owner sign-in, 2026-11-13T02:30:17Z = 13:30 AEDT)

Runner `browser/stepg.cjs`, using the repository's Playwright with the owner signed in through `/beta` in the runner's own
window. The session was used only inside the runner and discarded at exit. Nothing from it was read out or saved. The first
launch timed out with no sign-in (`browser/browser-console-attempt1-timeout.txt`). The second run is recorded:
`browser/browser-console.txt`, `browser/result.json` (raw verdict **FAIL 77/83**, kept unmodified).

**The 6 raw failures are a runner predicate defect, not a page failure.** The "authenticated HTTP 200" check was
`resp.status()===200 && !page.url().includes('/beta')`. The base URL is `https://beta.afldb.com`, whose `//beta.` contains `/beta`,
so the predicate is false for every URL on that host. All six recorded the status `200`. Corrected evaluation, from evidence the
same page objects produced:

- each of the six pages also passed its Pre-Draft tab count, row count, inserted names, unnumbered selections and no-rendered-error
  checks, which read `main` content that the `/beta` gate page does not have;
- every screenshot shows the draft page itself, with the breadcrumb `AFLDB / Draft / <year>` and the category tabs, not the gate;
- anonymous requests for the same three paths returned **307 to `https://beta.afldb.com/beta?from=…`**, so the gate is on and a
  200 means authenticated.

**Corrected verdict: 83/83 PASS.** A rerun was not needed for this conclusion and was not made, because another owner sign-in
would add nothing.

| Check (desktop 1280×800 and mobile 390×844) | Result |
|---|---|
| `/draft/2008`, `/draft/2025`, `/draft/2009?view=pre-draft`: authenticated 200 | PASS (corrected, above) |
| 2008 and 2025 Pre-Draft views: HTTP 200 | PASS |
| Pre-Draft tab count and table rows: 2008 **4**, 2025 **4**, 2009 **36** | PASS, both viewports |
| Inserted names present: 2008 Solomoni Loki, Amua Pirika, Inoke Ratu, Stanis Susuve; 2025 Cillian Bourke, Kobe McDonald, Jake Miles-Wrency; 2009 the 11 names in `reconcile/expected.json` | PASS, both viewports |
| Pre-Draft selections unnumbered (`Unnumbered`; 2025 Kalani White `Unnumbered — Father–Son`) | PASS |
| No page-level horizontal overflow (desktop −15, the scrollbar; mobile 0) | PASS |
| No rendered error; no page errors; no console errors | PASS |
| Beta gate preserved (anonymous 307 to `/beta?from=`) for all three paths | PASS |

**Screenshots (inspected one by one):** `browser/{desktop,mobile}-2008.png`, `-2025.png` (All view), `-2008-predraft.png`,
`-2025-predraft.png`, `-2009.png` (Pre-Draft view).
- The served content agreed with production, so no revalidation was considered.
- Both 2008 "All" captures, the first page in each context, still show the anonymous search-cookie banner, either during or
  before the Decline click. This is cosmetic, and every Pre-Draft capture is clear of it.
- The wide tables scroll inside their container, as designed. The 2025 desktop Pre-Draft table shows its own scrollbar.

## Result

Step G PASS. D-336-2 is complete, and ISSUE-336 is resolved on 2026-11-13. ISSUE-348 stays open for the next DraftGuru
acquisition.

Not retained in the repository: the owner CSVs (the read-only copy stays on streamanator), and the derived `csv_rows.json` and
`draft-export.json.gz`. They stay in the workstation's local folder `D:\dev\afldb\.local-stepg-20261113\`.
