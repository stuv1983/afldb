#!/usr/bin/env bash
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
# in A-2's expected state). Writes evidence/inputs/*, evidence/<case>.out and evidence/summary.txt; exit 0 only if every case
# gives its expected result.
set -uo pipefail; export LC_ALL=C
HERE=$(cd "$(dirname "$0")" && pwd); R=$(cd "$HERE/../.." && pwd); EV=$HERE/evidence; IN=$EV/inputs
CHK=$HERE/afldb-gate-accept.sh
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
{ fx "real-reverify-4.5-post-phase4.txt with the --as-arm part (its header through its result line) deleted"
  sed '/^== verify-backup-install --as-arm/,/^BACKUP INSTALL RESULT /d' "$IN/real-reverify-4.5-post-phase4.txt"; } > "$IN/fx-reverify-no-as-arm.txt"
{ fx "real-oc-4.4-pass.txt with its header time moved to 2026-11-28T05:24:30Z (after fx-version-post.txt)"
  sed -E 's/^(== afldb-owner-checks \(R6 r8\) )[^ ]+/\12026-11-28T05:24:30Z/' "$IN/real-oc-4.4-pass.txt"; } > "$IN/fx-oc-pass-late.txt"
{ fx "real-oc-3.12-blocked.txt followed by real-oc-4.4-pass.txt (two runs in one file)"
  cat "$IN/real-oc-3.12-blocked.txt" "$IN/real-oc-4.4-pass.txt"; } > "$IN/fx-oc-two-runs.txt"
{ fx "real-oc-4.4-pass.txt without its last line (the result line)"
  sed '$d' "$IN/real-oc-4.4-pass.txt"; } > "$IN/fx-oc-no-result.txt"
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

# ---- cases: id | expected final line prefix | expected failed= list (empty for GO) | checker arguments
NPASS=0; NFAIL=0
case_() {
  local id=$1 want=$2 wfail=$3 out last got_fail ok; shift 3
  out=$(bash "$CHK" "$@" 2>&1); rc=$?
  printf '%s\n' "== case $id: bash afldb-gate-accept.sh $*" "$out" "== exit $rc" > "$EV/$id.out"
  last=$(tail -n 1 <<< "$out"); got_fail=$(sed -nE 's/.* NO-GO failed=([^ ]+) .*/\1/p' <<< "$last")
  ok=0; [[ $last == "$want"* ]] && [ "$got_fail" = "$wfail" ] && { [[ $want == *" GO"* ]] && [ $rc = 0 ] || { [[ $want == *NO-GO* ]] && [ $rc = 1 ]; }; } && ok=1
  if [ $ok = 1 ]; then NPASS=$((NPASS + 1)); r=PASS; else NFAIL=$((NFAIL + 1)); r=FAIL; fi
  printf 'CASE %s %s expect="%s failed=%s" got="%s" exit=%s\n' "$id" "$r" "$want" "${wfail:-none}" "$last" "$rc" | tee -a "$EV/summary.txt"
}
cd "$EV" || exit 2; I=inputs   # relative, so that the evidence does not carry this clone's path
# Astra's counterexample: installs PASS, VERSION PASS, a gate PASS, owner checks still BLOCKED on B1/B2/B3
case_ ce1-real-release-g0  "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,reverify,version,verdict" --rehearsal --gate release-g0 \
  --owner-checks $I/real-oc-3.12-blocked.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $I/real-version-3.13-pre-phase4.txt --verdict $I/real-g0-pass.txt --verdict-exit 0
case_ ce2-real-ng-pre      "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "owner-checks,reverify" --rehearsal --gate ng-pre \
  --owner-checks $I/real-oc-3.12-blocked.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $I/real-version-3.13-pre-phase4.txt --verdict $I/fx-a2-pass-post.txt --verdict-exit 0
case_ ce3-isolated-release-g0 "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,reverify" --rehearsal --gate release-g0 \
  --owner-checks $I/real-oc-3.12-blocked.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ ce4-isolated-ng-pre  "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "owner-checks,reverify" --rehearsal --gate ng-pre \
  --owner-checks $I/real-oc-3.12-blocked.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $I/fx-version-post.txt --verdict $I/fx-a2-pass-post.txt --verdict-exit 0
