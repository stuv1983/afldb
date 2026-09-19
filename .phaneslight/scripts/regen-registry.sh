#!/bin/sh
# phaneslight-generated v3.7.2 regen-registry
# POSIX sibling. This project's supported runtime is Linux, and the scripts directory is
# tracked, so a Linux checkout must find a dispatcher target here too.
exec node "$(dirname "$0")/regen-registry.js" "$@"
