# ISSUE-357 O-1: Caddy path-shape deny (prepared and tested, NOT installed)

Scope `caddy357`, remediation run 2, 2026-11-14. Base `e8666c17`. Branch `claude/rem2-caddy357-20261114`.
Files changed in the product tree: `deploy/Caddyfile.production`, `deploy/Caddyfile`. Nothing was installed,
reloaded, restarted or deployed. Every Caddy that ran was my own process (`admin off`, `run|validate|adapt --config
<own file>`, ports 55653/55663 in my own workspace); the DEV Caddy (admin API 127.0.0.1:2019) was never touched
(`raw/ss-before.txt` and `raw/cleanup-proof.txt` both show it listening, unchanged).

## 1. The problem and the rule

Next.js 16 persists every rendered page of an ISR route to `.next/server/app`, and that includes a `notFound()` and a
redirect. Measured on this build (`raw/measure-100.txt`): a distinct path to players, matches, seasons, brownlow, clubs,
venues or honour-teams costs 7.00 files, about 50 KB apparent and about 76 KiB on disk, whether it answers 404 or 308;
`/sitemap/<id>.xml` costs 2 files and 8 KiB. The app already 404s every non-canonical spelling, but the 404 is itself
persisted, so a client that invents paths grows the serving tree without bound.

O-1 answers a path that cannot be a canonical URL with a 404 straight from Caddy, so it never reaches Next and nothing
is written. It is one snippet, `(afldb_path_shape)`, imported as the first line of the `beta.afldb.com` block of
`deploy/Caddyfile.production` and of the `:8090` block of `deploy/Caddyfile`. Four layers, each
`respond @m "Not Found" 404`, every matcher a `vars_regexp` on `{http.request.uri}` (the RAW request target):

| Layer | Rejects | Regexp (raw target) |
|---|---|---|
| 0 | path over 512 characters | `^[^?]{513,}` |
| 1 | aliasing: `//`, `.`/`..` segment, `%2F`, `%5C`, `%2E` (either case) | `^[^?]*(//\|/[.]{1,2}(/\|[?]\|$)\|%2[EeFf]\|%5[Cc])` |
| 2 | an encoded character in the first segment | `^/[^/?]*%` |
| 3 | one allow-list per ISR route (trigger = prefix + at least one path character; allow = canonical shape + optional query) | below |

Canonical shapes (lower case, no `%`, no sign, no leading zero):

- `players`: `/players/(compare\|<slug>-<id>(/matches)?)`, slug `[a-z0-9-]{1,100}`, id 1..2147483647 written out as an int4
  regexp (the range the app enforces);
- `matches`: `/matches/[1-9][0-9]{0,4}` (1..99999; largest id today 17,274);
- `seasons`, `brownlow`: `(189[7-9]|19[0-9][0-9]|20[0-9][0-9]|2100)`;
- `clubs`, `honour-teams`: `[a-z0-9-]{1,80}`; `venues`: `[a-z0-9-]{1,80}(/matches)?`;
- `sitemap`: `/sitemap/[0-9]{1,3}[.]xml`.

Deliberately not protected: `/awards/*` and `/records/*` (they read `searchParams`, Next renders them per request and
persisted 0 files, `raw/persist-direct-open*.tsv`), coaches, draft, AFLW, `/players/<slug>/matches` list sorts, list pages
(`/seasons/`, `/clubs/`), `/_next`, `/api`, `/admin`, `/beta`.

## 2. How Caddy sees a path (measured, both binaries identical: `raw/exp1-system.txt`, `raw/exp1-2.11.4.txt`)

- `{http.request.uri}`: the raw request target including the query, byte for byte what is proxied upstream.
- `{http.request.uri.path}`: percent-decoded, not cleaned.
- `path_regexp` matches the decoded AND cleaned path (`//seasons/2024`, `/./`, `/x/../` collapse; `%32024` becomes
  `2024`, `%2F` becomes `/`); the `path` matcher also ignores case.
- Go rejects malformed escapes (`%zz`, a lone `%`, `%u0030`) with 400 before any handler runs.

So a rule written on `path` or `path_regexp` would call `/seasons/%32024`, `/seasons//2024`, `/Seasons/2024` and
`/seasons/2024%2F..` "canonical". My first draft triggered on `path` and missed `/seasons/2024%2F..` for exactly this
reason (Caddy had already cleaned it away). The final rules trigger and allow on the raw target only.

What Next does with the aliases (`raw/persist-direct-open*.tsv`): percent-encoded digits (`/seasons/%32024`) resolve to
the canonical cache entry (no growth); the variants that DO persist a distinct entry are `.json`/`.rsc` suffixes,
`;a=1`, `%2B2024`, `%252024`, `%2F` tails, leading-hyphen and upper-case slugs, wrong slugs. All of those are denied by
the layers above. Paths that persist nothing at all: `//`, dot-segment aliases, `/%73easons/...`, `/Seasons/...`.

