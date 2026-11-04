:
{
B=/home/arm/afldb-releases/current/.next/standalone/.next/server/app
for f in coaches.html clubs/port-adelaide.html clubs/carlton.html; do stat -c '%n mtime=%y size=%s' $B/$f | sed "s#$B/##"; done
echo "-- port-adelaide.html coach-table rows mentioning Josh Carr (text only)"
python3 - <<'PY'
import re,html
B="/home/arm/afldb-releases/current/.next/standalone/.next/server/app/"
for f,name in (("clubs/port-adelaide.html","Josh Carr"),("clubs/carlton.html","Josh Fraser")):
    s=open(B+f,encoding="utf-8").read()
    for r in re.findall(r"<tr[\s\S]*?</tr>",s):
        if name in r:
            cells=[re.sub(r"\s+"," ",html.unescape(re.sub(r"<[^>]+>"," ",c))).strip() for c in re.findall(r"<t[dh][\s\S]*?</t[dh]>",r)]
            print(f,cells)
PY
}
