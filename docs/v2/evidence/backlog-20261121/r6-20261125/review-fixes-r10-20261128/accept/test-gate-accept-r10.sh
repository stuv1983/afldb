#!/usr/bin/env bash
# test-gate-accept-r10.sh (R6 r10, 28 Nov 2026): r9's test-gate-accept.sh run against the r10 checker
# ../../review-fixes-r9-20261128/accept/afldb-gate-accept.sh, with evidence under ./evidence/ (r9's evidence is kept unchanged).
# r10 changes: (1) every DERIVED fixture also gets the r10 access epoch (an "ACCESS-EPOCH <hex>" line after BOOT-ID, and
# access-epoch=<hex> on each production RESULT line; REAL inputs are unchanged), so r9's cases keep their r9 meaning; (2) every
# production release-g0 case also fails "pin" (no --pin-rev); (3) new cases e1-e9 (access epoch, Astra case 3) and g1-g8 (the pin of
# a reviewed revision, Astra case 2) in a scratch git repository holding a byte-identical copy of the checker.
# r9 text follows.
# test-gate-accept.sh (R6 r9): exercises afldb-gate-accept.sh on saved outputs. Local only (Git Bash or Linux); contacts no host.
#   bash test-gate-accept.sh
# REAL inputs are cut, unchanged, from rehearsal logs of disposable containers on streamanator (28 Nov 2026):
#   procedure run t12e46305 (r8 OWNER-PROCEDURE rehearsal at 12e46305) and verify-harness run tf8a63bb3 (same pinned bundle 58fceba6...).
# REAL r9 wrapper inputs (agent A, run r9oq2, 28 Nov 2026, bundle 3ea41209...) are cut, unchanged, from ../offhost/evidence/dev/r9oq2-*.log:
#   scenario a (FIXTURE-qualified G0 PASS), j (version: both PASS under the fixture qualification, then unqualified), k (unqualified
#   G0 STOP), c (A2 STOP attributed). They cannot give GO verbatim with the t12e46305 Phase 4 outputs: their bundle is not the one
#   4.5 re-verified, and A ran its G0 (g0a-at 07:16:16Z) BEFORE its version call (07:18:01Z). Cases r1-r4 record that; r5/r6 use
#   them with only those two facts edited.
# FIXTURE inputs are derived from REAL ones by the edit named on their first line ("[FIXTURE r9] ..."). They exist because no
# rehearsal made a version call or a gate call AFTER its Phase 4, and no rehearsal produced an A2 PASS (the fixture host is not
# in A-2's expected state). The checker refuses any input with a "[FIXTURE r9]" line, so the committed fixtures cannot reach a
# decision: cases use UNMARKED copies made at run time under evidence/unmarked/ (deleted on exit, never committed), and the
# production-path cases also shift every time to this run's clock (production has no --now). Writes evidence/inputs/*,
# evidence/<case>.out and evidence/summary.txt; exit 0 only if every case gives its expected result.
set -uo pipefail; export LC_ALL=C
HERE=$(cd "$(dirname "$0")" && pwd); R=$(cd "$HERE/../.." && pwd); EV=$HERE/evidence; IN=$EV/inputs
CHK=$R/review-fixes-r9-20261128/accept/afldb-gate-accept.sh
H=$R/review-fixes-r8-20261128/procedure-harness/logs; P=t12e46305; V=$R/review-fixes-r8-20261128/runs-f8a63bb3/verify; Q=tf8a63bb3
rm -rf "$IN"; mkdir -p "$IN"; rm -f "$EV"/*.out "$EV/summary.txt"
# from the first line matching $1 through the first later line matching $2 ($4 = last: start at the LAST match of $1)
cut_() { awk -v s="$1" -v e="$2" -v last="${4:-}" 'NR==FNR { if ($0 ~ s) { n=FNR; if (!first) first=FNR } next }
  FNR >= (last ? n : first) && (last ? n : first) { print; if ($0 ~ e) exit }' "$3" "$3"; }
fx() { printf '[FIXTURE r9] %s\n' "$1"; }

# ---- REAL inputs
cut_ '^== afldb-owner-checks' '^OWNER CHECKS RESULT' "$H/$P-install.log" > "$IN/real-oc-3.12-blocked.txt"
cut_ '^== afldb-owner-checks' '^OWNER CHECKS RESULT' "$H/$P-login-2-reverify.log" > "$IN/real-oc-4.4-pass.txt"
{ cut_ '^== verify-backup-install [0-9]' '^BACKUP INSTALL RESULT ' "$H/$P-install.log"
  cut_ '^== verify-backup-install --as-arm' '^BACKUP INSTALL RESULT ' "$H/$P-install.log"
  cut_ '^== verify-verify-install' '^VERIFY-INSTALL RESULT' "$H/$P-install.log" last; } > "$IN/real-reverify-3.5-3.6-3.11-pre-phase4.txt"
cut_ '^== verify-backup-install [0-9]' '^VERIFY-INSTALL RESULT' "$H/$P-login-2-reverify.log" | grep -v '^R8P ' > "$IN/real-reverify-4.5-post-phase4.txt"
cut_ '^== afldb-verify-call' '^OWNER VERDICT VERSION .*host=streamanator' "$H/$P-wrapper-version.log" > "$IN/real-version-3.13-pre-phase4.txt"
cut_ '^== afldb-verify-call' '^OWNER VERDICT VERSION PASS .*role=offhost' "$V/$Q-j-version-exit.log" > "$IN/real-version-both-pass.txt"
cut_ '^== afldb-verify-call' '^OWNER VERDICT G0 ' "$V/$Q-a-g0-success.log" > "$IN/real-g0-pass.txt"
cut_ '^== afldb-verify-call' '^OWNER VERDICT A2 ' "$V/$Q-c-a2-whole.log" > "$IN/real-a2-stop-attributed.txt"
A9=$R/review-fixes-r9-20261128/offhost/evidence/dev; A=r9oq2
cut_ '^== afldb-verify-call' '^OWNER VERDICT VERSION PASS .*role=offhost' "$A9/$A-j-version-exit.log" > "$IN/real-r9-version-fixture-qualified.txt"
cut_ '^== afldb-verify-call' '^OWNER VERDICT VERSION STOP .*role=offhost' "$A9/$A-j-version-exit.log" last > "$IN/real-r9-version-unqualified.txt"
cut_ '^== afldb-verify-call' '^OWNER VERDICT G0 ' "$A9/$A-a-g0-success.log" > "$IN/real-r9-g0-pass-fixture-qualified.txt"
cut_ '^== afldb-verify-call' '^OWNER VERDICT G0 ' "$A9/$A-k-offhost-qualification.log" > "$IN/real-r9-g0-stop-unqualified.txt"
cut_ '^== afldb-verify-call' '^OWNER VERDICT A2 ' "$A9/$A-c-a2-whole.log" > "$IN/real-r9-a2-stop-attributed.txt"

# ---- FIXTURE inputs (each derived from a REAL one)
# The r9 wrapper (agent A, worktree text of 28 Nov) appends "qualification=<none|pinned|FIXTURE> qual-sha256=<sha|none>" to every
# VERSION and G0 verdict line, names the qualified off-host endpoint (host=<H>, G0 "offhost=<H>"), and prints the off-host line
# 'OWNER VERDICT VERSION STOP ... host=none role=offhost reason="no qualified off-host endpoint" ...' when none is qualified. The
# REAL transcripts are r8 wrapper output, so the fixtures below add those fields; FQ and the host r9-fixture-offhost are fixtures.
FQ=$(printf 'r9 accept fixture qualification pin\n' | sha256sum | cut -c1-64); FH=r9-fixture-offhost
{ fx "real-version-both-pass.txt with every T05:00: time moved to T05:23: (after the 4.4/4.5 outputs), the off-host host renamed $FH and the r9 qualification fields (FIXTURE, $FQ) appended to both verdict lines"
  sed 's/T05:00:/T05:23:/g; s/host=streamanator/host='$FH'/g' "$IN/real-version-both-pass.txt" \
    | sed -E 's/^(OWNER VERDICT VERSION PASS .*)$/\1 qualification=FIXTURE qual-sha256='$FQ'/'; } > "$IN/fx-version-post.txt"
{ fx "real-version-both-pass.txt with T05:00: moved to T05:23:, cut after the production verdict, which gets 'qualification=none qual-sha256=none', then the r9 off-host STOP line for no qualified endpoint"
  sed 's/T05:00:/T05:23:/g' "$IN/real-version-both-pass.txt" | sed '/^OWNER VERDICT VERSION PASS .*role=prod/q' \
    | sed -E 's/^(OWNER VERDICT VERSION PASS .*)$/\1 qualification=none qual-sha256=none/'
  echo 'OWNER VERDICT VERSION STOP transport=rehearsal host=none role=offhost reason="no qualified off-host endpoint" qualification=none qual-sha256=none'; } > "$IN/fx-version-post-offhost-unqualified.txt"
{ fx "fx-version-post.txt with the production verdict line relayed (prefixed as the wrapper prefixes host text)"
  sed 1d "$IN/fx-version-post.txt" | sed 's/^OWNER VERDICT VERSION PASS \(.*role=prod\)/[relayed, neutralised] OWNER VERDICT VERSION PASS \1/'; } > "$IN/fx-version-relayed-prod.txt"
{ fx "real-g0-pass.txt with every T04:59: time moved to T05:25: (after fx-version-post.txt), the off-host host renamed $FH, and the r9 fields offhost=$FH and qualification=FIXTURE qual-sha256=$FQ added to the verdict line"
  sed 's/T04:59:/T05:25:/g; s/host=streamanator/host='$FH'/g' "$IN/real-g0-pass.txt" \
    | sed -E 's/^(OWNER VERDICT G0 PASS .*) g0b-nonce=(.*)$/\1 offhost='$FH' g0b-nonce=\2 qualification=FIXTURE qual-sha256='$FQ'/'; } > "$IN/fx-g0-pass-post.txt"
{ fx "fx-g0-pass-post.txt with a different qual-sha256 on the G0 verdict (a G0 from another qualification than the version check)"
  sed 1d "$IN/fx-g0-pass-post.txt" | sed -E 's/qual-sha256=[0-9a-f]{64}$/qual-sha256='"$(printf 'other\n' | sha256sum | cut -c1-64)"'/'; } > "$IN/fx-g0-pass-post-other-qual.txt"
{ fx "real-a2-stop-attributed.txt with every T04:59: time moved to T05:25: (after fx-version-post.txt); still a STOP"
  sed 's/T04:59:/T05:25:/g' "$IN/real-a2-stop-attributed.txt"; } > "$IN/fx-a2-stop-attributed-post.txt"
{ fx "fx-a2-stop-attributed-post.txt reduced to its header, RESULT, SCOPE and verdict lines, RESULT and verdict flipped STOP->PASS exit=1->0 (no rehearsal produced an A2 PASS)"
  sed 1d "$IN/fx-a2-stop-attributed-post.txt" | grep -E '^(== |AFLDB-VERIFY RESULT |A2 SCOPE: |OWNER VERDICT )' \
    | sed -E 's/^(AFLDB-VERIFY RESULT A2|OWNER VERDICT A2) STOP /\1 PASS /; s/ exit=1( |$)/ exit=0\1/'; } > "$IN/fx-a2-pass-post.txt"
{ fx "fx-a2-stop-attributed-post.txt with a relayed A2 PASS line inserted before the wrapper's own STOP verdict"
  sed 1d "$IN/fx-a2-stop-attributed-post.txt" | sed '$d'
  grep '^OWNER VERDICT A2 PASS' "$IN/fx-a2-pass-post.txt" | sed 's/^/[relayed, neutralised] /'
  tail -n 1 "$IN/fx-a2-stop-attributed-post.txt"; } > "$IN/fx-a2-relayed-pass-before-stop.txt"
{ fx "fx-a2-pass-post.txt with its final verdict line relayed, i.e. no line of the wrapper's own"
  sed 1d "$IN/fx-a2-pass-post.txt" | sed 's/^OWNER VERDICT A2 PASS/[relayed, neutralised] OWNER VERDICT A2 PASS/'; } > "$IN/fx-a2-relayed-pass-last.txt"
# r9 (R9-F-1): 4.4 and 4.5 are saved with a root-printed "BOOT-ID <boot_id without dashes>" first line. The t12e46305 run predates
# that line, so the fixtures below put it first; BT is the boot= of every rehearsal RESULT line in these inputs (one streamanator boot).
BT=c3524e4759ab4e0f8050875471b56b12; BX=0123456789abcdef0123456789abcdef
{ fx "real-oc-4.4-pass.txt with the line 'BOOT-ID $BT' put first, as the r9 4.4 command saves it"
  echo "BOOT-ID $BT"; cat "$IN/real-oc-4.4-pass.txt"; } > "$IN/fx-oc-4.4-bootid.txt"
{ fx "real-reverify-4.5-post-phase4.txt with the line 'BOOT-ID $BT' put first, as the r9 4.5 command saves it"
  echo "BOOT-ID $BT"; cat "$IN/real-reverify-4.5-post-phase4.txt"; } > "$IN/fx-reverify-4.5-bootid.txt"
{ fx "real-oc-4.4-pass.txt with the line 'BOOT-ID $BX' put first (owner checks from another boot, or another host)"
  echo "BOOT-ID $BX"; cat "$IN/real-oc-4.4-pass.txt"; } > "$IN/fx-oc-4.4-bootid-other.txt"
{ fx "fx-reverify-4.5-bootid.txt with the --as-arm part (its header through its result line) deleted"
  sed 1d "$IN/fx-reverify-4.5-bootid.txt" | sed '/^== verify-backup-install --as-arm/,/^BACKUP INSTALL RESULT /d'; } > "$IN/fx-reverify-no-as-arm.txt"
{ fx "fx-oc-4.4-bootid.txt with its header time moved to 2026-11-28T05:24:30Z (after fx-version-post.txt)"
  sed 1d "$IN/fx-oc-4.4-bootid.txt" | sed -E 's/^(== afldb-owner-checks \(R6 r8\) )[^ ]+/\12026-11-28T05:24:30Z/'; } > "$IN/fx-oc-pass-late.txt"
{ fx "'BOOT-ID $BT', then real-oc-3.12-blocked.txt, then real-oc-4.4-pass.txt (two runs in one file)"
  echo "BOOT-ID $BT"; cat "$IN/real-oc-3.12-blocked.txt" "$IN/real-oc-4.4-pass.txt"; } > "$IN/fx-oc-two-runs.txt"
{ fx "fx-oc-4.4-bootid.txt without its last line (the result line)"
  sed 1d "$IN/fx-oc-4.4-bootid.txt" | sed '$d'; } > "$IN/fx-oc-no-result.txt"
{ fx "fx-g0-pass-post.txt with every T05:25: time moved to T08:25: (more than 3 h after the 4.4 owner checks of 05:21:46Z)"
  sed 1d "$IN/fx-g0-pass-post.txt" | sed 's/T05:25:/T08:25:/g'; } > "$IN/fx-g0-pass-post-late.txt"
{ fx "fx-g0-pass-post.txt with boot $BX on the G0a RESULT line and as g0a-boot= on the verdict (a G0 from another production boot)"
  sed 1d "$IN/fx-g0-pass-post.txt" | sed -E '/^AFLDB-VERIFY RESULT G0 PASS /s/ boot=[0-9a-f]{32} / boot='$BX' /; /^OWNER VERDICT G0 PASS /s/ g0a-boot=[0-9a-f]{32} / g0a-boot='$BX' /'; } > "$IN/fx-g0-pass-post-other-boot.txt"
{ fx "fx-oc-4.4-bootid.txt with its header time moved 4 h back, to 2026-11-28T01:21:46Z (stale owner checks, fresh 4.5 and verdict)"
  sed 1d "$IN/fx-oc-4.4-bootid.txt" | sed -E 's/^(== afldb-owner-checks \(R6 r8\) )[^ ]+/\12026-11-28T01:21:46Z/'; } > "$IN/fx-oc-4.4-stale.txt"
{ fx "fx-reverify-4.5-bootid.txt with every 2026-11-28T05:21: time moved 4 h back, to 2026-11-28T01:21: (stale 4.5, fresh owner checks and verdict)"
  sed 1d "$IN/fx-reverify-4.5-bootid.txt" | sed 's/2026-11-28T05:21:/2026-11-28T01:21:/g'; } > "$IN/fx-reverify-4.5-stale.txt"
# r9: A's REAL r9oq2 transcripts with ONLY the two facts that block GO edited: the bundle, and the version call's time
AB=3ea412092a3b024bd6520d9106694f874e45335974b6be96a85083ffac2ecb95; TB=58fceba650dcd25ede0e55b25bfcb8a8236c3a4fe6ae6ebd94535832bbd506c8
{ fx "real-r9-version-fixture-qualified.txt with bundle $AB replaced by the 4.5 re-verified $TB and every 2026-11-28T07: time moved to 2026-11-28T06: (after 4.4/4.5, before A's G0); no other change"
  sed "s/$AB/$TB/g; s/2026-11-28T07:/2026-11-28T06:/g" "$IN/real-r9-version-fixture-qualified.txt"; } > "$IN/fx-r9-version.txt"
{ fx "real-r9-version-unqualified.txt with the same two edits (bundle, 07: to 06:)"
  sed "s/$AB/$TB/g; s/2026-11-28T07:/2026-11-28T06:/g" "$IN/real-r9-version-unqualified.txt"; } > "$IN/fx-r9-version-unqualified.txt"
{ fx "real-r9-g0-pass-fixture-qualified.txt with bundle $AB replaced by $TB; times unchanged"
  sed "s/$AB/$TB/g" "$IN/real-r9-g0-pass-fixture-qualified.txt"; } > "$IN/fx-r9-g0-pass.txt"
{ fx "real-r9-g0-stop-unqualified.txt with bundle $AB replaced by $TB; times unchanged"
  sed "s/$AB/$TB/g" "$IN/real-r9-g0-stop-unqualified.txt"; } > "$IN/fx-r9-g0-stop-unqualified.txt"
for f in fx-version-post fx-g0-pass-post; do
  { fx "$f.txt with every 2026-11-28T time moved two days on, to 2026-11-30T (a gate two days after the Phase 4 evidence)"
    sed 1d "$IN/$f.txt" | sed "s/2026-11-28T/2026-11-30T/g"; } > "$IN/$f-2days.txt"
done
for f in fx-version-post fx-version-post-offhost-unqualified fx-g0-pass-post fx-a2-pass-post; do
  { fx "$f.txt with transport=rehearsal rewritten to transport=production and qualification=FIXTURE to pinned (exercises the production path)"
    sed 1d "$IN/$f.txt" | sed 's/transport=rehearsal/transport=production/g; s/qualification=FIXTURE/qualification=pinned/g'; } > "$IN/$f-prod.txt"
done

for f in fx-version-post-prod fx-g0-pass-post-prod; do
  { fx "$f.txt with transport=production rewritten to transport=production-stub (a stubbed ssh, R9-F-3): never production"
    sed 1d "$IN/$f.txt" | sed 's/transport=production/transport=production-stub/g'; } > "$IN/${f%-prod}-stub.txt"
done

# ---- r10: the access epoch on every DERIVED fixture (REAL inputs are left as recorded)
AE=5d1e0c2b9a8f7e6d5c4b3a2918070605; AO=0f1e2d3c4b5a69788796a5b4c3d2e1f0   # AE: the epoch of the fixtures; AO: an epoch before a change
for f in "$IN"/fx-*.txt; do
  awk -v ae="$AE" 'NR==1 { print $0 " [+r10: ACCESS-EPOCH " ae " after the BOOT-ID line; access-epoch=" ae " on each production RESULT line]"; next }
    /^AFLDB-VERIFY RESULT [A-Z0-9]+ [A-Z]+ nonce=[0-9a-f]+ host=afldb-prod / && !/ access-epoch=/ { print $0 " access-epoch=" ae; next }
    { print } /^BOOT-ID [0-9a-f]+$/ && !d { print "ACCESS-EPOCH " ae; d = 1 }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
fx10() { printf '[FIXTURE r9] [r10] %s\n' "$1"; }
for f in fx-oc-4.4-bootid fx-reverify-4.5-bootid; do
  { fx10 "$f.txt with ACCESS-EPOCH $AO: saved BEFORE a same-boot access change (afldb-phase4.sh backout or invalidate wrote $AE after it)"
    sed 1d "$IN/$f.txt" | sed "s/^ACCESS-EPOCH $AE\$/ACCESS-EPOCH $AO/"; } > "$IN/$f-epoch-before.txt"
  { fx10 "$f.txt with ACCESS-EPOCH none (the host has no recorded access state: no afldb-phase4.sh change ever ran)"
    sed 1d "$IN/$f.txt" | sed "s/^ACCESS-EPOCH $AE\$/ACCESS-EPOCH none/"; } > "$IN/$f-epoch-none.txt"
  { fx10 "$f.txt without its ACCESS-EPOCH line (saved with the r9 command)"
    sed 1d "$IN/$f.txt" | sed '/^ACCESS-EPOCH /d'; } > "$IN/$f-no-epoch.txt"
done
for f in fx-version-post fx-version-post-offhost-unqualified fx-g0-pass-post fx-a2-pass-post; do
  { fx10 "$f.txt with access-epoch=$AO on its production RESULT line: made BEFORE the access change"
    sed 1d "$IN/$f.txt" | sed "s/ access-epoch=$AE\$/ access-epoch=$AO/"; } > "$IN/$f-epoch-before.txt"
  { fx10 "$f.txt with access-epoch=none on its production RESULT line"
    sed 1d "$IN/$f.txt" | sed "s/ access-epoch=$AE\$/ access-epoch=none/"; } > "$IN/$f-epoch-none.txt"
  { fx10 "$f.txt without access-epoch= on its production RESULT line (an r9 verifier)"
    sed 1d "$IN/$f.txt" | sed "s/ access-epoch=$AE\$//"; } > "$IN/$f-no-epoch.txt"
done

# ---- run-time copies. The checker refuses any input with a "[FIXTURE r9]" line, so every case that is meant to reach a decision
# on a fixture gets an UNMARKED copy (its marker line removed), made here under evidence/unmarked/ and deleted on exit: unmarked
# copies are never committed. Production has no --now, so the production-path cases (p3, p4, n30, n31) also move every ISO time in
# their four inputs by one offset, putting the verdict 2 min before this run's real clock; their .out lines differ on each run.
TSRE='[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z'
cd "$EV" || exit 2; I=inputs; U=unmarked   # relative, so that the evidence does not carry this clone's path
rm -rf "$U"; mkdir -p "$U"; trap 'rm -rf "$EV/$U"' EXIT
for f in "$I"/fx-*.txt; do sed 1d "$f" > "$U/${f#"$I"/}"; done
shift_now() { # name file...: copies under $U/name with every ISO time moved so that the latest is now - 120 s (two-phase: no collision)
  local d=$U/$1 off t k=0 s1= s2= ref; shift; mkdir -p "$d"
  ref=$(grep -ohE "$TSRE" "$@" | sort | tail -n 1); off=$(( $(date -u +%s) - 120 - $(date -u -d "$ref" +%s) ))
  for t in $(grep -ohE "$TSRE" "$@" | sort -u); do k=$((k + 1))
    s1+="s/$t/@@T$k@@/g;"; s2+="s/@@T$k@@/$(date -u -d "@$(( $(date -u -d "$t" +%s) + off ))" +%FT%TZ)/g;"; done
  for f in "$@"; do sed "$s1" "$f" | sed "$s2" > "$d/$(basename "$f")"; done; }

# ---- cases: id | expected final line prefix (or USAGE) | expected failed= list (empty for GO) | checker arguments
NPASS=0; NFAIL=0
case_() {
  local id=$1 want=$2 wfail=$3 out last got_fail ok; shift 3
  out=$(bash "${CHKX:-$CHK}" "$@" 2>&1); rc=$?
  printf '%s\n' "== case $id: bash afldb-gate-accept.sh $*" "$out" "== exit $rc" > "$EV/$id.out"
  last=$(tail -n 1 <<< "$out"); got_fail=$(sed -nE 's/.* NO-GO failed=([^ ]+) .*/\1/p' <<< "$last")
  ok=0
  if [ "$want" = USAGE ]; then [ $rc = 2 ] && [[ $last == "refused: "* ]] && ok=1
  else [[ $last == "$want"* ]] && [ "$got_fail" = "$wfail" ] && { [[ $want == *" GO"* ]] && [ $rc = 0 ] || { [[ $want == *NO-GO* ]] && [ $rc = 1 ]; }; } && ok=1; fi
  if [ $ok = 1 ]; then NPASS=$((NPASS + 1)); r=PASS; else NFAIL=$((NFAIL + 1)); r=FAIL; fi
  printf 'CASE %s %s expect="%s failed=%s" got="%s" exit=%s\n' "$id" "$r" "$want" "${wfail:-none}" "$last" "$rc" | tee -a "$EV/summary.txt"
}
N5="--now 2026-11-28T05:40:00Z"; N7="--now 2026-11-28T07:30:00Z"   # test clocks (rehearsal only): 15 min after p1's verdict; after r5's
OK4="--owner-checks $U/fx-oc-4.4-bootid.txt --reverify $U/fx-reverify-4.5-bootid.txt"
# Astra's counterexample: installs PASS, VERSION PASS, a gate PASS, owner checks still BLOCKED on B1/B2/B3
case_ ce1-real-release-g0  "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,reverify,version,verdict" --rehearsal $N5 --gate release-g0 \
  --owner-checks $I/real-oc-3.12-blocked.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $I/real-version-3.13-pre-phase4.txt --verdict $I/real-g0-pass.txt --verdict-exit 0
