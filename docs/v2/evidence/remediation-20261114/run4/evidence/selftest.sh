#!/usr/bin/env bash
# Self-test for run4/evidence/verify-manifests.sh. Builds throw-away git repos in a temp dir (no network, no host, no database) that
# reproduce the two defects of the run-2 checker and exercises every output class of the run-4 checker.
#
#   selftest.sh            (bash >= 4, git, sha256sum; runs on Git Bash on the workstation or on the DEV host)
#
# RED   = the run-2 script (run2/evidence/verify-manifests.sh, unchanged) gives the WRONG answer on a fixture;
# GREEN = the run-4 script gives the right one. Every assertion prints one line; the exit status is the number of failed assertions.
#   (a) cross-folder false positive: the manifest entry template-identity.txt is compared with an unrelated file of the same name in a
#       sibling folder -> run-2: false COMMITTED-MISMATCH (the real file is committed as template-identity.restored.txt).
#   (b) masked real mismatch: the file at the manifest's own path is ALTERED, a like-named file elsewhere has the recorded hash
#       -> run-2: false COMMITTED-OK.
# The host classes are exercised with EVIDENCE_LOCAL_HOST=1 (the remote command runs under `bash -c` on this machine, rooted in a temp
# dir allowed through EVIDENCE_HOST_ALLOW), so HOST-OK / HOST-MISMATCH / HOST-MISSING / DECLARED-NOT-RETAINED need no ssh.
set -u
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NEW=$SELF_DIR/verify-manifests.sh
OLD=$SELF_DIR/../../run2/evidence/verify-manifests.sh
BASE=docs/v2/evidence/remediation-20261114
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
TAB=$'\t'; FAIL=0; PASS=0
echo "selftest: bash $BASH_VERSION; $(git --version); $(uname -sm); new=$(sha256sum "$NEW" | cut -c1-16) old=$(sha256sum "$OLD" | cut -c1-16)"
[ -f "$OLD" ] || { echo "run-2 script not found at $OLD"; exit 99; }

