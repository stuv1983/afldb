#!/usr/bin/env bash
# Verify EVERY sha256 manifest under docs/v2/evidence/remediation-20261114/ (all runs, run2/ and run4/ included) at REV.
# Run-4 replacement for run2/evidence/verify-manifests.sh (which stays byte-identical; see run2/evidence/ERRATA.md).
#
#   verify-manifests.sh <repo> [rev=HEAD]       run from anywhere; blobs are read with `git cat-file` (never the working tree)
#   env: EVIDENCE_MAP         map file (default: manifest-map.tsv beside this script; its sha256 is printed in the header)
#        EVIDENCE_HOST        ssh target (default arm@10.0.40.100)      EVIDENCE_KEY  ssh key (default ~/.ssh/afldb_dev)
#        EVIDENCE_LOCAL_HOST=1  run the host round with `bash -c` on THIS machine (use on the host itself; also the self-test stub)
#        NO_HOST=1            do not touch the host: every host-tier entry is UNRESOLVED "host hashing disabled"
#        EVIDENCE_HOST_ALLOW  ':'-separated absolute prefixes the host round may read
#                             (default /mnt/ssd/afldb-rem:/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/); RB-1 is always refused
#        REQUIRE_NO_UNRESOLVED=1  exit 4 when any manifest entry is UNRESOLVED (use for the final-candidate gate)
#
# WHAT IS A MANIFEST: a committed blob under the base directory, at any depth and in any run directory (run2/ and run4/ included),
# whose basename, case-insensitively, contains `sha256` (this covers SHA256SUMS, HOST-SHA256SUMS, *.sha256, *-sha256.txt) or ends in `.sha`;
# plus the files named by `include` rows of the map (hash lists whose name does not match). It is picked up automatically: a file added
# later by a run-4 scope is verified without editing this script. A manifest with no parseable entry is reported (UNRESOLVED), never skipped.
# Files that merely look like hash lists but are neither are reported as INFO-HASHLIKE-FILE (their hashes are NOT verified).
#
# RESOLUTION IS EXACT. An entry (leading `*` and `./` removed) resolves to <manifest dir>/<entry> in the committed tree, to the
# candidates the map declares for that manifest (croot / alias / aliaspfx / abs2c), and, if nothing is committed, to host paths
# (<hroot>/<entry>, or the entry itself when absolute). There is NO basename or suffix search, and the first match is not accepted:
#   * a committed blob that exists at a resolved path DECIDES the row; if it differs the row is COMMITTED-MISMATCH even when a
#     like-named file elsewhere has the recorded hash (that was the masked-mismatch defect of the run-2 script);
#   * more than one existing candidate in a tier is AMBIGUOUS, never a pass.
#
# OUTPUT (TSV on stdout; `#` lines are header/summary). Manifest rows, exactly one per entry:
#   STATUS  source(manifest:line)  entry  expected  actual  where  note
#   COMMITTED-OK            blob at the exact resolved path hashes to the recorded value
#   COMMITTED-OK-ALIAS      same, but resolved by a map rule (rename, abs2c, or the declared bom-crlf transform); note says which (map:L<n>)
#   COMMITTED-MISMATCH      a blob exists at the resolved path and differs (zero required)
#   AMBIGUOUS               more than one existing candidate (zero required)
#   HOST-OK / HOST-MISMATCH / HOST-MISSING    not committed; hashed READ-ONLY on the host at the resolved path (HOST-MISMATCH: zero required)
#   DECLARED-NOT-RETAINED   host file absent and the map cites the README line saying so (notret), or the recorded hash was
#                           superseded and the host file equals the successor manifest's hash (super)
#   UNRESOLVED              location not determinable; the note says why
# Informational rows (NOT manifest entries; counted separately): INFO-COMMITTED-OK INFO-HOST-OK INFO-MISMATCH INFO-HOST-MISSING
#   INFO-UNRESOLVED INFO-STALE (curated README hash no longer in its README), INFO-PROSE-MATCHED / INFO-PROSE-UNMATCHED (README
#   truncated `abcd1234...` hashes vs the hashes this run verified), INFO-NONENTRY, INFO-HASHLIKE-FILE, INFO-MAP.
# Host access: ONE ssh whose remote command only runs `test -f`, `test -d` and `sha256sum` on the listed paths.
# The last `# RESULT` line repeats the exit status and the UNRESOLVED / HOST-MISSING counts.
# Exit: 1 on any COMMITTED-MISMATCH, HOST-MISMATCH or AMBIGUOUS; 3 on an internal inconsistency; else 0 (4: see REQUIRE_NO_UNRESOLVED).
# Needs bash >= 4 (associative arrays), git, sha256sum, tr, sort, awk, timeout (ssh mode).
set -u
SELF=${BASH_SOURCE[0]}; SELF_DIR=$(cd "$(dirname "$SELF")" && pwd)
REPO=${1:?usage: verify-manifests.sh <repo> [rev]}; REV=${2:-HEAD}
BASE=docs/v2/evidence/remediation-20261114
MAP=${EVIDENCE_MAP:-$SELF_DIR/manifest-map.tsv}
HOST=${EVIDENCE_HOST:-arm@10.0.40.100}; KEY=${EVIDENCE_KEY:-$HOME/.ssh/afldb_dev}
NOHOST=${NO_HOST:-0}; LOCALHOST=${EVIDENCE_LOCAL_HOST:-0}
ALLOW=${EVIDENCE_HOST_ALLOW:-/mnt/ssd/afldb-rem:/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/}
DENY=(/mnt/ssd/afldb-i316-rb-I-20261023T0905Z /mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z)
cd "$REPO" || exit 2
FULL=$(git rev-parse --verify -q "$REV^{commit}") || { echo "cannot resolve rev $REV" >&2; exit 2; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
TAB=$'\t'

declare -A BLOB CSHA CSHA2
PATHS=()
while IFS= read -r -d '' p; do BLOB["$p"]=1; PATHS+=("$p"); done < <(git ls-tree -r -z --name-only "$FULL" -- "$BASE")
[ "${#PATHS[@]}" -gt 0 ] || { echo "no tree under $BASE at $REV" >&2; exit 2; }

blobtxt() { git cat-file blob "$FULL:$1" | tr -d '\r'; }
csha() { local p=$1; [ -n "${CSHA[$p]:-}" ] || CSHA[$p]=$(git cat-file blob "$FULL:$p" | sha256sum | cut -d' ' -f1); REPLY=${CSHA[$p]}; }
# the documented LF/BOM-stripped copy, re-expanded: UTF-8 BOM + LF->CRLF (run2/ops/README.md:146)
csha_bomcrlf() { local p=$1; [ -n "${CSHA2[$p]:-}" ] || CSHA2[$p]=$( { printf '\357\273\277'; git cat-file blob "$FULL:$p" | sed 's/$/\r/'; } | sha256sum | cut -d' ' -f1); REPLY=${CSHA2[$p]}; }
host_ok() { # absolute, no dot segments, inside the allow-list, not RB-1
  local p=$1 a d; case "$p" in /*) ;; *) return 1;; esac
  case "$p/" in */../*|*/./*|*//*) return 1;; esac
  for d in "${DENY[@]}"; do case "$p" in "$d"|"$d"/*) return 1;; esac; done
  local IFS=:; for a in $ALLOW; do case "$p" in "$a"*) return 0;; esac; done; return 1
}
is_manifest_name() { local b=${1##*/}; b=${b,,}; case "$b" in *sha256*|*.sha) return 0;; esac; return 1; }

