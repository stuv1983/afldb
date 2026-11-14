#!/usr/bin/env bash
# Verify EVERY sha256 manifest and README-embedded hash under docs/v2/evidence/remediation-20261114/ at REV.
#
#   verify-manifests.sh <repo> [rev=HEAD]            (run from a clone; reads blobs with `git cat-file`)
#   env: EVIDENCE_HOST (default arm@10.0.40.100)  EVIDENCE_KEY (default ~/.ssh/afldb_dev)  NO_HOST=1 (skip host hashing)
#
# Output (TSV, stdout):  STATUS  source  entry  expected  actual  where  note
#   COMMITTED-OK        a committed blob in the same scope hashes to the expected value
#   COMMITTED-MISMATCH  a committed blob of that name exists and does NOT hash to the expected value (zero required)
#   HOST-OK             not committed; re-hashed READ-ONLY on the host at the path the scope README names: equal
#   HOST-MISMATCH       the host file exists but hashes differently (reported, never "fixed")
#   HOST-MISSING        the file is gone from the host (reported; never regenerated or dropped)
#   UNRESOLVED          location not determinable; the note says why
# Sources scanned: every file under the dir whose basename matches *sha256* / SHA256SUMS / *.sha (the 10 manifests),
# the curated README-embedded full or prefix hashes in readme-hashes.tsv (each is checked to still occur in the README),
# and every truncated `abcd1234…` hash in any README (matched against the hashes verified in this run, else UNRESOLVED).
# Host access: one `ssh` that only runs sha256sum / test -f on the listed paths (read-only). Exit 1 on any
# COMMITTED-MISMATCH. Needs bash >= 4 (associative arrays).
set -u
REPO=${1:?usage: verify-manifests.sh <repo> [rev]}; REV=${2:-HEAD}
BASE=docs/v2/evidence/remediation-20261114
HOST=${EVIDENCE_HOST:-arm@10.0.40.100}; KEY=${EVIDENCE_KEY:-$HOME/.ssh/afldb_dev}; NOHOST=${NO_HOST:-0}
HR=/mnt/ssd
cd "$REPO" || exit 2
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

declare -A BLOB CSHA HRES VERIFIED
PATHS=()
while IFS=$'\t' read -r meta p; do BLOB["$p"]=1; PATHS+=("$p"); done < <(git ls-tree -r "$REV" -- "$BASE")
[ "${#PATHS[@]}" -gt 0 ] || { echo "no tree under $BASE at $REV" >&2; exit 2; }

csha() { local p=$1; if [ -z "${CSHA[$p]:-}" ]; then CSHA[$p]=$(git cat-file blob "$REV:$p" | sha256sum | cut -d' ' -f1); fi; REPLY=${CSHA[$p]}; }
blobtxt() { git cat-file blob "$REV:$1" | tr -d '\r'; }

# --- host paths the scope README names for a manifest's relative entries (README line cited) ---
host_paths() { # manifest name
  local man=$1 name=$2
  case "$man" in
    */answers/host-scripts-sha256.txt)    echo "$HR/afldb-rem-answers-20261114/$name";;                  # answers/README.md section 8
    */answers/raw-sha256.txt)             echo "$HR/afldb-rem-answers-20261114/evidence/$name"; echo "$HR/afldb-rem-answers-20261114/evidence/fe4/$name";; # README l.93, l.117
    */auth/raw/sha256-inputs-and-binaries.txt) echo "$HR/afldb-rem-auth-20261114/$name";;                # auth/README.md l.4 (inputs/, caddy-bin/)
    */tests/host-log-sha256.txt)          echo "$HR/afldb-rem-tests-20261114/evidence/$name";;           # tests/README.md l.81
    */perf/scripts.sha256)                echo "$HR/afldb-rem-perf-20261114/evidence/$name";;            # perf/README.md l.186,204 (copies; originals at workspace root)
    */hostops/host-evidence/SHA256SUMS)   echo "$HR/afldb-rem-hostops-20261114/evidence/$name";;         # hostops/README.md l.223
    */routes/host-evidence.sha256)        case "$name" in /*) echo "$name";; esac;;                      # routes/README.md l.236-238 (absolute)
    */qualification/SHA256SUMS)           echo "$HR/afldb-rem-int-20261114/evidence/$name";;             # QUALIFICATION.md l.7 (layout differs; diagnostic only)
    */qualification/iso-3aa82166/stagea-dst.sha) echo "$HR/afldb-rem-int-20261114/cand/data/sources/draftguru/annual-html-20260826/$name";; # in/orch-stagea.sh DST
    */qualification/iso-3aa82166/stagea-src.sha) echo "!source is DEV /home/arm/projects/afldb/data/sources/draftguru/annual-html-20260826 (a DEV path; not read by this scope)";;
    *) echo "!no host mapping rule for this manifest";;
  esac
}

