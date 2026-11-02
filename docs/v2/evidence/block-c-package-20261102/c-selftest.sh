#!/bin/bash
# Self-test of c-prod.sh with a SYNTHETIC systemctl, synthetic database answers and synthetic C4b records, against a clean candidate checkout at R.
# It exercises the real script logic (a transformed COPY whose only differences are the host check, the paths and four stubbed database/identity readers; the diff is printed).
# Usage: CAND=<clean checkout at R with node_modules> R=<40-hex> bash c-selftest.sh      -> "C SELFTEST PASS" or the failing case
set -u
: "${CAND:?}" "${R:?}"
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
mkdir -p "$T/st" "$T/bin" "$T/etc" "$T/c4b"
# stubs: database readers
cat > "$T/overrides.sh" <<'EOS'
backup_identity() { echo "identity ok (stub)"; }
ledger_118() { echo "ledger 118 (stub)"; }
setting_raw() { cat "$STUBDIR/setting"; }
EOS
cat > "$T/bin/systemctl" <<'EOS'
#!/bin/bash
# synthetic systemctl: state files $STUBDIR/st/<unit>.{load,active,enabled}; absent file = not-found / inactive / not-found
d="$STUBDIR/st"
case "$1" in
  show) unit="${@: -1}"; case "$3" in LoadState) f="$d/$unit.load"; [ -f "$f" ] && cat "$f" || echo not-found;; ActiveState) f="$d/$unit.active"; [ -f "$f" ] && cat "$f" || echo inactive;; esac ;;
  is-enabled) f="$d/$2.enabled"; if [ -f "$f" ]; then cat "$f"; [ "$(cat "$f")" = enabled ] || exit 1; else echo not-found; exit 1; fi ;;
esac
EOS
chmod +x "$T/bin/systemctl"
sed -e 's#^\[ "$(hostname)" = afldb-prod \] && \[ "$(id -un)" = arm \]#[ "$(hostname)" = "$(hostname)" ] \&\& [ "$(id -un)" = "$(id -un)" ]#' \
    -e "s#^CHK=.*#CHK=$CAND#" -e "s#/etc/systemd/system#$T/etc#g" -e "s#^NODE=.*#NODE=$(command -v node)#" \
    -e 's#^FEED_SHA=.*#FEED_SHA=21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d#' \
    -e "/^case \"\$PHASE\" in/i . $T/overrides.sh" \
    "$HERE/c-prod.sh" > "$T/c-prod.test.sh"