## 3. Test matrix (final files, raw results in `raw/matrix-*.txt` and `matrix/`)

Final file hashes (`raw/final-caddyfile-sha256.txt`):

- `deploy/Caddyfile.production` sha256 `7149da9a055e2947851ea0811f87b34ff96bbb89e999213c40eae10552c9a7e2`
- `deploy/Caddyfile`           sha256 `71e604f4acb4e460957a3996d86c5d15203f445cf6922ca3faf1f0415cca6b93`

Binaries (both run on the host `streamanator`, user `arm`): system Caddy v2.11.9 sha256
`a563843e11cbce39c557bd429ebb787d56f49d51d9bbb3292cd9b36b37a60cdf`; Caddy v2.11.4 sha256
`b7105518e3ed1c0761f232e44fc09345535533c9cb0abf0e12809416c7ac64d9` (matches run 1; the run-1 copy was gone, so the
official tarball was re-downloaded and its sha512 verified against `caddy_2.11.4_checksums.txt`).

Harness: `matrix.sh` runs ONE isolated Caddy (the deploy file with site addresses, upstream port and log/web paths
sed-rewritten and `admin off` added) in front of a stub upstream that records every request it receives and echoes the
request target byte for byte. `client.mjs` sends each corpus line as a raw request target (so nothing is normalised by
the client) and compares status, and for passing lines the upstream-received target to what was sent.

Corpus (`corpus/`, generator `scripts/gen-corpus.mjs`): all 138 route patterns of `src/app` instantiated
(`corpus/route-patterns.txt`); every one of the 34,529 sitemap URLs of the live-shaped build (17 AFLW `%2527` slugs
included); `/admin/invite/<token>`, `/beta/verify?token=`, `/_next/**`, `/api/**`, `/sitemap.xml`,
`/sitemap-index.xml`, `/robots.txt`; a query string on every page; int4 boundaries, the 5-digit match cap, years 1897
and 2100, slug 80/100, path 511/512; encoded, doubled, dotted, cased, suffixed, signed, zero-padded, overlong and
malformed spellings of every protected route.

Result, identical for Caddy v2.11.9 and v2.11.4, for BOTH deploy files (4 runs: `raw/matrix-{prod,dev}-{2.11.9,2.11.4}.txt`,
summary `raw/final-matrix-summary.txt`):

| Corpus | Lines | Expected | Mismatches | Upstream received |
|---|---|---|---|---|
| legit GET | 35,340 | all pass, target byte-identical upstream | 0 | 35,339 (stub does not record `/api/health`) = expected |
| legit HEAD | 219 | pass | 0 | 218 = expected |
| legit POST | 5 | pass | 0 | 5 = expected |
| deny GET | 2,131 | 2,084 x 404 (Caddy) + 47 x 400 (Go malformed escape) | 0 | 0 |
| deny HEAD | 2,131 | same | 47 Node `HPE_CLOSED_CONNECTION`, all 47 re-checked with `curl -I`: 400 | 0 |
| deny POST | 150 | 404/400 | 0 | 0 |
| boundary | 85 | 57 pass, 28 deny | 0 | 57 = expected |
| open (shape-valid but unprotected) | 41 | pass | 0 | 41 = expected |

Config checks per run: `caddy adapt` and `caddy validate` of the sed-rewritten test copy and of a production-shaped copy
(real host names, TLS automation, only `admin off` and log/web paths rewritten): "Valid configuration" on both
binaries and both files. `caddy validate` of the UNMODIFIED deploy file fails as user `arm` only because it opens
`/var/log/caddy/afldb-access.log` (permission denied); `caddy adapt` of the unmodified file succeeds. Validate as the
`caddy` user on the droplet.

Special requests (`scripts/special.sh`, `matrix/*/hook.out`): absolute-form target, HTTP/1.0, h2c, apex host, rewrite
headers (`X-Original-URL`, `X-Rewrite-URL`): the deny cannot be bypassed by them and the apex block is untouched.

Redaction of DENIED requests (the ISSUE-362 filter): sentinel strings placed in a denied request's query, Referer, cookie
and an invite token were scanned for in my own access logs and Caddy stderr after the run: 0 occurrences for every
sentinel except `PROBE-PATHSECRET-eee555`, which is deliberately in the PATH (`/players/PROBE-PATHSECRET-eee555`): paths
have always been logged and are not redacted; only the invite token and every query string are. Logged records show
`/seasons/02024` 404, `/admin/invite/REDACTED` 200, `/beta/verify` 200 (no query), `/search` 200 (no query).

