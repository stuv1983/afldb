#!/usr/bin/env bash
# caddy357 (review LOW-7): every raw-target spelling that carries an invite token, passed or denied, must be logged
# without the token. The token is the fake sentinel PROBE-INVITE-bbb222 (scanned by matrix.sh in every log).
# Run as a matrix HOOK (CADDY_PORT and R exported). Prints the logged uri of each probe afterwards.
P=${CADDY_PORT:-55653}
H="Host: beta.afldb.com"
T=PROBE-INVITE-bbb222
n=0
probe() { # label, raw request path (sent as-is)
  n=$((n+1)); local label=$1 path=$2
  printf '%-46s ' "$label"
  curl -s -o /dev/null -w 'http=%{http_code}\n' --max-time 10 -H "$H" --path-as-is "http://127.0.0.1:$P$path"
}
echo "## invite-token spellings, one request each (token = $T)"
probe "canonical"                         "/admin/invite/$T"
probe "canonical + query"                 "/admin/invite/$T?x=1"
probe "leading //"                        "//admin/invite/$T"
probe "leading ///"                       "///admin/invite/$T"
probe "dot segment first"                 "/./admin/invite/$T"
probe "dot segment inside"                "/admin/./invite/$T"
probe "dotdot"                            "/x/../admin/invite/$T"
probe "encoded slash prefix"              "/%2Fadmin/invite/$T"
probe "encoded slashes in the path"       "/admin%2Finvite%2F$T"
probe "encoded slash before token"        "/admin/invite%2F$T"
probe "encoded first segment"             "/%61dmin/invite/$T"
probe "encoded invite (lower hex)"        "/admin/%69nvite/$T"
probe "encoded invite (upper letter)"     "/admin/%49nvite/$T"
probe "all of invite encoded"             "/admin/%69%6e%76%69%74%65/$T"
probe "upper case"                        "/Admin/Invite/$T"
probe "double slash before token"         "/admin/invite//$T"
probe "dot segment before token"          "/admin/invite/./$T"
probe "dotdot before token"               "/admin/invite/../invite/$T"
probe "extra segment after token"         "/admin/invite/$T/extra"
probe "encoded backslash"                 "/admin/invite%5C$T"
probe "backslash"                         "/admin\\invite\\$T"
probe "token then malformed escape (400)" "/admin/invite/$T%zz"
probe "token in a query, canonical path"  "/search?next=/admin/invite/$T"
probe "list page (must stay readable)"    "/admin/invites"
probe "words that only contain invite"    "/admin/uninvited/x"
curl -s -o /dev/null -w 'absolute-form //admin/invite/T                  http=%{http_code}\n' --max-time 10 -H "$H" --request-target "http://beta.afldb.com:$P//admin/invite/$T" "http://127.0.0.1:$P"
curl -s -o /dev/null -w 'absolute-form /./admin/invite/T                 http=%{http_code}\n' --max-time 10 -H "$H" --request-target "http://beta.afldb.com:$P/./admin/invite/$T" "http://127.0.0.1:$P"
sleep 1
echo "## logged uri of each probe, in order (the token must not appear in any)"
grep -o '"uri":"[^"]*"' "$R/logs/afldb-access.log" | tail -30
echo "## token occurrences in the access log: $(grep -c -- "$T" "$R/logs/afldb-access.log")  in stderr: $(grep -c -- "$T" "$R/caddy-stderr.log")"
