# ISSUE-316 C2 approval package v4 — consolidated readiness decision

Prepared 2026-10-21 with one agent. **C2 NOT EXECUTED; execution approval NOT granted.**
v4 supersedes v3's "next bounded source inputs" with one consolidated approval request (V4
section below). v3, v2 and v1 sections are retained as evidence history, not as open requests;
the old inspection wording is not a request to repeat production inspection.

## V4 consolidated readiness decision — 2026-10-21

Baseline `7157be43cbee1501a71cfc1c3e0ce83d20f1f892`, `v2/rebuild`, one agent, documentation
edits only. Used retained local evidence only: this package, the C0/C1 record, the completed
inspection `findings.md`, and a read of the current-tree validators
(`tools/migration/import_fitzroy_core.py`, `tools/rebuild/fitzroy/fitzroy-contract.json`,
`tools/db/rollover-season.ts`) and the quarantined historical wrapper
`legacy/offline/tools/rebuild/fitzroy/acquire_core.R`. No network, host, package, database,
WSL, validator or acquisition activity occurred.

**Verdict: READY TO REQUEST the single approval below; NOT executable-ready.** Four owner
decisions are needed (K1–K4); two of them supply numbers that cannot honestly be derived from
retained evidence. No further source download and no further offline audit is required first.

### Remaining concrete blockers (owner decisions, not evidence gaps)

| # | Needed | Why it cannot be inferred |
|---|---|---|
| K1 | Confirm the runner: DEV `streamanator` (`arm@10.0.40.100:22`, alias `dev`), new mode-700 root | Only runner with retained non-production evidence, but **R, fitzRoy and outbound reachability on it were never inspected** (all R evidence is the production host's). The approval makes that a read-only first step with a hard stop; installation is excluded. |
| K2 | Accept the **unchanged** acquisition (no optimisation) | See "Repeated downloads" below. |
| K3 | Accept authoring and loopback self-testing of a small stdlib run guard (steps P3–P4) | It is the only way to make host, connection, byte and pacing limits enforceable without root. Declining it leaves only OS time/size limits and observation. |
| K4 | Supply `OWNER_MAX_INGRESS_GIB` (core and ladder) and `ROOT_BYTES_MAX` | Download sizes were never measured; inventing them is refused. Step P5 measures them and stops if the projection exceeds the owner's ceiling. |

### What is and is not a blocker

| Class | Items |
|---|---|
| **Genuine blockers** | K1–K4 above. Negative P1 result (R/fitzRoy 1.8.0/jsonlite/digest absent or R < 4.1 on the runner) ends the approval; it is not repaired by installing. |
| **Bounded by explicit runtime control** | R/xml2/readr redirect, timeout and retry behaviour (outer wall-clock, connection and host limits plus a behavioural canary replace reading three more package sources); installed-code vs reviewed CRAN source (record and compare hashes; the outputs are judged by independent validators, not by code identity); mutable GitHub parquet changing mid-run (pre/post HEAD comparison); CRLF in the extracted wrapper (parse-only check); lost site library path under `--vanilla` (explicit `R_LIBS_SITE`). |
| **Ordinary implementation detail** | Exact script/ledger formats, the extraction timestamp in the root name, evidence filenames, `du` polling interval, and the stats-completeness script's internals. None needs its own approval cycle. |

### Runner

Established by retained evidence for `streamanator`: SSH alias `dev` resolved to `arm@10.0.40.100:22`
twice, x86_64, Node v22.23.2, `/usr/bin/python3` used by the passing C1 shell tests, 80,559,512 KiB
free, mode-700 roots are the precedent, `sudo -n` unavailable, owner already approved
transfer of a source archive there. **Not established:** R, fitzRoy, the 56-package closure, outbound
HTTPS to github.com/afltables.com, `timeout`/`curl` presence. The production host has the
verified R 4.3.3 + fitzRoy 1.8.0 stack but is the live system and is excluded by the "non-production"
requirement. Windows has only an R 4.6.1 used for refusal tests with no fitzRoy evidence, would need a
large dependency install, and does not prove Linux behaviour. **Recommendation: DEV, probe-first.**
If P1 fails, the specific owner choice is between (a) a separately scoped installation of R + the
pinned closure on DEV (needs privilege; `sudo -n` is unavailable) and (b) a production-host maintenance
root, which should only be considered with its own writer-pause review. WSL stays stopped; `D:` is
not used for generated artifacts; evidence returns to a new restricted `C:` directory.

### Repeated downloads (130 parquet, 131 results)

Structure, from the traced source: 130 full GitHub parquet downloads (one per stats call), 131 full
`bg3.txt` reads (1 core results + 130 ladder), 21 club pages, plus U season-index pages, M match pages
and H mapping reads **only in the 2026 call** when the cache's max date precedes today. For seasons
before 2026 the requested end date is below the cache max date, so no live tail is attempted;
U ≤ 4 and H ≤ 1 are generous bounds, M ≤ 218 (the number of stored 2026 matches). Sizes: unmeasured.

**Recommendation: unchanged acquisition with a measured budget.** Reasons: (1) it is a one-off,
D-316-1 authorises exactly one final acquisition; (2) it is the only path with proven acceptance
lineage, the accepted 129-season baseline has the same 131-file shape; (3) any optimisation (a single
parquet fetch and local-file injection, one shared results read) is new code on the data path that would
need its own tests and a byte-identity proof against the unchanged path, which itself needs network
requests; (4) the cost is volume only, and volume is bounded by pacing, connection and byte caps plus an
owner ceiling. **Fallback:** if the P5-measured projection exceeds the owner ceiling, the run stops and
a separately scoped, tested optimisation proposal replaces this approval. No code or acceptance
semantics change now.

### Cache-only and partial results: what detects them

What can produce them (source trace): a failed season-index read is swallowed (becomes NULL) and the
2026 stats call silently returns cache rows only. Page, mapping, parquet, club and results failures
propagate to the wrapper, which stops before writing any manifest.

| Check (actual code) | Catches cache-only 2026 stats? |
|---|---|
| Wrapper `acquisition_observations` (acquire_core.R:459–467) | **No.** Structural only; it records nothing about live-tail success. |
| `validate_snapshot` SHA-256, columns, row count, version pin | **No.** A cache-only file is self-consistent. |
| `enforce_full_history` (season set 1897–2026, non-zero rows, no duplicates, range) | **No.** 2026 would be non-empty. |
| `measure_identity_coverage` (profile URL shape) | **No.** |
| Gate 2 `enforce_accepted_fingerprint` | **No.** The successor `measured` block is computed by gate 1 from the same bytes, so gate 2 detects drift between gates, not staleness. |
| `import_fitzroy_core.py` import-time `incomplete_match_evidence` (line 2207) | Would reject match rows with no player rows, but only at import, which C2 never runs. |
| Census, `--expected-club-season-rows` | **No.** They concern ownership and ladder rows. |

**Coverage gap (G1):** no automated gate asserts that a completed season's stats cover every results
match, so `matches` and `matches_with_player_rows` are recorded by gate 1 but never required equal
(the accepted 2025 baseline has them equal, 16838/16838). Checks are not weakened and no code
changes. The approval below inserts a mandatory **offline completeness check (E1, E2, E4) between
the two acquisition steps**; failure stops the run before the ladder and before any Stage 2 hand-off.
E3 is carried forward to Stage 2/3 review:

- E1 `results.csv` has exactly the stored 2026 count, **218** matches, including the Grand Final scored
  89 and 96 for Fremantle and Brisbane.
- E2 distinct 2026 matches in `player_stats_2026.csv` equal E1's count, per round and in total
  (team-name spelling is informational only).
- E3 (a Stage 2/3 review criterion, not run by this approval) the gate-1 summary must show `matches` = `matches_with_player_rows`; derived
  expectation if history is unchanged: 16838 + 218 = **17056** both. This is a comparison, not a tunable
  pass threshold; any difference needs explained adjudication.
- E4 captured stdout/stderr contain no warning or error naming an `afltables.com/afl/seas` or
  match-page read, and the guard ledger shows an `afltables.com` connection with non-zero ingress in
  the 2026 stats window.

A durable fix is a **separate, tested validator gate** (completed-season coverage equality); it is
out of scope here and recorded as follow-up, not a precondition.

### Smallest runner and runtime requirements, and how each is enforced

| Requirement | Mechanism | Enforceable? |
|---|---|---|
| Wall-clock | `timeout --kill-after=60s N` around the guard | Yes (kernel signals) |
| Clean environment | `env -i`, explicit `PATH`, `HOME`, `TMPDIR`, `R_LIBS_SITE` (value from P1), empty `R_LIBS_USER`, `Rscript --vanilla`, no `.env` in the root | Yes; `--vanilla` disables Renviron, so the library path must be explicit |
| Storage | Root, `HOME`, `TMPDIR`, R user cache all inside the new mode-700 root; pre-run free-space floor; per-file `ulimit -f`; guard polls the root size and kills on `ROOT_BYTES_MAX` | Yes for the root; the cap is polled, not a quota |
| Host allowlist, connection cap, byte cap, AFL Tables pacing | Guard is a local CONNECT/HTTP forward proxy; `http(s)_proxy` set in the child; breach or denied host kills the process group | Yes **only for clients that honour proxy variables**; P4 proves this per transport (below). It sees connections, hosts and bytes, never HTTP method, path or status inside TLS |
| Redirects | Not configurable in unchanged clients; each hop is a new connection to an allowlisted host and counts toward the cap | Indirect |
| Retries | None in fitzRoy or the wrapper; any lower-level retry is bounded by the connection and byte caps | Indirect |
| Logical request count | Wrapper `fetching:` lines plus per-connection ledger | **Observational only, not enforceable** |
| A denied host cannot become a silent cache-only result | Guard kills the run on any denial instead of returning an error to R | Yes |
| Installed code | Record `fitzRoy`/`jsonlite`/`digest` DESCRIPTION and lazy-load SHA-256s; compare with the retained production values (fitzRoy DESCRIPTION `62b1c1b3…6444`); the 56-package version list from `offline-review-v2.json` | Recorded; mismatch is reviewed, not a stop (versions must still be exact for fitzRoy) |

### Additional source download

**None is indispensable.** v3's remaining source inputs (R `download.file`/`url`, xml2 1.3.6
`read_html`, readr 2.1.5 dispatch, then vroom/curl) would only describe default redirect/timeout/retry
behaviour, which does not change go/no-go once outer limits apply. The P4 canary tests each reachable
transport behaviourally against a fake host answered by the guard, with no external traffic. **Only if
P4 shows a transport ignoring the proxy** would a source become necessary: that package's exact CRAN
source (for example xml2 1.3.6; the CRAN URL form depends on whether it is still current or under
`src/contrib/Archive/xml2/`, unverified), to decide how that one path can be routed. Not requested now.

