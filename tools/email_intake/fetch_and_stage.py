#!/usr/bin/env python3
"""Poll a mailbox for admin-submitted CSVs and stage+validate each one.

    python3 tools/email_intake/fetch_and_stage.py [--dry-run]

An admin emails a CSV to the configured mailbox with the dataset key
(e.g. "match_results") as the subject. This script finds each unseen
message with a CSV attachment, forwards it to the app's
/api/admin/email-intake route -- authenticated by a shared secret, not
a session -- which re-resolves the From address against auth_users
itself (never trusts what this script claims) and runs it through the
EXACT SAME stageSubmission -> validateSubmission pipeline the web
upload form uses. Approval and promotion still require a human at
/admin/submissions/<id>: this script gets a file as far as "staged and
validated," never further. See docs/admin-and-beta.md.

A From address is a claim, not a credential: anyone can write one.
Before forwarding anything this script requires that the RECEIVING mail
server verified it. The message must have exactly one From header holding
exactly one mailbox, and the topmost Authentication-Results header must
carry the configured authserv-id (AFLDB_INTAKE_AUTHSERV_ID) and exactly
one dmarc=pass result whose header.from is that mailbox's domain. Without
that check the intake would treat "knows an admin's email address" as
authorisation to submit data as them. SPF and DKIM passes alone are not
accepted: they vouch for the envelope sender and the signing domain, and
the sender chooses both.

DMARC authenticates the DOMAIN, not the person. A pass says the domain's
own mail system sent the message; whether it lets one user send as
another user's address is up to that domain. This is not proof of the
individual sender.

Set AFLDB_INTAKE_REQUIRE_AUTH=false only on a mailbox where something
upstream already guarantees this. A missing or invalid authentication
setting stops the run (exit 78) before the mailbox is opened.

No third-party packages: imaplib, email and urllib are standard
library, so this runs under plain python3 -- no virtualenv needed,
unlike the psycopg-based migration tools in tools/migration.

Never deletes mail. A message that has been dealt with -- staged, or
rejected for a reason that will not change -- is copied to a
Processed/Errors folder and marked \\Seen so it will not be picked up
again; the original stays in the mailbox as a record. A message whose
outcome is UNKNOWN (the app was restarting, the request timed out) is
left unread on purpose, so the next poll tries it again. Retrying is
safe because the intake route deduplicates on the file's SHA-256: the
same bytes resolve to the submission they already made rather than a
second copy of it.

Run on an interval via a systemd timer (see
deploy/afldb-email-intake.timer and docs/admin-and-beta.md's
"Email-in CSV intake" section for the one-time server setup).

Exit codes: 0 all clear, 1 something was rejected and needs a human,
75 (EX_TEMPFAIL) nothing was rejected but something is being retried,
78 (EX_CONFIG) the configuration is unusable and the mailbox was not touched.
"""
from __future__ import annotations

import argparse
import base64
import email
import imaplib
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from email.headerregistry import HeaderRegistry
from email.message import Message
from pathlib import Path
from typing import NamedTuple

EXIT_OK = 0
EXIT_REJECTED = 1
EXIT_TEMPFAIL = 75  # sysexits.h EX_TEMPFAIL: try again later, nothing is wrong here
EXIT_CONFIG = 78  # sysexits.h EX_CONFIG: fix the configuration; the mailbox was not opened

# ---------------------------------------------------------------------------
# Environment: the same tolerant .env loader every other tool in this repo
# uses (tools/migration/common.py, tools/admin/create-admin.ts), reimplemented
# here rather than imported so this script has zero dependencies -- pulling
# in common.py would pull in psycopg, which this script never needs.
# ---------------------------------------------------------------------------


def load_env(env_path: Path | None = None) -> None:
    path = env_path or Path(__file__).resolve().parents[2] / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        # Strip one layer of matching quotes, as both Next.js's .env reader
        # and systemd's EnvironmentFile= do. Without this a quoted secret
        # works under systemd and fails here, and the failure looks like a
        # wrong secret (401 on every message) rather than a quoting mistake.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ERROR: required environment variable {name} is not set.")
    return value


def env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        sys.exit(f"ERROR: {name} must be a whole number, not {raw!r}.")


class ConfigError(RuntimeError):
    """The configuration cannot be used; nothing may touch the mailbox."""