Real application behind Caddy (production build of base `e8666c17`, BUILD_ID `EILJAA4NowINsjUcj8YGG`, isolated PostgreSQL
restored from the verified template, ledger 118; `raw/viacaddy-2.11.4.txt`, `viacaddy/`):

1. 395 legit URLs (every 100th of the legit corpus plus the 41 open ones), direct to the app vs through Caddy: status
   and body identical except the headers Caddy adds on the beta host (CSP, HSTS, `X-Robots-Tag`; 11 URLs also
   `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`). 16 of the 395 differ in body hash: all are dynamic
   routes (coaches, awards, AFLW matches, `/players/<slug>/matches`). Two checks that this is the app, not Caddy
   (`scripts/bodydiff.sh`, `scripts/diag.sh`; the diag output was read on screen, not saved): two consecutive DIRECT
   fetches of 2 of the 16 already differ (`raw/step3-persist-fresh-and-prune.txt`), and in `diag` `/coaches/ross-lyon-14`
   gave direct1 != direct2 = caddy1 = caddy2, `/awards/bf-west-coast` direct1 = direct2 != caddy1 != caddy2,
   `/aflw/matches/2024-6-ess-syd` direct1 = direct2 = caddy1 != caddy2, same byte length throughout (one token per
   request differs on the same line). The other 14 gave equal hashes twice in a row and were not studied further; I
   report this as unexplained per-request variance in dynamic pages, not as a proven cause.
2. The whole deny corpus through Caddy to the real app: 2,131 requests, 2,084 x 404 + 47 x 400, `.next` file count
   before 81,664 and after 81,664 (delta 0), disk delta 0 KiB.
3. Persistence through Caddy. The 62 targets of `in/persist-targets.txt` (the list used to find persisting variants
   when talking to the app directly): 0 files, 56 x 404 + 5 x 308 + 1 x 200
   (`viacaddy/persist-via-caddy.tsv`); some of the well-formed ones were already persisted by the direct run, so the
   decisive evidence is the fresh set: 24 targets never requested before (`persist-targets3.txt`,
   `raw/step3-persist-fresh-and-prune.txt`). The well-formed unknown names (`/players/fresh-unknown-name-871001`,
   `/matches/88001`, `/clubs/fresh-unknown-club`, `/venues/fresh-unknown-venue`, `/honour-teams/fresh-unknown-team`, and
   the wrong-slug 308 `/players/fresh-wrong-slug-11724`) persisted 7 files each (44 files in the run with sitemap);
   `/sitemap/998.xml` 2 files; `/seasons/2098` 0 new files (an entry from the earlier 100-path measurement already
   existed); every junk variant 0 files (leading zero, `.json`, `.rsc`, upper case, `%32`, `%2D`, trailing slash, `..`,
   `//`, 6-digit match, unknown sitemap name). Well-formed non-existent names are NOT stopped: see section 4.
4. Real Chromium (playwright-core, chromium-1234) through Caddy with the candidate CSP and HSTS in force: 25 page visits
   (home, player, player matches, season, brownlow, club, venue, honour team, awards x3, records x2, players, clubs,
   compare pages, coaches, AFLW, AFLW player with `%2527`, grid solver, about, search), 1,073 responses (1,072 x 200, 1 x
   307), 0 Caddy-denied responses seen by the browser, 0 console errors or warnings, `hsts=yes csp=yes` on every page,
   143 `net::ERR_ABORTED` client-side prefetches (navigation aborts, none a deny). `/search?q=` never reached
   network idle in 60 s in the crawl; the same page behaves identically direct and through Caddy
   (`idle.mjs`: load 200 in about 8.6 s vs 8.7 s, 31 requests each, 1 long-lived request pending in both), so it is
   the app's own streaming request, not Caddy.

Behavioural changes of installing the deny, by design: a trailing slash on a protected path (`/seasons/2024/`,
`/clubs/carlton/`) is now a Caddy 404 where Next answered 308; the denied body is Caddy's "Not Found" (9 bytes), not
Next's 404 page; the match-id cap is 99,999; slugs must be `[a-z0-9-]`; sitemap segment ids must be 0 to 999.

## 4. Residual model (what O-1 does NOT bound)

A path that is well formed but names nothing (`/players/not-a-real-name-4711`, `/clubs/anything`, `/matches/88001`)
passes the allow-list, reaches Next and persists 7 files / about 76 KiB.

Growth per distinct well-formed unknown path (`raw/measure-100.txt`, 100 paths per route): 7.00 files, 50.2 to 50.6 KB
apparent, 72 to 76.3 KiB disk, 43 to 50 ms per request. Per 1,000 paths: about 7,000 files, 50 MB apparent, 74.5 MiB
disk; about 13,700 paths per GiB; 45 GB of free space is about 618,000 paths.

