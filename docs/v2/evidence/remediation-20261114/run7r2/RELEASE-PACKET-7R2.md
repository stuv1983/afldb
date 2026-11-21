# Release packet 7, revision 2 (R7R2): D-365-W, ISSUE-366 tooling and the 21 November closeout fixes

Prepared 2026-11-21 (Saturday) by Claude, at the owner's instruction to re-derive Release 7 from the published
closeout. **Preparation only:** nothing in this packet contacted production. It supersedes packet 7
(`run7/RELEASE-PACKET-7.md`), whose approval R7 expired unexecuted on 2026-11-20T01:00Z
(`run7/sitting-exec-20261120/README.md` §4). Packet 7's own blocks pin `0a308e2a` and **must not be sent**.

## 0. The decision

Release **`a3c8c67cc98fc35e963795e331e7217a24ccf1e0`** (= `origin/main` since 2026-11-21) to production in one attended
window. It is an application release with no migration, dependency, configuration or data change, and no B1a step. It
carries everything packet 7 carried, plus:
- **ISSUE-367:** public Brownlow per-round and per-match views respect the season acceptance rule. For a `pending` season
  (2026 on production since B1a), round votes are withheld and per-match votes show as unavailable on the season, match,
  player game-log and head-to-head pages and in NL per-game answers. Accepted seasons are unchanged.
- **ISSUE-369, 368, 352:** operator tooling only (`db:status` read-only; AFLW loader manifest checks; off-host pull retention
  hold). None of it runs at release; none changes what the site serves.

Rollback is to the release production serves today (packet 7 §8, unchanged).

## 1. Pins (differences from packet 7 §1 in bold)