# --- deferred entries: resolved after the single host hashing round ---
DS=(); DM=(); DN=(); DE=(); DMM=(); DHP=(); DNOTE=()
HQ="$T/hostq"; : > "$HQ"
ROWS="$T/rows"; : > "$ROWS"
row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >> "$ROWS"; }

# queue SOURCE LABEL EXPECTED "committed candidates ;-sep" "host paths |-sep" NOTE
queue() {
  local src=$1 label=$2 exp=$3 cands=$4 hps=$5 note=$6 c matched="" firstmm="" ifs=$IFS
  IFS=';'; for c in $cands; do
    [ -n "$c" ] && [ -n "${BLOB[$c]:-}" ] || continue
    csha "$c"
    if [[ $REPLY == "$exp"* ]]; then matched=$c; VERIFIED[$REPLY]="COMMITTED-OK|$label"; break; else firstmm=${firstmm:-$c}; fi
  done; IFS=$ifs
  if [ -n "$matched" ]; then row COMMITTED-OK "$src" "$label" "$exp" "$REPLY" "$matched" "$note"; return; fi
  local i=${#DS[@]}
  DS[$i]=$src; DM[$i]=$label; DE[$i]=$exp; DMM[$i]=$firstmm; DHP[$i]=$hps; DNOTE[$i]=$note
  if [ -n "$hps" ] && [ "${hps:0:1}" != "!" ]; then IFS='|'; for c in $hps; do printf '%s\n' "$c" >> "$HQ"; done; IFS=$ifs; fi
}

# --- 1. every manifest ---
MANS=$(printf '%s\n' "${PATHS[@]}" | grep -E '^'"$BASE"'/' | grep -vE '^'"$BASE"'/run2/' | grep -iE '/(SHA256SUMS|[^/]*sha256[^/]*|[^/]*\.sha)$')
declare -A STAGEA_DST
for man in $MANS; do
  mdir=$(dirname "$man"); rel=${man#$BASE/}; scope=${rel%%/*}
  while read -r exp name; do
    [ -z "${exp:-}" ] && continue
    name=${name#\*}; name=${name#./}
    case "$man" in */stagea-dst.sha) STAGEA_DST["$exp  $name"]=1;; esac
  done < <(blobtxt "$man")
done
for man in $MANS; do
  mdir=$(dirname "$man"); rel=${man#$BASE/}; scope=${rel%%/*}
  while read -r exp name; do
    [ -z "${exp:-}" ] && continue
    name=${name#\*}; name=${name#./}
    cands=""
    case "$name" in /*) ;; *)
      [ -n "${BLOB[$mdir/$name]:-}" ] && cands="$mdir/$name"
      for p in "${PATHS[@]}"; do
        case "$p" in "$BASE/$scope/"*"/$name") [ "$p" != "$man" ] && cands="$cands;$p";; esac
      done;; esac
    hps=""; note=""
    while read -r hp; do [ -z "$hp" ] && continue
      if [ "${hp:0:1}" = "!" ]; then hps=$hp; else hps="${hps:+$hps|}$hp"; fi
    done < <(host_paths "$man" "$name")
    case "$man" in */stagea-src.sha) [ -n "${STAGEA_DST["$exp  $name"]:-}" ] && note="same name+hash is listed in stagea-dst.sha (copy was verified identical at run time)";; esac
    queue "$rel" "$name" "$exp" "$cands" "$hps" "$note"
  done < <(blobtxt "$man")
done

# --- 2. README-embedded hashes (curated list, each re-checked against the README text) ---
LIST="$BASE/run2/evidence/readme-hashes.tsv"
if [ -n "${BLOB[$LIST]:-}" ]; then
  while IFS=$'\t' read -r readme exp label locs reason; do
    case "$readme" in ''|'#'*|readme) continue;; esac
    if ! blobtxt "$BASE/$readme" | grep -qF "$exp"; then row UNRESOLVED "$readme" "$label" "$exp" "" "" "curated hash no longer occurs in the README text (list is stale)"; continue; fi
    cands=""; hps=""
    IFS=';' read -ra L <<< "$locs"
    for l in "${L[@]}"; do
      case "$l" in C:*) cands="${cands:+$cands;}$BASE/${l#C:}";; H:*) hps="${hps:+$hps|}${l#H:}";; esac
    done
    [ -z "$cands" ] && [ -z "$hps" ] && hps="!${reason:-no location recorded}"
    queue "$readme (embedded)" "$label" "$exp" "$cands" "$hps" "${reason:-}"
  done < <(blobtxt "$LIST")
