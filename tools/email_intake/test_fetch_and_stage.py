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

import importlib.util
import io
import os
import sys
import tempfile
import urllib.error
import urllib.request
from email.message import EmailMessage
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


def message_with(*auth_headers: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = "admin@example.com"
    for header in auth_headers:
        msg["Authentication-Results"] = header
    return msg


def message_attaching(filename: str, maintype: str, subtype: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = "admin@example.com"
    msg.set_content("see attached")
    msg.add_attachment(b"a,b\n1,2\n", maintype=maintype, subtype=subtype, filename=filename)
    return msg


def test_sender_is_authenticated() -> None:
    print("sender_is_authenticated")
    ok = lambda msg: poller.sender_is_authenticated(msg)[0]  # noqa: E731

    check("no header means unverified", ok(message_with()), False)
    check("dmarc=pass", ok(message_with("mx.host.com; dmarc=pass header.from=example.com")), True)
    check("spf=pass with dkim=pass",
          ok(message_with("mx.host.com; spf=pass smtp.mailfrom=x; dkim=pass header.d=example.com")), True)
    check("dmarc=fail", ok(message_with("mx.host.com; dmarc=fail header.from=example.com")), False)
    check("spf=pass alone is not enough",
          ok(message_with("mx.host.com; spf=pass smtp.mailfrom=x")), False)

    # The attack this check exists for. Anyone can put a passing
    # Authentication-Results header in the mail they send; the receiving
    # server PREPENDS its own, so the forged one ends up second. Reading
    # every header -- or the last one -- accepts the forgery. If this
    # test fails, spoofing an admin's From address is enough to submit
    # data as them.
    check("a forged pass below the server's fail is ignored",
          ok(message_with("mx.host.com; dmarc=fail header.from=example.com",
                          "totally.legit; dmarc=pass header.from=example.com")), False)

    os.environ["AFLDB_INTAKE_AUTHSERV_ID"] = "mx.host.com"
    try:
        check("authserv-id matches", ok(message_with("mx.host.com; dmarc=pass")), True)
        check("authserv-id with a version token", ok(message_with("mx.host.com 1; dmarc=pass")), True)
        check("another server's header is refused", ok(message_with("evil.example; dmarc=pass")), False)
    finally:
        del os.environ["AFLDB_INTAKE_AUTHSERV_ID"]


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
