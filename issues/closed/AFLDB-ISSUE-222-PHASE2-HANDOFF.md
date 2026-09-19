# AFLDB-ISSUE-222 Phase 2 — acquisition handoff for a fresh session

**Status: Phase 2 (network acquisition) AUTHORISED 2026-09-18 for exactly ONE new Stage B3
whole-population snapshot. Nothing beyond acquisition is authorised by this document** — no
database import, no DEV/PROD write, no deployment, no Phase 3/4/5. This file is the complete
operating brief for that one acquisition run. It does not need `AFLDB-ISSUE-222.md` read in full,
but §11 of that file (Phase 1 closeout / Phase 2 authorisation) and the `AFLDB-ISSUE-222` entry
in `issues.md` are the authoritative validation record if anything here needs cross-checking.

---

## 1. What is authorised, exactly

- **One** run of the Stage B3 whole-population person-page acquisition (revised runbook §2, §5
  Phase 2): build the population sample, probe, then the full run (resumable).
- Robots.txt, pacing, retry and immutable-snapshot rules are the EXISTING, already-implemented
  contract (`tools/rebuild/draftguru/draftguru-contract.json` → `http_policy`,
  `person_stage.b3`) — concurrency 1, 1.5s minimum pacing, 20s timeout, 3 retries at 2/4/8s,
  same-host redirects only, robots.txt fetched once and respected with `/players/*` checked.
- **Wikipedia links are captured automatically as part of this same run** (operator instruction
  2026-09-18) — see §5a. No extra command, no extra request: it is extracted from the person page
  DraftGuru itself was already downloaded, never a separate fetch.
- **NOT authorised:** `import_draftguru.py` (with or without `--bridge`) against any database,
  including `afldb_test`; any DEV/PROD command; `npm run build`; any deployment step; Phase 3
  (`export_person_bridge.py --source-evidence`/`--review-sample`/`--resolve-against`) or later.
  If you find yourself about to run any of those, STOP and report back instead.
- No Git command (commit/push/merge) — the operator handles Git, per this project's standing
  rule (`CLAUDE.md` §12).

## 2. O-1 / O-2 / O-3 — decided, and what they mean for THIS run

| # | Decision | Relevance to Phase 2 |
|---|---|---|
| O-1 | Census (every bridged National Draft top-10 person) + random stratum n = 598, revision 2 sampling/failure-handling rules preserved | Not exercised in Phase 2 — this governs the §3.5 review, which is Phase 3. Recorded here so the acquisition session does not need to ask. |
| O-2 | No change to `external_identities.notes` | Not exercised in Phase 2 (importer is not run). |
| O-3 | Stop for diagnosis at >2% overall terminal-failure rate, >5% failure rate in any single draft year, or any failed National Draft top-10 person | **Directly relevant.** The acquisition tooling already computes and reports these (see §6 below) but does **not** auto-abort on them — you must read the printed summary after the run and apply this stop rule yourself. |

## 3. Environment (verified working 2026-09-18, this exact worktree)

- Worktree: `D:\dev\afldb-issue-222`, branch `sonnet/issue-222`. Continue in this SAME worktree —
  it already has Phase 1's tooling and the already-copied, already-verified accepted Stage A
  snapshot (see §4). If the operator instead gives you a different/fresh worktree, re-read §4
  before assuming the snapshot is there.
- `.env` is present in this worktree (operator-supplied). Do not copy `.env` between worktrees
  yourself if you end up in a different one — CP1252 vs UTF-8 corrupts it for Python; ask the
  operator to supply it the same way.
- **Python:** no `.venv` exists in this worktree. Resolve the interpreter the same way the
  existing tools' own tests do: use `$env:AFLDB_PYTHON` if the operator has set it, else
  `.venv\Scripts\python.exe` if present, else plain `python` on PATH. **Verified this session:**
  system `python` resolves to 3.12.10 and successfully ran every Phase 1 tool (including spawning
  `stage_b3_population.py`/`export_person_bridge.py`/`acquire_persons.py`-family scripts).
  Acquisition itself needs no third-party package (the adapter reuses Stage A's own HTTP
  primitives, stdlib-only) — confirm with `python -c "import urllib.request; print('ok')"` before
  starting if you want an extra check, but do not `pip install` anything.
- **No database connection is needed for anything in this document.** Do not derive or use any
  `AFLDB_TEST_DATABASE_URL` port override — that was a Phase 1 activity (isolated-test-database
  validation) and has no role in acquisition.

## 4. The accepted Stage A snapshot — already present, already verified, do not re-fetch

`data/sources/draftguru/annual-html-20260826/` is already in this worktree (gitignored, copied
2026-09-18 from `streamanator:/home/arm/projects/afldb/data/sources/draftguru/annual-html-20260826`
with operator authorisation — not a fresh acquisition). Verified before and after copy: all 42
`raw/years/*.html` pages' sha256 match `docs/rebuild-manifests/draftguru/annual-html-20260826.json`
exactly (0 mismatches); `parsed/persons.jsonl` / `parsed/rows.jsonl` hold 5,057 / 6,810 lines,
matching the manifest's `distinct_player_url_count` / `total_rows`. **Do not re-copy or
re-acquire it.** If it is somehow missing when you start, STOP and report back — do not acquire
Stage A fresh (that is a different, larger, separately-governed acquisition, not part of this
authorisation).

