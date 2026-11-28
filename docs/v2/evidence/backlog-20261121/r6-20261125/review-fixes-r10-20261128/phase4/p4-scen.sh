#!/bin/bash
# p4-scen.sh (R6 r10, 28 Nov 2026). REHEARSAL ONLY: runs INSIDE one disposable container on streamanator (pinned Ubuntu 24.04 image
# plus the sudo package; --network none, never --privileged, no bind mount), started by p4-host.sh. Never production.
# `docker run` as root stands in for both root sessions, [CON] and [ADM-ROOT] [HARNESS]. Every account, group and sudoers change
# below happens inside this container only [FIXTURE]. Real sudo, gpasswd and visudo run throughout [REAL].
# r10 (Astra case 4): the script is staged as the procedure stages it (/root/afldb-r10-phase4 with its SHA256SUMS); entry makes its
# own state directory and prints PHASE4 STATE/SEAL; apply, verify and backout are run ONLY with the state and seal parsed from the
# output of the step before, and each printed command is run as printed, by a FRESH `env -i bash -c` process standing in for a new
# console session. r9's scenarios that used --dispose are replaced by --remove-grant ones; the refusal scenarios are kept.
# Usage: bash p4-scen.sh <scenario>; prints `SCENARIO <name> PASS|FAIL expect=... got=...`.
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin:/sbin:/bin
N=${1:?scenario}; IN=/root/p4; OC=$IN/afldb-owner-checks.sh; SD=/root/afldb-r10-phase4; P4=$SD/afldb-phase4.sh
AED=/var/lib/afldb-access
install -d -m 0755 $SD && install -m 0644 $IN/afldb-phase4.sh $IN/SHA256SUMS $SD/ || { echo "STOP staging"; exit 1; }
L() { printf '[%s] %s\n' "$1" "${*:2}"; }
L HARNESS "staged $SD: $(cd $SD && sha256sum -c --strict SHA256SUMS 2>&1 | tr '\n' ' ')"
p4() { env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc "$P4" "$@" < /dev/null; }
fresh() { env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc -c "$1" < /dev/null; }   # a new console session
OKS=1; WHY=
need() { if [ "$2" = 0 ]; then L CHECK "ok   $1"; else L CHECK "FAIL $1"; OKS=0; WHY="$WHY $1;"; fi; }
has() { grep -qF -- "$2" <<< "$1"; }
snap() { sha256sum /etc/sudoers /etc/sudoers.d/* /etc/group /etc/gshadow; stat -c '%n %u %g %a' /etc/sudoers /etc/sudoers.d /etc/sudoers.d/*; id arm; sudo -n -l -U arm 2>&1 < /dev/null; }
snapa() { snap; echo "epoch $(cat $AED/epoch 2>/dev/null || echo none) applied $(cat $AED/applied 2>/dev/null || echo none) log $(wc -l < $AED/changes.log 2>/dev/null || echo 0)"; }
epoch() { cat $AED/epoch 2>/dev/null || echo none; }
arm_sudo() { setpriv --reuid=arm --regid=arm --init-groups /usr/bin/sudo -n /usr/bin/id -u 2>&1 < /dev/null | tail -n 1; }
oc_b() { timeout 300 env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc "$OC" --admin afldb-admin < /dev/null 2>&1 | grep -E '^CHECK B[1235] '; }
b3_files() { sed -n 's/^CHECK B3 FAIL .* in: *//p' <<< "$1" | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' ' '; }
entry_files() { sed -n 's/^PHASE4 ENTRY match \([^:]*\):.*/\1/p' <<< "$1" | sort -u | tr '\n' ' '; }
run() { local o rc; o=$("$@"); rc=$?; L RUN "$* (exit $rc)"; printf '%s\n' "$o" | sed 's/^/    /'; OUT=$o; RC=$rc; }
runf() { local o rc; o=$(fresh "$1"); rc=$?; L RUN "[fresh console] $1 (exit $rc)"; printf '%s\n' "$o" | sed 's/^/    /'; OUT=$o; RC=$rc; }
only_state_written() { # paths modified since the marker, outside /root/afldb-phase4; /root itself gains it, and the bare /tmp
  local w                # directory entry changes when bash makes (and removes) a here-string file; both are logged
  w=$(find / -xdev \( -path /proc -o -path /sys -o -path /dev \) -prune -o -newer $IN/marker -print 2>/dev/null)
  L CHECK "paths modified since the marker: $(tr '\n' ' ' <<< "$w")" >&2
  grep -Ev "^(/root|/tmp|/root/afldb-phase4(/.*)?)\$" <<< "$w"; }
