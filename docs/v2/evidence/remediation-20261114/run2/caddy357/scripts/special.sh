#!/usr/bin/env bash
# caddy357: hook run by matrix.sh while Caddy is up (CADDY_PORT, R exported). Request-target forms that the
# Node client cannot send, other Host names, and the log-redaction sentinels for DENIED requests.
P=${CADDY_PORT:-55653}
call() { # label, curl args...
  local label=$1; shift
  printf '%-44s ' "$label"
  curl -s -o "$R/hook.body" -D "$R/hook.head" -w 'http=%{http_code}' --max-time 10 "$@"
  printf '  body=%s\n' "$(head -c 60 "$R/hook.body" | tr '\n' ' ')"
}
H="Host: beta.afldb.com"
echo "## absolute-form request target (RFC 9112 3.2.2) and HTTP/1.0"
call "abs-form canonical /seasons/2024 (pass)"      -H "$H" --request-target "http://beta.afldb.com:$P/seasons/2024" "http://127.0.0.1:$P"
call "abs-form /seasons/02024 (deny)"                -H "$H" --request-target "http://beta.afldb.com:$P/seasons/02024" "http://127.0.0.1:$P"
call "abs-form /seasons/%32024 (deny)"               -H "$H" --request-target "http://beta.afldb.com:$P/seasons/%32024" "http://127.0.0.1:$P"
call "abs-form //seasons/2024 (deny)"                -H "$H" --request-target "http://beta.afldb.com:$P//seasons/2024" "http://127.0.0.1:$P"
call "abs-form /players/x-1?q=1 (pass)"              -H "$H" --request-target "http://beta.afldb.com:$P/players/x-1?q=1" "http://127.0.0.1:$P"
call "HTTP/1.0 /seasons/02024 (deny)"                --http1.0 -H "$H" --path-as-is "http://127.0.0.1:$P/seasons/02024"
call "HTTP/1.0 /seasons/2024 (pass)"                 --http1.0 -H "$H" --path-as-is "http://127.0.0.1:$P/seasons/2024"
call "h2c prior knowledge /seasons/02024 (deny)"     --http2-prior-knowledge -H "$H" --path-as-is "http://127.0.0.1:$P/seasons/02024"
call "h2c prior knowledge /seasons/2024 (pass)"      --http2-prior-knowledge -H "$H" --path-as-is "http://127.0.0.1:$P/seasons/2024"
call "h2c prior knowledge /seasons/%32024 (deny)"    --http2-prior-knowledge -H "$H" --path-as-is "http://127.0.0.1:$P/seasons/%32024"
echo "## the apex host (static, never proxies to the app): the rules are not applied there"
call "apex /seasons/02024 (static 404)"              -H "Host: afldb.com" --path-as-is "http://127.0.0.1:$P/seasons/02024"
echo "## rewrite headers must not change the verdict"
call "X-Original-URL junk, canonical path (pass)"    -H "$H" -H "X-Original-URL: /seasons/02024" -H "X-Rewrite-URL: /seasons/02024" --path-as-is "http://127.0.0.1:$P/seasons/2024"
call "X-Original-URL canonical, junk path (deny)"    -H "$H" -H "X-Original-URL: /seasons/2024" --path-as-is "http://127.0.0.1:$P/seasons/02024"
echo "## log redaction for DENIED requests (sentinels are fake)"
call "denied, query token"                           -H "$H" --path-as-is "http://127.0.0.1:$P/seasons/02024?token=PROBE-DENY-TOKEN-ddd444"
call "denied, secret in path and query"              -H "$H" --path-as-is "http://127.0.0.1:$P/players/PROBE-PATHSECRET-eee555?q=PROBE-QUERY-fff666"
call "denied, Referer carries an invite token"       -H "$H" -H "Referer: https://beta.afldb.com/admin/invite/PROBE-INVITE-bbb222?x=PROBE-REFQ-hhh888" --path-as-is "http://127.0.0.1:$P/matches/0123"
call "denied, Cookie header"                         -H "$H" -H "Cookie: afldb_beta=PROBE-COOKIE-iii999" --path-as-is "http://127.0.0.1:$P/clubs/CARLTON"
call "denied, long path"                             -H "$H" --path-as-is "http://127.0.0.1:$P/$(head -c 600 /dev/zero | tr '\0' a)?t=PROBE-LONG-jjj000"
call "malformed escape (Go 400) with token"          -H "$H" --path-as-is "http://127.0.0.1:$P/seasons/%zz?token=PROBE-BAD-kkk111"
call "passed: invite path"                           -H "$H" --path-as-is "http://127.0.0.1:$P/admin/invite/PROBE-INVITE-bbb222"
call "passed: magic link"                            -H "$H" --path-as-is "http://127.0.0.1:$P/beta/verify?token=PROBE-MAGIC-aaa111"
call "passed: search text"                           -H "$H" --path-as-is "http://127.0.0.1:$P/search?q=PROBE-SEARCH-ccc333"