diff "$HERE/c-prod.sh" "$T/c-prod.test.sh" | grep -c '^[<>]' | sed 's/^/transform diff lines: /'
export STUBDIR="$T" PATH="$T/bin:$PATH"
FEED="$CAND/tests/fixtures/afl_api/seasons/01-season-matches-2027.raw.json"
# the trigger tests edit the candidate's .env (git-excluded); an existing one is saved and restored
ENV_EXISTED=0; [ -f "$CAND/.env" ] && ENV_EXISTED=1
grep -qx ".env" "$CAND/.git/info/exclude" 2>/dev/null || echo ".env" >> "$CAND/.git/info/exclude"
[ "$ENV_EXISTED" = 1 ] || : > "$CAND/.env"
bad=0
run() { bash "$T/c-prod.test.sh" "$@" > "$T/out.txt" 2>&1; }
ok()  { run "$@" && grep -q PASS "$T/out.txt" || { echo "FAIL (expected pass): $*"; tail -4 "$T/out.txt"; bad=1; }; }
no()  { local n=$1; shift; if run "$@"; then echo "FAIL $n: accepted"; tail -3 "$T/out.txt"; bad=1; else echo "  ok refused: $n -> $(grep -m1 STOP "$T/out.txt")"; fi; }
reset() { rm -f "$T"/st/* "$T"/etc/*; echo "" > "$T/setting"; for u in afldb-settle-afltables.timer; do echo disabled > "$T/st/$u.enabled"; done; }
install_inert() { for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service; do echo loaded > "$T/st/$u.load"; done
  for u in afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer; do echo disabled > "$T/st/$u.enabled"; done
  for f in afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer; do cp "$CAND/deploy/$f" "$T/etc/$f"; done; }

reset
ok c3-pre "$R"
no "c3-pre with a bad revision" c3-pre aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
echo loaded > "$T/st/afldb-settle-afl-api.service.load"; no "c3-pre with a unit already loaded" c3-pre "$R"; reset
echo true > "$T/setting"; no "c3-pre with the switch true" c3-pre "$R"; reset
echo enabled > "$T/st/afldb-settle-afltables.timer.enabled"; no "c3-pre with the AFL Tables timer enabled" c3-pre "$R"; reset
cp "$CAND/deploy/afldb-settle-afl-api.timer" "$T/etc/"; no "c3-pre with an installed unit file" c3-pre "$R"; reset
sed -i 's#^\(afldb-settle-afl-api.timer:\)a37114#\1b37114#' "$T/c-prod.test.sh"; no "c3-pre with a wrong pin" c3-pre "$R"
sed -i 's#^\(afldb-settle-afl-api.timer:\)b37114#\1a37114#' "$T/c-prod.test.sh"
install_inert
sed -i 's#\[ "\$pass" = 2 \] || sleep 60#[ "$pass" = 2 ] || sleep 1#' "$T/c-prod.test.sh"
ok c3-accept "$R"
echo enabled > "$T/st/afldb-settle-afl-api-brownlow.timer.enabled"; no "c3-accept with the Brownlow timer enabled" c3-accept "$R"
echo disabled > "$T/st/afldb-settle-afl-api-brownlow.timer.enabled"
echo active > "$T/st/afldb-settle-afl-api.service.active"; no "c3-accept with a service active" c3-accept "$R"; rm -f "$T/st/afldb-settle-afl-api.service.active"
echo "# drift" >> "$T/etc/afldb-settle-afl-api.service"; no "c3-accept with a drifted installed copy" c3-accept "$R"
cp "$CAND/deploy/afldb-settle-afl-api.service" "$T/etc/"

ok c4b-pre "$R" "$FEED"
no "c4b-pre with a missing feed" c4b-pre "$R" "$T/none.json"
echo x > "$T/feed-bad.json"; no "c4b-pre with a different feed" c4b-pre "$R" "$T/feed-bad.json"
echo true > "$T/setting"; no "c4b-pre with the switch true" c4b-pre "$R" "$FEED"; echo "" > "$T/setting"
sed -i 's#^FIRST_2027_MATCH_UTC=.*#FIRST_2027_MATCH_UTC=2020-01-01T00:00:00Z#' "$T/c-prod.test.sh"; no "c4b-pre after the first match time" c4b-pre "$R" "$FEED"
sed -i 's#^FIRST_2027_MATCH_UTC=.*#FIRST_2027_MATCH_UTC=2027-03-17T00:00:00Z#' "$T/c-prod.test.sh"

printf '%s\n' '{"verdict":"CLEAR","decision":"D-316-13","season":2027}' > "$T/c4b/result.json"
ok c5-pre "$R" "$T/c4b"
printf '%s\n' '{"verdict":"HALT"}' > "$T/c4b/result.json"; no "c5-pre with a HALT record" c5-pre "$R" "$T/c4b"
no "c5-pre without a record" c5-pre "$R" "$T/nothing"
printf '%s\n' '{"verdict":"CLEAR"}' > "$T/c4b/result.json"
[ "$ENV_EXISTED" = 1 ] && cp "$CAND/.env" "$T/env.save"
printf '%s\n' 'AFLDB_SETTLE_TRIGGER=systemd' >> "$CAND/.env"; no "c5-pre with the trigger already present" c5-pre "$R" "$T/c4b"
ok c5-env "$R"
printf '%s\n' '# AFLDB_SETTLE_TRIGGER=off' >> "$CAND/.env"; no "c5-env with a second mention" c5-env "$R"
if [ "$ENV_EXISTED" = 1 ]; then cp "$T/env.save" "$CAND/.env"; else : > "$CAND/.env"; fi
no "c5-env with none" c5-env "$R"

echo true > "$T/setting"; echo enabled > "$T/st/afldb-settle-afl-api.timer.enabled"; echo active > "$T/st/afldb-settle-afl-api.timer.active"
ok c5-accept "$R"
echo enabled > "$T/st/afldb-settle-afl-api-brownlow.timer.enabled"; no "c5-accept with the Brownlow timer enabled" c5-accept "$R"
echo disabled > "$T/st/afldb-settle-afl-api-brownlow.timer.enabled"
echo false > "$T/setting"; no "c5-accept with the switch false" c5-accept "$R"
[ "$ENV_EXISTED" = 1 ] || rm -f "$CAND/.env"
[ "$bad" = 0 ] && echo "C SELFTEST PASS" || { echo "C SELFTEST FAIL"; exit 1; }