else
  echo "warning: $LIST not present at $REV; README-embedded hashes not checked" >&2
fi

# --- 3. one read-only host round ---
HOSTUP=1
if [ "$NOHOST" = 1 ] || [ ! -s "$HQ" ]; then HOSTUP=0; [ "$NOHOST" = 1 ] && HOSTWHY="host hashing disabled (NO_HOST=1)" || HOSTWHY=""; fi
if [ "$HOSTUP" = 1 ]; then
  sort -u "$HQ" | timeout 900 ssh -o BatchMode=yes -o ConnectTimeout=20 -i "$KEY" "$HOST" \
    'while IFS= read -r p; do if [ -f "$p" ]; then printf "%s\t%s\n" "$(sha256sum < "$p" | cut -d" " -f1)" "$p"; else d=$(dirname "$p"); if [ -d "$d" ]; then s=dir-present; else s=dir-absent; fi; printf "MISSING\t%s\t%s\n" "$p" "$s"; fi; done' > "$T/hostout" 2>"$T/hosterr"
  if [ ! -s "$T/hostout" ]; then HOSTUP=0; HOSTWHY="host unreachable or returned nothing: $(head -c 200 "$T/hosterr")"; fi
  while IFS=$'\t' read -r a b c; do if [ "$a" = MISSING ]; then HRES[$b]="MISSING:$c"; else HRES[$b]=$a; fi; done < "$T/hostout"
fi

for i in "${!DS[@]}"; do
  src=${DS[$i]}; label=${DM[$i]}; exp=${DE[$i]}; mm=${DMM[$i]}; hps=${DHP[$i]}; note=${DNOTE[$i]}
  if [ -n "$mm" ]; then
    csha "$mm"; row COMMITTED-MISMATCH "$src" "$label" "$exp" "$REPLY" "$mm" "committed blob differs from the recorded hash${note:+; $note}"; continue
  fi
  if [ -z "$hps" ]; then row UNRESOLVED "$src" "$label" "$exp" "" "" "not committed in this scope and no host path rule${note:+; $note}"; continue; fi
  if [ "${hps:0:1}" = "!" ]; then row UNRESOLVED "$src" "$label" "$exp" "" "" "${hps:1}${note:+; $note}"; continue; fi
  if [ "$HOSTUP" = 0 ]; then row UNRESOLVED "$src" "$label" "$exp" "" "$hps" "${HOSTWHY:-no host path to check}${note:+; $note}"; continue; fi
  ok=""; diff=""; miss=""; state=""
  IFS='|' read -ra HP <<< "$hps"
  for h in "${HP[@]}"; do
    r=${HRES[$h]:-}
    case "$r" in
      '') ;;
      MISSING:*) miss="${miss:-$h}"; state=${r#MISSING:};;
      *) if [[ $r == "$exp"* ]]; then ok=$h; VERIFIED[$r]="HOST-OK|$label"; break; else diff=${diff:-$h}; fi;;
    esac
  done
  if [ -n "$ok" ]; then row HOST-OK "$src" "$label" "$exp" "${HRES[$ok]}" "$ok" "$note"
  elif [ -n "$diff" ]; then row HOST-MISMATCH "$src" "$label" "$exp" "${HRES[$diff]}" "$diff" "host file exists with a different hash${note:+; $note}"
  else row HOST-MISSING "$src" "$label" "$exp" "" "${HP[0]}" "file absent ($state) at the path the scope README names${note:+; $note}"; fi