Rate, one shared host (CPU saturated): one sequential client 32 paths/s = 8.4 GiB/hour; 8 or 24 parallel 51 paths/s =
13.3 GiB/hour (`raw/rate-*.txt`), so the 45 GB headroom would last about 3.4 hours of sustained attack at that rate
(the droplet is probably slower).

Which routes O-1 bounds and which it does not:

| Route | Distinct canonical-shaped paths | Bounded by O-1? |
|---|---|---|
| seasons, brownlow | at most 204 each (1897..2100): about 15 MB each | yes |
| matches | at most 99,999: about 7.6 GB worst case | yes (cap, not zero) |
| sitemap | at most 1,000 ids: about 8 MB | yes |
| players | slug x id: unbounded | no |
| clubs, venues, honour-teams | slug space unbounded | no |
| awards, records, coaches, draft, AFLW | 0 files persisted | not needed |

Protections that already limit it today:

- The beta gate (`AFLDB_BETA_GATE=on`, `src/middleware.ts`): with the gate on, 600 junk paths at 388/s persisted 0 files
  (all 307 to `/beta`), and the 60-target persistence run through the gate persisted 0 files (`raw/rate-gate-on.txt`,
  `raw/persist-gate-on.tsv`). Admitted beta and admin cookie holders remain exposed; the exposure becomes real once the
  gate is removed (at launch).
- Production facts from the issue: 45 GB free, serving tree 767 MB, no non-canonical entries present (latent).

Alternatives and complements, with what was measured:

1. Enumerated allow-lists for the finite sets (24 clubs, 52 venues, 5 honour teams, 47 awards): bounds those routes
   completely, but drifts when a club or venue is added (every release/import must regenerate the Caddyfile); not
   recommended for players (13,365 slugs).
2. Periodic prune of persisted 404/308 entries: `scripts/prune-not-found.sh` (dry run by default; `--delete`;
   `--min-age-minutes`; refuses a directory that is not `.next/server/app`). Tested on the disposable `.next`
   (`raw/prunetest.txt`): 44 requests created 129 files; dry run listed 41 entries / 2,952 KiB; delete removed exactly
   those; second dry run 0; the 656 prebuilt 200 players, `players/aaron-sandilands-19.html` and `seasons/2024.html`
   untouched; the pruned paths answer 308/404/308 as before (Next re-renders and re-persists on the next request).
   A first run on the accumulated test `.next` (9,835 entries, 746,748 KiB of persisted 404/308 from all the probes)
   deleted all of them but printed `find` errors, because deleting while `find` was still walking raced with it
   (`raw/step3-persist-fresh-and-prune.txt` keeps the dry run and delete totals, not the error lines); the script now
   lists first and deletes after, and `raw/prunetest.txt` is the retest.
   It needs a deployment decision (cron owner, running as the app user, `.next` path) and has NOT been installed.
3. Rate limiting per client: not in standard Caddy (third-party module), not recommended.
4. A custom Next `cacheHandler`: rejected, out of scope of the routes work.
5. Disk monitoring: an alert on `.next/server/app` file count / free space is the cheapest backstop.

## 5. Owner decision O-1

Recommendation: install the deny AND keep the beta gate on until a bound for players/clubs/venues/honour-teams exists
(either the prune job or enumerated allow-lists for the finite clubs/venues/honour-teams) and a disk alert is in
place. The deny closes every alias, encoded, suffixed and malformed-shape vector and bounds seasons, brownlow, matches
and sitemap; it does not make an anonymous public launch safe on its own.

Options: (A) install as prepared; (B) install and add the prune job; (C) do not install, rely on the beta gate and
monitoring only (the residual is latent while the gate is on).

Prerequisites before install (read-only, owner/root on the droplet or `psql` as the read role):

1. Slugs match the assumed charset: for players, clubs, venues and honour teams no slug fails `^[a-z0-9-]{1,100}$`
   (club/venue/honour-team 80). Measured on the 4 Nov restored copy (`raw/slugstats.txt`): 0 bad characters; longest
   players 27, clubs 22, venues 24, honour teams 35. Confirm on production.
2. `select max(id) from matches` is below about 20,000 (17,274 on the copy).
3. For the log deletion check that ISSUE-362 needs, the invite table is `admin_invites` (not `auth_invites`).

## 6. Installation procedure (for the orchestrator/owner; I executed none of it)

