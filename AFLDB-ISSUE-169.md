# AFLDB-ISSUE-169 — Cloudflare Web Analytics blocked by site CSP

**Status:** **OPEN — INVESTIGATED, DISPOSITION RECOMMENDED, NO CODE CHANGE MADE (2026-09-14).**
The investigation is complete and the conclusion is that **AFLDB's CSP is not defective**: it is
enforcing, exactly as written, a commitment the site publishes to its users on `/privacy`. The
correct fix is therefore **at the Cloudflare edge, not in this repository**, and the decision is
an operator/product one. This issue stays OPEN pending that operator decision; there is no
implementation to DEV-accept and no DEV acceptance is possible (see *Why DEV cannot validate this*).

**Branch:** `opus/issue-169-cloudflare-analytics-csp`
**Worktree:** `D:\dev\afldb-issue-169`
**Base:** `origin/main` @ `371d3df` (clean, HEAD == `origin/main`)

**Severity:** Low
**Area:** Security headers / CSP (`next.config.ts`, `deploy/Caddyfile.production`) / Cloudflare edge
configuration / Privacy posture

---

## 1. Original PROD observation

Found during the `AFLDB-ISSUE-156` P4 authenticated rendered PROD acceptance on 2026-09-14
(`issues.md`, *Authenticated rendered PROD acceptance — PASS (2026-09-14)*), recorded there as the
second of two non-blocking defects and deliberately left without an ID at the time:

> Cloudflare Web Analytics never runs: the edge injects `beacon.min.js`, our CSP `script-src 'self'
> 'unsafe-inline'` blocks it, and it logs a console error on every page load. The CSP is behaving
> correctly; the analytics simply does not work. Pre-existing and unrelated to this release.

Quantified in that same run: **31 of the 44 console errors** across the whole acceptance were this
one beacon, one per page load. **Zero React, hydration, runtime or 5xx errors** were observed —
the application's own code was clean.

**This is long-standing, not new.** The same block is recorded verbatim in at least four earlier
acceptance runs, against several different releases:

| Record | Note |
|---|---|
| `issues/closed/AFLDB-ISSUE-126.md:722` | "the only console error on any page is the Cloudflare Insights beacon refused by the [CSP]" |
| `issues/closed/AFLDB-ISSUE-137.md:881-882` | `script-src 'self' 'unsafe-inline'` refusing `static.cloudflareinsights.com/beacon.min.js`; appears on the beta gate and the admin login page |
| `issues/closed/AFLDB-ISSUE-152.md:6162` / `issues.md:22113` | "a pre-existing, unrelated analytics-beacon issue" |
| `issues.md:120`, `IssuesIndex.md:218` (ISSUE-155) | "only console/network noise was a pre-existing unrelated Cloudflare Insights beacon blocked by CSP" |

It has been re-observed and re-dismissed in five separate acceptance passes. That recurring
bookkeeping cost is the real motivation for settling it here.

---

## 2. Actual CSP ownership

AFLDB defines a Content-Security-Policy in **three** places. Nothing else in the repository sets,
appends to, or rewrites one — `src/middleware.ts` does not touch response security headers, and no
route handler or layout emits a CSP.

| # | Definition | Applies to | Value |
|---|---|---|---|
| 1 | `next.config.ts:42-58` (`securityHeaders`, served via `headers()` on `/:path*`) | every application response, every host | `script-src 'self' 'unsafe-inline'` when `AFLDB_ENV=production`, otherwise `… 'unsafe-inline' 'unsafe-eval'` |
| 2 | `deploy/Caddyfile.production:71` (`beta.afldb.com` block) | the application host on PROD | byte-identical to the production form of #1 |
| 3 | `deploy/Caddyfile.production:172` (`afldb.com` apex block) | the static coming-soon page | stricter: `script-src 'self'` — no `'unsafe-inline'` at all |

`deploy/Caddyfile` (DEV, `:8090`) sets **no** CSP, so on DEV the effective policy is #1 alone.

