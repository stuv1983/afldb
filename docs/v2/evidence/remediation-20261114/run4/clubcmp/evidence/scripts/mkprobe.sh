#!/usr/bin/env bash
# mkprobe.sh <rb|snap|rbb> <dbname>: fresh scratch copy of a template (never the template itself)
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
case "$1" in rb) T=$TMPL_RB;; snap) T=$TMPL_SN;; rbb) T=$TMPL_RBB;; esac
mkcopy "$2" "$T"