DELTA TO KNOW FIRST. The probe of the installed `/etc/caddy/Caddyfile` (sha256 starts `4f6972ec`, ends `7af036`;
`D:\dev\afldb-rem2-ops\docs\v2\evidence\remediation-20261114\run2\ops\raw\caddyfile-installed-vs-c1c4b22e.txt`) shows
it lacks, relative to the repository at `c1c4b22e`, the beta-host `Strict-Transport-Security "max-age=31536000;
includeSubDomains"` and `Content-Security-Policy` headers (added by commit `3ae20fe4`, 2026-08-20, and a changed comment
line). Relative to this candidate the install therefore changes:

1. response headers on `beta.afldb.com`: adds HSTS and the CSP (verified in a real browser, section 3 item 4: 0 console
   errors, assets and scripts load);
2. the ISSUE-362 log filter (`afldb_log_format`, three log sinks plus the global default log);
3. the ISSUE-357 deny.

Steps (owner or root; `sudo` is the owner's, never an agent's):

1. Back up: `sudo cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-issue357-$(date +%Y%m%d%H%M)`; record
   `sha256sum /etc/caddy/Caddyfile`.
2. Copy the candidate from the reviewed checkout: `sudo cp deploy/Caddyfile.production /etc/caddy/Caddyfile`; confirm
   `sha256sum` equals the hash in section 3 for the commit being installed.
3. Validate as the service user (validate opens the log writers): `sudo -u caddy caddy validate --config
   /etc/caddy/Caddyfile`. Expect "Valid configuration". Stop on anything else and restore step 1.
4. Owner-only reload: `sudo systemctl reload caddy` (a graceful reload; never `restart`). `systemctl status caddy` and
   the journal show no error.
