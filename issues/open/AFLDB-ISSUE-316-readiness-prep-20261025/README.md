# ISSUE-316 pre-window local source preparation

**Preparation only. No fresh production evidence has been collected.**

The owner accepted documentation commit `ffb062675ee25650cfc1b4fa6bfe98336a23cc4f`.
Approved execution P remains `def676517da3955aa18db3606785463aac464188`.
The proof window is **2026-10-27 02:00–04:00 UTC / 13:00–15:00 AEDT, Melbourne**.
The accepted package, its structural inputs and its 209-member manifest remain
unchanged. This separate preparation directory does not replace that package.

Local detached worktree:

```text
D:/dev/afldbV2/.local-release/issue316-readiness-20261027/execution-P
```

It contains exact P source, without a dependency junction, copied credentials,
external CSV inputs or historical census files. `P-SOURCE-HASHES.json` inventories
every tracked blob. `PREPARATION.json` is explicitly **not freshness evidence**.
This Windows preparation does not prove the Linux runtime, mode-700 deployment
staging, current native policy, host/database identity or service health. The
day-D execution source on streamanator must independently satisfy those controls.

Run the local static source check without any network/production access:

```powershell
node issues/open/AFLDB-ISSUE-316-readiness-prep-20261025/check-source.cjs --prepare
```

At or after opening, the **source gate only** can be invoked with the actual
isolated Linux source root (the administrative preparation files must also be
available at their bound locations). It is not the complete opening preflight:

```text
node issues/open/AFLDB-ISSUE-316-readiness-prep-20261025/check-source.cjs --opening <isolated exact-P execution root> --helper-commit <full reviewed H>
```

Before opening and at/after closing, `--opening` refuses before inspecting the
execution source. There is no fake clock, date override, forwarded command,
network/DB call or apply mode. The source gate checks actual Git HEAD, raw tracked
blob bytes, expected status, approved input overlays and transaction/activation
residue, including ignored files. It rejects unexpected source/test/configuration
files. Runtime dependencies are deliberately **not certified** by this helper;
the current Linux enforced runtime/native policy must bind them separately.
Administrative HEAD must include accepted documentation anchor `ffb06267...`;
it is recorded as A and may include the helper-freeze commit H. A never replaces P.
The approval and external-input inventory must also match their exact committed
blobs at accepted administrative commit `ffb062675ee25650cfc1b4fa6bfe98336a23cc4f`
before parsing. A clean HEAD alone is not sufficient authority for mutable working
files. Exactly 264 unique approved external input paths are required.

## H — helper freeze and day-D integrity

H is the full SHA of the separate local helper-freeze commit, recorded after that
commit succeeds. It is supplied explicitly, never inferred from current HEAD.
Opening mode requires it; static `--prepare` may omit it only before freezing.
After freezing, use `--prepare --helper-commit <H>` for a read-only integrity
check. Do not rerun record-generating preparation scripts in the frozen directory:
their changed timestamps/manifests would correctly cause H verification to refuse.

The H verifier checks that H is a commit descending from the accepted documentation
anchor, contains the complete helper set, and exactly matches all working helper
file names/types and raw bytes. A mismatch stops before host/DB observations.
Approval/inventory authority remains bound to exact `ffb06267...` blobs even when
administrative HEAD is H or a later documentation-only descendant.

Before loading any working helper on Linux, verify its script bytes using trusted
Git/OS commands. Set `A`, `EXEC` and the **recorded full H** explicitly; do not use
administrative HEAD as H or P. This command is preparation text, not an executed
production observation:

```bash
set -euo pipefail
utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [[ "$utc" < '2026-10-27T02:00:00Z' || "$utc" > '2026-10-27T04:00:00Z' || "$utc" == '2026-10-27T04:00:00Z' ]]; then
  printf '%s\n' 'STOP: outside approved window' >&2
  exit 1
fi
: "${A:?set administrative repository}" "${EXEC:?set exact-P execution root}" "${H:?set recorded full helper commit}"
rel=issues/open/AFLDB-ISSUE-316-readiness-prep-20261025
test "$(git -C "$EXEC" rev-parse HEAD)" = def676517da3955aa18db3606785463aac464188
for script in check-source.cjs check-preparation.cjs prepare-local.cjs refresh-manifest.cjs; do
  git -C "$A" show "$H:$rel/$script" | cmp -s - "$A/$rel/$script" || {
    printf '%s\n' 'STOP: helper bytes differ from H' >&2
    exit 1
  }
done
node "$A/$rel/check-source.cjs" --opening "$EXEC" --helper-commit "$H"
```

This yields only the source/helper gate, not the full opening preflight. Record
P, A and H separately, then establish the missing fresh DB/system/service identity
and host/native policy before censuses or dry run. Preserve any refusal. Never
bypass a guard. A substantive helper repair stays outside P, requires relevant
local checks and fresh read-only review, and is frozen as a new H before consuming
production observations. If that cannot safely finish within the window, STOP.

All 264 separately approved external data/manifests must be present and hash-match
before opening mode accepts the source gate. The 26 frozen package artifacts may
be staged only at their approved paths and bytes; they do not change tracked P
product code/configuration. Missing required CLI inputs still block the real
validators; this helper never substitutes for a genuine pre-apply gate.

The local `day-D-evidence/` directories named by `EVIDENCE-PLAN.json` are empty.
Do not populate them with early observations. Use a newly bound mode-700 Linux
evidence root for actual proof and retain its exact identity. The administrative
documentation descendant may collect resulting records afterward.

Follow the [approved readiness runbook](../AFLDB-ISSUE-316-dp-proposal-20261025/readiness/READINESS-RUNBOOK.md)
in order: fresh complete opening preflight; native policy/review; fresh read-only
three-target censuses; canonical/nightly check; then enforced dry run only.
The real opening record must additionally contain production DB/system identity,
current service identity/health and all required visibility/isolation evidence.
This source helper records those facts as **NOT OBSERVED**, not PASS.

Only actual observations completed within the window may support readiness. If
the proof cannot be completed reliably before 04:00 UTC, STOP. Documentation alone
may finish afterward if timestamps prove all observations occurred inside the
window and census age was at most six hours when dry run began. Do not rush,
regenerate D/P or weaken proof requirements. A complete PASS yields only
**READY FOR OWNER APPLY DECISION**. Return the full decision package and every
stop condition as PASS/NOT TRIGGERED. There is no automatic apply.

Structural gate CLOSED / ACCEPTED; U3 CONFIRMED; U4 Route B; Brownlow untouched.
Production NO-GO. No apply, seal/transition mutation, activation, deactivation,
deployment, rebuild or push is authorised.

The owner accepted the original 17 local PASS cases. Four added H-binding checks
bring the freeze validation to 21 PASS cases, preserving all original checks.
The first independent review
stopped for MED F-P001 (mutable administrative inventories); the bounded fix and
its six added checks are recorded in [review notes](REVIEW-NOTES.md). No accepted
artifact or production state was changed by this repair.
