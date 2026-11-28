#!/bin/bash
# p4-scen.sh (R6 r9, 28 Nov 2026). REHEARSAL ONLY: runs INSIDE one disposable container on streamanator (pinned Ubuntu 24.04 image
# plus the sudo package; --network none, never --privileged, no bind mount), started by p4-host.sh. Never production.
# `docker run` as root stands in for both root sessions, [CON] and [ADM-ROOT] [HARNESS]. Every account, group and sudoers change
# below happens inside this container only [FIXTURE]. Real sudo, gpasswd and visudo run throughout [REAL].
# Usage: bash p4-scen.sh <scenario>; prints `SCENARIO <name> PASS|FAIL expect=... got=...`.
set -uo pipefail; export LC_ALL=C PATH=/usr/sbin:/usr/bin:/sbin:/bin
N=${1:?scenario}; IN=/root/p4; P4=$IN/afldb-phase4.sh; OC=$IN/afldb-owner-checks.sh; ST=/root/afldb-phase4-state
L() { printf '[%s] %s\n' "$1" "${*:2}"; }
p4() { env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc "$P4" "$@" < /dev/null; }
OKS=1; WHY=
need() { if [ "$2" = 0 ]; then L CHECK "ok   $1"; else L CHECK "FAIL $1"; OKS=0; WHY="$WHY $1;"; fi; }
has() { grep -qF -- "$2" <<< "$1"; }
snap() { sha256sum /etc/sudoers /etc/sudoers.d/* /etc/group /etc/gshadow; stat -c '%n %u %g %a' /etc/sudoers /etc/sudoers.d /etc/sudoers.d/*; id arm; sudo -n -l -U arm 2>&1 < /dev/null; }
arm_sudo() { setpriv --reuid=arm --regid=arm --init-groups /usr/bin/sudo -n /usr/bin/id -u 2>&1 < /dev/null | tail -n 1; }
oc_b() { timeout 300 env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc "$OC" --admin afldb-admin < /dev/null 2>&1 | grep -E '^CHECK B[1235] '; }
b3_files() { sed -n 's/^CHECK B3 FAIL .* in: *//p' <<< "$1" | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' ' '; }
entry_files() { sed -n 's/^PHASE4 ENTRY match \([^:]*\):.*/\1/p' <<< "$1" | sort -u | tr '\n' ' '; }
run() { local o rc; o=$("$@"); rc=$?; L RUN "$* (exit $rc)"; printf '%s\n' "$o" | sed 's/^/    /'; OUT=$o; RC=$rc; }
only_state_written() { # paths modified since the marker, outside the new state dir; /root itself gains it, and the bare /tmp
  local w                # directory entry changes when bash makes (and removes) a here-string file; both are logged
  w=$(find / -xdev \( -path /proc -o -path /sys -o -path /dev \) -prune -o -newer $IN/marker -print 2>/dev/null)
  L CHECK "paths modified since the marker: $(tr '\n' ' ' <<< "$w")" >&2
  grep -Ev "^(/root|/tmp|$ST(/.*)?)\$" <<< "$w"; }
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
entry_ok() { # args: expected change, then entry's extra arguments
  local ch=$1; shift; mark
  run p4 entry --state $ST "$@"; E=$OUT
  [ $RC = 0 ]; need "entry exit 0" $?
  has "$E" "PHASE4 ENTRY RESULT PASS change=$ch "; need "entry RESULT PASS change=$ch" $?
  local w; w=$(only_state_written); [ -z "$w" ]; need "entry wrote nothing outside $ST (found: ${w//$'\n'/ })" $?
}
entry_refused() { # args: expected reason substring, then entry's extra arguments
  local why=$1 s0 w; shift; s0=$(snap); mark
  run p4 entry --state $ST "$@"; E=$OUT
  [ $RC = 1 ]; need "entry exit 1" $?
  has "$E" "PHASE4 ENTRY RESULT REFUSED"; need "entry RESULT REFUSED" $?
  has "$(grep '^PHASE4 ENTRY RESULT' <<< "$E")" "$why"; need "the refusal names: $why" $?
  [ "$(snap)" = "$s0" ]; need "nothing changed: sudoers scope, group files, arm's groups and sudo -l -U arm equal the pre-entry snapshot" $?
  w=$(only_state_written); [ -z "$w" ]; need "entry wrote nothing outside $ST (found: ${w//$'\n'/ })" $?
}
owner_edit() { # the owner's 4.1 edit of a disposed file with visudo -f; the editor deletes the lines that begin with "arm"
  chmod 0755 $IN/p4-ed-remove-arm.sh
  SUDO_EDITOR=$IN/p4-ed-remove-arm.sh VISUAL=$IN/p4-ed-remove-arm.sh EDITOR=$IN/p4-ed-remove-arm.sh visudo -f "$1" < /dev/null; need "visudo -f $1 exit 0" $?
  visudo -c > /dev/null 2>&1; need "visudo -c after the owner edit" $?
  L REAL "$1 after the owner edit: $(stat -c '%U:%G %a' "$1"), sha256 $(sha256sum < "$1" | cut -c1-16)..., content: [$(tr '\n' ';' < "$1")]"
}
step41() { gpasswd -d arm sudo; need "step 4.1 gpasswd -d arm sudo" $?; L REAL "after 4.1: $(id arm); $(getent group sudo)"; }
verify_is() { run p4 verify --state $ST; V=$OUT; has "$V" "PHASE4 VERIFY RESULT $1"; need "verify RESULT $1" $?; }
backout_is() { run p4 backout --state $ST; K=$OUT; has "$K" "PHASE4 BACKOUT RESULT $1"; need "backout RESULT $1" $?; }
agree() { # every file owner-checks B3 reports is among entry's matched files (entry is deliberately stricter than B3)
  local b e x miss=; b=$(b3_files "$OCB"); e=$(entry_files "$E"); L CHECK "owner-checks B3 files [$b], entry match files [$e]"
  for x in $b; do [[ " $e " == *" $x "* ]] || miss="$miss $x"; done
  [ -z "$miss" ]; need "every B3 file is among entry's matches (missing:${miss:- none})" $?; }