fixture() { # production's shape: arm (uid 1000) in sudo and in Ubuntu's default cloud-user groups; the packaged default sudoers
  userdel -r ubuntu > /dev/null 2>&1
  grep -q 'afldb-prod' /etc/hosts || echo '127.0.1.1 afldb-prod' >> /etc/hosts   # --network none: sudo resolves its own host name here
  useradd -m -u 1000 -U -s /bin/bash arm && usermod -a -G adm,cdrom,sudo,dip,plugdev arm || { echo "STOP fixture"; exit 1; }
  L FIXTURE "$(id arm); $(dpkg-query -W -f='sudo ${Version}' sudo); /etc/sudoers rules: $(grep -nEv '^[[:space:]]*(#|$)|^Defaults' /etc/sudoers | tr '\n' ';')"
}
add_rule() { # FILE MODE TEXT: a sudoers.d fixture file, validated by visudo -c
  printf '%s\n' "$3" > "$1"; chown root:root "$1"; chmod "$2" "$1"
  L FIXTURE "$1 ($(stat -c '%U:%G %a' "$1")): $3; visudo -c: $(visudo -c 2>&1 | tr '\n' ';')"
}
mark() { touch $IN/marker; sleep 1.1; }
st_of() { sed -n 's/^PHASE4 STATE //p' <<< "$1" | tail -n 1; }
seal_of() { sed -n 's/^PHASE4 SEAL //p' <<< "$1" | tail -n 1; }
printed() { awk -v p="PHASE4 $1 $2: " 'index($0, p) == 1 {x = substr($0, length(p) + 1)} END {print x}' <<< "$3"; }   # TAG PREFIX OUTPUT
token_for() { sed -n "s/^PHASE4 ENTRY REFUSED ${1//\//\\/}[: ].* select it with: --remove-grant \([^ ;]*\).*/\1/p" <<< "$2" | head -n 1; }
entry_ok() { # args: expected change, then entry's extra arguments; sets E ST SL
  local ch=$1; shift; mark
  run p4 entry "$@"; E=$OUT; ST=$(st_of "$E"); SL=$(seal_of "$E")
  [ $RC = 0 ]; need "entry exit 0" $?
  has "$E" "PHASE4 ENTRY RESULT PASS change=$ch "; need "entry RESULT PASS change=$ch" $?
  [[ $ST =~ ^/root/afldb-phase4/attempt-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] && [[ $SL =~ ^[0-9a-f]{64}$ ]]; need "entry printed PHASE4 STATE ($ST) and PHASE4 SEAL ($SL)" $?
  [ "$(sha256sum < "$ST/SHA256SUMS" | cut -c1-64)" = "$SL" ]; need "the printed seal is the sha256 of the state's SHA256SUMS" $?
  local w; w=$(only_state_written); [ -z "$w" ]; need "entry wrote nothing outside /root/afldb-phase4 (found: ${w//$'\n'/ })" $?
}
entry_refused() { # args: expected reason substring, then entry's extra arguments; sets E ST
  local why=$1 s0 w; shift; s0=$(snapa); mark
  run p4 entry "$@"; E=$OUT; ST=$(st_of "$E")
  [ $RC = 1 ]; need "entry exit 1" $?
  has "$E" "PHASE4 ENTRY RESULT REFUSED"; need "entry RESULT REFUSED" $?
  has "$(grep '^PHASE4 ENTRY RESULT' <<< "$E")" "$why"; need "the refusal names: $why" $?
  ! grep -q '^PHASE4 SEAL ' <<< "$E"; need "a refused entry prints no seal" $?
  [ "$(snapa)" = "$s0" ]; need "nothing changed: sudoers scope, group files, arm's groups, sudo -l -U arm and the access record equal the pre-entry snapshot" $?
  w=$(only_state_written); [ -z "$w" ]; need "entry wrote nothing outside /root/afldb-phase4 (found: ${w//$'\n'/ })" $?
}
apply_ok() { # runs the apply command entry printed, as printed; sets A
  local c e0; c=$(printed ENTRY "apply (4.1, [ADM-ROOT])" "$E"); e0=$(epoch)
  [[ $c == *"--state $ST --seal $SL" ]]; need "entry printed the apply command with this state and seal: $c" $?
  runf "$c"; A=$OUT
  [ $RC = 0 ] && has "$A" "PHASE4 APPLY RESULT PASS"; need "apply RESULT PASS" $?
  has "$A" "PHASE4 APPLY VOID: STOP: every saved 4.4, 4.5 and 4.6 output"; need "apply prints VOID for saved 4.4-4.6 and gate verdicts" $?
  [ "$(epoch)" != "$e0" ] && [[ $(epoch) =~ ^[0-9a-f]{32}$ ]]; need "apply wrote a new access epoch ($e0 -> $(epoch))" $?
  [ "$(cat $AED/applied)" = "$ST $SL" ]; need "the host records this attempt as applied" $?
}
refuse_is() { # TAG expected-substring command: a refusal that changes nothing (sudoers, groups, epoch, applied record)
  local s0; s0=$(snapa); runf "$3"
  [ $RC = 1 ] && has "$OUT" "PHASE4 $1 RESULT REFUSED"; need "$1 RESULT REFUSED" $?
  has "$OUT" "$2"; need "the refusal names: $2" $?
  [ "$(snapa)" = "$s0" ]; need "the refused $1 changed nothing (sudoers scope, groups, sudo -l, epoch, applied record)" $?
}
verify_is() { runf "$(printed ENTRY "verify (4.2, [ADM-ROOT])" "$E")"; V=$OUT; has "$V" "PHASE4 VERIFY RESULT $1"; need "verify RESULT $1" $?; }
backout_cmd() { printed APPLY "if 4.2 STOPs or 4.3 fails, back-out from [CON], also from a fresh console session" "$A"; }
backout_is() { local c e0; c=$(backout_cmd); e0=$(epoch); [[ $c == *"--state $ST --seal $SL" ]]; need "apply printed the back-out with this state and seal: $c" $?
  runf "$c"; K=$OUT; has "$K" "PHASE4 BACKOUT RESULT $1"; need "backout (fresh console, as printed) RESULT $1" $?
  if [ "$1" = PASS ]; then [ "$(epoch)" != "$e0" ]; need "backout wrote a new access epoch" $?; has "$K" "PHASE4 BACKOUT VOID: STOP:"; need "backout prints VOID" $?
    has "$(cat $AED/applied)" "none backed-out $ST"; need "the host records no applied attempt after backout" $?; fi; }
agree() { # every file owner-checks B3 reports is among entry's matched files (entry is deliberately stricter than B3)
  local b e x miss=; b=$(b3_files "$OCB"); e=$(entry_files "$E"); L CHECK "owner-checks B3 files [$b], entry match files [$e]"
  for x in $b; do [[ " $e " == *" $x "* ]] || miss="$miss $x"; done
  [ -z "$miss" ]; need "every B3 file is among entry's matches (missing:${miss:- none})" $?; }
exact() { # FILE COPY: bytes, owner, group, mode equal the fixture copy
  cmp -s "$2" "$1" && [ "$(stat -c '%u %g %a' "$1")" = "$(stat -c '%u %g %a' "$2")" ]; need "$1 has the fixture's bytes, owner, group and mode ($(stat -c '%U:%G %a' "$1"))" $?; }

fixture
case $N in
group-only)            # production's shape: entry PASS group-only; apply; verify PASS; owner-checks B1/B2/B3/B5 before and after
  OCB=$(oc_b); L REAL "owner-checks before: $(tr '\n' '|' <<< "$OCB")"
  entry_ok group-only
  [ "$(grep -c '^PHASE4 ENTRY match ' <<< "$E")" = 1 ] && has "$E" "token %sudo class group-only"; need "exactly one match, %sudo, class group-only" $?
  agree; apply_ok; verify_is PASS
  OCA=$(oc_b); L REAL "owner-checks after: $(tr '\n' '|' <<< "$OCA")"
  for c in B1 B2 B3 B5; do grep -q "^CHECK $c PASS" <<< "$OCA"; need "owner-checks $c PASS after Phase 4" $?; done
  X="entry=PASS(group-only),apply=PASS(epoch),verify=PASS,B1-B3,B5=PASS";;