# ---------------------------------------------------------------- 1. the map
declare -A FORMAT CROOTS HROOTS ALIAS INCLUDE MAPMAN
declare -A APFX ABS2C XFORMR HXFORMR NOTRETR SUPER
MAPSRC="$T/map"; : > "$MAPSRC"
if [ -f "$MAP" ]; then tr -d '\r' < "$MAP" > "$MAPSRC"; else echo "warning: map $MAP not found; only the default (exact) rules apply" >&2; MAP=none; fi
ROWS="$T/rows"; : > "$ROWS"; INFO="$T/info"; : > "$INFO"
row()  { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >> "$ROWS"; }
irow() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >> "$INFO"; }
mln=0
while IFS=$'\t' read -r dir man a1 a2 reason; do mln=$((mln+1))
  case "$dir" in ''|'#'*) continue;; esac
  MAPMAN[$man]=1
  case "$dir" in
    include)  INCLUDE[$man]=$mln;;
    format)   FORMAT[$man]=$a1;;
    croot)    CROOTS[$man]="${CROOTS[$man]:+${CROOTS[$man]}|}$a1";;
    hroot)    HROOTS[$man]="${HROOTS[$man]:+${HROOTS[$man]}|}$a1";;
    alias)    ALIAS["$man|$a1"]="$a2$TAB$mln";;
    aliaspfx) APFX[$man]="${APFX[$man]:+${APFX[$man]}
}$a1$TAB$a2$TAB$mln";;
    abs2c)    ABS2C[$man]="${ABS2C[$man]:+${ABS2C[$man]}
}$a1$TAB$a2$TAB$mln";;
    xform)    XFORMR[$man]="${XFORMR[$man]:+${XFORMR[$man]}
}$a1$TAB$a2$TAB$mln$TAB$reason";;
    hxform)   HXFORMR[$man]="${HXFORMR[$man]:+${HXFORMR[$man]}
}$a1$TAB$a2$TAB$mln$TAB$reason";;
    notret)   NOTRETR[$man]="${NOTRETR[$man]:+${NOTRETR[$man]}
}$a1$TAB$mln$TAB$reason";;
    super)    SUPER["$man|$a1"]="$a2$TAB$mln$TAB$reason";;
    *) irow INFO-MAP "map:L$mln" "$dir" "" "" "" "unknown directive in the map (ignored)";;
  esac