**Operationally important, and easy to get wrong:** Caddy's `header <field> <value>` directive
*sets* the field, replacing whatever the upstream sent (appending would require `header +Field`).
On PROD, therefore, **the browser sees Caddy's string, not Next's.** The two are currently
byte-identical so the distinction is invisible — but it means a CSP change made only in
`next.config.ts` would be **silently overwritten in production** and would appear to have no
effect. Any future CSP change must be made in `next.config.ts` *and* `deploy/Caddyfile.production`
together.

There is a third failure mode in the same area: `next.config.ts:10-12` records that `headers()` is
evaluated when the routes manifest is generated, so `AFLDB_ENV` is read at **build** time. A CSP
change needs a rebuild, not a restart.

### Effective CSP, by host

**PROD `beta.afldb.com` (the application)** — the header observed in the acceptance run:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self';
frame-ancestors 'none'; base-uri 'self'; object-src 'none'
```

**PROD `afldb.com` (the apex coming-soon page)** — stricter:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'
```

**DEV `:8090`** — Next's value only. The dev host is plain HTTP on the LAN, so `AFLDB_ENV` is
expected to be `development` there and the policy additionally carries `'unsafe-eval'` for React
Refresh. *Inferred from `deploy/Caddyfile` and `next.config.ts:14`; not measured.* Confirmable
read-only with:

```bash
curl -sSI http://<dev-host>:8090/ | grep -i '^content-security-policy'
```

---

## 3. How Cloudflare Web Analytics got here

- **Not in the repository.** No file under `src/`, `deploy/` or `docs/` references
  `cloudflareinsights`, `beacon.min.js`, or Cloudflare Web Analytics. There is no `<Script>` tag,
  no analytics component, and no environment flag. Every repository mention of "Cloudflare" is a
  *retrospective note in an issue record* describing this same console error, or the network path.
- **Injected at the edge.** `issues/closed/AFLDB-ISSUE-137.md:685` records the live request path as
  **Cloudflare → Caddy → Node**, so the zone is proxied. Cloudflare Web Analytics' *automatic
  setup* rewrites HTML at the edge to insert the beacon; that is the only mechanism consistent
  with a script AFLDB never authored appearing on every page.
- **Enabled deliberately at some point, by someone, in the Cloudflare dashboard** — it is not on by
  default — but **no record of that decision exists in this repository**, and no AFLDB
  documentation mentions Cloudflare at all. Cloudflare-side configuration is state this repository
  cannot see; the dashboard is the only authority for which hostnames it is enabled on.

**Unknown, and it matters (see §6):** whether the beacon is also being injected into the apex
`afldb.com` coming-soon page. The 2026-09-14 acceptance covered `beta.afldb.com` only. The apex
CSP is stricter still (`script-src 'self'`), so if it is injected there, it is blocked there too.

---

## 4. Exact blocked request, and what allowing it would cost

**Blocked script:**

```
https://static.cloudflareinsights.com/beacon.min.js?token=<site-token>
```

refused by `script-src 'self' 'unsafe-inline'`, once per page load.

**Subsequent RUM endpoint.** Cloudflare's own Web Analytics documentation distinguishes two cases:

| Setup | Beacon posts to | CSP directive needed |
|---|---|---|
| **Automatic (edge-injected) — AFLDB's case** | `/cdn-cgi/rum` on the **site's own origin** | `connect-src 'self'` — **already present** |
| Manual JS snippet | `https://cloudflareinsights.com/cdn-cgi/rum` | `connect-src cloudflareinsights.com` |

**So the answer to "script-src, connect-src, both, or neither?" is: `script-src` only.** Because
Cloudflare proxies the zone, the measurement POST is same-origin and `connect-src 'self'` already
covers it. Cloudflare's documented allowance is an **exact script path**, not a host wildcard:

```
script-src … https://static.cloudflareinsights.com/beacon.min.js
```

This is worth stating plainly because it is the *opposite* of the reflex fix: **`*.cloudflareinsights.com`
is both wrong and unnecessary.** If this were ever implemented, one exact path in one directive is
the whole change — no wildcard, no `connect-src` change, no new `'unsafe-eval'`, nothing else
touched. Cloudflare additionally recommends trialling such a change with
`Content-Security-Policy-Report-Only` first.