### Consolidated next approval (copy-ready; unresolved values marked `‹…›`)

> I authorise one C2 preparation-and-acquisition operation, bounded as follows. **Target:** SSH alias
> `dev`, conditional on identity `arm@10.0.40.100:22`, hostname `streamanator`, x86_64, and at least
> 6,291,456 KiB free. **Root:** a new mode-700 `/home/arm/issue316-c2-final-‹UTC stamp›` (refuse if it
> exists), containing `incoming`, `src`, `guard`, `evidence`, `tmp`, `home`. **Evidence:** a new restricted
> `C:\tmp\afldb-c2-acquisition-‹UTC stamp›` (inheritance disabled, owner and SYSTEM only). WSL stays
> stopped; `D:` receives nothing; no sudo, installation, package download, repository checkout,
> cleanup or service change. Loading the already-installed R packages for P4, A1 and A2 is authorised.
>
> **P0** verify identity and space. **P1** read-only runtime probe: `command -v Rscript timeout python3`,
> versions, effective `.libPaths()`, the 56-package DESCRIPTION versions, the DESCRIPTION and lazy-load
> SHA-256s for fitzRoy/jsonlite/digest, CA bundle hash. STOP unless R ≥ 4.1, fitzRoy exactly 1.8.0, jsonlite
> and digest present, no missing closure names, `timeout` present. **P2** transfer the existing C: archive
> (118,046,720 bytes, SHA-256 `196035d949244f392943224133e71ddf96d62af0846e15811cd63b8221b01f69`)
> to `incoming`, verify size/hash, extract into `src` without overwrite; then verify
> `data/reference/afltables-network.json` is `active` with `last_season` 2026,
> `seasons.json` in-progress is `[2026]`, and `Rscript -e 'invisible(parse("tools/rebuild/fitzroy/acquire_core.R"))'`
> succeeds (parse-only). **P3** author the stdlib run guard (CONNECT/HTTP forward proxy, ledger, caps,
> pacing, root-size watch, process-group kill) and the stdlib completeness script (E1–E2) on `C:`,
> hash them, copy to `guard`, and self-test the guard on loopback with a local fake upstream (allow,
> deny, connection cap, byte cap, pacing, kill). **P4** canary: with the guard and the exact flags/environment
> below, call `utils::download.file`, `base::url`+`readr::read_csv`, `xml2::read_html` and
> `readr::read_fwf` against `canary.invalid`, which only the guard answers. STOP unless all four reach the
> guard and none connects directly. **P5** measure: one HEAD each for the parquet URL
> `https://github.com/jimmyday12/fitzroy_data/releases/download/data/afltables_player_stats.parquet` and
> `https://afltables.com/afl/stats/biglists/bg3.txt`; record Content-Length, ETag and Last-Modified.
> Projected ingress = 130 × parquet + 131 × bg3; STOP if it exceeds `‹OWNER_MAX_INGRESS_GIB›` (core and
> ladder separately) or any length is absent.
>
> **A1** run, under the guard, from `src`:
> `/usr/bin/Rscript --vanilla tools/rebuild/fitzroy/acquire_core.R --acquire --label c2-2026-final-core-v1 --from 1897 --to 2026 --datasets player_stats,player_details,results`
> (Rscript path from P1). **E** then run E1, E2 and E4 offline. **A2**, only if A1 exited 0, its manifest exists and E passed:
> `... --label c2-2026-final-ladder-v1 --from 1897 --to 2026 --datasets ladder`.
> Guard limits per command (proposals, judgement not measurement): wall-clock 3 h; connections 700
> core / 300 ladder (core: 3 per parquet call for redirects + 21 + 1 + U + M ≤ 218 + H); allowlist
> `github.com`, `*.githubusercontent.com`, `afltables.com`, `www.afltables.com`; AFL Tables pacing ≥ 2 s
> between connections; ingress ≤ `‹per P5 ceiling›`; root ≤ `‹ROOT_BYTES_MAX›`; per-file `ulimit -f`
> `‹value›`. **Environment:** `env -i PATH=/usr/bin:/bin HOME=‹root›/home TMPDIR=‹root›/tmp
> R_LIBS_SITE=‹P1 effective› R_LIBS_USER=‹root›/home/rlib http_proxy/https_proxy/HTTP_PROXY/HTTPS_PROXY=guard no_proxy=`.
>
> **Redirects/retries/budget:** no automatic retries. One re-run per command is permitted under the reserved
> labels `c2-2026-final-core-v1-r2` / `c2-2026-final-ladder-v1-r2` only for a transport failure before a
> manifest (not a guard denial, cap breach, E failure or validation failure); it counts against the same
> cumulative ceiling. After the run, repeat the parquet HEAD; a changed ETag or Last-Modified stops
> hand-off for owner review. **Outputs:** `src/data/sources/afltables/fitzroy_core/c2-2026-final-{core,ladder}-v1/`
> CSVs and `src/docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-{core,ladder}-v1.json`
> (manifest written last, `completeness: unvalidated`), then copy to the `C:` evidence directory with
> separate stdout/stderr, ledgers, P1/P4/P5 records, environment digest, file hashes, `OWNER_MAX` values,
> and one tar with its SHA-256 if `C:` has twice the space.
>
> **Stop conditions:** identity/space mismatch; any P-step failure; guard denial or cap breach; non-zero
> exit; existing label or directory; any warning or error naming a season-index or match-page read; E1, E2
> or E4 failure; changed parquet ETag/Last-Modified; output outside the root; any request for scope expansion.
> Preserve everything and return. **Exclusions:** no validator or census run, no database, no Node/psql, no
> rollover or six-file edit, no deployment or timer/service/polkit change, no production access, no
> importer, no witness `--compare`, no D-316-1 apply authority. The operation produces *unvalidated*
> evidence for Stages 2–3; those, the dry run, the apply and deployment remain separately authorised.

