# R5: the pre-fix Caddy logs: scope, restricted retention, and a proposed expiry (ISSUE-362 O-1; prepared 22 Nov 2026, run d)

**Owner decision 5 (22 Nov, round 3):** RETAIN the pre-fix Caddy logs for now, with RESTRICTED ACCESS; propose a retention expiry and
a disposal method for a later decision. **Nothing is deleted.** No production log was read for this document: every fact below comes
from file metadata recorded by read-only probes, the Caddyfile and the application code. The access restriction is an A2 owner
step (`ATTENDED-PLAN-A1-A2-20261124.md` §4.5a); this file is the reasoning and the expiry proposal.

**Owner decision 3 (22 Nov, round 4, `DECISIONS-20261122e.md` §3): R5 APPROVED as retention.** (1) §4.5a of the A1/A2 runbook runs
in A2 (move, copies, `SHA256SUMS`) followed by the owner's re-verify `sudo sh -c 'cd $R && sha256sum -c --quiet SHA256SUMS'` and an
inventory report (names, sizes, `SHA256SUMS` line count; never content); the Caddy size-growth check stays. (2)
`afldb-access-2026-09-04T11-02-31.065-size.log.gz` is recorded as **ALREADY ROTATED OUT** (pruned by Caddy between 14 and 22 Nov; not
recoverable from the host). (3) **Thu 7 Jan 2027 is the EARLIEST DISPOSAL REVIEW DATE, not a disposal date: disposal needs a separate
owner approval** (§5 stays the menu for that later decision). (4) The exact retained paths are fixed in advance (§7) and printed at
the review by `r5-20270107/r5-retained-paths.sh`. **Provider copy:** if the R6 morning snapshot of Wed 25 Nov is taken
(`ATTENDED-PLAN-R6-20261125.md` §2.2, B-2), it holds these retained files too, outside this restriction, until the owner deletes it
(its own disposal review date is also 7 Jan 2027, `OPEN-ITEMS-AFTER-SITTINGS.md`).

## 1. Exact scope (from the records)

| File under `/var/log/caddy/` | Size (22 Nov) | Covers (from the name stamp = rotation time, and the next file) | Status |
|---|---|---|---|
| `afldb-access-2026-09-07T21-28-03.060-size.log.gz` | 1,130,156 B | beta host access log, about 4-7 Sep 2026 | rolled, pre-fix |
| `afldb-access-2026-09-14T12-27-36.536-size.log.gz` | 1,121,927 B | 7-14 Sep | rolled, pre-fix |
| `afldb-access-2026-10-15T13-18-15.638-size.log.gz` | 1,149,465 B | 14 Sep-15 Oct | rolled, pre-fix |
| `afldb-access-2026-11-02T07-51-03.012-size.log.gz` | 1,113,936 B | 15 Oct-2 Nov | rolled, pre-fix |
| `afldb-access-2026-11-16T05-48-24.848-size.log.gz` | 1,078,750 B | 2-16 Nov | rolled, pre-fix |
| `afldb-access.log` | 8,094,530 B (growing) | 16 Nov to now; pre-fix until the R4 reload, redacted after | live |
| `afldb-apex-2026-09-09T13-26-13.354-size.log.gz` | 1,413,311 B | apex (coming-soon) host, to 9 Sep | rolled, pre-fix |
| `afldb-apex-2026-09-28T10-33-21.243-size.log.gz` | 1,288,778 B | 9-28 Sep | rolled, pre-fix |
| `afldb-apex-2026-10-21T04-04-49.343-size.log.gz` | 1,463,479 B | 28 Sep-21 Oct | rolled, pre-fix |
| `afldb-apex.log` | 19,348,347 B (near the 20 MiB roll) | 21 Oct to now | live; **likely to roll before Tuesday** (a fourth apex `.gz`) |

Sources: `R0-prod-probe-20261121T155246Z.txt:140-156` (22 Nov listing, all `caddy:caddy 0600`, directory `caddy:caddy 0755`, 36 MB),
`remediation-20261114/run2/ops/raw/prod-ro-ops-notify-logs.txt:199-219` (14 Nov listing and the installed `roll_size 20MiB`/`roll_keep 5`).
The access log of the oldest period (`afldb-access-2026-09-04T11-02-31.065-size.log.gz`, 1,086,027 B on 14 Nov) **no longer exists**:
Caddy pruned it at the 16 Nov roll (`roll_keep 5`). The earliest beta access history is therefore already gone. **Status: ALREADY ROTATED
OUT** (owner decision 3, round 4): it is not part of the retained set, and its absence is not a defect of the A2 step.

