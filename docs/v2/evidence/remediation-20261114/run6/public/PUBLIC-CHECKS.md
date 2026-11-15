# ISSUE-365 B1a: public-page prep (read-only analysis at C′ a2e6ea99)

> Packet 6 (`../RELEASE-AND-REPAIR-PACKET-6.md`) governs. It runs B1a **before** the B1 build, so the prebuilt entries of the new
> release are rendered from repaired rows and the page checks run straight after B1 step S8, with no allowance. The 75-minute
> allowance in §3 applies only if B1a runs **after** the build (the alternative order) or after a rollback to `c1c4b22e`.

Source: worktree `D:\dev\afldb-rem-20261114` (C′). Nothing was executed: no SSH, DB, npm/node or git. All commands below are
for the owner or operator to run (CLAUDE.md §9). Next is 16.3.1 (C′ `package.json:66`; the ISR internals cited are from
`D:\dev\afldb\node_modules\next`, also 16.3.1).

**The core fact.** B1a changes only `player_season_stats.brownlow_status` for 2026. `brownlow_votes` stays NULL before and after
(`run5/b1a/README.md:18`). So only a surface that renders the **status** can change. In all of `src/`, the only reader of
`brownlow_status` is `getPlayerSeasons` (`src/db/queries/players.ts:622`). The only renderer is the player page's season table
(`src/app/players/[slug]/page.tsx:612-613`). Every other Brownlow surface reads `brownlow_season_votes` (0 rows for 2026),
career sums or per-match votes. Those values are the same before and after the repair.

## 1. Surface table

| Route | Data source | Cache | 2026 text today (`not_applicable`) → after B1a (`pending`) | Cite |
|---|---|---|---|---|
| `/players/[slug]`, Season-by-season table, **BV cell** (visible) | `player_season_stats.brownlow_status` via `getPlayerSeasons` | ISR `revalidate = 3600`. `generateStaticParams` prerenders the 500 most-viewed at build. The other players render on first request and are then cached | **"No medal" → "Not yet awarded"** | page.tsx:55, 71-74, 612-613; format.ts:41-44 |
| same cell, `title` tooltip (hover only; read by some screen readers) | same | same | **"No Brownlow Medal was awarded for this season." → "The season is still in progress; the Brownlow Medal has not been awarded."** | page.tsx:612; format.ts:55-58 |
| same row, Season cell badge | `seasons.status` | same | No "In progress" badge, before or after (2026 is `complete`) | page.tsx:592-594 |
| `/players/[slug]` Brownlow Medal section, meta description, career "Brownlow votes" tile | `brownlow_season_votes` (votes > 0) and career totals | same | No 2026 row. Unchanged | page.tsx:143-145, 625; players.ts:764-777 |
| `/seasons/2026` Brownlow section | `getSeasonBrownlow` → accepted `brownlow_season_votes` | ISR 3600, every season prerendered | **Same in both states:** "No votes recorded for 2026" / "The season count for this year is not in AFLDB." The "Season in progress" notice is not shown (status is `complete`) | seasons/[year]/page.tsx:46, 54-57, 255-264, 793-800; seasons.ts:191-203 |
| `/brownlow/2026` | `brownlow_season_votes` | ISR 3600 | **404 in both states** (`notFound()` when there are no rows) | brownlow/[year]/page.tsx:15, 80-81 |
| `/brownlow` (winners, career leaders) | `brownlow_season_votes` | `force-dynamic` | No 2026 entry. Unchanged | brownlow/page.tsx:10, 21 |
| `/clubs/compare`, Brownlow history | `stat_availability` (already `pending`) and vote rows | `force-dynamic` | The "Excluded … (pending)" notice lists only seasons that have vote rows, so 2026 is absent today and after. Unchanged | clubs/compare/page.tsx:20; ClubComparisonBrownlow.tsx:206-212; club-comparison.ts:1323-1327 |
| `/clubs/[slug]` medallists, `/players` list, `/players/compare`, `/records/*`, `/matches/[id]` BV column | season-vote rows, career sums, per-match votes | various | Unchanged (votes NULL in both states; the match BV column uses `formatStat`) | clubs/[slug]/page.tsx:142; players/page.tsx:222; players/compare/page.tsx:163; matches/[id]/page.tsx:102, 219 |
| NL search answers | static `NL_COVERAGE` and vote columns. `brownlow_status` is never read | n/a | Unchanged | search/nl/plan.ts:1404-1422 |
| Grid Solver | published medal and career-vote criteria | n/a | Unchanged | grid-solver-spec.ts:432-433; db/queries/grid-solver.ts:291 |
| `sitemap.ts`, root `opengraph-image.tsx`, APIs (`src/app/api/*`) | `brownlow_season_votes` years; no status | n/a | Unchanged. No API returns player-season Brownlow status | sitemap.ts:136-138, 175-176 |