case_ ce2-real-ng-pre      "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "owner-checks,reverify,version" --rehearsal $N5 --gate ng-pre \
  --owner-checks $I/real-oc-3.12-blocked.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $I/real-version-3.13-pre-phase4.txt --verdict $U/fx-a2-pass-post.txt --verdict-exit 0
case_ ce3-isolated-release-g0 "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,reverify,version" --rehearsal $N5 --gate release-g0 \
  --owner-checks $I/real-oc-3.12-blocked.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ ce4-isolated-ng-pre  "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "owner-checks,reverify,version" --rehearsal $N5 --gate ng-pre \
  --owner-checks $I/real-oc-3.12-blocked.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $U/fx-version-post.txt --verdict $U/fx-a2-pass-post.txt --verdict-exit 0
# positive: real post-Phase-4 owner checks and re-verification (BOOT-ID line added); version and gate verdict are FIXTURES (see above)
case_ p1-release-g0-rehearsal "GATE ACCEPT REHEARSAL RELEASE-G0 GO" "" --rehearsal $N5 --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ p2-ng-pre-rehearsal-offhost-stop "GATE ACCEPT REHEARSAL NG-PRE GO" "" --rehearsal $N5 --gate ng-pre $OK4 --version $U/fx-version-post-offhost-unqualified.txt --verdict $U/fx-a2-pass-post.txt --verdict-exit 0
shift_now p3 $U/fx-oc-4.4-bootid.txt $U/fx-reverify-4.5-bootid.txt $U/fx-version-post-prod.txt $U/fx-g0-pass-post-prod.txt
case_ p3-release-g0-production-no-pin-rev "GATE ACCEPT RELEASE-G0 NO-GO" "pin" --gate release-g0 \
  --owner-checks $U/p3/fx-oc-4.4-bootid.txt --reverify $U/p3/fx-reverify-4.5-bootid.txt --version $U/p3/fx-version-post-prod.txt --verdict $U/p3/fx-g0-pass-post-prod.txt --verdict-exit 0
