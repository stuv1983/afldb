# AFLDB-ISSUE-127 — Super Admin on-demand AFL Tables current-season refresh

> Implementation runbook and evidence ledger.
> Session: 2026-09-03, Opus 5 (1M) / Medium / Normal, worktree `D:\dev\afldb-issue-127`,
> branch `codex/issue-127`, base `a9feb22`.
>
> Sections marked **[CONFIRMED]** are repository evidence verified in this worktree.
> Sections marked **[BUILT]** record what this session implemented.

---

## 1. Problem statement

`AFLDB-ISSUE-122` is Resolved and operating in production: `afldb-settle-afltables.timer`
fires `afldb-settle-afltables.service` nightly at 04:30 local, which runs the approved
chain and applies AFL Tables current-season data canonically without a human.

There is no way for a Super Admin to say **"fetch it now"**. After a round finishes, the
only options are to wait for the overnight window or to SSH into the host and run
`sudo systemctl start afldb-settle-afltables.service` by hand. The second is not something
the product should require, and it is not auditable in AFLDB's own trail.

ISSUE-127 adds exactly one capability: a Super Admin, from
`/admin/current-season`, can start **the same** production chain immediately, see a bounded
structured result, and leave an audit row behind. It adds no second ingestion
implementation, no new source authority, and no new privilege for the ingestion itself.

---

## 2. Issue identity [CONFIRMED]

`AFLDB-ISSUE-127` is a **new** issue.

- `IssuesIndex.md:46` declares *"Next free issue ID is `AFLDB-ISSUE-127`."*
- A repository-wide grep for `ISSUE-127` across `*.md`, `*.ts`, `*.sql`, `*.py` (excluding
  `node_modules`) returned exactly that one line before this file existed.
- No open issue owns this scope. The eight open issues are `AFLDB-ISSUE-104`, `-110`,
  `-113`, `-116`, `-123`, `-124`, `-125`, `-126`; none concerns admin-initiated ingestion.
- **No migration number is claimed.** ISSUE-127 adds no schema.

---

## 3. What already exists [CONFIRMED]

Everything this issue needs is already built. Verified in this worktree:

| Fact | Evidence |
|---|---|
| The approved chain is one script | `deploy/afldb-settle-afltables.sh` — acquire → adjudicate → settle, under `set -eu`, one label, one season |
| It is a `Type=oneshot` systemd unit | `deploy/afldb-settle-afltables.service:9` |
| The timer fires it nightly | `deploy/afldb-settle-afltables.timer` — `OnCalendar=*-*-* 04:30`, `RandomizedDelaySec=15min`, `Persistent=true` |
| Every settle run writes a structured record | `src/lib/acquisition/settle-afltables.ts:1772-1780` (`import_batches` INSERT) and `:1869-1876` (UPDATE setting `status='completed'` and `validation_result = tx.json(counters)`) |
| The batch note carries the run identity | `...; snapshot=<label>; season=<year>; mode=<apply\|dry-run>` |
| `import_batches` is readable by `afldb_app` | `src/db/migrations/039_app_read_is_fail_closed.sql:80-92` seeds every public table except the eleven auth/media ones; `import_batches` is not excluded |
| `validation_result` holds the full counter set | `SettleCounters`, `src/lib/acquisition/settle-afltables.ts:1370-1460` |
| A dry run leaves no batch row | `:1878-1880` — `SettleDryRunRollback` discards the whole transaction |
| Super-admin authorization primitive | `requireSuperAdmin()`, `src/lib/auth/session.ts:294-298` |
| Audit primitive | `audit()`, `src/lib/auth/session.ts:384-390`, writing `auth_audit_log` |
| The admin surface to extend | `src/app/admin/current-season/{page,actions,CurrentSeasonControls}.tsx` — already `requireSuperAdmin()` gated |
| Squiggle/Kali cannot write canonically | ISSUE-122 §11.2; `page.tsx:38-41` states it and `actions.ts` passes `insertMissingMatches = false` |

**Nothing in `src/` spawns a child process today** — a repository-wide grep for
`child_process` / `execFile` / `spawn(` across `src/**/*.ts{,x}` returned zero hits.
ISSUE-127 introduces the first one, which is why §5 is written the way it is.

---

## 4. The execution mechanism — why polkit, not sudo [CONFIRMED]

The web application runs as `arm` under `deploy/afldb.service`. The settle unit is a
**system** unit, so starting it requires privilege the web service does not have.

