#!/usr/bin/env bash
# remediation run 3, scope qual: copy the retained, gitignored test fixtures READ-ONLY into the qualification checkout and
# hash-verify them before and after the copy. Nothing is written to any source location; nothing is fabricated.
#
#   fixtures.sh <Q' sha> base      fitzRoy full-history-20260902 (131 files) and DraftGuru person-html-20260826/sample.json
#   fixtures.sh <Q' sha> stagea    DraftGuru Stage A annual-html-20260826 (42 raw files vs the committed manifest; 90 files in all)
#                                  and person-html-20260826/input/residual_player_urls.txt (sha256 = sample.json residual_input.sha256)
#
# Adapted from run2/qualification-2 (qual.sh phase_fixtures, stagea.sh). Pins:
#   fitzRoy   per-file sha256 in run2/fixtures/fh-expected.sha256 (read from the committed tree at Q', 131/131)
#   sample    sha256 d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28
#   Stage A   every source_urls[].sha256 of docs/rebuild-manifests/draftguru/annual-html-20260826.json for raw/<raw_filename>
#   residual  sample.json residual_input.sha256 (df6c9a75...e841, also the pin in tests/draftguru-acquisition.test.ts)
set -u -o pipefail
export W=/mnt/ssd/afldb-rem3-qual-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
Q=${1:?usage: fixtures.sh <Q sha> base|stagea}; MODE=${2:?base|stagea}
CAND=$W/cand; E=$W/evidence/q-${Q:0:8}; mkdir -p "$E"
EVD=$CAND/docs/v2/evidence/remediation-20261114
[ "$(git -C "$CAND" rev-parse HEAD)" = "$Q" ] || { echo "HEAD mismatch"; exit 1; }
[ "$(git -C "$CAND" status --porcelain | wc -l)" = 0 ] || { echo "checkout is not clean"; exit 1; }

FH_SRC=/home/arm/projects/afldb/data/sources/afltables/fitzroy_core/full-history-20260902
FH_DST=$CAND/data/sources/afltables/fitzroy_core/full-history-20260902
I336=/mnt/ssd/afldb/workspaces/i336-preview2-20261106/checkout/data/sources/draftguru
SJ_SRC=$I336/person-html-20260826/sample.json
SJ_DST=$CAND/data/sources/draftguru/person-html-20260826/sample.json
SJ_SHA=d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28
RI_SRC=$I336/person-html-20260826/input/residual_player_urls.txt
RI_DST=$CAND/data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt
SA_SRC=/home/arm/projects/afldb/data/sources/draftguru/annual-html-20260826
SA_ALT=$I336/annual-html-20260826
SA_DST=$CAND/data/sources/draftguru/annual-html-20260826
sha() { sha256sum "$1" | cut -d' ' -f1; }

fixtures_base() {
  local exp=$EVD/run2/fixtures/fh-expected.sha256
  (cd "$FH_SRC" && sha256sum -c --quiet "$exp") || { echo "SOURCE fitzRoy hash mismatch"; return 1; }
  [ "$(ls "$FH_SRC" | wc -l)" = 131 ] || { echo "source file count not 131"; return 1; }
  [ "$(sha "$SJ_SRC")" = "$SJ_SHA" ] || { echo "SOURCE sample.json hash mismatch"; return 1; }
  [ ! -e "$FH_DST" ] && [ ! -e "$SJ_DST" ] || { echo "destination exists"; return 1; }
  mkdir -p "$(dirname "$FH_DST")" "$(dirname "$SJ_DST")"
  cp -a "$FH_SRC" "$FH_DST" && cp -p "$SJ_SRC" "$SJ_DST" || return 1
  chmod -R a-w "$FH_DST" "$SJ_DST"
  (cd "$FH_DST" && sha256sum -c --quiet "$exp") && echo "fitzRoy copy: 131 files re-verified against run2/fixtures/fh-expected.sha256" || { echo "COPY mismatch"; return 1; }
  [ "$(ls "$FH_DST" | wc -l)" = 131 ] || { echo "copy count not 131"; return 1; }
  [ "$(sha "$SJ_DST")" = "$SJ_SHA" ] && echo "sample.json copy re-verified" || { echo "COPY sample mismatch"; return 1; }
  { echo "# fixtures (base) copied read-only $(date -u +%FT%TZ) into $CAND at HEAD=$Q"
    echo "fitzroy src=$FH_SRC files=131, per-file sha256 = run2/fixtures/fh-expected.sha256 (131/131 OK at source and at copy)"
    echo "sample.json src=$SJ_SRC sha256=$SJ_SHA (source and copy)"; } > "$E/fixtures-provenance.txt"
}