done < "$MAPSRC"

# ---------------------------------------------------------------- 2. manifests and their entries
MANS=()
for p in "${PATHS[@]}"; do rel=${p#$BASE/}; if is_manifest_name "$p" || [ -n "${INCLUDE[$rel]:-}" ]; then MANS+=("$rel"); fi; done
for m in "${!MAPMAN[@]}"; do
  [ -n "${BLOB[$BASE/$m]:-}" ] || { irow INFO-MAP "map" "$m" "" "" "" "the map names a manifest that is not committed at this rev (rule not applied)"; continue; }
  if ! is_manifest_name "$m" && [ -z "${INCLUDE[$m]:-}" ]; then irow INFO-MAP "map" "$m" "" "" "" "the map has rules for a file that is not a manifest by the name rule and has no include row (rules not applied)"; fi
done
EM=(); EL=(); EX=(); EP=(); EA=(); N=0
declare -A ENTIDX ENTDUP; declare -A MANENT
for man in "${MANS[@]}"; do
  fmt=${FORMAT[$man]:-hash-path}; ln=0; cnt=0
  while IFS= read -r line; do ln=$((ln+1))
    [ -z "${line//[[:space:]]/}" ] && continue
    case "$line" in '#'*) continue;; esac
    if [[ $line =~ ^([0-9a-fA-F]{64})[[:space:]]+(.*)$ ]]; then
      h=${BASH_REMATCH[1],,}; rest=${BASH_REMATCH[2]}; ok=1
      case "$fmt" in
        hash-bytes-path)  if [[ $rest =~ ^[0-9]+[[:space:]]+(.*)$ ]]; then rest=${BASH_REMATCH[1]}; else ok=0; fi;;
        hash-marker-path) if [[ $rest =~ ^host-only[[:space:]]+(.*)$ ]]; then rest=${BASH_REMATCH[1]}; else ok=0; fi;;
      esac
      if [ $ok = 0 ]; then irow INFO-NONENTRY "$man:$ln" "${line:0:90}" "" "" "" "line does not fit the declared format $fmt"; continue; fi
      rest=${rest#\*}; while [[ $rest == ./* ]]; do rest=${rest#./}; done
      ann=""; if [[ $rest =~ ^(.*[^[:space:]])[[:space:]]{2,}\((.*)\)$ ]]; then rest=${BASH_REMATCH[1]}; ann=${BASH_REMATCH[2]}; fi
      rest=${rest%"${rest##*[![:space:]]}"}
      EM[$N]=$man; EL[$N]=$ln; EX[$N]=$h; EP[$N]=$rest; EA[$N]=$ann
      k="$man|$rest"; if [ -n "${ENTIDX[$k]:-}" ]; then ENTDUP[$k]=1; else ENTIDX[$k]=$N; fi
      N=$((N+1)); cnt=$((cnt+1))
    else
      irow INFO-NONENTRY "$man:$ln" "${line:0:90}" "" "" "" "not a hash line (a header, size or free-text line)"
    fi
  done < <(blobtxt "$BASE/$man")
  MANENT[$man]=$cnt
  [ "$cnt" -eq 0 ] && row UNRESOLVED "$man" "(manifest)" "" "" "" "no parseable entry line in this manifest (format ${fmt})"
done

# ---------------------------------------------------------------- 3. resolve committed tier; queue host tier
declare -a RC RA RW RN HPC
HQ="$T/hostq"; : > "$HQ"
CK=(); CP=(); CR=()
addc() { local k=$1 cp=$2 rr=$3 x; [ -n "${BLOB[$cp]:-}" ] || return; for x in ${CP[@]+"${CP[@]}"}; do [ "$x" = "$cp" ] && return; done; CK+=("$k"); CP+=("$cp"); CR+=("$rr"); }
match_rule() { # list(newline separated, first field = entry|prefix/|*) entry -> prints the matching line
  local list=$1 e=$2 l f; while IFS= read -r l; do [ -z "$l" ] && continue; f=${l%%$TAB*}
    case "$f" in '*') printf '%s' "$l"; return 0;; */) [[ $e == "$f"* ]] && { printf '%s' "$l"; return 0; };; *) [ "$e" = "$f" ] && { printf '%s' "$l"; return 0; };; esac
  done <<< "$list"; return 1; }