group-only-backout)    # the printed back-out, from a fresh console, restores the pre-change state
  S0=$(snap); entry_ok group-only; apply_ok; verify_is PASS; backout_is PASS
  [ "$(snap)" = "$S0" ]; need "after backout: sudoers scope, /etc/group, /etc/gshadow, id arm and sudo -l -U arm equal the pre-change snapshot" $?
  X="entry=PASS,apply=PASS,verify=PASS,backout=PASS(fresh console),state=pre-change";;
grant-refused-then-retry) # Astra case 4: a refused first entry (the grant is listed, not selected); a retry in a NEW directory with
                       # the listed token; apply; verify; back-out from a fresh console with the printed command: bytes, owner,
                       # mode and membership restored exactly
  add_rule /etc/sudoers.d/90-arm 0440 $'# deploy access for arm (fixture)\nDefaults env_keep += "LANG"\narm ALL=(ALL) NOPASSWD: ALL\n# trailing comment kept'
  cp -p /etc/sudoers.d/90-arm /root/fixture-90-arm; PRE_L=$(sudo -n -l -U arm 2>&1 < /dev/null); S0=$(snap); G0=$(id -Gn arm)
  [ "$(arm_sudo)" = 0 ]; need "before: arm runs sudo -n id -u as root (the NOPASSWD rule)" $?
  entry_refused "/etc/sudoers.d/90-arm:3 names arm"; ST1=$ST
  TOK=$(token_for /etc/sudoers.d/90-arm "$E"); L CHECK "listed token: $TOK"
  [[ $TOK =~ ^/etc/sudoers\.d/90-arm:3-3:[0-9a-f]{64}:[0-9a-f]{64}$ ]]; need "the refusal lists the exact --remove-grant token for line 3" $?
  [ "$(sha256sum < /etc/sudoers.d/90-arm | cut -c1-64)" = "${TOK##*:}" ]; need "the token's file digest is the file's sha256" $?
  sleep 1.1; entry_ok group-and-grants --remove-grant "$TOK"
  [ "$ST" != "$ST1" ] && [ -d "$ST1" ]; need "the retry made a NEW state directory ($ST, not $ST1; the refused one is kept)" $?
  has "$E" "/etc/sudoers.d/90-arm:3 token arm class selected"; need "90-arm:3 classified selected" $?
  has "$E" "/etc/sudoers.d/90-arm loses ONLY line(s) 3(arm) and keeps every other line byte for byte"; need "entry names the one line to remove" $?
  refuse_is APPLY "has seal none, not the given" "$(printed ENTRY "apply (4.1, [ADM-ROOT])" "$E" | sed "s#--state $ST#--state $ST1#")"
  apply_ok
  WANT=$(sed '3d' /root/fixture-90-arm); [ "$(cat /etc/sudoers.d/90-arm)" = "$WANT" ]; need "90-arm now holds every line but line 3, byte for byte (the Defaults line and both comments kept)" $?
  [ "$(stat -c '%u %g %a' /etc/sudoers.d/90-arm)" = "0 0 440" ]; need "90-arm keeps root:root 0440" $?
  A2=$(arm_sudo); [ "$A2" != 0 ]; need "after apply: arm can no longer sudo -n ($A2)" $?
  verify_is PASS; has "$V" "check file PASS /etc/sudoers.d/90-arm equals its planned record"; need "verify checks the exact planned bytes" $?
  backout_is PASS
  exact /etc/sudoers.d/90-arm /root/fixture-90-arm
  [ "$(id -Gn arm)" = "$G0" ]; need "after backout: arm's groups equal the original membership ($G0)" $?
  [ "$(arm_sudo)" = 0 ]; need "after backout: arm runs sudo -n id -u as root again" $?
  [ "$(sudo -n -l -U arm 2>&1 < /dev/null)" = "$PRE_L" ]; need "after backout: sudo -l -U arm equals the pre-change answer" $?
  [ "$(snap)" = "$S0" ]; need "after backout: the whole snapshot equals pre-change" $?
  X="entry1=REFUSED(token listed),entry2=PASS(new dir),wrong-dir-apply=REFUSED,apply=PASS,verify=PASS,fresh-console-backout=PASS(exact)";;