### Unresolved values (do not invent)

`‹UTC stamp›`; `‹OWNER_MAX_INGRESS_GIB›` core/ladder; `‹ROOT_BYTES_MAX›`; `ulimit -f` value; the
runner's `Rscript` path and effective `R_LIBS_SITE` (from P1); parquet and bg3 sizes (from P5); the
actual 2026 live-tail U/M/H (from the run); DEV's reachability to the two hosts. Successor contract,
availability, corrections, ladder coverage, census scope, rollover date and expected club-season row
count remain Stage 2–5 inputs and are not touched by this approval.

## V3 source review — 2026-10-21

Baseline verified exactly: `5af44c4560af9e25e487e26c0a486f6fdc6f745c`, `v2/rebuild`,
remotes empty; only pre-existing untracked `.codex/`, preserved. Graph tools unavailable;
used direct pinned-source inspection. One agent. Owner authorised only the exact CRAN source
download and offline review. No AFL data request, package installation/loading/execution,
dependency download, production/DEV connection, database/validator/census/rollover/service,
WSL invocation, cleanup, push or new worktree. Previous C: evidence remains untouched.

### Source provenance and safe extraction

- Requested **and effective** URL:
  `https://cran.r-project.org/src/contrib/fitzRoy_1.8.0.tar.gz`.
- One GET, no retries or redirects; **HTTP 200**. Retrieval UTC:
  `2026-10-21T03:30:13.749204Z` to `2026-10-21T03:30:16.831125Z`.
- **1,222,934 bytes**, SHA-256
  **`33ed08177a8301f57644654656221f6e4bd5873018eb11c317d5f2f188d0b54c`**.
- Response: Date `Wed, 21 Oct 2026 03:30:14 GMT`, Content-Type `application/x-gzip`,
  Content-Length `1222934`, Last-Modified `Sun, 23 Aug 2026 10:41:07 GMT`,
  ETag `"12a916-659b481d38113"`, Server `Apache`. DESCRIPTION: **Package fitzRoy,
  Version 1.8.0**, R >=4.1; no new runtime upgrade requirement.
- Restricted root: `C:\tmp\afldb-c2-cran-source-20261021T143013463-045c8bc3`.
  Inheritance disabled; only current owner `Office\stuar` and SYSTEM have FullControl.
  Original tarball unchanged. Before extraction: all **194 members** checked, **182 files**,
  remaining directories, no unsafe paths, links, special files or case-colliding names.
  Extraction only to `source\fitzRoy` beneath that root; no package code ran.
- C: `retrieval.json`, `archive-inventory.json`, `source-review-provenance.json` retain evidence.
  [Small provenance manifest](issue316-c2-cran-source-2026-10-21.json) records per-file hashes;
  third-party source/archive stay outside Git. Computed hash identifies retrieved bytes;
  it is **not independently verified publisher authentication**. CRAN source matches package/
  version, but is not proven byte-identical to installed RSPM build code. Bind the selected
  installed acquisition functions to this reviewed source before acquisition authority.

### Actual reachable C2 branches

References `R/...:N` below are filenames/lines inside the downloaded `fitzRoy/` source.
Wrapper references are historical **c9cca86d** `tools/rebuild/fitzroy/acquire_core.R`,
re-read at 313–378. Direct calls bypass generic source dispatch: no fallthrough to AFL,
FootyWire, Squiggle or Fryzigg functions. Numeric seasons are 1897–2026 inclusive (130).
Stats use default `round_number=NULL`, **`rescrape=FALSE`**, `rescrape_start_season=NULL`;
details use `team=NULL`; results get the whole vector; ladder gets one season per call,
`round_number=NULL`, `match_results_df=NULL`. No new label or acceptance input selected.

| Reachable source / branch | Exact initial URL or construction | Reads and scope |
|---|---|---|
| `R/fetch-player-stats.R:159–198` | `https://github.com/jimmyday12/fitzroy_data/releases/download/data/afltables_player_stats.parquet` | **130 full downloads**, one per stats call; `utils::download.file(..., quiet=TRUE, mode="wb")` into a new tempfile; `nanoparquet::read_parquet`, then unlink on normal path. No persistent cache/reuse in this branch. Mutable release asset is not pinned by package version. |
| `R/helpers-afltables-playerstats.R:306–377`, when requested end exceeds parquet's global `max(Date)` | `https://afltables.com/afl/seas/<YYYY>.html` for every year from cache max-date year to requested end year | Sequential `purrr::map`; filters linked matches to dates **> cache max date and <= requested end**. Per-call index reads may overlap. End date is year end capped at `Sys.Date()` (`R/helpers-general.R:130–169`). Cache contents/max date were not fetched or assumed. |
| `R/helpers-afltables-playerstats.R:40–148` for selected match links | `str_replace(href, "..", "https://afltables.com/afl")` from season-page links (370) | One `read_html_fitzroy` call per resulting non-NA link; no deduplication or pagination loop. Match subpath is supplied by HTML, not a fixed code template; the transformation is not an anchored hostname/path allowlist. Tables provide player profile URLs as values; this branch does not request each profile. |
| `R/helpers-afltables-playerstats.R:266–279`, once per nonempty live-tail scrape | `https://github.com/jimmyday12/fitzRoy_data/raw/main/data-raw/afl_tables_playerstats/player_mapping_afltables.csv` | `base::url` connection passed to `readr::read_csv`; one mapping read per live-tail call, not per player. Additional GitHub source on mutable `main`; no published checksum in this code. |
| `R/fetch-player-details.R:163–185` -> `R/helpers-afltables-playerdetails.R:76–148` | `https://afltables.com/afl/stats/alltime/<slug>.html` | 21 sequential HTML reads, no year filter or per-player request. Slugs: `adelaide, brisbanel, brisbaneb, carlton, collingwood, essendon, fitzroy, fremantle, gws, geelong, goldcoast, hawthorn, melbourne, kangaroos, padelaide, richmond, stkilda, swans, westcoast, university, bullldogs` (literal three-l spelling retained). |
| `R/fetch-results.R:118–163` -> `R/utils-http.R:58–76` | `https://afltables.com/afl/stats/biglists/bg3.txt` | Reads the complete fixed-width results file, then filters the requested season range locally. One read for core results. |
| `R/fetch-ladder.R:177–189,281–317` -> same results path | Same `bg3.txt` | **130 more full reads**, because wrapper supplies no `match_results_df`; no shared results cache. Filters `Round.Type == "Regular"`, computes points/percentage and selects latest round. No published-ladder endpoint. Existing wildcard-final comparability limitation remains; no validator run. |

