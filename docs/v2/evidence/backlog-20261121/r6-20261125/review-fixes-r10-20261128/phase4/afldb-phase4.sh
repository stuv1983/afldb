#!/usr/bin/bash
# afldb-phase4.sh (R6 r10, 28 Nov 2026): entry, apply, realised-change check, back-out and access-epoch invalidation for removing
# arm's sudo, OWNER-PROCEDURE.md Phase 4 (steps 4.0-4.2 and the back-out). PREPARED, NOT RUN ON PRODUCTION BY CLAUDE; rehearsed only
# in disposable containers on streamanator (p4-run.sh). Run AS ROOT from the root-owned staged copy, never in a session that
# descends from arm:   env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc /root/afldb-r10-phase4/afldb-phase4.sh CMD ...
#   entry [--remove-grant FILE:START-END:SPAN-SHA256:FILE-SHA256]...
#           [ADM-ROOT], step 4.0. Creates its OWN new root-only state directory /root/afldb-phase4/attempt-<UTC time>-<8 hex>, records
#           the pre-change state there, and approves or refuses the change. Writes nothing outside that directory. It lists every
#           grant it finds; a grant other than %sudo is removed only when the owner selects it with its exact --remove-grant token
#           (the file, its physical lines, the sha256 of those lines and of the whole file, as captured). Every grant left
#           unselected blocks entry, a second grant in the same file included. On PASS it prints `PHASE4 STATE <dir>` and
#           `PHASE4 SEAL <sha256>`, and the exact apply, verify and back-out commands carrying both.
#   apply   --state DIR --seal SHA  [ADM-ROOT], step 4.1. Refuses, BEFORE any change, unless DIR is a sealed PASS entry with that
#           seal, no other attempt is applied, and the host still equals DIR's record. Then it writes a NEW access epoch, records
#           DIR as the applied attempt, installs each changed file (the captured copy minus the selected lines, checked with
#           visudo -cf at entry) with its recorded owner, group and mode, runs `gpasswd -d arm sudo` and `visudo -c`, and restores
#           everything itself if any of that fails.
#   verify  --state DIR --seal SHA  [ADM-ROOT], step 4.2. The realised change is exactly the approved one and arm cannot sudo.
#   backout --state DIR --seal SHA  [CON], any root console session, also a fresh one. Refuses, BEFORE any change, unless DIR with
#           that seal is the attempt this host records as applied and every sudoers file and arm's groups are in either their
#           recorded or their planned state. Then it writes a NEW access epoch, restores each changed file (bytes, owner, group,
#           mode) and arm's sudo membership, runs visudo -c, and proves the pre-change state.
#   invalidate --reason TEXT        [ADM-ROOT] or [CON]. Writes a NEW access epoch and logs TEXT. For an access change made outside
#           this script (an account, group, key, sudoers or PAM change the owner knows of): it voids every saved 4.4-4.6 and gate verdict.
# ACCESS EPOCH (r10, Astra case 3): /var/lib/afldb-access/epoch (root, 0644, 32 hex; history in changes.log; the applied attempt in
# applied). apply, backout and invalidate write a new value BEFORE they change anything. The owner verifier appends it to every
# RESULT line (access-epoch=) and 4.4/4.5 save it on their second line; afldb-gate-accept.sh requires one value from 4.4 to the
# gate verdict. Each of these commands ends by printing VOID: every saved 4.4, 4.5, 4.6 and gate verdict made before it is void.
# r10 withdraws r9's file-wide --dispose (Astra case 4): a usage error now.
# entry is DELIBERATELY STRICTER than afldb-owner-checks.sh B3, which is unchanged (and stays at its pin). Its matches are:
#   (B3)     every match of B3's own rules, unchanged: a non-comment line of /etc/sudoers or of a file directly in /etc/sudoers.d
#            that names arm, or %<g> for a group g arm is in;
#   (strict) on logical lines (a trailing backslash joins the next line; `#<digits>` and `#include` are NOT comments): a uid form
#            #<n> that is arm's uid or resolves to arm; %#<gid> for a gid arm is in; any non-Unix group %:<g>; any netgroup +<n>
#            (it cannot be resolved offline); a user spec or User_Alias member that is ALL or !-negated; a user list, or a User_Alias
#            member, holding a backslash or a quote (sudoers collapses escapes: `ar\m` is arm), which it does not try to parse;
#   (source) sudo rules outside the files it reads: an /etc/nsswitch.conf `sudoers:` line naming anything but `files`; an LDAP
#            (SUDOERS_BASE, /etc/sudo-ldap.conf) or sssd sudo configuration; any active Plugin line in /etc/sudo.conf.
# entry classifies each match:
#   group-only  the B3 token %sudo, decided FIRST: `gpasswd -d arm sudo` removes it, `gpasswd -a arm sudo` restores it, and its line
#               is NEVER edited (it is also afldb-admin's route to root, 1.8); a selection whose lines hold a %sudo match is refused;
#   selected    a match on the physical lines of a --remove-grant token whose two digests equal the captured copy: apply removes
#               exactly those lines and nothing else;
#   unrelated   anything else: REFUSED, naming file:line, token and the --remove-grant token that would select it.
# entry also REFUSES: arm not in sudo; arm in admin or wheel; an include directive other than includedir /etc/sudoers.d; a link,
# non-regular file or unusual name in /etc/sudoers.d; a malformed, duplicate, overlapping, unknown or out-of-date --remove-grant
# token (one whose file or lines changed since they were reviewed); a changed file that visudo -cf refuses.
# A grant added after entry, or a form none of these rules knows, is caught by verify (`sudo -l -U arm`, the file inventory and the
# same rescan), whose answer is then STOP: back out, dispose of it separately. Conservative by design: when unsure, it refuses.
# Output: `PHASE4 <CMD> ...` lines, ending `PHASE4 ENTRY RESULT PASS change=group-only|group-and-grants ...` or `... REFUSED
# <reasons>`, `PHASE4 APPLY RESULT PASS|REFUSED|FAIL`, `PHASE4 VERIFY RESULT PASS|STOP`, `PHASE4 BACKOUT RESULT PASS|REFUSED|FAIL`,
# `PHASE4 INVALIDATE RESULT PASS|FAIL`. REFUSED always means nothing was changed. Exit 0 PASS, 1 otherwise, 2 usage.
# No secret is read or printed: sudoers files hold none, and only group names and members are read, never a gshadow password field.
set -u -o pipefail
export LC_ALL=C PATH=/usr/sbin:/usr/bin
umask 077
cd / || exit 90
shopt -s nullglob
usage() { echo "usage: afldb-phase4.sh entry [--remove-grant FILE:START-END:SPAN-SHA256:FILE-SHA256]... | apply|verify|backout --state DIR --seal SHA256 | invalidate --reason TEXT"; [ -n "${1:-}" ] && echo "refused: $1"; exit 2; }
CMD=${1:-}; [ $# -gt 0 ] && shift
STATE=; SEAL=; SEL=(); REASON=
while [ $# -gt 0 ]; do
  case $1 in
    --state) [ $# -ge 2 ] || usage; STATE=$2; shift 2;;
    --seal) [ $# -ge 2 ] || usage; SEAL=$2; shift 2;;
    --remove-grant) [ $# -ge 2 ] && [ "$CMD" = entry ] || usage; SEL+=("$2"); shift 2;;
    --reason) [ $# -ge 2 ] && [ "$CMD" = invalidate ] || usage; REASON=$2; shift 2;;
    --dispose) usage "--dispose (r9, file-wide) is withdrawn in r10: run entry without options, then select each reviewed grant with the --remove-grant token entry prints";;
    *) usage;;
  esac