**What they contain (pre-filter).** Caddy's JSON access lines: full request URI including query strings, request headers (`Cookie`
and `Authorization` are already written as `REDACTED` by Caddy), the `Referer`, response headers (`Location`, `Refresh`), client IP and
user agent. Token-bearing routes, enumerated from the code (`src/app/**`, run d):

| Route | Token | Lifetime | Where it appears in a pre-fix line |
|---|---|---|---|
| `/admin/invite/<token>` | admin invite, single use, stored hashed | **7 days** (`INVITE_TTL_DAYS = 7`, `src/app/admin/admins/invite-actions.ts:17`, `:83`) | `uri`; the `Referer` of the page's own subrequests; the `Location`/`Refresh` of the 308 for `…/<token>/` |
| `/beta/verify?token=<token>` | beta magic link, single use, stored hashed | **30 minutes** (`src/app/beta/actions.ts:124`) | `uri` query; the `Referer` of subrequests |
| beta access codes `afldb-…` | up to 365 days | submitted by POST form (`src/app/beta/actions.ts:62`): **never in a URI**, so not in these logs |
| session cookies, `Authorization` | — | — | already `REDACTED` by Caddy |
| internal revalidation secret | — | — | sent to `127.0.0.1:3100` directly, never through Caddy |

Everything else is personal data rather than credentials: IP addresses, user agents, search and query text.

**Current access (records).** Files `caddy:caddy 0600` (content: root and the `caddy` service user); directory `0755` (names and sizes:
every local user). `arm` cannot read content. After R4 only new lines are redacted; the pre-fix lines stay as they are.

## 2. Why "retain" needs a step (finding, MED)

Caddy prunes rolled files itself (`roll_keep 5` per log; the Caddy documentation also gives `roll_keep_for` a 90-day default when
unset, which procedure 06 §1 records as documented but **not re-verified**). Evidence that it is happening: the 4 Sep access file existed
on 14 Nov and was gone on 22 Nov. At the 22 Nov growth rate (about 1.3 MB/day for access) the next access roll is about early December,
which deletes `afldb-access-2026-09-07…`; a 90-day age limit, if in force, would delete the 7 Sep and 9 Sep files from about 6-8 Dec.
Both happen during the owner's leave. R4 does not change rotation (`deploy/Caddyfile.production:283-285`, `:397-399`).
So A2 §4.5a moves the rolled files out of Caddy's directory into a root-only directory and copies the two live files there.

## 3. The restriction (A2 §4.5a, one owner block, after R4's probes pass)

Target `/var/log/afldb-r5-prefix-retained-20261124/`, `root:root 0700`; the eight (or nine) rolled files moved there (same file system:
a rename, bytes and times kept), copies of the two live files, a `SHA256SUMS`; all `root:root 0600`. The live files are never touched
(Caddy keeps writing them, owner and mode unchanged). Acceptance: the listing, and the live access log grows after one request.
Rollback: move the rolled files back and restore `caddy:caddy 0600`; remove only the copies and `SHA256SUMS`; `rmdir`. Exact commands:
the runbook. Against what the kits say: packet R5's acceptance ("only the live files, still `caddy:caddy 0600`") is met by this
block too; the kits' option b/d commands (`rm`, `truncate`, `gpg`) are **not** used (disposal is not decided).

## 4. When the raw tokens become harmless

Every token in a pre-fix line was issued before the R4 reload. A magic link dies 30 minutes after issue; an invite 7 days after issue,
or earlier when used or revoked; the R0 probe found **0 live invites** on 22 Nov (`admin_invites` unused, unrevoked, unexpired), and P1
re-reads that count on Tuesday. Therefore **every credential in the retained files is dead by the R4 reload + 7 days, about Tue 1 Dec
2026**, and already dead now unless an invite is issued between 22 Nov and R4. From then on the files hold no usable credential, only
personal data (IPs, user agents, query text), whose retention should be no longer than the purpose (incident review) needs.

## 5. Two options for the later disposal decision (not decided; the earliest REVIEW is Thu 7 Jan 2027, round 4)

