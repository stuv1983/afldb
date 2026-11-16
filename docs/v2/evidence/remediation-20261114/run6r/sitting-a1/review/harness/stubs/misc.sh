#!/usr/bin/env bash
# Generates the remaining small stubs into $1 (bin dir).
B=$1
cat > "$B/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "$HT/calls.log"
case "$1" in
  is-active) v="STUB_ACTIVE_${2//[-.@]/_}"; echo "${!v:-inactive}"; [ "${!v:-inactive}" = active ] && exit 0 || exit 3;;
  show) [[ " $* " == *" --value "* || " $* " == *" --value" ]] && { echo stub; exit 0; }; echo "ActiveState=active"; echo "SubState=running"; echo "NRestarts=0"; echo "InvocationID=stub"; echo "ActiveEnterTimestamp=Wed 2026-11-18 00:10:00 UTC";;
  list-timers) echo "stub timers";;
esac
exit 0
EOF
cat > "$B/ss" <<'EOF'
#!/usr/bin/env bash
echo "State Recv-Q Send-Q Local Address:Port"; [ -n "${STUB_SS_LINE:-}" ] && echo "$STUB_SS_LINE"; exit 0
EOF
cat > "$B/pgrep" <<'EOF'
#!/usr/bin/env bash
[ -n "${STUB_PGREP:-}" ] && { echo "$STUB_PGREP"; exit 0; }; exit 1
EOF
cat > "$B/tmux" <<'EOF'
#!/usr/bin/env bash
echo "tmux $*" >> "$HT/calls.log"
case "$1" in
  has-session) [ "${STUB_TMUX_EXISTS:-0}" = 1 ] && exit 0 || exit 1;;
  new-session) shift; while [ "$1" = -d ] || [ "$1" = -s ]; do [ "$1" = -s ] && shift; shift; done; ( bash -c "$1" ) & exit 0;;
  ls) echo "no server running"; exit 1;;
esac
EOF
cat > "$B/backup.sh" <<'EOF'
#!/usr/bin/env bash
echo "backup.sh $*" >> "$HT/calls.log"
while [ $# -gt 0 ]; do case "$1" in --dir) DIR=$2; shift 2;; --keep) KEEP=$2; shift 2;; *) exit 2;; esac; done
[ "${STUB_BACKUP_RC:-0}" = 0 ] || exit "$STUB_BACKUP_RC"
mkdir -p "$DIR"; head -c 4096 /dev/zero > "$DIR/afldb_prod-20261118-001500.dump"; echo "==> Done (stub) keep=$KEEP"
EOF
cat > "$B/post-install-check.sh" <<'EOF'
#!/usr/bin/env bash
echo "post-install-check $*" >> "$HT/calls.log"; echo "post-install-check stub $*"; exit "${STUB_PIC_RC:-0}"
EOF
cat > "$B/verify-stub.sh" <<'EOF'
#!/usr/bin/env bash
echo "verify-stub PORT=$PORT argv=$*" >> "$HT/calls.log"
echo "verify stub running"; [ -n "${STUB_VERIFY_LINE:-}" ] && echo "$STUB_VERIFY_LINE"; exit "${STUB_VERIFY_RC:-0}"
EOF
chmod +x "$B"/*
