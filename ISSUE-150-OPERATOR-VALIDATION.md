# AFLDB-ISSUE-150 — operator validation commands

Implementation branch: `sonnet/issue-150-venue-records` (worktree `D:\dev\afldb-issue-150`).

`ISSUE-150-venue-evidence.sql` is the semantic contract the query layer
(`src/db/queries/venues.ts`) is written against. The workstation this was implemented
on has no local PostgreSQL; the checks below need a connection to `afldb_test`
(or another canonical database) — e.g. an SSH tunnel to the dev host on `127.0.0.1:5432`.

---

## 1. Already run on the implementation workstation (against `afldb_test` via the tunnel)

```bash
npx tsc --noEmit
#   PASS (exit 0)

npx eslint src/db/queries/venues.ts src/components/Venue*.tsx \
  "src/app/venues/[slug]/page.tsx" "src/app/venues/[slug]/matches/page.tsx" \
  tests/venue-records-sections.test.ts tests/integration/venue-records.test.ts
#   PASS, 0 errors (one `_total` unused-var WARNING, identical to the existing
#   src/db/queries/players.ts house style)

npx vitest run tests/venue-records-sections.test.ts
#   12/12 PASS  (no database needed)

npx vitest run tests/integration/venue-records.test.ts
#   15/15 PASS  (against afldb_test; truth re-derived from raw matches /
#   player_match_stats, venues discovered dynamically)
```

Pre-existing unrelated red on this workstation (NOT caused by ISSUE-150), confirmed
before and tracked elsewhere:

- `tests/reference-data.test.ts` §H12 — `external_grid_*` privilege-registry drift = **AFLDB-ISSUE-138**.
- `tests/finals-semantics-contract.test.ts` — Windows-checkout CRLF false-fail on migration 084 (passes on Linux); see memory `windows-crlf-contract-test`.

## 2. Still required from the operator

### 2a. Evidence SQL spot-check

```bash
# from the worktree, with a psql that can reach afldb_test:
psql "postgresql://<user>@127.0.0.1:5432/afldb_test" \
  -v ON_ERROR_STOP=1 -f ISSUE-150-venue-evidence.sql \
  | tee ISSUE-150-test-db-evidence.txt
```

Then compare the implementation output against that evidence for at least:

| Check | Evidence section | Implementation |
|---|---|---|
| total matches, first/latest | §1, §2 | `getVenueOverview` |
| club W-D-L, win % | §3 | `getVenueClubRecords` |
| attendance NULL vs 0, min recorded | §4, §5 | `getVenueRecords` (`lowestAttendance`) |
| highest team score | §6 | `getVenueRecords.highestScore` |
| biggest winning margin | §7 | `getVenueRecords.biggestMargin` |
| top-5 games / goals / marks / kicks / handballs | §8–§12 | `getVenuePlayerLeaders` |
| stat coverage / sparse vs modern rows | §13–§15 | drives the "Recorded …" wording |

Representative venues: `melbourne-cricket-ground` (high volume), `kardinia-park`
(single-club dominant), a 2–6-match ground such as `hands-oval` (low volume).
Note: as of this `afldb_test`, **no** match has a recorded `attendance = 0`
(evidence §5 `attendance_zero` is empty everywhere) — the code path is covered by
the component test and by the integration test's guarded case, and would render `0`
as `0` if such a row ever appears.

### 2b. Build (needs a real `DATABASE_URL` — the venue page prerenders all ~52 slugs)

```bash
DATABASE_URL="postgresql://<user>@127.0.0.1:5432/afldb_test" npm run build
```

### 2c. DEV deploy + browser smoke

```
deploy/sync-dev.ps1
```

Then on desktop and a narrow mobile width:

- `/venues/melbourne-cricket-ground` — overview, venue records, club records
  (24 identities), player leaders (5 boards), 10-match preview + "Complete match
  history" link. Table does not push the page sideways at ~360px.
- `/venues/melbourne-cricket-ground/matches` — page 1, Next → page 2, `?page=` in
  the URL, newest first, 100 rows/page.
- a low-volume ground (e.g. `/venues/hands-oval`) — every section still renders or
  is cleanly omitted.

---

## Reference: smoke numbers captured on the implementation workstation (afldb_test, via the query functions)

These are what the implementation returned — the operator's §2a run should reproduce them.

```
Melbourne Cricket Ground
  overview: matches=3200  withAttendance=3081  avg=44030
            first = #6 1897 Melbourne v Geelong
            latest = #17923 2026 Geelong v Carlton
  club rows = 24 ; top: Melbourne G1299 W674 D10 L615 51.89% ;
            Richmond G812 W433 D11 L368 53.33% ; Collingwood G730 W392 D12 L326 53.7%
  records: highest attendance 121,696 (1970) ; lowest recorded 1,071 (1911) ;
           highest team score 216 Hawthorn (1992) ; biggest margin 165 (2011)
  games:     Pendlebury 280, Sidebottom 237, K.Bartlett 200, Riewoldt 194, D.Fletcher 186
  goals:     M.Richardson 464 (152 rec), M.Lloyd 461 (133), Riewoldt 408 (194), Neitz 386, Carey 380
  marks:     M.Richardson 1319 (152), Sidebottom 1227 (237), Cloke 1159, Howe 1155, Pendlebury 1127
  kicks:     K.Bartlett 4197 (200), Pendlebury 3485 (280), Sidebottom 3153, Swan 2772, N.Buckley 2609
  handballs: Pendlebury 3565 (280), Sidebottom 2302, S.Mitchell 1926, N.Jones 1900, C.Oliver 1766
  match history total = 3200 (NOT capped at 50)

Kardinia Park
  overview: matches=740  withAttendance=733  avg=21113  first=#3890 1941  latest=#17849 2026
  club rows = 23 ; Geelong G738 W501 D5 L232 67.89% ; St Kilda G65 20% ; Melbourne G63 30.16%
  records: highest attendance 49,107 (1952) ; lowest recorded 4,500 (1941) ;
           highest team score 233 Geelong (2011) ; biggest margin 186 (2011)

Hands Oval  (low-volume)
  overview: matches=2  withAttendance=2  first=#16734 2025 North Melbourne v West Coast
            latest=#17751 2026 North Melbourne v Fremantle
  club rows = 3 ; North Melbourne G2 W1 L1 50% ; Fremantle G1 100% ; West Coast G1 0%
  records: highest attendance 13,331 (2026) ; lowest recorded 12,715 (2025) ;
           highest team score 155 Fremantle (2026) ; biggest margin 124 (2026)
```