---

## 5. Security and privacy analysis

### 5.1 The security cost of allow-listing is small

Cloudflare terminates TLS for this zone. It can already rewrite the HTML, inject any script it
likes, and — critically — **rewrite the `Content-Security-Policy` header itself**. Cloudflare is
therefore *already inside* AFLDB's trust boundary, and adding one exact Cloudflare script path to
`script-src` does not meaningfully expand it. Anyone arguing this change on pure
script-execution-risk grounds is overstating it.

The honest objection is narrower, and it is about direction of travel: `next.config.ts:22-27`
records that removing `'unsafe-inline'` from `script-src` is the next planned hardening step, to be
done with a per-request nonce. Adding a remote origin now moves the policy the other way, and a
nonce-based policy would have to carry the Cloudflare exception forward explicitly.

### 5.2 The real objection is a published privacy commitment

`src/app/privacy/page.tsx:24-31` — the page the consent banner links to — tells users, in the
site's own words:

> There is no third-party analytics, no advertising, no tracking pixel and no social embed on this
> site. **Nothing you do here is sent to another company.** The Content-Security-Policy blocks
> scripts, fonts and images from other origins outright, **so this is enforced by the browser
> rather than promised.**

The file's own header comment (`src/app/privacy/page.tsx:9-14`) states the intent explicitly:
"everything below is checkable against the code it names … a claim someone can verify is worth more
than a paragraph of assurance."

Allow-listing the Cloudflare beacon would falsify **all three** of those sentences at once:

1. Cloudflare Web Analytics *is* third-party analytics.
2. Page-load measurements about the visitor *would* be sent to another company.
3. The CSP would no longer block scripts from other origins outright — and that third sentence is
   precisely the mechanism the page offers as proof of the first two.

AFLDB also runs a consent banner and a `Cookies` table on the same page. Introducing third-party
analytics is a consent-scope question as well as a wording question.

### 5.3 The conclusion that follows

**The CSP block is not a defect. It is the policy working, visibly, as published.** The beacon is
being refused for exactly the reason the privacy page tells users it will be refused. Nothing is
currently leaking: because the script never executes, **no AFLDB visitor data reaches Cloudflare
Web Analytics today.**

The genuine finding is the inverse of the one reported: an analytics injector is **enabled at the
edge on a property whose published policy says it has none**, and the only thing standing between
that configuration and a live third-party analytics feed is a CSP header that Cloudflare itself is
positioned to rewrite. That is a latent privacy-posture inconsistency worth closing at the source,
not a bug worth working around.

---

## 6. Disposition

**RECOMMENDED — Cloudflare-side, no repository change:** disable Cloudflare Web Analytics / RUM
beacon injection for the `afldb.com` zone in the Cloudflare dashboard.

This:

- removes 31 console errors per acceptance run and ends five runs' worth of recurring triage;
- keeps `script-src` exactly as it is on the host that serves the admin console and sessions;
- keeps `/privacy` true, and keeps it true *by construction* rather than by a header;
- requires no code, no migration, no deployment, no rebuild, and carries no rollback risk.

Nothing of value is lost. `beta.afldb.com` sends `X-Robots-Tag: noindex, nofollow`
(`deploy/Caddyfile.production:66`), serves `Disallow: /`, and sits behind the beta gate, so
anonymous traffic is redirected before it renders. Analytics there measures the operator and
little else.

### If the operator instead wants analytics

That is a **product and privacy decision, not a CSP bug**, and it has an order of operations:

1. Decide whether third-party analytics is acceptable for AFLDB at all, and on which hostname.
   The apex `afldb.com` — indexable, static, unauthenticated, no sessions — is the only place the
   numbers would mean anything today, and the only place where the privacy trade-off is contained.
2. **Rewrite `src/app/privacy/page.tsx` first**, so the site never claims something untrue, and
   review whether the consent banner must gate the beacon.
3. Only then make the CSP change — and make it in **both** `next.config.ts` and the correct block
   of `deploy/Caddyfile.production` (§2), adding the single exact path
   `https://static.cloudflareinsights.com/beacon.min.js` to `script-src`. `connect-src 'self'`
   already suffices. No wildcard, no other directive.
