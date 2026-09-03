# AFLDB-ISSUE-130 — The settle service's R library dependency is undeclared and unvalidated

> Implementation runbook and evidence ledger.
> Session: 2026-09-03, Opus 5 / Stage 1 (investigation and design only),
> worktree `D:\dev\afldb-issue-130`, branch `claude/issue-130`, base `c958367`.
>
> Sections marked **[CONFIRMED]** are repository or host evidence verified in a session.
> Sections marked **[PROPOSED]** were Stage 1 design; **§9 records the Stage 2 implementation**
> (2026-09-03). **§10 records the Stage 3 host result: fragment/preflight proved under systemd,
> one settle-script defect found and corrected; the revised host retry is §10.6.**

---

## 1. Problem statement

On the dev host (`streamanator`) the tracked unit `afldb-settle-afltables.service` failed
immediately during step 1 of the chain:

```text
Error: Package 'jsonlite' is required: install.packages('jsonlite')
Execution halted
```

That message is `tools/rebuild/fitzroy/acquire_core.R:43`. The packages were **not** missing.
They are installed and healthy in `/home/arm/R/library`; they are simply not on the library
path that R computes under systemd.

Host evidence (operator-run, 2026-09-03):

| Condition | `jsonlite` | `fitzRoy` |
|---|---|---|
| `R_LIBS_USER=/home/arm/R/library Rscript ...` | TRUE | TRUE (1.8.0) |
| no override (`R_LIBS_USER=/home/arm/R/x86_64-pc-linux-gnu-library/4.3`, `.libPaths()` = `/usr/local/lib/R/site-library`, `/usr/lib/R/site-library`, `/usr/lib/R/library`) | FALSE | FALSE |
| `systemctl show afldb-settle-afltables.service -p Environment` | `Environment=` (empty) | — |

The service was made to work with an **untracked host drop-in**:

```ini
# /etc/systemd/system/afldb-settle-afltables.service.d/r-library.conf
[Service]
Environment=R_LIBS_USER=/home/arm/R/library
```

After `daemon-reload` the supervised settle succeeded end to end (209 matches, 9,614
player-match rows, 0 unkeyed rejections, `SOURCE COMPLETENESS: COMPLETE`, `systemctl start
exit=0`).

**The defect is that the working configuration is untracked host state.** A fresh deployment,
a re-provisioned host, or production would fail exactly the same way even with the required R
packages installed, and nothing in the repository would have said so beforehand.

---

## 2. Issue identity [CONFIRMED]

`AFLDB-ISSUE-130` is a **new** issue.

- `IssuesIndex.md:55,61,69` declares *"Next free issue ID is `AFLDB-ISSUE-130`."*
- A repository-wide grep for `ISSUE-130` across `*.md`, `*.ts`, `*.sql`, `*.py`, `*.sh`,
  `*.service` (excluding `node_modules`) returned only those three allocation-warning lines
  before this file existed.
- No open issue owns this scope. Open at the time of writing: `AFLDB-ISSUE-104`, `-110`,
  `-113`, `-116`, `-123`, `-124`, `-125`, `-126`, `-127`. `AFLDB-ISSUE-124` is the nearest
  neighbour (a different defect, in a different unit, `deploy/afldb.service`) and is **not**
  touched by this work.
- **No migration number is claimed.** ISSUE-130 adds no schema. (For the record: `084` and
  `085` are taken by `AFLDB-ISSUE-129`; the next free number is `086`.)

---

## 3. What the repository actually declares today [CONFIRMED]

| Fact | Evidence |
|---|---|
| The unit sets **no** environment beyond `.env` | `deploy/afldb-settle-afltables.service` — one `EnvironmentFile=`, one `UnsetEnvironment=`, **no `Environment=` line at all** |
| The chain resolves every other interpreter explicitly, with an env override | `deploy/afldb-settle-afltables.sh:28-37` — `RSCRIPT=${AFLDB_RSCRIPT:-/usr/bin/Rscript}`, `PYTHON=${AFLDB_PYTHON:-/usr/bin/python3}`, `NODE=${AFLDB_NODE:-/home/arm/.nvm/.../node}` |
| …but the R **library** is not resolved at all | same file — `"$RSCRIPT" tools/rebuild/fitzroy/acquire_core.R` is invoked with whatever `.libPaths()` systemd happens to produce |
| The documented library location is system-wide, **not** `$HOME` | `docs/deployment.md:443-451` — `install.packages(..., lib = "/usr/local/lib/R/site-library")`, with the stated reason: *"Installing there rather than into `~/R` keeps the library outside `$HOME`, which the unit mounts read-only, and means the service never writes to its own library at run time."* |
| The unit does mount `$HOME` read-only | `deploy/afldb-settle-afltables.service` — `ProtectHome=read-only`. **Read-only, not inaccessible**: `/home/arm/R/library` is readable, which is why the drop-in worked. |
| The R dependency is documented but never **checked** at deploy time | `docs/deployment.md:453-462` gives `Rscript -e 'cat(as.character(packageVersion("fitzRoy")), "\n")'` as a manual eyeball step in an interactive shell — which is precisely the environment that does **not** match systemd's |
| The version pin is re-checked on every run | `acquire_core.R:36-38` + `tools/rebuild/fitzroy/fitzroy-contract.json` `pinned_version` (`1.8.0`) — this half of the contract is sound and is not changed by this issue |
| The admin trigger path is covered by the same fix | `deploy/afldb-settle-afltables-trigger.rules` starts **the same unit** (`AFLDB-ISSUE-127`), so it inherits the unit's environment; no second code path exists |
| There is an established test style for deploy artefacts | `tests/current-season-import.test.ts:4191-4192` — `readSource('tools/current-season/settle-afltables.ts')` and `readSource('deploy/afldb-settle-afltables.sh')`, asserted textually in `describe('the settle CLI gate')` |

