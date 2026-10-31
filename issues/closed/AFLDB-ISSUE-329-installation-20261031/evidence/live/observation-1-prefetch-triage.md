# Observation 1 (pending Next.js prefetches): triage, 2026-10-31

Source observation: `docs/v2/production-execution-record-2026-10-31.md` §3, "Next.js link-prefetch requests
(`?_rsc=`) stayed pending for 16 s or more after load". Inputs: the two authenticated smokes of this session
(`A5-smoke-attempt2.console.log`, `B2-smoke.console.log`, `B2-smoke/results.json` `pendingAfterLoad`). No new probe
was run against production.

## Question: is actual navigation impaired?

**No, on this evidence.** In both smokes every click navigation through the site's own links completed and rendered:

| Smoke | Navigation | Result |
|---|---|---|
| A5 attempt 2 (`QNEHXAtU53TzUjj0Mb7mv`) | admin → `/` (link), `/` → `/players`, `/` → `/clubs` (header links) | `/` past the beta gate; `/players` h1 "Players", 3,171 main chars; `/clubs` h1 "Clubs", 921 chars; 0 console errors, 0 bad static |
| B2 (`JYIBkYn8ynPgYMn1e5nK-`) | the same | identical figures; 0 console errors, 0 bad static |

## What the "pending" figure measures

`live-accept.mjs` adds every request to an in-flight map and removes it only on `requestfinished` or
`requestfailed`. The recorded set **only grows** across the run (B2: 3 → 6 → 21 → 36 entries). On `/players` and
`/clubs` it still lists the home page's prefetches (`/?_rsc=…`, `/matches/…`, `/players/gary-ablett-4701`, …), which
belong to documents that a full `goto`/`reload` had already replaced. So the figure is cumulative across document
changes and does not show that a prefetch is pending on the current page.

## Not established

Whether each prefetch response eventually completed on the wire was not measured: that needs a per-request timing
probe with an authenticated beta session. It was not run, because the navigation question is answered and the
window's authority covered only read-only inspection.

## Disposition

No defect registered: there is no confirmed user-visible impairment. If a future smoke needs this signal, the harness
should clear its in-flight map on main-frame navigation and record per-request durations.