shift_now p4 $U/fx-oc-4.4-bootid.txt $U/fx-reverify-4.5-bootid.txt $U/fx-version-post-offhost-unqualified-prod.txt $U/fx-a2-pass-post-prod.txt
case_ p4-ng-pre-production "GATE ACCEPT NG-PRE GO transport=production" "" --gate ng-pre \
  --owner-checks $U/p4/fx-oc-4.4-bootid.txt --reverify $U/p4/fx-reverify-4.5-bootid.txt --version $U/p4/fx-version-post-offhost-unqualified-prod.txt --verdict $U/p4/fx-a2-pass-post-prod.txt --verdict-exit 0
# negative cases
case_ n1-a2-stop-attributed "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal $N5 --gate ng-pre $OK4 --version $U/fx-version-post.txt --verdict $U/fx-a2-stop-attributed-post.txt --verdict-exit 1
case_ n2-a2-stop-attributed-exit0 "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal $N5 --gate ng-pre $OK4 --version $U/fx-version-post.txt --verdict $U/fx-a2-stop-attributed-post.txt --verdict-exit 0
case_ n3-a2-stop-real "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal $N5 --gate ng-pre $OK4 --version $U/fx-version-post.txt --verdict $I/real-a2-stop-attributed.txt --verdict-exit 1
case_ n4-version-from-phase3 "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "version" --rehearsal $N5 --gate ng-pre $OK4 --version $I/real-version-3.13-pre-phase4.txt --verdict $U/fx-a2-pass-post.txt --verdict-exit 0
case_ n5-owner-checks-after-version "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-pass-late.txt --reverify $U/fx-reverify-4.5-bootid.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n6-gate-before-version "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "verdict" --rehearsal $N5 --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $I/real-g0-pass.txt --verdict-exit 0
case_ n7-reverify-saved-before-phase4 "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "reverify,version" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-4.4-bootid.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n8-no-as-arm "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "reverify,version,verdict" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-4.4-bootid.txt --reverify $U/fx-reverify-no-as-arm.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n9-relayed-pass-before-stop "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal $N5 --gate ng-pre $OK4 --version $U/fx-version-post.txt --verdict $U/fx-a2-relayed-pass-before-stop.txt --verdict-exit 0
case_ n10-relayed-pass-last "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal $N5 --gate ng-pre $OK4 --version $U/fx-version-post.txt --verdict $U/fx-a2-relayed-pass-last.txt --verdict-exit 0
case_ n11-relayed-version "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "version,verdict" --rehearsal $N5 --gate ng-pre $OK4 --version $U/fx-version-relayed-prod.txt --verdict $U/fx-a2-pass-post.txt --verdict-exit 0
case_ n12-rehearsal-for-real-gate "GATE ACCEPT RELEASE-G0 NO-GO" "version,verdict,pin" --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n13-production-with-rehearsal-flag "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal $N5 --gate release-g0 $OK4 --version $U/fx-version-post-prod.txt --verdict $U/fx-g0-pass-post-prod.txt --verdict-exit 0
case_ n14-a2-pass-exit1 "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal $N5 --gate ng-pre $OK4 --version $U/fx-version-post.txt --verdict $U/fx-a2-pass-post.txt --verdict-exit 1
case_ n15-owner-checks-two-runs "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,version" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-two-runs.txt --reverify $U/fx-reverify-4.5-bootid.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n16-owner-checks-no-result "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,version" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-no-result.txt --reverify $U/fx-reverify-4.5-bootid.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n17-release-g0-given-a2 "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "verdict" --rehearsal $N5 --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $U/fx-a2-pass-post.txt --verdict-exit 0
case_ n18-release-g0-offhost-unqualified "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal $N5 --gate release-g0 $OK4 --version $U/fx-version-post-offhost-unqualified.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n19-g0-other-qualification "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "verdict" --rehearsal $N5 --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post-other-qual.txt --verdict-exit 0
case_ n20-phase4-evidence-2days "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "fresh" --rehearsal --now 2026-11-30T05:40:00Z --gate release-g0 $OK4 --version $U/fx-version-post-2days.txt --verdict $U/fx-g0-pass-post-2days.txt --verdict-exit 0
# R9-F-1: freshness, boot binding, fixture refusal, exact production transport
case_ n21-verdict-over-3h-after-4.4 "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "fresh" --rehearsal --now 2026-11-28T08:40:00Z --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post-late.txt --verdict-exit 0
case_ n22-check-over-1h-after-verdict "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "fresh" --rehearsal --now 2026-11-28T06:30:00Z --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n23-verdict-ahead-of-clock "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "fresh" --rehearsal --now 2026-11-28T05:10:00Z --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n24-boot-id-mismatch-owner-checks "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-4.4-bootid-other.txt --reverify $U/fx-reverify-4.5-bootid.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n25-boot-mismatch-verdict "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "verdict" --rehearsal $N5 --gate release-g0 $OK4 --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post-other-boot.txt --verdict-exit 0
case_ n26-no-boot-id-owner-checks "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,version" --rehearsal $N5 --gate release-g0 \
  --owner-checks $I/real-oc-4.4-pass.txt --reverify $U/fx-reverify-4.5-bootid.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n27-no-boot-id-reverify "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "reverify,version" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-4.4-bootid.txt --reverify $I/real-reverify-4.5-post-phase4.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n28-fixture-marked-all "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,reverify,version,verdict" --rehearsal $N5 --gate release-g0 \
  --owner-checks $I/fx-oc-4.4-bootid.txt --reverify $I/fx-reverify-4.5-bootid.txt --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ n29-fixture-marked-production "GATE ACCEPT RELEASE-G0 NO-GO" "owner-checks,reverify,version,verdict,pin" --gate release-g0 \
  --owner-checks $I/fx-oc-4.4-bootid.txt --reverify $I/fx-reverify-4.5-bootid.txt --version $I/fx-version-post-prod.txt --verdict $I/fx-g0-pass-post-prod.txt --verdict-exit 0
