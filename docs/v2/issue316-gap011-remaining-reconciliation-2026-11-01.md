# ISSUE-316 / V2-GAP-011 — remaining C2, C3, C4, C4b, C5 reconciled against current records (2026-11-01)

Status: **reconciliation and the smallest owner-attended procedure only.** Nothing was changed, started, enabled or
installed. Frozen P/H/EXEC, authorities and recovery bindings are untouched; no expired window is revived; no rebuild is
repeated; no writer or provider is activated. Sources: the runbook table in `issues/open/AFLDB-ISSUE-316.md` §7, the
repository at `HEAD`, the released commit `9ed9c9dd`, and one read-only probe of production on 2026-11-01T01:32Z (no sudo;
role `afldb_app`; output `D:\tmp\afldb-gap006-brownlow-artifacts-20261101\prod-316-state-20261101.txt`).

## 1. Current facts

| Fact | Evidence |
|---|---|
| Production checkout | `affe9a2c30842e35557710bc582cb9d6114ee39c`, clean |
| AFL Tables timer | `afldb-settle-afltables.timer` **disabled, inactive**, loaded (A-AFLT, 2026-10-31); service `static`, inactive |
| AFL API units | **Not installed:** `afldb-settle-afl-api.{timer,service}` and `afldb-settle-afl-api-brownlow.{timer,service}` are `not-found` |
| Ingestion switch | `site_settings` has **no** `acquisition.%` row, so every AFL API acquisition/settle refuses (fail closed); `AFLDB_AFL_API_BROWNLOW_ENABLED` absent from `.env` |
| `AFLDB_SETTLE_TRIGGER` | **absent** from the checkout `.env` (count 0). The runbook's C5 says to keep it at `systemd`; whether the unit environment supplies it was not checked |
| polkit rule | `/etc/polkit-1/rules.d` is unreadable to `arm`; recorded **absent** at A-AFLT (owner sudo), not re-proved here |
| Retirement in released code | `data/reference/afltables-network.json` at `9ed9c9dd` and `HEAD`: `status retired`, `last_season 2026`, `decision D-316-1`, `changed_at 2026-10-27`; `seasons.json` `in_progress_seasons` includes 2027; rollover commit `c7e17da2` is an ancestor of `9ed9c9dd` |
| C4b tool | `tools/current-season/afl-api-c4b-rehearsal.ts` is in the released tree; it has never run against PostgreSQL or production |
| 2026 data on production | 218 matches, all `afltables`-owned (2026-03-05 → 2026-09-26); `player_club_season_stats` max season 2026; 2025 has 216 matches |
| 2027 fixtures on production | `fixtures` rows for 2027: 0 |
| 2027 feed | exists (compSeason `CD_S2027014`, id 102); one retained capture, 218 records ([record](issue229-b2-2027-feed-check-2026-11-01.md)) |

## 2. Step-by-step status

| Step | Status | Basis |
|---|---|---|
| C0, C1 | **Done** (historical) | DEV approval and rehearsal records; unchanged |
| **C2** close 2026 and retire AFL Tables in one write | **Done in the released code and runtime, formal acceptance record not located.** The six retirement/rollover files are in the released tree (`retired`, D-316-1), the app was rebuilt in the V2 release, and the timer is disabled. Items from the runbook's own acceptance column not re-proved today: the readiness INFO line (it prints `afltables_network: retired` offline, seen in §3) and "no AFL Tables snapshot label newer than the rollover's" | Owner can record C2 as accepted on this evidence, or ask for the one missing check (the snapshot-label listing, which is local-only) |
| **C3** install the AFL API units inert (ISSUE-232 §7 C) | **Not done** | The four units are `not-found` on production. Needs the owner's sudo; no service started, no timer enabled, switch left off |
| **C4** register 2027 | **Inputs now exist, change not made.** The authentic feed is published and retained. Offline readiness (`afl-api-cutover-readiness.ts --season 2027 --season-feed <retained>`) is `NOT READY`: `season_identity`, `round_vocabulary` fail; `season_feed`, `venue_coverage`, `team_coverage`, `round_coverage` are unproved until 2027 is registered | §3 below |
| **C4b** D1 rehearsal on PROD | **Blocked by C3 and C4**; D-316-13 becomes available only after C4 is deployed | Tool unrun on PostgreSQL/production |
| **C5** cutover go | **Blocked by C4b PASS record**; before the first 2027 match (Round 1 starts 2027-03-17 UTC per the feed) | |
| C6–C9 | Not started; follow C5 | |

## 3. C4 inputs, concretely (shared with ISSUE-229 B2)

- `seasons.2027 = {compSeasonId: 102, providerId: "CD_S2027014"}` (proposal sha256 `156f91b58218f1950fa795f1d453f5acfda1d9d34a06f71ffbcaf761e83e1c4d`, copy by hand per D-233-2).
- `round_vocabularies.afl_api_2027` with `mapping_status: declared`: Round 1–24, Wildcard Finals, Qualifying & Elimination Finals, Semi Finals, Preliminary Finals, Grand Final (the feed's own round names).
- Venues: 19 provider ids in the feed; **2 are missing** from the identities file: `CD_V313` Mars Stadium (Ballarat) and `CD_V2385` "To Be Confirmed" (the finals placeholder venue; needs a deliberate decision, not a canonical venue).
- Teams: 40 provider ids; the 18 clubs are registered; the other 22 are ladder-position placeholders ("7th", "10th" …) used by six finals matches and must not become clubs.
- `PLACEHOLDER` fixture status (83 records, Rounds 17–24 and finals): a policy decision (ISSUE-229 record §4).
- Reviewed commit, deployed **with a rebuild** (the app reads the registration at build time). The mechanics are the existing ISSUE-233 and ISSUE-229 procedures; no new design is needed.

## 4. Smallest remaining owner-attended procedure (none authorised)

1. **Decide** the four input items in §3 (venue mapping `CD_V313`, placeholder-venue/team handling, `PLACEHOLDER` policy) and approve the 2027 registration.
2. **Commit** the registration, round table and venue ids (reviewed), re-run `afl-api-cutover-readiness.ts` until `REPOSITORY READY`; the ISSUE-229 `--validate-only` / `--dry-run` then re-run on an isolated target.
3. **Deploy with a rebuild** under the existing release procedure (the reviewed, build-heap-capped route recorded for ISSUE-329); no writer starts.
4. **C3** (owner sudo): install the four unit files inert; verify `loaded` / `inactive` / `disabled` twice.
5. **C4b** (owner-attended, D-316-13): `afl-api-c4b-rehearsal.ts --season 2027 --decision D-316-13 --evidence-dir <dir>`; it restores the setting however the run ends; the reviewer records the PASS from the evidence directory.
6. **C5** (D-316-4, after the PASS and before 2027-03-17 UTC): remove the polkit rule if present, enable `acquisition.afl_api_current_season_enabled`, enable the match timer only; confirm `AFLDB_SETTLE_TRIGGER` as the runbook states; admin panel wording (D-316-12).
7. C6 (debutant routine), C7 (acceptance criteria to be set before Opening Round) and C8 (Brownlow 2027, count week) follow as written.

Timing: C5 must precede Round 1 (2027-03-17 UTC). There is no pressure inside November; the AFL Tables writer is already retired, so
nothing runs on production in the interim.

## 5. Owner decisions needed

1. Accept C2 as done on the §2 evidence (or request the snapshot-label check).
2. The §3 input decisions and 2027 registration approval.
3. Window and sudo for C3; later C4b and C5 approvals (D-316-13, D-316-4).
4. Confirm how `AFLDB_SETTLE_TRIGGER` is supplied on production.
