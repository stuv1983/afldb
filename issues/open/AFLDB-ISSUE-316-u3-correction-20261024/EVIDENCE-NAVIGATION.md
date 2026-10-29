# Current navigation and repository preservation metadata (2026-10-25)

This is later documentation, not original execution evidence. Historical/hash-bound
files and their manifests remain unchanged. U3 is **CONFIRMED**, U4 is **Route B**,
Brownlow is untouched and production remains **NO-GO**.

## Historical snapshot links

`metadata-repair-v4-validation-preparation-20261024T195111Z/METADATA-REPAIR-V4-RECORD.before.md`
is a frozen historical snapshot. Its relative links reflect its former location;
they are not current navigation instructions. Their current destinations are:

- [The original v4 package README](metadata-repair-v4/README.md).
- [The original v4 session inventory](SESSION-FILES.metadata-repair-v4.json).

The navigation README and inventory copy added inside that snapshot during the
previous Codex turn were removed as directed by the owner. No pre-existing
snapshot file was edited, moved or deleted. Do not add replacement link stubs
inside the frozen snapshot.

## Later preservation metadata

The directory-local `.gitattributes` is later repository metadata. Its `-text`
rule prevents Git newline conversion of retained evidence. It did not exist
during the original execution and is not a member of any historical manifest.
The same classification applies to the current navigation and admission/audit
reports; they must not be represented as original run evidence.

Raw historical `.log` files are classified as archival byte data (`-diff`) in
this later metadata. Their original whitespace is preserved and checked by
SHA-256, not rewritten to satisfy `git diff --check`. Documentation/source
whitespace checking remains active.

Current [admission and blind-scan manifest](../AFLDB-ISSUE-316-activation-separation-20261025/U3-ADMISSION-MANIFEST.json):
42 admitted files, 20 excluded; production credential exact blind scan PASS.
The [three historical narrative discrepancies](../AFLDB-ISSUE-316-activation-separation-20261025/HISTORICAL-NARRATIVE-DRIFT.md)
are expected point-in-time version drift, not evidence corruption or blockers.

Before the separate evidence commit, use an exact reviewed admission list for
ignored files. A matching hash alone does not authorize retention of obsolete
scratch files or secrets. No historical execution log may be regenerated or
edited to make its hash or credential scan pass.
