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

No third-party packages: imaplib, email and urllib are standard
library, so this runs under plain python3 -- no virtualenv needed,
unlike the psycopg-based migration tools in tools/migration.

Never deletes mail. A processed message (success or failure) is
copied to a Processed/Errors folder and marked \\Seen so it will not
be picked up again; the original stays in the mailbox as a record.

Run on an interval via a systemd timer (see
deploy/afldb-email-intake.timer and docs/admin-and-beta.md's
"Email-in CSV intake" section for the one-time server setup).
"""
from __future__ import annotations

import argparse
import base64
import email
import imaplib
import json
import os
import sys
import urllib.error
import urllib.request
from email.message import Message
from email.utils import parseaddr
from pathlib import Path

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
        os.environ.setdefault(key.strip(), value.strip())


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ERROR: required environment variable {name} is not set.")
    return value


# Kept in sync BY HAND with DATASETS in src/lib/ingest/datasets.ts. Only
# used to give a clear, immediate reason for skipping an unrecognised
# subject without a wasted HTTP round trip -- the intake route re-checks
# the dataset key itself regardless, so a mismatch here is never unsafe,
# only a message that sits unread until the subject is fixed and resent.
KNOWN_DATASETS = {"rising_star", "all_australian", "match_results", "player_match_stats"}


def imap_connect() -> imaplib.IMAP4_SSL:
    host = require_env("AFLDB_INTAKE_IMAP_HOST")
    port = int(os.environ.get("AFLDB_INTAKE_IMAP_PORT", "993"))
    user = require_env("AFLDB_INTAKE_IMAP_USER")
    password = require_env("AFLDB_INTAKE_IMAP_PASSWORD")
    mailbox = os.environ.get("AFLDB_INTAKE_IMAP_MAILBOX", "INBOX")

    conn = imaplib.IMAP4_SSL(host, port)
    conn.login(user, password)
    conn.select(mailbox)
    return conn


def ensure_folder(conn: imaplib.IMAP4_SSL, name: str, mailbox: str) -> None:
    status, _ = conn.select(name, readonly=True)
    if status != "OK":
        conn.create(name)
    conn.select(mailbox)


def find_csv_attachment(msg: Message) -> tuple[str, bytes] | None:
    """The first CSV-looking attachment on the message, or None."""
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        filename = part.get_filename()
        content_type = part.get_content_type()
        looks_like_csv = filename and (
            filename.lower().endswith(".csv")
            or content_type in ("text/csv", "application/vnd.ms-excel", "application/octet-stream")
        )
        if looks_like_csv:
            payload = part.get_payload(decode=True)
            if payload:
                return filename, payload
    return None


def sender_address(msg: Message) -> str:
    _, addr = parseaddr(msg.get("From", ""))
    return addr.strip().lower()


def post_to_intake(
    base_url: str, secret: str, sender_email: str, dataset: str, filename: str, content: bytes,
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
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="list matching messages and what would be staged, without contacting the app or touching the mailbox",
    )
    args = parser.parse_args()

    load_env()
    base_url = os.environ.get("AFLDB_BASE_URL", "http://127.0.0.1:3100")
    secret = require_env("AFLDB_EMAIL_INTAKE_SECRET")
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
            return 1
        ids = data[0].split()
        print(f"{len(ids)} unseen message(s) in {mailbox}")

        exit_code = 0
        for msg_id in ids:
            status, msg_data = conn.fetch(msg_id, "(RFC822)")
            if status != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                print(f"  {msg_id.decode()}: could not fetch, skipping")
                continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)

            subject = (msg.get("Subject") or "").strip()
            dataset = subject.lower().replace(" ", "_")
            sender = sender_address(msg)
            print(f"  {msg_id.decode()}: from={sender!r} subject={subject!r}")

            if dataset not in KNOWN_DATASETS:
                print(f"    subject is not a registered dataset key {sorted(KNOWN_DATASETS)}; leaving unread")
                continue

            attachment = find_csv_attachment(msg)
            if not attachment:
                print("    no CSV attachment found; leaving unread")
                continue
            filename, content = attachment

            if args.dry_run:
                print(f"    [dry-run] would stage {filename!r} ({len(content)} bytes) as {dataset!r} from {sender!r}")
                continue

            try:
                result = post_to_intake(base_url, secret, sender, dataset, filename, content)
                print(f"    staged: submission {result.get('submissionId')}, "
                      f"{result.get('rowCount')} row(s), report={result.get('report')}")
                conn.copy(msg_id, processed_folder)
                conn.store(msg_id, "+FLAGS", r"(\Seen)")
            except Exception as exc:  # noqa: BLE001 -- report this message's failure and continue with the rest
                print(f"    FAILED: {exc}")
                conn.copy(msg_id, error_folder)
                conn.store(msg_id, "+FLAGS", r"(\Seen)")
                exit_code = 1

        return exit_code
    finally:
        try:
            conn.close()
        except imaplib.IMAP4.error:
            pass
        conn.logout()


if __name__ == "__main__":
    sys.exit(main())