for ((i=0;i<N;i++)); do
  man=${EM[$i]}; p=${EP[$i]}; exp=${EX[$i]}; src="$man:${EL[$i]}"
  mdir=""; case "$man" in */*) mdir=${man%/*};; esac
  RC[$i]=""; RA[$i]=""; RW[$i]=""; RN[$i]=""; HPC[$i]=""
  case "/$p/" in */../*) RC[$i]=UNRESOLVED; RN[$i]="entry path has a '..' segment"; continue;; esac
  [ -n "$p" ] || { RC[$i]=UNRESOLVED; RN[$i]="empty entry path"; continue; }
  CK=(); CP=(); CR=()
  if [[ $p == /* ]]; then
    if [ -n "${ABS2C[$man]:-}" ]; then while IFS=$'\t' read -r pre root ln; do [ -z "$pre" ] && continue
        [[ $p == "$pre"* ]] && { r=${p#"$pre"}; [ "$root" = . ] && cp="$BASE/$r" || cp="$BASE/${root%/}/$r"; addc abs2c "$cp" "map:L$ln"; }
      done <<< "${ABS2C[$man]}"; fi
  else
    roots=${CROOTS[$man]-@}; IFS='|' read -ra RR <<< "$roots"
    for r in "${RR[@]}"; do case "$r" in -) ;; @) addc exact "$BASE/${mdir:+$mdir/}$p" "";; *) addc exact "$BASE/${r%/}/$p" "map:croot";; esac; done
  fi
  if [ -n "${ALIAS["$man|$p"]:-}" ]; then IFS=$'\t' read -r tgt ln <<< "${ALIAS["$man|$p"]}"; addc alias "$BASE/$tgt" "map:L$ln"; fi
  if [ -n "${APFX[$man]:-}" ]; then while IFS=$'\t' read -r pre root ln; do [ -z "$pre" ] && continue
      [[ $p == "$pre"* ]] && addc alias "$BASE/${root%/}/${p#"$pre"}" "map:L$ln"
    done <<< "${APFX[$man]}"; fi
  if [ "${#CP[@]}" -gt 1 ]; then RC[$i]=AMBIGUOUS; RW[$i]=$(IFS=';'; echo "${CP[*]}"); RN[$i]="${#CP[@]} existing committed candidates for one entry"; continue; fi
  if [ "${#CP[@]}" -eq 1 ]; then
    cp=${CP[0]}; csha "$cp"; act=$REPLY; kind=${CK[0]}; ref=${CR[0]}
    if [ "$act" = "$exp" ]; then
      if [ "$kind" = exact ]; then RC[$i]=COMMITTED-OK; RN[$i]=""; else RC[$i]=COMMITTED-OK-ALIAS; RN[$i]="$kind $ref"; fi
      RA[$i]=$act; RW[$i]=$cp; continue
    fi
    xr=$(match_rule "${XFORMR[$man]:-}" "$p") || xr=""
    if [ -n "$xr" ]; then IFS=$'\t' read -r xf xk xl xwhy <<< "$xr"
      if [ "$xk" = bom-crlf ]; then csha_bomcrlf "$cp"; if [ "$REPLY" = "$exp" ]; then RC[$i]=COMMITTED-OK-ALIAS; RA[$i]=$REPLY; RW[$i]=$cp; RN[$i]="transform bom-crlf of the committed LF/BOM-stripped copy map:L$xl; $xwhy"; continue; fi; fi
    fi
    RC[$i]=COMMITTED-MISMATCH; RA[$i]=$act; RW[$i]=$cp; RN[$i]="blob at the resolved path differs from the recorded hash${ref:+ ($kind $ref)}"; continue
  fi
  # nothing committed: host tier
  hcs=""; if [[ $p == /* ]]; then hcs=$p; else
    if [ -n "${HROOTS[$man]:-}" ]; then IFS='|' read -ra HR <<< "${HROOTS[$man]}"; for r in "${HR[@]}"; do hcs="${hcs:+$hcs|}${r%/}/$p"; done; fi; fi
  if [ -z "$hcs" ]; then RC[$i]=UNRESOLVED; RN[$i]="not committed at the resolved path${CROOTS[$man]+ (map croot ${CROOTS[$man]})} and the map declares no host root for this manifest"; continue; fi
  bad=""; IFS='|' read -ra HC <<< "$hcs"; for h in "${HC[@]}"; do host_ok "$h" || bad=$h; done
  if [ -n "$bad" ]; then RC[$i]=UNRESOLVED; RN[$i]="host path outside the read-only allow-list or unsafe: $bad (not read)"; continue; fi
  HPC[$i]=$hcs; hxr=$(match_rule "${HXFORMR[$man]:-}" "$p") || hxr=""
  for h in "${HC[@]}"; do printf 'R\t%s\n' "$h" >> "$HQ"; [ -n "$hxr" ] && printf 'S\t%s\n' "$h" >> "$HQ"; done
done

# ---------------------------------------------------------------- 4. informational: curated README hashes (queue their host paths)
LIST="$BASE/run2/evidence/readme-hashes.tsv"; CUR=();
if [ -n "${BLOB[$LIST]:-}" ]; then
  while IFS=$'\t' read -r readme exp label locs reason; do
    case "$readme" in ''|'#'*|readme) continue;; esac
    CUR+=("$readme$TAB$exp$TAB$label$TAB$locs$TAB$reason")
    IFS=';' read -ra L <<< "$locs"; for l in "${L[@]}"; do case "$l" in H:*) host_ok "${l#H:}" && printf 'R\t%s\n' "${l#H:}" >> "$HQ";; esac; done
  done < <(blobtxt "$LIST" | sed -e 's/		/	-	/g' -e 's/		/	-	/g')
else irow INFO-MAP "run2/evidence/readme-hashes.tsv" "" "" "" "" "curated README-hash list not present at this rev (informational section reduced)"; fi

# ---------------------------------------------------------------- 5. the one host round
declare -A HRES HRS; HOSTUP=0; HOSTWHY=""
sort -u "$HQ" -o "$HQ"
read -r -d '' REMOTE <<'EOS'
while IFS=$'\t' read -r m p; do
  if [ -f "$p" ]; then
    if [ "$m" = S ]; then h=$(sed 's/\x1b\[[0-9;]*m//g' "$p" 2>/dev/null | grep -a -v -i 'postgres://' | sha256sum | cut -d' ' -f1); else h=$(sha256sum < "$p" 2>/dev/null | cut -d' ' -f1); fi
    if [ -n "$h" ]; then printf '%s\t%s\t%s\n' "$m" "$h" "$p"; else printf 'E\t%s\tunreadable\n' "$p"; fi
  else d=$(dirname "$p"); if [ -d "$d" ]; then s=dir-present; else s=dir-absent; fi; printf 'M\t%s\t%s\n' "$p" "$s"; fi
done
EOS
if [ "$NOHOST" = 1 ]; then HOSTWHY="host hashing disabled (NO_HOST=1)"
elif [ ! -s "$HQ" ]; then HOSTUP=1
else
  if [ "$LOCALHOST" = 1 ]; then bash -c "$REMOTE" < "$HQ" > "$T/hostout" 2> "$T/hosterr"; rc=$?
  else timeout 900 ssh -o BatchMode=yes -o ConnectTimeout=20 -i "$KEY" "$HOST" "$REMOTE" < "$HQ" > "$T/hostout" 2> "$T/hosterr"; rc=$?; fi
  want=$(wc -l < "$HQ" | tr -d ' '); got=$(wc -l < "$T/hostout" | tr -d ' ')
  if [ "$got" -ne "$want" ]; then HOSTWHY="host round incomplete or unreachable (rc=$rc, $got of $want replies): $(head -c 200 "$T/hosterr" | tr '\n' ' ')"
  else
    HOSTUP=1
    while IFS=$'\t' read -r a b c; do case "$a" in R) HRES[$c]="H:$b";; S) HRS[$c]=$b;; M) HRES[$b]="M:$c";; E) HRES[$b]="E:$c";; esac; done < "$T/hostout"
  fi
fi

# ---------------------------------------------------------------- 6. resolve the host tier
nr_rule() { match_rule "${NOTRETR[$1]:-}" "$2"; }
for ((i=0;i<N;i++)); do
  [ -n "${RC[$i]}" ] && continue
  man=${EM[$i]}; p=${EP[$i]}; exp=${EX[$i]}; IFS='|' read -ra HC <<< "${HPC[$i]}"
  if [ "$HOSTUP" = 0 ]; then RC[$i]=UNRESOLVED; RW[$i]=${HC[0]}; RN[$i]="${HOSTWHY:-host not queried}"; continue; fi
  ex=(); st=""; err=""
  for h in "${HC[@]}"; do r=${HRES[$h]:-}; case "$r" in H:*) ex+=("$h");; M:*) st=${r#M:};; E:*) err=$h;; esac; done
  if [ "${#ex[@]}" -gt 1 ]; then RC[$i]=AMBIGUOUS; RW[$i]=$(IFS=';'; echo "${ex[*]}"); RN[$i]="${#ex[@]} existing host candidates for one entry"; continue; fi
  if [ "${#ex[@]}" -eq 1 ]; then
    h=${ex[0]}; act=${HRES[$h]#H:}; RA[$i]=$act; RW[$i]=$h
    if [ "$act" = "$exp" ]; then RC[$i]=HOST-OK; continue; fi
    hx=$(match_rule "${HXFORMR[$man]:-}" "$p") || hx=""
    if [ -n "$hx" ]; then IFS=$'\t' read -r hf hk hl hwhy <<< "$hx"
      if [ "$hk" = strip-ansi-dsn ] && [ "${HRS[$h]:-}" = "$exp" ]; then RC[$i]=HOST-OK; RA[$i]=$exp; RN[$i]="host original hashes to $act; after the documented strip-ansi-dsn transform it equals the recorded hash (map:L$hl: $hwhy)"; continue; fi
    fi
    sp=${SUPER["$man|$p"]:-}
    if [ -n "$sp" ]; then IFS=$'\t' read -r tgt ml why <<< "$sp"; tm=${tgt%%:*}; te=${tgt#*:}; tk="$tm|$te"
      if [ -n "${ENTIDX[$tk]:-}" ] && [ -z "${ENTDUP[$tk]:-}" ]; then j=${ENTIDX[$tk]}
        if [ "$act" = "${EX[$j]}" ]; then RC[$i]=DECLARED-NOT-RETAINED; RN[$i]="superseded (map:L$ml): host file equals the hash recorded at $tm:${EL[$j]}; $why"; continue; fi; fi
      RC[$i]=HOST-MISMATCH; RN[$i]="host file differs; declared superseded by $tgt (map:L$ml) but the host file does not equal that row either"; continue
    fi
    RC[$i]=HOST-MISMATCH; RN[$i]="host file exists with a different hash"; continue
  fi
  if [ -n "$err" ]; then RC[$i]=UNRESOLVED; RW[$i]=$err; RN[$i]="host file exists but could not be hashed"; continue; fi
  nr=$(nr_rule "$man" "$p") || nr=""
  if [ -n "$nr" ]; then IFS=$'\t' read -r nf nl nwhy <<< "$nr"; RC[$i]=DECLARED-NOT-RETAINED; RW[$i]=${HC[0]}; RN[$i]="map:L$nl: $nwhy; host file absent ($st)"; continue; fi
  RC[$i]=HOST-MISSING; RW[$i]=${HC[0]}; RN[$i]="file absent ($st) at the resolved host path; no README statement of non-retention in the map"
done
for ((i=0;i<N;i++)); do
  note=${RN[$i]}; ann=${EA[$i]}
  [ -n "$ann" ] && note="${note:+$note; }manifest annotation: $ann"
  row "${RC[$i]}" "${EM[$i]}:${EL[$i]}" "${EP[$i]}" "${EX[$i]}" "${RA[$i]}" "${RW[$i]}" "$note"
done

# ---------------------------------------------------------------- 7. informational section
declare -A V8 VER
add_ver() { local h=$1; [ -n "$h" ] || return; VER[$h]=1; V8[${h:0:8}]="${V8[${h:0:8}]:-} $h"; }
for ((i=0;i<N;i++)); do case "${RC[$i]}" in COMMITTED-OK|COMMITTED-OK-ALIAS|HOST-OK) add_ver "${EX[$i]}";; esac; done
for c in "${CUR[@]}"; do
  IFS=$'\t' read -r readme exp label locs reason <<< "$c"
  if ! blobtxt "$BASE/$readme" | grep -qF "$exp"; then irow INFO-STALE "$readme (embedded)" "$label" "$exp" "" "" "curated hash no longer occurs in the README text (list is stale)"; continue; fi
  done_=0; IFS=';' read -ra L <<< "$locs"
  for l in "${L[@]}"; do case "$l" in C:*)
      cp="$BASE/${l#C:}"; if [ -n "${BLOB[$cp]:-}" ]; then csha "$cp"
        if [[ $REPLY == "$exp"* ]]; then irow INFO-COMMITTED-OK "$readme (embedded)" "$label" "$exp" "$REPLY" "$cp" ""; add_ver "$REPLY"; else irow INFO-MISMATCH "$readme (embedded)" "$label" "$exp" "$REPLY" "$cp" "committed blob differs from the hash the README states"; fi; done_=1; break; fi;; esac; done
  [ $done_ = 1 ] && continue
  for l in "${L[@]}"; do case "$l" in H:*)
      hp=${l#H:}; if ! host_ok "$hp"; then irow INFO-UNRESOLVED "$readme (embedded)" "$label" "$exp" "" "$hp" "host path outside the read-only allow-list (not read)"; done_=1; break; fi
      if [ "$HOSTUP" = 0 ]; then irow INFO-UNRESOLVED "$readme (embedded)" "$label" "$exp" "" "$hp" "${HOSTWHY:-host not queried}"; done_=1; break; fi
      r=${HRES[$hp]:-}
      case "$r" in H:*) a=${r#H:}; if [[ $a == "$exp"* ]]; then irow INFO-HOST-OK "$readme (embedded)" "$label" "$exp" "$a" "$hp" ""; add_ver "$a"; else irow INFO-MISMATCH "$readme (embedded)" "$label" "$exp" "$a" "$hp" "host file differs from the hash the README states"; fi;;
        M:*) irow INFO-HOST-MISSING "$readme (embedded)" "$label" "$exp" "" "$hp" "file absent (${r#M:})";;
        *) irow INFO-UNRESOLVED "$readme (embedded)" "$label" "$exp" "" "$hp" "host file could not be read";; esac
      done_=1; break;; esac; done
  [ $done_ = 1 ] || irow INFO-UNRESOLVED "$readme (embedded)" "$label" "$exp" "" "" "${reason:-no location recorded}"
done
# README prose truncated hashes (one `git grep`; matched only against hashes verified in THIS run; nothing is searched for on disk)
LC_ALL=C git grep -I -n -o -E '(^|[^0-9a-fA-F])[0-9a-f]{8,63}(\.\.\.|'$'\xe2\x80\xa6'')' "$FULL" -- ":(glob)$BASE/**/*.md" 2>/dev/null \
  | LC_ALL=C awk -v full="$FULL" -v base="$BASE/" '{ s=$0; sub("^" full ":" base, "", s); i=index(s,":"); f=substr(s,1,i-1); s=substr(s,i+1); j=index(s,":"); ln=substr(s,1,j-1); m=substr(s,j+1); match(m,/[0-9a-f]+/); printf "%s\t%s\t%s\n", f, ln, substr(m,RSTART,RLENGTH) }' > "$T/prose"
