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

---

## 13. Host validation — dev (`streamanator`), 2026-09-04

Opus 5 / High / Normal, worktree `D:\dev\afldb-issue-127`, branch `codex/issue-127`,
worktree fast-forwarded to `main` (`e8ec4cf`); the ISSUE-127 implementation commit is
already an ancestor of `main`. **No repository code, test, unit file, migration or
`privileges.sql` change was made in this session** — the closeout is tracking only.

### 13.1 State observed before any host write [CONFIRMED]

| Fact | Observed |
|---|---|
| Deployed revision | `169d738` on `main`; `settle-trigger.ts`, `settle-runs.ts`, `SettleRunPanel.tsx` and the `.rules` file all present, and `AFLDB_SETTLE_TRIGGER` compiled into `.next/server/app/admin/current-season/page.js` |
| `afldb` | `active`/`running`, `NoNewPrivileges=yes`, `RestrictSUIDSGID=yes` — §4's premise re-confirmed on the live unit, so sudo is still impossible and polkit is still the only mechanism |
| Settle **service** | installed, `diff -q` **identical** to `deploy/afldb-settle-afltables.service`, no drop-in directory; state `failed` (exit 2) left over from the `AFLDB-ISSUE-130` Stage 3 validation of 2026-09-03 16:16, not from anything in this issue |
| Settle **timer** | **not installed on dev at all** — empty `FragmentPath`, empty `UnitFileState`, `systemctl list-timers --all` lists no afldb timer, and `/etc/systemd/system/` holds only `afldb.service` and `afldb-settle-afltables.service` |
| Polkit rule | already installed (proved behaviourally in §13.2; the directory is mode 700 so it could not be listed as `arm`) |
| `AFLDB_SETTLE_TRIGGER` | **not set** — the control was inert, as §11 says it is until provisioned |
| Migrations | `npm run db:status` → **0 pending** on `afldb_dev`; `084` and `085` applied, so the `AFLDB-ISSUE-128`/`-129` fix is live and a settle run here is expected to report `COMPLETE` |
| `sudo` | requires a password on dev (`sudo -n true` refused) |
| Later contract changes | `AFLDB-ISSUE-128` extended `settle-runs.ts` and `SettleRunPanel.tsx` (result projection + source-completeness verdict) and `AFLDB-ISSUE-130` changed `deploy/afldb-settle-afltables.sh`. **Neither touched `settle-trigger.ts`, the unit files or the polkit rule**, so the §4/§5 contract validated here is the one this issue shipped |

Nothing in the deployed tree contradicts §3–§9.

### 13.2 The polkit grant, exercised as `arm` [VALIDATED]

Run over a **non-interactive** SSH session as `arm` — the same uid the web service runs
as — with no tty, so no `pkttyagent` could satisfy an `auth_admin` fallback. These are
the exact calls `settle-trigger.ts` makes.

| Call | Result |
|---|---|
| `/usr/bin/systemctl show afldb-settle-afltables.service --property=…` | succeeds — status reads need no rule, as §4 states |
| `/usr/bin/systemctl start --no-block afldb-settle-afltables.service` | **exit 0 — allowed** |
| `/usr/bin/systemctl stop afldb-settle-afltables.service` | `Failed to stop …: Interactive authentication required.` — **verb scoping holds** |
| `/usr/bin/systemctl start --no-block afldb.service` | `Failed to start afldb.service: Interactive authentication required.` — **unit scoping holds** |

The grant is therefore exactly one action / one verb / one unit / one user in practice,
not merely on paper. The two denials are no-ops even had they been permitted (the settle
unit was not running; `afldb` was already active), so the negative controls could not
themselves change host state.

That authorised start ran the chain end to end: `SOURCE COMPLETENESS: COMPLETE`, unit
`Result=success`, `import_batches` **id 90** (`settle-2026-2026-09-04-1354`, season 2026,
`mode=apply`, 9823 read / 0 rejected).

**Deviation from §11 step 2.** The documented check is
`sudo -u arm /usr/bin/systemctl start …`. It was run as `arm` **directly** instead,
because dev's `sudo` needs a password. This is the stronger form of the same check: it
removes sudo from the path entirely, which is the point §4 is making.

**Not verified: the installed rule's byte content.** `/etc/polkit-1/rules.d/` is mode
`700 root`, so `arm` cannot read or list it and a content diff needs the operator. The
rule's *semantics* are proved by the three-way result above, which is a stronger
statement about behaviour than a file comparison would be.

### 13.3 Enabling the application gate [VALIDATED]