two-grants-one-selected) # Astra case 4: two grants in one file, only one selected: the other blocks entry; both selected: only those
                       # two lines go, an unrelated rule for another user in the same file is kept byte for byte
  useradd -m -U -s /bin/bash deploy
  add_rule /etc/sudoers.d/90-ops 0440 $'# ops (fixture)\narm ALL=(root) NOPASSWD: /usr/bin/systemctl restart afldb\ndeploy ALL=(root) /usr/bin/id\narm ALL=(root) /usr/bin/journalctl'
  cp -p /etc/sudoers.d/90-ops /root/fixture-90-ops; S0=$(snap)
  entry_refused "/etc/sudoers.d/90-ops:2 names arm"
  T2=$(token_for /etc/sudoers.d/90-ops:2 "$E"); T4=$(token_for /etc/sudoers.d/90-ops:4 "$E"); L CHECK "tokens: $T2 | $T4"
  [[ $T2 == /etc/sudoers.d/90-ops:2-2:* && $T4 == /etc/sudoers.d/90-ops:4-4:* ]]; need "each grant is listed with its own token" $?
  entry_refused "/etc/sudoers.d/90-ops:4 names arm" --remove-grant "$T2"
  has "$E" "/etc/sudoers.d/90-ops:2 token arm class selected"; need "line 2 is selected" $?
  ! has "$(grep '^PHASE4 ENTRY RESULT' <<< "$E")" "90-ops:2 names"; need "only the unselected line 4 blocks entry" $?
  entry_refused "--remove-grant /etc/sudoers.d/90-ops:2-2 is given twice" --remove-grant "$T2" --remove-grant "$T2" --remove-grant "$T4"
  entry_ok group-and-grants --remove-grant "$T2" --remove-grant "$T4"
  apply_ok
  [ "$(cat /etc/sudoers.d/90-ops)" = $'# ops (fixture)\ndeploy ALL=(root) /usr/bin/id' ]; need "90-ops holds exactly its comment and the deploy rule" $?
  has "$(sudo -n -l -U deploy 2>&1 < /dev/null | cat)" "/usr/bin/id"; need "deploy's unrelated rule still works" $?
  verify_is PASS; backout_is PASS; exact /etc/sudoers.d/90-ops /root/fixture-90-ops
  [ "$(snap)" = "$S0" ]; need "after backout: the whole snapshot equals pre-change" $?
  X="one-selected=REFUSED(line 4),duplicate=REFUSED,both=PASS,unrelated-kept,verify=PASS,backout=PASS(exact)";;