shift_now n30 $U/fx-oc-4.4-bootid.txt $U/fx-reverify-4.5-bootid.txt $U/fx-version-post-stub.txt $U/fx-g0-pass-post-stub.txt
case_ n30-production-stub "GATE ACCEPT RELEASE-G0 NO-GO" "version,verdict,pin" --gate release-g0 \
  --owner-checks $U/n30/fx-oc-4.4-bootid.txt --reverify $U/n30/fx-reverify-4.5-bootid.txt --version $U/n30/fx-version-post-stub.txt --verdict $U/n30/fx-g0-pass-post-stub.txt --verdict-exit 0
case_ n31-now-without-rehearsal USAGE "" --gate release-g0 --now 2026-11-28T05:40:00Z \
  --owner-checks $U/p3/fx-oc-4.4-bootid.txt --reverify $U/p3/fx-reverify-4.5-bootid.txt --version $U/p3/fx-version-post-prod.txt --verdict $U/p3/fx-g0-pass-post-prod.txt --verdict-exit 0
# R9-F-11: each of (a) and (b) must be within 3 h before the verdict, so the OLDER decides
case_ n32-stale-owner-checks-fresh-reverify "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "fresh" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-4.4-stale.txt --reverify $U/fx-reverify-4.5-bootid.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ n33-stale-reverify-fresh-owner-checks "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "fresh" --rehearsal $N5 --gate release-g0 \
  --owner-checks $U/fx-oc-4.4-bootid.txt --reverify $U/fx-reverify-4.5-stale.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