**Does any public surface read the coverage rows and so already show `pending` wording today? No.** `stat_availability` is read
publicly only by `/clubs/compare` (2026 is not listed there, see the table) and by `getClubSeasonBrownlowSummary` /
`getClubSeasonComparison` (club-comparison.ts:1507, 2341). Those two have **no caller** in `src/app`. Every other coverage
reader is admin. Today, no public page shows "Not yet awarded" for 2026.

## 2. What visitors will read after B1a without D-365-W

On every 2026 player's page, in the Season-by-season table, the 2026 row's **BV** cell changes from **"No medal"** to
**"Not yet awarded"**. Hovering it shows **"The season is still in progress; the Brownlow Medal has not been awarded."** in
place of **"No Brownlow Medal was awarded for this season."** No other public text changes.

Why the new wording is still wrong:
- 2026 is `complete`. The same row carries no "In progress" badge (page.tsx:592-594), so the tooltip contradicts the row it is on.
- The 2026 Brownlow Medal has been awarded in the real world (the count follows the home-and-away season). "Not yet awarded" is
  a false claim about the world. The true state is that AFLDB has not loaded the result yet, which is what D-365-W says.

How it compares with today:
- Today's text says the medal **does not exist** for 2026 ("No medal"; "No Brownlow Medal was awarded"). That puts 2026 in the
  same category as 1942-1945 and pre-1924, which is a permanent-sounding factual error.
- After B1a, the text says the medal is **outstanding**. It is still false (wrong tense, wrong reason), but it signals a gap
  that will be filled, not a fact. It also matches the coverage rows (`pending`) and the medal-loading model.
- Neither state shows a number. Sorting is identical (`bv: brownlowVotes ?? -1`, page.tsx:585).

**Surfaces where the two states render identically:** every surface except that cell and its tooltip, including
`/seasons/2026`, `/brownlow/2026` (404), `/brownlow`, clubs, compare, records, NL search, Grid Solver, sitemap and metadata.

**For the owner's decision:** repairing now swaps one false sentence for a less misleading one. Waiting for D-365-W gives a
single change straight to the true sentence ("Brownlow Medal results for this season have not been loaded yet."). It needs a
later release, because D-365-W is a code change at format.ts:42/56 and is not in C′. B1a is a data step either way. Doing it
first means that when D-365-W ships, the new wording appears with no further data change.

## 3. Cache-refresh allowance

- **Cache mode.** `/players/[slug]` is ISR with a 3600 s revalidate (page.tsx:55). An expired entry is served once, stale,
  while it regenerates in the background. The **next** request gets the fresh render. Nothing invalidates it when the database
  changes. Production measured this in ISSUE-133: prerender 22:14:46, rows written 22:37:47, page regenerated 23:50:48
  (season-revalidation.ts:7-9).
- **Per worker.** Each cluster worker has its own in-memory LRU in front of the shared on-disk cache, plus its own
  `tagsManifest`. Next 16 has no cross-process page invalidation (season-revalidation.ts:11-21). Requests are round-robined by
  **connection**, so one fresh `curl` reaches one worker.
