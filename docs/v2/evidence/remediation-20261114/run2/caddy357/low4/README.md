# REVIEW-D LOW-4: the token in logged redirect response headers (orchestrator, run 2)

**Finding (REVIEW-D LOW-4, confirmed by measurement, wider than reported):**
- Next answers a trailing-slash form with a 308 whose `Location` **and** `Refresh: 0;url=...` response headers echo the path and query.
- Caddy's access log records `resp_headers`.
- The run-2 filter rewrote only `request>uri` and the Referer, so the token reached the log in two cases:
  - `/admin/invite/<token>/`: the invite token;
  - `/beta/verify/?token=<token>`: the magic-link token, via `Location` and `Refresh`.

**Fix (commit `cdf2bce5`):**
- Both Caddyfiles now apply the existing any-spelling invite rule and the query-drop rule to `resp_headers>Location` and `resp_headers>Refresh`.
- The snippet is identical in both files.
- The contract test `tests/settle-season-revalidation.test.ts` gains "redacts the token and query in the logged Location and Refresh response headers".

**Method (`loc-probe.sh`):**
- Real Next production build of the caddy357 workspace (`EILJAA4NowINsjUcj8YGG`, open mode, its own isolated cluster), behind Caddy 2.11.4 (production's version) and 2.11.9.
- Caddy runs with admin off and local ports only, using the same transform as `scripts/caddyapp.sh`.
- Before = files at `acd3a8c9`: prod `5078bc97…eed5e`, dev `d190a7d3…f0ef`.
- After = files at `cdf2bce5`: prod `f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d`, dev `4a4dc08e0855242782291abecb72cd24a7e92a198532b3a48b18bda84fe66d33`.
- Synthetic token `LOCPROBE…`.
- Paths:
  - `/admin/invite/T/`
  - `/admin/invite/T/?x=1`
  - `/Admin/invite/T/`
  - `/beta/verify/?token=T`
  - `/admin/invite/T`

**Result (`result.txt`):** 6 log lines per run.

| Files | Caddy 2.11.4 | Caddy 2.11.9 |
|---|---|---|
| before | **4 lines carry the token** (Location `/admin/invite/T`, `/Admin/invite/T`, `/admin/invite/T?x=1`, `/beta/verify?token=T`) | same |
| after | **0 lines**; Location `/admin/invite/REDACTED` (2), `/Admin/invite/REDACTED` (1), `/beta/verify` (1) | same |

The first probe of the fix, with Location only, still left 3 lines, carried by `Refresh`. That is why both headers are covered.
The responses themselves are unchanged: the filter acts on the log only.

**Contract test** (`red.txt`, `green.txt`): the new test at `acd3a8c9`'s Caddyfiles fails 2/2 (`Location: expected '' to contain ...`). At `cdf2bce5` the file passes 86/86.

**Not re-run:** the 35,340-path matrix. The change touches only the log `format filter`, never the routing or the deny, and the responses above are unchanged.

**Consequence for the O-1 log decision (procedure 06 §3):**
- Pre-fix logs can hold magic-link and invite tokens in `resp_headers` as well as in `uri`.
- The magic-link token lives 30 minutes, so only the invite token (7 days) can still be live.
- The recommendation (check `admin_invites`, then delete or truncate) is unchanged.
