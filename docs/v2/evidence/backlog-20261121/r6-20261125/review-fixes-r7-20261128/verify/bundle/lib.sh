# afldb-verify lib.sh (R6 r7, MED-2). ROOT-OWNED, installed at /usr/local/lib/afldb-verify/lib.sh, pinned by SHA256SUMS.
# Sourced (never executed) by afldb-verify-dispatch and the three cores. It defines functions and constants only.
# Rules every caller relies on (DESIGN.md 5.1): the process runs as afldb-verify, under `env -i PATH=/usr/sbin:/usr/bin LC_ALL=C`
# and `bash --noprofile --norc`, so no startup file, exported function or alias exists; PATH holds only root-owned directories
# (checked by bundle_selfcheck before any core runs); nothing arm owns is executed, sourced or loaded; every arm-owned value the
# cores print passes through san() so it cannot start a line of its own (no forged PASS/RESULT/OFFHOST-COMPARE line).
VB=/usr/local/lib/afldb-verify
PY=/usr/bin/python3.12
VPY=$VB/afldb-verify-py

# Printable ASCII only, newline and every control byte become '?', at most $2 (default 400) characters.
san() { local s=${1-}; s=${s//[^[:print:]]/?}; printf '%s' "${s:0:${2:-400}}"; }

# This host's name and boot ID from the kernel (no binary).
host_name() { local h; read -r h < /proc/sys/kernel/hostname; printf '%s' "$h"; }
boot_id32() { local b; read -r b < /proc/sys/kernel/random/boot_id; printf '%s' "${b//-/}"; }

# R6 r6: TRUSTED PATH (byte-identical to r6-pre-verify.sh / r1-g0-dump.sh). Returns 0 only when no component of the absolute path from
# / to the leaf is a symbolic link, every component is owned by uid 0 and is not group- or other-writable, every component but the leaf
# is a directory, and the leaf is a directory (dir) or a regular file (file; record: also exactly one hard link). Sets TP_WHY.
trusted_path() { # absolute-path dir|file|record
  local p=$1 want=$2 r c= i=0 u a n t out; local -a cs=(/)
  TP_WHY=
  [[ $p =~ ^(/[A-Za-z0-9_@.][A-Za-z0-9_@.-]{0,254}){1,32}$ && /$p/ != */./* && /$p/ != */../* ]] \
    || { TP_WHY="'${p//[^A-Za-z0-9\/._@-]/?}' is not a plain absolute path"; TP_WHY=${TP_WHY:0:200}; return 1; }
  r=${p#/}; while [ -n "$r" ]; do c=$c/${r%%/*}; cs+=("$c"); if [[ $r == */* ]]; then r=${r#*/}; else r=; fi; done
  out=$(stat -c '%u %a %h %F' -- "${cs[@]}" 2>/dev/null) || { TP_WHY="$p: missing, or a component cannot be read"; return 1; }
  while read -r u a n t; do
    c=${cs[i]}; i=$((i + 1))
    [[ $u =~ ^[0-9]+$ && $a =~ ^[0-7]{3,4}$ && $n =~ ^[0-9]+$ ]] || { TP_WHY="$c: unparsable stat output"; return 1; }
    [ "$t" != "symbolic link" ] || { TP_WHY="$c is a symbolic link"; return 1; }
    [ "$u" = 0 ] || { TP_WHY="$c is owned by uid $u, not root"; return 1; }
    if (( 8#$a & 8#022 )); then TP_WHY="$c has mode $a: group- or other-writable"; return 1; fi
    if [ "$i" -lt "${#cs[@]}" ] || [ "$want" = dir ]; then [ "$t" = directory ] || { TP_WHY="$c is a $t, not a directory"; return 1; }
    else [ "$t" = "regular file" ] || { TP_WHY="$c is a $t, not a regular file"; return 1; }; fi
    [ "$i" -lt "${#cs[@]}" ] || [ "$want" != record ] || [ "$n" = 1 ] || { TP_WHY="$c has $n hard links (need 1)"; return 1; }
  done <<< "$out"
  [ "$i" = "${#cs[@]}" ] || { TP_WHY="$p: stat printed $i lines for ${#cs[@]} components"; return 1; }
}

# A helper the verifier executes: the name's directory is trusted, and the file it finally resolves to (alternatives links
# included, every hop under root-owned directories) is a trusted regular file. Sets TP_WHY.
trusted_helper() { # absolute path of a helper
  local p=$1 r
  trusted_path "${p%/*}" dir || return 1
  r=$(readlink -e -- "$p") || { TP_WHY="$p: cannot be resolved"; return 1; }
  trusted_path "$r" file || return 1
}

# Every helper any core may execute, by absolute path or through PATH=/usr/sbin:/usr/bin.
HELPERS=(/usr/bin/bash /usr/bin/dash /usr/bin/env /usr/bin/timeout /usr/bin/stat /usr/bin/sha256sum /usr/bin/readlink /usr/bin/cat
  /usr/bin/date /usr/bin/id /usr/bin/sed /usr/bin/grep /usr/bin/awk /usr/bin/sort /usr/bin/cut /usr/bin/head /usr/bin/tail /usr/bin/tr
  /usr/bin/wc /usr/bin/ls /usr/bin/uname /usr/bin/uptime /usr/bin/dpkg-query /usr/bin/findmnt /usr/sbin/sysctl /usr/bin/apt-config
  /usr/bin/systemctl /usr/bin/busctl /usr/bin/journalctl /usr/bin/pgrep /usr/bin/df /usr/bin/free /usr/bin/basename /usr/bin/printf
  "$PY")
# Not checked here because it exists on production only: /usr/lib/postgresql/16/bin/psql (a2-core.sh checks it before use).

# Root facts (DESIGN 5.3 substitution; see README "root facts"): the socket-activated ROOT reader afldb-verify-rootfacts answers one
# fixed request with key<TAB>value lines (values printable ASCII). Loads RF[key] (repeated keys joined by newlines). Returns 0 only
# when the reader answered completely (last line "end<TAB>ok"); otherwise sets RF_WHY.
declare -A RF=()
rootfacts() { # request words
  local out rc k v
  RF=(); RF_WHY=
  out=$(timeout -k 5 900 "$PY" -I -S "$VPY" facts "$*" 2>&1); rc=$?
  [ "$rc" = 0 ] || { RF_WHY="the root facts reader failed (exit $rc): $(san "$out" 200)"; return 1; }
  while IFS=$'\t' read -r k v; do
    [[ $k =~ ^[a-z0-9_.-]{1,64}$ ]] || continue
    if [ -n "${RF[$k]+x}" ]; then RF[$k]+=$'\n'"$v"; else RF[$k]=$v; fi
  done <<< "$out"
  [ "${RF[end]:-}" = ok ] || { RF_WHY="the root facts reader's answer is incomplete"; return 1; }
}

# Result fields for the dispatcher: printed on a line that starts with the per-run token the dispatcher passed in the environment
# (never in argv, so no other uid can read it from /proc/<pid>/cmdline). The dispatcher removes these lines from the gate output.
field() { # key value
  [ -n "${AFLDB_VERIFY_TOKEN:-}" ] || return 0
  printf 'FIELD-%s %s=%s\n' "$AFLDB_VERIFY_TOKEN" "$1" "$(san "$2" 200)"
}
