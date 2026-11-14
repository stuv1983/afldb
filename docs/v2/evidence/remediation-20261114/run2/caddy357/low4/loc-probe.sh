#!/usr/bin/env bash
# REVIEW-D LOW-4 probe: does a redirect's Location header carry the invite token into the access log? red (before) / green (after).
# Real Next production build of the caddy357 workspace (open mode) behind Caddy 2.11.4 and 2.11.9, admin off, local ports only.
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
P=/mnt/ssd/afldb-rem2-int-20261114/loc-probe; mkdir -p $P
OUT=$P/result.txt; : > $OUT
IR start > $P/pg-start.out 2>&1 < /dev/null; sleep 3
bash $W/serve.sh start open | tee -a $OUT
TOK=LOCPROBE7c1dTOKEN0123456789abcdef
for BIN in $W/caddy-bin/caddy-2.11.4 $W/caddy-bin/caddy-system; do
 for V in before after; do
  for CFN in production dev; do
   CF=$P/Caddyfile.$CFN.$V; [ $CFN = production ] && CF=$P/Caddyfile.production.$V
   LABEL=loc-$CFN-$V-$(basename $BIN)
   bash $W/in/caddyapp.sh start "$BIN" "$CF" "$LABEL" > $P/$LABEL.start 2>&1 || { echo "$LABEL start failed"; cat $P/$LABEL.start; continue; }
   HOST=beta.afldb.com
   for path in "/admin/invite/$TOK/" "/admin/invite/$TOK/?x=1" "/Admin/invite/$TOK/" "/beta/verify/?token=$TOK" "/admin/invite/$TOK"; do
     curl -s -o /dev/null -D $P/hdr.txt -H "Host: $HOST" "http://127.0.0.1:$CADDY_PORT$path"
     st=$(head -1 $P/hdr.txt | tr -d '\r'); loc=$(grep -i '^location:' $P/hdr.txt | tr -d '\r' | sed "s/$TOK/<TOK>/g")
     echo "$LABEL $path -> $st $loc" | sed "s/$TOK/<TOK>/g" >> $OUT
   done
   sleep 1
   R=$W/caddyapp/$LABEL
   n=$(cat $R/logs/*.log 2>/dev/null | grep -c "$TOK")
   lines=$(cat $R/logs/*.log 2>/dev/null | wc -l)
   locl=$(cat $R/logs/*.log 2>/dev/null | grep -o '"Location":\[[^]]*\]' | sed "s/$TOK/<TOK>/g" | sort | uniq -c | tr '\n' ' ')
   echo "$LABEL log lines=$lines lines-with-token=$n logged-Location: $locl" >> $OUT
   bash $W/in/caddyapp.sh stop > /dev/null 2>&1
  done
 done
done
bash $W/serve.sh stop | tee -a $OUT
IR stop >> $P/pg-start.out 2>&1
echo "listeners left: $(ss -ltnH | awk '{print $4}' | grep -cE ':(55653|55663|55673)$')" >> $OUT
cat $OUT