# r9 wrapper transcripts (agent A, r9oq2): r1-r4 verbatim, r5-r8 with only the bundle and version time edited
case_ r1-r9-real-g0-pass "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal $N7 --gate release-g0 $OK4 --version $I/real-r9-version-fixture-qualified.txt --verdict $I/real-r9-g0-pass-fixture-qualified.txt --verdict-exit 0
case_ r2-r9-real-g0-unqualified "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal $N7 --gate release-g0 $OK4 --version $I/real-r9-version-unqualified.txt --verdict $I/real-r9-g0-stop-unqualified.txt --verdict-exit 1
case_ r3-r9-real-a2-stop "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "version,verdict" --rehearsal $N7 --gate ng-pre $OK4 --version $I/real-r9-version-unqualified.txt --verdict $I/real-r9-a2-stop-attributed.txt --verdict-exit 1
case_ r4-r9-real-g0-pass-production "GATE ACCEPT RELEASE-G0 NO-GO" "version,verdict,pin" --gate release-g0 $OK4 --version $I/real-r9-version-fixture-qualified.txt --verdict $I/real-r9-g0-pass-fixture-qualified.txt --verdict-exit 0
case_ r5-r9-g0-pass "GATE ACCEPT REHEARSAL RELEASE-G0 GO" "" --rehearsal $N7 --gate release-g0 $OK4 --version $U/fx-r9-version.txt --verdict $U/fx-r9-g0-pass.txt --verdict-exit 0
case_ r6-r9-g0-unqualified-version "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal $N7 --gate release-g0 $OK4 --version $U/fx-r9-version-unqualified.txt --verdict $U/fx-r9-g0-pass.txt --verdict-exit 0
case_ r7-r9-g0-stop-unqualified "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal $N7 --gate release-g0 $OK4 --version $U/fx-r9-version-unqualified.txt --verdict $U/fx-r9-g0-stop-unqualified.txt --verdict-exit 1
case_ r8-r9-ng-pre-g0-verdict "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal $N7 --gate ng-pre $OK4 --version $U/fx-r9-version-unqualified.txt --verdict $U/fx-r9-g0-pass.txt --verdict-exit 0
# ---- r10 (Astra case 3): the access epoch. A saved PASS followed by a same-boot access change: every part made before the change
# carries the OLD epoch AO, every part after it the new AE. Only a fresh 4.4, 4.5, 4.6 and a new gate call (all AE) can give GO.
REG="--rehearsal $N5 --gate release-g0"; NGP="--rehearsal $N5 --gate ng-pre"
case_ e1-saved-4.4-4.5-then-change "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "access" $REG --owner-checks $U/fx-oc-4.4-bootid-epoch-before.txt --reverify $U/fx-reverify-4.5-bootid-epoch-before.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ e2-saved-4.4-to-4.6-then-change "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "access" $REG --owner-checks $U/fx-oc-4.4-bootid-epoch-before.txt --reverify $U/fx-reverify-4.5-bootid-epoch-before.txt --version $U/fx-version-post-epoch-before.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ e3-only-4.4-before-change "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "access" $REG --owner-checks $U/fx-oc-4.4-bootid-epoch-before.txt --reverify $U/fx-reverify-4.5-bootid.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ e4-ng-pre-saved-then-change "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "access" $NGP --owner-checks $U/fx-oc-4.4-bootid-epoch-before.txt --reverify $U/fx-reverify-4.5-bootid-epoch-before.txt --version $U/fx-version-post-offhost-unqualified-epoch-before.txt --verdict $U/fx-a2-pass-post.txt --verdict-exit 0
case_ e5-epoch-none "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "access" $REG --owner-checks $U/fx-oc-4.4-bootid-epoch-none.txt --reverify $U/fx-reverify-4.5-bootid-epoch-none.txt --version $U/fx-version-post-epoch-none.txt --verdict $U/fx-g0-pass-post-epoch-none.txt --verdict-exit 0
case_ e6-4.4-without-epoch-line "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "access" $REG --owner-checks $U/fx-oc-4.4-bootid-no-epoch.txt --reverify $U/fx-reverify-4.5-bootid.txt --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0
case_ e7-r9-verifier-no-epoch "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "access" $NGP $OK4 --version $U/fx-version-post-offhost-unqualified-no-epoch.txt --verdict $U/fx-a2-pass-post-no-epoch.txt --verdict-exit 0
case_ e8-verdict-before-change "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "access" $NGP $OK4 --version $U/fx-version-post-offhost-unqualified.txt --verdict $U/fx-a2-pass-post-epoch-before.txt --verdict-exit 0
shift_now e9 $U/fx-oc-4.4-bootid-epoch-before.txt $U/fx-reverify-4.5-bootid-epoch-before.txt $U/fx-version-post-offhost-unqualified-prod.txt $U/fx-a2-pass-post-prod.txt
case_ e9-production-saved-then-change "GATE ACCEPT NG-PRE NO-GO" "access" --gate ng-pre --owner-checks $U/e9/fx-oc-4.4-bootid-epoch-before.txt --reverify $U/e9/fx-reverify-4.5-bootid-epoch-before.txt --version $U/e9/fx-version-post-offhost-unqualified-prod.txt --verdict $U/e9/fx-a2-pass-post-prod.txt --verdict-exit 0