# the disposed rule's file carries a comment header: visudo -f refuses to install an empty file ("zero length temporary file")
RULE90=$'# deploy access for arm (fixture)\narm ALL=(ALL) NOPASSWD: ALL'
fixture
case $N in
group-only)            # (i) production's shape: entry PASS group-only; 4.1; verify PASS; owner-checks B1/B2/B3/B5 before and after
  OCB=$(oc_b); L REAL "owner-checks before: $(tr '\n' '|' <<< "$OCB")"
  entry_ok group-only
  [ "$(grep -c '^PHASE4 ENTRY match ' <<< "$E")" = 1 ] && has "$E" "token %sudo class group-only"; need "exactly one match, %sudo, class group-only" $?
  agree
  step41; verify_is PASS
  OCA=$(oc_b); L REAL "owner-checks after: $(tr '\n' '|' <<< "$OCA")"
  for c in B1 B2 B3 B5; do grep -q "^CHECK $c PASS" <<< "$OCA"; need "owner-checks $c PASS after Phase 4" $?; done
  X="entry=PASS(group-only),verify=PASS,B1-B3,B5=PASS";;
group-only-backout)    # (iii) the documented back-out after the group-only change restores the pre-change state
  S0=$(snap); entry_ok group-only; step41; verify_is PASS
  backout_is PASS
  [ "$(snap)" = "$S0" ]; need "after backout: sudoers scope, /etc/group, /etc/gshadow, id arm and sudo -l -U arm equal the pre-change snapshot" $?
  X="entry=PASS,verify=PASS,backout=PASS,state=pre-change";;
refuse-90-arm)         # (ii) an explicit grant naming arm
  add_rule /etc/sudoers.d/90-arm 0440 'arm ALL=(ALL) NOPASSWD: ALL'
  OCB=$(oc_b); L REAL "owner-checks: $(tr '\n' '|' <<< "$OCB")"
  entry_refused "/etc/sudoers.d/90-arm:1 names arm"; agree
  run p4 verify --state $ST; [ $RC = 1 ] && has "$OUT" "PHASE4 VERIFY RESULT STOP"; need "verify refuses a REFUSED entry's state" $?
  run p4 backout --state $ST; [ $RC = 1 ] && has "$OUT" "PHASE4 BACKOUT RESULT FAIL"; need "backout refuses a REFUSED entry's state" $?
  X="entry=REFUSED(90-arm:1 arm),nothing-changed";;