selection-refused)     # Astra case 4: ambiguous, changed, malformed or unknown selections are refused before any change
  add_rule /etc/sudoers.d/90-arm 0440 $'# fixture\nUser_Alias OPS = deploy, \\\n    arm\nOPS ALL=(ALL) NOPASSWD: ALL'
  entry_refused "names arm"; TOK=$(token_for /etc/sudoers.d/90-arm "$E"); L CHECK "listed token: $TOK"
  [[ $TOK == /etc/sudoers.d/90-arm:2-3:* ]]; need "the continued User_Alias is listed as ONE logical line, lines 2-3" $?
  F=${TOK%%:*}; R=${TOK#*:}; SPAN=${R%%:*}; R=${R#*:}; SS=${R%%:*}; FS=${R#*:}
  entry_refused "lines 2-2 are not exactly one logical line" --remove-grant "$F:2-2:$SS:$FS"
  entry_refused "the text of those lines differs from the reviewed listing" --remove-grant "$F:$SPAN:$(printf 'x\n' | sha256sum | cut -c1-64):$FS"
  entry_refused "is malformed" --remove-grant "$F:$SPAN:$SS"
  entry_refused "--remove-grant /etc/sudoers.d/91-none:1-1: /etc/sudoers.d/91-none is not a regular sudoers file here" --remove-grant "/etc/sudoers.d/91-none:1-1:$SS:$FS"
  run p4 entry --dispose /etc/sudoers.d/90-arm; [ $RC = 2 ] && has "$OUT" "--dispose (r9, file-wide) is withdrawn in r10"; need "--dispose is a usage error (exit 2)" $?
  printf '# reviewed, then edited\n' >> /etc/sudoers.d/90-arm; L FIXTURE "90-arm edited after the listing was reviewed"
  entry_refused "/etc/sudoers.d/90-arm changed since the reviewed listing" --remove-grant "$TOK"
  X="span=REFUSED,text=REFUSED,malformed=REFUSED,unknown-file=REFUSED,--dispose=usage,changed-file=REFUSED";;
old-snapshot-rejected) # Astra case 4: attempt 1 applied and backed out; attempt 2 applied. Back-out with attempt 1's state and seal,
                       # or attempt 2's state with attempt 1's seal, is refused before any change; attempt 2's printed back-out
                       # restores bytes, owner, mode and membership; attempt 1 cannot be applied again
  add_rule /etc/sudoers.d/90-arm 0440 $'# fixture\narm ALL=(ALL) NOPASSWD: ALL'
  cp -p /etc/sudoers.d/90-arm /root/fixture-90-arm; S0=$(snap); G0=$(id -Gn arm)
  entry_refused "names arm"; TOK=$(token_for /etc/sudoers.d/90-arm "$E")
  sleep 1.1; entry_ok group-and-grants --remove-grant "$TOK"; E1=$E; ST1=$ST; SL1=$SL; apply_ok; A1=$A; backout_is PASS
  sleep 1.1; entry_ok group-and-grants --remove-grant "$TOK"; ST2=$ST; SL2=$SL; apply_ok
  [ "$SL2" != "$SL1" ]; need "the two attempts have different seals although they record the same host state ($SL1 / $SL2)" $?
  B1=$(backout_cmd | sed "s#--state $ST2 --seal $SL2#--state $ST1 --seal $SL1#")
  refuse_is BACKOUT "this host records [$ST2 $SL2] as the applied attempt, not $ST1" "$B1"
  refuse_is BACKOUT "has seal $SL2, not the given $SL1" "$(backout_cmd | sed "s#--seal $SL2#--seal $SL1#")"
  refuse_is APPLY "this host records an applied attempt that has not been backed out" "$(printed ENTRY "apply (4.1, [ADM-ROOT])" "$E1")"
  backout_is PASS; exact /etc/sudoers.d/90-arm /root/fixture-90-arm
  [ "$(id -Gn arm)" = "$G0" ]; need "arm's membership is the original one ($G0)" $?
  [ "$(snap)" = "$S0" ]; need "the whole snapshot equals pre-change" $?
  refuse_is APPLY "this attempt was applied once already" "$(printed ENTRY "apply (4.1, [ADM-ROOT])" "$E1")"
  grep -c '' $AED/changes.log > /dev/null; L REAL "changes.log: $(tr '\n' '|' < $AED/changes.log)"
  [ "$(grep -c ' apply old=' $AED/changes.log)" = 2 ] && [ "$(grep -c ' backout old=' $AED/changes.log)" = 2 ]; need "changes.log records two applies and two back-outs, each with a new epoch" $?
  X="attempt1=apply+backout,attempt2=apply,old-state=REFUSED,old-seal=REFUSED,apply-while-applied=REFUSED,backout2=PASS(exact),reapply1=REFUSED";;