def env_flag(name: str, default: bool) -> bool:
    # Strict both ways: a typo such as "ture" used to read as false, which
    # silently switched sender authentication off.
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    raise ConfigError(f"{name} must be true or false, not {raw!r}.")


# A plain host-name-like token: what mail servers use as their authserv-id.
# Anything else (spaces, quotes, ';', a trailing dot) is a mistake in .env,
# and accepting it would only make every message fail to match.
_AUTHSERV_ID_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\Z")


def intake_auth_config() -> tuple[bool, str | None]:
    """(require_auth, authserv_id), validated before the mailbox is opened.

    The authserv-id is what makes the topmost Authentication-Results
    header trustworthy: it must name the receiving server, so without it
    a message carrying a header of its own would be judged by that.
    It is therefore required whenever authentication is.
    """
    require_auth = env_flag("AFLDB_INTAKE_REQUIRE_AUTH", True)
    authserv_id = (os.environ.get("AFLDB_INTAKE_AUTHSERV_ID") or "").strip()
    if authserv_id and not _AUTHSERV_ID_RE.match(authserv_id):
        raise ConfigError(
            f"AFLDB_INTAKE_AUTHSERV_ID={authserv_id!r} is not a valid authserv-id: expected the "
            "receiving mail server's name, e.g. mx.example.com, exactly as it appears at the "
            "start of its Authentication-Results headers.")
    if require_auth and not authserv_id:
        raise ConfigError(
            "AFLDB_INTAKE_AUTHSERV_ID is required while AFLDB_INTAKE_REQUIRE_AUTH is on: set it "
            "to the receiving mail server's authserv-id (the name at the start of the "
            "Authentication-Results headers it adds).")
    return require_auth, authserv_id.lower() or None


def intake_base_url() -> str:
    """Where to POST, defaulting to loopback -- deliberately not AFLDB_BASE_URL.

    AFLDB_BASE_URL is the site's PUBLIC address: it is what every page
    hands search engines as its canonical URL, so it is a LAN or public
    hostname, and on a real deployment reaching it means going out to the
    network and back in through the reverse proxy. That would put the
    shared secret on the wire (in clear, if the proxy hop is plain HTTP)
    to reach an app listening on this very machine. The poller and the
    app are the same host by construction -- the systemd unit is ordered
    After=afldb.service -- so loopback is both the correct address and
    the one that keeps the secret off the network entirely.

    AFLDB_INTAKE_URL overrides it for the case where they are genuinely
    separate hosts; use https there.
    """
    explicit = (os.environ.get("AFLDB_INTAKE_URL") or "").strip()
    if explicit:
        return explicit
    return f"http://127.0.0.1:{env_int('PORT', 3100)}"


# Kept in sync BY HAND with DATASETS in src/lib/ingest/datasets.ts. Only
# used to give a clear, immediate reason for skipping an unrecognised
# subject without a wasted HTTP round trip -- the intake route re-checks
# the dataset key itself regardless, so a mismatch here is never unsafe,
# only a message that sits unread until the subject is fixed and resent.
KNOWN_DATASETS = {"rising_star", "all_australian", "match_results", "player_match_stats"}


class PermanentFailure(RuntimeError):
    """This message will never succeed: a bad file, an unknown sender."""


class TransientFailure(RuntimeError):
    """This attempt failed for a reason that may not apply next time."""


def imap_connect() -> imaplib.IMAP4_SSL:
    host = require_env("AFLDB_INTAKE_IMAP_HOST")
    port = env_int("AFLDB_INTAKE_IMAP_PORT", 993)
    user = require_env("AFLDB_INTAKE_IMAP_USER")
    password = require_env("AFLDB_INTAKE_IMAP_PASSWORD")
    mailbox = os.environ.get("AFLDB_INTAKE_IMAP_MAILBOX", "INBOX")

    # An explicit default context, not imaplib's own default: verification of
    # the server certificate and hostname only became the stdlib default in
    # Python 3.13 (gh-91826). Under 3.12 and earlier, IMAP4_SSL(host, port)
    # accepts ANY certificate, so anything on the path between this poller and
    # the mail server could read the mailbox password below and feed the
    # intake route attachments of its own. create_default_context() verifies
    # on every version, so the behaviour no longer depends on which python3
    # the server happens to have.
    conn = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context())
    try:
        conn.login(user, password)
    except imaplib.IMAP4.error as exc:
        sys.exit(f"ERROR: IMAP login for {user} failed: {exc}")
    status, _ = conn.select(mailbox)
    if status != "OK":
        sys.exit(f"ERROR: could not select IMAP mailbox {mailbox!r}.")
    return conn