### Transport, fallbacks and volume limits

`R/utils-http.R:11–32,58–76` temporarily sets/restores `HTTPUserAgent` for HTML/results
reads, default `fitzRoy R package (https://github.com/jimmyday12/fitzRoy)`, overridable by
`options(fitzRoy.user_agent=...)`. `xml2::read_html(url)` and `readr::read_fwf(url,...)`
receive no explicit method, timeout, redirect policy, retry or rate-limit configuration.
The parquet `download.file` and mapping `url`/`read_csv` do not go through this UA wrapper.
These are URL reads intended to retrieve content; **actual HTTP method/redirect chains,
timeout defaults, transport retries and effective hosts are delegated to R/dependencies**.
No explicit httr/httr2 GET/POST, retry/backoff, throttle/sleep or parallel execution occurs
in this reached fitzRoy chain. No provider fallback to AFL API/FootyWire is reachable here.
GitHub release/raw redirects and any CDN hosts cannot be enumerated from fitzRoy code alone;
none were probed. The CRAN download's zero-redirect observation proves nothing about them.

Fallback is to **cached data**, not a second provider: index-page errors become NULL and are
discarded (playerstats helper 327–351); all failed indexes warn and return no match URLs,
making stats return cache-only rows. Partial index failure can silently omit tail matches.
Parquet, match-page, mapping, club-detail or results failures propagate to wrapper's error
handler and stop before a manifest. There is no fitzRoy-level automatic retry. With some
index failures a manifest may still be written; completion/acceptance remains a validator
decision. Live-tail helper also replaces some NAs within partly populated columns with zero/
empty string (`helpers-afltables-playerstats.R:450–461`); wrapper preserves what it receives,
so source pinning does not prove historical NULL semantics without later evidence review.

For both successful candidate commands, count **logical URL read/download invocations** as
`282 + U + M + H`: 130 parquet + 21 club pages + 131 results; U = index-page reads,
M = selected match-page reads (duplicates counted), H = mapping reads (0–130, one per
nonempty live-tail call). U/M depend on the as-yet unread cache and season HTML. No per-player
network loop. This is not a wire-request upper bound: dependency retries/redirects and
remote content sizes are unknown; no fixed byte budget or safe total HTTP cap is established.
Do not replace this with 282 actual HTTP requests or infer 218 current live matches to scrape.

Output contract unchanged: 130 stats CSVs, player_details.csv, results.csv and core manifest;
130 ladder CSVs and witness manifest, in the existing Stage 1 paths. Manifests written last,
always initially unvalidated. Wrapper stops at first propagated dataset failure, preserving
earlier CSVs; it allows same-label CSV replacement without a manifest, while the proposed
operation still requires fresh labels/directories and preserves failed runs. R temp parquet
may remain on failures before unlink; dependency temp/cache/connection effects are unresolved.
No fitzRoy `.onLoad/.onAttach/.onUnload/.First.lib` or `setHook` declarations found in the
source R files; dependency hooks were not audited or loaded. Dictionary/mapping objects are
bundled package data and do not themselves introduce another URL in the reached code.

### Readiness and smallest next authorisation

**fitzRoy-level source tracing is complete for these arguments; maintenance acquisition is
not yet completely specified or ready to request approval.** Existing R 4.3.3 remains a
compatible version candidate with fitzRoy 1.8.0/jsonlite 1.8.8/digest 0.6.34; no Node needed
for acquisition. Existing Stage 1 argv below remains a proposal, not approval or selected
labels. Concrete runnable commands still need approved runtime/root, installed-code binding,
startup/library/cache/TMP/CA/proxy configuration, redirect/timeout policy and output budget.
There is no basis to pin unknown final manifests, census, corrections or successor inputs.

**Smallest next source operation:** owner supplies, or separately authorises source-only
retrieval to C: of **R 4.3.3's `utils::download.file` / `base::url` and URL-backend definitions,
xml2 1.3.6's `read_html` URL dispatch, and readr 2.1.5's `read_fwf`/`read_csv` remote/connection
dispatch**, with provenance/hashes. Review only transport method/redirect/retry/timeout/temp
behaviour. Follow into **vroom 1.6.5 / curl 5.2.0** only if those specific definitions delegate
there and material is separately supplied/approved. None was downloaded now. Their implementation
is absent from the retained C: metadata/source bundles, so package-version knowledge does not
close the gap. httr/httr2 source is not required by the reached transport calls.

This narrowly replaces v2's request for fitzRoy source, which is now fulfilled. It grants no
AFL acquisition or live endpoint probe and no installed-runtime/host inspection. Runner/native
hashes and source-to-installed binding remain separate preparation inputs; final acquisition,
witness/census validation, rollover and deployment retain the six independent authorities.
Polkit remains only a later writer-retirement limitation; no broader access requested.

## Retained v2 offline review and preparation history

Review baseline: HEAD `ac7a90892189d7b509f85a7a77d47bff5b83bbfd`, `v2/rebuild`, remotes
empty, only pre-existing untracked `.codex/`. Subsequent changes preserved. One agent;
no WSL invocation, host connection, download, installation, database access, acquisition,
validator, service operation or rollover. New evidence stays in the existing C: preparation
directory as `offline-review-v2.json`; original archive, manifest and v1 copy remain intact.

Completed inspection reused from
`C:\tmp\afldb-c2-inspection-resume-20261021T134846389\findings.md`: production identity,
ledger 110 and inspected ACLs match retained evidence; all 218 stored 2026 matches have scores,
GF Fremantle 89–96 Brisbane. Latest acquisition remains explicitly `in_season_partial`.
This supersedes the old scheduled-fixture evidence as a statement of stored completion;
final external enumeration, owner acknowledgement and accepted full-history/witness remain owed.
The inaccessible exact polkit rule concerns later writer retirement; it is not a dependency
review failure and no broader access is requested.

Historical v1 preparation baseline: `D:\dev\afldbV2`, branch `v2/rebuild`, HEAD
`d67c08f6d8a36c3a471e56b049833905811ed040`. Remotes empty; only pre-existing untracked
`.codex/`; preserved. No reset, checkout, cleanup, new worktree, subagent, WSL start,
host contact, dependency installation, acquisition or database connection. The preparation
commit must contain documentation only. Binary preparation artifacts and copies are on C:.
The passing DEV operation is reused; no build/restore/migration/browser/shell fixture rerun.

## Prerequisite register

Status describes evidence, not permission. The authority remains split into six stages below.

