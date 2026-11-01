#!/bin/bash
# Self-test of assemble-backup-evidence.mjs with SYNTHETIC inputs (no database, no production data): one accepting case and the refusals.
#   bash assemble-selftest.sh      -> "SELFTEST PASS" or the failing case
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
R=$(printf 'a%.0s' $(seq 1 40)); DIG=$(printf 'b%.0s' $(seq 1 64)); BASE=$(printf 'c%.0s' $(seq 1 64))
printf 'synthetic dump bytes' > "$T/d.dump"; SHA=$(sha256sum "$T/d.dump" | cut -c1-64)
mk() { # writes inputs; variables adjust one thing per case
  node -e '
const fs = require("fs"); const [t, R, DIG, BASE, SHA, liveBase, restBase, sideDig, factsDig, restoredAt, sysid] = process.argv.slice(1);
const target = { host: "localhost", port: 5432, database: "afldb_prod", user: "afldb_owner", systemIdentifier: "7674454702926115004", databaseOid: "66668", clusterName: "16/main", databaseComment: null };
const w = (n, o) => fs.writeFileSync(t + "/" + n, JSON.stringify(o));
w("target.json", target);
w("live.json", { target, revision: R, baselineDigest: liveBase, capturedAt: "2026-11-02T00:00:00Z" });
w("restored.json", { target: { ...target, host: "127.0.0.1" }, revision: R, baselineDigest: restBase, capturedAt: "2026-11-02T00:10:00Z" });
w("side.json", { archive: "d.dump", archive_sha256: SHA, observed_ledger_digest: sideDig, ledger_unchanged_across_capture: true, source_identity: { system_identifier: sysid, database_oid: "66668" }, captured_end_utc: "2026-11-02T00:00:00.000Z" });
w("facts.json", { ledgerRows: 118, ledgerDigest: factsDig, matches: 1, fixtures: 0, restoredAt });
' "$T" "$R" "$DIG" "$BASE" "$@"
}
run() { rm -rf "$T/out"; node "$HERE/assemble-backup-evidence.mjs" --stage s1 --revision "$R" --target "$T/target.json" --live-baseline "$T/live.json" --restored-baseline "$T/restored.json" \
  --sidecar "$T/side.json" --dump "$T/d.dump" --restore-facts "$T/facts.json" --expect-ledger-digest "$DIG" --out-dir "$T/out" > "$T/out.txt" 2>&1; }
bad=0
case_ok() { mk "$SHA" "$BASE" "$BASE" "$DIG" "$DIG" 2026-11-02T00:20:00.000Z 7674454702926115004; run && grep -q ASSEMBLED "$T/out.txt" && [ -f "$T/out/backup-s1.json" ] || { echo "FAIL accept: $(cat "$T/out.txt")"; bad=1; }; }
case_no() { # name, then mk args
  local n=$1; shift; mk "$@"; if run; then echo "FAIL $n: accepted"; bad=1; elif [ -e "$T/out/backup-s1.json" ]; then echo "FAIL $n: refused but wrote"; bad=1; else echo "  ok refused: $n"; fi; }
case_ok
case_no "restored baseline differs"  "$SHA" "$BASE" "$(printf 'd%.0s' $(seq 1 64))" "$DIG" "$DIG" 2026-11-02T00:20:00.000Z 7674454702926115004
case_no "dump bytes differ from sidecar" "$(printf 'e%.0s' $(seq 1 64))" "$BASE" "$BASE" "$DIG" "$DIG" 2026-11-02T00:20:00.000Z 7674454702926115004
case_no "sidecar ledger digest wrong" "$SHA" "$BASE" "$BASE" "$(printf 'f%.0s' $(seq 1 64))" "$DIG" 2026-11-02T00:20:00.000Z 7674454702926115004
case_no "restored ledger digest wrong" "$SHA" "$BASE" "$BASE" "$DIG" "$(printf 'f%.0s' $(seq 1 64))" 2026-11-02T00:20:00.000Z 7674454702926115004
case_no "restore before capture" "$SHA" "$BASE" "$BASE" "$DIG" "$DIG" 2026-11-01T23:00:00.000Z 7674454702926115004
case_no "backup from another target" "$SHA" "$BASE" "$BASE" "$DIG" "$DIG" 2026-11-02T00:20:00.000Z 1
[ "$bad" = 0 ] && echo "SELFTEST PASS" || { echo "SELFTEST FAIL"; exit 1; }