## 5. Commands — probe, full run, resume

Today's date for the label is whatever date you actually run this on — substitute it for
`<YYYYMMDD>` below (do not reuse `20260826`, which is refused outright for a Stage B3 write, or
any date already used by an earlier Stage B3 attempt).

```powershell
# 1. Build the whole-population sample (offline, no network; ~instant).
python tools/rebuild/draftguru/stage_b3_population.py --label person-html-<YYYYMMDD>
# Expect: "PASS: Stage B3 population sample validated (5057 persons, one primary_cohort
# 'population')" and data/sources/draftguru/person-html-<YYYYMMDD>/sample.json written.

# 2. Bounded probe — ONE identity, to prove the mechanics before the full run.
#    Recommended probe target (the project's own established regression anchor, confirmed
#    present in this snapshot 2026-09-18): https://www.draftguru.com.au/players/brad_miller/1
python tools/rebuild/draftguru/acquire_persons.py --label person-html-<YYYYMMDD> `
  --probe https://www.draftguru.com.au/players/brad_miller/1
# Expect: one HTTP request (after a robots.txt fetch), JSON printed with "mode": "probe",
# "manifest_written": false. Inspect the fetched page at
# data/sources/draftguru/person-html-<YYYYMMDD>/raw/persons/brad_miller__1.html and its
# HTTP record before proceeding — confirm the page actually looks like a DraftGuru person page,
# not an error/CAPTCHA/redirect page.