newrepo() { R=$TMP/$1; rm -rf "$R"; mkdir -p "$R"; git -C "$R" init -q; git -C "$R" config user.email t@example.invalid; git -C "$R" config user.name selftest; git -C "$R" config core.autocrlf false; }
put() { local f="$R/$BASE/$1"; mkdir -p "$(dirname "$f")"; printf '%b' "$2" > "$f"; }
commit() { git -C "$R" add -A -f && git -C "$R" commit -q -m fixture; }
hof() { printf '%b' "$1" | sha256sum | cut -d' ' -f1; }
mapfile_new() { M=$TMP/map-$1.tsv; : > "$M"; }
maprow() { printf '%s\t%s\t%s\t%s\t%s\n' "$@" >> "$M"; }
# class of the manifest row whose entry (column 3) equals $2 in TSV $1
cls() { awk -F'\t' -v e="$2" '$1 !~ /^#/ && $3==e {print $1; exit}' "$1"; }
check() { # name got want
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok    %-62s %s\n' "$1" "$2"; else FAIL=$((FAIL+1)); printf '  FAIL  %-62s got [%s] want [%s]\n' "$1" "$2" "$3"; fi; }
run_old() { NO_HOST=1 bash "$OLD" "$R" HEAD > "$TMP/$1.tsv" 2> "$TMP/$1.err"; echo $? > "$TMP/$1.rc"; }
run_new() { local name=$1; shift; env "$@" bash "$NEW" "$R" HEAD > "$TMP/$name.tsv" 2> "$TMP/$name.err"; echo $? > "$TMP/$name.rc"; }
rc() { cat "$TMP/$1.rc"; }

echo "== (a) cross-folder false positive"
newrepo A
REAL='real identity\n'; OTHER='an unrelated identity of the same name\n'
put run3/integ/evidence/brownlow/retained-artefacts.SHA256SUMS "$(hof "$REAL")  template-identity.txt\n"
put run3/integ/evidence/brownlow/template-identity.restored.txt "$REAL"
put run3/integb/evidence/c1/template-identity.txt "$OTHER"
commit
run_old A-old
check "RED   run-2 script: entry template-identity.txt" "$(cls "$TMP/A-old.tsv" template-identity.txt)" COMMITTED-MISMATCH
check "RED   run-2 script: exit status (1 = it reports a mismatch)" "$(rc A-old)" 1
run_new A-nomap EVIDENCE_MAP=/nonexistent NO_HOST=1
check "GREEN run-4 script, no map: no cross-folder comparison" "$(cls "$TMP/A-nomap.tsv" template-identity.txt)" UNRESOLVED
check "GREEN run-4 script, no map: exit status 0" "$(rc A-nomap)" 0
mapfile_new A
maprow alias run3/integ/evidence/brownlow/retained-artefacts.SHA256SUMS template-identity.txt run3/integ/evidence/brownlow/template-identity.restored.txt "README line that documents the rename"
run_new A-map EVIDENCE_MAP=$M NO_HOST=1
check "GREEN run-4 script, alias map: entry template-identity.txt" "$(cls "$TMP/A-map.tsv" template-identity.txt)" COMMITTED-OK-ALIAS
check "GREEN run-4 script, alias map: exit status 0" "$(rc A-map)" 0
# a wrong alias must not pass
newrepo A2
put run3/x/SHA256SUMS "$(hof "$REAL")  t.txt\n"; put run3/x/t.other.txt "$OTHER"; put run3/y/t.txt "$REAL"; commit
mapfile_new A2; maprow alias run3/x/SHA256SUMS t.txt run3/x/t.other.txt "deliberately wrong alias"
run_new A2-map EVIDENCE_MAP=$M NO_HOST=1
check "GREEN wrong alias target is COMMITTED-MISMATCH (a like-named correct file in run3/y is NOT used)" "$(cls "$TMP/A2-map.tsv" t.txt)" COMMITTED-MISMATCH
check "GREEN wrong alias: exit status 1" "$(rc A2-map)" 1

echo "== (b) masked real mismatch"
newrepo B
GOOD='good bytes\n'
put run3/a/SHA256SUMS "$(hof "$GOOD")  data.txt\n"
put run3/a/data.txt 'ALTERED bytes\n'
put run3/b/data.txt "$GOOD"
commit
run_old B-old
check "RED   run-2 script: altered run3/a/data.txt is reported" "$(cls "$TMP/B-old.tsv" data.txt)" COMMITTED-OK
check "RED   run-2 script: exit status 0 (the corruption is hidden)" "$(rc B-old)" 0
run_new B-new EVIDENCE_MAP=/nonexistent NO_HOST=1
check "GREEN run-4 script: altered file at the manifest's own path" "$(cls "$TMP/B-new.tsv" data.txt)" COMMITTED-MISMATCH
check "GREEN run-4 script: exit status 1" "$(rc B-new)" 1

echo "== AMBIGUOUS, transform, discovery, empty manifest"
newrepo C
put run3/c/SHA256SUMS "$(hof "$GOOD")  x.txt\n"; put run3/c/x.txt "$GOOD"; put run3/d/x.txt "$GOOD"; commit
mapfile_new C; maprow croot run3/c/SHA256SUMS @ - "own dir"; maprow croot run3/c/SHA256SUMS run3/d - "second declared root"
run_new C-new EVIDENCE_MAP=$M NO_HOST=1
check "GREEN two existing candidates for one entry" "$(cls "$TMP/C-new.tsv" x.txt)" AMBIGUOUS
check "GREEN AMBIGUOUS exit status 1" "$(rc C-new)" 1
newrepo D
ORIG=$(printf '\357\273\277line one\r\nline two\r\n' | sha256sum | cut -d' ' -f1)
put run3/o/SHA256SUMS "$ORIG  with-rule.txt\n$ORIG  no-rule.txt\n"; put run3/o/with-rule.txt 'line one\nline two\n'; put run3/o/no-rule.txt 'line one\nline two\n'
put run3/e/SHA256SUMS "# only a comment\n"; commit
mapfile_new D; maprow xform run3/o/SHA256SUMS with-rule.txt bom-crlf "documented LF/BOM-stripped copy"
run_new D-new EVIDENCE_MAP=$M NO_HOST=1
check "GREEN bom-crlf transform with a map rule" "$(cls "$TMP/D-new.tsv" with-rule.txt)" COMMITTED-OK-ALIAS
check "GREEN same bytes without a rule are a mismatch" "$(cls "$TMP/D-new.tsv" no-rule.txt)" COMMITTED-MISMATCH
check "GREEN manifest without entries is reported, not skipped" "$(cls "$TMP/D-new.tsv" '(manifest)')" UNRESOLVED
newrepo E
put run4/zz/SHA256SUMS "$(hof "$GOOD")  f.txt\n"; put run4/zz/f.txt "$GOOD"
put run4/zz/HOST-SHA256SUMS "$(hof "$GOOD")  $TMP/host/zz/h.txt\n"; commit
mkdir -p "$TMP/host/zz"; printf '%b' "$GOOD" > "$TMP/host/zz/h.txt"
run_new E-new EVIDENCE_MAP=/nonexistent EVIDENCE_LOCAL_HOST=1 EVIDENCE_HOST_ALLOW="$TMP/host/"
check "GREEN run-4 manifest SHA256SUMS discovered with no map row (committed, relative)" "$(cls "$TMP/E-new.tsv" f.txt)" COMMITTED-OK
check "GREEN run-4 manifest HOST-SHA256SUMS discovered (absolute host path)" "$(cls "$TMP/E-new.tsv" "$TMP/host/zz/h.txt")" HOST-OK
check "GREEN discovery: exit status 0" "$(rc E-new)" 0

echo "== host classes through the local stub"
newrepo H
HR=$TMP/host/root; mkdir -p "$HR"; printf '%b' "$GOOD" > "$HR/ok.txt"; printf 'drifted\n' > "$HR/bad.txt"; printf 'NEW r2 bytes\n' > "$HR/sup.txt"
put run3/h/SHA256SUMS "$(hof "$GOOD")  ok.txt\n$(hof "$GOOD")  bad.txt\n$(hof "$GOOD")  gone.txt\n$(hof "$GOOD")  ret/x.txt\n$(hof 'old r1 bytes\n')  sup.txt\n$(hof "$GOOD")  /mnt/ssd/afldb-i316-rb-I-20261023T0905Z/secret\n$(hof "$GOOD")  /etc/passwd\n"
put run3/h/SUCC "$(hof 'NEW r2 bytes\n')  sup.txt\n"
put run3/n/SHA256SUMS "$(hof "$GOOD")  nowhere.txt\n"
commit
mapfile_new H
maprow croot run3/h/SHA256SUMS - - "host files"; maprow hroot run3/h/SHA256SUMS "$HR" - "host root"
maprow notret run3/h/SHA256SUMS ret/ - "README says not retained"
maprow include run3/h/SUCC - - "successor list"; maprow croot run3/h/SUCC - - "host files"; maprow hroot run3/h/SUCC "$HR" - "host root"
maprow super run3/h/SHA256SUMS sup.txt run3/h/SUCC:sup.txt "superseded"
run_new H-new EVIDENCE_MAP=$M EVIDENCE_LOCAL_HOST=1 EVIDENCE_HOST_ALLOW="$TMP/host/"
check "GREEN host file equal" "$(cls "$TMP/H-new.tsv" ok.txt)" HOST-OK
check "GREEN host file differs" "$(cls "$TMP/H-new.tsv" bad.txt)" HOST-MISMATCH
check "GREEN host file absent, directory present" "$(cls "$TMP/H-new.tsv" gone.txt)" HOST-MISSING
check "GREEN host file absent, declared not retained (notret)" "$(cls "$TMP/H-new.tsv" ret/x.txt)" DECLARED-NOT-RETAINED
check "GREEN superseded hash, host equals the successor's hash" "$(cls "$TMP/H-new.tsv" sup.txt)" DECLARED-NOT-RETAINED
check "GREEN RB-1 path is never read" "$(cls "$TMP/H-new.tsv" /mnt/ssd/afldb-i316-rb-I-20261023T0905Z/secret)" UNRESOLVED
check "GREEN path outside the allow-list is never read" "$(cls "$TMP/H-new.tsv" /etc/passwd)" UNRESOLVED
check "GREEN manifest with no host root declared is UNRESOLVED, not guessed" "$(cls "$TMP/H-new.tsv" nowhere.txt)" UNRESOLVED
check "GREEN HOST-MISMATCH makes the exit status 1" "$(rc H-new)" 1
# an exact-path committed copy decides even when a host file would match
newrepo K
put run3/k/SHA256SUMS "$(hof "$GOOD")  m.txt\n"; put run3/k/m.txt 'ALTERED\n'; commit
mkdir -p "$TMP/host/k"; printf '%b' "$GOOD" > "$TMP/host/k/m.txt"
mapfile_new K; maprow hroot run3/k/SHA256SUMS "$TMP/host/k" - "host root"
run_new K-new EVIDENCE_MAP=$M EVIDENCE_LOCAL_HOST=1 EVIDENCE_HOST_ALLOW="$TMP/host/"
check "GREEN committed mismatch is not rescued by a matching host file" "$(cls "$TMP/K-new.tsv" m.txt)" COMMITTED-MISMATCH
echo "== NO_HOST=1"
R=$TMP/H; mapfile_new H2; cp "$TMP/map-H.tsv" "$M"   # same map, repo H
run_new H-nohost EVIDENCE_MAP=$M NO_HOST=1
check "GREEN NO_HOST=1: host-tier entries are UNRESOLVED (never reported OK)" "$(cls "$TMP/H-nohost.tsv" ok.txt)" UNRESOLVED
check "GREEN NO_HOST=1: exit status does not claim a mismatch it did not see" "$(rc H-nohost)" 0
# internal consistency: one row per entry in every run above
bad=0; for f in "$TMP"/*-new.tsv "$TMP"/*-nomap.tsv "$TMP"/*-map.tsv; do [ -f "$f" ] || continue
  e=$(grep -E '^# manifests=' "$f" | sed -E 's/.* entries=([0-9]+) manifest-rows=([0-9]+).*/\1 \2/'); set -- $e
  n=$(grep -vc '^#' <(awk -F'\t' '$1 !~ /^(#|INFO-)/' "$f") ); [ "$n" -ge "$1" ] || bad=$((bad+1)); done
check "GREEN every fixture run reports at least one row per entry" "$bad" 0

echo "selftest: $PASS passed, $FAIL failed"
exit "$FAIL"
