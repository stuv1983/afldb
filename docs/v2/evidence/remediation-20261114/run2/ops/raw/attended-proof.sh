#!/bin/bash
# scope ops (remediation run 2): what `--attended` does and does not do, proved against deploy/release.mjs at the base checkout.
# Everything runs under a throw-away --root in this workspace with --no-live/--host-state fixtures; nothing touches a service,
# systemd, apt, a database, or a real release root. A non-TTY, stdin=/dev/null invocation stands for "a script or an agent".
set -u
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem2-ops-20261114
cd "$W/cand"
echo "HEAD $(git rev-parse HEAD) status=[$(git status --porcelain | wc -l)]"
R=$(mktemp -d "$W/out/attended-root.XXXXXX")
mkdir -p "$R/releases"
echo "root $R (empty releases dir; no release exists)"
snap() { (cd "$R" && find . | LC_ALL=C sort | sha256sum | cut -c1-16); }
before=$(snap); echo "tree-hash-before $before"

echo; echo "== 1. bare promote from a script (no TTY): refused before any lock, link or verification =="
node deploy/release.mjs promote nosuch-release --root "$R" --no-live < /dev/null; echo "exit=$?"
echo "== 2. bare rollback =="
node deploy/release.mjs rollback --root "$R" --no-live < /dev/null; echo "exit=$?"
echo "tree-hash-after-bare $(snap) (must equal $before)"

echo; echo "== 3. the same calls with --attended from the same non-TTY script: the attended check is passed =="
echo "   (they then stop at the NEXT check, because no such release exists here; the point is that the flag alone satisfies the gate)"
node deploy/release.mjs promote nosuch-release --attended --root "$R" --no-live < /dev/null; echo "exit=$?"
node deploy/release.mjs rollback --attended --root "$R" --no-live < /dev/null; echo "exit=$?"
echo "tree-hash-after-attended $(snap)"
echo "(a lock directory/file may appear and disappear: compare the listing)"; (cd "$R" && find . | LC_ALL=C sort)

echo; echo "== 4. flag value is not checked: --attended=anything, --attended false =="
node deploy/release.mjs promote nosuch-release --attended false --root "$R" --no-live < /dev/null; echo "exit=$? (parseArgs treats the flag as boolean)"
echo; echo "== 5. the refusal text (pinned by tests/deploy-release.test.ts) =="
node deploy/release.mjs promote x --root "$R" --no-live < /dev/null 2>&1 | grep -c -- "--attended"
rm -rf "$R"
echo; echo "done"
