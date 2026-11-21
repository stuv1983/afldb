#!/usr/bin/env bash
# Sitting A1, block P2: fast-forward the serving checkout to the candidate CAND = 7d92042f EXACTLY (never to origin/main, which
# is 731a5025 and carries DraftGuru/tier-P tool changes that are not part of this release). PRODUCTION, as arm.
# Writes: the checkout only (ff). Does not touch the running site, the release links or the database.
# Why the fast-forward is needed although `release.mjs build` extracts by `git archive <revision>` and needs neither HEAD nor a
# clean tree (deploy/release.mjs:960-964, :984-1003, :1005-1074): acceptance runs tools/maintenance/revalidate-season.ts and
# deploy/post-install-check.sh FROM THE CHECKOUT, and revalidate-season.ts changed in c8d4202a..7d92042f.
# STOP conditions (all before any change):
#   origin/main != PREP (731a5025); CAND not an ancestor of PREP; start HEAD not c8d4202a (or CAND on a re-run); not clean;
#   the c8d4202a..CAND raw delta (153 paths, every blob) != the reviewed sha256; the non-records part (13 paths) != reviewed;
#   any migration, dependency, Next config, unit or supervisor change; cf158d60..CAND touches a non-records path; the
#   executable tree of CAND (ls-tree minus docs/, documentation/, issues/, root *.md) != that of cf158d60 (the tested tree).
# Run: tr -d '\r' < a1-p2-ff.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- 731a502540ab3a9d8795e185fbad89e02534b2b7
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
H_SERVE=c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76; CAND=7d92042fd11010eaa20966e2f49ae7a93e286568; TESTED=cf158d602242a3e7bbf899b951e8423c0d3521e6
DELTA=b93a294a785fb64a5bf5985783c11b3c4d51aafdfd87b1d885dcf094bb0b91e3      # c8d4202a..CAND --raw, 153 paths
DELTA_EXEC=fe9285f631b8f377cd5b21790f5f143c7a396d1c2111edccc667ddec4c447dee # its 13 non-records lines
TREE_EXEC=a18ccac459dc5cbf335f3ca8df1e562885701febd24f1c48d4cc1147ea30e789  # ls-tree -r minus records, equal for CAND and TESTED
REC='^(docs/|documentation/|issues/|[^/]+[.]md$)'
PREP=${1:?PREP}; [[ $PREP =~ ^[0-9a-f]{40}$ ]]
echo "== A1 P2 $(date -u +%FT%TZ)"
HEAD0=$(git rev-parse HEAD)
[ "$HEAD0" = "$H_SERVE" ] || [ "$HEAD0" = "$CAND" ] || { echo "STOP start HEAD $HEAD0 is neither c8d4202a nor CAND"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = main ]
[ -z "$(git status --porcelain)" ]; echo "PASS start state $HEAD0 on main, clean"
git fetch origin
OM=$(git rev-parse refs/remotes/origin/main); echo "origin/main = $OM"
[ "$OM" = "$PREP" ] || { echo "STOP unexpected remote drift: origin/main is $OM, the approved pin is $PREP"; exit 1; }
git cat-file -e "$CAND^{commit}"; git cat-file -e "$TESTED^{commit}"
git merge-base --is-ancestor "$CAND" "$PREP"; echo "PASS CAND is an ancestor of origin/main"
git merge-base --is-ancestor "$HEAD0" "$CAND"; echo "PASS start HEAD is an ancestor of (or equal to) CAND: fast-forward possible"
git merge-base --is-ancestor "$TESTED" "$CAND"; echo "PASS tested cf158d60 is an ancestor of CAND"
D=$(git -c core.quotepath=true diff --raw --no-abbrev --no-renames "$H_SERVE" "$CAND")
[ "$(printf '%s\n' "$D" | sha256sum | cut -d' ' -f1)" = "$DELTA" ]; echo "PASS c8d4202a..CAND raw delta = reviewed $DELTA ($(printf '%s\n' "$D" | wc -l) paths)"
[ "$(printf '%s\n' "$D" | awk -F'\t' -v r="$REC" '$2 !~ r' | sha256sum | cut -d' ' -f1)" = "$DELTA_EXEC" ]
echo "PASS non-records part = reviewed $DELTA_EXEC:"; printf '%s\n' "$D" | awk -F'\t' -v r="$REC" '$2 !~ r {print "  " $2}'
[ -z "$(git diff --name-only "$H_SERVE" "$CAND" -- src/db/migrations package.json package-lock.json next.config.ts deploy/afldb.service deploy/server-cluster.mjs)" ]
echo "PASS no migration, dependency, Next config, unit or supervisor change"
[ -z "$(git diff --name-only --no-renames "$TESTED" "$CAND" | awk -v r="$REC" '$0 !~ r')" ]; echo "PASS cf158d60..CAND records-only ($(git diff --name-only "$TESTED" "$CAND" | wc -l) paths)"
TC=$(git ls-tree -r "$CAND" | awk -F'\t' -v r="$REC" '$2 !~ r' | sha256sum | cut -d' ' -f1)
TT=$(git ls-tree -r "$TESTED" | awk -F'\t' -v r="$REC" '$2 !~ r' | sha256sum | cut -d' ' -f1)
[ "$TC" = "$TT" ] && [ "$TC" = "$TREE_EXEC" ]; echo "PASS executable tree CAND = cf158d60 = $TREE_EXEC"
if [ "$HEAD0" != "$CAND" ]; then git merge --ff-only "$CAND"; else echo "NOTE start HEAD already CAND (re-run): no merge"; fi
[ "$(git rev-parse HEAD)" = "$CAND" ]; [ -z "$(git status --porcelain)" ]; echo "PASS HEAD = $(git rev-parse HEAD), porcelain empty"
for f in deploy/afldb-settle-failure-status.sh deploy/Caddyfile.production deploy/host-policy/needrestart-afldb-hold.conf deploy/host-policy/apt-52-afldb-unattended.conf; do sha256sum "$f"; done
"$N" deploy/release.mjs status
"$N" deploy/release.mjs check-node-modules --checkout "$CHK" || echo "RECORD check-node-modules exit=$? (record; not a stop)"
echo "P2 RESULT PASS"
}
main "$@" < /dev/null
