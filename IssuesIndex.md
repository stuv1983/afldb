# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-08-21  
**Open issues:** 8

## How Claude should use this file

- Read this file once near the start of technical AFLDB work.
- Use it to identify overlap with a known open issue.
- If an issue is relevant, read only that exact detailed entry from `issues.md`.
- Do not read all of `issues.md` just to understand current project problems.
- When an issue is created, reopened, resolved, materially reclassified, or
  given a materially different next action, update this file in the same task.
- Keep this file synchronized with the Open Issues table at the top of
  `issues.md`.

## Open issues at a glance

| Issue | Severity | Area | Current state |
|---|---|---|---|
| `AFLDB-ISSUE-015` | High | Database | `club_seasons` ladder materialisation remains stale after match create/delete/score correction. |
| `AFLDB-ISSUE-027` | High | Architecture | Statistical writes and required audit records remain non-atomic across role-separated connections. |
| `AFLDB-ISSUE-040` | Low | Tooling | Lint cannot run deterministically/non-interactively because ESLint is not configured. |
| `AFLDB-ISSUE-044` | High | Import | Legacy honours reloads can overwrite manual identity resolutions; Under-22 is protected but older loaders are not. |
| `AFLDB-ISSUE-054` | Medium | Tests | Four Under-22 importer contract tests fail at stale literal source-boundary markers. |
| `AFLDB-ISSUE-059` | Low | Search | Grouped qualifying-match counts are plain text because current Match Search cannot replay every grouped predicate. |
| `AFLDB-ISSUE-068` | Medium | UI/Hydration | React #418 remains intermittent under production-style NL search hydration; narrow H7 diagnostic is awaiting authoritative live-build validation. |
| `AFLDB-ISSUE-071` | Low | Audit | V2 residual failures require generator/oracle re-baselining before any remaining parser defect is promoted. |

---

## AFLDB-ISSUE-015 — Match mutations leave source-derived club-season ladders stale

- **Severity:** High
- **Area:** Database
- **Key files:** `src/db/queries/match-admin.ts`, `src/db/queries/data-edits.ts`, `src/db/queries/player-derived.ts`, `src/db/queries/seasons.ts`
- **Current state:** Season metadata refresh exists, but public ladder queries still read stored `club_seasons` rows that point mutations do not rebuild. The 2026-08-21 review confirmed this remains a real product defect.
- **Next action:** Extract a targeted `club_seasons` rebuild from the canonical migration logic, including season-specific points and finals policy, then add database-backed fixtures.
- **Do not:** Improvise a generic local ladder aggregate that ignores historical season rules.

## AFLDB-ISSUE-027 — Statistical mutations and required audits commit separately

- **Severity:** High
- **Area:** Architecture
- **Key files:** `src/db/queries/match-sheet.ts`, `src/db/queries/match-admin.ts`, `src/db/queries/awards-admin.ts`, `src/db/queries/data-edits.ts`, `src/db/queries/player-links.ts`, `src/app/admin/data-editor/actions.ts`
- **Current state:** User-facing success-with-warning handling reduces unsafe retries, but statistical and audit writes still use separate role-scoped transactions and are not atomic.
- **Next action:** Choose and implement either a database-owned audit function callable inside the import transaction or a durable transactional outbox with idempotent delivery.

## AFLDB-ISSUE-040 — Lint script is not configured for non-interactive validation

- **Severity:** Low
- **Area:** Tooling
- **Key files:** `package.json`
- **Current state:** `npm run lint` still maps to deprecated `next lint`; ESLint is not installed/configured, so the command becomes interactive instead of providing deterministic validation.
- **Next action:** Add a reviewed ESLint flat configuration and compatible Next/ESLint dependencies through the normal dependency process, then replace `next lint` with the ESLint CLI.

## AFLDB-ISSUE-044 — Full awards reload discards existing manual player resolutions

