# AFLDB-ISSUE-266 — Email intake accepts unaligned SPF/DKIM passes, so a forged From address stages submissions as any admin

## 0. Status

- **Status:** Open (2026-10-08). D-266-1 and D-266-2 decided 2026-10-09. **Implemented in the working tree of
  `fix/issue-266-email-intake`, uncommitted** (§18; pre-commit review fixes §18.8). Isolated Linux suite passed
  160/160 on streamanator, 2026-10-09 (§18.9). Per-host mail-server verification and configuration outstanding
  (§18.6); not deployed, no host accepted.
- **Severity:** High. **Area:** legacy CSV intake / email ingress / authentication boundary.
- **Key files:** `tools/email_intake/fetch_and_stage.py` (`sender_is_authenticated`), `src/app/api/admin/email-intake/route.ts`.
- **Origin:** full code review of `review/full-code-20261008` at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-001; partition note R5a-F01).
- **Classification:** reproduced (DB-free witness W1).

## 1. Summary

The email poller decides whether a message really comes from the address in its `From:` header. It also accepts a message that does not pass DMARC, provided the receiving server's first `Authentication-Results` header contains both `spf=pass` and `dkim=pass`. Those results attest the envelope sender and the signing domain, not the `From:` domain. A sender who controls any domain with valid SPF and DKIM can therefore forge `From: <admin address>` and have a CSV staged and validated under that administrator's identity. An explicit `dmarc=fail` in the same header does not stop it.

## 2. Evidence

- `tools/email_intake/fetch_and_stage.py:261-277`:
  - `dmarc=pass` returns True.
  - Otherwise `if "spf=pass" in top and "dkim=pass" in top: return True, "spf=pass, dkim=pass"`.
  - There is no alignment check of `smtp.mailfrom` / `header.d` against the From domain, and no refusal on `dmarc=fail`.