### 3.1 Root cause, stated precisely

`Rscript` under systemd computes `.libPaths()` from `R_LIBS_USER`, `R_LIBS`, the site library
and the system library. systemd does **not** source a login shell, so any `R_LIBS_USER` the
operator exports from `~/.bashrc`/`~/.profile` is absent. The host output above also shows
`R_LIBS_USER` at its *computed default* (`~/R/x86_64-pc-linux-gnu-library/4.3`), which proves
the value is **not** coming from `~/.Renviron` either — R reads `~/.Renviron` regardless of
shell, so an `.Renviron` setting would have survived into the unit.

So: the packages sit in a directory that is on nobody's default path, and the only thing that
ever put it on the path was an interactive shell setting and, later, the temporary drop-in.

**Silent-failure hazard worth naming:** R drops non-existent entries from `.libPaths()`
without a word. Any fix that merely *sets a path* is therefore not self-validating — a typo,
an R minor-version bump, or a re-provisioned host yields exactly the current failure again,
one step later. This is why §5 pairs the declaration with a preflight that fails loudly.

---

## 4. Options considered

| # | Option | Verdict |
|---|---|---|
| 1 | **Reconcile the host**: reinstall `jsonlite`/`fitzRoy` into `/usr/local/lib/R/site-library` as `docs/deployment.md` already prescribes; the repository declares no path at all. | **Sound, and the documented design.** But on its own it leaves the failure undetectable until the next nightly firing, and it does not stop the next host from repeating it. Necessary-or-not is the operator decision in §7. |
| 2 | **Declare the library in the tracked chain, configurably**: the settle script resolves an optional, documented R library and exports it, exactly as it already resolves `RSCRIPT`/`PYTHON`/`NODE`; the value for a host that legitimately differs lives in the existing `EnvironmentFile=` (`.env`), never in an untracked drop-in. | **Recommended mechanism.** No host path enters a tracked file, the default is the documented site-library layout, and the drop-in becomes unnecessary. |
| 3 | **Add a deploy-time preflight** that runs `Rscript` the way the unit will and refuses on a missing package or a pin mismatch. | **Recommended, and required by desired property #3.** This is the part that makes the declaration self-validating rather than another silent path. |
| 4 | Hard-code `Environment=R_LIBS=/home/arm/R/library` into the tracked unit. | **Rejected.** It is host-specific, it contradicts `docs/deployment.md:448-451`, and on a host without that directory R would drop it silently — the tracked file would then *look* like it declares the dependency while doing nothing. |
| 5 | Fix it host-side with `~/.Renviron` instead of a drop-in. | **Rejected.** It works (R reads it under systemd) but it is the same class of defect: undocumented, untracked, per-host state that a rebuild loses. |
| 6 | Have the settle chain install the packages if missing. | **Rejected** — desired property #5, and it would need a writable library inside a unit whose `$HOME` is deliberately read-only. |

Recommendation is **2 + 3**, with **1** as the operator's host action so that streamanator
stops relying on a non-default location at all. 2 + 3 are what make the *next* host safe;
1 is what makes *this* host match its own documentation.

---

## 5. Proposed implementation [PROPOSED at Stage 1 — IMPLEMENTED at Stage 2, see §9]

### 5.1 `deploy/afldb-r-env.sh` (new, tracked, mode 644)

A side-effect-free `sh` fragment, sourced — not executed — by both consumers, so the two can
never drift:

- resolves `RSCRIPT=${AFLDB_RSCRIPT:-/usr/bin/Rscript}` (moved here from the settle script);
- if `AFLDB_R_LIBS` is non-empty, **prepends** it to `R_LIBS` and exports:
  `R_LIBS="$AFLDB_R_LIBS${R_LIBS:+:$R_LIBS}"; export R_LIBS`;
- default is unset, i.e. the documented `/usr/local/lib/R/site-library` layout needs **no**
  configuration and behaves exactly as today.

`R_LIBS` is chosen over `R_LIBS_SITE` deliberately: `R_LIBS` is *additive* to `.libPaths()`,
while setting `R_LIBS_SITE` **replaces** Debian's site-library entries and would hide
`r-cran-*` packages installed by `apt` — the very packages `docs/deployment.md:424-432`
installs. It is chosen over `R_LIBS_USER` — the variable the temporary drop-in used — for the
same reason: `R_LIBS_USER` names *the* user library rather than adding to the search path.
Both were verified to work on the host; `R_LIBS` is the one that cannot displace anything.

