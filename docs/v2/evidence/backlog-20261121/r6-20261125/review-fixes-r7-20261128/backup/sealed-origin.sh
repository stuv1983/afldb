# sealed-origin.sh: R6 r7 (28 Nov 2026) gate rule for the nightly backup's ORIGIN and DUMP (DESIGN.md section 3.5). PREPARED, NOT
# INSTALLED. A side-effect-free bash function library: SOURCE it (bash 5), never execute it. Byte-identical wherever it is used
# (the owner verifier's root-owned bundle; /usr/local/lib/afldb-backup/sealed-origin.sh for verify-backup-install.sh).
#
#   sealed_origin <gate-date YYYY-MM-DD>
#     Returns 0 only when EVERY rule below holds. Always sets SO_REASON (empty on success), SO_INVOCATION, SO_DUMP, SO_SHA (full
#     64 hex), SO_BYTES, SO_DISPATCH_KIND (scheduled|catch-up), SO_DISPATCH_DELAY_S (seconds from the timer unit's last
#     (re)activation to the dispatch, one decimal), SO_TIMER_USEC (the dispatch, realtime microseconds) and SO_SEAL (path);
#     the facts are filled only on success. Prints nothing on stdout but diagnostics prefixed "  sealed-origin: ".
#     The CALLER prints "OFFHOST-COMPARE $SO_DUMP $SO_SHA" on success and "scheduled origin unproven: $SO_REASON" otherwise.
#   sealed_origin_install
#     Rules 1-3 only (trusted paths, pinned digests, effective unit): the installation, without any seal. Sets SO_REASON.
#
# It writes nothing, creates no file, changes no shell option it does not restore, defines no global but SO_* (and the functions
# so__*), reads no environment variable (TZ, LC_ALL and PATH are set per command), takes nothing from its arguments but the gate
# date, executes only absolute root-owned helpers (/usr/bin/systemctl, busctl, stat, sha256sum, date), and never reads or executes
# anything under /home or anything arm owns. No journal line counts for anything. The caller must run as root or as a member of
# afldb-backup-read (published/ is root:afldb-backup-read 0750).
#
# Rules (r6 DESIGN 4 items 1-5 as changed by r7 DESIGN 3.5):
#  1. Trusted path (no symbolic link from / to the leaf, every component owned by root and not group- or other-writable, the leaf of
#     the expected type): the helpers the unit and these rules execute, the zone file, every file and directory under
#     /usr/local/lib/afldb-backup, the drop-in, the service's and the timer's FragmentPath and every DropInPaths entry,
#     /var/lib/afldb-backup and seals/ (root:root 0755), published/ and state/ (root:afldb-backup-read 0750), staging/
#     (afldb-backup:afldb-backup 0700 under a trusted parent), the seal (root:root 0644, one link), the published dump and its
#     sidecar (root:afldb-backup-read 0440, one link).
#  2. Pinned digests (constants below): afldb-backup-run, afldb-backup-seal, the installed backup.sh, the drop-in.
#  3. Effective unit (PID 1's view): User=afldb-backup, Group=afldb-backup, no SupplementaryGroups, no EnvironmentFiles, exactly one
#     ExecStart = the run's argv with no flags, exactly one ExecStartPost = the sealer's argv with flags exactly "privileged" (no
#     ignore-failure), NO ExecCondition, ExecStartPre, ExecStop, ExecStopPost or ExecReload command (review round 1, INFO),
#     ProtectHome=yes, ReadWritePaths exactly the staging directory, NoNewPrivileges=yes, DropInPaths has the drop-in; and no .env in
#     the code directory (backup.sh would source /usr/local/lib/afldb-backup/.env; review round 1, INFO).
#  4. The seal: among every seal, exactly ONE whose start job was created by afldb-backup.timer with its dispatch in the gate date's
#     02:20:00-02:31:00 Australia/Melbourne window (as the gates compute it: TZ=Australia/Melbourne date -d "<date> 02:20" +%s, and
#     02:31, whole seconds inclusive); no other seal names the same dispatch; no other seal was written from the window start to the
#     window end + 15 min 6 s (a start by hand or a second run in the window is ambiguous: refused). Exact afldb-backup-seal/4 format
#     (26 lines, byte size, file name = invocation); sealer_sha256 = the pinned sealer; service_user=afldb-backup; job_type=start;
#     activating/start-post; ExecStart exited 0; trigger_timer_realtime_usec = timer_last_trigger_usec = the timer's LastTriggerUSec
#     now (busctl); inactive_enter < dispatch <= inactive_exit, main start, both within 5 s (no order between those two: systemd
#     255.4 stamps the main start first); dispatch_kind RECOMPUTED from the sealed stamps and equal to the sealed label: catch-up
#     exactly when the timer unit became active (timer_active_enter_usec, realtime) at or after the gate date's 02:20:00 Melbourne
#     (the dispatch lies in that date's window, so this is the dispatch's date) or the dispatch came < 5 s after that activation
#     (monotonic), otherwise scheduled (review round 1, F3); dump, dump_sha256, dump_bytes not none.
#  5. The dump: published/<dump> is a regular root:afldb-backup-read 0440 file with one link and dump_bytes bytes, and its FULL
#     re-hash equals dump_sha256; published/<dump>.sha256 is exactly "<dump_sha256>  <dump>\n" with the same ownership and mode.
#  6. The completion record (review round 1, F4): seals/<invocation>.done is a regular root:root 0644 file with one link holding
#     exactly "afldb-backup-done/1", invocation=, dump=, dump_sha256= equal to the seal's, and completed_realtime_usec= at or after
#     the seal's sealed_realtime_usec. The sealer writes it as its very last step, so a run that failed after publication (state
#     record, retention, staging removal) is never eligible, whatever the unit's Result= says later.
# Staging, temporaries, a seal without its published file or completion record, and a published file without a valid seal are
# never eligible.