- `fetch_and_stage.py:385-393` (the only caller) and `:409`: the poller POSTs `senderEmail=<From address>` to the app.
- `src/app/api/admin/email-intake/route.ts:120-137`: the route resolves that email to an `auth_users` row and trusts the poller for sender verification (the route's own comment says so).
- `route.ts:167, :180-182, :192-194`: the submission is staged and validated, and audit rows are written with `userId` of the resolved admin.
- The test that pins the wrong behaviour, `tools/email_intake/test_fetch_and_stage.py:65-66`, expects `True` for `"mx.host.com; spf=pass smtp.mailfrom=x; dkim=pass header.d=example.com"`, with an arbitrary `smtp.mailfrom`.

## 3. Trigger

1. An attacker controls `attacker.example` with valid SPF and DKIM.
2. The attacker sends to the intake mailbox:
   - `From: <real admin>@<admin domain>`
   - `Subject: match_results`
   - a `.csv` attachment
   - envelope `MAIL FROM` and DKIM `d=` both set to `attacker.example`
3. The receiving MX writes `Authentication-Results: mx; dmarc=fail header.from=<admin domain>; spf=pass smtp.mailfrom=attacker.example; dkim=pass header.d=attacker.example`.
4. The unattended `afldb-email-intake.timer` (every 5 minutes) runs the poller.

## 4. Expected invariant

The module's own contract (`fetch_and_stage.py:17-23`) says that knowing an admin's email address must not be authorisation. Only an aligned authentication result may forward a message, meaning `dmarc=pass`, or SPF/DKIM aligned to the From domain (RFC 7489 §3.1). An explicit `dmarc=fail` must refuse.

## 5. Actual behaviour

`sender_is_authenticated` returns `(True, 'spf=pass, dkim=pass')`. The message is forwarded, staged, validated and audited as the forged administrator.

## 6. First wrong layer

`tools/email_intake/fetch_and_stage.py:273-276`.

## 7. Impact

- Any internet sender can stage and validate submissions under any enabled staff identity.
- The review queue is polluted and audit rows are mis-attributed.
- The defect enables the memory-pressure path in AFLDB-ISSUE-304.
- Promotion still requires a Super Admin's approval, which bounds the data impact. The authentication boundary itself is broken.

## 8. Reproduction / witness

- W1 (DB-free, network-free): `D:\tmp\review-20261008-full\witness\w1_sender_auth.py`, run with `python -I` against the repository module. Output `w1.out`:
  - `'mx.host.com; dmarc=fail header.from=example.com; spf=pass smtp.mailfrom=attacker.example; dkim=pass header.d=attacker.example' -> (True, 'spf=pass, dkim=pass')`
  - `'mx.host.com; spf=pass smtp.mailfrom=attacker.example; dkim=pass header.d=attacker.example' -> (True, 'spf=pass, dkim=pass')`

## 9. Disproof attempts

- The route does not re-verify the sender (`route.ts:120-127`).
- `AFLDB_INTAKE_AUTHSERV_ID` (`fetch_and_stage.py:267-271`) checks only who wrote the header, not alignment. It is optional and commented out in `.env.example:224`.

## 10. Existing-issue search

- `issues.md` was searched for `Authentication-Results`, `dkim=pass`, `spf=pass` and `sender_is_authenticated`. The only hit is the ISSUE-186 Phase A note that the route still admits contributors.
- The 2026-09-17 review's residual covered the contributor role only.
- Classification: **new**. Related: AFLDB-ISSUE-186 (Phase B deferred), AFLDB-ISSUE-304.

## 11. Scope

The sender-authentication decision in the poller, and the test case that pins it.

## 12. Out of scope

Retirement of the legacy pipeline (deferred ISSUE-186 Phases B/C), and the contributor-role residual.

## 13. Proposed fix boundary

- Either require `dmarc=pass` only, or parse `header.d` / `smtp.mailfrom` and require their organisational domain to equal the From domain.
- In every case, treat a present `dmarc=fail` as a refusal.
- Update `test_fetch_and_stage.py:65-66`.
- Consider documenting `AFLDB_INTAKE_AUTHSERV_ID` as required.

## 14. Proposed validation

1. DB-free: W1 must return False for both cases.
2. Run `python3 -I tools/email_intake/test_fetch_and_stage.py`.

## 15. Decisions / unresolved questions

- D-266-1 (operator): keep a DKIM-aligned fallback, or require `dmarc=pass` only. **Decided 2026-10-09: `dmarc=pass`
  only (§18.1).**
- D-266-2 (operator): require `AFLDB_INTAKE_AUTHSERV_ID`. **Decided 2026-10-09: required whenever
  `AFLDB_INTAKE_REQUIRE_AUTH` is on (§18.1).**

## 16. Next action

Superseded 2026-10-09 by §18.7.

## 17. Pre-decision investigation (2026-10-09, worktree `afldb-issue-266` at `20a7a4bb`)

- Runbook copied byte-exact from `afldb-review-20261008` (SHA-256 `3453C9DE…AD4129`). This §17 is the only change since.
- Witness W2 (DB-free, network-free, module unmodified): `D:\tmp\issue266\witness\w2_sender_auth_266.py`, output
  `w2.out`, Python 3.12.10 on Windows.
- **R1 (review W1) reproduced.** Unaligned `spf=pass` + `dkim=pass` is accepted with and without `dmarc=fail`.
- **R2 (new, worse than F-001).** The check is a substring test over the whole header (`:273, :275`). Attacker-chosen
  text inside the trusted header therefore satisfies it. Examples: an envelope local part `dmarc=pass@attacker.example`
  in `smtp.mailfrom` (plain or RFC 8601-quoted), or the same text inside a comment. Accepted as `dmarc=pass` while the
  same header says `dmarc=fail`, with no SPF or DKIM pass at all. `dkim=pass@…` plus a real attacker-domain SPF pass
  satisfies the fallback. **`AFLDB_INTAKE_AUTHSERV_ID` does not mitigate R1–R3.**
- **R3 (new).** `dmarc=pass` is not bound to the forwarded address. `dmarc=pass header.from=attacker.example` is accepted
  for `From: admin@example.com`. This also covers multiple-From and parser-differential cases (R5: the poller forwards
  the first `From`, and a DMARC evaluator may have judged a different one).
- **R4 (configuration).** With `AFLDB_INTAKE_AUTHSERV_ID` unset (the `.env.example` default), a sole attacker-supplied
  header is trusted. Setting the variable closes R4 only.
- **Route.** `route.ts:120-137` resolves `senderEmail` against `auth_users` but cannot re-verify the sender. The poller
  is the only authentication boundary.
- **Unverified (no live access this session).** The mail host in use, and whether it:
  - prepends its own header;
  - strips inbound ones carrying its authserv-id;
  - records the local part in `smtp.mailfrom`;
  - enforces sender-domain DMARC `p=reject` at SMTP.
  Also unverified: whether `AFLDB_INTAKE_AUTHSERV_ID` is set on DEV or PROD, and which admin and contributor domains
  publish DMARC.
- D-266-1 is **not decided**. A recommendation has been returned to the operator. *(As of §17. Decided 2026-10-09; see
  §18.)*

## 18. Decisions and implementation (2026-10-09, worktree `afldb-issue-266`, base `20a7a4bb`, uncommitted)

### 18.1 Decisions (operator, 2026-10-09)

- **D-266-1.** Require a properly parsed, trusted `dmarc=pass`, with no SPF/DKIM fallback.
  - Exactly one From header, holding exactly one valid mailbox. That same parsed mailbox is `senderEmail`.
  - The DMARC result's `header.from` domain must match that mailbox's domain.
  - Refuse missing, malformed, ambiguous or conflicting authentication results.
  - Text inside comments, quoted properties or addresses never counts as a method=result.
- **D-266-2.** `AFLDB_INTAKE_AUTHSERV_ID` is required whenever `AFLDB_INTAKE_REQUIRE_AUTH` is on.
  - If it is missing or invalid, exit non-zero with a clear configuration error before accessing or modifying the
    mailbox: nothing is filed to Errors, marked read or forwarded.
  - The parsed authserv-id is matched exactly.
  - Lower headers are never searched when the first is untrusted or fails validation.

### 18.2 Implementation (`tools/email_intake/fetch_and_stage.py`; standard library only)

- **`parse_from_mailbox(msg)`.** Refuses each of the following:
  - anything other than exactly one `From` header;
  - any parser defect (`email.headerregistry`, after unfolding);
  - anything other than one ungrouped mailbox;
  - any addr-spec that is not a dot-atom local part `@` an ASCII LDH domain of at least two labels. This covers local
    parts that need quoting, domain literals and non-ASCII addresses.

  The mailbox is returned lower-cased. Needless quotes (`"admin"@x`) are normalised by the stdlib to the same mailbox.
- **`parse_authentication_results(value)`.** RFC 8601:
  - Comments are removed first; quoted strings are respected, with nesting and quoted-pairs.
  - The authserv-id is followed by an optional numeric version, then `;`-separated results.
  - A `method[/version]=result` is read only at the start of a result.
  - Property values (tokens, quoted strings, addresses, values containing `=`) are read whole.
  - `none` is allowed only alone. Whitespace around `=` is allowed.
  - Anything else raises `MalformedAuthResults`. Method, result and property names are case-insensitive.
- **`dmarc_verifies(msg, mailbox, authserv_id)`.** Reads only the topmost header and refuses unless all of these hold:
  - the header parses;
  - its authserv-id equals the configured one exactly (ASCII case-insensitive; no prefix, suffix or version matching);
  - it holds exactly one `dmarc` result;
  - that result is `pass`;
  - it has exactly one `header.from`;
  - that value (one trailing dot removed) is a valid domain equal to the mailbox's domain.

  SPF and DKIM results are ignored.
- **`sender_is_authenticated(msg, authserv_id=None)`.** Kept as the boolean composition for tests and witnesses. With no
  argument it uses the configured authserv-id; if none is configured, it answers no.
- **`intake_auth_config()`.** Returns `(require_auth, authserv_id)`.
  - `env_flag` is now strict: `ture` raises instead of reading as false.
  - The authserv-id must match `[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?` and is required when auth is on.
  - Failure raises `ConfigError`.
- **`main()`.** Calls `intake_auth_config()` immediately after `load_env()`, before the URL, the secret or
  `imap_connect()`. On `ConfigError` it prints to stderr and returns `EXIT_CONFIG = 78` (EX_CONFIG); systemd records
  this as a failed run, with no unit change needed. Per message, the order is:
  1. dataset key;
  2. `parse_from_mailbox`, filed to Errors if refused;
  3. `dmarc_verifies`;
  4. CSV attachment;
  5. POST with that same mailbox.

  A verified sender is logged as `sender domain verified: dmarc=pass header.from=… (authserv-id …)`.
- **Unchanged:** the intake route, the systemd units, and everything after the authentication decision.
- **Docs:**
  - `docs/admin-and-beta.md` §5: the new rule, the domain-not-person limit, exit 78, the setup prerequisites, and the
    setup snippet.
  - `.env.example`: the authserv-id is now marked REQUIRED and stays commented, so a copied example fails closed with
    exit 78 rather than matching a placeholder.
  - The module docstring.

### 18.3 Regression tests (`tools/email_intake/test_fetch_and_stage.py`)

- `message_with` now builds raw bytes and parses them with `email.message_from_bytes`, as production does, so folding,
  duplicate headers and malformed values arrive unchanged.
- The old pinned case (`:65-66`, unaligned `spf=pass`+`dkim=pass` → True) is removed. Its replacements expect refusal.
- **`test_sender_is_authenticated`**:
  - W1 (both cases), aligned SPF+DKIM without DMARC, and every non-pass DMARC result.
  - W2 injections R2a–R2d, a whole result smuggled in a quoted local part or a comment, an unquoted `;` copied in, and
    `dmarc=pass` as a property value.
  - R3 and its variants: other domain, subdomain, parent domain, missing, duplicate or address-shaped `header.from`.
  - Pass+fail, two passes, `none`, `none` with results, and 16 malformed shapes, including Microsoft 365's
    no-authserv-id format.
  - The topmost-only rule: a forged pass below a fail, a malformed top header, and another server's top header.
  - Exact authserv-id matching (prefix, suffix, truncated).
  - 13 legitimate formats, including Gmail, Fastmail and OpenDMARC-style fields, folding, upper case, quoting,
    trailing `;` or `.`, method version, spaces around `=`, `reason=`, and comments containing `;`.
  - Duplicate From headers, and configured versus unconfigured authserv-id.
- **`test_parse_from_mailbox`**: 9 accepted shapes and 16 refused, including CVE-2023-27043-style address shapes.
- **`test_intake_auth_config`**: missing (default and explicit), blank, valid, optional when off, 7 invalid
  authserv-ids, invalid while off, and an invalid flag.
- **`test_config_failure_leaves_mailbox_untouched`**: live and `--dry-run` modes.
  - `load_env` is stubbed so a real `.env` cannot fill in the missing settings.
  - `imap_connect` is stubbed to count calls.
  - Missing or invalid authserv-id, or an invalid flag, returns 78 with zero connections.
  - Control: with a valid configuration, the same harness does reach `imap_connect`.

### 18.4 Validation evidence (executed 2026-10-09 on Windows; no database, network, mailbox, DEV, PROD or SSH)

| Command | Result |
|---|---|
| `python -I tools/email_intake/test_fetch_and_stage.py` (CPython 3.12.10) | 145 ok, 0 FAIL, `all checks passed`, exit 0 |
| same with CPython 3.14.4 (uv) | 145 ok, 0 FAIL, `all checks passed`, exit 0 |
| W1 `D:\tmp\review-20261008-full\witness\w1_sender_auth.py` (unmodified), authserv-id unset | both cases `(False, "configuration error: AFLDB_INTAKE_AUTHSERV_ID is required …")` |
| W1, `AFLDB_INTAKE_AUTHSERV_ID=mx.host.com` | `(False, 'dmarc=fail')`; `(False, "expected exactly one dmarc result …, found 0")` |
| W2b `D:\tmp\issue266\witness\w2b_sender_auth_266_postfix.py` (W2's cases verbatim; only `sender_address` → `parse_from_mailbox(m)[0]`) | 0 accepted. With mx.host.com: R1a, R2a–d `dmarc=fail`; R1b found 0 dmarc; R3 domain mismatch; R4 wrong authserv-id. R5 (two From) `sender=None` |

- Outputs: `D:\tmp\issue266\evidence\suite-py3.12.10.out`, `suite-py3.14.4.out`, `w1-postfix.out`,
  `w2b-postfix.out`.
- Pre-fix W2 evidence stays in `D:\tmp\issue266\witness\w2.out` (§17). W2 itself no longer runs against the fixed
  module, because it calls the removed `sender_address`. That is why W2b exists.
- An ad-hoc reason dump confirmed that the adversarial cases are refused for the intended reason, not incidentally:
  conflict count, missing dmarc, malformed result, authserv-id, and domain mismatch.

### 18.5 Limitations (stated, not hidden)

- **DMARC authenticates domains, not individual mailbox owners.** A pass shows the message came through the From
  domain's own authenticated mail system. Whether that system stops one of its users sending as another address in the
  same domain is up to the domain. This is **not** complete individual-sender verification. The route's `auth_users`
  lookup and the Super Admin promotion review remain the other controls.
- Senders whose domain publishes no DMARC record (`dmarc=none`) are refused. A `p=none` record is enough for aligned
  mail. The web upload is unaffected.
- Supported only where the topmost header carries both an authserv-id and the dmarc result. Microsoft 365's format
  (no authserv-id), and stacks that put DMARC in a lower separate header, are refused by design.
- Not run on Python 3.10/3.11. The code avoids version-specific APIs, and the parser's defect reporting is relied on
  only to refuse, never to accept. (Linux on CPython 3.12.3 passed after the review, §18.9.)

### 18.6 Deployment prerequisites (none performed; no host was contacted)

For each host where `afldb-email-intake.timer` is or will be enabled (DEV and/or PROD, to be established by the
operator):

1. **Verify the receiving mail server's header behaviour.** It must **insert** its own `Authentication-Results` header
   above existing ones. It must **remove** inbound headers that already carry its authserv-id (RFC 8601 §5). Without
   the removal, a sender could forge the top header.
2. **Confirm the real authserv-id** from that server, and **configure** `AFLDB_INTAKE_AUTHSERV_ID` in the host's `.env`
   **before** this code reaches it. Otherwise every timer run exits 78 (fail closed; mail stays unread and untouched).
3. **Verify a legitimate message's header format.** Using a real delivered message from an expected sender domain,
   confirm the topmost header has the authserv-id and exactly one `dmarc=pass … header.from=<sender domain>`. Run
   `--dry-run` on the host and check it logs `sender domain verified`.
4. Confirm the expected admin and contributor sender domains publish DMARC.

### 18.7 Next action

*Superseded by §18.8.5.*

1. The operator reviews and commits the changed files (listed in the session report).
2. Run `python3 -I tools/email_intake/test_fetch_and_stage.py` on Linux.
3. Complete §18.6 per host, then deploy.
4. Resolve only after a host-side `--dry-run` accepts a legitimate message and refuses a non-passing one.

### 18.8 Pre-commit review (2026-10-09, solo, same worktree, uncommitted)

Scope: the comment/quote/escape/folding parser and malformed input; binding the verified From mailbox to
`senderEmail`; duplicate/conflicting results and version tokens; configuration validation before mailbox access; and
whether the tests drive real raw-message parsing and the forwarding path.

#### 18.8.1 Defects found and fixed

- **RV-1 (Low–Medium): encoded-word From addresses were decoded and forwarded under the decoded spelling.**
  - The stdlib's `_header_value_parser.get_dot_atom` decodes RFC 2047 encoded-words wherever a dot-atom may appear,
    including the local part and domain of an addr-spec. RFC 2047 §5 forbids encoded-words there.
  - So `From: =?utf-8?q?admin?= @example.com` came out as `admin@example.com`, with no defect recorded. (A bare
    `=?…?=@` already raised a "missing trailing whitespace" defect and was refused; the whitespace variant and an
    encoded domain were not.)
  - Proved end-to-end before the fix: the new `main()` test POSTed message 5 as `admin@example.com` and filed it to
    Processed.
  - Bounded: the dmarc `header.from` must still equal the decoded domain. The gap is the local part, a spelling that
    neither the domain's own submission server nor the DMARC evaluator saw.
  - Fix: `parse_from_mailbox` walks the header's parse tree and refuses any encoded-word under an `addr-spec`. If the
    tree is unavailable it refuses rather than guessing. A literal `=?` left in the address is refused too, so the
    result does not depend on whether a given Python decodes.
- **RV-2 (Low): versions other than 1 were accepted.**
  - `mx.host.com 2; dmarc=pass …` and `dmarc/2=pass …` both verified. RFC 8601 defines only version 1, and a result
    under another version has semantics this parser was not written for.
  - Fix: a header version other than `1` makes the header malformed. `AuthResult` now carries the method version.
    `dmarc_verifies` still counts versioned dmarc results for the exactly-one rule, so they cannot hide beside an
    unversioned one, and refuses a dmarc version other than none or `1`. Other methods' versions are ignored, as their
    results are. Leading zeros (`01`) are refused.
- **RV-3 (cosmetic):** `mailbox =os.environ…` in `main()`, introduced by this diff. Fixed.

#### 18.8.2 Reviewed and found sound (by reading the code; the suite exercises each)

- **Comments and quotes.** `_strip_comments` handles nesting, quoted-pairs in comments and quoted strings, `(` inside
  quotes, and quotes inside comments (as ctext, per RFC 5322). It refuses unbalanced input. `_read_value` reads
  quoted strings with the same escape rule, so its quote scan cannot run past the end.
- **Results.** A result is read only at the start of a `;`-separated result. Empty results, bad names, quoted names or
  results, and `none` mixed with results are malformed. Duplicate `header.from` is refused.
- **Folding.** CRLF/LF followed by WSP is unfolded before both parsers run.
- **Binding.** In `main()` the single `parse_from_mailbox` result feeds both `dmarc_verifies` and `post_to_intake`.
  The new test proves the POSTed value is the lower-cased parsed mailbox, not the display name or raw header.
- **Configuration.** `intake_auth_config()` runs straight after `load_env()`, before the URL, secret or
  `imap_connect()`, in live and `--dry-run` modes alike.

#### 18.8.3 Considered and not changed

- **Unicode case-folding.** `str.lower()` maps U+212A KELVIN SIGN to ASCII `k`, so an authserv-id compared after
  `.lower()` could in principle match a non-ASCII spelling. Not reachable: under `message_from_bytes` with the compat32
  policy, non-ASCII header bytes come back as surrogate escapes, never as U+212A. This rests on reading the stdlib
  (`_policybase` / `email.header`), not on a test.
- **Out of scope, pre-existing (not an ISSUE-266 change):** `main()` calls `.strip()` on `msg.get("Subject")`. Under
  compat32 a Subject with raw 8-bit bytes comes back as an `email.header.Header`, which has no `.strip()`. If so, one
  such message would crash every poll. Inferred from the stdlib source, not reproduced. Worth a separate check; not
  recorded as an issue here.

#### 18.8.4 Tests and evidence

- New: 4 version cases and 5 encoded-word/`=?` From cases. New `test_main_forwards_the_verified_mailbox` drives
  `main()` over six raw multipart messages through a fake IMAP connection with `post_to_intake` stubbed. It checks the
  POSTed `senderEmail` values, the Processed/Errors filing, the exit code, and that `--dry-run` posts and files nothing.
- Before the fix: 9 FAIL (both versions, all 5 From cases, both `main()` checks).
- After the fix: `python -I -B tools/email_intake/test_fetch_and_stage.py`, 160 ok / 0 FAIL / exit 0 on CPython
  3.12.10 and 3.14.4 (uv). Outputs: `D:\tmp\issue266\evidence\suite-py3.12.10-review2.out`, `suite-py3.14.4-review2.out`.
- `fetch_and_stage.py` SHA-256 `C8A0966611EA0492A47D6455BBA145BF64B4023EB9B646921AF5574723BE893F` (after RV-3).

#### 18.8.5 Next action

*Item 1 done (§18.9); superseded by §18.9.2.*

1. The operator runs the isolated Linux suite on streamanator (commands in the session report). It runs in a fresh
   temporary directory with an empty environment, no `.env` and no mailbox, and leaves the deployed checkout alone.
2. If it passes, the operator reviews and commits.
3. Complete §18.6 per host, then deploy.
4. Resolve only after a host-side `--dry-run` accepts a legitimate message and refuses a non-passing one.
5. The review worktree `afldb-review-20261008` still shows ISSUE-266 as "Nothing implemented" (its `IssuesIndex.md`
   and `issues.md` row). Reconcile it when the trackers merge; it was not edited.

### 18.9 Linux validation (2026-10-09, operator-run on streamanator)

Run `20261009-074215`, executed by the operator; graded here from the local copies in
`D:\tmp\issue266\linux-validation\run-20261009-074215\evidence\` (`meta.txt`, `suite.out`, `status.txt`).

- **Host:** streamanator, Ubuntu 24.04.5 LTS, `/usr/bin/python3` CPython 3.12.3. Ran in a fresh temporary directory
  (`/tmp/afldb-i266-suite-20261009-074215`) holding only the two files, with an empty environment, no `.env` and no
  mailbox. The deployed checkout was not touched.
- **Bytes:** `fetch_and_stage.py` `c8a09666…723be893f` and `test_fetch_and_stage.py` `d7dfcde9…40cc6c2` matched the
  reviewed hashes on the host. The worktree files still hash to the same values (rechecked 2026-10-09 after the run).
  Tarball `0adf4844…98c24671`.
- **Result:** `suite.out` has 160 `ok` lines, 0 `FAIL` and ends `all checks passed`; `status.txt` `exit_status=0`. The
  operator reports the SSH suite status and the PowerShell exit code were both 0.
- **What this does not show:** any real mail server's header behaviour, a host authserv-id, `--dry-run` against a real
  mailbox, or deployment. None was attempted.

#### 18.9.1 Remaining limitations

§18.5 stands, except that Linux on CPython 3.12.3 is now covered. Python 3.10/3.11 remain unrun.

#### 18.9.2 Next action

1. The operator reviews and commits the eight changed files.
2. Complete §18.6 per host, setting `AFLDB_INTAKE_AUTHSERV_ID` **before** the code reaches that host, then deploy.
3. Resolve only after a host-side `--dry-run` accepts a legitimate message and refuses a non-passing one.
4. Reconcile the review worktree's ISSUE-266 row at tracker merge (§18.8.5 item 5).