**`sudo` is not usable here, and this is a hard blocker, not a preference.**
`deploy/afldb.service:76` sets `NoNewPrivileges=true` and `:107` sets
`RestrictSUIDSGID=true`. Under `NoNewPrivileges`, the kernel ignores the setuid bit, so
`sudo` cannot elevate at all — every invocation fails regardless of what
`/etc/sudoers.d` says. Making sudo work would mean deleting `NoNewPrivileges=true` from
the **public web service**, which is a real hardening regression traded for an operator
convenience. ISSUE-127 refuses that trade.

**polkit is the mechanism that fits.** `systemctl start` as a non-root user is a D-Bus
call to PID 1, authorized by polkit. It needs no setuid binary, so it works unchanged
under `NoNewPrivileges=true`, and `deploy/afldb.service` is **not modified by this issue
at all**. The grant is expressed as one rule scoped to:

- one action — `org.freedesktop.systemd1.manage-units`
- one verb — `start`
- one unit — `afldb-settle-afltables.service`
- one user — `arm`

That is the minimum possible permission: it cannot start, stop, restart, enable or
disable any other unit, and it grants no shell and no root.

`systemctl show` is a **read-only** D-Bus call that every local user may make. Status
reads therefore need no permission at all and are never privileged.

**Rejected alternatives**, recorded so they are not re-proposed:

| Alternative | Why not |
|---|---|
| `sudo systemctl start …` via `/etc/sudoers.d` | Impossible under `NoNewPrivileges=true`; would require weakening the web unit |
| A `systemd.path` unit watching a trigger file | Needs a new writable path added to **both** hardened units and an `ExecStartPre` deletion of the flag or the path unit re-fires in a loop. More moving parts, more hardening surface, no benefit |
| Running the chain in-process from Next.js | Forbidden by the brief and by ISSUE-122 §19 — it would be a second ingestion implementation |
| A general command runner | Explicitly forbidden |

---

## 5. Security boundary [BUILT]

`src/lib/acquisition/settle-trigger.ts` is the only place the application touches the
host. Its contract:

1. **No shell.** `node:child_process.execFile` with an argv **array**. There is no
   `exec()`, no template string, no `shell: true`.
2. **No user input, at all.** Every argv element is a module-level `const` string
   literal. Both Server Actions declare **zero parameters** and the panel calls them
   directly rather than binding them to a form, so there is no `FormData` in the picture
   at all: a field named `unit`, `season`, `label`, `args` or `force` has nowhere to go.
   This is structural, not a convention a later edit could quietly break.
3. **Fail closed.** The trigger is inert unless `AFLDB_SETTLE_TRIGGER` is exactly
   `systemd`. Unset, empty or any other value ⇒ `unavailable`, no process is spawned,
   and the UI says so.
4. **No credentials cross the boundary.** The child inherits the web service's
   environment, which `deploy/afldb.service:34` has already stripped of
   `AFLDB_IMPORT_DATABASE_URL` and every other writing DSN. The settle unit gets its own
   DSN from its own `EnvironmentFile=`, in its own process, as it always has.
5. **Bounded output.** Only the fixed `systemctl show` properties are parsed. `stderr`
   is normalised to a single line and truncated to 300 characters. The journal is never
   read, and no filesystem path, DSN or environment value is ever returned.
6. **Bounded time.** Both calls use a 10 s `execFile` timeout. `--no-block` means the
   start call returns as soon as systemd has queued the job, so the HTTP request never
   waits on an hour-long run.

---

## 6. Concurrency [BUILT]

**The lock is systemd's, not the application's.** `afldb-settle-afltables.service` is a
single system unit. systemd merges a start job for a unit that already has one into the
existing job; it does not run `ExecStart` twice. That holds equally for a second Super
Admin clicking the button, for a click landing while the 04:30 timer run is still going,
and for a click landing while an operator's manual `systemctl start` is running. There is
no application-memory lock, and there is nothing for a second web worker or a second
host process to race.

The application additionally **reads** `ActiveState` before starting so it can answer
`already running` instead of silently doing nothing. That pre-check is advisory and
narrowly racy — two clicks in the same instant can both read `inactive`. That race can
only affect the **message**, never the safety property: systemd still runs the chain
once. This is stated plainly in the module comment rather than papered over.

---

## 7. Failure behaviour — inherited unchanged [CONFIRMED]

ISSUE-127 changes no failure semantics, because it starts the same unit the timer starts:

- A failed acquisition leaves no manifest, so no consumable snapshot exists; the
  adjudicator refuses and PostgreSQL is never opened
  (`deploy/afldb-settle-afltables.sh`, `cleanup_partial`).
- A failed settle rolls the whole transaction back, `import_batches` row included
  (`settle-afltables.ts:1326-1331`).
- No Squiggle/Kali fallback is invoked, and since ISSUE-122 §11.2 neither can write
  canonically at all.
- No force flag, no bypass flag, no manual ownership override, no machine
  `promotion_decisions`, no partial canonical write outside the transactional path.

The admin surface exposes **no argument that could alter any of this**. The only thing it
can express is "run the approved chain now".

---

## 8. Operator result — the structured source [BUILT]

`src/db/queries/settle-runs.ts` reads the **latest `import_batches` row written by
`settle-afltables.ts`**, on the read-only app pool, and projects a fixed whitelist of
counters out of `validation_result`. **No journal text is scraped**, because a structured
repository source already exists.

Surfaced: snapshot label and season (parsed from `notes`), batch id, status, started/
completed timestamps, records read/rejected, and — from `validation_result` —
`canonicalRowsInserted`, `canonicalRowsUpdated`, `canonicalApplicationsLogged`,
`canonicalApplyRefusals`, `canonicalApplyFailures`, unresolved identity (the sum of the
four `unresolvedIdentity*` counters), `advisoryDisagreement`, `derivedRecomputeRuns` and
`derivedRecomputePlayers`.

**Start + status, not a held request.** The start action returns as soon as systemd has
queued the job, carrying the batch id that was latest *before* the start. The panel then
refreshes on demand: while the unit is `activating` it reports **running**; when the unit
goes idle a batch whose id exceeds the pre-start id is **this run's** result. A run that
committed nothing (out of season, or nothing new upstream) leaves the id unchanged, and
the panel says so rather than inventing a result.

Deliberate honesty about the gap: the settle's `import_batches` row is written **inside**
the run's transaction, so it is invisible until the run commits. During a run there is
nothing to read but the *previous* batch — which is why the unit state and the batch are
reported as two separate, separately-labelled facts.

---

## 9. Files [BUILT]

| File | Change |
|---|---|
| `src/lib/acquisition/settle-trigger.ts` | **new** — the entire host boundary: fixed argv, fail-closed config gate, bounded parse |
| `src/db/queries/settle-runs.ts` | **new** — latest settle `import_batches` row + whitelisted counters, app pool |
| `src/app/admin/current-season/actions.ts` | added `startSettleRunAction` and `refreshSettleRunStatusAction`; both `requireSuperAdmin()` first, neither reads `formData` |
| `src/app/admin/current-season/SettleRunPanel.tsx` | **new** — the compact control and its result table |
| `src/app/admin/current-season/page.tsx` | renders the panel above the deprecated fallback diagnostics |
| `deploy/afldb-settle-afltables-trigger.rules` | **new** — the polkit rule, one action / one verb / one unit / one user |
| `docs/deployment.md` | §7b "On-demand refresh from the admin surface"; `AFLDB_SETTLE_TRIGGER` added to §9 |
| `tests/admin-current-season-settle.test.ts` | **new** — the focused suite |
| `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` | tracking |

**Not changed:** `deploy/afldb.service`, `deploy/afldb-settle-afltables.service`,
`deploy/afldb-settle-afltables.timer`, `deploy/afldb-settle-afltables.sh`,
`src/lib/acquisition/settle-afltables.ts`, `src/lib/acquisition/canonical-apply.ts`,
`src/lib/external-afl/current-season-import.ts`, any migration, `privileges.sql`.

---

## 10. Test plan and evidence [BUILT]

`tests/admin-current-season-settle.test.ts`. A new file rather than an extension of
`tests/current-season-import.test.ts` because the module-level `vi.mock()` calls this
suite needs (`@/lib/auth/session`, `@/lib/acquisition/settle-trigger`,
`@/db/queries/settle-runs`) apply to a whole file and would rewrite the 4,000-line
existing suite's boundaries. It follows the shape of
`tests/admin-nl-search-actions.test.ts`, which is this repository's established home for
DB-free Server Action contract tests.

The host boundary is mocked. **No test launches systemd, R, Python or fitzRoy.**

Results are recorded in §12.

---

## 11. Deployment prerequisite