# ---- r10 (Astra case 2): release-g0 binds the pin of a reviewed revision (--pin-rev). A scratch git repository holds a
# byte-identical copy of the checker at its repository path, then three commits: C0 without a pin (an "old export"), C1 adding a
# production-format pin, C2 replacing it with a fixture-format pin. The verdict inputs get the qual-sha256 of the pin they claim.
GS=$(mktemp -d); trap 'rm -rf "$EV/$U" "$GS"' EXIT
RP=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128; GC=$GS/$RP/accept/afldb-gate-accept.sh
mkdir -p "$GS/$RP/accept" "$GS/$RP/offhost"; cp "$CHK" "$GC"; cmp -s "$CHK" "$GC" || { echo "STOP checker copy differs"; exit 2; }
gg() { git -C "$GS" -c user.name=r10-accept-test -c user.email=r10-accept-test@invalid -c commit.gpgsign=false "$@" > /dev/null; }
gg init -q; gg add -A; gg commit -q -m 'C0: checker, no qualification pin'; C0=$(git -C "$GS" rev-parse HEAD)
printf '%s\n' '# r10 accept test pin (scratch repository only)' 'format=afldb-offhost-qualification-v1' 'host=r9-fixture-offhost' \
  'address=203.0.113.20' 'hostkey=SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' 'record-file=records/q.md' \
  "record-sha256=$(printf 'r10 record\n' | sha256sum | cut -c1-64)" 'qualified-on=2026-11-28' > "$GS/$RP/offhost/QUALIFIED-ENDPOINT"