def imap_ok(status: str, what: str) -> bool:
    """imaplib reports a refusal as ('NO', ...) rather than raising."""
    if status == "OK":
        return True
    print(f"    WARNING: {what} returned {status}")
    return False


def ensure_folder(conn: imaplib.IMAP4_SSL, name: str, mailbox: str) -> None:
    status, _ = conn.select(name, readonly=True)
    if status != "OK":
        status, data = conn.create(name)
        if status != "OK":
            detail = b" ".join(part for part in (data or []) if part).decode("utf-8", errors="replace")
            sys.exit(
                f"ERROR: could not create IMAP folder {name!r}: {detail or status}. "
                "Some servers namespace folders under the inbox -- try "
                f"AFLDB_INTAKE_PROCESSED_FOLDER=INBOX.{name}."
            )
    status, _ = conn.select(mailbox)
    if status != "OK":
        sys.exit(f"ERROR: could not re-select IMAP mailbox {mailbox!r}.")


def file_message(conn: imaplib.IMAP4_SSL, msg_id: bytes, folder: str) -> None:
    r"""Copy to `folder` and mark \Seen so the next poll skips it.

    The copy is a convenience, not the record -- the original never
    leaves the mailbox -- so a folder that cannot be written is worth a
    warning and nothing more. The \Seen flag is the part that matters:
    if THAT fails, the message really will come back, so say so.
    """
    status, _ = conn.copy(msg_id, folder)
    imap_ok(status, f"copy to {folder}")
    status, _ = conn.store(msg_id, "+FLAGS", r"(\Seen)")
    if not imap_ok(status, r"mark \Seen"):
        print("    the message will be picked up again on the next poll")


def find_csv_attachment(msg: Message) -> tuple[str, bytes] | None:
    """The first CSV attachment on the message, or None.

    The filename decides. Matching on content type as well was far too
    generous: mail clients label attachments application/octet-stream as
    a matter of routine, and application/vnd.ms-excel is the type for
    .xls -- a binary workbook, not a CSV. Either one meant a signature
    image or a spreadsheet was forwarded as though it were data, failed
    to parse at the far end, and sent the whole message to Errors.
    """
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        filename = part.get_filename()
        content_type = part.get_content_type()
        if (filename and filename.lower().endswith(".csv")) or content_type == "text/csv":
            payload = part.get_payload(decode=True)
            if payload:
                return filename or "email-upload.csv", payload
    return None


_HEADER_REGISTRY = HeaderRegistry()
_FOLD_RE = re.compile(r"\r?\n(?=[ \t])")
# Deliberately narrower than RFC 5322: a dot-atom local part and an ASCII
# host name. Local parts that need quoting, domain literals and non-ASCII
# addresses are refused rather than interpreted -- they are where address
# parsers disagree, and a disagreement here decides whose name a file goes
# in. (Needless quotes, "admin"@x, are dropped by the parser: same mailbox.)
_ATEXT = r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+"
_LABEL = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
_DOMAIN_RE = re.compile(rf"{_LABEL}(?:\.{_LABEL})+\Z")
_MAILBOX_RE = re.compile(rf"(?P<local>{_ATEXT}(?:\.{_ATEXT})*)@(?P<domain>{_LABEL}(?:\.{_LABEL})+)\Z")


