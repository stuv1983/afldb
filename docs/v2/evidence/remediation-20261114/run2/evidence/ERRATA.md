# ERRATA: `verify-manifests.sh` (run 2) resolves manifest entries by file name (ISSUE-363)

Written in remediation run 4. **Nothing in this directory was changed:** `verify-manifests.sh` is byte-identical
(sha256 `0a48c77403038a2ee7732621b9f6088900becc5adb8d603591f12d7c23742810`), and every committed output that it produced
(`manifest-verify-*.tsv` here, `../../run3/qualification-3/manifest-verify-9cb06c53.tsv`) stays as it was. This file only records that those
outputs must be read with the defects below in mind, and points to the replacement.

## The defects (line numbers are those of `verify-manifests.sh`)

1. **Cross-folder basename match, a false positive (`:77`, `:91-94`).** The scope of a manifest is taken as the first path component under
   the evidence base. For run 3 that component is the single word `run3`, so an entry is also compared with every file under `run3/` whose
   path ends in the entry's name. Observed: `run3/qualification-3/manifest-verify-9cb06c53.tsv` row 1, `COMMITTED-MISMATCH` for entry
   `template-identity.txt` of `run3/integ/evidence/brownlow/retained-artefacts.SHA256SUMS`: the recorded `4ec64b7b…ea60` was compared with the
   unrelated `run3/integb/evidence/c1/template-identity.txt` (`81a6c2fb…daba32`). The real file is committed under another name,
   `run3/integ/evidence/brownlow/template-identity.restored.txt`, and does hash to `4ec64b7b…ea60`. The explanation was recorded in
   `run3/RESIDUALS-3.md` section 2.5, `run3/CLOSURE-3.md` section 3 (F-008) and `run3/qualification-3/README.md` "Evidence manifests". The
   same defect reproduces unchanged at run-4 base B4 (`7cfbe186`): `../../run4/evidence/original-at-B4.tsv`, 1 `COMMITTED-MISMATCH`, the same row.
2. **A masked real mismatch, a false OK (`:62-67`).** `queue` accepts the first candidate whose hash matches. If the file at the manifest's
   own path is altered while a like-named file elsewhere in the scope still has the recorded hash, the row is `COMMITTED-OK` and the
   exit status is 0. This direction hides real corruption and was never observed in the recorded outputs; it is demonstrated on a throw-away
   repository by `../../run4/evidence/selftest.sh` (fixture b).
3. **Coverage gaps.** `:74` and `:159` skip everything under `run2/`; `:49` has no host rule for run-3 scopes (1,159 of 1,300 UNRESOLVED rows in
   the 9cb06c53 output); the truncated-hash fallback (`:168-186`) searches whole scopes by prefix.

## What to use instead

`../../run4/evidence/verify-manifests.sh` (exact resolution only: manifest directory plus entry, or a rule in the committed
`manifest-map.tsv`; ambiguity is its own class; a committed blob at the resolved path decides the row; every manifest including `run2/` and
`run4/`). Method, classes, results at B4 and the self-test: `../../run4/evidence/README.md`.