# so__tp <absolute-path> dir|file|seal|pub [user group mode]: TRUSTED PATH (one stat call, no symbolic link followed). Every
# component but the leaf: directory, uid 0, not group/other-writable. The leaf: dir or file; seal/pub: regular file, one link;
# with user/group/mode the leaf must match them exactly (then the leaf's owner need not be root). Sets SO__TPW on failure.
so__tp() {
  local p=$1 want=$2 lu=${3:-} lg=${4:-} lm=${5:-} r c= i=0 u g a n t U G out; local -a cs=(/)
  SO__TPW=
  [[ $p =~ ^(/[A-Za-z0-9_@.][A-Za-z0-9_@.+-]{0,254}){1,32}$ && /$p/ != */./* && /$p/ != */../* ]] \
    || { SO__TPW="'${p//[^A-Za-z0-9\/._@+-]/?}' is not a plain absolute path"; SO__TPW=${SO__TPW:0:200}; return 1; }
  r=${p#/}; while [ -n "$r" ]; do c=$c/${r%%/*}; cs+=("$c"); if [[ $r == */* ]]; then r=${r#*/}; else r=; fi; done
  out=$(LC_ALL=C /usr/bin/stat -c '%u %g %a %h %U %G %F' -- "${cs[@]}" 2>/dev/null) || { SO__TPW="$p: missing, or a component cannot be read"; return 1; }
  while read -r u g a n U G t; do
    c=${cs[i]}; i=$((i + 1))
    [[ $u =~ ^[0-9]+$ && $a =~ ^[0-7]{3,4}$ && $n =~ ^[0-9]+$ ]] || { SO__TPW="$c: unparsable stat output"; return 1; }
    [ "$t" != "symbolic link" ] || { SO__TPW="$c is a symbolic link"; return 1; }
    if [ "$i" -lt "${#cs[@]}" ] || [ -z "$lu" ]; then
      [ "$u" = 0 ] || { SO__TPW="$c is owned by uid $u, not root"; return 1; }
      if (( 8#$a & 8#022 )); then SO__TPW="$c has mode $a: group- or other-writable"; return 1; fi
    else
      [ "$U:$G $a" = "$lu:$lg $lm" ] || { SO__TPW="$c is $U:$G $a, not $lu:$lg $lm"; return 1; }
    fi
    if [ "$i" -lt "${#cs[@]}" ] || [ "$want" = dir ]; then [ "$t" = directory ] || { SO__TPW="$c is a $t, not a directory"; return 1; }
    else [ "$t" = "regular file" ] || { SO__TPW="$c is a $t, not a regular file"; return 1; }; fi
    [ "$i" -lt "${#cs[@]}" ] || [ "$want" = dir ] || [ "$want" = file ] || [ "$n" = 1 ] || { SO__TPW="$c has $n hard links (need 1)"; return 1; }
  done <<< "$out"
  [ "$i" = "${#cs[@]}" ] || { SO__TPW="$p: stat printed $i lines for ${#cs[@]} components"; return 1; }
}

# so__parse <seal-path> <assoc-array-name>: the exact afldb-backup-seal/4 format into the named associative array. Sets SO__PW.
so__parse() {
  local f=$1 i n=26 re sz; local -n so__F=$2; local -a L K R
  local N='(0|[1-9][0-9]{0,17})'
  SO__PW=
  K=(sealer_sha256 unit invocation job job_type active_state sub_state exec_main_code exec_main_status service_user inactive_enter_mono
    inactive_exit_mono exec_main_start_mono trigger_unit trigger_timer_realtime_usec timer_last_trigger_usec timer_last_trigger_mono
    timer_active_enter_mono timer_active_enter_usec dispatch_kind dump dump_sha256 dump_bytes boot_id sealed_realtime_usec)
  R=('[0-9a-f]{64}' 'afldb-backup\.service' '[0-9a-f]{32}' '[1-9][0-9]{0,9}' '[a-z-]{1,32}' '[a-z-]{1,32}' '[a-z-]{1,32}' '[0-9]{1,3}'
    '[0-9]{1,3}' 'afldb-backup' "$N" "$N" "$N" 'none|[A-Za-z0-9_.@:-]{1,255}' 'none|[1-9][0-9]{0,17}' "$N" "$N" "$N" "$N" 'scheduled|catch-up'
    'none|afldb_prod-[0-9]{8}-[0-9]{6}\.dump' 'none|[0-9a-f]{64}' 'none|[1-9][0-9]{0,17}' '[0-9a-f]{32}' '[1-9][0-9]{15,17}')
  mapfile -t L 2>/dev/null < "$f" || { SO__PW="$f cannot be read"; return 1; }
  [ "${#L[@]}" = 26 ] && [ "${L[0]}" = afldb-backup-seal/4 ] || { SO__PW="$f is malformed (${#L[@]} lines, need the 26-line afldb-backup-seal/4 format)"; return 1; }
  so__F=()
  for i in "${!K[@]}"; do
    re="^${K[i]}=(${R[i]})\$"
    [[ ${L[i + 1]} =~ $re ]] || { SO__PW="$f line $((i + 2)) is not ${K[i]}=<value>"; return 1; }
    so__F[${K[i]}]=${BASH_REMATCH[1]}; n=$((n + ${#L[i + 1]}))
  done
  n=$((n + ${#L[0]}))
  sz=$(LC_ALL=C /usr/bin/stat -c %s -- "$f" 2>/dev/null); [ "$sz" = "$n" ] || { SO__PW="$f has $sz bytes, not the $n of its 26 lines"; return 1; }
  [ "${f##*/}" = "${so__F[invocation]}.seal" ] || { SO__PW="$f names invocation ${so__F[invocation]}"; return 1; }
}

sealed_origin_install() {
  local CODE=/usr/local/lib/afldb-backup RUN=/usr/local/lib/afldb-backup/afldb-backup-run SEALER=/usr/local/lib/afldb-backup/afldb-backup-seal
  local BKSH=/usr/local/lib/afldb-backup/tools/maintenance/backup.sh DI=/etc/systemd/system/afldb-backup.service.d/70-afldb-backup-sealed.conf
  local RUN_SHA=2c62ff919908cddadd4ccf57bd6f0344d3aba4be2ae49a413ab13a58e8658085 SEAL_SHA=793e94bef7e9797815709da530beab09652e4cce200f7a769fdd5fb092a2ece5
  local BKSH_SHA=df609046a6a322db3f651d9d2c9cf1820fdb9ca0d0d4d9ae9f67c3dede1be3be DI_SHA=f8a18580e8638f0a0923519b4280c24c3e94f4eba5c82f23a03a65b7fb7fbdeb
  local XS='/usr/bin/bash --noprofile --norc /usr/local/lib/afldb-backup/afldb-backup-run'
  local XP='/usr/bin/env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash --noprofile --norc /usr/local/lib/afldb-backup/afldb-backup-seal'
  local DR=/var/lib/afldb-backup out l p h re k v frag= drop= tfrag= tdrop= ef=0 nx=0 np=0 ex= ep= hit; local -a ps tps fs; local -A U
  SO_REASON=
  # rule 3: the unit as PID 1 has it loaded
  out=$(LC_ALL=C /usr/bin/systemctl show afldb-backup.service -p FragmentPath -p DropInPaths -p EnvironmentFiles -p ExecStartEx -p ExecStartPostEx \
    -p User -p Group -p SupplementaryGroups -p ProtectHome -p ReadWritePaths -p NoNewPrivileges -p ExecConditionEx -p ExecStartPreEx \
    -p ExecStopEx -p ExecStopPostEx -p ExecReloadEx 2>/dev/null) \
    || { SO_REASON="systemctl show afldb-backup.service failed"; return 1; }
  while IFS= read -r l; do
    k=${l%%=*}; v=${l#*=}
    case $k in
      EnvironmentFiles) [ -z "$v" ] || ef=$((ef + 1));;
      ExecStartEx) [ -z "$v" ] || { nx=$((nx + 1)); ex=$v; };;
      ExecStartPostEx) [ -z "$v" ] || { np=$((np + 1)); ep=$v; };;
      ExecConditionEx|ExecStartPreEx|ExecStopEx|ExecStopPostEx|ExecReloadEx)
        [ -z "$v" ] || { SO_REASON="afldb-backup.service has a $k command (only ExecStart and the sealer's ExecStartPost are allowed)"; return 1; };;
      FragmentPath|DropInPaths|User|Group|SupplementaryGroups|ProtectHome|ReadWritePaths|NoNewPrivileges)
        [ -z "${U[$k]+x}" ] || { SO_REASON="systemctl show afldb-backup.service printed $k twice"; return 1; }; U[$k]=$v;;
      *) SO_REASON="unexpected line from systemctl show afldb-backup.service"; return 1;;
    esac
  done <<< "$out"
  frag=${U[FragmentPath]:-}; drop=${U[DropInPaths]:-}
  [ "$ef" = 0 ] || { SO_REASON="afldb-backup.service has $ef EnvironmentFile= entries"; return 1; }
  [ "${U[User]:-}/${U[Group]:-}" = afldb-backup/afldb-backup ] || { SO_REASON="afldb-backup.service runs as User=${U[User]:-} Group=${U[Group]:-}, not afldb-backup/afldb-backup (is the drop-in installed?)"; return 1; }
  [ -z "${U[SupplementaryGroups]:-}" ] || { SO_REASON="afldb-backup.service has SupplementaryGroups=${U[SupplementaryGroups]}"; return 1; }
  [ "${U[ProtectHome]:-}" = yes ] || { SO_REASON="afldb-backup.service has ProtectHome=${U[ProtectHome]:-}, not yes"; return 1; }
  [ "${U[ReadWritePaths]:-}" = /var/lib/afldb-backup/staging ] || { SO_REASON="afldb-backup.service ReadWritePaths is '${U[ReadWritePaths]:-}', not exactly /var/lib/afldb-backup/staging"; return 1; }
  [ "${U[NoNewPrivileges]:-}" = yes ] || { SO_REASON="afldb-backup.service has NoNewPrivileges=${U[NoNewPrivileges]:-}"; return 1; }
  re='^\{ path=([^ ]+) ; argv\[\]=(.*) ; flags=([a-z -]*) ; start_time='
  [ "$nx" = 1 ] && [[ $ex =~ $re ]] && [ "${BASH_REMATCH[1]}|${BASH_REMATCH[2]}|${BASH_REMATCH[3]}" = "/usr/bin/bash|$XS|" ] \
    || { SO_REASON="afldb-backup.service has $nx ExecStart commands, or its ExecStart is not exactly '$XS' without flags"; return 1; }
  [ "$np" = 1 ] && [[ $ep =~ $re ]] && [ "${BASH_REMATCH[1]}|${BASH_REMATCH[2]}" = "/usr/bin/env|$XP" ] \
    || { SO_REASON="afldb-backup.service has $np ExecStartPost commands, or its ExecStartPost is not exactly the sealer's command line"; return 1; }
  [ "${BASH_REMATCH[3]}" = privileged ] || { SO_REASON="afldb-backup.service ExecStartPost flags are '${BASH_REMATCH[3]}', not 'privileged' (the drop-in's +, without -)"; return 1; }
  [[ " $drop " == *" $DI "* ]] || { SO_REASON="afldb-backup.service DropInPaths lacks $DI"; return 1; }
  read -ra ps <<< "$drop"
  out=$(LC_ALL=C /usr/bin/systemctl show afldb-backup.timer -p FragmentPath -p DropInPaths 2>/dev/null) || { SO_REASON="systemctl show afldb-backup.timer failed"; return 1; }
  while IFS= read -r l; do case $l in FragmentPath=*) tfrag=${l#*=};; DropInPaths=*) tdrop=${l#*=};; esac; done <<< "$out"
  read -ra tps <<< "$tdrop"
  [ -n "$frag" ] && [ -n "$tfrag" ] || { SO_REASON="afldb-backup.service or afldb-backup.timer has no FragmentPath"; return 1; }
  # rule 1: trusted paths (helpers, zone, unit files, the code directory and every entry in it, the data directories)
  for p in /usr/bin/env /usr/bin/bash /usr/bin/systemctl /usr/bin/busctl /usr/bin/sha256sum /usr/bin/stat /usr/bin/date /usr/bin/timeout \
      /usr/bin/cp /usr/bin/mv /usr/bin/chown /usr/bin/chmod /usr/bin/rm /usr/bin/id /usr/bin/find /usr/bin/sed /usr/bin/head \
      /usr/share/zoneinfo/Australia/Melbourne "$RUN" "$SEALER" "$BKSH" "$DI" "$frag" "${ps[@]}" "$tfrag" "${tps[@]}"; do
    so__tp "$p" file || { SO_REASON="untrusted path: $SO__TPW"; return 1; }
  done
  so__tp "$CODE" dir || { SO_REASON="untrusted path: $SO__TPW"; return 1; }
  [ ! -e "$CODE/.env" ] && [ ! -L "$CODE/.env" ] || { SO_REASON="$CODE/.env exists: backup.sh would source it"; return 1; }
  hit=$(shopt -p nullglob dotglob); shopt -s nullglob dotglob
  fs=("$CODE"/* "$CODE"/*/* "$CODE"/*/*/* "$CODE"/*/*/*/*); eval "$hit"
  for p in "${fs[@]}"; do
    if [ -d "$p" ] && [ ! -L "$p" ]; then so__tp "$p" dir; else so__tp "$p" file; fi || { SO_REASON="untrusted path in $CODE: $SO__TPW"; return 1; }
  done
  so__tp "$DR" dir root root 755 && so__tp "$DR/seals" dir root root 755 && so__tp "$DR/published" dir root afldb-backup-read 750 \
    && so__tp "$DR/state" dir root afldb-backup-read 750 && so__tp "$DR/staging" dir afldb-backup afldb-backup 700 \
    || { SO_REASON="untrusted data directory: $SO__TPW"; return 1; }
  # rule 2: pinned digests
  for p in "$RUN:$RUN_SHA" "$SEALER:$SEAL_SHA" "$BKSH:$BKSH_SHA" "$DI:$DI_SHA"; do
    h=$(/usr/bin/sha256sum < "${p%%:*}" 2>/dev/null); [ "${h%% *}" = "${p##*:}" ] \
      || { SO_REASON="${p%%:*} has sha256 ${h:0:16}..., not the pinned ${p##*:}"; SO_REASON=${SO_REASON:0:220}...; return 1; }
  done
  return 0
}

sealed_origin() { # gate-date YYYY-MM-DD
  local day=${1:-} SEAL_SHA=793e94bef7e9797815709da530beab09652e4cce200f7a769fdd5fb092a2ece5 SD=/var/lib/afldb-backup/seals PD=/var/lib/afldb-backup/published
  local b0 b1 tu out s c= cu cnt=0 other= f d ie tm ix xs ta tr kind h sz side sre hit dn dl; local -a seals DL; local -A F G
  SO_REASON=; SO_INVOCATION=; SO_DUMP=; SO_SHA=; SO_BYTES=; SO_DISPATCH_KIND=; SO_DISPATCH_DELAY_S=; SO_TIMER_USEC=; SO_SEAL=
  [[ $day =~ ^20[0-9]{2}-[01][0-9]-[0-3][0-9]$ ]] || { SO_REASON="invalid gate date '${day//[^0-9-]/?}'"; return 1; }
  b0=$(TZ=Australia/Melbourne LC_ALL=C /usr/bin/date -d "$day 02:20" +%s 2>/dev/null); b1=$(TZ=Australia/Melbourne LC_ALL=C /usr/bin/date -d "$day 02:31" +%s 2>/dev/null)
  [[ $b0 =~ ^[1-9][0-9]{8,10}$ && $b1 =~ ^[1-9][0-9]{8,10}$ ]] && (( b1 - b0 == 660 )) || { SO_REASON="cannot compute the $day 02:20-02:31 Australia/Melbourne window"; return 1; }
  sealed_origin_install || return 1
  # rule 4: the seals
  hit=$(shopt -p nullglob dotglob); shopt -s nullglob; shopt -u dotglob; seals=("$SD"/*.seal); eval "$hit"
  for s in "${seals[@]}"; do
    so__tp "$s" seal root root 644 || { SO_REASON="untrusted seal: $SO__TPW"; return 1; }
    so__parse "$s" G || { SO_REASON="malformed seal: $SO__PW"; return 1; }
    if [ "${G[trigger_unit]}" = afldb-backup.timer ] && [ "${G[trigger_timer_realtime_usec]}" != none ] \
       && (( b0 <= G[trigger_timer_realtime_usec] / 1000000 && G[trigger_timer_realtime_usec] / 1000000 <= b1 )); then
      cnt=$((cnt + 1)); c=$s; cu=${G[trigger_timer_realtime_usec]}
    fi
  done
  [ "$cnt" = 1 ] || { SO_REASON="$cnt seals in $SD record a start job created by afldb-backup.timer with its dispatch in the $day 02:20-02:31 window (need exactly 1; a start by hand never counts)"; return 1; }
  for s in "${seals[@]}"; do
    [ "$s" != "$c" ] || continue
    so__parse "$s" G || { SO_REASON="malformed seal: $SO__PW"; return 1; }
    [ "${G[trigger_timer_realtime_usec]}" != "$cu" ] || { SO_REASON="$s names the same dispatch ($cu us) as $c"; return 1; }
    if (( b0 <= G[sealed_realtime_usec] / 1000000 && G[sealed_realtime_usec] / 1000000 <= b1 + 906 )); then
      SO_REASON="another run of afldb-backup.service was sealed in the window ($s, trigger ${G[trigger_unit]}): ambiguous"; return 1
    fi
  done
  so__parse "$c" F || { SO_REASON="malformed seal: $SO__PW"; return 1; }
  f=$c
  # the timer's LastTriggerUSec now (microseconds, system bus): the sealed dispatch must still be the timer's last one
  out=$(/usr/bin/busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/afldb_2dbackup_2etimer org.freedesktop.systemd1.Timer LastTriggerUSec 2>/dev/null)
  [[ $out =~ ^t\ ([1-9][0-9]{6,17})$ ]] || { SO_REASON="afldb-backup.timer LastTriggerUSec could not be read in microseconds (busctl)"; return 1; }
  tu=${BASH_REMATCH[1]}
  [ "${F[sealer_sha256]}" = "$SEAL_SHA" ] || { SO_REASON="seal $f was written by sealer ${F[sealer_sha256]:0:16}..., not the pinned ${SEAL_SHA:0:16}..."; return 1; }
  [ "${F[job_type]}" = start ] || { SO_REASON="seal $f: the run's job is a ${F[job_type]} job, not a start job"; return 1; }
  [ "${F[active_state]}/${F[sub_state]}" = activating/start-post ] || { SO_REASON="seal $f: the unit was ${F[active_state]}/${F[sub_state]} when sealed, not activating/start-post"; return 1; }
  [ "${F[exec_main_code]}/${F[exec_main_status]}" = 1/0 ] || { SO_REASON="seal $f: ExecStart ended with code ${F[exec_main_code]} status ${F[exec_main_status]}, not exited 0"; return 1; }
  [ "${F[timer_last_trigger_usec]}" = "$cu" ] || { SO_REASON="seal $f: the start job records the dispatch at $cu us, the timer's LastTriggerUSec was ${F[timer_last_trigger_usec]} us when sealed"; return 1; }
  [ "$tu" = "$cu" ] || { SO_REASON="seal $f: the dispatch is $cu us, but the timer's LastTriggerUSec is $tu us now (a later dispatch)"; return 1; }
  ie=${F[inactive_enter_mono]}; tm=${F[timer_last_trigger_mono]}; ix=${F[inactive_exit_mono]}; xs=${F[exec_main_start_mono]}; ta=${F[timer_active_enter_mono]}
  tr=${F[timer_active_enter_usec]}
  (( ie < tm )) || { SO_REASON="seal $f: the unit entered inactive (monotonic $ie) after the dispatch ($tm): it stopped or failed between the dispatch and this invocation (a restart inside the timer's job)"; return 1; }
  (( tm <= ix && tm <= xs )) || { SO_REASON="seal $f: inactive-exit $ix or main start $xs (monotonic) precedes the dispatch $tm"; return 1; }
  (( ix - tm <= 5000000 && xs - tm <= 5000000 )) || { SO_REASON="seal $f: the unit left inactive $((ix - tm)) us and its main process started $((xs - tm)) us after the dispatch (more than 5 s)"; return 1; }
  # F3: recomputed. The dispatch lies in the gate date's window, so its Melbourne date is the gate date and its 02:20:00 is b0.
  if (( tr >= b0 * 1000000 || tm - ta < 5000000 )); then kind=catch-up; else kind=scheduled; fi
  [ "${F[dispatch_kind]}" = "$kind" ] || { SO_REASON="seal $f says dispatch_kind=${F[dispatch_kind]}, its own stamps say $kind (timer active at $tr us, $((tm - ta)) us before the dispatch)"; return 1; }
  [ "${F[dump]}" != none ] && [ "${F[dump_sha256]}" != none ] && [ "${F[dump_bytes]}" != none ] \
    || { SO_REASON="seal $f binds no dump (dump=${F[dump]}): the run's dump was not sealed"; return 1; }
  # rule 5: the published dump and its root sidecar
  d=$PD/${F[dump]}
  so__tp "$d" pub root afldb-backup-read 440 || { SO_REASON="published dump: $SO__TPW"; return 1; }
  so__tp "$d.sha256" pub root afldb-backup-read 440 || { SO_REASON="published sidecar: $SO__TPW"; return 1; }
  sz=$(LC_ALL=C /usr/bin/stat -c %s -- "$d" 2>/dev/null); [ "$sz" = "${F[dump_bytes]}" ] || { SO_REASON="$d has $sz bytes, the seal says ${F[dump_bytes]}"; return 1; }
  h=$(LC_ALL=C /usr/bin/sha256sum < "$d" 2>/dev/null); [[ $h =~ ^([0-9a-f]{64})\ \ -$ ]] || { SO_REASON="$d cannot be hashed (not root and not in afldb-backup-read?)"; return 1; }
  [ "${BASH_REMATCH[1]}" = "${F[dump_sha256]}" ] || { SO_REASON="$d re-hashes to ${BASH_REMATCH[1]:0:16}..., the seal binds ${F[dump_sha256]:0:16}..."; return 1; }
  sz=$(LC_ALL=C /usr/bin/stat -c %s -- "$d.sha256" 2>/dev/null); side=; IFS= read -r side < "$d.sha256" 2>/dev/null
  [ "$side" = "${F[dump_sha256]}  ${F[dump]}" ] && [ "$sz" = $(( ${#side} + 1 )) ] || { SO_REASON="$d.sha256 is not exactly '<dump_sha256>  ${F[dump]}'"; return 1; }
  # rule 6 (F4): the completion record, written last by the sealer
  dn=$SD/${F[invocation]}.done
  so__tp "$dn" seal root root 644 || { SO_REASON="seal $f has no valid completion record (the run did not finish after its seal): $SO__TPW"; return 1; }
  mapfile -t DL 2>/dev/null < "$dn" || { SO_REASON="$dn cannot be read"; return 1; }
  dl=$(printf '%s\n' "${DL[@]}"); sz=$(LC_ALL=C /usr/bin/stat -c %s -- "$dn" 2>/dev/null)
  [ "${#DL[@]}" = 5 ] && [ "${DL[0]}" = afldb-backup-done/1 ] && [ "${DL[1]}" = "invocation=${F[invocation]}" ] && [ "${DL[2]}" = "dump=${F[dump]}" ] \
    && [ "${DL[3]}" = "dump_sha256=${F[dump_sha256]}" ] && [[ ${DL[4]} =~ ^completed_realtime_usec=([1-9][0-9]{15,17})$ ]] \
    && (( BASH_REMATCH[1] >= F[sealed_realtime_usec] )) && [ "$sz" = $(( ${#dl} + 1 )) ] \
    || { SO_REASON="$dn is not the exact completion record of seal $f"; return 1; }
  d=$((tm - ta)); if (( d >= 0 )); then d="$((d / 1000000)).$((d % 1000000 / 100000))"; else d="-$((-d / 1000000)).$((-d % 1000000 / 100000))"; fi
  SO_INVOCATION=${F[invocation]}; SO_DUMP=${F[dump]}; SO_SHA=${F[dump_sha256]}; SO_BYTES=${F[dump_bytes]}; SO_DISPATCH_KIND=$kind
  SO_DISPATCH_DELAY_S=$d; SO_TIMER_USEC=$cu; SO_SEAL=$f
  printf '  sealed-origin: seal %s: invocation %s, job %s created by afldb-backup.timer at %s us (%s), dispatch=%s %s s after timer activation, dump %s %s bytes sha256 %s\n' \
    "$f" "$SO_INVOCATION" "${F[job]}" "$cu" "$(TZ=Australia/Melbourne LC_ALL=C /usr/bin/date -d "@$((cu / 1000000))" '+%F %T %Z' 2>/dev/null)" "$kind" "$d" "$SO_DUMP" "$SO_BYTES" "$SO_SHA"
  return 0
}