def parse_from_mailbox(msg: Message) -> tuple[str | None, str]:
    """(mailbox, reason): the one From address, lower-cased, or None and why.

    This is the address forwarded as senderEmail AND the one whose domain
    DMARC must have passed for, so both decisions see the same parse. A
    message with two From headers, two mailboxes, a group, or anything
    the parser had to guess at is refused: a DMARC evaluator that read it
    differently would have vouched for someone else.
    """
    values = msg.get_all("From") or []
    if len(values) != 1:
        return None, f"expected exactly one From header, found {len(values)}"
    value = _FOLD_RE.sub("", str(values[0]))
    try:
        header = _HEADER_REGISTRY("From", value)
    except Exception as exc:  # the parser's failure modes are not a stable API
        return None, f"From header could not be parsed: {exc}"
    if header.defects:
        return None, f"From header is malformed: {header.defects[0]}"
    groups = header.groups
    if len(groups) != 1 or groups[0].display_name is not None or len(groups[0].addresses) != 1:
        return None, f"From header must hold exactly one mailbox: {value[:200]!r}"
    # RFC 2047 forbids encoded-words in an addr-spec, but the stdlib decodes
    # them there anyway: "=?utf-8?q?admin?= @example.com" comes out as
    # admin@example.com, a spelling the header never had. Only the parse
    # tree still shows the encoding, so without one, refuse.
    tree = getattr(header, "_parse_tree", None)
    if tree is None:
        return None, "From header parse tree unavailable on this Python; refusing rather than guessing"
    if _encoded_word_in_addr_spec(tree):
        return None, f"From address is RFC 2047-encoded, which an address may not be: {value[:200]!r}"
    addr_spec = groups[0].addresses[0].addr_spec
    if not _MAILBOX_RE.match(addr_spec) or "=?" in addr_spec:
        return None, f"From address {addr_spec[:200]!r} is not a plain ASCII mailbox"
    return addr_spec.lower(), ""


def _encoded_word_in_addr_spec(token: object, inside: bool = False) -> bool:
    kind = getattr(token, "token_type", None)
    if inside and kind == "encoded-word":
        return True
    inside = inside or kind == "addr-spec"
    return isinstance(token, list) and any(_encoded_word_in_addr_spec(t, inside) for t in token)


class MalformedAuthResults(ValueError):
    """An Authentication-Results header this parser will not interpret."""


class AuthResult(NamedTuple):
    method: str
    version: str  # "" when the method carries none, which means 1
    result: str
    properties: list[tuple[str, str]]


_WSP = " \t\r\n"
_KEYWORD_RE = re.compile(r"[a-z0-9][a-z0-9_-]*\Z")
_PROPERTY_RE = re.compile(r"[a-z0-9][a-z0-9._-]*\Z")
_DIGITS_RE = re.compile(r"[0-9]+\Z")


def _strip_comments(text: str) -> str:
    """Replace each (comment) with a space, leaving "quoted strings" intact."""
    out: list[str] = []
    depth = 0
    quoted = False
    i = 0
    while i < len(text):
        c = text[i]
        if c == "\\" and (depth or quoted):
            if i + 1 >= len(text):
                raise MalformedAuthResults("dangling backslash")
            if quoted:
                out.append(text[i:i + 2])
            i += 2
            continue
        if depth:
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if not depth:
                    out.append(" ")
        elif quoted:
            out.append(c)
            quoted = c != '"'
        elif c == "(":
            depth = 1
        elif c == ")":
            raise MalformedAuthResults("unbalanced ')'")
        else:
            out.append(c)
            quoted = c == '"'
        i += 1
    if depth or quoted:
        raise MalformedAuthResults("unterminated comment or quoted string")
    return "".join(out)


def _skip_wsp(s: str, i: int) -> int:
    while i < len(s) and s[i] in _WSP:
        i += 1
    return i


def _read_name(s: str, i: int) -> tuple[str, int]:
    """A method, result or property name: stops at whitespace, '=', ';' or '"'."""
    j = i
    while j < len(s) and s[j] not in _WSP and s[j] not in '=;"':
        j += 1
    return s[i:j].lower(), j


def _read_value(s: str, i: int) -> tuple[str, int]:
    """A token, quoted-string or address, unquoted: stops at whitespace or ';'."""
    out: list[str] = []
    j = i
    while j < len(s) and s[j] not in _WSP and s[j] != ";":
        if s[j] != '"':
            out.append(s[j])
            j += 1
            continue
        j += 1
        while s[j] != '"':  # _strip_comments has proved every quote closes
            if s[j] == "\\":
                j += 1
            out.append(s[j])
            j += 1
        j += 1
    if j == i:
        raise MalformedAuthResults(f"missing value at offset {i}")
    return "".join(out), j