refuse-user-alias)     # (ii) a User_Alias naming arm
  add_rule /etc/sudoers.d/80-alias 0440 $'User_Alias OPS = deploy, arm\nOPS ALL=(ALL:ALL) ALL'
  OCB=$(oc_b); entry_refused "/etc/sudoers.d/80-alias:1 names arm"; agree
  X="entry=REFUSED(80-alias:1 arm),nothing-changed";;
refuse-group-adm)      # (ii) %adm while arm is in adm
  add_rule /etc/sudoers.d/70-adm 0440 '%adm ALL=(root) /usr/bin/journalctl'
  OCB=$(oc_b); entry_refused "/etc/sudoers.d/70-adm:1 names %adm"; agree
  X="entry=REFUSED(70-adm:1 %adm),nothing-changed";;
refuse-admin-group)    # (ii) arm in admin (sudo's other admin group; the default sudoers names %admin)
  groupadd admin && usermod -a -G admin arm; L FIXTURE "$(id arm)"
  entry_refused "arm is in group admin"
  X="entry=REFUSED(arm in admin),nothing-changed";;
refuse-include)        # (ii) an include directive with a target other than /etc/sudoers.d
  : > /etc/sudoers.local; chmod 0440 /etc/sudoers.local
  add_rule /etc/sudoers.d/60-inc 0440 '@include /etc/sudoers.local'
  entry_refused "include directive '@include /etc/sudoers.local' names a target other than /etc/sudoers.d"
  X="entry=REFUSED(@include /etc/sudoers.local),nothing-changed";;
refuse-dispose-nomatch) # (ii) --dispose of a file with no match
  entry_refused "--dispose /etc/sudoers.d/README: entry reports no match in it" --dispose /etc/sudoers.d/README
  X="entry=REFUSED(--dispose without a match),nothing-changed";;
disposed|disposed-removed) # (iv) an explicitly disposed rule: entry --dispose; owner edit (visudo -f), or removal of the file;
                       # 4.1; verify PASS; backout restores the file byte-identically with its owner and mode; arm sudo as before
  add_rule /etc/sudoers.d/90-arm 0440 "$RULE90"
  cp -p /etc/sudoers.d/90-arm /root/fixture-90-arm; PRE_L=$(sudo -n -l -U arm 2>&1 < /dev/null); S0=$(snap)
  [ "$(arm_sudo)" = 0 ]; need "before: arm runs sudo -n id -u as root (the disposed NOPASSWD rule)" $?
  entry_ok group-and-disposed --dispose /etc/sudoers.d/90-arm
  has "$E" "/etc/sudoers.d/90-arm:2 token arm class disposed"; need "90-arm:2 classified disposed" $?
  has "$E" "back-out 2 ([CON]): install -o 0 -g 0 -m 0440 $ST/copy."; need "entry prints the exact disposed back-out with owner 0:0 mode 0440" $?
  if [ $N = disposed ]; then owner_edit /etc/sudoers.d/90-arm
  else rm /etc/sudoers.d/90-arm; need "the owner removes /etc/sudoers.d/90-arm" $?; fi
  step41
  A=$(arm_sudo); [ "$A" != 0 ]; need "after 4.1: arm can no longer sudo -n ($A)" $?
  verify_is PASS
  backout_is PASS
  cmp -s /root/fixture-90-arm /etc/sudoers.d/90-arm; need "after backout: 90-arm is byte-identical to the fixture copy" $?
  A=$(stat -c '%U:%G %a' /etc/sudoers.d/90-arm); [ "$A" = "root:root 440" ]; need "after backout: 90-arm is root:root 0440 ($A)" $?
  visudo -c > /dev/null 2>&1; need "after backout: visudo -c" $?
  [ "$(arm_sudo)" = 0 ]; need "after backout: arm runs sudo -n id -u as root again" $?
  [ "$(sudo -n -l -U arm 2>&1 < /dev/null)" = "$PRE_L" ]; need "after backout: sudo -l -U arm equals the pre-change answer" $?
  [ "$(snap)" = "$S0" ]; need "after backout: the whole snapshot equals pre-change" $?
  X="entry=PASS(group-and-disposed),verify=PASS,backout=PASS,rule=byte-identical,arm-sudo=as-before";;
