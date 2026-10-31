# AFLDB-ISSUE-329 — Non-destructive production build, promotion and rollback

Status: **implemented and proven locally and on isolated Linux (2026-10-31). Not installed on
production.** Production installation (§9) needs its own owner approval. Production stays at
`9ed9c9dd3e84682c43e96c46e98974b245eb54ed` (`BUILD_ID` `QNEHXAtU53TzUjj0Mb7mv`).

Sources: incident [`docs/v2/production-execution-record-2026-10-31.md`](../../docs/v2/production-execution-record-2026-10-31.md)
§4; `deploy/afldb.service`; `deploy/server-cluster.mjs`; `tools/build/prepare-standalone.mjs`;
`node_modules/next/dist/build/index.js:624` (the `clean` step: `next build` deletes everything in
`.next` except `cache`, `dev`, `lock` and `trace` before compiling). Operator summary:
`docs/deployment.md` §3a.

## 1. Requirements (owner brief, 2026-10-31)

| # | Requirement | Where met | Proof (§8) |
|---|---|---|---|
| R1 | Build outside the serving checkout, including dependency installation | §3 | L1, S5, S6 |
| R2 | Validate the complete candidate before promotion | §4 | L2–L4, S6 |
| R3 | Preserve the last working artifact | §2, §5 | L5–L9, S5 |
| R4 | Roll back using that retained artifact, without rebuilding it | §5 | L8, S7 |
| R5 | Dependable build identity without request tracing | §6 | L8, S3, S6, S7 |
| R6 | Account for the production host's memory limit (3.9 GB, no swap, 2 vCPU) | §7 | L7, M1–M3 |

## 2. Design: immutable release directories behind a `current` symlink

One host tool, `deploy/release.mjs` (Node built-ins plus `tools/build/env-in-standalone.mjs`; Linux
only), and one systemd drop-in, `deploy/afldb.service.d/release-route.conf` (production only; DEV
keeps `sync-dev.ps1` unchanged).

```text
/home/arm/afldb-releases/                 release root, OUTSIDE the serving checkout, same filesystem
  releases/<rev12>-<BUILD_ID>/            one immutable release (only the server's ISR output changes)
    deploy/server-cluster.mjs             the supervisor of the same revision
    .next/standalone/…                    the complete standalone bundle
    release.json                          identity: revision, BUILD_ID, AFLDB_ENV, node, manifest hash, smoke, memory
    MANIFEST.sha256                       every file of the release at build time (sha256sum format)
  current  -> releases/<id>               what the service starts from
  previous -> releases/<id>               the rollback target
  builds/<UTCstamp>-<label>-<rand>/       disposable workspace: src/ (git archive), candidate/, logs
  events.log                              append-only: build, publish, promote, rollback-start, rollback, adopt, status-pass
  build.lock                              one build at a time (records its process groups)
  links.lock                              one link change (publish, promote, rollback, adopt) at a time
```