def parse_authentication_results(value: str) -> tuple[str, list[AuthResult]]:
    """(authserv_id, results) from one Authentication-Results header (RFC 8601).

    A method=result pair is recognised ONLY where the grammar puts one: at
    the start of a ';'-separated result. Comments are removed first, and
    property values -- including quoted strings and addresses -- are read
    whole, so text such as "dmarc=pass" inside an envelope address or a
    comment is never mistaken for a result. Anything that does not parse
    raises MalformedAuthResults rather than being half-read.
    """
    s = _strip_comments(_FOLD_RE.sub("", str(value)))
    i = _skip_wsp(s, 0)
    authserv_id, i = _read_value(s, i)
    i = _skip_wsp(s, i)
    if i < len(s) and s[i] != ";":
        version, i = _read_value(s, i)
        if not _DIGITS_RE.match(version):
            raise MalformedAuthResults(f"unexpected {version[:40]!r} after the authserv-id")
        if version != "1":  # the only version RFC 8601 defines
            raise MalformedAuthResults(f"unsupported Authentication-Results version {version[:40]!r}")
        i = _skip_wsp(s, i)
        if i < len(s) and s[i] != ";":
            raise MalformedAuthResults("unexpected text after the authserv-id version")
    if i >= len(s):
        raise MalformedAuthResults("no results after the authserv-id")

    results: list[AuthResult] = []
    no_result = False
    while i < len(s):
        i = _skip_wsp(s, i + 1)  # past the ';'
        if i >= len(s):
            break  # a trailing ';'
        name, i = _read_name(s, i)
        method, _, method_version = name.partition("/")
        if not _KEYWORD_RE.match(method) or (method_version and not _DIGITS_RE.match(method_version)):
            raise MalformedAuthResults(f"bad method {name[:40]!r}")
        i = _skip_wsp(s, i)
        if method == "none" and not method_version and (i >= len(s) or s[i] == ";"):
            no_result = True
            continue
        if i >= len(s) or s[i] != "=":
            raise MalformedAuthResults(f"method {method!r} has no result")
        result, i = _read_name(s, _skip_wsp(s, i + 1))
        if not _KEYWORD_RE.match(result):
            raise MalformedAuthResults(f"bad result {result[:40]!r} for {method!r}")
        properties: list[tuple[str, str]] = []
        while True:
            i = _skip_wsp(s, i)
            if i >= len(s) or s[i] == ";":
                break
            prop, i = _read_name(s, i)
            if not _PROPERTY_RE.match(prop):
                raise MalformedAuthResults(f"bad property {prop[:40]!r} in {method!r}")
            i = _skip_wsp(s, i)
            if i >= len(s) or s[i] != "=":
                raise MalformedAuthResults(f"property {prop!r} has no value")
            pvalue, i = _read_value(s, _skip_wsp(s, i + 1))
            properties.append((prop, pvalue))
        results.append(AuthResult(method, method_version, result, properties))
    if no_result and results:
        raise MalformedAuthResults("'none' mixed with results")
    return authserv_id, results


def dmarc_verifies(msg: Message, mailbox: str, authserv_id: str) -> tuple[bool, str]:
    """Did the receiving server record a DMARC pass for `mailbox`'s domain?

    Only the FIRST Authentication-Results header is read. Each hop
    PREPENDS its own, so the first one is the one written by the server
    that accepted the message -- the only party in the chain whose word
    means anything here. It must name that server (authserv_id, matched
    exactly), parse cleanly, and hold exactly one dmarc result: pass,
    with exactly one header.from equal to the From mailbox's domain. If
    the first header fails any of that, the message is refused; lower
    headers are never consulted, because a spoofer's sit there.

    Relies on the receiving server removing any inbound header that
    already carries its authserv-id (RFC 8601 section 5).
    """
    headers = msg.get_all("Authentication-Results") or []
    if not headers:
        return False, "no Authentication-Results header: the mail server recorded no DMARC result"
    try:
        found_id, results = parse_authentication_results(headers[0])
    except MalformedAuthResults as exc:
        return False, f"the topmost Authentication-Results header is malformed: {exc}"
    if found_id.lower() != authserv_id:
        return False, f"the topmost Authentication-Results header is from {found_id[:100]!r}, not {authserv_id!r}"

    # Counted whatever their version, so a versioned result still
    # conflicts with an unversioned one rather than hiding beside it.
    dmarc = [r for r in results if r.method == "dmarc"]
    if len(dmarc) != 1:
        return False, f"expected exactly one dmarc result from {authserv_id!r}, found {len(dmarc)}"
    if dmarc[0].version not in ("", "1"):
        return False, f"unsupported dmarc result version {dmarc[0].version[:40]!r}"
    if dmarc[0].result != "pass":
        return False, f"dmarc={dmarc[0].result}"
    header_from = [v for prop, v in dmarc[0].properties if prop == "header.from"]
    if len(header_from) != 1:
        return False, f"expected exactly one header.from on dmarc=pass, found {len(header_from)}"
    domain = header_from[0].lower()
    if domain.endswith("."):
        domain = domain[:-1]
    if not _DOMAIN_RE.match(domain):
        return False, f"dmarc=pass header.from={header_from[0][:100]!r} is not a domain"
    mailbox_domain = mailbox.rpartition("@")[2]
    if domain != mailbox_domain:
        return False, f"dmarc=pass is for {domain!r}, but the From address is at {mailbox_domain!r}"
    return True, f"dmarc=pass header.from={domain} (authserv-id {authserv_id})"


