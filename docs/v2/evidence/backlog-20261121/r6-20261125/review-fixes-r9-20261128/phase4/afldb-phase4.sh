#!/usr/bin/bash
# afldb-phase4.sh (R6 r9, 28 Nov 2026): entry check, realised-change check and back-out for removing arm's sudo, OWNER-PROCEDURE.md
# Phase 4 (steps 4.0, 4.2 and the back-out). PREPARED, NOT RUN ON PRODUCTION BY CLAUDE; rehearsed only in disposable containers on
# streamanator (p4-run.sh). Run AS ROOT from a root-owned staged copy, never in a session that descends from arm:
#   env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc /root/afldb-r9-phase4/afldb-phase4.sh CMD --state DIR
#   entry   --state /root/NAME [--dispose FILE]...  [ADM-ROOT], step 4.0. Records the pre-change state into the NEW root-only
#           directory DIR, then approves the change or refuses it. Writes nothing outside DIR.
#   verify  --state DIR   [ADM-ROOT], step 4.2. The realised change equals the approved plan and arm cannot sudo. Writes nothing.
#   backout --state DIR   [CON], the still-open console root session. Restores each disposed file (bytes, owner, group, mode) and
#           arm's sudo membership, runs visudo -c, and proves the pre-change state. Writes only those.
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
#   group-only  the B3 token %sudo, the only group-only class, decided FIRST, in a disposed file too: `gpasswd -d arm sudo` removes
#               it, `gpasswd -a arm sudo` restores it, and its line is NEVER edited (it is also afldb-admin's route to root, 1.8);
#   disposed    any other match in a file named by --dispose: the owner edits ONLY those lines with `visudo -f` (4.0 names them and
#               the %sudo lines to keep), the back-out restores the saved copy;
#   unrelated   anything else: REFUSED, naming file:line and token; it needs its own disposition before Phase 4.
# entry also REFUSES: arm not in sudo; arm in admin or wheel; an include directive other than includedir /etc/sudoers.d; a link,
# non-regular file or unusual name in /etc/sudoers.d; a --dispose file outside /etc/sudoers{,.d}, without a match, or whose only
# match is %sudo; a %sudo line that shares a (continued) line with a disposed match, since no edit could keep one and not the other.
# verify (r9, R9-F-2) also requires: in each disposed file every line outside the disposed matches is byte-identical to the entry
# copy (so each %sudo line survives; removing a disposed file is allowed only when nothing else in it but comments and blank lines),
# and `sudo -l -U afldb-admin` equals its pre-change record (when that account exists at entry).
# A grant added after entry, or a form none of these rules knows, is caught by verify (`sudo -l -U arm`, the file inventory and the
# same rescan), whose answer is then STOP: back out, dispose of it separately. Conservative by design: when unsure, it refuses.
# Output: `PHASE4 <CMD> ...` lines, ending `PHASE4 ENTRY RESULT PASS change=group-only|group-and-disposed ...` or `... REFUSED
# <reasons>`, `PHASE4 VERIFY RESULT PASS|STOP ...`, `PHASE4 BACKOUT RESULT PASS|FAIL ...`. Exit 0 PASS, 1 otherwise, 2 usage.
# No secret is read or printed: sudoers files hold none, and only group names and members are read, never a gshadow password field.
set -u -o pipefail
export LC_ALL=C PATH=/usr/sbin:/usr/bin
umask 077
cd / || exit 90
shopt -s nullglob
usage() { echo "usage: afldb-phase4.sh entry --state /root/NAME [--dispose FILE]... | verify --state DIR | backout --state DIR"; exit 2; }
CMD=${1:-}; [ $# -gt 0 ] && shift
STATE=; DISP=()
while [ $# -gt 0 ]; do
  case $1 in
    --state) [ $# -ge 2 ] || usage; STATE=$2; shift 2;;
    --dispose) [ $# -ge 2 ] && [ "$CMD" = entry ] || usage; DISP+=("$2"); shift 2;;
    *) usage;;
  esac
done
case $CMD in entry) WORD=REFUSED;; verify) WORD=STOP;; backout) WORD=FAIL;; *) usage;; esac
[[ $STATE =~ ^/root/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || usage
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
SEALED="groups.pre gid.pre sudo-group.pre sudo-l.pre admin-l.pre dir.pre inv.pre copies matches.pre classified.pre includes.pre disposed plan RESULT"
load() { # verify/backout: the state directory is root-only, sealed, and from an entry that PASSED
  [ -d "$S" ] && [ ! -L "$S" ] && [ "$(stat -c '%u %a' "$S")" = "0 700" ] || die "state $S is not a root-only (0700) directory"
  (cd "$S" && sha256sum -c --strict --quiet SHA256SUMS) > /dev/null 2>&1 || die "state $S: seal check (SHA256SUMS) failed"
  local want have; want=$( (echo SHA256SUMS; awk '{print $2}' "$S/SHA256SUMS") | sort); have=$(ls -A "$S" | sort)
  [ "$want" = "$have" ] || die "state $S holds files outside its seal"
  [ "$(cat "$S/RESULT")" = PASS ] || die "state $S: entry did not PASS"
  say "state $S seal sha256 $(sha256sum < "$S/SHA256SUMS" | cut -c1-64) (equal to the value entry printed); plan: $(paste -sd' ' "$S/plan")"
}
is_disposed() { grep -qxF -- "$1" "$S/disposed"; }
copy_of() { awk -F'\t' -v p="$1" '$2 == p {print $1}' "$S/copies"; }
# classified.pre rows: FILE<TAB>LINE<TAB>TOKEN<TAB>CLASS<TAB>START<TAB>END (the physical lines of the match's logical line)
in_class() { awk -F'\t' -v p="$1" -v c="$2" -v l="$3" '$1 == p && $4 == c && $5 <= l + 0 && l + 0 <= $6 {f = 1} END {exit !f}' "$S/classified.pre"; }
lines_of() { awk -F'\t' -v p="$1" -v c="$2" '$1 == p && $4 == c {printf "%s%s(%s%s) ", s, $2, $3, ($5 != $6 ? ", lines " $5 "-" $6 : ""); s = ""}' "$S/classified.pre"; }

# ------------------------------------------------------------------------------------------------ entry (step 4.0)
entry() {
  [ -d /root ] && [ ! -L /root ] && [ "$(stat -c %u /root)" = 0 ] && ! (( 8#$(stat -c %a /root) & 8#022 )) || die "/root is not a trusted root-owned directory"
  mkdir -m 0700 -- "$S" 2> /dev/null || die "cannot create the NEW state directory $S (it must not exist yet)"
  arm_groups > "$S/groups.pre"; id -g arm > "$S/gid.pre"; getent group sudo > "$S/sudo-group.pre"; sudo_l > "$S/sudo-l.pre"
  admin_l > "$S/admin-l.pre"
  dirstat > "$S/dir.pre"; inv > "$S/inv.pre"; : > "$S/copies"
  local i=0 f rest n tok txt cls d k m
  while read -r f rest; do
    i=$((i + 1))
    case $rest in LINK|TYPE:*|BADNAME) flag "$f is a ${rest#TYPE:} entry in the sudoers scope (a link, a non-regular file or an unusual name): dispose of it separately"; continue;; esac
    cat -- "$f" > "$S/copy.$i"
    [ "$(sha256sum < "$S/copy.$i" | cut -c1-64)" = "${rest##* }" ] || flag "$f changed while entry read it"
    printf '%s\t%s\n' "$i" "$f" >> "$S/copies"
  done < "$S/inv.pre"
  grep -q '^/etc/sudoers ' "$S/inv.pre" || flag "/etc/sudoers is absent or not a regular file"
  scan_all > "$S/matches.pre"; incs > "$S/includes.pre"
  : > "$S/disposed"
  for d in "${DISP[@]}"; do
    is_disposed "$d" && continue
    if ! { [ "$d" = /etc/sudoers ] || [[ $d =~ ^/etc/sudoers\.d/[A-Za-z0-9_~-][A-Za-z0-9._~-]*$ ]]; }; then flag "--dispose $d: only /etc/sudoers or a file directly in /etc/sudoers.d"
    elif ! grep -Eq "^${d//./\\.} [0-9]+ [0-9]+ [0-7]+ [0-9a-f]{64}\$" "$S/inv.pre"; then flag "--dispose $d: not a regular sudoers file here"
    elif ! cut -f1 "$S/matches.pre" | grep -qxF -- "$d"; then flag "--dispose $d: entry reports no match in it, so there is nothing to dispose of"
    elif ! awk -F'\t' -v p="$d" '$1 == p && $3 != "%sudo" {f = 1} END {exit !f}' "$S/matches.pre"; then
      flag "--dispose $d: its only match is %sudo (group-only: 4.1's gpasswd -d arm sudo removes it, and its line is never edited), so there is nothing to dispose of"
    else echo "$d" >> "$S/disposed"; fi
  done
  : > "$S/classified.pre"
  local sp c kp
  while IFS=$'\t' read -r f n tok txt; do
    # %sudo first: in a disposed file too it stays group-only, and its line is never listed for change (R9-F-2)
    if [ "$tok" = %sudo ]; then cls=group-only; elif is_disposed "$f"; then cls=disposed; else cls=unrelated; fi
    c=$(copy_of "$f"); sp="$n"$'\t'"$n"; [ -n "$c" ] && sp=$(lspan "$S/copy.$c" "$n")
    printf '%s\t%s\t%s\t%s\t%s\n' "$f" "$n" "$tok" "$cls" "$sp" >> "$S/classified.pre"
    say "match $f:$n token $tok class $cls: $txt"
    if [ "$cls" = unrelated ]; then
      case $f in /etc/sudoers|/etc/sudoers.d/*) flag "$f:$n names $tok ('$txt'): an explicit or unrelated sudoers grant, not removed by gpasswd -d arm sudo; dispose of it separately, or name $f with --dispose to edit it in 4.1";;
        *) flag "$f:$n names $tok ('$txt'): a sudo rule source entry cannot read; dispose of it separately (it cannot be disposed of in 4.1)";; esac
    fi
  done < "$S/matches.pre"
  # a %sudo line that shares a physical line with a disposed match: no edit of the disposed match could keep %sudo intact
  while IFS= read -r m; do flag "$m: entry cannot plan an edit that keeps %sudo; dispose of it separately"; done < <(awk -F'\t' '
    NR == FNR { if ($4 == "disposed") { k++; F[k] = $1; L[k] = $2; T[k] = $3; A[k] = $5; B[k] = $6 }; next }
    $4 == "group-only" { for (i = 1; i <= k; i++) if (F[i] == $1 && $5 <= B[i] + 0 && A[i] <= $6 + 0)
      printf "%s:%s (%%sudo, lines %s-%s) shares a line with the disposed match %s:%s (%s)\n", $1, $2, $5, $6, F[i], L[i], T[i] }' \
    "$S/classified.pre" "$S/classified.pre")
  grep -qx sudo "$S/groups.pre" || flag "arm is not in group sudo: this is not the state Phase 4 changes; re-run Phase 2"
  for k in admin wheel; do grep -qx "$k" "$S/groups.pre" && flag "arm is in group $k (sudo's other admin groups): dispose of it separately"; done
  check_incs < "$S/includes.pre"

  say "pre-change: arm's groups: $(tr '\n' ' ' < "$S/groups.pre")(primary gid $(cat "$S/gid.pre"))"
  say "pre-change: group line: $(cat "$S/sudo-group.pre")"
  say "pre-change: /etc/sudoers.d: $(cat "$S/dir.pre")"
  while read -r f rest; do say "pre-change: file $f uid gid mode sha256: $rest"; done < "$S/inv.pre"
  say "pre-change: sudo -l -U arm: $(sudo_summary)"
  say "pre-change: sudo -l -U afldb-admin: $(if grep -qx 'no account afldb-admin' "$S/admin-l.pre"; then echo "no account afldb-admin (not compared by verify)"; else admin_summary "$(cat "$S/admin-l.pre")"; fi)"
  say "pre-change: include directives: $(cut -f2 "$S/includes.pre" | tr '\n' ';')"
  if [ ${#BAD[@]} -gt 0 ]; then echo REFUSED > "$S/RESULT"; finish; fi

  m=group-only; [ -s "$S/disposed" ] && m=group-and-disposed
  printf 'change=%s\ndisposed=%s\n' "$m" "$(tr '\n' ' ' < "$S/disposed")" > "$S/plan"
  echo PASS > "$S/RESULT"
  (cd "$S" && sha256sum -- $SEALED copy.* > SHA256SUMS) || die "cannot seal $S"
  chmod 0400 "$S"/*
  say "change 1 (group-only, step 4.1, [ADM-ROOT]): gpasswd -d arm sudo"
  say "back-out 1 ([CON]): gpasswd -a arm sudo; then id -Gn arm lists exactly: $(tr '\n' ' ' < "$S/groups.pre")"
  k=1
  while read -r d; do
    [ -n "$d" ] || continue; k=$((k + 1)); read -r u g md sh < <(inv_of "$d" < "$S/inv.pre")
    kp=$(lines_of "$d" group-only)
    say "change $k (disposed, step 4.1, [ADM-ROOT]): visudo -f $d, removing or changing ONLY line(s) $(lines_of "$d" disposed)and no other line${kp:+; KEEP line(s) ${kp}exactly as they are (%sudo, group-only: the route to root of afldb-admin)}"
    say "back-out $k ([CON]): install -o $u -g $g -m 0$md $S/copy.$(copy_of "$d") $d && visudo -c && sha256sum $d (must print $sh)"
  done < "$S/disposed"
  say "back-out, all of it, in one command ([CON]): env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $0 backout --state $S"
  say "realised change, after 4.1: env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $0 verify --state $S"
  say "precondition, NOT checked by this script: the [CON] root session is open now and stays open until 4.7"
  say "precondition, NOT checked by this script: Phase 1 verified twice (1.13), two independently authenticated admin logins"
  say "precondition, NOT checked by this script: the owner's separate written approval of this privilege removal, given after reading this output"
  say "precondition, NOT checked by this script: every other Phase 2 FAIL resolved, every UNKNOWN resolved or accepted, the section 0 residual accepted"
  say "state $S seal sha256 $(sha256sum < "$S/SHA256SUMS" | cut -c1-64) (write it down; verify and backout print it again)"
  finish "change=$m matches=$(grep -c '' "$S/matches.pre") disposed=$(grep -c . "$S/disposed") state=$S"
}

# ------------------------------------------------------------------------------------------------ compare the sudoers scope with the record
declare -A PRE CUR
read_inv() { local p r; PRE=(); CUR=()
  while read -r p r; do PRE[$p]=$r; done < "$S/inv.pre"
  while read -r p r; do CUR[$p]=$r; done < <(inv); }

# ------------------------------------------------------------------------------------------------ verify (step 4.2)
verify() {
  load
  local now exp p r u g md o
  now=$(arm_groups); exp=$(grep -vx sudo "$S/groups.pre")
  [ "$now" = "$exp" ] && say "check groups PASS arm's groups: $(tr '\n' ' ' <<< "$now")(pre-change minus sudo)" \
    || flag "arm's groups are [$(tr '\n' ' ' <<< "$now")], the plan expects [$(tr '\n' ' ' <<< "$exp")] (pre-change minus sudo)"
  [ "$(id -g arm)" = "$(cat "$S/gid.pre")" ] || flag "arm's primary group changed"
  [ "$(dirstat)" = "$(cat "$S/dir.pre")" ] || flag "/etc/sudoers.d itself changed: $(dirstat)"
  read_inv
  while IFS= read -r p; do
    if is_disposed "$p"; then
      r=${CUR[$p]-absent}
      if [ "$r" = absent ]; then [ "$p" = /etc/sudoers ] && flag "/etc/sudoers was removed" || say "check file PASS $p (disposed) was removed"
      elif read -r u g md _ <<< "$r" && [ "$u" = 0 ] && [[ $md =~ ^[0-7]+$ ]] && ! (( 8#$md & 8#022 )); then say "check file PASS $p (disposed) now: $r"
      else flag "$p (disposed) is not a root-owned regular file closed to group/other writes: $r"; fi
    elif [ "${CUR[$p]-absent}" = "${PRE[$p]}" ]; then say "check file PASS $p unchanged"
    else flag "$p changed outside the plan: was [${PRE[$p]}], now [${CUR[$p]-absent}]"; fi
  done < <(printf '%s\n' "${!PRE[@]}" | sort)
  while IFS= read -r p; do [ -n "${PRE[$p]+x}" ] || flag "$p was added: [${CUR[$p]}]"; done < <(printf '%s\n' "${!CUR[@]}" | sort)
  # R9-F-2: a disposed file changes ONLY on its disposed lines; every other line, each %sudo line included, is byte-identical
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    local i ln bad=0 kp; i=$(copy_of "$p"); kp=$(lines_of "$p" group-only)
    if [ "${CUR[$p]-absent}" = absent ]; then   # removal loses every logical line; allowed only when each is a disposed match
      while IFS=$'\t' read -r ln _; do
        in_class "$p" disposed "$ln" && continue; bad=1
        flag "$p was removed, but its line $ln ('$(san "$(sed -n "${ln}p" "$S/copy.$i")")') was not named for change$(in_class "$p" group-only "$ln" && echo " (it is %sudo, group-only: afldb-admin's route to root)")"
      done < <(logical "$S/copy.$i")
    else
      local h a z
      while IFS= read -r h; do   # normal diff hunks: <old>a<new> adds, <old>c<new> changes, <old>d<new> deletes
        if [[ $h =~ ^([0-9]+)a ]]; then bad=1; flag "$p: line(s) were added after line ${BASH_REMATCH[1]}, which 4.0 did not plan (a disposed file changes only on its disposed lines)"; continue; fi
        [[ $h =~ ^([0-9]+)(,([0-9]+))?[cd] ]] || { bad=1; flag "$p: unreadable difference '$h'"; continue; }
        a=${BASH_REMATCH[1]}; z=${BASH_REMATCH[3]:-$a}
        for ((ln = a; ln <= z; ln++)); do
          in_class "$p" disposed "$ln" && continue; bad=1
          flag "$p:$ln ('$(san "$(sed -n "${ln}p" "$S/copy.$i")")') was changed or removed, but 4.0 did not name it for change$(in_class "$p" group-only "$ln" && echo " (it is %sudo, group-only: afldb-admin's route to root)")"
        done
      done < <(diff -- "$S/copy.$i" "$p" | grep -E '^[0-9]')
    fi
    [ $bad = 0 ] && say "check kept PASS $p: only its disposed line(s) $(lines_of "$p" disposed)changed; every other line is byte-identical${kp:+, including the %sudo line(s) $kp}"
  done < "$S/disposed"
  if [ "$(cat "$S/admin-l.pre" 2>/dev/null)" = "no account afldb-admin" ]; then say "check admin-sudo-l not compared: no account afldb-admin at entry"
  elif o=$(admin_l); [ -f "$S/admin-l.pre" ] && [ "$o" = "$(cat "$S/admin-l.pre")" ]; then say "check admin-sudo-l PASS sudo -l -U afldb-admin equals the pre-change record: $(admin_summary "$o")"
  else flag "sudo -l -U afldb-admin differs from the pre-change record (the admin's own route to root): now $(admin_summary "$o"); diff record/now: $(diff "$S/admin-l.pre" <(admin_l) 2>&1 | tr '\n' ';')"; fi
  check_incs < <(incs)
  if visudo_c; then say "check visudo-c PASS"; else flag "visudo -c fails: $(tr '\n' ';' <<< "$VISUDO_OUT")"; fi
  o=$(scan_all); [ -z "$o" ] && say "check rescan PASS no sudoers line names arm, a group of arm or a grant form entry refuses, and no outside rule source" \
    || flag "the rescan still finds (B3 and stricter rules): $(awk -F'\t' '{printf "%s:%s(%s) ", $1, $2, $3}' <<< "$o")"
  o=$(sudo_summary)
  [ "$o" = "arm is not allowed to run sudo" ] && say "check sudo-l PASS sudo -l -U arm: $o" || flag "sudo -l -U arm: $o"
  [ ${#BAD[@]} = 0 ] || say "STOP: back out now in [CON] with: env -i PATH=/usr/sbin:/usr/bin LC_ALL=C /usr/bin/bash --noprofile --norc $0 backout --state $S; then dispose of the residual separately and run a NEW entry. Do NOT return to step 4.1."
  finish "the realised change equals the plan ($(paste -sd' ' "$S/plan")) and arm cannot sudo"
}

# ------------------------------------------------------------------------------------------------ backout
backout() {
  load
  local d i u g md sh tmp p now
  while read -r d; do
    [ -n "$d" ] || continue
    i=$(copy_of "$d"); read -r u g md sh < <(inv_of "$d" < "$S/inv.pre")
    if [ "$(inv | inv_of "$d")" = "$u $g $md $sh" ]; then say "disposed $d already equals its pre-change record"; continue; fi
    tmp=${d%/*}/.afldb-phase4-restore.$$
    if rm -f -- "$tmp" && (set -C; cat -- "$S/copy.$i" > "$tmp") && chown "$u:$g" -- "$tmp" && chmod "$md" -- "$tmp" && mv -f -- "$tmp" "$d"; then
      say "restored $d from $S/copy.$i (owner $u:$g, mode 0$md)"
    else rm -f -- "$tmp"; flag "could not restore $d from $S/copy.$i"; fi
  done < "$S/disposed"
  if grep -qx sudo "$S/groups.pre" && ! arm_groups | grep -qx sudo; then
    if gpasswd -a arm sudo > /dev/null 2>&1; then say "ran: gpasswd -a arm sudo"; else flag "gpasswd -a arm sudo failed"; fi
  else say "arm is already in group sudo"; fi
  if visudo_c; then say "check visudo-c PASS"; else flag "visudo -c fails: $(tr '\n' ';' <<< "$VISUDO_OUT")"; fi
  read_inv
  while IFS= read -r p; do
    if [ "${CUR[$p]-absent}" = "${PRE[$p]}" ]; then say "check file PASS $p equals its pre-change record (${PRE[$p]})"
    elif is_disposed "$p"; then flag "$p (disposed) still differs from its pre-change record: now [${CUR[$p]-absent}]"
    else flag "$p changed outside the plan (now [${CUR[$p]-absent}], was [${PRE[$p]}]): review it, then restore it by hand from $S/copy.$(copy_of "$p")"; fi
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
  finish "the sudoers scope, arm's groups and sudo -l -U arm equal the pre-change record of $S"
}

$CMD
