#!/bin/bash
# Prime: request every target on every DEV worker so each holds the pre-publication state. Usage: prime.sh [label]
set -euo pipefail
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
cd "$(dirname "$0")"
exec node probe.mjs prime "${1:-prime}" "${2:-2}"