# positive: real post-Phase-4 owner checks and re-verification; version and gate verdict are FIXTURES (see above)
case_ p1-release-g0-rehearsal "GATE ACCEPT REHEARSAL RELEASE-G0 GO" "" --rehearsal --gate release-g0 \
  --owner-checks $I/real-oc-4.4-pass.txt --reverify $I/real-reverify-4.5-post-phase4.txt --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ p2-ng-pre-rehearsal-offhost-stop "GATE ACCEPT REHEARSAL NG-PRE GO" "" --rehearsal --gate ng-pre \
  --owner-checks $I/real-oc-4.4-pass.txt --reverify $I/real-reverify-4.5-post-phase4.txt --version $I/fx-version-post-offhost-unqualified.txt --verdict $I/fx-a2-pass-post.txt --verdict-exit 0
case_ p3-release-g0-production "GATE ACCEPT RELEASE-G0 GO transport=production" "" --gate release-g0 \
  --owner-checks $I/real-oc-4.4-pass.txt --reverify $I/real-reverify-4.5-post-phase4.txt --version $I/fx-version-post-prod.txt --verdict $I/fx-g0-pass-post-prod.txt --verdict-exit 0
case_ p4-ng-pre-production "GATE ACCEPT NG-PRE GO transport=production" "" --gate ng-pre \
  --owner-checks $I/real-oc-4.4-pass.txt --reverify $I/real-reverify-4.5-post-phase4.txt --version $I/fx-version-post-offhost-unqualified-prod.txt --verdict $I/fx-a2-pass-post-prod.txt --verdict-exit 0
# negative cases
OK4="--owner-checks $I/real-oc-4.4-pass.txt --reverify $I/real-reverify-4.5-post-phase4.txt"
case_ n1-a2-stop-attributed "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal --gate ng-pre $OK4 --version $I/fx-version-post.txt --verdict $I/fx-a2-stop-attributed-post.txt --verdict-exit 1
case_ n2-a2-stop-attributed-exit0 "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal --gate ng-pre $OK4 --version $I/fx-version-post.txt --verdict $I/fx-a2-stop-attributed-post.txt --verdict-exit 0
case_ n3-a2-stop-real "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal --gate ng-pre $OK4 --version $I/fx-version-post.txt --verdict $I/real-a2-stop-attributed.txt --verdict-exit 1
case_ n4-version-from-phase3 "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "version" --rehearsal --gate ng-pre $OK4 --version $I/real-version-3.13-pre-phase4.txt --verdict $I/fx-a2-pass-post.txt --verdict-exit 0
case_ n5-owner-checks-after-version "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version" --rehearsal --gate release-g0 \
  --owner-checks $I/fx-oc-pass-late.txt --reverify $I/real-reverify-4.5-post-phase4.txt --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ n6-gate-before-version "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "verdict" --rehearsal --gate release-g0 $OK4 --version $I/fx-version-post.txt --verdict $I/real-g0-pass.txt --verdict-exit 0
case_ n7-reverify-saved-before-phase4 "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "reverify" --rehearsal --gate release-g0 \
  --owner-checks $I/real-oc-4.4-pass.txt --reverify $I/real-reverify-3.5-3.6-3.11-pre-phase4.txt --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ n8-no-as-arm "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "reverify,version" --rehearsal --gate release-g0 \
  --owner-checks $I/real-oc-4.4-pass.txt --reverify $I/fx-reverify-no-as-arm.txt --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ n9-relayed-pass-before-stop "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal --gate ng-pre $OK4 --version $I/fx-version-post.txt --verdict $I/fx-a2-relayed-pass-before-stop.txt --verdict-exit 0