etc-sudoers-grant|refuse-select-percent-sudo) # /etc/sudoers carries an arm rule beside the stock %sudo line: the arm rule is selected
                       # and removed, %sudo is never edited and afldb-admin keeps its route; selecting the %sudo line is refused
  useradd -m -U -s /bin/bash afldb-admin && usermod -a -G sudo afldb-admin; L FIXTURE "$(id afldb-admin) (the admin: sudo by group, 1.8)"
  printf '%s\n' '# deploy access for arm (fixture)' 'arm ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers; visudo -c > /dev/null 2>&1; need "fixture: visudo -c with the appended arm rule" $?
  NS=$(grep -n '^%sudo[[:space:]]' /etc/sudoers | cut -d: -f1); NA=$(grep -n '^arm[[:space:]]' /etc/sudoers | cut -d: -f1); SL0=$(sed -n "${NS}p" /etc/sudoers)
  snapm() { snap | grep -vE ' /etc/(group|gshadow)$'; getent group sudo | cut -d: -f4 | tr ',' '\n' | sort | tr '\n' ' '; }
  cp -p /etc/sudoers /root/fixture-sudoers; S0=$(snapm); AL0=$(sudo -n -l -U afldb-admin 2>&1 < /dev/null | cat)
  entry_refused "/etc/sudoers:$NA names arm"; TOK=$(token_for /etc/sudoers "$E")
  if [ $N = etc-sudoers-grant ]; then
    sleep 1.1; entry_ok group-and-grants --remove-grant "$TOK"
    has "$E" "/etc/sudoers:$NS token %sudo class group-only"; need "%sudo stays group-only" $?
    has "$E" "KEEP %sudo line(s) $NS(%sudo)"; need "entry says to keep the %sudo line" $?
    apply_ok; verify_is PASS
    grep -qxF -- "$SL0" /etc/sudoers && ! grep -q '^arm[[:space:]]' /etc/sudoers; need "after apply: the %sudo line is there, the arm rule is gone" $?
    has "$V" "check admin-sudo-l PASS"; need "verify: sudo -l -U afldb-admin equals its pre-change record" $?
    backout_is PASS; exact /etc/sudoers /root/fixture-sudoers
    [ "$(snapm)" = "$S0" ]; need "after backout: the snapshot equals pre-change (sudo members compared as a set)" $?
    X="entry=PASS(%sudo kept),apply=PASS,verify=PASS(admin-sudo-l),backout=PASS(exact)"
  else
    FS=$(sha256sum < /etc/sudoers | cut -c1-64); SS=$(sed -n "${NS},${NS}p" /etc/sudoers | sha256sum | cut -c1-64)
    entry_refused "finds no grant other than %sudo on those lines" --remove-grant "/etc/sudoers:$NS-$NS:$SS:$FS" --remove-grant "$TOK"
    has "$(grep '^PHASE4 ENTRY RESULT' <<< "$E")" "those lines also hold %sudo"; need "the refusal says the selection holds %sudo" $?
    X="select-%sudo=REFUSED,nothing-changed"
  fi;;
refuse-mixed-line)     # one line names %sudo and arm: selecting it is refused, since no edit could keep one and not the other
  add_rule /etc/sudoers.d/86-mixed 0440 $'# fixture\n%sudo,arm ALL=(ALL) ALL'
  entry_refused "/etc/sudoers.d/86-mixed:2 names arm"; TOK=$(token_for /etc/sudoers.d/86-mixed "$E")
  entry_refused "--remove-grant /etc/sudoers.d/86-mixed:2-2: those lines also hold %sudo" --remove-grant "$TOK"
  X="entry=REFUSED(86-mixed:2 %sudo shares the line),nothing-changed";;
apply-host-changed)    # the host changed between entry and apply: apply refuses before any change, the epoch is unchanged
  entry_ok group-only; add_rule /etc/sudoers.d/95-late 0440 'deploy ALL=(root) /usr/bin/id'
  refuse_is APPLY "/etc/sudoers.d/95-late was added after entry" "$(printed ENTRY "apply (4.1, [ADM-ROOT])" "$E")"
  [ ! -e $AED/epoch ]; need "no epoch was written (the host never had one)" $?
  X="apply=REFUSED(95-late added),nothing-changed,no-epoch";;
invalidate)            # an access change outside the script, recorded by the owner: a new epoch and a log line, nothing else
  S0=$(snap); run p4 invalidate --reason "authorized_keys of afldb-admin rotated by hand"; e1=$(epoch)
  [ $RC = 0 ] && has "$OUT" "PHASE4 INVALIDATE RESULT PASS"; need "invalidate PASS" $?
  has "$OUT" "PHASE4 INVALIDATE VOID: STOP: every saved 4.4, 4.5 and 4.6 output"; need "invalidate prints VOID" $?
  [[ $e1 =~ ^[0-9a-f]{32}$ ]] && [ "$(stat -c '%U:%G %a' $AED/epoch)" = "root:root 644" ] && [ "$(stat -c '%U:%G %a' $AED)" = "root:root 755" ]; need "the epoch is 32 hex, root:root 0644, in a root:root 0755 directory" $?
  run p4 invalidate --reason "second change"; [ "$(epoch)" != "$e1" ]; need "a second invalidate writes another new epoch" $?
  grep -q 'invalidate old=none new=.* invalidate:_authorized_keys_of_afldb-admin_rotated_by_hand' $AED/changes.log; need "changes.log names the reason" $?
  [ "$(snap)" = "$S0" ]; need "nothing else changed" $?
  run p4 invalidate; [ $RC = 2 ]; need "invalidate without --reason is a usage error" $?
  X="invalidate=PASS(new epoch, logged, VOID),nothing-else-changed";;