fixtures_stagea() {
  local man=$CAND/docs/rebuild-manifests/draftguru/annual-html-20260826.json
  local exp=$E/stagea-expected.sha256
  node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const u of m.source_urls)console.log(u.sha256+"  "+u.raw_filename)' "$man" > "$exp" || return 1
  [ "$(wc -l < "$exp")" = 42 ] || { echo "manifest does not list 42 raw files"; return 1; }
  local ri_pin; ri_pin=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.residual_input.sha256))' "$SJ_DST") || return 1
  [ "$ri_pin" = df6c9a7559bceb649e8e28e457fbe91d3351d8c1737a9042f233b1f1e3c5e841 ] || { echo "sample.json residual_input.sha256 unexpected: $ri_pin"; return 1; }
  {
    echo "# Stage A and residual-input provenance $(date -u +%FT%TZ), HEAD=$Q"
    echo "## 1. raw files against the committed manifest docs/rebuild-manifests/draftguru/annual-html-20260826.json (42 entries)"
    (cd "$SA_SRC" && sha256sum -c "$exp" | grep -c ': OK$' | sed 's/^/OK: /'; sha256sum -c --quiet "$exp" && echo "rc=0 (all 42 match)")
    echo "## 2. every file of the source against the second retained copy ($SA_ALT)"
    (cd "$SA_SRC" && find . -type f | sort | xargs sha256sum) > "$E/stagea-src.sha256"
    (cd "$SA_ALT" && find . -type f | sort | xargs sha256sum) > "$E/stagea-alt.sha256"
    echo "files src=$(wc -l < "$E/stagea-src.sha256") alt=$(wc -l < "$E/stagea-alt.sha256")"
    cmp -s "$E/stagea-src.sha256" "$E/stagea-alt.sha256" && echo "IDENTICAL (paths and sha256)" || { echo "DIFFER"; diff "$E/stagea-src.sha256" "$E/stagea-alt.sha256" | head; }
    echo "tree sha256 (sha256 of the sorted list): $(sha256sum < "$E/stagea-src.sha256" | cut -d' ' -f1)"
    echo "## 3. residual input: source sha256 $(sha "$RI_SRC") ; sample.json residual_input.sha256 $ri_pin"
  } | tee "$E/stagea-provenance.txt"
  grep 'rc=0 (all 42 match)' "$E/stagea-provenance.txt" > /dev/null && grep IDENTICAL "$E/stagea-provenance.txt" > /dev/null || { echo "provenance check failed: not copied"; return 1; }
  [ "$(sha "$RI_SRC")" = "$ri_pin" ] || { echo "residual input source hash differs from sample.json residual_input.sha256: not copied"; return 1; }
  [ ! -e "$SA_DST" ] && [ ! -e "$RI_DST" ] || { echo "destination exists"; return 1; }
  cp -a "$SA_SRC" "$SA_DST" || return 1
  mkdir -p "$(dirname "$RI_DST")" && cp -p "$RI_SRC" "$RI_DST" || return 1
  chmod -R a-w "$SA_DST" "$RI_DST"
  (cd "$SA_DST" && find . -type f | sort | xargs sha256sum) | cmp -s - "$E/stagea-src.sha256" && echo "Stage A copy re-verified (90 files, paths and sha256)" | tee -a "$E/stagea-provenance.txt" || { echo "COPY MISMATCH"; return 1; }
  [ "$(sha "$RI_DST")" = "$ri_pin" ] && echo "residual input copy re-verified: sha256 $ri_pin = sample.json residual_input.sha256" | tee -a "$E/stagea-provenance.txt" || { echo "RESIDUAL COPY MISMATCH"; return 1; }
}

case "$MODE" in
  base) fixtures_base ;;
  stagea) fixtures_stagea ;;
  *) echo "unknown mode $MODE"; exit 1 ;;
esac
rc=$?
echo "porcelain lines: $(git -C "$CAND" status --porcelain | wc -l)"
exit $rc
