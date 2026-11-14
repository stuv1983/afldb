# Manifest verification at the final candidate (P2-06, run 2)

Run by the orchestrator on a fresh `git clone --no-checkout` of the integration branch, detached at `b0c7e02d` (Windows checkout
could not write a few over-long `issues/open/...` paths; the verifier reads blobs with `git cat-file`, so this does not affect it).

- `verify-manifests.sh <clone> HEAD` (`manifest-verify-b0c7e02d.tsv`): **0 COMMITTED-MISMATCH**; 161 COMMITTED-OK, 139 HOST-OK,
  94 HOST-MISSING (host files removed at the end of run 1, as recorded), 117 UNRESOLVED (truncated or README-embedded hashes
  with no unique path; see `README.md` here). rc 0.
- Run-2 manifests against committed blobs (`run2-manifests-b0c7e02d.txt`): every committed file listed matches, including
  public `SHA256SUMS` 145/145, tests363 `MANIFEST.txt` 49/49, caddy357 `low4/SHA256SUMS` 5/5, qualification-2 `SHA256SUMS` 21/21,
  ops `SHA256SUMS-committed.txt` 24/24.
- **Expected, not a defect:** `ops/raw/SHA256SUMS-originals.txt` shows 4 "MISMATCH" lines. That manifest records the **host
  originals**; the committed copies are LF and BOM-stripped (`ops/README.md`, line 146), and those copies are covered by
  `SHA256SUMS-committed.txt`, which matches 24/24.
- "not-committed" counts are host-side or fixture paths that are deliberately not in the repository (fixtures are gitignored).