late-grant)            # a grant file added after apply: verify STOP names it; back-out REFUSES before any change naming it; after
                       # the owner removes it by hand, back-out PASS and the state is pre-change
  S0=$(snap); entry_ok group-only; apply_ok
  add_rule /etc/sudoers.d/95-late 0440 'arm ALL=(ALL) NOPASSWD: ALL'
  verify_is STOP; has "$V" "/etc/sudoers.d/95-late was added"; need "verify names the added file" $?
  has "$V" "Do NOT return to step 4.1"; need "verify says back out, never go back to 4.1" $?
  has "$V" "--state $ST --seal $SL"; need "verify's STOP prints the back-out with this state and seal" $?
  refuse_is BACKOUT "/etc/sudoers.d/95-late was added after entry: review it in [CON], remove it by hand" "$(backout_cmd)"
  rm /etc/sudoers.d/95-late; L FIXTURE "the owner removes /etc/sudoers.d/95-late by hand after review"
  backout_is PASS; [ "$(snap)" = "$S0" ]; need "after the back-out: snapshot equals pre-change" $?
  X="verify=STOP(95-late added),backout=REFUSED(names 95-late),manual-rm,backout=PASS,state=pre-change";;
unplanned-edit)        # a change outside the plan: verify STOP; back-out REFUSES before any change naming the file and the exact
                       # restore command; after it is run by hand, back-out PASS
  S0=$(snap); entry_ok group-only; apply_ok
  printf '# an unplanned edit\n' >> /etc/sudoers.d/README
  verify_is STOP; has "$V" "/etc/sudoers.d/README changed outside the plan"; need "verify names README" $?
  refuse_is BACKOUT "/etc/sudoers.d/README is in neither its recorded nor its planned state" "$(backout_cmd)"
  FIX=$(sed -n 's/.*restore it by hand with: \(install [^,]*\), then run back-out again.*/\1/p' <<< "$OUT" | head -n 1); L CHECK "printed restore: $FIX"
  fresh "$FIX"; need "the printed restore command runs" $?
  backout_is PASS; [ "$(snap)" = "$S0" ]; need "after the back-out: snapshot equals pre-change" $?
  X="verify=STOP(README),backout=REFUSED(README),manual-restore,backout=PASS,state=pre-change";;
state-tamper)          # a state record changed after entry: apply, verify and backout refuse it and change nothing
  entry_ok group-only; chmod u+w $ST/groups.pre; echo extra >> $ST/groups.pre
  refuse_is APPLY "seal check (SHA256SUMS) failed" "$(printed ENTRY "apply (4.1, [ADM-ROOT])" "$E")"
  chmod u+w $ST/SHA256SUMS; (cd $ST && sha256sum -- groups.pre > /dev/null; sed -i "s/^[0-9a-f]\{64\}  groups.pre\$/$(sha256sum < $ST/groups.pre | cut -c1-64)  groups.pre/" SHA256SUMS)
  refuse_is APPLY "not the given $SL" "$(printed ENTRY "apply (4.1, [ADM-ROOT])" "$E")"
  X="tampered-record=REFUSED(seal),resealed=REFUSED(seal differs),nothing-changed";;
refuse-90-arm)         # an explicit grant naming arm, not selected: REFUSED; a refused state can never be applied or backed out
  add_rule /etc/sudoers.d/90-arm 0440 'arm ALL=(ALL) NOPASSWD: ALL'
  OCB=$(oc_b); L REAL "owner-checks: $(tr '\n' '|' <<< "$OCB")"
  entry_refused "/etc/sudoers.d/90-arm:1 names arm"; agree
  refuse_is APPLY "has seal none" "env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $P4 apply --state $ST --seal $(printf '0%.0s' {1..64})"
  refuse_is BACKOUT "has seal none" "env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $P4 backout --state $ST --seal $(printf '0%.0s' {1..64})"
  X="entry=REFUSED(90-arm:1 arm),apply/backout of it=REFUSED,nothing-changed";;
refuse-user-alias)     # a User_Alias naming arm
  add_rule /etc/sudoers.d/80-alias 0440 $'User_Alias OPS = deploy, arm\nOPS ALL=(ALL:ALL) ALL'
  OCB=$(oc_b); entry_refused "/etc/sudoers.d/80-alias:1 names arm"; agree
  X="entry=REFUSED(80-alias:1 arm),nothing-changed";;