The drop-in sets `WorkingDirectory=/home/arm/afldb-releases/current`. It resets `ReadWritePaths=`
and then re-grants `/home/arm/afldb-releases/releases` (the running release's ISR output) and
`-/var/www/afldb-soon` (the apex page, unchanged). `ExecStart` (`node deploy/server-cluster.mjs`,
relative), `EnvironmentFile` (the checkout's `.env`), `UnsetEnvironment` and the hardening are
unchanged. systemd resolves `current` once, at start, so a running service is pinned to the real
release directory it started in. Switching `current` changes nothing until the next restart, and
the old process keeps serving its own assets until then. Proven under systemd 255 (S3, S4).

The serving checkout keeps its role for Git, `.env`, migrations, preflight and tools. Nothing serves
from its `.next` any more, so an in-place `npm run build` there can no longer take the site down.

Two locks, not one: a long build holds only `build.lock`, so `promote` and `rollback` (which take
`links.lock`) are never blocked by a running build (L8). A lock whose holder is dead (pid and
`/proc` start time) is stale. Breaking a stale `build.lock` first kills the process groups it
recorded, but only those whose working directory is under `builds/` (L6).

## 3. Build (R1)

`node deploy/release.mjs build --checkout <dir> --revision <40-hex> --afldb-env production
[--typecheck off-host --typecheck-evidence <text>] [--smoke-paths /a,/b]`

1. Take `build.lock`; check the revision is a full SHA present in the checkout. Resolve Node: if
   the unit's pinned interpreter exists on the host and differs from the running one, refuse
   (`--allow-node-mismatch` overrides). Children get that Node first on `PATH`.
2. Admission (§7): refuse below the free-disk and available-memory floors.
3. `git archive <revision>` from the checkout into a new unique workspace's `src/` (a pristine
   tree: no untracked files, no `node_modules`). Link `src/.env` to the checkout's `.env`, exactly
   as the in-place build read it; `prepare-standalone` still strips the copy Next makes. The build
   prerenders against the database (`generateStaticParams`), so it must run on the host with the
   production `.env`, not on a workstation.
4. `npm ci`, then `npm run build` (unchanged: `next build --webpack` and `prepare-standalone`),
   each in its own process group under the memory guard (§7), with `AFLDB_ENV` from the flag.
5. Assemble the candidate in `builds/…/candidate/` by moving `src/.next/standalone` and copying
   `src/deploy/server-cluster.mjs`. Remove `src/` once assembled.
6. Validate (§4). Only on a complete PASS, under `links.lock`, is the candidate renamed (one
   `rename(2)`) to `releases/<rev12>-<BUILD_ID>`; an existing name is never overwritten.

Every write in steps 3–6 is inside `builds/…`, until the final rename into `releases/`. The tool
never writes `current`, `previous`, another release, or the checkout. On failure or a signal
(`SIGINT`, `SIGTERM`, `SIGHUP`: exit 130), the tool kills its process groups and removes
`node_modules` (about 1 GB) from the workspace, keeping logs for diagnosis.

## 4. Candidate validation (R2)

| Check | Rule |
|---|---|
| V1 layout | `server.js`, `deploy/server-cluster.mjs` and `.next/standalone/.next/BUILD_ID` exist; the bundle's BUILD_ID equals the build's `.next/BUILD_ID` |
| V2 assets | `.next/static` and `public` in the bundle are byte-identical to the build output |
| V3 credentials | no `.env`-named file anywhere in the release |
| V4 transport flag | `routes-manifest.json` carries `Strict-Transport-Security` if and only if `--afldb-env production` |
| V4b containment | no symlink in the release resolves outside it |
| V5 manifest | `MANIFEST.sha256` over every file (symlinks hashed by target); its hash goes into `release.json` |
| V6 boot smoke | Start the candidate's own `deploy/server-cluster.mjs` with one worker on a free loopback port (default 3199; refuse if it is in use). It runs under `oom_score_adj` 1000 and the memory guard. Use the service's environment: the checkout's `.env` minus every name in the unit's `UnsetEnvironment=` (parsed, not retyped), then the unit's `Environment=`, then `PORT`, `AFLDB_WORKERS=1` and `HOSTNAME=127.0.0.1` last. Every page request carries a five-minute beta claim. It is signed in-process with the service's `AFLDB_SESSION_SECRET` in `signClaim`'s format (a unit test verifies it with the application's `verifyClaim`) and never logged. Require: `/api/health` 200 `status ok`, `database ok`; `/_next/static/<BUILD_ID>/_buildManifest.js` 200 (this proves the listener is the candidate, not the live service); one CSS asset 200 `text/css`; `/` 200 HTML (without a secret, a redirect to `/beta` and `/beta` 200); each `--smoke-paths` page 200, its `x-nextjs-cache` recorded; and no render error in the smoke log. Then stop it |
| V7 post-smoke | V5's manifest is taken **before** the smoke. Afterwards the release must match it exactly, apart from ISR output, whose paths are recorded in `release.json` |

