# Preparation run 20261030T020000Z (D-V2-PROD-EXEC-1 P-3/P-4/P-7, 2026-10-30)

Streamanator only, root `/home/arm/afldb-v2-prodexec-20261030T020000Z`, isolated cluster 127.0.0.1:55491, disposable
`_test` restores of the approved `a4641ca0` archive. No production or DEV access. Results: package §4.1.

| Folder | Contents |
|---|---|
| `rehearsal-evidence/` | `isolated-rehearsal.sh rehearse` and `after` evidence (every file under 100 KB, plus the evidence manifests): `rehearse.result` PASS, `after.result` PASS, gates D/R/T/V3, timings |
| `controls-run3-final/` | `rehearsal-controls.sh` `7989eeca…` output: `controls.result` = `PASS 112/112`, `controls.txt`, gate and compare reports, timings, `evidence-sha256.txt` (the whole output, including the files not copied here) |
| `failed-controls-run1-reserve-stop/` | Run 1: stopped by the 3 GiB disk watchdog at RB4 (`room()` rounded `df -B1G` up). Kept, not counted |
| `failed-controls-run2-h-harness/` | Run 2: every H control exit 5 (OID read with the wrong root). Kept, not counted |
| `logs/` | `rehearse.out`, `after.out`, the three controls logs, disk-watchdog logs (5-second free-space samples) |
| `repo-evidence-large.sha256` | SHA-256 of the files over 2 MiB that stay on the host (preservation snapshots, D8 seals) |

The complete 585-file bundle (46 MB) is kept off the repository at
`C:\Users\stuar\backups\afldb\release-v2-20261030T020000Z\prep-evidence-20261030T020000Z.tar`, SHA-256
`34afdb73f74c156791dcf1edd512068f7a215e81c10100aa09c2a73bbb740d5e`. It was checked for every isolated-cluster
secret (none present). Run 2's `env.good` was redacted on the host before the bundle was built.

The pinned set the run used, re-derived by P-7 after review: `PINNED.SHA256`
`38e7fbb4c948211796be4f7e9ea8de1e92be53cc2c82982e723952f9660e1842`, `src-9ed9c9dd.tar`
`ab10691fb2e9facb9b28bdb65b04c2ee823813f41ee48c193f0abe94dd7b6ad5`.