| Prerequisite | Status and exact remaining evidence |
|---|---|
| Applicable C0/C1 | **Demonstrated under amendment.** D-V2-316-C0C1-1 accepted source incorporation and V2 refusal in place of acquiring C0; 19/19 reconciliation, local focused 669 pass/2 POSIX skips, Linux focused evidence and DEV shell refusal 4/4 retained. D-DEV-316-C1-APP-1 plus sole-link/retained-root amendment completed steps 8–15: candidate restore, 111–117, privileges/checksums, exact Super Admin refusal and one attributed audit row 1100/actor 20, negative controls, source guard and shutdown PASS. Port 3201 free at 01:06:32Z. See [completed record](issue316-c0-c1-approval-2026-10-21.md). These amended criteria do not prove active historical acquisition. No repetition requested. |
| 2026 season actually complete | **Stored final-result evidence established by completed inspection:** 218 scored matches, GF Fremantle 89–96 Brisbane. Old fixture's SCHEDULED GF is historical. Still require final external whole-season enumeration, accepted full-history results/stats/witness and owner completion acknowledgement. Latest retained snapshot is `in_season_partial`, never accepted full history. |
| Final 1897–2026 acquisition and ladder | **Missing.** No final C2 core or witness bytes/manifests exist as accepted evidence in this preparation. Current contract ends at 2025; outgoing baseline label `issue129-t7-20260903`, witness `ladder-20260828`. Old acceptance cannot certify 2026. Final labels proposed below are reserved names, not acquired evidence. |
| D-233-3 ownership | **Requires refreshed evidence.** Fresh through-2026 census for each database actually affected by rebuild/promotion, including the verified production target if in scope. The list of affected databases must be explicitly agreed; historical tests or “every 2026 match is afltables-owned” prose do not replace census records. Require zero in-scope afl_api-owned canonical matches, scope 1897–2026 and identities/hashes/timestamps. No row re-ownership; a nonzero result is a STOP. |
| Accepted corrections | **Missing for successor.** Review per acquired row fingerprint, including source-row and profile-continuity rules. Do not inherit outgoing corrections; explicit reviewed empty category arrays if none. An upstream repair/count/identity change requires adjudication, not a relaxed validator. |
| Stat availability / club-season coverage | **Missing for successor.** Reviewed availability for completed 2026 with NULL/not-recorded semantics preserved; reviewed ladder coverage and measured expected distinct club-season rows through 2026. Current rebuild constant is 1622; neither that nor observed live derived counts is the successor count. No invented 2026 cells, date or count. |
| Validator inputs and accepted successor | **Missing.** Core/witness immutable manifests and CSVs with hashes, reviewed coverage/availability/corrections, census(es), actual rollover date, allowed retire status (`retired`), measured expected rows. Gate 1 measures fingerprint/identity; gate 2 verifies the computed acceptance binding; gate 3 verifies offline witness. Temporary successor contract/register must be read back byte-identically. All three run on dry run AND apply; cached success cannot substitute. D7 database comparison stays after an independently authorised rebuilt disposable database, never on an assumed live successor. |
| Exact six-file change | **Defined, not produced.** Switch first, then acceptance register, seasons, contract, availability, rebuild count (paths below). Result must be retired / D-316-1 and `[2027]`, last completed boundary 2026, no activation of a 2027 writer. Resulting bytes/diff remain unknown until evidence passes. |
| Recovery / release | **Requires refreshed evidence and separate authority.** Current host/DB/artifact/writer/admin state, available space, approved coordinated timer pause/admin freeze and recovery route before a write; A-AFLT route if C5 cannot precede V2. C2 before quarantined V2 installation. After six-file commit: affected checks, rebuilt pinned release artifact; retire exact discovered timer/polkit under separate approval; final frozen non-pruning backup/off-host copy and restore evidence. Reuse completed DEV/fresh-rehearsal evidence; repeat affected rehearsal only for actual drift, not unconditionally. Host restore/routing remains separate. |

Sources: ISSUE-316 §7 C2, §8 D-316-1 and recovery; [C0/C1 amendment and results](issue316-c0-c1-approval-2026-10-21.md);
[release plan steps 1–5 and freshness limits](production-release-plan-2026-10-21.md).
Earlier pending/checkpoint prose in those records is historical; their completed C1 record controls.

## Pinned maintenance source and readiness limits

**Locally created source archive, not a runnable/deployable maintenance environment:**

- Revision: `c9cca86db2fd60ec42fa777906a2cf2a291d5e4e`.
- Path: `C:\tmp\afldb-c2-preparation-20261021-v1\historical-c9cca86db2fd60ec42fa777906a2cf2a291d5e4e.tar`.
- Size: **118046720 bytes**.
- SHA-256: **`196035d949244f392943224133e71ddf96d62af0846e15811cd63b8221b01f69`**.
- Local native-tar inventory matches all **1889** Git source files; no absolute/parent-traversal
  member names. `archive-members.txt` and `manifest-v1.json` are retained in that C: directory,
  alongside `approval-package-v1.md`. This is membership verification, not dependency readiness
  or a substitute for pre-extraction link/type/target safety review.
- Produced locally with `git archive --format=tar --output=<above path> c9cca86db2fd60ec42fa777906a2cf2a291d5e4e`.
  No network, checkout or worktree; archive is the complete tracked historical source, including
  package-lock and reference/identity files. It contains no acquired gitignored full-history CSVs,
  installed dependency closure, secrets, or current target proof. Archive membership/safety must
  be reviewed before any later extraction; this preparation has not extracted or run it.

### Actual runtime requirements (v2 supersedes v1 reference proposals)

