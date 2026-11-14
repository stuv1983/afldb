# run2 / evidence: what this scope added and corrected

Scope `evidence` of remediation run 2 (branch `claude/rem2-evidence-20261114`, base `e8666c17`). Nothing in `QUALIFICATION.md`, any verdict or any existing
evidence file was edited. Contents of this directory:

| File | Purpose |
|---|---|
| `README.md` | this note: the CR correction and the manifest verifier method |
| `verify-manifests.sh`, `readme-hashes.tsv` | the all-manifest verifier and its curated README-embedded hash list |
| `manifest-verify-<sha>.tsv` | the verifier's output, `<sha>` being the commit it was run at (the commit before the one that adds the file) |
| `TESTED-REVISIONS.md` | tested revision and carry-forward to `e8666c17` for every QUALIFICATION result and every scope README's final qualification |
| `FAILURE-CLASSIFICATION.md`, `failure-ids.tsv` | one row per failing test id behind QUALIFICATION §1-§4, classified, with the evidence for each class |

## 1. The five CR-bearing evidence files

**Defect (found by the orchestrator's first verifier run):** five committed blobs did not hash to the values in `qualification/SHA256SUMS`, because the repository's
`core.autocrlf=true` checkout/commit path rewrote the carriage returns that terminal progress output legitimately contains.

**Correction (commit `6f8cf410`):** the raw originals were copied byte for byte from the host and committed; `.gitattributes` gained one rule with `-text` for exactly these five paths
(no repository-wide change, and no `core.autocrlf` change):

| Committed path (under `qualification/`) | bytes | CR count | sha256 (equal to the manifest entry) |
|---|---|---|---|
| `iso-3aa82166/build-next.log` | 8,375 | 3 | `8ec4fa55271a3b1723f524c28721eb13221134b3f8f415ded16d8d1b6e5a5864` |
| `iso-3aa82166/serve.out` | 712 | 1 | `fa8dd0cef766b782064fefffc9e97f0ff43b06c64a0670608937eeb87fc14e7f` |
| `iso-3aa82166/serve2.out` | 2,928 | 1 | `0f6cbc761a507416afaab0e7bdc40a03ac898e7dbbf4ae005e7819b8f8e7b50c` |
| `iso-3aa82166/serve3.out` | 3,750 | 1 | `2343c457ec883c73a485276ff1835fcfc09d5cd406fa6cd2308ea3a15daa19c3` |
| `visual/serve3.out` | 3,750 | 1 | `2343c457ec883c73a485276ff1835fcfc09d5cd406fa6cd2308ea3a15daa19c3` |

Originals: `/mnt/ssd/afldb-rem-int-20261114/evidence/iso-3aa82166/` (hashed on the host and again on the workstation after the copy). **`visual/serve3.out` has no separate host original:**
no `visual*` directory exists on the host; its manifest hash equals `iso-3aa82166/serve3.out`, so it is a byte copy of that file, committed from the same source.
After restoring them, `git add --renormalize .` changed only `.gitattributes` and these five files. `git cat-file blob <rev>:<path> | sha256sum` equals the manifest value for all five;
`git check-attr text` reports `unset` for them. On a checkout with `autocrlf=true` the working-tree copies are therefore no longer rewritten; checkouts made before this commit keep the old bytes until re-checked-out.

## 2. Manifest verifier method (`verify-manifests.sh <repo> [rev]`)

Reads committed blobs with `git cat-file` (so a working tree's autocrlf cannot influence it) and, only where a file is not committed, re-hashes it **read-only** on the host over one `ssh`
(`sha256sum` / `test -f`, nothing else, only under `/mnt/ssd/afldb-rem-<scope>-20261114/` and the int workspace). Exit status 1 on any COMMITTED-MISMATCH.

**Sources scanned** (everything under `docs/v2/evidence/remediation-20261114/` except `run2/`):

1. every file whose basename matches `SHA256SUMS`, `*sha256*` or `*.sha`: eight manifests (239 entries) plus `qualification/iso-3aa82166/stagea-{src,dst}.sha` (90 each);
2. the hashes written into READMEs and the qualification header (`readme-hashes.tsv`, 32 curated entries; each is checked to still occur in its README text);
3. every truncated `abcd1234…` hash in any README, matched against the hashes verified in the run, then against all committed blobs of the README's scope and the scope's host evidence directory.

**Resolution of an entry**, in order: a committed blob at the manifest's directory + name, else the suffix match within the same scope directory (for example `perf/scripts/X.txt` for the manifest line `X.txt`),
else the host path the scope README names (the README line is cited in the script). Classes:

| Class | Meaning |
|---|---|
| COMMITTED-OK | committed blob equals the expected hash |
| COMMITTED-MISMATCH | committed blob of that name exists and differs (**required zero**) |
| HOST-OK | not committed; re-hashed on the host and equal |
| HOST-MISMATCH | host file differs (reported, never fixed; none found) |
| HOST-MISSING | not committed and gone from the host (reported; never regenerated and never dropped from a manifest) |
| UNRESOLVED | location not determinable (the note column says why) |

**Result at the commit named in `manifest-verify-<sha>.tsv`** (`HEAD` at the time the verifier ran; `run2/` is excluded from scanning, so later commits in this directory do not change it): 0 COMMITTED-MISMATCH, 0 HOST-MISMATCH,
161 COMMITTED-OK, 139 HOST-OK, 94 HOST-MISSING, 117 UNRESOLVED (511 rows). Across the eight proper manifests alone (239 entries): 152 COMMITTED-OK, 85 HOST-OK, 2 HOST-MISSING.
The original orchestrator run (`manifest-verify-e8666c17.tsv`: 115 OK / 5 MISMATCH / 103 NOTCOMMITTED / 16 HOSTONLY) moves as follows: the 5 mismatches are fixed by section 1, and 32 NOTCOMMITTED entries
become COMMITTED-OK through the suffix rule (`perf/scripts`, `answers/final`, ...), which that run did not apply.

**What is not verified, and why** (none relabelled as verified):

- **94 HOST-MISSING.** `stagea-dst.sha` (90): the checkout that held the Stage A copy (`.../afldb-rem-int-20261114/cand/data/sources/draftguru/annual-html-20260826/`) was removed at the end of run 1.
  `auth/raw/sha256-inputs-and-binaries.txt` and `auth/README.md` (2 + 2): the two Caddy binaries lived in `/mnt/ssd/afldb-rem-auth-20261114/caddy-bin/`, also removed.
- **90 UNRESOLVED, `stagea-src.sha`.** The source is DEV's `/home/arm/projects/afldb/data/sources/draftguru/annual-html-20260826`. This scope was not permitted to read DEV paths and did not.
  The note beside that file says each name and hash is identical to `stagea-dst.sha`; that statement is not independently checked here.
- **26 UNRESOLVED truncated prefixes** (`APPROVAL-PACKET.md:47`, `admin/README.md:105`, `draftguru/README.md:72`, `hostops/README.md:45/180/219`, `nl/README.md:45/62`, `pins/README.md:11/12/13/38/97`, `rollover/README.md:87/89/94/96`):
  these are git commit ids, release ids and database digests, or short (16-hex) prefixes whose full value is not given anywhere; they match no file hash in the run.
- **1 UNRESOLVED `pins.bundle`:** the pins README says it lived only in a workstation scratchpad; there is no location to hash.
- The snapshot dump hash `e77c307d…2826d` (production snapshot `afldb_prod-20261104T021037Z.dump`) was re-hashed on the host (hash only; the dump was not copied, opened or listed).

Fresh-clone use: `bash docs/v2/evidence/remediation-20261114/run2/evidence/verify-manifests.sh . <rev>` (needs bash 4; set `NO_HOST=1` to skip host hashing, in which case host-resolved rows report UNRESOLVED with the reason `host hashing disabled (NO_HOST=1)`).
`readme-hashes.tsv` must be committed alongside the script (the verifier reads it with `git cat-file`).