- **Worker count.** The brief says 4. `deploy/afldb.service:82-83` documents production as `AFLDB_WORKERS=2`. When the
  variable is unset, the count is `min(4, cores)` (server-cluster.mjs:25-28), which is 2 on the 2-vCPU droplet. Read
  `AFLDB_WORKERS` from the host `.env`. N changes how many samples a check needs, not the time bound.
- **New release (B1).** `release.mjs build` runs `next build` against the checkout's `.env`, so against the production
  database (release.mjs:1073-1083). The release therefore ships **prebuilt** entries for all `/seasons/*` pages and the 500
  most-viewed players, rendered with `not_applicable` data and timestamped at build time. Other players have no entry until
  their first request. The server writes regenerations back into the release tree (release.mjs:150-157). A B1 release built
  before B1a therefore serves "No medal" until each entry expires.
- **Restart does not reset staleness.** On a cache miss in memory, the entry's `lastModified` is the file **mtime**
  (file-system-cache.js:95-117). A restart clears only the per-worker memory and `tagsManifest`. Restarts are owner actions
  (attended restart, ISSUE-351).
- **Maximum time to convergence.** Any entry written before the commit expires by **T_commit + 3600 s**, plus a few seconds of
  render time if a regeneration was in progress across the commit. After that, each worker needs one request to trigger its
  regeneration and a second request to serve the fresh page.
- **On-demand revalidation that already exists:**
  - `/api/internal/revalidate-season` refreshes `/seasons/<year>` only. That page does not render this status, so it does not help.
  - `POST /admin/operations/brownlow/revalidate` needs the admin capability `data.brownlow.finalise`. It runs
    `revalidatePath('/players/[slug]','page')` and others (route.ts:6-10).
  - Admin Brownlow server actions also call it (admin/brownlow/actions.ts:135, 291).
  - All of these act **only on the worker that handles the request**. They are side paths of other workflows and are not
    recommended here. No new code is proposed.
- **Recommended allowance:** begin the checks **75 minutes after the B1a COMMIT timestamp** (60 min window plus 15 min margin).
  Before checking, send a warm-up pass (section 4).
- **If a page is still stale after the allowance and the warm-up:**
  1. Check the on-disk entry on the host, read-only: `ls -l --time-style=full-iso` and `grep -o` on
     `/home/arm/afldb-releases/current/.next/standalone/.next/server/app/players/<slug>-<id>.html`.
  2. If the mtime is **before** the commit, no regeneration was triggered yet. Warm again and wait 5 minutes.
  3. If the mtime is **after** the commit and the file still says "No medal", it is **not** a cache problem. Re-run the B0
     `pss2026` query (read-only) and stop.
  4. If only one worker stays stale for more than 2 hours, report it to the owner. An attended restart is an **owner action**,
     and it does not refresh a disk entry that is less than an hour old.

## 4. Post-repair public checks

**Picking players.** These are production slugs from prior prod evidence:
- `nick-daicos-9910`, `matt-rowell-9235`, `toby-greene-12446`, `ollie-wines-10130` (gap016-recon-20261102/public-inspect.cjs:16-20)
- `scott-pendlebury-11724` (ISSUE-330 D4-accept results.json:208)

IDs differ between databases (Pendlebury is 4182 in test fixtures), so confirm read-only before use, inside the B0 probe's
read-only transaction:
`SELECT p.slug||'-'||p.id AS path, s.brownlow_status::text FROM player_season_stats s JOIN players p ON p.id=s.player_id WHERE s.season=2026 AND p.id IN (9910,9235,12446,10130,11724);`

Use 3 players: one prerendered (Pendlebury is the likeliest in the top 500), one on-demand, and one more. Add one 2026
debutant (`... WHERE s.season=2026 ORDER BY s.games LIMIT 1`). Do not use a player whose career includes 1942-1945 or
pre-1924, because "No medal" is legitimate on those rows.