gg add -A; gg commit -q -m 'C1: production pin'; C1=$(git -C "$GS" rev-parse HEAD); P1=$(sha256sum < "$GS/$RP/offhost/QUALIFIED-ENDPOINT" | cut -c1-64)
sed -i 's/^format=.*/format=afldb-offhost-qualification-fixture-v1/' "$GS/$RP/offhost/QUALIFIED-ENDPOINT"; echo 'rehearsal-utc-offset=39600' >> "$GS/$RP/offhost/QUALIFIED-ENDPOINT"
gg add -A; gg commit -q -m 'C2: fixture pin'; C2=$(git -C "$GS" rev-parse HEAD); P2=$(sha256sum < "$GS/$RP/offhost/QUALIFIED-ENDPOINT" | cut -c1-64)
echo "[r10] scratch pin repository: C0 $C0 (no pin), C1 $C1 (pin sha256 $P1), C2 $C2 (fixture pin sha256 $P2)" | tee -a "$EV/summary.txt"
qcopy() { # name sha file...: unmarked copies under $U/name with qual-sha256=$FQ replaced by sha
  local d=$U/$1 q=$2 f; shift 2; mkdir -p "$d"; for f in "$@"; do sed "s/qual-sha256=$FQ/qual-sha256=$q/g" "$f" > "$d/$(basename "$f")"; done; }
