# Run 4, scope `evidence`: the manifest checker (owner item 1, ISSUE-363)

Owner item 1 (verbatim): "Fix the evidence checker's cross-folder filename ambiguity. Verify every manifest against its correctly resolved path in a
fresh clone of the final candidate. Preserve the original checker failure and its explanation." Design: `../PLAN-REVIEW-4.md` F-007. Base B4 =
`7cfbe186e70ca91db67da1aa4e28325ccbc32a86`. No database, no port, no application code; the only host use was read-only hashing (section 7).

| File | What |
|---|---|
| `verify-manifests.sh` | the new checker (bash >= 4; reads blobs with `git cat-file` at a REV; one read-only ssh round) |
| `manifest-map.tsv` | the committed per-manifest rule map (roots, aliases, declared non-retention, each with the README line that documents it) |
| `selftest.sh`, `selftest-gitbash.txt`, `selftest-host.txt` | the RED/GREEN self-test and its two recorded runs |
| `original-at-B4.tsv` (+ `.summary.txt`, `.rc.txt`) | the ORIGINAL run-2 script, run once more at B4 on a fresh clone: the red |
| `new-at-B4.tsv` (+ `.summary.txt`, `.rc.txt`) | the new checker at B4 on a fresh clone |
| `SHA256SUMS` | sha256 of every other file in this directory (relative paths; checked by the checker itself at the final candidate) |
| `../../run2/evidence/ERRATA.md` | the one new file beside the old script: the defect, the evidence, the pointer here |

`../../run2/evidence/verify-manifests.sh` is **byte-identical** (sha256 `0a48c77403038a2ee7732621b9f6088900becc5adb8d603591f12d7c23742810`, equal in B4, in
the worktree and in the clone copy that the red run executed); its committed outputs are untouched.

## 1. Result at B4 (pass criterion)

Fresh clone of the workstation worktree in an empty directory, `git checkout --detach 7cfbe186...`, `git rev-parse HEAD` = B4, `git status --porcelain` empty
(0 lines). New checker, Git Bash 5.3.15 (git 2.56.0.windows.4), real ssh round to the DEV host, 1 min 42 s, exit 0. The same output was reproduced on the host
(bash 5.2.21, git 2.43.0, `EVIDENCE_LOCAL_HOST=1`, a clone of the base bundle at B4): the two TSVs are identical except the `# script=` and `# bash=` header lines.

| Class (manifest entries; 50 manifests, 3,001 entries, one row each) | B4 |
|---|---|
| COMMITTED-OK | 1,103 |
| COMMITTED-OK-ALIAS | 15 |
| **COMMITTED-MISMATCH** | **0** |
| **AMBIGUOUS** | **0** |
| HOST-OK | 1,787 |
| **HOST-MISMATCH** | **0** |
| HOST-MISSING | 0 |
| DECLARED-NOT-RETAINED | 96 |
| **UNRESOLVED** | **0** |
| total | 3,001 (= entries; the script exits 3 if rows and entries ever differ) |

The old script at B4 (`original-at-B4.tsv`): 1 COMMITTED-MISMATCH (the known false positive, section 2), 769 COMMITTED-OK, 143 HOST-OK, 94 HOST-MISSING, 1,312 UNRESOLVED
(2,319 rows; it reads 28 of these 50 manifests, never a `run2/` one, and mixes prose rows in). Run 3 recorded 754 / 1 / 141 / 94 / 1,300 at `9cb06c53`.