# 3. Full run — ~5,057 requests at 1.5s minimum pacing = ~2.1 hours before any retries.
#    Run this in the background; it is safe to let it run long, and safe to interrupt and
#    resume (see below).
python tools/rebuild/draftguru/acquire_persons.py --label person-html-<YYYYMMDD>
# Expect on success: "manifest_written": true, and the manifest at
# docs/rebuild-manifests/draftguru/person-html-<YYYYMMDD>.json (a NEW tracked file — do not
# commit it yourself; the operator handles Git).
```

**Resume:** if the full run is interrupted (network blip, session restart, deliberately stopped),
re-run the EXACT SAME command (step 3). Every already-fetched or already-terminally-failed
identity is reused, never silently retried — only the remaining pending identities are fetched.
This is safe to do any number of times.

**Do not** pass `--no-fetch` unless you specifically want to verify completeness without fetching
(it fails closed if anything is still pending) — the default full-run behaviour already does the
right thing.

## 5a. Wikipedia links — captured automatically, no separate step

Operator instruction 2026-09-18: DraftGuru person pages sometimes also link to the player's
Wikipedia page. This is now captured as part of the SAME profiling step the commands above
already run (`profile_person_pages.py`, invoked by `acquire_persons.py`) — there is no additional
command, and **Wikipedia itself is never fetched**, in this or any phase. Only the href already
present on the downloaded DraftGuru page is recorded.

Per person, in `parsed/person_profile.jsonl` (offline, informational — never identity, never
touching the AFL Tables bridge or `apply_authority()`):

- `wikipedia_hrefs`: every Wikipedia-host anchor found on the page, verbatim (`href`, `host`,
  `anchor_text`, `document_index`) — every occurrence, including duplicates.
- `wikipedia_href_count` / `distinct_wikipedia_href_count`: raw anchor count vs. distinct-href
  count (the same href linked twice is one distinct candidate, not two).
- `wikipedia_url` / `wikipedia_url_reason`: the single candidate href when exactly one DISTINCT
  Wikipedia href was found; `null` with a reason otherwise (`"no Wikipedia href on the page"` for
  absence, `"N distinct Wikipedia hrefs on one page -- ambiguous..."` for more than one). **A
  captured `wikipedia_url` is not verified relevant** — the tool cannot judge that without
  fetching Wikipedia, which it never does; a single Wikipedia link about something other than the
  player is still captured, by design, for a human reviewer to judge later.

The aggregate (`parsed/afltables_link_profile.json`, and the same object embedded in the
manifest) gains a `wikipedia_link` section: `{with_wikipedia_url, ambiguous_multiple_hrefs,
coverage_pct_of_requested, coverage_pct_of_fetched}`. Report these counts alongside the AFL
Tables coverage counts in §9 — they are informational only, not a stop condition, and not part of
the O-3 rule below.

## 6. Reading the result — apply the O-3 stop rule yourself

The full run's manifest (`docs/rebuild-manifests/draftguru/person-html-<YYYYMMDD>.json`) embeds
the profiler's aggregate under `afltables_link_profile`, which carries two fields Phase 1 built
specifically for this decision:

- `crawl_failure_ceiling`: `{available, ceiling_pct: 2.0, observed_pct, failed, requested,
  exceeded}`. If `exceeded` is `true`, **stop and report** — do not proceed to any further phase,
  and do not decide a retry yourself; that is an operator decision (revised runbook §2.6 item 1).
- `failure_concentration`: `{available, by_year_failed_pct, by_year_trigger_pct: 5.0,
  years_triggered: [...], national_top10_failed_player_urls: [...],
  national_top10_trigger_fired, retry_decision_required}`. If `retry_decision_required` is
  `true` (i.e. `years_triggered` is non-empty or any national top-10 person failed), **stop and
  report** the specific years/persons — again, no retry decision is yours to make.
- If **neither** condition fires: report `fetched`, `failed`, `with_afltables_identity`,
  `coverage.overall_pct_of_requested`, and the `by_primary_cohort`/`residual_bridge`/
  `zero_game_bridge` breakdowns from the same manifest section, and stop — Phase 3 (deriving the
  bridge dataset, the §3.5 review) is a SEPARATE authorisation, not implied by this one.

You can also read these two fields directly without waiting for the manifest, from
`data/sources/draftguru/person-html-<YYYYMMDD>/parsed/afltables_link_profile.json`, which is
written just before the manifest.

## 7. What NOT to do (repeating §1, because it matters most)

- Do not run `import_draftguru.py` at all, with or without `--bridge`, against any database.
- Do not run `export_person_bridge.py` (any mode) — that is Phase 3.
- Do not touch DEV or PROD in any way.
- Do not run `npm run db:test:rebuild`, `npm run build`, or any deployment script.
- Do not commit, push, or merge — report your results and stop; the operator commits.
- Do not re-acquire or modify the Stage A snapshot (§4).
- Do not decide a retry on an O-3 trigger yourself — report it.

## 8. Existing validation evidence (for context only, not to be re-verified)

Phase 1 tooling (the scripts this handoff runs) was implemented and validated 2026-09-18:
DB-free suites 174 passed / 1 failed (pre-existing, unrelated, `AFLDB-ISSUE-223`) / 3 skipped
(pre-existing, needs artefacts not copied this pass) / 178 total; `tests/db-test-rebuild.test.ts`
293/293; the isolated-`afldb_test` integration suite (`tests/integration/draftguru-import.test.ts`)
24/24 — bridge propagation, idempotency, unregistered-target handling (both the importer's own
HALT and `export_person_bridge.py --resolve-against`), human-decision precedence, and
rollback/audit all confirmed by real execution.

The §5a Wikipedia-link capture was added afterward, same day, as a profiler-only addition (no
database interaction, so the isolated-`afldb_test` suite was not re-run — nothing it covers
changed). DB-free re-validation: 180 passed (174 + 6 new Wikipedia-capture tests: absent,
ambiguous, "unrelated"/relevance-never-judged, deduplicated-repeat-href, single-href, and
aggregate-coverage cases) / 1 failed (still `AFLDB-ISSUE-223`, unrelated) / 3 skipped (unchanged)
/ 184 total; `tsc --noEmit` clean; `eslint` clean on the touched lines. Full detail: `issues.md`
→ `AFLDB-ISSUE-222`.

## 9. When you're done

Report: the label used; probe result; full-run `fetched`/`failed` counts; the two O-3 fields
verbatim; whether either stop condition fired; if not, the coverage/cohort breakdown from §6;
and the `wikipedia_link` aggregate from §5a (`with_wikipedia_url`, `ambiguous_multiple_hrefs`,
both coverage percentages). Do not draft a Phase 3 plan unless asked — this handoff's scope ends
at the acquisition result.

## 10. STATUS 2026-09-18 — run executed, post-fetch aggregation crashed, fixed, resumed

The `person-html-20260918` acquisition ran exactly as §5 describes and fetched all 5,057 pages
with zero HTTP failures. Immediately afterwards, the step this document describes as "invoke the
offline profiler" (§5 step 3, `acquire_persons.py`'s non-probe path) crashed with
`KeyError: 'residual_input'` before writing any parsed output or manifest — a pre-existing Phase 1
defect in `aggregate()`/`build_manifest()` (both unconditionally read Stage B1-only `sample.json`
fields that Stage B3's `sample.json` does not carry), not anything wrong with the acquisition run
itself or with §5's commands.

**Fixed** in a follow-up session (`tools/rebuild/draftguru/profile_person_pages.py`,
`tools/rebuild/draftguru/acquire_persons.py` — both now stage-aware; B1 output unchanged; 4 new
regression tests). Aggregation was then resumed with **zero HTTP requests**
(`python tools/rebuild/draftguru/acquire_persons.py --label person-html-20260918 --no-fetch` — safe
because every identity was already terminally classified from the interrupted run) and completed
successfully: manifest written to
`docs/rebuild-manifests/draftguru/person-html-20260918.json`, both O-3 conditions pass clean
(ceiling 0.0% observed vs 2.0%; no year/top-10 concentration trigger). Full detail: `issues.md` →
`AFLDB-ISSUE-222`, and `AFLDB-ISSUE-222.md` §11.4.

This handoff's own commands (§5) remain correct for a *future* Stage B3 run — the defect was in
the profiler/adapter code they invoke, not in this document, and that code is now fixed. Phase 2
for `person-html-20260918` is complete; Phase 3 (bridge derivation) is unaffected and still
requires its own separate authorisation.
