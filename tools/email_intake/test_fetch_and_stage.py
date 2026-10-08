#!/usr/bin/env python3
"""Self-test for fetch_and_stage.py.

    python3 tools/email_intake/test_fetch_and_stage.py

No pytest, for the same reason the poller itself has no dependencies:
this has to be runnable on the server with the python3 that is already
there. Covers the decisions that are load-bearing and easy to get
quietly wrong later -- which senders count as verified, which
attachments count as CSVs, and which failures are worth retrying.

The mailbox and the app are both out of scope here; everything tested
is a pure function over a message or a response.
"""
from __future__ import annotations

import contextlib
import email
import importlib.util
import io
import os
import sys
import tempfile
import urllib.error
import urllib.request
from email.message import EmailMessage, Message
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "fetch_and_stage", Path(__file__).with_name("fetch_and_stage.py"))
poller = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(poller)

failures: list[str] = []


def check(name: str, got: object, want: object) -> None:
    if got != want:
        failures.append(name)
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")


def message_with(*auth_headers: str, from_: str | list[str] = "admin@example.com") -> Message:
    """A message parsed from raw bytes exactly as the poller parses one.

    Headers are written verbatim, so folding, duplicates and malformed
    values reach the code under test unchanged.
    """
    lines = [f"From: {value}" for value in ([from_] if isinstance(from_, str) else from_)]
    lines += [f"Authentication-Results: {header}" for header in auth_headers]
    raw = "\r\n".join(lines + ["Subject: match_results", "", "body", ""])
    return email.message_from_bytes(raw.encode("utf-8"))


