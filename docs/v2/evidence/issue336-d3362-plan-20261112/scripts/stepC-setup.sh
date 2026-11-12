set -u
S=/mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand/tools/v2/gap029-ops
git -C /mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand show a25306f930015acef602bcc60d76613bdcc3d466:tools/v2/gap029-ops/restore-workspace-setup.sh 2>/dev/null | cmp -s - $S/restore-workspace-setup.sh && echo SETUP_SCRIPT_IDENTICAL_AT_NEW_PIN || echo "setup script compare unavailable or differs"
ss -ltn | awk '{print $4}' | grep -E ':5549[34]$' && echo PORT_BUSY || echo ports_free
W=/mnt/ssd/afldb-i336-prod-20261112T025043Z TAR=/mnt/ssd/afldb-i349-20261112/green-pack/pack-a25306f9/cand.tar.gz TAR_SHA256=48f43dc840a6f97e0b24b588ff50cd04463521eb6377c94f1a3527780d353685 R=a25306f930015acef602bcc60d76613bdcc3d466 SRC_CAND=/mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand bash $S/restore-workspace-setup.sh; echo SETUP-EXIT=$?
