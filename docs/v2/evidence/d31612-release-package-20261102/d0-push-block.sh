# D0 -- OWNER ONLY -- Windows Git Bash. Pushes the EXPLICIT revision H, never HEAD or a branch tip.
# Paste as one block. Any failed assertion stops it before the push; there is no PASS line unless every step held.
export MSYS_NO_PATHCONV=1
REMOTE=origin
R=a0b1080f5b98aee7191894c138be27bb524c7b1b
H=d00e07e37566e92b35a34e62a1ff03e173715e87
PROD_HEAD=924ff273261834e4112e3f41b61ceeab55427534
PKGD=docs/v2/evidence/d31612-release-package-20261102
GATE=$PKGD/first-night-gate.txt
( set -euo pipefail
  cd /d/dev/afldb
  [[ $R =~ ^[0-9a-f]{40}$ ]]; [[ $H =~ ^[0-9a-f]{40}$ ]]; [[ $PROD_HEAD =~ ^[0-9a-f]{40}$ ]]
  git cat-file -e "$R^{commit}"; git cat-file -e "$H^{commit}"; git cat-file -e "$PROD_HEAD^{commit}"
  # G0: the first-night result is recorded AND reviewed, and the decision is to proceed (a file only the reviewer writes)
  tr -d '\r' < "$GATE" | grep -qx 'FIRST-NIGHT-RECORD: reviewed'
  tr -d '\r' < "$GATE" | grep -qx 'RELEASE-DECISION: proceed'
  # H is exactly the qualified revision's descendant (docs only) -- the same pinned bytes production will run
  git show "$H:$PKGD/static-delta-check.sh" | bash -s -- "$H"
  git merge-base --is-ancestor "$PROD_HEAD" "$H"
  # nobody pushed since the preflight
  [ "$(git ls-remote "$REMOTE" refs/heads/main | cut -f1)" = "$PROD_HEAD" ]
  echo "local HEAD: $(git rev-parse HEAD)  (a different HEAD is fine: only H is pushed)"
  echo "pushing $(git rev-list --count "$PROD_HEAD..$H") commits, tip $H:"
  git log --oneline "$PROD_HEAD..$H"
  git push "$REMOTE" "$H:refs/heads/main"               # no --force: a non-fast-forward is rejected
  [ "$(git ls-remote "$REMOTE" refs/heads/main | cut -f1)" = "$H" ]
  echo "D0 PASS: $REMOTE/main = $H"
)