- **Acquisition and ladder acquisition:** R plus **fitzRoy exactly 1.8.0**, `jsonlite`, and
  `digest` (selected branch; `openssl` is the wrapper's fallback). fitzRoy DESCRIPTION enforces
  **R >=4.1**, rlang >=0.1.2, stringr >=1.3.0, tidyr >=1.0.0. The wrapper has no numerical R
  minimum of its own. Retained R **4.3.3** meets every Depends/Imports/LinkingTo constraint
  in the selected 56-package closure; no missing metadata names or version violations.
  fitzRoy itself records `Built: R 4.3.3`. jsonlite **1.8.8**, digest **0.6.34** and transitive
  openssl **2.1.1** are installed evidence, not new universal minimums. R **4.6.1** was used
  for earlier Windows refusal tests and was v1's proposed reference; no upgrade or mismatch
  waiver follows from that difference. Full exact version/path/DESCRIPTION hash list is in
  `offline-review-v2.json`; it follows fitzRoy/jsonlite/digest only, excluding unrelated packages
  and Suggests. Attaching fitzRoy needs its namespace closure even when commands select only
  AFL Tables functions. Metadata compatibility does not prove native loading or endpoints.
- Python **3.12.3** is retained installed evidence and compatible with the inspected offline
  paths (historical Windows evidence says 3.12); no exact patch-version guard or upgrade follows.
  Offline core/witness validation uses Python standard library; `common.py`/psycopg are lazy
  imports beyond the validate-only return. Importing modules can write `__pycache__`; use
  `PYTHONDONTWRITEBYTECODE=1`. Any later database comparison/import needs separately pinned
  psycopg 3 and native dependencies; no DB-import invocation is approved here.
- **Neither Node nor psql is needed for the two R acquisitions or offline Python witness/core
  validation.** Later census/rollover uses Node and local tsx. Historical lock pins tsx **4.23.12**
  -> esbuild **0.28.2** -> Linux x64 esbuild **0.28.2**, all declaring **Node >=18**.
  These locked tsx dependencies do not include get-tsconfig. Node's `--import` facility also
  must be available; retained **22.23.2** supports this command and satisfies the engine floor.
  **22.21.0** is earlier reference evidence, not an exact pin or required upgrade/downgrade.
  Node is absent from noninteractive PATH: use the explicitly pinned executable
  `/home/arm/.nvm/versions/node/v22.23.2/bin/node` if that runner is later selected.
  Its retained SHA-256 is `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`.
  Census additionally needs psql (observed **16.15**, not a source-enforced numerical minimum)
  and a separately authorised read-only DSN. No Next/React/app dependency installation needed.
  `offline-review-v2.json` preserves the lock's exact npm URLs/integrities; those are package
  provenance, not acquisition destinations. Nested esbuild was found in the completed inspection.
  Do not install, use implicit-download npx, or infer readiness from only package.json hashes.
- Missing runtime evidence is a blocker to calling this executable-ready. Do not invoke the
  historical whole settle shell: it chains acquisition, importer and canonical settle, exceeding
  final-acquisition-only authority. Do not copy historical acquisition over any V2 runtime stub.

### Endpoint trace and request/output scope

Exact historical source references below are c9cca86d, not V2's refusal stub. The R wrapper
contains no literal HTTP request, retry, sleep, rate-limit or concurrency implementation.
`try_fetch` (lines 174–179) catches one error and returns it; a failed dataset/season stops
without a manifest. It does not retry automatically. Package retries, redirects, cache
freshness, request counts and transport timeouts remain **unknown**, pending implementation.
The wrapper calls `requireNamespace("fitzRoy")` at startup before its switch guard and argument
dispatch; even a supposed help/static probe could load package hooks. This review reads source
bytes only and does not invoke the R wrapper or any package namespace.

| Reachable call | Request scope / purpose | Endpoint evidence / uncertainty | Local outputs |
|---|---|---|---|
| `fetch_player_stats_afltables(season=s)` (317) | 130 serial calls, 1897–2026; package may request much broader cached history or many pages per call | AFL Tables plus historical afldata cache implicated by contract's profile-continuity comment (56). Exact cache release URL/provider/redirects and live season/match paths not present in locally retained implementation | 130 `player_stats_YYYY.csv` |
| `fetch_player_details_afltables()` (335) | One unbounded all-history call; no season filter | Historical companion source `tools/rebuild/afltables/acquire_club_lists.R:4–6` identifies the same 21 `https://afltables.com/afl/stats/alltime/<slug>.html` pages. This corroborates a path family, not a verified full package call chain or exact current slug/request count | `player_details.csv` |
| `fetch_results_afltables(season=from:to)` (340) | One call with 130 seasons; actual requests unresolved | `afltables.com/afl/` known provider; exact season/result URL templates and any helper providers unresolved | `results.csv` |
| `fetch_ladder_afltables(season=s)` (369) | 130 serial calls; computes regular-season ladder via `fetch_results_afltables`, per contract and witness source header | Results endpoints therefore reachable again; package cache reuse/multiplicity unproved. Does not establish an independent published-ladder endpoint | 130 `ladder_YYYY.csv` |

Core/witness each write their manifest last under the paths in Stage 1 below: 132 core CSVs
plus one manifest; 130 witness CSVs plus one manifest. Package caches/temp files and transport
side effects remain unresolved. Historical wrapper allows overwriting incomplete CSVs if no
manifest exists (234–238); the proposed operation is deliberately stricter: refuse both existing
labels/directories and preserve failures. Do not infer restartability from the comment.

Profile URLs matching `https?://afltables.com/afl/stats/players/[A-Za-z]/...html` are identity
values in the contract, **not proof they are requested**. afldata is an additional data provider
requiring source review; neither GitHub release host nor redirect/CDN hosts are proven from the
available package source. No verified exhaustive endpoint allowlist can yet be produced.
No separate coach/club-list/FootyWire/AFL API/Brownlow acquisition is selected by the wrapper;
package hooks/helpers may add destinations and have not been reviewed. Brownlow vote columns
carried by player_stats do not imply a separate Brownlow command.

### Archive verification and isolated maintenance use

Rechecked archive bytes/size/SHA-256 against v1 manifest: PASS. All **1889 regular files** match
Git tree membership; **2184 members** total, remaining members directories; no links, special
members, absolute paths or parent traversal. Content comparison: **158** exact Git-blob matches,
**1731** CRLF-only conversions, **zero unexplained differences**. Thus v1's membership assertion
holds, but archive bytes are not universally identical to Git blobs. Relevant raw/LF SHA-256
pairs are retained in `offline-review-v2.json`. Do not silently normalize hash-bound inputs or
execute archived shell scripts with CRLF shebangs. The two R commands avoid those shell scripts.
No extraction, normalization, source execution or source-archive replacement was performed.

A separately extracted/pinned maintenance root can use installed R 4.3.3 and its library paths
without modifying `/home/arm/projects/afldb`, installing dependencies or restoring acquisition
to V2. The old whole settle shell is outside scope. Source-only feasibility is established;
**executable readiness remains unestablished**. Production's installed runtime is only a candidate,
not an approved runner. Pin extracted bytes and explicit executables/library search order before
execution; never source a production environment file. No credentials, production data or actual
environment files are added to the artifact (the tracked `.env.example` is only an example).

### Exact missing inputs and smallest next operation

1. **First input:** owner-supplied immutable **fitzRoy 1.8.0 source tarball**, with provenance
   and SHA-256, including DESCRIPTION/NAMESPACE, all `R/` helpers, startup `.onLoad/.onAttach`
   code and referenced data/extdata. Needed symbols are the four fetch functions above,
   `dictionary_afltables`, cache/download/parser/result/ladder helpers and their reachable hooks.
   No such implementation bundle appears in the pinned archive or the two retained C: packages;
   inspection retained hashes of `.rdb/.rdx`, not their contents or original source archives.
   Installed DESCRIPTION hash is
   `62b1c1b389f8f42dac6fb7cd7cd8c1553978ac63cdd3ea6d645a8564cc096444`;
   it is **not** the missing source-tarball hash. Do not fabricate that hash or presume version
   alone binds a tarball to the installed build.
2. Follow only helpers actually reached by that source. Potential transport implementation
   inputs, whose versions are already retained, are **httr 1.4.7, httr2 1.0.0, curl 5.2.0**;
   parsers/cache readers include **rvest 1.0.3, xml2 1.3.6, readr 2.1.5, rappdirs 0.3.3,
   nanoparquet 0.5.1**. Request their immutable source/hash only when the fitzRoy call chain
   requires it; this is not authority to download every package. Review cached release selectors,
   fallback paths, redirect handling, retry/backoff/rate limits and package load hooks offline.
3. Before a future runnable artifact: installed-file/native-object SHA-256 inventory for the
   exact 56-package set in the C: JSON and R executable/libR; identify/hash reachable shared
   libraries and TLS trust inputs. Existing DESCRIPTION and four packages' lazy-database hashes
   do not establish native closure. Later Node/census needs the full selected tsx/esbuild files
   and Node/psql binaries pinned; lock integrities alone are not installed-file hashes.
4. Configuration still missing: approved non-WSL runner/root and runtime paths, R library order,
   startup/site-profile handling, explicit no-incidental-env policy, proxy/CA/redirect policy,
   cache and TMP directories/budget, output capacity/log paths and source-to-installed-build
   binding. Standard user/project R profiles and two cache paths were absent in prior inspection;
   that is not an exhaustive site/environment/cache check. Use startup suppression only after
   verifying compatibility, not by silently changing the final command contract.

**Smallest next authorisation:** accept/review the owner-provided fitzRoy source bundle on C:
offline, with no package loading. If unavailable, separately approve retrieval of **that one
version's source archive** from an owner-reviewed immutable origin to C:, record its hash and
stop for offline tracing. Origin/hash must be established first; no download is authorised now.
No repeat production inspection, R namespace loading, acquisition permission, runtime upgrade,
general dependency audit or polkit access is requested. This review returns missing source
inputs, not an acquisition-ready command. Six authorities below remain independent.

The maintenance artifact will run manually from a dedicated extracted directory on an approved
non-WSL Linux runner, with no systemd/admin/runtime wiring. That runner and extraction path are
**not yet selected or approved**. C: retains original archive/evidence; D: is not an acquisition
workspace. A source archive alone does not authorise uploading it or creating a host directory.

## Commands for later stages — specified, disabled pending inputs and approval

These are command contracts, not authority to run. Working directory must be the reviewed
maintenance extraction root; all relative acquisition/evidence paths are inside that root.
No new Git worktree is required. Exact absolute runner root, runtime executable paths and
environment digest must replace unresolved inputs in a later scope-bound approval.

Stage 1 candidate commands (labels **proposed**; refuse existing directories OR manifests):

```sh
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label c2-2026-final-core-v1 --from 1897 --to 2026 --datasets player_stats,player_details,results
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label c2-2026-final-ladder-v1 --from 1897 --to 2026 --datasets ladder
```

Outputs: `data/sources/afltables/fitzroy_core/c2-2026-final-{core,ladder}-v1/` CSVs and
`docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-{core,ladder}-v1.json` manifests;
separate stdout/stderr, runtime/source/manifest/CSV SHA-256 inventories and authentic completion
evidence copied to the approved C: evidence area. R may also write runtime/user caches/temp files;
pin those directories and redirects when the runtime is known. No database or tracked reference
state writes. A failed R run may leave partial CSVs without a manifest; preserve them, stop and
obtain a reviewed retry/new-label scope. Do not treat a generated manifest as a validation PASS.

Stage 2 census contract (one invocation per explicitly verified database; this production
invocation is a **candidate target**, not approved or freshly verified):

```sh
PYTHONDONTWRITEBYTECODE=1 node --import tsx tools/db/afl-api-ownership-census.ts --database afldb_prod --dsn-env AFLDB_C2_READONLY_DATABASE_URL --through-season 2026 --out evidence/c2-2026/census-afldb_prod.json
```

The environment must privately name the verified host/port/database; no DSN in argv/logs. Census
opens READ ONLY transaction(s), checks current_database and emits a new no-overwrite JSON file;
it does not bootstrap schema. File writes are real effects despite read-only SQL. The script
reads `.env` if present, so the maintenance root must contain no incidental `.env` and credentials
must be explicit. Relevant additional database names/credentials remain unresolved, not inferred.

Stage 2 offline validator argv, as constructed by historical rollover-season.ts gates 1–3:

```text
PYTHON tools/migration/import_fitzroy_core.py --label c2-2026-final-core-v1 --snapshot-dir data/sources/afltables/fitzroy_core/c2-2026-final-core-v1 --manifest docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json --validate-only --require-full-history --contract SUCCESSOR_CONTRACT --stat-availability REVIEWED_AVAILABILITY
PYTHON tools/migration/import_fitzroy_core.py --label c2-2026-final-core-v1 --snapshot-dir data/sources/afltables/fitzroy_core/c2-2026-final-core-v1 --manifest docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json --validate-only --require-accepted-baseline --contract SUCCESSOR_CONTRACT --stat-availability REVIEWED_AVAILABILITY --accepted-baselines SUCCESSOR_REGISTER
PYTHON tools/rebuild/fitzroy/validate_ladder_witness.py --label c2-2026-final-ladder-v1 --contract SUCCESSOR_CONTRACT --manifest-dir docs/rebuild-manifests/afltables_fitzroy_core
```

`PYTHON` is the verified executable (also set `AFLDB_PYTHON` for rollover), not literal shell syntax.
Uppercase document names denote **missing, reviewed inputs**, not files already created.
Gate 2's register is computed only after gate 1 measures the fingerprint/identity scan. Prefer
the rollover runner's exact orchestration; do not hand-author a PASS register to make gate 2 pass.
Running that orchestration belongs to stage 4 after review; standalone stage-2 checks cannot
replace the repeated real gates in stages 4/5. Offline validators make no network/DB connection
and write no canonical data; capture logs and suppress bytecode. No importer `--dry-run`
(which does connect), bare importer (which writes), or witness `--compare` is authorised.

Stage 4 rollover command contract (all missing values must be concretely pinned first):

```text
node --import tsx tools/db/rollover-season.ts --season 2026 --rollover-date REVIEWED_ACTUAL_DATE --retire-status retired --core-manifest docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json --ladder-manifest docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-ladder-v1.json --ladder-coverage evidence/c2-2026/ladder-coverage.json --stat-availability evidence/c2-2026/stat-availability.json --accepted-corrections evidence/c2-2026/accepted-corrections.json --afl-api-ownership-census evidence/c2-2026/census-afldb_prod.json --afltables-retirement-decision D-316-1 --expected-club-season-rows MEASURED_REVIEWED_COUNT
```

Repeat census flag for each additionally approved relevant database. Evidence must be beneath
the extracted root: the historical CLI refuses evidence paths outside it. Dry run opens no DB
and changes no reference files, but creates/read-backs/removes temporary successor files in
OS tmp; stdout/log capture also writes files. Pin tmp to the approved runner's evidence volume.
There is no cached-transcript bypass. Source/reference hashes must still match reviewed inputs.
Stage 5 adds exactly `--apply --acknowledge-season-complete` to the reviewed concrete command,
after fresh source/evidence/ownership checks; it reruns all three gates before writes.
This template is intentionally **not executable-ready**: date, count, census set, runtime,
runner, final evidence and approval are absent. The CLI example date is not adopted.

## Six independent approval scopes

| Stage | Authority and boundary | Outputs and acceptance |
|---|---|---|
| 1. Final acquisition/evidence | D-316-1 acquisition slice only after completion, runtime/endpoints/runner/output paths are pinned and reviewed. Separate coordinated pause/admin freeze/recovery approval if production writers must be paused. No implicit service action. | Exactly two new immutable labels, complete CSV/manifests, hashes/logs/versions, authentic final completion evidence. No database imports or reference-state edit. |
| 2. Ownership census/validation | Separate read-only DB target list, least-privilege credentials, census output paths; offline validators with reviewed successor inputs. Never invoke rebuild or schema runner. | Zero in-scope afl_api ownership, complete coverage/corrections/availability, successful measured validation without skipped gates. Failure preserves evidence and stops. |
| 3. Evidence review | Owner reviews actual hashes, completion, errors, identity resolution, NULL semantics, target census scope/freshness and successor inputs. Reviewing evidence does not authorise subsequent mutation. | A concrete accepted input manifest and explicit next dry-run scope, or rejection; unknown future corrections are not pre-approved. |
| 4. Retirement/rollover dry run | Separately approve exact source/reference overlay, command/date/count/censuses. Historical extraction only; no reference apply. | Three real gates pass and exact proposed six-file diff is reviewable; no database write. Stop for review before apply. |
| 5. Six-file apply/reviewed commit | Separate approval of actual six-file bytes and source/evidence hashes; repeat gates and completion acknowledgement. Historical apply produces its six outputs; review narrow integration into current V2, preserving later changes. | One reviewed six-file configuration/code commit; no deploy or timer action. Rehash every input/output. Never copy historical rebuild-test.ts wholesale into V2. |
| 6. Deployment/writer retirement/recovery | Fresh release candidate/rebuild and host target authority; A-AFLT exact timer/polkit retirement, freeze/recovery route and final frozen backup/restore scope separately identified. | Rebuilt app serves retired switch; next nightly retired exit 0 or timer disabled; no newer AFL Tables label; legacy-writers PASS under release plan. Production release/migrations/routing still need their own authorities. No 2027 writer activation. |

Exact stage-5 paths, in write order (the five after the switch are one coordinated set):

1. `data/reference/afltables-network.json`: status retired, decision D-316-1, reviewed date.
2. `data/reference/fitzroy-accepted-baselines.json`: retire predecessor; accept measured successor.
3. `data/reference/seasons.json`: last season 2027, in-progress `[2027]`, 2026 completed.
4. `tools/rebuild/fitzroy/fitzroy-contract.json`: full-history boundary 2026, new witness binding/coverage.
5. `data/reference/stat-availability.json`: reviewed successor bytes.
6. `tools/db/rebuild-test.ts`: measured `CLUB_SEASONS_EXPECTED.rows` update only.

Verify actual planner order/diff at stage 4; no partial set may be committed. Only switch-first
is the safety-critical ordering guarantee. Compared with c9cca86d, current V2 already changed
the network switch's explanatory comment and rebuild-test.ts's implementation; other four
files match Git blobs. Retain current V2 comment/runtime quarantine and rebuild safety logic.
Any necessary integration beyond these narrowly reviewed changes needs a new scope; historical
apply output cannot overwrite subsequent V2 changes. Provenance manifests/evidence retention
is a distinct record change, not silently added to the six-file retirement commit.

2026 remains `afltables`-owned stored history. 2027 activation, ISSUE-229 B2, C4/C4b/C5 and
D-316-13 are outside C2. D-316-6 future ownership replay, Brownlow and unrelated corrections
remain separate. No acquire/settle compatibility stub is reactivated in ordinary V2 runtime.

## Historical v1 operation: completed prerequisite inspection (do not repeat)

**Historical candidate target, not current proof:** SSH alias `afldb` previously resolved to
`arm@209.38.87.252:22`, host `afldb-prod`; checkout `/home/arm/projects/afldb` at
`ff100dc2b8da8523f550ef45a9eaa3ef96d9d840`; PG `16/main`, localhost/::1 port 5432,
system identifier `7674454702926115004`; DB `afldb_prod`, OID 66668, owner `afldb_owner`,
ledger 110. All are 20 October observations in the release plan, not newly verified here.
Do not substitute streamanator, afldb_dev, the retained DEV candidate, or a local forwarded port.

Inspection command boundaries to make the scope concrete:

- Locally inspect `ssh -G afldb` selected hostname/user/port; do not print identity key material.
  One read-only session to that verified alias. Use `hostname`, `date -u`, `df -h` for the
  checkout/data/approved evidence volumes, exact-path Git HEAD/status and build-id reads.
- Read-only `systemctl show`/`is-enabled`/`is-active` for the existing app and the four named
  AFL Tables/email-intake/AFL API match/Brownlow timers, corresponding services, process identity,
  exact polkit file metadata/content needed for retirement, and active-writer/admin-session
  metadata (no tokens, environment dumps, secret-bearing command lines or personal data).
- Secure operator-provided read-only database connection via host-local 5432, no default DSN.
  After verifying SSH host identity, use `psql -X -w -v ON_ERROR_STOP=1` with a READ ONLY
  transaction and an agreed statement timeout. Query identity before any broader inspection:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), version();