### 5.2 `deploy/afldb-r-preflight.sh` (new, tracked, mode 644)

Run as `sh deploy/afldb-r-preflight.sh` from the project root, and (per §5.5) from the
documented deployment procedure **before** the timer is enabled. It sources
`deploy/afldb-r-env.sh`, so it exercises the same resolution the unit will, then in one
`Rscript` call reports and gates on:

- `R.version.string` and the effective `.libPaths()`;
- `requireNamespace("jsonlite")`, `requireNamespace("digest")`, `requireNamespace("fitzRoy")`;
- the installed fitzRoy version against `pinned_version` read from
  `tools/rebuild/fitzroy/fitzroy-contract.json` — **read, never hard-coded**; `acquire_core.R`
  stays the authority on the pin and this script only reports the same comparison earlier.

Exit non-zero, with the missing package named and the effective `.libPaths()` printed, on any
failure. It performs no network access, opens no database, installs nothing and writes nothing.

To satisfy desired property #10 the script's own output *is* the operator validation for all
four required facts (effective library path, `jsonlite`, `fitzRoy` + version, and — via
`systemd-run` in §5.5 — the service execution environment).

### 5.3 `deploy/afldb-settle-afltables.sh` (edit)

One change only: source `deploy/afldb-r-env.sh` after `cd "$PROJECT_ROOT"` and before step 1,
and delete the now-duplicated `RSCRIPT=` line. The three-step chain, the label, the season
gate, the cleanup trap, the flags and the exit semantics are **unchanged**.

**Open sub-decision (recorded, low stakes, Stage 2 may settle it):** whether the settle script
should also *call* the preflight before step 1. Recommendation: **no**. `acquire_core.R`
already fails closed on both a missing package and a pin mismatch, so a preflight call would
buy a slightly clearer message at the cost of a second R startup on every nightly firing and a
second place that can fail. The preflight's job is to fail at *deploy* time.

### 5.4 `deploy/afldb-settle-afltables.service` (no functional change)

