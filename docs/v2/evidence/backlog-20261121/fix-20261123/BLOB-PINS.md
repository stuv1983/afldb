# Raw Git-blob SHA-256 pins — ISSUE-352 helper pair (code commit `88be90f0e676112c4239032b2e8548389db5ec7d`)

Historical preparation and installation evidence. For Wednesday's active archive command and full pins, use
[the attended R6 plan, section 0](../ATTENDED-PLAN-R6-20261125.md#0-scripts-and-pins).

Calculated by hashing the raw stdout bytes of `git show 88be90f0e676112c4239032b2e8548389db5ec7d:<path>` with SHA-256. Supersedes the 22 Nov table in `../sunday-review-20261122/BLOB-PINS.md` for every file listed here; rows marked unchanged are identical to that table.

| Git blob path at the code commit | Full SHA-256 | Change |
|---|---|---|
| `docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh` | `2ebac1c09b07e6b3bc1e060d7645efdbb1c2c7f169b5cfafd4e7f77508716e24` | changed |
| `docs/v2/evidence/backlog-20261121/kits/scheduled-pull-evidence.sh` | `d7574254997ba28dd1f750b7bcdc6f90c0a421b88ba6bb02aa104bd671b8572e` | changed |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-helper-install.sh` | `c7e67e21086b52f95e83661c32689f90223fa63299a70fa3a3985524771932f2` | new |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-cron-install.sh` | `a45da56413a57c622fb39025d1e462a0136e36f29ed4ae460a1e1590167b1803` | changed |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a2-cron-observe.sh` | `2ac943b113af2247ab3acb3863e97201c8794ff830520338faa8b299268eeee5` | changed |
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-offhost-verify.sh` | `429eec29acf254179c3b7ae7d6489a6c695981fd90996c5c2ce1301314bcc18c` | changed |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/dry-tests-20261123/t-352-scheduled-origin.sh` | `e648d370a215c856776a732e35e0bb77f01d0eb9fc8187cbd7383a600fd0098b` | new |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/dry-tests-20261122g/t-sunday-review.sh` | `e3d7c9196654f0a8b4fb4f5e116db8267a7f45ffb0e620eaeaa93a5d1b3e4cf9` | changed |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/dry-tests-20261122g/t-offhost-stamp.sh` | `a390a8df083a45af5a9590c0d985673b20f9bf21db6c5a2cb3a827be6f8e371c` | unchanged |
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh` | `53ab32a1bad408104c5534898482486735b3648d761006d28be79388ba72012c` | unchanged |
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-post-verify.sh` | `26070c9e12458f488ebaee6eabb84ea7d8003135d96d83f1bfb3576eb070b44e` | unchanged |
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-public-smoke.sh` | `de84f1205b4ab4cfec182b1fb7b0770ca916c8570f10a14539daa9a4e450bd9e` | unchanged |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-rawhead.sh` | `cab4a43af09e4b1729d913162c0f27faccd19315c56eb4ad1141c8bf748d81c0` | unchanged |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-s9-public-smoke.sh` | `babb660f7e7555a55281f2a0a07cb6d1147f39ebfa5ff9c119a677a1e2776a71` | unchanged |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/a1-p6-observe.sh` | `c7416ba4975dd37a04537ef9f4ed6aef14625757037439ee929d258b3d97d6d3` | unchanged |
| `tools/maintenance/offhost-pull.sh` | `a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b` | unchanged |

## Later ISSUE-352 / 351 / 362 code (code commit `3afdf767e8fc42b3989025dca9d10de7e18279d8`)

Same method: SHA-256 of the raw stdout bytes of `git show 3afdf767e8fc42b3989025dca9d10de7e18279d8:<path>`. The two `r6-*` rows **supersede** the `r6-pre-verify.sh` row above and the `r6-pre-verify.sh` row in the Wednesday plan's own table (which is the historical `b445ba7f` pin) for Wednesday's use. `r6-revalidate-accept.sh` is new and is run by plan step F-4b. The three `tools/` and `deploy/` rows are application files that reach production only by a separately approved release; they are listed so the exact reviewed bytes are fixed. None of these files is installed by anything in this commit.

| Git blob path at the code commit | Full SHA-256 | Change |
|---|---|---|
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh` | `e36bcce728808737b932350c5915096fd2a1db5f8386679a79e0c72c8bf4b3cd` | changed (overnight dump bound to the service journal) |
| `docs/v2/evidence/backlog-20261121/r6-20261125/r6-revalidate-accept.sh` | `150fdcef9dcf5e3930feb59da1876a1f2bdbb4c7fddc71132131750e76668b18` | new (F-4b) |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/dry-tests-20261123/t-352-preverify-selector.sh` | `2e0bc465ac8e25cd46420e683f4f09dbac7f2f11391f1fd7e1419f6ac5b97efe` | new |
| `docs/v2/evidence/backlog-20261121/a1a2-20261124/dry-tests-20261123/t-352-revalidate-accept.sh` | `d0e9bf9b343666402e1b1f9de6cfdde8cb10ef6d5e29018c21576ddfb98df736` | new |
| `tools/maintenance/scheduled-backup.sh` | `234fca6a226da73b125ca3dceec9ac97b2192181fd93ad168a7ca50900cb192d` | changed (checked state writes) |
| `tools/maintenance/backup.sh` | `df609046a6a322db3f651d9d2c9cf1820fdb9ca0d0d4d9ae9f67c3dede1be3be` | changed (decoded password) |
| `deploy/server-cluster.mjs` | `cfc4ecb27665ae223b3f374c829e1b5a6a8fe232b084e59378c84b09061217e0` | changed (trace route class) |

The helper-pair rows in the first table (`afldb-offhost-pull-daily.sh`, `scheduled-pull-evidence.sh`, both installers, `r6-offhost-verify.sh`) are unchanged by these commits and keep their pins. Verify before use with `git show <commit>:<path> | sha256sum`.