4. Rebuild (not just restart) — `AFLDB_ENV` and `headers()` are read at build time.

**This ordering is not negotiable in the other direction:** shipping the CSP change while
`/privacy` still says "there is no third-party analytics" would publish a false statement to users.

### Revisit at apex launch

`deploy/Caddyfile.production:120-122` records that at launch the apex block is replaced with the
same `reverse_proxy` body the beta block has. At that point the application *becomes* the
indexable public host and the value calculation changes. This disposition should be re-examined
then — as a deliberate decision, with §5.2 settled first.

---

## 7. Why no code change was made

The task brief for this issue states: *"If the evidence shows Cloudflare Analytics should instead
be disabled at the Cloudflare edge rather than allow-listed in AFLDB, stop and recommend that
disposition rather than changing code."* §5 is that evidence. No file under `src/`, `deploy/` or
`next.config.ts` was modified, and no test was added.

## 8. Why DEV cannot validate this

Even had a CSP change been implemented, **the brief's rendered DEV acceptance targets could not
have been met**, and this is a property of the environment rather than of the change:

- `deploy/Caddyfile` binds `:8090` and states it "deliberately does NOT reference afldb.com". DEV
  is reached over plain HTTP on the LAN.
- **Cloudflare is not in front of DEV.** No edge, no HTML rewriting, **no beacon injected at all.**

So on DEV, "`beacon.min.js` is no longer rejected by CSP" and "the analytics request can proceed"
are unobservable — there is no request to observe, before or after. DEV could only ever confirm the
*header string*, which is a unit-level fact, not rendered acceptance. The only host that can
demonstrate the behaviour end-to-end is `beta.afldb.com`, and this issue explicitly performs no
production deployment.

---

## 9. Observations recorded, not acted on

Both were found while establishing §2. Neither is allocated an ID here, and neither is in this
issue's scope; they are recorded so the next person does not have to rediscover them.

1. **No test covers any security header.** A search of `tests/` for `Content-Security-Policy`,
   `securityHeaders`, `X-Frame-Options` and `Strict-Transport-Security` returns nothing, and no
   test imports `next.config.ts`. The CSP, HSTS, `X-Frame-Options`, `Referrer-Policy` and
   `Permissions-Policy` are entirely unasserted. `tests/indexing.test.ts` mentions the CSP only in
   prose comments.
2. **The Next and Caddy CSP strings are duplicated and kept in sync by hand**, with Caddy silently
   winning on PROD (§2). Nothing detects drift between them.

Together these mean a CSP regression — including an accidental widening — would ship unnoticed. A
focused test asserting the `next.config.ts` policy shape (no `*`, no `'unsafe-eval'` in production,
`object-src 'none'`, `frame-ancestors 'none'`) plus a string-equality check against the
`deploy/Caddyfile.production` beta block would close both, cheaply. That is a reasonable
follow-up; it is deliberately **not** done under this issue, which changes no policy and so has no
behaviour to regression-test.

---

## 10. Status

| Environment | State |
|---|---|
| Repository | **No change.** Tracking only: this file, `issues.md`, `IssuesIndex.md`. |
| DEV | Unaffected and untestable for this behaviour (§8). No Cloudflare edge. |
| PROD (`beta.afldb.com`) | Unchanged. Beacon still injected, still blocked, still one console error per page load. **No visitor data reaches Cloudflare Web Analytics.** No deployment performed under this issue. |

## 11. Next action

**Operator decision at the Cloudflare dashboard**, which this repository cannot make or observe:

1. Confirm which hostnames Web Analytics / RUM injection is enabled for — `beta.afldb.com`,
   `afldb.com`, or both. This is the one fact the investigation could not establish, and it
   determines whether anything is being lost today (§3).
2. Apply the §6 recommendation: **disable it**, or consciously accept the §6 alternative path
   starting with the `/privacy` rewrite.

Close this issue once that decision is taken and recorded here. If the decision is "disable", the
closure evidence is a clean browser console on the next PROD acceptance run — a check that already
happens every time, at no extra cost.
