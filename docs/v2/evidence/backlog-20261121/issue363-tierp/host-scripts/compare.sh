#!/usr/bin/env bash
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-backlog-20261122b-363; E=$W/ev
echo "-- tables differing: tier S template -> p1 (raw fp.sql, no exclusions)"
diff <(grep -v max_id= $E/fp-S-before.txt) <(grep -v max_id= $E/p1/fp-raw.txt) | grep '^>' | cut -d= -f1 | sed 's/^> //'
echo "-- tables differing: 21 Nov prototype rbbovr -> p1 (raw)"
P=/mnt/ssd/afldb-i363-20261121/ev/ov_rookie/fp-rbbovr.txt
[ -r "$P" ] && diff <(grep -v max_id= $P) <(grep -v max_id= $E/p1/fp-raw.txt) | grep '^>' | cut -d= -f1 | sed 's/^> //'
echo "-- rekeyed entries vs prototype (canonical JSON)"
PE=/mnt/ssd/afldb-i363-20261121/ev/ov_rbb/evidence-rekeyed.json
node -e '
const fs=require("fs"),c=require("crypto");
const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),b=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const h=(x)=>c.createHash("sha256").update(JSON.stringify(x)).digest("hex");
console.log("entries equal:",h(a.entries)===h(b.entries),"count",a.entries.length,b.entries.length,"counts equal:",h(a.counts)===h(b.counts));
console.log("entries sha256 (JSON.stringify)",h(a.entries));
' $E/p1/out/evidence-rekeyed.json $PE