Informational rows (not manifest entries, never counted as verification of one): 9 INFO-COMMITTED-OK + 18 INFO-HOST-OK (the curated `run2/evidence/readme-hashes.tsv`
list), 2 INFO-HOST-MISSING (the two Caddy binaries again), 1 INFO-UNRESOLVED (`pins.bundle`: the pins README says it was only ever in a workstation scratchpad), 50 INFO-PROSE-MATCHED and 99
INFO-PROSE-UNMATCHED (README `abcd1234...` prefixes, matched only against hashes verified in this run; the unmatched ones are commit/release ids, database digests or short
prefixes with no recorded full value; the old script's scope-wide and host-directory prefix search is deliberately gone), 5 INFO-NONENTRY (header, size and free-text lines inside manifests), 10
INFO-HASHLIKE-FILE (files that contain hash-shaped lines, are not manifests, and whose hashes are therefore NOT verified: raw outputs such as `routes/crawl-*-summary.txt`).

### The 96 DECLARED-NOT-RETAINED, the 94 HOST-MISSING of earlier runs, and what is hashed on what

* **HOST-MISSING is 0.** The 94 recorded since run 2 are 90 entries of `qualification/iso-3aa82166/stagea-dst.sha` and 4 for `auth/` (2 manifest entries + 2 README-embedded). The README statement is
  `run2/evidence/README.md:65` (the run-1 checkout that held the Stage A copy "was removed at the end of run 1") and `:66` (the two Caddy binaries in `caddy-bin/` "also removed").
  They are DECLARED-NOT-RETAINED (90 + 2 manifest rows; the 2 README-embedded ones stay INFO-HOST-MISSING) **only because the host file is actually absent**: the rule never hides a file that exists.
* 4 more are `super` rows: the round-1 `in/cf/Caddyfile{,.production}` hashes of `run2/caddy357` (`MANIFEST-host-sha256.txt:5-6`, `raw/final-caddyfile-sha256.txt:1-2`) were superseded by round 2
  (`run2/caddy357/README.md:365-367`). They are accepted only because the host file today equals the hash recorded in `raw/r2-caddyfile-sha256.txt:1-2` (hashed this run); otherwise they would be HOST-MISMATCH.
* **What the OK rows mean.** COMMITTED-OK only for a blob at the exact resolved path; HOST-OK only for a host file at the resolved path (the `where` column prints it). Two honest limits: the
  Stage A (`stagea-src.sha*`, 3 files x 90) and fitzRoy (`run2/fixtures/fh-expected.sha256`, 131) sources are DEV checkout data that this scope may not read, so those rows are verified on the **retained run-3 copy**
  `/mnt/ssd/afldb-rem3-qual-20261114/cand/data/...` (`run3/qualification-3/README.md:80-84`, `stagea-provenance.txt`), not on DEV; and the manifests of committed files (`qualification/SHA256SUMS`, `run3/integb/SHA256SUMS`, ...) are verified against committed bytes only, not against the host originals they were copied from.
* **15 COMMITTED-OK-ALIAS**: `template-identity.txt` -> `template-identity.restored.txt` (section 2), `full-all-audit.jsonl` -> `audit-residue.jsonl` (`run2/tests363/README.md:174`), 6 `hostout/X` -> `run2/ops/raw/X`,
  3 absolute `scripts.sha256` paths mapped to their committed copies, and 4 `bom-crlf` transforms (section 2).

## 2. Findings in committed evidence (none is a content mismatch; none MED or above)

1. **The known false positive is reproduced and explained** (`original-at-B4.tsv`: `COMMITTED-MISMATCH run3/integ/evidence/brownlow/retained-artefacts.SHA256SUMS template-identity.txt`, actual `81a6c2fb...` of `run3/integb/evidence/c1/template-identity.txt`).
   The new checker resolves the entry through an explicit alias (map line cited in the note) to `template-identity.restored.txt`, which hashes to the recorded `4ec64b7b...ea60`: COMMITTED-OK-ALIAS.
2. **Run-2 `ops` originals (`run2/ops/raw/SHA256SUMS-originals.txt:10-13`)**: the four `prod-ro-*` / `prod-caddyfile-installed` `.txt` hashes are those of the original files (UTF-8 BOM + CRLF); the committed copies are LF/BOM-stripped
   (`run2/ops/README.md:146`). The old script never read `run2/` manifests; a naive exact-path check would call these 4 mismatches. The checker re-adds BOM + CRLF to the committed copy and compares
   (`xform bom-crlf`): all four equal. That is an independent re-derivation, not a trust of the README, so the rows are COMMITTED-OK-ALIAS with the transform named in the note. (The `hostout/` prefix on six other lines of that file is the
   workstation scratch directory the list was made from; the map aliases it to `run2/ops/raw/`, and the same six hashes appear in `host-hashes.txt` as the host `*.clean.txt` files, HOST-OK.)
3. **Run-2 `qualification-2/SHA256SUMS:28` (`unit-stagea2.log`, `f7f7dc68...`)** lists the hash of a *committed-style* copy (ANSI codes removed, `postgres://` lines dropped: `qual.sh.txt:17` `strip()`) that was never committed
   (`*.log` is gitignored); the host original has a different hash (`d4667f5d...`, correctly recorded in `SHA256SUMS-host.txt:32`). A raw comparison is a HOST-MISMATCH; the declared `hxform strip-ansi-dsn` rule
   hashes the host original after the same strip and it equals `f7f7dc68...`, so the row is HOST-OK with the transform stated in the note. Severity LOW: a manifest line for a file that is not in the repository.
4. **Files that other manifests pin must stay byte-identical.** `run3/qualification-3/SHA256SUMS-late` pins `run3/qualification-3/README.md` and `manifest-verify-9cb06c53.tsv`; every other manifest pins its siblings. Any run-4
   edit to a run-1/2/3 evidence file shows up as COMMITTED-MISMATCH. The one new run-2 file, `ERRATA.md`, is not pinned by anything.
5. **Informational only:** the README-prefix section now reports 99 unmatched prefixes instead of the old 50 UNRESOLVED, because the old fallback searched whole scopes by prefix (the same class of search that caused the false positive).

## 3. What counts as a manifest, and how an entry is resolved

A **manifest** is a committed blob (at the REV being checked) anywhere under `docs/v2/evidence/remediation-20261114/`, in any run directory (`run2/` and `run4/` included), whose basename, case-insensitively, contains
`sha256` (this covers `SHA256SUMS`, `HOST-SHA256SUMS`, `*.sha256`, `*-sha256.txt`, `SHA256SUMS.host`, `retained-artefacts.SHA256SUMS`) or ends in `.sha`, **plus** the files named by `include` rows of `manifest-map.tsv` (5: hash lists whose name does not match). At B4: 45 by name
+ 5 included = 50. Discovery is by `git ls-tree` at the REV, so a file added later by a run-4 scope is picked up with no edit to the script or map. A manifest with no parseable entry is reported (UNRESOLVED), never skipped.

An **entry** is a line `<64 hex>  <path>` (a leading `*` and `./` are removed; a trailing `  (annotation)` is kept as a note). `format` rows in the map cover the two other shapes found (`hash  bytes  path`, `hash  host-only  name`).

**Resolution is exact, with no basename or suffix search:**

1. committed candidates: `<manifest dir>/<entry>`; the manifest's declared `croot` roots; a declared `alias` / `aliaspfx` / `abs2c` target;
2. if exactly one exists it **decides the row** (equal: COMMITTED-OK, or -ALIAS if a map rule produced the path; different: COMMITTED-MISMATCH, even when a like-named file elsewhere has the recorded hash); more than one: AMBIGUOUS;
3. otherwise host candidates: `<hroot>/<entry>` for each declared host root, or the entry itself when it is an absolute path; read-only allow-list `/mnt/ssd/afldb-rem*` and the issue-333 workspace (override `EVIDENCE_HOST_ALLOW`), `..` refused, RB-1 refused in code;
   one existing file is compared (HOST-OK / HOST-MISMATCH), several are AMBIGUOUS, none is HOST-MISSING (or DECLARED-NOT-RETAINED when the map cites a README statement, or `super`, above);
4. no candidate and no host root: UNRESOLVED with the reason. A manifest with no map rows therefore behaves as "relative entries are committed beside the manifest, absolute entries are host paths", which is the run-4 rule in section 5.

The host round is **one ssh** whose remote command only runs `test -f`, `test -d` and `sha256sum` (plus `sed`/`grep` piped into `sha256sum` for the single `hxform` row) on the listed paths. Exit: 1 on any COMMITTED-MISMATCH / HOST-MISMATCH / AMBIGUOUS,
3 on an internal row-count inconsistency, 4 with `REQUIRE_NO_UNRESOLVED=1` when any entry is UNRESOLVED. `NO_HOST=1` never reports a host row OK (they become UNRESOLVED "host hashing disabled"). The first lines of the output record the rev, the sha256 of the script and of the map, the bash version and the host mode; the last `# RESULT` line repeats the exit status.

## 4. Self-test (`selftest.sh`): RED on the run-2 script, GREEN on the new one

Throw-away git repos in a temp dir; the run-2 script is run unchanged (`NO_HOST=1`). Recorded runs: `selftest-gitbash.txt` (Git Bash 5.3.15 / git 2.56.0.windows.4, MINGW64) and `selftest-host.txt` (bash 5.2.21 / git 2.43.0, Linux): **33 passed, 0 failed** in both. The decisive lines:

```
== (a) cross-folder false positive
  ok    RED   run-2 script: entry template-identity.txt                COMMITTED-MISMATCH   (false: the real file is committed as template-identity.restored.txt)
  ok    GREEN run-4 script, no map: no cross-folder comparison         UNRESOLVED
  ok    GREEN run-4 script, alias map: entry template-identity.txt     COMMITTED-OK-ALIAS
  ok    GREEN wrong alias target is COMMITTED-MISMATCH (a like-named correct file in run3/y is NOT used)
== (b) masked real mismatch
  ok    RED   run-2 script: altered run3/a/data.txt is reported        COMMITTED-OK         (false: the file at the manifest's own path is altered)
  ok    RED   run-2 script: exit status 0 (the corruption is hidden)   0
  ok    GREEN run-4 script: altered file at the manifest's own path    COMMITTED-MISMATCH   exit status 1
```

It also covers AMBIGUOUS, the declared `bom-crlf` transform (and the same bytes without a rule being a mismatch), a run-4-style `SHA256SUMS` + `HOST-SHA256SUMS` pair discovered with no map row, a manifest with no entries, HOST-OK / HOST-MISMATCH / HOST-MISSING /
DECLARED-NOT-RETAINED / `super` through `EVIDENCE_LOCAL_HOST=1` (the remote command under `bash -c` in a temp dir allowed by `EVIDENCE_HOST_ALLOW`: no network), refusal to read RB-1 or a path outside the allow-list, a committed mismatch not being rescued by a matching host file, and `NO_HOST=1`.

## 5. How to run in a fresh clone of the final candidate (orchestrator and closure)

```
# 1. fresh clone, detached at the candidate, clean tree (record all three outputs)
T=$(mktemp -d) && git -c core.longpaths=true clone -q <path-to-worktree-or-bundle-clone> "$T/final" && cd "$T/final" \
  && git -c core.longpaths=true checkout -q --detach <CANDIDATE_SHA> && git rev-parse HEAD && git status --porcelain | wc -l
# 2. the self-test (Git Bash or host; prints the bash/git versions; exit status = number of failures)
bash docs/v2/evidence/remediation-20261114/run4/evidence/selftest.sh
# 3. the checker, from the clone, at the candidate (workstation: real ssh to the host; REQUIRE_NO_UNRESOLVED makes any UNRESOLVED fail)
REQUIRE_NO_UNRESOLVED=1 bash docs/v2/evidence/remediation-20261114/run4/evidence/verify-manifests.sh . <CANDIDATE_SHA> > final.tsv 2> final.summary; echo rc=$?
#    on the DEV host itself (no ssh to self): prefix step 3 with EVIDENCE_LOCAL_HOST=1
```

Pass: `rc=0`, `# RESULT exit=0` in `final.tsv`, `COMMITTED-MISMATCH`, `HOST-MISMATCH`, `AMBIGUOUS` and `UNRESOLVED` all 0, `# TOTAL` equal to the `entries=` header, and the header's `rev=` equal to the candidate. State the counts per class in the packet; do not write "verified" for DECLARED-NOT-RETAINED or INFO rows.
The script and map are read from the clone (their sha256 are printed in the header). Allow about 2 minutes on Git Bash (one process per blob) and well under a minute on the host.

**Rule for run-4 manifests** (so the map never needs a post-candidate edit): (a) list **committed files only, with paths relative to the manifest's own directory**, in a file named `SHA256SUMS` (or any name containing `sha256`, or ending `.sha`); (b) put **host-only
hashes in a separately named file, e.g. `HOST-SHA256SUMS`, with absolute host paths** under `/mnt/ssd/afldb-rem4-*` (they are hashed read-only and never resolved against git); (c) do not list a file that a later commit will change, nor the manifest itself, nor the checker's own output. A manifest that breaks
(a) or (b) is reported UNRESOLVED (or as a mismatch), never guessed. The checker needs no `manifest-map.tsv` row for a manifest that follows the rule.

## 6. Per-manifest result at B4 (from `new-at-B4.tsv`)

| Manifest (relative to `docs/v2/evidence/remediation-20261114/`) | Entries | Classes |
|---|---|---|
| `answers/host-scripts-sha256.txt` | 13 | 13 HOST-OK |
| `answers/raw-sha256.txt` | 39 | 16 COMMITTED-OK, 23 HOST-OK |
| `auth/raw/sha256-inputs-and-binaries.txt` | 6 | 4 HOST-OK, 2 DECLARED-NOT-RETAINED |
| `hostops/host-evidence/SHA256SUMS` | 11 | 11 COMMITTED-OK |
| `perf/scripts.sha256` | 16 | 16 COMMITTED-OK |
| `qualification/SHA256SUMS` | 107 | 107 COMMITTED-OK |
| `qualification/iso-3aa82166/stagea-dst.sha` | 90 | 90 DECLARED-NOT-RETAINED |
| `qualification/iso-3aa82166/stagea-src.sha` | 90 | 90 HOST-OK |
| `routes/host-evidence.sha256` | 16 | 16 HOST-OK |
| `run2/admin/SHA256SUMS.host` | 12 | 6 HOST-OK, 6 COMMITTED-OK |
| `run2/caddy357/MANIFEST-host-sha256.txt` | 102 | 83 HOST-OK, 17 COMMITTED-OK, 2 DECLARED-NOT-RETAINED |
| `run2/caddy357/MANIFEST-r2-host-sha256.txt` | 68 | 4 COMMITTED-OK, 64 HOST-OK |
| `run2/caddy357/low4/SHA256SUMS` | 5 | 5 COMMITTED-OK |
| `run2/caddy357/raw/final-caddyfile-sha256.txt` | 2 | 2 DECLARED-NOT-RETAINED |
| `run2/caddy357/raw/r2-caddyfile-sha256.txt` | 2 | 2 HOST-OK |
| `run2/fixtures/fh-expected.sha256` | 131 | 131 HOST-OK |
| `run2/lint364/MANIFEST.sha256` | 5 | 5 COMMITTED-OK |
| `run2/ops/raw/SHA256SUMS-committed.txt` | 24 | 24 COMMITTED-OK |
| `run2/ops/raw/SHA256SUMS-originals.txt` | 20 | 10 COMMITTED-OK, 10 COMMITTED-OK-ALIAS |
| `run2/ops/raw/host-hashes.txt` | 14 | 14 HOST-OK |
| `run2/public/HOST-PACK-SHA256SUMS` | 60 | 2 HOST-OK, 58 COMMITTED-OK |
| `run2/public/SHA256SUMS` | 145 | 145 COMMITTED-OK |
| `run2/public/raw/corpus-hashes.txt` | 2 | 2 HOST-OK |
| `run2/public/raw/low3-corpus-hashes.txt` | 3 | 3 HOST-OK |
| `run2/public/raw/med1-corpus-hashes.txt` | 3 | 3 HOST-OK |
| `run2/qualification-2/SHA256SUMS` | 28 | 21 COMMITTED-OK, 7 HOST-OK |
| `run2/qualification-2/SHA256SUMS-host.txt` | 34 | 12 COMMITTED-OK, 22 HOST-OK |
| `run2/qualification-2/stagea-src.sha256` | 90 | 90 HOST-OK |
| `run2/tests363/MANIFEST.txt` | 49 | 49 COMMITTED-OK |
| `run2/tests363/SHA256SUMS-host.txt` | 25 | 1 COMMITTED-OK-ALIAS, 24 HOST-OK |
| `run2/tests363/SHA256SUMS-reviewd-host.txt` | 3 | 3 HOST-OK |
| `run3/integ/evidence/SHA256SUMS` | 86 | 86 COMMITTED-OK |
| `run3/integ/evidence/brownlow/fixture-root.files.sha256` | 258 | 258 HOST-OK |
| `run3/integ/evidence/brownlow/retained-artefacts.SHA256SUMS` | 4 | 3 HOST-OK, 1 COMMITTED-OK-ALIAS |
| `run3/integb/SHA256SUMS` | 316 | 316 COMMITTED-OK |
| `run3/integb/evidence/c1/RESTORE.md.sha256` | 1 | 1 HOST-OK |
| `run3/integb/evidence/final/RESTORE.md.sha256` | 1 | 1 HOST-OK |
| `run3/integb/evidence/final2/RESTORE.md.sha256` | 1 | 1 HOST-OK |
| `run3/qualification-3/SHA256SUMS` | 35 | 35 COMMITTED-OK |
| `run3/qualification-3/SHA256SUMS-host.txt` | 28 | 6 HOST-OK, 22 COMMITTED-OK |
| `run3/qualification-3/SHA256SUMS-late` | 2 | 2 COMMITTED-OK |
| `run3/qualification-3/scripts.sha256` | 3 | 3 COMMITTED-OK-ALIAS |
| `run3/qualification-3/stagea-expected.sha256` | 42 | 42 HOST-OK |
| `run3/qualification-3/stagea-src.sha256` | 90 | 90 HOST-OK |
| `run3/rebuild/SHA256SUMS` | 42 | 42 COMMITTED-OK |
| `run3/rebuild/bridge-child.sha256` | 1 | 1 HOST-OK |
| `run3/rebuild/dump.sha256` | 1 | 1 HOST-OK |
| `run3/rebuild/inputs-files.sha256` | 752 | 752 HOST-OK |
| `run3/stateb/SHA256SUMS` | 92 | 92 COMMITTED-OK |
| `tests/host-log-sha256.txt` | 31 | 29 HOST-OK, 2 COMMITTED-OK |

## 7. Disclosure

Edits: only `run4/evidence/**` and the one new `run2/evidence/ERRATA.md`. Host use, all read-only hashing and listing of paths named in committed records, plus my own scratch: `/mnt/ssd/afldb-rem4-evidence-20261115` (a clone of the base bundle at B4, the tool copies,
`new-at-B4-host.tsv`, `new-at-B4-host.err`) and two helper scripts in the host `/tmp` (`rem4ev-hprobe.sh`, `rem4ev-hfind.sh`; removed at the end of the run) that I used to derive the host roots (read-only `sha256sum` / `find`). While deriving the roots I hashed, never wrote, files under the
run-1/2/3 workspaces `/mnt/ssd/afldb-rem*-2026111*`, the retained `/mnt/ssd/afldb-rem3-qual-20261114/cand/data/...` copies and `/mnt/ssd/afldb-rem3-base/rebuilt/`. Nothing under RB-1, production, DEV application paths or the shared `afldb_test` was touched; nothing was pushed.
