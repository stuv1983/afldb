{
set -u
L=/home/arm/afldb-issue330-D2-build.log
[ -e "$L" ] && { echo "D2 STOP log $L exists"; exit 1; }
tmux has-session -t i330 2>/dev/null && { echo "D2 STOP tmux session i330 exists"; exit 1; }
cat > /home/arm/afldb-issue330-D2-build.sh <<'EOS'
#!/bin/bash
cd /home/arm/projects/afldb || exit 1
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
L=/home/arm/afldb-issue330-D2-build.log
echo "D2 start $(date -u +%FT%TZ) HEAD $(git rev-parse HEAD) node $($N -v)" > "$L"
"$N" deploy/release.mjs build --checkout /home/arm/projects/afldb --revision ad245d602f6f0776c1fd86b66fef4f177fe63276 \
  --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
  --typecheck-evidence "npm run typecheck exit 0 (next typegen && tsc --noEmit) on Linux (WSL Ubuntu 24.04.5, node v22.21.0) for git archive of ad245d60 (tree 89bd5b80); 2026-10-31; issues/open/AFLDB-ISSUE-330-evidence/typecheck.log" \
  >> "$L" 2>&1
echo "D2 EXIT $? at $(date -u +%FT%TZ)" >> "$L"
EOS
tmux new-session -d -s i330 "bash /home/arm/afldb-issue330-D2-build.sh"
sleep 3
echo "launched at $(date -u +%FT%TZ)"; tmux ls; cat "$L"
}
