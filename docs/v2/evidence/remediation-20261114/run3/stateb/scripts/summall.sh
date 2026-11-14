#!/usr/bin/env bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
E=/mnt/ssd/afldb-rem3-stateb-20261114/evidence
for l in "$@"; do echo "##### $l"; node /mnt/ssd/afldb-rem3-stateb-20261114/in/summ.mjs "$E/$l/vitest.json" | cut -c1-420; done
