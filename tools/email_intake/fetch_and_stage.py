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
server verified it -- an Authentication-Results header recording
dmarc=pass, or spf=pass with dkim=pass. Without that check the intake
would treat "knows an admin's email address" as authorisation to submit
data as them. Set AFLDB_INTAKE_REQUIRE_AUTH=false only on a mailbox
where something upstream already guarantees this.

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
75 (EX_TEMPFAIL) nothing was rejected but something is being retried.
"""
from __future__ import annotations

import argparse
import base64
import email
import imaplib
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from email.message import Message
from email.utils import parseaddr
from pathlib import Path

EXIT_OK = 0
EXIT_REJECTED = 1
EXIT_TEMPFAIL = 75  # sysexits.h EX_TEMPFAIL: try again later, nothing is wrong here

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


def env_flag(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


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


def sender_address(msg: Message) -> str:
    _, addr = parseaddr(msg.get("From", ""))
    return addr.strip().lower()


def sender_is_authenticated(msg: Message) -> tuple[bool, str]:
    """Did the receiving mail server verify who sent this?

    Only the FIRST Authentication-Results header is read. Each hop
    PREPENDS its own, so the first one is the one written by the server
    that accepted the message -- the only party in the chain whose word
    means anything here. A spoofer is free to put "dmarc=pass" in the
    message they send; theirs ends up below ours, where this never looks.

    Set AFLDB_INTAKE_AUTHSERV_ID to the mail server's authserv-id to
    also require that the header carries that name, which closes the
    gap on a server that does not strip inbound Authentication-Results
    headers before adding its own.
    """
    headers = msg.get_all("Authentication-Results") or []
    if not headers:
        return False, "no Authentication-Results header: the mail server recorded no SPF/DKIM/DMARC result"

    top = " ".join(str(headers[0]).split()).lower()

    expected = (os.environ.get("AFLDB_INTAKE_AUTHSERV_ID") or "").strip().lower()
    if expected:
        authserv = top.split(";", 1)[0].strip()
        if authserv != expected and not authserv.startswith(f"{expected} "):
            return False, f"Authentication-Results is from {authserv!r}, not {expected!r}"

    if "dmarc=pass" in top:
        return True, "dmarc=pass"
    if "spf=pass" in top and "dkim=pass" in top:
        return True, "spf=pass, dkim=pass"
    return False, f"sender not verified by the mail server: {top[:200]}"


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
    base_url = intake_base_url()
    # Not required for --dry-run, which promises not to contact the app:
    # demanding the secret to do nothing with it turns "show me what is
    # waiting" into something only the deployed server can answer.
    secret = "" if args.dry_run else require_env("AFLDB_EMAIL_INTAKE_SECRET")
    timeout = env_int("AFLDB_INTAKE_HTTP_TIMEOUT", 180)
    require_auth = env_flag("AFLDB_INTAKE_REQUIRE_AUTH", True)
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
            sender = sender_address(msg)
            print(f"  {msg_id.decode()}: from={sender!r} subject={subject!r}")

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

            authenticated, why = sender_is_authenticated(msg)
            if not authenticated:
                if require_auth:
                    print(f"    REJECTED: {why}")
                    if not args.dry_run:
                        file_message(conn, msg_id, error_folder)
                    rejected += 1
                    continue
                print(f"    WARNING: {why} (AFLDB_INTAKE_REQUIRE_AUTH is off; forwarding anyway)")

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
