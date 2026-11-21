#!/bin/bash
# Check: N samples per worker per target after publication. Usage: check.sh [label] [perWorker]
set -euo pipefail
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
cd "$(dirname "$0")"
exec node probe.mjs check "${1:-check}" "${2:-4}"
