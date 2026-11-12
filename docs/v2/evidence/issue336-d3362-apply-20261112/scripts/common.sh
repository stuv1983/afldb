set -u
R=a25306f930015acef602bcc60d76613bdcc3d466; RUN=I336-20261112T025001Z; OPS=/home/arm/ops/gap029-stages/a25306f9
P=$OPS/cand/tools/v2/gap029-ops/prod-stage.sh; RD=$OPS/runs/$RUN
PD=afa26158781c0538166302be05d440a79af9ab805f8143f218c5cf804e90f608
NB=2026-11-12T05:00:00Z; EXP=2026-11-12T06:30:00Z
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
now=$(date -u +%s); [ "$now" -ge "$(date -u -d $NB +%s)" ] && [ "$now" -lt "$(date -u -d $EXP +%s)" ] || { echo "STOP outside the approved window (now $(date -u +%FT%TZ))"; exit 90; }
echo "in window: $(date -u +%FT%TZ)"
