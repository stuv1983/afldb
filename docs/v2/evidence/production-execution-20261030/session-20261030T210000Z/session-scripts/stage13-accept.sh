{
# Stage 12/13 acceptance (read-only HTTP checks; the one POST is the email-intake 410 check the package names).
set -u
W=QNEHXAtU53TzUjj0Mb7mv; B=https://beta.afldb.com; L=http://127.0.0.1:3100; T=$(mktemp -d)
echo "== service $(date -u +%T)"; systemctl show -p ActiveState,SubState,NRestarts,MainPID,ActiveEnterTimestamp afldb | tr '\n' ' '; echo
echo "== health"
for base in "$L" "$B"; do
  curl -s -D "$T/h" -o "$T/b" "$base/api/health"; echo "$base/api/health $(head -1 "$T/h" | tr -d '\r') build=$(grep -i '^x-afldb-build:' "$T/h" | cut -d' ' -f2 | tr -d '\r') body=$(cat "$T/b")"
done
echo "== pages (follow redirects) and every referenced CSS/JS asset"
for u in / /beta /players /matches /seasons /clubs /records /search /admin/operations; do
  curl -s -L -D "$T/h" -o "$T/p.html" -w "%{http_code} %{url_effective} %{size_download}" "$B$u" > "$T/r"
  echo "page $u -> $(cat "$T/r") build=$(grep -i '^x-afldb-build:' "$T/h" | tail -1 | cut -d' ' -f2 | tr -d '\r')"
  grep -oE '/_next/static/[^"?]+\.(js|css)' "$T/p.html" >> "$T/assets"
done
sort -u "$T/assets" > "$T/a"; echo "distinct assets referenced: $(wc -l < "$T/a")"
bad=0
while read -r s; do
  r=$(curl -s -o "$T/x" -w '%{http_code} %{content_type}' "$B$s"); sz=$(stat -c %s "$T/x")
  case "$s" in *.css) want=text/css;; *.js) want=javascript;; esac
  if [ "${r%% *}" != 200 ] || ! printf '%s' "$r" | grep -q "$want" || [ "$sz" -lt 100 ]; then bad=$((bad+1)); echo "ASSET BAD $r size=$sz $s"; fi
done < "$T/a"
echo "assets checked=$(wc -l < "$T/a") bad=$bad"
s1=$(head -1 "$T/a"); curl -s -D - -o /dev/null "$B$s1" | grep -iE '^(HTTP|content-type|cache-control)' | tr -d '\r'
echo "== email intake retired"; curl -s -o /dev/null -w "POST /api/admin/email-intake %{http_code}\n" -X POST "$B/api/admin/email-intake"
echo "== journal since start (errors)"; journalctl -u afldb --since '2026-10-31 09:41:00' --no-pager 2>/dev/null | grep -ciE 'error|fatal|unhandled' | sed 's/^/error_lines=/'
rm -rf "$T"
cat > /dev/null
}