**How prior runs checked pages.** Loopback on the host: B0 used `curl http://127.0.0.1:$PORT/...`, and PORT=3100 from `.env`
(run5/b0-prod-probe.sh:36-37; result line 62). Rendered pages need a beta claim cookie. `release.mjs` mints its own for the
release smoke (`smokeClaimCookie`, release.mjs:772-780). An anonymous request only returns 307 (middleware.ts:156-159;
redirect.ts:37), and earlier ISR measurements went wrong by ignoring that (memory: dev-beta-gate-breaks-isr-measurement).

**Procedure.** Run on the host as `arm`. It is read-only and writes one temporary cookie file, which it removes.

```bash
C=/home/arm/projects/afldb; NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
P=$(sed -n 's/^PORT=//p' "$C/.env" | tail -1 | tr -d '"'); P=${P:-3100}
CK=$(mktemp); chmod 600 "$CK"
( set -a; . "$C/.env"; set +a; "$NODE" -e 'const{createHmac}=require("crypto");const e=process.env;
const p=Buffer.from(JSON.stringify({v:1,kind:"beta",sub:"b1a-check",exp:Math.floor(Date.now()/1000)+900,epoch:Number(e.AFLDB_BETA_EPOCH??1)}));
process.stdout.write("afldb_beta="+p.toString("base64url")+"."+createHmac("sha256",e.AFLDB_SESSION_SECRET).update(p).digest().toString("base64url"))' ) > "$CK"
hit() { curl -s -m 60 -H "Cookie: $(cat "$CK")" -o /tmp/b1a.$$ -w '%{http_code}' "http://127.0.0.1:$P$1"; }
cnt() { grep -o "$1" /tmp/b1a.$$ | wc -l; }
for u in /players/<A> /players/<B> /players/<C>; do for i in $(seq 1 12); do hit "$u" >/dev/null; done; done   # warm-up pass
for u in /players/<A> /players/<B> /players/<C>; do for i in $(seq 1 16); do c=$(hit "$u")
  echo "$u $c notyet=$(cnt 'Not yet awarded') pendnote=$(cnt 'still in progress; the Brownlow Medal has not been awarded') nomedal=$(cnt 'No medal') nanote=$(cnt 'No Brownlow Medal was awarded for this season')"
done; done
echo "anon $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:$P/players/<A>)"
echo "s2026 $(hit /seasons/2026) novotes=$(cnt 'No votes recorded for') b2026=$(hit /brownlow/2026)"
rm -f "$CK" /tmp/b1a.$$
```

Each `curl` opens a fresh connection, so it lands on the next worker. 16 samples cover 2 or 4 workers several times.

**Pass criteria, after the allowance:**

| Check | Expected |
|---|---|
| Every sampled `/players/<2026 player>` | `200`; `notyet ≥ 1`; `pendnote ≥ 1`; `nomedal = 0`; `nanote = 0`, on **all 16 samples** of each URL |
| Anonymous `/players/<A>` | `307` to `…/beta?from=%2Fplayers%2F<A>` (the beta gate still holds) |
| `/seasons/2026` (control) | `200`; `novotes ≥ 1`. Identical before and after |
| `/brownlow/2026` (control) | `404`. Identical before and after |

Counts may be 2 rather than 1 because the string can also appear in the RSC payload. Assert presence and absence, not
exact counts.

If a mix of old and new text appears **inside** the allowance, that is expected per-worker convergence, not a defect
(memory: prod-landing-pages-isr-per-worker).

**Baseline before B1a (optional).** Running the same loop before the commit should show `nomedal ≥ 1`, `nanote ≥ 1` and
`notyet = 0`. That proves the probe can see the change.

**Public spot-check.** The owner can view one page at `https://beta.afldb.com/players/<A>` in their own admitted browser, and
hover the 2026 BV cell, as gap016's `public-inspect.cjs` did. Do not send the minted cookie over the public route.

**If D-365-W later ships,** replace the two "after" strings with the new wording, then re-run this loop with the same
allowance.