done

# --- 4. truncated hashes in README prose ---
# Matched first against what this run verified; if still unmatched, against EVERY committed blob of the README's own scope
# and every file under that scope's host evidence dir (/mnt/ssd/afldb-rem-<scope>-20261114/evidence[-raw]), read-only.
PRE="$T/prefixes"
for p in "${PATHS[@]}"; do case "$p" in "$BASE"/run2/*) ;; "$BASE"/*.md)
  blobtxt "$p" | grep -noE '[0-9a-f]{8,63}(…|\.\.\.)' | sed -E "s#^([0-9]+):([0-9a-f]+).*#$p\t\1\t\2#";; esac; done > "$PRE"
declare -A SCOPEH; NEEDED=""
while IFS=$'\t' read -r f ln pre; do
  [ -z "$pre" ] && continue
  hit=""; for h in "${!VERIFIED[@]}"; do [[ $h == "$pre"* ]] && { hit=$h; break; }; done
  [ -n "$hit" ] && continue
  rd=${f#$BASE/}; sc=${rd%%/*}; case "$rd" in */*) NEEDED="$NEEDED $sc";; esac
done < "$PRE"
for sc in $(printf '%s\n' $NEEDED | sort -u); do
  : > "$T/sc-$sc"
  for p in "${PATHS[@]}"; do case "$p" in "$BASE/$sc/"*) csha "$p"; printf '%s\t%s\t%s\n' "$REPLY" COMMITTED "${p#$BASE/}" >> "$T/sc-$sc";; esac; done
  if [ "$HOSTUP" = 1 ]; then
    timeout 300 ssh -o BatchMode=yes -o ConnectTimeout=20 -i "$KEY" "$HOST" \
      "for d in $HR/afldb-rem-$sc-20261114/evidence $HR/afldb-rem-$sc-20261114/evidence-raw; do [ -d \"\$d\" ] && find \"\$d\" -type f -size -300000k -exec sha256sum {} +; done" 2>/dev/null \
      | awk '{h=$1; $1=""; sub(/^ +/,""); printf "%s\tHOST\t%s\n", h, $0}' >> "$T/sc-$sc"
  fi
done
while IFS=$'\t' read -r f ln pre; do
  [ -z "$pre" ] && continue
  rd=${f#$BASE/}; sc=${rd%%/*}; src="$rd:$ln (prefix)"
  hit=""; for h in "${!VERIFIED[@]}"; do [[ $h == "$pre"* ]] && { hit=$h; break; }; done
  if [ -n "$hit" ]; then row "${VERIFIED[$hit]%%|*}" "$src" "${VERIFIED[$hit]#*|}" "$pre…" "$hit" "" "truncated hash is a prefix of the hash verified for the entry named in column 3"; continue; fi
  m=""; [ -f "$T/sc-$sc" ] && m=$(awk -F'\t' -v p="$pre" 'index($1,p)==1 {print $2"\t"$1"\t"$3; exit}' "$T/sc-$sc")
  if [ -n "$m" ]; then IFS=$'\t' read -r kind full where <<< "$m"
    row "$([ "$kind" = COMMITTED ] && echo COMMITTED-OK || echo HOST-OK)" "$src" "$pre…" "$pre…" "$full" "$where" "prefix matches a file in the scope's own $([ "$kind" = COMMITTED ] && echo committed files || echo host evidence dir) (no file name stated in the prose)"
  else row UNRESOLVED "$src" "$pre…" "$pre…" "" "" "truncated hash in prose; matches no verified hash, no committed file of the scope and no file in its host evidence dir (may be a git commit/release id or a database digest rather than a file hash)"; fi
done < "$PRE"

sort -t$'\t' -k1,1 -k2,2 -k3,3 "$ROWS"
echo "--- summary ---" >&2
cut -f1 "$ROWS" | sort | uniq -c >&2
grep -q '^COMMITTED-MISMATCH' "$ROWS" && exit 1
exit 0