Two host steps, both documented in `docs/deployment.md` §7b. **Until both are done the
control is inert and says so** — nothing fails, and nothing half-works:

1. Install `deploy/afldb-settle-afltables-trigger.rules` as
   `/etc/polkit-1/rules.d/50-afldb-settle-afltables.rules` (requires `polkitd`).
2. Set `AFLDB_SETTLE_TRIGGER=systemd` in `.env` and restart `afldb`.

Neither the timer cadence nor any unit file changes. Production is not modified by this
session.

---

## 12. Implementation log

### 2026-09-03 — implementation (Opus 5 (1M) / Medium / Normal, `codex/issue-127`, base `a9feb22`)

Built exactly §5–§9. No deviation from the design above.

**Validation — every command run in this worktree.**

| Check | Command | Result |
|---|---|---|
| Focused suite | `npx vitest run tests/admin-current-season-settle.test.ts` | **28/28 passed**, 1 file, 0.27 s |
| Related suites | `npx vitest run tests/current-season-import.test.ts tests/auth.test.ts tests/admin-nl-search-actions.test.ts tests/admin-settings-actions.test.ts` | **4 files, 259/259 passed**, 1.46 s |
| Typecheck | `npx tsc --noEmit` | clean, no output |
| Lint | `npx eslint` over the 7 changed/added TS/TSX files | clean — 0 errors, 0 warnings |
| Whitespace | `git diff --check` | clean |
| Build | `npx next build --webpack` | **compiled successfully (19.5 s) and TypeScript passed (12.4 s)**, which is what validates the `'use server'` export and RSC-boundary constraints. It then stops at page-data collection with `DATABASE_URL is not set` on `/aflw/clubs` and `/advanced-search` — pre-existing pages this issue does not touch, failing on a worktree with no `.env`. Not a code defect and not evidence of one |

**What the 28 focused tests prove.** Super admin can invoke; an ordinary admin cannot; an
unauthenticated visitor cannot; the status refresh carries the same guard; neither action
declares a parameter (asserted at runtime via `.length`, on top of the compile-time
impossibility) and the host boundary is called with no arguments; a concurrent run is refused with
`already-running` and starts nothing; every non-idle systemd `ActiveState` counts as running;
`unavailable` is mapped distinctly from `error`; child output is bounded, single-lined and
truncated; a `systemctl show` property that was not asked for cannot leak through; the counter
projection is a whitelist that sums the four unresolved-identity counters and drops a filesystem
path planted in the jsonb; "no counters" is distinguished from "counters of zero"; the audit row
carries exactly `{unit, outcome, batchIdAtStart}` and is written for a failed start too; the
scheduled unit name is unchanged; and the Squiggle/Kali action still hardcodes
`insertMissingMatches: false` even when the form asks for `insertMissingMatches` and `force`;
and a start still succeeds, with a null correlation id and no leaked error text, when the
pre-start batch read fails.
The host boundary is mocked throughout — nothing launches systemd, R, Python or fitzRoy.

**Deviations from the plan, and why.** Two, both recorded rather than smoothed over:

1. The Server Actions were first written with the `useActionState` `(previous, formData)`
   signature, with a comment saying `formData` is never read. That was downgraded to **zero
   parameters** on both actions, and the panel now calls them directly instead of binding them to
   a form. A comment promising not to read an argument is weaker than not having the argument,
   and eslint's `no-unused-vars` was flagging the unread parameters — the fix and the stronger
   guarantee were the same change.
2. `tests/admin-current-season-settle.test.ts` mocks `@/db/client` and partially mocks
   `@/db/queries/settle-runs`, because the pure projection helpers live beside the query that
   uses them and importing them otherwise constructs the app pool. The suite touches no
   database.
3. The pre-start correlation read was narrowed from `readSettleRunStatus()` to
   `getLatestSettleRun()`. The wider call re-read the systemd unit for no reason — the start
   path was making three `systemctl show` calls per press where one suffices before the start.

**Not run, deliberately.** No integration suite, no NL corpus, no release-gate suite, no
production or `afldb_dev` command. This issue adds no schema, no privilege change and no query
against a table that was not already app-readable, so there is nothing for a database gate to
prove that the focused suite does not. `npm run build` was run once for the RSC-boundary check
described above and is not part of the routine verification for this change.

**Repository state at close of session.** All work is uncommitted on `codex/issue-127`. Nothing
was committed, pushed, merged or deployed, and no production or `afldb_dev` state was touched.