- **Severity:** High
- **Area:** Import
- **Key files:** `tools/migration/import_awards.py`, `src/db/queries/player-links.ts`
- **Current state:** The scoped Under-22 path preserves durable IDs/resolutions, but older destructive honours loaders can reconstruct rows from legacy link state and lose later human decisions.
- **Next action:** Replace destructive honours reloads with source-scoped upserts that preserve target row IDs, or redesign resolution targeting around durable `(source_id, source_record_id)` keys; add database integration coverage for manual resolve → full reload → preserved link.

## AFLDB-ISSUE-054 — Under-22 importer contract tests cannot find their source boundaries

- **Severity:** Medium
- **Area:** Tests
- **Key files:** `tests/under-22-importer.test.ts`, `tools/migration/import_awards.py`
- **Current state:** Four contract tests fail in the `between()` helper because the expected end marker is no longer found. The defect was reproduced unchanged on 2026-08-21.
- **Next action:** Review the importer/test marker contract and repair the source boundaries without weakening the behavioural assertions.

## AFLDB-ISSUE-059 — Grouped qualifying counts have no drill-down link

- **Severity:** Low
- **Area:** Search
- **Key files:** `src/components/NlAnswerSection.tsx`, `src/search/match-spec.ts`, `src/db/queries/nl/team-match.ts`
- **Current state:** `TeamAggregateTable` still renders `Qualifying matches` as plain numeric text. Existing Match Search filters cannot faithfully encode the full grouped predicate set.
- **Next action:** Extend Match Search or add a dedicated NL drill-down route capable of replaying team perspective, opponent, venue, season range, result and optional per-match margin predicates before linking the count.

## AFLDB-ISSUE-068 — Intermittent React hydration errors during NL UI sweeps

- **Severity:** Medium
- **Area:** UI/Hydration
- **Key files:** `tests/nl-ui/nl-stress.spec.ts` plus the current feedback/search hydration implementation and captured `artifacts/hydration/*` / `artifacts/nl-ui/*` evidence.
- **First wrong layer:** UI/runtime.
- **Current state:** React #418 remains intermittent under production-style standalone load. Navigation prefetch reduction helped but did not eliminate it. The server-owned feedback-form change also did not fully resolve it. The current narrow H7 experiment removes only `useFormStatus`/pending-derived button disabling from `NlAnswerFeedbackControls`; typecheck/build passed. The ledger's last handover says the service had just been restarted but port 3100 initially refused connections, so the diagnostic build was not yet proven live.
- **Expected diagnostic build:** `0aYQumjOtVYcrJKPCj0_a`
- **Exact next action:**
  1. **Do not rebuild first.**
  2. Check `systemctl is-active afldb`.
  3. Check `http://127.0.0.1:3100/api/health`.
  4. Check live `x-afldb-build`.
  5. If the service is unhealthy, inspect service status, listener and journal before touching source.
  6. If healthy and built/live IDs both equal `0aYQumjOtVYcrJKPCj0_a`, run only the unchanged 118-row feedback discriminator with four workers and `NL_UI_BATCH=12`.
  7. If any feedback-present React #418 remains, preserve artifacts and stop; H7 is falsified/materially weakened. Do not broaden the patch or run 125/501/12k.
  8. If the run is 0/118, repeat the exact 118-row discriminator before accepting H7.
- **Do not mark resolved yet.**
- **Do not add a changelog entry merely for the end-of-day diagnostic status.**

## AFLDB-ISSUE-071 — Parser-v25 V2 stress residual failure classification

- **Severity:** Low
- **Area:** Audit
- **Key files:** `tools/nl/v2-runner.ts`; report `/home/arm/nl-stress-out-codex-v25-v2/report.md`
- **Current state:** The 250k V2 run had 20,000/20,000 verified football answers correct, 24,393/24,393 expected declines safe, zero unsafe answers, and 6,788/6,788 metamorphic groups consistent. Residual hard/soft findings are dominated by known corpus/oracle-policy tension, with smaller numeric-condition clusters requiring review.
- **Next action:** Re-baseline the V2 generator/oracles for season-range sum expectations, historical coverage policy, wrong-decline-reason expectations, and numeric-condition operator contradictions. Promote a product defect only after the oracle layer is reconciled.
