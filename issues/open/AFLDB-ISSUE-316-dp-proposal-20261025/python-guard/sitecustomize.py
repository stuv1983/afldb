"""Offline validation instrumentation, loaded before the unchanged validators."""
import json
import os
import sys

_log = os.environ.get("ISSUE316_NETWORK_AUDIT")


def _record(event):
    if _log:
        with open(_log, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"runtime": "python", "pid": os.getpid(), "event": event}) + "\n")


def _audit(event, args):
    if event in ("socket.connect", "socket.connect_ex", "socket.sendto", "socket.getaddrinfo"):
        _record("connection-refused")
        raise RuntimeError("ISSUE-316 offline validation forbids network connections")


sys.addaudithook(_audit)
_record("guard-loaded")