`verify <id>` re-runs V1, V3, V4b and the manifest check against a stored release at any time.

## 5. Promote and roll back (R3, R4)

- `promote <id>`: take `links.lock`; verify `<id>`; refuse unless the service's `MainPID` is running
  from the current release (otherwise a promoted-but-not-restarted release would become `previous`
  without ever having served; `--no-live` overrides for a stopped service). Then switch
  `previous -> old current` and `current -> <id>`, each by an atomic symlink rename. It does not
  restart. It prints the restart, the `status --expect <id>` gate and the forward-only migration
  reminder.
- `rollback [--to <id>]`: take `links.lock`; verify the target (`previous` by default, or any
  retained release); warn if the target has no recorded `status-pass`. Log `rollback-start`, then
  switch `current` first and `previous` second, so `previous` becomes the release that was current
  and a mistaken rollback reverses the same way. No build, no `npm`, no Git (S7 counts the
  workspaces).
- Manifest drift rule: missing or changed files FAIL, and so do added files, except the server's
  own ISR output (`.next/cache/**`, and `.html`, `.rsc`, `.meta`, `.body` files or `.segments/`
  entries under `.next/server/app` or `.next/server/pages`). ISR output is reported, not failed. A
  tampered release is refused by `verify`, `promote` and `rollback` (L9).
- Retention: nothing is deleted automatically. Older releases and failed workspaces are removed by
  the operator. A release is about 0.8 GB; `/` had 61.2 GB free at the 2026-10-29 inspection and
  also holds PostgreSQL, so keep the admission floor (6 GB) meaningful.
- The database is never rolled back: migrations are forward-only (`docs/deployment.md` §11,
  ISSUE-257 guard). A release older than an applied migration must be checked against it before
  the restart.

## 6. Build identity without request tracing (R5)

- `release.json` binds revision, BUILD_ID, AFLDB_ENV, Node version, manifest hash, smoke result,
  memory figures and any off-host type-check evidence.