while IFS=$'\t' read -r f ln pre; do
  [ -z "$pre" ] && continue; hit=""
  for h in ${V8[${pre:0:8}]:-}; do [[ $h == "$pre"* ]] && { hit=$h; break; }; done
  if [ -n "$hit" ]; then irow INFO-PROSE-MATCHED "$f:$ln" "$pre..." "$pre..." "$hit" "" "prefix of a hash verified in this run (no file name is stated in the prose)"
  else irow INFO-PROSE-UNMATCHED "$f:$ln" "$pre..." "$pre..." "" "" "matches no hash verified in this run (may be a git commit/release id or database digest, or a short prefix whose full value is not recorded)"; fi
done < "$T/prose"
# hash-shaped files that are not manifests (so the reader sees what is NOT verified)
git grep -I -c -E '^[0-9a-f]{64}[[:space:]]' "$FULL" -- "$BASE" 2>/dev/null | sed -E "s#^$FULL:$BASE/##" | while IFS= read -r l; do
  f=${l%:*}; n=${l##*:}; is_manifest_name "$f" && continue; [ -n "${INCLUDE[$f]:-}" ] && continue
  printf 'INFO-HASHLIKE-FILE\t%s\t(%s hash-shaped lines)\t\t\t\tnot a manifest by the name rule and no include row in the map: its hashes are NOT verified\n' "$f" "$n"; done >> "$INFO"

# ---------------------------------------------------------------- 8. output
declare -A CNT ICNT
while IFS=$'\t' read -r c _; do CNT[$c]=$(( ${CNT[$c]:-0} + 1 )); done < "$ROWS"
while IFS=$'\t' read -r c _; do ICNT[$c]=$(( ${ICNT[$c]:-0} + 1 )); done < "$INFO"
nrows=$(grep -c . "$ROWS" 2>/dev/null || true); nrows=${nrows:-0}
unres_manifest_level=$(awk -F'\t' '$3=="(manifest)"' "$ROWS" | grep -c . || true)
rc=0; why=""
[ "$((${CNT[COMMITTED-MISMATCH]:-0} + ${CNT[HOST-MISMATCH]:-0} + ${CNT[AMBIGUOUS]:-0}))" -gt 0 ] && { rc=1; why="mismatch or ambiguity present"; }
[ "$nrows" -ne "$((N + unres_manifest_level))" ] && { rc=3; why="internal inconsistency: $nrows rows for $N entries"; echo "$why" >&2; }
[ "$rc" = 0 ] && [ "${REQUIRE_NO_UNRESOLVED:-0}" = 1 ] && [ "${CNT[UNRESOLVED]:-0}" -gt 0 ] && { rc=4; why="UNRESOLVED entries present and REQUIRE_NO_UNRESOLVED=1"; }
sha_self=$(sha256sum "$SELF" | cut -d' ' -f1); sha_map=none; [ -f "$MAP" ] && sha_map=$(sha256sum "$MAP" | cut -d' ' -f1)
mode=ssh; [ "$LOCALHOST" = 1 ] && mode=local; [ "$NOHOST" = 1 ] && mode=disabled
{
  printf '# verify-manifests (run4) rev=%s\n# script=%s sha256=%s\n# map=%s sha256=%s\n# bash=%s host-mode=%s host-reachable=%s\n' "$FULL" "$(basename "$SELF")" "$sha_self" "$(basename "$MAP")" "$sha_map" "$BASH_VERSION" "$mode" "$HOSTUP"
  printf '# manifests=%s entries=%s manifest-rows=%s (rows beyond entries are manifests with no entry)\n' "${#MANS[@]}" "$N" "$nrows"
  printf '# STATUS\tsource(manifest:line)\tentry\texpected\tactual\twhere\tnote\n'
  LC_ALL=C sort -t"$TAB" -k1,1 -k2,2 -k3,3 "$ROWS"
  printf '# ---- informational (NOT manifest rows; never counted as verification of a manifest entry) ----\n'
  LC_ALL=C sort -t"$TAB" -k1,1 -k2,2 -k3,3 "$INFO"
  printf '# ---- summary: manifest entries per class ----\n'
  for c in COMMITTED-OK COMMITTED-OK-ALIAS COMMITTED-MISMATCH AMBIGUOUS HOST-OK HOST-MISMATCH HOST-MISSING DECLARED-NOT-RETAINED UNRESOLVED; do printf '# %s\t%s\n' "$c" "${CNT[$c]:-0}"; done
  printf '# TOTAL\t%s\n' "$((nrows))"
  printf '# ---- summary: informational rows per class ----\n'
  for c in "${!ICNT[@]}"; do printf '# %s\t%s\n' "$c" "${ICNT[$c]}"; done | LC_ALL=C sort
  printf '# RESULT\texit=%s\t%s\n' "$rc" "${why:-pass criteria met (COMMITTED-MISMATCH 0, HOST-MISMATCH 0, AMBIGUOUS 0)}; UNRESOLVED=${CNT[UNRESOLVED]:-0} HOST-MISSING=${CNT[HOST-MISSING]:-0}"
} > "$T/out"
cat "$T/out"
grep -E "^# [A-Z-]+${TAB}[0-9]+$" "$T/out" >&2
exit $rc
