#!/bin/bash
# AFLDB-ISSUE-320: build the native-closure auditor twice (enforcing, reproducibility check) and once
# RECORD-ONLY (measurement; never bound) inside a NEW disposable root. Nothing is installed.
# usage: build-auditor.sh <root>   (the source is <root>/src/afldb-native-audit.c)
set -eu
ROOT=$1
cd "$ROOT"
echo "hostname=$(hostname) utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gcc --version | head -1
ld --version | head -1
sha256sum src/afldb-native-audit.c
FLAGS="-std=gnu11 -O2 -Wall -Wextra -Wno-unused-parameter -fPIC -shared -fno-ident -ffile-prefix-map=$ROOT=. -Wl,--build-id=none -Wl,-z,now -Wl,-z,relro"
mkdir -p build-a build-b build-record
gcc $FLAGS -o build-a/afldb-native-audit.so src/afldb-native-audit.c
gcc $FLAGS -o build-b/afldb-native-audit.so src/afldb-native-audit.c
gcc $FLAGS -DAFLDB_NATIVE_RECORD -o build-record/afldb-native-audit-RECORD-ONLY.so src/afldb-native-audit.c
sha256sum build-a/afldb-native-audit.so build-b/afldb-native-audit.so build-record/afldb-native-audit-RECORD-ONLY.so
cmp build-a/afldb-native-audit.so build-b/afldb-native-audit.so && echo "reproducible: identical bytes"
/lib64/ld-linux-x86-64.so.2 --list build-a/afldb-native-audit.so
