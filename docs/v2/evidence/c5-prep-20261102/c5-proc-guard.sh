# c5-proc-guard.sh -- sourced by c5-observe-r3.sh. READ-ONLY. Process-table logic only; it starts and stops nothing.
#
# c5_conflicting_writers SELF_PID  < table
#   table = `ps -eo pid=,ppid=,comm=,args=` (pid ppid comm args...), one process per line.
#   Prints every table line whose ARGUMENTS name an AFL API settle or acquire tool (settle-afl-api, acquire-afl-api,
#   which also covers the -brownlow and -fixtures variants), EXCEPT this helper's own transport: SELF_PID and its
#   unbroken chain of ANCESTORS whose command is a shell / ssh / sudo / session wrapper. An ancestor stops being
#   excluded at the first process that is not such a wrapper, so a writer that launched the helper is still reported.
#   Every non-ancestor match counts: a sibling, a child, a systemd-started wrapper, or a writer started by the same
#   operator command. The exclusion exists because `ssh host 'systemctl show afldb-settle-afl-api.timer; bash helper'`
#   leaves a `bash -c '<that text>'` ancestor whose own argv contains the unit name (observed 2026-11-02 10:24:17Z).
#   Forks of the helper itself (same argv, descendants of SELF_PID: pipeline and command-substitution subshells) are
#   excluded too, because they carry the helper's own argv. A process with ANY different argv is never excluded this way.
#   The pattern is assembled from fragments so this awk process's own argv never contains it.
c5_conflicting_writers() {
  awk -v self="$1" -v a=settle -v b=acquire -v c=-afl-api '
    BEGIN { pat = "(" a c "|" b c ")" }
    { pid = $1; par[pid] = $2; comm[pid] = $3; ln[NR] = $0; id[NR] = pid; n = NR
      a4 = $0; sub(/^[ 	]*[0-9]+[ 	]+[0-9]+[ 	]+[^ 	]+[ 	]*/, "", a4); args[pid] = a4 }
    function isdesc(p, anc,   k) { for (k = 0; k < 64 && p != "" && p + 0 > 1; k++) { p = par[p]; if (p == anc) return 1 } return 0 }
    END {
      skip[self] = 1
      for (p = par[self]; p != "" && p + 0 > 1; p = par[p]) {
        if (comm[p] ~ /^(bash|sh|dash|zsh|sshd|sshd-session|ssh|sudo|su|env|timeout|script|tmux|screen)$/) skip[p] = 1; else break
      }
      for (i = 1; i <= n; i++) {
        if (skip[id[i]]) continue
        # forks of the helper itself (command-substitution / pipeline subshells): same argv, descendant of SELF_PID
        if (args[id[i]] == args[self] && isdesc(id[i], self)) continue
        l = ln[i]; sub(/^[ \t]*[0-9]+[ \t]+[0-9]+[ \t]+[^ \t]+[ \t]*/, "", l)
        if (l ~ pat) print ln[i]
      }
    }'
}