Deliberately **not** modified — no `Environment=` line is added, so §4 option 4 is not
introduced by the back door, hardening is untouched (property #6) and `TimeoutStartSec=3600`
and every other semantic is preserved (property #8). A comment pointing at
`deploy/afldb-r-env.sh` is the only candidate edit, and even that is optional.

If Stage 2 finds a reason the value cannot travel through `.env`, the fallback is a **tracked**
drop-in file installed by a documented `install -m 644` step — never a hand-written one. That
fallback is not currently believed necessary.

### 5.5 `docs/deployment.md` (edit, §7b "R and the pinned fitzRoy")

- state plainly that `/usr/local/lib/R/site-library` **is** the canonical library, and why
  (outside the read-only `$HOME`, no run-time writes, on `.libPaths()` by default);
- state that a host whose packages live elsewhere must declare `AFLDB_R_LIBS` in `.env`, and
  that a hand-written `/etc/systemd/system/*.service.d/` drop-in is **not** an acceptable
  substitute because it is invisible to every deployment;
- add `sh deploy/afldb-r-preflight.sh` as a **mandatory** step in "Supervised validation, in
  escalation order", replacing the current interactive-shell eyeball at steps 1-2 — the
  existing step is misleading precisely because an interactive shell is not the failing
  environment;
- add the service-environment check, which is the one fact the preflight cannot prove from a
  login shell:

  ```bash
  systemctl show afldb-settle-afltables.service -p Environment
  sudo systemd-run --uid=arm --gid=arm --pty \
    --working-directory=/home/arm/projects/afldb \
    /bin/sh deploy/afldb-r-preflight.sh
  ```

- record that the temporary `r-library.conf` drop-in must be removed once the tracked fix is
  deployed (property #9), with the exact `rm` + `daemon-reload` + `systemctl show` sequence.

### 5.6 `tests/current-season-import.test.ts` (extend — no new test file)

Extended in the established style (`readSource` + textual assertions), as a new
`describe('the R runtime declaration')` beside `describe('the settle CLI gate')`:

1. the settle script sources `deploy/afldb-r-env.sh` **before** it invokes `$RSCRIPT`, and no
   longer defines `RSCRIPT=` itself;
2. `afldb-r-env.sh` exports `R_LIBS` **additively** (`${R_LIBS:+:$R_LIBS}`), never assigns
   `R_LIBS_SITE`, and contains no `/home/` or other absolute host-specific library path;
3. the preflight names `jsonlite`, `digest` and `fitzRoy`, prints `.libPaths()`, reads
   `pinned_version` from `fitzroy-contract.json` rather than hard-coding a version, exits
   non-zero on failure, and contains no `install.packages` (property #5);
4. the service unit still carries the full hardening set (`NoNewPrivileges=true`,
   `ProtectSystem=strict`, `ProtectHome=read-only`, `RestrictAddressFamilies=…`,
   `SystemCallFilter=@system-service`) and `TimeoutStartSec=3600`, and declares **no**
   `Environment=` host path — the regression guard for properties #6, #8 and §4 option 4;
5. `docs/deployment.md` names `AFLDB_R_LIBS` and the preflight script (so the mechanism cannot
   ship undocumented — property #4).

Operator-run shell validation, in addition: `sh -n deploy/afldb-r-env.sh`,
`sh -n deploy/afldb-r-preflight.sh`, `sh -n deploy/afldb-settle-afltables.sh`.

### 5.7 Files this issue expects to touch

```text
deploy/afldb-r-env.sh                    (new)
deploy/afldb-r-preflight.sh              (new)
deploy/afldb-settle-afltables.sh         (edit — source the fragment; drop one line)
docs/deployment.md                       (edit — §7b)
tests/current-season-import.test.ts      (extend — one new describe)
issues.md / IssuesIndex.md / CHANGELOG.md (tracking; CHANGELOG at Stage 2, not before)
```

No application code, no schema, no query, no admin surface, no production or streamanator
change from this worktree.

---

## 6. What this issue does NOT do

- It does not change the settle chain's steps, flags, season gate, label scheme, exit codes or
  timeout.
- It does not touch `deploy/afldb-settle-afltables.service`'s hardening, its `EnvironmentFile`
  or its `UnsetEnvironment` list, and adds no secret anywhere (property #7).
- It does not install or upgrade R packages, at deploy time or at run time (property #5).
- It does not touch `AFLDB-ISSUE-124`'s `deploy/afldb.service` defect, the `AFLDB-ISSUE-127`
  polkit rule, or the `AFLDB-ISSUE-128`/`-129` completeness and Wildcard work.
- It does not modify streamanator or production.

---

## 7. Decision required before Stage 2 [TAKEN — see §9.1]

Everything in §5 is settled **except** one question that is the operator's, not the
repository's:

> **Is `/home/arm/R/library` the intended library on streamanator, or should streamanator be
> reconciled to the documented `/usr/local/lib/R/site-library`?**

- If **reconcile** (recommended): the host reinstall follows `docs/deployment.md:424-446`
  unchanged, `AFLDB_R_LIBS` stays unset everywhere, and the tracked mechanism exists as the
  declared, tested escape hatch for a host that genuinely differs. The temporary drop-in is
  deleted and nothing replaces it.
- If **keep `/home/arm/R/library`**: `AFLDB_R_LIBS=/home/arm/R/library` is added to
  streamanator's `.env` (untracked, host-specific — the correct home for a host-specific
  value), the drop-in is deleted, and `docs/deployment.md` records that dev and production
  use different library locations and why.

Either answer leaves §5's implementation identical. The answer only decides the host action
and one paragraph of documentation, so Stage 2 can begin on the repository work as soon as it
is given.

**Also to be confirmed by the operator at Stage 2 (host facts this worktree cannot see):**
production's actual R library location and whether production's fitzRoy is on the default
`.libPaths()` — i.e. whether production is latently exposed to the same failure or was
installed per the documented procedure. The `AFLDB-ISSUE-122` closeout records only "R 4.3.3 +
fitzRoy 1.8.0 installed and pinned" on production, not *where*.

---

## 8. Stage 1 state and exact next action (superseded by §9)

**Stage 1 (investigation and design) is COMPLETE.** Stage 2 has since implemented it — see §9.

Repository files changed by Stage 1: `issues/open/AFLDB-ISSUE-130.md` (this file),
`issues.md`, `IssuesIndex.md`. No code, no deploy artefact, no test, no `CHANGELOG.md` entry
(correctly — Stage 1 changed no behaviour).

**Exact next action — Stage 2, fresh session, carry-over this file:**

1. Take the §7 decision from the operator (one line; it does not change the code).
2. Implement §5.1-§5.3 and §5.5-§5.6 exactly as written; do not broaden.
3. Operator runs: `sh -n` on the three shell files, then
   `npx vitest run tests/current-season-import.test.ts`.
4. Operator, on streamanator only, in this order: apply the §7 host action → deploy the
   tracked change → `rm /etc/systemd/system/afldb-settle-afltables.service.d/r-library.conf`
   (and the now-empty directory) → `systemctl daemon-reload` →
   `sh deploy/afldb-r-preflight.sh` → `systemctl start afldb-settle-afltables.service` and
   confirm the chain still completes with `SOURCE COMPLETENESS: COMPLETE`.
5. Only after step 4 passes with the drop-in **absent**, update `CHANGELOG.md` (Unreleased) and
   close the issue.

Production deployment is **not** authorised by this issue and is separate work; note that
`AFLDB-ISSUE-128`/`-129` are already queued ahead of it for the same host.

---

## 9. Stage 2 — implementation [CONFIRMED]

> Session: 2026-09-03, Fable 5.1 / Stage 2, same worktree and branch, on top of the Stage 1
> tracking commit `98ebcc0`. Everything in §5 is now **implemented**; §5 is retained above as
> the design record and this section records what was actually built and proved.

### 9.1 Operator decision taken (closes §7)

- **`/usr/local/lib/R/site-library` is AFLDB's canonical supported R library on every deployed
  Linux host.** `docs/deployment.md` now says so in those words.
- streamanator's `/home/arm/R/library` is a **temporary host deviation** to be reconciled
  (packages reinstalled into the canonical library per `docs/deployment.md` §7b) after this
  tracked fix is deployed — Stage 3, §9.6.
- `AFLDB_R_LIBS` remains an optional, explicit escape hatch for a nonstandard host. It is not
  required by, and does not appear in, the normal documented installation.

### 9.2 What was built

| File | Change |
|---|---|
| `deploy/afldb-r-env.sh` | **new**, sourced fragment. `RSCRIPT=${AFLDB_RSCRIPT:-/usr/bin/Rscript}`; when `AFLDB_R_LIBS` is non-empty it **requires the directory to exist** (`[ ! -d ]` → message on stderr naming the canonical library → `exit 1`, which aborts the sourcing caller), then `R_LIBS="$AFLDB_R_LIBS${R_LIBS:+:$R_LIBS}"; export R_LIBS`. Never assigns `R_LIBS_SITE` or `R_LIBS_USER`; contains no `/home/` path; installs nothing. |
| `deploy/afldb-r-preflight.sh` | **new**. Resolves the project root from its own location (or `AFLDB_PROJECT_ROOT`), sources the fragment, checks `Rscript` resolves, then runs **one** `Rscript -` process (program on stdin; the contract path and `AFLDB_R_LIBS` travel as environment, nothing is interpolated into R code) that prints `R.version.string`, `R_HOME`, the `R_LIBS`/`R_LIBS_USER`/`R_LIBS_SITE` R saw, the effective `.libPaths()` in order; **warns** if `~/.Renviron` exists; verifies a configured `AFLDB_R_LIBS` is actually in `.libPaths()` (normalised comparison); reports `jsonlite`/`digest`/`fitzRoy` as version + resolving library or `MISSING`; compares installed fitzRoy with `pinned_version` **read from `fitzroy-contract.json`** using the same `identical()` as `acquire_core.R`. Every failure is collected and listed under `R PREFLIGHT: FAILED`, exit 1; otherwise `R PREFLIGHT: OK`, exit 0. No install, no write, no network, no database. |
| `deploy/afldb-settle-afltables.sh` | the `RSCRIPT=` line replaced by a comment; `. deploy/afldb-r-env.sh` sourced immediately after `cd "$PROJECT_ROOT"`, before the season gate, label, trap and step 1. Steps, flags, label scheme, trap, `set -eu` and exit semantics unchanged. |
| `deploy/afldb-settle-afltables.service` | **untouched** (verified by test: no `Environment=` line, full hardening set, `TimeoutStartSec=3600`, `UnsetEnvironment` boundary). |
| `docs/deployment.md` §7b | canonical-library statement; new "Where the unit looks for the library" subsection (`AFLDB_RSCRIPT`, `AFLDB_R_LIBS` additive + must-exist, drop-in and `~/.Renviron` rejected as substitutes); "Verify the runtime" replaces the interactive eyeball with (1) `sh deploy/afldb-r-preflight.sh`, (2) the service-equivalent `systemd-run` command, (3) `systemctl show … -p Environment`; a "Removing an untracked drop-in" block; escalation steps 1-2 now run the preflight. §9 configuration table gains `AFLDB_R_LIBS` and `AFLDB_RSCRIPT` rows. |
| `tests/current-season-import.test.ts` | new top-level `describe('AFLDB-ISSUE-130 — the R runtime declaration')`, 18 assertions in the existing `readSource` style covering §5.6 items 1-5 plus: the fragment's must-exist refusal, the preflight's `.libPaths()` membership check and `~/.Renviron` warning, and that the contract's actual `pinned_version` string (read from the JSON at test time) does **not** appear in the preflight. |

**Sub-decision from §5.3 settled as recommended:** the settle script does *not* call the
preflight on every firing; `acquire_core.R` already fails closed on both conditions.

**Service-equivalent validation command (desired property #10, safety item 6).** The unit's
own environment is reproduced with `systemd-run` and the unit's properties rather than a login
shell: `User`/`Group=arm`, `WorkingDirectory`, `EnvironmentFile=/home/arm/projects/afldb/.env`
(so `AFLDB_R_LIBS` from `.env` applies), `ProtectHome=read-only`, `ProtectSystem=strict`,
`PrivateTmp`, `NoNewPrivileges`, with `--wait --pipe --collect` so the exit status is the
preflight's own and the transient unit is unloaded afterwards. Exact command in §9.6 / docs.

### 9.3 Deviations from §5 (all additive, none contradicting the approved design)

1. The preflight is runnable from any directory (resolves its own root) rather than only
   "from the project root"; the documented invocation is unchanged.
2. The preflight does **not** pass `--vanilla`/`--no-environ`: the unit does not either, so it
   reads exactly the startup files the unit would. Instead it prints the `R_LIBS*` environment
   and **warns** when `~/.Renviron` exists, which is how requirement 4 (supported path must not
   depend on interactive startup files) is made visible without diverging from the unit.
3. The fragment aborts with `exit 1` (not `return`), deliberately: it is only ever sourced, and
   a caller that cannot see its library must stop before a label or a network fetch exists.
4. `docs/deployment.md` §9 (configuration table) was also touched — two rows — because that
   table is where every `.env` variable is listed.
5. The tests are a new top-level `describe` at the end of the file rather than nested inside
   the ISSUE-128 block; same file, same style.
6. `.env.example` was **not** changed: it does not list the other settle overrides
   (`AFLDB_RSCRIPT`, `AFLDB_SETTLE_TRIGGER`) either, and the variable must not look required.

### 9.4 Validation evidence (Windows worktree, 2026-09-03)

| Check | Result |
|---|---|
| `sh -n` on `afldb-r-env.sh`, `afldb-r-preflight.sh`, `afldb-settle-afltables.sh` | all OK |
| `git diff --check` | clean |
| `npx vitest run tests/current-season-import.test.ts` | **246 passed** (18 new ISSUE-130 + 228 existing), 0 failed |
| `npx eslint tests/current-season-import.test.ts` | clean |
| Preflight executed for real with the local R 4.6.1 (`AFLDB_RSCRIPT` pointed at it), `AFLDB_R_LIBS` unset | ran end to end: printed version, env, `.libPaths()`, `jsonlite 2.0.0` + `fitzRoy 1.8.0` with their library dirs, `fitzRoy pin: installed 1.8.0 == contract pinned_version 1.8.0: OK`, then `R PREFLIGHT: FAILED` / exit 1 because `digest` is genuinely absent on this Windows box — the correct verdict. Proves `Rscript -` (stdin), the contract read, and the failure/exit path. |
| Preflight with `AFLDB_R_LIBS=/nonexistent/rlib` | fragment refused before R started, four-line stderr message, exit 1 |
| Preflight with `AFLDB_R_LIBS=<existing empty dir>` | `R_LIBS` set, dir first in `.libPaths()`, `AFLDB_R_LIBS is on the effective .libPaths(): OK` |

Incidental confirmation of §3.1's hazard: on the Windows box `R_LIBS_SITE` names a directory
that does not exist and it is absent from `.libPaths()` — R dropped it without a word.

Environment note: the worktree had no `node_modules`; a gitignored NTFS junction to the
`afldb-issue-129` worktree's `node_modules` was created to run vitest. It is untracked and
can be deleted at any time.

**Not proved here (Linux-only, Stage 3):** the preflight under systemd on streamanator, the
supervised settle with the drop-in absent, and production's library location.

### 9.5 Tracking

- `CHANGELOG.md` is deliberately **not** updated yet — per §8 step 5 it is written when the
  host validation passes with the drop-in absent and the issue closes.
- `issues.md` entry and Open Issues row, and `IssuesIndex.md`, updated to "Stage 2 complete;
  awaiting Stage 3 host validation".
- streamanator and production were **not** modified.

### 9.6 Exact next action — Stage 3, streamanator only, in this order

Precondition: `claude/issue-130` merged/deployed to the dev host's checkout by the normal
`git pull` deploy so that `deploy/afldb-r-env.sh` and `deploy/afldb-r-preflight.sh` exist in
`/home/arm/projects/afldb`.

```bash
cd ~/projects/afldb

# A. host reconciliation (the §9.1 decision): put the packages where the docs say.
#    apt part and the dated Posit snapshot exactly as docs/deployment.md §7b.
sudo apt-get install -y --no-install-recommends r-cran-jsonlite r-cran-digest
sudo Rscript -e 'install.packages("fitzRoy",
  repos = "https://packagemanager.posit.co/cran/__linux__/noble/2026-09-01",
  lib   = "/usr/local/lib/R/site-library")'

# B. remove the stop-gap drop-in and prove the unit declares nothing itself
sudo rm /etc/systemd/system/afldb-settle-afltables.service.d/r-library.conf
sudo rmdir /etc/systemd/system/afldb-settle-afltables.service.d
sudo systemctl daemon-reload
systemctl show afldb-settle-afltables.service -p Environment     # must print: Environment=

# C. preflight, interactive then service-equivalent; both must end R PREFLIGHT: OK
sh deploy/afldb-r-preflight.sh
sudo systemd-run --wait --pipe --collect --unit=afldb-r-preflight \
  -p User=arm -p Group=arm \
  -p WorkingDirectory=/home/arm/projects/afldb \
  -p EnvironmentFile=/home/arm/projects/afldb/.env \
  -p ProtectHome=read-only -p ProtectSystem=strict -p PrivateTmp=true \
  -p NoNewPrivileges=true \
  /bin/sh /home/arm/projects/afldb/deploy/afldb-r-preflight.sh

# D. one supervised run with the drop-in ABSENT
sudo systemctl start afldb-settle-afltables.service; echo "exit=$?"
journalctl -u afldb-settle-afltables --since -15min | grep -E 'settle chain complete|SOURCE COMPLETENESS|Error|Refusing'

# E. (read-only, on afldb-prod) where production's fitzRoy actually lives
Rscript -e 'cat(dirname(system.file(package="fitzRoy")), "\n"); print(.libPaths())'
```

Expected: step C prints `fitzRoy` resolving from `/usr/local/lib/R/site-library` in **both**
runs; step D exits 0 with `SOURCE COMPLETENESS: COMPLETE`. If step D still fails at step 1
with the drop-in absent, the preflight output from C is the evidence to bring back. Only after
D passes: `CHANGELOG.md` (Unreleased) entry and close the issue. `/home/arm/R/library` may then
be left in place or removed; nothing tracked references it.

---

## 10. Stage 3 host validation — one defect found, corrected [CONFIRMED]

> Session: 2026-09-03, Fable 5.1 / Stage 3 correction, same worktree and branch, on top of
> the Stage 2 commit `d2d2353`. streamanator and production were **not** modified from this
> session.

### 10.1 What Stage 3 proved before the failure

On streamanator the branch was checked out as a worktree at
`/home/arm/projects/afldb-issue-130` (commit `d2d2353`) and §9.6 steps A–C were completed:

- host reconciled to the canonical layout: `jsonlite` 1.8.8 and `digest` 0.6.34 in
  `/usr/lib/R/site-library`, `fitzRoy` 1.8.0 in `/usr/local/lib/R/site-library`;
- the temporary `R_LIBS_USER` drop-in removed; `systemctl show … -p Environment` prints
  `Environment=`;
- the preflight ended `R PREFLIGHT: OK`, exit 0, **both** interactively and under
  `systemd-run` with the unit's properties.

So the R-runtime declaration itself (fragment + preflight) is proved on Linux under systemd.

### 10.2 The failure (step D, supervised settle from the worktree)

The supervised run was pointed at the worktree copy:

```text
ExecStart=/bin/sh /home/arm/projects/afldb-issue-130/deploy/afldb-settle-afltables.sh
WorkingDirectory=/home/arm/projects/afldb-issue-130
```

and died before the season gate:

```text
/home/arm/projects/afldb-issue-130/deploy/afldb-settle-afltables.sh: 48:
.: cannot open deploy/afldb-r-env.sh: No such file
```

`sh -x` shows why:

```text
+ PROJECT_ROOT=/home/arm/projects/afldb
+ cd /home/arm/projects/afldb
+ . deploy/afldb-r-env.sh
deploy/afldb-settle-afltables.sh: 48: .: cannot open deploy/afldb-r-env.sh: No such file
```

### 10.3 Root cause

`deploy/afldb-settle-afltables.sh` defaulted `PROJECT_ROOT` to the **literal** canonical path
(`${AFLDB_PROJECT_ROOT:-/home/arm/projects/afldb}`), `cd`'d there, and then sourced the
fragment by a bare relative path. Run from any other checkout, the script silently left the
copy it was started from and executed against the canonical checkout, which at `main` has no
`deploy/afldb-r-env.sh`. Two consequences:

1. branch/worktree deployment validation could not exercise the branch's own implementation at
   all — the Stage 2 script was unrunnable from anywhere but the canonical path;
2. more generally, the new fragment lookup was coupled to the canonical path rather than to
   the script's own checkout, so a worktree run of a branch that *did* exist at `main` would
   have quietly run `main`'s tools and fragment instead, with no message.

The Stage 2 preflight (`deploy/afldb-r-preflight.sh`) already resolved its root from its own
location, which is why step C passed from the worktree while D failed. The Stage 2 tests
asserted the sourcing *order* and the literal string `. deploy/afldb-r-env.sh`, and never
executed the script, so nothing failed on Windows.

### 10.4 Corrective implementation

| File | Change |
|---|---|
| `deploy/afldb-settle-afltables.sh` | `PROJECT_ROOT=${AFLDB_PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}` — the same convention the preflight already used. Under the unit `$0` is the absolute `ExecStart=` path, so the result is `/home/arm/projects/afldb` exactly as before; from a worktree it is that worktree; it does not depend on the caller's cwd. The `AFLDB_PROJECT_ROOT` override is kept, first, unchanged. The fragment is now sourced as `. "$PROJECT_ROOT/deploy/afldb-r-env.sh"` so it can only ever be this checkout's own. Steps, flags, label scheme, trap, season gate, `set -eu` and exit semantics unchanged (asserted by the existing test). |
| `deploy/afldb-r-preflight.sh` | sources the fragment through `"$PROJECT_ROOT/…"` too, so the two scripts are line-for-line identical in how they find it (asserted). |
| `deploy/afldb-r-env.sh` | header comment updated to the new sourcing form. No code change. |
| `deploy/afldb-settle-afltables.service` | **untouched**; existing tests re-assert `ExecStart`, no `Environment=`, the full hardening set and `TimeoutStartSec=3600`. |
| `tests/current-season-import.test.ts` | one new static assertion (both scripts contain the identical resolution line; no `/home/…` default for `PROJECT_ROOT`; fragment sourced through `$PROJECT_ROOT` in both, bare relative form absent), and a new **executing** harness `describe('the settle script, executed from a temporary alternate checkout')`: the real settle script is copied verbatim into a `mkdtemp` checkout with the real fragment plus one sentinel `echo` line, an empty in-progress register and a stub `AFLDB_PYTHON` that answers `AMBIGUOUS:0`; it is run by `sh` **with cwd elsewhere**. Cases: (1) sentinel names the temp checkout, `nothing to settle`, exit 0, no `/home/arm/projects/afldb` in output; (2) `AFLDB_R_LIBS` naming a missing dir → the real fragment's refusal, exit 1, no label; (3) `AFLDB_PROJECT_ROOT` pointing at a second temp checkout → the override wins; (4) fragment deleted → non-zero exit naming `afldb-r-env.sh`, nothing after it runs; (5) on Linux `sh` must exist (`skipIf` cannot hide the harness on the supported runtime). Reaches neither network, R nor PostgreSQL. |

### 10.5 Validation (Windows worktree, 2026-09-03)

| Check | Result |
|---|---|
| `sh -n` on the three shell files | OK |
| Harness run manually from the scratchpad with cwd `/tmp` | new script: sentinel printed with the alternate root, `nothing to settle`, exit 0; with `AFLDB_R_LIBS=/nonexistent/rlib`: fragment refusal, exit 1; **Stage 2 script from the same alternate root: `cd: /home/arm/projects/afldb: No such file or directory`, exit 1** — the Stage 3 failure reproduced |
| `npx vitest run tests/current-season-import.test.ts -t ISSUE-130` | 24 passed (18 existing + 6 new), harness cases confirmed executed, not skipped |
| Same, with the Stage 2 script temporarily restored | **5 failed** (the new static test, the modified sourcing test, and three harness cases) — the new coverage would have failed Stage 2 |
| `npx vitest run tests/current-season-import.test.ts` | 252 passed |
| `npx eslint tests/current-season-import.test.ts` | clean |
| `git diff --check` | clean |

### 10.6 Exact revised Stage 3 host retry (streamanator only)

Steps A–C of §9.6 are done and need not be repeated. From the worktree, after fetching the
corrective commit:

```bash
cd /home/arm/projects/afldb-issue-130
git pull --ff-only                                  # must land the corrective commit
git log -1 --oneline

# 1. no-network proof that the script now finds ITS OWN fragment: run it from a
#    different directory with a deliberately missing library dir. Expected: the
#    fragment's four-line "AFLDB_R_LIBS is set to '/nonexistent/rlib'…" refusal on
#    stderr and exit=1 — i.e. the fragment beside the script was sourced and
#    stopped the run before any label, fetch or database.
cd /tmp
AFLDB_R_LIBS=/nonexistent/rlib sh /home/arm/projects/afldb-issue-130/deploy/afldb-settle-afltables.sh; echo "exit=$?"
cd /home/arm/projects/afldb-issue-130

# 2. preflight again from the worktree (unchanged behaviour expected: R PREFLIGHT: OK)
sh deploy/afldb-r-preflight.sh

# 3. the supervised settle, pointed at the worktree exactly as in the failed run.
#    Use whatever override produced the ExecStart above; the transient-unit form is:
sudo systemd-run --wait --pipe --collect --unit=afldb-settle-issue130 \
  -p User=arm -p Group=arm \
  -p WorkingDirectory=/home/arm/projects/afldb-issue-130 \
  -p EnvironmentFile=/home/arm/projects/afldb/.env \
  -p ProtectHome=read-only -p ProtectSystem=strict -p PrivateTmp=true \
  -p NoNewPrivileges=true -p TimeoutStartSec=3600 \
  -p ReadWritePaths=/home/arm/projects/afldb-issue-130/data/sources \
  -p ReadWritePaths=/home/arm/projects/afldb-issue-130/docs/rebuild-manifests/afltables_fitzroy_core \
  /bin/sh /home/arm/projects/afldb-issue-130/deploy/afldb-settle-afltables.sh; echo "exit=$?"
```

Expected for step 3: `AFLDB in-season settle — season 2026, label settle-2026-…`, `[1/3]`
acquire via fitzRoy resolving from the canonical library, `[3/3]` … `SOURCE COMPLETENESS:
COMPLETE`, `settle chain complete`, exit 0, with the drop-in absent. Then §9.6 step E
(read-only look at production's library), then `CHANGELOG.md` (Unreleased) and close.

Note for step 3: the worktree's `data/sources` and `docs/rebuild-manifests/afltables_fitzroy_core`
must exist because `ReadWritePaths` without a leading `-` fails the unit if they do not; the
snapshot and manifest the run writes land in the **worktree**, not in
`/home/arm/projects/afldb`, which is the correct place for a branch validation run.