refuse-group-adm)      # %adm while arm is in adm
  add_rule /etc/sudoers.d/70-adm 0440 '%adm ALL=(root) /usr/bin/journalctl'
  OCB=$(oc_b); entry_refused "/etc/sudoers.d/70-adm:1 names %adm"; agree
  X="entry=REFUSED(70-adm:1 %adm),nothing-changed";;
refuse-admin-group)    # arm in admin (sudo's other admin group; the default sudoers names %admin)
  groupadd admin && usermod -a -G admin arm; L FIXTURE "$(id arm)"
  entry_refused "arm is in group admin"
  X="entry=REFUSED(arm in admin),nothing-changed";;
refuse-include)        # an include directive with a target other than /etc/sudoers.d
  : > /etc/sudoers.local; chmod 0440 /etc/sudoers.local
  add_rule /etc/sudoers.d/60-inc 0440 '@include /etc/sudoers.local'
  entry_refused "include directive '@include /etc/sudoers.local' names a target other than /etc/sudoers.d"
  X="entry=REFUSED(@include /etc/sudoers.local),nothing-changed";;
refuse-escaped-alias)  # `ar\m` in a User_Alias is arm to sudo, and B3 does not see it
  add_rule /etc/sudoers.d/84-esc 0440 $'User_Alias OPS = deploy, ar\\m\nOPS ALL=(ALL) ALL'
  OCB=$(oc_b); has "$(grep '^CHECK B3 ' <<< "$OCB")" /etc/sudoers.d/84-esc; [ $? = 1 ]; need "owner-checks B3 (unchanged, at its pin) does not name 84-esc" $?
  entry_refused '/etc/sudoers.d/84-esc:1 names unparsed-alias-member:ar\m'
  X="entry=REFUSED(84-esc:1 unparsed-alias-member),B3-blind,nothing-changed";;
residual-uid|residual-all) # a grant B3 does not see (a uid-form rule; an ALL user): entry, stricter than B3, REFUSES it
  if [ $N = residual-uid ]; then F=/etc/sudoers.d/91-uid; add_rule $F 0440 '#1000 ALL=(ALL) NOPASSWD: ALL'; WANT="$F:1 names uid:#1000"
  else F=/etc/sudoers.d/92-all; add_rule $F 0440 'ALL ALL=(root) NOPASSWD: /usr/bin/id'; WANT="$F:1 names ALL-user"; fi
  OCB=$(oc_b); has "$(grep '^CHECK B3 ' <<< "$OCB")" "$F"; [ $? = 1 ]; need "owner-checks B3 (unchanged, at its pin) does not name $F" $?
  entry_refused "$WANT"; agree
  X="entry=REFUSED($WANT),B3-blind,nothing-changed";;
refuse-uid-alias)      # a User_Alias containing #1000 (arm's uid)
  add_rule /etc/sudoers.d/81-uidalias 0440 $'User_Alias OPS = deploy, #1000\nOPS ALL=(ALL:ALL) ALL'
  entry_refused "/etc/sudoers.d/81-uidalias:1 names uid:#1000"
  X="entry=REFUSED(81-uidalias:1 uid:#1000),nothing-changed";;
refuse-continued)      # the uid on a continuation line (B3 reads the physical line `    #1000` as a comment)
  add_rule /etc/sudoers.d/82-cont 0440 $'User_Alias OPS = deploy, \\\n    #1000\nOPS ALL=(ALL) ALL'
  entry_refused "/etc/sudoers.d/82-cont:1 names uid:#1000"
  X="entry=REFUSED(82-cont:1 uid:#1000, joined line),nothing-changed";;
refuse-negated)        # a !-negated User_Alias (everyone except deploy)
  add_rule /etc/sudoers.d/83-neg 0440 $'User_Alias OPS = !deploy\nOPS ALL=(ALL) ALL'
  entry_refused "/etc/sudoers.d/83-neg:1 names negated-in-User_Alias:!deploy"
  X="entry=REFUSED(83-neg:1 negated),nothing-changed";;
refuse-nsswitch)       # sudo rules from another source (sssd) that entry cannot read
  printf 'sudoers: files sss\n' >> /etc/nsswitch.conf; L FIXTURE "/etc/nsswitch.conf: $(grep -n '^sudoers' /etc/nsswitch.conf)"
  entry_refused "/etc/nsswitch.conf:$(grep -n '^sudoers' /etc/nsswitch.conf | cut -d: -f1) names sudoers-source:files,sss ('sudoers: files sss'): a sudo rule source entry cannot read"
  X="entry=REFUSED(nsswitch sudoers: files sss),nothing-changed";;
*) echo "STOP unknown scenario $N"; exit 2;;
esac
[ $OKS = 1 ] && echo "SCENARIO $N PASS expect=$X got=$X" || echo "SCENARIO $N FAIL expect=$X got=failed:$WHY"