5. Verification probes against `https://beta.afldb.com` (read-only, nothing here reads a production log):
   - a legitimate set returns 200 (or the gate's 307 to `/beta` when unauthenticated, the same as before the install):
     `/`, `/players/scott-pendlebury-11724`, `/seasons/2024`, `/matches/1`, `/clubs/carlton`, an AFLW player with `%2527`;
   - denied shapes return 404 with body `Not Found`: `/seasons/02024`, `/seasons/%32024`, `//seasons/2024`,
     `/players/x-1.json`, `/matches/100000`, `/sitemap/1000.xml`; and 400 for `/seasons/%zz`;
   - headers on a page: `strict-transport-security` and `content-security-policy` present;
   - open one full page in a real browser and confirm in the console that no CSP violation is reported and the page's
     scripts, styles and images load;
   - the redaction filter: make one request with a unique harmless query (`/search?q=issue357-probe`) and have the
     owner look at only that newest line's `uri` field (expect `/search`, no query). I do not read production logs.
6. Failure handling: if validate fails, do not reload; if a probe fails after reload, roll back immediately.
7. Rollback: `sudo cp -p /etc/caddy/Caddyfile.pre-issue357-<stamp> /etc/caddy/Caddyfile`; `sudo -u caddy caddy validate
   --config /etc/caddy/Caddyfile`; `sudo systemctl reload caddy`; re-run the legitimate probes.
8. AT LAUNCH: when the apex block starts proxying the application, add `import afldb_path_shape` as the first line of
   that block. Today the apex proxies only the early-access endpoint and needs no deny.
9. Maintenance: widen the match-id cap in the `matches` allow-list when `max(matches.id)` approaches 20,000; keep the
   year range in step with the app's bounds; add a new ISR route to the snippet when one is created (see section 7).

## 7. Proposed contract test (P2-07: I do not own `tests/`; the orchestrator applies this)

Home: `tests/settle-season-revalidation.test.ts`, the existing Caddyfile source-contract describe (after the
`AFLDB-ISSUE-362` describe, inside `describe('AFLDB-ISSUE-134 ...')`, using its `CADDYFILES` and `read`). It is a
source contract only; behaviour is proven by section 3.

```ts
  // AFLDB-ISSUE-357 O-1. Behaviour is proven against a real Caddy (2.11.4 and 2.11.9) in
  // docs/v2/evidence/remediation-20261114/run2/caddy357/; this keeps the source from regressing.
  describe('path-shape deny keeps non-canonical ISR paths out of Next (AFLDB-ISSUE-357)', () => {
    const snippetOf = (source: string): string =>
      source.match(/\(afldb_path_shape\) \{[\s\S]*?\n\}\n/)?.[0] ?? '';

    it.each(CADDYFILES)('%s defines the four layers on the raw request target', (path) => {
      const snippet = snippetOf(read(path));
      expect(snippet).toContain('^[^?]{513,}');
      expect(snippet).toContain('%2[EeFf]|%5[Cc]');
      expect(snippet).toContain('^/[^/?]*%');
      for (const prefix of ['players', 'matches', 'seasons', 'brownlow', 'clubs', 'venues', 'honour-teams', 'sitemap']) {
        expect(snippet).toContain(`vars_regexp {http.request.uri} ^/${prefix}/[^?]`);
      }
      expect(snippet).toMatch(/respond @afldb_bad_player "Not Found" 404/);
    });

    it.each(CADDYFILES)('%s matches the raw target, never the decoded or cleaned path', (path) => {
      const snippet = snippetOf(read(path));
      // `path` / `path_regexp` see %32024 as 2024 and clean // and /../, which hides the alias.
      expect(snippet).not.toMatch(/^\s*(@\S+\s+)?(not\s+)?path(_regexp)?\s/m);
      expect(snippet).not.toMatch(/\{http\.request\.uri\.path\}/);
    });

    it.each(CADDYFILES)('%s imports the snippet before the proxy in the application block', (path) => {
      const source = read(path);
      const block = source.match(/^(?:beta\.afldb\.com|:8090) \{\n[\s\S]*?\n\}\n/m)?.[0] ?? '';
      expect(block).toContain('import afldb_path_shape');
      expect(block.indexOf('import afldb_path_shape')).toBeLessThan(block.indexOf('reverse_proxy 127.0.0.1:3100'));
    });

    it('keeps the two Caddyfiles on the same snippet body', () => {
      const [dev, prod] = CADDYFILES.map((p) => snippetOf(read(p)).replace(/^\s*#.*\n/gm, ''));
      expect(dev).toBe(prod);
    });
  });
```

I could not run this patch (no authority over `tests/`); it is text only. The existing contract tests in that file
(`reverse_proxy` count equals `header_up X-Forwarded-For` count; log blocks import `afldb_log_format`; global block
shape) are untouched by the new snippet, which adds no `reverse_proxy`, `log` or `format` line; see section 8 for the
run on the final checkout.

## 8. Qualification record

See the final report (commit, host checkout, `git status --porcelain`, the existing contract test run, processes
stopped). Host raw outputs are hashed in `MANIFEST-host-sha256.txt`; the committed copies in `raw/`, `matrix/`,
`viacaddy/`, `corpus/` are a subset (`corpus/legit.tsv` and the 1.3 MB `matrix/*/result-legit.tsv` stay on the host,
hash in the manifest). `.txt`/`.tsv` copies are byte copies of the host files except
`raw/step3-persist-fresh-and-prune.txt`, which drops 9,800 repeated `find: ... No such file or directory` lines and cuts
lines to 400 characters (the first prune attempt raced `find`; `prune-not-found.sh` now lists first and deletes after,
retested in `raw/prunetest.txt`). Git may normalise line endings on checkout; hashes are of the host bytes.

Scope disclosures:

- Port 55673 was used for an isolated PostgreSQL for the real-app checks. It is outside the allotted 55653/55663 and
  was stopped and proven closed (`raw/cleanup-proof.txt`).
- One command extracting the Caddy tarball and running it in one step was refused by the permission classifier; it was
  split into extract, hash, then `version`.
- Scripts are in `scripts/` as written in the scratch directory; they are evidence, not product code.

---

# Addendum 2 (review REVIEW-C LOW-7 and MED-2). Earlier sections above are unchanged.

## 9. LOW-7: invite token logged unredacted for denied and odd spellings (fixed)

Finding (reviewer): the ISSUE-362 redaction was anchored `^/admin/invite/`, so a request such as
`//admin/invite/<token>`, denied by the path-shape deny, was still written to the access log with the token.

RED (the files of commit 70e9a736, prod `7149da9a...`, dev `71e604f4...`): `scripts/redact.sh` sends the fake token
`PROBE-INVITE-bbb222` in 25 raw-target spellings plus 2 negative controls (leading `//` and `///`, `/./`, `/../`, `%2F` in several places,
encoded first segment, `%69nvite` / `%49nvite` / all letters encoded, `Admin/Invite`, `invite//T`, `invite/./T`,
`invite/../invite/T`, trailing segment, `%5C` and `\`, absolute-form `//` and `/./`, a token inside another URL's
query, and a Go-malformed `%zz` after the token) and then counts the token in the access log. Result on all four
combinations (`raw/red-green-summary.txt`, `raw/red-prod-2.11.9-hook.out`): **20 occurrences of the token in the
access log** for Caddy 2.11.9 and 2.11.4 on both files. Most are denied requests, but four
(`/admin/%69nvite/T`, `/admin/%49nvite/T`, `/admin/%69%6e%76%69%74%65/T`, `/Admin/Invite/T`) are NOT denied (the stub
returned 200; Next decodes an encoded segment to the invite route), so the fix is needed independent of the deny.
The negative controls (`/admin/invites`, `/admin/uninvited/x`) stay readable.

Fix (both files, same line): a second `request>uri` rule between the exact-shape rule and the query-drop rule:

```
regexp "(?i)(?:i|%[46]9)(?:n|%[46]e)(?:v|%[57]6)(?:i|%[46]9)(?:t|%[57]4)(?:e|%[46]5)(?:/|%2f|[\\]|%5c)+[^?#]*" "invite/REDACTED"
```

It redacts everything after the word `invite` (any case, any letter percent-encoded) and a run of separators (`/`,
`%2F`, `\`, `%5C`), up to the query, wherever that word sits in the raw target (an absolute-form target included). The
first rule is kept byte for byte, so the existing contract test
(`toContain('regexp "^/admin/invite/[^/?#]+" ...')`) still holds, and the second rule is idempotent on its output.
`/admin/invites` (the list page) and `/admin/uninvited/x` are untouched (`invite` must be followed directly by a
separator).

GREEN on the final files: token occurrences in the access log 0 and in Caddy stderr 0 on all four combinations; the
logged uri of every probe ends `/admin/invite/REDACTED` (`raw/green-prod-2.11.9-hook.out`, `matrix/r2-*/hook.out`).
The Go-malformed escape (400 before any handler) is not logged at all.

Final file sha256 (these supersede the hashes in section 3; `raw/r2-caddyfile-sha256.txt`):

- `deploy/Caddyfile.production` `5078bc975a2128d32a09b07887420ec06bc919e66fc3978ddbfcf53e109eed5e`
- `deploy/Caddyfile`           `d190a7d365911e4345ea0b2bdbf027e2909006b0b63038d8cc16d4760389f0ef`

Full matrix re-run on these hashes with both hooks (special request forms plus `redact.sh`), 4 runs
(`raw/matrix-r2-{prod,dev}-{2.11.9,2.11.4}.txt`, `raw/r2-matrix-summary.txt`): legit GET 35,340 / 0 mismatches
(upstream 35,339 = expected), deny GET 2,131 / 0, legit HEAD 219 / 0, deny HEAD 2,131 (47 Node
`HPE_CLOSED_CONNECTION`, all re-checked with `curl -I`: 400), legit POST 5 / 0, deny POST 150 / 0, boundary 85 / 0,
open 41 / 0, upstream EQUAL on all 8 corpora, `adapt` and `validate` "Valid configuration" on all, sentinels 0
everywhere except the deliberate path sentinel `PROBE-PATHSECRET-eee555` (1, as in section 3). The responses do not
depend on the log filter, so the real-app and browser runs of section 3 were not repeated.

Proposed addition to the contract test (P2-07: text only, same home as section 7), after the existing
`access logs carry no tokens` describe, inside `describe('AFLDB-ISSUE-134 ...')`:

```ts
  // AFLDB-ISSUE-362 / review LOW-7: the token is redacted wherever the raw target spells the invite route.
  it.each(CADDYFILES)('%s redacts the invite token in any spelling of the raw target', (path) => {
    const snippet = read(path).match(/\(afldb_log_format\) \{[\s\S]*?\n\}\n/)?.[0] ?? '';
    expect(snippet).toContain('regexp "(?i)(?:i|%[46]9)(?:n|%[46]e)(?:v|%[57]6)(?:i|%[46]9)(?:t|%[57]4)(?:e|%[46]5)(?:/|%2f|[\\\\]|%5c)+[^?#]*" "invite/REDACTED"');
    // The invite rules run before the query-drop rule.
    expect(snippet.indexOf('"invite/REDACTED"')).toBeLessThan(snippet.indexOf('regexp "\\?.*$" ""'));
  });
```

## 10. MED-2: single combined install (for ops procedure 06)

One install, three changes, one backup, one rollback. It replaces any per-issue install steps: a separate ISSUE-362
install would be a second reload of the same file. Run by the owner or root on the droplet; no agent runs any of it
(CLAUDE.md section 9).

Approval text (name all three changes; the owner approves exactly this):

> I approve replacing `/etc/caddy/Caddyfile` on the production droplet with `deploy/Caddyfile.production` at commit
> `<SHA of the integrated commit>` (sha256 `<hash>`), followed by one `systemctl reload caddy`. This one file change
> carries THREE changes. (1) The ISSUE-362 access-log filter: the invite token (in any spelling, denied requests
> included) and every query string are no longer written to `/var/log/caddy/afldb-access.log`, `afldb-apex.log` or
> the Caddy default log, and the Referer is cut to its origin. (2) The beta-host response headers
> `Strict-Transport-Security: max-age=31536000; includeSubDomains` and the repository's `Content-Security-Policy`;
> the installed file lacks both (commit `3ae20fe4`). (3) The ISSUE-357 O-1 path-shape deny: on `beta.afldb.com` a
> path that cannot be a canonical ISR URL is answered `404 Not Found` by Caddy and never reaches the app. This
> INCLUDES A BEHAVIOUR CHANGE: a trailing slash on a protected route (`/seasons/2024/`, `/clubs/carlton/`, ...) is
> now a Caddy 404 where the app answered a 308 redirect; the denied body is Caddy's `Not Found` rather than the app's
> 404 page; matches are capped at id 99,999; slugs must be lower-case `[a-z0-9-]`. The beta gate stays on. The deny
> does not bound well-formed ids or slugs that name nothing (residual, section 4).

Procedure:

1. Production prerequisites (read-only, owner or the read role; record the output):
   - slug charset: no players, clubs, venues or honour-teams slug fails `^[a-z0-9-]{1,100}$` (clubs, venues and
     honour-teams `{1,80}`): 0 rows expected. On the 4 Nov copy: 0 bad characters, longest 27/22/24/35.
   - `select max(id) from matches;` is below about 20,000 (17,274 on the 4 Nov copy).
   - for the ISSUE-362 log-deletion decision the invite table is `admin_invites` (not `auth_invites`).
2. Backup, one name: `B=/etc/caddy/Caddyfile.pre-combined-$(date +%Y%m%d%H%M)`; `sudo cp -p /etc/caddy/Caddyfile "$B"`;
   `sha256sum /etc/caddy/Caddyfile "$B"` (the installed hash starts `4f6972ec`, ends `7af036` at the ops probe).
3. Install the candidate: `sudo cp deploy/Caddyfile.production /etc/caddy/Caddyfile`; `sha256sum` must equal the
   hash in the approval text (for this branch, the section 9 hash).
4. Validate as the service user (validate opens the log writers, so another user fails on the log file):
   `sudo -u caddy caddy validate --config /etc/caddy/Caddyfile`; expect "Valid configuration". Anything else: restore
   `"$B"` and stop; do not reload.
5. Owner reload: `sudo systemctl reload caddy` (graceful; never restart). `systemctl status caddy` and the journal
   show no error.
6. Probes against `https://beta.afldb.com`, all read-only, none reads a production log:
   - legitimate pages: `/`, `/players/scott-pendlebury-11724`, `/seasons/2024`, `/matches/1`, `/clubs/carlton`,
     `/brownlow/2024`, an AFLW player with `%2527`, `/sitemap/0.xml`: 200 (or the beta gate's 307 to `/beta` when not
     admitted, exactly as before the install);
   - deny probes: `/seasons/02024`, `/seasons/%32024`, `//seasons/2024`, `/players/x-1.json`, `/matches/100000`,
     `/clubs/Carlton`, `/seasons/2024/` (the trailing-slash change), `/sitemap/1000.xml` return 404 with body
     `Not Found`; `/seasons/%zz` returns 400;
   - headers: `curl -sI https://beta.afldb.com/` shows `strict-transport-security` and `content-security-policy`;
   - full-page load: open one player page and one season page in a real browser (admitted session); the DevTools
     console shows no CSP violation and scripts, styles, fonts and images load;
   - redaction probe: request `https://beta.afldb.com/admin/invite/ISSUE362-PROBE-0001?q=ISSUE362-PROBE-0002`, then
     `https://beta.afldb.com//admin/invite/ISSUE362-PROBE-0003` (a denied spelling; use `curl --path-as-is`), and have
     the owner look at ONLY those newest lines of the access log: `uri` must read `/admin/invite/REDACTED` for both
     and no probe string may appear. I do not read production logs.
7. Single rollback (any failed validate or probe): `sudo cp -p "$B" /etc/caddy/Caddyfile`;
   `sudo -u caddy caddy validate --config /etc/caddy/Caddyfile`; `sudo systemctl reload caddy`; repeat the
   legitimate-page probes and confirm `sha256sum /etc/caddy/Caddyfile` equals the backup's.
8. After success: record the new installed `sha256sum` and the commit in the deployment record. At launch add
   `import afldb_path_shape` to the apex block (section 6 step 8); widen the match cap when `max(matches.id)` nears
   20,000.

## 11. Orchestrator addendum: REVIEW-D LOW-4 (redirect response headers)

The redaction now also covers the logged `Location` and `Refresh` response headers (commit `cdf2bce5`; evidence and red/green
in `low4/README.md`). **The final file sha256 values supersede section 10's:**

- `deploy/Caddyfile.production` `f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d`
- `deploy/Caddyfile`           `4a4dc08e0855242782291abecb72cd24a7e92a198532b3a48b18bda84fe66d33`

Section 10's procedure is otherwise unchanged; step 3's `sha256sum` must equal the production value above.