SELECT oid, datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database();
SHOW transaction_read_only;
SELECT system_identifier::text FROM pg_control_system();
ROLLBACK;
```

  If pg_control_system is unavailable to that role, report the missing proof; do not escalate
  privileges. Only once identities match, inspect exact existing ledger/schema/ACL/extension
  and active-session metadata and relevant stored 2026 match completion evidence read-only.
  Review actual schema before specifying completion SQL; do not invent result/status columns.
  No census CLI, validator, schema runner/status bootstrap, backup, restore or acquisition.
- Read runtime versions (`Rscript --version`, `python3 --version`, `node --version`, `psql --version`)
  and R installed-package metadata/source/cache paths only; no loading/acquisition or installation.
  Determine whether a complete offline fitzRoy dependency/source closure is available; if not,
  report exact missing package/source hashes rather than downloading it. Inspect already retained
  final match/season evidence if present; no external sports/source fetch in this inspection.
- Save only sanitised local inspection output to a new C: subdirectory, never D: or remote
  temporary files. No copying artifacts to hosts, remote extraction or new host directories.

Expected output: dated identity comparison, ledger/schema/ACL/versions and writer/free-space
state, concrete candidate runner/runtime availability and remaining dependency/endpoint gaps,
latest retained completion evidence and exact remaining inputs. Acceptance is an inspection
record sufficient to draft the **next** exact approval, not C2 PASS. A recorded unavailable
fact remains a blocker; it does not expand authority.

Stop on alias/host/cluster/database/OID/owner mismatch, unexpected ledger/artifact drift,
active writer/admin conflicts, insufficient space, unavailable credentials/read-only guarantees,
unknown endpoint/dependency, missing or still-scheduled final-match evidence, nonzero ownership,
hash discrepancy, or requested scope expansion. Preserve all output; return for owner review.
Read-only inspection may observe drift; do not repair it or stop any process.

**Copy-ready next authority (not yet approved):**

> I authorise one read-only C2 prerequisite inspection using the existing `afldb` SSH alias,
> conditional on verifying its recorded `arm@209.38.87.252:22` / `afldb-prod` identity, and the
> host-local PostgreSQL 16/main `afldb_prod` target (system identifier 7674454702926115004,
> port 5432, OID 66668, owner afldb_owner). Inspect only the identity, source/build/ledger/schema/
> ACL/extensions, exact existing writer/timer/process/polkit/admin-activity state, free space,
> runtime/dependency/source-cache metadata and already retained 2026 completion evidence
> described in package v1. Use read-only SQL with credentials supplied privately; no privilege
> escalation or schema bootstrap. Store sanitised results only on C:. Stop on identity drift
> or missing guarantees and return the evidence for review. This grants no acquisition,
> dependency installation/download, validator/census execution, host file write, timer/service
> change, backup/restore, rollover/apply/commit, deployment, DEV access, WSL start or production
> write. It does not grant D-316-1 or any later cutover authority.

## Recovery boundaries

Preparation/inspection has no remote state to undo; retain archive and original worktrees,
backups and evidence. No cleanup. Acquisition failure preserves partial output and never
authorises import. Validators/census are read-only to DB, with separately declared evidence/
temporary file effects. Rollover apply is per-file rename atomicity, not a six-file transaction:
interruption must leave switch retired first; preserve evidence and recover the whole touched
set to the recorded pre-apply baseline under reviewed authority, preserving unrelated changes.
Never commit partial output or revert the switch alone. Before any 2027 API canonical write,
reversal is the complete rollover commit plus separately approved deployment/rebuild; restarting
paused writers requires the approved recovery route. After the first 2027 afl_api canonical
write, default is forward-fix; reverting ownership is a new owner decision. D7 rebuilt-DB
validation, final frozen rollback capture/restore, production migrations, routing and writer
retirement are not authorised by this preparation or the inspection wording.

Historical v1 preparation repository records only: this package, `IssuesIndex.md`, `issues.md`,
`issues/open/AFLDB-ISSUE-316.md`, `docs/v2/production-release-plan-2026-10-21.md` and `CHANGELOG.md`.
No six-file rollover target was edited. Local verification: source/branch/status/remotes,
archive SHA-256 and exact source-tree membership; documentation diff/whitespace review.
No runtime test is required for these documentation-only changes. Source artifact readiness,
season completion and live target identity were unverified at v1 preparation time; the v2
update above records the completed inspection's narrower positive evidence and remaining gaps.