case_ n10-relayed-pass-last "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal --gate ng-pre $OK4 --version $I/fx-version-post.txt --verdict $I/fx-a2-relayed-pass-last.txt --verdict-exit 0
case_ n11-relayed-version "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "version,verdict" --rehearsal --gate ng-pre $OK4 --version $I/fx-version-relayed-prod.txt --verdict $I/fx-a2-pass-post.txt --verdict-exit 0
case_ n12-rehearsal-for-real-gate "GATE ACCEPT RELEASE-G0 NO-GO" "version,verdict" --gate release-g0 $OK4 --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ n13-production-with-rehearsal-flag "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal --gate release-g0 $OK4 --version $I/fx-version-post-prod.txt --verdict $I/fx-g0-pass-post-prod.txt --verdict-exit 0
case_ n14-a2-pass-exit1 "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal --gate ng-pre $OK4 --version $I/fx-version-post.txt --verdict $I/fx-a2-pass-post.txt --verdict-exit 1
case_ n15-owner-checks-two-runs "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks,version" --rehearsal --gate release-g0 \
  --owner-checks $I/fx-oc-two-runs.txt --reverify $I/real-reverify-4.5-post-phase4.txt --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ n16-owner-checks-no-result "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "owner-checks" --rehearsal --gate release-g0 \
  --owner-checks $I/fx-oc-no-result.txt --reverify $I/real-reverify-4.5-post-phase4.txt --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ n17-release-g0-given-a2 "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "verdict" --rehearsal --gate release-g0 $OK4 --version $I/fx-version-post.txt --verdict $I/fx-a2-pass-post.txt --verdict-exit 0
case_ n18-release-g0-offhost-unqualified "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal --gate release-g0 $OK4 --version $I/fx-version-post-offhost-unqualified.txt --verdict $I/fx-g0-pass-post.txt --verdict-exit 0
case_ n19-g0-other-qualification "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "verdict" --rehearsal --gate release-g0 $OK4 --version $I/fx-version-post.txt --verdict $I/fx-g0-pass-post-other-qual.txt --verdict-exit 0
case_ n20-phase4-evidence-stale "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "verdict" --rehearsal --gate release-g0 $OK4 --version $I/fx-version-post-2days.txt --verdict $I/fx-g0-pass-post-2days.txt --verdict-exit 0
# r9 wrapper transcripts (agent A, r9oq2): r1-r4 verbatim, r5-r8 with only the bundle and version time edited
case_ r1-r9-real-g0-pass "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal --gate release-g0 $OK4 --version $I/real-r9-version-fixture-qualified.txt --verdict $I/real-r9-g0-pass-fixture-qualified.txt --verdict-exit 0
case_ r2-r9-real-g0-unqualified "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal --gate release-g0 $OK4 --version $I/real-r9-version-unqualified.txt --verdict $I/real-r9-g0-stop-unqualified.txt --verdict-exit 1
case_ r3-r9-real-a2-stop "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "version,verdict" --rehearsal --gate ng-pre $OK4 --version $I/real-r9-version-unqualified.txt --verdict $I/real-r9-a2-stop-attributed.txt --verdict-exit 1
case_ r4-r9-real-g0-pass-production "GATE ACCEPT RELEASE-G0 NO-GO" "version,verdict" --gate release-g0 $OK4 --version $I/real-r9-version-fixture-qualified.txt --verdict $I/real-r9-g0-pass-fixture-qualified.txt --verdict-exit 0
case_ r5-r9-g0-pass "GATE ACCEPT REHEARSAL RELEASE-G0 GO" "" --rehearsal --gate release-g0 $OK4 --version $I/fx-r9-version.txt --verdict $I/fx-r9-g0-pass.txt --verdict-exit 0
case_ r6-r9-g0-unqualified-version "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal --gate release-g0 $OK4 --version $I/fx-r9-version-unqualified.txt --verdict $I/fx-r9-g0-pass.txt --verdict-exit 0
case_ r7-r9-g0-stop-unqualified "GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO" "version,verdict" --rehearsal --gate release-g0 $OK4 --version $I/fx-r9-version-unqualified.txt --verdict $I/fx-r9-g0-stop-unqualified.txt --verdict-exit 1
case_ r8-r9-ng-pre-g0-verdict "GATE ACCEPT REHEARSAL NG-PRE NO-GO" "verdict" --rehearsal --gate ng-pre $OK4 --version $I/fx-r9-version-unqualified.txt --verdict $I/fx-r9-g0-pass.txt --verdict-exit 0
echo "GATE ACCEPT TESTS RESULT $([ $NFAIL = 0 ] && echo PASS || echo FAIL) cases=$((NPASS + NFAIL)) pass=$NPASS fail=$NFAIL checker-sha256=$(sha256sum < "$CHK" | cut -c1-64)" | tee -a "$EV/summary.txt"
[ $NFAIL = 0 ]