| Item | Value |
|---|---|
| Candidate `CAND` | **`a3c8c67cc98fc35e963795e331e7217a24ccf1e0`** (= `origin/main`, verified 2026-11-21 after publication) |
| Release id prefix | **`a3c8c67cc98f-`** |
| Serving release (expected), `previous`, serving checkout, rollback target | unchanged from packet 7 §1 (`a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`, `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, `/home/arm/projects/afldb` on `main` at `a2e6ea99`); last record 18 Nov, no production contact since; **re-read at P1** |
| `PREP` | the records-only commit that publishes this packet (sole parent `CAND`; every `CAND..PREP` path under `docs/` or the three trackers). Pins the procedure; never built or served |
| Reviewed delta `a2e6ea99..CAND` | **149 paths, 17 commits**; raw-listing sha256 **`b2d0b69821edfa105c09dc7888cfab668e3459618afbf28e256196632199d7a8`** (identical on Windows Git and Linux Git 2.43.0) |
| Absent from the delta (checked) | `src/db/migrations/`, `package.json`, `package-lock.json`, `next.config.ts`, `deploy/afldb.service`, `deploy/server-cluster.mjs` (P2 re-checks) |
| Node / workers | v22.23.2; `AFLDB_WORKERS` read at P1 |

## 2. Delta review: what is new since packet 7 (`0a308e2a..a3c8c67c`)

Packet 7 §2 still describes `a2e6ea99..0a308e2a`. The 39 further paths (8 commits, `b82a6b04` PREP included):

| Class | Paths | Effect at release |
|---|---|---|
| **Application** | `src/db/queries/{rounds,matches,players,player-compare}.ts`, `src/db/queries/nl/player-game.ts`, `src/app/admin/data-editor/page.tsx` | ISSUE-367 gate (above). The admin match sheet keeps raw values. Uses the existing `brownlowAcceptedSql`; no schema read beyond `stat_availability`, which the gated career/season readers already use |
| **Operator tooling shipped, not invoked** | `tools/db/migrate.ts`, `tools/aflw/{load_staging,parse_aflw}.py`, `tools/maintenance/offhost-pull.sh` | ISSUE-369/368/352. `migrate.ts` apply path unchanged (bootstrap still runs on apply). Not run in this release |
| Tests | `tests/{catalogue-lookups,deploy-web-unit,reference-data}.test.ts`, `tests/integration/database.test.ts`, `tests/python/aflw_staging_contract.py` | not shipped behaviour |
| Documentation and records | `docs/deployment.md`, `docs/backup-restore.md`, `tools/aflw/README.md`, the trackers, review and closeout records | none |
| Release tooling | `deploy/release.mjs`, `deploy/post-install-check.sh`, the three successor blocks | **unchanged since `0a308e2a`** (blob-equal) |

**ISR consequence:** as packet 7 §2. A new build gets an empty ISR cache; prerendered pages are rendered at build time from
production data, so 2026 season and match pages carry the gate from first serve. No 3600 s wait expected.

## 3. Qualification

See `DEV-QUALIFICATION.md` (this folder) for the exact tree, commands and results on streamanator. The closeout fixes'
own red/green evidence is `docs/v2/evidence/closeout-20261121/QUALIFICATION.md`. Packet 7 §3's earlier evidence
(ISSUE-366, D-365-W) carries over, since those files are unchanged.

Summary: exact tree; typecheck rc 0; lint gate at baseline; production build rc 0; D-365-W cells correct on desktop and
mobile (host Playwright DOM); 16 P10-shaped samples, 0 bad; controls as expected; ISSUE-367 rendered on season, match and
game-log pages (accepted 2025 shown, pending 2026 withheld); integration `b1a-successor` 14/14 and ISSUE-367/369 3/3; unit
failures limited to the same 7 fixture-dependent tests as at `b82a6b04`.

**Limitations (in addition to packet 7 §3's):** the 367 rendered check uses a synthetic DEV seed, not production data, and
records DOM text only (**VISUAL: UNVERIFIED** for the season, match and game-log pages); NL corpus and stress not rerun.

## 4.–9. Procedure

Packet 7 §4–§9 apply **verbatim**, with these substitutions and nothing else:
- every `run7/` path becomes `run7r2/` (blocks in `run7r2/sitting/`, manifest `run7r2/SHA256SUMS`);
- `CAND` / `0a308e2a…` becomes `a3c8c67cc98fc35e963795e331e7217a24ccf1e0`, the id prefix `a3c8c67cc98f-`, the reviewed
  delta 149 paths with the sha256 above;
- P3's typecheck evidence cites `run7r2/DEV-QUALIFICATION.md` section 2;
- the sitting record is `run7r2/sitting-exec-<date>/README.md`.

The block names (`r7-*.sh`), tmux session name and build-log pattern are unchanged; the blocks differ from packet 7's only by
those pins (`diff` is 32 lines, all pin or label lines).

**Additional owner observation (ISSUE-367, after P10, recorded separately like packet 7 §6.2):** signed in, open
`https://beta.afldb.com/seasons/2026` and one 2026 match page reached from it, then the 2026 game log on the Pendlebury
page. Report whether any Brownlow vote number appears for 2026. Expected: none (round block absent or "No votes recorded";
match BV column absent; game-log BV blank). Recorded as `OWNER-BROWSER-367: …`, never as an automated pass. A vote number
appearing is not a rollback trigger (the site is otherwise correct); it reopens ISSUE-367 for the owner.

## 10. Block manifest

`run7r2/SHA256SUMS` (repository-root-relative paths, LF bytes) covers the seven `run7r2/sitting/` blocks and the three
successor blocks, blob-equal to `CAND`. Its own sha256: **`78b655fdaf25a38dff386103264ef92abcb12bd0f84ef2346f78dd22b342a90b`**.
Never send a block from `run7/`, `run6/` or `run6r/`.

## 11. Approval statement (proposed)

> **Approval R7R2:** "I approve publishing `PREP` (the records-only commit adding release packet 7R2) to `origin/main` by
> fast-forward, and the attended production release of `a3c8c67cc98fc35e963795e331e7217a24ccf1e0` per release packet 7R2
> (`docs/v2/evidence/remediation-20261114/run7r2/RELEASE-PACKET-7R2.md`, `SHA256SUMS` sha256
> `78b655fdaf25a38dff386103264ef92abcb12bd0f84ef2346f78dd22b342a90b`, `origin/main` pin `PREP` = `<full SHA>`) on
> **`<day, date>`, `<start>`–`<end>` AEDT**. `PREP` pins the reviewed procedure; the serving checkout and the build target
> `a3c8c67c` exactly.
>
> Claude runs, over Windows OpenSSH, one connection per step, the packet 7 §5 sequence with the 7R2 blocks: P0–P2, P3, P4, then
> the S7/S8 checks, the public smoke, the P10 `after` page checks and the 30-minute observation.
>
> I perform `sudo systemctl restart afldb` myself, attest its InvocationID only if S7 shows the apt coincidence, and report my
> signed-in browser observations of the 2026 BV cell and of 2026 Brownlow votes on the season, match and game-log pages.
>
> On a packet 7 §8 trigger, roll back to `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`, with my restart.
>
> No database write, reversal, restore or B1a step.
>
> Afterwards, record the outcome in a records-only commit and publish it by fast-forward.
>
> Stop if P1 reads anything other than packet 7 §4 expects."
