set -u
W=/mnt/ssd/afldb-i336-prod-20261112T025043Z; RUN=I336-20261112T025001Z; R=a25306f930015acef602bcc60d76613bdcc3d466
cd $W/in/$RUN/capture && sha256sum -c --quiet SHA256SUMS && echo CAPTURE_SUMS_OK || { echo STOP_SUMS; exit 9; }
W=$W R=$R STAGE=I336 CAPDIR=$W/in/$RUN/capture PROD_TARGET=$W/in/$RUN/target.json TAG=i336_20261112_025001 bash $W/cand/tools/v2/gap029-ops/restore-assemble-host.sh; echo ASSEMBLE-EXIT=$?
ss -ltn | awk '{print $4}' | grep -E ':55493$' && echo PORT_STILL_LISTENING || echo port_55493_closed
