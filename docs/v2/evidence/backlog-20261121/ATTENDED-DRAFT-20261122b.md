# Consolidated DRAFT: attended production scope and windows (R1–R8, the 371/372 release, the 348 load) — NOT APPROVED

**Status.** Planning only (owner decision 5, 2026-11-22). Nothing here has run; no agent contacted production. Every item
still needs its own owner approval at the sitting. Sources: `OWNER-PACKET.md` §3 (R1–R9, common rules, avoided times, read-only
pre-checks), `kits/KITS-20261122.md`, `RC-371-372.md`, `issue348-acquisition/SEALED-PLAN.md`, `R0-SITTING-20261122.md`.

**Owner proposals recorded (decision 5, not yet in force):**
- **Weekly maintenance slot: Tuesday 10:00–10:30 Melbourne time** (ISSUE-351). AEDT (UTC+11) until 2027-04-04 03:00, then
  AEST (UTC+10): 23:00–23:30Z Monday now, 00:00–00:30Z Tuesday after.
- **Season opening: Tuesday 23 February 2027** (ISSUE-350, R8). It falls on a slot Tuesday, so the opening starts after the slot.

**Common rules (packet §3, unchanged).** The owner does every `sudo` step; `arm` steps run from `/home/arm/projects/afldb`
(clean, at the serving revision); no secret on a command line; one read-only pre-check probe per sitting, run first, any
difference from the expected values is a stop. Avoid (AEDT): 02:10–02:40 and Wednesday 03:20–03:45 once R3 is installed;
04:50–05:45 (nightly settle); 05:45–07:15 (`apt-daily-upgrade` plus random delay).

## 1. Scope per item

| Item | Issue | What changes on production | Interruption | Prerequisite | Pending owner input |
|---|---|---|---|---|---|
| **371/372 release** | 371, 372 | publish `b40c13ff`+`cf158d60`; release build; promote; add `AFLDB_REVALIDATE_URL`/`SECRET` to `.env`; **restart `afldb`** | **a brief restart** of the `afldb` service (both workers); requests in flight during the restart may fail; then acceptance `revalidate-season.ts --season 2026` = 0, 2/2 workers | publication; DEV qualification by the other session (in progress, not this run's) | approval of the release |
| **R1** host patching policy | 351 | two files under `/etc` (`183691d9…`, `4a277b8b…`) | none; effective at the next apt run | none | approval |
| **R2** failure visibility, option A | 332 | one `authorized_keys` line on production; first manual run from streamanator | none | wrapper re-staged at `c6467ff4…` (`kits/KITS-20261122.md` R2) | **destination** (pending); hourly cron and the deliberate test alarm wait for it; delivery is recorded only when the owner confirms receipt |
| **R3** scheduled backups + off-host pull | 352 | `/home/arm/backups/afldb-scheduled`, five units, attended first runs; daily pull to streamanator | none | none | approval |
| **R4** combined Caddy install | 357, 362 | `/etc/caddy/Caddyfile` (backup first), one graceful reload | none expected (graceful reload) | installed sha `4f6972ec…` re-read | approval |
| **R5** pre-fix Caddy logs | 362 | delete/truncate or encrypt-copy-then-delete (option d) | none | R4 probes passed | **option** (owner chose to see the presentation first; nothing authorised) |
| **R6** attended reboot | 351 | reboot to kernel `6.8.0-149`; stop `afldb-settle-afl-api.timer` first, restart after | **the reboot** (minutes) | R1 installed; R3's first nightly + pull verified; console confirmed; done last, never in the same breath as R4 | date/time |
| **R7** drop stale databases | 352 | drop databases other than `afldb_prod`, `afldb_restore_test` | none | R3's first verified off-host copy and Wednesday verification | approval |
| **R8** 2027 season opening | 350 | I350 stage via `prod-stage.sh` (`afldb_import`), then `revalidate-season.ts --season 2027` | none | R2 delivering (G0b) and R3 verified preferred; 371/372 release with the revalidate env (else the refresh step cannot run) | date proposed: **Tue 23 Feb 2027** |
| **ISSUE-348 load** (optional rider) | 348 | one DraftGuru import transaction (sealed runner `i348-load.sh`) | none (data only) | publication of `7b52c46c`'s blobs; fresh backup; admin draft editor quiet; `digest pre` = R0 | approval of the sealed plan |

## 2. Draft windows (dates are proposals; each sitting re-runs the read-only pre-check)

| Sitting | When (AEDT) | Contents, in order | Notes |
|---|---|---|---|
| **A1 slot** | Tue 24 Nov 2026 10:00–10:30 | 371/372 release: promote, `.env`, **brief restart**, acceptance | the slot exists for restarts; nothing else shares it |
| **A2 installs** | Tue 24 Nov 2026 10:30–12:00 | R1; R2 (key line + first manual run; no cron until the destination); R3 (attended first runs); R4 (reload + probes); R5 only if the owner has chosen an option; optional 348 load (after its own fresh backup) | no outage; stop at the first failed acceptance |
| **B reboot** | Thu 26 Nov 2026 10:00 (alternate slot) | R6 alone | after the 25 Nov 02:20 nightly, the 25 Nov 03:30 Wednesday verification and the first pull are verified |
| **C housekeeping** | Tue 1 Dec 2026 10:30 | R7, then the production rows of R9 | after the first Wednesday verification and an off-host copy |
| **D opening** | Tue 23 Feb 2027 11:00 (after the slot) | R8 per procedure 01 §5 (capture/plan may run a few days before) | G0 by 2027-03-10; Opening Round 2027-03-17 |

If the owner prefers fewer visits, A1 and A2 can be one sitting (restart first, then installs). R6 must not share a sitting
with R4 unless console access is confirmed and R0's off-host copy is verified, and even then it runs last (packet §3).