done
P4ROOT=/root/afldb-phase4
case $CMD in
  entry) WORD=REFUSED; [ -z "$STATE$SEAL" ] || usage "entry creates its own new state directory under $P4ROOT; give no --state or --seal";;
  apply|backout) WORD=REFUSED;;
  verify) WORD=STOP;;
  invalidate) WORD=FAIL; [ -z "$STATE$SEAL" ] || usage; [ -n "$REASON" ] || usage "invalidate needs --reason TEXT (what changed, outside this script)";;
  *) usage;;
esac
if [[ $CMD == apply || $CMD == verify || $CMD == backout ]]; then
  [[ $STATE =~ ^$P4ROOT/attempt-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || usage "--state must be the directory entry printed: $P4ROOT/attempt-<YYYYMMDDTHHMMSSZ>-<8 hex>"
  [[ $SEAL =~ ^[0-9a-f]{64}$ ]] || usage "--seal must be the 64-hex PHASE4 SEAL value entry printed"
fi
TAG=${CMD^^}; S=$STATE; BAD=()
san() { printf '%s' "$*" | tr -c '\40-\176' '?' | cut -c1-2000; }
say() { printf 'PHASE4 %s %s\n' "$TAG" "$(san "$*")"; }
flag() { BAD+=("$(san "$*")"); say "$WORD $*"; }
finish() { # PASS detail
  if [ ${#BAD[@]} = 0 ]; then say "RESULT PASS $*"; exit 0; fi
  local IFS=';'; say "RESULT $WORD ${BAD[*]}"; exit 1
}
die() { flag "$*"; finish; }

# ------------------------------------------------------------------------------------------------ the session
[ "$(id -u)" = 0 ] || die "not root: run in [ADM-ROOT] (entry, verify) or [CON] as root (backout)"
ARM_UID=$(id -u arm 2>/dev/null) || die "no account arm on this host"
p=$$; n=0
while [ "$p" -gt 0 ] 2>/dev/null && [ $n -lt 64 ]; do
  read -r _ ru eu su fu < <(grep '^Uid:' "/proc/$p/status" 2>/dev/null) || break
  lu=$(cat "/proc/$p/loginuid" 2>/dev/null)
  for x in "$ru" "$eu" "$su" "$fu" "$lu"; do [ "$x" = "$ARM_UID" ] && die "this root session descends from arm (pid $p): use [CON] or [ADM-ROOT]"; done
  tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -Eqx "SUDO_USER=arm|SUDO_UID=$ARM_UID" && die "this root session descends from arm (pid $p has SUDO_USER/SUDO_UID of arm)"
  p=$(awk '/^PPid:/ {print $2}' "/proc/$p/status"); n=$((n + 1))
done

# ------------------------------------------------------------------------------------------------ facts
arm_groups() { id -Gn arm 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u; }
dirstat() { stat -c '%u %g %a %F' /etc/sudoers.d 2>/dev/null || echo absent; }
inv() { # one line per entry of /etc/sudoers and /etc/sudoers.d (dot files too): PATH UID GID MODE SHA256, or PATH LINK|TYPE:<t>
  local f
  for f in /etc/sudoers /etc/sudoers.d/* /etc/sudoers.d/.[!.]* /etc/sudoers.d/..?*; do
    [[ $f =~ ^/etc/sudoers(\.d/[A-Za-z0-9._~-]+)?$ ]] || { echo "$(san "$f" | tr ' ' '?') BADNAME"; continue; }
    if [ -L "$f" ]; then echo "$f LINK"
    elif [ -f "$f" ]; then echo "$f $(stat -c '%u %g %a' -- "$f") $(sha256sum < "$f" | cut -c1-64)"
    elif [ -e "$f" ]; then echo "$f TYPE:$(stat -c %F -- "$f" | tr ' ' _)"; fi
  done
}
b3_files() { B3F=(); [ -e /etc/sudoers ] && B3F+=(/etc/sudoers); local f; for f in /etc/sudoers.d/*; do [ -f "$f" ] && B3F+=("$f"); done; }
scan() { # FILE<TAB>LINE<TAB>TOKEN<TAB>TEXT for each (line, name) that owner-checks B3 matches; B3's own expressions, per name
  local f l nm g names=(arm)
  for g in $(id -Gn arm 2>/dev/null); do [[ $g =~ ^[A-Za-z0-9_.-]+$ ]] && names+=("%$g"); done
  b3_files
  for f in "${B3F[@]}"; do
    while IFS= read -r l; do
      for nm in "${names[@]}"; do
        grep -qE "(^|[^A-Za-z0-9_.%-])(${nm//./\\.})([^A-Za-z0-9_.-]|\$)" <<< "${l#*:}" && printf '%s\t%s\t%s\t%s\n' "$f" "${l%%:*}" "$nm" "$(san "${l#*:}")"
      done
    done < <(grep -nEv '^[[:space:]]*#([^i]|$)|^[[:space:]]*$' "$f" 2>/dev/null)
  done
}
incs() { # FILE:LINE<TAB>DIRECTIVE TARGET for each include directive B3 lists
  local f l
  b3_files
  for f in "${B3F[@]}"; do
    while IFS= read -r l; do printf '%s:%s\t%s\n' "$f" "${l%%:*}" "$(awk '{print $1, $2}' <<< "${l#*:}")"; done \
      < <(grep -nE '^[[:space:]]*[#@]include(dir)?[[:space:]]' "$f" 2>/dev/null)
  done
}
logical() { # FILE: LINE<TAB>TEXT per logical line; a trailing backslash joins the next line (never onto a comment); blank lines and
  # comments dropped, where `#<digits>` (a uid) and `#include` are NOT comments
  awk 'function cmt(t) { return t ~ /^[ \t]*#/ && t !~ /^[ \t]*#[0-9]/ && t !~ /^[ \t]*#include/ }
       { l = $0
         if (buf == "") { s = NR; if (l ~ /^[ \t]*$/ || cmt(l)) next }
         if (l ~ /\\$/) { buf = buf substr(l, 1, length(l) - 1) " "; next }
         print s "\t" buf l; buf = "" }
       END { if (buf != "") print s "\t" buf }' "$1" 2>/dev/null
}
lspan() { # FILE N: START<TAB>END, the physical lines of the logical line (as logical() joins them) that holds physical line N
  awk -v want="$2" 'function cmt(t) { return t ~ /^[ \t]*#/ && t !~ /^[ \t]*#[0-9]/ && t !~ /^[ \t]*#include/ }
       { l = $0
         if (!cont) { s = NR; if (l ~ /^[ \t]*$/ || cmt(l)) { if (NR == want) { print NR "\t" NR; done = 1; exit }; next } }
         cont = (l ~ /\\$/)
         if (!cont && NR >= want) { print s "\t" NR; done = 1; exit } }
       END { if (!done) { if (cont) print s "\t" NR; else print want "\t" want } }' "$1" 2>/dev/null
}
strict_scan() { # FILE<TAB>LINE<TAB>TOKEN<TAB>TEXT for each grant form B3 does not judge (entry is stricter than B3)
  local f n t m first rest lhs ul hl gids items hits
  gids=" $(id -G arm 2>/dev/null) "
  b3_files
  for f in "${B3F[@]}"; do
    while IFS=$'\t' read -r n t; do
      hits=()
      for m in $(grep -oE '(^|[^A-Za-z0-9_.%#-])#[0-9]+' <<< "$t" | grep -oE '[0-9]+$'); do
        { [ "$m" = "$ARM_UID" ] || [ "$(getent passwd "$m" | cut -d: -f1)" = arm ]; } && hits+=("uid:#$m")
      done
      for m in $(grep -oE '%#[0-9]+' <<< "$t" | cut -c3-); do [[ $gids == *" $m "* ]] && hits+=("gid:%#$m"); done
      grep -q '%:' <<< "$t" && hits+=("non-unix-group:%:")
      read -r first rest <<< "$t"
      case $first in
        Defaults*|@include*|'#include'*|Cmnd_Alias|Cmd_Alias) ;;
        User_Alias|Runas_Alias|Host_Alias)
          while IFS= read -r m; do
            case $m in +*) hits+=("netgroup:$m");; esac
            [ "$first" = User_Alias ] && case $m in ALL) hits+=("ALL-in-User_Alias");; '!'*) hits+=("negated-in-User_Alias:$m");;
              *[\"\\]*) hits+=("unparsed-alias-member:$m");; esac
          done < <(sed -E 's/^[^=]*=//; s/:[[:space:]]*[A-Z][A-Z0-9_]*[[:space:]]*=/,/g' <<< "$rest" | tr ',' '\n' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//');;
        *) # a user spec: User_List Host_List = Cmnd_Spec_List
          [[ $t == *=* ]] || hits+=("unparsed-line")
          lhs=${t%%=*}; read -r ul hl _ < <(sed -E 's/[[:space:]]*,[[:space:]]*/,/g' <<< "$lhs")
          [[ $ul == *[\"\\]* ]] && hits+=("unparsed-user-list")
          IFS=, read -ra items <<< "$ul"
          for m in "${items[@]}"; do case $m in ALL) hits+=("ALL-user");; '!'*) hits+=("negated-user:$m");; +*) hits+=("netgroup:$m");; esac; done
          IFS=, read -ra items <<< "$hl"
          for m in "${items[@]}"; do case $m in +*) hits+=("netgroup:$m");; esac; done;;
      esac
      for m in "${hits[@]}"; do printf '%s\t%s\t%s\t%s\n' "$f" "$n" "$m" "$(san "$t")"; done
    done < <(logical "$f")
  done
}
source_scan() { # FILE<TAB>LINE<TAB>TOKEN<TAB>TEXT for sudo rule sources outside the files entry reads
  local l f src
  while IFS= read -r l; do
    src=$(sed -E 's/^[[:space:]]*sudoers[[:space:]]*:[[:space:]]*//; s/#.*//; s/[[:space:]]+/ /g; s/^ //; s/ $//' <<< "${l#*:}")
    [ "$src" = files ] || printf '/etc/nsswitch.conf\t%s\tsudoers-source:%s\t%s\n' "${l%%:*}" "${src// /,}" "$(san "${l#*:}")"
  done < <(grep -nE '^[[:space:]]*sudoers[[:space:]]*:' /etc/nsswitch.conf 2>/dev/null)
  [ -e /etc/sudo-ldap.conf ] && grep -nEv '^[[:space:]]*(#|$)' /etc/sudo-ldap.conf 2>/dev/null | head -1 | while IFS= read -r l; do printf '/etc/sudo-ldap.conf\t%s\tldap-sudoers\t%s\n' "${l%%:*}" "$(san "${l#*:}")"; done
  for f in /etc/ldap/ldap.conf /etc/ldap.conf; do
    grep -niE '^[[:space:]]*sudoers_base' "$f" 2>/dev/null | while IFS= read -r l; do printf '%s\t%s\tldap-sudoers\t%s\n' "$f" "${l%%:*}" "$(san "${l#*:}")"; done
  done
  for f in /etc/sssd/sssd.conf /etc/sssd/conf.d/*.conf; do
    grep -niE '^[[:space:]]*(services[[:space:]]*=.*sudo|\[sudo\]|sudo_provider)' "$f" 2>/dev/null | while IFS= read -r l; do printf '%s\t%s\tsssd-sudo\t%s\n' "$f" "${l%%:*}" "$(san "${l#*:}")"; done
  done
  grep -nE '^[[:space:]]*Plugin[[:space:]]' /etc/sudo.conf 2>/dev/null | while IFS= read -r l; do printf '/etc/sudo.conf\t%s\tsudo-plugin\t%s\n' "${l%%:*}" "$(san "${l#*:}")"; done
}
scan_all() { scan; strict_scan; source_scan; }   # everything entry classifies, and verify requires to be empty afterwards
check_incs() { # judge include directives (stdin)
  local loc d
  while IFS=$'\t' read -r loc d; do
    case $d in '@includedir /etc/sudoers.d'|'#includedir /etc/sudoers.d') ;;
      *) flag "$loc: include directive '$d' names a target other than /etc/sudoers.d: dispose of it separately";; esac
  done
}
inv_of() { awk -v p="$1" '$1 == p {$1 = ""; sub(/^ /, ""); print}'; }   # stdin: inv lines; prints the record of PATH
sudo_l() { sudo -n -l -U arm 2>&1 < /dev/null | cat; }   # always through a pipe: sudo wraps its -l lines when writing to a file
sudo_summary() { local o; o=$(sudo_l); if grep -q 'is not allowed to run sudo' <<< "$o"; then echo "arm is not allowed to run sudo"
  elif grep -q 'may run the following commands' <<< "$o"; then echo "arm may run: $(sed -n '/may run the following commands/,$p' <<< "$o" | sed 1d | sed 's/^ *//' | tr '\n' ';')"
  else echo "unrecognised sudo -l answer: $(head -3 <<< "$o" | tr '\n' ';')"; fi; }
visudo_c() { local o; o=$(visudo -c 2>&1 < /dev/null) && return 0; VISUDO_OUT=$o; return 1; }
admin_l() { # the admin account's own sudo route (step 1.8), which no Phase 4 change may touch
  if getent passwd afldb-admin > /dev/null; then sudo -n -l -U afldb-admin 2>&1 < /dev/null | cat; else echo "no account afldb-admin"; fi; }
admin_summary() { grep -E '^[[:space:]]+\(' <<< "$1" | sed 's/^ *//' | tr '\n' ';'; }
SEALED="attempt groups.pre gid.pre sudo-group.pre sudo-l.pre admin-l.pre dir.pre inv.pre copies matches.pre classified.pre includes.pre selected touched plan RESULT"
AED=/var/lib/afldb-access; AEF=$AED/epoch; ALOG=$AED/changes.log; APTR=$AED/applied
self() { printf 'env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc %s' "$0"; }
cmdline() { printf '(cd %s && sha256sum -c --strict SHA256SUMS) && %s %s --state %s --seal %s' "${0%/*}" "$(self)" "$1" "$S" "$SEAL"; }
VOIDTXT="STOP: every saved 4.4, 4.5 and 4.6 output and every gate verdict made before this moment is VOID, even on this boot and inside the freshness window. Before any gate: repeat 4.4, 4.5 and 4.6, then make a NEW gate call"
new_epoch() { # what: write a NEW access epoch BEFORE a change (r10); 1 if it cannot be written (then nothing may change)
  local e old t
  if [ -L "$AED" ] || { [ -e "$AED" ] && [ ! -d "$AED" ]; }; then flag "$AED is not a plain directory"; return 1; fi
  install -d -o 0 -g 0 -m 0755 "$AED" || { flag "cannot create $AED"; return 1; }
  old=$(head -c 64 "$AEF" 2>/dev/null | tr -cd '0-9a-f'); [ -n "$old" ] || old=none
  e=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n'); [[ $e =~ ^[0-9a-f]{32}$ ]] || { flag "cannot draw a new access epoch"; return 1; }
  t=$AED/.epoch.$$; rm -f -- "$t"
  { (set -C; printf '%s\n' "$e" > "$t") && chmod 0644 -- "$t" && mv -f -- "$t" "$AEF"; } || { rm -f -- "$t"; flag "cannot write $AEF"; return 1; }
  printf '%s %s old=%s new=%s state=%s %s\n' "$(date -u +%FT%TZ)" "$CMD" "$old" "$e" "${S:-none}" "$(san "$1" | tr ' ' _)" >> "$ALOG" && chmod 0644 -- "$ALOG" \
    || { flag "cannot append to $ALOG"; return 1; }
  say "access epoch $old -> $e written to $AEF ($1)"
  say "VOID: $VOIDTXT"
}
set_ptr() { local t=$AED/.applied.$$; rm -f -- "$t"; { (set -C; printf '%s\n' "$1" > "$t") && chmod 0600 -- "$t" && mv -f -- "$t" "$APTR"; } || { rm -f -- "$t"; return 1; }; }
ptr() { [ -f "$APTR" ] && [ ! -L "$APTR" ] && head -n 1 "$APTR" || echo none; }
load() { # apply/verify/backout: the state directory is root-only, sealed with the given seal, and from an entry that PASSED
  [ -d "$S" ] && [ ! -L "$S" ] && [ "$(stat -c '%u %a' "$S")" = "0 700" ] || die "state $S is not a root-only (0700) directory"
  local have; have=$(sha256sum < "$S/SHA256SUMS" 2>/dev/null | cut -c1-64)
  [ "$have" = "$SEAL" ] || die "state $S has seal ${have:-none}, not the given $SEAL: wrong attempt or a mistyped seal (nothing was changed)"
  (cd "$S" && sha256sum -c --strict --quiet SHA256SUMS) > /dev/null 2>&1 || die "state $S: seal check (SHA256SUMS) failed"
  local want; want=$( (echo SHA256SUMS; awk '{print $2}' "$S/SHA256SUMS") | sort); have=$(ls -A "$S" | sort)
  [ "$want" = "$have" ] || die "state $S holds files outside its seal"
  [ "$(cat "$S/RESULT")" = PASS ] || die "state $S: entry did not PASS"
  [ "$(sed -n 1p "$S/attempt")" = "state=$S" ] || die "state $S: its sealed attempt record names another directory ($(sed -n 1p "$S/attempt")): a copied or moved state"
  say "state $S seal $SEAL verified; plan: $(paste -sd' ' "$S/plan")"
}
copy_of() { awk -F'\t' -v p="$1" '$2 == p {print $1}' "$S/copies"; }
is_touched() { awk -F'\t' -v p="$1" '$2 == p {f = 1} END {exit !f}' "$S/touched"; }
exp_of() { awk -F'\t' -v p="$1" '$2 == p {print $3}' "$S/touched"; }   # the planned sha256 of a changed file
# classified.pre rows: FILE<TAB>LINE<TAB>TOKEN<TAB>CLASS<TAB>START<TAB>END (the physical lines of the match's logical line)
lines_of() { awk -F'\t' -v p="$1" -v c="$2" '$1 == p && $4 == c {printf "%s%s(%s%s) ", s, $2, $3, ($5 != $6 ? ", lines " $5 "-" $6 : ""); s = ""}' "$S/classified.pre"; }
spansha() { sed -n "$2,$3p" -- "$1" | sha256sum | cut -c1-64; }   # FILE START END: sha256 of those physical lines

# ------------------------------------------------------------------------------------------------ entry (step 4.0)
entry() {
  [ -d /root ] && [ ! -L /root ] && [ "$(stat -c %u /root)" = 0 ] && ! (( 8#$(stat -c %a /root) & 8#022 )) || die "/root is not a trusted root-owned directory"
  if [ -L "$P4ROOT" ] || { [ -e "$P4ROOT" ] && [ ! -d "$P4ROOT" ]; }; then die "$P4ROOT is not a plain directory"; fi
  install -d -o 0 -g 0 -m 0700 "$P4ROOT" || die "cannot create $P4ROOT"
  S=$P4ROOT/attempt-$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
  mkdir -m 0700 -- "$S" 2> /dev/null || die "cannot create the NEW state directory $S"
  printf 'PHASE4 STATE %s\n' "$S"
  # the attempt record: this directory's own path and a random nonce, so that every attempt has its own seal even when two entries
  # record identical host states (a seal then names exactly one attempt)
  printf 'state=%s\nnonce=%s\ncreated=%s\n' "$S" "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" "$(date -u +%FT%TZ)" > "$S/attempt"
  arm_groups > "$S/groups.pre"; id -g arm > "$S/gid.pre"; getent group sudo > "$S/sudo-group.pre"; sudo_l > "$S/sudo-l.pre"
  admin_l > "$S/admin-l.pre"
  dirstat > "$S/dir.pre"; inv > "$S/inv.pre"; : > "$S/copies"
  local i=0 f rest n tok txt cls k m a z fs ss c sp key
  while read -r f rest; do
    i=$((i + 1))
    case $rest in LINK|TYPE:*|BADNAME) flag "$f is a ${rest#TYPE:} entry in the sudoers scope (a link, a non-regular file or an unusual name): dispose of it separately"; continue;; esac
    cat -- "$f" > "$S/copy.$i"
    [ "$(sha256sum < "$S/copy.$i" | cut -c1-64)" = "${rest##* }" ] || flag "$f changed while entry read it"
    printf '%s\t%s\n' "$i" "$f" >> "$S/copies"
  done < "$S/inv.pre"
  grep -q '^/etc/sudoers ' "$S/inv.pre" || flag "/etc/sudoers is absent or not a regular file"
  scan_all > "$S/matches.pre"; incs > "$S/includes.pre"
  # the owner's selection: each token names ONE logical line exactly as captured (file sha256 and the sha256 of its lines)
  : > "$S/selected"
  local -A SELK=()
  for m in "${SEL[@]}"; do
    if ! [[ $m =~ ^(/etc/sudoers(\.d/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)?):([1-9][0-9]{0,5})-([1-9][0-9]{0,5}):([0-9a-f]{64}):([0-9a-f]{64})$ ]]; then
      flag "--remove-grant '$m' is malformed (FILE:START-END:SPAN-SHA256:FILE-SHA256, copied exactly from an entry listing)"; continue; fi
    f=${BASH_REMATCH[1]}; a=${BASH_REMATCH[3]}; z=${BASH_REMATCH[4]}; ss=${BASH_REMATCH[5]}; fs=${BASH_REMATCH[6]}; key="$f:$a-$z"
    if [ -n "${SELK[$key]+x}" ]; then flag "--remove-grant $key is given twice"; continue; fi
    SELK[$key]=1; c=$(copy_of "$f")
    if [ -z "$c" ]; then flag "--remove-grant $key: $f is not a regular sudoers file here"
    elif [ "$(sha256sum < "$S/copy.$c" | cut -c1-64)" != "$fs" ]; then flag "--remove-grant $key: $f changed since the reviewed listing (file sha256 is now $(sha256sum < "$S/copy.$c" | cut -c1-64), the token says $fs): review the new listing and select again"
    elif (( a > z )) || [ "$(lspan "$S/copy.$c" "$a")" != "$a"$'\t'"$z" ]; then flag "--remove-grant $key: lines $a-$z are not exactly one logical line of $f (ambiguous selection)"
    elif [ "$(spansha "$S/copy.$c" "$a" "$z")" != "$ss" ]; then flag "--remove-grant $key: the text of those lines differs from the reviewed listing"
    else printf '%s\t%s\t%s\n' "$f" "$a" "$z" >> "$S/selected"; fi
  done
  : > "$S/classified.pre"
  while IFS=$'\t' read -r f n tok txt; do
    c=$(copy_of "$f"); sp="$n"$'\t'"$n"; [ -n "$c" ] && sp=$(lspan "$S/copy.$c" "$n")
    if [ "$tok" = %sudo ]; then cls=group-only
    elif [ -n "$c" ] && awk -F'\t' -v p="$f" -v sp="$sp" '$1 == p && ($2 "\t" $3) == sp {g = 1} END {exit !g}' "$S/selected"; then cls=selected
    else cls=unrelated; fi
    printf '%s\t%s\t%s\t%s\t%s\n' "$f" "$n" "$tok" "$cls" "$sp" >> "$S/classified.pre"
    say "match $f:$n token $tok class $cls: $txt"
    if [ "$cls" = unrelated ]; then
      if [ -n "$c" ]; then
        a=${sp%%$'\t'*}; z=${sp#*$'\t'}
        flag "$f:$n names $tok ('$txt'): a grant that gpasswd -d arm sudo does not remove and that is not selected; dispose of it separately, or, after review, select it with: --remove-grant $f:$a-$z:$(spansha "$S/copy.$c" "$a" "$z"):$(sha256sum < "$S/copy.$c" | cut -c1-64)"
      else flag "$f:$n names $tok ('$txt'): a sudo rule source entry cannot read; dispose of it separately (it cannot be selected for removal)"; fi
    fi
  done < "$S/matches.pre"
  # a selection must hold a selected match, and must not hold a %sudo match (its line is never edited)
  while IFS=$'\t' read -r f a z; do
    awk -F'\t' -v p="$f" -v a="$a" -v z="$z" '$1 == p && $5 == a && $6 == z && $4 == "selected" {g = 1} END {exit !g}' "$S/classified.pre" \
      || flag "--remove-grant $f:$a-$z: entry finds no grant other than %sudo on those lines, so there is nothing to remove"
    awk -F'\t' -v p="$f" -v a="$a" -v z="$z" '$1 == p && $4 == "group-only" && $5 <= z + 0 && a + 0 <= $6 {g = 1} END {exit !g}' "$S/classified.pre" \
      && flag "--remove-grant $f:$a-$z: those lines also hold %sudo (group-only: afldb-admin's route to root, never edited); dispose of it separately"
  done < "$S/selected"
  grep -qx sudo "$S/groups.pre" || flag "arm is not in group sudo: this is not the state Phase 4 changes; re-run Phase 2"
  for k in admin wheel; do grep -qx "$k" "$S/groups.pre" && flag "arm is in group $k (sudo's other admin groups): dispose of it separately"; done
  check_incs < "$S/includes.pre"
  # the planned file of each changed file: the captured copy minus the selected physical lines; visudo -cf must accept it
  : > "$S/touched"
  while read -r f; do
    [ -n "$f" ] || continue; c=$(copy_of "$f")
    awk -v drop="$(awk -F'\t' -v p="$f" '$1 == p {printf "%s%s-%s", s, $2, $3; s = ","}' "$S/selected")" \
      'BEGIN { n = split(drop, d, ","); for (i = 1; i <= n; i++) { split(d[i], r, "-"); A[i] = r[1] + 0; Z[i] = r[2] + 0 } }
       { for (i = 1; i <= n; i++) if (NR >= A[i] && NR <= Z[i]) next; print }' "$S/copy.$c" > "$S/expect.$c"
    if o=$(visudo -c -f "$S/expect.$c" 2>&1 < /dev/null); then say "planned $f: visudo -cf accepts it ($(tr '\n' ' ' <<< "$o"))"
    else flag "planned $f (copy minus the selected lines) is refused by visudo -cf: $(tr '\n' ';' <<< "$o")"; fi
    printf '%s\t%s\t%s\n' "$c" "$f" "$(sha256sum < "$S/expect.$c" | cut -c1-64)" >> "$S/touched"
  done < <(cut -f1 "$S/selected" | sort -u)

  say "pre-change: arm's groups: $(tr '\n' ' ' < "$S/groups.pre")(primary gid $(cat "$S/gid.pre"))"
  say "pre-change: group line: $(cat "$S/sudo-group.pre")"
  say "pre-change: /etc/sudoers.d: $(cat "$S/dir.pre")"
  while read -r f rest; do say "pre-change: file $f uid gid mode sha256: $rest"; done < "$S/inv.pre"
  say "pre-change: sudo -l -U arm: $(sudo_summary)"
  say "pre-change: sudo -l -U afldb-admin: $(if grep -qx 'no account afldb-admin' "$S/admin-l.pre"; then echo "no account afldb-admin (not compared by verify)"; else admin_summary "$(cat "$S/admin-l.pre")"; fi)"
  say "pre-change: include directives: $(cut -f2 "$S/includes.pre" | tr '\n' ';')"
  if [ ${#BAD[@]} -gt 0 ]; then
    echo REFUSED > "$S/RESULT"; chmod 0400 "$S"/*
    say "this attempt ($S) is REFUSED and can never be applied; nothing was changed. After resolving the reasons, run entry again: it makes a NEW state directory"
    finish
  fi

  m=group-only; [ -s "$S/selected" ] && m=group-and-grants
  printf 'change=%s\nremove=%s\n' "$m" "$(awk -F'\t' '{printf "%s%s:%s-%s", s, $1, $2, $3; s = " "}' "$S/selected")" > "$S/plan"
  echo PASS > "$S/RESULT"
  (cd "$S" && sha256sum -- $SEALED copy.* expect.* > SHA256SUMS) || die "cannot seal $S"
  chmod 0400 "$S"/*
  SEAL=$(sha256sum < "$S/SHA256SUMS" | cut -c1-64)
  say "change 1 (group-only, step 4.1 by apply): gpasswd -d arm sudo; back-out: gpasswd -a arm sudo, after which id -Gn arm lists exactly: $(tr '\n' ' ' < "$S/groups.pre")"
  k=1
  while IFS=$'\t' read -r c f fs; do
    k=$((k + 1)); read -r u g md sh < <(inv_of "$f" < "$S/inv.pre")
    say "change $k (step 4.1 by apply): $f loses ONLY line(s) $(lines_of "$f" selected)and keeps every other line byte for byte$(kp=$(lines_of "$f" group-only); [ -n "$kp" ] && echo ", KEEP %sudo line(s) $kp"); planned sha256 $fs, owner $u:$g, mode 0$md; back-out restores $S/copy.$c (sha256 $sh)"
  done < "$S/touched"
  say "precondition, NOT checked by this script: the [CON] root session is open now and stays open until 4.7"
  say "precondition, NOT checked by this script: Phase 1 verified twice (1.13), two independently authenticated admin logins"
  say "precondition, NOT checked by this script: the owner's separate written approval of THIS state directory and seal, given after reading this output"
  say "precondition, NOT checked by this script: every other Phase 2 FAIL resolved, every UNKNOWN resolved or accepted, the section 0 residual accepted"
  say "apply (4.1, [ADM-ROOT]): $(cmdline apply)"
  say "verify (4.2, [ADM-ROOT]): $(cmdline verify)"
  say "back-out ([CON], also from a fresh console session): $(cmdline backout)"
  printf 'PHASE4 STATE %s\nPHASE4 SEAL %s\n' "$S" "$SEAL"
  finish "change=$m matches=$(grep -c '' "$S/matches.pre") grants-removed=$(grep -c . "$S/selected") state=$S seal=$SEAL"
}

# ------------------------------------------------------------------------------------------------ compare the sudoers scope with the record
declare -A PRE CUR
read_inv() { local p r; PRE=(); CUR=()
  while read -r p r; do PRE[$p]=$r; done < "$S/inv.pre"
  while read -r p r; do CUR[$p]=$r; done < <(inv); }
post_of() { local u g md; read -r u g md _ <<< "${PRE[$1]}"; echo "$u $g $md $(exp_of "$1")"; }   # the planned record of a changed file
put() { # SRC DEST U G MODE: install SRC's bytes at DEST with that owner and mode, by temp file and rename in DEST's directory
  local t=${2%/*}/.afldb-phase4.$$; rm -f -- "$t"
  { (set -C; cat -- "$1" > "$t") && chown "$3:$4" -- "$t" && chmod "$5" -- "$t" && mv -f -- "$t" "$2"; } || { rm -f -- "$t"; return 1; }; }

# ------------------------------------------------------------------------------------------------ apply (step 4.1)
apply() {
  load
  local p c f u g md o ok=1
  case $(ptr) in none*) ;; *) die "this host records an applied attempt that has not been backed out: $(ptr). Nothing was changed";; esac
  grep -q " apply old=[^ ]* new=[^ ]* state=$S " "$ALOG" 2>/dev/null && die "this attempt was applied once already (see $ALOG): run a NEW entry. Nothing was changed"
  read_inv
  for p in "${!PRE[@]}"; do [ "${CUR[$p]-absent}" = "${PRE[$p]}" ] || flag "$p differs from the entry record (was [${PRE[$p]}], now [${CUR[$p]-absent}])"; done
  for p in "${!CUR[@]}"; do [ -n "${PRE[$p]+x}" ] || flag "$p was added after entry"; done
  [ "$(arm_groups)" = "$(cat "$S/groups.pre")" ] || flag "arm's groups differ from the entry record"
  [ "$(dirstat)" = "$(cat "$S/dir.pre")" ] || flag "/etc/sudoers.d itself differs from the entry record"
  [ ${#BAD[@]} = 0 ] || { say "the host changed since entry: run a NEW entry. Nothing was changed"; finish; }
  new_epoch "apply of $S" || finish
  set_ptr "$S $SEAL" || die "cannot record the applied attempt in $APTR (the epoch is new; nothing else was changed)"
  WORD=FAIL
  while IFS=$'\t' read -r c f _; do
    read -r u g md _ <<< "${PRE[$f]}"
    if put "$S/expect.$c" "$f" "$u" "$g" "$md"; then say "installed $f: $(inv | inv_of "$f") (planned $(post_of "$f"))"; else flag "could not install the planned $f"; ok=0; break; fi
  done < "$S/touched"
  if [ $ok = 1 ]; then if gpasswd -d arm sudo > /dev/null 2>&1; then say "ran: gpasswd -d arm sudo"; else flag "gpasswd -d arm sudo failed"; ok=0; fi; fi
  if [ $ok = 1 ]; then if visudo_c; then say "check visudo-c PASS"; else flag "visudo -c fails after the change: $(tr '\n' ';' <<< "$VISUDO_OUT")"; ok=0; fi; fi
  if [ $ok = 0 ]; then say "apply failed: restoring the recorded state now"; restore_and_prove; say "VOID: $VOIDTXT"; finish; fi
  say "next: verify (4.2): $(cmdline verify)"
  say "if 4.2 STOPs or 4.3 fails, back-out from [CON], also from a fresh console session: $(cmdline backout)"
  finish "applied $S (seal $SEAL): $(paste -sd' ' "$S/plan")"
}

# ------------------------------------------------------------------------------------------------ verify (step 4.2)
verify() {
  load
  local now exp p o
  [ "$(ptr)" = "$S $SEAL" ] && say "check applied PASS this host records $S as the applied attempt" || flag "this host records [$(ptr)] as the applied attempt, not $S"
  now=$(arm_groups); exp=$(grep -vx sudo "$S/groups.pre")
  [ "$now" = "$exp" ] && say "check groups PASS arm's groups: $(tr '\n' ' ' <<< "$now")(pre-change minus sudo)" \
    || flag "arm's groups are [$(tr '\n' ' ' <<< "$now")], the plan expects [$(tr '\n' ' ' <<< "$exp")] (pre-change minus sudo)"
  [ "$(id -g arm)" = "$(cat "$S/gid.pre")" ] || flag "arm's primary group changed"
  [ "$(dirstat)" = "$(cat "$S/dir.pre")" ] || flag "/etc/sudoers.d itself changed: $(dirstat)"
  read_inv
  while IFS= read -r p; do
    if is_touched "$p"; then
      [ "${CUR[$p]-absent}" = "$(post_of "$p")" ] && say "check file PASS $p equals its planned record ($(post_of "$p")): only the selected line(s) $(lines_of "$p" selected)are gone" \
        || flag "$p is not its planned record: planned [$(post_of "$p")], now [${CUR[$p]-absent}]"
    elif [ "${CUR[$p]-absent}" = "${PRE[$p]}" ]; then say "check file PASS $p unchanged"
    else flag "$p changed outside the plan: was [${PRE[$p]}], now [${CUR[$p]-absent}]"; fi
  done < <(printf '%s\n' "${!PRE[@]}" | sort)
  while IFS= read -r p; do [ -n "${PRE[$p]+x}" ] || flag "$p was added: [${CUR[$p]}]"; done < <(printf '%s\n' "${!CUR[@]}" | sort)
  if [ "$(cat "$S/admin-l.pre" 2>/dev/null)" = "no account afldb-admin" ]; then say "check admin-sudo-l not compared: no account afldb-admin at entry"
  elif o=$(admin_l); [ -f "$S/admin-l.pre" ] && [ "$o" = "$(cat "$S/admin-l.pre")" ]; then say "check admin-sudo-l PASS sudo -l -U afldb-admin equals the pre-change record: $(admin_summary "$o")"
  else flag "sudo -l -U afldb-admin differs from the pre-change record (the admin's own route to root): now $(admin_summary "$o"); diff record/now: $(diff "$S/admin-l.pre" <(admin_l) 2>&1 | tr '\n' ';')"; fi
  check_incs < <(incs)
  if visudo_c; then say "check visudo-c PASS"; else flag "visudo -c fails: $(tr '\n' ';' <<< "$VISUDO_OUT")"; fi
  o=$(scan_all); [ -z "$o" ] && say "check rescan PASS no sudoers line names arm, a group of arm or a grant form entry refuses, and no outside rule source" \
    || flag "the rescan still finds (B3 and stricter rules): $(awk -F'\t' '{printf "%s:%s(%s) ", $1, $2, $3}' <<< "$o")"
  o=$(sudo_summary)
  [ "$o" = "arm is not allowed to run sudo" ] && say "check sudo-l PASS sudo -l -U arm: $o" || flag "sudo -l -U arm: $o"
  [ ${#BAD[@]} = 0 ] || say "STOP: back out now in [CON] with: $(cmdline backout); then dispose of the residual separately and run a NEW entry. Do NOT return to step 4.1."
  finish "the realised change equals the plan ($(paste -sd' ' "$S/plan")) and arm cannot sudo"
}

# ------------------------------------------------------------------------------------------------ backout
restore_and_prove() { # restore every changed file and arm's sudo membership, then prove the pre-change state of $S
  local c f u g md sh p now
  while IFS=$'\t' read -r c f _; do
    read -r u g md sh <<< "${PRE[$f]}"
    if [ "$(inv | inv_of "$f")" = "${PRE[$f]}" ]; then say "$f already equals its pre-change record"
    elif put "$S/copy.$c" "$f" "$u" "$g" "$md"; then say "restored $f from $S/copy.$c (owner $u:$g, mode 0$md)"
    else flag "could not restore $f from $S/copy.$c"; fi
  done < "$S/touched"
  if grep -qx sudo "$S/groups.pre" && ! arm_groups | grep -qx sudo; then
    if gpasswd -a arm sudo > /dev/null 2>&1; then say "ran: gpasswd -a arm sudo"; else flag "gpasswd -a arm sudo failed"; fi
  else say "arm is already in group sudo"; fi
  if visudo_c; then say "check visudo-c PASS"; else flag "visudo -c fails: $(tr '\n' ';' <<< "$VISUDO_OUT")"; fi
  read_inv
  while IFS= read -r p; do
    if [ "${CUR[$p]-absent}" = "${PRE[$p]}" ]; then say "check file PASS $p equals its pre-change record (${PRE[$p]})"
    else flag "$p still differs from its pre-change record: now [${CUR[$p]-absent}], was [${PRE[$p]}]"; fi
  done < <(printf '%s\n' "${!PRE[@]}" | sort)
  while IFS= read -r p; do [ -n "${PRE[$p]+x}" ] || flag "$p was added after entry: review and remove it by hand"; done < <(printf '%s\n' "${!CUR[@]}" | sort)
  [ "$(dirstat)" = "$(cat "$S/dir.pre")" ] || flag "/etc/sudoers.d itself differs: $(dirstat)"
  now=$(arm_groups)
  [ "$now" = "$(cat "$S/groups.pre")" ] && say "check groups PASS arm's groups equal the pre-change record: $(tr '\n' ' ' <<< "$now")" \
    || flag "arm's groups [$(tr '\n' ' ' <<< "$now")] differ from the pre-change record [$(tr '\n' ' ' < "$S/groups.pre")]"
  [ "$(id -g arm)" = "$(cat "$S/gid.pre")" ] || flag "arm's primary group differs from the pre-change record"
  [ "$(sudo_l)" = "$(cat "$S/sudo-l.pre")" ] && say "check sudo-l PASS sudo -l -U arm equals the pre-change record: $(sudo_summary)" \
    || flag "sudo -l -U arm differs from the pre-change record: now $(sudo_summary); diff record/now: $(diff "$S/sudo-l.pre" <(sudo_l) | tr '\n' ';')"
  if [ "$(cat "$S/admin-l.pre" 2>/dev/null)" = "no account afldb-admin" ]; then say "check admin-sudo-l not compared: no account afldb-admin at entry"
  elif [ -f "$S/admin-l.pre" ] && [ "$(admin_l)" = "$(cat "$S/admin-l.pre")" ]; then say "check admin-sudo-l PASS sudo -l -U afldb-admin equals the pre-change record"
  else flag "sudo -l -U afldb-admin differs from the pre-change record: diff record/now: $(diff "$S/admin-l.pre" <(admin_l) 2>&1 | tr '\n' ';')"; fi
  say "pre-change group line: $(cat "$S/sudo-group.pre"); now: $(getent group sudo) (member order may differ; membership is compared)"
  if [ ${#BAD[@]} = 0 ]; then set_ptr "none backed-out $S $(date -u +%FT%TZ)" || flag "cannot clear the applied attempt in $APTR"; fi
}
backout() {
  load
  local p cur pre post g now
  [ "$(ptr)" = "$S $SEAL" ] || die "this host records [$(ptr)] as the applied attempt, not $S with seal $SEAL: this snapshot is not the one applied here (an old attempt, or a mismatched one). Nothing was changed. Use the state and seal that the applied attempt's apply printed (the applied record above names them)"
  read_inv
  for p in "${!PRE[@]}"; do   # before any change: every item is in its recorded or its planned state, and nothing was added
    cur=${CUR[$p]-absent}; pre=${PRE[$p]}
    if [ "$cur" = "$pre" ]; then continue; fi
    if is_touched "$p" && [ "$cur" = "$(post_of "$p")" ]; then continue; fi
    flag "$p is in neither its recorded nor its planned state (now [$cur], recorded [$pre]$(is_touched "$p" && echo ", planned [$(post_of "$p")]")): review it in [CON], restore it by hand with: install -o ${pre%% *} -g $(cut -d' ' -f2 <<< "$pre") -m 0$(cut -d' ' -f3 <<< "$pre") $S/copy.$(copy_of "$p") $p, then run back-out again"
  done
  for p in "${!CUR[@]}"; do [ -n "${PRE[$p]+x}" ] || flag "$p was added after entry: review it in [CON], remove it by hand, then run back-out again"; done
  now=$(arm_groups); g=$(grep -vx sudo "$S/groups.pre")
  [ "$now" = "$(cat "$S/groups.pre")" ] || [ "$now" = "$g" ] || flag "arm's groups [$(tr '\n' ' ' <<< "$now")] are neither the recorded nor the planned set: review them in [CON]"
  [ ${#BAD[@]} = 0 ] || { say "nothing was changed"; finish; }
  new_epoch "backout of $S" || finish
  WORD=FAIL
  restore_and_prove
  finish "the sudoers scope, arm's groups and sudo -l -U arm equal the pre-change record of $S (seal $SEAL); the host records no applied attempt"
}

# ------------------------------------------------------------------------------------------------ invalidate (an access change outside this script)
invalidate() {
  new_epoch "invalidate: $REASON" || finish
  finish "a new access epoch is recorded for: $(san "$REASON")"
}

$CMD