`AFLDB_SETTLE_TRIGGER=systemd` appended to `/home/arm/projects/afldb/.env` (line 46),
then `afldb` restarted **without sudo** — the unit runs as `arm` with `Restart=always`,
so `kill $(systemctl show afldb -p MainPID --value)` respawns it (12 s; `/api/health`
200; `/admin/current-season` 307 behind the auth gate). Second deviation from §11,
same cause.

Baseline immediately before the first press: latest settle batch **90**, and **zero**
`current_season.settle_triggered` rows in `auth_audit_log`.

### 13.4 The control, exercised by a Super Admin [VALIDATED]

Performed by the operator in a browser against `http://10.0.40.100:8090`; every
host-side and database-side fact below was read independently over SSH.

**Panel with the flag live.** Enabled (not the unconfigured sentence), pipeline idle,
latest run rendered as snapshot `settle-2026-2026-09-04-1354`, season 2026, batch 90,
status `completed`, 9,823 read / 0 rejected — an exact match for the row read directly
out of `import_batches`. §8's structured projection is confirmed against its source.

**Press 1 — starts the real unit.**

- Returned *"Started afldb-settle-afltables.service…"*.
- Unit `activating` from **14:05:56**; exactly one systemd job (`938838 … start running`).
- Effective `ExecStart` = `{ path=/bin/sh ; argv[]=/bin/sh /home/arm/projects/afldb/deploy/afldb-settle-afltables.sh }` — **the fixed argv, with nothing appended**. No season, label, source, force or path value reached systemd or a shell, which is §5.1/§5.2 observed rather than asserted.
- `auth_audit_log` **636**: `current_season.settle_triggered`, actor `4 / stuart.villanti@gmail.com`, detail `{"unit":"afldb-settle-afltables.service","outcome":"started","batchIdAtStart":"90"}`.
- Latest settle batch still **90** mid-run — the new run's row is inside its uncommitted transaction, exactly the gap §8 describes rather than papers over.
- Run finished 14:07:44, `Result=success`, committing batch **91** (`settle-2026-2026-09-04-1405`, 9,823 read / 0 rejected).

**Press 2 in the same tab — reached no server code. See §13.5.**

**Refresh after completion.** The panel showed batch **91**, snapshot
`settle-2026-2026-09-04-1405`, completed, 9,823 read / 0 rejected, source completeness
complete, and the "this is the run that was already recorded before the button was
pressed" caveat correctly **gone** (91 ≠ the recorded `batchIdAtStart` of 90). The
counters came from the structured `import_batches` row; the journal was never read.

**Concurrency, via a stale client.** A second tab pressed the control (run starts); the
first tab — still holding the pre-run `idle` state, so its button was still live —
pressed it 14 s later. This is precisely the scenario §6 was written for: a second Super
Admin, or a click landing during the 04:30 timer run.

- Stale tab returned *"A settle run is already in progress (activating). Nothing was started — systemd runs this unit once at a time, so a scheduled run and a manual one can never overlap."*
- `auth_audit_log` **637** `outcome: "started"`, `batchIdAtStart: "91"` at 14:16:26.70; **638** `outcome: "already-running"`, `batchIdAtStart: "91"` at 14:16:40.79.
- Exactly **one** unit lifecycle: `Starting` 14:16:26 → `Finished` 14:18:18, `NRestarts=0`, no queued jobs, one settle process.
- Exactly **one** new batch: **92** (`settle-2026-2026-09-04-1416`, 9,823 read / 0 rejected).

Three attempts, three audit rows, two ingestion transactions — the refused attempt
started nothing and committed nothing.

**Fail closed.** `AFLDB_SETTLE_TRIGGER` commented out in `.env`, `afldb` restarted, the
polkit rule deliberately **left installed** so the application gate was isolated. A full
page reload rendered the control disabled and the exact `SETTLE_TRIGGER_UNCONFIGURED`
sentence. The flag was then restored and `afldb` restarted again (health 200).

### 13.5 Deviation: §11 step 4's "second press" is unreachable in one tab

**Not a defect in either layer. The runbook's validation step was unachievable as
written, and this section is the correction.**

Observed: a second press in the *same* tab returned no new message, and the operator
reasonably read the persisting "Started…" text as a duplicate success. The host and the
database say otherwise and are decisive — **no** second audit row (and
`startSettleRunAction` writes one on *every* attempt, `already-running` included), one
unit lifecycle, `NRestarts=0`, no queued job, one batch. The Server Action never ran.

