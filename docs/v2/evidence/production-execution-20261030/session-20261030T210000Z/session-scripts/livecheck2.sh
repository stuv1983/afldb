{
# Read-only: do pages and their static assets still serve from the running process?
B=https://beta.afldb.com
for u in / /players /matches; do
  curl -s -L -o /tmp/afldb-lc.html -w "$u final=%{url_effective} http=%{http_code} bytes=%{size_download}\n" "$B$u"
done
a=$(grep -oE '/_next/static/[^"]+\.(js|css)' /tmp/afldb-lc.html | head -4)
for s in $a; do curl -s -o /dev/null -w "asset %{http_code} $s\n" "$B$s"; done
rm -f /tmp/afldb-lc.html
ls -la /home/arm/projects/afldb/.next/static 2>&1 | head -3
find /home/arm -maxdepth 4 -name BUILD_ID -path '*standalone*' 2>/dev/null | head
cat > /dev/null
}