- `deploy/server-cluster.mjs` always logs one journal line at primary start:
  `[afldb] serving build <BUILD_ID> release <id> revision <sha>` (read from files beside it; never
  fatal; `release in-place` for today's layout).
- `status [--expect <id>]` passes only if all of these hold:
  - `current` resolves to `<id>`;
  - the service's `MainPID` (`systemctl show`) has its working directory in that release
    (`/proc/<pid>/cwd`);
  - its `/_next/static/<BUILD_ID>/_buildManifest.js` answers 200 at the service URL;
  - the previous release's BUILD_ID (if different) answers 404;
  - `/api/health` is `ok`/`ok`.

  It also prints the unit's `MemoryCurrent`. A pass with `--expect` appends `status-pass` to
  `events.log`.
- This replaces the `x-afldb-build` gate (Stage 12, rollback gate R4), which needs
  `AFLDB_TRACE_REQUESTS=on`. `/api/health` keeps its no-version policy.

## 7. Memory (R6)

Facts from production: attempt 1 (default ~2 GB heap, service running) died of heap OOM in the
type-check phase; attempt 2 (`--max-old-space-size=3072`, `AFLDB_BUILD_WORKERS=1`, service
**stopped**) passed with 443 MB minimum available.

- The build runs with `NODE_OPTIONS=--max-old-space-size=<heap>` (default 3072),
  `AFLDB_BUILD_WORKERS=1` and `oom_score_adj=1000`. If the kernel must kill something, it kills the
  build, not PostgreSQL or the service.
- Admission: refuse to start below the measured need plus the floor: 3,200 MB `MemAvailable` in
  build mode, 2,100 MB with `--typecheck off-host`, overridable with `--require-available-mb`. Also
  refuse below `--require-free-gb` (default 6) free disk under the release root.
- The build's environment is the shell's minus every name the checkout's `.env` defines, and
  `AFLDB_BUILD_TYPECHECK` is always set explicitly (empty unless `off-host`), so neither the shell
  nor `.env` can skip the type-check unrecorded.
- The boot smoke's second Next server runs under the same `oom_score_adj` and guard.
- Guard: every 0.5 s, read `MemAvailable`. Below `--min-available-mb` (default 384), the build's
  process group gets SIGTERM, then SIGKILL after 5 s. Each phase records minimum `MemAvailable` and
  peak process-group RSS in the build log and `release.json`.
- A guard abort is an ordinary failed build: the serving release is untouched (§3, L7).

**Measured (Linux, isolated PostgreSQL, 2026-10-31; small database, 2,936-file release against
production's 12,994):**

| Run | Phase | Duration | `MemAvailable` drop | Peak group RSS |
|---|---|---|---|---|
| M1 | `npm ci` | 7 s | ~0.9–1.2 GB | ~0.96 GB |
| M2 | `npm run build`, type-check in build (default) | 77–80 s | ~2.6–2.8 GB | ~1.5 GB (sampled) |
| M3 | `npm run build`, `--typecheck off-host` | 37–38 s | ~1.7–1.8 GB | ~1.6–1.8 GB |
| — | separate `tsc --noEmit` then build without its check | — | ~2.8 GB (tsc alone ~2.65 GB RSS) | dropped: no saving |

The production recovery build (service stopped) is consistent with M2: about 2.85 GB of demand on
a 3.9 GB host. With the service serving (two workers, about 150–300 MB on this data; production is
larger) and PostgreSQL resident, **the default mode will probably not fit beside the running
service on production**. The guard will abort it safely rather than OOM the host. The owner
chooses one of these, using the first production measurement:

1. **`--typecheck off-host`** (recommended first). The build skips Next's type-check phase
   (`AFLDB_BUILD_TYPECHECK=off-host` → `typescript.ignoreBuildErrors` in `next.config.ts`; no other
   effect). The tool refuses it without `--typecheck-evidence` (for example, "`npm run typecheck`
   exit 0 at `<sha>` on the workstation"), which it records in `release.json`. This saves about
   1 GB.
2. **Add swap** (owner sudo; for example a 2–4 GB swap file). The guard floor still protects the
   host.
3. **A short planned stop** during the build only. This is still non-destructive: the serving
   release is untouched, so on any failure the same release restarts immediately. The tool never
   stops the service itself.

## 8. Proof (2026-10-31)

All in this record; no production or DEV access.

**Unit, any OS** (`tests/deploy-release.test.ts`). It covers:
- release ids and revisions, and ISR classification;
- drift, manifest round-trip and smoke-log scanning;
- meminfo, the argument defaults, and `UnsetEnvironment` parsed from the real `deploy/afldb.service`;
- environment order;
- the drop-in against the unit, the identity line placed before the tracing branch, and the
  tool's imports.

Windows: 13 passed, 12 Linux-only skipped. Two additions: the smoke's beta claim is verified by
the application's own `verifyClaim`, and the admission defaults per mode are checked.

**Linux route suite** (same file, WSL Ubuntu, Node 22.21.0, private temp roots): **25/25** after the
implementation review (23/23 before it). It runs
a fixture Git repository whose revisions build a tiny standalone server with the real
`server-cluster.mjs` and `afldb.service`. While a server runs from `current`, a prober requests an
asset and health every 100 ms and asserts zero failures:

| # | Case | Result |
|---|---|---|
| L1 | build and promote; the owner DSN is stripped from the smoke environment | pass |
| L2 | failing build | refused; links, releases and serving unchanged |
| L3 | type error; `off-host` without evidence refused; with evidence builds | pass |
| L4 | a symlink leaving the release is found, one staying inside is accepted; a link pointing outside `releases/` is refused (an added code file failing drift is a unit case) | pass |
| L5 | `SIGTERM` and `SIGHUP` to the tool mid-build | exit 130; child pid dead; `build.lock` gone; serving unchanged |
| L6 | tool `SIGKILL`ed mid-build (orphan left, `oom_score_adj` 1000) | the next build breaks the stale lock and kills the orphaned group |
| L7 | memory guard trips (fixture memory hog) | build killed; serving unchanged |
| L8 | promote a second release (status "restart pending" until restart); early promote refused; rollback **during** an in-flight build; rollback `--to` forward and back; `rollback-start`/`status-pass` events | pass |
| L9 | tampered served release: `verify` fails, ISR output tolerated, rollback to it refused | pass |
| L10 | `adopt --from-manifest`: a settled, regenerated ISR page is copied live and recorded; a changed `server.js` refuses and sets no link | pass |

**Real Next.js through the route** (same WSL distro, isolated PostgreSQL 16 on loopback port 55461,
migrated `_test` database, `.env` with an owner DSN to prove stripping):

- Releases m4, m5 (type-check in build) and m6 (`off-host`) each booted relocated and passed the
  smoke, including `/players`, `/clubs` and `/seasons`.
- Builds m1 and m2 failed:
  - m1 on type errors, which exposed the evidence-script `tsconfig` defect fixed in this change;
  - m2 on a `next/font` Google Fonts fetch.

  Each left nothing published.

**Real systemd 255** (S1–S7). The test unit `afldb-r329` was generated by `sed` from
`deploy/afldb.service` plus the drop-in, retargeted only at the private root: user, paths, Node,
no PostgreSQL dependency. It was removed afterwards. Log: `systemd-proof/proof.log` in the private
root.

| # | Step | Result |
|---|---|---|
| S1 | in-place production build in the checkout stand-in (today's layout); `sha256sum` manifest of its standalone tree | BUILD_ID `gC9Y3ew1t8MqKAeq01-8D`, 2,935 files |
| S2 | `adopt --from-manifest` of that bundle | 2,935 files hash-checked and copied; `current` set |
| S3 | start the unit | `WorkingDirectory` resolved into the release; the journal logs the identity line; `status --expect` PASS |
| S4 | sandbox | the own release's `.next/cache` is writable; the checkout and the release root are `EROFS` |
| S5 | a real `npm run build` started, `SIGTERM` after "Creating an optimized production build" (mid-compile) | REFUSED interrupted; no `next build` process survives; **93 probes of a live CSS asset and health: 0 non-200**; `status` PASS; `verify` PASS |
| S6 | a full build while serving | **444 probes: 0 non-200**; RELEASE READY `W2yilNf6Qd8AgReagyOJK`; promote; `status` FAIL before restart (as designed: process, 404, 200); restart; `status` PASS; journal identity line |
| S7 | rollback | no workspace created (no rebuild); restart; `status --expect` the adopted release PASS |

Not proven here:
- production's memory headroom beside the running service. That is the first production build,
  under the guard;
- the copy of production's 12,994-file bundle, whose figures come from the record;
- a real Caddy front.

**Implementation review (2026-10-31).** The same independent reviewer re-read the implementation and
found no CRIT or HIGH. Fixed:
- MED 1: adopt refused regenerated ISR pages;
- MED 2: the shell or `.env` could silently skip the type-check;
- MED 3: the smoke could not render behind the beta gate;
- MED 4: admission was below the measured need, and the smoke was unguarded;
- LOW: an unreadable lock was taken as stale; the orphan reaper did not use the realpath of the
  root; a lost terminal crashed the tool;
- LOW: `links.lock` contention discarded a validated build (it now waits up to 60 s);
- LOW: the manifest was taken after the smoke;
- LOW: a failed workspace could keep a transient `.env` copy (its `src/.next` is now removed).

The systemd proof S1–S7 ran before these fixes; the Linux suite re-ran 25/25 after them. Real
build **m7** used the post-review code with `AFLDB_BETA_GATE=on`, an isolated session secret and
`--typecheck off-host`. RELEASE READY `1a95a5c3b730-o-bFsiDenQy8syPTbRMwz`. The smoke rendered behind the
gate with its claim: `/` 200 `HIT`, and `/players`, `/clubs` and `/seasons` 200 with no cache
header (rendered at request time). V7 passed on a real Next server. The build took 37 s, with a
`MemAvailable` drop of about 1.8 GB.

Recorded, not fixed:
- The lock is still created empty then written, which is now tolerated rather than made atomic.
- Two processes breaking the same stale lock can race.
- The reaper checks only the group leader's cwd.
- The unit's Node and `UnsetEnvironment` come from the revision's unit file, not from the installed
  unit (`systemctl show`). A missing pinned Node falls back to the running Node with a log line.
- No `rollback --accept-drift`.
- No fsync of release files or directories before a link switch.

None of these can change the serving release, `current` or `previous`.

## 9. Production installation (proposal; separate owner approval)

Not performed. Proposed sequence, all as `arm` except the marked owner-sudo steps. Each step is
read back before the next.

1. **Checkout.** Fast-forward the serving checkout to the reviewed commit containing this route,
   with Git only. The running bundle (the checkout's `.next/standalone`) is unaffected, because
   nothing is built.
2. **Adopt.** `node deploy/release.mjs adopt --checkout /home/arm/projects/afldb --revision
   9ed9c9dd3e84682c43e96c46e98974b245eb54ed --afldb-env production --expect-build-id
   QNEHXAtU53TzUjj0Mb7mv --from-manifest
   /home/arm/backups/afldb/release-v2-20261030T210000Z/standalone-manifest.sha256`
   - First check that the manifest file still hashes to `b8a0c6d3…`.
   - The step copies the 12,994 recorded files, each hash-checked. There is one exception: a
     recorded ISR file (`.html`/`.rsc`/`.meta`/`.segments` under `.next/server/app`) that the
     running server has since regenerated (`revalidate` 3600) is copied live. That happens only if
     the file is settled (older than 5 s) and unchanged across the copy; a file the server deleted is
     left to regenerate. Those paths are listed in `release.json` `adoptedServerOutput`. Any other
     difference refuses. The 28+ pages rendered on demand after the build are not in the manifest
     and regenerate.
   - The supervisor comes from `git show 9ed9c9dd:deploy/server-cluster.mjs`. That revision
     predates the identity line, so the journal line appears only from the first release built
     by this route. `status` does not depend on it.
   - It sets `current`, writes about 0.8 GB, and restarts nothing.
3. **Install the unit drop-in.** Owner sudo: install `deploy/afldb.service.d/release-route.conf`
   to `/etc/systemd/system/afldb.service.d/`, then `systemctl daemon-reload` and `systemctl restart
   afldb`. Then `node deploy/release.mjs status --expect
   9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv`, plus `curl` of key public pages through
   `beta.afldb.com`. Downtime is one restart, about 2–5 s.
   - **Back-out.** Remove the drop-in, daemon-reload, restart. The in-place bundle is still in the
     checkout. This back-out is valid only until an in-place build runs there again. After the
     first promotion, roll back with `rollback` instead.
4. **First build through the route,** owner-paced. Measure with `systemctl show -p MemoryCurrent
   afldb` and `free -m` first.
   - Run `build … --typecheck off-host --typecheck-evidence "<workstation typecheck at <sha>>"`.
   - The guard aborts safely if memory runs short. The owner then picks swap or a planned stop
     (§7).
   - Then `promote` → owner-sudo restart → `status --expect <id>`. On a failed gate: `rollback` →
     restart → `status --expect 9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv`.
5. **Records.** The frozen execution package and rollback runbook keep their in-place text as the
   record of what was approved. After installation, `docs/deployment.md` §3a and §11 govern
   production. The rollback runbook's R4 header gate is replaced by `status --expect` in its next
   revision.
