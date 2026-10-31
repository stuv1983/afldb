# O-5 second-copy adapter (D-V2-PROD-EXEC-1, owner amendment 2026-10-31)

Recorded 2026-10-31 07:43 AEDT, before any production change.

The owner first approved `/mnt/media/Stu/backup(2026-10-31)/` as the second-copy destination, and it was found
unsuitable:
- `/mnt/media/Stu` is `root:arm 2755`, so `arm` cannot create the dated folder there.
- radarr, sonarr, qBittorrent and sabnzbd run as uid 1000 (`arm`) with `/mnt/media` mounted read-write. A mode-700
  folder would therefore not protect it from them.

The owner amended O-5 to `/mnt/backup/backup(2026-10-31)/` and created that folder as `arm:arm 700`. It sits on the
separate disk mounted at `/mnt/backup` (ext4, UUID `4bc4fb8d-b3eb-466a-b5f4-42806ec83d3c`, 59.6 GB free), which no
container mounts. Samba shares that disk only to `arm`, with a password.

| Item | SHA-256 | Result |
|---|---|---|
| `../second-copy.ps1` (the adapter; P-1/P-2/P-3 bytes unchanged) | `768e46a3f76e47ed473747f695c417abe6900eea3b09e9d6b7685eb5aa1e8118` | Reviewed |
| `../controls/second-copy-controls.ps1` | `5a6b21fced4fd461cbdc1ac98dbb03d11436f9c85cd751080782892258df34b3` | Run 4 `CONTROLS PASS 43/43` |
| `controls-run4.log` | `da3370ec1d21422e9d26e9e28d872b4cdb753b5539d17e4b71081e26f6563ad8` | PASS 43/43 |
| `controls-run3.log` | `21427b6d86a26dc02a6d65c10f1729674194b8c6aa2e8eae856250fba7675381` | Failed, 42/43, superseded: a stale A2 assertion on the PASS-line format |
| `controls-run2.log` | `c9c63a89f1b1d3c76b96ae0a9d50476c9f347f006842aea03ee03e6cb93bd727` | 29/29, first adapter revision `317857c8…`, superseded by review |
| `controls-run1.log` | `1053cd0b4a6fb81ea0a159cad9b48763f662fb1632c3e38e9612af061757ad33` | Failed, 28/29: harness defect (A7 had no local postschema set) |

All control data is non-secret and synthetic. Remote writes went only to `o5-test-*` folders under the preparation root
`/home/arm/afldb-v2-prodexec-20261030T020000Z`, whose test paths also contain parentheses. The real destination was
checked read-only (R1) and was confirmed still empty (R2).

## Independent review

One reviewer, read-only.

**First pass:** three MED findings and five LOW, with no HIGH.
- **M1:** storage identity was only printed. UUID and filesystem type are now asserted in every mode.
- **M2:** verification ran without fsync. The adapter now runs `sync` on each file and on the directory before verifying.
- **M3:** there was no recovery from a partial copy. Each retry now writes a new `<label>-a<N>/` directory beside the
  failed one (`-Attempt` 2 or 3), and the failed attempt is never touched. A `<label>.VERIFIED` record is written with
  `noclobber`, and postschema requires `frozen.VERIFIED`.
- **L1–L5:** scp stderr handling, reading the SUMS file once, anchored parameter patterns, the identity check in Verify,
  and gaps in the controls.

**Re-review:** all ten findings are resolved and nothing is graded MED or above. These remain open:
- **N1 (LOW):** a later `-Mode Verify` cannot prove it read the disk rather than the page cache.
- **N2 (LOW):** the scp-failure path is exercised only by a hand-made failed attempt.
- **I1–I3 (INFO).**

## Use in the session

The adapter replaces `-SecondCopy` at Stages 6 and 11. Stage 6 runs `transfer-session.ps1 -Mode Pull -Label frozen`
without `-SecondCopy`, then:

```
second-copy.ps1 -Mode Copy -Stamp <STAMP> -Label frozen -ArchiveSha <RESULT sha>
```

The backup gate requires its `SECONDCOPY PASS` line. Stage 11 does the same with `-Label postschema`. A `-Mode Verify`
of each set is repeated at Stage 14.