dispose-etc-sudoers|dispose-removes-percent-sudo) # R9-F-2: /etc/sudoers carries an extra arm rule beside the stock %sudo line, and
                       # is disposed. %sudo stays group-only and is never listed for change. The owner removes only the arm rule:
                       # verify PASS, %sudo intact, afldb-admin's sudo -l unchanged, backout exact. Or the owner WRONGLY deletes the
                       # %sudo line too: verify STOP naming it; backout restores /etc/sudoers exactly
  useradd -m -U -s /bin/bash afldb-admin && usermod -a -G sudo afldb-admin; L FIXTURE "$(id afldb-admin) (the admin: sudo by group, 1.8)"
  printf '%s\n' '# deploy access for arm (fixture)' 'arm ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers; visudo -c > /dev/null 2>&1; need "fixture: visudo -c with the appended arm rule" $?
  NS=$(grep -n '^%sudo[[:space:]]' /etc/sudoers | cut -d: -f1); NA=$(grep -n '^arm[[:space:]]' /etc/sudoers | cut -d: -f1)
  SL=$(sed -n "${NS}p" /etc/sudoers); SLS=$(printf '%s' "$SL" | tr -c '\40-\176' '?')   # SLS: as the script prints it (a tab is ?)
  L FIXTURE "/etc/sudoers: %sudo at line $NS [$SLS], arm rule at line $NA"
  # two members of sudo now (arm, afldb-admin): gpasswd -a re-adds arm at the end, so the group files are compared by membership
  snapm() { snap | grep -vE ' /etc/(group|gshadow)$'; getent group sudo | cut -d: -f4 | tr ',' '\n' | sort | tr '\n' ' '; }
  cp -p /etc/sudoers /root/fixture-sudoers; S0=$(snapm); AL0=$(sudo -n -l -U afldb-admin 2>&1 < /dev/null | cat)
  has "$AL0" "(ALL : ALL) ALL"; need "before: afldb-admin may run (ALL : ALL) ALL" $?
  entry_ok group-and-disposed --dispose /etc/sudoers
  has "$E" "/etc/sudoers:$NS token %sudo class group-only"; need "%sudo in the disposed /etc/sudoers is classified group-only" $?
  has "$E" "/etc/sudoers:$NA token arm class disposed"; need "the arm rule (line $NA) is classified disposed" $?
  has "$E" "removing or changing ONLY line(s) $NA(arm) and no other line; KEEP line(s) $NS(%sudo) exactly as they are"; need "the 4.1 instruction names only line $NA and says to keep line $NS" $?
  if [ $N = dispose-etc-sudoers ]; then
    owner_edit /etc/sudoers; step41; verify_is PASS
    has "$V" "check kept PASS /etc/sudoers: only its disposed line(s) $NA(arm) changed"; need "verify: every other line byte-identical, %sudo included" $?
    has "$V" "check admin-sudo-l PASS"; need "verify: sudo -l -U afldb-admin equals its pre-change record" $?
    grep -qxF -- "$SL" /etc/sudoers; need "the %sudo line is still in /etc/sudoers" $?
    has "$(sudo -n -l -U afldb-admin 2>&1 < /dev/null)" "(ALL : ALL) ALL"; need "after 4.1: afldb-admin may still run (ALL : ALL) ALL" $?
    A=$(arm_sudo); [ "$A" != 0 ]; need "after 4.1: arm can no longer sudo -n ($A)" $?
    backout_is PASS
    cmp -s /root/fixture-sudoers /etc/sudoers; need "after backout: /etc/sudoers is byte-identical to the fixture copy" $?
    [ "$(arm_sudo)" = 0 ]; need "after backout: arm runs sudo -n id -u as root again" $?
    [ "$(snapm)" = "$S0" ]; need "after backout: the snapshot equals pre-change (sudo members compared as a set)" $?
    X="entry=PASS(%sudo group-only, only line $NA listed),verify=PASS(kept,admin-sudo-l),backout=PASS,exact"
  else
    sed -i '/^arm[[:space:]]/d; /^%sudo[[:space:]]/d' /etc/sudoers; visudo -c > /dev/null 2>&1; need "visudo -c after the wrong edit (it is valid sudoers)" $?
    L FIXTURE "the owner WRONGLY deletes the %sudo line too: $(grep -c '^%sudo' /etc/sudoers) %sudo line(s) left"
    step41; verify_is STOP
    has "$V" "/etc/sudoers:$NS ('$SLS') was changed or removed, but 4.0 did not name it for change (it is %sudo, group-only"; need "verify names the removed %sudo line" $?
    has "$V" "sudo -l -U afldb-admin differs from the pre-change record"; need "verify names afldb-admin's lost route" $?
    has "$V" "Do NOT return to step 4.1"; need "verify says back out" $?
    backout_is PASS
    cmp -s /root/fixture-sudoers /etc/sudoers; need "after backout: /etc/sudoers is byte-identical to the fixture copy (%sudo back)" $?
    [ "$(sudo -n -l -U afldb-admin 2>&1 < /dev/null | cat)" = "$AL0" ]; need "after backout: afldb-admin's sudo -l equals the pre-change answer" $?
    [ "$(snapm)" = "$S0" ]; need "after backout: the snapshot equals pre-change (sudo members compared as a set)" $?
    X="verify=STOP(%sudo line $NS removed,afldb-admin route),backout=PASS,exact"
  fi;;