def message_attaching(filename: str, maintype: str, subtype: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = "admin@example.com"
    msg.set_content("see attached")
    msg.add_attachment(b"a,b\n1,2\n", maintype=maintype, subtype=subtype, filename=filename)
    return msg


PASS = "mx.host.com; dmarc=pass header.from=example.com"


def test_sender_is_authenticated() -> None:
    print("sender_is_authenticated (authserv-id mx.host.com, From admin@example.com)")
    ok = lambda *headers, **kw: poller.sender_is_authenticated(  # noqa: E731
        message_with(*headers, **kw), "mx.host.com")[0]

    check("no header means unverified", ok(), False)
    check("dmarc=pass for the From domain", ok(PASS), True)
    check("dmarc=fail", ok("mx.host.com; dmarc=fail header.from=example.com"), False)
    for result in ("none", "temperror", "permerror", "bestguesspass"):
        check(f"dmarc={result} is not a pass", ok(f"mx.host.com; dmarc={result} header.from=example.com"), False)

    # D-266-1: no SPF/DKIM fallback, aligned or not. These attest the
    # envelope sender and the signing domain, both the sender's choice
    # (AFLDB-ISSUE-266, review witness W1).
    check("unaligned spf+dkim pass with dmarc=fail (W1)",
          ok("mx.host.com; dmarc=fail header.from=example.com; spf=pass smtp.mailfrom=attacker.example; "
             "dkim=pass header.d=attacker.example"), False)
    check("unaligned spf+dkim pass with no dmarc (W1)",
          ok("mx.host.com; spf=pass smtp.mailfrom=attacker.example; dkim=pass header.d=attacker.example"), False)
    check("even ALIGNED spf+dkim pass without dmarc is refused",
          ok("mx.host.com; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com"), False)
    check("spf=pass alone", ok("mx.host.com; spf=pass smtp.mailfrom=example.com"), False)

    # "dmarc=pass" as TEXT inside the trusted header must never count:
    # the sender chooses their envelope address, and servers copy it, and
    # comments about it, into their own header (witness W2, R2).
    check("dmarc=pass inside smtp.mailfrom (W2 R2a)",
          ok("mx.host.com; dmarc=fail header.from=example.com; "
             "spf=softfail smtp.mailfrom=dmarc=pass@attacker.example; dkim=none"), False)
    check("dmarc=pass inside a quoted smtp.mailfrom (W2 R2b)",
          ok('mx.host.com; dmarc=fail header.from=example.com; '
             'spf=softfail smtp.mailfrom="dmarc=pass@attacker.example"; dkim=none'), False)
    check("dkim=pass inside smtp.mailfrom (W2 R2c)",
          ok("mx.host.com; dmarc=fail header.from=example.com; "
             "spf=pass smtp.mailfrom=dkim=pass@attacker.example; dkim=none"), False)
    check("dmarc=pass inside a comment (W2 R2d)",
          ok("mx.host.com; dmarc=fail header.from=example.com; spf=softfail "
             "(domain of dmarc=pass@attacker.example does not designate 192.0.2.1) smtp.mailfrom=attacker.example"),
          False)
    check("a whole result smuggled in a quoted local part",
          ok('mx.host.com; dmarc=fail header.from=example.com; '
             'spf=softfail smtp.mailfrom="x;dmarc=pass header.from=example.com"@attacker.example'), False)
    check("a whole result smuggled in a comment",
          ok("mx.host.com; dmarc=fail header.from=example.com; "
             "spf=none (; dmarc=pass header.from=example.com) smtp.mailfrom=attacker.example"), False)
    check("an unquoted ';' copied in by a careless server conflicts with the real result",
          ok("mx.host.com; dmarc=fail header.from=example.com; "
             "spf=softfail smtp.mailfrom=x;dmarc=pass header.from=example.com"), False)
    check("dmarc=pass as a property value", ok("mx.host.com; dmarc=fail header.from=example.com x=dmarc=pass"),
          False)

    # The pass must be for the domain of the address being forwarded (W2 R3).
    check("dmarc=pass for another domain (W2 R3)", ok("mx.host.com; dmarc=pass header.from=attacker.example"), False)
    check("dmarc=pass for a subdomain", ok("mx.host.com; dmarc=pass header.from=mail.example.com"), False)
    check("dmarc=pass for the parent domain",
          ok("mx.host.com; dmarc=pass header.from=example.com", from_="admin@mail.example.com"), False)
    check("dmarc=pass without header.from", ok("mx.host.com; dmarc=pass"), False)
    check("dmarc=pass with two header.from",
          ok("mx.host.com; dmarc=pass header.from=example.com header.from=attacker.example"), False)
    check("header.from holding an address, not a domain",
          ok("mx.host.com; dmarc=pass header.from=admin@example.com"), False)
    check('header.from quoting a local part', ok('mx.host.com; dmarc=pass header.from="x"@example.com'), False)
    check("display name naming the admin, real address elsewhere",
          ok(PASS, from_='"admin@example.com" <attacker@attacker.example>'), False)

    # Ambiguous or conflicting results are refused, never resolved.
    check("pass and fail together",
          ok("mx.host.com; dmarc=pass header.from=example.com; dmarc=fail header.from=example.com"), False)
    check("two passes together",
          ok("mx.host.com; dmarc=pass header.from=example.com; dmarc=pass header.from=example.com"), False)
    check("'none' (no results)", ok("mx.host.com; none"), False)
    check("'none' mixed with a pass", ok("mx.host.com; none; dmarc=pass header.from=example.com"), False)

    # Only version 1 is defined (RFC 8601). A result written under any
    # other version means something this parser was not written for.
    check("unsupported header version", ok("mx.host.com 2; dmarc=pass header.from=example.com"), False)
    check("unsupported dmarc version", ok("mx.host.com; dmarc/2=pass header.from=example.com"), False)
    check("a versioned dmarc result still conflicts with an unversioned one",
          ok("mx.host.com; dmarc=pass header.from=example.com; dmarc/2=fail header.from=example.com"), False)
    check("another method's unsupported version is ignored",
          ok("mx.host.com; spf/2=pass smtp.mailfrom=example.com; dmarc=pass header.from=example.com"), True)

    # Malformed headers are refused as a whole, not half-read.
    for name, header in (
        ("empty header", ""),
        ("authserv-id only", "mx.host.com"),
        ("no authserv-id", "; dmarc=pass header.from=example.com"),
        ("unterminated comment", "mx.host.com; dmarc=pass (oops header.from=example.com"),
        ("stray ')'", "mx.host.com; dmarc=pass) header.from=example.com"),
        ("unterminated quote", 'mx.host.com; dmarc=pass header.from="example.com'),
        ("method without result", "mx.host.com; dmarc pass header.from=example.com"),
        ("result with trailing junk", "mx.host.com; dmarc=pass@x header.from=example.com"),
        ("quoted result", 'mx.host.com; dmarc="pass" header.from=example.com'),
        ("empty result", "mx.host.com;; dmarc=pass header.from=example.com"),
        ("property without value", "mx.host.com; dmarc=pass header.from="),
        ("property without '='", "mx.host.com; dmarc=pass header.from example.com"),
        ("non-numeric version", "mx.host.com v1; dmarc=pass header.from=example.com"),
        ("text after the version", "mx.host.com 1 2; dmarc=pass header.from=example.com"),
        ("bad method version", "mx.host.com; dmarc/x=pass header.from=example.com"),
        # Microsoft 365 writes no authserv-id at all: unsupported under D-266-2.
        ("no authserv-id (Microsoft 365 shape)",
         "spf=pass (sender IP is 192.0.2.1) smtp.mailfrom=example.com; dkim=pass (signature was verified) "
         "header.d=example.com;dmarc=pass action=none header.from=example.com;compauth=pass reason=100"),
    ):
        check(f"malformed: {name}", ok(header), False)

    # The attack the topmost-header rule exists for. Anyone can put a
    # passing Authentication-Results header in the mail they send; the
    # receiving server PREPENDS its own, so the forged one ends up second.
    # Lower headers are never consulted, even when the top one is unusable.
    check("a forged pass below the server's fail is ignored",
          ok("mx.host.com; dmarc=fail header.from=example.com", PASS), False)
    check("a malformed top header is not skipped over",
          ok("mx.host.com; dmarc=pass (broken", PASS), False)
    check("another server's top header is not skipped over",
          ok("other.example; dmarc=none header.from=example.com", PASS), False)

    # D-266-2: the authserv-id is matched exactly -- no prefix or suffix.
    check("another server's header is refused", ok("evil.example; dmarc=pass header.from=example.com"), False)
    check("authserv-id as a prefix", ok("mx.host.com.evil.example; dmarc=pass header.from=example.com"), False)
    check("authserv-id as a suffix", ok("evil.mx.host.com; dmarc=pass header.from=example.com"), False)
    check("authserv-id truncated", ok("mx.host; dmarc=pass header.from=example.com"), False)

    # Formats real servers write, which must keep working.
    check("authserv-id with a version token", ok("mx.host.com 1; dmarc=pass header.from=example.com"), True)
    check("comments, other methods and dotless properties around the pass",
          ok("mx.host.com; dkim=pass (2048-bit rsa key sha256) header.d=example.com header.i=@example.com "
             "header.b=AbC/1+x= header.s=sel x-bits=2048; spf=pass (domain of admin@example.com designates "
             "192.0.2.1 as permitted sender) smtp.mailfrom=admin@example.com; dmarc=pass (p=none,d=none) "
             "policy.published-domain-policy=none header.from=example.com; iprev=pass "
             "policy.iprev=192.0.2.1; arc=none"), True)
    check("folded across lines",
          ok("mx.host.com;\r\n\tdkim=pass header.d=example.com;\r\n\tdmarc=pass (p=REJECT sp=REJECT dis=NONE)"
             "\r\n header.from=example.com"), True)
    check("upper case throughout",
          ok("MX.HOST.COM; DMARC=PASS header.from=EXAMPLE.COM", from_="Admin <ADMIN@Example.COM>"), True)
    check("quoted header.from", ok('mx.host.com; dmarc=pass header.from="example.com"'), True)
    check("trailing dot on header.from", ok("mx.host.com; dmarc=pass header.from=example.com."), True)
    check("trailing ';'", ok("mx.host.com; dmarc=pass header.from=example.com;"), True)
    check("method version", ok("mx.host.com; dmarc/1=pass header.from=example.com"), True)
    check("spaces around '='", ok("mx.host.com; dmarc = pass header.from = example.com"), True)
    check("reason property", ok('mx.host.com; dmarc=pass reason="aligned" header.from=example.com'), True)
    check("a real comment containing ';'", ok("mx.host.com (MTA; v1); dmarc=pass header.from=example.com"), True)
    check("a forged header below a genuine pass changes nothing",
          ok(PASS, "mx.host.com; dmarc=fail header.from=example.com"), True)

    # From must be exactly one plain mailbox; see test_parse_from_mailbox.
    check("two From headers", ok(PASS, from_=["admin@example.com", "admin@example.com"]), False)

    # Without an explicit authserv-id, the configured one is used, and
    # with none configured nothing can be trusted.
    saved = {k: os.environ.get(k) for k in ("AFLDB_INTAKE_AUTHSERV_ID", "AFLDB_INTAKE_REQUIRE_AUTH")}
    try:
        for key in saved:
            os.environ.pop(key, None)
        check("no authserv-id configured", poller.sender_is_authenticated(message_with(PASS))[0], False)
        os.environ["AFLDB_INTAKE_AUTHSERV_ID"] = "MX.Host.com"
        check("the configured authserv-id is used, case-insensitively",
              poller.sender_is_authenticated(message_with(PASS))[0], True)
    finally:
        restore_env(saved)


def restore_env(saved: dict[str, str | None]) -> None:
    for key, value in saved.items():
        os.environ.pop(key, None)
        if value is not None:
            os.environ[key] = value


def test_parse_from_mailbox() -> None:
    print("parse_from_mailbox")
    mailbox = lambda from_: poller.parse_from_mailbox(message_with(from_=from_))[0]  # noqa: E731

    check("bare address", mailbox("admin@example.com"), "admin@example.com")
    check("display name", mailbox("Admin Person <admin@example.com>"), "admin@example.com")
    check("lower-cased", mailbox("Admin <Admin@EXAMPLE.com>"), "admin@example.com")
    check("encoded-word display name", mailbox("=?utf-8?q?=C3=84dmin?= <admin@example.com>"), "admin@example.com")
    check("trailing comment", mailbox("admin@example.com (Admin)"), "admin@example.com")
    check("folded", mailbox("Admin\r\n <admin@example.com>"), "admin@example.com")
    check("plus and dot in the local part", mailbox("first.last+afl@example.com"), "first.last+afl@example.com")
    # A display name that looks like an address is only a display name.
    check("the angle address wins over the display name",
          mailbox('"admin@example.com" <attacker@attacker.example>'), "attacker@attacker.example")

    check("no From header", poller.parse_from_mailbox(message_with(from_=[]))[0], None)
    check("two From headers", mailbox(["admin@example.com", "attacker@attacker.example"]), None)
    check("two identical From headers", mailbox(["admin@example.com", "admin@example.com"]), None)
    check("two mailboxes", mailbox("admin@example.com, attacker@attacker.example"), None)
    check("a group", mailbox("staff: admin@example.com;"), None)
    check("an empty group", mailbox("undisclosed-recipients:;"), None)
    check("empty", mailbox(""), None)
    check("not an address", mailbox("admin"), None)
    # CVE-2023-27043-style shapes, where parsers disagree about the address.
    check("address then stray ')'", mailbox("alice@example.org)<bob@example.org>"), None)
    check("two addresses without a comma", mailbox("admin@example.com <attacker@attacker.example>"), None)
    check("two angle addresses", mailbox("<admin@example.com> <attacker@attacker.example>"), None)
    # Needless quotes are the same mailbox (RFC 5322 3.4.1), so the parser's
    # normal form is used; a local part that still needs quoting is refused.
    check("needlessly quoted local part is the same mailbox", mailbox('"admin"@example.com'), "admin@example.com")
    check("local part that needs quoting", mailbox('"ad min"@example.com'), None)
    check("an address quoted inside the local part", mailbox('"admin@example.com"@attacker.example'), None)
    check("domain literal", mailbox("admin@[192.0.2.1]"), None)
    check("single-label domain", mailbox("admin@localhost"), None)
    check("non-ASCII domain", mailbox("admin@exämple.com"), None)
    # RFC 2047 forbids encoded-words in an addr-spec, yet the stdlib decodes
    # them there: these would otherwise come out as admin@example.com, an
    # address the header never spelled.
    check("encoded-word local part", mailbox("=?utf-8?q?admin?= @example.com"), None)
    check("encoded-word local part in an angle address", mailbox("Admin <=?utf-8?q?admin?= @example.com>"), None)
    check("encoded-word domain", mailbox("admin@=?utf-8?q?example.com?="), None)
    check("encoded-word domain in an angle address", mailbox("<admin@=?utf-8?q?example.com?= >"), None)
    check("an undecodable '=?' in the local part", mailbox("=?admin@example.com"), None)


def test_intake_auth_config() -> None:
    print("intake_auth_config")
    keys = ("AFLDB_INTAKE_AUTHSERV_ID", "AFLDB_INTAKE_REQUIRE_AUTH")
    saved = {k: os.environ.get(k) for k in keys}

    def config(**env: str):
        for key in keys:
            os.environ.pop(key, None)
        os.environ.update(env)
        try:
            return poller.intake_auth_config()
        except poller.ConfigError:
            return "ConfigError"

    try:
        check("required by default", config(), "ConfigError")
        check("required when auth is explicitly on", config(AFLDB_INTAKE_REQUIRE_AUTH="true"), "ConfigError")
        check("blank counts as missing", config(AFLDB_INTAKE_AUTHSERV_ID="   "), "ConfigError")
        check("set", config(AFLDB_INTAKE_AUTHSERV_ID="Mx.Host.com"), (True, "mx.host.com"))
        check("optional when auth is off", config(AFLDB_INTAKE_REQUIRE_AUTH="false"), (False, None))
        for bad in ("mx host.com", "mx.host.com;", '"mx.host.com"', "mx.host.com.", "-mx.host.com", "mx.host.com 1",
                    "CHANGE ME"):
            check(f"invalid authserv-id {bad!r}", config(AFLDB_INTAKE_AUTHSERV_ID=bad), "ConfigError")
        check("invalid even when auth is off",
              config(AFLDB_INTAKE_REQUIRE_AUTH="false", AFLDB_INTAKE_AUTHSERV_ID="mx host"), "ConfigError")
        # A typo used to read as "false" and switch authentication off.
        check("unrecognised REQUIRE_AUTH", config(AFLDB_INTAKE_REQUIRE_AUTH="ture",
                                                  AFLDB_INTAKE_AUTHSERV_ID="mx.host.com"), "ConfigError")
    finally:
        restore_env(saved)


def test_config_failure_leaves_mailbox_untouched() -> None:
    print("main() on a configuration failure")

    class ReachedMailbox(Exception):
        pass

    connects: list[int] = []

    def fake_imap_connect():
        connects.append(1)
        raise ReachedMailbox

    keys = ("AFLDB_INTAKE_AUTHSERV_ID", "AFLDB_INTAKE_REQUIRE_AUTH", "AFLDB_EMAIL_INTAKE_SECRET")
    saved_env = {k: os.environ.get(k) for k in keys}
    saved = (poller.load_env, poller.imap_connect, sys.argv)
    # load_env is stubbed so a real .env on the server cannot fill in
    # the very settings these cases leave out.
    poller.load_env = lambda *args, **kwargs: None
    poller.imap_connect = fake_imap_connect

    def run(argv: list[str], **env: str):
        for key in keys:
            os.environ.pop(key, None)
        os.environ.update(env)
        connects.clear()
        sys.argv = ["fetch_and_stage.py", *argv]
        err = io.StringIO()
        try:
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                code = poller.main()
        except ReachedMailbox:
            code = "reached mailbox"
        return code, len(connects), err.getvalue()

    try:
        for argv in ([], ["--dry-run"]):
            mode = " ".join(argv) or "live"
            code, n, err = run(argv, AFLDB_EMAIL_INTAKE_SECRET="s")
            check(f"{mode}: missing authserv-id exits 78", code, poller.EXIT_CONFIG)
            check(f"{mode}: missing authserv-id never connects", n, 0)
            check(f"{mode}: the error names the setting", "AFLDB_INTAKE_AUTHSERV_ID" in err, True)
            code, n, _ = run(argv, AFLDB_EMAIL_INTAKE_SECRET="s", AFLDB_INTAKE_AUTHSERV_ID="mx host")
            check(f"{mode}: invalid authserv-id exits 78 without connecting", (code, n), (poller.EXIT_CONFIG, 0))
            code, n, _ = run(argv, AFLDB_EMAIL_INTAKE_SECRET="s", AFLDB_INTAKE_AUTHSERV_ID="mx.host.com",
                             AFLDB_INTAKE_REQUIRE_AUTH="ture")
            check(f"{mode}: invalid REQUIRE_AUTH exits 78 without connecting", (code, n), (poller.EXIT_CONFIG, 0))
            # The control: with a valid configuration the same harness does
            # see the connection, so the zeros above are not vacuous.
            code, n, _ = run(argv, AFLDB_EMAIL_INTAKE_SECRET="s", AFLDB_INTAKE_AUTHSERV_ID="mx.host.com")
            check(f"{mode}: valid configuration reaches the mailbox", (code, n), ("reached mailbox", 1))
    finally:
        poller.load_env, poller.imap_connect, sys.argv = saved
        restore_env(saved_env)


def raw_submission(from_: str, auth: str) -> bytes:
    """A complete raw message with a CSV attachment, as an IMAP FETCH returns it."""
    return (
        f"From: {from_}\r\nAuthentication-Results: {auth}\r\nSubject: match_results\r\n"
        "MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n"
        "--b\r\nContent-Type: text/plain\r\n\r\nsee attached\r\n"
        "--b\r\nContent-Type: text/csv\r\nContent-Disposition: attachment; filename=data.csv\r\n\r\n"
        "a,b\r\n1,2\r\n--b--\r\n"
    ).encode("ascii")


def test_main_forwards_the_verified_mailbox() -> None:
    print("main() forwards exactly the mailbox DMARC verified")

    class FakeImap:
        """Just enough IMAP for main(): every message unseen, every call OK."""

        def __init__(self, raws: list[bytes]):
            self.raws = raws
            self.filed: list[tuple[int, str]] = []

        def select(self, name, readonly=False):
            return "OK", [b"1"]

        def search(self, charset, criterion):
            return "OK", [b" ".join(str(n).encode() for n in range(1, len(self.raws) + 1))]

        def fetch(self, msg_id, parts):
            return "OK", [(b"1 (BODY[] {n})", self.raws[int(msg_id) - 1])]

        def copy(self, msg_id, folder):
            self.filed.append((int(msg_id), folder))
            return "OK", []

        def store(self, msg_id, command, flags):
            return "OK", []

        def close(self):
            pass

        def logout(self):
            pass

    messages = [
        # 1: forwarded, as the parsed mailbox -- not the display name or the raw header text.
        raw_submission("Admin Person <Admin@Example.COM>", PASS),
        # 2: the display name names the admin; the address DMARC would have to vouch for is elsewhere.
        raw_submission('"admin@example.com" <attacker@attacker.example>', PASS),
        # 3: a genuine pass for the attacker's own domain forwards the attacker's own address, never an admin's.
        raw_submission("attacker@attacker.example", "mx.host.com; dmarc=pass header.from=attacker.example"),
        # 4: refused before the POST.
        raw_submission("admin@example.com", "mx.host.com; dmarc=fail header.from=example.com"),
        # 5: an encoded-word the stdlib would decode to admin@example.com.
        raw_submission("=?utf-8?q?admin?= @example.com", PASS),
        # 6: two From headers.
        raw_submission("admin@example.com\r\nFrom: attacker@attacker.example", PASS),
    ]
    posted: list[str] = []

    def fake_post(base_url, secret, sender_email, dataset, filename, content, timeout):
        posted.append(sender_email)
        return {"submissionId": len(posted), "rowCount": 1, "report": "ok"}

    keys = ("AFLDB_INTAKE_AUTHSERV_ID", "AFLDB_INTAKE_REQUIRE_AUTH", "AFLDB_EMAIL_INTAKE_SECRET")
    saved_env = {k: os.environ.get(k) for k in keys}
    saved = (poller.load_env, poller.imap_connect, poller.post_to_intake, sys.argv)
    poller.load_env = lambda *args, **kwargs: None
    poller.post_to_intake = fake_post
    try:
        for key in keys:
            os.environ.pop(key, None)
        os.environ.update(AFLDB_INTAKE_AUTHSERV_ID="mx.host.com", AFLDB_EMAIL_INTAKE_SECRET="s")
        for argv in ([], ["--dry-run"]):
            mode = " ".join(argv) or "live"
            conn = FakeImap(messages)
            poller.imap_connect = lambda: conn
            posted.clear()
            sys.argv = ["fetch_and_stage.py", *argv]
            with contextlib.redirect_stdout(io.StringIO()):
                code = poller.main()
            check(f"{mode}: exit code reports the rejections", code, poller.EXIT_REJECTED)
            if argv:
                check(f"{mode}: nothing posted", posted, [])
                check(f"{mode}: nothing filed", conn.filed, [])
            else:
                check(f"{mode}: senderEmail is the verified, parsed mailbox", posted,
                      ["admin@example.com", "attacker@attacker.example"])
                check(f"{mode}: forwarded to Processed, refused to Errors", conn.filed,
                      [(1, "Processed"), (2, "Errors"), (3, "Processed"), (4, "Errors"), (5, "Errors"),
                       (6, "Errors")])
    finally:
        poller.load_env, poller.imap_connect, poller.post_to_intake, sys.argv = saved
        restore_env(saved_env)


def test_find_csv_attachment() -> None:
    print("find_csv_attachment")
    name = lambda msg: (poller.find_csv_attachment(msg) or (None,))[0]  # noqa: E731

    # Content type alone used to be enough, which swept in every
    # signature image (mail clients label attachments octet-stream as a
    # matter of routine) and every .xls workbook.
    check("an image labelled octet-stream is not a CSV",
          name(message_attaching("logo.png", "application", "octet-stream")), None)
    check("an .xls workbook is not a CSV",
          name(message_attaching("season.xls", "application", "vnd.ms-excel")), None)
    check("a .csv labelled octet-stream is a CSV",
          name(message_attaching("data.csv", "application", "octet-stream")), "data.csv")
    check("the extension is matched case-insensitively",
          name(message_attaching("data.CSV", "text", "plain")), "data.CSV")
    check("text/csv is a CSV",
          name(message_attaching("data.csv", "text", "csv")), "data.csv")
    check("a message with no attachment", name(EmailMessage()), None)


def test_load_env() -> None:
    print("load_env")
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / ".env"
        path.write_text(
            "AFLDB_T_PLAIN=abc123\n"
            "AFLDB_T_SINGLE='abc123'\n"
            'AFLDB_T_DOUBLE="abc123"\n'
            'AFLDB_T_INNER=ab"c\n'
            "# a comment\n"
            "\n"
        )
        poller.load_env(path)

    check("unquoted", os.environ.get("AFLDB_T_PLAIN"), "abc123")
    # systemd's EnvironmentFile= and Next.js both strip these, so a
    # quoted secret worked under the service and failed here -- as a 401
    # on every message, which looks like the wrong secret entirely.
    check("single quotes stripped", os.environ.get("AFLDB_T_SINGLE"), "abc123")
    check("double quotes stripped", os.environ.get("AFLDB_T_DOUBLE"), "abc123")
    check("a quote inside the value is left alone", os.environ.get("AFLDB_T_INNER"), 'ab"c')


def test_intake_base_url() -> None:
    print("intake_base_url")
    saved = {k: os.environ.get(k) for k in ("AFLDB_INTAKE_URL", "PORT", "AFLDB_BASE_URL")}
    for key in saved:
        os.environ.pop(key, None)
    try:
        check("loopback by default", poller.intake_base_url(), "http://127.0.0.1:3100")
        os.environ["PORT"] = "4000"
        check("follows PORT", poller.intake_base_url(), "http://127.0.0.1:4000")
        # The point of the whole function: the public address must not
        # become the address the shared secret is sent to.
        os.environ["AFLDB_BASE_URL"] = "http://10.0.40.100:3100"
        check("AFLDB_BASE_URL is ignored", poller.intake_base_url(), "http://127.0.0.1:4000")
        os.environ["AFLDB_INTAKE_URL"] = "https://other.host"
        check("an explicit override wins", poller.intake_base_url(), "https://other.host")
    finally:
        for key, value in saved.items():
            os.environ.pop(key, None)
            if value is not None:
                os.environ[key] = value


def test_failure_classification() -> None:
    print("post_to_intake failure classification")

    def responder(code: int | None = None, body: bytes = b"{}", raises: Exception | None = None):
        def _open(request, timeout=None):
            if raises is not None:
                raise raises
            if code is not None:
                raise urllib.error.HTTPError(
                    "http://x/api", code, "err", {}, io.BytesIO(b'{"error":"nope"}'))

            class Response:
                def read(self):
                    return body

                def __enter__(self):
                    return self

                def __exit__(self, *exc):
                    return False

            return Response()
        return _open

    def classify(**kwargs) -> str:
        original = urllib.request.urlopen
        urllib.request.urlopen = responder(**kwargs)
        try:
            poller.post_to_intake("http://x", "s", "a@b.c", "match_results", "f.csv", b"x", 5)
            return "ok"
        except poller.PermanentFailure:
            return "permanent"
        except poller.TransientFailure:
            return "transient"
        finally:
            urllib.request.urlopen = original

    # Permanent: the message is filed under Errors and never retried, so
    # anything classified here must genuinely be unable to succeed later.
    check("400 the file was bad", classify(code=400), "permanent")
    check("401 the secret is wrong", classify(code=401), "permanent")
    check("403 the sender is not an account", classify(code=403), "permanent")

    # Transient: the message stays unread and the next poll tries again.
    # Misclassifying any of these as permanent silently drops real data.
    check("408 request timeout", classify(code=408), "transient")
    check("429 rate limited", classify(code=429), "transient")
    check("500 server error", classify(code=500), "transient")
    check("503 restarting", classify(code=503), "transient")
    check("connection refused", classify(raises=urllib.error.URLError("refused")), "transient")
    check("read timed out", classify(raises=TimeoutError("timed out")), "transient")
    # The POST landed; only the reply is unreadable, so the file may well
    # be staged. The route's SHA-256 dedup makes asking again harmless.
    check("an unreadable reply", classify(body=b"<html>502 Bad Gateway</html>"), "transient")

    check("a good reply", classify(body=b'{"ok":true}'), "ok")


def main() -> int:
    for test in (
        test_sender_is_authenticated,
        test_parse_from_mailbox,
        test_intake_auth_config,
        test_config_failure_leaves_mailbox_untouched,
        test_main_forwards_the_verified_mailbox,
        test_find_csv_attachment,
        test_load_env,
        test_intake_base_url,
        test_failure_classification,
    ):
        test()

    print()
    if failures:
        print(f"{len(failures)} failure(s): {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