Mechanism, `SettleRunPanel.tsx:183`:

```
disabled={pending || !configured || unit?.phase === 'running'}
```

`startSettleRunAction` re-reads the unit *after* starting it (`actions.ts:180`), so the
state it hands back to the browser already carries `phase === 'running'`. The button
renders disabled and the browser swallows the click. The panel is not asserting anything
false while this is true — its Pipeline line reads *"A settle run is in progress —
activating"* — but the start message from the previous press stays on screen, which is
what invited the misreading.

The safety property is enforced three times over (client disable, server `already-running`
pre-check, systemd job merge), and the server branch is genuinely load-bearing for the
stale-client case §6 names. **The corrected procedure is §13.4's two-tab test**, which
reaches that branch and costs one settle run rather than two. `docs/deployment.md` §7b
was not amended: it documents installation, not this validation step.

Recorded, not fixed, and no issue raised: nothing behaves incorrectly, and changing the
panel's post-press feedback is a UX refinement outside this issue's scope.

### 13.6 Host state left behind

- `.env` line 46 `AFLDB_SETTLE_TRIGGER=systemd` — **the only persistent host change made
  by this session.** Revert with `sed -i '/^AFLDB_SETTLE_TRIGGER=systemd$/d' .env` and a
  restart.
- Polkit rule left installed (it was already there).
- **Timer cadence untouched, and confirmed so afterwards**: dev has never had
  `afldb-settle-afltables.timer` installed and still has not — no fragment, no unit-file
  state, nothing in `systemctl list-timers --all`. None was installed to make this
  validation possible.
- Settle service unit file still `diff -q` identical to the repo; `afldb.service` not
  touched (its pre-existing drift from `deploy/afldb.service` is `AFLDB-ISSUE-124`'s
  territory, not this issue's).
- Deployed revision unchanged at `169d738`.
- Three settle runs committed batches **90, 91, 92** to `afldb_dev` — the expected cost
  of exercising a control whose whole purpose is to run the pipeline. All three
  `completed`, 9,823 read / 0 rejected, source completeness `COMPLETE`, and all three
  canonical no-ops (0 inserted, 0 updated, 8,875 `foreign_owned_collision` refusals —
  the same pre-existing figure batch 90 carried before this session, so nothing about
  the refusal population changed).
- Scratch scripts left at `/tmp/afldb_issue127_*.sh`; nothing was written inside
  `~/projects/afldb` except the `.env` line.

### 13.7 Production

**Production is not part of ISSUE-127's acceptance and was not touched.** §11 states
"Production is not modified by this session"; `issues.md`'s Next action says "dev first,
never production while it is being tested on"; and `IssuesIndex.md` says "Operator host
validation on dev, then close". No production command of any kind was run in this
session.

For a future deployment, production needs the same two host steps from
`docs/deployment.md` §7b and nothing else: install the rules file and restart `polkit`,
then set `AFLDB_SETTLE_TRIGGER=systemd` and restart `afldb`. `afldb.service`, the settle
service and **the production timer's 04:30 cadence** are unchanged by both; until both
steps are done the control is inert and says so. That is ordinary deployment work
covered by the deployment doc, not outstanding issue work, and it sequences behind the
existing `main`-to-production deployment already tracked elsewhere.

### 13.8 Acceptance

Every §11 / `issues.md` acceptance condition is satisfied on dev, with the one procedural
correction recorded in §13.5:

1. polkit permits `arm` to start exactly `afldb-settle-afltables.service` — **yes**, and
   the same caller is refused the wrong verb and a different unit;
2. `AFLDB_SETTLE_TRIGGER=systemd` enables the control — **yes**;
3. `afldb` healthy after every restart — **yes**, three restarts, health 200 each time;
4. nightly timer cadence unchanged — **yes**, and none was created on dev;
5. a press starts the real unit — **yes**, batches 91 and 92;
6. a press during a run refuses instead of forking a second ingestion — **yes**, audit
   638 with `outcome: "already-running"`, one lifecycle, one batch;
7. counters come from the structured `import_batches` row — **yes**, matched field by
   field against the database;
8. one `current_season.settle_triggered` row per attempt — **yes**, 636/637/638 for
   three attempts;
9. no user-controlled argument reaches systemd or a shell — **yes**, the effective
   `ExecStart` argv is the fixed pair;
10. the control fails closed with the flag unset — **yes**.

**ISSUE-127 is Resolved.** No code, test, unit-file, schema or `privileges.sql` change
was required by this validation, and none was made.
