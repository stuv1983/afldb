#!/usr/bin/env bash
# Verify every evidence manifest under the remediation evidence dir against committed blobs at REV.
# Output: STATUS<TAB>manifest<TAB>entry<TAB>expected<TAB>blob-sha<TAB>blob-sha-if-CRLF->LF<TAB>blob-sha-if-LF->CRLF
set -u
REPO=${1:?repo}; REV=${2:-HEAD}; BASE=docs/v2/evidence/remediation-20261114
cd "$REPO"
git ls-tree -r --name-only "$REV" -- "$BASE" | grep -Ei '(sha256|SHA256SUMS)' | while read -r man; do
  mdir=$(dirname "$man")
  git cat-file blob "$REV:$man" | tr -d '\r' | while read -r exp name; do
    [ -z "${exp:-}" ] && continue
    name=${name#\*}; name=${name#./}
    case "$name" in /*) echo -e "HOSTONLY\t$man\t$name\t$exp"; continue;; esac
    p="$mdir/$name"
    if git cat-file -e "$REV:$p" 2>/dev/null; then
      got=$(git cat-file blob "$REV:$p" | sha256sum | cut -d' ' -f1)
      if [ "$got" = "$exp" ]; then echo -e "OK\t$man\t$name"; else
        lf=$(git cat-file blob "$REV:$p" | tr -d '\r' | sha256sum | cut -d' ' -f1)
        crlf=$(git cat-file blob "$REV:$p" | sed 's/$/\r/' | sha256sum | cut -d' ' -f1)
        echo -e "MISMATCH\t$man\t$name\t$exp\t$got\tlfonly=$lf\tcrlf=$crlf"
      fi
    else
      # maybe committed gzipped or with .txt suffix
      alt=""; for s in .gz .txt; do git cat-file -e "$REV:$p$s" 2>/dev/null && alt="$p$s"; done
      echo -e "NOTCOMMITTED\t$man\t$name\t$exp\t${alt}"
    fi
  done
done