| | **Option 1: short (dispose after the leave)** | **Option 2: Caddy's own horizon** |
|---|---|---|
| Expiry | first attended owner sitting **on or after Thu 7 Jan 2027** (for example the Tuesday 12 Jan weekly slot, as its own step) | when the newest pre-fix line is 90 days old: **on or after Mon 22 Feb 2027**; first attended sitting after that which is **not** the R8 opening (for example Tue 2 Mar 2027) |
| Why | tokens dead since about 1 Dec; the six weeks of leave are covered for incident review; minimum personal-data retention after that | the same history the logs would have kept had nothing been changed (`roll_keep_for` default), so no loss of operational evidence |
| Cost | access history before 24 Nov is gone after 7 Jan (no long-term traffic or forensic record) | about seven more weeks of personal data held; one more attended step in the busy pre-season (R8 capture 19 Feb, opening 23 Feb) |
| Disposal method (both) | owner, `sudo`: re-list and `sha256sum -c SHA256SUMS` (record names, sizes, result only), then `sudo rm -r -- /var/log/afldb-r5-prefix-retained-20261124`; record the date. Optional before deletion: `gpg --symmetric` the directory to the owner's own host if long-term history is wanted (kits option d), the passphrase then becomes the thing to guard | as Option 1 |
| Limits (both) | `rm` on ext4 is not secure erasure; any DigitalOcean backup or snapshot of the droplet (unverified) keeps its own copy until it expires; the live files' pre-fix lines age out by Caddy's own rotation | as Option 1 |

Either way the decision closes ISSUE-362's O-1 (the issue then resolves; its R4 part is A2). Approval text to fill:

> I choose R5 option ____ for the pre-fix Caddy logs retained in `/var/log/afldb-r5-prefix-retained-20261124/`: dispose on or after
> ________ by the method in `R5-RETENTION-PROPOSAL.md` §5 (with / without an encrypted archive first).

## 7. The exact retained paths expected after A2 (template) and the review helper

After §4.5a (Tue 24 Nov, stamp `S` = the UTC time of the copy, `YYYYMMDDTHHMMSSZ`), `R=/var/log/afldb-r5-prefix-retained-20261124`
is `root:root 0700` and holds exactly, each `root:root 0600`:

```
$R/SHA256SUMS                                                   (lines = files - 1; does not list itself)
$R/afldb-access-2026-09-07T21-28-03.060-size.log.gz             1,130,156 B on 22 Nov (absent if a roll pruned it before A2: record)
$R/afldb-access-2026-09-14T12-27-36.536-size.log.gz             1,121,927 B
$R/afldb-access-2026-10-15T13-18-15.638-size.log.gz             1,149,465 B
$R/afldb-access-2026-11-02T07-51-03.012-size.log.gz             1,113,936 B
$R/afldb-access-2026-11-16T05-48-24.848-size.log.gz             1,078,750 B
$R/afldb-apex-2026-09-09T13-26-13.354-size.log.gz               1,413,311 B
$R/afldb-apex-2026-09-28T10-33-21.243-size.log.gz               1,288,778 B
$R/afldb-apex-2026-10-21T04-04-49.343-size.log.gz               1,463,479 B
$R/afldb-apex-<stamp of a roll after 22 Nov>-size.log.gz        only if the apex log rolled before A2 (expected; record it)
$R/afldb-access.log.copy-at-r5-<S>                              copy of the live access log at A2
$R/afldb-apex.log.copy-at-r5-<S>                                copy of the live apex log at A2
```
Not present by design: `afldb-access-2026-09-04T11-02-31.065-size.log.gz` (ALREADY ROTATED OUT). The A2 record fills in the actual
`<S>`, any fourth apex name, every size and the `SHA256SUMS` line count; that record is then the reference for the review.

**Helper for the 7 Jan 2027 review:** `r5-20270107/r5-retained-paths.sh`, sha256 of the LF form
**`ba5ccc178387849a846063040952dbccf922aeddae3b435b23218949da7398ed`**. Read-only (lists, hashes, `sha256sum -c`, prints a
deletion-approval list; deletes nothing); run by the owner as root; no argument; the directory is hard-coded. Transport (reviewer
F-009): it is never copied into the production checkout; it is piped as `arm` to `/home/arm/ops/r5-retained-paths.sh` (a named
production write outside the checkout), the owner compares `sha256sum` with the value above, runs `sudo bash` on it and removes the
copy. Dry-run on streamanator against a scratch directory (run e, `r6-20261125/dry-run-20261122e.log`, run 3): the positive case
passes `sha256sum -c`, a tampered file fails it, the non-root refusal works; the owner/mode lines FAIL there by design (scratch files
are `arm`-owned). In A2 itself the inline owner block of runbook §4.5a is used (no file transfer on Tuesday).

## 6. Not verified

Caddy's `roll_keep_for` default in 2.11.4 (documented 90 days; not re-read here); whether the apex log rolled before Tuesday (A2 P0
lists it); DigitalOcean backup/snapshot settings; the content of any log (never read, by design); the helper of §7 on production
(it has run only on a scratch directory).