refuse-dispose-percent-sudo) # --dispose of a file whose only match is %sudo
  entry_refused "--dispose /etc/sudoers: its only match is %sudo" --dispose /etc/sudoers
  X="entry=REFUSED(--dispose /etc/sudoers: only %sudo),nothing-changed";;
refuse-mixed-line)     # one line names %sudo and arm in a disposed file: no edit could keep one and not the other
  add_rule /etc/sudoers.d/86-mixed 0440 $'# fixture\n%sudo,arm ALL=(ALL) ALL'
  entry_refused "/etc/sudoers.d/86-mixed:2 (%sudo, lines 2-2) shares a line with the disposed match /etc/sudoers.d/86-mixed:2 (arm)" --dispose /etc/sudoers.d/86-mixed
  X="entry=REFUSED(86-mixed:2 %sudo shares a line with arm),nothing-changed";;
refuse-escaped-alias)  # R9-F-5: `ar\m` in a User_Alias is arm to sudo, and B3 does not see it
  add_rule /etc/sudoers.d/84-esc 0440 $'User_Alias OPS = deploy, ar\\m\nOPS ALL=(ALL) ALL'
  has "$(sudo -n -l -U arm 2>&1 < /dev/null | cat)" "(ALL) ALL"; need "sudo itself reads ar\\m as arm (sudo -l -U arm lists the OPS rule '(ALL) ALL')" $?
  OCB=$(oc_b); has "$(grep '^CHECK B3 ' <<< "$OCB")" /etc/sudoers.d/84-esc; [ $? = 1 ]; need "owner-checks B3 (unchanged, at its pin) does not name 84-esc" $?
  entry_refused '/etc/sudoers.d/84-esc:1 names unparsed-alias-member:ar\m'
  X="entry=REFUSED(84-esc:1 unparsed-alias-member),B3-blind,nothing-changed";;
residual-uid|residual-all) # (v) a grant B3 does not see (a uid-form rule; an ALL user): entry, stricter than B3, REFUSES it
  if [ $N = residual-uid ]; then F=/etc/sudoers.d/91-uid; add_rule $F 0440 '#1000 ALL=(ALL) NOPASSWD: ALL'; WANT="$F:1 names uid:#1000"
  else F=/etc/sudoers.d/92-all; add_rule $F 0440 'ALL ALL=(root) NOPASSWD: /usr/bin/id'; WANT="$F:1 names ALL-user"; fi
  OCB=$(oc_b); L REAL "owner-checks: $(tr '\n' '|' <<< "$OCB")"
  has "$(grep '^CHECK B3 ' <<< "$OCB")" "$F"; [ $? = 1 ]; need "owner-checks B3 (unchanged, at its pin) does not name $F" $?
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
late-grant)            # a grant file added after entry PASS and before 4.1: verify STOP names it; backout FAILs naming it (it never
                       # deletes an unplanned file); after the owner removes it by hand, backout PASS and the state is pre-change
  S0=$(snap); entry_ok group-only
  add_rule /etc/sudoers.d/95-late 0440 'arm ALL=(ALL) NOPASSWD: ALL'; step41
  verify_is STOP; has "$V" "/etc/sudoers.d/95-late was added"; need "verify names the added file" $?
  has "$V" "Do NOT return to step 4.1"; need "verify says back out, never go back to 4.1" $?
  backout_is FAIL; has "$K" "/etc/sudoers.d/95-late was added after entry: review and remove it by hand"; need "backout names the added file and does not delete it" $?
  [ -e /etc/sudoers.d/95-late ]; need "the added file is still present (backout deletes nothing it did not plan)" $?
  id -nG arm | tr ' ' '\n' | grep -qx sudo; need "backout restored arm's sudo membership" $?
  rm /etc/sudoers.d/95-late; L FIXTURE "the owner removes /etc/sudoers.d/95-late by hand after review"
  backout_is PASS; [ "$(snap)" = "$S0" ]; need "after the second backout: snapshot equals pre-change" $?
  X="verify=STOP(95-late added),backout=FAIL(names 95-late),manual-rm,backout=PASS,state=pre-change";;
