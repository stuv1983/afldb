#!/usr/bin/env bash
# p4-run.sh (R6 r9, 28 Nov 2026): REHEARSAL of afldb-phase4.sh from the WORKSTATION (Git Bash). REHEARSAL ONLY: disposable containers
# on streamanator, never production (209.38.87.252 / alias afldb is never contacted). Two ssh connections, spaced: one runs every
# scenario (p4-host.sh), the second proves the residue independently. The owner-checks script travels too, only so that each
# scenario can compare entry's matches with owner-checks B3 (and show B1/B2/B3/B5 before and after).
# Usage: bash p4-run.sh <RID>. Writes evidence/<RID>-run.txt and evidence/<RID>-summary.txt (.txt: *.log and logs/ are git-ignored).
set -uo pipefail; export LC_ALL=C
RID=${1:?rid}; [[ $RID =~ ^[A-Za-z0-9-]{1,24}$ ]] || { echo "STOP bad RID"; exit 2; }
WT=/d/dev/afldb-closeout-20261127
R8=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r8-20261128
R9=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128
P=$WT/$R9/phase4; EV=$P/evidence; mkdir -p "$EV"
RUN=$EV/$RID-run.txt; SUM=$EV/$RID-summary.txt; : > "$RUN"; : > "$SUM"
DEVSSH=(ssh -o BatchMode=yes -i "$HOME/.ssh/afldb_dev" arm@10.0.40.100)
SCEN=(group-only group-only-backout refuse-90-arm refuse-user-alias refuse-group-adm refuse-admin-group refuse-include
      refuse-dispose-nomatch disposed disposed-removed residual-uid residual-all refuse-uid-alias refuse-continued refuse-negated
      refuse-nsswitch late-grant old-r8-backout unplanned-edit state-tamper)
FILES=("$R9/phase4/afldb-phase4.sh" "$R9/phase4/p4-scen.sh" "$R9/phase4/p4-host.sh" "$R9/phase4/p4-ed-remove-arm.sh" "$R8/owner-checks/afldb-owner-checks.sh")
say() { printf '%s\n' "$*" | tee -a "$SUM" >> "$RUN"; printf '%s\n' "$*"; }
for f in "${FILES[@]}" "$R9/phase4/p4-run.sh"; do grep -q $'\r' "$WT/$f" && { echo "STOP $f contains CR bytes"; exit 2; }; done
KD=$(mktemp -d); trap 'rm -rf "$KD"' EXIT; mkdir "$KD/fix"
for f in "${FILES[@]}"; do cp "$WT/$f" "$KD/fix/"; done
{ echo "== p4-run $RID $(date -u +%FT%TZ) workstation $(hostname); worktree HEAD $(git -C "$WT" rev-parse HEAD)"
  echo "[TRANSPORT] WORKTREE bytes (development evidence, not a committed revision):"
  for f in "${FILES[@]}"; do echo "   $(sha256sum < "$WT/$f" | cut -c1-64)  $f"; done
  echo "[PIN] $(cd "$P" && sha256sum -c --strict SHA256SUMS 2>&1 | tr '\n' ' ')"; } | tee -a "$RUN"
tar -C "$KD/fix" -cf - . | "${DEVSSH[@]}" "W=\$(mktemp -d -p \"\$HOME\" r9p4-ws.XXXXXX) && mkdir -m 700 \"\$W/fix\" && tar -C \"\$W/fix\" -xf - && exec bash \"\$W/fix/p4-host.sh\" \"\$W\" '$RID' ${SCEN[*]}" >> "$RUN" 2>&1
echo "== ssh 1 exit $?" >> "$RUN"
sleep 6   # the owner's home firewall IPS blocks bursts of SSH connections: keep them few and spaced
"${DEVSSH[@]}" "echo R9P4 RESIDUE-CHECK \$(date -u +%FT%TZ) containers-this-run=\$(docker ps -aq --filter label=r9p4.run=$RID | wc -l) containers-any-r9p4=\$(docker ps -aq --filter label=r9p4.run | wc -l) images-any-r9p4=\$(docker images -q --filter label=r9p4.run | wc -l) workspaces=\$(ls -d \$HOME/r9p4-ws.* 2>/dev/null | wc -l)" >> "$RUN" 2>&1
grep -E '^(SCENARIO|R9P4 RESIDUE)' "$RUN" | tee -a "$SUM"
np=$(grep -c '^SCENARIO .* PASS ' "$RUN"); nf=$(grep -c '^SCENARIO .* FAIL ' "$RUN")
res0=$(grep -c '^R9P4 RESIDUE containers=0 images=0 workspace=removed r9p4-workspaces=0 ' "$RUN")
res1=$(grep -c '^R9P4 RESIDUE-CHECK .* containers-this-run=0 containers-any-r9p4=0 images-any-r9p4=0 workspaces=0$' "$RUN")
sec=$(grep -ciE 'PRIVATE KEY|postgres(ql)?://|password=|\$[0-9y]\$[^ ]{8,}' "$RUN")
say "secret scan of $RID-run.txt: $sec match(es) for private key blocks, DSNs, password= assignments or crypt hashes"
if [ "$np" = ${#SCEN[@]} ] && [ "$nf" = 0 ] && [ "$res0" = 1 ] && [ "$res1" = 1 ] && [ "$sec" = 0 ]; then say "R9 PHASE4 HARNESS RESULT PASS ($np of ${#SCEN[@]} scenarios; residue 0 containers, 0 images, 0 workspaces)"
else say "R9 PHASE4 HARNESS RESULT FAIL (pass=$np fail=$nf of ${#SCEN[@]}; residue lines $res0/$res1; secret matches $sec)"; fi