qcopy q1 "$P1" $U/fx-version-post-prod.txt $U/fx-g0-pass-post-prod.txt
shift_now g $U/fx-oc-4.4-bootid.txt $U/fx-reverify-4.5-bootid.txt $U/q1/fx-version-post-prod.txt $U/q1/fx-g0-pass-post-prod.txt
mkdir -p $U/g2; for f in fx-version-post-prod fx-g0-pass-post-prod; do sed "s/qual-sha256=$P1/qual-sha256=$P2/g" $U/g/$f.txt > $U/g2/$f.txt; done
GP="--gate release-g0 --owner-checks $U/g/fx-oc-4.4-bootid.txt --reverify $U/g/fx-reverify-4.5-bootid.txt"
CHKX=$GC case_ g1-production-pin-rev-reviewed "GATE ACCEPT RELEASE-G0 GO transport=production" "" $GP --version $U/g/fx-version-post-prod.txt --verdict $U/g/fx-g0-pass-post-prod.txt --verdict-exit 0 --pin-rev $C1
CHKX=$GC case_ g2-production-no-pin-rev "GATE ACCEPT RELEASE-G0 NO-GO" "pin" $GP --version $U/g/fx-version-post-prod.txt --verdict $U/g/fx-g0-pass-post-prod.txt --verdict-exit 0
CHKX=$GC case_ g3-production-old-export-c0 "GATE ACCEPT RELEASE-G0 NO-GO" "pin" $GP --version $U/g/fx-version-post-prod.txt --verdict $U/g/fx-g0-pass-post-prod.txt --verdict-exit 0 --pin-rev $C0
CHKX=$GC case_ g4-production-pin-not-the-reviewed-one "GATE ACCEPT RELEASE-G0 NO-GO" "pin" $GP --version $U/g2/fx-version-post-prod.txt --verdict $U/g2/fx-g0-pass-post-prod.txt --verdict-exit 0 --pin-rev $C1
CHKX=$GC case_ g5-production-fixture-pin "GATE ACCEPT RELEASE-G0 NO-GO" "pin" $GP --version $U/g2/fx-version-post-prod.txt --verdict $U/g2/fx-g0-pass-post-prod.txt --verdict-exit 0 --pin-rev $C2
CHKX=$GC case_ g6-production-unknown-rev "GATE ACCEPT RELEASE-G0 NO-GO" "pin" $GP --version $U/g/fx-version-post-prod.txt --verdict $U/g/fx-g0-pass-post-prod.txt --verdict-exit 0 --pin-rev 0123456789abcdef0123456789abcdef01234567
qcopy q3 "$P2" $U/fx-version-post.txt $U/fx-g0-pass-post.txt; qcopy q4 "$P1" $U/fx-version-post.txt $U/fx-g0-pass-post.txt
CHKX=$GC case_ g7-rehearsal-fixture-pin-rev "GATE ACCEPT REHEARSAL RELEASE-G0 GO" "" $REG $OK4 --version $U/q3/fx-version-post.txt --verdict $U/q3/fx-g0-pass-post.txt --verdict-exit 0 --pin-rev $C2
CHKX=$GC case_ g8-rehearsal-production-pin-rev "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "pin" $REG $OK4 --version $U/q4/fx-version-post.txt --verdict $U/q4/fx-g0-pass-post.txt --verdict-exit 0 --pin-rev $C1
case_ g9-pin-rev-not-hex USAGE "" $REG $OK4 --version $U/fx-version-post.txt --verdict $U/fx-g0-pass-post.txt --verdict-exit 0 --pin-rev HEAD
echo "GATE ACCEPT TESTS RESULT $([ $NFAIL = 0 ] && echo PASS || echo FAIL) cases=$((NPASS + NFAIL)) pass=$NPASS fail=$NFAIL checker-sha256=$(sha256sum < "$CHK" | cut -c1-64)" | tee -a "$EV/summary.txt"
[ $NFAIL = 0 ]
