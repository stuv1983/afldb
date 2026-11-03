"""V2-GAP-029: what the two Python production entry points (draft link-only, sibling pair) share with the TypeScript ones
(`tools/v2/gap029-common.ts`), kept as a line-for-line mirror so no stage uses a weaker rule than another.

  1. OUTCOME TAXONOMY and the apply runner. A mutation attempt ends in exactly one of seven named outcomes with a distinct exit code and a
     fixed statement. The runner never retries, never reverses and never restores.
  2. The restore-evidence ASSEMBLY SEAL check (the sealing itself is done by `gap029-assemble-restore-evidence.ts`). It is TAMPER-EVIDENT,
     not tamper-proof: with no secret key, someone who rewrites a field AND recomputes the digest produces a file this code accepts. It
     removes the accidental and the casual (a hand-picked value, a value from another run, a file edited after assembly, another revision,
     another stage, another restore, changed tools). The plan/approval ceremony remains the control against a deliberate forger.

Held to the same fixtures as the TypeScript module by tests/python/gap029_common_contract.py and tests/gap029-assembly.test.ts.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

MAX_AGE = timedelta(hours=24)

OUTCOMES = ("COMMITTED_VERIFIED", "NOTHING_WRITTEN", "REFUSED_BEFORE_MUTATION", "ROLLED_BACK", "COMMITTED_VERIFICATION_FAILED",
            "COMMITTED_VERIFICATION_UNAVAILABLE", "OUTCOME_UNDETERMINED")
EXIT_CODE = {"COMMITTED_VERIFIED": 0, "NOTHING_WRITTEN": 0, "REFUSED_BEFORE_MUTATION": 1, "ROLLED_BACK": 2, "COMMITTED_VERIFICATION_FAILED": 3,
             "COMMITTED_VERIFICATION_UNAVAILABLE": 4, "OUTCOME_UNDETERMINED": 5}
_COMMITTED_RECOVERY = ("The change IS COMMITTED and is NOT rolled back. This tool will not retry, reverse or restore. Restoring the verified backup is a "
                       "separate OWNER decision and would discard every write made to the database after the backup was taken; nothing is restored automatically.")
STATEMENT = {
    "COMMITTED_VERIFIED": "COMMITTED AND VERIFIED: the writer committed and an independent read-only check of the committed state passed.",
    "NOTHING_WRITTEN": "NOTHING WRITTEN: the plan was already satisfied; no change was made.",
    "REFUSED_BEFORE_MUTATION": "REFUSED BEFORE MUTATION: a check failed before the writer was started; nothing was written.",
    "ROLLED_BACK": "ROLLED BACK: the writer failed and an independent read-only check proves the database holds its pre-run state "
                   "(sequence values consumed by the attempt are not returned).",
    "COMMITTED_VERIFICATION_FAILED": "COMMITTED, VERIFICATION FAILED: the independent check of the committed state found differences. " + _COMMITTED_RECOVERY,
    "COMMITTED_VERIFICATION_UNAVAILABLE": "COMMITTED, VERIFICATION UNAVAILABLE: the writer committed but the independent check could not be completed. " + _COMMITTED_RECOVERY,
    "OUTCOME_UNDETERMINED": "OUTCOME UNDETERMINED: the tool could not establish whether the writer committed. Do NOT assume it rolled back and do NOT retry; "
                            "read the state with the read-only `state` mode against the same plan.",
}


def is_committed(outcome: str) -> bool:
    return outcome in ("COMMITTED_VERIFIED", "COMMITTED_VERIFICATION_FAILED", "COMMITTED_VERIFICATION_UNAVAILABLE")


def _msg(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:400]


class Report:
    def __init__(self, outcome: str, problems: list[str], detail: str | None, record: dict, persisted: bool):
        self.outcome, self.exit_code, self.statement = outcome, EXIT_CODE[outcome], STATEMENT[outcome]
        self.problems, self.detail, self.record, self.record_persisted = problems, detail, record, persisted

    def lines(self) -> list[str]:
        out = [f"OUTCOME {self.outcome} (exit {self.exit_code})", self.statement]
        if self.detail:
            out.append(f"detail: {self.detail}")
        out += [f"problem: {p}" for p in self.problems]
        if not self.record_persisted and self.outcome != "REFUSED_BEFORE_MUTATION":
            out.append("the output record could not be written; its content follows (no secrets): " + json.dumps(self.record, sort_keys=True))
        return out


def run_apply(preflight: Callable[[], None], launch: Callable[[], dict], probe: Callable[[], str], verify: Callable[[], list[str]],
              persist: Callable[[dict], None], at: Callable[[], str]) -> Report:
    """Runs one apply of a tool whose writer commits in its OWN transaction (a subprocess), and classifies it.

    preflight()  everything that must hold before the writer starts; any exception => REFUSED_BEFORE_MUTATION.
    launch()     starts the writer and returns {'exit': int, ...}. The writer is NOT known to be transactional from here: exit 0 means only that it reported
                 success (the probe still decides), a non-zero exit means nothing about whether it committed (a later step of the writer, or its own cleanup, can fail
                 after COMMIT), and an exception (timeout, killed) means the same.
    probe()      a fresh read-only session classifies the live state: 'unchanged' (equals the plan's baseline), 'applied' (equals the planned
                 result in every pre-existing respect) or 'other'. May raise (=> unreadable).
    verify()     the independent post-commit check; returns problems; may raise (=> unavailable).
    persist()    writes the exclusive output record; a failure never changes the outcome.
    """
    def finish(outcome: str, problems: list[str], detail: str | None, extra: dict | None = None) -> Report:
        record = {"outcome": outcome, "exitCode": EXIT_CODE[outcome], "statement": STATEMENT[outcome], "problems": problems, "detail": detail, "at": at(), **(extra or {})}
        persisted = False
        if outcome != "REFUSED_BEFORE_MUTATION":
            try:
                persist(record)
                persisted = True
            except BaseException:  # noqa: BLE001 - a record failure must never change the outcome
                persisted = False
        return Report(outcome, problems, detail, record, persisted)

    try:
        preflight()
    except Exception as exc:  # noqa: BLE001
        return finish("REFUSED_BEFORE_MUTATION", [], _msg(exc))
    launched: dict[str, Any] = {}
    try:
        launched = launch()
        writer_ok = launched.get("exit") == 0
        launch_detail = None if writer_ok else f"the writer exited {launched.get('exit')}"
    except BaseException as exc:  # noqa: BLE001 - includes KeyboardInterrupt and timeouts: the writer's state is then unknown
        writer_ok = False
        launch_detail = f"the writer did not return normally ({_msg(exc)})"
    extra = {"writer": {k: v for k, v in launched.items() if k not in ("stderr", "stdout")}}
    # The writer's exit code is NEVER evidence about its transaction: a fresh read-only probe classifies the live state after EVERY launch, including exit 0
    # (a writer can exit 0 having persisted nothing, e.g. an "already satisfied" early return; asserting "committed" from the exit code would then be false).
    try:
        seen = probe()
    except Exception:  # noqa: BLE001
        seen = "unreadable"
    if seen == "applied":
        if not writer_ok:
            extra["writerFailedAfterCommit"] = launch_detail      # the writer failed AFTER committing: the state is the planned one; verify it like any commit
    elif writer_ok:
        # the writer reported success, but the live state is not the planned result: nothing may be claimed either way
        return finish("OUTCOME_UNDETERMINED", [], "the writer exited 0 but the live state " + (
            "equals the pre-run baseline (it reported success without persisting the planned change)" if seen == "unchanged" else
            "is neither the baseline nor the planned result" if seen == "other" else "could not be read"), extra)
    elif seen == "unchanged":
        return finish("ROLLED_BACK", [], f"{launch_detail}; a fresh read-only session sees the pre-run state", extra)
    else:
        return finish("OUTCOME_UNDETERMINED", [], f"{launch_detail} and the live state was " + ("neither the baseline nor the planned result" if seen == "other" else "unreadable"), extra)
    try:
        problems = verify()
    except Exception as exc:  # noqa: BLE001
        return finish("COMMITTED_VERIFICATION_UNAVAILABLE", [], _msg(exc), extra)
    if problems:
        return finish("COMMITTED_VERIFICATION_FAILED", problems, None, extra)
    return finish("COMMITTED_VERIFIED", [], None, extra)


# ---------------------------------------------------------------------------------------------------------------------------------------
# Restore-evidence assembly seal (verification side; mirror of assemblyProblem in gap029-common.ts)
# ---------------------------------------------------------------------------------------------------------------------------------------
ASSEMBLY_FORMAT = "afldb.gap029.restore-evidence-assembly.1"
ISOLATED_DB = re.compile(r"^afldb_v2_[a-z0-9_]+_test$")
ISOLATED_CLUSTER = "afldb_v2_isolated"
ISOLATED_COMMENT = "afldb-v2-isolated-test"


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _ms(iso: Any) -> float | None:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _fresh(iso: Any, now: datetime) -> bool:
    t = _ms(iso)
    return t is not None and t <= now.timestamp() and now.timestamp() - t <= MAX_AGE.total_seconds()


def assembly_problem(backup: dict | None, *, operation: str, stage: str, revision: str, now: datetime, target: dict,
                     tool_sha256: dict[str, str], stage_fields: dict, inputs: dict | None = None) -> str | None:
    """Every reason a production plan must not trust this backup evidence, or None."""
    a = (backup or {}).get("assembly") if isinstance(backup, dict) else None
    if not isinstance(a, dict):
        return "backup evidence is not machine-assembled (no assembly block); hand-written backup evidence is refused"
    body, digest = a.get("sealedBody"), a.get("sealedBodySha256")
    if not isinstance(body, str) or not isinstance(digest, str):
        return "backup evidence assembly seal is missing"
    if sha256_text(body) != digest:
        return "backup evidence seal digest differs from its sealed body (the seal was edited)"
    try:
        parsed = json.loads(body)
    except ValueError:
        return "backup evidence sealed body is not JSON"
    rest = {k: v for k, v in a.items() if k not in ("sealedBody", "sealedBodySha256")}
    if parsed != {**backup, "assembly": rest}:
        return "backup evidence differs from its sealed body (a field was edited after assembly)"
    if a.get("format") != ASSEMBLY_FORMAT:
        return "backup evidence assembly format is not recognised"
    if a.get("operation") != operation or a.get("stage") != stage:
        return f"backup evidence was assembled for {a.get('stage')}/{a.get('operation')}, not {stage}/{operation}"
    if a.get("revision") != revision:
        return f"backup evidence was assembled at revision {str(a.get('revision'))[:12]}, the current revision is {revision[:12]}; re-assemble"
    have = (a.get("inputs") or {}).get("toolSha256") or {}
    for path, d in tool_sha256.items():
        if have.get(path) != d:
            return f"{path} differs from the bytes the restore evidence was derived with; re-assemble"
    for path in have:
        if path not in tool_sha256:
            return f"backup evidence names an unexpected tool file {path}"
    for k, v in (inputs or {}).items():
        if (a.get("inputs") or {}).get(k) != v:
            return f"backup evidence was derived with a different {k} than this plan uses"
    rt = a.get("restoreTarget") or {}
    if not ISOLATED_DB.match(str(rt.get("database", ""))) or rt.get("clusterName") != ISOLATED_CLUSTER or rt.get("databaseComment") != ISOLATED_COMMENT:
        return "the restore target is not a marked isolated test database"
    if rt.get("systemIdentifier") == target.get("systemIdentifier"):
        return "the restore target is the production cluster; a restore must be verified off production"
    captured, restored, assembled = _ms(backup.get("capturedAt")), _ms(backup.get("restoredAt")), _ms(a.get("assembledAt"))
    if None in (captured, restored, assembled) or not (captured <= restored <= assembled <= now.timestamp()):
        return "backup evidence timestamps are out of order (captured, restored, assembled)"
    if not (_fresh(backup.get("capturedAt"), now) and _fresh(backup.get("restoredAt"), now) and _fresh(a.get("assembledAt"), now)):
        return "backup evidence is older than 24 hours"
    inp = a.get("inputs") or {}
    if inp.get("dumpSha256") != backup.get("sha256") or inp.get("restoreEvidenceSha256") != backup.get("restoreEvidenceSha256"):
        return "backup evidence inputs do not match the backup and restore-evidence hashes"
    if (a.get("derived") or {}).get("values") != stage_fields:
        return "backup evidence stage values differ from what the restore derivation recorded"
    for k, v in stage_fields.items():
        if backup.get(k) != v:
            return f"backup evidence field {k} differs from the value the plan relies on"
    return None
