#!/usr/bin/env bash
. /mnt/ssd/afldb-rem3-rebuild-20261114/env.sh
ATTEMPT=${1:-1}
rm -f $W/evidence/rebuild.exit$ATTEMPT
setsid nohup bash $W/rebuild-inner.sh $ATTEMPT > $W/evidence/rebuild$( [ "$ATTEMPT" = 1 ] && echo "" || echo "-$ATTEMPT" ).out 2>&1 < /dev/null &
echo $! > $W/evidence/rebuild.pid$ATTEMPT
echo "launched pid=$(cat $W/evidence/rebuild.pid$ATTEMPT)"