def sender_is_authenticated(msg: Message, authserv_id: str | None = None) -> tuple[bool, str]:
    """parse_from_mailbox then dmarc_verifies, as one yes/no.

    With no authserv_id, the configured one is used; with none configured,
    nothing can be trusted and the answer is no.
    """
    if authserv_id is None:
        try:
            authserv_id = intake_auth_config()[1]
        except ConfigError as exc:
            return False, f"configuration error: {exc}"
        if authserv_id is None:
            return False, "AFLDB_INTAKE_AUTHSERV_ID is not set, so no Authentication-Results header can be trusted"
    mailbox, why = parse_from_mailbox(msg)
    if mailbox is None:
        return False, why
    return dmarc_verifies(msg, mailbox, authserv_id)


def post_to_intake(
    base_url: str, secret: str, sender_email: str, dataset: str, filename: str, content: bytes,
    timeout: int,
) -> dict:
    body = json.dumps({
        "senderEmail": sender_email,
        "dataset": dataset,
        "filename": filename,
        "contentBase64": base64.b64encode(content).decode("ascii"),
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/admin/email-intake",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "X-Intake-Secret": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        # A 4xx is a verdict on THIS message and resending it changes
        # nothing -- except 408 and 429, which are about timing rather
        # than content. Everything else (5xx, and anything that never
        # got an answer) says the app could not deal with it just now.
        if 400 <= exc.code < 500 and exc.code not in (408, 429):
            raise PermanentFailure(f"HTTP {exc.code}: {detail}") from exc
        raise TransientFailure(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise TransientFailure(f"could not reach {base_url}: {exc.reason}") from exc
    except (TimeoutError, OSError) as exc:
        raise TransientFailure(f"no response within {timeout}s: {exc}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        # The POST itself succeeded and the file may well be staged; only
        # the reply is unreadable. Retrying is safe -- the route
        # deduplicates on the file's SHA-256 -- and is better than
        # recording a success this script cannot actually describe.
        raise TransientFailure(f"unreadable reply from the intake route: {raw[:200]!r}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="list matching messages and what would be staged, without contacting the app or touching the mailbox",
    )
    args = parser.parse_args()

    load_env()
    # First, before anything can open the mailbox: a configuration that
    # cannot authenticate senders must not get as far as filing messages
    # under Errors, marking them read, or forwarding them.
    try:
        require_auth, authserv_id = intake_auth_config()
    except ConfigError as exc:
        print(f"CONFIGURATION ERROR: {exc}", file=sys.stderr)
        print("Stopped before connecting to the mailbox; no message was read or changed.", file=sys.stderr)
        return EXIT_CONFIG
    base_url = intake_base_url()
    # Not required for --dry-run, which promises not to contact the app:
    # demanding the secret to do nothing with it turns "show me what is
    # waiting" into something only the deployed server can answer.
    secret = "" if args.dry_run else require_env("AFLDB_EMAIL_INTAKE_SECRET")
    timeout = env_int("AFLDB_INTAKE_HTTP_TIMEOUT", 180)
    mailbox = os.environ.get("AFLDB_INTAKE_IMAP_MAILBOX", "INBOX")
    processed_folder = os.environ.get("AFLDB_INTAKE_PROCESSED_FOLDER", "Processed")
    error_folder = os.environ.get("AFLDB_INTAKE_ERROR_FOLDER", "Errors")

    conn = imap_connect()
    try:
        if not args.dry_run:
            ensure_folder(conn, processed_folder, mailbox)
            ensure_folder(conn, error_folder, mailbox)

        status, data = conn.search(None, "UNSEEN")
        if status != "OK":
            print(f"IMAP search failed: {status}")
            return EXIT_TEMPFAIL
        ids = data[0].split()
        print(f"{len(ids)} unseen message(s) in {mailbox}")

        staged = rejected = deferred = 0
        for msg_id in ids:
            # BODY.PEEK[], not RFC822: a plain FETCH of RFC822 sets \Seen
            # as a side effect, which would quietly consume every message
            # this script then decides to leave unread for a retry.
            status, msg_data = conn.fetch(msg_id, "(BODY.PEEK[])")
            if status != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                print(f"  {msg_id.decode()}: could not fetch, will retry next poll")
                deferred += 1
                continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)

            subject = (msg.get("Subject") or "").strip()
            dataset = subject.lower().replace(" ", "_")
            # The one parse of From: it is both what DMARC is checked
            # against and what is forwarded as senderEmail.
            sender, from_problem = parse_from_mailbox(msg)
            shown = sender or [str(value) for value in msg.get_all("From") or []]
            print(f"  {msg_id.decode()}: from={shown!r} subject={subject!r}")

            # Everything from here to the POST is a permanent verdict on
            # this message: none of it can come out differently on a
            # later poll. Filing it settles the message instead of
            # re-reading and re-reporting it on every run forever.
            if dataset not in KNOWN_DATASETS:
                print(f"    subject is not a registered dataset key {sorted(KNOWN_DATASETS)}")
                if not args.dry_run:
                    file_message(conn, msg_id, error_folder)
                rejected += 1
                continue

            if sender is None:
                print(f"    REJECTED: {from_problem}")
                if not args.dry_run:
                    file_message(conn, msg_id, error_folder)
                rejected += 1
                continue

            if authserv_id is None:
                authenticated, why = False, "no AFLDB_INTAKE_AUTHSERV_ID, so the sender was not checked"
            else:
                authenticated, why = dmarc_verifies(msg, sender, authserv_id)
            if not authenticated:
                if require_auth:
                    print(f"    REJECTED: {why}")
                    if not args.dry_run:
                        file_message(conn, msg_id, error_folder)
                    rejected += 1
                    continue
                print(f"    WARNING: {why} (AFLDB_INTAKE_REQUIRE_AUTH is off; forwarding anyway)")
            else:
                print(f"    sender domain verified: {why}")

            attachment = find_csv_attachment(msg)
            if not attachment:
                print("    no CSV attachment found")
                if not args.dry_run:
                    file_message(conn, msg_id, error_folder)
                rejected += 1
                continue
            filename, content = attachment

            if args.dry_run:
                print(f"    [dry-run] would stage {filename!r} ({len(content)} bytes) as {dataset!r} from {sender!r}")
                continue

            try:
                result = post_to_intake(base_url, secret, sender, dataset, filename, content, timeout)
            except PermanentFailure as exc:
                print(f"    REJECTED: {exc}")
                file_message(conn, msg_id, error_folder)
                rejected += 1
                continue
            except TransientFailure as exc:
                # Left unread on purpose: the outcome is unknown, and the
                # next poll can find out. The route's SHA-256 dedup is
                # what makes asking again harmless.
                print(f"    DEFERRED: {exc}")
                print("    left unread; the next poll will try again")
                deferred += 1
                continue

            if result.get("duplicate"):
                print(f"    already staged as submission {result.get('submissionId')}; nothing new written")
            else:
                print(f"    staged: submission {result.get('submissionId')}, "
                      f"{result.get('rowCount')} row(s), report={result.get('report')}")
            file_message(conn, msg_id, processed_folder)
            staged += 1

        print(f"done: {staged} staged, {rejected} rejected, {deferred} deferred")
        if rejected:
            return EXIT_REJECTED
        if deferred:
            return EXIT_TEMPFAIL
        return EXIT_OK
    finally:
        try:
            conn.close()
        except imaplib.IMAP4.error:
            pass
        conn.logout()


if __name__ == "__main__":
    sys.exit(main())