old-r8-backout)        # (vi) the r8 back-out text, gpasswd -a arm sudo alone, after the (iv) change: the disposed rule is LOST
  add_rule /etc/sudoers.d/90-arm 0440 "$RULE90"
  cp -p /etc/sudoers.d/90-arm /root/fixture-90-arm; PRE_L=$(sudo -n -l -U arm 2>&1 < /dev/null)
  [ "$(arm_sudo)" = 0 ]; need "before: arm runs sudo -n id -u as root (the disposed NOPASSWD rule)" $?
  entry_ok group-and-disposed --dispose /etc/sudoers.d/90-arm; owner_edit /etc/sudoers.d/90-arm; step41; verify_is PASS
  gpasswd -a arm sudo; L REAL "r8 back-out text run: gpasswd -a arm sudo -> $(id arm)"
  LOST=0
  cmp -s /root/fixture-90-arm /etc/sudoers.d/90-arm || { LOST=$((LOST + 1)); L CHECK "lost: 90-arm differs from the pre-change rule (now [$(tr '\n' ';' < /etc/sudoers.d/90-arm)], $(stat -c '%U:%G %a' /etc/sudoers.d/90-arm))"; }
  [ "$(arm_sudo)" = 0 ] || { LOST=$((LOST + 1)); L CHECK "lost: arm's NOPASSWD sudo is gone ($(arm_sudo))"; }
  [ "$(sudo -n -l -U arm 2>&1 < /dev/null)" = "$PRE_L" ] || { LOST=$((LOST + 1)); L CHECK "lost: sudo -l -U arm differs from pre-change: $(sudo -n -l -U arm 2>&1 | grep -E '^ +\(' | tr '\n' ';')"; }
  [ $LOST = 3 ]; need "the r8 back-out text does NOT restore the previous state (3 of 3 differences)" $?
  backout_is PASS; cmp -s /root/fixture-90-arm /etc/sudoers.d/90-arm && [ "$(arm_sudo)" = 0 ]; need "the r9 backout then restores the rule and arm's sudo" $?
  X="r8-backout=LOST(rule,NOPASSWD,sudo-l),r9-backout=PASS";;
unplanned-edit)        # (vii) a change outside the plan: verify STOP; backout FAIL naming the file (never silently overwritten)
  entry_ok group-only
  printf '# an unplanned edit\n' >> /etc/sudoers.d/README; step41
  verify_is STOP; has "$V" "/etc/sudoers.d/README changed outside the plan"; need "verify names README" $?
  backout_is FAIL; has "$K" "/etc/sudoers.d/README changed outside the plan"; need "backout names README" $?
  id -nG arm | tr ' ' '\n' | grep -qx sudo; need "backout still restored arm's sudo membership" $?
  X="verify=STOP(README),backout=FAIL(README),group-restored";;
state-tamper)          # (viii) a state record changed after entry: verify and backout refuse it and change nothing
  entry_ok group-only; chmod u+w $ST/groups.pre; echo extra >> $ST/groups.pre; step41; S1=$(snap)
  verify_is STOP; has "$V" "seal check (SHA256SUMS) failed"; need "verify names the seal" $?
  backout_is FAIL; has "$K" "seal check (SHA256SUMS) failed"; need "backout names the seal" $?
  [ "$(snap)" = "$S1" ]; need "the refused backout changed nothing" $?
  X="verify=STOP(seal),backout=FAIL(seal),nothing-changed";;
*) echo "STOP unknown scenario $N"; exit 2;;
esac
[ $OKS = 1 ] && echo "SCENARIO $N PASS expect=$X got=$X" || echo "SCENARIO $N FAIL expect=$X got=failed:$WHY"
